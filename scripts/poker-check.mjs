/**
 * Correctness check for the Poker Trainer's equity engine.
 *
 * The product claim is "100% accurate", so it has to be provable rather than
 * asserted in a comment. Two kinds of assertion here, and the split is
 * deliberate:
 *
 *   - **Exact invariants** — things that must hold to the last bit: equities sum
 *     to 1, enumeration counts equal C(n,k), a locked hand is exactly 1.0, a
 *     mirrored hand is exactly 0.5, combinatorics of the 169 hand classes.
 *   - **Bounded sanity ranges** — for published equities (AA vs KK ≈ 82%), the
 *     range is asserted, not a remembered decimal. Hard-coding a 4-decimal
 *     number from memory would be exactly the kind of confident-looking
 *     inaccuracy this file exists to prevent.
 *
 * Run: npm run poker:check
 */

import assert from 'node:assert/strict'
import {
  callEv,
  classCombos,
  combinations,
  countRunouts,
  equityVsRange,
  exactEquity,
  handClass,
  outsAgainst,
  remainingDeck,
  requiredEquity,
} from '../src/components/games/poker-trainer/engine/equity.ts'
import {
  PRESET_RANGES,
  expandToken,
  parseRange,
  rangeCombos,
} from '../src/components/games/poker-trainer/engine/ranges.ts'
import { evaluateBest, evaluateOmaha, compareRank } from '../src/components/games/poker-trainer/engine/evaluator.ts'
import { HAND_CATEGORY } from '../src/components/games/poker-trainer/engine/types.ts'

/** 'As' → { r: 14, s: 's' } */
const RANKS = '23456789TJQKA'
const c = (text) => ({ r: RANKS.indexOf(text[0].toUpperCase()) + 2, s: text[1].toLowerCase() })
const hand = (text) => text.split(' ').map(c)

const near = (actual, lo, hi, what) =>
  assert.ok(actual >= lo && actual <= hi, `${what}: expected ${lo}..${hi}, got ${actual}`)

/* ── the evaluator underneath, since every equity number rests on it ── */

assert.equal(evaluateBest(hand('As Ks Qs Js Ts')).cat, HAND_CATEGORY.STRAIGHT_FLUSH)
assert.equal(evaluateBest(hand('5s 4s 3s 2s As')).cat, HAND_CATEGORY.STRAIGHT_FLUSH,
  'the wheel is a straight flush (A counts low)')
assert.equal(evaluateBest(hand('5h 4s 3s 2s Ad')).cat, HAND_CATEGORY.STRAIGHT,
  'A-2-3-4-5 is a straight')
// …and the wheel is the WORST straight, not the best — ace-high ranking would
// silently invert this and every equity number that depends on it.
assert.ok(
  compareRank(evaluateBest(hand('6h 5s 4s 3s 2d')), evaluateBest(hand('5h 4s 3s 2s Ad'))) > 0,
  '6-high straight beats the wheel',
)
assert.equal(evaluateBest(hand('As Ah Ad Ac Ks')).cat, HAND_CATEGORY.QUADS)
assert.equal(evaluateBest(hand('As Ah Ad Ks Kh')).cat, HAND_CATEGORY.FULL_HOUSE)
// Best 5 of 7 — the flush must be found even though a pair is also present.
assert.equal(evaluateBest(hand('As Ah 2s 5s 9s Ks 3d')).cat, HAND_CATEGORY.FLUSH)

/* ── enumeration counts are exact, and stated before the work is done ── */

assert.equal(combinations(48, 5), 1_712_304)
assert.equal(combinations(45, 2), 990)
assert.equal(combinations(44, 1), 44)
assert.equal(countRunouts([hand('As Ks'), hand('Qd Qc')], []), 1_712_304, 'preflop heads-up')
assert.equal(countRunouts([hand('As Ks'), hand('Qd Qc')], hand('2h 7d 9c')), 990, 'flop')
assert.equal(countRunouts([hand('As Ks'), hand('Qd Qc')], hand('2h 7d 9c Ts')), 44, 'turn')
assert.equal(remainingDeck(hand('As Ks Qd Qc')).length, 48)

/* ── exact invariants ── */

// River: no cards to come, so exactly one "runout" and a decided result.
const river = exactEquity([hand('As Ah'), hand('Kd Kc')], hand('2h 7d 9c Ts 3s'))
assert.equal(river.runouts, 1)
assert.deepEqual(river.equity, [1, 0], 'aces beat kings on a blank board, with certainty')

// A tie must split exactly, not approximately: both players play the same board.
const chop = exactEquity([hand('2h 3d'), hand('2c 3s')], hand('As Ks Qs Js Ts'))
assert.deepEqual(chop.equity, [0.5, 0.5], 'a shared royal flush splits exactly in half')
assert.deepEqual(chop.win, [0, 0])
assert.deepEqual(chop.tie, [1, 1])

