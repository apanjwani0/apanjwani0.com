/**
 * Capture store for the Webhook Inspector tool.
 *
 * This is the first tool on the site that uses the server the app already pays
 * for: a bin receives real HTTP requests from other software (a webhook sender,
 * a curl one-liner, a client under test) and the tool page reads them back out,
 * live over an event stream (`api/hook/[bin]/stream.ts`) or by polling.
 *
 * Storage is a process-local Map — deliberately. Production runs the
 * `@astrojs/node` adapter as a single container (see AGENTS.md), so module state
 * is shared across requests; there is no KV binding on Node. Bins are ephemeral
 * by nature (webhook.cool drops them after a week of inactivity); here they are
 * swept after a few hours and capped hard so a public endpoint can never grow
 * memory without bound.
 *
 * They also survive a deploy. State is flushed, debounced, to
 * `data/webhook-bins.json` (the volume the daily boards already use) and read
 * back on the next start, with every row re-validated on the way in: the file
 * lives on disk across releases, so it is treated as input, never as trusted
 * state. The 6 h idle clock, the bin cap, the per-bin cap and the global byte
 * budget all apply to what is loaded, so a hand-edited or stale file cannot
 * hold more than a live server could. On Cloudflare Workers, where isolates
 * don't share module state, this would need KV/Durable Objects — but the Node
 * origin is the deploy target, and this keeps the tool dependency-free there.
 *
 * What the disk copy changes about privacy: captured headers and bodies (which
 * can carry Authorization headers and signing secrets) now sit in a file as
 * well as in memory. The file is written mode 0600, holds only bins inside the
 * idle window, and is rewritten without an expired bin at the next flush.
 * `/terms` says so, from `WEBHOOK_BIN_TTL_MS` below.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface CapturedHeader {
  name: string
  value: string
}

export interface CapturedRequest {
  id: string
  method: string
  /** Query string as sent (without the leading "?"), or "" when none. */
  query: string
  headers: CapturedHeader[]
  contentType: string | null
  /** Best-effort sender IP (cf-connecting-ip), when the edge provides one. */
  source: string | null
  bodyText: string
  /**
   * The exact body bytes, base64, kept ONLY when `bodyText` cannot reproduce
   * them (the body was not valid UTF-8). A signature is a hash of bytes, so a
   * replacement-character decode would turn a correct secret into a mismatch;
   * valid UTF-8, which is nearly every webhook, costs nothing extra.
   */
  bodyBase64?: string
  bodyTruncated: boolean
  /** Raw body byte length before any truncation. */
  size: number
  receivedAt: number
}

/** What a bin answers captures with, instead of the default JSON acknowledgement. */
export interface BinResponse {
  status: number
  /** Lowercased names from the allowlist; at most WEBHOOK_MAX_RESPONSE_HEADERS. */
  headers: CapturedHeader[]
  contentType: string
  body: string
}

interface Bin {
  requests: CapturedRequest[]
  lastActivity: number
  response: BinResponse | null
}

// Caps — a public, unauthenticated capture endpoint must stay bounded no matter
// the traffic. The per-bin / per-body limits cap any single sender; the global
// byte ceiling caps the store as a whole, so process RAM stays bounded even when
// an abuser spreads max-size bodies across the maximum number of bins. Without
// it the hard bound is 800 × 50 × 64 KB ≈ 2.5 GB — enough to OOM the single Node
// container the site runs in.
export const WEBHOOK_MAX_BINS = 800
export const WEBHOOK_MAX_REQUESTS_PER_BIN = 50
export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024
// 16 MB, not 64: the host is a 1 GB free-tier VM, and reqBytes() undercounts —
// it measures bodyText.length (UTF-16 code units, so non-Latin1 text costs ~2x)
// and charges a flat 256 bytes for per-request and per-header object overhead
// that is really larger. Budget for the accounting being optimistic rather than
// discovering the gap as an OOM.
export const WEBHOOK_MAX_TOTAL_BYTES = 16 * 1024 * 1024
export const WEBHOOK_BIN_TTL_MS = 6 * 60 * 60 * 1000 // 6h of inactivity

