/**
 * Cards — deck construction and a cryptographically-strong, unbiased shuffle.
 *
 * The default shuffle draws entropy from crypto.getRandomValues via rejection
 * sampling (no modulo bias), so the deal is as close to uniformly random as the
 * platform CSPRNG allows. A seedable rng can be injected for deterministic tests.
 */

import type { Card, Suit } from './types'
import { SUITS, RANK_LABEL, SUIT_SYMBOL } from './types'

/** A fresh, ordered 52-card deck. */
export function makeDeck(): Card[] {
  const d: Card[] = []
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ r, s: s as Suit })
  return d
}

/** Unbiased integer in [0, n) from the platform CSPRNG. */
function cryptoInt(n: number): number {
  if (n <= 1) return 0
  const cap = Math.floor(0x100000000 / n) * n
  const buf = new Uint32Array(1)
  let x = 0
  do {
    globalThis.crypto.getRandomValues(buf)
    x = buf[0]
  } while (x >= cap)
  return x % n
}

/**
 * Fisher–Yates shuffle returning a new array. Pass `rng` (0..1) for
 * deterministic behaviour in tests; omit it for the crypto-strong default.
 */
export function shuffle<T>(arr: readonly T[], rng?: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng ? Math.floor(rng() * (i + 1)) : cryptoInt(i + 1)
    const tmp = a[i]
    a[i] = a[j]
    a[j] = tmp
  }
  return a
}

/** "A♠", "10♥" — for logs and debugging. */
export function cardLabel(c: Card): string {
  return `${RANK_LABEL[c.r]}${SUIT_SYMBOL[c.s]}`
}
