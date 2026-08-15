/**
 * Webhook Inspector — capture endpoint.
 *
 * `/api/hook/:bin` accepts a request of ANY method and records it against the
 * bin so the tool page can play it back. This is the "owns a URL other software
 * talks to" half of the tool: point a webhook sender, a curl one-liner, or a
 * client-under-test at this URL and watch the request arrive.
 *
 * Debugging-loop knobs (query params on the capture URL):
 *   ?status=NNN  — respond with that status (200–599), for exercising a client's
 *                  error/retry handling.
 *   ?delay=MS    — wait before responding (0–2000ms), to simulate a slow upstream.
 *   ?echo=1      — echo the received body back with its Content-Type, instead of
 *                  the default JSON acknowledgement.
 *
 * CORS is permissive so the endpoint is also usable from a browser fetch on any
 * origin (server-to-server webhooks ignore CORS entirely).
 */
import type { APIRoute } from 'astro'
import { createRateLimiter, rateLimitKey } from '../../../lib/security'
import {
  isValidBinId,
  recordRequest,
  WEBHOOK_MAX_BODY_BYTES,
  type CapturedHeader,
} from '../../../lib/webhook-store'

export const prerender = false

// Public and unauthenticated by design — anyone on the internet can POST here.
// Deliberately generous: this endpoint exists to absorb bursts from real webhook
// senders and load-testing clients, so the cap is set to stop a flood rather than
// to police normal use.
const allowCapture = createRateLimiter(60_000, 300)

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
}

function baseHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'Cache-Control': 'no-store', ...CORS_HEADERS, ...extra }
}

/** Read up to maxBytes of the body as UTF-8 text; report if it was truncated. */
async function readLimitedText(
  request: Request,
  maxBytes: number,
): Promise<{ text: string; size: number; truncated: boolean }> {
  const reader = request.body?.getReader()
  if (!reader) return { text: '', size: 0, truncated: false }

  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size <= maxBytes) {
      chunks.push(value)
    } else {
      // Keep only what fits, note the overflow, and stop pulling.
      const room = maxBytes - (size - value.byteLength)
      if (room > 0) chunks.push(value.subarray(0, room))
      truncated = true
      await reader.cancel()
      break
    }
  }

  const kept = chunks.reduce((n, c) => n + c.byteLength, 0)
  const bytes = new Uint8Array(kept)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.byteLength
  }
  return { text: new TextDecoder().decode(bytes), size, truncated }
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  // All-digits only: parseInt would silently accept prefixes ('204abc' → 204,
  // '1e3' → 1) and a status knob that lies about what it parsed is worse than
  // one that falls back.
  if (raw === null || !/^\d+$/.test(raw)) return fallback
  const n = Number.parseInt(raw, 10)
  return Math.min(max, Math.max(min, n))
}

export const ALL: APIRoute = async ({ params, request }) => {
  const binId = params.bin
  if (!isValidBinId(binId)) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid bin id' }), {
      status: 404,
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
    })
  }

  const url = new URL(request.url)

  // Preflight: answer and record nothing (browsers send this automatically).
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: baseHeaders() })
  }

  // Checked before the body is read so a flood costs no allocation.
  if (!allowCapture(rateLimitKey(request))) {
    return new Response(JSON.stringify({ ok: false, error: 'rate limited' }), {
      status: 429,
      headers: baseHeaders({ 'Content-Type': 'application/json', 'Retry-After': '60' }),
    })
  }

  let { text, size, truncated } = await readLimitedText(request, WEBHOOK_MAX_BODY_BYTES)
  if (truncated) {
    // The limited read stops counting at cancel, so `size` is only bytes-seen.
    // Trust Content-Length for the real pre-truncation size when it says more.
    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > size) size = declared
  }

  const headers: CapturedHeader[] = []
  request.headers.forEach((value, name) => {
    // Never store the origin-lock secret: the Cloudflare Transform Rule injects
    // x-origin-auth into every proxied request, and replaying it in the bin UI
    // would hand the bypass token to anyone who sends themselves a test request.
    if (name === 'x-origin-auth') return
    headers.push({ name, value })
  })

  recordRequest(binId, {
    id: crypto.randomUUID(),
    method: request.method,
    query: url.search.replace(/^\?/, ''),
    headers,
    contentType: request.headers.get('content-type'),
    source: request.headers.get('cf-connecting-ip'),
    bodyText: text,
    bodyTruncated: truncated,
    size,
    receivedAt: Date.now(),
  })

  const status = clampInt(url.searchParams.get('status'), 200, 599, 200)
  // Capped at 2s, not 8s. Every in-flight delay pins a socket and its captured
  // body in memory on a single 1 GB Node process, so an anonymous caller could
  // otherwise buy 8 seconds of resident connection per request and exhaust the
  // origin cheaply. 2s is still long enough to exercise a client's timeout and
  // retry handling, which is what the knob is for.
  const delay = clampInt(url.searchParams.get('delay'), 0, 2000, 0)
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))

  // 204/205/304 forbid a body — the Response constructor throws on one (even
  // an empty string), which would turn the tool's own advertised input into a 500.
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status, headers: baseHeaders() })
  }

  // Echo mode replays the body back to the caller for round-trip testing.
  if (url.searchParams.get('echo') === '1') {
    return new Response(text, {
      status,
      headers: baseHeaders({
        'Content-Type': request.headers.get('content-type') ?? 'text/plain; charset=utf-8',
      }),
    })
  }

  return new Response(
    JSON.stringify({ ok: true, captured: true, method: request.method, bin: binId }),
    { status, headers: baseHeaders({ 'Content-Type': 'application/json' }) },
  )
}
