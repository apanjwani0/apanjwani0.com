export const prerender = false

import type { APIRoute } from 'astro'
import { getSite, getPosts, getGames, getTools } from '../lib/config'
import { isPlayableGame } from '../lib/games'

export const GET: APIRoute = async ({ locals }) => {
  const site = await getSite(locals)
  const posts = await getPosts(locals)
  // isPlayableGame, not `enabled && interactive`: a game flagged interactive but
  // with no component registered renders "coming soon" behind a noindex, and
  // listing it here would have the sitemap contradict the page's own robots meta.
  const games = (await getGames(locals)).filter(isPlayableGame)
  const tools = await getTools(locals)
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

  // The /blogs hub changes whenever a post is added or edited, so stamp it with
  // the newest authored post date — a freshness signal for re-crawls, mirroring
  // the per-post <lastmod> below. (ISO YYYY-MM-DD compares correctly as strings.)
  const latestPostDate = posts.reduce((max, p) => (p.date > max ? p.date : max), '')

  // Static pages
  const staticPages: SitemapUrl[] = [
    { loc: '/' },
    { loc: '/projects' },
    { loc: '/blogs', lastmod: latestPostDate || undefined },
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
    },
  })
}
