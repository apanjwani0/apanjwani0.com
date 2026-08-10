/**
 * engine.selfcheck.ts — money-conservation self-check for the poker engine.
 *
 * NOT part of the build, runtime, or any test suite (the repo's gate is
 * `npm run build`). Run ad-hoc to prove the engine never creates or loses a
 * chip across thousands of randomised hands — the invariant the whole
 * money-persistent design rests on:
 *
 *   npx tsx src/components/games/poker/engine/engine.selfcheck.ts
 *
 * Throws (non-zero exit) on the first hand whose chips don't balance, printing
 * the seed so the failing hand is reproducible.
 */
import { startHand, legalActions, applyAction } from './engine'
import { seededRng } from './cards'
import { VARIANTS } from './types'
import type { VariantId, Action, ActionRequest, GameState } from './types'

function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1))
}

/** pick a random *legal* action so we walk the whole state space, all-ins included */
function randomLegalAction(req: ActionRequest, rng: () => number): Action {
  const roll = rng()
  if (req.toCall > 0 && roll < 0.12) return { type: 'fold' }
  if ((req.canBet || req.canRaise) && roll < 0.5) {
    return { type: req.canBet ? 'bet' : 'raise', amount: randInt(rng, Math.min(req.minRaiseTo, req.maxRaiseTo), req.maxRaiseTo) }
  }
  return req.canCheck ? { type: 'check' } : { type: 'call' }
}

export function runConservationCheck(hands = 20000): number {
  const variantIds = Object.keys(VARIANTS) as VariantId[]
  for (let h = 0; h < hands; h++) {
    const seed = h + 1
    const rng = seededRng(seed)
    const variant = VARIANTS[variantIds[randInt(rng, 0, variantIds.length - 1)]]
    const seatCount = randInt(rng, 2, variant.maxSeats)
    // uneven stacks (25..1000) so multi-way all-ins and layered side pots happen often
    const seats = Array.from({ length: seatCount }, (_, i) => ({
      index: i, kind: 'bot' as const, name: `P${i + 1}`, chips: randInt(rng, 1, 40) * 25,
    }))
    const before = seats.reduce((a, s) => a + s.chips, 0)
    const state = startHand({
      seats, variant, smallBlind: 10, bigBlind: 20,
      ante: rng() < 0.3 ? 20 : 0, buttonSeat: randInt(rng, 0, seatCount - 1), handNumber: seed, rng,
    })
    let guard = 0
    while (!state.complete) {
      const req = legalActions(state)
      if (!req) break
      applyAction(state, randomLegalAction(req, rng))
      if (++guard > 5000) throw new Error(`hand seed ${seed}: betting never terminated`)
    }
    const after = Object.values(state.stacks).reduce((a, n) => a + n, 0)
    if (after !== before) {
      throw new Error(`CONSERVATION VIOLATED — hand seed ${seed} (${variant.name}, ${seatCount} seats): ${before} chips in, ${after} out (leak ${before - after})`)
    }
  }
  return hands
}

/* ── money-relevant projection: everything a peer must agree on, minus wall-clock
   noise (log timestamps) that legitimately differs between two runs ── */
function projection(s: GameState): string {
  return JSON.stringify({
    stacks: s.stacks,
    board: s.board,
    complete: s.complete,
    street: s.street,
    winners: s.winners.map(w => [w.seatIndex, w.amount]),
    players: s.players.map(p => [p.seatIndex, p.hole, p.folded, p.allIn, p.totalCommitted]),
    pots: s.pots.map(p => p.amount),
  })
}

/**
 * Replay determinism — the invariant peer-replicated multiplayer rests on: a hand
 * is fully reproduced from (seed, action list) alone, so every peer replaying the
 * shared log lands on the identical, chip-conserved table (docs/poker-multiplayer.md).
 *
 * Each hand is driven once "authoritatively", RECORDING the concrete actions; then
 * a fresh hand is started from the same seed and the recorded actions are replayed.
 * The money-relevant projections must match exactly.
 */
