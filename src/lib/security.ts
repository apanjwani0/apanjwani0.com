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

// Only cf-connecting-ip is trustworthy here: Cloudflare overwrites it on every
// request, while x-forwarded-for is client-authored and was letting anyone who
// could reach the Node origin directly forge a whitelisted IP. Returning '' when
// it is absent fails the whitelist closed, which is what unproxied traffic
// already did before it learned to send the header.
export function getClientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? ''
}

export function isAdminRequestAllowed(request: Request, locals: unknown): boolean {
  if (import.meta.env.DEV) return true

  const runtimeEnv = getRuntimeEnv(locals)
  const whitelist = (runtimeEnv?.ADMIN_IP_WHITELIST ?? process.env.ADMIN_IP_WHITELIST ?? import.meta.env.ADMIN_IP_WHITELIST ?? '')
    .split(',')
    .map((ip: string) => ip.trim())
    .filter(Boolean)

  return whitelist.includes(getClientIp(request))
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
