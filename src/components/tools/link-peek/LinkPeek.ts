/**
 * Link Peek — see how a URL unfurls in Slack, X and iMessage before sharing it.
 *
 * The second server-backed tool (Webhook Inspector's pattern): the ORIGIN
 * fetches the page — a browser can't, between CORS and the fact that what
 * matters is what a *bot* UA is served — and returns the extracted meta. This
 * component resolves the per-platform previews and the lint through the SAME
 * shared module (`./unfurl`) the server extracted with, renders the three
 * mockup cards, and fetches the og:image once through the bounded server proxy
 * (the site CSP is img-src 'self' data:, so a data URI is also the only way an
 * external image can render here) — which hands it the image's REAL pixel
 * size to hold against the declared og:image:width/height.
 *
 * Mounts as a WebComponent so it survives Astro's View Transitions (see the
 * astro:page-load wiring in tools/[slug].astro). All module-level names are
 * lp-/LP_-prefixed because tool component files share one global script scope.
 */
import { escapeHtml as lpEsc } from '../../../lib/escape'
import { flashLabel } from '../../../lib/flash'
import {
  lpFirst,
  lpLint,
  lpMetaSnippet,
  lpResolvePreviews,
  type LpFinding,
  type LpMeta,
  type LpPreviews,
} from './unfurl'

const LP_LS_URL = 'link-peek:url:v1'
const LP_LS_UA = 'link-peek:ua:v1'

const LP_UA_OPTIONS: { key: string; label: string }[] = [
  { key: 'peek', label: 'LinkPeek (default)' },
  { key: 'slack', label: 'Slackbot' },
  { key: 'x', label: 'Twitterbot' },
  { key: 'facebook', label: 'facebookexternalhit' },
  { key: 'browser', label: 'Browser (Chrome)' },
]

interface LpPageResponse {
  ok: boolean
  error?: string
  kind?: 'html' | 'non-html'
  finalUrl?: string
  status?: number
  contentType?: string
  charset?: string
  bytes?: number
  truncated?: boolean
  hops?: number
  meta?: LpMeta
}

function lpFmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const LP_LEVEL_LABEL: Record<string, string> = { error: 'error', warn: 'warn', info: 'note' }

class LinkPeekTool extends HTMLElement {
  private root!: HTMLElement
  private urlInput!: HTMLInputElement
  private uaSelect!: HTMLSelectElement
  private statusEl!: HTMLElement
  private resultsEl!: HTMLElement
  private inflight: AbortController | null = null
  private lastMeta: LpMeta | null = null
  private lastFinalUrl = ''

