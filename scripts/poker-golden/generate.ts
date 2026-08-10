/**
 * Golden fixture generator — Snap Call poker engine port.
 *
 * Drives the reviewed TS poker engine (src/components/games/poker/engine/)
 * through ~500 deterministic single-hand games and records (seed, config,
 * actions, expected end-state) so the Kotlin port can replay each action
 * list against its own engine and assert it lands on the identical result.
 * This is the same replay-determinism invariant engine.selfcheck.ts already
 * proves for the oracle itself (see runReplayCheck there) — these fixtures
 * are just instances of it, persisted to disk.
 *
 * Three independently-reseeded RNG streams per game, mirroring the exact
 * convention engine.selfcheck.ts's runReplayCheck already uses:
 *   - a "config" stream, consumed for stack jitter only, then discarded
 *   - a FRESH seededRng(seed) handed to startHand() for the deck shuffle
 *     (fresh, so the deck never depends on how many config draws happened)
 *   - seededRng(seed ^ 0x9e3779b9) for bot decisions during play
 *
 * Bot decisions are the REAL bots.ts decide() — it already accepts an
 * injectable rng (BotDecisionInput.rng), so driving it with a seeded stream
 * is fully deterministic for free; no second/simplified bot policy needed.
 * One exception: chooseAction() FORCES a raise whenever a short-all-in
 * (below the current min-raise increment) is legally available, so the
 * fixtures always cover the rule that this raise does not reopen betting.
 *
 * Run:
 *   npx tsx scripts/poker-golden/generate.ts
 *
 * Output:
 *   scripts/poker-golden/fixtures/
 *     golden-000.json .. golden-009.json (~50 games each) + manifest.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { startHand, legalActions, applyAction, botInputFor } from '../../src/components/games/poker/engine/engine'
import { seededRng } from '../../src/components/games/poker/engine/cards'
import { decide } from '../../src/components/games/poker/engine/bots'
import { VARIANTS, BOT_PERSONALITIES } from '../../src/components/games/poker/engine/types'
import type { Action, ActionRequest, GameState, VariantId, BotPersonality } from '../../src/components/games/poker/engine/types'

const GENERATOR_VERSION = '1.0.0'
const TOTAL_GAMES = 500
const GAMES_PER_FILE = 50

const HERE = import.meta.dirname
const PORTFOLIO_ROOT = path.resolve(HERE, '../..')
const OUT_DIR = path.join(HERE, 'fixtures')

/* ─────────────────────────── config sweep ─────────────────────────── */

type StackProfile = 'deep' | 'short' | 'mixed'
const STACK_PROFILES: StackProfile[] = ['deep', 'short', 'mixed']
const VARIANT_CYCLE: VariantId[] = ['holdem', 'holdem', 'holdem', 'holdem', 'holdem', 'omaha', 'bomb']
const BLIND_TIERS = [
  { sb: 5, bb: 10 }, { sb: 10, bb: 20 }, { sb: 25, bb: 50 }, { sb: 50, bb: 100 },
]
// Staggered all-in tiers (x big blind) for the 'mixed' profile — deliberately
// spans sub-blind through deep so 6-9 player 'mixed' games reliably stack up
// 3+ distinct all-in layers (3+ side pots).
const MIXED_TIERS = [0.4, 1.5, 4, 10, 25, 55, 100, 160, 240]

function configFor(gameIndex: number) {
  const playerCount = 2 + (gameIndex % 8) // cycles 2..9, even coverage
  const variant = VARIANT_CYCLE[gameIndex % VARIANT_CYCLE.length]
  const profile = STACK_PROFILES[gameIndex % STACK_PROFILES.length]
  const blinds = BLIND_TIERS[gameIndex % BLIND_TIERS.length]
  const ante = gameIndex % 4 === 0 ? blinds.bb / 2 : 0
  const buttonSeat = gameIndex % playerCount
  return { playerCount, variant, profile, blinds, ante, buttonSeat }
}

