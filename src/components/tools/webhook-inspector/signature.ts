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
 * Three invariants are load-bearing here; the first two are the same shape as
 * the JWT rules Token Bench enforces (AGENTS.md):
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
 * - **The bytes are the bytes.** Every payload is built from the exact body
 *   bytes (`bodyBase64` when the text view was lossy), never from a re-encoded
 *   decode of them, because the sender hashed what it sent.
 *
 * Eleven schemes are recognised: Stripe, GitHub (both headers), Slack, Shopify,
 * Standard Webhooks (Svix), Twilio, Paddle, Mailgun (found in the body), and
 * the two that check a public key instead of a shared secret: Discord
 * (ed25519) and SendGrid (ECDSA P-256). A public key is not a secret, but it goes in the same box for the same reason:
 * it stays in the tab.
 *
 * Everything runs in the browser with Web Crypto — the signing secret is never
 * sent anywhere, which is the only reason it is safe to ask for one at all.
 */

export type WiHash = 'SHA-1' | 'SHA-256' | 'SHA-512'
export type WiDigestEncoding = 'hex' | 'base64'
export type WiSecretEncoding = 'utf-8' | 'hex' | 'base64'
/** How the sender signs: a shared-secret HMAC, or a signature checked with a public key. */
export type WiKind = 'hmac' | 'ed25519' | 'ecdsa-p256'

/**
 * What the caller knows that the headers do not say: the full URL the sender
 * called (the capture URL plus the query string it arrived with). Twilio signs
 * the URL, so it cannot be checked without one.
 */
export interface WiContext {
  url?: string
}

export interface WiHeaderLike {
  name: string
  value: string
}

export interface WiScheme {
  id:
    | 'stripe' | 'github' | 'github-legacy' | 'slack' | 'shopify'
    | 'standard-webhooks' | 'twilio' | 'discord' | 'paddle' | 'mailgun' | 'sendgrid'
  /** Sender name for the UI. */
  label: string
  /** Header the signature arrived in, lowercased (or where in the body it sat). */
  header: string
  /** Fixed by the scheme — see the algorithm-confusion note above. */
  kind: WiKind
  hash: WiHash
  encoding: WiDigestEncoding
  /** Exactly the bytes the sender signed, as text (lossy if the body was not UTF-8). */
  payload: string
  /** The same bytes, exactly. This is what gets signed or verified. */
  payloadBytes: Uint8Array
  /** What the pasted value is: a shared secret, or a public key (Discord, SendGrid). */
  keyKind: 'secret' | 'public-key'
  /** Set when the scheme fixes how its key is written, whatever the reader chose. */
  keyEncoding?: WiSecretEncoding
  /** A prefix the sender puts on the printable key that is not part of the key. */
  keyPrefix?: string
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

/**
 * The captured body as the exact bytes plus a text view of them. The bytes are
 * what a sender hashed; the text is only for display. A body that was not valid
 * UTF-8 survives as bytes (`bodyBase64` in the captured request) and its text
 * view is lossy, which is why every payload below is built from the bytes.
 */
interface WiBody {
  text: string
  bytes: Uint8Array
}

const WI_ENC = new TextEncoder()

function wiBodyOf(body: string | Uint8Array): WiBody {
  return typeof body === 'string'
    ? { text: body, bytes: WI_ENC.encode(body) }
    : { text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(body), bytes: body }
}

/** `prefix` as UTF-8 followed by the body's bytes, with its text twin. */
function wiPayload(prefix: string, body: WiBody): { payload: string; payloadBytes: Uint8Array } {
  const head = WI_ENC.encode(prefix)
  const out = new Uint8Array(head.length + body.bytes.length)
  out.set(head, 0)
  out.set(body.bytes, head.length)
  return { payload: prefix + body.text, payloadBytes: out }
}

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

function wiStripe(raw: string, body: WiBody): WiScheme {
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
    kind: 'hmac',
    hash: 'SHA-256',
    encoding: 'hex',
    keyKind: 'secret',
    // The dot matters: Stripe signs `timestamp.rawBody`, so hashing the body
    // alone fails against a header that is perfectly valid.
    ...wiPayload(timestamp === null ? '' : `${timestamp}.`, body),
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

function wiGithub(raw: string, body: WiBody, legacy: boolean): WiScheme {
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
    kind: 'hmac',
    hash,
    encoding: 'hex',
    keyKind: 'secret',
    ...wiPayload('', body),
    provided: digest ? [digest.toLowerCase()] : [],
    timestamp: null,
    // GitHub signs no timestamp, so the delivery carries nothing to age against
    // and replay protection has to come from the delivery id instead.
    toleranceSec: 0,
    note: `HMAC-${hash.replace('SHA-', 'SHA')} (hex) over the raw body, keyed with the webhook secret.`,
    warning: warnings.length ? warnings.join(' ') : undefined,
  }
}

function wiSlack(raw: string, rawTimestamp: string | null, body: WiBody): WiScheme {
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
    kind: 'hmac',
    hash: 'SHA-256',
    encoding: 'hex',
    keyKind: 'secret',
    ...wiPayload(`v0:${timestamp ?? ''}:`, body),
    provided: digest ? [digest.toLowerCase()] : [],
    timestamp,
    toleranceSec: WI_REPLAY_TOLERANCE_SEC,
    note: 'HMAC-SHA256 (hex) over `v0:timestamp:rawBody`, keyed with the signing secret.',
    warning: warnings.length ? warnings.join(' ') : undefined,
  }
}

