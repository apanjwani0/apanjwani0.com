/**
 * Permalinks for the server-backed diagnostics: `/tools/chainsaw#h=github.com`.
 *
 * The input rides in the URL FRAGMENT, which a browser never sends to any
 * server, so a checked hostname stays out of access logs and Referer headers.
 * A link opened with a fragment fills the form AND runs the check. That is the
 * one place these tools run without a button press, and it is allowed because a
 * permalink is the visitor's own earlier choice coming back (the "try:" links on
 * the hub and the `?host=` / `?name=` query forms only fill the input). Every
 * tool says so beside the button that mints one.
 *
 * Reading one back is bounded and total: it never throws, rejects an
 * over-long or malformed value, and hands the value to the SAME validator the
 * tool's form uses, so a hand-edited link can cost the prefill and nothing else.
 * Browser-safe: no Node imports.
 */

/** The longest decoded value any of the three tools accepts in a fragment. */
export const PERMALINK_MAX_CHARS = 2048

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/**
 * The decoded value of one `key=` in a fragment (`#h=…&ua=…`), or null when it
 * is absent, longer than `maxChars` once decoded, percent-encoded beyond what
 * that length could need, malformed, or holds a control character.
 */
export function permalinkParam(hash: string, key: string, maxChars: number): string | null {
  if (typeof hash !== 'string' || !hash.startsWith('#')) return null
  // A decoded UTF-16 unit is at most three UTF-8 bytes, each written as `%XX`.
  const rawMax = maxChars * 9
  if (hash.length > rawMax * 2 + 64) return null
  for (const part of hash.slice(1).split('&')) {
    const eq = part.indexOf('=')
    if (eq < 1 || part.slice(0, eq) !== key) continue
    const raw = part.slice(eq + 1)
    if (raw.length > rawMax) return null
    let value: string
    try {
      value = decodeURIComponent(raw)
    } catch {
      return null
    }
    if (value.length > maxChars || CONTROL_CHARS.test(value)) return null
    value = value.trim()
    return value ? value : null
  }
  return null
}

/** The `h=` value of a fragment when `validate` accepts it, else null. */
export function readPermalink(hash: string, maxChars: number, validate: (value: string) => boolean): string | null {
  const value = permalinkParam(hash, 'h', maxChars)
  return value !== null && validate(value) ? value : null
}

/** `#h=<value>` plus any extra keys, each encoded with `encodeURIComponent`. */
export function permalinkHash(value: string, extra: Record<string, string> = {}): string {
  const parts = [`h=${encodeURIComponent(value)}`]
  for (const [key, v] of Object.entries(extra)) if (v) parts.push(`${key}=${encodeURIComponent(v)}`)
  return `#${parts.join('&')}`
}

/** The absolute link for a permalink on the page the visitor is on now. */
export function permalinkHref(hash: string): string {
  try {
    const url = new URL(location.href)
    url.search = ''
    url.hash = hash
    return url.href
  } catch {
    return `${location.pathname}${hash}`
  }
}
