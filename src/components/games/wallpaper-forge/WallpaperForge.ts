/**
 * Wallpaper Forge — a seeded generative wallpaper maker on a 2D canvas, zero
 * dependencies. Five distinct generative engines produce a static, download-ready
 * wallpaper; nothing animates, so it renders instantly and needs no motion budget.
 *
 *   • Aurora     — soft glowing mesh-gradient blobs (additive light).
 *   • Waves      — smooth layered bands with wavy, sine-woven crests.
 *   • Topographic — iso-contour linework traced from fractal value noise.
 *   • Truchet    — a grid of two-arc tiles that weave into flowing maze lines.
 *   • Terrazzo   — scattered organic chips (circles / triangles / quads / pills).
 *
 * Everything is deterministic from the settings plus an integer SEED: type a
 * seed to reproduce a piece with the same settings, or hit Regenerate for a new one. The composition is
 * drawn in resolution-independent terms, so the on-screen PREVIEW and the
 * full-resolution PNG export are the same picture — the download renders into an
 * offscreen canvas at the chosen device resolution (phone / desktop / square /
 * tablet). Density, Detail and Grain sliders, palette, aspect and pattern are all
 * persisted in localStorage.
 *
 * Colours are DATA (the palettes), matching the sibling generative toys; the
 * "Theme" palette is resolved from the theme.css tokens at mount so it tracks the
 * site's accent. No animation loop exists (static art); the initial sizing frame
 * and ResizeObserver are both torn down if the component is removed.
 */

interface Palette {
  id: string
  name: string
  bg: string
  colors: string[]
}

/* Curated, wallpaper-friendly palettes. "theme" is resolved from CSS tokens. */
const WF_PALETTES: Palette[] = [
  { id: 'theme', name: 'Theme', bg: '', colors: [] },
  { id: 'ember', name: 'Ember', bg: '#1a0a05', colors: ['#ff6b35', '#f7931e', '#ffd23f', '#ee4266', '#c1121f'] },
  { id: 'ocean', name: 'Ocean', bg: '#02030f', colors: ['#00b4d8', '#0077b6', '#48cae4', '#90e0ef', '#4361ee'] },
  { id: 'neon', name: 'Neon', bg: '#0a0612', colors: ['#ff006e', '#8338ec', '#3a86ff', '#06ffa5', '#fb5607'] },
  { id: 'forest', name: 'Forest', bg: '#04120c', colors: ['#2d6a4f', '#40916c', '#74c69d', '#b7e4c7', '#95d5b2'] },
  { id: 'sunset', name: 'Sunset', bg: '#160318', colors: ['#f72585', '#b5179e', '#7209b7', '#ff9e00', '#ffbe0b'] },
  { id: 'mono', name: 'Mono', bg: '#090909', colors: ['#f2f2f2', '#c4c4c4', '#8f8f8f', '#5c5c5c', '#d9d9d9'] },
]

type PatternId = 'aurora' | 'waves' | 'topo' | 'truchet' | 'terrazzo'

const WF_PATTERNS: { id: PatternId; name: string; blurb: string }[] = [
  { id: 'aurora', name: 'Aurora', blurb: 'glowing gradient mesh' },
  { id: 'waves', name: 'Waves', blurb: 'layered flowing bands' },
  { id: 'topo', name: 'Topographic', blurb: 'noise contour lines' },
  { id: 'truchet', name: 'Truchet', blurb: 'woven arc tiles' },
  { id: 'terrazzo', name: 'Terrazzo', blurb: 'scattered chips' },
]

type AspectId = 'phone' | 'desktop' | 'square' | 'tablet'

const WF_ASPECTS: { id: AspectId; name: string; w: number; h: number }[] = [
  { id: 'phone', name: 'Phone', w: 1080, h: 2340 },
  { id: 'desktop', name: 'Desktop', w: 2560, h: 1440 },
  { id: 'square', name: 'Square', w: 2048, h: 2048 },
  { id: 'tablet', name: 'Tablet', w: 1668, h: 2388 },
]

