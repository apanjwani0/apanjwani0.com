/**
 * List Forge — a bidirectional column ↔ delimited-list converter.
 *
 * Two live panes: a COLUMN (one item per line, e.g. pasted straight out of a
 * spreadsheet) on the left and a DELIMITED LIST (CSV, semicolon, pipe, tab, …)
 * on the right. Whichever side you edit becomes the source; the other side is
 * regenerated on every keystroke, so the tool works in both directions without
 * a "convert" button. The source pane is never rewritten under the cursor —
 * transforms and formatting only ever shape the generated side.
 *
 * Settings (all persisted): delimiter (comma / comma+space / semicolon /
 * semicolon+space / pipe / space / tab / newline / custom), quote style
 * (none / double / single, with CSV-style doubling to escape quotes inside a
 * value), per-item prefix + suffix, whole-list prefix + suffix, and the
 * transform pipeline — collapse extra spaces, strip all whitespace, trim,
 * lowercase, drop empty items, remove duplicates, sort, reverse.
 *
 * Copy-first: one-click copy of either side, optional auto-copy of the list as
 * you type, download as .csv or .txt, a live item + character count, sample
 * data, and a reset. Everything runs locally; nothing is uploaded.
 *
 * Mounts as a WebComponent so it survives Astro's client-side View Transitions
 * (see the astro:page-load wiring in tools/[slug].astro).
 */

type Quotes = 'none' | 'double' | 'single'
type DelimKey =
  | 'comma'
  | 'comma-space'
  | 'semicolon'
  | 'semicolon-space'
  | 'pipe'
  | 'space'
  | 'tab'
  | 'newline'
  | 'custom'
type Side = 'column' | 'list'

interface LfSettings {
  delim: DelimKey
  custom: string
  quotes: Quotes
  itemPrefix: string
  itemSuffix: string
  listPrefix: string
  listSuffix: string
  collapseSpaces: boolean
  stripAllWs: boolean
  trim: boolean
  lower: boolean
  removeEmpty: boolean
  dedupe: boolean
  sortAsc: boolean
  reverse: boolean
  autoCopy: boolean
}

const LS_SETTINGS = 'list-forge:settings:v1'
const LS_COLUMN = 'list-forge:column:v1'
const LS_LIST = 'list-forge:list:v1'
const LS_SOURCE = 'list-forge:source:v1'
const LF_MAX_PERSIST = 256 * 1024 // don't try to persist absurdly large blobs

const DEFAULTS: LfSettings = {
  delim: 'comma',
  custom: '',
  quotes: 'none',
  itemPrefix: '',
  itemSuffix: '',
  listPrefix: '',
  listSuffix: '',
  collapseSpaces: false,
  stripAllWs: false,
  trim: true,
  lower: false,
  removeEmpty: true,
  dedupe: false,
  sortAsc: false,
  reverse: false,
  autoCopy: false,
}

const DELIM_LABEL: Record<DelimKey, string> = {
  comma: 'Comma',
  'comma-space': 'Comma + space',
  semicolon: 'Semicolon',
  'semicolon-space': 'Semicolon + space',
  pipe: 'Pipe',
  space: 'Space',
  tab: 'Tab',
  newline: 'New line',
  custom: 'Custom',
}

const SAMPLE_COLUMN = `Ada Lovelace
Alan Turing
Grace Hopper
Katherine Johnson
Edsger Dijkstra
Barbara Liskov`

// ── Pure conversion engine (no DOM — unit-testable in isolation) ───────────

/** Escape a literal string for use inside a RegExp source. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Interpret the \t / \n / \\ escapes a user may type into the custom delimiter. */
function decodeEscapes(s: string): string {
  return s.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
}

/** The literal string used to JOIN items when building the delimited list. */
function delimiterFor(s: LfSettings): string {
  switch (s.delim) {
    case 'comma': return ','
    case 'comma-space': return ', '
    case 'semicolon': return ';'
    case 'semicolon-space': return '; '
    case 'pipe': return '|'
    case 'space': return ' '
    case 'tab': return '\t'
    case 'newline': return '\n'
    case 'custom': {
      const c = decodeEscapes(s.custom)
      return c === '' ? ',' : c // an empty custom delimiter would glue everything together
    }
  }
}

