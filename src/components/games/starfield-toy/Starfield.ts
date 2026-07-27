/**
 * Starfield Voyager — a mouse-reactive warp-drive starfield on a 2D canvas,
 * zero dependencies.
 *
 * This is the standalone, tunable descendant of the home-page star background:
 * instead of a flat shimmering grid, stars live in 3D and stream past the
 * viewer. Each frame every star drifts a little closer (its depth shrinks), the
 * whole field is projected through a vanishing point, and a warp streak is drawn
 * from where the star was to where it is now — so speed reads as length. When a
 * star flies off the edge it respawns far away, giving an endless flight.
 *
 * Mouse-reactive: the vanishing point eases toward the pointer, so you steer the
 * direction of travel by pointing; click (or B) fires a warp boost that decays
 * back to cruising speed. Six things are tunable and all persist in
 * localStorage: star Density, cruise Speed, Warp (streak length), star Size,
 * Spin (barrel-roll of the whole field), and colour Palette.
 *
 * All colours resolve from the theme tokens (theme.css) for the "Theme" palette,
 * so re-theming needs no JS change. Respects prefers-reduced-motion (paints one
 * still frame, then stays paused). The RAF loop is torn down in
 * disconnectedCallback so it never leaks across View Transitions.
 *
 * Every module-level name is prefixed `sf`/`SF_` on purpose: the game component
 * files share a global TS script scope, so unprefixed names (clamp, mulberry32,
 * LS_SPEED, PALETTES…) would collide with the other games at `astro check` time.
 */

interface SfPalette {
  id: string
  name: string
  colors: string[]
}

/* Curated palettes. "theme" is resolved from CSS tokens at mount. */
const SF_PALETTES: SfPalette[] = [
  { id: 'theme', name: 'Theme', colors: [] },
  { id: 'ice', name: 'Ice', colors: ['#ffffff', '#cfe8ff', '#8ec9ff', '#5aa9ff', '#bfe9ff'] },
  { id: 'aurora', name: 'Aurora', colors: ['#8affc1', '#4cd6b4', '#43b0ff', '#9b8cff', '#e0fff4'] },
  { id: 'ember', name: 'Ember', colors: ['#fff1c9', '#ffd23f', '#ff8c42', '#ff5a5f', '#ffb27a'] },
  { id: 'candy', name: 'Candy', colors: ['#ff8fd0', '#c77dff', '#7dd3ff', '#a0ffb0', '#fff5a0'] },
  { id: 'mono', name: 'Mono', colors: ['#ffffff', '#e8e8e8', '#cfcfcf', '#b8b8b8', '#f6f6f6'] },
]

const SF_LS_DENSITY = 'sf:density'
const SF_LS_SPEED = 'sf:speed'
const SF_LS_WARP = 'sf:warp'
const SF_LS_SIZE = 'sf:size'
const SF_LS_SPIN = 'sf:spin'
const SF_LS_PALETTE = 'sf:palette'

// Slider ranges. Raw values are persisted; scaled at read time.
const SF_DENSITY_MIN = 80, SF_DENSITY_MAX = 1400   // star count
const SF_SPEED_MIN = 3, SF_SPEED_MAX = 60          // /650 -> depth units/frame
const SF_WARP_MIN = 0, SF_WARP_MAX = 40            // /8 -> streak-length factor
const SF_SIZE_MIN = 4, SF_SIZE_MAX = 26            // /10 -> base px radius
const SF_SPIN_MIN = -24, SF_SPIN_MAX = 24          // /5000 -> rad/frame

const SF_MAX_Z = 4          // spawn depth (far plane)
const SF_NEAR_Z = 0.12      // recycle once a star passes this (very close)
const SF_TAU = Math.PI * 2

function sfClamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

