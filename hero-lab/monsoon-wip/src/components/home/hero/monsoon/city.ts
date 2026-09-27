/**
 * city.ts — the view out of the monsoon window: a cyberpunk skyline painted
 * once with Canvas2D as four aligned plates (night, day, emit, flicker) plus
 * the traffic lanes glass.ts animates. Everything comes from one seeded
 * layout so the plates never drift apart: built once as plain data, then
 * painted twice (night and day share every building, window and sign
 * position exactly).
 *
 * The plate is always seen blurred and refracted through glass.ts, so this
 * favours light, colour and depth over crisp geometry: soft gradients,
 * saturated point lights and no large flat fields. A grain tile breaks up
 * the sky and facade gradients so an 8-bit blur doesn't band.
 */
import type { CityPlates, TrafficLane, Vec3 } from './types'

// ---------------------------------------------------------------------------
// Random
// ---------------------------------------------------------------------------

type Rng = () => number

function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function range(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng()
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// ---------------------------------------------------------------------------
// Palette (0..255 — Canvas2D space, distinct from the linear 0..1 Vec3 the
// GL side uses; only `GROUPS` below crosses that boundary).
// ---------------------------------------------------------------------------

/** Fixed so the owner sees the same city on every visit. 'MONS' in hex,
 *  matching label.ts's seed spirit. */
const DEFAULT_SEED = 0x4d4f4e53
const REF_WIDTH = 2048

const GROUPS: [Vec3, Vec3, Vec3] = [
  [1.0, 0.16, 0.6],
  [0.2, 1.0, 0.55],
  [1.0, 0.1, 0.08],
]

type RGB = [number, number, number]

const WIN_WARM: RGB = [255, 194, 122]
const WIN_COOL: RGB = [223, 233, 255]
const WIN_CYAN: RGB = [120, 230, 255]
const WIN_MAGENTA: RGB = [255, 110, 210]

const NEON_MAGENTA: RGB = [255, 47, 160]
const NEON_CYAN: RGB = [34, 230, 255]
const NEON_AMBER: RGB = [255, 179, 71]
const NEON_VIOLET: RGB = [155, 123, 255]
const NEON_RED: RGB = [255, 59, 59]
const NEON_LIME: RGB = [155, 255, 106]
const NEON_COLORS: readonly RGB[] = [NEON_MAGENTA, NEON_CYAN, NEON_AMBER, NEON_VIOLET, NEON_RED, NEON_LIME]

const SIGN_WORDS = [
  'HOTEL', 'OPEN 24×7', 'CHAI', 'NOODLES', 'RAIN BAR', 'NIGHT MARKET',
  'PAAN', 'EXCHANGE', 'PHARMACY', 'MONSOON', '₹',
]

function rgb(c: RGB): string {
  return `rgb(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0})`
}
function rgba(c: RGB, a: number): string {
  return `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`
}
function shadeColor(base: RGB, shade: number, lo: number, hi: number): string {
  const t = mix(lo, hi, shade)
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v * t)))
  return `rgb(${cl(base[0])}, ${cl(base[1])}, ${cl(base[2])})`
}

// ---------------------------------------------------------------------------
// Layout data (built once, painted twice)
// ---------------------------------------------------------------------------

interface WinCell {
  x: number
  y: number
  w: number
  h: number
  color: RGB
  lit: boolean
  dayLit: boolean
}

interface Tower {
  x: number
  w: number
  topY: number
  baseY: number
  shade: number
  spire: boolean
  podiumY: number | null
  podiumInset: number
  tank: boolean
  antenna: boolean
  dish: boolean
  windows: WinCell[]
  layer: 'far' | 'mid'
}

interface NearSide {
  x: number
  w: number
  topY: number
  windows: WinCell[]
  ac: Array<{ x: number; y: number; w: number; h: number }>
  laundry: { x0: number; y0: number; x1: number; y1: number; dots: RGB[] } | null
}

interface SignSpec {
  text: string
  x: number
  y: number
  vertical: boolean
  fontPx: number
  color: RGB
  brokenGlow: boolean
}

interface Billboard {
  x: number
  y: number
  w: number
  h: number
  c1: string
  c2: string
  c3: RGB
  glyph: string
}

interface PaymentBoard {
  x: number
  y: number
  w: number
  h: number
}

interface AircraftLight {
  x: number
  y: number
  r: number
}

interface Cloud {
  x: number
  y: number
  rx: number
  ry: number
  a: number
}

interface Layout {
  width: number
  height: number
  scale: number
  horizon: number
  clouds: Cloud[]
  far: Tower[]
  mid: Tower[]
  near: NearSide[]
  signs: SignSpec[]
  billboards: Billboard[]
  payment: PaymentBoard
  aircraft: AircraftLight[]
  lanes: TrafficLane[]
}

