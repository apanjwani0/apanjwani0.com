/**
 * DNS Sightline — what the answers MEAN.
 *
 * The transport (`src/lib/dns-doh.ts`) asks several public resolvers the same
 * questions and hands back what each one said. Everything that is a *claim* —
 * do these resolvers actually disagree, does this SPF record blow the ten-term
 * budget, will this CAA record stop your CA renewing, is that MX pointing at a
 * CNAME — lives here, in a module with no Node imports, so `security:smoke` can
 * run it against fixture zones rather than against a screenshot of a rendered
 * page (AGENTS.md: "a tool's claims live in a module, not in the component").
 * The browser bundle and the server share this one copy.
 *
 * Every function in this file is deterministic and takes its DNS answers as
 * DATA. Nothing here resolves anything; the recursive parts (SPF, CAA, MX
 * targets) take a `lookup` callback, which is what lets the assertions drive
 * them over a hand-built zone with no network at all — and which is also how
 * the SPF walker can be proved to stop.
 *
 * ── The organising rule ───────────────────────────────────────────────────
 * **Every finding cites the record it rests on.** A DNS checker's whole product
 * is being believed, and the failure mode is not a crash: it is a confident
 * sentence about a zone that is fine. So `SgFinding.evidence` carries the
 * literal record strings the finding was derived from, `basis: 'absence'` marks
 * the findings that are *about* a record not existing (the only ones allowed to
 * cite nothing), and `security:smoke` asserts that pairing on every producer —
 * not just on the ones the rule was written for.
 *
 * All module-level names are sg-/SG_-prefixed because tool component files
 * share one script namespace (`cs` is Chainsaw's, `lp` is Link Peek's, `sl` is
 * Sand Loom's).
 */
import {
  CA_REGISTRY,
  caaAllows,
  caaVerdict,
  parseCaa,
  type CaaEntry,
  type CaaVerdict,
} from '../../../lib/caa'
import { canonicalIp } from '../../../lib/ip'
import type { SgAnswer, SgLookup, SgRecord, SgType } from '../../../lib/dns-types'

/* ------------------------------------------------------------------ */
/* shapes                                                              */
/* ------------------------------------------------------------------ */

export type { SgType, SgRecord, SgAnswer, SgLookup } from '../../../lib/dns-types'

/** The types the hub queries on every resolver. Order is display order. */
export const SG_TYPES: readonly SgType[] = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'CAA', 'SOA'] as const

export type SgLevel = 'error' | 'warn' | 'info'

export interface SgFinding {
  id: string
  level: SgLevel
  title: string
  detail: string
  /**
   * The literal record text this finding was derived from. Empty is legal only
   * when `basis === 'absence'` — a finding about a record that is not there has
   * nothing to quote, and saying so explicitly is what stops "no evidence" from
   * quietly becoming the normal case.
   */
  evidence: string[]
  basis: 'record' | 'absence'
}

/**
 * Did this question get an answer at all?
 *
 * NOERROR and NXDOMAIN are answers — the second says "this name holds nothing",
 * which is a fact about the zone. SERVFAIL, REFUSED, a timeout, an exhausted
 * query budget and the inspection deadline are not: nothing was learned. Every
 * finding that reads an EMPTY record set asks this first, because "no SPF
 * record", "no DMARC record" and "no address" are claims about somebody's zone,
 * and a failed lookup produces the same empty set as a real absence. The CAA
 * walk learned that first; the rest learned it when the inspection gained a
 * deadline, which turns every question still queued into a failure at once.
 */
export function sgUnanswered(answer: SgAnswer): boolean {
  return !!answer.error || (answer.rcode !== 'NOERROR' && answer.rcode !== 'NXDOMAIN')
}

/* ------------------------------------------------------------------ */
/* the name                                                            */
/* ------------------------------------------------------------------ */

export const SG_MAX_NAME_CHARS = 253
export const SG_MAX_LABEL_CHARS = 63
/** What the route will accept in the query string before it even looks. */
export const SG_MAX_INPUT_CHARS = 300

export type SgValidName =
  | { ok: true; name: string; labels: number; wasUrl: boolean; wasUnicode: boolean }
  | { ok: false; reason: string }

/**
 * Turn whatever was pasted into a name this tool is willing to query.
 *
 * Three things this has to survive, because all three are what people paste:
 * a whole URL (`https://example.com/pricing?x=1`), a trailing root dot
 * (`example.com.`), and a Unicode name (`bücher.de`). The Unicode case goes
 * through `URL`, which is the one IDNA implementation every engine already
 * ships — writing a punycode encoder to avoid a dependency would be writing the
 * dependency.
 *
 * It refuses an IP literal rather than silently querying `1.2.3.4` as a name:
 * the reverse lookup a visitor means by that is PTR in `in-addr.arpa`, which
 * this tool does not do, and answering NXDOMAIN to a perfectly real address is
 * worse than saying so.
 *
 * The underscore labels are deliberately allowed — `_dmarc.example.com` and
 * `_acme-challenge.example.com` are exactly the names someone debugging mail or
 * a certificate has in their clipboard, and a hostname-shaped validator that
 * rejects them is a validator for the wrong job.
 */
export function sgValidateName(input: string): SgValidName {
  const raw = (input ?? '').trim()
  if (!raw) return { ok: false, reason: 'enter a domain name' }
  if (raw.length > SG_MAX_INPUT_CHARS) return { ok: false, reason: 'that is too long to be a domain name' }

  let host = raw
  let wasUrl = false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
    try {
      host = new URL(host).hostname
      wasUrl = true
    } catch {
      return { ok: false, reason: 'that looks like a URL but does not parse' }
    }
  } else if (host.includes('/')) {
    host = host.split('/')[0]
  }
  if (host.includes('@')) host = host.slice(host.lastIndexOf('@') + 1)
  // A port is meaningless for a DNS question but harmless to strip.
  const colon = host.lastIndexOf(':')
  if (colon > 0 && !host.includes('[') && /^\d{1,5}$/.test(host.slice(colon + 1))) host = host.slice(0, colon)

  host = host.replace(/\.+$/, '')
  if (!host) return { ok: false, reason: 'enter a domain name' }

  if (canonicalIp(host)) {
    return { ok: false, reason: 'that is an IP address — this tool asks questions about names, not addresses' }
  }

  // IDNA, through the engine's own implementation rather than a hand-rolled
  // punycode encoder. `URL` lowercases and A-labels the host for us.
  const wasUnicode = /[^ -~]/.test(host)
  if (wasUnicode) {
    try {
      const encoded = new URL(`https://${host}`).hostname
      if (!encoded || encoded === host) return { ok: false, reason: 'that name has characters this tool cannot encode' }
      host = encoded
    } catch {
      return { ok: false, reason: 'that name has characters this tool cannot encode' }
    }
  }
  host = host.toLowerCase()

  if (host.length > SG_MAX_NAME_CHARS) return { ok: false, reason: `a domain name stops at ${SG_MAX_NAME_CHARS} characters` }
  const labels = host.split('.')
  if (labels.length < 2) return { ok: false, reason: 'that is a single label — a domain name needs at least one dot' }
  for (const label of labels) {
    if (!label) return { ok: false, reason: 'that name has an empty label (two dots in a row)' }
    if (label.length > SG_MAX_LABEL_CHARS) return { ok: false, reason: `"${label.slice(0, 20)}…" is longer than ${SG_MAX_LABEL_CHARS} characters` }
    // Underscore is legal in a DNS label and required by `_dmarc`; a hyphen may
    // not lead or trail. Anything outside LDH+underscore is refused rather than
    // passed on to a resolver as a query-string fragment.
    if (!/^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?$/.test(label)) {
      return { ok: false, reason: `"${label.slice(0, 20)}" is not a valid DNS label` }
    }
  }

  return { ok: true, name: host, labels: labels.length, wasUrl, wasUnicode }
}

