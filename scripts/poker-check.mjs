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
import { equityVsRanges, multiwayWork } from '../src/components/games/poker-trainer/engine/equity.ts'
import { cachedEquityVsRanges, clearEquityCache } from '../src/components/games/poker-trainer/engine/equity-cache.ts'
import {
  MIN_CONTINUING,
  RIVER_BLUFFS,
  continuingRange,
  draws,
  strength,
  toneForSize,
} from '../src/components/games/poker-trainer/engine/continuing.ts'
import {
  PT_MAX_RANGE_WORK,
  SCENARIO_TEMPLATES,
  dealSpot,
  decodeSpot,
  derive,
  encodeSpot,
  seededRng,
  spotWork,
} from '../src/components/games/poker-trainer/engine/scenarios.ts'
import {
  RAISE_MARGIN,
  fmtChips,
  fmtPercent,
  judge,
  raiseContinuingCombos,
  raiseTo,
} from '../src/components/games/poker-trainer/engine/decide.ts'
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

// …but every assertion above is SCORING-INVARIANT: equities summing to 1, a runout
// count, and a mirrored split all hold just as well if the enumerator forgets Omaha
// entirely and ranks nine cards best-of-any. Swapping `scoreOmaha` for `scoreBest`
// inside `exactEquity` left both gates green while making every PLO number wrong —
// the exactly-two-of-four rule was asserted only against `evaluateOmaha` directly,
// never against the enumerator that the trainer actually calls.
//
// Board quads separate the two readings by the entire range. Board `9h 9s 9d 9c`:
// under exactly-two-of-four nobody can use all four nines, so hero plays A-K + three
// nines (trips) and villain plays 2-2 + three nines (a full house) and wins outright;
// under best-of-any both simply hold the board's quads and hero's ace kicker wins.
const ploBoardQuads = exactEquity(
  [hand('Ah Kd 3c 4s'), hand('2h 2d 5c 6s')],
  hand('9h 9s 9d 9c'),
  'plo',
)
assert.deepEqual(
  ploBoardQuads.equity, [0, 1],
  'board quads: exactly-two-of-four makes this 0/100 — best-of-any scores it 96/4',
)

// Second reading of the same rule, in the other direction: one hole heart plus three
// board hearts is a flush to a best-of-any evaluator and nothing at all in Omaha.
const ploLoneHeart = exactEquity(
  [hand('Ah 2c 3d 4s'), hand('8s 8d 5c 6c')],
  hand('Kh Qh 7h 2s'),
  'plo',
)
assert.equal(
  Math.round(ploLoneHeart.equity[0] * 1000) / 1000, 0.275,
  'one hole heart cannot make a flush — best-of-any inflates this to 42.5%',
)

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

/* ───────────────────────  seven scenarios, 200 seeds each  ─────────────────────── */

// The pot in a dealt spot is never typed in: it is the sum of what the story says
// each player put in. So the check adds the ledger up itself, and sizes the bets
// with its own copy of the rounding rule (to the nearest 5, a tie going down)
// rather than importing the engine's, so a slip in either shows up as a mismatch.
const half5 = (x) => Math.ceil(x / 5 - 0.5) * 5
const sizeFor = (pot, share) => Math.max(10, half5((pot * share) / 100))
const cardId = (card) => `${card.r}${card.s}`
const comboId = (combo) => combo.map(cardId).sort().join(',')

const SIZE_SHARES = {
  'srp-ip': [33, 50, 66, 75, 100, 125],
  'srp-oop': [33, 50, 66, 75, 100, 125],
  'three-bet-pot': [33, 66],
  multiway: [33, 50, 66],
  'river-polar': [50, 100, 150, 200],
}
const SHOVE_SHARES = [0.5, 0.8, 1.0, 1.5, 2.5]
const PREFLOP_POT = {
  'srp-ip': [65], 'srp-oop': [55], 'three-bet-pot': [165, 175, 180],
  multiway: [80], 'bet-raised': [55],
}

assert.deepEqual(SCENARIO_TEMPLATES.map(t => t.weight), [3, 3, 2, 2, 2, 2, 2], 'template weights')
assert.deepEqual(SCENARIO_TEMPLATES.map(t => t.id),
  ['srp-ip', 'srp-oop', 'three-bet-pot', 'multiway', 'facing-shove', 'bet-raised', 'river-polar'])

