/**
 * The site's pages, derived once: what exists, what it is called, and where it
 * lives.
 *
 * Two outputs from one pass over the config, and every page kind reads its
 * existing indexing predicate (AGENTS.md, "Indexing") rather than a local
 * approximation of it:
 *
 *   - `indexablePaths` — the real pages, in sitemap order, with the authored
 *     dates the sitemap stamps as `<lastmod>`. src/pages/sitemap.xml.ts is this
 *     list serialised and nothing else.
 *   - `buildSiteIndex` — the same pages as searchable entries (title, a short
 *     description, extra search words), plus one entry per project pointing at
 *     its card on /projects. The command palette's /search.json and the 404's
 *     suggestions read this.
 *
 * `security:smoke` holds the two to each other — every entry points at an
 * indexable page, and every indexable page has an entry — so a page kind added
 * to one and forgotten in the other fails the gate instead of a search result
 * pointing at a noindex page or a real page being unfindable.
 *
 * SERVER-ONLY: it imports the config accessors (node:fs). The browser gets the
 * index as JSON from /search.json and may import the `IndexEntry` TYPE only.
 */

import { getGames, getLearnings, getPosts, getProjects, getSite, getTools, isBlogsPublic, type Site } from './config'
import { isPlayableGame } from './games'
import { isPublishedLearning } from './learnings'
import { DRIFTFIELD_MODES, DRIFTFIELD_SLUG, isDriftfieldPublic } from './driftfield'
import type { Game } from '../config/games'
import type { Learning } from '../config/learnings'
import type { Post } from '../config/blogs'
import type { Project } from '../config/projects'
import type { Tool } from '../config/tools'

export type IndexKind = 'section' | 'tool' | 'mode' | 'game' | 'learning' | 'project' | 'post'

/** One searchable page. Short keys: this is serialised into /search.json. */
export interface IndexEntry {
  /** kind */
  k: IndexKind
  /** title */
  t: string
  /** site-relative URL (`/tools/json-tidy`, `/projects#sort`) */
  u: string
  /** description, plain text, one short paragraph */
  d?: string
  /** extra search words (the entry's keywords / tags) */
  w?: string
  /** slug (or a project's anchor id) */
  s?: string
}

/** A real page, as the sitemap lists it. */
export interface IndexablePath {
  path: string
  /** YYYY-MM-DD, only where the content carries an authored date */
  lastmod?: string
}

/** Everything the index is derived from — exactly what the accessors return. */
export interface SiteConfigs {
  site: Site
  tools: Tool[]
  games: Game[]
  learnings: Learning[]
  projects: Project[]
  posts: Post[]
}

/** Read every config the index needs, through the KV-aware accessors. */
export async function loadSiteConfigs(locals: unknown): Promise<SiteConfigs> {
  const [site, tools, games, learnings, projects, posts] = await Promise.all([
    getSite(locals), getTools(locals), getGames(locals), getLearnings(locals), getProjects(locals), getPosts(locals),
  ])
  return { site, tools, games, learnings, projects, posts }
}

/**
 * The section hubs, in the order the sitemap has always listed them. Every one
 * is a route that always exists; `/blogs` alone is gated, by the one predicate
 * that decides whether that section is public.
 */
const SECTIONS: readonly { path: string; title: string; gated?: (site: Site) => boolean }[] = [
  { path: '/', title: 'Home' },
  { path: '/projects', title: 'Projects' },
  { path: '/blogs', title: 'Blogs', gated: isBlogsPublic },
  { path: '/learnings', title: 'Learnings' },
  { path: '/games', title: 'Games' },
  { path: '/tools', title: 'Tools' },
]

/** A post is ours to list only when its href is on this site. */
const isLocalPost = (post: Post) => !/^https?:\/\//i.test(post.href)
const postSlug = (post: Post) => post.href.replace(/^\/?(blogs\/)?/, '')
const newest = (dates: string[]) => dates.reduce((max, d) => (d > max ? d : max), '')

/** Each kind's real pages, filtered by that kind's own predicate. */
function realPages(c: SiteConfigs) {
  const blogsPublic = isBlogsPublic(c.site)
  return {
    blogsPublic,
    posts: blogsPublic ? c.posts.filter(isLocalPost) : [],
    learnings: c.learnings.filter(isPublishedLearning),
    games: c.games.filter(isPlayableGame),
    // Only live tools have a crawlable detail route (wip renders behind a
    // noindex; external and disabled 404). The Driftfield hub is one of these.
    tools: c.tools.filter(t => t.status === 'live'),
    modes: isDriftfieldPublic(c.tools) ? DRIFTFIELD_MODES : [],
  }
}

