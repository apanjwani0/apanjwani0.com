/**
 * Type Trial — shared daily-race passage logic.
 *
 * Imported by BOTH the client component (TypeTrial.ts) and the server API route
 * (/api/games/type-trial/daily), so the two always agree on what "today's
 * passage" is. That agreement is the security model's foundation: the server
 * validates a submitted score against the passage IT derives for the day, so a
 * client cannot claim a score against a shorter text of its own choosing.
 *
 * Pure and dependency-free on purpose — no Node imports, no DOM — so it bundles
 * into the browser chunk and imports into an SSR route equally well.
 *
 * The day boundary is UTC everywhere. That makes the race global (everyone on
 * Earth types the same text on the same UTC date) and keeps client and server
 * clocks trivially comparable; the small cost is that "midnight" is not local
 * midnight, which the UI copy states plainly.
 */

/**
 * Daily passage pool — original aphorisms, ASCII-only (a typing race with curly
 * quotes or em-dashes punishes keyboards that cannot type them), each roughly
 * 70-100 characters so every day's race is a comparable length.
 */
export const DAILY_TEXTS: readonly string[] = [
  'Ship the small version today; the grand version is where good projects go to stall.',
  'A habit is a vote for the person you are becoming, cast quietly every single day.',
  'Read the error message twice before you blame the machine; it is usually confessing.',
  'The fastest code is the code that never runs, and the best meeting is the one skipped.',
  'Write it down. The faintest ink on a sticky note outlasts the sharpest memory.',
  'Every system grows until it surprises its author; good ones surprise them gently.',
  'You do not rise to the level of your goals, you fall to the level of your tools.',
  'A deadline is a rumor until the week it arrives, and then it is the only fact.',
  'Practice does not make perfect; practice makes permanent, so practice carefully.',
  'The second draft is where the writing happens; the first is just the digging.',
  'Name things for what they do, not what they were, and half your bugs evaporate.',
  'Momentum is a moral force: starting badly beats planning perfectly almost always.',
  'The backlog never empties; it only ranks. Choose the top item and let the rest wait.',
  'Trust is built in drops and lost in buckets, in software as much as in people.',
  'A good abstraction is discovered in the third use, never designed in the first.',
  'Speed comes from calm hands and a quiet mind, not from hurrying your fingers.',
  'Delete the sentence you are proudest of and see if the paragraph even notices.',
  'When in doubt, make the change easy first, and then make the easy change.',
  'The bug is never where you are looking, which is exactly why you are still looking.',
  'Small daily improvements are invisible for weeks and then suddenly undeniable.',
  'Leave the campsite cleaner than you found it, especially when the campsite is code.',
  'An estimate is a guess wearing a tie; treat it with the respect a guess deserves.',
  'Perfect is a direction, not a place, and shipping is how you take a step.',
  'The keyboard rewards rhythm over rush: find the tempo where mistakes stop happening.',
]

/** UTC calendar day, YYYY-MM-DD — the id of a daily race. */
export function todayUtcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidDay(value: unknown): value is string {
  return typeof value === 'string' && DAY_RE.test(value)
}

/** FNV-1a over the day string — tiny, stable, and identical in every runtime.
 *  (Math.random-free: the whole point is that everyone computes the same pick.) */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** The one passage everyone races on a given UTC day. */
export function dailyPassage(day: string): string {
  return DAILY_TEXTS[fnv1a(day) % DAILY_TEXTS.length]
}

/** Milliseconds until the next UTC midnight — the daily reset countdown. */
export function msUntilUtcMidnight(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return next - now.getTime()
}
