// Drag and click on the live sim at exact sim times; shots before/after.
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
const { chromium } = await import(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs'))
const OUT = 'shots-r5-v2'; mkdirSync(OUT, { recursive: true })
const MODE = process.env.MODE || 'drag'
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-lcd-text'] })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { window.__lqStopAt = 0.001 })
const p = await ctx.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(String(e)))
await p.goto('file://' + process.cwd() + '/r5/hero-lab-r5.html?c=liquid&fixed=0.2&scale=0.85&at=18:20' + (process.env.TUNEQ ? '&tune=' + process.env.TUNEQ : ''))
const until = async (t) => { await p.evaluate((x) => { window.__lqStopAt = x }, t); await p.waitForFunction((x) => (window.__lqT || 0) >= x - 1e-6, t, { timeout: 300000, polling: 200 }) }
await until(6)
const box = await p.locator('.lq-canvas').boundingBox()
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy]
// a sweeping drag through the middle, 40 moves
let [x, y] = at(0.2, 0.35)
if (MODE !== 'click') {
  await p.mouse.move(x, y); await p.mouse.down()
  // 'slow' paces the moves like a real hand: 40 moves over ~0.65 s
  for (let i = 1; i <= 40; i++) { const t = i / 40; [x, y] = at(0.2 + 0.6 * t, 0.35 - 0.15 * Math.sin(t * Math.PI)); await p.mouse.move(x, y); if (MODE === 'slow') await p.waitForTimeout(16) }
  await p.mouse.up()
}
if (MODE !== 'slow') { [x, y] = at(0.66, 0.3); await p.mouse.click(x, y) }
await until(6.4); await p.screenshot({ path: `${OUT}/${MODE}${process.env.TAG || ''}-0.4s.png` })
await until(8); await p.screenshot({ path: `${OUT}/${MODE}${process.env.TAG || ''}-2s.png` })
await until(12); await p.screenshot({ path: `${OUT}/${MODE}${process.env.TAG || ''}-6s.png` })
console.log('interact errors', errs.length ? errs : 'none')
await b.close()
