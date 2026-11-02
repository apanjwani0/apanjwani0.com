/**
 * The MCP server's contents: the tools, the protocol answers and the message
 * parser. `src/pages/api/mcp.ts` owns the transport and, with it, every rate
 * limiter (the smoke test reads the order of the limiter calls out of that
 * file), so nothing in here spends a token.
 *
 * Stateless Streamable HTTP, JSON-RPC 2.0 over POST. No sessions, no server
 * stream, no authentication: it is a front door to the same three diagnostics
 * the pages call, and it stays inside what a page could do.
 *
 * Each tool calls the SAME handler the HTTP route exports (`GET` of
 * `/api/tools/chainsaw` and the others) with a request built in memory, never
 * `fetch`. That is what keeps the two from drifting: there is one body-shaping
 * function per tool, and the route's own per-client and shared buckets are the
 * ones this call spends, because they are the same module-level limiters.
 * `cf-connecting-ip` is copied across so the route buckets the caller as itself.
 *
 * Every tool validates BEFORE any limiter is spent, as the routes do, so a
 * malformed call costs the caller nothing.
 */
import type { APIRoute } from 'astro'
import { csValidateTarget } from './tls-inspect'
import { sgValidateName } from '../components/tools/dns-sightline/analyze'
import { lpValidateUrl } from './link-peek-fetch'
import { isValidBinId, WEBHOOK_BIN_TTL_MS, WEBHOOK_MAX_BODY_BYTES, WEBHOOK_MAX_REQUESTS_PER_BIN } from './webhook-store'
import { MCP_LIMITS, objectSchema, PARAMS } from './openapi'
import { GET as chainsawGet } from '../pages/api/tools/chainsaw'
import { GET as dnsSightlineGet } from '../pages/api/tools/dns-sightline'
import { GET as linkPeekGet } from '../pages/api/tools/link-peek'
import { GET as listRequestsGet } from '../pages/api/hook/[bin]/requests'

/** The revision of the MCP specification this server speaks. */
export const MCP_PROTOCOL_VERSION = '2025-11-25'
/** Older revisions a client may ask for; the answers here are valid under all of them. */
export const MCP_SUPPORTED_VERSIONS: readonly string[] = [MCP_PROTOCOL_VERSION, '2025-06-18']

export const MCP_MAX_BODY_BYTES = 16 * 1024
/** A tool result larger than this is replaced by a sentence, so no call returns an unbounded payload. */
export const MCP_MAX_RESULT_CHARS = 400_000
/** The part of a bin listing returned to an agent, newest first. */
export const MCP_MAX_BIN_LISTING_CHARS = 150_000

export const MCP_SERVER_INFO = { name: 'apanjwani0-tools', title: 'apanjwani0.com diagnostics', version: '1.0.0' } as const

export const RPC_PARSE_ERROR = -32700
export const RPC_INVALID_REQUEST = -32600
export const RPC_METHOD_NOT_FOUND = -32601
export const RPC_INVALID_PARAMS = -32602
export const RPC_RATE_LIMITED = -32000

export type RpcId = string | number | null
type Json = Record<string, unknown>

export const rpcResult = (id: RpcId, result: object): Json => ({ jsonrpc: '2.0', id, result })
export const rpcError = (id: RpcId, code: number, message: string): Json => ({ jsonrpc: '2.0', id, error: { code, message } })

/* ------------------------------------------------------------------ */
/* parsing                                                             */
/* ------------------------------------------------------------------ */

export type McpMessage =
  | { kind: 'request'; id: string | number; method: string; params: unknown }
  | { kind: 'notification' }
  | { kind: 'invalid'; id: RpcId; reason: string }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Classify one decoded JSON body. A batch (an array) is refused: the 2025-06-18
 * revision removed batching, and a stateless server has no use for it. A client's
 * response to a server request, or a notification, needs no answer; this server
 * never sends the former.
 */
export function mcpParseMessage(body: unknown): McpMessage {
  if (Array.isArray(body)) return { kind: 'invalid', id: null, reason: 'Batches are not supported; send one JSON-RPC message per request.' }
  if (!isPlainObject(body) || body.jsonrpc !== '2.0') return { kind: 'invalid', id: null, reason: 'That is not a JSON-RPC 2.0 message.' }
  const hasId = Object.prototype.hasOwnProperty.call(body, 'id')
  const id = body.id
  if (hasId && typeof id !== 'string' && typeof id !== 'number') {
    return { kind: 'invalid', id: null, reason: 'A request id must be a string or a number.' }
  }
  if (typeof body.method === 'string') {
    if (!hasId) return { kind: 'notification' }
    return { kind: 'request', id: id as string | number, method: body.method, params: body.params }
  }
  if (hasId && (Object.prototype.hasOwnProperty.call(body, 'result') || Object.prototype.hasOwnProperty.call(body, 'error'))) {
    return { kind: 'notification' }
  }
  return { kind: 'invalid', id: hasId ? (id as RpcId) : null, reason: 'That message has no method.' }
}

