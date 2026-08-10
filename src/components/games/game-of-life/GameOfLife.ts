/**
 * Game of Life — Conway's classic cellular automaton, fully interactive.
 *
 * Pure canvas 2D, zero dependencies. Click / drag to draw cells; play, pause,
 * step, clear, randomize; adjust speed; toggle edge wrapping; stamp in famous
 * patterns (glider, LWSS, pulsar, Gosper glider gun). Newly-born cells flash in
 * the accent colour for one generation so the patterns visibly "breathe".
 *
 * All colours are read from the theme tokens (theme.css) at mount — nothing is
 * hardcoded. Speed + wrap preference persist in localStorage. The animation loop
 * is torn down in disconnectedCallback so it never leaks across View Transitions.
 */

interface PatternDef {
  id: string
  name: string
  /** [col, row] offsets, normalised so the top-left of the bounding box is (0,0) */
  cells: [number, number][]
}

/* ── Famous patterns (col, row) ── */
const GLIDER: [number, number][] = [
  [1, 0], [2, 1], [0, 2], [1, 2], [2, 2],
]

// Lightweight spaceship — travels horizontally
const LWSS: [number, number][] = [
  [1, 0], [4, 0],
  [0, 1],
  [0, 2], [4, 2],
  [0, 3], [1, 3], [2, 3], [3, 3],
]

// Pulsar — period-3 oscillator (13×13)
const PULSAR: [number, number][] = (() => {
  const rows: Record<number, number[]> = {
    0: [2, 3, 4, 8, 9, 10],
    2: [0, 5, 7, 12],
    3: [0, 5, 7, 12],
    4: [0, 5, 7, 12],
    5: [2, 3, 4, 8, 9, 10],
    7: [2, 3, 4, 8, 9, 10],
    8: [0, 5, 7, 12],
    9: [0, 5, 7, 12],
    10: [0, 5, 7, 12],
    12: [2, 3, 4, 8, 9, 10],
  }
  const out: [number, number][] = []
  for (const r in rows) for (const c of rows[+r]) out.push([c, +r])
  return out
})()

// Gosper glider gun — first known infinite-growth pattern (36×9 bounding box)
const GOSPER_GUN: [number, number][] = [
  [0, 4], [0, 5], [1, 4], [1, 5],
  [10, 4], [10, 5], [10, 6], [11, 3], [11, 7], [12, 2], [12, 8], [13, 2], [13, 8],
  [14, 5], [15, 3], [15, 7], [16, 4], [16, 5], [16, 6], [17, 5],
  [20, 2], [20, 3], [20, 4], [21, 2], [21, 3], [21, 4], [22, 1], [22, 5],
  [24, 0], [24, 1], [24, 5], [24, 6],
  [34, 2], [34, 3], [35, 2], [35, 3],
]

const PATTERNS: PatternDef[] = [
  { id: 'glider', name: 'Glider', cells: GLIDER },
  { id: 'lwss', name: 'Spaceship', cells: LWSS },
  { id: 'pulsar', name: 'Pulsar', cells: PULSAR },
  { id: 'gun', name: 'Glider gun', cells: GOSPER_GUN },
]

const CELL_CSS = 16 // target cell size in CSS px
const MIN_SPEED = 1
const MAX_SPEED = 30
const LS_SPEED = 'gol:speed'
const LS_WRAP = 'gol:wrap'

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function patternWidth(p: PatternDef) {
  return Math.max(...p.cells.map(c => c[0])) + 1
}
function patternHeight(p: PatternDef) {
  return Math.max(...p.cells.map(c => c[1])) + 1
}

class GameOfLifeGame extends HTMLElement {
  private cols = 0
  private rows = 0
  private grid = new Uint8Array(0)
  private age = new Uint16Array(0) // generations a cell has been alive (for born-cell highlight)
  private next = new Uint8Array(0)

  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private ro?: ResizeObserver
  private raf = 0
  private lastTick = 0
  private playing = false
  private generation = 0
  private speed = 10 // generations / second
  private wrap = true

  // colours resolved from theme tokens at mount
  private colBg = '#111'
  private colCell = '#e8e8e8'
  private colBorn = '#2e4d8f'
  private colGrid = '#2a2a2a'

  // pointer-paint state
  private painting = false
  private paintValue = 1