/**
 * The pattern used to SPLIT a delimited list back into items. Deliberately more
 * forgiving than the join delimiter: surrounding whitespace around punctuation
 * delimiters is absorbed, and a newline always ends an item too — so a list
 * copied out of a wrapped editor, or an "a,b" list read with the "comma + space"
 * setting, still parses cleanly.
 */
function splitPattern(s: LfSettings): RegExp {
  const nl = '\\r?\\n'
  let core: string
  switch (s.delim) {
    case 'comma':
    case 'comma-space': core = '[ \\t]*,[ \\t]*'; break
    case 'semicolon':
    case 'semicolon-space': core = '[ \\t]*;[ \\t]*'; break
    case 'pipe': core = '[ \\t]*\\|[ \\t]*'; break
    case 'space': core = '[ \\t]+'; break
    case 'tab': core = '\\t'; break
    case 'newline': core = nl; break
    case 'custom': {
      const c = decodeEscapes(s.custom)
      core = c === '' ? ',' : escapeRe(c)
      break
    }
  }
  const src = s.delim === 'newline' ? core : `${core}|${nl}`
  return new RegExp(src, 'y') // sticky: only matches at the scan position
}

function quoteChar(s: LfSettings): string {
  if (s.quotes === 'double') return '"'
  if (s.quotes === 'single') return "'"
  return ''
}

/** Split the raw column pane into items — one per line. */
function splitColumn(text: string): string[] {
  return text.split(/\r?\n/)
}