// Per-bin response configuration (see validateBinResponse). The body is counted
// in the same byte budget as captures, so a configured response is not a way
// around the global ceiling.
export const WEBHOOK_MAX_RESPONSE_BODY_BYTES = 8 * 1024
export const WEBHOOK_MAX_RESPONSE_HEADERS = 8
/** Name and value together, in characters (the allowed set is ASCII). */
export const WEBHOOK_MAX_RESPONSE_HEADER_CHARS = 256

// Live streams (api/hook/[bin]/stream.ts). Every open stream pins a socket and a
// closure on a 1 GB host, so the whole process is capped, each client key gets
// one per bin, and none lives past WEBHOOK_STREAM_MAX_MS.
export const WEBHOOK_MAX_STREAMS = 64
export const WEBHOOK_STREAM_MAX_MS = 25 * 60 * 1000
export const WEBHOOK_STREAM_KEEPALIVE_MS = 20_000

// Persistence. The debounce matches the daily boards; the file cap is the
// ceiling a load will accept and a flush will write, above the 16 MB memory
// budget because JSON escapes control characters (a byte can cost six).
export const WEBHOOK_FLUSH_MS = 5_000
export const WEBHOOK_MAX_FILE_BYTES = 32 * 1024 * 1024
const PERSIST_VERSION = 1

const bins = new Map<string, Bin>()
// Running sum of the (approximate) bytes held across all bins, kept in step with
// every insert / trim / evict so enforcing the global ceiling is O(1) to check.
let totalBytes = 0

/**
 * The body as base64 when its UTF-8 text view cannot give the bytes back, else
 * undefined. Compared by re-encoding, so the answer is exact rather than a guess
 * from the presence of a replacement character (a body may legitimately contain
 * U+FFFD).
 */
export function rawBodyIfLossy(bytes: Uint8Array, text: string): string | undefined {
  const again = new TextEncoder().encode(text)
  if (again.length === bytes.length && again.every((b, i) => b === bytes[i])) return undefined
  return Buffer.from(bytes).toString('base64')
}

/** Approximate stored size of one request: body + header text + fixed overhead. */
function reqBytes(req: CapturedRequest): number {
  let n = req.bodyText.length + (req.bodyBase64?.length ?? 0) + req.query.length + 256
  for (const h of req.headers) n += h.name.length + h.value.length
  return n
}

function responseBytes(r: BinResponse | null): number {
  if (!r) return 0
  let n = r.body.length + r.contentType.length + 256
  for (const h of r.headers) n += h.name.length + h.value.length
  return n
}

function binBytes(bin: Bin): number {
  let n = responseBytes(bin.response)
  for (const r of bin.requests) n += reqBytes(r)
  return n
}

/* ------------------------------------------------------------------ */
/* subscribers (the event stream)                                       */
/* ------------------------------------------------------------------ */

export type BinEvent =
  | { type: 'request'; request: CapturedRequest }
  | { type: 'cleared' }
  | { type: 'closed'; reason: 'expired' | 'evicted' }

type BinListener = (event: BinEvent) => void
const listeners = new Map<string, Set<BinListener>>()

/** Called for every change to one bin. Returns the unsubscribe. Bounded by the stream cap. */
export function subscribeBin(binId: string, listener: BinListener): () => void {
  let set = listeners.get(binId)
  if (!set) {
    set = new Set()
    listeners.set(binId, set)
  }
  set.add(listener)
  return () => {
    const current = listeners.get(binId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) listeners.delete(binId)
  }
}

function emit(binId: string, event: BinEvent): void {
  const set = listeners.get(binId)
  if (!set) return
  // A listener that throws must not stop the capture that triggered it.
  for (const fn of [...set]) {
    try { fn(event) } catch { /* the stream will notice its own failure */ }
  }
}

const streamSlots = new Set<string>()
/** Open streams per client key; never more entries than open slots. */
const streamsByClient = new Map<string, number>()
/** One address may hold this many streams across all bins, so it cannot take every slot. */
export const WEBHOOK_MAX_STREAMS_PER_CLIENT = 4

export type StreamSlot =
  | { ok: true; release: () => void }
  | { ok: false; reason: 'full' | 'duplicate' | 'client-full' }

