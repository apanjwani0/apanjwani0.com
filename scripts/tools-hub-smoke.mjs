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

/* ─────  The hub's sections hold every live tool exactly once  ─────
   TOOL_GROUPS (src/lib/tools.ts) orders the hub. A live tool missing from it
   would fall to "More tools"; one named twice would render twice; a slug that
   is not a live tool is a dead entry. "Live diagnostics" says "these four" and
   must be exactly the server tools, whose count the intro also states.
   (mutations: drop regex-lab from its group → fails; name hash-smith twice →
   fails; move chainsaw out of live-diagnostics → fails) */
{
  const { TOOL_GROUPS, SERVER_TOOLS } = await import('../src/lib/tools.ts')
  const { tools } = await import('../src/config/tools.ts')
  const live = tools.filter(t => t.status === 'live').map(t => t.slug)
  const named = TOOL_GROUPS.flatMap(g => g.slugs)
  assert.equal(new Set(TOOL_GROUPS.map(g => g.id)).size, TOOL_GROUPS.length, 'group ids are unique (they are heading ids)')
  for (const slug of live) assert.equal(named.filter(s => s === slug).length, 1, `live tool "${slug}" must sit in exactly one hub group (found ${named.filter(s => s === slug).length})`)
  for (const slug of named) assert.ok(live.includes(slug), `a hub group names "${slug}", which is not a live tool`)
  const diag = TOOL_GROUPS.find(g => g.id === 'live-diagnostics')
  assert.ok(diag, 'the live-diagnostics group exists')
  assert.deepEqual([...diag.slugs].sort(), [...SERVER_TOOLS].sort(), 'live diagnostics is exactly the server tools')
  const WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6 }
  const said = diag.lede.match(/\bthese (\w+)\b/i)
  assert.ok(said && WORDS[said[1].toLowerCase()] === diag.slugs.length, `the live-diagnostics lede counts its tools in words ("these ${said?.[1]}") and must match ${diag.slugs.length}`)
  for (const g of TOOL_GROUPS) assert.match(g.lede, /^[A-Z].*\.$/, `the "${g.title}" lede is one full sentence`)

  const hub = await read('src/pages/tools/index.astro')
  const h1 = hub.match(/<h1>([^<]*)<\/h1>/)?.[1] ?? ''
  assert.ok(/tools/i.test(h1) && h1.trim().toLowerCase() !== 'tools', `the hub h1 says what the page is, not just "tools" (got "${h1}")`)
  assert.match(hub, /TOOL_GROUPS\.map\(/, 'the hub renders its sections from TOOL_GROUPS')
  assert.match(hub, /level=\{3\}/, 'cards under a section heading are h3')
  const kw = hub.match(/keywords="([^"]*)"/)?.[1] ?? ''
  assert.ok(kw.split(',').length <= 12 && kw.length <= 300, `the hub keywords meta stays short (${kw.split(',').length} terms, ${kw.length} chars): Google ignores it and a stuffed one reads as spam`)
  assert.match(hub, /existingOgHubCardPath\('tools'\)/, 'the hub shares with its own card, not the avatar')
}
console.log('hub sections: every live tool in exactly one group, live diagnostics is the server set, a real h1, short keywords, its own share card')

