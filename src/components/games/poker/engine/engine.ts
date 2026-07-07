/**
 * Engine — the betting/state machine for one hand of poker.
 *
 * Supports Texas Hold'em, Omaha (exactly-2 evaluation) and Bomb Pot (ante,
 * no preflop, straight to the flop). Handles blinds/antes, all four streets,
 * all-ins, side pots, uncontested wins, and showdown with correct pot
 * distribution. All chips are integer play-money.
 *
 * The state object (GameState) is authoritative and mutated in place; each
 * public function returns the same object for convenience. The orchestrator is
 * responsible for pacing (bot think-time, animations) — the engine itself is
 * synchronous and deterministic given its inputs.
 */

import type {
  GameState, PlayerHand, VariantConfig, SeatKind, BotPersonality,
  Action, ActionRequest, BotDecisionInput, HandRank,
} from './types'
import { RANK_LABEL, SUIT_SYMBOL, clamp } from './types'
import { makeDeck, shuffle, cardLabel } from './cards'
import { evaluateBest, evaluateOmaha, compareRank } from './evaluator'

export interface StartSeat {
  index: number
  kind: SeatKind
  name: string
  chips: number
  personality?: BotPersonality
}

export interface StartOpts {
  seats: StartSeat[]
  variant: VariantConfig
  smallBlind: number
  bigBlind: number
  ante: number
  /** seat index that holds the button this hand */
  buttonSeat: number
  handNumber: number
  rng?: () => number
}

/* ─────────────────────────── helpers ─────────────────────────── */

function stack(s: GameState, seat: number): number {
  return s.stacks[seat] ?? 0
}
function idxOfSeat(s: GameState, seat: number): number {
  return s.players.findIndex(p => p.seatIndex === seat)
}
function log(s: GameState, kind: 'action' | 'system' | 'showdown' | 'deal', text: string) {
  s.log.push({ t: Date.now(), kind, text })
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200)
}
function potTotal(s: GameState): number {
  let sum = 0
  for (const p of s.players) sum += p.totalCommitted
  return sum
}
function name(s: GameState, seat: number): string {
  return s.seatMeta[seat]?.name ?? `Seat ${seat + 1}`
}
/** move `amt` chips from a seat's stack into its wager */
function commit(s: GameState, p: PlayerHand, amt: number) {
  const real = Math.min(amt, stack(s, p.seatIndex))
  s.stacks[p.seatIndex] -= real
  p.committed += real
  p.totalCommitted += real
  if (stack(s, p.seatIndex) === 0) p.allIn = true
}

/* ─────────────────────────── start ───────────────────────────── */

export function startHand(o: StartOpts): GameState {
  const deck = shuffle(makeDeck(), o.rng)
  const seated = o.seats
    .filter(s => (s.kind === 'human' || s.kind === 'bot') && s.chips > 0)
    .sort((a, b) => a.index - b.index)

  const players: PlayerHand[] = seated.map(s => ({
    seatIndex: s.index, hole: [], folded: false, allIn: false,
    committed: 0, totalCommitted: 0, actedThisRound: false,
  }))
  const stacks: Record<number, number> = {}
  const seatMeta: GameState['seatMeta'] = {}
  for (const s of seated) {
    stacks[s.index] = s.chips
    seatMeta[s.index] = { name: s.name, kind: s.kind, personality: s.personality }
  }

  const s: GameState = {
    config: { variant: o.variant, smallBlind: o.smallBlind, bigBlind: o.bigBlind, ante: o.ante },
    players, seatMeta, stacks,
    board: [], deck, burn: [],
    street: 'preflop', buttonSeat: 0, toActSeat: -1,
    betToMatch: 0, minRaise: o.bigBlind, lastAggressorSeat: -1,
    pots: [], handNumber: o.handNumber, log: [], winners: [], complete: false,
  }

  const n = players.length
  let bIdx = players.findIndex(p => p.seatIndex === o.buttonSeat)
  if (bIdx < 0) bIdx = 0
  s.buttonSeat = players[bIdx].seatIndex

  log(s, 'system', `Hand #${o.handNumber} — ${o.variant.name}. Dealer: ${name(s, s.buttonSeat)}.`)

  // deal hole cards
  for (let c = 0; c < o.variant.holeCards; c++) {
    for (const p of players) p.hole.push(deck.pop() as import('./types').Card)
  }

  // antes
  if (o.ante > 0 || o.variant.bombPot) {
    const anteAmt = o.variant.bombPot ? (o.ante > 0 ? o.ante : o.bigBlind) : o.ante
    for (const p of players) {
      const real = Math.min(anteAmt, stack(s, p.seatIndex))
      s.stacks[p.seatIndex] -= real
      p.totalCommitted += real // ante is dead money — pot only, not a street wager
    }
    log(s, 'system', `Everyone antes ${anteAmt}.`)
  }

  if (o.variant.bombPot) {
    // no preflop — deal the flop and open betting there
    s.street = 'flop'
    s.board.push(deck.pop() as any, deck.pop() as any, deck.pop() as any)
    log(s, 'deal', `Bomb pot flop: ${s.board.map(cardLabel).join(' ')}`)
    s.betToMatch = 0
    s.minRaise = o.bigBlind
    s.toActSeat = firstActionableAfter(s, bIdx)
  } else {
    // blinds (heads-up: button posts SB and acts first preflop)
    const sbIdx = n === 2 ? bIdx : (bIdx + 1) % n
    const bbIdx = n === 2 ? (bIdx + 1) % n : (bIdx + 2) % n
    postBlind(s, players[sbIdx], o.smallBlind, 'small blind')
    postBlind(s, players[bbIdx], o.bigBlind, 'big blind')
    s.betToMatch = Math.max(players[sbIdx].committed, players[bbIdx].committed)
    s.minRaise = o.bigBlind
    const firstIdx = n === 2 ? sbIdx : (bbIdx + 1) % n
    s.toActSeat = firstActionableFrom(s, firstIdx)
  }

  // if nobody can act (everyone all-in from blinds/antes), run it out
  if (s.toActSeat < 0) progressStreet(s)
  return s
}