/* ------------------------------------------------------------------ */
/* comparing what the resolvers said                                   */
/* ------------------------------------------------------------------ */

/**
 * One canonical rendering of one record, for comparison only.
 *
 * Two things are deliberately thrown away here, and throwing away neither is
 * how a resolver-diff tool ends up reporting that every domain on the internet
 * is broken:
 *
 *  - **TTL.** Each recursive resolver counts its own copy down from whenever it
 *    happened to fetch the record. Two resolvers reporting 42 and 3517 seconds
 *    hold the *same* record. A diff that includes the TTL disagrees always.
 *  - **Order.** Round-robin A sets are rotated on purpose — by the authoritative
 *    server, and again by the recursor. A diff that respects order reports every
 *    load-balanced domain as inconsistent, which is most of the interesting ones.
 *
 * What is *not* thrown away: case in TXT data (an SPF record is not case
 * sensitive but a DKIM key is, and this function cannot tell which it is
 * holding), and the MX preference number (a changed preference is a real
 * change). Names are lowercased and de-dotted because DNS names are
 * case-insensitive by definition, and IPv6 is canonicalised because resolvers
 * genuinely print the same address differently — see `src/lib/ip.ts`.
 */
export function sgCanonicalRecord(rec: SgRecord, type: SgType): string {
  const data = rec.data.trim()
  switch (type) {
    case 'A':
    case 'AAAA': {
      const ip = canonicalIp(data)
      return ip ?? data.toLowerCase()
    }
    case 'CNAME':
    case 'NS':
      return data.toLowerCase().replace(/\.+$/, '')
    case 'MX': {
      const m = data.match(/^\s*(\d+)\s+(\S+)\s*$/)
      if (!m) return data.toLowerCase().replace(/\.+$/, '')
      return `${Number(m[1])} ${m[2].toLowerCase().replace(/\.+$/, '')}`
    }
    case 'SOA': {
      // The serial is the whole point of comparing SOAs, so it stays; the
      // refresh/retry/expire/minimum tail is normalised whitespace only.
      return data.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.(?=\s|$)/g, '')
    }
    case 'CAA':
      return data.trim().toLowerCase().replace(/\s+/g, ' ')
    case 'TXT':
      return sgTxtValue(data)
    default:
      return data
  }
}

/** The comparable shape of one resolver's whole answer. */
export function sgFingerprint(answer: SgAnswer): string {
  if (answer.error) return `error:${answer.error}`
  const body = answer.records
    .map(r => sgCanonicalRecord(r, answer.type))
    .sort()
    .join('\n')
  return `${answer.rcode}\n${body}`
}

export interface SgDiffGroup {
  fingerprint: string
  resolvers: string[]
  answer: SgAnswer
}

export interface SgDiff {
  type: SgType
  /**
   * True only when the resolvers that ANSWERED gave the same answer. Read it
   * with `answered`: zero resolvers agreeing about nothing is not agreement,
   * and rendering it as such is the confident-wrong-sentence failure this whole
   * tool is built to avoid. (Found by running the endpoint with outbound
   * network blocked — every resolver errored and eight record types reported
   * "agree".)
   */
  agree: boolean
  /** How many resolvers came back with an answer rather than an error. */
  answered: number
  groups: SgDiffGroup[]
  /** Resolvers that failed outright — excluded from the agree/disagree verdict. */
  failed: string[]
  /**
   * Set when exactly one resolver answers NXDOMAIN or an empty NOERROR while
   * others return records. That is the shape of *filtering* (Quad9 and friends
   * refuse names on threat lists) rather than propagation, and calling the two
   * the same thing sends people to look at their registrar for no reason.
   */
  looksFiltered: boolean
}

export function sgDiffAnswers(type: SgType, answers: SgAnswer[]): SgDiff {
  const usable = answers.filter(a => !a.error)
  const failed = answers.filter(a => a.error).map(a => a.resolver)

  const byPrint = new Map<string, SgDiffGroup>()
  for (const a of usable) {
    const fp = sgFingerprint(a)
    const existing = byPrint.get(fp)
    if (existing) existing.resolvers.push(a.resolver)
    else byPrint.set(fp, { fingerprint: fp, resolvers: [a.resolver], answer: a })
  }

  const groups = [...byPrint.values()].sort((x, y) => y.resolvers.length - x.resolvers.length)
  const answering = groups.filter(g => g.answer.rcode === 'NOERROR' && g.answer.records.length > 0)
  const empty = groups.filter(g => g.answer.rcode === 'NXDOMAIN' || g.answer.records.length === 0)
  const looksFiltered =
    groups.length > 1 &&
    answering.length > 0 &&
    empty.length > 0 &&
    empty.reduce((n, g) => n + g.resolvers.length, 0) < usable.length

  return { type, agree: groups.length <= 1, answered: usable.length, groups, failed, looksFiltered }
}

/* ------------------------------------------------------------------ */
/* TXT strings                                                         */
/* ------------------------------------------------------------------ */

/**
 * A TXT record is a *list* of character-strings, each at most 255 bytes, and
 * the value is their concatenation **with no separator at all**.
 *
 * DoH JSON hands back that list as one field with the strings quoted and
 * separated by a space, so the tempting `data.replace(/"/g, '')` leaves a stray
 * space where the split was. On a 300-character DKIM key that space lands in
 * the middle of the base64 and the key silently stops verifying; on a long SPF
 * record it splits a mechanism in half. Joining with nothing is the RFC 1035
 * §3.3.14 rule and the reason this function exists rather than being inlined.
 *
 * A `\"` inside a string is an escaped quote and stays.
 */
export function sgTxtValue(data: string): string {
  const raw = data.trim()
  if (!raw.startsWith('"')) return raw
  const out: string[] = []
  let i = 0
  while (i < raw.length) {
    if (raw[i] !== '"') { i += 1; continue }
    i += 1
    let buf = ''
    while (i < raw.length && raw[i] !== '"') {
      if (raw[i] === '\\' && i + 1 < raw.length) {
        buf += raw[i + 1]
        i += 2
        continue
      }
      buf += raw[i]
      i += 1
    }
    i += 1
    out.push(buf)
  }
  return out.join('')
}

/* ------------------------------------------------------------------ */
/* SPF                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The terms that cost a DNS lookup, per RFC 7208 §4.6.4. This list — and not
 * "the number of mechanisms" — is what the limit of ten counts, and the
 * difference is the single most common misreading of SPF:
 *
 *  - `ip4`, `ip6` and `all` cost nothing however many of them there are, so a
 *    record with forty `ip4` terms is fine.
 *  - `include` costs one **and then spends the same budget again** inside the
 *    included record. A three-mechanism record that includes three providers
 *    routinely totals fourteen, and the tools that count the top level report
 *    three and tell you you are fine.
 *  - `redirect=` is a modifier, not a mechanism, and it counts.
 *  - `exp=` does not count: its lookup happens later, only on a failure, and
 *    §4.6.4 exempts it explicitly.
 */
export const SG_SPF_LOOKUP_TERMS = ['include', 'a', 'mx', 'ptr', 'exists'] as const
export const SG_SPF_LOOKUP_LIMIT = 10
/** §4.6.4 again: at most two lookups may return NXDOMAIN or an empty answer. */
export const SG_SPF_VOID_LIMIT = 2
/** A hard ceiling on the walk itself, so a hostile zone cannot make it run forever. */
export const SG_SPF_MAX_QUERIES = 40
export const SG_SPF_MAX_DEPTH = 10

