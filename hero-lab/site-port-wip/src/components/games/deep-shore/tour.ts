/**
 * Deep Shore — the dive recorder: a path through the plane, and the rule for
 * moving along it.
 *
 * The explorer's export used to write a still frame, which is the wrong artifact
 * for a tool whose whole appeal is the descent. A dive is a list of **stops**
 * (places you actually stopped at) plus one question: what does the view look
 * like a fraction `u` of the way along? Answer that correctly and the animation,
 * the on-canvas preview and the GIF are all the same code reading the same path.
 *
 * Everything here is pure and DOM-free, which is what lets `security:smoke` hold
 * it to the two properties below rather than to a screenshot. Both fail
 * silently — a wrong dive still renders a perfectly pretty animation.
 *
 *   1. **Zoom moves geometrically, and the pan is weighted by the zoom.**
 *      Zoom is multiplicative: each frame should magnify by the same *factor*,
 *      so it is `log(zoom)` that is interpolated linearly. The pan is the part
 *      that is easy to get wrong and impossible to see one frame at a time. Move
 *      the centre linearly in `u` and the target's speed *across the screen*
 *      grows with the zoom — the pan then happens almost entirely in the last
 *      few frames, where a pixel is worth a millionth of what it was worth at the
 *      start, so the destination whips past the viewport at the exact moment it
 *      was supposed to arrive. The fix is to ask for constant apparent speed:
 *      dc/du ∝ 1/zoom(u), which integrates to `dsPanWeight` below and front-loads
 *      the pan into the cheap, zoomed-out part of the dive. That is the
 *      well-known shape of a good zoom-and-pan and it is asserted as a property
 *      (equal screen-space steps), not as a remembered number — with the naive
 *      linear version held up beside it and required to FAIL the same check, so
 *      the assertion is known to have teeth.
 *
 *   2. **The `#tour=` permalink is bounded at mint and at decode, and never
 *      throws.** It inherits `#view=`'s hard-won precision rule — a stop's
 *      coordinates are written to a digit count derived from that stop's own
 *      zoom, because six decimals is coarser than the whole viewport past a zoom
 *      of 10⁵ — by reusing `dsEncodeView` for the first stop and the exported
 *      field parsers for the rest. There is deliberately no second copy of the
 *      coordinate, zoom or palette validation in this file.
 *
 * A third bound is a cost ceiling, and per AGENTS.md it is written in the unit
 * that actually costs. Frames are not the cost; **pixel-iterations** are, and how
 * many of those a machine gets through per millisecond is not knowable from here.
 * So `dsTourFrameCount` takes a MEASURED per-frame cost (the component times its
 * first frame) and spends a time budget, instead of a frame count fixed at a
 * number that means eight seconds on a laptop and four minutes on a phone.
 *
 * Names are prefixed `ds`/`DS_`: game component files share one global TS script
 * scope, so unprefixed helpers collide with the sibling toys at `astro check`
 * time.
 */

import {
  DS_BASE_SPAN,
  DS_MAX_COORD,
  DS_MAX_ZOOM,
  DS_MIN_ZOOM,
  dsClamp,
  dsClampView,
  dsCoordDigits,
  dsDecodeView,
  dsDecodeZoomCode,
  dsEncodeView,
  dsEncodeZoom,
  dsParseCoord,
  dsTrimNumber,
  type DsView,
} from './escape'

/** One place on the path. Only the geometry: the fractal, the palette, the
 *  detail and the colour density belong to the dive as a whole, not to a stop. */
export interface DsStop {
  re: number
  im: number
  zoom: number
}

export interface DsTour {
  /** Supplies mode / palette / density / iter / seed. Its own re/im/zoom are the
   *  first stop's, so a decoded tour is a view the explorer can simply adopt. */
  view: DsView
  stops: DsStop[]
}

/** Two stops are a dive; one is a destination. */
export const DS_TOUR_MIN_STOPS = 2
/**
 * Upper bound on stops. Not a UI taste — it is what keeps the token bounded and
 * the render finite, and eight legs is already a longer dive than anyone watches.
 */
export const DS_TOUR_MAX_STOPS = 8

/** Frame bounds. The floor is "still an animation"; the ceiling bounds both the
 *  encode time and the retained ImageData (48 × 480×298 × 4B ≈ 27 MB). */
export const DS_TOUR_MIN_FRAMES = 8
export const DS_TOUR_MAX_FRAMES = 48

/** Rendering time one dive may spend, before encoding. */
export const DS_TOUR_BUDGET_MS = 9000
/** Playback length aimed at when choosing the GIF frame delay. */
export const DS_TOUR_TARGET_MS = 4200
/** GIF's clock counts centiseconds, so delays are rounded to 10ms. */
export const DS_TOUR_DELAY_MIN = 40
export const DS_TOUR_DELAY_MAX = 200
/** Frames of the final view held at the end, so a looping GIF reads as arriving
 *  somewhere rather than snapping back mid-dive. Cheap: they reuse one frame. */
