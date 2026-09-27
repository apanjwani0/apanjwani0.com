/**
 * Link Peek — the server-side fetch, and the guard that makes it shippable.
 *
 * This module lets an anonymous visitor make the ORIGIN issue an HTTP request
 * to a URL they typed, which is textbook SSRF surface. The fetch is therefore
 * the trust boundary, and everything here exists to bound it:
 *
 *  - only http/https, only default ports (80/443) — an arbitrary port would
 *    turn the tool into a port scanner of anything the origin can reach;
 *  - the hostname is resolved FIRST and every resolved address is checked
 *    against the private/link-local/reserved ranges (v4 and v6, including
 *    v4-mapped v6) before any connection is made — `http://169.254.169.254/`
 *    and `http://localhost/` must die here, not at the network;
 *  - every REDIRECT hop re-runs the full validation, because a redirect is the
 *    remote server choosing the next URL — the thing being checked must not
 *    supply the terms of its own check (AGENTS.md), and an open public page
 *    that 302s to an internal address is the classic bypass;
 *  - bytes, time, redirect count and response size are all capped, and the
 *    User-Agent comes from a fixed allowlist — never from request input, which
 *    would be header injection by another name.
 *
 * Honest ceiling, stated rather than implied away (the Hue Hunt precedent): the
 * DNS check and the connection are two separate resolutions, so a resolver that
 * answers differently the second time (DNS rebinding) can slip an address past
 * the check. Closing that fully needs connection-level address pinning through
 * a custom dispatcher; until then the guard stops every static private-address
 * URL and every redirect into one, which is the attack a tool like this
 * actually receives. The origin also sits in Docker with no privileged
 * link-local metadata service behind it, which bounds the blast radius of the
 * remaining window.
 *
 * Node-only (`node:net`, and `node:dns` through `dns-lookup.ts`) — imported by
 * the API route, never by the browser bundle.
 */

import { isIP } from 'node:net'
import { DnsLookupTimeout, lookupAllBounded, type DnsLookupOptions } from './dns-lookup'

export const LP_MAX_URL_CHARS = 2048
export const LP_MAX_REDIRECTS = 4
export const LP_TIMEOUT_MS = 6000
/** og tags live in <head>, which arrives first — 512 KB is generous. */
export const LP_MAX_HTML_BYTES = 512 * 1024
/** Enough for a real og:image; a bigger one is reported, not proxied. */
export const LP_MAX_IMAGE_BYTES = 400 * 1024

/**
 * Fixed UA allowlist — sites serve DIFFERENT meta to different scrapers, so
 * previewing as the bot that will actually fetch the page is a feature. Keys
 * travel in the API request; the header values never do.
 */
export const LP_USER_AGENTS: Record<string, string> = {
  peek: 'Mozilla/5.0 (compatible; LinkPeek/1.0; +https://apanjwani0.com/tools/link-peek)',
  slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  x: 'Twitterbot/1.0',
  facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  browser: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}

export type LpUrlCheck = { ok: true; url: URL } | { ok: false; reason: string }

/** Syntactic gate: scheme, credentials, port, length. No network here. */
export function lpValidateUrl(raw: string): LpUrlCheck {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, reason: 'Enter a URL to preview.' }
  if (trimmed.length > LP_MAX_URL_CHARS) return { ok: false, reason: 'That URL is too long.' }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, reason: 'That does not parse as a URL — include the scheme, like https://example.com/page.' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https URLs can be previewed.' }
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'URLs with embedded credentials are not fetched.' }
  }
  // URL leaves .port empty for the scheme default, so any non-empty port is
  // non-default — and a chooseable port makes this a port scanner.
  if (url.port !== '') {
    return { ok: false, reason: 'Only the default ports (80/443) are fetched.' }
  }
  if (!url.hostname) return { ok: false, reason: 'That URL has no host.' }
  return { ok: true, url }
}

/* ------------------------------------------------------------------ */
/* address classification                                              */
/* ------------------------------------------------------------------ */

