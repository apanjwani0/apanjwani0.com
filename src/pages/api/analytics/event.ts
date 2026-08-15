import type { APIRoute } from 'astro'
import { getGames, getTools } from '../../../lib/config'
import { normalizeAnalyticsEvent, recordAnalyticsEvent } from '../../../lib/analytics'
import {
  BodyTooLargeError,
  createRateLimiter,
  isSameOrigin,
  rateLimitKey,
  readLimitedJson,
} from '../../../lib/security'

export const prerender = false

// Unauthenticated and side-effecting: every accepted event read-modify-writes the
// whole rollup file (or a KV key), so without a cap any anonymous caller could
// loop this and saturate the origin's disk while filling the dashboard with junk.
// 60/min is far above what a real visitor produces — the beacon fires roughly
// once per page view — and far below what abuse needs.
const allowEvent = createRateLimiter(60_000, 60)

export const POST: APIRoute = async ({ request, locals }) => {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 })
  if (!allowEvent(rateLimitKey(request))) return new Response(null, { status: 429 })

  let event
  try {
    event = normalizeAnalyticsEvent(await readLimitedJson(request, 8_192))
  } catch (error) {
    return new Response(null, { status: error instanceof BodyTooLargeError ? 413 : 400 })
  }

  if (!event) return new Response(null, { status: 400 })

  const knownItems = event.kind === 'tool' ? await getTools(locals) : await getGames(locals)
  if (!knownItems.some(item => item.slug === event.slug)) return new Response(null, { status: 400 })

  await recordAnalyticsEvent(locals, event)
  return new Response(null, { status: 204 })
}
