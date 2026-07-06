/**
 * Flow Field — seeded generative art on a 2D canvas, zero dependencies.
 *
 * Hundreds of particles are set loose on an invisible vector field whose
 * direction at every point comes from smooth value-noise. Each particle steers
 * along the field and paints a thin coloured trail, so the noise pattern slowly
 * reveals itself as flowing ribbons of colour.
 *
 * Everything is deterministic from a single integer SEED: type a seed to
 * reproduce a piece exactly, or hit Regenerate for a new one. Adjustable
 * particle count, speed, field detail, trail persistence and colour palette,
 * all persisted in localStorage. Click the canvas to blow particles outward
 * from that point. Download the current frame as a PNG.
 *
 * Colours are read from the theme tokens (theme.css) at mount for the "Theme"
 * palette; nothing about the layout is hardcoded. The RAF loop is torn down in
 * disconnectedCallback so it never leaks across View Transitions.
 */

interface Palette {
  id: string
  name: string
  colors: string[]
}

/* Curated palettes. "theme" is resolved from CSS tokens at mount. */
const PALETTES: Palette[] = [
  { id: 'theme', name: 'Theme', colors: [] },
  { id: 'ember', name: 'Ember', colors: ['#ff6b35', '#f7931e', '#ffd23f', '#ee4266', '#c1121f'] },
  { id: 'ocean', name: 'Ocean', colors: ['#00b4d8', '#0077b6', '#48cae4', '#90e0ef', '#03045e'] },
  { id: 'neon', name: 'Neon', colors: ['#ff006e', '#8338ec', '#3a86ff', '#06ffa5', '#fb5607'] },
  { id: 'forest', name: 'Forest', colors: ['#2d6a4f', '#40916c', '#74c69d', '#b7e4c7', '#d8f3dc'] },
  { id: 'sunset', name: 'Sunset', colors: ['#f72585', '#b5179e', '#7209b7', '#ff9e00', '#ffbe0b'] },
]

const LS_PARTICLES = 'ff:particles'
const LS_SPEED = 'ff:speed'
const LS_DETAIL = 'ff:detail'
const LS_TRAILS = 'ff:trails'
const LS_PALETTE = 'ff:palette'

// Slider ranges (raw values persisted; scaled at read time)
const PARTICLES_MIN = 100, PARTICLES_MAX = 2000
const SPEED_MIN = 5, SPEED_MAX = 40          // /10 -> 0.5–4.0 px/step
const DETAIL_MIN = 5, DETAIL_MAX = 60        // /10000 -> noise scale
const TRAILS_MIN = 0, TRAILS_MAX = 40        // /200 -> fade alpha 0–0.2

const TAU = Math.PI * 2

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

/* Deterministic PRNG (mulberry32) — same seed, same stream. */
function mulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* smootherstep — Ken Perlin's 6t^5-15t^4+10t^3 */
function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10)
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

/* Hash an integer lattice point to a value in [0,1), keyed by seed. */
function hash2(ix: number, iy: number, seed: number) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967295
}

/* 2D value noise in [0,1] via bilinear interpolation of hashed lattice. */
function valueNoise(x: number, y: number, seed: number) {
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const xf = x - x0, yf = y - y0
  const u = fade(xf), v = fade(yf)
  const n00 = hash2(x0, y0, seed)
  const n10 = hash2(x0 + 1, y0, seed)
  const n01 = hash2(x0, y0 + 1, seed)
  const n11 = hash2(x0 + 1, y0 + 1, seed)
  // interpolate along x for both rows, then blend the rows along y
  const nx0 = lerp(n00, n10, u)
  const nx1 = lerp(n01, n11, u)
  return lerp(nx0, nx1, v)
}

interface Particle {
  x: number
  y: number
  color: string
  life: number
}

class FlowFieldGame extends HTMLElement {
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private ro?: ResizeObserver
  private raf = 0
  private playing = false

  private w = 0 // device-pixel canvas dims
  private h = 0
  private particles: Particle[] = []
  private rnd: () => number = Math.random

  // tunables
  private seed = 1
  private count = 700
  private speed = 1.6         // px per step (before dpr)
  private noiseScale = 0.0016
  private fadeAlpha = 0.05
  private palette: Palette = PALETTES[1]

  // resolved theme colours
  private bgRGB: [number, number, number] = [17, 17, 17]

