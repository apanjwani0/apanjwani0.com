/**
 * Poker Together — hand evaluator.
 *
 * Zero-dependency 5-card poker hand evaluator supporting Hold'em (best 5 of
 * 5..7 cards) and Omaha (best 5 using EXACTLY 2 hole + EXACTLY 3 board cards).
 *
 * See ./types.ts for the shared `Card`, `HandRank`, `HAND_CATEGORY`,
 * `CATEGORY_NAME`, `RANK_LABEL` and `EvaluatorAPI` contract this module
 * implements.
 */

import { CATEGORY_NAME, HAND_CATEGORY, RANK_LABEL, type Card, type HandRank } from './types'

/* ─────────────────────────  small helpers  ─────────────────────── */

/** Plural rank word, e.g. 7 -> "Sevens", 14 -> "Aces", 6 -> "Sixes". */
const RANK_PLURAL: Record<number, string> = {
  2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens',
  8: 'Eights', 9: 'Nines', 10: 'Tens', 11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces',
}

function singular(rank: number): string {
  return RANK_LABEL[rank] === 'A' ? 'Ace'
    : RANK_LABEL[rank] === 'K' ? 'King'
    : RANK_LABEL[rank] === 'Q' ? 'Queen'
    : RANK_LABEL[rank] === 'J' ? 'Jack'
    : String(rank)
}

/** All k-combinations (as index arrays) of [0..n-1]. */
function combinations(n: number, k: number): number[][] {
  const result: number[][] = []
  const combo: number[] = []
  function build(start: number): void {
    if (combo.length === k) {
      result.push(combo.slice())
      return
    }
    for (let i = start; i < n; i++) {
      combo.push(i)
      build(i + 1)
      combo.pop()
    }
  }
  build(0)
  return result
}

/* ───────────────────────  core 5-card evaluator  ───────────────── */

/** Evaluate exactly 5 cards into a HandRank. */
function evaluate5(cards: Card[]): HandRank {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a)
  const suits = cards.map((c) => c.s)

  const isFlush = suits.every((s) => s === suits[0])

  // Determine straight: sort unique desc, check for 5 consecutive, plus wheel.
  const uniqueRanks = Array.from(new Set(ranks)).sort((a, b) => b - a)
  let straightHigh = -1
  if (uniqueRanks.length === 5) {
    if (uniqueRanks[0] - uniqueRanks[4] === 4) {
      straightHigh = uniqueRanks[0]
    } else if (
      uniqueRanks[0] === 14 &&
      uniqueRanks[1] === 5 &&
      uniqueRanks[2] === 4 &&
      uniqueRanks[3] === 3 &&
      uniqueRanks[4] === 2
    ) {
      // wheel: A-2-3-4-5, Ace plays low, top tiebreaker is 5
      straightHigh = 5
    }
  }
  const isStraight = straightHigh !== -1

  // Count rank frequencies.
  const counts = new Map<number, number>()
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1)
  // Groups sorted by [count desc, rank desc].
  const groups = Array.from(counts.entries()).sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]))

  if (isStraight && isFlush) {
    return {
      cat: HAND_CATEGORY.STRAIGHT_FLUSH,
      tb: [straightHigh],
      name: `${CATEGORY_NAME[HAND_CATEGORY.STRAIGHT_FLUSH]}, ${singular(
        straightHigh === 5 ? 5 : straightHigh - 4
      )} to ${singular(straightHigh === 5 ? 14 : straightHigh)}`,
    }
  }

  if (groups[0][1] === 4) {
    const quad = groups[0][0]
    const kicker = groups[1][0]
    return {
      cat: HAND_CATEGORY.QUADS,
      tb: [quad, kicker],
      name: `${CATEGORY_NAME[HAND_CATEGORY.QUADS]}, ${RANK_PLURAL[quad]}`,
    }
  }

  if (groups[0][1] === 3 && groups[1][1] === 2) {
    const trips = groups[0][0]
    const pair = groups[1][0]
    return {
      cat: HAND_CATEGORY.FULL_HOUSE,
      tb: [trips, pair],
      name: `${CATEGORY_NAME[HAND_CATEGORY.FULL_HOUSE]}, ${RANK_PLURAL[trips]} full of ${RANK_PLURAL[pair]}`,
    }
  }

  if (isFlush) {
    return {
      cat: HAND_CATEGORY.FLUSH,
      tb: [...ranks],
      name: `${CATEGORY_NAME[HAND_CATEGORY.FLUSH]}, ${singular(ranks[0])} high`,
    }
  }

  if (isStraight) {
    return {
      cat: HAND_CATEGORY.STRAIGHT,
      tb: [straightHigh],
      name: `${CATEGORY_NAME[HAND_CATEGORY.STRAIGHT]}, ${singular(
        straightHigh === 5 ? 5 : straightHigh - 4
      )} to ${singular(straightHigh === 5 ? 14 : straightHigh)}`,
    }
  }

  if (groups[0][1] === 3) {
    const trips = groups[0][0]
    const kickers = groups
      .slice(1)
      .map((g) => g[0])
      .sort((a, b) => b - a)
    return {
      cat: HAND_CATEGORY.TRIPS,
      tb: [trips, ...kickers],
      name: `${CATEGORY_NAME[HAND_CATEGORY.TRIPS]}, ${RANK_PLURAL[trips]}`,
    }
  }

  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const [highPair, lowPair] = [groups[0][0], groups[1][0]].sort((a, b) => b - a)
    const kicker = groups[2][0]
    return {
      cat: HAND_CATEGORY.TWO_PAIR,
      tb: [highPair, lowPair, kicker],
      name: `${CATEGORY_NAME[HAND_CATEGORY.TWO_PAIR]}, ${RANK_PLURAL[highPair]} and ${RANK_PLURAL[lowPair]}`,
    }
  }

  if (groups[0][1] === 2) {
    const pair = groups[0][0]
    const kickers = groups
      .slice(1)
      .map((g) => g[0])
      .sort((a, b) => b - a)
    return {
      cat: HAND_CATEGORY.PAIR,
      tb: [pair, ...kickers],
      name: `Pair of ${RANK_PLURAL[pair]}`,
    }
  }

  return {
    cat: HAND_CATEGORY.HIGH_CARD,
    tb: [...ranks],
    name: `${CATEGORY_NAME[HAND_CATEGORY.HIGH_CARD]}, ${singular(ranks[0])}`,
  }
}

