/**
 * Hue Hunt — daily-colours leaderboard endpoint.
 *
 * GET  /api/games/hue-hunt/daily → today's board: { day, count, entries }.
 * POST same URL                  → submit a finished daily run:
 *                                  { day, name, guesses: string[5] }.
 *
 * The submission carries NO SCORE. That is the point of the route existing: it
 * re-derives today's five colours from the day (src/lib/hue-hunt-daily.ts, the
 * same module the browser plays against) and re-computes the total itself, so
 * the only numbers on the board are ones this process calculated. A payload
 * cannot claim 500/500; it can only claim five hex strings, and those are worth
 * exactly what they are worth.
 *
 * Note what that removes: Type Trial has to gate a *claimed* wpm against a
 * claimed elapsed time, and AGENTS.md documents how nearly that went wrong,
 * because two free numbers can be moved against each other. Here the payload
 * supplies no number at all, so there is no "other field" to set — the score is a
 * function of (day, guesses), and the day is the server's own.
 *
 * Only *today's* (UTC) board is served or writable, so a client can neither
 * backfill history nor score against a day whose colours it has already seen.
 * Same-origin only on POST (the shared isSameOrigin check IS the CSRF control
 * while Astro's global checkOrigin is disabled — see astro.config.mjs),
 * rate-limited per client bucket with reads and writes on separate limiters,
 * body capped small. Responses are never cached (middleware also forces
 * no-store on /api/*).
 */
import type { APIRoute } from 'astro'
import {
  BodyTooLargeError,
  createRateLimiter,
  isSameOrigin,
  rateLimitKey,
  readLimitedJson,
} from '../../../../lib/security'
import { HUE_DAILY_ROUNDS, hueDayNumber, scoreDailyGuesses } from '../../../../lib/hue-hunt-daily'
import {
  listHueDaily,
  sanitizeName,
  submitHueDaily,
} from '../../../../lib/hue-hunt-leaderboard'

export const prerender = false

const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }

/** A daily run is five typed guesses and takes a minute or two, so a handful of
 *  submissions a minute is generous for a human and a wall for a script. Reads
 *  poll nothing (fetched when the daily tab opens and after a submit), so they
 *  get their own, looser ceiling — one limiter for both would let a burst of
 *  board refreshes lock a player out of submitting. */
const allowSubmit = createRateLimiter(60_000, 6)
const allowRead = createRateLimiter(60_000, 60)

/** Five guesses of at most 7 chars, a 24-char name and JSON punctuation is well
 *  under 200 bytes; the rest is headroom, not permission. */
const MAX_BODY_BYTES = 1_024

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: NO_STORE })
}

export const GET: APIRoute = async ({ request }) => {
  if (!allowRead(rateLimitKey(request))) return json({ error: 'rate_limited' }, 429)
  const day = hueDayNumber()
  const entries = await listHueDaily(day)
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

  // The day is derived here and the claimed one only has to MATCH it. A run
  // played against yesterday's colours must not land on today's board — and,
  // more importantly, a run against a day the player already knows the answers
  // to must not land on any board. 409 tells the client to roll over and replay.
  const day = hueDayNumber()
  if (p.day !== day) return json({ error: 'day_rolled_over', day }, 409)

  const name = sanitizeName(p.name)
  if (!name) return json({ error: 'bad_name' }, 400)

  // THE re-derivation: colours from `day`, score from the guesses, both computed
  // here. Anything that is not exactly HUE_DAILY_ROUNDS parseable hex strings is
  // not a finished run and never becomes a row.
  const scored = scoreDailyGuesses(day, p.guesses)
  if (!scored) return json({ error: 'bad_guesses', rounds: HUE_DAILY_ROUNDS }, 422)

  const result = await submitHueDaily(day, { name, score: scored.total, at: Date.now() })
  const entries = await listHueDaily(day)
  return json({
    day,
    // The sanitized name, echoed back: it can differ from what was sent, and the
    // client needs the stored form to find (and highlight) its own row.
    name,
    // The server's own numbers. The client shows these rather than the ones it
    // computed locally — if the two ever disagreed, the board is the truth and
    // silently rendering the local copy would hide the disagreement.
    score: scored.total,
    scores: scored.scores,
    rank: result.rank,
    keptPrevious: result.keptPrevious,
    count: entries.length,
    entries,
  })
}
