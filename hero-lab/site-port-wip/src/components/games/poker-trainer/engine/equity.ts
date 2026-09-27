/**
 * Exact equity by full enumeration.
 *
 * Every number this module produces is computed, not looked up and not
 * sampled — it enumerates every legal runout and counts. There is no Monte
 * Carlo anywhere, so results are reproducible to the last decimal and carry no
 * confidence interval to caveat. That is deliberate: a trainer that is
 * approximately right teaches you to be approximately right.
 *
 * The cost of that is a real bound on what can be asked. Enumerating a preflop
 * hand-vs-hand runout is C(48,5) = 1,712,304 boards; a flop is C(45,2) = 990 and
 * a turn is 44. So the caller is told the size before it runs (`countRunouts`)
 * and can refuse, rather than the module silently switching to sampling to stay
 * fast. Silently degrading exactness to preserve responsiveness is the one thing
 * it must not do.
 *
 * What that bound costs is now roughly two orders of magnitude smaller than it
 * was. The enumerator used to rank every hand through `evaluateBest`, which
 * builds all 21 five-card subsets of the seven cards, allocates its way through
 * each of them and composes an English name for every one — 44,000 hands a
 * second, so the Solve tab's default range query took 5.8s and the tab ran it
 * twice per render. The loop below now ranks through `scoreBest`, which reads
 * the same hand as bitmasks and returns one comparable integer: 27M hands a
 * second, and that query takes 35ms. ==Not one number changed==, and that is
 * asserted rather than hoped — see the note over the fast path in
 * `evaluator.ts`.
 *
 * The "twice per render" half of that sentence is history too: `equity-cache.ts`
 * now sits between this module and both panels, so a spot is enumerated once and
 * every later reader of it — the result table, the pot-odds panel, the next
 * keystroke in a box that cannot change the answer — reads the same object back.
 */

import { compareRank, evaluateBest, evaluateOmaha, scoreBest, scoreOmaha } from './evaluator'
import { SUITS, type Card, type HandRank, type Suit } from './types'

/**
 * Hold'em or Pot-Limit Omaha.
 *
 * The two differ in one rule and it changes everything downstream: in Omaha you
 * hold four cards and must use ==EXACTLY two of them, plus exactly three of the
 * board==. Not "at most two" — exactly. That is why a lone ace in your hand does
 * not make a flush when four of that suit are on the board, and it is the single
 * most common mistake a Hold'em player makes on switching. It also means an
 * Omaha hand is 6 two-card combinations against 10 three-card boards, so every
 * hand is the best of 60 five-card hands rather than the best of 21.
 */
export type Variant = 'holdem' | 'plo'

/** Hole cards dealt in each variant. */
export function holeCount(variant: Variant): number {
  return variant === 'plo' ? 4 : 2
}

/** Rank a hole+board pair under the variant's rules. */
export function rankHand(hole: Card[], board: Card[], variant: Variant): HandRank {
  return variant === 'plo' ? evaluateOmaha(hole, board) : evaluateBest([...hole, ...board])
}

export interface EquityResult {
  /** Fraction of runouts each hand wins outright, index-aligned with the input. */
  win: number[]
  /** Fraction where the hand is part of a tie (split), index-aligned. */
  tie: number[]
  /** win + tie/(number of players sharing) — the share of the pot expected. */
  equity: number[]
  /** Total boards enumerated. Exact, not a sample size. */
  runouts: number
}

const FULL_DECK: Card[] = (() => {
  const deck: Card[] = []
  for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push({ r, s })
  return deck
})()

function cardKey(card: Card): string {
  return `${card.r}${card.s}`
}

/** The cards still available once the known ones are removed. */
export function remainingDeck(known: Card[]): Card[] {
  const used = new Set(known.map(cardKey))
  return FULL_DECK.filter(card => !used.has(cardKey(card)))
}

/** C(n, k) — used to tell a caller the cost before committing to it. */
export function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let result = 1
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i
  return Math.round(result)
}

/**
 * How many boards a query would enumerate, so the caller can decide whether to
 * run it. Cheap, and the honest alternative to quietly sampling.
 */
export function countRunouts(holeCards: Card[][], board: Card[]): number {
  const known = [...holeCards.flat(), ...board]
  const remaining = 52 - known.length
  return combinations(remaining, 5 - board.length)
}

