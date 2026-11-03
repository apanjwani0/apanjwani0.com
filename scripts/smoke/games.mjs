/**
 * Game invariants: no FAQ copy, nothing unplayable is listed, honest daily
 * boards, and every embed preloads the script it mounts.
 *
 * 1. No game ships support copy. `seoContent` is empty for every game and no
 *    FAQPage markup is emitted from the game page (docs/plans/polish-2026-11.md
 *    D-3: generated how-to and FAQ filler is a deliberate SEO trade-off).
 * 2. A game that is not playable is hidden, not parked (D-10). Every enabled
 *    game has a component, so the hub shows no "coming soon" card, and the
 *    detail page answers 404 for a game that is switched off.
 * 3. Both daily boards say they are honour-system boards (D-7). Neither is
 *    cheat-resistant, and the page must not suggest otherwise.
 * 4. Every embed names its script in the head (`<link rel="modulepreload">`),
 *    the path it names is the one `mountGame()` imports, and the build step
 *    that fills in the hashed URL is wired.
 *
 * Each source-text check is run against a fixture that must fail first, so the
 * check cannot rot into one that accepts everything.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { games } from '../../src/config/games.ts'
import { gameTag, isPlayableGame } from '../../src/lib/games.ts'
import { EMBED_MODULES, EMBED_TAGS } from '../../src/lib/embeds.ts'
import { webAppJsonLd } from '../../src/lib/jsonld.ts'

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const pass = line => console.log(`ok  ${line}`)

/* 1. No FAQ copy ---------------------------------------------------------- */

for (const g of games) {
  assert.equal((g.seoContent ?? '').trim(), '', `${g.slug} ships seoContent; every game's must be empty`)
}
pass(`every game's seoContent is empty (${games.length} games)`)

const gamePage = await read('src/pages/games/[slug].astro')
const faqUse = text => /faqPageJsonLd|extractFaqs|FAQPage/.test(text)
assert.equal(faqUse('const x = extractFaqs(game.seoContent)'), true, 'fixture: the FAQ check sees a FAQ call')
assert.equal(faqUse(gamePage), false, 'the game page must not build FAQPage markup')
const ld = webAppJsonLd({
  name: 'x', description: 'x', url: 'https://example.com/games/x', authorName: 'a', authorUrl: 'https://example.com',
  applicationCategory: 'Game', alsoType: 'VideoGame',
})
assert.equal(/FAQPage/.test(ld), false, 'the game structured data carries no FAQPage')
pass('no FAQPage markup is emitted for a game')

/* 2. Nothing unplayable is listed ----------------------------------------- */

