/**
 * What the machine-readable twins of the site share: the feed (/feed.xml), the
 * markdown twins (/learnings/<slug>.md), /llms-full.txt and the middleware's
 * freshness and negotiation headers.
 *
 * One copy of each rule, so the four outputs cannot disagree about what an
 * article's text is, when it last changed, or which path is its twin. Pure
 * functions with no I/O: `security:smoke` runs them directly.
 */

import type { Learning } from '../config/learnings'
import { isPublishedLearning } from './learnings'

/** A real calendar date as YYYY-MM-DD, or undefined. A string that only looks
 *  like one (2026-02-31) must not become a Last-Modified or an Atom `updated`.
 *  Same rule as `realDate` in site-index.ts, kept here because that module pulls
 *  in every page kind and the middleware must stay light; security:smoke holds the
 *  two to the same answers. */
export function realDate(value: string | undefined): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? '').trim())
  if (!m) return undefined
  const [, y, mo, d] = m
  const t = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  return t.getUTCFullYear() === Number(y) && t.getUTCMonth() === Number(mo) - 1 && t.getUTCDate() === Number(d)
    ? `${y}-${mo}-${d}`
    : undefined
}

/** When an article last changed: its `updated` date, else the day it was written. */
export function learningUpdated(l: Learning): string | undefined {
  return realDate(l.updated) ?? realDate(l.date)
}

/** The newest real date among the PUBLISHED articles, or undefined when there is none. */
export function newestLearningDate(learnings: readonly Learning[]): string | undefined {
  let max: string | undefined
  for (const l of learnings) {
    if (!isPublishedLearning(l)) continue
    const d = learningUpdated(l)
    if (d && (!max || d > max)) max = d
  }
  return max
}

/** An HTTP-date for a YYYY-MM-DD day, midnight UTC. */
export function httpDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toUTCString()
}

/** The path of an article's markdown twin. */
export const markdownTwinPath = (slug: string) => `/learnings/${slug}.md`

/**
 * An article's markdown source with each figure marker replaced by one plain
 * sentence naming the figure: an agent reading the text cannot run the figure,
 * and a literal `{{embed:packets}}` would read as a template that failed.
 */
export function learningMarkdown(l: Pick<Learning, 'content' | 'embed'>): string {
  return l.content.replace(/^[ \t]*\{\{embed(?::([a-z0-9-]+))?\}\}[ \t]*$/gm, (_, view?: string) => {
    const name = view || l.embed
    return name
      ? `An interactive figure called "${name}" appears here on the web page; it cannot be shown in plain text.`
      : 'An interactive figure appears here on the web page; it cannot be shown in plain text.'
  })
}

/**
 * Push every heading of a Markdown body down `by` levels (capped at h6), so an
 * article's own `##` sections nest under the heading /llms-full.txt gives the
 * article. Lines inside a code fence are left alone: a `# comment` there is not
 * a heading.
 */
export function demoteHeadings(markdown: string, by: number): string {
  let fence: string | null = null
  return markdown.split('\n').map(line => {
    const f = /^[ \t]*(```+|~~~+)/.exec(line)?.[1]
    if (f) {
      if (!fence) fence = f[0]
      else if (f[0] === fence) fence = null
      return line
    }
    if (fence) return line
    return line.replace(/^(#{1,6})(?=\s)/, h => '#'.repeat(Math.min(6, h.length + by)))
  }).join('\n')
}

const MAX_ACCEPT_ENTRIES = 16

/** The quality an Accept header gives `type`: its exact entry, else `text/*`,
 *  else the any-type wildcard, else 0. */
function acceptQuality(entries: { range: string; q: number }[], type: string): number {
  const exact = entries.find(e => e.range === type)
  if (exact) return exact.q
  const group = entries.find(e => e.range === `${type.split('/')[0]}/*`)
  if (group) return group.q
  return entries.find(e => e.range === '*/*')?.q ?? 0
}

/**
 * True when an Accept header asks for text/markdown by name and ranks it above
 * text/html. A wildcard never counts and a tie goes to HTML, so a browser (which
 * lists text/html first and the wildcard last) can never be handed markdown. The header
 * is client input: read the first 16 entries of its first 1 KB and nothing else.
 */
export function prefersMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false
  const entries = accept.slice(0, 1024).split(',').slice(0, MAX_ACCEPT_ENTRIES).map(part => {
    const [range, ...params] = part.trim().toLowerCase().split(';')
    const qParam = params.map(p => p.trim()).find(p => p.startsWith('q='))
    const q = qParam === undefined ? 1 : Number(qParam.slice(2))
    return { range: range.trim(), q: Number.isFinite(q) ? Math.min(1, Math.max(0, q)) : 0 }
  })
  const markdown = entries.find(e => e.range === 'text/markdown')
  return Boolean(markdown && markdown.q > acceptQuality(entries, 'text/html'))
}

/** `/learnings/<slug>` with no dot in the slug: the one path a markdown twin can answer for. */
export function learningArticleSlug(pathname: string): string | undefined {
  return /^\/learnings\/([A-Za-z0-9_-]+)$/.exec(pathname)?.[1]
}

/**
 * Where a trailing-slash request should go: the same path without the slash and
 * with the query string kept, or null when no redirect applies (the root, a path
 * with no trailing slash, an API or admin path).
 *
 * The result always starts with exactly one `/`. A request for `//evil.com/`
 * must not answer `Location: //evil.com`, which a browser reads as another
 * host. API paths are exempt because a 301 turns a POSTed webhook into a GET
 * that captures nothing.
 */
export function slashlessRedirect(pathname: string, search: string): string | null {
  if (pathname.length < 2 || !pathname.endsWith('/')) return null
  if (pathname.startsWith('/api/') || pathname === '/admin/' || pathname.startsWith('/admin/')) return null
  const path = pathname.replace(/\/+$/, '').replace(/^\/+/, '')
  return path ? `/${path}${search}` : null
}