const streetsSeen = new Map()
for (const template of SCENARIO_TEMPLATES) {
  for (let seed = 1; seed <= 200; seed++) {
    const { spot } = dealSpot(seed, template.id)
    const where = `${template.id} seed ${seed}`
    assert.equal(spot.templateId, template.id, where)
    streetsSeen.set(`${template.id}:${spot.street}`, true)

    // Cards: two for hero, three to five on the board, none repeated, street from the count.
    const cards = [...spot.hero, ...spot.board]
    assert.equal(spot.hero.length, 2, where)
    assert.equal(new Set(cards.map(cardId)).size, cards.length, `${where}: duplicate card`)
    assert.equal(spot.board.length, { flop: 3, turn: 4, river: 5 }[spot.street], `${where}: street matches the board`)

    // The pot reconciles: ledger sum, then derive() against the plain definitions.
    const ledgerSum = spot.ledger.reduce((sum, entry) => sum + entry.chips, 0)
    assert.equal(spot.potBefore, ledgerSum, `${where}: potBefore is the sum of the ledger`)
    for (const entry of spot.ledger) {
      assert.ok(entry.chips > 0 && Number.isInteger(entry.chips), `${where}: ledger chips are whole and positive`)
      assert.ok(spot.line.some(sentence => new RegExp(`\\b${entry.chips} chips\\b`).test(sentence)),
        `${where}: the story never says "${entry.chips} chips"`)
    }
    const d = derive(spot)
    assert.equal(d.potNow, ledgerSum + spot.heroIn + spot.bet + spot.callersIn, `${where}: potNow`)
    assert.equal(d.toCall, spot.bet - spot.heroIn, `${where}: toCall`)
    assert.equal(d.potAfterCall, d.potNow + d.toCall, `${where}: potAfterCall`)
    assert.equal(d.breakEven, d.toCall / d.potAfterCall)
    assert.equal(d.potOdds, d.potNow / d.toCall)
    assert.ok(d.toCall > 0 && d.breakEven > 0 && d.breakEven < 1, `${where}: hero faces something to call`)
    assert.ok(spot.line.some(sentence => sentence.includes(`${spot.bet} chips`)), `${where}: the bet is in the story`)
    assert.ok(spot.bet <= spot.effectiveStack && spot.heroIn < spot.bet, `${where}: the bet fits behind the stack`)
    if (spot.allIn) assert.equal(spot.bet, spot.effectiveStack, `${where}: all in means the whole stack`)
    assert.equal(spot.betTone === 'all-in', spot.allIn, `${where}: tone says all-in exactly when the bettor is`)

    // Bet sizes land in the template's own set.
    const sizes = (shares) => shares.map(share => sizeFor(spot.potBefore, share))
    if (SIZE_SHARES[template.id]) {
      assert.ok(sizes(SIZE_SHARES[template.id]).includes(spot.bet) || (spot.allIn && spot.bet === spot.effectiveStack),
        `${where}: bet ${spot.bet} is not a listed size of pot ${spot.potBefore}`)
    }
    if (template.id === 'three-bet-pot') {
      // A villain left with under one and a half pots behind is committed and shoves; otherwise they bet a third or two thirds.
      assert.equal(spot.allIn, spot.effectiveStack < 1.5 * spot.potBefore, `${where}: shove exactly when the stack is under 1.5 pots`)
    }
    if (template.id === 'facing-shove') {
      assert.ok(spot.allIn && spot.bet === spot.effectiveStack, `${where}: a shove is all of the stack`)
      assert.ok(SHOVE_SHARES.some(share => Math.max(10, half5(spot.potBefore * share)) === spot.bet),
        `${where}: shove ${spot.bet} into ${spot.potBefore} is not 0.5, 0.8, 1, 1.5 or 2.5 pots`)
    }
    if (template.id === 'bet-raised') {
      assert.equal(spot.heroIn, sizeFor(spot.potBefore, 50), `${where}: hero bets half the pot`)
      assert.ok(spot.bet === 3 * spot.heroIn || spot.bet === half5(2.5 * spot.heroIn) || spot.bet === spot.effectiveStack,
        `${where}: the raise is 3x or 2.5x hero's bet`)
      assert.ok(spot.line.some(sentence => sentence.includes(`${spot.heroIn} chips you already bet`)),
        `${where}: the story says hero's bet is already in the pot`)
    }
    if (template.id === 'multiway') {
      assert.equal(spot.opponents.length, 2, where)
      assert.equal(spot.callersIn, spot.bet, `${where}: the caller put in the bet`)
      assert.deepEqual(spot.opponents.map(o => o.role), ['bettor', 'caller'])
      assert.notEqual(spot.street, 'flop', `${where}: a flop is unaffordable three-way`)
      assert.equal(spot.heroPosition, 'BB')
    } else {
      assert.equal(spot.opponents.length, 1, where)
      assert.equal(spot.callersIn, 0, where)
    }
    if (template.id === 'srp-oop') assert.equal(spot.heroPosition, 'BB')
    if (template.id !== 'bet-raised') assert.equal(spot.heroIn, 0, where)
    if (template.id === 'river-polar') assert.equal(spot.street, 'river')

    // A flop spot is a first-street spot: its pot is the preflop pot, exactly.
    if (spot.street === 'flop' && PREFLOP_POT[template.id]) {
      assert.ok(PREFLOP_POT[template.id].includes(spot.potBefore), `${where}: flop pot ${spot.potBefore}`)
    }

    // Opponents: real hands, none dead, the continuing range inside the preflop one.
    const dead = new Set(cards.map(cardId))
    for (const opp of spot.opponents) {
      assert.ok(opp.combos.length >= 1 && opp.preflopCombos.length >= opp.combos.length, where)
      const all = new Set(opp.preflopCombos.map(comboId))
      for (const combo of opp.combos) {
        assert.ok(all.has(comboId(combo)), `${where}: a continuing hand is not in the preflop range`)
        assert.ok(!combo.some(card => dead.has(cardId(card))), `${where}: a continuing hand uses a dead card`)
      }
      assert.ok(opp.rangeNote.length > 20 && opp.rangeLabel && opp.rangeId, where)
    }

    // The budget holds, and the story never names a street the board does not show.
    assert.ok(spotWork(spot) <= PT_MAX_RANGE_WORK, `${where}: work ${spotWork(spot)} is over the budget`)
    const story = spot.line.join(' ')
    if (spot.street === 'flop') assert.ok(!/\b(turn|river)\b/i.test(story), `${where}: a flop spot names a later street`)
    if (spot.street === 'turn') assert.ok(!/\briver\b/i.test(story), `${where}: a turn spot names the river`)
    assert.ok(spot.line.length >= 4 && spot.line.every(sentence => sentence.length > 0), where)
  }
}
// Every template reaches more than one street across 200 seeds, except the river-only one.
for (const template of SCENARIO_TEMPLATES) {
  const reached = ['flop', 'turn', 'river'].filter(street => streetsSeen.has(`${template.id}:${street}`))
  if (template.id === 'river-polar') assert.deepEqual(reached, ['river'])
  // Three-way, pairs x boards-to-come is over the budget on any street but the river
  // for all but a few narrow ranges, so the work rule puts nearly every multiway spot there.
  else if (template.id === 'multiway') assert.ok(reached.includes('river') && !reached.includes('flop'), 'multiway is turn or river')
  else assert.ok(reached.length >= 2, `${template.id} only ever dealt ${reached.join(',')}`)
}

