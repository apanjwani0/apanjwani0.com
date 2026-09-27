/**
 * Deep Shore — the maths and the permalink, kept out of the component.
 *
 * Per AGENTS.md ("a tool's claims live in a module, not in the component"), the
 * three things this explorer can be *wrong* about live here so
 * `security:smoke` can run them against the real thing rather than against a
 * screenshot:
 *
 *   1. The escape-time iteration itself, including the smooth (continuous)
 *      colouring value. A wrong picture still renders happily.
 *   2. Zoom-at-the-cursor, which is a FIXED-POINT property: the complex number
 *      under the pointer must be the same number after the zoom. Getting this
 *      wrong does not throw — the view merely drifts away from whatever you
 *      were aiming at, a little more with every notch, which is exactly the
 *      kind of bug nobody can see in a single frame.
 *   3. The `#view=` permalink. It is client-minted and client-consumed, but a
 *      fragment is still untrusted input anyone can hand-build, so it is
 *      bounded in every dimension at mint AND at decode, and decoding never
 *      throws. And it carries a requirement no other permalink on this site
 *      has: **enough digits**. A centre rounded to six decimals is a different
 *      place entirely once you are past a zoom of 10^6, so the naive version of
 *      this feature silently teleports the recipient somewhere else. The digit
 *      count is therefore derived from the zoom (`dsCoordDigits`) rather than
 *      fixed, and the round trip is asserted to land inside half a pixel.
 *
 * Everything here is pure and dependency-free, so it bundles into the browser
 * chunk and imports into Node (the smoke test) equally well.
 *
 * Module-level names are prefixed `ds`/`DS_`: the game component files share one
 * global TS script scope, so unprefixed helpers (clamp, PALETTES, LS_*) collide
 * with the sibling toys at `astro check` time.
 */

/** Complex width of the viewport at zoom 1 — the whole set plus a margin. */
export const DS_BASE_SPAN = 3.5

/** Zoom floor: any further out and the set is a dot in a field of nothing. */
export const DS_MIN_ZOOM = 0.2

/**
 * Zoom ceiling, and it is a statement about doubles rather than a preference.
 *
 * The per-pixel step is `DS_BASE_SPAN / zoom / pixelWidth`. At zoom 1e13 on a
 * 3840px-wide canvas that step is about 9e-17, while the gap between adjacent
 * doubles near a coordinate of magnitude 1 is about 2.2e-16 — so by then
 * neighbouring pixels are asking for numbers the format cannot tell apart and
 * the image blocks up. This is the real floor, not the encoding's (see
 * `dsCoordDigits`), and the UI says so as you approach it instead of letting
 * the picture quietly turn to mush.
 */
export const DS_MAX_ZOOM = 1e13

/** Zoom at which the UI starts warning about the precision floor above. */
export const DS_PRECISION_WARN_ZOOM = 1e11

/** Coordinate bound. Interesting territory is inside |2|; this is slack for
 *  panning, and the decoder refuses anything past it. */
export const DS_MAX_COORD = 8

export const DS_ITER_MIN = 40
export const DS_ITER_MAX = 5000

/**
 * Escape radius. Deliberately large: the smooth-colouring formula below is only
 * continuous in the limit of a big bailout, and at the textbook radius of 2 the
 * "smooth" gradient still shows the iteration bands it exists to remove.
 */
export const DS_BAILOUT = 128
const DS_BAILOUT2 = DS_BAILOUT * DS_BAILOUT
const DS_LOG_BAILOUT = Math.log(DS_BAILOUT)

/** Hard ceiling on a token before any parsing — a fragment, not a file drop. */
export const DS_MAX_TOKEN_CHARS = 200
/** Longest coordinate string the decoder will look at (see DS_COORD_DIGITS_MAX). */
const DS_COORD_MAX_CHARS = 32
/** `toFixed` accepts up to 100 places; past ~20 the extra digits describe a
 *  double that does not exist, so the encoder stops there. */
export const DS_COORD_DIGITS_MAX = 20
const DS_COORD_DIGITS_MIN = 6

export type DsMode = 'mandelbrot' | 'julia'

