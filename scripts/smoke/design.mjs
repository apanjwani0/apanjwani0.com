/**
 * Design-system invariants: the tokens polish pass (docs/plans/polish-2026-11.md
 * 5A-5D, 5F), kept in their own file so unrelated changes do not fight over
 * scripts/security-smoke.mjs. `npm run security:smoke` runs every file here.
 *
 * Same rules as the other smoke files: derive what is checked from the code,
 * and break what each block guards to watch it fail (the mutation is named in
 * each block's comment).
 */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { safeEmailAddress, validateConfigData } from '../../src/lib/config-schema.ts'

const root = new URL('../../', import.meta.url)
const read = rel => readFile(new URL(rel, root), 'utf-8')
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

/** The text between the braces of the first rule whose head matches, with nesting respected. */
function blockAfter(css, head) {
  const at = css.search(head)
  assert.notEqual(at, -1, `no rule matching ${head}`)
  const open = css.indexOf('{', at)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  throw new Error(`unbalanced braces after ${head}`)
}

const theme = stripComments(await read('src/styles/theme.css'))
const shared = stripComments(await read('src/styles/shared.css'))
const globalCss = stripComments(await read('src/styles/global.css'))
const lightBlock = blockAfter(theme, /(^|[};])\s*:root\s*\{/)
const darkBlock = blockAfter(theme, /\[data-theme="dark"\]\s*\{/)
const token = (block, name) => block.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`))?.[1].trim()

/* ─────  Warning ink: defined in both palettes and legible on every surface  ─────
   (mutations: set the light --color-warning to #d98e04 → fails; delete the dark
   --color-warning-soft → fails) */
{
  const lum = hex => {
    const c = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const hex = (block, name) => {
    const v = token(block, `color-${name}`)
    assert.match(v ?? '', /^#[0-9a-fA-F]{6}$/, `--color-${name} is a six-digit hex colour`)
    return v.toLowerCase()
  }
  for (const [name, block, fallback] of [['light', lightBlock, lightBlock], ['dark', darkBlock, lightBlock]]) {
    const pick = n => (token(block, `color-${n}`) ? hex(block, n) : hex(fallback, n))
    for (const ground of ['bg', 'surface', 'surface-2']) {
      const r = ratio(pick('warning'), pick(ground))
      assert.ok(r >= 4.5, `${name}: --color-warning on --color-${ground} is ${r.toFixed(2)}:1, under AA`)
    }
    const r = ratio(pick('text'), pick('warning-soft'))
    assert.ok(r >= 4.5, `${name}: --color-text on --color-warning-soft is ${r.toFixed(2)}:1, under AA`)
  }
  assert.ok(token(darkBlock, 'color-warning') && token(darkBlock, 'color-warning-soft'), 'the dark palette restates both warning tokens')
}
console.log('design: --color-warning clears AA on bg, surface and surface-2, and --color-text clears it on --color-warning-soft, in both palettes')

/* ─────  Layers, focus, target and type tokens  ─────
   (mutations: make --z-nav 200 → fails; replace --text-title with 2.1rem → fails;
   set --target-min to 2rem → fails) */
{
  const z = ['sky', 'content', 'nav', 'skip'].map(n => Number(token(lightBlock, `z-${n}`)))
  assert.ok(z.every(Number.isInteger) && z.every((v, i) => i === 0 || v > z[i - 1]), `--z-sky < --z-content < --z-nav < --z-skip, got ${z}`)
  assert.equal(token(lightBlock, 'focus-ring'), '2px solid var(--color-accent)', 'the focus ring is a token in the accent colour')
  assert.ok(token(lightBlock, 'focus-offset'), '--focus-offset is declared')
  assert.equal(token(lightBlock, 'target-min'), '2.75rem', '--target-min is 44px')
  for (const name of ['text-title', 'text-lg']) {
    assert.match(token(lightBlock, name) ?? '', /^clamp\(/, `--${name} is a clamp, like its neighbours`)
  }
}
console.log('design: the z-index ladder increases, the focus ring and 44px target are tokens, and --text-title and --text-lg are fluid')

/* ─────  No bare z-index and no private focus outline in the sheets this pass owns  ─────
   (mutations: write z-index: 100 in shared.css → fails; give Footer.astro its own
   outline: 2px solid … → fails) */
// The one file outside these checks: the dev-only config editor, which is not
// served in production and has its own plain chrome (asserted below).
const DEV_ONLY = 'src/pages/admin.astro'
const componentFiles = async () => {
  const out = []
  for (const dir of ['src/components', 'src/pages']) {
    for (const f of (await readdir(new URL(`${dir}/`, root))).filter(n => n.endsWith('.astro'))) out.push(`${dir}/${f}`)
  }
  return out.filter(f => f !== DEV_ONLY)
}
const styleBlocks = src => [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => stripComments(m[1]))
{
  const sheets = ['src/styles/shared.css', 'src/styles/global.css', 'src/styles/tools.css', 'src/styles/error-page.css']
  const css = []
  for (const f of sheets) css.push([f, stripComments(await read(f))])
  for (const f of await componentFiles()) for (const b of styleBlocks(await read(f))) css.push([f, b])
  for (const [file, text] of css) {
    for (const m of text.matchAll(/z-index\s*:\s*([^;}]+)/g)) {
      assert.match(m[1].trim(), /^var\(--z-(sky|content|nav|skip)\)$/, `${file}: z-index is ${m[1].trim()}, not a --z-* token`)
    }
  }
  // Outside the forced-colours block (which restores CanvasText on purpose),
  // an outline is the token or nothing; a component never restates the ring.
  const sharedOutside = shared.replace(/@media \(forced-colors: active\)\s*\{[\s\S]*?\n\}/, '')
  for (const [file, text] of [['src/styles/shared.css', sharedOutside], ...css.filter(([f]) => f.endsWith('.astro'))]) {
    for (const m of text.matchAll(/(?<![-\w])outline\s*:\s*([^;}]+)/g)) {
      assert.match(m[1].trim(), /^(var\(--focus-ring\)|none)$/, `${file}: outline is ${m[1].trim()}, not var(--focus-ring)`)
    }
  }
  assert.match(blockAfter(shared, /(^|\n):focus-visible\s*\{/), /outline:\s*var\(--focus-ring\);\s*outline-offset:\s*var\(--focus-offset\)/, 'the site-wide ring reads both focus tokens')
}
console.log('design: every z-index in the shared sheets and component styles is a --z-* token, and no component restates the focus outline')

/* ─────  No literal rem, em or ms in a component or page <style>  ─────
   A literal in a component is a spacing, duration or measure nobody can retheme.
   Covers every <style> in src/components/*.astro and src/pages/*.astro, plus the
   error pages' stylesheet. A media query's condition is exempt, since a custom
   property cannot appear there. The allowlist is one file: admin.astro, the
   dev-only config editor, which is not served in production and has its own
   plain chrome.
   (mutations: write padding: 1rem in Breadcrumbs.astro → fails; write
   transition: color 150ms in RelatedLinks.astro → fails; write
   letter-spacing: 0.1em in error-page.css → fails) */
{
  const LITERAL = /(?<![\w.-])-?(?:\d+\.?\d*|\.\d+)(rem|em|ms|s)\b/g
  const targets = [['src/styles/error-page.css', [stripComments(await read('src/styles/error-page.css'))]]]
  for (const f of await componentFiles()) targets.push([f, styleBlocks(await read(f))])
  let scanned = 0
  for (const [file, blocks] of targets) {
    for (const block of blocks) {
      scanned += 1
      const body = block.replace(/@(media|container|supports)[^{]*\{/g, '{')
      const hits = [...body.matchAll(LITERAL)].map(m => m[0])
      assert.deepEqual(hits, [], `${file}: literal ${hits.join(', ')} in a <style> block; use a --space-*, --motion-*, --ease-* or named measure token`)
    }
  }
  assert.ok(scanned >= 6, `scanned only ${scanned} style blocks; the glob is wrong`)
  const admin = await read(DEV_ONLY)
  assert.ok(admin.includes('<style') && /isAdminRequestAllowed|import\.meta\.env\.DEV/.test(admin), 'the allowlisted file is the dev-only admin page')
}
console.log('design: no component or page <style> carries a literal rem, em, ms or s value (admin.astro, dev-only, is the one allowed file)')

/* ─────  Touch targets: the text-only links reach 44px on a coarse pointer  ─────
   The selectors are read from the CSS and each must name markup a component
   really renders, so renaming one without the other fails.
   (mutations: drop the footer selector → fails; change min-height to 2rem →
   fails; rename data-type="breadcrumb" in Breadcrumbs.astro → fails) */
{
  const coarse = blockAfter(shared, /@media \(pointer: coarse\)\s*\{/)
  const rule = blockAfter(coarse, /nav\[data-type="hero-nav"\] a/)
  assert.match(rule, /display:\s*inline-flex/)
  assert.match(rule, /align-items:\s*center/)
  assert.match(rule, /min-height:\s*var\(--target-min\)/)
  assert.match(rule, /padding-block:/)
  const head = coarse.slice(0, coarse.indexOf('{')).split(',').map(s => s.trim())
  const renders = {
    'hero-nav': 'src/components/Nav.astro',
    'hero-links': 'src/pages/index.astro',
    breadcrumb: 'src/components/Breadcrumbs.astro',
    'site-footer': 'src/components/Footer.astro',
  }
  for (const sel of head) assert.match(sel, /^(nav|footer)\[data-type="[^"]+"\] a$/, `${sel} must target the links inside the region`)
  assert.deepEqual(head.map(s => s.match(/\[data-type="([^"]+)"\]/)[1]).sort(), Object.keys(renders).sort(), 'nav, hero links, breadcrumb and footer links are all covered')
  for (const [type, file] of Object.entries(renders)) {
    const markup = (await read(file)).replace(/<style[\s\S]*?<\/style>/g, '')
    assert.ok(markup.includes(`data-type="${type}"`), `${file} renders data-type="${type}" (outside its <style>), which the touch-target rule names`)
  }
}
console.log('design: under a coarse pointer the nav, hero, breadcrumb and footer links get a 44px target, and each selector matches rendered markup')

/* ─────  Forced colours and print  ─────
   (mutations: drop the forced-colors block's outline → fails; stop hiding the
   footer in print → fails; delete the print rule from global.css → fails) */
{
  const forced = blockAfter(shared, /@media \(forced-colors: active\)\s*\{/)
  assert.match(blockAfter(forced, /:focus-visible\s*\{/), /outline:\s*2px solid CanvasText/, 'forced colours restore a CanvasText focus outline')
  const bordered = forced.slice(forced.indexOf('[data-type="card-grid"]'), forced.lastIndexOf('{'))
  for (const needle of ['[data-type="card-grid"] > *', 'input', 'select', 'textarea', 'button']) {
    assert.ok(bordered.includes(needle), `forced colours give ${needle} a border`)
  }
  assert.match(blockAfter(forced, /\[data-type="card-grid"\]/), /border:\s*1px solid CanvasText/, 'the card, field and control border is 1px CanvasText')

  const print = blockAfter(shared, /@media print\s*\{/)
  const hidden = print.slice(0, print.indexOf('{')).split(',').map(s => s.trim())
  const base = await read('src/layouts/Base.astro')
  for (const [sel, where] of [
    ['nav[data-type="hero-nav"]', await read('src/components/Nav.astro')],
    ['footer[data-type="site-footer"]', await read('src/components/Footer.astro')],
    ['[data-type="starfield"]', base],
    ['div[data-type="sky"]', base],
    ['a[data-type="skip-link"]', base],
  ]) {
    assert.ok(hidden.includes(sel), `print hides ${sel}`)
    assert.ok(where.includes(sel.match(/data-type="[^"]+"/)[0]), `${sel} names markup that is rendered`)
  }
  assert.ok(hidden.some(s => s.includes(':not(:defined)')), 'print hides the loading skeleton')
  assert.match(blockAfter(print, /\n  body\s*\{/), /background:\s*Canvas;\s*color:\s*CanvasText/, 'print is black on white')
  assert.match(blockAfter(blockAfter(globalCss, /@media print\s*\{/), /main,/), /max-width:\s*none !important/, 'an article flows the full page width in print')
}
console.log('design: forced colours restore the focus outline and the card, field and control borders; print drops the chrome and flows the article full width')

/* ─────  The loading panel says what it waits for  ─────
   (mutations: remove the content line → fails; add an animation to the rule → fails) */
{
  const rule = blockAfter(shared, /html\[data-js\] :is\(\[data-tool\], \[data-game\]\):not\(:defined\)::after\s*\{\s*content: "Loading the tool/)
  assert.match(rule, /content:\s*"Loading the tool…"/)
  assert.match(rule, /font-size:\s*var\(--text-sm\)/)
  assert.match(rule, /color:\s*var\(--color-muted\)/)
  assert.doesNotMatch(rule, /animation|transition/, 'the loading text does not animate')
  assert.match(shared, /\[data-game\]:not\(:defined\)::after\s*\{\s*content:\s*"Loading the game…"/, 'a game says game')
}
console.log('design: the not-yet-defined tool panel reads "Loading the tool…" in muted small text, with no animation')

/* ─────  The 404, the 500 and /terms share one wayfinding pattern  ─────
   (mutations: hard-code a link list in 500.astro → fails; drop the retry link →
   fails; remove the Breadcrumbs from terms.astro → fails) */
{
  const [nf, err, terms, footer] = await Promise.all(['src/pages/404.astro', 'src/pages/500.astro', 'src/pages/terms.astro', 'src/components/Footer.astro'].map(read))
  for (const [name, src] of [['404', nf], ['500', err]]) {
    assert.match(src, /import '\.\.\/styles\/error-page\.css'/, `${name} loads the shared error-page stylesheet`)
    assert.match(src, /<Breadcrumbs items=\{\[\{ label: 'home', href: '\/' \}, \{ label: '[^']+' \}\]\} \/>/, `${name} has a home breadcrumb`)
    assert.match(src, /data-type="error-help"/, `${name} ends with help pointing at the footer`)
    assert.match(src, /links\.map\(/, `${name} renders the derived section links`)
  }
  assert.match(err, /const links = navLinks\(site\)/, '500 derives its links from navLinks(), like the 404')
  assert.doesNotMatch(err, /href="\/(projects|tools|games|learnings|blogs)"/, '500 hand-writes no section link')
  assert.match(err, /const retryHref = Astro\.url\.pathname/)
  assert.match(err, /<a href=\{retryHref\}[^>]*data-astro-reload/, '500 has a try-again link to the current path that reloads for real')
  assert.match(terms, /<Breadcrumbs items=\{\[\{ label: 'home', href: '\/' \}, \{ label: 'terms' \}\]\} \/>/, '/terms has a home / terms breadcrumb')
  assert.match(footer, /<a href="#main-content" data-type="back-to-top">/, 'the footer ends with a plain back-to-top anchor')
  assert.doesNotMatch(footer.match(/<footer[\s\S]*?<\/footer>/)[0], /onclick|<script/, 'back to top needs no script')
}
console.log('design: 404 and 500 share suggested links, a breadcrumb and footer help; 500 can retry; /terms has a breadcrumb; the footer links back to the top')

/* ─────  Contact: an optional email and résumé, nothing unsafe in an href  ─────
   (mutations: let a "?" through safeEmailAddress → fails; render the hero email
   before linkedin → fails; mention a tool in the hero links → fails; show the
   résumé link unconditionally → fails) */
{
  for (const ok of ['apanjwani0@gmail.com', 'a.b+c@sub.example.org']) assert.equal(safeEmailAddress(ok), ok)
  for (const bad of ['', 'no-at-sign', 'a b@c.com', 'a@b', 'a@b.com?cc=x@y.com', 'a@b.com&body=1', 'a?cc=x@b.com', 'a&b@c.com', 'a;b@c.com', 'a/b@c.com', '"a"@b.com', '<a@b.com>', 'a@b.com\nbcc: x@y.com', 'javascript:alert(1)', 'a@b.c', 123, null]) {
    assert.equal(safeEmailAddress(bad), null, `${JSON.stringify(bad)} is not an address`)
  }
  const site = JSON.parse(await read('src/config/site.json'))
  assert.equal(site.social.email, 'apanjwani0@gmail.com', 'the owner chose to publish this address (D-1)')
  assert.equal('resumeUrl' in site, false, 'resumeUrl stays unset until there is a résumé to link')
  assert.equal(validateConfigData('site', site), true, 'the shipped site config validates')
  assert.equal(validateConfigData('site', { ...site, social: { ...site.social, email: 'a@b.com?cc=x@y.com' } }), false, 'an email with a query is refused')
  assert.equal(validateConfigData('site', { ...site, resumeUrl: 'javascript:alert(1)' }), false, 'a script résumé URL is refused')
  assert.equal(validateConfigData('site', { ...site, resumeUrl: '/resume.pdf' }), true, 'a path on this site is a valid résumé URL')
  assert.equal(validateConfigData('site', { ...site, resumeUrl: 'https://example.com/cv.pdf' }), true)
  const type = await read('src/config/site.ts')
  assert.match(type, /social: \{ github: string; linkedin: string; email\?: string \}/)
  assert.match(type, /resumeUrl\?: string/)

  const index = await read('src/pages/index.astro')
  const hero = index.match(/<nav data-type="hero-links"[\s\S]*?<\/nav>/)[0]
  const order = ['>github<', '>linkedin<', '>email<'].map(s => hero.indexOf(s))
  assert.ok(order.every((v, i) => v > -1 && (i === 0 || v > order[i - 1])), 'the hero links read github, linkedin, email')
  assert.match(hero, /\{emailAddress && <a href=\{`mailto:\$\{emailAddress\}`\}/, 'the hero email is a mailto from the validated address')
  assert.match(hero, /\{resumeHref && <a /, 'the hero résumé link renders only when set')
  assert.doesNotMatch(hero, /tool|game/i, 'the hero rule holds: no tool or game anywhere in the hero links')
  const footer = await read('src/components/Footer.astro')
  assert.match(footer, /\{email && <a href=\{`mailto:\$\{email\}`\}/, 'the footer email is a mailto from the validated address')
  assert.match(footer, /\{resume && <a /, 'the footer résumé link renders only when set')
  assert.doesNotMatch(index + footer, /mailto:\$\{site\./, 'no mailto is built from the raw config value')
}
console.log('design: email and résumé are optional, validated, shown after github and linkedin and in the footer, and the hero stays free of tools and games')

/* ─────  The docs list what the pass added  ─────
   (mutation: delete --target-min from docs/design-system.md → fails) */
{
  const doc = await read('docs/design-system.md')
  for (const name of ['--color-warning', '--color-warning-soft', '--z-sky', '--z-content', '--z-nav', '--z-skip', '--focus-ring', '--focus-offset', '--target-min']) {
    assert.ok(doc.split('\n').some(line => line.startsWith('|') && line.includes(`\`${name}\``)), `docs/design-system.md has no token-table row naming ${name}`)
  }
  assert.match(doc, /forced-colors/)
  assert.match(doc, /@media print|print/)
}
console.log('design: docs/design-system.md names every token this pass added')