// A seed is the whole spot: the same seed and template deal it again, bit for bit.
for (const template of SCENARIO_TEMPLATES) {
  assert.deepEqual(dealSpot(42, template.id), dealSpot(42, template.id), `${template.id} is reproducible`)
}
assert.deepEqual(dealSpot(7).spot, dealSpot(7, dealSpot(7).spot.templateId).spot, 'a seed names its own template')
assert.notDeepEqual(dealSpot(1, 'srp-ip').spot.hero, dealSpot(2, 'srp-ip').spot.hero)
const rngA = seededRng(5)
const rngB = seededRng(5)
assert.deepEqual([rngA(), rngA(), rngA()], [rngB(), rngB(), rngB()], 'seededRng replays')
assert.ok([rngA(), rngA(), rngA()].every(x => x >= 0 && x < 1))
assert.throws(() => dealSpot(1, 'nope'), /does not exist/)

// The story of a known deal, by hand: BTN calls a CO open, 25 + 25 + 5 + 10 = 65.
const hand65 = dealSpot(1, 'srp-ip')
assert.ok(hand65.spot.ledger.slice(0, 3).map(e => e.chips).join() === '15,25,25', 'blinds, open, call')
// Derive on a hand-made raise: hero bet 30 into 90, villain raised to 90.
assert.deepEqual(
  derive({ potBefore: 90, heroIn: 30, bet: 90, callersIn: 0 }),
  { potNow: 210, toCall: 60, potAfterCall: 270, breakEven: 60 / 270, potOdds: 210 / 60 },
  'a raise: the chips hero already bet are in the pot and are not paid again',
)
assert.equal(derive({ potBefore: 80, heroIn: 0, bet: 40, callersIn: 40 }).potNow, 160, 'a caller adds to the pot hero sees')

/* ───────────────────────  continuing ranges  ─────────────────────── */

assert.equal(toneForSize(40, 100), 'small')
assert.equal(toneForSize(41, 100), 'medium')
assert.equal(toneForSize(85, 100), 'medium')
assert.equal(toneForSize(86, 100), 'large')
assert.equal(toneForSize(130, 100), 'large')
assert.equal(toneForSize(131, 100), 'overbet')

const turnBoard = hand('Kh 9d 4c 2s')
const btnRange = (dead) => rangeCombos(parseRange(PRESET_RANGES.find(p => p.id === 'btn').text).classes, dead)
const turnRange = btnRange([...hand('Ac Jc'), ...turnBoard])

// A small bet is the whole range: nothing is removed.
const small = continuingRange(turnRange, turnBoard, 'small')
assert.equal(small.combos.length, turnRange.length, 'a small bet keeps every combo')
assert.equal(small.fallback, false)
assert.match(small.note, /small bet is often the whole range/)

// A medium bet keeps a pair and drops ace-high air.
const pairHand = hand('Kd 7c')
const airHand = hand('As 6h')
const mixed = [pairHand, airHand, ...rangeCombos(['QQ', 'JJ', 'TT', '88', '77', '66'], [...hand('Ac Jc'), ...turnBoard])]
const medium = continuingRange(mixed, turnBoard, 'medium')
const keptIds = new Set(medium.combos.map(comboId))
assert.ok(keptIds.has(comboId(pairHand)), 'a medium bet keeps top pair')
assert.ok(!keptIds.has(comboId(airHand)), 'a medium bet drops ace-high with no draw')
assert.ok(medium.combos.every(combo => strength(combo, turnBoard) >> 20 >= 1), 'every medium combo has a pair or better')
// A flush draw and an open-ender are kept by a medium bet even with no pair.
const drawBoard = hand('Kh 9h 4c')
const drawing = continuingRange([hand('Ah 5h'), hand('Jc Td'), hand('Qs 2d'), ...rangeCombos(['AA', 'KK', 'QQ', 'JJ', 'TT', '88', '77', '66'], [...hand('Ah 5h'), ...hand('Jc Td'), ...hand('Qs 2d'), ...drawBoard])], drawBoard, 'medium')
assert.ok(drawing.combos.some(c => comboId(c) === comboId(hand('Ah 5h'))), 'a flush draw continues')
assert.ok(!drawing.combos.some(c => comboId(c) === comboId(hand('Qs 2d'))), 'queen-high with a deuce does not')

