/**
 * 2048 — the classic sliding-tile puzzle on a 2D canvas, zero dependencies.
 *
 * Slide the whole board with the arrow keys (or WASD, or a swipe); every tile
 * shoves as far as it can in that direction, and two tiles of the same number
 * that collide fuse into one worth double. Every move drops a fresh 2 (or,
 * one time in ten, a 4) onto a random empty cell — so the board keeps filling
 * and the challenge is to keep merging faster than it clogs. Reach a 2048 tile
 * to win; you can keep going for a higher score until there are no moves left.
 *
 * Depth beyond a bare clone: three board sizes (3×3 / 4×4 / 5×5), each with its
 * own saved game AND its own best score; a multi-step Undo; smooth slide + merge
 * + spawn animation (skipped under prefers-reduced-motion); win / game-over
 * overlays with "keep going"; keyboard, on-screen buttons and touch swipe; and
 * the full game (board, score, best, win state) persisted to localStorage per
 * size so a refresh resumes exactly where you left off.
 *
 * Board chrome (background, grid, empty cells, number text) resolves from the
 * theme tokens (theme.css) so it re-themes with the site; the tile fills are a
 * ramp blended from the resolved --color-surface/--color-text/--color-accent up
 * to a warm gold, so the palette tracks the accent token too. The RAF loop only
 * runs while an animation is in flight and is torn down in disconnectedCallback,
 * so it never leaks across View Transitions.
 *
 * Every module-level name is prefixed `tw`/`TW_` on purpose: the game component
 * files share a global TS script scope, so unprefixed names (clamp, lerp,
 * PALETTES…) would collide with the other games at `astro check` time.
 */

const TW_SIZES = [3, 4, 5] as const
type TwSize = (typeof TW_SIZES)[number]

const TW_DEFAULT_SIZE: TwSize = 4
const TW_WIN_VALUE = 2048
const TW_UNDO_DEPTH = 16

// Animation timing (ms). Slide first, then merged/spawned tiles pop.
const TW_SLIDE_MS = 95
const TW_POP_MS = 95

const TW_LS_SIZE = 'tw:size'
const twBestKey = (n: number) => `tw:best:${n}`
const twStateKey = (n: number) => `tw:state:${n}`

type TwDir = 'up' | 'down' | 'left' | 'right'
const TW_VECTORS: Record<TwDir, { r: number; c: number }> = {
  up: { r: -1, c: 0 },
  down: { r: 1, c: 0 },
  left: { r: 0, c: -1 },
  right: { r: 0, c: 1 },
}

interface TwTile {
  id: number
  value: number
  row: number
  col: number
  prevRow: number | null   // where it started this move (for the slide)
  prevCol: number | null
  mergedFrom: [TwTile, TwTile] | null  // the two tiles that fused into this one
  justSpawned: boolean
}

interface TwSaved {
  grid: number[][]
  score: number
  won: boolean       // has a 2048 tile ever appeared
  keepGoing: boolean // player chose to continue past the win
}

function twClamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function twEaseOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

/* Parse #rgb / #rrggbb to an [r,g,b] triple (theme tokens are hex). */
function twToRGB(input: string): [number, number, number] | null {
  let s = input.trim()
  if (!s.startsWith('#')) return null
  if (s.length === 4) s = '#' + [...s.slice(1)].map(c => c + c).join('')
  const r = parseInt(s.slice(1, 3), 16)
  const g = parseInt(s.slice(3, 5), 16)
  const b = parseInt(s.slice(5, 7), 16)
  return [r, g, b].every(n => !Number.isNaN(n)) ? [r, g, b] : null
}

function twMix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/* Relative luminance (0..1), good enough to pick light-vs-dark number text. */
function twLuminance([r, g, b]: [number, number, number]) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

class Twenty48Game extends HTMLElement {
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private overlay!: HTMLElement
  private ro?: ResizeObserver
  private raf = 0

  private w = 0   // device-pixel canvas size (square)

