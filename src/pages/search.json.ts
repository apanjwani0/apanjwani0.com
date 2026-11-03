export const prerender = false

import type { APIRoute } from 'astro'
import { buildSiteIndex, loadSiteConfigs } from '../lib/site-index'

// /search.json: the command palette's index. It is `buildSiteIndex` and nothing
// else, so it lists exactly the pages the sitemap does (a project entry points
// at its card on /projects), and a page kind added to one and forgotten in the
// other fails security:smoke instead of becoming unfindable.
//
// The keys are short on purpose (t title, u URL, k kind, d description, w
// synonyms): the browser downloads this once per visit. It is the same for every
// visitor and carries nothing about one, so it caches like a page. JSON.stringify
// escapes every quote and control character, and the palette only ever sets the
// text into the page with textContent.
export const GET: APIRoute = async ({ locals }) => {
  const entries = buildSiteIndex(await loadSiteConfigs(locals))
  const body = entries.map(({ t, u, k, d, w }) => ({ t, u, k, ...(d ? { d } : {}), ...(w ? { w } : {}) }))
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=600',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  })
}
