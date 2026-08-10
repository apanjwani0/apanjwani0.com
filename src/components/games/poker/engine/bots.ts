/**
 * Poker Together — bot decision engine.
 *
 * Dependency-free, client-side. Estimates hero equity with a small Monte
 * Carlo simulation against random opponent holdings, compares it to pot
 * odds, and produces an action modulated by the seat's BotPersonality.
 *
 * No network calls, no external packages — only `./types` and `./evaluator`.
 */

import type {
  BotDecision,
  BotDecisionInput,
  BotPersonality,
  Card,
  HandRank,
  Rank,
  Suit,
  VariantConfig,
} from './types'
import { SUITS, clamp } from './types'
import { compareRank, evaluateBest, evaluateOmaha } from './evaluator'

/* ────────────────────────────  rng helpers  ─────────────────────────── */

type Rng = () => number

function makeRng(input: BotDecisionInput): Rng {
  return typeof input.rng === 'function' ? input.rng : Math.random
}

/** Fisher–Yates shuffle, in place. */
function shuffle<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
}

/* ────────────────────────────  deck helpers  ────────────────────────── */

const ALL_RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

function cardKey(c: Card): string {
  return `${c.r}${c.s}`
}

/** Full 52-card deck minus any cards already known (hero hole + board). */
function buildRemainingDeck(known: Card[]): Card[] {
  const seen = new Set(known.map(cardKey))
  const deck: Card[] = []
  for (const s of SUITS as Suit[]) {
    for (const r of ALL_RANKS) {
      const c: Card = { r, s }
      if (!seen.has(cardKey(c))) deck.push(c)
    }
  }
  return deck
}

/* ────────────────────────────  equity estimation  ───────────────────── */

/**
 * Monte Carlo estimate of hero's equity against `activeOpponents` random
 * hands, given the known hole cards and (partial) board. Bounded simulation
 * count so this stays cheap even at a full ring table. Exported so the UI's
 * odds "pet" can show the hero the same honest number the bots reason with —
 * it only ever sees public board + the owner's own hole cards.
 */
export function estimateEquity(variant: VariantConfig, hole: Card[], board: Card[], activeOpponents: number, rng: Rng = Math.random): number {
  const opponents = Math.max(0, Math.floor(activeOpponents))
  const boardCardsNeeded = variant.boardCards ?? 5
  const holeCardsPerOpp = variant.holeCards ?? 2

  // No opponents left to beat (e.g. everyone else folded) — treat as certain win.
  if (opponents === 0) return 1

  const known = [...hole, ...board]
  const baseDeck = buildRemainingDeck(known)

  const cardsNeededPerSim =
    Math.max(0, boardCardsNeeded - board.length) + opponents * holeCardsPerOpp

  // Degenerate: not enough cards left in the deck to complete a simulation.
  if (baseDeck.length < cardsNeededPerSim || cardsNeededPerSim < 0) {
    return 0.5
  }

  // Bound simulation count: ~200 heads-up, scale down as opponents grow,
  // floor around 60 so we never go below a usable sample size.
  const N = Math.max(60, Math.round(200 / Math.sqrt(opponents)))

  let score = 0
  const remaining = baseDeck.slice()

  for (let sim = 0; sim < N; sim++) {
    shuffle(remaining, rng)
    let idx = 0

    const oppHoles: Card[][] = []
    for (let o = 0; o < opponents; o++) {
      oppHoles.push(remaining.slice(idx, idx + holeCardsPerOpp))
      idx += holeCardsPerOpp
    }

    const boardNeeded = Math.max(0, boardCardsNeeded - board.length)
    const fullBoard = board.concat(remaining.slice(idx, idx + boardNeeded))
    idx += boardNeeded

    const heroRank: HandRank =
      variant.useHoleExactly === 2 ? evaluateOmaha(hole, fullBoard) : evaluateBest([...hole, ...fullBoard])

    let heroBeatsAll = true
    let tieCount = 0
    for (const oppHole of oppHoles) {
      const oppRank: HandRank =
        variant.useHoleExactly === 2
          ? evaluateOmaha(oppHole, fullBoard)
          : evaluateBest([...oppHole, ...fullBoard])
      const cmp = compareRank(heroRank, oppRank)
      if (cmp < 0) {
        heroBeatsAll = false
        break
      } else if (cmp === 0) {
        tieCount++
      }
    }

    if (heroBeatsAll) {
      score += tieCount > 0 ? 1 / (tieCount + 1) : 1
    }
  }

  return N > 0 ? score / N : 0.5
}

/* ────────────────────────────  personality profiles  ────────────────── */

interface PersonalityProfile {
  /** multiplies the equity threshold needed to continue (>1 = folds more) */
  foldFactor: number
  /** equity level (0..1) above which we consider betting/raising for value */
  valueThreshold: number
  /** chance [0,1] of firing a bluff/semi-bluff bet or raise when not value-strong */
  bluffChance: number
  /** how large a fraction of pot to bet/raise, as a base multiplier */
  sizeFactor: number
  /** chance of calling a bit looser than pure pot odds would suggest */
  looseCallChance: number
  /** equity threshold above which we consider jamming all-in */
  jamThreshold: number
}