  private size: TwSize = TW_DEFAULT_SIZE
  private cells: (TwTile | null)[][] = []
  private tiles: TwTile[] = []
  private nextId = 1
  private score = 0
  private best = 0
  private won = false
  private keepGoing = false
  private over = false

  private history: TwSaved[] = []

  // animation
  private animating = false
  private animStart = 0

  // resolved theme colours
  private bgRGB: [number, number, number] = [11, 15, 24]
  private emptyRGB: [number, number, number] = [20, 26, 40]
  private gridRGB: [number, number, number] = [26, 33, 50]
  private lowRGB: [number, number, number] = [40, 48, 66]
  private accentRGB: [number, number, number] = [155, 140, 255]
  private goldRGB: [number, number, number] = [255, 207, 90]
  private fontFamily = 'monospace'

  // touch / swipe
  private ptrDownX = 0
  private ptrDownY = 0
  private ptrDown = false

  connectedCallback() {
    const savedSize = Number(this.readLS(TW_LS_SIZE))
    this.size = (TW_SIZES as readonly number[]).includes(savedSize) ? (savedSize as TwSize) : TW_DEFAULT_SIZE

    this.innerHTML = `
      <div data-type="tw-game">
        <div data-type="tw-header">
          <div data-type="tw-titlebar">
            <h1>2048</h1>
            <span data-type="tw-badge">sliding puzzle</span>
          </div>
          <p>Slide the board with the arrow keys, WASD or a swipe — every tile shoves as far as it can, and two equal numbers that meet fuse into one worth double. Each move drops a new tile, so keep merging before the board clogs. Get a tile to 2048 to win, then keep going for a higher score.</p>
        </div>
        <div data-type="tw-scores">
          <div data-type="tw-score">
            <span>Score</span>
            <output id="tw-score" aria-live="off">0</output>
          </div>
          <div data-type="tw-score">
            <span>Best</span>
            <output id="tw-best">0</output>
          </div>
        </div>
        <div data-type="tw-stage">
          <canvas data-type="tw-canvas" tabindex="0" role="img"
            aria-label="2048 puzzle board. Click or tap the board, then use the arrow keys or WASD to slide the tiles; on a touch screen, swipe."></canvas>
          <div data-type="tw-overlay" hidden>
            <p data-type="tw-overlay-msg" id="tw-overlay-msg"></p>
            <div data-type="tw-overlay-actions">
              <button data-action="keepgoing" type="button" hidden>Keep going</button>
              <button data-action="again" type="button">New game</button>
            </div>
          </div>
        </div>
        <div data-type="tw-controls">
          <div data-group="transport" role="group" aria-label="Actions">
            <button data-action="new" type="button" title="Start a fresh board (N)">New game</button>
            <button data-action="undo" type="button" title="Take back the last move (U)">Undo</button>
          </div>
          <div data-group="size" role="group" aria-label="Board size">
            <span data-type="tw-group-label">Size</span>
            ${TW_SIZES.map(n => `
              <button data-size="${n}" type="button" aria-pressed="${n === this.size}" title="${n}×${n} board">${n}×${n}</button>`).join('')}
          </div>
        </div>
        <p data-type="tw-status" role="status" aria-live="polite"></p>
        <details data-type="tw-explainer">
          <summary>How to play</summary>
          <p>Press an <strong>arrow key</strong> (or <strong>W A S D</strong>, or swipe on a touch screen) and the whole board slides that way at once. Every tile travels until it hits a wall or another tile; when a moving tile meets one showing the <strong>same number</strong>, the two <strong>merge</strong> into a single tile worth their sum, and that sum is added to your score. A tile can only merge once per move.</p>
          <p>After every move that changed something, a new tile appears on a random empty cell — a <strong>2</strong> nine times out of ten, a <strong>4</strong> the rest. The board fills relentlessly, so the game is a race to fuse pairs faster than the empty cells run out. It ends when no move can slide or merge anything.</p>
          <p data-type="tw-try"><strong>Strategy:</strong> pick one corner and keep your biggest tile pinned there — favour two directions (say, down and right) and only break the pattern when you must. Each board <strong>size</strong> keeps its own game and its own best score.</p>
        </details>
        <p data-type="tw-hint">Shortcuts: arrow keys / WASD = slide · U = undo · N = new game. Click the board first so it has focus; on touch, just swipe.</p>
      </div>
    `

    this.canvas = this.querySelector('[data-type="tw-canvas"]') as HTMLCanvasElement
    this.ctx = this.canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
    this.overlay = this.querySelector('[data-type="tw-overlay"]') as HTMLElement
    this.best = Number(this.readLS(twBestKey(this.size))) || 0
    this.readTheme()
    this.wire()
    this.setText('#tw-best', String(this.best))

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.querySelector('[data-type="tw-stage"]') as Element)

