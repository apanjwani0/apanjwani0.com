/**
 * The page-speed beacon. One record per page view, sent once, when the page is
 * hidden (or the visitor navigates on inside the site), never on a timer: LCP, CLS
 * and INP are only final then. The numbers come from the web-vitals package; the
 * server (src/lib/analytics.ts) counts them into fixed histogram buckets and keeps
 * no per-visitor field. A visitor who sends Do Not Track or Global Privacy Control
 * sends nothing at all.
 *
 * web-vitals measures a hard load. A ClientRouter navigation has no load of its own,
 * so a soft view carries only its route time and any INP that happened while it was
 * on screen, and is labelled `nav: 'soft'`.
 */
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals'

const ENTRY_KEY = 'portfolio:entry-path'
const SAW_HOME_KEY = 'portfolio:saw-home'
const DIRECT_COUNTED_KEY = 'portfolio:direct-entry-counted'
/** At most this wide (CSS px) is the 'narrow' viewport bucket. */
const NARROW_MAX_PX = 640

interface View {
  path: string
  nav: 'hard' | 'soft'
  directEntry: boolean
  metrics: Record<string, number>
  sent: boolean
}

let wired = false
let routeStartedAt: number | null = null
let view: View | null = null

function privacySignalOn(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  return nav.doNotTrack === '1' || nav.doNotTrack === 'yes' || nav.globalPrivacyControl === true
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

function startView(nav: 'hard' | 'soft', metrics: Record<string, number> = {}): void {
  markSessionEntry()
  const path = window.location.pathname
  view = { path, nav, directEntry: nav === 'hard' && directEntryFor(path), metrics, sent: false }
}

/** Keeps the latest value web-vitals reports for the view on screen. CLS, LCP, FCP
 *  and TTFB belong to the hard load; INP is kept for whichever view it happens in. */
function record(key: string, value: number, hardOnly: boolean): void {
  if (!view || view.sent || !Number.isFinite(value)) return
  if (hardOnly && view.nav !== 'hard') return
  view.metrics[key] = key === 'cls' ? Math.round(value * 10000) / 10000 : Math.round(value)
}

/** Sends the view on screen, once. */
function flush(): void {
  const current = view
  if (!current || current.sent) return
  current.sent = true
  send({
    path: current.path,
    nav: current.nav,
    vp: window.innerWidth <= NARROW_MAX_PX ? 'narrow' : 'wide',
    directEntry: current.directEntry,
    metrics: current.metrics,
  })
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

export function initAnalytics(): void {
  if (wired) return
  wired = true
  if (privacySignalOn()) return

  startView('hard')

  // A page restored from the back/forward cache is a fresh view of the same page.
  // Registered before the web-vitals observers so it runs before they report again.
  window.addEventListener('pageshow', event => {
    if (event.persisted) startView('hard')
  })

  // Reported when each value is known or changes, so the last one is on hand the
  // moment the page is hidden; nothing is read from a timer.
  const options = { reportAllChanges: true }
  onLCP(metric => record('lcpMs', metric.value, true), options)
  onCLS(metric => record('cls', metric.value, true), options)
  onINP(metric => record('inpMs', metric.value, false), options)
  onTTFB(metric => record('ttfbMs', metric.value, true), options)
  onFCP(metric => record('fcpMs', metric.value, true), options)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  window.addEventListener('pagehide', flush)

  // ClientRouter: leaving a page in-site sends it, then the next page is a soft view.
  document.addEventListener('astro:before-preparation', () => {
    flush()
    view = null
    routeStartedAt = performance.now()
  })
  document.addEventListener('astro:page-load', () => {
    // Also fires for the first load, which has no route time and is already a view.
    if (routeStartedAt === null) return
    startView('soft', { routeMs: performance.now() - routeStartedAt })
    routeStartedAt = null
  })
}
