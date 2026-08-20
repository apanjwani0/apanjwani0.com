/**
 * Token Bench — why a signature did not verify.
 *
 * `src/lib/jwt.ts` answers one question: does this signature hold, yes or no.
 * That is the trustworthy answer and it stays a boolean. But "no" is where the
 * actual debugging loop starts, and it is the half every JWT tool leaves to the
 * user: you get a red badge and no idea whether the key is wrong, the token was
 * mangled in transit, your signer emitted the wrong signature encoding, or the
 * issuer rotated a key three weeks ago.
 *
 * This module is that second half. Its one rule, and the reason it lives beside
 * the component rather than inside it (AGENTS.md — a tool's claims live in a
 * module):
 *
 *   **A cause is only ever reported once it has been PROVED, by taking the
 *   hypothesis, re-running real Web Crypto under it, and getting `true`.**
 *
 * Nothing here guesses. `proof: 'verified'` means this module changed exactly
 * one thing and watched the signature start verifying; `proof: 'structural'`
 * means the claim is a fact about the bytes that needs no key to establish (a
 * DER-wrapped ECDSA signature is not the R‖S form RFC 7518 defines, whoever
 * holds the key). A tool whose whole product is being trustworthy about the
 * word "verified" must not start inventing explanations the moment it fails.
 *
 * Built entirely on top of `src/lib/jwt.ts`'s exports. No primitive is
 * implemented here and no key or token leaves the tab.
 */

import {
  JWT_ALGS,
  algParams,
  base64UrlToBytes,
  parseJwt,
  verifyJwt,
  type JwtAlg,
} from '../../../lib/jwt'

export type TbProof = 'verified' | 'structural'

export interface TbFinding {
  /** Stable identifier — the UI keys off nothing else, and tests name these. */
  id: string
  /** One line, the headline cause. */
  title: string
  /** The explanation, including why it is a real trap and not a typo. */
  detail: string
  proof: TbProof
  /** Present when the finding is about the token TEXT and can be corrected. */
  fixedToken?: string
}

// ---------------------------------------------------------------------------
// Token text: what a paste does to a JWT before it ever reaches the crypto.
// ---------------------------------------------------------------------------

export interface TbTokenShape {
  /** The token with a Bearer prefix and stray whitespace removed. */
  cleaned: string
  /** …and additionally with the segments put back into the base64url alphabet. */
  normalized: string
  /** Human labels for the transforms `normalized` applied, in order. */
  transforms: string[]
  findings: TbFinding[]
}

const TB_BEARER = /^\s*bearer\s+/i

/** `+`, `/` and `=` are standard base64. A JWS segment never contains them. */
function tbHasStandardAlphabet(segment: string): boolean {
  return /[+/=]/.test(segment)
}

