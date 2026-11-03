/**
 * Invariants for the markup that search and answer engines read: the one
 * Person / one WebSite entity, no keywords, honest dates, share-card images and
 * the robots meta. Standalone, run by `npm run security:smoke` through
 * scripts/run-smoke.mjs. Plan: docs/plans/polish-2026-11.md, sections 2A and 2B.
 *
 * Each block names the mutation that must make it fail.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import {
  blogPostingJsonLd, breadcrumbListJsonLd, collectionPageJsonLd, itemListJsonLd,
  personId, profilePageJsonLd, webAppJsonLd, webSiteId, webSiteJsonLd,
} from '../../src/lib/jsonld.ts'
import { embedPagePath, wordCount } from '../../src/lib/learnings.ts'
import { loadSiteConfigs, realDate } from '../../src/lib/site-index.ts'
import { GET as sitemapGET } from '../../src/pages/sitemap.xml.ts'
import { site } from '../../src/config/site.ts'
import { tools } from '../../src/config/tools.ts'
import { games } from '../../src/config/games.ts'
import { learnings } from '../../src/config/learnings.ts'
import { DRIFTFIELD_MODES } from '../../src/lib/driftfield.ts'
import { isPlayableGame } from '../../src/lib/games.ts'

const root = new URL('../../', import.meta.url)
const read = rel => readFile(new URL(rel, root), 'utf-8')
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const base = site.url.replace(/\/$/, '')
const PERSON = `${base}/#person`
const WEBSITE = `${base}/#website`

/** Every object in a parsed JSON-LD value, depth first. */
function* nodes(value) {
  if (Array.isArray(value)) { for (const v of value) yield* nodes(v); return }
  if (value && typeof value === 'object') { yield value; for (const v of Object.values(value)) yield* nodes(v) }
}

// One of each kind of page, built the way the pages build them.
const liveTool = tools.find(t => t.status === 'live' && existsSync(new URL(`public/og/tools-${t.slug}.png`, root)))
const playable = games.find(g => isPlayableGame(g) && existsSync(new URL(`public/og/games-${g.slug}.png`, root)))
assert.ok(liveTool && playable, 'a live tool and a playable game with a share card on disk exist to check against')
const article = learnings.find(l => l.published)
const sample = {
  home: [
    profilePageJsonLd({ name: site.name, url: site.url, alternateName: site.handle, jobTitle: site.tagline, description: site.bio, sameAs: ['https://github.com/x'], image: `${site.url}/avatar.webp` }),
    webSiteJsonLd({ name: site.name, url: site.url, description: site.bio, authorName: site.name }),
  ],
  article: blogPostingJsonLd({
    headline: article.title, description: article.summary, url: `${site.url}/learnings/${article.slug}`,
    datePublished: article.date, dateModified: article.updated, authorName: site.name, authorUrl: site.url,
    wordCount: wordCount(article.content), aboutApps: [`${site.url}/games/${playable.slug}`],
  }),
  post: blogPostingJsonLd({ headline: 'h', description: 'd', url: `${site.url}/blogs/x`, datePublished: '2026-01-01', authorName: site.name, authorUrl: site.url }),
  tool: webAppJsonLd({
    name: liveTool.title, description: liveTool.description, url: `${site.url}/tools/${liveTool.slug}`,
    authorName: site.name, authorUrl: site.url, applicationCategory: 'DeveloperApplication', keywords: 'a, b',
  }),
  game: webAppJsonLd({
    name: playable.title, description: playable.description, url: `${site.url}/games/${playable.slug}`,
    authorName: site.name, authorUrl: site.url, applicationCategory: 'Game', alsoType: 'VideoGame', keywords: 'a, b', featureList: ['x'],
  }),
  hubs: [
    itemListJsonLd('n', [{ name: 'a', url: `${site.url}/a` }]),
    collectionPageJsonLd({ name: 'n', description: 'd', url: `${site.url}/tools`, items: [{ name: 'a', url: `${site.url}/a`, description: 'x' }] }),
    breadcrumbListJsonLd([{ name: 'home', url: site.url }]),
  ],
}
const everyBlock = [...sample.home, sample.article, sample.post, sample.tool, sample.game, ...sample.hubs].map(s => JSON.parse(s))