// A large bet is top pair or better: a middle pair goes, top pair and an overpair stay.
const largeRange = continuingRange([hand('Kd 7c'), hand('9c 8c'), hand('Ac Ad'), hand('Qc Qd'), ...rangeCombos(['AKo', 'KQo', 'KJo', 'KTo', 'AA'], [...hand('Kd 7c'), ...hand('9c 8c'), ...hand('Qc Qd'), ...turnBoard])], turnBoard, 'large')
const largeIds = new Set(largeRange.combos.map(comboId))
assert.ok(largeIds.has(comboId(hand('Kd 7c'))) && largeIds.has(comboId(hand('Ac Ad'))), 'top pair and an overpair stay')
assert.ok(!largeIds.has(comboId(hand('9c 8c'))) && !largeIds.has(comboId(hand('Qc Qd'))), 'second pair and an underpair go')

// An overbet on the river keeps two pair and a bluff tail of exactly RIVER_BLUFFS.
const riverBoard = hand('Kh 9d 4c 2s 7h')
const riverRange = btnRange([...hand('Ac Jc'), ...riverBoard])
const polar = continuingRange(riverRange, riverBoard, 'overbet')
const catOf = (combo) => strength(combo, riverBoard) >> 20
const strongKept = polar.combos.filter(combo => catOf(combo) >= HAND_CATEGORY.TWO_PAIR)
const tail = polar.combos.filter(combo => catOf(combo) < HAND_CATEGORY.TWO_PAIR)
assert.equal(RIVER_BLUFFS, 12)
assert.equal(tail.length, 12, 'the bluff tail is exactly 12 hands')
assert.ok(strongKept.length > 0 && strongKept.some(c => comboId(c) === comboId(hand('Kc 9c'))), 'two pair is kept')
assert.ok(tail.every(combo => catOf(combo) === HAND_CATEGORY.HIGH_CARD), 'every bluff missed entirely')
assert.ok(!polar.combos.some(c => comboId(c) === comboId(hand('Ah Ad'))), 'an overpair is neither value nor bluff here')
// They are the WEAKEST missed hands: nothing left out is weaker than anything kept.
const keptIdsPolar = new Set(polar.combos.map(comboId))
const missedLeftOut = riverRange.filter(c => catOf(c) === HAND_CATEGORY.HIGH_CARD && !keptIdsPolar.has(comboId(c)))
const weakestKept = Math.max(...tail.map(c => strength(c, riverBoard)))
assert.ok(missedLeftOut.every(c => strength(c, riverBoard) >= weakestKept), 'the tail is the 12 weakest missed hands')
// An all-in and a raise are read the same way as an overbet.
assert.deepEqual(continuingRange(riverRange, riverBoard, 'all-in').combos.map(comboId), polar.combos.map(comboId))
assert.deepEqual(continuingRange(riverRange, riverBoard, 'medium', 'raise').combos.map(comboId), polar.combos.map(comboId))
// A smaller range gives a smaller tail: here only 5 hands missed, so 5 are kept.
const tiny = [hand('Kc 9c'), hand('Kd 9h'), hand('Kc 9s'), ...rangeCombos(['AJo'], [...riverBoard]).slice(0, 5)]
const tinyPolar = continuingRange(tiny, riverBoard, 'overbet')
assert.equal(tinyPolar.combos.length, 8, 'three two-pair hands plus all five that missed')
assert.equal(tinyPolar.fallback, false)
// Same input twice gives the same list in the same order.
assert.deepEqual(continuingRange(riverRange, riverBoard, 'overbet').combos, polar.combos, 'deterministic')

// The fallback keeps the strongest 8 when a filter leaves too few.
const airBoard = hand('Kh 9d 4c 2s')
const airOnly = rangeCombos(['A5o', 'A6o', 'A7o', 'Q7o', 'Q6o', 'J7o'], airBoard).filter(c => draws(c, airBoard).flush === false)
const fell = continuingRange(airOnly, airBoard, 'large')
assert.equal(MIN_CONTINUING, 8)
assert.equal(fell.combos.length, 8, 'the fallback keeps 8')
assert.equal(fell.fallback, true)
assert.match(fell.note, /strongest/)
const fellIds = new Set(fell.combos.map(comboId))
const weakestFell = Math.min(...fell.combos.map(c => strength(c, airBoard)))
assert.ok(airOnly.filter(c => !fellIds.has(comboId(c))).every(c => strength(c, airBoard) <= weakestFell), 'the 8 kept are the strongest')
assert.equal(continuingRange(airOnly.slice(0, 3), airBoard, 'large').combos.length, 3, 'a range smaller than 8 is returned whole')

