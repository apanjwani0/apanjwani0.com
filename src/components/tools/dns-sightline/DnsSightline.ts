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
 * cannot disagree about a finding. This file renders; it decides nothing.
 *
 * Mounts as a WebComponent so it survives Astro's View Transitions (see the
 * astro:page-load wiring in tools/[slug].astro). All module-level names are
 * sg-/SG_-prefixed because tool component files share one script namespace.
 */
import { escapeHtml as sgEsc } from '../../../lib/escape'
import { flashLabel } from '../../../lib/flash'
import {
  SG_KNOWN_CAS,
  SG_SPF_LOOKUP_LIMIT,
  SG_TYPES,
  sgCanonicalRecord,
  sgCountByLevel,
  type SgAnswer,
  type SgFinding,
  type SgType,
} from './analyze'

const SG_LS_NAME = 'dns-sightline:name:v1'
const SG_LS_CA = 'dns-sightline:ca:v1'
const SG_LEVEL_LABEL: Record<string, string> = { error: 'error', warn: 'warn', info: 'note' }

interface SgReport {
  name: string
  analysedBy: string
  resolvers: Array<{ key: string; label: string; operator: string; note: string }>
  answers: Record<string, SgAnswer[]>
  diffs: Array<{ type: SgType; agree: boolean; answered: number; groups: Array<{ resolvers: string[]; answer: SgAnswer }>; failed: string[]; looksFiltered: boolean }>
  spf: {
    record: string | null
    recordCount: number
    terms: Array<{ kind: string; domain: string; depth: number; parent: string; raw: string }>
    lookups: number
    limit: number
    exceeded: boolean
    voidLookups: number
    truncated: boolean
    all: string | null
  }
  dmarc: { record: string | null; recordCount: number; tags: Record<string, string>; atApex: boolean }
  caa: { policyAt: string | null; allowed: string[]; allowedWild: string[]; forbidsAll: boolean; forbidsAllWild: boolean; unknownCritical: string[] }
  caaWalked: string[]
  mxTargets: Array<{ preference: number; host: string; isCname: boolean; cnameTo: string | null; addresses: string[]; resolves: boolean }>
  cname: { target: string | null; dangling: boolean; service: string | null; coexisting: string[]; atApex: boolean }
  findings: SgFinding[]
  queries: number
  elapsedMs: number
}

interface SgResponse {
  ok: boolean
  error?: string
  report?: SgReport
}

