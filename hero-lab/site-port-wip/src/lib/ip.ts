/**
 * One spelling for an IP address, so two spellings of the SAME address compare
 * equal.
 *
 * Hoisted out of `chainsaw/analyze.ts` (where it shipped 2026-09-20 as
 * `csCanonicalIp`) when DNS Sightline needed the identical rule for a different
 * reason. Both tools fail the same way without it and the failure is silent in
 * both:
 *
 * - Chainsaw compares an IP subjectAltName against the address a visitor typed.
 *   Node renders the SAN from the certificate's raw bytes in *its* preferred
 *   form; the visitor types whichever spelling they have. A string compare
 *   reports a certificate that genuinely covers the address as not covering it.
 * - DNS Sightline compares the AAAA set three public resolvers returned. The
 *   bytes are identical by construction — they came from the same zone — but
 *   resolvers do not agree on how to print them, so a string compare reports
 *   every IPv6-bearing domain on earth as "your resolvers disagree", which is
 *   the one thing that tool exists to say and would then mean nothing.
 *
 * Returns the address expanded to its canonical group form (IPv6) or the dotted
 * quad (IPv4), or null when the value is not an IP literal at all — which is
 * the ordinary case for a DNS name and simply falls through to name handling.
 *
 * Deliberately NOT done: an IPv4-mapped IPv6 address (`::ffff:192.0.2.1`) is
 * not folded onto the IPv4 address it embeds. They are different SAN entries
 * with different byte lengths, and they are different DNS records (AAAA vs A);
 * a zone naming one does not name the other.
 */
export function canonicalIp(value: string): string | null {
  let v = value.trim().toLowerCase()
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1)
  if (!v) return null

  if (!v.includes(':')) {
    const parts = v.split('.')
    if (parts.length !== 4) return null
    const nums = parts.map(p => (/^\d{1,3}$/.test(p) ? Number(p) : -1))
    if (nums.some(n => n < 0 || n > 255)) return null
    return nums.join('.')
  }

  // A zone id (`fe80::1%eth0`) is local to the machine that wrote it and is
  // never part of a certificate or a DNS answer; drop it rather than failing
  // the parse.
  const pct = v.indexOf('%')
  if (pct !== -1) v = v.slice(0, pct)

  // Trailing dotted-quad form: rewrite the IPv4 tail as its two hex groups so
  // the group parser below sees one shape.
  const lastColon = v.lastIndexOf(':')
  if (lastColon !== -1 && v.slice(lastColon + 1).includes('.')) {
    const quad = canonicalIp(v.slice(lastColon + 1))
    if (!quad) return null
    const o = quad.split('.').map(Number)
    v = `${v.slice(0, lastColon + 1)}${(o[0] * 256 + o[1]).toString(16)}:${(o[2] * 256 + o[3]).toString(16)}`
  }

  const dbl = v.indexOf('::')
  let head: string[]
  let tail: string[]
  if (dbl !== -1) {
    if (v.indexOf('::', dbl + 1) !== -1) return null // `::` may appear once
    head = v.slice(0, dbl) ? v.slice(0, dbl).split(':') : []
    tail = v.slice(dbl + 2) ? v.slice(dbl + 2).split(':') : []
    // `::` stands for AT LEAST one zero group, so 8 named groups plus a `::`
    // is not a legal spelling of anything.
    if (head.length + tail.length > 7) return null
  } else {
    head = v.split(':')
    tail = []
    if (head.length !== 8) return null
  }

  const groups = [...head, ...new Array(8 - head.length - tail.length).fill('0'), ...tail]
  const out: string[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    out.push(Number.parseInt(g, 16).toString(16))
  }
  return out.join(':')
}
