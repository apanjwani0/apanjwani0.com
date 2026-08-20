/**
 * Regex Lab — a live regular-expression tester, built to regex101 / regexr parity.
 *
 * Type a pattern (JavaScript / ECMAScript flavour, since it runs in your browser)
 * and a test string and get, entirely client-side:
 *   1. Live MATCH HIGHLIGHTING drawn behind the test-string editor — every match
 *      tinted, alternating shades so adjacent matches stay distinct, zero-width
 *      matches shown as a caret.
 *   2. A MATCH LIST: each match with its start–end position, the matched text, and
 *      every capture group (numbered, and named when the pattern uses (?<name>…)).
 *   3. A REPLACE tab: a substitution field with a live preview, supporting $1…$9,
 *      $<name>, $&, $` and $' exactly as String.replace does, plus a count.
 *   4. Flag toggles (g i m s u y), a quick-reference cheat-sheet, clickable
 *      example patterns with sample text, and copy-first output (raw pattern,
 *      the /regex/flags literal, a ready-to-paste JS snippet, the matches, or the
 *      replaced text).
 * Everything is remembered in localStorage; press C (outside a field) to clear,
 * Ctrl/Cmd+Enter to copy the /regex/flags literal.
 *
 * Mounts as a WebComponent so it survives Astro's client-side View Transitions
 * (see the astro:page-load wiring in tools/[slug].astro). All module-level names
 * are rl-/RL_-prefixed because tool component files share one global script scope.
 */

// ── Constants ────────────────────────────────────────────────────────────────

import { flashLabel } from '../../../lib/flash'

const RL_LS_PATTERN = 'regex-lab:pattern:v1'
const RL_LS_FLAGS = 'regex-lab:flags:v1'
const RL_LS_TEXT = 'regex-lab:text:v1'
const RL_LS_REPLACE = 'regex-lab:replace:v1'
const RL_LS_TAB = 'regex-lab:tab:v1'

// Canonical flag order + human labels for the toggle chips (title tooltips).
const RL_FLAGS: [string, string][] = [
  ['g', 'global — find every match, not just the first'],
  ['i', 'ignore case'],
  ['m', 'multiline — ^ and $ match at line breaks'],
  ['s', 'dotAll — . also matches newlines'],
  ['u', 'unicode — full code-point matching'],
  ['y', 'sticky — match only at lastIndex'],
]
const RL_FLAG_SET = new Set(RL_FLAGS.map(([f]) => f))

const RL_MATCH_RENDER_CAP = 500
const RL_ITER_GUARD = 200000
const RL_MATCH_CAP = 50000

const RL_DEFAULT_PATTERN = '\\b(\\w+)@(\\w+\\.\\w+)\\b'
const RL_DEFAULT_FLAGS = 'gi'
const RL_DEFAULT_TEXT =
  'Reach me at aman@example.com or sales@Sub.Domain.co — the pattern captures\n' +
  'the local part and the host as two groups. Try toggling flags, or load an\n' +
  'example below to see named groups, backreferences and multiline matching.'

interface RlExample {
  label: string
  pattern: string
  flags: string
  sample: string
}

const RL_EXAMPLES: RlExample[] = [
  { label: 'Email address', pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.-]+', flags: 'g',
    sample: 'Ping me at aman@example.com or sales@sub.domain.co for details.' },
  { label: 'URL', pattern: 'https?:\\/\\/[^\\s]+', flags: 'g',
    sample: 'See https://apanjwani0.com and http://example.org/path?q=1 for more.' },
  { label: 'IPv4 address', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', flags: 'g',
    sample: 'Hosts: 192.168.0.1, 10.0.0.255 and 8.8.8.8 responded.' },
  { label: 'Hex colour', pattern: '#(?:[0-9a-fA-F]{3}){1,2}\\b', flags: 'g',
    sample: 'Palette: #fff, #6a5bd0 and #ff6b6b look good together.' },
  { label: 'ISO date · named groups', pattern: '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})', flags: 'g',
    sample: 'Shipping on 2026-08-10, with a follow-up 2025-12-31.' },
  { label: 'Duplicate word · backreference', pattern: '\\b(\\w+)\\s+\\1\\b', flags: 'gi',
    sample: 'The the quick brown fox fox jumps over the lazy dog.' },
  { label: 'Trailing whitespace · multiline', pattern: ' +$', flags: 'gm',
    sample: 'line one   \nline two \nno trailing space' },
  { label: 'key=value pairs', pattern: '(\\w+)=("[^"]*"|\\S+)', flags: 'g',
    sample: 'name="Aman Panjwani" role=dev city="New York" active=true' },
  { label: 'Phone number', pattern: '\\+?\\d[\\d ()-]{7,}\\d', flags: 'g',
    sample: 'Call +1 (555) 123-4567 or 020 7946 0958 during the day.' },
]

