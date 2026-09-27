// Smoke-agent test harness. Not part of the repo; scratch only.
import { chromium } from 'playwright' // any local Playwright install
import { writeFile } from 'node:fs/promises'

const OUT = './out'

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-lcd-text'],
})
const page = await browser.newPage({ viewport: { width: 960, height: 600 } })
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()) })
page.on('pageerror', (e) => console.log('pageerror:', e.message))

await page.goto('http://127.0.0.1:4321/robots.txt')
await page.setContent('<!doctype html><body style="margin:0;background:#000"><canvas id="c" width="960" height="600"></canvas></body>')

const result = await page.evaluate(async () => {
  const glMod = await import('/src/components/home/hero/monsoon/gl.ts')
  const smokeMod = await import('/src/components/home/hero/monsoon/smoke.ts')
  const canvas = document.getElementById('c')
  const kit = glMod.createKit(canvas)
  if (!kit) return { error: 'createKit returned null' }
  if (!kit.floatTargets) return { error: 'no floatTargets on this device' }
  const smoke = smokeMod.createSmoke(kit, { lowPower: false })
  if (!smoke) return { error: 'createSmoke returned null despite floatTargets' }

  smoke.resize(canvas.width, canvas.height)

  // Harness-only: draw density (.r) as white-on-black with a mild tonemap
  // so faint trailing smoke is still visible.
  const disp = kit.program(`
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() {
  float d = texture(uTex, vUv).r;
  float v = 1.0 - exp(-max(d, 0.0) * 1.5);
  outColor = vec4(vec3(v), 1.0);
}`)

  function drawDisplay() {
    kit.bind(null)
    disp.use()
    kit.gl.activeTexture(kit.gl.TEXTURE0)
    kit.gl.bindTexture(kit.gl.TEXTURE_2D, smoke.texture)
    kit.gl.uniform1i(disp.u.uTex, 0)
    kit.draw()
  }

  function sourcesAt(t) {
    const s = []
    if (t >= 0 && t < 4) s.push({ u: 0.6, v: 0.25, du: 0, dv: 0, radius: 0.006, density: 0.08, puff: false })
    if (t >= 1 && t < 3) {
      const frac = (t - 1) / 2
      s.push({ u: 0.3 + 0.2 * frac, v: 0.3, du: 0.1, dv: 0, radius: 0.01, density: 0.35, puff: false })
    }
    return s
  }

  const dt = 1 / 60
  let t = 0
  const shots = {}

  function stepTo(targetT, extra) {
    while (t < targetT - 1e-9) {
      const srcs = sourcesAt(t)
      if (extra && Math.abs(t - extra.t) < dt / 2) srcs.push(extra.source)
      smoke.step(dt, srcs)
      t += dt
    }
  }

  stepTo(2)
  drawDisplay()
  shots['2s'] = canvas.toDataURL('image/png')

  stepTo(3, { t: 3, source: { u: 0.5, v: 0.3, du: 0, dv: 0, radius: 0.03, density: 0.9, puff: true } })
  stepTo(4)
  drawDisplay()
  shots['4s'] = canvas.toDataURL('image/png')

  stepTo(5, { t: 5, source: { u: 0.6, v: 0.35, du: 0, dv: 0, radius: 0.04, density: 1.4, puff: true } })
  stepTo(6)
  drawDisplay()
  shots['6s'] = canvas.toDataURL('image/png')

  const before = new Uint8Array(4)
  kit.gl.readPixels(Math.round(0.6 * canvas.width), canvas.height - Math.round(0.45 * canvas.height), 1, 1, kit.gl.RGBA, kit.gl.UNSIGNED_BYTE, before)

  // Mid-run resize.
  canvas.width = 600
  canvas.height = 900
  smoke.resize(canvas.width, canvas.height)

  stepTo(9)
  drawDisplay()
  shots['9s'] = canvas.toDataURL('image/png')

  const after = new Uint8Array(4)
  kit.gl.readPixels(Math.round(0.6 * canvas.width), canvas.height - Math.round(0.45 * canvas.height), 1, 1, kit.gl.RGBA, kit.gl.UNSIGNED_BYTE, after)

  const activeAt9 = smoke.active
  // Fast-forward the idle clock cheaply: step()'s own dt (unclamped) drives
  // idleT directly, so a couple of large-dt calls test the 12s boundary
  // without 500+ more real frames through the solver.
  smoke.step(6.9, []) // last source at t=5; +4 (to t=9) +6.9 = ~10.9s idle
  const activeBefore12 = smoke.active
  smoke.step(1.2, []) // ~12.1s idle
  const activeAfter12 = smoke.active

  // Relative cost: the solver's own step() vs a trivial single-draw
  // pass-through at a comparable (dye-scale) resolution.
  const passProg = kit.program(`
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv); }`)
  const passTarget = kit.target(910, 512, { format: 'r16f' })
  const N = 60
  let t0 = performance.now()
  for (let i = 0; i < N; i += 1) smoke.step(dt, [])
  const solverMs = performance.now() - t0

  t0 = performance.now()
  for (let i = 0; i < N; i += 1) {
    kit.bind(passTarget)
    passProg.use()
    kit.gl.activeTexture(kit.gl.TEXTURE0)
    kit.gl.bindTexture(kit.gl.TEXTURE_2D, passTarget.tex)
    kit.gl.uniform1i(passProg.u.uTex, 0)
    kit.draw()
  }
  const passMs = performance.now() - t0

  return {
    ok: true,
    before: Array.from(before),
    after: Array.from(after),
    activeAt9,
    activeBefore12,
    activeAfter12,
    solverMs,
    passMs,
    ratio: solverMs / Math.max(passMs, 0.001),
    shots,
  }
})

if (result.error) {
  console.log('HARNESS ERROR:', result.error)
} else {
  const { shots, ...rest } = result
  console.log(JSON.stringify(rest, null, 2))
  for (const [name, dataUrl] of Object.entries(shots)) {
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    await writeFile(`${OUT}/shot-${name}.png`, Buffer.from(b64, 'base64'))
    console.log('saved', `${OUT}/shot-${name}.png`)
  }
}

await browser.close()
