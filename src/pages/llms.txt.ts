export const prerender = false

import type { APIRoute } from 'astro'
import { buildSiteIndex, loadSiteConfigs, plainParagraph, type IndexKind } from '../lib/site-index'

// /llms.txt (llmstxt.org): the site index as Markdown, for AI agents. Like the
// sitemap it lists what src/lib/site-index.ts derives and nothing else, so it
// can never name a page the sitemap doesn't have.
const GROUPS: readonly [string, readonly IndexKind[]][] = [
  ['Pages', ['section']],
  ['Tools', ['tool', 'mode', 'preset']],
  ['Games', ['game']],
  ['Learnings', ['learning']],
  ['Blog', ['post']],
  ['Projects', ['project']],
]

// Every value stays on its own line, and a title can't close its link early.
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const linkText = (s: string) => oneLine(s).replace(/[\\[\]]/g, '\\$&')
// The summary line joins the role line and the bio as two sentences; a role
// line that already ends in a full stop must not become "games.. Four".
const sentence = (s: string) => oneLine(s).replace(/[.!?…]+$/, '')

export const GET: APIRoute = async ({ locals }) => {
  const configs = await loadSiteConfigs(locals)
  const { site } = configs
  const base = site.url.replace(/\/$/, '')
  const href = (path: string) => `${base}${encodeURI(path).replace(/\(/g, '%28').replace(/\)/g, '%29')}`
  const entries = buildSiteIndex(configs)

  // A tool's metaDescription names the concrete job (which signatures, which
  // limit, which bug); the index's short card line is written for a grid. An
  // agent reads this file as the site's own description of each page, so it
  // gets the specific one, whole: the index clips at 160 characters.
  const toolDescription = new Map(configs.tools.map(t => [`/tools/${t.slug}`, plainParagraph(t.metaDescription || t.description)]))

  const out = [`# ${linkText(site.name)}`, '', `> ${sentence(site.tagline)}. ${oneLine(site.bio)}`, '']
  for (const [title, kinds] of GROUPS) {
    const list = entries.filter(e => kinds.includes(e.k))
    if (!list.length) continue
    out.push(`## ${title}`, '', ...list.map(e => {
      const d = (e.k === 'tool' && toolDescription.get(e.u)) || e.d
      return `- [${linkText(e.t)}](${href(e.u)})${d ? `: ${oneLine(d)}` : ''}`
    }), '')
  }
  const elsewhere = [['GitHub', site.social.github], ['LinkedIn', site.social.linkedin]].filter(([, url]) => url)
  if (elsewhere.length) out.push('## Elsewhere', '', ...elsewhere.map(([label, url]) => `- [${label}](${url})`), '')

  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
