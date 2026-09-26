/**
 * DNS Sightline — the results, as HTML, from one inspection.
 *
 * Pure functions of the report, with no DOM, so `security:smoke` can render the
 * same markup the page shows from a REAL inspection over a stubbed resolver and
 * hold what the panels say to what the findings say. That is why this file
 * exists apart from the component. A panel's "No MX records." is as much a
 * claim about somebody's zone as a finding is, and it once sat beside
 * `mx-inconclusive` — the panel decided absence from whether a resolver had
 * *replied*, the finding from whether it had *answered*, and a SERVFAIL is the
 * one thing that is the first and not the second. Every branch below that says
 * a record is absent reads the field its finding reads.
 *
 * The report type is imported as a type only: it is erased at build, so none
 * of the resolver code in `./inspect` reaches the page.
 */
import { escapeHtml as sgEsc } from '../../../lib/escape'
import {
  SG_SPF_LOOKUP_LIMIT,
  SG_TYPES,
  sgCanonicalRecord,
  sgCountByLevel,
  sgPickAnswer,
  type SgAnswer,
  type SgType,
} from './analyze'
import type { SgInspection } from './inspect'

const SG_LEVEL_LABEL: Record<string, string> = { error: 'error', warn: 'warn', info: 'note' }

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

/**
 * The resolvers that did not answer, and what each said instead — grouped, so
 * three identical SERVFAILs read as one line. It used to print every such
 * resolver as "unreachable", which a resolver that replied SERVFAIL is not.
 */
function sgFailedNote(failed: SgAnswer[]): string {
  if (!failed.length) return ''
  const byWhy = new Map<string, string[]>()
  for (const a of failed) {
    const why = a.error ?? a.rcode
    byWhy.set(why, [...(byWhy.get(why) ?? []), a.resolver])
  }
  return `<span data-type="sg-failed">${[...byWhy].map(([why, who]) => `${sgEsc(who.join(', '))}: ${sgEsc(why)}`).join(' · ')}</span>`
}

