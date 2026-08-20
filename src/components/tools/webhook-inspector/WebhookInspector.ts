/**
 * Webhook Inspector — a live webhook / HTTP request tester, built to
 * webhook.cool parity.
 *
 * Unlike every other tool on the site, this one uses the server the app already
 * runs: it gives you an unguessable capture URL (`/api/hook/:bin`), real
 * software sends requests to it, and this page polls them back and shows the
 * method, query, headers and body of each — the "owns a URL other software
 * talks to" bar from AGENTS.md. The bin id is generated once and kept in
 * localStorage, so the URL is a stable permalink you can reuse and share; the
 * capture URL also honours ?status=/?delay=/?echo= for exercising a client's
 * retry/latency handling.
 *
 * Mounts as a WebComponent so it survives Astro's client-side View Transitions
 * (see the astro:page-load wiring in tools/[slug].astro). All module-level names
 * are wi-/WI_-prefixed because tool component files share one global script scope.
 */

// Escapes every character that can end an attribute value or open a tag, `'`
// included (attribute quoting is a call-site property). Shared with the server
// so the escaping rule has exactly one home.
import { escapeHtml as wiEsc } from '../../../lib/escape'
import { flashLabel } from '../../../lib/flash'
import {
  wiDecodeSecret,
  wiDetectScheme,
  wiDiscoverSignature,
  wiVerifyScheme,
  type WiSecretEncoding,
  type WiVerification,
} from './signature'

interface WiHeader { name: string; value: string }

interface WiRequest {
  id: string
  method: string
  query: string
  headers: WiHeader[]
  contentType: string | null
  source: string | null
  bodyText: string
  bodyTruncated: boolean
  size: number
  receivedAt: number
}

const WI_LS_BIN = 'webhook-inspector:bin:v1'
const WI_LS_PAUSED = 'webhook-inspector:paused:v1'
// The encoding CHOICE is remembered; the secret itself deliberately is not — see
// the note on `secret` below.
const WI_LS_SECRET_ENC = 'webhook-inspector:secret-encoding:v1'
const WI_POLL_MS = 2000
const WI_VERIFY_DEBOUNCE_MS = 250
// Must stay in step with BIN_ID_RE in lib/webhook-store.ts, or a stored id that
// passes here gets a 404 from the server.
const WI_BIN_RE = /^[A-Za-z0-9_-]{24,64}$/