/* Parse #rgb / #rrggbb (or leave rgb() alone) to a [r,g,b] triple. */
function sfToRGB(input: string): [number, number, number] | null {
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

interface SfStar {
  x: number    // world x (centred on 0)
  y: number    // world y
  z: number    // depth: SF_MAX_Z (far) -> SF_NEAR_Z (right on top of you)
  r: number
  g: number
  b: number
}

class StarfieldVoyagerGame extends HTMLElement {
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private ro?: ResizeObserver
  private raf = 0
  private playing = false

  private w = 0 // device-pixel canvas dims
  private h = 0
  private stars: SfStar[] = []

  // tunables (scaled)
  private count = 400
  private speed = 0.036
  private warp = 1.4
  private size = 1.0
  private spin = 0
  private palette: SfPalette = SF_PALETTES[1]

  // steering + boost
  private angle = 0                 // accumulated barrel-roll
  private boost = 1                 // multiplies speed, decays to 1
  private targetCX = 0.5            // vanishing point, fraction of canvas
  private targetCY = 0.5
  private curCX = 0.5
  private curCY = 0.5

  private bgRGB: [number, number, number] = [5, 7, 12]
  // Parsed [r,g,b] for the active palette; rebuilt only on a palette/theme change
  // so step()'s per-star respawn never re-parses hex in the animation hot loop.
  private palRGB: [number, number, number][] = []

  connectedCallback() {
    // restore prefs
    const rawDensity = Number(localStorage.getItem(SF_LS_DENSITY))
    const rawSpeed = Number(localStorage.getItem(SF_LS_SPEED))
    const rawWarp = localStorage.getItem(SF_LS_WARP)
    const rawSize = Number(localStorage.getItem(SF_LS_SIZE))
    const rawSpin = localStorage.getItem(SF_LS_SPIN)
    const savedPalette = localStorage.getItem(SF_LS_PALETTE)

    const densityVal = sfClamp(rawDensity || 400, SF_DENSITY_MIN, SF_DENSITY_MAX)
    const speedVal = sfClamp(rawSpeed || 24, SF_SPEED_MIN, SF_SPEED_MAX)
    const warpVal = sfClamp(rawWarp === null ? 11 : Number(rawWarp), SF_WARP_MIN, SF_WARP_MAX)
    const sizeVal = sfClamp(rawSize || 10, SF_SIZE_MIN, SF_SIZE_MAX)
    const spinVal = sfClamp(rawSpin === null ? 0 : Number(rawSpin), SF_SPIN_MIN, SF_SPIN_MAX)

    this.count = densityVal
    this.speed = speedVal / 650
    this.warp = warpVal / 8
    this.size = sizeVal / 10
    this.spin = spinVal / 5000
    this.palette = SF_PALETTES.find(p => p.id === savedPalette) || SF_PALETTES[1]
    if (this.palette.id === 'theme' && this.palette.colors.length === 0) this.palette = SF_PALETTES[1]

    this.innerHTML = `
      <div data-type="sf-game">
        <div data-type="sf-header">
          <div data-type="sf-titlebar">
            <h1>Starfield Voyager</h1>
            <span data-type="sf-badge">mouse-reactive warp</span>
          </div>
          <p>Fly through an endless field of stars. Point where you want to go and the field steers toward you; click to punch the warp drive and watch the stars stretch into streaks. Tune the density, cruising speed, streak length, star size and spin, pick a palette, then grab a frame you like as a PNG.</p>
        </div>
        <div data-type="sf-stage">
          <canvas data-type="sf-canvas" tabindex="0" role="img"
            aria-label="Interactive warp-drive starfield — stars stream past a vanishing point. Move the pointer to steer, click to boost."></canvas>
        </div>
        <div data-type="sf-controls">
          <div data-group="transport" role="group" aria-label="Actions">
            <button data-action="play" type="button" aria-pressed="false" title="Fly / hold position (space)">Pause</button>
            <button data-action="boost" type="button" title="Punch the warp drive (B, or click the field)">Warp</button>
            <button data-action="reset" type="button" title="Scatter a fresh field (R)">Reset</button>
            <button data-action="download" type="button" title="Save the current frame as a PNG (D)">Download PNG</button>
          </div>
          <div data-type="sf-sliders">
            <div data-type="sf-slider">
              <label for="sf-density">Density</label>
              <input id="sf-density" type="range" min="${SF_DENSITY_MIN}" max="${SF_DENSITY_MAX}" step="20" value="${densityVal}" />
              <output id="sf-density-out">${densityVal}</output>
            </div>
            <div data-type="sf-slider">
              <label for="sf-speed">Speed</label>
              <input id="sf-speed" type="range" min="${SF_SPEED_MIN}" max="${SF_SPEED_MAX}" value="${speedVal}" />
              <output id="sf-speed-out">${(speedVal / 24).toFixed(1)}×</output>
            </div>
            <div data-type="sf-slider">
              <label for="sf-warp">Warp</label>
              <input id="sf-warp" type="range" min="${SF_WARP_MIN}" max="${SF_WARP_MAX}" value="${warpVal}" />
              <output id="sf-warp-out">${(warpVal / 8).toFixed(1)}×</output>
            </div>
            <div data-type="sf-slider">
              <label for="sf-size">Star size</label>
              <input id="sf-size" type="range" min="${SF_SIZE_MIN}" max="${SF_SIZE_MAX}" value="${sizeVal}" />
              <output id="sf-size-out">${(sizeVal / 10).toFixed(1)}×</output>
            </div>
            <div data-type="sf-slider">
              <label for="sf-spin">Spin</label>
              <input id="sf-spin" type="range" min="${SF_SPIN_MIN}" max="${SF_SPIN_MAX}" value="${spinVal}" />
              <output id="sf-spin-out">${spinVal === 0 ? 'off' : (spinVal > 0 ? '↻' : '↺') + Math.abs(spinVal)}</output>
            </div>
          </div>
          <div data-group="palette" role="group" aria-label="Colour palette">
            <span data-type="sf-group-label">Palette</span>
            ${SF_PALETTES.map(p => `
              <button data-palette="${p.id}" type="button" aria-pressed="${p.id === this.palette.id}" title="${p.name} palette">
                <span data-type="sf-swatch" aria-hidden="true">${(p.colors.length ? p.colors : ['var(--color-text)', 'var(--color-accent)', 'var(--color-muted)']).slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span>${p.name}
              </button>`).join('')}
          </div>
        </div>
        <details data-type="sf-explainer">
          <summary>How the warp works</summary>
          <p>Each star has a depth. Every frame it moves a little closer, and the whole field is drawn through a single <strong>vanishing point</strong> — so a star near you lands far from the centre while a distant one sits close to it. As a star approaches, it races outward and finally flies off the edge, where it respawns in the distance. That endless recycling is the flight.</p>
          <p>The <strong>Warp</strong> slider draws each star as a streak from where it just was to where it is now, so faster stars leave longer trails. <strong>Spin</strong> slowly rolls the entire field, and pointing the mouse eases the vanishing point toward the cursor so you can bank left or right.</p>
          <p data-type="sf-try"><strong>Try this:</strong> push <em>Speed</em> and <em>Warp</em> up, add a touch of <em>Spin</em>, then click and hold near an edge — the boost fires and the stars stretch into hyperspace lines.</p>
        </details>
        <p data-type="sf-hint">Shortcuts: space = fly/pause · B = warp boost · R = reset · D = download. Move the pointer over the field to steer; click to boost.</p>
      </div>
    `

    this.canvas = this.querySelector('[data-type="sf-canvas"]') as HTMLCanvasElement
    this.ctx = this.canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
    this.readTheme()
    this.wire()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.querySelector('[data-type="sf-stage"]') as Element)
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
    this.bgRGB = sfToRGB(v('--color-bg', '#05070c')) || [5, 7, 12]
    const theme = SF_PALETTES[0]
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
    const cols = this.palette.colors.length ? this.palette.colors : SF_PALETTES[0].colors
    this.palRGB = cols.map(c => sfToRGB(c) || [255, 255, 255])
    return this.palRGB
  }

  /* ── geometry ── */

  private dpr() {
    return Math.min(window.devicePixelRatio || 1, 2)
  }

  private resize() {
    const stage = this.querySelector('[data-type="sf-stage"]') as HTMLElement
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
  }

  /* ── field ── */

  private focal() {
    // Vanishing-point strength: how strongly depth spreads stars from centre.
    return Math.min(this.w, this.h) * 0.9
  }

  private spawnOne(s: SfStar, z?: number) {
    const pal = this.paletteRGB()
    const c = pal[(Math.random() * pal.length) | 0]
    // world x/y are relative to the focal length, so a star at z=1 fills roughly
    // the whole frame regardless of canvas size.
    const spread = Math.max(this.w, this.h) / this.focal()
    s.x = (Math.random() * 2 - 1) * spread
    s.y = (Math.random() * 2 - 1) * spread
    s.z = z === undefined ? SF_NEAR_Z + Math.random() * (SF_MAX_Z - SF_NEAR_Z) : z
    s.r = c[0]; s.g = c[1]; s.b = c[2]
  }

  private spawnAll() {
    this.stars = new Array(this.count)
    for (let i = 0; i < this.count; i++) {
      const s: SfStar = { x: 0, y: 0, z: 0, r: 255, g: 255, b: 255 }
      this.spawnOne(s)
      this.stars[i] = s
    }
  }

  private recolour() {
    const pal = this.paletteRGB()
    for (const s of this.stars) {
      const c = pal[(Math.random() * pal.length) | 0]
      s.r = c[0]; s.g = c[1]; s.b = c[2]
    }
  }

  /** Match the live star array to the target count without a full respawn. */
  private resizeCount() {
    if (this.stars.length < this.count) {
      while (this.stars.length < this.count) {
        const s: SfStar = { x: 0, y: 0, z: 0, r: 255, g: 255, b: 255 }
        this.spawnOne(s)
        this.stars.push(s)
      }
    } else if (this.stars.length > this.count) {
      this.stars.length = this.count
    }
  }

  private paintBackground() {
    const [r, g, b] = this.bgRGB
    this.ctx.globalAlpha = 1
    this.ctx.fillStyle = `rgb(${r},${g},${b})`
    this.ctx.fillRect(0, 0, this.w, this.h)
  }

  /* ── simulation ── */

  private step() {
    const { ctx } = this
    const dpr = this.dpr()
    this.paintBackground()

    // ease steering + decay boost
    this.curCX += (this.targetCX - this.curCX) * 0.06
    this.curCY += (this.targetCY - this.curCY) * 0.06
    this.boost += (1 - this.boost) * 0.05
    this.angle += this.spin

    const cx = this.curCX * this.w
    const cy = this.curCY * this.h
    const f = this.focal()
    const sin = Math.sin(this.angle)
    const cos = Math.cos(this.angle)
    const dz = this.speed * this.boost
    const streak = this.warp

    ctx.lineCap = 'round'

    for (const s of this.stars) {
      const zPrev = s.z + dz * (1 + streak) // a bit further back along the path
      s.z -= dz
      if (s.z <= SF_NEAR_Z) {
        this.spawnOne(s, SF_MAX_Z)
        continue
      }

      // barrel-roll the world coords, then project through the vanishing point
      const rx = s.x * cos - s.y * sin
      const ry = s.x * sin + s.y * cos
      const k = f / s.z
      const sx = cx + rx * k
      const sy = cy + ry * k

      // off-screen? recycle to the far plane
      if (sx < -20 || sy < -20 || sx > this.w + 20 || sy > this.h + 20) {
        this.spawnOne(s, SF_MAX_Z)
        continue
      }

      const depth = 1 - s.z / SF_MAX_Z          // 0 far .. 1 close
      const alpha = sfClamp(0.15 + depth * 0.95, 0, 1)
      const radius = Math.max(0.4, this.size * dpr * (0.4 + depth * 1.8))
      const col = `rgba(${s.r},${s.g},${s.b},${alpha})`

      if (streak > 0.01) {
        const kPrev = f / zPrev
        const px = cx + rx * kPrev
        const py = cy + ry * kPrev
        ctx.strokeStyle = col
        ctx.lineWidth = radius
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(sx, sy)
        ctx.stroke()
      } else {
        ctx.fillStyle = col
        ctx.beginPath()
        ctx.arc(sx, sy, radius, 0, SF_TAU)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  /** Draw one still frame (reduced-motion / paused reset). */
  private renderStatic() {
    // advance a few frames without the RAF so the field looks settled
    const saveBoost = this.boost
    this.boost = 1
    for (let i = 0; i < 40; i++) this.step()
    this.boost = saveBoost
  }

  private setPlaying(on: boolean) {
    this.playing = on
    const btn = this.querySelector('[data-action="play"]') as HTMLButtonElement | null
    if (btn) {
      btn.textContent = on ? 'Pause' : 'Fly'
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

  private reset() {
    this.angle = 0
    this.boost = 1
    this.curCX = this.targetCX = 0.5
    this.curCY = this.targetCY = 0.5
    this.spawnAll()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.paintBackground()
      this.renderStatic()
    } else {
      this.setPlaying(true)
    }
  }

  private fireBoost() {
    this.boost = 4.2
    if (!this.playing && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.setPlaying(true)
    }
  }

  /* ── interaction ── */

  private wire() {
    this.querySelector('[data-action="play"]')?.addEventListener('click', () => this.setPlaying(!this.playing))
    this.querySelector('[data-action="boost"]')?.addEventListener('click', () => this.fireBoost())
    this.querySelector('[data-action="reset"]')?.addEventListener('click', () => this.reset())
    this.querySelector('[data-action="download"]')?.addEventListener('click', () => this.download())

    this.bindSlider('#sf-density', '#sf-density-out', SF_LS_DENSITY, raw => {
      this.count = sfClamp(raw, SF_DENSITY_MIN, SF_DENSITY_MAX)
      this.resizeCount()
      return String(this.count)
    })
    this.bindSlider('#sf-speed', '#sf-speed-out', SF_LS_SPEED, raw => {
      const v = sfClamp(raw, SF_SPEED_MIN, SF_SPEED_MAX)
      this.speed = v / 650
      return `${(v / 24).toFixed(1)}×`
    })
    this.bindSlider('#sf-warp', '#sf-warp-out', SF_LS_WARP, raw => {
      const v = sfClamp(raw, SF_WARP_MIN, SF_WARP_MAX)
      this.warp = v / 8
      return `${(v / 8).toFixed(1)}×`
    })
    this.bindSlider('#sf-size', '#sf-size-out', SF_LS_SIZE, raw => {
      const v = sfClamp(raw, SF_SIZE_MIN, SF_SIZE_MAX)
      this.size = v / 10
      return `${(v / 10).toFixed(1)}×`
    })
    this.bindSlider('#sf-spin', '#sf-spin-out', SF_LS_SPIN, raw => {
      const v = sfClamp(raw, SF_SPIN_MIN, SF_SPIN_MAX)
      this.spin = v / 5000
      return v === 0 ? 'off' : (v > 0 ? '↻' : '↺') + Math.abs(v)
    })

    this.querySelectorAll<HTMLButtonElement>('[data-palette]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.palette as string
        this.palette = SF_PALETTES.find(p => p.id === id) || this.palette
        this.palRGB = []   // invalidate the parsed-colour cache for the new palette
        localStorage.setItem(SF_LS_PALETTE, id)
        this.querySelectorAll('[data-palette]').forEach(b =>
          b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.palette === id)))
        this.recolour()
      })
    })

    // steer: ease the vanishing point toward the pointer while it's over the field
    this.canvas.addEventListener('pointermove', e => this.steer(e))
    this.canvas.addEventListener('pointerleave', () => { this.targetCX = 0.5; this.targetCY = 0.5 })
    this.canvas.addEventListener('pointerdown', e => { this.steer(e); this.fireBoost(); this.canvas.focus() })
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
      if (!this.playing) this.renderStatic()
    })
  }

  private steer(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect()
    // clamp toward centre so the vanishing point never leaves the frame entirely
    this.targetCX = sfClamp(0.5 + ((e.clientX - rect.left) / rect.width - 0.5) * 0.7, 0.12, 0.88)
    this.targetCY = sfClamp(0.5 + ((e.clientY - rect.top) / rect.height - 0.5) * 0.7, 0.12, 0.88)
  }

  private onKey(e: KeyboardEvent) {
    switch (e.key) {
      case ' ': e.preventDefault(); this.setPlaying(!this.playing); break
      case 'b': case 'B': e.preventDefault(); this.fireBoost(); break
      case 'r': case 'R': e.preventDefault(); this.reset(); break
      case 'd': case 'D': e.preventDefault(); this.download(); break
    }
  }

  private download() {
    try {
      const url = this.canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = `starfield-voyager.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      /* toDataURL can throw on a tainted canvas — never happens here (no external images) */
    }
  }
}

if (!customElements.get('starfield-voyager-game')) {
  customElements.define('starfield-voyager-game', StarfieldVoyagerGame)
}

export {}
