/**
 * The /games hub daily-streak strip — paints "N-day streak" badges onto the
 * Quintle / Type Trial / Hue Hunt cards from the shared daily-streak store.
 *
 * Client-only progressive enhancement: a visitor with no streaks (or no JS)
 * sees the hub exactly as the server rendered it. Runs inside
 * `astro:page-load` (see AGENTS.md — bundled scripts run once per session, so
 * anything touching the DOM must re-run on in-site navigation) and is
 * idempotent: a repaint updates the existing badge in place rather than
 * stacking duplicates.
 *
 * "Today" per game comes from the SAME modules the games themselves derive
 * their day from (`quintle-daily`, `type-trial-daily`, `hue-hunt-daily`), so
 * the strip and the games cannot disagree about whether a streak is alive.
 *
 * Registration order in games.astro matters mildly: the hub filter registers
 * first and precomputes its card haystacks before this paints, so badge text
 * ("3-day streak") never joins the searchable card text — a filter for
 * "streak" matching every daily card would be noise, not signal.
 */
import {
  DAILY_SLUGS,
  currentStreak,
  readDailyStreak,
  utcDayFromDateString,
  type DailySlug,
} from './daily-streak'
import { quintleDayNumber } from './quintle-daily'
import { hueDayNumber } from './hue-hunt-daily'
import { todayUtcDay } from './type-trial-daily'

/** Each game's "today", in that game's own day-space (see daily-streak.ts). */
const TODAY: Record<DailySlug, () => number> = {
  quintle: () => quintleDayNumber(),
  'type-trial': () => utcDayFromDateString(todayUtcDay()),
  'hue-hunt': () => hueDayNumber(),
}

let registered = false

export function registerDailyStreaks(): void {
  if (registered) return
  registered = true
  document.addEventListener('astro:page-load', paintStreaks)
  paintStreaks()
}

function paintStreaks(): void {
  for (const slug of DAILY_SLUGS) {
    const link = document.querySelector(`[data-type="card-grid"] a[href="/games/${slug}"]`)
    const stats = link?.closest('article')?.querySelector('[data-type="project-stats"]')
    if (!stats) continue
    const n = currentStreak(readDailyStreak(slug), TODAY[slug]())
    let badge = stats.querySelector<HTMLElement>('[data-type="game-badge"][data-streak]')
    if (n < 1) {
      badge?.remove() // a lapsed streak repaints away (e.g. nav back after UTC midnight)
      continue
    }
    if (!badge) {
      badge = document.createElement('span')
      badge.dataset.type = 'game-badge'
      badge.dataset.streak = ''
      // Before the play/soon badge: the personal number leads, the static label follows.
      stats.prepend(badge)
    }
    badge.textContent = `${n}-day streak`
  }
}
