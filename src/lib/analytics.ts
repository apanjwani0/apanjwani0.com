import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getRuntimeEnv } from './security'
import { MS_PER_DAY } from './date'

/**
 * Real-user page speed, counted and never recorded. Each beacon is one page view
 * (sent once, when the page is hidden) and its measurements land in fixed
 * histogram buckets per day x path bucket x nav x viewport, so a p75 can be
 * estimated later and nothing per visitor exists to be kept. A tool or game
 * detail page keeps its own bucket (the slug is checked against the config by the
 * route); every other page falls into a short fixed list of section buckets.
 */
export type AnalyticsKind = 'tool' | 'game' | 'page'
/** 'hard' is a full page load; 'soft' is a ClientRouter navigation inside the site. */
export type AnalyticsNav = 'hard' | 'soft'
/** At most 640 CSS px wide is 'narrow'. A coarse bucket, never a user agent. */
export type AnalyticsViewport = 'narrow' | 'wide'

/**
 * The only measurements a beacon may carry, with the inclusive upper edge of each
 * histogram bucket but the last (open) one. LCP, INP, CLS and TTFB keep Google's
 * "good" and "poor" thresholds as edges; FCP shares LCP's; route time is the
 * in-site navigation delay a soft navigation adds.
 */
export const VITAL_EDGES = {
  lcpMs: [1200, 2500, 4000],
  cls: [0.1, 0.25],
  inpMs: [200, 500],
  ttfbMs: [800, 1800],
  fcpMs: [1200, 2500, 4000],
  routeMs: [300, 1000],
} as const

export type AnalyticsMetricKey = keyof typeof VITAL_EDGES
export const analyticsMetricKeys = ['lcpMs', 'cls', 'inpMs', 'ttfbMs', 'fcpMs', 'routeMs'] as const

/** Which measurements each kind of navigation can honestly carry: a soft navigation
 *  has no load, so it has no LCP, FCP or TTFB, and CLS is only the hard load's. */
const METRICS_BY_NAV: Record<AnalyticsNav, readonly AnalyticsMetricKey[]> = {
  hard: ['lcpMs', 'cls', 'inpMs', 'ttfbMs', 'fcpMs'],
  soft: ['inpMs', 'routeMs'],
}

/** Counts per bucket, one more than the metric has edges. */
export type AnalyticsHistograms = Record<AnalyticsMetricKey, number[]>

export interface AnalyticsEvent {
  kind: AnalyticsKind
  /** Set for a tool or game page, which the route checks against the config. */
  slug: string | null
  /** The path bucket, not the visited URL. */
  path: string
  nav: AnalyticsNav
  vp: AnalyticsViewport
  directEntry: boolean
  metrics: Partial<Record<AnalyticsMetricKey, number>>
}

/** The complete list of fields a stored row has. Nothing else is ever written. */
export const ANALYTICS_STORED_FIELDS = ['date', 'path', 'nav', 'vp', 'views', 'directEntries', 'hist', 'updatedAt'] as const

export interface AnalyticsAggregate {
  date: string
  path: string
  nav: AnalyticsNav
  vp: AnalyticsViewport
  views: number
  directEntries: number
  hist: AnalyticsHistograms
  updatedAt: string
}

export interface AnalyticsVitalSummary {
  /** Measurements counted. */
  n: number
  counts: number[]
  /** Where the 75th percentile falls, as a bucket range, or null with no data. */
  p75: string | null
}

export interface AnalyticsSummaryRow {
  path: string
  nav: AnalyticsNav
  vp: AnalyticsViewport
  views: number
  directEntries: number
  directRate: number
  vitals: Record<AnalyticsMetricKey, AnalyticsVitalSummary>
  lastSeen: string
}

type KVListResult = {
  keys: { name: string }[]
  list_complete?: boolean
  cursor?: string
}

type AnalyticsKV = {
  get(key: string, type: 'json'): Promise<unknown>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>
  list?: (options: { prefix: string; cursor?: string }) => Promise<KVListResult>
}

/** Values above these are clamped, not trusted: a beacon is anonymous input. */
const MAX_MS = 10 * 60 * 1000
const MAX_CLS = 10
const ANALYTICS_PREFIX = 'analytics:'
/** How long a daily rollup is kept. Nothing dropped these before, and one row per
 *  day per tool/game accumulates forever — on the local store that matters, because
 *  every public page view reads and rewrites the whole file. */
const ANALYTICS_RETENTION_DAYS = 90
/** Backstops on the local file, which is read and rewritten whole by every beacon.
 *  The path buckets are already bounded (known slugs plus a short fixed list), so
 *  these only matter if the config grows or a bug floods the keys. */
