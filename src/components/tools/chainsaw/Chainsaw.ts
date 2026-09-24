/**
 * Chainsaw — look at the TLS certificate chain a host really serves.
 *
 * The third server-backed tool (Webhook Inspector, then Link Peek): the ORIGIN
 * opens the TLS connection, because no API in a browser will hand a page the
 * certificates off a handshake — the browser checks them, decides, and throws
 * the answer away. The component renders what came back and resolves every
 * verdict through the SAME shared module (`./analyze`) the assertions run
 * against, so the page and the smoke test cannot disagree about a finding.
 *
 * Mounts as a WebComponent so it survives Astro's View Transitions (see the
 * astro:page-load wiring in tools/[slug].astro). All module-level names are
 * cs-/CS_-prefixed because tool component files share one script namespace —
 * `cw`/`CW_` is Cron Whisperer's and `lp`/`LP_` is Link Peek's.
 */
import { escapeHtml as csEsc } from '../../../lib/escape'
import { flashLabel } from '../../../lib/flash'
import {
  CS_ALLOWED_PORTS,
  csChainLinks,
  csChainState,
  csDaysLeft,
  csFindings,
  csHostnameVerdict,
  csMatchHost,
  csNameMatches,
  csOpensslCommand,
  csChainPem,
  csServeChainPem,
  csTrustVerdict,
  csValidityVerdict,
  type CsCert,
  type CsFinding,
  type CsReport,
} from './analyze'

const CS_LS_TARGET = 'chainsaw:target:v1'
const CS_LEVEL_LABEL: Record<string, string> = { error: 'error', warn: 'warn', info: 'note' }

interface CsResponse {
  ok: boolean
  error?: string
  report?: CsReport
}

function csRole(index: number, total: number, cert: CsCert): string {
  if (index === 0) return 'leaf'
  if (cert.selfSigned) return 'root'
  return total > 2 && index === total - 1 ? 'intermediate (top)' : 'intermediate'
}

function csKeyLabel(cert: CsCert): string {
  if (!cert.keyType) return 'unknown'
  if (cert.keyType === 'ec') return `EC ${cert.keyCurve ?? ''}`.trim()
  if (cert.keyType === 'rsa') return `RSA ${cert.keyBits ?? '?'}-bit`
  return cert.keyBits ? `${cert.keyType.toUpperCase()} ${cert.keyBits}-bit` : cert.keyType.toUpperCase()
}

function csDayLabel(days: number): string {
  if (!Number.isFinite(days)) return 'unknown'
  if (days < 0) return `expired ${Math.abs(Math.floor(days))}d ago`
  return `${Math.floor(days)}d left`
}

class ChainsawTool extends HTMLElement {
  private root!: HTMLElement
  private targetInput!: HTMLInputElement
  private runButton!: HTMLButtonElement
  private statusEl!: HTMLElement
  private resultsEl!: HTMLElement
  private inflight: AbortController | null = null
  private report: CsReport | null = null