    this.raf = requestAnimationFrame(() => {
      if (!this.isConnected) return
      this.resize()
      if (!this.loadState()) this.newGame(false)
      else this.refreshHud()
      this.drawStatic()
    })
  }

  disconnectedCallback() {
    this.animating = false
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.ro?.disconnect()
  }

  /* ── theme ── */

  private readTheme() {
    const cs = getComputedStyle(document.documentElement)
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
    this.bgRGB = twToRGB(v('--color-surface', '#0b0f18')) || [11, 15, 24]
    const pageBg = twToRGB(v('--color-bg', '#05070c')) || [5, 7, 12]
    const text = twToRGB(v('--color-text', '#dde6f2')) || [221, 230, 242]
    this.accentRGB = twToRGB(v('--color-accent', '#9b8cff')) || [155, 140, 255]
    // empty-cell + gridline tones sit between the page bg and the board surface
    this.emptyRGB = twMix(this.bgRGB, text, 0.06)
    this.gridRGB = twMix(this.bgRGB, pageBg, 0.55)
    // the "2" tile is a subtle lift off the board; higher tiles ramp to accent→gold
    this.lowRGB = twMix(this.bgRGB, text, 0.16)
    this.fontFamily = v('--font-mono', 'ui-monospace, monospace')
  }

  /** Fill for a tile of the given value: low → accent → warm gold as it grows. */
  private tileFill(value: number): [number, number, number] {
    const e = Math.log2(value)              // 2→1, 4→2, … 2048→11
    const t = twClamp((e - 1) / 10, 0, 1)   // 0 at "2", 1 at "2048"
    let col: [number, number, number]
    if (t <= 0.6) col = twMix(this.lowRGB, this.accentRGB, t / 0.6)
    else col = twMix(this.accentRGB, this.goldRGB, (t - 0.6) / 0.4)
    // tiles beyond 2048 keep warming toward gold/white so they stay distinct
    if (e > 11) col = twMix(col, [255, 245, 210], twClamp((e - 11) / 5, 0, 0.6))
    return col
  }

  /* ── geometry ── */

  private dpr() {
    return Math.min(window.devicePixelRatio || 1, 2)
  }

  private resize() {
    const stage = this.querySelector('[data-type="tw-stage"]') as HTMLElement
    const cssW = stage.getBoundingClientRect().width
    if (cssW < 2) return
    const dpr = this.dpr()
    this.canvas.style.height = cssW + 'px'   // square board
    const newW = Math.round(cssW * dpr)
    if (newW === this.w) return
    this.w = this.canvas.width = newW
    this.canvas.height = newW
    if (!this.animating) this.drawStatic()
  }

  /* ── board model ── */

  private empty(): (TwTile | null)[][] {
    return Array.from({ length: this.size }, () => new Array(this.size).fill(null))
  }

  private eachEmptyCell(): { r: number; c: number }[] {
    const out: { r: number; c: number }[] = []
    for (let r = 0; r < this.size; r++)
      for (let c = 0; c < this.size; c++)
        if (!this.cells[r][c]) out.push({ r, c })
    return out
  }

  private spawnRandom(): TwTile | null {
    const spots = this.eachEmptyCell()
    if (!spots.length) return null
    const { r, c } = spots[(Math.random() * spots.length) | 0]
    const value = Math.random() < 0.9 ? 2 : 4
    const tile: TwTile = { id: this.nextId++, value, row: r, col: c, prevRow: null, prevCol: null, mergedFrom: null, justSpawned: true }
    this.cells[r][c] = tile
    this.tiles.push(tile)
    return tile
  }

  private rebuildTilesFromCells() {
    this.tiles = []
    for (let r = 0; r < this.size; r++)
      for (let c = 0; c < this.size; c++)
        if (this.cells[r][c]) this.tiles.push(this.cells[r][c] as TwTile)
  }

  private snapshot(): TwSaved {
    const grid = Array.from({ length: this.size }, (_, r) =>
      Array.from({ length: this.size }, (_, c) => (this.cells[r][c]?.value ?? 0)))
    return { grid, score: this.score, won: this.won, keepGoing: this.keepGoing }
  }

  private restore(s: TwSaved) {
    this.cells = this.empty()
    this.tiles = []
    for (let r = 0; r < this.size; r++)
      for (let c = 0; c < this.size; c++) {
        const val = s.grid[r]?.[c] ?? 0
        if (val > 0) this.cells[r][c] = { id: this.nextId++, value: val, row: r, col: c, prevRow: null, prevCol: null, mergedFrom: null, justSpawned: false }
      }
    this.rebuildTilesFromCells()
    this.score = s.score
    this.won = s.won
    this.keepGoing = s.keepGoing
    this.over = false
  }

  /* ── game lifecycle ── */

  private newGame(announce = true) {
    this.cells = this.empty()
    this.tiles = []
    this.score = 0
    this.won = false
    this.keepGoing = false
    this.over = false
    this.history = []
    this.spawnRandom()
    this.spawnRandom()
    this.hideOverlay()
    this.refreshHud()
    this.saveState()
    if (announce) this.announce('New game.')
    this.startAnim()
  }

  private newGameFromButton() {
    this.newGame(true)
  }

  /* ── move ── */

  private prepare() {
    for (const t of this.tiles) {
      t.prevRow = t.row
      t.prevCol = t.col
      t.mergedFrom = null
      t.justSpawned = false
    }
  }

  private findFarthest(r: number, c: number, v: { r: number; c: number }) {
    let pr = r, pc = c
    let nr = r + v.r, nc = c + v.c
    while (nr >= 0 && nr < this.size && nc >= 0 && nc < this.size && !this.cells[nr][nc]) {
      pr = nr; pc = nc; nr += v.r; nc += v.c
    }
    const nextInBounds = nr >= 0 && nr < this.size && nc >= 0 && nc < this.size
    return { far: { r: pr, c: pc }, next: nextInBounds ? { r: nr, c: nc } : null }
  }

  private move(dir: TwDir) {
    if (this.animating || this.over) return
    const v = TW_VECTORS[dir]
    const before = this.snapshot()
    this.prepare()

    // traverse against the direction of travel so leading tiles settle first
    const rows = [...Array(this.size).keys()]
    const cols = [...Array(this.size).keys()]
    if (v.r === 1) rows.reverse()
    if (v.c === 1) cols.reverse()

    let moved = false
    let gained = 0
    let madeWin = false

    for (const r of rows) {
      for (const c of cols) {
        const tile = this.cells[r][c]
        if (!tile) continue
        const { far, next } = this.findFarthest(r, c, v)
        const target = next ? this.cells[next.r][next.c] : null
        if (target && target.value === tile.value && !target.mergedFrom) {
          // merge: a new doubled tile takes the cell; both sources animate into it
          const merged: TwTile = {
            id: this.nextId++, value: tile.value * 2, row: next.r, col: next.c,
            prevRow: null, prevCol: null, mergedFrom: [tile, target], justSpawned: false,
          }
          this.cells[next.r][next.c] = merged
          this.cells[r][c] = null
          tile.row = next.r; tile.col = next.c
          gained += merged.value
          if (merged.value === TW_WIN_VALUE) madeWin = true
          moved = true
        } else if (far.r !== r || far.c !== c) {
          this.cells[r][c] = null
          this.cells[far.r][far.c] = tile
          tile.row = far.r; tile.col = far.c
          moved = true
        }
      }
    }

    if (!moved) return

    this.rebuildTilesFromCells()
    this.score += gained
    this.pushHistory(before)
    this.spawnRandom()
    this.refreshHud()
    this.saveState()

    if (madeWin && !this.won) {
      this.won = true
      this.announce(`You made 2048! Score ${this.score}. Keep going for more, or start a new game.`)
      this.startAnim(() => this.showOverlay('You win!', true))
    } else {
      if (gained > 0) this.announce(`Merged for ${gained}. Score ${this.score}.`)
      this.startAnim(() => {
        if (!this.movesAvailable()) {
          this.over = true
          this.announce(`No moves left. Final score ${this.score}.`)
          this.showOverlay('Game over', false)
        }
      })
    }
  }

  private movesAvailable(): boolean {
    if (this.eachEmptyCell().length) return true
    for (let r = 0; r < this.size; r++)
      for (let c = 0; c < this.size; c++) {
        const val = this.cells[r][c]?.value
        if (val === this.cells[r]?.[c + 1]?.value) return true
        if (val === this.cells[r + 1]?.[c]?.value) return true
      }
    return false
  }

  /* ── undo ── */

  private pushHistory(s: TwSaved) {
    this.history.push(s)
    if (this.history.length > TW_UNDO_DEPTH) this.history.shift()
  }

  private undo() {
    if (this.animating || !this.history.length) return
    const s = this.history.pop() as TwSaved
    this.restore(s)
    this.hideOverlay()
    this.refreshHud()
    this.saveState()
    this.announce(`Move taken back. Score ${this.score}.`)
    this.drawStatic()
  }

  /* ── HUD + overlay ── */

  private refreshHud() {
    if (this.score > this.best) {
      this.best = this.score
      this.writeLS(twBestKey(this.size), String(this.best))
    }
    this.setText('#tw-score', String(this.score))
    this.setText('#tw-best', String(this.best))
    const undoBtn = this.querySelector('[data-action="undo"]') as HTMLButtonElement | null
    if (undoBtn) undoBtn.disabled = this.history.length === 0
  }

  private showOverlay(msg: string, isWin: boolean) {
    const msgEl = this.querySelector('#tw-overlay-msg') as HTMLElement
    const keep = this.querySelector('[data-action="keepgoing"]') as HTMLButtonElement
    msgEl.textContent = isWin ? `${msg} Score ${this.score}` : `${msg} — score ${this.score}`
    keep.hidden = !isWin
    this.overlay.removeAttribute('hidden')
    this.overlay.setAttribute('data-state', isWin ? 'win' : 'over')
  }

  private hideOverlay() {
    this.overlay.setAttribute('hidden', '')
    this.overlay.removeAttribute('data-state')
  }

  private announce(text: string) {
    this.setText('[data-type="tw-status"]', text)
  }

  private setText(sel: string, text: string) {
    const el = this.querySelector(sel)
    if (el) el.textContent = text
  }

  /* ── size switch ── */

  private setSize(n: TwSize) {
    if (n === this.size) return
    // remember the current board, then load (or start) the target size's board
    this.saveState()
    this.size = n
    this.writeLS(TW_LS_SIZE, String(n))
    this.best = Number(this.readLS(twBestKey(n))) || 0
    this.history = []
    this.querySelectorAll('[data-size]').forEach(b =>
      b.setAttribute('aria-pressed', String(Number((b as HTMLElement).dataset.size) === n)))
    this.hideOverlay()
    if (!this.loadState()) this.newGame(false)
    else this.refreshHud()
    this.announce(`${n}×${n} board.`)
    this.startAnim()
  }

  /* ── persistence ── */

  private saveState() {
    try { localStorage.setItem(twStateKey(this.size), JSON.stringify(this.snapshot())) } catch { /* ignore */ }
  }

  private loadState(): boolean {
    const raw = this.readLS(twStateKey(this.size))
    if (!raw) return false
    try {
      const s = JSON.parse(raw) as TwSaved
      if (!Array.isArray(s.grid) || s.grid.length !== this.size) return false
      this.restore(s)
      // if the restored board is dead, surface the overlay so it isn't a silent lock
      if (!this.movesAvailable()) { this.over = true; this.showOverlay('Game over', false) }
      else this.hideOverlay()
      return true
    } catch { return false }
  }

  private readLS(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  }

  private writeLS(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* ignore quota / private-mode */ }
  }

  /* ── input ── */

  private wire() {
    this.querySelector('[data-action="new"]')?.addEventListener('click', () => { this.newGameFromButton(); this.canvas.focus() })
    this.querySelector('[data-action="undo"]')?.addEventListener('click', () => this.undo())
    this.querySelector('[data-action="again"]')?.addEventListener('click', () => { this.newGameFromButton(); this.canvas.focus() })
    this.querySelector('[data-action="keepgoing"]')?.addEventListener('click', () => {
      this.keepGoing = true
      this.hideOverlay()
      this.saveState()
      this.canvas.focus()
    })

    this.querySelectorAll<HTMLButtonElement>('[data-size]').forEach(btn => {
      btn.addEventListener('click', () => this.setSize(Number(btn.dataset.size) as TwSize))
    })

    this.canvas.addEventListener('keydown', e => this.onKey(e))
    this.canvas.addEventListener('pointerdown', e => this.onPointerDown(e))
    this.canvas.addEventListener('pointerup', e => this.onPointerUp(e))
  }

  private onKey(e: KeyboardEvent) {
    const k = e.key
    let dir: TwDir | null = null
    if (k === 'ArrowUp' || k === 'w' || k === 'W') dir = 'up'
    else if (k === 'ArrowDown' || k === 's' || k === 'S') dir = 'down'
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') dir = 'left'
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') dir = 'right'
    else if (k === 'u' || k === 'U') { e.preventDefault(); this.undo(); return }
    else if (k === 'n' || k === 'N') { e.preventDefault(); this.newGameFromButton(); return }
    if (dir) { e.preventDefault(); this.move(dir) }
  }

  private onPointerDown(e: PointerEvent) {
    this.canvas.focus()
    this.ptrDown = true
    this.ptrDownX = e.clientX
    this.ptrDownY = e.clientY
  }

  private onPointerUp(e: PointerEvent) {
    if (!this.ptrDown) return
    this.ptrDown = false
    const dx = e.clientX - this.ptrDownX
    const dy = e.clientY - this.ptrDownY
    const adx = Math.abs(dx), ady = Math.abs(dy)
    const threshold = 24
    if (Math.max(adx, ady) < threshold) return  // a tap, not a swipe
    if (adx > ady) this.move(dx > 0 ? 'right' : 'left')
    else this.move(dy > 0 ? 'down' : 'up')
  }

  /* ── animation loop ── */

  private startAnim(onDone?: () => void) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || this.w < 2) {
      this.drawStatic()
      onDone?.()
      return
    }
    this.animating = true
    this.animStart = performance.now()
    cancelAnimationFrame(this.raf)
    const total = TW_SLIDE_MS + TW_POP_MS
    const loop = (now: number) => {
      if (!this.isConnected) { this.animating = false; return }
      const elapsed = now - this.animStart
      this.render(Math.min(elapsed, total))
      if (elapsed < total) {
        this.raf = requestAnimationFrame(loop)
      } else {
        this.animating = false
        this.drawStatic()
        onDone?.()
      }
    }
    this.raf = requestAnimationFrame(loop)
  }

  /* ── drawing ── */

  private drawStatic() {
    // final resting state: every live tile at its cell, full scale
    this.render(TW_SLIDE_MS + TW_POP_MS)
  }

  private render(elapsed: number) {
    if (this.w < 2) return
    const slide = twEaseOutCubic(twClamp(elapsed / TW_SLIDE_MS, 0, 1))
    const pop = twClamp((elapsed - TW_SLIDE_MS) / TW_POP_MS, 0, 1)
    const N = this.size
    const board = this.w
    const gap = Math.max(4, Math.round(board * (N === 5 ? 0.02 : 0.028)))
    const cell = (board - gap * (N + 1)) / N
    const radius = Math.max(3, cell * 0.09)

    const { ctx } = this
    // board background
    ctx.fillStyle = this.rgb(this.bgRGB)
    ctx.fillRect(0, 0, board, board)

    // empty-cell slots
    ctx.fillStyle = this.rgb(this.emptyRGB)
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        this.roundRect(gap + c * (cell + gap), gap + r * (cell + gap), cell, cell, radius, this.rgb(this.emptyRGB))

    const cellX = (c: number) => gap + c * (cell + gap)
    const cellY = (r: number) => gap + r * (cell + gap)

    for (const t of this.tiles) {
      if (t.mergedFrom) {
        if (slide < 1) {
          // draw the two source tiles sliding into the merge cell
          for (const src of t.mergedFrom) {
            const fr = src.prevRow ?? src.row
            const fc = src.prevCol ?? src.col
            const x = cellX(fc + (t.col - fc) * slide)
            const y = cellY(fr + (t.row - fr) * slide)
            this.drawTile(x, y, cell, radius, src.value, 1)
          }
        } else {
          // slide done — pop the merged result
          const scale = 1 + 0.16 * Math.sin(Math.PI * pop)
          this.drawTile(cellX(t.col), cellY(t.row), cell, radius, t.value, scale)
        }
      } else if (t.justSpawned) {
        if (slide >= 1) this.drawTile(cellX(t.col), cellY(t.row), cell, radius, t.value, twEaseOutCubic(pop))
      } else {
        const fr = t.prevRow ?? t.row
        const fc = t.prevCol ?? t.col
        const x = cellX(fc + (t.col - fc) * slide)
        const y = cellY(fr + (t.row - fr) * slide)
        this.drawTile(x, y, cell, radius, t.value, 1)
      }
    }
  }

  private drawTile(x: number, y: number, cell: number, radius: number, value: number, scale: number) {
    const { ctx } = this
    const fill = this.tileFill(value)
    // scale about the cell centre for pop/spawn
    const cx = x + cell / 2
    const cy = y + cell / 2
    const s = cell * scale
    const ox = cx - s / 2
    const oy = cy - s / 2
    this.roundRect(ox, oy, s, s, radius * scale, this.rgb(fill))

    // number, sized to fit the digit count, contrast-aware colour
    const str = String(value)
    let f = cell * (str.length <= 2 ? 0.44 : str.length === 3 ? 0.36 : str.length === 4 ? 0.28 : 0.22)
    f *= scale
    ctx.font = `700 ${f}px ${this.fontFamily}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = twLuminance(fill) > 0.6 ? '#0b0f18' : '#ffffff'
    ctx.fillText(str, cx, cy + f * 0.04)
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number, fill: string) {
    const { ctx } = this
    const rr = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.arcTo(x + w, y, x + w, y + h, rr)
    ctx.arcTo(x + w, y + h, x, y + h, rr)
    ctx.arcTo(x, y + h, x, y, rr)
    ctx.arcTo(x, y, x + w, y, rr)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
  }

  private rgb([r, g, b]: [number, number, number]) {
    return `rgb(${r | 0},${g | 0},${b | 0})`
  }
}

if (!customElements.get('twenty48-game')) {
  customElements.define('twenty48-game', Twenty48Game)
}

export {}
