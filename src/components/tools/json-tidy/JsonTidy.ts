/**
 * JSON Tidy — a client-side JSON formatter, validator and minifier.
 *
 * Paste JSON, then pretty-print (2/4-space or tab indent, optional key sort) or
 * minify it in place. Validation runs live as you type: a clear status line
 * reports a parse error with its line and column plus a caret-marked excerpt of
 * the offending line. Output is copy-first (one-click copy) and the last input,
 * indent and sort choice persist in localStorage so the tool feels like a tab
 * you can return to. Mounts as a WebComponent so it survives Astro's
 * client-side View Transitions (see astro:page-load wiring in tools/[slug].astro).
 */

type Indent = '2' | '4' | 'tab'

const LS_INPUT = 'json-tidy:input:v1'
const LS_INDENT = 'json-tidy:indent:v1'
const LS_SORT = 'json-tidy:sort:v1'
const MAX_PERSIST = 256 * 1024 // don't try to persist absurdly large blobs

const SAMPLE = `{
  "tool": "JSON Tidy",
  "tidy": true,
  "indentOptions": [2, 4, "tab"],
  "features": ["format", "validate", "minify", "sort keys"],
  "nested": { "count": 3, "items": [1, 2, 3], "ok": null }
}`

function indentString(i: Indent): string {
  if (i === 'tab') return '\t'
  return i === '4' ? '    ' : '  '
}

function lineColFromOffset(src: string, offset: number): { line: number; col: number } {
  let line = 1
  let col = 1
  const stop = Math.min(offset, src.length)
  for (let i = 0; i < stop; i++) {
    if (src[i] === '\n') {
      line++
      col = 1
    } else {
      col++
    }
  }
  return { line, col }
}

/** Trim the engine-specific noise so the fallback message reads cleanly. */
function cleanMessage(msg: string): string {
  return msg
    .replace(/^JSON\.parse:\s*/i, '')
    .replace(/\s*in JSON at position \d+.*$/i, '')
    .replace(/\s*at line \d+ column \d+.*$/i, '')
    .replace(/\s*of the JSON data\.?$/i, '')
    .replace(/\.$/, '')
    .trim() || 'Invalid JSON'
}

interface ErrorLoc { index: number; message: string }

/**
 * Hand-rolled JSON scanner that returns the byte index of the first syntax
 * error (or null if valid). Modern V8 (Chrome/Node) reports most JSON errors
 * with a snippet but no position, and engines disagree on message format, so
 * we locate the error ourselves for a consistent line/column pointer. This is
 * only consulted when JSON.parse has already rejected the input — the parsed
 * value still comes from JSON.parse.
 */
