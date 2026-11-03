/**
 * Webhook Inspector — "Resend to URL": send a captured request to an address the
 * visitor typed. Like Link Peek and Chainsaw this lets an anonymous visitor make
 * the ORIGIN open a connection, so the same guard applies, and one step more.
 *
 * What bounds it, in the order it happens:
 *
 *  1. The URL is held to Link Peek's syntax gate (`lpValidateUrl`: http or https,
 *     no credentials, the default port only) and its hostname gate
 *     (`lpIsForbiddenHostname`: localhost, `.local`, `.internal`, single-label
 *     names, and every private, loopback, link-local, metadata and `::ffff:`
 *     mapped literal).
 *  2. The name is resolved ONCE (`lookupAllBounded`, 3 s) and every answer is
 *     checked with `lpIsForbiddenIp`. Any private answer refuses the whole send,
 *     because a name that maps to both a public and a private address is the
 *     rebinding setup.
 *  3. The connection is then PINNED to the address that was checked: the
 *     request's `lookup` hook hands the socket that address and nothing else, so
 *     a second resolution (the rebinding window Link Peek documents as its honest
 *     ceiling) never happens. The name stays the `Host` header and the TLS
 *     server name, so certificates still verify.
 *  4. Redirects are not followed at all: a 3xx comes back as a 3xx. The remote
 *     server choosing the next URL is how this kind of guard is walked around.
 *  5. Five seconds for the whole send (lookup, connect, headers, body), a 64 KB
 *     read cap, and only the first 2 KB of the response is returned.
 *
 * Nothing the visitor typed is ever written into an error: every refusal is a
 * fixed sentence. The target is not stored either; this module has no state but
 * a count of sends in flight.
 *
 * Node-only (`node:http`, `node:https`, `node:net`).
 */
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import { lookupAllBounded, type DnsLookupOptions } from './dns-lookup'
import { lpIsForbiddenHostname, lpIsForbiddenIp, lpValidateUrl } from './link-peek-fetch'
import { wiReplayHeaders } from '../components/tools/webhook-inspector/curl'
import { wiBodyBytes } from '../components/tools/webhook-inspector/signature'
import type { CapturedRequest } from './webhook-store'

export const REPLAY_TIMEOUT_MS = 5000
export const REPLAY_MAX_RESPONSE_BYTES = 64 * 1024
export const REPLAY_PREVIEW_BYTES = 2048
/** Sends in flight at once, across all visitors. Each holds a socket for up to REPLAY_TIMEOUT_MS. */
export const REPLAY_MAX_INFLIGHT = 4

const REPLAY_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])

export type ReplayResult =
  | {
      ok: true
      status: number
      contentType: string | null
      /** The first REPLAY_PREVIEW_BYTES of the response body, decoded as UTF-8. */
      preview: string
      /** True when the response had more than the preview shows. */
      previewTruncated: boolean
      /** Bytes read, up to REPLAY_MAX_RESPONSE_BYTES. */
      bytes: number
    }
  | { ok: false; kind: 'refused' | 'failed' | 'timeout' | 'busy'; error: string }

const REFUSED = (error: string): ReplayResult => ({ ok: false, kind: 'refused', error })

export type PinnedTarget =
  | { ok: true; url: URL; address: string; family: 4 | 6 }
  | { ok: false; error: string }

/**
 * Validate the URL, resolve it, check EVERY answer, and return the address the
 * connection must be pinned to. A literal IP skips the lookup and is checked
 * directly.
 */
export async function replayResolvePinned(rawUrl: string, dns: DnsLookupOptions = {}): Promise<PinnedTarget> {
  const checked = lpValidateUrl(rawUrl)
  if (!checked.ok) {
    return { ok: false, error: 'Only a full http or https address on the default port, with no username or password, can be sent to.' }
  }
  const host = checked.url.hostname
  if (lpIsForbiddenHostname(host)) {
    return { ok: false, error: 'That address is private, local or reserved, so the server will not send to it. Only public addresses are allowed.' }
  }
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const literal = isIP(bare)
  if (literal) {
    // lpIsForbiddenHostname already refused a forbidden literal; this pins a good one.
    return { ok: true, url: checked.url, address: bare, family: literal === 6 ? 6 : 4 }
  }
  let answers: { address: string; family: number }[]
  try {
    answers = await lookupAllBounded(bare, dns)
  } catch {
    return { ok: false, error: 'That name did not resolve in time, or does not exist.' }
  }
  if (answers.length === 0) return { ok: false, error: 'That name did not resolve in time, or does not exist.' }
  for (const a of answers) {
    if (lpIsForbiddenIp(a.address)) {
      return { ok: false, error: 'That name points at a private or reserved address, so the server will not send to it. Only public addresses are allowed.' }
    }
  }
  const first = answers[0]
  return { ok: true, url: checked.url, address: first.address, family: first.family === 6 ? 6 : 4 }
}

export interface ReplayOptions {
  dns?: DnsLookupOptions
  /**
   * Test seam, and nothing else: `security:smoke` hands in a transport that
   * records the pinned `lookup` and answers from a local server, so the guard
   * can be proven end to end without a public address. The guard runs BEFORE
   * the transport is asked for anything, and production callers pass nothing.
   */
  transport?: { request: typeof http.request }
}

