/**
 * One answer per spot, for panels that re-render many times per spot.
 *
 * Every number in this trainer is enumerated rather than sampled, which makes a
 * query expensive exactly once and then free forever — the same two hands on the
 * same board have the same equity whatever else the page is doing. Nothing was
 * exploiting that. `renderSolve` computed hero's equity **twice** on every pass
 * (once for the result table, once again inside `heroEquity()` for the pot-odds
 * panel), re-derived the villain range three times, and ran the whole lot again
 * on **every keystroke in the pot and bet boxes** — inputs that cannot move a
 * single one of those numbers. The drill did the same on every tab switch, so
 * leaving a revealed spot and coming back re-counted half a million boards to
 * redraw text that had not changed.
 *
 * So this is a memo, and it is written the way a memo has to be written to be
 * trustworthy: ==the key is derived from the arguments themselves==, never handed
 * in alongside them. A cache keyed on a label the caller also supplies is the
 * same mistake as a validator that reads its own algorithm out of the token it
 * is checking — it lets the caller say two different spots are the same one.
 * That is why `cachedEquityVsRange` keys on the combos it was actually given
 * rather than on the range text they were parsed from: the text is a fact about
 * where the combos came from, and the answer is a fact about the combos.
 *
 * The canonical form sorts cards within each hand and within the board, because
 * clicking A♠ then K♥ and clicking K♥ then A♠ are the same spot and a memo that
 * misses on the second one is doing half a job. That is a *claim* — that these
 * functions are invariant under permutation within a hand — and it is asserted
 * in `security:smoke` against the uncached functions rather than assumed. It
 * holds because `scoreBest` reads its cards as bitmasks, `scoreOmaha` walks every
 * 2-of-4 and 3-of-5 regardless of order, and `remainingDeck` filters a fixed deck
 * so the enumeration order never depends on how the input was ordered.
 *
 * Two properties the assertions pin, since a wrong memo is invisible — it does
 * not crash, it returns a confident number belonging to a different spot:
 *
 *   - **The cached answer is `deepEqual` to the uncached one**, for every spot
 *     shape the UI can reach. Same structure as `scoreBest` against
 *     `evaluateBest`: the slow path stays the definition, the fast path is only
 *     ever allowed to agree with it.
 *   - **It is bounded.** A page left open all afternoon must not grow a map for
 *     every spot ever typed. Least-recently-*used* eviction, not
 *     least-recently-added: a panel alternating between two spots would evict
 *     precisely the one it is about to ask for again.
 */

import {
  equityVsRange,
  exactEquity,
  type EquityResult,
  type RangeEquityResult,
  type Variant,
} from './equity'
import { parseRange, rangeCombos } from './ranges'
import type { Card } from './types'

/**
 * Entries kept per store.
 *
 * Small on purpose. An entry is a handful of numbers plus at most six example
 * hands, so the memory is irrelevant; what the bound buys is the guarantee that
 * an interactive page cannot turn a text box into an unbounded map. The Solve
 * tab reaches maybe three or four distinct spots while you are looking at one,
 * and the drill one, so this is many times the working set.
 */
export const EQUITY_CACHE_LIMIT = 24

function cardKey(card: Card): string {
  return `${card.r}${card.s}`
}

/**
 * A set of cards as one canonical string.
 *
 * Sorted, so pick order cannot cause a miss, and comma-separated so no two
 * different sets can spell the same key — `14s,2c` is unambiguous where `14s2c`
 * would depend on ranks never being able to run together.
 */
export function cardsKey(cards: readonly Card[]): string {
  return cards.map(cardKey).sort().join(',')
}

/**
 * The full key for a hand-vs-hand spot.
 *
 * Hands are canonicalised individually and then joined **in the order they were
 * given**, because the result is index-aligned with the input: hero is index 0
 * and sorting the hands against each other would swap whose equity is whose.
 */
export function spotKey(holeCards: readonly Card[][], board: readonly Card[], variant: Variant): string {
  return `${variant}|${holeCards.map(cardsKey).join('/')}|${cardsKey(board)}`
}