function locateJsonError(src: string): ErrorLoc | null {
  let i = 0
  const n = src.length
  const err = (message: string, at: number = i): ErrorLoc => ({ index: at, message })
  const isDigit = (c: string) => c >= '0' && c <= '9'
  const ws = () => {
    while (i < n) {
      const c = src[i]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++
      else break
    }
  }

  function value(): ErrorLoc | null {
    ws()
    if (i >= n) return err('Unexpected end of input')
    const c = src[i]
    if (c === '{') return object()
    if (c === '[') return array()
    if (c === '"') return string()
    if (c === '-' || isDigit(c)) return number()
    if (src.startsWith('true', i)) { i += 4; return null }
    if (src.startsWith('false', i)) { i += 5; return null }
    if (src.startsWith('null', i)) { i += 4; return null }
    return err(`Unexpected token ${JSON.stringify(c)}`)
  }

  function string(): ErrorLoc | null {
    i++ // opening quote
    while (i < n) {
      const c = src[i]
      if (c === '"') { i++; return null }
      if (c === '\\') {
        i++
        if (i >= n) return err('Unterminated string')
        const e = src[i]
        if ('"\\/bfnrt'.includes(e)) { i++ }
        else if (e === 'u') {
          i++
          for (let k = 0; k < 4; k++) {
            if (i >= n || !/[0-9a-fA-F]/.test(src[i])) return err('Invalid \\u escape', i)
            i++
          }
        } else return err(`Invalid escape \\${e}`, i)
      } else if (c === '\n') {
        return err('Unterminated string', i)
      } else i++
    }
    return err('Unterminated string')
  }

  function number(): ErrorLoc | null {
    const start = i
    if (src[i] === '-') i++
    if (src[i] === '0') i++
    else if (src[i] >= '1' && src[i] <= '9') { while (i < n && isDigit(src[i])) i++ }
    else return err('Invalid number', start)
    if (src[i] === '.') {
      i++
      if (!isDigit(src[i])) return err('Invalid number', i)
      while (i < n && isDigit(src[i])) i++
    }
    if (src[i] === 'e' || src[i] === 'E') {
      i++
      if (src[i] === '+' || src[i] === '-') i++
      if (!isDigit(src[i])) return err('Invalid number', i)
      while (i < n && isDigit(src[i])) i++
    }
    return null
  }

  function object(): ErrorLoc | null {
    i++ // {
    ws()
    if (src[i] === '}') { i++; return null }
    for (;;) {
      ws()
      if (i >= n) return err('Unexpected end of input')
      if (src[i] !== '"') return err('Expected string key')
      const e1 = string()
      if (e1) return e1
      ws()
      if (src[i] !== ':') return err("Expected ':' after key")
      i++
      const e2 = value()
      if (e2) return e2
      ws()
      if (src[i] === ',') { i++; continue }
      if (src[i] === '}') { i++; return null }
      return err("Expected ',' or '}'")
    }
  }

  function array(): ErrorLoc | null {
    i++ // [
    ws()
    if (src[i] === ']') { i++; return null }
    for (;;) {
      const e = value()
      if (e) return e
      ws()
      if (src[i] === ',') { i++; continue }
      if (src[i] === ']') { i++; return null }
      return err("Expected ',' or ']'")
    }
  }

  const top = value()
  if (top) return top
  ws()
  if (i < n) return err('Unexpected trailing content')
  return null
}

interface ParseResult {
  ok: boolean
  value?: unknown
  message?: string
  line?: number
  col?: number
}

function analyze(src: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(src) }
  } catch (err) {
    // Prefer our own scanner for a reliable, engine-independent line/column.
    const loc = locateJsonError(src)
    if (loc) {
      const { line, col } = lineColFromOffset(src, loc.index)
      return { ok: false, message: loc.message, line, col }
    }
    // Fallback: parse a position/line-column out of the native message.
    const raw = (err instanceof Error && err.message) ? err.message : 'Invalid JSON'
    let line: number | undefined
    let col: number | undefined
    const pos = raw.match(/position (\d+)/i)
    if (pos) {
      ;({ line, col } = lineColFromOffset(src, parseInt(pos[1], 10)))
    } else {
      const lc = raw.match(/line (\d+) column (\d+)/i)
      if (lc) {
        line = parseInt(lc[1], 10)
        col = parseInt(lc[2], 10)
      }
    }
    return { ok: false, message: cleanMessage(raw), line, col }
  }
}

function countKeys(v: unknown): number {
  if (Array.isArray(v)) return v.reduce<number>((n, x) => n + countKeys(x), 0)
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>)
    return keys.reduce<number>((n, k) => n + countKeys((v as Record<string, unknown>)[k]), keys.length)
  }
  return 0
}

/** Recursively sort object keys for a stable, diff-friendly output. */
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortDeep((v as Record<string, unknown>)[k])
    }
    return out
  }
  return v
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

class JsonTidyTool extends HTMLElement {
  private indent: Indent = '2'
  private sort = false
  private debounce = 0

  private input!: HTMLTextAreaElement
  private statusEl!: HTMLElement
  private errorEl!: HTMLElement
  private metaEl!: HTMLElement
  private copyBtn!: HTMLButtonElement

