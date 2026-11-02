/**
 * Invariants for the page-speed beacon and the offline service worker.
 *
 * The beacon (AGENTS.md, Analytics): counts only. Each page view is sent once,
 * when the page is hidden, and the server counts every value into fixed histogram
 * buckets, so nothing per visitor exists to be kept. The worker (docs/operations.md,
 * Offline): navigations only, and never any HTML.
 *
 * Mutations that must fail: move a bucket edge in VITAL_EDGES; add a field to the
 * object `updateAnalyticsAggregate` returns; spread the event into the stored row;
 * read `user-agent` or `referer` in analytics.ts or the event route; wrap the
 * client's `send` in a setTimeout; drop the Do Not Track check; make sw.js answer
 * a non-navigation request, `cache.put` a response, or call `clients.claim()`;
 * delete one purpose from the manifest; add a script to offline.html.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import {
  ANALYTICS_STORED_FIELDS,
  VITAL_EDGES,
  analyticsMetricKeys,
  normalizeAnalyticsEvent,
  parseAnalyticsPath,
  updateAnalyticsAggregate,
} from '../../src/lib/analytics.ts'

const root = new URL('../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf-8')
/** Code without comments, so a rule about what the code does is not tripped (or satisfied) by prose. */
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')

const analyticsSrc = code(await read('src/lib/analytics.ts'))
const eventRoute = code(await read('src/pages/api/analytics/event.ts'))
const clientSrc = code(await read('src/lib/analytics-client.ts'))
const swRaw = await read('public/sw.js')
const swSrc = code(swRaw)

/* ─────  server: what is stored  ───────────────────────────────────────────── */
{
  const junk = {
    path: '/tools/json-tidy',
    nav: 'hard',
    vp: 'wide',
    directEntry: true,
    metrics: { lcpMs: 900, cls: 0.02, userAgent: 'Mozilla/5.0 secret-ua', ip: '203.0.113.7' },
    ip: '203.0.113.7',
    ua: 'Mozilla/5.0 secret-ua',
    userAgent: 'Mozilla/5.0 secret-ua',
    referrer: 'https://example.com/private?token=abc',
    sessionId: 'abcdef',
    __proto__: { polluted: true },
  }
  const event = normalizeAnalyticsEvent(junk)
  assert.ok(event)
  assert.deepEqual(Object.keys(event).sort(), ['directEntry', 'kind', 'metrics', 'nav', 'path', 'slug', 'vp'], 'the event holds only allowlisted fields')
  const row = updateAnalyticsAggregate(null, event, new Date('2026-11-02T00:00:00Z'))
  assert.deepEqual(Object.keys(row).sort(), [...ANALYTICS_STORED_FIELDS].sort(), 'a stored row has exactly the allowlisted fields')
  assert.deepEqual(Object.keys(row.hist).sort(), [...analyticsMetricKeys].sort(), 'the histograms cover exactly the allowlisted metrics')
  const stored = JSON.stringify(row)
  for (const secret of ['203.0.113', 'secret-ua', 'example.com', 'abcdef', 'polluted']) {
    assert.ok(!stored.includes(secret), `a stored row never contains "${secret}"`)
  }
  assert.deepEqual(
    [...ANALYTICS_STORED_FIELDS],
    ['date', 'path', 'nav', 'vp', 'views', 'directEntries', 'hist', 'updatedAt'],
    'the allowlist itself is the reviewed list',
  )
  console.log('vitals: a stored row has only the allowlisted fields, and nothing sent beyond them is kept')
}

{
  assert.deepEqual(
    JSON.parse(JSON.stringify(VITAL_EDGES)),
    {
      lcpMs: [1200, 2500, 4000],
      cls: [0.1, 0.25],
      inpMs: [200, 500],
      ttfbMs: [800, 1800],
      fcpMs: [1200, 2500, 4000],
      routeMs: [300, 1000],
    },
    'histogram edges are exactly the reviewed ones',
  )
  console.log('vitals: histogram bucket edges are exactly LCP/FCP 1200-2500-4000, CLS 0.1-0.25, INP 200-500, TTFB 800-1800')
}

{
  // The key space is bounded: whatever is visited, the bucket is one of a fixed shape.
  const shape = /^(\/|other|\/(tools|games|projects|blogs|learnings|terms)|\/(blogs|learnings)\/\*|\/(tools|games)\/[a-z0-9][a-z0-9-]{0,80})$/
  const samples = ['/', '/x', '/tools', '/tools/a-b', '/tools/a/b', '/games/', '/blogs/a', '/blogs/a/b', '/learnings/z', '/%00', '//evil', '/a?b=c', '/#x', '/tools/UPPER', '/tools/' + 'a'.repeat(400)]
  for (let i = 0; i < 300; i += 1) samples.push('/' + Math.random().toString(36).slice(2) + '/' + Math.random().toString(36).slice(2))
  for (const sample of samples) {
    const target = parseAnalyticsPath(sample)
    if (target) assert.match(target.path, shape, `"${sample.slice(0, 40)}" is counted under a bounded bucket`)
  }
  assert.equal(parseAnalyticsPath('/blogs/anything-at-all')?.path, '/blogs/*')
  console.log('vitals: every path folds into a bounded bucket (known slug, fixed section, article wildcard, or other)')
}