let inFlight = 0

/** Send the captured request to `rawUrl`. Never throws; never echoes `rawUrl`. */
export async function replayRequest(
  req: CapturedRequest,
  rawUrl: string,
  opts: ReplayOptions = {},
): Promise<ReplayResult> {
  const method = req.method.toUpperCase()
  if (!REPLAY_METHODS.has(method)) return REFUSED('That kind of request cannot be sent again from here.')
  if (req.bodyTruncated) {
    return REFUSED('The body was cut off when it was captured, so sending it again would send something different from what arrived.')
  }
  if (inFlight >= REPLAY_MAX_INFLIGHT) {
    return { ok: false, kind: 'busy', error: 'Other requests are being sent right now. Try again in a few seconds.' }
  }
  inFlight += 1
  const deadline = Date.now() + REPLAY_TIMEOUT_MS
  try {
    const target = await replayResolvePinned(rawUrl, {
      ...opts.dns,
      timeoutMs: Math.min(opts.dns?.timeoutMs ?? REPLAY_TIMEOUT_MS, REPLAY_TIMEOUT_MS),
    })
    if (!target.ok) return REFUSED(target.error)
    const remaining = deadline - Date.now()
    if (remaining <= 0) return { ok: false, kind: 'timeout', error: 'The server took too long to answer.' }
    return await send(req, method, target, remaining, opts.transport)
  } catch {
    return { ok: false, kind: 'failed', error: 'The request could not be sent.' }
  } finally {
    inFlight -= 1
  }
}

function send(
  req: CapturedRequest,
  method: string,
  target: Extract<PinnedTarget, { ok: true }>,
  budgetMs: number,
  transport: { request: typeof http.request } | undefined,
): Promise<ReplayResult> {
  const { url, address, family } = target
  const secure = url.protocol === 'https:'
  const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
  const body = wiBodyBytes(req)

  const headers: Record<string, string | string[]> = {}
  for (const h of wiReplayHeaders(req.headers)) {
    const name = h.name.toLowerCase()
    const have = headers[name]
    headers[name] = have === undefined ? h.value : Array.isArray(have) ? [...have, h.value] : [have, h.value]
  }
  if (!headers['x-webhook-inspector-replay']) headers['x-webhook-inspector-replay'] = '1'
  if (body.length > 0 || method === 'POST' || method === 'PUT' || method === 'PATCH') {
    headers['content-length'] = String(body.length)
  }

  // The pin. Called by the socket in place of a DNS lookup, with `all: true` on
  // current Node (happy eyeballs) and without it on older ones.
  const lookup = ((_host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
    if (options?.all) cb(null, [{ address, family }])
    else cb(null, address, family)
  }) as unknown as http.RequestOptions['lookup']

  return new Promise<ReplayResult>(resolve => {
    let settled = false
    const finish = (result: ReplayResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    let clientReq: http.ClientRequest
    try {
      const requester = transport?.request ?? (secure ? https.request : http.request)
      clientReq = requester({
        protocol: url.protocol,
        hostname,
        port: url.port || (secure ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        lookup,
        agent: false,
        // The name is the TLS server name, so the certificate is checked against
        // it. A literal IP has no name to present.
        ...(secure && !isIP(hostname) ? { servername: hostname } : {}),
      })
    } catch {
      // Node refuses a header it cannot write (an invalid character). A fixed
      // sentence: the offending value is the visitor's captured data.
      resolve({ ok: false, kind: 'failed', error: 'The request could not be sent.' })
      return
    }

    const timer = setTimeout(() => {
      clientReq.destroy()
      finish({ ok: false, kind: 'timeout', error: 'The server took longer than five seconds to answer.' })
    }, budgetMs)

    clientReq.on('error', () => finish({ ok: false, kind: 'failed', error: 'The connection failed before the server answered.' }))
    clientReq.on('response', res => {
      const chunks: Buffer[] = []
      let bytes = 0
      let capped = false
      res.on('data', (chunk: Buffer) => {
        if (capped) return
        bytes += chunk.length
        if (bytes > REPLAY_MAX_RESPONSE_BYTES) {
          const room = REPLAY_MAX_RESPONSE_BYTES - (bytes - chunk.length)
          if (room > 0) chunks.push(chunk.subarray(0, room))
          bytes = REPLAY_MAX_RESPONSE_BYTES
          capped = true
          res.destroy()
          done()
          return
        }
        chunks.push(chunk)
      })
      const done = () => {
        const all = Buffer.concat(chunks)
        const shown = all.subarray(0, REPLAY_PREVIEW_BYTES)
        finish({
          ok: true,
          status: res.statusCode ?? 0,
          contentType: typeof res.headers['content-type'] === 'string' ? res.headers['content-type'].slice(0, 200) : null,
          preview: new TextDecoder('utf-8').decode(shown),
          previewTruncated: capped || all.length > REPLAY_PREVIEW_BYTES,
          bytes,
        })
      }
      res.on('end', done)
      res.on('error', () => finish({ ok: false, kind: 'failed', error: 'The connection dropped while the answer was arriving.' }))
      res.on('close', () => { if (!settled) done() })
    })

    if (body.length > 0) clientReq.write(body)
    clientReq.end()
  })
}
