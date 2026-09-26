export const prerender = false

import type { APIRoute } from 'astro'
import { indexablePaths, loadSiteConfigs } from '../lib/site-index'
import { escapeHtml } from '../lib/escape'

// The sitemap is `indexablePaths` serialised, and nothing else. Which pages are
// real — blogs behind `isBlogsPublic`, games behind `isPlayableGame`, learnings
// behind `isPublishedLearning`, live tools only, Driftfield's modes behind
// `isDriftfieldPublic`, cross-posted blog entries skipped — is decided once in
// src/lib/site-index.ts, which the command palette's index and the 404's
// suggestions read too, so no page can be listed here and missing there.
export const GET: APIRoute = async ({ locals }) => {
  const configs = await loadSiteConfigs(locals)
  const base = configs.site.url.replace(/\/$/, '')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexablePaths(configs)
  .map(u => {
    // Escaped, not interpolated raw. The five characters escapeHtml handles are
    // exactly XML's predefined entities, and a single `&` anywhere in a slug makes
    // the whole document unparseable — which fails closed on the entire site's
    // indexing, not just on the one bad URL.
    const lastmod = u.lastmod ? `<lastmod>${escapeHtml(u.lastmod)}</lastmod>` : ''
    return `  <url><loc>${escapeHtml(`${base}${u.path}`)}</loc>${lastmod}</url>`
  })
  .join('\n')}
</urlset>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  })
}
