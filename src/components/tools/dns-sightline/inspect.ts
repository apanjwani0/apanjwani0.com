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
 * imports `./analyze.ts` and `./panels.ts`, and this file only for the report's
 * TYPE — erased at build — so no `fetch`-to-a-resolver code ships to a page.
 *
 * ── Two halves, deliberately separated ────────────────────────────────────
 * 1. **The diff.** Eight record types asked of all three resolvers — 24
 *    queries, pooled. This is the part that needs several resolvers, because
 *    the finding *is* the disagreement.
 * 2. **The analysis.** SPF include walking, the CAA ancestor walk, MX target
 *    resolution. These run against ONE resolver (`SG_PRIMARY_RESOLVER`),
 *    because asking three resolvers to walk the same include tree triples the
 *    outbound cost to answer a question none of them would answer differently.
 *    The report records which one (`analysedBy`) rather than implying the
 *    analysis is a consensus. The walks START from what the diff already has: a
 *    question about the inspected name itself is answered with the diff's own
 *    pick (`sgPickAnswer`) instead of being asked again, so the SPF record the
 *    walk counts, the CAA set it stops at and the answer the Records table
 *    shows are one answer — not two taken a moment apart that can disagree.
 *
 * ── One deadline over both ────────────────────────────────────────────────
 * Every question in an inspection runs under ONE signal: the visitor's request
 * joined to `SG_INSPECT_DEADLINE_MS`. The per-question timeout bounds a single
 * answer and nothing else, and the SPF walk asks its questions one after
 * another, so without an overall deadline one inspection could hold a socket
 * for minutes. At the deadline the remaining questions fail at once rather than
 * throwing, and the walks report themselves truncated or incomplete from those
 * failed answers — `analyze.ts` is where "no answer" is kept apart from "no
 * record", so this file only has to make sure the answers stop coming.
 */
import {
  SG_PRIMARY_RESOLVER,
  SG_RESOLVERS,
  sgDeadlineReached,
  sgInspectionSignal,
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
  sgCnameTargetUnchecked,
  sgDiffAnswers,
  sgDiffFindings,
  sgDmarcFindings,
  sgIsDangling,
  sgMxFindings,
  sgMxStatus,
  sgNsFindings,
  sgOutageOf,
  sgPickAnswer,
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
  type SgMxStatus,
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
  /**
   * What the MX answer the findings read says (`sgMxStatus`). The Mail panel
   * reads THIS rather than deciding absence for itself, so it cannot print
   * "No MX records." beside a finding that says the lookup failed.
   */
  mxStatus: SgMxStatus
  cname: SgCnameReport
  findings: SgFinding[]
  queries: number
  budgetLeft: number
  elapsedMs: number
  /** The inspection stopped at its deadline; some sections are marked incomplete. */
  deadlineHit: boolean
}

export interface SgInspectOptions {
  /** CAA identifier the visitor is trying to renew with, e.g. `letsencrypt.org`. */
  wantedCa?: string | null
  signal?: AbortSignal
  budget?: SgBudget
  timeoutMs?: number
  /**
   * The overall deadline, `SG_INSPECT_DEADLINE_MS` unless given. Injectable so
   * `security:smoke` can hold the bound against a resolver that never answers
   * in milliseconds rather than in fifteen seconds; the route never sets it.
   */
  deadlineMs?: number
}

