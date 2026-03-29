import type { APIRoute } from 'astro'
import { deleteSession } from '../../../lib/session'

export const prerender = false

export const POST: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = (locals as any).runtime?.env
  const cookie = request.headers.get('cookie') ?? ''
  const token = cookie.match(/(?:^|;\s*)__admin_session=([^;]+)/)?.[1]
  await deleteSession(token, runtimeEnv?.SITE_CONFIG)

  const secure = !import.meta.env.DEV ? '; Secure' : ''
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/admin',
      'Set-Cookie': `__admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
    },
  })
}