/**
 * Five-card reads a query would cost, which is the thing that actually takes the
 * time — boards dealt is not.
 *
 * `countRunouts` answers "how many boards", and a ceiling written in boards reads
 * Hold'em and Omaha as equally expensive. They are nowhere near it. A Hold'em
 * showdown is one pass of `scoreBest` over seven cards; an Omaha showdown is
 * `scoreOmaha`, which is 6 two-card holdings against 10 three-card boards — sixty
 * calls into `score5` — because the exactly-two-of-four rule cannot be collapsed
 * into a best-of-any read. So a preflop Omaha spot is *fewer* boards than a
 * preflop Hold'em one (1,086,008 against 1,712,304) and takes roughly twenty
 * times as long, and a boards ceiling admitting one has to refuse the other for
 * the wrong reason.
 *
 * The unit is a `score5`-equivalent. Omaha's 60 is structural — it is exactly how
 * many five-card hands `scoreOmaha` ranks per board, not a fitted constant — and
 * Hold'em is weighted 2 because a seven-card `scoreBest` measures about twice a
 * five-card one: the same mask arithmetic over two more cards, with four flush
 * reads either way.
 *
 * ==The residual is stated rather than tuned away.== Warm, Hold'em runs ~25M of
 * these units a second and Omaha ~16-20M, because sixty `score5` calls rebuild
 * their masks sixty times where one `scoreBest` builds them once. So the model
 * is optimistic about Omaha by up to a third. Pushing Omaha's weight to 75 would
 * close that and would also turn a number that means something into a fudge
 * factor, and the ceiling this feeds separates a quarter-second query from a
 * seven-second one — a third is noise at that distance, where counting boards
 * was wrong by a factor of twenty and in the wrong direction.
 */
const RANK_COST: Record<Variant, number> = { holdem: 2, plo: 60 }

export function handsRanked(
  holeCards: Card[][],
  board: Card[],
  variant: Variant = 'holdem',
): number {
  return countRunouts(holeCards, board) * holeCards.length * RANK_COST[variant]
}

/**
 * Exact equity for two or more specific hands on a (possibly empty) board.
 *
 * Throws rather than guessing on malformed input: a duplicated card means the
 * caller has a bug, and returning a plausible-looking number for an impossible
 * situation is worse than failing.
 */
export function exactEquity(
  holeCards: Card[][],
  board: Card[] = [],
  variant: Variant = 'holdem',
): EquityResult {
  if (holeCards.length < 2) throw new Error('Equity needs at least two hands.')
  if (board.length > 5) throw new Error('A board holds at most five cards.')
  const need = holeCount(variant)
  for (const hand of holeCards) {
    if (hand.length !== need) {
      throw new Error(
        variant === 'plo'
          ? 'Each hand needs exactly four hole cards (Omaha).'
          : "Each hand needs exactly two hole cards (Hold'em).",
      )
    }
  }

  const known = [...holeCards.flat(), ...board]
  const seen = new Set<string>()
  for (const card of known) {
    const key = cardKey(card)
    if (seen.has(key)) throw new Error(`Duplicate card: ${key}`)
    seen.add(key)
  }

  const deck = remainingDeck(known)
  const fillCount = 5 - board.length
  const n = holeCards.length

  const wins = new Array<number>(n).fill(0)
  const ties = new Array<number>(n).fill(0)
  const equity = new Array<number>(n).fill(0)
  let runouts = 0

  // Scratch buffers reused across every runout. Allocating a fresh array per
  // board is the difference between this finishing and this being unusable at
  // 1.7M iterations.
  const fill: Card[] = new Array(fillCount)
  const fullBoard: Card[] = new Array(5)
  const combined: Card[] = new Array(5 + holeCount(variant))
  const scores = new Int32Array(n)

  const evaluateAll = () => {
    runouts++
    for (let b = 0; b < board.length; b++) fullBoard[b] = board[b]
    for (let f = 0; f < fillCount; f++) fullBoard[board.length + f] = fill[f]

    let best = -1
    let bestCount = 0
    // Hands are compared as packed scores rather than as `HandRank` objects.
    // `types.ts` warns that `tb` is variable-length and so supports no numeric
    // shortcut, and that warning stands for `tb` on its own — the escape is that
    // its length is fixed by `cat`, so `scoreBest` leads with `cat` and only
    // ever compares digits within one category. See the long note in
    // `evaluator.ts`; `security:smoke` holds the two paths to the same answer on
    // every one of the 2,598,960 five-card hands, which is what makes this a
    // speed change and not a numbers change.
    for (let i = 0; i < n; i++) {
      let score: number
      if (variant === 'plo') {
        // Omaha's exactly-2-of-4 rule cannot be expressed by handing nine cards
        // to the best-of-any evaluator — that would let a hand play one hole
        // card, or none, and every flush number would come out too high.
        score = scoreOmaha(holeCards[i], fullBoard)
      } else {
        let k = 0
        for (const card of holeCards[i]) combined[k++] = card
        for (let b = 0; b < 5; b++) combined[k++] = fullBoard[b]
        score = scoreBest(combined)
      }
      scores[i] = score
      if (score > best) { best = score; bestCount = 1 }
      else if (score === best) bestCount++
    }
    for (let i = 0; i < n; i++) {
      if (scores[i] !== best) continue
      if (bestCount === 1) wins[i]++
      else { ties[i]++; equity[i] += 1 / bestCount }
    }
  }

  // Choose `fillCount` cards from `deck`, in index order so no board repeats.
  const choose = (start: number, depth: number) => {
    if (depth === fillCount) { evaluateAll(); return }
    const last = deck.length - (fillCount - depth)
    for (let i = start; i <= last; i++) {
      fill[depth] = deck[i]
      choose(i + 1, depth + 1)
    }
  }
  choose(0, 0)

  return {
    win: wins.map(w => w / runouts),
    tie: ties.map(t => t / runouts),
    equity: equity.map((share, i) => (wins[i] + share) / runouts),
    runouts,
  }
}

