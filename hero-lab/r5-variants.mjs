// Shoot tuning variants in parallel at exact sim times, then build a contact sheet.
// usage: VARIANTS=variants.json AT=18:20 TIMES=8,15 TAG=a node r5-variants.mjs
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { readFileSync, mkdirSync } from 'node:fs'
const { chromium } = await import(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs'))
const V = JSON.parse(readFileSync(process.env.VARIANTS || 'variants.json', 'utf8'))
const AT = process.env.AT || '18:20', TIMES = (process.env.TIMES || '8,15').split(',').map(Number)
const TAG = process.env.TAG || 'a', OUT = 'shots-r5-var'
const W = +(process.env.W || 1440), H = +(process.env.H || 900)
mkdirSync(OUT, { recursive: true })
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-lcd-text'] })
const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: W < 600 })
const base = 'file://' + process.cwd() + '/r5/hero-lab-r5.html?c=liquid&fixed=0.2&scale=' + (W < 600 ? '0.5' : '0.85')
const pages = []
for (const [name, spec] of Object.entries(V)) {
  const m = /^@(\d\d:\d\d)\s*(.*)$/.exec(spec), at = m ? m[1] : AT, tune = m ? m[2] : spec
  const p = await ctx.newPage()
  await p.addInitScript((t) => { window.__lqStopAt = t }, TIMES[0])
  await p.goto(base + '&at=' + at + (tune ? '&tune=' + encodeURIComponent(tune) : ''))
  pages.push({ name, tune, p })
}
const shots = {}
for (const T of TIMES) {
  await Promise.all(pages.map(async ({ name, p }) => {
    await p.evaluate((t) => { window.__lqStopAt = t }, T)
    await p.waitForFunction((t) => (window.__lqT || 0) >= t - 1e-6, T, { timeout: 300000, polling: 250 })
    await p.waitForTimeout(150)
    const file = `${OUT}/${TAG}-${AT.replace(':', '')}-${T}s-${name}.png`
    await p.locator('#stage').screenshot({ path: file })
    ;(shots[T] ||= []).push([name, file])
  }))
}
for (const T of TIMES) {
  const list = shots[T].sort((a, b) => a[0].localeCompare(b[0]))
  const cols = list.length > 4 ? 3 : 2, cw = Math.floor(1440 / cols)
  const html = '<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(' + cols + ',' + cw + 'px);gap:4px;font:13px monospace;color:#eee">' +
    list.map(([n, f]) => `<div><img style="width:${cw}px;display:block" src="data:image/png;base64,${readFileSync(f).toString('base64')}"><div style="padding:2px 6px">${n} · ${(V[n] || 'baseline').replace(/</g, '')}</div></div>`).join('') + '</body>'
  const sp = await ctx.newPage()
  await sp.setViewportSize({ width: 1440 + 8, height: 400 })
  await sp.setContent(html); await sp.waitForTimeout(300)
  await sp.screenshot({ path: `${OUT}/${TAG}-sheet-${AT.replace(':', '')}-${T}s.png`, fullPage: true })
  console.log('sheet', `${OUT}/${TAG}-sheet-${AT.replace(':', '')}-${T}s.png`)
}
await b.close()