/* ─────  server: no identity anywhere in the analytics code  ───────────────── */
{
  const identity = /user-?agent|\bua\b|referr?er|referer|\bip\b|x-forwarded-for|cf-connecting-ip|getClientIp|sessionId|visitorId|cookie/i
  for (const [name, src] of [['analytics.ts', analyticsSrc], ['event route', eventRoute]]) {
    const hit = src.match(identity)
    assert.equal(hit, null, `${name} must not read or store ${hit?.[0]}`)
  }
  assert.match(eventRoute, /recordAnalyticsEvent\(locals, event\)/, 'the route stores the normalized event, never the request')
  assert.match(eventRoute, /createRateLimiter\(60_000, 60\)/, 'the rate limiter stays')
  assert.match(eventRoute, /readLimitedJson\(request, 8_192\)/, 'the payload cap stays')
  assert.match(eventRoute, /isSameOrigin\(request\)/, 'the same-origin check stays')
  assert.match(analyticsSrc, /ANALYTICS_RETENTION_DAYS = 90/, 'retention stays 90 days')
  assert.match(analyticsSrc, /expirationTtl: ANALYTICS_RETENTION_DAYS \* 86_400/, 'KV rows expire on their own')
  assert.match(analyticsSrc, /capAnalyticsStore\(data\)/, 'the local file is capped when written')
  console.log('vitals: analytics.ts and its route read and store no IP, user agent, referrer or session field; limits and 90 days stay')
}