function tbToBase64Url(segment: string): string {
  return segment.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const TB_SEGMENT_NAMES = ['header', 'payload', 'signature']

/**
 * Lint the raw string. Runs with no key and before any verification, because
 * every finding here also explains a *parse* failure — "Bearer eyJ…" splits
 * into three parts perfectly well and then reports the header as invalid
 * base64url, which tells the user nothing.
 */
export function inspectTokenText(raw: string): TbTokenShape {
  const findings: TbFinding[] = []
  const transforms: string[] = []

  let text = raw
  if (TB_BEARER.test(text)) {
    text = text.replace(TB_BEARER, '')
    transforms.push('removed the "Bearer " prefix')
    findings.push({
      id: 'bearer-prefix',
      title: 'The Authorization header value was pasted, not the token.',
      detail:
        '"Bearer " is the scheme name from the HTTP header; it is not part of the JWT. '
        + 'Everything after the space is the token.',
      proof: 'structural',
    })
  }

  const trimmed = text.trim()
  if (/\s/.test(trimmed)) {
    transforms.push('removed embedded whitespace')
    findings.push({
      id: 'embedded-whitespace',
      title: 'The token has whitespace inside it.',
      detail:
        'Usually a line wrap added by a terminal, a log viewer or an email client. '
        + 'A JWT is one unbroken string, so the wrap is not in the original.',
      proof: 'structural',
    })
  }
  const cleaned = trimmed.replace(/\s+/g, '')

  const parts = cleaned.split('.')
  if (parts.length === 5) {
    findings.push({
      id: 'jwe-not-jws',
      title: 'Five segments — this is a JWE, not a signed JWT.',
      detail:
        'A JWE is encrypted (header.encrypted-key.iv.ciphertext.tag). There is no signature to '
        + 'check and no payload to read: it has to be decrypted with the recipient\'s private key '
        + 'first, which is not something a page in your browser can do for you.',
      proof: 'structural',
    })
  } else if (parts.length === 2) {
    findings.push({
      id: 'missing-signature-segment',
      title: 'Only two segments — the signature was cut off.',
      detail:
        'A JWS has three, and an unsigned one still ends in a dot. Two usually means the string '
        + 'was truncated by a column width, a URL parser, or a database field.',
      proof: 'structural',
    })
  }

  const mangled = parts.length === 3
    ? TB_SEGMENT_NAMES.filter((_, i) => tbHasStandardAlphabet(parts[i]))
    : []
  const normalized = parts.length === 3 ? parts.map(tbToBase64Url).join('.') : cleaned
  if (mangled.length) {
    transforms.push('restored the base64url alphabet')
    const breaks = mangled.some(name => name !== 'signature')
    findings.push({
      id: 'standard-base64-alphabet',
      title: `The ${mangled.join(' and ')} segment${mangled.length > 1 ? 's are' : ' is'} standard base64, not base64url.`,
      detail:
        '`+`, `/` and `=` mean something re-encoded this token — a base64 round-trip somewhere in '
        + 'the pipeline. '
        + (breaks
          ? 'That is not cosmetic: the signature covers the exact characters of `header.payload`, '
            + 'so re-encoding those segments breaks it even though they still decode to the same JSON.'
          : 'The signature segment still decodes to the same bytes, so this one is cosmetic — but it '
            + 'is evidence the token passed through something that rewrote it.'),
      proof: 'structural',
      fixedToken: normalized,
    })
  }

  if (findings.length && !findings.some(f => f.fixedToken) && cleaned !== raw.trim()) {
    findings[0].fixedToken = cleaned
  }

  return { cleaned, normalized, transforms, findings }
}

// ---------------------------------------------------------------------------
// ECDSA signature encoding — the one that costs people a day.
// ---------------------------------------------------------------------------

/** RFC 7518 §3.4: ES512 is P-521, so its coordinate is 66 bytes, not 64. */
export function tbEcdsaCoordLen(alg: JwtAlg): number | null {
  if (alg === 'ES256') return 32
  if (alg === 'ES384') return 48
  if (alg === 'ES512') return 66
  return null
}

/**
 * Decode an ASN.1 DER `SEQUENCE { INTEGER r, INTEGER s }` into the fixed-width
 * `R‖S` concatenation a JWS actually requires.
 *
 * Returns null for anything that is not cleanly that structure — including a
 * trailing byte, which is what separates a real DER signature from 64 random
 * bytes that happen to start 0x30.
 */
export function tbDerToRawEcdsa(der: Uint8Array, coordLen: number): Uint8Array | null {
  let i = 0
  if (der[i++] !== 0x30) return null
  let seqLen = der[i++]
  if (seqLen === 0x81) seqLen = der[i++]
  else if (seqLen > 0x7f) return null
  if (seqLen === undefined || i + seqLen !== der.length) return null

  const readInt = (): Uint8Array | null => {
    if (der[i++] !== 0x02) return null
    const len = der[i++]
    if (len === undefined || len > 0x7f || i + len > der.length) return null
    const bytes = der.subarray(i, i + len)
    i += len
    // DER prefixes a 0x00 when the top bit would otherwise read as negative.
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start++
    const value = bytes.subarray(start)
    return value.length > coordLen ? null : value
  }

  const r = readInt()
  if (!r) return null
  const s = readInt()
  if (!s) return null
  if (i !== der.length) return null

  const out = new Uint8Array(coordLen * 2)
  out.set(r, coordLen - r.length)
  out.set(s, coordLen * 2 - s.length)
  return out
}

// ---------------------------------------------------------------------------
// Low-level verification, so a hypothesis can vary ONE input at a time.
// ---------------------------------------------------------------------------

const tbEncode = (text: string) => new TextEncoder().encode(text)

/** Never throws: an unusable hypothesis is a false, not an error to surface. */
async function tbVerifyWithBytes(
  alg: JwtAlg,
  keyBytes: Uint8Array,
  signingInput: string,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    const { importAlgo, verifyAlgo, keyKind } = algParams(alg)
    if (keyKind !== 'oct') return false
    const key = await crypto.subtle.importKey(
      'raw', keyBytes as unknown as BufferSource, importAlgo, false, ['verify'],
    )
    return await crypto.subtle.verify(
      verifyAlgo, key,
      signature as unknown as BufferSource,
      tbEncode(signingInput) as unknown as BufferSource,
    )
  } catch {
    return false
  }
}

