/**
 * Chainsaw — what the certificates MEAN.
 *
 * The transport (`src/lib/tls-inspect.ts`) is Node-only and answers "what did
 * the server present". Everything that is a *claim* — does this certificate
 * cover the host you typed, is the chain complete enough for a client that
 * does not repair chains, when does it really expire — lives here, in a module
 * with no Node imports, so `security:smoke` can run it against fixtures rather
 * than against a screenshot of a rendered page (AGENTS.md: "a tool's claims
 * live in a module, not in the component"). The browser bundle and the server
 * share this one copy, so the two sides cannot disagree about a verdict.
 *
 * The organising rule is borrowed from `src/lib/jwt.ts`, and it is the thing
 * every other TLS checker gets wrong by collapsing: **trust, hostname coverage
 * and the validity window are three separate answers.** A correctly chained,
 * publicly trusted certificate that expired last week is a normal state and is
 * not a hostname problem; a perfectly valid certificate for the wrong name is
 * not an expiry problem. One "SSL: OK/FAIL" badge hides which of the three
 * broke, which is exactly the moment somebody needs to know.
 */
import { canonicalIp } from '../../../lib/ip'

export interface CsCert {
  subject: string
  subjectCN: string | null
  subjectO: string | null
  issuer: string
  issuerCN: string | null
  issuerO: string | null
  serial: string
  fingerprint256: string
  validFrom: string
  validTo: string
  keyType: string | null
  keyBits: number | null
  keyCurve: string | null
  sigAlg: string | null
  isCa: boolean
  selfSigned: boolean
  san: string[]
  eku: string[]
  ocspUrls: string[]
  caIssuerUrls: string[]
  bytes: number
  pem: string
}

export interface CsHandshakeInfo {
  protocol: string | null
  cipher: string | null
  cipherStandard: string | null
  alpn: string | null
  ephemeralKey: string | null
  ocspStapled: boolean
  authorized: boolean
  authorizationError: string | null
  /** How many certificates the local trust store needed to complete the path. */
  verifiedLength: number
}

export interface CsReport {
  host: string
  port: number
  address: string
  family: 4 | 6
  handshake: CsHandshakeInfo
  /** What the server sent, as observed with an empty trust store. */
  presented: CsCert[]
  anchorIncluded: boolean
  presentedObserved: boolean
  storeRoot: CsCert | null
  namedRoot: string | null
  elapsedMs: number
}

export type CsLevel = 'error' | 'warn' | 'info'
export interface CsFinding {
  id: string
  level: CsLevel
  message: string
}

/**
 * Ports that speak TLS the instant the socket opens. STARTTLS ports (25, 110,
 * 143, 587) are deliberately absent: they need a protocol conversation before
 * the handshake, and half-implementing that would report "no TLS" for servers
 * that have it. An arbitrary port is absent for a blunter reason — it would
 * make the dialler a port scanner pointed at anything the origin can reach.
 *
 * This lives in the ISOMORPHIC module, not with the dialler that enforces it,
 * because the page has to tell the visitor which ports it will accept. Kept
 * next to the enforcement it would have been a hand-typed prose copy in the UI,
 * free to drift the first time a port is added — the duplicated-fact bug
 * AGENTS.md keeps warning about. One array, imported by both sides.
 */
export const CS_ALLOWED_PORTS: number[] = [
  443,   // https
  8443,  // https (alt)
  4443,  // https (alt)
  9443,  // https (alt, management UIs)
  993,   // imaps
  995,   // pop3s
  465,   // smtps (implicit TLS)
  636,   // ldaps
  990,   // ftps
  5061,  // sips
  2083,  // cpanel
  2096,  // webmail
  8883,  // mqtts
]

export const CS_MS_PER_DAY = 86_400_000
/** CA/Browser Forum ceiling for certificates issued since 2020-09-01. */
export const CS_MAX_LEAF_DAYS = 398
/** Below this an RSA key is refused outright by modern clients. */
export const CS_MIN_RSA_BITS = 2048

