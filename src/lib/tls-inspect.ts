/**
 * Chainsaw — the TLS dial, and the guard that makes it shippable.
 *
 * This module lets an anonymous visitor make the ORIGIN open a TLS connection
 * to a host they typed, which is the same SSRF surface Link Peek opened over
 * HTTP. It therefore reuses Link Peek's address classifier rather than growing
 * a second one — `lpIsForbiddenHostname` / `lpIsForbiddenIp` live in
 * `link-peek-fetch.ts` and are the ONE copy of "addresses the origin must never
 * connect to" (v4 + v6, private/link-local/CGNAT/mapped/reserved, and the
 * decimal/hex/octal IPv4 spellings). A second copy could only ever drift.
 *
 * Three things are different here, and two of them are stricter:
 *
 *  - **The address is PINNED.** Link Peek resolves, checks, then hands the URL
 *    to `fetch`, which resolves again — the DNS-rebinding TOCTOU that module
 *    documents as its honest ceiling. Here the connection is made to the exact
 *    address that was checked, with the hostname carried separately as the SNI
 *    `servername`, so there is no second resolution to disagree with the first.
 *  - **The port is an allowlist, not "default only".** A cert inspector that
 *    can only reach 443 is useless for the 8443/993/465 cases people actually
 *    debug, and an *arbitrary* port would make this a port scanner. A fixed
 *    list of ports that speak TLS immediately on connect is the middle.
 *  - Two handshakes are made, not one. See `csInspect` for why — it is a
 *    correctness requirement, not a nicety.
 *
 * Node-only (`node:tls`, `node:net`, and `node:dns` through `dns-lookup.ts`,
 * the bounded lookup Link Peek shares) — imported by the API route, never by
 * the browser bundle. A Cloudflare Workers
 * deploy has no raw-socket TLS, so this tool is the one surface that would need
 * a different transport behind the same JSON shape if the adapter is swapped.
 */

import tls from 'node:tls'
import type { ConnectionOptions, DetailedPeerCertificate, EphemeralKeyInfo, PeerCertificate, TLSSocket } from 'node:tls'
import { X509Certificate } from 'node:crypto'
import { isIP } from 'node:net'
import { DnsLookupTimeout, lookupAllBounded, type DnsLookupOptions } from './dns-lookup'
import { lpIsForbiddenHostname, lpIsForbiddenIp } from './link-peek-fetch'
// The wire shape has ONE definition, and it lives with the module that reasons
// about it — the browser and this file must not carry two copies that drift.
import type { CsCert } from '../components/tools/chainsaw/analyze'
import { CS_ALLOWED_PORTS } from '../components/tools/chainsaw/analyze'

export type { CsCert }

export const CS_MAX_HOST_CHARS = 253
export const CS_TIMEOUT_MS = 8000
/** Beyond this the chain is not a chain, it is a payload. */
export const CS_MAX_CHAIN = 12

// The port allowlist lives in the isomorphic module so the page can name the
// ports it accepts without a second hand-typed copy. This file ENFORCES it.
export { CS_ALLOWED_PORTS }

export type CsTargetCheck =
  | { ok: true; host: string; port: number; isIpLiteral: boolean }
  | { ok: false; reason: string }

/**
 * Syntactic gate. Accepts what people actually paste — `example.com`,
 * `example.com:8443`, `https://example.com/deep/path?q=1` — and reduces it to
 * a host and a port. No network here.
 */