// A locked hand is exactly 1, not 0.9999. Hero holds 6-high straight flush on
// 2s3s4s; the only hands that could beat it need 5s/6s, which hero holds.
const locked = exactEquity([hand('6s 5s'), hand('Ad Ac')], hand('2s 3s 4s'))
assert.equal(locked.equity[0], 1, 'an unbeatable hand is exactly 1')
assert.equal(locked.equity[1], 0)

// Equities partition the pot: they must sum to exactly 1 across all players.
for (const result of [river, chop, locked]) {
  const total = result.equity.reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(total - 1) < 1e-9, `equities must sum to 1, got ${total}`)
}

// Order must not matter, and repeated runs must agree to the bit.
const a = exactEquity([hand('As Ks'), hand('Qd Qc')], hand('2h 7d 9c'))
const b = exactEquity([hand('Qd Qc'), hand('As Ks')], hand('2h 7d 9c'))
assert.equal(a.equity[0], b.equity[1], 'equity is independent of argument order')
assert.deepEqual(exactEquity([hand('As Ks'), hand('Qd Qc')], hand('2h 7d 9c')), a, 'deterministic')

// Three-way still partitions the pot exactly.
const threeWay = exactEquity([hand('As Ks'), hand('Qd Qc'), hand('7h 2d')], hand('2h 7d 9c'))
assert.ok(Math.abs(threeWay.equity.reduce((x, y) => x + y, 0) - 1) < 1e-9)
assert.equal(threeWay.runouts, combinations(43, 2))

/* ── malformed input fails loudly rather than returning a plausible number ── */

assert.throws(() => exactEquity([hand('As Ks')], []), /at least two hands/)
assert.throws(() => exactEquity([hand('As Ks'), hand('As Qd')], []), /Duplicate card/)
assert.throws(() => exactEquity([hand('As Ks'), hand('Qd Qc')], hand('2h 3h 4h 5h 6h 7h')), /at most five/)
assert.throws(() => exactEquity([hand('As Ks Qs'), hand('Qd Qc')], []), /exactly two hole cards/)

/* ── outs: the real list, not the rule-of-thumb count ── */

// Flush draw on the flop: hero has four spades, nine remain.
const flushOuts = outsAgainst(hand('As Ks'), hand('Qd Qc'), hand('2s 7s 9h'))
assert.equal(flushOuts.length, 15, 'nine spades plus six ace/king outs that also win')
assert.ok(flushOuts.every(card => card.s === 's' || card.r === 14 || card.r === 13))
// Already ahead means no outs are needed — the concept does not apply.
assert.deepEqual(outsAgainst(hand('As Ah'), hand('Kd Kc'), hand('2s 7d 9h')), [])
assert.throws(() => outsAgainst(hand('As Ks'), hand('Qd Qc'), hand('2s 7s')), /flop or turn/)

/* ── pot odds and EV are arithmetic, and must stay exact ── */

assert.equal(requiredEquity(100, 50), 1 / 3, 'calling 50 into 100 needs 33.3%')
// Calling into an empty pot wins back only your own money, so break-even is 100%.
assert.equal(requiredEquity(0, 10), 1)
assert.throws(() => requiredEquity(100, 0), /must cost something/)
// Break-even by construction: EV is exactly zero at exactly the required equity.
assert.ok(Math.abs(callEv(100, 50, requiredEquity(100, 50))) < 1e-12, 'EV is 0 at the break-even point')
assert.ok(callEv(100, 50, 0.5) > 0, 'more equity than required is +EV')
assert.ok(callEv(100, 50, 0.2) < 0)
assert.throws(() => callEv(100, 50, 1.5), /between 0 and 1/)

/* ── hand classes: the combinatorics people get wrong ── */

assert.equal(handClass(hand('As Ks')), 'AKs')
assert.equal(handClass(hand('Kd As')), 'AKo', 'the higher card leads regardless of order')
assert.equal(handClass(hand('As Ah')), 'AA')
assert.equal(classCombos('AA').length, 6, 'a pair is 6 combos')
assert.equal(classCombos('AKs').length, 4, 'a suited hand is 4')
assert.equal(classCombos('AKo').length, 12, 'an offsuit hand is 12 — so AK is 16 combos to AA-s 6')
// Every generated combo must be two distinct real cards of the right class.
for (const cls of ['AA', 'AKs', 'AKo', '72o', 'JTs']) {
  for (const combo of classCombos(cls)) {
    assert.equal(combo.length, 2)
    assert.notEqual(`${combo[0].r}${combo[0].s}`, `${combo[1].r}${combo[1].s}`)
    assert.equal(handClass(combo), cls, `${cls} round-trips through handClass`)
  }
}
// The 169 classes must account for all 1326 two-card combinations, exactly.
let totalCombos = 0
for (let i = 0; i < RANKS.length; i++) {
  for (let j = 0; j <= i; j++) {
    const cls = i === j ? `${RANKS[i]}${RANKS[j]}` : `${RANKS[i]}${RANKS[j]}`
    totalCombos += i === j ? classCombos(cls).length : classCombos(`${cls}s`).length + classCombos(`${cls}o`).length
  }
}
assert.equal(totalCombos, 1326, 'the 169 classes cover all C(52,2) combinations')

