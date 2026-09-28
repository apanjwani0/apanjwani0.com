/**
 * The network heroes: how a web page reaches you, drawn as one metro line
 * over an endless drift of stars. One engine and two stories, picked by the
 * section's data-hero (the dev-only switch in src/pages/index.astro):
 *
 *  - `network` replays THIS page load, slowed down, from the browser's own
 *    Navigation Timing, Cloudflare's /cdn-cgi/trace and one HEAD of '/'.
 *    Real data only (owner, 2026-09-28): a fact the page cannot measure is
 *    left out, never filled in with a sample. On the dev server the page
 *    comes from localhost, so the same facts come from one real request to
 *    the live site that the dev server makes (/__hero-probe, in
 *    astro.config.mjs).
 *  - `internet` explains how any page reaches anyone, in plain words, on the
 *    same stage. Its only number is this page's own total.
 *
 * Neither ever names the host provider, the runtime or anything else about
 * the origin (owner, 2026-09-27): that is what helps someone reach it around
 * Cloudflare. AGENTS.md's Home hero candidates section has the contract.
 */
import type { HeroCreate, HeroInstance } from './types'

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
const LED_OFF = 'rgba(80,110,95,0.35)'
const STAR = 'rgb(200,210,230)'
const CONSTELLATION = 'rgb(150,160,182)'
const LABEL = 'rgba(221,230,242,0.92)'
const SUB = 'rgba(132,144,160,0.92)'
const CHIP = rgbCss(AMBER, 0.95)
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
  /** Hover and screen-reader text. */
  info: string
  /** Off the line, above it: a question asked on the way (DNS). */
  branch?: boolean
  /** Written inside the edge's hexagon: the data centre's code. */
  code?: string
  /** Names the stretch of line arriving at this station. */
  via?: string
  /** Draws that stretch as network hops handing the packets along. */
  hops?: boolean
}
// A branch hangs off the main station before it; every other station joins
// the main station before it.
interface Link { a: number; b: number; via: string; hops: boolean }
function linksOf(stations: Station[]): Link[] {
  const links: Link[] = []
  let prev = -1
  stations.forEach((s, i) => {
    if (prev >= 0) links.push({ a: prev, b: i, via: s.via ?? '', hops: Boolean(s.hops) })
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
interface GlyphScratch { stroke: string; body: string; ink: string; lw: number; heat: number; fill: number; time: number; code: string; codeFont: string }
const G: GlyphScratch = { stroke: '', body: '', ink: '', lw: 2, heat: 0, fill: 0, time: 0, code: '', codeFont: '' }

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
// Status LEDs stay lit at rest and flicker only while traffic crosses: blinking
// with nothing happening read as the page flickering (owner, 2026-09-28).
function ledOn(g: GlyphScratch, i: number): boolean {
  return g.heat <= 0.3 || Math.sin(g.time * 0.038 + i * 1.7) > -0.2
}
function led(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, on: boolean) {
  ctx.fillStyle = on ? LED_ON : LED_OFF
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
  for (let i = 0; i < 4; i++) led(ctx, x - 0.72 * s + i * 0.16 * s, y, lr, ledOn(g, i))
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
  for (let u = 0; u < 4; u++) led(ctx, x - 0.36 * s, y - s + (u + 0.5) * 0.5 * s, lr, ledOn(g, u))
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

// ---- Space: an endless, slow drift of stars in depth, the nearer ones
// joined into constellations that form and dissolve as they pass each other.
// Sorted nearest first, so the constellation pass walks only a prefix.
interface Star { x: number; y: number; z: number; ph: number }
const DRIFT = 7
const NEAR = 0.62
function makeStars(n: number, w: number, h: number): Star[] {
  return Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, z: 0.2 + 0.8 * Math.random() ** 1.6, ph: Math.random() * 6.28 }))
    .sort((a, b) => b.z - a.z)
}
function driftStars(stars: Star[], w: number, h: number, dt: number) {
  for (const st of stars) {
    st.x -= DRIFT * st.z * dt
    st.y -= DRIFT * 0.2 * st.z * dt
    if (st.x < -8) { st.x += w + 16; st.y = Math.random() * h } else if (st.y < -8) st.y += h + 16
  }
}
function drawStars(ctx: CanvasRenderingContext2D, stars: Star[], time: number, reach: number) {
  ctx.strokeStyle = CONSTELLATION; ctx.lineWidth = 1
  const r2 = reach * reach
  for (let i = 0; i < stars.length && stars[i].z >= NEAR; i++) {
    const a = stars[i]
    for (let j = i + 1; j < stars.length && stars[j].z >= NEAR; j++) {
      const b = stars[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy
      if (d2 > r2) continue
      const f = 1 - Math.sqrt(d2) / reach
      ctx.globalAlpha = 0.2 * f * f
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    }
  }
  ctx.fillStyle = STAR
  for (const st of stars) {
    ctx.globalAlpha = (0.15 + 0.65 * st.z) * (0.8 + 0.2 * Math.sin(time * 0.0011 * (0.6 + st.z) + st.ph))
    ctx.beginPath(); ctx.arc(st.x, st.y, 0.45 + 1.35 * st.z * st.z, 0, 6.2832); ctx.fill()
  }
  ctx.globalAlpha = 1
}

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
function readTiming(): Timing | null {
  let nav: PerformanceNavigationTiming | undefined
  try { nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined } catch { /* exotic embeds */ }
  if (!nav || nav.responseEnd <= 0) return null
  const connect = Math.max(0, nav.connectEnd - nav.connectStart)
  const tls = nav.secureConnectionStart > 0 ? Math.max(0, nav.connectEnd - nav.secureConnectionStart) : 0
  let otherPage = false
  // After an in-site swap back to '/', the entry still describes the
  // session's first hard load, which can be another page.
  try { otherPage = new URL(nav.name).pathname !== location.pathname } catch { /* a malformed name: assume this page */ }
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
  const t0 = performance.now()
  await fetchWithTimeout('/', signal, 5000, 'HEAD')
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
  at: number | null
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
function capital(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1) }
// Screen time for a measured phase: tiny phases stay watchable, long ones
// don't drag, and order and relative size stay true.
function watch(ms: number): number { return clamp(1000 + 120 * Math.sqrt(Math.max(0, ms)), 1000, 3200) }
function totalOf(t: Timing): number { return t.paint > t.lastByte ? t.paint : t.lastByte }
const PQ = ' Its key exchange is built to resist future quantum computers.'

function networkStory(f: Facts | null, touch: boolean): Story {
  const t = f?.timing ?? null, e = f?.edge ?? null
  const place = e?.city || e?.colo || ''
  const edgeName = place ? `Cloudflare’s data centre in ${place}` : 'Cloudflare’s network'
  const tlsBits = [e?.tls, e?.kex].filter(Boolean).join(' · ')
  const who = [e?.country ? `in ${e.country}` : '', f?.device ? `on ${f.device}` : '', e?.ip ? `address starting ${e.ip}` : ''].filter(Boolean).join(' · ')
  const stations: Station[] = [
    { id: 'you', kind: touch ? 'phone' : 'laptop', label: 'you', sub: f?.device ?? '', info: who ? `You · ${who}` : 'You' },
    { id: 'net', kind: 'router', label: 'your network', sub: '', info: 'Your network: the Wi-Fi or mobile data every request leaves through.' },
    {
      id: 'dns', kind: 'dns', label: 'DNS', sub: 'address book', branch: true,
      info: t && t.dns >= 1 ? `DNS, the internet’s address book. It found ${HOST} in ${fmtMs(t.dns)}.` : 'DNS, the internet’s address book.',
    },
    {
      id: 'edge', kind: 'edge', label: 'Cloudflare', sub: place, code: e?.colo ?? '', via: 'the internet',
      info: ['Cloudflare', place && e?.colo !== place ? `${place} (${e?.colo})` : place, tlsBits, f?.cacheStatus ? `cache ${f.cacheStatus}` : ''].filter(Boolean).join(' · '),
    },
    { id: 'origin', kind: 'origin', label: 'the server', sub: 'builds this page', info: 'The server that builds this page.' },
  ]
  const story: Story = {
    kicker: 'How this page reached you', headline: '', stations, steps: [], total: null,
    ping: ['you', 'net', 'edge', 'net', 'you'], pingText: `A fresh round trip to ${place || 'Cloudflare'} and back, just now.`,
  }
  if (!f) return story
  if (!t) {
    story.headline = f.dev
      ? `The dev server couldn’t reach ${HOST} just now, so there is nothing real to replay.`
      : 'This browser keeps its timing to itself, so there is nothing real to replay.'
    return story
  }
  const total = totalOf(t)
  story.total = total
  story.headline = t.fromCache
    ? 'This page was already saved in your browser. Here’s how little it had to travel.'
    : `${t.otherPage ? 'Your first page here' : 'This page'} reached you in ${seconds(total)}. Here’s that trip, slowed down.`
  const steps = story.steps
  const there: Flight = { route: ['you', 'net', 'edge'], pal: OUT, count: 1 }
  const back: Flight = { route: ['edge', 'net', 'you'], pal: BACK, count: 1 }
  const shake: Flight[] = [{ route: ['you', 'net', 'edge'], pal: SHAKE, count: 3 }, { route: ['edge', 'net', 'you'], pal: SHAKE, count: 3 }]

  const said = [f.device, e?.ip ? `from an internet address starting ${e.ip}` : ''].filter(Boolean).join(', ')
  steps.push({
    title: e?.country ? `You, in ${e.country}` : 'You', ms: '', detail: '', pal: OUT, flights: [], screen: 900, at: 0, pulse: 'you',
    text: said ? `${capital(said)}. Any website you open can see this much.` : `You asked for ${HOST}.`,
  })
  if (t.fromCache) {
    steps.push({
      title: 'Saved on your device', ms: fmtMs(total), detail: 'browser cache', pal: SHAKE, flights: [], screen: 1100, at: total, pulse: 'you',
      text: 'Your browser had kept a copy of this page, so nothing had to cross the internet this time.', chip: ['you', 'saved copy'],
    })
    return story
  }
  // Under a millisecond is the browser's own cache answering, not a lookup.
  if (t.dns >= 1) {
    steps.push({
      title: 'Finding the address', ms: fmtMs(t.dns), detail: 'DNS lookup', pal: OUT, screen: watch(t.dns), at: t.dnsEnd,
      text: `Your browser asked DNS, the internet’s address book, where ${HOST} lives.`,
      flights: [{ route: ['you', 'net', 'dns'], pal: OUT, count: 1 }, { route: ['dns', 'net', 'you'], pal: BACK, count: 1 }], chip: ['dns', fmtMs(t.dns)],
    })
  } else {
    steps.push({
      title: 'Address already known', ms: '0 ms', detail: 'DNS cache', pal: SHAKE, flights: [], screen: 900, at: t.dnsEnd, pulse: 'you',
      text: `Your browser remembered where ${HOST} lives, so it skipped the lookup.`, chip: ['dns', 'remembered'],
    })
  }
  const reach = place ? `Reaching ${place}` : 'Reaching Cloudflare'
  const pq = /MLKEM|kyber/i.test(e?.kex ?? '') ? PQ : ''
  if (t.reused) {
    steps.push({
      title: 'Line already open', ms: '0 ms', detail: 'connection reuse', pal: SHAKE, flights: [], screen: 1000, at: t.connectEnd,
      text: `Your browser reused a connection it already had open to ${edgeName}.`, glow: ['you', 'net', 'edge'], chip: ['edge', 'reused'],
    })
  } else if (t.quic) {
    steps.push({
      title: reach, ms: fmtMs(t.connect), detail: ['QUIC', tlsBits].filter(Boolean).join(' · '), pal: SHAKE, flights: shake,
      screen: watch(t.connect), at: t.connectEnd, chip: ['edge', fmtMs(t.connect)],
      text: `Your request crossed the internet to ${edgeName}, and they agreed on encryption in the same exchange.${pq}`,
    })
  } else {
    steps.push({
      title: reach, ms: fmtMs(t.tcp), detail: 'TCP handshake', pal: OUT, flights: [there, back], screen: watch(t.tcp),
      at: t.connectEnd - t.tls, chip: ['edge', fmtMs(t.tcp)], text: `Your request crossed the internet to ${edgeName}.`,
    })
    if (t.tls > 0) {
      steps.push({
        title: 'Locking the line', ms: fmtMs(t.tls), detail: tlsBits || 'TLS handshake', pal: SHAKE, flights: shake,
        screen: watch(t.tls), at: t.connectEnd, chip: ['edge', fmtMs(t.connect)],
        text: `Your browser and Cloudflare agreed on encryption, so nobody in between can read this page.${pq}`,
      })
    }
  }
  const status = f.cacheStatus
  const first = ['first byte', status ? `cache ${status}` : ''].filter(Boolean).join(' · ')
  if (f.cache === 'hit') {
    steps.push({
      title: place ? `${place} had it ready` : 'Cloudflare had it ready', ms: fmtMs(t.ttfb), detail: first, pal: OUT, flights: [there],
      screen: watch(t.ttfb), at: t.firstByte, hit: true, chip: ['origin', 'not needed'],
      text: `Cloudflare already had a copy of this page, saved ${ago(f.cacheAge)} ago, so the server that builds it wasn’t needed.`,
    })
  } else if (f.cache === 'origin') {
    const why = status === 'EXPIRED' ? 'Cloudflare’s copy of this page had expired, so it asked the server that builds it for a fresh one.'
      : status === 'REVALIDATED' ? 'Cloudflare checked its copy with the server that builds this page, and it was still fresh.'
      : 'Cloudflare passed your request on to the server that builds this page.'
    steps.push({
      title: 'Building the page', ms: fmtMs(t.ttfb), detail: first, pal: OUT, screen: watch(t.ttfb), at: t.firstByte, text: why,
      flights: [{ route: ['you', 'net', 'edge', 'origin'], pal: OUT, count: 1 }, { route: ['origin', 'edge'], pal: BACK, count: 1 }],
      chip: ['origin', fmtMs(t.ttfb)],
    })
  } else {
    steps.push({
      title: 'Asking for the page', ms: fmtMs(t.ttfb), detail: first, pal: OUT, flights: [there], screen: watch(t.ttfb), at: t.firstByte,
      text: 'Your browser asked for the page, and the first of it came back.',
    })
  }
  const kb = t.size > 0 ? `${Math.max(1, Math.round(t.size / 1024))} KB` : ''
  steps.push({
    title: 'Delivered', ms: fmtMs(t.download), detail: httpName(t.protocol) || e?.http || '', pal: BACK, screen: watch(t.download) + 400,
    at: t.lastByte, fill: true, flights: [{ route: ['edge', 'net', 'you'], pal: BACK, count: clamp(Math.round(4 + t.size / 3072), 4, 16) }],
    text: `The page came back in small packets${kb ? `, ${kb} in all,` : ''} and your browser put it together.`,
  })
  const painted = t.paint > t.lastByte
  steps.push({
    title: painted ? 'On your screen' : 'All here', ms: `at ${fmtMs(total)}`, detail: painted ? 'first paint' : 'last byte', pal: SHAKE,
    flights: [], screen: 900, at: total, pulse: 'you', chip: ['you', fmtClock(total)],
    text: `From asking for ${HOST} to ${painted ? 'seeing it' : 'its last byte'}: ${seconds(total)}.`,
  })
  return story
}

function internetStory(f: Facts | null, touch: boolean): Story {
  const t = f?.timing ?? null
  // This page's own total, when it describes this page crossing the internet.
  const total = t && !t.otherPage && !t.fromCache ? totalOf(t) : null
  const there = ['you', 'wifi', 'isp', 'server'], back = ['server', 'isp', 'wifi', 'you']
  return {
    kicker: 'How the internet works',
    headline: f ? 'What happens after you press Enter? Here’s how a page like this one finds its way to you.' : '',
    stations: [
      { id: 'you', kind: touch ? 'phone' : 'laptop', label: 'you', sub: '', info: 'You, and the browser you are reading this in.' },
      { id: 'wifi', kind: 'router', label: 'your Wi-Fi', sub: 'router', info: 'Your Wi-Fi router: the door every request leaves through.' },
      { id: 'dns', kind: 'dns', label: 'DNS', sub: 'phone book', branch: true, info: `DNS, the internet’s phone book: it turns names like ${HOST} into numbers.` },
      { id: 'isp', kind: 'isp', label: 'internet provider', sub: '', info: 'Your internet provider connects your home or phone to the rest of the internet.' },
      { id: 'server', kind: 'origin', label: 'a server', sub: 'in a data centre', via: 'the internet', hops: true, info: 'A server: a computer in a data centre whose job is to answer requests.' },
    ],
    steps: f ? [
      { title: 'You press Enter', ms: '', detail: '', pal: OUT, flights: [], screen: 1000, at: null, pulse: 'you', text: `Your browser wants ${HOST}. But computers find each other by number, not by name.` },
      {
        title: 'Looking up the number', ms: '', detail: 'DNS', pal: OUT, screen: 2200, at: null,
        text: 'So it asks DNS, the internet’s phone book, which answers with the site’s number: its IP address.',
        flights: [{ route: ['you', 'wifi', 'dns'], pal: OUT, count: 1 }, { route: ['dns', 'wifi', 'you'], pal: BACK, count: 1 }], chip: ['dns', 'found it'],
      },
      {
        title: 'Knocking on the door', ms: '', detail: 'TCP', pal: OUT, screen: 3200, at: null,
        text: 'The request leaves through your Wi-Fi, reaches your internet provider, and hops from network to network until it finds the server.',
        flights: [{ route: there, pal: OUT, count: 1 }, { route: back, pal: BACK, count: 1 }],
      },
      {
        title: 'A secret handshake', ms: '', detail: 'TLS', pal: SHAKE, screen: 3000, at: null,
        text: 'Your browser and the server agree on a code only they know, so anyone in between sees only gibberish.',
        flights: [{ route: there, pal: SHAKE, count: 3 }, { route: back, pal: SHAKE, count: 3 }],
      },
      { title: 'Asking for the page', ms: '', detail: 'HTTP request', pal: OUT, screen: 1800, at: null, text: 'Now your browser asks for the page itself, sent as small numbered packets.', flights: [{ route: there, pal: OUT, count: 1 }] },
      {
        title: 'The server answers', ms: '', detail: 'HTTP response', pal: BACK, screen: 2600, at: null, fill: true,
        text: 'The server builds the page and sends it back the same way, packet by packet.', flights: [{ route: back, pal: BACK, count: 10 }],
      },
      {
        title: 'Put back together', ms: total ? seconds(total) : '', detail: '', pal: SHAKE, flights: [], screen: 1000, at: null, pulse: 'you',
        text: `Your browser puts the packets back in order and draws the page you’re reading.${total ? ` This one took ${seconds(total)}.` : ''}`,
      },
    ] : [],
    total,
    ping: [...there, ...back.slice(1)],
    pingText: `A real round trip to ${HOST}, just now.`,
  }
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
const POOL = 80, PULSES = 20

export const create: HeroCreate = (host, env) => {
  const doc = host.ownerDocument
  const section = env.text.section
  const generic = section.dataset.hero === 'internet'
  const { reduced, isTouch } = env
  const dpr = clamp(env.dpr || 1, 1, 2)
  const mono = getComputedStyle(section).getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace'
  const tell = (f: Facts | null) => (generic ? internetStory(f, isTouch) : networkStory(f, isTouch))

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
  const card = doc.createElement('div')
  card.dataset.type = 'hero-card'
  card.setAttribute('aria-hidden', 'true')
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
  // Both describe whoever is looking, a crawler included, so neither may
  // become the page's search snippet.
  frame.setAttribute('data-nosnippet', '')
  log.setAttribute('data-nosnippet', '')
  host.append(canvas, poster, pingTarget, nodesLayer, card, frame, log)

  // The log sits at the stage's bottom right on desktop and moves into the
  // text block, under the links, on a phone or when the name needs the width.
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

  let story = tell(null)
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
  let fill = 0, playing = false, pinging = false, clockText = ''
  let typing: HTMLElement | null = null

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
    p.maxR = pos[i].s * (big ? 2.6 : 1.7) + (big ? 30 : 16)
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
    log.append(part(doc, 'p', 'hint', `${isTouch ? 'Tap' : 'Click'} anywhere to send a ping.`))
  }
  function setClock(text: string) {
    if (text === clockText) return
    clockText = text
    clockEl.textContent = text
  }

  // ---- The replay: a flat schedule built from the story, walked by one
  // cursor per frame. No per-step timers.
  function flights(ev: Sched[], list: Flight[], start: number, screen: number): number {
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
          ev.push({ at, run: () => spawn(a, b, f.pal, leg, size, true) })
          at += leg
        }
        end = at
      }
      cur = end
    }
    return cur
  }
  function glow(route: string[]) {
    for (let i = 0; i + 1 < route.length; i++) {
      const hop = hops.get(`${route[i]}>${route[i + 1]}`)
      if (!hop) continue
      const l = links[hop.li]
      for (const x of [linkHeat[hop.li], nodeHeat[l.a], nodeHeat[l.b]]) { bump(x, SHAKE); x.floor = TRAIL }
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
          if (step.glow) glow(step.glow)
          if (generic) setClock(`step ${n + 1} of ${story.steps.length}`)
        },
      })
      const start = cur
      const end = Math.max(flights(ev, step.flights, start, step.screen), step.flights.length ? start : start + step.screen)
      if (step.at !== null) { keys.push([start, real], [end, step.at]); real = step.at }
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
    setClock(story.total !== null && !generic ? fmtClock(story.total) : '')
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
      for (const f of step.flights) glowRoute(f.route, f.pal)
      if (step.glow) glowRoute(step.glow, SHAKE)
      if (step.chip) setChip(step.chip[0], step.chip[1])
      logAdd(step, true)
    }
    fill = 1
    finish()
    draw()
  }
  function glowRoute(route: string[], pal: number) {
    for (let i = 0; i + 1 < route.length; i++) {
      const hop = hops.get(`${route[i]}>${route[i + 1]}`)
      if (!hop) continue
      const l = links[hop.li]
      for (const x of [linkHeat[hop.li], nodeHeat[l.a], nodeHeat[l.b]]) { x.c = PALETTE[pal]; x.floor = 0.5 }
    }
  }
  function advance(dt: number) {
    cursor += dt * 1000
    while (si < sched.length && cursor >= sched[si].at) sched[si++].run()
    if (!playing) return
    if (!generic && story.total !== null && clockKeys.length) setClock(`${fmtClock(clockAt(cursor))} of ${fmtClock(story.total)}`)
    if (fillWin) fill = clamp((cursor - fillWin[0]) / Math.max(1, fillWin[1] - fillWin[0]), 0, 1)
  }

  // ---- Ping: a real request, timed, once the replay is over. The packet
  // travels the measured round trip slowed to watchable, and the log answers
  // when it lands, not when the request resolved.
  function ping() {
    if (!facts || playing || pinging) return
    pinging = true
    pingOnce(env.signal).then(landPing, () => landPing(-1))
  }
  function landPing(ms: number) {
    // A replay started while the request was out: it has cleared the log.
    if (destroyed || playing) return
    const line: Line = ms < 0
      ? { title: 'Ping', ms: '', text: 'No answer this time.', detail: '', pal: OUT }
      : { title: 'Ping', ms: fmtMs(ms), text: story.pingText, detail: 'HEAD /', pal: OUT }
    if (reduced || !ctx || !running || ms < 0) {
      pinging = false
      logAdd(line, true)
      logHint()
      return
    }
    const route = story.ping, half = (route.length - 1) / 2
    const leg = clamp((ms * 6) / (route.length - 1), LEG_MIN, 520)
    let at = cursor + 30
    sched.push({ at, run: () => logTyping(OUT) })
    for (let i = 0; i + 1 < route.length; i++) {
      const a = route[i], b = route[i + 1], pal = i < half ? OUT : BACK
      sched.push({ at, run: () => spawn(a, b, pal, leg, 3, false) })
      at += leg
    }
    sched.push({ at, run: () => { pinging = false; logAdd(line, true); logHint() } })
  }
  pingTarget.addEventListener('click', ping, { signal: env.signal })
  replay.addEventListener('click', () => { play(); if (!running) start() }, { signal: env.signal })

  // ---- Node buttons: invisible, focusable overlays, so a keyboard reaches
  // what a hover shows. The glyphs themselves are drawn on the canvas.
  const buttons = story.stations.map((st, i) => {
    const b = doc.createElement('button')
    b.type = 'button'
    b.dataset.type = 'hero-node-btn'
    b.dataset.node = st.id
    b.addEventListener('mouseenter', () => showCard(i), { signal: env.signal })
    b.addEventListener('mouseleave', () => hideCard(i), { signal: env.signal })
    b.addEventListener('focus', () => showCard(i), { signal: env.signal })
    b.addEventListener('blur', () => hideCard(i), { signal: env.signal })
    nodesLayer.appendChild(b)
    return b
  })
  let cardIndex = -1
  function showCard(i: number) {
    const p = pos[i]
    if (!p) return
    cardIndex = i
    card.textContent = story.stations[i].info
    let left = p.x + p.s * 1.3 + 12
    if (left + 240 > w) left = p.x - p.s * 1.3 - 12 - 240
    card.style.left = `${clamp(left, 8, Math.max(8, w - 248))}px`
    card.style.top = `${clamp(p.y - 12, 8, Math.max(8, h - 70))}px`
    card.dataset.shown = ''
  }
  function hideCard(i: number) { if (cardIndex === i) { cardIndex = -1; delete card.dataset.shown } }
  function refreshText() {
    kicker.textContent = story.kicker
    headline.textContent = story.headline
    headline.toggleAttribute('data-ready', Boolean(story.headline))
    story.stations.forEach((st, i) => buttons[i].setAttribute('aria-label', st.info))
    canvas.setAttribute('aria-label', `A diagram of ${generic ? 'how a web page reaches you' : 'how this page reached you'}: ${story.stations.map(s => (s.sub ? `${s.label} (${s.sub})` : s.label)).join(', ')}, joined by moving packets.`)
    if (cardIndex >= 0) showCard(cardIndex)
  }

  // ---- Layout: the name makes room for the log, then the line fills the band
  // between the frame and whichever text block reaches highest.
  function layout() {
    env.text.name.style.fontSize = ''
    env.text.tagline.style.maxWidth = ''
    let stacked = false
    const hostRect = host.getBoundingClientRect()
    if (!phone) {
      placeLog(false)
      const nameRect = env.text.name.getBoundingClientRect(), logRect = log.getBoundingClientRect()
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
      placeLog(stacked)
    } else {
      placeLog(true)
    }
    textTop = env.text.content.getBoundingClientRect().top - hostRect.top
    if (!phone && !stacked) textTop = Math.min(textTop, log.getBoundingClientRect().top - hostRect.top)
    const top = frame.getBoundingClientRect().bottom - hostRect.top + (phone ? 10 : 20)
    fonts.label = `${phone ? 11 : 13}px ${mono}`
    fonts.sub = `${phone ? 10 : 12}px ${mono}`
    fonts.chip = `600 ${phone ? 10 : 12}px ${mono}`
    const { step } = lineX(w, phone, story.stations.filter(s => !s.branch).length)
    const lead = phone ? 13 : 15
    const lines = ctx ? labelLines(ctx, story.stations, fonts, phone ? step * 0.96 : Math.min(step * 0.9, 230)) : story.stations.map(s => [s.label])
    // Each block also reserves its chip's line.
    const block = (branch: boolean) => Math.max(0, ...lines.map((l, i) => (Boolean(story.stations[i].branch) === branch ? lead * (l.length + 1) : 0)))
    pos = layoutLine(story.stations, w, top, textTop - (phone ? 6 : 12), phone, block(true) + 10, block(false) + (phone ? 14 : 17))
    fonts.code = `600 ${Math.round(0.34 * (pos[indexOf('edge')]?.s ?? 30))}px ${mono}`
    if (ctx) labels = layoutLabels(ctx, story.stations, pos, lines, fonts, lead, w, textTop, phone)
    buttons.forEach((b, i) => {
      const p = pos[i], hit = p.s * 2.2
      b.style.left = `${p.x}px`; b.style.top = `${p.y}px`
      b.style.width = `${hit}px`; b.style.height = `${hit}px`
      b.style.margin = `${-hit / 2}px 0 0 ${-hit / 2}px`
    })
    if (cardIndex >= 0) showCard(cardIndex)
  }
  function resize(width: number, height: number) {
    const ow = w, oh = h
    w = width; h = height; phone = w <= 520
    section.toggleAttribute('data-nw-phone', phone)
    if (ctx) {
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
    }
    if (!stars) stars = makeStars(Math.round(clamp((w * h) / 9000, 50, 170) * (env.lowPower ? 0.6 : 1)), w, h)
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
      if (l.hops) drawHops(c, li, a, b)
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (l.via && len > 150) {
        c.font = fonts.sub; c.textAlign = 'center'; c.fillStyle = SUB; c.globalAlpha = 0.75
        c.fillText(l.via, (a.x + b.x) / 2, (a.y + b.y) / 2 + (phone ? 14 : 18))
        c.globalAlpha = 1
      }
    }
  }
  // Three relays along the internet's stretch, each flashing as a packet
  // passes it: the network-to-network handing-along the step describes.
  function drawHops(c: CanvasRenderingContext2D, li: number, a: Pos, b: Pos) {
    for (const u of [0.25, 0.5, 0.75]) {
      let lit = 0, pal = 0
      for (const p of pool) {
        if (!p.active || p.li !== li) continue
        const at = p.rev ? 1 - p.t : p.t, d = 1 - Math.abs(at - u) / 0.08
        if (d > lit) { lit = d; pal = p.pal }
      }
      mixInto(MIX, REST_GLYPH, PALETTE[pal], clamp(lit, 0, 1))
      c.fillStyle = rgbCss(MIX)
      c.beginPath(); c.arc(lerp(a.x, b.x, u), lerp(a.y, b.y, u), (phone ? 2.4 : 3.2) + lit * 1.6, 0, 6.3); c.fill()
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
  function drawStations(c: CanvasRenderingContext2D) {
    G.time = time; G.codeFont = fonts.code
    story.stations.forEach((st, i) => {
      const p = pos[i], x = nodeHeat[i], lvl = Math.max(x.heat, x.floor)
      mixInto(MIX, REST_GLYPH, x.c, lvl)
      G.heat = x.heat
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
    })
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
    if (stars) drawStars(ctx, stars, time, phone ? 80 : 120)
    drawLinks(ctx)
    drawPackets(ctx)
    drawStations(ctx)
    drawPulses(ctx)
  }
  function renderNow() { if (!running) draw() }

  function loop(now: number) {
    if (!running) return
    raf = requestAnimationFrame(loop)
    // ponytail: between replays only the stars move (7 px/s at most), so idle
    // frames are drawn at ~30 fps instead of the display's 60–120.
    if (!playing && !pinging && last && now - last < 30) return
    const dt = last ? Math.min((now - last) / 1000, 0.25) : 1 / 60
    last = now
    time += dt * 1000
    if (stars) driftStars(stars, w, h, dt)
    updateTraffic(dt)
    advance(dt)
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
    section.removeAttribute('data-nw-phone')
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
      const timing = readTiming()
      const own = timing && !timing.otherPage && !timing.fromCache
      const [edge, cache] = await Promise.all([loadEdge(env.signal), own ? loadCache(env.signal) : Promise.resolve(NO_CACHE)])
      loaded = { timing, edge, ...cache, device, dev: false }
    }
    if (destroyed) return
    facts = loaded
    story = tell(facts)
    links = linksOf(story.stations)
    hops = hopsOf(story.stations, links)
    refreshText()
    if (import.meta.env.DEV && !generic && facts.timing) {
      frame.append(part(doc, 'p', 'note', 'Dev server: measured from this machine.'))
    }
    if (w) layout()
    play()
    renderNow()
  })()

  const instance: HeroInstance = { start, stop, resize, destroy }
  return instance
}
