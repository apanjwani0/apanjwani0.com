/**
 * Invariants for the machine-readable twins of the site: /feed.xml, /llms.txt,
 * /llms-full.txt, the Markdown twins at /learnings/<slug>.md, robots.txt, the
 * IndexNow key and the middleware's freshness, negotiation and canonical rules.
 * Standalone, run by `npm run security:smoke` through scripts/run-smoke.mjs.
 * Plan: docs/plans/polish-2026-11.md, sections 2C to 2G.
 *
 * Each block names the mutation that must make it fail.
 */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { learnings as shippedLearnings } from '../../src/config/learnings.ts'
import { RETIRED_LEARNINGS, isPublishedLearning, retiredLearningTarget } from '../../src/lib/learnings.ts'
import { indexablePaths, loadSiteConfigs, realDate as siteRealDate } from '../../src/lib/site-index.ts'
import {
  demoteHeadings, httpDate, learningArticleSlug, learningMarkdown, markdownTwinPath, newestLearningDate,
  prefersMarkdown, realDate, slashlessRedirect,
} from '../../src/lib/reach.ts'
import { GET as llmsGET } from '../../src/pages/llms.txt.ts'
import { GET as llmsFullGET } from '../../src/pages/llms-full.txt.ts'
import { GET as feedGET } from '../../src/pages/feed.xml.ts'
import { GET as mdGET } from '../../src/pages/learnings/[slug].md.ts'

const root = new URL('../../', import.meta.url)
const read = rel => readFile(new URL(rel, root), 'utf-8')
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** A locals object whose KV overrides the learnings (and anything else given). */
const localsWith = fx => ({ runtime: { env: { SITE_CONFIG: { get: async key => fx[key] ?? null } } } })
const base = 'https://apanjwani0.com'
const real = shippedLearnings.filter(isPublishedLearning)
assert.ok(real.length >= 2, 'the shipped config has published articles to check against')

// One of every case the routes must tell apart. The odd title is the escaping
// case: a feed that interpolates it raw is not XML any more.
const article = (slug, extra = {}) => ({
  ...real[0], slug, title: `Title of ${slug}`, summary: `Summary of ${slug}`, content: `Body of ${slug}.\n\n{{embed:figure-one}}\n\nEnd.`,
  embed: 'internet-atlas', published: true, date: '2026-05-01', updated: undefined, ...extra,
})
const fixture = [
  article('pub-old', { date: '2026-03-01' }),
  article('pub-new', { date: '2026-04-01', updated: '2026-06-15', title: `Fish & <Chips> "quoted" 'single' \u0001 end` }),
  article('draft-one', { published: false, date: '2026-12-01', title: 'DRAFT-TITLE-MARKER' }),
  article('empty-body', { content: '   \n', title: 'EMPTY-BODY-MARKER' }),
]
const [retiredSlug] = Object.keys(RETIRED_LEARNINGS)
fixture.push(article(retiredSlug, { title: 'RETIRED-TITLE-MARKER' }))
const publishedSlugs = fixture.filter(isPublishedLearning).map(l => l.slug)
assert.deepEqual(publishedSlugs, ['pub-old', 'pub-new'], 'the fixture has two published articles and three that must stay out')
const fx = { learnings: fixture }

/* ─────  XML: a small well-formedness checker  ─────
   No XML parser is a dependency, so this one is deliberately strict about the
   things that break a feed: unbalanced tags, unquoted attributes, a bare `&` or
   `<` in text or a value, and characters XML forbids. It returns the element
   tree so the blocks below can count entries. */
