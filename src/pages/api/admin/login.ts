import type { APIRoute } from 'astro'
import { createSession } from '../../../lib/session'
import {
  ADMIN_LOGIN_LIMITS,
  BodyTooLargeError,
  adminNotFound,
  getAdminSecret,
  getClientIp,
  getRuntimeEnv,
  isAdminRequestAllowed,
  readLimitedJson,
  timingSafeEqualText,
} from '../../../lib/security'

export const prerender = false

const attempts = new Map<string, { count: number; resetAt: number }>()

function loginKey(request: Request): string {
  return getClientIp(request) || 'unknown'
}

function isRateLimited(request: Request): boolean {
  const now = Date.now()
  const key = loginKey(request)
  const current = attempts.get(key)

  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + ADMIN_LOGIN_LIMITS.windowMs })
    return false
  }

  current.count += 1
  return current.count > ADMIN_LOGIN_LIMITS.maxAttempts
}

function clearRateLimit(request: Request): void {
  attempts.delete(loginKey(request))
}

export const POST: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = getRuntimeEnv(locals)
  const secret = getAdminSecret(locals)

  if (!secret) {
    return new Response(null, { status: 404 })
  }

  if (!isAdminRequestAllowed(request, locals)) return adminNotFound()

  // ponytail: in-memory per-isolate throttle; use Cloudflare WAF/KV if admin login traffic matters.
  if (isRateLimited(request)) {
    return new Response(JSON.stringify({ error: 'Too many attempts' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.ceil(ADMIN_LOGIN_LIMITS.windowMs / 1000)),
      },
    })
  }

  let password = ''
  try {
    const body = await readLimitedJson(request) as { password?: unknown }
    password = typeof body?.password === 'string' ? body.password : ''
  } catch (error) {
    const tooLarge = error instanceof BodyTooLargeError
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: tooLarge ? 413 : 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!(await timingSafeEqualText(password, secret))) {
    return new Response(JSON.stringify({ error: 'incorrect password' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  clearRateLimit(request)
  const token = await createSession(runtimeEnv?.SITE_CONFIG)
  const isHttps = request.headers.get('x-forwarded-proto') === 'https' || new URL(request.url).protocol === 'https:'
  const secure = isHttps ? '; Secure' : ''
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `__admin_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure}`,
    },
  })
}