/* ------------------------------------------------------------------ */
/* names                                                               */
/* ------------------------------------------------------------------ */

function csNormalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

/**
 * Does one SAN pattern cover this host?
 *
 * The wildcard rules are the ones clients actually enforce, and all three are
 * routinely misremembered:
 *
 *  - `*.example.com` covers `www.example.com` and does **not** cover
 *    `example.com` — the wildcard stands for one label, not for "nothing".
 *  - It does not cover `a.b.example.com` either: one label, not a suffix.
 *  - A partial label (`www*.example.com`) is not a wildcard at all to Chrome,
 *    Firefox or Safari; it matches literally, which is to say never.
 *
 * `*.com` is refused as well. Doing that properly needs the public-suffix
 * list, which this tool does not ship; the label-count floor below catches the
 * registry-level case (`*.com`) and misses the multi-part one (`*.co.uk`),
 * which is stated here rather than implied away.
 */
export function csNameMatches(pattern: string, host: string): { match: boolean; wildcard: boolean } {
  const p = csNormalizeHost(pattern)
  const h = csNormalizeHost(host)
  if (!p || !h) return { match: false, wildcard: false }
  if (p === h) return { match: true, wildcard: false }
  if (!p.startsWith('*.')) return { match: false, wildcard: false }

  const pLabels = p.split('.')
  const hLabels = h.split('.')
  // A wildcard that would cover a whole registry is refused by every client.
  if (pLabels.length < 3) return { match: false, wildcard: true }
  if (pLabels.length !== hLabels.length) return { match: false, wildcard: true }
  for (let i = 1; i < pLabels.length; i += 1) {
    if (pLabels[i] !== hLabels[i]) return { match: false, wildcard: true }
  }
  return { match: true, wildcard: true }
}

export interface CsHostMatch {
  covered: boolean
  matched: string | null
  viaWildcard: boolean
  /** The host is in the Common Name and in no SAN — invalid everywhere since 2017. */
  cnOnly: boolean
  dnsNames: string[]
  ipNames: string[]
}

/**
 * One spelling for an IP address, so two spellings of the SAME address compare
 * equal — see `src/lib/ip.ts` for why, and for what is deliberately not folded.
 *
 * The rule moved to `src/lib/ip.ts` on 2026-09-22 because DNS Sightline needs
 * the identical canonicalisation to diff AAAA answer sets across resolvers.
 * Re-exported under the `cs` prefix so this tool's call sites and assertions
 * keep naming it the way the rest of the file names things.
 */
export const csCanonicalIp = canonicalIp

/** Pull the bare names out of Node's `DNS:x, IP Address:y` SAN rendering. */
function csSanValues(san: string[], prefix: string): string[] {
  const out: string[] = []
  for (const entry of san) {
    const at = entry.indexOf(':')
    if (at === -1) continue
    if (entry.slice(0, at).trim().toLowerCase() !== prefix) continue
    const value = entry.slice(at + 1).trim()
    if (value) out.push(value)
  }
  return out
}

export function csMatchHost(host: string, leaf: CsCert): CsHostMatch {
  const dnsNames = csSanValues(leaf.san, 'dns')
  const ipNames = csSanValues(leaf.san, 'ip address')
  const h = csNormalizeHost(host)

  const hIp = csCanonicalIp(h)
  for (const ip of ipNames) {
    const sanIp = csCanonicalIp(ip)
    // Compare canonical forms when both sides really are IP literals; fall back
    // to the literal string so an unparseable SAN can still match exactly
    // rather than silently never matching.
    const same = hIp !== null && sanIp !== null ? hIp === sanIp : ip.trim().toLowerCase() === h
    if (same) {
      return { covered: true, matched: `IP Address:${ip}`, viaWildcard: false, cnOnly: false, dnsNames, ipNames }
    }
  }
  for (const name of dnsNames) {
    const verdict = csNameMatches(name, h)
    if (verdict.match) {
      return { covered: true, matched: `DNS:${name}`, viaWildcard: verdict.wildcard, cnOnly: false, dnsNames, ipNames }
    }
  }
  const cn = leaf.subjectCN
  const cnOnly = !!cn && csNameMatches(cn, h).match
  return { covered: false, matched: null, viaWildcard: false, cnOnly, dnsNames, ipNames }
}

