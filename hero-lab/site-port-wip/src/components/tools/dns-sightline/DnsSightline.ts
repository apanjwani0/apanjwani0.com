/**
 * DNS Sightline — ask three resolvers the same eight questions and read the
 * disagreements.
 *
 * The fourth server-backed tool (Webhook Inspector, Link Peek, then Chainsaw):
 * the ORIGIN does the resolving, because a browser has no API that puts a
 * question to a nameserver — `fetch` resolves a name as a side effect and hands
 * back a socket, never the answer.
 *
 * Every verdict on this page is resolved through the SAME shared module
 * (`./analyze`) the assertions run against, so the page and `security:smoke`
 * cannot disagree about a finding, and the results are rendered by `./panels`,
 * which the assertions render too. This file wires the page; it decides
 * nothing and renders no result itself.
 *
 * Mounts as a WebComponent so it survives Astro's View Transitions (see the
 * astro:page-load wiring in tools/[slug].astro). All module-level names are
 * sg-/SG_-prefixed because tool component files share one script namespace.
 */
import { escapeHtml as sgEsc } from '../../../lib/escape'
import { flashLabel } from '../../../lib/flash'
import { SG_KNOWN_CAS, SG_TYPES, sgCanonicalRecord, sgCountByLevel, sgPickAnswer } from './analyze'
// Type-only, and erased at build: none of the resolver code in ./inspect ships.
import type { SgInspection } from './inspect'
import { sgRenderResults } from './panels'

const SG_LS_NAME = 'dns-sightline:name:v1'
const SG_LS_CA = 'dns-sightline:ca:v1'

type SgReport = SgInspection

interface SgResponse {
  ok: boolean
  error?: string
  report?: SgReport
}

class DnsSightlineTool extends HTMLElement {
  private root!: HTMLElement
  private nameInput!: HTMLInputElement
  private caSelect!: HTMLSelectElement
  private runButton!: HTMLButtonElement
  private statusEl!: HTMLElement
  private resultsEl!: HTMLElement
  private inflight: AbortController | null = null
  private report: SgReport | null = null

