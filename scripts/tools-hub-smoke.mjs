/**
 * Invariants for the /tools hub, the shells and the site copy, kept apart from
 * scripts/security-smoke.mjs (a 600 KB file) the way docs/plans/fresh-eyes-review.md
 * proposes splitting the smoke by kind. `npm run security:smoke` runs both.
 *
 * Same rules as the main file: derive what is checked from the code rather than
 * from a list, and break what each block guards to watch it fail (the mutation
 * named in each block's comment).
 */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = rel => readFile(new URL(rel, root), 'utf-8')
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

/* ─────  A link from a Base page into a ToolBase page reloads  ─────
   ClientRouter fetched every tool page and article, found no router in it and
   loaded it again: two serial requests per card click (measured on /tools).
   crossesShell() names the ToolBase routes; it must agree with the layout each
   page file really uses, and every link component and literal link a Base page
   renders must ask for the reload.
   (mutations: widen the predicate to /learnings/ → fails; drop the spread from
   Card.astro → fails; drop the attribute from games.astro's link → fails) */
{
  const { crossesShell, shellLinkAttrs } = await import('../src/lib/shells.ts')
  const pagesDir = new URL('src/pages/', root)
  const files = (await readdir(pagesDir, { recursive: true })).filter(f => f.endsWith('.astro'))
  const shells = { ToolBase: [], Base: [] }
  for (const rel of files) {
    const src = await readFile(new URL(rel, pagesDir), 'utf-8')
    const layout = /import ToolBase from/.test(src) ? 'ToolBase' : /import Base from/.test(src) ? 'Base' : null
    if (!layout) continue
    // The URL a request for this file has: [param] → a sample segment, index → its folder.
    const path = '/' + rel.replace(/\\/g, '/').replace(/\.astro$/, '').replace(/(^|\/)index$/, '').replace(/\[\.\.\.[^\]]+\]|\[[^\]]+\]/g, 'x')
    shells[layout].push({ rel, path: path === '/' ? '/' : path.replace(/\/$/, ''), src })
  }
  assert.ok(shells.ToolBase.length >= 4 && shells.Base.length >= 6, `derived ${shells.ToolBase.length} ToolBase and ${shells.Base.length} Base pages — too few to be checking anything`)
  for (const { rel, path } of shells.ToolBase) assert.equal(crossesShell(path), true, `${rel} renders through ToolBase but crossesShell("${path}") is false: links to it would double-load`)
  for (const { rel, path } of shells.Base) assert.equal(crossesShell(path), false, `${rel} renders through Base but crossesShell("${path}") is true`)
  assert.deepEqual(shellLinkAttrs('/tools/chainsaw'), { 'data-astro-reload': '' })
  assert.deepEqual(shellLinkAttrs('/tools'), {})
  assert.deepEqual(shellLinkAttrs('https://example.com/tools/x'), {}, 'an external URL is never treated as a ToolBase page')

  for (const comp of ['src/components/Card.astro', 'src/components/RelatedLinks.astro']) {
    const code = stripComments(await read(comp))
    const anchors = [...code.matchAll(/<a\b[^>]*>/g)].map(m => m[0]).filter(a => /href=\{/.test(a))
    assert.ok(anchors.length > 0, `${comp} renders a link`)
    for (const a of anchors) assert.match(a, /\{\.\.\.shellLinkAttrs\(/, `${comp}: ${a.slice(0, 60)}… does not spread shellLinkAttrs()`)
  }
  for (const { rel, src } of shells.Base) {
    for (const m of stripComments(src).matchAll(/<a\b[^>]*\bhref="(\/[^"]*)"[^>]*>/g)) {
      if (crossesShell(m[1])) assert.match(m[0], /\bdata-astro-reload\b/, `${rel} links to ${m[1]} (a ToolBase page) without data-astro-reload`)
    }
  }
}
console.log('shells: every ToolBase route matches crossesShell(), and every Base-page link into one reloads instead of double-fetching')

/* ─────  llms.txt reads as sentences and names each tool's real job  ─────
   The summary joined `${tagline}. ${bio}` and the tagline ended in a full
   stop, so the first line every agent read said "games.. Four". Tool lines used
   the index's 160-character card line; they now carry the whole metaDescription.
   (mutations: restore the plain join → fails; use e.d for tools → fails) */
{
  const { GET } = await import('../src/pages/llms.txt.ts')
  const { tools } = await import('../src/config/tools.ts')
  const siteJson = JSON.parse(await read('src/config/site.json'))
  const longMeta = 'Checks the thing properly. '.repeat(10).trim()
  const fx = {
    site: { ...siteJson, tagline: 'A role line that ends in a stop.', bio: 'The bio.' },
    tools: [...tools, { slug: 'zz-meta', title: 'ZZ', description: 'Short card line.', metaDescription: longMeta, status: 'live' }],
  }
  const md = await (await GET({ locals: { runtime: { env: { SITE_CONFIG: { get: async key => fx[key] ?? null } } } } })).text()
  assert.match(md, /^> A role line that ends in a stop\. The bio\.$/m, 'the summary joins the role line and the bio with exactly one full stop')
  assert.doesNotMatch(md.split('\n').find(l => l.startsWith('> ')) ?? '', /\.\./, 'no doubled full stop in the summary')
  assert.ok(md.includes(`/tools/zz-meta): ${longMeta}\n`), 'a tool line carries its whole metaDescription, unclipped')
  const live = await (await GET({ locals: {} })).text()
  assert.doesNotMatch(live.split('\n').find(l => l.startsWith('> ')) ?? '', /\.\./, 'the shipped summary has no doubled full stop')
}
console.log('llms.txt: one full stop between the role line and the bio, and every tool line carries its full metaDescription')

/* ─────  The site's own copy promises nothing it cannot keep  ─────
   The footer and bio are what search engines and AI answers quote about the
   site. They say the work is offered as-is, and they do not undercut it.
   (mutation: put "Coded by AI" back in footerBio → fails) */
{
  const site = JSON.parse(await read('src/config/site.json'))
  assert.match(site.footerBio, /as-is/i, 'the footer says the tools and games are offered as-is')
  for (const field of ['tagline', 'bio', 'footerBio']) {
    assert.doesNotMatch(site[field], /coded by ai|zero slas?|just a developer|aren't built from scratch/i, `site.${field} still carries the retired copy`)
  }
  assert.doesNotMatch(site.tagline, /[.!?]$/, 'the tagline is a role line (it is the Person jobTitle and the home title), not a sentence')
}
console.log('site copy: the footer says as-is, the tagline is a plain role line, and the retired lines stay retired')

/* ─────  Hub share cards  ─────
   (mutation: delete public/og/hub-tools.png → fails) */
{
  const { ogHubCardFile } = await import('../src/lib/og.ts')
  const gen = await read('scripts/generate-og.mjs')
  for (const kind of ['tools', 'games', 'learnings']) {
    assert.match(gen, new RegExp(`ogHubCardFile\\('${kind}'\\)`), `generate-og.mjs renders the ${kind} hub card`)
    await readFile(new URL(`public/og/${ogHubCardFile(kind)}`, root)).then(b => assert.ok(b.length > 10_000, `public/og/${ogHubCardFile(kind)} is a real image`))
  }
  for (const page of ['src/pages/games.astro', 'src/pages/learnings.astro']) assert.match(await read(page), /existingOgHubCardPath\('/, `${page} shares with its hub card`)
  assert.match(gen, /process\.env\.CHROME_PATH/, 'the generator runs anywhere CHROME_PATH points, not only on macOS')
  assert.doesNotMatch(gen, /fonts\.googleapis/, 'cards use the vendored fonts, so a slow font fetch cannot rasterise them in the fallback serif')
}
console.log('share cards: every hub has a generated card on disk, and the generator needs no macOS and no network')