const LS_PATTERN = 'wf:pattern'
const LS_PALETTE = 'wf:palette'
const LS_DENSITY = 'wf:density'
const LS_DETAIL = 'wf:detail'
const LS_GRAIN = 'wf:grain'
const LS_ASPECT = 'wf:aspect'
const LS_SEED = 'wf:seed'

const TAU = Math.PI * 2

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function readStoredNumber(key: string, fallback: number): number {
  const raw = readStored(key)
  if (raw === null) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage disabled — the forge still works for this session */
  }
}

function randomSeed() {
  return Math.floor(Math.random() * 900000) + 100000
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
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v)
}

/* Fractal (multi-octave) value noise in [0,1]. */
function fbm(x: number, y: number, seed: number, octaves: number) {
  let amp = 1, freq = 1, sum = 0, norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 1013)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

/* ── colour helpers (palettes are data; parsed to blend + set alpha) ── */

function parseColor(input: string): [number, number, number] {
  let s = input.trim()
  if (s.startsWith('#')) {
    if (s.length === 4) s = '#' + [...s.slice(1)].map(c => c + c).join('')
    const r = parseInt(s.slice(1, 3), 16)
    const g = parseInt(s.slice(3, 5), 16)
    const b = parseInt(s.slice(5, 7), 16)
    if ([r, g, b].every(n => !Number.isNaN(n))) return [r, g, b]
  }
  const m = s.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const p = m[1].split(',').map(x => parseFloat(x))
    if (p.length >= 3) return [p[0], p[1], p[2]]
  }
  return [136, 136, 136]
}

function rgba(c: [number, number, number], a: number) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

/* Smoothly walk a palette as a gradient ramp; t in [0,1]. */
function ramp(cols: [number, number, number][], t: number): [number, number, number] {
  if (cols.length === 1) return cols[0]
  const x = clamp(t, 0, 1) * (cols.length - 1)
  const i = Math.min(cols.length - 2, Math.floor(x))
  return mix(cols[i], cols[i + 1], x - i)
}

class WallpaperForgeGame extends HTMLElement {
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private ro?: ResizeObserver
  private pendingFrame = 0
  private copyTimer = 0

  // tunables
  private pattern: PatternId = 'aurora'
  private palette: Palette = WF_PALETTES[2]
  private densityRaw = 50
  private detailRaw = 50
  private grainRaw = 12
  private aspect: AspectId = 'phone'
  private seed = 1