export function csValidateTarget(raw: string): CsTargetCheck {
  let text = raw.trim()
  if (!text) return { ok: false, reason: 'Enter a hostname to inspect.' }
  if (text.length > CS_MAX_HOST_CHARS + 16) return { ok: false, reason: 'That target is too long to be a hostname.' }

  // A pasted URL is the common case; anything that is not http(s) is refused
  // rather than silently reinterpreted as a hostname.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    let parsed: URL
    try {
      parsed = new URL(text)
    } catch {
      return { ok: false, reason: 'That does not parse as a URL.' }
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, reason: 'Paste a hostname, or an http/https URL.' }
    }
    if (parsed.username || parsed.password) {
      return { ok: false, reason: 'Targets with embedded credentials are not dialled.' }
    }
    text = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
  }

  let host = text
  let port = 443

  // Bracketed IPv6, with or without a port: [::1] / [::1]:8443
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(host)
  if (bracketed) {
    host = bracketed[1]
    if (bracketed[2]) port = Number.parseInt(bracketed[2], 10)
  } else {
    const colons = host.split(':')
    if (colons.length === 2) {
      host = colons[0]
      port = Number.parseInt(colons[1], 10)
    } else if (colons.length > 2 && isIP(host) !== 6) {
      return { ok: false, reason: 'That is not a hostname — wrap an IPv6 literal in brackets, like [2606:4700::1111].' }
    }
  }

  host = host.replace(/\.$/, '').toLowerCase()
  if (!host) return { ok: false, reason: 'That target has no host.' }
  if (host.length > CS_MAX_HOST_CHARS) return { ok: false, reason: 'That hostname is longer than a hostname may be.' }
  if (!Number.isInteger(port)) return { ok: false, reason: 'That port is not a number.' }
  if (!CS_ALLOWED_PORTS.includes(port)) {
    return { ok: false, reason: `Port ${port} is not on this tool's list of ports that speak TLS on connect (${CS_ALLOWED_PORTS.join(', ')}).` }
  }

  const family = isIP(host)
  if (family === 0) {
    // Only characters a hostname may contain — this is also what keeps a
    // header-injection-shaped string out of the SNI value below.
    if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('-') || host.endsWith('-')) {
      return { ok: false, reason: 'That does not look like a hostname.' }
    }
  }
  return { ok: true, host, port, isIpLiteral: family !== 0 }
}

/**
 * Resolve, check EVERY answer, and return the address the connection will be
 * pinned to. Any private answer refuses the whole dial: a name that maps to
 * both a public and a private address is exactly the rebinding setup.
 *
 * The lookup goes through `lookupAllBounded`, the bound Link Peek shares. It
 * used to be awaited bare here, so one name whose nameservers black-hole
 * packets held a request — and a libuv threadpool slot — for as long as the OS
 * resolver liked, and `CS_TIMEOUT_MS` was never consulted. `dns` is its test
 * seam, and `csInspect` never passes it.
 */
export async function csResolvePinned(host: string, dns: DnsLookupOptions = {}): Promise<{ ok: true; address: string; family: 4 | 6 } | { ok: false; reason: string }> {
  if (lpIsForbiddenHostname(host)) {
    return { ok: false, reason: 'That host is private or local — this tool only dials public hosts.' }
  }
  const literal = isIP(host)
  if (literal) {
    return lpIsForbiddenIp(host)
      ? { ok: false, reason: 'That address is private or reserved — this tool only dials public hosts.' }
      : { ok: true, address: host, family: literal as 4 | 6 }
  }
  let answers: { address: string; family: number }[]
  try {
    answers = await lookupAllBounded(host, dns)
  } catch (err) {
    // No answer in time is not the same claim as "no such name".
    return {
      ok: false,
      reason: err instanceof DnsLookupTimeout
        ? `The name "${host}" did not resolve within ${Math.round(err.timeoutMs / 1000)}s.`
        : `The name "${host}" does not resolve.`,
    }
  }
  if (answers.length === 0) return { ok: false, reason: `The name "${host}" does not resolve.` }
  for (const a of answers) {
    if (lpIsForbiddenIp(a.address)) {
      return { ok: false, reason: 'That name resolves to a private or reserved address — this tool only dials public hosts.' }
    }
  }
  const first = answers[0]
  return { ok: true, address: first.address, family: first.family === 6 ? 6 : 4 }
}

/* ------------------------------------------------------------------ */
/* DER: the one field X509Certificate does not expose                  */
/* ------------------------------------------------------------------ */