/**
 * Reserve one of the process's WEBHOOK_MAX_STREAMS slots for (client, bin).
 * One per pair: a second tab on the same address and bin is refused and polls.
 * At most WEBHOOK_MAX_STREAMS_PER_CLIENT per address across bins, because any
 * well-formed id may be streamed and one address could otherwise fill the cap.
 * `clientKey` is untrusted and only buckets; the set never exceeds the cap, so
 * a flood of invented keys cannot grow it.
 */
export function acquireStreamSlot(binId: string, clientKey: string): StreamSlot {
  const key = `${clientKey}\n${binId}`
  if (streamSlots.has(key)) return { ok: false, reason: 'duplicate' }
  const held = streamsByClient.get(clientKey) ?? 0
  if (held >= WEBHOOK_MAX_STREAMS_PER_CLIENT) return { ok: false, reason: 'client-full' }
  if (streamSlots.size >= WEBHOOK_MAX_STREAMS) return { ok: false, reason: 'full' }
  streamSlots.add(key)
  streamsByClient.set(clientKey, held + 1)
  let released = false
  return {
    ok: true,
    release: () => {
      if (released) return
      released = true
      streamSlots.delete(key)
      const left = (streamsByClient.get(clientKey) ?? 1) - 1
      if (left > 0) streamsByClient.set(clientKey, left)
      else streamsByClient.delete(clientKey)
    },
  }
}

export function openStreamCount(): number {
  return streamSlots.size
}

/* ------------------------------------------------------------------ */
/* the store                                                            */
/* ------------------------------------------------------------------ */

/** Delete a bin and decrement the byte total by everything it held. */
function dropBin(id: string, reason: 'expired' | 'evicted' = 'evicted'): void {
  const bin = bins.get(id)
  if (!bin) return
  totalBytes -= binBytes(bin)
  bins.delete(id)
  emit(id, { type: 'closed', reason })
  markDirty()
}

/**
 * Bin ids are client-generated, and knowing one is the *only* thing protecting a
 * bin's contents — there is no account and no other auth. Captured requests
 * routinely carry Authorization headers, webhook signing secrets and customer
 * data, so the id has to be unguessable, not merely well-formed.
 *
 * The 24-char floor is the security control: the UI always mints a 32-char hex
 * UUID, but the endpoint has to reject the short, memorable ids someone would
 * otherwise hand-craft ("test12", "webhook") and an attacker would enumerate.
 */
const BIN_ID_RE = /^[A-Za-z0-9_-]{24,64}$/

export function isValidBinId(id: unknown): id is string {
  return typeof id === 'string' && BIN_ID_RE.test(id)
}

/**
 * Request ids are server-minted UUIDs, so unlike bin ids they are not a secrecy
 * control — the bin id in the same lookup already grants access to everything
 * the bin holds. Validation here is shape hygiene, not auth: it keeps arbitrary
 * client strings out of store lookups and out of reflected JSON.
 */
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/

export function isValidRequestId(id: unknown): id is string {
  return typeof id === 'string' && REQUEST_ID_RE.test(id)
}

/** Drop expired bins and, if still over the cap, evict the least-recently-used. */
function sweep(now: number): void {
  ensureLoaded()
  for (const [id, bin] of bins) {
    if (now - bin.lastActivity > WEBHOOK_BIN_TTL_MS) dropBin(id, 'expired')
  }
  if (bins.size > WEBHOOK_MAX_BINS) {
    const ordered = [...bins.entries()].sort((a, b) => a[1].lastActivity - b[1].lastActivity)
    const excess = bins.size - WEBHOOK_MAX_BINS
    for (let i = 0; i < excess; i += 1) dropBin(ordered[i][0])
  }
}

/** The bin for an id, created (empty) on first use. Sweeps first. */
function binFor(binId: string, now: number): Bin {
  sweep(now)
  let bin = bins.get(binId)
  if (!bin) {
    bin = { requests: [], lastActivity: now, response: null }
    bins.set(binId, bin)
  }
  return bin
}

/**
 * Global memory ceiling: if the store is over budget, evict least-recently-used
 * bins — never the one just written — until back under. Bounds total RAM no
 * matter how requests are spread across bins.
 */
