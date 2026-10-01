/**
 * The shapes DNS Sightline's two halves both need.
 *
 * The transport (`src/lib/dns-doh.ts`) produces these; the claims module
 * (`src/components/tools/dns-sightline/analyze.ts`) consumes them, and the
 * browser renders them. Three copies of an "answer" type, free to drift the
 * first time a field is added, is the duplicated-fact bug AGENTS.md keeps
 * warning about — so the shape is declared once, here, where neither side has
 * to import the other.
 *
 * Types only. Nothing in this file emits runtime code.
 */

export type SgType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'NS' | 'TXT' | 'CAA' | 'SOA'

export interface SgRecord {
  /** Numeric RR type as the resolver reported it (1 = A, 28 = AAAA, …). */
  type: number
  name: string
  data: string
  ttl: number
}

/** One resolver's answer to one question. */
export interface SgAnswer {
  /** Allowlist key, never a URL. */
  resolver: string
  type: SgType
  name: string
  /**
   * Textual RCODE — NOERROR, NXDOMAIN, SERVFAIL, REFUSED, … — or `ERROR` when
   * no DNS reply arrived at all, which is always the case when `error` is set.
   */
  rcode: string
  records: SgRecord[]
  elapsedMs: number
  /** Set when the resolver could not be reached or spoke nonsense. */
  error?: string
  /**
   * Set, beside `error`, when THIS TOOL stopped the question rather than the
   * resolver failing it: the inspection's deadline arrived, the visitor left,
   * or the query budget ran out. Both come back with no records, and they are
   * different things to tell somebody — "the inspection ran out of time" is not
   * "the resolvers could not be reached".
   */
  stopped?: 'deadline' | 'cancelled' | 'budget'
}

/**
 * A DNS lookup the analysis may make.
 *
 * The analysis never fetches anything itself — the recursive parts (the SPF
 * include tree, the CAA walk up to the apex, MX target resolution) take this
 * callback instead. That is what lets `security:smoke` drive them over a
 * hand-built zone with no network at all, and it is also the only way to prove
 * the SPF walker terminates on a zone designed to make it loop.
 */
export type SgLookup = (name: string, type: SgType) => Promise<SgAnswer>
