// Independent review of r5 liquid light. Shares no code with the agent's own checks.
// usage: node r5-review.mjs [hours|phone|reduced|nogl|low|all]
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
const { chromium } = await import(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs'))
const GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-lcd-text']
const SIM = !!process.env.SIM
const URL0 = 'file://' + process.cwd() + '/r5/hero-lab-r5.html?c=liquid' + (SIM ? '&fixed=0.2' : '') + (process.env.Q || '')
const HOURS = (process.env.HOURS || '06:15,12:30,18:20,23:30').split(',')
const OUT = process.env.OUT || 'shots-r5-review'
mkdirSync(OUT, { recursive: true })
const only = process.argv[2] || 'all'
const want = (k) => only === 'all' || only === k

const PICK = { name: 'h1', tagline: '.lq-tagline', clock: '.hl-clock-line', nav: '.fake-nav' }
const HIDE = Object.values(PICK).map((s) => `${s}, ${s} *`).join(', ') +
  ' { color: transparent !important; text-shadow: none !important; -webkit-text-stroke: 0 !important; }'

function watch(page, tag) {
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_CERT|ERR_TUNNEL|ERR_PROXY/.test(m.text())) errs.push(m.text().slice(0, 160)) })
  return () => (errs.length ? `${tag} ERRORS ${JSON.stringify(errs)}` : null)
}

async function boxes(page) {
  return page.evaluate((pick) => {
    const out = {}
    for (const [k, sel] of Object.entries(pick)) {
      const el = document.querySelector(sel)
      if (!el || !el.textContent.trim()) continue
      const r = document.createRange(); r.selectNodeContents(el)
      const rects = [...r.getClientRects()].filter((q) => q.width > 2 && q.height > 2).map((q) => [q.left, q.top, q.width, q.height])
      let op = 1
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= +getComputedStyle(n).opacity
      const m = getComputedStyle(el).color.match(/[\d.]+/g).map(Number)
      out[k] = { rects, rgba: [m[0], m[1], m[2], m.length > 3 ? m[3] : 1], opacity: op, px: getComputedStyle(el).fontSize }
    }
    return out
  }, PICK)
}

async function bgShot(page) {
  await page.evaluate((css) => {
    const s = document.createElement('style'); s.id = 'rv-hide'; s.textContent = css; document.head.appendChild(s)
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  }, HIDE)
  const buf = await page.screenshot()
  await page.evaluate(() => document.getElementById('rv-hide').remove())
  return buf
}

// Runs inside a blank decoder page so the hero page is not perturbed.
async function analyzeIn({ b64, boxes, keepAs, diffWith }) {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
  const W = img.width, H = img.height
  const cv = new OffscreenCanvas(W, H), x = cv.getContext('2d', { willReadFrequently: true })
  x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, W, H).data
  const LUT = new Float32Array(256)
  for (let i = 0; i < 256; i++) { const v = i / 255; LUT[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const lum = (i) => 0.2126 * LUT[d[i]] + 0.7152 * LUT[d[i + 1]] + 0.0722 * LUT[d[i + 2]]
  let sum = 0, ink = 0, hot = 0; const bins = new Float64Array(12)
  for (let i = 0; i < d.length; i += 4) {
    const L = lum(i); sum += L; if (L > 0.02) ink++; if (L > 0.35) hot++
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), ch = mx - Math.min(r, g, b)
    if (ch > 20) {
      const h = mx === r ? ((g - b) / ch + 6) % 6 : mx === g ? (b - r) / ch + 2 : (r - g) / ch + 4
      bins[Math.floor(h * 2) % 12] += ch
    }
  }
  const n = W * H, ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  const res = {}
  for (const [k, bx] of Object.entries(boxes)) {
    const Ls = []
    for (const [l, t, w, h] of bx.rects) {
      for (let y = Math.max(0, t | 0); y < Math.min(H, t + h); y++) {
        for (let xx = Math.max(0, l | 0); xx < Math.min(W, l + w); xx++) Ls.push(lum((y * W + xx) * 4))
      }
    }
    if (!Ls.length) continue
    Ls.sort((a, b) => a - b)
    const p95 = Ls[Math.floor(Ls.length * 0.95)], top = Ls[Ls.length - 1]
    const a = bx.rgba[3] * bx.opacity
    const Lt = 0.2126 * LUT[bx.rgba[0]] + 0.7152 * LUT[bx.rgba[1]] + 0.0722 * LUT[bx.rgba[2]]
    res[k] = `${ratio(a * Lt + (1 - a) * p95, p95).toFixed(1)}/${ratio(a * Lt + (1 - a) * top, top).toFixed(1)}`
  }
  let motion = null
  if (diffWith && self[diffWith]) {
    const p = self[diffWith]; let s = 0, c = 0
    for (let i = 0; i < d.length; i += 16) { s += Math.abs(d[i] - p[i]) + Math.abs(d[i + 1] - p[i + 1]) + Math.abs(d[i + 2] - p[i + 2]); c++ }
    motion = (s / c / 3).toFixed(2)
  }
  if (keepAs) self[keepAs] = d
  const tot = bins.reduce((a, b) => a + b, 0) || 1
  const hue = [...bins].map((v, i) => [i * 30, v / tot]).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .filter(([, f]) => f > 0.08).map(([dg, f]) => `${dg}°:${Math.round(f * 100)}%`).join(' ')
  return { mean: +(sum / n).toFixed(3), ink: +((ink / n) * 100).toFixed(1), hot: +((hot / n) * 100).toFixed(1), hue, contrast: res, motion }
}