// ---------------------------------------------------------------------------
// Build: far skyline, mid towers, near frame, clouds, lanes, signs/boards
// ---------------------------------------------------------------------------

function buildFar(rng: Rng, w: number, h: number, horizon: number): Tower[] {
  const S = w / REF_WIDTH
  const count = Math.max(10, Math.round(range(rng, 14, 20) * S))
  const towers: Tower[] = []
  for (let i = 0; i < count; i += 1) {
    const tw = range(rng, 14, 34) * S
    const x = rng() * w - tw / 2
    const heightFrac = range(rng, 0.35, 0.85)
    const topY = horizon - h * heightFrac
    const windows: WinCell[] = []
    const specks = Math.round(range(rng, 3, 9))
    for (let s = 0; s < specks; s += 1) {
      const color = rng() < 0.75 ? WIN_WARM : WIN_COOL
      windows.push({
        x: x + rng() * tw,
        y: topY + rng() * (horizon - topY),
        w: 1.4 * S,
        h: 1.4 * S,
        color,
        lit: rng() < 0.3,
        dayLit: false,
      })
    }
    towers.push({
      x, w: tw, topY, baseY: horizon + range(rng, -2, 6) * S,
      shade: rng(),
      spire: rng() < 0.4,
      podiumY: null, podiumInset: 0,
      tank: false, antenna: rng() < 0.2, dish: false,
      windows,
      layer: 'far',
    })
  }
  return towers
}

function buildMid(rng: Rng, w: number, h: number, horizon: number): Tower[] {
  const S = w / REF_WIDTH
  const count = Math.max(6, Math.round(range(rng, 9, 13) * S))
  const towers: Tower[] = []
  for (let i = 0; i < count; i += 1) {
    const tw = range(rng, 70, 190) * S
    const x = range(rng, 0, Math.max(0, w - tw))
    const heightFrac = range(rng, 0.35, 0.72)
    const topY = horizon - h * heightFrac
    const hasPodium = rng() < 0.55
    const podiumY = hasPodium ? mix(topY, horizon, range(rng, 0.35, 0.6)) : null
    const podiumInset = hasPodium ? tw * range(rng, 0.06, 0.16) : 0
    const cols = Math.min(14, Math.max(4, Math.round(tw / (10 * S))))
    const rows = Math.min(26, Math.max(6, Math.round((horizon - topY) / (16 * S))))
    const cellW = tw / cols
    const cellH = (horizon - topY) / rows
    const windows: WinCell[] = []
    for (let r = 0; r < rows; r += 1) {
      const floorLit = rng() < 0.1 ? 0.85 : range(rng, 0.2, 0.35)
      for (let c = 0; c < cols; c += 1) {
        const lit = rng() < floorLit
        const roll = rng()
        const color = roll < 0.6 ? WIN_WARM : roll < 0.9 ? WIN_COOL : roll < 0.96 ? WIN_CYAN : WIN_MAGENTA
        windows.push({
          x: x + cellW * (c + 0.5), y: topY + cellH * (r + 0.5),
          w: range(rng, 3, 5) * S, h: range(rng, 4, 7) * S,
          color, lit, dayLit: lit && rng() < 0.18,
        })
      }
    }
    towers.push({
      x, w: tw, topY, baseY: horizon,
      shade: rng(),
      spire: rng() < 0.15,
      podiumY, podiumInset,
      tank: rng() < 0.3, antenna: rng() < 0.35, dish: rng() < 0.25,
      windows,
      layer: 'mid',
    })
  }
  towers.sort((a, b) => a.x - b.x)
  return towers
}

