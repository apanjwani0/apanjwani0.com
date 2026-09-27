import { execSync } from 'node:child_process'
import { join } from 'node:path'
const { chromium } = await import(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs'))
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-lcd-text'] })
const [page = 'hero-lab-r4.html', synthetic = '0', shotsAt = ''] = process.argv.slice(2)
const p = await b.newPage({ viewport: { width: 1100, height: 700 } })
const errs = []
p.on('pageerror', (e) => errs.push(String(e)))
await p.addInitScript((syn) => {
  addEventListener('load', () => { window.__loadAt = performance.now() })
  if (!syn) return
  const nav = { name: location.href, entryType: 'navigation', startTime: 0, domainLookupStart: 10, domainLookupEnd: 32, connectStart: 32, secureConnectionStart: 58, connectEnd: 90,
    requestStart: 91, responseStart: 211, responseEnd: 230, domContentLoadedEventEnd: 400, transferSize: 38000, decodedBodySize: 120000, nextHopProtocol: 'h2' }
  const orig = Performance.prototype.getEntriesByType
  Performance.prototype.getEntriesByType = function (t) { return t === 'navigation' ? [nav] : t === 'paint' ? [{ name: 'first-contentful-paint', startTime: 420 }] : orig.call(this, t) }
}, synthetic === '1')
await p.goto('file://' + process.cwd() + '/' + page + '?c=network')
// Poll in-page (no screenshots) so the timing is the page's own clock.
const log = await p.evaluate(() => new Promise((resolve) => {
  const out = [], seen = new Set()
  const tick = () => {
    const t = Math.round(performance.now() - window.__loadAt)
    document.querySelectorAll('.nw-row.nw-on').forEach((r, i) => { const k = r.querySelector('b').textContent; if (!seen.has(k)) { seen.add(k); out.push(t + 'ms  ' + r.textContent.replace(/\s+/g, ' ').trim()) } })
    if (t > 9000) resolve(out); else setTimeout(tick, 25)
  }
  tick()
}))
console.log(log.join('\n'))
console.log('errors', errs.length ? errs : 'none')
await b.close()
