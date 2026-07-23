/**
 * Fractal Garden — an interactive L-system (Lindenmayer system) generator that
 * grows fractal plants, trees and geometric curves on a 2D canvas, zero deps.
 *
 * An L-system is a tiny rewriting grammar. You start from an AXIOM (a short seed
 * string) and repeatedly replace every symbol using a set of PRODUCTION RULES; a
 * handful of rewrites turns "F" into thousands of characters. That final string is
 * then read as TURTLE GRAPHICS: `F`/`G` draw a step forward, `+`/`-` turn by the
 * branch Angle, and `[` / `]` push / pop the turtle's position and heading so a
 * branch can split off and the trunk can resume where it left off. Out of those
 * few local rules a whole plant falls into place with nobody drawing it by hand —
 * the same "simple rules, emergent structure" idea as the sibling Murmuration and
 * Flow Field toys, but frozen into botany.
 *
 * Seven presets (Fractal Plant, Bushy Weed, Seaweed, Twiggy Tree, Koch curve,
 * Dragon curve, Sierpinski) each ship their own axiom + rules + natural angle.
 * Iterations, Angle, organic Wobble and trunk Thickness are live controls; a
 * seeded Wobble (mulberry32 RNG off a text seed) jitters each turn and step so a
 * plant looks hand-grown yet reproduces exactly from the same seed. Branchy
 * presets are coloured by branch depth (trunk → tip gradient) with optional leaf
 * blossoms at the tips; the geometric curves are coloured along their draw order.
 * The whole picture is auto-fit to the frame, animates as it "grows", exports as a
 * PNG, and remembers every setting in localStorage.
 *
 * Respects prefers-reduced-motion (paints the finished plant in one frame, no
 * growth animation). The RAF loop is torn down in disconnectedCallback so it never
 * leaks across View Transitions.
 *
 * Every module-level name is prefixed `fg`/`FG_` on purpose: the game component
 * files share a global TS script scope, so unprefixed names (clamp, PALETTES, …)
 * would collide with the other games at `astro check` time.
 */

interface FgPalette {
  id: string
  name: string
  colors: string[]   // trunk → tip gradient stops
  leaf?: string      // blossom colour at tips; falls back to the last gradient stop
}

/* Botanical + art palettes. "theme" is resolved from the CSS tokens at mount so a
   re-theme needs no JS change; the rest are hand-picked for plants and curves. */
const FG_PALETTES: FgPalette[] = [
  { id: 'theme', name: 'Theme', colors: [] },
  { id: 'forest', name: 'Forest', colors: ['#6b4423', '#7a5a2e', '#3e7d3a', '#5fae4b', '#9ad24a'], leaf: '#c6f06a' },
  { id: 'autumn', name: 'Autumn', colors: ['#5b3a29', '#8a4b2a', '#c9772e', '#e0a534', '#f4d84b'], leaf: '#ffe27a' },
  { id: 'cherry', name: 'Cherry', colors: ['#4a2e2a', '#6d3b46', '#b45571', '#ef8fb2', '#ffd6e6'], leaf: '#ffe0ee' },
  { id: 'ice', name: 'Ice', colors: ['#37506b', '#3f74ab', '#5aa0d8', '#9ad2f2', '#e6f6ff'], leaf: '#eafaff' },
  { id: 'mono', name: 'Mono', colors: ['#4a4a4a', '#777777', '#a2a2a2', '#c9c9c9', '#efefef'], leaf: '#f4f4f4' },
]

interface FgPreset {
  id: string
  name: string
  axiom: string
  rules: Record<string, string>
  angle: number   // degrees
  iters: number   // default iterations
  max: number     // safe iteration ceiling
}

/* Classic L-systems. The four plants branch (coloured by depth, with leaves); the
   three geometric curves don't branch (coloured along their length). */
