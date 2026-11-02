/**
 * Webhook Inspector — a live webhook / HTTP request tester, built to
 * webhook.cool parity.
 *
 * Unlike every other tool on the site, this one uses the server the app already
 * runs: it gives you an unguessable capture URL (`/api/hook/:bin`), real
 * software sends requests to it, and this page shows the method, query, headers
 * and body of each as it arrives — the "owns a URL other software talks to" bar
 * from AGENTS.md. Arrival is a Server-Sent Events stream (`/stream`); if the
 * stream errors twice or the server is at its stream cap, the page falls back to
 * polling every 2 s. The bin id is generated once and kept in localStorage, so
 * the URL is a stable permalink you can reuse and share; the capture URL also
 * honours ?status=/?delay=/?echo= for exercising a client's retry/latency
 * handling, and the bin can carry a configured response of its own.
 *
 * Mounts as a WebComponent so it survives Astro's client-side View Transitions
 * (see the astro:page-load wiring in tools/[slug].astro). All module-level names
 * are wi-/WI_-prefixed because tool component files share one global script scope.
 */

// Escapes every character that can end an attribute value or open a tag, `'`
// included (attribute quoting is a call-site property). Shared with the server
// so the escaping rule has exactly one home.
import { escapeHtml as wiEsc } from '../../../lib/escape'
import { flashLabel, copyText } from '../../../lib/flash'
import {
  wiBodyBytes,
  wiDecodeSecret,
  wiDetectScheme,
  wiDiscoverSignature,
  wiKeyFor,
  wiVerifyScheme,
  type WiSecretEncoding,
  type WiVerification,
} from './signature'
import { wiCurlCommand } from './curl'
import { lsGet, lsSet } from '../../../lib/storage'
import { formatBytes } from '../../../lib/format'
import { downloadBlob } from '../../../lib/download'

interface WiHeader { name: string; value: string }

interface WiRequest {
  id: string
  method: string
  query: string
  headers: WiHeader[]
  contentType: string | null
  source: string | null
  bodyText: string
  bodyBase64?: string
  bodyTruncated: boolean
  size: number
  receivedAt: number
}

interface WiResponseConfig {
  status: number
  headers: WiHeader[]
  contentType: string
  body: string
}

/** What one "Resend to URL" attempt left behind, kept so a re-render can repaint it. */
interface WiResend {
  kind: 'ok' | 'error'
  html: string
}

const WI_LS_BIN = 'webhook-inspector:bin:v1'
const WI_LS_PAUSED = 'webhook-inspector:paused:v1'
// The encoding CHOICE is remembered; the secret itself deliberately is not — see
// the note on `secret` below.
const WI_LS_SECRET_ENC = 'webhook-inspector:secret-encoding:v1'
const WI_POLL_MS = 2000
// The stream "errors twice" before the page gives up on it and polls instead.
const WI_STREAM_MAX_ERRORS = 2
// Mirrors WEBHOOK_MAX_REQUESTS_PER_BIN (lib/webhook-store.ts): the server trims to 50.
const WI_MAX_REQUESTS = 50
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

/** Signed age as a phrase: negative means the sender's clock is ahead of ours. */
function wiFmtAge(sec: number): string {
  const abs = Math.abs(sec)
  const size = abs < 120 ? `${abs}s` : abs < 7200 ? `${Math.round(abs / 60)}m` : `${Math.round(abs / 3600)}h`
  return sec < 0 ? `${size} in the future` : `${size} old`
}

/** Enough of a shape check that a malformed stream event cannot reach the renderer. */
function wiIsRequest(v: unknown): v is WiRequest {
  const r = v as WiRequest | null
  return !!r && typeof r === 'object'
    && typeof r.id === 'string' && typeof r.method === 'string' && typeof r.query === 'string'
    && Array.isArray(r.headers) && typeof r.bodyText === 'string'
    && typeof r.size === 'number' && typeof r.receivedAt === 'number'
}

/**
 * The poll toggle's label, in one place because it is written twice: once into
 * the initial markup and once on every state flip. The markup copy is not
 * decoration — the button shipped EMPTY and was named only by the first
 * `reflectPollBtn()` call, so anything that read the DOM before that ran (a
 * screen reader announcing the toolbar, a test, a mount that threw earlier in
 * the same tick) met a control with no accessible name at all.
 */
