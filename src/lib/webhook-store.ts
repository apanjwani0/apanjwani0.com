/**
 * In-memory capture store for the Webhook Inspector tool.
 *
 * This is the first tool on the site that uses the server the app already pays
 * for: a bin receives real HTTP requests from other software (a webhook sender,
 * a curl one-liner, a client under test) and the tool page polls them back out.
 *
 * Storage is a process-local Map — deliberately. Production runs the
 * `@astrojs/node` adapter as a single container (see AGENTS.md), so module state
 * is shared across requests and survives until the next deploy; there is no KV
 * binding on Node. Bins are ephemeral by nature (webhook.cool drops them after a
 * week of inactivity); here they are swept after a few hours and capped hard so
 * a public endpoint can never grow memory without bound. On Cloudflare Workers,
 * where isolates don't share module state, this would need KV/Durable Objects —
 * but the Node origin is the deploy target, and this keeps the tool dependency-
 * free and correct there.
 */

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
  bodyTruncated: boolean
  /** Raw body byte length before any truncation. */
  size: number
  receivedAt: number
}

interface Bin {
  requests: CapturedRequest[]
  lastActivity: number
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

const bins = new Map<string, Bin>()
// Running sum of the (approximate) bytes held across all bins, kept in step with
// every insert / trim / evict so enforcing the global ceiling is O(1) to check.
let totalBytes = 0

/** Approximate stored size of one request: body + header text + fixed overhead. */
function reqBytes(req: CapturedRequest): number {
  let n = req.bodyText.length + 256
  for (const h of req.headers) n += h.name.length + h.value.length
  return n
}

/** Delete a bin and decrement the byte total by everything it held. */
function dropBin(id: string): void {
  const bin = bins.get(id)
  if (!bin) return
  for (const r of bin.requests) totalBytes -= reqBytes(r)
  bins.delete(id)
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

/** Drop expired bins and, if still over the cap, evict the least-recently-used. */
function sweep(now: number): void {
  for (const [id, bin] of bins) {
    if (now - bin.lastActivity > WEBHOOK_BIN_TTL_MS) dropBin(id)
  }
  if (bins.size > WEBHOOK_MAX_BINS) {
    const ordered = [...bins.entries()].sort((a, b) => a[1].lastActivity - b[1].lastActivity)
    const excess = bins.size - WEBHOOK_MAX_BINS
    for (let i = 0; i < excess; i += 1) dropBin(ordered[i][0])
  }
}

/** Record one captured request against a bin, creating the bin on first hit. */
export function recordRequest(binId: string, req: CapturedRequest): void {
  const now = Date.now()
  sweep(now)
  let bin = bins.get(binId)
  if (!bin) {
    bin = { requests: [], lastActivity: now }
    bins.set(binId, bin)
  }
  // Newest first; trim the tail so a chatty sender can't grow the bin unbounded.
  bin.requests.unshift(req)
  totalBytes += reqBytes(req)
  while (bin.requests.length > WEBHOOK_MAX_REQUESTS_PER_BIN) {
    const dropped = bin.requests.pop()
    if (dropped) totalBytes -= reqBytes(dropped)
  }
  bin.lastActivity = now

  // Global memory ceiling: if the store is over budget, evict least-recently-used
  // bins — never the one just written — until back under. Bounds total RAM no
  // matter how requests are spread across bins.
  if (totalBytes > WEBHOOK_MAX_TOTAL_BYTES) {
    const ordered = [...bins.entries()]
      .filter(([id]) => id !== binId)
      .sort((a, b) => a[1].lastActivity - b[1].lastActivity)
    for (const [id] of ordered) {
      if (totalBytes <= WEBHOOK_MAX_TOTAL_BYTES) break
      dropBin(id)
    }
  }
}

/** List captured requests for a bin, newest first. Empty for unknown bins. */
export function listRequests(binId: string): CapturedRequest[] {
  sweep(Date.now())
  return bins.get(binId)?.requests ?? []
}

/** Clear a bin's requests (keeps the bin alive). Returns true if it existed. */
export function clearBin(binId: string): boolean {
  const bin = bins.get(binId)
  if (!bin) return false
  for (const r of bin.requests) totalBytes -= reqBytes(r)
  bin.requests = []
  bin.lastActivity = Date.now()
  return true
}
