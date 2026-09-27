/**
 * Hash Smith — a hashing + UUID workbench, bundled as one tabbed tool.
 *
 * Three tabs, all client-side and zero-dependency (the hashing rides on the
 * browser's own Web Crypto API — `crypto.subtle` — so no crypto is hand-rolled):
 *   1. TEXT  — hash a piece of text with SHA-1, SHA-256, SHA-384 and SHA-512 all
 *      at once, live as you type. Read each digest as hex (lower or UPPER) or
 *      Base64, copy any one. Flip to HMAC mode to authenticate the text with a
 *      secret key (same four algorithms).
 *   2. FILE  — hash a local file (read with the File API, never uploaded) with the
 *      same four algorithms, and verify it against an expected checksum: paste
 *      the value from a download page and the matching row lights up.
 *   3. UUID  — generate v4 (random) or v7 (time-ordered) UUIDs, or the nil UUID,
 *      in bulk. Toggle UPPERCASE, hyphens and {braces}; copy them all.
 *
 * Copy-first, keyboard-friendly (Ctrl/Cmd + Enter copies the active tab's main
 * output), and non-secret inputs + settings are remembered in localStorage. All
 * module-level names are hs-/HS_-prefixed because tool component files share one
 * global script scope.
 *
 * Mounts as a WebComponent so it survives Astro's client-side View Transitions
 * (see the astro:page-load wiring in tools/[slug].astro).
 */

import { flashLabel } from '../../../lib/flash'

type HsTab = 'text' | 'file' | 'uuid'
type HsAlgo = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'
type HsEncoding = 'hex' | 'base64'
type HsMode = 'hash' | 'hmac'
type HsUuidVersion = 'v4' | 'v7' | 'nil'

interface HsSettings {
  tab: HsTab
  encoding: HsEncoding
  upper: boolean
  mode: HsMode
  uuidVersion: HsUuidVersion
  uuidCount: number
  uuidUpper: boolean
  uuidHyphens: boolean
  uuidBraces: boolean
}

const HS_ALGOS: HsAlgo[] = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']

const HS_LS_SETTINGS = 'hash-smith:settings:v1'
const HS_LS_TEXT = 'hash-smith:text:v1'
const HS_LS_KEY = 'hash-smith:hmac-key:v1'
const HS_LS_EXPECTED = 'hash-smith:expected:v1'
const HS_LS_UUIDS = 'hash-smith:uuids:v1'
const HS_MAX_PERSIST = 256 * 1024 // don't persist absurdly large inputs

const HS_DEFAULTS: HsSettings = {
  tab: 'text',
  encoding: 'hex',
  upper: false,
  mode: 'hash',
  uuidVersion: 'v4',
  uuidCount: 5,
  uuidUpper: false,
  uuidHyphens: true,
  uuidBraces: false,
}

const HS_SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog'
const HS_SAMPLE_KEY = 'secret-key'

// ── Pure formatting helpers (no DOM — unit-testable in isolation) ────────────

const HS_HEX = '0123456789abcdef'

/** Bytes → hex string, lower- or UPPER-case. */
function hsBytesToHex(bytes: Uint8Array, upper: boolean): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    out += HS_HEX[b >> 4] + HS_HEX[b & 15]
  }
  return upper ? out.toUpperCase() : out
}

const HS_B64_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Bytes → standard (padded) Base64. Own encoder so it works under Node too. */
function hsBytesToB64(bytes: Uint8Array): string {
  let out = ''
  const len = bytes.length
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < len ? bytes[i + 1] : 0
    const b2 = i + 2 < len ? bytes[i + 2] : 0
    const n = (b0 << 16) | (b1 << 8) | b2
    out += HS_B64_ALPHA[(n >> 18) & 63]
    out += HS_B64_ALPHA[(n >> 12) & 63]
    out += i + 1 < len ? HS_B64_ALPHA[(n >> 6) & 63] : '='
    out += i + 2 < len ? HS_B64_ALPHA[n & 63] : '='
  }
  return out
}

