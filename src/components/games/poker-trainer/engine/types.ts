/**
 * Shared card and hand-ranking types for the Poker Trainer.
 *
 * This file used to carry the whole multiplayer engine's contract — game state,
 * rooms, seats, bot personalities, renderer interfaces. All of that went with
 * the multiplayer poker game; what is left is the vocabulary the trainer's
 * evaluator, equity engine and card artwork actually share.
 */

export type Suit = 'c' | 'd' | 'h' | 's'

/** 2..14, where 11..14 are J, Q, K, A. Aces are high here; the evaluator
 *  handles the wheel (A-2-3-4-5) as a special case rather than by re-ranking. */
export type Rank = number

/**
 * Field names are `r`/`s`, not `rank`/`suit`, and must stay that way: the
 * evaluator's inner loops read them millions of times per enumeration, and
 * every other module here — the card artwork, the deck, the equity engine —
 * already agrees on them.
 *
 * Renaming them once looked harmless and was not. `isFlush` is
 * `suits.every(s => s === suits[0])`, which on an array of `undefined` is
 * vacuously TRUE — so every hand silently evaluated as a flush and every equity
 * number would have been wrong while looking entirely plausible.
 */
export interface Card {
  r: Rank
  s: Suit
}

export const SUITS: readonly Suit[] = ['c', 'd', 'h', 's']
export const SUIT_SYMBOL: Record<Suit, string> = { c: '♣', d: '♦', h: '♥', s: '♠' }
export const SUIT_COLOR: Record<Suit, 'red' | 'black'> = { c: 'black', s: 'black', d: 'red', h: 'red' }

export const RANK_LABEL: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8',
  9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
}

export const HAND_CATEGORY = {
  HIGH_CARD: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4,
  FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
} as const

export const CATEGORY_NAME: Record<number, string> = {
  0: 'High Card', 1: 'Pair', 2: 'Two Pair', 3: 'Three of a Kind', 4: 'Straight',
  5: 'Flush', 6: 'Full House', 7: 'Four of a Kind', 8: 'Straight Flush',
}

/**
 * A comparable hand strength.
 *
 * There is no single packed score: `cat` picks the category and `tb` holds the
 * tiebreakers in descending significance, so comparing two hands means walking
 * `tb` until they differ. Always compare with `compareRank` — the arrays are not
 * a fixed length (a flush carries five kickers, quads carries two), so nothing
 * about them supports a numeric shortcut.
 */
export interface HandRank {
  /** One of HAND_CATEGORY. */
  cat: number
  /** Tiebreakers, most significant first. */
  tb: number[]
  /** Human-readable, e.g. "Full House, Aces over Kings". */
  name: string
}
