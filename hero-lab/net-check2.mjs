import { execSync } from 'node:child_process'
import { join } from 'node:path'
const { chromium } = await import(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs'))
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-lcd-text'] })
const url = 'file://' + process.cwd() + '/hero-lab-r4.html?c=network'
const tag = process.argv[2] || 'v2'
async function run(w, h, name, opts, steps) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, ...opts })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e)))
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_FILE|Failed to fetch/.test(m.text())) errs.push(m.text().slice(0, 160)) })
  await p.goto(url)
  let t = 0
  for (const [at, shot, action] of steps) {
    await p.waitForTimeout(at - t); t = at
    if (action) await action(p)
    if (shot) await p.screenshot({ path: `shots-r4/${tag}-${name}-${shot}.png` })
  }
  const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  const info = await p.evaluate(() => ({ cls: (document.querySelector('.nw-root') || {}).className, coarse: matchMedia('(pointer: coarse)').matches, vw: innerWidth }))
  console.log(name, JSON.stringify(info))
  console.log(name, 'overflow', ov, 'errors', errs.filter((e) => !/ERR_CERT|URL scheme "file"/.test(e)).length ? errs : 'none (fonts cert + file:// ping only)')
  await ctx.close()
}
const clickEmpty = async (p) => { const r = await p.locator('#stage').boundingBox(); await p.mouse.click(r.x + r.width * 0.55, r.y + r.height * 0.62) }
await run(1440, 900, 'd', {}, [[1400, 'a'], [2600, 'b'], [4200, 'c'], [11000, 'done'], [11100, null, clickEmpty], [11500, 'ping']])
await run(390, 844, 'm', { hasTouch: true, deviceScaleFactor: 2 }, [[2600, 'b'], [11000, 'done']])
await run(1280, 800, 'l', {}, [[11000, 'done']])
await run(1024, 768, 't', {}, [[11000, 'done']])
await run(1440, 900, 'r', { reducedMotion: 'reduce' }, [[1500, 'reduced']])
await run(375, 667, 's', { hasTouch: true }, [[11000, 'done']])
await b.close()
