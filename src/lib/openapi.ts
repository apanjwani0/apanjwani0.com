/**
 * The public API, described once.
 *
 * `/openapi.json` is generated from this file, and the MCP server's tool input
 * schemas (`src/lib/mcp.ts`) are built from the same `PARAMS`, so a parameter has
 * exactly one description and one schema however it is reached. The document
 * lives outside `/api/` because `robots.txt` disallows that prefix for crawlers.
 *
 * Nothing here is behaviour. The routes enforce; this file describes them, and
 * `scripts/smoke/mcp.mjs` holds the two together: every `searchParams.get('x')`
 * in a route's source must be a parameter of that route here (and the reverse),
 * and every number under `API_LIMITS` must equal the `createRateLimiter(...)`
 * call in the route it describes. The MCP numbers are the exception: they are
 * defined HERE and the MCP route builds its limiters from them.
 */
import { SG_KNOWN_CAS, SG_MAX_INPUT_CHARS } from '../components/tools/dns-sightline/analyze'
import { LP_MAX_URL_CHARS, LP_USER_AGENTS } from './link-peek-fetch'
import { CS_ALLOWED_PORTS, CS_MAX_HOST_CHARS } from './tls-inspect'
import { WEBHOOK_BIN_TTL_MS, WEBHOOK_MAX_BODY_BYTES, WEBHOOK_MAX_REQUESTS_PER_BIN } from './webhook-store'

export const API_WINDOW_SECONDS = 60

/**
 * Per-client and shared allowances of the existing routes, per window. Each pair
 * mirrors a `createRateLimiter` call in the route named beside it; the smoke
 * test compares them to the source, so editing one without the other fails.
 */
export const API_LIMITS = {
  chainsaw: { perClient: 6, global: 24 },
  dnsSightline: { perClient: 4, global: 16 },
  dnsSightlineCaa: { perClient: 12, global: 48 },
  linkPeek: { perClient: 10, global: 40 },
  hookCapture: { perClient: 300 },
  hookList: { perClient: 120 },
} as const

/**
 * The MCP endpoint's own allowances, tighter than the pages' (owner decision
 * D-8). A tool call must pass these FIRST and then the called tool's own buckets
 * above, so an agent can never do more than a page could. The route builds its
 * limiters from this object.
 */
export const MCP_LIMITS = {
  windowMs: API_WINDOW_SECONDS * 1000,
  /** Tool calls per client per window, across every tool. */
  callsPerClient: 3,
  /** Tool calls per window across ALL clients, asked only after the client's own says yes. */
  callsShared: 12,
  /** Everything that is not a tool call (initialize, tools/list, ping, a refused argument) per client. */
  otherPerClient: 60,
} as const

export interface ParamDef {
  description: string
  schema: Record<string, unknown>
}