const PROFILES: Record<BotPersonality, PersonalityProfile> = {
  rock: {
    foldFactor: 1.35,
    valueThreshold: 0.72,
    bluffChance: 0.03,
    sizeFactor: 0.55,
    looseCallChance: 0.03,
    jamThreshold: 0.9,
  },
  station: {
    foldFactor: 0.55,
    valueThreshold: 0.68,
    bluffChance: 0.05,
    sizeFactor: 0.5,
    looseCallChance: 0.45,
    jamThreshold: 0.92,
  },
  balanced: {
    foldFactor: 1.0,
    valueThreshold: 0.6,
    bluffChance: 0.12,
    sizeFactor: 0.65,
    looseCallChance: 0.15,
    jamThreshold: 0.85,
  },
  shark: {
    foldFactor: 0.95,
    valueThreshold: 0.55,
    bluffChance: 0.22,
    sizeFactor: 0.8,
    looseCallChance: 0.18,
    jamThreshold: 0.8,
  },
  maniac: {
    foldFactor: 0.7,
    valueThreshold: 0.45,
    bluffChance: 0.4,
    sizeFactor: 1.0,
    looseCallChance: 0.3,
    jamThreshold: 0.72,
  },
}

/* ────────────────────────────  sizing helpers  ──────────────────────── */

function think(rng: Rng): number {
  return Math.round(300 + rng() * 600)
}

function sizeBet(pot: number, factor: number, rng: Rng, min: number, max: number): number {
  const frac = 0.5 + rng() * 0.5 // 0.5x - 1.0x pot base
  const raw = Math.round(pot * frac * factor)
  return clamp(raw, min, max)
}

/* ────────────────────────────  main entry point  ────────────────────── */

export function decide(input: BotDecisionInput): BotDecision {
  const rng = makeRng(input)
  const profile = PROFILES[input.personality] ?? PROFILES.balanced

  // Guard against degenerate inputs.
  const pot = Number.isFinite(input.pot) ? Math.max(0, input.pot) : 0
  const toCall = Number.isFinite(input.toCall) ? Math.max(0, input.toCall) : 0
  const myChips = Number.isFinite(input.myChips) ? Math.max(0, input.myChips) : 0
  const bigBlind = Number.isFinite(input.bigBlind) && input.bigBlind > 0 ? input.bigBlind : 1
  const minRaiseTo = Number.isFinite(input.minRaiseTo) ? input.minRaiseTo : toCall
  const maxRaiseTo = Number.isFinite(input.maxRaiseTo) ? input.maxRaiseTo : minRaiseTo

  const equity = clamp(estimateEquity(input.variant, input.hole ?? [], input.board ?? [], input.activeOpponents, rng), 0, 1)
  const shortStacked = myChips <= bigBlind * 8

  // Effective raise ceiling never exceeds what the bot can actually put in.
  const hardMax = Math.max(minRaiseTo, Math.min(maxRaiseTo, myChips + toCall))

  if (input.canCheck && toCall === 0) {
    const wantsValueBet = equity >= profile.valueThreshold
    const wantsBluff = !wantsValueBet && rng() < profile.bluffChance
    if (input.canBet && (wantsValueBet || wantsBluff)) {
      // If we can't legally reach a raise, just check instead of jamming pointlessly.
      if (hardMax <= 0) {
        return { action: 'check', think: think(rng) }
      }
      let amountTo = sizeBet(pot, profile.sizeFactor, rng, minRaiseTo, hardMax)
      if (equity >= profile.jamThreshold || shortStacked) {
        amountTo = hardMax
      }
      amountTo = clamp(amountTo, minRaiseTo, hardMax)
      return { action: 'bet', amountTo, think: think(rng) }
    }
    return { action: 'check', think: think(rng) }
  }

  // toCall > 0 from here on.
  const needed = pot + toCall > 0 ? toCall / (pot + toCall) : 0
  const foldThreshold = needed * profile.foldFactor

  // Never fold when we could've just checked; also never fold if there's
  // nothing left to lose (already all-in / no chips).
  if (myChips <= 0) {
    return { action: 'call', think: think(rng) }
  }

  if (equity < foldThreshold) {
    // Personality-flavored loose call: occasionally pay a small price anyway.
    const cheapCall = toCall <= bigBlind * 2 || toCall <= pot * 0.12
    if (cheapCall && rng() < profile.looseCallChance) {
      return { action: 'call', think: think(rng) }
    }
    return { action: 'fold', think: think(rng) }
  }

  const wantsValueRaise = equity >= profile.valueThreshold
  const wantsBluffRaise = !wantsValueRaise && rng() < profile.bluffChance

  if (input.canRaise && (wantsValueRaise || wantsBluffRaise)) {
    // If calling would already commit us fully, or raise room has collapsed
    // to "can only shove", treat a raise-intent as a call/all-in situation.
    if (toCall >= myChips) {
      return { action: 'call', think: think(rng) }
    }

    if (hardMax <= minRaiseTo) {
      // Only a shove is legally available.
      return { action: 'raise', amountTo: hardMax, think: think(rng) }
    }

    let amountTo = sizeBet(pot, profile.sizeFactor, rng, minRaiseTo, hardMax)
    if (equity >= profile.jamThreshold || shortStacked) {
      amountTo = hardMax
    }
    amountTo = clamp(amountTo, minRaiseTo, hardMax)

    // A raise that would require calling more than we have is really a call.
    if (amountTo - toCall > myChips - toCall && toCall >= myChips) {
      return { action: 'call', think: think(rng) }
    }

    return { action: 'raise', amountTo, think: think(rng) }
  }

  return { action: 'call', think: think(rng) }
}
