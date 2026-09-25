/**
 * CAA — the issuance-policy vocabulary, shared by DNS Sightline and Chainsaw.
 *
 * Hoisted out of `components/tools/dns-sightline/analyze.ts` for the same reason
 * `canonicalIp` was hoisted out of Chainsaw into `src/lib/ip.ts`: a second tool
 * needs the rule, and two copies of a rule this subtle would diverge the first
 * time one of them was "tidied". Sightline re-exports every name it used to own
 * (`SG_KNOWN_CAS`, `sgParseCaa`, `sgCaaAllows`, `SgCaaVerdict`), so its own
 * assertions still run against `sg.*` and pin both names to ONE implementation.
 *
 * What is new here is the join between the two tools: Sightline knows which CA a
 * zone's CAA policy PERMITS, and Chainsaw knows which CA actually ISSUED the
 * certificate on the wire. Neither fact is a finding on its own. Together they
 * answer the question people only discover the answer to at 3am on renewal day.
 *
 * ── The claim this module refuses to make ─────────────────────────────────────
 * A certificate whose issuer the current policy forbids is **not** a
 * mis-issuance. CAA is consulted at ISSUANCE time, inside an eight-hour window
 * (RFC 8659 §3, CA/BF BR 3.2.2.8) and never again — so a policy published after
 * the certificate was issued says nothing at all about that certificate. It says
 * something about the NEXT one. Every message here is therefore about a
 * *renewal that will fail*, never about the certificate being served, and the
 * word "mis-issued" appears nowhere. Getting this backwards would have the tool
 * accuse a correctly-run CA of breaking the rules because somebody tightened a
 * DNS record last Tuesday, which is the most damaging sentence it could print.
 */

/**
 * The CAA identifiers, as each CA publishes them.
 *
 * An identifier is a domain the CA CHOSE to be known by in CAA records. It is
 * not derivable from anything on the certificate — "Google Trust Services LLC"
 * signs with the identifier `pki.goog`, and no amount of string processing gets
 * you from one to the other. Hence a table, and hence `caIdentify` returning
 * null rather than guessing.
 */
export const CA_REGISTRY: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'letsencrypt.org', label: "Let's Encrypt" },
  { id: 'pki.goog', label: 'Google Trust Services' },
  { id: 'digicert.com', label: 'DigiCert' },
  { id: 'sectigo.com', label: 'Sectigo' },
  { id: 'amazon.com', label: 'Amazon (ACM)' },
  { id: 'amazonaws.com', label: 'Amazon (ACM, alternate id)' },
  { id: 'globalsign.com', label: 'GlobalSign' },
  { id: 'ssl.com', label: 'SSL.com' },
  { id: 'buypass.com', label: 'Buypass' },
  { id: 'certainly.com', label: 'Certainly (Fastly)' },
  { id: 'actalis.it', label: 'Actalis' },
  { id: 'entrust.net', label: 'Entrust' },
  { id: 'godaddy.com', label: 'GoDaddy' },
  { id: 'starfieldtech.com', label: 'GoDaddy (Starfield id)' },
]

/* ------------------------------------------------------------------ */
/* reading a CAA record                                                */
/* ------------------------------------------------------------------ */

export interface CaaEntry {
  flags: number
  tag: string
  value: string
  raw: string
}

export function parseCaa(data: string): CaaEntry | null {
  // Resolvers render CAA as `0 issue "letsencrypt.org"`; some hand back the
  // wire form. Only the textual form is parsed, and anything else is refused
  // rather than guessed at.
  const m = data.trim().match(/^(\d+)\s+([a-z0-9]+)\s+"?([^"]*)"?\s*$/i)
  if (!m) return null
  return { flags: Number(m[1]), tag: m[2].toLowerCase(), value: m[3].trim(), raw: data.trim() }
}

export interface CaaVerdict {
  /** null when no policy governs the name — every CA may issue. */
  policyAt: string | null
  allowed: string[]
  allowedWild: string[]
  /** `issue ";"` — a deliberate instruction that NO CA may issue. */
  forbidsAll: boolean
  forbidsAllWild: boolean
  iodef: string[]
  /** Critical-flagged tags this tool does not understand — a CA must refuse. */
  unknownCritical: string[]
  /** The literal record lines the verdict rests on, for a finding to cite. */
  raws: string[]
  /**
   * A lookup on the way up the tree failed or was refused by the query budget.
   *
   * Load-bearing, and it is the difference between two opposite sentences. A
   * walk that reached the apex and found nothing means "no policy governs this
   * name, so any CA may issue" — a fact. A walk whose queries FAILED also ends
   * with no entries, and reporting that as "no policy" turns a network error
   * into a reassuring claim about somebody's zone. The absence of evidence is
   * not evidence of absence, so an incomplete walk refuses to conclude.
   */
  incomplete: boolean
}