function enforceCeiling(keepId: string): void {
  if (totalBytes <= WEBHOOK_MAX_TOTAL_BYTES) return
  const ordered = [...bins.entries()]
    .filter(([id]) => id !== keepId)
    .sort((a, b) => a[1].lastActivity - b[1].lastActivity)
  for (const [id] of ordered) {
    if (totalBytes <= WEBHOOK_MAX_TOTAL_BYTES) break
    dropBin(id)
  }
}

/** Record one captured request against a bin, creating the bin on first hit. */
export function recordRequest(binId: string, req: CapturedRequest): void {
  const now = Date.now()
  const bin = binFor(binId, now)
  // Newest first; trim the tail so a chatty sender can't grow the bin unbounded.
  bin.requests.unshift(req)
  totalBytes += reqBytes(req)
  while (bin.requests.length > WEBHOOK_MAX_REQUESTS_PER_BIN) {
    const dropped = bin.requests.pop()
    if (dropped) totalBytes -= reqBytes(dropped)
  }
  bin.lastActivity = now
  enforceCeiling(binId)
  markDirty()
  emit(binId, { type: 'request', request: req })
}

/** List captured requests for a bin, newest first. Empty for unknown bins. */
export function listRequests(binId: string): CapturedRequest[] {
  sweep(Date.now())
  return bins.get(binId)?.requests ?? []
}

/**
 * Fetch one captured request by id — what a share permalink resolves. Returns
 * null when the bin or the request is gone (expired, cleared, or trimmed at the
 * per-bin cap). Deliberately does NOT bump lastActivity: reading a shared link
 * must not keep a bin alive past the TTL its own traffic earned, or a link
 * posted somewhere with steady clicks pins the bin (and its captured
 * Authorization headers) in memory indefinitely.
 */
export function getRequest(binId: string, requestId: string): CapturedRequest | null {
  sweep(Date.now())
  const bin = bins.get(binId)
  if (!bin) return null
  return bin.requests.find(r => r.id === requestId) ?? null
}

/**
 * When a bin last saw a capture or a configuration change, or null when it does
 * not exist (never created, expired or evicted). Does not bump anything: a stream
 * reading this must not keep a bin alive.
 */
export function binLastActivity(binId: string): number | null {
  sweep(Date.now())
  return bins.get(binId)?.lastActivity ?? null
}

/** Clear a bin's requests (keeps the bin alive, and keeps its configured response). Returns true if it existed. */
export function clearBin(binId: string): boolean {
  ensureLoaded()
  const bin = bins.get(binId)
  if (!bin) return false
  for (const r of bin.requests) totalBytes -= reqBytes(r)
  bin.requests = []
  bin.lastActivity = Date.now()
  markDirty()
  emit(binId, { type: 'cleared' })
  return true
}

/* ------------------------------------------------------------------ */
/* the configured response                                              */
/* ------------------------------------------------------------------ */

/**
 * Content types a configured (or echoed) response may carry. An allowlist,
 * because the response is served from THIS origin: `text/html` or
 * `image/svg+xml` would let anyone who can mint a bin host a page here. XML is
 * allowed (Twilio answers in TwiML) but is served as an attachment, since a
 * browser will render XML in the XHTML namespace as a page.
 */
const SAFE_RESPONSE_TYPES = new Set([
  'application/json',
  'application/problem+json',
  'application/x-www-form-urlencoded',
  'application/octet-stream',
  'application/xml',
  'text/xml',
  'text/plain',
  'text/csv',
])
const CONTENT_TYPE_RE = /^([a-z]+\/[a-z0-9.+-]{1,64})(?:\s*;\s*charset=([A-Za-z0-9_-]{1,32}))?$/i

/** The normalised content type if it is one a response may carry, else null. */
export function safeResponseContentType(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 128) return null
  const m = CONTENT_TYPE_RE.exec(raw.trim())
  if (!m) return null
  const base = m[1].toLowerCase()
  if (!SAFE_RESPONSE_TYPES.has(base)) return null
  return m[2] ? `${base}; charset=${m[2].toLowerCase()}` : base
}

