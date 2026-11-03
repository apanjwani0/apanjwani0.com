/**
 * Poker Trainer — learn, drill, solve.
 *
 * The first version of this was an equity CALCULATOR wearing the word "trainer".
 * It asked you to type in both players' cards and then told you the answer,
 * which is a situation that never occurs at a table and a screen you interact
 * with by doing data entry. Owner's verdict: "I don't know what equity means…
 * current state is bad tbh, not interesting to interact with."
 *
 * Three things changed.
 *
 * 1. **You do not see their cards.** This is the answer to "do all the GTO
 *    trainers show the opponent cards?" — no, and they cannot. A real trainer
 *    shows your hand, the board and the action, you choose, and it grades you
 *    against what the opponent's whole RANGE does. Showing their exact cards
 *    turns every decision into a lookup, which is the one thing poker never
 *    lets you do. The Drill tab hides them; the range is stated instead.
 *
 * 2. **It explains itself.** "Equity" and "GTO" are jargon a curious beginner
 *    does not have, and a tool that assumes them is only usable by people who
 *    do not need it. Every number on screen has a plain-English definition one
 *    click away, and the Learn tab defines the words before you meet them.
 *
 * 3. **Omaha.** Same engine, one rule different — you play EXACTLY two of your
 *    four cards. That rule is where Hold'em players lose money on switching, so
 *    it gets stated wherever it applies rather than assumed.
 *
 * Everything is still enumerated exactly, never sampled. Where a query is too
 * large to enumerate, the tool refuses and says so instead of quietly becoming
 * approximate — see PT_MAX_RANK_WORK here and PT_MAX_RANGE_WORK in engine/scenarios.ts.
 *
 * All module-level names are pt-/PT_-prefixed: game component files share one
 * global script scope.
 */

import {
  callEv,
  countRunouts,
  handClass,
  handsRanked,
  holeCount,
  outsAgainst,
  rangeWork,
  rankHand,
  requiredEquity,
  type MultiwayEquityResult,
  type RangeEquityResult,
  type Variant,
} from './engine/equity'
import {
  cachedEquityVsRange,
  cachedEquityVsRanges,
  cachedExactEquity,
  cachedRangeCombos,
  type ParsedCombos,
} from './engine/equity-cache'
import { MIN_CONTINUING, RIVER_BLUFFS, continuingRange, fallbackSentence, toneForSize, type BetTone } from './engine/continuing'
import {
  RAISE_MARGIN,
  fmtChips,
  fmtPercent,
  judge,
  raiseContinuingCombos,
  raiseModelled,
  raiseTo,
  type Judgement,
} from './engine/decide'
import { PRESET_RANGES } from './engine/ranges'
import {
  PT_MAX_RANGE_WORK,
  SCENARIO_TEMPLATES,
  dealSpot,
  decodeLegacySpot,
  decodeSpot,
  derive,
  encodeSpot,
  spotWork,
  type Position,
  type Spot,
} from './engine/scenarios'
import { cardBackSvg, cardSvg } from './ui/cards-svg'
import { buttonSvg, chipSvg, chipStackSvg, type ChipValue } from './ui/assets-svg'
import { RANK_LABEL, SUITS, SUIT_SYMBOL, type Card, type Suit } from './engine/types'
import { escapeHtml } from '../../../lib/escape'
import { copyText } from '../../../lib/flash'
import { lsGet, lsGetNumber, lsSet } from '../../../lib/storage'

/**
 * Work a single hand-vs-hand query may cost, in five-card reads.
 *
 * Rather than silently switching to Monte Carlo to stay responsive, the UI
 * refuses and says why: the whole promise is that every number shown is exact,
 * and a sampled number wearing the same styling would quietly break it.
 *
 * ==This used to be a count of boards, and counting boards was measuring the
 * wrong thing.== At 300,000 boards it refused preflop Hold'em hand-vs-hand — the
 * single most-asked question in poker, "what is AA against KK" — with the words
 * "too many to count exactly in a browser", which stopped being true the moment
 * the bitmask scorer landed and left the tool declining a query it can answer in
 * about half a second. Meanwhile it read Omaha as *cheaper* than Hold'em,
 * because a preflop PLO spot is fewer boards (1,086,008 against 1,712,304) and
 * takes roughly twenty times as long: every Omaha board is the best of sixty
 * five-card hands. One number cannot describe both games; `handsRanked()` is
 * the unit that can, and it lives in the engine so `security:smoke` can drive it.
 *
 * 8,000,000 reads measured about a quarter of a second warm on the machine this
 * was written on, and roughly double that on the first query of a session before
 * the scorer is JIT-hot. Exactly one reachable spot sits near it: preflop
 * hand-vs-hand Hold'em, at 6,849,216 reads. Every Hold'em spot with a board is
 * under 4,000 and every Omaha spot from the flop on is under 120,000 — so this
 * admits the one query worth waiting for and still refuses preflop Omaha at
 * 130,320,960 reads, which measured about seven seconds.
 *
 * ==That quarter-second is paid once per spot, not once per render.== That is what
 * `engine/equity-cache.ts` is for and it is a precondition of this number, not a
 * bonus beside it: before the memo, `renderSolve` re-ran the whole enumeration on
 * every input event including each keystroke in the pot and bet boxes, so a
 * ceiling admitting a 0.6s query would have meant 0.6s per keypress.
 */
const PT_MAX_RANK_WORK = 8_000_000

const PT_RANKS = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]

type PtMode = 'drill' | 'solve' | 'learn'
type PtSlot = 'hero' | 'villain' | 'board'
type PtChoice = 'fold' | 'call' | 'raise'

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const pct2 = (n: number) => `${(n * 100).toFixed(2)}%`

function ptKey(card: Card): string {
  return `${card.r}${card.s}`
}

function ptShuffledDeck(): Card[] {
  const deck: Card[] = []
  for (const s of SUITS) for (const r of PT_RANKS) deck.push({ r, s })
  // Fisher-Yates with crypto randomness — a trainer that deals biased spots
  // teaches biased intuitions.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1)
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

function ptCards(cards: Card[]): string {
  return cards.map(c => `<span data-type="pt-card">${cardSvg(c)}</span>`).join('')
}

function ptFormatCard(c: Card): string {
  const r = c.r === 10 ? 'T' : (RANK_LABEL[c.r] ?? String(c.r))
  return `${r}${c.s}`
}

function ptFormatCardsDisplay(cards: Card[]): string {
  return cards.map(c => `${RANK_LABEL[c.r] ?? c.r}${SUIT_SYMBOL[c.s] ?? c.s}`).join(' ')
}

/** Any three-card board: the tone sentences do not depend on the cards, only on the street. */
const PT_NOTE_BOARD: Card[] = [{ r: 14, s: 's' }, { r: 7, s: 'd' }, { r: 2, s: 'c' }]

/** The engine's own sentence for a bet size, so the Learn tab quotes it rather than retyping it. */
const ptToneNote = (tone: BetTone, kind: 'bet' | 'raise' = 'bet') => continuingRange([], PT_NOTE_BOARD, tone, kind).note

/** The whole-percent range of bets, as a share of the pot, that the engine calls each tone. */
function ptToneBounds(): Record<'small' | 'medium' | 'large' | 'overbet', [number, number]> {
  const bounds: Record<string, [number, number]> = {}
  for (let percent = 1; percent <= 300; percent++) {
    const tone = toneForSize(percent, 100)
    bounds[tone] = bounds[tone] ? [bounds[tone][0], percent] : [percent, percent]
  }
  return bounds as Record<'small' | 'medium' | 'large' | 'overbet', [number, number]>
}

/** A dealt spot and the seed that reproduces it. A legacy shared link has no seed. */
interface PtDrill {
  spot: Spot
  seed: number | null
}

/** What answering produced: the exact equity figures and the decision made from them. */
interface PtGraded {
  judgement: Judgement
  result: RangeEquityResult | MultiwayEquityResult
  /** Equity against the hands that would call a raise, with how many hands that is. Null when no raise is modelled. */
  raiseResult: { equity: number; combos: number; runouts: number } | null
  right: boolean
}

type PtFilter = 'all' | 'heads-up' | 'multiway' | 'shoves' | 'three-bet' | 'river'

/** The situation filter: each choice is a set of template ids, or null for "every template, by weight". */
const PT_FILTERS: ReadonlyArray<{ id: PtFilter; label: string; templates: readonly string[] | null; note: string }> = [
  { id: 'all', label: 'All', templates: null, note: 'Every kind of situation, dealt about as often as each one comes up at a table.' },
  { id: 'heads-up', label: 'Heads-up', templates: ['srp-ip', 'srp-oop', 'three-bet-pot', 'facing-shove', 'bet-raised', 'river-polar'], note: 'Heads-up means one opponent. These are all the situations where you face a single player.' },
  { id: 'multiway', label: 'Multiway', templates: ['multiway'], note: 'Multiway means more than two players are in the hand. Here two opponents have put chips in before you act.' },
  { id: 'shoves', label: 'Shoves', templates: ['facing-shove'], note: 'A shove is a bet of all of a player\'s chips. You can only call or fold.' },
  { id: 'three-bet', label: 'Three-bet pots', templates: ['three-bet-pot'], note: 'A three-bet pot is one where someone re-raised the first raise before the flop, so the pot is bigger and the ranges are tighter.' },
  { id: 'river', label: 'River', templates: ['river-polar'], note: 'The river is the last card. There are no draws left, so every hand is either made or a bluff.' },
]

const PT_POSITION_NAME: Record<Position, string> = {
  UTG: 'under the gun',
  MP: 'middle position',
  CO: 'cutoff',
  BTN: 'button',
  SB: 'small blind',
  BB: 'big blind',
}

/** How many answers `pt:history` keeps. */
const PT_HISTORY_LIMIT = 200
/** The accuracy table appears once this many answers are recorded. */
const PT_HISTORY_MIN = 5

const PT_TEMPLATE_TITLE = new Map(SCENARIO_TEMPLATES.map(template => [template.id, template.title]))

/** The saved answer history, with anything unreadable or unknown dropped. */
function ptLoadHistory(): Array<[string, boolean]> {
  try {
    const raw = JSON.parse(lsGet('pt:history') ?? '[]')
    if (!Array.isArray(raw)) return []
    const rows: Array<[string, boolean]> = []
    for (const row of raw) {
      if (Array.isArray(row) && typeof row[0] === 'string' && PT_TEMPLATE_TITLE.has(row[0]) && typeof row[1] === 'boolean') {
        rows.push([row[0], row[1]])
      }
    }
    return rows.slice(-PT_HISTORY_LIMIT)
  } catch {
    return []
  }
}

/** One template id from a filter's set, weighted by how often the template comes up. */
function ptPickTemplate(ids: readonly string[]): string {
  const pool = SCENARIO_TEMPLATES.filter(template => ids.includes(template.id))
  let roll = (crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) * pool.reduce((sum, t) => sum + t.weight, 0)
  for (const template of pool) {
    roll -= template.weight
    if (roll < 0) return template.id
  }
  return pool[pool.length - 1].id
}

/**
 * The address of a spot. A dealt spot is its template and seed (`?s=`); a
 * legacy shared spot has neither, so it keeps the old explicit form.
 */
function ptSpotUrl(d: PtDrill): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://apanjwani0.com'
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/games/poker-trainer'
  const spot = d.spot
  if (d.seed !== null && PT_TEMPLATE_TITLE.has(spot.templateId)) {
    return `${origin}${pathname}?s=${encodeSpot(spot, d.seed)}`
  }
  const heroStr = spot.hero.map(ptFormatCard).join('')
  const boardStr = spot.board.map(ptFormatCard).join('')
  return `${origin}${pathname}?hero=${heroStr}&board=${boardStr}&pot=${spot.potBefore}&bet=${spot.bet}&range=${spot.opponents[0].rangeId}`
}