const CS_SIG_OIDS: Record<string, string> = {
  '1.2.840.113549.1.1.4': 'md5WithRSA',
  '1.2.840.113549.1.1.5': 'sha1WithRSA',
  '1.2.840.113549.1.1.11': 'sha256WithRSA',
  '1.2.840.113549.1.1.12': 'sha384WithRSA',
  '1.2.840.113549.1.1.13': 'sha512WithRSA',
  '1.2.840.113549.1.1.10': 'RSASSA-PSS',
  '1.2.840.10045.4.1': 'ecdsa-with-SHA1',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384',
  '1.2.840.10045.4.3.4': 'ecdsa-with-SHA512',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
}

/** Read one DER TLV header at `pos`; null when the bytes do not describe one. */
function csReadTlv(der: Uint8Array, pos: number): { tag: number; start: number; end: number } | null {
  if (pos + 1 >= der.length) return null
  const tag = der[pos]
  let len = der[pos + 1]
  let start = pos + 2
  if (len & 0x80) {
    const n = len & 0x7f
    // Indefinite length is legal BER and illegal DER; refuse rather than guess.
    if (n === 0 || n > 4 || start + n > der.length) return null
    len = 0
    for (let i = 0; i < n; i += 1) len = (len << 8) | der[start + i]
    start += n
  }
  const end = start + len
  if (len < 0 || end > der.length) return null
  return { tag, start, end }
}

function csDecodeOid(der: Uint8Array, start: number, end: number): string | null {
  if (start >= end) return null
  const parts: number[] = []
  const first = der[start]
  parts.push(Math.floor(first / 40), first % 40)
  let value = 0
  for (let i = start + 1; i < end; i += 1) {
    const b = der[i]
    value = value * 128 + (b & 0x7f)
    if (!(b & 0x80)) {
      parts.push(value)
      value = 0
    }
  }
  return parts.join('.')
}

/**
 * The signature algorithm, which `X509Certificate` does not surface and which
 * is the only place a SHA-1 certificate announces itself.
 *
 *   Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
 *
 * so it is: outer SEQUENCE → skip the first element (the TBS) → the second
 * element is an AlgorithmIdentifier SEQUENCE → its first element is the OID.
 * Every step is bounds-checked and returns null rather than throwing: a
 * certificate this cannot parse must cost the one field, never the report.
 */
export function csSignatureAlgorithm(der: Uint8Array): string | null {
  const outer = csReadTlv(der, 0)
  if (!outer || outer.tag !== 0x30) return null
  const tbs = csReadTlv(der, outer.start)
  if (!tbs || tbs.tag !== 0x30) return null
  const algId = csReadTlv(der, tbs.end)
  if (!algId || algId.tag !== 0x30) return null
  const oid = csReadTlv(der, algId.start)
  if (!oid || oid.tag !== 0x06) return null
  const dotted = csDecodeOid(der, oid.start, oid.end)
  if (!dotted) return null
  return CS_SIG_OIDS[dotted] ?? dotted
}

const CS_EKU_NAMES: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'serverAuth',
  '1.3.6.1.5.5.7.3.2': 'clientAuth',
  '1.3.6.1.5.5.7.3.3': 'codeSigning',
  '1.3.6.1.5.5.7.3.4': 'emailProtection',
  '1.3.6.1.5.5.7.3.8': 'timeStamping',
  '1.3.6.1.5.5.7.3.9': 'OCSPSigning',
}

/* ------------------------------------------------------------------ */
/* certificate → plain JSON                                            */
/* ------------------------------------------------------------------ */

/** Node renders a DN as newline-separated `KEY=value` pairs. */
export function csDnField(dn: string, key: string): string | null {
  for (const line of dn.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0 && line.slice(0, eq).trim().toUpperCase() === key) {
      const value = line.slice(eq + 1).trim()
      if (value) return value
    }
  }
  return null
}

/**
 * Split Node's `subjectAltName` rendering. Values that contain a comma or a
 * quote come back quoted (`DNS:"a,b"`), so a plain `split(', ')` would shred
 * them — which is how a SAN list silently loses an entry.
 */
