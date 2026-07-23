export const prerender = false

import type { APIRoute } from 'astro'
import { getSite, getPosts, getGames } from '../lib/config'
import { tools } from '../config/tools'

export const GET: APIRoute = async ({ locals }) => {
  const site = await getSite(locals)
  const posts = await getPosts(locals)
  const games = (await getGames(locals)).filter(g => g.enabled)
  const base = site.url.replace(/\/$/, '')

  const normalize = (href: string) => {
    if (href.startsWith('http')) return href
    if (href.startsWith('/')) return `${base}${href}`
    return `${base}/${href}`
  }

  // A sitemap entry: a location plus an optional last-modified date (W3C
  // YYYY-MM-DD). Only blog posts carry a real authored date, so only they emit
  // <lastmod> — search engines use it to prioritise re-crawls.
  type SitemapUrl = { loc: string; lastmod?: string }

  // Static pages
  const staticPages: SitemapUrl[] = [
    { loc: '/' },
    { loc: '/projects' },
    { loc: '/blogs' },
    { loc: '/games' },
    { loc: '/tools' },
  ]

  // Dynamic pages from config
  const blogPages: SitemapUrl[] = posts.map(p => {
    const slug = p.href.replace(/^\/?(blogs\/)?/, '')
    return { loc: `/blogs/${slug}`, lastmod: p.date }
  })

  const gamePages: SitemapUrl[] = games.map(g => ({ loc: `/games/${g.slug}` }))

  // Only live tools have their own crawlable detail route (wip/external/disabled don't).
  const toolPages: SitemapUrl[] = tools
    .filter(t => t.status === 'live')
    .map(t => ({ loc: `/tools/${t.slug}` }))

  const allPages = [...staticPages, ...blogPages, ...gamePages, ...toolPages]

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages
  .map(u => {
    const lastmod = u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''
    return `  <url><loc>${normalize(u.loc)}</loc>${lastmod}</url>`
  })
  .join('\n')}
</urlset>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