/** One description and one schema per parameter, reused by OpenAPI and MCP. */
export const PARAMS = {
  target: {
    description: `The host to inspect, optionally with a port: example.com, example.com:8443, or an http(s) URL. Public hosts only. The port must be one that speaks TLS the moment the socket opens (${CS_ALLOWED_PORTS.join(', ')}); the default is 443.`,
    schema: { type: 'string', minLength: 1, maxLength: CS_MAX_HOST_CHARS + 16 },
  },
  name: {
    description: 'The domain name to ask three public resolvers about, for example example.com. A pasted URL is reduced to its host; IP addresses are refused.',
    schema: { type: 'string', minLength: 1, maxLength: SG_MAX_INPUT_CHARS },
  },
  scope: {
    description: '"full" runs the whole inspection (resolver comparison, SPF, DMARC, CAA, MX and CNAME checks). "caa" walks only the CAA policy, which is cheaper and has its own, larger allowance.',
    schema: { type: 'string', enum: ['full', 'caa'], default: 'full' },
  },
  ca: {
    description: 'Optional. A certificate authority identifier to check the CAA policy against, such as letsencrypt.org. An identifier this server does not know is ignored.',
    schema: { type: 'string', enum: SG_KNOWN_CAS.map(c => c.id) },
  },
  url: {
    description: 'The public page to preview, including the scheme, for example https://example.com/article. Only http and https on their default ports; private and internal addresses are refused.',
    schema: { type: 'string', minLength: 1, maxLength: LP_MAX_URL_CHARS },
  },
  ua: {
    description: 'Which crawler the page is fetched as, because sites serve different tags to different bots. The default is "peek".',
    schema: { type: 'string', enum: Object.keys(LP_USER_AGENTS), default: 'peek' },
  },
  kind: {
    description: '"page" (the default) returns the extracted preview tags. "image" returns the page\'s image URL itself as a data URI, up to a size cap.',
    schema: { type: 'string', enum: ['page', 'image'], default: 'page' },
  },
  bin: {
    description: `A bin id: 24 to 64 letters, digits, hyphens or underscores. Knowing the id is the only protection a bin has, so use a long random one. A bin is forgotten after ${Math.round(WEBHOOK_BIN_TTL_MS / 3_600_000)} hours without traffic.`,
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{24,64}$', minLength: 24, maxLength: 64 },
  },
  status: {
    description: 'Respond to the captured request with this HTTP status (200 to 599), to exercise a client\'s error handling. The default is 200.',
    schema: { type: 'integer', minimum: 200, maximum: 599, default: 200 },
  },
  delay: {
    description: 'Wait this many milliseconds (0 to 2000) before responding, to simulate a slow upstream.',
    schema: { type: 'integer', minimum: 0, maximum: 2000, default: 0 },
  },
  echo: {
    description: 'Set to 1 to echo the received body back instead of the JSON acknowledgement. Only a safe set of content types is echoed; anything else comes back as plain text.',
    schema: { type: 'string', enum: ['1'] },
  },
  format: {
    description: '"ndjson" returns the captured requests as newline-delimited JSON, one request per line and oldest first, so a script can read a run top to bottom. Omit it for the JSON list, newest first.',
    schema: { type: 'string', enum: ['ndjson'] },
  },
} as const satisfies Record<string, ParamDef>

export type ParamName = keyof typeof PARAMS

/** The JSON Schema for a tool's input object, built from the shared parameters. */
export function objectSchema(properties: readonly ParamName[], required: readonly ParamName[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(properties.map(p => [p, { ...PARAMS[p].schema, description: PARAMS[p].description }])),
    required: [...required],
    additionalProperties: false,
  }
}

/* ------------------------------------------------------------------ */
/* the document                                                        */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>

function queryParam(name: ParamName, required: boolean): Json {
  return { name, in: 'query', required, description: PARAMS[name].description, schema: PARAMS[name].schema }
}

function pathParam(name: ParamName): Json {
  return { name, in: 'path', required: true, description: PARAMS[name].description, schema: PARAMS[name].schema }
}

function limit(perClient: number, global?: number, extra?: Json): Json {
  return {
    windowSeconds: API_WINDOW_SECONDS,
    perClient,
    ...(global === undefined ? {} : { global }),
    ...extra,
  }
}

const json = (ref: string) => ({ 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } })

const standardErrors: Json = {
  '400': { $ref: '#/components/responses/BadRequest' },
  '429': { $ref: '#/components/responses/RateLimited' },
  '500': { $ref: '#/components/responses/Unexpected' },
}

