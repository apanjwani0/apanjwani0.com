/**
 * Pattern Forge — a seeded generative wallpaper / art maker.
 * Pure canvas 2D, no dependencies. Deterministic: the same seed + style +
 * palette + density always reproduces the same artwork, so creations are
 * shareable via the URL hash and exportable as high-resolution PNGs.
 */

type StyleId = 'flow' | 'harmonograph' | 'mosaic' | 'waves' | 'constellation'

interface Palette {
  id: string
  name: string
  bg: string
  colors: string[]
}

const PALETTES: Palette[] = [
  { id: 'ember', name: 'Ember', bg: '#140c0a', colors: ['#ff6b35', '#f7c59f', '#efefd0', '#ff9505', '#e2711d'] },
  { id: 'tide', name: 'Tide', bg: '#0a1014', colors: ['#1b9aaa', '#06d6a0', '#bce7fd', '#118ab2', '#073b4c'] },
  { id: 'bloom', name: 'Bloom', bg: '#120a14', colors: ['#f72585', '#b5179e', '#7209b7', '#ff8fab', '#4cc9f0'] },
  { id: 'sand', name: 'Sand', bg: '#15110a', colors: ['#e6ccb2', '#ddb892', '#b08968', '#7f5539', '#f5ebe0'] },
  { id: 'mono', name: 'Mono', bg: '#0c0c0c', colors: ['#f5f5f5', '#bdbdbd', '#8a8a8a', '#5c5c5c', '#e0e0e0'] },
  { id: 'aurora', name: 'Aurora', bg: '#08111a', colors: ['#80ffdb', '#64dfdf', '#48bfe3', '#5390d9', '#7400b8'] },
]

const STYLES: { id: StyleId; name: string }[] = [
  { id: 'flow', name: 'Flow Field' },
  { id: 'harmonograph', name: 'Harmonograph' },
  { id: 'mosaic', name: 'Mosaic' },
  { id: 'waves', name: 'Waves' },
  { id: 'constellation', name: 'Constellation' },
]

const TAU = Math.PI * 2

/* ── Seeded PRNG (mulberry32) ── */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedFromString(s: string): number {
  let h = 1779033703 ^ s.length
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return (h ^ (h >>> 16)) >>> 0
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t)
}

