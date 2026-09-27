const { chromium } = await import('playwright') // any local Playwright install
const OUT = './out'

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-lcd-text'] })
const page = await browser.newPage({ viewport: { width: 960, height: 600 } })
page.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()) })
page.on('pageerror', e => console.log('pageerror:', e.message))

await page.goto('http://127.0.0.1:4321/robots.txt')
await page.setContent('<!doctype html><body style="margin:0;background:#000"><canvas id="c" width="960" height="600"></canvas></body>')

const setup = await page.evaluate(async () => {
  const glMod = await import('/src/components/home/hero/monsoon/gl.ts')
  const camMod = await import('/src/components/home/hero/monsoon/camera.ts')
  const typesMod = await import('/src/components/home/hero/monsoon/types.ts')
  const propsMod = await import('/src/components/home/hero/monsoon/props.ts')

  const canvas = document.getElementById('c')
  const kit = glMod.createKit(canvas)
  if (!kit) return { error: 'no gl context' }

  let propsInst
  try {
    propsInst = propsMod.createProps(kit, { lowPower: false, reduced: false })
  } catch (e) {
    return { error: 'createProps threw: ' + (e && e.stack || e) }
  }
  propsInst.resize(960, 600)

  function makeCanvas(w, h, draw) {
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    draw(c.getContext('2d'), w, h)
    return c
  }
  function cityPlate(w, h, withRects) {
    return makeCanvas(w, h, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, '#05060d'); g.addColorStop(0.6, '#150f22'); g.addColorStop(1, '#241a2e')
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
      if (withRects) {
        const cols = ['#ff2fa0', '#22e6ff', '#ffb347', '#9b7bff', '#ff3b3b']
        let seed = 17
        const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 1000) / 1000 }
        for (let i = 0; i < 40; i += 1) {
          ctx.fillStyle = cols[i % cols.length]
          const rw = 4 + rnd() * 12, rh = 4 + rnd() * 26
          ctx.fillRect(rnd() * w, h * 0.25 + rnd() * h * 0.65, rw, rh)
        }
      }
    })
  }
  const nightC = cityPlate(1024, 640, false)
  const dayC = cityPlate(512, 320, false)
  const emitC = cityPlate(1024, 640, true)
  const city = {
    night: kit.texture(nightC, { mipmap: true }),
    day: kit.texture(dayC, { mipmap: true }),
    emit: kit.texture(emitC, { mipmap: true }),
    flicker: kit.texture(cityPlate(512, 320, false), { mipmap: true }),
    groups: [[1, 0.16, 0.6], [0.2, 1, 0.55], [1, 0.1, 0.08]],
    lanes: [],
    aspect: 1.6,
  }

  const disp = kit.program(`
uniform sampler2D uTex;
in vec2 vUv;
out vec4 fragColor;
void main(){
  vec4 p = texture(uTex, vUv);
  vec3 bg = vec3(0.015,0.017,0.03);
  vec3 c = bg*(1.0-p.a) + p.rgb;
  c = c/(c+vec3(1.0));
  fragColor = vec4(pow(c, vec3(1.0/2.2)), 1.0);
}`)

  window.__m = { kit, propsInst, camMod, typesMod, city, disp }
  return { ok: true }
})
console.log('setup:', JSON.stringify(setup))
if (setup.error) { await browser.close(); process.exit(1) }

async function drawState(camWH, patch, extra) {
  return page.evaluate(async ({ camWH, patch, extra }) => {
    const { kit, propsInst, camMod, typesMod, city, disp } = window.__m
    const [w, h] = camWH
    if (window.__curW !== w || window.__curH !== h) {
      propsInst.resize(w, h)
      window.__curW = w; window.__curH = h
    }
    const cam = camMod.makeCamera(w, h)
    const state = typesMod.createSceneState(false)
    Object.assign(state, patch)
    if (extra === 'matchHeld') {
      const p = cam.placements
      const headX = p.hold.point[0] + p.hold.normal[0] * 0.001
      const headY = p.candle.height * 0.55
      const headZ = p.hold.point[2] + p.hold.normal[2] * 0.001
      state.matches = [{ phase: 'lit', head: [headX, headY, headZ], dir: [0.3, 1, 0.1], burn: 0.12, flame: 1, ember: 0, lean: [0.15, 0.05], struck: true }]
      state.flames = [{ pos: [headX, headY + 0.008, headZ], intensity: 1.1, kind: 'match' }]
    } else if (extra === 'flare') {
      const p = cam.placements
      const headX = p.striker.center[0], headY = p.striker.center[1] + 0.01, headZ = p.striker.center[2] + 0.01
      state.matches = [{ phase: 'lit', head: [headX, headY, headZ], dir: [0.2, 1, 0.3], burn: 0.02, flame: 1.45, ember: 0, lean: [-0.2, 0.3], struck: true }]
      state.flames = [{ pos: [headX, headY + 0.006, headZ], intensity: 1.45, kind: 'match' }]
    } else if (extra === 'candleLit') {
      const p = cam.placements
      state.matches = []
      state.candle = { lit: true, flame: 1 }
      state.flames = [{ pos: p.candle.wickTop, intensity: 1.0, kind: 'candle' }]
    } else if (extra === 'spent') {
      const p = cam.placements
      state.matches = [
        { phase: 'rest', head: p.matchRest.head, dir: p.matchRest.dir, burn: 0, flame: 0, ember: 0, lean: [0, 0], struck: false },
        { phase: 'spent', head: p.spentSlots[0].head, dir: p.spentSlots[0].dir, burn: 1, flame: 0, ember: 0, lean: [0, 0], struck: true },
        { phase: 'spent', head: p.spentSlots[1].head, dir: p.spentSlots[1].dir, burn: 1, flame: 0, ember: 0.15, lean: [0, 0], struck: true },
      ]
    } else {
      const p = cam.placements
      state.matches = [{ phase: 'rest', head: p.matchRest.head, dir: p.matchRest.dir, burn: 0, flame: 0, ember: 0, lean: [0, 0], struck: false }]
    }
    propsInst.render(state, cam, city)
    kit.bind(null)
    const gl = kit.gl
    gl.viewport(0, 0, w, h)
    disp.use()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, propsInst.target.tex)
    gl.uniform1i(disp.u.uTex, 0)
    kit.draw()

    let strikerCheck = null
    if (extra === 'striker-check') {
      const out = [0, 0, 0]
      cam.project(cam.placements.striker.center, out)
      const px = Math.max(0, Math.min(w - 1, Math.round(out[0] * w)))
      const py = Math.max(0, Math.min(h - 1, Math.round(out[1] * h)))
      const px2 = new Uint8Array(4)
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px2)
      strikerCheck = { px, py, rgba: Array.from(px2) }
    }
    return { strikerCheck }
  }, { camWH, patch, extra })
}