export function caaVerdict(
  entries: CaaEntry[],
  foundAt: string | null,
  incomplete = false,
): CaaVerdict {
  const issue = entries.filter(e => e.tag === 'issue')
  const issuewild = entries.filter(e => e.tag === 'issuewild')
  const known = new Set(['issue', 'issuewild', 'iodef', 'issuemail', 'issuevmc', 'contactemail', 'contactphone'])
  return {
    policyAt: foundAt,
    allowed: issue.filter(e => e.value && e.value !== ';').map(e => e.value.split(';')[0].trim().toLowerCase()),
    allowedWild: issuewild.filter(e => e.value && e.value !== ';').map(e => e.value.split(';')[0].trim().toLowerCase()),
    forbidsAll: issue.length > 0 && issue.every(e => !e.value || e.value === ';'),
    forbidsAllWild: issuewild.length > 0 && issuewild.every(e => !e.value || e.value === ';'),
    iodef: entries.filter(e => e.tag === 'iodef').map(e => e.value),
    // The critical bit is 128, and its meaning is "refuse to issue if you do
    // not understand this tag" — so an unrecognised critical tag blocks every
    // CA, which is a spectacular way to break a renewal silently.
    unknownCritical: entries.filter(e => (e.flags & 128) !== 0 && !known.has(e.tag)).map(e => e.tag),
    raws: entries.map(e => e.raw),
    // A policy that was FOUND is complete by construction: the walk stops at
    // the first name with any CAA record, so nothing below it can change the
    // answer. Only a walk that ended empty can be inconclusive.
    incomplete: incomplete && !foundAt,
  }
}

/**
 * Can this CA issue for this name? `wildcard` asks the other question, and the
 * two rules are not the same rule:
 *
 *   `issuewild` present  → it **replaces** `issue` for wildcards entirely.
 *   `issuewild` absent   → `issue` governs wildcards too.
 *
 * So `issue "letsencrypt.org"` plus `issuewild ";"` means Let's Encrypt may
 * issue `www.example.com` and no CA on earth may issue `*.example.com`. Reading
 * `issuewild` as an addition to `issue` rather than a replacement gets that
 * exactly backwards, which is why this is one function and not an `if` in the
 * component.
 */
export function caaAllows(v: CaaVerdict, caId: string, wildcard: boolean): boolean {
  if (!v.policyAt) return true
  if (v.unknownCritical.length) return false
  const id = caId.trim().toLowerCase()
  if (wildcard) {
    if (v.allowedWild.length || v.forbidsAllWild) return v.allowedWild.includes(id)
    // No issuewild at all: fall through to the issue property.
  }
  if (v.forbidsAll) return false
  if (!v.allowed.length) return true
  return v.allowed.includes(id)
}

/* ------------------------------------------------------------------ */
/* who signed this certificate?                                        */
/* ------------------------------------------------------------------ */

/**
 * Issuer name → CAA identifier.
 *
 * Matched against the issuer's **organisation** first, because that is the
 * field a CA keeps stable across intermediate rotations: Let's Encrypt's
 * intermediates are called `R10`, `R11`, `E5`, `E6` and will be called
 * something else next year, while O stays "Let's Encrypt". The CN patterns are
 * the fallback for issuers that ship no O at all.
 *
 * Brands matter here and are not cosmetic. DigiCert issues under GeoTrust,
 * RapidSSL and Thawte, and all three renew against `digicert.com`; Sectigo
 * still signs some chains as "COMODO CA Limited", and ZeroSSL's certificates
 * come off Sectigo's hierarchy, so both renew against `sectigo.com`. A table
 * that only knew the current corporate names would report those as unidentified.
 *
 * This table is the fallible part of this module, which is exactly why an
 * unmatched issuer produces `null` and the UI says it could not identify the
 * CA. The alternative — a fuzzy match onto the nearest registry entry — would
 * manufacture a confident "your policy forbids your CA" out of a table gap.
 */
