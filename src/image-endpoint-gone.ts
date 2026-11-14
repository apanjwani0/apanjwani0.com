// Replaces Astro's /_image endpoint (astro.config.mjs → image.endpoint). Nothing
// imports astro:assets, so no page links to it, yet the stock endpoint would
// still resize any file under public/ for a stranger (about 7 s of CPU a request,
// and a different w/q dodges the edge cache). The route is kept, as Astro
// always registers one, but it answers 404 and does no work.
import type { APIRoute } from 'astro'

export const prerender = false

export const GET: APIRoute = () =>
  new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
