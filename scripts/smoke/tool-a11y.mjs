/**
 * Accessibility invariants for the tool components (src/components/tools/**).
 *
 * 1. Every <input>, <textarea> and <select> written in a template literal is
 *    named: aria-label, aria-labelledby, an id with a matching `for=` in the
 *    same file, or a <label> that wraps it. A placeholder is not a name.
 * 2. Every file that writes a status line or an error tone has a live region
 *    (role="status" or role="alert") next to it, so a screen reader hears the
 *    result without the visitor hunting for it.
 * 3. Every tool's main component has at least one live region at all.
 * 4. The control kit's `status-line` is a live region by default, and a tone
 *    that carries meaning by colour also carries a word (controls.css).
 *
 * Each check is a function run first against a fixture that must fail and one
 * that must pass, so the lint cannot rot into one that accepts everything.
 * Mutations: strip an aria-label from any tool's input -> fails naming file:line;
 * delete a role from a file's only status node -> fails; empty the `::before`
 * content in controls.css -> fails.
 */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const root = new URL('../../', import.meta.url)
const toolsDir = new URL('src/components/tools/', root)

const lineOf = (src, index) => src.slice(0, index).split('\n').length

/** The text of the tag opening at `start`, skipping `${ … }` so a `>` inside an interpolation does not end it. */
function tagAt(src, start) {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '$' && src[i + 1] === '{') { depth++; i++ }
    else if (c === '{' && depth > 0) depth++
    else if (c === '}' && depth > 0) depth--
    else if (c === '>' && depth === 0) return src.slice(start, i + 1)
  }
  return src.slice(start)
}

