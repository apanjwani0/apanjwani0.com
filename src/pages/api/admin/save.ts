import type { APIRoute } from 'astro'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { validateSession } from '../../../lib/session'
import { isConfigType, validateConfigData } from '../../../lib/config-schema'
import {
  BodyTooLargeError,
  adminNotFound,
  getAdminSecret,
  getRuntimeEnv,
  getSessionToken,
  isAdminRequestAllowed,
  readLimitedJson,
} from '../../../lib/security'

export const prerender = false

// Dev:        intercepted by Vite middleware in astro.config.mjs (writes src/config/*.ts + HMR)
// Production Node.js (Docker/Pi/VPS): writes to data/{type}.json on the filesystem
// Production Cloudflare Workers:      writes to KV binding SITE_CONFIG

export const POST: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = getRuntimeEnv(locals)
  if (!isAdminRequestAllowed(request, locals)) return adminNotFound()

  // Auth
  const secret = getAdminSecret(locals)
  const token = getSessionToken(request)
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
    const body = await readLimitedJson(request) as { type?: unknown; data?: unknown }
    if (typeof body?.type !== 'string' || body.data === undefined) throw new Error()
    type = body.type
    data = body?.data
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof BodyTooLargeError ? 'Request body is too large.' : 'Invalid body — expected { type, data }' }), {
      status: error instanceof BodyTooLargeError ? 413 : 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!isConfigType(type)) {
    return new Response(JSON.stringify({ error: `Unknown type: ${type}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!validateConfigData(type, data)) {
    return new Response(JSON.stringify({ error: `Invalid ${type} data` }), {
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
    console.error('[admin/save]', e)
    return new Response(JSON.stringify({ error: 'Write failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
