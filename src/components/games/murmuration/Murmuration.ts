/**
 * Murmuration — an interactive boids / flocking simulation on a 2D canvas,
 * zero dependencies.
 *
 * Each dot is a "boid" that follows Craig Reynolds' three steering rules against
 * the flockmates it can see: SEPARATION (veer off before you collide),
 * ALIGNMENT (turn to match the heading of your neighbours) and COHESION (drift
 * toward the middle of the group). No boid is told where the flock should go —
 * the swirling, splitting, re-merging murmuration is what emerges when a few
 * hundred of them each obey those local rules at once.
 *
 * The three rule strengths are live sliders, so you can dial from a rigid marching
 * grid (all alignment) to a tight nervous ball (all cohesion) to a scattering
 * gas (all separation). Count, top Speed and Vision (how far each boid sees) are
 * tunable too. The pointer is a force: set it to Attract and the flock chases the
 * cursor, set it to Avoid and it flees like you're a hawk, and a click always
 * fires a startle burst that scatters the birds near it. Trails smear each boid
 * into a streak so the flow of the flock is legible.
 *
 * Neighbour lookups use a spatial hash grid (cell = vision radius, 3×3 query) so
 * several hundred boids stay smooth instead of the naive O(n²) every-pair scan.
 *
 * All colours resolve from the theme tokens (theme.css) for the "Theme" palette,
 * so re-theming needs no JS change. Respects prefers-reduced-motion (settles a
 * still frame, then stays paused). The RAF loop is torn down in
 * disconnectedCallback so it never leaks across View Transitions.
 *
 * Every module-level name is prefixed `bo`/`BO_` on purpose: the game component
 * files share a global TS script scope, so unprefixed names (clamp, toRGB,
 * PALETTES, LS_*…) would collide with the other games at `astro check` time.
 */

import { attachCanvasExport } from '../../../lib/canvas-export'

interface BoPalette {
  id: string
  name: string
  colors: string[]
}

/* Curated palettes. "theme" is resolved from CSS tokens at mount. Same set the
   sibling canvas toys use, so the games share a visual vocabulary. */
const BO_PALETTES: BoPalette[] = [
  { id: 'theme', name: 'Theme', colors: [] },
  { id: 'ice', name: 'Ice', colors: ['#ffffff', '#cfe8ff', '#8ec9ff', '#5aa9ff', '#bfe9ff'] },
  { id: 'aurora', name: 'Aurora', colors: ['#8affc1', '#4cd6b4', '#43b0ff', '#9b8cff', '#e0fff4'] },
  { id: 'ember', name: 'Ember', colors: ['#fff1c9', '#ffd23f', '#ff8c42', '#ff5a5f', '#ffb27a'] },
  { id: 'candy', name: 'Candy', colors: ['#ff8fd0', '#c77dff', '#7dd3ff', '#a0ffb0', '#fff5a0'] },
  { id: 'mono', name: 'Mono', colors: ['#ffffff', '#e8e8e8', '#cfcfcf', '#b8b8b8', '#f6f6f6'] },
]

const BO_LS_COUNT = 'bo:count'
const BO_LS_SPEED = 'bo:speed'
const BO_LS_VISION = 'bo:vision'
const BO_LS_SEP = 'bo:sep'
const BO_LS_ALIGN = 'bo:align'
const BO_LS_COH = 'bo:coh'
const BO_LS_TRAILS = 'bo:trails'
const BO_LS_POINTER = 'bo:pointer'
const BO_LS_PALETTE = 'bo:palette'

// Slider ranges. Raw values are persisted; scaled at read time.
const BO_COUNT_MIN = 40, BO_COUNT_MAX = 700     // boid count
const BO_SPEED_MIN = 10, BO_SPEED_MAX = 90       // /22 -> css px/frame top speed
const BO_VISION_MIN = 18, BO_VISION_MAX = 95     // css px perception radius
const BO_WEIGHT_MIN = 0, BO_WEIGHT_MAX = 200     // /100 -> rule weight (0..2)
const BO_STEP_MS = 1000 / 60

const BO_TAU = Math.PI * 2

function boClamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

