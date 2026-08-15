import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getRuntimeEnv } from './security'

export type AnalyticsKind = 'tool' | 'game'

export const analyticsMetricKeys = [
  'ttfbMs',
  'domContentLoadedMs',
  'loadMs',
  'routeMs',
  'lcpMs',
  'cls',
  'transferSize',
] as const

export type AnalyticsMetricKey = typeof analyticsMetricKeys[number]

export interface AnalyticsMetricStats {
  sum: number
  count: number
  max: number
}

export type AnalyticsMetrics = Partial<Record<AnalyticsMetricKey, AnalyticsMetricStats>>

export interface AnalyticsEvent {
  kind: AnalyticsKind
  slug: string
  path: string
  directEntry: boolean
  metrics: Partial<Record<AnalyticsMetricKey, number>>
}

export interface AnalyticsAggregate {
  date: string
  kind: AnalyticsKind
  slug: string
  path: string
  views: number
  directEntries: number
  metrics: AnalyticsMetrics
  updatedAt: string
}

export interface AnalyticsSummaryRow {
  kind: AnalyticsKind
  slug: string
  path: string
  views: number
  directEntries: number
  directRate: number
  avgTtfbMs: number | null
  avgDomContentLoadedMs: number | null
  avgLoadMs: number | null
  avgRouteMs: number | null
  avgLcpMs: number | null
  avgCls: number | null
  avgTransferSize: number | null
  maxLoadMs: number | null
  maxRouteMs: number | null
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

const MAX_MS = 10 * 60 * 1000
const MAX_TRANSFER_SIZE = 100 * 1024 * 1024
const ANALYTICS_PREFIX = 'analytics:'
/** How long a daily rollup is kept. Nothing dropped these before, and one row per
 *  day per tool/game accumulates forever — on the local store that matters, because
 *  every public page view reads and rewrites the whole file. */
const ANALYTICS_RETENTION_DAYS = 90

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isKind(value: unknown): value is AnalyticsKind {
  return value === 'tool' || value === 'game'
}

function cleanSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const slug = value.trim()
  return /^[a-z0-9][a-z0-9-]{0,80}$/.test(slug) ? slug : null
}

function cleanPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  return path.startsWith('/') && !path.startsWith('//') && path.length <= 160 ? path : null
}

function cleanMetric(key: AnalyticsMetricKey, value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  const max = key === 'cls' ? 10 : key === 'transferSize' ? MAX_TRANSFER_SIZE : MAX_MS
  return value <= max ? Math.round(value * 100) / 100 : undefined
}

function cleanMetricSum(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return undefined
  return Math.round(value * 100) / 100
}

function emptyAggregate(date: string, event: AnalyticsEvent): AnalyticsAggregate {
  return {
    date,
    kind: event.kind,
    slug: event.slug,
    path: event.path,
    views: 0,
    directEntries: 0,
    metrics: {},
    updatedAt: new Date().toISOString(),
  }
}

function analyticsKey(date: string, kind: AnalyticsKind, slug: string): string {
  return `${ANALYTICS_PREFIX}${date}:${kind}:${slug}`
}

function getAnalyticsKV(locals: unknown): AnalyticsKV | null {
  const runtimeEnv = getRuntimeEnv(locals)
  return runtimeEnv?.SITE_ANALYTICS ?? runtimeEnv?.SITE_CONFIG ?? null
}

function localAnalyticsPath(): string {
  return join(process.cwd(), 'data', 'analytics.json')
}

function cleanAggregate(value: unknown): AnalyticsAggregate | null {
  if (!isObject(value) || !isKind(value.kind)) return null
  const date = typeof value.date === 'string' ? value.date : ''
  const slug = cleanSlug(value.slug)
  const path = cleanPath(value.path)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !slug || !path) return null

  const metrics: AnalyticsMetrics = {}
  if (isObject(value.metrics)) {
    for (const key of analyticsMetricKeys) {
      const raw = value.metrics[key]
      if (!isObject(raw)) continue
      const sum = cleanMetricSum(raw.sum)
      const count = typeof raw.count === 'number' && Number.isInteger(raw.count) && raw.count >= 0 ? raw.count : undefined
      const max = cleanMetric(key, raw.max)
      if (sum !== undefined && count !== undefined && max !== undefined) metrics[key] = { sum, count, max }
    }
  }

  return {
    date,
    kind: value.kind,
    slug,
    path,
    views: typeof value.views === 'number' && value.views >= 0 ? Math.floor(value.views) : 0,
    directEntries: typeof value.directEntries === 'number' && value.directEntries >= 0 ? Math.floor(value.directEntries) : 0,
    metrics,
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
  await writeFile(localAnalyticsPath(), JSON.stringify(data, null, 2), 'utf-8')
}

export function parseAnalyticsPath(pathname: string): Pick<AnalyticsEvent, 'kind' | 'slug' | 'path'> | null {
  const path = cleanPath(pathname)
  if (!path) return null
  const match = path.match(/^\/(tools|games)\/([a-z0-9][a-z0-9-]{0,80})\/?$/)
  if (!match) return null
  return {
    kind: match[1] === 'tools' ? 'tool' : 'game',
    slug: match[2],
    path: `/${match[1]}/${match[2]}`,
  }
}