/* ─────  One entity: the Person and the WebSite are defined once  ─────
   The Person on `/` had no @id, so every author on the other pages was a bare
   name nothing could merge back into it. The ids are defined exactly once each
   (a node with a @type), and every author / publisher is a reference to them.
   (mutations: drop '@id' from personNode → fails; give blogPostingJsonLd's
   author a '@type' and a url → fails; define the Person a second time in
   webSiteJsonLd → fails)  */
{
  assert.equal(personId(site.url), PERSON)
  assert.equal(webSiteId(site.url), WEBSITE)
  const all = everyBlock.flatMap(b => [...nodes(b)])
  const defs = id => all.filter(n => n['@id'] === id && n['@type'] !== undefined)
  assert.equal(defs(PERSON).length, 1, 'the Person is defined exactly once across the site\'s markup')
  assert.equal(defs(WEBSITE).length, 1, 'the WebSite is defined exactly once across the site\'s markup')
  assert.equal(defs(PERSON)[0]['@type'], 'Person')
  const profile = everyBlock.find(b => b['@type'] === 'ProfilePage')
  assert.equal(profile.mainEntity['@id'], PERSON, 'the home Person is the ProfilePage\'s main entity')
  assert.equal(profile.mainEntity.alternateName, site.handle)
  assert.ok(profile.mainEntity.knowsAbout.length >= 5, 'the Person says what it knows about')
  assert.equal(JSON.parse(sample.home[1]).publisher['@id'], PERSON)

  let refs = 0
  for (const block of everyBlock) {
    for (const n of nodes(block)) {
      for (const key of ['author', 'publisher']) {
        if (!(key in n)) continue
        refs += 1
        assert.deepEqual(Object.keys(n[key]).sort(), ['@id', 'name'], `${n['@type']} ${key} is an @id reference plus a name, not a second definition`)
        assert.equal(n[key]['@id'], PERSON, `${n['@type']} ${key} points at the one Person`)
      }
    }
  }
  assert.ok(refs >= 5, `checked ${refs} author/publisher references: the article, the post, the tool, the game and the WebSite`)
  for (const key of ['tool', 'game', 'article', 'post']) {
    assert.equal(JSON.parse(sample[key]).isPartOf['@id'], WEBSITE, `a ${key} page is part of the one WebSite`)
  }
  console.log('one entity: #person and #website defined once, every author/publisher references them by @id')
}