/* Cheap value-noise on a seeded lattice, returns 0..1 with bilinear+smooth interp */
function makeNoise(rng: () => number, grid = 10) {
  const n = grid + 1
  const vals = new Float32Array(n * n)
  for (let i = 0; i < vals.length; i++) vals[i] = rng()
  return (x: number, y: number) => {
    const gx = x * grid
    const gy = y * grid
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const sx = smoothstep(gx - x0)
    const sy = smoothstep(gy - y0)
    const ix0 = ((x0 % grid) + grid) % grid
    const iy0 = ((y0 % grid) + grid) % grid
    const ix1 = ix0 + 1
    const iy1 = iy0 + 1
    const v00 = vals[iy0 * n + ix0]
    const v10 = vals[iy0 * n + ix1]
    const v01 = vals[iy1 * n + ix0]
    const v11 = vals[iy1 * n + ix1]
    const top = v00 + (v10 - v00) * sx
    const bot = v01 + (v11 - v01) * sx
    return top + (bot - top) * sy
  }
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

interface RenderParams {
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  rng: () => number
  palette: Palette
  density: number // 0..1
}

/* ── Generators ── */

function renderFlow({ ctx, w, h, rng, palette, density }: RenderParams) {
  const noise = makeNoise(rng, 9)
  const count = Math.floor(400 + density * 2600)
  const steps = 90
  const scale = 0.0016
  ctx.lineCap = 'round'
  for (let i = 0; i < count; i++) {
    let x = rng() * w
    let y = rng() * h
    const color = pick(rng, palette.colors)
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.06 + rng() * 0.12
    ctx.lineWidth = 0.6 + rng() * 1.8
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let s = 0; s < steps; s++) {
      const a = noise(x * scale, y * scale) * TAU * 2.2
      x += Math.cos(a) * 6
      y += Math.sin(a) * 6
      if (x < 0 || x > w || y < 0 || y > h) break
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function renderHarmonograph({ ctx, w, h, rng, palette, density }: RenderParams) {
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) * 0.42
  const layers = Math.floor(2 + density * 4)
  for (let L = 0; L < layers; L++) {
    const f1 = 1 + Math.floor(rng() * 5)
    const f2 = 1 + Math.floor(rng() * 5)
    const f3 = 1 + Math.floor(rng() * 5)
    const f4 = 1 + Math.floor(rng() * 5)
    const p1 = rng() * TAU
    const p2 = rng() * TAU
    const d1 = 0.0008 + rng() * 0.0022
    const d2 = 0.0008 + rng() * 0.0022
    ctx.strokeStyle = pick(rng, palette.colors)
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 0.8
    ctx.beginPath()
    const total = 2200
    for (let t = 0; t < total; t++) {
      const e1 = Math.exp(-d1 * t)
      const e2 = Math.exp(-d2 * t)
      const x = cx + R * e1 * Math.sin(t * 0.02 * f1 + p1) + R * 0.35 * e2 * Math.sin(t * 0.02 * f3)
      const y = cy + R * e1 * Math.sin(t * 0.02 * f2 + p2) + R * 0.35 * e2 * Math.sin(t * 0.02 * f4)
      if (t === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function renderMosaic({ ctx, w, h, rng, palette, density }: RenderParams) {
  const cols = Math.floor(6 + density * 26)
  const cw = w / cols
  const rows = Math.ceil(h / cw)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw
      const y = r * cw
      const col = pick(rng, palette.colors)
      ctx.fillStyle = col
      ctx.globalAlpha = 0.85
      // split the cell into two triangles along a random diagonal
      ctx.beginPath()
      if (rng() > 0.5) {
        ctx.moveTo(x, y)
        ctx.lineTo(x + cw, y)
        ctx.lineTo(x, y + cw)
      } else {
        ctx.moveTo(x + cw, y)
        ctx.lineTo(x + cw, y + cw)
        ctx.lineTo(x, y + cw)
      }
      ctx.closePath()
      ctx.fill()
      if (rng() > 0.45) {
        ctx.fillStyle = pick(rng, palette.colors)
        ctx.globalAlpha = 0.7
        ctx.beginPath()
        if (rng() > 0.5) {
          ctx.moveTo(x + cw, y)
          ctx.lineTo(x + cw, y + cw)
          ctx.lineTo(x, y + cw)
        } else {
          ctx.moveTo(x, y)
          ctx.lineTo(x + cw, y)
          ctx.lineTo(x, y + cw)
        }
        ctx.closePath()
        ctx.fill()
      }
    }
  }
  ctx.globalAlpha = 1
}

function renderWaves({ ctx, w, h, rng, palette, density }: RenderParams) {
  const noise = makeNoise(rng, 8)
  const bands = Math.floor(10 + density * 36)
  const step = h / bands
  for (let b = bands; b >= 0; b--) {
    const baseY = b * step
    const col = palette.colors[b % palette.colors.length]
    ctx.fillStyle = col
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.moveTo(0, h)
    const amp = step * (1.5 + rng() * 3)
    const phase = rng() * TAU
    const freq = 0.5 + rng() * 1.8
    for (let x = 0; x <= w; x += 6) {
      const nx = x / w
      const y = baseY + Math.sin(nx * TAU * freq + phase) * amp + (noise(nx, b * 0.13) - 0.5) * amp
      ctx.lineTo(x, y)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function renderConstellation({ ctx, w, h, rng, palette, density }: RenderParams) {
  const count = Math.floor(40 + density * 260)
  const pts: { x: number; y: number; c: string }[] = []
  for (let i = 0; i < count; i++) {
    pts.push({ x: rng() * w, y: rng() * h, c: pick(rng, palette.colors) })
  }
  const maxDist = Math.min(w, h) * (0.16 - density * 0.06)
  ctx.lineWidth = 0.7
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x
      const dy = pts[i].y - pts[j].y
      const d = Math.hypot(dx, dy)
      if (d < maxDist) {
        ctx.globalAlpha = (1 - d / maxDist) * 0.5
        ctx.strokeStyle = pts[i].c
        ctx.beginPath()
        ctx.moveTo(pts[i].x, pts[i].y)
        ctx.lineTo(pts[j].x, pts[j].y)
        ctx.stroke()
      }
    }
  }
  for (const p of pts) {
    ctx.globalAlpha = 0.95
    ctx.fillStyle = p.c
    ctx.beginPath()
    ctx.arc(p.x, p.y, 1.4 + rng() * 2.4, 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

const GENERATORS: Record<StyleId, (p: RenderParams) => void> = {
  flow: renderFlow,
  harmonograph: renderHarmonograph,
  mosaic: renderMosaic,
  waves: renderWaves,
  constellation: renderConstellation,
}

function paint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  style: StyleId,
  palette: Palette,
  density: number,
  seed: string,
) {
  ctx.fillStyle = palette.bg
  ctx.fillRect(0, 0, w, h)
  const rng = mulberry32(seedFromString(`${seed}|${style}|${palette.id}|${density}`))
  GENERATORS[style]({ ctx, w, h, rng, palette, density })
}

interface State {
  style: StyleId
  paletteId: string
  density: number
  seed: string
}

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 9)
}

function encodeState(s: State): string {
  return `${s.style}.${s.paletteId}.${Math.round(s.density * 100)}.${s.seed}`
}

function decodeState(hash: string): Partial<State> | null {
  const parts = hash.replace(/^#/, '').split('.')
  if (parts.length < 4) return null
  const [style, paletteId, density, seed] = parts
  if (!STYLES.some(s => s.id === style)) return null
  if (!PALETTES.some(p => p.id === paletteId)) return null
  return { style: style as StyleId, paletteId, density: Number(density) / 100, seed }
}

class PatternForgeTool extends HTMLElement {
  private state: State = { style: 'flow', paletteId: 'ember', density: 0.5, seed: randomSeed() }
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private ro?: ResizeObserver

  connectedCallback() {
    const fromHash = decodeState(location.hash)
    if (fromHash) this.state = { ...this.state, ...fromHash }

    this.innerHTML = `
      <div data-type="tool-page" data-tool="pattern-forge">
        <div data-type="tool-header">
          <h1>Pattern Forge</h1>
          <p>Generate one-of-a-kind wallpapers from a seed. Tweak, reroll, and download — every image is reproducible and shareable.</p>
        </div>
        <div data-type="pf-stage">
          <canvas data-type="pf-canvas" aria-label="Generated artwork"></canvas>
        </div>
        <div data-type="pf-controls">
          <div data-group="styles" role="group" aria-label="Style">
            ${STYLES.map(s => `<button data-style="${s.id}" type="button">${s.name}</button>`).join('')}
          </div>
          <div data-group="palettes" role="group" aria-label="Palette">
            ${PALETTES.map(
              p => `<button data-palette="${p.id}" type="button" title="${p.name}">
                <span data-type="pf-swatch" style="--c1:${p.colors[0]};--c2:${p.colors[1]};--c3:${p.colors[2]}"></span>${p.name}
              </button>`,
            ).join('')}
          </div>
          <div data-group="density">
            <label for="pf-density">Density</label>
            <input id="pf-density" type="range" min="0" max="100" value="${Math.round(this.state.density * 100)}" />
          </div>
          <div data-group="seed">
            <label for="pf-seed">Seed</label>
            <input id="pf-seed" type="text" value="${this.state.seed}" spellcheck="false" autocomplete="off" />
            <button data-action="random" type="button" title="New random seed">Randomize</button>
          </div>
          <div data-group="actions">
            <button data-action="download" type="button">Download PNG</button>
            <button data-action="copy" type="button">Copy link</button>
          </div>
        </div>
      </div>
    `

    this.canvas = this.querySelector('[data-type="pf-canvas"]') as HTMLCanvasElement
    this.ctx = this.canvas.getContext('2d')!

    this.wire()
    this.syncUI()

    this.ro = new ResizeObserver(() => this.resizeAndRender())
    this.ro.observe(this.querySelector('[data-type="pf-stage"]') as Element)
    // first paint (ResizeObserver fires async, but render immediately too)
    requestAnimationFrame(() => this.resizeAndRender())

    window.addEventListener('hashchange', this.onHashChange)
  }

  disconnectedCallback() {
    this.ro?.disconnect()
    window.removeEventListener('hashchange', this.onHashChange)
  }

  private onHashChange = () => {
    const fromHash = decodeState(location.hash)
    if (fromHash && encodeState({ ...this.state, ...fromHash }) !== encodeState(this.state)) {
      this.state = { ...this.state, ...fromHash }
      this.syncUI()
      this.render()
    }
  }

  private get palette(): Palette {
    return PALETTES.find(p => p.id === this.state.paletteId) ?? PALETTES[0]
  }

  private wire() {
    this.querySelectorAll<HTMLButtonElement>('[data-style]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.state.style = btn.dataset.style as StyleId
        this.commit()
      })
    })
    this.querySelectorAll<HTMLButtonElement>('[data-palette]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.state.paletteId = btn.dataset.palette as string
        this.commit()
      })
    })
    const density = this.querySelector('#pf-density') as HTMLInputElement
    density.addEventListener('input', () => {
      this.state.density = Number(density.value) / 100
      this.render()
    })
    density.addEventListener('change', () => this.commit())

    const seed = this.querySelector('#pf-seed') as HTMLInputElement
    seed.addEventListener('change', () => {
      this.state.seed = seed.value.trim() || randomSeed()
      this.commit()
    })

    this.querySelector('[data-action="random"]')?.addEventListener('click', () => {
      this.state.seed = randomSeed()
      this.commit()
    })
    this.querySelector('[data-action="download"]')?.addEventListener('click', () => this.download())
    this.querySelector('[data-action="copy"]')?.addEventListener('click', e => this.copyLink(e))
  }

  private syncUI() {
    this.querySelectorAll<HTMLButtonElement>('[data-style]').forEach(b =>
      b.toggleAttribute('data-active', b.dataset.style === this.state.style),
    )
    this.querySelectorAll<HTMLButtonElement>('[data-palette]').forEach(b =>
      b.toggleAttribute('data-active', b.dataset.palette === this.state.paletteId),
    )
    const density = this.querySelector('#pf-density') as HTMLInputElement | null
    if (density) density.value = String(Math.round(this.state.density * 100))
    const seed = this.querySelector('#pf-seed') as HTMLInputElement | null
    if (seed) seed.value = this.state.seed
  }

  /** apply a discrete change: sync UI, render, and push to the URL hash */
  private commit() {
    this.syncUI()
    this.render()
    const encoded = encodeState(this.state)
    if (location.hash.replace(/^#/, '') !== encoded) {
      history.replaceState(null, '', `#${encoded}`)
    }
  }

  private resizeAndRender() {
    const stage = this.querySelector('[data-type="pf-stage"]') as HTMLElement
    const rect = stage.getBoundingClientRect()
    if (rect.width < 2) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cssW = rect.width
    const cssH = Math.round((cssW * 9) / 16)
    this.canvas.style.width = cssW + 'px'
    this.canvas.style.height = cssH + 'px'
    this.canvas.width = Math.round(cssW * dpr)
    this.canvas.height = Math.round(cssH * dpr)
    this.render()
  }

  private render() {
    const { width, height } = this.canvas
    paint(this.ctx, width, height, this.state.style, this.palette, this.state.density, this.state.seed)
  }

  private download() {
    const out = document.createElement('canvas')
    out.width = 1920
    out.height = 1080
    const octx = out.getContext('2d')!
    paint(octx, out.width, out.height, this.state.style, this.palette, this.state.density, this.state.seed)
    const link = document.createElement('a')
    link.download = `pattern-forge-${this.state.style}-${this.state.seed}.png`
    link.href = out.toDataURL('image/png')
    link.click()
  }

  private async copyLink(e: Event) {
    const btn = e.currentTarget as HTMLButtonElement
    const url = `${location.origin}${location.pathname}#${encodeState(this.state)}`
    const label = btn.textContent
    try {
      await navigator.clipboard.writeText(url)
      btn.textContent = 'Copied!'
    } catch {
      btn.textContent = 'Copy failed'
    }
    setTimeout(() => {
      btn.textContent = label
    }, 1400)
  }
}

if (!customElements.get('pattern-forge-tool')) {
  customElements.define('pattern-forge-tool', PatternForgeTool)
}