/** Should this response be forced to download rather than render? */
export function responseIsRenderableXml(contentType: string): boolean {
  return contentType.startsWith('application/xml') || contentType.startsWith('text/xml')
}

const HEADER_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const HEADER_VALUE_RE = /^[\x20-\x7e]*$/
/**
 * Names a response may set, besides `x-` names. Left out on purpose:
 * `set-cookie` (a cookie on this origin), hop-by-hop headers and
 * `content-length` (the server owns framing), `www-authenticate` (a browser
 * would show a sign-in box for this site and send what was typed to the bin),
 * `refresh` and `content-location`, and every caching header (the API's
 * `no-store` stands).
 */
const RESPONSE_HEADERS = new Set([
  'location', 'retry-after', 'content-language', 'allow',
  'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'ratelimit-policy',
])
/** `x-` names that would contradict what this site sends about itself. */
const RESPONSE_X_DENY = /^x-(origin|frame-options|content-type-options|robots-tag|xss-protection|forwarded-|real-ip|accel-|sendfile)/

export function isAllowedResponseHeader(name: string): boolean {
  if (!HEADER_NAME_RE.test(name)) return false
  if (RESPONSE_HEADERS.has(name)) return true
  return name.startsWith('x-') && !RESPONSE_X_DENY.test(name)
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** `/api/hook/<binId>` or `/api/hook/<binId>?<query>`, and nothing else. */
function isOwnBinLocation(value: string, binId: string): boolean {
  const base = `/api/hook/${binId}`
  return value === base || (value.startsWith(`${base}?`) && !/[#\\]/.test(value))
}
const NO_BODY_STATUSES = new Set([204, 205, 304])

export type ResponseCheck = { ok: true; value: BinResponse } | { ok: false; error: string }

/**
 * Hold a response configuration to every bound, and return it normalised.
 *
 * Pure and synchronous so the route, the loader and the smoke test share it.
 * Every refusal is a fixed sentence: nothing the caller sent is echoed back.
 * `Location` may only point back at this bin (`/api/hook/<binId>`, with an
 * optional query). Any other target would make this site an open redirect:
 * anyone could mint a link on this domain that sends a visitor wherever they
 * chose. Following the redirect lands on the bin, so the follow-up request is
 * captured too, which is what a redirect test wants to see.
 */
export function validateBinResponse(input: unknown, binId: string): ResponseCheck {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'The response must be an object with a status, headers, body and content type.' }
  }
  const raw = input as Record<string, unknown>

  const status = raw.status
  if (typeof status !== 'number' || !Number.isInteger(status)) {
    return { ok: false, error: 'The status must be a whole number.' }
  }
  if (status >= 100 && status < 200) {
    return { ok: false, error: 'Informational (1xx) statuses cannot be sent: the server runtime only sends a final response, so use 200 to 599.' }
  }
  if (status < 200 || status > 599) return { ok: false, error: 'The status must be between 200 and 599.' }

  let contentType = 'application/json'
  if (raw.contentType !== undefined && raw.contentType !== null && raw.contentType !== '') {
    const safe = safeResponseContentType(raw.contentType)
    if (!safe) {
      return { ok: false, error: 'That content type is not allowed. Use JSON, plain text, CSV, XML, form-encoded or octet-stream; HTML and SVG are refused because this site would be serving them.' }
    }
    contentType = safe
  }

  const body = raw.body === undefined || raw.body === null ? '' : raw.body
  if (typeof body !== 'string') return { ok: false, error: 'The body must be text.' }
  if (new TextEncoder().encode(body).length > WEBHOOK_MAX_RESPONSE_BODY_BYTES) {
    return { ok: false, error: `The body can be at most ${WEBHOOK_MAX_RESPONSE_BODY_BYTES / 1024} KB.` }
  }
  if (NO_BODY_STATUSES.has(status) && body !== '') {
    return { ok: false, error: `A ${status} response cannot carry a body, so leave the body empty.` }
  }

  // Headers arrive as a list of {name, value} or as a plain object.
  let entries: [unknown, unknown][]
  if (raw.headers === undefined || raw.headers === null) entries = []
  else if (Array.isArray(raw.headers)) {
    entries = raw.headers.map(h => (h && typeof h === 'object' ? [(h as any).name, (h as any).value] : [undefined, undefined]))
  } else if (typeof raw.headers === 'object') entries = Object.entries(raw.headers as Record<string, unknown>)
  else return { ok: false, error: 'The headers must be a list of names and values.' }

  if (entries.length > WEBHOOK_MAX_RESPONSE_HEADERS) {
    return { ok: false, error: `At most ${WEBHOOK_MAX_RESPONSE_HEADERS} headers can be set.` }
  }
  const headers: CapturedHeader[] = []
  const seen = new Set<string>()
  for (const [rawName, rawValue] of entries) {
    if (typeof rawName !== 'string' || typeof rawValue !== 'string') {
      return { ok: false, error: 'Every header needs a name and a text value.' }
    }
    const name = rawName.trim().toLowerCase()
    const value = rawValue.trim()
    if (!isAllowedResponseHeader(name)) {
      return { ok: false, error: 'One of the header names is not allowed. Allowed: Location, Retry-After, Content-Language, Allow, RateLimit-*, and custom X- headers.' }
    }
    if (!HEADER_VALUE_RE.test(value)) {
      return { ok: false, error: 'Header values can use printable ASCII characters only.' }
    }
    if (name.length + value.length > WEBHOOK_MAX_RESPONSE_HEADER_CHARS) {
      return { ok: false, error: `A header's name and value together can be at most ${WEBHOOK_MAX_RESPONSE_HEADER_CHARS} characters.` }
    }
    if (seen.has(name)) return { ok: false, error: 'A header can be set only once.' }
    seen.add(name)
    if (name === 'location' && !isOwnBinLocation(value, binId)) {
      return { ok: false, error: 'Location can only point back at this URL (/api/hook/ followed by this URL\'s id, optionally with a query), so the site never redirects visitors somewhere else.' }
    }
    headers.push({ name, value })
  }

  if (REDIRECT_STATUSES.has(status) && !seen.has('location')) {
    return { ok: false, error: `A ${status} redirect needs a Location header.` }
  }
  return { ok: true, value: { status, headers, contentType, body } }
}

/** The configured response for a bin, or null. Does not bump activity. */
export function getBinResponse(binId: string): BinResponse | null {
  sweep(Date.now())
  return bins.get(binId)?.response ?? null
}

/** Store an already-validated response with the bin (creating it). Counted in the byte budget. */
export function setBinResponse(binId: string, response: BinResponse): void {
  const now = Date.now()
  const bin = binFor(binId, now)
  totalBytes -= responseBytes(bin.response)
  bin.response = response
  totalBytes += responseBytes(response)
  bin.lastActivity = now
  enforceCeiling(binId)
  markDirty()
}

/** Remove a bin's configured response. Returns true when there was one. */
export function clearBinResponse(binId: string): boolean {
  ensureLoaded()
  const bin = bins.get(binId)
  if (!bin?.response) return false
  totalBytes -= responseBytes(bin.response)
  bin.response = null
  bin.lastActivity = Date.now()
  markDirty()
  return true
}

/* ------------------------------------------------------------------ */
/* persistence                                                          */
/* ------------------------------------------------------------------ */

const TOKEN_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/
const MAX_BASE64_CHARS = Math.ceil((WEBHOOK_MAX_BODY_BYTES * 4) / 3) + 8
const CLOCK_SKEW_MS = 60_000

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * One persisted request, re-validated field by field and rebuilt from scratch so
 * nothing the file carried beyond the known fields survives. null = reject.
 */
export function sanitizeStoredRequest(value: unknown, now = Date.now()): CapturedRequest | null {
  if (!isObj(value)) return null
  const { id, method, query, headers, contentType, source, bodyText, bodyBase64, bodyTruncated, size, receivedAt } = value
  if (!isValidRequestId(id)) return null
  if (typeof method !== 'string' || method.length > 32 || !TOKEN_RE.test(method)) return null
  if (typeof query !== 'string' || query.length > 16_384) return null
  if (!Array.isArray(headers) || headers.length > 256) return null
  const cleanHeaders: CapturedHeader[] = []
  for (const h of headers) {
    if (!isObj(h) || typeof h.name !== 'string' || typeof h.value !== 'string') return null
    if (h.name.length === 0 || h.name.length > 256 || !TOKEN_RE.test(h.name) || h.value.length > 16_384) return null
    // The origin-lock secret is never captured (see the capture route); a file
    // that carries it was not written by this server.
    if (h.name.toLowerCase() === 'x-origin-auth') continue
    cleanHeaders.push({ name: h.name, value: h.value })
  }
  if (contentType !== null && (typeof contentType !== 'string' || contentType.length > 1024)) return null
  if (source !== null && (typeof source !== 'string' || source.length > 128)) return null
  if (typeof bodyText !== 'string' || bodyText.length > WEBHOOK_MAX_BODY_BYTES) return null
  if (bodyBase64 !== undefined && (typeof bodyBase64 !== 'string' || bodyBase64.length > MAX_BASE64_CHARS || !BASE64_RE.test(bodyBase64))) return null
  if (typeof bodyTruncated !== 'boolean') return null
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return null
  if (typeof receivedAt !== 'number' || !Number.isFinite(receivedAt) || receivedAt <= 0 || receivedAt > now + CLOCK_SKEW_MS) return null
  const out: CapturedRequest = {
    id, method, query, headers: cleanHeaders, contentType: contentType as string | null, source: source as string | null,
    bodyText, bodyTruncated, size, receivedAt,
  }
  if (bodyBase64) out.bodyBase64 = bodyBase64
  return out
}

/**
 * Rebuild the bins from persisted text. Rows that fail validation are dropped
 * (not repaired); a bin past its idle TTL is dropped; the per-bin, bin-count and
 * global-byte caps are applied exactly as a live server applies them, most
 * recently active first. Anything unparseable yields an empty store.
 */
export function parsePersistedBins(text: string, now = Date.now()): Map<string, Bin> {
  const out = new Map<string, Bin>()
  if (text.length > WEBHOOK_MAX_FILE_BYTES) return out
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return out }
  if (!isObj(parsed) || parsed.v !== PERSIST_VERSION || !Array.isArray(parsed.bins)) return out

  const candidates: { id: string; bin: Bin }[] = []
  for (const row of parsed.bins) {
    if (!isObj(row) || !isValidBinId(row.id)) continue
    if (typeof row.lastActivity !== 'number' || !Number.isFinite(row.lastActivity)) continue
    const lastActivity = Math.min(row.lastActivity, now)
    if (now - lastActivity > WEBHOOK_BIN_TTL_MS) continue
    const requests: CapturedRequest[] = []
    if (Array.isArray(row.requests)) {
      const seen = new Set<string>()
      for (const r of row.requests) {
        if (requests.length >= WEBHOOK_MAX_REQUESTS_PER_BIN) break
        const clean = sanitizeStoredRequest(r, now)
        if (clean && !seen.has(clean.id)) {
          seen.add(clean.id)
          requests.push(clean)
        }
      }
    }
    let response: BinResponse | null = null
    if (row.response !== undefined && row.response !== null) {
      const checked = validateBinResponse(row.response, row.id)
      if (checked.ok) response = checked.value
    }
    if (requests.length === 0 && !response) continue
    candidates.push({ id: row.id, bin: { requests, lastActivity, response } })
  }

  candidates.sort((a, b) => b.bin.lastActivity - a.bin.lastActivity)
  let bytes = 0
  for (const { id, bin } of candidates) {
    if (out.size >= WEBHOOK_MAX_BINS || out.has(id)) continue
    const size = binBytes(bin)
    if (bytes + size > WEBHOOK_MAX_TOTAL_BYTES) continue
    bytes += size
    out.set(id, bin)
  }
  return out
}

