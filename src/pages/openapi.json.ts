export const prerender = false

import type { APIRoute } from 'astro'
import { getSite } from '../lib/config'
import { buildOpenApi } from '../lib/openapi'

// /openapi.json: the public API as an OpenAPI 3.1 document, generated from
// src/lib/openapi.ts (which the MCP tool schemas read too). It sits outside
// /api/ because robots.txt disallows that prefix for crawlers. No Cache-Control
// here: like a page, it takes the middleware's default, so the edge may hold it.
export const GET: APIRoute = async ({ locals }) => {
  const site = await getSite(locals)
  return new Response(JSON.stringify(buildOpenApi(site.url), null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