function wiShopify(raw: string, body: WiBody): WiScheme {
  return {
    id: 'shopify',
    label: 'Shopify',
    header: 'x-shopify-hmac-sha256',
    kind: 'hmac',
    hash: 'SHA-256',
    // base64, not hex — comparing a hex digest against this header is the usual
    // reason a correct Shopify secret looks wrong.
    encoding: 'base64',
    keyKind: 'secret',
    ...wiPayload('', body),
    provided: raw.trim() ? [raw.trim()] : [],
    timestamp: null,
    toleranceSec: 0,
    note: 'HMAC-SHA256 (base64) over the raw body, keyed with the app’s client secret.',
  }
}

/** Standard Webhooks (Svix and everyone who adopted it). `v1,` digests only. */
function wiStandardWebhooks(h: Map<string, string>, prefix: 'webhook' | 'svix', body: WiBody): WiScheme {
  const id = h.get(`${prefix}-id`) ?? ''
  const rawTs = h.get(`${prefix}-timestamp`) ?? ''
  const timestamp = /^\d+$/.test(rawTs.trim()) ? Number(rawTs.trim()) : null
  const provided: string[] = []
  for (const part of (h.get(`${prefix}-signature`) ?? '').split(/\s+/)) {
    const comma = part.indexOf(',')
    // `v1,` is the HMAC scheme. `v1a,` is the ed25519 one and is a different
    // check; a sender offering both must not get either counted as the other.
    if (comma > 0 && part.slice(0, comma) === 'v1' && part.length > comma + 1) provided.push(part.slice(comma + 1))
  }
  const missing = !id || timestamp === null
  return {
    id: 'standard-webhooks',
    label: 'Standard Webhooks',
    header: `${prefix}-signature`,
    kind: 'hmac',
    hash: 'SHA-256',
    encoding: 'base64',
    keyKind: 'secret',
    // The key is the base64 text after `whsec_`, decoded; it is not the printable
    // string. Using the printable form is the usual reason a correct secret fails.
    keyEncoding: 'base64',
    keyPrefix: 'whsec_',
    ...wiPayload(`${id}.${timestamp ?? ''}.`, body),
    provided,
    timestamp,
    toleranceSec: WI_REPLAY_TOLERANCE_SEC,
    note: 'HMAC-SHA256 (base64) over `id.timestamp.rawBody`, keyed with the bytes you get by base64-decoding the secret after its `whsec_` prefix.',
    warning: missing
      ? `\`${prefix}-id\` or \`${prefix}-timestamp\` is missing or not an integer, so the signed string cannot be rebuilt.`
      : provided.length === 0
        ? `\`${prefix}-signature\` carries no \`v1,\` digest. Only the HMAC scheme is checked.`
        : undefined,
  }
}

/**
 * Twilio signs the URL it called with every form field appended as `name`+`value`
 * in name order, HMAC-SHA1, base64. That includes the query string, so a URL the
 * reader's proxy rewrote will not verify. JSON bodies are signed by URL only, with
 * the body bound through a `bodySHA256` query parameter that this does not check.
 */