/* ── bounded sanity: published equities, as ranges rather than remembered digits ── */

const flop = exactEquity([hand('As Ks'), hand('Qd Qc')], hand('2s 7s 9h'))
near(flop.equity[0], 0.5, 0.62, 'AKs with a flush draw vs QQ on 2s7s9h')

const aces = exactEquity([hand('As Ah'), hand('Kd Kc')], hand('2s 7d 9h Ts 3c'))
assert.deepEqual(aces.equity, [1, 0], 'aces hold on a blank runout')

/* ─────────────────────  Omaha: the exactly-two rule  ───────────────────── */

// The rule that separates PLO from Hold'em, and the one a Hold'em player gets
// wrong first. Board is four hearts; the hand holds the ace of hearts and three
// blanks. In Hold'em that is the nut flush. In Omaha it is NOT a flush at all —
// you must play exactly two hole cards, and there is only one heart to play.
const loneAce = evaluateOmaha(hand('Ah 2c 3d 4s'), hand('Kh Qh 7h 3h 9c'))
assert.notEqual(loneAce.cat, HAND_CATEGORY.FLUSH, 'one hole heart cannot make an Omaha flush')
// Two hearts in hand does make it.
const twoHearts = evaluateOmaha(hand('Ah 5h 3d 4s'), hand('Kh Qh 7h 3c 9c'))
assert.equal(twoHearts.cat, HAND_CATEGORY.FLUSH, 'two hole hearts + three board hearts is a flush')

// Same trap on a paired board. Four nines are on the board, which in Hold'em is
// quads for everyone still in the pot. In Omaha you must play exactly three
// board cards and exactly two of your own, so the fourth nine is unreachable:
// the best available hand is three nines plus two hole cards as kickers.
const boardQuads = evaluateOmaha(hand('Ah Kd 3c 4s'), hand('9h 9s 9d 9c 2h'))
assert.equal(boardQuads.cat, HAND_CATEGORY.TRIPS, 'board quads play as trips in Omaha — the fourth nine cannot be used')
assert.deepEqual(boardQuads.tb, [9, 14, 13], 'with ace-king as the two forced hole cards')
// A pocket pair in hand DOES reach a full house on that board — three nines plus
// your own pair. This is the pair the Hold'em reading would have found anyway,
// which is why the two rules only visibly diverge on the case above.
const boardQuadsWithPair = evaluateOmaha(hand('Ah Ad 3c 4s'), hand('9h 9s 9d 9c 2h'))
assert.equal(boardQuadsWithPair.cat, HAND_CATEGORY.FULL_HOUSE, 'a pocket pair fills up on board trips')

// PLO equity runs through the same enumerator and must obey the same invariants.
const ploFlop = exactEquity(
  [hand('As Ks Qh Jh'), hand('2c 2d 7c 8d')],
  hand('9s Th 3c'),
  'plo',
)
assert.ok(Math.abs(ploFlop.equity[0] + ploFlop.equity[1] - 1) < 1e-9, 'PLO equities sum to 1')
assert.equal(ploFlop.runouts, combinations(52 - 8 - 3, 2), 'PLO flop enumerates C(41,2) runouts')

// Two identical-strength Omaha hands must split exactly, same as Hold'em. Suits
// mirrored so neither can make a flush the other cannot.
const ploMirror = exactEquity(
  [hand('As Ks Qh Jh'), hand('Ah Kh Qs Js')],
  hand('2c 7d 9c 3d Tc'),
  'plo',
)
assert.deepEqual(ploMirror.equity, [0.5, 0.5], 'mirrored Omaha hands split exactly')

assert.throws(() => exactEquity([hand('As Ks'), hand('Qd Qc')], [], 'plo'),
  /exactly four hole cards/, 'a two-card hand is rejected in PLO')

/* ──────────────────────  range notation  ────────────────────── */

