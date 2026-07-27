/**
 * Codec Forge — a Base64 + URL encoder / decoder, bundled as one tabbed tool.
 *
 * Three tabs, all client-side and zero-dependency:
 *   1. BASE64  — two live panes (plain text ↔ Base64). Edit either side and the
 *      other updates as you type. Standard (+/) or URL-safe (-_) alphabet, MIME
 *      line-wrapping, and forgiving decode (whitespace, missing padding, and
 *      either alphabet all accepted). UTF-8 safe end to end (TextEncoder /
 *      TextDecoder, not raw btoa/atob). Plus file → Base64 (any file, with an
 *      optional data: URI and a live image preview) and Base64 → file download.
 *   2. URL     — two live panes (text ↔ percent-encoded). encodeURIComponent
 *      (component) or encodeURI (whole URL) on the way out; a salvaging decoder
 *      that survives malformed input on the way back, with an optional
 *      "+ means space" (form-encoding) toggle.
 *   3. QUERY   — parse a query string or full URL into decoded key = value pairs
 *      (repeated keys kept, + decoded to space), shown as an editable pane and a
 *      read-only table with per-value copy. Edit the pairs to rebuild an encoded
 *      query string. Bidirectional, like the other panes.
 *
 * Copy-first, keyboard-friendly (Ctrl/Cmd + Enter copies the active tab's
 * output), and every pane + setting is remembered in localStorage. Nothing is
 * uploaded — files are read locally with FileReader.
 *
 * Mounts as a WebComponent so it survives Astro's client-side View Transitions
 * (see the astro:page-load wiring in tools/[slug].astro). All module-level names
 * are cf-/CF_-prefixed because tool component files share one global script scope.
 */

type CfTab = 'base64' | 'url' | 'query'
type CfB64Variant = 'standard' | 'urlsafe'
type CfUrlMode = 'component' | 'uri'
type CfB64Source = 'text' | 'b64'
type CfUrlSource = 'text' | 'enc'
type CfQuerySource = 'raw' | 'pairs'

interface CfSettings {
  tab: CfTab
  b64Variant: CfB64Variant
  b64Wrap: number // 0 = no wrap, else column width (64 / 76)
  urlMode: CfUrlMode
  urlPlusSpace: boolean
}

const CF_LS_SETTINGS = 'codec-forge:settings:v1'
const CF_LS_B64_TEXT = 'codec-forge:b64-text:v1'
const CF_LS_B64_B64 = 'codec-forge:b64-b64:v1'
const CF_LS_B64_SRC = 'codec-forge:b64-src:v1'
const CF_LS_URL_TEXT = 'codec-forge:url-text:v1'
const CF_LS_URL_ENC = 'codec-forge:url-enc:v1'
const CF_LS_URL_SRC = 'codec-forge:url-src:v1'
const CF_LS_Q_RAW = 'codec-forge:q-raw:v1'
const CF_LS_Q_PAIRS = 'codec-forge:q-pairs:v1'
const CF_LS_Q_SRC = 'codec-forge:q-src:v1'
const CF_MAX_PERSIST = 256 * 1024 // don't try to persist absurdly large blobs

const CF_DEFAULTS: CfSettings = {
  tab: 'base64',
  b64Variant: 'standard',
  b64Wrap: 0,
  urlMode: 'component',
  urlPlusSpace: false,
}

const CF_TABS: { key: CfTab; label: string }[] = [
  { key: 'base64', label: 'Base64' },
  { key: 'url', label: 'URL encode' },
  { key: 'query', label: 'Query string' },
]

const CF_SAMPLE_B64 = 'Hello, 世界! 👋 Base64 handles UTF-8 cleanly.'
const CF_SAMPLE_URL = 'https://example.com/search?q=café & pâtisserie/?#top'
const CF_SAMPLE_QUERY =
  'https://shop.example.com/items?category=home+goods&sort=price&tags=new&tags=sale&q=cast%20iron&page=2#reviews'

// ── Base64 engine (no DOM — unit-testable in isolation) ─────────────────────

const CF_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const CF_STD = CF_ALPHA + '+/'
const CF_URL = CF_ALPHA + '-_'

/** Reverse lookup: maps every Base64 char (both alphabets) to its 6-bit value. */
const CF_REV: Record<string, number> = (() => {
  const m: Record<string, number> = {}
  for (let i = 0; i < CF_STD.length; i++) m[CF_STD[i]] = i
  m['-'] = 62 // URL-safe +
  m['_'] = 63 // URL-safe /
  return m
})()

