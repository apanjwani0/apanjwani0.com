// Ink must survive a URL-bar-sized resize and a rotation.
import { execSync } from 'node:child_process'
import { join } from 'node:path'
const { chromium } = await import(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs'))
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-lcd-text'] })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
await ctx.addInitScript(() => { window.__lqStopAt = 0.001 })
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)))
await p.goto('file://' + process.cwd() + '/r5/hero-lab-r5.html?c=liquid&fixed=0.2&scale=0.5&at=18:20')
const until = async (t) => { await p.evaluate((x) => { window.__lqStopAt = x }, t); await p.waitForFunction((x) => (window.__lqT || 0) >= x - 1e-6, t, { timeout: 300000, polling: 200 }) }
const ink = () => p.locator('.lq-canvas').screenshot().then(async (buf) => {
  const q = await ctx.newPage()
  const r = await q.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
    const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, img.width, img.height).data; let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 90) n++
    return (n / (d.length / 4) * 100).toFixed(1)
  }, buf.toString('base64')); await q.close(); return r
})
await until(8); console.log('8s before resize, ink %', await ink())
await p.setViewportSize({ width: 390, height: 780 }); await p.waitForTimeout(400)
console.log('after URL-bar resize (844 -> 780), ink %', await ink())
await until(8.4); console.log('0.4s later, ink %', await ink())
await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(400)
await until(8.8); console.log('after rotation to landscape, ink %', await ink())
console.log('errors', errs.length ? errs : 'none')
await b.close()