async function tbVerifyQuiet(token: string, alg: JwtAlg, keyText: string): Promise<boolean> {
  try {
    return await verifyJwt(parseJwt(token), alg, keyText)
  } catch {
    return false
  }
}

/** Secret encodings a config file hands you, other than "the literal string". */
const TB_SECRET_FORMS: Array<{ id: string; label: string; decode: (text: string) => Uint8Array | null }> = [
  {
    id: 'base64',
    label: 'base64-decoded',
    decode: text => {
      const clean = text.replace(/\s+/g, '')
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length < 4) return null
      try {
        return base64UrlToBytes(clean.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))
      } catch { return null }
    },
  },
  {
    id: 'base64url',
    label: 'base64url-decoded',
    decode: text => {
      const clean = text.replace(/\s+/g, '')
      if (!/^[A-Za-z0-9_-]+$/.test(clean) || !/[_-]/.test(clean) || clean.length < 4) return null
      try { return base64UrlToBytes(clean) } catch { return null }
    },
  },
  {
    id: 'hex',
    label: 'hex-decoded',
    decode: text => {
      const clean = text.replace(/\s+/g, '')
      if (!/^[0-9a-f]+$/i.test(clean) || clean.length % 2 !== 0 || clean.length < 8) return null
      const out = new Uint8Array(clean.length / 2)
      for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
      return out
    },
  },
]

function tbParseJson(text: string): any {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null
  try { return JSON.parse(trimmed) } catch { return null }
}

const TB_ASYMMETRIC_KTY = new Set(['RSA', 'EC', 'OKP'])

function tbAsymmetricKty(parsed: any): string | null {
  if (!parsed) return null
  const key = Array.isArray(parsed.keys) ? parsed.keys[0] : parsed
  const kty = key?.kty
  return typeof kty === 'string' && TB_ASYMMETRIC_KTY.has(kty) ? kty : null
}

// ---------------------------------------------------------------------------
// The diagnosis.
// ---------------------------------------------------------------------------

export interface TbDiagnosisInput {
  rawToken: string
  alg: JwtAlg
  keyText: string
}

/**
 * Run the hypotheses, in the order a person would.
 *
 * Every `verified` finding is returned only after this function changed exactly
 * one input and watched `crypto.subtle.verify` return true under it. When no
 * hypothesis holds, the honest answer is the empty-of-proof list the caller
 * renders as "the key is simply not the one this was signed with" — an
 * unexplained failure is a real outcome and inventing a cause for it would make
 * every other line on this screen worth less.
 */