  connectedCallback() {
    this.innerHTML = `
      <div data-type="tool-page" data-tool="chainsaw">
        <div data-type="tool-header">
          <h1>Chainsaw</h1>
          <p>Dial a host, saw its TLS chain open, and read what it actually serves — not what your browser quietly repaired on its way to showing you a padlock. The headline question is the one that produces "works in my browser, fails from curl": <strong>does the server send its intermediates?</strong> Trust, hostname coverage and the expiry date are kept as three separate answers, because collapsing them into one badge hides which of the three broke.</p>
        </div>

        <section data-type="cs-card" data-card="input" aria-labelledby="cs-input-h">
          <h2 id="cs-input-h">Host to inspect</h2>
          <div data-group="cs-row">
            <input data-input="target" type="text" inputmode="url" spellcheck="false" autocomplete="off"
              placeholder="example.com   ·   example.com:8443   ·   https://example.com/page"
              aria-label="Hostname, optionally with a port" aria-keyshortcuts="Enter" />
            <button data-action="inspect" type="button">Inspect</button>
          </div>
          <span data-type="cs-status" role="status" aria-live="polite"></span>
          <p data-type="cs-hint">One TLS handshake, from this site's server, to the host you name. Public hosts only — private and internal addresses are refused — on the ports that speak TLS the moment the socket opens (${CS_ALLOWED_PORTS.join(', ')}). Nothing is stored, and no request is ever made past the handshake.</p>
        </section>

        <div data-for="results" role="region" aria-label="Certificate results"></div>

        <details data-type="cs-explainer">
          <summary>Why a browser padlock does not mean your chain is right</summary>
          <p>A server is supposed to send its own certificate <em>and</em> every intermediate certificate between it and a root your client already trusts. The root itself it should not send — you have it already.</p>
          <p>When a server forgets the intermediate, browsers usually hide the mistake. Chrome and Safari cache intermediates they have met before, and both will quietly go and fetch a missing one from the <code>caIssuers</code> URL inside the certificate. So the padlock appears, the site looks fine, and the misconfiguration is invisible — until something that does none of that arrives: <strong>curl, OpenSSL, Go, Java, Python and most mobile SDKs simply fail</strong>. That is the whole anatomy of "it works in my browser but the API client gets a TLS error", and it is why this tool asks what the server <em>sent</em> rather than what a client managed to assemble.</p>
          <p>Reading the sent chain takes some care, which is worth knowing about if you are checking this yourself: ask a normal TLS client what certificates it saw and it will tell you about the chain it <em>built</em>, root and all, including the parts it supplied from its own trust store. Chainsaw makes a second handshake that trusts nothing at all, so what comes back can only be what the server put on the wire.</p>
          <p>Two more things this looks at that dashboards routinely miss. The date your site stops working is the <strong>earliest</strong> expiry in the chain, which is not always the leaf — an intermediate can go first, and monitoring that watches only the leaf will not see it coming. And the hostname has to be in a <code>subjectAltName</code> entry: the Common Name has been ignored by every browser and every modern TLS library since 2017, so a certificate with the name only in its CN does not cover that name at all.</p>
        </details>
      </div>
    `

    this.root = this.querySelector('[data-type="tool-page"]') as HTMLElement
    this.targetInput = this.root.querySelector('[data-input="target"]') as HTMLInputElement
    this.runButton = this.root.querySelector('[data-action="inspect"]') as HTMLButtonElement
    this.statusEl = this.root.querySelector('[data-type="cs-status"]') as HTMLElement
    this.resultsEl = this.root.querySelector('[data-for="results"]') as HTMLElement

    // A result is worth sending to whoever owns the server, so the target rides
    // in the URL. Read back through the same validation the server applies —
    // a hand-edited ?host must cost the prefill, never the page.
    let deepLinked = ''
    try {
      const fromUrl = new URLSearchParams(location.search).get('host') ?? ''
      if (fromUrl && fromUrl.length <= 280) deepLinked = fromUrl
    } catch { /* no URL access in some embedded contexts */ }
    if (deepLinked) {
      this.targetInput.value = deepLinked
    } else {
      try {
        const saved = localStorage.getItem(CS_LS_TARGET)
        if (saved) this.targetInput.value = saved
      } catch { /* private mode */ }
    }

    this.runButton.addEventListener('click', () => void this.inspect())
    this.targetInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void this.inspect()
      }
    })
    this.root.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void this.inspect()
      }
    })
    this.resultsEl.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('[data-copy]') as HTMLButtonElement | null
      if (!btn) return
      this.copyFor(btn.dataset.copy ?? '', btn)
    })
    this.resultsEl.addEventListener('input', e => {
      const field = e.target as HTMLElement
      if (field?.matches('[data-input="testname"]')) this.testName((field as HTMLInputElement).value)
    })

    if (deepLinked) void this.inspect()
  }

  disconnectedCallback() {
    this.inflight?.abort()
  }

  private copyFor(what: string, btn: HTMLButtonElement) {
    const report = this.report
    if (!report) return
    let text = ''
    if (what === 'leaf') text = report.presented[0]?.pem ?? ''
    else if (what === 'chain') text = csChainPem(report.presented)
    else if (what === 'serve') text = csServeChainPem(report.presented)
    else if (what === 'openssl') text = csOpensslCommand(report.host, report.port)
    else if (what === 'link') text = this.shareLink(report)
    else if (what === 'value') text = btn.dataset.value ?? ''
    if (!text) return
    navigator.clipboard?.writeText(text).then(
      () => flashLabel(btn, 'Copied'),
      () => flashLabel(btn, 'Copy failed'),
    )
  }

  private shareLink(report: CsReport): string {
    const target = report.port === 443 ? report.host : `${report.host}:${report.port}`
    try {
      const url = new URL(location.href)
      url.search = `?host=${encodeURIComponent(target)}`
      url.hash = ''
      return url.href
    } catch {
      return `/tools/chainsaw?host=${encodeURIComponent(target)}`
    }
  }

  private setStatus(text: string) {
    this.statusEl.textContent = text
  }

  private async inspect() {
    const raw = this.targetInput.value.trim()
    if (!raw) {
      this.setStatus('Enter a hostname first.')
      return
    }
    try { localStorage.setItem(CS_LS_TARGET, raw) } catch { /* private mode */ }

    this.inflight?.abort()
    const controller = new AbortController()
    this.inflight = controller
    this.runButton.disabled = true
    this.setStatus('Opening a TLS connection…')
    this.resultsEl.innerHTML = ''
    this.report = null

    let data: CsResponse
    try {
      const res = await fetch(`/api/tools/chainsaw?target=${encodeURIComponent(raw)}`, { signal: controller.signal })
      data = await res.json() as CsResponse
      if (res.status === 429) {
        this.setStatus('Rate limited — each check opens real TLS connections, so give it a minute.')
        return
      }
    } catch {
      if (controller.signal.aborted) return
      this.setStatus('The request failed — check your connection and try again.')
      return
    } finally {
      if (this.inflight === controller) this.runButton.disabled = false
    }
    if (controller.signal.aborted) return

    if (!data.ok || !data.report) {
      this.setStatus(data.error ?? 'That host could not be inspected.')
      return
    }

    this.setStatus('')
    this.report = data.report
    this.render(data.report)

    // Mirror the target into the URL so the result can be sent to whoever owns
    // the server. Pinned to the path it was scheduled on and wrapped, because
    // Safari rate-limits replaceState and throws past the limit.
    try {
      const path = location.pathname
      if (path.endsWith('/chainsaw')) {
        const target = data.report.port === 443 ? data.report.host : `${data.report.host}:${data.report.port}`
        history.replaceState(null, '', `${path}?host=${encodeURIComponent(target)}`)
      }
    } catch { /* not worth failing a render over */ }
  }

  /* ---------------------------------------------------------------- */
  /* rendering                                                         */
  /* ---------------------------------------------------------------- */

  private render(report: CsReport) {
    const now = Date.now()
    const leaf = report.presented[0]
    if (!leaf) {
      this.setStatus('The host answered, but presented no certificate this tool could read.')
      return
    }
    const match = csMatchHost(report.host, leaf)
    const findings = csFindings(report, now)
    const chain = csChainState(report)

    this.resultsEl.innerHTML = `
      ${this.renderVerdicts(report, match, now)}
      ${this.renderHandshake(report, chain.detail)}
      ${this.renderFindings(findings)}
      ${this.renderChain(report)}
      ${this.renderNames(match)}
      ${this.renderExport(chain.state)}
    `
  }

  private renderVerdicts(report: CsReport, match: ReturnType<typeof csMatchHost>, now: number): string {
    const tiles = [
      { key: 'trust', title: 'Chain trust', v: csTrustVerdict(report) },
      { key: 'hostname', title: 'Hostname', v: csHostnameVerdict(report, match) },
      { key: 'validity', title: 'Validity', v: csValidityVerdict(report, now) },
    ]
    return `
      <section data-type="cs-card" data-card="verdicts" aria-labelledby="cs-verdicts-h">
        <h2 id="cs-verdicts-h">Three separate answers</h2>
        <div data-group="cs-verdicts">
          ${tiles.map(t => `
            <div data-type="cs-verdict" data-ok="${t.v.ok ? '1' : '0'}">
              <p data-type="cs-verdict-title">${csEsc(t.title)}</p>
              <p data-type="cs-verdict-label">${csEsc(t.v.label)}</p>
              <p data-type="cs-verdict-detail">${csEsc(t.v.detail)}</p>
            </div>`).join('')}
        </div>
        <p data-type="cs-hint">Kept apart on purpose: a perfectly chained certificate that expired yesterday is not a hostname problem, and a valid certificate for the wrong name is not an expiry problem. One combined badge would hide which.</p>
      </section>`
  }

  private renderHandshake(report: CsReport, chainDetail: string): string {
    const h = report.handshake
    const rows: [string, string][] = [
      ['Chain sent', `${report.presented.length} certificate${report.presented.length === 1 ? '' : 's'}${report.presentedObserved ? '' : ' (as built locally — the no-trust probe did not complete)'}`],
      ['Protocol', h.protocol ?? 'unknown'],
      ['Cipher', h.cipherStandard ? `${h.cipherStandard}${h.cipher && h.cipher !== h.cipherStandard ? ` (${h.cipher})` : ''}` : h.cipher ?? 'unknown'],
      ['Key exchange', h.ephemeralKey ?? 'not reported'],
      ['ALPN', h.alpn ?? 'not negotiated'],
      ['OCSP stapling', h.ocspStapled ? 'yes' : 'no'],
      ['Trust anchor', report.namedRoot ?? report.storeRoot?.subjectCN ?? (h.authorized ? 'a root in the public store' : 'none reached')],
      ['Address dialled', `${report.address} (IPv${report.family}) port ${report.port}`],
    ]
    return `
      <section data-type="cs-card" data-card="handshake" aria-labelledby="cs-hs-h">
        <div data-group="cs-cardhead">
          <h2 id="cs-hs-h">The handshake</h2>
          <div data-group="toolbar">
            <button data-copy="link" type="button">Copy link to this result</button>
          </div>
        </div>
        <dl data-type="cs-facts">
          ${rows.map(([k, v]) => `<div><dt>${csEsc(k)}</dt><dd>${csEsc(v)}</dd></div>`).join('')}
        </dl>
        <p data-type="cs-hint">${csEsc(chainDetail)}</p>
      </section>`
  }

  private renderFindings(findings: CsFinding[]): string {
    return `
      <section data-type="cs-card" data-card="findings" aria-labelledby="cs-find-h">
        <h2 id="cs-find-h">Findings ${findings.length ? `<span data-type="cs-count">${findings.length}</span>` : ''}</h2>
        ${findings.length
          ? `<ul data-type="cs-findings">${findings.map(f => `<li data-level="${csEsc(f.level)}"><span data-type="cs-level">${csEsc(CS_LEVEL_LABEL[f.level] ?? f.level)}</span> ${csEsc(f.message)}</li>`).join('')}</ul>`
          : '<p data-type="cs-hint" data-ok="1">Nothing to flag. The chain is complete and carries no anchor, the names cover this host, the dates are comfortable, and the handshake is modern.</p>'}
      </section>`
  }

  private renderChain(report: CsReport): string {
    const now = Date.now()
    const links = csChainLinks(report.presented)
    const total = report.presented.length
    const cards = report.presented.map((cert, i) => {
      const days = csDaysLeft(cert.validTo, now)
      const link = i > 0 ? links[i - 1] : null
      const joint = link
        ? `<p data-type="cs-joint" data-linked="${link.linked ? '1' : '0'}">${link.linked ? 'issued by ↓' : 'does NOT name the certificate below as its issuer ↓'}</p>`
        : ''
      // The joint line lives INSIDE the <li>: an <ol> may contain only <li>,
      // and a stray <p> between items is markup the parser moves elsewhere.
      return `
        <li data-type="cs-cert" data-role="${csEsc(csRole(i, total, cert))}">
          ${joint}
          <div data-group="cs-certhead">
            <p data-type="cs-certname">${csEsc(cert.subjectCN ?? cert.subject.replace(/\n/g, ', '))}</p>
            <span data-type="cs-badge">${csEsc(csRole(i, total, cert))}</span>
            <span data-type="cs-badge" data-expiry="${days < 0 ? 'gone' : days < 30 ? 'near' : 'ok'}">${csEsc(csDayLabel(days))}</span>
          </div>
          <dl data-type="cs-facts">
            <div><dt>Issuer</dt><dd>${csEsc(cert.issuerCN ?? cert.issuer.replace(/\n/g, ', '))}</dd></div>
            ${cert.subjectO ? `<div><dt>Organisation</dt><dd>${csEsc(cert.subjectO)}</dd></div>` : ''}
            <div><dt>Valid</dt><dd>${csEsc(cert.validFrom.slice(0, 10))} → ${csEsc(cert.validTo.slice(0, 10))}</dd></div>
            <div><dt>Key</dt><dd>${csEsc(csKeyLabel(cert))}</dd></div>
            <div><dt>Signature</dt><dd>${csEsc(cert.sigAlg ?? 'unreadable')}</dd></div>
            <div><dt>Serial</dt><dd>${csEsc(cert.serial)}</dd></div>
            <div><dt>SHA-256</dt><dd>${csEsc(cert.fingerprint256)}</dd></div>
            ${cert.eku.length ? `<div><dt>Usage</dt><dd>${csEsc(cert.eku.join(', '))}</dd></div>` : ''}
            ${cert.caIssuerUrls.length ? `<div><dt>Issuer URL</dt><dd>${csEsc(cert.caIssuerUrls[0])}</dd></div>` : ''}
          </dl>
        </li>`
    }).join('')

    const storeNote = report.storeRoot
      ? `<p data-type="cs-hint">Your trust store completed the path with <strong>${csEsc(report.storeRoot.subjectCN ?? report.storeRoot.subject.replace(/\n/g, ', '))}</strong>, which the server correctly does not send.</p>`
      : ''

    return `
      <section data-type="cs-card" data-card="chain" aria-labelledby="cs-chain-h">
        <h2 id="cs-chain-h">What the server sent</h2>
        <ol data-type="cs-chain">${cards}</ol>
        ${storeNote}
        <p data-type="cs-hint">Chainsaw reports the certificates that link up from the leaf. It deliberately says nothing about the ORDER they arrived in, or about an unrelated certificate the server might also have sent: neither is observable through this API, and a guess would be worse than a silence.</p>
      </section>`
  }

  private renderNames(match: ReturnType<typeof csMatchHost>): string {
    const names = [...match.dnsNames.map(n => `DNS:${n}`), ...match.ipNames.map(n => `IP:${n}`)]
    return `
      <section data-type="cs-card" data-card="names" aria-labelledby="cs-names-h">
        <h2 id="cs-names-h">Names this certificate covers <span data-type="cs-count">${names.length}</span></h2>
        <ul data-type="cs-names">${names.length
          ? names.map(n => `<li${match.matched === n.replace(/^IP:/, 'IP Address:') || match.matched === n ? ' data-matched="1"' : ''}>${csEsc(n)}</li>`).join('')
          : '<li><em>no subjectAltName entries at all — this certificate covers nothing, whatever its Common Name says</em></li>'}</ul>
        <div data-group="cs-row">
          <input data-input="testname" type="text" spellcheck="false" autocomplete="off"
            placeholder="try another hostname against these names" aria-label="Test a hostname against this certificate's names" />
        </div>
        <p data-type="cs-nametest" role="status" aria-live="polite">Wildcards cover exactly one label: <code>*.example.com</code> covers <code>www.example.com</code>, but not <code>example.com</code> and not <code>a.b.example.com</code>.</p>
      </section>`
  }

  private renderExport(state: string): string {
    const incomplete = state === 'leaf-only' || state === 'incomplete'
    return `
      <section data-type="cs-card" data-card="export" aria-labelledby="cs-export-h">
        <h2 id="cs-export-h">Take it away</h2>
        <div data-group="toolbar">
          <button data-copy="leaf" type="button">Copy leaf PEM</button>
          <button data-copy="chain" type="button">Copy chain as sent</button>
          <button data-copy="serve" type="button"${incomplete ? ' disabled' : ''}>Copy the chain to serve</button>
          <button data-copy="openssl" type="button">Copy openssl command</button>
        </div>
        <p data-type="cs-hint">${incomplete
          ? 'The chain to serve cannot be assembled here: the certificate that is missing is, by definition, not one the server sent. Fetch it from the issuer URL above, append it after the leaf, and reload — then re-run this check.'
          : 'The chain to serve is the leaf followed by every intermediate, with no root — exactly what belongs in <code>fullchain.pem</code>, <code>ssl_certificate</code> or an ALB certificate body.'}</p>
      </section>`
  }

  /** Live wildcard matcher against the SANs actually on the certificate. */
  private testName(value: string) {
    const out = this.resultsEl.querySelector('[data-type="cs-nametest"]') as HTMLElement | null
    const report = this.report
    if (!out || !report || !report.presented[0]) return
    const host = value.trim()
    if (!host) {
      out.textContent = 'Wildcards cover exactly one label: *.example.com covers www.example.com, but not example.com and not a.b.example.com.'
      out.removeAttribute('data-ok')
      return
    }
    const verdict = csMatchHost(host, report.presented[0])
    if (verdict.covered) {
      out.textContent = `${host} is covered — by ${verdict.matched}${verdict.viaWildcard ? ', a wildcard' : ''}.`
      out.setAttribute('data-ok', '1')
      return
    }
    const nearMiss = verdict.dnsNames.find(n => n.startsWith('*.') && !csNameMatches(n, host).match && host.endsWith(n.slice(1)))
    out.textContent = nearMiss
      ? `${host} is NOT covered. ${nearMiss} looks close, but a wildcard stands for exactly one label — it cannot stretch over ${host}.`
      : `${host} is NOT covered by anything on this certificate.`
    out.setAttribute('data-ok', '0')
  }
}

if (!customElements.get('chainsaw-tool')) {
  customElements.define('chainsaw-tool', ChainsawTool)
}