/* ------------------------------------------------------------------ */
/* tools                                                               */
/* ------------------------------------------------------------------ */

export interface McpToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

/** What a tool run produced: its result, or word that the route's own buckets refused it. */
export type McpRun = { limited: true } | { limited: false; result: McpToolResult }

export interface McpContext {
  request: Request
  /** The site's origin, read from config only for the tool that prints a URL. */
  origin: () => Promise<string>
}

type Checked = { ok: true; args: Record<string, string> } | { ok: false; error: string }

export interface McpTool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }
  /** Syntax only: no DNS, no socket, no limiter. A refusal here costs the caller nothing. */
  validate(raw: unknown): Checked
  run(args: Record<string, string>, ctx: McpContext): Promise<McpRun>
}

const textResult = (text: string, isError = false): McpToolResult => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) })

/** Arguments must be an object holding only the named string properties; `required` ones must be present. */
function pickArgs(raw: unknown, allowed: readonly string[], required: readonly string[]): Checked {
  const source = raw === undefined ? {} : raw
  if (!isPlainObject(source)) return { ok: false, error: 'The arguments must be a JSON object.' }
  const args: Record<string, string> = {}
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) return { ok: false, error: 'That argument is not one this tool accepts.' }
    if (typeof source[key] !== 'string') return { ok: false, error: `The ${key} argument must be a string.` }
    args[key] = source[key] as string
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(args, key)) return { ok: false, error: `The ${key} argument is required.` }
  }
  return { ok: true, args }
}

/** A request for `path` built in memory, bucketed as the MCP caller. */
function inMemoryRequest(path: string, query: Record<string, string>, from: Request): Request {
  const url = new URL(path, 'http://mcp.internal')
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const ip = from.headers.get('cf-connecting-ip')
  return new Request(url, { headers: ip ? { 'cf-connecting-ip': ip } : {}, signal: from.signal })
}

const call = (handler: APIRoute, context: Record<string, unknown>) =>
  Promise.resolve(handler(context as unknown as Parameters<APIRoute>[0]))

/** One short sentence from the JSON; a shape surprise costs the sentence, never the call. */
function summary(build: () => string, fallback: string): string {
  try { return build() } catch { return fallback }
}

async function fromRoute(
  res: Response,
  summarize: (body: any) => string,
  reshape: (body: any) => unknown = body => body,
): Promise<McpRun> {
  if (res.status === 429) return { limited: true }
  const raw = await res.text()
  let body: any = null
  try { body = JSON.parse(raw) } catch { body = null }
  const failed = res.status >= 400 || body === null || body.ok === false
  if (failed) {
    const reason = typeof body?.error === 'string' && body.error.length <= 400 ? body.error : 'The check could not be completed.'
    return { limited: false, result: { content: [{ type: 'text', text: reason }, { type: 'text', text: raw.slice(0, 2000) }], isError: true } }
  }
  const shaped = reshape(body)
  const text = JSON.stringify(shaped)
  if (text.length > MCP_MAX_RESULT_CHARS) {
    return { limited: false, result: textResult('The result was larger than this server will return in one call.', true) }
  }
  return { limited: false, result: { content: [{ type: 'text', text: summary(() => summarize(shaped), 'The check completed.') }, { type: 'text', text }] } }
}

const limitsLine = `Limits: ${MCP_LIMITS.callsPerClient} tool calls a minute per client across all tools and ${MCP_LIMITS.callsShared} a minute in total, on top of this tool's own limits.`

const inspectTls: McpTool = {
  name: 'inspect_tls',
  title: 'Inspect a TLS certificate chain',
  description: `Dials a public host over TLS from this server and reports the certificates it really sends, the negotiated protocol and cipher, whether the chain verifies, and the earliest expiry across the chain. Two real handshakes are made, pinned to the address that was checked. ${limitsLine}`,
  inputSchema: objectSchema(['target'], ['target']),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  validate(raw) {
    const picked = pickArgs(raw, ['target'], ['target'])
    if (!picked.ok) return picked
    const checked = csValidateTarget(picked.args.target)
    return checked.ok ? picked : { ok: false, error: checked.reason }
  },
  async run(args, ctx) {
    const res = await call(chainsawGet, { request: inMemoryRequest('/api/tools/chainsaw', { target: args.target }, ctx.request) })
    return fromRoute(res, b => {
      const r = b.report
      const n = r.presented.length
      return `Dialled ${r.host}:${r.port} and read ${n} certificate${n === 1 ? '' : 's'} from the handshake (${r.handshake.protocol ?? 'unknown protocol'}); the chain ${r.handshake.authorized ? 'verifies against the public trust store' : 'does not verify against the public trust store'}.`
    })
  },
}

