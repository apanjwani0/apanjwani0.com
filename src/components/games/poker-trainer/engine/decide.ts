/**
 * The decision: fold, call or raise, with every number shown.
 *
 * The first trainer called a spot a raise whenever equity reached 0.68. Nothing
 * on screen explained 0.68, so a player who raised on 0.67 was marked wrong by a
 * rule they could not see. This module replaces it with rules that can be said
 * out loud, and `reasons` is that saying: one sentence per rule that applied,
 * with the numbers substituted, in the order the rules ran.
 *
 * ==The model is deliberately small.== Calling is judged as if the hand ended at
 * showdown with no more betting, and a raise is judged against one fixed guess at
 * which hands would continue. Both are stated in the sentences, because a number
 * that implies more precision than it has is a lie of the same kind as a hidden
 * threshold. What the model is good for is comparing the three plays on the same
 * footing, not predicting a particular opponent.
 *
 * `judge` is pure. Enumerating equity is the caller's job (the page memoises it),
 * so the two equity results come in as arguments.
 */

import { CALLER_VS_RAISE_NOTE, callerVsRaise, continuingRange, fallbackSentence, RIVER_BLUFFS } from './continuing'
import type { RiverRaiseCounts } from './equity'
import { derive, round5, type Derived, type Spot } from './scenarios'
import type { Card } from './types'

/** A raise must beat calling by this share of the pot to be worth the extra risk. */
export const RAISE_MARGIN = 0.05

/** The equity figures `judge` reads; `RangeEquityResult` and `MultiwayEquityResult` both have them. */
export interface EquityFigures {
  equity: number
  aheadOf: number
}

export interface Judgement {
  derived: Derived
  /** Hero's exact equity against the continuing range(s). */
  equity: number
  /** equity * potAfterCall - toCall, in chips; assumes no more betting. */
  callEv: number
  aheadOf: number
  correct: 'fold' | 'call' | 'raise'
  /** Present only when a raise was modelled against one opponent (not all-in, stack allows). */
  raise?: {
    /** 3x the bet (2.5x if that exceeds the effective stack; capped at all-in). */
    to: number
    /** Share of their continuing hands that fold to the raise. */
    theyFold: number
    /** 1 - theyFold */
    theyCall: number
    callingCombos: number
    /** Hero's exact equity against the hands that continue. */
    equityVsCallers: number
    /** The equity hero needs when called: chips added / pot after both add. */
    breakEven: number
    ev: number
  }
  /** Present only when a raise was modelled against two opponents (river only). */
  raiseMultiway?: MultiwayRaise
  /** One sentence per rule applied, in order, with the numbers substituted. */
  reasons: string[]
}

/** One way two opponents can answer a raise, with the numbers its part of Raise EV is made of. */
export interface MultiwayOutcome {
  id: 'both-fold' | 'bettor-calls' | 'caller-calls' | 'both-call'
  /** Pairs of their hands that answer this way. */
  pairs: number
  /** pairs / all pairs */
  share: number
  /** Hero's share of the showdown over these pairs (1 when both fold: hero takes the pot). */
  equity: number
  /** The pot hero plays for: the pot now plus every chip added by those who stay in. */
  pot: number
  /** Chips hero adds in this outcome (none when both fold, since the raise is not called). */
  added: number
  /** equity * pot - added */
  net: number
}

export interface MultiwayRaise {
  /** The raise-to total. */
  to: number
  /** Chips the raise adds for hero, and for each opponent who calls it. */
  added: number
  theirAdded: number
  bettorHands: number
  bettorKeeps: number
  callerHands: number
  callerKeeps: number
  /** All legal pairs of their hands. */
  pairs: number
  outcomes: MultiwayOutcome[]
  /** Share of pairs where at least one of them calls. */
  calledShare: number
  /** Average chips the raise wins or loses over only the pairs where at least one calls. */
  whenCalled: number
  /** Sum of share * net over the four outcomes. */
  ev: number
}

/** A share as the page prints it: one decimal and a percent sign. */
export function fmtPercent(share: number): string {
  return `${(share * 100).toFixed(1)}%`
}

/** A chip amount as the page prints it: at most one decimal, no trailing zero. */
export function fmtChips(amount: number): string {
  return String(Number(amount.toFixed(1)))
}

/**
 * Can a raise be modelled for this spot?
 *
 * Assumes a dealt `Spot`. A raise is modelled only when the bet is not already
 * all in and hero has chips behind the bet to raise with. Against one opponent
 * it is modelled on every street; against two only on the river, where no
 * cards are left to come and how both of them answer can be counted exactly.
 * On the turn the betting still to come on the river would decide what a raise
 * is worth, and this model does not play it out.
 */
