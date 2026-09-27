import type { APIRoute } from 'astro'
import { deleteSession } from '../../../lib/session'
import { adminNotFound, getRuntimeEnv, getSessionToken, isAdminRequestAllowed } from '../../../lib/security'

export const prerender = false

export const POST: APIRoute = async ({ request, locals }) => {
  if (!isAdminRequestAllowed()) return adminNotFound()

  const runtimeEnv = getRuntimeEnv(locals)
  const token = getSessionToken(request)
  await deleteSession(token, runtimeEnv?.SITE_CONFIG)

  const isHttps = request.headers.get('x-forwarded-proto') === 'https' || new URL(request.url).protocol === 'https:'
  const secure = isHttps ? '; Secure' : ''
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/admin',
      'Set-Cookie': `__admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
    },
  })
}