/** Encode raw bytes to Base64 (standard or URL-safe, the latter unpadded). */
function cfEncodeBytes(bytes: Uint8Array, urlSafe: boolean): string {
  const alpha = urlSafe ? CF_URL : CF_STD
  const pad = urlSafe ? '' : '='
  let out = ''
  const len = bytes.length
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < len ? bytes[i + 1] : 0
    const b2 = i + 2 < len ? bytes[i + 2] : 0
    const n = (b0 << 16) | (b1 << 8) | b2
    out += alpha[(n >> 18) & 63]
    out += alpha[(n >> 12) & 63]
    out += i + 1 < len ? alpha[(n >> 6) & 63] : pad
    out += i + 2 < len ? alpha[n & 63] : pad
  }
  return out
}

/**
 * Decode Base64 to raw bytes. Deliberately forgiving: any char that is not a
 * Base64 digit (whitespace, newlines, '=', stray punctuation) is skipped, and
 * both the standard and URL-safe alphabets are accepted, so pasted values with
 * line breaks or missing padding still decode.
 */
function cfDecodeBytes(input: string): Uint8Array {
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (let i = 0; i < input.length; i++) {
    const v = CF_REV[input[i]]
    if (v === undefined) continue
    buffer = (buffer << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return Uint8Array.from(out)
}

/** Break a string into fixed-width lines (MIME wants 76, PEM 64). */
function cfWrap(s: string, width: number): string {
  if (!width || s.length <= width) return s
  const lines: string[] = []
  for (let i = 0; i < s.length; i += width) lines.push(s.slice(i, i + width))
  return lines.join('\n')
}

function cfTextToB64(text: string, urlSafe: boolean, wrap: number): string {
  const b64 = cfEncodeBytes(new TextEncoder().encode(text), urlSafe)
  return cfWrap(b64, wrap)
}

function cfB64ToText(b64: string): string {
  return new TextDecoder().decode(cfDecodeBytes(b64))
}

/** Cheap validity classification for the status line. */
function cfB64Status(input: string): 'empty' | 'ok' | 'bad' {
  const cleaned = input.replace(/\s+/g, '')
  if (cleaned === '') return 'empty'
  const body = cleaned.replace(/=+$/, '')
  return /^[A-Za-z0-9+/\-_]*$/.test(body) ? 'ok' : 'bad'
}

// ── URL engine ───────────────────────────────────────────────────────────────

function cfUrlEncode(text: string, mode: CfUrlMode): string {
  return mode === 'uri' ? encodeURI(text) : encodeURIComponent(text)
}

/**
 * Decode percent-encoding without throwing on malformed input. decodeURIComponent
 * rejects the whole string on a single bad '%', so instead we decode each run of
 * valid %XX sequences (a run so multi-byte UTF-8 spanning several %XX still joins)
 * and leave anything malformed untouched.
 */
function cfSafeUrlDecode(text: string): string {
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, m => {
    try {
      return decodeURIComponent(m)
    } catch {
      return m
    }
  })
}

function cfUrlDecode(text: string, plusAsSpace: boolean): string {
  const t = plusAsSpace ? text.replace(/\+/g, '%20') : text
  return cfSafeUrlDecode(t)
}

// ── Query-string engine ──────────────────────────────────────────────────────

interface CfPair {
  key: string
  value: string
  hasValue: boolean
}

/** Pull the query section out of a full URL (or accept a bare query string). */
function cfExtractQuery(raw: string): string {
  let q = raw.trim()
  const hash = q.indexOf('#')
  if (hash >= 0) q = q.slice(0, hash) // fragments aren't part of the query
  const qmark = q.indexOf('?')
  if (qmark >= 0) q = q.slice(qmark + 1)
  return q.replace(/^[?&]+/, '')
}

/** Parse a query string into decoded key/value pairs (repeated keys preserved). */
function cfParseQuery(raw: string): CfPair[] {
  const q = cfExtractQuery(raw)
  if (q === '') return []
  return q
    .split('&')
    .filter(seg => seg !== '')
    .map(seg => {
      const eq = seg.indexOf('=')
      const kRaw = eq >= 0 ? seg.slice(0, eq) : seg
      const vRaw = eq >= 0 ? seg.slice(eq + 1) : ''
      return {
        key: cfSafeUrlDecode(kRaw.replace(/\+/g, ' ')),
        value: cfSafeUrlDecode(vRaw.replace(/\+/g, ' ')),
        hasValue: eq >= 0,
      }
    })
}

/** Render decoded pairs as one editable "key = value" line each. */
function cfPairsToText(pairs: CfPair[]): string {
  return pairs.map(p => (p.hasValue ? `${p.key} = ${p.value}` : p.key)).join('\n')
}

/** Turn "key = value" lines back into an encoded query string. */
function cfBuildQuery(pairsText: string): string {
  return pairsText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l !== '')
    .map(line => {
      const eq = line.indexOf('=')
      if (eq < 0) return encodeURIComponent(line.trim())
      const k = line.slice(0, eq).trim()
      const v = line.slice(eq + 1).trim()
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
    })
    .join('&')
}