function postBlind(s: GameState, p: PlayerHand, amt: number, label: string) {
  commit(s, p, amt)
  log(s, 'action', `${name(s, p.seatIndex)} posts ${label} ${p.committed}${p.allIn ? ' (all in)' : ''}.`)
}

/** first player who can act (non-folded, non-all-in) scanning from array index `from` inclusive */
function firstActionableFrom(s: GameState, from: number): number {
  const n = s.players.length
  for (let k = 0; k < n; k++) {
    const p = s.players[(from + k) % n]
    if (!p.folded && !p.allIn) return p.seatIndex
  }
  return -1
}
/** first actionable AFTER array index `afterIdx` (used for postflop, first left of button) */
function firstActionableAfter(s: GameState, afterIdx: number): number {
  return firstActionableFrom(s, (afterIdx + 1) % s.players.length)
}

/* ───────────────────────── legal actions ─────────────────────── */

export function legalActions(s: GameState): ActionRequest | null {
  if (s.complete || s.toActSeat < 0) return null
  const p = s.players[idxOfSeat(s, s.toActSeat)]
  const myStack = stack(s, p.seatIndex)
  const toCall = Math.max(0, s.betToMatch - p.committed)
  const maxRaiseTo = p.committed + myStack
  const canCheck = toCall === 0
  const canBet = s.betToMatch === 0 && myStack > 0
  const canRaise = s.betToMatch > 0 && myStack > toCall
  let minRaiseTo = s.betToMatch === 0
    ? Math.min(s.config.bigBlind, maxRaiseTo)
    : s.betToMatch + s.minRaise
  minRaiseTo = Math.min(minRaiseTo, maxRaiseTo)
  return {
    seatIndex: p.seatIndex, toCall, canCheck, canBet, canRaise,
    minRaiseTo, maxRaiseTo, pot: potTotal(s), bigBlind: s.config.bigBlind,
  }
}

/* ─────────────────────────── apply ───────────────────────────── */