// Draws: counted from facts about cards, and false on the river.
assert.equal(draws(hand('Ah 5h'), hand('Kh 9h 2c')).flush, true, 'four hearts with one in hand')
assert.equal(draws(hand('Ah 5h'), hand('Kh 9h 2h')).flush, false, 'five hearts is a flush already, not a draw')
assert.equal(draws(hand('Ac 5c'), hand('Kh 9h 2h 3h')).flush, false, 'four on the board with none in hand is not mine')
assert.equal(draws(hand('Jc Tc'), hand('9d 8h 2s')).openEnded, true, 'J-T on 9-8: a seven or a queen')
assert.equal(draws(hand('Jc Tc'), hand('9d 7h 2s')).gutshot, true, 'J-T on 9-7: only an eight')
assert.equal(draws(hand('4c 5d'), hand('2h 3s Kc')).openEnded, true, '2-3-4-5 is open at the ace (low) and the six')
assert.equal(draws(hand('Ac 2d'), hand('3h 4s Kc')).gutshot, true, 'A-2-3-4 needs exactly a five')
assert.equal(draws(hand('Ac 2d'), hand('3h 4s Kc')).openEnded, false)
assert.equal(draws(hand('Ac Kd'), hand('Qh Jc 2s')).openEnded, false, 'ace-high broadway has one end only')
assert.equal(draws(hand('As Ad'), hand('5h 6c 7d 8s')).openEnded, false, 'a draw the board already shows belongs to everyone')
assert.equal(draws(hand('9c 4d'), hand('5h 6c 7d 8s')).openEnded, false, 'a straight already made is not a draw')
assert.deepEqual(draws(hand('Ah Kh'), hand('2h 7h 9c 3d 4c')), { flush: false, openEnded: false, gutshot: false, overcards: 2 },
  'no draws on the river, but overcards are still counted')
assert.equal(draws(hand('Ah Kh'), hand('Qd 7h 9c')).overcards, 2)
assert.equal(draws(hand('Ah 2h'), hand('Qd 7h 9c')).overcards, 1)
assert.ok(strength(hand('Ac Ad'), airBoard) > strength(hand('Qc Qd'), airBoard), 'aces beat queens')
assert.ok(strength(hand('Kc Kd'), airBoard) > strength(hand('Ac Ad'), airBoard), 'a set of kings beats a pair of aces')

/* ───────────────────────  three players, exactly  ─────────────────────── */

const mwBoard = hand('2h 7d 9c Ts 3s')
const heroH = hand('As Ah')
const oppA = hand('Kd Kc')
const oppB = hand('Qd Qc')
const eqH = equityVsRanges(heroH, [[oppA], [oppB]], mwBoard)
const eqA = equityVsRanges(oppA, [[heroH], [oppB]], mwBoard)
const eqB = equityVsRanges(oppB, [[heroH], [oppA]], mwBoard)
assert.ok(Math.abs(eqH.equity + eqA.equity + eqB.equity - 1) < 1e-12, 'three-way equities sum to 1')
assert.equal(eqH.equity, 1, 'aces beat kings and queens on a blank river')
assert.equal(eqH.pairs, 1)
assert.equal(eqH.runouts, 1, 'a river has one board to come')
assert.equal(eqH.aheadOf, 1)
assert.equal(eqA.aheadOf, 0)
// A locked hand on a flop: a 6-high straight flush that nothing can pass.
const locked3 = equityVsRanges(hand('6s 5s'), [[hand('Ad Ac')], [hand('Kd Kc')]], hand('2s 3s 4s'))
assert.equal(locked3.equity, 1, 'an unbeatable hand gets exactly 1.0 three-way')
assert.equal(locked3.runouts, combinations(52 - 6 - 3, 2))
// A mirrored three-way tie is exactly a third each. Everyone plays the royal flush on the board.
const royal = hand('As Ks Qs Js Ts')
const tie = [hand('2h 3d'), hand('2c 3c'), hand('2d 3h')]
for (let i = 0; i < 3; i++) {
  const others = tie.filter((_, j) => j !== i)
  assert.equal(equityVsRanges(tie[i], [[others[0]], [others[1]]], royal).equity, 1 / 3, 'a three-way chop is 1/3')
}
// A two-way tie inside a three-way pot is half: hero ties one opponent and beats the other.
assert.equal(equityVsRanges(hand('Ah Qd'), [[hand('As Qc')], [hand('Td 3s')]], hand('Ad Kc 9s 8h 2c')).equity, 0.5)
// Agreement with the one-pair enumerator, hand by hand.
const turn4 = hand('Kh 9d 4c 2s')
const viaPair = exactEquity([hand('Ac Jc'), hand('Kd Qd'), hand('9h 9s')], turn4)
const viaRanges = equityVsRanges(hand('Ac Jc'), [[hand('Kd Qd')], [hand('9h 9s')]], turn4)
assert.ok(Math.abs(viaPair.equity[0] - viaRanges.equity) < 1e-12, 'a one-combo pair agrees with exactEquity')
// Pairs and work are counted, not guessed.
const premiumA = rangeCombos(parseRange('JJ+, AKs').classes, [...hand('Ac Jc'), ...turn4])
const premiumB = rangeCombos(parseRange('TT+, AKo, 98s').classes, [...hand('Ac Jc'), ...turn4])
const range3 = equityVsRanges(hand('Ac Jc'), [premiumA, premiumB], turn4)
let expectedPairs = 0
for (const x of premiumA) for (const y of premiumB) if (!x.some(cx => y.some(cy => cardId(cx) === cardId(cy)))) expectedPairs++
assert.equal(range3.pairs, expectedPairs, 'pairs are the disjoint (a, b) pairs')
assert.equal(range3.runouts, combinations(52 - 6 - 4, 1), 'boards to come for each pair')
assert.equal(multiwayWork(premiumA, premiumB, turn4), range3.pairs * range3.runouts, 'work is pairs x runouts')
assert.ok(range3.pairs < premiumA.length * premiumB.length, 'shared cards remove some pairs')
assert.ok(range3.equity > 0 && range3.equity < 1 && range3.aheadOf >= 0 && range3.aheadOf <= 1)
assert.doesNotThrow(() => equityVsRanges(hand('Ac Jc'), [premiumA, premiumB], turn4, multiwayWork(premiumA, premiumB, turn4)))
assert.throws(() => equityVsRanges(hand('Ac Jc'), [premiumA, premiumB], turn4, multiwayWork(premiumA, premiumB, turn4) - 1),
  /cannot be counted exactly/, 'above maxWork it refuses instead of sampling')