export async function sgInspect(name: string, opts: SgInspectOptions = {}): Promise<SgInspection> {
  const started = Date.now()
  const budget = opts.budget ?? sgNewBudget()
  const signal = sgInspectionSignal(opts.signal, opts.deadlineMs)
  // NOTE: no `endpointOverride` is passed here, and none ever should be — the
  // escape hatch exists for the assertions alone. `security:smoke` asserts this
  // file never mentions it.
  const queryOpts = { signal, timeoutMs: opts.timeoutMs, budget }

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
    signal,
    timeoutMs: opts.timeoutMs,
  })

  const primaryOf = (type: SgType): SgAnswer =>
    sgPickAnswer(answers[type] ?? [], SG_PRIMARY_RESOLVER) ??
    { resolver: SG_PRIMARY_RESOLVER, type, name, rcode: 'ERROR', records: [], elapsedMs: 0, error: 'no answer' }

  // The walks' first questions are ones the diff has just put to every
  // resolver. Asking the primary again spent a query to get a second answer
  // that could disagree with the first — the walk reading a SERVFAIL while the
  // Records table showed Google's record — so they are served from the pick.
  const walkLookup: SgLookup = (n, t) =>
    n.trim().toLowerCase().replace(/\.+$/, '') === name && (SG_TYPES as readonly string[]).includes(t)
      ? Promise.resolve(primaryOf(t))
      : lookup(n, t)

  const mxAnswer = primaryOf('MX')
  const cnameAnswer = primaryOf('CNAME')

  const [spf, dmarcAnswer, caaReport, mxTargets] = await Promise.all([
    sgAnalyzeSpf(name, walkLookup),
    lookup(`_dmarc.${name}`, 'TXT'),
    sgAnalyzeCaa(name, walkLookup),
    sgResolveMxTargets(mxAnswer, walkLookup),
  ])

  const dmarc = sgReadDmarc(dmarcAnswer, primaryOf('TXT'), name.split('.').length)
  const caa = sgCaaVerdict(caaReport)

  // ── 3. the CNAME picture ─────────────────────────────────────────────────
  const cnameTarget = cnameAnswer.records[0]?.data.toLowerCase().replace(/\.+$/, '') ?? null
  let dangling = false
  let unchecked = false
  if (cnameTarget) {
    const [ta, taaaa, tcname] = await Promise.all([
      lookup(cnameTarget, 'A'),
      lookup(cnameTarget, 'AAAA'),
      lookup(cnameTarget, 'CNAME'),
    ])
    // The rule lives in `analyze.ts` (`sgIsDangling`) rather than here, because
    // it is a claim — see its docblock for why NXDOMAIN and not "no address".
    dangling = sgIsDangling(ta, taaaa, tcname)
    unchecked = sgCnameTargetUnchecked(ta, taaaa, tcname)
  }
  const cname: SgCnameReport = {
    target: cnameTarget,
    dangling,
    unchecked,
    service: cnameTarget ? sgTakeoverService(cnameTarget) : null,
    // A CNAME may not coexist with anything. Reported only for types actually
    // observed at this exact name in the same inspection.
    coexisting: cnameTarget
      ? (['A', 'AAAA', 'MX', 'TXT', 'NS'] as SgType[]).filter(t => (primaryOf(t).records ?? []).length > 0)
      : [],
    atApex: name.split('.').length === 2,
  }

  // What every resolver failed with SERVFAIL: the difference between "re-run"
  // and "the zone is failing" for each record that could not be read.
  const outage = sgOutageOf(diffs)
  const findings = sgSortFindings([
    ...sgReachabilityFindings(diffs, name),
    ...sgDiffFindings(diffs),
    ...sgCnameFindings(cname, name),
    ...sgSpfFindings(spf, name, outage),
    ...sgDmarcFindings(dmarc, name, outage),
    ...sgCaaFindings(caa, name, opts.wantedCa ?? null, outage),
    ...sgMxFindings(mxAnswer, mxTargets, outage),
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
    mxStatus: sgMxStatus(mxAnswer),
    cname,
    findings,
    queries: budget.spent,
    budgetLeft: budget.left,
    elapsedMs: Date.now() - started,
    deadlineHit: sgDeadlineReached(signal),
  }
}

/* ------------------------------------------------------------------ */
/* the narrow scope: CAA only                                          */
/* ------------------------------------------------------------------ */

/**
 * How many DoH queries one CAA-only inspection may spend.
 *
 * A CAA walk on a real name is one to three queries — the walk stops at the
 * first ancestor with any CAA record. The ceiling exists for the hand-crafted
 * name: `a.b.c.d.…` up to 253 characters would walk a hundred-odd labels, so
 * the *shape* of the input, not its plausibility, is what bounds the cost.
 *
 * It is also what makes the narrow scope cheap enough to deserve its own, more
 * generous rate limit — and `security:smoke` holds that trade to an inequality
 * rather than to a comment: limit x budget for the narrow scope must not exceed
 * limit x budget for the full one, in BOTH the per-client and the global
 * dimension. Raise one of the four numbers and the assertion says so.
 */
export const SG_CAA_SCOPE_QUERIES = 8

export interface SgCaaInspection {
  name: string
  analysedBy: string
  caa: SgCaaVerdict
  caaWalked: string[]
  findings: SgFinding[]
  queries: number
  elapsedMs: number
  deadlineHit: boolean
}

/**
 * The CAA policy for one name, and nothing else.
 *
 * Exists so Chainsaw can ask the question it cannot answer from a handshake —
 * *will the CA that signed this certificate be allowed to renew it* — without
 * paying for a full 24-query resolver diff and without burning the visitor's
 * whole DNS Sightline allowance on a page that is not DNS Sightline. Same walk,
 * same verdict, same findings module: the answer a Chainsaw visitor sees and the
 * answer a Sightline visitor sees are computed by one call chain, so the two
 * pages cannot tell one person the policy permits their CA and the other that it
 * does not.
 */
export async function sgInspectCaa(name: string, opts: SgInspectOptions = {}): Promise<SgCaaInspection> {
  const started = Date.now()
  const budget = opts.budget ?? sgNewBudget(SG_CAA_SCOPE_QUERIES)
  const signal = sgInspectionSignal(opts.signal, opts.deadlineMs)
  const lookup: SgLookup = sgMakeLookup(SG_PRIMARY_RESOLVER, budget, {
    signal,
    timeoutMs: opts.timeoutMs,
  })
  const report = await sgAnalyzeCaa(name, lookup)
  const caa = sgCaaVerdict(report)
  return {
    name,
    analysedBy: SG_PRIMARY_RESOLVER,
    caa,
    caaWalked: report.walked,
    findings: sgSortFindings(sgCaaFindings(caa, name, opts.wantedCa ?? null)),
    queries: budget.spent,
    elapsedMs: Date.now() - started,
    deadlineHit: sgDeadlineReached(signal),
  }
}
