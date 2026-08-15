import type { APIRoute } from 'astro'
import { createSession } from '../../../lib/session'
import {
  ADMIN_LOGIN_LIMITS,
  BodyTooLargeError,
  adminNotFound,
  createRateLimiter,
  getAdminSecret,
  getRuntimeEnv,
  isAdminRequestAllowed,
  rateLimitKey,
  readLimitedJson,
  timingSafeEqualText,
} from '../../../lib/security'

export const prerender = false

// Dev-only route (isAdminRequestAllowed 404s in production), but it uses the
// shared bounded limiter rather than its own Map: the previous local version
// never evicted, so its keys — taken straight from a request header — could grow
// without limit. Same bug class as the one createRateLimiter exists to prevent.
const allowAttempt = createRateLimiter(ADMIN_LOGIN_LIMITS.windowMs, ADMIN_LOGIN_LIMITS.maxAttempts)

export const POST: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = getRuntimeEnv(locals)
  const secret = getAdminSecret(locals)

  if (!secret) {
    return new Response(null, { status: 404 })
  }

  if (!isAdminRequestAllowed()) return adminNotFound()

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

  // Only failures consume the budget — a correct password is proof of the
  // secret, not a guess, and counting successes locked out login-heavy E2E
  // flows (the old local limiter cleared itself on success for the same reason).
  // ponytail: in-memory per-isolate throttle; use Cloudflare WAF/KV if admin login traffic matters.
  if (!(await timingSafeEqualText(password, secret))) {
    const allowed = allowAttempt(rateLimitKey(request))
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Too many attempts' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil(ADMIN_LOGIN_LIMITS.windowMs / 1000)),
        },
      })
    }
    return new Response(JSON.stringify({ error: 'incorrect password' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

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
