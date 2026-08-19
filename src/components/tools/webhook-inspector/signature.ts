/**
 * Webhook signature verification — the half of Webhook Inspector that answers
 * "is this request really from Stripe, and did my secret actually check out?".
 *
 * Seeing a webhook is the easy part; every request bin does it. The step people
 * get wrong is the next one, and it is always the same mistake: they re-serialize
 * the parsed JSON and HMAC *that*, so the digest is computed over bytes the
 * sender never signed and the signature "never matches". This module works from
 * the captured raw body and shows the expected digest next to the sent one.
 *
 * It lives outside the WebComponent on purpose: scripts/security-smoke.mjs runs
 * it against real Web Crypto the way it runs src/lib/jwt.ts. A verifier that only
 * exists inside a custom element cannot be asserted, and an unasserted verifier
 * is the one a later refactor quietly turns into a function that agrees with
 * everything.
 *
 * Two invariants from AGENTS.md are load-bearing here, and both are the same
 * shape as the JWT rules Token Bench enforces:
 *
 * - **The algorithm never comes from the message.** A scheme fixes its hash from
 *   the header NAME the sender used (`x-hub-signature-256` → SHA-256), never from
 *   the `sha256=` / `v0=` label inside the value. A verifier that reads its
 *   algorithm out of the thing it is verifying lets whoever wrote the message
 *   choose how it gets checked. Where the label disagrees with the scheme we
 *   report the disagreement and keep using the scheme's hash.
 * - **Signature validity and freshness are separate answers.** Stripe and Slack
 *   both fold a timestamp into the signed payload and both reject replays outside
 *   a five-minute window. A correctly signed request that arrived twenty minutes
 *   ago is a stale delivery, not a forgery; collapsing the two into one boolean is
 *   how people end up widening the replay window to make a red badge go green.
 *
 * Everything runs in the browser with Web Crypto — the signing secret is never
 * sent anywhere, which is the only reason it is safe to ask for one at all.
 */

export type WiHash = 'SHA-1' | 'SHA-256' | 'SHA-512'
export type WiDigestEncoding = 'hex' | 'base64'
export type WiSecretEncoding = 'utf-8' | 'hex' | 'base64'

export interface WiHeaderLike {
  name: string
  value: string
}

export interface WiScheme {
  id: 'stripe' | 'github' | 'github-legacy' | 'slack' | 'shopify'
  /** Sender name for the UI. */
  label: string
  /** Header the signature arrived in, lowercased. */
  header: string
  /** Fixed by the scheme — see the algorithm-confusion note above. */
  hash: WiHash
  encoding: WiDigestEncoding
  /** Exactly the bytes the sender signed, as text. */
  payload: string
  /** Every digest the header offers. Senders send more than one during a secret
      rotation and any of them matching is a pass, so this is a list. */
  provided: string[]
  /** Unix seconds the sender stamped into the signature, when it carries one. */
  timestamp: number | null
  /** The sender's own replay window in seconds; 0 when the scheme has none. */
  toleranceSec: number
  /** One line describing what actually gets signed. */
  note: string
  /** Something the message claims that we deliberately did not obey. */
  warning?: string
}

export interface WiVerification {
  signature: 'match' | 'mismatch'
  /** Deliberately a separate field from `signature` — see the header comment. */
  freshness: 'fresh' | 'stale' | 'none'
  /** Seconds between the sender's timestamp and now; negative means the future. */
  ageSec: number | null
  /** The digest we computed, so a mismatch can be eyeballed against the sent one. */
  expected: string
}

export interface WiDiscovery {
  header: string
  hash: WiHash
  encoding: WiDigestEncoding
  digest: string
}

/** Every sender's replay window is five minutes; both of ours happen to agree. */
const WI_REPLAY_TOLERANCE_SEC = 300

/** Enumerated by US, never taken from the message — see the header comment. */
const WI_DISCOVERY_HASHES: WiHash[] = ['SHA-256', 'SHA-1', 'SHA-512']

function wiHeaderMap(headers: WiHeaderLike[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const h of headers) {
    const key = h.name.toLowerCase()
    // First wins. A repeated header normally arrives already joined by the
    // server's header parser, so a second entry means a sender doing something
    // odd — checking the later copy against the earlier one's payload would be
    // exactly the confusion this module exists to avoid.
    if (!map.has(key)) map.set(key, h.value)
  }
  return map
}

/**
 * `sha256=abc…` → label `sha256`, digest `abc…`; a bare digest → label null.
 *
 * The label is returned so the caller can *report* a disagreement, never so it
 * can pick an algorithm from it.
 */
function wiSplitLabelled(raw: string): { label: string | null; digest: string } {
  const value = raw.trim()
  const eq = value.indexOf('=')
  // A base64 digest ends in `=` padding, and its head matches a label pattern
  // too, so require a non-empty remainder before treating the split as a label.
  if (eq > 0 && eq < value.length - 1 && /^[a-z0-9]{2,10}$/i.test(value.slice(0, eq))) {
    return { label: value.slice(0, eq).toLowerCase(), digest: value.slice(eq + 1).trim() }
  }
  return { label: null, digest: value }
}

