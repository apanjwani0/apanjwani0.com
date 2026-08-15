/**
 * Sand Loom — an interactive falling-sand cellular automaton on a 2D canvas,
 * zero dependencies.
 *
 * The world is a coarse grid of cells; each cell holds one material. Every frame
 * every non-empty cell is nudged by a handful of local rules and the whole thing
 * comes alive: sand piles into slopes, water finds its level and pours off ledges,
 * fire climbs flammable wood and oil, lava sets things alight and freezes to stone
 * when it meets water (hissing off steam), acid eats through solids, plants creep
 * along water, and smoke and steam drift upward and fade. There is no goal — you
 * paint materials with the pointer and watch physics happen.
 *
 * Movement is decided by a simple DENSITY model: a movable cell sinks into any
 * lighter movable cell (or empty space) below it, so sand sinks through water,
 * water sinks through oil (oil floats), and lava is heaviest of all. Powders slide
 * diagonally to build slopes; liquids also disperse sideways to seek their level;
 * gases (smoke, steam) and fire rise. Interactions — ignition, dissolving,
 * lava/water quenching, plant growth, salt dissolving — are handled as the cells
 * are scanned. The grid is drawn crisp (nearest-neighbour) and upscaled onto the
 * display canvas; the empty background is resolved from the site's --color-bg
 * token at mount, so nothing about the look is hardcoded in CSS.
 *
 * Respects prefers-reduced-motion (settles a still frame, then stays paused).
 * Selected material, brush size, speed and scale persist in localStorage. The RAF
 * loop is torn down in disconnectedCallback so it never leaks across View
 * Transitions.
 *
 * Every module-level name is prefixed `sl`/`SL_` on purpose: the game component
 * files share a global TS script scope, so unprefixed names (clamp, hash, LS_*…)
 * would collide with the sibling toys at `astro check` time.
 */

/* ── material ids ── */
const SL_EMPTY = 0
const SL_SAND = 1
const SL_WATER = 2
const SL_STONE = 3
const SL_WOOD = 4
const SL_PLANT = 5
const SL_OIL = 6
const SL_FIRE = 7
const SL_LAVA = 8
const SL_ACID = 9
const SL_SALT = 10
const SL_STEAM = 11
const SL_SMOKE = 12

/* ── behaviour types ── */
const SL_T_SOLID = 0    // immovable (stone, wood, plant)
const SL_T_POWDER = 1   // falls + slides diagonally (sand, salt)
const SL_T_LIQUID = 2   // falls + disperses sideways (water, oil, acid, lava)
const SL_T_GAS = 3      // rises + spreads (steam, smoke)
const SL_T_FIRE = 4     // rises, short-lived, ignites

// index by material id
const SL_TYPE = [0, SL_T_POWDER, SL_T_LIQUID, SL_T_SOLID, SL_T_SOLID, SL_T_SOLID, SL_T_LIQUID, SL_T_FIRE, SL_T_LIQUID, SL_T_LIQUID, SL_T_POWDER, SL_T_GAS, SL_T_GAS]
// relative density — a movable cell sinks into any lighter movable cell below it
const SL_DENSITY = [0, 70, 50, 0, 0, 0, 30, 20, 90, 52, 60, 10, 8]

interface SlMaterial {
  id: number
  name: string
  key: string          // keyboard hotkey (shown in the button title); '' = none
  hex: string          // swatch colour for the palette button
  base: [number, number, number]  // render colour (fire/lava computed live)
  tex: number          // per-cell brightness jitter amplitude (texture)
}

// Paintable materials, in palette order. Fire/lava render colours are computed
// per-frame; their `base` is only a fallback. Colour DATA lives here (not in CSS).
const SL_MATERIALS: SlMaterial[] = [
  { id: SL_SAND, name: 'Sand', key: '1', hex: '#d9b672', base: [217, 182, 114], tex: 11 },
  { id: SL_WATER, name: 'Water', key: '2', hex: '#3b7bd6', base: [59, 123, 214], tex: 5 },
  { id: SL_STONE, name: 'Stone', key: '3', hex: '#7a7f88', base: [122, 127, 136], tex: 10 },
  { id: SL_WOOD, name: 'Wood', key: '4', hex: '#7a4a24', base: [122, 74, 36], tex: 9 },
  { id: SL_PLANT, name: 'Plant', key: '5', hex: '#3fa34d', base: [63, 163, 77], tex: 8 },
  { id: SL_FIRE, name: 'Fire', key: '6', hex: '#ff7a2f', base: [255, 122, 47], tex: 0 },
  { id: SL_OIL, name: 'Oil', key: '7', hex: '#6b5a2e', base: [92, 78, 42], tex: 6 },
  { id: SL_LAVA, name: 'Lava', key: '8', hex: '#ff6b35', base: [255, 107, 53], tex: 0 },
  { id: SL_ACID, name: 'Acid', key: '9', hex: '#b6e63f', base: [182, 230, 63], tex: 6 },
  { id: SL_SALT, name: 'Salt', key: '0', hex: '#eef1f4', base: [238, 241, 244], tex: 7 },
  { id: SL_STEAM, name: 'Steam', key: '', hex: '#b9c4cf', base: [185, 196, 207], tex: 4 },
  { id: SL_SMOKE, name: 'Smoke', key: '', hex: '#545454', base: [84, 84, 84], tex: 6 },
]