function lpForbiddenV4(ip: string): boolean {
  const parts = ip.split('.').map(p => Number.parseInt(p, 10))
  if (parts.length !== 4 || parts.some(p => !Number.isFinite(p) || p < 0 || p > 255)) return true
  const [a, b, c] = parts
  if (a === 0 || a === 10 || a === 127) return true              // this-net, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true              // CGNAT 100.64/10
  if (a === 169 && b === 254) return true                        // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true               // private 172.16/12
  if (a === 192 && b === 168) return true                        // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true  // IETF, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true             // 6to4 relay anycast (deprecated)
  if (a === 198 && (b === 18 || b === 19)) return true           // benchmarking
  if (a === 198 && b === 51 && c === 100) return true            // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true             // TEST-NET-3
  if (a >= 224) return true                                      // multicast, reserved, broadcast
  return false
}

/** Expand an IPv6 string to 8 numeric hextets; null when it will not parse. */
function lpExpandV6(ip: string): number[] | null {
  let addr = ip.toLowerCase()
  // Zone index (fe80::1%eth0) — strip; the address part is what classifies.
  const zone = addr.indexOf('%')
  if (zone !== -1) addr = addr.slice(0, zone)
  // Embedded dotted v4 tail → two hextets.
  const v4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(addr)
  if (v4) {
    const parts = v4[2].split('.').map(p => Number.parseInt(p, 10))
    if (parts.length !== 4 || parts.some(p => !Number.isFinite(p) || p < 0 || p > 255)) return null
    addr = v4[1] + ((parts[0] << 8) | parts[1]).toString(16) + ':' + ((parts[2] << 8) | parts[3]).toString(16)
  }
  const doubles = addr.split('::')
  if (doubles.length > 2) return null
  const head = doubles[0] ? doubles[0].split(':') : []
  const tail = doubles.length === 2 && doubles[1] ? doubles[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (doubles.length === 2 ? missing < 0 : head.length !== 8) return null
  const groups = [...head, ...Array(doubles.length === 2 ? missing : 0).fill('0'), ...tail]
  if (groups.length !== 8) return null
  const out: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    out.push(Number.parseInt(g, 16))
  }
  return out
}

function lpForbiddenV6(ip: string): boolean {
  const h = lpExpandV6(ip)
  if (!h) return true // unparseable — refuse rather than guess
  // v4-mapped (::ffff:a.b.c.d) — classify as the embedded v4.
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    return lpForbiddenV4(`${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`)
  }
  // 6to4 (2002::/16) carries a v4 address in its next 32 bits and is routed to
  // it, so 2002:7f00:1:: is 127.0.0.1 wearing a v6 prefix — classify as that v4.
  if (h[0] === 0x2002) {
    return lpForbiddenV4(`${h[1] >> 8}.${h[1] & 0xff}.${h[2] >> 8}.${h[2] & 0xff}`)
  }
  if (h[0] === 0x2001 && h[1] === 0) return true                // Teredo 2001::/32 — a tunnel to wherever
  if (h[0] === 0x2001 && h[1] === 2 && h[2] === 0) return true  // benchmarking 2001:2::/48 (the v6 198.18/15)
  if (h[0] === 0x2001 && (h[1] & 0xfff0) === 0x10) return true  // ORCHID 2001:10::/28 — identifiers, not locators
  if (h[0] === 0x2001 && (h[1] & 0xfff0) === 0x20) return true  // ORCHIDv2 2001:20::/28
  if (h[0] === 0x100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return true // discard-only 100::/64
  if (h[0] === 0) return true                                   // ::, ::1, v4-compatible
  if ((h[0] & 0xfe00) === 0xfc00) return true                   // ULA fc00::/7
  if ((h[0] & 0xffc0) === 0xfe80) return true                   // link-local fe80::/10
  if ((h[0] & 0xffc0) === 0xfec0) return true                   // site-local fec0::/10
  if (h[0] === 0x64 && h[1] === 0xff9b) return true             // NAT64 64:ff9b::/96
  if (h[0] === 0x2001 && h[1] === 0xdb8) return true            // documentation
  if (h[0] >= 0xff00) return true                               // multicast
  return false
}

/** Is this literal IP one the origin must never connect to? */
export function lpIsForbiddenIp(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) return lpForbiddenV4(ip)
  if (kind === 6) return lpForbiddenV6(ip)
  return true // not an IP at all — the caller passed the wrong thing
}