  connectedCallback() {
    this.indent = (this.readLS(LS_INDENT) as Indent) || '2'
    if (this.indent !== '2' && this.indent !== '4' && this.indent !== 'tab') this.indent = '2'
    this.sort = this.readLS(LS_SORT) === '1'

    this.innerHTML = `
      <div data-type="tool-page" data-tool="json-tidy">
        <div data-type="tool-header">
          <h1>JSON Tidy</h1>
          <p>Paste JSON to format, validate or minify it — instantly, in your browser. Errors are pinpointed by line and column; nothing is uploaded.</p>
        </div>

        <div data-group="toolbar">
          <button data-action="format" type="button">Format</button>
          <button data-action="minify" type="button">Minify</button>
          <span data-type="jt-sep" aria-hidden="true"></span>
          <label data-type="jt-field">
            <span>Indent</span>
            <select data-control="indent" aria-label="Indent size">
              <option value="2">2 spaces</option>
              <option value="4">4 spaces</option>
              <option value="tab">Tab</option>
            </select>
          </label>
          <label data-type="jt-field" data-variant="check">
            <input data-control="sort" type="checkbox" />
            <span>Sort keys</span>
          </label>
        </div>

        <textarea
          data-type="jt-input"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          aria-label="JSON input"
          placeholder="Paste or type JSON here…  (Ctrl/Cmd + Enter to format)"
        ></textarea>

        <div data-type="jt-statusbar">
          <span data-type="jt-status" role="status" aria-live="polite"></span>
          <span data-type="jt-meta"></span>
        </div>

        <pre data-type="jt-error" hidden></pre>

        <div data-group="actions">
          <button data-action="copy" type="button">Copy</button>
          <button data-action="sample" type="button">Sample</button>
          <button data-action="clear" type="button">Clear</button>
        </div>
      </div>
    `

    this.input = this.querySelector('[data-type="jt-input"]') as HTMLTextAreaElement
    this.statusEl = this.querySelector('[data-type="jt-status"]') as HTMLElement
    this.errorEl = this.querySelector('[data-type="jt-error"]') as HTMLElement
    this.metaEl = this.querySelector('[data-type="jt-meta"]') as HTMLElement
    this.copyBtn = this.querySelector('[data-action="copy"]') as HTMLButtonElement

    // Restore prior session.
    const saved = this.readLS(LS_INPUT)
    if (saved) this.input.value = saved
    ;(this.querySelector('[data-control="indent"]') as HTMLSelectElement).value = this.indent
    ;(this.querySelector('[data-control="sort"]') as HTMLInputElement).checked = this.sort

    this.wire()
    this.validate()
  }

  disconnectedCallback() {
    if (this.debounce) clearTimeout(this.debounce)
  }