function wiTwilio(raw: string, headers: Map<string, string>, body: WiBody, ctx: WiContext): WiScheme {
  const isForm = (headers.get('content-type') ?? '').toLowerCase().includes('application/x-www-form-urlencoded')
  const lines = new Map<string, Set<string>>()
  if (isForm && body.text) {
    for (const [k, v] of new URLSearchParams(body.text)) {
      const set = lines.get(k) ?? new Set<string>()
      set.add(k + v)
      lines.set(k, set)
    }
  }
  // Sorted by name, and a repeated name contributes its distinct pairs in sorted order.
  const params = [...lines.keys()].sort().map(k => [...lines.get(k)!].sort().join('')).join('')
  const url = ctx.url ?? ''
  const text = url + params
  return {
    id: 'twilio',
    label: 'Twilio',
    header: 'x-twilio-signature',
    kind: 'hmac',
    hash: 'SHA-1',
    encoding: 'base64',
    keyKind: 'secret',
    payload: text,
    payloadBytes: WI_ENC.encode(text),
    provided: raw.trim() ? [raw.trim()] : [],
    timestamp: null,
    toleranceSec: 0,
    note: 'HMAC-SHA1 (base64) over the URL Twilio called followed by each form field as `name` then `value`, in name order, keyed with your Auth Token.',
    warning: ctx.url
      ? undefined
      : 'The URL Twilio called is not known here, and it is part of what Twilio signs.',
  }
}

/** Discord: ed25519 over `timestamp` + body. The "secret" is the application's public key. */
function wiDiscord(raw: string, rawTimestamp: string, body: WiBody): WiScheme {
  return {
    id: 'discord',
    label: 'Discord',
    header: 'x-signature-ed25519',
    kind: 'ed25519',
    hash: 'SHA-512',
    encoding: 'hex',
    keyKind: 'public-key',
    keyEncoding: 'hex',
    ...wiPayload(rawTimestamp, body),
    provided: raw.trim() ? [raw.trim().toLowerCase()] : [],
    timestamp: /^\d+$/.test(rawTimestamp.trim()) ? Number(rawTimestamp.trim()) : null,
    toleranceSec: 0,
    note: 'Ed25519 signature (hex) over `X-Signature-Timestamp` followed by the raw body, checked with your application’s public key (64 hex characters, from the Developer Portal). This is a public key, not a secret.',
  }
}

/** Paddle Billing: `ts=…;h1=…`, HMAC-SHA256 hex over `ts:rawBody`. Several `h1=` appear during a key rotation. */
function wiPaddle(raw: string, body: WiBody): WiScheme {
  let timestamp: number | null = null
  const provided: string[] = []
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key === 'ts' && /^\d+$/.test(value)) timestamp = Number(value)
    else if (key === 'h1' && value) provided.push(value.toLowerCase())
  }
  return {
    id: 'paddle',
    label: 'Paddle',
    header: 'paddle-signature',
    kind: 'hmac',
    hash: 'SHA-256',
    encoding: 'hex',
    keyKind: 'secret',
    ...wiPayload(timestamp === null ? '' : `${timestamp}:`, body),
    provided,
    timestamp,
    // Paddle's own SDKs enforce a replay window, but a short one measured at
    // delivery time, which this page cannot reproduce after the fact.
    toleranceSec: 0,
    note: 'HMAC-SHA256 (hex) over `ts:rawBody`, keyed with the endpoint’s secret key.',
    warning: timestamp === null
      ? 'The header carries no `ts=` timestamp, so the signed payload cannot be rebuilt.'
      : provided.length === 0
        ? 'The header carries no `h1=` digest.'
        : undefined,
  }
}

/**
 * Mailgun puts its signature in the BODY, not a header: `signature.timestamp`,
 * `signature.token` and `signature.signature` in a JSON webhook, or the same
 * three fields (`timestamp`, `token`, `signature`) in a legacy form post. It is
 * the one scheme found from the body, so it is tried only after every header one.
 */