/* Parse #rgb / #rrggbb (or leave rgb() alone) to a [r,g,b] triple. */
function boToRGB(input: string): [number, number, number] | null {
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

interface BoBoid {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  g: number
  b: number
}

type BoPointerMode = 'off' | 'attract' | 'avoid'

class MurmurationGame extends HTMLElement {
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private ro?: ResizeObserver
  private raf = 0
  private playing = false
  private lastFrame = 0
  private accumulatedMs = 0

  private w = 0 // device-pixel canvas dims
  private h = 0
  private boids: BoBoid[] = []

  // tunables (raw slider values; scaled per-frame using current dpr)
  private count = 220
  private speedRaw = 45
  private visionRaw = 48
  private sepW = 1.5
  private aliW = 1.0
  private cohW = 0.9
  private trails = true
  private pointerMode: BoPointerMode = 'avoid'
  private palette: BoPalette = BO_PALETTES[2]

  // pointer state
  private ptrActive = false
  private ptrX = 0
  private ptrY = 0
  private startle = 0 // frames of a scatter burst remaining, fired on click

  private bgRGB: [number, number, number] = [5, 7, 12]
  // Parsed [r,g,b] for the active palette; rebuilt only on a palette/theme change
  // so spawnOne never re-parses hex in a hot loop.
  private palRGB: [number, number, number][] = []

  // spatial hash grid, rebuilt each step
  private grid = new Map<number, number[]>()

  connectedCallback() {
    // restore prefs
    const rawCount = Number(this.readLS(BO_LS_COUNT))
    const rawSpeed = Number(this.readLS(BO_LS_SPEED))
    const rawVision = Number(this.readLS(BO_LS_VISION))
    const rawSep = this.readLS(BO_LS_SEP)
    const rawAlign = this.readLS(BO_LS_ALIGN)
    const rawCoh = this.readLS(BO_LS_COH)
    const savedTrails = this.readLS(BO_LS_TRAILS)
    const savedPointer = this.readLS(BO_LS_POINTER) as BoPointerMode | null
    const savedPalette = this.readLS(BO_LS_PALETTE)

    const countVal = boClamp(rawCount || 220, BO_COUNT_MIN, BO_COUNT_MAX)
    const speedVal = boClamp(rawSpeed || 45, BO_SPEED_MIN, BO_SPEED_MAX)
    const visionVal = boClamp(rawVision || 48, BO_VISION_MIN, BO_VISION_MAX)
    const sepVal = boClamp(rawSep === null ? 150 : Number(rawSep), BO_WEIGHT_MIN, BO_WEIGHT_MAX)
    const alignVal = boClamp(rawAlign === null ? 100 : Number(rawAlign), BO_WEIGHT_MIN, BO_WEIGHT_MAX)
    const cohVal = boClamp(rawCoh === null ? 90 : Number(rawCoh), BO_WEIGHT_MIN, BO_WEIGHT_MAX)

    this.count = countVal
    this.speedRaw = speedVal
    this.visionRaw = visionVal
    this.sepW = sepVal / 100
    this.aliW = alignVal / 100
    this.cohW = cohVal / 100
    this.trails = savedTrails === null ? true : savedTrails === '1'
    this.pointerMode = savedPointer === 'off' || savedPointer === 'attract' || savedPointer === 'avoid'
      ? savedPointer : 'avoid'
    this.palette = BO_PALETTES.find(p => p.id === savedPalette) || BO_PALETTES[2]
    if (this.palette.id === 'theme' && this.palette.colors.length === 0) this.palette = BO_PALETTES[2]

    this.innerHTML = `
      <div data-type="bo-game">
        <div data-type="bo-header">
          <div data-type="bo-titlebar">
            <h1>Murmuration</h1>
            <span data-type="bo-badge">flocking sim</span>
          </div>
          <p>A few hundred boids, each obeying three simple rules against the neighbours it can see — steer apart, match headings, drift together — and a living, swirling flock falls out of the maths. Dial the three rules from a marching grid to a nervous ball to a scattering cloud, then make the pointer a magnet or a hawk and watch the murmuration react. Grab a frame you like as a PNG.</p>
        </div>
        <div data-type="bo-stage">
          <canvas data-type="bo-canvas" tabindex="0" role="img"
            aria-label="Interactive flocking simulation — hundreds of boids swarm and swirl. Move the pointer to attract or scare the flock, click to startle it."></canvas>
        </div>
        <div data-type="bo-controls">
          <div data-group="transport" role="group" aria-label="Actions">
            <button data-action="play" type="button" aria-pressed="false" title="Run / pause the flock (space)">Pause</button>
            <button data-action="scatter" type="button" title="Startle the whole flock (B)">Scatter</button>
            <button data-action="reset" type="button" title="Re-seed a fresh flock (R)">Reset</button>
            <button data-action="download" type="button" title="Save the current frame as a PNG (D)">Download PNG</button>
            <button data-action="trails" type="button" aria-pressed="${this.trails}" title="Toggle motion trails (T)">Trails: ${this.trails ? 'on' : 'off'}</button>
          </div>
          <div data-type="bo-sliders">
            <div data-type="bo-slider">
              <label for="bo-count">Boids</label>
              <input id="bo-count" type="range" min="${BO_COUNT_MIN}" max="${BO_COUNT_MAX}" step="10" value="${countVal}" />
              <output id="bo-count-out">${countVal}</output>
            </div>
            <div data-type="bo-slider">
              <label for="bo-speed">Speed</label>
              <input id="bo-speed" type="range" min="${BO_SPEED_MIN}" max="${BO_SPEED_MAX}" value="${speedVal}" />
              <output id="bo-speed-out">${(speedVal / 45).toFixed(1)}×</output>
            </div>
            <div data-type="bo-slider">
              <label for="bo-vision">Vision</label>
              <input id="bo-vision" type="range" min="${BO_VISION_MIN}" max="${BO_VISION_MAX}" value="${visionVal}" />
              <output id="bo-vision-out">${visionVal}px</output>
            </div>
            <div data-type="bo-slider">
              <label for="bo-sep">Separation</label>
              <input id="bo-sep" type="range" min="${BO_WEIGHT_MIN}" max="${BO_WEIGHT_MAX}" step="5" value="${sepVal}" />
              <output id="bo-sep-out">${(sepVal / 100).toFixed(2)}</output>
            </div>
            <div data-type="bo-slider">
              <label for="bo-align">Alignment</label>
              <input id="bo-align" type="range" min="${BO_WEIGHT_MIN}" max="${BO_WEIGHT_MAX}" step="5" value="${alignVal}" />
              <output id="bo-align-out">${(alignVal / 100).toFixed(2)}</output>
            </div>
            <div data-type="bo-slider">
              <label for="bo-coh">Cohesion</label>
              <input id="bo-coh" type="range" min="${BO_WEIGHT_MIN}" max="${BO_WEIGHT_MAX}" step="5" value="${cohVal}" />
              <output id="bo-coh-out">${(cohVal / 100).toFixed(2)}</output>
            </div>
          </div>
          <div data-group="pointer" role="group" aria-label="Pointer force">
            <span data-type="bo-group-label">Pointer</span>
            <button data-pointer="off" type="button" aria-pressed="${this.pointerMode === 'off'}" title="Pointer does nothing">Off</button>
            <button data-pointer="attract" type="button" aria-pressed="${this.pointerMode === 'attract'}" title="Flock chases the pointer">Attract</button>
            <button data-pointer="avoid" type="button" aria-pressed="${this.pointerMode === 'avoid'}" title="Flock flees the pointer like a hawk">Avoid</button>
          </div>
          <div data-group="palette" role="group" aria-label="Colour palette">
            <span data-type="bo-group-label">Palette</span>
            ${BO_PALETTES.map(p => `
              <button data-palette="${p.id}" type="button" aria-pressed="${p.id === this.palette.id}" title="${p.name} palette">
                <span data-type="bo-swatch" aria-hidden="true">${(p.colors.length ? p.colors : ['var(--color-text)', 'var(--color-accent)', 'var(--color-muted)']).slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span>${p.name}
              </button>`).join('')}
          </div>
        </div>
        <details data-type="bo-explainer">
          <summary>How the flock works</summary>
          <p>Nobody choreographs a murmuration. Every boid looks only at the flockmates inside its <strong>Vision</strong> radius and blends three urges: <strong>Separation</strong> steers it away from anyone too close so it never collides; <strong>Alignment</strong> turns it to match the average heading of its neighbours; and <strong>Cohesion</strong> nudges it back toward their centre so the group holds together. The sliders set how loudly each urge is heard.</p>
          <p>Crank <em>Alignment</em> alone and the flock hardens into marching lanes. Crank <em>Cohesion</em> and it balls up. Crank <em>Separation</em> and it boils apart into a gas. The <strong>Pointer</strong> adds a fourth force — a magnet (Attract) or a predator (Avoid) — and a click fires a <strong>startle</strong> that blows the nearby birds outward before the rules pull them back.</p>
          <p data-type="bo-try"><strong>Try this:</strong> set Separation ≈ 1.6, Alignment ≈ 1.2, Cohesion ≈ 0.8, turn the pointer to <em>Avoid</em>, and sweep the cursor through the middle of the flock — it should split around you and re-form behind.</p>
        </details>
        <p data-type="bo-hint">Shortcuts: space = run/pause · B = scatter · T = trails · R = reset · D = download. Move the pointer over the flock to push or pull it; click to startle.</p>
      </div>
    `

    this.canvas = this.querySelector('[data-type="bo-canvas"]') as HTMLCanvasElement

    // Every one of these engines draws something someone would want to keep, and

    // until Aug 2026 not one of them had a way to save it. The bar is attached

    // here rather than written into the markup above so all six share one

    // implementation — see src/lib/canvas-export.ts.

    attachCanvasExport(this, () => this.canvas, { name: 'murmuration' })
    this.ctx = this.canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
    this.readTheme()
    this.wire()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.querySelector('[data-type="bo-stage"]') as Element)
    // Store the handle and bail if we've been disconnected: navigating away within
    // this first frame (View Transitions) cancels it, and the guard stops a late
    // fire from starting an orphaned RAF loop that disconnectedCallback can't reach.
    this.raf = requestAnimationFrame(() => {
      if (!this.isConnected) return
      this.resize()
      this.spawnAll()
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced) {
        this.renderStatic()
        this.setPlaying(false)
      } else {
        this.setPlaying(true)
      }
    })
  }

  disconnectedCallback() {
    this.playing = false   // stop any loop that starts from a late-firing init frame
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.ro?.disconnect()
  }

  /* ── theme + palette ── */

  private readTheme() {
    const cs = getComputedStyle(document.documentElement)
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
    this.bgRGB = boToRGB(v('--color-bg', '#05070c')) || [5, 7, 12]
    const theme = BO_PALETTES[0]
    theme.colors = [
      v('--color-text', '#dde6f2'),
      v('--color-accent', '#9b8cff'),
      v('--color-muted', '#73808f'),
      v('--color-text', '#dde6f2'),
    ]
    this.palRGB = []   // theme palette just (re)resolved — force a re-parse on next read
  }

  private paletteRGB(): [number, number, number][] {
    if (this.palRGB.length) return this.palRGB
    const cols = this.palette.colors.length ? this.palette.colors : BO_PALETTES[0].colors
    this.palRGB = cols.map(c => boToRGB(c) || [255, 255, 255])
    return this.palRGB
  }

  /* ── geometry ── */

  private dpr() {
    return Math.min(window.devicePixelRatio || 1, 2)
  }

  private resize() {
    const stage = this.querySelector('[data-type="bo-stage"]') as HTMLElement
    const cssW = stage.getBoundingClientRect().width
    if (cssW < 2) return
    const cssH = Math.round(cssW * 0.62)
    const dpr = this.dpr()
    this.canvas.style.width = cssW + 'px'
    this.canvas.style.height = cssH + 'px'
    const newW = Math.round(cssW * dpr)
    const newH = Math.round(cssH * dpr)
    if (newW === this.w && newH === this.h) return
    const hadBoids = this.boids.length > 0
    this.w = this.canvas.width = newW
    this.h = this.canvas.height = newH
    this.paintBackground()
    // keep boids inside the new frame after a resize
    if (hadBoids) {
      for (const bd of this.boids) {
        bd.x = boClamp(bd.x, 0, this.w)
        bd.y = boClamp(bd.y, 0, this.h)
      }
    }
  }

  /* ── flock ── */

  private spawnOne(bd: BoBoid) {
    const pal = this.paletteRGB()
    const c = pal[(Math.random() * pal.length) | 0]
    const speed = (this.speedRaw / 22) * this.dpr()
    const a = Math.random() * BO_TAU
    bd.x = Math.random() * this.w
    bd.y = Math.random() * this.h
    bd.vx = Math.cos(a) * speed
    bd.vy = Math.sin(a) * speed
    bd.r = c[0]; bd.g = c[1]; bd.b = c[2]
  }

  private spawnAll() {
    this.boids = new Array(this.count)
    for (let i = 0; i < this.count; i++) {
      const bd: BoBoid = { x: 0, y: 0, vx: 0, vy: 0, r: 255, g: 255, b: 255 }
      this.spawnOne(bd)
      this.boids[i] = bd
    }
  }

  private recolour() {
    const pal = this.paletteRGB()
    for (const bd of this.boids) {
      const c = pal[(Math.random() * pal.length) | 0]
      bd.r = c[0]; bd.g = c[1]; bd.b = c[2]
    }
  }

  /** Match the live boid array to the target count without a full respawn. */
  private resizeCount() {
    if (this.boids.length < this.count) {
      while (this.boids.length < this.count) {
        const bd: BoBoid = { x: 0, y: 0, vx: 0, vy: 0, r: 255, g: 255, b: 255 }
        this.spawnOne(bd)
        this.boids.push(bd)
      }
    } else if (this.boids.length > this.count) {
      this.boids.length = this.count
    }
  }

  private paintBackground(alpha = 1) {
    const [r, g, b] = this.bgRGB
    this.ctx.globalAlpha = alpha
    this.ctx.fillStyle = `rgb(${r},${g},${b})`
    this.ctx.fillRect(0, 0, this.w, this.h)
    this.ctx.globalAlpha = 1
  }

  /* ── spatial hash grid ── */

  private buildGrid(cell: number) {
    this.grid.clear()
    const cols = Math.max(1, Math.ceil(this.w / cell))
    for (let i = 0; i < this.boids.length; i++) {
      const bd = this.boids[i]
      const cx = Math.floor(bd.x / cell)
      const cy = Math.floor(bd.y / cell)
      const key = cy * cols + cx
      const bucket = this.grid.get(key)
      if (bucket) bucket.push(i)
      else this.grid.set(key, [i])
    }
    return cols
  }

  /* ── simulation ── */

  private step() {
    const dpr = this.dpr()

    // trails: fade the previous frame instead of wiping it, so each boid smears
    // into a streak; off = a hard clear every frame (crisp dots).
    this.paintBackground(this.trails ? 0.16 : 1)

    const vision = this.visionRaw * dpr
    const visionSq = vision * vision
    const sepDist = vision * 0.5
    const sepDistSq = sepDist * sepDist
    const maxSpeed = (this.speedRaw / 22) * dpr
    const minSpeed = maxSpeed * 0.45
    const maxForce = maxSpeed * 0.055
    const cols = this.buildGrid(vision)
    const gridCols = Math.max(1, Math.ceil(this.w / vision))
    const gridRows = Math.max(1, Math.ceil(this.h / vision))

    const ptrOn = this.ptrActive && this.pointerMode !== 'off'
    const ptrRadius = vision * 3.2
    const ptrRadiusSq = ptrRadius * ptrRadius
    if (this.startle > 0) this.startle--

    const boids = this.boids
    for (let i = 0; i < boids.length; i++) {
      const bd = boids[i]
      const cx = Math.floor(bd.x / vision)
      const cy = Math.floor(bd.y / vision)

      let sepX = 0, sepY = 0
      let aliX = 0, aliY = 0
      let cohX = 0, cohY = 0
      let n = 0

      // scan the 3×3 block of cells around this boid
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        if (gy < 0 || gy >= gridRows) continue
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          if (gx < 0 || gx >= gridCols) continue
          const bucket = this.grid.get(gy * cols + gx)
          if (!bucket) continue
          for (let b = 0; b < bucket.length; b++) {
            const j = bucket[b]
            if (j === i) continue
            const other = boids[j]
            const dx = bd.x - other.x
            const dy = bd.y - other.y
            const d2 = dx * dx + dy * dy
            if (d2 > visionSq || d2 === 0) continue
            n++
            aliX += other.vx; aliY += other.vy
            cohX += other.x; cohY += other.y
            if (d2 < sepDistSq) {
              // weight separation by closeness so near-misses shove hardest
              const inv = 1 / Math.sqrt(d2)
              sepX += dx * inv * inv
              sepY += dy * inv * inv
            }
          }
        }
      }

      let ax = 0, ay = 0
      if (n > 0) {
        // alignment: steer toward neighbours' average velocity
        const as = this.steerTo(aliX / n, aliY / n, bd, maxSpeed, maxForce)
        ax += as.x * this.aliW
        ay += as.y * this.aliW
        // cohesion: steer toward neighbours' centre of mass
        const cohVX = cohX / n - bd.x
        const cohVY = cohY / n - bd.y
        const cs = this.steerTo(cohVX, cohVY, bd, maxSpeed, maxForce)
        ax += cs.x * this.cohW
        ay += cs.y * this.cohW
      }
      // separation: steer along the accumulated push-away vector
      if (sepX !== 0 || sepY !== 0) {
        const ss = this.steerTo(sepX, sepY, bd, maxSpeed, maxForce)
        ax += ss.x * this.sepW * 1.35
        ay += ss.y * this.sepW * 1.35
      }

      // pointer force + startle burst
      if (ptrOn || this.startle > 0) {
        const dx = bd.x - this.ptrX
        const dy = bd.y - this.ptrY
        const d2 = dx * dx + dy * dy
        if (d2 < ptrRadiusSq && d2 > 0.0001) {
          const inv = 1 / Math.sqrt(d2)
          if (this.startle > 0) {
            const boost = (this.startle / 26) * maxForce * 9
            ax += dx * inv * boost
            ay += dy * inv * boost
          } else if (this.pointerMode === 'avoid') {
            const strength = maxForce * 6 * (1 - Math.sqrt(d2) / ptrRadius)
            ax += dx * inv * strength
            ay += dy * inv * strength
          } else if (this.pointerMode === 'attract') {
            const strength = maxForce * 2.2 * (1 - Math.sqrt(d2) / ptrRadius)
            ax -= dx * inv * strength
            ay -= dy * inv * strength
          }
        }
      }

      // integrate
      bd.vx += ax
      bd.vy += ay
      // clamp speed into [minSpeed, maxSpeed] so boids never freeze or run away
      let sp = Math.hypot(bd.vx, bd.vy)
      if (sp > maxSpeed) { bd.vx = bd.vx / sp * maxSpeed; bd.vy = bd.vy / sp * maxSpeed; sp = maxSpeed }
      else if (sp < minSpeed && sp > 0) { bd.vx = bd.vx / sp * minSpeed; bd.vy = bd.vy / sp * minSpeed; sp = minSpeed }
      bd.x += bd.vx
      bd.y += bd.vy

      // wrap toroidally for an endless sky
      if (bd.x < 0) bd.x += this.w
      else if (bd.x >= this.w) bd.x -= this.w
      if (bd.y < 0) bd.y += this.h
      else if (bd.y >= this.h) bd.y -= this.h

      // draw as a small arrowhead pointing along the heading
      this.drawBoid(bd, dpr)
    }
  }

  /** Reynolds "steer" = desired − current velocity, force-limited. */
  private steerTo(dvx: number, dvy: number, bd: BoBoid, maxSpeed: number, maxForce: number) {
    const m = Math.hypot(dvx, dvy)
    if (m === 0) return { x: 0, y: 0 }
    // scale desired to top speed, subtract current velocity, cap the turn
    const desX = dvx / m * maxSpeed
    const desY = dvy / m * maxSpeed
    let fx = desX - bd.vx
    let fy = desY - bd.vy
    const fm = Math.hypot(fx, fy)
    if (fm > maxForce) { fx = fx / fm * maxForce; fy = fy / fm * maxForce }
    return { x: fx, y: fy }
  }

  private drawBoid(bd: BoBoid, dpr: number) {
    const { ctx } = this
    const ang = Math.atan2(bd.vy, bd.vx)
    const size = 3.2 * dpr
    const cos = Math.cos(ang)
    const sin = Math.sin(ang)
    // tip forward, two tails back — a stylised bird/dart
    const tipX = bd.x + cos * size * 1.8
    const tipY = bd.y + sin * size * 1.8
    const lX = bd.x + Math.cos(ang + 2.5) * size
    const lY = bd.y + Math.sin(ang + 2.5) * size
    const rX = bd.x + Math.cos(ang - 2.5) * size
    const rY = bd.y + Math.sin(ang - 2.5) * size
    ctx.fillStyle = `rgb(${bd.r},${bd.g},${bd.b})`
    ctx.beginPath()
    ctx.moveTo(tipX, tipY)
    ctx.lineTo(lX, lY)
    ctx.lineTo(rX, rY)
    ctx.closePath()
    ctx.fill()
  }

  /** Draw one settled frame (reduced-motion / paused reset). */
  private renderStatic() {
    const saveTrails = this.trails
    this.trails = false
    // let the flock organise for a while off-screen, then paint once
    for (let i = 0; i < 90; i++) this.step()
    this.trails = saveTrails
  }

  private setPlaying(on: boolean) {
    this.playing = on
    const btn = this.querySelector('[data-action="play"]') as HTMLButtonElement | null
    if (btn) {
      btn.textContent = on ? 'Pause' : 'Run'
      btn.setAttribute('aria-pressed', String(on))
    }
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.lastFrame = 0
    this.accumulatedMs = 0
    if (on) this.raf = requestAnimationFrame(this.loop)
  }

  private loop = (now: number) => {
    if (!this.playing) return
    if (!this.lastFrame) this.lastFrame = now
    this.accumulatedMs = Math.min(this.accumulatedMs + now - this.lastFrame, 100)
    this.lastFrame = now
    while (this.accumulatedMs >= BO_STEP_MS) {
      this.step()
      this.accumulatedMs -= BO_STEP_MS
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  private reset() {
    this.startle = 0
    this.spawnAll()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.paintBackground()
      this.renderStatic()
    } else {
      this.setPlaying(true)
    }
  }

  /** Fire a startle burst from the pointer (or the canvas centre if it's away). */
  private scatter() {
    if (!this.ptrActive) { this.ptrX = this.w / 2; this.ptrY = this.h / 2 }
    this.startle = 26
    if (!this.playing && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.setPlaying(true)
    }
  }

  /* ── interaction ── */

  private wire() {
    this.querySelector('[data-action="play"]')?.addEventListener('click', () => this.setPlaying(!this.playing))
    this.querySelector('[data-action="scatter"]')?.addEventListener('click', () => this.scatter())
    this.querySelector('[data-action="reset"]')?.addEventListener('click', () => this.reset())
    this.querySelector('[data-action="download"]')?.addEventListener('click', () => this.download())
    this.querySelector('[data-action="trails"]')?.addEventListener('click', () => this.toggleTrails())

    this.bindSlider('#bo-count', '#bo-count-out', BO_LS_COUNT, raw => {
      this.count = boClamp(raw, BO_COUNT_MIN, BO_COUNT_MAX)
      this.resizeCount()
      return String(this.count)
    })
    this.bindSlider('#bo-speed', '#bo-speed-out', BO_LS_SPEED, raw => {
      this.speedRaw = boClamp(raw, BO_SPEED_MIN, BO_SPEED_MAX)
      return `${(this.speedRaw / 45).toFixed(1)}×`
    })
    this.bindSlider('#bo-vision', '#bo-vision-out', BO_LS_VISION, raw => {
      this.visionRaw = boClamp(raw, BO_VISION_MIN, BO_VISION_MAX)
      return `${this.visionRaw}px`
    })
    this.bindSlider('#bo-sep', '#bo-sep-out', BO_LS_SEP, raw => {
      this.sepW = boClamp(raw, BO_WEIGHT_MIN, BO_WEIGHT_MAX) / 100
      return this.sepW.toFixed(2)
    })
    this.bindSlider('#bo-align', '#bo-align-out', BO_LS_ALIGN, raw => {
      this.aliW = boClamp(raw, BO_WEIGHT_MIN, BO_WEIGHT_MAX) / 100
      return this.aliW.toFixed(2)
    })
    this.bindSlider('#bo-coh', '#bo-coh-out', BO_LS_COH, raw => {
      this.cohW = boClamp(raw, BO_WEIGHT_MIN, BO_WEIGHT_MAX) / 100
      return this.cohW.toFixed(2)
    })

    this.querySelectorAll<HTMLButtonElement>('[data-pointer]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.pointer as BoPointerMode
        this.pointerMode = mode
        this.writeLS(BO_LS_POINTER, mode)
        this.querySelectorAll('[data-pointer]').forEach(b =>
          b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.pointer === mode)))
      })
    })

    this.querySelectorAll<HTMLButtonElement>('[data-palette]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.palette as string
        this.palette = BO_PALETTES.find(p => p.id === id) || this.palette
        this.palRGB = []   // invalidate the parsed-colour cache for the new palette
        this.writeLS(BO_LS_PALETTE, id)
        this.querySelectorAll('[data-palette]').forEach(b =>
          b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.palette === id)))
        this.recolour()
      })
    })

    // pointer force follows the cursor while it's over the field
    this.canvas.addEventListener('pointermove', e => this.track(e))
    this.canvas.addEventListener('pointerleave', () => { this.ptrActive = false })
    this.canvas.addEventListener('pointerdown', e => { this.track(e); this.scatter(); this.canvas.focus() })
    this.canvas.addEventListener('keydown', e => this.onKey(e))
  }

  private bindSlider(inputSel: string, outSel: string, lsKey: string, apply: (raw: number) => string) {
    const input = this.querySelector(inputSel) as HTMLInputElement
    const out = this.querySelector(outSel) as HTMLOutputElement | null
    input.addEventListener('input', () => {
      const raw = Number(input.value)
      const label = apply(raw)
      if (out) out.textContent = label
      this.writeLS(lsKey, String(raw))
      if (!this.playing) this.renderStatic()
    })
  }

  private toggleTrails() {
    this.trails = !this.trails
    this.writeLS(BO_LS_TRAILS, this.trails ? '1' : '0')
    const btn = this.querySelector('[data-action="trails"]') as HTMLButtonElement | null
    if (btn) {
      btn.textContent = `Trails: ${this.trails ? 'on' : 'off'}`
      btn.setAttribute('aria-pressed', String(this.trails))
    }
    if (!this.playing) { this.paintBackground(); this.renderStatic() }
  }

  private track(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = this.dpr()
    this.ptrX = (e.clientX - rect.left) * dpr
    this.ptrY = (e.clientY - rect.top) * dpr
    this.ptrActive = true
  }

  private readLS(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  }

  private writeLS(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* ignore quota / private-mode */ }
  }

  private onKey(e: KeyboardEvent) {
    switch (e.key) {
      case ' ': e.preventDefault(); this.setPlaying(!this.playing); break
      case 'b': case 'B': e.preventDefault(); this.scatter(); break
      case 't': case 'T': e.preventDefault(); this.toggleTrails(); break
      case 'r': case 'R': e.preventDefault(); this.reset(); break
      case 'd': case 'D': e.preventDefault(); this.download(); break
    }
  }

  private download() {
    try {
      const url = this.canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = `murmuration.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      /* toDataURL can throw on a tainted canvas — never happens here (no external images) */
    }
  }
}

if (!customElements.get('murmuration-game')) {
  customElements.define('murmuration-game', MurmurationGame)
}

export {}