export interface DsView {
  mode: DsMode
  /** Viewport centre. */
  re: number
  im: number
  /** Multiplier on DS_BASE_SPAN — bigger is deeper in. */
  zoom: number
  /** 0 means "auto" (derived from the zoom by dsAutoIter). */
  iter: number
  /** Palette id — matched against a fixed list, never interpolated. */
  palette: string
  /** Julia seed. Present for both modes so switching back and forth remembers
   *  the seed; only meaningful (and only encoded) in julia mode. */
  seedRe: number
  seedIm: number
  /** Colour cycle density, raw slider units (see DS_DENSITY_*). */
  density: number
}

export const DS_DENSITY_MIN = 10
export const DS_DENSITY_MAX = 200
export const DS_DENSITY_SCALE = 100

/** The palette ids the decoder will accept. A fixed list and not an
 *  interpolation: the same reason the markdown callout `kind` is matched
 *  against one (see AGENTS.md — Learnings/editorial marks). */
export const DS_PALETTE_IDS = ['ember', 'theme', 'ultra', 'ice', 'orchid', 'mono', 'zebra'] as const

export const DS_DEFAULT_VIEW: DsView = {
  mode: 'mandelbrot',
  re: -0.6,
  im: 0,
  zoom: 1,
  iter: 0,
  palette: 'ember',
  seedRe: -0.7269,
  seedIm: 0.1889,
  density: 55,
}

export function dsClamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

/* ──────────────────────────  geometry  ────────────────────────── */

/**
 * Complex units per pixel. Derived from the WIDTH alone and used for both axes,
 * which is what keeps pixels square at any aspect ratio — deriving a separate
 * vertical span from the height is how a fractal ends up subtly stretched.
 */
export function dsPixelScale(zoom: number, pixelWidth: number): number {
  return DS_BASE_SPAN / zoom / pixelWidth
}

/** Pixel (continuous coordinates, origin top-left) → complex plane. */
export function dsScreenToComplex(
  view: Pick<DsView, 're' | 'im' | 'zoom'>,
  px: number,
  py: number,
  pixelWidth: number,
  pixelHeight: number,
): { re: number; im: number } {
  const s = dsPixelScale(view.zoom, pixelWidth)
  return {
    re: view.re + (px - pixelWidth / 2) * s,
    // Screen y grows downward; the imaginary axis grows upward.
    im: view.im - (py - pixelHeight / 2) * s,
  }
}

/**
 * Zoom by `factor` about the pixel (px, py), keeping the complex number under
 * that pixel exactly where it is.
 *
 * The centre is deliberately NOT clamped here: clamping would move the anchor
 * point and break the property this function exists to have. `dsClampView` is
 * the separate step, and it is the identity on any view already in range.
 */
export function dsZoomAt(
  view: DsView,
  px: number,
  py: number,
  factor: number,
  pixelWidth: number,
  pixelHeight: number,
): DsView {
  const anchor = dsScreenToComplex(view, px, py, pixelWidth, pixelHeight)
  const zoom = dsClamp(view.zoom * factor, DS_MIN_ZOOM, DS_MAX_ZOOM)
  const s = dsPixelScale(zoom, pixelWidth)
  return {
    ...view,
    zoom,
    re: anchor.re - (px - pixelWidth / 2) * s,
    im: anchor.im + (py - pixelHeight / 2) * s,
  }
}

/** Bring a view back inside the bounds. Identity for anything already valid. */
export function dsClampView(view: DsView): DsView {
  return {
    ...view,
    re: dsClamp(view.re, -DS_MAX_COORD, DS_MAX_COORD),
    im: dsClamp(view.im, -DS_MAX_COORD, DS_MAX_COORD),
    zoom: dsClamp(view.zoom, DS_MIN_ZOOM, DS_MAX_ZOOM),
    iter: view.iter === 0 ? 0 : Math.round(dsClamp(view.iter, DS_ITER_MIN, DS_ITER_MAX)),
    density: Math.round(dsClamp(view.density, DS_DENSITY_MIN, DS_DENSITY_MAX)),
  }
}

/**
 * Iteration budget for a zoom level when the user has not pinned one.
 *
 * Detail near the boundary needs more iterations the closer you get, and a
 * fixed budget is why a deep zoom in a naive explorer turns into a flat blob.
 * Bounded at both ends: the ceiling is what stops a deep zoom from locking the
 * tab, since the renderer's cost is pixels × iterations.
 */
export function dsAutoIter(zoom: number): number {
  const depth = Math.log2(Math.max(1, zoom))
  return Math.round(dsClamp(140 + 62 * depth, DS_ITER_MIN, DS_ITER_MAX))
}

