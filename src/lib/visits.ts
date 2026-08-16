/**
 * Server-side page-view rollups.
 *
 * The client beacon in analytics-client.ts only fires on tool/game pages, only
 * when JS runs, and is blocked by most content blockers. This counts every SSR
 * HTML render instead — no client code, nothing to block. One honest caveat:
 * the Cloudflare edge cache sits in front, and an edge HIT never reaches the
 * origin, so these are *origin renders* (cache misses), not raw page views.
 * Popular pages undercount toward one hit per colo per TTL window; treat the
 * numbers as per-path shape, not absolute traffic. Cloudflare's dashboard has
 * the absolute totals.
 *
 * WHAT IS STORED, DELIBERATELY: date, path, country, referrer host, and whether
 * the request looked automated. Counts only.
 *
 * WHAT IS NOT STORED, DELIBERATELY: IP addresses, user agents, session or visitor
 * identifiers, full referrer URLs (query strings leak search terms and tokens),
 * or anything that could re-identify a person. An IP is personal data under GDPR
 * the moment it is retained; aggregate counts are not, so this stays on the safe
 * side of that line and needs no consent banner. Cloudflare's own dashboard
 * already reports unique visitors and per-country traffic — this exists for the
 * per-path breakdown Cloudflare's free tier does not give.
 *
 * Writes are buffered in memory and flushed on a timer: the previous per-event
 * read-modify-write of the whole JSON file meant any anonymous visitor could
 * drive unbounded disk I/O just by reloading. Buffering also makes this safe to
 * call from middleware on the hot path.
 *
 * Node-only (module state + a timer). On Workers, where isolates neither share
 * memory nor outlive a request, this would need Durable Objects or Analytics Engine.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FLUSH_MS = 30_000
const RETENTION_DAYS = 90
/** Backstops. Paths are only recorded for 200s (so they are bounded by the real
 *  route count), but a bad deploy could 200 on junk — these keep the file finite
 *  regardless of what the internet sends. */
const MAX_PATHS_PER_DAY = 400
const MAX_REFERRERS_PER_PATH = 40
/** Hard ceiling on the serialized file. The per-day caps bound each day, but 90
 *  retained days of cap-sized rows would still be re-read and re-written every
 *  flush on a 1 GB host — over this, the oldest days are dropped first. */
const MAX_STORE_BYTES = 4 * 1024 * 1024

export interface VisitRow {
  views: number
  /** Automated traffic, counted separately so it never pollutes the human numbers. */
  bots: number
  /** ISO 3166-1 alpha-2, from Cloudflare's cf-ipcountry. 'XX' when unknown. */
  countries: Record<string, number>
  /** Referrer *host* only — never the full URL. */
  referrers: Record<string, number>
}

/** date -> path -> row */
type VisitStore = Record<string, Record<string, VisitRow>>

const pending: VisitStore = {}
let flushTimer: ReturnType<typeof setTimeout> | null = null

function visitsPath(): string {
  return join(process.cwd(), 'data', 'visits.json')
}

/** Conservative substring match — enough to keep crawler noise out of the human
 *  counts without pretending to be bot detection. Cloudflare does the real thing. */
const BOT_RE = /bot|crawl|spider|slurp|bingpreview|headless|curl|wget|python-requests|axios|go-http|java\/|scrapy|facebookexternalhit|whatsapp|telegram|preview|monitor|uptime|semrush|ahrefs|mj12|dotbot|petalbot|gptbot|claudebot|ccbot/i

export function looksAutomated(userAgent: string | null): boolean {
  if (!userAgent) return true // no UA at all is not a browser
  return BOT_RE.test(userAgent)
}

/** Referrer host only, and only when it is another site. Self-referrals are
 *  internal navigation, not acquisition, so they are dropped. */
export function referrerHost(referer: string | null, selfHost: string): string | null {
  if (!referer) return null
  try {
    const host = new URL(referer).host
    if (!host || host === selfHost) return null
    return host.slice(0, 100)
  } catch {
    return null
  }
}

/** Capped counter bump. Only *new* keys are capped, so established ones keep
 *  counting once a bucket is full.
 *
 *  Hardened against inherited names: country and referrer keys are ultimately
 *  attacker-chosen (direct-to-origin headers), and on a plain object
 *  `bucket['constructor']` reads an inherited function while `bucket['__proto__']
 *  = n` silently no-ops — so existence uses hasOwn and writes use defineProperty. */
