/**
 * DNS Sightline — one inspection, start to finish.
 *
 * Composes the transport (`src/lib/dns-doh.ts`) with the claims module
 * (`./analyze.ts`). Nothing here decides anything: every verdict comes from
 * `analyze`, so the assertions and the page cannot disagree about a finding,
 * and this file is only the wiring — which questions get asked, of whom, and in
 * what order.
 *
 * Reached only from `src/pages/api/tools/dns-sightline.ts`. The browser bundle
 * imports `./analyze.ts` for the types and the rendering helpers and never this
 * file, so no `fetch`-to-a-resolver code ships to a page.
 *
 * ── Two halves, deliberately separated ────────────────────────────────────
 * 1. **The diff.** Eight record types asked of all three resolvers — 24
 *    queries, pooled. This is the part that needs several resolvers, because
 *    the finding *is* the disagreement.
 * 2. **The analysis.** SPF include walking, the CAA ancestor walk, MX target
 *    resolution. These run against ONE resolver (`SG_PRIMARY_RESOLVER`),
 *    because asking three resolvers to walk the same include tree triples the
 *    outbound cost to answer a question none of them would answer differently.
 *    The page says which resolver did the walking rather than implying the
 *    analysis is a consensus.
 */
import {
  SG_PRIMARY_RESOLVER,
  SG_RESOLVERS,
  sgMakeLookup,
  sgNewBudget,
  sgPool,
  sgQuery,
  type SgAnswer,
  type SgBudget,
  type SgLookup,
  type SgType,
} from '../../../lib/dns-doh'
import {
  SG_TYPES,
  sgAnalyzeCaa,
  sgAnalyzeSpf,
  sgCaaFindings,
  sgCaaVerdict,
  sgCnameFindings,
  sgDiffAnswers,
  sgDiffFindings,
  sgDmarcFindings,
  sgIsDangling,
  sgMxFindings,
  sgNsFindings,
  sgReachabilityFindings,
  sgReadDmarc,
  sgResolveMxTargets,
  sgSortFindings,
  sgSpfFindings,
  sgTakeoverService,
  type SgCaaVerdict,
  type SgCnameReport,
  type SgDiff,
  type SgDmarcReport,
  type SgFinding,
  type SgMxTarget,
  type SgSpfReport,
} from './analyze'

export interface SgInspection {
  name: string
  /** Which resolver walked the include/CAA/MX trees. */
  analysedBy: string
  resolvers: Array<{ key: string; label: string; operator: string; note: string }>
  answers: Record<string, SgAnswer[]>
  diffs: SgDiff[]
  spf: SgSpfReport
  dmarc: SgDmarcReport
  caa: SgCaaVerdict
  caaWalked: string[]
  mxTargets: SgMxTarget[]
  cname: SgCnameReport
  findings: SgFinding[]
  queries: number
  budgetLeft: number
  elapsedMs: number
}

export interface SgInspectOptions {
  /** CAA identifier the visitor is trying to renew with, e.g. `letsencrypt.org`. */
  wantedCa?: string | null
  signal?: AbortSignal
  budget?: SgBudget
  timeoutMs?: number
}

export async function sgInspect(name: string, opts: SgInspectOptions = {}): Promise<SgInspection> {
  const started = Date.now()
  const budget = opts.budget ?? sgNewBudget()
  // NOTE: no `endpointOverride` is passed here, and none ever should be — the
  // escape hatch exists for the assertions alone. `security:smoke` asserts this
  // file never mentions it.
  const queryOpts = { signal: opts.signal, timeoutMs: opts.timeoutMs, budget }

  // ── 1. the diff: every type, every resolver ──────────────────────────────
  const jobs: Array<() => Promise<SgAnswer>> = []
  for (const type of SG_TYPES) {
    for (const r of SG_RESOLVERS) {
      jobs.push(() => sgQuery(r.key, name, type, queryOpts))
    }
  }
  const flat = await sgPool(jobs)

  const answers: Record<string, SgAnswer[]> = {}
  for (const a of flat) {
    ;(answers[a.type] ??= []).push(a)
  }
  const diffs = SG_TYPES.map(t => sgDiffAnswers(t, answers[t] ?? []))

  // ── 2. the analysis: one resolver, shared budget, memoised ───────────────
  const lookup: SgLookup = sgMakeLookup(SG_PRIMARY_RESOLVER, budget, {
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
  })

  const primaryOf = (type: SgType): SgAnswer =>
    (answers[type] ?? []).find(a => a.resolver === SG_PRIMARY_RESOLVER && !a.error) ??
    (answers[type] ?? []).find(a => !a.error) ??
    { resolver: SG_PRIMARY_RESOLVER, type, name, rcode: 'ERROR', records: [], elapsedMs: 0, error: 'no answer' }

  const mxAnswer = primaryOf('MX')
  const cnameAnswer = primaryOf('CNAME')

  const [spf, dmarcAnswer, caaReport, mxTargets] = await Promise.all([
    sgAnalyzeSpf(name, lookup),
    lookup(`_dmarc.${name}`, 'TXT'),
    sgAnalyzeCaa(name, lookup),
    sgResolveMxTargets(mxAnswer, lookup),
  ])

  const dmarc = sgReadDmarc(dmarcAnswer, primaryOf('TXT'), name.split('.').length)
  const caa = sgCaaVerdict(caaReport)

  // ── 3. the CNAME picture ─────────────────────────────────────────────────
  const cnameTarget = cnameAnswer.records[0]?.data.toLowerCase().replace(/\.+$/, '') ?? null
  let dangling = false
  if (cnameTarget) {
    const [ta, taaaa, tcname] = await Promise.all([
      lookup(cnameTarget, 'A'),
      lookup(cnameTarget, 'AAAA'),
      lookup(cnameTarget, 'CNAME'),
    ])
    // The rule lives in `analyze.ts` (`sgIsDangling`) rather than here, because
    // it is a claim — see its docblock for why NXDOMAIN and not "no address".
    dangling = sgIsDangling(ta, taaaa, tcname)
  }
  const cname: SgCnameReport = {
    target: cnameTarget,
    dangling,
    service: cnameTarget ? sgTakeoverService(cnameTarget) : null,
    // A CNAME may not coexist with anything. Reported only for types actually
    // observed at this exact name in the same inspection.
    coexisting: cnameTarget
      ? (['A', 'AAAA', 'MX', 'TXT', 'NS'] as SgType[]).filter(t => (primaryOf(t).records ?? []).length > 0)
      : [],
    atApex: name.split('.').length === 2,
  }

  const findings = sgSortFindings([
    ...sgReachabilityFindings(diffs),
    ...sgDiffFindings(diffs),
    ...sgCnameFindings(cname, name),
    ...sgSpfFindings(spf, name),
    ...sgDmarcFindings(dmarc, name),
    ...sgCaaFindings(caa, name, opts.wantedCa ?? null),
    ...sgMxFindings(mxAnswer, mxTargets),
    ...sgNsFindings(primaryOf('NS'), primaryOf('SOA'), name),
  ])

  return {
    name,
    analysedBy: SG_PRIMARY_RESOLVER,
    resolvers: SG_RESOLVERS.map(r => ({ key: r.key, label: r.label, operator: r.operator, note: r.note })),
    answers,
    diffs,
    spf,
    dmarc,
    caa,
    caaWalked: caaReport.walked,
    mxTargets,
    cname,
    findings,
    queries: budget.spent,
    budgetLeft: budget.left,
    elapsedMs: Date.now() - started,
  }
}
