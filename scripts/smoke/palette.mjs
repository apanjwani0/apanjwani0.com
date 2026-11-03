/**
 * The command palette: /search.json, the ranking, the dialog's wiring, and the
 * dead starred-tools "kit" staying deleted.
 *
 * 1. /search.json lists exactly the pages the sitemap does (a project entry is
 *    `/projects#card`, so compared without the fragment), in the short-key
 *    shape the client reads, cacheable like a page, and built from nothing
 *    about the visitor.
 * 2. `rankEntries` puts the Cron Whisperer first for "cron" (not one of its
 *    fourteen presets), caps the variations, and refuses nonsense.
 * 3. find-ui.ts mounts on `astro:page-load`, never imports the router, builds
 *    its links with `shellLinkAttrs`, writes text with textContent only, and
 *    carries the dialog / listbox / activedescendant roles.
 * 4. Nav.astro renders the palette button and no shortcuts button.
 * 5. No identifier of the removed kit remains in src.
 *
 * Mutations: drop shellLinkAttrs from find-ui -> 3 fails; hide a kind in
 * search.json -> 1 fails; re-add `data-kit` to ROOT_BOOT_JS -> 5 fails; import
 * 'astro:transitions/client' in find-ui -> 3 fails; give rankEntries' kind bonus
 * to presets over tools -> 2 fails.
 */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const root = new URL('../../', import.meta.url)
const read = rel => readFile(new URL(rel, root), 'utf-8')
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')

const { GET } = await import('../../src/pages/search.json.ts')
const { buildSiteIndex, indexablePaths, loadSiteConfigs } = await import('../../src/lib/site-index.ts')
const { rankEntries } = await import('../../src/lib/fuzzy.ts')

/* ── 1. /search.json is the sitemap's page set ── */
{
  const configs = await loadSiteConfigs({})
  const response = await GET({ locals: {} })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('Content-Type') ?? '', /^application\/json/)
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=0, s-maxage=600', 'cached at the edge like a page')
  const body = await response.json()
  assert.ok(Array.isArray(body) && body.length > 0)
  for (const e of body) {
    assert.deepEqual(Object.keys(e).filter(k => !['t', 'u', 'k', 'd', 'w'].includes(k)), [], 'only the short keys t, u, k, d, w')
    assert.ok(typeof e.t === 'string' && typeof e.u === 'string' && typeof e.k === 'string')
    assert.match(e.u, /^\/(?![/\\])/, `${e.u} is a same-site path`)
  }
  const served = new Set(body.map(e => e.u.split('#')[0]))
  const sitemap = new Set(indexablePaths(configs).map(p => p.path))
  assert.deepEqual([...served].sort(), [...sitemap].sort(), '/search.json lists exactly the pages the sitemap serialises')
  assert.equal(body.length, buildSiteIndex(configs).length, 'one entry per site-index entry, none dropped or added')

  const route = stripComments(await read('src/pages/search.json.ts'))
  assert.equal(/headers\.get|cookies|getClientIp|request\./.test(route), false, 'the index is built from the site alone, nothing about the visitor')
  console.log(`palette: /search.json lists the ${sitemap.size} pages of the sitemap (${body.length} entries), cached like a page, with no per-visitor input`)
}

/* ── 2. Ranking ── */
{
  const entries = buildSiteIndex(await loadSiteConfigs({}))
  const top = q => rankEntries(q, entries).map(r => r.entry.u)
  assert.equal(top('cron')[0], '/tools/cron-whisperer', '"cron" finds the tool before any preset')
  assert.equal(top('json')[0], '/tools/json-tidy')
  assert.equal(top('jt')[0], '/tools/json-tidy', 'initials find a two-word title')
  assert.equal(top('webhook')[0], '/tools/webhook-inspector')
  assert.ok(rankEntries('cron', entries).length <= 8, 'at most eight results')
  assert.ok(rankEntries('cron', entries).filter(r => r.entry.k === 'preset' || r.entry.k === 'mode').length <= 3, 'presets and modes may not crowd the list')
  assert.deepEqual(rankEntries('qqqxzv', entries), [], 'nothing in common gets nothing')
  assert.deepEqual(rankEntries('x'.repeat(500), entries), [], 'an over-long query is refused')
  const empty = rankEntries('', entries)
  assert.ok(empty.length > 0 && empty.length <= 8 && empty.every(r => r.entry.k === 'section' || r.entry.k === 'tool'), 'no query lists the pages and tools')
  const stable = JSON.stringify(rankEntries('cron', entries))
  assert.equal(JSON.stringify(rankEntries('cron', entries)), stable, 'ranking is deterministic')
  assert.ok(top('a').length <= 8)
  assert.ok(rankEntries('cron', entries)[0].hits.length === 4, 'the matched letters come back for highlighting')
  console.log('palette: "cron" ranks the Cron Whisperer first, results are capped at eight with at most three presets or modes, nonsense finds nothing')
}

