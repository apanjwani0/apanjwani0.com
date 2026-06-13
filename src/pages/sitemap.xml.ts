export const prerender = false

import type { APIRoute } from 'astro'
import { getSite, getPosts, getGames } from '../lib/config'

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

  // Static pages
  const staticPages = [
    '/',
    '/experience',
    '/projects',
    '/blogs',
    '/games',
    '/tools',
    '/tools/md-enhanced',
  ]

  // Dynamic pages from config
  const blogPages = posts.map(p => {
    const slug = p.href.replace(/^\/?(blogs\/)?/, '')
    return `/blogs/${slug}`
  })

  const gamePages = games.map(g => `/games/${g.slug}`)

  const allPages = [...staticPages, ...blogPages, ...gamePages]

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages.map(page => `  <url><loc>${normalize(page)}</loc></url>`).join('\n')}
</urlset>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
