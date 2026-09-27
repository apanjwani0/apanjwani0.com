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

/* ──────────────────  fast path: one comparable integer  ────────────────── */

/**
 * The same ranking as `evaluateBest`, as a single integer, with no allocation
 * and no five-card subset enumeration.
 *
 * ==This is an optimisation, not a second opinion.== `evaluate5` above stays the
 * definition of what a hand is worth; everything below must agree with it to
 * the bit, and `security:smoke` asserts exactly that over all 2,598,960
 * five-card hands rather than over a sample. The equity engine is the only
 * caller that needs the speed, and it needs a lot of it: one range query on the
 * Solve tab's default preset is ~122,000 runouts x 2 hands, and at
 * `evaluateBest`'s 44k hands/second that is 5.8 seconds of blocked main thread
 * — twice per render.
 *
 * ### Why a packed integer is safe here, when `types.ts` says it is not
 *
 * `HandRank` deliberately carries no packed score, and that warning is about
 * `tb` being variable-length: a flush holds five tiebreakers and quads holds
 * two, so there is no fixed-width encoding of `tb` *alone* that orders hands.
 * The escape is that **`tb`'s length is a function of `cat`** — every flush has
 * five, every quads has two — so `cat` leads the encoding and two hands are only
 * ever compared digit-against-digit within one category.
 *
 * Given that, the packing below is order-isomorphic to `compareRank` **by
 * construction**: it is a fixed six-digit base-16 numeral `[cat, tb0..tb4]`,
 * `compareRank` is lexicographic on that same padded tuple, and lexicographic
 * order on equal-length digit strings is numeric order. The only obligation is
 * that every digit stays inside a nibble — `cat` is 0..8 and every tiebreaker is
 * a rank 2..14, both < 16 — and that is asserted, not assumed.
 *
 * ### Why there is no subset enumeration
 *
 * The best five of seven is the better of two independent readings, so both are
 * computed and the larger wins:
 *
 * - the **flush reading** — any suit holding five or more cards, taken as a
 *   straight flush if that suit's ranks contain a run, otherwise its top five;
 * - the **rank reading** — quads, full house, straight, trips, two pair, pair or
 *   high card, all of which fall out of how often each rank appears.
 *
 * Taking the max of the two is what makes this obviously complete rather than
 * clever: every category belongs to exactly one reading, and no argument about
 * which hands can coexist is load-bearing. (Seven cards cannot in fact hold both
 * a flush and a full house — five cards of one suit have five distinct ranks, so
 * the two leftover cards can lift a rank to three of a kind at most — but this
 * does not rely on that being true.)
 */

/** Highest rank present in a 13-bit rank mask, where bit 0 is a deuce. */
function topRank(mask: number): number {
  return 31 - Math.clz32(mask) + 2
}

/** The mask with `rank` removed. */
function withoutRank(mask: number, rank: number): number {
  return mask & ~(1 << (rank - 2))
}

/**
 * Top card of the best straight in a rank mask, or 0 for none.
 *
 * The ace is re-entered below the deuce so the wheel needs no special case: the
 * run it finds there tops out at the five, which is also exactly the tiebreaker
 * `evaluate5` gives it.
 */
function straightTop(mask: number): number {
  const extended = (mask << 1) | ((mask >>> 12) & 1)
  const runs = extended & (extended >>> 1) & (extended >>> 2) & (extended >>> 3) & (extended >>> 4)
  return runs === 0 ? 0 : 31 - Math.clz32(runs) + 5
}

/** Number of ranks present in a 13-bit mask. */
function countRanks(mask: number): number {
  let n = 0
  for (let m = mask; m !== 0; m &= m - 1) n++
  return n
}

/** `cat` followed by the top `take` ranks of `mask`, as one packed score. */
function packTop(cat: number, mask: number, take: number): number {
  let score = cat << 20
  let shift = 16
  let rest = mask
  for (let i = 0; i < take && rest !== 0; i++) {
    const rank = topRank(rest)
    score |= rank << shift
    rest = withoutRank(rest, rank)
    shift -= 4
  }
  return score
}

/**
 * `cat` and up to five tiebreakers as one integer.
 *
 * Exported so callers can turn a `HandRank` into the same currency — see
 * `packRank`. Every argument must be < 16 or the digits collide.
 */
export function packScore(cat: number, d0 = 0, d1 = 0, d2 = 0, d3 = 0, d4 = 0): number {
  return (cat << 20) | (d0 << 16) | (d1 << 12) | (d2 << 8) | (d3 << 4) | d4
}

/** A `HandRank` in the packed currency, so the two paths can be compared. */
export function packRank(rank: HandRank): number {
  const tb = rank.tb
  return packScore(rank.cat, tb[0] ?? 0, tb[1] ?? 0, tb[2] ?? 0, tb[3] ?? 0, tb[4] ?? 0)
}

/**
 * Packed score of the best five-card hand inside 5..7 cards.
 *
 * Ordered identically to `compareRank(evaluateBest(a), evaluateBest(b))`, and
 * equal to `packRank(evaluateBest(cards))` for every input.
 */
