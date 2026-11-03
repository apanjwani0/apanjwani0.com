/**
 * Page sweep: load every page in the sitemap (or the paths given) in headless
 * Chromium at a laptop and a phone size, and report what a reviewer checks
 * first: HTTP status, layout shift, horizontal overflow, console errors, the
 * h1 count, and the title and description against search-result budgets.
 *
 * Not part of the gate (it needs a browser). Used by the review step in
 * docs/plans/autonomous-runbook.md. Playwright is deliberately not a
 * dependency; install it for the run without touching package.json:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   npm run build && HOST=127.0.0.1 PORT=4399 node dist/server/entry.mjs &
 *   node scripts/page-sweep.mjs http://127.0.0.1:4399            # every sitemap URL
 *   node scripts/page-sweep.mjs http://127.0.0.1:4399 /tools /games/2048
 *
 * One JSON line per page and viewport; a closing line lists only the problems.
 * Exit code 1 when any page has a problem, so a run can gate on it.
 */
import { chromium } from 'playwright'

const base = (process.argv[2] || 'http://127.0.0.1:4399').replace(/\/$/, '')
let paths = process.argv.slice(3)
if (!paths.length) {
  const xml = await (await fetch(`${base}/sitemap.xml`)).text()
  paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname)
}

const VIEWPORTS = [
  ['laptop', { viewport: { width: 1440, height: 900 } }],
  ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
]
// Local-only noise, not page problems: the analytics beacon is refused off its
// own origin (a same-origin 403 on every page), and the home hero reads
// Cloudflare's /cdn-cgi/trace, which exists only behind the edge (a 404 here).
const IGNORED = /\/api\/analytics\/|status of 403|status of 404/

const browser = await chromium.launch()
const problems = []
for (const path of paths) {
  for (const [name, opts] of VIEWPORTS) {
    const ctx = await browser.newContext(opts)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e).slice(0, 160)))
    page.on('console', m => { if (m.type() === 'error' && !IGNORED.test(m.text())) errors.push(m.text().slice(0, 160)) })
    // A failed resource is reported by URL, so the one expected 404 can be told apart.
    page.on('response', r => { if (r.status() >= 400 && !/\/api\/analytics\/|\/cdn-cgi\/trace/.test(r.url())) errors.push(`${r.status()} ${r.url().replace(base, '')}`) })
    await page.addInitScript(() => {
      window.__cls = 0
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value
      }).observe({ type: 'layout-shift', buffered: true })
    })
    const res = await page.goto(base + path, { waitUntil: 'networkidle' }).catch(e => ({ status: () => 0, err: String(e) }))
    await page.waitForTimeout(1200)
    const m = await page.evaluate(() => ({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content ?? '',
      h1: document.querySelectorAll('h1').length,
      cls: Math.round(window.__cls * 1000) / 1000,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    })).catch(() => ({}))
    const row = { path, viewport: name, status: res.status(), ...m, titleLength: m.title?.length, descriptionLength: m.description?.length, errors }
    delete row.title; delete row.description
    const issues = []
    if (row.status !== 200) issues.push(`status ${row.status}`)
    if (row.cls > 0.1) issues.push(`CLS ${row.cls}`)
    if (row.overflow > 0) issues.push(`overflows by ${row.overflow}px`)
    if (row.h1 !== 1) issues.push(`${row.h1} h1 elements`)
    if (row.titleLength > 60) issues.push(`title ${row.titleLength} chars`)
    if (row.descriptionLength > 160) issues.push(`description ${row.descriptionLength} chars`)
    if (errors.length) issues.push(`${errors.length} console error(s)`)
    if (issues.length) problems.push(`${path} [${name}]: ${issues.join(', ')}`)
    console.log(JSON.stringify(row))
    await ctx.close()
  }
}
await browser.close()
console.log(JSON.stringify({ pages: paths.length, problems }))
process.exit(problems.length ? 1 : 0)
