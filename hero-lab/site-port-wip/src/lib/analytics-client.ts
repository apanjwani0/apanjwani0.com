const ENTRY_KEY = 'portfolio:entry-path'
const SAW_HOME_KEY = 'portfolio:saw-home'
const DIRECT_COUNTED_KEY = 'portfolio:direct-entry-counted'

let wired = false
let routeStartedAt: number | null = null
let latestLcpMs: number | undefined
let cls = 0
let lastSentPath = ''
let lastSentAt = 0

function parseToolGamePath(pathname: string): { kind: 'tool' | 'game'; slug: string; path: string } | null {
  const match = pathname.match(/^\/(tools|games)\/([a-z0-9][a-z0-9-]{0,80})\/?$/)
  if (!match) return null
  return {
    kind: match[1] === 'tools' ? 'tool' : 'game',
    slug: match[2],
    path: `/${match[1]}/${match[2]}`,
  }
}

function sessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function sessionSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value)
  } catch {
    // private browsing/storage-disabled mode: views still work, direct-entry just falls back to false.
  }
}

function markSessionEntry(): void {
  if (!sessionGet(ENTRY_KEY)) sessionSet(ENTRY_KEY, window.location.pathname)
  if (window.location.pathname === '/') sessionSet(SAW_HOME_KEY, '1')
}

function directEntryFor(path: string): boolean {
  const isDirect = (sessionGet(ENTRY_KEY) ?? window.location.pathname) === path
    && sessionGet(SAW_HOME_KEY) !== '1'
    && sessionGet(DIRECT_COUNTED_KEY) !== '1'

  if (isDirect) sessionSet(DIRECT_COUNTED_KEY, '1')
  return isDirect
}

function navigationMetrics(): Record<string, number> {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (!nav) return {}
  return {
    ttfbMs: nav.responseStart,
    domContentLoadedMs: nav.domContentLoadedEventEnd,
    loadMs: nav.loadEventEnd || nav.duration,
    transferSize: nav.transferSize,
  }
}

function send(payload: unknown): void {
  const body = JSON.stringify(payload)
  const blob = new Blob([body], { type: 'application/json' })
  if (navigator.sendBeacon?.('/api/analytics/event', blob)) return
  fetch('/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}

function recordPageView(): void {
  if (navigator.doNotTrack === '1') return

  markSessionEntry()
  const target = parseToolGamePath(window.location.pathname)
  if (!target) return

  const now = performance.now()
  if (target.path === lastSentPath && now - lastSentAt < 1000) return
  lastSentPath = target.path
  lastSentAt = now

  const startedAt = routeStartedAt
  routeStartedAt = null
  const isClientNavigation = startedAt !== null
  const clientMetrics: Record<string, number> = isClientNavigation
    ? { routeMs: now - startedAt }
    : {}
  const directEntry = directEntryFor(target.path)

  const waitMs = isClientNavigation ? 100 : 1500
  window.setTimeout(() => {
    const metrics = isClientNavigation ? clientMetrics : navigationMetrics()
    if (!isClientNavigation) {
      if (latestLcpMs !== undefined) metrics.lcpMs = latestLcpMs
      if (cls > 0) metrics.cls = Math.round(cls * 10000) / 10000
    }

    send({
      ...target,
      directEntry,
      metrics,
    })
  }, waitMs)
}

function observeInitialPageVitals(): void {
  if (!('PerformanceObserver' in window)) return

  try {
    new PerformanceObserver(list => {
      const entries = list.getEntries()
      const latest = entries[entries.length - 1]
      if (latest) latestLcpMs = latest.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  } catch {
    // Browser does not support this metric.
  }

  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number }>) {
        if (!entry.hadRecentInput && typeof entry.value === 'number') cls += entry.value
      }
    }).observe({ type: 'layout-shift', buffered: true })
  } catch {
    // Browser does not support this metric.
  }
}

export function initAnalytics(): void {
  if (wired) return
  wired = true
  observeInitialPageVitals()
  document.addEventListener('astro:before-preparation', () => {
    routeStartedAt = performance.now()
  })
  document.addEventListener('astro:page-load', recordPageView)
}