  connectedCallback() {
    // restore prefs
    const rawParticles = Number(localStorage.getItem(LS_PARTICLES))
    const rawSpeed = Number(localStorage.getItem(LS_SPEED))
    const rawDetail = Number(localStorage.getItem(LS_DETAIL))
    const rawTrails = localStorage.getItem(LS_TRAILS)
    const savedPalette = localStorage.getItem(LS_PALETTE)

    this.count = clamp(rawParticles || 700, PARTICLES_MIN, PARTICLES_MAX)
    this.speed = clamp(rawSpeed || 16, SPEED_MIN, SPEED_MAX) / 10
    this.noiseScale = clamp(rawDetail || 16, DETAIL_MIN, DETAIL_MAX) / 10000
    this.fadeAlpha = clamp(rawTrails === null ? 10 : Number(rawTrails), TRAILS_MIN, TRAILS_MAX) / 200
    this.palette = PALETTES.find(p => p.id === savedPalette) || PALETTES[1]
    if (this.palette.id === 'theme' && this.palette.colors.length === 0) this.palette = PALETTES[1]

    const rawSpeedVal = clamp(rawSpeed || 16, SPEED_MIN, SPEED_MAX)
    const rawDetailVal = clamp(rawDetail || 16, DETAIL_MIN, DETAIL_MAX)
    const rawTrailsVal = clamp(rawTrails === null ? 10 : Number(rawTrails), TRAILS_MIN, TRAILS_MAX)

    this.innerHTML = `
      <div data-type="ff-game">
        <div data-type="ff-header">
          <div data-type="ff-titlebar">
            <h1>Flow Field</h1>
            <span data-type="ff-badge">seeded generative art</span>
          </div>
          <p>Hundreds of particles drift across an invisible field of currents woven from noise, each one trailing colour as it goes. Every picture is fixed by a single seed — copy it to keep a piece, or reroll for a new one. Tune the flow, click the canvas to stir it, and download the frame you like.</p>
        </div>
        <div data-type="ff-stage">
          <canvas data-type="ff-canvas" tabindex="0" role="img"
            aria-label="Generative flow-field artwork — particles trace coloured trails along a noise field. Click to stir the flow."></canvas>
        </div>
        <div data-type="ff-controls">
          <div data-group="transport" role="group" aria-label="Actions">
            <button data-action="play" type="button" aria-pressed="false" title="Run / pause the flow (space)">Pause</button>
            <button data-action="regen" type="button" title="New random seed (R)">Regenerate</button>
            <button data-action="clear" type="button" title="Wipe the canvas, keep the field (C)">Clear</button>
            <button data-action="download" type="button" title="Save the current frame as a PNG (D)">Download PNG</button>
          </div>
          <div data-type="ff-sliders">
            <div data-type="ff-slider">
              <label for="ff-particles">Particles</label>
              <input id="ff-particles" type="range" min="${PARTICLES_MIN}" max="${PARTICLES_MAX}" step="50" value="${this.count}" />
              <output id="ff-particles-out">${this.count}</output>
            </div>
            <div data-type="ff-slider">
              <label for="ff-speed">Speed</label>
              <input id="ff-speed" type="range" min="${SPEED_MIN}" max="${SPEED_MAX}" value="${rawSpeedVal}" />
              <output id="ff-speed-out">${(rawSpeedVal / 10).toFixed(1)}×</output>
            </div>
            <div data-type="ff-slider">
              <label for="ff-detail">Detail</label>
              <input id="ff-detail" type="range" min="${DETAIL_MIN}" max="${DETAIL_MAX}" value="${rawDetailVal}" />
              <output id="ff-detail-out">${rawDetailVal}</output>
            </div>
            <div data-type="ff-slider">
              <label for="ff-trails">Trails</label>
              <input id="ff-trails" type="range" min="${TRAILS_MIN}" max="${TRAILS_MAX}" value="${rawTrailsVal}" />
              <output id="ff-trails-out">${Math.round((1 - rawTrailsVal / TRAILS_MAX) * 100)}%</output>
            </div>
          </div>
          <div data-group="palette" role="group" aria-label="Colour palette">
            <span data-type="ff-group-label">Palette</span>
            ${PALETTES.map(p => `
              <button data-palette="${p.id}" type="button" aria-pressed="${p.id === this.palette.id}" title="${p.name} palette">
                <span data-type="ff-swatch" aria-hidden="true">${(p.colors.length ? p.colors : ['var(--color-text)', 'var(--color-accent)', 'var(--color-muted)']).slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span>${p.name}
              </button>`).join('')}
          </div>
          <div data-group="seed">
            <label for="ff-seed">Seed</label>
            <input id="ff-seed" type="text" inputmode="numeric" spellcheck="false" value="${this.seed}"
              aria-label="Seed — type a number and press Enter to reproduce a piece" />
            <button data-action="copy-seed" type="button" title="Copy this seed">Copy</button>
          </div>
        </div>
        <details data-type="ff-explainer">
          <summary>New here? What a flow field is</summary>
          <p>Imagine a wind map laid over the canvas: at every point there's an arrow pointing some direction. Here those arrows come from <strong>value noise</strong> — a smooth, seeded randomness — so nearby arrows point similar ways and the whole field swirls gently.</p>
          <p>Each <strong>particle</strong> reads the arrow beneath it, takes a small step that way, and paints a short line. Do that for hundreds of particles over thousands of steps and the hidden field emerges as flowing ribbons. <strong>Detail</strong> zooms the noise (tight, busy currents vs broad sweeps); <strong>Trails</strong> controls how much of each frame lingers.</p>
          <p data-type="ff-try"><strong>Try this:</strong> drag <em>Trails</em> toward 100%, drop <em>Detail</em> low, and hit <em>Regenerate</em> a few times until a seed grabs you — then <em>Copy</em> it. Same seed always redraws the same piece.</p>
        </details>
        <p data-type="ff-hint">Shortcuts: space = play/pause · R = regenerate · C = clear · D = download. Click the canvas to stir the flow.</p>
      </div>
    `

    this.canvas = this.querySelector('[data-type="ff-canvas"]') as HTMLCanvasElement
    this.ctx = this.canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
    this.readTheme()
    this.seed = (Math.floor(Math.random() * 900000) + 100000)
    const seedInput = this.querySelector('#ff-seed') as HTMLInputElement
    seedInput.value = String(this.seed)
    this.wire()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.querySelector('[data-type="ff-stage"]') as Element)
    requestAnimationFrame(() => {
      this.resize()
      this.regenerate(false)
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced) {
        // Respect reduced-motion: paint a finished frame, then stay paused.
        this.renderStatic(500)
        this.setPlaying(false)
      } else {
        this.setPlaying(true)
      }
    })
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.ro?.disconnect()
  }

  /* ── theme + palette ── */

  private readTheme() {
    const cs = getComputedStyle(document.documentElement)
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
    this.bgRGB = this.toRGB(v('--color-bg', '#111')) || [17, 17, 17]
    // Resolve the token-driven "Theme" palette
    const theme = PALETTES[0]
    theme.colors = [
      v('--color-text', '#e8e8e8'),
      v('--color-accent', '#2e4d8f'),
      v('--color-muted', '#8a8a8a'),
    ]
  }

  private toRGB(input: string): [number, number, number] | null {
    let s = input.trim()
    if (s.startsWith('#')) {
      if (s.length === 4) s = '#' + [...s.slice(1)].map(c => c + c).join('')
      const r = parseInt(s.slice(1, 3), 16)
      const g = parseInt(s.slice(3, 5), 16)
      const b = parseInt(s.slice(5, 7), 16)
      if ([r, g, b].every(n => !Number.isNaN(n))) return [r, g, b]
      return null
    }
    const m = s.match(/rgba?\(([^)]+)\)/)
    if (m) {
      const parts = m[1].split(',').map(x => parseFloat(x))
      if (parts.length >= 3) return [parts[0], parts[1], parts[2]]
    }
    return null
  }

  private colors(): string[] {
    return this.palette.colors.length ? this.palette.colors : PALETTES[0].colors
  }

  /* ── geometry ── */

  private dpr() {
    return Math.min(window.devicePixelRatio || 1, 2)
  }

  private resize() {
    const stage = this.querySelector('[data-type="ff-stage"]') as HTMLElement
    const cssW = stage.getBoundingClientRect().width
    if (cssW < 2) return
    const cssH = Math.round(cssW * 0.62)
    const dpr = this.dpr()
    this.canvas.style.width = cssW + 'px'
    this.canvas.style.height = cssH + 'px'
    const newW = Math.round(cssW * dpr)
    const newH = Math.round(cssH * dpr)
    if (newW === this.w && newH === this.h) return
    this.w = this.canvas.width = newW
    this.h = this.canvas.height = newH
    this.paintBackground()
    this.spawnAll()
  }

  /* ── seeded field + particles ── */

  private fieldAngle(px: number, py: number): number {
    const s = this.noiseScale
    let n = valueNoise(px * s, py * s, this.seed)
    n += 0.5 * valueNoise(px * s * 2.4, py * s * 2.4, this.seed ^ 0x9e3779b9)
    n /= 1.5
    return n * TAU * 2 // two full turns of range -> rich swirling
  }

  private spawnOne(p: Particle) {
    p.x = this.rnd() * this.w
    p.y = this.rnd() * this.h
    p.color = this.colors()[(this.rnd() * this.colors().length) | 0]
    p.life = 40 + this.rnd() * 160
  }

  private spawnAll() {
    this.rnd = mulberry32(this.seed)
    this.particles = new Array(this.count)
    for (let i = 0; i < this.count; i++) {
      const p: Particle = { x: 0, y: 0, color: '#fff', life: 0 }
      this.spawnOne(p)
      this.particles[i] = p
    }
  }

  private paintBackground() {
    const [r, g, b] = this.bgRGB
    this.ctx.globalAlpha = 1
    this.ctx.fillStyle = `rgb(${r},${g},${b})`
    this.ctx.fillRect(0, 0, this.w, this.h)
  }

  /** New random seed + fresh field, repaint from scratch. */
  private regenerate(newSeed: boolean) {
    if (newSeed) {
      this.seed = Math.floor(Math.random() * 900000) + 100000
      const seedInput = this.querySelector('#ff-seed') as HTMLInputElement | null
      if (seedInput) seedInput.value = String(this.seed)
    }
    this.paintBackground()
    this.spawnAll()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.renderStatic(500)
    } else {
      this.setPlaying(true)
    }
  }

  private clear() {
    this.paintBackground()
    this.spawnAll()
  }

  /* ── simulation ── */

  private step() {
    const { ctx } = this
    const dpr = this.dpr()
    // fade previous frame toward background (Trails)
    if (this.fadeAlpha > 0) {
      const [r, g, b] = this.bgRGB
      ctx.globalAlpha = 1
      ctx.fillStyle = `rgba(${r},${g},${b},${this.fadeAlpha})`
      ctx.fillRect(0, 0, this.w, this.h)
    }
    ctx.globalAlpha = 0.55
    ctx.lineWidth = Math.max(1, dpr)
    ctx.lineCap = 'round'
    const spd = this.speed * dpr
    for (const p of this.particles) {
      const a = this.fieldAngle(p.x, p.y)
      const nx = p.x + Math.cos(a) * spd
      const ny = p.y + Math.sin(a) * spd
      ctx.strokeStyle = p.color
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(nx, ny)
      ctx.stroke()
      p.x = nx
      p.y = ny
      p.life -= 1
      if (p.life <= 0 || nx < 0 || ny < 0 || nx > this.w || ny > this.h) {
        this.spawnOne(p)
      }
    }
    ctx.globalAlpha = 1
  }

  /** Run a fixed number of steps synchronously (reduced-motion / one-shot). */
  private renderStatic(steps: number) {
    for (let i = 0; i < steps; i++) this.step()
  }

  private setPlaying(on: boolean) {
    this.playing = on
    const btn = this.querySelector('[data-action="play"]') as HTMLButtonElement | null
    if (btn) {
      btn.textContent = on ? 'Pause' : 'Play'
      btn.setAttribute('aria-pressed', String(on))
    }
    cancelAnimationFrame(this.raf)
    this.raf = 0
    if (on) this.loop()
  }

  private loop = () => {
    if (!this.playing) return
    this.step()
    this.raf = requestAnimationFrame(this.loop)
  }

  /* ── interaction ── */

  private wire() {
    this.querySelector('[data-action="play"]')?.addEventListener('click', () => this.setPlaying(!this.playing))
    this.querySelector('[data-action="regen"]')?.addEventListener('click', () => this.regenerate(true))
    this.querySelector('[data-action="clear"]')?.addEventListener('click', () => this.clear())
    this.querySelector('[data-action="download"]')?.addEventListener('click', () => this.download())
    this.querySelector('[data-action="copy-seed"]')?.addEventListener('click', () => this.copySeed())

    this.bindSlider('#ff-particles', '#ff-particles-out', LS_PARTICLES, raw => {
      this.count = clamp(raw, PARTICLES_MIN, PARTICLES_MAX)
      this.spawnAll()
      return String(this.count)
    })
    this.bindSlider('#ff-speed', '#ff-speed-out', LS_SPEED, raw => {
      this.speed = clamp(raw, SPEED_MIN, SPEED_MAX) / 10
      return `${this.speed.toFixed(1)}×`
    })
    this.bindSlider('#ff-detail', '#ff-detail-out', LS_DETAIL, raw => {
      this.noiseScale = clamp(raw, DETAIL_MIN, DETAIL_MAX) / 10000
      return String(clamp(raw, DETAIL_MIN, DETAIL_MAX))
    })
    this.bindSlider('#ff-trails', '#ff-trails-out', LS_TRAILS, raw => {
      const v = clamp(raw, TRAILS_MIN, TRAILS_MAX)
      this.fadeAlpha = v / 200
      return `${Math.round((1 - v / TRAILS_MAX) * 100)}%`
    })

    this.querySelectorAll<HTMLButtonElement>('[data-palette]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.palette as string
        this.palette = PALETTES.find(p => p.id === id) || this.palette
        localStorage.setItem(LS_PALETTE, id)
        this.querySelectorAll('[data-palette]').forEach(b =>
          b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.palette === id)))
        // recolour live particles so the switch reads instantly
        for (const p of this.particles) p.color = this.colors()[(Math.random() * this.colors().length) | 0]
      })
    })

    const seedInput = this.querySelector('#ff-seed') as HTMLInputElement
    const applySeed = () => {
      const n = parseInt(seedInput.value.replace(/[^0-9]/g, ''), 10)
      if (Number.isFinite(n) && n > 0) {
        this.seed = n
        this.paintBackground()
        this.spawnAll()
        this.setPlaying(true)
      } else {
        seedInput.value = String(this.seed)
      }
    }
    seedInput.addEventListener('change', applySeed)
    seedInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applySeed() } })

    // click to stir: push nearby particles radially outward from the click
    this.canvas.addEventListener('pointerdown', e => this.stir(e))
    this.canvas.addEventListener('keydown', e => this.onKey(e))
  }

  private bindSlider(inputSel: string, outSel: string, lsKey: string, apply: (raw: number) => string) {
    const input = this.querySelector(inputSel) as HTMLInputElement
    const out = this.querySelector(outSel) as HTMLOutputElement | null
    input.addEventListener('input', () => {
      const raw = Number(input.value)
      const label = apply(raw)
      if (out) out.textContent = label
      localStorage.setItem(lsKey, String(raw))
    })
  }

  private onKey(e: KeyboardEvent) {
    switch (e.key) {
      case ' ': e.preventDefault(); this.setPlaying(!this.playing); break
      case 'r': case 'R': e.preventDefault(); this.regenerate(true); break
      case 'c': case 'C': e.preventDefault(); this.clear(); break
      case 'd': case 'D': e.preventDefault(); this.download(); break
    }
  }

  private stir(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect()
    const cx = (e.clientX - rect.left) * (this.w / rect.width)
    const cy = (e.clientY - rect.top) * (this.h / rect.height)
    const R = Math.min(this.w, this.h) * 0.28
    for (const p of this.particles) {
      const dx = p.x - cx
      const dy = p.y - cy
      const d = Math.hypot(dx, dy)
      if (d < R && d > 0.001) {
        const push = (1 - d / R) * R * 0.9
        p.x = clamp(p.x + (dx / d) * push, 0, this.w)
        p.y = clamp(p.y + (dy / d) * push, 0, this.h)
      }
    }
    this.canvas.focus()
    if (!this.playing) this.step()
  }

  private copySeed() {
    const btn = this.querySelector('[data-action="copy-seed"]') as HTMLButtonElement | null
    const text = String(this.seed)
    const done = () => { if (btn) { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = t || 'Copy' }, 1200) } }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(done)
    else done()
  }

  private download() {
    try {
      const url = this.canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = `flow-field-${this.seed}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      /* toDataURL can throw if the canvas is tainted — it never is here (no external images) */
    }
  }
}

if (!customElements.get('flow-field-game')) {
  customElements.define('flow-field-game', FlowFieldGame)
}
