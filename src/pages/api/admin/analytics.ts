import type { APIRoute } from 'astro'
import { readAnalyticsAggregates, summarizeAnalytics } from '../../../lib/analytics'
import { validateSession } from '../../../lib/session'
import {
  adminNotFound,
  getAdminSecret,
  getRuntimeEnv,
  getSessionToken,
  isAdminRequestAllowed,
} from '../../../lib/security'

export const prerender = false

export const GET: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = getRuntimeEnv(locals)
  if (!isAdminRequestAllowed(request, locals)) return adminNotFound()

  const secret = getAdminSecret(locals)
  const token = getSessionToken(request)
  const bypassAuth = import.meta.env.DEV && !secret
  if (!bypassAuth && !(await validateSession(token, runtimeEnv?.SITE_CONFIG))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const rows = summarizeAnalytics(await readAnalyticsAggregates(locals))
  return new Response(JSON.stringify({ rows }), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
  })
}
