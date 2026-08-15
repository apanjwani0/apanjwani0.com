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
import { clearBin, isValidBinId, listRequests } from '../../../../lib/webhook-store'

export const prerender = false

const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true // non-browser or same-origin navigation
  try {
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}

export const GET: APIRoute = async ({ params }) => {
  const binId = params.bin
  if (!isValidBinId(binId)) {
    return new Response(JSON.stringify({ requests: [], count: 0 }), { status: 200, headers: NO_STORE })
  }
  const requests = listRequests(binId)
  return new Response(JSON.stringify({ requests, count: requests.length }), {
    status: 200,
    headers: NO_STORE,
  })
}

export const DELETE: APIRoute = async ({ params, request }) => {
  if (!sameOrigin(request)) return new Response(null, { status: 403 })
  const binId = params.bin
  if (!isValidBinId(binId)) return new Response(null, { status: 404 })
  clearBin(binId)
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
