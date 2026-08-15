const ADMIN_MAX_BODY_BYTES = 1_000_000
const ADMIN_LOGIN_WINDOW_MS = 60_000
const ADMIN_LOGIN_MAX_ATTEMPTS = 10

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class BodyTooLargeError extends Error {}
export class InvalidJsonError extends Error {}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function hasUnsafeUrlChars(value: string): boolean {
  return /[\u0000-\u001F\u007F\s]/.test(value)
}

export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || hasUnsafeUrlChars(raw)) return null

  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

export function safeInternalPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || hasUnsafeUrlChars(raw)) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  return raw
}

export function safeMarkdownUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || hasUnsafeUrlChars(raw)) return null
  if (raw.startsWith('#')) return raw
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  if (raw.startsWith('./') || raw.startsWith('../')) return raw

  try {
    const url = new URL(raw)
    if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:') return url.href
  } catch {
    return null
  }

  return null
}

export function appendPathToExternalUrl(value: unknown, path: string): string | null {
  const safe = safeExternalUrl(value)
  if (!safe) return null
  const url = new URL(safe)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
  url.search = ''
  url.hash = ''
  return url.href
}

export function getRuntimeEnv(locals: unknown): any {
  return (locals as any).runtime?.env
}

export function getAdminSecret(locals: unknown): string | undefined {
  const runtimeEnv = getRuntimeEnv(locals)
  const secret = runtimeEnv?.ADMIN_SECRET ?? process.env.ADMIN_SECRET ?? import.meta.env.ADMIN_SECRET
  return typeof secret === 'string' && secret ? secret : undefined
}

// UNTRUSTED. Every "client IP" header is written by whoever sent the request;
// cf-connecting-ip is only authoritative for traffic that actually passed through
// Cloudflare, and the origin is reachable on its own public IP. Use this for
// coarse, non-security purposes (dev rate-limit bucketing) — never as an
// authorization decision. See isAdminRequestAllowed.
export function getClientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? ''
}

// The admin surface does not exist in production — the panel, login, logout,
// save and analytics routes all 404 there.
//
// An IP allowlist cannot gate this: every candidate header (x-forwarded-for,
// cf-connecting-ip) is attacker-controlled for anyone who reaches the origin
// directly, so the allowlist was authenticating a value the caller chose. The
// only sound fix is to remove the surface: config is edited in dev, where the
// Vite admin-save middleware writes src/config/*.ts, and ships through git.
// Nothing that cannot be reached can be brute-forced, CSRF'd, or spoofed past.
export function isAdminRequestAllowed(): boolean {
  return import.meta.env.DEV
}

export function adminNotFound(): Response {
  return new Response(null, { status: 404, statusText: 'Not Found' })
}

export function getSessionToken(request: Request): string | undefined {
  return request.headers.get('cookie')?.match(/(?:^|;\s*)__admin_session=([^;]+)/)?.[1]
}

export async function readLimitedJson(request: Request, maxBytes = ADMIN_MAX_BODY_BYTES): Promise<unknown> {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(length) && length > maxBytes) throw new BodyTooLargeError()

  const reader = request.body?.getReader()
  if (!reader) throw new InvalidJsonError()

  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new BodyTooLargeError()
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return JSON.parse(decoder.decode(bytes))
  } catch {
    throw new InvalidJsonError()
  }
}

export async function timingSafeEqualText(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ])
  const leftBytes = new Uint8Array(left)
  const rightBytes = new Uint8Array(right)
  let diff = 0
  for (let i = 0; i < leftBytes.length; i += 1) diff |= leftBytes[i] ^ rightBytes[i]
  return diff === 0
}

export const ADMIN_LOGIN_LIMITS = {
  windowMs: ADMIN_LOGIN_WINDOW_MS,
  maxAttempts: ADMIN_LOGIN_MAX_ATTEMPTS,
}

/**
 * Reject traffic that did not come through Cloudflare.
 *
 * The origin is a public IP with port 80 open, so every Cloudflare protection —
 * WAF, rate limiting, bot management, caching — is optional for anyone who
 * resolves the address, and every "client IP" header is caller-chosen on that
 * path. The real fix is at the firewall (see scripts/lock-origin-to-cloudflare.sh);
 * this is the in-app half, and it still holds if a firewall rule is ever lost.
 *
 * Set ORIGIN_SHARED_SECRET and add a matching Cloudflare Transform Rule that
 * injects the same value as `x-origin-auth`. Unset or empty, this is a no-op — so
 * enabling it is deliberate and a missing rule can never black-hole the site by
 * accident.
 *
 * `secret` is passed in rather than read here so the check is testable.
 */
export async function isFromCloudflare(
  request: Request,
  secret = process.env.ORIGIN_SHARED_SECRET,
): Promise<boolean> {
  if (!secret) return true
  const presented = request.headers.get('x-origin-auth')
  if (!presented || presented.length !== secret.length) return false
  return timingSafeEqualText(presented, secret)
}

/** Distinct keys a limiter will track before it starts evicting. */
const RATE_LIMIT_MAX_KEYS = 5_000

/**
 * Fixed-window rate limiter for public, unauthenticated endpoints.
 *
 * Bounded on purpose. The obvious implementation — a Map keyed by client IP that
 * is only ever written — is itself a memory-exhaustion vector: the key comes from
 * a request header, so anyone who can reach the origin can mint unlimited distinct
 * keys and grow the Map until the process dies. Expired entries are swept and the
 * map is hard-capped, so the limiter costs O(RATE_LIMIT_MAX_KEYS) no matter what
 * arrives.
 *
 * Per-process, so with multiple containers the effective limit multiplies. It is a
 * floor against a single abusive source, not a quota — Cloudflare's own rate
 * limiting is the real control.
 *
 * ponytail: fixed window (a burst can straddle the boundary and see 2x); use a
 * sliding window if that ever matters.
 */
export function createRateLimiter(windowMs: number, maxHits: number) {
  const hits = new Map<string, { count: number; resetAt: number }>()

  return function allow(key: string, now = Date.now()): boolean {
    const current = hits.get(key)
    if (!current || current.resetAt <= now) {
      if (hits.size >= RATE_LIMIT_MAX_KEYS) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
        // Still full means every entry is live — drop the oldest few so a flood of
        // fresh keys degrades the limiter instead of the process.
        if (hits.size >= RATE_LIMIT_MAX_KEYS) {
          let toDrop = Math.ceil(RATE_LIMIT_MAX_KEYS / 10)
          for (const k of hits.keys()) {
            hits.delete(k)
            if (--toDrop <= 0) break
          }
        }
      }
      hits.set(key, { count: 1, resetAt: now + windowMs })
      return true
    }

    current.count += 1
    return current.count <= maxHits
  }
}

/**
 * Rate-limit bucket for a request.
 *
 * Falls back to a single shared bucket when no client IP is present, so
 * unattributable traffic is throttled together rather than each request looking
 * like a brand-new client (which is what makes a per-IP limiter trivially
 * bypassable). See getClientIp — this value is untrusted; it buckets traffic, it
 * never authorizes it.
 */
export function rateLimitKey(request: Request): string {
  return getClientIp(request) || 'unattributed'
}