/** A term the reader may not know, defined inline on click rather than in a glossary. */
function ptTerm(term: string, definition: string): string {
  return `<details data-type="pt-term"><summary>${term}</summary><p>${definition}</p></details>`
}

/** The chip denomination drawn for a bet of this size. */
function ptChipValue(chips: number): ChipValue {
  return chips >= 100 ? 100 : chips >= 25 ? 25 : 5
}

/** A pair of numbers as the text of a plain sentence: `1,234.5`. */
const ptCount = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })

/** The seat of a position as a short phrase: "the button (BTN)". */
const ptSeatPhrase = (position: Position) => `the ${PT_POSITION_NAME[position]} (${position})`

/** The pot, itemised with the same names the ledger uses. */
function ptPotCluster(spot: Spot): string {
  const d = derive(spot)
  const chipVal = ptChipValue(spot.bet)
  const sideChip: ChipValue = chipVal === 100 ? 25 : chipVal
  const row = (name: string, chips: number) => `<div><dt>${name}</dt><dd>${fmtChips(chips)}</dd></div>`
  return `
    <div data-type="pt-pot-cluster">
      <div data-type="pt-pot-stacks" aria-hidden="true">
        <span data-type="pt-pot-stack" data-chip="25">${chipStackSvg(sideChip, 3)}</span>
        <span data-type="pt-pot-stack" data-chip="100">${chipStackSvg(100, 5)}</span>
        <span data-type="pt-pot-stack" data-chip="${chipVal}">${chipStackSvg(chipVal, 4)}</span>
      </div>
      <div data-type="pt-pot-banner">
        <div data-type="pt-pot-meta">
          <span data-type="pt-pot-dot"></span>
          <span data-type="pt-pot-title">The pot</span>
        </div>
        <dl data-type="pt-pot-rows">
          ${row('Pot before their bet', spot.potBefore)}
          ${row('Their bet', spot.bet)}
          ${spot.callersIn > 0 ? row('Chips from callers', spot.callersIn) : ''}
          ${spot.heroIn > 0 ? row('Chips you already put in', spot.heroIn) : ''}
          <div data-total="true"><dt>Pot now</dt><dd>${fmtChips(d.potNow)} <span data-type="pt-pot-unit">chips</span></dd></div>
        </dl>
      </div>
    </div>
  `
}

/** The line of the situation: its title, where you sit and how deep you are. */
function ptSituationHeader(spot: Spot): string {
  const stack = spot.effectiveStack
  const bb = stack / spot.blinds.bb
  return `
    <section data-type="pt-situation" aria-label="The situation">
      <p data-type="pt-situation-line">
        <strong>${escapeHtml(spot.title)}</strong>
        <span>Your seat: ${escapeHtml(ptSeatPhrase(spot.heroPosition))}</span>
        <span>Effective stack, the chips you have left behind: ${fmtChips(stack)} chips (${fmtChips(bb)} big blinds)</span>
      </p>
      <ol data-type="pt-story">
        ${spot.line.map((step, i) => `<li${i === spot.line.length - 1 ? ' data-current="true"' : ''}>${escapeHtml(step)}</li>`).join('')}
      </ol>
    </section>
  `
}

/** One opponent's seat: position, the range they play, and what they put in this street. */
function ptOpponentSeat(spot: Spot, index: number, answered: boolean): string {
  const opp = spot.opponents[index]
  const two = spot.opponents.length > 1
  const name = two ? (opp.role === 'bettor' ? 'Bettor' : 'Caller') : 'Opponent'
  const chips = opp.role === 'bettor' ? spot.bet : spot.callersIn
  const verb = opp.role === 'caller' ? 'Called' : spot.allIn ? 'All in' : spot.heroIn > 0 ? 'Raised to' : 'Bet'
  return `
    <div data-type="pt-opp" data-role="${opp.role}">
      <div data-type="pt-player-pill">
        <span data-type="pt-player-name">${name}</span>
        <span data-type="pt-position">${opp.position}</span>
        ${opp.position === 'BTN' ? `<span data-type="pt-dealer" title="Dealer button">${buttonSvg('D')}</span>` : ''}
      </div>
      <span data-type="pt-seat-range">${escapeHtml(opp.rangeLabel)} · ${opp.combos.length} hands</span>
      <div data-type="pt-cards" data-cards-villain>
        <span data-type="pt-card-back">${cardBackSvg('slate')}</span>
        <span data-type="pt-card-back">${cardBackSvg('slate')}</span>
      </div>
      <div data-type="pt-villain-bet">
        <span data-type="pt-chip-stack-mini">${chipStackSvg(ptChipValue(chips), 3)}</span>
        <span>${verb}: <strong>${fmtChips(chips)} chips</strong></span>
      </div>
      ${answered ? `<p data-type="pt-range-note">${escapeHtml(opp.rangeNote)}</p>` : ''}
    </div>
  `
}

/** The lines that say why the drill offers no raise, or null when it does. */
function ptNoRaiseReason(spot: Spot): string | null {
  if (raiseModelled(spot)) return null
  if (spot.opponents.length > 1) return 'With two opponents this drill grades the call only.'
  if (spot.allIn) return 'They are all in, so raising adds nothing.'
  return 'You do not have enough chips behind to raise, so this drill grades the call only.'
}

/** The headline for what you chose against what the numbers said, with the engine's own reasons as the detail. */
function ptCoachVerdict(choice: PtChoice, judgement: Judgement): { headline: string; detail: string } {
  const correct = judgement.correct
  const detail = judgement.reasons.map(escapeHtml).join(' ')
  let headline: string
  if (correct === 'raise') {
    headline = choice === 'raise' ? 'Good raise. It wins more on average than calling.'
      : choice === 'call' ? 'Profitable call, but raising was even stronger.'
      : 'Costly mistake. You folded a hand that was worth a raise.'
  } else if (correct === 'call') {
    headline = choice === 'call' ? "Profitable call. You're getting the right price to continue."
      : choice === 'raise' ? 'Overplayed hand. Calling was the high-EV line.'
      : 'Missed value. Calling was profitable here.'
  } else {
    headline = choice === 'fold' ? 'Disciplined fold. The price was too high for your hand.'
      : choice === 'raise' ? 'Costly raise. Your hand is behind the hands that would continue.'
      : 'Overpaying. You chased a negative-expectation bet.'
  }
  return { headline, detail }
}

/** One quantity in the ledger: its name, its value, the working with the real numbers, and what it means. */
function ptLedgerCard(kind: string, title: string, value: string, working: string, definition: string): string {
  return `
    <div data-type="pt-math-card" data-card-kind="${kind}">
      <div data-type="pt-math-head">
        <span data-type="pt-math-title">${escapeHtml(title)}</span>
        <span data-type="pt-math-val">${escapeHtml(value)}</span>
      </div>
      <p data-type="pt-math-desc">${escapeHtml(definition)}</p>
      <div data-type="pt-math-ledger">
        <div data-type="pt-ledger-row">
          <span data-type="pt-ledger-label">Working</span>
          <div data-type="pt-ledger-content"><code>${escapeHtml(working)}</code></div>
        </div>
      </div>
    </div>
  `
}

/** The signed chip amount the ledger prints for an expected value. */
const ptSigned = (chips: number) => `${chips > 0 ? '+' : ''}${fmtChips(chips)}`

/** How the raise amount was reached, in words and numbers. */
function ptRaiseWorking(spot: Spot, to: number): string {
  if (to === 3 * spot.bet) return `3 × ${fmtChips(spot.bet)} = ${fmtChips(to)} chips`
  if (to >= spot.effectiveStack) return `${fmtChips(to)} chips, all of the ${fmtChips(spot.effectiveStack)} you have behind`
  return `2.5 × ${fmtChips(spot.bet)} = ${fmtChips(to)} chips, rounded to 5`
}

/** The raise half of the ledger: one card with every quantity the raise needed, or the reason there is none. */
function ptRaiseCard(spot: Spot, judgement: Judgement, raiseResult: PtGraded['raiseResult']): string {
  const raise = judgement.raise
  if (!raise || !raiseResult) {
    return `
      <div data-type="pt-math-card" data-card-kind="raise">
        <div data-type="pt-math-head"><span data-type="pt-math-title">Why no raise was modelled</span></div>
        <p data-type="pt-math-desc">${escapeHtml(ptNoRaiseReason(spot) ?? 'A raise could not be worked out for this spot.')}</p>
      </div>
    `
  }
  const { potNow } = judgement.derived
  const hands = spot.opponents[0].combos.length
  const added = raise.to - spot.heroIn
  const theirAdded = raise.to - spot.bet
  const callTotal = potNow + added + theirAdded
  const row = (label: string, value: string, working: string, definition: string) => `
    <div data-type="pt-ledger-row">
      <span data-type="pt-ledger-label">${label}: ${escapeHtml(value)}</span>
      <div data-type="pt-ledger-content">
        <code>${escapeHtml(working)}</code>
        <span>${escapeHtml(definition)}</span>
      </div>
    </div>
  `
  const margin = RAISE_MARGIN * potNow
  return `
    <div data-type="pt-math-card" data-card-kind="raise" data-wide>
      <div data-type="pt-math-head">
        <span data-type="pt-math-title">If you raise</span>
        <span data-type="pt-math-val">${ptSigned(raise.ev)} chips</span>
      </div>
      <p data-type="pt-math-desc">A raise wins the pot at once when they fold, and builds a bigger pot when they call. This is worked out against the hands that would call a raise; every other hand of theirs is assumed to fold.</p>
      <div data-type="pt-math-ledger">
        ${row('Raise to', `${fmtChips(raise.to)} chips`, ptRaiseWorking(spot, raise.to), 'The total you would have in the pot this street after raising.')}
        ${row('Share that folds', fmtPercent(raise.theyFold), `(${hands} − ${raise.callingCombos}) ÷ ${hands} = ${fmtPercent(raise.theyFold)}`, `The share of their ${hands} hands that give up instead of paying ${fmtChips(raise.to - spot.bet)} more.`)}
        ${row('Share that calls', fmtPercent(raise.theyCall), `${raise.callingCombos} ÷ ${hands} = ${fmtPercent(raise.theyCall)}`, 'The share of their hands that stay in against your raise.')}
        ${row('Your equity against the callers', fmtPercent(raise.equityVsCallers), `${ptCount(raise.equityVsCallers * raiseResult.runouts)} ÷ ${raiseResult.runouts.toLocaleString()} runouts = ${fmtPercent(raise.equityVsCallers)}`, `Your equity counted only against the ${raise.callingCombos} hands that call, because those are the hands you play a big pot against.`)}
        ${row('Equity you need if called', fmtPercent(raise.breakEven), `${fmtChips(added)} ÷ (${fmtChips(potNow)} + ${fmtChips(added)} + ${fmtChips(theirAdded)}) = ${fmtPercent(raise.breakEven)}`, 'The break-even equity of the raise, found the same way as for a call: the chips you add divided by the pot once they have called.')}
        ${row('Raise EV', `${ptSigned(raise.ev)} chips`, `${fmtPercent(raise.theyFold)} × ${fmtChips(potNow)} + ${fmtPercent(raise.theyCall)} × (${fmtPercent(raise.equityVsCallers)} × ${fmtChips(callTotal)} − ${fmtChips(added)}) = ${ptSigned(raise.ev)}`, 'The average chips a raise wins: the pot now when they fold, plus your share of the bigger pot minus the chips you add when they call.')}
      </div>
      <p data-type="pt-math-desc">A raise is only the best play when its EV beats the EV of calling (${ptSigned(judgement.callEv)} chips) by more than ${RAISE_MARGIN * 100}% of the pot now (${fmtChips(margin)} chips), and when your equity against the callers is at least the equity you need if called. The margin is there because this drill does not model what happens on later streets, and because it uses one fixed guess about which hands would call a raise.</p>
    </div>
  `
}