export function applyAction(s: GameState, a: Action): GameState {
  const req = legalActions(s)
  if (!req) return s
  const p = s.players[idxOfSeat(s, s.toActSeat)]
  let aggressed = false

  if (a.type === 'fold') {
    p.folded = true
    p.lastAction = 'fold'
    log(s, 'action', `${name(s, p.seatIndex)} folds.`)
  } else if (a.type === 'check' && req.canCheck) {
    p.lastAction = 'check'
    log(s, 'action', `${name(s, p.seatIndex)} checks.`)
  } else if (a.type === 'call' || (a.type === 'check' && !req.canCheck)) {
    commit(s, p, req.toCall)
    p.lastAction = 'call'
    log(s, 'action', `${name(s, p.seatIndex)} calls ${req.toCall}${p.allIn ? ' (all in)' : ''}.`)
  } else if (a.type === 'bet' || a.type === 'raise') {
    // clamp requested total into the legal window; an all-in below min is allowed
    let target = a.amount ?? req.minRaiseTo
    target = clamp(target, Math.min(req.minRaiseTo, req.maxRaiseTo), req.maxRaiseTo)
    const inc = target - s.betToMatch
    commit(s, p, target - p.committed)
    if (target > s.betToMatch) {
      s.minRaise = Math.max(inc, s.config.bigBlind)
      s.betToMatch = target
      s.lastAggressorSeat = p.seatIndex
      aggressed = true
    }
    const verb = req.canBet ? 'bets' : 'raises to'
    p.lastAction = req.canBet ? 'bet' : 'raise'
    log(s, 'action', `${name(s, p.seatIndex)} ${verb} ${target}${p.allIn ? ' (all in)' : ''}.`)
  } else {
    return s // unrecognised / illegal — ignore
  }
  p.lastAmount = p.committed

  // uncontested win?
  const live = s.players.filter(x => !x.folded)
  if (live.length === 1) {
    awardUncontested(s, live[0])
    return s
  }

  advanceAction(s, p, aggressed)
  if (s.toActSeat < 0) progressStreet(s)
  return s
}

function advanceAction(s: GameState, actor: PlayerHand, aggressed: boolean) {
  const n = s.players.length
  actor.actedThisRound = true
  if (aggressed) {
    for (const q of s.players) if (q !== actor && !q.folded && !q.allIn) q.actedThisRound = false
  }
  const cur = idxOfSeat(s, actor.seatIndex)
  for (let k = 1; k <= n; k++) {
    const q = s.players[(cur + k) % n]
    if (q.folded || q.allIn) continue
    if (!q.actedThisRound || q.committed < s.betToMatch) {
      s.toActSeat = q.seatIndex
      return
    }
  }
  s.toActSeat = -1 // betting round settled
}

/* ─────────────────────── street progression ──────────────────── */

const NEXT: Record<string, string> = {
  preflop: 'flop', flop: 'turn', turn: 'river', river: 'showdown',
}

function progressStreet(s: GameState) {
  // reset per-street wagers
  for (const p of s.players) { p.committed = 0; p.actedThisRound = false; p.lastAction = undefined }
  s.betToMatch = 0
  s.minRaise = s.config.bigBlind

  const bIdx = idxOfSeat(s, s.buttonSeat)
  // keep dealing streets until betting is possible or we reach showdown
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = NEXT[s.street] ?? 'showdown'
    s.street = next as GameState['street']
    if (s.street === 'showdown') { settle(s); return }
    dealStreet(s)
    const canAct = s.players.filter(p => !p.folded && !p.allIn).length
    if (canAct >= 2) {
      s.toActSeat = firstActionableAfter(s, bIdx)
      if (s.toActSeat >= 0) return
    }
    // otherwise no betting this street — loop and deal the next
  }
}

function dealStreet(s: GameState) {
  if (s.street === 'flop') {
    s.burn.push(s.deck.pop() as any)
    s.board.push(s.deck.pop() as any, s.deck.pop() as any, s.deck.pop() as any)
  } else if (s.street === 'turn' || s.street === 'river') {
    s.burn.push(s.deck.pop() as any)
    s.board.push(s.deck.pop() as any)
  }
  log(s, 'deal', `${cap(s.street)}: ${s.board.map(cardLabel).join(' ')}`)
}
function cap(x: string) { return x.charAt(0).toUpperCase() + x.slice(1) }

/* ─────────────────────────── settle ──────────────────────────── */

function awardUncontested(s: GameState, winner: PlayerHand) {
  const pot = potTotal(s)
  s.stacks[winner.seatIndex] += pot
  s.winners = [{ seatIndex: winner.seatIndex, amount: pot, potIndex: 0 }]
  s.pots = [{ amount: pot, eligible: [winner.seatIndex] }]
  s.street = 'handover'
  s.toActSeat = -1
  s.complete = true
  log(s, 'system', `${name(s, winner.seatIndex)} wins ${pot} (everyone folded).`)
}

