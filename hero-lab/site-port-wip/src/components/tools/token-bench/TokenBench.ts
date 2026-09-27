/**
 * Token Bench — decode a JWT, and actually verify its signature.
 *
 * Verification against a pasted key is table stakes — several established tools
 * do it, and an earlier version of this comment wrongly claimed otherwise. What
 * they do not do is the step before it: resolve the right key out of a whole
 * JWKS by the token's `kid`, which is the fiddly half of the real debugging
 * loop. Everything runs on the browser's Web Crypto; no crypto is hand-rolled
 * here and no token or key leaves the tab.
 *
 * Two things it is deliberately strict about, because they are the two ways
 * people get JWTs wrong:
 *
 *   1. `alg: none`. A token with no signature is not a token that passed; it is
 *      an unsigned assertion. Accepting it was a real, widespread library
 *      vulnerability. Here it is reported as UNSIGNED and never as verified.
 *
 *   2. Trusting the header's `alg` to choose the verification algorithm. That is
 *      the algorithm-confusion attack: hand a server expecting RS256 a token
 *      signed HS256, using the RSA *public* key as the HMAC secret, and a
 *      verifier that reads `alg` from the token will happily confirm it — the
 *      attacker supplied both the message and the choice of how to check it.
 *      So the algorithm here is a control the user sets. It defaults to the
 *      header's value for convenience and warns whenever the two disagree,
 *      because in production the algorithm must come from your configuration,
 *      never from the token.
 *
 * All module-level names are tb-/TB_-prefixed: tool component files share one
 * global script scope. Mounts as a WebComponent so it survives Astro's
 * client-side View Transitions (see the astro:page-load wiring in the route).
 */

import {
  JWT_ALGS,
  checkTimeClaims,
  isJwtAlg,
  isUnsigned,
  parseJwt,
  verifyJwt,
  type JwtAlg,
  type ParsedJwt,
} from '../../../lib/jwt'
import { diagnoseVerification, inspectTokenText, type TbFinding } from './diagnose'

const TB_STORE = 'token-bench:v1'

/** Seconds-since-epoch claims, rendered as something a human can check. */
function tbFormatTime(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const ms = value * 1000
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  const delta = ms - Date.now()
  const abs = Math.abs(delta)
  const unit: [Intl.RelativeTimeFormatUnit, number] =
    abs < 60_000 ? ['second', 1000]
    : abs < 3_600_000 ? ['minute', 60_000]
    : abs < 86_400_000 ? ['hour', 3_600_000]
    : ['day', 86_400_000]
  const rel = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    .format(Math.round(delta / unit[1]), unit[0])
  return `${date.toISOString()} (${rel})`
}

class TokenBenchTool extends HTMLElement {
  private token = ''
  private keyText = ''
  private alg: JwtAlg = 'HS256'
  /** True while the user has not overridden the algorithm, so it can track the
   *  header as they paste different tokens. */
  private algFollowsHeader = true
  private parsed: ParsedJwt | null = null
  private parseError = ''
  /** Findings from the last failed verification. Null until one fails, and
   *  cleared whenever an input changes — a diagnosis belongs to one attempt. */
  private diagnosis: TbFinding[] | null = null
  private diagnosing = false