function buildStacks(profile: StackProfile, n: number, bb: number, rng: () => number): number[] {
  if (profile === 'deep') {
    return Array.from({ length: n }, () => Math.round(bb * (60 + rng() * 90))) // ~60-150x BB
  }
  if (profile === 'short') {
    // every 3rd seat is forced sub-blind (< 1 BB); rest are 1-4x BB
    return Array.from({ length: n }, (_, i) =>
      i % 3 === 0
        ? Math.max(1, Math.round(bb * (0.25 + rng() * 0.5)))
        : Math.max(1, Math.round(bb * (1 + rng() * 3)))
    )
  }
  return Array.from({ length: n }, (_, i) =>
    Math.max(1, Math.round(bb * MIXED_TIERS[i % MIXED_TIERS.length] * (0.85 + rng() * 0.3)))
  )
}

function personalityFor(seatIndex: number, gameIndex: number): BotPersonality {
  return BOT_PERSONALITIES[(seatIndex + gameIndex) % BOT_PERSONALITIES.length]
}

/* ───────────────────────── action selection ───────────────────────── */

/**
 * Real bot logic (bots.ts decide()), driven by a seeded rng so equity
 * estimation + sizing + bluff rolls are fully deterministic.
 *
 * FORCE: when a raise is legally available but the raiser's whole stack
 * can't reach a full min-raise (maxRaiseTo - betToMatch < minRaise), force
 * the raise instead of leaving it to the bot's equity judgement — the only
 * reliable way to guarantee fixture coverage of that narrow scenario.
 */
function chooseAction(s: GameState, req: ActionRequest, actRng: () => number, forceShortAllInRaise: boolean): Action {
  if (forceShortAllInRaise) return { type: 'raise', amount: req.maxRaiseTo }
  const input = botInputFor(s)!
  input.rng = actRng
  const d = decide(input)
  return d.action === 'bet' || d.action === 'raise' ? { type: d.action, amount: d.amountTo } : { type: d.action }
}

/* ──────────────────────────── generation ───────────────────────────── */

const games: any[] = []
const subMinRaiseAllInSeeds: number[] = []
const counters = {
  byPlayerCount: {} as Record<number, number>,
  byVariant: {} as Record<string, number>,
  allInGames: 0,
  sidePotGames: 0,
  threePlusPotGames: 0,
  splitPotGames: 0,
  oddChipGames: 0,
  subMinRaiseAllInGames: 0,
  uncontestedGames: 0,
  orphanedPotSafetyNetGames: 0,
}

for (let gameIndex = 0; gameIndex < TOTAL_GAMES; gameIndex++) {
  const seed = gameIndex + 1
  const { playerCount, variant: variantId, profile, blinds, ante, buttonSeat } = configFor(gameIndex)
  const variant = VARIANTS[variantId]

  const configRng = seededRng(seed) // consumed for stack jitter only, then discarded
  const stacks = buildStacks(profile, playerCount, blinds.bb, configRng)
  const seats = stacks.map((chips, i) => ({
    index: i, kind: 'bot' as const, name: `P${i + 1}`, chips, personality: personalityFor(i, gameIndex),
  }))

  const dealRng = seededRng(seed) // fresh restart from the same seed — deck shuffle never depends on config-draw count
  const actRng = seededRng(seed ^ 0x9e3779b9)
  const state = startHand({
    seats, variant, smallBlind: blinds.sb, bigBlind: blinds.bb, ante, buttonSeat, handNumber: seed, rng: dealRng,
  })

  const actions: Action[] = []
  let hitShortAllInRaise = false
  let guard = 0
  while (!state.complete) {
    const req = legalActions(state)
    if (!req) break
    const shortAllInRaiseOpportunity = req.canRaise && req.maxRaiseTo - state.betToMatch < state.minRaise
    const a = chooseAction(state, req, actRng, shortAllInRaiseOpportunity)
    if (shortAllInRaiseOpportunity) hitShortAllInRaise = true
    actions.push(a)
    applyAction(state, a)
    if (++guard > 5000) throw new Error(`generator seed ${seed}: betting never terminated`)
  }
  if (!state.complete) throw new Error(`generator seed ${seed}: hand did not complete`)

  const anyAllIn = state.players.some(p => p.allIn)
  const sidePot = state.pots.length > 1
  const threePlusPots = state.pots.length >= 3
  const winnersByPot = new Map<number, typeof state.winners>()
  for (const w of state.winners) winnersByPot.set(w.potIndex, [...(winnersByPot.get(w.potIndex) ?? []), w])
  let splitPot = false
  let oddChip = false
  for (const list of winnersByPot.values()) {
    if (list.length > 1) {
      splitPot = true
      if (new Set(list.map(w => w.amount)).size > 1) oddChip = true
    }
  }
  const uncontested = state.street === 'handover'
  const orphanedPotSafetyNet = state.winners.some(w => w.potIndex === -1)

  counters.byPlayerCount[playerCount] = (counters.byPlayerCount[playerCount] ?? 0) + 1
  counters.byVariant[variantId] = (counters.byVariant[variantId] ?? 0) + 1
  if (anyAllIn) counters.allInGames++
  if (sidePot) counters.sidePotGames++
  if (threePlusPots) counters.threePlusPotGames++
  if (splitPot) counters.splitPotGames++
  if (oddChip) counters.oddChipGames++
  if (hitShortAllInRaise) {
    counters.subMinRaiseAllInGames++
    subMinRaiseAllInSeeds.push(seed)
  }
  if (uncontested) counters.uncontestedGames++
  if (orphanedPotSafetyNet) counters.orphanedPotSafetyNetGames++

  games.push({
    seed,
    config: {
      variant: variantId, players: playerCount, stacks,
      smallBlind: blinds.sb, bigBlind: blinds.bb, ante, buttonSeat, handNumber: seed,
    },
    actions,
    expected: {
      finalStacks: stacks.map((_, i) => state.stacks[i] ?? 0),
      winners: state.winners.map(w => ({ seat: w.seatIndex, amount: w.amount, potIndex: w.potIndex, rank: w.rank })),
      board: state.board,
      holeCards: state.players.map(p => ({ seat: p.seatIndex, hole: p.hole })),
      potsPerHand: state.pots,
      street: state.street,
    },
  })
}

