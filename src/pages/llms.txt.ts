export const prerender = false

import type { APIRoute } from 'astro'
import { buildSiteIndex, loadSiteConfigs, type IndexKind } from '../lib/site-index'

// /llms.txt (llmstxt.org): the site index as Markdown, for AI agents. Like the
// sitemap it lists what src/lib/site-index.ts derives and nothing else, so it
// can never name a page the sitemap doesn't have.
const GROUPS: readonly [string, readonly IndexKind[]][] = [
  ['Pages', ['section']],
  ['Tools', ['tool', 'mode']],
  ['Games', ['game']],
  ['Learnings', ['learning']],
  ['Blog', ['post']],
  ['Projects', ['project']],
]

// Every value stays on its own line, and a title can't close its link early.
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const linkText = (s: string) => oneLine(s).replace(/[\\[\]]/g, '\\$&')

export const GET: APIRoute = async ({ locals }) => {
  const configs = await loadSiteConfigs(locals)
  const { site } = configs
  const base = site.url.replace(/\/$/, '')
  const href = (path: string) => `${base}${encodeURI(path).replace(/\(/g, '%28').replace(/\)/g, '%29')}`
  const entries = buildSiteIndex(configs)

  const out = [`# ${linkText(site.name)}`, '', `> ${oneLine(`${site.tagline}. ${site.bio}`)}`, '']
  for (const [title, kinds] of GROUPS) {
    const list = entries.filter(e => kinds.includes(e.k))
    if (!list.length) continue
    out.push(`## ${title}`, '', ...list.map(e => `- [${linkText(e.t)}](${href(e.u)})${e.d ? `: ${oneLine(e.d)}` : ''}`), '')
  }
  const elsewhere = [['GitHub', site.social.github], ['LinkedIn', site.social.linkedin]].filter(([, url]) => url)
  if (elsewhere.length) out.push('## Elsewhere', '', ...elsewhere.map(([label, url]) => `- [${label}](${url})`), '')

  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