/* ─────  No keywords anywhere in the markup  ─────
   Decision D7: Google ignores the meta tag and a stuffed list reads as spam.
   The config `keywords` fields stay: the palette uses them as synonyms.
   (mutations: re-add `keywords` to webAppJsonLd's output → fails; put
   <meta name="keywords"> back in Head.astro → fails)  */
{
  for (const block of everyBlock) {
    for (const n of nodes(block)) assert.equal('keywords' in n, false, `no JSON-LD ${n['@type']} carries keywords`)
  }
  const head = stripComments(await read('src/components/Head.astro'))
  assert.equal(/name=["']keywords["']/.test(head), false, 'Head.astro emits no keywords meta')
  console.log('no keywords: absent from every JSON-LD object and from Head.astro')
}

/* ─────  Dates are real or absent  ─────
   `<lastmod>` only for a page with an authored date, in YYYY-MM-DD form: an
   article's `updated`, else its `date`. Games, tools, modes and presets have no
   date and so no lastmod; nothing is stamped from "now".
   (mutations: stamp new Date() as lastmod → fails; let a bad date through
   realDate → fails; ignore `updated` → fails; give games a lastmod → fails)  */
{
  assert.equal(realDate('2026-10-01'), '2026-10-01')
  for (const bad of [undefined, '', 'yesterday', '2026-2-3', '2026-02-31', '2026-13-01', '2026-10-01T00:00:00Z', ' 2026-10-01']) {
    assert.equal(realDate(bad), undefined, `${JSON.stringify(bad)} is not a real date`)
  }
  for (const l of learnings) {
    if (l.updated === undefined) continue
    assert.ok(realDate(l.updated), `${l.slug}: updated is a real YYYY-MM-DD date`)
    assert.ok(l.updated >= l.date, `${l.slug}: updated is not before date`)
  }
  const fx = {
    learnings: [
      ...learnings,
      { slug: 'zz-revised', title: 't', summary: 's', date: '2026-03-01', updated: '2026-04-05', content: 'body', published: true },
      { slug: 'zz-bad-date', title: 't', summary: 's', date: '2026-02-31', content: 'body', published: true },
      { slug: 'zz-bad-updated', title: 't', summary: 's', date: '2026-03-02', updated: 'soon', content: 'body', published: true },
    ],
    blogs: [{ title: 'p', href: '/blogs/zz-post', date: '2026-05-06', summary: 's' }, { title: 'q', href: '/blogs/zz-undated', date: 'May', summary: 's' }],
    site: { ...site, sections: { ...site.sections, blogs: true, projects: true } },
  }
  const locals = { runtime: { env: { SITE_CONFIG: { get: async key => fx[key] ?? null } } } }
  const xml = await (await sitemapGET({ locals })).text()
  const entries = [...xml.matchAll(/<url><loc>([^<]*)<\/loc>(?:<lastmod>([^<]*)<\/lastmod>)?<\/url>/g)].map(m => ({ loc: m[1], lastmod: m[2] }))
  assert.ok(entries.length > 10, 'parsed the sitemap')
  const lastmodOf = path => entries.find(e => e.loc === `${base}${path}`)?.lastmod
  for (const e of entries) {
    if (e.lastmod === undefined) continue
    assert.match(e.lastmod, /^\d{4}-\d{2}-\d{2}$/, `${e.loc}: lastmod is YYYY-MM-DD`)
    assert.equal(realDate(e.lastmod), e.lastmod, `${e.loc}: lastmod is a real calendar day`)
    assert.ok(/\/(blogs|learnings)(\/|$)/.test(new URL(e.loc).pathname), `${e.loc}: only a page with an authored date carries a lastmod`)
  }
  const today = new Date().toISOString().slice(0, 10)
  assert.equal(entries.some(e => e.lastmod === today) && !learnings.some(l => l.date === today || l.updated === today), false, 'no lastmod is stamped from now')
  assert.equal(lastmodOf('/learnings/zz-revised'), '2026-04-05', 'an article\'s lastmod is its updated date')
  assert.equal(lastmodOf('/learnings/zz-bad-updated'), '2026-03-02', 'a bad updated falls back to the publish date')
  assert.equal(lastmodOf('/learnings/zz-bad-date'), undefined, 'an impossible date yields no lastmod')
  assert.equal(lastmodOf('/blogs/zz-undated'), undefined, 'an unparseable post date yields no lastmod')
  assert.equal(lastmodOf('/blogs/zz-post'), '2026-05-06')
  const newestReal = [...learnings.filter(l => l.published).map(l => l.updated ?? l.date), '2026-04-05', '2026-03-02'].sort().at(-1)
  assert.equal(lastmodOf('/learnings'), newestReal, 'the learnings hub is stamped with its newest real date')
  for (const t of tools.filter(t => t.status === 'live')) assert.equal(lastmodOf(`/tools/${t.slug}`), undefined, `/tools/${t.slug} has no authored date, so no lastmod`)
  for (const g of games.filter(isPlayableGame)) assert.equal(lastmodOf(`/games/${g.slug}`), undefined, `/games/${g.slug} has no authored date, so no lastmod`)
  assert.equal(lastmodOf('/'), undefined)
  const configs = await loadSiteConfigs({})
  assert.ok(configs.learnings.length > 0)

  // The JSON-LD side: dateModified exists only when it was passed.
  const withUpdated = JSON.parse(blogPostingJsonLd({ headline: 'h', description: 'd', url: `${base}/a`, datePublished: '2026-01-01', dateModified: '2026-02-02', authorName: 'n', authorUrl: base }))
  const without = JSON.parse(blogPostingJsonLd({ headline: 'h', description: 'd', url: `${base}/a`, datePublished: '2026-01-01', authorName: 'n', authorUrl: base }))
  assert.equal(withUpdated.dateModified, '2026-02-02')
  assert.equal('dateModified' in without, false, 'no dateModified without a real update')
  const head = stripComments(await read('src/components/Head.astro'))
  assert.match(head, /modifiedTime && <meta property="article:modified_time"/, 'article:modified_time is emitted only when a modified time exists')
  assert.match(head, /property="article:author" content=\{authorUrl\}/, 'article:author is the home URL, not the site name')
  assert.match(head, /articleTags\.map\(/, 'article:tag is emitted from the tags')
  assert.match(head, /\.slice\(0, 5\)/, 'at most five article:tag')
  console.log('dates: lastmod only from a real YYYY-MM-DD date; dateModified and article:modified_time only from `updated`')
}

/* ─────  A learning that embeds a tool or game is about it  ─────
   (mutations: let embedPagePath return a path for a wip Driftfield → fails;
   drop `about` from blogPostingJsonLd → fails; count link URLs as words → fails)  */
{
  const gameEmbed = games.find(isPlayableGame).slug
  assert.equal(embedPagePath(gameEmbed, games, tools), `/games/${gameEmbed}`)
  assert.equal(embedPagePath('diagram-atlas', games, tools), undefined, 'a figure with no page of its own is about nothing')
  assert.equal(embedPagePath(undefined, games, tools), undefined)
  const mode = DRIFTFIELD_MODES[0].slug
  const live = tools.map(t => (t.slug === 'driftfield' ? { ...t, status: 'live' } : t))
  const wip = tools.map(t => (t.slug === 'driftfield' ? { ...t, status: 'wip' } : t))
  assert.equal(embedPagePath(mode, games, live), `/tools/driftfield/${mode}`)
  assert.equal(embedPagePath(mode, games, wip), undefined, 'a noindex Driftfield mode is not claimed as a subject')
  const ld = JSON.parse(sample.article)
  assert.deepEqual(ld.about, [{ '@type': 'WebApplication', url: `${base}/games/${playable.slug}` }])
  assert.deepEqual(ld.mainEntityOfPage, { '@type': 'WebPage', '@id': `${base}/learnings/${article.slug}` })
  assert.equal(ld.inLanguage, 'en')
  assert.ok(ld.wordCount > 100 && ld.wordCount === wordCount(article.content))
  assert.equal(wordCount('one [two three](https://example.com/a-b-c-d) four\n\n{{embed}}\n\n:::note x\n:::'), 4, 'a link counts as its text; figure markers and fences are not words')
  assert.equal('about' in JSON.parse(sample.post), false)
  console.log('articles: about, mainEntityOfPage, inLanguage and wordCount')
}

/* ─────  A WebApplication carries its share card  ─────
   (mutations: drop `image` from webAppJsonLd → fails; derive the file name
   wrong → fails)  */
{
  for (const [key, entry, kind] of [['tool', liveTool, 'tools'], ['game', playable, 'games']]) {
    const ld = JSON.parse(sample[key])
    assert.equal(ld.image, `${base}/og/${kind}-${entry.slug}.png`, `the ${key} page's WebApplication names its 1200x630 card`)
  }
  for (const t of tools.filter(t => t.status === 'live')) {
    const url = `${base}/tools/${t.slug}`
    const ld = JSON.parse(webAppJsonLd({ name: t.title, description: t.description, url, authorName: site.name, authorUrl: site.url }))
    assert.equal('image' in ld, existsSync(new URL(`public/og/tools-${t.slug}.png`, root)), `${t.slug}: image is present exactly when its card exists`)
  }
  const mode = DRIFTFIELD_MODES[0].slug
  const modeLd = JSON.parse(webAppJsonLd({ name: 'm', description: 'd', url: `${base}/tools/driftfield/${mode}`, authorName: site.name, authorUrl: site.url }))
  assert.equal(modeLd.image, `${base}/og/tools-driftfield-${mode}.png`)
  const none = JSON.parse(webAppJsonLd({ name: 'x', description: 'd', url: `${base}/tools/zz-no-such-card`, authorName: site.name, authorUrl: site.url }))
  assert.equal('image' in none, false, 'a page with no card on disk names no image')
  const preset = JSON.parse(webAppJsonLd({ name: 'x', description: 'd', url: `${base}/tools/cron-whisperer/every-minute`, authorName: site.name, authorUrl: site.url }))
  assert.equal('image' in preset, false, 'a Cron Whisperer preset has no card and names none')
  console.log('WebApplication: image is the share card when it exists, isPartOf the WebSite')
}

/* ─────  Head: robots, discovery links  ─────
   `noindex, follow` keeps a coming-soon page's links crawled; the feed, llms.txt
   and the Markdown twin are advertised for agents.
   (mutations: put nofollow back → fails; drop the feed link → fails; emit the
   Markdown link unconditionally → fails)  */
{
  const head = stripComments(await read('src/components/Head.astro'))
  assert.match(head, /noindex\s*\n?\s*\?\s*<meta name="robots" content="noindex, follow" \/>/, 'a noindex page says "noindex, follow"')
  assert.equal(/nofollow/.test(head), false, 'nothing in Head says nofollow')
  assert.match(head, /<link rel="alternate" type="application\/atom\+xml" title="Learnings" href="\/feed\.xml" \/>/)
  assert.match(head, /<link rel="alternate" type="text\/plain" href="\/llms\.txt" \/>/)
  assert.match(head, /markdownAlternate && <link rel="alternate" type="text\/markdown" href=\{markdownAlternate\} \/>/, 'the Markdown twin is linked only where a page names one')
  assert.equal((head.match(/rel="alternate"/g) ?? []).length, 3)
  const baseLayout = stripComments(await read('src/layouts/Base.astro'))
  for (const prop of ['modifiedTime', 'tags', 'markdownAlternate']) {
    assert.match(baseLayout, new RegExp(`${prop}=\\{${prop}\\}`), `Base.astro passes ${prop} to Head`)
  }
  const learningPage = stripComments(await read('src/pages/learnings/[slug].astro'))
  assert.match(learningPage, /markdownAlternate=\{[^}]*\/learnings\/\$\{learning\.slug\}\.md/, 'an article page names its Markdown twin')
  console.log('head: noindex, follow; feed, llms.txt and markdown alternates')
}