  // The results container is a named LANDMARK (`role="region"` + `aria-label`),
  // deliberately not a live region. An inspection drops hundreds of words of
  // findings, records, mail policy and CAA into it at once; announcing that
  // would bury the `sg-status` line — which is a live region, and already says
  // how the run went — under a recital nobody can skim. A landmark instead lets
  // a screen-reader user jump straight to the output the moment they hear it
  // landed. Chainsaw and Link Peek render the same idiom for the same reason.
  connectedCallback() {
    this.innerHTML = `
      <div data-type="tool-page" data-tool="dns-sightline">
        <div data-type="tool-header">
          <h1>DNS Sightline</h1>
          <p>Ask three independent public resolvers the same eight questions about a domain, at the same moment, and put the answers side by side. <strong>Disagreement is the finding</strong> — that is what propagation lag, a split-horizon zone and a stale cache all look like from outside. Then the parts people get wrong: an SPF record's lookup budget counted the way a receiver counts it, DMARC alignment as distinct from the SPF pass, a CAA record quietly refusing your CA, an MX pointing at a CNAME, and a dangling CNAME with somebody else's name on the other end.</p>
        </div>

        <section data-type="sg-card" data-card="input" aria-labelledby="sg-input-h">
          <h2 id="sg-input-h">Domain to inspect</h2>
          <div data-group="sg-row">
            <input data-input="name" type="text" inputmode="url" spellcheck="false" autocomplete="off"
              placeholder="example.com   ·   mail.example.com   ·   https://example.com/page"
              aria-label="Domain name" aria-keyshortcuts="Enter" />
            <label data-type="sg-field">
              <span>Renewing with</span>
              <select data-input="ca" aria-label="Certificate authority to check the CAA policy against">
                <option value="">— any CA —</option>
                ${SG_KNOWN_CAS.map(c => `<option value="${sgEsc(c.id)}">${sgEsc(c.label)}</option>`).join('')}
              </select>
            </label>
            <button data-action="inspect" type="button">Inspect</button>
          </div>
          <span data-type="sg-status" role="status" aria-live="polite"></span>
          <p data-type="sg-hint">Queried from this site's server over DNS-over-HTTPS against Cloudflare, Google and Quad9. Nothing is stored, and the only hosts this tool contacts are those three resolvers — the name you type never becomes a destination.</p>
        </section>

        <div data-for="results" role="region" aria-label="Inspection results"></div>

        <details data-type="sg-explainer">
          <summary>Why the same domain gives different answers to different people</summary>
          <p>A recursive resolver holds every record it has fetched until that record's TTL runs out, and it started its own clock when it happened to fetch it. Two resolvers asked the same question a second apart can therefore be holding copies from an hour apart. That is not a bug in either of them — it is the design — and it is the whole reason "I changed the record but it still resolves to the old address" is the most common DNS complaint there is. Asking one resolver cannot see it. Asking three can.</p>
          <p>Two other things produce the same symptom and want different fixes. A zone that answers differently depending on who is asking — <em>split horizon</em>, or geo-routing at the authoritative server — disagrees permanently rather than briefly, and no amount of waiting resolves it. And a resolver that is <em>filtering</em> returns nothing at all rather than a different answer, which is a distinguishable shape: this tool reports that case separately, because it is a policy decision at one operator and not a problem with your zone.</p>
          <p>TTLs and record order are deliberately excluded from the comparison. Every resolver reports its own remaining TTL, and round-robin address sets are rotated on purpose by the authoritative server and again by the recursor — a comparison that included either would report every load-balanced domain on the internet as inconsistent, which would make the one signal this page exists for worthless.</p>
        </details>

        <details data-type="sg-explainer">
          <summary>The ten-lookup SPF limit is not ten mechanisms</summary>
          <p>RFC 7208 limits an SPF evaluation to ten <em>terms that cause a DNS query</em> — <code>include</code>, <code>a</code>, <code>mx</code>, <code>ptr</code>, <code>exists</code> and the <code>redirect</code> modifier. Exceeding it is a permerror, which most receivers treat as a hard failure, and the failure arrives the day you add one more provider.</p>
          <p>The counting is where it goes wrong. <code>ip4</code> and <code>ip6</code> terms are free, so a record with forty of them is fine. But an <code>include</code> costs one <em>and then spends the same budget again inside the record it includes</em> — a tidy-looking three-mechanism record that includes three mail providers routinely totals fourteen, and a checker that counts what is written at the top level reports three and tells you everything is fine. This page walks the whole tree and shows you each term and which record it came from.</p>
        </details>
      </div>
    `

    this.root = this.querySelector('[data-type="tool-page"]') as HTMLElement
    this.nameInput = this.root.querySelector('[data-input="name"]') as HTMLInputElement
    this.caSelect = this.root.querySelector('[data-input="ca"]') as HTMLSelectElement
    this.runButton = this.root.querySelector('[data-action="inspect"]') as HTMLButtonElement
    this.statusEl = this.root.querySelector('[data-type="sg-status"]') as HTMLElement
    this.resultsEl = this.root.querySelector('[data-for="results"]') as HTMLElement

    // A result is worth sending to whoever owns the zone, so the name rides in
    // the URL. Read back through the same validation the server applies — a
    // hand-edited ?name must cost the prefill, never the page.
    let deepLinked = ''
    try {
      const params = new URLSearchParams(location.search)
      const fromUrl = params.get('name') ?? ''
      if (fromUrl && fromUrl.length <= 300) deepLinked = fromUrl
      const caFromUrl = params.get('ca') ?? ''
      if (caFromUrl && SG_KNOWN_CAS.some(c => c.id === caFromUrl)) this.caSelect.value = caFromUrl
    } catch { /* no URL access in some embedded contexts */ }

    if (deepLinked) {
      this.nameInput.value = deepLinked
    } else {
      try {
        const saved = localStorage.getItem(SG_LS_NAME)
        if (saved) this.nameInput.value = saved
        const savedCa = localStorage.getItem(SG_LS_CA)
        if (savedCa && SG_KNOWN_CAS.some(c => c.id === savedCa)) this.caSelect.value = savedCa
      } catch { /* private mode */ }
    }

    this.runButton.addEventListener('click', () => void this.inspect())
    this.nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void this.inspect()
      }
    })
    this.caSelect.addEventListener('change', () => {
      try { localStorage.setItem(SG_LS_CA, this.caSelect.value) } catch { /* private mode */ }
      if (this.report) void this.inspect()
    })
    this.root.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void this.inspect()
      }
    })
    this.resultsEl.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('[data-copy]') as HTMLButtonElement | null
      if (btn) this.copyFor(btn.dataset.copy ?? '', btn)
    })

    if (deepLinked) void this.inspect()
  }

  disconnectedCallback() {
    this.inflight?.abort()
    this.inflight = null
  }

  private setStatus(text: string, tone: '' | 'ok' | 'bad' = '') {
    this.statusEl.textContent = text
    if (tone) this.statusEl.setAttribute('data-tone', tone)
    else this.statusEl.removeAttribute('data-tone')
  }

  private async inspect() {
    const value = this.nameInput.value.trim()
    if (!value) {
      this.setStatus('Enter a domain name first.', 'bad')
      this.nameInput.focus()
      return
    }

    this.inflight?.abort()
    const controller = new AbortController()
    this.inflight = controller
    this.runButton.disabled = true
    this.setStatus('Asking three resolvers…')

    try { localStorage.setItem(SG_LS_NAME, value) } catch { /* private mode */ }

    const params = new URLSearchParams({ name: value })
    if (this.caSelect.value) params.set('ca', this.caSelect.value)

    try {
      const res = await fetch(`/api/tools/dns-sightline?${params.toString()}`, { signal: controller.signal })
      const body = (await res.json()) as SgResponse
      if (!body.ok || !body.report) {
        this.report = null
        this.resultsEl.innerHTML = ''
        this.setStatus(body.error ?? `request failed (${res.status})`, 'bad')
        return
      }
      this.report = body.report
      this.render(body.report)
      const counts = sgCountByLevel(body.report.findings)
      // A run that hit its deadline is a partial answer, and the status line is
      // what a screen reader announces — so it says so before the counts do.
      this.setStatus(
        `${body.report.deadlineHit ? 'Stopped at the time limit, so some sections are incomplete · ' : ''}${body.report.queries} DNS queries in ${body.report.elapsedMs}ms · ${counts.error} error${counts.error === 1 ? '' : 's'}, ${counts.warn} warning${counts.warn === 1 ? '' : 's'}`,
        counts.error || body.report.deadlineHit ? 'bad' : 'ok',
      )
      // Keep the address bar in step so the result is shareable. replaceState,
      // not pushState: one inspection is not a history entry.
      try {
        const next = new URL(location.href)
        next.searchParams.set('name', body.report.name)
        if (this.caSelect.value) next.searchParams.set('ca', this.caSelect.value)
        else next.searchParams.delete('ca')
        history.replaceState(null, '', next.toString())
      } catch { /* no history access */ }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      this.setStatus('Could not reach the inspection endpoint.', 'bad')
    } finally {
      if (this.inflight === controller) this.inflight = null
      this.runButton.disabled = false
    }
  }

  /* ---------------- rendering ---------------- */

  private render(r: SgReport) {
    this.resultsEl.innerHTML = sgRenderResults(r)
  }

  /* ---------------- copy ---------------- */

  private copyFor(kind: string, btn: HTMLButtonElement) {
    const r = this.report
    if (!r) return
    let text = ''
    if (kind === 'findings') {
      text = [
        `DNS Sightline — ${r.name}`,
        `${r.queries} queries via ${r.resolvers.map(x => x.label).join(', ')}`,
        '',
        ...r.findings.map(f => `[${f.level}] ${f.title}\n  ${f.detail}\n${f.evidence.map(e => `    ${e}`).join('\n')}`),
      ].join('\n')
    } else if (kind === 'dig') {
      text = SG_TYPES.map(t => `dig +short ${r.name} ${t} @1.1.1.1`).join('\n')
    } else if (kind === 'zone') {
      // The same answer the Records table shows and the findings were drawn from.
      text = SG_TYPES.flatMap(t => {
        const a = sgPickAnswer(r.answers[t] ?? [], r.analysedBy)
        return (a?.records ?? []).map(rec => `${r.name}.\t${rec.ttl}\tIN\t${t}\t${sgCanonicalRecord(rec, t)}`)
      }).join('\n')
    } else if (kind === 'spf') {
      text = r.spf.record ?? ''
    }
    if (!text) return
    void navigator.clipboard.writeText(text).then(
      () => flashLabel(btn, 'Copied'),
      () => flashLabel(btn, 'Copy failed'),
    )
  }
}

if (!customElements.get('dns-sightline-tool')) {
  customElements.define('dns-sightline-tool', DnsSightlineTool)
}