let dec
async function sample(page, label, opt = {}) {
  const bx = await boxes(page)
  const buf = await bgShot(page)
  const r = await dec.evaluate(analyzeIn, { b64: buf.toString('base64'), boxes: bx, ...opt })
  console.log(label.padEnd(22), `mean ${r.mean} ink ${r.ink}% hot ${r.hot}% hue ${r.hue}`,
    r.motion !== null ? `motion ${r.motion}` : '', 'contrast p95/max', JSON.stringify(r.contrast))
  return r
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
function clockFrom(page, sim = SIM) {
  if (sim) return async (ms) => {
    await page.evaluate((t) => { window.__lqStopAt = t }, ms / 1000)
    await page.waitForFunction((t) => (window.__lqT || 0) >= t - 1e-6, ms / 1000, { timeout: 300000, polling: 250 })
    await page.waitForTimeout(150)
  }
  const t0 = Date.now(); return (ms) => new Promise((r) => setTimeout(r, Math.max(0, t0 + ms - Date.now())))
}
const hold = (ctx) => SIM && ctx.addInitScript(() => { window.__lqStopAt = 0.001 })

async function run(args, ctxOpt, fn) {
  const b = await chromium.launch({ args })
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ...ctxOpt })
  dec = await ctx.newPage()
  try { await fn(ctx) } finally { await b.close() }
}

if (want('hours')) await run(GL, {}, async (ctx) => {
  await hold(ctx)
  for (const at of HOURS) {
    const p = await ctx.newPage(), bad = watch(p, at)
    await p.goto(`${URL0}&scale=0.85&at=${at}`); const until = clockFrom(p)
    await until(3000); await sample(p, `desk ${at} 3s`, { keepAs: 'f3' })
    await until(8000); await sample(p, `desk ${at} 8s`, { diffWith: 'f3', keepAs: 'f8' })
    await p.screenshot({ path: `${OUT}/desk-${at.replace(':', '')}.png` })
    await until(15000); await sample(p, `desk ${at} 15s`, { diffWith: 'f8' })
    console.log(`desk ${at} overflow`, await overflow(p), bad() || 'no errors')
    await p.close()
  }
})

if (want('long')) await run(GL, {}, async (ctx) => {
  await hold(ctx)
  const p = await ctx.newPage(), bad = watch(p, 'long')
  await p.goto(`${URL0}&scale=0.85&at=18:20`); const until = clockFrom(p)
  for (const t of [20, 30, 45, 60]) {
    await until(t * 1000); await sample(p, `long 18:20 ${t}s`)
    if (t === 60 || t === 30) await p.screenshot({ path: `${OUT}/long-1820-${t}s.png` })
  }
  console.log('long', bad() || 'no errors')
})

if (want('phone')) await run(GL, { viewport: { width: 390, height: 844 }, hasTouch: true }, async (ctx) => {
  await hold(ctx)
  for (const at of ['06:15', '23:30']) {
    const p = await ctx.newPage(), bad = watch(p, 'phone')
    await p.goto(`${URL0}&scale=0.5&at=${at}`); const until = clockFrom(p)
    await until(8000); await sample(p, `phone ${at} 8s`)
    await p.screenshot({ path: `${OUT}/phone-${at.replace(':', '')}.png` })
    console.log(`phone ${at} overflow`, await overflow(p), bad() || 'no errors')
    await p.close()
  }
})

if (want('reduced')) await run(GL, { reducedMotion: 'reduce' }, async (ctx) => {
  const p = await ctx.newPage(), bad = watch(p, 'reduced')
  await p.goto(`${URL0}&scale=0.85&at=18:20`); const until = clockFrom(p, false)
  await until(3000); await sample(p, 'reduced 18:20 3s', { keepAs: 'r1' })
  await until(6000); await sample(p, 'reduced 18:20 6s', { diffWith: 'r1' })
  await p.screenshot({ path: `${OUT}/reduced-1820.png` })
  await p.focus('.hl-clock-track')
  for (let i = 0; i < 6; i++) await p.keyboard.press('PageUp')
  await p.waitForTimeout(1500)
  await sample(p, 'reduced scrub +6h', { diffWith: 'r1' })
  await p.screenshot({ path: `${OUT}/reduced-scrubbed.png` })
  console.log('reduced overflow', await overflow(p), bad() || 'no errors')
})

if (want('nogl')) await run(['--disable-3d-apis', '--disable-webgl'], {}, async (ctx) => {
  for (const at of ['06:15', '23:30']) {
    const p = await ctx.newPage(), bad = watch(p, 'nogl')
    await p.goto(`${URL0}&at=${at}`); await p.waitForTimeout(2000)
    const fb = await p.evaluate(() => !!document.querySelector('.lq-fallback'))
    await sample(p, `nogl ${at} fallback=${fb}`)
    await p.screenshot({ path: `${OUT}/nogl-${at.replace(':', '')}.png` })
    console.log(`nogl ${at}`, bad() || 'no errors')
    await p.close()
  }
})

if (want('low')) await run(GL, {}, async (ctx) => {
  await hold(ctx)
  await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 4 }))
  const p = await ctx.newPage(), bad = watch(p, 'low')
  await p.goto(`${URL0}&scale=0.5&at=12:30`); const until = clockFrom(p)
  await until(8000); await sample(p, 'lowPower 12:30 8s')
  await p.screenshot({ path: `${OUT}/low-1230.png` })
  console.log('low', bad() || 'no errors')
})