  connectedCallback() {
    this.restore()
    this.innerHTML = `
      <div data-type="tool-page" data-tool="token-bench">
        <div data-type="tb-header">
          <div data-type="tb-titlebar">
            <h1>Token Bench</h1>
            <span data-type="tb-badge">decode and verify</span>
          </div>
          <p>Paste a JWT to read it. Paste a key to find out whether it means anything.</p>
        </div>

        <div data-type="tb-grid">
          <label data-type="tb-field">
            <span>JWT</span>
            <textarea data-field="token" rows="6" spellcheck="false"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature"></textarea>
          </label>

          <ul data-type="tb-findings" data-where="shape" hidden></ul>

          <div data-type="tb-controls">
            <label data-type="tb-field">
              <span>Verify as</span>
              <select data-field="alg">
                ${JWT_ALGS.map(a => `<option value="${a}">${a}</option>`).join('')}
              </select>
            </label>
            <p data-type="tb-alg-note"></p>
          </div>

          <label data-type="tb-field">
            <span data-type="tb-key-label">Key</span>
            <textarea data-field="key" rows="6" spellcheck="false"
              placeholder='HMAC secret, or a JWK / JWKS as JSON'></textarea>
          </label>

          <div data-type="tb-actions">
            <button data-action="verify" type="button">Verify signature</button>
            <button data-action="sample" type="button">Load a sample</button>
            <button data-action="clear" type="button">Clear</button>
          </div>
        </div>

        <output data-type="tb-verdict" role="status" aria-live="polite"></output>

        <section data-type="tb-why" hidden>
          <h2>Why it did not verify</h2>
          <p data-type="tb-why-lede"></p>
          <ul data-type="tb-findings" data-where="why"></ul>
        </section>

        <div data-type="tb-panes">
          <section data-type="tb-pane">
            <h2>Header</h2>
            <pre data-type="tb-header-out"></pre>
          </section>
          <section data-type="tb-pane">
            <h2>Payload</h2>
            <pre data-type="tb-payload-out"></pre>
          </section>
        </div>

        <section data-type="tb-pane">
          <h2>Claims</h2>
          <table data-type="tb-claims"><tbody></tbody></table>
        </section>
      </div>
    `
    this.wire()
    this.render()
  }

