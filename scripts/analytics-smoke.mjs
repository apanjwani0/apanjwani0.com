import assert from 'node:assert/strict'
import {
  normalizeAnalyticsEvent,
  parseAnalyticsPath,
  pruneAnalytics,
  summarizeAnalytics,
  updateAnalyticsAggregate,
} from '../src/lib/analytics.ts'

assert.deepEqual(parseAnalyticsPath('/tools/json-tidy'), {
  kind: 'tool',
  slug: 'json-tidy',
  path: '/tools/json-tidy',
})
assert.equal(parseAnalyticsPath('/blogs/test'), null)

const event = normalizeAnalyticsEvent({
  kind: 'game',
  slug: '2048',
  path: '/games/2048',
  directEntry: true,
  metrics: { loadMs: 1000.49, ttfbMs: 120, cls: 0.03, bad: 1 },
})

assert.ok(event)
assert.deepEqual(event.metrics, { loadMs: 1000.49, ttfbMs: 120, cls: 0.03 })

const first = updateAnalyticsAggregate(null, event, new Date('2026-08-11T00:00:00.000Z'))
const second = updateAnalyticsAggregate(first, {
  ...event,
  directEntry: false,
  metrics: { loadMs: 500, routeMs: 40 },
}, new Date('2026-08-11T00:01:00.000Z'))

assert.equal(second.views, 2)
assert.equal(second.directEntries, 1)
assert.equal(second.metrics.loadMs?.count, 2)

const [summary] = summarizeAnalytics([second])
assert.equal(summary.slug, '2048')
assert.equal(summary.directRate, 50)
assert.equal(summary.avgLoadMs, 750.25)
assert.equal(summary.avgRouteMs, 40)

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

console.log('analytics smoke ok')