// Quick-reference cheat-sheet: grouped [token, meaning] pairs.
const RL_REFERENCE: [string, [string, string][]][] = [
  ['Character classes', [
    ['.', 'any char (except newline)'], ['\\d', 'digit 0–9'], ['\\w', 'word char'],
    ['\\s', 'whitespace'], ['\\D', 'non-digit'], ['\\W', 'non-word'], ['\\S', 'non-space'],
    ['[abc]', 'a, b or c'], ['[^abc]', 'not a, b, c'], ['[a-z]', 'range a to z'],
  ]],
  ['Anchors', [
    ['^', 'start of line / string'], ['$', 'end of line / string'],
    ['\\b', 'word boundary'], ['\\B', 'non-boundary'],
  ]],
  ['Quantifiers', [
    ['*', '0 or more'], ['+', '1 or more'], ['?', '0 or 1'], ['{n}', 'exactly n'],
    ['{n,}', 'n or more'], ['{n,m}', 'n to m'], ['*?', 'lazy (as few as possible)'],
  ]],
  ['Groups & refs', [
    ['(…)', 'capture group'], ['(?:…)', 'non-capturing'], ['(?<name>…)', 'named group'],
    ['\\1', 'backreference'], ['a|b', 'a or b'],
  ]],
  ['Lookaround', [
    ['(?=…)', 'lookahead'], ['(?!…)', 'negative lookahead'],
    ['(?<=…)', 'lookbehind'], ['(?<!…)', 'negative lookbehind'],
  ]],
  ['Escapes', [
    ['\\.', 'literal dot'], ['\\/', 'literal slash'], ['\\n', 'newline'],
    ['\\t', 'tab'], ['\\uFFFF', 'unicode escape'],
  ]],
]

// ── Pure helpers (no DOM) ─────────────────────────────────────────────────────

function rlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Sort a flag string into canonical order and drop anything unknown/duplicated. */
function rlNormalizeFlags(flags: string): string {
  const seen = new Set<string>()
  for (const c of flags) if (RL_FLAG_SET.has(c)) seen.add(c)
  return RL_FLAGS.map(([f]) => f).filter(f => seen.has(f)).join('')
}

function rlAdvanceStringIndex(text: string, index: number, unicode: boolean): number {
  if (!unicode || index + 1 >= text.length) return index + 1
  const first = text.charCodeAt(index)
  if (first < 0xd800 || first > 0xdbff) return index + 1
  const second = text.charCodeAt(index + 1)
  return second >= 0xdc00 && second <= 0xdfff ? index + 2 : index + 1
}