/** Run the transform pipeline. Order matters: shape → trim → case → prune → order. */
function applyTransforms(items: string[], s: LfSettings): string[] {
  let out = items
  if (s.stripAllWs) out = out.map(i => i.replace(/\s+/g, ''))
  else if (s.collapseSpaces) out = out.map(i => i.replace(/[ \t]+/g, ' '))
  if (s.trim) out = out.map(i => i.trim())
  if (s.lower) out = out.map(i => i.toLowerCase())
  if (s.removeEmpty) out = out.filter(i => i.trim() !== '')
  if (s.dedupe) {
    const seen = new Set<string>()
    out = out.filter(i => (seen.has(i) ? false : (seen.add(i), true)))
  }
  if (s.sortAsc) out = [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  if (s.reverse) out = [...out].reverse()
  return out
}

/** Wrap one value: quotes innermost (escaped CSV-style), then the item affixes. */
function encodeItem(value: string, s: LfSettings): string {
  const q = quoteChar(s)
  const core = q ? q + value.split(q).join(q + q) + q : value
  return s.itemPrefix + core + s.itemSuffix
}

/** Build the delimited list from already-transformed items. */
function buildList(items: string[], s: LfSettings): string {
  const body = items.map(i => encodeItem(i, s)).join(delimiterFor(s))
  return s.listPrefix + body + s.listSuffix
}

/** Undo encodeItem: peel the item affixes, then a matching pair of quotes. */
function decodeItem(token: string, s: LfSettings): string {
  let t = token
  if (s.itemPrefix) {
    const lt = t.trimStart()
    if (lt.startsWith(s.itemPrefix)) t = lt.slice(s.itemPrefix.length)
  }
  if (s.itemSuffix) {
    const rt = t.trimEnd()
    if (rt.endsWith(s.itemSuffix)) t = rt.slice(0, rt.length - s.itemSuffix.length)
  }
  // Unwrap quotes even when the quote setting is "none" — pasted CSV is often quoted.
  const v = t.trim()
  for (const q of ['"', "'"]) {
    if (v.length >= 2 && v.startsWith(q) && v.endsWith(q)) {
      return v.slice(1, -1).split(q + q).join(q)
    }
  }
  return t
}

/**
 * Split a delimited list into raw tokens, honouring quoted values (a delimiter
 * inside "quotes" does not split) and CSV-style doubled quotes.
 */
function splitList(text: string, s: LfSettings): string[] {
  const q = quoteChar(s) || '"' // even with quotes off, respect "…" so pasted CSV survives
  const re = splitPattern(s)
  const out: string[] = []
  let buf = ''
  let i = 0

  const eatDelimiter = (): boolean => {
    re.lastIndex = i
    const m = re.exec(text)
    if (m && m[0].length > 0) {
      i += m[0].length
      return true
    }
    return false
  }

  while (i < text.length) {
    // A quote opening a fresh token starts a quoted value.
    if (text[i] === q && buf.trim() === '') {
      i++
      let v = ''
      while (i < text.length) {
        if (text[i] === q) {
          if (text[i + 1] === q) { v += q; i += 2; continue } // "" → a literal quote
          i++
          break
        }
        v += text[i]
        i++
      }
      out.push(q + v.split(q).join(q + q) + q) // re-quote so decodeItem unwraps it once
      buf = ''
      while (i < text.length && !eatDelimiter()) i++ // skip any junk before the next delimiter
      continue
    }
    if (eatDelimiter()) {
      out.push(buf)
      buf = ''
      continue
    }
    buf += text[i]
    i++
  }
  out.push(buf)
  return out
}

/** Strip the whole-list wrapper before parsing, if it is actually there. */
function stripListAffixes(text: string, s: LfSettings): string {
  let t = text
  if (s.listPrefix) {
    const lt = t.trimStart()
    if (lt.startsWith(s.listPrefix)) t = lt.slice(s.listPrefix.length)
  }
  if (s.listSuffix) {
    const rt = t.trimEnd()
    if (rt.endsWith(s.listSuffix)) t = rt.slice(0, rt.length - s.listSuffix.length)
  }
  return t
}

/** Full list → items pipeline (the reverse direction). */
function parseList(text: string, s: LfSettings): string[] {
  const tokens = splitList(stripListAffixes(text, s), s)
  return applyTransforms(tokens.map(t => decodeItem(t, s)), s)
}

/** Full column → items pipeline (the forward direction). */
function parseColumn(text: string, s: LfSettings): string[] {
  return applyTransforms(splitColumn(text), s)
}

// ── WebComponent ───────────────────────────────────────────────────────────

class ListForgeTool extends HTMLElement {
  private settings: LfSettings = { ...DEFAULTS }
  private source: Side = 'column'
  private root!: HTMLElement
  private columnEl!: HTMLTextAreaElement
  private listEl!: HTMLTextAreaElement
  private countEl!: HTMLElement
  private statusEl!: HTMLElement
  private customField!: HTMLElement
  private syncing = false
  private copyTimer = 0
  private onKeydown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      this.copy('list')
    }
  }

  connectedCallback() {
    this.settings = this.loadSettings()

    this.innerHTML = `
      <div data-type="tool-page" data-tool="list-forge">
        <div data-type="tool-header">
          <h1>List Forge</h1>
          <p>Turn a column of values into a comma-separated list — or a delimited list back into a column. Edit either side and the other updates as you type. Pick a delimiter, quote every value, wrap items or the whole list, then clean the data up: trim, dedupe, sort, reverse. Nothing is uploaded.</p>
        </div>

        <div data-group="toolbar">
          <button data-action="sample" type="button">Sample data</button>
          <button data-action="download-csv" type="button">Download .csv</button>
          <button data-action="download-txt" type="button">Download .txt</button>
          <button data-action="reset" type="button">Reset</button>
          <span data-type="lf-sep" aria-hidden="true"></span>
          <label data-type="lf-field" data-variant="check">
            <input data-control="autoCopy" type="checkbox" />
            <span>Auto-copy list</span>
          </label>
        </div>

        <div data-type="lf-panes">
          <section data-type="lf-pane" data-side="column">
            <div data-type="lf-pane-head">
              <span data-type="lf-pane-title">Column <small>one item per line</small></span>
              <div data-group="pane-actions">
                <button data-action="copy-column" type="button">Copy</button>
                <button data-action="clear-column" type="button">Clear</button>
              </div>
            </div>
            <textarea
              data-type="lf-column"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              aria-label="Column — one item per line"
              placeholder="Paste a column here…&#10;one&#10;item&#10;per line"
            ></textarea>
          </section>

          <section data-type="lf-pane" data-side="list">
            <div data-type="lf-pane-head">
              <span data-type="lf-pane-title">Delimited list <small>editable — converts back</small></span>
              <div data-group="pane-actions">
                <button data-action="copy-list" type="button">Copy</button>
                <button data-action="clear-list" type="button">Clear</button>
              </div>
            </div>
            <textarea
              data-type="lf-list"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              aria-label="Delimited list"
              placeholder="…or paste a delimited list here to get a column back  (Ctrl/Cmd + Enter to copy)"
            ></textarea>
          </section>
        </div>

        <div data-type="lf-statusbar">
          <span data-type="lf-count">List items: 0</span>
          <span data-type="lf-status" role="status" aria-live="polite"></span>
        </div>

        <details data-type="lf-settings" open>
          <summary>Settings</summary>

          <fieldset data-group="format">
            <legend>Format</legend>
            <label data-type="lf-field">
              <span>Delimiter</span>
              <select data-control="delim" aria-label="Delimiter">
                ${(Object.keys(DELIM_LABEL) as DelimKey[])
                  .map(k => `<option value="${k}">${DELIM_LABEL[k]}</option>`)
                  .join('')}
              </select>
            </label>
            <label data-type="lf-field" data-role="custom">
              <span>Custom</span>
              <input data-control="custom" type="text" size="6" placeholder="e.g. \\t" aria-label="Custom delimiter" />
            </label>
            <label data-type="lf-field">
              <span>Quotes</span>
              <select data-control="quotes" aria-label="Quote each item">
                <option value="none">None</option>
                <option value="double">Double "…"</option>
                <option value="single">Single '…'</option>
              </select>
            </label>
          </fieldset>

          <fieldset data-group="wrap">
            <legend>Wrap</legend>
            <label data-type="lf-field">
              <span>Item prefix</span>
              <input data-control="itemPrefix" type="text" size="6" aria-label="Item prefix" />
            </label>
            <label data-type="lf-field">
              <span>Item suffix</span>
              <input data-control="itemSuffix" type="text" size="6" aria-label="Item suffix" />
            </label>
            <label data-type="lf-field">
              <span>List prefix</span>
              <input data-control="listPrefix" type="text" size="6" aria-label="List prefix" />
            </label>
            <label data-type="lf-field">
              <span>List suffix</span>
              <input data-control="listSuffix" type="text" size="6" aria-label="List suffix" />
            </label>
          </fieldset>

          <fieldset data-group="transforms">
            <legend>Clean up</legend>
            <label data-type="lf-field" data-variant="check">
              <input data-control="trim" type="checkbox" /><span>Trim items</span>
            </label>
            <label data-type="lf-field" data-variant="check">
              <input data-control="removeEmpty" type="checkbox" /><span>Remove empty items</span>
            </label>
            <label data-type="lf-field" data-variant="check">
              <input data-control="collapseSpaces" type="checkbox" /><span>Remove extra spaces</span>
            </label>
            <label data-type="lf-field" data-variant="check">
              <input data-control="stripAllWs" type="checkbox" /><span>Remove all whitespace</span>
            </label>
            <label data-type="lf-field" data-variant="check">
              <input data-control="dedupe" type="checkbox" /><span>Remove duplicates</span>
            </label>
            <label data-type="lf-field" data-variant="check">
              <input data-control="lower" type="checkbox" /><span>Lowercase</span>
            </label>
            <label data-type="lf-field" data-variant="check">
              <input data-control="sortAsc" type="checkbox" /><span>Sort A→Z</span>
            </label>
            <label data-type="lf-field" data-variant="check">
              <input data-control="reverse" type="checkbox" /><span>Reverse order</span>
            </label>
          </fieldset>
        </details>

        <details data-type="lf-explainer">
          <summary>How it works</summary>
          <p>Whichever pane you type in is the source; the other pane is rebuilt from it on every keystroke, so the source is never rewritten under your cursor. Items are split from the column by line, or from the list by the chosen delimiter — a delimiter inside quotes never splits a value, and a quote inside a quoted value is written doubled (<code>""</code>), the CSV convention. The clean-up options run in a fixed order: whitespace first, then trim, lowercase, drop empties, dedupe, sort, and finally reverse. Settings and both panes are remembered in your browser.</p>
        </details>
      </div>
    `

    this.root = this.querySelector('[data-type="tool-page"]') as HTMLElement
    this.columnEl = this.querySelector('[data-type="lf-column"]') as HTMLTextAreaElement
    this.listEl = this.querySelector('[data-type="lf-list"]') as HTMLTextAreaElement
    this.countEl = this.querySelector('[data-type="lf-count"]') as HTMLElement
    this.statusEl = this.querySelector('[data-type="lf-status"]') as HTMLElement
    this.customField = this.querySelector('[data-role="custom"]') as HTMLElement

    this.reflectSettings()

    // Restore both panes, then regenerate the non-source side from the source.
    this.columnEl.value = this.readLS(LS_COLUMN) ?? ''
    this.listEl.value = this.readLS(LS_LIST) ?? ''
    this.source = this.readLS(LS_SOURCE) === 'list' ? 'list' : 'column'

    this.columnEl.addEventListener('input', () => this.onEdit('column'))
    this.listEl.addEventListener('input', () => this.onEdit('list'))

    this.root.querySelectorAll<HTMLElement>('[data-control]').forEach(el => {
      el.addEventListener(el instanceof HTMLSelectElement ? 'change' : 'input', () => this.onSettingChange(el))
    })

    this.root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => this.onAction(btn.dataset.action as string, btn))
    })

    this.addEventListener('keydown', this.onKeydown)

    this.render(false)
  }

  disconnectedCallback() {
    this.removeEventListener('keydown', this.onKeydown)
    window.clearTimeout(this.copyTimer)
  }

  // ── events ───────────────────────────────────────────────────────────────
  private onEdit(side: Side) {
    if (this.syncing) return
    this.source = side
    this.writeLS(LS_SOURCE, side)
    this.render(true)
  }

  private onSettingChange(el: HTMLElement) {
    const key = el.dataset.control as string
    const bag = this.settings as unknown as Record<string, string | boolean>
    if (el instanceof HTMLInputElement && el.type === 'checkbox') bag[key] = el.checked
    else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) bag[key] = el.value
    this.saveSettings()
    this.reflectSettings()
    this.render(true)
  }

  private onAction(action: string, btn: HTMLButtonElement) {
    switch (action) {
      case 'sample':
        this.columnEl.value = SAMPLE_COLUMN
        this.source = 'column'
        this.writeLS(LS_SOURCE, 'column')
        this.render(true)
        break
      case 'reset':
        this.settings = { ...DEFAULTS }
        this.saveSettings()
        this.reflectSettings()
        this.columnEl.value = ''
        this.listEl.value = ''
        this.source = 'column'
        this.writeLS(LS_SOURCE, 'column')
        this.render(false)
        this.setStatus('Reset to defaults.')
        break
      case 'clear-column':
        this.columnEl.value = ''
        this.source = 'column'
        this.render(true)
        this.columnEl.focus()
        break
      case 'clear-list':
        this.listEl.value = ''
        this.source = 'list'
        this.render(true)
        this.listEl.focus()
        break
      case 'copy-column':
        this.copy('column', btn)
        break
      case 'copy-list':
        this.copy('list', btn)
        break
      case 'download-csv':
        this.download('csv', 'text/csv', btn)
        break
      case 'download-txt':
        this.download('txt', 'text/plain', btn)
        break
    }
  }

  // ── conversion + rendering ───────────────────────────────────────────────
  /** Regenerate the non-source pane. `live` marks a user-driven change (enables auto-copy). */
  private render(live: boolean) {
    const s = this.settings
    const items = this.source === 'column'
      ? parseColumn(this.columnEl.value, s)
      : parseList(this.listEl.value, s)

    this.syncing = true
    if (this.source === 'column') this.listEl.value = items.length ? buildList(items, s) : ''
    else this.columnEl.value = items.join('\n')
    this.syncing = false

    const chars = this.listEl.value.length
    this.countEl.textContent = `List items: ${items.length} · ${chars} character${chars === 1 ? '' : 's'}`
    this.setStatus(items.length ? `${DELIM_LABEL[s.delim].toLowerCase()}-delimited · source: ${this.source}` : '')
    this.persist()

    if (live && s.autoCopy && this.listEl.value) this.scheduleAutoCopy()
  }

  private scheduleAutoCopy() {
    window.clearTimeout(this.copyTimer)
    this.copyTimer = window.setTimeout(async () => {
      try {
        await navigator.clipboard.writeText(this.listEl.value)
        this.setStatus('List copied to clipboard automatically.')
      } catch {
        /* clipboard may be blocked without a gesture — stay quiet */
      }
    }, 600)
  }

  private async copy(side: Side, btn?: HTMLButtonElement) {
    const text = side === 'list' ? this.listEl.value : this.columnEl.value
    if (!text) {
      this.setStatus('Nothing to copy yet.')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      if (btn) this.flash(btn, 'Copied!')
      this.setStatus(`${side === 'list' ? 'List' : 'Column'} copied to clipboard.`)
    } catch {
      if (btn) this.flash(btn, 'Failed')
      this.setStatus('Copy failed — your browser blocked clipboard access.')
    }
  }

  private download(ext: string, mime: string, btn: HTMLButtonElement) {
    const text = this.listEl.value
    if (!text) {
      this.setStatus('Nothing to download yet.')
      return
    }
    try {
      const blob = new Blob([text], { type: `${mime};charset=utf-8` })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `list.${ext}`
      a.click()
      URL.revokeObjectURL(url)
      this.flash(btn, 'Saved!')
    } catch {
      this.flash(btn, 'Failed')
    }
  }

  // ── UI plumbing ──────────────────────────────────────────────────────────
  /** Push the settings object into the controls, and show/hide the custom field. */
  private reflectSettings() {
    this.root.querySelectorAll<HTMLElement>('[data-control]').forEach(el => {
      const key = el.dataset.control as keyof LfSettings
      const v = this.settings[key]
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(v)
      else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = String(v)
    })
    this.customField.hidden = this.settings.delim !== 'custom'
  }

  private flash(btn: HTMLButtonElement, label: string) {
    const original = btn.dataset.label ?? btn.textContent ?? ''
    if (!btn.dataset.label) btn.dataset.label = original
    btn.textContent = label
    window.setTimeout(() => { btn.textContent = btn.dataset.label ?? original }, 1400)
  }

  private setStatus(label: string) {
    this.statusEl.textContent = label
  }

  // ── localStorage (all guarded; storage may be unavailable or full) ────────
  private persist() {
    const col = this.columnEl.value
    const list = this.listEl.value
    if (col.length <= LF_MAX_PERSIST) this.writeLS(LS_COLUMN, col)
    if (list.length <= LF_MAX_PERSIST) this.writeLS(LS_LIST, list)
  }

  private loadSettings(): LfSettings {
    const raw = this.readLS(LS_SETTINGS)
    if (!raw) return { ...DEFAULTS }
    try {
      const parsed = JSON.parse(raw) as Partial<LfSettings>
      const merged = { ...DEFAULTS, ...parsed }
      if (!(merged.delim in DELIM_LABEL)) merged.delim = DEFAULTS.delim
      if (!['none', 'double', 'single'].includes(merged.quotes)) merged.quotes = DEFAULTS.quotes
      return merged
    } catch {
      return { ...DEFAULTS }
    }
  }

  private saveSettings() {
    this.writeLS(LS_SETTINGS, JSON.stringify(this.settings))
  }

  private readLS(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  }

  private writeLS(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* ignore quota / private-mode errors */ }
  }
}

if (!customElements.get('list-forge-tool')) {
  customElements.define('list-forge-tool', ListForgeTool)
}

export {}
