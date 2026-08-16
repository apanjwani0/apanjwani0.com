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
const WI_POLL_MS = 2000
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
  /** null = never rendered — the first render must always run. */
  private lastSig: string | null = null
  private reqEtag = ''
  private expanded = new Set<string>()

  private urlInput!: HTMLInputElement
  private statusEl!: HTMLElement
  private listEl!: HTMLElement
  private emptyEl!: HTMLElement
  private countEl!: HTMLElement
  private pollBtn!: HTMLButtonElement

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

    this.innerHTML = `
      <div data-type="tool-page" data-tool="webhook-inspector">
        <div data-type="tool-header">
          <h1>Webhook Inspector</h1>
          <p>Get a unique URL, point any webhook or HTTP client at it, and watch the requests arrive here in real time — method, query string, headers and body, all captured server-side. Your URL is saved on this device so you can reuse and share it. Add <code>?status=500</code>, <code>?delay=2000</code>, or <code>?echo=1</code> to the URL to test how your client handles errors, slow responses, or round-tripped bodies. Press <kbd>R</kbd> to refresh, <kbd>C</kbd> to clear, <kbd>N</kbd> for a new URL, <kbd>P</kbd> to pause.</p>
        </div>

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

        <section data-type="wi-card" data-card="requests" aria-labelledby="wi-req-h">
          <div data-group="wi-reqhead">
            <h2 id="wi-req-h">Captured requests <span data-for="count"></span></h2>
            <div data-group="toolbar">
              <button data-action="toggle-poll" type="button"></button>
              <button data-action="refresh" type="button">Refresh (R)</button>
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

    this.reflectUrl()
    this.reflectPollBtn()

    this.root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn =>
      btn.addEventListener('click', () => this.onAction(btn.dataset.action as string, btn)))
    // Per-row "Copy body" buttons are re-rendered on every poll — delegate one
    // listener on the list instead of re-binding each render.
    this.listEl.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('[data-copy-body]') as HTMLButtonElement | null
      if (!b) return
      const req = this.requests.find(r => r.id === b.dataset.copyBody)
      if (req) this.copyText(this.formatBody(req), b)
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
  }

  disconnectedCallback() {
    this.stopPolling()
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

    // Drop expand-state for requests that no longer exist.
    const live = new Set(this.requests.map(r => r.id))
    for (const id of [...this.expanded]) if (!live.has(id)) this.expanded.delete(id)

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
  }

  private renderRow(r: WiRequest, now: number): string {
    const method = wiEsc(r.method.toUpperCase())
    const open = this.expanded.has(r.id) ? ' open' : ''
    const when = new Date(r.receivedAt)
    const abs = when.toLocaleString()
    const rel = wiRelTime(r.receivedAt, now)
    const summary = `
      <summary data-type="wi-summary">
        <span data-type="wi-method" data-method="${method}">${method}</span>
        <span data-type="wi-when" data-ts="${r.receivedAt}" title="${wiEsc(abs)}">${wiEsc(rel)}</span>
        <span data-type="wi-meta">${wiFmtSize(r.size)}${r.bodyTruncated ? ' · truncated' : ''}${r.query ? ' · has query' : ''}</span>
      </summary>`
    return `<li><details data-req="${wiEsc(r.id)}"${open}>${summary}${this.renderDetail(r, abs)}</details></li>`
  }

  private renderDetail(r: WiRequest, abs: string): string {
    const parts: string[] = ['<div data-type="wi-detail">']

    parts.push(`<div data-type="wi-facts">
      <span><b>Received</b> ${wiEsc(abs)}</span>
      ${r.source ? `<span><b>Source</b> ${wiEsc(r.source)}</span>` : ''}
      <span><b>Body size</b> ${wiFmtSize(r.size)}${r.bodyTruncated ? ' (truncated to 64 KB)' : ''}</span>
    </div>`)

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
      parts.push(`<pre data-type="wi-body">${wiEsc(this.formatBody(r))}</pre>
        <div data-group="wi-bodybtns"><button data-copy-body="${wiEsc(r.id)}" type="button">Copy body</button></div>`)
    }
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
      case 'clear': this.clear(); break
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
    const original = btn.dataset.label ?? btn.textContent ?? ''
    if (!btn.dataset.label) btn.dataset.label = original
    btn.textContent = label
    window.setTimeout(() => { btn.textContent = btn.dataset.label ?? original }, 1200)
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
