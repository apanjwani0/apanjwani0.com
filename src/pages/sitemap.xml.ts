export const prerender = false

import type { APIRoute } from 'astro'
import { getSite, getPosts, getGames, getTools, getLearnings, isBlogsPublic } from '../lib/config'
import { isPlayableGame } from '../lib/games'
import { isPublishedLearning } from '../lib/learnings'
import { DRIFTFIELD_MODES, DRIFTFIELD_SLUG, isDriftfieldPublic } from '../lib/driftfield'
import { escapeHtml } from '../lib/escape'

export const GET: APIRoute = async ({ locals }) => {
  const site = await getSite(locals)
  const blogsPublic = isBlogsPublic(site)
  const posts = await getPosts(locals)
  // isPlayableGame, not `enabled && interactive`: a game flagged interactive but
  // with no component registered renders "coming soon" behind a noindex, and
  // listing it here would have the sitemap contradict the page's own robots meta.
  const games = (await getGames(locals)).filter(isPlayableGame)
  const tools = await getTools(locals)
  // isPublishedLearning, not `published`: an entry ticked published with an empty
  // body renders nothing behind a noindex, so listing it here would have the
  // sitemap contradict the page — the same trap isPlayableGame closes for games.
  const learnings = (await getLearnings(locals)).filter(isPublishedLearning)
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
  const latestLearningDate = learnings.reduce((max, l) => (l.date > max ? l.date : max), '')

  // Static pages
  const staticPages: SitemapUrl[] = [
    { loc: '/' },
    { loc: '/projects' },

    { loc: '/learnings', lastmod: latestLearningDate || undefined },
    { loc: '/games' },
    { loc: '/tools' },
  ]

  // Dynamic pages from config. A post's href may be a full external URL (a
  // cross-posted piece) — that page is not ours to sitemap, and deriving a slug
  // from it would emit a bogus `/blogs/https://…` entry, so external posts are
  // skipped rather than normalised.
  const blogPages: SitemapUrl[] = (blogsPublic ? posts : [])
    .filter(p => !/^https?:\/\//i.test(p.href))
    .map(p => {
      const slug = p.href.replace(/^\/?(blogs\/)?/, '')
      return { loc: `/blogs/${slug}`, lastmod: p.date }
    })

  const learningPages: SitemapUrl[] = learnings.map(l => ({
    loc: `/learnings/${l.slug}`,
    lastmod: l.date,
  }))

  const gamePages: SitemapUrl[] = games.map(g => ({ loc: `/games/${g.slug}` }))

  // Only live tools have their own crawlable detail route (wip/external/disabled don't).
  const toolPages: SitemapUrl[] = tools
    .filter(t => t.status === 'live')
    .map(t => ({ loc: `/tools/${t.slug}` }))

  // Driftfield's modes are real routes, not query params, precisely so they can
  // appear here — one indexable page per engine is the whole reason the six were
  // merged into a tool rather than deleted. Listed only when the hub itself is
  // live, so the sitemap cannot advertise modes of a tool that is not published.
  const driftfieldPages: SitemapUrl[] = isDriftfieldPublic(tools)
    ? DRIFTFIELD_MODES.map(m => ({ loc: `/tools/${DRIFTFIELD_SLUG}/${m.slug}` }))
    : []

  const allPages = [
    ...staticPages, ...blogPages, ...learningPages,
    ...gamePages, ...toolPages, ...driftfieldPages,
  ]

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages
  .map(u => {
    // Escaped, not interpolated raw. The five characters escapeHtml handles are
    // exactly XML's predefined entities, and a single `&` anywhere in a slug makes
    // the whole document unparseable — which fails closed on the entire site's
    // indexing, not just on the one bad URL.
    const lastmod = u.lastmod ? `<lastmod>${escapeHtml(u.lastmod)}</lastmod>` : ''
    return `  <url><loc>${escapeHtml(normalize(u.loc))}</loc>${lastmod}</url>`
  })
  .join('\n')}
</urlset>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  })
}