/* ────────────────────────────  public API  ─────────────────────── */

/** Best five-card rank from 5..7 cards (Hold'em / Bomb / any-hole games). */
export function evaluateBest(cards: Card[]): HandRank {
  if (cards.length < 5) {
    throw new Error(`evaluateBest requires at least 5 cards, got ${cards.length}`)
  }
  if (cards.length === 5) {
    return evaluate5(cards)
  }

  let best: HandRank | null = null
  for (const combo of combinations(cards.length, 5)) {
    const hand = combo.map((i) => cards[i])
    const rank = evaluate5(hand)
    if (best === null || compareRank(rank, best) > 0) {
      best = rank
    }
  }
  return best as HandRank
}

/** Omaha rule: best rank using EXACTLY 2 of 4 hole + EXACTLY 3 of 5 board. */
export function evaluateOmaha(hole: Card[], board: Card[]): HandRank {
  if (hole.length !== 4) {
    throw new Error(`evaluateOmaha requires exactly 4 hole cards, got ${hole.length}`)
  }
  if (board.length !== 5) {
    throw new Error(`evaluateOmaha requires exactly 5 board cards, got ${board.length}`)
  }

  const holeCombos = combinations(4, 2)
  const boardCombos = combinations(5, 3)

  let best: HandRank | null = null
  for (const hc of holeCombos) {
    const holeCards = hc.map((i) => hole[i])
    for (const bc of boardCombos) {
      const boardCards = bc.map((i) => board[i])
      const rank = evaluate5([...holeCards, ...boardCards])
      if (best === null || compareRank(rank, best) > 0) {
        best = rank
      }
    }
  }
  return best as HandRank
}

/** >0 if a is stronger, <0 if b is stronger, 0 if a tie. */
export function compareRank(a: HandRank, b: HandRank): number {
  if (a.cat !== b.cat) return a.cat - b.cat
  const len = Math.max(a.tb.length, b.tb.length)
  for (let i = 0; i < len; i++) {
    const av = a.tb[i] ?? 0
    const bv = b.tb[i] ?? 0
    if (av !== bv) return av - bv
  }
  return 0
}
