import { flashLabel } from '../../../lib/flash'
/**
 * Maze Weaver — a seeded maze generator + pathfinding visualizer, zero deps.
 *
 * Build a "perfect" maze (a spanning tree, so every two cells are joined by
 * exactly one corridor) with one of three classic algorithms, then watch a
 * pathfinder search it for the way from the green start to the coral goal:
 *
 *   Build with   — Recursive Backtracker (DFS carve) · Randomized Prim · Kruskal
 *   Solve with   — Breadth-First (shortest, floods in rings) · A* (heads
 *                  straight for the goal) · Depth-First (dives and backtracks)
 *
 * Everything is deterministic from a single integer SEED: same seed + size ⇒
 * the same maze, every time (type a seed to reproduce one, or Regenerate for a
 * new one). Watch the carve/solve animate, single-step it, tune size + speed,
 * click any cell to move the goal, and download the frame as a PNG. Colours are
 * read from theme.css tokens at mount; nothing about the layout is hardcoded.
 * The RAF loop is torn down in disconnectedCallback so it never leaks across
 * View Transitions, and reduced-motion visitors get instant (unanimated) runs.
 */

type Phase = 'idle' | 'generating' | 'generated' | 'solving' | 'pathing' | 'solved'
type GenId = 'backtracker' | 'prim' | 'kruskal'
type SolveId = 'bfs' | 'astar' | 'dfs'

/* Wall bits per cell (a set bit means that wall still stands). */
const N = 1, E = 2, S = 4, W = 8
const DIRS = [
  { dx: 0, dy: -1, bit: N, opp: S },
  { dx: 1, dy: 0, bit: E, opp: W },
  { dx: 0, dy: 1, bit: S, opp: N },
  { dx: -1, dy: 0, bit: W, opp: E },
]

/* Solve-overlay cell states. */
const FRONTIER = 1, VISITED = 2

const GEN_NAMES: Record<GenId, string> = {
  backtracker: 'Recursive Backtracker',
  prim: "Randomized Prim",
  kruskal: "Randomized Kruskal",
}
const SOLVE_NAMES: Record<SolveId, string> = { bfs: 'BFS', astar: 'A*', dfs: 'DFS' }

const LS_COLS = 'mw:cols'
const LS_SPEED = 'mw:speed'
const LS_GEN = 'mw:gen'
const LS_SOLVER = 'mw:solver'

const COLS_MIN = 8, COLS_MAX = 56          // columns; rows derive from aspect
const SPEED_MIN = 1, SPEED_MAX = 48        // generator/solver steps per frame
const ASPECT = 0.62                        // rows/cols — keeps cells ~square

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

class MazeWeaverGame extends HTMLElement {
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private statusEl!: HTMLElement
  private ro?: ResizeObserver
  private raf = 0
  private playing = false

  private w = 0 // device-pixel canvas dims
  private h = 0

  // grid + maze
  private cols = 28
  private rows = 17
  private cells = new Uint8Array(0) // wall bits per cell
  private rnd: () => number = Math.random
  private seed = 1

  // solve overlay
  private solveState = new Uint8Array(0)
  private came = new Int32Array(0)
  private gScore = new Float64Array(0)
  private expanded = 0
  private path: number[] = []
  private pathDrawn = 0
  private start = 0
  private goal = 0

  // animation driver
  private phase: Phase = 'idle'
  private iter: Iterator<void> | null = null
  private iterKind: 'gen' | 'solve' | null = null
  private genHead = -1

  // tunables
  private speedRaw = 10
  private genId: GenId = 'backtracker'
  private solveId: SolveId = 'bfs'

  // resolved theme colours
  private colBg = '#05070c'
  private colWall = '#dde6f2'
  private colAccent: [number, number, number] = [155, 140, 255]
  private colPath = '#4ade80'
  private colStart = '#4ade80'
  private colGoal = '#ff6b6b'