function buildNear(rng: Rng, w: number, h: number, horizon: number): NearSide[] {
  const S = w / REF_WIDTH
  const sides: NearSide[] = []
  for (const side of [-1, 1] as const) {
    const nBuild = 1 + (rng() < 0.6 ? 1 : 0)
    let cursorX = side === -1 ? 0 : w
    for (let i = 0; i < nBuild; i += 1) {
      const bw = range(rng, 90, 190) * S
      const x = side === -1 ? cursorX : cursorX - bw
      cursorX = side === -1 ? x + bw : x
      const topY = horizon - h * range(rng, 0.55, 0.95)
      const cols = Math.min(14, Math.max(3, Math.round(bw / (18 * S))))
      const rows = Math.min(40, Math.max(5, Math.round((horizon - topY) / (22 * S))))
      const cellW = bw / cols
      const cellH = (horizon - topY) / rows
      const windows: WinCell[] = []
      for (let r = 0; r < rows; r += 1) {
        const floorLit = range(rng, 0.18, 0.3)
        for (let c = 0; c < cols; c += 1) {
          const lit = rng() < floorLit
          const roll = rng()
          const color = roll < 0.65 ? WIN_WARM : roll < 0.93 ? WIN_COOL : WIN_CYAN
          windows.push({
            x: x + cellW * (c + 0.5), y: topY + cellH * (r + 0.5),
            w: range(rng, 6, 10) * S, h: range(rng, 8, 13) * S,
            color, lit, dayLit: lit && rng() < 0.15,
          })
        }
      }
      const ac: Array<{ x: number; y: number; w: number; h: number }> = []
      const acCount = Math.round(range(rng, 4, 9))
      for (let a = 0; a < acCount; a += 1) {
        ac.push({
          x: x + range(rng, 0.1, 0.85) * bw,
          y: topY + range(rng, 0.15, 0.9) * (horizon - topY),
          w: 9 * S, h: 6 * S,
        })
      }
      const laundry = rng() < 0.5 ? {
        x0: x + bw * 0.2, y0: topY + (horizon - topY) * 0.5,
        x1: x + bw * 0.75, y1: topY + (horizon - topY) * 0.53,
        dots: [WIN_WARM, WIN_COOL, NEON_RED, WIN_WARM],
      } : null
      sides.push({ x, w: bw, topY, windows, ac, laundry })
    }
  }
  return sides
}

function buildClouds(rng: Rng, w: number, h: number): Cloud[] {
  const n = Math.round(range(rng, 5, 8))
  const clouds: Cloud[] = []
  for (let i = 0; i < n; i += 1) {
    clouds.push({
      x: rng() * w,
      y: h * range(rng, 0.08, 0.42),
      rx: w * range(rng, 0.16, 0.34),
      ry: h * range(rng, 0.05, 0.09),
      a: range(rng, 0.25, 0.6),
    })
  }
  return clouds
}

function buildLanes(rng: Rng): TrafficLane[] {
  const count = 3 + (rng() < 0.5 ? 0 : 1)
  const lanes: TrafficLane[] = []
  for (let i = 0; i < count; i += 1) {
    const dir = rng() < 0.5 ? 1 : -1
    lanes.push({
      y: range(rng, 0.3, 0.56),
      x0: 0, x1: 1,
      speed: dir * range(rng, 0.008, 0.03),
      size: range(rng, 0.002, 0.004),
    })
  }
  return lanes
}

/** A couple of characters per flagged sign go to flicker group 0 (broken
 *  neon): left out of emit, painted only into that group's channel. */
const EMPTY_SET: ReadonlySet<number> = new Set()
function brokenIndices(sign: SignSpec): ReadonlySet<number> {
  if (!sign.brokenGlow) return EMPTY_SET
  const n = sign.text.length
  const a = Math.min(n - 1, Math.max(0, Math.floor(n * 0.35)))
  const set = new Set<number>([a])
  if (n > 5) set.add(Math.min(n - 1, a + 2))
  return set
}

function buildEmitters(
  rng: Rng, w: number, mid: Tower[], far: Tower[],
): { signs: SignSpec[]; billboards: Billboard[]; payment: PaymentBoard; aircraft: AircraftLight[] } {
  const S = w / REF_WIDTH
  const hosts = mid.length ? mid : far
  const signCount = Math.round(range(rng, 8, 13))
  const signs: SignSpec[] = []
  let brokenBudget = 2
  for (let i = 0; i < signCount; i += 1) {
    const vertical = rng() < 0.45
    const word = pick(rng, SIGN_WORDS)
    const fontPx = range(rng, 26, 54) * S
    const host = pick(rng, hosts)
    const x = host.x + range(rng, 0.1, 0.7) * host.w
    const y = host.topY + range(rng, 0.2, 0.65) * (host.baseY - host.topY)
    const brokenGlow = brokenBudget > 0 && rng() < 0.3
    if (brokenGlow) brokenBudget -= 1
    signs.push({ text: word, x, y, vertical, fontPx, color: pick(rng, NEON_COLORS), brokenGlow })
  }
  // The easter egg: one small sign, always present, never broken.
  const eggHost = pick(rng, hosts)
  signs.push({
    text: 'apanjwani0',
    x: eggHost.x + eggHost.w * 0.5,
    y: eggHost.topY + (eggHost.baseY - eggHost.topY) * range(rng, 0.3, 0.5),
    vertical: false, fontPx: 13 * S, color: NEON_CYAN, brokenGlow: false,
  })

  const billboards: Billboard[] = []
  const bbCount = 2 + (rng() < 0.5 ? 0 : 1)
  for (let i = 0; i < bbCount; i += 1) {
    const host = pick(rng, hosts)
    const bw = range(rng, 90, 160) * S
    const bh = bw * range(rng, 0.45, 0.7)
    billboards.push({
      x: host.x + range(rng, 0, Math.max(0, host.w - bw)),
      y: host.topY + range(rng, 0.05, 0.2) * (host.baseY - host.topY),
      w: bw, h: bh,
      c1: pick(rng, ['#ff2fa0', '#22e6ff', '#ffb347', '#9b7bff']),
      c2: pick(rng, ['#1a0b2e', '#08111a', '#241108']),
      c3: pick(rng, NEON_COLORS),
      glyph: pick(rng, ['%', '₹']),
    })
  }

  const pHost = pick(rng, hosts)
  const pw = range(rng, 110, 160) * S
  const ph = pw * 0.6
  const payment: PaymentBoard = {
    x: pHost.x + Math.max(0, (pHost.w - pw) * 0.5),
    y: pHost.topY + (pHost.baseY - pHost.topY) * range(rng, 0.15, 0.3),
    w: pw, h: ph,
  }

  const aircraft: AircraftLight[] = []
  const spireTowers = [...far, ...mid].filter(t => t.spire)
  for (const t of spireTowers.slice(0, 6)) {
    aircraft.push({ x: t.x + t.w * 0.5, y: t.topY - 4 * S, r: Math.max(1.2, 1.6 * S) })
  }
  return { signs, billboards, payment, aircraft }
}

