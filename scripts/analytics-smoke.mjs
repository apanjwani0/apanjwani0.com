import assert from 'node:assert/strict'
import {
  normalizeAnalyticsEvent,
  parseAnalyticsPath,
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

console.log('analytics smoke ok')