export interface RangeEquityResult {
  /** Hero's share of the pot, averaged over every combo in the range. */
  equity: number
  /** Combos actually enumerated — the range minus anything blocked. */
  combos: number
  /** Total boards enumerated across all combos. Exact, not a sample size. */
  runouts: number
  /** Share of combos hero is ahead of (equity > 0.5) — "how much of their range you beat". */
  aheadOf: number
  /** The combos hero does worst and best against, for showing WHY. */
  worst: Array<{ hand: Card[]; equity: number }>
  best: Array<{ hand: Card[]; equity: number }>
}

/** Work a range query costs, so a caller can refuse before committing to it. */
export function rangeWork(combos: number, board: Card[], variant: Variant = 'holdem'): number {
  const holeCards = holeCount(variant)
  const remaining = 52 - holeCards * 2 - board.length
  return combos * combinations(remaining, 5 - board.length)
}

/**
 * Hero's exact equity against a whole range, and the shape of that average.
 *
 * This is the number a poker decision actually turns on. "I have 62% against
 * ace-king" is a fact about a hand you cannot see; "I have 54% against the range
 * they open from the button" is a fact about the decision in front of you.
 *
 * The average alone is not enough to learn from, which is why `worst` and `best`
 * come back with it. ==A hand that is 55% against a range is frequently crushed
 * by the top of it and far ahead of the bottom==, and knowing which combos sit at
 * each end is the whole content of "what am I actually beating here". An average
 * hides exactly the information a player needs.
 *
 * Every combo is enumerated exactly, like everything else here — no sampling.
 * The caller checks `rangeWork()` first and refuses when it is too large, rather
 * than this switching to Monte Carlo to stay responsive.
 */
export function equityVsRange(
  hero: Card[],
  villainRange: Card[][],
  board: Card[] = [],
  variant: Variant = 'holdem',
): RangeEquityResult {
  if (hero.length !== holeCount(variant)) {
    throw new Error(`Hero needs exactly ${holeCount(variant)} hole cards.`)
  }
  const dead = new Set([...hero, ...board].map(cardKey))

  let total = 0
  let runouts = 0
  let ahead = 0
  const per: Array<{ hand: Card[]; equity: number }> = []

  for (const villain of villainRange) {
    // A combo containing a card hero or the board already holds is not a hand
    // the opponent can have. Silently skipping it is the correct card-removal
    // behaviour; counting it would average in an impossible hand.
    if (villain.some(card => dead.has(cardKey(card)))) continue
    const result = exactEquity([hero, villain], board, variant)
    per.push({ hand: villain, equity: result.equity[0] })
    total += result.equity[0]
    runouts += result.runouts
    if (result.equity[0] > 0.5) ahead++
  }

  if (!per.length) throw new Error('Every combo in that range is blocked by the known cards.')

  const sorted = [...per].sort((a, b) => a.equity - b.equity)
  return {
    equity: total / per.length,
    combos: per.length,
    runouts,
    aheadOf: ahead / per.length,
    worst: sorted.slice(0, 3),
    best: sorted.slice(-3).reverse(),
  }
}