/** The ledger of every number behind the answer, each named once and used by that name everywhere. */
function ptLedger(spot: Spot, graded: PtGraded): string {
  const j = graded.judgement
  const d = j.derived
  const result = graded.result
  const cards: string[] = []

  const ledgerChips = spot.ledger.map(entry => entry.chips)
  const ledgerAdds = ledgerChips.reduce((a, b) => a + b, 0) === spot.potBefore
  cards.push(ptLedgerCard('pot', 'Pot before their bet', `${fmtChips(spot.potBefore)} chips`,
    ledgerAdds && ledgerChips.length > 1 ? `${ledgerChips.map(fmtChips).join(' + ')} = ${fmtChips(spot.potBefore)} chips` : `${fmtChips(spot.potBefore)} chips`,
    spot.heroIn > 0
      ? 'The chips in the middle before the betting on this street began, added up from the story above; the chips you bet on this street are listed separately.'
      : 'The chips in the middle before the betting on this street began, added up from the story above.'))

  cards.push(ptLedgerCard('pot', 'Their bet', `${fmtChips(spot.bet)} chips`,
    `${fmtChips(spot.bet)} ÷ ${fmtChips(spot.potBefore)} = ${Math.round((spot.bet / spot.potBefore) * 100)}% of the pot before their bet`,
    spot.heroIn > 0
      ? 'The total they raised to, which includes the chips you had already put in.'
      : spot.allIn
        ? 'All of the chips they have left, which is the most a bet can be.'
        : 'The chips they put in on this street.'))

  if (spot.callersIn > 0) {
    cards.push(ptLedgerCard('pot', 'Chips from callers', `${fmtChips(spot.callersIn)} chips`,
      `${fmtChips(spot.callersIn)} chips`,
      'The chips the second opponent put in to match the bet before it got back to you.'))
  }
  if (spot.heroIn > 0) {
    cards.push(ptLedgerCard('pot', 'Chips you already put in', `${fmtChips(spot.heroIn)} chips`,
      `${fmtChips(spot.heroIn)} chips`,
      'The chips you bet on this street before they raised; they are already in the pot and count toward your call.'))
  }

  const nowParts = [spot.potBefore, spot.bet, spot.callersIn, spot.heroIn].filter((n, i) => i < 2 || n > 0)
  cards.push(ptLedgerCard('pot', 'Pot now', `${fmtChips(d.potNow)} chips`,
    `${nowParts.map(fmtChips).join(' + ')} = ${fmtChips(d.potNow)} chips`,
    'All the chips on the table at the moment you have to decide.'))

  cards.push(ptLedgerCard('pot', 'Your call', `${fmtChips(d.toCall)} chips`,
    `${fmtChips(spot.bet)} − ${fmtChips(spot.heroIn)} = ${fmtChips(d.toCall)} chips`,
    'The extra chips you must put in to stay in the hand: their bet minus the chips you already put in.'))

  cards.push(ptLedgerCard('pot', 'Pot after your call', `${fmtChips(d.potAfterCall)} chips`,
    `${fmtChips(d.potNow)} + ${fmtChips(d.toCall)} = ${fmtChips(d.potAfterCall)} chips`,
    'The pot you would be playing for if you call: the pot now plus your call.'))

  cards.push(ptLedgerCard('potodds', 'Break-even equity', fmtPercent(d.breakEven),
    `${fmtChips(d.toCall)} ÷ ${fmtChips(d.potAfterCall)} = ${fmtPercent(d.breakEven)}`,
    'The share of the pot your hand must win, on average, for calling to lose nothing over many hands: your call divided by the pot after your call.'))

  cards.push(ptLedgerCard('potodds', 'Pot odds', `${d.potOdds.toFixed(1)} to 1`,
    `${fmtChips(d.potNow)} ÷ ${fmtChips(d.toCall)} = ${d.potOdds.toFixed(1)} to 1`,
    'The same price said another way: for every chip you pay to call, the pot now already holds this many chips.'))

  if ('pairs' in result) {
    const total = result.pairs * result.runouts
    cards.push(ptLedgerCard('equity', 'Your equity', fmtPercent(result.equity),
      `${ptCount(result.equity * total)} ÷ (${result.pairs.toLocaleString()} pairs × ${result.runouts.toLocaleString()} runouts = ${total.toLocaleString()}) = ${fmtPercent(result.equity)}`,
      'Your average share of the pot over every pair of hands the two opponents could hold and every set of cards that could still come, where a tie splits the pot evenly.'))
    cards.push(ptLedgerCard('equity', 'Share of their hands you are ahead of', fmtPercent(result.aheadOf),
      `${ptCount(result.aheadOf * result.pairs)} ÷ ${result.pairs.toLocaleString()} pairs = ${fmtPercent(result.aheadOf)}`,
      'The share of pairs of their hands where you hold the single best hand on at least half of the cards to come.'))
  } else {
    cards.push(ptLedgerCard('equity', 'Your equity', fmtPercent(result.equity),
      `(wins + ½ × ties) ÷ runouts = ${ptCount(result.equity * result.runouts)} ÷ ${result.runouts.toLocaleString()} = ${fmtPercent(result.equity)}`,
      `Your share of the pot over every one of their ${result.combos} hands and every set of cards that could still come, counting a win as 1 and a tie as one half.`))
    cards.push(ptLedgerCard('equity', 'Share of their hands you are ahead of', fmtPercent(result.aheadOf),
      `${Math.round(result.aheadOf * result.combos)} ÷ ${result.combos} hands = ${fmtPercent(result.aheadOf)}`,
      'The share of their hands that you beat more than half of the time, whatever the price of the call.'))
  }

  cards.push(ptLedgerCard('ev', 'EV of calling', `${ptSigned(j.callEv)} chips`,
    `${fmtPercent(j.equity)} × ${fmtChips(d.potAfterCall)} − ${fmtChips(d.toCall)} = ${ptSigned(j.callEv)} chips`,
    'Expected value (EV) is the average number of chips calling wins or loses if the hand ended at showdown with no more betting; equity is rounded here, so the last digit can differ slightly.'))

  cards.push(ptRaiseCard(spot, j, graded.raiseResult))
  return cards.join('')
}

class PokerTrainerGame extends HTMLElement {
  private mode: PtMode = 'drill'

  // Drill state
  private drill: PtDrill | null = null
  private choice: PtChoice | null = null
  private graded: PtGraded | null = null
  /** A sentence saying why this spot cannot be graded, or null. */
  private blocked: string | null = null
  private filter: PtFilter = 'all'
  private history: Array<[string, boolean]> = []
  private streak = 0
  private best = 0

  // Solve state
  private variant: Variant = 'holdem'
  private hero: Card[] = []
  private villain: Card[] = []
  private board: Card[] = []
  private picking: PtSlot = 'hero'
  private pot = 100
  private bet = 50
  private villainMode: 'hand' | 'range' = 'hand'
  private rangeText = PRESET_RANGES[0].text