function wiPollLabel(paused: boolean): string {
  return paused ? 'Resume (P)' : 'Pause (P)'
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
  /** The live stream, when one is open. */
  private es: EventSource | null = null
  private esErrors = 0
  /** Set when the stream failed; the poll runs until the tab is shown again. */
  private streamBroken = false
  /** Requests that arrived while the tab was hidden, shown in the title. */
  private unread = 0
  private baseTitle = ''
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

  /** The address typed under each request's "Resend to URL", kept across re-renders. */
  private resendUrls = new Map<string, string>()
  private resendResults = new Map<string, WiResend>()
  /** The bin a shared request belongs to, so its curl command points somewhere real. */
  private sharedBin = ''

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
  private liveNoteEl!: HTMLElement
  private respStatusInput!: HTMLInputElement
  private respTypeSel!: HTMLSelectElement
  private respHeadersInput!: HTMLTextAreaElement
  private respBodyInput!: HTMLTextAreaElement
  private respMsgEl!: HTMLElement
  private respErrEl!: HTMLElement
  private respStateEl!: HTMLElement

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

  private onVisibility = () => {
    if (document.hidden) return
    this.clearUnread()
    if (this.paused) return
    // A tab shown again gets one fresh try at the stream if it had given up, or
    // if it was closed at its age limit while hidden, then catches up once.
    if (!this.es) {
      this.streamBroken = false
      this.esErrors = 0
      this.openStream()
    }
    void this.poll()
  }

  /**
   * A share link opened in a tab that is ALREADY on this page is a same-document
   * fragment navigation: no reload, no re-mount, so `connectedCallback` never
   * runs again. Without this the card stayed hidden and empty and the feature
   * looked broken — and that tab is the likely one, since the person you send a
   * capture to is usually the person already debugging it with you. Dismiss
   * strips the fragment with replaceState, so re-opening the same link is
   * hash-only too and was inert for the same reason.
   */
  private onHashChange = () => { void this.loadShared() }

  connectedCallback() {
    this.binId = this.loadBinId()
    this.paused = lsGet(WI_LS_PAUSED) === '1'
    this.secretEnc = this.loadSecretEnc()

    this.innerHTML = `
      <div data-type="tool-page" data-tool="webhook-inspector">
        <div data-type="tool-header">
          <h1>Webhook Inspector</h1>
          <p>Get a unique URL, point any webhook or HTTP client at it, and watch the requests arrive here the moment they are sent — method, query string, headers and body, all captured server-side. Your URL is saved on this device and keeps its requests across a site update, so you can reuse and share it. Add <code>?status=500</code>, <code>?delay=2000</code>, or <code>?echo=1</code> to the URL to test how your client handles errors, slow responses, or round-tripped bodies, or set a full response (status, headers and body) for the whole URL below. Paste your signing secret and each request is checked against the raw bytes it actually sent, so you can see whether the signature really holds. Any captured request can be copied as a curl command, sent again to another address, or shared as a link, and the whole log downloads as JSON or as newline-delimited JSON for scripts. Press <kbd>R</kbd> to refresh, <kbd>C</kbd> to clear, <kbd>N</kbd> for a new URL, <kbd>P</kbd> to pause.</p>
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
            <button data-action="copy-export" type="button">Copy export curl</button>
            <button data-action="new-url" type="button">New URL (N)</button>
          </div>
          <p data-type="wi-hint">Requests to this URL are kept for a few hours of inactivity, then dropped, and they stay put when the site is updated. Bodies over 64&nbsp;KB are truncated. Nothing here is a public listing — only someone with the URL can see its requests.</p>
          <span data-type="wi-status" role="status" aria-live="polite"></span>
        </section>

        <section data-type="wi-card" data-card="response" aria-labelledby="wi-resp-h">
          <h2 id="wi-resp-h">What your URL answers</h2>
          <p data-type="wi-hint">By default your URL answers every request with a small JSON message and status 200. Set a different answer here and every request to this URL gets it, which is how you test a client against a 429, a 500, a redirect or a particular body. The <code>?status</code>, <code>?delay</code> and <code>?echo</code> options on the URL still win for a single request. The answer is kept with the URL for the same few hours, and it can be a status from 200 to 599, up to eight headers, and a body of up to 8&nbsp;KB. A redirect needs a <code>Location</code> header with a full public address.</p>
          <div data-group="wi-respform">
            <label for="wi-resp-status">Status code</label>
            <input id="wi-resp-status" data-input="resp-status" type="number" min="200" max="599" step="1" value="200" inputmode="numeric" />
            <label for="wi-resp-type">Content type</label>
            <select id="wi-resp-type" data-input="resp-type">
              <option value="application/json">application/json</option>
              <option value="text/plain; charset=utf-8">text/plain</option>
              <option value="text/csv">text/csv</option>
              <option value="application/xml">application/xml</option>
              <option value="text/xml">text/xml</option>
              <option value="application/problem+json">application/problem+json</option>
              <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
              <option value="application/octet-stream">application/octet-stream</option>
            </select>
            <label for="wi-resp-headers">Headers, one per line as Name: value</label>
            <textarea id="wi-resp-headers" data-input="resp-headers" rows="3" spellcheck="false" autocomplete="off" placeholder="Retry-After: 30"></textarea>
            <label for="wi-resp-body">Body</label>
            <textarea id="wi-resp-body" data-input="resp-body" rows="4" spellcheck="false" autocomplete="off" placeholder='{"ok": true}'></textarea>
          </div>
          <div data-group="toolbar">
            <button data-action="save-response" type="button">Save answer</button>
            <button data-action="reset-response" type="button">Back to the default</button>
          </div>
          <p data-type="wi-respstate" data-for="resp-state"></p>
          <p data-type="wi-resp-msg" role="status" aria-live="polite" data-for="resp-msg"></p>
          <p data-type="wi-resp-err" role="alert" data-for="resp-err"></p>
        </section>

        <section data-type="wi-card" data-card="verify" aria-labelledby="wi-verify-h">
          <h2 id="wi-verify-h">Check the signature</h2>
          <p data-type="wi-hint">Paste the signing secret and every captured request gets checked against it. Stripe, GitHub, Slack, Shopify, Standard Webhooks (Svix), Twilio, Paddle, Mailgun, Discord and SendGrid are recognised by their headers (Mailgun by its body) and verified with the payload each one actually signs. Discord and SendGrid sign with a private key, so for those paste the <em>public</em> key instead. For any other sender, the raw body is HMAC'd with SHA-256, SHA-1 and SHA-512 and matched against every header, which answers "which header is the signature, and how is it encoded?".</p>
          <div data-group="wi-secretrow">
            <input data-input="secret" type="password" autocomplete="off" spellcheck="false" placeholder="whsec_… / signing secret / public key" aria-label="Webhook signing secret or public key" />
            <select data-input="secret-encoding" aria-label="How the secret is encoded">
              <option value="utf-8">text</option>
              <option value="hex">hex</option>
              <option value="base64">base64</option>
            </select>
            <button data-action="forget-secret" type="button">Forget</button>
          </div>
          <p data-type="wi-secretnote" role="status" aria-live="polite"></p>
          <p data-type="wi-hint">The secret stays in this tab: it is never saved to this browser and never sent to the server — the check is computed here with Web Crypto. Closing the tab forgets it. The text, hex or base64 choice applies to senders that do not fix it themselves; Standard Webhooks, Discord and SendGrid always decode their key their own way.</p>
        </section>

        <section data-type="wi-card" data-card="requests" aria-labelledby="wi-req-h">
          <div data-group="wi-reqhead">
            <h2 id="wi-req-h">Captured requests <span data-for="count"></span></h2>
            <div data-group="toolbar">
              <button data-action="toggle-poll" type="button">${wiPollLabel(false)}</button>
              <button data-action="refresh" type="button">Refresh (R)</button>
              <button data-action="download-json" type="button">Download JSON</button>
              <button data-action="download-ndjson" type="button">Download NDJSON</button>
              <button data-action="clear" type="button">Clear (C)</button>
            </div>
          </div>
          <p data-type="wi-livenote" data-for="live"></p>
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
          <p><strong>Copying, resending and scripting.</strong> <em>Copy as curl</em> writes the captured request out as a curl command, with its method, headers and exact body bytes, and leaves out the connection headers and the ones the edge added (the sender's address among them). <em>Resend to URL</em> makes this site's server send that same request to a public address you type. It refuses private, local and reserved addresses, checks the address the name resolves to and connects to exactly that one, does not follow redirects, gives up after five seconds, and shows you the status and the first 2&nbsp;KB of the answer. It is limited to a few sends a minute. To pull a run into a script, <em>Copy export curl</em> gives a command that downloads every captured request as one JSON object per line, oldest first.</p>
          <p><strong>How requests are kept.</strong> Requests are stored on the server only long enough to inspect them and are visible only to whoever holds the unguessable URL; there is no account and no public directory. They are written to a file on the server so that a site update does not empty your URL, and both the file and the memory copy drop a URL after a few hours without activity. Generate a fresh URL any time with <kbd>N</kbd>.</p>
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
    this.liveNoteEl = this.q('[data-for="live"]')
    this.respStatusInput = this.q('[data-input="resp-status"]')
    this.respTypeSel = this.q('[data-input="resp-type"]')
    this.respHeadersInput = this.q('[data-input="resp-headers"]')
    this.respBodyInput = this.q('[data-input="resp-body"]')
    this.respMsgEl = this.q('[data-for="resp-msg"]')
    this.respErrEl = this.q('[data-for="resp-err"]')
    this.respStateEl = this.q('[data-for="resp-state"]')

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
        return
      }
      const c = t.closest('[data-copy-curl]') as HTMLButtonElement | null
      if (c && c.dataset.copyCurl) {
        const req = this.requests.find(r => r.id === c.dataset.copyCurl)
        if (req) this.copyText(this.capturedCurl(req, this.binId), c)
        return
      }
      const send = t.closest('[data-resend]') as HTMLButtonElement | null
      if (send && send.dataset.resend) void this.resend(send.dataset.resend, send)
    })
    // The typed address is remembered per request so a new arrival, which
    // rebuilds the list, does not wipe a half-typed URL.
    this.listEl.addEventListener('input', e => {
      const input = e.target as HTMLInputElement
      if (input?.dataset?.resendUrl) this.resendUrls.set(input.dataset.resendUrl, input.value)
    })
    // The shared card renders through the same renderDetail(), so its Copy-body
    // button needs its own delegate — the one above only searches this.requests.
    this.sharedEl.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('[data-copy-body]') as HTMLButtonElement | null
      if (b && this.sharedReq && this.sharedReq.id === b.dataset.copyBody) {
        this.copyText(this.formatBody(this.sharedReq), b)
        return
      }
      const c = (e.target as HTMLElement).closest('[data-copy-curl]') as HTMLButtonElement | null
      if (c && this.sharedReq && this.sharedReq.id === c.dataset.copyCurl) {
        this.copyText(this.capturedCurl(this.sharedReq, this.sharedBin), c)
      }
    })
    // On document, not the element: the custom element is never focused in the
    // tool's default watch-the-feed state, so a listener on it would leave the
    // advertised R/C/N/P shortcuts dead until the user first clicked inside.
    // onKeydown is what keeps that from hijacking keys meant for other controls.
    document.addEventListener('keydown', this.onKeydown)
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('hashchange', this.onHashChange)

    this.render()
    this.startLive()
    void this.poll()
    void this.loadShared()
    void this.loadResponseConfig()
  }

  disconnectedCallback() {
    this.stopLive()
    this.clearUnread()
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
    window.removeEventListener('hashchange', this.onHashChange)
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
    this.pollBtn.textContent = wiPollLabel(this.paused)
    this.root.setAttribute('data-paused', this.paused ? 'true' : 'false')
  }

  // ── live arrival ───────────────────────────────────────────────────────────
  /**
   * Start whichever way of hearing about new requests applies: nothing while
   * paused, the poll once the stream has failed, otherwise the stream. The poll
   * is the fallback and the catch-up, never the primary path while a stream is up.
   */
  private startLive() {
    this.stopLive()
    // The interval stays on while paused so the "ago" labels keep counting.
    if (this.paused) { this.setMode('paused'); this.startPolling(); return }
    if (this.streamBroken) { this.useFallback(); return }
    this.openStream()
  }

  private stopLive() {
    this.closeStream()
    this.stopPolling()
  }

  private closeStream() {
    if (this.es) { this.es.close(); this.es = null }
  }

  private setMode(mode: 'stream' | 'poll' | 'paused') {
    this.liveNoteEl.textContent = mode === 'stream'
      ? 'Live: new requests appear here the moment they arrive.'
      : mode === 'poll'
        ? 'Checking for new requests every 2 seconds.'
        : 'Paused: press Resume to see new requests.'
  }

  /** Give up on the stream (or never have one) and poll. */
  private useFallback() {
    this.closeStream()
    this.setMode('poll')
    this.startPolling()
  }

  private openStream() {
    if (typeof EventSource === 'undefined') { this.streamBroken = true; this.useFallback(); return }
    this.closeStream()
    const bin = this.binId
    const es = new EventSource(`/api/hook/${bin}/stream`)
    this.es = es
    // Every handler checks `this.es === es`: a stream replaced by N, Pause or a
    // fallback must not paint into the page it no longer belongs to.
    es.addEventListener('ready', () => {
      if (this.es !== es) return
      this.esErrors = 0
      this.setMode('stream')
      this.stopPolling()
      // Anything that arrived between the first poll and the stream opening.
      void this.poll()
    })
    es.addEventListener('request', e => {
      if (this.es !== es || bin !== this.binId) return
      try {
        const req = JSON.parse((e as MessageEvent).data)
        if (wiIsRequest(req)) this.onStreamRequest(req)
      } catch { /* a malformed event is ignored; the next poll reconciles */ }
    })
    es.addEventListener('cleared', () => {
      if (this.es !== es) return
      this.requests = []
      this.reqEtag = ''
      this.render()
    })
    es.addEventListener('bye', e => {
      if (this.es !== es) return
      let reason = ''
      try { reason = String(JSON.parse((e as MessageEvent).data).reason) } catch { /* no reason given */ }
      this.closeStream()
      // The server's age limit is routine: open a fresh stream (when the tab is
      // visible; onVisibility does it otherwise). Any other reason means the bin
      // went away, and the poll reports what is left.
      if (reason === 'max-age') { if (!document.hidden) this.openStream() }
      else this.useFallback()
    })
    es.onerror = () => {
      if (this.es !== es) return
      this.esErrors += 1
      // CLOSED means the browser will not retry (the server refused the stream:
      // at its cap, or one is already open for this address). Otherwise it is a
      // dropped connection that the browser reconnects, and the second one in a
      // row is where we stop trusting it.
      if (es.readyState === EventSource.CLOSED || this.esErrors >= WI_STREAM_MAX_ERRORS) {
        this.streamBroken = true
        this.useFallback()
        void this.poll()
      }
    }
  }

  private onStreamRequest(req: WiRequest) {
    if (this.requests.some(r => r.id === req.id)) return
    this.requests = [req, ...this.requests].slice(0, WI_MAX_REQUESTS)
    // The cached validator described the old list.
    this.reqEtag = ''
    this.render()
    if (document.hidden) this.bumpUnread()
  }

  // ── unread count in the tab title ──────────────────────────────────────────
  private bumpUnread() {
    if (this.unread === 0) this.baseTitle = document.title
    this.unread += 1
    document.title = `(${this.unread}) ${this.baseTitle}`
  }

  private clearUnread() {
    if (this.unread > 0 && document.title === `(${this.unread}) ${this.baseTitle}`) document.title = this.baseTitle
    this.unread = 0
  }

  // ── polling (the fallback, and the catch-up) ───────────────────────────────
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
    for (const id of [...this.resendUrls.keys()]) if (!live.has(id)) this.resendUrls.delete(id)
    for (const id of [...this.resendResults.keys()]) if (!live.has(id)) this.resendResults.delete(id)

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
    // The exact bytes, and the URL the sender called: Twilio signs the URL.
    const scheme = wiDetectScheme(r.headers, wiBodyBytes(r), {
      url: `${this.captureUrl()}${r.query ? `?${r.query}` : ''}`,
    })
    if (!scheme && !secretBytes && !secretError) return { state: 'idle', badge: '', detail: '' }

    // A scheme that fixes how its key is written (Standard Webhooks, Discord,
    // SendGrid) decodes the pasted value its own way, whatever the dropdown says.
    if (scheme?.keyEncoding && this.secret) {
      try {
        secretBytes = wiKeyFor(scheme, this.secret, this.secretEnc)
        secretError = ''
      } catch (err) {
        secretBytes = null
        secretError = err instanceof Error ? err.message : 'The key could not be decoded.'
      }
    }

    const intro = scheme
      ? `<p><b>${wiEsc(scheme.label)}</b> · <code>${wiEsc(scheme.header)}</code> — ${wiEsc(scheme.note)}</p>`
      : ''
    const warning = scheme?.warning ? `<p data-type="wi-signote">${wiEsc(scheme.warning)}</p>` : ''

    if (secretError) {
      return { state: 'error', badge: 'secret?', detail: `${intro}<p>${wiEsc(secretError)}</p>` }
    }

    if (!secretBytes) {
      return {
        state: 'needs-secret',
        badge: `${scheme!.label} · unchecked`,
        detail: `${intro}${warning}<p>Paste the ${scheme!.keyKind === 'public-key' ? 'public key' : 'signing secret'} above and this is checked automatically.</p>`,
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
          detail: `${intro}${warning}<p>The signature is correct for this ${scheme.keyKind === 'public-key' ? 'public key' : 'secret'}.</p>${freshLine}`,
        }
      }
      return {
        state: 'mismatch',
        badge: `${scheme.label} · mismatch`,
        // A public-key check has no digest of its own to put beside the sent one.
        detail: `${intro}${warning}<p>Sent ${sent}</p>${result.expected ? `<p>Computed <code>${wiEsc(result.expected)}</code></p>` : `<p>The signature does not verify against this ${scheme.keyKind === 'public-key' ? 'public key' : 'secret'}, using the timestamp and body this request carried.</p>`}${freshLine}`,
      }
    }

    const found = await wiDiscoverSignature(r.headers, wiBodyBytes(r), secretBytes)
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
      detail: `<p>No recognised signature header, and an HMAC of the raw body with SHA-256, SHA-1 and SHA-512 does not appear in any header. Either the secret is wrong, or this sender signs something other than the body on its own — a timestamp prefix, the request URL, or sorted form fields are the usual variants.</p>`,
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
        <span data-type="wi-meta">${formatBytes(r.size)}${r.bodyTruncated ? ' · truncated' : ''}${r.query ? ' · has query' : ''}</span>
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
      <span><b>Body size</b> ${formatBytes(r.size)}${r.bodyTruncated ? ' (truncated to 64 KB)' : ''}</span>
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
      `<button data-copy-curl="${wiEsc(r.id)}" type="button">Copy as curl</button>`,
      withShareLink ? `<button data-copy-link="${wiEsc(r.id)}" type="button">Copy share link</button>` : '',
    ].join('')
    if (btns) parts.push(`<div data-group="wi-bodybtns">${btns}</div>`)
    // Resending uses the viewer's own bin, so a shared (read-only) card has none.
    if (withShareLink) parts.push(this.renderResend(r.id))
    parts.push('</div>')

    const html = parts.join('')
    return html
  }

  /**
   * The "Resend to URL" block under one request. The typed address and the last
   * outcome live in maps, because a new arrival rebuilds the list and would
   * otherwise wipe both. The outcome is painted from escaped text only: the
   * answer's preview is whatever a stranger's server sent.
   */
  private renderResend(id: string): string {
    const e = wiEsc(id)
    const last = this.resendResults.get(id)
    return `<div data-type="wi-resend">
      <label for="wi-resend-${e}">Send this request again to</label>
      <div data-group="wi-resendrow">
        <input id="wi-resend-${e}" data-resend-url="${e}" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://example.com/webhook" value="${wiEsc(this.resendUrls.get(id) ?? '')}" />
        <button data-resend="${e}" type="button">Resend</button>
      </div>
      <p data-type="wi-resend-msg" role="status" aria-live="polite" data-resend-msg="${e}">${last?.kind === 'ok' ? last.html : ''}</p>
      <p data-type="wi-resend-err" role="alert" data-resend-err="${e}">${last?.kind === 'error' ? last.html : ''}</p>
    </div>`
  }

  /** The curl command for a captured request, aimed at the capture URL it arrived on. */
  private capturedCurl(req: WiRequest, bin: string): string {
    const url = `${location.origin}/api/hook/${bin}${req.query ? `?${req.query}` : ''}`
    return wiCurlCommand(req, url)
  }

  private async resend(id: string, btn: HTMLButtonElement) {
    const target = (this.resendUrls.get(id) ?? '').trim()
    if (!target) {
      this.paintResend(id, { kind: 'error', html: 'Type the address to send this request to, starting with https://.' })
      return
    }
    const bin = this.binId
    btn.disabled = true
    this.paintResend(id, { kind: 'ok', html: 'Sending…' })
    try {
      const res = await fetch(`/api/hook/${bin}/requests/${id}/replay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ url: target }),
      })
      const data = await res.json().catch(() => null) as
        | { ok?: boolean; status?: number; contentType?: string | null; bytes?: number; preview?: string; previewTruncated?: boolean; error?: string }
        | null
      if (res.ok && data?.ok) {
        const preview = typeof data.preview === 'string' ? data.preview : ''
        const kind = data.contentType ? `, ${wiEsc(data.contentType)}` : ''
        this.paintResend(id, {
          kind: 'ok',
          html: `Sent. The server answered <b>${wiEsc(String(Number(data.status)))}</b> (${formatBytes(Number(data.bytes) || 0)}${kind}).`
            + (preview
              ? `<br>${data.previewTruncated ? 'The start of the answer:' : 'The answer:'}<pre data-type="wi-body">${wiEsc(preview)}</pre>`
              : ' The answer had no body.'),
        })
      } else if (res.status === 429) {
        this.paintResend(id, { kind: 'error', html: 'Too many sends in the last minute. Wait a little and try again.' })
      } else {
        const message = typeof data?.error === 'string' && data.error ? data.error : 'The request could not be sent.'
        this.paintResend(id, { kind: 'error', html: wiEsc(message) })
      }
    } catch {
      this.paintResend(id, { kind: 'error', html: 'Could not reach the server to send it.' })
    } finally {
      btn.disabled = false
    }
  }

  private paintResend(id: string, result: WiResend) {
    this.resendResults.set(id, result)
    // Matched on the dataset, never by building a selector out of an id.
    this.listEl.querySelectorAll<HTMLElement>('[data-resend-msg], [data-resend-err]').forEach(el => {
      if (el.dataset.resendMsg === id) el.innerHTML = result.kind === 'ok' ? result.html : ''
      if (el.dataset.resendErr === id) el.innerHTML = result.kind === 'error' ? result.html : ''
    })
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
      case 'download-ndjson': void this.downloadNdjson(btn); break
      case 'copy-export': this.copyText(this.exportCurl(), btn); break
      case 'save-response': void this.saveResponse(btn); break
      case 'reset-response': void this.resetResponse(btn); break
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
    downloadBlob(blob, `webhook-inspector-${this.binId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`)
    this.flash(btn, 'Saved!')
  }

  /** A command that pulls every captured request as one JSON object per line, oldest first. */
  private exportCurl(): string {
    return `curl -s '${location.origin}/api/hook/${this.binId}/requests?format=ndjson'`
  }

  private async downloadNdjson(btn: HTMLButtonElement) {
    const bin = this.binId
    try {
      const res = await fetch(`/api/hook/${bin}/requests?format=ndjson`, { headers: { accept: 'application/x-ndjson' } })
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      if (blob.size === 0) {
        this.setStatus('Nothing to download yet — capture a request first.')
        return
      }
      downloadBlob(blob, `webhook-inspector-${bin.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.ndjson`)
      this.flash(btn, 'Saved!')
    } catch {
      this.flash(btn, 'Failed')
    }
  }

  // ── the configured response ────────────────────────────────────────────────
  private showResponseState(config: WiResponseConfig | null) {
    this.respStateEl.textContent = config
      ? `This URL currently answers with status ${config.status}.`
      : 'This URL currently answers with the default JSON message and status 200.'
  }

  private fillResponseForm(config: WiResponseConfig | null) {
    this.respStatusInput.value = String(config?.status ?? 200)
    this.respHeadersInput.value = (config?.headers ?? []).map(h => `${h.name}: ${h.value}`).join('\n')
    this.respBodyInput.value = config?.body ?? ''
    const type = config?.contentType ?? 'application/json'
    // A type the select does not list (the server normalises, and may add a
    // charset) gets its own option so the form never shows a value that was not saved.
    if (![...this.respTypeSel.options].some(o => o.value === type)) {
      const option = document.createElement('option')
      option.value = type
      option.textContent = type
      this.respTypeSel.append(option)
    }
    this.respTypeSel.value = type
    this.showResponseState(config)
  }

  private async loadResponseConfig() {
    const bin = this.binId
    try {
      const res = await fetch(`/api/hook/${bin}/response`, { headers: { accept: 'application/json' } })
      if (!res.ok || bin !== this.binId) return
      const data = await res.json() as { response?: WiResponseConfig | null }
      if (bin !== this.binId) return
      this.fillResponseForm(data.response ?? null)
    } catch {
      this.respStateEl.textContent = 'Could not read the current answer from the server.'
    }
  }

  private parseHeaderLines(text: string): WiHeader[] | null {
    const out: WiHeader[] = []
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      const colon = line.indexOf(':')
      if (colon < 1) return null
      out.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() })
    }
    return out
  }

  private async saveResponse(btn: HTMLButtonElement) {
    this.respErrEl.textContent = ''
    this.respMsgEl.textContent = ''
    const headers = this.parseHeaderLines(this.respHeadersInput.value)
    if (!headers) {
      this.respErrEl.textContent = 'Write each header on its own line as Name: value, for example Retry-After: 30.'
      return
    }
    const bin = this.binId
    try {
      const res = await fetch(`/api/hook/${bin}/response`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          status: Number(this.respStatusInput.value),
          contentType: this.respTypeSel.value,
          headers,
          body: this.respBodyInput.value,
        }),
      })
      const data = await res.json().catch(() => null) as { response?: WiResponseConfig; error?: string } | null
      if (bin !== this.binId) return
      if (!res.ok || !data?.response) {
        this.respErrEl.textContent = res.status === 429
          ? 'Too many saves in the last minute. Wait a little and try again.'
          : (typeof data?.error === 'string' && data.error) || 'The answer could not be saved.'
        return
      }
      this.fillResponseForm(data.response)
      this.respMsgEl.textContent = 'Saved. Every request to this URL now gets this answer.'
      this.flash(btn, 'Saved!')
    } catch {
      this.respErrEl.textContent = 'Could not reach the server to save the answer.'
    }
  }

  private async resetResponse(btn: HTMLButtonElement) {
    this.respErrEl.textContent = ''
    this.respMsgEl.textContent = ''
    const bin = this.binId
    try {
      const res = await fetch(`/api/hook/${bin}/response`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error(String(res.status))
      if (bin !== this.binId) return
      this.fillResponseForm(null)
      this.respMsgEl.textContent = 'Back to the default answer.'
      this.flash(btn, 'Done')
    } catch {
      this.respErrEl.textContent = 'Could not reach the server to reset the answer.'
    }
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
    this.fillResponseForm(null)
    this.respErrEl.textContent = ''
    this.respMsgEl.textContent = ''
    // The stream is per bin: open one for the new address.
    this.startLive()
    void this.poll()
  }

  private togglePoll() {
    this.paused = !this.paused
    this.writeLS(WI_LS_PAUSED, this.paused ? '1' : '0')
    this.reflectPollBtn()
    // Pausing closes the stream, which also frees the server's slot for it.
    if (this.paused) this.stopLive()
    this.startLive()
    if (!this.paused) void this.poll()
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
    await copyText(text, btn)
  }

  private flash(btn: HTMLButtonElement, label: string) {
    flashLabel(btn, label, 1200)
  }

  private setStatus(label: string) {
    this.statusEl.textContent = label
  }

  // ── persistence ────────────────────────────────────────────────────────────
  private loadBinId(): string {
    const saved = lsGet(WI_LS_BIN)
    if (saved && WI_BIN_RE.test(saved)) return saved
    const id = wiNewBinId()
    this.writeLS(WI_LS_BIN, id)
    return id
  }

  private loadSecretEnc(): WiSecretEncoding {
    const saved = lsGet(WI_LS_SECRET_ENC)
    return saved === 'hex' || saved === 'base64' ? saved : 'utf-8'
  }


  private writeLS(key: string, value: string) {
    lsSet(key, value)
  }
}

if (!customElements.get('webhook-inspector-tool')) {
  customElements.define('webhook-inspector-tool', WebhookInspectorTool)
}

export {}