const FG_PRESETS: FgPreset[] = [
  { id: 'plant', name: 'Fractal Plant', axiom: 'X', rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' }, angle: 25, iters: 5, max: 6 },
  { id: 'bush', name: 'Bushy Weed', axiom: 'F', rules: { F: 'FF-[-F+F+F]+[+F-F-F]' }, angle: 22.5, iters: 4, max: 5 },
  { id: 'seaweed', name: 'Seaweed', axiom: 'F', rules: { F: 'F[+F]F[-F][F]' }, angle: 22, iters: 4, max: 6 },
  { id: 'twig', name: 'Twiggy Tree', axiom: 'F', rules: { F: 'F[+F]F[-F]F' }, angle: 25.7, iters: 5, max: 6 },
  { id: 'koch', name: 'Koch Curve', axiom: 'F', rules: { F: 'F+F-F-F+F' }, angle: 90, iters: 3, max: 4 },
  { id: 'dragon', name: 'Dragon Curve', axiom: 'FX', rules: { X: 'X+YF+', Y: '-FX-Y' }, angle: 90, iters: 11, max: 14 },
  { id: 'sierpinski', name: 'Sierpinski', axiom: 'F', rules: { F: 'G-F-G', G: 'F+G+F' }, angle: 60, iters: 5, max: 7 },
]

const FG_LS_PRESET = 'fg:preset'
const FG_LS_ITERS = 'fg:iters'
const FG_LS_ANGLE = 'fg:angle'
const FG_LS_WOBBLE = 'fg:wobble'
const FG_LS_THICK = 'fg:thick'
const FG_LS_LEAVES = 'fg:leaves'
const FG_LS_PALETTE = 'fg:palette'
const FG_LS_SEED = 'fg:seed'

const FG_ANGLE_MIN = 1, FG_ANGLE_MAX = 120
const FG_WOBBLE_MIN = 0, FG_WOBBLE_MAX = 100
const FG_THICK_MIN = 1, FG_THICK_MAX = 8
const FG_MAX_STRLEN = 200000   // guard against exponential blow-up during rewriting
const FG_TAU = Math.PI * 2

function fgClamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

/* xmur3 string hash → 32-bit seed, feeding a mulberry32 PRNG. Deterministic, so a
   given seed reproduces the same wobble every time. */
function fgHash(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^= h >>> 16) >>> 0
}

function fgMulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* Parse #rgb / #rrggbb (or an rgb() string) to a [r,g,b] triple. */
function fgToRGB(input: string): [number, number, number] {
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
    const parts = m[1].split(',').map(x => parseFloat(x))
    if (parts.length >= 3) return [parts[0], parts[1], parts[2]]
  }
  return [255, 255, 255]
}

/* Sample a gradient of rgb stops at t∈[0,1] → "rgb(r,g,b)". */
function fgSample(stops: [number, number, number][], t: number): string {
  if (stops.length === 0) return 'rgb(255,255,255)'
  if (stops.length === 1) return `rgb(${stops[0][0]},${stops[0][1]},${stops[0][2]})`
  const pos = fgClamp(t, 0, 1) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(pos))
  const f = pos - i
  const a = stops[i], b = stops[i + 1]
  const r = Math.round(a[0] + (b[0] - a[0]) * f)
  const g = Math.round(a[1] + (b[1] - a[1]) * f)
  const bl = Math.round(a[2] + (b[2] - a[2]) * f)
  return `rgb(${r},${g},${bl})`
}

/* Apply an L-system's rules `iters` times, guarded against string explosion. */
function fgExpand(preset: FgPreset, iters: number): string {
  let s = preset.axiom
  for (let k = 0; k < iters; k++) {
    let out = ''
    for (const ch of s) out += preset.rules[ch] ?? ch
    s = out
    if (s.length > FG_MAX_STRLEN) break
  }
  return s
}

interface FgSeg {
  rx1: number; ry1: number; rx2: number; ry2: number  // raw model coords
  sx1: number; sy1: number; sx2: number; sy2: number  // fitted screen (device px) coords
  depth: number
  leaf: boolean
  color: string
  w: number
}