  connectedCallback() {
    this.best = lsGetNumber('pt:best', 0)
    this.history = ptLoadHistory()
    const savedFilter = lsGet('pt:filter')
    this.filter = PT_FILTERS.find(f => f.id === savedFilter)?.id ?? 'all'

    this.innerHTML = `
      <div data-type="pt-game">
        <div data-type="pt-header">
          <div data-type="pt-titlebar">
            <h1>Poker Trainer</h1>
            <span data-type="pt-badge">exact, never sampled</span>
          </div>
          <p>Train real Hold'em spots against realistic opponent ranges. Every runout enumerated exactly.</p>
        </div>

        <nav data-type="pt-tabs" role="tablist">
          <button role="tab" data-mode="drill" type="button">Play a spot</button>
          <button role="tab" data-mode="solve" type="button">Run the numbers</button>
          <button role="tab" data-mode="learn" type="button">How to think (Concepts)</button>
        </nav>

        <section data-type="pt-panel" data-panel="drill"></section>
        <section data-type="pt-panel" data-panel="solve"></section>
        <section data-type="pt-panel" data-panel="learn"></section>
      </div>
    `

    this.querySelector('[data-type="pt-tabs"]')!.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-mode]')
      if (!button) return
      this.mode = button.dataset.mode as PtMode
      this.render()
    })

    const hash = window.location.hash.toLowerCase()
    if (hash === '#solve') {
      this.mode = 'solve'
    } else if (hash === '#learn' || hash === '#quant-prep' || hash.startsWith('#learn-')) {
      this.mode = 'learn'
    }

    const sharedSpot = this.parseSpotFromUrl()
    if (sharedSpot) {
      this.setDrill(sharedSpot)
      this.mode = 'drill'
    } else {
      this.deal()
    }

    this.render()
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('hashchange', this.onHashChange)

    if (hash && (hash === '#quant-prep' || hash.startsWith('#learn-'))) {
      window.setTimeout(() => {
        const target = this.querySelector(hash)
        if (target) target.scrollIntoView({ behavior: 'smooth' })
      }, 100)
    }
  }

  /* ─────────────────────────────  chrome  ───────────────────────────── */

  private solveBuilt = false
  private learnRendered = false

  private render() {
    for (const button of this.querySelectorAll<HTMLElement>('[data-mode]')) {
      const on = button.dataset.mode === this.mode
      button.toggleAttribute('data-active', on)
      button.setAttribute('aria-selected', String(on))
    }
    for (const panel of this.querySelectorAll<HTMLElement>('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== this.mode
    }
    if (this.mode === 'drill') {
      this.renderDrill()
    } else if (this.mode === 'solve') {
      if (!this.solveBuilt) {
        this.buildSolve()
        this.solveBuilt = true
      }
      this.renderSolve()
    } else if (this.mode === 'learn') {
      if (!this.learnRendered) {
        this.renderLearn()
        this.learnRendered = true
      }
    }
  }

  /* ─────────────────────────────  drill  ───────────────────────────── */

  /**
   * Make a spot the one on the table.
   *
   * A shared link can carry a spot too big to count exactly (the old links took
   * any pot and bet), so the work is checked here and the drill says so rather
   * than freezing the tab or sampling.
   */
  private setDrill(drill: PtDrill) {
    this.drill = drill
    this.choice = null
    this.graded = null
    this.blocked = spotWork(drill.spot) <= PT_MAX_RANGE_WORK
      ? null
      : 'This shared spot is too big to count exactly in your browser, and this drill never estimates, so it will not grade it. Press Next spot to deal a new one.'
  }

  /**
   * Deal a spot from the chosen situations.
   *
   * The engine picks the street to fit the cost of counting (see
   * PT_MAX_RANGE_WORK), so a wide range tends to arrive late in the hand. That
   * is a property of the arithmetic, and the situation line says which street
   * you are on. The seed is the whole spot: it is what a shared link carries.
   */
  private deal() {
    const ids = PT_FILTERS.find(f => f.id === this.filter)?.templates ?? null
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]
    this.setDrill(dealSpot(seed, ids ? ptPickTemplate(ids) : undefined))
  }

  /**
   * Count the equity exactly and decide. Null when the count could not be made.
   *
   * Every query goes through the memo: this runs again whenever the tab is
   * redrawn, and re-counting boards to redraw text that cannot have changed
   * is the bug the Solve tab once had.
   */
  private grade(spot: Spot, choice: PtChoice): PtGraded | null {
    try {
      const hero = spot.hero
      const result = spot.opponents.length === 1
        ? cachedEquityVsRange(hero, spot.opponents[0].combos, spot.board)
        : cachedEquityVsRanges(hero, [spot.opponents[0].combos, spot.opponents[1].combos], spot.board, PT_MAX_RANGE_WORK)
      let raiseResult: PtGraded['raiseResult'] = null
      if (raiseModelled(spot)) {
        const callers = cachedEquityVsRange(hero, raiseContinuingCombos(spot), spot.board)
        raiseResult = { equity: callers.equity, combos: callers.combos, runouts: callers.runouts }
      }
      const judgement = judge(spot, result, raiseResult)
      // A call is accepted when a raise was best: calling is still profitable then.
      const right = choice === judgement.correct || (judgement.correct === 'raise' && choice === 'call')
      return { judgement, result, raiseResult, right }
    } catch {
      return null
    }
  }

  /** Take the player's choice, grade it once, and keep the streak and the history. */
  private answer(choice: PtChoice) {
    const d = this.drill
    if (!d || this.choice || this.blocked) return
    if (choice === 'raise' && !raiseModelled(d.spot)) return
    const graded = this.grade(d.spot, choice)
    if (!graded) {
      this.blocked = 'This spot could not be counted exactly here, so it is not graded. Press Next spot to deal a new one.'
      this.renderDrill()
      return
    }
    this.choice = choice
    this.graded = graded
    if (graded.right) {
      this.streak++
      if (this.streak > this.best) {
        this.best = this.streak
        lsSet('pt:best', String(this.best))
      }
    } else {
      this.streak = 0
    }
    if (PT_TEMPLATE_TITLE.has(d.spot.templateId)) {
      this.history = [...this.history, [d.spot.templateId, graded.right] as [string, boolean]].slice(-PT_HISTORY_LIMIT)
      lsSet('pt:history', JSON.stringify(this.history))
    }
    this.renderDrill()
  }

  private next(scrollToSpot = false) {
    this.deal()
    this.renderDrill()
    if (scrollToSpot) this.querySelector('[data-type="pt-spotcard"]')?.scrollIntoView({ behavior: 'smooth' })
  }

  private setFilter(filter: PtFilter) {
    this.filter = filter
    lsSet('pt:filter', filter)
    this.next()
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.mode !== 'drill') return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    // Don't intercept if user is typing in an input
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

    const key = e.key.toLowerCase()
    if (!this.choice) {
      if (key === 'f') this.answer('fold')
      else if (key === 'c') this.answer('call')
      else if (key === 'r') this.answer('raise')
    } else if (key === ' ' || key === 'enter' || key === 'n') {
      // A focused button or link already acts on Space and Enter itself.
      if ((key === ' ' || key === 'enter') && (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY')) return
      e.preventDefault()
      this.next()
    }
  }

  private onHashChange = () => {
    const hash = window.location.hash.toLowerCase()
    if (hash === '#solve') {
      this.mode = 'solve'
      this.render()
    } else if (hash === '#learn' || hash === '#quant-prep' || hash.startsWith('#learn-')) {
      this.mode = 'learn'
      this.render()
      window.setTimeout(() => {
        const target = this.querySelector(hash)
        if (target) target.scrollIntoView({ behavior: 'smooth' })
      }, 50)
    } else if (hash === '#drill') {
      this.mode = 'drill'
      this.render()
    }
  }

  /**
   * The spot a link names, or null.
   *
   * `?s=` is the current form (a template and a seed, re-dealt exactly). The old
   * forms (`?spot=hero:board:pot:bet:range` and the separate `hero`, `board`,
   * `pot`, `bet`, `range` parameters) still open, as a one-opponent spot.
   */
  private parseSpotFromUrl(): PtDrill | null {
    try {
      const params = new URLSearchParams(window.location.search)
      const fresh = params.get('s')
      if (fresh) {
        const found = decodeSpot(fresh)
        if (found) return found
      }
      const legacy = params.get('spot')
      if (legacy) {
        const found = decodeSpot(legacy)
        if (found) return found
      }
      const hero = params.get('hero')
      const board = params.get('board')
      if (hero && board) {
        return decodeLegacySpot({
          hero,
          board,
          pot: params.get('pot') ?? undefined,
          bet: params.get('bet') ?? undefined,
          range: params.get('range') ?? undefined,
        })
      }
      return null
    } catch {
      return null
    }
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('hashchange', this.onHashChange)
  }

  private renderDrill() {
    const host = this.querySelector('[data-panel="drill"]') as HTMLElement
    const d = this.drill
    if (!d) return
    const graded = this.choice ? this.graded : null

    host.innerHTML = `
      ${this.filterHtml()}
      <div data-type="pt-spotcard"${graded ? ' data-answered' : ''}>
        ${graded && this.choice ? this.answeredHtml(d, graded, this.choice) : this.questionHtml(d)}
      </div>
      ${this.accuracyHtml()}
    `

    for (const button of host.querySelectorAll<HTMLElement>('[data-filter]')) {
      button.addEventListener('click', () => this.setFilter(button.dataset.filter as PtFilter))
    }
    for (const button of host.querySelectorAll<HTMLElement>('[data-choice]')) {
      button.addEventListener('click', () => this.answer(button.dataset.choice as PtChoice))
    }
    host.querySelector('[data-action="share-spot"]')?.addEventListener('click', event => {
      copyText(ptSpotUrl(d), event.currentTarget as HTMLElement, { copied: '✓ Link copied!' })
    })
    host.querySelector('[data-action="share-result"]')?.addEventListener('click', event => {
      if (graded) copyText(this.shareText(d, graded), event.currentTarget as HTMLElement, { copied: '✓ Copied spot!' })
    })
    host.querySelector('[data-action="next"]')?.addEventListener('click', () => this.next())
    host.querySelector('[data-action="next-bottom"]')?.addEventListener('click', () => this.next(true))
  }

  /** The situation filter, with a sentence saying what the chosen one means. */
  private filterHtml(): string {
    const active = PT_FILTERS.find(f => f.id === this.filter) ?? PT_FILTERS[0]
    return `
      <div data-type="pt-filter">
        <div data-type="pt-filter-buttons" role="group" aria-label="Which situations to practise">
          ${PT_FILTERS.map(f => `<button type="button" data-filter="${f.id}" aria-pressed="${f.id === active.id}">${f.label}</button>`).join('')}
        </div>
        <p data-type="pt-filter-note">${escapeHtml(active.note)}</p>
      </div>
    `
  }

  /** The felt's header: the street, the two numbers you decide with, and the streak. */
  private feltHeader(spot: Spot): string {
    const derived = derive(spot)
    return `
      <div data-type="pt-felt-header">
        <div data-type="pt-street-group">
          <span data-type="pt-beacon"></span>
          <span data-type="pt-street">Street: ${spot.street.toUpperCase()} (${spot.board.length} cards)</span>
        </div>
        <div data-type="pt-header-right">
          <div data-type="pt-chip-badge">
            <span data-type="pt-chip-icon">${chipSvg(ptChipValue(spot.bet))}</span>
            <span>Your call: <strong>${fmtChips(derived.toCall)}</strong> · Pot now: <strong>${fmtChips(derived.potNow)}</strong></span>
          </div>
          <div data-type="pt-streak-pill">
            <span>Streak: <strong>${this.streak}</strong> 🔥</span>
          </div>
        </div>
      </div>
    `
  }

  /** The table: the opponents across the top, the pot and board in the middle, you at the bottom. */
  private tableHtml(spot: Spot, answered: boolean): string {
    const ghost = spot.board.length === 3
      ? '<span data-type="pt-ghost-card">Turn</span><span data-type="pt-ghost-card">River</span>'
      : spot.board.length === 4
        ? '<span data-type="pt-ghost-card">River</span>'
        : ''
    const made = rankHand(spot.hero, spot.board, 'holdem').name
    return `
      <div data-type="pt-table"${answered ? ' data-table-answered' : ''}>
        <div data-type="pt-table-watermark">POKER TRAINER</div>

        <div data-type="pt-seat-villain">
          ${spot.opponents.map((_, i) => ptOpponentSeat(spot, i, answered)).join('')}
        </div>

        <div data-type="pt-table-center">
          ${ptPotCluster(spot)}
          <div data-type="pt-cards" data-cards-board>
            ${ptCards(spot.board)}
            ${ghost}
          </div>
        </div>

        <div data-type="pt-seat-hero">
          <div data-type="pt-cards" data-cards-hero>
            ${ptCards(spot.hero)}
          </div>
          ${spot.heroIn > 0 ? `
            <div data-type="pt-villain-bet">
              <span data-type="pt-chip-stack-mini">${chipStackSvg(ptChipValue(spot.heroIn), 3)}</span>
              <span>You bet: <strong>${fmtChips(spot.heroIn)} chips</strong></span>
            </div>` : ''}
          <div data-type="pt-hero-badge-group">
            <div data-type="pt-player-pill">
              <span data-type="pt-player-name">You</span>
              <span data-type="pt-position">${spot.heroPosition}</span>
              ${spot.heroPosition === 'BTN' ? `<span data-type="pt-dealer" title="Dealer button">${buttonSvg('D')}</span>` : ''}
            </div>
            <span data-type="pt-made-pill">${escapeHtml(made)}</span>
          </div>
        </div>
      </div>
    `
  }

  /** Before answering: the story, the table, the price and the buttons. */
  private questionHtml(d: PtDrill): string {
    const spot = d.spot
    const derived = derive(spot)
    const to = raiseTo(spot)
    const noRaise = ptNoRaiseReason(spot)
    return `
      <div data-type="pt-felt">
        ${this.feltHeader(spot)}
        ${ptSituationHeader(spot)}
        ${this.tableHtml(spot, false)}

        <div data-type="pt-action-strip">
          ${this.blocked ? `
            <p data-type="pt-no-raise">${escapeHtml(this.blocked)}</p>
            <div data-type="pt-choices">
              <button data-action="next" data-variant="primary" type="button"><span>Next spot</span><kbd>Space</kbd></button>
            </div>
          ` : `
            <div data-type="pt-action-price">
              Your call is <strong>${fmtChips(derived.toCall)} chips</strong> and the pot after your call is <strong>${fmtChips(derived.potAfterCall)} chips</strong>, so break-even equity is <strong>${fmtPercent(derived.breakEven)}</strong>. Equity is your share of the pot over every card still to come.
            </div>
            <div data-type="pt-choices">
              <button data-choice="fold" type="button">
                <span>Fold</span>
                <kbd>F</kbd>
              </button>
              <button data-choice="call" data-variant="primary" type="button">
                <span>Call ${fmtChips(derived.toCall)}</span>
                <kbd>C</kbd>
              </button>
              ${to !== null ? `
              <button data-choice="raise" type="button">
                <span>Raise to ${fmtChips(to)}</span>
                <kbd>R</kbd>
              </button>` : ''}
            </div>
            ${noRaise ? `<p data-type="pt-no-raise">${escapeHtml(noRaise)}</p>` : ''}
          `}
        </div>

        <div data-type="pt-status-bar">
          <span data-type="pt-score">Streak <strong>${this.streak}</strong> · Best <strong>${this.best}</strong></span>
          <button data-action="share-spot" type="button" class="pt-share-btn"><span>🔗 Share spot</span></button>
          <span data-type="pt-shortcut-hint">Tip: Use keys <kbd>F</kbd>, <kbd>C</kbd>${to !== null ? ', <kbd>R</kbd>' : ''}</span>
        </div>
      </div>
    `
  }

  /** After answering: the verdict, the gauge, the ledger of every number, and who they might hold. */
  private answeredHtml(d: PtDrill, graded: PtGraded, choice: PtChoice): string {
    const spot = d.spot
    const j = graded.judgement
    const derived = j.derived
    const right = graded.right
    const coach = ptCoachVerdict(choice, j)
    const past = { fold: 'folded', call: 'called', raise: 'raised' }[choice]
    const numbers = `Your equity is ${fmtPercent(j.equity)} and break-even equity is ${fmtPercent(derived.breakEven)}.`
    const verdict = choice === j.correct
      ? `You ${past}. ${numbers}`
      : right
        ? `You called, which wins chips on average, but raising was better. ${numbers}`
        : `You ${past}, but the best play was to ${j.correct}. ${numbers}`
    const equityPct = (j.equity * 100).toFixed(1)
    const breakEvenPct = (derived.breakEven * 100).toFixed(1)
    const result = graded.result

    const lists = 'pairs' in result
      ? spot.opponents.map(opp => `
          <div data-type="pt-split-col">
            <h3>${PT_POSITION_NAME[opp.position]} (${opp.position}), the ${opp.role}</h3>
            <p data-type="pt-math-desc">${escapeHtml(opp.rangeLabel)}, ${opp.combos.length} hands. ${escapeHtml(opp.rangeNote)}</p>
          </div>`).join('')
      : `
          <div data-type="pt-split-col">
            <h3>Their hands you are behind</h3>
            <div data-type="pt-combos-list">
              ${result.worst.map(w => `
                <div data-type="pt-comborow">
                  <div data-type="pt-comborow-cards">${ptCards(w.hand)}</div>
                  <span data-type="pt-comborow-eq" data-crushed="true">${pct(w.equity)} equity</span>
                </div>`).join('')}
            </div>
          </div>
          <div data-type="pt-split-col">
            <h3>Their hands you are ahead of</h3>
            <div data-type="pt-combos-list">
              ${result.best.map(w => `
                <div data-type="pt-comborow">
                  <div data-type="pt-comborow-cards">${ptCards(w.hand)}</div>
                  <span data-type="pt-comborow-eq" data-crushed="false">${pct(w.equity)} equity</span>
                </div>`).join('')}
            </div>
          </div>`

    return `
      <div data-type="pt-felt" data-felt-verdict="${right ? 'right' : 'wrong'}">
        ${this.feltHeader(spot)}
        ${ptSituationHeader(spot)}
        ${this.tableHtml(spot, true)}

        <div data-type="pt-action-strip" data-answered="true">
          <div data-type="pt-verdict-summary" data-right="${right}">
            <span data-type="pt-verdict-tag">${right ? '✓ Correct' : '✗ Mistake'}</span>
            <span data-type="pt-verdict-detail">${escapeHtml(verdict)}</span>
          </div>
          <div data-type="pt-choices" data-answered="true">
            <button data-action="next" data-variant="primary" type="button">
              <span>Next spot</span>
              <kbd>Space</kbd>
            </button>
            <button data-action="share-result" type="button" class="pt-share-btn">
              <span>🔗 Share</span>
            </button>
          </div>
        </div>

        <div data-type="pt-coach-card" data-verdict="${right ? 'right' : 'wrong'}">
          <span data-type="pt-coach-headline">${coach.headline}</span>
          <p data-type="pt-coach-detail">${coach.detail}</p>
        </div>

        <div data-type="pt-gauge">
          <div data-type="pt-gauge-labels">
            <span>Your equity: <strong>${equityPct}%</strong></span>
            <span>Break-even equity: <strong>${breakEvenPct}%</strong></span>
          </div>
          <div data-type="pt-gauge-meter" role="meter" aria-valuenow="${equityPct}" aria-valuemin="0" aria-valuemax="100" aria-label="Your equity">
            <div data-type="pt-gauge-fill" style="width: ${equityPct}%" data-positive="${j.equity >= derived.breakEven}"></div>
            <div data-type="pt-gauge-target" style="left: ${breakEvenPct}%" title="Break-even equity (${breakEvenPct}%)"></div>
          </div>
          <div data-type="pt-gauge-ticks">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>

        <details data-type="pt-math-details" open>
          <summary data-type="pt-math-summary">
            <span>Every number behind this answer</span>
            <span data-type="pt-math-toggle-hint">Click to collapse</span>
          </summary>
          <div data-type="pt-math-cards">${ptLedger(spot, graded)}</div>
        </details>

        <div data-type="pt-splits">${lists}</div>

        <details data-type="pt-caveat">
          <summary>Why this grades pot odds and not a full solved strategy</summary>
          <p>This drill grades immediate expected value (+EV): whether calling or raising makes chips against the hands their bet leaves them with, if the hand ended now. A solved strategy balances your whole range across every later street, which needs desktop solver computations. <a href="#learn-decides">How the drill decides</a> lists every rule it used.</p>
        </details>

        <div data-type="pt-bottom-actions">
          <button data-action="next-bottom" data-variant="primary" type="button">
            <span>Next spot</span>
            <kbd>Space</kbd>
          </button>
        </div>

        <div data-type="pt-status-bar">
          <p data-type="pt-score">Streak <strong>${this.streak}</strong> · Best <strong>${this.best}</strong></p>
        </div>
      </div>
    `
  }

  /** The text copied by Share: the situation, the story in one sentence, and the numbers by their ledger names. */
  private shareText(d: PtDrill, graded: PtGraded): string {
    const spot = d.spot
    const j = graded.judgement
    const x = j.derived
    return [
      `Poker Trainer: ${spot.title}, on the ${spot.street}`,
      `You hold ${ptFormatCardsDisplay(spot.hero)} on ${ptFormatCardsDisplay(spot.board)} in ${ptSeatPhrase(spot.heroPosition)}. ${spot.line[spot.line.length - 1]}`,
      `Pot before their bet ${fmtChips(spot.potBefore)}, their bet ${fmtChips(spot.bet)}${spot.callersIn > 0 ? `, chips from callers ${fmtChips(spot.callersIn)}` : ''}${spot.heroIn > 0 ? `, chips you already put in ${fmtChips(spot.heroIn)}` : ''}, pot now ${fmtChips(x.potNow)}, your call ${fmtChips(x.toCall)}.`,
      `Break-even equity ${fmtPercent(x.breakEven)}, your equity ${fmtPercent(j.equity)}, EV of calling ${ptSigned(j.callEv)} chips${j.raise ? `, Raise EV ${ptSigned(j.raise.ev)} chips` : ''}.`,
      `Best play: ${j.correct}. ${graded.right ? '✓ I got it right.' : '✗ I got it wrong.'}`,
      `Try it: ${ptSpotUrl(d)}`,
    ].join('\n')
  }

  /** Accuracy by situation, from the saved history, once there is enough of it to mean something. */
  private accuracyHtml(): string {
    if (this.history.length < PT_HISTORY_MIN) return ''
    const rows = SCENARIO_TEMPLATES.map(template => {
      const mine = this.history.filter(([id]) => id === template.id)
      return { title: template.title, answered: mine.length, right: mine.filter(([, ok]) => ok).length }
    }).filter(row => row.answered > 0)
    return `
      <section data-type="pt-accuracy" aria-label="Your accuracy by situation">
        <h3>Your accuracy by situation</h3>
        <table data-type="pt-accuracy-table">
          <thead><tr><th>Situation</th><th>Answered</th><th>Right</th><th>Percent</th></tr></thead>
          <tbody>
            ${rows.map(row => `<tr><td>${escapeHtml(row.title)}</td><td>${row.answered}</td><td>${row.right}</td><td>${Math.round((row.right / row.answered) * 100)}%</td></tr>`).join('')}
          </tbody>
        </table>
        <p data-type="pt-accuracy-note">This counts your last ${this.history.length} answers and is kept only in this browser.</p>
      </section>
    `
  }

  /* ─────────────────────────────  learn  ───────────────────────────── */

  private renderLearn() {
    const host = this.querySelector('[data-panel="learn"]') as HTMLElement
    const bounds = ptToneBounds()
    host.innerHTML = `
      <div data-type="pt-learn">
        <header data-type="pt-learn-hero">
          <h2>How to Think at the Poker Table</h2>
          <p>Core poker math and strategy explained in plain English. No unnecessary academic jargon.</p>
          <nav data-type="pt-learn-nav" aria-label="Concept navigation">
            <a href="#learn-equity">📈 Equity</a>
            <a href="#learn-odds">💰 Pot Odds</a>
            <a href="#learn-outs">🎯 Rule of 2 &amp; 4</a>
            <a href="#learn-ranges">🃏 Ranges</a>
            <a href="#learn-blockers">🛡️ Blockers</a>
            <a href="#learn-gto">🤖 GTO Reality</a>
            <a href="#learn-omaha">♠️ Omaha Rules</a>
            <a href="#learn-exact">⚖️ Exact Math</a>
            <a href="#learn-decides">🧭 How the drill decides</a>
            <a href="#quant-prep">📊 Quant Prep</a>
          </nav>
        </header>

        <div data-type="pt-learn-grid">
          <!-- 1. Equity -->
          <article data-type="pt-concept-card" id="learn-equity">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">01 · CORE CONCEPT</span>
              <h3>Equity: Your True Share of the Pot</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The Dilemma</strong>
              Facing a bet, players freeze trying to guess if their hand is winning right this second.
            </div>
            <div data-type="pt-concept-body">
              <p><strong>Think in runouts, not luck.</strong> If the remaining cards deal out 100 times, your equity is the exact percentage of those pots you scoop.</p>
              <p><strong>Equity equals pot ownership.</strong> When a final pot holds 100 chips and your hand wins 60% of runouts, your hand is worth 60 chips right now. You never need to guess their exact cards—you only need your winning share against their full range.</p>
              <p>See <a href="#learn-decides">how the drill decides</a> for how this idea is used when it grades you.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">Pot Share</span>
              <code>Your Chip Equity = Final Pot × Win Percentage</code>
            </div>
            <div data-type="pt-concept-takeaway">
              <strong>The Table Rule</strong>
              Never ask "am I ahead right now?" Ask "what percentage of this pot do I own across all runouts?"
            </div>
          </article>

          <!-- 2. Pot Odds -->
          <article data-type="pt-concept-card" id="learn-odds">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">02 · BETTING PRICE</span>
              <h3>Pot Odds: The Price to Call</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The Dilemma</strong>
              An opponent bets into you, and you must decide whether calling is mathematically profitable or bleeding chips.
            </div>
            <div data-type="pt-concept-body">
              <p><strong>Every call is buying a discount.</strong> If you pay 25 chips to contest a final pot of 100 chips, you risk 25 to win the 75 already in the pot: 3-to-1 pot odds.</p>
              <p><strong>The break-even test.</strong> Divide your call by the total final pot: 25 ÷ 100 = 25%. You only need to win 1 out of 4 times to break even. If your hand equity is 30%, calling prints chips long-term.</p>
              <p>See <a href="#learn-decides">how the drill decides</a> for how this idea is used when it grades you.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">Break-Even Price</span>
              <code>Break-even % = Call Amount ÷ (Current Pot + Their Bet + Your Call)</code>
            </div>
            <div data-type="pt-concept-takeaway">
              <strong>The Table Rule</strong>
              If your hand equity is higher than the break-even price percentage, call every time.
            </div>
          </article>

          <!-- 3. Outs & Rule of 2/4 -->
          <article data-type="pt-concept-card" id="learn-outs">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">03 · TABLE SHORTCUT</span>
              <h3>The 4-2 Rule: Clean Outs vs Dirty Draws</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The Dilemma</strong>
              You hold a drawing hand on the flop or turn and need instant win probability without a calculator.
            </div>
            <div data-type="pt-concept-body">
              <p><strong>Multiply your unseen winning cards.</strong> Count every card that completes your hand (9 for a flush draw, 8 for an open-ended straight). On the flop, multiply outs by 4 to get your chance to hit by the river. On the turn, multiply outs by 2.</p>
              <p><strong>Beware dirty outs.</strong> If the board pairs while you hit your flush, an opponent with two pair makes a full house. Always subtract 1 to 2 outs when the board is paired or heavily coordinated.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">Speed Multiplier</span>
              <code>Flop Win% ≈ Outs × 4  |  Turn Win% ≈ Outs × 2</code>
            </div>
            <div data-type="pt-concept-takeaway">
              <strong>The Table Rule</strong>
              Calculate outs × 4 on the flop, but discount outs that might give your opponent a bigger hand.
            </div>
          </article>

          <!-- 4. Ranges -->
          <article data-type="pt-concept-card" id="learn-ranges">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">04 · HAND READING</span>
              <h3>Ranges: Playing Against Groups of Hands</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The Dilemma</strong>
              An opponent raises, and you paralyze your decision by fearing they hold the absolute nuts.
            </div>
            <div data-type="pt-concept-body">
              <p><strong>Nobody holds just one hand.</strong> Good players raise a predictable cluster of hands based on their table position: pocket pairs, suited aces, Broadways, and suited connectors. That whole cluster is their range.</p>
              <p><strong>Combo math beats fear.</strong> Pocket Aces has only 6 card combinations. Ace-King has 16 combinations. An opponent is almost 3 times more likely to hold Ace-King than pocket Aces. Always measure your hand against their entire range, not the single scariest hand.</p>
              <p>See <a href="#learn-decides">how the drill decides</a> for how this idea is used when it grades you.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">Combo Frequency</span>
              <code>Pocket Pair: 6 combos · Suited Cards: 4 combos · Offsuit Cards: 12 combos</code>
            </div>
            <div data-type="pt-concept-takeaway">
              <strong>The Table Rule</strong>
              Never play against the monster in your head. Score your hand against every combo they would play this way.
            </div>
          </article>

          <!-- 5. Blockers -->
          <article data-type="pt-concept-card" id="learn-blockers">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">05 · CARD REMOVAL</span>
              <h3>Blockers: How Your Cards Shrink Their Range</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The Dilemma</strong>
              Deciding whether to fire a big river bluff or make a tough hero call.
            </div>
            <div data-type="pt-concept-body">
              <p><strong>Your cards erase their holdings.</strong> Only four cards of each rank exist in the deck. The two cards in your hand are cards your opponent physically cannot possess.</p>
              <p><strong>Halving their best hands.</strong> There are 6 ways to hold pocket Aces. If you hold the A♠, only 3 ways remain. Your single Ace cuts their chance of holding AA by 50%. On a three-flush board, holding the Ace of that suit guarantees they cannot have the nut flush—making bluffs far more lethal.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">Card Removal</span>
              <code>Opponent AA: 6 combos → You hold an Ace: 3 combos remain (-50%)</code>
            </div>
            <div data-type="pt-concept-takeaway">
              <strong>The Table Rule</strong>
              Hold the key ace or king to bluff with confidence; fold when your cards don't block their value hands.
            </div>
          </article>

          <!-- 6. GTO -->
          <article data-type="pt-concept-card" id="learn-gto">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">06 · STRATEGY REALITY</span>
              <h3>GTO vs Pot Odds: Solvers vs Table Reality</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The Dilemma</strong>
              Wondering whether you need to memorize complex computer GTO trees to win at poker.
            </div>
            <div data-type="pt-concept-body">
              <p><strong>What GTO actually solves.</strong> Real Game Theory Optimal play balances your entire range across every street and bet size so opponents cannot exploit you. It takes minutes to hours of desktop solver compute per spot.</p>
              <p><strong>What wins at real tables.</strong> Most human opponents do not play balanced GTO. Pot odds solve the immediate, practical table test: <em>"Does calling right now make chips against what they actually do?"</em> That is exact, instant, and directly profitable.</p>
              <p>See <a href="#learn-decides">how the drill decides</a> for how this idea is used when it grades you.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">The Real Distinction</span>
              <code>Pot Odds = Immediate chip profit (+EV)  |  GTO = Balanced defensive equilibrium</code>
            </div>
            <div data-type="pt-concept-takeaway">
              <strong>The Table Rule</strong>
              Use pot odds to exploit real table mistakes; don't overcomplicate spots with solver theory against unbalanced players.
            </div>
          </article>

          <!-- 7. Pot-Limit Omaha -->
          <article data-type="pt-concept-card" id="learn-omaha">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">07 · GAME VARIANT</span>
              <h3>Pot-Limit Omaha: The Mandatory 2-and-3 Rule</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The Dilemma</strong>
              Hold'em players moving to Omaha think any combination of 5 cards makes their hand.
            </div>
            <div data-type="pt-concept-body">
              <p><strong>The rule that costs Hold'em players stacks.</strong> In Omaha, you are dealt 4 hole cards, but you MUST use strictly two cards from your hand and strictly three cards from the board. No exceptions.</p>
              <p><strong>One card is never a flush.</strong> If four hearts sit on the board and you hold the lone Ace of hearts, you have zero flush. If four Kings are on the board, you do not have four of a kind unless you hold a King in your hand.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">The Omaha Contract</span>
              <code>Strict Invariant: Exactly 2 From Hand + Exactly 3 From Board = 5 Cards</code>
            </div>
            <div data-type="pt-concept-takeaway">
              <strong>The Table Rule</strong>
              Always verify your Omaha hand uses exactly 2 hole cards and 3 board cards before putting chips in.
            </div>
          </article>

          <!-- 8. Exact Math -->
          <article data-type="pt-concept-card" id="learn-exact">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">08 · ENGINE GUARANTEE</span>
              <h3>Exact Enumeration: Zero Random Guessing</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The Dilemma</strong>
              Most online poker calculators give varying answers on every click because they run random simulations.
            </div>
            <div data-type="pt-concept-body">
              <p><strong>The problem with Monte Carlo.</strong> Random sampling simulators run 10,000 hands and produce random noise that fluctuates by 1% to 2% between queries.</p>
              <p><strong>Count every single runout.</strong> On the flop, exactly 990 possible turn-and-river board combinations exist. On the turn, exactly 44 river cards remain. This trainer scores every single runout deterministically. Every percentage is provably exact.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">Flop Combinations</span>
              <code>Flop Runouts: (45 unseen × 44 unseen) ÷ 2 = 990 exact boards evaluated</code>
            </div>
            <div data-type="pt-concept-takeaway">
              <strong>The Table Rule</strong>
              Trust exact numbers over sampled estimates when calculating thin break-even edges.
            </div>
          </article>

          <!-- 9b. How the drill decides -->
          <article data-type="pt-concept-card" id="learn-decides">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">10 · THIS DRILL</span>
              <h3>How the drill decides</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The Dilemma</strong>
              The drill tells you that you were right or wrong, and you want to know exactly which rules it used to say so.
            </div>
            <div data-type="pt-concept-body">
              <p><strong>Their bet size sets their hands.</strong> Each opponent starts with the hands a player in that seat would play before the flop. Then the size of their bet takes hands away, as a share of the pot before their bet. Up to ${bounds.small[1]}% is a small bet. ${escapeHtml(ptToneNote('small'))} From ${bounds.medium[0]}% to ${bounds.medium[1]}% is a medium bet. ${escapeHtml(ptToneNote('medium'))} From ${bounds.large[0]}% to ${bounds.large[1]}% is a large bet. ${escapeHtml(ptToneNote('large'))} Anything over ${bounds.large[1]}%, and any all-in, is an overbet. ${escapeHtml(ptToneNote('overbet'))}</p>
              <p><strong>A raise, and a thin range.</strong> ${escapeHtml(ptToneNote('large', 'raise'))} On the river there are no draws, so an overbet or a raise also keeps the ${RIVER_BLUFFS} weakest hands that missed completely, as bluffs. If a rule would leave fewer than ${MIN_CONTINUING} hands, ${escapeHtml(fallbackSentence(MIN_CONTINUING).replace(/^Very/, 'very'))}</p>
              <p><strong>The break-even rule.</strong> Calling is right when your equity is above the break-even equity, which is your call divided by the pot after your call. In chips, the EV of calling is your equity times the pot after your call, minus your call, and the drill says fold when that is zero or less.</p>
              <p><strong>The raise model.</strong> When there is one opponent who is not all in, and you have chips left to raise with, the drill also works out a raise to three times their bet (two and a half times if you cannot afford three, and never more than all of your chips). It guesses that only their stronger hands would call a raise and that every other hand folds. Raise EV is the share that folds times the pot now, plus the share that calls times (your equity against the callers times the bigger pot, minus the chips you add).</p>
              <p><strong>When a raise is the best play.</strong> Raise EV must beat the EV of calling by more than ${RAISE_MARGIN * 100}% of the pot now. The margin is there because the model ignores later streets. Your equity against the callers must also be at least the equity you need if called. That is the rule against pure bluffs: the drill never recommends a raise that only works because they fold, since how often they fold is a guess.</p>
              <p><strong>Two opponents.</strong> The drill grades the call only, because a raise would have to be answered by both of them.</p>
              <p><strong>Every number is counted, never sampled.</strong> The drill adds up every pair of hands they could hold and every set of cards that could still come. When that is too much to count in a browser, it deals a later street instead of estimating.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">The Two Rules</span>
              <code>Call if: your equity &gt; break-even equity · Raise if: Raise EV &gt; EV of calling + ${RAISE_MARGIN * 100}% of pot now</code>
            </div>
            <div data-type="pt-concept-takeaway">
              <strong>The Table Rule</strong>
              Work out the break-even equity before you answer, then check yourself against the numbers the drill shows afterwards.
            </div>
          </article>

          <!-- 9. Quant Prep -->
          <article data-type="pt-concept-card" id="quant-prep">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">09 · INTERVIEW APPLICATION</span>
              <h3>Quantitative Trading: Why Quants Care About Poker</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The Dilemma</strong>
              Why top trading firms like Jane Street, SIG, and Citadel grill candidates on poker during interviews.
            </div>
            <div data-type="pt-concept-body">
              <p><strong>Poker is market making under incomplete information.</strong> Traders price risk under uncertainty. Calling a poker bet is identical to buying an asset when you don't know the full order book.</p>
              <p><strong>Expected value discipline.</strong> Firms test whether you separate decision quality from short-term luck. If an investment or call has positive expectation (+EV), making it is correct even if variance causes it to lose today.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">Trading Decision Rule</span>
              <code>Expected Value = (Win% × Total Pot) − Call Price > 0</code>
            </div>
            <div data-type="pt-concept-takeaway">
              <strong>The Table Rule</strong>
              Focus entirely on positive expected value (+EV); ignore short-term variance.
            </div>
          </article>
        </div>
      </div>
    `
  }

  /* ─────────────────────────────  solve  ───────────────────────────── */

  private buildSolve() {
    const host = this.querySelector('[data-panel="solve"]') as HTMLElement
    host.innerHTML = `
      <div data-type="pt-solve">
        <div data-type="pt-controls">
          <label>Game
            <select data-field="variant">
              <option value="holdem">Texas Hold'em — 2 cards</option>
              <option value="plo">Pot-Limit Omaha — 4 cards, play exactly 2</option>
            </select>
          </label>
          <label>They hold
            <select data-field="villainMode">
              <option value="hand">A specific hand</option>
              <option value="range">A range of hands</option>
            </select>
          </label>
        </div>

        <div data-type="pt-solve-table">
          <div data-type="pt-table-watermark">EQUITY LAB</div>

          <!-- Top: Villain Slot -->
          <div data-type="pt-slot" data-slot="villain">
            <button data-select="villain" type="button">
              <span data-type="pt-slot-name">Their Hand (Villain)</span>
              <span data-type="pt-slot-status">Click to pick</span>
            </button>
            <div data-type="pt-cards" data-for="villain"></div>
          </div>

          <div data-type="pt-rangebox" hidden>
            <div data-type="pt-rangebox-top">
              <label>Opponent Range
                <select data-field="preset">
                  ${PRESET_RANGES.map(r => `<option value="${r.id}">${r.label}</option>`).join('')}
                  <option value="custom">Custom…</option>
                </select>
              </label>
              <input data-field="rangeText" type="text" spellcheck="false" value="${PRESET_RANGES[0].text}" />
            </div>
            <p data-type="pt-note">Shorthand: <code>77+</code> pair and up, <code>ATs+</code> suited A10-AK, <code>AKo</code> offsuit, <code>A5s-A2s</code> span.</p>
            <p data-type="pt-rangeinfo"></p>
          </div>

          <!-- Center: Community Board -->
          <div data-type="pt-slot" data-slot="board">
            <button data-select="board" type="button">
              <span data-type="pt-slot-name">Community Board</span>
              <span data-type="pt-slot-status">0, 3, 4, or 5 cards</span>
            </button>
            <div data-type="pt-cards" data-for="board"></div>
          </div>

          <!-- Bottom: Hero Slot -->
          <div data-type="pt-slot" data-slot="hero">
            <button data-select="hero" type="button">
              <span data-type="pt-slot-name">Your Hand (Hero)</span>
              <span data-type="pt-slot-status">Click to pick</span>
            </button>
            <div data-type="pt-cards" data-for="hero"></div>
          </div>
        </div>

        <div data-type="pt-picker">
          <div data-type="pt-picker-top">
            <p data-type="pt-picker-hint"></p>
            <div data-type="pt-picker-actions">
              <button data-action="deal" type="button">Deal random spot</button>
              <button data-action="clear" type="button">Clear all</button>
            </div>
          </div>
          <div data-type="pt-grid"></div>
        </div>

        <output data-type="pt-result" role="status" aria-live="polite"></output>

        <section data-type="pt-odds">
          <h2>Should you call?</h2>
          ${ptTerm('What are pot odds?', 'The price the pot offers you to call. Call 50 into a pot of 100 (their bet included): you risk 50 to win 100, the final pot is 150, and you break even at 50 ÷ 150 = 33.3%. This box wants the pot before your call, with their bet already in it. If your hand equity is higher than the break-even price, calling makes chips over time.')}
          <div data-type="pt-odds-inputs">
            <label>Pot before your call
              <input data-field="pot" type="number" min="0" step="1" value="100" />
            </label>
            <label>Amount to call
              <input data-field="bet" type="number" min="1" step="1" value="50" />
            </label>
          </div>
          <div data-type="pt-odds-out"></div>
        </section>
      </div>
    `

    // Suit-major, so each of the four rows is one suit across all thirteen
    // ranks. Rank-major fills the same 13-wide grid diagonally and the deck
    // becomes unreadable — you cannot find a card by looking.
    host.querySelector('[data-type="pt-grid"]')!.innerHTML = SUITS.map(s =>
      PT_RANKS.map(r => `
        <button data-type="pt-pick" data-card="${r}${s}" type="button"
          aria-label="${RANK_LABEL[r]}${SUIT_SYMBOL[s]}">${cardSvg({ r, s })}</button>
      `).join(''),
    ).join('')

    this.wireSolve(host)
  }

  private capacity(slot: PtSlot): number {
    return slot === 'board' ? 5 : holeCount(this.variant)
  }

  private slotCards(slot: PtSlot): Card[] {
    return slot === 'hero' ? this.hero : slot === 'villain' ? this.villain : this.board
  }

  private wireSolve(host: HTMLElement) {
    host.querySelector('[data-type="pt-grid"]')!.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-card]')
      if (!button) return
      const raw = button.dataset.card!
      const card: Card = { r: Number(raw.slice(0, -1)), s: raw.slice(-1) as Suit }
      const key = ptKey(card)

      // Clicking a card already in play removes it, wherever it sits. Otherwise
      // a mis-click means hunting for which slot holds it.
      for (const slot of ['hero', 'villain', 'board'] as PtSlot[]) {
        const cards = this.slotCards(slot)
        const at = cards.findIndex(c => ptKey(c) === key)
        if (at >= 0) {
          cards.splice(at, 1)
          this.renderSolve()
          return
        }
      }

      const target = this.slotCards(this.picking)
      if (target.length >= this.capacity(this.picking)) return
      target.push(card)
      if (target.length === this.capacity(this.picking)) {
        this.picking = this.picking === 'hero' ? (this.villainMode === 'range' ? 'board' : 'villain')
          : this.picking === 'villain' ? 'board' : 'board'
      }
      this.renderSolve()
    })

    for (const button of host.querySelectorAll<HTMLElement>('[data-select]')) {
      button.addEventListener('click', () => {
        this.picking = button.dataset.select as PtSlot
        this.renderSolve()
      })
    }

    host.querySelector('[data-action="clear"]')!.addEventListener('click', () => {
      this.hero = []
      this.villain = []
      this.board = []
      this.picking = 'hero'
      this.renderSolve()
    })

    host.querySelector('[data-action="deal"]')!.addEventListener('click', () => {
      const deck = ptShuffledDeck()
      const n = holeCount(this.variant)
      this.hero = deck.slice(0, n)
      this.villain = deck.slice(n, n * 2)
      this.board = deck.slice(n * 2, n * 2 + 3)
      this.picking = 'board'
      this.renderSolve()
    })

    host.querySelector('[data-field="variant"]')!.addEventListener('change', event => {
      this.variant = (event.target as HTMLSelectElement).value as Variant
      // Hole-card capacity changed under the existing selection, so anything
      // that no longer fits is dropped rather than left in an impossible state.
      this.hero = []
      this.villain = []
      this.picking = 'hero'
      // Ranges are Hold'em shorthand; Omaha ranges are a different notation
      // entirely (four cards), so the option is withdrawn rather than
      // silently producing two-card combos against a four-card hand.
      if (this.variant === 'plo') this.villainMode = 'hand'
      const modeSelect = host.querySelector('[data-field="villainMode"]') as HTMLSelectElement
      modeSelect.disabled = this.variant === 'plo'
      modeSelect.value = this.villainMode
      this.renderSolve()
    })

    host.querySelector('[data-field="villainMode"]')!.addEventListener('change', event => {
      this.villainMode = (event.target as HTMLSelectElement).value as 'hand' | 'range'
      if (this.picking === 'villain' && this.villainMode === 'range') this.picking = 'board'
      this.renderSolve()
    })

    host.querySelector('[data-field="preset"]')!.addEventListener('change', event => {
      const id = (event.target as HTMLSelectElement).value
      const preset = PRESET_RANGES.find(p => p.id === id)
      if (preset) {
        this.rangeText = preset.text
        ;(host.querySelector('[data-field="rangeText"]') as HTMLInputElement).value = preset.text
      }
      this.renderSolve()
    })

    host.querySelector('[data-field="rangeText"]')!.addEventListener('input', event => {
      this.rangeText = (event.target as HTMLInputElement).value
      ;(host.querySelector('[data-field="preset"]') as HTMLSelectElement).value = 'custom'
      this.renderSolve()
    })

    for (const field of ['pot', 'bet'] as const) {
      host.querySelector(`[data-field="${field}"]`)!.addEventListener('input', event => {
        const value = Number((event.target as HTMLInputElement).value)
        if (field === 'pot') this.pot = Math.max(0, value)
        else this.bet = Math.max(1, value)
        this.renderSolve()
      })
    }
  }

  private renderSolve() {
    const host = this.querySelector('[data-panel="solve"]') as HTMLElement
    const used = new Set([...this.hero, ...this.villain, ...this.board].map(ptKey))

    const rangeBox = host.querySelector('[data-type="pt-rangebox"]') as HTMLElement
    rangeBox.hidden = this.villainMode !== 'range'
    const villainSlot = host.querySelector('[data-slot="villain"]') as HTMLElement
    villainSlot.hidden = this.villainMode === 'range'

    for (const slot of ['hero', 'villain', 'board'] as PtSlot[]) {
      const cardsHost = host.querySelector(`[data-for="${slot}"]`)!
      const cards = this.slotCards(slot)
      cardsHost.innerHTML = ptCards(cards)
        || `<span data-type="pt-empty">${'·'.repeat(this.capacity(slot))}</span>`
      host.querySelector(`[data-slot="${slot}"]`)!
        .toggleAttribute('data-active', slot === this.picking)
    }

    for (const button of host.querySelectorAll<HTMLElement>('[data-card]')) {
      button.toggleAttribute('data-used', used.has(button.dataset.card!))
    }

    const hint = host.querySelector('[data-type="pt-picker-hint"]')!
    const cards = this.slotCards(this.picking)
    hint.textContent = `Picking ${this.picking === 'hero' ? 'your hand' : this.picking === 'villain' ? 'their hand' : 'the board'} — ${cards.length} of ${this.capacity(this.picking)}. Click a card in play to take it back.`

    if (this.villainMode === 'range') this.renderRangeInfo(host)
    this.renderResult(host)
    this.renderOdds(host)
  }

  /**
   * The villain range for the current text and dead cards.
   *
   * Memoised, because three separate readers ask for it on every single render —
   * the "N possible hands" line, the result table and the pot-odds panel — and
   * re-parsing a wide range three times per keystroke is the same waste as
   * re-enumerating, one order of magnitude down. It also gives the combo list a
   * stable identity, which is what lets the equity memo behind it hit at all.
   */
  private currentRange(): ParsedCombos {
    return cachedRangeCombos(this.rangeText, [...this.hero, ...this.board])
  }

  private renderRangeInfo(host: HTMLElement) {
    const info = host.querySelector('[data-type="pt-rangeinfo"]') as HTMLElement
    const { combos, dropped } = this.currentRange()
    const blocked = dropped.length
      ? ` Ignored: ${dropped.join(', ')} — not valid shorthand.`
      : ''
    info.textContent = `${combos.length} possible hands after removing the cards you and the board hold.${blocked}`
  }

  private renderResult(host: HTMLElement) {
    const out = host.querySelector('[data-type="pt-result"]') as HTMLElement
    out.replaceChildren()
    const need = holeCount(this.variant)

    if (this.hero.length !== need) {
      out.dataset.state = ''
      out.textContent = `Pick ${need} cards for your hand to see exact equity.`
      return
    }
    if (this.board.length === 1 || this.board.length === 2) {
      out.dataset.state = ''
      out.textContent = 'A board is 0, 3, 4 or 5 cards — add one more to reach the flop.'
      return
    }

    if (this.villainMode === 'range') return this.renderRangeResult(out)

    if (this.villain.length !== need) {
      out.dataset.state = ''
      out.textContent = `Pick ${need} cards for their hand too — or switch "They hold" to a range, which is what you actually face at a table.`
      return
    }

    const cost = handsRanked([this.hero, this.villain], this.board, this.variant)
    if (cost > PT_MAX_RANK_WORK) {
      const boards = countRunouts([this.hero, this.villain], this.board)
      // Any three cards stand in for a flop here: both helpers read the board's
      // LENGTH, never its contents, so a stand-in that collides with a card in
      // play still gives the right count.
      const flop: Card[] = [{ r: 2, s: 'c' }, { r: 3, s: 'c' }, { r: 4, s: 'c' }]
      const onFlop = handsRanked([this.hero, this.villain], flop, this.variant)
      const scale = this.variant === 'plo'
        ? `${boards.toLocaleString()} boards, and in Omaha every board is the best of 60 five-card hands — ${cost.toLocaleString()} hands to rank`
        : `${boards.toLocaleString()} boards, which is ${cost.toLocaleString()} five-card hands to rank`
      out.dataset.state = 'warn'
      out.textContent = `That spot is ${scale}, which no browser will get through without freezing. Deal a flop and it drops to ${onFlop.toLocaleString()}. Nothing here is ever sampled, so it refuses rather than estimating.`
      return
    }

    const result = cachedExactEquity([this.hero, this.villain], this.board, this.variant)
    out.dataset.state = 'ok'

    const lines: Array<[string, string]> = []
    if (this.variant === 'holdem') {
      lines.push([`Your equity (${handClass(this.hero)})`, pct2(result.equity[0])])
      lines.push([`Their equity (${handClass(this.villain)})`, pct2(result.equity[1])])
    } else {
      lines.push(['Your equity', pct2(result.equity[0])])
      lines.push(['Their equity', pct2(result.equity[1])])
    }
    lines.push(['Split pot', pct2(result.tie[0])])
    lines.push(['Runouts counted', `${result.runouts.toLocaleString()} — every one, none sampled`])

    if (this.board.length === 5) {
      lines.splice(2, 0,
        ['You have', rankHand(this.hero, this.board, this.variant).name],
        ['They have', rankHand(this.villain, this.board, this.variant).name],
      )
    }

    const heroPct = (result.equity[0] * 100).toFixed(1)
    const villainPct = (result.equity[1] * 100).toFixed(1)
    const tiePct = (result.tie[0] * 100).toFixed(1)
    const heroMade = this.board.length >= 3 ? rankHand(this.hero, this.board, this.variant).name : handClass(this.hero)
    const villainMade = this.board.length >= 3 ? rankHand(this.villain, this.board, this.variant).name : handClass(this.villain)

    const duel = this.duelMeter(
      `Hero (${heroMade})`,
      heroPct,
      `Villain (${villainMade})`,
      villainPct,
      `${result.runouts.toLocaleString()} exact runouts counted`,
      this.variant === 'plo' ? 'Pot-Limit Omaha' : "Texas Hold'em",
      tiePct,
    )
    out.append(duel)
    out.append(this.table(lines))

    // Outs are a Hold'em teaching device and the rule of 2 and 4 is calibrated
    // for it; the same count in Omaha is misleading because a four-card hand has
    // many more ways to improve. So it is shown only where it is honest.
    if (this.variant === 'holdem' && (this.board.length === 3 || this.board.length === 4)) {
      const outs = outsAgainst(this.hero, this.villain, this.board)
      if (outs.length) {
        const streets = this.board.length === 3 ? 2 : 1
        const shortcut = (outs.length * (streets === 2 ? 4 : 2)) / 100
        const heading = document.createElement('h3')
        heading.textContent = `${outs.length} outs that put you ahead`
        const cardRow = document.createElement('div')
        cardRow.dataset.type = 'pt-outs'
        cardRow.innerHTML = ptCards(outs)
        const note = document.createElement('p')
        note.dataset.type = 'pt-note'
        note.textContent = `The 4-2 rule estimates ${pct2(shortcut)} (${outs.length} outs × ${streets === 2 ? 4 : 2}); exact equity is ${pct2(result.equity[0])}. The shortcut runs high because some of these cards also improve their hand.`
        out.append(heading, cardRow, note)
      }
    }
  }

  private renderRangeResult(out: HTMLElement) {
    const { combos } = this.currentRange()
    if (!combos.length) {
      out.dataset.state = 'warn'
      out.textContent = 'That range has no hands left once your cards and the board are removed.'
      return
    }
    const work = rangeWork(combos.length, this.board)
    if (work > PT_MAX_RANGE_WORK * 4) {
      out.dataset.state = 'warn'
      out.textContent = `${combos.length} hands against ${this.board.length ? 'this board' : 'no board'} is ${work.toLocaleString()} runouts to count — too many for a browser. Narrow the range, or deal another board card. Nothing here is sampled, so it refuses rather than estimating.`
      return
    }

    const result = cachedEquityVsRange(this.hero, combos, this.board)
    out.dataset.state = 'ok'
    const heroPct = (result.equity * 100).toFixed(1)
    const rangePct = ((1 - result.equity) * 100).toFixed(1)
    const heroMade = this.board.length >= 3 ? rankHand(this.hero, this.board, this.variant).name : handClass(this.hero)

    const duel = this.duelMeter(
      `Hero (${heroMade})`,
      heroPct,
      'Opponent Range',
      rangePct,
      `Ahead of <strong>${pct(result.aheadOf)}</strong> of ${result.combos} hands`,
      `${result.runouts.toLocaleString()} exact runouts counted`,
    )
    out.append(duel)
    out.append(this.table([
      ['Your equity against the whole range', pct2(result.equity)],
      ['Hands in their range', String(result.combos)],
      ['Share of range you beat', `${pct(result.aheadOf)}`],
      ['Runouts counted', `${result.runouts.toLocaleString()} — every one, none sampled`],
    ]))

    const splits = document.createElement('div')
    splits.dataset.type = 'pt-splits'
    splits.innerHTML = `
      <div><h3>Hands You Are Behind</h3>${result.worst.map(w => `<div data-type="pt-comborow">${ptCards(w.hand)}<span>${pct(w.equity)}</span></div>`).join('')}</div>
      <div><h3>Hands You Are Ahead Of</h3>${result.best.map(w => `<div data-type="pt-comborow">${ptCards(w.hand)}<span>${pct(w.equity)}</span></div>`).join('')}</div>
    `
    out.append(splits)
  }

  private table(rows: Array<[string, string]>): HTMLTableElement {
    const table = document.createElement('table')
    table.dataset.type = 'pt-lines'
    for (const [label, value] of rows) {
      const tr = document.createElement('tr')
      const th = document.createElement('th')
      th.textContent = label
      const td = document.createElement('td')
      td.textContent = value
      tr.append(th, td)
      table.append(tr)
    }
    return table
  }

  private duelMeter(
    heroLabel: string,
    heroPct: string,
    villainLabel: string,
    villainPct: string,
    metaLeft: string,
    metaRight: string,
    tiePct?: string,
  ): HTMLElement {
    const duel = document.createElement('div')
    duel.dataset.type = 'pt-duel-meter'
    const splitHtml = tiePct && Number(tiePct) > 0
      ? `<div data-type="pt-duel-split">Split: ${tiePct}%</div>`
      : ''
    duel.innerHTML = `
      <div data-type="pt-duel-labels">
        <div data-type="pt-duel-player" data-player="hero">
          <span data-type="pt-duel-name">${heroLabel}</span>
          <span data-type="pt-duel-pct">${heroPct}%</span>
        </div>
        ${splitHtml}
        <div data-type="pt-duel-player" data-player="villain">
          <span data-type="pt-duel-pct">${villainPct}%</span>
          <span data-type="pt-duel-name">${villainLabel}</span>
        </div>
      </div>
      <div data-type="pt-duel-track">
        <div data-type="pt-duel-fill" data-player="hero" style="width: ${heroPct}%"></div>
        <div data-type="pt-duel-fill" data-player="villain" style="width: ${villainPct}%"></div>
      </div>
      <div data-type="pt-duel-meta">
        <span>${metaLeft}</span>
        <span>${metaRight}</span>
      </div>
    `
    return duel
  }

  /** Hero equity for the odds panel, or null when the spot is not computable. */
  private heroEquity(): number | null {
    const need = holeCount(this.variant)
    if (this.hero.length !== need) return null
    if (this.board.length === 1 || this.board.length === 2) return null

    if (this.villainMode === 'range') {
      const { combos } = this.currentRange()
      if (!combos.length) return null
      if (rangeWork(combos.length, this.board) > PT_MAX_RANGE_WORK * 4) return null
      return cachedEquityVsRange(this.hero, combos, this.board).equity
    }

    if (this.villain.length !== need) return null
    if (handsRanked([this.hero, this.villain], this.board, this.variant) > PT_MAX_RANK_WORK) return null
    return cachedExactEquity([this.hero, this.villain], this.board, this.variant).equity[0]
  }

  private renderOdds(host: HTMLElement) {
    const target = host.querySelector('[data-type="pt-odds-out"]') as HTMLElement
    target.replaceChildren()

    let required: number
    try {
      required = requiredEquity(this.pot, this.bet)
    } catch (error) {
      target.textContent = error instanceof Error ? error.message : String(error)
      return
    }

    const equity = this.heroEquity()
    let ev: number | null = null
    if (equity !== null) {
      ev = callEv(this.pot, this.bet, equity)
      const evCard = document.createElement('div')
      evCard.dataset.type = 'pt-odds-ev-card'
      const isPositive = ev > 0
      const isBreakEven = Math.abs(ev) < 0.01
      evCard.dataset.verdict = isPositive ? 'win' : isBreakEven ? 'even' : 'lose'
      evCard.innerHTML = `
        <div data-type="pt-ev-headline">
          <span data-type="pt-ev-pill">${isPositive ? '+EV CALL' : isBreakEven ? 'BREAK-EVEN' : '-EV FOLD'}</span>
          <span data-type="pt-ev-chips">${ev >= 0 ? '+' : ''}${ev.toFixed(1)} chips</span>
        </div>
        <p data-type="pt-ev-detail">
          ${isPositive
            ? `Calling makes money (+${ev.toFixed(1)} chips on average). Your equity (${pct2(equity)}) exceeds the break-even price of ${pct2(required)}.`
            : isBreakEven
            ? `Break-even decision. Your equity (${pct2(equity)}) exactly equals the required price (${pct2(required)}).`
            : `Calling loses money (${ev.toFixed(1)} chips on average). Your equity (${pct2(equity)}) is below the break-even price of ${pct2(required)}.`
          }
        </p>
      `
      target.append(evCard)
    }

    const rows: Array<[string, string]> = [
      ['You must win at least this often', pct2(required)],
      ['Pot odds', `${(this.pot / this.bet).toFixed(2)} : 1`],
    ]

    if (equity !== null && ev !== null) {
      rows.push(['You actually win this often', pct2(equity)])
      rows.push(['Value of calling', `${ev >= 0 ? '+' : ''}${ev.toFixed(2)} chips`])
      rows.push([
        'So',
        ev > 0 ? 'Calling makes money — your equity beats the price.'
          : ev < 0 ? 'Calling loses money at this price.'
          : 'Exactly break-even.',
      ])
    }

    const note = document.createElement('p')
    note.dataset.type = 'pt-note'
    note.textContent = 'This assumes the hand goes to showdown with no further betting — the assumption every pot-odds lesson makes silently.'
    target.append(this.table(rows), note)
  }
}

if (!customElements.get('poker-trainer-game')) {
  customElements.define('poker-trainer-game', PokerTrainerGame)
}