// Render colour lookup, indexed by material id (fire/lava overridden in draw()).
const SL_BASE: [number, number, number][] = (() => {
  const arr: [number, number, number][] = new Array(13).fill(0).map(() => [0, 0, 0]) as any
  for (const m of SL_MATERIALS) arr[m.id] = m.base
  return arr
})()
const SL_TEX = (() => {
  const arr = new Array(13).fill(0)
  for (const m of SL_MATERIALS) arr[m.id] = m.tex
  return arr
})()

// Lifetimes (fit in a Uint8; stored in the aux array while the cell is that kind)
const SL_FIRE_LIFE = 70
const SL_SMOKE_LIFE = 90
const SL_STEAM_LIFE = 150

// Grid + display tunables
const SL_ASPECT = 0.72
const SL_COLS_MIN = 60
const SL_COLS_MAX = 260
const SL_CELL_MIN = 2, SL_CELL_MAX = 8       // CSS px per cell (bigger = coarser/faster)
const SL_SPEED_MIN = 1, SL_SPEED_MAX = 4      // sim updates per animation frame
const SL_BRUSH_MIN = 1, SL_BRUSH_MAX = 16     // brush radius in cells
const SL_DISPERSE = 5                          // how far a liquid can flow sideways per step

const SL_LS_MAT = 'sl:material'
const SL_LS_BRUSH = 'sl:brush'
const SL_LS_SPEED = 'sl:speed'
const SL_LS_SCALE = 'sl:scale'

function slClamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function slReadStored(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function slReadStoredNumber(key: string, fallback: number): number {
  const raw = slReadStored(key)
  if (raw === null) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function slWriteStored(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* storage disabled — still works this session */ }
}

function slToRGB(input: string): [number, number, number] {
  let s = input.trim()
  if (s.startsWith('#')) {
    if (s.length === 4) s = '#' + [...s.slice(1)].map(c => c + c).join('')
    const r = parseInt(s.slice(1, 3), 16)
    const g = parseInt(s.slice(3, 5), 16)
    const b = parseInt(s.slice(5, 7), 16)
    if ([r, g, b].every(n => !Number.isNaN(n))) return [r, g, b]
    return [255, 255, 255]
  }
  const m = s.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const parts = m[1].split(',').map(x => parseFloat(x))
    if (parts.length >= 3) return [parts[0], parts[1], parts[2]]
  }
  return [255, 255, 255]
}

// Hoisted diagonal-preference pairs: allocating a fresh two-element array per
// settled cell per frame (three sim loops × up to ~49k cells × 60fps) was pure
// short-lived garbage; indexing by parity costs nothing.
const SL_LR: readonly number[] = [-1, 1]
const SL_RL: readonly number[] = [1, -1]

class SandLoomGame extends HTMLElement {
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private grid!: HTMLCanvasElement     // offscreen, cols × rows
  private gctx!: CanvasRenderingContext2D
  private img!: ImageData
  private ro?: ResizeObserver
  private raf = 0
  private playing = false
  private frame = 0
  /** Scene to load once the grid is first allocated — a zero-width mount (hidden
   *  container) defers allocation to the ResizeObserver, and the welcome scene
   *  must not be silently dropped in that window. */
  private pendingScene: number | null = null

  private w = 0                        // display backing-store dims (device px)
  private h = 0
  private cols = 0
  private rows = 0

  private cellArr = new Uint8Array(0)  // material id per cell
  private aux = new Uint8Array(0)      // lifetime for fire/gas
  private moved = new Uint8Array(0)    // per-frame "already processed" guard

  private bg: [number, number, number] = [5, 7, 12]

  // pointer paint state
  private painting = false
  private erase = false
  private lastGX = -1
  private lastGY = -1

  // tunables
  private material = SL_SAND
  private brush = 4
  private steps = 1
  private cell = 4