// The shorthand people actually type. A pair token climbs the pairs; a non-pair
// token climbs the KICKER with the high card fixed. Reading `ATs+` as "every
// suited ace-or-better" is the common misreading and would silently widen a
// range by a factor of several.
assert.deepEqual(expandToken('77+'), ['77', '88', '99', 'TT', 'JJ', 'QQ', 'KK', 'AA'])
assert.deepEqual(expandToken('ATs+'), ['ATs', 'AJs', 'AQs', 'AKs'])
assert.deepEqual(expandToken('AQo+'), ['AQo', 'AKo'])
assert.deepEqual(expandToken('A5s-A2s'), ['A2s', 'A3s', 'A4s', 'A5s'])
assert.deepEqual(expandToken('JTs'), ['JTs'])
// A bare non-pair means both suitednesses — "AK" is 16 combos, not 4.
assert.deepEqual(expandToken('AK').sort(), ['AKo', 'AKs'])
assert.equal(rangeCombos(expandToken('AK')).length, 16)
// A typo costs that token, not the range.
assert.deepEqual(expandToken('XX'), [])
const parsed = parseRange('77+, ATs+, garbage, AKo')
assert.deepEqual(parsed.dropped, ['garbage'])
assert.ok(parsed.classes.includes('AA') && parsed.classes.includes('AKo'))

// Card removal. Holding an ace must halve their AA combos from 6 to 3 — this is
// the blocker effect, and a range expanded without it is wrong exactly where the
// reasoning matters.
assert.equal(rangeCombos(['AA']).length, 6)
assert.equal(rangeCombos(['AA'], hand('As Kd')).length, 3, 'holding one ace halves their AA combos')
assert.equal(rangeCombos(['AA'], hand('As Ah')).length, 1, 'holding two aces leaves one AA combo')

// Every preset must parse cleanly — a typo in a shipped range would quietly
// teach the wrong thing, and nothing else would catch it.
for (const preset of PRESET_RANGES) {
  const { classes, dropped } = parseRange(preset.text)
  assert.deepEqual(dropped, [], `preset "${preset.id}" has unparseable tokens: ${dropped.join(', ')}`)
  const combos = rangeCombos(classes).length
  assert.ok(combos > 0 && combos <= 1326, `preset "${preset.id}" expands to ${combos} combos`)
}
// And the presets must be ordered the way their labels claim: tighter ranges are
// strictly smaller. A "premium only" range wider than a button open would be an
// obvious lie that no individual assertion above would catch.
const size = (id) => rangeCombos(parseRange(PRESET_RANGES.find(p => p.id === id).text).classes).length
assert.ok(size('premium') < size('utg'), 'premium is tighter than an early-position open')
assert.ok(size('utg') < size('co'), 'early position is tighter than the cutoff')
assert.ok(size('co') < size('btn'), 'the cutoff is tighter than the button')

/* ──────────────────────  equity against a range  ────────────────────── */

// Against a range of exactly one combo, range equity must equal hand-vs-hand
// equity to the last bit. If those two ever disagree, one of them is wrong.
const oneCombo = equityVsRange(hand('As Ks'), [hand('Qd Qc')], hand('2s 7s 9h'))
const asHands = exactEquity([hand('As Ks'), hand('Qd Qc')], hand('2s 7s 9h'))
assert.equal(oneCombo.equity, asHands.equity[0], 'a one-combo range is hand-vs-hand')
assert.equal(oneCombo.combos, 1)

// Aces against a range of only aces: every combo is blocked or a mirror, so the
// answer must be exactly a split.
const acesVsAces = equityVsRange(hand('As Ah'), rangeCombos(['AA'], hand('As Ah')), hand('2c 7d 9h Ts 3c'))
assert.equal(acesVsAces.equity, 0.5, 'the only unblocked AA combo splits with itself')
assert.equal(acesVsAces.combos, 1, 'holding two aces leaves exactly one AA combo')

// The average must lie between the worst and best combo it averages over — a
// trivially true statement that catches a whole class of accumulator bugs.
const vsButton = equityVsRange(
  hand('Ah Kd'),
  rangeCombos(parseRange(PRESET_RANGES.find(p => p.id === 'premium').text).classes, hand('Ah Kd')),
  hand('2c 7d 9h'),
)
assert.ok(vsButton.equity >= vsButton.worst[0].equity, 'the mean is at least the worst case')
assert.ok(vsButton.equity <= vsButton.best[0].equity, 'the mean is at most the best case')
assert.ok(vsButton.aheadOf >= 0 && vsButton.aheadOf <= 1, 'aheadOf is a fraction')
// worst is ascending, best is descending — the UI relies on both orderings.
assert.ok(vsButton.worst[0].equity <= vsButton.worst[vsButton.worst.length - 1].equity)
assert.ok(vsButton.best[0].equity >= vsButton.best[vsButton.best.length - 1].equity)

// Card removal again, at the range-equity level: every combo blocked must throw
// rather than return a plausible-looking zero.
assert.throws(
  () => equityVsRange(hand('As Ah'), rangeCombos(['AA'], hand('As Ah Ad Ac')), hand('2c 7d 9h')),
  /blocked/,
  'a fully-blocked range is an error, not an equity of zero',
)

console.log('poker equity check ok')