function wiStripe(raw: string, body: string): WiScheme {
  let timestamp: number | null = null
  const provided: string[] = []
  for (const part of raw.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key === 't' && /^\d+$/.test(value)) timestamp = Number(value)
    // v1 only. v0 is Stripe's retired scheme and a sender that offers both must
    // not be able to downgrade the check by having us accept the weaker one.
    else if (key === 'v1' && value) provided.push(value.toLowerCase())
  }
  return {
    id: 'stripe',
    label: 'Stripe',
    header: 'stripe-signature',
    hash: 'SHA-256',
    encoding: 'hex',
    // The dot matters: Stripe signs `timestamp.rawBody`, so hashing the body
    // alone fails against a header that is perfectly valid.
    payload: timestamp === null ? body : `${timestamp}.${body}`,
    provided,
    timestamp,
    toleranceSec: WI_REPLAY_TOLERANCE_SEC,
    note: 'HMAC-SHA256 (hex) over `timestamp.rawBody`, keyed with the whole whsec_… secret.',
    warning: timestamp === null
      ? 'The header carries no `t=` timestamp, so the signed payload cannot be rebuilt — this is not a signature Stripe produced.'
      : provided.length === 0
        ? 'The header carries no `v1=` digest. Stripe v0 signatures are retired and are not checked.'
        : undefined,
  }
}

function wiGithub(raw: string, body: string, legacy: boolean): WiScheme {
  const header = legacy ? 'x-hub-signature' : 'x-hub-signature-256'
  const hash: WiHash = legacy ? 'SHA-1' : 'SHA-256'
  const expectedLabel = legacy ? 'sha1' : 'sha256'
  const { label, digest } = wiSplitLabelled(raw)
  const warnings: string[] = []
  if (label && label !== expectedLabel) {
    warnings.push(`The value is labelled \`${label}=\` but \`${header}\` is defined as ${hash}; the label is ignored.`)
  }
  if (legacy) {
    warnings.push('This is GitHub’s deprecated SHA-1 header. Verify `x-hub-signature-256` instead where the sender offers it.')
  }
  return {
    id: legacy ? 'github-legacy' : 'github',
    label: legacy ? 'GitHub (legacy SHA-1)' : 'GitHub',
    header,
    hash,
    encoding: 'hex',
    payload: body,
    provided: digest ? [digest.toLowerCase()] : [],
    timestamp: null,
    // GitHub signs no timestamp, so the delivery carries nothing to age against
    // and replay protection has to come from the delivery id instead.
    toleranceSec: 0,
    note: `HMAC-${hash.replace('SHA-', 'SHA')} (hex) over the raw body, keyed with the webhook secret.`,
    warning: warnings.length ? warnings.join(' ') : undefined,
  }
}

function wiSlack(raw: string, rawTimestamp: string | null, body: string): WiScheme {
  const { label, digest } = wiSplitLabelled(raw)
  const timestamp = rawTimestamp && /^\d+$/.test(rawTimestamp.trim()) ? Number(rawTimestamp.trim()) : null
  const warnings: string[] = []
  if (label && label !== 'v0') {
    warnings.push(`The signature is labelled \`${label}=\`; only Slack’s v0 scheme is checked.`)
  }
  if (timestamp === null) {
    warnings.push('`x-slack-request-timestamp` is missing or not an integer, so the signed base string cannot be rebuilt.')
  }
  return {
    id: 'slack',
    label: 'Slack',
    header: 'x-slack-signature',
    hash: 'SHA-256',
    encoding: 'hex',
    payload: `v0:${timestamp ?? ''}:${body}`,
    provided: digest ? [digest.toLowerCase()] : [],
    timestamp,
    toleranceSec: WI_REPLAY_TOLERANCE_SEC,
    note: 'HMAC-SHA256 (hex) over `v0:timestamp:rawBody`, keyed with the signing secret.',
    warning: warnings.length ? warnings.join(' ') : undefined,
  }
}

function wiShopify(raw: string, body: string): WiScheme {
  return {
    id: 'shopify',
    label: 'Shopify',
    header: 'x-shopify-hmac-sha256',
    hash: 'SHA-256',
    // base64, not hex — comparing a hex digest against this header is the usual
    // reason a correct Shopify secret looks wrong.
    encoding: 'base64',
    payload: body,
    provided: raw.trim() ? [raw.trim()] : [],
    timestamp: null,
    toleranceSec: 0,
    note: 'HMAC-SHA256 (base64) over the raw body, keyed with the app’s client secret.',
  }
}

/**
 * Identify the signing scheme from the headers alone.
 *
 * Order is deliberate: the modern header of each sender is checked before its
 * deprecated one, so a sender that offers both is verified with the stronger.
 */
