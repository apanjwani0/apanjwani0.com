/**
 * Date helpers for the portfolio. Kept tiny and dependency-free so both the blog
 * listing and the blog post page format authored dates the same way.
 */

/**
 * Format an ISO calendar date (`YYYY-MM-DD`) for display, e.g. `Mar 29, 2026`.
 *
 * Parsed and rendered in UTC so the day never drifts by one across time zones
 * (a bare `new Date('2026-03-29')` is midnight UTC, which is the *previous* day
 * in the Americas). The abbreviated month keeps the string compact enough for
 * the mono-styled listing date. Returns the input unchanged if it isn't a plain
 * `YYYY-MM-DD` value, so machine-readable `<time datetime>` attributes and any
 * non-standard config data pass through untouched.
 */
export function formatDisplayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? '').trim())
  if (!m) return iso
  const [, y, mo, d] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
