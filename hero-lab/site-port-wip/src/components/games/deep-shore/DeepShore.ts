/**
 * Deep Shore — a Mandelbrot and Julia deep-zoom explorer on a 2D canvas, zero
 * dependencies.
 *
 * The Mandelbrot set is the most famous coastline in mathematics: a shape whose
 * edge never smooths out however far you swim into it. This is a viewer for that
 * edge — scroll or click to dive, drag to move along the shore, and the detail
 * keeps arriving until double precision itself runs out (a limit the status line
 * names rather than pretending away; see DS_MAX_ZOOM in escape.ts).
 *
 * Three things make it more than a screenshot generator:
 *
 *   • **Permalinks.** A found spot encodes into the URL fragment (`#view=…`) with
 *     as many digits as the zoom actually needs, so the link you send lands on
 *     the same rock rather than somewhere in the same ocean. The fragment never
 *     reaches server logs or Referer headers — same posture as the Type Trial
 *     ghost link. The same token is what localStorage holds, so there is one
 *     serialisation format and not two that drift.
 *   • **Julia peek.** Every point c of the Mandelbrot plane has its own Julia
 *     set, and the relationship between the two is the single most interesting
 *     fact in the neighbourhood. With peek armed, the inset draws the Julia set
 *     for whatever point is under the cursor, live; click and you are inside it.
 *   • **A progressive renderer.** A coarse block pass lands the whole frame
 *     immediately, then full resolution fills in under a per-frame time budget,
 *     resumable mid-row. So a 3000-iteration deep zoom never blocks the tab, and
 *     a wheel notch mid-render simply abandons the old one.
 *
 * The maths, the zoom-anchoring and the permalink live in `escape.ts` so
 * `security:smoke` can exercise them — see that file's header for what is
 * asserted and why the fast path keeps a reference implementation beside it.
 *
 * Every module-level name is prefixed `ds`/`DS_`: game component files share one
 * global TS script scope, so unprefixed names collide with the sibling toys at
 * `astro check` time.
 */

import { attachCanvasExport, type AnimationFrames, type AnimationRefusal } from '../../../lib/canvas-export'
import { flashLabel } from '../../../lib/flash'
import {
  DS_TOUR_HOLD_FRAMES,
  DS_TOUR_MAX_STOPS,
  DS_TOUR_MIN_STOPS,
  dsDecodeTour,
  dsEncodeTour,
  dsNormalizeStops,
  dsStopFromView,
  dsTourDecades,
  dsTourDelay,
  dsTourFrameCount,
  dsTourTokenFromHash,
  dsTourViewAt,
  type DsStop,
} from './tour'
import {
  DS_DEFAULT_VIEW,
  DS_DENSITY_MAX,
  DS_DENSITY_MIN,
  DS_ITER_MAX,
  DS_ITER_MIN,
  DS_MAX_ZOOM,
  DS_PRECISION_WARN_ZOOM,
  dsClamp,
  dsClampView,
  dsDecodeView,
  dsEffectiveIter,
  dsEncodeView,
  dsEscape,
  dsFormatZoom,
  dsPixelScale,
  dsRampPosition,
  dsScreenToComplex,
  dsTokenFromHash,
  dsZoomAt,
  type DsMode,
  type DsView,
} from './escape'

interface DsPalette {
  id: string
  name: string
  /** Ramp stops, cycled (the first is appended to the last when the LUT is
   *  built) so a repeating gradient has no seam. */
  colors: string[]
  /** Solid fill for points that never escape. */
  inside: string
}

/* Ids must match DS_PALETTE_IDS in escape.ts — the decoder's allowlist. */
const DS_PALETTES: DsPalette[] = [
  { id: 'ember', name: 'Ember', colors: ['#0b0407', '#7a1f0f', '#ff6b35', '#ffd23f', '#fff3c9'], inside: '#06030a' },
  { id: 'theme', name: 'Theme', colors: [], inside: '#05070c' },
  { id: 'ultra', name: 'Ultraviolet', colors: ['#03041a', '#2b1a6b', '#7b2ff7', '#f72585', '#ffd6e8'], inside: '#02020c' },
  { id: 'ice', name: 'Ice', colors: ['#02121f', '#0b4f6c', '#00b4d8', '#90e0ef', '#eaffff'], inside: '#01070f' },
  { id: 'orchid', name: 'Orchid', colors: ['#120318', '#4a148c', '#c2185b', '#ff8a80', '#ffe0b2'], inside: '#08020c' },
  { id: 'mono', name: 'Mono', colors: ['#050505', '#3a3a3a', '#8a8a8a', '#dcdcdc', '#ffffff'], inside: '#000000' },
  { id: 'zebra', name: 'Zebra', colors: ['#000000', '#ffffff'], inside: '#000000' },
]

interface DsPlace {
  id: string
  name: string
  hint: string
  re: number
  im: number
  zoom: number
}

/**
 * Somewhere to start. A first-time visitor handed a blank plane does not know
 * that the interesting parts are three decimal places wide, so the tour is not
 * decoration — it is the difference between "nice picture" and "oh, it keeps
 * going".
 */
const DS_PLACES: DsPlace[] = [
  { id: 'home', name: 'Whole set', hint: 'The full Mandelbrot set', re: -0.6, im: 0, zoom: 1 },
  { id: 'seahorse', name: 'Seahorse Valley', hint: 'The notch between the body and the head', re: -0.745, im: 0.113, zoom: 60 },
  { id: 'elephant', name: 'Elephant Valley', hint: 'A parade of trunks off the right-hand cusp', re: 0.2925, im: 0.0195, zoom: 70 },
  { id: 'spiral', name: 'Triple Spiral', hint: 'Three arms winding into each other', re: -0.088, im: 0.654, zoom: 130 },
  { id: 'satellite', name: 'Satellite', hint: 'A whole small copy of the set, far out on the antenna', re: -1.7687, im: 0.0017, zoom: 3000 },
  { id: 'deep', name: 'Deep dive', hint: 'Fifty million times in — the shore is still rough', re: -0.7436438870371587, im: 0.1318259042053119, zoom: 5e7 },
]

interface DsSeed {
  name: string
  re: number
  im: number
}

/** Julia seeds worth seeing — each is a c whose filled Julia set is a different
 *  species: dendrite, rabbit, spiral, dust. */
const DS_SEEDS: DsSeed[] = [
  { name: 'Rabbit', re: -0.123, im: 0.745 },
  { name: 'Dendrite', re: 0, im: 1 },
  { name: 'Spiral', re: -0.7269, im: 0.1889 },
  { name: 'San Marco', re: -0.75, im: 0 },
  { name: 'Dust', re: 0.285, im: 0.535 },
]

const DS_LS_VIEW = 'ds:view'
const DS_LS_PEEK = 'ds:peek'
const DS_LS_TOUR = 'ds:tour'

/** Stage aspect (height / width). */
const DS_ASPECT = 0.62
/**
 * Refinement ladder, in backing-store pixels per sample.
 *
 * Measured rather than guessed: a full 1280×794 frame at the deepest tour stop
 * (1,726 iterations) is about four seconds of pure iteration work, so a single
 * full-resolution pass would leave the visitor watching rows crawl down the
 * canvas. The 8px pass costs 1/64 of that — a whole frame in roughly one tenth
 * of a second — and the 2px pass costs a quarter, landing an image most people
 * would accept as finished four times sooner than the last pass can. Total cost
 * is 1 + 1/4 + 1/64 ≈ 1.27× a single pass: paying 27% more arithmetic to make
 * the first 95% of it visible four times earlier.
 */