export function wiDetectScheme(headers: WiHeaderLike[], body: string): WiScheme | null {
  const h = wiHeaderMap(headers)

  const stripe = h.get('stripe-signature')
  if (stripe) return wiStripe(stripe, body)

  const gh256 = h.get('x-hub-signature-256')
  if (gh256) return wiGithub(gh256, body, false)

  const gh1 = h.get('x-hub-signature')
  if (gh1) return wiGithub(gh1, body, true)

  const slack = h.get('x-slack-signature')
  if (slack) return wiSlack(slack, h.get('x-slack-request-timestamp') ?? null, body)

  const shopify = h.get('x-shopify-hmac-sha256')
  if (shopify) return wiShopify(shopify, body)

  return null
}

/**
 * Turn the pasted secret into key bytes.
 *
 * Most providers hand out a printable secret that is used verbatim as the key
 * (Stripe's `whsec_…`, GitHub's and Slack's secrets, Shopify's client secret) —
 * that is the `utf-8` case. The other two exist because some providers publish
 * the key hex- or base64-encoded, and signing with the printable form instead of
 * the decoded bytes produces a silent, permanent mismatch that looks exactly like
 * a wrong secret.
 */
export function wiDecodeSecret(secret: string, encoding: WiSecretEncoding): Uint8Array {
  if (encoding === 'hex') {
    const clean = secret.trim().replace(/\s+/g, '')
    if (!/^[0-9a-f]+$/i.test(clean) || clean.length % 2 !== 0) {
      throw new Error('The secret is not valid hex (needs an even number of 0-9a-f characters).')
    }
    const out = new Uint8Array(clean.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
    return out
  }
  if (encoding === 'base64') {
    const clean = secret.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
    let binary: string
    try {
      binary = atob(clean)
    } catch {
      throw new Error('The secret is not valid base64.')
    }
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  return new TextEncoder().encode(secret)
}

function wiToHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function wiToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** HMAC the payload with both output encodings, since schemes differ on which. */
export async function wiHmac(
  secretBytes: Uint8Array,
  hash: WiHash,
  payload: string,
): Promise<{ hex: string; base64: string }> {
  // Web Crypto rejects a zero-length HMAC key in some engines and silently
  // accepts it in others; refusing here keeps the verdict the same everywhere.
  if (secretBytes.length === 0) throw new Error('The secret is empty.')
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes as unknown as BufferSource,
    { name: 'HMAC', hash },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
  return { hex: wiToHex(signature), base64: wiToBase64(signature) }
}

function wiDigestEquals(provided: string, expected: string, encoding: WiDigestEncoding): boolean {
  // Not constant-time, and it does not need to be: the key is the reader's own
  // secret and the comparison runs in their own tab, so there is no attacker to
  // leak timing to. A SERVER doing this comparison must use a constant-time
  // compare (src/lib/security.ts timingSafeEqualText) — the tool says so in its
  // explainer precisely because this code will get copied.
  if (encoding === 'hex') return provided.toLowerCase() === expected.toLowerCase()
  return provided === expected
}

export async function wiVerifyScheme(
  scheme: WiScheme,
  secretBytes: Uint8Array,
  nowMs: number = Date.now(),
): Promise<WiVerification> {
  const digests = await wiHmac(secretBytes, scheme.hash, scheme.payload)
  const expected = scheme.encoding === 'hex' ? digests.hex : digests.base64
  const signature = scheme.provided.some(p => wiDigestEquals(p, expected, scheme.encoding))
    ? 'match'
    : 'mismatch'

  let freshness: WiVerification['freshness'] = 'none'
  let ageSec: number | null = null
  if (scheme.timestamp !== null && scheme.toleranceSec > 0) {
    ageSec = Math.round(nowMs / 1000) - scheme.timestamp
    // Absolute, so a timestamp from the future is flagged too: that is a clock
    // skew between sender and verifier, and it breaks real deliveries in exactly
    // the same way an old one does.
    freshness = Math.abs(ageSec) <= scheme.toleranceSec ? 'fresh' : 'stale'
  }

  return { signature, freshness, ageSec, expected }
}

/**
 * No recognised header: HMAC the raw body with each algorithm we know and look
 * for a header value that contains the result.
 *
 * This answers the question a sender's docs often do not — "which header is the
 * signature, and how is it encoded?" — and it can only ever confirm, never
 * assume: it enumerates our own fixed algorithm list rather than believing a
 * label the message supplied.
 */
export async function wiDiscoverSignature(
  headers: WiHeaderLike[],
  body: string,
  secretBytes: Uint8Array,
): Promise<WiDiscovery | null> {
  const entries = headers.map(h => ({ name: h.name.toLowerCase(), value: h.value, lower: h.value.toLowerCase() }))
  for (const hash of WI_DISCOVERY_HASHES) {
    const { hex, base64 } = await wiHmac(secretBytes, hash, body)
    const hexLower = hex.toLowerCase()
    for (const entry of entries) {
      // `includes`, not equality: nearly every sender prefixes its digest
      // (`sha256=`, `v1=`, `hmac …`) and the prefix is not the interesting part.
      if (entry.lower.includes(hexLower)) return { header: entry.name, hash, encoding: 'hex', digest: hex }
      if (entry.value.includes(base64)) return { header: entry.name, hash, encoding: 'base64', digest: base64 }
    }
  }
  return null
}
