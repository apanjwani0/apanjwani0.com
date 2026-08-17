/**
 * Type Trial — daily-race leaderboard endpoint.
 *
 * GET  /api/games/type-trial/daily → today's board: { day, count, entries }.
 * POST same URL                    → submit a finished daily run:
 *                                    { day, name, wpm, acc, sec }.
 *
 * Only *today's* (UTC) board is served or writable — the day is derived
 * server-side, so a client can neither backfill history nor race a passage of
 * its own choosing; validation runs against the passage the server derives for
 * that day (src/lib/type-trial-daily.ts is shared with the client for exactly
 * this reason). Same-origin only on POST (the shared isSameOrigin check IS the
 * CSRF control while Astro's global checkOrigin is disabled — see
 * astro.config.mjs), rate-limited per client bucket, body capped small.
 * Responses are never cached (middleware also forces no-store on /api/*).
 */
import type { APIRoute } from 'astro'
import {
  BodyTooLargeError,
  createRateLimiter,
  isSameOrigin,
  rateLimitKey,
  readLimitedJson,
} from '../../../../lib/security'
import { todayUtcDay } from '../../../../lib/type-trial-daily'
import {
  isPlausibleScore,
  listDaily,
  passageLengthFor,
  sanitizeName,
  submitDaily,
} from '../../../../lib/type-trial-leaderboard'

export const prerender = false

const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
/** A finished run takes tens of seconds, so a handful of submissions a minute is
 *  generous for a human and a wall for a script. Reads poll nothing (fetched on
 *  tab open and after submit), so they get a looser ceiling. */
const allowSubmit = createRateLimiter(60_000, 6)
const allowRead = createRateLimiter(60_000, 60)
const MAX_BODY_BYTES = 1_024

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: NO_STORE })
}

export const GET: APIRoute = async ({ request }) => {
  if (!allowRead(rateLimitKey(request))) return json({ error: 'rate_limited' }, 429)
  const day = todayUtcDay()
  const entries = await listDaily(day)
  return json({ day, count: entries.length, entries })
}

export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request)) return json({ error: 'forbidden' }, 403)
  if (!allowSubmit(rateLimitKey(request))) return json({ error: 'rate_limited' }, 429)

  let payload: unknown
  try {
    payload = await readLimitedJson(request, MAX_BODY_BYTES)
  } catch (error) {
    return json({ error: error instanceof BodyTooLargeError ? 'too_large' : 'bad_json' }, 400)
  }
  if (!payload || typeof payload !== 'object') return json({ error: 'bad_request' }, 400)
  const p = payload as Record<string, unknown>

  // The client races the passage for the day IT rendered; if UTC midnight rolled
  // over mid-run the two disagree, and a score for yesterday's text must not land
  // on today's board. 409 tells the client to refresh its passage and re-race.
  const day = todayUtcDay()
  if (p.day !== day) return json({ error: 'day_rolled_over', day }, 409)

  const name = sanitizeName(p.name)
  if (!name) return json({ error: 'bad_name' }, 400)

  const wpm = typeof p.wpm === 'number' ? p.wpm : NaN
  const acc = typeof p.acc === 'number' ? p.acc : NaN
  const secRaw = typeof p.sec === 'number' ? p.sec : NaN
  const sec = Number.isFinite(secRaw) ? Math.round(secRaw * 10) / 10 : NaN
  if (!isPlausibleScore({ wpm, acc, sec }, passageLengthFor(day))) {
    return json({ error: 'implausible' }, 422)
  }

  const result = await submitDaily(day, { name, wpm, acc, sec, at: Date.now() })
  const entries = await listDaily(day)
  return json({
    day,
    // The sanitized name, echoed back: it can differ from what was sent, and the
    // client needs the stored form to find (and highlight) its own row.
    name,
    rank: result.rank,
    keptPrevious: result.keptPrevious,
    count: entries.length,
    entries,
  })
}