  connectedCallback() {
    // Resolve the token-driven "Theme" palette FIRST, so a saved "Theme" choice
    // survives the empty-palette guard below (and its swatch renders resolved).
    this.resolveThemePalette()

    // restore prefs
    const savedPattern = readStored(LS_PATTERN) as PatternId | null
    const savedPalette = readStored(LS_PALETTE)
    const savedAspect = readStored(LS_ASPECT) as AspectId | null
    this.pattern = WF_PATTERNS.some(p => p.id === savedPattern) ? (savedPattern as PatternId) : 'aurora'
    this.palette = WF_PALETTES.find(p => p.id === savedPalette) || WF_PALETTES[2]
    if (this.palette.id === 'theme' && this.palette.colors.length === 0) this.palette = WF_PALETTES[2]
    this.aspect = WF_ASPECTS.some(a => a.id === savedAspect) ? (savedAspect as AspectId) : 'phone'
    this.densityRaw = clamp(readStoredNumber(LS_DENSITY, 50), 0, 100)
    this.detailRaw = clamp(readStoredNumber(LS_DETAIL, 50), 0, 100)
    this.grainRaw = clamp(readStoredNumber(LS_GRAIN, 12), 0, 100)
    const savedSeed = Math.floor(readStoredNumber(LS_SEED, 0))
    this.seed = Number.isSafeInteger(savedSeed) && savedSeed > 0 ? savedSeed : randomSeed()
    writeStored(LS_SEED, String(this.seed))

    this.innerHTML = `
      <div data-type="wf-game">
        <div data-type="wf-header">
          <div data-type="wf-titlebar">
            <h1>Wallpaper Forge</h1>
            <span data-type="wf-badge">seeded generative art</span>
          </div>
          <p>Forge a one-of-a-kind wallpaper in the browser. Pick an engine — glowing gradients, flowing waves, noise contours, woven tiles or scattered chips — dial the density, detail and grain, then download a crisp, full-resolution PNG sized for your phone, desktop, tablet or a square. Every piece is fixed by its settings and seed, so copy the seed to revisit one with the same settings or reroll for a fresh one.</p>
        </div>
        <div data-type="wf-stage">
          <canvas data-type="wf-canvas" tabindex="0" role="img"
            aria-label="Generative wallpaper preview. Regenerate for a new seed, or download it as a PNG."></canvas>
        </div>
        <div data-type="wf-controls">
          <div data-group="transport" role="group" aria-label="Actions">
            <button data-action="regen" type="button" title="New random seed (R)">Regenerate</button>
            <button data-action="download" type="button" title="Save the wallpaper as a full-resolution PNG (D)">Download PNG</button>
          </div>
          <div data-group="pattern" role="group" aria-label="Pattern engine">
            <span data-type="wf-group-label">Pattern</span>
            ${WF_PATTERNS.map(p => `
              <button data-pattern="${p.id}" type="button" aria-pressed="${p.id === this.pattern}" title="${p.name} — ${p.blurb}">${p.name}</button>`).join('')}
          </div>
          <div data-group="aspect" role="group" aria-label="Resolution and shape">
            <span data-type="wf-group-label">Size</span>
            ${WF_ASPECTS.map(a => `
              <button data-aspect="${a.id}" type="button" aria-pressed="${a.id === this.aspect}" title="${a.name} — ${a.w}×${a.h}px">${a.name} <span data-type="wf-dim" aria-hidden="true">${a.w}×${a.h}</span></button>`).join('')}
          </div>
          <div data-type="wf-sliders">
            <div data-type="wf-slider">
              <label for="wf-density">Density</label>
              <input id="wf-density" type="range" min="0" max="100" value="${this.densityRaw}" />
              <output id="wf-density-out" for="wf-density">${this.densityLabel()}</output>
            </div>
            <div data-type="wf-slider">
              <label for="wf-detail">Detail</label>
              <input id="wf-detail" type="range" min="0" max="100" value="${this.detailRaw}" />
              <output id="wf-detail-out" for="wf-detail">${this.detailRaw}</output>
            </div>
            <div data-type="wf-slider">
              <label for="wf-grain">Grain</label>
              <input id="wf-grain" type="range" min="0" max="100" value="${this.grainRaw}" />
              <output id="wf-grain-out" for="wf-grain">${this.grainRaw}%</output>
            </div>
          </div>
          <div data-group="palette" role="group" aria-label="Colour palette">
            <span data-type="wf-group-label">Palette</span>
            ${WF_PALETTES.map(p => `
              <button data-palette="${p.id}" type="button" aria-pressed="${p.id === this.palette.id}" title="${p.name} palette">
                <span data-type="wf-swatch" aria-hidden="true">${(p.colors.length ? p.colors : ['var(--color-accent)', 'var(--color-text)', 'var(--color-muted)']).slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span>${p.name}
              </button>`).join('')}
          </div>
          <div data-group="seed">
            <label for="wf-seed">Seed</label>
            <input id="wf-seed" type="text" inputmode="numeric" spellcheck="false" value="${this.seed}"
              aria-label="Seed — type a number and press Enter to reproduce a wallpaper" />
            <button data-action="copy-seed" type="button" title="Copy this seed">Copy</button>
          </div>
        </div>
        <details data-type="wf-explainer">
          <summary>How the engines work</summary>
          <p><strong>Everything is seeded.</strong> A single number drives a deterministic random stream, so the same settings and seed always forge the exact same wallpaper — the preview you see and the PNG you download are one and the same picture, just rendered at your device's resolution.</p>
          <p><strong>Aurora</strong> stacks soft radial gradients with additive light for a glowing mesh. <strong>Waves</strong> fills layered bands whose crests are woven from stacked sine curves. <strong>Topographic</strong> traces iso-contour lines through a field of fractal value noise, like a map's elevation rings. <strong>Truchet</strong> drops one of two quarter-arc tiles into each grid cell, and the arcs join up into endless flowing lines. <strong>Terrazzo</strong> scatters little chips across the ground.</p>
          <p data-type="wf-try"><strong>Try this:</strong> switch to <em>Topographic</em>, push <em>Detail</em> high and <em>Density</em> low, add a touch of <em>Grain</em>, then <em>Regenerate</em> until a seed grabs you — and <em>Copy</em> it. <em>Density</em> and <em>Detail</em> mean something a little different in each engine (the readout tells you what Density controls).</p>
        </details>
        <p data-type="wf-hint">Shortcuts: R = regenerate · D = download. Pick a Size, then Download for a full-resolution wallpaper.</p>
      </div>
    `

    this.canvas = this.querySelector('[data-type="wf-canvas"]') as HTMLCanvasElement
    this.ctx = this.canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
    const seedInput = this.querySelector('#wf-seed') as HTMLInputElement
    seedInput.value = String(this.seed)
    this.wire()

    this.ro = new ResizeObserver(() => this.resizeAndRender())
    this.ro.observe(this.querySelector('[data-type="wf-stage"]') as Element)
    this.pendingFrame = window.requestAnimationFrame(() => {
      this.pendingFrame = 0
      this.resizeAndRender()
    })
  }

  disconnectedCallback() {
    this.ro?.disconnect()
    if (this.pendingFrame) window.cancelAnimationFrame(this.pendingFrame)
    if (this.copyTimer) window.clearTimeout(this.copyTimer)
    this.pendingFrame = 0
    this.copyTimer = 0
  }

  /* ── theme palette resolution ── */

  private resolveThemePalette() {
    const cs = getComputedStyle(document.documentElement)
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
    const theme = WF_PALETTES[0]
    theme.bg = v('--color-bg', '#05070c')
    const accent = parseColor(v('--color-accent', '#9b8cff'))
    theme.colors = [
      v('--color-accent', '#9b8cff'),
      rgba(mix(accent, [255, 255, 255], 0.4), 1),
      v('--color-text', '#dde6f2'),
      v('--color-muted', '#73808f'),
      rgba(mix(accent, [255, 255, 255], 0.72), 1),
    ]
  }

  private paletteColors(): [number, number, number][] {
    const src = this.palette.colors.length ? this.palette.colors : WF_PALETTES[0].colors
    return src.map(parseColor)
  }

  private bgColor(): string {
    return this.palette.bg || WF_PALETTES[0].bg || '#05070c'
  }

  /* ── slider readouts ── */

  private densityCount(): number {
    const d = this.densityRaw / 100
    switch (this.pattern) {
      case 'aurora': return 3 + Math.round(d * 12)
      case 'waves': return 4 + Math.round(d * 14)
      case 'topo': return 6 + Math.round(d * 30)
      case 'truchet': return 4 + Math.round(d * 20)
      case 'terrazzo': return 40 + Math.round(d * 400)
    }
  }

  private densityLabel(): string {
    const n = this.densityCount()
    const unit = { aurora: 'blobs', waves: 'layers', topo: 'lines', truchet: 'tiles', terrazzo: 'chips' }[this.pattern]
    return `${n} ${unit}`
  }

  private refreshDensityOut() {
    const out = this.querySelector('#wf-density-out')
    if (out) out.textContent = this.densityLabel()
  }

  /* ── geometry / preview sizing ── */

  private dpr() {
    return Math.min(window.devicePixelRatio || 1, 2)
  }

  private target() {
    return WF_ASPECTS.find(a => a.id === this.aspect) || WF_ASPECTS[0]
  }

  private resizeAndRender() {
    const stage = this.querySelector('[data-type="wf-stage"]') as HTMLElement
    const stageW = stage.getBoundingClientRect().width
    if (stageW < 2) return
    const t = this.target()
    const ar = t.w / t.h
    const maxH = Math.min((window.innerHeight || 800) * 0.66, 560)
    let dispW = stageW
    let dispH = stageW / ar
    if (dispH > maxH) { dispH = maxH; dispW = maxH * ar }
    if (dispW > stageW) { dispW = stageW; dispH = stageW / ar }
    this.canvas.style.width = dispW + 'px'
    this.canvas.style.height = dispH + 'px'
    const dpr = this.dpr()
    this.canvas.width = Math.max(2, Math.round(dispW * dpr))
    this.canvas.height = Math.max(2, Math.round(dispH * dpr))
    this.renderTo(this.ctx, this.canvas.width, this.canvas.height)
  }

  private renderPreview() {
    this.renderTo(this.ctx, this.canvas.width, this.canvas.height)
  }

  /* ── the composition (deterministic; used by preview AND export) ── */

  private renderTo(ctx: CanvasRenderingContext2D, W: number, H: number) {
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = this.bgColor()
    ctx.fillRect(0, 0, W, H)
    const cols = this.paletteColors()
    const rnd = mulberry32(this.seed)
    const e = this.detailRaw / 100
    switch (this.pattern) {
      case 'aurora': this.drawAurora(ctx, W, H, cols, rnd, e); break
      case 'waves': this.drawWaves(ctx, W, H, cols, rnd, e); break
      case 'topo': this.drawTopo(ctx, W, H, cols, e); break
      case 'truchet': this.drawTruchet(ctx, W, H, cols, rnd, e); break
      case 'terrazzo': this.drawTerrazzo(ctx, W, H, cols, rnd, e); break
    }
    if (this.grainRaw > 0) this.applyGrain(ctx, W, H)
    ctx.restore()
  }

  private drawAurora(ctx: CanvasRenderingContext2D, W: number, H: number, cols: [number, number, number][], rnd: () => number, e: number) {
    const minDim = Math.min(W, H)
    const n = this.densityCount()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < n; i++) {
      const cx = rnd() * W
      const cy = rnd() * H
      const c = cols[(rnd() * cols.length) | 0]
      const r = lerp(0.55, 0.24, e) * minDim * (0.6 + rnd() * 1.0)
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      g.addColorStop(0, rgba(c, 0.55))
      g.addColorStop(0.5, rgba(c, 0.22))
      g.addColorStop(1, rgba(c, 0))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  private drawWaves(ctx: CanvasRenderingContext2D, W: number, H: number, cols: [number, number, number][], rnd: () => number, e: number) {
    const layers = this.densityCount()
    const baseAmp = H * 0.035 * (1 + e * 1.8)
    // three harmonics per layer, seeded phases/frequencies
    for (let L = 0; L < layers; L++) {
      const t = layers === 1 ? 0 : L / (layers - 1)
      const yBase = H * (0.06 + (L / layers) * 1.0)
      const f1 = (1 + Math.floor(rnd() * 2)) * (1 + e * 2)
      const f2 = (2 + Math.floor(rnd() * 3)) * (1 + e * 2)
      const f3 = (4 + Math.floor(rnd() * 4)) * (1 + e * 2)
      const p1 = rnd() * TAU, p2 = rnd() * TAU, p3 = rnd() * TAU
      const a1 = baseAmp * (0.6 + rnd() * 0.6)
      const a2 = baseAmp * (0.3 + rnd() * 0.4)
      const a3 = baseAmp * (0.15 + rnd() * 0.25)
      const top = ramp(cols, t)
      const bottom = mix(top, parseColor(this.bgColor()), 0.35)
      const grad = ctx.createLinearGradient(0, yBase - baseAmp, 0, H)
      grad.addColorStop(0, rgba(top, 1))
      grad.addColorStop(1, rgba(bottom, 1))
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.moveTo(0, H)
      const steps = 64
      for (let s = 0; s <= steps; s++) {
        const x = (s / steps) * W
        const u = (s / steps) * TAU
        const y = yBase
          + a1 * Math.sin(u * f1 + p1)
          + a2 * Math.sin(u * f2 + p2)
          + a3 * Math.sin(u * f3 + p3)
        ctx.lineTo(x, y)
      }
      ctx.lineTo(W, H)
      ctx.closePath()
      ctx.fill()
    }
  }

  private drawTopo(ctx: CanvasRenderingContext2D, W: number, H: number, cols: [number, number, number][], e: number) {
    const levels = this.densityCount()
    const gridCols = 90 + Math.round(e * 100)
    const gridRows = Math.max(4, Math.round(gridCols * (H / W)))
    const cw = W / gridCols
    const ch = H / gridRows
    const freq = (1.4 + e * 5.5) / Math.max(W, H)
    const octaves = 4
    // sample the noise field at every grid corner
    const field: number[] = new Array((gridCols + 1) * (gridRows + 1))
    for (let y = 0; y <= gridRows; y++) {
      for (let x = 0; x <= gridCols; x++) {
        field[y * (gridCols + 1) + x] = fbm(x * cw * freq, y * ch * freq, this.seed, octaves)
      }
    }
    const at = (x: number, y: number) => field[y * (gridCols + 1) + x]
    ctx.lineWidth = Math.max(1, Math.min(W, H) * 0.0016 * (1 + e))
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (let li = 0; li < levels; li++) {
      const level = lerp(0.2, 0.82, levels === 1 ? 0.5 : li / (levels - 1))
      ctx.strokeStyle = rgba(ramp(cols, li / Math.max(1, levels - 1)), 0.92)
      ctx.beginPath()
      for (let y = 0; y < gridRows; y++) {
        for (let x = 0; x < gridCols; x++) {
          const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1)
          const x0 = x * cw, y0 = y * ch, x1 = x0 + cw, y1 = y0 + ch
          // crossings in edge order: top, right, bottom, left
          const pts: [number, number][] = []
          if ((tl - level) * (tr - level) < 0) pts.push([x0 + ((level - tl) / (tr - tl)) * cw, y0])
          if ((tr - level) * (br - level) < 0) pts.push([x1, y0 + ((level - tr) / (br - tr)) * ch])
          if ((bl - level) * (br - level) < 0) pts.push([x0 + ((level - bl) / (br - bl)) * cw, y1])
          if ((tl - level) * (bl - level) < 0) pts.push([x0, y0 + ((level - tl) / (bl - tl)) * ch])
          if (pts.length === 2) {
            ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1])
          } else if (pts.length === 4) {
            ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1])
            ctx.moveTo(pts[2][0], pts[2][1]); ctx.lineTo(pts[3][0], pts[3][1])
          }
        }
      }
      ctx.stroke()
    }
  }

  private drawTruchet(ctx: CanvasRenderingContext2D, W: number, H: number, cols: [number, number, number][], rnd: () => number, e: number) {
    const across = this.densityCount()
    const tile = W / across
    const rows = Math.ceil(H / tile) + 1
    const r = tile / 2
    ctx.lineWidth = tile * lerp(0.08, 0.28, e)
    ctx.lineCap = 'round'
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < across; gx++) {
        const ox = gx * tile, oy = gy * tile
        ctx.strokeStyle = rgba(cols[(rnd() * cols.length) | 0], 0.95)
        ctx.beginPath()
        if (rnd() < 0.5) {
          // arcs at top-left and bottom-right corners
          ctx.arc(ox, oy, r, 0, Math.PI / 2)
          ctx.moveTo(ox + tile, oy + tile)
          ctx.arc(ox + tile, oy + tile, r, Math.PI, Math.PI * 1.5)
        } else {
          // arcs at top-right and bottom-left corners
          ctx.arc(ox + tile, oy, r, Math.PI / 2, Math.PI)
          ctx.moveTo(ox, oy + tile)
          ctx.arc(ox, oy + tile, r, Math.PI * 1.5, TAU)
        }
        ctx.stroke()
      }
    }
  }

  private drawTerrazzo(ctx: CanvasRenderingContext2D, W: number, H: number, cols: [number, number, number][], rnd: () => number, e: number) {
    const chips = this.densityCount()
    const minDim = Math.min(W, H)
    const base = minDim * lerp(0.03, 0.011, e)
    for (let i = 0; i < chips; i++) {
      const cx = rnd() * W
      const cy = rnd() * H
      const sz = base * (0.45 + rnd() * 1.1)
      const rot = rnd() * TAU
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(rot)
      ctx.fillStyle = rgba(cols[(rnd() * cols.length) | 0], 0.92)
      const shape = (rnd() * 4) | 0
      ctx.beginPath()
      if (shape === 0) {
        ctx.arc(0, 0, sz, 0, TAU)
      } else if (shape === 1) {
        // triangle
        ctx.moveTo(0, -sz)
        ctx.lineTo(sz * 0.87, sz * 0.5)
        ctx.lineTo(-sz * 0.87, sz * 0.5)
        ctx.closePath()
      } else if (shape === 2) {
        // rounded-ish quad
        ctx.rect(-sz * 0.8, -sz * 0.8, sz * 1.6, sz * 1.6)
      } else {
        // pill
        const w = sz * 1.6, h = sz * 0.7
        ctx.moveTo(-w / 2 + h / 2, -h / 2)
        ctx.arc(w / 2 - h / 2, 0, h / 2, -Math.PI / 2, Math.PI / 2)
        ctx.lineTo(-w / 2 + h / 2, h / 2)
        ctx.arc(-w / 2 + h / 2, 0, h / 2, Math.PI / 2, -Math.PI / 2)
      }
      ctx.fill()
      ctx.restore()
    }
  }

  /* Tiled film-grain overlay — cheap, resolution-independent, seeded. */
  private applyGrain(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const size = 160
    const tile = document.createElement('canvas')
    tile.width = size
    tile.height = size
    const tctx = tile.getContext('2d') as CanvasRenderingContext2D
    const img = tctx.createImageData(size, size)
    const gr = mulberry32(this.seed ^ 0x5bd1e995)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (gr() * 255) | 0
      img.data[i] = v
      img.data[i + 1] = v
      img.data[i + 2] = v
      img.data[i + 3] = (gr() * 255) | 0
    }
    tctx.putImageData(img, 0, 0)
    const pat = ctx.createPattern(tile, 'repeat')
    if (!pat) return
    ctx.save()
    ctx.globalCompositeOperation = 'overlay'
    ctx.globalAlpha = (this.grainRaw / 100) * 0.5
    ctx.fillStyle = pat
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }

  /* ── interaction ── */

  private wire() {
    this.querySelector('[data-action="regen"]')?.addEventListener('click', () => this.regenerate())
    this.querySelector('[data-action="download"]')?.addEventListener('click', () => this.download())
    this.querySelector('[data-action="copy-seed"]')?.addEventListener('click', () => this.copySeed())

    this.querySelectorAll<HTMLButtonElement>('[data-pattern]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.pattern = btn.dataset.pattern as PatternId
        writeStored(LS_PATTERN, this.pattern)
        this.querySelectorAll('[data-pattern]').forEach(b =>
          b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.pattern === this.pattern)))
        this.refreshDensityOut()
        this.renderPreview()
      })
    })

    this.querySelectorAll<HTMLButtonElement>('[data-aspect]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.aspect = btn.dataset.aspect as AspectId
        writeStored(LS_ASPECT, this.aspect)
        this.querySelectorAll('[data-aspect]').forEach(b =>
          b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.aspect === this.aspect)))
        this.resizeAndRender()
      })
    })

    this.querySelectorAll<HTMLButtonElement>('[data-palette]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.palette as string
        this.palette = WF_PALETTES.find(p => p.id === id) || this.palette
        writeStored(LS_PALETTE, id)
        this.querySelectorAll('[data-palette]').forEach(b =>
          b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.palette === id)))
        this.renderPreview()
      })
    })

    this.bindSlider('#wf-density', '#wf-density-out', LS_DENSITY, raw => {
      this.densityRaw = clamp(raw, 0, 100)
      return this.densityLabel()
    })
    this.bindSlider('#wf-detail', '#wf-detail-out', LS_DETAIL, raw => {
      this.detailRaw = clamp(raw, 0, 100)
      return String(this.detailRaw)
    })
    this.bindSlider('#wf-grain', '#wf-grain-out', LS_GRAIN, raw => {
      this.grainRaw = clamp(raw, 0, 100)
      return `${this.grainRaw}%`
    })

    const seedInput = this.querySelector('#wf-seed') as HTMLInputElement
    const applySeed = () => {
      const n = parseInt(seedInput.value.replace(/[^0-9]/g, ''), 10)
      if (Number.isFinite(n) && n > 0) {
        this.seed = n
        seedInput.value = String(this.seed)
        writeStored(LS_SEED, String(this.seed))
        this.renderPreview()
      } else {
        seedInput.value = String(this.seed)
      }
    }
    seedInput.addEventListener('change', applySeed)
    seedInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applySeed() } })

    this.canvas.addEventListener('keydown', e => this.onKey(e))
    this.canvas.addEventListener('pointerdown', () => this.canvas.focus())
  }

  private bindSlider(inputSel: string, outSel: string, lsKey: string, apply: (raw: number) => string) {
    const input = this.querySelector(inputSel) as HTMLInputElement
    const out = this.querySelector(outSel) as HTMLOutputElement | null
    input.addEventListener('input', () => {
      const raw = Number(input.value)
      const label = apply(raw)
      if (out) out.textContent = label
      writeStored(lsKey, String(raw))
      this.renderPreview()
    })
  }

  private onKey(e: KeyboardEvent) {
    switch (e.key) {
      case 'r': case 'R': e.preventDefault(); this.regenerate(); break
      case 'd': case 'D': e.preventDefault(); this.download(); break
    }
  }

  private regenerate() {
    this.seed = randomSeed()
    writeStored(LS_SEED, String(this.seed))
    const seedInput = this.querySelector('#wf-seed') as HTMLInputElement | null
    if (seedInput) seedInput.value = String(this.seed)
    this.renderPreview()
  }

  private copySeed() {
    const text = String(this.seed)
    if (!navigator.clipboard?.writeText) {
      this.flashCopyStatus('Copy unavailable')
      return
    }
    navigator.clipboard.writeText(text)
      .then(() => this.flashCopyStatus('Copied'))
      .catch(() => this.flashCopyStatus('Copy failed'))
  }

  private flashCopyStatus(label: string) {
    if (!this.isConnected) return
    const btn = this.querySelector('[data-action="copy-seed"]') as HTMLButtonElement | null
    if (!btn) return
    if (this.copyTimer) window.clearTimeout(this.copyTimer)
    btn.textContent = label
    this.copyTimer = window.setTimeout(() => {
      this.copyTimer = 0
      if (this.isConnected) btn.textContent = 'Copy'
    }, 1200)
  }

  private download() {
    const t = this.target()
    const off = document.createElement('canvas')
    off.width = t.w
    off.height = t.h
    const octx = off.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
    this.renderTo(octx, t.w, t.h)
    try {
      const url = off.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = `wallpaper-${this.pattern}-${this.aspect}-${this.seed}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      /* toDataURL can throw on a tainted canvas — never taints here (no external images) */
    }
  }
}

if (!customElements.get('wallpaper-forge-game')) {
  customElements.define('wallpaper-forge-game', WallpaperForgeGame)
}

export {}
