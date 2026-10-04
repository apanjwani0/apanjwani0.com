/**
 * Cron Whisperer's preset pages: `/tools/cron-whisperer/<slug>`, one per common
 * schedule, each mounting the real tool preloaded with the expression.
 *
 * The page's sentences are DERIVED, never written per preset: the description
 * is `cwDescribe(cwParse(expr))` and the daylight-saving sentence follows
 * `cwIsFixedTime`, so they can only say what the engine says. A preset is a
 * slug, an expression and a title; add copy here and it is filler (AGENTS.md:
 * SEO support copy is off).
 *
 * No DOM: the route, the site index and `security:smoke` all import it.
 */

import { cwDescribe, cwIsFixedTime, cwParse } from '../components/tools/cron-whisperer/schedule'

export const CRON_WHISPERER_SLUG = 'cron-whisperer'

export interface CronPreset {
  /** URL segment, kebab-case, unique. */
  slug: string
  /** A standard 5-field expression that `cwParse` accepts. */
  expr: string
  /** The page's h1 and link text. */
  title: string
}

export const CRON_PRESETS: CronPreset[] = [
  { slug: 'every-minute', expr: '* * * * *', title: 'Cron every minute' },
  { slug: 'every-5-minutes', expr: '*/5 * * * *', title: 'Cron every 5 minutes' },
  { slug: 'every-10-minutes', expr: '*/10 * * * *', title: 'Cron every 10 minutes' },
  { slug: 'every-15-minutes', expr: '*/15 * * * *', title: 'Cron every 15 minutes' },
  { slug: 'every-30-minutes', expr: '*/30 * * * *', title: 'Cron every 30 minutes' },
  { slug: 'every-hour', expr: '0 * * * *', title: 'Cron every hour' },
  { slug: 'every-2-hours', expr: '0 */2 * * *', title: 'Cron every 2 hours' },
  { slug: 'every-6-hours', expr: '0 */6 * * *', title: 'Cron every 6 hours' },
  { slug: 'midnight-daily', expr: '0 0 * * *', title: 'Cron every day at midnight' },
  { slug: 'daily-at-9am', expr: '0 9 * * *', title: 'Cron every day at 9am' },
  { slug: 'weekdays-at-9am', expr: '0 9 * * 1-5', title: 'Cron weekdays at 9am' },
  { slug: 'every-monday-at-8am', expr: '0 8 * * 1', title: 'Cron every Monday at 8am' },
  { slug: 'every-sunday', expr: '0 0 * * 0', title: 'Cron every Sunday' },
  { slug: 'first-of-the-month', expr: '0 0 1 * *', title: 'Cron on the first of the month' },
]

export function cronPreset(slug: string | undefined): CronPreset | undefined {
  return CRON_PRESETS.find(p => p.slug === slug)
}

export interface CronToolFlags {
  slug: string
  status: string
}

/**
 * The one predicate for whether the preset pages exist: the route, the sitemap
 * and the site index read it. Like Driftfield's, it reads the tool's own entry,
 * so withdrawing Cron Whisperer withdraws its presets with it.
 */
export function isCronWhispererPublic(tools: CronToolFlags[]): boolean {
  return tools.some(t => t.slug === CRON_WHISPERER_SLUG && t.status === 'live')
}

export interface CronPresetCopy {
  /** The engine's plain-English reading of the expression. */
  describe: string
  /** What cron does with this schedule when daylight saving changes. */
  dst: string
}

/** Page copy derived from the engine for one expression. Throws if it does not parse. */
export function cronPresetCopy(expr: string): CronPresetCopy {
  const parsed = cwParse(expr)
  const describe = cwDescribe(parsed)
  const dst = cwIsFixedTime(parsed)
    ? 'This job names one fixed time of day. If daylight saving skips that time when the clocks go forward, cron still runs the job once, right after the change. If the clocks go back and that time comes round twice, cron runs the job only once, not twice.'
    : 'This schedule follows the wall clock. When the clocks go forward, any run that falls inside the skipped hour never happens. When the clocks go back, any run inside the repeated hour happens twice.'
  return { describe, dst }
}
