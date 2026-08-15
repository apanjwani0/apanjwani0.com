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
import { isSameOrigin } from '../../../../lib/security'
import { clearBin, isValidBinId, listRequests } from '../../../../lib/webhook-store'

export const prerender = false

const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }

export const GET: APIRoute = async ({ params, request }) => {
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
  if (!isSameOrigin(request)) return new Response(null, { status: 403 })
  const binId = params.bin
  if (!isValidBinId(binId)) return new Response(null, { status: 404 })
  clearBin(binId)
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