function buildLayout(seed: number, w: number, h: number): Layout {
  const rng = mulberry32(seed)
  const horizon = h * 0.6
  const far = buildFar(rng, w, h, horizon)
  const mid = buildMid(rng, w, h, horizon)
  const near = buildNear(rng, w, h, horizon)
  const clouds = buildClouds(rng, w, h)
  const lanes = buildLanes(rng)
  const { signs, billboards, payment, aircraft } = buildEmitters(rng, w, mid, far)
  return {
    width: w, height: h, scale: w / REF_WIDTH, horizon,
    clouds, far, mid, near, signs, billboards, payment, aircraft, lanes,
  }
}

// ---------------------------------------------------------------------------
// Paint: sky, haze, clouds
// ---------------------------------------------------------------------------

function paintSky(ctx: CanvasRenderingContext2D, layout: Layout, day: boolean): void {
  const { width: w, height: h, horizon } = layout
  const g = ctx.createLinearGradient(0, 0, 0, h)
  if (day) {
    g.addColorStop(0, '#8e9aa8')
    g.addColorStop(1, '#c3cad3')
  } else {
    g.addColorStop(0, '#05060d')
    g.addColorStop(0.55, '#0d0b1f')
    g.addColorStop(1, '#150f22')
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  if (!day) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const mg = ctx.createRadialGradient(w * 0.5, horizon, 0, w * 0.5, horizon, w * 0.55)
    mg.addColorStop(0, 'rgba(58, 18, 56, 0.85)')
    mg.addColorStop(1, 'rgba(58, 18, 56, 0)')
    ctx.fillStyle = mg
    ctx.fillRect(0, horizon - h * 0.3, w, h * 0.35)
    for (const sx of [w * 0.05, w * 0.95]) {
      const teal = ctx.createRadialGradient(sx, horizon, 0, sx, horizon, w * 0.35)
      teal.addColorStop(0, 'rgba(14, 42, 58, 0.7)')
      teal.addColorStop(1, 'rgba(14, 42, 58, 0)')
      ctx.fillStyle = teal
      ctx.fillRect(0, horizon - h * 0.25, w, h * 0.3)
    }
    ctx.restore()
  }
  paintClouds(ctx, layout, day)
}