export function csSplitSan(value: string | undefined): string[] {
  if (!value) return []
  const out: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (inQuotes) {
      if (ch === '\\' && i + 1 < value.length) {
        current += value[i + 1]
        i += 1
        continue
      }
      if (ch === '"') { inQuotes = false; continue }
      current += ch
      continue
    }
    if (ch === '"') { inQuotes = true; continue }
    if (ch === ',') {
      const trimmed = current.trim()
      if (trimmed) out.push(trimmed)
      current = ''
      continue
    }
    current += ch
  }
  const last = current.trim()
  if (last) out.push(last)
  return out
}

function csUrlsFromInfoAccess(infoAccess: string | undefined, kind: 'OCSP' | 'CA Issuers'): string[] {
  if (!infoAccess) return []
  const out: string[] = []
  for (const line of infoAccess.split('\n')) {
    const marker = `${kind} - URI:`
    const at = line.indexOf(marker)
    if (at !== -1) {
      const url = line.slice(at + marker.length).trim()
      if (url) out.push(url)
    }
  }
  return out
}

export function csDescribeCert(x: X509Certificate, legacy?: PeerCertificate): CsCert {
  const der = new Uint8Array(x.raw)
  let keyType: string | null = null
  let keyBits: number | null = null
  let keyCurve: string | null = null
  try {
    const key = x.publicKey
    keyType = key.asymmetricKeyType ?? null
    const details = key.asymmetricKeyDetails
    if (details?.modulusLength) keyBits = details.modulusLength
    if (details?.namedCurve) keyCurve = details.namedCurve
    if (!keyBits && keyCurve) {
      const m = /(\d+)/.exec(keyCurve)
      if (m) keyBits = Number.parseInt(m[1], 10)
    }
  } catch { /* an exotic key must cost the field, not the report */ }

  return {
    subject: x.subject,
    subjectCN: csDnField(x.subject, 'CN'),
    subjectO: csDnField(x.subject, 'O'),
    issuer: x.issuer,
    issuerCN: csDnField(x.issuer, 'CN'),
    issuerO: csDnField(x.issuer, 'O'),
    serial: x.serialNumber,
    fingerprint256: x.fingerprint256,
    validFrom: x.validFromDate ? x.validFromDate.toISOString() : new Date(x.validFrom).toISOString(),
    validTo: x.validToDate ? x.validToDate.toISOString() : new Date(x.validTo).toISOString(),
    keyType,
    keyBits,
    keyCurve,
    sigAlg: csSignatureAlgorithm(der),
    isCa: x.ca,
    selfSigned: x.subject === x.issuer,
    san: csSplitSan(x.subjectAltName),
    eku: (x.keyUsage ?? []).map(oid => CS_EKU_NAMES[oid] ?? oid),
    ocspUrls: csUrlsFromInfoAccess(x.infoAccess, 'OCSP'),
    caIssuerUrls: csUrlsFromInfoAccess(x.infoAccess, 'CA Issuers'),
    bytes: legacy?.raw ? legacy.raw.length : der.length,
    pem: x.toString().trim(),
  }
}

/* ------------------------------------------------------------------ */
/* the handshakes                                                      */
/* ------------------------------------------------------------------ */

export interface CsHandshake {
  protocol: string | null
  cipher: string | null
  cipherStandard: string | null
  alpn: string | null
  ephemeralKey: string | null
  ocspStapled: boolean
  authorized: boolean
  authorizationError: string | null
  chain: CsCert[]
}

export interface CsDialOptions {
  address: string
  port: number
  /** Omitted for an IP literal — SNI may not carry an address. */
  servername: string | null
  /** `[]` trusts nothing, which is how the PRESENTED chain is observed. */
  emptyStore: boolean
  /**
   * An explicit trust store. ONLY the assertions pass this: it reproduces
   * offline the thing a public root does in production — complete a chain the
   * server did not fully send — which is the entire reason `csInspect` makes
   * two handshakes rather than one. `emptyStore` is applied AFTER it and wins,
   * so a mutation that drops `ca: []` shows up as the empty-store probe
   * suddenly authorizing and reporting a certificate that never crossed the
   * wire. `csInspect` never sets this.
   */
  trustAnchors?: string[]
  deadline: number
}