export function raiseModelled(spot: Spot): boolean {
  if (spot.allIn || spot.effectiveStack <= spot.bet) return false
  return spot.opponents.length === 1 || spot.street === 'river'
}

/**
 * The size hero's raise would be, as a "raise to" total.
 *
 * Assumes `raiseModelled(spot)`. Three times the bet, or two and a half times
 * if three times would be more than hero has, and never more than hero's whole
 * stack (which makes it a shove). Returns null when no raise is modelled.
 */
export function raiseTo(spot: Spot): number | null {
  if (!raiseModelled(spot)) return null
  const triple = 3 * spot.bet
  const to = triple <= spot.effectiveStack ? triple : round5(2.5 * spot.bet)
  return Math.min(to, spot.effectiveStack)
}

/** What one opponent keeps against hero's raise, and the sentence the page prints for it. */
export interface RaiseContinuing {
  combos: Card[][]
  note: string
}

/**
 * The hands each opponent would continue with against hero's raise, in the
 * order of `spot.opponents`.
 *
 * Assumes `raiseModelled(spot)`. The bettor keeps hands out of the ones they
 * already bet with: after a small bet (often their whole range) what a medium
 * bet keeps, a pair or better or a strong draw; after a medium or bigger bet
 * what a big bet keeps, top pair or better or a draw that can become the best
 * hand; and against a raise that puts them all in what an overbet keeps. The
 * caller (two opponents, river) keeps `callerVsRaise`. Everything else folds.
 * Returns an empty list when no raise is modelled.
 */
export function raiseContinuing(spot: Spot): RaiseContinuing[] {
  const to = raiseTo(spot)
  if (to === null) return []
  const shove = to >= spot.effectiveStack
  const tone = shove ? 'overbet' : spot.betTone === 'small' ? 'medium' : 'large'
  return spot.opponents.map(opp => {
    if (opp.role === 'caller') return { combos: callerVsRaise(opp.combos, spot.board), note: CALLER_VS_RAISE_NOTE }
    const kept = continuingRange(opp.combos, spot.board, tone, 'bet')
    return { combos: kept.combos, note: bettorNote(tone, spot.board.length === 5, kept.fallback, kept.combos.length) }
  })
}

/** The bettor's rule against a raise, as one sentence. */
function bettorNote(tone: 'medium' | 'large' | 'overbet', river: boolean, fallback: boolean, count: number): string {
  const base = tone === 'overbet'
    ? (river
      ? `Your raise puts the bettor all in, so they keep what an overbet keeps: two pair or better, plus the ${RIVER_BLUFFS} weakest hands that missed completely. Everything else folds.`
      : 'Your raise puts the bettor all in, so they keep what an overbet keeps: two pair or better, or a flush draw with extra ways to win. Everything else folds.')
    : tone === 'large'
      ? (river
        ? 'The bettor keeps top pair or better against your raise and folds everything else.'
        : 'The bettor keeps top pair or better, or a draw that can become the best hand, against your raise and folds everything else.')
      : (river
        ? 'The bettor keeps a pair or better against your raise and folds everything else.'
        : 'The bettor keeps a pair or better, or a strong draw, against your raise and folds everything else.')
  return fallback ? `${base} ${fallbackSentence(count)}` : base
}

/**
 * Raise EV against two opponents on the river, from the exact counts.
 *
 * Assumes `raiseModelled(spot)` with two opponents (bettor first), and that
 * `counts` came from `riverRaiseCounts` with the bettor's range first and
 * `raiseContinuing(spot)` as the keeps. Each of the four outcomes contributes
 * its share of pairs times what hero nets in it: the pot now when both fold,
 * otherwise hero's showdown share of the pot with every caller's chips in it,
 * minus the chips hero added.
 */