  connectedCallback() {
    this.resolveBg()

    this.material = SL_MATERIALS.some(m => m.id === slReadStoredNumber(SL_LS_MAT, SL_SAND))
      ? slReadStoredNumber(SL_LS_MAT, SL_SAND) : SL_SAND
    this.brush = slClamp(slReadStoredNumber(SL_LS_BRUSH, 4), SL_BRUSH_MIN, SL_BRUSH_MAX)
    this.steps = slClamp(slReadStoredNumber(SL_LS_SPEED, 1), SL_SPEED_MIN, SL_SPEED_MAX)
    this.cell = slClamp(slReadStoredNumber(SL_LS_SCALE, 4), SL_CELL_MIN, SL_CELL_MAX)

    this.innerHTML = `
      <div data-type="sl-game">
        <div data-type="sl-header">
          <div data-type="sl-titlebar">
            <h1>Sand Loom</h1>
            <span data-type="sl-badge">falling-sand</span>
          </div>
          <p>A little world of powders, liquids, fire and stone. Pick a material, paint on the canvas, and watch simple per-cell rules take over — sand piles up, water finds its level, fire climbs the wood, and lava freezes to stone when it hits water. No goal, just physics.</p>
        </div>
        <div data-type="sl-stage">
          <canvas data-type="sl-canvas" tabindex="0" role="img"
            aria-label="Falling-sand sandbox — a grid of materials obeying simple physics. Click or drag to paint the selected material; hold to keep drawing."></canvas>
        </div>
        <div data-type="sl-controls">
          <div data-group="transport" role="group" aria-label="Actions">
            <button data-action="play" type="button" aria-pressed="false" title="Run / pause the simulation (space)">Pause</button>
            <button data-action="step" type="button" title="Advance one frame while paused (.)">Step</button>
            <button data-action="clear" type="button" title="Empty the whole grid (C)">Clear</button>
            <button data-action="scene" type="button" title="Load the next demo scene (N)">Scene</button>
            <button data-action="download" type="button" title="Save the current frame as a PNG (D)">Download PNG</button>
          </div>
          <div data-group="materials" role="group" aria-label="Material">
            <span data-type="sl-group-label">Material</span>
            ${SL_MATERIALS.map(m => `
              <button data-mat="${m.id}" type="button" aria-pressed="${m.id === this.material && !this.erase}" title="${m.name}${m.key ? ` (${m.key})` : ''}">
                <span data-type="sl-swatch" aria-hidden="true" style="background:${m.hex}"></span>${m.name}${m.key ? `<span data-type="sl-key">${m.key}</span>` : ''}
              </button>`).join('')}
            <button data-mat="erase" type="button" aria-pressed="false" title="Erase — paint empty space (E)">
              <span data-type="sl-swatch" data-erase aria-hidden="true"></span>Eraser<span data-type="sl-key">E</span>
            </button>
          </div>
          <div data-type="sl-sliders">
            <div data-type="sl-slider">
              <label for="sl-brush">Brush</label>
              <input id="sl-brush" type="range" min="${SL_BRUSH_MIN}" max="${SL_BRUSH_MAX}" value="${this.brush}" />
              <output id="sl-brush-out">${this.brush}</output>
            </div>
            <div data-type="sl-slider">
              <label for="sl-speed">Speed</label>
              <input id="sl-speed" type="range" min="${SL_SPEED_MIN}" max="${SL_SPEED_MAX}" value="${this.steps}" />
              <output id="sl-speed-out">${this.steps}×</output>
            </div>
            <div data-type="sl-slider">
              <label for="sl-scale">Scale</label>
              <input id="sl-scale" type="range" min="${SL_CELL_MIN}" max="${SL_CELL_MAX}" value="${this.cell}" />
              <output id="sl-scale-out">${this.cell}px</output>
            </div>
          </div>
        </div>
        <details data-type="sl-explainer">
          <summary>New here? What a falling-sand sim is</summary>
          <p>The canvas is a grid of tiny cells, each holding one <strong>material</strong>. On every frame the whole grid is swept and each cell follows a few local rules: powders like <strong>sand</strong> fall and slide into slopes; liquids like <strong>water</strong>, <strong>oil</strong> and <strong>lava</strong> fall and then spread sideways to find their level; gases like <strong>steam</strong> and <strong>smoke</strong> drift upward and fade.</p>
          <p>What makes it come alive is how materials <strong>react</strong>. <strong>Fire</strong> climbs anything flammable — wood, plant, oil — and burns out into smoke. <strong>Lava</strong> sets things alight and freezes into <strong>stone</strong> the instant it touches water, hissing off steam. <strong>Acid</strong> eats through solids, <strong>plants</strong> creep along water, and <strong>salt</strong> dissolves in it. Which material sits on top of which is decided purely by <strong>density</strong>: sand sinks through water, water sinks through oil, so oil floats.</p>
          <p data-type="sl-try"><strong>Try this:</strong> paint a bowl of <em>Stone</em>, half-fill it with <em>Water</em>, drip <em>Oil</em> on top and watch it float — then drop a spark of <em>Fire</em> on the oil. Or pour <em>Lava</em> onto <em>Water</em> and watch it turn to rock.</p>
        </details>
        <p data-type="sl-hint">Shortcuts: space = play/pause · . = step · C = clear · N = next scene · D = download · [ ] = brush size · number keys + E pick a material. Click or drag the canvas to paint.</p>
      </div>
    `

    this.canvas = this.querySelector('[data-type="sl-canvas"]') as HTMLCanvasElement
    this.ctx = this.canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
    this.grid = document.createElement('canvas')
    this.gctx = this.grid.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
    this.ctx.imageSmoothingEnabled = false

    this.wire()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.querySelector('[data-type="sl-stage"]') as Element)
    // Stored in this.raf so disconnecting before it fires cancels it; setPlaying
    // reassigns the field afterwards, so sharing the slot is safe.
    this.raf = requestAnimationFrame(() => {
      this.resize()                    // allocates the grid (unless zero-width)
      if (this.img) this.loadScene(1)  // welcome scene
      else this.pendingScene = 1       // …deferred until the stage has width
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced) { this.runStatic(120); this.setPlaying(false) }
      else this.setPlaying(true)
    })
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.ro?.disconnect()
  }

  /* ── theme background ── */
  private resolveBg() {
    const cs = getComputedStyle(document.documentElement)
    const v = cs.getPropertyValue('--color-bg').trim()
    if (v) this.bg = slToRGB(v)
  }

  /* ── geometry / allocation ── */
  private dpr() {
    return Math.min(window.devicePixelRatio || 1, 2)
  }

  private resize(force = false) {
    const stage = this.querySelector('[data-type="sl-stage"]') as HTMLElement
    const cssW = stage.getBoundingClientRect().width
    if (cssW < 2) return
    const cssH = Math.round(cssW * SL_ASPECT)
    const dpr = this.dpr()
    this.canvas.style.width = cssW + 'px'
    this.canvas.style.height = cssH + 'px'
    this.w = this.canvas.width = Math.round(cssW * dpr)
    this.h = this.canvas.height = Math.round(cssH * dpr)
    this.ctx.imageSmoothingEnabled = false

    const targetCols = slClamp(Math.round(cssW / this.cell), SL_COLS_MIN, SL_COLS_MAX)
    if (force || targetCols !== this.cols || this.cellArr.length === 0) {
      this.reallocate(targetCols)
      if (this.pendingScene !== null) {
        this.loadScene(this.pendingScene)
        this.pendingScene = null
      }
    }
    this.draw()
  }

  /** Re-derive grid dims at the current cell size, preserving the field where it overlaps. */
  private reallocate(cols: number) {
    const oldCell = this.cellArr, oldAux = this.aux, oldCols = this.cols, oldRows = this.rows
    this.cols = cols
    this.rows = Math.max(1, Math.round(cols * SL_ASPECT))
    const size = this.cols * this.rows
    this.cellArr = new Uint8Array(size)
    this.aux = new Uint8Array(size)
    this.moved = new Uint8Array(size)
    // remap the old field proportionally so a scale change doesn't wipe the scene
    if (oldCell.length && oldCols > 0 && oldRows > 0) {
      for (let y = 0; y < this.rows; y++) {
        const sy = Math.min(oldRows - 1, Math.floor(y / this.rows * oldRows))
        for (let x = 0; x < this.cols; x++) {
          const sx = Math.min(oldCols - 1, Math.floor(x / this.cols * oldCols))
          const si = sy * oldCols + sx
          const di = y * this.cols + x
          this.cellArr[di] = oldCell[si]
          this.aux[di] = oldAux[si]
        }
      }
    }
    this.grid.width = this.cols
    this.grid.height = this.rows
    this.img = this.gctx.createImageData(this.cols, this.rows)
    const d = this.img.data
    for (let i = 3; i < d.length; i += 4) d[i] = 255   // opaque alpha, set once
  }

  /* ── scenes ── */
  private sceneIndex = 0
  private static SCENES = 4

  private loadScene(index: number) {
    this.sceneIndex = ((index % SandLoomGame.SCENES) + SandLoomGame.SCENES) % SandLoomGame.SCENES
    const { cols, rows, cellArr, aux } = this
    cellArr.fill(SL_EMPTY)
    aux.fill(0)
    const set = (x: number, y: number, m: number) => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return
      cellArr[y * cols + x] = m
    }
    const rect = (x0: number, y0: number, x1: number, y1: number, m: number) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, m)
    }
    if (this.sceneIndex === 0) {
      // empty
    } else if (this.sceneIndex === 1) {
      // Welcome: a stone bowl with water + oil, a sand mound raining in, a plant
      const by = rows - 3
      rect(Math.floor(cols * 0.08), by, Math.floor(cols * 0.55), by + 2, SL_STONE)
      for (let y = by - 1; y > by - Math.floor(rows * 0.28); y--) {
        set(Math.floor(cols * 0.08), y, SL_STONE)
        set(Math.floor(cols * 0.55), y, SL_STONE)
      }
      rect(Math.floor(cols * 0.12), by - Math.floor(rows * 0.18), Math.floor(cols * 0.51), by - 1, SL_WATER)
      rect(Math.floor(cols * 0.18), by - Math.floor(rows * 0.22), Math.floor(cols * 0.34), by - Math.floor(rows * 0.19), SL_OIL)
      // raining sand up top
      for (let x = Math.floor(cols * 0.62); x < Math.floor(cols * 0.9); x++)
        for (let y = 2; y < Math.floor(rows * 0.16); y++)
          if (Math.random() < 0.7) set(x, y, SL_SAND)
      // a plant seed on the rim
      set(Math.floor(cols * 0.53), by - 1, SL_PLANT)
    } else if (this.sceneIndex === 2) {
      // Volcano: lava pool with stone walls, wood + plant to burn
      const by = rows - 2
      rect(0, by, cols - 1, rows - 1, SL_STONE)
      rect(Math.floor(cols * 0.35), by - Math.floor(rows * 0.12), Math.floor(cols * 0.65), by - 1, SL_LAVA)
      rect(Math.floor(cols * 0.35), by - Math.floor(rows * 0.13), Math.floor(cols * 0.35), by - 1, SL_STONE)
      rect(Math.floor(cols * 0.65), by - Math.floor(rows * 0.13), Math.floor(cols * 0.65), by - 1, SL_STONE)
      rect(Math.floor(cols * 0.08), by - 5, Math.floor(cols * 0.22), by - 1, SL_WOOD)
      rect(Math.floor(cols * 0.78), by - 6, Math.floor(cols * 0.9), by - 1, SL_WOOD)
      for (let x = Math.floor(cols * 0.1); x < Math.floor(cols * 0.2); x++) set(x, by - 6, SL_PLANT)
    } else {
      // Rain: a few stone ledges with water pouring from the top
      const ledge = (cx: number, cy: number, wl: number) => rect(cx, cy, cx + wl, cy, SL_STONE)
      ledge(Math.floor(cols * 0.1), Math.floor(rows * 0.35), Math.floor(cols * 0.35))
      ledge(Math.floor(cols * 0.55), Math.floor(rows * 0.5), Math.floor(cols * 0.35))
      ledge(Math.floor(cols * 0.15), Math.floor(rows * 0.68), Math.floor(cols * 0.4))
      for (let x = 0; x < cols; x++)
        for (let y = 0; y < Math.floor(rows * 0.06); y++)
          if (Math.random() < 0.5) set(x, y, SL_WATER)
    }
    this.draw()
  }

  /* ── simulation ── */
  private idx(x: number, y: number) { return y * this.cols + x }
  private movable(m: number) { return m !== SL_EMPTY && SL_TYPE[m] !== SL_T_SOLID }
  private canDisplace(moverDensity: number, target: number) {
    return target === SL_EMPTY || (this.movable(target) && SL_DENSITY[target] < moverDensity)
  }

  private swap(i: number, j: number) {
    const c = this.cellArr[i], a = this.aux[i]
    this.cellArr[i] = this.cellArr[j]; this.aux[i] = this.aux[j]
    this.cellArr[j] = c; this.aux[j] = a
    this.moved[i] = 1; this.moved[j] = 1
  }

  private setCell(i: number, m: number, a = 0) {
    this.cellArr[i] = m; this.aux[i] = a; this.moved[i] = 1
  }

  /** Is any 4-neighbour of (x,y) the given material? */
  private neighborIs(x: number, y: number, m: number) {
    const { cols, rows, cellArr } = this
    if (x > 0 && cellArr[y * cols + x - 1] === m) return true
    if (x < cols - 1 && cellArr[y * cols + x + 1] === m) return true
    if (y > 0 && cellArr[(y - 1) * cols + x] === m) return true
    if (y < rows - 1 && cellArr[(y + 1) * cols + x] === m) return true
    return false
  }

  private forNeighbors(x: number, y: number, fn: (nx: number, ny: number, ni: number) => boolean | void) {
    const { cols, rows } = this
    if (x > 0 && fn(x - 1, y, y * cols + x - 1)) return
    if (x < cols - 1 && fn(x + 1, y, y * cols + x + 1)) return
    if (y > 0 && fn(x, y - 1, (y - 1) * cols + x)) return
    if (y < rows - 1 && fn(x, y + 1, (y + 1) * cols + x)) return
  }

  private stepSim() {
    const { cols, rows, cellArr, moved } = this
    moved.fill(0)
    this.frame++
    const ltr = (this.frame & 1) === 0
    for (let y = rows - 1; y >= 0; y--) {
      const rowBase = y * cols
      for (let k = 0; k < cols; k++) {
        const x = ltr ? k : cols - 1 - k
        const i = rowBase + x
        if (moved[i]) continue
        const e = cellArr[i]
        if (e === SL_EMPTY) continue
        switch (SL_TYPE[e]) {
          case SL_T_POWDER: this.doPowder(x, y, i, e); break
          case SL_T_LIQUID: this.doLiquid(x, y, i, e); break
          case SL_T_GAS: this.doGas(x, y, i, e); break
          case SL_T_FIRE: this.doFire(x, y, i); break
          case SL_T_SOLID: this.doSolid(x, y, i, e); break
        }
      }
    }
  }

  private doPowder(x: number, y: number, i: number, e: number) {
    if (e === SL_SALT && this.neighborIs(x, y, SL_WATER) && Math.random() < 0.06) {
      this.setCell(i, SL_EMPTY); return
    }
    this.fallOrSlide(x, y, i, SL_DENSITY[e])
  }

  /** Shared powder/liquid gravity: straight down, else the parity-alternating
   *  diagonal. One copy so a physics tweak cannot make the two phases drift. */
  private fallOrSlide(x: number, y: number, i: number, d: number): boolean {
    const { cols, rows } = this
    if (y + 1 >= rows) return false
    const below = i + cols
    if (this.canDisplace(d, this.cellArr[below])) { this.swap(i, below); return true }
    const order = ((this.frame + x) & 1) ? SL_LR : SL_RL
    for (const dx of order) {
      const nx = x + dx
      if (nx < 0 || nx >= cols) continue
      const j = below + dx
      if (this.canDisplace(d, this.cellArr[j])) { this.swap(i, j); return true }
    }
    return false
  }

  private doLiquid(x: number, y: number, i: number, e: number) {
    // reactions
    if ((e === SL_WATER || e === SL_ACID) && this.neighborIs(x, y, SL_LAVA)) {
      this.coolLavaAround(x, y)
      this.setCell(i, SL_STEAM, SL_STEAM_LIFE); return
    }
    if (e === SL_ACID) {
      if (this.acidDissolve(x, y, i)) return
    }
    if (e === SL_LAVA) {
      this.igniteAround(x, y)
      if (this.neighborIs(x, y, SL_WATER) || this.neighborIs(x, y, SL_STEAM)) {
        this.setCell(i, SL_STONE); return
      }
      if (Math.random() < 0.55) { this.moved[i] = 1; return }   // viscous: skip motion some frames
    }
    const d = SL_DENSITY[e]
    if (this.fallOrSlide(x, y, i, d)) return
    // spread sideways to seek level
    const dir = ((this.frame + x + y) & 1) ? 1 : -1
    if (this.flow(x, y, dir, d)) return
    this.flow(x, y, -dir, d)
  }

  private flow(x: number, y: number, dir: number, d: number): boolean {
    const { cols } = this
    let nx = x, last = -1
    for (let s = 0; s < SL_DISPERSE; s++) {
      nx += dir
      if (nx < 0 || nx >= cols) break
      const j = y * cols + nx
      if (this.canDisplace(d, this.cellArr[j])) last = j
      else break
    }
    if (last >= 0) { this.swap(y * cols + x, last); return true }
    return false
  }

  private doGas(x: number, y: number, i: number, e: number) {
    const { cols } = this
    const life = this.aux[i]
    if (e === SL_SMOKE) {
      if (life <= 1) { this.setCell(i, SL_EMPTY); return }
      this.aux[i] = life - 1
    } else { // steam
      if (life <= 1 || Math.random() < 0.006) { this.setCell(i, SL_WATER); return }
      this.aux[i] = life - 1
    }
    const d = SL_DENSITY[e]
    const canRise = (t: number) => t === SL_EMPTY || (SL_TYPE[t] === SL_T_GAS && SL_DENSITY[t] > d)
    if (y > 0) {
      const up = i - cols
      if (canRise(this.cellArr[up])) { this.swap(i, up); return }
      const order = ((this.frame + x) & 1) ? SL_LR : SL_RL
      for (const dx of order) {
        const nx = x + dx
        if (nx < 0 || nx >= cols) continue
        const j = up + dx
        if (canRise(this.cellArr[j])) { this.swap(i, j); return }
      }
    }
    // drift sideways
    const dir = ((this.frame + x) & 1) ? 1 : -1
    const nx = x + dir
    if (nx >= 0 && nx < cols && this.cellArr[y * cols + nx] === SL_EMPTY) { this.swap(i, y * cols + nx); return }
  }

  private doFire(x: number, y: number, i: number) {
    const { cols } = this
    if (this.neighborIs(x, y, SL_WATER) || this.neighborIs(x, y, SL_ACID)) {
      this.setCell(i, Math.random() < 0.5 ? SL_STEAM : SL_EMPTY, SL_STEAM_LIFE >> 1); return
    }
    this.igniteAround(x, y)
    const life = this.aux[i]
    if (life <= 1) {
      this.setCell(i, Math.random() < 0.6 ? SL_SMOKE : SL_EMPTY, SL_SMOKE_LIFE); return
    }
    this.aux[i] = life - 1
    if (y > 0) {
      const up = i - cols
      if (this.cellArr[up] === SL_EMPTY) { this.swap(i, up); return }
      const dx = ((this.frame + x) & 1) ? -1 : 1
      const nx = x + dx
      if (nx >= 0 && nx < cols && this.cellArr[up + dx] === SL_EMPTY) { this.swap(i, up + dx); return }
    }
  }

  private doSolid(x: number, y: number, i: number, e: number) {
    if (e === SL_PLANT && Math.random() < 0.02) {
      // grow into an adjacent water cell
      this.forNeighbors(x, y, (_nx, _ny, ni) => {
        if (this.cellArr[ni] === SL_WATER) { this.setCell(ni, SL_PLANT); return true }
      })
    }
  }

  /* ── reaction helpers ── */
  private igniteAround(x: number, y: number) {
    this.forNeighbors(x, y, (_nx, _ny, ni) => {
      const t = this.cellArr[ni]
      if (t === SL_WOOD && Math.random() < 0.05) this.setCell(ni, SL_FIRE, SL_FIRE_LIFE + ((Math.random() * 30) | 0))
      else if (t === SL_PLANT && Math.random() < 0.12) this.setCell(ni, SL_FIRE, SL_FIRE_LIFE)
      else if (t === SL_OIL && Math.random() < 0.18) this.setCell(ni, SL_FIRE, SL_FIRE_LIFE + 40)
    })
  }

  private coolLavaAround(x: number, y: number) {
    this.forNeighbors(x, y, (_nx, _ny, ni) => {
      if (this.cellArr[ni] === SL_LAVA) { this.setCell(ni, SL_STONE); return true }
    })
  }

  private acidDissolve(x: number, y: number, i: number): boolean {
    let hit = false
    this.forNeighbors(x, y, (_nx, _ny, ni) => {
      const t = this.cellArr[ni]
      if (t === SL_SAND || t === SL_STONE || t === SL_WOOD || t === SL_PLANT || t === SL_SALT) {
        this.setCell(ni, SL_EMPTY); hit = true; return true
      }
    })
    if (hit && Math.random() < 0.35) { this.setCell(i, SL_EMPTY); return true }
    return false
  }

  /* ── rendering ── */
  private draw() {
    if (!this.img) return // grid not allocated yet (zero-width mount)
    const { cellArr, img, bg } = this
    const d = img.data
    const frame = this.frame
    for (let i = 0, p = 0; i < cellArr.length; i++, p += 4) {
      const e = cellArr[i]
      let r: number, g: number, b: number
      if (e === SL_EMPTY) {
        r = bg[0]; g = bg[1]; b = bg[2]
      } else if (e === SL_FIRE) {
        const t = this.aux[i] / (SL_FIRE_LIFE + 30)
        const fl = ((i * 13 + frame * 7) & 15) - 6
        r = slC(255 + fl); g = slC(90 + t * 150 + fl); b = slC(25 + t * 40)
      } else if (e === SL_LAVA) {
        const fl = ((i * 17 + frame * 5) & 15) - 5
        r = slC(255 + fl); g = slC(100 + fl * 2); b = slC(45 + fl)
      } else {
        const base = SL_BASE[e]
        const tex = SL_TEX[e]
        const shade = tex ? (((i * 92821) ^ (i >> 3)) & 15) / 15 * tex - tex / 2 : 0
        r = slC(base[0] + shade); g = slC(base[1] + shade); b = slC(base[2] + shade)
      }
      d[p] = r; d[p + 1] = g; d[p + 2] = b
    }
    this.gctx.putImageData(img, 0, 0)
    this.ctx.drawImage(this.grid, 0, 0, this.cols, this.rows, 0, 0, this.w, this.h)
  }

  private runStatic(n: number) {
    for (let i = 0; i < n; i++) this.stepSim()
    this.draw()
  }

  private setPlaying(on: boolean) {
    this.playing = on
    const btn = this.querySelector('[data-action="play"]') as HTMLButtonElement | null
    if (btn) { btn.textContent = on ? 'Pause' : 'Play'; btn.setAttribute('aria-pressed', String(on)) }
    cancelAnimationFrame(this.raf)
    this.raf = 0
    if (on) this.loop()
  }

  private loop = () => {
    if (!this.playing) return
    for (let i = 0; i < this.steps; i++) this.stepSim()
    this.draw()
    this.raf = requestAnimationFrame(this.loop)
  }

  /* ── interaction ── */
  private wire() {
    this.querySelector('[data-action="play"]')?.addEventListener('click', () => this.setPlaying(!this.playing))
    this.querySelector('[data-action="step"]')?.addEventListener('click', () => { this.setPlaying(false); this.stepSim(); this.draw() })
    this.querySelector('[data-action="clear"]')?.addEventListener('click', () => { this.cellArr.fill(SL_EMPTY); this.aux.fill(0); this.draw(); this.canvas.focus() })
    this.querySelector('[data-action="scene"]')?.addEventListener('click', () => { this.loadScene(this.sceneIndex + 1); if (!this.playing) this.draw() })
    this.querySelector('[data-action="download"]')?.addEventListener('click', () => this.download())

    this.querySelectorAll<HTMLButtonElement>('[data-mat]').forEach(btn => {
      btn.addEventListener('click', () => this.selectMaterial(btn.dataset.mat as string))
    })

    this.bindSlider('#sl-brush', '#sl-brush-out', SL_LS_BRUSH, raw => { this.brush = slClamp(raw, SL_BRUSH_MIN, SL_BRUSH_MAX); return String(this.brush) })
    this.bindSlider('#sl-speed', '#sl-speed-out', SL_LS_SPEED, raw => { this.steps = slClamp(raw, SL_SPEED_MIN, SL_SPEED_MAX); return `${this.steps}×` })
    this.bindSlider('#sl-scale', '#sl-scale-out', SL_LS_SCALE, raw => {
      this.cell = slClamp(raw, SL_CELL_MIN, SL_CELL_MAX)
      // force = true, NOT `this.cols = 0`: zeroing cols made reallocate() skip
      // its proportional remap (oldCols > 0 guard) and wiped the drawing.
      this.resize(true)
      return `${this.cell}px`
    })

    this.canvas.addEventListener('pointerdown', e => this.onPointer(e, true))
    this.canvas.addEventListener('pointermove', e => this.onPointer(e, false))
    const stop = () => { this.painting = false; this.lastGX = this.lastGY = -1 }
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
      slWriteStored(lsKey, String(raw))
    })
  }

  private selectMaterial(matAttr: string) {
    if (matAttr === 'erase') {
      this.erase = true
    } else {
      const id = Number(matAttr)
      if (SL_MATERIALS.some(m => m.id === id)) { this.material = id; this.erase = false; slWriteStored(SL_LS_MAT, String(id)) }
    }
    this.querySelectorAll<HTMLButtonElement>('[data-mat]').forEach(b => {
      const attr = b.dataset.mat
      const active = this.erase ? attr === 'erase' : attr === String(this.material)
      b.setAttribute('aria-pressed', String(active))
    })
  }

  private setBrush(v: number) {
    this.brush = slClamp(v, SL_BRUSH_MIN, SL_BRUSH_MAX)
    const input = this.querySelector('#sl-brush') as HTMLInputElement | null
    const out = this.querySelector('#sl-brush-out') as HTMLOutputElement | null
    if (input) input.value = String(this.brush)
    if (out) out.textContent = String(this.brush)
    slWriteStored(SL_LS_BRUSH, String(this.brush))
  }

  private onKey(e: KeyboardEvent) {
    const key = e.key
    if (key === ' ') { e.preventDefault(); this.setPlaying(!this.playing); return }
    if (key === '.') { e.preventDefault(); this.setPlaying(false); this.stepSim(); this.draw(); return }
    if (key === 'c' || key === 'C') { e.preventDefault(); this.cellArr.fill(SL_EMPTY); this.aux.fill(0); this.draw(); return }
    if (key === 'n' || key === 'N') { e.preventDefault(); this.loadScene(this.sceneIndex + 1); if (!this.playing) this.draw(); return }
    if (key === 'd' || key === 'D') { e.preventDefault(); this.download(); return }
    if (key === 'e' || key === 'E') { e.preventDefault(); this.selectMaterial('erase'); return }
    if (key === '[') { e.preventDefault(); this.setBrush(this.brush - 1); return }
    if (key === ']') { e.preventDefault(); this.setBrush(this.brush + 1); return }
    const mat = SL_MATERIALS.find(m => m.key === key)
    if (mat) { e.preventDefault(); this.selectMaterial(String(mat.id)) }
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
    if (this.lastGX >= 0) this.paintLine(this.lastGX, this.lastGY, gx, gy)
    else this.stamp(gx, gy)
    this.lastGX = gx; this.lastGY = gy
    if (!this.playing) this.draw()
  }

  /** Stamp a filled disc of the current material (or empty when erasing). */
  private stamp(cx: number, cy: number) {
    const { cols, rows } = this
    const m = this.erase ? SL_EMPTY : this.material
    const r = this.brush
    const r2 = r * r
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy
      if (y < 0 || y >= rows) continue
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue
        const x = cx + dx
        if (x < 0 || x >= cols) continue
        const i = y * cols + x
        // liquids/powders paint sparsely so a drag "sprinkles" rather than casts a solid slab
        if (m !== SL_EMPTY && (SL_TYPE[m] === SL_T_POWDER || SL_TYPE[m] === SL_T_LIQUID) && Math.random() < 0.28) continue
        this.cellArr[i] = m
        this.aux[i] = m === SL_FIRE ? SL_FIRE_LIFE : (m === SL_STEAM ? SL_STEAM_LIFE : (m === SL_SMOKE ? SL_SMOKE_LIFE : 0))
      }
    }
  }

  /** Interpolate stamps between two pointer samples so fast drags stay connected. */
  private paintLine(x0: number, y0: number, x1: number, y1: number) {
    const dx = x1 - x0, dy = y1 - y0
    const dist = Math.max(Math.abs(dx), Math.abs(dy))
    if (dist === 0) { this.stamp(x1, y1); return }
    const stepEvery = Math.max(1, Math.floor(this.brush * 0.5))
    for (let s = 0; s <= dist; s += stepEvery) {
      const t = s / dist
      this.stamp(Math.round(x0 + dx * t), Math.round(y0 + dy * t))
    }
    this.stamp(x1, y1)
  }

  private download() {
    try {
      const url = this.canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = `sand-loom-${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch { /* toDataURL can throw on a tainted canvas — it never is here (no external images) */ }
  }
}

/** Clamp a channel to a byte. */
function slC(n: number) { return n < 0 ? 0 : n > 255 ? 255 : n | 0 }

if (!customElements.get('sand-loom-game')) {
  customElements.define('sand-loom-game', SandLoomGame)
}

export {}