function wiNewBinId(): string {
  const uuid = (crypto as any).randomUUID?.() as string | undefined
  if (uuid) return uuid.replace(/-/g, '')
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

function wiRelTime(ms: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - ms)
  const s = Math.floor(diff / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function wiFmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Signed age as a phrase: negative means the sender's clock is ahead of ours. */
function wiFmtAge(sec: number): string {
  const abs = Math.abs(sec)
  const size = abs < 120 ? `${abs}s` : abs < 7200 ? `${Math.round(abs / 60)}m` : `${Math.round(abs / 3600)}h`
  return sec < 0 ? `${size} in the future` : `${size} old`
}

/**
 * What the signature panel says about one captured request.
 *
 * `state` is the badge; `detail` is pre-escaped HTML for the expanded row. The
 * states are kept apart rather than folded into pass/fail because most of them
 * are neither: "nothing signed this", "I cannot check it", and "the secret you
 * pasted is malformed" are all different problems with different fixes, and a
 * red cross for all three sends the reader hunting for the wrong one.
 */
type WiVerdictState =
  | 'idle'          // nothing to say — no signature header and no secret pasted
  | 'needs-secret'  // a signature is present but there is nothing to check it with
  | 'unverifiable'  // the signed bytes are not all here (truncated body)
  | 'match'
  | 'stale'         // signature is correct, but outside the sender's replay window
  | 'mismatch'
  | 'found'         // discovery matched an unrecognised header
  | 'unmatched'     // discovery found nothing
  | 'error'         // the secret itself could not be decoded

interface WiVerdict {
  state: WiVerdictState
  badge: string
  detail: string
}

class WebhookInspectorTool extends HTMLElement {
  private root!: HTMLElement
  private binId = ''
  private paused = false
  private timer: number | null = null
  private polling = false
  /** A poll asked for while one was in flight. Coalesced rather than dropped —
   *  see poll(). `pollAgainManual` carries the "show a status line" intent. */
  private pollAgain = false
  private pollAgainManual = false
  private requests: WiRequest[] = []
  /** A request opened via a #share= link — rendered read-only, never mixed into
   *  the visitor's own feed or bin. */
  private sharedReq: WiRequest | null = null
  /** null = never rendered — the first render must always run. */
  private lastSig: string | null = null
  private reqEtag = ''
  private expanded = new Set<string>()

  /** In memory for the life of the tab and nowhere else. The bin id is written
   *  to localStorage because it is a URL meant to be reused; a signing secret is
   *  the opposite kind of value — persisting it would leave a live production
   *  credential in a shared browser profile long after the debugging session
   *  that needed it. Nothing sends it anywhere either: every HMAC below runs in
   *  Web Crypto in this tab. */
  private secret = ''
  private secretEnc: WiSecretEncoding = 'utf-8'
  private verdicts = new Map<string, WiVerdict>()
  /** Bumped on every verification run so a batch started under the previous
   *  secret cannot paint its verdicts over the current one's. */
  private verifyToken = 0
  private verifyTimer: number | null = null

  private urlInput!: HTMLInputElement
  private statusEl!: HTMLElement
  private listEl!: HTMLElement
  private emptyEl!: HTMLElement
  private countEl!: HTMLElement
  private pollBtn!: HTMLButtonElement
  private secretInput!: HTMLInputElement
  private secretEncSel!: HTMLSelectElement
  private secretNoteEl!: HTMLElement
  private sharedCard!: HTMLElement
  private sharedEl!: HTMLElement

  private onKeydown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // This listens on document (see connectedCallback), so it sees keys aimed at
    // the whole page — anything focusable owns its own: typing must never be
    // hijacked, and Space/Enter activate a button, a link or a <summary>.
    const t = e.target as HTMLElement | null
    if (t?.closest('input, textarea, select, button, a, summary, [contenteditable]')) return
    const k = e.key.toLowerCase()
    if (k === 'c') { e.preventDefault(); this.clear() }
    else if (k === 'r') { e.preventDefault(); this.poll(true) }
    else if (k === 'n') { e.preventDefault(); this.newUrl() }
    // Pause is P, not Space: with nothing focused Space is the browser's
    // page-scroll key, and this page has a long SEO section under the app, so
    // taking it meant a reader trying to scroll silently paused the feed instead.
    else if (k === 'p') { e.preventDefault(); this.togglePoll() }
  }

  private onVisibility = () => { if (!document.hidden && !this.paused) this.poll() }

  connectedCallback() {
    this.binId = this.loadBinId()
    this.paused = this.readLS(WI_LS_PAUSED) === '1'
    this.secretEnc = this.loadSecretEnc()

    this.innerHTML = `
      <div data-type="tool-page" data-tool="webhook-inspector">
        <div data-type="tool-header">
          <h1>Webhook Inspector</h1>
          <p>Get a unique URL, point any webhook or HTTP client at it, and watch the requests arrive here in real time — method, query string, headers and body, all captured server-side. Your URL is saved on this device so you can reuse and share it. Add <code>?status=500</code>, <code>?delay=2000</code>, or <code>?echo=1</code> to the URL to test how your client handles errors, slow responses, or round-tripped bodies. Paste your signing secret and each request is HMAC'd against the raw body it actually sent, so you can see whether the signature really holds. Any captured request can be sent to a colleague as a share link, and the whole log downloads as JSON. Press <kbd>R</kbd> to refresh, <kbd>C</kbd> to clear, <kbd>N</kbd> for a new URL, <kbd>P</kbd> to pause.</p>
        </div>

        <section data-type="wi-card" data-card="shared" aria-labelledby="wi-shared-h" hidden>
          <div data-group="wi-reqhead">
            <h2 id="wi-shared-h">Shared request</h2>
            <div data-group="toolbar">
              <button data-action="dismiss-shared" type="button">Dismiss</button>
            </div>
          </div>
          <div data-for="shared"></div>
        </section>

        <section data-type="wi-card" data-card="url" aria-labelledby="wi-url-h">
          <h2 id="wi-url-h">Your webhook URL</h2>
          <div data-group="wi-urlrow">
            <input data-input="url" type="text" readonly spellcheck="false" aria-label="Your webhook capture URL" />
            <button data-action="copy-url" type="button">Copy</button>
          </div>
          <div data-group="toolbar">
            <button data-action="send-test" type="button">Send test request</button>
            <button data-action="copy-curl" type="button">Copy curl</button>
            <button data-action="new-url" type="button">New URL (N)</button>
          </div>
          <p data-type="wi-hint">Requests to this URL are captured for a few hours of inactivity, then dropped. Bodies over 64&nbsp;KB are truncated. Nothing here is a public listing — only someone with the URL can see its requests.</p>
          <span data-type="wi-status" role="status" aria-live="polite"></span>
        </section>

        <section data-type="wi-card" data-card="verify" aria-labelledby="wi-verify-h">
          <h2 id="wi-verify-h">Check the signature</h2>
          <p data-type="wi-hint">Paste the signing secret and every captured request gets checked against it. Stripe, GitHub, Slack and Shopify are recognised by their headers and verified with the payload each one actually signs. For any other sender, the raw body is HMAC'd with SHA-256, SHA-1 and SHA-512 and matched against every header, which answers "which header is the signature, and how is it encoded?".</p>
          <div data-group="wi-secretrow">
            <input data-input="secret" type="password" autocomplete="off" spellcheck="false" placeholder="whsec_… / signing secret" aria-label="Webhook signing secret" />
            <select data-input="secret-encoding" aria-label="How the secret is encoded">
              <option value="utf-8">text</option>
              <option value="hex">hex</option>
              <option value="base64">base64</option>
            </select>
            <button data-action="forget-secret" type="button">Forget</button>
          </div>
          <p data-type="wi-secretnote" role="status" aria-live="polite"></p>
          <p data-type="wi-hint">The secret stays in this tab: it is never saved to this browser and never sent to the server — the HMAC is computed here with Web Crypto. Closing the tab forgets it.</p>
        </section>

        <section data-type="wi-card" data-card="requests" aria-labelledby="wi-req-h">
          <div data-group="wi-reqhead">
            <h2 id="wi-req-h">Captured requests <span data-for="count"></span></h2>
            <div data-group="toolbar">
              <button data-action="toggle-poll" type="button"></button>
              <button data-action="refresh" type="button">Refresh (R)</button>
              <button data-action="download-json" type="button">Download JSON</button>
              <button data-action="clear" type="button">Clear (C)</button>
            </div>
          </div>
          <ol data-for="list" data-type="wi-list"></ol>
          <p data-for="empty" data-type="wi-empty">Waiting for the first request… send one with the button above, or point a real webhook at your URL.</p>
        </section>

        <details data-type="wi-explainer">
          <summary>How it works &amp; when to use it</summary>
          <p>A <strong>webhook</strong> is an HTTP request one service sends to a URL you control when something happens — a payment succeeds, a repo gets a push, a form is submitted. To build against one you first need to <em>see</em> what it actually sends. Paste the URL above into the service (Stripe, GitHub, Slack, Shopify, Zapier, a cron job, your own code) and every request it makes shows up here with its full method, headers and body.</p>
          <p>The capture URL also works as a controllable HTTP target for <strong>debugging clients</strong>: <code>?status=429</code> makes it return that status so you can test retry logic, <code>?delay=2000</code> stalls the response by up to two seconds to simulate a slow upstream, and <code>?echo=1</code> sends your request body straight back.</p>
          <p><strong>Signatures.</strong> A webhook is a public URL, so the signature header is the only thing separating a real delivery from anyone who guessed the URL. The near-universal bug when implementing that check is to parse the JSON and HMAC the re-serialised object: the sender signed the <em>bytes it sent</em>, and re-serialising changes key order, spacing and unicode escapes, so the digest never matches. Paste your secret above and this page HMACs the captured raw body for you, so you can see the expected digest next to the one that arrived.</p>
          <p>Two things it keeps separate on purpose. <strong>A valid signature and a fresh one are different answers</strong> — Stripe and Slack both fold a timestamp into the signed payload and reject deliveries outside a five-minute window, so a correctly signed request that arrived twenty minutes ago is a stale delivery, not a forgery. And <strong>the algorithm never comes from the message</strong>: the hash is chosen by which header the sender used, never by the <code>sha256=</code> label inside its value, because a verifier that reads its algorithm out of the thing it is verifying lets the sender pick how it gets checked. When the label disagrees, this page says so instead of obeying it.</p>
          <p>One thing this page does that your server must not copy: it compares digests with <code>===</code>. That is fine here — the secret is your own and the comparison runs in your own tab — but a server comparing an attacker-supplied digest has to use a constant-time compare, or the response time leaks the correct signature one byte at a time.</p>
          <p><strong>Sharing and exporting.</strong> Every captured request has a <em>Copy share link</em> button; the link opens this page and shows that one request, read-only, to whoever you send it to. The request's address travels in the URL fragment, which browsers never transmit, so it stays out of server logs and Referer headers along the way. One caveat, stated because it is the auth model: the link contains your capture URL's id, so anyone holding it can also read the other requests captured there — share with a colleague, not publicly, and press <kbd>N</kbd> for a fresh URL when the debugging session ends. <em>Download JSON</em> saves everything captured so far as one file, for diffing two runs or attaching to a bug report.</p>
          <p>Requests are stored on the server only long enough to inspect them and are visible only to whoever holds the unguessable URL; there is no account and no public directory. Generate a fresh URL any time with <kbd>N</kbd>.</p>
        </details>
      </div>
    `

    this.root = this.querySelector('[data-type="tool-page"]') as HTMLElement
    this.urlInput = this.q('[data-input="url"]')
    this.statusEl = this.q('[data-type="wi-status"]')
    this.listEl = this.q('[data-for="list"]')
    this.emptyEl = this.q('[data-for="empty"]')
    this.countEl = this.q('[data-for="count"]')
    this.pollBtn = this.q('[data-action="toggle-poll"]')
    this.secretInput = this.q('[data-input="secret"]')
    this.secretEncSel = this.q('[data-input="secret-encoding"]')
    this.secretNoteEl = this.q('[data-type="wi-secretnote"]')
    this.sharedCard = this.q('[data-card="shared"]')
    this.sharedEl = this.q('[data-for="shared"]')

    this.reflectUrl()
    this.reflectPollBtn()
    this.secretEncSel.value = this.secretEnc
    this.secretInput.addEventListener('input', () => {
      this.secret = this.secretInput.value
      this.scheduleVerify()
    })
    this.secretEncSel.addEventListener('change', () => {
      this.secretEnc = this.secretEncSel.value as WiSecretEncoding
      this.writeLS(WI_LS_SECRET_ENC, this.secretEnc)
      this.scheduleVerify()
    })

    this.root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn =>
      btn.addEventListener('click', () => this.onAction(btn.dataset.action as string, btn)))
    // Per-row "Copy body" buttons are re-rendered on every poll — delegate one
    // listener on the list instead of re-binding each render.
    this.listEl.addEventListener('click', e => {
      const t = e.target as HTMLElement
      const b = t.closest('[data-copy-body]') as HTMLButtonElement | null
      if (b) {
        const req = this.requests.find(r => r.id === b.dataset.copyBody)
        if (req) this.copyText(this.formatBody(req), b)
        return
      }
      const l = t.closest('[data-copy-link]') as HTMLButtonElement | null
      if (l && l.dataset.copyLink) {
        void this.copyShareLink(l.dataset.copyLink, l)
      }
    })
    // The shared card renders through the same renderDetail(), so its Copy-body
    // button needs its own delegate — the one above only searches this.requests.
    this.sharedEl.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('[data-copy-body]') as HTMLButtonElement | null
      if (b && this.sharedReq && this.sharedReq.id === b.dataset.copyBody) {
        this.copyText(this.formatBody(this.sharedReq), b)
      }
    })
    // On document, not the element: the custom element is never focused in the
    // tool's default watch-the-feed state, so a listener on it would leave the
    // advertised R/C/N/P shortcuts dead until the user first clicked inside.
    // onKeydown is what keeps that from hijacking keys meant for other controls.
    document.addEventListener('keydown', this.onKeydown)
    document.addEventListener('visibilitychange', this.onVisibility)

    this.render()
    this.startPolling()
    this.poll()
    void this.loadShared()
  }

  disconnectedCallback() {
    this.stopPolling()
    if (this.verifyTimer !== null) { window.clearTimeout(this.verifyTimer); this.verifyTimer = null }
    // Navigating away is the end of the debugging session as far as the secret
    // is concerned. Dropping it here means a bfcache restore or a re-mount on
    // in-site navigation starts empty rather than resurrecting a credential the
    // reader has visibly stopped using.
    this.secret = ''
    this.verdicts.clear()
    this.verifyToken++
    document.removeEventListener('keydown', this.onKeydown)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.querySelector(sel) as T
  }

  private captureUrl(): string {
    return `${location.origin}/api/hook/${this.binId}`
  }

  private reflectUrl() {
    this.urlInput.value = this.captureUrl()
  }

  private reflectPollBtn() {
    this.pollBtn.textContent = this.paused ? 'Resume (P)' : 'Pause (P)'
    this.root.setAttribute('data-paused', this.paused ? 'true' : 'false')
  }

  // ── polling ────────────────────────────────────────────────────────────────
  private startPolling() {
    this.stopPolling()
    this.timer = window.setInterval(() => {
      if (document.hidden) return
      if (this.paused) this.updateTimes()
      else this.poll()
    }, WI_POLL_MS)
  }

  private stopPolling() {
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null }
  }

  private async poll(manual = false) {
    // Coalesce rather than drop. A poll requested while one is in flight — the
    // R shortcut, the Refresh button, the follow-up after "Send test request" —
    // used to hit this guard and vanish, so the request it was fetching did not
    // appear until the next 2s tick, or never at all while the feed is paused.
    if (this.polling) {
      this.pollAgain = true
      this.pollAgainManual ||= manual
      return
    }
    this.polling = true
    // Bind the bin for the whole round trip: N and Clear can replace this.binId
    // while the fetch is in flight, and applying bin A's response afterwards
    // would render A's captured Authorization headers and signing secrets under
    // the freshly minted URL B — and send A's ETag as if-none-match against B.
    const bin = this.binId
    try {
      const headers: Record<string, string> = { accept: 'application/json' }
      // Conditional poll: the server answers an unchanged bin with a bodyless
      // 304 instead of reserializing every captured body every 2 seconds.
      if (this.reqEtag) headers['if-none-match'] = this.reqEtag
      const res = await fetch(`/api/hook/${bin}/requests`, { headers })
      if (bin !== this.binId) return
      if (res.status === 304) {
        this.updateTimes()
        if (manual) this.setStatus(`Refreshed — ${this.requests.length} request${this.requests.length === 1 ? '' : 's'}.`)
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json() as { requests?: WiRequest[] }
      if (bin !== this.binId) return
      this.reqEtag = res.headers.get('etag') ?? ''
      this.requests = Array.isArray(data.requests) ? data.requests : []
      this.render()
      if (manual) this.setStatus(`Refreshed — ${this.requests.length} request${this.requests.length === 1 ? '' : 's'}.`)
    } catch {
      this.setStatus('Could not reach the server. Retrying…')
    } finally {
      this.polling = false
      if (this.pollAgain) {
        this.pollAgain = false
        const again = this.pollAgainManual
        this.pollAgainManual = false
        void this.poll(again)
      }
    }
  }

  // ── render ───────────────────────────────────────────────────────────────
  private render() {
    const now = Date.now()
    // Ids only — an unchanged list must not be torn down and rebuilt (that reset
    // scroll/selection and re-pretty-printed every body); the relative "ago"
    // labels are refreshed in place by updateTimes() instead.
    const sig = this.requests.map(r => r.id).join(',')
    if (sig === this.lastSig) {
      this.updateTimes()
      return
    }

    this.countEl.textContent = this.requests.length ? `(${this.requests.length})` : ''
    this.emptyEl.hidden = this.requests.length > 0

    // Drop per-request state for requests that no longer exist. Verdicts go too:
    // the bin evicts oldest-first, so leaving them would grow a map of dead ids
    // for as long as the tab stays open.
    const live = new Set(this.requests.map(r => r.id))
    for (const id of [...this.expanded]) if (!live.has(id)) this.expanded.delete(id)
    for (const id of [...this.verdicts.keys()]) if (!live.has(id)) this.verdicts.delete(id)

    this.listEl.innerHTML = this.requests.map(r => this.renderRow(r, now)).join('')

    this.listEl.querySelectorAll<HTMLDetailsElement>('details[data-req]').forEach(d => {
      d.addEventListener('toggle', () => {
        const id = d.dataset.req as string
        if (d.open) this.expanded.add(id); else this.expanded.delete(id)
      })
    })

    // Last, not first: the signature records what the DOM now shows. Committing
    // it up front meant a throw anywhere above (a malformed row in the feed —
    // poll() only checks Array.isArray, never the items) left the list stale
    // while every later poll matched the signature and returned early, wedging
    // the tool on old rows plus a bogus "could not reach the server" until a
    // full reload. The signature used to carry a 5s time bucket, which papered
    // over this by expiring; ids alone do not.
    this.lastSig = sig
    void this.runVerification()
  }

  // ── signature verification ─────────────────────────────────────────────────
  private scheduleVerify() {
    if (this.verifyTimer !== null) window.clearTimeout(this.verifyTimer)
    this.verifyTimer = window.setTimeout(() => {
      this.verifyTimer = null
      void this.runVerification()
    }, WI_VERIFY_DEBOUNCE_MS)
  }

  private async runVerification() {
    const token = ++this.verifyToken
    const secret = this.secret

    let secretBytes: Uint8Array | null = null
    let secretError = ''
    if (secret) {
      try {
        secretBytes = wiDecodeSecret(secret, this.secretEnc)
      } catch (err) {
        secretError = err instanceof Error ? err.message : 'The secret could not be decoded.'
      }
    }

    let verified = 0
    let considered = 0
    for (const req of this.requests) {
      const verdict = await this.verdictFor(req, secretBytes, secretError)
      // A batch started under the previous secret must not paint over this one.
      if (token !== this.verifyToken) return
      this.verdicts.set(req.id, verdict)
      this.paintVerdict(req.id)
      if (verdict.state !== 'idle') considered++
      if (verdict.state === 'match' || verdict.state === 'stale' || verdict.state === 'found') verified++
    }
    if (token !== this.verifyToken) return

    this.secretNoteEl.dataset.state = secretError ? 'error' : verified > 0 ? 'match' : ''
    this.secretNoteEl.textContent = secretError
      ? secretError
      : !secret
        ? ''
        : considered === 0
          ? 'Nothing to check yet — send a signed request to your URL.'
          : `${verified} of ${considered} captured request${considered === 1 ? '' : 's'} verified with this secret.`
  }

  private async verdictFor(
    r: WiRequest,
    secretBytes: Uint8Array | null,
    secretError: string,
  ): Promise<WiVerdict> {
    const scheme = wiDetectScheme(r.headers, r.bodyText)
    if (!scheme && !secretBytes && !secretError) return { state: 'idle', badge: '', detail: '' }

    const intro = scheme
      ? `<p><b>${wiEsc(scheme.label)}</b> · <code>${wiEsc(scheme.header)}</code> — ${wiEsc(scheme.note)}</p>`
      : ''
    const warning = scheme?.warning ? `<p data-type="wi-signote">${wiEsc(scheme.warning)}</p>` : ''
    // A body that was not valid UTF-8 came back through TextDecoder with
    // replacement characters, so re-encoding it cannot reproduce the bytes the
    // sender hashed. Say that where it matters instead of blaming the secret.
    const lossy = r.bodyText.includes('\uFFFD')
      ? '<p data-type="wi-signote">The captured body contains replacement characters, so it was not valid UTF-8 and the original bytes cannot be reconstructed. A mismatch here may be that rather than a wrong secret.</p>'
      : ''

    if (secretError) {
      return { state: 'error', badge: 'secret?', detail: `${intro}<p>${wiEsc(secretError)}</p>` }
    }

    if (!secretBytes) {
      return {
        state: 'needs-secret',
        badge: `${scheme!.label} · unchecked`,
        detail: `${intro}${warning}<p>Paste the signing secret above and this is checked automatically.</p>`,
      }
    }

    if (r.bodyTruncated) {
      return {
        state: 'unverifiable',
        badge: 'cannot verify',
        detail: `${intro}<p>The body was truncated at 64&nbsp;KB, so the bytes the sender signed are not all here. This is reported as unverifiable rather than as a mismatch on purpose: calling a delivery forged when it was merely too big to store is the worse of the two lies.</p>`,
      }
    }

    if (scheme) {
      if (scheme.provided.length === 0) {
        return {
          state: 'mismatch',
          badge: `${scheme.label} · malformed`,
          detail: `${intro}${warning}<p>The header carries no digest this scheme can check.</p>`,
        }
      }
      let result: WiVerification
      try {
        result = await wiVerifyScheme(scheme, secretBytes)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'The signature could not be computed.'
        return { state: 'error', badge: 'secret?', detail: `${intro}<p>${wiEsc(message)}</p>` }
      }

      const sent = scheme.provided.map(p => `<code>${wiEsc(p)}</code>`).join(' ')
      const windowMin = Math.round(scheme.toleranceSec / 60)
      const age = result.ageSec === null ? '' : wiFmtAge(result.ageSec)
      const freshLine = result.freshness === 'none'
        ? ''
        : result.freshness === 'fresh'
          ? `<p>Timestamp is ${wiEsc(age)} — inside ${wiEsc(scheme.label)}'s ${windowMin}-minute replay window.</p>`
          // Stated as a separate sentence from the signature verdict, because it
          // is a separate fact: the sender would reject this delivery as a replay
          // whether or not the digest is right.
          : `<p>Timestamp is ${wiEsc(age)} — outside ${wiEsc(scheme.label)}'s ${windowMin}-minute replay window, so ${wiEsc(scheme.label)} would reject it as a replay. That is independent of the signature verdict above.</p>`

      if (result.signature === 'match') {
        const stale = result.freshness === 'stale'
        return {
          state: stale ? 'stale' : 'match',
          badge: stale ? `${scheme.label} · signed, stale` : `${scheme.label} · verified`,
          detail: `${intro}${warning}<p>The signature is correct for this secret.</p>${freshLine}`,
        }
      }
      return {
        state: 'mismatch',
        badge: `${scheme.label} · mismatch`,
        detail: `${intro}${warning}<p>Sent ${sent}</p><p>Computed <code>${wiEsc(result.expected)}</code></p>${freshLine}${lossy}`,
      }
    }

    const found = await wiDiscoverSignature(r.headers, r.bodyText, secretBytes)
    if (found) {
      return {
        state: 'found',
        badge: 'signature found',
        detail: `<p>No sender this page recognises, but HMAC-${wiEsc(found.hash.replace('SHA-', 'SHA'))} of the raw body, ${wiEsc(found.encoding)}-encoded, appears in <code>${wiEsc(found.header)}</code>. That header is the signature and this secret is the right one.</p><p><code>${wiEsc(found.digest)}</code></p>`,
      }
    }
    return {
      state: 'unmatched',
      badge: 'no match',
      detail: `<p>No recognised signature header, and an HMAC of the raw body with SHA-256, SHA-1 and SHA-512 does not appear in any header. Either the secret is wrong, or this sender signs something other than the body on its own — a timestamp prefix, the request URL, or sorted form fields are the usual variants.</p>${lossy}`,
    }
  }

  private paintVerdict(id: string) {
    const verdict = this.verdicts.get(id)
    if (!verdict) return
    const state = verdict.state === 'idle' ? '' : verdict.state
    // Matched on the dataset rather than by building an attribute selector out
    // of the id: the id arrives from the network, and interpolating a network
    // value into a selector is how selector injection gets in.
    this.listEl.querySelectorAll<HTMLElement>('[data-verdict-badge]').forEach(el => {
      if (el.dataset.verdictBadge !== id) return
      el.dataset.state = state
      el.textContent = verdict.badge
      el.hidden = !state
    })
    this.listEl.querySelectorAll<HTMLElement>('[data-verdict-body]').forEach(el => {
      if (el.dataset.verdictBody !== id) return
      el.dataset.state = state
      el.innerHTML = state ? verdict.detail : ''
      el.hidden = !state
    })
  }

  private forgetSecret() {
    this.secret = ''
    this.secretInput.value = ''
    this.secretNoteEl.textContent = ''
    this.secretNoteEl.dataset.state = ''
    void this.runVerification()
    this.setStatus('Secret forgotten — it was never saved to this browser or sent anywhere.')
  }

  private renderRow(r: WiRequest, now: number): string {
    const method = wiEsc(r.method.toUpperCase())
    const open = this.expanded.has(r.id) ? ' open' : ''
    const when = new Date(r.receivedAt)
    const abs = when.toLocaleString()
    const rel = wiRelTime(r.receivedAt, now)
    const verdict = this.verdicts.get(r.id)
    const badgeState = verdict && verdict.state !== 'idle' ? verdict.state : ''
    const summary = `
      <summary data-type="wi-summary">
        <span data-type="wi-method" data-method="${method}">${method}</span>
        <span data-type="wi-when" data-ts="${r.receivedAt}" title="${wiEsc(abs)}">${wiEsc(rel)}</span>
        <span data-type="wi-meta">${wiFmtSize(r.size)}${r.bodyTruncated ? ' · truncated' : ''}${r.query ? ' · has query' : ''}</span>
        <span data-type="wi-verdict" data-verdict-badge="${wiEsc(r.id)}" data-state="${badgeState}"${badgeState ? '' : ' hidden'}>${wiEsc(badgeState ? verdict!.badge : '')}</span>
      </summary>`
    return `<li><details data-req="${wiEsc(r.id)}"${open}>${summary}${this.renderDetail(r, abs)}</details></li>`
  }

  /**
   * `withShareLink` is false for the shared-request card: the person looking at
   * it already holds the link, and minting one there would wrongly point at the
   * VIEWER's own bin (shareLink() derives from this.binId).
   */
  private renderDetail(r: WiRequest, abs: string, withShareLink = true): string {
    const parts: string[] = ['<div data-type="wi-detail">']

    parts.push(`<div data-type="wi-facts">
      <span><b>Received</b> ${wiEsc(abs)}</span>
      ${r.source ? `<span><b>Source</b> ${wiEsc(r.source)}</span>` : ''}
      <span><b>Body size</b> ${wiFmtSize(r.size)}${r.bodyTruncated ? ' (truncated to 64 KB)' : ''}</span>
    </div>`)

    // Filled by paintVerdict(), not here: verification is async and the list is
    // only rebuilt when the set of request ids changes, so a verdict arriving
    // after a poll has to patch this node rather than wait for a re-render.
    const verdict = this.verdicts.get(r.id)
    const state = verdict && verdict.state !== 'idle' ? verdict.state : ''
    parts.push(`<div data-type="wi-sig" data-verdict-body="${wiEsc(r.id)}" data-state="${state}"${state ? '' : ' hidden'}>${state ? verdict!.detail : ''}</div>`)

    if (r.query) {
      const rows = [...new URLSearchParams(r.query).entries()]
        .map(([k, v]) => `<tr><td>${wiEsc(k)}</td><td>${wiEsc(v)}</td></tr>`).join('')
      parts.push(`<h3 data-type="wi-sub">Query</h3><table data-type="wi-kv"><tbody>${rows}</tbody></table>`)
    }

    const headerRows = r.headers
      .map(h => `<tr><td>${wiEsc(h.name)}</td><td>${wiEsc(h.value)}</td></tr>`).join('')
    parts.push(`<h3 data-type="wi-sub">Headers <span data-type="wi-n">${r.headers.length}</span></h3><table data-type="wi-kv"><tbody>${headerRows}</tbody></table>`)

    parts.push(`<h3 data-type="wi-sub">Body</h3>`)
    if (!r.bodyText) {
      parts.push('<p data-type="wi-nobody">(empty body)</p>')
    } else {
      parts.push(`<pre data-type="wi-body">${wiEsc(this.formatBody(r))}</pre>`)
    }
    const btns = [
      r.bodyText ? `<button data-copy-body="${wiEsc(r.id)}" type="button">Copy body</button>` : '',
      withShareLink ? `<button data-copy-link="${wiEsc(r.id)}" type="button">Copy share link</button>` : '',
    ].join('')
    if (btns) parts.push(`<div data-group="wi-bodybtns">${btns}</div>`)
    parts.push('</div>')

    const html = parts.join('')
    return html
  }

  /** Refresh the relative "ago" labels without touching the rest of the DOM. */
  private updateTimes() {
    const now = Date.now()
    this.listEl.querySelectorAll<HTMLElement>('[data-type="wi-when"]').forEach(el => {
      const ts = Number(el.dataset.ts)
      if (ts) el.textContent = wiRelTime(ts, now)
    })
  }

  private formatBody(r: WiRequest): string {
    const ct = (r.contentType ?? '').toLowerCase()
    if (ct.includes('json')) {
      try { return JSON.stringify(JSON.parse(r.bodyText), null, 2) } catch { /* fall through */ }
    }
    if (ct.includes('application/x-www-form-urlencoded')) {
      try {
        return [...new URLSearchParams(r.bodyText).entries()].map(([k, v]) => `${k} = ${v}`).join('\n')
      } catch { /* fall through */ }
    }
    return r.bodyText
  }

  // ── actions ────────────────────────────────────────────────────────────────
  private onAction(action: string, btn: HTMLButtonElement) {
    switch (action) {
      case 'copy-url': this.copyText(this.captureUrl(), btn); break
      case 'copy-curl': this.copyText(this.curlSnippet(), btn); break
      case 'send-test': this.sendTest(btn); break
      case 'new-url': this.newUrl(); break
      case 'toggle-poll': this.togglePoll(); break
      case 'refresh': this.poll(true); break
      case 'download-json': this.downloadJson(btn); break
      case 'dismiss-shared': this.dismissShared(); break
      case 'clear': this.clear(); break
      case 'forget-secret': this.forgetSecret(); break
    }
  }

  // ── share permalinks ───────────────────────────────────────────────────────
  /** The request's address rides in the URL FRAGMENT on purpose: browsers never
   *  send a fragment to any server, so the bin id — the only thing protecting
   *  the bin — stays out of access logs and Referer headers along the way. */
  private shareLink(reqId: string): string {
    return `${location.origin}/tools/webhook-inspector#share=${this.binId}.${reqId}`
  }

  private async copyShareLink(reqId: string, btn: HTMLButtonElement) {
    await this.copyText(this.shareLink(reqId), btn)
    // The honest caveat, said at mint time: the link contains the bin id, and
    // the bin id is the whole auth model.
    this.setStatus('Share link copied. Anyone who has it can also open the rest of this URL’s captured requests — press N for a fresh URL when you’re done.')
  }

  private parseShareHash(): { bin: string; id: string } | null {
    // Mirrors the server's two validators (BIN_ID_RE / REQUEST_ID_RE) so a
    // mangled link fails here with a clear message instead of as a fetch 404.
    const m = /^#share=([A-Za-z0-9_-]{24,64})\.([A-Za-z0-9-]{8,64})$/.exec(location.hash)
    return m ? { bin: m[1], id: m[2] } : null
  }

  private async loadShared() {
    if (!location.hash.startsWith('#share=')) return
    const ref = this.parseShareHash()
    this.sharedCard.hidden = false
    if (!ref) {
      this.sharedEl.innerHTML = '<p data-type="wi-empty">This share link is malformed — part of it may have been lost in transit. Ask for it to be copied again.</p>'
      return
    }
    this.sharedEl.innerHTML = '<p data-type="wi-hint">Loading the shared request…</p>'
    try {
      const res = await fetch(`/api/hook/${ref.bin}/requests/${ref.id}`, {
        headers: { accept: 'application/json' },
      })
      if (res.status === 404) {
        this.sharedEl.innerHTML = '<p data-type="wi-empty">This shared request is gone. Captures are dropped after a few hours of inactivity, when their owner clears them, and when a busy URL overflows its 50-request cap.</p>'
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json() as { request?: WiRequest }
      if (!data.request?.id) throw new Error('malformed')
      this.sharedReq = data.request
      const abs = new Date(data.request.receivedAt).toLocaleString()
      this.sharedEl.innerHTML = `
        <p data-type="wi-hint">Someone sent you this captured <code>${wiEsc(data.request.method.toUpperCase())}</code> request. It is shown read-only — your own capture URL below is separate and untouched.</p>
        ${this.renderDetail(data.request, abs, false)}`
    } catch {
      this.sharedEl.innerHTML = '<p data-type="wi-empty">Could not load the shared request — it may have expired, or the server is unreachable. Reload to retry.</p>'
    }
  }

  private dismissShared() {
    this.sharedCard.hidden = true
    this.sharedEl.innerHTML = ''
    this.sharedReq = null
    // Drop the fragment without a reload or a new history entry, so a later
    // bookmark/refresh of this page does not resurrect the dismissed request.
    history.replaceState(null, '', location.pathname + location.search)
  }

  // ── export ─────────────────────────────────────────────────────────────────
  private downloadJson(btn: HTMLButtonElement) {
    if (this.requests.length === 0) {
      this.setStatus('Nothing to download yet — capture a request first.')
      return
    }
    const payload = {
      tool: 'webhook-inspector',
      exportedAt: new Date().toISOString(),
      captureUrl: this.captureUrl(),
      count: this.requests.length,
      requests: this.requests,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `webhook-inspector-${this.binId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoke on a tick: revoking synchronously races the click's navigation in
    // some engines and yields an empty file.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    this.flash(btn, 'Saved!')
  }

  private curlSnippet(): string {
    return `curl -X POST '${this.captureUrl()}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"hello":"world"}'`
  }

  private async sendTest(btn: HTMLButtonElement) {
    try {
      await fetch(this.captureUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sent-By': 'webhook-inspector' },
        body: JSON.stringify({ event: 'test', from: 'Webhook Inspector', at: new Date().toISOString() }),
      })
      this.flash(btn, 'Sent!')
      // No retry ladder needed: poll() coalesces, so this lands even if another
      // poll is mid-flight, and it is the only thing that shows the new row
      // while the feed is paused.
      void this.poll(true)
    } catch {
      this.flash(btn, 'Failed')
    }
  }

  private newUrl() {
    this.binId = wiNewBinId()
    this.writeLS(WI_LS_BIN, this.binId)
    this.requests = []
    this.expanded.clear()
    this.lastSig = null
    this.reqEtag = ''
    this.reflectUrl()
    this.render()
    this.setStatus('Generated a fresh URL — the old one still holds its requests for a while.')
    this.poll()
  }

  private togglePoll() {
    this.paused = !this.paused
    this.writeLS(WI_LS_PAUSED, this.paused ? '1' : '0')
    this.reflectPollBtn()
    if (!this.paused) this.poll()
    this.setStatus(this.paused ? 'Live updates paused.' : 'Live updates resumed.')
  }

  private async clear() {
    try {
      await fetch(`/api/hook/${this.binId}/requests`, { method: 'DELETE' })
    } catch { /* still clear the local view */ }
    this.requests = []
    this.expanded.clear()
    this.lastSig = null
    this.reqEtag = ''
    this.render()
    this.setStatus('Cleared captured requests.')
  }

  private async copyText(text: string, btn: HTMLButtonElement) {
    if (!text) { this.setStatus('Nothing to copy.'); return }
    try { await navigator.clipboard.writeText(text); this.flash(btn, 'Copied!') }
    catch { this.flash(btn, 'Failed') }
  }

  private flash(btn: HTMLButtonElement, label: string) {
    flashLabel(btn, label, 1200)
  }

  private setStatus(label: string) {
    this.statusEl.textContent = label
  }

  // ── persistence ────────────────────────────────────────────────────────────
  private loadBinId(): string {
    const saved = this.readLS(WI_LS_BIN)
    if (saved && WI_BIN_RE.test(saved)) return saved
    const id = wiNewBinId()
    this.writeLS(WI_LS_BIN, id)
    return id
  }

  private loadSecretEnc(): WiSecretEncoding {
    const saved = this.readLS(WI_LS_SECRET_ENC)
    return saved === 'hex' || saved === 'base64' ? saved : 'utf-8'
  }

  private readLS(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  }

  private writeLS(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* ignore quota / private-mode */ }
  }
}

if (!customElements.get('webhook-inspector-tool')) {
  customElements.define('webhook-inspector-tool', WebhookInspectorTool)
}

export {}
