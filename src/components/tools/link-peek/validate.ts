/**
 * Link Peek's syntactic URL gate, in the one place both sides can import.
 *
 * It lives here, and not in `src/lib/link-peek-fetch.ts` with the fetch, because
 * the page needs it too: a permalink (`#h=<url>`) is read back through this same
 * function before the tool runs on it, and `link-peek-fetch.ts` imports
 * `node:net`, which must never reach the browser bundle. The server module
 * re-exports these names, so every existing caller still imports them from there.
 *
 * Purely syntactic (scheme, credentials, port, length): no DNS, no socket.
 */

export const LP_MAX_URL_CHARS = 2048

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