/** The iteration count actually used for a view. */
export function dsEffectiveIter(view: Pick<DsView, 'iter' | 'zoom'>): number {
  return view.iter > 0
    ? Math.round(dsClamp(view.iter, DS_ITER_MIN, DS_ITER_MAX))
    : dsAutoIter(view.zoom)
}

/* ──────────────────────────  the iteration  ────────────────────────── */

export interface DsEscape {
  /** Iterations survived. Equal to maxIter when the point never escaped. */
  n: number
  /** Smooth (continuous) iteration count; NaN when the point is inside. */
  smooth: number
}

/**
 * The definition, with no shortcuts: iterate z → z² + c and report when |z|
 * passes the bailout radius.
 *
 * This is the reference implementation and it stays untouched. `dsEscape` is the
 * fast path the renderer calls, and `security:smoke` proves the two agree — the
 * same structure `poker-trainer`'s `evaluateBest` / `scoreBest` pair uses, and
 * for the same reason: a "clever" interior test that is subtly wrong paints
 * outside points solid black, and nothing about the output looks broken.
 */
export function dsEscapeReference(
  cre: number,
  cim: number,
  zre: number,
  zim: number,
  maxIter: number,
): DsEscape {
  let x = zre
  let y = zim
  for (let n = 0; n < maxIter; n += 1) {
    const x2 = x * x
    const y2 = y * y
    const r2 = x2 + y2
    if (r2 > DS_BAILOUT2) return { n, smooth: dsSmooth(n, r2) }
    y = 2 * x * y + cim
    x = x2 - y2 + cre
  }
  return { n: maxIter, smooth: NaN }
}

/**
 * Smooth iteration count for an escape at iteration `n` with |z|² = `r2`.
 *
 *   ν = n + 1 − log₂( ln|z| / ln R )
 *
 * Continuous by construction: a point that escapes exactly on the bailout
 * circle gets ν = n + 1, and a point that escapes one step later having just
 * squared past it (|z| ≈ R²) gets ν = (n+1) + 1 − 1 = n + 1 as well, so the two
 * sides of every band boundary meet. Integer `n` alone is what produces the
 * concentric banding this replaces.
 *
 * The invariant `n ≤ ν < n + 1` is asserted over a grid — it is what catches a
 * flipped sign or the wrong log base, both of which still produce a picture.
 */
export function dsSmooth(n: number, r2: number): number {
  return n + 1 - Math.log2(Math.log(Math.sqrt(r2)) / DS_LOG_BAILOUT)
}

/**
 * Exact containment test for the main cardioid and the period-2 bulb — the two
 * largest interior components of the Mandelbrot set, both with closed forms.
 *
 * This is the only shortcut the fast path takes, and it is taken because it is
 * *proven*, not merely usually right. The popular alternative — orbit
 * periodicity detection with an epsilon — has no epsilon that can be shown never
 * to mark an outside point as inside, and this tool's entire product is the
 * picture, so it is deliberately not used. The cardioid covers most of the black
 * region at low zoom, which is where the cost is; at depth the progressive
 * renderer is what keeps things responsive.
 */
export function dsInInterior(cre: number, cim: number): boolean {
  // Main cardioid: q(q + (x − ¼)) ≤ ¼y², with q = (x − ¼)² + y².
  const dx = cre - 0.25
  const y2 = cim * cim
  const q = dx * dx + y2
  if (q * (q + dx) <= 0.25 * y2) return true
  // Period-2 bulb, centred at −1 with radius ¼.
  const bx = cre + 1
  return bx * bx + y2 <= 0.0625
}

/**
 * The fast path the renderer calls. Identical results to `dsEscapeReference`,
 * reached sooner for points inside the two components above.
 *
 * `mandelbrot` is not a style flag — it decides which of c and z₀ is the pixel.
 * Mandelbrot iterates from z₀ = 0 with c = the pixel; Julia fixes c = the seed
 * and starts at z₀ = the pixel. Swapping them renders a Mandelbrot set inside
 * Julia mode, which looks like a rendering bug and is not one, so the smoke test
 * pins Julia's c = 0 case to the closed-form answer (the unit disk).
 */