/**
 * Every indexable page, in sitemap order: the section hubs, then posts,
 * learnings, games, tools and Driftfield modes.
 *
 * Only authored content carries a date. The /blogs and /learnings hubs are
 * stamped with their newest entry — /blogs from every post, local or not, since
 * a cross-posted piece still changes what the hub lists.
 */
export function indexablePaths(c: SiteConfigs): IndexablePath[] {
  const pages = realPages(c)
  const hubDate: Record<string, string> = {
    '/blogs': newest(c.posts.map(p => p.date)),
    '/learnings': newest(pages.learnings.map(l => l.date)),
  }
  const sections = SECTIONS
    .filter(s => !s.gated || s.gated(c.site))
    .map(s => (s.path in hubDate ? { path: s.path, lastmod: hubDate[s.path] || undefined } : { path: s.path }))
  return [
    ...sections,
    ...pages.posts.map(p => ({ path: `/blogs/${postSlug(p)}`, lastmod: p.date })),
    ...pages.learnings.map(l => ({ path: `/learnings/${l.slug}`, lastmod: l.date })),
    ...pages.games.map(g => ({ path: `/games/${g.slug}` })),
    ...pages.tools.map(t => ({ path: `/tools/${t.slug}` })),
    ...pages.modes.map(m => ({ path: `/tools/${DRIFTFIELD_SLUG}/${m.slug}` })),
  ]
}

/**
 * The anchor id of each project's card on /projects, in config order. Derived
 * from the title, made unique by suffix; /projects renders the same ids, so a
 * search result and the card it points at cannot disagree.
 */
export function projectAnchors(projects: readonly Pick<Project, 'title'>[]): string[] {
  const seen = new Set<string>()
  return projects.map(p => {
    const base = p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'project'
    let id = base
    for (let n = 2; seen.has(id); n += 1) id = `${base}-${n}`
    seen.add(id)
    return id
  })
}

const SUMMARY_MAX = 160

/** First paragraph, markdown marks dropped, capped at a word boundary — enough to tell two results apart. */
export function summarize(text: string | undefined): string | undefined {
  if (!text) return undefined
  const first = text.split(/\n\s*\n/)[0]
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~]|==/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!first) return undefined
  if (first.length <= SUMMARY_MAX) return first
  const cut = first.slice(0, SUMMARY_MAX)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), SUMMARY_MAX - 24)).trimEnd()}…`
}

const words = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(', ') || undefined

/** Every indexable page as a search entry, plus one entry per project card. */
export function buildSiteIndex(c: SiteConfigs): IndexEntry[] {
  const pages = realPages(c)
  const anchors = projectAnchors(c.projects)
  return [
    ...SECTIONS.filter(s => !s.gated || s.gated(c.site)).map((s): IndexEntry => ({ k: 'section', t: s.title, u: s.path })),
    ...pages.posts.map((p): IndexEntry => ({
      k: 'post', t: p.title, u: `/blogs/${postSlug(p)}`, d: summarize(p.summary), w: words(p.keywords), s: postSlug(p),
    })),
    ...pages.learnings.map((l): IndexEntry => ({
      k: 'learning', t: l.title, u: `/learnings/${l.slug}`, d: summarize(l.summary), w: words(l.keywords), s: l.slug,
    })),
    ...pages.games.map((g): IndexEntry => ({
      k: 'game', t: g.title, u: `/games/${g.slug}`, d: summarize(g.description), w: words(g.keywords), s: g.slug,
    })),
    ...pages.tools.map((t): IndexEntry => ({
      k: 'tool', t: t.title, u: `/tools/${t.slug}`, d: summarize(t.description), w: words(t.keywords), s: t.slug,
    })),
    ...pages.modes.map((m): IndexEntry => ({
      k: 'mode', t: m.title, u: `/tools/${DRIFTFIELD_SLUG}/${m.slug}`, d: summarize(m.description), w: words(m.keywords), s: m.slug,
    })),
    ...c.projects.map((p, i): IndexEntry => ({
      k: 'project', t: p.title, u: `/projects#${anchors[i]}`, d: summarize(p.description), w: words(p.tags.join(', '), p.keywords), s: anchors[i],
    })),
  ]
}