export const DS_TOUR_HOLD_FRAMES = 5

/**
 * Hard ceiling on a `#tour=` token before any parsing.
 *
 * Derived, not guessed: eight stops at the widest a stop can legally be
 * (`DS_COORD_MAX_CHARS` = 32 per coordinate, plus a zoom code and separators)
 * plus a julia head carrying a seed comes to ~640 characters. The slack is for a
 * field this format grows later; anything past it is not a link this encoder
 * could have minted.
 */
export const DS_TOUR_MAX_TOKEN_CHARS = 800

const DS_COUNT_RE = /^\d+$/

/** Clamp one stop into the plane the explorer can actually show. */
export function dsClampStop(stop: DsStop): DsStop {
  return {
    re: dsClamp(stop.re, -DS_MAX_COORD, DS_MAX_COORD),
    im: dsClamp(stop.im, -DS_MAX_COORD, DS_MAX_COORD),
    zoom: dsClamp(stop.zoom, DS_MIN_ZOOM, DS_MAX_ZOOM),
  }
}

export function dsStopFromView(view: DsView): DsStop {
  return { re: view.re, im: view.im, zoom: view.zoom }
}

/**
 * Clamp every stop and cap the count. Minting through this is what makes an
 * out-of-range stop on decode *proof* of a hand-built token rather than
 * something this code could have produced — the posture `#view=` already takes.
 */
export function dsNormalizeStops(stops: readonly DsStop[]): DsStop[] {
  if (!Array.isArray(stops)) return []
  return stops
    .filter(s => s && Number.isFinite(s.re) && Number.isFinite(s.im) && Number.isFinite(s.zoom) && s.zoom > 0)
    .slice(0, DS_TOUR_MAX_STOPS)
    .map(dsClampStop)
}

/* ──────────────────────────  moving along the path  ────────────────────────── */

/**
 * Geometric interpolation: constant magnification per unit of `t`.
 *
 * The endpoints are returned by branch rather than by arithmetic. `a·(b/a)^1` is
 * not exactly `b` in floating point, and a dive that stops a hair short of the
 * place it was told to reach is a dive whose last frame disagrees with the
 * permalink it was minted from.
 */
export function dsLogLerp(a: number, b: number, t: number): number {
  if (t <= 0) return a
  if (t >= 1) return b
  if (!(a > 0) || !(b > 0)) return a
  return a * Math.pow(b / a, t)
}

/**
 * How much of a segment's pan has happened by `t` — the correctness heart of a
 * dive.
 *
 * Constant apparent speed means |dc/dt| · zoom(t) is constant, so dc/dt ∝ 1/zoom.
 * With zoom(t) = z₀·r^t (r = z₁/z₀), integrating and normalising gives
 *
 *     w(t) = (1 − r^−t) / (1 − r^−1)
 *
 * which is 0 at t=0 and exactly 1 at t=1, and which front-loads the pan when
 * diving in (r > 1) and back-loads it when pulling out (r < 1) — in both cases
 * doing the travelling while the screen is cheap. Constant zoom (r = 1) has no
 * weighting to apply and falls back to linear, which is the same limit.
 */
export function dsPanWeight(z0: number, z1: number, t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  if (!(z0 > 0) || !(z1 > 0)) return t
  const r = z1 / z0
  if (!Number.isFinite(r) || r <= 0) return t
  const lnr = Math.log(r)
  if (!Number.isFinite(lnr) || Math.abs(lnr) < 1e-12) return t
  return (1 - Math.pow(r, -t)) / (1 - 1 / r)
}

/**
 * Distance the centre travels across the screen over one segment, in viewport
 * widths.
 *
 * Under `dsPanWeight` the apparent speed is constant, so this closed form is the
 * whole segment's screen-space length: |Δc| · z₀·ln r / ((1 − 1/r) · span). The
 * r → 1 limit of that factor is z₀, which is the constant-zoom case.
 *
 * It exists so a pure pan (no zoom change at all) still gets frames. Weighting a
 * dive by zoom decades alone would give a sideways drift along the coastline zero
 * duration and skip it entirely.
 */
export function dsSegmentScreenSpan(a: DsStop, b: DsStop): number {
  const dist = Math.hypot(b.re - a.re, b.im - a.im)
  if (dist === 0) return 0
  const r = b.zoom / a.zoom
  const lnr = Math.log(r)
  const rate = !Number.isFinite(lnr) || Math.abs(lnr) < 1e-12 ? a.zoom : (a.zoom * lnr) / (1 - 1 / r)
  const span = (dist * Math.abs(rate)) / DS_BASE_SPAN
  return Number.isFinite(span) ? span : 0
}