/* ─────  "try:" links open a real input in a live tool  ─────
   (mutations: point a try link at a wip slug → fails; break the Flowmap
   outline into an empty one → fails; change the cron demo to 30 3 → fails,
   because 03:30 in London is never skipped or repeated) */
{
  const { toolTries, CRON_TRY, FLOWMAP_TRY_OUTLINE } = await import('../src/lib/tool-tries.ts')
  const { decodeGraph } = await import('../src/lib/graph-text.ts')
  const { cwParse, cwZoneValid, CwZoneClock, cwCollectRuns } = await import('../src/components/tools/cron-whisperer/schedule.ts')
  const { crossesShell } = await import('../src/lib/shells.ts')
  const { tools } = await import('../src/config/tools.ts')
  const tries = toolTries()
  assert.ok(Object.keys(tries).length >= 3, 'the hub has try links')
  for (const [slug, t] of Object.entries(tries)) {
    assert.equal(tools.find(x => x.slug === slug)?.status, 'live', `a try link targets "${slug}", which is not a live tool`)
    assert.ok(t.href.startsWith(`/tools/${slug}`) && crossesShell(t.href), `the "${slug}" try link opens that tool`)
    assert.ok(t.label.length > 0 && t.label.length <= 40, `the "${slug}" try label fits the meta line`)
  }
  const g = decodeGraph(tries.flowmap.href.split('#g=')[1])
  assert.ok(g && g.nodes.length === FLOWMAP_TRY_OUTLINE.split('\n').length && g.edges.length === g.nodes.length - 1, 'the Flowmap try link decodes, through the tool\'s own decoder, to the whole outline as a tree')
  const params = new URLSearchParams(tries['cron-whisperer'].href.split('#')[1])
  assert.equal(params.get('e'), CRON_TRY.expr); assert.equal(params.get('tz'), CRON_TRY.zone)
  assert.ok(cwZoneValid(CRON_TRY.zone), 'the cron demo zone is valid')
  const from = Date.UTC(2027, 0, 1)
  const runs = cwCollectRuns(cwParse(CRON_TRY.expr), from, { untilMs: Date.UTC(2028, 0, 1) }, new CwZoneClock(CRON_TRY.zone, from))
  assert.ok(runs.some(r => r.dst === 'gap') && runs.some(r => r.dst === 'first' || r.dst === 'second'), 'the cron demo is skipped on one night and repeated on another: that is what the link is for')
  const hub = stripComments(await read('src/pages/tools/index.astro'))
  const dynamic = [...hub.matchAll(/<a\b[^>]*href=\{[^>]*>/g)].map(m => m[0])
  assert.ok(dynamic.length > 0, 'the hub renders its try links')
  for (const a of dynamic) assert.match(a, /\{\.\.\.shellLinkAttrs\(/, `hub link ${a.slice(0, 50)}… must spread shellLinkAttrs()`)
}
console.log('try links: each opens a live tool through the reload, the Flowmap board decodes whole, and the cron demo really hits both daylight-saving cases')

/* ─────  A board from a share link does not overwrite the visitor's own  ─────
   Flowmap's first sync() persisted whatever it showed, so opening any #g=
   link replaced the board saved in localStorage before a single edit.
   (mutations: drop the !this.fromLink guard → fails; drop the reset in
   pushSnapshot → fails) */
{
  const fm = stripComments(await read('src/components/tools/flowmap/Flowmap.ts'))
  const body = name => fm.match(new RegExp(`\\n  private ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n  \\}\\n`))?.[1] ?? ''
  assert.match(body('restore'), /decodeGraph\(hash\)[\s\S]*this\.fromLink = Boolean\(localStorage\.getItem\(FM_STORE\)\)/, 'a board read from #g= is held back exactly when a saved board exists to protect')
  assert.match(body('persist'), /if \(!this\.fromLink\) localStorage\.setItem\(FM_STORE/, 'a linked board is not written over the saved one')
  assert.match(body('pushSnapshot'), /this\.fromLink = false/, 'the first edit makes a linked board the visitor\'s own')
  const writes = [...fm.matchAll(/localStorage\.setItem\(FM_STORE\b/g)].length
  assert.equal(writes, 1, 'persist() is the one place the board is saved')
}
console.log('flowmap: a shared board is not saved over the visitor\'s board until they edit it')

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

/* ─────  JSON-LD for the hub  ─────
   (mutation: drop the description spread → fails) */
{
  const { collectionPageJsonLd } = await import('../src/lib/jsonld.ts')
  const ld = JSON.parse(collectionPageJsonLd({ name: 'n', description: 'd', url: 'https://x.test/tools', items: [{ name: 'A', url: 'https://x.test/tools/a', description: 'Does A.' }, { name: 'B', url: 'https://x.test/tools/b' }] }))
  assert.equal(ld['@type'], 'CollectionPage')
  assert.equal(ld.mainEntity['@type'], 'ItemList'); assert.equal(ld.mainEntity.numberOfItems, 2)
  assert.deepEqual(ld.mainEntity.itemListElement[0], { '@type': 'ListItem', position: 1, name: 'A', url: 'https://x.test/tools/a', description: 'Does A.' })
  assert.equal('description' in ld.mainEntity.itemListElement[1], false, 'an item without a description carries none')
  assert.ok(ld.mainEntity.itemListElement.every(i => !i.item), 'items keep the summary-page shape (a URL, not a typed WebApplication that Google would validate as a rich result)')
}
console.log('hub JSON-LD: a CollectionPage over a summary-shaped ItemList with one-line descriptions')

/* ─────  The 404 suggests real pages, and nothing to scanners  ─────
   (mutations: build the index before the scanner check → fails; echo the
   asked path into the markup → fails) */
{
  const nf = stripComments(await read('src/pages/404.astro'))
  const [front, template] = nf.split(/^---$/m).slice(1)
  assert.match(front, /isScannerPath\(asked\)\s*\?\s*\[\]\s*:\s*suggestPaths\(asked, buildSiteIndex\(/, 'a scanner path is answered before the site index is built')
  assert.doesNotMatch(template, /\{asked\}|Astro\.url/, 'the asked path is never echoed into the page')
  assert.match(template, /suggestions\.map\(e => <li><a href=\{e\.u\} \{\.\.\.shellLinkAttrs\(e\.u\)\}>/, 'suggestion links come from the index and use the shell reload')
}
console.log('404: suggestions come from the site index, scanners get none, and the asked path is never echoed')

/* ─────  /terms states what the code keeps  ─────
   Every retention the page promises is read from, or held to, the module that
   enforces it. (mutations: change BOARD_DAYS to 30 → fails; drop noindex →
   fails; drop the footer link → fails) */
{
  const terms = await read('src/pages/terms.astro')
  assert.match(terms, /import \{ WEBHOOK_BIN_TTL_MS \} from '\.\.\/lib\/webhook-store'/, 'the webhook retention is read from the store')
  const days = name => Number(terms.match(new RegExp(`const ${name} = (\\d+)`))?.[1])
  for (const [file, re] of [['src/lib/type-trial-leaderboard.ts', /DAILY_RETAINED_DAYS = (\d+)/], ['src/lib/hue-hunt-leaderboard.ts', /HUE_RETAINED_DAYS = (\d+)/]]) {
    assert.equal(days('BOARD_DAYS'), Number((await read(file)).match(re)?.[1]), `/terms says boards last ${days('BOARD_DAYS')} days; ${file} disagrees`)
  }
  for (const [file, re] of [['src/lib/visits.ts', /RETENTION_DAYS = (\d+)/], ['src/lib/analytics.ts', /ANALYTICS_RETENTION_DAYS = (\d+)/]]) {
    assert.equal(days('ANALYTICS_DAYS'), Number((await read(file)).match(re)?.[1]), `/terms says analytics last ${days('ANALYTICS_DAYS')} days; ${file} disagrees`)
  }
  assert.match(terms, /<Base[^>]*\bnoindex\b/, '/terms is noindex')
  assert.match(terms, /as-is/, '/terms says the site is offered as-is')
  const { indexablePaths, loadSiteConfigs } = await import('../src/lib/site-index.ts')
  assert.ok(!indexablePaths(await loadSiteConfigs({})).some(p => p.path === '/terms'), '/terms is not in the sitemap')
  assert.match(await read('src/components/Footer.astro'), /<a href="\/terms"/, 'every footer links /terms')
}
console.log('terms: retention numbers match the code, noindex, out of the sitemap, linked from every footer')

/* ─────  Polish: the sky rests, and focus rings the whole card  ─────
   (mutations: drop `&& !idle` → fails; arm the timer through onInput() at
   mount → fails; move the title's outline:none out of the @supports block →
   fails) */
{
  const sky = await read('src/lib/sky-ui.ts')
  assert.match(sky, /const run = !reduced && !document\.hidden && !idle/, 'the sky loop also stops when the visitor is idle')
  assert.match(sky, /window\.addEventListener\(type, onInput, \{ passive: true, signal: ac\.signal \}\)/, 'input listeners are passive and released with the sky')
  assert.match(sky, /teardown = \(\) => \{[\s\S]*clearTimeout\(idleTimer\)/, 'the idle timer is cleared on teardown')
  // Found in the browser check: arming it through the throttled input handler
  // skipped it whenever the sky mounted in a page's first second.
  assert.match(sky, /\n  sync\(\)\n(?:\s*\/\/.*\n)*\s*armIdle\(\)\n/, 'the idle timer is armed at mount, not through the throttled input handler')
  const shared = (await read('src/styles/shared.css')).replace(/\/\*[\s\S]*?\*\//g, '')
  const block = shared.match(/@supports selector\(:has\(\*\)\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.match(block, /:has\(\[data-type="card-title"\] a:focus-visible\)\s*\{[^}]*outline:\s*2px solid var\(--color-accent\)/, 'a focused card title rings the card')
  const outside = shared.replace(/@supports selector\(:has\(\*\)\) \{[\s\S]*?\n\}/, '')
  assert.doesNotMatch(outside, /card-title"\] a:focus-visible\s*\{[^}]*outline:\s*none/, 'the title loses its own ring only where :has() can draw the card\'s')
}
console.log('polish: the hub sky stops after 20 s idle, and a focused card is ringed whole (only where :has() exists)')

/* ─────  Every tool page fits a search result  ─────
   Google cuts a title at about 60 characters and a snippet at about 160; five
   tools ran to 174–214 and two titles past 60, so the end of each, often the
   part that said what the tool is for, never showed.
   (mutation: lengthen Token Bench's metaDescription past 160 → fails) */
{
  const { tools } = await import('../src/config/tools.ts')
  for (const t of tools.filter(x => x.status === 'live')) {
    const title = t.seoTitle || t.title
    assert.ok(title.length <= 60, `${t.slug}: seoTitle is ${title.length} characters ("${title}") — keep it within 60`)
    const d = t.metaDescription || t.description
    assert.ok(d.length <= 160, `${t.slug}: metaDescription is ${d.length} characters — keep it within 160`)
  }
}
console.log('tool pages: every live tool\'s title fits 60 characters and its description 160')

/* ─────  Two tools no longer shift on load  ─────
   Measured in the tool sweep: Flowmap opened its source drawer after
   Cytoscape loaded (0.115 CLS on a first visit), and Driftfield sized its
   canvas a frame late (0.108 on about half of loads).
   (mutations: move setSource back after the import → fails; drop the
   synchronous resizeAndRender → fails) */
{
  const fm = await read('src/components/tools/flowmap/Flowmap.ts')
  const cb = fm.slice(fm.indexOf('async connectedCallback()'), fm.indexOf('disconnectedCallback()'))
  assert.ok(cb.indexOf('this.setSource(') > -1 && cb.indexOf('this.setSource(') < cb.indexOf("await import('cytoscape')"), 'Flowmap opens its source drawer before awaiting Cytoscape')
  const wf = await read('src/components/tools/wallpaper-forge/WallpaperForge.ts')
  const wcb = wf.slice(wf.indexOf('  connectedCallback() {'), wf.indexOf('  disconnectedCallback() {'))
  assert.match(wcb, /this\.wire\(\)[\s\S]*?\n    this\.resizeAndRender\(\)\n[\s\S]*requestAnimationFrame/, 'Driftfield sizes its canvas synchronously at mount, with the frame as a fallback')
}
console.log('layout shift: Flowmap opens its drawer before Cytoscape loads, Driftfield sizes its canvas at mount')