  connectedCallback() {
    // restore prefs
    const rawCols = Number(localStorage.getItem(LS_COLS))
    const rawSpeed = Number(localStorage.getItem(LS_SPEED))
    const savedGen = localStorage.getItem(LS_GEN) as GenId | null
    const savedSolver = localStorage.getItem(LS_SOLVER) as SolveId | null

    this.cols = clamp(rawCols || 28, COLS_MIN, COLS_MAX)
    if (this.cols % 2) this.cols++ // step of 2
    this.speedRaw = clamp(rawSpeed || 10, SPEED_MIN, SPEED_MAX)
    if (savedGen && GEN_NAMES[savedGen]) this.genId = savedGen
    if (savedSolver && SOLVE_NAMES[savedSolver]) this.solveId = savedSolver
    this.rows = Math.max(6, Math.round(this.cols * ASPECT))

    this.seed = Math.floor(Math.random() * 900000) + 100000

    this.innerHTML = `
      <div data-type="mw-game">
        <div data-type="mw-header">
          <div data-type="mw-titlebar">
            <h1>Maze Weaver</h1>
            <span data-type="mw-badge">generator + solver</span>
          </div>
          <p>Weave a perfect maze — every two cells joined by exactly one path — then watch a pathfinder hunt down the route from the green start to the coral goal. Pick how it's built and how it's searched, and the whole thing is fixed by a single seed. Click any cell to move the goal.</p>
        </div>
        <div data-type="mw-stage">
          <canvas data-type="mw-canvas" tabindex="0" role="img"
            aria-label="Maze generator and pathfinding visualizer. Click a cell to move the goal; the solver traces the route from start to goal."></canvas>
        </div>
        <div data-type="mw-controls">
          <div data-group="transport" role="group" aria-label="Actions">
            <button data-action="generate" type="button" title="Weave a fresh maze from a new seed (G)">Regenerate</button>
            <button data-action="solve" type="button" title="Search the maze from start to goal (space)">Solve</button>
            <button data-action="play" type="button" aria-pressed="false" title="Pause / resume the animation">Pause</button>
            <button data-action="step" type="button" title="Advance one step (S)">Step</button>
            <button data-action="clear" type="button" title="Clear the search overlay (C)">Clear</button>
            <button data-action="download" type="button" title="Save the current frame as a PNG (D)">Download PNG</button>
          </div>
          <div data-type="mw-selects">
            <div data-group="gen" role="group" aria-label="Generation algorithm">
              <span data-type="mw-group-label">Build with</span>
              ${(Object.keys(GEN_NAMES) as GenId[]).map(id => `
                <button data-gen="${id}" type="button" aria-pressed="${id === this.genId}" title="${GEN_NAMES[id]}">${GEN_NAMES[id]}</button>`).join('')}
            </div>
            <div data-group="solver" role="group" aria-label="Pathfinding algorithm">
              <span data-type="mw-group-label">Solve with</span>
              ${(Object.keys(SOLVE_NAMES) as SolveId[]).map(id => `
                <button data-solver="${id}" type="button" aria-pressed="${id === this.solveId}" title="${SOLVE_NAMES[id]}">${SOLVE_NAMES[id]}</button>`).join('')}
            </div>
          </div>
          <div data-type="mw-sliders">
            <div data-type="mw-slider">
              <label for="mw-size">Size</label>
              <input id="mw-size" type="range" min="${COLS_MIN}" max="${COLS_MAX}" step="2" value="${this.cols}" />
              <output id="mw-size-out">${this.cols}×${this.rows}</output>
            </div>
            <div data-type="mw-slider">
              <label for="mw-speed">Speed</label>
              <input id="mw-speed" type="range" min="${SPEED_MIN}" max="${SPEED_MAX}" value="${this.speedRaw}" />
              <output id="mw-speed-out">${this.speedRaw}/frame</output>
            </div>
          </div>
          <div data-group="seed">
            <label for="mw-seed">Seed</label>
            <input id="mw-seed" type="text" inputmode="numeric" spellcheck="false" value="${this.seed}"
              aria-label="Seed — type a number and press Enter to reproduce a maze" />
            <button data-action="copy-seed" type="button" title="Copy this seed">Copy</button>
          </div>
          <p data-type="mw-status" role="status" aria-live="polite">Ready.</p>
          <div data-type="mw-legend" aria-hidden="true">
            <span><i data-swatch="start"></i>start</span>
            <span><i data-swatch="goal"></i>goal</span>
            <span><i data-swatch="frontier"></i>frontier</span>
            <span><i data-swatch="visited"></i>explored</span>
            <span><i data-swatch="path"></i>path</span>
          </div>
        </div>
        <details data-type="mw-explainer">
          <summary>New here? Mazes &amp; pathfinding in 30 seconds</summary>
          <p>Every maze here is a <strong>perfect maze</strong>: a grid of cells with walls knocked out so that exactly one route links any two cells — no loops, no islands. The three <strong>builders</strong> reach that same shape by different routes. <em>Recursive Backtracker</em> carves a long, winding tunnel and only backtracks when it's boxed in, so it makes twisty mazes with few junctions. <em>Prim</em> and <em>Kruskal</em> grow the maze more evenly, giving shorter dead-ends and a bushier look.</p>
          <p>The <strong>solvers</strong> all find the goal, but you can watch <em>how</em> they think. <em>BFS</em> floods outward one ring at a time, so it always returns the shortest path but explores a lot. <em>A*</em> uses the goal's direction as a hint and beelines toward it, exploring far fewer cells. <em>DFS</em> just dives down one corridor until it hits a wall, then backs up — fast to code, rarely the shortest.</p>
          <p data-type="mw-try"><strong>Try this:</strong> generate one maze, then solve it with BFS, A* and DFS in turn and compare the <em>explored</em> count in the status line. Same maze, very different search shapes.</p>
        </details>
        <p data-type="mw-hint">Shortcuts: space = solve/pause · G = regenerate · S = step · C = clear · D = download. Click a cell to move the goal.</p>
      </div>
    `

    this.canvas = this.querySelector('[data-type="mw-canvas"]') as HTMLCanvasElement
    this.ctx = this.canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
    this.statusEl = this.querySelector('[data-type="mw-status"]') as HTMLElement
    this.readTheme()
    this.paintLegend()
    this.wire()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.querySelector('[data-type="mw-stage"]') as Element)
    requestAnimationFrame(() => {
      this.resize()
      // Build the first maze, then leave it solved so the page reads at a glance.
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      this.startGenerate(false)
      if (reduced) this.startSolve()
    })
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.ro?.disconnect()
  }

  /* ── theme ── */

  private readTheme() {
    const cs = getComputedStyle(document.documentElement)
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
    this.colBg = v('--color-bg', '#05070c')
    this.colWall = v('--color-text', '#dde6f2')
    this.colPath = v('--color-success', '#4ade80')
    this.colStart = v('--color-success', '#4ade80')
    this.colGoal = v('--color-error', '#ff6b6b')
    this.colAccent = this.toRGB(v('--color-accent', '#9b8cff')) || [155, 140, 255]
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

  private accentA(a: number) {
    const [r, g, b] = this.colAccent
    return `rgba(${r},${g},${b},${a})`
  }

  private paintLegend() {
    const set = (k: string, c: string) => {
      const el = this.querySelector(`[data-swatch="${k}"]`) as HTMLElement | null
      if (el) el.style.background = c
    }
    set('start', this.colStart)
    set('goal', this.colGoal)
    set('frontier', this.accentA(0.55))
    set('visited', this.accentA(0.22))
    set('path', this.colPath)
  }

  /* ── geometry ── */

  private dpr() {
    return Math.min(window.devicePixelRatio || 1, 2)
  }

  private resize() {
    const stage = this.querySelector('[data-type="mw-stage"]') as HTMLElement
    const cssW = stage.getBoundingClientRect().width
    if (cssW < 2) return
    const cssH = Math.round(cssW * (this.rows / this.cols))
    const dpr = this.dpr()
    this.canvas.style.width = cssW + 'px'
    this.canvas.style.height = cssH + 'px'
    this.w = this.canvas.width = Math.round(cssW * dpr)
    this.h = this.canvas.height = Math.round(cssH * dpr)
    this.draw()
  }

  /* ── grid helpers ── */

  private carve(a: number, b: number, dir: { bit: number; opp: number }) {
    this.cells[a] &= ~dir.bit
    this.cells[b] &= ~dir.opp
  }

  private unvisitedNeighbors(cell: number, seen: Uint8Array) {
    const c = cell % this.cols, r = (cell / this.cols) | 0
    const out: { cell: number; dir: typeof DIRS[number] }[] = []
    for (const d of DIRS) {
      const nc = c + d.dx, nr = r + d.dy
      if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue
      const ni = nr * this.cols + nc
      if (!seen[ni]) out.push({ cell: ni, dir: d })
    }
    return out
  }

  private inMazeNeighbors(cell: number, mark: Uint8Array) {
    const c = cell % this.cols, r = (cell / this.cols) | 0
    const out: { cell: number; dir: typeof DIRS[number] }[] = []
    for (const d of DIRS) {
      const nc = c + d.dx, nr = r + d.dy
      if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue
      const ni = nr * this.cols + nc
      if (mark[ni]) out.push({ cell: ni, dir: d })
    }
    return out
  }

  private openNeighbors(cell: number) {
    const c = cell % this.cols, r = (cell / this.cols) | 0
    const out: number[] = []
    for (const d of DIRS) {
      if (this.cells[cell] & d.bit) continue // wall stands → blocked
      const nc = c + d.dx, nr = r + d.dy
      if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue
      out.push(nr * this.cols + nc)
    }
    return out
  }

  private randInt(n: number) {
    return (this.rnd() * n) | 0
  }

  /* ── generators (each yields one unit of carving work) ── */

  private *genBacktracker(): Iterator<void> {
    const n = this.cols * this.rows
    const seen = new Uint8Array(n)
    const stack: number[] = [0]
    seen[0] = 1
    while (stack.length) {
      const cur = stack[stack.length - 1]
      this.genHead = cur
      const nbrs = this.unvisitedNeighbors(cur, seen)
      if (nbrs.length) {
        const pick = nbrs[this.randInt(nbrs.length)]
        this.carve(cur, pick.cell, pick.dir)
        seen[pick.cell] = 1
        stack.push(pick.cell)
        yield
      } else {
        stack.pop()
      }
    }
    this.genHead = -1
  }

  private *genPrim(): Iterator<void> {
    const n = this.cols * this.rows
    const inMaze = new Uint8Array(n)
    const onFrontier = new Uint8Array(n)
    const frontier: number[] = []
    const addFrontier = (cell: number) => {
      const c = cell % this.cols, r = (cell / this.cols) | 0
      for (const d of DIRS) {
        const nc = c + d.dx, nr = r + d.dy
        if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue
        const ni = nr * this.cols + nc
        if (!inMaze[ni] && !onFrontier[ni]) { onFrontier[ni] = 1; frontier.push(ni) }
      }
    }
    inMaze[0] = 1
    addFrontier(0)
    while (frontier.length) {
      const idx = this.randInt(frontier.length)
      const cell = frontier[idx]
      frontier[idx] = frontier[frontier.length - 1]
      frontier.pop()
      onFrontier[cell] = 0
      const inNbrs = this.inMazeNeighbors(cell, inMaze)
      if (inNbrs.length) {
        const pick = inNbrs[this.randInt(inNbrs.length)]
        this.carve(cell, pick.cell, pick.dir)
      }
      inMaze[cell] = 1
      this.genHead = cell
      addFrontier(cell)
      yield
    }
    this.genHead = -1
  }

  private *genKruskal(): Iterator<void> {
    const n = this.cols * this.rows
    const parent = new Int32Array(n)
    for (let i = 0; i < n; i++) parent[i] = i
    const find = (x: number): number => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
      return x
    }
    const edges: { a: number; b: number; dir: typeof DIRS[number] }[] = []
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c
        if (c < this.cols - 1) edges.push({ a: i, b: i + 1, dir: DIRS[1] })
        if (r < this.rows - 1) edges.push({ a: i, b: i + this.cols, dir: DIRS[2] })
      }
    }
    // seeded Fisher–Yates shuffle
    for (let i = edges.length - 1; i > 0; i--) {
      const j = this.randInt(i + 1)
      const t = edges[i]; edges[i] = edges[j]; edges[j] = t
    }
    for (const e of edges) {
      const ra = find(e.a), rb = find(e.b)
      if (ra !== rb) {
        parent[ra] = rb
        this.carve(e.a, e.b, e.dir)
        this.genHead = e.b
        yield
      }
    }
    this.genHead = -1
  }

  /* ── solvers (each yields one node expansion) ── */

  private *solveBFS(): Iterator<void> {
    const q: number[] = [this.start]
    this.came[this.start] = this.start
    this.solveState[this.start] = FRONTIER
    let head = 0
    while (head < q.length) {
      const cur = q[head++]
      this.solveState[cur] = VISITED
      this.expanded++
      if (cur === this.goal) { this.buildPath(); return }
      for (const nb of this.openNeighbors(cur)) {
        if (this.came[nb] === -1) {
          this.came[nb] = cur
          this.solveState[nb] = FRONTIER
          q.push(nb)
        }
      }
      yield
    }
  }

  private *solveDFS(): Iterator<void> {
    const stack: number[] = [this.start]
    this.came[this.start] = this.start
    this.solveState[this.start] = FRONTIER
    while (stack.length) {
      const cur = stack.pop() as number
      if (this.solveState[cur] === VISITED) continue
      this.solveState[cur] = VISITED
      this.expanded++
      if (cur === this.goal) { this.buildPath(); return }
      for (const nb of this.openNeighbors(cur)) {
        if (this.came[nb] === -1) {
          this.came[nb] = cur
          this.solveState[nb] = FRONTIER
          stack.push(nb)
        }
      }
      yield
    }
  }

  private *solveAStar(): Iterator<void> {
    const g = this.gScore
    g.fill(Infinity)
    g[this.start] = 0
    const gc = this.goal % this.cols, gr = (this.goal / this.cols) | 0
    const h = (cell: number) => {
      const c = cell % this.cols, r = (cell / this.cols) | 0
      return Math.abs(c - gc) + Math.abs(r - gr)
    }
    const open: number[] = [this.start]
    this.came[this.start] = this.start
    this.solveState[this.start] = FRONTIER
    while (open.length) {
      // pick the open cell with the smallest f = g + h
      let bi = 0, bf = Infinity
      for (let k = 0; k < open.length; k++) {
        const f = g[open[k]] + h(open[k])
        if (f < bf) { bf = f; bi = k }
      }
      const cur = open.splice(bi, 1)[0]
      if (this.solveState[cur] === VISITED) continue
      this.solveState[cur] = VISITED
      this.expanded++
      if (cur === this.goal) { this.buildPath(); return }
      for (const nb of this.openNeighbors(cur)) {
        const t = g[cur] + 1
        if (t < g[nb]) {
          g[nb] = t
          this.came[nb] = cur
          if (this.solveState[nb] !== VISITED) this.solveState[nb] = FRONTIER
          open.push(nb)
        }
      }
      yield
    }
  }

  private buildPath() {
    const path: number[] = []
    let cur = this.goal
    if (this.came[this.goal] === -1 && this.goal !== this.start) { this.path = []; return }
    const guard = this.cols * this.rows + 2
    for (let i = 0; i < guard; i++) {
      path.push(cur)
      if (cur === this.start) break
      const p = this.came[cur]
      if (p < 0 || p === cur) break
      cur = p
    }
    path.reverse()
    this.path = path
  }

  /* ── animation driver ── */

  private stepsPerFrame() {
    return this.speedRaw
  }

  private beginGenerate(newSeed: boolean) {
    if (newSeed) {
      this.seed = Math.floor(Math.random() * 900000) + 100000
      const seedInput = this.querySelector('#mw-seed') as HTMLInputElement | null
      if (seedInput) seedInput.value = String(this.seed)
    }
    this.rnd = mulberry32(this.seed)
    const n = this.cols * this.rows
    this.cells = new Uint8Array(n).fill(15)
    this.resetSolveArrays(n)
    this.start = 0
    this.goal = n - 1
    this.genHead = -1
    this.phase = 'generating'
    this.iterKind = 'gen'
    this.iter =
      this.genId === 'prim' ? this.genPrim()
      : this.genId === 'kruskal' ? this.genKruskal()
      : this.genBacktracker()
  }

  private resetSolveArrays(n: number) {
    this.solveState = new Uint8Array(n)
    this.came = new Int32Array(n).fill(-1)
    this.gScore = new Float64Array(n)
    this.expanded = 0
    this.path = []
    this.pathDrawn = 0
  }

  private beginSolve() {
    if (!this.cells.length) return
    const n = this.cols * this.rows
    this.resetSolveArrays(n)
    this.phase = 'solving'
    this.iterKind = 'solve'
    this.iter =
      this.solveId === 'astar' ? this.solveAStar()
      : this.solveId === 'dfs' ? this.solveDFS()
      : this.solveBFS()
  }

  private reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  private startGenerate(newSeed: boolean) {
    this.beginGenerate(newSeed)
    if (this.reduced()) this.drainInstant()
    else this.setPlaying(true)
    this.draw()
    this.updateStats()
  }

  private startSolve() {
    if (this.phase === 'idle' || !this.cells.length) {
      // no maze yet — build one instantly, then solve
      this.beginGenerate(false)
      this.drainGenOnly()
    }
    this.beginSolve()
    if (this.reduced()) this.drainInstant()
    else this.setPlaying(true)
    this.draw()
    this.updateStats()
  }

  /** Run just the generator iterator to completion (used before an instant solve). */
  private drainGenOnly() {
    if (!this.iter) return
    let g = this.iter.next(), guard = 0
    while (!g.done && guard++ < 600000) g = this.iter.next()
    this.iter = null
    this.iterKind = null
    this.phase = 'generated'
  }

  /** Finish whatever iterator is active with no animation (reduced-motion path). */
  private drainInstant() {
    if (this.iter) {
      let g = this.iter.next(), guard = 0
      while (!g.done && guard++ < 600000) g = this.iter.next()
      this.onIterDone()
    }
    if (this.phase === 'pathing') {
      this.pathDrawn = this.path.length
      this.phase = 'solved'
    }
    this.setPlaying(false)
  }

  private onIterDone() {
    if (this.iterKind === 'gen') {
      this.iter = null
      this.iterKind = null
      this.phase = 'generated'
      this.setPlaying(false)
    } else if (this.iterKind === 'solve') {
      this.iter = null
      this.iterKind = null
      if (this.path.length) {
        this.phase = 'pathing'
        this.pathDrawn = 0
      } else {
        this.phase = 'solved'
        this.setPlaying(false)
      }
    }
  }

  private advance(steps: number) {
    if (this.phase === 'pathing') {
      this.pathDrawn = Math.min(this.path.length, this.pathDrawn + steps)
      if (this.pathDrawn >= this.path.length) { this.phase = 'solved'; this.setPlaying(false) }
      this.draw()
      this.updateStats()
      return
    }
    if (!this.iter) { this.setPlaying(false); return }
    for (let i = 0; i < steps; i++) {
      const r = this.iter.next()
      if (r.done) { this.onIterDone(); break }
    }
    this.draw()
    this.updateStats()
  }

  private setPlaying(on: boolean) {
    const animating = this.phase === 'generating' || this.phase === 'solving' || this.phase === 'pathing'
    this.playing = on && animating
    const btn = this.querySelector('[data-action="play"]') as HTMLButtonElement | null
    if (btn) {
      btn.textContent = this.playing ? 'Pause' : 'Resume'
      btn.setAttribute('aria-pressed', String(this.playing))
    }
    cancelAnimationFrame(this.raf)
    this.raf = 0
    if (this.playing) this.loop()
  }

  private loop = () => {
    if (!this.playing) return
    this.advance(this.stepsPerFrame())
    if (this.playing) this.raf = requestAnimationFrame(this.loop)
  }

  private step() {
    if (this.phase === 'pathing') { this.advance(1); return }
    if (!this.iter) {
      if (this.phase === 'idle' || !this.cells.length) this.beginGenerate(false)
      else this.beginSolve()
    }
    if (this.iter) {
      const r = this.iter.next()
      if (r.done) this.onIterDone()
    }
    // stepping is a paused mode
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.raf = 0
    const btn = this.querySelector('[data-action="play"]') as HTMLButtonElement | null
    if (btn) { btn.textContent = 'Resume'; btn.setAttribute('aria-pressed', 'false') }
    this.draw()
    this.updateStats()
  }

  private clearSolve() {
    this.setPlaying(false)
    const n = this.cols * this.rows
    this.resetSolveArrays(n)
    this.phase = this.cells.length ? 'generated' : 'idle'
    this.iter = null
    this.iterKind = null
    this.draw()
    this.updateStats()
  }

  /* ── rendering ── */

  private draw() {
    const { ctx } = this
    if (!ctx || !this.w) return
    ctx.globalAlpha = 1
    ctx.fillStyle = this.colBg
    ctx.fillRect(0, 0, this.w, this.h)
    if (!this.cells.length) return

    const cw = this.w / this.cols
    const ch = this.h / this.rows

    // explored / frontier fills
    for (let i = 0; i < this.solveState.length; i++) {
      const st = this.solveState[i]
      if (!st) continue
      const c = i % this.cols, r = (i / this.cols) | 0
      ctx.fillStyle = st === FRONTIER ? this.accentA(0.5) : this.accentA(0.2)
      ctx.fillRect(c * cw, r * ch, cw + 0.6, ch + 0.6)
    }

    // generation head
    if (this.phase === 'generating' && this.genHead >= 0) {
      const c = this.genHead % this.cols, r = (this.genHead / this.cols) | 0
      ctx.fillStyle = this.accentA(0.85)
      ctx.fillRect(c * cw, r * ch, cw + 0.6, ch + 0.6)
    }

    // walls (single batched path)
    ctx.strokeStyle = this.colWall
    ctx.lineWidth = Math.max(1, Math.round(this.dpr()))
    ctx.lineCap = 'square'
    ctx.beginPath()
    for (let i = 0; i < this.cells.length; i++) {
      const c = i % this.cols, r = (i / this.cols) | 0
      const x = Math.round(c * cw), y = Math.round(r * ch)
      const x2 = Math.round((c + 1) * cw), y2 = Math.round((r + 1) * ch)
      const cell = this.cells[i]
      if (cell & N) { ctx.moveTo(x, y); ctx.lineTo(x2, y) }
      if (cell & W) { ctx.moveTo(x, y); ctx.lineTo(x, y2) }
      if (cell & E) { ctx.moveTo(x2, y); ctx.lineTo(x2, y2) }
      if (cell & S) { ctx.moveTo(x, y2); ctx.lineTo(x2, y2) }
    }
    ctx.stroke()

    // path polyline
    if (this.pathDrawn > 0) {
      ctx.strokeStyle = this.colPath
      ctx.lineWidth = Math.max(2, Math.min(cw, ch) * 0.24)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      for (let k = 0; k < this.pathDrawn; k++) {
        const cell = this.path[k]
        const cx = (cell % this.cols + 0.5) * cw
        const cy = ((cell / this.cols | 0) + 0.5) * ch
        if (k === 0) ctx.moveTo(cx, cy)
        else ctx.lineTo(cx, cy)
      }
      ctx.stroke()
    }

    // start + goal markers
    this.marker(this.start, this.colStart, cw, ch)
    this.marker(this.goal, this.colGoal, cw, ch)
  }

  private marker(cell: number, color: string, cw: number, ch: number) {
    const cx = (cell % this.cols + 0.5) * cw
    const cy = ((cell / this.cols | 0) + 0.5) * ch
    const rad = Math.min(cw, ch) * 0.3
    const { ctx } = this
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(cx, cy, Math.max(2, rad), 0, Math.PI * 2)
    ctx.fill()
  }

  private updateStats() {
    if (!this.statusEl) return
    const total = this.cols * this.rows
    const solver = SOLVE_NAMES[this.solveId]
    let txt: string
    if (this.phase === 'generating') {
      txt = `Weaving with ${GEN_NAMES[this.genId]}…`
    } else if (this.phase === 'idle') {
      txt = 'Ready — press Solve to watch the search.'
    } else if (this.phase === 'generated') {
      txt = `Maze ready · ${this.cols}×${this.rows} · built with ${GEN_NAMES[this.genId]}. Press Solve.`
    } else {
      const parts = [solver, `explored ${this.expanded}/${total} cells`]
      if (this.path.length) parts.push(`path ${this.path.length} cells`)
      txt = (this.phase === 'solved' ? 'Solved · ' : 'Searching · ') + parts.join(' · ')
    }
    this.statusEl.textContent = txt
  }

  /* ── interaction ── */

  private wire() {
    this.querySelector('[data-action="generate"]')?.addEventListener('click', () => this.startGenerate(true))
    this.querySelector('[data-action="solve"]')?.addEventListener('click', () => this.startSolve())
    this.querySelector('[data-action="play"]')?.addEventListener('click', () => this.togglePlay())
    this.querySelector('[data-action="step"]')?.addEventListener('click', () => this.step())
    this.querySelector('[data-action="clear"]')?.addEventListener('click', () => this.clearSolve())
    this.querySelector('[data-action="download"]')?.addEventListener('click', () => this.download())
    this.querySelector('[data-action="copy-seed"]')?.addEventListener('click', () => this.copySeed())

    this.querySelectorAll<HTMLButtonElement>('[data-gen]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.gen as GenId
        if (!GEN_NAMES[id] || id === this.genId) { if (id === this.genId) this.startGenerate(false); return }
        this.genId = id
        localStorage.setItem(LS_GEN, id)
        this.querySelectorAll('[data-gen]').forEach(b =>
          b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.gen === id)))
        this.startGenerate(false) // rebuild the same seed with the new algorithm
      })
    })

    this.querySelectorAll<HTMLButtonElement>('[data-solver]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.solver as SolveId
        if (!SOLVE_NAMES[id]) return
        this.solveId = id
        localStorage.setItem(LS_SOLVER, id)
        this.querySelectorAll('[data-solver]').forEach(b =>
          b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.solver === id)))
        if (this.cells.length) this.startSolve() // re-run so you can compare solvers
      })
    })

    this.bindSlider('#mw-size', '#mw-size-out', LS_COLS,
      raw => { // live label only
        const cols = clamp(raw % 2 ? raw + 1 : raw, COLS_MIN, COLS_MAX)
        const rows = Math.max(6, Math.round(cols * ASPECT))
        return `${cols}×${rows}`
      },
      raw => { // commit on release
        this.cols = clamp(raw % 2 ? raw + 1 : raw, COLS_MIN, COLS_MAX)
        this.rows = Math.max(6, Math.round(this.cols * ASPECT))
        this.resize()
        this.startGenerate(false)
      })

    this.bindSlider('#mw-speed', '#mw-speed-out', LS_SPEED,
      raw => { this.speedRaw = clamp(raw, SPEED_MIN, SPEED_MAX); return `${this.speedRaw}/frame` })

    const seedInput = this.querySelector('#mw-seed') as HTMLInputElement
    const applySeed = () => {
      const n = parseInt(seedInput.value.replace(/[^0-9]/g, ''), 10)
      if (Number.isFinite(n) && n > 0) {
        this.seed = n
        this.startGenerate(false)
      } else {
        seedInput.value = String(this.seed)
      }
    }
    seedInput.addEventListener('change', applySeed)
    seedInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applySeed() } })

    this.canvas.addEventListener('pointerdown', e => this.onPick(e))
    this.canvas.addEventListener('keydown', e => this.onKey(e))
  }

  private bindSlider(
    inputSel: string,
    outSel: string,
    lsKey: string,
    onInput: (raw: number) => string,
    onChange?: (raw: number) => void,
  ) {
    const input = this.querySelector(inputSel) as HTMLInputElement
    const out = this.querySelector(outSel) as HTMLOutputElement | null
    input.addEventListener('input', () => {
      const raw = Number(input.value)
      const label = onInput(raw)
      if (out) out.textContent = label
      localStorage.setItem(lsKey, String(raw))
    })
    if (onChange) input.addEventListener('change', () => onChange(Number(input.value)))
  }

  private togglePlay() {
    const animating = this.phase === 'generating' || this.phase === 'solving' || this.phase === 'pathing'
    if (animating) this.setPlaying(!this.playing)
    else this.startSolve() // nothing to pause → treat as "go"
  }

  private onKey(e: KeyboardEvent) {
    switch (e.key) {
      case ' ': e.preventDefault(); this.togglePlay(); break
      case 'g': case 'G': e.preventDefault(); this.startGenerate(true); break
      case 's': case 'S': e.preventDefault(); this.step(); break
      case 'c': case 'C': e.preventDefault(); this.clearSolve(); break
      case 'd': case 'D': e.preventDefault(); this.download(); break
    }
  }

  private onPick(e: PointerEvent) {
    if (!this.cells.length) return
    const rect = this.canvas.getBoundingClientRect()
    const px = (e.clientX - rect.left) * (this.w / rect.width)
    const py = (e.clientY - rect.top) * (this.h / rect.height)
    const c = clamp(Math.floor(px / (this.w / this.cols)), 0, this.cols - 1)
    const r = clamp(Math.floor(py / (this.h / this.rows)), 0, this.rows - 1)
    const cell = r * this.cols + c
    this.canvas.focus()
    if (cell === this.start || cell === this.goal) return
    this.goal = cell
    this.startSolve()
  }

  private copySeed() {
    const btn = this.querySelector('[data-action="copy-seed"]') as HTMLButtonElement | null
    const text = String(this.seed)
    const done = () => flashLabel(btn, 'Copied')
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(done)
    else done()
  }

  private download() {
    try {
      const url = this.canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = `maze-${this.seed}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      /* toDataURL can throw on a tainted canvas — never tainted here (no external images) */
    }
  }
}

if (!customElements.get('maze-weaver-game')) {
  customElements.define('maze-weaver-game', MazeWeaverGame)
}

export {}