/**
 * Cards that improve a hand to the current best, given a board.
 *
 * "Outs" is taught as a count and used as a shortcut (the rule of 2 and 4), and
 * the shortcut is where people go wrong — it ignores that an out can also
 * improve the opponent, and that two cards to come is not twice one card. This
 * returns the real list so the UI can show both the count AND the exact equity
 * beside it, which is the whole point of computing rather than estimating.
 */
export function outsAgainst(hero: Card[], villain: Card[], board: Card[]): Card[] {
  if (board.length < 3 || board.length > 4) {
    throw new Error('Outs are only meaningful on a flop or turn.')
  }
  const deck = remainingDeck([...hero, ...villain, ...board])
  const behindNow = compareRank(evaluateBest([...hero, ...board]), evaluateBest([...villain, ...board])) < 0
  if (!behindNow) return []

  return deck.filter(card => {
    const next = [...board, card]
    return compareRank(evaluateBest([...hero, ...next]), evaluateBest([...villain, ...next])) > 0
  })
}

/**
 * The equity a call needs to break even: risk / (pot after the call).
 *
 * Stated as a fraction, and deliberately separate from any equity number. The
 * decision is a comparison of two independently-computed quantities, and
 * collapsing them into one "you should call" verdict hides the arithmetic the
 * player is supposed to be learning.
 */
export function requiredEquity(potBeforeCall: number, callAmount: number): number {
  if (callAmount <= 0) throw new Error('A call must cost something.')
  if (potBeforeCall < 0) throw new Error('The pot cannot be negative.')
  return callAmount / (potBeforeCall + callAmount)
}

/**
 * EV of calling, in the same chips as the inputs.
 *
 * Assumes the hand goes to showdown with no further betting — which is the
 * assumption every "pot odds" lesson silently makes, so the UI states it rather
 * than letting the number imply more precision than it has.
 */
export function callEv(potBeforeCall: number, callAmount: number, equity: number): number {
  if (equity < 0 || equity > 1) throw new Error('Equity is a fraction between 0 and 1.')
  return equity * (potBeforeCall + callAmount) - callAmount
}

/* ─────────────────────────  hand notation  ───────────────────────── */

const RANK_CHARS = '23456789TJQKA'

/** '  AKs' / 'AKo' / 'AA' → the 169 canonical starting hands. */
export function handClass(cards: Card[]): string {
  if (cards.length !== 2) throw new Error('A starting hand is two cards.')
  const [a, b] = cards[0].r >= cards[1].r ? cards : [cards[1], cards[0]]
  const high = RANK_CHARS[a.r - 2]
  const low = RANK_CHARS[b.r - 2]
  if (a.r === b.r) return `${high}${low}`
  return `${high}${low}${a.s === b.s ? 's' : 'o'}`
}

/**
 * Every specific two-card combination of a canonical hand class.
 *
 * The counts matter and are the thing people get wrong when they eyeball a
 * range: a pair is 6 combos, a suited hand 4, an offsuit hand 12. So "AK" is 16
 * combos while "AA" is 6 — nearly three times as likely to be dealt AK.
 */
export function classCombos(handClass: string): Card[][] {
  const high = RANK_CHARS.indexOf(handClass[0]) + 2
  const low = RANK_CHARS.indexOf(handClass[1]) + 2
  if (high < 2 || low < 2) throw new Error(`Unknown hand class: ${handClass}`)
  const suited = handClass[2] === 's'
  const combos: Card[][] = []

  if (high === low) {
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) {
        combos.push([{ r: high, s: SUITS[i] }, { r: low, s: SUITS[j] }])
      }
    }
    return combos
  }

  // The two ranks differ here, so every (suit, suit) pairing names a distinct
  // pair of cards: A♠K♥ and A♥K♠ are NOT the same hand, because the ace is a
  // different card in each. That gives 4 suited and 4×3 = 12 offsuit combos.
  // (Only the equal-rank case above has unordered suits, and it is handled by
  // iterating j > i rather than by filtering afterwards.)
  for (const s1 of SUITS) {
    for (const s2 of SUITS) {
      if (suited ? s1 !== s2 : s1 === s2) continue
      combos.push([{ r: high, s: s1 as Suit }, { r: low, s: s2 as Suit }])
    }
  }
  return combos
}