/**
 * How much of the dive one segment is worth: its zoom decades and its
 * screen-space travel combined. Both are already in perceptual units (a doubling
 * of magnification; a viewport width), so a plain length over the two is a
 * reasonable pace — and it means a long dive with one tiny hop does not spend a
 * fifth of its frames on the hop.
 */
export function dsSegmentWeight(a: DsStop, b: DsStop): number {
  const decades = Math.abs(Math.log2(b.zoom / a.zoom))
  const w = Math.hypot(Number.isFinite(decades) ? decades : 0, dsSegmentScreenSpan(a, b))
  return Number.isFinite(w) ? w : 0
}

/**
 * One segment, at local position `t`.
 *
 * Exported for the assertions, which is not incidental: `dsTourViewAt`'s own
 * `t >= 1` shortcut hides this function's end-point branch from every test that
 * only asks for the last frame of a dive, and a mutation removing the branch
 * here survived exactly that way once.
 */
export function dsSegmentViewAt(base: DsView, a: DsStop, b: DsStop, t: number): DsView {
  // The two branches are NOT symmetric, and the asymmetry is a fact about
  // floating point rather than a style choice: `a + (b − a)·0` is exactly `a`
  // for any finite pair, so the start branch is a guard, while `a + (b − a)·1`
  // is routinely a hair off `b`, so the end branch is load-bearing. Mutation
  // testing says the same thing — disabling the first survives, disabling the
  // second is caught.
  if (t <= 0) return dsClampView({ ...base, re: a.re, im: a.im, zoom: a.zoom })
  if (t >= 1) return dsClampView({ ...base, re: b.re, im: b.im, zoom: b.zoom })
  const w = dsPanWeight(a.zoom, b.zoom, t)
  return dsClampView({
    ...base,
    re: a.re + (b.re - a.re) * w,
    im: a.im + (b.im - a.im) * w,
    zoom: dsLogLerp(a.zoom, b.zoom, t),
  })
}

/**
 * The view a fraction `u` of the way along the whole dive.
 *
 * `u` is global and the segments are weighted, so the pace does not jump at a
 * stop. `base` carries everything that is not geometry (which fractal, which
 * palette, how much detail) — deliberately taken from the live view at record
 * time rather than frozen into each stop, so recolouring the explorer recolours
 * the dive instead of silently recording last week's palette.
 */
export function dsTourViewAt(base: DsView, stops: readonly DsStop[], u: number): DsView {
  const path = dsNormalizeStops(stops)
  const at = (s: DsStop) => dsClampView({ ...base, re: s.re, im: s.im, zoom: s.zoom })
  if (path.length === 0) return dsClampView(base)
  if (path.length === 1) return at(path[0])

  // An out-of-range frame index clamps to the nearest end: extrapolating past
  // the destination would fly through it and out the far side. ±Infinity has an
  // order and clamps; NaN has none, so it falls back to the start.
  const t = typeof u === 'number' && !Number.isNaN(u) ? dsClamp(u, 0, 1) : 0
  const weights: number[] = []
  let total = 0
  for (let i = 1; i < path.length; i += 1) {
    const w = dsSegmentWeight(path[i - 1], path[i])
    weights.push(w)
    total += w
  }
  // Every stop is the same place. That is a still, and saying so beats dividing
  // by zero and rendering NaN coordinates as a blank frame.
  if (!(total > 0)) return at(t >= 1 ? path[path.length - 1] : path[0])
  if (t <= 0) return at(path[0])
  if (t >= 1) return at(path[path.length - 1])

  const target = t * total
  let acc = 0
  for (let i = 0; i < weights.length; i += 1) {
    const next = acc + weights[i]
    if (target <= next || i === weights.length - 1) {
      const local = weights[i] > 0 ? (target - acc) / weights[i] : 0
      return dsSegmentViewAt(base, path[i], path[i + 1], dsClamp(local, 0, 1))
    }
    acc = next
  }
  return at(path[path.length - 1])
}

/** Total zoom decades a dive covers — what the UI quotes as its depth. */
export function dsTourDecades(stops: readonly DsStop[]): number {
  const path = dsNormalizeStops(stops)
  let decades = 0
  for (let i = 1; i < path.length; i += 1) {
    decades += Math.abs(Math.log10(path[i].zoom / path[i - 1].zoom))
  }
  return decades
}

/* ──────────────────────────  the cost ceiling  ────────────────────────── */

/**
 * How many frames to render, given how long ONE measured frame took.
 *
 * The frame count is not the cost and cannot be chosen in advance: the same dive
 * is pixels × iterations of work per frame, and at depth the auto-iteration
 * budget is an order of magnitude larger than it is at zoom 1. A count fixed at
 * thirty is eight seconds on a laptop and four minutes on a phone — which is why
 * this takes a measurement and spends a time budget instead.
 *
 * Bounded at both ends: the floor is what still reads as motion, and a dive too
 * expensive even for that is reported by the caller with an estimate rather than
 * quietly started.
 */
