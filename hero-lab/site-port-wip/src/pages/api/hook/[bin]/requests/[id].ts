/**
 * Webhook Inspector — single-request share endpoint.
 *
 * GET /api/hook/:bin/requests/:id → one captured request as JSON; 404 when the
 * bin or the request is gone (expired, cleared, or trimmed at the per-bin cap).
 *
 * This is what a share permalink resolves. The tool page mints links of the form
 * /tools/webhook-inspector#share=<bin>.<id> — the address rides in the URL
 * FRAGMENT, which browsers never send to any server, so bin ids stay out of
 * access logs and Referer headers — and whoever opens one fetches this route to
 * render that request read-only.
 *
 * Auth model is the same as the list endpoint: knowing the bin id is the whole
 * control. A share link therefore necessarily grants the entire bin, and the
 * tool says so where links are minted rather than pretending otherwise.
 *
 * Both path params are validated BEFORE the store is touched — the bin id
 * against the 24-char unguessability floor, the request id against shape
 * hygiene — and an invalid id is indistinguishable from a missing one (404
 * either way), so the response never confirms which half was wrong.
 */
import type { APIRoute } from 'astro'
import { createRateLimiter, rateLimitKey } from '../../../../../lib/security'
import { getRequest, isValidBinId, isValidRequestId } from '../../../../../lib/webhook-store'

export const prerender = false

const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }

// Shares are opened by humans following a link, not polled — 60/min per client
// is generous. Counted before validation so rejected probes spend it too.
const allowShareRead = createRateLimiter(60_000, 60)

export const GET: APIRoute = async ({ params, request }) => {
  if (!allowShareRead(rateLimitKey(request))) {
    return new Response(JSON.stringify({ error: 'rate limited' }), {
      status: 429,
      headers: { ...NO_STORE, 'Retry-After': '60' },
    })
  }
  const { bin, id } = params
  if (!isValidBinId(bin) || !isValidRequestId(id)) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: NO_STORE })
  }
  const captured = getRequest(bin, id)
  if (!captured) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: NO_STORE })
  }
  return new Response(JSON.stringify({ request: captured }), { status: 200, headers: NO_STORE })
}