/**
 * `socket.authorizationError` is an Error on some Node versions and a bare
 * code STRING on others. Measured, not assumed: on Node 22 the empty-store
 * probe hands back the string, so reading `.code ?? .message` off it yielded
 * the literal text "undefined" — and the anchor-included finding, which keys
 * on that code, silently never fired. Both shapes are handled here, and the
 * unreadable case becomes null rather than a string that matches nothing.
 */
export function csAuthCode(error: unknown): string | null {
  if (!error) return null
  if (typeof error === 'string') return error
  const err = error as NodeJS.ErrnoException
  return err.code ?? err.message ?? null
}

function csWalkChain(peer: DetailedPeerCertificate): CsCert[] {
  const out: CsCert[] = []
  const seen = new Set<string>()
  let cur: DetailedPeerCertificate | undefined = peer
  while (cur && cur.raw && out.length < CS_MAX_CHAIN) {
    const fp = cur.fingerprint256
    if (!fp || seen.has(fp)) break
    seen.add(fp)
    try {
      out.push(csDescribeCert(new X509Certificate(cur.raw), cur))
    } catch {
      break
    }
    cur = cur.issuerCertificate
  }
  return out
}

/**
 * One handshake to an ALREADY-VALIDATED address.
 *
 * Exported only so `security:smoke` can run real handshakes against a local
 * fixture PKI and prove the empty-store claim `csInspect` rests on. It takes a
 * raw address and performs NO guarding of its own — `csInspect` is the only
 * caller in shipped code, and the smoke test asserts that it stays that way.
 */
export function csDial(opts: CsDialOptions): Promise<CsHandshake | { error: string }> {
  return new Promise(resolve => {
    const remaining = opts.deadline - Date.now()
    if (remaining <= 0) return resolve({ error: 'The handshake took too long.' })

    let settled = false
    const finish = (value: CsHandshake | { error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.destroy() } catch { /* already gone */ }
      resolve(value)
    }

    let stapled = false
    // `requestOCSP` is a real tls.connect option that this version of
    // @types/node does not carry, so it is widened here rather than dropped.
    const connectOptions: ConnectionOptions & { requestOCSP?: boolean } = {
      host: opts.address,
      port: opts.port,
      // The address is pinned; the NAME travels only as SNI, so there is no
      // second resolution that could answer differently from the checked one.
      ...(opts.servername ? { servername: opts.servername } : {}),
      // Reporting a bad certificate is the product — refusing to look at one
      // would be refusing to answer the question. Nothing is sent to the peer
      // beyond the handshake, and no response body is ever read.
      rejectUnauthorized: false,
      // `authorized` must mean CHAIN TRUST AND NOTHING ELSE. Node runs its own
      // hostname check after path validation and, on a mismatch, sets
      // `authorized = false` with ERR_TLS_CERT_ALTNAME_INVALID even when the
      // chain verified perfectly to a public root — measured against a fixture:
      // a valid 3-certificate chain served under the wrong SNI came back
      // `authorized=false`. Left in, that hostname fact leaked into the trust
      // verdict (the tile this tool exists to keep separate) and, far worse,
      // `csChainState` read the false flag and fell through to `incomplete`,
      // telling the owner of a perfectly configured server that an intermediate
      // was missing. Hostname coverage is answered by `csMatchHost`, which can
      // explain WHY; this handshake answers only "does the chain hold".
      checkServerIdentity: () => undefined,
      requestOCSP: true,
      ALPNProtocols: ['h2', 'http/1.1'],
      ...(opts.trustAnchors ? { ca: opts.trustAnchors } : {}),
      // `[]` is truthy, so it REPLACES the default store rather than falling
      // back to it — which is the whole mechanism behind the second handshake.
      // Declared last so it also beats an explicit store, which is what makes
      // the claim testable offline. `csInspect` does not take it on faith
      // either: it discards the observation if the probe comes back authorized.
      ...(opts.emptyStore ? { ca: [] } : {}),
    }
    const socket: TLSSocket = tls.connect(connectOptions)

    const timer = setTimeout(() => finish({ error: 'The handshake took too long.' }), remaining)

    socket.on('OCSPResponse', () => { stapled = true })
    socket.on('error', (err: NodeJS.ErrnoException) => {
      const code = err.code ?? ''
      if (code === 'ECONNREFUSED') return finish({ error: `Nothing is listening on port ${opts.port}.` })
      if (code === 'ETIMEDOUT' || code === 'ECONNRESET') return finish({ error: `The connection to port ${opts.port} was refused or dropped before the handshake finished.` })
      if (code === 'EPROTO' || code === 'ERR_SSL_WRONG_VERSION_NUMBER') return finish({ error: `Port ${opts.port} answered, but not with TLS — a STARTTLS port or a plain-HTTP port looks like this.` })
      return finish({ error: 'The TLS handshake failed before a certificate was presented.' })
    })

    socket.on('secureConnect', () => {
      const cipher = socket.getCipher()
      let ephemeral: string | null = null
      try {
        const info = socket.getEphemeralKeyInfo() as EphemeralKeyInfo | undefined
        if (info && info.type) ephemeral = info.name ? `${info.type} ${info.name}` : `${info.type} ${info.size ?? ''}`.trim()
      } catch { /* not every suite has one */ }
      const peer = socket.getPeerCertificate(true)
      const chain = peer && peer.raw ? csWalkChain(peer) : []
      finish({
        protocol: socket.getProtocol(),
        cipher: cipher?.name ?? null,
        cipherStandard: cipher?.standardName ?? null,
        alpn: socket.alpnProtocol || null,
        ephemeralKey: ephemeral,
        ocspStapled: stapled,
        authorized: socket.authorized,
        authorizationError: csAuthCode(socket.authorizationError),
        chain,
      })
    })
  })
}

