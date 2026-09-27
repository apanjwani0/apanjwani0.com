/**
 * JWT parsing and signature verification.
 *
 * Extracted from the Token Bench component so it can be asserted: this is a
 * trust boundary — the whole product claim is "this tells you whether the
 * signature holds" — and a security control with no test gets refactored away
 * (AGENTS.md, Security). The component keeps the DOM; everything decidable
 * lives here.
 *
 * Crypto is the browser's / Node's Web Crypto (`crypto.subtle`). Nothing here
 * implements a primitive.
 */

export type JwtAlg =
  | 'HS256' | 'HS384' | 'HS512'
  | 'RS256' | 'RS384' | 'RS512'
  | 'PS256' | 'PS384' | 'PS512'
  | 'ES256' | 'ES384' | 'ES512'

export const JWT_ALGS: JwtAlg[] = [
  'HS256', 'HS384', 'HS512',
  'RS256', 'RS384', 'RS512',
  'PS256', 'PS384', 'PS512',
  'ES256', 'ES384', 'ES512',
]

export function isJwtAlg(value: unknown): value is JwtAlg {
  return typeof value === 'string' && (JWT_ALGS as string[]).includes(value)
}

const HASHES: Record<string, string> = { '256': 'SHA-256', '384': 'SHA-384', '512': 'SHA-512' }
/** ES512 signs on P-521, not P-512 — the number in a JWS name is the hash. */
const CURVES: Record<string, string> = { ES256: 'P-256', ES384: 'P-384', ES512: 'P-521' }

export interface ParsedJwt {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  /** The exact `header.payload` string the signature covers. */
  signingInput: string
  signature: Uint8Array
  /** Empty string when the token ends in a bare dot — i.e. it is unsigned. */
  rawSignature: string
}

/** Base64url → bytes. Tolerates the missing padding JWTs always omit. */
export function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function base64UrlToText(input: string): string {
  return new TextDecoder().decode(base64UrlToBytes(input))
}

/**
 * Split and decode. Deliberately says nothing about validity — a parsed token
 * is a token you have READ, and conflating that with a checked one is the
 * mistake this whole module exists to make hard.
 */
export function parseJwt(token: string): ParsedJwt {
  const parts = token.trim().split('.')
  if (parts.length !== 3) {
    throw new Error(`A JWT has three dot-separated parts; this has ${parts.length}.`)
  }
  const [h, p, s] = parts
  let header: Record<string, unknown>
  let payload: Record<string, unknown>
  try {
    header = JSON.parse(base64UrlToText(h))
  } catch {
    throw new Error('The header is not valid base64url-encoded JSON.')
  }
  try {
    payload = JSON.parse(base64UrlToText(p))
  } catch {
    throw new Error('The payload is not valid base64url-encoded JSON.')
  }
  return {
    header,
    payload,
    signingInput: `${h}.${p}`,
    signature: s ? base64UrlToBytes(s) : new Uint8Array(),
    rawSignature: s ?? '',
  }
}

/** A token is unsigned if it says so or carries no signature. Never "valid". */
export function isUnsigned(parsed: ParsedJwt): boolean {
  return parsed.header.alg === 'none' || parsed.rawSignature === ''
}

export function algParams(alg: JwtAlg): { importAlgo: any; verifyAlgo: any; keyKind: 'oct' | 'public' } {
  const bits = alg.slice(2)
  const hash = HASHES[bits]
  if (!hash) throw new Error(`Unsupported algorithm: ${alg}`)

  if (alg.startsWith('HS')) {
    return { importAlgo: { name: 'HMAC', hash }, verifyAlgo: { name: 'HMAC' }, keyKind: 'oct' }
  }
  if (alg.startsWith('RS')) {
    return {
      importAlgo: { name: 'RSASSA-PKCS1-v1_5', hash },
      verifyAlgo: { name: 'RSASSA-PKCS1-v1_5' },
      keyKind: 'public',
    }
  }
  if (alg.startsWith('PS')) {
    // RFC 7518 §3.5: PSS salt length equals the hash output length.
    return {
      importAlgo: { name: 'RSA-PSS', hash },
      verifyAlgo: { name: 'RSA-PSS', saltLength: Number(bits) / 8 },
      keyKind: 'public',
    }
  }
  return {
    importAlgo: { name: 'ECDSA', namedCurve: CURVES[alg] },
    verifyAlgo: { name: 'ECDSA', hash },
    keyKind: 'public',
  }
}

