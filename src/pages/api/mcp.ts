/**
 * MCP server: stateless Streamable HTTP, JSON-RPC 2.0 over POST.
 *
 * POST /api/mcp   initialize, notifications/initialized, tools/list, tools/call, ping
 * GET  /api/mcp   405: there is no server-to-client event stream, because there are no sessions
 *
 * It is a front door to the diagnostics the tool pages already call (see
 * `src/lib/mcp.ts` for the tools), and it is held to MORE than a page is, by the
 * owner's decision: tighter limits than the pages, never looser.
 *
 * The order of a `tools/call`, which `scripts/smoke/mcp.mjs` reads out of this
 * file, is:
 *   1. the body is read under a 16 KB cap and parsed;
 *   2. the call is VALIDATED (tool name, argument shapes, the tool's own syntax
 *      check) with no tool limiter spent, so a malformed call costs the caller
 *      none of its three-a-minute allowance;
 *   3. the caller's own bucket, then the shared MCP bucket only once the caller's
 *      says yes (a refused hit still counts, so asking both up front would let
 *      one refused client drain the shared one);
 *   4. the tool, which spends the called route's own per-client and shared
 *      buckets, the very ones a page spends. An agent can therefore never do more
 *      than a page could.
 *
 * Each refusal is counted once, answers HTTP 429 with `Retry-After: 60` and a
 * JSON-RPC error with code -32000 carrying a fixed sentence.
 *
 * No authentication, no key, no allowlist, nothing keyed on a header the caller
 * chooses except the limiter bucket (AGENTS.md). No CORS: a browser page on
 * another origin can neither preflight this route nor read an answer, and a
 * request carrying a foreign Origin is refused outright.
 */
import type { APIRoute } from 'astro'
import { BodyTooLargeError, createRateLimiter, isSameOrigin, rateLimitKey, readLimitedJson } from '../../lib/security'
import { getSite } from '../../lib/config'
import { MCP_LIMITS } from '../../lib/openapi'
import {
  MCP_MAX_BODY_BYTES,
  MCP_SUPPORTED_VERSIONS,
  RPC_INVALID_PARAMS,
  RPC_INVALID_REQUEST,
  RPC_PARSE_ERROR,
  RPC_RATE_LIMITED,
  mcpAnswer,
  mcpParseMessage,
  mcpPrepareCall,
  mcpToolErrorResult,
  rpcError,
  rpcResult,
  type RpcId,
} from '../../lib/mcp'

export const prerender = false

// The caller's own tool-call allowance, across every tool.
const allowCallClient = createRateLimiter(MCP_LIMITS.windowMs, MCP_LIMITS.callsPerClient)
// One bucket for ALL clients: the instance's total tool-call rate through this door.
const allowCallShared = createRateLimiter(MCP_LIMITS.windowMs, MCP_LIMITS.callsShared)
// Everything else a POST costs (parsing, initialize, tools/list, ping, a call that
// fails validation). Per client only, and generous next to a tool call: it bounds
// the work of a flood without spending anyone's tool-call allowance.
const allowOther = createRateLimiter(MCP_LIMITS.windowMs, MCP_LIMITS.otherPerClient)

function reply(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  })
}

function refuse(id: RpcId, message: string): Response {
  return reply(rpcError(id, RPC_RATE_LIMITED, message), 429, { 'Retry-After': '60' })
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!isSameOrigin(request)) return reply(rpcError(null, RPC_INVALID_REQUEST, 'Requests from another origin are not accepted.'), 403)

  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') return reply(rpcError(null, RPC_INVALID_REQUEST, 'Send the request with Content-Type: application/json.'), 415)

  // A later revision of the protocol is announced by this header. This server
  // speaks the ones it lists and says so, rather than guessing at a newer one.
  const announced = request.headers.get('mcp-protocol-version')
  if (announced && !MCP_SUPPORTED_VERSIONS.includes(announced)) {
    return reply(rpcError(null, RPC_INVALID_REQUEST, `Unsupported protocol version. This server speaks ${MCP_SUPPORTED_VERSIONS.join(' and ')}.`), 400)
  }

  const key = rateLimitKey(request)
  if (!allowOther(key)) return refuse(null, `rate limited — give it a minute (${MCP_LIMITS.otherPerClient} requests a minute per client)`)

  let body: unknown
  try {
    body = await readLimitedJson(request, MCP_MAX_BODY_BYTES)
  } catch (err) {
    if (err instanceof BodyTooLargeError) return reply(rpcError(null, RPC_INVALID_REQUEST, `The request body is over ${MCP_MAX_BODY_BYTES / 1024} KB.`), 413)
    return reply(rpcError(null, RPC_PARSE_ERROR, 'The body is not valid JSON.'), 400)
  }

  const message = mcpParseMessage(body)
  if (message.kind === 'invalid') return reply(rpcError(message.id, RPC_INVALID_REQUEST, message.reason), 400)
  // A notification, or a client's reply to a request this server never made,
  // needs no answer.
  if (message.kind === 'notification') return new Response(null, { status: 202, headers: { 'Cache-Control': 'no-store' } })

  if (message.method !== 'tools/call') return reply(mcpAnswer(message.id, message.method, message.params))

  const prepared = mcpPrepareCall(message.params)
  if (!prepared.ok) {
    return prepared.kind === 'protocol'
      ? reply(rpcError(message.id, RPC_INVALID_PARAMS, prepared.message))
      : reply(rpcResult(message.id, mcpToolErrorResult(prepared.message)))
  }

  const allowed = allowCallClient(key) && allowCallShared('global')
  if (!allowed) {
    return refuse(message.id, `rate limited — this server allows ${MCP_LIMITS.callsPerClient} tool calls a minute per client, so give it a minute`)
  }

  let run: Awaited<ReturnType<typeof prepared.tool.run>>
  try {
    run = await prepared.tool.run(prepared.args, { request, origin: async () => (await getSite(locals)).url })
  } catch {
    // The text of an exception is not something to hand a stranger.
    return reply(rpcResult(message.id, mcpToolErrorResult('The check failed unexpectedly — try again in a moment.')))
  }
  if (run.limited) return refuse(message.id, 'rate limited — the tool behind this call is at its own limit, so give it a minute')
  return reply(rpcResult(message.id, run.result))
}

// Every other method, GET included: a stateless server has no stream to open
// and no session to end.
export const ALL: APIRoute = () =>
  reply({ ok: false, error: 'This MCP server is stateless and has no event stream: send JSON-RPC requests with POST.' }, 405, { Allow: 'POST' })