/** Format a digest per the current encoding + case setting. */
function hsFormatDigest(bytes: Uint8Array, encoding: HsEncoding, upper: boolean): string {
  return encoding === 'base64' ? hsBytesToB64(bytes) : hsBytesToHex(bytes, upper)
}

/** Normalise a pasted checksum for comparison: drop spaces/colons, lower-case.
 *  (Checksums are often printed grouped, e.g. "ab cd ef" or "ab:cd:ef".) */
function hsNormalizeChecksum(s: string): string {
  return s.replace(/[\s:]+/g, '').toLowerCase()
}

/** Human-readable byte size. */
function hsBytesLabel(n: number): string {
  if (n < 1024) return `${n} byte${n === 1 ? '' : 's'}`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// ── UUID engine (pure — unit-testable) ───────────────────────────────────────

/** Format 16 raw bytes as a UUID string, honouring the display toggles. */
function hsFormatUuid(
  bytes: Uint8Array,
  opts: { upper: boolean; hyphens: boolean; braces: boolean },
): string {
  const hex = hsBytesToHex(bytes, false)
  let s = opts.hyphens
    ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
    : hex
  if (opts.upper) s = s.toUpperCase()
  if (opts.braces) s = `{${s}}`
  return s
}

/** Build a v4 (random) UUID from 16 supplied random bytes: set the version
 *  nibble to 4 and the variant bits to 10xx. */
function hsBuildV4(rand: Uint8Array): Uint8Array {
  const b = rand.slice(0, 16)
  b[6] = (b[6] & 0x0f) | 0x40 // version 4
  b[8] = (b[8] & 0x3f) | 0x80 // variant 1 (RFC 4122)
  return b
}

/** Build a v7 (time-ordered) UUID: 48-bit big-endian Unix-ms timestamp, then
 *  the version nibble (7) + 12 random bits, then the variant bits + 62 random
 *  bits. `rand` supplies the 10 random bytes for the tail (bytes 6..15). */
function hsBuildV7(ms: number, rand: Uint8Array): Uint8Array {
  const b = new Uint8Array(16)
  const t = Math.max(0, Math.floor(ms))
  // 48-bit timestamp (JS numbers are safe well past 2^48 ms).
  b[0] = Math.floor(t / 2 ** 40) & 0xff
  b[1] = Math.floor(t / 2 ** 32) & 0xff
  b[2] = Math.floor(t / 2 ** 24) & 0xff
  b[3] = Math.floor(t / 2 ** 16) & 0xff
  b[4] = Math.floor(t / 2 ** 8) & 0xff
  b[5] = t & 0xff
  for (let i = 6; i < 16; i++) b[i] = rand[i - 6] & 0xff
  b[6] = (b[6] & 0x0f) | 0x70 // version 7
  b[8] = (b[8] & 0x3f) | 0x80 // variant 1
  return b
}

/** The nil UUID — all zero bytes. */
function hsNilUuid(): Uint8Array {
  return new Uint8Array(16)
}

/** 16 cryptographically-random bytes (browser + Node both expose getRandomValues). */
function hsRandomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

/** Generate one raw-byte UUID of the requested version. */
function hsGenerateUuidBytes(version: HsUuidVersion): Uint8Array {
  if (version === 'nil') return hsNilUuid()
  if (version === 'v7') return hsBuildV7(Date.now(), hsRandomBytes(10))
  return hsBuildV4(hsRandomBytes(16))
}

// ── Hashing (async — thin wrappers over Web Crypto) ──────────────────────────

/** SHA digest of a buffer via crypto.subtle.digest. */
async function hsDigest(algo: HsAlgo, data: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data)
  const out = await crypto.subtle.digest(algo, buf)
  return new Uint8Array(out)
}

/** HMAC of a message with a key, using the SHA variant as the hash. */
async function hsHmac(
  algo: HsAlgo,
  keyBytes: Uint8Array<ArrayBuffer>,
  msgBytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: algo }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, msgBytes)
  return new Uint8Array(sig)
}

// ── WebComponent ─────────────────────────────────────────────────────────────