/* ─────  client: sent on hide, once, never on a timer  ─────────────────────── */
{
  assert.doesNotMatch(clientSrc, /setTimeout|setInterval|requestIdleCallback/, 'the beacon never waits on a timer')
  assert.doesNotMatch(clientSrc, /PerformanceObserver|cls \+=/, 'the old observers and running-sum CLS are gone')
  assert.match(clientSrc, /from 'web-vitals'/, 'values come from the bundled web-vitals package')
  for (const fn of ['onLCP', 'onCLS', 'onINP', 'onTTFB', 'onFCP']) assert.match(clientSrc, new RegExp(`${fn}\\(`), `${fn} is wired`)
  const sends = clientSrc.match(/\bsend\(/g) ?? []
  assert.equal(sends.length, 2, 'send is defined once and called once')
  const flushBody = clientSrc.match(/function flush\(\)[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.match(flushBody, /\bsend\(/, 'the one call to send is inside flush')
  assert.match(flushBody, /current\.sent/, 'flush sends a view once')
  assert.match(clientSrc, /visibilityState === 'hidden'\) flush\(\)/, 'flush runs when the page is hidden')
  assert.match(clientSrc, /addEventListener\('pagehide', flush\)/, 'flush runs on pagehide')
  assert.match(clientSrc, /astro:before-preparation[\s\S]*flush\(\)/, 'a soft navigation sends the page it leaves')
  assert.match(clientSrc, /sendBeacon/, 'the send uses sendBeacon')
  assert.match(clientSrc, /doNotTrack/, 'Do Not Track is honoured')
  assert.match(clientSrc, /globalPrivacyControl/, 'Global Privacy Control is honoured')
  assert.match(clientSrc, /if \(privacySignalOn\(\)\) return\s+startView\('hard'\)/, 'the privacy check comes before anything is measured')
  assert.match(clientSrc, /NARROW_MAX_PX = 640/, 'narrow is at most 640 CSS px')
  assert.match(clientSrc, /window\.innerWidth <= NARROW_MAX_PX \? 'narrow' : 'wide'/, 'the only device signal is the width bucket')
  assert.match(clientSrc, /nav: current\.nav/, 'the record is labelled hard or soft')
  assert.doesNotMatch(clientSrc, /userAgent|navigator\.(platform|language|hardwareConcurrency|deviceMemory|connection)|screen\./, 'no other device signal is read')
  console.log('vitals: the client sends once on hide or navigation (never a timer), honours DNT and GPC, and reads only a width bucket')
}

/* ─────  service worker: navigations only, never HTML  ─────────────────────── */
{
  assert.ok(swRaw.split('\n').length <= 60, 'sw.js stays under 60 lines')
  assert.match(swRaw, /^\/\*[\s\S]*navigations only[\s\S]*never caches HTML/i, 'the header comment states both rules')
  assert.equal((swSrc.match(/respondWith\(/g) ?? []).length, 1, 'exactly one place answers a request')
  assert.ok(
    swSrc.indexOf("mode !== 'navigate'") !== -1 && swSrc.indexOf("mode !== 'navigate'") < swSrc.indexOf('respondWith('),
    'the navigate guard comes before respondWith',
  )
  assert.doesNotMatch(swSrc, /\.put\(|addAll\(|clients\.claim|skipWaiting|'push'|'sync'|'message'/, 'no put, addAll, claim, push or sync')
  const adds = swSrc.match(/\.add\([^)]*\)/g) ?? []
  assert.deepEqual(adds.length, 1, 'one cache write')
  assert.match(adds[0], /OFFLINE_URL/, 'the only cache write is the offline page')
  assert.match(swSrc, /const OFFLINE_URL = '\/offline\.html'/, 'the offline page is the allowlist')
  assert.match(swSrc, /caches\.delete\(name\)/, 'activate cleans older caches by name')

  // Behaviour: run the real file against a fake worker scope.
  const listeners = {}
  const added = []
  const deleted = []
  let networkUp = true
  const scope = {
    self: { addEventListener: (type, fn) => { listeners[type] = fn } },
    Request: class { constructor(url, init) { this.url = url; this.init = init } },
    caches: {
      open: async () => ({ add: async request => { added.push(request.url) } }),
      keys: async () => ['offline-v1', 'offline-v0', 'something-else'],
      delete: async name => { deleted.push(name) },
      match: async (url, options) => ({ offlinePage: url, cacheName: options?.cacheName }),
    },
    fetch: async request => {
      if (!networkUp) throw new TypeError('network down')
      return { fromNetwork: request.mode }
    },
  }
  vm.runInNewContext(swRaw, scope)

  const run = async (type, event) => { listeners[type](event); return event }
  const install = await run('install', { waitUntil(p) { this.done = p } })
  await install.done
  assert.deepEqual(added, ['/offline.html'], 'install keeps the offline page and nothing else')
  const activate = await run('activate', { waitUntil(p) { this.done = p } })
  await activate.done
  assert.deepEqual(deleted.sort(), ['offline-v0', 'something-else'], 'activate deletes every cache but its own')

  const ask = async (mode) => {
    const event = { request: { mode }, answered: undefined, respondWith(p) { this.answered = p } }
    listeners.fetch(event)
    return event.answered === undefined ? undefined : await event.answered
  }
  for (const mode of ['no-cors', 'cors', 'same-origin', 'websocket']) {
    assert.equal(await ask(mode), undefined, `a ${mode} request is left alone`)
  }
  assert.deepEqual(await ask('navigate'), { fromNetwork: 'navigate' }, 'an online navigation is the network response')
  networkUp = false
  const offline = await ask('navigate')
  assert.equal(offline.offlinePage, '/offline.html', 'an offline navigation gets the offline page')
  assert.equal(offline.cacheName, 'offline-v1', 'from the worker\'s own cache')
  assert.equal(await ask('cors'), undefined, 'an offline non-navigation is still left alone')
  console.log('vitals: sw.js answers navigations only, falls back to /offline.html only when the network fails, and caches nothing else')
}

/* ─────  registration, manifest, offline page, copy  ───────────────────────── */
{
  const reg = code(await read('src/lib/sw-register.ts'))
  assert.match(reg, /import\.meta\.env\.DEV/, 'no registration in dev')
  assert.match(reg, /'serviceWorker' in navigator/, 'only where service workers exist')
  assert.match(reg, /register\('\/sw\.js'\)/, 'registers /sw.js at the root scope')
  assert.match(reg, /try \{[\s\S]*\} catch/, 'registration is wrapped in try/catch')
  assert.match(reg, /addEventListener\('load', register/, 'registers after load')
  assert.doesNotMatch(reg, /console\./, 'no console noise')
  for (const layout of ['src/layouts/Base.astro', 'src/layouts/ToolBase.astro']) {
    assert.match(await read(layout), /import '\.\.\/lib\/sw-register\.ts'/, `${layout} loads the registration`)
  }

  const manifest = JSON.parse(await read('public/site.webmanifest'))
  assert.equal(manifest.display, 'standalone')
  for (const size of ['192x192', '512x512']) {
    const purposes = manifest.icons.filter(icon => icon.sizes === size).map(icon => icon.purpose).sort()
    assert.deepEqual(purposes, ['any', 'maskable'], `the ${size} icon has both purposes`)
  }

  const offlinePage = await read('public/offline.html')
  assert.doesNotMatch(offlinePage, /<script|animation|https?:\/\/|<link/i, 'the offline page has no script, motion or outside request')
  assert.match(offlinePage, /You are offline\./)
  assert.match(offlinePage, /This page could not load\. Try again when you are back online\./)

  const terms = await read('src/pages/terms.astro')
  assert.match(terms, /counted into a fixed range/, '/terms says speed is counted into fixed ranges')
  assert.match(terms, /<h2>Offline page<\/h2>/, '/terms says what the offline page keeps')
  console.log('vitals: registration is guarded and silent, the manifest has both icon purposes, the offline page is script-free, /terms says both')
}