const MAX_ROWS_PER_DAY = 800
const MAX_STORE_BYTES = 4 * 1024 * 1024

/** The fixed section buckets for every page that is not a tool or game detail page. */
const SECTION_PATHS = new Set(['/', '/tools', '/games', '/projects', '/blogs', '/learnings', '/terms'])
const OTHER_PATH = 'other'
const PATH_BUCKET_RE = /^(\/|other|\/(tools|games|projects|blogs|learnings|terms)|\/(blogs|learnings)\/\*|\/(tools|games)\/[a-z0-9][a-z0-9-]{0,80})$/

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  return path.startsWith('/') && !path.startsWith('//') && path.length <= 160 ? path : null
}

function cleanNav(value: unknown): AnalyticsNav | null {
  return value === 'hard' || value === 'soft' ? value : null
}

function cleanViewport(value: unknown): AnalyticsViewport | null {
  return value === 'narrow' || value === 'wide' ? value : null
}

/** A finite, non-negative number, clamped to the metric's ceiling. Anything else is dropped. */
function cleanMetric(key: AnalyticsMetricKey, value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.min(value, key === 'cls' ? MAX_CLS : MAX_MS)
}

/** Index of the histogram bucket a value falls in: the first whose inclusive upper edge holds it. */
export function vitalBucketIndex(key: AnalyticsMetricKey, value: number): number {
  const edges: readonly number[] = VITAL_EDGES[key]
  const index = edges.findIndex(edge => value <= edge)
  return index === -1 ? edges.length : index
}

function emptyHistograms(): AnalyticsHistograms {
  return Object.fromEntries(
    analyticsMetricKeys.map(key => [key, new Array(VITAL_EDGES[key].length + 1).fill(0)]),
  ) as AnalyticsHistograms
}

function cleanHistograms(value: unknown): AnalyticsHistograms {
  const hist = emptyHistograms()
  if (!isObject(value)) return hist
  for (const key of analyticsMetricKeys) {
    const raw = value[key]
    if (!Array.isArray(raw) || raw.length !== hist[key].length) continue
    hist[key] = raw.map(count => (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : 0))
  }
  return hist
}

function emptyAggregate(date: string, event: AnalyticsEvent): AnalyticsAggregate {
  return {
    date,
    path: event.path,
    nav: event.nav,
    vp: event.vp,
    views: 0,
    directEntries: 0,
    hist: emptyHistograms(),
    updatedAt: new Date().toISOString(),
  }
}

function analyticsKey(date: string, event: Pick<AnalyticsEvent, 'path' | 'nav' | 'vp'>): string {
  return `${ANALYTICS_PREFIX}${date}:${event.nav}:${event.vp}:${event.path}`
}

function getAnalyticsKV(locals: unknown): AnalyticsKV | null {
  const runtimeEnv = getRuntimeEnv(locals)
  return runtimeEnv?.SITE_ANALYTICS ?? runtimeEnv?.SITE_CONFIG ?? null
}

function localAnalyticsPath(): string {
  return join(process.cwd(), 'data', 'analytics.json')
}

/** Rebuilds a stored row field by field from the allowlist, so a row written by an
 *  older shape (the pre-histogram averages) or tampered with on disk comes back
 *  as null or as exactly the fields above, never as extra ones. */
function cleanAggregate(value: unknown): AnalyticsAggregate | null {
  if (!isObject(value)) return null
  const date = typeof value.date === 'string' ? value.date : ''
  const path = typeof value.path === 'string' && PATH_BUCKET_RE.test(value.path) ? value.path : null
  const nav = cleanNav(value.nav)
  const vp = cleanViewport(value.vp)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !path || !nav || !vp) return null

  return {
    date,
    path,
    nav,
    vp,
    views: typeof value.views === 'number' && value.views >= 0 ? Math.floor(value.views) : 0,
    directEntries: typeof value.directEntries === 'number' && value.directEntries >= 0 ? Math.floor(value.directEntries) : 0,
    hist: cleanHistograms(value.hist),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
  }
}