const frames = [
  ['night-rest', [960, 600], {}, 'rest'],
  ['match-lit', [960, 600], {}, 'matchHeld'],
  ['flare', [960, 600], {}, 'flare'],
  ['candle-lit', [960, 600], {}, 'candleLit'],
  ['spent', [960, 600], {}, 'spent'],
  ['dayness1', [960, 600], { dayness: 1, hour: [0.9, 0.85, 0.7] }, 'rest'],
  ['tall', [390, 844], {}, 'rest'],
]

for (const [name, wh, patch, extra] of frames) {
  const r = await drawState(wh, patch, extra)
  await page.setViewportSize({ width: wh[0], height: wh[1] })
  await page.screenshot({ path: `${OUT}/frame-${name}.png` })
  console.log(name, JSON.stringify(r))
}

const strikerR = await drawState([960, 600], {}, 'striker-check')
console.log('striker-check:', JSON.stringify(strikerR))

const diag = await page.evaluate(async () => {
  const { kit, propsInst, camMod, typesMod, city } = window.__m
  const w = 390, h = 844
  propsInst.resize(w, h)
  const cam = camMod.makeCamera(w, h)
  const state = typesMod.createSceneState(false)
  const p = cam.placements
  state.matches = [{ phase: 'rest', head: p.matchRest.head, dir: p.matchRest.dir, burn: 0, flame: 0, ember: 0, lean: [0, 0], struck: false }]
  propsInst.render(state, cam, city)
  const gl = kit.gl
  gl.bindFramebuffer(gl.FRAMEBUFFER, propsInst.target.fbo)
  const rt = propsInst.target.h
  const cx = Math.floor(propsInst.target.w / 2)
  const pts = [10, 30, 60, 90, 130, 177, 220, 260, 300, 316, rt - 2].map(y => [cx, y])
  const out = []
  for (const [x, y] of pts) {
    const buf = new Float32Array(4)
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, buf)
    out.push({ x, y, rgba: Array.from(buf) })
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { targetW: propsInst.target.w, targetH: propsInst.target.h, out }
})
console.log('diag:', JSON.stringify(diag))

const strikerDiag = await page.evaluate(async () => {
  const { kit, propsInst, camMod, typesMod, city } = window.__m
  const w = 960, h = 600
  propsInst.resize(w, h)
  const cam = camMod.makeCamera(w, h)
  const state = typesMod.createSceneState(false)
  const p = cam.placements
  state.matches = [{ phase: 'rest', head: p.matchRest.head, dir: p.matchRest.dir, burn: 0, flame: 0, ember: 0, lean: [0, 0], struck: false }]
  propsInst.render(state, cam, city)
  const gl = kit.gl
  gl.bindFramebuffer(gl.FRAMEBUFFER, propsInst.target.fbo)
  const s = p.striker
  const scale = propsInst.target.w / w
  const out = [0, 0, 0]
  cam.project(s.center, out)
  const sx = Math.round(out[0] * propsInst.target.w), sy = Math.round(out[1] * propsInst.target.h)
  // A point on the same front face, well past the striker's end (plain card).
  const cardPoint = [s.center[0] + s.along[0] * (s.halfLen + 0.006), s.center[1], s.center[2] + s.along[2] * (s.halfLen + 0.006)]
  cam.project(cardPoint, out)
  const cx = Math.round(out[0] * propsInst.target.w), cy = Math.round(out[1] * propsInst.target.h)
  const read = (x, y) => { const b = new Float32Array(4); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, b); return Array.from(b) }
  const strikerRGBA = read(sx, sy)
  const cardRGBA = read(cx, cy)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { scale, striker: { x: sx, y: sy, rgba: strikerRGBA }, card: { x: cx, y: cy, rgba: cardRGBA } }
})
console.log('strikerDiag:', JSON.stringify(strikerDiag))

await browser.close()