const inspectDns: McpTool = {
  name: 'inspect_dns',
  title: 'Compare what three resolvers say about a domain',
  description: `Asks Cloudflare, Google and Quad9 the same questions about a domain over DNS-over-HTTPS and returns their answers side by side with findings on SPF, DMARC, CAA, MX and CNAME records. scope "caa" reads only the CAA policy. ${limitsLine}`,
  inputSchema: objectSchema(['name', 'scope'], ['name']),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  validate(raw) {
    const picked = pickArgs(raw, ['name', 'scope'], ['name'])
    if (!picked.ok) return picked
    const checked = sgValidateName(picked.args.name)
    if (!checked.ok) return { ok: false, error: checked.reason }
    if (picked.args.scope !== undefined && picked.args.scope !== 'full' && picked.args.scope !== 'caa') {
      return { ok: false, error: 'The scope must be "full" or "caa".' }
    }
    return picked
  },
  async run(args, ctx) {
    const query: Record<string, string> = { name: args.name }
    if (args.scope) query.scope = args.scope
    const res = await call(dnsSightlineGet, { request: inMemoryRequest('/api/tools/dns-sightline', query, ctx.request) })
    return fromRoute(res, b => {
      const r = b.report
      if (b.scope === 'caa') return `Read the CAA policy for ${r.name ?? args.name} in ${r.queries} DNS queries.`
      const count = r.findings.length
      return `Asked three resolvers about ${r.name} in ${r.queries} DNS queries over ${r.elapsedMs} ms and found ${count} finding${count === 1 ? '' : 's'}${r.deadlineHit ? ' (the run stopped at its time limit, so some sections are incomplete)' : ''}.`
    })
  },
}

const peekLink: McpTool = {
  name: 'peek_link',
  title: 'Preview how a link unfurls',
  description: `Fetches a public web page once from this server and returns the Open Graph, Twitter card and basic meta tags it carries, after at most four redirects that are each re-checked. The connection is pinned to the address that was checked. ${limitsLine}`,
  inputSchema: objectSchema(['url'], ['url']),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  validate(raw) {
    const picked = pickArgs(raw, ['url'], ['url'])
    if (!picked.ok) return picked
    const checked = lpValidateUrl(picked.args.url)
    return checked.ok ? picked : { ok: false, error: checked.reason }
  },
  async run(args, ctx) {
    const res = await call(linkPeekGet, { request: inMemoryRequest('/api/tools/link-peek', { url: args.url }, ctx.request) })
    return fromRoute(res, b => (b.kind === 'html'
      ? `Fetched the page (HTTP ${b.status}, ${b.bytes} bytes${b.hops ? `, after ${b.hops} redirect${b.hops === 1 ? '' : 's'}` : ''}) and extracted its preview tags.`
      : `The URL answered HTTP ${b.status} with ${b.contentType || 'no content type'}, which is not an HTML page, so there are no preview tags.`))
  },
}

const createWebhookBin: McpTool = {
  name: 'create_webhook_bin',
  title: 'Create a webhook bin',
  description: `Mints a fresh, unguessable bin id and returns the URL that captures any request sent to it and the URL that lists what was captured. The bin starts existing at its first request and is forgotten after ${Math.round(WEBHOOK_BIN_TTL_MS / 3_600_000)} hours without traffic. ${limitsLine}`,
  inputSchema: objectSchema([], []),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  validate: raw => pickArgs(raw, [], []),
  async run(_args, ctx) {
    // 128 random bits, hex: the same shape the Webhook Inspector page mints, and
    // far above the 24-character floor the capture route enforces. Nothing is
    // stored here; the bin appears on its first captured request.
    const bin = crypto.randomUUID().replace(/-/g, '')
    const origin = (await ctx.origin()).replace(/\/$/, '')
    const body = {
      ok: true,
      bin,
      captureUrl: `${origin}/api/hook/${bin}`,
      listUrl: `${origin}/api/hook/${bin}/requests`,
      keeps: `the newest ${WEBHOOK_MAX_REQUESTS_PER_BIN} requests, each body up to ${Math.round(WEBHOOK_MAX_BODY_BYTES / 1024)} KB`,
      forgottenAfterIdleHours: Math.round(WEBHOOK_BIN_TTL_MS / 3_600_000),
      note: 'Anyone who knows the bin id can read the bin, so treat it as a secret.',
    }
    return {
      limited: false,
      result: {
        content: [
          { type: 'text', text: 'Created a webhook bin: send any request to captureUrl, then read what arrived from listUrl.' },
          { type: 'text', text: JSON.stringify(body) },
        ],
      },
    }
  },
}