assert.throws(() => equityVsRanges(hand('Ac Jc'), [[hand('Ac Kd')], [hand('Qd Qc')]], turn4), /blocked/)
assert.throws(() => equityVsRanges(hand('Ac Jc'), [[hand('Kd Qd')], [hand('Kd Qc')]], turn4), /blocked/, 'two players cannot share a card')
// The memo agrees with the uncached answer and hands back the same object.
clearEquityCache()
const cached = cachedEquityVsRanges(hand('Ac Jc'), [premiumA, premiumB], turn4)
assert.deepEqual(cached, range3, 'cached equals uncached')
assert.equal(cachedEquityVsRanges(hand('Ac Jc'), [premiumA, premiumB], turn4), cached, 'a hit returns the same object')
assert.ok(Object.isFrozen(cached))
// The key is built from BOTH ranges: a different second opponent must not read the first one's answer.
const narrowerB = premiumB.slice(0, 5)
const other = cachedEquityVsRanges(hand('Ac Jc'), [premiumA, narrowerB], turn4)
assert.deepEqual(other, equityVsRanges(hand('Ac Jc'), [premiumA, narrowerB], turn4), 'a different second range is a different spot')
assert.notEqual(other.pairs, cached.pairs)

/* ───────────────────────  the decision  ─────────────────────── */

const R_ONE = (hero, board, rangeId, tone, extra = {}) => {
  const heroCards = hand(hero)
  const boardCards = hand(board)
  const text = PRESET_RANGES.find(p => p.id === rangeId).text
  const pre = rangeCombos(parseRange(text).classes, [...heroCards, ...boardCards])
  const narrowed = continuingRange(pre, boardCards, tone).combos
  return {
    templateId: 'srp-ip', title: 'test', blinds: { sb: 5, bb: 10 }, effectiveStack: 900,
    heroPosition: 'BTN', hero: heroCards, board: boardCards,
    street: ['flop', 'turn', 'river'][boardCards.length - 3],
    opponents: [{ position: 'CO', rangeId, rangeLabel: rangeId, preflopCombos: pre, combos: narrowed, rangeNote: '', role: 'bettor' }],
    potBefore: 100, heroIn: 0, bet: 50, callersIn: 0, betTone: tone, allIn: false, line: [], ledger: [], ...extra,
  }
}
const decide = (spot) => {
  const result = equityVsRange(spot.hero, spot.opponents[0].combos, spot.board)
  const raiseCombos = raiseContinuingCombos(spot)
  const raiseResult = raiseCombos.length ? equityVsRange(spot.hero, raiseCombos, spot.board) : null
  return judge(spot, result, raiseResult)
}

// The nuts on the river: raise, and the raise line is printed with its numbers.
const nuts = R_ONE('Ac Kc', 'Qc Jc Tc 2d 3h', 'co', 'medium')
const nutsJudgement = decide(nuts)
assert.equal(nutsJudgement.correct, 'raise', 'the nuts raise')
assert.equal(nutsJudgement.equity, 1)
const nutsRaise = nutsJudgement.raise
assert.equal(nutsRaise.to, 150, '3x a 50 chip bet')
assert.equal(raiseTo(nuts), 150)
const nutsPot = 150
assert.equal(nutsRaise.theyFold + nutsRaise.theyCall, 1)
assert.equal(
  nutsRaise.ev,
  nutsRaise.theyFold * nutsPot + nutsRaise.theyCall * (nutsRaise.equityVsCallers * (nutsPot + 150 + 100) - 150),
  'the raise EV is the fold share of the pot plus the call share of the showdown',
)
assert.ok(nutsRaise.ev > nutsJudgement.callEv + RAISE_MARGIN * nutsPot, 'the raise clears the 5% margin')
const nutsText = nutsJudgement.reasons.join(' ')
for (const piece of [
  fmtChips(nutsRaise.ev), fmtChips(nutsJudgement.callEv), fmtPercent(nutsRaise.theyFold),
  fmtChips(nutsRaise.to), String(nutsRaise.callingCombos), fmtPercent(nutsRaise.equityVsCallers),
  fmtChips(nutsJudgement.derived.toCall), fmtChips(nutsJudgement.derived.potAfterCall),
  fmtPercent(nutsJudgement.derived.breakEven), fmtPercent(nutsJudgement.equity), fmtChips(RAISE_MARGIN * nutsPot), '5%',
]) assert.ok(nutsText.includes(piece), `the reasons never print "${piece}": ${nutsText}`)
assert.match(nutsText, /Raising wins .* chips on average against .* for calling/)
assert.match(nutsText, /ignores what happens on later streets/)