/* ------------------------------------------------------------------ */
/* time                                                                */
/* ------------------------------------------------------------------ */

export function csDaysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso)
  const b = Date.parse(toIso)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN
  return (b - a) / CS_MS_PER_DAY
}

export function csDaysLeft(validTo: string, now: number): number {
  const end = Date.parse(validTo)
  if (!Number.isFinite(end)) return NaN
  return (end - now) / CS_MS_PER_DAY
}

/**
 * The date the site actually stops working, which is not always the leaf's.
 * An intermediate that expires first takes the whole chain with it, and it is
 * invisible on every dashboard that watches only the leaf. Anchors are
 * excluded: a root's expiry is the trust store's problem, not this server's.
 */
export function csEffectiveExpiry(presented: CsCert[]): { validTo: string; cert: CsCert } | null {
  const candidates = presented.filter((c, i) => i === 0 || !c.selfSigned)
  if (candidates.length === 0) return null
  let best = candidates[0]
  for (const c of candidates) {
    if (Date.parse(c.validTo) < Date.parse(best.validTo)) best = c
  }
  return { validTo: best.validTo, cert: best }
}

/* ------------------------------------------------------------------ */
/* chain                                                               */
/* ------------------------------------------------------------------ */

export type CsChainState =
  | 'complete'
  | 'anchor-included'
  | 'leaf-only'
  | 'incomplete'
  | 'self-signed'
  | 'private-ca'
  | 'unknown'

export interface CsChainVerdict {
  state: CsChainState
  detail: string
}

export function csChainState(report: CsReport): CsChainVerdict {
  const presented = report.presented
  if (presented.length === 0) return { state: 'unknown', detail: 'The server presented no certificate this tool could parse.' }
  const leaf = presented[0]
  const top = presented[presented.length - 1]

  if (leaf.selfSigned) {
    return {
      state: 'self-signed',
      detail: 'The certificate signs itself, so nothing vouches for it. Fine for a lab; every client that has not been told about it specifically will refuse it.',
    }
  }
  if (report.handshake.authorized) {
    if (report.anchorIncluded) {
      return {
        state: 'anchor-included',
        detail: 'Trusted — but the server also sends the root, which every client already has. It is handshake bytes nobody reads.',
      }
    }
    return {
      state: 'complete',
      detail: 'The server sends the leaf and every intermediate needed to reach a public root, which is exactly right.',
    }
  }
  if (presented.length === 1) {
    return {
      state: 'leaf-only',
      detail: `The server sent one certificate and stopped. Its issuer — ${top.issuerCN ?? top.issuer} — was not sent, so any client that does not go and fetch it will refuse this connection.`,
    }
  }
  if (top.selfSigned) {
    return {
      state: 'private-ca',
      detail: `The chain ends at ${top.subjectCN ?? top.subject}, which signs itself and is not in the public trust store. That is a private CA: it works for clients that were given that root, and for nobody else.`,
    }
  }
  return {
    state: 'incomplete',
    detail: `The chain stops at ${top.subjectCN ?? top.subject}, whose issuer — ${top.issuerCN ?? top.issuer} — was neither sent nor found in the public trust store. Either an intermediate is missing from what the server serves, or this is a private CA whose root the server does not send.`,
  }
}