/**
 * Build a CryptoKey from a pasted JWK, JWKS, or (HMAC only) a raw secret.
 *
 * With a JWKS the key is chosen by `kid`, and a multi-key set with no matching
 * kid is an error rather than a guess: picking one at random and reporting
 * "verified" would be the worst possible outcome for a tool whose only job is
 * to be trustworthy about that word.
 */
export async function importVerificationKey(
  alg: JwtAlg,
  keyText: string,
  kid: unknown,
): Promise<CryptoKey> {
  const { importAlgo, keyKind } = algParams(alg)
  const trimmed = keyText.trim()
  if (!trimmed) throw new Error('Paste a key to verify against.')

  let jwk: any = null
  if (trimmed.startsWith('{')) {
    let parsed: any
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('That looks like JSON but does not parse.')
    }
    if (Array.isArray(parsed.keys)) {
      const byKid = typeof kid === 'string' ? parsed.keys.find((k: any) => k?.kid === kid) : undefined
      if (byKid) jwk = byKid
      else if (parsed.keys.length === 1) jwk = parsed.keys[0]
      else {
        throw new Error(
          typeof kid === 'string'
            ? `No key in the JWKS has kid "${kid}".`
            : 'The JWKS holds several keys and the token names no kid — paste the single key to use.',
        )
      }
    } else {
      jwk = parsed
    }
  }

  if (jwk) {
    // Drop `alg`/`use`/`key_ops`/`ext`: a JWK whose `alg` disagrees with the
    // chosen one makes importKey throw with a message that reads like a broken
    // key rather than a mismatch, and the algorithm is the caller's decision
    // here by design (see verifyJwt).
    const { alg: _a, key_ops: _k, use: _u, ext: _e, ...rest } = jwk
    return crypto.subtle.importKey('jwk', { ...rest, ext: true }, importAlgo, false, ['verify'])
  }

  if (keyKind !== 'oct') {
    throw new Error(`${alg} needs a public key as JWK or JWKS JSON, not a plain string.`)
  }
  return crypto.subtle.importKey('raw', new TextEncoder().encode(trimmed), importAlgo, false, ['verify'])
}

/**
 * Verify the signature over `header.payload`.
 *
 * `alg` is a PARAMETER and is never read from the token. That is the whole
 * defence against algorithm confusion: a verifier that takes the algorithm from
 * the header lets an attacker who can craft a token also choose how it gets
 * checked — re-sign an RS256 token as HS256 using the RSA public key as the
 * HMAC secret and such a verifier confirms it. The algorithm must come from
 * configuration.
 */
export async function verifyJwt(parsed: ParsedJwt, alg: JwtAlg, keyText: string): Promise<boolean> {
  if (isUnsigned(parsed)) return false
  const key = await importVerificationKey(alg, keyText, parsed.header.kid)
  const { verifyAlgo } = algParams(alg)
  return crypto.subtle.verify(
    verifyAlgo,
    key,
    parsed.signature as unknown as BufferSource,
    new TextEncoder().encode(parsed.signingInput) as unknown as BufferSource,
  )
}

export interface JwtTimeState {
  expired: boolean
  notYetValid: boolean
  notes: string[]
}

/**
 * `exp` / `nbf` checks, reported separately from the signature.
 *
 * A correctly signed token that expired last week is a normal state and is not
 * the same thing as a forgery. Collapsing both into one "valid" boolean is how
 * expired-token bugs ship, so these never merge.
 */
export function checkTimeClaims(payload: Record<string, unknown>, now = Date.now()): JwtTimeState {
  const notes: string[] = []
  let expired = false
  let notYetValid = false

  const exp = payload.exp
  if (typeof exp === 'number') {
    if (exp * 1000 <= now) {
      expired = true
      notes.push('Expired — `exp` is in the past.')
    }
  } else if (exp !== undefined) {
    notes.push('`exp` is present but is not a number of seconds.')
  }

  const nbf = payload.nbf
  if (typeof nbf === 'number' && nbf * 1000 > now) {
    notYetValid = true
    notes.push('Not yet valid — `nbf` is in the future.')
  }

  return { expired, notYetValid, notes }
}
