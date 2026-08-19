/**
 * Turing Bloom — an interactive Gray-Scott reaction-diffusion simulation on a
 * 2D canvas, zero dependencies.
 *
 * Two make-believe chemicals, U and V, sit on a grid. U slowly seeps in
 * everywhere; V eats U (the reaction U + 2V -> 3V) and is slowly killed off.
 * Both spread by diffusion, U twice as fast as V. That's the whole model — yet
 * from a few painted specks of V those four rules grow the same self-organising
 * patterns Alan Turing proposed in 1952 to explain animal markings: spots,
 * stripes, coral, mazes, dividing cells, travelling waves.
 *
 * The two knobs that decide which pattern you get are the FEED rate (how fast U
 * is replenished) and the KILL rate (how fast V dies). Eight named presets drop
 * you into famous regions of that (feed, kill) map; the sliders let you wander
 * between them and watch one regime melt into another. Paint on the canvas to
 * inject V and grow a bloom from your own seed; Reseed scatters fresh specks
 * from a reproducible integer seed, so the same seed replays the same bloom.
 *
 * The simulation runs on a coarse grid (a handful of CSS pixels per cell) and is
 * upscaled smoothly onto the display canvas, so it stays fluid while looking
 * organic; Speed sets how many solver steps run per frame and Scale sets the
 * cell size. Every value maps to colour through a 256-entry ramp built from the
 * active palette, whose "Theme" option is resolved from the CSS design tokens at
 * mount, so nothing about the look is hardcoded. Respects prefers-reduced-motion
 * (settles a still frame, then stays paused). Feed/kill/speed/scale/palette all
 * persist in localStorage. The RAF loop is torn down in disconnectedCallback so
 * it never leaks across View Transitions.
 *
 * Every module-level name is prefixed `tb`/`TB_` on purpose: the game component
 * files share a global TS script scope, so unprefixed names (clamp, PALETTES,
 * LS_*, mulberry32…) would collide with the sibling toys at `astro check` time.
 */

import { attachCanvasExport } from '../../../lib/canvas-export'

interface TbPalette {
  id: string
  name: string
  /** colour stops, low value -> high value; interpolated into a 256-entry ramp */
  colors: string[]
}

/* Curated ramps, dark (empty background) -> bright (dense V). The first stop is
   kept near-black so quiet regions melt into the dark page. "theme" is resolved
   from CSS tokens at mount. */