export function dsEscape(
  mode: DsMode,
  pre: number,
  pim: number,
  seedRe: number,
  seedIm: number,
  maxIter: number,
): DsEscape {
  if (mode === 'mandelbrot') {
    if (dsInInterior(pre, pim)) return { n: maxIter, smooth: NaN }
    return dsEscapeReference(pre, pim, 0, 0, maxIter)
  }
  return dsEscapeReference(seedRe, seedIm, pre, pim, maxIter)
}

/**
 * Smooth value → a 0..1 position in a cyclic colour ramp.
 *
 * `sqrt` and not ν itself: the smooth count grows without bound as you approach
 * the boundary, so a linear mapping crushes every band into the last pixel. The
 * square root spreads them, and the same density setting then looks right at
 * zoom 1 and at zoom 10¹⁰ — which is the whole point of a deep-zoom explorer
 * having one knob for colour instead of one per depth.
 */
export function dsRampPosition(smooth: number, density: number): number {
  const t = Math.sqrt(Math.max(0, smooth)) * (density / DS_DENSITY_SCALE)
  const f = t - Math.floor(t)
  return f < 0 ? f + 1 : f
}

/* ──────────────────────────  the permalink  ────────────────────────── */

/**
 * Decimal places to write a coordinate with, for a zoom level.
 *
 * The bug this exists to prevent: a fixed six places is a resolution of 1e-6,
 * which past a zoom of about 10⁵ is coarser than the whole viewport — so the
 * link a visitor sends lands somewhere entirely else, and both of them think
 * the other is looking at the same thing. Resolution has to beat the pixel, so
 * the digit count follows the zoom: `log₁₀(zoom)` places puts the error at the
 * viewport's own width, and five more puts it far inside one pixel of even a 4K
 * canvas. Capped at 20, past which the digits describe doubles that do not
 * exist — and that cap is why DS_MAX_ZOOM is a statement about doubles.
 */
export function dsCoordDigits(zoom: number): number {
  const decades = Math.ceil(Math.log10(Math.max(1, zoom)))
  return Math.round(dsClamp(decades + 5, DS_COORD_DIGITS_MIN, DS_COORD_DIGITS_MAX))
}

/** Trailing zeros carry no information and make a link twice as long to read.
 *  Exported because `tour.ts` writes the same coordinates for its extra stops —
 *  a second copy of this would be a second rounding rule, and the digit count is
 *  the one thing about this permalink that is load-bearing. */
export function dsTrimNumber(value: number, digits: number): string {
  const fixed = value.toFixed(digits)
  if (!fixed.includes('.')) return fixed
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '')
  return trimmed === '-0' ? '0' : trimmed
}

/** Zoom rides as an integer: 1000·log₂(zoom). Monotone, compact, trivially
 *  bounded, and free of the `e+` notation a fragment would otherwise carry. */
export function dsEncodeZoom(zoom: number): number {
  return Math.round(Math.log2(dsClamp(zoom, DS_MIN_ZOOM, DS_MAX_ZOOM)) * 1000)
}

const DS_ZOOM_CODE_MIN = Math.round(Math.log2(DS_MIN_ZOOM) * 1000)
const DS_ZOOM_CODE_MAX = Math.round(Math.log2(DS_MAX_ZOOM) * 1000)

const DS_NUMBER_RE = /^-?\d+(\.\d+)?$/
const DS_INT_RE = /^-?\d+$/

/**
 * Serialise a view. Comma-separated because a fragment is something people look
 * at, and commas are legal there unescaped:
 *
 *   1,m,<re>,<im>,<zoomCode>,<iter>,<palette>,<density>[,<seedRe>,<seedIm>]
 *
 * Every field is clamped here as well as checked on decode. Minting through the
 * clamps is what makes an out-of-range value on decode *proof* of a hand-built
 * token rather than something this code could have produced.
 */
export function dsEncodeView(view: DsView): string {
  const v = dsClampView(view)
  const digits = dsCoordDigits(v.zoom)
  const parts = [
    '1',
    v.mode === 'julia' ? 'j' : 'm',
    dsTrimNumber(v.re, digits),
    dsTrimNumber(v.im, digits),
    String(dsEncodeZoom(v.zoom)),
    String(v.iter),
    DS_PALETTE_IDS.includes(v.palette as (typeof DS_PALETTE_IDS)[number]) ? v.palette : DS_DEFAULT_VIEW.palette,
    String(v.density),
  ]
  if (v.mode === 'julia') {
    // The seed is a point in the Mandelbrot plane at zoom 1 — it needs no more
    // precision than the plane itself, whatever the Julia zoom happens to be.
    parts.push(dsTrimNumber(v.seedRe, 8), dsTrimNumber(v.seedIm, 8))
  }
  return parts.join(',')
}