const listWebhookRequests: McpTool = {
  name: 'list_webhook_requests',
  title: 'List the requests a webhook bin captured',
  description: `Returns the requests captured in a bin, newest first, with their method, query, headers and body. A very large listing is cut to the newest requests that fit, and says so. ${limitsLine}`,
  inputSchema: objectSchema(['bin'], ['bin']),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  validate(raw) {
    const picked = pickArgs(raw, ['bin'], ['bin'])
    if (!picked.ok) return picked
    return isValidBinId(picked.args.bin) ? picked : { ok: false, error: `The bin id must be ${PARAMS.bin.schema.minLength} to ${PARAMS.bin.schema.maxLength} letters, digits, hyphens or underscores.` }
  },
  async run(args, ctx) {
    const res = await call(listRequestsGet, {
      params: { bin: args.bin },
      request: inMemoryRequest(`/api/hook/${args.bin}/requests`, {}, ctx.request),
    })
    return fromRoute(
      res,
      b => `The bin holds ${b.count} captured request${b.count === 1 ? '' : 's'}${b.truncated ? `; ${b.returned} of them are shown because the listing is size-limited` : ''}.`,
      b => {
        const all: unknown[] = Array.isArray(b.requests) ? b.requests : []
        const kept: unknown[] = []
        let size = 0
        for (const item of all) {
          size += JSON.stringify(item).length
          if (size > MCP_MAX_BIN_LISTING_CHARS) break
          kept.push(item)
        }
        return { requests: kept, count: all.length, returned: kept.length, truncated: kept.length < all.length }
      },
    )
  },
}

export const MCP_TOOLS: readonly McpTool[] = [inspectTls, inspectDns, peekLink, createWebhookBin, listWebhookRequests]

export type PreparedCall = { ok: true; tool: McpTool; args: Record<string, string> } | { ok: false; kind: 'protocol'; message: string } | { ok: false; kind: 'tool'; message: string }

/**
 * Everything that can be refused without spending a limiter: the params shape,
 * the tool's name, and the arguments. A protocol problem is a JSON-RPC error; a
 * bad argument is a tool error the model can read and correct (2025-11-25).
 */
export function mcpPrepareCall(params: unknown): PreparedCall {
  if (!isPlainObject(params) || typeof params.name !== 'string') return { ok: false, kind: 'protocol', message: 'A tools/call needs a tool name.' }
  const tool = MCP_TOOLS.find(t => t.name === params.name)
  if (!tool) return { ok: false, kind: 'protocol', message: 'There is no tool with that name.' }
  if (params.arguments !== undefined && !isPlainObject(params.arguments)) return { ok: false, kind: 'protocol', message: 'The arguments must be a JSON object.' }
  const checked = tool.validate(params.arguments)
  return checked.ok ? { ok: true, tool, args: checked.args } : { ok: false, kind: 'tool', message: checked.error }
}

export const mcpToolErrorResult = (message: string): McpToolResult => textResult(message, true)

/* ------------------------------------------------------------------ */
/* the methods that are not tool calls                                 */
/* ------------------------------------------------------------------ */

const INSTRUCTIONS = `Five tools: inspect_tls, inspect_dns and peek_link run real checks from this server against public hosts; create_webhook_bin and list_webhook_requests capture and read back HTTP requests. ${limitsLine} A refusal comes back as HTTP 429 with a Retry-After header. Nothing the checks inspect is stored.`

/** initialize, ping, tools/list and an unknown method. `tools/call` is the transport's. */
export function mcpAnswer(id: string | number, method: string, params: unknown): Json {
  if (method === 'initialize') {
    const asked = isPlainObject(params) && typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
    return rpcResult(id, {
      protocolVersion: MCP_SUPPORTED_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: MCP_SERVER_INFO,
      instructions: INSTRUCTIONS,
    })
  }
  if (method === 'ping') return rpcResult(id, {})
  if (method === 'tools/list') {
    return rpcResult(id, {
      tools: MCP_TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })),
    })
  }
  return rpcError(id, RPC_METHOD_NOT_FOUND, 'Method not found.')
}
