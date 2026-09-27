/**
 * "How you landed here" — a live network diagram replaying how this page
 * load reached the visitor: their device, their router, a DNS resolver, the
 * Cloudflare edge and the origin, timed
 * from this browser's own Navigation Timing. The device's own on-canvas
 * screen fills in as the page's bytes arrive. Ported from the Hero Lab's
 * network.js (round 4, "bold pass"); see AGENTS.md's Home hero candidates
 * section for the contract every hero here follows.
 *
 * Differences from the lab module:
 *  - The name and tagline are gone: they are server-rendered into
 *    env.text.content, and this module only measures around them.
 *  - Edge facts (colo/http/tls/kex) come from a same-origin fetch of
 *    Cloudflare's /cdn-cgi/trace in production, parsed below; a labelled
 *    sample is the fallback (and the whole story on the dev server, which
 *    has no /cdn-cgi/trace). Cache status is a THIRD, independent source
 *    (Server-Timing, then a ping's response header, then nothing) — the
 *    trace endpoint never reports it, sample or real.
 *  - The "ping" fetches this page ('/', HEAD) instead of the lab's own file.
 *  - HeroLab.register/env.data/lab-only hooks are gone; this exports
 *    `create` directly per ./types.
 */
import type { HeroCreate, HeroInstance } from './types'
import { dayness, hexRgb, hourColor, localMinutes, type Rgb } from './day'

function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }

