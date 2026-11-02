/**
 * Scenarios: the situations the Poker Trainer deals.
 *
 * The first trainer dealt one situation with different cards: a pot of 100, one
 * opponent holding a random opening range, a bet of a third to the pot. A
 * player who has seen five of those has seen them all. This module deals
 * seven different situations (see `SCENARIO_TEMPLATES`), each one a story you
 * can read, with seats, stack sizes, a bet that came from somewhere, and an
 * opponent whose range has been narrowed by what they did.
 *
 * ==Every chip is accounted for.== A pot is never typed in. It is the sum of
 * what the story says each player put in, and `ledger` lists those amounts so a
 * check can add them up and compare with `potBefore`. A pot that is "about
 * right" is exactly the unexplained number this rewrite exists to remove.
 *
 * ==A spot is a function of a seed.== The same seed and template always deal the
 * same cards, the same story and the same ranges, because nothing here reads a
 * clock or a random source except the seed itself (`seededRng`). That is what
 * makes a permalink (`encodeSpot` / `decodeSpot`) three short characters of
 * state rather than a copy of the spot, and it is why a shared link can never
 * carry anything the engine did not deal.
 *
 * Nothing is sampled. When a situation is too expensive to count exactly, the
 * board is widened (flop, then turn, then river) until it is affordable; the
 * lines are written after the street is final, so the story never describes a
 * street the board does not show.
 */

import { shuffle } from './cards'
import { continuingRange, draws, fallbackSentence, strength, toneForSize, type BetKind, type BetTone } from './continuing'
import { scoreBest } from './evaluator'
import { cachedRangeCombos } from './equity-cache'
import { multiwayWork, rangeWork } from './equity'
import { PRESET_RANGES, type NamedRange } from './ranges'
import { HAND_CATEGORY, SUITS, type Card } from './types'

export type { BetTone } from './continuing'

export type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB'
export type Street = 'flop' | 'turn' | 'river'

/**
 * The most work a spot may cost to count exactly: combos times boards to come
 * for one opponent, or pairs times boards to come for two.
 *
 * This decides which street a spot is dealt on, so it is a lesson setting as
 * well as a speed one. It sits where the trainer already had it (about a tenth
 * of a second); widening it would move spots onto earlier streets.
 */
export const PT_MAX_RANGE_WORK = 60_000

export const SMALL_BLIND = 5
export const BIG_BLIND = 10
/** Every stack starts at 100 big blinds unless a template says otherwise. */
export const START_STACK = 1000
/** The standard first raise: 2.5 big blinds. */
export const OPEN_SIZE = 25

export interface Opponent {
  position: Position
  /** The preflop preset id the range started from (PRESET_RANGES), or 'flat-call'. */
  rangeId: string
  rangeLabel: string
  /** Full combos after preflop, with hero and board cards removed. */
  preflopCombos: Card[][]
  /** What they continue with on this street given the size they chose. */
  combos: Card[][]
  /** One plain sentence: what this bet size says about their hand. */
  rangeNote: string
  /** 'bettor' | 'caller' (a caller put in `bet` before hero acts, multiway). */
  role: 'bettor' | 'caller'
}

/** One thing that put chips in the pot, in the order it happened. */
export interface LedgerEntry {
  who: string
  /** Chips this action added. Never negative; a fold adds nothing and has no entry. */
  chips: number
  what: string
}

export interface Spot {
  templateId: string
  /** Short human title, e.g. "Single raised pot, you have position". */
  title: string
  blinds: { sb: number; bb: number }
  /** Chips behind for hero at the start of THIS street. */
  effectiveStack: number
  heroPosition: Position
  hero: Card[]
  board: Card[]
  street: Street
  opponents: Opponent[]
  /** Pot at the start of this street's action (before anyone bet this street). */
  potBefore: number
  /** What hero already put in on this street (0 unless the "you bet, they raised" template). */
  heroIn: number
  /** The bet hero faces, in chips. For a raise it is the raise-to amount. */
  bet: number
  /** Chips put in by callers before hero on this street (multiway). */
  callersIn: number
  betTone: BetTone
  /** The bettor is all in: raising is impossible. */
  allIn: boolean
  /** One sentence per step of the story, in order. The UI prints them. */
  line: string[]
  /** Every chip that went in before this street, so the pot can be added up. `potBefore` is their sum. */
  ledger: LedgerEntry[]
}

export interface Derived {
  /** potBefore + heroIn + bet + callersIn: the chips on the table when hero acts. */
  potNow: number
  /** bet - heroIn */
  toCall: number
  /** potNow + toCall */
  potAfterCall: number
  /** toCall / potAfterCall: the equity a call needs to break even. */
  breakEven: number
  /** potNow / toCall: the "X to 1" of pot odds. */
  potOdds: number
}

/**
 * Every number the pot-odds arithmetic needs, from the spot alone.
 *
 * Assumes `bet > heroIn` (hero faces something to call). A raise is the
 * raise-to amount, so hero's own chips already in the pot are subtracted from
 * what a call costs and counted in the pot once.
 */
