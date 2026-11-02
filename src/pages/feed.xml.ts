export const prerender = false

import type { APIRoute } from 'astro'
import { loadSiteConfigs } from '../lib/site-index'
import { isPublishedLearning } from '../lib/learnings'
import { escapeHtml } from '../lib/escape'
import { learningUpdated, realDate } from '../lib/reach'

// /feed.xml: the published learnings as an Atom 1.0 feed. Articles only; tools
// and games are not feed items. Which articles exist is isPublishedLearning's
// call, the one predicate the sitemap, the hub and the article route read.

// One escaper for every value. The five characters escapeHtml handles are XML's
// predefined entities; control characters XML forbids outright are dropped
// first, because one in a title would make the whole feed unparseable.
const xml = (value: string) => escapeHtml(value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, ''))
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const stamp = (day: string) => `${day}T00:00:00Z`

export const GET: APIRoute = async ({ locals }) => {
  const configs = await loadSiteConfigs(locals)
  const { site } = configs
  const base = site.url.replace(/\/$/, '')
  const url = (path: string) => `${base}${encodeURI(path)}`

  const items = (configs.learnings.filter(isPublishedLearning))
    .map(l => ({ l, updated: learningUpdated(l), published: realDate(l.date) }))
    .sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''))

  // Atom requires <updated> on the feed. It is the newest entry's, and only an
  // empty feed (no article has a date to give) falls back to the moment it was built.
  const feedUpdated = items.find(i => i.updated)?.updated
  const author = `<author><name>${xml(oneLine(site.name))}</name><uri>${xml(base)}</uri></author>`

  const entries = items.map(({ l, updated, published }) => [
    '  <entry>',
    `    <title>${xml(oneLine(l.title))}</title>`,
    `    <id>${xml(url(`/learnings/${l.slug}`))}</id>`,
    `    <link rel="alternate" type="text/html" href="${xml(url(`/learnings/${l.slug}`))}"/>`,
    `    <link rel="alternate" type="text/markdown" href="${xml(url(`/learnings/${l.slug}.md`))}"/>`,
    ...(published ? [`    <published>${stamp(published)}</published>`] : []),
    ...(updated ? [`    <updated>${stamp(updated)}</updated>`] : [`    <updated>${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</updated>`]),
    `    <summary>${xml(oneLine(l.summary))}</summary>`,
    `    ${author}`,
    '  </entry>',
  ].join('\n'))

  const body = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xml(oneLine(site.name))}: learnings</title>
  <id>${xml(url('/feed.xml'))}</id>
  <link rel="self" type="application/atom+xml" href="${xml(url('/feed.xml'))}"/>
  <link rel="alternate" type="text/html" href="${xml(url('/learnings'))}"/>
  <updated>${feedUpdated ? stamp(feedUpdated) : new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</updated>
  ${author}
${entries.join('\n')}
</feed>
`
  return new Response(body, { headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' } })
}
