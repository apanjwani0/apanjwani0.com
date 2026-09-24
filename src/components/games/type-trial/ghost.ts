/**
 * Type Trial — ghost-replay permalinks.
 *
 * A finished run serialises its per-character timings into a compact token that
 * rides in the URL FRAGMENT (#ghost=…), so the replay never reaches server logs
 * or Referer headers — the same privacy posture as the Webhook Inspector share
 * link. Opening the link races a ghost caret over the same passage: state that
 * outlives the tab plus a permalink someone can send a colleague, with no
 * server, no storage and no identity involved.
 *
 * This module is deliberately separate from the component (see AGENTS.md — "a
 * tool's claims live in a module, not in the component") so security:smoke can
 * exercise the real encode/decode paths: round-trips, monotonicity, the delta
 * clamp, the total-duration cap, token-size and count bounds, and fingerprint
 * verification against the passage. Everything here is pure and dependency-free
 * so it bundles into the browser chunk and imports into Node (the smoke test)
 * equally well.
 *
 * Token format (dot-separated, all parts validated on decode):
 *
 *   1.<kind>.<fingerprint8>.<acc>.<data>
 *
 *   version      "1" — anything else is rejected, never guessed at.
 *   kind         "d" + YYYY-MM-DD for a daily run, or "q"/"c"/"n" + list index
 *                for a practice category (quotes / code / numbers).
 *   fingerprint8 8 hex chars of FNV-1a over the passage text. The passage is
 *                NOT in the token — the opener re-derives it (daily lib or the
 *                practice list) and the fingerprint proves both sides mean the
 *                same text. A pool edit after minting fails closed with an
 *                honest "text changed" message instead of racing wrong text.
 *   acc          integer accuracy 0–100 (display only — not derivable from the
 *                timeline, which records only first-correct times).
 *   data         base64url of LEB128 varints: per-character deltas of the
 *                elapsed time at which the correct prefix first reached each
 *                length, quantised to 10 ms. Monotonic by construction, so
 *                deltas are non-negative; typical typing is one byte per char.
 *
 * Bounds (every dimension, per AGENTS.md): token length, mark count, per-delta
 * clamp at mint AND reject-over-cap at decode (a decoded over-cap delta can
 * only be a hand-built token, since minting clamps), and a total-duration cap.
 * decodeGhostToken never throws — a malformed link costs the ghost, not the
 * game.
 */

export const GHOST_VERSION = 1
/** Hard ceiling on a token before any parsing — a fragment, not a file drop. */
export const GHOST_MAX_TOKEN_CHARS = 4096
/** More marks than any passage in either pool could need. */
export const GHOST_MAX_MARKS = 400
/** A ghost frozen longer than this between two characters is a broken share —
 *  minting clamps to it, decoding rejects past it. */
export const GHOST_MAX_DELTA_MS = 60_000
/** No replay runs longer than half an hour. */
export const GHOST_MAX_TOTAL_MS = 30 * 60_000

/** Timeline resolution — a caret does not need sub-10ms placement, and the
 *  quantisation is what keeps most deltas to a single varint byte. */
const QUANT_MS = 10

export type GhostKind = 'daily' | 'quotes' | 'code' | 'numbers'

const KIND_LETTER: Record<GhostKind, string> = {
  daily: 'd', quotes: 'q', code: 'c', numbers: 'n',
}
const LETTER_KIND: Record<string, GhostKind> = {
  d: 'daily', q: 'quotes', c: 'code', n: 'numbers',
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export interface DecodedGhost {
  kind: GhostKind
  /** UTC day for a daily run, null for practice. */
  day: string | null
  /** Index into the practice list for that category, 0 for daily. */
  index: number
  /** 8 hex chars — checked against the resolved passage in verifyGhostPassage. */
  fingerprint: string
  /** Accuracy 0–100, display only. */
  acc: number
  /** Absolute elapsed ms at which each character was first correct. Monotonic. */
  marks: number[]
}

export interface GhostRunInput {
  kind: GhostKind
  day: string | null
  index: number
  passage: string
  acc: number
  marks: number[]
}

/** FNV-1a, 8 lowercase hex chars — the passage identity check. */
export function passageFingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/* ── base64url over raw bytes (browser + Node, no Buffer) ── */

function b64urlEncode(bytes: number[]): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(text: string): number[] | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  try {
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const out: number[] = []
    for (let i = 0; i < bin.length; i += 1) out.push(bin.charCodeAt(i))
    return out
  } catch {
    return null
  }
}

/* ── LEB128 varints ── */

function pushVarint(bytes: number[], value: number): void {
  let v = value
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  bytes.push(v)
}