export function dsTourFrameCount(msPerFrame: number, budgetMs: number = DS_TOUR_BUDGET_MS): number {
  if (!Number.isFinite(msPerFrame) || msPerFrame <= 0) return DS_TOUR_MAX_FRAMES
  const budget = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : DS_TOUR_BUDGET_MS
  const affordable = Math.floor(budget / msPerFrame)
  return Math.round(dsClamp(affordable, DS_TOUR_MIN_FRAMES, DS_TOUR_MAX_FRAMES))
}

/** GIF frame delay for a frame count, so a short dive is not over in half a
 *  second and a long one does not crawl. Rounded to GIF's centisecond clock. */
export function dsTourDelay(frames: number): number {
  const n = Number.isFinite(frames) && frames > 0 ? frames : DS_TOUR_MIN_FRAMES
  const raw = dsClamp(DS_TOUR_TARGET_MS / n, DS_TOUR_DELAY_MIN, DS_TOUR_DELAY_MAX)
  return Math.max(DS_TOUR_DELAY_MIN, Math.round(raw / 10) * 10)
}

/* ──────────────────────────  the permalink  ────────────────────────── */

/**
 * Serialise a dive:
 *
 *   t1,<stopCount>,<a full #view= token for stop 1>,<re,im,zoomCode>…
 *
 * The first stop rides as a complete view token so the fractal, palette, detail
 * and seed travel with the dive and the whole head is validated on decode by
 * `dsDecodeView` — the one decoder, not a second implementation of the same
 * bounds. Later stops carry geometry only, written to the digit count their own
 * zoom justifies (`dsCoordDigits`), which is the precision rule `#view=` exists
 * to document.
 *
 * Returns '' for anything that is not a dive, so a caller can append the key
 * only when there is something to share.
 */
export function dsEncodeTour(base: DsView, stops: readonly DsStop[]): string {
  const path = dsNormalizeStops(stops)
  if (path.length < DS_TOUR_MIN_STOPS) return ''
  const head = dsEncodeView({ ...base, re: path[0].re, im: path[0].im, zoom: path[0].zoom })
  const rest = path.slice(1).map(stop => {
    const digits = dsCoordDigits(stop.zoom)
    return [dsTrimNumber(stop.re, digits), dsTrimNumber(stop.im, digits), String(dsEncodeZoom(stop.zoom))].join(',')
  })
  return ['t1', String(path.length), head, ...rest].join(',')
}

/**
 * Parse a dive token, or null.
 *
 * Never throws: a malformed or truncated link costs the shared dive, not the
 * explorer, which then opens as an ordinary session. Bounded before any parsing
 * (token length), then in structure (the version tag, a stop count inside
 * bounds, and a field count that must match that stop count EXACTLY — so a
 * truncated link is rejected rather than silently played as a shorter dive), and
 * then per field by the shared parsers.
 */
export function dsDecodeTour(token: string): DsTour | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > DS_TOUR_MAX_TOKEN_CHARS) return null
  const parts = token.split(',')
  if (parts[0] !== 't1') return null
  if (!DS_COUNT_RE.test(parts[1] ?? '')) return null
  const count = Number(parts[1])
  if (!Number.isFinite(count) || count < DS_TOUR_MIN_STOPS || count > DS_TOUR_MAX_STOPS) return null

  // The head's own length depends on its mode, and the mode field is inside it.
  const mode = parts[3]
  const headLen = mode === 'j' ? 10 : mode === 'm' ? 8 : 0
  if (headLen === 0) return null
  if (parts.length !== 2 + headLen + (count - 1) * 3) return null

  const view = dsDecodeView(parts.slice(2, 2 + headLen).join(','))
  if (!view) return null

  const stops: DsStop[] = [{ re: view.re, im: view.im, zoom: view.zoom }]
  for (let i = 0; i < count - 1; i += 1) {
    const at = 2 + headLen + i * 3
    const re = dsParseCoord(parts[at])
    const im = dsParseCoord(parts[at + 1])
    const zoom = dsDecodeZoomCode(parts[at + 2])
    if (re === null || im === null || zoom === null) return null
    stops.push({ re, im, zoom })
  }
  return { view, stops }
}

/** Pull a `#tour=` token out of a location hash. The fragment carries `view` as
 *  well, `&`-joined — which is why `dsTokenFromHash` was written to tolerate
 *  other keys from the start. */
export function dsTourTokenFromHash(hash: string): string | null {
  const m = /[#&]tour=([^&]+)/.exec(hash || '')
  return m ? m[1] : null
}