function paintClouds(ctx: CanvasRenderingContext2D, layout: Layout, day: boolean): void {
  for (const c of layout.clouds) {
    const rMax = Math.max(c.rx, c.ry)
    const grad = ctx.createRadialGradient(c.x, c.y + c.ry * 0.3, 0, c.x, c.y, rMax)
    if (day) {
      grad.addColorStop(0, `rgba(150, 158, 170, ${c.a})`)
      grad.addColorStop(1, 'rgba(150, 158, 170, 0)')
    } else {
      grad.addColorStop(0, `rgba(60, 34, 64, ${c.a * 0.85})`)
      grad.addColorStop(1, 'rgba(20, 18, 40, 0)')
    }
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, Math.PI * 2)
    ctx.fill()
    // Brighter underside: light pollution bounced into the cloud base.
    const under = ctx.createRadialGradient(c.x, c.y + c.ry * 0.6, 0, c.x, c.y + c.ry * 0.6, rMax * 0.7)
    const glow = day ? '200, 205, 212' : '170, 70, 130'
    under.addColorStop(0, `rgba(${glow}, ${c.a * 0.5})`)
    under.addColorStop(1, `rgba(${glow}, 0)`)
    ctx.fillStyle = under
    ctx.beginPath()
    ctx.ellipse(c.x, c.y + c.ry * 0.5, c.rx * 0.8, c.ry * 0.8, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

function paintHaze(ctx: CanvasRenderingContext2D, w: number, top: number, bottom: number, day: boolean): void {
  if (bottom <= top) return
  const g = ctx.createLinearGradient(0, top, 0, bottom)
  const c = day ? '196, 202, 210' : '20, 26, 46'
  g.addColorStop(0, `rgba(${c}, 0)`)
  g.addColorStop(1, `rgba(${c}, ${day ? 0.55 : 0.45})`)
  ctx.fillStyle = g
  ctx.fillRect(0, top, w, bottom - top)
}

// ---------------------------------------------------------------------------
// Paint: towers, windows, near frame
// ---------------------------------------------------------------------------

function paintTowerMass(ctx: CanvasRenderingContext2D, t: Tower, day: boolean, S: number): void {
  const base: RGB = day
    ? (t.layer === 'far' ? [150, 158, 172] : [124, 132, 148])
    : (t.layer === 'far' ? [16, 20, 34] : [20, 26, 46])
  const fill = shadeColor(base, t.shade, 0.82, 1.14)
  ctx.fillStyle = fill
  if (t.podiumY != null) {
    ctx.fillRect(t.x, t.podiumY, t.w, t.baseY - t.podiumY)
    const inset = t.podiumInset
    ctx.fillRect(t.x + inset, t.topY, t.w - inset * 2, t.podiumY - t.topY)
  } else {
    ctx.fillRect(t.x, t.topY, t.w, t.baseY - t.topY)
  }
  if (t.spire) {
    ctx.beginPath()
    ctx.moveTo(t.x + t.w * 0.5, t.topY - (day ? 10 : 26) * S)
    ctx.lineTo(t.x + t.w * 0.42, t.topY)
    ctx.lineTo(t.x + t.w * 0.58, t.topY)
    ctx.closePath()
    ctx.fill()
  }
  ctx.strokeStyle = day ? 'rgba(255, 255, 255, 0.10)' : 'rgba(255, 255, 255, 0.05)'
  ctx.lineWidth = Math.max(1, S)
  const bandH = 16 * S
  ctx.beginPath()
  for (let y = t.baseY - bandH; y > t.topY; y -= bandH) {
    ctx.moveTo(t.x, y)
    ctx.lineTo(t.x + t.w, y)
  }
  ctx.stroke()
  if (t.tank) {
    ctx.fillStyle = day ? 'rgb(90, 96, 108)' : 'rgb(10, 13, 22)'
    ctx.fillRect(t.x + t.w * 0.15, t.topY - 10 * S, t.w * 0.22, 10 * S)
  }
  if (t.dish) {
    ctx.beginPath()
    ctx.ellipse(t.x + t.w * 0.75, t.topY + 6 * S, 5 * S, 3 * S, 0.4, 0, Math.PI * 2)
    ctx.fill()
  }
  if (t.antenna) {
    ctx.strokeStyle = fill
    ctx.lineWidth = Math.max(1, S)
    ctx.beginPath()
    ctx.moveTo(t.x + t.w * 0.5, t.topY)
    ctx.lineTo(t.x + t.w * 0.5, t.topY - 22 * S)
    ctx.stroke()
  }
}

function paintWindowsLit(ctx: CanvasRenderingContext2D, cells: WinCell[]): void {
  for (const c of cells) {
    if (!c.lit) continue
    ctx.fillStyle = rgb(c.color)
    ctx.fillRect(c.x - c.w / 2, c.y - c.h / 2, c.w, c.h)
  }
}

function paintWindowsDay(ctx: CanvasRenderingContext2D, cells: WinCell[], glassColor: string): void {
  ctx.fillStyle = glassColor
  for (const c of cells) ctx.fillRect(c.x - c.w / 2, c.y - c.h / 2, c.w, c.h)
  ctx.fillStyle = 'rgba(255, 210, 150, 0.9)'
  for (const c of cells) {
    if (c.dayLit) ctx.fillRect(c.x - c.w / 2, c.y - c.h / 2, c.w, c.h)
  }
}

function paintNearMass(ctx: CanvasRenderingContext2D, n: NearSide, h: number, day: boolean, S: number): void {
  ctx.fillStyle = day ? 'rgb(70, 76, 88)' : 'rgb(8, 10, 18)'
  ctx.fillRect(n.x, n.topY, n.w, h - n.topY)
  ctx.strokeStyle = day ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.06)'
  ctx.lineWidth = Math.max(1, S)
  const bandH = 20 * S
  ctx.beginPath()
  for (let y = h - bandH; y > n.topY; y -= bandH) {
    ctx.moveTo(n.x, y)
    ctx.lineTo(n.x + n.w, y)
  }
  ctx.stroke()
  ctx.fillStyle = day ? 'rgb(150, 154, 160)' : 'rgb(4, 5, 9)'
  for (const a of n.ac) ctx.fillRect(a.x, a.y, a.w, a.h)
  ctx.strokeStyle = day ? 'rgba(0, 0, 0, 0.25)' : 'rgba(0, 0, 0, 0.6)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const a of n.ac) {
    for (let gx = a.x + a.w * 0.15; gx < a.x + a.w; gx += a.w * 0.25) {
      ctx.moveTo(gx, a.y)
      ctx.lineTo(gx, a.y + a.h)
    }
  }
  ctx.stroke()
  if (n.laundry) {
    const l = n.laundry
    ctx.strokeStyle = day ? 'rgba(40, 40, 40, 0.4)' : 'rgba(0, 0, 0, 0.5)'
    ctx.lineWidth = Math.max(1, 0.6 * S)
    ctx.beginPath()
    ctx.moveTo(l.x0, l.y0)
    ctx.lineTo(l.x1, l.y1)
    ctx.stroke()
    for (let i = 0; i < l.dots.length; i += 1) {
      const t = (i + 0.5) / l.dots.length
      const dx = mix(l.x0, l.x1, t)
      const dy = mix(l.y0, l.y1, t) + 3 * S
      ctx.fillStyle = day ? rgb(l.dots[i]) : 'rgba(10, 10, 14, 0.9)'
      ctx.fillRect(dx - 2 * S, dy, 4 * S, 6 * S)
    }
  }
}