/** Does each certificate actually claim to be issued by the next one? */
export function csChainLinks(presented: CsCert[]): { from: CsCert; to: CsCert; linked: boolean }[] {
  const out: { from: CsCert; to: CsCert; linked: boolean }[] = []
  for (let i = 0; i + 1 < presented.length; i += 1) {
    out.push({ from: presented[i], to: presented[i + 1], linked: presented[i].issuer === presented[i + 1].subject })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* the three separate answers                                          */
/* ------------------------------------------------------------------ */

export interface CsVerdict {
  ok: boolean
  label: string
  detail: string
}

const CS_AUTH_ERRORS: Record<string, string> = {
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'the issuer of the top certificate is neither sent by the server nor in the trust store',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'only one certificate was sent and nothing vouches for it',
  SELF_SIGNED_CERT_IN_CHAIN: 'the chain ends at a root that is not in the public trust store',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'the certificate signs itself',
  CERT_HAS_EXPIRED: 'a certificate in the chain has expired',
  CERT_NOT_YET_VALID: 'a certificate in the chain is not valid yet',
  ERR_TLS_CERT_ALTNAME_INVALID: 'the certificate does not cover this hostname',
  CERT_REVOKED: 'a certificate in the chain has been revoked',
  CERT_SIGNATURE_FAILURE: 'a signature in the chain does not verify',
  UNABLE_TO_GET_ISSUER_CERT: 'an issuer certificate could not be found',
}

export function csTrustVerdict(report: CsReport): CsVerdict {
  const h = report.handshake
  if (h.authorized) {
    const anchor = report.namedRoot ?? report.storeRoot?.subjectCN ?? null
    return {
      ok: true,
      label: 'Trusted',
      detail: anchor
        ? `The chain reaches ${anchor}, a root in the public trust store, and every signature along the way verifies.`
        : 'The chain reaches a root in the public trust store and every signature along the way verifies.',
    }
  }
  const code = h.authorizationError ?? ''
  const why = CS_AUTH_ERRORS[code]
  return {
    ok: false,
    label: 'Not trusted',
    detail: why
      ? `A default client refuses this chain: ${why} (${code}).`
      : `A default client refuses this chain${code ? ` (${code})` : ''}.`,
  }
}

export function csHostnameVerdict(report: CsReport, match: CsHostMatch): CsVerdict {
  if (match.covered) {
    return {
      ok: true,
      label: 'Covers this host',
      detail: match.viaWildcard
        ? `${report.host} is covered by the wildcard ${match.matched}. Note a wildcard stands for exactly one label — it does not cover the bare domain or a deeper subdomain.`
        : `${report.host} is listed as ${match.matched}.`,
    }
  }
  if (match.cnOnly) {
    return {
      ok: false,
      label: 'Not covered',
      detail: `${report.host} appears only in the Common Name. Every browser and every modern TLS library has ignored the Common Name since 2017 — the name has to be in a subjectAltName entry or it does not count.`,
    }
  }
  return {
    ok: false,
    label: 'Not covered',
    detail: `Nothing in this certificate matches ${report.host}. It covers ${match.dnsNames.length + match.ipNames.length} name${match.dnsNames.length + match.ipNames.length === 1 ? '' : 's'}, listed below.`,
  }
}

export function csValidityVerdict(report: CsReport, now: number): CsVerdict {
  const effective = csEffectiveExpiry(report.presented)
  if (!effective) return { ok: false, label: 'Unknown', detail: 'No certificate to date.' }
  const leaf = report.presented[0]
  const startsIn = (Date.parse(leaf.validFrom) - now) / CS_MS_PER_DAY
  if (Number.isFinite(startsIn) && startsIn > 0) {
    return {
      ok: false,
      label: 'Not valid yet',
      detail: `This certificate does not begin until ${leaf.validFrom.slice(0, 10)} — ${Math.ceil(startsIn)} day${Math.ceil(startsIn) === 1 ? '' : 's'} from now. Deployed early, or a clock is wrong somewhere.`,
    }
  }
  const days = csDaysLeft(effective.validTo, now)
  const isLeaf = effective.cert.fingerprint256 === leaf.fingerprint256
  const whose = isLeaf ? '' : ` — and it is the intermediate ${effective.cert.subjectCN ?? effective.cert.subject} that goes first, not the leaf`
  if (days < 0) {
    return {
      ok: false,
      label: 'Expired',
      detail: `Expired ${Math.abs(Math.floor(days))} day${Math.abs(Math.floor(days)) === 1 ? '' : 's'} ago, on ${effective.validTo.slice(0, 10)}${whose}.`,
    }
  }
  return {
    ok: true,
    label: days < 15 ? 'Expiring soon' : 'In date',
    detail: `Good for ${Math.floor(days)} more day${Math.floor(days) === 1 ? '' : 's'}, until ${effective.validTo.slice(0, 10)}${whose}.`,
  }
}

/* ------------------------------------------------------------------ */
/* findings                                                            */
/* ------------------------------------------------------------------ */

/**
 * Everything worth saying, named. A correctly configured host yields an EMPTY
 * list — that negative is asserted in `security:smoke`, because a linter that
 * always finds something is indistinguishable from one that is guessing.
 */
export function csFindings(report: CsReport, now: number): CsFinding[] {
  const errors: CsFinding[] = []
  const warns: CsFinding[] = []
  const infos: CsFinding[] = []
  const presented = report.presented
  if (presented.length === 0) return []
  const leaf = presented[0]
  const chain = csChainState(report)
  const match = csMatchHost(report.host, leaf)

  /* --- hostname ------------------------------------------------- */
  if (!match.covered) {
    if (match.cnOnly) {
      errors.push({
        id: 'cn-only',
        level: 'error',
        message: `${report.host} is in the certificate's Common Name but in no subjectAltName entry. Clients stopped reading the Common Name years ago, so this certificate does not cover this host at all.`,
      })
    } else {
      errors.push({
        id: 'hostname-uncovered',
        level: 'error',
        message: `The certificate does not cover ${report.host}. It covers: ${[...match.dnsNames, ...match.ipNames].slice(0, 8).join(', ') || 'nothing this tool could read'}${match.dnsNames.length + match.ipNames.length > 8 ? ', …' : ''}.`,
      })
    }
  }

  /* --- validity window ------------------------------------------ */
  const effective = csEffectiveExpiry(presented)
  if (effective) {
    const days = csDaysLeft(effective.validTo, now)
    const isLeaf = effective.cert.fingerprint256 === leaf.fingerprint256
    if (days < 0) {
      errors.push({
        id: 'expired',
        level: 'error',
        message: `${isLeaf ? 'The certificate' : `The intermediate ${effective.cert.subjectCN ?? effective.cert.subject}`} expired on ${effective.validTo.slice(0, 10)}.`,
      })
    } else if (days < 15) {
      warns.push({
        id: 'expires-soon',
        level: 'warn',
        message: `Only ${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} left, until ${effective.validTo.slice(0, 10)}. Renewal that has not started yet is now an incident with a deadline.`,
      })
    } else if (days < 30) {
      infos.push({
        id: 'expires-this-month',
        level: 'info',
        message: `${Math.floor(days)} days left, until ${effective.validTo.slice(0, 10)}.`,
      })
    }
    if (!isLeaf && days >= 0) {
      warns.push({
        id: 'intermediate-expires-first',
        level: 'warn',
        message: `The intermediate ${effective.cert.subjectCN ?? effective.cert.subject} expires before the leaf does, on ${effective.validTo.slice(0, 10)}. Anything watching only the leaf's expiry date is watching the wrong number.`,
      })
    }
  }
  if (Date.parse(leaf.validFrom) > now) {
    errors.push({
      id: 'not-yet-valid',
      level: 'error',
      message: `The certificate is not valid until ${leaf.validFrom.slice(0, 10)}. Either it was deployed ahead of time or a clock is wrong.`,
    })
  }
  const lifetime = csDaysBetween(leaf.validFrom, leaf.validTo)
  if (Number.isFinite(lifetime) && lifetime > CS_MAX_LEAF_DAYS) {
    warns.push({
      id: 'over-max-lifetime',
      level: 'warn',
      message: `This certificate is valid for ${Math.round(lifetime)} days. Browsers refuse leaf certificates issued after 1 September 2020 with a lifetime over ${CS_MAX_LEAF_DAYS} days, so either it predates that rule or it will not be accepted.`,
    })
  }

  /* --- chain ----------------------------------------------------- */
  if (chain.state === 'leaf-only' || chain.state === 'incomplete') {
    errors.push({
      id: 'chain-incomplete',
      level: 'error',
      message: `${chain.detail} Browsers often paper over this by fetching the missing certificate themselves; curl, Go, Java, Python and OpenSSL do not, which is why "it works in my browser" and "the API client gets a TLS error" are the same bug.`,
    })
    if (leaf.caIssuerUrls.length > 0) {
      infos.push({
        id: 'aia-available',
        level: 'info',
        message: `The missing certificate is published at ${leaf.caIssuerUrls[0]} — append it to your chain file and reload the server.`,
      })
    } else {
      infos.push({
        id: 'no-aia',
        level: 'info',
        message: 'The leaf carries no caIssuers URL, so even the clients that do repair a broken chain have nowhere to fetch the missing certificate from.',
      })
    }
  }
  if (chain.state === 'self-signed') {
    errors.push({ id: 'self-signed', level: 'error', message: chain.detail })
  }
  if (chain.state === 'private-ca') {
    errors.push({ id: 'private-ca', level: 'error', message: chain.detail })
  }
  if (report.anchorIncluded) {
    const anchorBytes = presented.filter(c => c.selfSigned).reduce((n, c) => n + c.bytes, 0)
    warns.push({
      id: 'anchor-included',
      level: 'warn',
      message: `The server sends its own root certificate. Clients ignore it — they trust the copy they already have — so it is roughly ${anchorBytes || 1000} wasted bytes on every single handshake.`,
    })
  }
  if (!report.handshake.authorized && chain.state !== 'leaf-only' && chain.state !== 'incomplete'
    && chain.state !== 'self-signed' && chain.state !== 'private-ca') {
    const verdict = csTrustVerdict(report)
    // Only when no more specific finding above already explains the refusal —
    // a lint that says the same thing twice teaches the reader to skim it.
    const explained = errors.some(f => f.id === 'expired' || f.id === 'not-yet-valid' || f.id === 'hostname-uncovered' || f.id === 'cn-only')
    if (!explained) errors.push({ id: 'untrusted', level: 'error', message: verdict.detail })
  }

  /* --- keys and algorithms ---------------------------------------
     A self-signed ANCHOR is skipped, for the same reason `csEffectiveExpiry`
     skips it: a root's trust comes from being in the store, not from its own
     signature, so clients explicitly exempt a root's self-signature from the
     SHA-1 rule. Plenty of roots in every shipping trust store are SHA-1
     self-signed and perfectly valid. Walking them here produced a false
     `weak-signature` ERROR on healthy hosts that merely send their root —
     and called the root "the intermediate" while doing it. */
  for (const cert of presented) {
    if (cert !== leaf && cert.selfSigned) continue
    const who = cert === leaf ? 'The leaf certificate' : `The intermediate ${cert.subjectCN ?? cert.subject}`
    if (cert.sigAlg && /^(sha1|md5)/i.test(cert.sigAlg)) {
      errors.push({
        id: 'weak-signature',
        level: 'error',
        message: `${who} is signed with ${cert.sigAlg}. SHA-1 signatures have been rejected by browsers since 2017 and MD5 long before that.`,
      })
    }
    if (cert.keyType === 'rsa' && cert.keyBits !== null && cert.keyBits < CS_MIN_RSA_BITS) {
      errors.push({
        id: 'weak-key',
        level: 'error',
        message: `${who} has a ${cert.keyBits}-bit RSA key. ${CS_MIN_RSA_BITS} bits is the floor every public CA and client enforces.`,
      })
    }
  }
  if (leaf.eku.length > 0 && !leaf.eku.includes('serverAuth')) {
    warns.push({
      id: 'no-serverauth',
      level: 'warn',
      message: `The leaf's extended key usage is ${leaf.eku.join(', ')} and does not include serverAuth, so it is not a certificate for a TLS server at all.`,
    })
  }

  /* --- the handshake itself --------------------------------------- */
  const proto = report.handshake.protocol ?? ''
  if (proto === 'TLSv1' || proto === 'TLSv1.1') {
    warns.push({
      id: 'old-tls',
      level: 'warn',
      message: `The handshake settled on ${proto}. Every major browser has refused it since 2020 — this connection succeeded only because this tool does not.`,
    })
  } else if (proto === 'TLSv1.2') {
    infos.push({
      id: 'no-tls13',
      level: 'info',
      message: 'The best protocol on offer was TLS 1.2. TLS 1.3 is a round trip faster and drops the legacy cipher negotiation entirely.',
    })
  }
  if (!report.handshake.ocspStapled) {
    infos.push({
      id: 'no-ocsp-staple',
      level: 'info',
      message: 'No stapled OCSP response. Without one, a client that checks revocation has to ask the CA itself, which costs it a round trip to a third party and tells that third party who is visiting you.',
    })
  }
  if (match.dnsNames.length > 50) {
    infos.push({
      id: 'many-names',
      level: 'info',
      message: `${match.dnsNames.length} names on one certificate. Every one of them is public in Certificate Transparency logs, and revoking any one of them revokes all of them.`,
    })
  }
  if (!report.presentedObserved) {
    infos.push({
      id: 'presented-unobserved',
      level: 'info',
      message: 'The no-trust probe could not be completed, so the chain below is the one the local trust store built rather than the one the server sent. Findings about a missing or superfluous certificate are withheld rather than guessed.',
    })
  }

  return errors.concat(warns, infos)
}

/* ------------------------------------------------------------------ */
/* output                                                              */
/* ------------------------------------------------------------------ */

export function csChainPem(certs: CsCert[]): string {
  return certs.map(c => c.pem.trim()).join('\n') + '\n'
}

/**
 * The chain the server should be sending: the leaf, then every intermediate,
 * and no anchor. This can only ever be assembled from certificates the server
 * already sent — when the chain is incomplete the missing intermediate is, by
 * definition, not here, and the UI says so instead of offering a file that
 * would still be wrong.
 */
export function csServeChainPem(presented: CsCert[]): string {
  return csChainPem(presented.filter((c, i) => i === 0 || !c.selfSigned))
}

/**
 * A certificate's CA Issuers URL (its Authority Information Access), as an href
 * — or null, and the page shows it as text.
 *
 * The value comes off a certificate a stranger's server sent, so it is a link
 * only when it parses as plain `http:` or `https:` (AIA is usually `http:`:
 * the file it names is signed, so it needs no TLS) with no credentials, AND
 * the certificate's text is already exactly the URL the parser produces. The
 * second condition is what keeps a link honest. URL parsing rewrites a string
 * before anything navigates to it — `\` becomes `/`, an ideographic full stop
 * becomes `.`, fullwidth letters fold, `0x7f.1` becomes `127.0.0.1` — so
 * `http://evil.test\@pki.goog/r1.crt` reads as pki.goog and goes to
 * evil.test. When the parser changes anything the value stays text, and when
 * it changes nothing the visible text and the destination are one string.
 * `javascript:`, `data:` and anything malformed stay text too. The caller
 * still escapes the href for the attribute.
 */
export function csLinkableUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    return url.href === raw ? url.href : null
  } catch {
    return null
  }
}

export function csOpensslCommand(host: string, port: number): string {
  return `openssl s_client -connect ${host}:${port} -servername ${host} -showcerts </dev/null`
}