function rlRegexLiteralSource(source: string): string {
  return source
    .replace(/\//g, '\\/')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * Map capture-group NUMBER → name for any (?<name>…) groups, so the match list
 * can label named groups. Scans the source respecting escapes and character
 * classes (where "(" is literal) and skips non-capturing groups + lookarounds.
 */
function rlGroupNames(pattern: string): Record<number, string> {
  const names: Record<number, string> = {}
  let n = 0
  let inClass = false
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\') { i++; continue }
    if (inClass) { if (c === ']') inClass = false; continue }
    if (c === '[') { inClass = true; continue }
    if (c !== '(') continue
    if (pattern[i + 1] === '?') {
      // (?<name>…) is a NAMED capture; (?<= (?<! are lookbehind (not captures);
      // (?: (?= (?! are non-capturing.
      if (pattern[i + 2] === '<' && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') {
        n++
        const end = pattern.indexOf('>', i + 3)
        if (end > 0) names[n] = pattern.slice(i + 3, end)
      }
    } else {
      n++
    }
  }
  return names
}

/** Collect matches, respecting g/y; guards against zero-width infinite loops. */
function rlCollect(re: RegExp, text: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = []
  const iterate = re.global || re.sticky
  re.lastIndex = 0
  if (!iterate) {
    const m = re.exec(text)
    if (m) out.push(m)
    return out
  }
  let m: RegExpExecArray | null
  let guard = 0
  while ((m = re.exec(text)) !== null) {
    out.push(m)
    if (m[0].length === 0) re.lastIndex = rlAdvanceStringIndex(text, re.lastIndex, re.unicode)
    if (++guard > RL_ITER_GUARD) break
    if (out.length >= RL_MATCH_CAP) break
  }
  return out
}

/** Build the highlight overlay HTML: escaped text with each match wrapped. */
function rlBuildHighlight(text: string, matches: RegExpExecArray[]): string {
  let html = ''
  let last = 0
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const start = m.index
    const end = start + m[0].length
    if (start > last) html += rlEsc(text.slice(last, start))
    if (end === start) {
      html += `<mark data-empty="" data-alt="${i % 2}"></mark>`
    } else {
      html += `<mark data-alt="${i % 2}">${rlEsc(text.slice(start, end))}</mark>`
      last = end
    }
    if (end > last) last = end
  }
  html += rlEsc(text.slice(last))
  // A trailing newline needs a spare glyph or the mirror loses the final line's height.
  if (text.endsWith('\n')) html += ' '
  return html
}

// ── Component ─────────────────────────────────────────────────────────────────

class RegexLabTool extends HTMLElement {
  private root!: HTMLElement
  private patternEl!: HTMLInputElement
  private textEl!: HTMLTextAreaElement
  private replaceEl!: HTMLInputElement
  private highlightEl!: HTMLElement
  private statusEl!: HTMLElement
  private countEl!: HTMLElement
  private matchesEl!: HTMLElement
  private replaceOutEl!: HTMLElement
  private replaceInfoEl!: HTMLElement
  private flagsDisplayEl!: HTMLElement

  private flags = new Set<string>()
  private tab: 'matches' | 'replace' = 'matches'
  private lastMatchesText = ''