function bump(bucket: Record<string, number>, key: string, cap: number, by = 1): void {
  const current = Object.hasOwn(bucket, key) ? bucket[key] : undefined
  if (current === undefined && Object.keys(bucket).length >= cap) return
  Object.defineProperty(bucket, key, {
    value: (current ?? 0) + by,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

export interface VisitInput {
  path: string
  country: string
  referrer: string | null
  bot: boolean
}

/** Buffer one page view. Cheap and synchronous — safe on the request hot path. */
export function recordVisit(input: VisitInput, now = new Date()): void {
  const date = now.toISOString().slice(0, 10)
  const day = (pending[date] ??= {})

  // Only *new* paths are capped, so established routes keep counting even once
  // the cap is reached.
  if (day[input.path] === undefined && Object.keys(day).length >= MAX_PATHS_PER_DAY) return
  const row = (day[input.path] ??= { views: 0, bots: 0, countries: {}, referrers: {} })

  if (input.bot) {
    row.bots += 1
  } else {
    row.views += 1
    // A country is two chars (ISO alpha-2, or Cloudflare's T1/XX) — slicing
    // keeps a hand-crafted kilobyte header value from becoming a stored key.
    bump(row.countries, input.country.slice(0, 2) || 'XX', 300)
    if (input.referrer) bump(row.referrers, input.referrer, MAX_REFERRERS_PER_PATH)
  }

  scheduleFlush()
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushVisits()
  }, FLUSH_MS)
  // Never hold the process open just to write counters. (Cast because the DOM
  // lib types setTimeout's return as number; this module is Node-only.)
  ;(flushTimer as unknown as { unref?: () => void }).unref?.()
}

function mergeRow(target: VisitRow, source: VisitRow): void {
  target.views += source.views
  target.bots += source.bots
  for (const [k, v] of Object.entries(source.countries)) bump(target.countries, k, 300, v)
  for (const [k, v] of Object.entries(source.referrers)) bump(target.referrers, k, MAX_REFERRERS_PER_PATH, v)
}

/** Merge `source` into `target`, enforcing the per-day path cap on the target —
 *  the "keep the file finite" backstop has to hold for the stored file, not just
 *  the 30-second buffer. Shared by the flush and the flush-failure restore so
 *  the two paths cannot drift.
 *
 *  `capPaths` is off for the restore: those rows were already admitted once, so
 *  re-applying the cap to put them back would discard the very traffic the retry
 *  exists to save. The cap belongs on the persisted file, which the next
 *  successful flush applies. */
function mergeStore(target: VisitStore, source: VisitStore, capPaths = true): void {
  for (const [date, paths] of Object.entries(source)) {
    const day = (target[date] ??= {})
    for (const [path, row] of Object.entries(paths)) {
      const existing = day[path]
      if (existing) mergeRow(existing, row)
      else if (!capPaths || Object.keys(day).length < MAX_PATHS_PER_DAY) day[path] = row
    }
  }
}

/** Drop days older than the retention window. Pure, so retention is testable. */
export function pruneVisits(store: VisitStore, now = new Date(), retentionDays = RETENTION_DAYS): VisitStore {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString().slice(0, 10)
  return Object.fromEntries(Object.entries(store).filter(([date]) => date >= cutoff))
}

/** Serialize, dropping oldest days while over the byte ceiling. `.length` counts
 *  UTF-16 units, not bytes — fine here, the content is almost entirely ASCII and
 *  the ceiling has headroom.
 *
 *  One stringify per DAY, and none over the whole store. The obvious version —
 *  stringify everything, drop the oldest day, stringify again — is quadratic in
 *  the worst case it exists for: a cap-shaped day is ~2 MB, so the ceiling is
 *  blown by RECENT days while the loop sheds near-empty 89-day-old ones, up to
 *  89 full passes over a multi-megabyte object, synchronously, on a 30s timer,
 *  on a 1 GB host. It also built the entire store as one string BEFORE dropping
 *  anything, so it could exhaust the 768 MB container long before the 4 MB
 *  ceiling it enforces ever applied.
 *
 *  Also non-destructive: the old version `delete`d from the store it was handed,
 *  which was safe only because the one caller passes a fresh pruneVisits()
 *  result. A later caller passing `pending` would have lost live counters inside
 *  a function named "serialize". */
export function serializeBounded(store: VisitStore, maxBytes = MAX_STORE_BYTES): string {
  const days = Object.keys(store)
    .sort()
    .map(date => [date, JSON.stringify(store[date])] as const)

  // Newest first, so an oversized day costs the OLD days rather than the one
  // currently being written. Budget per entry: `"<date>":<body>` plus a comma,
  // rounded up — over-estimating is the safe direction for a ceiling.
  const kept: string[] = []
  let bytes = '{}'.length
  for (let i = days.length - 1; i >= 0; i -= 1) {
    const [date, body] = days[i]
    const size = date.length + body.length + 4
    // The newest day is always kept: if it alone exceeds the budget the choice
    // is between over-writing it and losing today's counters entirely, and the
    // per-day caps already bound it.
    if (kept.length > 0 && bytes + size > maxBytes) break
    kept.unshift(`${JSON.stringify(date)}:${body}`)
    bytes += size
  }
  return `{${kept.join(',')}}`
}

/** Merge the in-memory buffer into the file. Read-modify-write is fine here
 *  because it runs on a timer, not per request. */
export async function flushVisits(): Promise<void> {
  const dates = Object.keys(pending)
  if (dates.length === 0) return
  // Move (not copy) the buffered days out, so visits recorded during the awaits
  // below land in a fresh buffer and nothing is double-counted.
  const buffered: VisitStore = {}
  for (const date of dates) {
    buffered[date] = pending[date]
    delete pending[date]
  }

  try {
    let stored: VisitStore = {}
    try {
      const parsed = JSON.parse(await readFile(visitsPath(), 'utf-8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed as VisitStore
    } catch {
      // First write, or an unreadable file — start fresh rather than lose the buffer.
    }

    mergeStore(stored, buffered)
    await mkdir(join(process.cwd(), 'data'), { recursive: true })
    await writeFile(visitsPath(), serializeBounded(pruneVisits(stored)), 'utf-8')
  } catch (error) {
    // Counters must never take the site down. Put the buffer back so the next
    // flush retries it rather than silently dropping the interval's traffic —
    // uncapped, since these rows already passed the cap once.
    mergeStore(pending, buffered, false)
    // And arm a timer: the callback cleared flushTimer before calling us, so on
    // a quiet site nothing else would retry until the next visitor arrives.
    scheduleFlush()
    console.error('[visits] flush failed', error)
  }
}