export interface CsInspectResult {
  host: string
  port: number
  address: string
  family: 4 | 6
  handshake: CsHandshake
  /** What the server actually SENT — observed with an empty trust store. */
  presented: CsCert[]
  /** True when the server included a self-signed anchor in what it sent. */
  anchorIncluded: boolean
  /** False when the empty-store probe could not be trusted (see below). */
  presentedObserved: boolean
  /** The root the local store supplied, when it supplied one. */
  storeRoot: CsCert | null
  elapsedMs: number
}

/**
 * Verification codes that mean "an anchor was in the chain the peer sent".
 * Exported so the assertions can hold this set against the code a fixture
 * server that really does send its root produces, rather than against a
 * remembered string — the set and the observation must not drift apart.
 */
export const CS_ANCHOR_CODES = new Set(['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT'])

/**
 * Inspect a target with TWO handshakes, run in parallel against the same
 * pinned address.
 *
 * The second one is a correctness requirement and it is not obvious, so it is
 * written down rather than rediscovered: **`getPeerCertificate(true)` does not
 * report what the server sent.** When verification succeeds it reports the
 * chain OpenSSL *built*, which includes the root out of the local trust store —
 * measured, not assumed: a server sending leaf+intermediate reports three
 * certificates when the root is trusted and two when it is not. A tool whose
 * headline finding is "your chain is incomplete" cannot read the sent chain
 * through a lens that completes it, and "the server also sends the root" would
 * be reported for every correctly configured site on earth.
 *
 * So: handshake A uses the real store and answers *is this trusted*; handshake
 * B trusts nothing and answers *what did the server send*. Handshake B must
 * fail verification by construction — if it reports `authorized`, the empty
 * store did not take effect and the observation is discarded rather than
 * believed (`presentedObserved: false`), because a wrong chain report is worse
 * than an absent one.
 *
 * Honest ceiling, stated rather than implied away: the walk follows
 * `issuerCertificate` links, so it sees the certificates that *link* from the
 * leaf, not the wire order, and a certificate the server sent that links to
 * nothing is dropped from the walk entirely. This tool therefore says nothing
 * about chain ORDER and nothing about unrelated extra certificates — both are
 * real SSL-Labs findings and neither is observable through Node's API. An
 * included anchor is observable, through the verification code the empty-store
 * probe returns, and that is the one this reports.
 */