/* ── 3. The dialog's wiring ── */
{
  const src = stripComments(await read('src/lib/find-ui.ts'))
  assert.equal(/astro:transitions\/client/.test(src), false, 'find-ui must not import the router: it loads on ToolBase pages')
  assert.ok(/addEventListener\('astro:page-load', onPageLoad\)/.test(src), 'it mounts on astro:page-load')
  assert.ok(/import \{ shellLinkAttrs \} from '\.\/shells'/.test(src) && /\.\.\.shellLinkAttrs\(entry\.u\)/.test(src),
    'every result link carries shellLinkAttrs, so a link into a ToolBase page reloads')
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), false, 'text from the index goes in through textContent and text nodes only')
  for (const needle of ["role: 'dialog'", "'aria-modal': 'true'", "role: 'listbox'", "role: 'combobox'", "role: 'option'", "'aria-activedescendant'", "case 'Escape'", "case 'ArrowDown'", "case 'Enter'", "case 'Tab'"]) {
    assert.ok(src.includes(needle), `find-ui.ts carries ${needle}`)
  }
  assert.ok(/MESSAGES\s*=\s*\{[\s\S]*empty: "Nothing matches that yet\. Try a tool's name or what it does\."/.test(src), 'the empty state is a plain sentence')
  assert.ok(/abortLoad\?\.abort\(\)/.test(src), 'closing aborts a request still in flight')
  assert.ok(/if \(index\) return Promise\.resolve\(index\)/.test(src) && /if \(inflight\) return inflight/.test(src), 'the index is fetched once and memoised')
  assert.equal(/localStorage|sessionStorage|indexedDB|document\.cookie/.test(src), false, 'the palette stores nothing: no recent searches (/terms)')
  assert.ok(/initFindUI\(\)/.test(await read('src/lib/site-ui.ts')), 'initSiteUI mounts the palette')
  for (const layout of ['Base', 'ToolBase']) {
    assert.ok((await read(`src/layouts/${layout}.astro`)).includes("import '../styles/palette.css'"), `${layout} carries the palette stylesheet`)
  }
  const css = stripComments(await read('src/styles/palette.css'))
  assert.equal(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(css), false, 'palette.css names no literal colour')
  assert.ok(/z-index:\s*calc\(var\(--z-skip\) \+ 1\)/.test(css), 'the dialog sits above the nav and the skip link, through the layer token')
  assert.ok(/transition:\s*opacity var\(--motion-base\)/.test(css) && /prefers-reduced-motion: reduce/.test(css), 'one eased fade, off under prefers-reduced-motion')
  console.log('palette: find-ui mounts on astro:page-load, never imports the router, links through shellLinkAttrs, writes text only, stores nothing')
}

/* ── 4. The nav button ── */
{
  const nav = await read('src/components/Nav.astro')
  assert.ok(/<button[^>]*data-action="palette"/.test(nav), 'Nav renders the palette button')
  assert.equal(/data-action="shortcuts"/.test(nav), false, 'Nav renders no shortcuts button: there is no ? sheet')
  console.log('palette: the nav renders the palette button and no shortcuts button')
}

/* ── 5. The starred-tools kit stays deleted ── */
{
  const files = []
  const walk = async dir => {
    for (const e of await readdir(new URL(dir, root), { withFileTypes: true })) {
      if (e.isDirectory()) await walk(`${dir}${e.name}/`)
      else if (/\.(ts|astro|css|mjs|js|json)$/.test(e.name)) files.push(`${dir}${e.name}`)
    }
  }
  await walk('src/')
  assert.ok(files.length > 100, 'walked the tree')
  const found = []
  for (const f of files) {
    const text = await read(f)
    for (const id of ['KIT_KEY', 'KIT_MAX', 'KIT_PARAM', 'kit:v1', 'data-kit', 'initKitUI', 'parseKitParam', 'bookmarksFile', 'kit-star', 'kit-shelf']) {
      if (text.includes(id)) found.push(`${f}: ${id}`)
    }
  }
  assert.deepEqual(found, [], 'no identifier of the removed kit remains in src')
  for (const gone of ['src/lib/kit.ts', 'src/lib/kit-ui.ts']) {
    await assert.rejects(readFile(new URL(gone, root)), `${gone} stays deleted`)
  }
  const { ROOT_BOOT_JS, ROOT_STATE_ATTRS } = await import('../../src/lib/theme.ts')
  assert.equal(/kit/i.test(ROOT_BOOT_JS), false, 'the head bootstrap carries nothing of the kit')
  assert.deepEqual([...ROOT_STATE_ATTRS], ['data-theme', 'data-theme-pref', 'data-js'])
  console.log('palette: no kit identifier remains in src, the head bootstrap and the swap patch carry only the theme and data-js')
}