/** Reads every varint in `bytes`; null on a trailing incomplete varint. */
function readVarints(bytes: number[]): number[] | null {
  const out: number[] = []
  let v = 0
  let shift = 0
  for (const b of bytes) {
    v |= (b & 0x7f) << shift
    if (b & 0x80) {
      shift += 7
      if (shift > 28) return null // would overflow — no legal delta needs it
    } else {
      out.push(v >>> 0)
      v = 0
      shift = 0
    }
  }
  if (shift !== 0) return null
  return out
}

/**
 * Mint a token from a finished run, or null if the run is out of bounds
 * (empty, too many marks, non-finite times, or longer than the total cap
 * after clamping). Deltas beyond the per-character clamp are clamped, not
 * rejected — a long mid-run stare should cost the stare, not the link.
 */
export function encodeGhostToken(run: GhostRunInput): string | null {
  const { kind, passage, marks } = run
  if (!(kind in KIND_LETTER)) return null
  if (marks.length === 0 || marks.length > GHOST_MAX_MARKS) return null
  if (marks.length !== passage.length) return null
  const acc = Math.round(run.acc)
  if (!Number.isFinite(acc) || acc < 0 || acc > 100) return null

  let kindPart: string
  if (kind === 'daily') {
    if (typeof run.day !== 'string' || !DAY_RE.test(run.day)) return null
    kindPart = 'd' + run.day
  } else {
    if (!Number.isInteger(run.index) || run.index < 0 || run.index > 999) return null
    kindPart = KIND_LETTER[kind] + String(run.index)
  }

  const bytes: number[] = []
  let prev = 0
  let total = 0
  for (const mark of marks) {
    if (!Number.isFinite(mark) || mark < prev) return null // not a real timeline
    const delta = Math.min(mark - prev, GHOST_MAX_DELTA_MS)
    const q = Math.round(delta / QUANT_MS)
    total += q * QUANT_MS
    if (total > GHOST_MAX_TOTAL_MS) return null
    pushVarint(bytes, q)
    prev = mark
  }

  return `${GHOST_VERSION}.${kindPart}.${passageFingerprint(passage)}.${acc}.${b64urlEncode(bytes)}`
}

/**
 * Parse a token back into a ghost, or null. Never throws. Structural only —
 * the fingerprint is checked against a real passage by verifyGhostPassage,
 * because this module deliberately does not know either passage pool.
 */
export function decodeGhostToken(token: unknown): DecodedGhost | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > GHOST_MAX_TOKEN_CHARS) return null
  const parts = token.split('.')
  if (parts.length !== 5) return null
  const [version, kindPart, fingerprint, accPart, data] = parts

  if (version !== String(GHOST_VERSION)) return null
  if (!/^[0-9a-f]{8}$/.test(fingerprint)) return null
  if (!/^\d{1,3}$/.test(accPart)) return null
  const acc = Number(accPart)
  if (acc > 100) return null

  const kind = LETTER_KIND[kindPart[0]]
  if (!kind) return null
  let day: string | null = null
  let index = 0
  if (kind === 'daily') {
    day = kindPart.slice(1)
    if (!DAY_RE.test(day)) return null
  } else {
    const idxPart = kindPart.slice(1)
    if (!/^\d{1,3}$/.test(idxPart)) return null
    index = Number(idxPart)
  }

  const bytes = b64urlDecode(data)
  if (!bytes) return null
  const deltas = readVarints(bytes)
  if (!deltas) return null
  if (deltas.length === 0 || deltas.length > GHOST_MAX_MARKS) return null

  const marks: number[] = []
  let t = 0
  for (const q of deltas) {
    const delta = q * QUANT_MS
    // Minting clamps at the per-character cap, so an over-cap delta can only
    // be a hand-built token — reject rather than repair.
    if (delta > GHOST_MAX_DELTA_MS) return null
    t += delta
    if (t > GHOST_MAX_TOTAL_MS) return null
    marks.push(t)
  }

  return { kind, day, index, fingerprint, acc, marks }
}

/** Does this ghost really belong to this passage text? */
export function verifyGhostPassage(ghost: DecodedGhost, passage: string): boolean {
  return ghost.marks.length === passage.length && ghost.fingerprint === passageFingerprint(passage)
}

/** How many characters the ghost had correct at `elapsedMs` (binary search). */
export function ghostProgressAt(marks: number[], elapsedMs: number): number {
  let lo = 0
  let hi = marks.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (marks[mid] <= elapsedMs) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Total replay duration — the time the ghost finishes at. */
export function ghostDurationMs(marks: number[]): number {
  return marks.length ? marks[marks.length - 1] : 0
}

/** Net WPM of a fully-correct run of `chars` characters in `durationMs`. */
export function ghostWpm(chars: number, durationMs: number): number {
  if (durationMs <= 0) return 0
  return Math.round((chars / 5) / (durationMs / 60_000))
}