function memo<T>(store: Map<string, T>, key: string, compute: () => T): T {
  const hit = store.get(key)
  if (hit !== undefined) {
    // Re-insert to move it to the young end of the Map's insertion order, which
    // is what turns "delete the oldest key" into least-recently-*used*.
    store.delete(key)
    store.set(key, hit)
    return hit
  }
  const value = compute()
  store.set(key, value)
  if (store.size > EQUITY_CACHE_LIMIT) {
    const oldest = store.keys().next()
    if (!oldest.done) store.delete(oldest.value)
  }
  return value
}

/**
 * Freeze what is handed out, shallowly.
 *
 * Callers get the *same object* on every hit, so a caller that sorted or pushed
 * to `win` in place would corrupt every later reader of that spot — a bug that
 * would surface as a wrong percentage somewhere else entirely. Modules are
 * strict-mode, so an attempted write throws where it happens instead. Shallow is
 * enough and is the honest depth: the arrays that could plausibly be mutated are
 * the result's own, and `worst`/`best` hold the caller's own combo arrays, which
 * are not this module's to freeze.
 */
function freezeEquity(result: EquityResult): EquityResult {
  Object.freeze(result.win)
  Object.freeze(result.tie)
  Object.freeze(result.equity)
  return Object.freeze(result)
}

function freezeRange(result: RangeEquityResult): RangeEquityResult {
  Object.freeze(result.worst)
  Object.freeze(result.best)
  return Object.freeze(result)
}

const handStore = new Map<string, EquityResult>()
const rangeStore = new Map<string, RangeEquityResult>()
const combosStore = new Map<string, ParsedCombos>()

/** `exactEquity`, computed once per spot. Identical result, including identity. */
export function cachedExactEquity(
  holeCards: Card[][],
  board: Card[] = [],
  variant: Variant = 'holdem',
): EquityResult {
  return memo(handStore, spotKey(holeCards, board, variant), () =>
    freezeEquity(exactEquity(holeCards, board, variant)))
}

/**
 * `equityVsRange`, computed once per (hero, range, board, variant).
 *
 * The villain range is keyed by its contents. That is a longer key than the
 * range *text* would be — a wide defending range is a few kilobytes of it — and
 * it is the right one anyway: the combos are what the answer is a fact about,
 * the text is only where they came from, and the two can disagree the moment a
 * caller filters the list before passing it. Building the key costs tens of
 * microseconds against the hundreds of milliseconds it saves.
 */
export function cachedEquityVsRange(
  hero: Card[],
  villainRange: Card[][],
  board: Card[] = [],
  variant: Variant = 'holdem',
): RangeEquityResult {
  const key = `${spotKey([hero], board, variant)}|${villainRange.map(cardsKey).join(';')}`
  return memo(rangeStore, key, () =>
    freezeRange(equityVsRange(hero, villainRange, board, variant)))
}

export interface ParsedCombos {
  /** Every specific two-card combination in the range, minus the blocked ones. */
  combos: Card[][]
  /** Tokens that were not valid shorthand, so the UI can say what it ignored. */
  dropped: string[]
}

/**
 * `parseRange` + `rangeCombos`, computed once per (text, blocked cards).
 *
 * Cheap next to an enumeration — about 1.6ms for a wide range — but the Solve
 * tab asked for it three times per render and the drill deals with it in a loop,
 * so it is the same waste one order of magnitude down. It also gives the range a
 * stable identity, which is what lets `cachedEquityVsRange` hit at all.
 */
export function cachedRangeCombos(text: string, blocked: Card[] = []): ParsedCombos {
  return memo(combosStore, `${text}|${cardsKey(blocked)}`, () => {
    const { classes, dropped } = parseRange(text)
    return Object.freeze({ combos: rangeCombos(classes, blocked), dropped })
  })
}

/**
 * Entry counts per store.
 *
 * Exported so `security:smoke` can assert the bound holds rather than trusting
 * that it does — an unbounded cache looks exactly like a bounded one until the
 * tab has been open long enough for it not to.
 */
export function equityCacheSizes(): { hands: number; ranges: number; combos: number } {
  return { hands: handStore.size, ranges: rangeStore.size, combos: combosStore.size }
}

/** Drop everything. Exists so the assertions can measure a cold start. */
export function clearEquityCache(): void {
  handStore.clear()
  rangeStore.clear()
  combosStore.clear()
}