function wiMailgun(body: WiBody, headers: Map<string, string>): WiScheme | null {
  let fields: Record<string, unknown> | null = null
  const type = (headers.get('content-type') ?? '').toLowerCase()
  if (type.includes('json') || body.text.trimStart().startsWith('{')) {
    try {
      const parsed = JSON.parse(body.text)
      const sig = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).signature : null
      if (sig && typeof sig === 'object') fields = sig as Record<string, unknown>
    } catch { /* not JSON */ }
  } else if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    // Only the urlencoded form is read; a multipart body would need a parser, and
    // Mailgun's legacy webhooks post urlencoded.
    if (type.includes('application/x-www-form-urlencoded')) {
      const p = new URLSearchParams(body.text)
      fields = { timestamp: p.get('timestamp'), token: p.get('token'), signature: p.get('signature') }
    }
  }
  if (!fields) return null
  const { timestamp, token, signature } = fields
  if (typeof timestamp !== 'string' && typeof timestamp !== 'number') return null
  if (typeof token !== 'string' || typeof signature !== 'string' || !token || !signature) return null
  const text = `${timestamp}${token}`
  return {
    id: 'mailgun',
    label: 'Mailgun',
    header: 'signature.signature (in the body)',
    kind: 'hmac',
    hash: 'SHA-256',
    encoding: 'hex',
    keyKind: 'secret',
    payload: text,
    payloadBytes: WI_ENC.encode(text),
    provided: [signature.trim().toLowerCase()],
    timestamp: /^\d+$/.test(String(timestamp)) ? Number(timestamp) : null,
    toleranceSec: 0,
    note: 'HMAC-SHA256 (hex) over the `timestamp` and `token` fields joined together, keyed with your HTTP webhook signing key. The body itself is not part of what is signed.',
  }
}

/** SendGrid Signed Event Webhook: ECDSA P-256 over `timestamp` + the raw body, public key from the SendGrid settings. */
function wiSendgrid(raw: string, rawTimestamp: string, body: WiBody): WiScheme {
  return {
    id: 'sendgrid',
    label: 'SendGrid',
    header: 'x-twilio-email-event-webhook-signature',
    kind: 'ecdsa-p256',
    hash: 'SHA-256',
    encoding: 'base64',
    keyKind: 'public-key',
    keyEncoding: 'base64',
    ...wiPayload(rawTimestamp, body),
    provided: raw.trim() ? [raw.trim()] : [],
    timestamp: /^\d+$/.test(rawTimestamp.trim()) ? Number(rawTimestamp.trim()) : null,
    toleranceSec: 0,
    note: 'ECDSA P-256 / SHA-256 signature (base64, DER) over `X-Twilio-Email-Event-Webhook-Timestamp` followed by the raw body, checked with the verification key SendGrid shows for the webhook. That is a public key, not a secret. The raw body includes its trailing line break.',
  }
}

/**
 * Identify the signing scheme from the headers alone (and, for Mailgun, the body).
 *
 * Order is deliberate: the modern header of each sender is checked before its
 * deprecated one, so a sender that offers both is verified with the stronger.
 * `body` may be the decoded text or, better, the exact bytes: every payload is
 * built from bytes, so a body that was not UTF-8 still verifies.
 */
export function wiDetectScheme(headers: WiHeaderLike[], rawBody: string | Uint8Array, ctx: WiContext = {}): WiScheme | null {
  const h = wiHeaderMap(headers)
  const body = wiBodyOf(rawBody)

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

  if (h.has('webhook-signature')) return wiStandardWebhooks(h, 'webhook', body)
  if (h.has('svix-signature')) return wiStandardWebhooks(h, 'svix', body)

  const twilio = h.get('x-twilio-signature')
  if (twilio) return wiTwilio(twilio, h, body, ctx)

  const paddle = h.get('paddle-signature')
  if (paddle) return wiPaddle(paddle, body)

  const discord = h.get('x-signature-ed25519')
  if (discord && h.has('x-signature-timestamp')) return wiDiscord(discord, h.get('x-signature-timestamp')!, body)

  const sendgrid = h.get('x-twilio-email-event-webhook-signature')
  if (sendgrid && h.has('x-twilio-email-event-webhook-timestamp')) {
    return wiSendgrid(sendgrid, h.get('x-twilio-email-event-webhook-timestamp')!, body)
  }

  return wiMailgun(body, h)
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

/**
 * The key bytes for one scheme. A scheme that fixes how its key is written
 * (Standard Webhooks: base64 after `whsec_`; Discord: hex; SendGrid: base64)
 * overrides the encoding the reader picked, because the sender defined it and
 * the reader's dropdown cannot make a different reading correct.
 */
export function wiKeyFor(scheme: WiScheme, pasted: string, chosen: WiSecretEncoding): Uint8Array {
  if (!scheme.keyEncoding) return wiDecodeSecret(pasted, chosen)
  let text = pasted.trim()
  if (scheme.keyPrefix && text.startsWith(scheme.keyPrefix)) text = text.slice(scheme.keyPrefix.length)
  return wiDecodeSecret(text, scheme.keyEncoding)
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

/** Standard or URL-safe base64 to bytes; null when it does not parse. */
export function wiFromBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text.trim().replace(/-/g, '+').replace(/_/g, '/'))
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

export { wiToBase64 }

/**
 * The exact bytes of a captured body: the stored raw bytes when the text view
 * was lossy, otherwise the text re-encoded (UTF-8 round-trips exactly, and the
 * server keeps a leading BOM in the text so that holds for BOM bodies too).
 */
export function wiBodyBytes(r: { bodyText: string; bodyBase64?: string | null }): Uint8Array {
  if (r.bodyBase64) {
    const bytes = wiFromBase64(r.bodyBase64)
    if (bytes) return bytes
  }
  return WI_ENC.encode(r.bodyText)
}

/** HMAC the payload with both output encodings, since schemes differ on which. */
export async function wiHmac(
  secretBytes: Uint8Array,
  hash: WiHash,
  payload: string | Uint8Array,
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
  const data = typeof payload === 'string' ? WI_ENC.encode(payload) : payload
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, data as unknown as BufferSource))
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