export function derive(spot: Spot): Derived {
  const potNow = spot.potBefore + spot.heroIn + spot.bet + spot.callersIn
  const toCall = spot.bet - spot.heroIn
  const potAfterCall = potNow + toCall
  return {
    potNow,
    toCall,
    potAfterCall,
    breakEven: toCall / potAfterCall,
    potOdds: potNow / toCall,
  }
}

/**
 * What a spot costs to count exactly: combos times boards to come (one
 * opponent) or pairs times boards to come (two).
 *
 * Assumes hero and board cards were already removed from the opponents' combos,
 * which every dealt spot does.
 */
export function spotWork(spot: Spot): number {
  if (spot.opponents.length === 1) return rangeWork(spot.opponents[0].combos.length, spot.board)
  return multiwayWork(spot.opponents[0].combos, spot.opponents[1].combos, spot.board)
}

/* ────────────────────────────  random source  ──────────────────────────── */

/**
 * A small seeded generator (mulberry32, by Tommy Ettinger).
 *
 * Assumes any integer seed; it is read as an unsigned 32-bit value. Returns a
 * function giving numbers in [0, 1). It is not cryptographic and does not need
 * to be: its job is that one seed always replays the same spot.
 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomSeed(): number {
  const buf = new Uint32Array(1)
  globalThis.crypto.getRandomValues(buf)
  return buf[0]
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}

/**
 * Round to the nearest 5 chips, with a tie going down.
 *
 * Down, so that 3.5 times a 25 chip open is 85 and not 90, the figure a player
 * would actually count out. Chips are whole numbers throughout.
 */
export function round5(chips: number): number {
  return Math.ceil(chips / 5 - 0.5) * 5
}

const chips = (n: number) => `${n} chips`
const percent = (part: number, whole: number) => Math.round((part / whole) * 100)

/* ─────────────────────────────  the cast  ───────────────────────────── */