export async function csInspect(host: string, port: number, isIpLiteral: boolean): Promise<CsInspectResult | { error: string }> {
  const started = Date.now()
  const pinned = await csResolvePinned(host)
  if (!pinned.ok) return { error: pinned.reason }

  const deadline = started + CS_TIMEOUT_MS
  const servername = isIpLiteral ? null : host
  const [trusted, bare] = await Promise.all([
    csDial({ address: pinned.address, port, servername, emptyStore: false, deadline }),
    csDial({ address: pinned.address, port, servername, emptyStore: true, deadline }),
  ])

  if ('error' in trusted) return { error: trusted.error }

  let presented: CsCert[] = trusted.chain
  let presentedObserved = false
  let anchorIncluded = false
  if (!('error' in bare) && !bare.authorized) {
    presented = bare.chain
    presentedObserved = true
    anchorIncluded = CS_ANCHOR_CODES.has(bare.authorizationError ?? '') && bare.chain.length > 1
  }

  // Anything the trusted handshake has that the presented chain does not came
  // out of the local store, not off the wire.
  const presentedPrints = new Set(presented.map(c => c.fingerprint256))
  const supplied = trusted.chain.filter(c => !presentedPrints.has(c.fingerprint256))
  const storeRoot = presentedObserved && supplied.length > 0 ? supplied[supplied.length - 1] : null

  return {
    host,
    port,
    address: pinned.address,
    family: pinned.family,
    handshake: trusted,
    presented,
    anchorIncluded,
    presentedObserved,
    storeRoot,
    elapsedMs: Date.now() - started,
  }
}

/**
 * Name the trust anchor, and prove it. `authorized` is a boolean from OpenSSL;
 * this says *which* root, by finding a certificate in the bundled Mozilla store
 * whose subject is the top of the chain's issuer and whose public key actually
 * verifies that certificate's signature. A subject match alone would be a
 * name collision away from a lie.
 */
export function csNameTrustAnchor(topPem: string): string | null {
  let top: X509Certificate
  try {
    top = new X509Certificate(topPem)
  } catch {
    return null
  }

  // The top of the chain is self-signed: the server sent its own root, so the
  // anchor is this certificate rather than something above it. That case used
  // to return null, which is why a correctly-but-wastefully configured server
  // — the one the `anchor-included` finding is written about — was the only
  // kind whose anchor the tool could not name, while every leaner chain got a
  // name. The name is sitting in the subject line, but "this is a PUBLIC trust
  // anchor" is still a claim, and a subject line is the one part of a
  // self-signed certificate that costs nothing to forge. So it is proved the
  // only way that cannot be: the exact certificate must be in the bundled
  // store, byte for byte. A self-signed top that is NOT in the store is a
  // private CA and is correctly left unnamed.
  if (top.subject === top.issuer) {
    for (const rootPem of tls.rootCertificates) {
      try {
        const root = new X509Certificate(rootPem)
        if (root.subject !== top.subject) continue
        if (root.raw.equals(top.raw)) return csAnchorName(root)
      } catch { /* a root this build cannot parse is simply not a match */ }
    }
    return null
  }

  for (const rootPem of tls.rootCertificates) {
    try {
      const root = new X509Certificate(rootPem)
      if (root.subject !== top.issuer) continue
      if (top.verify(root.publicKey)) return csAnchorName(root)
    } catch { /* a root this build cannot parse is simply not a match */ }
  }
  return null
}

/** How a matched root is rendered: its CN, or the whole DN on one line. */
function csAnchorName(root: X509Certificate): string {
  return csDnField(root.subject, 'CN') ?? root.subject.replace(/\n/g, ', ')
}