function cfBytesLabel(n: number): string {
  if (n < 1024) return `${n} byte${n === 1 ? '' : 's'}`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// ── WebComponent ─────────────────────────────────────────────────────────────

class CodecForgeTool extends HTMLElement {
  private settings: CfSettings = { ...CF_DEFAULTS }
  private b64Source: CfB64Source = 'text'
  private urlSource: CfUrlSource = 'text'
  private querySource: CfQuerySource = 'raw'
  private syncing = false
  private lastFileBytes: Uint8Array | null = null
  private lastFileName = ''
  private lastFileType = ''
  private copyTimer = 0

  private root!: HTMLElement
  // base64
  private b64TextEl!: HTMLTextAreaElement
  private b64B64El!: HTMLTextAreaElement
  private b64CountEl!: HTMLElement
  private b64StatusEl!: HTMLElement
  private fileInfoEl!: HTMLElement
  private filePreviewEl!: HTMLImageElement
  // url
  private urlTextEl!: HTMLTextAreaElement
  private urlEncEl!: HTMLTextAreaElement
  private urlCountEl!: HTMLElement
  private urlStatusEl!: HTMLElement
  // query
  private qRawEl!: HTMLTextAreaElement
  private qPairsEl!: HTMLTextAreaElement
  private qTableEl!: HTMLElement
  private qCountEl!: HTMLElement

  private onKeydown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      this.copyActiveOutput()
    }
  }

  connectedCallback() {
    this.settings = this.loadSettings()

    this.innerHTML = `
      <div data-type="tool-page" data-tool="codec-forge">
        <div data-type="tool-header">
          <h1>Codec Forge</h1>
          <p>Encode and decode Base64 and URLs, and take query strings apart — all in your browser, nothing uploaded. Edit either side of a pane and the other updates as you type. Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> to copy the current output.</p>
        </div>

        <div data-type="cf-tabs" role="tablist" aria-label="Codec Forge tools">
          ${CF_TABS.map(
            t => `<button data-tab-btn="${t.key}" type="button" role="tab" aria-selected="false">${t.label}</button>`,
          ).join('')}
        </div>

        <!-- ── BASE64 ─────────────────────────────────────────── -->
        <section data-tab="base64" role="tabpanel" aria-label="Base64 encoder and decoder">
          <div data-group="toolbar">
            <label data-type="cf-field">
              <span>Alphabet</span>
              <select data-control="b64Variant" aria-label="Base64 alphabet">
                <option value="standard">Standard (+/)</option>
                <option value="urlsafe">URL-safe (-_)</option>
              </select>
            </label>
            <label data-type="cf-field">
              <span>Line wrap</span>
              <select data-control="b64Wrap" aria-label="Wrap Base64 output">
                <option value="0">None</option>
                <option value="76">76 (MIME)</option>
                <option value="64">64 (PEM)</option>
              </select>
            </label>
            <span data-type="cf-sep" aria-hidden="true"></span>
            <button data-action="b64-sample" type="button">Sample</button>
            <button data-action="b64-clear" type="button">Clear</button>
          </div>

          <div data-type="cf-panes">
            <section data-type="cf-pane">
              <div data-type="cf-pane-head">
                <span data-type="cf-pane-title">Plain text</span>
                <button data-action="copy-b64-text" type="button">Copy</button>
              </div>
              <textarea data-io="b64-text" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" aria-label="Plain text" placeholder="Type text to encode…"></textarea>
            </section>
            <section data-type="cf-pane">
              <div data-type="cf-pane-head">
                <span data-type="cf-pane-title">Base64 <small>editable — decodes back</small></span>
                <button data-action="copy-b64-b64" type="button">Copy</button>
              </div>
              <textarea data-io="b64-b64" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" aria-label="Base64" placeholder="…or paste Base64 here to decode it"></textarea>
            </section>
          </div>

          <div data-type="cf-statusbar">
            <span data-type="cf-count" data-for="b64">0 bytes</span>
            <span data-type="cf-status" data-for="b64" role="status" aria-live="polite"></span>
          </div>

          <details data-type="cf-block">
            <summary>File ⇄ Base64</summary>
            <div data-type="cf-file-row">
              <label data-type="cf-field" data-variant="file">
                <span>Encode a file</span>
                <input data-action="file" type="file" aria-label="Choose a file to Base64-encode" />
              </label>
              <button data-action="b64-download" type="button">Download decoded Base64 as a file…</button>
            </div>
            <p data-type="cf-file-info" role="status" aria-live="polite">Pick any file to Base64-encode it locally — the result lands in the Base64 pane. Images also show a preview.</p>
            <img data-type="cf-file-preview" alt="Preview of the selected image" hidden />
          </details>

          <details data-type="cf-explainer">
            <summary>How Base64 works</summary>
            <p>Base64 packs every three bytes (24 bits) into four printable characters of six bits each, so binary data survives channels that only accept text — data URIs, JSON, email. Text is read as UTF-8 first, so accented letters and emoji round-trip cleanly. The <strong>URL-safe</strong> alphabet swaps <code>+</code> and <code>/</code> for <code>-</code> and <code>_</code> and drops the <code>=</code> padding, so a value can sit in a URL or filename untouched. Decoding here is forgiving: whitespace, line breaks, missing padding, and either alphabet are all accepted.</p>
          </details>
        </section>

        <!-- ── URL ────────────────────────────────────────────── -->
        <section data-tab="url" role="tabpanel" aria-label="URL encoder and decoder" hidden>
          <div data-group="toolbar">
            <label data-type="cf-field">
              <span>Encode</span>
              <select data-control="urlMode" aria-label="URL encoding mode">
                <option value="component">Component (encodeURIComponent)</option>
                <option value="uri">Whole URL (encodeURI)</option>
              </select>
            </label>
            <label data-type="cf-field" data-variant="check">
              <input data-control="urlPlusSpace" type="checkbox" />
              <span>Decode + as space</span>
            </label>
            <span data-type="cf-sep" aria-hidden="true"></span>
            <button data-action="url-sample" type="button">Sample</button>
            <button data-action="url-clear" type="button">Clear</button>
          </div>

          <div data-type="cf-panes">
            <section data-type="cf-pane">
              <div data-type="cf-pane-head">
                <span data-type="cf-pane-title">Plain text</span>
                <button data-action="copy-url-text" type="button">Copy</button>
              </div>
              <textarea data-io="url-text" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" aria-label="Plain text or URL" placeholder="Type text or a URL to encode…"></textarea>
            </section>
            <section data-type="cf-pane">
              <div data-type="cf-pane-head">
                <span data-type="cf-pane-title">Percent-encoded <small>editable — decodes back</small></span>
                <button data-action="copy-url-enc" type="button">Copy</button>
              </div>
              <textarea data-io="url-enc" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" aria-label="Percent-encoded" placeholder="…or paste an encoded value here to decode it"></textarea>
            </section>
          </div>

          <div data-type="cf-statusbar">
            <span data-type="cf-count" data-for="url">0 characters</span>
            <span data-type="cf-status" data-for="url" role="status" aria-live="polite"></span>
          </div>

          <details data-type="cf-explainer">
            <summary>Component vs whole-URL encoding</summary>
            <p><strong>Component</strong> (<code>encodeURIComponent</code>) escapes everything that isn't safe inside a single query value or path segment, including <code>&amp; = ? / #</code> — use it for one field at a time. <strong>Whole URL</strong> (<code>encodeURI</code>) leaves those reserved characters alone so an entire address stays functional, only escaping spaces and other clearly-illegal characters. Decoding tolerates malformed input: a stray <code>%</code> is left as-is instead of breaking the whole string. Turn on <em>decode + as space</em> for values that came from an HTML form, where a space is written as <code>+</code>.</p>
          </details>
        </section>

        <!-- ── QUERY STRING ───────────────────────────────────── -->
        <section data-tab="query" role="tabpanel" aria-label="Query string parser" hidden>
          <div data-group="toolbar">
            <button data-action="query-sample" type="button">Sample</button>
            <button data-action="query-clear" type="button">Clear</button>
            <button data-action="copy-query-raw" type="button">Copy query string</button>
          </div>

          <div data-type="cf-panes">
            <section data-type="cf-pane">
              <div data-type="cf-pane-head">
                <span data-type="cf-pane-title">URL or query string</span>
              </div>
              <textarea data-io="q-raw" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" aria-label="URL or query string" placeholder="Paste a URL or ?a=1&b=2 query string…"></textarea>
            </section>
            <section data-type="cf-pane">
              <div data-type="cf-pane-head">
                <span data-type="cf-pane-title">Decoded pairs <small>editable — key = value per line</small></span>
              </div>
              <textarea data-io="q-pairs" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" aria-label="Decoded key value pairs" placeholder="key = value&#10;one per line — rebuilds the query string"></textarea>
            </section>
          </div>

          <div data-type="cf-statusbar">
            <span data-type="cf-count" data-for="query">0 parameters</span>
          </div>

          <div data-type="cf-parsed" aria-label="Parsed parameters"></div>

          <details data-type="cf-explainer">
            <summary>How query strings parse</summary>
            <p>Everything after the first <code>?</code> (and before any <code>#</code> fragment) is split on <code>&amp;</code> into <code>key=value</code> pairs, each half percent-decoded, with <code>+</code> read as a space the way form submissions encode it. Repeated keys are kept in order — many servers expect <code>tags=new&amp;tags=sale</code> to mean a list. Edit the decoded pairs and the query string is rebuilt with proper encoding; a line without an <code>=</code> becomes a bare, valueless key.</p>
          </details>
        </section>
      </div>
    `

    this.root = this.querySelector('[data-type="tool-page"]') as HTMLElement
    this.b64TextEl = this.q('[data-io="b64-text"]')
    this.b64B64El = this.q('[data-io="b64-b64"]')
    this.b64CountEl = this.q('[data-type="cf-count"][data-for="b64"]')
    this.b64StatusEl = this.q('[data-type="cf-status"][data-for="b64"]')
    this.fileInfoEl = this.q('[data-type="cf-file-info"]')
    this.filePreviewEl = this.q('[data-type="cf-file-preview"]')
    this.urlTextEl = this.q('[data-io="url-text"]')
    this.urlEncEl = this.q('[data-io="url-enc"]')
    this.urlCountEl = this.q('[data-type="cf-count"][data-for="url"]')
    this.urlStatusEl = this.q('[data-type="cf-status"][data-for="url"]')
    this.qRawEl = this.q('[data-io="q-raw"]')
    this.qPairsEl = this.q('[data-io="q-pairs"]')
    this.qTableEl = this.q('[data-type="cf-parsed"]')
    this.qCountEl = this.q('[data-type="cf-count"][data-for="query"]')

    this.reflectSettings()

    // Restore pane contents + which side was last the source of truth.
    this.b64TextEl.value = this.readLS(CF_LS_B64_TEXT) ?? ''
    this.b64B64El.value = this.readLS(CF_LS_B64_B64) ?? ''
    this.b64Source = this.readLS(CF_LS_B64_SRC) === 'b64' ? 'b64' : 'text'
    this.urlTextEl.value = this.readLS(CF_LS_URL_TEXT) ?? ''
    this.urlEncEl.value = this.readLS(CF_LS_URL_ENC) ?? ''
    this.urlSource = this.readLS(CF_LS_URL_SRC) === 'enc' ? 'enc' : 'text'
    this.qRawEl.value = this.readLS(CF_LS_Q_RAW) ?? ''
    this.qPairsEl.value = this.readLS(CF_LS_Q_PAIRS) ?? ''
    this.querySource = this.readLS(CF_LS_Q_SRC) === 'pairs' ? 'pairs' : 'raw'

    // Pane edits set the source and regenerate the opposite side.
    this.b64TextEl.addEventListener('input', () => this.onEdit('base64', 'text'))
    this.b64B64El.addEventListener('input', () => this.onEdit('base64', 'b64'))
    this.urlTextEl.addEventListener('input', () => this.onEdit('url', 'text'))
    this.urlEncEl.addEventListener('input', () => this.onEdit('url', 'enc'))
    this.qRawEl.addEventListener('input', () => this.onEdit('query', 'raw'))
    this.qPairsEl.addEventListener('input', () => this.onEdit('query', 'pairs'))

    this.root.querySelectorAll<HTMLElement>('[data-control]').forEach(el => {
      el.addEventListener(el instanceof HTMLSelectElement ? 'change' : 'input', () => this.onSettingChange(el))
    })

    this.root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => {
      const act = btn.dataset.action as string
      if (act === 'file') return // handled via change below
      btn.addEventListener('click', () => this.onAction(act, btn))
    })
    ;(this.q('[data-action="file"]') as HTMLInputElement).addEventListener('change', e => this.onFile(e))

    this.addEventListener('keydown', this.onKeydown)

    // Render all three tabs once so switching tabs shows correct output, then
    // reveal the persisted active tab.
    this.renderBase64(false)
    this.renderUrl(false)
    this.renderQuery(false)
    this.setTab(this.settings.tab)
  }

  disconnectedCallback() {
    this.removeEventListener('keydown', this.onKeydown)
    window.clearTimeout(this.copyTimer)
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.querySelector(sel) as T
  }

  // ── events ─────────────────────────────────────────────────────────────────
  private onEdit(tab: CfTab, side: string) {
    if (this.syncing) return
    if (tab === 'base64') {
      this.b64Source = side as CfB64Source
      this.writeLS(CF_LS_B64_SRC, this.b64Source)
      this.renderBase64(false)
    } else if (tab === 'url') {
      this.urlSource = side as CfUrlSource
      this.writeLS(CF_LS_URL_SRC, this.urlSource)
      this.renderUrl(false)
    } else {
      this.querySource = side as CfQuerySource
      this.writeLS(CF_LS_Q_SRC, this.querySource)
      this.renderQuery(false)
    }
  }

  private onSettingChange(el: HTMLElement) {
    const key = el.dataset.control as keyof CfSettings
    const bag = this.settings as unknown as Record<string, string | number | boolean>
    if (el instanceof HTMLInputElement && el.type === 'checkbox') bag[key] = el.checked
    else if (el instanceof HTMLSelectElement && key === 'b64Wrap') bag[key] = Number(el.value)
    else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) bag[key] = el.value
    this.saveSettings()
    // Re-render the tab the control belongs to.
    if (key === 'b64Variant' || key === 'b64Wrap') this.renderBase64(false)
    else this.renderUrl(false)
  }

  private onAction(action: string, btn: HTMLButtonElement) {
    switch (action) {
      case 'b64-sample':
        this.b64TextEl.value = CF_SAMPLE_B64
        this.b64Source = 'text'
        this.writeLS(CF_LS_B64_SRC, 'text')
        this.renderBase64(false)
        break
      case 'b64-clear':
        this.b64TextEl.value = ''
        this.b64B64El.value = ''
        this.b64Source = 'text'
        this.clearFile()
        this.renderBase64(false)
        this.b64TextEl.focus()
        break
      case 'copy-b64-text':
        this.copy(this.b64TextEl.value, btn)
        break
      case 'copy-b64-b64':
        this.copy(this.b64B64El.value, btn)
        break
      case 'b64-download':
        this.downloadDecoded(btn)
        break
      case 'url-sample':
        this.urlTextEl.value = CF_SAMPLE_URL
        this.urlSource = 'text'
        this.writeLS(CF_LS_URL_SRC, 'text')
        this.renderUrl(false)
        break
      case 'url-clear':
        this.urlTextEl.value = ''
        this.urlEncEl.value = ''
        this.urlSource = 'text'
        this.renderUrl(false)
        this.urlTextEl.focus()
        break
      case 'copy-url-text':
        this.copy(this.urlTextEl.value, btn)
        break
      case 'copy-url-enc':
        this.copy(this.urlEncEl.value, btn)
        break
      case 'query-sample':
        this.qRawEl.value = CF_SAMPLE_QUERY
        this.querySource = 'raw'
        this.writeLS(CF_LS_Q_SRC, 'raw')
        this.renderQuery(false)
        break
      case 'query-clear':
        this.qRawEl.value = ''
        this.qPairsEl.value = ''
        this.querySource = 'raw'
        this.renderQuery(false)
        this.qRawEl.focus()
        break
      case 'copy-query-raw':
        this.copy(this.qRawEl.value, btn)
        break
    }
  }

  // ── tab switching ────────────────────────────────────────────────────────
  private setTab(tab: CfTab) {
    this.settings.tab = tab
    this.saveSettings()
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach(sec => {
      sec.hidden = sec.dataset.tab !== tab
    })
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab-btn]').forEach(btn => {
      const on = btn.dataset.tabBtn === tab
      btn.setAttribute('aria-selected', String(on))
      btn.toggleAttribute('data-active', on)
    })
  }

  // ── rendering ────────────────────────────────────────────────────────────
  private renderBase64(_live: boolean) {
    const s = this.settings
    this.syncing = true
    if (this.b64Source === 'text') {
      this.b64B64El.value = cfTextToB64(this.b64TextEl.value, s.b64Variant === 'urlsafe', s.b64Wrap)
    } else {
      this.b64TextEl.value = cfB64ToText(this.b64B64El.value)
    }
    this.syncing = false

    const bytes = new TextEncoder().encode(this.b64TextEl.value).length
    this.b64CountEl.textContent = `${cfBytesLabel(bytes)} · ${this.b64B64El.value.replace(/\s/g, '').length} Base64 chars`
    const st = cfB64Status(this.b64B64El.value)
    this.b64StatusEl.textContent =
      st === 'bad'
        ? '⚠ Base64 has characters outside the alphabet — decoded as far as possible.'
        : this.b64Source === 'text'
          ? `Encoded · ${s.b64Variant === 'urlsafe' ? 'URL-safe' : 'standard'} alphabet`
          : st === 'empty'
            ? ''
            : 'Decoded from Base64.'
    this.persistBase64()
  }

  private renderUrl(_live: boolean) {
    const s = this.settings
    this.syncing = true
    if (this.urlSource === 'text') {
      this.urlEncEl.value = cfUrlEncode(this.urlTextEl.value, s.urlMode)
    } else {
      this.urlTextEl.value = cfUrlDecode(this.urlEncEl.value, s.urlPlusSpace)
    }
    this.syncing = false

    this.urlCountEl.textContent = `${this.urlTextEl.value.length} chars in · ${this.urlEncEl.value.length} chars out`
    const enc = this.urlEncEl.value
    const malformed = /%(?![0-9A-Fa-f]{2})/.test(enc) && this.urlSource === 'enc'
    this.urlStatusEl.textContent = !enc
      ? ''
      : malformed
        ? '⚠ Contains a % not followed by two hex digits — left as-is.'
        : this.urlSource === 'text'
          ? `Encoded · ${s.urlMode === 'uri' ? 'whole-URL' : 'component'} mode`
          : 'Decoded.'
    this.persistUrl()
  }

  private renderQuery(_live: boolean) {
    this.syncing = true
    if (this.querySource === 'raw') {
      this.qPairsEl.value = cfPairsToText(cfParseQuery(this.qRawEl.value))
    } else {
      this.qRawEl.value = cfBuildQuery(this.qPairsEl.value)
    }
    this.syncing = false

    const pairs = cfParseQuery(this.qRawEl.value)
    this.qCountEl.textContent = `${pairs.length} parameter${pairs.length === 1 ? '' : 's'}`
    this.renderParsedTable(pairs)
    this.persistQuery()
  }

  /** Read-only table of parsed pairs, each value one-click copyable. Built with
   *  the DOM (not innerHTML) so decoded values can never inject markup. */
  private renderParsedTable(pairs: CfPair[]) {
    this.qTableEl.textContent = ''
    if (pairs.length === 0) return
    for (const p of pairs) {
      const row = document.createElement('div')
      row.setAttribute('data-type', 'cf-row')

      const key = document.createElement('span')
      key.setAttribute('data-type', 'cf-key')
      key.textContent = p.key

      const val = document.createElement('span')
      val.setAttribute('data-type', 'cf-val')
      val.textContent = p.hasValue ? p.value : '(no value)'
      if (!p.hasValue) val.setAttribute('data-empty', 'true')

      const copy = document.createElement('button')
      copy.type = 'button'
      copy.setAttribute('data-type', 'cf-row-copy')
      copy.textContent = 'Copy'
      copy.setAttribute('aria-label', `Copy value of ${p.key || 'parameter'}`)
      copy.addEventListener('click', () => this.copy(p.value, copy))

      row.append(key, val, copy)
      this.qTableEl.append(row)
    }
  }

  // ── file handling ──────────────────────────────────────────────────────────
  private onFile(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer)
      this.lastFileBytes = bytes
      this.lastFileName = file.name
      this.lastFileType = file.type
      // Result goes into the Base64 pane; the pane is now the source of truth.
      const s = this.settings
      this.b64B64El.value = cfWrap(cfEncodeBytes(bytes, s.b64Variant === 'urlsafe'), s.b64Wrap)
      this.b64Source = 'b64'
      this.writeLS(CF_LS_B64_SRC, 'b64')
      this.renderBase64(false)

      const dataUri = `data:${file.type || 'application/octet-stream'};base64,${cfEncodeBytes(bytes, false)}`
      if (file.type.startsWith('image/')) {
        this.filePreviewEl.src = dataUri
        this.filePreviewEl.hidden = false
      } else {
        this.filePreviewEl.hidden = true
      }
      this.fileInfoEl.textContent = `${file.name} — ${cfBytesLabel(bytes.length)}${file.type ? ` · ${file.type}` : ''}. Base64 is in the pane above; the Plain-text pane shows its decoded bytes.`
    }
    reader.onerror = () => {
      this.fileInfoEl.textContent = 'Could not read that file.'
    }
    reader.readAsArrayBuffer(file)
    input.value = '' // allow re-selecting the same file
  }

  private clearFile() {
    this.lastFileBytes = null
    this.lastFileName = ''
    this.lastFileType = ''
    this.filePreviewEl.hidden = true
    this.filePreviewEl.removeAttribute('src')
    this.fileInfoEl.textContent =
      'Pick any file to Base64-encode it locally — the result lands in the Base64 pane. Images also show a preview.'
  }

  private downloadDecoded(btn: HTMLButtonElement) {
    const b64 = this.b64B64El.value
    if (!b64.trim()) {
      this.flash(btn, 'Nothing to save')
      return
    }
    try {
      const bytes = cfDecodeBytes(b64)
      const type = this.lastFileType || 'application/octet-stream'
      const blob = new Blob([bytes], { type })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = this.lastFileName || 'decoded.bin'
      a.click()
      URL.revokeObjectURL(url)
      this.flash(btn, 'Saved!')
    } catch {
      this.flash(btn, 'Failed')
    }
  }

  // ── clipboard ────────────────────────────────────────────────────────────
  private copyActiveOutput() {
    if (this.settings.tab === 'base64') {
      this.copy(this.b64Source === 'text' ? this.b64B64El.value : this.b64TextEl.value)
    } else if (this.settings.tab === 'url') {
      this.copy(this.urlSource === 'text' ? this.urlEncEl.value : this.urlTextEl.value)
    } else {
      this.copy(this.querySource === 'pairs' ? this.qRawEl.value : this.qPairsEl.value)
    }
  }

  private async copy(text: string, btn?: HTMLButtonElement) {
    if (!text) {
      if (btn) this.flash(btn, 'Empty')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      if (btn) this.flash(btn, 'Copied!')
    } catch {
      if (btn) this.flash(btn, 'Failed')
    }
  }

  private flash(btn: HTMLButtonElement, label: string) {
    const original = btn.dataset.label ?? btn.textContent ?? ''
    if (!btn.dataset.label) btn.dataset.label = original
    btn.textContent = label
    window.clearTimeout(this.copyTimer)
    this.copyTimer = window.setTimeout(() => {
      btn.textContent = btn.dataset.label ?? original
    }, 1400)
  }

  // ── UI plumbing ────────────────────────────────────────────────────────────
  private reflectSettings() {
    this.root.querySelectorAll<HTMLElement>('[data-control]').forEach(el => {
      const key = el.dataset.control as keyof CfSettings
      const v = this.settings[key]
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(v)
      else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = String(v)
    })
    // Tab buttons wire their own click here (kept out of the [data-action] loop).
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab-btn]').forEach(btn => {
      btn.addEventListener('click', () => this.setTab(btn.dataset.tabBtn as CfTab))
    })
  }

  // ── localStorage (all guarded; storage may be unavailable or full) ──────────
  private persistBase64() {
    if (this.b64TextEl.value.length <= CF_MAX_PERSIST) this.writeLS(CF_LS_B64_TEXT, this.b64TextEl.value)
    if (this.b64B64El.value.length <= CF_MAX_PERSIST) this.writeLS(CF_LS_B64_B64, this.b64B64El.value)
  }

  private persistUrl() {
    if (this.urlTextEl.value.length <= CF_MAX_PERSIST) this.writeLS(CF_LS_URL_TEXT, this.urlTextEl.value)
    if (this.urlEncEl.value.length <= CF_MAX_PERSIST) this.writeLS(CF_LS_URL_ENC, this.urlEncEl.value)
  }

  private persistQuery() {
    if (this.qRawEl.value.length <= CF_MAX_PERSIST) this.writeLS(CF_LS_Q_RAW, this.qRawEl.value)
    if (this.qPairsEl.value.length <= CF_MAX_PERSIST) this.writeLS(CF_LS_Q_PAIRS, this.qPairsEl.value)
  }

  private loadSettings(): CfSettings {
    const raw = this.readLS(CF_LS_SETTINGS)
    if (!raw) return { ...CF_DEFAULTS }
    try {
      const parsed = JSON.parse(raw) as Partial<CfSettings>
      const merged = { ...CF_DEFAULTS, ...parsed }
      if (!['base64', 'url', 'query'].includes(merged.tab)) merged.tab = CF_DEFAULTS.tab
      if (!['standard', 'urlsafe'].includes(merged.b64Variant)) merged.b64Variant = CF_DEFAULTS.b64Variant
      if (![0, 64, 76].includes(merged.b64Wrap)) merged.b64Wrap = CF_DEFAULTS.b64Wrap
      if (!['component', 'uri'].includes(merged.urlMode)) merged.urlMode = CF_DEFAULTS.urlMode
      merged.urlPlusSpace = Boolean(merged.urlPlusSpace)
      return merged
    } catch {
      return { ...CF_DEFAULTS }
    }
  }

  private saveSettings() {
    this.writeLS(CF_LS_SETTINGS, JSON.stringify(this.settings))
  }

  private readLS(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  private writeLS(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* ignore quota / private-mode errors */
    }
  }
}

if (!customElements.get('codec-forge-tool')) {
  customElements.define('codec-forge-tool', CodecForgeTool)
}

export {}