/**
 * One coordinate field of a token → a number, or null.
 *
 * Exported for `tour.ts`, which decodes the same field for each of a dive's
 * extra stops. It must be the SAME function and not a copy: a second coordinate
 * parser is a second opinion about how long a field may be and how far out a
 * centre may sit, and the two would drift apart the first time either bound
 * moved.
 */
export function dsParseCoord(text: string): number | null {
  if (typeof text !== 'string' || text.length > DS_COORD_MAX_CHARS || !DS_NUMBER_RE.test(text)) return null
  const n = Number(text)
  if (!Number.isFinite(n) || Math.abs(n) > DS_MAX_COORD) return null
  return n
}

/** One zoom field → a zoom, or null. Shared with `tour.ts` for the same reason
 *  `dsParseCoord` is: the bound belongs in one place. */
export function dsDecodeZoomCode(text: string): number | null {
  if (typeof text !== 'string' || !DS_INT_RE.test(text)) return null
  const code = Number(text)
  if (!Number.isFinite(code) || code < DS_ZOOM_CODE_MIN || code > DS_ZOOM_CODE_MAX) return null
  return dsClamp(Math.pow(2, code / 1000), DS_MIN_ZOOM, DS_MAX_ZOOM)
}

/**
 * Parse a token back into a view, or null.
 *
 * Never throws: a malformed link costs the shared location, not the explorer.
 * Everything is bounded — token length before any parsing, the shape of each
 * number, the coordinate range, the zoom code, the iteration count, and the
 * palette against a fixed list. A julia token must carry a seed and a
 * mandelbrot token must not, so the two shapes cannot be confused for each
 * other by a truncated link.
 */
export function dsDecodeView(token: string): DsView | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > DS_MAX_TOKEN_CHARS) return null
  const parts = token.split(',')
  if (parts[0] !== '1') return null
  const isJulia = parts[1] === 'j'
  if (!isJulia && parts[1] !== 'm') return null
  if (parts.length !== (isJulia ? 10 : 8)) return null

  const re = dsParseCoord(parts[2])
  const im = dsParseCoord(parts[3])
  if (re === null || im === null) return null

  const zoom = dsDecodeZoomCode(parts[4])
  if (zoom === null) return null

  if (!DS_INT_RE.test(parts[5])) return null
  const iter = Number(parts[5])
  // 0 is "auto"; anything else must be a real budget inside the bounds.
  if (iter !== 0 && (iter < DS_ITER_MIN || iter > DS_ITER_MAX)) return null

  const palette = parts[6]
  if (!DS_PALETTE_IDS.includes(palette as (typeof DS_PALETTE_IDS)[number])) return null

  if (!DS_INT_RE.test(parts[7])) return null
  const density = Number(parts[7])
  if (density < DS_DENSITY_MIN || density > DS_DENSITY_MAX) return null

  let seedRe = DS_DEFAULT_VIEW.seedRe
  let seedIm = DS_DEFAULT_VIEW.seedIm
  if (isJulia) {
    const sr = dsParseCoord(parts[8])
    const si = dsParseCoord(parts[9])
    if (sr === null || si === null) return null
    seedRe = sr
    seedIm = si
  }

  return {
    mode: isJulia ? 'julia' : 'mandelbrot',
    re,
    im,
    zoom,
    iter: Math.round(iter),
    palette,
    density: Math.round(density),
    seedRe,
    seedIm,
  }
}

/** Pull a `#view=` token out of a location hash. Tolerates `&`-joined keys so
 *  the fragment can grow another parameter later without breaking old links. */
export function dsTokenFromHash(hash: string): string | null {
  const m = /[#&]view=([^&]+)/.exec(hash || '')
  return m ? m[1] : null
}

/**
 * Human-readable zoom, because "×4200000000" is unreadable and the exponent is
 * the interesting part once you are deep.
 */
export function dsFormatZoom(zoom: number): string {
  if (zoom < 1000) return `${zoom.toFixed(zoom < 10 ? 2 : 0)}×`
  const exp = Math.floor(Math.log10(zoom))
  const mantissa = zoom / Math.pow(10, exp)
  return `${mantissa.toFixed(2)}e${exp}×`
}