export async function diagnoseVerification(input: TbDiagnosisInput): Promise<TbFinding[]> {
  const findings: TbFinding[] = []
  const shape = inspectTokenText(input.rawToken)
  findings.push(...shape.findings)

  const keyText = input.keyText.trim()
  if (!keyText) return findings

  // 0. Mangling first, so every later hypothesis runs against a clean token and
  //    the two never have to compose.
  let token = shape.cleaned
  if (shape.normalized !== shape.cleaned && await tbVerifyQuiet(shape.normalized, input.alg, keyText)) {
    findings.push({
      id: 'proved-mangled-token',
      title: 'The token was re-encoded in transit — restoring it makes the signature verify.',
      detail:
        `Applying ${shape.transforms.join(', ')} and re-checking gives a valid ${input.alg} signature `
        + 'against this same key. The token you were handed is not the token that was signed.',
      proof: 'verified',
      fixedToken: shape.normalized,
    })
    return findings
  }
  if (shape.normalized !== shape.cleaned) token = shape.normalized
  if (token !== input.rawToken.trim() && await tbVerifyQuiet(token, input.alg, keyText)) {
    findings.push({
      id: 'proved-cleaned-token',
      title: 'The token itself is fine once the paste is cleaned up.',
      detail:
        `After ${shape.transforms.join(' and ')}, the signature verifies as ${input.alg} against this key.`,
      proof: 'verified',
      fixedToken: token,
    })
    return findings
  }

  let parsed
  try {
    parsed = parseJwt(token)
  } catch {
    return findings
  }
  const headerAlg = parsed.header.alg
  const jsonKey = tbParseJson(keyText)

  // 1. An ECDSA signature in the wrong encoding. Structural on its own — the
  //    byte layout is wrong whoever holds the key — and escalated to a proof
  //    when the converted form verifies.
  const coordLen = tbEcdsaCoordLen(input.alg)
  if (coordLen && parsed.signature.length !== coordLen * 2) {
    const raw = tbDerToRawEcdsa(parsed.signature, coordLen)
    if (raw) {
      const ok = await (async () => {
        try {
          const { importAlgo, verifyAlgo } = algParams(input.alg)
          const jwk = Array.isArray(jsonKey?.keys) ? jsonKey.keys[0] : jsonKey
          if (!jwk) return false
          const { alg: _a, key_ops: _k, use: _u, ext: _e, ...rest } = jwk
          const key = await crypto.subtle.importKey('jwk', { ...rest, ext: true }, importAlgo, false, ['verify'])
          return await crypto.subtle.verify(
            verifyAlgo, key,
            raw as unknown as BufferSource,
            tbEncode(parsed.signingInput) as unknown as BufferSource,
          )
        } catch { return false }
      })()
      findings.push({
        id: ok ? 'proved-der-ecdsa-signature' : 'der-ecdsa-signature',
        title: `The signature is DER-encoded, and ${input.alg} requires the raw R‖S form.`,
        detail:
          `It is ${parsed.signature.length} bytes of ASN.1 \`SEQUENCE { INTEGER r, INTEGER s }\`; RFC 7518 §3.4 `
          + `wants exactly ${coordLen * 2} bytes, r and s each left-padded to ${coordLen}. OpenSSL, Go's `
          + 'crypto/ecdsa and most Java signers emit DER by default, so a hand-rolled signer produces a '
          + 'token every JWT library rejects with nothing more useful than "invalid signature". '
          + (ok
            ? 'Converted to the required form it verifies against your key — so the key is right and the signer is wrong.'
            : 'The converted form still does not verify against this key, so the encoding is not the only problem.'),
        proof: ok ? 'verified' : 'structural',
      })
      if (ok) return findings
    }
  }

  // 2. Algorithm confusion — the attack this whole tool exists to talk about.
  //    Structural: no legitimate issuer HMAC-signs with a key you hold as a
  //    PUBLIC JWK, so the shape alone is the tell.
  const asymKty = tbAsymmetricKty(jsonKey)
  if (typeof headerAlg === 'string' && headerAlg.startsWith('HS') && asymKty) {
    const forged = await tbVerifyWithBytes(
      headerAlg as JwtAlg, tbEncode(keyText), parsed.signingInput, parsed.signature,
    )
    findings.push({
      id: forged ? 'proved-algorithm-confusion' : 'algorithm-confusion-shape',
      title: forged
        ? 'ALGORITHM CONFUSION — this token is forged with your own public key.'
        : `The token claims ${headerAlg}, but you hold a public ${asymKty} key.`,
      detail:
        `A ${asymKty} JWK is public: everyone has it. A token HMAC-signed with it proves nothing, because `
        + 'anyone who can read your JWKS can produce one. A verifier that took its algorithm from the '
        + `header would import that public key as an HMAC secret and confirm this token. `
        + (forged
          ? 'HMAC-ing the signing input with this key text as the secret reproduces the signature exactly — '
            + 'that is not a coincidence, it is the attack.'
          : 'Nothing legitimate signs this way, so treat the token as hostile and pin the algorithm in your config.'),
      proof: forged ? 'verified' : 'structural',
    })
    if (forged) return findings
  }

  // 3. The secret is stored encoded and your library decodes it first.
  if (input.alg.startsWith('HS') && !jsonKey) {
    for (const form of TB_SECRET_FORMS) {
      const bytes = form.decode(keyText)
      if (!bytes || !bytes.length) continue
      if (await tbVerifyWithBytes(input.alg, bytes, parsed.signingInput, parsed.signature)) {
        findings.push({
          id: `proved-secret-${form.id}`,
          title: `The secret verifies once it is ${form.label} — not as the literal characters.`,
          detail:
            'These are two different keys, and which one your library uses is its decision, not the '
            + `token's. Dashboards hand out ${form.id} secrets constantly and libraries disagree about `
            + 'whether to decode them, which is why the same secret works in one service and not another.',
          proof: 'verified',
        })
        return findings
      }
    }
  }

  // 4. Right key, wrong algorithm. Reported after confusion, so a forgery is
  //    never phrased as the good news that something finally verified.
  for (const other of JWT_ALGS) {
    if (other === input.alg) continue
    if (!await tbVerifyQuiet(token, other, keyText)) continue
    findings.push({
      id: 'proved-algorithm-mismatch',
      title: `This token is signed ${other}, and you are checking it as ${input.alg}.`,
      detail: typeof headerAlg === 'string' && headerAlg !== other
        ? `Note the header says ${headerAlg}, which is a third answer — the header is attacker-controlled `
          + 'and is evidence of nothing. Set your verifier to the algorithm your issuer actually uses.'
        : 'The key is correct. Point your verifier at the algorithm your issuer signs with — from your '
          + 'configuration, never from the token.',
      proof: 'verified',
    })
    return findings
  }

  // 5. A JWKS that does not hold the key this token was signed with. The
  //    reverse lookup — which kid DOES verify — is the answer people want and
  //    the reason "resolve the key out of a JWKS" is this tool's speciality.
  if (Array.isArray(jsonKey?.keys)) {
    const kids = jsonKey.keys.map((k: any) => (typeof k?.kid === 'string' ? k.kid : '(no kid)'))
    const tokenKid = typeof parsed.header.kid === 'string' ? parsed.header.kid : null
    let matchedKid: string | null = null
    for (let i = 0; i < jsonKey.keys.length; i++) {
      if (await tbVerifyQuiet(token, input.alg, JSON.stringify(jsonKey.keys[i]))) {
        matchedKid = kids[i]
        break
      }
    }
    if (matchedKid !== null) {
      findings.push({
        id: 'proved-wrong-kid',
        title: tokenKid
          ? `The header names kid "${tokenKid}", but the key that verifies it is "${matchedKid}".`
          : `The token names no kid; the key that verifies it is "${matchedKid}".`,
        detail:
          'The signature is good — the set just was not searched to it. This is what a rotation looks '
          + 'like from the outside: the issuer signs with a new key, publishes both, and anything that '
          + 'pinned the old kid keeps failing on tokens that are perfectly valid.',
        proof: 'verified',
      })
      return findings
    }
    if (tokenKid && !kids.includes(tokenKid)) {
      findings.push({
        id: 'kid-not-in-jwks',
        title: `No key in this set has kid "${tokenKid}".`,
        detail:
          `The set holds ${kids.length} key${kids.length === 1 ? '' : 's'}: ${kids.join(', ')}. `
          + 'Either the JWKS is cached from before a rotation, or the token came from a different '
          + 'environment than the one you fetched it from. Picking a key anyway is what a verifier must '
          + 'never do, and neither does this one.',
        proof: 'structural',
      })
    }
  }

  return findings
}
