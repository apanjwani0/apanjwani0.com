/**
 * "Want this sooner?" — vote counter for coming-soon game pages.
 *
 * GET  /api/games/interest?slug=… → { slug, count }
 * POST /api/games/interest         → { slug } in the body, returns the new count.
 *
 * The slug is validated against the set of games the SERVER reads from config
 * and finds enabled-but-not-playable. That check is what bounds the store: the
 * body cannot introduce a key, so the number of distinct counters is at most the
 * number of coming-soon games however much traffic arrives. Accepting the body's
 * slug directly would be the same class of mistake as trusting a client IP —
 * a client-supplied value deciding what the server does with its storage.
 *
 * A slug that IS playable is rejected too, not silently accepted: voting to
 * speed up a game that already shipped is a client bug, and answering 200 would
 * hide it.
 *
 * Same-origin on POST (the shared CSRF control while Astro's global checkOrigin
 * is off — see astro.config.mjs), rate-limited per bucket, body capped small.
 */
import type { APIRoute } from 'astro'
import {
  BodyTooLargeError,
  createRateLimiter,
  isSameOrigin,
  rateLimitKey,
  readLimitedJson,
} from '../../../lib/security'
import { getGames } from '../../../lib/config'
import { isPlayableGame } from '../../../lib/games'
import { addInterest, getInterest } from '../../../lib/interest'

export const prerender = false

const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
/** One press is the entire interaction, so a handful a minute is generous for a
 *  human and a wall for a script. Reads are one per page view. */
const allowVote = createRateLimiter(60_000, 8)
const allowRead = createRateLimiter(60_000, 60)
const MAX_BODY_BYTES = 256

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: NO_STORE })
}

/** The slug, only if config says it names a real coming-soon game. */
async function comingSoonSlug(value: unknown, locals: App.Locals): Promise<string | null> {
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,64}$/.test(value)) return null
  const games = await getGames(locals)
  const game = games.find(g => g.slug === value && g.enabled)
  if (!game || isPlayableGame(game)) return null
  return game.slug
}

export const GET: APIRoute = async ({ request, locals }) => {
  if (!allowRead(rateLimitKey(request))) return json({ error: 'rate_limited' }, 429)
  const slug = await comingSoonSlug(new URL(request.url).searchParams.get('slug'), locals)
  if (!slug) return json({ error: 'unknown_slug' }, 404)
  return json({ slug, count: await getInterest(slug) })
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!isSameOrigin(request)) return json({ error: 'forbidden' }, 403)
  if (!allowVote(rateLimitKey(request))) return json({ error: 'rate_limited' }, 429)

  let payload: unknown
  try {
    payload = await readLimitedJson(request, MAX_BODY_BYTES)
  } catch (error) {
    return json({ error: error instanceof BodyTooLargeError ? 'too_large' : 'bad_json' }, 400)
  }
  if (!payload || typeof payload !== 'object') return json({ error: 'bad_request' }, 400)

  const slug = await comingSoonSlug((payload as Record<string, unknown>).slug, locals)
  if (!slug) return json({ error: 'unknown_slug' }, 404)

  return json({ slug, count: await addInterest(slug) })
}