function parseXml(xml) {
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml), 'XML forbids control characters')
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '')
  const root = { name: '#root', attrs: {}, children: [], text: '' }
  const stack = [root]
  const tag = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/y
  let i = 0
  while (i < body.length) {
    if (body[i] === '<') {
      tag.lastIndex = i
      const m = tag.exec(body)
      assert.ok(m, `malformed tag near: ${body.slice(i, i + 60)}`)
      const [whole, close, name, attrText, selfClose] = m
      if (close) {
        assert.equal(stack.at(-1).name, name, `</${name}> closes <${stack.at(-1).name}>`)
        stack.pop()
      } else {
        const attrs = {}
        for (const a of attrText.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
          assert.ok(!/&(?!amp;|lt;|gt;|quot;|#39;)/.test(a[2]), `bare & in attribute ${a[1]}`)
          attrs[a[1]] = a[2]
        }
        const el = { name, attrs, children: [], text: '' }
        stack.at(-1).children.push(el)
        if (!selfClose) stack.push(el)
      }
      i += whole.length
    } else {
      const next = body.indexOf('<', i)
      const text = body.slice(i, next === -1 ? body.length : next)
      assert.ok(!/&(?!amp;|lt;|gt;|quot;|#39;)/.test(text), `bare & in text: ${text.slice(0, 60)}`)
      stack.at(-1).text += text
      i += text.length
    }
  }
  assert.equal(stack.length, 1, `unclosed <${stack.at(-1).name}>`)
  return root.children[0]
}
const child = (el, name) => el.children.filter(c => c.name === name)
const unescapeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/* ─────  The Atom feed  ─────
   One <entry> per PUBLISHED learning and none for a draft, an empty body or a
   retired slug; the id is the canonical URL; the feed's <updated> is the newest
   entry's; a hostile title is escaped and a control character dropped.
   (mutations: list every learning instead of filtering → fails; drop the xml()
   escape from the title → fails; use the oldest date for the feed → fails) */
{
  const res = await feedGET({ locals: localsWith(fx) })
  assert.equal(res.headers.get('Content-Type'), 'application/atom+xml; charset=utf-8')
  const xmlText = await res.text()
  const feed = parseXml(xmlText)
  assert.equal(feed.name, 'feed')
  assert.equal(feed.attrs.xmlns, 'http://www.w3.org/2005/Atom')
  const entries = child(feed, 'entry')
  assert.equal(entries.length, publishedSlugs.length, 'one entry per published learning')
  const ids = entries.map(e => child(e, 'id')[0].text)
  assert.deepEqual(ids.sort(), publishedSlugs.map(s => `${base}/learnings/${s}`).sort(), 'entry ids are the canonical URLs')
  for (const marker of ['DRAFT-TITLE-MARKER', 'EMPTY-BODY-MARKER', 'RETIRED-TITLE-MARKER', 'draft-one', 'empty-body', retiredSlug]) {
    assert.ok(!xmlText.includes(marker), `${marker} must not appear in the feed`)
  }
  for (const e of entries) {
    for (const name of ['title', 'id', 'updated', 'summary', 'author']) assert.equal(child(e, name).length, 1, `an entry has exactly one <${name}>`)
    assert.match(child(e, 'updated')[0].text, /^\d{4}-\d{2}-\d{2}T00:00:00Z$/)
    assert.ok(child(child(e, 'author')[0], 'name')[0].text.length > 0, 'the author Person has a name')
  }
  const newTitle = child(entries.find(e => child(e, 'id')[0].text.endsWith('/pub-new')), 'title')[0].text
  assert.equal(unescapeXml(newTitle), `Fish & <Chips> "quoted" 'single'  end`, 'the title survives escaping, minus the forbidden control character')
  const updatedOf = e => child(e, 'updated')[0].text
  assert.equal(updatedOf(entries.find(e => child(e, 'id')[0].text.endsWith('/pub-new'))), '2026-06-15T00:00:00Z', 'updated is `updated`, not `date`')
  assert.equal(updatedOf(entries.find(e => child(e, 'id')[0].text.endsWith('/pub-old'))), '2026-03-01T00:00:00Z', 'with no `updated` it falls back to `date`')
  assert.equal(child(feed, 'updated')[0].text, '2026-06-15T00:00:00Z', 'the feed is as new as its newest entry, and the draft dated December does not count')
  assert.equal(entries.map(updatedOf).join() , [...entries.map(updatedOf)].sort().reverse().join(), 'newest first')
  // The shipped config: the real feed parses and lists exactly the real articles.
  const shipped = parseXml(await (await feedGET({ locals: {} })).text())
  assert.equal(child(shipped, 'entry').length, real.length)
}
console.log('feed.xml: well-formed Atom, one entry per published learning, canonical ids, newest-entry updated, hostile titles escaped')

/* ─────  The Markdown twin and the HTML route share one predicate  ─────
   (mutations: test `learning.published` alone in the .md route → the empty-body
   case answers 200 → fails; drop the retired check → fails; echo the slug in a
   404 → fails)  */
{
  const htmlSrc = stripComments(await read('src/pages/learnings/[slug].astro'))
  const mdSrc = stripComments(await read('src/pages/learnings/[slug].md.ts'))
  for (const [name, src] of [['the HTML route', htmlSrc], ['the .md route', mdSrc]]) {
    assert.match(src, /isPublishedLearning\(/, `${name} must decide with isPublishedLearning`)
    assert.match(src, /retiredLearningTarget\(/, `${name} must answer a retired slug through retiredLearningTarget`)
  }
  assert.ok(mdSrc.indexOf('retiredLearningTarget(') < mdSrc.indexOf('getLearnings('), 'the .md route answers a retired slug before reading config, like the HTML route')

  const ask = slug => mdGET({ params: { slug }, locals: localsWith(fx) })
  for (const l of fixture) {
    const res = await ask(l.slug)
    if (retiredLearningTarget(l.slug)) {
      assert.equal(res.status, 301, 'a retired slug redirects, like the HTML route')
      assert.equal(res.headers.get('Location'), retiredLearningTarget(l.slug))
    } else if (isPublishedLearning(l)) {
      assert.equal(res.status, 200, `${l.slug} is published, so its twin exists`)
      assert.equal(res.headers.get('Content-Type'), 'text/markdown; charset=utf-8')
      const text = await res.text()
      const lines = text.split('\n')
      assert.equal(lines[0], `# ${l.title.replace(/\s+/g, ' ').trim()}`, 'the first line is the title')
      assert.equal(lines[2], `Canonical URL: ${base}/learnings/${l.slug}`, 'the third line is the canonical URL')
      assert.ok(!text.includes('{{embed'), 'figure markers are replaced by a sentence')
      assert.ok(text.includes('An interactive figure called "figure-one" appears here'), 'the sentence names the figure')
    } else {
      assert.equal(res.status, 404, `${l.slug} is not published, so it has no twin`)
      assert.equal(res.body, null, 'a 404 carries no body')
    }
  }
  const unknown = await ask('zz-never-heard-of-it')
  assert.equal(unknown.status, 404)
  assert.ok(![...unknown.headers.values()].some(v => v.includes('zz-never-heard-of-it')), 'a 404 never echoes the asked slug')
  assert.equal((await mdGET({ params: {}, locals: localsWith(fx) })).status, 404)
}
console.log('learnings/<slug>.md: published articles only, retired slugs redirect, 404s are bodyless and never echo the slug')

/* ─────  Figure markers, heading demotion  ───── */
{
  const out = learningMarkdown({ content: 'a\n\n{{embed:packets}}\n\nb\n\n{{embed}}\n', embed: 'internet-atlas' })
  assert.ok(out.includes('"packets"') && out.includes('"internet-atlas"') && !out.includes('{{'))
  assert.ok(learningMarkdown({ content: '{{embed}}', embed: undefined }).startsWith('An interactive figure appears'))
  const md = '# One\n## Two\n```sh\n# a comment\n```\n###### Six\n'
  assert.equal(demoteHeadings(md, 2), '### One\n#### Two\n```sh\n# a comment\n```\n###### Six\n', 'headings move down, a code fence is untouched, h6 is the floor')
}
console.log('markdown twins: figure markers become sentences, headings nest, code fences are left alone')

/* ─────  llms.txt: every page once, modes and presets only under Optional  ─────
   (mutations: put 'mode' back in the Tools group → fails; drop the Optional
   section → fails; list a page twice → fails)  */
{
  const configs = await loadSiteConfigs({})
  const md = await (await llmsGET({ locals: {} })).text()
  // Split into `## Heading` sections.
  const sections = new Map()
  let current = '(top)'
  for (const line of md.split('\n')) {
    const h = /^## (.+)$/.exec(line)
    if (h) { current = h[1]; sections.set(current, []); continue }
    const link = /^- \[[^\]]*\]\(([^)]+)\)/.exec(line)
    if (link) sections.get(current)?.push(link[1])
  }
  const all = [...sections.entries()].flatMap(([name, urls]) => urls.map(u => [name, u]))
  for (const { path } of indexablePaths(configs)) {
    const hits = all.filter(([, u]) => u === `${base}${path}`)
    assert.equal(hits.length, 1, `${path} appears exactly once in llms.txt (found ${hits.length})`)
  }
  const optional = sections.get('Optional') ?? []
  assert.ok(optional.length > 0, 'llms.txt has an ## Optional section')
  const variant = u => /\/tools\/(driftfield|cron-whisperer)\//.test(u)
  for (const u of optional) assert.ok(variant(u), `Optional holds only mode and preset pages, not ${u}`)
  for (const [name, u] of all) if (variant(u)) assert.equal(name, 'Optional', `${u} belongs under Optional, found under ${name}`)
  assert.ok(md.lastIndexOf('## Optional') > md.lastIndexOf('## Elsewhere'), 'Optional comes last, as the convention has it')
  const liveTools = configs.tools.filter(t => t.status === 'live').length
  assert.equal((sections.get('Tools') ?? []).length, liveTools, 'the Tools section lists the tools and nothing else')
  const api = md.slice(md.indexOf('## API'), md.indexOf('## Machine-readable'))
  for (const call of ['GET /api/tools/chainsaw?target=host[:port]', 'GET /api/tools/dns-sightline?name=&scope=full|caa', 'GET /api/tools/link-peek?url=', 'POST /api/hook/<bin>']) {
    assert.ok(api.includes(`\`${call}\``), `llms.txt names ${call}`)
  }
  assert.match(api, /rate limited/)
  const machine = md.slice(md.indexOf('## Machine-readable'), md.indexOf('## Elsewhere'))
  assert.ok(machine.includes(`${base}/llms-full.txt`) && machine.includes(`${base}/feed.xml`), 'llms.txt points at llms-full.txt and the feed')
  assert.ok(!/\]\(/.test(machine), 'those two are bare addresses: a `- [text](url)` line is held to the site index')
  assert.match(api, /JSON/)
}
console.log('llms.txt: every indexable page once, the tools stand alone, modes and presets sit under Optional, the four endpoints are named')

/* ─────  llms-full.txt: the text itself, bounded  ─────
   (mutations: include a draft body → fails; skip the heading demotion → fails;
   leave the figure markers in → fails)  */
{
  const res = await llmsFullGET({ locals: localsWith(fx) })
  assert.equal(res.headers.get('Content-Type'), 'text/plain; charset=utf-8')
  const text = await res.text()
  for (const marker of ['DRAFT-TITLE-MARKER', 'EMPTY-BODY-MARKER', 'RETIRED-TITLE-MARKER', 'Body of draft-one']) assert.ok(!text.includes(marker), `${marker} must not be in llms-full.txt`)
  assert.ok(text.includes('Body of pub-old.') && text.includes('Body of pub-new.'))
  assert.ok(!text.includes('{{embed'), 'no figure marker survives')

  const shipped = await (await llmsFullGET({ locals: {} })).text()
  assert.ok(Buffer.byteLength(shipped) < 400 * 1024, `llms-full.txt is ${Buffer.byteLength(shipped)} bytes, over the 400 KB cap`)
  assert.deepEqual([...shipped.matchAll(/^## (.+)$/gm)].map(m => m[1]), ['Tools', 'Learnings'], 'an article\'s own headings nest below the two top sections')
  const configs = await loadSiteConfigs({})
  for (const t of configs.tools.filter(t => t.status === 'live')) {
    assert.ok(shipped.includes(`${base}/tools/${t.slug}\n`), `${t.slug} is in llms-full.txt`)
    if (t.intro) assert.ok(shipped.includes(t.intro.trim()), `${t.slug}'s intro is in llms-full.txt whole`)
  }
  for (const l of real) assert.ok(shipped.includes(`### ${l.title}`) && shipped.includes(`${base}/learnings/${l.slug}\n`))
}
console.log('llms-full.txt: tool intros and published articles only, figures as sentences, headings nested, under 400 KB')

/* ─────  Dates behind Last-Modified, and the twin helpers  ─────
   (mutations: let a draft's date count → fails; accept 2026-02-31 → fails)  */
{
  for (const v of ['2026-02-31', '2026-13-01', '26-01-01', '', undefined, '2026-1-01', '2026-01-01T00:00']) {
    assert.equal(realDate(v), undefined, `${String(v)} is not a real date`)
    assert.equal(realDate(v), siteRealDate(v), `reach and site-index agree on ${String(v)}`)
  }
  for (const v of ['2026-02-28', '2024-02-29', '2026-12-31']) {
    assert.equal(realDate(v), v)
    assert.equal(realDate(v), siteRealDate(v))
  }
  assert.equal(newestLearningDate(fixture), '2026-06-15', 'the newest PUBLISHED date: a December draft and a retired slug do not count')
  assert.equal(newestLearningDate([]), undefined, 'no article, no date')
  assert.equal(newestLearningDate([article('x', { date: 'soon', updated: undefined })]), undefined, 'a date that is not real is omitted, never guessed')
  assert.equal(httpDate('2026-06-15'), 'Mon, 15 Jun 2026 00:00:00 GMT')
  assert.equal(markdownTwinPath('a-b'), '/learnings/a-b.md')
  assert.equal(learningArticleSlug('/learnings/how-the-internet-works'), 'how-the-internet-works')
  for (const p of ['/learnings', '/learnings/', '/learnings/a/b', '/learnings/a.md', '/tools/a', '/learnings/a b']) assert.equal(learningArticleSlug(p), undefined, p)
}
console.log('freshness: Last-Modified derives from the newest published real date, and from nothing else')

/* ─────  Accept negotiation  ─────
   (mutations: let the any-type wildcard count for markdown → a browser gets markdown → fails;
   a tie goes to markdown → fails)  */
{
  const yes = ['text/markdown', 'text/markdown, text/html;q=0.5', 'text/markdown;q=0.9, text/html;q=0.1, */*;q=0.1', 'application/json, text/markdown']
  const no = [
    null, '', '*/*', 'text/*', 'text/html', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'text/markdown, text/html', 'text/html, text/markdown', 'text/markdown;q=0', 'text/markdown;q=0.4, text/html;q=0.9', 'text/markdown;q=banana', 'text/markdown;q=99, text/html', 'text/markdown;q=-1',
    'application/json',
  ]
  for (const a of yes) assert.equal(prefersMarkdown(a), true, `Accept: ${a} asks for markdown`)
  for (const a of no) assert.equal(prefersMarkdown(a), false, `Accept: ${a} does not`)
  assert.equal(prefersMarkdown('text/html, '.repeat(40) + 'text/markdown;q=0.1'), false, 'only the first 16 entries are read')
  assert.equal(prefersMarkdown(`${'x'.repeat(2000)}, text/markdown`), false, 'only the first KB is read')
}
console.log('accept: markdown only when asked for by name and ranked above HTML; a browser never gets it')

/* ─────  The trailing-slash redirect  ─────
   (mutations: drop the leading-slash collapse → `//evil.com/` redirects off-site →
   fails; drop the /api/ exemption → a POSTed webhook is turned into a GET → fails)  */
{
  assert.equal(slashlessRedirect('/tools/chainsaw/', ''), '/tools/chainsaw')
  assert.equal(slashlessRedirect('/tools/chainsaw/', '?target=a.com&x=1'), '/tools/chainsaw?target=a.com&x=1', 'the query string is kept')
  assert.equal(slashlessRedirect('/a///', ''), '/a')
  assert.equal(slashlessRedirect('/', ''), null, 'the root keeps its slash')
  assert.equal(slashlessRedirect('/tools/chainsaw', ''), null)
  assert.equal(slashlessRedirect('//evil.com/', ''), '/evil.com', 'never a protocol-relative Location')
  assert.equal(slashlessRedirect('///evil.com//', '?a=1'), '/evil.com?a=1')
  assert.equal(slashlessRedirect('//', ''), null)
  for (const p of ['/api/hook/aaaaaaaaaaaaaaaaaaaaaaaa/', '/api/', '/admin/', '/admin/x/']) assert.equal(slashlessRedirect(p, ''), null, `${p} is not redirected`)
  for (const p of ['/a/', '/learnings/', '/games/2048/', '/tools/driftfield/flow-field/', '/x/y/z/']) {
    const to = slashlessRedirect(p, '')
    assert.ok(to && to.startsWith('/') && !to.startsWith('//') && !to.endsWith('/'), p)
  }
}
console.log('canonical: a trailing slash 301s to the slashless URL with the query kept, and cannot become an off-site redirect')

/* ─────  The middleware: branch order and the new rules  ─────
   The existing order assertion lives in security-smoke.mjs; this restates it
   with the branches this change sits beside, then pins the new rules to the
   helpers the blocks above test.
   (mutations: move the 404 rule above the /api/ rule → fails; delete the
   no-store on a negotiated response → fails; drop a freshness path → fails)  */
{
  const src = stripComments(await read('src/middleware.ts'))
  const at = needle => { const i = src.indexOf(needle); assert.ok(i !== -1, `middleware lost: ${needle}`); return i }
  const order = [
    'isAdminSurface) {', '} else if (hasAdminSession) {', '!response.headers.has(\'Cache-Control\')',
    "pathname.startsWith('/api/')) {", 'response.status >= 500', 'isGet && response.status === 404', 'isGet && response.status === 200',
  ].map(at)
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'admin, own-policy, /api/ no-store, 5xx, 404, then the 200 fallback — in that order')
  assert.ok(at('isFromCloudflare') < at('slashlessRedirect(pathname'), 'the origin lock answers before any redirect')
  assert.ok(at('slashlessRedirect(pathname') < at('await next('), 'the redirect is decided before the route runs')
  assert.match(src, /slashlessRedirect\(pathname, context\.url\.search\)/, 'the query string reaches the redirect')
  assert.match(src, /method === 'GET' \|\| method === 'HEAD'/, 'only GET and HEAD are redirected')
  assert.match(src, /status: 301, headers: \{ Location: slashless, 'Cache-Control': 'public, max-age=0, s-maxage=3600' \}/, 'the redirect sets its own max-age=0 policy')
  assert.match(src, /if \(wantsMarkdown\) response\.headers\.set\('Cache-Control', 'no-store'\)/, 'a negotiated response is never edge-cached')
  assert.match(src, /prefersMarkdown\(context\.request\.headers\.get\('accept'\)\)/)
  assert.match(src, /next\(wantsMarkdown \? markdownTwinPath\(articleSlug!\) : undefined\)/, 'the HTML address is rewritten to the .md route')
  assert.match(src, /response\.headers\.append\('Vary', 'Accept'\)/)
  assert.match(src, /rel="alternate"; type="text\/markdown"/, 'article HTML carries the Link header')
  const fresh = /FRESHNESS_PATHS = \[([^\]]*)\]/.exec(src)?.[1] ?? ''
  for (const p of ['/sitemap.xml', '/llms.txt', '/llms-full.txt', '/feed.xml']) assert.ok(fresh.includes(`'${p}'`), `${p} gets Last-Modified`)
  assert.match(src, /newestLearningDate\(await getLearnings\(context\.locals\)\)/, 'Last-Modified comes from the learnings, never from the clock')
  assert.ok(!/Last-Modified', new Date\(\)/.test(src), 'no Last-Modified is stamped from now')
}
console.log('middleware: branch order holds; redirect, negotiation, Vary, Link and Last-Modified are wired to the tested helpers')

/* ─────  robots.txt  ─────
   (mutations: remove Bytespider → fails; add Google-Extended to the group →
   fails; Disallow OAI-SearchBot → fails)  */
{
  const robots = await read('public/robots.txt')
  const groups = []
  let g = null
  for (const raw of robots.split('\n')) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) { continue }
    const [k, ...rest] = line.split(':')
    const key = k.trim().toLowerCase(), value = rest.join(':').trim()
    if (key === 'user-agent') { if (!g || g.rules.length) { g = { agents: [], rules: [] }; groups.push(g) } g.agents.push(value.toLowerCase()) }
    else if (g && (key === 'disallow' || key === 'allow')) g.rules.push([key, value])
  }
  const blocked = agent => groups.some(x => x.agents.includes(agent.toLowerCase()) && x.rules.some(([k, v]) => k === 'disallow' && v === '/'))
  for (const a of ['GPTBot', 'ClaudeBot', 'CCBot', 'Applebot-Extended', 'Meta-ExternalAgent', 'Bytespider', 'anthropic-ai', 'cohere-ai', 'Diffbot']) {
    assert.ok(blocked(a), `${a} is a training crawler and must be disallowed`)
  }
  for (const a of ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'Google-Extended', 'Googlebot', 'bingbot', '*']) {
    assert.ok(!blocked(a), `${a} must not be disallowed (AGENTS.md → AI crawlers)`)
  }
  assert.match(robots, /Content-Signal: search=yes, ai-input=yes, ai-train=no/)
  assert.match(robots, /^Sitemap: https:\/\/apanjwani0\.com\/sitemap\.xml$/m)
}
console.log('robots.txt: nine training crawlers disallowed; search, user-fetch agents and Google-Extended stay open')

/* ─────  The IndexNow key and script  ─────
   (mutations: change a character of the key file → fails; rename the file →
   fails; send a foreign host → fails)  */
{
  const keyFiles = (await readdir(new URL('public/', root))).filter(f => /^[0-9a-f]{32}\.txt$/.test(f))
  assert.equal(keyFiles.length, 1, 'exactly one IndexNow key file: 32 lowercase hex characters plus .txt')
  const key = keyFiles[0].slice(0, -4)
  assert.equal(await read(`public/${keyFiles[0]}`), key, 'the file holds its own name and nothing else')
  const { findKey, parseUrls, buildPayload, MAX_URLS, INDEXNOW_ENDPOINT } = await import('../indexnow.mjs')
  assert.equal(await findKey(), key)
  assert.equal(MAX_URLS, 1000)
  assert.equal(INDEXNOW_ENDPOINT, 'https://api.indexnow.org/indexnow')
  const host = 'apanjwani0.com'
  const lines = [
    `https://${host}/a`, `https://${host}/a`, `https://${host}/b#frag`, `http://${host}/c`, 'https://other.example/d', 'not a url', '', `  https://${host}/e  `,
  ]
  const parsed = parseUrls(lines, host)
  assert.deepEqual(parsed.urls, [`https://${host}/a`, `https://${host}/b`, `https://${host}/e`], 'unique, https, own host, fragment dropped')
  assert.equal(parsed.skipped, 3)
  const many = Array.from({ length: 1500 }, (_, i) => `https://${host}/p${i}`)
  const capped = parseUrls(many, host)
  assert.equal(capped.urls.length, 1000, 'a request carries at most 1000 URLs')
  assert.equal(capped.dropped, 500)
  assert.deepEqual(buildPayload(host, key, ['https://apanjwani0.com/a']), {
    host, key, keyLocation: `https://${host}/${key}.txt`, urlList: ['https://apanjwani0.com/a'],
  })
  const src = await read('scripts/indexnow.mjs')
  assert.match(src, /res\.status === 200 \|\| res\.status === 202 \? 0 : 1/, 'exit 0 on 200 and 202 only')
  assert.match(src, /AbortSignal\.timeout\(/, 'the request is bounded in time')
  const workflow = await read('.github/workflows/deploy.yml')
  assert.match(workflow, /name: sitemap-last/)
  assert.match(workflow, /node scripts\/indexnow\.mjs < changed\.txt/)
  assert.match(workflow, /continue-on-error: true/, 'a missing earlier sitemap is the first run, not a failure')
  assert.ok(workflow.indexOf('Submit what changed') < workflow.indexOf('Keep this sitemap for the next run'), 'the copy is kept only after a successful submission')
  assert.ok(!/secrets\.[A-Z_]*INDEXNOW/i.test(workflow), 'the key is public; no secret is involved')
  const check = await read('scripts/origin-check.sh')
  for (const needle of ['301', '/avatar.webp', '/feed.xml', '/llms-full.txt', '/tools/chainsaw/', 'Redirect Rule']) assert.ok(check.includes(needle), `origin-check.sh asserts ${needle}`)
}
console.log('indexnow: one 32-hex key file named for its content; the script filters, dedupes, caps at 1000, exits 0 only on 200 or 202')
