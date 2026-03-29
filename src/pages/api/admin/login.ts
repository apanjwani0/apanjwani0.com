import type { APIRoute } from 'astro'
import { createSession } from '../../../lib/session'

export const prerender = false

export const POST: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = (locals as any).runtime?.env
  const secret = runtimeEnv?.ADMIN_SECRET ?? process.env.ADMIN_SECRET ?? import.meta.env.ADMIN_SECRET

  if (!secret) {
    return new Response(JSON.stringify({ error: 'Server misconfigured — ADMIN_SECRET not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let password: string
  try {
    const body = await request.json()
    password = body?.password
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (password !== secret) {
    return new Response(JSON.stringify({ error: 'incorrect password' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const token = await createSession(runtimeEnv?.SITE_CONFIG)
  const secure = !import.meta.env.DEV ? '; Secure' : ''
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `__admin_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure}`,
    },
  })
}
