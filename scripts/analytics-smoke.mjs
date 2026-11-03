import assert from 'node:assert/strict'
import {
  capAnalyticsStore,
  estimateP75,
  normalizeAnalyticsEvent,
  parseAnalyticsPath,
  pruneAnalytics,
  summarizeAnalytics,
  updateAnalyticsAggregate,
  vitalBucketIndex,
} from '../src/lib/analytics.ts'

assert.deepEqual(parseAnalyticsPath('/tools/json-tidy'), {
  kind: 'tool',
  slug: 'json-tidy',
  path: '/tools/json-tidy',
})
// Every other page folds into a fixed bucket; a visited URL never becomes a key.
assert.deepEqual(parseAnalyticsPath('/'), { kind: 'page', slug: null, path: '/' })
assert.equal(parseAnalyticsPath('/blogs/test')?.path, '/blogs/*')
assert.equal(parseAnalyticsPath('/learnings/some-article/')?.path, '/learnings/*')
assert.equal(parseAnalyticsPath('/wp-login.php')?.path, 'other')
assert.equal(parseAnalyticsPath('/tools/json-tidy?x=1'), null)

const event = normalizeAnalyticsEvent({
  path: '/games/2048',
  nav: 'hard',
  vp: 'narrow',
  directEntry: true,
  metrics: { lcpMs: 1000.49, ttfbMs: 120, cls: 0.03, routeMs: 5, bad: 1 },
  ip: '203.0.113.9',
})

assert.ok(event)
assert.equal(event.kind, 'game')
assert.equal(event.slug, '2048')
// A hard load has no route time, and an unknown metric is never copied.
assert.deepEqual(event.metrics, { lcpMs: 1000.49, ttfbMs: 120, cls: 0.03 })

const first = updateAnalyticsAggregate(null, event, new Date('2026-08-11T00:00:00.000Z'))
const second = updateAnalyticsAggregate(first, {
  ...event,
  directEntry: false,
  metrics: { lcpMs: 3000, cls: 0.5, inpMs: 250 },
}, new Date('2026-08-11T00:01:00.000Z'))

assert.equal(second.views, 2)
assert.equal(second.directEntries, 1)
assert.deepEqual(second.hist.lcpMs, [1, 0, 1, 0])
assert.deepEqual(second.hist.cls, [1, 0, 1])
assert.deepEqual(second.hist.inpMs, [0, 1, 0])
assert.deepEqual(second.hist.ttfbMs, [1, 0, 0])

// A soft navigation carries only what it can have.
const soft = normalizeAnalyticsEvent({ path: '/tools/json-tidy', nav: 'soft', vp: 'wide', metrics: { routeMs: 400, lcpMs: 1, cls: 0 } })
assert.deepEqual(soft?.metrics, { routeMs: 400 })
// Anything outside the fixed vocabulary rejects the whole event.
assert.equal(normalizeAnalyticsEvent({ path: '/', nav: 'sideways', vp: 'wide', metrics: {} }), null)
assert.equal(normalizeAnalyticsEvent({ path: '/', nav: 'hard', vp: 'phone', metrics: {} }), null)
assert.equal(normalizeAnalyticsEvent({ nav: 'hard', vp: 'wide' }), null)
// Values are clamped or dropped, never stored as sent.
assert.deepEqual(normalizeAnalyticsEvent({ path: '/', nav: 'hard', vp: 'wide', metrics: { lcpMs: -5, cls: Number.NaN, inpMs: '9', ttfbMs: 1e12 } })?.metrics, { ttfbMs: 600000 })

// Bucket edges are inclusive upper bounds: Google's "good" value lands in the good bucket.
assert.equal(vitalBucketIndex('lcpMs', 2500), 1)
assert.equal(vitalBucketIndex('lcpMs', 2500.01), 2)
assert.equal(vitalBucketIndex('cls', 0.1), 0)
assert.equal(vitalBucketIndex('inpMs', 200), 0)
assert.equal(vitalBucketIndex('inpMs', 99999), 2)

// p75 is the bucket holding the 75th-percentile measurement.
assert.equal(estimateP75('lcpMs', [0, 0, 0, 0]), null)
assert.equal(estimateP75('lcpMs', [3, 1, 0, 0]), 'up to 1200 ms')
assert.equal(estimateP75('lcpMs', [1, 2, 1, 0]), '1200 to 2500 ms')
assert.equal(estimateP75('cls', [1, 0, 3]), 'over 0.25')

const [summary] = summarizeAnalytics([second])
assert.equal(summary.path, '/games/2048')
assert.equal(summary.directRate, 50)
assert.equal(summary.vitals.lcpMs.n, 2)
assert.equal(summary.vitals.lcpMs.p75, '2500 to 4000 ms')
assert.equal(summary.vitals.routeMs.p75, null)

// Retention: the local store is rewritten whole on every public page view, so a day
// that is never dropped is a day every later request pays to read and write again.
const now = new Date('2026-08-13T00:00:00.000Z')
const stale = { ...second, date: '2026-01-01' }
const fresh = { ...second, date: '2026-08-12' }
const kept = pruneAnalytics({ old: stale, new: fresh, junk: null }, now)
assert.deepEqual(Object.keys(kept), ['new'])
// The boundary day itself survives — retention is "older than", not "at least".
const edge = { ...second, date: '2026-05-15' }
assert.deepEqual(Object.keys(pruneAnalytics({ edge }, now, 90)), ['edge'])
assert.deepEqual(Object.keys(pruneAnalytics({ edge }, now, 89)), [])

// File cap: the oldest whole days go first, and the newest day always stays.
const day = d => ({ ...second, date: d })
const store = { a: day('2026-08-10'), b: day('2026-08-11'), c: day('2026-08-12') }
const oneRow = JSON.stringify({ c: store.c }).length
assert.deepEqual(Object.keys(capAnalyticsStore(store, 10 ** 6)), ['a', 'b', 'c'])
assert.deepEqual(Object.keys(capAnalyticsStore(store, oneRow * 2 + 4)), ['b', 'c'])
assert.deepEqual(Object.keys(capAnalyticsStore(store, 1)), ['c'])

console.log('analytics smoke ok')
