/**
 * "How you landed here" — a live network diagram replaying how this page
 * load reached the visitor: their device, their router, a DNS resolver, the
 * Cloudflare edge and the origin (Node.js in Docker on Oracle Cloud), timed
 * from this browser's own Navigation Timing. The device's own on-canvas
 * screen fills in as the page's bytes arrive. Ported from the Hero Lab's
 * network.js (round 4, "bold pass"); see AGENTS.md's Home hero candidates
 * section for the contract every hero here follows.
 *
 * Differences from the lab module, all required by BRIEF-network.md:
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
import type { HeroCreate, HeroEnv, HeroInstance } from './types'
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
const ORIGIN = 'Node.js in Docker on Oracle Cloud'

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
function fetchWithTimeout(url: string, outerSignal: AbortSignal, ms: number): Promise<Response> {
  const ac = new AbortController()
  const onAbort = () => ac.abort()
  outerSignal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => ac.abort(), ms)
  return fetch(url, { cache: 'no-store', signal: ac.signal }).finally(() => {
    clearTimeout(timer)
    outerSignal.removeEventListener('abort', onAbort)
  })
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