function multiwayRaise(spot: Spot, potNow: number, to: number, counts: RiverRaiseCounts, kept: [number, number]): MultiwayRaise {
  const added = to - spot.heroIn
  const theirAdded = to - spot.bet
  const outcome = (id: MultiwayOutcome['id'], pairs: number, won: number, callers: number): MultiwayOutcome => {
    const pot = potNow + (callers > 0 ? added + callers * theirAdded : 0)
    const equity = pairs > 0 ? won / pairs : 0
    const heroAdds = callers > 0 ? added : 0
    return { id, pairs, share: pairs / counts.pairs, equity, pot, added: heroAdds, net: equity * pot - heroAdds }
  }
  const outcomes = [
    outcome('both-fold', counts.bothFold, counts.bothFold, 0),
    outcome('bettor-calls', counts.firstOnly.pairs, counts.firstOnly.won, 1),
    outcome('caller-calls', counts.secondOnly.pairs, counts.secondOnly.won, 1),
    outcome('both-call', counts.both.pairs, counts.both.won, 2),
  ]
  const called = outcomes.slice(1)
  const calledShare = called.reduce((sum, o) => sum + o.share, 0)
  const calledNet = called.reduce((sum, o) => sum + o.share * o.net, 0)
  return {
    to,
    added,
    theirAdded,
    bettorHands: spot.opponents[0].combos.length,
    bettorKeeps: kept[0],
    callerHands: spot.opponents[1].combos.length,
    callerKeeps: kept[1],
    pairs: counts.pairs,
    outcomes,
    calledShare,
    whenCalled: calledShare > 0 ? calledNet / calledShare : 0,
    ev: outcomes.reduce((sum, o) => sum + o.share * o.net, 0),
  }
}

/** The words for an outcome in the reasons and on the ledger. */
export const OUTCOME_WORDS: Record<MultiwayOutcome['id'], string> = {
  'both-fold': 'both fold',
  'bettor-calls': 'only the bettor calls',
  'caller-calls': 'only the caller calls',
  'both-call': 'both call',
}

/** Hero's exact equity against the hands that call a heads-up raise, and how many hands that is. */
export interface HeadsUpRaiseFigures {
  equity: number
  combos: number
}

/** The exact river counts for a raise against two opponents, and how many hands each keeps. */
export interface MultiwayRaiseFigures {
  counts: RiverRaiseCounts
  /** Hands kept against the raise: bettor, then caller. */
  kept: [number, number]
}

/** The sentence that says why no raise is modelled. */
function noRaiseSentence(spot: Spot): string {
  if (spot.allIn) return 'The bet is already all in, so there is nothing to raise and the choice is between calling and folding.'
  if (spot.effectiveStack <= spot.bet) return 'You do not have enough chips behind to make a raise, so the choice is between calling and folding.'
  return 'With two opponents on the turn, a raise is not modelled, because what it is worth depends on the betting still to come on the river, and this drill does not play that out. The choice is between calling and folding.'
}

/**
 * Decide fold, call or raise, and say why.
 *
 * Assumes `result` is hero's exact equity against the continuing range (one
 * opponent) or ranges (two). For one opponent `raiseResult` is hero's exact
 * equity against `raiseContinuing(spot)[0].combos`, with `combos` the number
 * of those hands; for two opponents on the river it is the exact counts of how
 * the raise is answered (`riverRaiseCounts`). The rules, in order:
 *
 * 1. If calling loses chips on average (callEv is zero or less), fold.
 * 2. If a raise is modelled, raise when its average beats calling by more than
 *    `RAISE_MARGIN` of the pot AND the raise does not lose chips when it is
 *    called. The second half means the drill never recommends a raise as a
 *    pure bluff: the folds are a guess, so a raise has to be one hero is
 *    content to see called. Otherwise call.
 * 3. If no raise is modelled (two opponents on the turn, an all-in bet, or no
 *    chips left to raise with), call.
 *
 * `raiseResult` may be left out only when calling already loses, since the
 * first rule ends the decision. Throws if it is missing, or of the wrong kind,
 * when it is needed.
 */