const DS_PASSES = [8, 2, 1]
/** Cost weight of the whole ladder, for an honest progress percentage. */
const DS_PASS_WORK = DS_PASSES.reduce((sum, step) => sum + 1 / (step * step), 0)
/** Milliseconds of iteration work per animation frame. Everything about the
 *  renderer's responsiveness is this number: the work is resumable mid-row, so
 *  a 3000-iteration frame costs many frames rather than one long stall. */
const DS_FRAME_BUDGET_MS = 13
/** Pixels between budget checks inside the fine pass. */
const DS_CHUNK = 192
/** Ramp resolution. */
const DS_LUT = 1024
/** Julia inset edge, CSS px, and its (deliberately cheap) iteration budget —
 *  it redraws on every pointer move, so it must cost a fraction of a frame. */
const DS_PEEK_PX = 104
const DS_PEEK_ITER = 90
/** Wheel/click zoom step. */
const DS_ZOOM_STEP = 1.35
/**
 * Width the on-canvas dive preview renders at before being scaled up to the
 * stage.
 *
 * Small on purpose, and not a compromise: the preview exists to show the MOTION,
 * a frame at stage resolution can cost a second of arithmetic at depth, and this
 * is the same resolution the GIF is encoded at — so the rehearsal is literally
 * the artifact, which is the whole premise of the shared export bar.
 */
const DS_TOUR_PREVIEW_PX = 300
/** Rendering time one preview may spend (the GIF gets a longer budget). */
const DS_TOUR_PREVIEW_BUDGET_MS = 2800

function dsReadStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function dsWriteStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage disabled — Deep Shore still works for this session */
  }
}

function dsToRGB(input: string): [number, number, number] {
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
    if (parts.length >= 3 && parts.every(n => Number.isFinite(n))) return [parts[0], parts[1], parts[2]]
  }
  return [255, 255, 255]
}

/** One line describing a stop: the centre to as many digits as its own zoom
 *  justifies (the `#view=` precision rule, in reading form), then the zoom. */
function dsStopLabel(stop: DsStop): string {
  const digits = Math.min(12, Math.max(4, Math.ceil(Math.log10(Math.max(1, stop.zoom))) + 3))
  const sign = stop.im < 0 ? '−' : '+'
  return `${stop.re.toFixed(digits)} ${sign} ${Math.abs(stop.im).toFixed(digits)}i · ${dsFormatZoom(stop.zoom)}`
}

function dsEscapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

class DeepShoreGame extends HTMLElement {
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private peek!: HTMLCanvasElement
  private peekCtx!: CanvasRenderingContext2D
  /** Last completed frame, kept so a drag can show an offset copy instantly
   *  instead of re-rendering thousands of iterations per pointer move. */
  private snap = document.createElement('canvas')
  private ro?: ResizeObserver

  private w = 0
  private h = 0
  private img?: ImageData

  private view: DsView = { ...DS_DEFAULT_VIEW }
  /** The other mode's last frame, so switching back does not lose the place. */
  private parked: Partial<Record<DsMode, DsView>> = {}
  private palette: DsPalette = DS_PALETTES[0]
  private peekOn = false

  private lut = new Uint8Array(DS_LUT * 3)
  private insideRGB: [number, number, number] = [0, 0, 0]

  /** Render pass state. `gen` invalidates an in-flight render. */
  private gen = 0
  private raf = 0
  /** Index into DS_PASSES; equal to its length once the frame is complete. */
  private passIdx = 0
  private passY = 0
  private passX = 0
  private iterUsed = 0
  private dirtyTop = 0
  private dirtyBottom = 0

  private dragging = false
  private dragId = -1
  private dragFromX = 0
  private dragFromY = 0
  private dragDX = 0
  private dragDY = 0

  private peekPending = false
  private peekX = 0
  private peekY = 0
  private hashTimer = 0

  /** The dive: places the visitor stopped at, in order. */
  private stops: DsStop[] = []
  /** True while a preview is playing — and doubles as its stop flag, so the
   *  button that started it can end it and `disconnectedCallback` can too. */
  private diveBusy = false
  /** Signature of the stop list as currently painted, so the markup is rebuilt
   *  only when the stops change and never under a keyboard user's focus. Null
   *  rather than a sentinel string: the empty list has a signature of its own. */
  private stopsRendered: string | null = null

  private onHashChange = () => this.applyHashToken()