/**
 * The media type of a proxied image, or null when it is not one this tool will
 * pass on.
 *
 * The route writes it into a `data:` URI that the page drops into CSS
 * `url("…")`, and the header it comes from is chosen by whoever serves the
 * image. "Starts with `image/`" let that header carry a quote, a parenthesis or
 * whitespace into the string, so the type is held to the grammar of an image
 * media type once its parameters are stripped: `image/`, then letters, digits
 * and `.+-` only. Anything else is refused rather than passed along.
 */
export function lpImageMediaType(contentType: string | null): string | null {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase()
  return /^image\/[a-z0-9.+-]+$/.test(type) ? type : null
}

/**
 * Hostname gate BEFORE resolution: names that can only ever mean the local
 * machine or LAN. Single-label names (`router`, `nas`) are refused too — a
 * public site always has a dot in its name, an intranet host often does not.
 */
export function lpIsForbiddenHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (!host) return true
  if (isIP(host)) return lpIsForbiddenIp(host)
  // URL keeps v6 literals bracketed in .hostname on some paths — unwrap.
  if (host.startsWith('[') && host.endsWith(']')) return lpIsForbiddenIp(host.slice(1, -1))
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return true
  if (!host.includes('.')) return true
  return false
}

/**
 * Resolve and check every address the name answers with.
 *
 * The lookup is bounded by `lookupAllBounded` (`dns-lookup.ts`), which is the
 * one copy of that bound Chainsaw shares — see its docblock for why an
 * unbounded `dns.lookup` is a container-wide stall and not a slow request.
 * `dns` is its test seam; `lpFetchBounded` never passes it.
 */
export async function lpCheckResolved(hostname: string, dns: DnsLookupOptions = {}): Promise<{ ok: true } | { ok: false; reason: string }> {
  // A v6 literal arrives bracketed from `URL.hostname` ([2606:4700::1111]).
  // `isIP` says 0 for that, so without unwrapping — exactly as the hostname
  // gate above already does — every IPv6-literal URL fell through to a DNS
  // lookup of a string that can never resolve. It failed closed, but it failed.
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (isIP(bare)) {
    return lpIsForbiddenIp(bare)
      ? { ok: false, reason: 'That address is private or reserved — this tool only previews public URLs.' }
      : { ok: true }
  }
  let addresses: { address: string }[]
  try {
    addresses = await lookupAllBounded(bare, dns)
  } catch (err) {
    // No answer in time is not the same claim as "no such name".
    return {
      ok: false,
      reason: err instanceof DnsLookupTimeout
        ? `The name "${hostname}" did not resolve within ${Math.round(err.timeoutMs / 1000)}s.`
        : `The name "${hostname}" does not resolve.`,
    }
  }
  if (addresses.length === 0) return { ok: false, reason: `The name "${hostname}" does not resolve.` }
  // ANY private answer refuses the whole fetch: a name that maps to both a
  // public and a private address is exactly the rebinding setup.
  for (const a of addresses) {
    if (lpIsForbiddenIp(a.address)) {
      return { ok: false, reason: 'That name resolves to a private or reserved address — this tool only previews public URLs.' }
    }
  }
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* the bounded fetch                                                   */
/* ------------------------------------------------------------------ */

export interface LpFetchOk {
  ok: true
  finalUrl: string
  status: number
  contentType: string | null
  /** Bytes actually read (≤ the cap). */
  bytes: number
  declaredBytes: number | null
  truncated: boolean
  body: Uint8Array
  hops: number
}

export interface LpFetchFail {
  ok: false
  reason: string
}

interface LpFetchOptions {
  uaKey: string
  maxBytes: number
  accept: string
}

async function lpReadBounded(res: Response, maxBytes: number): Promise<{ body: Uint8Array; bytes: number; truncated: boolean }> {
  const reader = res.body?.getReader()
  if (!reader) return { body: new Uint8Array(0), bytes: 0, truncated: false }
  const chunks: Uint8Array[] = []
  let bytes = 0
  let truncated = false
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes <= maxBytes) {
      chunks.push(value)
    } else {
      const room = maxBytes - (bytes - value.byteLength)
      if (room > 0) chunks.push(value.subarray(0, room))
      truncated = true
      await reader.cancel()
      break
    }
  }
  const kept = chunks.reduce((n, c) => n + c.byteLength, 0)
  const body = new Uint8Array(kept)
  let offset = 0
  for (const c of chunks) {
    body.set(c, offset)
    offset += c.byteLength
  }
  return { body, bytes, truncated }
}