/** The persisted form: bins most recently active first, whole bins only, under the file cap. */
export function serializeBins(now = Date.now()): string {
  const ordered = [...bins.entries()]
    .filter(([, bin]) => now - bin.lastActivity <= WEBHOOK_BIN_TTL_MS)
    .sort((a, b) => b[1].lastActivity - a[1].lastActivity)
  const rows: string[] = []
  let size = 96
  for (const [id, bin] of ordered) {
    const row = JSON.stringify({ id, lastActivity: bin.lastActivity, response: bin.response, requests: bin.requests })
    if (size + row.length + 1 > WEBHOOK_MAX_FILE_BYTES) break
    rows.push(row)
    size += row.length + 1
  }
  return `{"v":${PERSIST_VERSION},"savedAt":${now},"bins":[${rows.join(',')}]}`
}

let persistPath: string | null = null
let loaded = false
let dirty = false
let flushTimer: ReturnType<typeof setTimeout> | null = null
let signalsHooked = false

/**
 * Persistence is on only inside the running site (Vite sets `import.meta.env.SSR`
 * in both the dev server and the built server). Under `tsx`, which the smoke
 * tests use, `import.meta.env` does not exist and the store stays memory-only, so
 * a test run can never write a file into `data/` or read a developer's bins.
 * `configurePersistence` is the explicit switch for a test that wants a file.
 */
