/**
 * Continuing ranges: how an opponent's hands narrow once they bet or raise.
 *
 * A bet is information. Nobody bets a third of the pot with the same hands they
 * bet twice the pot with, so treating the opponent as "anything they opened
 * with" overstates how often they are bluffing and understates how often you are
 * beaten. This module keeps the preflop range and removes the hands that would
 * not make this bet, using rules simple enough to say in one sentence each,
 * because the trainer prints that sentence beside the number it explains.
 *
 * ==These are teaching rules, not a solved strategy.== A real opponent mixes in
 * bluffs and slow-plays at frequencies no four-line filter captures. What the
 * filters do guarantee is the direction of the effect (a bigger bet means a
 * stronger range), they are deterministic, and nothing here is sampled: the same
 * combos, board and bet size always give the same list in the same order.
 *
 * Everything leans on the evaluator's packed score, `scoreBest`, whose top
 * digits are the hand category. Reading that category (`score >> 20`) is what
 * lets the filters rank a whole range without building a `HandRank` per combo.
 */

import { scoreBest } from './evaluator'
import { HAND_CATEGORY, type Card } from './types'

/** How big a bet is relative to the pot it was made into. */
export type BetTone = 'small' | 'medium' | 'large' | 'overbet' | 'all-in'

/** A bet narrows the range; a raise narrows it further. */
export type BetKind = 'bet' | 'raise'

/** A filter never leaves fewer than this many hands, so there is always an opponent to play against. */
export const MIN_CONTINUING = 8

/** On the river, this many of the weakest missed hands are kept as bluffs. */
export const RIVER_BLUFFS = 12

const CATEGORY_SHIFT = 20

/**
 * Label a bet by its size over the pot before the bet.
 *
 * Assumes a positive pot. Whole-percent boundaries: up to 40% is small, 41 to 85
 * medium, 86 to 130 large, anything more an overbet. An all-in is a property of
 * the stack and not of the size, so this never returns `'all-in'`.
 */
export function toneForSize(bet: number, potBefore: number): Exclude<BetTone, 'all-in'> {
  const pct = Math.round((bet / potBefore) * 100)
  if (pct <= 40) return 'small'
  if (pct <= 85) return 'medium'
  if (pct <= 130) return 'large'
  return 'overbet'
}

function cardKey(card: Card): string {
  return `${card.r}${card.s}`
}

function comboKey(combo: Card[]): string {
  return combo.map(cardKey).sort().join(',')
}

/**
 * Strength of a two-card holding on a board: the evaluator's packed score.
 *
 * Assumes a board of three to five cards. Higher is stronger, equal means the
 * hands tie, and the category sits in the bits from 20 up.
 */
export function strength(combo: Card[], board: Card[]): number {
  return scoreBest([...combo, ...board])
}

/**
 * The category the board makes on its own.
 *
 * Needed to tell "I made two pair" from "the board is two pair and I am playing
 * it". Three or four cards can only make a pair, two pair, trips or quads, so
 * those are counted by rank; five cards go to the evaluator.
 */
function boardCategory(board: Card[]): number {
  if (board.length >= 5) return scoreBest(board) >> CATEGORY_SHIFT
  const counts = new Map<number, number>()
  for (const card of board) counts.set(card.r, (counts.get(card.r) ?? 0) + 1)
  const sizes = [...counts.values()].sort((a, b) => b - a)
  if (sizes[0] === 4) return HAND_CATEGORY.QUADS
  if (sizes[0] === 3) return HAND_CATEGORY.TRIPS
  if (sizes[0] === 2 && sizes[1] === 2) return HAND_CATEGORY.TWO_PAIR
  if (sizes[0] === 2) return HAND_CATEGORY.PAIR
  return HAND_CATEGORY.HIGH_CARD
}

interface Made {
  score: number
  /** A pair or better that uses at least one hole card. */
  pairPlus: boolean
  /** The top board rank paired by a hole card, an overpair, or anything better. */
  topPairPlus: boolean
  /** Two pair or better that is not simply the board played by both. */
  twoPairPlus: boolean
}