// A hopeless hand facing a shove folds, and the fold is explained with the numbers.
const hopeless = R_ONE('7c 2d', 'Ks Qh 9d 5c', 'btn', 'large', { bet: 200, effectiveStack: 200, allIn: true, potBefore: 150, betTone: 'all-in' })
const hopelessJudgement = decide(hopeless)
assert.equal(hopelessJudgement.correct, 'fold')
assert.ok(hopelessJudgement.callEv <= 0)
assert.equal(hopelessJudgement.raise, undefined, 'no raise is modelled against a shove')
const foldText = hopelessJudgement.reasons.join(' ')
for (const piece of [fmtChips(200), fmtChips(550), fmtPercent(200 / 550), fmtPercent(hopelessJudgement.equity)]) {
  assert.ok(foldText.includes(piece), `the fold never prints "${piece}": ${foldText}`)
}
assert.ok(foldText.includes(fmtChips(-hopelessJudgement.callEv)), 'the loss is printed')

// Flush draw facing a 33% bet: calling is clearly profitable, so it is never a fold.
// (Raising wins more chips than calling here, because most of a wide range folds to it,
// so the verdict is raise, not call.)
const draw = R_ONE('Ah 5h', 'Kh 9h 2c', 'co', 'small', { bet: 33 })
const drawJudgement = decide(draw)
assert.ok(drawJudgement.callEv > 0 && drawJudgement.correct !== 'fold', 'a nut flush draw getting 3 to 1 never folds')
assert.ok(Math.abs(drawJudgement.derived.breakEven - 33 / 166) < 1e-12)
// The same draw when the bet is already all in cannot be raised: it calls.
const drawShove = R_ONE('Ah 5h', 'Kh 9h 2c', 'co', 'small', { bet: 33, effectiveStack: 33, allIn: true, betTone: 'all-in' })
assert.equal(decide(drawShove).correct, 'call', 'a draw facing an all-in calls')
// A made hand that a raise would only fold out calls: queens under a king on the turn.
const calls = R_ONE('Qc Qd', 'Kh 9h 2d 5s', 'co', 'medium', { bet: 66 })
const callsJudgement = decide(calls)
assert.equal(callsJudgement.correct, 'call')
assert.ok(callsJudgement.raise.ev <= callsJudgement.callEv + RAISE_MARGIN * 166, 'a raise does not beat calling by the margin')
assert.match(callsJudgement.reasons.join(' '), /So the best play is to call/)
// The margin matters: with no margin that same raise would have been chosen only if it won more.
assert.equal(callsJudgement.raise.ev > callsJudgement.callEv, false)
// Raise size: 3x, then 2.5x when 3x would not fit, then the whole stack.
assert.equal(raiseTo({ ...draw, bet: 100, effectiveStack: 350 }), 300)
assert.equal(raiseTo({ ...draw, bet: 100, effectiveStack: 280 }), 250, '2.5x when 3x does not fit')
assert.equal(raiseTo({ ...draw, bet: 100, effectiveStack: 220 }), 220, 'capped at all-in')
assert.equal(raiseTo({ ...draw, bet: 100, effectiveStack: 100 }), null, 'nothing left to raise with')
assert.equal(raiseTo({ ...draw, allIn: true }), null)
// Multiway: no raise is modelled, so the verdict is call or fold with a sentence saying why.
const multiVerdicts = new Set()
for (let seed = 1; seed <= 40; seed++) {
  const multi = dealSpot(seed, 'multiway').spot
  const multiResult = cachedEquityVsRanges(multi.hero, [multi.opponents[0].combos, multi.opponents[1].combos], multi.board, PT_MAX_RANGE_WORK)
  const multiJudgement = judge(multi, multiResult)
  multiVerdicts.add(multiJudgement.correct)
  assert.equal(multiJudgement.raise, undefined, 'no raise is modelled three-way')
  assert.ok(['call', 'fold'].includes(multiJudgement.correct))
  assert.equal(multiJudgement.derived.potNow, multi.potBefore + 2 * multi.bet, 'a caller adds to the pot hero faces')
  assert.equal(multiJudgement.correct === 'fold', multiJudgement.callEv <= 0)
  if (multiJudgement.correct === 'call') assert.match(multiJudgement.reasons.join(' '), /two opponents/)
}
assert.ok(multiVerdicts.has('call') && multiVerdicts.has('fold'), 'three-way spots are both calls and folds')
// A bet that was raised: the chips already bet count in the pot and not in the cost.
const raised = dealSpot(11, 'bet-raised').spot
const raisedJudgement = judge(raised, { equity: 0.4, aheadOf: 0.5 }, { equity: 0.4, combos: 5 })
assert.equal(raisedJudgement.derived.toCall, raised.bet - raised.heroIn)
assert.equal(raisedJudgement.callEv, 0.4 * raisedJudgement.derived.potAfterCall - raisedJudgement.derived.toCall)
// A raise that is modelled but not supplied is an error, not a silent call.
assert.throws(() => judge(nuts, { equity: 1, aheadOf: 1 }), /equity against the hands that call it/)
assert.doesNotThrow(() => judge(hopeless, { equity: 0, aheadOf: 0 }))