export const CA_ISSUER_PATTERNS: ReadonlyArray<{
  caId: string
  /** Matched against the issuer organisation (O). */
  org?: RegExp
  /** Matched against the issuer common name (CN), for issuers with no O. */
  cn?: RegExp
}> = [
  { caId: 'letsencrypt.org', org: /let'?s\s*encrypt/i, cn: /^(r|e)\d{1,2}$/i },
  { caId: 'pki.goog', org: /google\s+trust\s+services/i, cn: /^gts\s/i },
  { caId: 'digicert.com', org: /digicert|geotrust|rapidssl|thawte|cybertrust/i },
  { caId: 'sectigo.com', org: /sectigo|comodo|zerossl|usertrust|trusted\s*secure/i },
  { caId: 'amazon.com', org: /^amazon/i },
  { caId: 'globalsign.com', org: /globalsign/i },
  { caId: 'ssl.com', org: /ssl\s*corp|ssl\.com/i },
  { caId: 'buypass.com', org: /buypass/i },
  { caId: 'certainly.com', org: /certainly/i },
  { caId: 'actalis.it', org: /actalis/i },
  { caId: 'entrust.net', org: /entrust|affirmtrust/i },
  { caId: 'godaddy.com', org: /go\s*daddy|starfield/i },
]

export interface CaIdentity {
  /** The CAA identifier this issuer renews against, or null if unrecognised. */
  caId: string | null
  /** The registry label for `caId`, for a sentence to read naturally. */
  label: string | null
  /** Which field matched, so the page can show its work. */
  matchedOn: 'organisation' | 'common name' | null
  /** The issuer string as it appeared on the certificate. */
  issuerText: string
}

export function caIdentify(issuer: { issuerO?: string | null; issuerCN?: string | null }): CaIdentity {
  const org = (issuer.issuerO ?? '').trim()
  const cn = (issuer.issuerCN ?? '').trim()
  const issuerText = org && cn ? `${cn} (${org})` : org || cn
  const label = (id: string) => CA_REGISTRY.find(c => c.id === id)?.label ?? null

  // Organisation first, for every pattern, before any CN is tried: a CN rule is
  // a loose fallback (`^r\d+$` is two characters and a digit) and must never
  // outrank another CA's exact organisation match.
  for (const p of CA_ISSUER_PATTERNS) {
    if (org && p.org?.test(org)) return { caId: p.caId, label: label(p.caId), matchedOn: 'organisation', issuerText }
  }
  for (const p of CA_ISSUER_PATTERNS) {
    if (cn && p.cn?.test(cn)) return { caId: p.caId, label: label(p.caId), matchedOn: 'common name', issuerText }
  }
  return { caId: null, label: null, matchedOn: null, issuerText }
}

/* ------------------------------------------------------------------ */
/* the join: will the next renewal be allowed?                         */
/* ------------------------------------------------------------------ */

export type CaaOutlookState =
  /** No CAA governs the name, so any CA may issue. Nothing to warn about. */
  | 'no-policy'
  /** The policy permits the CA that issued the certificate on the wire. */
  | 'permitted'
  /** The policy does not list that CA — the next renewal is refused. */
  | 'refused'
  /** Plain names renew fine; the wildcard this certificate carries does not. */
  | 'refused-wildcard'
  /** `issue ";"` — nobody may issue, including the incumbent. */
  | 'forbidden-all'
  /** A critical tag no CA understands blocks every CA outright. */
  | 'blocked-critical'
  /** The issuer could not be mapped to a CAA identifier, so no verdict. */
  | 'issuer-unknown'
  /** A self-signed certificate — no CA is involved and CAA does not apply. */
  | 'self-signed'
  /** The CAA lookup did not complete. Explicitly not "no policy". */
  | 'unavailable'

export interface CaaOutlook {
  state: CaaOutlookState
  /** True when the state is one the owner should act on. */
  problem: boolean
  headline: string
  detail: string
  /** The literal CAA records this rests on; empty when it rests on an absence. */
  evidence: string[]
  ca: CaIdentity
  /** Whether the certificate carries a wildcard name, so both rules applied. */
  wildcard: boolean
  /** The name the governing policy was found at, or null when none governs it. */
  policyAt: string | null
}

export interface CaaOutlookInput {
  verdict: CaaVerdict
  /** The leaf's issuer fields — the CA that signed what is on the wire. */
  issuer: { issuerO?: string | null; issuerCN?: string | null }
  /** True when any SAN on the leaf is a wildcard, so `issuewild` is in play. */
  leafHasWildcard: boolean
  /** True when the leaf signed itself: there is no CA to ask about. */
  selfSigned: boolean
  /** The name inspected, for the sentences. */
  host: string
}

/**
 * The one function both halves meet in.
 *
 * Order of precedence is the whole design, and it is not "check the issuer, then
 * check the policy". Two of these conclusions do not depend on who the issuer
 * is — a critical tag nobody understands, and `issue ";"` — and both must be
 * reported even when the issuer could not be identified, because they are the
 * findings most likely to be the reason a renewal just failed. An
 * implementation that bailed out to `issuer-unknown` first would go silent on
 * exactly the zones that are most broken.
 */
export function caaRenewalOutlook(input: CaaOutlookInput): CaaOutlook {
  const { verdict: v, leafHasWildcard, host } = input
  const ca = caIdentify(input.issuer)
  const base = { evidence: v.raws, ca, wildcard: leafHasWildcard, policyAt: v.policyAt }
  const at = v.policyAt ?? host

  if (v.incomplete) {
    return {
      ...base,
      evidence: [],
      state: 'unavailable',
      problem: false,
      headline: 'CAA policy could not be read',
      detail: `At least one CAA lookup for ${host} failed, so this is not evidence that no policy exists — it is no answer at all. Re-run the check, or read the policy directly in DNS Sightline.`,
    }
  }

  if (!v.policyAt) {
    return {
      ...base,
      evidence: [],
      state: 'no-policy',
      problem: false,
      headline: 'No CAA policy governs this name',
      detail: `Neither ${host} nor any parent up to the registered domain publishes a CAA record, so any CA may issue for it — including whoever issued the certificate above. Publishing one is a cheap way to stop a mis-issuance you would otherwise never hear about.`,
    }
  }

  if (v.unknownCritical.length) {
    return {
      ...base,
      state: 'blocked-critical',
      problem: true,
      headline: 'Every CA is blocked by a critical tag',
      detail: `The policy at ${at} carries the critical flag on ${v.unknownCritical.join(', ')}, and the critical bit means "refuse to issue if you do not understand this tag". No CA may issue for this name at all — including the one that signed the certificate above, whose renewal will fail. This holds whoever your CA is.`,
    }
  }

  if (v.forbidsAll) {
    const wildEscape = v.allowedWild.length
      ? ` (an \`issuewild\` entry still permits ${v.allowedWild.join(', ')} to issue wildcards, which is the only issuance this policy allows)`
      : ''
    return {
      ...base,
      state: 'forbidden-all',
      problem: true,
      headline: 'The policy forbids issuance by anybody',
      detail: `${at} publishes \`issue ";"\`, which is a deliberate instruction that no CA may issue for this name${wildEscape}. The certificate above predates that instruction — CAA is checked when a certificate is issued and never afterwards — but the next renewal is refused.`,
    }
  }

  if (input.selfSigned) {
    return {
      ...base,
      state: 'self-signed',
      problem: false,
      headline: 'Self-signed — no CA to check',
      detail: `The certificate above signed itself, so no CA issued it and CAA has nothing to say about it. The policy at ${at} would apply to a publicly-trusted certificate for this name.`,
    }
  }

  if (!ca.caId) {
    return {
      ...base,
      state: 'issuer-unknown',
      problem: false,
      headline: 'Issuer not recognised — no verdict',
      detail: `${at} publishes a CAA policy, but the issuer of the certificate above (${ca.issuerText || 'unnamed'}) is not one of the ${CA_REGISTRY.length} certificate authorities this tool can map to a CAA identifier. Rather than guess at the nearest match and report a renewal failure that may not exist, it reports nothing: check the identifier your CA documents against the permitted list below.`,
    }
  }

  const plain = caaAllows(v, ca.caId, false)
  const wild = leafHasWildcard ? caaAllows(v, ca.caId, true) : true
  const who = `${ca.label ?? ca.caId} (\`${ca.caId}\`)`

  if (!plain) {
    return {
      ...base,
      state: 'refused',
      problem: true,
      headline: `${ca.label ?? ca.caId} is not permitted to renew this`,
      detail: `The certificate on the wire was issued by ${who}, and the CAA policy at ${at} permits ${v.allowed.length ? v.allowed.map(a => `\`${a}\``).join(', ') : 'nobody'}. That is not a mis-issuance — the policy may well have been published after the certificate was, and a CA only consults CAA in the eight hours before it signs. It is a renewal that will fail: either add \`${ca.caId}\` to the policy, or move the renewal to a CA the policy already names.`,
    }
  }

  if (!wild) {
    return {
      ...base,
      state: 'refused-wildcard',
      problem: true,
      headline: 'The wildcard on this certificate cannot be renewed',
      detail: `${who} may issue plain names under the policy at ${at}, but this certificate carries a wildcard name and \`issuewild\` REPLACES \`issue\` for wildcards rather than adding to it — so the wildcard is governed by ${v.forbidsAllWild ? 'an `issuewild ";"` that permits nobody' : `\`issuewild\` entries naming ${v.allowedWild.map(a => `\`${a}\``).join(', ')}`}. The non-wildcard names on this certificate renew fine; the wildcard does not.`,
    }
  }

  return {
    ...base,
    state: 'permitted',
    problem: false,
    headline: `${ca.label ?? ca.caId} may renew this`,
    detail: `The certificate on the wire was issued by ${who}, and the CAA policy at ${at} permits it${leafHasWildcard ? ' for both plain and wildcard names' : ''}${v.allowed.length ? '' : ' (the policy publishes no `issue` restriction, so every CA is permitted)'}. Renewal will not be refused on CAA grounds.`,
  }
}