/**
 * What a holding has made.
 *
 * "Top pair" means one hole card pairs the highest board rank, and a pocket pair
 * above the whole board (an overpair) counts as at least that. A hand only
 * counts as improved when a hole card matters: it pairs the board, it is a
 * pocket pair, it lifts the category above what the board makes alone, or on the
 * river it plays a better five cards than the board does. Without that test, a
 * board of two pair would put every hand in "two pair or better".
 */
function made(combo: Card[], board: Card[], boardCat: number, boardScore: number): Made {
  const score = strength(combo, board)
  const cat = score >> CATEGORY_SHIFT
  const boardRanks = board.map(card => card.r)
  const top = Math.max(...boardRanks)
  const pocket = combo[0].r === combo[1].r
  const matches = boardRanks.includes(combo[0].r) || boardRanks.includes(combo[1].r)
  const improved = cat > boardCat || pocket || matches || (board.length === 5 && score > boardScore)

  const pairPlus = cat >= HAND_CATEGORY.PAIR && improved
  const twoPairPlus = cat >= HAND_CATEGORY.TWO_PAIR && improved
  const topPair = cat >= HAND_CATEGORY.PAIR && (combo[0].r === top || combo[1].r === top)
  const overPair = cat >= HAND_CATEGORY.PAIR && pocket && combo[0].r > top
  return { score, pairPlus, topPairPlus: twoPairPlus || topPair || overPair, twoPairPlus }
}

export interface Draws {
  /** Four cards of one suit including at least one hole card (the fifth would make a flush). */
  flush: boolean
  /** Two or more different ranks would complete a straight, using a hole card. */
  openEnded: boolean
  /** Exactly one rank would complete a straight, using a hole card. */
  gutshot: boolean
  /** Hole cards ranked above every board card (0, 1 or 2). */
  overcards: number
}

/** The ranks a card set spells, with an ace also standing for 1 so the wheel (A-2-3-4-5) works. */
function straightRanks(cards: readonly Card[]): Set<number> {
  const ranks = new Set<number>()
  for (const card of cards) {
    ranks.add(card.r)
    if (card.r === 14) ranks.add(1)
  }
  return ranks
}

/** Is there a run of five consecutive ranks, anywhere in `have`, that includes at least one of `mustUse`? */
function straightThrough(have: Set<number>, mustUse: Set<number>): boolean {
  for (let low = 1; low <= 10; low++) {
    let all = true
    let usesHole = false
    for (let r = low; r < low + 5; r++) {
      if (!have.has(r)) { all = false; break }
      if (mustUse.has(r)) usesHole = true
    }
    if (all && usesHole) return true
  }
  return false
}

/**
 * Draws a holding has on the flop or turn.
 *
 * Assumes a board of three to five cards. A draw is a hand that is not made yet
 * but has cards still to come that would make it. On the river there are no cards
 * to come, so every draw flag is false there; `overcards` is a plain fact about
 * ranks and is still counted. A straight draw only counts when a hole card is
 * part of the straight (a board that already shows four in a row helps everyone
 * equally) and not when a straight is already made.
 */
export function draws(combo: Card[], board: Card[]): Draws {
  const top = Math.max(...board.map(card => card.r))
  const overcards = combo.filter(card => card.r > top).length
  if (board.length >= 5) return { flush: false, openEnded: false, gutshot: false, overcards }

  const perSuit = new Map<string, number>()
  for (const card of [...combo, ...board]) perSuit.set(card.s, (perSuit.get(card.s) ?? 0) + 1)
  const flush = combo.some(card => perSuit.get(card.s) === 4)

  const hole = straightRanks(combo)
  const have = straightRanks([...combo, ...board])
  let completing = 0
  if (!straightThrough(have, hole)) {
    for (let rank = 2; rank <= 14; rank++) {
      if (have.has(rank)) continue
      const next = new Set(have)
      next.add(rank)
      if (rank === 14) next.add(1)
      if (straightThrough(next, hole)) completing++
    }
  }
  return { flush, openEnded: completing >= 2, gutshot: completing === 1, overcards }
}

export interface ContinuingRange {
  /** The hands that would make this bet, in the order they came in. */
  combos: Card[][]
  /** One plain sentence saying what this bet size tells you. */
  note: string
  /** True when the filter left too few hands and the strongest ones were used instead. */
  fallback: boolean
}

/**
 * The sentence appended when a filter left too few hands.
 *
 * Exported so a caller that words its own note (a caller's range is described
 * differently from a bettor's) says the same thing in the same words.
 */