// ---------------------------------------------------------------------------
// Paint: signs, billboards, payment board, aircraft lights, street glow
// ---------------------------------------------------------------------------

type SignMode = 'emit' | 'flicker' | 'dayUnlit'

function paintGlyphGlow(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, px: number, color: RGB): void {
  ctx.shadowColor = rgb(color)
  ctx.shadowBlur = px * 0.5
  ctx.fillStyle = rgb(color)
  ctx.globalAlpha = 0.8
  ctx.fillText(ch, x, y)
  ctx.shadowBlur = px * 0.18
  ctx.globalAlpha = 1
  ctx.fillText(ch, x, y)
  ctx.shadowBlur = 0
  ctx.fillStyle = 'rgb(255, 255, 255)'
  ctx.globalAlpha = 0.7
  ctx.fillText(ch, x, y)
  ctx.globalAlpha = 1
}

function paintSign(ctx: CanvasRenderingContext2D, sign: SignSpec, mono: string, mode: SignMode): void {
  const broken = brokenIndices(sign)
  ctx.save()
  ctx.translate(sign.x, sign.y)
  if (sign.vertical) ctx.rotate(-Math.PI / 2)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = `700 ${sign.fontPx}px ${mono}`
  const advance = sign.fontPx * 0.62

  if (mode === 'emit') {
    const len = advance * sign.text.length
    const spill = ctx.createRadialGradient(len * 0.5, 0, 0, len * 0.5, 0, Math.max(len, sign.fontPx) * 1.1)
    spill.addColorStop(0, rgba(sign.color, 0.16))
    spill.addColorStop(1, rgba(sign.color, 0))
    ctx.fillStyle = spill
    ctx.fillRect(-sign.fontPx, -sign.fontPx * 2, len + sign.fontPx * 2, sign.fontPx * 3)
  }

  for (let i = 0; i < sign.text.length; i += 1) {
    const isBroken = broken.has(i)
    const ch = sign.text[i]
    const x = i * advance
    if (mode === 'dayUnlit') {
      ctx.fillStyle = 'rgb(58, 62, 72)'
      ctx.fillText(ch, x, 0)
    } else if (mode === 'flicker') {
      if (isBroken) paintGlyphGlow(ctx, ch, x, 0, sign.fontPx, [255, 255, 255])
    } else if (!isBroken) {
      paintGlyphGlow(ctx, ch, x, 0, sign.fontPx, sign.color)
    }
  }
  ctx.restore()
}

function paintBillboard(ctx: CanvasRenderingContext2D, b: Billboard, serif: string): void {
  const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h)
  g.addColorStop(0, b.c1)
  g.addColorStop(1, b.c2)
  ctx.fillStyle = g
  ctx.fillRect(b.x, b.y, b.w, b.h)
  ctx.fillStyle = rgba(b.c3, 0.9)
  ctx.beginPath()
  ctx.arc(b.x + b.w * 0.78, b.y + b.h * 0.38, b.h * 0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillRect(b.x + b.w * 0.08, b.y + b.h * 0.64, b.w * 0.5, b.h * 0.16)
  ctx.font = `700 ${Math.round(b.h * 0.6)}px ${serif}`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(b.glyph, b.x + b.w * 0.28, b.y + b.h * 0.42)
}