function runtimeWantsPersistence(): boolean {
  try { return import.meta.env.SSR === true } catch { return false }
}

function defaultPath(): string {
  return join(process.cwd(), 'data', 'webhook-bins.json')
}

/** Point the store at a file (or null for memory-only) and load it now. Returns bins loaded. */
export function configurePersistence(path: string | null): number {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  dirty = false
  persistPath = path
  loaded = true
  bins.clear()
  totalBytes = 0
  if (!path) return 0
  loadFromDisk(path)
  hookSignals()
  return bins.size
}

function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  if (!runtimeWantsPersistence()) return
  persistPath = defaultPath()
  loadFromDisk(persistPath)
  hookSignals()
}

function loadFromDisk(path: string): void {
  try {
    // Refuse before reading: a file bigger than the cap is not ours.
    if (statSync(path).size > WEBHOOK_MAX_FILE_BYTES) return
    const restored = parsePersistedBins(readFileSync(path, 'utf-8'))
    for (const [id, bin] of restored) {
      bins.set(id, bin)
      totalBytes += binBytes(bin)
    }
  } catch {
    // First run, or an unreadable file: start empty rather than fail.
  }
}

function markDirty(): void {
  if (!persistPath) return
  dirty = true
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushWebhookBins()
  }, WEBHOOK_FLUSH_MS)
  ;(flushTimer as unknown as { unref?: () => void }).unref?.()
}