export function sgRenderFindings(r: SgInspection): string {
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
              : f.basis === 'unanswered'
                ? '<p data-type="sg-evidence-none">Based on a lookup that got no answer.</p>'
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

export function sgRenderDiff(r: SgInspection): string {
  const rows = r.diffs
    .map(d => {
      const failed = sgFailedNote(d.failed)
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
        <div data-type="sg-scroll" tabindex="0" role="region" aria-label="Resolver agreement table">
          <table data-type="sg-table">
            <thead><tr><th scope="col">Type</th><th scope="col">Verdict</th><th scope="col">Answer</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`
}

/** The table shows the answer the findings were drawn from — the same pick. */
export function sgRenderRecords(r: SgInspection): string {
  const rows = SG_TYPES.map(t => sgRecordRows(sgPickAnswer(r.answers[t] ?? [], r.analysedBy), t)).join('')
  return `
      <section data-type="sg-card" aria-labelledby="sg-records-h">
        <div data-group="sg-cardhead">
          <h2 id="sg-records-h">Records</h2>
          <div data-group="toolbar"><button data-copy="zone" type="button">Copy as zone file</button></div>
        </div>
        <div data-type="sg-scroll" tabindex="0" role="region" aria-label="Records table">
          <table data-type="sg-table">
            <thead><tr><th scope="col">Type</th><th scope="col">Value</th><th scope="col">TTL</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3">No records of any queried type.</td></tr>'}</tbody>
          </table>
        </div>
      </section>`
}

/** The MX half of the Mail panel, off `mxStatus` — the value `sgMxFindings` switched on. */
function sgMxSection(r: SgInspection): string {
  if (r.mxStatus === 'unanswered') {
    return '<p data-type="sg-note">The MX lookup got no answer, so the mail servers could not be read.</p>'
  }
  if (r.mxStatus === 'none') return '<p data-type="sg-note">No MX records.</p>'
  if (r.mxStatus === 'null') return '<p data-type="sg-note">A null MX (<code>0 .</code>): this domain accepts no mail.</p>'
  if (!r.mxTargets.length) return '<p data-type="sg-note">The MX records name no host this tool can read.</p>'
  return `<ul data-type="sg-mx">${r.mxTargets
    .map(
      t =>
        `<li><code>${t.preference} ${sgEsc(t.host)}</code> — ${
          t.isCname
            ? `<span data-bad="1">CNAME → ${sgEsc(t.cnameTo ?? '')}</span>`
            : t.resolves
              ? sgEsc(t.addresses.slice(0, 3).join(', '))
              : t.unanswered ? 'no answer to the address lookup' : '<span data-bad="1">no address</span>'
        }</li>`,
    )
    .join('')}</ul>`
}

export function sgRenderMail(r: SgInspection): string {
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

  return `
      <section data-type="sg-card" aria-labelledby="sg-mail-h">
        <div data-group="sg-cardhead">
          <h2 id="sg-mail-h">Mail</h2>
          <div data-group="toolbar"><button data-copy="spf" type="button">Copy SPF record</button></div>
        </div>

        <h3>SPF</h3>
        ${
          spf.record
            ? `<p data-type="sg-record"><code>${sgEsc(spf.record)}</code></p>`
            : spf.unanswered.length
              ? '<p data-type="sg-note">The TXT lookup got no answer, so the SPF record could not be read.</p>'
              : '<p data-type="sg-note">No <code>v=spf1</code> record.</p>'
        }
        ${
          spf.record
            ? `<p data-type="sg-meter" data-over="${spf.exceeded ? '1' : '0'}">
                 <span data-type="sg-meter-fill" style="width:${bar}%"></span>
                 <span data-type="sg-meter-label">${spf.truncated ? 'At least ' : ''}${spf.lookups} of ${spf.limit} DNS lookups${spf.truncated ? ' — the walk stopped before the end' : ''}</span>
               </p>${terms}`
            : ''
        }

        <h3>DMARC</h3>
        ${
          r.dmarc.record
            ? `<p data-type="sg-record"><code>${sgEsc(r.dmarc.record)}</code></p><ul data-type="sg-tags">${dmarcTags}</ul>`
            : r.dmarc.unanswered
              ? `<p data-type="sg-note">The lookup for <code>_dmarc.${sgEsc(r.name)}</code> got no answer, so the DMARC record could not be read.</p>`
              : `<p data-type="sg-note">No record at <code>_dmarc.${sgEsc(r.name)}</code>.</p>`
        }

        <h3>MX</h3>
        ${sgMxSection(r)}
      </section>`
}

export function sgRenderCaa(r: SgInspection): string {
  const c = r.caa
  const walked = r.caaWalked.map(w => `<code>${sgEsc(w)}</code>`).join(' → ')
  // The panel reads `incomplete` BEFORE `policyAt`, for the same reason the
  // findings do: an unanswered lookup below the policy means it may not be
  // the one that governs, and an unanswered walk that found nothing means
  // "unknown", never "any CA may issue". Without this the panel printed that
  // sentence directly under the finding that said the lookup had failed.
  const caveat = c.incomplete
    ? c.policyAt
      ? `<p data-type="sg-note">A policy is published at <code>${sgEsc(c.policyAt)}</code>, but a CAA lookup for a more specific name on the way there got no answer (checked ${walked}). A record at that name would take precedence, so this is not known to be the policy that governs <code>${sgEsc(r.name)}</code>.</p>`
      : `<p data-type="sg-note">At least one CAA lookup got no answer (checked ${walked}), so whether any policy governs <code>${sgEsc(r.name)}</code> is unknown — which is not the same as knowing that none does.</p>`
    : ''
  const body = c.policyAt
    ? `${caveat || `<p data-type="sg-note">Policy found at <code>${sgEsc(c.policyAt)}</code> after checking ${walked}.</p>`}
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
    : caveat || `<p data-type="sg-note">No CAA record at <code>${sgEsc(r.name)}</code> or any parent up to the registered domain, so any CA may issue.</p>`

  // The other half of this question is on the wire, not in DNS: a CAA record
  // says who MAY issue, and only a handshake says who actually DID. Chainsaw
  // reads that, so the policy panel offers the handoff rather than leaving the
  // visitor to notice the two tools are about the same outage. The CA the
  // visitor picked rides across as the `?host=` companion it is — Chainsaw
  // identifies the issuer itself and will name it back.
  const cross = `
      <div data-group="toolbar">
        <a data-type="sg-crosslink" href="/tools/chainsaw?host=${encodeURIComponent(r.name)}">Check the certificate on the wire →</a>
      </div>`

  return `
      <section data-type="sg-card" aria-labelledby="sg-caa-h">
        <div data-group="sg-cardhead">
          <h2 id="sg-caa-h">Certificate authority policy (CAA)</h2>
          ${cross}
        </div>
        ${body}
        <p data-type="sg-hint">A CAA record is a rule about future issuance, and it is only ever consulted in the hours before a CA signs — so it says nothing about the certificate a server is serving right now. Chainsaw reads that certificate and names the CA that actually issued it, which is the fact this panel cannot supply and the one that tells you whether the next renewal goes through.</p>
      </section>`
}

/** Every panel, in page order — what the component sets as the results region. */
export function sgRenderResults(r: SgInspection): string {
  return [sgRenderFindings(r), sgRenderDiff(r), sgRenderRecords(r), sgRenderMail(r), sgRenderCaa(r)].join('')
}