const TB_PALETTES: TbPalette[] = [
  { id: 'magma', name: 'Magma', colors: ['#04010b', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'] },
  { id: 'theme', name: 'Theme', colors: [] },
  { id: 'ember', name: 'Ember', colors: ['#080605', '#7a1f0f', '#ff6b35', '#ffd23f', '#fff3c9'] },
  { id: 'ocean', name: 'Ocean', colors: ['#02043a', '#0077b6', '#00b4d8', '#90e0ef', '#eaffff'] },
  { id: 'neon', name: 'Neon', colors: ['#08001a', '#3a0ca3', '#7209b7', '#f72585', '#4cc9f0'] },
  { id: 'forest', name: 'Forest', colors: ['#05100b', '#1b4332', '#40916c', '#95d5b2', '#f0fbf4'] },
  { id: 'mono', name: 'Mono', colors: ['#050505', '#4a4a4a', '#9a9a9a', '#e8e8e8', '#ffffff'] },
]

interface TbPreset {
  id: string
  name: string
  f: number
  k: number
}

/* Named regions of the Gray-Scott (feed, kill) parameter space — each grows a
   visibly different regime. Values follow the well-known xmorphia / Munafo map. */
const TB_PRESETS: TbPreset[] = [
  { id: 'coral', name: 'Coral', f: 0.0545, k: 0.0620 },
  { id: 'mitosis', name: 'Mitosis', f: 0.0367, k: 0.0649 },
  { id: 'spots', name: 'Spots', f: 0.0300, k: 0.0620 },
  { id: 'maze', name: 'Maze', f: 0.0290, k: 0.0570 },
  { id: 'worms', name: 'Worms', f: 0.0580, k: 0.0650 },
  { id: 'waves', name: 'Waves', f: 0.0140, k: 0.0450 },
  { id: 'holes', name: 'Holes', f: 0.0390, k: 0.0580 },
  { id: 'uskate', name: 'U-Skate', f: 0.0620, k: 0.0609 },
]

const TB_LS_FEED = 'tb:feed'
const TB_LS_KILL = 'tb:kill'
const TB_LS_SPEED = 'tb:speed'
const TB_LS_SCALE = 'tb:scale'
const TB_LS_PALETTE = 'tb:palette'
const TB_LS_FEED_EXACT = 'tb:feed:exact'
const TB_LS_KILL_EXACT = 'tb:kill:exact'

// Slider ranges. Raw integer values are persisted; scaled at read time.
const TB_FEED_MIN = 20, TB_FEED_MAX = 200      // /2000 -> feed 0.010..0.100
const TB_KILL_MIN = 80, TB_KILL_MAX = 150      // /2000 -> kill 0.040..0.075
const TB_SPEED_MIN = 1, TB_SPEED_MAX = 20      // solver steps per animation frame
const TB_SCALE_MIN = 2, TB_SCALE_MAX = 9       // CSS px per grid cell (bigger = coarser/faster)
const TB_PARAM_SCALE = 2000                    // feed/kill raw -> real: raw / TB_PARAM_SCALE

// Grid resolution clamps (columns). Rows follow the 0.62 stage aspect.
const TB_COLS_MIN = 48, TB_COLS_MAX = 300
const TB_ASPECT = 0.62

// Gray-Scott diffusion rates + value->colour contrast. dt is folded in as 1.
const TB_DA = 1.0
const TB_DB = 0.5
const TB_CONTRAST = 3.4

function tbClamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function tbReadStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function tbReadStoredNumber(key: string, fallback: number): number {
  const raw = tbReadStored(key)
  if (raw === null) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function tbReadExact(key: string, lo: number, hi: number): number | null {
  const raw = tbReadStored(key)
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= lo && parsed <= hi ? parsed : null
}

function tbWriteStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage disabled — Turing Bloom still works for this session */
  }
}

/* Deterministic PRNG (mulberry32) — same seed, same initial scatter of specks. */
function tbMulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function tbToRGB(input: string): [number, number, number] | null {
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

class TuringBloomGame extends HTMLElement {
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private grid!: HTMLCanvasElement          // offscreen, cols x rows
  private gctx!: CanvasRenderingContext2D
  private img!: ImageData
  private ro?: ResizeObserver
  private raf = 0
  private playing = false

  private w = 0                              // display backing-store dims (device px)
  private h = 0
  private cols = 0
  private rows = 0

  // chemical fields + ping-pong scratch
  private A = new Float32Array(0)
  private B = new Float32Array(0)
  private A2 = new Float32Array(0)
  private B2 = new Float32Array(0)

  // colour ramp LUT
  private rampR = new Uint8Array(256)
  private rampG = new Uint8Array(256)
  private rampB = new Uint8Array(256)

  // pointer paint state
  private painting = false

  // tunables
  private seed = 1
  private feed = 0.0545
  private kill = 0.0620
  private steps = 8
  private cell = 4                           // CSS px per grid cell
  private palette: TbPalette = TB_PALETTES[0]

  connectedCallback() {
    this.resolveThemePalette()

    // restore prefs
    const rawFeed = tbClamp(tbReadStoredNumber(TB_LS_FEED, 109), TB_FEED_MIN, TB_FEED_MAX)
    const rawKill = tbClamp(tbReadStoredNumber(TB_LS_KILL, 124), TB_KILL_MIN, TB_KILL_MAX)
    const rawSpeed = tbClamp(tbReadStoredNumber(TB_LS_SPEED, 8), TB_SPEED_MIN, TB_SPEED_MAX)
    const rawScale = tbClamp(tbReadStoredNumber(TB_LS_SCALE, 4), TB_SCALE_MIN, TB_SCALE_MAX)
    const savedPalette = tbReadStored(TB_LS_PALETTE)

    this.feed = tbReadExact(TB_LS_FEED_EXACT, TB_FEED_MIN / TB_PARAM_SCALE, TB_FEED_MAX / TB_PARAM_SCALE) ?? rawFeed / TB_PARAM_SCALE
    this.kill = tbReadExact(TB_LS_KILL_EXACT, TB_KILL_MIN / TB_PARAM_SCALE, TB_KILL_MAX / TB_PARAM_SCALE) ?? rawKill / TB_PARAM_SCALE
    this.steps = rawSpeed
    this.cell = rawScale
    this.palette = TB_PALETTES.find(p => p.id === savedPalette) || TB_PALETTES[0]
    if (this.palette.id === 'theme' && this.palette.colors.length === 0) this.palette = TB_PALETTES[0]

    this.seed = Math.floor(Math.random() * 900000) + 100000

    this.innerHTML = `
      <div data-type="tb-game">
        <div data-type="tb-header">
          <div data-type="tb-titlebar">
            <h1>Turing Bloom</h1>
            <span data-type="tb-badge">reaction-diffusion</span>
          </div>
          <p>Two make-believe chemicals, a grid, and four simple rules — and the self-organising patterns Alan Turing proposed for animal markings bloom on their own: spots, stripes, coral, mazes, dividing cells. Pick a regime, nudge the feed and kill rates, and paint on the canvas to grow your own.</p>
        </div>
        <div data-type="tb-stage">
          <canvas data-type="tb-canvas" tabindex="0" role="img"
            aria-label="Reaction-diffusion artwork — a Gray-Scott simulation grows organic Turing patterns. Click or drag to paint and grow new blooms."></canvas>
        </div>
        <div data-type="tb-controls">
          <div data-group="transport" role="group" aria-label="Actions">
            <button data-action="play" type="button" aria-pressed="false" title="Run / pause the simulation (space)">Pause</button>
            <button data-action="reseed" type="button" title="Scatter fresh specks from a new seed (R)">Reseed</button>
            <button data-action="clear" type="button" title="Wipe to an empty field so you can paint (C)">Clear</button>
            <button data-action="download" type="button" title="Save the current frame as a PNG (D)">Download PNG</button>
          </div>
          <div data-group="presets" role="group" aria-label="Pattern presets">
            <span data-type="tb-group-label">Pattern</span>
            ${TB_PRESETS.map(p => `
              <button data-preset="${p.id}" type="button" aria-pressed="${this.isPreset(p)}" title="${p.name} — feed ${p.f.toFixed(4)}, kill ${p.k.toFixed(4)}">${p.name}</button>`).join('')}
          </div>
          <div data-type="tb-sliders">
            <div data-type="tb-slider">
              <label for="tb-feed">Feed</label>
              <input id="tb-feed" type="range" min="${TB_FEED_MIN}" max="${TB_FEED_MAX}" value="${rawFeed}" />
              <output id="tb-feed-out">${this.feed.toFixed(4)}</output>
            </div>
            <div data-type="tb-slider">
              <label for="tb-kill">Kill</label>
              <input id="tb-kill" type="range" min="${TB_KILL_MIN}" max="${TB_KILL_MAX}" value="${rawKill}" />
              <output id="tb-kill-out">${this.kill.toFixed(4)}</output>
            </div>
            <div data-type="tb-slider">
              <label for="tb-speed">Speed</label>
              <input id="tb-speed" type="range" min="${TB_SPEED_MIN}" max="${TB_SPEED_MAX}" value="${rawSpeed}" />
              <output id="tb-speed-out">${rawSpeed}×</output>
            </div>
            <div data-type="tb-slider">
              <label for="tb-scale">Scale</label>
              <input id="tb-scale" type="range" min="${TB_SCALE_MIN}" max="${TB_SCALE_MAX}" value="${rawScale}" />
              <output id="tb-scale-out">${rawScale}px</output>
            </div>
          </div>
          <div data-group="palette" role="group" aria-label="Colour palette">
            <span data-type="tb-group-label">Palette</span>
            ${TB_PALETTES.map(p => `
              <button data-palette="${p.id}" type="button" aria-pressed="${p.id === this.palette.id}" title="${p.name} palette">
                <span data-type="tb-swatch" aria-hidden="true">${(p.colors.length ? p.colors : ['var(--color-bg)', 'var(--color-accent)', 'var(--color-text)']).slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span>${p.name}
              </button>`).join('')}
          </div>
          <div data-group="seed">
            <label for="tb-seed">Seed</label>
            <input id="tb-seed" type="text" inputmode="numeric" spellcheck="false" value="${this.seed}"
              aria-label="Seed — type a number and press Enter to replay the same starting specks" />
            <button data-action="copy-seed" type="button" title="Copy this seed">Copy</button>
          </div>
        </div>
        <details data-type="tb-explainer">
          <summary>New here? What reaction-diffusion is</summary>
          <p>Picture two invisible chemicals soaked into every point of the canvas — call them <strong>U</strong> and <strong>V</strong>. U is topped up everywhere at the <strong>feed</strong> rate. Wherever a little V already exists it converts U into more V (the reaction <em>U + 2V → 3V</em>), so V spreads like a stain; meanwhile V is removed at the <strong>kill</strong> rate. Both chemicals also <strong>diffuse</strong>, blurring outward, with U spreading twice as fast as V.</p>
          <p>That tug-of-war — V multiplying where it's dense, dying where it's thin, both smearing at different speeds — is all it takes. Tiny changes to feed and kill flip the whole picture between <strong>spots</strong>, <strong>stripes</strong>, <strong>coral</strong>, a <strong>maze</strong>, or cells that endlessly <strong>divide</strong>. Alan Turing wrote the maths for this in 1952 to explain how a featureless embryo grows leopard spots and zebra stripes.</p>
          <p data-type="tb-try"><strong>Try this:</strong> hit <em>Clear</em>, then scribble on the empty canvas and watch your strokes bloom. Or step through the <em>Pattern</em> presets — <em>Mitosis</em> and <em>U-Skate</em> never settle down.</p>
        </details>
        <p data-type="tb-hint">Shortcuts: space = play/pause · R = reseed · C = clear · D = download. Click or drag the canvas to paint V and grow a bloom.</p>
      </div>
    `

    this.canvas = this.querySelector('[data-type="tb-canvas"]') as HTMLCanvasElement

    // Every one of these engines draws something someone would want to keep, and

    // until Aug 2026 not one of them had a way to save it. The bar is attached

    // here rather than written into the markup above so all six share one

    // implementation — see src/lib/canvas-export.ts.

    attachCanvasExport(this, () => this.canvas, { name: 'turing-bloom' })
    this.ctx = this.canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
    this.grid = document.createElement('canvas')
    this.gctx = this.grid.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
    this.ctx.imageSmoothingEnabled = true
    this.ctx.imageSmoothingQuality = 'high'

    this.buildRamp()
    this.wire()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.querySelector('[data-type="tb-stage"]') as Element)
    requestAnimationFrame(() => {
      this.resize()                          // allocates the grid + seeds it
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced) {
        this.runStatic(500)
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

  /* ── theme + colour ramp ── */

  private resolveThemePalette() {
    const cs = getComputedStyle(document.documentElement)
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
    const theme = TB_PALETTES.find(p => p.id === 'theme')!
    theme.colors = [
      v('--color-bg', '#05070c'),
      v('--color-surface', '#0e131b'),
      v('--color-accent', '#8b7cff'),
      v('--color-text', '#e8e8e8'),
    ]
  }

  /** Build the 256-entry colour LUT by linear interpolation across palette stops. */
  private buildRamp() {
    const stops = (this.palette.colors.length ? this.palette.colors : TB_PALETTES[0].colors)
      .map(c => tbToRGB(c) || [255, 255, 255])
    const n = stops.length
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * (n - 1)
      const lo = Math.floor(t)
      const hi = Math.min(n - 1, lo + 1)
      const f = t - lo
      this.rampR[i] = Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f)
      this.rampG[i] = Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f)
      this.rampB[i] = Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f)
    }
  }

  /* ── geometry / allocation ── */

  private dpr() {
    return Math.min(window.devicePixelRatio || 1, 2)
  }

  private resize() {
    const stage = this.querySelector('[data-type="tb-stage"]') as HTMLElement
    const cssW = stage.getBoundingClientRect().width
    if (cssW < 2) return
    const cssH = Math.round(cssW * TB_ASPECT)
    const dpr = this.dpr()
    this.canvas.style.width = cssW + 'px'
    this.canvas.style.height = cssH + 'px'
    this.w = this.canvas.width = Math.round(cssW * dpr)
    this.h = this.canvas.height = Math.round(cssH * dpr)
    this.ctx.imageSmoothingEnabled = true
    this.ctx.imageSmoothingQuality = 'high'

    const targetCols = tbClamp(Math.round(cssW / this.cell), TB_COLS_MIN, TB_COLS_MAX)
    if (targetCols !== this.cols || this.A.length === 0) {
      this.initGrid(targetCols)
      this.seedGrid()
    }
    this.draw()
  }

  private initGrid(cols: number) {
    this.cols = cols
    this.rows = Math.max(1, Math.round(cols * TB_ASPECT))
    const size = this.cols * this.rows
    this.A = new Float32Array(size)
    this.B = new Float32Array(size)
    this.A2 = new Float32Array(size)
    this.B2 = new Float32Array(size)
    this.grid.width = this.cols
    this.grid.height = this.rows
    this.img = this.gctx.createImageData(this.cols, this.rows)
    // opaque alpha for every pixel, set once
    const d = this.img.data
    for (let i = 3; i < d.length; i += 4) d[i] = 255
  }

  /* ── seeding ── */

  /** Empty field: U everywhere, no V. Nothing grows until painted/seeded. */
  private clear() {
    this.A.fill(1)
    this.B.fill(0)
    this.draw()
  }

  /** Scatter a reproducible set of V specks so a bloom grows from the seed. */
  private seedGrid() {
    this.A.fill(1)
    this.B.fill(0)
    const rnd = tbMulberry32(this.seed)
    const blobs = 10 + Math.floor(rnd() * 8)
    const r = Math.max(2, Math.round(this.cols * 0.02))
    for (let n = 0; n < blobs; n++) {
      const cx = Math.floor(rnd() * this.cols)
      const cy = Math.floor(rnd() * this.rows)
      this.stampCell(cx, cy, r + Math.floor(rnd() * r))
    }
  }

  /** Paint a filled disc of V (with U knocked down) centred on a grid cell. */
  private stampCell(cx: number, cy: number, r: number) {
    const r2 = r * r
    for (let dy = -r; dy <= r; dy++) {
      let y = cy + dy
      if (y < 0) y += this.rows
      else if (y >= this.rows) y -= this.rows
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue
        let x = cx + dx
        if (x < 0) x += this.cols
        else if (x >= this.cols) x -= this.cols
        const i = y * this.cols + x
        this.A[i] = 0.0
        this.B[i] = 1.0
      }
    }
  }

  /* ── simulation ── */

  /** One Gray-Scott solver step with a weighted 3×3 Laplacian, toroidal wrap. */
  private step() {
    const { A, B, A2, B2, cols, rows, feed, kill } = this
    for (let y = 0; y < rows; y++) {
      const yC = y * cols
      const yUp = (y === 0 ? rows - 1 : y - 1) * cols
      const yDn = (y === rows - 1 ? 0 : y + 1) * cols
      for (let x = 0; x < cols; x++) {
        const xL = x === 0 ? cols - 1 : x - 1
        const xR = x === cols - 1 ? 0 : x + 1
        const i = yC + x
        const a = A[i]
        const b = B[i]
        const lapA =
          (A[yC + xL] + A[yC + xR] + A[yUp + x] + A[yDn + x]) * 0.2 +
          (A[yUp + xL] + A[yUp + xR] + A[yDn + xL] + A[yDn + xR]) * 0.05 - a
        const lapB =
          (B[yC + xL] + B[yC + xR] + B[yUp + x] + B[yDn + x]) * 0.2 +
          (B[yUp + xL] + B[yUp + xR] + B[yDn + xL] + B[yDn + xR]) * 0.05 - b
        const abb = a * b * b
        let na = a + (TB_DA * lapA - abb + feed * (1 - a))
        let nb = b + (TB_DB * lapB + abb - (kill + feed) * b)
        A2[i] = na < 0 ? 0 : na > 1 ? 1 : na
        B2[i] = nb < 0 ? 0 : nb > 1 ? 1 : nb
      }
    }
    // swap buffers
    this.A = A2
    this.B = B2
    this.A2 = A
    this.B2 = B
  }

  /** Colour the current field through the ramp and blit it, upscaled, to view. */
  private draw() {
    const { B, img } = this
    const d = img.data
    const contrast = TB_CONTRAST
    for (let i = 0, p = 0; i < B.length; i++, p += 4) {
      let t = B[i] * contrast
      if (t < 0) t = 0
      else if (t > 1) t = 1
      const li = (t * 255) | 0
      d[p] = this.rampR[li]
      d[p + 1] = this.rampG[li]
      d[p + 2] = this.rampB[li]
    }
    this.gctx.putImageData(img, 0, 0)
    this.ctx.drawImage(this.grid, 0, 0, this.cols, this.rows, 0, 0, this.w, this.h)
  }

  private runStatic(n: number) {
    for (let i = 0; i < n; i++) this.step()
    this.draw()
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
    for (let i = 0; i < this.steps; i++) this.step()
    this.draw()
    this.raf = requestAnimationFrame(this.loop)
  }

  /* ── interaction ── */

  private wire() {
    this.querySelector('[data-action="play"]')?.addEventListener('click', () => this.setPlaying(!this.playing))
    this.querySelector('[data-action="reseed"]')?.addEventListener('click', () => this.reseed(true))
    this.querySelector('[data-action="clear"]')?.addEventListener('click', () => { this.clear(); this.canvas.focus() })
    this.querySelector('[data-action="download"]')?.addEventListener('click', () => this.download())
    this.querySelector('[data-action="copy-seed"]')?.addEventListener('click', () => this.copySeed())

    this.bindSlider('#tb-feed', '#tb-feed-out', TB_LS_FEED, raw => {
      this.feed = tbClamp(raw, TB_FEED_MIN, TB_FEED_MAX) / TB_PARAM_SCALE
      tbWriteStored(TB_LS_FEED_EXACT, this.feed.toFixed(4))
      this.syncPresets()
      return this.feed.toFixed(4)
    })
    this.bindSlider('#tb-kill', '#tb-kill-out', TB_LS_KILL, raw => {
      this.kill = tbClamp(raw, TB_KILL_MIN, TB_KILL_MAX) / TB_PARAM_SCALE
      tbWriteStored(TB_LS_KILL_EXACT, this.kill.toFixed(4))
      this.syncPresets()
      return this.kill.toFixed(4)
    })
    this.bindSlider('#tb-speed', '#tb-speed-out', TB_LS_SPEED, raw => {
      this.steps = tbClamp(raw, TB_SPEED_MIN, TB_SPEED_MAX)
      return `${this.steps}×`
    })
    this.bindSlider('#tb-scale', '#tb-scale-out', TB_LS_SCALE, raw => {
      this.cell = tbClamp(raw, TB_SCALE_MIN, TB_SCALE_MAX)
      // re-derive the grid at the new cell size and reseed
      this.cols = 0
      this.resize()
      return `${this.cell}px`
    })

    this.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => this.applyPreset(btn.dataset.preset as string))
    })

    this.querySelectorAll<HTMLButtonElement>('[data-palette]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.palette as string
        this.palette = TB_PALETTES.find(p => p.id === id) || this.palette
        tbWriteStored(TB_LS_PALETTE, id)
        this.querySelectorAll('[data-palette]').forEach(b =>
          b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.palette === id)))
        this.buildRamp()
        this.draw()
      })
    })

    const seedInput = this.querySelector('#tb-seed') as HTMLInputElement
    const applySeed = () => {
      const n = parseInt(seedInput.value.replace(/[^0-9]/g, ''), 10)
      if (Number.isFinite(n) && n > 0) {
        this.seed = n
        this.seedGrid()
        this.playOrSettle()
      } else {
        seedInput.value = String(this.seed)
      }
    }
    seedInput.addEventListener('change', applySeed)
    seedInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applySeed() } })

    // paint V by pointer (down + drag)
    this.canvas.addEventListener('pointerdown', e => this.onPointer(e, true))
    this.canvas.addEventListener('pointermove', e => this.onPointer(e, false))
    const stop = () => { this.painting = false }
    this.canvas.addEventListener('pointerup', stop)
    this.canvas.addEventListener('pointerleave', stop)
    this.canvas.addEventListener('pointercancel', stop)
    this.canvas.addEventListener('keydown', e => this.onKey(e))
  }

  private bindSlider(inputSel: string, outSel: string, lsKey: string, apply: (raw: number) => string) {
    const input = this.querySelector(inputSel) as HTMLInputElement
    const out = this.querySelector(outSel) as HTMLOutputElement | null
    input.addEventListener('input', () => {
      const raw = Number(input.value)
      const label = apply(raw)
      if (out) out.textContent = label
      tbWriteStored(lsKey, String(raw))
    })
  }

  private onKey(e: KeyboardEvent) {
    switch (e.key) {
      case ' ': e.preventDefault(); this.setPlaying(!this.playing); break
      case 'r': case 'R': e.preventDefault(); this.reseed(true); break
      case 'c': case 'C': e.preventDefault(); this.clear(); break
      case 'd': case 'D': e.preventDefault(); this.download(); break
    }
  }

  private onPointer(e: PointerEvent, down: boolean) {
    if (down) {
      this.painting = true
      this.canvas.focus()
      try { this.canvas.setPointerCapture(e.pointerId) } catch { /* older browsers */ }
    }
    if (!this.painting) return
    e.preventDefault()
    const rect = this.canvas.getBoundingClientRect()
    const gx = Math.floor((e.clientX - rect.left) / rect.width * this.cols)
    const gy = Math.floor((e.clientY - rect.top) / rect.height * this.rows)
    if (gx < 0 || gy < 0 || gx >= this.cols || gy >= this.rows) return
    this.stampCell(gx, gy, Math.max(2, Math.round(this.cols * 0.03)))
    if (!this.playing) this.draw()
  }

  /* ── presets ── */

  private isPreset(p: TbPreset) {
    return Math.abs(p.f - this.feed) < 1e-6 && Math.abs(p.k - this.kill) < 1e-6
  }

  private syncPresets() {
    this.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(btn => {
      const p = TB_PRESETS.find(pr => pr.id === btn.dataset.preset)
      btn.setAttribute('aria-pressed', String(p ? this.isPreset(p) : false))
    })
  }

  private applyPreset(id: string) {
    const p = TB_PRESETS.find(pr => pr.id === id)
    if (!p) return
    this.feed = p.f
    this.kill = p.k
    const feedRaw = Math.round(p.f * TB_PARAM_SCALE)
    const killRaw = Math.round(p.k * TB_PARAM_SCALE)
    const fIn = this.querySelector('#tb-feed') as HTMLInputElement | null
    const kIn = this.querySelector('#tb-kill') as HTMLInputElement | null
    const fOut = this.querySelector('#tb-feed-out') as HTMLOutputElement | null
    const kOut = this.querySelector('#tb-kill-out') as HTMLOutputElement | null
    if (fIn) fIn.value = String(feedRaw)
    if (kIn) kIn.value = String(killRaw)
    if (fOut) fOut.textContent = this.feed.toFixed(4)
    if (kOut) kOut.textContent = this.kill.toFixed(4)
    tbWriteStored(TB_LS_FEED, String(feedRaw))
    tbWriteStored(TB_LS_KILL, String(killRaw))
    tbWriteStored(TB_LS_FEED_EXACT, p.f.toFixed(4))
    tbWriteStored(TB_LS_KILL_EXACT, p.k.toFixed(4))
    this.syncPresets()
    this.seedGrid()
    this.playOrSettle()
  }

  private reseed(fresh: boolean) {
    if (fresh) {
      this.seed = Math.floor(Math.random() * 900000) + 100000
      const seedInput = this.querySelector('#tb-seed') as HTMLInputElement | null
      if (seedInput) seedInput.value = String(this.seed)
    }
    this.seedGrid()
    this.playOrSettle()
  }

  /** Start the loop, or (reduced-motion) settle a still frame and stay paused. */
  private playOrSettle() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.runStatic(500)
      this.setPlaying(false)
    } else {
      this.setPlaying(true)
    }
  }

  private copySeed() {
    const btn = this.querySelector('[data-action="copy-seed"]') as HTMLButtonElement | null
    const text = String(this.seed)
    const flash = (label: string) => {
      if (!btn) return
      const previous = btn.textContent
      btn.textContent = label
      setTimeout(() => { if (this.isConnected) btn.textContent = previous || 'Copy' }, 1200)
    }
    if (!navigator.clipboard?.writeText) {
      flash('Copy unavailable')
      return
    }
    navigator.clipboard.writeText(text).then(() => flash('Copied')).catch(() => flash('Copy failed'))
  }

  private download() {
    try {
      const url = this.canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = `turing-bloom-${this.seed}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      /* toDataURL can throw on a tainted canvas — it never is here (no external images) */
    }
  }
}

if (!customElements.get('turing-bloom-game')) {
  customElements.define('turing-bloom-game', TuringBloomGame)
}

export {}
