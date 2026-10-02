/**
 * The home hero: how this website got to your device, drawn as one metro
 * line over an endless drift of stars. It replays THIS page load, slowed
 * down, from the browser's own Navigation Timing, Cloudflare's
 * /cdn-cgi/trace and one HEAD of '/'. Real data only (owner, 2026-09-28): a fact the page cannot measure
 * is left out, never filled in with a sample. On the dev server the page
 * comes from localhost, so the same facts come from one real request to the
 * live site that the dev server makes (/__hero-probe, in astro.config.mjs).
 *
 * Every stop explains itself on hover, focus or tap, in plain words for
 * someone who has never heard of DNS, and acts out its own job on the line.
 *
 * It never names the host provider, the runtime or anything else about the
 * origin (owner, 2026-09-27): that is what helps someone reach it around
 * Cloudflare. AGENTS.md's Home hero section has the contract.
 */
import type { HeroCreate, HeroInstance } from './types'
import { drawStars, driftStars, makeStars, starCount, type SkyColors, type Star } from '../../../lib/sky'

type Rgb = [number, number, number]

function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }
function hexRgb(hex: string): Rgb { return [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb }
function rgbCss(c: Rgb, a = 1): string { return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})` }
function mixInto(out: Rgb, c0: Rgb, c1: Rgb, t: number): Rgb {
  out[0] = lerp(c0[0], c1[0], t); out[1] = lerp(c0[1], c1[1], t); out[2] = lerp(c0[2], c1[2], t)
  return out
}

// ---- Colours. A request travels amber, an answer violet and a handshake
// white, in the diagram and in the log's dots alike.
const AMBER = hexRgb('#ffb35c')
const VIOLET = hexRgb('#9b8cff')
const WHITE: Rgb = [0.96, 0.97, 1]
const PALETTE: Rgb[] = [AMBER, VIOLET, WHITE]
const OUT = 0, BACK = 1, SHAKE = 2
const TONES = ['out', 'back', 'shake']
const REST = hexRgb('#394255')
// The machines rest a step brighter than the wires, so they read as objects
// and the wires as the paths between them.
const REST_GLYPH = hexRgb('#58647f')
// Every glyph is a solid panel: a wire ends at its outline, and an arriving
// packet slides in underneath.
const BODY = hexRgb('#0b0f19')
const SCREEN_BG = '#070a12'
const SCREEN_INK = '#dde6f2'
const LED_ON = 'rgba(130,255,170,0.95)'
const STAR = 'rgb(200,210,230)'
const CONSTELLATION = 'rgb(150,160,182)'
const LABEL = 'rgba(221,230,242,0.92)'
const SUB = 'rgba(132,144,160,0.92)'
const CHIP = rgbCss(AMBER, 0.95)
// Drawn over the diagram while a stop's card is open, so that stop stands out.
const VEIL = 'rgba(7,10,18,0.58)'
// Scratch colours, refilled every frame instead of allocated.
const MIX: Rgb = [0, 0, 0]
const TINT: Rgb = [0, 0, 0]

// ---- Comets: a head and a tail sprite per palette colour, rendered once per
// instance. drawImage stretches them to every packet's size.
interface Sprites { head: HTMLCanvasElement[]; tail: HTMLCanvasElement[] }
function sprite(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')
  if (g) paint(g)
  return c
}
function makeSprites(): Sprites {
  return {
    head: PALETTE.map(color => sprite(48, 48, g => {
      const grad = g.createRadialGradient(24, 24, 0, 24, 24, 24)
      grad.addColorStop(0, rgbCss(color)); grad.addColorStop(0.4, rgbCss(color, 0.55)); grad.addColorStop(1, rgbCss(color, 0))
      g.fillStyle = grad; g.fillRect(0, 0, 48, 48)
    })),
    tail: PALETTE.map(color => sprite(64, 16, g => {
      const grad = g.createLinearGradient(0, 0, 64, 0)
      grad.addColorStop(0, rgbCss(color, 0.65)); grad.addColorStop(1, rgbCss(color, 0))
      g.fillStyle = grad; g.fillRect(0, 0, 64, 16)
    })),
  }
}

// ---- Stations: the machines on the line, in the order a request meets them.
type Kind = 'laptop' | 'phone' | 'router' | 'dns' | 'edge' | 'origin' | 'isp'
interface Station {
  id: string
  kind: Kind
  label: string
  sub: string
  /** What this stop is, in plain words: the hover card and the screen-reader text. */
  what: string
  /** What happened here on this visit, from the measured facts; '' when nothing was measured. */
  now: string
  /** Off the line, above it: a question asked on the way (DNS). */
  branch?: boolean
  /** Written inside the edge's hexagon: the data centre's code. */
  code?: string
  /** Names the stretch of line arriving at this station. */
  via?: string
}
// A branch hangs off the main station before it; every other station joins
// the main station before it.
interface Link { a: number; b: number; via: string }
function linksOf(stations: Station[]): Link[] {
  const links: Link[] = []
  let prev = -1
  stations.forEach((s, i) => {
    if (prev >= 0) links.push({ a: prev, b: i, via: s.via ?? '' })
    if (!s.branch) prev = i
  })
  return links
}
interface Hop { li: number; rev: boolean }
function hopsOf(stations: Station[], links: Link[]): Map<string, Hop> {
  const m = new Map<string, Hop>()
  links.forEach((l, li) => {
    m.set(`${stations[l.a].id}>${stations[l.b].id}`, { li, rev: false })
    m.set(`${stations[l.b].id}>${stations[l.a].id}`, { li, rev: true })
  })
  return m
}

// ---- Layout: the main stations evenly along one horizontal line, a branch
// above it midway to the next station, the whole drawing centred in the band
// between the frame (top left) and the text (bottom). `above` and `below`
// are the measured label blocks, so a short band shortens the branch before
// any label has to go.
interface Pos { x: number; y: number; s: number }
function lineX(w: number, phone: boolean, main: number): { mx: number; step: number } {
  const mx = phone ? Math.max(w * 0.11, 34) : clamp(w * 0.1, 64, 180)
  return { mx, step: (w - 2 * mx) / Math.max(1, main - 1) }
}
function layoutLine(stations: Station[], w: number, top: number, bottom: number, phone: boolean, above: number, below: number): Pos[] {
  const { mx, step } = lineX(w, phone, stations.filter(s => !s.branch).length)
  const band = Math.max(90, bottom - top)
  const s = clamp(Math.min(w * (phone ? 0.055 : 0.03), band * (phone ? 0.1 : 0.13)), phone ? 16 : 24, phone ? 26 : 46)
  const rise = clamp(band - 2 * s - above - below, s * (phone ? 1.8 : 2.2), phone ? 70 : 118)
  const y = top + Math.max(0, (band - (rise + 2 * s + above + below)) / 2) + above + s + rise
  const out: Pos[] = []
  let k = 0
  stations.forEach((st, i) => { if (!st.branch) out[i] = { x: mx + step * k++, y, s } })
  stations.forEach((st, i) => { if (st.branch) out[i] = { x: (out[i - 1].x + out[i + 1].x) / 2, y: y - rise, s: s * 0.92 } })
  return out
}

// How far each glyph reaches above and below its centre, in units of its
// half-extent, so a label sits against the drawing it names.
const GLYPH_TOP: Record<Kind, number> = { laptop: 0.92, phone: 1, router: 0.95, dns: 0.85, edge: 1, origin: 1, isp: 1.25 }
const GLYPH_BOTTOM: Record<Kind, number> = { laptop: 0.4, phone: 1, router: 0.3, dns: 0.85, edge: 1, origin: 1, isp: 1 }

interface Fonts { label: string; sub: string; chip: string; code: string }
// A label block is the name, its wrapped sub-line and, once its step has
// landed, a chip with what happened there. The chip's line is reserved from
// the start, so nothing moves when it appears.
interface Label { x: number; y: number; lines: string[]; lead: number; hidden: boolean }
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = word } else line = next
  }
  if (line) lines.push(line)
  return lines
}
function labelLines(ctx: CanvasRenderingContext2D, stations: Station[], fonts: Fonts, maxW: number): string[][] {
  ctx.font = fonts.sub
  return stations.map(st => [st.label, ...(st.sub ? wrapText(ctx, st.sub, maxW) : [])])
}
function layoutLabels(ctx: CanvasRenderingContext2D, stations: Station[], pos: Pos[], lines: string[][], fonts: Fonts, lead: number, w: number, textTop: number, phone: boolean): Label[] {
  return stations.map((st, i) => {
    const p = pos[i], own = lines[i]
    let half = 0
    for (let k = 0; k < own.length; k++) {
      ctx.font = k ? fonts.sub : fonts.label
      half = Math.max(half, ctx.measureText(own[k]).width / 2 + 4)
    }
    const n = own.length + 1
    const y = st.branch
      ? p.y - GLYPH_TOP[st.kind] * p.s - 10 - lead * (n - 1)
      : p.y + GLYPH_BOTTOM[st.kind] * p.s + (phone ? 14 : 17)
    return {
      x: clamp(p.x, half + 4, Math.max(half + 4, w - half - 4)), y, lines: own, lead,
      // On a stage too short for the whole drawing, a label is not printed
      // over the name.
      hidden: !st.branch && y + lead * (n - 1) > textTop - 4,
    }
  })
}

// ---- Glyphs: solid panels with a crisp outline, centred at (x, y) with
// half-extent s. G is one scratch object refilled per station per frame.
interface GlyphScratch { stroke: string; body: string; ink: string; lw: number; fill: number; code: string; codeFont: string }
const G: GlyphScratch = { stroke: '', body: '', ink: '', lw: 2, fill: 0, code: '', codeFont: '' }

function roundRectPath(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x0 + r, y0); ctx.lineTo(x1 - r, y0); ctx.quadraticCurveTo(x1, y0, x1, y0 + r)
  ctx.lineTo(x1, y1 - r); ctx.quadraticCurveTo(x1, y1, x1 - r, y1)
  ctx.lineTo(x0 + r, y1); ctx.quadraticCurveTo(x0, y1, x0, y1 - r)
  ctx.lineTo(x0, y0 + r); ctx.quadraticCurveTo(x0, y0, x0 + r, y0)
  ctx.closePath()
}
function panel(ctx: CanvasRenderingContext2D, g: GlyphScratch) {
  ctx.fillStyle = g.body; ctx.fill()
  ctx.lineWidth = g.lw; ctx.strokeStyle = g.stroke; ctx.stroke()
}
// Interior markings are thinner and dimmer than the outline, so a glyph
// reads as one object with markings on it.
function detailStroke(ctx: CanvasRenderingContext2D, g: GlyphScratch) {
  ctx.lineWidth = g.lw * 0.6; ctx.globalAlpha = 0.7; ctx.strokeStyle = g.stroke; ctx.stroke(); ctx.globalAlpha = 1
}
// Status LEDs are always lit and never blink: blinking read as the page
// flickering, first at rest (owner, 2026-09-28) and then while traffic
// crossed (2026-09-30). The glyph's outline shows the traffic instead.
function led(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = LED_ON
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill()
}
function screenBar(ctx: CanvasRenderingContext2D, f: number, th: number, x: number, y: number, w: number, h: number) {
  const a = clamp((f - th) / 0.12, 0, 1)
  if (a <= 0) return
  ctx.globalAlpha = a * 0.85; ctx.fillRect(x, y, w, Math.max(1, h))
}
// The device's screen draws a miniature of this page as the answer's bytes
// arrive: the line of stations first, then the name, then the tagline.
function drawScreen(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, g: GlyphScratch) {
  ctx.fillStyle = SCREEN_BG; ctx.fillRect(x0, y0, w, h)
  const f = g.fill
  if (f <= 0.01) return
  ctx.globalAlpha = 0.14 * f; ctx.fillStyle = '#9b8cff'; ctx.fillRect(x0, y0, w, h)
  const a = clamp((f - 0.05) / 0.15, 0, 1)
  if (a > 0) {
    const ly = y0 + h * 0.34
    ctx.globalAlpha = a * 0.8; ctx.strokeStyle = '#9b8cff'; ctx.lineWidth = Math.max(0.6, w * 0.012)
    ctx.beginPath(); ctx.moveTo(x0 + w * 0.12, ly); ctx.lineTo(x0 + w * 0.88, ly); ctx.stroke()
    ctx.fillStyle = SCREEN_INK
    const r = Math.max(0.9, w * 0.022)
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x0 + w * (0.12 + 0.2533 * i), ly, r, 0, 6.3); ctx.fill() }
  }
  ctx.fillStyle = SCREEN_INK
  screenBar(ctx, f, 0.35, x0 + w * 0.08, y0 + h * 0.62, w * 0.56, h * 0.1)
  screenBar(ctx, f, 0.6, x0 + w * 0.08, y0 + h * 0.78, w * 0.4, h * 0.045)
  screenBar(ctx, f, 0.72, x0 + w * 0.08, y0 + h * 0.86, w * 0.28, h * 0.045)
  ctx.globalAlpha = 1
}
function drawLaptop(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, g: GlyphScratch) {
  roundRectPath(ctx, x - 0.8 * s, y - 0.92 * s, x + 0.8 * s, y + 0.27 * s, 0.07 * s); panel(ctx, g)
  drawScreen(ctx, x - 0.7 * s, y - 0.83 * s, 1.4 * s, s, g)
  ctx.beginPath()
  ctx.moveTo(x - s, y + 0.27 * s); ctx.lineTo(x + s, y + 0.27 * s)
  ctx.lineTo(x + 1.12 * s, y + 0.4 * s); ctx.lineTo(x - 1.12 * s, y + 0.4 * s); ctx.closePath()
  panel(ctx, g)
  ctx.beginPath()
  ctx.moveTo(x - 0.2 * s, y + 0.27 * s); ctx.lineTo(x - 0.16 * s, y + 0.32 * s)
  ctx.lineTo(x + 0.16 * s, y + 0.32 * s); ctx.lineTo(x + 0.2 * s, y + 0.27 * s)
  detailStroke(ctx, g)
}
function drawPhone(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, g: GlyphScratch) {
  roundRectPath(ctx, x - 0.52 * s, y - s, x + 0.52 * s, y + s, 0.14 * s); panel(ctx, g)
  drawScreen(ctx, x - 0.43 * s, y - 0.8 * s, 0.86 * s, 1.58 * s, g)
  ctx.beginPath(); ctx.moveTo(x - 0.12 * s, y - 0.9 * s); ctx.lineTo(x + 0.12 * s, y - 0.9 * s); detailStroke(ctx, g)
}
function drawRouter(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, g: GlyphScratch) {
  // Antennae first, so the body panel covers where they meet it.
  ctx.beginPath()
  ctx.moveTo(x - 0.6 * s, y - 0.3 * s); ctx.lineTo(x - 0.74 * s, y - 0.95 * s)
  ctx.moveTo(x + 0.6 * s, y - 0.3 * s); ctx.lineTo(x + 0.74 * s, y - 0.95 * s)
  ctx.lineWidth = g.lw; ctx.strokeStyle = g.stroke; ctx.stroke()
  const tip = Math.max(1.2, 0.06 * s)
  ctx.fillStyle = g.stroke; ctx.beginPath()
  ctx.arc(x - 0.74 * s, y - 0.95 * s, tip, 0, 6.3)
  ctx.moveTo(x + 0.74 * s + tip, y - 0.95 * s); ctx.arc(x + 0.74 * s, y - 0.95 * s, tip, 0, 6.3)
  ctx.fill()
  roundRectPath(ctx, x - s, y - 0.3 * s, x + s, y + 0.3 * s, 0.1 * s); panel(ctx, g)
  ctx.beginPath()
  for (let i = 0; i < 3; i++) ctx.rect(x + 0.3 * s + i * 0.2 * s, y - 0.09 * s, 0.13 * s, 0.18 * s)
  detailStroke(ctx, g)
  const lr = Math.max(1.1, 0.055 * s)
  for (let i = 0; i < 4; i++) led(ctx, x - 0.72 * s + i * 0.16 * s, y, lr)
}
function drawDns(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, g: GlyphScratch) {
  const r = 0.85 * s, cy = 0.5 * r, cx = Math.sqrt(r * r - cy * cy)
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); panel(ctx, g)
  ctx.beginPath()
  ctx.moveTo(x + 0.42 * r, y); ctx.ellipse(x, y, 0.42 * r, r, 0, 0, 6.2832)
  ctx.moveTo(x + r, y); ctx.lineTo(x - r, y)
  ctx.moveTo(x, y - r); ctx.lineTo(x, y + r)
  ctx.moveTo(x - cx, y - cy); ctx.lineTo(x + cx, y - cy)
  ctx.moveTo(x - cx, y + cy); ctx.lineTo(x + cx, y + cy)
  detailStroke(ctx, g)
}
function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.closePath()
}
function drawHex(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, g: GlyphScratch) {
  hexPath(ctx, x, y, s); panel(ctx, g)
  hexPath(ctx, x, y, 0.78 * s); detailStroke(ctx, g)
  if (!g.code) return
  // The code of the data centre that served this page, written in it.
  ctx.fillStyle = g.ink; ctx.font = g.codeFont; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(g.code, x, y + 0.02 * s)
  ctx.textBaseline = 'alphabetic'
}
function drawRack(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, g: GlyphScratch) {
  roundRectPath(ctx, x - 0.58 * s, y - s, x + 0.58 * s, y + s, 0.06 * s); panel(ctx, g)
  ctx.beginPath()
  for (let u = 1; u < 4; u++) { const cy = y - s + u * 0.5 * s; ctx.moveTo(x - 0.58 * s, cy); ctx.lineTo(x + 0.58 * s, cy) }
  for (let u = 0; u < 4; u++) {
    const cy = y - s + (u + 0.5) * 0.5 * s
    for (let k = -1; k <= 1; k++) { ctx.moveTo(x - 0.1 * s, cy + k * 0.1 * s); ctx.lineTo(x + 0.4 * s, cy + k * 0.1 * s) }
  }
  detailStroke(ctx, g)
  const lr = Math.max(1.1, 0.055 * s)
  for (let u = 0; u < 4; u++) led(ctx, x - 0.36 * s, y - s + (u + 0.5) * 0.5 * s, lr)
}
// A radio mast: the internet provider every home and phone connects through.
function drawTower(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, g: GlyphScratch) {
  ctx.beginPath()
  ctx.moveTo(x - 0.46 * s, y + s); ctx.lineTo(x, y - 0.55 * s); ctx.lineTo(x + 0.46 * s, y + s); ctx.closePath()
  panel(ctx, g)
  ctx.beginPath()
  ctx.moveTo(x - 0.3 * s, y + 0.5 * s); ctx.lineTo(x + 0.3 * s, y + 0.5 * s)
  ctx.moveTo(x - 0.15 * s, y); ctx.lineTo(x + 0.15 * s, y)
  detailStroke(ctx, g)
  const top = y - 0.66 * s
  ctx.fillStyle = g.stroke; ctx.beginPath(); ctx.arc(x, top, Math.max(1.4, 0.09 * s), 0, 6.3); ctx.fill()
  ctx.lineWidth = g.lw * 0.8; ctx.strokeStyle = g.stroke
  for (const r of [0.34, 0.58]) {
    ctx.beginPath(); ctx.arc(x, top, r * s, -0.9, 0.9); ctx.stroke()
    ctx.beginPath(); ctx.arc(x, top, r * s, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke()
  }
}
const GLYPH: Record<Kind, (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, g: GlyphScratch) => void> = {
  laptop: drawLaptop, phone: drawPhone, router: drawRouter, dns: drawDns, edge: drawHex, origin: drawRack, isp: drawTower,
}

// ---- Space: the sky (src/lib/sky.ts), drawn behind the line in the hero's
// own star colours.
const SKY: SkyColors = { star: STAR, line: CONSTELLATION }

// ---- Traffic: fixed pools of packets (comets on a wire) and pulses (a ring
// from a station), reused every frame. Heat is how lit a wire or a station
// is: it fades to its floor, and the floor is the trail a replay leaves.
interface Packet { active: boolean; li: number; rev: boolean; t: number; dur: number; pal: number; size: number; trail: boolean }
interface Pulse { active: boolean; i: number; t: number; dur: number; pal: number; maxR: number }
interface Heat { c: Rgb; heat: number; floor: number; dir: number }
const TRAIL = 0.34
function heat(): Heat { return { c: REST, heat: 0, floor: 0, dir: 1 } }
function bump(h: Heat, pal: number, dir = 0) { h.heat = 1; h.c = PALETTE[pal]; if (dir) h.dir = dir }

// ---- Facts: what this page load can actually tell about itself.
interface Timing {
  dns: number; connect: number; tls: number; tcp: number; ttfb: number; download: number
  reused: boolean; quic: boolean; fromCache: boolean; otherPage: boolean
  protocol: string; size: number
  /** Real ms since the navigation began, for the replay's clock. */
  dnsEnd: number; connectEnd: number; firstByte: number; lastByte: number; paint: number
}
interface Edge { colo: string; city: string; country: string; ip: string; tls: string; kex: string; http: string }
type CacheKind = 'hit' | 'origin' | ''
interface CacheFacts { cache: CacheKind; cacheStatus: string; cacheAge: number }
interface Facts extends CacheFacts { timing: Timing | null; edge: Edge | null; device: string; dev: boolean }
const NO_CACHE: CacheFacts = { cache: '', cacheStatus: '', cacheAge: 0 }

function readPaint(): number {
  try { return performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0 } catch { return 0 }
}
// The navigation entry describes the session's first hard load, so only the
// first mount can be this page's own; ClientRouter keeps this module across
// in-site swaps.
let mounts = 0
function readTiming(returned: boolean): Timing | null {
  let nav: PerformanceNavigationTiming | undefined
  try { nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined } catch { /* exotic embeds */ }
  if (!nav || nav.responseEnd <= 0) return null
  const connect = Math.max(0, nav.connectEnd - nav.connectStart)
  const tls = nav.secureConnectionStart > 0 ? Math.max(0, nav.connectEnd - nav.secureConnectionStart) : 0
  let otherPage = returned
  try { otherPage ||= new URL(nav.name).pathname !== location.pathname } catch { /* a malformed name: assume this page */ }
  return {
    dns: Math.max(0, nav.domainLookupEnd - nav.domainLookupStart), connect, tls, tcp: Math.max(0, connect - tls),
    ttfb: Math.max(0, nav.responseStart - nav.requestStart), download: Math.max(0, nav.responseEnd - nav.responseStart),
    // A connect of zero is a connection the browser already had open. Over
    // HTTP/3 the transport and TLS handshakes are one QUIC exchange.
    reused: connect <= 0, quic: nav.nextHopProtocol === 'h3',
    fromCache: nav.transferSize === 0 && nav.decodedBodySize > 0, otherPage,
    protocol: nav.nextHopProtocol, size: nav.transferSize,
    dnsEnd: nav.domainLookupEnd, connectEnd: nav.connectEnd, firstByte: nav.responseStart, lastByte: nav.responseEnd, paint: readPaint(),
  }
}

// Cloudflare data centre codes to cities, from cloudflarestatus.com's
// component list (2026-09-28). A code missing here is shown as the code.
const COLO_CITY = new Map([
  'AAEAnnaba|ABJAbidjan|ABQAlbuquerque|ACCAccra|ACXXingyi|ADBIzmir|ADDAddis Ababa|ADLAdelaide|AGRAgra|',
  'AIPJalandhar|AKLAuckland|AKXAktobe|ALAAlmaty|ALGAlgiers|AMDAhmedabad|AMMAmman|AMSAmsterdam|ANCAnchorage|',
  'ARIArica|ARNStockholm|ARUAracatuba|ASKYamoussoukro|ASUAsunción|ATHAthens|ATLAtlanta|AUSAustin|AVAAnshun|',
  'BAHManama|BAQBarranquilla|BBIBhubaneswar|BCNBarcelona|BDQJamnagar|BEGBelgrade|BELBelém|BEYBeirut|',
  'BGIBridgetown|BGRBangor|BGWBaghdad|BKKBangkok|BLRBangalore|BNANashville|BNEBrisbane|BODBordeaux|',
  'BOGBogotá|BOMMumbai|BOSBoston|BRUBrussels|BSBBrasilia|BSRBasra|BTSBratislava|BUDBudapest|BUFBuffalo|',
  'BWNBandar Seri Begawan|CAICairo|CANGuangzhou|CAWCampos dos Goytacazes|CBRCanberra|CCUKolkata|CDGParis|',
  'CEBCebu|CFCCaçador|CGBCuiaba|CGDChangde|CGKJakarta|CGOZhengzhou|CGPChittagong|CGYCagayan de Oro|',
  'CHCChristchurch|CJBCoimbatore|CKGChongqing|CLECleveland|CLOCali|CLTCharlotte|CMBColombo|CMHColumbus|',
  'CNFBelo Horizonte|CNNKannur|CNXChiang Mai|COKKochi|CORCórdoba|CPHCopenhagen|CPTCape Town|CRKTarlac City|',
  'CSXChangsha|CTUChengdu|CVGCincinnati|CWBCuritiba|CZLConstantine|CZXChangzhou|DACDhaka|DADDa Nang|',
  'DARDar Es Salaam|DELNew Delhi|DENDenver|DFWDallas|DKRDakar|DLADouala|DLCDalian|DMEMoscow|DMMDammam|',
  'DOHDoha|DPSDenpasar|DTWDetroit|DUBDublin|DURDurban|DUSDüsseldorf|DXBDubai|DYUDushanbe|EBBKampala|',
  'EBLErbil|EVNYerevan|EWRNewark|EZEBuenos Aires|FCORome|FIHKinshasa|FLNFlorianopolis|FOCFuzhou|',
  'FORFortaleza|FRAFrankfurt|FRUBishkek|FSDSioux Falls|FUKFukuoka|FUOFoshan|GBEGaborone|GDLGuadalajara|',
  'GEOGeorgetown|GIGRio de Janeiro|GNDSt. George’s|GOTGothenburg|GRUSão Paulo|GUAGuatemala City|GUMHagatna|',
  'GVAGeneva|GYDBaku|GYEGuayaquil|GYNGoiânia|HAKHaikou|HAMHamburg|HANHanoi|HBAHobart|HELHelsinki|HFAHaifa|',
  'HGHShaoxing|HKGHong Kong|HNLHonolulu|HREHarare|HYDHyderabad|HYNTaizhou|IADAshburn|IAHHouston|ICNSeoul|',
  'INDIndianapolis|ISBIslamabad|ISTIstanbul|ISUSulaymaniyah|IXCChandigarh|JAXJacksonville|',
  'JDOJuazeiro do Norte|JEDJeddah|JHBJohor Bahru|JIBDjibouti City|JNBJohannesburg|JOGYogyakarta|',
  'JOIJoinville|JRGSambalpur|JXGJiaxing|KBPKyiv|KCHKuching|KEFReykjavík|KGLKigali|KHHKaohsiung|KHIKarachi|',
  'KHNXinyu|KINKingston|KIVChișinău|KIXOsaka|KMGKunming|KNUKanpur|KTMKathmandu|KULKuala Lumpur|KWEGuiyang|',
  'KWIKuwait City|LADLuanda|LASLas Vegas|LAXLos Angeles|LCANicosia|LEDSaint Petersburg|LHELahore|LHRLondon|',
  'LHWLanzhou|LIMLima|LISLisbon|LJULjubljana|LLKAstara|LLWLilongwe|LOSLagos|LPBLa Paz|LUHLudhiana|LUNLusaka|',
  'LUXLuxembourg City|LYALuoyang|LYSLyon|MAAChennai|MADMadrid|MANManchester|MAOManaus|MBAMombasa|',
  'MCIKansas City|MCTMuscat|MDEMedellín|MELMelbourne|MEMMemphis|MEXMexico City|MFMMacau|MIAMiami|',
  'MLASanta Venera|MLEMalé|MLGMalang|MNLManila|MPMMaputo|MRSMarseille|MRUPort Louis|MSPMinneapolis|MSQMinsk|',
  'MUCMunich|MXPMilan|NAGNagpur|NBONairobi|NJFNajaf|NOUNoumea|NQNNeuquén|NQZAstana|NRTTokyo|NVTTimbó|',
  'OKANaha|OKCOklahoma City|OMAOmaha|ORDChicago|ORFNorfolk|ORNOran|OSLOslo|OTPBucharest|OUAOuagadougou|',
  'PATPatna|PBHThimphu|PBMParamaribo|PDXPortland|PERPerth|PHLPhiladelphia|PHXPhoenix|PITPittsburgh|',
  'PKXLangfang|PMOPalermo|PMWPalmas|PNHPhnom Penh|PNQPune|POAPorto Alegre|POSPort of Spain|PPTTahiti|',
  'PRGPrague|PTYPanama City|QROQueretaro|QWJAmericana|RAORibeirao Preto|RDUDurham|RECRecife|RICRichmond|',
  'RIXRiga|RUHRiyadh|RUNSaint-Denis|SANSan Diego|SAPSan Pedro Sula|SATSan Antonio|SCLSantiago|',
  'SDQSanto Domingo|SEASeattle|SFOSan Francisco|SGNHo Chi Minh City|SHAShanghai|SINSingapore|SJCSan Jose|',
  'SJKSão José dos Campos|SJOSan José|SJPSão José do Rio Preto|SJUSan Juan|SJWHengshui|SKGThessaloniki|',
  'SKPSkopje|SLCSalt Lake City|SMFSacramento|SODSorocaba|SOFSofia|SSASalvador|STISantiago de los Caballeros|',
  'STLSt. Louis|STRStuttgart|SUVSuva|SYDSydney|SZXShenzhen|TAOQingdao|TBSTbilisi|TENTongren|TGUTegucigalpa|',
  'TIATirana|TLHTallahassee|TLLTallinn|TLVTel Aviv|TNAJinan|TNRAntananarivo|TPATampa|TPETaipei|TUNTunis|',
  'TXLBerlin|TYNYangquan|UDIUberlândia|UDRUdaipur|UIOQuito|ULNUlaanbaatar|URTSurat Thani|VCPCampinas|',
  'VIEVienna|VIXVitoria|VNOVilnius|VTEVientiane|WAWWarsaw|WDHWindhoek|WLGWellington|WROWroclaw|XAPChapeco|',
  'XFNXiangyang|XIYBaoji|XNHNasiriyah|YHZHalifax|YULMontréal|YVRVancouver|YWGWinnipeg|YXESaskatoon|',
  'YYCCalgary|YYZToronto|ZAGZagreb|ZDMRamallah|ZRHZurich',
].join('').split('|').map(e => [e.slice(0, 3), e.slice(3)] as [string, string]))

function countryName(code: string): string {
  // XX is unknown and T1 is Tor: neither is a place.
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return ''
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? '' } catch { return '' }
}
// The visitor's own address, shown back to them only, and only its start:
// enough to make the point, not enough to read off a shared screen. The rest
// is dropped here and never kept.
function ipStart(ip: string): string {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split('.').slice(0, 2).join('.')
  if (/^[0-9a-f:]+$/i.test(ip) && ip.includes(':')) return ip.split(':').slice(0, 2).join(':')
  return ''
}
function tlsName(v: string): string { return /^TLSv1\.[0-3]$/.test(v) ? `TLS ${v.slice(4)}` : '' }
function httpName(v: string): string {
  if (v === 'h3' || v === 'http/3') return 'HTTP/3'
  if (v === 'h2' || v === 'http/2') return 'HTTP/2'
  if (v === 'http/1.1') return 'HTTP/1.1'
  return ''
}
function parseTrace(body: string): Edge | null {
  const kv = new Map<string, string>()
  for (const line of body.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0) kv.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
  }
  const colo = kv.get('colo') ?? ''
  if (!/^[A-Z]{3}$/.test(colo)) return null
  const kex = kv.get('kex') ?? ''
  return {
    colo, city: COLO_CITY.get(colo) ?? '', country: countryName(kv.get('loc') ?? ''), ip: ipStart(kv.get('ip') ?? ''),
    tls: tlsName(kv.get('tls') ?? ''), kex: /^[A-Za-z0-9_-]{1,40}$/.test(kex) ? kex : '', http: httpName(kv.get('http') ?? ''),
  }
}
function cacheKind(status: string): CacheKind {
  if (status === 'HIT' || status === 'STALE' || status === 'UPDATING') return 'hit'
  if (status === 'MISS' || status === 'EXPIRED' || status === 'DYNAMIC' || status === 'BYPASS' || status === 'REVALIDATED') return 'origin'
  return ''
}
async function fetchWithTimeout(url: string, outer: AbortSignal, ms: number, method = 'GET'): Promise<Response> {
  const ac = new AbortController()
  const onAbort = () => ac.abort()
  outer.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    return await fetch(url, { method, cache: 'no-store', signal: ac.signal })
  } finally {
    clearTimeout(timer)
    outer.removeEventListener('abort', onAbort)
  }
}
async function loadEdge(signal: AbortSignal): Promise<Edge | null> {
  try {
    const res = await fetchWithTimeout('/cdn-cgi/trace', signal, 2500)
    return res.ok ? parseTrace(await res.text()) : null
  } catch {
    return null
  }
}
// Which way the page itself came: from Cloudflare's copy or from the server.
// Production sends no Server-Timing, so this asks again with a HEAD and reads
// its copy's age. A copy older than this visit was already there when the page
// was requested; a younger one was made by this very visit.
async function loadCache(signal: AbortSignal): Promise<CacheFacts> {
  try {
    const res = await fetchWithTimeout('/', signal, 2500, 'HEAD')
    const status = (res.headers.get('cf-cache-status') ?? '').toUpperCase()
    const age = Number.parseInt(res.headers.get('age') ?? '', 10)
    if (cacheKind(status) === 'hit') {
      if (!Number.isFinite(age)) return NO_CACHE
      return age > performance.now() / 1000 + 1 ? { cache: 'hit', cacheStatus: status, cacheAge: age } : { cache: 'origin', cacheStatus: '', cacheAge: 0 }
    }
    // Not cacheable right now: this visit went to the server too.
    if (status === 'DYNAMIC' || status === 'BYPASS') return { cache: 'origin', cacheStatus: status, cacheAge: 0 }
  } catch { /* no answer: say nothing about the cache */ }
  return NO_CACHE
}
// Dev only. The dev server serves this page from localhost, so it measures one
// real request to the live site from this machine instead (astro.config.mjs).
interface Probe { dns: number; tcp: number; tls: number; ttfb: number; download: number; size: number; cache: string; age: number | null; trace: string }
async function loadProbe(signal: AbortSignal): Promise<Pick<Facts, 'timing' | 'edge' | 'cache' | 'cacheStatus' | 'cacheAge'>> {
  const none = { timing: null, edge: null, ...NO_CACHE }
  if (!import.meta.env.DEV) return none
  try {
    const res = await fetchWithTimeout('/__hero-probe', signal, 12000)
    if (!res.ok) return none
    const p = await res.json() as Probe
    const connect = p.tcp + p.tls
    const dnsEnd = p.dns, connectEnd = dnsEnd + connect, firstByte = connectEnd + p.ttfb, lastByte = firstByte + p.download
    const status = p.cache.toUpperCase()
    return {
      timing: {
        dns: p.dns, connect, tls: p.tls, tcp: p.tcp, ttfb: p.ttfb, download: p.download,
        reused: false, quic: false, fromCache: false, otherPage: false, protocol: 'http/1.1', size: p.size,
        dnsEnd, connectEnd, firstByte, lastByte, paint: 0,
      },
      edge: parseTrace(p.trace), cache: cacheKind(status), cacheStatus: status, cacheAge: p.age ?? 0,
    }
  } catch {
    return none
  }
}
async function pingOnce(signal: AbortSignal): Promise<number> {
  if (import.meta.env.DEV) {
    // As in loadProbe: on the dev server, the dev server times the live site.
    const res = await fetchWithTimeout('/__hero-probe?ping', signal, 8000)
    const body = await res.json() as { ms?: unknown }
    if (!res.ok || typeof body.ms !== 'number') throw new Error('no ping')
    return body.ms
  }
  // The trace is answered by the data centre itself, never the server, so the
  // number is the round trip the log names and a click never costs a page render.
  const t0 = performance.now()
  await fetchWithTimeout('/cdn-cgi/trace', signal, 5000)
  return performance.now() - t0
}
// The browser and system a request announces in its User-Agent header,
// which every server receives.
function visitorDevice(): string {
  const ua = navigator.userAgent
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : ''
  return browser && os ? `${browser} on ${os}` : browser || os
}

// ---- Stories. A step is one message in the log and one move on the line:
// flights of packets along routes, then its numbers land.
interface Flight { route: string[]; pal: number; count: number }
interface Step {
  title: string
  /** Shown when the step lands; '' for none. */
  ms: string
  text: string
  detail: string
  pal: number
  flights: Flight[]
  /** Screen ms the flights take. */
  screen: number
  /** The clock when the step lands: real ms since the page was requested. */
  at: number
  pulse?: string
  /** Lights a route with no packets on it (a connection already open). */
  glow?: string[]
  chip?: [string, string]
  fill?: boolean
  hit?: boolean
}
interface Story {
  kicker: string
  headline: string
  stations: Station[]
  steps: Step[]
  total: number | null
  ping: string[]
  pingText: string
}
type Line = Pick<Step, 'title' | 'ms' | 'text' | 'detail' | 'pal'>

const HOST = 'apanjwani0.com'
function fmtMs(ms: number): string { return `${Math.round(ms)} ms` }
function fmtClock(ms: number): string { return ms < 1000 ? fmtMs(ms) : `${(ms / 1000).toFixed(2)} s` }
function seconds(ms: number): string { return `${(Math.max(10, ms) / 1000).toFixed(2)} seconds` }
function ago(s: number): string {
  if (s < 90) return `${Math.round(s)} seconds`
  if (s < 5400) return `${Math.round(s / 60)} minutes`
  if (s < 172800) return `${Math.round(s / 3600)} hours`
  return `${Math.round(s / 86400)} days`
}
// Screen time for a measured phase: tiny phases stay watchable, long ones
// don't drag, and order and relative size stay true.
function watch(ms: number): number { return clamp(1000 + 120 * Math.sqrt(Math.max(0, ms)), 1000, 3200) }
function totalOf(t: Timing): number { return t.paint > t.lastByte ? t.paint : t.lastByte }
const PQ = ' The way they agreed on the key is designed to stay safe even against future quantum computers.'

function networkStory(f: Facts | null, touch: boolean): Story {
  const t = f?.timing ?? null, e = f?.edge ?? null
  const place = e?.city || e?.colo || ''
  const edgeName = place ? `Cloudflare’s data centre in ${place}` : 'Cloudflare’s network'
  const tlsBits = [e?.tls, e?.kex].filter(Boolean).join(' · ')
  const you = [
    e?.country ? `You are in ${e.country}.` : '',
    f?.device ? `You are using ${f.device}.` : '',
    e?.ip ? `Your IP address starts with ${e.ip}.` : '',
  ].filter(Boolean).join(' ')
  const colo = e?.colo && e.colo !== place ? ` (${e.colo})` : ''
  const copy = f?.cache === 'hit' ? `, using a copy it saved ${ago(f.cacheAge)} ago` : f?.cache === 'origin' ? ', after getting a fresh copy from the server' : ''
  // Every line is plain and explanatory, written for someone who has never
  // heard of DNS (owner, 2026-09-30): what the stop is, then what it did on
  // this visit, and only what was measured.
  const stations: Station[] = [
    {
      id: 'you', kind: touch ? 'phone' : 'laptop', label: 'you', sub: f?.device ?? '', now: you,
      what: 'This is your device. Your browser asked for this website, and it shows the page on your screen.',
    },
    {
      id: 'net', kind: 'router', label: 'your network', sub: 'Wi-Fi or mobile data', now: '',
      what: 'This is your Wi-Fi router, or your phone’s mobile data. Everything your device sends to the internet goes through it first.',
    },
    {
      id: 'isp', kind: 'isp', label: 'ISP', sub: 'internet provider', now: '',
      what: 'ISP means internet service provider: the company you pay for internet at home or on your phone. Its network connects you to the rest of the internet.',
    },
    {
      id: 'dns', kind: 'dns', label: 'DNS', sub: 'finds the address', branch: true,
      what: `Computers find each other using numbers called IP addresses, not names. DNS works like a phone book: your browser gives it the name ${HOST} and gets back its IP address.`,
      now: !t ? '' : t.dns >= 1 ? `This time, it found the address in ${fmtMs(t.dns)}.` : 'This time, your browser already knew the address, so it did not ask.',
    },
    {
      id: 'edge', kind: 'edge', label: 'Cloudflare', sub: place, code: e?.colo ?? '', via: 'the internet',
      what: 'Cloudflare runs data centres in cities around the world, and this website uses it. Your request goes to one of them, usually one near you. It can answer with a copy of the page that it saved earlier.',
      now: place ? `This time, the data centre in ${place}${colo} answered${copy}.` : '',
    },
    {
      // 'server', not 'the server': on a phone it sits a few pixels from
      // 'Cloudflare', and the two read as one phrase.
      id: 'origin', kind: 'origin', label: 'server', sub: 'builds this page',
      what: 'The server is the computer that builds the pages of this website. Cloudflare only asks it for a page when it does not already have a recent copy.',
      now: f?.cache === 'hit' ? 'This time it was not needed, because Cloudflare already had a copy.' : f?.cache === 'origin' ? 'This time Cloudflare asked it for a fresh copy of the page.' : '',
    },
  ]
  const story: Story = {
    kicker: 'How this website got to your device', headline: '', stations, steps: [], total: null,
    ping: ['you', 'net', 'isp', 'edge', 'isp', 'net', 'you'],
    pingText: `Your browser sent a small test message, called a ping, to ${place ? `the data centre in ${place}` : 'Cloudflare'} and got a reply. The number is how long that round trip took.`,
  }
  if (!f) return story
  if (!t) {
    story.headline = f.dev
      ? `The dev server could not reach ${HOST}, so there is nothing to replay.`
      : 'Your browser did not share its timing data, so there is nothing to replay.'
    return story
  }
  const total = totalOf(t)
  story.total = total
  story.headline = t.fromCache
    ? 'Your browser loaded this page from a copy it saved earlier, so it did not need to download it again.'
    : `${t.otherPage ? 'The first page you opened on this site' : 'This page'} took ${seconds(total)} to load. The animation below replays it slowly.`
  const steps = story.steps
  const there: Flight = { route: ['you', 'net', 'isp', 'edge'], pal: OUT, count: 1 }
  const back: Flight = { route: ['edge', 'isp', 'net', 'you'], pal: BACK, count: 1 }
  const shake: Flight[] = [{ route: there.route, pal: SHAKE, count: 3 }, { route: back.route, pal: SHAKE, count: 3 }]

  steps.push({
    title: e?.country ? `You, in ${e.country}` : 'You', ms: '', detail: '', pal: OUT, flights: [], screen: 900, at: 0, pulse: 'you',
    text: [
      f.device ? `You opened ${HOST} in ${f.device}.` : `You opened ${HOST}.`,
      e?.ip ? `Your IP address starts with ${e.ip}.` : '',
      e?.ip || e?.country ? 'Every website you visit can see these details.' : '',
    ].filter(Boolean).join(' '),
  })
  if (t.fromCache) {
    steps.push({
      title: 'Loaded from your device', ms: fmtMs(total), detail: 'browser cache', pal: SHAKE, flights: [], screen: 1100, at: total, pulse: 'you',
      text: 'Your browser had saved a copy of this page earlier, so it did not need to download it again.', chip: ['you', 'saved copy'],
    })
    return story
  }
  // Under a millisecond is the browser's own cache answering, not a lookup.
  if (t.dns >= 1) {
    steps.push({
      title: 'Looking up the address', ms: fmtMs(t.dns), detail: 'DNS lookup', pal: OUT, screen: watch(t.dns), at: t.dnsEnd,
      text: `Your browser asked DNS for the IP address of ${HOST}. DNS is like a phone book that turns website names into numbers.`,
      flights: [{ route: ['you', 'net', 'isp', 'dns'], pal: OUT, count: 1 }, { route: ['dns', 'isp', 'net', 'you'], pal: BACK, count: 1 }], chip: ['dns', fmtMs(t.dns)],
    })
  } else {
    steps.push({
      title: 'Address already known', ms: '0 ms', detail: 'DNS cache', pal: SHAKE, flights: [], screen: 900, at: t.dnsEnd, pulse: 'you',
      text: `Your browser already knew the IP address of ${HOST} from before, so it did not need to look it up.`, chip: ['dns', 'remembered'],
    })
  }
  const reach = `Connecting to ${place || 'Cloudflare'}`
  const pq = /MLKEM|kyber/i.test(e?.kex ?? '') ? PQ : ''
  if (t.reused) {
    steps.push({
      title: 'Connection already open', ms: '0 ms', detail: 'connection reuse', pal: SHAKE, flights: [], screen: 1000, at: t.connectEnd,
      text: `Your browser already had a connection open to ${edgeName}, so it used that one.`, glow: there.route, chip: ['edge', 'reused'],
    })
  } else if (t.quic) {
    steps.push({
      title: reach, ms: fmtMs(t.connect), detail: ['QUIC', tlsBits].filter(Boolean).join(' · '), pal: SHAKE, flights: shake,
      screen: watch(t.connect), at: t.connectEnd, chip: ['edge', fmtMs(t.connect)],
      text: `Your request went through your internet provider to ${edgeName}. In the same step, the two sides set up encryption, so no one in between can read what they send.${pq}`,
    })
  } else {
    steps.push({
      title: reach, ms: fmtMs(t.tcp), detail: 'TCP handshake', pal: OUT, flights: [there, back], screen: watch(t.tcp),
      at: t.connectEnd - t.tls, chip: ['edge', fmtMs(t.tcp)],
      text: `Your request went through your router and your internet provider, then across the internet to ${edgeName}.`,
    })
    if (t.tls > 0) {
      steps.push({
        title: 'Setting up encryption', ms: fmtMs(t.tls), detail: tlsBits || 'TLS handshake', pal: SHAKE, flights: shake,
        screen: watch(t.tls), at: t.connectEnd, chip: ['edge', fmtMs(t.connect)],
        text: `Your browser and Cloudflare agreed on a secret key. From here on, everything they send is encrypted, so no one in between can read it.${pq}`,
      })
    }
  }
  const status = f.cacheStatus
  const first = ['first byte', status ? `cache ${status}` : ''].filter(Boolean).join(' · ')
  if (f.cache === 'hit') {
    steps.push({
      title: 'Cloudflare had a copy', ms: fmtMs(t.ttfb), detail: first, pal: OUT, flights: [there],
      screen: watch(t.ttfb), at: t.firstByte, hit: true, chip: ['origin', 'not needed'],
      text: `Cloudflare already had a copy of this page, saved ${ago(f.cacheAge)} ago, so it did not need to ask the server.`,
    })
  } else if (f.cache === 'origin') {
    const why = status === 'EXPIRED' ? 'Cloudflare’s copy of this page was out of date, so it asked the server to build a fresh one.'
      : status === 'REVALIDATED' ? 'Cloudflare checked with the server that its copy of this page was still up to date. It was.'
      : 'Cloudflare passed your request to the server, and the server built the page.'
    steps.push({
      title: 'Building the page', ms: fmtMs(t.ttfb), detail: first, pal: OUT, screen: watch(t.ttfb), at: t.firstByte, text: why,
      flights: [{ route: [...there.route, 'origin'], pal: OUT, count: 1 }, { route: ['origin', 'edge'], pal: BACK, count: 1 }],
      chip: ['origin', fmtMs(t.ttfb)],
    })
  } else {
    steps.push({
      title: 'Asking for the page', ms: fmtMs(t.ttfb), detail: first, pal: OUT, flights: [there], screen: watch(t.ttfb), at: t.firstByte,
      text: 'Your browser asked for the page, and the first part of it arrived.',
    })
  }
  const kb = t.size > 0 ? `${Math.max(1, Math.round(t.size / 1024))} KB` : ''
  steps.push({
    title: 'The page arrives', ms: fmtMs(t.download), detail: httpName(t.protocol) || e?.http || '', pal: BACK, screen: watch(t.download) + 400,
    at: t.lastByte, fill: true, flights: [{ route: back.route, pal: BACK, count: clamp(Math.round(4 + t.size / 3072), 4, 16) }],
    text: `The page came back in small pieces called packets${kb ? `, ${kb} in total` : ''}. Your browser put them back together.`,
  })
  const painted = t.paint > t.lastByte
  steps.push({
    title: painted ? 'On your screen' : 'Fully downloaded', ms: `at ${fmtMs(total)}`, detail: painted ? 'first paint' : 'last byte', pal: SHAKE,
    flights: [], screen: 900, at: total, pulse: 'you', chip: ['you', fmtClock(total)],
    text: `From opening ${HOST} to ${painted ? 'seeing it on your screen' : 'receiving the whole page'} took ${seconds(total)}.`,
  })
  return story
}

// What each stop acts out when its card opens: its own leg of the trip.
const DEMOS: Record<string, Flight[]> = {
  you: [{ route: ['you', 'net'], pal: OUT, count: 1 }],
  net: [{ route: ['you', 'net', 'isp'], pal: OUT, count: 1 }],
  isp: [{ route: ['net', 'isp', 'edge'], pal: OUT, count: 1 }],
  dns: [{ route: ['you', 'net', 'isp', 'dns'], pal: OUT, count: 1 }, { route: ['dns', 'isp', 'net', 'you'], pal: BACK, count: 1 }],
  edge: [{ route: ['edge', 'isp', 'net', 'you'], pal: BACK, count: 3 }],
  origin: [{ route: ['edge', 'origin'], pal: OUT, count: 1 }, { route: ['origin', 'edge'], pal: BACK, count: 1 }],
}

// ---- DOM: the frame (what this is, top left) and the log (what is
// happening, bottom right). No <style>: hero-network.css styles both.
function part<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, name: string, text = ''): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag)
  el.dataset.part = name
  if (text) el.textContent = text
  return el
}

// Pacing, in screen ms: the headline reads first, each message is typed for
// a beat, and a step dwells long enough to read.
const INTRO = 1500, TYPE = 520, LEG_MIN = 240, READ = 34
// How long a pointer rests on a stop before its card opens.
const HOVER = 140
// The height kept between the frame and the text block for the line and its
// labels, sub-lines included, on a phone and wider.
const PHONE_BAND = 230, BAND = 260
const POOL = 80, PULSES = 20

export const create: HeroCreate = (host, env) => {
  const doc = host.ownerDocument
  const section = env.text.section
  const { reduced, isTouch } = env
  const returned = mounts++ > 0
  const dpr = clamp(env.dpr || 1, 1, 2)
  const mono = getComputedStyle(section).getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace'

  const canvas = doc.createElement('canvas')
  canvas.dataset.type = 'hero-canvas'
  canvas.setAttribute('role', 'img')
  const poster = doc.createElement('div')
  poster.dataset.type = 'hero-poster'
  const pingTarget = doc.createElement('button')
  pingTarget.type = 'button'
  pingTarget.dataset.type = 'hero-ping'
  pingTarget.setAttribute('aria-hidden', 'true')
  pingTarget.tabIndex = -1
  const nodesLayer = doc.createElement('div')
  nodesLayer.dataset.type = 'hero-nodes'
  // The card repeats the focused button's label for sighted readers, so it is
  // hidden from screen readers, which get the label itself.
  const card = doc.createElement('div')
  card.dataset.type = 'hero-card'
  card.setAttribute('aria-hidden', 'true')
  const cardTitle = part(doc, 'p', 'stop-name')
  const cardWhat = part(doc, 'p', 'stop-what')
  const cardNow = part(doc, 'p', 'stop-now')
  card.append(cardTitle, cardWhat, cardNow)
  const frame = doc.createElement('div')
  frame.dataset.type = 'hero-frame'
  const headline = part(doc, 'p', 'headline')
  const replay = part(doc, 'button', 'replay', 'replay')
  replay.type = 'button'
  const clockEl = part(doc, 'span', 'clock')
  const bar = part(doc, 'p', 'bar')
  bar.append(replay, clockEl)
  const kicker = part(doc, 'p', 'kicker')
  frame.append(kicker, headline, bar)
  const log = doc.createElement('div')
  log.dataset.type = 'hero-log'
  // All three describe whoever is looking, a crawler included, so none may
  // become the page's search snippet.
  frame.setAttribute('data-nosnippet', '')
  log.setAttribute('data-nosnippet', '')
  card.setAttribute('data-nosnippet', '')
  host.append(canvas, poster, pingTarget, nodesLayer, card, frame, log)

  // The log sits at the stage's bottom right on desktop and moves into the
  // text block on a phone or when the name needs the width: after the links in
  // the markup, shown above the name (hero-network.css).
  let logInContent = false
  function placeLog(inContent: boolean) {
    if (inContent === logInContent) return
    logInContent = inContent
    if (inContent) (env.text.links ?? env.text.tagline).after(log)
    else host.appendChild(log)
  }

  let ctx: CanvasRenderingContext2D | null = null
  try { ctx = canvas.getContext('2d') } catch { /* an old or locked-down browser: the poster stands in */ }
  host.toggleAttribute('data-nw-fallback', !ctx)
  const sprites = ctx ? makeSprites() : null

  let story = networkStory(null, isTouch)
  let facts: Facts | null = null
  let links = linksOf(story.stations)
  let hops = hopsOf(story.stations, links)
  let pos: Pos[] = []
  let labels: Label[] = []
  const fonts: Fonts = { label: '', sub: '', chip: '', code: '' }
  const nodeHeat = story.stations.map(heat)
  const linkHeat = links.map(heat)
  const chips = story.stations.map(() => '')
  const pool: Packet[] = Array.from({ length: POOL }, () => ({ active: false, li: 0, rev: false, t: 0, dur: 1, pal: 0, size: 3, trail: false }))
  const pulses: Pulse[] = Array.from({ length: PULSES }, () => ({ active: false, i: 0, t: 0, dur: 1, pal: 0, maxR: 1 }))
  let stars: Star[] | null = null
  let w = 0, h = 0, phone = false, textTop = 0
  let time = 0, running = false, raf = 0, last = 0, destroyed = false
  interface Sched { at: number; run: () => void }
  let sched: Sched[] = [], si = 0, cursor = 0
  let clockKeys: Array<[number, number]> = []
  let fillWin: [number, number] | null = null
  let fill = 0, playing = false, pinging = false, pingSeq = 0, clockText = ''
  let typing: HTMLElement | null = null
  // The stop whose card is open: it glows and the rest of the drawing dims.
  // `veil` is how far the drawing has stepped back, eased in and out so that
  // a pointer crossing the line never flashes it; `lit` is the stop it lights.
  let cardIndex = -1, veil = 0, lit = -1, hoverTimer = 0

  kicker.textContent = story.kicker
  const indexOf = (id: string) => story.stations.findIndex(s => s.id === id)

  // ---- Traffic.
  function spawn(a: string, b: string, pal: number, dur: number, size: number, trail: boolean) {
    const hop = hops.get(`${a}>${b}`)
    if (!hop) return
    const p = pool.find(q => !q.active)
    if (!p) return
    p.active = true; p.li = hop.li; p.rev = hop.rev; p.t = 0; p.dur = Math.max(1, dur); p.pal = pal; p.size = size; p.trail = trail
  }
  function ring(i: number, pal: number, big = false) {
    const p = pulses.find(q => !q.active)
    if (!p || !pos[i]) return
    p.active = true; p.i = i; p.t = 0; p.pal = pal
    p.dur = big ? 950 : 540
    // A stop at the stage's edge rings inside it rather than off it.
    const q = pos[i], edge = Math.min(q.x, w - q.x) - 4
    p.maxR = Math.max(q.s * 1.3, Math.min(q.s * (big ? 2.6 : 1.7) + (big ? 30 : 16), edge))
  }
  function updateTraffic(dt: number) {
    const k = Math.exp(-2.2 * dt)
    for (const x of nodeHeat) x.heat *= k
    for (const x of linkHeat) x.heat *= k
    for (const p of pool) {
      if (!p.active) continue
      p.t += (dt * 1000) / p.dur
      const l = links[p.li], from = p.rev ? l.b : l.a, to = p.rev ? l.a : l.b
      bump(linkHeat[p.li], p.pal, p.rev ? -1 : 1)
      if (p.t < 0.12) bump(nodeHeat[from], p.pal)
      if (p.t < 1) continue
      p.active = false
      bump(nodeHeat[to], p.pal)
      // Only a lead packet rings the station it reaches: a burst or a stream
      // is many small packets, and a ring for each would bury the drawing.
      if (p.size >= 3) ring(to, p.pal)
      if (p.trail) { linkHeat[p.li].floor = TRAIL; nodeHeat[to].floor = TRAIL; nodeHeat[from].floor = TRAIL }
    }
    for (const p of pulses) if (p.active && (p.t += (dt * 1000) / p.dur) >= 1) p.active = false
  }

  // ---- The log.
  function logTyping(pal: number) {
    typing?.remove()
    typing = part(doc, 'div', 'typing')
    typing.dataset.tone = TONES[pal]
    typing.append(doc.createElement('i'), doc.createElement('i'), doc.createElement('i'))
    log.append(typing)
  }
  function logAdd(line: Line, landed: boolean): HTMLElement {
    typing?.remove()
    typing = null
    log.querySelector('[data-part="hint"]')?.remove()
    const msg = part(doc, 'div', 'msg')
    msg.dataset.tone = TONES[line.pal]
    const head = part(doc, 'p', 'msg-head')
    const ms = part(doc, 'span', 'msg-ms', line.ms)
    if (!landed) ms.dataset.pending = ''
    head.append(part(doc, 'b', 'msg-title', line.title), ms)
    msg.append(head, part(doc, 'p', 'msg-text', line.text))
    if (line.detail) msg.append(part(doc, 'p', 'msg-detail', line.detail))
    log.append(msg)
    // The log shows its newest few; older ones scroll out of its top edge.
    while (log.childElementCount > 9) log.firstElementChild?.remove()
    return ms
  }
  function logHint() {
    if (!facts) return
    log.append(part(doc, 'p', 'hint', isTouch
      ? 'Tap any stop to learn what it does. Tap anywhere else to send a ping and time the reply.'
      : 'Hover over any stop to learn what it does. Click anywhere else to send a ping and time the reply.'))
  }
  function setClock(text: string) {
    if (text === clockText) return
    clockText = text
    clockEl.textContent = text
  }

  // ---- The replay: a flat schedule built from the story, walked by one
  // cursor per frame. No per-step timers.
  function flights(ev: Sched[], list: Flight[], start: number, screen: number, trail = true): number {
    const legs = list.reduce((n, f) => n + f.route.length - 1, 0)
    if (!legs) return start
    const leg = Math.max(LEG_MIN, screen / legs)
    let cur = start
    for (const f of list) {
      const gap = f.count > 1 ? Math.min(leg * 0.4, 120) : 0
      const size = f.count > 1 ? 2.4 : 3.4
      let end = cur
      for (let k = 0; k < f.count; k++) {
        let at = cur + k * gap
        for (let i = 0; i + 1 < f.route.length; i++) {
          const a = f.route[i], b = f.route[i + 1]
          ev.push({ at, run: () => spawn(a, b, f.pal, leg, size, trail) })
          at += leg
        }
        end = at
      }
      cur = end
    }
    return cur
  }
  // Lights a route's wires and stops: in the replay it flashes and leaves a
  // trail; in the still frame (reduced motion) it only takes the colour.
  function glow(route: string[], pal: number, still = false) {
    for (let i = 0; i + 1 < route.length; i++) {
      const hop = hops.get(`${route[i]}>${route[i + 1]}`)
      if (!hop) continue
      const l = links[hop.li]
      for (const x of [linkHeat[hop.li], nodeHeat[l.a], nodeHeat[l.b]]) {
        if (still) { x.c = PALETTE[pal]; x.floor = 0.5 } else { bump(x, pal); x.floor = TRAIL }
      }
    }
  }
  function setChip(id: string, text: string) {
    const i = indexOf(id)
    if (i >= 0) chips[i] = text
  }
  function plan() {
    const ev: Sched[] = []
    const keys: Array<[number, number]> = []
    let win: [number, number] | null = null
    let cur = INTRO, real = 0
    story.steps.forEach((step, n) => {
      ev.push({ at: cur, run: () => logTyping(step.pal) })
      cur += TYPE
      const msg: { ms: HTMLElement | null } = { ms: null }
      ev.push({
        at: cur,
        run: () => {
          msg.ms = logAdd(step, false)
          if (step.pulse) ring(indexOf(step.pulse), step.pal, n === 0)
          if (step.glow) glow(step.glow, SHAKE)
        },
      })
      const start = cur
      const end = Math.max(flights(ev, step.flights, start, step.screen), step.flights.length ? start : start + step.screen)
      keys.push([start, real], [end, step.at])
      real = step.at
      if (step.fill) win = [start, end]
      ev.push({
        at: end,
        run: () => {
          if (msg.ms) delete msg.ms.dataset.pending
          if (step.chip) setChip(step.chip[0], step.chip[1])
          if (step.hit) ring(indexOf('edge'), SHAKE, true)
        },
      })
      cur = end + clamp(step.text.length * READ - step.screen, 700, 2400)
    })
    ev.push({ at: cur, run: finish })
    ev.sort((a, b) => a.at - b.at)
    sched = ev; si = 0; cursor = 0; clockKeys = keys; fillWin = win
  }
  function clockAt(c: number): number {
    if (!clockKeys.length || c <= clockKeys[0][0]) return 0
    for (let i = 1; i < clockKeys.length; i++) {
      const [t1, v1] = clockKeys[i]
      if (c > t1) continue
      const [t0, v0] = clockKeys[i - 1]
      return t1 > t0 ? lerp(v0, v1, (c - t0) / (t1 - t0)) : v1
    }
    return clockKeys[clockKeys.length - 1][1]
  }
  function finish() {
    playing = false
    setClock(story.total !== null ? fmtClock(story.total) : '')
    logHint()
  }
  function resetScene() {
    for (const x of nodeHeat) { x.heat = 0; x.floor = 0 }
    for (const x of linkHeat) { x.heat = 0; x.floor = 0 }
    chips.fill('')
    for (const p of pool) p.active = false
    for (const p of pulses) p.active = false
    fill = 0
    // A ping still animating loses its landing to the new schedule, so it must
    // not keep the next ping locked out.
    pinging = false
    pingSeq += 1
    typing = null
    log.replaceChildren()
    setClock('')
  }
  function play() {
    if (!facts) return
    resetScene()
    if (reduced || !ctx) { renderFinal(); return }
    if (!story.steps.length) { finish(); return }
    plan()
    playing = true
  }
  // Reduced motion never runs the loop, so a replay resolves at once: every
  // route it would light is lit, every chip set and every message shown.
  function renderFinal() {
    for (const step of story.steps) {
      for (const f of step.flights) glow(f.route, f.pal, true)
      if (step.glow) glow(step.glow, SHAKE, true)
      if (step.chip) setChip(step.chip[0], step.chip[1])
      logAdd(step, true)
    }
    fill = 1
    finish()
    draw()
  }
  function advance(dt: number) {
    cursor += dt * 1000
    while (si < sched.length && cursor >= sched[si].at) sched[si++].run()
    if (!playing) return
    if (story.total !== null && clockKeys.length) setClock(`${fmtClock(clockAt(cursor))} of ${fmtClock(story.total)}`)
    if (fillWin) fill = clamp((cursor - fillWin[0]) / Math.max(1, fillWin[1] - fillWin[0]), 0, 1)
  }

  // ---- Ping: a real request, timed, once the replay is over. The packet
  // travels the measured round trip slowed to watchable, and the log answers
  // when it lands, not when the request resolved.
  function ping() {
    if (!facts || playing || pinging) return
    pinging = true
    const seq = ++pingSeq
    pingOnce(env.signal).then(ms => landPing(seq, ms), () => landPing(seq, -1))
  }
  function landPing(seq: number, ms: number) {
    // A replay started while the request was out: it has cleared the log, and
    // a ping sent after it owns the next line.
    if (destroyed || playing || seq !== pingSeq) return
    const line: Line = ms < 0
      ? { title: 'Ping', ms: '', text: 'Your browser sent a small test message, but no reply came back.', detail: '', pal: OUT }
      : { title: 'Ping', ms: fmtMs(ms), text: story.pingText, detail: 'GET /cdn-cgi/trace', pal: OUT }
    if (reduced || !ctx || !running || ms < 0) {
      pinging = false
      logAdd(line, true)
      logHint()
      return
    }
    const route = story.ping, half = (route.length - 1) / 2
    const leg = clamp((ms * 6) / (route.length - 1), LEG_MIN, 520)
    const ev: Sched[] = []
    let at = cursor + 30
    ev.push({ at, run: () => logTyping(OUT) })
    for (let i = 0; i + 1 < route.length; i++) {
      const a = route[i], b = route[i + 1], pal = i < half ? OUT : BACK
      ev.push({ at, run: () => spawn(a, b, pal, leg, 3, false) })
      at += leg
    }
    ev.push({ at, run: () => { pinging = false; logAdd(line, true); logHint() } })
    enqueue(ev)
  }
  // Merges events into what is still to come, in time order, and drops what
  // has run, so a ping never waits behind a stop's demo.
  function enqueue(ev: Sched[]) {
    sched = sched.slice(si).concat(ev).sort((a, b) => a.at - b.at)
    si = 0
  }
  pingTarget.addEventListener('click', () => { closeCard(); ping() }, { signal: env.signal })
  replay.addEventListener('click', play, { signal: env.signal })

  // ---- Stops explain themselves. Each glyph has an invisible, focusable
  // button over it, so a keyboard reaches what a hover or a tap shows: a card
  // saying what the stop is and what it did on this visit, while the stop
  // stays lit, the rest of the drawing steps back, and the stop acts out its
  // own leg of the trip.
  const on = { signal: env.signal }
  const buttons = story.stations.map((st, i) => {
    const b = doc.createElement('button')
    b.type = 'button'
    b.dataset.type = 'hero-node-btn'
    b.dataset.node = st.id
    // A pointer has to rest on a stop for a moment: one passing over the
    // line on its way elsewhere opens nothing.
    b.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); hoverTimer = window.setTimeout(() => openCard(i), HOVER) }, on)
    b.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); closeCard(i) }, on)
    b.addEventListener('focus', () => openCard(i), on)
    b.addEventListener('blur', () => closeCard(i), on)
    // A touch screen has no hover, and Safari never focuses a tapped button.
    b.addEventListener('click', () => openCard(i, true), on)
    nodesLayer.appendChild(b)
    return b
  })
  let actedAt = -Infinity, actedBy = -1
  function openCard(i: number, again = false) {
    const st = story.stations[i]
    if (destroyed || !st || !pos[i]) return
    const fresh = cardIndex !== i
    cardIndex = i
    lit = i
    cardTitle.textContent = st.label
    cardWhat.textContent = st.what
    cardNow.textContent = st.now
    cardNow.hidden = !st.now
    placeCard(i)
    card.dataset.shown = ''
    if (fresh || again) actOut(i)
    renderNow()
  }
  function closeCard(i = cardIndex) {
    if (i < 0 || cardIndex !== i) return
    cardIndex = -1
    delete card.dataset.shown
    renderNow()
  }
  function placeCard(i: number) {
    const p = pos[i], st = story.stations[i]
    const cw = card.offsetWidth, ch = card.offsetHeight
    let left: number, top: number
    if (phone) {
      // Too narrow to sit beside a stop: above it, or below when there is no room.
      left = p.x - cw / 2
      top = p.y - GLYPH_TOP[st.kind] * p.s - 14 - ch
      if (top < 8) top = p.y + GLYPH_BOTTOM[st.kind] * p.s + 14
    } else {
      const reach = p.s * 1.4 + 14
      left = p.x + reach
      if (left + cw > w - 8) left = p.x - reach - cw
      top = p.y - ch / 2
    }
    // Never under the name, which paints above the whole stage.
    card.style.left = `${clamp(left, 8, Math.max(8, w - cw - 8))}px`
    card.style.top = `${clamp(top, 8, Math.max(8, textTop - ch - 8))}px`
  }
  // Only between replays and pings, whose packets it would muddle, and never
  // under reduced motion. A second tap on the same stop plays it again.
  function actOut(i: number) {
    const now = performance.now()
    if (reduced || !running || playing || pinging || (i === actedBy && now - actedAt < 1200)) return
    actedAt = now; actedBy = i
    ring(i, OUT)
    const demo = DEMOS[story.stations[i].id]
    if (!demo) return
    const ev: Sched[] = []
    flights(ev, demo, cursor + 80, 1300, false)
    enqueue(ev)
  }
  function refreshText() {
    kicker.textContent = story.kicker
    headline.textContent = story.headline
    headline.toggleAttribute('data-ready', Boolean(story.headline))
    story.stations.forEach((st, i) => buttons[i].setAttribute('aria-label', `${st.label}: ${st.what}${st.now ? ` ${st.now}` : ''}`))
    canvas.setAttribute('aria-label', `A diagram of how this website got to your device: ${story.stations.map(s => (s.sub ? `${s.label} (${s.sub})` : s.label)).join(', ')}, joined by moving packets.`)
    if (cardIndex >= 0) openCard(cardIndex)
  }

  // ---- Layout: the name makes room for the log, then the line fills the band
  // between the frame and whichever text block reaches highest. When the
  // frame, the line and the text block cannot share one screen (a short
  // window, a phone either way up), the hero grows taller and the line keeps
  // its room.
  function layout() {
    section.style.minHeight = ''
    env.text.name.style.fontSize = ''
    env.text.tagline.style.maxWidth = ''
    let stacked = false
    if (!phone) {
      // The log's place at the stage's bottom right, measured on an empty
      // stand-in: moving the log there and back restarts its messages' fade.
      const slot = host.appendChild(log.cloneNode(false) as HTMLElement)
      const nameRect = env.text.name.getBoundingClientRect(), logRect = slot.getBoundingClientRect()
      slot.remove()
      const room = logRect.left - 40 - nameRect.left
      if (nameRect.width > room) {
        const fit = (parseFloat(getComputedStyle(env.text.name).fontSize) * room) / nameRect.width * 0.99
        if (fit >= 48) env.text.name.style.fontSize = `${fit}px`
        else stacked = true
      }
      if (!stacked) {
        const tagRect = env.text.tagline.getBoundingClientRect()
        env.text.tagline.style.maxWidth = `min(46ch, ${Math.max(160, logRect.left - 40 - tagRect.left)}px)`
      }
    }
    placeLog(phone || stacked)
    const hostRect = host.getBoundingClientRect()
    const textAt = () => {
      const t = env.text.content.getBoundingClientRect().top
      return (logInContent ? t : Math.min(t, log.getBoundingClientRect().top)) - hostRect.top
    }
    const frameBottom = frame.getBoundingClientRect().bottom - hostRect.top
    // The text block keeps its height as the hero grows; only its top moves.
    const need = Math.ceil(frameBottom + (phone ? PHONE_BAND : BAND) + hostRect.height - textAt())
    if (need > hostRect.height) section.style.minHeight = `${need}px`
    textTop = textAt()
    const top = frameBottom + (phone ? 10 : 20)
    fonts.label = `${phone ? 11 : 13}px ${mono}`
    fonts.sub = `${phone ? 10 : 12}px ${mono}`
    fonts.chip = `600 ${phone ? 10 : 12}px ${mono}`
    const { step } = lineX(w, phone, story.stations.filter(s => !s.branch).length)
    const lead = phone ? 13 : 15
    const full = ctx ? labelLines(ctx, story.stations, fonts, phone ? step * 0.96 : Math.min(step * 0.9, 230)) : story.stations.map(s => [s.label])
    const place = (lines: string[][]) => {
      // Each block also reserves its chip's line.
      const block = (branch: boolean) => Math.max(0, ...lines.map((l, i) => (Boolean(story.stations[i].branch) === branch ? lead * (l.length + 1) : 0)))
      pos = layoutLine(story.stations, w, top, textTop - (phone ? 6 : 12), phone, block(true) + 10, block(false) + (phone ? 14 : 17))
      if (ctx) labels = layoutLabels(ctx, story.stations, pos, lines, fonts, lead, w, textTop, phone)
    }
    place(full)
    // A band too short for the sub-lines (a small phone) keeps just the names,
    // rather than hiding whole labels behind the text block.
    if (labels.some(l => l.hidden)) place(full.map(l => l.slice(0, 1)))
    fonts.code = `600 ${Math.round(0.34 * (pos[indexOf('edge')]?.s ?? 30))}px ${mono}`
    buttons.forEach((b, i) => {
      const p = pos[i], hit = p.s * 2.2
      b.style.left = `${p.x}px`; b.style.top = `${p.y}px`
      b.style.width = `${hit}px`; b.style.height = `${hit}px`
      b.style.margin = `${-hit / 2}px 0 0 ${-hit / 2}px`
    })
    if (cardIndex >= 0) placeCard(cardIndex)
  }
  function resize(width: number, height: number) {
    const ow = w, oh = h
    w = width; h = height; phone = w <= 520
    section.toggleAttribute('data-nw-phone', phone)
    if (ctx) {
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
    }
    if (!stars) stars = makeStars(starCount(w, h, env.lowPower), w, h)
    else if (ow && oh) for (const st of stars) { st.x *= w / ow; st.y *= h / oh }
    layout()
    renderNow()
  }
  // The name's web font changes the text block's height once it loads.
  doc.fonts?.ready.then(() => { if (!destroyed && w) { layout(); renderNow() } }).catch(() => { /* layout stays correct without it */ })

  // ---- Drawing.
  const PT = { x: 0, y: 0, ang: 0, len: 1 }
  function packetPoint(p: Packet) {
    const l = links[p.li], a = pos[p.rev ? l.b : l.a], b = pos[p.rev ? l.a : l.b]
    const dx = b.x - a.x, dy = b.y - a.y, t = clamp(p.t, 0, 1)
    PT.x = a.x + dx * t; PT.y = a.y + dy * t; PT.ang = Math.atan2(dy, dx); PT.len = Math.sqrt(dx * dx + dy * dy) || 1
  }
  function drawLinks(c: CanvasRenderingContext2D) {
    for (let li = 0; li < links.length; li++) {
      const l = links[li], a = pos[l.a], b = pos[l.b], x = linkHeat[li]
      mixInto(MIX, REST, x.c, Math.max(x.heat, x.floor))
      c.lineWidth = phone ? 1.6 : 2.2
      c.strokeStyle = rgbCss(MIX)
      c.shadowColor = rgbCss(MIX, 0.7 * x.heat)
      c.shadowBlur = x.heat > 0.05 ? 4 + x.heat * 16 : 0
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke()
      c.shadowBlur = 0
      // Light running through the wire the way the traffic went.
      if (x.heat > 0.1) {
        c.globalCompositeOperation = 'lighter'
        c.setLineDash([9, 11]); c.lineDashOffset = -x.dir * time * 0.09
        c.strokeStyle = rgbCss(x.c, x.heat)
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke()
        c.setLineDash([]); c.globalCompositeOperation = 'source-over'
      }
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (l.via && len > 150) {
        c.font = fonts.sub; c.textAlign = 'center'; c.fillStyle = SUB; c.globalAlpha = 0.75
        c.fillText(l.via, (a.x + b.x) / 2, (a.y + b.y) / 2 + (phone ? 14 : 18))
        c.globalAlpha = 1
      }
    }
  }
  // Comets: a head plus a tail stretched to how fast the hop moves. Additive,
  // and drawn before the glyphs, so a packet slides in under a station.
  function drawPackets(c: CanvasRenderingContext2D) {
    if (!sprites) return
    c.globalCompositeOperation = 'lighter'
    for (const p of pool) {
      if (!p.active) continue
      packetPoint(p)
      const t = clamp(p.t, 0, 1)
      const fade = t < 0.08 ? t / 0.08 : t > 0.85 ? (1 - t) / 0.15 : 1
      const tail = clamp((PT.len / p.dur) * 150, p.size * 2.4, 130)
      c.globalAlpha = fade
      c.save(); c.translate(PT.x, PT.y); c.rotate(PT.ang + Math.PI)
      c.drawImage(sprites.tail[p.pal], 0, -p.size * 2, tail, p.size * 4)
      c.restore()
      const hs = p.size * 5.6
      c.drawImage(sprites.head[p.pal], PT.x - hs / 2, PT.y - hs / 2, hs, hs)
    }
    c.globalAlpha = 1
    c.globalCompositeOperation = 'source-over'
  }
  // `focus` (0 to 1) lights a stop amber, eased with the veil.
  function drawStation(c: CanvasRenderingContext2D, i: number, focus: number) {
    const st = story.stations[i], p = pos[i], x = nodeHeat[i]
    const base = Math.max(x.heat, x.floor), lvl = Math.max(base, 0.9 * focus)
    mixInto(MIX, REST_GLYPH, x.c, base)
    if (focus > 0) mixInto(MIX, MIX, AMBER, 0.85 * focus)
    G.stroke = rgbCss(MIX)
    G.body = rgbCss(mixInto(TINT, BODY, MIX, 0.07 + 0.12 * lvl))
    G.ink = rgbCss(mixInto(TINT, MIX, WHITE, 0.45))
    G.lw = clamp(p.s * 0.035, 1.4, 2.6)
    G.fill = st.id === 'you' ? fill : 0
    G.code = st.code ?? ''
    GLYPH[st.kind](c, p.x, p.y, p.s, G)
    const lab = labels[i]
    if (!lab || lab.hidden) return
    c.textAlign = 'center'
    c.font = fonts.label; c.fillStyle = LABEL
    c.fillText(lab.lines[0], lab.x, lab.y)
    c.font = fonts.sub; c.fillStyle = SUB
    for (let k = 1; k < lab.lines.length; k++) c.fillText(lab.lines[k], lab.x, lab.y + lab.lead * k)
    if (!chips[i]) return
    c.font = fonts.chip; c.fillStyle = CHIP
    const half = c.measureText(chips[i]).width / 2 + 4
    c.fillText(chips[i], clamp(lab.x, half, Math.max(half, w - half)), lab.y + lab.lead * lab.lines.length)
  }
  function drawStations(c: CanvasRenderingContext2D) {
    G.codeFont = fonts.code
    for (let i = 0; i < story.stations.length; i++) drawStation(c, i, 0)
  }
  // While a card is open the drawing steps back behind a veil, and its stop
  // is drawn again on top, lit, over a steady glow, with the packets it sent.
  // Nothing here pulses: a glow that breathes reads as the page flickering.
  function drawSpotlight(c: CanvasRenderingContext2D, i: number, a: number) {
    c.globalAlpha = a
    c.fillStyle = VEIL; c.fillRect(0, 0, w, h)
    const p = pos[i]
    if (sprites) {
      const r = p.s * 3.4
      c.globalCompositeOperation = 'lighter'
      c.globalAlpha = 0.26 * a
      c.drawImage(sprites.head[OUT], p.x - r, p.y - r, 2 * r, 2 * r)
      c.globalCompositeOperation = 'source-over'
    }
    c.globalAlpha = 1
    drawPackets(c)
    drawStation(c, i, a)
  }
  function drawPulses(c: CanvasRenderingContext2D) {
    c.globalCompositeOperation = 'lighter'
    c.lineWidth = 2.2
    for (const p of pulses) {
      if (!p.active || !pos[p.i]) continue
      const q = pos[p.i], t = clamp(p.t, 0, 1)
      c.strokeStyle = rgbCss(PALETTE[p.pal], (1 - t) * 0.85)
      c.beginPath(); c.arc(q.x, q.y, lerp(q.s * 0.9, p.maxR, t), 0, 6.3); c.stroke()
    }
    c.globalCompositeOperation = 'source-over'
  }
  function draw() {
    if (!ctx || !pos.length) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (stars) drawStars(ctx, stars, time, phone ? 80 : 120, w, h, SKY)
    drawLinks(ctx)
    drawPackets(ctx)
    drawStations(ctx)
    if (veil > 0.01 && lit >= 0) drawSpotlight(ctx, lit, veil)
    drawPulses(ctx)
  }
  // Draws at once: a resize has just cleared the canvas, and the loop's next
  // idle frame may be two frames away. Without the loop (reduced motion, or a
  // hidden tab) the veil has no frames to ease over, so it is on or off.
  function renderNow() {
    if (!running) veil = cardIndex >= 0 ? 1 : 0
    draw()
  }

  function loop(now: number) {
    if (!running) return
    raf = requestAnimationFrame(loop)
    // ponytail: between replays only the stars move (14 px/s at most), so idle
    // frames are drawn at ~30 fps instead of the display's 60–120.
    const want = cardIndex >= 0 ? 1 : 0
    const busy = playing || pinging || veil !== want || pool.some(p => p.active)
    if (!busy && last && now - last < 30) return
    const dt = last ? Math.min((now - last) / 1000, 0.25) : 1 / 60
    last = now
    time += dt * 1000
    if (stars) driftStars(stars, w, h, dt)
    updateTraffic(dt)
    advance(dt)
    veil = Math.abs(want - veil) < 0.01 ? want : veil + (want - veil) * Math.min(1, dt * 9)
    draw()
  }
  function start() {
    if (destroyed) return
    if (reduced || !ctx) { renderNow(); return }
    if (!running) { running = true; last = 0; raf = requestAnimationFrame(loop) }
  }
  function stop() {
    running = false
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
  }
  function destroy() {
    destroyed = true
    stop()
    clearTimeout(hoverTimer)
    section.removeAttribute('data-nw-phone')
    section.style.minHeight = ''
    env.text.name.style.fontSize = ''
    env.text.tagline.style.maxWidth = ''
    log.remove()
    host.removeAttribute('data-nw-fallback')
    host.replaceChildren()
  }

  refreshText()
  // ---- Facts: fetched once, then the story is told again with them and the
  // replay starts. Every fetch carries env.signal, so destroy() cancels it.
  void (async () => {
    const device = visitorDevice()
    let loaded: Facts
    if (import.meta.env.DEV) {
      loaded = { ...(await loadProbe(env.signal)), device, dev: true }
    } else {
      const timing = readTiming(returned)
      const own = timing && !timing.otherPage && !timing.fromCache
      const [edge, cache] = await Promise.all([loadEdge(env.signal), own ? loadCache(env.signal) : Promise.resolve(NO_CACHE)])
      loaded = { timing, edge, ...cache, device, dev: false }
    }
    if (destroyed) return
    facts = loaded
    story = networkStory(facts, isTouch)
    links = linksOf(story.stations)
    hops = hopsOf(story.stations, links)
    refreshText()
    if (import.meta.env.DEV && facts.timing) {
      frame.append(part(doc, 'p', 'note', 'Dev server: these timings were measured from this computer.'))
    }
    if (w) layout()
    play()
    renderNow()
  })()

  const instance: HeroInstance = { start, stop, resize, destroy }
  return instance
}