// Critically damped spring ("SmoothDamp", a standard closed-form approach to
// camera easing): reaches target with no overshoot and no oscillation,
// framerate-independent. vObj holds velocity under vKey so the camera needs
// no per-frame allocation.
function smoothDamp(current: number, target: number, smoothTime: number, dt: number, vObj: Camera, vKey: 'vx' | 'vy' | 'vz'): number {
  const omega = 2 / Math.max(0.0001, smoothTime)
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = current - target
  const v = vObj[vKey]
  const temp = (v + omega * change) * dt
  vObj[vKey] = (v - omega * temp) * exp
  return target + (change + temp) * exp
}
function mix3(c0: Rgb, c1: Rgb, t: number): Rgb { return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)] }
function rgbCss(c: Rgb, a?: number): string { return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a ?? 1})` }
function mixInto(out: Rgb, c0: Rgb, c1: Rgb, t: number): Rgb {
  out[0] = lerp(c0[0], c1[0], t); out[1] = lerp(c0[1], c1[1], t); out[2] = lerp(c0[2], c1[2], t)
  return out
}

const AMBER = hexRgb('#ffb35c')
const VIOLET = hexRgb('#9b8cff')
const WHITE: Rgb = [0.96, 0.97, 1.0]
const REST = hexRgb('#394255')
// The machines rest a step brighter than the wires between them, so the five
// nodes read as objects and the links as the paths joining them.
const REST_GLYPH = hexRgb('#58647f')
// Every glyph is a solid panel: a wire ends at its outline instead of running
// through it, and an arriving packet slides in underneath.
const BODY = hexRgb('#0b0f19')
const SCREEN_BG = '#070a12'
const LED_ON = 'rgba(130,255,170,0.95)'
const LED_OFF = 'rgba(80,110,95,0.35)'
const PALETTE: Rgb[] = [AMBER, VIOLET, WHITE]
// Scratch colour for mixInto(): glyph colours are mixed into this every
// frame instead of into a fresh array.
const MIX: Rgb = [0, 0, 0]

// A packet's actual colour can be any hourColor() sample (dawn coral, dusk
// rose, ...), but there are only ever 3 pre-rendered comet sprites, so it is
// drawn with whichever is closest. Cheap (3 comparisons, no allocation).
function nearestPaletteIndex(c: Rgb): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < PALETTE.length; i++) {
    const p = PALETTE[i]
    const dr = c[0] - p[0], dg = c[1] - p[1], db = c[2] - p[2]
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

interface Sprites { head: HTMLCanvasElement[]; tail: HTMLCanvasElement[] }

// ---- Comet sprites: pre-rendered ONCE per instance (create()), never per
// frame. A head (radial glow) and a tail (linear-fading strip) per palette
// colour; drawImage can stretch either to any size, so 6 small offscreen
// canvases cover every packet for the whole session.
function makeHeadSprite(color: Rgb): HTMLCanvasElement {
  const s = 48
  const c = document.createElement('canvas')
  c.width = s; c.height = s
  const g = c.getContext('2d')
  if (!g) return c
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  grad.addColorStop(0, rgbCss(color, 1)); grad.addColorStop(0.4, rgbCss(color, 0.55)); grad.addColorStop(1, rgbCss(color, 0))
  g.fillStyle = grad; g.fillRect(0, 0, s, s)
  return c
}
function makeTailSprite(color: Rgb): HTMLCanvasElement {
  const w = 64, h = 16
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')
  if (!g) return c
  const grad = g.createLinearGradient(0, 0, w, 0)
  grad.addColorStop(0, rgbCss(color, 0.65)); grad.addColorStop(1, rgbCss(color, 0))
  g.fillStyle = grad; g.fillRect(0, 0, w, h)
  return c
}
function makeSprites(): Sprites { return { head: PALETTE.map(makeHeadSprite), tail: PALETTE.map(makeTailSprite) } }

// ---- Topology: five nodes, four links between them.
type NodeId = 'you' | 'network' | 'dns' | 'edge' | 'origin'
type NodeKind = 'laptop' | 'phone' | 'router' | 'dns' | 'edge' | 'origin'
const NODE_IDS: NodeId[] = ['you', 'network', 'dns', 'edge', 'origin']
const LINKS: Array<[NodeId, NodeId]> = [['you', 'network'], ['network', 'dns'], ['network', 'edge'], ['edge', 'origin']]
function linkKey(a: NodeId, b: NodeId): string { return a < b ? `${a}|${b}` : `${b}|${a}` }
const LINK_KEYS = LINKS.map(l => linkKey(l[0], l[1]))
// 'a>b' → which link a hop rides and whether it runs against the link's own
// direction. Built once, so a packet resolves its wire at spawn time and
// never builds a lookup string per frame.
const LINK_OF: Record<string, { i: number; rev: boolean; key: string }> = {}
LINKS.forEach((l, i) => {
  LINK_OF[`${l[0]}>${l[1]}`] = { i, rev: false, key: linkKey(l[0], l[1]) }
  LINK_OF[`${l[1]}>${l[0]}`] = { i, rev: true, key: linkKey(l[0], l[1]) }
})

const HOST = 'apanjwani0.com'
// Generic on purpose: the owner asked that the hero leak nothing about the host
// (2026-09-27), and the host provider is exactly what helps someone reach the
// origin around Cloudflare.
const ORIGIN = 'the server that renders this page'

function referrerSub(): string {
  try {
    if (document.referrer) return `from ${new URL(document.referrer).host}`
  } catch { /* an unparsable referrer is not worth surfacing */ }
  return 'typed or bookmarked'
}

// ---- Edge facts: real in production (same-origin Cloudflare trace), a
// clearly labelled sample everywhere else (the dev server has no
// /cdn-cgi/trace, so this is the whole story there). Cache status is NOT
// part of the trace body — Cloudflare never puts it there — so it is
// resolved independently below and never falls back to the sample's guess.
interface EdgeFacts { colo: string; city: string; http: string; tls: string; kex: string; sample: boolean }
const SAMPLE_EDGE: EdgeFacts = { colo: 'BOM', city: 'Mumbai', http: 'h3', tls: 'TLSv1.3', kex: 'X25519MLKEM768', sample: true }
const COLO_CITY: Record<string, string> = {
  BOM: 'Mumbai', DEL: 'New Delhi', MAA: 'Chennai', BLR: 'Bangalore', HYD: 'Hyderabad', CCU: 'Kolkata',
  SIN: 'Singapore', FRA: 'Frankfurt', LHR: 'London', AMS: 'Amsterdam', CDG: 'Paris', IAD: 'Ashburn',
  ORD: 'Chicago', DFW: 'Dallas', LAX: 'Los Angeles', SJC: 'San Jose', SEA: 'Seattle', NRT: 'Tokyo',
  HKG: 'Hong Kong', SYD: 'Sydney', DXB: 'Dubai', GRU: 'São Paulo',
}
function edgePlace(edge: EdgeFacts): string { return edge.city || edge.colo }
function edgeSub(edge: EdgeFacts, cache: string): string {
  const place = edgePlace(edge)
  return cache ? `${place} · cache ${cache}` : place
}
function translateHttpProtocol(v: string): string {
  if (v === 'http/3') return 'h3'
  if (v === 'http/2') return 'h2'
  return v
}
// key=value lines, one per line; 'ip' is skipped before it is ever stored,
// not merely left unread — this hero must never show or keep the visitor's
// address.
function parseTraceBody(body: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of body.split('\n')) {
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    if (!key || key === 'ip') continue
    out.set(key, line.slice(eq + 1).trim())
  }
  return out
}
async function fetchWithTimeout(url: string, outerSignal: AbortSignal, ms: number): Promise<Response> {
  const ac = new AbortController()
  const onAbort = () => ac.abort()
  outerSignal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    return await fetch(url, { cache: 'no-store', signal: ac.signal })
  } finally {
    clearTimeout(timer)
    outerSignal.removeEventListener('abort', onAbort)
  }
}
async function loadEdgeFacts(signal: AbortSignal): Promise<EdgeFacts> {
  try {
    const res = await fetchWithTimeout('/cdn-cgi/trace', signal, 2500)
    if (!res.ok) throw new Error('trace not ok')
    const kv = parseTraceBody(await res.text())
    const colo = kv.get('colo')
    if (!colo) throw new Error('no colo in trace')
    return {
      colo,
      city: COLO_CITY[colo] ?? '',
      http: translateHttpProtocol(kv.get('http') ?? ''),
      tls: kv.get('tls') ?? '',
      kex: kv.get('kex') ?? '',
      sample: false,
    }
  } catch {
    return SAMPLE_EDGE
  }
}
function readCfCacheStatusFromServerTiming(nav: PerformanceNavigationTiming | undefined): string {
  try {
    for (const entry of nav?.serverTiming ?? []) if (entry.name === 'cfCacheStatus') return entry.description
  } catch { /* serverTiming can be absent on older browsers */ }
  return ''
}
async function probeCacheStatus(signal: AbortSignal): Promise<string> {
  try {
    const res = await fetch('/', { method: 'HEAD', cache: 'no-store', signal })
    return res.headers.get('cf-cache-status') ?? ''
  } catch {
    return ''
  }
}

interface NodeMetaEntry { id: NodeId; kind: NodeKind; label: string; sub: string }
function nodeMeta(isTouch: boolean, edge: EdgeFacts, cache: string): NodeMetaEntry[] {
  return [
    { id: 'you', kind: isTouch ? 'phone' : 'laptop', label: 'you', sub: referrerSub() },
    { id: 'network', kind: 'router', label: 'your network', sub: '' },
    { id: 'dns', kind: 'dns', label: 'DNS', sub: '' },
    // The colo code is drawn inside the hexagon itself, so the label below
    // it does not repeat it.
    { id: 'edge', kind: 'edge', label: 'edge', sub: edgeSub(edge, cache) },
    { id: 'origin', kind: 'origin', label: 'origin', sub: ORIGIN },
  ]
}

// ---- Layout: node positions, from the stage size and, on a phone, the
// measured top of the text block.
interface LabelInfo { lines: string[]; x: number; y: number; lead: number; hidden: boolean; font: string; subFont: string }
interface NodePos { x: number; y: number; size: number; labAbove?: boolean; lab?: LabelInfo }

// Desktop: a sweep that rises from 'you' to DNS and falls back to the
// origin. The whole route stays above the name (bottom-left) and the trace
// log (bottom-right), so the story's first node is never under the text.
const DESKTOP_XY: Record<NodeId, [number, number]> = { you: [0.11, 0.43], network: [0.29, 0.29], dns: [0.44, 0.155], edge: [0.64, 0.30], origin: [0.86, 0.43] }
// Phone: two rows zig-zagging left to right. You, DNS and the origin sit on
// top, the router and the edge below, all in the band between the page's
// nav and the top of the text block.
const PHONE_X: Record<NodeId, number> = { you: 0.15, dns: 0.5, origin: 0.85, network: 0.33, edge: 0.67 }
const PHONE_TOP_ROW: Record<NodeId, boolean> = { you: true, dns: true, origin: true, network: false, edge: false }
const NAV_CLEAR = 60
// How far below its centre each glyph ends, in units of its half-extent, so
// a label sits under the drawing it names rather than under a fixed box.
const GLYPH_BOTTOM: Record<NodeKind, number> = { laptop: 0.4, phone: 1, router: 0.3, dns: 0.85, edge: 1, origin: 1 }
const GLYPH_TOP: Record<NodeKind, number> = { laptop: 0.92, phone: 1, router: 0.95, dns: 0.85, edge: 1, origin: 1 }
// Room above the phone's top row for a label and two lines of sub-label.
const PHONE_LABEL_ROOM = 43

function layoutPositions(w: number, h: number, phone: boolean, textTop: number): Record<NodeId, NodePos> {
  const out = {} as Record<NodeId, NodePos>
  if (!phone) {
    // Big enough to be the scene, capped so it stays a background and never
    // outweighs the name, and smaller when the text leaves less room.
    const size = clamp(Math.min(w * 0.05, h * 0.085, (textTop - NAV_CLEAR - 60) / 4.2), 34, 76)
    // The sweep's bottom row (you, the origin) keeps its labels clear of the
    // text block. When the text is tall (stacked), the sweep flattens into
    // the room above it rather than running under the name.
    const yTop = Math.max(0.155 * h, NAV_CLEAR + 0.85 * size + 4)
    const yBot = Math.max(yTop + 40, Math.min(0.43 * h, textTop - 12 - size - 44))
    for (const id of NODE_IDS) {
      const xy = DESKTOP_XY[id]
      const k = (xy[1] - 0.155) / (0.43 - 0.155)
      out[id] = { x: xy[0] * w, y: yTop + k * (yBot - yTop), size }
    }
    return out
  }
  // textTop is measured, not assumed: the text block's height depends on the
  // name's font and on how the trace lines wrap on this width.
  const bottom = Math.max(NAV_CLEAR + 180, textTop - 10)
  const s = clamp((bottom - NAV_CLEAR) * 0.13, 22, 32)
  // The top row's labels sit ABOVE its glyphs. The wires from the lower row
  // arrive from below, so labels under the top row would sit right in their
  // path.
  const topY = NAV_CLEAR + PHONE_LABEL_ROOM + s
  // The lower row's labels end at the band's foot, with room for the wires
  // between the two rows.
  const lowY = Math.max(bottom - s - 30, topY + 2 * s + 34)
  for (const id of NODE_IDS) out[id] = { x: PHONE_X[id] * w, y: PHONE_TOP_ROW[id] ? topY : lowY, size: s, labAbove: PHONE_TOP_ROW[id] }
  return out
}

// Word-wraps text to maxW at the context's current font. Called on resize
// only; the frame loop draws the cached lines.
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = word } else line = next
  }
  if (line) lines.push(line)
  return lines
}

// ---- Glyphs: solid panels with a crisp outline, centred at (x,y) with
// half-extent s. g is ONE scratch object that drawGlyphs() refills for each
// node each frame: stroke, body and ink are CSS colours, lw is the outline
// width, heat is 0..1, fill is the response's download progress (the
// device's screen), simTime is in ms (LEDs) and colo is the edge's code.
interface GlyphScratch { stroke: string; body: string; ink: string; lw: number; heat: number; fill: number; simTime: number; colo: string; coloFont: string }

function roundRectPath(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x0 + r, y0); ctx.lineTo(x1 - r, y0); ctx.quadraticCurveTo(x1, y0, x1, y0 + r)
  ctx.lineTo(x1, y1 - r); ctx.quadraticCurveTo(x1, y1, x1 - r, y1)
  ctx.lineTo(x0 + r, y1); ctx.quadraticCurveTo(x0, y1, x0, y1 - r)
  ctx.lineTo(x0, y0 + r); ctx.quadraticCurveTo(x0, y0, x0 + r, y0)
  ctx.closePath()
}
// Fills the current path as a solid panel, then outlines it.
function panel(ctx: CanvasRenderingContext2D, g: GlyphScratch) {
  ctx.fillStyle = g.body; ctx.fill()
  ctx.lineWidth = g.lw; ctx.strokeStyle = g.stroke; ctx.stroke()
}
// Interior markings (meridians, rack units, ports) are thinner and dimmer
// than the outline, so each glyph reads as one object with markings on it
// rather than a tangle of equal lines.
function detailStroke(ctx: CanvasRenderingContext2D, g: GlyphScratch) {
  ctx.lineWidth = g.lw * 0.6; ctx.globalAlpha = 0.7; ctx.strokeStyle = g.stroke; ctx.stroke(); ctx.globalAlpha = 1
}
// Status LEDs, each on its own slow phase so they never blink in lockstep.
// While traffic crosses the node they flicker fast.
function ledOn(g: GlyphScratch, i: number): boolean {
  const t = g.simTime * 0.001
  return g.heat > 0.3 ? Math.sin(t * 38 + i * 1.7) > -0.2 : Math.sin(t * (1.6 + i * 0.7) + i * 2.1) > 0.2
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
// The device's screen draws a miniature of this very page as the response's
// bytes arrive: first the diagram, then the name, then the tagline, top to
// bottom in the order they were delivered. Fades use globalAlpha over
// constant fill strings, so no colour is built per frame.
function drawScreen(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, g: GlyphScratch) {
  ctx.fillStyle = SCREEN_BG; ctx.fillRect(x0, y0, w, h)
  const f = g.fill
  if (f <= 0.01) return
  ctx.globalAlpha = 0.14 * f; ctx.fillStyle = '#9b8cff'; ctx.fillRect(x0, y0, w, h)
  const a = clamp((f - 0.05) / 0.15, 0, 1)
  if (a > 0) {
    ctx.globalAlpha = a * 0.8; ctx.strokeStyle = '#9b8cff'; ctx.lineWidth = Math.max(0.6, w * 0.012)
    ctx.beginPath()
    for (const l of LINKS) {
      const p = DESKTOP_XY[l[0]], q = DESKTOP_XY[l[1]]
      ctx.moveTo(x0 + w * (0.1 + 0.8 * p[0]), y0 + h * (0.04 + p[1]))
      ctx.lineTo(x0 + w * (0.1 + 0.8 * q[0]), y0 + h * (0.04 + q[1]))
    }
    ctx.stroke()
    ctx.fillStyle = '#dde6f2'
    const r = Math.max(0.9, w * 0.02)
    for (const id of NODE_IDS) {
      const d = DESKTOP_XY[id]
      ctx.beginPath(); ctx.arc(x0 + w * (0.1 + 0.8 * d[0]), y0 + h * (0.04 + d[1]), r, 0, 6.3); ctx.fill()
    }
  }
  ctx.fillStyle = '#dde6f2'
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
  // The code of the edge that served this page, written in the edge itself.
  ctx.fillStyle = g.ink; ctx.font = g.coloFont; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(g.colo, x, y + 0.02 * s)
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
const GLYPH: Record<NodeKind, (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, g: GlyphScratch) => void> = {
  laptop: drawLaptop, phone: drawPhone, router: drawRouter, dns: drawDns, edge: drawHex, origin: drawRack,
}

// ---- Packet pool. Fixed-size, reused every frame: no per-frame allocation.
// A packet's endpoints are looked up live by id/index each draw, so an
// in-flight packet survives a resize instead of flying to a stale pixel.
interface Packet {
  active: boolean
  kind: 'main' | 'ambient'
  a: NodeId | number
  b: NodeId | number
  li: number
  rev: boolean
  key: string
  t: number
  dur: number
  color: Rgb
  size: number
  delay: number
}
const POOL_SIZE = 96
function makePool(): Packet[] {
  return Array.from({ length: POOL_SIZE }, () => ({
    active: false, kind: 'main', a: 'you', b: 'you', li: -1, rev: false, key: '', t: 0, dur: 300, color: WHITE, size: 3, delay: 0,
  }))
}
// delay (ms) holds a packet inactive-looking but reserved, so a burst can
// schedule several packets at once with staggered starts using only the
// existing pool — no separate timer/queue needed.
function spawnPacket(pool: Packet[], kind: 'main' | 'ambient', a: NodeId | number, b: NodeId | number, color: Rgb, dur: number, size?: number, delay?: number): Packet | null {
  for (const p of pool) {
    if (p.active) continue
    p.active = true; p.kind = kind; p.a = a; p.b = b; p.t = 0; p.dur = Math.max(1, dur); p.color = color; p.size = size || 3; p.delay = delay || 0
    // A main packet resolves its wire once, here: which link, which way
    // along it, and the heat key it lights.
    const l = kind === 'main' ? LINK_OF[`${a}>${b}`] : undefined
    p.li = l ? l.i : -1; p.rev = l ? l.rev : false; p.key = l ? l.key : ''
    return p
  }
  return null
}

// ---- Pulse pool: a small ring drawn once from a node when a hop touches
// it. Same fixed-pool shape as packets, on its own tiny array (different
// draw/lifecycle, so not worth sharing one pool with two meanings).
interface Pulse { active: boolean; id: NodeId | null; t: number; dur: number; color: Rgb; maxR: number }
const PULSE_SIZE = 24
function makePulsePool(): Pulse[] {
  return Array.from({ length: PULSE_SIZE }, () => ({ active: false, id: null, t: 0, dur: 500, color: WHITE, maxR: 30 }))
}
function spawnPulse(pool: Pulse[], id: NodeId, color: Rgb, dur: number, maxR: number) {
  for (const p of pool) {
    if (p.active) continue
    p.active = true; p.id = id; p.t = 0; p.dur = dur; p.color = color; p.maxR = maxR
    return
  }
}
function updatePulses(pool: Pulse[], dt: number) {
  for (const p of pool) {
    if (!p.active) continue
    p.t += (dt * 1000) / p.dur
    if (p.t >= 1) p.active = false
  }
}
function drawPulses(ctx: CanvasRenderingContext2D, pool: Pulse[], nodePos: Record<NodeId, NodePos>) {
  ctx.globalCompositeOperation = 'lighter'
  for (const p of pool) {
    if (!p.active || !p.id) continue
    const pos = nodePos[p.id]
    if (!pos) continue
    const t = clamp(p.t, 0, 1)
    const r = lerp(pos.size * 0.9, p.maxR, t)
    ctx.strokeStyle = rgbCss(p.color, (1 - t) * 0.85)
    ctx.lineWidth = 2.2
    ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, 6.3); ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
}

// Point lookup: 'main' packets reference node ids in nodePos; 'ambient'
// packets reference an index into ambient.pts (px cache, resize-safe).
function pointOf(state: HeroState, kind: 'main' | 'ambient', ref: NodeId | number): { x: number; y: number } {
  return kind === 'ambient' ? state.ambient.pts[ref as number] : state.nodePos[ref as NodeId]
}

// dir (links only) is which way the last packet crossed: +1 along the
// link's own direction, -1 against it, so the flowing dashes run the way
// the traffic actually went.
interface Heat { r: number; g: number; b: number; heat: number; dir: number }
function makeHeat(): Heat { return { r: REST[0], g: REST[1], b: REST[2], heat: 0, dir: 1 } }
function bumpHeat(h: Heat, color: Rgb, dir?: number) { h.heat = 1; h.r = color[0]; h.g = color[1]; h.b = color[2]; if (dir) h.dir = dir }
function decayHeat(h: Heat, dt: number) { h.heat *= Math.exp(-2.2 * dt) }
const HEAT_RGB: Rgb = [0, 0, 0]
// base → the heat's own colour, written into out; no array per call.
function heatInto(out: Rgb, base: Rgb, h: Heat): Rgb { HEAT_RGB[0] = h.r; HEAT_RGB[1] = h.g; HEAT_RGB[2] = h.b; return mixInto(out, base, HEAT_RGB, h.heat) }

function makeHeatMaps(): { node: Record<NodeId, Heat>; link: Record<string, Heat> } {
  const node = {} as Record<NodeId, Heat>
  const link: Record<string, Heat> = {}
  for (const id of NODE_IDS) node[id] = makeHeat()
  for (const l of LINKS) link[linkKey(l[0], l[1])] = makeHeat()
  return { node, link }
}
// Called once per frame before packets re-bump whatever they're still
// touching, so a link/node with nothing on it actually fades to REST
// instead of sitting at full heat forever.
function decayAllHeat(heat: { node: Record<NodeId, Heat>; link: Record<string, Heat> }, dt: number) {
  for (const id of NODE_IDS) decayHeat(heat.node[id], dt)
  for (const key of LINK_KEYS) decayHeat(heat.link[key], dt)
}

// Advance every active packet, light the link/nodes it touches, ring a
// pulse at each node it touches, deactivate on arrival. A delayed packet
// (see spawnPacket) counts down and does nothing else until it starts.
function updatePackets(state: HeroState, dt: number) {
  const { pool, heat, pulses, nodePos } = state
  for (const p of pool) {
    if (!p.active) continue
    if (p.delay > 0) { p.delay -= dt * 1000; continue }
    const prevT = p.t
    p.t += (dt * 1000) / p.dur
    if (p.kind === 'main') {
      if (p.key) bumpHeat(heat.link[p.key], p.color, p.rev ? -1 : 1)
      // Pulse radius follows the NODE's own size (a ring has to reach past
      // the glyph it rings), not the packet's — a fixed multiple of the
      // packet dot would sit hidden inside an 80px node. Only a lead packet
      // (a request, a reply, a ping) rings the nodes it touches. A burst or
      // a response stream is many small packets, and a ring for each would
      // bury the diagram in ripples; they warm the node.
      if (prevT < 0.12) {
        const a = p.a as NodeId
        bumpHeat(heat.node[a], p.color)
        if (p.size >= 3) spawnPulse(pulses, a, p.color, 520, nodePos[a].size * 1.7 + 16)
      }
    }
    if (p.t >= 1) {
      if (p.kind === 'main') {
        const b = p.b as NodeId
        bumpHeat(heat.node[b], p.color)
        if (p.size >= 3) spawnPulse(pulses, b, p.color, 520, nodePos[b].size * 1.7 + 16)
      }
      p.active = false
    }
  }
}

// ---- Ambient field: faint distant nodes + hairline links standing for the
// rest of the internet. Positions are seeded once (fractional) and rescaled
// on resize; the occasional tiny packet crossing one is tinted by the hour.
interface AmbientPoint { fx: number; fy: number; x: number; y: number; baseX: number; baseY: number; layer: number; driftPhase: number; driftR: number }
interface Ambient { pts: AmbientPoint[]; links: Array<[number, number]>; adj: number[][] }

function computeAmbientLinks(pts: AmbientPoint[]): Array<[number, number]> {
  const links: Array<[number, number]> = []
  const seen = new Set<string>()
  for (let i = 0; i < pts.length; i++) {
    const best: Array<[number, number]> = []
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue
      const dx = pts[i].fx - pts[j].fx, dy = pts[i].fy - pts[j].fy
      best.push([j, dx * dx + dy * dy])
    }
    best.sort((a, b) => a[1] - b[1])
    for (let k = 0; k < 2 && k < best.length; k++) {
      const j2 = best[k][0]
      const key = `${Math.min(i, j2)}|${Math.max(i, j2)}`
      if (!seen.has(key)) { seen.add(key); links.push([i, j2]) }
    }
  }
  return links
}
// 3 parallax layers in one 120-point mesh: far (tiny, dim, still), mid,
// near (bigger, brighter, a slow drift). One shared link mesh across all of
// them — "the whole field", not three separate unrelated ones.
const AMBIENT_LAYERS = [
  { n: 60, r: 0.85, fill: 'rgba(160,170,190,0.16)', drift: 0 },
  { n: 40, r: 1.5, fill: 'rgba(160,170,190,0.32)', drift: 0 },
  { n: 20, r: 2.6, fill: 'rgba(160,170,190,0.6)', drift: 1 },
] as const
function makeAmbient(): Ambient {
  const pts: AmbientPoint[] = []
  AMBIENT_LAYERS.forEach((layer, li) => {
    for (let i = 0; i < layer.n; i++) {
      pts.push({
        fx: Math.random(), fy: Math.random(), x: 0, y: 0, baseX: 0, baseY: 0, layer: li,
        driftPhase: Math.random() * 6.28, driftR: layer.drift ? 5 + Math.random() * 9 : 0,
      })
    }
  })
  const links = computeAmbientLinks(pts)
  // Adjacency for the burst walk below: which points a given point is
  // directly wired to, built once alongside the links themselves.
  const adj: number[][] = pts.map(() => [])
  links.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a) })
  return { pts, links, adj }
}
function resizeAmbient(ambient: Ambient, w: number, h: number) {
  for (const p of ambient.pts) { p.baseX = p.fx * w; p.baseY = p.fy * h; p.x = p.baseX; p.y = p.baseY }
}
// Near-layer points drift slowly on a fixed per-point orbit driven by
// simTime — arithmetic only, no stored velocity to integrate or allocate.
function driftAmbient(ambient: Ambient, simTime: number) {
  for (const p of ambient.pts) {
    if (!p.driftR) continue
    p.x = p.baseX + Math.cos(simTime * 0.00012 + p.driftPhase) * p.driftR
    p.y = p.baseY + Math.sin(simTime * 0.00009 + p.driftPhase) * p.driftR
  }
}
function drawAmbient(ctx: CanvasRenderingContext2D, ambient: Ambient) {
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(150,160,182,0.1)'
  ctx.beginPath()
  for (const [a, b] of ambient.links) {
    const pa = ambient.pts[a], pb = ambient.pts[b]
    ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y)
  }
  ctx.stroke()
  for (const p of ambient.pts) {
    const layer = AMBIENT_LAYERS[p.layer]
    ctx.fillStyle = layer.fill
    ctx.beginPath(); ctx.arc(p.x, p.y, layer.r, 0, 6.3); ctx.fill()
  }
}

// ---- Wires. Each main link is a gentle quadratic arc. Its control point is
// computed on resize (layoutLinks) and read by BOTH the wire and every
// packet on it, so a packet rides exactly the line drawn for it. Every arc
// bows upward (leftward, for a vertical link), so all the diagram's wires
// curve the same way.
interface LinkCtrl { x: number; y: number; len: number }
function makeLinkCtrl(): LinkCtrl[] { return LINKS.map(() => ({ x: 0, y: 0, len: 1 })) }
function layoutLinks(state: HeroState) {
  for (let i = 0; i < LINKS.length; i++) {
    const a = state.nodePos[LINKS[i][0]], b = state.nodePos[LINKS[i][1]], c = state.linkCtrl[i]
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    let nx = -dy / len, ny = dx / len
    if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny }
    const bulge = Math.min(30, len * 0.09)
    c.x = (a.x + b.x) / 2 + nx * bulge; c.y = (a.y + b.y) / 2 + ny * bulge; c.len = len
  }
}
// Where packet p is at progress t, written into out (no allocation): its
// position, its heading (for the comet's tail) and the length of its hop. A
// main packet rides its link's own arc, reversed for a reply; an ambient
// packet runs straight along its hairline.
interface PacketPoint { x: number; y: number; ang: number; len: number }
function packetPoint(state: HeroState, p: Packet, t: number, out: PacketPoint): PacketPoint {
  if (p.li >= 0) {
    const L = LINKS[p.li], a = state.nodePos[L[0]], b = state.nodePos[L[1]], c = state.linkCtrl[p.li]
    const u = p.rev ? 1 - t : t, v = 1 - u
    out.x = v * v * a.x + 2 * v * u * c.x + u * u * b.x
    out.y = v * v * a.y + 2 * v * u * c.y + u * u * b.y
    const tx = v * (c.x - a.x) + u * (b.x - c.x), ty = v * (c.y - a.y) + u * (b.y - c.y)
    out.ang = p.rev ? Math.atan2(-ty, -tx) : Math.atan2(ty, tx)
    out.len = c.len
    return out
  }
  const p0 = pointOf(state, p.kind, p.a), p1 = pointOf(state, p.kind, p.b)
  const dx = p1.x - p0.x, dy = p1.y - p0.y
  out.x = p0.x + dx * t; out.y = p0.y + dy * t
  out.ang = Math.atan2(dy, dx); out.len = Math.sqrt(dx * dx + dy * dy) || 1
  return out
}

// The cinematic follow: tight on whatever the lead packet is doing until
// the request lands at the edge (state.camWide), then a damped pull out to
// the wide shot. The followed point is held above the name block rather
// than at dead centre, where the name would cover it. Between two hops the
// target simply holds, so the camera never lurches back to 'you'.
interface Camera { x: number; y: number; zoom: number; vx: number; vy: number; vz: number; tx: number; ty: number }
const CAM_PT: PacketPoint = { x: 0, y: 0, ang: 0, len: 1 }
function camZoom(state: HeroState): number { return state.phone ? 1.6 : 1.8 }
// World y the camera must centre on for world point y to sit at the held
// fraction of the screen's height, at zoom z.
function camCentreY(state: HeroState, y: number, z: number): number { return y + (0.5 - (state.phone ? 0.22 : 0.34)) * state.h / z }
function updateCamera(state: HeroState, dt: number) {
  const cam = state.camera
  let tx: number, ty: number, tz: number
  if (state.camWide) {
    tx = state.w / 2; ty = state.h / 2; tz = 1
  } else {
    const lp = state.leadPacket
    if (lp && lp.active && lp.delay <= 0) { packetPoint(state, lp, clamp(lp.t, 0, 1), CAM_PT); cam.tx = CAM_PT.x; cam.ty = CAM_PT.y }
    tz = camZoom(state); tx = cam.tx; ty = camCentreY(state, cam.ty, tz)
  }
  cam.x = smoothDamp(cam.x, tx, 0.42, dt, cam, 'vx')
  cam.y = smoothDamp(cam.y, ty, 0.42, dt, cam, 'vy')
  cam.zoom = smoothDamp(cam.zoom, tz, 0.55, dt, cam, 'vz')
}

// Packets as comets: a bright pre-rendered head plus a tail sprite
// stretched (via drawImage's destination size, not re-rendered) to a length
// that follows how fast this hop is actually moving. Additive ('lighter')
// so overlapping light brightens instead of overpainting. Drawn BEFORE the
// glyphs, so a packet arriving at a node slides in under its panel instead
// of across it.
const PT: PacketPoint = { x: 0, y: 0, ang: 0, len: 1 }
function drawPackets(ctx: CanvasRenderingContext2D, state: HeroState) {
  const { pool, sprites } = state
  if (!sprites) return
  ctx.globalCompositeOperation = 'lighter'
  for (const p of pool) {
    if (!p.active || p.delay > 0) continue
    const t = clamp(p.t, 0, 1)
    packetPoint(state, p, t, PT)
    const pal = nearestPaletteIndex(p.color)
    const tailLen = clamp((PT.len / p.dur) * 150, p.size * 2.4, 130)
    const fade = t < 0.08 ? t / 0.08 : t > 0.85 ? (1 - t) / 0.15 : 1
    ctx.save()
    ctx.translate(PT.x, PT.y); ctx.rotate(PT.ang + Math.PI)
    ctx.globalAlpha = fade
    ctx.drawImage(sprites.tail[pal], 0, -p.size * 2, tailLen, p.size * 4)
    ctx.restore()
    const hs = p.size * 5.6
    ctx.globalAlpha = fade
    ctx.drawImage(sprites.head[pal], PT.x - hs / 2, PT.y - hs / 2, hs, hs)
    ctx.globalAlpha = 1
  }
  ctx.globalCompositeOperation = 'source-over'
}
// Main-path links: bold with a soft glow, plus an additive flowing-dash
// overlay while traffic is crossing, running the way that traffic went, so
// it reads as light moving through the wire, not just a colour change.
const DASH = [9, 11]
const NO_DASH: number[] = []
function drawLinks(ctx: CanvasRenderingContext2D, state: HeroState, simTime: number) {
  ctx.lineWidth = state.phone ? 2 : 3
  for (let i = 0; i < LINKS.length; i++) {
    const a = state.nodePos[LINKS[i][0]], b = state.nodePos[LINKS[i][1]], c = state.linkCtrl[i]
    const h = state.heat.link[LINK_KEYS[i]]
    heatInto(MIX, REST, h)
    ctx.shadowColor = rgbCss(MIX, 0.7 * h.heat)
    ctx.shadowBlur = 4 + h.heat * 18
    ctx.strokeStyle = rgbCss(MIX)
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); ctx.stroke()
    if (h.heat > 0.1) {
      ctx.shadowBlur = 0
      ctx.globalCompositeOperation = 'lighter'
      ctx.setLineDash(DASH)
      ctx.lineDashOffset = -h.dir * simTime * 0.09
      ctx.strokeStyle = rgbCss(HEAT_RGB, h.heat)
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); ctx.stroke()
      ctx.setLineDash(NO_DASH)
      ctx.globalCompositeOperation = 'source-over'
    }
  }
  ctx.shadowBlur = 0
}

// ---- Labels are laid out on resize (wrapped to the room a node has, and
// pulled in from the stage's edges as one block) and only drawn per frame.
const MONO = 'ui-monospace,Menlo,Consolas,monospace'
function layoutLabels(ctx: CanvasRenderingContext2D, state: HeroState, meta: NodeMetaEntry[]) {
  const phone = state.phone
  const font = `${phone ? 11 : 13}px ${MONO}`, subFont = `${phone ? 10 : 12}px ${MONO}`
  for (const m of meta) {
    const pos = state.nodePos[m.id]
    ctx.font = subFont
    const lines = [m.label, ...(m.sub ? wrapText(ctx, m.sub, phone ? state.w * 0.31 : 300) : [])]
    let half = 0
    for (let k = 0; k < lines.length; k++) {
      ctx.font = k === 0 ? font : subFont
      half = Math.max(half, ctx.measureText(lines[k]).width / 2 + 8)
    }
    const lead = phone ? 13 : 15, n = lines.length
    const y = pos.labAbove
      ? pos.y - GLYPH_TOP[m.kind] * pos.size - 8 - lead * (n - 1)
      : pos.y + GLYPH_BOTTOM[m.kind] * pos.size + (phone ? 13 : 16)
    pos.lab = {
      lines, x: clamp(pos.x, half, Math.max(half, state.w - half)), y, lead,
      // On a stage too short for the whole diagram above the text, a node
      // can end up behind the name. Its glyph stays, dimmed by the scrim,
      // but its label is not printed over the name.
      hidden: !pos.labAbove && y + lead * (n - 1) > state.textTop - 4,
      font, subFont,
    }
  }
  state.coloFont = `600 ${Math.round(0.34 * state.nodePos.edge.size)}px ${MONO}`
}
function drawLabel(ctx: CanvasRenderingContext2D, lab: LabelInfo | undefined) {
  if (!lab || lab.hidden) return
  ctx.textAlign = 'center'
  ctx.font = lab.font; ctx.fillStyle = 'rgba(221,230,242,0.92)'
  ctx.fillText(lab.lines[0], lab.x, lab.y)
  if (lab.lines.length < 2) return
  ctx.font = lab.subFont; ctx.fillStyle = 'rgba(132,144,160,0.92)'
  for (let k = 1; k < lab.lines.length; k++) ctx.fillText(lab.lines[k], lab.x, lab.y + lab.lead * k)
}
// One scratch object for every glyph call (see the Glyphs section).
const G: GlyphScratch = { stroke: '', body: '', ink: '', lw: 2, heat: 0, fill: 0, simTime: 0, colo: '', coloFont: '' }
const TINT: Rgb = [0, 0, 0]
function drawGlyphs(ctx: CanvasRenderingContext2D, state: HeroState, meta: NodeMetaEntry[]) {
  G.fill = state.downloadProgress; G.simTime = state.simTime; G.colo = state.colo; G.coloFont = state.coloFont
  for (const m of meta) {
    const pos = state.nodePos[m.id], h = state.heat.node[m.id]
    heatInto(MIX, REST_GLYPH, h)
    G.heat = h.heat
    G.stroke = rgbCss(MIX)
    G.body = rgbCss(mixInto(TINT, BODY, MIX, 0.07 + 0.12 * h.heat))
    G.ink = rgbCss(mixInto(TINT, MIX, WHITE, 0.45))
    G.lw = clamp(pos.size * 0.035, 1.4, 2.6)
    GLYPH[m.kind](ctx, pos.x, pos.y, pos.size, G)
    drawLabel(ctx, pos.lab)
  }
}

// ---- Real numbers: Navigation Timing, normalised so every value below is a
// plain millisecond duration whether the browser gives us the modern entry
// (already relative) or the legacy `performance.timing` (epoch ms). Both
// shapes are read through the same field names, so the delta maths below
// works identically on either — the subtraction cancels out whether the
// clock is relative-to-navigation-start or absolute epoch ms.
interface TimingFields {
  domainLookupStart: number; domainLookupEnd: number
  connectStart: number; connectEnd: number
  secureConnectionStart: number
  requestStart: number; responseStart: number; responseEnd: number
}
function timingDelta(src: TimingFields, a: keyof TimingFields, b: keyof TimingFields): number {
  return Math.max(0, (src[a] || 0) - (src[b] || 0))
}
// `performance.timing` (Navigation Timing Level 1) is deprecated in favour
// of the PerformanceNavigationTiming entry read above, but a handful of old
// or embedded browsers still expose only it. This is the one place that
// reads it, re-typed through a plain shape with no deprecated members, so
// the rest of the module — which shares TimingFields with the modern entry
// — never touches the deprecated API itself.
function legacyTiming(): TimingFields & { domContentLoadedEventEnd: number; navigationStart: number } {
  return performance.timing as unknown as TimingFields & { domContentLoadedEventEnd: number; navigationStart: number }
}
function readPaint(): number {
  try {
    const paints = performance.getEntriesByType('paint')
    const fcp = paints.find(p => p.name === 'first-contentful-paint')
    if (fcp) return fcp.startTime
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav && nav.domContentLoadedEventEnd > 0) return nav.domContentLoadedEventEnd
  } catch { /* Performance API can throw in exotic embeds; treat as unmeasured. */ }
  const t = legacyTiming()
  return t.domContentLoadedEventEnd > 0 ? t.domContentLoadedEventEnd - t.navigationStart : 0
}
interface Timing {
  dns: number; connect: number; tls: number; tcp: number
  reused: boolean; quic: boolean
  ttfb: number; download: number
  painted: number; protocol: string; size: number; decoded: number
  fromCache: boolean
  // True when Navigation Timing describes a DIFFERENT route than the one
  // showing: after an in-site ClientRouter swap to '/', the entry still
  // describes the session's first hard load, which can be another page.
  otherPage: boolean
}
function readTiming(): Timing {
  let nav: PerformanceNavigationTiming | undefined
  try { nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined } catch { /* see readPaint */ }
  const src: TimingFields = nav ?? legacyTiming()
  const connect = timingDelta(src, 'connectEnd', 'connectStart')
  const tls = src.secureConnectionStart > 0 ? Math.max(0, src.connectEnd - src.secureConnectionStart) : 0
  const size = nav?.transferSize ?? 0
  const decoded = nav?.decodedBodySize ?? 0
  const protocol = nav?.nextHopProtocol ?? ''
  let otherPage = false
  if (nav) {
    try { otherPage = new URL(nav.name).pathname !== location.pathname } catch { /* a malformed entry name: assume this page */ }
  }
  return {
    dns: timingDelta(src, 'domainLookupEnd', 'domainLookupStart'), connect, tls, tcp: Math.max(0, connect - tls),
    // A connect of zero is a connection the browser already had open. Over
    // HTTP/3 the transport and TLS handshakes are one QUIC exchange, so
    // neither half is reported as zero-because-reused.
    reused: connect <= 0, quic: protocol === 'h3',
    ttfb: timingDelta(src, 'responseStart', 'requestStart'), download: timingDelta(src, 'responseEnd', 'responseStart'),
    painted: readPaint(), protocol, size, decoded,
    fromCache: size === 0 && decoded > 0,
    otherPage,
  }
}

// A phase's animation length from its real duration: tiny phases stay
// visible, long ones don't drag, and order and relative size stay true.
function dur(ms: number): number { return clamp(300 + 60 * Math.sqrt(Math.max(0, ms)), 300, 1600) }
// No leg of a hop is faster than this, so a 2 ms phase split over four legs
// is still something you can watch.
const HOP_MIN = 210
function legMs(ms: number, legs: number): number { return Math.max(HOP_MIN, dur(ms) / legs) }

// A zero is a real answer, and each line says what it means.
function fmtDns(ms: number): string { return ms <= 0 ? `${HOST} · cached` : `${HOST} in ${Math.round(ms)} ms` }
function fmtConnect(t: Timing): string {
  if (t.reused) return 'reused connection to the edge'
  if (t.quic) return `QUIC to the edge in ${Math.round(t.connect)} ms`
  return `connected to the edge in ${Math.round(t.tcp)} ms`
}
// The measured part leads and the sampled part trails, so the dim "(sample)"
// after it covers only what came from the sample — and only when the edge
// facts really are the sample (loadEdgeFacts failed), not the lab's old
// always-on label.
function fmtTls(t: Timing, edge: EdgeFacts): { text: string; note: string } {
  const how = t.reused ? 'reused session' : t.quic ? 'inside the QUIC handshake' : t.tls > 0 ? `handshake in ${Math.round(t.tls)} ms` : ''
  if (!how) return { text: 'none, this hop is plain HTTP', note: '' }
  return { text: `${how} · ${edge.tls}, ${edge.kex}`, note: edge.sample ? 'sample' : '' }
}
function fmtHttp(t: Timing, edge: EdgeFacts, cache: string): string {
  if (t.fromCache) return 'served from your browser cache, nothing sent'
  const proto = t.protocol || edge.http
  const cachePart = cache ? ` · cache ${cache}` : ''
  return `${proto} · edge ${edge.colo}, ${edgePlace(edge)}${cachePart}`
}
function fmtBytes(t: Timing): string {
  const bytes = t.fromCache ? 'from the browser cache' : `${Math.max(1, Math.round(t.size / 1024))} KB in ${Math.round(t.download)} ms`
  return `first byte at ${Math.round(t.ttfb)} ms · ${bytes}`
}
function fmtPaint(ms: number): string { return `on screen at ${Math.round(ms)} ms` }
function combineNotes(...parts: Array<string | false | '' | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(', ')
}
const OTHER_PAGE_NOTE = 'first load this visit'

// Trace rows, in their fixed order. The log entries below name rows by
// index; the last row is the ping.
const ROW_LABELS = ['dns', 'tcp', 'tls', 'http', 'bytes', 'paint', 'ping']
const ROW_HTTP = 3, ROW_PAINT = 5, ROW_PING = 6

// A flat timeline built per replay from this page's own timing: hop entries
// (a packet leg to spawn) and fx entries (a pulse or a glow), sorted by
// start, plus log entries (a trace row to type). The frame loop walks both
// lists with one cursor each; there are no per-phase timers. Nothing
// crosses the network that did not: a cached lookup lights the device, a
// reused connection glows along the path it already holds.
interface HopEvent { kind: 'hop'; start: number; a: NodeId; b: NodeId; color: Rgb; dur: number; size: number }
interface FxEvent { kind: 'fx'; start: number; fx: 'local' | 'reuse' | 'hit' | 'pong'; text?: string }
type TimelineEvent = HopEvent | FxEvent
interface LogEntry { at: number; row: number }
interface TimelineBuild { timeline: TimelineEvent[]; logs: LogEntry[]; respStart: number; respEnd: number }

const GAP = 340, STAGGER = 70
function buildTimeline(t: Timing, cacheIsHit: boolean): TimelineBuild {
  let cursor = 600
  const timeline: TimelineEvent[] = []
  const logs: LogEntry[] = []
  function route(ids: NodeId[], color: Rgb, ms: number, size: number, at: number): number {
    let cur = at
    for (let i = 0; i + 1 < ids.length; i++) {
      timeline.push({ kind: 'hop', start: cur, a: ids[i], b: ids[i + 1], color, dur: ms, size: size || 3.4 })
      cur += ms
    }
    return cur
  }
  // A TLS or QUIC flight is several records at once: three packets a little
  // apart, each way.
  function burst(ids: NodeId[], ms: number, at: number): number {
    let last = at
    for (let j = 0; j < 3; j++) last = route(ids, WHITE, ms, 2.6, at + j * STAGGER)
    return last
  }
  function fx(at: number, name: FxEvent['fx']) { timeline.push({ kind: 'fx', start: at, fx: name }) }
  function log(row: number) { logs.push({ at: cursor, row }); cursor += GAP }

  if (t.dns > 0) {
    const ld = legMs(t.dns, 4)
    cursor = route(['you', 'network', 'dns'], AMBER, ld, 0, cursor)
    cursor = route(['dns', 'network', 'you'], VIOLET, ld, 0, cursor)
  } else { fx(cursor, 'local'); cursor += 380 }
  log(0)

  if (t.reused) {
    fx(cursor, 'reuse'); cursor += 420; log(1); log(2)
  } else if (t.quic) {
    const lq = legMs(t.connect, 4)
    cursor = burst(['you', 'network', 'edge'], lq, cursor)
    cursor = burst(['edge', 'network', 'you'], lq, cursor)
    log(1); log(2)
  } else {
    const lt = legMs(t.tcp, 4)
    cursor = route(['you', 'network', 'edge'], AMBER, lt, 0, cursor)
    cursor = route(['edge', 'network', 'you'], VIOLET, lt, 0, cursor)
    log(1)
    if (t.tls > 0) {
      const ls = legMs(t.tls, 4)
      cursor = burst(['you', 'network', 'edge'], ls, cursor)
      cursor = burst(['edge', 'network', 'you'], ls, cursor)
    }
    log(2)
  }

  const miss = !cacheIsHit
  if (t.fromCache) { fx(cursor, 'local'); cursor += 380 } else {
    const lr = legMs(t.ttfb, miss ? 4 : 2)
    cursor = route(['you', 'network', 'edge'], AMBER, lr, 0, cursor)
    if (miss) { cursor = route(['edge', 'origin'], AMBER, lr, 0, cursor); cursor = route(['origin', 'edge'], VIOLET, lr, 0, cursor) }
    else fx(cursor, 'hit')
  }
  log(ROW_HTTP)

  // The response as a stream of small violet packets, pipelined rather than
  // one after another; the count follows the real size, so a bigger page
  // visibly reads as more traffic.
  let respStart: number, respEnd: number
  if (t.fromCache) { respStart = cursor; respEnd = cursor + 500; cursor = respEnd } else {
    const n = clamp(Math.round(4 + Math.max(1, t.size / 1024) / 3), 4, 24)
    const lb = legMs(t.download, 2), gap = clamp(dur(t.download) / n, 45, 110)
    let end = cursor
    for (let k = 0; k < n; k++) end = route(['edge', 'network', 'you'], VIOLET, lb, 2.4, cursor + k * gap)
    respStart = cursor + 2 * lb; respEnd = end; cursor = end
  }
  log(4); log(ROW_PAINT); log(ROW_PING)
  timeline.sort((x, y) => x.start - y.start)
  return { timeline, logs, respStart, respEnd }
}

// ---- The instance's whole mutable state, one object so every helper above
// takes (state, ...) rather than closing over private variables scattered
// across create().
interface RowDom { row: HTMLDivElement; typed: HTMLSpanElement; rest: HTMLSpanElement; note: HTMLSpanElement; text: string }
interface HeroState {
  dpr: number; w: number; h: number; phone: boolean; textTop: number
  nodePos: Record<NodeId, NodePos>
  linkCtrl: LinkCtrl[]
  pool: Packet[]
  pulses: Pulse[]
  heat: { node: Record<NodeId, Heat>; link: Record<string, Heat> }
  ambient: Ambient
  sprites: Sprites | null
  simTime: number
  colo: string
  coloFont: string
  running: boolean
  raf: number
  lastT: number
  destroyed: boolean
  timing: Timing
  cursor: number
  timeline: TimelineEvent[] | null
  logs: LogEntry[] | null
  tIdx: number
  lIdx: number
  replaying: boolean
  ambientAccum: number
  ambientBurstAccum: number
  keepAccum: number
  pingBusy: boolean
  cardId: NodeId | null
  typing: { r: RowDom; shown: number; cps: number } | null
  camera: Camera
  camWide: boolean
  leadPacket: Packet | null
  downloadProgress: number
  respStart: number
  respEnd: number
  edge: EdgeFacts
  cache: string
}

function ambientTick(state: HeroState, dt: number) {
  state.ambientAccum -= dt
  if (state.ambientAccum > 0) return
  const day = dayness(localMinutes())
  state.ambientAccum = lerp(0.42, 0.18, day) + Math.random() * lerp(0.32, 0.14, day)
  const links = state.ambient.links
  const pick = links[(Math.random() * links.length) | 0]
  // hourColor() with no scratch: this fires a few times a second at most,
  // and the resulting colour is stored on the packet for its whole flight,
  // so it must be an independent value rather than a buffer the next tick
  // (or ambientBurstTick, below) overwrites out from under it.
  spawnPacket(state.pool, 'ambient', pick[0], pick[1], hourColor(localMinutes()), lerp(1100, 650, day), 1.5)
}
// Occasional bursts: a short chain of ambient links carries several small
// packets in quick succession, like a surge of traffic. Denser, faster and
// amber by day; sparser, slower and violet by night, tinted by the real
// hourColor.
function ambientBurstTick(state: HeroState, dt: number) {
  state.ambientBurstAccum -= dt
  if (state.ambientBurstAccum > 0) return
  const day = dayness(localMinutes())
  state.ambientBurstAccum = lerp(11, 5, day) + Math.random() * 3
  const adj = state.ambient.adj, n = state.ambient.pts.length
  const start = (Math.random() * n) | 0
  const chain = [start]
  let cur = start, prev = -1
  for (let step = 0; step < 3; step++) {
    const nbrs = adj[cur]
    if (!nbrs || !nbrs.length) break
    let next = nbrs[(Math.random() * nbrs.length) | 0]
    if (next === prev && nbrs.length > 1) next = nbrs[(nbrs.indexOf(next) + 1) % nbrs.length]
    chain.push(next); prev = cur; cur = next
  }
  if (chain.length < 2) return
  const hc = hourColor(localMinutes())
  const base = day >= 0.5 ? AMBER : VIOLET
  const color = mix3(base, hc, 0.4)
  const count = Math.round(lerp(4, 9, day)), leg = lerp(760, 420, day), stagger = leg / 2.6
  let t = 0
  for (let k = 0; k < count; k++) {
    const li = k % (chain.length - 1)
    spawnPacket(state.pool, 'ambient', chain[li], chain[li + 1], color, leg, day >= 0.5 ? 1.7 : 1.3, t)
    t += stagger
  }
}
function keepaliveTick(state: HeroState, dt: number) {
  if (state.replaying) return
  state.keepAccum -= dt
  if (state.keepAccum > 0) return
  state.keepAccum = 3 + Math.random() * 3.5
  const l = LINKS[(Math.random() * LINKS.length) | 0]
  const out = Math.random() < 0.5
  spawnPacket(state.pool, 'main', out ? l[0] : l[1], out ? l[1] : l[0], out ? AMBER : VIOLET, 550, 2)
}

// ---- DOM: everything below lives in `host` (the stage) except the readout,
// which network.ts moves into env.text.content on phone/stack layouts. No
// <style> element: all of this is styled from hero-network.css, scoped
// under section[data-hero="network"].
function buildStage(doc: Document, host: HTMLElement) {
  const canvas = doc.createElement('canvas')
  canvas.dataset.type = 'hero-canvas'
  canvas.setAttribute('role', 'img')
  canvas.setAttribute(
    'aria-label',
    'A live network diagram replaying this page load: your device, your router, a DNS resolver, the Cloudflare edge and the origin server, linked by animated request and response packets.',
  )
  host.appendChild(canvas)

  const poster = doc.createElement('div')
  poster.dataset.type = 'hero-poster'
  host.appendChild(poster)

  const ping = doc.createElement('button')
  ping.type = 'button'
  ping.dataset.type = 'hero-ping'
  ping.setAttribute('aria-hidden', 'true')
  ping.tabIndex = -1
  host.appendChild(ping)

  const nodesLayer = doc.createElement('div')
  nodesLayer.dataset.type = 'hero-nodes'
  host.appendChild(nodesLayer)

  const card = doc.createElement('div')
  card.dataset.type = 'hero-card'
  card.setAttribute('aria-hidden', 'true')
  host.appendChild(card)

  return { canvas, poster, ping, nodesLayer, card }
}
function buildRow(doc: Document, label: string): RowDom {
  const row = doc.createElement('div')
  row.dataset.part = 'row'
  const b = doc.createElement('b')
  b.dataset.part = 'row-label'
  b.textContent = label
  const text = doc.createElement('span')
  text.dataset.part = 'row-text'
  const typed = doc.createElement('span')
  typed.dataset.part = 'typed'
  const rest = doc.createElement('span')
  rest.dataset.part = 'rest'
  const note = doc.createElement('span')
  note.dataset.part = 'note'
  text.append(typed, rest, note)
  row.append(b, text)
  return { row, typed, rest, note, text: '' }
}
function buildReadout(doc: Document) {
  const readout = doc.createElement('div')
  readout.dataset.type = 'hero-readout'
  const trace = doc.createElement('div')
  trace.dataset.part = 'trace'
  const rows = ROW_LABELS.map(label => buildRow(doc, label))
  for (const r of rows) trace.appendChild(r.row)
  const replay = doc.createElement('button')
  replay.type = 'button'
  replay.dataset.part = 'replay'
  replay.textContent = 'replay landing'
  readout.append(trace, replay)
  return { readout, replay, rows }
}

export const create: HeroCreate = (host, env) => {
  const doc = host.ownerDocument
  const section = env.text.section
  const reduced = env.reduced
  const isTouch = env.isTouch
  const dpr = clamp(env.dpr || 1, 1, 2)

  const stage = buildStage(doc, host)
  const { readout, replay, rows } = buildReadout(doc)
  // Desktop's default: absolutely positioned at the stage's bottom right,
  // inside host. layout() below moves it into env.text.content — in flow,
  // under the links — for the phone and stack layouts, and back again when
  // the layout allows it.
  host.appendChild(readout)
  let readoutInContent = false
  function placeReadout(inContent: boolean) {
    if (inContent === readoutInContent) return
    readoutInContent = inContent
    if (inContent) {
      const anchor = env.text.links ?? env.text.tagline
      anchor.after(readout)
    } else {
      host.appendChild(readout)
    }
  }

  let ctx: CanvasRenderingContext2D | null = null
  try { ctx = stage.canvas.getContext('2d') } catch { /* an old or locked-down browser: fall back to the poster */ }
  host.toggleAttribute('data-nw-fallback', !ctx)

  const state: HeroState = {
    dpr, w: 0, h: 0, phone: false, textTop: 0,
    nodePos: {} as Record<NodeId, NodePos>, linkCtrl: makeLinkCtrl(), pool: makePool(), pulses: makePulsePool(), heat: makeHeatMaps(), ambient: makeAmbient(),
    sprites: ctx ? makeSprites() : null, simTime: 0, colo: SAMPLE_EDGE.colo, coloFont: '',
    running: false, raf: 0, lastT: 0, destroyed: false,
    timing: readTiming(), cursor: 0, timeline: null, logs: null, tIdx: 0, lIdx: 0, replaying: false,
    ambientAccum: 0, ambientBurstAccum: 4 + Math.random() * 4, keepAccum: Math.random() * 3,
    pingBusy: false, cardId: null, typing: null,
    // Cinematic camera: a critically damped follow (see smoothDamp); tx/ty
    // is the world point it is holding on.
    camera: { x: 0, y: 0, zoom: 1, vx: 0, vy: 0, vz: 0, tx: 0, ty: 0 },
    camWide: true, leadPacket: null, downloadProgress: 0, respStart: 0, respEnd: 0,
    // A safe, honestly-labelled default until loadEdgeFacts/probeCacheStatus
    // resolve, a few lines from here — see refreshEdgeDependent.
    edge: SAMPLE_EDGE, cache: '',
  }

  const meta = nodeMeta(isTouch, state.edge, state.cache)

  // ---- Trace rows: the whole log is built here (in buildReadout above),
  // every row hidden, so the text block has its final height before the
  // first line types (and before the first resize measures it).
  const pingHint = `${isTouch ? 'tap' : 'click'} anywhere to send a ping`
  function setRow(r: RowDom, text: string, noteText: string) {
    r.text = text; r.typed.textContent = ''; r.rest.textContent = text
    r.note.textContent = noteText ? ` (${noteText})` : ''
    r.note.dataset.pending = ''
    delete r.row.dataset.shown
  }
  function showRow(r: RowDom) {
    r.row.dataset.shown = ''
    r.typed.textContent = r.text; r.rest.textContent = ''
    delete r.note.dataset.pending
  }
  function fillRows() {
    const t = state.timing, tls = fmtTls(t, state.edge)
    const otherNote = t.otherPage ? OTHER_PAGE_NOTE : ''
    setRow(rows[0], fmtDns(t.dns), otherNote)
    setRow(rows[1], fmtConnect(t), otherNote)
    setRow(rows[2], tls.text, combineNotes(tls.note, otherNote))
    setRow(rows[ROW_HTTP], fmtHttp(t, state.edge, state.cache), combineNotes(t.fromCache ? '' : (state.edge.sample ? 'sample' : ''), otherNote))
    setRow(rows[4], fmtBytes(t), otherNote)
    setRow(rows[ROW_PAINT], fmtPaint(t.painted), otherNote)
    setRow(rows[ROW_PING], pingHint, '')
    rows[ROW_PING].row.dataset.hint = ''
  }
  // First paint is often recorded after this module starts, so the paint
  // row re-reads it at the moment it is written.
  function refreshPaint() {
    const p = readPaint()
    if (p > 0 && p !== state.timing.painted) {
      state.timing.painted = p
      const note = state.timing.otherPage ? ` (${OTHER_PAGE_NOTE})` : ''
      rows[ROW_PAINT].text = fmtPaint(p) + note
      rows[ROW_PAINT].rest.textContent = rows[ROW_PAINT].text
    }
  }
  fillRows()

  // A line types at a terminal's pace, and faster when the next row is due
  // sooner, so every line finishes typing before the next begins.
  const TYPE_CPS = 60
  function startTyping(r: RowDom) {
    // Two rows due in one frame (a slow frame, a tab resume): finish the
    // one in flight rather than orphan it half-typed.
    if (state.typing) showRow(state.typing.r)
    r.row.dataset.shown = ''
    const next = state.logs && state.lIdx < state.logs.length ? state.logs[state.lIdx].at - state.cursor : Infinity
    state.typing = { r, shown: 0, cps: Math.max(TYPE_CPS, r.text.length / Math.max(0.12, (next * 0.85) / 1000)) }
  }
  function advanceTyping(dt: number) {
    const ty = state.typing
    if (!ty) return
    ty.shown += dt * ty.cps
    const full = ty.r.text, n = Math.min(full.length, Math.floor(ty.shown))
    ty.r.typed.textContent = full.slice(0, n); ty.r.rest.textContent = full.slice(n)
    if (n >= full.length) { delete ty.r.note.dataset.pending; state.typing = null }
  }

  // ---- Node buttons: invisible, focusable overlays so keyboard users reach
  // the same info a hover gives a mouse. The glyphs themselves are
  // canvas-drawn, so this is the only real DOM per node.
  function nodeInfo(id: NodeId): string {
    const t = state.timing
    if (id === 'you') return `Your device · ${meta[0].sub}`
    if (id === 'network') return 'Your router · every request leaves through it'
    if (id === 'dns') return `DNS resolver · ${t.dns <= 0 ? 'answered from cache' : `answered in ${Math.round(t.dns)} ms`}`
    if (id === 'edge') {
      const cachePart = state.cache ? ` · cache ${state.cache}` : ''
      const sample = state.edge.sample ? ' (sample)' : ''
      return `Cloudflare edge ${state.edge.colo} · ${edgePlace(state.edge)}${cachePart}${sample}`
    }
    return `Origin server · ${ORIGIN}`
  }
  const buttons = {} as Record<NodeId, HTMLButtonElement>
  for (const m of meta) {
    const b = doc.createElement('button')
    b.type = 'button'
    b.dataset.type = 'hero-node-btn'
    b.dataset.node = m.id
    b.setAttribute('aria-label', nodeInfo(m.id))
    b.addEventListener('mouseenter', () => showCard(m.id), { signal: env.signal })
    b.addEventListener('mouseleave', () => hideCard(m.id), { signal: env.signal })
    b.addEventListener('focus', () => showCard(m.id), { signal: env.signal })
    b.addEventListener('blur', () => hideCard(m.id), { signal: env.signal })
    stage.nodesLayer.appendChild(b)
    buttons[m.id] = b
  }
  function showCard(id: NodeId) {
    state.cardId = id
    stage.card.textContent = nodeInfo(id)
    const p = state.nodePos[id], cam = state.camera
    if (!p) return
    // Node positions are world coordinates; the card lives in screen space,
    // so it goes through the same camera the canvas does.
    const z = cam.zoom, sx = (p.x - cam.x) * z + state.w / 2, sy = (p.y - cam.y) * z + state.h / 2, r = p.size * z
    let left = sx + r + 14
    const top = clamp(sy - 10, 8, Math.max(8, state.h - 60))
    if (left + 230 > state.w) left = sx - r - 14 - 230
    stage.card.style.left = `${clamp(left, 8, Math.max(8, state.w - 238))}px`
    stage.card.style.top = `${top}px`
    stage.card.dataset.shown = ''
  }
  function hideCard(id: NodeId) { if (state.cardId === id) { state.cardId = null; delete stage.card.dataset.shown } }

  // Positions, wires, labels and hit areas, from the stage size and, on a
  // phone, the measured top of the text block. The readout used to be a
  // child of the same `.nw-hero` the name and tagline lived in, so its
  // offsetTop measured the log's own overflow above that block for free;
  // here it can live in a different parent (host on desktop), so instead of
  // an offset trick this takes the plain top edge of whichever of the two —
  // the content block or the readout — currently extends highest.
  function layout() {
    env.text.name.style.fontSize = ''
    env.text.tagline.style.maxWidth = ''
    let stacked = false
    const hostRect = host.getBoundingClientRect()
    if (!state.phone) {
      placeReadout(false)
      const nameRect = env.text.name.getBoundingClientRect()
      const readoutRect = readout.getBoundingClientRect()
      const room = readoutRect.left - 40 - nameRect.left
      if (nameRect.width > room) {
        const fit = (parseFloat(getComputedStyle(env.text.name).fontSize) * room) / nameRect.width * 0.99
        if (fit >= 48) env.text.name.style.fontSize = `${fit}px`
        else stacked = true
      }
      if (!stacked) {
        const taglineRect = env.text.tagline.getBoundingClientRect()
        env.text.tagline.style.maxWidth = `min(46ch, ${Math.max(160, readoutRect.left - 40 - taglineRect.left)}px)`
      }
      placeReadout(stacked)
    } else {
      placeReadout(true)
    }
    const contentRect = env.text.content.getBoundingClientRect()
    const contentTop = contentRect.top - hostRect.top
    let textTop = contentTop
    if (!state.phone && !stacked) {
      const readoutTop = readout.getBoundingClientRect().top - hostRect.top
      textTop = Math.min(contentTop, readoutTop)
    }
    state.textTop = textTop
    state.nodePos = layoutPositions(state.w, state.h, state.phone, state.textTop)
    layoutLinks(state)
    if (ctx) layoutLabels(ctx, state, meta)
    for (const m of meta) {
      const pos = state.nodePos[m.id]
      const hit = pos.size * 1.7
      const btn = buttons[m.id]
      btn.style.left = `${pos.x}px`; btn.style.top = `${pos.y}px`
      btn.style.width = `${hit}px`; btn.style.height = `${hit}px`
      btn.style.margin = `${-hit / 2}px 0 0 ${-hit / 2}px`
    }
  }
  function resize(w: number, h: number) {
    state.w = w; state.h = h; state.phone = w <= 520
    section.toggleAttribute('data-nw-phone', state.phone)
    if (ctx) {
      stage.canvas.width = Math.max(1, Math.round(w * state.dpr))
      stage.canvas.height = Math.max(1, Math.round(h * state.dpr))
    }
    layout()
    resizeAmbient(state.ambient, w, h)
    // Keep the wide shot actually wide across a resize, but only while
    // wide, so a resize mid-replay does not fight the follow camera.
    if (state.camWide) { state.camera.x = w / 2; state.camera.y = h / 2; state.camera.zoom = 1 }
    if (state.cardId) showCard(state.cardId)
    renderNow()
  }
  // The name's web font changes the text block's height once it loads.
  if (doc.fonts && doc.fonts.ready) {
    doc.fonts.ready.then(() => { if (!state.destroyed && state.w) { layout(); renderNow() } }).catch(() => { /* font load failures don't affect layout correctness */ })
  }

  // ---- Drawing: canvas is HiDPI-scaled once per frame, cleared in that
  // plain space, THEN the camera is applied so world content draws in world
  // px regardless of zoom. The invisible node-button layer gets the
  // identical CSS transform, so hit areas track the camera too.
  function draw() {
    if (!ctx) return
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)
    ctx.clearRect(0, 0, state.w, state.h)
    const cam = state.camera
    ctx.translate(state.w / 2, state.h / 2)
    ctx.scale(cam.zoom, cam.zoom)
    ctx.translate(-cam.x, -cam.y)
    drawAmbient(ctx, state.ambient)
    drawLinks(ctx, state, state.simTime)
    drawPackets(ctx, state)
    drawGlyphs(ctx, state, meta)
    drawPulses(ctx, state.pulses, state.nodePos)
    stage.nodesLayer.style.transform = `translate(${state.w / 2}px, ${state.h / 2}px) scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`
  }
  function renderNow() { if (!state.running) draw() }

  // Builds (or rebuilds, for the replay button) the timeline from this
  // page's own timing. "This is you": a ripple opens the run from the node
  // the whole diagram is about, with the camera close on it.
  function startReplay() {
    const built = buildTimeline(state.timing, state.cache === 'HIT')
    state.timeline = built.timeline; state.logs = built.logs
    state.tIdx = 0; state.lIdx = 0; state.cursor = 0; state.replaying = true; state.typing = null
    state.respStart = built.respStart; state.respEnd = built.respEnd; state.downloadProgress = 0
    state.leadPacket = null; state.camWide = false
    fillRows()
    if (ctx) {
      const you = state.nodePos.you, cam = state.camera, z = camZoom(state)
      spawnPulse(state.pulses, 'you', WHITE, 950, you.size * 2.6 + 30)
      cam.tx = you.x; cam.ty = you.y
      cam.x = you.x; cam.y = camCentreY(state, you.y, z); cam.zoom = z; cam.vx = cam.vy = cam.vz = 0
    }
  }
  // Reduced motion never runs the loop, so the whole replay resolves at
  // once: every hop's heat is applied in order (last write wins, which is
  // the state an animated run settles into) and every row is shown.
  function renderFinalState() {
    const built = buildTimeline(state.timing, state.cache === 'HIT')
    state.downloadProgress = 1
    state.camWide = true
    const cam = state.camera
    cam.x = state.w / 2; cam.y = state.h / 2; cam.zoom = 1; cam.vx = cam.vy = cam.vz = 0
    for (const e of built.timeline) {
      if (e.kind === 'fx') continue
      const l = LINK_OF[`${e.a}>${e.b}`]
      const lh = l ? state.heat.link[l.key] : undefined
      if (lh) { lh.heat = 0.55; lh.r = e.color[0]; lh.g = e.color[1]; lh.b = e.color[2] }
      for (const id of [e.a, e.b]) {
        const nh = state.heat.node[id]
        if (nh) { nh.heat = 0.5; nh.r = e.color[0]; nh.g = e.color[1]; nh.b = e.color[2] }
      }
    }
    fillRows(); refreshPaint()
    for (const r of rows) showRow(r)
    draw()
  }
  function runFx(e: FxEvent) {
    const you = state.nodePos.you, edge = state.nodePos.edge
    if (e.fx === 'local') { bumpHeat(state.heat.node.you, WHITE); spawnPulse(state.pulses, 'you', WHITE, 700, you.size * 1.8 + 20) }
    else if (e.fx === 'reuse') {
      bumpHeat(state.heat.link[LINK_KEYS[0]], WHITE, 1); bumpHeat(state.heat.link[LINK_KEYS[2]], WHITE, 1)
      bumpHeat(state.heat.node.edge, WHITE); spawnPulse(state.pulses, 'edge', WHITE, 600, edge.size * 1.7 + 16)
    } else if (e.fx === 'hit') { bumpHeat(state.heat.node.edge, AMBER); spawnPulse(state.pulses, 'edge', WHITE, 650, edge.size * 1.9 + 18) }
    else if (e.fx === 'pong') { state.pingBusy = false; setPing(e.text ?? '', false) }
  }
  function advanceTimeline(dt: number) {
    if (!state.timeline || !state.logs) return
    state.cursor += dt * 1000
    const tl = state.timeline
    while (state.tIdx < tl.length && state.cursor >= tl[state.tIdx].start) {
      const e = tl[state.tIdx]
      state.tIdx += 1
      if (e.kind === 'fx') { runFx(e); continue }
      // The lead packet is the newest hop, furthest along the route; the
      // camera (updateCamera) follows it.
      const np = spawnPacket(state.pool, 'main', e.a, e.b, e.color, e.dur, e.size)
      if (np) state.leadPacket = np
    }
    while (state.lIdx < state.logs.length && state.cursor >= state.logs[state.lIdx].at) {
      const row = state.logs[state.lIdx].row
      state.lIdx += 1
      // The request has landed at the edge: the route is decided and
      // nothing is left to chase, so the camera pulls out for the response.
      if (row === ROW_HTTP) state.camWide = true
      if (row === ROW_PAINT) refreshPaint()
      startTyping(rows[row])
    }
    if (state.respEnd > state.respStart) {
      state.downloadProgress = clamp((state.cursor - state.respStart) / (state.respEnd - state.respStart), 0, 1)
    }
    if (state.replaying && state.lIdx >= state.logs.length && !state.typing) state.replaying = false
  }

  function loop(tsNow: number) {
    if (!state.running) return
    state.raf = requestAnimationFrame(loop)
    const dt = state.lastT ? Math.min((tsNow - state.lastT) / 1000, 0.25) : 1 / 60
    state.lastT = tsNow
    state.simTime += dt * 1000
    decayAllHeat(state.heat, dt)
    updatePackets(state, dt)
    updatePulses(state.pulses, dt)
    updateCamera(state, dt)
    driftAmbient(state.ambient, state.simTime)
    advanceTimeline(dt)
    advanceTyping(dt)
    ambientTick(state, dt)
    ambientBurstTick(state, dt)
    keepaliveTick(state, dt)
    draw()
  }

  // ---- Ping: a real request, timed. One at a time, and not while the
  // landing is still replaying (its last row is the ping's own). Same-origin
  // HEAD on '/': edge-cached and not counted as a visit by src/lib/visits.ts.
  function setPing(text: string, instant: boolean) {
    const r = rows[ROW_PING]
    delete r.row.dataset.hint
    r.text = text; r.note.textContent = ''
    if (instant) showRow(r); else startTyping(r)
  }
  function finishPing(ms: number) {
    if (state.destroyed) return
    const text = ms < 0 ? 'no answer this time' : `answered in ${Math.round(ms)} ms`
    if (reduced || !ctx || !state.running || ms < 0) {
      state.pingBusy = false
      setPing(text, reduced || !state.running)
      if (ctx && ms >= 0) {
        bumpHeat(state.heat.node.edge, VIOLET)
        bumpHeat(state.heat.link[LINK_KEYS[0]], VIOLET, -1)
        bumpHeat(state.heat.link[LINK_KEYS[2]], VIOLET, -1)
        renderNow()
      }
      return
    }
    // The packet travels the measured round trip (clamped to watchable),
    // and the row updates when it lands, not when the fetch resolved.
    const leg = clamp(ms / 4, HOP_MIN, 500)
    let t = state.cursor + 30
    const tl = state.timeline
    if (!tl) return
    const legsOut: Array<[NodeId, NodeId]> = [['you', 'network'], ['network', 'edge']]
    for (const [a, b] of legsOut) { tl.push({ kind: 'hop', start: t, a, b, color: AMBER, dur: leg, size: 3 }); t += leg }
    const legsBack: Array<[NodeId, NodeId]> = [['edge', 'network'], ['network', 'you']]
    for (const [a, b] of legsBack) { tl.push({ kind: 'hop', start: t, a, b, color: VIOLET, dur: leg, size: 3 }); t += leg }
    tl.push({ kind: 'fx', start: t, fx: 'pong', text })
  }
  function ping() {
    if (state.pingBusy || state.replaying || (!state.timeline && ctx && !reduced)) return
    state.pingBusy = true
    const t0 = performance.now()
    fetch('/', { method: 'HEAD', cache: 'no-store', signal: env.signal })
      .then(() => finishPing(performance.now() - t0))
      .catch(() => finishPing(-1))
  }
  function onReplay() {
    if (reduced || !ctx) { renderFinalState(); return }
    startReplay()
    if (!state.running) start()
  }
  stage.ping.addEventListener('click', ping, { signal: env.signal })
  replay.addEventListener('click', onReplay, { signal: env.signal })

  function start() {
    if (state.destroyed) return
    if (reduced || !ctx) { renderFinalState(); return }
    if (!state.timeline) startReplay()
    if (!state.running) { state.running = true; state.lastT = 0; state.raf = requestAnimationFrame(loop) }
  }
  function stop() {
    state.running = false
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0 }
  }
  function destroy() {
    state.destroyed = true
    stop()
    section.removeAttribute('data-nw-phone')
    env.text.name.style.fontSize = ''
    env.text.tagline.style.maxWidth = ''
    readout.remove()
    host.removeAttribute('data-nw-fallback')
    host.replaceChildren()
  }

  // ---- Edge facts + cache status: kicked off once, here, and applied
  // in place when they resolve (see the module doc comment at the top of
  // this file). Both fetches carry env.signal, so destroy() cancels them.
  function refreshEdgeDependent() {
    const edgeEntry = meta.find(m => m.id === 'edge')
    if (edgeEntry) edgeEntry.sub = edgeSub(state.edge, state.cache)
    buttons.edge.setAttribute('aria-label', nodeInfo('edge'))
    if (state.cardId === 'edge') showCard('edge')
    if (ctx) layoutLabels(ctx, state, meta)
    if (reduced || !ctx) {
      // renderFinalState() shows every row at once and never advances
      // lIdx, so that isn't a usable "nothing shown yet" signal here: redo
      // what it did, with the freshly arrived facts.
      fillRows()
      for (const r of rows) showRow(r)
    } else if (state.lIdx === 0 && !state.typing) {
      // Only rewrite rows nobody has seen yet: fillRows() hides every row
      // again, which would be a visible regression on a row already shown.
      fillRows()
    }
    renderNow()
  }
  let navEntry: PerformanceNavigationTiming | undefined
  try { navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined } catch { /* see readPaint */ }
  void (async () => {
    const fromServerTiming = readCfCacheStatusFromServerTiming(navEntry)
    const [edge, cacheVal] = await Promise.all([
      loadEdgeFacts(env.signal),
      fromServerTiming ? Promise.resolve(fromServerTiming) : probeCacheStatus(env.signal),
    ])
    if (state.destroyed) return
    state.edge = edge
    state.cache = cacheVal
    state.colo = edge.colo
    refreshEdgeDependent()
  })()

  const instance: HeroInstance = { start, stop, resize, destroy }
  return instance
}