  connectedCallback() {
    this.innerHTML = `
      <div data-type="tool-page" data-tool="link-peek">
        <div data-type="tool-header">
          <h1>Link Peek</h1>
          <p>Paste a URL and see how it will unfurl in Slack, X and iMessage <em>before</em> you share it. The page is fetched server-side as the bot of your choice — sites serve different tags to Slackbot than to a browser — and its Open Graph and Twitter-card tags are read the way each platform reads them, fallbacks and all. A lint pass then lists what is missing or wrong: no <code>og:image</code>, a relative image URL, a title that will truncate, declared dimensions that do not match the real file. Copy a corrected meta snippet when it is done.</p>
        </div>

        <section data-type="lp-card" data-card="input" aria-labelledby="lp-input-h">
          <h2 id="lp-input-h">URL to preview</h2>
          <div data-group="lp-urlrow">
            <input data-input="url" type="url" inputmode="url" spellcheck="false" autocomplete="off"
              placeholder="https://example.com/article" aria-label="URL to preview" aria-keyshortcuts="Enter" />
            <select data-input="ua" aria-label="Fetch the page as this user agent"></select>
            <button data-action="peek" type="button">Preview</button>
          </div>
          <span data-type="lp-status" role="status" aria-live="polite"></span>
          <p data-type="lp-hint">Fetched once, server-side, with the redirects it follows shown below. Only public URLs — private and internal addresses are refused. Nothing about the page is stored.</p>
        </section>

        <div data-for="results" role="region" aria-label="Preview results"></div>

        <details data-type="lp-explainer">
          <summary>How unfurling actually works</summary>
          <p>When you paste a link into Slack, X, iMessage, WhatsApp or Discord, their servers fetch the page and read a handful of <code>&lt;meta&gt;</code> tags out of its <code>&lt;head&gt;</code> — the <strong>Open Graph</strong> tags (<code>og:title</code>, <code>og:description</code>, <code>og:image</code>) that Facebook introduced, and the <strong>Twitter card</strong> tags (<code>twitter:card</code>, <code>twitter:image</code>) layered on top. Each platform has its own precedence order and fallbacks, which is why the same page can look fine in Slack and broken on X.</p>
          <p>Three details cause most broken previews. First, <strong>X renders no card at all without <code>twitter:card</code></strong> — complete og: tags are not enough. Second, the OG rule for repeated tags is <strong>first one wins</strong>, so a template that emits a default <code>og:image</code> before the per-page one silently pins every share to the default. Third, scrapers want an <strong>absolute https</strong> image URL with <strong>declared width and height</strong> — undeclared dimensions mean the first share of a fresh URL can render image-less while the scraper downloads the file to measure it.</p>
          <p>The user-agent picker exists because sites really do serve different markup to different bots: paywalls let Slackbot through, bot-blockers turn Twitterbot away, and some sites only render their meta tags for crawlers. Previewing as the bot that will actually fetch your link is the honest test.</p>
          <p>The image in each mockup is fetched once through this site's server (capped at a few hundred KB) and measured, so the "declared vs actual size" check uses the real file, not the page's claim about it.</p>
        </details>
      </div>
    `

    this.root = this.querySelector('[data-type="tool-page"]') as HTMLElement
    this.urlInput = this.root.querySelector('[data-input="url"]') as HTMLInputElement
    this.uaSelect = this.root.querySelector('[data-input="ua"]') as HTMLSelectElement
    this.statusEl = this.root.querySelector('[data-type="lp-status"]') as HTMLElement
    this.resultsEl = this.root.querySelector('[data-for="results"]') as HTMLElement

    this.uaSelect.innerHTML = LP_UA_OPTIONS
      .map(o => `<option value="${lpEsc(o.key)}">${lpEsc(o.label)}</option>`)
      .join('')

    try {
      const savedUrl = localStorage.getItem(LP_LS_URL)
      if (savedUrl) this.urlInput.value = savedUrl
      const savedUa = localStorage.getItem(LP_LS_UA)
      if (savedUa && LP_UA_OPTIONS.some(o => o.key === savedUa)) this.uaSelect.value = savedUa
    } catch { /* private mode */ }

    this.root.querySelector('[data-action="peek"]')!.addEventListener('click', () => void this.peek())
    this.urlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void this.peek()
      }
    })
    // Ctrl/Cmd+Enter re-runs the preview from anywhere inside the tool — after
    // tweaking the UA select or reading the findings, a re-check shouldn't
    // require mousing back to the button. Plain Enter stays scoped to the URL
    // input, where it can't fight a control's own Enter behaviour.
    this.root.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void this.peek()
      }
    })
    this.uaSelect.addEventListener('change', () => {
      try { localStorage.setItem(LP_LS_UA, this.uaSelect.value) } catch { /* private mode */ }
    })
    // Copy buttons are re-rendered with every result — one delegate, not rebinds.
    this.resultsEl.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('[data-copy]') as HTMLButtonElement | null
      if (!btn) return
      const what = btn.dataset.copy
      if (what === 'snippet' && this.lastMeta) {
        this.copy(lpMetaSnippet(this.lastMeta, this.lastFinalUrl), btn)
      } else if (what === 'value' && btn.dataset.value !== undefined) {
        this.copy(btn.dataset.value, btn)
      }
    })
  }

  disconnectedCallback() {
    this.inflight?.abort()
  }

  private copy(text: string, btn: HTMLButtonElement) {
    navigator.clipboard?.writeText(text).then(
      () => flashLabel(btn, 'Copied'),
      () => flashLabel(btn, 'Copy failed'),
    )
  }

  private setStatus(text: string) {
    this.statusEl.textContent = text
  }

  private async peek() {
    const raw = this.urlInput.value.trim()
    if (!raw) {
      this.setStatus('Enter a URL first.')
      return
    }
    try { localStorage.setItem(LP_LS_URL, raw) } catch { /* private mode */ }

    this.inflight?.abort()
    const controller = new AbortController()
    this.inflight = controller
    this.setStatus('Fetching…')
    this.resultsEl.innerHTML = ''
    this.lastMeta = null

    let data: LpPageResponse
    try {
      const res = await fetch(
        `/api/tools/link-peek?url=${encodeURIComponent(raw)}&ua=${encodeURIComponent(this.uaSelect.value)}`,
        { signal: controller.signal },
      )
      data = await res.json() as LpPageResponse
      if (res.status === 429) {
        this.setStatus('Rate limited — this tool fetches real pages, so give it a minute.')
        return
      }
    } catch {
      if (controller.signal.aborted) return
      this.setStatus('The preview request failed — check your connection and try again.')
      return
    }
    if (controller.signal.aborted) return

    if (!data.ok) {
      this.setStatus(data.error ?? 'The page could not be previewed.')
      return
    }
    if (data.kind === 'non-html') {
      this.setStatus('')
      this.resultsEl.innerHTML = `
        <section data-type="lp-card" data-card="fetched" aria-label="Fetch result">
          <p data-type="lp-hint">That URL answers with <strong>${lpEsc(data.contentType || 'no content-type')}</strong> (HTTP ${data.status}), not an HTML page — there are no meta tags to unfurl. Slack and iMessage preview some file types (images, video) directly; X shows a bare link.</p>
        </section>`
      return
    }
    if (!data.meta || !data.finalUrl) {
      this.setStatus('The page came back in a shape this tool does not understand.')
      return
    }

    this.setStatus('')
    this.lastMeta = data.meta
    this.lastFinalUrl = data.finalUrl
    this.render(data)
    void this.loadImages(data)
  }

  /* ---------------------------------------------------------------- */
  /* rendering                                                         */
  /* ---------------------------------------------------------------- */

  private render(data: LpPageResponse) {
    const meta = data.meta as LpMeta
    const finalUrl = data.finalUrl as string
    const previews = lpResolvePreviews(meta, finalUrl)
    const findings = lpLint(meta, finalUrl)

    const hopNote = (data.hops ?? 0) > 0 ? ` after ${data.hops} redirect${data.hops === 1 ? '' : 's'}` : ''
    const truncNote = data.truncated ? ' · read truncated at the size cap (meta tags arrive first, so extraction is unaffected)' : ''

    this.resultsEl.innerHTML = `
      <section data-type="lp-card" data-card="fetched" aria-label="Fetch result">
        <p data-type="lp-fetchline">Fetched <a href="${lpEsc(finalUrl)}" rel="nofollow noopener noreferrer" target="_blank">${lpEsc(finalUrl)}</a>${hopNote} — HTTP ${data.status}, ${lpEsc(data.contentType || 'text/html')}, ${lpFmtSize(data.bytes ?? 0)}${truncNote}</p>
      </section>

      <section data-type="lp-card" data-card="previews" aria-labelledby="lp-prev-h">
        <h2 id="lp-prev-h">How it unfurls</h2>
        <div data-group="lp-previews">
          ${this.renderSlack(previews)}
          ${this.renderX(previews)}
          ${this.renderIMessage(previews)}
        </div>
        <p data-type="lp-hint">Mockups, not screenshots — built from the page's tags with each platform's real precedence rules (X reads twitter:* before og:*, Slack the other way around). Text is clamped roughly where each client clamps it.</p>
      </section>

      <section data-type="lp-card" data-card="lint" aria-labelledby="lp-lint-h">
        <h2 id="lp-lint-h">Lint ${findings.length ? `<span data-type="lp-count">${findings.length}</span>` : ''}</h2>
        ${findings.length ? `<ul data-type="lp-findings">${findings.map(f => this.renderFinding(f)).join('')}</ul>`
          : '<p data-type="lp-hint" data-ok="1">Nothing to flag — title, description, image, dimensions and card type all check out.</p>'}
      </section>

      <section data-type="lp-card" data-card="tags" aria-labelledby="lp-tags-h">
        <div data-group="lp-tagshead">
          <h2 id="lp-tags-h">What the page declares</h2>
          <div data-group="toolbar">
            <button data-copy="snippet" type="button">Copy corrected meta snippet</button>
          </div>
        </div>
        ${this.renderTags(meta)}
      </section>
    `
  }

  private imgSlot(url: string | null, slot: string, alt: string): string {
    if (!url) return `<div data-type="lp-noimg" data-img-slot="${lpEsc(slot)}">no image</div>`
    return `<div data-type="lp-imgbox" data-img-slot="${lpEsc(slot)}" data-img-url="${lpEsc(url)}"><span data-type="lp-imgwait">loading image…</span><img alt="${lpEsc(alt)}" hidden /></div>`
  }

  private renderSlack(p: LpPreviews): string {
    const s = p.slack
    return `
      <figure data-type="lp-mock" data-platform="slack">
        <figcaption>Slack</figcaption>
        <div data-type="lp-slack">
          <div data-group="lp-slack-site">
            <span data-type="lp-favicon" data-img-slot="favicon"${s.faviconUrl ? ` data-img-url="${lpEsc(s.faviconUrl)}"` : ''}></span>
            <span>${lpEsc(s.siteName ?? p.domain)}</span>
          </div>
          <p data-type="lp-mock-title">${s.title ? lpEsc(s.title) : '<em>no title</em>'}</p>
          ${s.description ? `<p data-type="lp-mock-desc">${lpEsc(s.description)}</p>` : ''}
          ${s.large ? this.imgSlot(s.imageUrl, 'slack', 'Slack preview image') : ''}
          ${!s.large && s.imageUrl ? this.imgSlot(s.imageUrl, 'slack-thumb', 'Slack thumbnail') : ''}
        </div>
      </figure>`
  }

  private renderX(p: LpPreviews): string {
    const x = p.x
    if (!x.card) {
      return `
        <figure data-type="lp-mock" data-platform="x">
          <figcaption>X</figcaption>
          <div data-type="lp-x" data-card-kind="none">
            <p data-type="lp-mock-desc"><em>No card — the page has no twitter:card tag, so X shows the bare URL.</em></p>
            <p data-type="lp-mock-domain">${lpEsc(p.domain)}</p>
          </div>
        </figure>`
    }
    const large = x.card === 'summary_large_image'
    return `
      <figure data-type="lp-mock" data-platform="x">
        <figcaption>X — ${lpEsc(x.card)}</figcaption>
        <div data-type="lp-x" data-card-kind="${large ? 'large' : 'small'}">
          ${large ? this.imgSlot(x.imageUrl, 'x', 'X card image') : ''}
          <div data-group="lp-x-body">
            ${!large ? this.imgSlot(x.imageUrl, 'x-thumb', 'X card thumbnail') : ''}
            <div>
              <p data-type="lp-mock-domain">${lpEsc(p.domain)}</p>
              <p data-type="lp-mock-title">${x.title ? lpEsc(x.title) : '<em>no title</em>'}</p>
              ${x.description ? `<p data-type="lp-mock-desc">${lpEsc(x.description)}</p>` : ''}
            </div>
          </div>
        </div>
      </figure>`
  }

  private renderIMessage(p: LpPreviews): string {
    const m = p.imessage
    return `
      <figure data-type="lp-mock" data-platform="imessage">
        <figcaption>iMessage</figcaption>
        <div data-type="lp-imsg">
          ${this.imgSlot(m.imageUrl, 'imessage', 'iMessage preview image')}
          <div data-group="lp-imsg-body">
            <p data-type="lp-mock-title">${m.title ? lpEsc(m.title) : '<em>no title</em>'}</p>
            <p data-type="lp-mock-domain">${lpEsc(p.domain)}</p>
          </div>
        </div>
      </figure>`
  }

  private renderFinding(f: LpFinding): string {
    return `<li data-level="${lpEsc(f.level)}"><span data-type="lp-level">${lpEsc(LP_LEVEL_LABEL[f.level] ?? f.level)}</span> ${lpEsc(f.message)}</li>`
  }

  private renderTags(meta: LpMeta): string {
    const rows: string[] = []
    const row = (key: string, value: string | null) => {
      rows.push(`<tr><th scope="row">${lpEsc(key)}</th><td>${value === null ? '<em>—</em>' : value === '' ? '<em>empty</em>' : lpEsc(value)}</td><td>${value ? `<button data-copy="value" data-value="${lpEsc(value)}" type="button" aria-label="Copy ${lpEsc(key)}">Copy</button>` : ''}</td></tr>`)
    }
    row('<title>', meta.title)
    row('meta description', meta.metaDescription)
    row('canonical', meta.canonical)
    for (const t of meta.og) row(t.key, t.value)
    for (const t of meta.twitter) row(t.key, t.value)
    return `<div data-type="lp-tablewrap"><table data-type="lp-tags"><thead><tr><th scope="col">tag</th><th scope="col">value</th><th scope="col"></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
  }

  /* ---------------------------------------------------------------- */
  /* images — proxied once, then measured                              */
  /* ---------------------------------------------------------------- */

  private async loadImages(data: LpPageResponse) {
    const meta = data.meta as LpMeta
    const slots = [...this.resultsEl.querySelectorAll<HTMLElement>('[data-img-slot][data-img-url]')]
    // At most two DISTINCT urls are fetched (og vs twitter image), plus the
    // favicon — each preview slot sharing a URL shares the fetch.
    const byUrl = new Map<string, HTMLElement[]>()
    for (const slot of slots) {
      const u = slot.dataset.imgUrl as string
      if (!byUrl.has(u)) byUrl.set(u, [])
      ;(byUrl.get(u) as HTMLElement[]).push(slot)
    }
    let mainDone = false
    for (const [url, targets] of [...byUrl.entries()].slice(0, 3)) {
      const isFavicon = targets.every(t => t.dataset.imgSlot === 'favicon')
      let result: { ok: boolean; dataUri?: string; bytes?: number; error?: string }
      try {
        const res = await fetch(
          `/api/tools/link-peek?kind=image&url=${encodeURIComponent(url)}&ua=${encodeURIComponent(this.uaSelect.value)}`,
        )
        result = await res.json()
      } catch {
        result = { ok: false, error: 'image fetch failed' }
      }
      if (this.lastMeta !== meta) return // a newer preview replaced this one
      for (const t of targets) {
        if (result.ok && result.dataUri) {
          if (isFavicon) {
            t.style.backgroundImage = `url("${result.dataUri}")`
            t.dataset.loaded = '1'
          } else {
            const img = t.querySelector('img')
            const wait = t.querySelector('[data-type="lp-imgwait"]')
            if (img) {
              img.src = result.dataUri
              img.hidden = false
              if (!mainDone) {
                // `meta` is captured HERE, not read when the load fires. The
                // loop above guards itself against a superseded preview, but a
                // large image can still finish decoding after the visitor has
                // previewed a different URL — at which point the old image's
                // real pixels were being measured against the NEW page's
                // declared og:image:width/height and the bogus verdict appended
                // to the card now on screen.
                img.addEventListener('load', () => this.reportImageSize(img, result.bytes ?? 0, meta), { once: true })
                mainDone = true
              }
            }
            wait?.remove()
          }
        } else if (!isFavicon) {
          t.innerHTML = `<span data-type="lp-imgwait">image unavailable — ${lpEsc(result.error ?? 'fetch failed')}</span>`
        }
      }
    }
  }

  /** Declared vs ACTUAL image size — the check no static lint can make. */
  private reportImageSize(img: HTMLImageElement, bytes: number, forMeta: LpMeta) {
    const meta = this.lastMeta
    // A newer preview replaced the one this image belonged to — say nothing
    // rather than measure one page's image against another page's claim.
    if (!meta || meta !== forMeta) return
    const w = img.naturalWidth
    const h = img.naturalHeight
    const declaredW = Number.parseInt(lpFirst(meta.og, 'og:image:width') ?? '', 10)
    const declaredH = Number.parseInt(lpFirst(meta.og, 'og:image:height') ?? '', 10)
    let verdict = ''
    if (Number.isFinite(declaredW) && Number.isFinite(declaredH) && declaredW > 0 && declaredH > 0) {
      verdict = declaredW === w && declaredH === h
        ? ' — matches the declared og:image:width/height'
        : ` — the page declares ${declaredW}×${declaredH}, which is wrong; scrapers that trust the declaration will crop badly`
    }
    const line = document.createElement('p')
    line.setAttribute('data-type', 'lp-imgfact')
    line.textContent = `Image measures ${w}×${h} px, ${lpFmtSize(bytes)}${verdict}.`
    this.resultsEl.querySelector('[data-card="previews"]')?.appendChild(line)
  }
}

if (!customElements.get('link-peek-tool')) {
  customElements.define('link-peek-tool', LinkPeekTool)
}