  private wire() {
    this.input.addEventListener('input', () => this.scheduleUpdate())
    this.input.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + Enter → format. Tab inserts a tab instead of leaving the field.
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        this.transform(false)
      } else if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        this.insertAtCursor('\t')
      }
    })

    this.querySelector('[data-action="format"]')!.addEventListener('click', () => this.transform(false))
    this.querySelector('[data-action="minify"]')!.addEventListener('click', () => this.transform(true))
    this.copyBtn.addEventListener('click', () => this.copy())
    this.querySelector('[data-action="sample"]')!.addEventListener('click', () => {
      this.input.value = SAMPLE
      this.persist()
      this.validate()
      this.input.focus()
    })
    this.querySelector('[data-action="clear"]')!.addEventListener('click', () => {
      this.input.value = ''
      this.persist()
      this.validate()
      this.input.focus()
    })

    const indentSel = this.querySelector('[data-control="indent"]') as HTMLSelectElement
    indentSel.addEventListener('change', () => {
      this.indent = indentSel.value as Indent
      this.writeLS(LS_INDENT, this.indent)
    })
    const sortChk = this.querySelector('[data-control="sort"]') as HTMLInputElement
    sortChk.addEventListener('change', () => {
      this.sort = sortChk.checked
      this.writeLS(LS_SORT, this.sort ? '1' : '0')
    })
  }

  private insertAtCursor(text: string) {
    const el = this.input
    const start = el.selectionStart
    const end = el.selectionEnd
    el.value = el.value.slice(0, start) + text + el.value.slice(end)
    el.selectionStart = el.selectionEnd = start + text.length
    this.scheduleUpdate()
  }

  private scheduleUpdate() {
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = window.setTimeout(() => {
      this.debounce = 0
      this.validate()
      this.persist()
    }, 180)
  }

  private validate() {
    const src = this.input.value
    if (!src.trim()) {
      this.setStatus('idle', 'Awaiting JSON…')
      this.metaEl.textContent = ''
      this.errorEl.hidden = true
      return
    }
    const res = analyze(src)
    if (res.ok) {
      const keys = countKeys(res.value)
      const bytes = byteLength(src)
      this.setStatus('ok', 'Valid JSON')
      this.metaEl.textContent = `${keys} ${keys === 1 ? 'key' : 'keys'} · ${formatBytes(bytes)}`
      this.errorEl.hidden = true
    } else {
      const where = res.line ? `Line ${res.line}, Column ${res.col}` : 'Parse error'
      this.setStatus('err', `Invalid · ${where}`)
      this.metaEl.textContent = res.message || ''
      this.renderError(src, res)
    }
  }

  private renderError(src: string, res: ParseResult) {
    if (!res.line) {
      this.errorEl.hidden = true
      return
    }
    const lines = src.split('\n')
    const lineText = lines[res.line - 1] ?? ''
    const col = Math.max(1, res.col ?? 1)
    // Keep a window around the column so very long lines stay readable.
    const WINDOW = 80
    let start = 0
    let display = lineText
    let caretCol = col
    if (lineText.length > WINDOW) {
      start = Math.max(0, col - Math.floor(WINDOW / 2))
      display = (start > 0 ? '…' : '') + lineText.slice(start, start + WINDOW)
      caretCol = col - start + (start > 0 ? 1 : 0)
    }
    const gutter = String(res.line)
    const caretPad = ' '.repeat(gutter.length + 2 + Math.max(0, caretCol - 1))
    const html =
      `<span data-type="jt-err-line">${gutter} | </span>${escapeHtml(display)}\n` +
      `${caretPad}<span data-type="jt-caret">^</span>`
    this.errorEl.innerHTML = html
    this.errorEl.hidden = false
  }

  private transform(minify: boolean) {
    const src = this.input.value
    if (!src.trim()) {
      this.input.focus()
      return
    }
    const res = analyze(src)
    if (!res.ok) {
      this.validate()
      this.flash(this.querySelector(`[data-action="${minify ? 'minify' : 'format'}"]`) as HTMLButtonElement, 'Invalid JSON')
      return
    }
    const value = this.sort ? sortDeep(res.value) : res.value
    const out = minify
      ? JSON.stringify(value)
      : JSON.stringify(value, null, indentString(this.indent))
    this.input.value = out
    this.persist()
    this.validate()
    if (minify) {
      const saved = byteLength(src) - byteLength(out)
      if (saved > 0) this.metaEl.textContent += ` · saved ${formatBytes(saved)}`
    }
  }

  private async copy() {
    const text = this.input.value
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      this.flash(this.copyBtn, 'Copied!')
    } catch {
      this.flash(this.copyBtn, 'Copy failed')
    }
  }

  private flash(btn: HTMLButtonElement, label: string) {
    const original = btn.dataset.label ?? btn.textContent ?? ''
    if (!btn.dataset.label) btn.dataset.label = original
    btn.textContent = label
    window.setTimeout(() => { btn.textContent = btn.dataset.label ?? original }, 1400)
  }

  private setStatus(state: 'idle' | 'ok' | 'err', label: string) {
    this.statusEl.dataset.state = state
    this.statusEl.textContent = label
  }

  // ── localStorage helpers (all guarded; storage may be unavailable/full) ──
  private persist() {
    const v = this.input.value
    try {
      if (v.length <= MAX_PERSIST) localStorage.setItem(LS_INPUT, v)
      else localStorage.removeItem(LS_INPUT)
    } catch { /* ignore quota/private-mode errors */ }
  }

  private readLS(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  }

  private writeLS(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* ignore */ }
  }
}

if (!customElements.get('json-tidy-tool')) {
  customElements.define('json-tidy-tool', JsonTidyTool)
}