  connectedCallback() {
    this.speed = clamp(Number(localStorage.getItem(LS_SPEED)) || 10, MIN_SPEED, MAX_SPEED)
    const storedWrap = localStorage.getItem(LS_WRAP)
    this.wrap = storedWrap === null ? true : storedWrap === '1'

    this.innerHTML = `
      <div data-type="gol-game">
        <div data-type="gol-header">
          <div data-type="gol-titlebar">
            <h1>Game of Life</h1>
            <span data-type="gol-badge">zero-player simulator</span>
          </div>
          <p>Plant a few cells, press play, and watch them live, die, and multiply. It isn't a game you win — it's a tiny universe that runs itself on four simple rules. Invented by mathematician John Conway in 1970, still hypnotic today.</p>
        </div>
        <div data-type="gol-stage">
          <canvas data-type="gol-canvas" tabindex="0" role="application"
            aria-label="Game of Life simulation grid — click or drag to toggle cells, space to play or pause"></canvas>
        </div>
        <div data-type="gol-controls">
          <div data-group="transport" role="group" aria-label="Playback">
            <button data-action="play" type="button" aria-pressed="false" title="Run / pause the simulation (space)">Play</button>
            <button data-action="step" type="button" title="Advance one generation (S)">Step</button>
            <button data-action="random" type="button" title="Fill with a random soup (R)">Random</button>
            <button data-action="clear" type="button" title="Empty the grid (C)">Clear</button>
          </div>
          <div data-group="speed">
            <label for="gol-speed">Speed</label>
            <input id="gol-speed" type="range" min="${MIN_SPEED}" max="${MAX_SPEED}" value="${this.speed}"
              aria-label="Generations per second" />
            <span data-type="gol-speed-val">${this.speed}/s</span>
          </div>
          <div data-group="patterns" role="group" aria-label="Starter patterns">
            <span data-type="gol-group-label">Drop in a pattern</span>
            ${PATTERNS.map(p => `<button data-pattern="${p.id}" type="button">${p.name}</button>`).join('')}
          </div>
          <div data-group="options">
            <label class="gol-toggle" title="Cells that leave one edge reappear on the opposite edge">
              <input id="gol-wrap" type="checkbox" ${this.wrap ? 'checked' : ''} />
              Wrap edges
            </label>
            <span data-type="gol-stats" aria-live="polite">Generation 0 · 0 cells</span>
          </div>
        </div>
        <details data-type="gol-explainer" open>
          <summary>New here? How the Game of Life works</summary>
          <p>Every square is a <strong>cell</strong> — either alive or empty. On each tick (a <em>generation</em>), all cells update at once based on how many of their 8 touching neighbors are alive:</p>
          <div data-type="gol-rules">
            <div data-type="gol-rule" data-kind="survive">
              <span data-type="gol-rule-tag">Survives</span>
              <span>A living cell with <strong>2 or 3</strong> live neighbors stays alive.</span>
            </div>
            <div data-type="gol-rule" data-kind="die">
              <span data-type="gol-rule-tag">Dies</span>
              <span>With too few (<strong>0–1</strong>) or too many (<strong>4+</strong>) neighbors, it dies.</span>
            </div>
            <div data-type="gol-rule" data-kind="born">
              <span data-type="gol-rule-tag">Born</span>
              <span>An empty cell with <strong>exactly 3</strong> neighbors comes to life.</span>
            </div>
          </div>
          <p data-type="gol-legend">Freshly-born cells flash <span data-type="gol-dot" data-kind="born"></span> accent, then settle into <span data-type="gol-dot" data-kind="alive"></span> solid as they survive.</p>
          <p data-type="gol-try"><strong>Try this:</strong> press <em>Clear</em>, tap <em>Glider</em>, drop the speed low, then press <em>Step</em> a few times — watch the little 5-cell shape walk diagonally across the grid. That "aha" is the whole game.</p>
        </details>
        <p data-type="gol-hint">Shortcuts: space = play/pause · S = step · R = randomize · C = clear.</p>
      </div>
    `

    this.canvas = this.querySelector('[data-type="gol-canvas"]') as HTMLCanvasElement
    this.ctx = this.canvas.getContext('2d')!
    this.readThemeColors()
    this.wire()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.querySelector('[data-type="gol-stage"]') as Element)
    requestAnimationFrame(() => {
      this.resize()
      // Open on a recognisable, eye-catching pattern so the page explains itself.
      this.seedDefault()
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (!reduced) this.setPlaying(true)
      else this.draw()
    })
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.ro?.disconnect()
  }

  private readThemeColors() {
    const cs = getComputedStyle(document.documentElement)
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
    this.colBg = v('--color-bg', '#111')
    this.colCell = v('--color-text', '#e8e8e8')
    this.colBorn = v('--color-accent', '#2e4d8f')
    this.colGrid = v('--color-border', '#2a2a2a')
  }

  private wire() {
    this.querySelector('[data-action="play"]')?.addEventListener('click', () => this.setPlaying(!this.playing))
    this.querySelector('[data-action="step"]')?.addEventListener('click', () => {
      this.setPlaying(false)
      this.step()
    })
    this.querySelector('[data-action="random"]')?.addEventListener('click', () => this.randomize(true))
    this.querySelector('[data-action="clear"]')?.addEventListener('click', () => this.clear())

    const speed = this.querySelector('#gol-speed') as HTMLInputElement
    speed.addEventListener('input', () => {
      this.speed = clamp(Number(speed.value), MIN_SPEED, MAX_SPEED)
      const out = this.querySelector('[data-type="gol-speed-val"]')
      if (out) out.textContent = `${this.speed}/s`
      localStorage.setItem(LS_SPEED, String(this.speed))
    })

    const wrap = this.querySelector('#gol-wrap') as HTMLInputElement
    wrap.addEventListener('change', () => {
      this.wrap = wrap.checked
      localStorage.setItem(LS_WRAP, this.wrap ? '1' : '0')
    })

    this.querySelectorAll<HTMLButtonElement>('[data-pattern]').forEach(btn => {
      btn.addEventListener('click', () => this.loadPattern(btn.dataset.pattern as string))
    })

    // Pointer drawing
    this.canvas.addEventListener('pointerdown', e => this.onPointerDown(e))
    this.canvas.addEventListener('pointermove', e => this.onPointerMove(e))
    this.canvas.addEventListener('pointerup', () => { this.painting = false })
    this.canvas.addEventListener('pointercancel', () => { this.painting = false })

    // Keyboard shortcuts (only while the canvas is focused, so page scroll is safe)
    this.canvas.addEventListener('keydown', e => this.onKey(e))
  }

  private onKey(e: KeyboardEvent) {
    switch (e.key) {
      case ' ': e.preventDefault(); this.setPlaying(!this.playing); break
      case 's': case 'S': e.preventDefault(); this.setPlaying(false); this.step(); break
      case 'r': case 'R': e.preventDefault(); this.randomize(true); break
      case 'c': case 'C': e.preventDefault(); this.clear(); break
    }
  }

  /* ── geometry ── */

  private dpr() {
    return Math.min(window.devicePixelRatio || 1, 2)
  }

  private resize() {
    const stage = this.querySelector('[data-type="gol-stage"]') as HTMLElement
    const cssW = stage.getBoundingClientRect().width
    if (cssW < 2) return
    const cols = Math.max(8, Math.floor(cssW / CELL_CSS))
    const rows = Math.max(8, Math.round(cols * 0.62))
    const cssH = Math.round((rows / cols) * cssW)

    const dpr = this.dpr()
    this.canvas.style.width = cssW + 'px'
    this.canvas.style.height = cssH + 'px'
    this.canvas.width = Math.round(cssW * dpr)
    this.canvas.height = Math.round(cssH * dpr)

    // Preserve existing cells on resize (top-left aligned)
    if (cols !== this.cols || rows !== this.rows) {
      const newGrid = new Uint8Array(cols * rows)
      const newAge = new Uint16Array(cols * rows)
      const copyCols = Math.min(cols, this.cols)
      const copyRows = Math.min(rows, this.rows)
      for (let r = 0; r < copyRows; r++) {
        for (let c = 0; c < copyCols; c++) {
          newGrid[r * cols + c] = this.grid[r * this.cols + c]
          newAge[r * cols + c] = this.age[r * this.cols + c]
        }
      }
      this.cols = cols
      this.rows = rows
      this.grid = newGrid
      this.age = newAge
      this.next = new Uint8Array(cols * rows)
    }
    this.draw()
  }

  /* ── simulation ── */

  private idx(c: number, r: number) {
    return r * this.cols + c
  }

  private step() {
    const { cols, rows, grid, next, age } = this
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let n = 0
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue
            let nc = c + dc
            let nr = r + dr
            if (this.wrap) {
              nc = (nc + cols) % cols
              nr = (nr + rows) % rows
            } else if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) {
              continue
            }
            n += grid[nr * cols + nc]
          }
        }
        const i = r * cols + c
        const alive = grid[i] === 1
        next[i] = (alive ? (n === 2 || n === 3) : n === 3) ? 1 : 0
      }
    }
    // commit + update ages
    for (let i = 0; i < next.length; i++) {
      if (next[i]) age[i] = grid[i] ? Math.min(age[i] + 1, 0xffff) : 1
      else age[i] = 0
    }
    this.grid.set(next)
    this.generation++
    this.draw()
    this.updateStats()
  }

  private setPlaying(on: boolean) {
    if (on === this.playing) return
    this.playing = on
    const btn = this.querySelector('[data-action="play"]') as HTMLButtonElement | null
    if (btn) {
      btn.textContent = on ? 'Pause' : 'Play'
      btn.setAttribute('aria-pressed', String(on))
    }
    if (on) {
      this.lastTick = performance.now()
      this.loop()
    } else {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    }
  }

  private loop = () => {
    if (!this.playing) return
    const now = performance.now()
    const interval = 1000 / this.speed
    if (now - this.lastTick >= interval) {
      this.lastTick = now - ((now - this.lastTick) % interval)
      this.step()
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  private randomize(resetGen: boolean) {
    for (let i = 0; i < this.grid.length; i++) {
      const v = Math.random() < 0.28 ? 1 : 0
      this.grid[i] = v
      this.age[i] = v
    }
    if (resetGen) this.generation = 0
    this.draw()
    this.updateStats()
  }

  private clear() {
    this.setPlaying(false)
    this.grid.fill(0)
    this.age.fill(0)
    this.generation = 0
    this.draw()
    this.updateStats()
  }

  /** Place a named pattern on a freshly-cleared grid. Returns false if unknown. */
  private stampPattern(id: string): boolean {
    const p = PATTERNS.find(x => x.id === id)
    if (!p) return false
    this.grid.fill(0)
    this.age.fill(0)
    const pw = patternWidth(p)
    const ph = patternHeight(p)
    // Centre most patterns; nudge the big gun toward the top-left so it has room to fire.
    let ox = Math.floor((this.cols - pw) / 2)
    let oy = Math.floor((this.rows - ph) / 2)
    if (id === 'gun') { ox = 1; oy = 1 }
    ox = Math.max(0, ox)
    oy = Math.max(0, oy)
    for (const [c, r] of p.cells) {
      const cc = ox + c
      const rr = oy + r
      if (cc >= 0 && cc < this.cols && rr >= 0 && rr < this.rows) {
        this.grid[this.idx(cc, rr)] = 1
        this.age[this.idx(cc, rr)] = 1
      }
    }
    this.generation = 0
    this.draw()
    this.updateStats()
    return true
  }

  private loadPattern(id: string) {
    this.setPlaying(false)
    if (this.stampPattern(id)) this.setPlaying(true)
  }

  /** Pick an eye-catching opening state that fits the current grid. */
  private seedDefault() {
    const dim = (id: string) => {
      const p = PATTERNS.find(x => x.id === id)!
      return [patternWidth(p), patternHeight(p)] as const
    }
    const [gw, gh] = dim('gun')
    const [uw, uh] = dim('pulsar')
    if (this.cols >= gw + 2 && this.rows >= gh + 2) this.stampPattern('gun')
    else if (this.cols >= uw && this.rows >= uh) this.stampPattern('pulsar')
    else this.randomize(false)
  }

  /* ── pointer ── */

  private cellFromEvent(e: PointerEvent): [number, number] | null {
    const rect = this.canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const cw = rect.width / this.cols
    const ch = rect.height / this.rows
    const c = Math.floor(x / cw)
    const r = Math.floor(y / ch)
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return null
    return [c, r]
  }

  private onPointerDown(e: PointerEvent) {
    const cell = this.cellFromEvent(e)
    if (!cell) return
    this.canvas.focus()
    this.canvas.setPointerCapture(e.pointerId)
    const i = this.idx(cell[0], cell[1])
    this.paintValue = this.grid[i] ? 0 : 1
    this.painting = true
    this.applyPaint(i)
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.painting) return
    const cell = this.cellFromEvent(e)
    if (!cell) return
    this.applyPaint(this.idx(cell[0], cell[1]))
  }

  private applyPaint(i: number) {
    if (this.grid[i] === this.paintValue) return
    this.grid[i] = this.paintValue
    this.age[i] = this.paintValue
    this.draw()
    this.updateStats()
  }

  /* ── render ── */

  private updateStats() {
    let pop = 0
    for (let i = 0; i < this.grid.length; i++) pop += this.grid[i]
    const out = this.querySelector('[data-type="gol-stats"]')
    if (out) out.textContent = `Generation ${this.generation} · ${pop} cell${pop === 1 ? '' : 's'}`
  }

  private draw() {
    const { ctx, canvas, cols, rows } = this
    const W = canvas.width
    const H = canvas.height
    ctx.fillStyle = this.colBg
    ctx.fillRect(0, 0, W, H)

    const cw = W / cols
    const ch = H / rows

    // grid lines (only when cells are roomy enough to keep it subtle)
    if (cw > 6) {
      ctx.strokeStyle = this.colGrid
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let c = 0; c <= cols; c++) {
        const x = Math.round(c * cw) + 0.5
        ctx.moveTo(x, 0)
        ctx.lineTo(x, H)
      }
      for (let r = 0; r <= rows; r++) {
        const y = Math.round(r * ch) + 0.5
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
      }
      ctx.stroke()
    }

    const gap = cw > 8 ? 1 : 0
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        if (!this.grid[i]) continue
        ctx.fillStyle = this.age[i] <= 1 ? this.colBorn : this.colCell
        ctx.fillRect(Math.round(c * cw) + gap, Math.round(r * ch) + gap, Math.ceil(cw) - gap, Math.ceil(ch) - gap)
      }
    }
  }
}

if (!customElements.get('game-of-life-game')) {
  customElements.define('game-of-life-game', GameOfLifeGame)
}

export {}