  connectedCallback() {
    this.resolveThemePalette()
    this.view = this.initialView()
    this.stops = this.initialStops()
    this.palette = DS_PALETTES.find(p => p.id === this.view.palette) || DS_PALETTES[0]
    if (this.palette.colors.length === 0) this.palette = DS_PALETTES[0]
    this.view.palette = this.palette.id
    this.peekOn = dsReadStored(DS_LS_PEEK) === '1'

    this.innerHTML = `
      <div data-type="ds-game">
        <div data-type="ds-header">
          <div data-type="ds-titlebar">
            <h1>Deep Shore</h1>
            <span data-type="ds-badge">fractal explorer</span>
          </div>
          <p>The edge of the Mandelbrot set never smooths out — magnify any stretch of it and there is more coastline. Scroll or click to dive, drag to travel along the shore, and send anyone the exact spot you found. Arm <em>Julia peek</em> and the inset shows the Julia set belonging to the point under your cursor.</p>
        </div>
        <div data-type="ds-stage">
          <canvas data-type="ds-canvas" tabindex="0" role="img"
            aria-label="Fractal plane — scroll or click to zoom, drag to pan, arrow keys to move."></canvas>
          <canvas data-type="ds-peek" width="${DS_PEEK_PX}" height="${DS_PEEK_PX}" aria-hidden="true"></canvas>
          <p data-type="ds-progress" role="status" aria-live="polite"></p>
        </div>
        <p data-type="ds-readout">
          <span data-field="mode"></span>
          <span data-field="centre"></span>
          <span data-field="zoom"></span>
          <span data-field="iter"></span>
          <span data-field="warn" hidden></span>
        </p>
        <div data-type="ds-controls">
          <div data-group="transport" role="group" aria-label="Actions">
            <button data-action="zoom-in" type="button" title="Zoom in on the centre (+)">Zoom in</button>
            <button data-action="zoom-out" type="button" title="Zoom out (−)">Zoom out</button>
            <button data-action="reset" type="button" title="Back to the whole set (0)">Reset</button>
            <button data-action="copy-link" type="button" title="Copy a link to exactly this view (L)">Copy link</button>
          </div>
          <div data-group="mode" role="group" aria-label="Fractal">
            <span data-type="ds-group-label">Fractal</span>
            <button data-mode="mandelbrot" type="button" title="The Mandelbrot set — every point is its own c">Mandelbrot</button>
            <button data-mode="julia" type="button" title="The Julia set for one fixed c (J)">Julia</button>
            <button data-action="peek" type="button" aria-pressed="false" title="Preview the Julia set under the cursor, and click to enter it">Julia peek</button>
          </div>
          <div data-group="places" role="group" aria-label="Places to visit">
            <span data-type="ds-group-label">Tour</span>
            ${DS_PLACES.map(p => `
              <button data-place="${p.id}" type="button" title="${dsEscapeAttr(p.hint)}">${p.name}</button>`).join('')}
          </div>
          <div data-group="dive" role="group" aria-label="Dive recorder">
            <span data-type="ds-group-label">Dive</span>
            <button data-action="add-stop" type="button" title="Mark this view as the next stop on the dive (A)">Add stop</button>
            <button data-action="play-dive" type="button" title="Play the dive on the canvas at recording resolution">Preview</button>
            <button data-action="copy-dive" type="button" title="Copy a link that replays the whole dive">Copy dive link</button>
            <button data-action="clear-dive" type="button" title="Forget every stop">Clear</button>
            <span data-type="ds-dive-count" role="status" aria-live="polite"></span>
          </div>
          <ol data-type="ds-stops" hidden></ol>
          <div data-group="seeds" role="group" aria-label="Julia seeds" hidden>
            <span data-type="ds-group-label">Seed</span>
            ${DS_SEEDS.map((s, i) => `
              <button data-seed="${i}" type="button" title="c = ${s.re} ${s.im < 0 ? '−' : '+'} ${Math.abs(s.im)}i">${s.name}</button>`).join('')}
          </div>
          <div data-type="ds-sliders">
            <div data-type="ds-slider">
              <label for="ds-iter">Detail</label>
              <input id="ds-iter" type="range" min="0" max="${DS_ITER_MAX}" step="20" value="${this.view.iter}"
                aria-describedby="ds-iter-out" />
              <output id="ds-iter-out"></output>
            </div>
            <div data-type="ds-slider">
              <label for="ds-density">Colour</label>
              <input id="ds-density" type="range" min="${DS_DENSITY_MIN}" max="${DS_DENSITY_MAX}" value="${this.view.density}" />
              <output id="ds-density-out">${this.view.density}</output>
            </div>
          </div>
          <div data-group="palette" role="group" aria-label="Colour palette">
            <span data-type="ds-group-label">Palette</span>
            ${DS_PALETTES.map(p => `
              <button data-palette="${p.id}" type="button" aria-pressed="false" title="${p.name} palette">
                <span data-type="ds-swatch" aria-hidden="true">${(p.colors.length ? p.colors : ['var(--color-bg)', 'var(--color-surface)', 'var(--color-accent)', 'var(--color-text)']).slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span>${p.name}
              </button>`).join('')}
          </div>
          <div data-group="seed" hidden>
            <label for="ds-seed-re">c =</label>
            <input id="ds-seed-re" type="text" inputmode="decimal" spellcheck="false" size="9"
              aria-label="Julia seed, real part" />
            <span data-type="ds-seed-plus">+</span>
            <input id="ds-seed-im" type="text" inputmode="decimal" spellcheck="false" size="9"
              aria-label="Julia seed, imaginary part" />
            <span data-type="ds-seed-i">i</span>
          </div>
        </div>
        <details data-type="ds-explainer">
          <summary>New here? What you are looking at</summary>
          <p>Pick a point <strong>c</strong> on the plane and repeat one step forever: <em>z → z² + c</em>, starting from zero. For some points the numbers stay small no matter how long you keep going; for others they run away to infinity. The <strong>Mandelbrot set</strong> is the collection of points that stay — drawn solid here — and the colours outside it record <em>how quickly</em> each point escaped.</p>
          <p>That is the entire rule, and the boundary it produces is infinitely detailed: there is no magnification at which it becomes a smooth curve. Zoom far enough into almost any part of the edge and small copies of the whole set appear, surrounded by filaments that look nothing like their neighbours.</p>
          <p>Fix <strong>c</strong> instead and let the <em>starting</em> point vary, and you get that point's <strong>Julia set</strong>. Each c has its own, and the shape of the Mandelbrot set near c is a good predictor of it — which is what <em>Julia peek</em> is for: sweep the cursor along the coast and watch the Julia sets change species as you cross from one region into the next.</p>
          <p data-type="ds-try"><strong>Try this:</strong> take the <em>Seahorse Valley</em> stop, arm <em>Julia peek</em>, and move slowly across the thin neck. Then keep zooming: the detail holds until the status line warns you that double precision has run out.</p>
        </details>
        <p data-type="ds-hint">Scroll or click to zoom in · <kbd>Alt</kbd>-click or scroll back to zoom out · drag to pan · arrows to move, <kbd>+</kbd>/<kbd>−</kbd> to zoom, <kbd>0</kbd> reset, <kbd>J</kbd> switch fractal, <kbd>A</kbd> add a stop, <kbd>L</kbd> copy link</p>
        <p data-type="ds-hint">Saving: <strong>PNG</strong> captures exactly the view you are looking at. <strong>Record the dive</strong> replays your stops as an animation — it zooms geometrically and pans while the screen is still cheap, so the destination arrives rather than whipping past — and hands back a GIF. It renders every frame from the maths at the moment you ask, so how many frames it can afford depends on how deep the dive is and how fast this machine is; the count is chosen from a timed first frame, and <strong>Stop</strong> ends it.</p>
      </div>
    `

    this.canvas = this.querySelector('[data-type="ds-canvas"]') as HTMLCanvasElement
    this.ctx = this.canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
    this.peek = this.querySelector('[data-type="ds-peek"]') as HTMLCanvasElement
    this.peekCtx = this.peek.getContext('2d', { alpha: false }) as CanvasRenderingContext2D
    // No live-capture GIF here. Filming this canvas records a still frame —
    // it only redraws when you touch it — which is why the dive recorder exists
    // and why leaving both buttons up would mean shipping a control the page has
    // to warn you off.
    attachCanvasExport(this, () => this.canvas, {
      name: 'deep-shore',
      liveGif: false,
      animation: {
        label: 'Record the dive',
        title: 'Render your stops as an animated GIF',
        suffix: 'dive',
        hold: DS_TOUR_HOLD_FRAMES,
        render: (w, h, report, cancelled) => this.recordDive(w, h, report, cancelled),
      },
    })

    this.buildLut()
    this.wire()
    this.syncControls()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.querySelector('[data-type="ds-stage"]') as Element)
    window.addEventListener('hashchange', this.onHashChange)
    requestAnimationFrame(() => this.resize())
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.gen += 1
    // Ends a dive preview mid-flight: its loop polls this flag, and a render
    // that outlives the element would paint into a detached canvas forever.
    this.diveBusy = false
    this.ro?.disconnect()
    window.removeEventListener('hashchange', this.onHashChange)
    window.clearTimeout(this.hashTimer)
  }

  /* ──────────────  state in, state out  ────────────── */

  /**
   * A shared link wins over what this browser remembers, and both are validated
   * by the same decoder — so a hand-built fragment is no more trusted than a
   * hand-edited localStorage value, and neither can produce a view the encoder
   * could not have minted.
   */
  private initialView(): DsView {
    const fromHash = dsTokenFromHash(location.hash)
    const decodedHash = fromHash ? dsDecodeView(fromHash) : null
    if (decodedHash) return decodedHash
    // A dive link shared on its own carries its starting view inside the tour
    // token, so `#tour=…` alone still lands you where the dive begins.
    const sharedDive = this.sharedTour()
    if (sharedDive) return sharedDive.view
    const stored = dsReadStored(DS_LS_VIEW)
    const decodedStored = stored ? dsDecodeView(stored) : null
    if (decodedStored) return decodedStored
    return { ...DS_DEFAULT_VIEW }
  }

  private sharedTour() {
    const token = dsTourTokenFromHash(location.hash)
    return token ? dsDecodeTour(token) : null
  }