class HashSmithTool extends HTMLElement {
  private settings: HsSettings = { ...HS_DEFAULTS }
  private textDigests: Partial<Record<HsAlgo, Uint8Array>> = {}
  private fileDigests: Partial<Record<HsAlgo, Uint8Array>> = {}
  private computeToken = 0
  private fileComputeToken = 0
  private debounceTimer = 0

  private root!: HTMLElement
  // text tab
  private textEl!: HTMLTextAreaElement
  private keyFieldEl!: HTMLElement
  private keyEl!: HTMLInputElement
  private textCountEl!: HTMLElement
  private textStatusEl!: HTMLElement
  // file tab
  private fileInfoEl!: HTMLElement
  private expectedEl!: HTMLInputElement
  private verifyEl!: HTMLElement
  // uuid tab
  private uuidOutEl!: HTMLTextAreaElement
  private uuidCountEl!: HTMLElement

  private onKeydown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      this.copyActiveOutput()
    }
  }

  connectedCallback() {
    this.settings = this.loadSettings()

    const rowMarkup = (tab: 'text' | 'file') =>
      HS_ALGOS.map(
        a => `
          <div data-type="hs-row" data-algo="${a}" data-tabrow="${tab}">
            <span data-type="hs-algo">${a}</span>
            <code data-type="hs-digest" data-for="${a}" aria-live="off">—</code>
            <button data-action="copy-digest" data-tabrow="${tab}" data-algo="${a}" type="button" aria-label="Copy ${a} digest">Copy</button>
          </div>`,
      ).join('')

    this.innerHTML = `
      <div data-type="tool-page" data-tool="hash-smith">
        <div data-type="tool-header">
          <h1>Hash Smith</h1>
          <p>Hash text or a file with SHA-1, SHA-256, SHA-384 and SHA-512, and generate UUIDs — all in your browser, using the built-in Web Crypto API, nothing uploaded. Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> to copy the current output.</p>
        </div>

        <div data-type="hs-tabs" role="tablist" aria-label="Hash Smith tools">
          <button data-tab-btn="text" type="button" role="tab" aria-selected="false">Text hash</button>
          <button data-tab-btn="file" type="button" role="tab" aria-selected="false">File hash</button>
          <button data-tab-btn="uuid" type="button" role="tab" aria-selected="false">UUID</button>
        </div>

        <!-- ── TEXT ───────────────────────────────────────────── -->
        <section data-tab="text" role="tabpanel" aria-label="Hash text">
          <div data-group="toolbar">
            <label data-type="hs-field">
              <span>Mode</span>
              <select data-control="mode" aria-label="Hashing mode">
                <option value="hash">Hash (digest)</option>
                <option value="hmac">HMAC (keyed)</option>
              </select>
            </label>
            <label data-type="hs-field">
              <span>Output</span>
              <select data-control="encoding" aria-label="Digest output encoding">
                <option value="hex">Hex</option>
                <option value="base64">Base64</option>
              </select>
            </label>
            <label data-type="hs-field" data-variant="check">
              <input data-control="upper" type="checkbox" />
              <span>Uppercase hex</span>
            </label>
            <span data-type="hs-sep" aria-hidden="true"></span>
            <button data-action="text-sample" type="button">Sample</button>
            <button data-action="text-clear" type="button">Clear</button>
          </div>

          <label data-type="hs-field" data-variant="key" data-key-field hidden>
            <span>HMAC key</span>
            <input data-io="key" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" aria-label="HMAC secret key" placeholder="Secret key (UTF-8 text)" />
          </label>

          <textarea data-io="text" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" aria-label="Text to hash" placeholder="Type or paste text to hash…"></textarea>

          <div data-type="hs-statusbar">
            <span data-type="hs-count" data-for="text">0 bytes</span>
            <span data-type="hs-status" data-for="text" role="status" aria-live="polite"></span>
          </div>

          <div data-type="hs-results" aria-label="Text digests">
            ${rowMarkup('text')}
          </div>

          <details data-type="hs-explainer">
            <summary>Hashing vs HMAC</summary>
            <p>A <strong>hash</strong> maps any input to a fixed-size fingerprint. The same input always gives the same digest, a tiny change gives a completely different one, and you can't run it backwards — so hashes are used to verify integrity (checksums) and to index content. <strong>SHA-256</strong> is the modern default; <strong>SHA-1</strong> is shown for legacy compatibility but is <em>broken</em> for security use. <strong>HMAC</strong> mixes a secret key into the hash, so only someone who knows the key can produce or verify the digest — that's how API requests and webhooks are signed. All of this runs on your browser's built-in <code>crypto.subtle</code>; the text is read as UTF-8 first, so accents and emoji hash consistently.</p>
          </details>
        </section>

        <!-- ── FILE ───────────────────────────────────────────── -->
        <section data-tab="file" role="tabpanel" aria-label="Hash a file" hidden>
          <div data-group="toolbar">
            <label data-type="hs-field">
              <span>Output</span>
              <select data-control="encoding" aria-label="Digest output encoding" data-mirror="encoding">
                <option value="hex">Hex</option>
                <option value="base64">Base64</option>
              </select>
            </label>
            <label data-type="hs-field" data-variant="check">
              <input data-control="upper" type="checkbox" data-mirror="upper" />
              <span>Uppercase hex</span>
            </label>
            <span data-type="hs-sep" aria-hidden="true"></span>
            <label data-type="hs-field" data-variant="file">
              <span>Choose a file</span>
              <input data-action="file" type="file" aria-label="Choose a file to hash" />
            </label>
            <button data-action="file-clear" type="button">Clear</button>
          </div>

          <p data-type="hs-file-info" role="status" aria-live="polite">Pick any file to hash it locally — the digests appear below. Nothing is uploaded.</p>

          <div data-type="hs-results" aria-label="File digests">
            ${rowMarkup('file')}
          </div>

          <div data-type="hs-verify">
            <label data-type="hs-field" data-variant="verify">
              <span>Verify against a checksum</span>
              <input data-io="expected" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" aria-label="Expected checksum" placeholder="Paste an expected SHA / hex checksum…" />
            </label>
            <span data-type="hs-verify-result" role="status" aria-live="polite"></span>
          </div>

          <details data-type="hs-explainer">
            <summary>Verifying a download</summary>
            <p>Reputable projects publish a checksum next to their downloads. Hash the file you got here, paste their published value into <strong>Verify against a checksum</strong>, and the matching algorithm's row lights up — if nothing matches, the file differs from the one they signed (corrupt download, wrong version, or tampering). The comparison ignores spaces, colons and letter case, and checks every algorithm, so you don't need to know which one they used. Files are read with your browser's File API and hashed in place; they never leave your machine.</p>
          </details>
        </section>

        <!-- ── UUID ───────────────────────────────────────────── -->
        <section data-tab="uuid" role="tabpanel" aria-label="Generate UUIDs" hidden>
          <div data-group="toolbar">
            <label data-type="hs-field">
              <span>Version</span>
              <select data-control="uuidVersion" aria-label="UUID version">
                <option value="v4">v4 (random)</option>
                <option value="v7">v7 (time-ordered)</option>
                <option value="nil">nil (all zeros)</option>
              </select>
            </label>
            <label data-type="hs-field">
              <span>How many</span>
              <input data-control="uuidCount" type="number" min="1" max="100" step="1" aria-label="Number of UUIDs to generate" />
            </label>
            <span data-type="hs-sep" aria-hidden="true"></span>
            <label data-type="hs-field" data-variant="check">
              <input data-control="uuidUpper" type="checkbox" />
              <span>UPPERCASE</span>
            </label>
            <label data-type="hs-field" data-variant="check">
              <input data-control="uuidHyphens" type="checkbox" />
              <span>Hyphens</span>
            </label>
            <label data-type="hs-field" data-variant="check">
              <input data-control="uuidBraces" type="checkbox" />
              <span>{Braces}</span>
            </label>
          </div>

          <div data-group="toolbar">
            <button data-action="uuid-generate" type="button">Generate</button>
            <button data-action="uuid-copy" type="button">Copy all</button>
            <span data-type="hs-count" data-for="uuid" role="status" aria-live="polite"></span>
          </div>

          <textarea data-io="uuid-out" spellcheck="false" autocomplete="off" readonly aria-label="Generated UUIDs" placeholder="Generated UUIDs appear here…"></textarea>

          <details data-type="hs-explainer">
            <summary>v4 vs v7 UUIDs</summary>
            <p>A <strong>v4</strong> UUID is 122 bits of randomness — the ubiquitous choice for unique IDs that never need to be guessable or ordered. A <strong>v7</strong> UUID puts a millisecond Unix timestamp in its leading bits, so freshly-minted IDs sort in creation order — a big win as a database key, because time-ordered inserts keep the index compact instead of scattering writes. Both carry a version and variant marker so their kind is self-describing. The <strong>nil</strong> UUID (all zeros) is the conventional "none/empty" placeholder. Randomness comes from your browser's cryptographically-secure generator.</p>
          </details>
        </section>
      </div>
    `

    this.root = this.querySelector('[data-type="tool-page"]') as HTMLElement
    this.textEl = this.q('[data-io="text"]')
    this.keyFieldEl = this.q('[data-key-field]')
    this.keyEl = this.q('[data-io="key"]')
    this.textCountEl = this.q('[data-type="hs-count"][data-for="text"]')
    this.textStatusEl = this.q('[data-type="hs-status"][data-for="text"]')
    this.fileInfoEl = this.q('[data-type="hs-file-info"]')
    this.expectedEl = this.q('[data-io="expected"]')
    this.verifyEl = this.q('[data-type="hs-verify-result"]')
    this.uuidOutEl = this.q('[data-io="uuid-out"]')
    this.uuidCountEl = this.q('[data-type="hs-count"][data-for="uuid"]')

    this.reflectSettings()

    // Restore persisted inputs.
    this.textEl.value = this.readLS(HS_LS_TEXT) ?? ''
    // HMAC keys are secrets: never retain them beyond this page session, and
    // remove the value written by the initial implementation.
    this.keyEl.value = ''
    this.removeLS(HS_LS_KEY)
    this.expectedEl.value = this.readLS(HS_LS_EXPECTED) ?? ''
    this.uuidOutEl.value = this.readLS(HS_LS_UUIDS) ?? ''

    // Wire inputs.
    this.textEl.addEventListener('input', () => this.onTextInput())
    this.keyEl.addEventListener('input', () => {
      this.persistInputs()
      this.computeText()
    })
    this.expectedEl.addEventListener('input', () => {
      this.persistInputs()
      this.renderVerify()
    })

    this.root.querySelectorAll<HTMLElement>('[data-control]').forEach(el => {
      el.addEventListener(el instanceof HTMLSelectElement ? 'change' : 'input', () => this.onSettingChange(el))
    })

    this.root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => {
      const act = btn.dataset.action as string
      if (act === 'file') return // handled via change below
      btn.addEventListener('click', () => this.onAction(act, btn))
    })
    ;(this.q('[data-action="file"]') as HTMLInputElement).addEventListener('change', e => this.onFile(e))

    this.root.querySelectorAll<HTMLButtonElement>('[data-tab-btn]').forEach(btn => {
      btn.addEventListener('click', () => this.setTab(btn.dataset.tabBtn as HsTab))
    })

    this.addEventListener('keydown', this.onKeydown)

    // Initial paint.
    this.applyModeVisibility()
    this.computeText()
    this.renderFileRows()
    this.renderVerify()
    if (!this.uuidOutEl.value.trim()) this.generateUuids()
    else this.updateUuidCount()
    this.setTab(this.settings.tab)
  }

  disconnectedCallback() {
    this.removeEventListener('keydown', this.onKeydown)
    this.fileComputeToken++
    window.clearTimeout(this.debounceTimer)
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.querySelector(sel) as T
  }

  // ── events ─────────────────────────────────────────────────────────────────
  private onTextInput() {
    this.persistInputs()
    window.clearTimeout(this.debounceTimer)
    this.debounceTimer = window.setTimeout(() => this.computeText(), 120)
  }

  private onSettingChange(el: HTMLElement) {
    const key = el.dataset.control as keyof HsSettings
    const bag = this.settings as unknown as Record<string, string | number | boolean>
    if (el instanceof HTMLInputElement && el.type === 'checkbox') bag[key] = el.checked
    else if (el instanceof HTMLInputElement && el.type === 'number') {
      let n = Math.floor(Number(el.value))
      if (!Number.isFinite(n)) n = HS_DEFAULTS.uuidCount
      n = Math.min(100, Math.max(1, n))
      bag[key] = n
      el.value = String(n)
    } else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) bag[key] = el.value
    this.saveSettings()

    // Keep the encoding/upper controls (duplicated on text + file tabs) in sync.
    if (key === 'encoding' || key === 'upper') {
      this.reflectSettings()
      this.renderTextRows()
      this.renderFileRows()
      this.renderVerify()
    } else if (key === 'mode') {
      this.applyModeVisibility()
      this.computeText()
    } else if (key === 'uuidVersion' || key === 'uuidCount') {
      this.generateUuids()
    } else if (key === 'uuidUpper' || key === 'uuidHyphens' || key === 'uuidBraces') {
      this.reformatUuids()
    }
  }

  private onAction(action: string, btn: HTMLButtonElement) {
    switch (action) {
      case 'text-sample':
        this.textEl.value = HS_SAMPLE_TEXT
        if (this.settings.mode === 'hmac' && !this.keyEl.value) this.keyEl.value = HS_SAMPLE_KEY
        this.persistInputs()
        this.computeText()
        break
      case 'text-clear':
        this.textEl.value = ''
        this.persistInputs()
        this.computeText()
        this.textEl.focus()
        break
      case 'file-clear':
        this.clearFile()
        break
      case 'uuid-generate':
        this.generateUuids()
        break
      case 'uuid-copy':
        this.copy(this.uuidOutEl.value, btn)
        break
      case 'copy-digest': {
        const algo = btn.dataset.algo as HsAlgo
        const tab = btn.dataset.tabrow as 'text' | 'file'
        const bytes = (tab === 'file' ? this.fileDigests : this.textDigests)[algo]
        this.copy(bytes ? hsFormatDigest(bytes, this.settings.encoding, this.settings.upper) : '', btn)
        break
      }
    }
  }

  // ── tab switching ────────────────────────────────────────────────────────
  private setTab(tab: HsTab) {
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

  // ── text hashing ───────────────────────────────────────────────────────────
  private applyModeVisibility() {
    this.keyFieldEl.hidden = this.settings.mode !== 'hmac'
  }

  private async computeText() {
    const token = ++this.computeToken
    const s = this.settings
    const msg = new TextEncoder().encode(this.textEl.value)
    this.textCountEl.textContent = `${hsBytesLabel(msg.length)} in`

    if (s.mode === 'hmac' && this.keyEl.value === '') {
      this.textDigests = {}
      this.textStatusEl.textContent = 'Enter a key to compute HMAC.'
      this.renderTextRows()
      return
    }

    this.textStatusEl.textContent = s.mode === 'hmac' ? 'HMAC · keyed' : 'Hash · digest'

    const keyBytes = new TextEncoder().encode(this.keyEl.value)
    const next: Partial<Record<HsAlgo, Uint8Array>> = {}
    try {
      await Promise.all(
        HS_ALGOS.map(async algo => {
          next[algo] = s.mode === 'hmac' ? await hsHmac(algo, keyBytes, msg) : await hsDigest(algo, msg)
        }),
      )
    } catch {
      if (token === this.computeToken) {
        this.textStatusEl.textContent = 'Could not compute digests in this browser.'
      }
      return
    }
    if (token !== this.computeToken) return // a newer keystroke superseded us
    this.textDigests = next
    this.renderTextRows()
  }

  private renderTextRows() {
    this.renderRows('text', this.textDigests)
  }

  // ── file hashing ─────────────────────────────────────────────────────────
  private async onFile(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const token = ++this.fileComputeToken
    input.value = '' // allow re-selecting the same file
    this.fileInfoEl.textContent = `Hashing ${file.name} (${hsBytesLabel(file.size)})…`
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const next: Partial<Record<HsAlgo, Uint8Array>> = {}
      await Promise.all(HS_ALGOS.map(async algo => { next[algo] = await hsDigest(algo, bytes) }))
      if (token !== this.fileComputeToken) return
      this.fileDigests = next
      this.fileInfoEl.textContent = `${file.name} — ${hsBytesLabel(bytes.length)}${file.type ? ` · ${file.type}` : ''}`
      this.renderFileRows()
      this.renderVerify()
    } catch {
      if (token === this.fileComputeToken) this.fileInfoEl.textContent = `Could not hash ${file.name}.`
    }
  }

  private clearFile() {
    this.fileComputeToken++
    this.fileDigests = {}
    this.fileInfoEl.textContent = 'Pick any file to hash it locally — the digests appear below. Nothing is uploaded.'
    this.renderFileRows()
    this.renderVerify()
  }

  private renderFileRows() {
    this.renderRows('file', this.fileDigests)
  }

  private renderVerify() {
    const expected = hsNormalizeChecksum(this.expectedEl.value)
    // Clear any prior row highlight.
    this.root.querySelectorAll('[data-tabrow="file"][data-type="hs-row"]').forEach(r => r.removeAttribute('data-match'))
    if (expected === '') {
      this.verifyEl.textContent = ''
      this.verifyEl.removeAttribute('data-state')
      return
    }
    let matched: HsAlgo | null = null
    for (const algo of HS_ALGOS) {
      const bytes = this.fileDigests[algo]
      if (bytes && hsBytesToHex(bytes, false) === expected) {
        matched = algo
        break
      }
    }
    if (matched) {
      this.verifyEl.textContent = `✓ Matches ${matched}`
      this.verifyEl.setAttribute('data-state', 'ok')
      const row = this.root.querySelector(`[data-tabrow="file"][data-algo="${matched}"]`)
      row?.setAttribute('data-match', 'true')
    } else if (Object.keys(this.fileDigests).length === 0) {
      this.verifyEl.textContent = 'Hash a file to compare.'
      this.verifyEl.removeAttribute('data-state')
    } else {
      this.verifyEl.textContent = '✗ No algorithm matches this checksum'
      this.verifyEl.setAttribute('data-state', 'bad')
    }
  }

  // ── shared row rendering ───────────────────────────────────────────────────
  private renderRows(tab: 'text' | 'file', digests: Partial<Record<HsAlgo, Uint8Array>>) {
    const s = this.settings
    for (const algo of HS_ALGOS) {
      const cell = this.root.querySelector<HTMLElement>(`[data-tabrow="${tab}"][data-type="hs-row"][data-algo="${algo}"] [data-type="hs-digest"]`)
      if (!cell) continue
      const bytes = digests[algo]
      cell.textContent = bytes ? hsFormatDigest(bytes, s.encoding, s.upper) : '—'
    }
  }

  // ── UUIDs ──────────────────────────────────────────────────────────────────
  private generateUuids() {
    const n = Math.min(100, Math.max(1, this.settings.uuidCount))
    const lines: string[] = []
    for (let i = 0; i < n; i++) {
      lines.push(hsFormatUuid(hsGenerateUuidBytes(this.settings.uuidVersion), {
        upper: this.settings.uuidUpper,
        hyphens: this.settings.uuidHyphens,
        braces: this.settings.uuidBraces,
      }))
    }
    this.uuidOutEl.value = lines.join('\n')
    this.persistInputs()
    this.updateUuidCount()
  }

  /** Re-apply the display toggles to the CURRENT UUIDs without minting new ones.
   *  Parses each line back to bytes so case/hyphen/brace changes are lossless. */
  private reformatUuids() {
    const opts = {
      upper: this.settings.uuidUpper,
      hyphens: this.settings.uuidHyphens,
      braces: this.settings.uuidBraces,
    }
    const lines = this.uuidOutEl.value
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l !== '')
      .map(l => {
        const hex = l.replace(/[^0-9a-fA-F]/g, '')
        if (hex.length !== 32) return l
        const bytes = new Uint8Array(16)
        for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
        return hsFormatUuid(bytes, opts)
      })
    this.uuidOutEl.value = lines.join('\n')
    this.persistInputs()
  }

  private updateUuidCount() {
    const n = this.uuidOutEl.value.split(/\r?\n/).filter(l => l.trim() !== '').length
    this.uuidCountEl.textContent = `${n} UUID${n === 1 ? '' : 's'}`
  }

  // ── clipboard ────────────────────────────────────────────────────────────
  private copyActiveOutput() {
    if (this.settings.tab === 'uuid') {
      this.copy(this.uuidOutEl.value)
      return
    }
    // Text / file: copy SHA-256 (the sensible default) in the current encoding.
    const digests = this.settings.tab === 'file' ? this.fileDigests : this.textDigests
    const bytes = digests['SHA-256']
    if (bytes) this.copy(hsFormatDigest(bytes, this.settings.encoding, this.settings.upper))
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
    flashLabel(btn, label, 1400)
  }

  // ── UI plumbing ────────────────────────────────────────────────────────────
  private reflectSettings() {
    this.root.querySelectorAll<HTMLElement>('[data-control]').forEach(el => {
      const key = el.dataset.control as keyof HsSettings
      const v = this.settings[key]
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(v)
      else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = String(v)
    })
  }

  // ── localStorage (all guarded; storage may be unavailable or full) ──────────
  private persistInputs() {
    if (this.textEl.value.length <= HS_MAX_PERSIST) this.writeLS(HS_LS_TEXT, this.textEl.value)
    else this.removeLS(HS_LS_TEXT)
    this.writeLS(HS_LS_EXPECTED, this.expectedEl.value)
    if (this.uuidOutEl.value.length <= HS_MAX_PERSIST) this.writeLS(HS_LS_UUIDS, this.uuidOutEl.value)
    else this.removeLS(HS_LS_UUIDS)
  }

  private loadSettings(): HsSettings {
    const raw = this.readLS(HS_LS_SETTINGS)
    if (!raw) return { ...HS_DEFAULTS }
    try {
      const parsed = JSON.parse(raw) as Partial<HsSettings>
      const merged = { ...HS_DEFAULTS, ...parsed }
      if (!['text', 'file', 'uuid'].includes(merged.tab)) merged.tab = HS_DEFAULTS.tab
      if (!['hex', 'base64'].includes(merged.encoding)) merged.encoding = HS_DEFAULTS.encoding
      if (!['hash', 'hmac'].includes(merged.mode)) merged.mode = HS_DEFAULTS.mode
      if (!['v4', 'v7', 'nil'].includes(merged.uuidVersion)) merged.uuidVersion = HS_DEFAULTS.uuidVersion
      merged.upper = Boolean(merged.upper)
      merged.uuidUpper = Boolean(merged.uuidUpper)
      merged.uuidHyphens = Boolean(merged.uuidHyphens)
      merged.uuidBraces = Boolean(merged.uuidBraces)
      let n = Math.floor(Number(merged.uuidCount))
      if (!Number.isFinite(n)) n = HS_DEFAULTS.uuidCount
      merged.uuidCount = Math.min(100, Math.max(1, n))
      return merged
    } catch {
      return { ...HS_DEFAULTS }
    }
  }

  private saveSettings() {
    this.writeLS(HS_LS_SETTINGS, JSON.stringify(this.settings))
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

  private removeLS(key: string) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore unavailable storage */
    }
  }
}

if (!customElements.get('hash-smith-tool')) {
  customElements.define('hash-smith-tool', HashSmithTool)
}

export {}