function paintPayment(ctx: CanvasRenderingContext2D, p: PaymentBoard, mono: string): void {
  ctx.save()
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'
  const r = p.h * 0.32
  const cx = p.x + p.h * 0.5
  const cy = p.y + p.h * 0.42
  ctx.lineWidth = Math.max(2, p.h * 0.035)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.5, cy)
  ctx.lineTo(cx - r * 0.1, cy + r * 0.4)
  ctx.lineTo(cx + r * 0.55, cy - r * 0.4)
  ctx.stroke()
  ctx.font = `700 ${Math.round(p.h * 0.15)}px ${mono}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('PAYMENT SUCCESSFUL', p.x + p.h * 1.05, cy)
  ctx.restore()
}

function paintAircraft(ctx: CanvasRenderingContext2D, lights: AircraftLight[]): void {
  ctx.fillStyle = '#fff'
  for (const l of lights) {
    ctx.beginPath()
    ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2)
    ctx.fill()
  }
}

function paintStreetGlow(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const top = h * 0.88
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const warm = ctx.createLinearGradient(0, top, 0, h)
  warm.addColorStop(0, 'rgba(255, 190, 120, 0)')
  warm.addColorStop(1, 'rgba(255, 190, 120, 0.45)')
  ctx.fillStyle = warm
  ctx.fillRect(0, top, w, h - top)
  const cyan = ctx.createLinearGradient(0, top, 0, h)
  cyan.addColorStop(0, 'rgba(70, 220, 255, 0)')
  cyan.addColorStop(1, 'rgba(70, 220, 255, 0.3)')
  ctx.fillStyle = cyan
  ctx.fillRect(0, top, w * 0.4, h - top)
  ctx.fillRect(w * 0.6, top, w * 0.4, h - top)
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Grain (breaks up gradient banding once the glass pass blurs everything)
// ---------------------------------------------------------------------------

function makeGrainTile(rng: Rng, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const cx = c.getContext('2d')!
  const id = cx.createImageData(size, size)
  for (let i = 0; i < id.data.length; i += 4) {
    const v = Math.floor(rng() * 255)
    id.data[i] = v
    id.data[i + 1] = v
    id.data[i + 2] = v
    id.data[i + 3] = 255
  }
  cx.putImageData(id, 0, 0)
  return c
}

function applyGrain(ctx: CanvasRenderingContext2D, w: number, h: number, tile: HTMLCanvasElement, alpha: number): void {
  const pattern = ctx.createPattern(tile, 'repeat')
  if (!pattern) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.globalCompositeOperation = 'overlay'
  ctx.fillStyle = pattern
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Plate assembly
// ---------------------------------------------------------------------------

function paintBase(
  ctx: CanvasRenderingContext2D, layout: Layout, day: boolean, mono: string, grain: HTMLCanvasElement,
): void {
  const { width: w, height: h, horizon, scale: S } = layout
  ctx.clearRect(0, 0, w, h)
  paintSky(ctx, layout, day)
  for (const t of layout.far) paintTowerMass(ctx, t, day, S)
  paintHaze(ctx, w, horizon - h * 0.5, horizon + h * 0.02, day)
  for (const t of layout.mid) {
    paintTowerMass(ctx, t, day, S)
    if (day) paintWindowsDay(ctx, t.windows, 'rgba(150, 165, 185, 0.55)')
  }
  paintHaze(ctx, w, horizon - h * 0.18, horizon + h * 0.05, day)
  for (const n of layout.near) {
    paintNearMass(ctx, n, h, day, S)
    if (day) paintWindowsDay(ctx, n.windows, 'rgba(120, 130, 145, 0.6)')
  }
  if (day) {
    for (const s of layout.signs) paintSign(ctx, s, mono, 'dayUnlit')
    const sheen = ctx.createLinearGradient(0, horizon - h * 0.01, 0, horizon + h * 0.015)
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0)')
    sheen.addColorStop(0.5, 'rgba(220, 230, 240, 0.35)')
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = sheen
    ctx.fillRect(0, horizon - h * 0.01, w, h * 0.025)
  }
  applyGrain(ctx, w, h, grain, day ? 0.025 : 0.035)
}

function paintEmitPlate(ctx: CanvasRenderingContext2D, layout: Layout, mono: string, serif: string): void {
  const { width: w, height: h } = layout
  for (const t of layout.far) paintWindowsLit(ctx, t.windows)
  for (const t of layout.mid) paintWindowsLit(ctx, t.windows)
  for (const n of layout.near) paintWindowsLit(ctx, n.windows)
  for (const s of layout.signs) paintSign(ctx, s, mono, 'emit')
  for (const b of layout.billboards) paintBillboard(ctx, b, serif)
  paintStreetGlow(ctx, w, h)
}

function paintFlickerGroup(ctx: CanvasRenderingContext2D, layout: Layout, mono: string, group: 0 | 1 | 2): void {
  if (group === 0) {
    for (const s of layout.signs) paintSign(ctx, s, mono, 'flicker')
  } else if (group === 1) {
    paintPayment(ctx, layout.payment, mono)
  } else {
    paintAircraft(ctx, layout.aircraft)
  }
}

const CHANNEL_COLOR: readonly RGB[] = [[255, 0, 0], [0, 255, 0], [0, 0, 255]]

/** Each group is painted white-on-black on its own offscreen canvas, then
 *  recoloured to its pure channel colour with a `source-in` fill (the
 *  standard Canvas2D sprite-tint trick: it keeps the shape's alpha and
 *  replaces its colour) and composited onto the output with `lighter`
 *  (additive). glass.ts reads the result's R/G/B as three independent 0..1
 *  masks, tints each by `groups[c]` and drives it with its own flicker
 *  curve. This reaches the same per-channel result as a getImageData/
 *  putImageData copy — measured at 2048x1280 in this harness, the readback
 *  of a fresh 1024x640 canvas cost ~900ms the first time (a one-off
 *  readback-pipeline warm-up in this headless/software-GL environment) vs
 *  under 5ms total for three `drawImage` composites, and unlike a raw
 *  channel copy it keeps the soft alpha of the shadowBlur glow instead of
 *  flattening every covered pixel to 255 (getImageData unpremultiplies, so
 *  a white glyph's antialiased fringe reads back as color 255 at every
 *  nonzero coverage — the coverage only survives in alpha, which a bare
 *  `data[i]` copy of the red channel never reads). */
function paintFlickerCombined(
  ctx: CanvasRenderingContext2D, layout: Layout, mono: string,
  texW: number, texH: number, logicalW: number, logicalH: number,
): void {
  const sx = texW / logicalW
  const sy = texH / logicalH
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let g = 0; g < 3; g += 1) {
    const c = document.createElement('canvas')
    c.width = texW
    c.height = texH
    const gctx = c.getContext('2d')!
    gctx.scale(sx, sy)
    paintFlickerGroup(gctx, layout, mono, g as 0 | 1 | 2)
    gctx.globalCompositeOperation = 'source-in'
    gctx.fillStyle = rgb(CHANNEL_COLOR[g])
    gctx.fillRect(0, 0, texW, texH)
    ctx.drawImage(c, 0, 0)
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

function timeoutMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function safeCheck(spec: string): boolean {
  try {
    return document.fonts.check(spec)
  } catch {
    return false
  }
}

async function ensureFonts(): Promise<{ mono: string; serif: string }> {
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('600 64px "JetBrains Mono"'),
        document.fonts.load('600 64px "Source Serif 4"'),
      ]),
      timeoutMs(1200),
    ])
  } catch {
    // Fall back below regardless of why loading failed.
  }
  const mono = safeCheck('600 64px "JetBrains Mono"') ? '"JetBrains Mono"' : 'monospace'
  const serif = safeCheck('600 64px "Source Serif 4"') ? '"Source Serif 4"' : 'serif'
  return { mono, serif }
}

function yieldFrame(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function drawCity(opts: { width: number; height: number; seed?: number }): Promise<CityPlates> {
  const { width, height } = opts
  const seed = opts.seed ?? DEFAULT_SEED
  const { mono, serif } = await ensureFonts()
  const layout = buildLayout(seed, width, height)
  const grain = makeGrainTile(mulberry32(seed ^ 0x9e3779b9), 96)

  const night = document.createElement('canvas')
  night.width = width
  night.height = height
  paintBase(night.getContext('2d')!, layout, false, mono, grain)

  await yieldFrame()

  const emit = document.createElement('canvas')
  emit.width = width
  emit.height = height
  paintEmitPlate(emit.getContext('2d')!, layout, mono, serif)

  const dayW = Math.max(1, Math.round(width / 2))
  const dayH = Math.max(1, Math.round(height / 2))
  const day = document.createElement('canvas')
  day.width = dayW
  day.height = dayH
  const dctx = day.getContext('2d')!
  dctx.scale(dayW / width, dayH / height)
  paintBase(dctx, layout, true, mono, grain)

  const flicker = document.createElement('canvas')
  flicker.width = dayW
  flicker.height = dayH
  paintFlickerCombined(flicker.getContext('2d')!, layout, mono, dayW, dayH, width, height)

  return { night, day, emit, flicker, groups: GROUPS, lanes: layout.lanes, aspect: width / height }
}