/* ───────────────────────  permalinks  ─────────────────────── */

for (const template of SCENARIO_TEMPLATES) {
  for (const seed of [1, 99, 4_294_967_295, 123_456_789]) {
    const { spot } = dealSpot(seed, template.id)
    const text = encodeSpot(spot, seed)
    assert.match(text, /^[a-z-]+\.[0-9a-z]{1,7}$/)
    const back = decodeSpot(text)
    assert.ok(back, `${text} decodes`)
    assert.equal(back.seed, seed)
    assert.deepEqual(back.spot.hero, spot.hero, `${text}: hero`)
    assert.deepEqual(back.spot.board, spot.board, `${text}: board`)
    assert.equal(back.spot.potBefore, spot.potBefore, `${text}: pot`)
    assert.equal(back.spot.bet, spot.bet, `${text}: bet`)
    assert.deepEqual(back.spot.opponents.map(o => o.combos.length), spot.opponents.map(o => o.combos.length), `${text}: ranges`)
    assert.deepEqual(back.spot, spot, `${text}: the whole spot`)
  }
}
assert.equal(encodeSpot(dealSpot(36, 'srp-ip').spot, 36), 'srp-ip.10', 'the seed is written in base 36')
assert.deepEqual(decodeSpot('srp-ip.10').spot, dealSpot(36, 'srp-ip').spot)
for (const bad of ['', 'srp-ip', 'srp-ip.', '.5', 'nope.5', '__proto__.1', 'srp-ip.-1', 'srp-ip.1z141z4', 'srp-ip.zzzzzzzz',
  'srp-ip.1.2', 'SRP-IP.5', `srp-ip.${'a'.repeat(200)}`, 'srp-ip.<b>', 'custom.5', 'AsKd', 'AsKd:2c7d', 'AsKs:Ks7d9h', 'AsKd:2c7d9h2h3h4h',
  'AsKdQs:2c7d9h', 'AsKd:2c7d9h:100:50:co:extra', 'AsKd:AsQd9h']) {
  assert.equal(decodeSpot(bad), null, `"${bad.slice(0, 40)}" must be rejected`)
}
assert.ok(decodeSpot('srp-ip.1z141z3'), 'the largest 32-bit seed is accepted')
assert.throws(() => encodeSpot({ templateId: 'custom' }, 1), /Only dealt spots/)

// The old ?spot= form still opens: hero, board, pot, bet, range.
const old = decodeSpot('AsKd:2c7d9h:120:60:co')
assert.ok(old && old.seed === null)
assert.equal(old.spot.templateId, 'custom')
assert.deepEqual(old.spot.hero, hand('As Kd'))
assert.deepEqual(old.spot.board, hand('2c 7d 9h'))
assert.equal(old.spot.street, 'flop')
assert.equal(old.spot.potBefore, 120)
assert.equal(old.spot.bet, 60)
assert.equal(old.spot.opponents.length, 1)
assert.equal(old.spot.opponents[0].rangeId, 'co')
const coText = PRESET_RANGES.find(p => p.id === 'co').text
assert.equal(old.spot.opponents[0].combos.length, rangeCombos(parseRange(coText).classes, [...hand('As Kd'), ...hand('2c 7d 9h')]).length,
  'the whole preset range, with the dead cards removed and no narrowing')
assert.equal(old.spot.opponents[0].combos, old.spot.opponents[0].preflopCombos)
assert.equal(derive(old.spot).potNow, 180)
assert.deepEqual(decodeSpot('AsKd-2c7d9h-120-60-co').spot.potBefore, 120, 'the dash form')
assert.equal(decodeSpot('AsKd:2c7d9h:5000:9999').spot.potBefore, 1000, 'the pot is clamped to 1000')
assert.equal(decodeSpot('AsKd:2c7d9h:5000:9999').spot.bet, 1000)
assert.equal(decodeSpot('AsKd:2c7d9h').spot.potBefore, 100, 'defaults when omitted')
assert.equal(decodeSpot('AsKd:2c7d9h').spot.bet, 50)
assert.equal(decodeSpot('AsKd:2c7d9h:100:50:nonsense').spot.opponents[0].rangeId, PRESET_RANGES[0].id)
assert.ok(derive(decodeSpot('AsKd:2c7d9h:100:50:co').spot).toCall === 50)

console.log('poker scenario check ok')
