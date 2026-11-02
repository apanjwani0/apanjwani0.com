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

import { continuingRange } from './continuing'
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
  /** Present only when a raise was modelled (one opponent, not all-in, stack allows). */
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
  /** One sentence per rule applied, in order, with the numbers substituted. */
  reasons: string[]
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
 * Assumes a dealt `Spot`. A raise is modelled against exactly one opponent who
 * is not already all in, and only when hero has chips behind the bet to raise
 * with. Against two opponents the answer would depend on how both respond, which
 * is not a number this model has an honest way to produce.
 */
export function raiseModelled(spot: Spot): boolean {
  return spot.opponents.length === 1 && !spot.allIn && spot.effectiveStack > spot.bet
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

/**
 * The opponent hands that would continue against hero's raise.
 *
 * Assumes `raiseModelled(spot)`. Out of the hands they already showed: after a
 * small bet (often their whole range) they keep what a medium bet keeps, a pair
 * or better or a strong draw; after a medium or bigger bet they keep what a big
 * bet keeps, top pair or better or a draw that can become the best hand; and
 * against a raise that puts them all in they keep what an overbet keeps.
 * Everything else folds. Returns an empty list when no raise is modelled.
 */
export function raiseContinuingCombos(spot: Spot): Card[][] {
  const to = raiseTo(spot)
  if (to === null) return []
  const shove = to >= spot.effectiveStack
  const tone = shove ? 'overbet' : spot.betTone === 'small' ? 'medium' : 'large'
  return continuingRange(spot.opponents[0].combos, spot.board, tone, 'bet').combos
}

/**
 * Decide fold, call or raise, and say why.
 *
 * Assumes `result` is hero's exact equity against the continuing range (one
 * opponent) or ranges (two), and `raiseResult` is hero's exact equity against
 * `raiseContinuingCombos(spot)`, with `combos` the number of those hands. The
 * rules, in order:
 *
 * 1. If calling loses chips on average (callEv is zero or less), fold.
 * 2. If a raise is modelled, raise when its average beats calling by more than
 *    `RAISE_MARGIN` of the pot AND hero still has the equity the raise needs
 *    against the hands that call it. The second half means the drill never
 *    recommends a raise as a pure bluff: the folds are a guess, so a raise has
 *    to be one hero is content to see called. Otherwise call.
 * 3. If no raise is modelled (two opponents, an all-in bet, or no chips left to
 *    raise with), call.
 *
 * `raiseResult` may be left out only when calling already loses, since the
 * first rule ends the decision. Throws if it is missing when it is needed.
 */
export function judge(
  spot: Spot,
  result: EquityFigures,
  raiseResult?: { equity: number; combos: number } | null,
): Judgement {
  const derived = derive(spot)
  const { potNow, toCall, potAfterCall, breakEven } = derived
  const callEv = result.equity * potAfterCall - toCall
  const reasons: string[] = []
  const callsLose = callEv <= 0

  reasons.push(
    `Calling ${fmtChips(toCall)} chips to win ${fmtChips(potAfterCall)} chips needs ${fmtPercent(breakEven)} and you have ${fmtPercent(result.equity)}. `
    + (callsLose
      ? `On average, calling loses ${fmtChips(-callEv)} chips if the hand ends at showdown, so folding is better.`
      : `On average, calling wins ${fmtChips(callEv)} chips if the hand ends at showdown with no more betting.`),
  )

  const modelled = raiseModelled(spot)
  const to = raiseTo(spot)
  let raise: Judgement['raise']
  if (modelled && to !== null && raiseResult) {
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

  let correct: Judgement['correct']
  if (callsLose) {
    correct = 'fold'
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
    reasons.push(
      spot.opponents.length > 1
        ? 'With two opponents, how a raise would be answered depends on both of them, so a raise is not modelled and the choice is between calling and folding.'
        : spot.allIn
          ? 'The bet is already all in, so there is nothing to raise and the choice is between calling and folding.'
          : 'You do not have enough chips behind to make a raise, so the choice is between calling and folding.',
    )
    correct = 'call'
  }

  reasons.push(`So the best play is to ${correct}.`)
  return { derived, equity: result.equity, callEv, aheadOf: result.aheadOf, correct, raise, reasons }
}