export function normalizeAnalyticsEvent(value: unknown): AnalyticsEvent | null {
  if (!isObject(value) || !isKind(value.kind)) return null
  const slug = cleanSlug(value.slug)
  const path = cleanPath(value.path)
  if (!slug || !path) return null

  const target = parseAnalyticsPath(path)
  if (!target || target.kind !== value.kind || target.slug !== slug) return null

  const metrics: AnalyticsEvent['metrics'] = {}
  if (isObject(value.metrics)) {
    for (const key of analyticsMetricKeys) {
      const clean = cleanMetric(key, value.metrics[key])
      if (clean !== undefined) metrics[key] = clean
    }
  }

  return {
    kind: value.kind,
    slug,
    path: target.path,
    directEntry: value.directEntry === true,
    metrics,
  }
}

export function updateAnalyticsAggregate(current: AnalyticsAggregate | null, event: AnalyticsEvent, now = new Date()): AnalyticsAggregate {
  const date = now.toISOString().slice(0, 10)
  const next = current ? { ...current, metrics: { ...current.metrics } } : emptyAggregate(date, event)
  next.views += 1
  if (event.directEntry) next.directEntries += 1
  next.path = event.path
  next.updatedAt = now.toISOString()

  for (const key of analyticsMetricKeys) {
    const value = event.metrics[key]
    if (value === undefined) continue
    const stats = next.metrics[key] ?? { sum: 0, count: 0, max: 0 }
    next.metrics[key] = {
      sum: Math.round((stats.sum + value) * 100) / 100,
      count: stats.count + 1,
      max: Math.max(stats.max, value),
    }
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
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString().slice(0, 10)
  return Object.fromEntries(
    Object.entries(data).filter((entry): entry is [string, AnalyticsAggregate] =>
      !!entry[1] && entry[1].date >= cutoff),
  )
}

export async function recordAnalyticsEvent(locals: unknown, event: AnalyticsEvent): Promise<void> {
  const date = new Date().toISOString().slice(0, 10)
  const key = analyticsKey(date, event.kind, event.slug)
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
  // ponytail: local JSON can lose simultaneous increments; use SQLite/Postgres if this site gets real traffic.
  data[key] = updateAnalyticsAggregate(data[key] ?? null, event)
  await writeLocalAnalytics(data)
}

export async function readAnalyticsAggregates(locals: unknown): Promise<AnalyticsAggregate[]> {
  const kv = getAnalyticsKV(locals)
  if (!kv) return Object.values(await readLocalAnalytics())
  if (!kv.list) return []

  const rows: AnalyticsAggregate[] = []
  let cursor: string | undefined
  do {
    const result = await kv.list({ prefix: ANALYTICS_PREFIX, ...(cursor ? { cursor } : {}) })
    for (const key of result.keys) {
      const row = cleanAggregate(await kv.get(key.name, 'json'))
      if (row) rows.push(row)
    }
    cursor = result.list_complete === false ? result.cursor : undefined
  } while (cursor)

  return rows
}

function avg(metrics: AnalyticsMetrics, key: AnalyticsMetricKey): number | null {
  const stats = metrics[key]
  return stats && stats.count > 0 ? Math.round((stats.sum / stats.count) * 100) / 100 : null
}

export function summarizeAnalytics(rows: AnalyticsAggregate[]): AnalyticsSummaryRow[] {
  const byTarget = new Map<string, AnalyticsAggregate>()

  for (const row of rows) {
    const key = `${row.kind}:${row.slug}`
    const current = byTarget.get(key)
    if (!current) {
      byTarget.set(key, { ...row, metrics: { ...row.metrics } })
      continue
    }

    current.views += row.views
    current.directEntries += row.directEntries
    current.updatedAt = row.updatedAt > current.updatedAt ? row.updatedAt : current.updatedAt
    for (const metricKey of analyticsMetricKeys) {
      const incoming = row.metrics[metricKey]
      if (!incoming) continue
      const existing = current.metrics[metricKey] ?? { sum: 0, count: 0, max: 0 }
      current.metrics[metricKey] = {
        sum: Math.round((existing.sum + incoming.sum) * 100) / 100,
        count: existing.count + incoming.count,
        max: Math.max(existing.max, incoming.max),
      }
    }
  }

  return [...byTarget.values()]
    .map(row => ({
      kind: row.kind,
      slug: row.slug,
      path: row.path,
      views: row.views,
      directEntries: row.directEntries,
      directRate: row.views > 0 ? Math.round((row.directEntries / row.views) * 10000) / 100 : 0,
      avgTtfbMs: avg(row.metrics, 'ttfbMs'),
      avgDomContentLoadedMs: avg(row.metrics, 'domContentLoadedMs'),
      avgLoadMs: avg(row.metrics, 'loadMs'),
      avgRouteMs: avg(row.metrics, 'routeMs'),
      avgLcpMs: avg(row.metrics, 'lcpMs'),
      avgCls: avg(row.metrics, 'cls'),
      avgTransferSize: avg(row.metrics, 'transferSize'),
      maxLoadMs: row.metrics.loadMs?.max ?? null,
      maxRouteMs: row.metrics.routeMs?.max ?? null,
      lastSeen: row.updatedAt,
    }))
    .sort((a, b) => b.views - a.views || a.kind.localeCompare(b.kind) || a.slug.localeCompare(b.slug))
}