export function judge(
  spot: Spot,
  result: EquityFigures,
  raiseResult?: HeadsUpRaiseFigures | MultiwayRaiseFigures | null,
): Judgement {
  const derived = derive(spot)
  const { potNow, toCall, potAfterCall, breakEven } = derived
  const callEv = result.equity * potAfterCall - toCall
  const reasons: string[] = []
  const callsLose = callEv <= 0
  const twoOpponents = spot.opponents.length > 1

  reasons.push(
    `Calling ${fmtChips(toCall)} chips to win ${fmtChips(potAfterCall)} chips needs ${fmtPercent(breakEven)} and you have ${fmtPercent(result.equity)}. `
    + (callsLose
      ? `On average, calling loses ${fmtChips(-callEv)} chips if the hand ends at showdown, so folding is better.`
      : `On average, calling wins ${fmtChips(callEv)} chips if the hand ends at showdown with no more betting.`),
  )

  const modelled = raiseModelled(spot)
  const to = raiseTo(spot)
  let raise: Judgement['raise']
  let raiseMultiway: MultiwayRaise | undefined
  if (modelled && to !== null && raiseResult) {
    if (twoOpponents && 'counts' in raiseResult) {
      raiseMultiway = multiwayRaise(spot, potNow, to, raiseResult.counts, raiseResult.kept)
    } else if (!twoOpponents && 'combos' in raiseResult) {
      const opponentHands = spot.opponents[0].combos.length
      const theyCall = Math.min(1, raiseResult.combos / opponentHands)
      const theyFold = 1 - theyCall
      const added = to - spot.heroIn
      const theirAdded = to - spot.bet
      const ev = theyFold * potNow
        + theyCall * (raiseResult.equity * (potNow + added + theirAdded) - added)
      raise = {
        to,
        theyFold,
        theyCall,
        callingCombos: raiseResult.combos,
        equityVsCallers: raiseResult.equity,
        breakEven: added / (potNow + added + theirAdded),
        ev,
      }
    }
  }

  let correct: Judgement['correct']
  if (callsLose) {
    correct = 'fold'
  } else if (modelled && twoOpponents) {
    const r = raiseMultiway
    if (!r) throw new Error('A raise is modelled here, so the counts of how both opponents answer it are needed.')
    const margin = RAISE_MARGIN * potNow
    const [fold, ...called] = r.outcomes
    reasons.push(
      `If you raised to ${fmtChips(r.to)} chips, the bettor would keep ${r.bettorKeeps} of their ${r.bettorHands} hands and the caller ${r.callerKeeps} of their ${r.callerHands}, and every other hand folds.`,
    )
    reasons.push(
      `Over all ${r.pairs.toLocaleString('en-US')} pairs of hands they could hold, both fold ${fmtPercent(fold.share)} of the time, and `
      + called.map(o => `${OUTCOME_WORDS[o.id]} ${fmtPercent(o.share)}${o.pairs > 0 ? `, where you have ${fmtPercent(o.equity)} of a ${fmtChips(o.pot)} chip pot` : ''}`).join('; ')
      + '.',
    )
    reasons.push(
      `Raising wins ${fmtChips(r.ev)} chips on average against ${fmtChips(callEv)} for calling; a raise needs to beat the call by at least ${RAISE_MARGIN * 100}% of the pot (${fmtChips(margin)} chips) to be worth the risk, because which hands would call it is a guess.`,
    )
    const worthIt = r.ev > callEv + margin
    const notABluff = r.calledShare > 0 && r.whenCalled >= 0
    if (worthIt && !notABluff) {
      reasons.push(
        r.calledShare > 0
          ? `But when at least one of them calls, which is ${fmtPercent(r.calledShare)} of the time, the raise loses ${fmtChips(-r.whenCalled)} chips on average, so it only works as a bluff. This drill never recommends a raise as a pure bluff, because the folds are a guess.`
          : 'But neither of them ever calls, so the raise only works as a bluff. This drill never recommends a raise as a pure bluff, because the folds are a guess.',
      )
    }
    correct = worthIt && notABluff ? 'raise' : 'call'
  } else if (modelled) {
    if (!raise) throw new Error('A raise is modelled here, so the equity against the hands that call it is needed.')
    const margin = RAISE_MARGIN * potNow
    reasons.push(
      `If you raised to ${fmtChips(raise.to)} chips, ${fmtPercent(raise.theyFold)} of their hands would fold and the other ${raise.callingCombos} would call, and against those ${raise.callingCombos} hands you have ${fmtPercent(raise.equityVsCallers)}.`,
    )
    reasons.push(
      `Raising wins ${fmtChips(raise.ev)} chips on average against ${fmtChips(callEv)} for calling; a raise needs to beat the call by at least ${RAISE_MARGIN * 100}% of the pot (${fmtChips(margin)} chips) to be worth the risk, because the model ignores what happens on later streets.`,
    )
    const worthIt = raise.ev > callEv + margin
    const notABluff = raise.equityVsCallers >= raise.breakEven
    if (worthIt && !notABluff) {
      reasons.push(
        `But if they call, you need ${fmtPercent(raise.breakEven)} against the hands that call and you have ${fmtPercent(raise.equityVsCallers)}, so the raise only works as a bluff. This drill never recommends a raise as a pure bluff, because the folds are a guess.`,
      )
    }
    correct = worthIt && notABluff ? 'raise' : 'call'
  } else {
    reasons.push(noRaiseSentence(spot))
    correct = 'call'
  }

  reasons.push(`So the best play is to ${correct}.`)
  return { derived, equity: result.equity, callEv, aheadOf: result.aheadOf, correct, raise, raiseMultiway, reasons }
}