function handRankFor(s: GameState, p: PlayerHand): HandRank {
  return s.config.variant.useHoleExactly === 2
    ? evaluateOmaha(p.hole, s.board)
    : evaluateBest(p.hole.concat(s.board))
}

function settle(s: GameState) {
  s.street = 'showdown'
  s.complete = true
  s.toActSeat = -1

  // build side pots from each player's total contribution
  type C = { seat: number; amt: number; folded: boolean }
  const contribs: C[] = s.players.map(p => ({ seat: p.seatIndex, amt: p.totalCommitted, folded: p.folded }))
  let remaining = contribs.filter(c => c.amt > 0)
  const pots: { amount: number; eligible: number[] }[] = []
  while (remaining.length > 0) {
    const min = Math.min(...remaining.map(c => c.amt))
    let amount = 0
    const eligible: number[] = []
    for (const c of remaining) {
      amount += min
      c.amt -= min
      if (!c.folded) eligible.push(c.seat)
    }
    // merge into previous pot if the eligible set is identical (cleaner display)
    const prev = pots[pots.length - 1]
    if (prev && sameSet(prev.eligible, eligible)) prev.amount += amount
    else pots.push({ amount, eligible })
    remaining = remaining.filter(c => c.amt > 0)
  }
  s.pots = pots

  // pre-compute showdown ranks for eligible (non-folded) players
  const ranks: Record<number, HandRank> = {}
  for (const p of s.players) if (!p.folded) ranks[p.seatIndex] = handRankFor(s, p)

  const winners: GameState['winners'] = []
  const bIdx = idxOfSeat(s, s.buttonSeat)
  const order = orderFromButton(s, bIdx) // seat indices, first to receive odd chips

  pots.forEach((pot, potIndex) => {
    const contenders = pot.eligible.filter(seat => ranks[seat])
    if (contenders.length === 0) return
    let best = contenders[0]
    for (const seat of contenders) if (compareRank(ranks[seat], ranks[best]) > 0) best = seat
    const tied = contenders.filter(seat => compareRank(ranks[seat], ranks[best]) === 0)
    const share = Math.floor(pot.amount / tied.length)
    let remainder = pot.amount - share * tied.length
    // distribute; odd chips go to the earliest seat after the button
    const tiedOrdered = order.filter(seat => tied.includes(seat))
    for (const seat of tiedOrdered) {
      let amt = share
      if (remainder > 0) { amt += 1; remainder-- }
      s.stacks[seat] += amt
      winners.push({ seatIndex: seat, amount: amt, rank: ranks[seat], potIndex })
    }
  })
  s.winners = winners

  const summary = winners
    .map(w => `${name(s, w.seatIndex)} wins ${w.amount} with ${w.rank?.name ?? 'best hand'}`)
    .join('; ')
  log(s, 'showdown', summary || 'Showdown.')
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const sb = new Set(b)
  return a.every(x => sb.has(x))
}
function orderFromButton(s: GameState, bIdx: number): number[] {
  const n = s.players.length
  const out: number[] = []
  for (let k = 1; k <= n; k++) out.push(s.players[(bIdx + k) % n].seatIndex)
  return out
}

/* ─────────────────────── bot input helper ────────────────────── */

export function botInputFor(s: GameState): BotDecisionInput | null {
  const req = legalActions(s)
  if (!req) return null
  const p = s.players[idxOfSeat(s, s.toActSeat)]
  const activeOpponents = s.players.filter(x => !x.folded && x.seatIndex !== p.seatIndex).length
  return {
    variant: s.config.variant,
    hole: p.hole,
    board: s.board,
    toCall: req.toCall,
    pot: req.pot,
    myChips: stack(s, p.seatIndex),
    bigBlind: s.config.bigBlind,
    canCheck: req.canCheck,
    minRaiseTo: req.minRaiseTo,
    maxRaiseTo: req.maxRaiseTo,
    activeOpponents,
    personality: s.seatMeta[p.seatIndex]?.personality ?? 'balanced',
    street: s.street,
  }
}

/** kind of the seat currently to act ('human' | 'bot' | ...), or null. */
export function currentActorKind(s: GameState): SeatKind | null {
  if (s.toActSeat < 0) return null
  return s.seatMeta[s.toActSeat]?.kind ?? null
}

/** convenience: chips as a display string with thousands separators. */
export function fmtChips(n: number): string {
  return n.toLocaleString('en-US')
}

export { RANK_LABEL, SUIT_SYMBOL }