/** Unlabelled form controls in one source file, as `{ line, tag }`. */
export function unlabelledControls(src) {
  const forTargets = new Set([...src.matchAll(/\bfor=["']([^"']+)["']/g)].map(m => m[1]))
  const found = []
  for (const m of src.matchAll(/<(input|textarea|select)(?=[\s/>])/g)) {
    const tag = tagAt(src, m.index)
    if (/\btype=["'](hidden)["']/.test(tag)) continue
    if (/\baria-label(ledby)?=/.test(tag)) continue
    const id = tag.match(/\bid=["']([^"']+)["']/)
    if (id && forTargets.has(id[1])) continue
    // A <label> still open before this control wraps it.
    const before = src.slice(0, m.index)
    if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) continue
    found.push({ line: lineOf(src, m.index), tag: tag.replace(/\s+/g, ' ').slice(0, 90) })
  }
  return found
}

/** Status lines and error tones that sit away from any role="status" or role="alert". */
export function statusWithoutLiveRegion(src, window = 6) {
  const lines = src.split('\n')
  const live = /role=["'](status|alert)["']|aria-live=/
  const found = []
  lines.forEach((text, i) => {
    if (!/data-type=["']status-line["']|data-tone=["']error["']/.test(text)) return
    const near = lines.slice(Math.max(0, i - window), i + window + 1).join('\n')
    if (!live.test(near)) found.push({ line: i + 1, tag: text.trim().slice(0, 90) })
  })
  return found
}

// ── The checks prove themselves on fixtures before they read real files ──────
assert.equal(unlabelledControls('x `<input type="text" placeholder="Search">` y').length, 1, 'a placeholder alone is not a name')
assert.equal(unlabelledControls('`<textarea data-x="${a > b ? 1 : 2}"></textarea>`').length, 1, 'a ">" inside an interpolation must not hide a bare textarea')
assert.equal(unlabelledControls('`<select aria-label="Mode"></select>`').length, 0)
assert.equal(unlabelledControls('`<label for="a">A</label><input id="a">`').length, 0)
assert.equal(unlabelledControls('`<label for="a">A</label><input id="b">`').length, 1, 'an id with no matching for= is not a name')
assert.equal(unlabelledControls('`<label>A <input type="checkbox"></label><input>`').length, 1, 'a closed label no longer wraps')
assert.equal(unlabelledControls('`<input type="hidden" name="x">`').length, 0)
assert.equal(statusWithoutLiveRegion('<p data-type="status-line">\n<span></span>\n</p>').length, 1)
assert.equal(statusWithoutLiveRegion('<p data-type="status-line" role="status">').length, 0)
assert.equal(statusWithoutLiveRegion('<p data-tone="error">bad</p>').length, 1)

// ── The real sources ──────────────────────────────────────────────────────────
const files = (await readdir(toolsDir, { recursive: true }))
  .map(f => f.replace(/\\/g, '/'))
  .filter(f => f.endsWith('.ts'))
  .sort()
assert.ok(files.length >= 20, `found ${files.length} tool sources — too few to be checking anything`)

const sources = new Map()
for (const rel of files) sources.set(rel, await readFile(new URL(rel, toolsDir), 'utf-8'))

const fail = (what, list) => list.map(({ file, line, tag }) => `  src/components/tools/${file}:${line}  ${tag}`).join('\n') || what

{
  const gaps = []
  for (const [file, src] of sources) for (const g of unlabelledControls(src)) gaps.push({ file, ...g })
  assert.equal(gaps.length, 0, `${gaps.length} form control(s) with no aria-label, aria-labelledby or matching <label for>:\n${fail('', gaps)}`)
}
console.log(`tool a11y: every <input>, <textarea> and <select> in ${files.length} tool sources is named by aria-label, aria-labelledby or a <label>`)

{
  const gaps = []
  for (const [file, src] of sources) for (const g of statusWithoutLiveRegion(src)) gaps.push({ file, ...g })
  assert.equal(gaps.length, 0, `${gaps.length} status line(s) or error tone(s) with no role="status" or role="alert" within 6 lines:\n${fail('', gaps)}`)
}
console.log('tool a11y: every status line and error tone sits beside a live region')

{
  const mains = [...sources].filter(([file]) => /^[^/]+\/[A-Z][A-Za-z]+\.ts$/.test(file))
  assert.ok(mains.length >= 12, `derived ${mains.length} main components`)
  const bare = mains.filter(([, src]) => !/role=["'](status|alert)["']/.test(src)).map(([file]) => `  src/components/tools/${file}`)
  assert.equal(bare.length, 0, `tool component(s) with no role="status" or role="alert" anywhere:\n${bare.join('\n')}`)
}
console.log('tool a11y: every tool component has a live region for its result or status')

{
  const controls = await readFile(new URL('src/styles/controls.css', root), 'utf-8')
  const rule = (selector, word) => new RegExp(`${selector}::before[^{]*\\{[^}]*content:\\s*['"]${word} ['"]`)
  for (const [tone, word] of [['error', 'Error:'], ['success', 'Done:'], ['note', 'Note:']]) {
    assert.ok(rule(`\\[data-type='status-line'\\] \\[data-tone='${tone}'\\]`, word), `controls.css: a status-line message with data-tone="${tone}" must lead with "${word} " through ::before`)
  }
  assert.ok(rule(`\\[data-type='badge'\\]\\[data-tone='error'\\]`, 'Error:').test(controls), 'controls.css: an error badge must lead with a word')
  assert.ok(rule(`\\[data-type='badge'\\]\\[data-tone='success'\\]`, 'Done:').test(controls), 'controls.css: a success badge must lead with a word')

  // The tools that flag failure with a bare `data-error` get the same word from tools-common.css.
  const common = await readFile(new URL('tools-common.css', toolsDir), 'utf-8')
  for (const sel of ['cw-status', 'rl-status', 'cl-status', 'cw-entry-err', 'ew-val']) {
    assert.ok(new RegExp(`${sel}[^{]*::before`).test(common), `tools-common.css: ${sel} must lead with "Error: " when it reports a failure`)
  }
  assert.match(common, /content:\s*"Error: "/)

  // Flowmap's status-line message flips to an alert while it holds an error.
  const flowmap = sources.get('flowmap/Flowmap.ts')
  assert.match(flowmap, /tone === 'error' \? 'alert' : 'status'/, 'Flowmap: an error message must be role="alert"')
}
console.log('tool a11y: every tone leads with a word (controls.css, tools-common.css), and Flowmap\'s error message is an alert')
