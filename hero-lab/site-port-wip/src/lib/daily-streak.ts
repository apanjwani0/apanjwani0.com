/**
 * Cross-game daily PLAY-streaks — the one store the /games hub strip reads.
 *
 * Each daily game calls `recordDailyPlay(slug, day)` at the moment its daily
 * run *finishes* (win or lose — this is a "showed up" streak, deliberately
 * looser than Quintle's internal wins-only `curStreak`, which stays its own
 * number in its own stats panel). The hub's strip (`daily-streak-strip.ts`)
 * reads back through `readDailyStreak` + `currentStreak` and paints a badge.
 *
 * Day identity stays in each game's OWN day-space (Quintle's epoch-offset day,
 * Hue Hunt's epoch-offset day, Type Trial's UTC date converted to a raw UTC
 * day number). The streak arithmetic only needs "consecutive integers", and
 * asking each game for the same day number its gameplay already derives means
 * this module can never disagree with the game about whether today was played.
 *
 * Design rules, same shape as the rest of the codebase:
 * - localStorage keys come from a fixed slug allowlist — a caller cannot mint
 *   store keys (same rule as the interest counter's key bound).
 * - Everything read back from storage is re-validated; corrupt or hand-edited
 *   data degrades to "no streak", never to a crash or a fabricated number.
 * - The arithmetic is pure and exported (`advanceStreak`, `currentStreak`) so
 *   `security:smoke` runs the real thing rather than a screenshot of it.
 * - Counts only, no identity: a day number and two counters per game. Nothing
 *   here leaves the browser.
 */

export const DAILY_SLUGS = ['quintle', 'type-trial', 'hue-hunt'] as const
export type DailySlug = (typeof DAILY_SLUGS)[number]

export interface StreakState {
  /** Day number (in that game's day-space) of the last finished daily. */
  last: number
  /** Consecutive days finished, ending at `last`. */
  streak: number
  /** Longest streak ever recorded. */
  best: number
}

/** A century of dailies — nobody legitimately exceeds this. */
export const MAX_STREAK = 36600
/** Day numbers in every per-game day-space stay far below this. */
export const MAX_DAY = 1_000_000

function isDay(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_DAY
}

/** Re-validate a raw parsed value from storage. Anything off → null. */
export function sanitizeStreak(raw: unknown): StreakState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { last, streak, best } = raw as Record<string, unknown>
  if (!isDay(last)) return null
  if (typeof streak !== 'number' || !Number.isInteger(streak)) return null
  if (typeof best !== 'number' || !Number.isInteger(best)) return null
  if (streak < 1 || streak > MAX_STREAK) return null
  if (best < streak || best > MAX_STREAK) return null
  return { last, streak, best }
}

/**
 * Fold one finished daily into the state. Pure; idempotent for a repeated day
 * (a re-render or a second finish on the same day must not double-count), and
 * a day EARLIER than the recorded one is refused — a clock rolled backwards
 * must not rewrite history.
 */
export function advanceStreak(prev: StreakState | null, day: number): StreakState {
  if (!isDay(day)) return prev ?? { last: 0, streak: 0, best: 0 }
  if (prev && day <= prev.last) return prev
  const streak = prev && day === prev.last + 1 ? Math.min(prev.streak + 1, MAX_STREAK) : 1
  const best = Math.max(streak, prev?.best ?? 0)
  return { last: day, streak, best }
}

/**
 * The streak as of `today`. Alive if the daily was finished today or yesterday
 * (yesterday keeps the nudge visible before today's run); anything older has
 * lapsed and reads 0.
 */
export function currentStreak(state: StreakState | null, today: number): number {
  if (!state || !isDay(today)) return 0
  return state.last === today || state.last === today - 1 ? state.streak : 0
}

/** 'YYYY-MM-DD' (Type Trial's UTC day id) → raw UTC day number, or NaN. */
export function utcDayFromDateString(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NaN
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000)
}

/* ── storage (browser-only; every call degrades silently without it) ── */

function keyFor(slug: DailySlug): string {
  return `daily-streak:v1:${slug}`
}

export function readDailyStreak(slug: DailySlug): StreakState | null {
  if (!(DAILY_SLUGS as readonly string[]).includes(slug)) return null
  try {
    const raw = localStorage.getItem(keyFor(slug))
    return raw ? sanitizeStreak(JSON.parse(raw)) : null
  } catch {
    return null // no storage, private mode, or corrupt JSON — all read as "no streak"
  }
}

export function recordDailyPlay(slug: DailySlug, day: number): void {
  if (!(DAILY_SLUGS as readonly string[]).includes(slug)) return
  if (!Number.isFinite(day)) return
  try {
    const next = advanceStreak(readDailyStreak(slug), day)
    if (next.streak < 1) return // invalid day — nothing to store
    localStorage.setItem(keyFor(slug), JSON.stringify(next))
  } catch {
    /* quota / private mode — a streak is a nicety, never worth throwing for */
  }
}