export async function lpFetchBounded(rawUrl: string, opts: LpFetchOptions): Promise<LpFetchOk | LpFetchFail> {
  const ua = LP_USER_AGENTS[opts.uaKey] ?? LP_USER_AGENTS.peek
  const deadline = Date.now() + LP_TIMEOUT_MS
  let current = rawUrl

  for (let hop = 0; hop <= LP_MAX_REDIRECTS; hop += 1) {
    // Full validation EVERY hop — hop 1+ is a URL the remote server chose.
    const checked = lpValidateUrl(current)
    if (!checked.ok) {
      return { ok: false, reason: hop === 0 ? checked.reason : `A redirect led somewhere this tool will not follow (${checked.reason.toLowerCase()})` }
    }
    if (lpIsForbiddenHostname(checked.url.hostname)) {
      return { ok: false, reason: hop === 0 ? 'That host is private or local — this tool only previews public URLs.' : 'A redirect led to a private or local host — refused.' }
    }
    const resolved = await lpCheckResolved(checked.url.hostname)
    if (!resolved.ok) {
      return { ok: false, reason: hop === 0 ? resolved.reason : 'A redirect led to a private or reserved address — refused.' }
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) return { ok: false, reason: 'The site took too long to respond.' }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), remaining)

    let res: Response
    try {
      res = await fetch(checked.url.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': ua, Accept: opts.accept },
      })
    } catch {
      clearTimeout(timer)
      return { ok: false, reason: 'The site could not be reached (connection failed or timed out).' }
    }

    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer)
      const location = res.headers.get('location')
      try { await res.body?.cancel() } catch { /* already drained */ }
      if (!location) return { ok: false, reason: `The site answered ${res.status} with no Location header.` }
      try {
        current = new URL(location, checked.url).href
      } catch {
        return { ok: false, reason: 'The site sent a redirect this tool cannot parse.' }
      }
      continue
    }

    let read: { body: Uint8Array; bytes: number; truncated: boolean }
    try {
      read = await lpReadBounded(res, opts.maxBytes)
    } catch {
      clearTimeout(timer)
      return { ok: false, reason: 'The connection dropped while reading the response.' }
    }
    clearTimeout(timer)
    const declaredRaw = Number(res.headers.get('content-length'))
    return {
      ok: true,
      finalUrl: checked.url.href,
      status: res.status,
      contentType: res.headers.get('content-type'),
      bytes: read.bytes,
      declaredBytes: Number.isFinite(declaredRaw) && declaredRaw > 0 ? declaredRaw : null,
      truncated: read.truncated,
      body: read.body,
      hops: hop,
    }
  }

  return { ok: false, reason: `Gave up after ${LP_MAX_REDIRECTS} redirects.` }
}

export function lpFetchPage(rawUrl: string, uaKey: string): Promise<LpFetchOk | LpFetchFail> {
  return lpFetchBounded(rawUrl, {
    uaKey,
    maxBytes: LP_MAX_HTML_BYTES,
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  })
}

export function lpFetchImage(rawUrl: string, uaKey: string): Promise<LpFetchOk | LpFetchFail> {
  return lpFetchBounded(rawUrl, {
    uaKey,
    maxBytes: LP_MAX_IMAGE_BYTES,
    accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
  })
}

/* ------------------------------------------------------------------ */
/* charset                                                             */
/* ------------------------------------------------------------------ */

/**
 * Decode HTML bytes: header charset first, then a sniff of the first 1 KB for
 * a meta charset, then UTF-8. An unknown label falls back to UTF-8 rather than
 * failing the whole preview.
 */
export function lpDecodeHtml(body: Uint8Array, contentType: string | null): { text: string; charset: string } {
  let label: string | null = null
  const fromHeader = contentType && /charset\s*=\s*"?([\w-]+)/i.exec(contentType)
  if (fromHeader) label = fromHeader[1]
  if (!label) {
    const prefix = new TextDecoder('latin1').decode(body.subarray(0, 1024))
    const m = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(prefix)
    if (m) label = m[1]
  }
  if (label) {
    try {
      return { text: new TextDecoder(label.toLowerCase()).decode(body), charset: label.toLowerCase() }
    } catch { /* unknown label — fall through */ }
  }
  return { text: new TextDecoder('utf-8').decode(body), charset: 'utf-8' }
}
