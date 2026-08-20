/**
 * Webhook Inspector — playback endpoint.
 *
 * GET  /api/hook/:bin/requests  → the requests captured in that bin, newest
 *                                 first, as JSON. The tool page polls this.
 * DELETE same URL               → clear the bin's captured requests.
 *
 * Same-origin only: the tool page fetches this under `connect-src 'self'`; the
 * bin id is an unguessable client-generated token, so there is no auth beyond
 * knowing the id (matching webhook.cool's model). Responses are never cached.
 */
import type { APIRoute } from 'astro'
import { createRateLimiter, isSameOrigin, rateLimitKey } from '../../../../lib/security'
import { clearBin, isValidBinId, listRequests } from '../../../../lib/webhook-store'

export const prerender = false

const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }

// Both verbs here are public and were unbounded — the only endpoints in this
// directory that were, while `[bin].ts` and `requests/[id].ts` both limit. The
// ETag below makes an unchanged poll cheap but not free, and it does nothing at
// all for a caller who never sends `if-none-match`: listRequests + JSON.stringify
// over a bin at its cap still runs per request. AGENTS.md: every public endpoint
// uses createRateLimiter, no exceptions.
//
// The tool page polls every 2s = 30/min, so 120 leaves room for a few tabs on one
// address. Clears are a human action, so they get far less.
const allowPlayback = createRateLimiter(60_000, 120)
const allowClear = createRateLimiter(60_000, 20)

const TOO_MANY = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 429, headers: { ...NO_STORE, 'Retry-After': '60' } })

export const GET: APIRoute = async ({ params, request }) => {
  // Counted before validation, so probing with junk bin ids spends the budget too.
  if (!allowPlayback(rateLimitKey(request))) return TOO_MANY({ error: 'rate limited' })
  const binId = params.bin
  if (!isValidBinId(binId)) {
    return new Response(JSON.stringify({ requests: [], count: 0 }), { status: 200, headers: NO_STORE })
  }
  const requests = listRequests(binId)
  // Change detector for the 2s poll: count + newest id covers append, trim-at-cap
  // and clear, so an unchanged bin costs a 304 instead of reserializing every body.
  const etag = `"${requests.length}-${requests[0]?.id ?? 'empty'}"`
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { 'Cache-Control': 'no-store', ETag: etag } })
  }
  return new Response(JSON.stringify({ requests, count: requests.length }), {
    status: 200,
    headers: { ...NO_STORE, ETag: etag },
  })
}

export const DELETE: APIRoute = async ({ params, request }) => {
  if (!allowClear(rateLimitKey(request))) return TOO_MANY({ error: 'rate limited' })
  if (!isSameOrigin(request)) return new Response(null, { status: 403 })
  const binId = params.bin
  if (!isValidBinId(binId)) return new Response(null, { status: 404 })
  clearBin(binId)
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