  private onKeydown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      this.copyText(this.literal(), this.q('[data-action="copy-literal"]'))
      return
    }
    if (!typing && (e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      this.clearAll()
    }
  }

  connectedCallback() {
    const savedPattern = this.readLS(RL_LS_PATTERN)
    const savedFlags = this.readLS(RL_LS_FLAGS)
    const savedText = this.readLS(RL_LS_TEXT)
    const savedReplace = this.readLS(RL_LS_REPLACE)
    const savedTab = this.readLS(RL_LS_TAB)

    this.flags = new Set(rlNormalizeFlags(savedFlags ?? RL_DEFAULT_FLAGS))
    this.tab = savedTab === 'replace' ? 'replace' : 'matches'

    this.innerHTML = `
      <div data-type="tool-page" data-tool="regex-lab">
        <div data-type="tool-header">
          <h1>Regex Lab</h1>
          <p>Test a regular expression against any text and watch every match light up as you type. See each match's position and capture groups, preview a find-and-replace, and reach for the built-in cheat-sheet and examples. This uses the JavaScript (ECMAScript) engine, runs entirely in your browser, and remembers your work — press <kbd>C</kbd> to clear, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> to copy the <code>/regex/flags</code> literal.</p>
        </div>

        <div data-group="toolbar">
          <button data-action="clear" type="button">Clear (C)</button>
          <span data-type="rl-flavor" title="Patterns run through the browser's native JavaScript RegExp engine">JavaScript · ECMAScript</span>
        </div>

        <section data-type="rl-card" data-card="input" aria-labelledby="rl-in-h">
          <h2 id="rl-in-h">Pattern</h2>
          <div data-group="rl-patternrow">
            <span data-type="rl-delim" aria-hidden="true">/</span>
            <input data-input="pattern" type="text" spellcheck="false" autocomplete="off"
              autocapitalize="off" autocorrect="off" placeholder="pattern" aria-label="Regular expression pattern" />
            <span data-type="rl-delim" aria-hidden="true">/</span>
            <span data-type="rl-flags-display" data-for="flagsdisplay" aria-hidden="true"></span>
          </div>
          <div data-group="rl-flags" role="group" aria-label="Regular expression flags">
            ${RL_FLAGS.map(([f, label]) => `
              <button data-flag="${f}" type="button" aria-pressed="false" title="${rlEsc(label)}">${f}</button>
            `).join('')}
          </div>
          <div data-group="rl-actions">
            <button data-action="copy-literal" type="button">Copy /regex/</button>
            <button data-action="copy-pattern" type="button">Copy pattern</button>
            <button data-action="copy-js" type="button">Copy as JS</button>
          </div>
          <div data-type="rl-statusbar">
            <span data-type="rl-status" data-for="status" role="status" aria-live="polite"></span>
          </div>
        </section>

        <section data-type="rl-card" data-card="test" aria-labelledby="rl-test-h">
          <h2 id="rl-test-h">Test string <span data-type="rl-count" data-for="count"></span></h2>
          <div data-type="rl-editor">
            <div data-type="rl-highlight" data-for="highlight" aria-hidden="true"></div>
            <textarea data-input="text" spellcheck="false" autocomplete="off" autocapitalize="off"
              autocorrect="off" aria-label="Test string" placeholder="Paste or type the text to match against…"></textarea>
          </div>
        </section>

        <section data-type="rl-card" data-card="results" aria-labelledby="rl-res-h">
          <h2 id="rl-res-h">Results</h2>
          <div data-group="rl-tabs" role="tablist" aria-label="Result view">
            <button data-tab-btn="matches" type="button" role="tab" aria-selected="true">Matches</button>
            <button data-tab-btn="replace" type="button" role="tab" aria-selected="false">Replace</button>
          </div>

          <div data-tab="matches" role="tabpanel">
            <div data-type="rl-matches" data-for="matches"></div>
            <div data-group="rl-actions">
              <button data-action="copy-matches" type="button">Copy matches</button>
            </div>
          </div>

          <div data-tab="replace" role="tabpanel" hidden>
            <label data-type="rl-field"><span>Replacement</span>
              <input data-input="replace" type="text" spellcheck="false" autocomplete="off"
                autocapitalize="off" autocorrect="off" placeholder="$1 (&lt;$2&gt;)" aria-label="Replacement string" />
            </label>
            <p data-type="rl-replace-hint">Use <code>$1</code>–<code>$9</code> for numbered groups, <code>$&lt;name&gt;</code> for named groups, <code>$&amp;</code> for the whole match, <code>$\`</code> / <code>$'</code> for the text before / after. Without the <code>g</code> flag only the first match is replaced.</p>
            <p data-type="rl-replace-info" data-for="replaceinfo"></p>
            <pre data-type="rl-replace-out" data-for="replaceout"></pre>
            <div data-group="rl-actions">
              <button data-action="copy-replace" type="button">Copy result</button>
            </div>
          </div>
        </section>

        <details data-type="rl-examples">
          <summary>Example patterns</summary>
          <div data-type="rl-example-grid">
            ${RL_EXAMPLES.map((ex, i) => `
              <button data-type="rl-example" data-example="${i}" type="button">
                <code>/${rlEsc(ex.pattern)}/${ex.flags}</code>
                <span>${rlEsc(ex.label)}</span>
              </button>
            `).join('')}
          </div>
        </details>

        <details data-type="rl-reference">
          <summary>Quick reference</summary>
          <div data-type="rl-ref-grid">
            ${RL_REFERENCE.map(([group, rows]) => `
              <div data-type="rl-ref-col">
                <h3>${rlEsc(group)}</h3>
                ${rows.map(([tok, desc]) => `
                  <div data-type="rl-ref-row"><code>${rlEsc(tok)}</code><span>${rlEsc(desc)}</span></div>
                `).join('')}
              </div>
            `).join('')}
          </div>
        </details>

        <details data-type="rl-explainer">
          <summary>How this works</summary>
          <p>A <strong>regular expression</strong> is a compact pattern for finding and extracting text. Write the pattern between the slashes and add <strong>flags</strong> after them — <code>g</code> to find every match, <code>i</code> to ignore case, <code>m</code> so <code>^</code> and <code>$</code> match at each line break, <code>s</code> so <code>.</code> also matches newlines, <code>u</code> for full Unicode, and <code>y</code> to anchor at the last position.</p>
          <p>Parentheses create <strong>capture groups</strong> you can pull out of each match; name them with <code>(?&lt;name&gt;…)</code> and refer back to them with <code>\\1</code> or, in a replacement, <code>$1</code> and <code>$&lt;name&gt;</code>. The match list shows every group for every match, and the <strong>Replace</strong> tab previews a full find-and-replace live.</p>
          <p>This tester uses your browser's native <strong>JavaScript (ECMAScript)</strong> regex engine, so what you see here is exactly how the pattern behaves in JavaScript. Everything runs locally — your pattern and text are remembered on this device and never uploaded.</p>
        </details>
      </div>
    `

    this.root = this.q('[data-type="tool-page"]')
    this.patternEl = this.q('[data-input="pattern"]')
    this.textEl = this.q('[data-input="text"]')
    this.replaceEl = this.q('[data-input="replace"]')
    this.highlightEl = this.q('[data-for="highlight"]')
    this.statusEl = this.q('[data-for="status"]')
    this.countEl = this.q('[data-for="count"]')
    this.matchesEl = this.q('[data-for="matches"]')
    this.replaceOutEl = this.q('[data-for="replaceout"]')
    this.replaceInfoEl = this.q('[data-for="replaceinfo"]')
    this.flagsDisplayEl = this.q('[data-for="flagsdisplay"]')

    // Restore state (seed a self-demonstrating default the first time).
    this.patternEl.value = savedPattern ?? RL_DEFAULT_PATTERN
    this.textEl.value = savedText ?? RL_DEFAULT_TEXT
    this.replaceEl.value = savedReplace ?? ''

    this.reflectFlags()
    this.reflectTab()

    this.patternEl.addEventListener('input', () => this.evaluate())
    this.textEl.addEventListener('input', () => this.evaluate())
    this.replaceEl.addEventListener('input', () => this.evaluate())
    this.textEl.addEventListener('scroll', () => this.syncScroll())

    this.root.querySelectorAll<HTMLButtonElement>('[data-flag]').forEach(btn =>
      btn.addEventListener('click', () => this.toggleFlag(btn.dataset.flag as string)))
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab-btn]').forEach(btn =>
      btn.addEventListener('click', () => this.setTab(btn.dataset.tabBtn as 'matches' | 'replace')))
    this.root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn =>
      btn.addEventListener('click', () => this.onAction(btn.dataset.action as string, btn)))
    this.root.querySelectorAll<HTMLButtonElement>('[data-example]').forEach(btn =>
      btn.addEventListener('click', () => this.loadExample(parseInt(btn.dataset.example as string, 10))))

    this.addEventListener('keydown', this.onKeydown)

    this.evaluate()
  }

  disconnectedCallback() {
    this.removeEventListener('keydown', this.onKeydown)
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.querySelector(sel) as T
  }

  // ── evaluation ────────────────────────────────────────────────────────────
  private evaluate() {
    const pattern = this.patternEl.value
    const text = this.textEl.value
    const flags = this.flagsString()

    this.writeLS(RL_LS_PATTERN, pattern)
    this.writeLS(RL_LS_TEXT, text)
    this.writeLS(RL_LS_REPLACE, this.replaceEl.value)

    if (!pattern) {
      this.root.removeAttribute('data-invalid')
      this.statusEl.removeAttribute('data-error')
      this.setStatus('Enter a pattern to start matching.')
      this.setHighlightPlain(text)
      this.countEl.textContent = ''
      this.matchesEl.innerHTML = '<p data-type="rl-empty">Type a pattern above to see matches.</p>'
      this.replaceInfoEl.textContent = ''
      this.replaceOutEl.textContent = ''
      this.lastMatchesText = ''
      return
    }

    let re: RegExp
    try {
      re = new RegExp(pattern, flags)
    } catch (err) {
      this.root.setAttribute('data-invalid', '')
      this.statusEl.setAttribute('data-error', '')
      this.setStatus((err as Error).message)
      this.setHighlightPlain(text)
      this.countEl.textContent = ''
      this.matchesEl.innerHTML = '<p data-type="rl-empty" data-error="">Invalid pattern — nothing to match.</p>'
      this.replaceInfoEl.textContent = ''
      this.replaceOutEl.textContent = ''
      this.lastMatchesText = ''
      return
    }

    this.root.removeAttribute('data-invalid')
    this.statusEl.removeAttribute('data-error')

    const matches = rlCollect(re, text)
    const names = rlGroupNames(pattern)

    this.highlightEl.innerHTML = rlBuildHighlight(text, matches)
    this.syncScroll()

    const n = matches.length
    this.countEl.textContent = n === 0 ? 'no matches' : `${n} match${n === 1 ? '' : 'es'}`
    this.setStatus(n === 0
      ? 'Valid pattern — no matches in the test string.'
      : `Valid pattern — ${n} match${n === 1 ? '' : 'es'}${!this.flags.has('g') && n === 1 ? ' (add g to find all)' : ''}.`)

    this.renderMatches(matches, names)
    this.renderReplace(re, text, matches.length)
  }

  private setHighlightPlain(text: string) {
    this.highlightEl.innerHTML = rlEsc(text) + (text.endsWith('\n') ? ' ' : '')
    this.syncScroll()
  }

  private syncScroll() {
    this.highlightEl.scrollTop = this.textEl.scrollTop
    this.highlightEl.scrollLeft = this.textEl.scrollLeft
  }

  private renderMatches(matches: RegExpExecArray[], names: Record<number, string>) {
    if (matches.length === 0) {
      this.matchesEl.innerHTML = '<p data-type="rl-empty">No matches.</p>'
      this.lastMatchesText = ''
      return
    }

    const shown = matches.slice(0, RL_MATCH_RENDER_CAP)
    const lines: string[] = []

    const html = shown.map((m, i) => {
      const start = m.index
      const full = m[0]
      const end = start + full.length
      lines.push(full)

      const groups = m.length > 1 ? m.slice(1) : []
      const groupsHtml = groups.length === 0 ? '' : `
        <div data-type="rl-groups">
          ${groups.map((g, gi) => {
            const num = gi + 1
            const label = names[num] ? `Group ${num} · ${rlEsc(names[num])}` : `Group ${num}`
            const val = g === undefined ? '<em>undefined</em>'
              : g === '' ? '<em>(empty)</em>'
              : rlEsc(g)
            return `<div data-type="rl-grow"><span data-type="rl-gname">${label}</span><span data-type="rl-gval">${val}</span></div>`
          }).join('')}
        </div>`

      const valHtml = full.length === 0 ? '<em>(empty match)</em>' : rlEsc(full)
      return `
        <div data-type="rl-match">
          <div data-type="rl-match-head">
            <span data-type="rl-match-idx">Match ${i + 1}</span>
            <span data-type="rl-match-pos">${start}–${end}${full.length === 0 ? ' · zero-width' : ''}</span>
          </div>
          <div data-type="rl-match-val">${valHtml}</div>
          ${groupsHtml}
        </div>`
    }).join('')

    const more = matches.length > RL_MATCH_RENDER_CAP
      ? `<p data-type="rl-empty">Showing the first ${RL_MATCH_RENDER_CAP} of ${matches.length} matches.</p>`
      : ''

    this.matchesEl.innerHTML = html + more
    this.lastMatchesText = lines.join('\n')
  }

  private renderReplace(re: RegExp, text: string, matchCount: number) {
    const repl = this.replaceEl.value
    let result = ''
    try {
      re.lastIndex = 0
      result = text.replace(re, repl)
    } catch (err) {
      this.replaceInfoEl.textContent = (err as Error).message
      this.replaceOutEl.textContent = ''
      return
    }
    this.replaceInfoEl.textContent = matchCount === 0
      ? 'No matches — output is the original text.'
      : `${matchCount} replacement${matchCount === 1 ? '' : 's'}.`
    this.replaceOutEl.textContent = result
  }

  // ── flags + tabs ────────────────────────────────────────────────────────────
  private flagsString(): string {
    return RL_FLAGS.map(([f]) => f).filter(f => this.flags.has(f)).join('')
  }

  private toggleFlag(flag: string) {
    if (!RL_FLAG_SET.has(flag)) return
    if (this.flags.has(flag)) this.flags.delete(flag)
    else this.flags.add(flag)
    this.writeLS(RL_LS_FLAGS, this.flagsString())
    this.reflectFlags()
    this.evaluate()
  }

  private reflectFlags() {
    this.root.querySelectorAll<HTMLButtonElement>('[data-flag]').forEach(btn => {
      btn.setAttribute('aria-pressed', this.flags.has(btn.dataset.flag as string) ? 'true' : 'false')
    })
    const s = this.flagsString()
    this.flagsDisplayEl.textContent = s || ' '
  }

  private setTab(tab: 'matches' | 'replace') {
    this.tab = tab
    this.writeLS(RL_LS_TAB, tab)
    this.reflectTab()
    if (tab === 'replace') this.replaceEl.focus()
  }

  private reflectTab() {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab-btn]').forEach(btn => {
      const active = btn.dataset.tabBtn === this.tab
      btn.setAttribute('aria-selected', active ? 'true' : 'false')
    })
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach(panel => {
      panel.hidden = panel.dataset.tab !== this.tab
    })
  }

  // ── actions ──────────────────────────────────────────────────────────────
  private loadExample(i: number) {
    const ex = RL_EXAMPLES[i]
    if (!ex) return
    this.patternEl.value = ex.pattern
    this.flags = new Set(rlNormalizeFlags(ex.flags))
    // Only overwrite the test string when it's empty, so an example never
    // clobbers text the user is actively working with.
    if (!this.textEl.value.trim()) this.textEl.value = ex.sample
    this.writeLS(RL_LS_FLAGS, this.flagsString())
    this.reflectFlags()
    this.evaluate()
    this.patternEl.focus()
  }

  private literal(): string {
    return `/${rlRegexLiteralSource(this.patternEl.value)}/${this.flagsString()}`
  }

  private jsSnippet(): string {
    const lit = this.literal()
    const hasG = this.flags.has('g')
    const lines = [
      `const re = ${lit};`,
      `const str = ${JSON.stringify(this.textEl.value)};`,
      '',
      hasG
        ? 'const matches = [...str.matchAll(re)];'
        : 'const match = re.exec(str);',
    ]
    if (this.tab === 'replace' && this.replaceEl.value) {
      lines.push(`const result = str.replace(re, ${JSON.stringify(this.replaceEl.value)});`)
    }
    return lines.join('\n')
  }

  private onAction(action: string, btn: HTMLButtonElement) {
    switch (action) {
      case 'clear': this.clearAll(); break
      case 'copy-pattern': this.copyText(this.patternEl.value, btn); break
      case 'copy-literal': this.copyText(this.literal(), btn); break
      case 'copy-js': this.copyText(this.jsSnippet(), btn); break
      case 'copy-matches': this.copyText(this.lastMatchesText, btn); break
      case 'copy-replace': this.copyText(this.replaceOutEl.textContent ?? '', btn); break
    }
  }

  private clearAll() {
    this.patternEl.value = ''
    this.replaceEl.value = ''
    // Keep the test string — clearing the pattern is what people usually want,
    // so they can try a new pattern against the same text.
    this.evaluate()
    this.patternEl.focus()
  }

  private async copyText(text: string, btn: HTMLButtonElement) {
    if (!text) { this.setStatus('Nothing to copy.'); return }
    try {
      await navigator.clipboard.writeText(text)
      this.flash(btn, 'Copied!')
    } catch {
      this.flash(btn, 'Failed')
    }
  }

  private flash(btn: HTMLButtonElement, label: string) {
    flashLabel(btn, label, 1200)
  }

  private setStatus(label: string) {
    this.statusEl.textContent = label
  }

  // ── persistence ────────────────────────────────────────────────────────────
  private readLS(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  }

  private writeLS(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* ignore quota / private-mode */ }
  }
}

if (!customElements.get('regex-lab-tool')) {
  customElements.define('regex-lab-tool', RegexLabTool)
}

export {}
