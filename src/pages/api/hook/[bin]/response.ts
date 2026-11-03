/**
 * Webhook Inspector — a bin's configured response.
 *
 * GET    /api/hook/:bin/response → `{ response }`, the configured response or null.
 * PUT    same URL, `{ status, headers, body, contentType }` → store it with the bin.
 * DELETE same URL → back to the default JSON acknowledgement.
 *
 * Every capture to the bin is then answered with it (`?status`, `?delay` and
 * `?echo` still override per request). It is stored with the bin: it survives a
 * deploy for the same idle window the captures do, and it is counted in the same
 * global byte budget.
 *
 * What a caller may set is deliberately narrow, and `validateBinResponse`
 * (src/lib/webhook-store.ts) is the one place that says so: a final status 200 to
 * 599 (the runtime cannot send 1xx), at most 8 headers of 256 characters from an
 * allowlist (no Set-Cookie, nothing that frames the response or caches it), a body
 * of at most 8 KB, a content type from a safe list (no HTML: this origin would be
 * serving it), and a `Location` only back at the bin itself (never an open redirect). Every refusal is a fixed
 * sentence.
 *
 * Auth is the bin id, as everywhere here. PUT and DELETE are state-changing and
 * Astro's global origin check is off for this directory, so they call
 * isSameOrigin themselves.
 */
import type { APIRoute } from 'astro'
import {
  BodyTooLargeError,
  InvalidJsonError,
  createRateLimiter,
  isSameOrigin,
  rateLimitKey,
  readLimitedJson,
} from '../../../../lib/security'
import {
  clearBinResponse,
  getBinResponse,
  isValidBinId,
  setBinResponse,
  validateBinResponse,
} from '../../../../lib/webhook-store'

export const prerender = false

const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }

/** The request body: an 8 KB body can grow six-fold in JSON escapes, plus headers. */
const MAX_REQUEST_BYTES = 64 * 1024

const allowRead = createRateLimiter(60_000, 120)
// Saving is a human action. Per client first, then a shared bucket asked only
// when the client's said yes.
const allowWriteClient = createRateLimiter(60_000, 20)
const allowWriteGlobal = createRateLimiter(60_000, 300)

const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...NO_STORE, ...extra } })

export const GET: APIRoute = ({ params, request }) => {
  if (!allowRead(rateLimitKey(request))) return reply(429, { error: 'rate limited' }, { 'Retry-After': '60' })
  const binId = params.bin
  if (!isValidBinId(binId)) return reply(200, { response: null })
  return reply(200, { response: getBinResponse(binId) })
}

export const PUT: APIRoute = async ({ params, request }) => {
  if (!(allowWriteClient(rateLimitKey(request)) && allowWriteGlobal('global'))) {
    return reply(429, { error: 'rate limited' }, { 'Retry-After': '60' })
  }
  if (!isSameOrigin(request)) return new Response(null, { status: 403 })
  const binId = params.bin
  if (!isValidBinId(binId)) return reply(404, { error: 'not found' })

  let input: unknown
  try {
    input = await readLimitedJson(request, MAX_REQUEST_BYTES)
  } catch (error) {
    if (error instanceof BodyTooLargeError) return reply(413, { error: 'That request is too large.' })
    if (error instanceof InvalidJsonError) return reply(400, { error: 'The request body must be JSON.' })
    return reply(400, { error: 'The request could not be read.' })
  }

  const checked = validateBinResponse(input, binId)
  if (!checked.ok) return reply(400, { error: checked.error })

  setBinResponse(binId, checked.value)
  return reply(200, { ok: true, response: checked.value })
}

export const DELETE: APIRoute = ({ params, request }) => {
  if (!(allowWriteClient(rateLimitKey(request)) && allowWriteGlobal('global'))) {
    return reply(429, { error: 'rate limited' }, { 'Retry-After': '60' })
  }
  if (!isSameOrigin(request)) return new Response(null, { status: 403 })
  const binId = params.bin
  if (!isValidBinId(binId)) return new Response(null, { status: 404 })
  clearBinResponse(binId)
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