export interface SgSpfTerm {
  /** `include`, `a`, `mx`, `ptr`, `exists`, `redirect`. */
  kind: string
  /** The domain the term names, resolved against the record's own domain. */
  domain: string
  /** How deep in the include tree this term was found. 0 = the record itself. */
  depth: number
  /** The record this term was read out of. */
  parent: string
  /** The term as written. */
  raw: string
}

export interface SgSpfReport {
  /** The SPF record found at the domain, already TXT-joined. */
  record: string | null
  /** More than one `v=spf1` TXT at the same name is a permerror, not a merge. */
  recordCount: number
  terms: SgSpfTerm[]
  lookups: number
  limit: number
  exceeded: boolean
  voidLookups: number
  voidExceeded: boolean
  /** Include loops, unreachable includes and syntax this walker refused. */
  problems: string[]
  /**
   * True when the walk stopped before the end of the tree — on its own ceiling,
   * or at a lookup that got no answer — so `lookups` is a floor, not a count.
   */
  truncated: boolean
  /**
   * Names whose TXT lookup got no answer (see `sgUnanswered`). Not void
   * lookups: a void lookup is an ANSWER that said "nothing here", and these
   * said nothing at all.
   */
  unanswered: string[]
  /** Has the record an `all` mechanism, and with what qualifier? */
  all: '+' | '-' | '~' | '?' | null
  queries: number
}

function sgSpfRecordsIn(answer: SgAnswer): string[] {
  return answer.records
    .map(r => sgTxtValue(r.data))
    .filter(v => /^v=spf1(\s|$)/i.test(v.trim()))
}

/**
 * Walk an SPF record the way a receiving mail server does, and count what it
 * would count.
 *
 * The walk is breadth-first over the include tree and every term that costs a
 * lookup increments ONE shared counter, wherever in the tree it appears —
 * because the budget in §4.6.4 is a budget for the whole evaluation, not per
 * record. `redirect=` is followed only when there is no `all`, which is the
 * other half of the rule people miss: a record with both ignores the redirect
 * entirely.
 *
 * The walk is bounded three ways so it terminates on any zone: a query ceiling,
 * a depth ceiling, and a cycle guard. `truncated` says which of those stopped
 * it, so the report can distinguish "your record is over the limit" from "this
 * tool stopped looking" — collapsing those two is how a checker ends up
 * confidently wrong.
 *
 * **The cycle guard is per-PATH, not global, and that distinction is the whole
 * correctness of the count.** A domain reached twice by two different routes —
 * `wide.com` includes both `a.net` and `c.org`, and `a.net` also includes
 * `c.org` — is a diamond, not a loop, and a receiver evaluates `c.org` both
 * times and charges for it both times. A single visited set shared across the
 * whole walk suppresses the second visit and quietly under-counts every zone
 * shaped like that, which is exactly the population of zones that is near the
 * limit in the first place. A cycle is a name appearing in its own ANCESTRY;
 * that is what is refused here.
 */
export async function sgAnalyzeSpf(domain: string, lookup: SgLookup): Promise<SgSpfReport> {
  const problems: string[] = []
  const unanswered: string[] = []
  let queries = 0
  let voidLookups = 0
  let truncated = false

  const txt = await lookup(domain, 'TXT')
  queries += 1
  const found = sgSpfRecordsIn(txt)
  const report: SgSpfReport = {
    record: found[0] ?? null,
    recordCount: found.length,
    terms: [],
    lookups: 0,
    limit: SG_SPF_LOOKUP_LIMIT,
    exceeded: false,
    voidLookups: 0,
    voidExceeded: false,
    problems,
    truncated: false,
    unanswered,
    all: null,
    queries,
  }
  if (!found.length) {
    // "No SPF record" is only a finding when the question was answered. A
    // lookup that failed learned nothing about the name, and reporting it as
    // absent is the sentence the evidence rule exists to stop.
    if (sgUnanswered(txt)) {
      report.truncated = true
      unanswered.push(domain)
      problems.push(`the TXT lookup for ${domain} got no answer (${txt.error ?? txt.rcode})`)
    }
    return report
  }

  /** How many expansions past the limit are still worth walking. Once a record
   *  is a permerror the exact total stops mattering, and a wide diamond can
   *  otherwise cost a great deal of walking to refine a number nobody needs. */
  const SG_SPF_OVERSHOOT = SG_SPF_LOOKUP_LIMIT * 3

  interface SgSpfNode { record: string; domain: string; depth: number; ancestry: string[] }
  const rootKey = domain.toLowerCase().replace(/\.+$/, '')
  const queue: SgSpfNode[] = [{ record: found[0], domain, depth: 0, ancestry: [rootKey] }]

  while (queue.length) {
    const node = queue.shift() as SgSpfNode
    const tokens = node.record.trim().split(/\s+/).slice(1) // drop `v=spf1`
    let hasAll = false
    let redirect: string | null = null

    for (const token of tokens) {
      if (!token) continue
      const lower = token.toLowerCase()

      if (/^[+\-~?]?all$/.test(lower)) {
        hasAll = true
        if (node.depth === 0) {
          const q = lower[0]
          report.all = q === '-' || q === '~' || q === '?' || q === '+' ? (q as '+' | '-' | '~' | '?') : '+'
        }
        continue
      }
      if (lower.startsWith('redirect=')) {
        redirect = token.slice('redirect='.length)
        continue
      }
      // `exp=` is the exemption: its lookup happens later and only on failure.
      if (lower.startsWith('exp=')) continue

      const bare = lower.replace(/^[+\-~?]/, '')
      const kind = bare.split(/[:/=]/)[0]
      if (!(SG_SPF_LOOKUP_TERMS as readonly string[]).includes(kind)) continue

      const after = token.replace(/^[+\-~?]/, '').slice(kind.length)
      let target = node.domain
      if (after.startsWith(':') || after.startsWith('=')) target = after.slice(1).split('/')[0]
      report.terms.push({ kind, domain: target || node.domain, depth: node.depth, parent: node.domain, raw: token })
      report.lookups += 1

      if (kind === 'include') {
        const child = await sgSpfDescend(target, node, 'include')
        if (child) queue.push(child)
      }
    }

    // §6.1: a `redirect=` is ignored entirely when the record also has `all`.
    if (redirect && !hasAll) {
      report.terms.push({ kind: 'redirect', domain: redirect, depth: node.depth, parent: node.domain, raw: `redirect=${redirect}` })
      report.lookups += 1
      const child = await sgSpfDescend(redirect, node, 'redirect')
      if (child) queue.push(child)
    }
  }

  /** Follow one include/redirect, or explain in `problems` why it was not followed. */
  async function sgSpfDescend(target: string, node: SgSpfNode, via: 'include' | 'redirect'): Promise<SgSpfNode | null> {
    const key = target.toLowerCase().replace(/\.+$/, '')
    // A cycle is a name inside its OWN ancestry. A name reached twice by two
    // different routes is a diamond, and a receiver pays for it twice.
    if (node.ancestry.includes(key)) {
      problems.push(`${via} loop: ${node.domain} ${via === 'include' ? 'includes' : 'redirects to'} ${target}, which is already on the path from ${domain}`)
      return null
    }
    if (node.depth + 1 > SG_SPF_MAX_DEPTH) {
      truncated = true
      problems.push(`stopped at ${SG_SPF_MAX_DEPTH} levels — the tree below ${target} was not walked`)
      return null
    }
    if (queries >= SG_SPF_MAX_QUERIES || report.lookups > SG_SPF_OVERSHOOT) {
      truncated = true
      return null
    }
    const answer = await lookup(target, 'TXT')
    queries += 1
    const records = sgSpfRecordsIn(answer)
    if (!records.length && sgUnanswered(answer)) {
      // Neither a void lookup nor a permerror: nothing was learned about
      // `target`, so from here the count is a floor. Reading this as "no SPF
      // record" reported a permerror — and spent the void allowance — for every
      // include still queued when a resolver stalled or the deadline arrived.
      truncated = true
      unanswered.push(target)
      problems.push(`${via === 'include' ? `include:${target}` : `redirect=${target}`} got no answer (${answer.error ?? answer.rcode}) — nothing below it was counted`)
      return null
    }
    if (answer.rcode === 'NXDOMAIN' || !answer.records.length) voidLookups += 1
    if (!records.length) {
      problems.push(`${via === 'include' ? `include:${target}` : `redirect=${target}`} has no SPF record — a receiver treats that as a permerror`)
      return null
    }
    if (records.length > 1) {
      problems.push(`${target} publishes ${records.length} SPF records, which is a permerror on its own`)
    }
    return { record: records[0], domain: target, depth: node.depth + 1, ancestry: [...node.ancestry, key] }
  }

  report.queries = queries
  report.voidLookups = voidLookups
  report.voidExceeded = voidLookups > SG_SPF_VOID_LIMIT
  report.exceeded = report.lookups > SG_SPF_LOOKUP_LIMIT
  report.truncated = truncated
  return report
}

