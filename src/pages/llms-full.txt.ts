export const prerender = false

import type { APIRoute } from 'astro'
import { buildSiteIndex, loadSiteConfigs } from '../lib/site-index'
import { isPublishedLearning } from '../lib/learnings'
import { demoteHeadings, learningMarkdown, learningUpdated } from '../lib/reach'

// /llms-full.txt: /llms.txt's long form, for an agent that wants the text itself
// instead of a list of places to fetch it. Same headings as llms.txt, with what
// already exists in config under each: every live tool's intro and every
// published article's Markdown. Nothing is generated, and the size is fixed by
// the config (security:smoke holds it under 400 KB), so it needs no limit of its own.
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const sentence = (s: string) => oneLine(s).replace(/[.!?…]+$/, '')

export const GET: APIRoute = async ({ locals }) => {
  const configs = await loadSiteConfigs(locals)
  const { site } = configs
  const base = site.url.replace(/\/$/, '')
  const href = (path: string) => `${base}${encodeURI(path).replace(/\(/g, '%28').replace(/\)/g, '%29')}`
  const entries = buildSiteIndex(configs)

  const out = [`# ${oneLine(site.name)}`, '', `> ${sentence(site.tagline)}. ${oneLine(site.bio)}`, '']

  // The same tools llms.txt lists: the index decides which are live.
  const bySlug = new Map(configs.tools.map(t => [t.slug, t]))
  const tools = entries.filter(e => e.k === 'tool')
  if (tools.length) {
    out.push('## Tools', '')
    for (const e of tools) {
      const tool = bySlug.get(e.s ?? '')
      const text = (tool?.intro || tool?.metaDescription || tool?.description || '').trim()
      out.push(`### ${oneLine(e.t)}`, '', href(e.u), '', ...(text ? [text, ''] : []))
    }
  }

  const learnings = configs.learnings.filter(isPublishedLearning)
  if (learnings.length) {
    out.push('## Learnings', '')
    for (const l of learnings) {
      const updated = learningUpdated(l)
      out.push(
        `### ${oneLine(l.title)}`, '', href(`/learnings/${l.slug}`),
        ...(updated ? ['', `Last changed ${updated}.`] : []),
        '', demoteHeadings(learningMarkdown(l).trim(), 2), '',
      )
    }
  }

  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