  /** A shared dive wins over a remembered one; both pass the same decoder, so
   *  a hand-edited localStorage entry is trusted exactly as little as a link. */
  private initialStops(): DsStop[] {
    const shared = this.sharedTour()
    if (shared) return shared.stops
    const stored = dsReadStored(DS_LS_TOUR)
    const restored = stored ? dsDecodeTour(stored) : null
    return restored ? restored.stops : []
  }

  private applyHashToken() {
    const shared = this.sharedTour()
    if (shared) this.stops = shared.stops
    const token = dsTokenFromHash(location.hash)
    const decoded = token ? dsDecodeView(token) : shared?.view ?? null
    if (!decoded) {
      if (shared) this.syncControls()
      return
    }
    this.view = decoded
    this.palette = DS_PALETTES.find(p => p.id === decoded.palette) || this.palette
    this.buildLut()
    this.syncControls()
    this.startRender()
  }

  /**
   * Persist, and keep the address bar shareable.
   *
   * `replaceState` rather than a hash assignment: assigning to `location.hash`
   * pushes a history entry, so a minute of exploring would bury the page the
   * visitor arrived from under a hundred back-button steps. Path-pinned and
   * wrapped, the same as the Type Trial share link — a sandboxed or
   * file-protocol context throws here and the explorer must not care.
   */
  private commitView() {
    const token = dsEncodeView(this.view)
    dsWriteStored(DS_LS_VIEW, token)
    // The dive rides in the same fragment under its own key. `dsTokenFromHash`
    // was written to tolerate `&`-joined keys for exactly this, so every link
    // minted before today still decodes.
    const tour = dsEncodeTour(this.view, this.stops)
    dsWriteStored(DS_LS_TOUR, tour)
    window.clearTimeout(this.hashTimer)
    this.hashTimer = window.setTimeout(() => {
      try {
        const fragment = tour ? `#view=${token}&tour=${tour}` : `#view=${token}`
        history.replaceState(null, '', `${location.pathname}${location.search}${fragment}`)
      } catch {
        /* history is unavailable in some embedding contexts */
      }
    }, 400)
  }

  /* ──────────────  colour  ────────────── */

  private resolveThemePalette() {
    const cs = getComputedStyle(document.documentElement)
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
    const theme = DS_PALETTES.find(p => p.id === 'theme')
    if (!theme) return
    theme.colors = [
      v('--color-bg', '#05070c'),
      v('--color-surface', '#0e131b'),
      v('--color-accent', '#8b7cff'),
      v('--color-text', '#e8e8e8'),
    ]
    theme.inside = v('--color-bg', '#05070c')
  }