export function runReplayCheck(hands = 20000): number {
  const variantIds = Object.keys(VARIANTS) as VariantId[]
  for (let h = 0; h < hands; h++) {
    const seed = h + 1
    const setup = seededRng(seed)
    const variant = VARIANTS[variantIds[randInt(setup, 0, variantIds.length - 1)]]
    const seatCount = randInt(setup, 2, variant.maxSeats)
    const seats = Array.from({ length: seatCount }, (_, i) => ({
      index: i, kind: 'bot' as const, name: `P${i + 1}`, chips: randInt(setup, 1, 40) * 25,
    }))
    const opts = {
      seats, variant, smallBlind: 10, bigBlind: 20,
      ante: setup() < 0.3 ? 20 : 0, buttonSeat: randInt(setup, 0, seatCount - 1), handNumber: seed,
    }

    // authoritative run — actions chosen by a distinct rng, and recorded verbatim
    const actRng = seededRng(seed ^ 0x9e3779b9)
    const authoritative = startHand({ ...opts, rng: seededRng(seed) })
    const recorded: Action[] = []
    let guard = 0
    while (!authoritative.complete) {
      const req = legalActions(authoritative)
      if (!req) break
      const a = randomLegalAction(req, actRng)
      recorded.push(a)
      applyAction(authoritative, a)
      if (++guard > 5000) throw new Error(`replay seed ${seed}: betting never terminated`)
    }

    // replay run — same seed (→ same deck) + the recorded actions only
    const replay = startHand({ ...opts, rng: seededRng(seed) })
    for (const a of recorded) applyAction(replay, a)

    if (projection(authoritative) !== projection(replay)) {
      throw new Error(`REPLAY DIVERGED — hand seed ${seed} (${variant.name}, ${seatCount} seats)`)
    }
    const before = seats.reduce((sum, s) => sum + s.chips, 0)
    const after = Object.values(replay.stacks).reduce((sum, n) => sum + n, 0)
    if (after !== before) throw new Error(`REPLAY CONSERVATION VIOLATED — seed ${seed}: ${before} in, ${after} out`)
  }
  return hands
}

/** A short all-in raise must allow calls without reopening a completed action. */
export function runShortAllInReopenCheck(): void {
  const state = startHand({
    seats: [
      { index: 0, kind: 'bot', name: 'Button', chips: 1000 },
      { index: 1, kind: 'bot', name: 'Small blind', chips: 1000 },
      { index: 2, kind: 'bot', name: 'Big blind', chips: 130 },
    ],
    variant: VARIANTS.holdem,
    smallBlind: 10,
    bigBlind: 20,
    ante: 0,
    buttonSeat: 0,
    handNumber: 1,
    rng: seededRng(1),
  })

  applyAction(state, { type: 'raise', amount: 100 })
  applyAction(state, { type: 'call' })
  applyAction(state, { type: 'raise', amount: 130 })

  const buttonRequest = legalActions(state)
  if (!buttonRequest || buttonRequest.seatIndex !== 0 || buttonRequest.toCall !== 30 || buttonRequest.canRaise) {
    throw new Error('SHORT ALL-IN REOPEN VIOLATED — button should only be able to call or fold')
  }
  const snapshot = projection(state)
  applyAction(state, { type: 'raise', amount: 300 })
  if (projection(state) !== snapshot) {
    throw new Error('SHORT ALL-IN REOPEN VIOLATED — an illegal re-raise changed state')
  }

  applyAction(state, { type: 'call' })
  const smallBlindRequest = legalActions(state)
  if (!smallBlindRequest || smallBlindRequest.seatIndex !== 1 || smallBlindRequest.toCall !== 30 || smallBlindRequest.canRaise) {
    throw new Error('SHORT ALL-IN REOPEN VIOLATED — small blind should only be able to call or fold')
  }
}

// Run when invoked directly (tsx/node), stay silent when imported.
// import.meta.main is set by tsx/bun; fall back to a filename check for node.
const invokedDirectly =
  (import.meta as unknown as { main?: boolean }).main === true ||
  (typeof process !== 'undefined' && process.argv[1]?.endsWith('engine.selfcheck.ts'))
if (invokedDirectly) {
  runShortAllInReopenCheck()
  console.log('✓ short all-in raises do not reopen completed action')
  const c = runConservationCheck()
  console.log(`✓ chip conservation holds across ${c} random hands`)
  const r = runReplayCheck()
  console.log(`✓ log-replay is deterministic + conserved across ${r} random hands`)
}
