import type { APIRoute } from 'astro'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import logger from '../../../lib/logger'
import { validateSession } from '../../../lib/session'

export const prerender = false

// Dev:        intercepted by Vite middleware in astro.config.mjs (writes src/config/*.ts + HMR)
// Production Node.js (Docker/Pi/VPS): writes to data/{type}.json on the filesystem
// Production Cloudflare Workers:      writes to KV binding SITE_CONFIG

export const POST: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = (locals as any).runtime?.env

  // Auth
  const secret = runtimeEnv?.ADMIN_SECRET ?? process.env.ADMIN_SECRET ?? import.meta.env.ADMIN_SECRET
  const cookie = request.headers.get('cookie') ?? ''
  const token = cookie.match(/(?:^|;\s*)__admin_session=([^;]+)/)?.[1]
  const bypassAuth = import.meta.env.DEV && !secret
  if (!bypassAuth && !(await validateSession(token, runtimeEnv?.SITE_CONFIG))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Parse body
  let type: string, data: unknown
  try {
    const body = await request.json()
    type = body?.type
    data = body?.data
    if (!type || data === undefined) throw new Error()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid body — expected { type, data }' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const allowed = ['site', 'projects', 'experience', 'writing']
  if (!allowed.includes(type)) {
    return new Response(JSON.stringify({ error: `Unknown type: ${type}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const kv = runtimeEnv?.SITE_CONFIG
    if (kv) {
      // Cloudflare Workers — write to KV
      await kv.put(type, JSON.stringify(data))
    } else {
      // Node.js — write to data/{type}.json
      const dataDir = join(process.cwd(), 'data')
      await mkdir(dataDir, { recursive: true })
      await writeFile(join(dataDir, `${type}.json`), JSON.stringify(data, null, 2), 'utf-8')
    }
  } catch (e: unknown) {
    logger.error('[admin/save]', e)
    return new Response(JSON.stringify({ error: 'Write failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