const SEAT_NAME: Record<Position, string> = {
  UTG: 'the player under the gun',
  MP: 'the middle-seat player',
  CO: 'the cutoff',
  BTN: 'the button',
  SB: 'the small blind',
  BB: 'the big blind',
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const seat = (position: Position) => capital(SEAT_NAME[position])

function namedRange(id: string): NamedRange {
  const found = PRESET_RANGES.find(range => range.id === id)
  if (!found) throw new Error(`Unknown range: ${id}`)
  return found
}

/**
 * The range of a player who calls a raise from the button or cutoff.
 *
 * Not one of the Solve tab's presets: it is the calling half of a split that the
 * opening ranges do not describe. Hands strong enough to re-raise are mostly
 * absent and the weakest openers are folded.
 */
export const FLAT_CALL_RANGE: NamedRange = {
  id: 'flat-call',
  label: 'Calls a raise',
  note: 'Pairs, suited and connected hands, and big aces that call a raise rather than fold.',
  text: '22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, 65s, AJo+, KQo',
}

/** The opening range a player in this seat uses, from the preset list. */
function openRange(position: Position): NamedRange {
  if (position === 'UTG' || position === 'MP') return namedRange('utg')
  if (position === 'CO') return namedRange('co')
  if (position === 'BTN') return namedRange('btn')
  return namedRange('bb-defend')
}

/* ─────────────────────────  the story machinery  ───────────────────────── */

interface Event {
  who: string
  /** Chips this step added; 0 for a step that only describes (a check, a stack line). */
  chips: number
  text: string
}

interface Villain {
  position: Position
  range: NamedRange
  role: 'bettor' | 'caller'
}

interface Plan {
  id: string
  title: string
  heroPosition: Position
  heroRange: NamedRange
  villains: Villain[]
  /** The steps before the flop; their chips are the first part of the pot. */
  story: Event[]
  /** Chips each player still in has put in so far. */
  committed: number
  startStack: number
  /** Hero made the bets on earlier streets (the "you bet, they raised" story). */
  heroAggressor: boolean
  /** Hero is first to act after the flop, so "You check." belongs in the story. */
  heroActsFirst: boolean
}

interface StreetAction {
  bet: number
  heroIn: number
  callersIn: number
  allIn: boolean
  raise: boolean
  /** Replaces the stack at the start of the street (the all-in template sets it). */
  stackHere?: number
  /** What happens on this street, as sentences; no chips are added to the ledger. */
  events: string[]
}

interface StreetContext {
  rng: () => number
  pot: number
  stack: number
  plan: Plan
  street: Street
}

type Actor = (ctx: StreetContext) => StreetAction

const BLINDS_EVENT: Event = {
  who: 'Blinds',
  chips: SMALL_BLIND + BIG_BLIND,
  text: `The small blind posts ${SMALL_BLIND} chips and the big blind posts ${BIG_BLIND} chips, which puts ${SMALL_BLIND + BIG_BLIND} chips in the pot.`,
}

const FLOP_BET_SHARES = [33, 50, 66]
const STREETS: Street[] = ['flop', 'turn', 'river']

/** Bet a share of the pot, in 5-chip steps and never below one big blind. */
function sized(pot: number, share: number): number {
  return Math.max(BIG_BLIND, round5((pot * share) / 100))
}

/** A caller continues with at least a medium bet's range, or a large one's against a big bet. */
function callerTone(tone: BetTone): BetTone {
  return tone === 'large' || tone === 'overbet' || tone === 'all-in' ? 'large' : 'medium'
}

function callerNote(tone: BetTone, river: boolean, fallback: boolean, count: number): string {
  const base = tone === 'large'
    ? (river
      ? 'Calling a big bet on the river usually means top pair or better.'
      : 'Calling a big bet usually means top pair or better, or a draw that can become the best hand.')
    : (river
      ? 'Calling a bet on the river usually means a pair or better.'
      : 'Calling a bet usually means a pair or better, or a strong draw, meaning a hand that is not made yet but has many cards that would make it.')
  return fallback ? `${base} ${fallbackSentence(count)}` : base
}

/** How many of the spots are dealt so that hero's hand tries to connect with the board. */
export const HERO_CONNECT_SHARE = 0.65
/** How many times a biased spot may draw hero's hand again before it keeps what it has. */
export const HERO_REDRAWS = 3

/** The packed evaluator score keeps the hand category from this bit up (continuing.ts). */
const CATEGORY_SHIFT = 20

/**
 * Does hero's hand do something with this board?
 *
 * True for a pair or better that a hole card helps make, a flush draw, or an
 * open-ended straight draw. A pair that sits on the board alone, or a straight
 * the board already shows to everyone, does not count: that is not hero
 * connecting, it is the board.
 */
export function heroConnects(hero: Card[], board: Card[]): boolean {
  const score = strength(hero, board)
  const category = score >> CATEGORY_SHIFT
  const ranks = board.map(card => card.r)
  const helped = hero[0].r === hero[1].r || ranks.includes(hero[0].r) || ranks.includes(hero[1].r)
  const beatsBoard = board.length < 5 || score > scoreBest(board)
  if (category >= HAND_CATEGORY.PAIR && (helped || category >= HAND_CATEGORY.STRAIGHT) && beatsBoard) return true
  const draw = draws(hero, board)
  return draw.flush || draw.openEnded
}

/**
 * Bias hero's hand toward spots that connect, so fewer drills are a plain fold.
 *
 * Hero's hand is drawn from a preflop range against a board dealt without
 * looking at it, which is why about six drills in ten were folds. In 65% of the
 * spots, a hand that misses is drawn again, up to three times, from the same
 * preflop range, and the first one that connects is kept. The other 35% are
 * left alone so folds still appear. The side random stream is seeded from the
 * first hand and the board, never from the spot's own stream, so the rest of the
 * spot (villain ranges, bet sizes, lines) is exactly what the unbiased deal made.
 */
function biasedDeal(
  pool: readonly Card[][],
  first: Card[],
  firstBoard: Card[],
  boardFor: (hero: Card[]) => Card[],
): { hero: Card[]; board: Card[] } {
  const key = [...first, ...firstBoard].reduce((h, card) => Math.imul(h ^ (card.r * 4 + SUITS.indexOf(card.s) + 1), 0x01000193), 0x811c9dc5)
  const side = seededRng(key)
  if (side() >= HERO_CONNECT_SHARE) return { hero: first, board: firstBoard }
  let hero = first
  let board = firstBoard
  for (let tries = 0; tries < HERO_REDRAWS && !heroConnects(hero, board); tries++) {
    hero = pick(side, pool).map(card => ({ ...card }))
    board = boardFor(hero)
  }
  return { hero, board }
}

/**
 * Deal one spot from a plan, an actor and a street.
 *
 * Assumes the plan's ranges and the deck are consistent (the deck is a full
 * shuffled 52). It draws hero's hand from hero's own preflop range, plays the
 * streets before this one (a bet that is called, sized from a third to two
 * thirds of the pot), narrows each opponent's range after every bet they made or
 * called, and lets the actor decide this street. The lines are written last.
 */
function assemble(plan: Plan, act: Actor, rng: () => number, deck: Card[], street: Street): Spot {
  const heroPool = cachedRangeCombos(plan.heroRange.text).combos
  const boardSize = 3 + STREETS.indexOf(street)
  const boardFor = (cards: Card[]): Card[] => {
    const keys = new Set(cards.map(card => `${card.r}${card.s}`))
    return deck.filter(card => !keys.has(`${card.r}${card.s}`)).slice(0, boardSize)
  }
  let hero = pick(rng, heroPool).map(card => ({ ...card }))
  let board = boardFor(hero)
  const connected = biasedDeal(heroPool, hero, board, boardFor)
  hero = connected.hero
  board = connected.board
  const dead = [...hero, ...board]

  const preflop = plan.villains.map(villain => cachedRangeCombos(villain.range.text, dead).combos)
  let current = preflop.slice()

  const ledger: LedgerEntry[] = []
  const lines: string[] = []
  for (const event of plan.story) {
    lines.push(event.text)
    if (event.chips > 0) ledger.push({ who: event.who, chips: event.chips, what: event.text })
  }
  let pot = ledger.reduce((sum, entry) => sum + entry.chips, 0)
  let committed = plan.committed

  const players = 1 + plan.villains.length
  const bettorOf = plan.villains.findIndex(villain => villain.role === 'bettor')
  const earlier = STREETS.slice(0, STREETS.indexOf(street))
  for (const prior of earlier) {
    const size = sized(pot, pick(rng, FLOP_BET_SHARES))
    const tone = toneForSize(size, pot)
    const priorBoard = board.slice(0, 3 + STREETS.indexOf(prior))
    const bettorName = plan.heroAggressor ? 'you' : SEAT_NAME[plan.villains[bettorOf].position]
    const callerNames = plan.heroAggressor
      ? plan.villains.map(v => SEAT_NAME[v.position])
      : ['you', ...plan.villains.filter((_, i) => i !== bettorOf).map(v => SEAT_NAME[v.position])]
    const betText = `On the ${prior}, ${bettorName} bet ${chips(size)} (${percent(size, pot)}% of the pot).`
    lines.push(betText)
    ledger.push({ who: capital(bettorName), chips: size, what: betText })
    for (const caller of callerNames) {
      const callText = `${capital(caller)} called ${chips(size)}.`
      lines.push(callText)
      ledger.push({ who: capital(caller), chips: size, what: callText })
    }
    current = current.map((combos, i) => {
      const bettor = plan.heroAggressor ? false : i === bettorOf
      return continuingRange(combos, priorBoard, bettor ? tone : callerTone(tone), 'bet').combos
    })
    pot += size * players
    committed += size
  }
  const history = earlier.length > 0

  const stackAtStreet = plan.startStack - committed
  const action = act({ rng, pot, stack: stackAtStreet, plan, street })
  const effectiveStack = action.stackHere ?? stackAtStreet
  lines.push(...action.events)

  const filterTone = toneForSize(action.bet, pot + action.heroIn)
  const betTone: BetTone = action.allIn ? 'all-in' : filterTone
  const opponents: Opponent[] = plan.villains.map((villain, i) => {
    const river = street === 'river'
    let kind: BetKind = 'bet'
    let tone: BetTone = filterTone
    if (villain.role === 'bettor') {
      if (action.raise) { kind = 'raise'; tone = 'medium' }
    } else {
      tone = callerTone(filterTone)
    }
    const narrowed = continuingRange(current[i], board, tone, kind)
    let note = villain.role === 'bettor'
      ? narrowed.note
      : callerNote(tone, river, narrowed.fallback, narrowed.combos.length)
    if (history && !narrowed.fallback) {
      const when = earlier.length > 1 ? 'on the earlier streets' : 'on the earlier street'
      note += plan.heroAggressor
        ? ` They also called your bets ${when}, so their weakest hands are already gone.`
        : villain.role === 'bettor'
          ? ` They also kept betting ${when}, so their weakest hands are already gone.`
          : ` They also called ${when}, so their weakest hands are already gone.`
    }
    return {
      position: villain.position,
      rangeId: villain.range.id,
      rangeLabel: villain.range.label,
      preflopCombos: preflop[i],
      combos: narrowed.combos,
      rangeNote: note,
      role: villain.role,
    }
  })

  // Only the all-in template changes the stack, and it does so after the earlier streets are paid for.
  const startStack = action.stackHere === undefined ? plan.startStack : committed + action.stackHere
  // The blinds sentence opens every story, so the stacks ride on it rather than
  // adding a sentence of their own: a reader sees the setup once, in one line.
  const [blindsLine, ...playLines] = lines
  const stackLine = `${blindsLine} Everyone started with ${startStack} chips, which is ${Number((startStack / BIG_BLIND).toFixed(1))} big blinds.`
  return {
    templateId: plan.id,
    title: plan.title,
    blinds: { sb: SMALL_BLIND, bb: BIG_BLIND },
    effectiveStack,
    heroPosition: plan.heroPosition,
    hero,
    board,
    street,
    opponents,
    potBefore: pot,
    heroIn: action.heroIn,
    bet: action.bet,
    callersIn: action.callersIn,
    betTone,
    allIn: action.allIn,
    line: [stackLine, ...playLines],
    ledger,
  }
}

/* ───────────────────────────  the seven templates  ─────────────────────────── */

function heroWhere(position: Position): string {
  return `You, on ${SEAT_NAME[position]},`
}

/** Villain opens, hero calls in position, the blinds fold. */
function planInPosition(rng: () => number, id: string, title: string): Plan {
  const villain = pick(rng, ['UTG', 'MP', 'CO'] as const)
  const heroPosition = pick(rng, villain === 'CO' ? (['BTN'] as const) : (['CO', 'BTN'] as const))
  return {
    id,
    title,
    heroPosition,
    heroRange: FLAT_CALL_RANGE,
    villains: [{ position: villain, range: openRange(villain), role: 'bettor' }],
    story: [
      BLINDS_EVENT,
      {
        who: seat(villain),
        chips: OPEN_SIZE,
        text: `${seat(villain)} opens by raising to ${chips(OPEN_SIZE)}, which is ${OPEN_SIZE / BIG_BLIND} big blinds.`,
      },
      {
        who: 'You',
        chips: OPEN_SIZE,
        text: `${heroWhere(heroPosition)} call ${chips(OPEN_SIZE)}. Everyone else folds, including both blinds.`,
      },
    ],
    committed: OPEN_SIZE,
    startStack: START_STACK,
    heroAggressor: false,
    heroActsFirst: false,
  }
}

/** Villain opens, the small blind folds, hero defends the big blind. */
function planBigBlind(rng: () => number, id: string, title: string): Plan {
  const villain = pick(rng, ['CO', 'BTN'] as const)
  return {
    id,
    title,
    heroPosition: 'BB',
    heroRange: namedRange('bb-defend'),
    villains: [{ position: villain, range: openRange(villain), role: 'bettor' }],
    story: [
      BLINDS_EVENT,
      {
        who: seat(villain),
        chips: OPEN_SIZE,
        text: `${seat(villain)} opens by raising to ${chips(OPEN_SIZE)}, which is ${OPEN_SIZE / BIG_BLIND} big blinds. Everyone else folds, including the small blind.`,
      },
      {
        who: 'You',
        chips: OPEN_SIZE - BIG_BLIND,
        text: `You, in the big blind, already have ${chips(BIG_BLIND)} in, so calling costs ${chips(OPEN_SIZE - BIG_BLIND)} more.`,
      },
    ],
    committed: OPEN_SIZE,
    startStack: START_STACK,
    heroAggressor: false,
    heroActsFirst: true,
  }
}

function planEitherSeat(rng: () => number, id: string, title: string): Plan {
  return rng() < 0.5 ? planInPosition(rng, id, title) : planBigBlind(rng, id, title)
}

/** The bettor's opening line shared by most templates: the check hero owes when acting first, then the bet. */
function villainBets(ctx: StreetContext, bet: number, allIn: boolean): StreetAction {
  const villain = ctx.plan.villains.find(v => v.role === 'bettor') ?? ctx.plan.villains[0]
  const events: string[] = []
  if (ctx.plan.heroActsFirst) events.push('You check, which means you pass without betting.')
  const share = percent(bet, ctx.pot)
  events.push(allIn
    ? `${seat(villain.position)} moves all in for ${chips(bet)}, everything they have left. That is ${share}% of the pot.`
    : `${seat(villain.position)} bets ${chips(bet)} into a pot of ${chips(ctx.pot)}, which is ${share}% of the pot.`)
  return { bet, heroIn: 0, callersIn: 0, allIn, raise: false, events }
}

/** A bet of a share of the pot, or all-in when it would not fit behind. */
function ordinaryBet(ctx: StreetContext, shares: readonly number[]): StreetAction {
  const wanted = sized(ctx.pot, pick(ctx.rng, shares))
  return wanted >= ctx.stack ? villainBets(ctx, ctx.stack, true) : villainBets(ctx, wanted, false)
}

const SHOVE_SIZES = [0.5, 0.8, 1.0, 1.5, 2.5]

export interface ScenarioTemplate {
  id: string
  title: string
  weight: number
  /** Relative chance of starting on the flop, turn and river; the work budget can still move it later. */
  streets: readonly [number, number, number]
  build: (rng: () => number, deck: Card[], street: Street) => Spot
}

export const SCENARIO_TEMPLATES: readonly ScenarioTemplate[] = [
  {
    id: 'srp-ip',
    title: 'Single raised pot, you have position',
    weight: 3,
    streets: [1, 1, 1],
    build(rng, deck, street) {
      const plan = planInPosition(rng, 'srp-ip', 'Single raised pot, you have position')
      return assemble(plan, ctx => ordinaryBet(ctx, [33, 50, 66, 75, 100, 125]), rng, deck, street)
    },
  },
  {
    id: 'srp-oop',
    title: 'Single raised pot, you defend the big blind',
    weight: 3,
    streets: [1, 1, 1],
    build(rng, deck, street) {
      const plan = planBigBlind(rng, 'srp-oop', 'Single raised pot, you defend the big blind')
      return assemble(plan, ctx => ordinaryBet(ctx, [33, 50, 66, 75, 100, 125]), rng, deck, street)
    },
  },
  {
    id: 'three-bet-pot',
    title: 'Three-bet pot',
    weight: 2,
    streets: [1, 1, 1],
    build(rng, deck, street) {
      const heroPosition = pick(rng, ['CO', 'BTN'] as const)
      const villain = pick(rng, heroPosition === 'CO' ? (['BTN', 'SB', 'BB'] as const) : (['SB', 'BB'] as const))
      const inPosition = villain === 'BTN'
      const to = round5(OPEN_SIZE * (inPosition ? 3 : 3.5))
      const blindIn = villain === 'SB' ? SMALL_BLIND : villain === 'BB' ? BIG_BLIND : 0
      const plan: Plan = {
        id: 'three-bet-pot',
        title: 'Three-bet pot',
        heroPosition,
        heroRange: namedRange('call-3bet'),
        villains: [{ position: villain, range: namedRange('three-bet'), role: 'bettor' }],
        story: [
          BLINDS_EVENT,
          {
            who: 'You',
            chips: OPEN_SIZE,
            text: `${heroWhere(heroPosition)} open by raising to ${chips(OPEN_SIZE)}.`,
          },
          {
            who: seat(villain),
            chips: to - blindIn,
            text: blindIn > 0
              ? `${seat(villain)} three-bets, meaning they re-raise your raise, to ${chips(to)}. The ${chips(blindIn)} they posted as the blind count toward that, so they add ${chips(to - blindIn)}.`
              : `${seat(villain)} three-bets, meaning they re-raise your raise, to ${chips(to)}.`,
          },
          {
            who: 'You',
            chips: to - OPEN_SIZE,
            text: `You call, putting in ${chips(to - OPEN_SIZE)} more to make it ${chips(to)}. Everyone else folds.`,
          },
        ],
        committed: to,
        startStack: START_STACK,
        heroAggressor: false,
        heroActsFirst: villain === 'BTN',
      }
      return assemble(plan, ctx => {
        // A villain who would be left with under one and a half pots behind is
        // committed, so they put it all in rather than make a bet that leaves a sliver.
        if (ctx.stack < 1.5 * ctx.pot) return villainBets(ctx, ctx.stack, true)
        return ordinaryBet(ctx, [33, 66])
      }, rng, deck, street)
    },
  },
  {
    id: 'multiway',
    title: 'Multiway pot, one bet and one call',
    weight: 2,
    streets: [0, 1, 1],
    build(rng, deck, street) {
      const plan: Plan = {
        id: 'multiway',
        title: 'Multiway pot, one bet and one call',
        heroPosition: 'BB',
        heroRange: namedRange('bb-defend'),
        villains: [
          { position: 'CO', range: namedRange('co'), role: 'bettor' },
          { position: 'BTN', range: FLAT_CALL_RANGE, role: 'caller' },
        ],
        story: [
          BLINDS_EVENT,
          {
            who: seat('CO'),
            chips: OPEN_SIZE,
            text: `${seat('CO')} opens by raising to ${chips(OPEN_SIZE)}.`,
          },
          {
            who: seat('BTN'),
            chips: OPEN_SIZE,
            text: `${seat('BTN')} calls ${chips(OPEN_SIZE)}. The small blind folds.`,
          },
          {
            who: 'You',
            chips: OPEN_SIZE - BIG_BLIND,
            text: `You, in the big blind, already have ${chips(BIG_BLIND)} in, so you call ${chips(OPEN_SIZE - BIG_BLIND)} more.`,
          },
        ],
        committed: OPEN_SIZE,
        startStack: START_STACK,
        heroAggressor: false,
        heroActsFirst: true,
      }
      return assemble(plan, ctx => {
        const bet = sized(ctx.pot, pick(ctx.rng, [33, 50, 66]))
        return {
          bet,
          heroIn: 0,
          callersIn: bet,
          allIn: false,
          raise: false,
          events: [
            'You check, which means you pass without betting.',
            `${seat('CO')} bets ${chips(bet)} into a pot of ${chips(ctx.pot)}, which is ${percent(bet, ctx.pot)}% of the pot.`,
            `${seat('BTN')} calls ${chips(bet)}, so ${chips(2 * bet)} has been added to the pot and it is back to you.`,
          ],
        }
      }, rng, deck, street)
    },
  },
  {
    id: 'facing-shove',
    title: 'Facing an all-in',
    weight: 2,
    streets: [1, 1, 1],
    build(rng, deck, street) {
      const plan = planEitherSeat(rng, 'facing-shove', 'Facing an all-in')
      return assemble(plan, ctx => {
        // The stack is set so the shove lands on a chosen share of the pot, which
        // makes the stack depth an outcome here, not an input.
        const bet = Math.max(BIG_BLIND, round5(ctx.pot * pick(ctx.rng, SHOVE_SIZES)))
        return { ...villainBets(ctx, bet, true), stackHere: bet }
      }, rng, deck, street)
    },
  },
  {
    id: 'bet-raised',
    title: 'You bet and were raised',
    weight: 2,
    streets: [1, 1, 0],
    build(rng, deck, street) {
      const heroPosition = pick(rng, ['CO', 'BTN'] as const)
      const plan: Plan = {
        id: 'bet-raised',
        title: 'You bet and were raised',
        heroPosition,
        heroRange: openRange(heroPosition),
        villains: [{ position: 'BB', range: namedRange('bb-defend'), role: 'bettor' }],
        story: [
          BLINDS_EVENT,
          {
            who: 'You',
            chips: OPEN_SIZE,
            text: `${heroWhere(heroPosition)} open by raising to ${chips(OPEN_SIZE)}. Everyone folds except the big blind.`,
          },
          {
            who: seat('BB'),
            chips: OPEN_SIZE - BIG_BLIND,
            text: `${seat('BB')} already has ${chips(BIG_BLIND)} in and calls ${chips(OPEN_SIZE - BIG_BLIND)} more.`,
          },
        ],
        committed: OPEN_SIZE,
        startStack: START_STACK,
        heroAggressor: true,
        heroActsFirst: false,
      }
      return assemble(plan, ctx => {
        const mine = sized(ctx.pot, 50)
        const wanted = round5(mine * (ctx.rng() < 0.7 ? 3 : 2.5))
        const allIn = wanted >= ctx.stack
        const to = allIn ? ctx.stack : wanted
        return {
          bet: to,
          heroIn: mine,
          callersIn: 0,
          allIn,
          raise: true,
          events: [
            `${seat('BB')} checks. You bet ${chips(mine)} into a pot of ${chips(ctx.pot)}, which is ${percent(mine, ctx.pot)}% of the pot.`,
            allIn
              ? `${seat('BB')} raises all in, to ${chips(to)}. The ${chips(mine)} you already bet is part of the pot, so calling costs only ${chips(to - mine)} more.`
              : `${seat('BB')} raises to ${chips(to)}. The ${chips(mine)} you already bet is part of the pot, so calling costs only ${chips(to - mine)} more.`,
          ],
        }
      }, rng, deck, street)
    },
  },
  {
    id: 'river-polar',
    title: 'River: a very strong hand or a bluff',
    weight: 2,
    streets: [0, 0, 1],
    build(rng, deck, street) {
      const plan = planEitherSeat(rng, 'river-polar', 'River: a very strong hand or a bluff')
      return assemble(plan, ctx => ordinaryBet(ctx, [50, 100, 150, 200]), rng, deck, street)
    },
  },
]

const TEMPLATE_IDS = new Set(SCENARIO_TEMPLATES.map(template => template.id))

/* ────────────────────────────────  dealing  ──────────────────────────────── */

function fullDeck(): Card[] {
  const deck: Card[] = []
  for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push({ r, s })
  return deck
}

function weighted<T extends { weight: number }>(rng: () => number, items: readonly T[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  let roll = rng() * total
  for (const item of items) {
    roll -= item.weight
    if (roll < 0) return item
  }
  return items[items.length - 1]
}

/**
 * Deal a spot, reproducibly.
 *
 * Assumes `seed` is any number (omitted means a fresh random one) and that
 * `templateId`, when given, is one of `SCENARIO_TEMPLATES`. The seed alone picks
 * the template and the street it starts on; passing `templateId` overrides only
 * the template, so a link made when the odds were different still opens the
 * same hand. If the spot costs more than `PT_MAX_RANGE_WORK` to count exactly,
 * the street is widened (flop, then turn, then river) and the spot is dealt
 * again, so a river spot is the last resort and always affordable.
 */
export function dealSpot(seed?: number, templateId?: string): { spot: Spot; seed: number } {
  const dealt = (seed === undefined || !Number.isFinite(seed) ? randomSeed() : seed) >>> 0
  const chooser = seededRng(dealt)
  const rolled = weighted(chooser, SCENARIO_TEMPLATES)
  const template = templateId === undefined ? rolled : SCENARIO_TEMPLATES.find(t => t.id === templateId)
  if (!template) throw new Error('That scenario does not exist.')
  let left = chooser() * template.streets.reduce((a, b) => a + b, 0)
  let streetIndex = 2
  for (let i = 0; i < 3; i++) {
    left -= template.streets[i]
    if (left < 0) { streetIndex = i; break }
  }

  const deck = shuffle(fullDeck(), seededRng(dealt ^ 0x9e3779b9))
  for (;; streetIndex++) {
    const spot = template.build(seededRng((dealt + 0x7f4a7c15 + streetIndex) >>> 0), deck, STREETS[streetIndex])
    if (streetIndex === 2 || spotWork(spot) <= PT_MAX_RANGE_WORK) return { spot, seed: dealt }
  }
}

/* ───────────────────────────────  permalinks  ─────────────────────────────── */

/**
 * The text of a permalink for a dealt spot: `<templateId>.<seed in base 36>`.
 *
 * Assumes the spot came from `dealSpot` with this `seed`. A shared spot is its
 * seed and nothing else, so a link cannot carry a hand the engine did not deal.
 * A legacy `custom` spot has no seed and cannot be encoded this way.
 */
export function encodeSpot(spot: Spot, seed: number): string {
  if (!TEMPLATE_IDS.has(spot.templateId)) throw new Error('Only dealt spots can be turned into a link.')
  return `${spot.templateId}.${(seed >>> 0).toString(36)}`
}

const MAX_LINK_LENGTH = 120

/** Cards written like `AsKd` or `As Kd` or `As,Kd`; anything else is ignored, as the old links did. */
function parseCardList(text: string): Card[] | null {
  const found = text.match(/(?:10|[2-9tjqka])[cdhs]/gi)
  if (!found) return []
  const cards: Card[] = []
  for (const token of found) {
    const lower = token.toLowerCase()
    const rankText = lower.slice(0, -1)
    const suit = lower.slice(-1) as Card['s']
    const rank = rankText === 'a' ? 14 : rankText === 'k' ? 13 : rankText === 'q' ? 12
      : rankText === 'j' ? 11 : rankText === 't' || rankText === '10' ? 10 : Number(rankText)
    if (!(rank >= 2 && rank <= 14) || !SUITS.includes(suit)) return null
    cards.push({ r: rank, s: suit })
  }
  return cards
}

function clampNumber(raw: string | undefined, lo: number, hi: number, fallback: number): number {
  const value = Number(raw)
  if (!raw || !Number.isFinite(value) || value === 0) return fallback
  return Math.max(lo, Math.min(hi, Math.round(value)))
}

/**
 * Open an old-style link: hero, board, pot, bet and a range id.
 *
 * The original trainer wrote `?spot=hero:board:pot:bet:range` (or the same with
 * dashes, or as separate `hero`, `board`, `pot`, `bet`, `range` parameters), and
 * those links are still out there. They become a `custom` spot: one opponent
 * holding the preset's whole range with no narrowing, a pot and bet as given
 * (pot 10 to 1000, bet 5 to 1000), and no seed. Returns null for a hand that is
 * not two cards, a board that is not three to five, a repeated card, or a range
 * whose every hand is blocked. A range id that is not a preset falls back to the
 * first preset, as the old links did.
 */
export function decodeLegacySpot(parts: {
  hero?: string
  board?: string
  pot?: string
  bet?: string
  range?: string
}): { spot: Spot; seed: null } | null {
  const lengths = [parts.hero, parts.board, parts.pot, parts.bet, parts.range].map(v => (v ?? '').length)
  if (lengths.some(n => n > 60)) return null
  const hero = parseCardList(parts.hero ?? '')
  const board = parseCardList(parts.board ?? '')
  if (!hero || !board || hero.length !== 2 || board.length < 3 || board.length > 5) return null
  const keys = new Set([...hero, ...board].map(card => `${card.r}${card.s}`))
  if (keys.size !== hero.length + board.length) return null

  const preset = PRESET_RANGES.find(range => range.id === (parts.range ?? '')) ?? PRESET_RANGES[0]
  const combos = cachedRangeCombos(preset.text, [...hero, ...board]).combos
  if (combos.length === 0) return null

  const pot = clampNumber(parts.pot, 10, 1000, 100)
  const bet = clampNumber(parts.bet, 5, 1000, 50)
  const street = STREETS[board.length - 3]
  const villain: Position = preset.id === 'bb-defend' ? 'BB' : preset.id === 'three-bet' ? 'SB'
    : preset.id === 'btn' ? 'BTN' : preset.id === 'co' || preset.id === 'call-3bet' ? 'CO' : 'UTG'
  const heroPosition: Position = villain === 'BTN' ? 'CO' : 'BTN'
  const betTone = toneForSize(bet, pot)
  const ledgerText = `The pot is ${chips(pot)}.`
  const spot: Spot = {
    templateId: 'custom',
    title: 'Shared spot',
    blinds: { sb: SMALL_BLIND, bb: BIG_BLIND },
    effectiveStack: Math.max(START_STACK, bet * 4),
    heroPosition,
    hero,
    board,
    street,
    opponents: [{
      position: villain,
      rangeId: preset.id,
      rangeLabel: preset.label,
      preflopCombos: combos,
      combos,
      rangeNote: `${preset.note} This link does not narrow their range for the size of the bet.`,
      role: 'bettor',
    }],
    potBefore: pot,
    heroIn: 0,
    bet,
    callersIn: 0,
    betTone,
    allIn: false,
    line: [
      `The pot is ${chips(pot)} on the ${street}.`,
      `Your opponent, who plays ${preset.label.toLowerCase()}, bets ${chips(bet)}, which is ${percent(bet, pot)}% of the pot.`,
    ],
    ledger: [{ who: 'Pot', chips: pot, what: ledgerText }],
  }
  return { spot, seed: null }
}

/**
 * Rebuild a spot from permalink text.
 *
 * Assumes nothing about `text`; it is whatever the address bar held. Accepts
 * `<templateId>.<seed>` (a base-36 seed up to 32 bits and a known template) and
 * the old `hero:board:pot:bet:range` form. The new form re-deals the spot from
 * its seed, so the result is the spot that was shared. Returns null for
 * anything malformed, too long, unknown or out of range.
 */
export function decodeSpot(text: string): { spot: Spot; seed: number | null } | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_LINK_LENGTH) return null
  const fresh = /^([a-z][a-z0-9-]{0,30})\.([0-9a-z]{1,7})$/.exec(text)
  if (fresh) {
    if (!TEMPLATE_IDS.has(fresh[1])) return null
    const seed = parseInt(fresh[2], 36)
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null
    return dealSpot(seed, fresh[1])
  }
  if (!/^[0-9a-zA-Z:,\- ]+$/.test(text)) return null
  const pieces = text.split(text.includes(':') ? ':' : '-')
  if (pieces.length < 2 || pieces.length > 5) return null
  return decodeLegacySpot({ hero: pieces[0], board: pieces[1], pot: pieces[2], bet: pieces[3], range: pieces[4] })
}