/** Inline markdown — `code` and **bold** only — so findings can point at a tag. */
function sgRich(text: string): string {
  return sgEsc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function sgRecordRows(answer: SgAnswer | undefined, type: SgType): string {
  if (!answer || !answer.records.length) return ''
  return answer.records
    .map(r => `<tr><td><code>${sgEsc(type)}</code></td><td><code>${sgEsc(sgCanonicalRecord(r, type))}</code></td><td>${r.ttl}s</td></tr>`)
    .join('')
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
      this.setStatus(
        `${body.report.queries} DNS queries in ${body.report.elapsedMs}ms · ${counts.error} error${counts.error === 1 ? '' : 's'}, ${counts.warn} warning${counts.warn === 1 ? '' : 's'}`,
        counts.error ? 'bad' : 'ok',
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
    this.resultsEl.innerHTML = [
      this.renderFindings(r),
      this.renderDiff(r),
      this.renderRecords(r),
      this.renderMail(r),
      this.renderCaa(r),
    ].join('')
  }

  private renderFindings(r: SgReport): string {
    const counts = sgCountByLevel(r.findings)
    const body = r.findings.length
      ? r.findings
          .map(
            f => `
        <li data-level="${sgEsc(f.level)}">
          <p data-type="sg-finding-head"><span data-type="sg-level">${sgEsc(SG_LEVEL_LABEL[f.level] ?? f.level)}</span> ${sgRich(f.title)}</p>
          <p data-type="sg-finding-detail">${sgRich(f.detail)}</p>
          ${
            f.evidence.length
              ? `<ul data-type="sg-evidence">${f.evidence.map(e => `<li><code>${sgEsc(e)}</code></li>`).join('')}</ul>`
              : '<p data-type="sg-evidence-none">Based on the absence of a record rather than on one.</p>'
          }
        </li>`,
          )
          .join('')
      : '<li data-level="info"><p data-type="sg-finding-head">Nothing to report.</p><p data-type="sg-finding-detail">All three resolvers agree, and none of the mail, certificate-authority or alias checks found anything worth saying.</p></li>'

    return `
      <section data-type="sg-card" aria-labelledby="sg-findings-h">
        <div data-group="sg-cardhead">
          <h2 id="sg-findings-h">Findings<span data-type="sg-count">${counts.error} error · ${counts.warn} warn · ${counts.info} note</span></h2>
          <div data-group="toolbar"><button data-copy="findings" type="button">Copy findings</button></div>
        </div>
        <ul data-type="sg-findings">${body}</ul>
      </section>`
  }

  private renderDiff(r: SgReport): string {
    const rows = r.diffs
      .map(d => {
        const failed = d.failed.length ? `<span data-type="sg-failed">${sgEsc(d.failed.join(', '))} unreachable</span>` : ''
        // Zero resolvers agreeing about nothing is not agreement. Say what
        // happened instead of rendering a verdict nobody earned.
        if (d.answered === 0) {
          return `<tr data-agree="0"><td><code>${sgEsc(d.type)}</code></td><td>no answer</td><td>${failed || 'no resolver replied'}</td></tr>`
        }
        if (d.agree) {
          const only = d.groups[0]
          const summary = only
            ? only.answer.records.length
              ? `${only.answer.records.length} record${only.answer.records.length === 1 ? '' : 's'}`
              : sgEsc(only.answer.rcode)
            : '—'
          return `<tr data-agree="1"><td><code>${sgEsc(d.type)}</code></td><td>agree</td><td>${summary} ${failed}</td></tr>`
        }
        const detail = d.groups
          .map(
            g =>
              `<div><strong>${sgEsc(g.resolvers.join(' + '))}</strong> → ${
                g.answer.records.length
                  ? g.answer.records.map(rec => `<code>${sgEsc(sgCanonicalRecord(rec, d.type))}</code>`).join(' ')
                  : `<code>${sgEsc(g.answer.rcode)}</code>`
              }</div>`,
          )
          .join('')
        return `<tr data-agree="0"><td><code>${sgEsc(d.type)}</code></td><td>${d.looksFiltered ? 'filtered' : 'differ'}</td><td>${detail} ${failed}</td></tr>`
      })
      .join('')

    return `
      <section data-type="sg-card" aria-labelledby="sg-diff-h">
        <div data-group="sg-cardhead">
          <h2 id="sg-diff-h">Resolver agreement</h2>
          <div data-group="toolbar"><button data-copy="dig" type="button">Copy dig commands</button></div>
        </div>
        <p data-type="sg-note">${r.resolvers.map(x => `<code>${sgEsc(x.label)}</code> ${sgEsc(x.operator)}`).join(' · ')}. TTL and record order are excluded from the comparison.</p>
        <div data-type="sg-scroll">
          <table data-type="sg-table">
            <thead><tr><th scope="col">Type</th><th scope="col">Verdict</th><th scope="col">Answer</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`
  }

  private renderRecords(r: SgReport): string {
    const rows = SG_TYPES.map(t => sgRecordRows((r.answers[t] ?? []).find(a => !a.error), t)).join('')
    return `
      <section data-type="sg-card" aria-labelledby="sg-records-h">
        <div data-group="sg-cardhead">
          <h2 id="sg-records-h">Records</h2>
          <div data-group="toolbar"><button data-copy="zone" type="button">Copy as zone file</button></div>
        </div>
        <div data-type="sg-scroll">
          <table data-type="sg-table">
            <thead><tr><th scope="col">Type</th><th scope="col">Value</th><th scope="col">TTL</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3">No records of any queried type.</td></tr>'}</tbody>
          </table>
        </div>
      </section>`
  }

  private renderMail(r: SgReport): string {
    const spf = r.spf
    const bar = Math.min(100, Math.round((spf.lookups / SG_SPF_LOOKUP_LIMIT) * 100))
    const terms = spf.terms.length
      ? `<ol data-type="sg-terms">${spf.terms
          .map(
            t =>
              `<li data-depth="${Math.min(t.depth, 4)}"><code>${sgEsc(t.raw)}</code> <span>in ${sgEsc(t.parent)}</span></li>`,
          )
          .join('')}</ol>`
      : ''

    const dmarcTags = Object.entries(r.dmarc.tags)
      .map(([k, v]) => `<li><code>${sgEsc(k)}</code> = <code>${sgEsc(v)}</code></li>`)
      .join('')

    const mx = r.mxTargets.length
      ? `<ul data-type="sg-mx">${r.mxTargets
          .map(
            t =>
              `<li><code>${t.preference} ${sgEsc(t.host)}</code> — ${
                t.isCname ? `<span data-bad="1">CNAME → ${sgEsc(t.cnameTo ?? '')}</span>` : t.resolves ? sgEsc(t.addresses.slice(0, 3).join(', ')) : '<span data-bad="1">no address</span>'
              }</li>`,
          )
          .join('')}</ul>`
      : '<p data-type="sg-note">No MX records.</p>'

    return `
      <section data-type="sg-card" aria-labelledby="sg-mail-h">
        <div data-group="sg-cardhead">
          <h2 id="sg-mail-h">Mail</h2>
          <div data-group="toolbar"><button data-copy="spf" type="button">Copy SPF record</button></div>
        </div>

        <h3>SPF</h3>
        ${spf.record ? `<p data-type="sg-record"><code>${sgEsc(spf.record)}</code></p>` : '<p data-type="sg-note">No <code>v=spf1</code> record.</p>'}
        ${
          spf.record
            ? `<p data-type="sg-meter" data-over="${spf.exceeded ? '1' : '0'}">
                 <span data-type="sg-meter-fill" style="width:${bar}%"></span>
                 <span data-type="sg-meter-label">${spf.lookups} of ${spf.limit} DNS lookups${spf.truncated ? ' (walk truncated)' : ''}</span>
               </p>${terms}`
            : ''
        }

        <h3>DMARC</h3>
        ${
          r.dmarc.record
            ? `<p data-type="sg-record"><code>${sgEsc(r.dmarc.record)}</code></p><ul data-type="sg-tags">${dmarcTags}</ul>`
            : `<p data-type="sg-note">No record at <code>_dmarc.${sgEsc(r.name)}</code>.</p>`
        }

        <h3>MX</h3>
        ${mx}
      </section>`
  }

  private renderCaa(r: SgReport): string {
    const c = r.caa
    const body = c.policyAt
      ? `<p data-type="sg-note">Policy found at <code>${sgEsc(c.policyAt)}</code> after checking ${r.caaWalked.map(w => `<code>${sgEsc(w)}</code>`).join(' → ')}.</p>
         <ul data-type="sg-tags">
           <li>Certificates: ${c.forbidsAll ? '<span data-bad="1">no CA may issue</span>' : c.allowed.length ? c.allowed.map(a => `<code>${sgEsc(a)}</code>`).join(', ') : 'any CA'}</li>
           <li>Wildcards: ${
             c.forbidsAllWild
               ? '<span data-bad="1">no CA may issue a wildcard</span>'
               : c.allowedWild.length
                 ? c.allowedWild.map(a => `<code>${sgEsc(a)}</code>`).join(', ')
                 : 'same as above (no <code>issuewild</code>)'
           }</li>
           ${c.unknownCritical.length ? `<li><span data-bad="1">critical tag no CA understands: ${sgEsc(c.unknownCritical.join(', '))}</span></li>` : ''}
         </ul>`
      : `<p data-type="sg-note">No CAA record at <code>${sgEsc(r.name)}</code> or any parent up to the registered domain, so any CA may issue.</p>`

    return `
      <section data-type="sg-card" aria-labelledby="sg-caa-h">
        <h2 id="sg-caa-h">Certificate authority policy (CAA)</h2>
        ${body}
      </section>`
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
      text = SG_TYPES.flatMap(t => {
        const a = (r.answers[t] ?? []).find(x => !x.error)
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