class LSystemGame extends HTMLElement {
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private ro?: ResizeObserver
  private raf = 0
  private growing = false

  private w = 0
  private h = 0

  private segs: FgSeg[] = []
  private maxDepth = 0
  private shown = 0
  private chunk = 12

  // tunables
  private preset: FgPreset = FG_PRESETS[0]
  private iters = 5
  private angle = 25
  private wobble = 0
  private thick = 3
  private leaves = true
  private palette: FgPalette = FG_PALETTES[1]
  private seed = 'garden'

  private bgRGB: [number, number, number] = [5, 7, 12]
  private palRGB: [number, number, number][] = []
  private leafColor = '#c6f06a'

  connectedCallback() {
    const savedPreset = this.readLS(FG_LS_PRESET)
    this.preset = FG_PRESETS.find(p => p.id === savedPreset) || FG_PRESETS[0]

    const savedIters = this.readLS(FG_LS_ITERS)
    const savedAngle = this.readLS(FG_LS_ANGLE)
    const savedWobble = this.readLS(FG_LS_WOBBLE)
    const savedThick = this.readLS(FG_LS_THICK)
    const savedLeaves = this.readLS(FG_LS_LEAVES)
    const savedPalette = this.readLS(FG_LS_PALETTE)
    const savedSeed = this.readLS(FG_LS_SEED)

    this.iters = fgClamp(savedIters === null ? this.preset.iters : Number(savedIters), 1, this.preset.max)
    this.angle = fgClamp(savedAngle === null ? this.preset.angle : Number(savedAngle), FG_ANGLE_MIN, FG_ANGLE_MAX)
    this.wobble = fgClamp(savedWobble === null ? 0 : Number(savedWobble), FG_WOBBLE_MIN, FG_WOBBLE_MAX)
    this.thick = fgClamp(savedThick === null ? 3 : Number(savedThick), FG_THICK_MIN, FG_THICK_MAX)
    this.leaves = savedLeaves === null ? true : savedLeaves === '1'
    this.palette = FG_PALETTES.find(p => p.id === savedPalette) || FG_PALETTES[1]
    if (this.palette.id === 'theme' && this.palette.colors.length === 0) { /* resolved in readTheme */ }
    this.seed = savedSeed && savedSeed.length ? savedSeed : 'garden'

    this.innerHTML = `
      <div data-type="fg-game">
        <div data-type="fg-header">
          <div data-type="fg-titlebar">
            <h1>Fractal Garden</h1>
            <span data-type="fg-badge">L-system</span>
          </div>
          <p>Plants that draw themselves. Each is an L-system: start from a short seed string, rewrite it a few times with simple rules, then read the result as turtle graphics — step, turn, branch. Pick a species, bend the branch angle, add a little organic wobble, and watch a tree grow from the maths. Grab a frame you like as a PNG.</p>
        </div>
        <div data-type="fg-stage">
          <canvas data-type="fg-canvas" tabindex="0" role="img"
            aria-label="A fractal plant generated by an L-system, growing branch by branch on a canvas."></canvas>
        </div>
        <div data-type="fg-controls">
          <div data-group="transport" role="group" aria-label="Actions">
            <button data-action="grow" type="button" title="Regrow / pause the animation (space)">Replay</button>
            <button data-action="reseed" type="button" title="New random wobble seed (R)">Reroll</button>
            <button data-action="leaves" type="button" aria-pressed="${this.leaves}" title="Toggle leaf blossoms at the tips (L)">Leaves: ${this.leaves ? 'on' : 'off'}</button>
            <button data-action="download" type="button" title="Save the current frame as a PNG (D)">Download PNG</button>
          </div>
          <div data-group="species" role="group" aria-label="Species">
            <span data-type="fg-group-label">Species</span>
            ${FG_PRESETS.map(p => `
              <button data-preset="${p.id}" type="button" aria-pressed="${p.id === this.preset.id}" title="${p.name}">${p.name}</button>`).join('')}
          </div>
          <div data-type="fg-sliders">
            <div data-type="fg-slider">
              <label for="fg-iters">Iterations</label>
              <input id="fg-iters" type="range" min="1" max="${this.preset.max}" step="1" value="${this.iters}" />
              <output id="fg-iters-out">${this.iters}</output>
            </div>
            <div data-type="fg-slider">
              <label for="fg-angle">Angle</label>
              <input id="fg-angle" type="range" min="${FG_ANGLE_MIN}" max="${FG_ANGLE_MAX}" step="0.5" value="${this.angle}" />
              <output id="fg-angle-out">${this.angle}°</output>
            </div>
            <div data-type="fg-slider">
              <label for="fg-wobble">Wobble</label>
              <input id="fg-wobble" type="range" min="${FG_WOBBLE_MIN}" max="${FG_WOBBLE_MAX}" step="1" value="${this.wobble}" />
              <output id="fg-wobble-out">${this.wobble}%</output>
            </div>
            <div data-type="fg-slider">
              <label for="fg-thick">Thickness</label>
              <input id="fg-thick" type="range" min="${FG_THICK_MIN}" max="${FG_THICK_MAX}" step="0.5" value="${this.thick}" />
              <output id="fg-thick-out">${this.thick.toFixed(1)}</output>
            </div>
          </div>
          <div data-group="seed" role="group" aria-label="Wobble seed">
            <span data-type="fg-group-label">Seed</span>
            <input id="fg-seed" type="text" value="${this.escapeAttr(this.seed)}" spellcheck="false" autocomplete="off"
              aria-label="Wobble seed — same seed reproduces the same plant" />
          </div>
          <div data-group="palette" role="group" aria-label="Colour palette">
            <span data-type="fg-group-label">Palette</span>
            ${FG_PALETTES.map(p => `
              <button data-palette="${p.id}" type="button" aria-pressed="${p.id === this.palette.id}" title="${p.name} palette">
                <span data-type="fg-swatch" aria-hidden="true">${(p.colors.length ? p.colors : ['var(--color-muted)', 'var(--color-accent)', 'var(--color-text)']).slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span>${p.name}
              </button>`).join('')}
          </div>
        </div>
        <details data-type="fg-explainer">
          <summary>How an L-system grows</summary>
          <p>Every plant here starts as one or two letters — the <strong>axiom</strong> — and is grown by rewriting: each pass replaces every symbol with a short string of new symbols from the species' <strong>rules</strong>. A handful of <strong>Iterations</strong> turns a single "F" into thousands of instructions.</p>
          <p>That long string is then walked like a pen (a "turtle"): <strong>F</strong> draws a step forward, <strong>+</strong> and <strong>−</strong> turn by the <strong>Angle</strong>, and <strong>[</strong> … <strong>]</strong> remember and restore where the pen was — that's how a branch splits off and the trunk carries on. Nobody positions a single leaf; the shape is entirely a consequence of the rules.</p>
          <p data-type="fg-try"><strong>Try this:</strong> pick <em>Fractal Plant</em>, push <em>Wobble</em> to about 30% so it looks hand-grown, then type any word into <em>Seed</em> — the same word always regrows the exact same plant, so it's a shareable fingerprint. Slide the <em>Angle</em> and watch the whole species bend.</p>
        </details>
        <p data-type="fg-hint">Shortcuts: space = replay · R = reroll seed · L = leaves · D = download. The four plants branch and grow leaves; Koch, Dragon and Sierpinski are geometric curves coloured along their length.</p>
      </div>
    `

    this.canvas = this.querySelector('[data-type="fg-canvas"]') as HTMLCanvasElement
    this.ctx = this.canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
    this.readTheme()
    this.wire()

    this.ro = new ResizeObserver(() => this.onResize())
    this.ro.observe(this.querySelector('[data-type="fg-stage"]') as Element)

    this.raf = requestAnimationFrame(() => {
      if (!this.isConnected) return
      this.resizeCanvas()
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      this.build(!reduced)
    })
  }

  disconnectedCallback() {
    this.growing = false
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.ro?.disconnect()
  }

  /* ── theme + palette ── */

  private readTheme() {
    const cs = getComputedStyle(document.documentElement)
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
    this.bgRGB = fgToRGB(v('--color-bg', '#05070c'))
    const theme = FG_PALETTES[0]
    theme.colors = [
      v('--color-muted', '#73808f'),
      v('--color-accent', '#9b8cff'),
      v('--color-text', '#dde6f2'),
    ]
    theme.leaf = v('--color-accent', '#9b8cff')
    this.refreshPalRGB()
  }

  private refreshPalRGB() {
    const cols = this.palette.colors.length ? this.palette.colors : FG_PALETTES[0].colors
    this.palRGB = cols.map(fgToRGB)
    this.leafColor = this.palette.leaf || cols[cols.length - 1] || '#ffffff'
  }

  /* ── geometry ── */

  private dpr() {
    return Math.min(window.devicePixelRatio || 1, 2)
  }

  private resizeCanvas(): boolean {
    const stage = this.querySelector('[data-type="fg-stage"]') as HTMLElement
    const cssW = stage.getBoundingClientRect().width
    if (cssW < 2) return false
    const cssH = Math.round(cssW * 0.62)
    const dpr = this.dpr()
    this.canvas.style.width = cssW + 'px'
    this.canvas.style.height = cssH + 'px'
    const newW = Math.round(cssW * dpr)
    const newH = Math.round(cssH * dpr)
    if (newW === this.w && newH === this.h) return false
    this.w = this.canvas.width = newW
    this.h = this.canvas.height = newH
    return true
  }

  private onResize() {
    if (!this.resizeCanvas()) return
    // re-fit the existing plant to the new frame and repaint (no regrow)
    if (this.segs.length) {
      this.layout()
      this.colorize()
      this.renderStatic()
    } else {
      this.paintBackground()
    }
  }

  /* ── build the plant ── */

  /** Rewrite + interpret the L-system into raw line segments. */
  private interpret() {
    const str = fgExpand(this.preset, this.iters)
    const rng = fgMulberry32(fgHash(this.seed + '|' + this.preset.id))
    const angRad = (this.angle * Math.PI) / 180
    const wob = this.wobble / 100
    const angJit = wob * 0.6          // up to ~0.6 rad of turn jitter
    const lenJit = wob * 0.5          // up to ±50% step-length jitter
    const baseLen = 10

    const segs: FgSeg[] = []
    let x = 0, y = 0, hdg = -Math.PI / 2    // start pointing up (screen y grows downward)
    let depth = 0
    let maxDepth = 0
    let lastSeg = -1
    const stack: { x: number; y: number; hdg: number; depth: number }[] = []
    const tipStack: number[] = []

    for (let i = 0; i < str.length; i++) {
      const ch = str[i]
      if (ch === 'F' || ch === 'G') {
        const len = baseLen * (1 + (wob ? (rng() * 2 - 1) * lenJit : 0))
        const nx = x + Math.cos(hdg) * len
        const ny = y + Math.sin(hdg) * len
        segs.push({ rx1: x, ry1: y, rx2: nx, ry2: ny, sx1: 0, sy1: 0, sx2: 0, sy2: 0, depth, leaf: false, color: '#fff', w: 1 })
        lastSeg = segs.length - 1
        x = nx; y = ny
      } else if (ch === 'f') {
        const len = baseLen
        x += Math.cos(hdg) * len
        y += Math.sin(hdg) * len
      } else if (ch === '+') {
        hdg -= angRad + (wob ? (rng() * 2 - 1) * angJit : 0)
      } else if (ch === '-') {
        hdg += angRad + (wob ? (rng() * 2 - 1) * angJit : 0)
      } else if (ch === '[') {
        stack.push({ x, y, hdg, depth })
        tipStack.push(lastSeg)
        depth++
        if (depth > maxDepth) maxDepth = depth
      } else if (ch === ']') {
        const s = stack.pop()
        if (s) { x = s.x; y = s.y; hdg = s.hdg; depth = s.depth }
        const mk = tipStack.pop() ?? -1
        // a segment was drawn inside this branch → its last one is a tip
        if (lastSeg > mk && lastSeg >= 0) segs[lastSeg].leaf = true
      }
    }
    if (lastSeg >= 0) segs[lastSeg].leaf = true   // final tip of the whole plant

    this.segs = segs
    this.maxDepth = maxDepth
  }

  /** Fit the raw segments into the canvas (device px) with padding, centred. */
  private layout() {
    const segs = this.segs
    if (!segs.length) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const s of segs) {
      if (s.rx1 < minX) minX = s.rx1; if (s.rx2 < minX) minX = s.rx2
      if (s.ry1 < minY) minY = s.ry1; if (s.ry2 < minY) minY = s.ry2
      if (s.rx1 > maxX) maxX = s.rx1; if (s.rx2 > maxX) maxX = s.rx2
      if (s.ry1 > maxY) maxY = s.ry1; if (s.ry2 > maxY) maxY = s.ry2
    }
    const bw = Math.max(maxX - minX, 1e-6)
    const bh = Math.max(maxY - minY, 1e-6)
    const pad = 0.08
    const availW = this.w * (1 - 2 * pad)
    const availH = this.h * (1 - 2 * pad)
    const scale = Math.min(availW / bw, availH / bh)
    const drawW = bw * scale
    const drawH = bh * scale
    const offX = (this.w - drawW) / 2 - minX * scale
    const offY = (this.h - drawH) / 2 - minY * scale
    for (const s of segs) {
      s.sx1 = s.rx1 * scale + offX
      s.sy1 = s.ry1 * scale + offY
      s.sx2 = s.rx2 * scale + offX
      s.sy2 = s.ry2 * scale + offY
    }
  }