export function buildOpenApi(origin: string): Json {
  const base = origin.replace(/\/$/, '')
  const toolMcp = `${MCP_LIMITS.callsPerClient} tool calls a minute per client and ${MCP_LIMITS.callsShared} a minute in total, then the called tool's own limits below`
  return {
    openapi: '3.1.0',
    info: {
      title: 'apanjwani0.com public API',
      version: '1.0.0',
      summary: 'Three diagnostics, a webhook capture endpoint and an MCP server, all unauthenticated and rate limited.',
      description: [
        'Everything here is public and needs no key. Each route is rate limited per client and again across all clients, and a refused request answers 429 with a Retry-After header.',
        'The diagnostics are the same routes the tool pages call, so using them spends the same budget a visitor on the page would. The MCP endpoint is tighter than the pages on purpose, and a call through it also spends the budget of the tool it reaches.',
        'Nothing the diagnostics inspect is stored. Webhook captures are held in memory and forgotten after six hours without traffic.',
      ].join(' '),
      contact: { name: 'Security and API questions', email: 'apanjwani0@gmail.com', url: `${base}/.well-known/security.txt` },
    },
    servers: [{ url: base }],
    tags: [
      { name: 'diagnostics', description: 'Server-side checks a browser cannot make for itself.' },
      { name: 'webhooks', description: 'Capture real requests against a bin and read them back.' },
      { name: 'agents', description: 'The Model Context Protocol endpoint.' },
    ],
    paths: {
      '/api/tools/chainsaw': {
        get: {
          operationId: 'inspectTls',
          tags: ['diagnostics'],
          summary: 'Read the TLS certificate chain a server really sends',
          description: 'Opens two TLS handshakes from this server to the host, pinned to the address that was checked, and reports the handshake and the certificates that crossed the wire. Nothing is stored.',
          parameters: [queryParam('target', true)],
          responses: {
            '200': { description: 'The inspection report, or ok:false with a sentence saying why the host could not be inspected.', content: json('ChainsawResult') },
            ...standardErrors,
          },
          'x-rate-limit': limit(API_LIMITS.chainsaw.perClient, API_LIMITS.chainsaw.global),
        },
      },
      '/api/tools/dns-sightline': {
        get: {
          operationId: 'inspectDns',
          tags: ['diagnostics'],
          summary: 'Ask three public resolvers the same questions and compare the answers',
          description: 'Queries Cloudflare, Google and Quad9 over DNS-over-HTTPS and returns the answers side by side with findings on SPF, DMARC, CAA, MX and CNAME. The name you send never becomes a destination. Nothing is stored.',
          parameters: [queryParam('name', true), queryParam('scope', false), queryParam('ca', false)],
          responses: {
            '200': { description: 'The inspection report.', content: json('DnsResult') },
            ...standardErrors,
          },
          'x-rate-limit': limit(API_LIMITS.dnsSightline.perClient, API_LIMITS.dnsSightline.global, {
            scopeCaa: limit(API_LIMITS.dnsSightlineCaa.perClient, API_LIMITS.dnsSightlineCaa.global),
          }),
        },
      },
      '/api/tools/link-peek': {
        get: {
          operationId: 'peekLink',
          tags: ['diagnostics'],
          summary: 'Fetch a public page and return the link-preview tags it carries',
          description: 'Fetches the page once from this server as the crawler you pick, following at most four redirects and re-checking every hop, and returns the Open Graph, Twitter card and basic meta tags. The connection is pinned to the address that was checked. Nothing is stored.',
          parameters: [queryParam('url', true), queryParam('ua', false), queryParam('kind', false)],
          responses: {
            '200': { description: 'The extracted preview tags, a note that the URL is not HTML, or ok:false with a sentence saying why it could not be fetched.', content: json('LinkPeekResult') },
            ...standardErrors,
          },
          'x-rate-limit': limit(API_LIMITS.linkPeek.perClient, API_LIMITS.linkPeek.global),
        },
      },
      '/api/hook/{bin}': {
        post: {
          operationId: 'captureWebhook',
          tags: ['webhooks'],
          summary: 'Record a request against a bin',
          description: `Accepts a request of any method (POST is shown) with up to ${Math.round(WEBHOOK_MAX_BODY_BYTES / 1024)} KB of body, records it against the bin and answers with a JSON acknowledgement. A bin keeps its newest ${WEBHOOK_MAX_REQUESTS_PER_BIN} requests. CORS is open on this route, because it is meant to be called from anywhere.`,
          parameters: [pathParam('bin'), queryParam('status', false), queryParam('delay', false), queryParam('echo', false)],
          requestBody: { required: false, content: { '*/*': { schema: {} } } },
          responses: {
            '200': { description: 'Captured. The status can be changed with the status parameter.', content: json('CaptureAck') },
            '404': { description: 'The bin id is shorter than 24 characters or uses other characters.', content: json('Error') },
            '429': { $ref: '#/components/responses/RateLimited' },
          },
          'x-rate-limit': limit(API_LIMITS.hookCapture.perClient),
        },
      },
      '/api/hook/{bin}/requests': {
        get: {
          operationId: 'listWebhookRequests',
          tags: ['webhooks'],
          summary: 'List the requests captured in a bin, newest first',
          description: 'Answers 304 when the ETag still matches. An unknown bin answers an empty list, so the response does not say whether a bin exists.',
          parameters: [pathParam('bin'), queryParam('format', false)],
          responses: {
            '200': {
              description: 'The captured requests: JSON by default, or application/x-ndjson with format=ndjson.',
              content: { ...json('CapturedRequests'), 'application/x-ndjson': { schema: { type: 'string' } } },
            },
            '400': { description: 'An unknown format value.', content: json('ErrorOnly') },
            '304': { description: 'Unchanged since the ETag you sent.' },
            '429': {
              description: 'Rate limited. This route answers {"error"} without an "ok" field.',
              headers: { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } },
              content: json('ErrorOnly'),
            },
          },
          'x-rate-limit': limit(API_LIMITS.hookList.perClient),
        },
      },
      '/api/mcp': {
        post: {
          operationId: 'mcp',
          tags: ['agents'],
          summary: 'Model Context Protocol server (stateless Streamable HTTP)',
          description: [
            'JSON-RPC 2.0 over POST. Supported methods: initialize, notifications/initialized, tools/list, tools/call and ping; anything else answers -32601.',
            'Tools: inspect_tls, inspect_dns, peek_link, create_webhook_bin, list_webhook_requests. There are no sessions, no server-sent event stream and no authentication. A GET answers 405.',
            'The request body is capped at 16 KB and must be application/json.',
            `Limits are tighter than the pages': ${toolMcp}. A refusal answers HTTP 429 with Retry-After and a JSON-RPC error with code -32000.`,
          ].join(' '),
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonRpcRequest' } } } },
          responses: {
            '200': { description: 'A JSON-RPC response (result or error).', content: json('JsonRpcResponse') },
            '202': { description: 'A notification was accepted. No body.' },
            '400': { description: 'Not valid JSON-RPC.', content: json('JsonRpcResponse') },
            '413': { description: 'The body is over 16 KB.', content: json('JsonRpcResponse') },
            '415': { description: 'The Content-Type is not application/json.', content: json('JsonRpcResponse') },
            '429': {
              description: 'Rate limited, with JSON-RPC error code -32000.',
              headers: { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } },
              content: json('JsonRpcResponse'),
            },
          },
          'x-rate-limit': {
            windowSeconds: MCP_LIMITS.windowMs / 1000,
            toolCallsPerClient: MCP_LIMITS.callsPerClient,
            toolCallsShared: MCP_LIMITS.callsShared,
            otherMethodsPerClient: MCP_LIMITS.otherPerClient,
            thenTheCalledToolsOwnLimits: true,
          },
        },
        get: {
          operationId: 'mcpStream',
          tags: ['agents'],
          summary: 'Not supported',
          description: 'This server is stateless and has no event stream, so a GET answers 405 with an Allow: POST header.',
          responses: { '405': { description: 'Method not allowed.', content: json('Error') } },
        },
      },
    },
    components: {
      headers: {
        RetryAfter: { description: 'Seconds to wait before trying again.', schema: { type: 'integer', example: API_WINDOW_SECONDS } },
      },
      responses: {
        BadRequest: { description: 'A missing, oversized or malformed parameter. Refused before any rate-limit budget is spent.', content: json('Error') },
        RateLimited: {
          description: 'Rate limited. Wait for Retry-After seconds.',
          headers: { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } },
          content: json('Error'),
        },
        Unexpected: { description: 'An unexpected failure. The body is a fixed sentence, never the exception text.', content: json('Error') },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['ok', 'error'],
          properties: { ok: { const: false }, error: { type: 'string' } },
        },
        ErrorOnly: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
        ChainsawResult: {
          oneOf: [
            { $ref: '#/components/schemas/Error' },
            {
              type: 'object',
              required: ['ok', 'report'],
              properties: {
                ok: { const: true },
                report: {
                  type: 'object',
                  description: 'host, port, address and family dialled; the negotiated handshake; the presented certificates (leaf first, with PEM); whether an anchor was sent; the store root that completed the path; and the elapsed time.',
                  properties: {
                    host: { type: 'string' },
                    port: { type: 'integer' },
                    address: { type: 'string' },
                    family: { type: 'integer', enum: [4, 6] },
                    handshake: { type: 'object' },
                    presented: { type: 'array', items: { type: 'object' } },
                    anchorIncluded: { type: 'boolean' },
                    presentedObserved: { type: 'boolean' },
                    elapsedMs: { type: 'integer' },
                  },
                },
              },
            },
          ],
        },
        DnsResult: {
          oneOf: [
            { $ref: '#/components/schemas/Error' },
            {
              type: 'object',
              required: ['ok', 'scope', 'report'],
              properties: {
                ok: { const: true },
                scope: { type: 'string', enum: ['full', 'caa'] },
                budget: { type: 'integer', description: 'The query ceiling of a caa-scope run.' },
                report: { type: 'object', description: 'The answers per resolver and record type, the resolver diffs, the SPF, DMARC, CAA, MX and CNAME reports, the findings with the records they cite, the query count and the elapsed time.' },
              },
            },
          ],
        },
        LinkPeekResult: {
          oneOf: [
            { $ref: '#/components/schemas/Error' },
            {
              type: 'object',
              required: ['ok', 'kind'],
              properties: {
                ok: { const: true },
                kind: { type: 'string', enum: ['html', 'non-html'] },
                finalUrl: { type: 'string' },
                status: { type: 'integer' },
                contentType: { type: 'string' },
                bytes: { type: 'integer' },
                hops: { type: 'integer' },
                meta: { type: 'object', description: 'The title, description, canonical URL and the Open Graph and Twitter tags found (kind html only).' },
                dataUri: { type: 'string', description: 'With kind=image: the image as a data URI.' },
              },
            },
          ],
        },
        CaptureAck: {
          type: 'object',
          required: ['ok', 'captured', 'method', 'bin'],
          properties: { ok: { const: true }, captured: { const: true }, method: { type: 'string' }, bin: { type: 'string' } },
        },
        CapturedRequests: {
          type: 'object',
          required: ['requests', 'count'],
          properties: {
            count: { type: 'integer' },
            requests: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  method: { type: 'string' },
                  query: { type: 'string' },
                  headers: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } } } },
                  contentType: { type: ['string', 'null'] },
                  bodyText: { type: 'string' },
                  bodyBase64: { type: 'string', description: 'Present when the body is not valid UTF-8: the exact bytes, base64-encoded.' },
                  bodyTruncated: { type: 'boolean' },
                  size: { type: 'integer' },
                  receivedAt: { type: 'integer', description: 'Milliseconds since the Unix epoch.' },
                },
              },
            },
          },
        },
        JsonRpcRequest: {
          type: 'object',
          required: ['jsonrpc', 'method'],
          properties: {
            jsonrpc: { const: '2.0' },
            id: { type: ['string', 'integer', 'null'], description: 'Omit for a notification.' },
            method: { type: 'string', enum: ['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'ping'] },
            params: { type: 'object' },
          },
        },
        JsonRpcResponse: {
          type: 'object',
          required: ['jsonrpc'],
          properties: {
            jsonrpc: { const: '2.0' },
            id: { type: ['string', 'integer', 'null'] },
            result: { type: 'object' },
            error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'integer' }, message: { type: 'string' } } },
          },
        },
      },
    },
  }
}