/* ───────────────────────────── write out ───────────────────────────── */

mkdirSync(OUT_DIR, { recursive: true })
const files: { name: string; games: number }[] = []
for (let f = 0; f * GAMES_PER_FILE < games.length; f++) {
  const chunk = games.slice(f * GAMES_PER_FILE, (f + 1) * GAMES_PER_FILE)
  const name = `golden-${String(f).padStart(3, '0')}.json`
  writeFileSync(path.join(OUT_DIR, name), JSON.stringify(chunk, null, 2) + '\n')
  files.push({ name, games: chunk.length })
}

const oracleCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: PORTFOLIO_ROOT }).toString().trim()

const manifest = {
  generatorVersion: GENERATOR_VERSION,
  oracleCommit,
  totalGames: games.length,
  totalHands: games.length,
  note: 'One "game" == one single hand (fresh startHand() call); player count/variant/stacks/blinds/button are swept per game, not carried across games as a session.',
  deckSeeding: "startHand() was called with rng = seededRng(seed) (mulberry32, see cards.ts), a FRESH stream re-seeded from the fixture's top-level `seed`. The Kotlin port must implement the identical mulberry32 PRNG and the identical Fisher-Yates shuffle order to reproduce the same deck before replaying `actions`. Burn cards are intentionally not recorded (functionally inert); `holeCards` + `board` together already expose every dealt card that affects the outcome.",
  replayContract: "To validate a fixture: build the same seat/variant/blind config from `config`, call startHand with rng=seededRng(seed), then applyAction() through `actions` in order, then compare finalStacks/winners/board/holeCards/potsPerHand/street against `expected`. This is the same (seed, actions) -> identical-projection invariant engine.selfcheck.ts's runReplayCheck already proves for the oracle itself.",
  byPlayerCount: counters.byPlayerCount,
  byVariant: counters.byVariant,
  edgeCaseCoverage: {
    allInGames: counters.allInGames,
    sidePotGames: counters.sidePotGames,
    threePlusPotGames: counters.threePlusPotGames,
    splitPotGames: counters.splitPotGames,
    oddChipGames: counters.oddChipGames,
    subMinRaiseAllInGames: counters.subMinRaiseAllInGames,
    uncontestedGames: counters.uncontestedGames,
    orphanedPotSafetyNetGames: counters.orphanedPotSafetyNetGames,
  },
  edgeCaseFixtureSeeds: {
    subMinRaiseAllIn: subMinRaiseAllInSeeds,
  },
  files,
}
writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

console.log(`wrote ${games.length} games across ${files.length} files to ${OUT_DIR}`)
console.log(JSON.stringify({ byPlayerCount: counters.byPlayerCount, byVariant: counters.byVariant, edgeCaseCoverage: manifest.edgeCaseCoverage }, null, 2))