  /** Cyclic ramp: the first stop is appended so the gradient loops seamlessly,
   *  which is what makes repeating bands read as depth rather than as stripes. */
  private buildLut() {
    const base = this.palette.colors.length ? this.palette.colors : DS_PALETTES[0].colors
    const stops = [...base, base[0]].map(dsToRGB)
    const n = stops.length
    for (let i = 0; i < DS_LUT; i += 1) {
      const t = (i / DS_LUT) * (n - 1)
      const lo = Math.floor(t)
      const hi = Math.min(n - 1, lo + 1)
      const f = t - lo
      this.lut[i * 3] = Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f)
      this.lut[i * 3 + 1] = Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f)
      this.lut[i * 3 + 2] = Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f)
    }
    this.insideRGB = dsToRGB(this.palette.inside)
  }

  /* ──────────────  geometry  ────────────── */

  private dpr() {
    return Math.min(window.devicePixelRatio || 1, 2)
  }

  private resize() {
    const stage = this.querySelector('[data-type="ds-stage"]') as HTMLElement | null
    if (!stage) return
    const cssW = stage.getBoundingClientRect().width
    if (cssW < 2) return
    const cssH = Math.round(cssW * DS_ASPECT)
    const dpr = this.dpr()
    this.canvas.style.width = cssW + 'px'
    this.canvas.style.height = cssH + 'px'
    const w = Math.max(1, Math.round(cssW * dpr))
    const h = Math.max(1, Math.round(cssH * dpr))
    if (w === this.w && h === this.h && this.img) return
    this.w = this.canvas.width = w
    this.h = this.canvas.height = h
    this.snap.width = w
    this.snap.height = h
    this.img = this.ctx.createImageData(w, h)
    const d = this.img.data
    for (let i = 3; i < d.length; i += 4) d[i] = 255
    this.startRender()
  }

  /* ──────────────  the progressive renderer  ────────────── */

  private startRender() {
    if (!this.img) return
    this.gen += 1
    cancelAnimationFrame(this.raf)
    this.passIdx = 0
    this.passY = 0
    this.passX = 0
    this.iterUsed = dsEffectiveIter(this.view)
    this.dirtyTop = 0
    this.dirtyBottom = 0
    this.updateReadout()
    const gen = this.gen
    this.raf = requestAnimationFrame(() => this.tick(gen))
  }

  private tick(gen: number) {
    if (gen !== this.gen || !this.img) return
    const started = performance.now()
    this.dirtyTop = this.h
    this.dirtyBottom = 0
    while (this.passIdx < DS_PASSES.length && performance.now() - started < DS_FRAME_BUDGET_MS) {
      const step = DS_PASSES[this.passIdx]
      if (step > 1) this.blockRow(step)
      else this.pixelChunk()
    }
    this.blit()
    const done = this.passIdx >= DS_PASSES.length
    this.updateProgress(done)
    if (done) {
      this.raf = 0
      this.snap.getContext('2d')?.drawImage(this.canvas, 0, 0)
      this.commitView()
      return
    }
    this.raf = requestAnimationFrame(() => this.tick(gen))
  }

  private advancePass(rowsDone: number) {
    this.passY = rowsDone
    if (this.passY >= this.h) {
      this.passY = 0
      this.passX = 0
      this.passIdx += 1
    }
  }

  /** One row-band of a block pass: one sample per step² block, painted flat. */
  private blockRow(step: number) {
    const img = this.img
    if (!img) return
    const d = img.data
    const y0 = this.passY
    const y1 = Math.min(this.h, y0 + step)
    const cy = Math.min(this.h - 1, y0 + (step >> 1))
    for (let x0 = 0; x0 < this.w; x0 += step) {
      const cx = Math.min(this.w - 1, x0 + (step >> 1))
      const [r, g, b] = this.sample(cx, cy)
      const x1 = Math.min(this.w, x0 + step)
      for (let y = y0; y < y1; y += 1) {
        let p = (y * this.w + x0) * 4
        for (let x = x0; x < x1; x += 1) {
          d[p] = r
          d[p + 1] = g
          d[p + 2] = b
          p += 4
        }
      }
    }
    this.markDirty(y0, y1)
    this.advancePass(y1)
  }

  /** A chunk of the final per-pixel pass. Resumable mid-row: one row of a deep
   *  zoom can cost more than a whole frame's budget on its own. */
  private pixelChunk() {
    const img = this.img
    if (!img) return
    const d = img.data
    const y = this.passY
    const end = Math.min(this.w, this.passX + DS_CHUNK)
    let p = (y * this.w + this.passX) * 4
    for (let x = this.passX; x < end; x += 1) {
      const [r, g, b] = this.sample(x, y)
      d[p] = r
      d[p + 1] = g
      d[p + 2] = b
      p += 4
    }
    this.passX = end
    this.markDirty(y, y + 1)
    if (this.passX >= this.w) {
      this.passX = 0
      this.advancePass(y + 1)
    }
  }

  private markDirty(top: number, bottom: number) {
    if (top < this.dirtyTop) this.dirtyTop = top
    if (bottom > this.dirtyBottom) this.dirtyBottom = bottom
  }

  /** Only the band touched this frame is copied out. Blitting the whole backing
   *  store every frame costs more than the iteration work it is showing. */
  private blit() {
    if (!this.img || this.dirtyBottom <= this.dirtyTop) return
    this.ctx.putImageData(this.img, 0, 0, 0, this.dirtyTop, this.w, this.dirtyBottom - this.dirtyTop)
  }

  /**
   * One pixel of any view at any size — the live frame and every dive frame go
   * through here, so the recording cannot drift from what the explorer shows.
   * `px`/`py` are pixel CENTRES.
   */
  private shade(view: DsView, iter: number, px: number, py: number, w: number, h: number): [number, number, number] {
    const c = dsScreenToComplex(view, px, py, w, h)
    const e = dsEscape(view.mode, c.re, c.im, view.seedRe, view.seedIm, iter)
    if (e.n >= iter) return this.insideRGB
    const idx = Math.min(DS_LUT - 1, (dsRampPosition(e.smooth, view.density) * DS_LUT) | 0) * 3
    return [this.lut[idx], this.lut[idx + 1], this.lut[idx + 2]]
  }

  private sample(px: number, py: number): [number, number, number] {
    return this.shade(this.view, this.iterUsed, px + 0.5, py + 0.5, this.w, this.h)
  }

  private updateProgress(done: boolean) {
    const el = this.querySelector('[data-type="ds-progress"]')
    if (!el) return
    if (done) {
      el.textContent = ''
      return
    }
    // Weighted by each pass's real cost, so the number does not sit at 90% while
    // the expensive pass does nine tenths of the arithmetic.
    let workDone = 0
    for (let i = 0; i < this.passIdx; i += 1) workDone += 1 / (DS_PASSES[i] * DS_PASSES[i])
    const step = DS_PASSES[Math.min(this.passIdx, DS_PASSES.length - 1)]
    workDone += (this.passY / Math.max(1, this.h)) / (step * step)
    el.textContent = `rendering ${Math.min(99, Math.round((workDone / DS_PASS_WORK) * 100))}%`
  }

  /* ──────────────  readout  ────────────── */

  private updateReadout() {
    const set = (field: string, text: string) => {
      const el = this.querySelector(`[data-field="${field}"]`)
      if (el) el.textContent = text
    }
    const digits = Math.min(17, Math.max(4, Math.ceil(Math.log10(Math.max(1, this.view.zoom))) + 4))
    set('mode', this.view.mode === 'julia'
      ? `Julia · c = ${this.view.seedRe.toFixed(4)} ${this.view.seedIm < 0 ? '−' : '+'} ${Math.abs(this.view.seedIm).toFixed(4)}i`
      : 'Mandelbrot')
    set('centre', `${this.view.re.toFixed(digits)} ${this.view.im < 0 ? '−' : '+'} ${Math.abs(this.view.im).toFixed(digits)}i`)
    set('zoom', dsFormatZoom(this.view.zoom))
    set('iter', `${this.iterUsed || dsEffectiveIter(this.view)} iterations${this.view.iter === 0 ? ' (auto)' : ''}`)

    // State the ceiling rather than letting the picture quietly turn to mush.
    const warn = this.querySelector('[data-field="warn"]') as HTMLElement | null
    if (warn) {
      const near = this.view.zoom >= DS_PRECISION_WARN_ZOOM
      warn.hidden = !near
      if (near) {
        const span = dsPixelScale(this.view.zoom, Math.max(1, this.w))
        warn.textContent = this.view.zoom >= DS_MAX_ZOOM
          ? 'at the double-precision floor — this is as deep as 64-bit arithmetic goes'
          : `nearing the double-precision floor (${span.toExponential(1)} per pixel) — detail will start to block up`
      }
    }
  }

  private syncControls() {
    this.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === this.view.mode))
    })
    this.querySelectorAll<HTMLButtonElement>('[data-palette]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.palette === this.palette.id))
    })
    const peekBtn = this.querySelector('[data-action="peek"]') as HTMLButtonElement | null
    if (peekBtn) peekBtn.setAttribute('aria-pressed', String(this.peekOn))
    // Peek previews a Julia set for a Mandelbrot point; inside Julia mode there
    // is no such point under the cursor, so the control is off and dead there.
    if (peekBtn) peekBtn.disabled = this.view.mode === 'julia'
    this.peek.hidden = !(this.peekOn && this.view.mode === 'mandelbrot')

    const seeds = this.querySelector('[data-group="seeds"]') as HTMLElement | null
    if (seeds) seeds.hidden = this.view.mode !== 'julia'
    const entry = this.querySelector('[data-group="seed"]') as HTMLElement | null
    if (entry) entry.hidden = this.view.mode !== 'julia'
    const sre = this.querySelector('#ds-seed-re') as HTMLInputElement | null
    const sim = this.querySelector('#ds-seed-im') as HTMLInputElement | null
    if (sre && document.activeElement !== sre) sre.value = String(this.view.seedRe)
    if (sim && document.activeElement !== sim) sim.value = String(this.view.seedIm)

    const iter = this.querySelector('#ds-iter') as HTMLInputElement | null
    if (iter) iter.value = String(this.view.iter)
    const iterOut = this.querySelector('#ds-iter-out') as HTMLOutputElement | null
    if (iterOut) iterOut.textContent = this.view.iter === 0 ? `auto (${dsEffectiveIter(this.view)})` : String(this.view.iter)
    const dens = this.querySelector('#ds-density') as HTMLInputElement | null
    if (dens) dens.value = String(this.view.density)
    const densOut = this.querySelector('#ds-density-out') as HTMLOutputElement | null
    if (densOut) densOut.textContent = String(this.view.density)
    this.syncDive()
    this.updateReadout()
  }

  /* ──────────────  view changes  ────────────── */

  private setView(next: DsView, rerender = true) {
    this.view = dsClampView(next)
    this.syncControls()
    if (rerender) this.startRender()
  }

  private zoomAtPixel(px: number, py: number, factor: number) {
    this.setView(dsZoomAt(this.view, px, py, factor, this.w, this.h))
  }

  /** Canvas-relative CSS coordinates → backing-store pixels. */
  private toBacking(e: { clientX: number; clientY: number }): [number, number] {
    const rect = this.canvas.getBoundingClientRect()
    return [
      ((e.clientX - rect.left) / Math.max(1, rect.width)) * this.w,
      ((e.clientY - rect.top) / Math.max(1, rect.height)) * this.h,
    ]
  }

  private setMode(mode: DsMode, seed?: { re: number; im: number }) {
    if (mode === this.view.mode && !seed) return
    this.parked[this.view.mode] = { ...this.view }
    const resumed = this.parked[mode]
    const next: DsView = resumed && !seed
      ? { ...resumed, palette: this.view.palette, density: this.view.density }
      : {
        ...this.view,
        mode,
        re: 0,
        im: 0,
        zoom: mode === 'julia' ? 0.95 : 1,
        iter: this.view.iter,
      }
    next.mode = mode
    if (seed) {
      next.seedRe = seed.re
      next.seedIm = seed.im
    }
    if (mode === 'mandelbrot' && !resumed) {
      next.re = DS_DEFAULT_VIEW.re
      next.im = DS_DEFAULT_VIEW.im
      next.zoom = 1
    }
    this.setView(next)
  }

  /* ──────────────  Julia peek inset  ────────────── */

  private renderPeek() {
    if (!this.peekOn || this.view.mode !== 'mandelbrot') return
    const c = dsScreenToComplex(this.view, this.peekX, this.peekY, this.w, this.h)
    const size = DS_PEEK_PX
    const img = this.peekCtx.createImageData(size, size)
    const d = img.data
    // A fixed frame: the interesting Julia sets all live inside |z| < 1.6.
    const span = 3.2
    const step = span / size
    let p = 0
    for (let y = 0; y < size; y += 1) {
      const zim = span / 2 - (y + 0.5) * step
      for (let x = 0; x < size; x += 1) {
        const zre = -span / 2 + (x + 0.5) * step
        const e = dsEscape('julia', zre, zim, c.re, c.im, DS_PEEK_ITER)
        if (e.n >= DS_PEEK_ITER) {
          d[p] = this.insideRGB[0]
          d[p + 1] = this.insideRGB[1]
          d[p + 2] = this.insideRGB[2]
        } else {
          const idx = Math.min(DS_LUT - 1, (dsRampPosition(e.smooth, this.view.density) * DS_LUT) | 0) * 3
          d[p] = this.lut[idx]
          d[p + 1] = this.lut[idx + 1]
          d[p + 2] = this.lut[idx + 2]
        }
        d[p + 3] = 255
        p += 4
      }
    }
    this.peekCtx.putImageData(img, 0, 0)
    this.peek.title = `Julia set for c = ${c.re.toFixed(5)} ${c.im < 0 ? '−' : '+'} ${Math.abs(c.im).toFixed(5)}i — click to enter it`
  }

  private queuePeek(px: number, py: number) {
    this.peekX = px
    this.peekY = py
    if (this.peekPending) return
    this.peekPending = true
    requestAnimationFrame(() => {
      this.peekPending = false
      this.renderPeek()
    })
  }

  /* ──────────────  the dive recorder  ────────────── */

  private yieldTurn(ms = 0): Promise<void> {
    return new Promise(resolve => { window.setTimeout(resolve, ms) })
  }

  /**
   * One complete frame of a dive, rendered straight through at 1:1.
   *
   * Deliberately NOT the progressive ladder: that exists to keep an interactive
   * canvas responsive, and a frame destined for a file wants to be finished, not
   * early. The cost is why this is off the interaction path and why the caller
   * times it instead of assuming.
   */
  private renderTourFrameData(view: DsView, w: number, h: number): ImageData {
    const img = this.ctx.createImageData(w, h)
    const d = img.data
    const iter = dsEffectiveIter(view)
    let p = 0
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const [r, g, b] = this.shade(view, iter, x + 0.5, y + 0.5, w, h)
        d[p] = r
        d[p + 1] = g
        d[p + 2] = b
        d[p + 3] = 255
        p += 4
      }
    }
    return img
  }

  /**
   * Render the whole dive for the export bar.
   *
   * The frame count is chosen from a MEASUREMENT, not picked: both ends of the
   * dive are rendered first and timed, and the slower of the two sets the pace.
   * Neither is wasted work — they are the first and last frames, which the
   * animation needs anyway. A fixed count would mean eight seconds here and four
   * minutes on a phone at the deepest stop, where the auto-iteration budget is an
   * order of magnitude larger than it is at zoom 1.
   */
  private async recordDive(
    w: number,
    h: number,
    report: (done: number, total: number) => void,
    cancelled: () => boolean,
  ): Promise<AnimationFrames | AnimationRefusal> {
    if (this.stops.length < DS_TOUR_MIN_STOPS) {
      return {
        ok: false,
        reason: `Add at least ${DS_TOUR_MIN_STOPS} stops first — a dive needs somewhere to start and somewhere to arrive.`,
      }
    }
    const base = { ...this.view }
    const stops = this.stops.slice()
    const timed = (u: number) => {
      const started = performance.now()
      const frame = this.renderTourFrameData(dsTourViewAt(base, stops, u), w, h)
      return { frame, ms: performance.now() - started }
    }

    const first = timed(0)
    await this.yieldTurn()
    if (cancelled()) return { ok: false, reason: 'Stopped.' }
    const last = timed(1)
    const count = Math.max(2, dsTourFrameCount(Math.max(1, first.ms, last.ms)))

    const frames: ImageData[] = new Array(count)
    frames[0] = first.frame
    frames[count - 1] = last.frame
    report(2, count)
    for (let i = 1; i < count - 1; i += 1) {
      // Yield before each frame, not after: a frame is hundreds of milliseconds
      // of blocking arithmetic, and without a turn of the event loop between them
      // the progress line never repaints and the Stop button is never seen.
      await this.yieldTurn()
      if (cancelled()) return { ok: false, reason: `Stopped after ${i + 1} of ${count} frames.` }
      frames[i] = this.renderTourFrameData(dsTourViewAt(base, stops, i / (count - 1)), w, h)
      report(i + 2, count)
    }

    return {
      ok: true,
      frames,
      delay: dsTourDelay(count),
      note: `GIF · ${w}×${h} · ${count} frames · ${stops.length} stops · ${dsTourDecades(stops).toFixed(1)} decades of zoom`,
    }
  }

  /**
   * Play the dive on the canvas itself, at the recording resolution.
   *
   * Same frames, same code path, cheaper size — so this is a rehearsal of the
   * actual file rather than a different animation that might disagree with it.
   * The live view is restored at the end: a preview is not a state change.
   */
  private async playDive() {
    if (this.diveBusy || this.stops.length < DS_TOUR_MIN_STOPS) return
    const w = Math.max(2, Math.min(DS_TOUR_PREVIEW_PX, this.w))
    const h = Math.max(2, Math.round(w * (this.h / Math.max(1, this.w))))
    const scratch = document.createElement('canvas')
    scratch.width = w
    scratch.height = h
    const sctx = scratch.getContext('2d')
    if (!sctx) return

    const progress = this.querySelector('[data-type="ds-progress"]')
    const base = { ...this.view }
    const stops = this.stops.slice()
    this.diveBusy = true
    this.syncDive()
    // Abandon the explorer's in-flight render: it belongs to a view the canvas
    // is about to stop showing.
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.gen += 1

    try {
      const started = performance.now()
      const firstFrame = this.renderTourFrameData(dsTourViewAt(base, stops, 0), w, h)
      const count = Math.max(2, dsTourFrameCount(Math.max(1, performance.now() - started), DS_TOUR_PREVIEW_BUDGET_MS))
      const delay = dsTourDelay(count)
      for (let i = 0; i < count; i += 1) {
        if (!this.diveBusy || !this.isConnected) break
        const frameStart = performance.now()
        const frame = i === 0
          ? firstFrame
          : this.renderTourFrameData(dsTourViewAt(base, stops, i / (count - 1)), w, h)
        sctx.putImageData(frame, 0, 0)
        this.ctx.imageSmoothingEnabled = true
        this.ctx.drawImage(scratch, 0, 0, this.w, this.h)
        if (progress) progress.textContent = `dive ${i + 1}/${count}`
        await this.yieldTurn(Math.max(0, delay - (performance.now() - frameStart)))
      }
    } finally {
      this.diveBusy = false
      if (progress) progress.textContent = ''
      this.syncDive()
      this.startRender()
    }
  }

  private addStop() {
    const btn = this.querySelector('[data-action="add-stop"]') as HTMLButtonElement | null
    if (this.stops.length >= DS_TOUR_MAX_STOPS) {
      flashLabel(btn, `${DS_TOUR_MAX_STOPS} stops is the limit`)
      return
    }
    this.stops = dsNormalizeStops([...this.stops, dsStopFromView(this.view)])
    this.commitView()
    this.syncDive()
    flashLabel(btn, `Stop ${this.stops.length} added`)
  }

  private dropStop(index: number) {
    if (!this.stops[index]) return
    this.stops = this.stops.filter((_, i) => i !== index)
    this.commitView()
    this.syncDive()
  }

  private clearStops() {
    if (this.stops.length === 0) return
    this.stops = []
    this.commitView()
    this.syncDive()
  }

  private gotoStop(index: number) {
    const stop = this.stops[index]
    if (!stop) return
    this.setView({ ...this.view, re: stop.re, im: stop.im, zoom: stop.zoom })
  }

  private copyDiveLink() {
    const btn = this.querySelector('[data-action="copy-dive"]') as HTMLButtonElement | null
    const tour = dsEncodeTour(this.view, this.stops)
    if (!tour) {
      flashLabel(btn, `Needs ${DS_TOUR_MIN_STOPS} stops`)
      return
    }
    // The view key points at the dive's own first stop, so opening the link shows
    // the frame the animation starts on rather than wherever the sender drifted
    // to afterwards.
    const start = dsEncodeView(dsTourViewAt(this.view, this.stops, 0))
    const url = `${location.origin}${location.pathname}#view=${start}&tour=${tour}`
    if (!navigator.clipboard?.writeText) {
      flashLabel(btn, 'Copy unavailable')
      return
    }
    navigator.clipboard.writeText(url)
      .then(() => flashLabel(btn, 'Dive link copied'))
      .catch(() => flashLabel(btn, 'Copy failed'))
  }

  private syncDive() {
    const count = this.stops.length
    const label = this.querySelector('[data-type="ds-dive-count"]')
    if (label) {
      label.textContent = count === 0
        ? 'no stops yet — zoom somewhere good, then add one'
        : count === 1
          ? '1 stop — add another and the dive can be recorded'
          : `${count} stops · ${dsTourDecades(this.stops).toFixed(1)} decades of zoom`
    }

    const playable = count >= DS_TOUR_MIN_STOPS
    const play = this.querySelector('[data-action="play-dive"]') as HTMLButtonElement | null
    if (play) {
      // Disabled only when there is nothing to play. While a preview is running
      // this button IS the stop control, so it must stay live.
      play.disabled = this.diveBusy ? false : !playable
      play.textContent = this.diveBusy ? 'Stop' : 'Preview'
      play.setAttribute('aria-pressed', String(this.diveBusy))
    }
    const add = this.querySelector('[data-action="add-stop"]') as HTMLButtonElement | null
    if (add) add.disabled = count >= DS_TOUR_MAX_STOPS || this.diveBusy
    const copy = this.querySelector('[data-action="copy-dive"]') as HTMLButtonElement | null
    if (copy) copy.disabled = !playable
    const clear = this.querySelector('[data-action="clear-dive"]') as HTMLButtonElement | null
    if (clear) clear.disabled = count === 0 || this.diveBusy

    const list = this.querySelector('[data-type="ds-stops"]') as HTMLElement | null
    if (!list) return
    list.hidden = count === 0
    // Rebuilt only when the stops themselves changed: syncDive runs on every view
    // change, and replacing this markup underneath a keyboard user would throw
    // focus off the button they just used.
    const signature = this.stops.map(s => `${s.re}|${s.im}|${s.zoom}`).join('~')
    if (signature === this.stopsRendered) return
    this.stopsRendered = signature
    list.innerHTML = this.stops.map((stop, i) => `
      <li>
        <button data-goto="${i}" type="button" title="Go to this stop">${i + 1}</button>
        <span>${dsEscapeAttr(dsStopLabel(stop))}</span>
        <button data-drop="${i}" type="button" title="Remove this stop" aria-label="Remove stop ${i + 1}">×</button>
      </li>`).join('')
    list.querySelectorAll<HTMLButtonElement>('[data-goto]').forEach(btn => {
      btn.addEventListener('click', () => this.gotoStop(Number(btn.dataset.goto)))
    })
    list.querySelectorAll<HTMLButtonElement>('[data-drop]').forEach(btn => {
      btn.addEventListener('click', () => this.dropStop(Number(btn.dataset.drop)))
    })
  }

  /* ──────────────  wiring  ────────────── */

  private wire() {
    this.querySelector('[data-action="add-stop"]')?.addEventListener('click', () => this.addStop())
    this.querySelector('[data-action="clear-dive"]')?.addEventListener('click', () => this.clearStops())
    this.querySelector('[data-action="copy-dive"]')?.addEventListener('click', () => this.copyDiveLink())
    this.querySelector('[data-action="play-dive"]')?.addEventListener('click', () => {
      if (this.diveBusy) {
        this.diveBusy = false
        return
      }
      void this.playDive()
    })

    this.querySelector('[data-action="zoom-in"]')?.addEventListener('click', () => this.zoomAtPixel(this.w / 2, this.h / 2, 2))
    this.querySelector('[data-action="zoom-out"]')?.addEventListener('click', () => this.zoomAtPixel(this.w / 2, this.h / 2, 0.5))
    this.querySelector('[data-action="reset"]')?.addEventListener('click', () => this.reset())
    this.querySelector('[data-action="copy-link"]')?.addEventListener('click', () => this.copyLink())
    this.querySelector('[data-action="peek"]')?.addEventListener('click', () => {
      this.peekOn = !this.peekOn
      dsWriteStored(DS_LS_PEEK, this.peekOn ? '1' : '0')
      this.syncControls()
      if (this.peekOn) this.renderPeek()
    })

    this.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode as DsMode))
    })

    this.querySelectorAll<HTMLButtonElement>('[data-place]').forEach(btn => {
      btn.addEventListener('click', () => {
        const place = DS_PLACES.find(p => p.id === btn.dataset.place)
        if (!place) return
        // A tour stop is a Mandelbrot location, so leaving Julia mode parks the
        // Julia frame the same way the mode buttons do — the seed and the spot
        // are still there when you switch back.
        if (this.view.mode === 'julia') this.parked.julia = { ...this.view }
        this.setView({ ...this.view, mode: 'mandelbrot', re: place.re, im: place.im, zoom: place.zoom })
      })
    })

    this.querySelectorAll<HTMLButtonElement>('[data-seed]').forEach(btn => {
      btn.addEventListener('click', () => {
        const seed = DS_SEEDS[Number(btn.dataset.seed)]
        if (!seed) return
        this.setView({ ...this.view, mode: 'julia', seedRe: seed.re, seedIm: seed.im, re: 0, im: 0, zoom: 0.95 })
      })
    })

    const seedInputs = ['#ds-seed-re', '#ds-seed-im'].map(sel => this.querySelector(sel) as HTMLInputElement | null)
    const applySeed = () => {
      const [reIn, imIn] = seedInputs
      if (!reIn || !imIn) return
      const re = Number(reIn.value)
      const im = Number(imIn.value)
      if (!Number.isFinite(re) || !Number.isFinite(im) || Math.abs(re) > 4 || Math.abs(im) > 4) {
        reIn.value = String(this.view.seedRe)
        imIn.value = String(this.view.seedIm)
        return
      }
      this.setView({ ...this.view, mode: 'julia', seedRe: re, seedIm: im })
    }
    seedInputs.forEach(input => {
      input?.addEventListener('change', applySeed)
      input?.addEventListener('keydown', e => {
        if ((e as KeyboardEvent).key === 'Enter') {
          e.preventDefault()
          applySeed()
        }
      })
    })

    this.querySelectorAll<HTMLButtonElement>('[data-palette]').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = DS_PALETTES.find(p => p.id === btn.dataset.palette)
        if (!next) return
        this.palette = next.colors.length ? next : DS_PALETTES[0]
        this.buildLut()
        this.setView({ ...this.view, palette: this.palette.id })
        if (this.peekOn) this.renderPeek()
      })
    })

    const iterInput = this.querySelector('#ds-iter') as HTMLInputElement | null
    iterInput?.addEventListener('input', () => {
      const raw = Number(iterInput.value)
      // The slider's zero position is "auto"; below the floor it snaps there
      // rather than pretending 20 iterations is a detail setting anyone wants.
      const iter = raw < DS_ITER_MIN ? 0 : Math.round(dsClamp(raw, DS_ITER_MIN, DS_ITER_MAX))
      this.setView({ ...this.view, iter })
    })

    const densInput = this.querySelector('#ds-density') as HTMLInputElement | null
    densInput?.addEventListener('input', () => {
      this.setView({ ...this.view, density: Number(densInput.value) })
      if (this.peekOn) this.renderPeek()
    })

    this.canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false })
    this.canvas.addEventListener('pointerdown', e => this.onPointerDown(e))
    this.canvas.addEventListener('pointermove', e => this.onPointerMove(e))
    this.canvas.addEventListener('pointerup', e => this.onPointerUp(e))
    this.canvas.addEventListener('pointercancel', () => this.cancelDrag())
    this.canvas.addEventListener('pointerleave', () => {
      if (!this.dragging) this.peek.removeAttribute('data-live')
    })
    this.canvas.addEventListener('keydown', e => this.onKey(e))
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault()
    const [px, py] = this.toBacking(e)
    // deltaMode 0 is pixels (trackpads, ~100 per notch); 1 is LINES and 2 is
    // PAGES, where the same gesture arrives as a single digit. Without the
    // scaling a line-mode mouse wheel zooms by about 1% per notch and the tool
    // feels broken on exactly the hardware most likely to be used with it.
    const raw = e.deltaMode === 0 ? e.deltaY : e.deltaY * 100
    const notches = dsClamp(raw, -120, 120) / 120
    this.zoomAtPixel(px, py, Math.pow(DS_ZOOM_STEP, -notches * 2))
  }

  private onPointerDown(e: PointerEvent) {
    this.canvas.focus()
    this.dragging = true
    this.dragId = e.pointerId
    const [px, py] = this.toBacking(e)
    this.dragFromX = px
    this.dragFromY = py
    this.dragDX = 0
    this.dragDY = 0
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      /* older browsers */
    }
  }

  private onPointerMove(e: PointerEvent) {
    const [px, py] = this.toBacking(e)
    if (this.dragging && e.pointerId === this.dragId) {
      this.dragDX = px - this.dragFromX
      this.dragDY = py - this.dragFromY
      if (Math.abs(this.dragDX) > 1 || Math.abs(this.dragDY) > 1) {
        // Show the last completed frame, shifted. Re-rendering per pointer move
        // at three thousand iterations a pixel is not a thing a browser can do.
        cancelAnimationFrame(this.raf)
        this.raf = 0
        this.gen += 1
        this.ctx.fillStyle = `rgb(${this.insideRGB.join(',')})`
        this.ctx.fillRect(0, 0, this.w, this.h)
        this.ctx.drawImage(this.snap, this.dragDX, this.dragDY)
      }
      return
    }
    this.peek.dataset.live = '1'
    this.queuePeek(px, py)
  }

  private onPointerUp(e: PointerEvent) {
    if (!this.dragging || e.pointerId !== this.dragId) return
    const movedX = this.dragDX
    const movedY = this.dragDY
    this.cancelDrag()
    const moved = Math.hypot(movedX, movedY)
    if (moved > 3) {
      const s = dsPixelScale(this.view.zoom, this.w)
      this.setView({ ...this.view, re: this.view.re - movedX * s, im: this.view.im + movedY * s })
      return
    }
    // A click, not a drag.
    const [px, py] = this.toBacking(e)
    if (this.peekOn && this.view.mode === 'mandelbrot' && !e.altKey && !e.shiftKey) {
      const c = dsScreenToComplex(this.view, px, py, this.w, this.h)
      this.setMode('julia', c)
      return
    }
    this.zoomAtPixel(px, py, e.altKey || e.shiftKey ? 1 / (DS_ZOOM_STEP * DS_ZOOM_STEP) : DS_ZOOM_STEP * DS_ZOOM_STEP)
  }

  private cancelDrag() {
    if (this.dragging) {
      try {
        this.canvas.releasePointerCapture(this.dragId)
      } catch {
        /* capture may already be gone */
      }
    }
    this.dragging = false
    this.dragId = -1
  }

  private onKey(e: KeyboardEvent) {
    const stepFraction = e.shiftKey ? 0.5 : 0.12
    const pan = (fx: number, fy: number) => {
      const s = dsPixelScale(this.view.zoom, this.w)
      this.setView({
        ...this.view,
        re: this.view.re + fx * this.w * stepFraction * s,
        im: this.view.im - fy * this.h * stepFraction * s,
      })
    }
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); pan(-1, 0); break
      case 'ArrowRight': e.preventDefault(); pan(1, 0); break
      case 'ArrowUp': e.preventDefault(); pan(0, -1); break
      case 'ArrowDown': e.preventDefault(); pan(0, 1); break
      case '+': case '=': e.preventDefault(); this.zoomAtPixel(this.w / 2, this.h / 2, 2); break
      case '-': case '_': e.preventDefault(); this.zoomAtPixel(this.w / 2, this.h / 2, 0.5); break
      case '0': e.preventDefault(); this.reset(); break
      case 'j': case 'J': e.preventDefault(); this.setMode(this.view.mode === 'julia' ? 'mandelbrot' : 'julia'); break
      case 'a': case 'A': e.preventDefault(); this.addStop(); break
      case 'l': case 'L': e.preventDefault(); this.copyLink(); break
      default: break
    }
  }

  private reset() {
    this.parked = {}
    this.setView({ ...DS_DEFAULT_VIEW, palette: this.palette.id, density: this.view.density, iter: this.view.iter })
  }

  private copyLink() {
    const btn = this.querySelector('[data-action="copy-link"]') as HTMLButtonElement | null
    const url = `${location.origin}${location.pathname}#view=${dsEncodeView(this.view)}`
    if (!navigator.clipboard?.writeText) {
      flashLabel(btn, 'Copy unavailable')
      return
    }
    navigator.clipboard.writeText(url)
      .then(() => flashLabel(btn, 'Link copied'))
      .catch(() => flashLabel(btn, 'Copy failed'))
  }
}

if (!customElements.get('deep-shore-game')) {
  customElements.define('deep-shore-game', DeepShoreGame)
}

export {}
