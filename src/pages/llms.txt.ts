export const prerender = false

import type { APIRoute } from 'astro'
import { buildSiteIndex, loadSiteConfigs, plainParagraph, type IndexKind } from '../lib/site-index'

// /llms.txt (llmstxt.org): the site index as Markdown, for AI agents. Like the
// sitemap it lists what src/lib/site-index.ts derives and nothing else, so it
// can never name a page the sitemap doesn't have.
const GROUPS: readonly [string, readonly IndexKind[]][] = [
  ['Pages', ['section']],
  ['Tools', ['tool']],
  ['Games', ['game']],
  ['Learnings', ['learning']],
  ['Blog', ['post']],
  ['Projects', ['project']],
]

// The llmstxt.org convention for pages an agent may skip when short of context:
// the Driftfield modes and Cron Whisperer presets are variations of two tools,
// and listed among them they buried the real tools under twenty near-copies.
const OPTIONAL: readonly IndexKind[] = ['mode', 'preset']

// The server endpoints, in the words an agent needs to call one. Each answers
// JSON and is rate limited per client; the limits themselves are not repeated
// here because they belong to the routes and would drift.
const API: readonly [string, string][] = [
  ['GET /api/tools/chainsaw?target=host[:port]', 'reads the TLS certificate chain a server really sends'],
  ['GET /api/tools/dns-sightline?name=&scope=full|caa', 'asks three public resolvers the same questions and compares the answers'],
  ['GET /api/tools/link-peek?url=', 'fetches a public page and returns the link-preview tags it carries'],
  ['POST /api/hook/<bin>', 'records the request against a bin whose id you choose (at least 24 characters); read it back on the Webhook Inspector page'],
  ['GET /openapi.json', 'the OpenAPI 3.1 description of the routes above, with their query parameters, the 429 shape and the rate limits'],
  ['POST /api/mcp', 'an MCP server (stateless Streamable HTTP, JSON-RPC) with the tools inspect_tls, inspect_dns, peek_link, create_webhook_bin and list_webhook_requests; tighter limits than the pages'],
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
  out.push('## API', '', 'These endpoints are rate limited per client and answer JSON. They are the same ones the tool pages call.', '',
    ...API.map(([call, what]) => `- \`${call}\`: ${what}`), '')
  // Bare addresses, not links: security:smoke holds every `- [text](url)` line on
  // this site to the site index, and these two are files, not pages.
  out.push('## Machine-readable', '',
    `- Full text of the articles and every tool's description, as one plain-text file: ${href('/llms-full.txt')}`,
    `- The articles as an Atom feed: ${href('/feed.xml')}`,
    '- Each article is also served as Markdown at its own address with `.md` added, for example `/learnings/<slug>.md`.', '')
  const elsewhere = [['GitHub', site.social.github], ['LinkedIn', site.social.linkedin]].filter(([, url]) => url)
  if (elsewhere.length) out.push('## Elsewhere', '', ...elsewhere.map(([label, url]) => `- [${label}](${url})`), '')

  const optional = entries.filter(e => OPTIONAL.includes(e.k))
  if (optional.length) out.push('## Optional', '', ...optional.map(e => `- [${linkText(e.t)}](${href(e.u)})${e.d ? `: ${oneLine(e.d)}` : ''}`), '')

  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