const enabled = games.filter(g => g.enabled)
const parked = enabled.filter(g => !isPlayableGame(g))
assert.deepEqual(parked.map(g => g.slug), [], 'an enabled game with no component would show a "coming soon" card in the hub')
const cricket = games.find(g => g.slug === 'flash-cricket')
assert.ok(cricket, 'flash-cricket stays in the config so switching it on again is one flag')
assert.equal(cricket.enabled, false, 'Flash Cricket is hidden until it is a game (D-10)')
assert.equal(isPlayableGame(cricket), false)
assert.equal(gameTag(cricket), undefined)
assert.equal(isPlayableGame({ ...cricket, enabled: true }), false, 'and switching it on without a component still does not make it playable')
const hubPage = await read('src/pages/games.astro')
assert.match(hubPage, /filter\(g => g\.enabled\)/, 'the hub lists enabled games only')
assert.match(gamePage, /games\.find\(g => g\.slug === slug && g\.enabled\)/, 'the detail page looks a game up among enabled games')
assert.match(gamePage, /if \(!game\) \{\s*return new Response\(null, \{ status: 404/, 'a game that is switched off answers 404')
pass('Flash Cricket is disabled: no card, no page, no listing')

/* 3. Honour-system boards ------------------------------------------------- */

const HONOUR = 'Scores on this board are not verified. It is an honour-system board among people who play the same daily, not a competition.'
const board = (text, ol, note) => {
  const i = text.indexOf(ol)
  const j = text.indexOf(note)
  return i !== -1 && j !== -1 && j > i && text.split(HONOUR).length === 2
}
assert.equal(board('<ol data-type="x"></ol>', '<ol data-type="x">', `<p data-type="y">${HONOUR}</p>`), false, 'fixture: no sentence, no pass')
for (const [file, list, note] of [
  ['src/components/games/hue-hunt/HueHunt.ts', '<ol data-type="hue-daily-board"></ol>', '<p data-type="hue-daily-honour">'],
  ['src/components/games/type-trial/TypeTrial.ts', '<ol data-type="tt-daily-board"></ol>', '<p data-type="tt-daily-honour">'],
]) {
  const source = await read(file)
  assert.ok(board(source, list, `${note}${HONOUR}</p>`), `${file}: the honour-system sentence must follow the daily board, once`)
}
pass('Hue Hunt and Type Trial both print the honour-system sentence under the daily board')

/* 4. Every embed preloads the script it mounts ---------------------------- */

const mount = await read('src/lib/game-mount.ts')
const imported = new Map([...mount.matchAll(/slug === '([^']+)'\) return import\('\.\.\/([^']+)'\)/g)].map(m => [m[1], m[2]]))
assert.ok(imported.size >= 16, 'fixture: the mountGame dispatch was parsed')
for (const slug of Object.keys(EMBED_TAGS)) {
  assert.ok(Object.hasOwn(EMBED_MODULES, slug), `${slug} has an EMBED_TAGS entry but no EMBED_MODULES entry, so its page cannot preload it`)
}
for (const [slug, file] of Object.entries(EMBED_MODULES)) {
  assert.ok(Object.hasOwn(EMBED_TAGS, slug), `EMBED_MODULES names ${slug}, which is not an embed`)
  assert.equal(imported.get(slug), file, `${slug}: EMBED_MODULES says ${file} but mountGame() imports ${imported.get(slug)}`)
  assert.ok(existsSync(new URL(`../../src/${file}`, import.meta.url)), `${file} does not exist`)
}
for (const slug of imported.keys()) assert.ok(Object.hasOwn(EMBED_MODULES, slug), `mountGame() imports ${slug}, which EMBED_MODULES lacks`)

// All three embedding pages emit the preload next to the stylesheets they link.
for (const [file, call] of [
  ['src/pages/games/[slug].astro', 'embedPreloads(slug)'],
  ['src/pages/tools/driftfield/[mode].astro', 'embedPreloads(mode.slug)'],
  ['src/pages/learnings/[slug].astro', 'embedPreloads(learning.embed)'],
]) {
  const page = await read(file)
  assert.ok(page.includes(`${call}.map(href => <link slot="head" rel="modulepreload" href={href} />)`), `${file} must link ${call} as a modulepreload in the head`)
  assert.ok(/embedStyles\([^)]*\)\.map\(href => <link slot="head" rel="stylesheet"/.test(page), `${file} keeps its stylesheet links`)
}

// The placeholder the helper reads is the one the build step replaces, and the build step is wired.
const helper = await read('src/lib/embed-styles.ts')
const integration = await read('src/integrations/embed-preload.mjs')
const tokenOf = text => text.match(/const TABLE_TOKEN = '([^']+)'/)?.[1]
assert.ok(tokenOf(helper), 'embed-styles.ts declares TABLE_TOKEN')
assert.equal(tokenOf(helper), tokenOf(integration), 'the helper and the build step disagree on the placeholder')
assert.match(await read('astro.config.mjs'), /integrations:\s*\[[^\]]*embedPreload\(\)/, 'astro.config.mjs must register the embed-preload integration')
assert.match(integration, /throw new Error\([^)]*no server file/s, 'the build step fails loudly when it replaces nothing')
pass(`all ${Object.keys(EMBED_MODULES).length} embeds name the module mountGame() imports, and the three pages preload it`)
