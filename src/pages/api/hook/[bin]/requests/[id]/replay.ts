/**
 * Webhook Inspector — "Resend to URL".
 *
 * POST /api/hook/:bin/requests/:id/replay  with  { "url": "https://…" }
 *
 * Sends one captured request (its method, its headers minus the hop-by-hop and
 * edge-added ones, its exact body bytes) to a public address and returns the
 * status and the first 2 KB of what came back. This makes the ORIGIN open a
 * connection to a stranger's URL, so everything about how is in
 * src/lib/webhook-replay.ts: Link Peek's SSRF guard, the connection pinned to
 * the address it checked, redirects never followed, five seconds, a 64 KB read
 * cap. The target URL is never echoed back, not in an error and not on success.
 *
 * Limits: 6 a minute per client, then 24 a minute shared. The shared bucket is
 * asked only after the client's says yes, so one refused client cannot drain it.
 * A bin id and a request id are both required, and an invalid id is
 * indistinguishable from a missing one.
 */
import type { APIRoute } from 'astro'
import {
  BodyTooLargeError,
  createRateLimiter,
  isSameOrigin,
  rateLimitKey,
  readLimitedJson,
} from '../../../../../../lib/security'
import { LP_MAX_URL_CHARS } from '../../../../../../lib/link-peek-fetch'
import { replayRequest } from '../../../../../../lib/webhook-replay'
import { getRequest, isValidBinId, isValidRequestId } from '../../../../../../lib/webhook-store'

export const prerender = false

const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
const allowReplayClient = createRateLimiter(60_000, 6)
const allowReplayGlobal = createRateLimiter(60_000, 24)

const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...NO_STORE, ...extra } })

export const POST: APIRoute = async ({ params, request }) => {
  if (!(allowReplayClient(rateLimitKey(request)) && allowReplayGlobal('global'))) {
    return reply(429, { ok: false, error: 'rate limited' }, { 'Retry-After': '60' })
  }
  if (!isSameOrigin(request)) return new Response(null, { status: 403 })
  const { bin, id } = params
  if (!isValidBinId(bin) || !isValidRequestId(id)) return reply(404, { ok: false, error: 'not found' })

  let target: unknown
  try {
    // A URL of at most LP_MAX_URL_CHARS inside a small object.
    const body = await readLimitedJson(request, LP_MAX_URL_CHARS * 2 + 256)
    target = body && typeof body === 'object' ? (body as Record<string, unknown>).url : undefined
  } catch (error) {
    if (error instanceof BodyTooLargeError) return reply(413, { ok: false, error: 'That request is too large.' })
    return reply(400, { ok: false, error: 'Send a JSON body like {"url": "https://example.com/hook"}.' })
  }
  if (typeof target !== 'string' || target.length === 0 || target.length > LP_MAX_URL_CHARS) {
    return reply(400, { ok: false, error: 'Send a JSON body like {"url": "https://example.com/hook"}.' })
  }

  const captured = getRequest(bin, id)
  if (!captured) return reply(404, { ok: false, error: 'not found' })

  const result = await replayRequest(captured, target)
  if (result.ok) return reply(200, result)
  const status = result.kind === 'refused' ? 400 : result.kind === 'busy' ? 503 : result.kind === 'timeout' ? 504 : 502
  return reply(status, result, result.kind === 'busy' ? { 'Retry-After': '5' } : {})
}