let flushChain: Promise<unknown> = Promise.resolve()

/**
 * Write the store now (atomic: a temp file, then a rename). A failure re-arms; it never throws.
 * Flushes run one at a time: two overlapping writes to the same temp file could
 * publish a half-written one.
 */
export function flushWebhookBins(): Promise<boolean> {
  const run = flushChain.then(flushOnce)
  flushChain = run
  return run
}

async function flushOnce(): Promise<boolean> {
  if (!persistPath || !dirty) return false
  const path = persistPath
  try {
    const text = serializeBins()
    dirty = false
    await mkdir(dirname(path), { recursive: true })
    await writeFile(`${path}.tmp`, text, { encoding: 'utf-8', mode: 0o600 })
    await rename(`${path}.tmp`, path)
    return true
  } catch (error) {
    // The capture store must never take the site down; memory still has the rows.
    dirty = true
    markDirty()
    console.error('[webhook] bin flush failed', error)
    return false
  }
}

function flushSync(): void {
  if (!persistPath || !dirty) return
  try {
    mkdirSync(dirname(persistPath), { recursive: true })
    // Its own temp name: an async flush may still be writing `.tmp`.
    writeFileSync(`${persistPath}.exit.tmp`, serializeBins(), { encoding: 'utf-8', mode: 0o600 })
    renameSync(`${persistPath}.exit.tmp`, persistPath)
    dirty = false
  } catch {
    // Shutting down: nothing left to retry with.
  }
}

/**
 * A deploy stops the old container with SIGTERM. Whatever arrived inside the
 * last debounce window would be lost, so write once, synchronously, and exit.
 * (The handler replaces the default action, and PID 1 in a container does not
 * get a default action, so it has to exit itself.)
 */
function hookSignals(): void {
  if (signalsHooked) return
  signalsHooked = true
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      flushSync()
      process.exit(signal === 'SIGINT' ? 130 : 0)
    })
  }
}