/** A DER ECDSA-Sig-Value (SEQUENCE of two INTEGERs) to the fixed-width r‖s Web Crypto wants. */
export function wiDerToRawEcdsa(der: Uint8Array, size = 32): Uint8Array | null {
  let i = 0
  const readLen = (): number => {
    const first = der[i++]
    if (first === undefined) return -1
    if (first < 0x80) return first
    const n = first & 0x7f
    if (n < 1 || n > 2) return -1
    let len = 0
    for (let k = 0; k < n; k++) {
      const b = der[i++]
      if (b === undefined) return -1
      len = (len << 8) | b
    }
    return len
  }
  if (der[i++] !== 0x30) return null
  const total = readLen()
  if (total < 0 || i + total !== der.length) return null
  const out = new Uint8Array(size * 2)
  for (let part = 0; part < 2; part++) {
    if (der[i++] !== 0x02) return null
    const len = readLen()
    if (len < 1 || i + len > der.length) return null
    let int = der.subarray(i, i + len)
    i += len
    while (int.length > 1 && int[0] === 0) int = int.subarray(1)
    if (int.length > size) return null
    out.set(int, part * size + (size - int.length))
  }
  return i === der.length ? out : null
}

function wiHexBytes(text: string): Uint8Array | null {
  const clean = text.trim()
  if (!/^(?:[0-9a-f]{2})+$/i.test(clean)) return null
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Verify a public-key signature. A key that cannot be used throws; a signature that does not verify is `false`. */
async function wiVerifyAsymmetric(scheme: WiScheme, keyBytes: Uint8Array): Promise<boolean> {
  const data = scheme.payloadBytes as unknown as BufferSource
  if (scheme.kind === 'ed25519') {
    if (keyBytes.length !== 32) throw new Error('The public key must be 32 bytes: 64 hex characters.')
    let key: CryptoKey
    try {
      key = await crypto.subtle.importKey('raw', keyBytes as unknown as BufferSource, { name: 'Ed25519' }, false, ['verify'])
    } catch {
      throw new Error('This browser cannot check Ed25519 signatures, or the public key is not valid.')
    }
    for (const p of scheme.provided) {
      const sig = wiHexBytes(p)
      if (sig && sig.length === 64 && await crypto.subtle.verify({ name: 'Ed25519' }, key, sig as unknown as BufferSource, data)) return true
    }
    return false
  }
  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey('spki', keyBytes as unknown as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  } catch {
    throw new Error('The verification key is not a base64 P-256 public key (the one SendGrid shows for the webhook).')
  }
  for (const p of scheme.provided) {
    const der = wiFromBase64(p)
    const raw = der ? wiDerToRawEcdsa(der) : null
    if (raw && await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw as unknown as BufferSource, data)) return true
  }
  return false
}

export async function wiVerifyScheme(
  scheme: WiScheme,
  secretBytes: Uint8Array,
  nowMs: number = Date.now(),
): Promise<WiVerification> {
  let expected = ''
  let matched: boolean
  if (scheme.kind === 'hmac') {
    const digests = await wiHmac(secretBytes, scheme.hash, scheme.payloadBytes)
    expected = scheme.encoding === 'hex' ? digests.hex : digests.base64
    matched = scheme.provided.some(p => wiDigestEquals(p, expected, scheme.encoding))
  } else {
    // A public-key check has no "expected digest" to show next to the sent one.
    matched = await wiVerifyAsymmetric(scheme, secretBytes)
  }
  const signature = matched ? 'match' : 'mismatch'

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
  body: string | Uint8Array,
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