async function readLocalAnalytics(): Promise<Record<string, AnalyticsAggregate>> {
  try {
    const raw = await readFile(localAnalyticsPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (!isObject(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [key, cleanAggregate(value)])
        .filter((entry): entry is [string, AnalyticsAggregate] => !!entry[1]),
    )
  } catch {
    return {}
  }
}

async function writeLocalAnalytics(data: Record<string, AnalyticsAggregate>): Promise<void> {
  await mkdir(join(process.cwd(), 'data'), { recursive: true })
  await writeFile(localAnalyticsPath(), JSON.stringify(data), 'utf-8')
}

/** Maps a visited pathname to the bucket it is counted under: a tool or game detail
 *  page keeps its slug (the route checks it exists), the section pages share their
 *  own path, an article folds into '/blogs/*' or '/learnings/*', and anything else
 *  is 'other'. The bucket set is bounded, so a caller cannot grow the key space. */
export function parseAnalyticsPath(pathname: string): Pick<AnalyticsEvent, 'kind' | 'slug' | 'path'> | null {
  const raw = cleanPath(pathname)
  if (!raw || /[?#]/.test(raw)) return null
  const path = raw.replace(/\/+$/, '') || '/'

  const match = path.match(/^\/(tools|games)\/([a-z0-9][a-z0-9-]{0,80})$/)
  if (match) {
    return {
      kind: match[1] === 'tools' ? 'tool' : 'game',
      slug: match[2],
      path: `/${match[1]}/${match[2]}`,
    }
  }
  if (SECTION_PATHS.has(path)) return { kind: 'page', slug: null, path }
  const article = path.match(/^\/(blogs|learnings)\/[^/]+$/)
  if (article) return { kind: 'page', slug: null, path: `/${article[1]}/*` }
  return { kind: 'page', slug: null, path: OTHER_PATH }
}

/** Validates a beacon body into an event holding only allowlisted fields, or null.
 *  Unknown fields are ignored (never copied), a missing or odd nav or vp rejects the
 *  whole event, and a measurement the navigation cannot have is dropped. */
export function normalizeAnalyticsEvent(value: unknown): AnalyticsEvent | null {
  if (!isObject(value)) return null
  const nav = cleanNav(value.nav)
  const vp = cleanViewport(value.vp)
  if (!nav || !vp) return null

  const target = parseAnalyticsPath(typeof value.path === 'string' ? value.path : '')
  if (!target) return null

  const metrics: AnalyticsEvent['metrics'] = {}
  if (isObject(value.metrics)) {
    for (const key of METRICS_BY_NAV[nav]) {
      const clean = cleanMetric(key, value.metrics[key])
      if (clean !== undefined) metrics[key] = clean
    }
  }

  return {
    kind: target.kind,
    slug: target.slug,
    path: target.path,
    nav,
    vp,
    directEntry: nav === 'hard' && value.directEntry === true,
    metrics,
  }
}

export function updateAnalyticsAggregate(current: AnalyticsAggregate | null, event: AnalyticsEvent, now = new Date()): AnalyticsAggregate {
  const date = now.toISOString().slice(0, 10)
  const base = current ?? emptyAggregate(date, event)
  // Built field by field, never spread from the event: the stored row has exactly
  // ANALYTICS_STORED_FIELDS and no more.
  const next: AnalyticsAggregate = {
    date: base.date,
    path: base.path,
    nav: base.nav,
    vp: base.vp,
    views: base.views + 1,
    directEntries: base.directEntries + (event.directEntry ? 1 : 0),
    hist: cleanHistograms(base.hist),
    updatedAt: now.toISOString(),
  }

  for (const key of analyticsMetricKeys) {
    const value = event.metrics[key]
    if (value !== undefined) next.hist[key][vitalBucketIndex(key, value)] += 1
  }

  return next
}

/** Drop rollups older than [retentionDays]. Pure, so the retention rule is testable
 *  without touching the store. */
export function pruneAnalytics(
  data: Record<string, AnalyticsAggregate | null>,
  now = new Date(),
  retentionDays = ANALYTICS_RETENTION_DAYS,
): Record<string, AnalyticsAggregate> {
  const cutoff = new Date(now.getTime() - retentionDays * MS_PER_DAY).toISOString().slice(0, 10)
  return Object.fromEntries(
    Object.entries(data).filter((entry): entry is [string, AnalyticsAggregate] =>
      !!entry[1] && entry[1].date >= cutoff),
  )
}

/** Keeps the serialized local store under [maxBytes] by dropping the oldest whole
 *  days first, and never the newest one. Byte counts are UTF-16 units, which is
 *  exact here: every key and value is ASCII. */
export function capAnalyticsStore(
  data: Record<string, AnalyticsAggregate>,
  maxBytes = MAX_STORE_BYTES,
): Record<string, AnalyticsAggregate> {
  const days = [...new Set(Object.values(data).map(row => row.date))].sort()
  let kept = data
  while (JSON.stringify(kept).length > maxBytes && days.length > 1) {
    const oldest = days.shift()
    kept = Object.fromEntries(Object.entries(kept).filter(([, row]) => row.date !== oldest))
  }
  return kept
}

export async function recordAnalyticsEvent(locals: unknown, event: AnalyticsEvent): Promise<void> {
  const date = new Date().toISOString().slice(0, 10)
  const key = analyticsKey(date, event)
  const kv = getAnalyticsKV(locals)

  if (kv) {
    const current = cleanAggregate(await kv.get(key, 'json'))
    // ponytail: KV increments are read-modify-write; use Durable Objects or PostHog if exact high-traffic counts matter.
    // expirationTtl so KV expires its own keys: readAnalyticsAggregates lists and gets
    // every key under the prefix, so keys that never die make the admin tab slower forever.
    await kv.put(key, JSON.stringify(updateAnalyticsAggregate(current, event)), {
      expirationTtl: ANALYTICS_RETENTION_DAYS * 86_400,
    })
    return
  }

  const data = pruneAnalytics(await readLocalAnalytics())
  // A new row past the day's cap is refused; established rows keep counting.
  if (!data[key] && Object.values(data).filter(row => row.date === date).length >= MAX_ROWS_PER_DAY) return
  // ponytail: local JSON can lose simultaneous increments; use SQLite/Postgres if this site gets real traffic.
  data[key] = updateAnalyticsAggregate(data[key] ?? null, event)
  await writeLocalAnalytics(capAnalyticsStore(data))
}

export async function readAnalyticsAggregates(locals: unknown): Promise<AnalyticsAggregate[]> {
  const kv = getAnalyticsKV(locals)
  if (!kv) return Object.values(pruneAnalytics(await readLocalAnalytics()))
  if (!kv.list) return []

  // Retention must also hold on the read path: keys written before expirationTtl
  // was set never expire on their own, and the local backend prunes on write —
  // without this filter the two backends would disagree about the 90-day window.
  const cutoff = new Date(Date.now() - ANALYTICS_RETENTION_DAYS * MS_PER_DAY)
    .toISOString()
    .slice(0, 10)
  const rows: AnalyticsAggregate[] = []
  let cursor: string | undefined
  do {
    const result = await kv.list({ prefix: ANALYTICS_PREFIX, ...(cursor ? { cursor } : {}) })
    for (const key of result.keys) {
      const row = cleanAggregate(await kv.get(key.name, 'json'))
      if (row && row.date >= cutoff) rows.push(row)
    }
    cursor = result.list_complete === false ? result.cursor : undefined
  } while (cursor)

  return rows
}

/** Where the 75th percentile falls, as the bucket that holds the 75th-percentile
 *  measurement. Only the bucket is known, so it is a range ("1200–2500 ms"), not a
 *  number: the buckets are fixed and counts are all that is kept. */
export function estimateP75(key: AnalyticsMetricKey, counts: readonly number[]): string | null {
  const n = counts.reduce((sum, count) => sum + count, 0)
  if (n === 0) return null
  const edges: readonly number[] = VITAL_EDGES[key]
  const unit = key === 'cls' ? '' : ' ms'
  const rank = Math.ceil(n * 0.75)
  let seen = 0
  for (let i = 0; i < counts.length; i += 1) {
    seen += counts[i]
    if (seen < rank) continue
    if (i === 0) return `up to ${edges[0]}${unit}`
    if (i === edges.length) return `over ${edges[i - 1]}${unit}`
    return `${edges[i - 1]} to ${edges[i]}${unit}`
  }
  return null
}

/** One row per path bucket x nav x viewport, all retained days added together. */
export function summarizeAnalytics(rows: AnalyticsAggregate[]): AnalyticsSummaryRow[] {
  const byGroup = new Map<string, AnalyticsAggregate>()

  for (const row of rows) {
    const key = `${row.path}|${row.nav}|${row.vp}`
    const current = byGroup.get(key)
    if (!current) {
      byGroup.set(key, { ...row, hist: cleanHistograms(row.hist) })
      continue
    }

    current.views += row.views
    current.directEntries += row.directEntries
    current.updatedAt = row.updatedAt > current.updatedAt ? row.updatedAt : current.updatedAt
    for (const metricKey of analyticsMetricKeys) {
      row.hist[metricKey].forEach((count, i) => { current.hist[metricKey][i] += count })
    }
  }

  return [...byGroup.values()]
    .map(row => ({
      path: row.path,
      nav: row.nav,
      vp: row.vp,
      views: row.views,
      directEntries: row.directEntries,
      directRate: row.views > 0 ? Math.round((row.directEntries / row.views) * 10000) / 100 : 0,
      vitals: Object.fromEntries(analyticsMetricKeys.map(key => [key, {
        n: row.hist[key].reduce((sum, count) => sum + count, 0),
        counts: row.hist[key],
        p75: estimateP75(key, row.hist[key]),
      }])) as Record<AnalyticsMetricKey, AnalyticsVitalSummary>,
      lastSeen: row.updatedAt,
    }))
    .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path) || a.nav.localeCompare(b.nav) || a.vp.localeCompare(b.vp))
}