export function fallbackSentence(count: number): string {
  return `Very few hands fit that story here, so the ${count} strongest hands were used, which keeps someone to play against.`
}

function noteFor(tone: BetTone, kind: BetKind, river: boolean): string {
  if (kind === 'raise') {
    return river
      ? 'A raise shows real strength: two pair or better, plus a few bluffs, because on the river there are no draws left to raise with.'
      : 'A raise shows real strength: two pair or better, or a draw with many ways to win, meaning a hand that is not made yet but has many cards that would make it.'
  }
  switch (tone) {
    case 'small':
      return 'A small bet is often the whole range, so it tells you little.'
    case 'medium':
      return river
        ? 'A medium bet is usually a pair or better, since on the river there are no draws left to bet.'
        : 'A medium bet is usually a pair or better, or a strong draw, meaning a hand that is not made yet but has many cards that would make it.'
    case 'large':
      return river
        ? 'A big bet is top pair or better, since on the river there are no draws left to bet.'
        : 'A big bet is top pair or better, or a draw that can become the best hand.'
    default:
      return river
        ? 'An overbet, a bet bigger than the pot, is polarised: very strong hands and bluffs, little in between.'
        : 'An overbet, a bet bigger than the pot, is polarised: very strong hands and bluffs, little in between. Here the bluffs are draws with many ways to win.'
  }
}

/**
 * Narrow a range to the hands that would make this bet or raise.
 *
 * Assumes `combos` are two-card hands already free of the board and hero's
 * cards, and `board` has three to five cards. Rules by `tone`:
 *
 * - small (40% of the pot or less): everyone.
 * - medium (41 to 85%): any pair or better, a flush draw, or an open-ended straight draw.
 * - large (86 to 130%): top pair or better, a flush draw, or an open-ended draw.
 * - overbet (over 130%), all-in, or a raise: two pair or better, plus combo
 *   draws (a flush draw with an overcard, or a flush draw that is also
 *   open-ended). On the river, where there are no draws, the bluffs are the
 *   `RIVER_BLUFFS` weakest hands that missed entirely.
 *
 * When a filter leaves fewer than `MIN_CONTINUING` hands (or all of them, for a
 * smaller range) the strongest ones are used instead and `fallback` is set. The
 * result is deterministic: ties in strength break on the cards themselves.
 */
export function continuingRange(
  combos: Card[][],
  board: Card[],
  tone: BetTone,
  kind: BetKind = 'bet',
): ContinuingRange {
  const river = board.length >= 5
  const boardCat = boardCategory(board)
  const boardScore = river ? scoreBest(board) : 0
  const polar = kind === 'raise' || tone === 'overbet' || tone === 'all-in'
  const info = combos.map(combo => ({
    combo,
    key: comboKey(combo),
    made: made(combo, board, boardCat, boardScore),
    draw: draws(combo, board),
  }))

  const pass = (row: (typeof info)[number]): boolean => {
    if (!polar) {
      if (tone === 'small') return true
      const strong = tone === 'medium' ? row.made.pairPlus : row.made.topPairPlus
      return strong || row.draw.flush || row.draw.openEnded
    }
    if (row.made.twoPairPlus) return true
    return (row.draw.flush && row.draw.overcards >= 1) || (row.draw.flush && row.draw.openEnded)
  }

  let kept = info.filter(pass)
  if (polar && river) {
    const strong = new Set(kept)
    const bluffs = info
      .filter(row => !strong.has(row) && !row.made.pairPlus)
      .sort((a, b) => a.made.score - b.made.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, RIVER_BLUFFS)
    const bluffSet = new Set(bluffs)
    kept = info.filter(row => strong.has(row) || bluffSet.has(row))
  }

  const floor = Math.min(MIN_CONTINUING, info.length)
  if (kept.length >= floor) {
    return { combos: kept.map(row => row.combo), note: noteFor(tone, kind, river), fallback: false }
  }
  const strongest = [...info]
    .sort((a, b) => b.made.score - a.made.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, floor)
  const chosen = new Set(strongest)
  return {
    combos: info.filter(row => chosen.has(row)).map(row => row.combo),
    note: `${noteFor(tone, kind, river)} ${fallbackSentence(floor)}`,
    fallback: true,
  }
}