  /** Assign each segment its colour + stroke width (palette / depth dependent). */
  private colorize() {
    const dpr = this.dpr()
    const branchy = this.maxDepth > 0
    const n = this.segs.length
    for (let i = 0; i < n; i++) {
      const s = this.segs[i]
      // branchy plants: gradient by branch depth (trunk → tip);
      // geometric curves: gradient along the draw order.
      const t = branchy ? s.depth / this.maxDepth : (n > 1 ? i / (n - 1) : 0)
      s.color = fgSample(this.palRGB, t)
      s.w = branchy
        ? Math.max(0.6 * dpr, this.thick * dpr * Math.pow(0.74, s.depth))
        : Math.max(0.8 * dpr, this.thick * dpr * 0.55)
    }
  }

  private build(animate: boolean) {
    this.interpret()
    this.layout()
    this.colorize()
    this.render(animate)
  }

  /* ── drawing ── */

  private paintBackground() {
    const [r, g, b] = this.bgRGB
    this.ctx.fillStyle = `rgb(${r},${g},${b})`
    this.ctx.fillRect(0, 0, this.w, this.h)
  }

  private leafRadius() {
    return Math.max(1.4, this.thick * 0.7) * this.dpr()
  }

  private drawRange(from: number, to: number) {
    const { ctx } = this
    const branchy = this.maxDepth > 0
    const lr = this.leafRadius()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let i = from; i < to; i++) {
      const s = this.segs[i]
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.w
      ctx.beginPath()
      ctx.moveTo(s.sx1, s.sy1)
      ctx.lineTo(s.sx2, s.sy2)
      ctx.stroke()
      if (this.leaves && branchy && s.leaf) {
        ctx.fillStyle = this.leafColor
        ctx.beginPath()
        ctx.arc(s.sx2, s.sy2, lr, 0, FG_TAU)
        ctx.fill()
      }
    }
  }

  private renderStatic() {
    this.stopGrow()
    this.paintBackground()
    this.drawRange(0, this.segs.length)
    this.shown = this.segs.length
    this.updateGrowBtn()
  }

  private render(animate: boolean) {
    this.stopGrow()
    this.paintBackground()
    if (!animate || this.segs.length === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.drawRange(0, this.segs.length)
      this.shown = this.segs.length
      this.updateGrowBtn()
      return
    }
    this.shown = 0
    this.chunk = Math.max(6, Math.ceil(this.segs.length / 110))
    this.growing = true
    this.updateGrowBtn()
    this.raf = requestAnimationFrame(this.growLoop)
  }

  private growLoop = () => {
    if (!this.growing) return
    const next = Math.min(this.segs.length, this.shown + this.chunk)
    this.drawRange(this.shown, next)
    this.shown = next
    if (this.shown >= this.segs.length) {
      this.growing = false
      this.raf = 0
      this.updateGrowBtn()
      return
    }
    this.raf = requestAnimationFrame(this.growLoop)
  }

  private stopGrow() {
    this.growing = false
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private toggleGrow() {
    if (this.growing) {
      this.stopGrow()
      this.updateGrowBtn()
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.renderStatic()
      return
    }
    // finished (or never started) → replay from the root; mid-way → resume
    if (this.shown >= this.segs.length) {
      this.render(true)
    } else {
      this.growing = true
      this.updateGrowBtn()
      this.raf = requestAnimationFrame(this.growLoop)
    }
  }

  private updateGrowBtn() {
    const btn = this.querySelector('[data-action="grow"]') as HTMLButtonElement | null
    if (btn) btn.textContent = this.growing ? 'Pause' : (this.shown < this.segs.length ? 'Resume' : 'Replay')
  }

  /* ── interaction ── */

  private wire() {
    this.querySelector('[data-action="grow"]')?.addEventListener('click', () => this.toggleGrow())
    this.querySelector('[data-action="reseed"]')?.addEventListener('click', () => this.reseed())
    this.querySelector('[data-action="leaves"]')?.addEventListener('click', () => this.toggleLeaves())
    this.querySelector('[data-action="download"]')?.addEventListener('click', () => this.download())

    this.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => this.selectPreset(btn.dataset.preset as string))
    })

    this.bindSlider('#fg-iters', '#fg-iters-out', FG_LS_ITERS, raw => {
      this.iters = fgClamp(Math.round(raw), 1, this.preset.max)
      return String(this.iters)
    })
    this.bindSlider('#fg-angle', '#fg-angle-out', FG_LS_ANGLE, raw => {
      this.angle = fgClamp(raw, FG_ANGLE_MIN, FG_ANGLE_MAX)
      return `${this.angle}°`
    })
    this.bindSlider('#fg-wobble', '#fg-wobble-out', FG_LS_WOBBLE, raw => {
      this.wobble = fgClamp(Math.round(raw), FG_WOBBLE_MIN, FG_WOBBLE_MAX)
      return `${this.wobble}%`
    })
    this.bindSlider('#fg-thick', '#fg-thick-out', FG_LS_THICK, raw => {
      this.thick = fgClamp(raw, FG_THICK_MIN, FG_THICK_MAX)
      return this.thick.toFixed(1)
    }, /* rebuildOnly */ true)

    const seedInput = this.querySelector('#fg-seed') as HTMLInputElement | null
    seedInput?.addEventListener('input', () => {
      this.seed = seedInput.value.trim() || 'garden'
      this.writeLS(FG_LS_SEED, this.seed)
      this.build(false)   // instant redraw while typing; space to replay the grow
    })
    seedInput?.addEventListener('keydown', e => { e.stopPropagation() })   // let space/R type normally

    this.querySelectorAll<HTMLButtonElement>('[data-palette]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.palette as string
        this.palette = FG_PALETTES.find(p => p.id === id) || this.palette
        this.writeLS(FG_LS_PALETTE, id)
        this.refreshPalRGB()
        this.querySelectorAll('[data-palette]').forEach(b =>
          b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.palette === id)))
        this.colorize()
        this.renderStatic()
      })
    })

    this.canvas.addEventListener('keydown', e => this.onKey(e))
  }

  /**
   * @param light when true, only re-fit + repaint (colour/width change) instead of
   *   re-running the L-system rewrite — used for the Thickness slider.
   */
  private bindSlider(inputSel: string, outSel: string, lsKey: string, apply: (raw: number) => string, light = false) {
    const input = this.querySelector(inputSel) as HTMLInputElement
    const out = this.querySelector(outSel) as HTMLOutputElement | null
    input.addEventListener('input', () => {
      const raw = Number(input.value)
      const label = apply(raw)
      if (out) out.textContent = label
      this.writeLS(lsKey, String(raw))
      if (light) { this.colorize(); this.renderStatic() }
      else { this.build(false) }   // instant redraw while dragging
    })
  }

  private selectPreset(id: string) {
    const p = FG_PRESETS.find(pr => pr.id === id)
    if (!p) return
    this.preset = p
    this.iters = fgClamp(p.iters, 1, p.max)
    this.angle = p.angle
    this.writeLS(FG_LS_PRESET, p.id)
    this.writeLS(FG_LS_ITERS, String(this.iters))
    this.writeLS(FG_LS_ANGLE, String(this.angle))
    // reflect the preset's defaults + ceiling into the sliders
    const iterInput = this.querySelector('#fg-iters') as HTMLInputElement | null
    if (iterInput) { iterInput.max = String(p.max); iterInput.value = String(this.iters) }
    const iterOut = this.querySelector('#fg-iters-out') as HTMLOutputElement | null
    if (iterOut) iterOut.textContent = String(this.iters)
    const angInput = this.querySelector('#fg-angle') as HTMLInputElement | null
    if (angInput) angInput.value = String(this.angle)
    const angOut = this.querySelector('#fg-angle-out') as HTMLOutputElement | null
    if (angOut) angOut.textContent = `${this.angle}°`
    this.querySelectorAll('[data-preset]').forEach(b =>
      b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.preset === id)))
    this.build(true)
  }

  private reseed() {
    this.seed = Math.random().toString(36).slice(2, 8)
    const input = this.querySelector('#fg-seed') as HTMLInputElement | null
    if (input) input.value = this.seed
    this.writeLS(FG_LS_SEED, this.seed)
    this.build(true)
  }

  private toggleLeaves() {
    this.leaves = !this.leaves
    this.writeLS(FG_LS_LEAVES, this.leaves ? '1' : '0')
    const btn = this.querySelector('[data-action="leaves"]') as HTMLButtonElement | null
    if (btn) {
      btn.textContent = `Leaves: ${this.leaves ? 'on' : 'off'}`
      btn.setAttribute('aria-pressed', String(this.leaves))
    }
    this.renderStatic()
  }

  private onKey(e: KeyboardEvent) {
    switch (e.key) {
      case ' ': e.preventDefault(); this.toggleGrow(); break
      case 'r': case 'R': e.preventDefault(); this.reseed(); break
      case 'l': case 'L': e.preventDefault(); this.toggleLeaves(); break
      case 'd': case 'D': e.preventDefault(); this.download(); break
    }
  }

  private escapeAttr(s: string) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  private readLS(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  }

  private writeLS(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* ignore quota / private-mode */ }
  }

  private download() {
    try {
      const url = this.canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = `fractal-garden-${this.preset.id}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      /* toDataURL can throw on a tainted canvas — never happens here (no external images) */
    }
  }
}

if (!customElements.get('lsystem-tree-game')) {
  customElements.define('lsystem-tree-game', LSystemGame)
}

export {}
