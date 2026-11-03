/**
 * The captured request, written back out: the headers worth sending again, and
 * the `curl` command that sends them.
 *
 * Shared by the inspector (Copy as curl) and by the server's replay route
 * (src/lib/webhook-replay.ts), so the two cannot disagree about which headers a
 * replay carries. Pure and dependency-free for the same reason signature.ts is:
 * scripts/smoke/webhook.mjs runs it against the real thing.
 *
 * What a replay leaves out, and why:
 *  - hop-by-hop headers (RFC 9110 section 7.6.1): they describe one connection,
 *    and the one the sender used is gone;
 *  - `host`, `content-length`, `expect`, `accept-encoding`: the client sets its
 *    own for the new target, and a stale `content-length` would corrupt the send;
 *  - what the edge added on the way in (`cf-*`, `x-forwarded-*`, `x-real-ip`,
 *    `forwarded`, `cdn-loop`, `true-client-ip`): those describe the original
 *    path to this site, and replaying them would pass the sender's address on to
 *    whoever receives the copy.
 * Everything else, `authorization` and signature headers included, is kept on
 * purpose: replaying a signed webhook against your own handler is the use.
 */
import { wiBodyBytes, wiToBase64, type WiHeaderLike } from './signature'

const WI_HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])
const WI_CLIENT_SET = new Set(['host', 'content-length', 'expect', 'accept-encoding'])
const WI_EDGE_ADDED = new Set(['forwarded', 'cdn-loop', 'true-client-ip', 'x-real-ip', 'x-origin-auth'])

/** Should this captured header travel with a replay? */
export function wiReplayHeader(name: string): boolean {
  const n = name.toLowerCase()
  if (WI_HOP_BY_HOP.has(n) || WI_CLIENT_SET.has(n) || WI_EDGE_ADDED.has(n)) return false
  if (n.startsWith('cf-') || n.startsWith('x-forwarded-')) return false
  return true
}

export function wiReplayHeaders(headers: WiHeaderLike[]): WiHeaderLike[] {
  return headers.filter(h => wiReplayHeader(h.name))
}

/** Single-quote a string for a POSIX shell. */
export function wiShellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

export interface WiCurlSource {
  method: string
  headers: WiHeaderLike[]
  bodyText: string
  bodyBase64?: string | null
  bodyTruncated: boolean
}

/**
 * The `curl` command for a captured request, aimed at `url`. A body that is
 * plain text goes in as one quoted argument. A body that is not (invalid UTF-8,
 * or a NUL byte, neither of which a shell argument can hold) is piped in from
 * base64 so the bytes sent are the bytes captured.
 */
export function wiCurlCommand(req: WiCurlSource, url: string): string {
  const method = req.method.toUpperCase()
  const hasBody = req.bodyText.length > 0 || !!req.bodyBase64
  const binary = !!req.bodyBase64 || req.bodyText.includes('\u0000')

  const parts: string[] = ['curl']
  if (method === 'HEAD') parts.push('--head')
  else if (method !== 'GET' || hasBody) parts.push('-X', wiShellQuote(method))
  parts.push(wiShellQuote(url))
  for (const h of wiReplayHeaders(req.headers)) parts.push('-H', wiShellQuote(`${h.name}: ${h.value}`))
  if (hasBody) {
    parts.push('--data-binary', binary ? '@-' : wiShellQuote(req.bodyText))
  }

  const command = parts.join(' \\\n  ')
  const lines: string[] = []
  if (req.bodyTruncated) {
    lines.push('# The captured body was cut off at 64 KB, so this sends only the part that was kept.')
  }
  if (hasBody && binary) {
    lines.push(`printf '%s' ${wiShellQuote(wiToBase64(wiBodyBytes(req)))} | base64 -d | ${command}`)
  } else {
    lines.push(command)
  }
  return lines.join('\n')
}