export function sgSpfFindings(spf: SgSpfReport, domain: string): SgFinding[] {
  const out: SgFinding[] = []
  if (spf.recordCount === 0 && spf.unanswered.length) {
    // The opposite sentence to `spf-missing`, off the same zero records.
    out.push({
      id: 'spf-inconclusive',
      level: 'warn',
      title: 'SPF record could not be read',
      detail: `The TXT lookup for ${domain} got no answer, so whether it publishes SPF is unknown — this is a missing answer, not a missing record. Re-run the inspection before concluding that no sender is authorised.`,
      evidence: [],
      basis: 'absence',
    })
    return out
  }
  if (spf.recordCount === 0) {
    out.push({
      id: 'spf-missing',
      level: 'warn',
      title: 'No SPF record',
      detail: `${domain} publishes no \`v=spf1\` TXT record, so no sender is authorised and DMARC can never pass on the SPF side.`,
      evidence: [],
      basis: 'absence',
    })
    return out
  }
  if (spf.recordCount > 1) {
    out.push({
      id: 'spf-multiple',
      level: 'error',
      title: `${spf.recordCount} SPF records`,
      detail: 'RFC 7208 §4.5: more than one `v=spf1` record is a permerror. Receivers do not merge them — the whole check fails. Combine them into one record.',
      evidence: [spf.record ?? ''],
      basis: 'record',
    })
  }
  if (spf.exceeded) {
    // A walk that stopped early counted a floor. Over the limit is still over
    // the limit, but the number is not the total, and the title must not say it
    // is.
    out.push({
      id: 'spf-lookup-limit',
      level: 'error',
      title: `${spf.truncated ? 'At least ' : ''}${spf.lookups} DNS lookups — the limit is ${spf.limit}`,
      detail:
        `Counted the way a receiver counts: every \`include\`, \`a\`, \`mx\`, \`ptr\`, \`exists\` and \`redirect\` term in the **whole** evaluation, including the ones inside each included record. ` +
        `Over the limit is a permerror, which most receivers treat as a hard SPF failure. \`ip4\` and \`ip6\` terms are free — replacing an include with the addresses it resolves to is the usual fix.`,
      evidence: spf.terms.slice(0, SG_SPF_LOOKUP_LIMIT + 4).map(t => `${t.raw}  (in ${t.parent})`),
      basis: 'record',
    })
  } else if (spf.truncated) {
    // Under the limit SO FAR, which says nothing about the part of the tree that
    // was never walked. Without this the page showed a count below ten, no
    // finding at all, and — on an otherwise quiet zone — "nothing to report".
    out.push({
      id: 'spf-truncated',
      level: 'warn',
      title: `At least ${spf.lookups} of ${spf.limit} DNS lookups — the walk did not finish`,
      detail: `The walk stopped before the end of the include tree${spf.unanswered.length ? `, because ${spf.unanswered.length === 1 ? 'a lookup' : `${spf.unanswered.length} lookups`} got no answer` : ''}, so ${spf.lookups} is a floor rather than the total a receiver counts. Re-run the inspection before relying on the number.`,
      evidence: [spf.record ?? '', ...spf.problems.filter(p => !p.includes('loop'))].filter(e => e.trim()),
      basis: 'record',
    })
  } else if (spf.lookups >= spf.limit - 1) {
    out.push({
      id: 'spf-lookup-near',
      level: 'warn',
      title: `${spf.lookups} of ${spf.limit} DNS lookups used`,
      detail: 'One more provider and this record becomes a permerror. The count includes every term inside every included record, so adding a single `include` can cost several.',
      evidence: spf.terms.map(t => `${t.raw}  (in ${t.parent})`),
      basis: 'record',
    })
  }
  if (spf.voidExceeded) {
    out.push({
      id: 'spf-void-limit',
      level: 'error',
      title: `${spf.voidLookups} void lookups — the limit is ${SG_SPF_VOID_LIMIT}`,
      detail: 'RFC 7208 §4.6.4 also caps lookups that return NXDOMAIN or an empty answer at two. Includes pointing at retired providers are the usual cause.',
      evidence: spf.problems,
      basis: 'record',
    })
  }
  if (spf.all === '+') {
    out.push({
      id: 'spf-all-pass',
      level: 'error',
      title: '`+all` authorises the entire internet',
      detail: 'Any host anywhere passes SPF for this domain. This is almost always a typo for `-all` or `~all`.',
      evidence: [spf.record ?? ''],
      basis: 'record',
    })
  } else if (spf.all === null && spf.recordCount > 0 && !spf.truncated) {
    out.push({
      id: 'spf-no-all',
      level: 'warn',
      title: 'No `all` mechanism',
      detail: 'Without a final `all`, the result for an unlisted sender is neutral — the same outcome as having no policy at all. `~all` (softfail) or `-all` (fail) is what makes the record mean something.',
      evidence: [spf.record ?? ''],
      basis: 'record',
    })
  }
  for (const p of spf.problems) {
    if (!p.includes('loop')) continue
    out.push({
      id: 'spf-loop',
      level: 'error',
      title: 'Include loop',
      detail: `${p}. A receiver following this would not terminate either, so it gives up with a permerror.`,
      evidence: [p],
      basis: 'record',
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* DMARC                                                               */
/* ------------------------------------------------------------------ */

export interface SgDmarcReport {
  record: string | null
  recordCount: number
  tags: Record<string, string>
  /** A `v=DMARC1` record published at the apex instead of at `_dmarc`. */
  atApex: boolean
  /** True when the queried name has a parent whose policy would be inherited. */
  couldInherit: boolean
  /** The `_dmarc` lookup got no answer, so `recordCount: 0` means unknown, not absent. */
  unanswered: boolean
}

export function sgParseDmarcTags(record: string): Record<string, string> {
  const tags: Record<string, string> = {}
  for (const part of record.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim().toLowerCase()
    const value = part.slice(eq + 1).trim()
    if (key && !(key in tags)) tags[key] = value
  }
  return tags
}

export function sgReadDmarc(dmarcAnswer: SgAnswer, apexTxt: SgAnswer, labels: number): SgDmarcReport {
  const found = dmarcAnswer.records
    .map(r => sgTxtValue(r.data))
    .filter(v => /^v=dmarc1(\s*;|$)/i.test(v.trim()))
  const atApex = apexTxt.records.map(r => sgTxtValue(r.data)).some(v => /^v=dmarc1(\s*;|$)/i.test(v.trim()))
  return {
    record: found[0] ?? null,
    recordCount: found.length,
    tags: found[0] ? sgParseDmarcTags(found[0]) : {},
    atApex,
    couldInherit: labels > 2,
    unanswered: !found.length && sgUnanswered(dmarcAnswer),
  }
}

export function sgDmarcFindings(d: SgDmarcReport, domain: string): SgFinding[] {
  const out: SgFinding[] = []

  if (d.atApex && d.recordCount === 0) {
    out.push({
      id: 'dmarc-at-apex',
      level: 'error',
      title: 'The DMARC record is at the wrong name',
      detail: `A \`v=DMARC1\` record is published at ${domain} itself. Receivers only ever look at \`_dmarc.${domain}\`, so this record is read by nobody — and it also sits in the same TXT set as your SPF record, where it does nothing but add bytes.`,
      evidence: [`TXT ${domain} contains v=DMARC1`],
      basis: 'record',
    })
  }

  if (d.recordCount === 0 && d.unanswered) {
    out.push({
      id: 'dmarc-inconclusive',
      level: 'warn',
      title: `The DMARC record at _dmarc.${domain} could not be read`,
      detail: 'The lookup got no answer, so whether a policy is published is unknown — a missing answer, not a missing record. Re-run the inspection before concluding there is no DMARC.',
      evidence: [],
      basis: 'absence',
    })
    return out
  }

  if (d.recordCount === 0) {
    out.push({
      id: 'dmarc-missing',
      level: d.couldInherit ? 'info' : 'warn',
      title: `No DMARC record at _dmarc.${domain}`,
      detail: d.couldInherit
        ? `Nothing is published here. Receivers fall back to the organizational domain's policy (and its \`sp=\` tag if it has one). Working out which name that is needs the Public Suffix List, which this tool does not carry — so it reports what is at this name and does not guess at the parent.`
        : 'Without DMARC, a receiver has no instruction about what to do with mail that fails SPF and DKIM, and you get no reports about anyone spoofing you.',
      evidence: [],
      basis: 'absence',
    })
    return out
  }

  if (d.recordCount > 1) {
    out.push({
      id: 'dmarc-multiple',
      level: 'error',
      title: `${d.recordCount} DMARC records`,
      detail: 'RFC 7489 §6.6.3: when more than one record is found, **all of them are discarded** and the domain is treated as having no DMARC policy at all. This is worse than the records look — it silently switches enforcement off.',
      evidence: [d.record ?? ''],
      basis: 'record',
    })
  }

  const p = (d.tags.p ?? '').toLowerCase()
  if (p === 'none') {
    out.push({
      id: 'dmarc-p-none',
      level: 'warn',
      title: '`p=none` — monitoring only',
      detail: 'Failing mail is delivered exactly as it would be with no DMARC record. This is the right place to start, but it enforces nothing; `quarantine` and then `reject` are the destination.',
      evidence: [d.record ?? ''],
      basis: 'record',
    })
  } else if (!p) {
    out.push({
      id: 'dmarc-no-policy',
      level: 'error',
      title: 'No `p=` tag',
      detail: '`p=` is mandatory. Without it the record is invalid and receivers ignore the whole thing.',
      evidence: [d.record ?? ''],
      basis: 'record',
    })
  }

  const pct = d.tags.pct ? Number(d.tags.pct) : 100
  if (Number.isFinite(pct) && pct < 100 && p && p !== 'none') {
    out.push({
      id: 'dmarc-pct',
      level: 'info',
      title: `\`pct=${d.tags.pct}\` — the policy applies to ${d.tags.pct}% of failing mail`,
      detail: `The other ${100 - pct}% is treated one step down (\`reject\` becomes \`quarantine\`, \`quarantine\` becomes \`none\`). Deliberate during a rollout; easy to forget afterwards.`,
      evidence: [d.record ?? ''],
      basis: 'record',
    })
  }

  if (!d.tags.rua) {
    out.push({
      id: 'dmarc-no-rua',
      level: 'warn',
      title: 'No `rua=` address',
      detail: 'Aggregate reports are the only way to find out who is sending as you and whether your own mail aligns. Without `rua` you are enforcing a policy blind.',
      evidence: [d.record ?? ''],
      basis: 'record',
    })
  }

  // Alignment. This is the half people are surprised by: SPF passing and DMARC
  // passing are different questions, and strict mode is where they part.
  const aspf = (d.tags.aspf ?? 'r').toLowerCase()
  const adkim = (d.tags.adkim ?? 'r').toLowerCase()
  if (aspf === 's' || adkim === 's') {
    const which = aspf === 's' && adkim === 's' ? 'SPF and DKIM' : aspf === 's' ? 'SPF' : 'DKIM'
    out.push({
      id: 'dmarc-strict-alignment',
      level: 'warn',
      title: `Strict alignment on ${which}`,
      detail:
        `DMARC does not ask whether SPF passed — it asks whether SPF passed **for a domain that aligns with the From: header**. ` +
        (aspf === 's'
          ? `With \`aspf=s\` the SMTP \`MAIL FROM\` domain must equal ${domain} exactly, so a provider that bounces your mail from \`bounces.sendgrid.net\` or \`amazonses.com\` passes SPF and still fails DMARC. `
          : '') +
        (adkim === 's' ? `With \`adkim=s\` the DKIM \`d=\` domain must equal ${domain} exactly — a subdomain signature does not align. ` : '') +
        'Relaxed (`r`, the default) allows any subdomain of the organizational domain and is what almost everyone wants.',
      evidence: [d.record ?? ''],
      basis: 'record',
    })
  }

  return out
}

/* ------------------------------------------------------------------ */
/* CAA                                                                 */
/* ------------------------------------------------------------------ */

/**
 * CAA lives in `src/lib/caa.ts` now.
 *
 * Hoisted the way `canonicalIp` was, and for the same reason: Chainsaw needs the
 * `issue`/`issuewild` rule to answer "will this certificate's CA be allowed to
 * renew it", and two copies of a rule where `issuewild` REPLACES `issue` would
 * not survive one tidy-up. The `sg*` names below are the same functions under
 * their old spelling, so the assertions and the page keep importing from here
 * and are pinned to one implementation — `security:smoke` asserts the identity.
 */
export const SG_KNOWN_CAS = CA_REGISTRY
export const sgParseCaa = parseCaa
export const sgCaaAllows = caaAllows
export type SgCaaEntry = CaaEntry
export type SgCaaVerdict = CaaVerdict

export interface SgCaaReport {
  /** The name the policy was found at — CAA is inherited from the closest ancestor that has one. */
  foundAt: string | null
  entries: CaaEntry[]
  /** Names checked on the way up, in order. */
  walked: string[]
  /**
   * A lookup at or below the stop point got no answer (`sgUnanswered`: it
   * failed, or the budget or the deadline refused it). With nothing found that
   * makes the empty result "no answer" rather than "no policy"; with a policy
   * found above it, the policy is not known to be the one that governs — a CAA
   * set at the unanswered, more specific name would take precedence. See
   * `CaaVerdict.incomplete`.
   */
  incomplete?: boolean
}

/**
 * Walk up to the apex looking for a CAA set.
 *
 * RFC 8659 §3: a CA checks the exact name first and then each parent in turn,
 * stopping at the **first name that has any CAA record at all**. So a checker
 * that only queries the apex reports "no CAA policy" for a host that is
 * governed by one, and a checker that only queries the FQDN reports the same
 * for the far more common case of a policy set once at the apex. Neither is a
 * near miss: the answer is the opposite of the truth.
 *
 * The walk stops at two labels, which is the pragmatic floor — going further
 * would need the Public Suffix List to know that `co.uk` is not a domain.
 *
 * **A failed lookup below the stop point makes the answer incomplete even when
 * a policy was found.** The walk goes up only past names that answered "no CAA
 * here"; a name that did not answer at all might hold a CAA set of its own, and
 * a CA would stop THERE. So `sub.example.com` timing out while `example.com`
 * publishes a policy does not mean example.com's policy governs sub — it means
 * nobody knows which does. Reporting the parent's policy as the answer is the
 * found-policy twin of turning a timeout into "no policy": a confident
 * permit-or-forbid sentence, produced by a question nobody got answered. Only a
 * lookup ABOVE the stop point cannot matter, and the walk never asks one.
 */
export async function sgAnalyzeCaa(name: string, lookup: SgLookup): Promise<SgCaaReport> {
  const labels = name.split('.')
  const walked: string[] = []
  // A failed lookup anywhere in the walk is recorded rather than skipped past.
  // Without this the tool's most reassuring sentence — "no CAA record, so any
  // CA may issue" — is also what a DNS timeout produces, and a reader has no
  // way to tell the fact from the outage.
  let failed = false
  for (let i = 0; i + 2 <= labels.length; i += 1) {
    const candidate = labels.slice(i).join('.')
    walked.push(candidate)
    const answer = await lookup(candidate, 'CAA')
    const entries = answer.records.map(r => sgParseCaa(r.data)).filter((e): e is CaaEntry => e !== null)
    // Every name below this one answered or failed; `failed` is theirs.
    if (entries.length) return { foundAt: candidate, entries, walked, incomplete: failed }
    // NXDOMAIN is an answer: the name has no CAA because it has nothing at all.
    // SERVFAIL, a refusal, a timeout, the budget and the deadline are not.
    if (sgUnanswered(answer)) failed = true
  }
  return { foundAt: null, entries: [], walked, incomplete: failed }
}

export function sgCaaVerdict(report: SgCaaReport): SgCaaVerdict {
  return caaVerdict(report.entries, report.foundAt, report.incomplete ?? false)
}

export function sgCaaFindings(v: SgCaaVerdict, name: string, wantedCa: string | null): SgFinding[] {
  const out: SgFinding[] = []
  if (v.incomplete && v.policyAt) {
    // A policy WAS found, above a name whose lookup failed. Every sentence
    // below this block — who may issue, whether the named CA is blocked, even
    // a critical tag — holds only if that policy governs, and a CAA set at the
    // unanswered name would take precedence over it. So none of them is said.
    out.push({
      id: 'caa-inconclusive',
      level: 'warn',
      title: 'CAA policy could not be determined',
      detail: `A CAA policy is published at ${v.policyAt}, but the lookup for a more specific name on the way there failed or was refused. A CAA record at that name would take precedence, so this is not known to be the policy that governs ${name} — re-run the inspection before relying on it either way.`,
      evidence: v.raws.map(r => `${v.policyAt}  ${r}`),
      basis: 'record',
    })
    return out
  }
  if (v.incomplete) {
    // The opposite sentence to `caa-none`, off the same empty result. Claiming
    // "any CA may issue" because the lookup fell over is the one CAA mistake
    // that reassures somebody about a zone nobody actually read.
    out.push({
      id: 'caa-inconclusive',
      level: 'warn',
      title: 'CAA policy could not be determined',
      detail: `At least one CAA lookup for ${name} failed or was refused, so the absence of a policy here is not a finding — it is a missing answer. Re-run the inspection before concluding that any CA may issue.`,
      evidence: [],
      basis: 'absence',
    })
    return out
  }
  if (!v.policyAt) {
    out.push({
      id: 'caa-none',
      level: 'info',
      title: 'No CAA policy',
      detail: `Neither ${name} nor any parent up to the registered domain publishes a CAA record, so any CA may issue for this name. Publishing one is a cheap way to stop a mis-issuance you would otherwise never hear about.`,
      evidence: [],
      basis: 'absence',
    })
    return out
  }

  if (v.unknownCritical.length) {
    out.push({
      id: 'caa-unknown-critical',
      level: 'error',
      title: `Critical CAA tag no CA will understand: ${v.unknownCritical.join(', ')}`,
      detail: 'The critical flag (128) means "refuse to issue if you do not recognise this tag". An unrecognised critical tag therefore blocks every CA, including the one you are renewing with.',
      evidence: v.unknownCritical.map(t => `128 ${t}`),
      basis: 'record',
    })
  }

  if (v.forbidsAll) {
    out.push({
      id: 'caa-forbids-all',
      level: 'warn',
      title: 'CAA forbids issuance entirely',
      detail: `\`issue ";"\` at ${v.policyAt} instructs every CA to refuse. Deliberate for a name that should never hold a certificate; a renewal-stopping surprise otherwise.`,
      evidence: [`${v.policyAt}  issue ";"`],
      basis: 'record',
    })
  } else if (v.allowed.length) {
    out.push({
      id: 'caa-policy',
      level: 'info',
      title: `CAA policy inherited from ${v.policyAt}`,
      detail: `Only ${v.allowed.join(', ')} may issue for this name${v.allowedWild.length ? `, and only ${v.allowedWild.join(', ')} may issue a wildcard` : v.forbidsAllWild ? ', and no CA may issue a wildcard' : ' (wildcards follow the same list, since there is no issuewild)'}.`,
      evidence: [`${v.policyAt}  issue "${v.allowed.join('", "')}"`],
      basis: 'record',
    })
  }

  if (wantedCa) {
    const plain = sgCaaAllows(v, wantedCa, false)
    const wild = sgCaaAllows(v, wantedCa, true)
    if (!plain || !wild) {
      out.push({
        id: 'caa-blocks-ca',
        level: 'error',
        title: `CAA blocks ${wantedCa}${plain && !wild ? ' for wildcards' : ''}`,
        detail: !plain
          ? `The policy at ${v.policyAt} does not list \`${wantedCa}\`, so that CA is required to refuse the order. This is the failure that looks like an ACME bug: the challenge passes and issuance is refused anyway.`
          : `\`${wantedCa}\` may issue for this exact name but not for \`*.${name}\` — an \`issuewild\` record replaces \`issue\` for wildcards rather than adding to it.`,
        evidence: [`${v.policyAt}  ${plain ? 'issuewild' : 'issue'} "${(plain ? v.allowedWild : v.allowed).join('", "') || ';'}"`],
        basis: 'record',
      })
    }
  }

  return out
}

/* ------------------------------------------------------------------ */
/* MX and CNAME                                                        */
/* ------------------------------------------------------------------ */

export interface SgMxTarget {
  preference: number
  host: string
  /** A CNAME found at the MX target — forbidden by RFC 2181 §10.3. */
  isCname: boolean
  cnameTo: string | null
  addresses: string[]
  resolves: boolean
  /**
   * No address came back AND an address lookup got no answer, so whether this
   * host resolves is unknown — not the same claim as "it has no address".
   */
  unanswered: boolean
}

export function sgParseMx(data: string): { preference: number; host: string } | null {
  const m = data.trim().match(/^(\d+)\s+(\S+?)\.?$/)
  if (!m) return null
  return { preference: Number(m[1]), host: m[2].toLowerCase() }
}

/** `0 .` — the explicit "this domain accepts no mail" record of RFC 7505. */
export function sgIsNullMx(records: SgRecord[]): boolean {
  if (records.length !== 1) return false
  const parsed = sgParseMx(records[0].data)
  return !!parsed && parsed.preference === 0 && (parsed.host === '' || parsed.host === '.')
}

export async function sgResolveMxTargets(mx: SgAnswer, lookup: SgLookup, max = 8): Promise<SgMxTarget[]> {
  const out: SgMxTarget[] = []
  const parsed = mx.records.map(r => sgParseMx(r.data)).filter((p): p is { preference: number; host: string } => p !== null)
  for (const entry of parsed.slice(0, max)) {
    if (!entry.host || entry.host === '.') continue
    const [cname, a, aaaa] = await Promise.all([
      lookup(entry.host, 'CNAME'),
      lookup(entry.host, 'A'),
      lookup(entry.host, 'AAAA'),
    ])
    const addresses = [...a.records, ...aaaa.records].map(r => r.data)
    out.push({
      preference: entry.preference,
      host: entry.host,
      isCname: cname.records.length > 0,
      cnameTo: cname.records[0]?.data.toLowerCase().replace(/\.+$/, '') ?? null,
      addresses,
      resolves: addresses.length > 0,
      unanswered: addresses.length === 0 && (sgUnanswered(a) || sgUnanswered(aaaa)),
    })
  }
  return out
}

export function sgMxFindings(mx: SgAnswer, targets: SgMxTarget[]): SgFinding[] {
  const out: SgFinding[] = []
  if (sgIsNullMx(mx.records)) {
    out.push({
      id: 'mx-null',
      level: 'info',
      title: 'Null MX — this domain accepts no mail',
      detail: 'RFC 7505: a single `0 .` record tells senders to stop immediately rather than retry for five days. This is the correct record for a domain that never receives mail.',
      evidence: mx.records.map(r => `MX ${r.data}`),
      basis: 'record',
    })
    return out
  }
  if (!mx.records.length && sgUnanswered(mx)) {
    out.push({
      id: 'mx-inconclusive',
      level: 'warn',
      title: 'MX records could not be read',
      detail: 'The MX lookup got no answer, so whether this domain receives mail — and where — is unknown. A missing answer is not a missing record; re-run the inspection.',
      evidence: [],
      basis: 'absence',
    })
    return out
  }
  if (!mx.records.length) {
    out.push({
      id: 'mx-none',
      level: 'info',
      title: 'No MX records',
      detail: 'Senders fall back to the A/AAAA record of the domain itself (RFC 5321 §5.1). If this domain is not meant to receive mail, a null MX (`0 .`) says so explicitly and stops the retries.',
      evidence: [],
      basis: 'absence',
    })
    return out
  }

  for (const t of targets) {
    if (t.isCname) {
      out.push({
        id: 'mx-cname-target',
        level: 'error',
        title: `MX ${t.host} is a CNAME`,
        detail: `RFC 2181 §10.3 forbids it: an MX (like an NS) must name a host with address records, not an alias. It works with most senders and fails with the strict ones, which is the worst possible distribution of outcomes — intermittent, per-sender mail loss. It points at \`${t.cnameTo}\`; name that directly.`,
        evidence: [`MX ${t.preference} ${t.host}`, `CNAME ${t.host} → ${t.cnameTo}`],
        basis: 'record',
      })
    }
    if (canonicalIp(t.host)) {
      out.push({
        id: 'mx-ip-target',
        level: 'error',
        title: `MX ${t.host} is an IP address`,
        detail: 'An MX record holds a hostname. An address here is not "the same thing without a lookup" — senders resolve the value as a name and get NXDOMAIN.',
        evidence: [`MX ${t.preference} ${t.host}`],
        basis: 'record',
      })
    } else if (!t.resolves && !t.unanswered) {
      out.push({
        id: 'mx-unresolvable',
        level: 'error',
        title: `MX ${t.host} has no address`,
        detail: 'No A or AAAA record, so nothing can be delivered here. Mail to this domain queues and then bounces.',
        evidence: [`MX ${t.preference} ${t.host}`],
        basis: 'record',
      })
    }
  }
  // "No address, so mail bounces" is the claim above, and a host whose lookups
  // got no answer has not earned it. Up to eight targets resolve one after
  // another, so the deadline reaches these more often than anything else.
  const unchecked = targets.filter(t => t.unanswered && !canonicalIp(t.host))
  if (unchecked.length) {
    out.push({
      id: 'mx-unchecked',
      level: 'warn',
      title: unchecked.length === 1 ? `MX ${unchecked[0].host} could not be checked` : `${unchecked.length} MX hosts could not be checked`,
      detail: 'Their address lookups got no answer, so whether mail can be delivered there is unknown — which is a different thing from having no address. Re-run the inspection.',
      evidence: unchecked.map(t => `MX ${t.preference} ${t.host}`),
      basis: 'record',
    })
  }
  return out
}

/** SaaS hosts whose dangling CNAMEs are the classic subdomain-takeover route. */
const SG_TAKEOVER_SUFFIXES: ReadonlyArray<{ suffix: string; service: string }> = [
  { suffix: '.github.io', service: 'GitHub Pages' },
  { suffix: '.herokuapp.com', service: 'Heroku' },
  { suffix: '.herokudns.com', service: 'Heroku' },
  { suffix: '.s3.amazonaws.com', service: 'Amazon S3' },
  { suffix: '.cloudfront.net', service: 'CloudFront' },
  { suffix: '.azurewebsites.net', service: 'Azure App Service' },
  { suffix: '.cloudapp.azure.com', service: 'Azure' },
  { suffix: '.trafficmanager.net', service: 'Azure Traffic Manager' },
  { suffix: '.netlify.app', service: 'Netlify' },
  { suffix: '.vercel.app', service: 'Vercel' },
  { suffix: '.pages.dev', service: 'Cloudflare Pages' },
  { suffix: '.ghost.io', service: 'Ghost' },
  { suffix: '.myshopify.com', service: 'Shopify' },
  { suffix: '.zendesk.com', service: 'Zendesk' },
  { suffix: '.statuspage.io', service: 'Statuspage' },
  { suffix: '.surge.sh', service: 'Surge' },
  { suffix: '.fastly.net', service: 'Fastly' },
  { suffix: '.readthedocs.io', service: 'Read the Docs' },
]

export function sgTakeoverService(target: string): string | null {
  const t = target.toLowerCase().replace(/\.+$/, '')
  for (const entry of SG_TAKEOVER_SUFFIXES) {
    if (t.endsWith(entry.suffix)) return entry.service
  }
  return null
}

/**
 * Is a CNAME target really gone?
 *
 * "Dangling" has to mean **NXDOMAIN** — the name does not exist — and not "has
 * no address record". The distinction is the whole difference between reporting
 * a subdomain takeover and inventing one: a name that exists carrying only a
 * TXT record, or only an MX, is an odd zone and not an unclaimed hostname, and
 * telling somebody their subdomain can be stolen when it cannot is the single
 * most damaging thing a tool like this can say.
 *
 * All three questions have to come back NXDOMAIN. Asking only for an address
 * would call a CNAME chain (target → another CNAME → an address) dangling,
 * which is an entirely ordinary hosted-service setup.
 *
 * A resolver that failed is not evidence of absence, so any error means no.
 */
export function sgIsDangling(a: SgAnswer, aaaa: SgAnswer, cname: SgAnswer): boolean {
  for (const answer of [a, aaaa, cname]) {
    if (answer.error) return false
    if (answer.rcode !== 'NXDOMAIN') return false
  }
  return true
}

export interface SgCnameReport {
  target: string | null
  /** The target name returned NXDOMAIN — nothing is there at all. */
  dangling: boolean
  /** A hosted-service suffix recognised in the target name. */
  service: string | null
  /** Records of other types at the same name — illegal alongside a CNAME. */
  coexisting: SgType[]
  /** The queried name is the registered domain itself. */
  atApex: boolean
}

export function sgCnameFindings(c: SgCnameReport, name: string): SgFinding[] {
  const out: SgFinding[] = []
  if (!c.target) return out

  if (c.atApex) {
    out.push({
      id: 'cname-at-apex',
      level: 'error',
      title: 'CNAME at the zone apex',
      detail: `RFC 1034 §3.6.2: a CNAME may not coexist with any other record, and the apex must carry SOA and NS. Resolvers behave unpredictably — some return the alias, some the SOA — and mail usually breaks first. \`ALIAS\`/\`ANAME\`/flattened-CNAME at your DNS provider is the supported way to do this.`,
      evidence: [`CNAME ${name} → ${c.target}`],
      basis: 'record',
    })
  }

  if (c.coexisting.length) {
    out.push({
      id: 'cname-coexists',
      level: 'error',
      title: `CNAME alongside ${c.coexisting.join(', ')}`,
      detail: 'A CNAME must be the only record at its name. Whichever record a resolver happens to return first is what that client sees, so the behaviour differs between clients and between days.',
      evidence: [`CNAME ${name} → ${c.target}`, ...c.coexisting.map(t => `${t} also present at ${name}`)],
      basis: 'record',
    })
  }

  if (c.dangling) {
    out.push({
      id: 'cname-dangling',
      level: 'error',
      title: `Dangling CNAME → ${c.target}`,
      detail:
        `${name} points at \`${c.target}\`, which does not exist (NXDOMAIN). ` +
        (c.service
          ? `That name belongs to ${c.service}, so whoever claims it next serves content on your subdomain, with your cookies and a valid certificate — this is a subdomain takeover, not a broken link. Delete the record or re-claim the name.`
          : 'Anyone able to register that name inherits this subdomain. Delete the record.'),
      evidence: [`CNAME ${name} → ${c.target}`, `${c.target} → NXDOMAIN`],
      basis: 'record',
    })
  } else if (c.service) {
    out.push({
      id: 'cname-hosted',
      level: 'info',
      title: `Pointed at ${c.service}`,
      detail: `\`${c.target}\` resolves, so this is not dangling. Worth knowing where the subdomain lives: if the ${c.service} project behind it is ever deleted while this record stays, it becomes a takeover.`,
      evidence: [`CNAME ${name} → ${c.target}`],
      basis: 'record',
    })
  }

  return out
}

/* ------------------------------------------------------------------ */
/* NS / SOA hygiene                                                    */
/* ------------------------------------------------------------------ */

export function sgNsFindings(ns: SgAnswer, soa: SgAnswer, name: string): SgFinding[] {
  const out: SgFinding[] = []
  const hosts = ns.records.map(r => r.data.toLowerCase().replace(/\.+$/, '')).filter(Boolean)

  if (!hosts.length && ns.rcode === 'NOERROR') {
    out.push({
      id: 'ns-none',
      level: 'info',
      title: 'No NS records at this name',
      detail: `${name} is not a zone cut — it is a name inside its parent's zone. That is normal for a subdomain.`,
      evidence: [],
      basis: 'absence',
    })
  } else if (hosts.length === 1) {
    out.push({
      id: 'ns-single',
      level: 'warn',
      title: 'Only one nameserver',
      detail: 'RFC 1034 §4.1 asks for at least two, on separate hosts. With one, a single outage takes the entire domain off the internet — including mail, which will not retry for as long as you might hope.',
      evidence: hosts.map(h => `NS ${h}`),
      basis: 'record',
    })
  }

  if (soa.records.length > 1) {
    out.push({
      id: 'soa-multiple',
      level: 'error',
      title: `${soa.records.length} SOA records`,
      detail: 'A zone has exactly one SOA. More than one means two views of the zone are being served, which is a split-horizon or a half-finished migration.',
      evidence: soa.records.map(r => `SOA ${r.data}`),
      basis: 'record',
    })
  }

  return out
}

/* ------------------------------------------------------------------ */
/* the resolver diff, as findings                                      */
/* ------------------------------------------------------------------ */

export function sgDiffFindings(diffs: SgDiff[]): SgFinding[] {
  const out: SgFinding[] = []
  for (const d of diffs) {
    if (d.agree || d.groups.length < 2) continue
    const shape = d.groups
      .map(g => `${g.resolvers.join(' + ')} → ${g.answer.rcode}${g.answer.records.length ? `: ${g.answer.records.map(r => sgCanonicalRecord(r, d.type)).sort().join(', ')}` : ' (no records)'}`)
    out.push({
      id: d.looksFiltered ? `filtered-${d.type}` : `diff-${d.type}`,
      level: d.looksFiltered ? 'info' : 'warn',
      title: d.looksFiltered
        ? `One resolver withholds the ${d.type} answer`
        : `Resolvers disagree about ${d.type}`,
      detail: d.looksFiltered
        ? 'Some resolvers return records while another returns nothing at all. That is the shape of filtering — a resolver applying a threat or content blocklist — rather than of propagation, which shows up as two different answers, not as one answer and one silence.'
        : 'The same question, asked of independent resolvers, came back differently. Either a change is still propagating (each resolver holds its own cached copy until its TTL runs out), the zone answers differently per source (split horizon, geo-routing), or one resolver is holding a stale record. TTLs and record order are excluded from this comparison, so neither of those is the cause.',
      evidence: shape,
      basis: 'record',
    })
  }
  return out
}

/**
 * Nobody answered.
 *
 * Separate from the per-type diff because it is a fact about this tool's own
 * reachability rather than about the zone, and because saying it once is worth
 * more than saying it eight times. Without it the page reports that three
 * resolvers agree about a domain none of them were asked successfully — which
 * is the exact shape of failure the evidence rule exists to prevent, and it
 * took running the endpoint with outbound network blocked to see it.
 */
export function sgReachabilityFindings(diffs: SgDiff[]): SgFinding[] {
  if (!diffs.length) return []
  if (diffs.some(d => d.answered > 0)) return []
  const failed = [...new Set(diffs.flatMap(d => d.failed))]
  return [{
    id: 'resolvers-unreachable',
    level: 'error',
    title: 'No resolver answered',
    detail: `None of ${failed.join(', ') || 'the configured resolvers'} could be reached from this server, so nothing below is an observation about the zone. Nothing here means your domain is broken — it means this tool could not ask. Try again in a moment.`,
    evidence: [],
    basis: 'absence',
  }]
}

/* ------------------------------------------------------------------ */
/* ordering                                                            */
/* ------------------------------------------------------------------ */

const SG_LEVEL_ORDER: Record<SgLevel, number> = { error: 0, warn: 1, info: 2 }

export function sgSortFindings(findings: SgFinding[]): SgFinding[] {
  return [...findings].sort((a, b) => SG_LEVEL_ORDER[a.level] - SG_LEVEL_ORDER[b.level])
}

export function sgCountByLevel(findings: SgFinding[]): Record<SgLevel, number> {
  const out: Record<SgLevel, number> = { error: 0, warn: 0, info: 0 }
  for (const f of findings) out[f.level] += 1
  return out
}