  private restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(TB_STORE) ?? '{}')
      // The token and key are deliberately NOT restored: both are credentials,
      // and a debugging tool should not leave someone else's bearer token in
      // localStorage on a shared machine. Only the algorithm choice persists.
      if (typeof saved.alg === 'string' && isJwtAlg(saved.alg)) {
        this.alg = saved.alg as JwtAlg
        this.algFollowsHeader = saved.algFollowsHeader !== false
      }
    } catch {
      // Corrupt or unavailable storage is not a reason to fail to render.
    }
  }

  private persist() {
    try {
      localStorage.setItem(TB_STORE, JSON.stringify({ alg: this.alg, algFollowsHeader: this.algFollowsHeader }))
    } catch {
      // Private mode / quota. The tool works fine without persistence.
    }
  }

  private wire() {
    const tokenBox = this.querySelector('[data-field="token"]') as HTMLTextAreaElement
    const keyBox = this.querySelector('[data-field="key"]') as HTMLTextAreaElement
    const algBox = this.querySelector('[data-field="alg"]') as HTMLSelectElement

    tokenBox.addEventListener('input', () => {
      this.token = tokenBox.value
      this.reparse()
      this.render()
    })
    keyBox.addEventListener('input', () => {
      this.keyText = keyBox.value
      this.diagnosis = null
      this.renderFindings()
    })
    algBox.addEventListener('change', () => {
      this.alg = algBox.value as JwtAlg
      this.algFollowsHeader = false
      this.diagnosis = null
      this.persist()
      this.render()
    })

    this.querySelector('[data-action="verify"]')?.addEventListener('click', () => { void this.runVerify() })
    this.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
      this.token = ''
      this.keyText = ''
      this.parsed = null
      this.parseError = ''
      this.diagnosis = null
      tokenBox.value = ''
      keyBox.value = ''
      this.setVerdict('', '')
      this.render()
    })
    this.querySelector('[data-action="sample"]')?.addEventListener('click', () => {
      // RFC 7515 A.1 — the canonical HS256 example, with its key. Public test
      // data, so nothing here is a secret worth protecting.
      this.token = 'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9'
        + '.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ'
        + '.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
      this.keyText = JSON.stringify({
        kty: 'oct',
        k: 'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75'
          + 'aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow',
      }, null, 2)
      ;(this.querySelector('[data-field="token"]') as HTMLTextAreaElement).value = this.token
      ;(this.querySelector('[data-field="key"]') as HTMLTextAreaElement).value = this.keyText
      this.algFollowsHeader = true
      this.reparse()
      this.render()
    })
  }

  private reparse() {
    this.parseError = ''
    this.parsed = null
    this.diagnosis = null
    if (!this.token.trim()) return
    try {
      this.parsed = parseJwt(this.token)
    } catch (error) {
      this.parseError = error instanceof Error ? error.message : String(error)
      return
    }
    const headerAlg = this.parsed.header.alg
    if (this.algFollowsHeader && isJwtAlg(headerAlg)) {
      this.alg = headerAlg as JwtAlg
    }
  }

  private setVerdict(state: string, text: string) {
    const out = this.querySelector('[data-type="tb-verdict"]') as HTMLElement
    out.dataset.state = state
    // textContent, never innerHTML: every value on this screen came from a
    // token someone pasted, and a JWT payload is attacker-controlled by
    // definition — that is the whole reason you are inspecting it.
    out.textContent = text
  }

  private async runVerify() {
    this.diagnosis = null
    if (!this.parsed) {
      // The shape strip is already on screen saying what is wrong with the
      // paste, which is more use than repeating the parser's terse message.
      this.setVerdict('error', this.parseError || 'Paste a token first.')
      this.renderFindings()
      return
    }
    if (isUnsigned(this.parsed)) {
      this.setVerdict('bad', 'UNSIGNED — this token declares alg "none" and carries no signature. It proves nothing about who issued it.')
      this.renderFindings()
      return
    }
    try {
      const ok = await verifyJwt(this.parsed, this.alg, this.keyText)
      if (!ok) {
        await this.explainFailure(`Signature does NOT verify as ${this.alg} against this key.`)
        return
      }
      // Signature and expiry are reported separately and both are shown,
      // because "signed correctly" and "usable right now" are different
      // questions and merging them is how an expired token gets accepted.
      const time = checkTimeClaims(this.parsed.payload)
      const suffix = time.notes.length ? ` — but: ${time.notes.join(' ')}` : ''
      this.setVerdict(time.expired || time.notYetValid ? 'warn' : 'good',
        `Signature verifies as ${this.alg}.${suffix}`)
      this.renderFindings()
    } catch (error) {
      // A throw is a failure too, and it is the MOST interesting one: importing
      // an RSA public JWK as an HMAC secret throws, and that is precisely the
      // algorithm-confusion shape the diagnosis knows how to name.
      await this.explainFailure(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  /**
   * Say why. Only runs with a key present — with none, "does not verify" has an
   * obvious cause and a panel repeating the paste lint would be noise.
   */
  private async explainFailure(verdict: string, state = 'bad') {
    this.setVerdict(state, verdict)
    if (!this.keyText.trim()) {
      this.renderFindings()
      return
    }
    this.diagnosing = true
    this.renderFindings()
    try {
      this.diagnosis = await diagnoseVerification({
        rawToken: this.token,
        alg: this.alg,
        keyText: this.keyText,
      })
    } catch {
      // The diagnosis is a convenience on top of the verdict. If it fails, the
      // verdict above is still the answer and still correct.
      this.diagnosis = []
    }
    this.diagnosing = false
    this.renderFindings()
  }

  /** Replace the token in place, from a finding that carries a corrected one. */
  private applyFix(token: string) {
    this.token = token
    ;(this.querySelector('[data-field="token"]') as HTMLTextAreaElement).value = token
    this.reparse()
    this.render()
  }

  /**
   * Render the paste lint and the diagnosis. Built as DOM nodes with
   * textContent throughout: every string here is derived from a token or a key
   * someone pasted — kids and algorithm names are copied straight out of an
   * attacker-controlled header — so none of it may ever become markup.
   */
  private renderFindings() {
    const strip = this.querySelector('[data-type="tb-findings"][data-where="shape"]') as HTMLElement
    const why = this.querySelector('[data-type="tb-why"]') as HTMLElement
    const list = this.querySelector('[data-type="tb-findings"][data-where="why"]') as HTMLElement
    const lede = this.querySelector('[data-type="tb-why-lede"]') as HTMLElement

    const item = (finding: TbFinding) => {
      const li = document.createElement('li')
      li.dataset.proof = finding.proof
      const title = document.createElement('p')
      title.dataset.type = 'tb-finding-title'
      title.textContent = finding.title
      const detail = document.createElement('p')
      detail.dataset.type = 'tb-finding-detail'
      detail.textContent = finding.detail
      li.append(title, detail)
      if (finding.fixedToken) {
        const fix = document.createElement('button')
        fix.type = 'button'
        fix.dataset.action = 'apply-fix'
        fix.textContent = 'Use the corrected token'
        const corrected = finding.fixedToken
        fix.addEventListener('click', () => this.applyFix(corrected))
        li.append(fix)
      }
      return li
    }

    if (this.diagnosing) {
      why.hidden = false
      lede.textContent = 'Working through the causes…'
      list.replaceChildren()
      strip.hidden = true
      return
    }

    if (this.diagnosis) {
      why.hidden = false
      const proved = this.diagnosis.filter(f => f.proof === 'verified')
      lede.textContent = proved.length
        // Every proved cause was established by changing one thing and watching
        // the signature start verifying, so it can be stated flatly.
        ? 'Each cause below was confirmed by re-running the check with that one thing changed.'
        : this.diagnosis.length
          ? 'Nothing here made the signature verify. These are facts about the token worth knowing anyway.'
          // Refusing to guess is the feature. A tool whose job is to be honest
          // about the word "verified" cannot invent a reason it failed.
          : 'No cause found. The signature is simply not one this key produced — which usually means the key '
            + 'belongs to a different issuer, a different environment, or a different tenant.'
      list.replaceChildren(...this.diagnosis.map(item))
      strip.hidden = true
      return
    }

    why.hidden = true
    list.replaceChildren()
    // Before any verification, the paste lint stands on its own: "Bearer eyJ…"
    // parses into three segments and then reports invalid base64url, which
    // tells nobody anything.
    const shape = this.token.trim() ? inspectTokenText(this.token).findings : []
    strip.hidden = shape.length === 0
    strip.replaceChildren(...shape.map(item))
  }

  private render() {
    const headerOut = this.querySelector('[data-type="tb-header-out"]') as HTMLElement
    const payloadOut = this.querySelector('[data-type="tb-payload-out"]') as HTMLElement
    const claims = this.querySelector('[data-type="tb-claims"] tbody') as HTMLElement
    const algBox = this.querySelector('[data-field="alg"]') as HTMLSelectElement
    const algNote = this.querySelector('[data-type="tb-alg-note"]') as HTMLElement
    const keyLabel = this.querySelector('[data-type="tb-key-label"]') as HTMLElement

    algBox.value = this.alg
    keyLabel.textContent = this.alg.startsWith('HS') ? 'Key — HMAC secret, or an oct JWK' : 'Key — public key as JWK or JWKS'
    this.renderFindings()

    if (this.parseError) {
      headerOut.textContent = this.parseError
      payloadOut.textContent = ''
      claims.replaceChildren()
      algNote.textContent = ''
      return
    }
    if (!this.parsed) {
      headerOut.textContent = ''
      payloadOut.textContent = ''
      claims.replaceChildren()
      algNote.textContent = ''
      return
    }

    headerOut.textContent = JSON.stringify(this.parsed.header, null, 2)
    payloadOut.textContent = JSON.stringify(this.parsed.payload, null, 2)

    const headerAlg = this.parsed.header.alg
    if (headerAlg === 'none') {
      algNote.dataset.state = 'bad'
      algNote.textContent = 'This token says alg "none" — it is unsigned. Never accept one.'
    } else if (typeof headerAlg === 'string' && headerAlg !== this.alg) {
      algNote.dataset.state = 'warn'
      algNote.textContent = `The token says ${headerAlg}; verifying as ${this.alg}. In production the algorithm must come from your config, not the token.`
    } else {
      algNote.dataset.state = ''
      algNote.textContent = 'Taken from the token header. Set it explicitly to match what your server expects.'
    }

    // Claim table: the registered claims people actually check, in a readable
    // form, with timestamps resolved.
    const rows: Array<[string, string]> = []
    const labels: Record<string, string> = {
      iss: 'Issuer', sub: 'Subject', aud: 'Audience', jti: 'JWT ID',
      exp: 'Expires', nbf: 'Not before', iat: 'Issued at',
    }
    for (const [claim, label] of Object.entries(labels)) {
      const value = this.parsed.payload[claim]
      if (value === undefined) continue
      const asTime = tbFormatTime(value)
      rows.push([`${label} (${claim})`, asTime ?? (typeof value === 'string' ? value : JSON.stringify(value))])
    }
    const time = checkTimeClaims(this.parsed.payload)
    for (const note of time.notes) rows.push(['Status', note])

    claims.replaceChildren(...rows.map(([key, value]) => {
      const tr = document.createElement('tr')
      const th = document.createElement('th')
      th.textContent = key
      const td = document.createElement('td')
      td.textContent = value
      tr.append(th, td)
      return tr
    }))
  }
}

if (!customElements.get('token-bench-tool')) {
  customElements.define('token-bench-tool', TokenBenchTool)
}