export function scoreBest(cards: Card[]): number {
  if (cards.length < 5) {
    throw new Error(`scoreBest requires at least 5 cards, got ${cards.length}`)
  }

  // Ranks seen at least once / twice / three times / four times. Each new card
  // promotes itself up the ladder, so no per-rank counter array is needed and
  // nothing is allocated.
  let seen1 = 0
  let seen2 = 0
  let seen3 = 0
  let seen4 = 0
  let clubs = 0
  let diamonds = 0
  let hearts = 0
  let spades = 0

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const bit = 1 << (card.r - 2)
    seen4 |= seen3 & bit
    seen3 |= seen2 & bit
    seen2 |= seen1 & bit
    seen1 |= bit
    const suit = card.s
    if (suit === 'c') clubs |= bit
    else if (suit === 'd') diamonds |= bit
    else if (suit === 'h') hearts |= bit
    else spades |= bit
  }

  let best = 0

  // Flush reading.
  for (let i = 0; i < 4; i++) {
    const suited = i === 0 ? clubs : i === 1 ? diamonds : i === 2 ? hearts : spades
    if (countRanks(suited) < 5) continue
    const run = straightTop(suited)
    const score = run !== 0
      ? packScore(HAND_CATEGORY.STRAIGHT_FLUSH, run)
      : packTop(HAND_CATEGORY.FLUSH, suited, 5)
    if (score > best) best = score
  }

  // Rank reading, richest category first so the first match is the best one.
  const straight = straightTop(seen1)
  let ranked: number
  if (seen4 !== 0) {
    const quad = topRank(seen4)
    ranked = packScore(HAND_CATEGORY.QUADS, quad, topRank(withoutRank(seen1, quad)))
  } else if (seen3 !== 0 && withoutRank(seen2, topRank(seen3)) !== 0) {
    // `seen2` holds every rank appearing at least twice, so a second set of
    // trips is a legal pair here — AAAKKKQ is aces full of kings.
    const trips = topRank(seen3)
    ranked = packScore(HAND_CATEGORY.FULL_HOUSE, trips, topRank(withoutRank(seen2, trips)))
  } else if (straight !== 0) {
    ranked = packScore(HAND_CATEGORY.STRAIGHT, straight)
  } else if (seen3 !== 0) {
    const trips = topRank(seen3)
    const rest = withoutRank(seen1, trips)
    const first = topRank(rest)
    ranked = packScore(HAND_CATEGORY.TRIPS, trips, first, topRank(withoutRank(rest, first)))
  } else if (countRanks(seen2) >= 2) {
    const high = topRank(seen2)
    const low = topRank(withoutRank(seen2, high))
    ranked = packScore(HAND_CATEGORY.TWO_PAIR, high, low,
      topRank(withoutRank(withoutRank(seen1, high), low)))
  } else if (seen2 !== 0) {
    const pair = topRank(seen2)
    const rest = withoutRank(seen1, pair)
    const first = topRank(rest)
    const after = withoutRank(rest, first)
    const second = topRank(after)
    ranked = packScore(HAND_CATEGORY.PAIR, pair, first, second,
      topRank(withoutRank(after, second)))
  } else {
    ranked = packTop(HAND_CATEGORY.HIGH_CARD, seen1, 5)
  }

  return ranked > best ? ranked : best
}

/**
 * Scratch slot for `score5`.
 *
 * `scoreBest` reads an array and never calls back into `score5`, and JavaScript
 * here is single-threaded, so one reused slot is safe and keeps the Omaha loop
 * below from allocating 60 arrays per board. The alternative — a second copy of
 * the mask-building loop taking five arguments — is the drift `security:smoke`
 * would then have to catch twice.
 */
const SCORE5_SCRATCH: Card[] = new Array(5)

/** Packed score of exactly five cards, without building an array. */
export function score5(a: Card, b: Card, c: Card, d: Card, e: Card): number {
  SCORE5_SCRATCH[0] = a
  SCORE5_SCRATCH[1] = b
  SCORE5_SCRATCH[2] = c
  SCORE5_SCRATCH[3] = d
  SCORE5_SCRATCH[4] = e
  return scoreBest(SCORE5_SCRATCH)
}

/**
 * Packed score under Omaha's exactly-2-of-4 plus exactly-3-of-5 rule.
 *
 * The 60 combinations are walked as nested index loops rather than through the
 * `combinations()` table above, which allocated 6 + 10 arrays and then 60 more
 * to hold the cards, every single time it was asked.
 */
export function scoreOmaha(hole: Card[], board: Card[]): number {
  if (hole.length !== 4) {
    throw new Error(`scoreOmaha requires exactly 4 hole cards, got ${hole.length}`)
  }
  if (board.length !== 5) {
    throw new Error(`scoreOmaha requires exactly 5 board cards, got ${board.length}`)
  }
  let best = 0
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 4; j++) {
      for (let a = 0; a < 3; a++) {
        for (let b = a + 1; b < 4; b++) {
          for (let c = b + 1; c < 5; c++) {
            const score = score5(hole[i], hole[j], board[a], board[b], board[c])
            if (score > best) best = score
          }
        }
      }
    }
  }
  return best
}
