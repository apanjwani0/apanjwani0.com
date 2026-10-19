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
 * approximate — see PT_MAX_RANK_WORK and PT_MAX_RANGE_WORK.
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
  type Variant,
} from './engine/equity'
import {
  cachedEquityVsRange,
  cachedExactEquity,
  cachedRangeCombos,
  type ParsedCombos,
} from './engine/equity-cache'
import { PRESET_RANGES, parseRange, rangeCombos } from './engine/ranges'
import { cardBackSvg, cardSvg } from './ui/cards-svg'
import { chipSvg, chipStackSvg, type ChipValue } from './ui/assets-svg'
import { RANK_LABEL, SUITS, SUIT_SYMBOL, type Card, type Suit } from './engine/types'
import { copyText } from '../../../lib/flash'

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

/**
 * The same ceiling for range queries, where cost is combos x runouts.
 *
 * This is what decides which street a drill is dealt on, so it is a lesson
 * setting and not only a speed one: the drill picks the street to fit the range
 * rather than capping the range to fit the street, because a wide range is the
 * interesting case and narrowing it to keep the flop would be optimising the
 * lesson away to preserve a cosmetic preference.
 *
 * It was also chosen against a much slower enumerator — a 570-combo button range
 * on a flop is 564,300 boards, which used to be half a minute of blocking work
 * and now measures ~115ms. Widening it would move drills onto earlier streets,
 * which changes what the drill teaches, so it is left where it is deliberately
 * rather than by omission.
 */
const PT_MAX_RANGE_WORK = 60_000

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

function ptParseCard(str: string): Card | null {
  if (!str) return null
  const s = str.trim().toLowerCase()
  if (s.length < 2 || s.length > 3) return null
  const rankStr = s.slice(0, s.length - 1)
  const suitChar = s.slice(-1) as Suit
  if (!SUITS.includes(suitChar)) return null
  let rank: number
  if (rankStr === 'a') rank = 14
  else if (rankStr === 'k') rank = 13
  else if (rankStr === 'q') rank = 12
  else if (rankStr === 'j') rank = 11
  else if (rankStr === 't' || rankStr === '10') rank = 10
  else {
    const n = Number(rankStr)
    if (n >= 2 && n <= 9) rank = n
    else return null
  }
  return { r: rank, s: suitChar }
}

function ptParseCards(str: string): Card[] {
  if (!str) return []
  const matches = str.match(/(?:10|[2-9tjqka])[cdhs]/gi)
  if (!matches) return []
  const cards: Card[] = []
  for (const m of matches) {
    const c = ptParseCard(m)
    if (c) cards.push(c)
  }
  return cards
}

function ptFormatCard(c: Card): string {
  const r = c.r === 10 ? 'T' : (RANK_LABEL[c.r] ?? String(c.r))
  return `${r}${c.s}`
}

function ptFormatCardsDisplay(cards: Card[]): string {
  return cards.map(c => `${RANK_LABEL[c.r] ?? c.r}${SUIT_SYMBOL[c.s] ?? c.s}`).join(' ')
}

function ptHasDuplicates(cards: Card[]): boolean {
  const seen = new Set<string>()
  for (const c of cards) {
    const k = ptKey(c)
    if (seen.has(k)) return true
    seen.add(k)
  }
  return false
}

function ptSpotUrl(d: PtDrill): string {
  const heroStr = d.hero.map(ptFormatCard).join('')
  const boardStr = d.board.map(ptFormatCard).join('')
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://apanjwani0.com'
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/games/poker-trainer'
  return `${origin}${pathname}?hero=${heroStr}&board=${boardStr}&pot=${d.pot}&bet=${d.bet}&range=${d.rangeId}`
}

/** A term the reader may not know, defined inline on click rather than in a glossary. */
function ptTerm(term: string, definition: string): string {
  return `<details data-type="pt-term"><summary>${term}</summary><p>${definition}</p></details>`
}

/** Realistic casino pot chip stacks cluster and prominent value badge. */
function ptPotCluster(pot: number, bet: number, isFinal = false, betChipVal: ChipValue = 25): string {
  const total = isFinal ? pot : pot + bet
  const sideChip: ChipValue = betChipVal === 100 ? 25 : betChipVal
  return `
    <div data-type="pt-pot-cluster">
      <div data-type="pt-pot-stacks" aria-hidden="true">
        <span data-type="pt-pot-stack" data-chip="25">${chipStackSvg(sideChip, 3)}</span>
        <span data-type="pt-pot-stack" data-chip="100">${chipStackSvg(100, 5)}</span>
        <span data-type="pt-pot-stack" data-chip="${betChipVal}">${chipStackSvg(betChipVal, 4)}</span>
      </div>
      <div data-type="pt-pot-banner">
        <div data-type="pt-pot-meta">
          <span data-type="pt-pot-dot"></span>
          <span data-type="pt-pot-title">${isFinal ? 'FINAL POT' : 'MAIN POT'}</span>
        </div>
        <div data-type="pt-pot-val">
          <strong>${total}</strong> <span data-type="pt-pot-unit">chips</span>
        </div>
        ${!isFinal && bet ? `<span data-type="pt-pot-sub">Current: ${pot} + Bet: ${bet}</span>` : ''}
      </div>
    </div>
  `
}

/** Human coach takeaway explaining the decision in plain table-action terms. */
function ptCoachVerdict(
  choice: PtChoice,
  correct: PtChoice,
  equityPct: string,
  requiredPct: string,
  ev: number,
  bet: number,
  finalPot: number,
  rangeLabel: string,
): { headline: string; detail: string } {
  const potBeforeCall = finalPot - bet
  const potOddsRatio = (potBeforeCall / bet).toFixed(1)
  const evAbs = Math.abs(ev).toFixed(1)
  const evFormatted = `${ev >= 0 ? '+' : '-'}${evAbs}`

  if (correct === 'raise') {
    if (choice === 'raise') {
      return {
        headline: 'Good raise. You are well ahead of their range.',
        detail: `With <strong>${equityPct}% equity</strong> against ${rangeLabel}, you win most runouts. Raising gets more chips in while you are ahead and makes them pay to see more cards.`,
      }
    }
    if (choice === 'call') {
      return {
        headline: 'Profitable call, but raising was even stronger.',
        detail: `Calling is profitable (+EV), but with <strong>${equityPct}% equity</strong> against ${rangeLabel}, raising charges draws and builds a bigger pot while you are ahead.`,
      }
    }
    return {
      headline: 'Costly mistake. You folded a strong hand.',
      detail: `You had <strong>${equityPct}% equity</strong> against ${rangeLabel}, so you win most runouts. Folding gave up a pot you were favoured to win.`,
    }
  }

  if (correct === 'call') {
    if (choice === 'call') {
      return {
        headline: "Profitable call. You're getting the right price to continue.",
        detail: `The pot offers <strong>${potOddsRatio}:1 pot odds</strong> (calling ${bet} to contest a ${finalPot} chip pot). You needed <strong>${requiredPct}%</strong> equity to break even, and your hand has <strong>${equityPct}%</strong> against ${rangeLabel} (${evFormatted} chips EV).`,
      }
    }
    if (choice === 'raise') {
      return {
        headline: 'Overplayed hand. Calling was the high-EV line.',
        detail: `You have <strong>${equityPct}% equity</strong>—enough to comfortably call the ${potOddsRatio}:1 price, but raising risks turning a profitable calling hand into an unnecessary bluff.`,
      }
    }
    return {
      headline: 'Missed value. You were offered a big pot discount.',
      detail: `The pot offered <strong>${potOddsRatio}:1 pot odds</strong>, requiring only <strong>${requiredPct}%</strong> equity to break even. With <strong>${equityPct}%</strong> against ${rangeLabel}, folding surrendered ${evAbs} chips in expected value.`,
    }
  }

  // correct === 'fold'
  if (choice === 'fold') {
    return {
      headline: 'Disciplined fold. The price was too high for your hand.',
      detail: `Calling required <strong>${requiredPct}%</strong> equity, but your hand only wins <strong>${equityPct}%</strong> against ${rangeLabel}. Calling would bleed ${evAbs} chips over time.`,
    }
  }
  if (choice === 'raise') {
    return {
      headline: 'Spewing chips. Bluffing into a range that has you crushed.',
      detail: `Your hand only has <strong>${equityPct}% equity</strong> against ${rangeLabel}. Pushing chips into a stronger range without fold equity loses money fast.`,
    }
  }
  return {
    headline: 'Overpaying. You chased a negative-expectation bet.',
    detail: `Calling costs ${bet} chips to win ${finalPot}, demanding <strong>${requiredPct}%</strong> equity to break even. With only <strong>${equityPct}%</strong> against ${rangeLabel}, this call loses ${evAbs} chips on average.`,
  }
}

interface PtDrill {
  hero: Card[]
  board: Card[]
  rangeId: string
  rangeLabel: string
  rangeNote: string
  combos: Card[][]
  pot: number
  bet: number
  street: string
}

class PokerTrainerGame extends HTMLElement {
  private mode: PtMode = 'drill'

  // Drill state
  private drill: PtDrill | null = null
  private choice: PtChoice | null = null
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
    this.best = Number(localStorage.getItem('pt:best') ?? 0) || 0

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

    const customSpot = this.parseSpotFromUrl()
    if (customSpot) {
      this.drill = customSpot
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
   * Deal a spot: hero's hand, a board, and an opponent RANGE rather than an
   * opponent hand.
   *
   * The street is chosen to fit the range's cost (see PT_MAX_RANGE_WORK), which
   * is why a wide button range tends to arrive on a turn and a tight three-bet
   * range on a flop. That is a real property of the arithmetic, not a random
   * variation, and the UI says which street you are on.
   */
  private deal() {
    const deck = ptShuffledDeck()
    const preset = PRESET_RANGES[crypto.getRandomValues(new Uint32Array(1))[0] % PRESET_RANGES.length]
    const hero = deck.slice(0, 2)

    // Widen the board until the query is affordable. Five cards (a river) is
    // one runout per combo, so this always terminates.
    let boardSize = 3
    let combos = rangeCombos(parseRange(preset.text).classes, [...hero, ...deck.slice(2, 2 + boardSize)])
    while (boardSize < 5 && rangeWork(combos.length, deck.slice(2, 2 + boardSize)) > PT_MAX_RANGE_WORK) {
      boardSize++
      combos = rangeCombos(parseRange(preset.text).classes, [...hero, ...deck.slice(2, 2 + boardSize)])
    }
    const board = deck.slice(2, 2 + boardSize)
    combos = rangeCombos(parseRange(preset.text).classes, [...hero, ...board])

    const pot = 100
    // Bet sizes people actually face: a third, a half, two-thirds, or the pot.
    const sizes = [33, 50, 66, 100]
    const bet = sizes[crypto.getRandomValues(new Uint32Array(1))[0] % sizes.length]

    this.drill = {
      hero,
      board,
      rangeId: preset.id,
      rangeLabel: preset.label,
      rangeNote: preset.note,
      combos,
      pot,
      bet,
      street: boardSize === 3 ? 'flop' : boardSize === 4 ? 'turn' : 'river',
    }
    this.choice = null
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.mode !== 'drill') return
    // Don't intercept if user is typing in an input
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

    const key = e.key.toLowerCase()
    if (!this.choice) {
      if (key === 'f') {
        this.choice = 'fold'
        this.renderDrill()
      } else if (key === 'c') {
        this.choice = 'call'
        this.renderDrill()
      } else if (key === 'r') {
        this.choice = 'raise'
        this.renderDrill()
      }
    } else {
      if (key === ' ' || key === 'enter' || key === 'n') {
        e.preventDefault()
        this.deal()
        this.renderDrill()
      }
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

  private parseSpotFromUrl(): PtDrill | null {
    try {
      const params = new URLSearchParams(window.location.search)
      let heroRaw = params.get('hero') ?? ''
      let boardRaw = params.get('board') ?? ''
      let potRaw = params.get('pot')
      let betRaw = params.get('bet')
      let rangeId = params.get('range') ?? ''

      const spotParam = params.get('spot')
      if (spotParam) {
        const parts = spotParam.includes(':') ? spotParam.split(':') : spotParam.split('-')
        if (parts.length >= 2) {
          heroRaw = parts[0]
          boardRaw = parts[1]
          if (parts[2]) potRaw = parts[2]
          if (parts[3]) betRaw = parts[3]
          if (parts[4]) rangeId = parts[4]
        }
      }

      if (!heroRaw || !boardRaw) return null

      const hero = ptParseCards(heroRaw)
      const board = ptParseCards(boardRaw)
      if (hero.length !== 2 || board.length < 3 || board.length > 5) return null
      if (ptHasDuplicates([...hero, ...board])) return null

      const preset = PRESET_RANGES.find(p => p.id === rangeId) ?? PRESET_RANGES[0]
      const combos = rangeCombos(parseRange(preset.text).classes, [...hero, ...board])
      if (combos.length === 0) return null

      const pot = Math.max(10, Math.min(1000, Number(potRaw) || 100))
      const bet = Math.max(5, Math.min(1000, Number(betRaw) || 50))
      const street = board.length === 3 ? 'flop' : board.length === 4 ? 'turn' : 'river'

      return {
        hero,
        board,
        rangeId: preset.id,
        rangeLabel: preset.label,
        rangeNote: preset.note,
        combos,
        pot,
        bet,
        street,
      }
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

    // Pick a chip token matching bet
    const betChipVal: ChipValue = d.bet >= 100 ? 100 : d.bet >= 25 ? 25 : 5
    const preMade = rankHand(d.hero, d.board, 'holdem')
    const preMadeName = d.board.length >= 3 ? rankHand(d.hero, [...d.board], 'holdem').name : preMade.name

    if (!this.choice) {
      host.innerHTML = `
        <div data-type="pt-spotcard">
          <div data-type="pt-felt">
            <div data-type="pt-felt-header">
              <div data-type="pt-street-group">
                <span data-type="pt-beacon"></span>
                <span data-type="pt-street">Street: ${d.street.toUpperCase()} (${d.board.length} Cards)</span>
              </div>
              <div data-type="pt-header-right">
                <div data-type="pt-chip-badge">
                  <span data-type="pt-chip-icon">${chipSvg(betChipVal)}</span>
                  <span>Facing: <strong>${d.bet} chips</strong> into <strong>${d.pot}</strong></span>
                </div>
                <div data-type="pt-streak-pill">
                  <span>Streak: <strong>${this.streak}</strong> 🔥</span>
                </div>
              </div>
            </div>

            ${this.renderDrillTable(d, false, preMadeName, betChipVal)}

            <div data-type="pt-action-strip">
              <div data-type="pt-action-price">
                <span>Price to call: </span><strong>${pct(requiredEquity(d.pot + d.bet, d.bet))}</strong> break-even
              </div>

              <div data-type="pt-choices">
                <button data-choice="fold" type="button">
                  <span>Fold</span>
                  <kbd>F</kbd>
                </button>
                <button data-choice="call" data-variant="primary" type="button">
                  <span>Call ${d.bet}</span>
                  <kbd>C</kbd>
                </button>
                <button data-choice="raise" type="button">
                  <span>Raise</span>
                  <kbd>R</kbd>
                </button>
              </div>
            </div>

            <div data-type="pt-status-bar">
              <span data-type="pt-score">Streak <strong>${this.streak}</strong> · Best <strong>${this.best}</strong></span>
              <button data-action="share-spot" type="button" class="pt-share-btn"><span>🔗 Share spot</span></button>
              <span data-type="pt-shortcut-hint">Tip: Use keys <kbd>F</kbd>, <kbd>C</kbd>, <kbd>R</kbd></span>
            </div>
          </div>
        </div>
      `

      const shareSpotBtn = host.querySelector<HTMLElement>('[data-action="share-spot"]')
      if (shareSpotBtn) {
        shareSpotBtn.addEventListener('click', () => {
          const url = ptSpotUrl(d)
          copyText(url, shareSpotBtn, { copied: '✓ Link copied!' })
        })
      }

      for (const button of host.querySelectorAll<HTMLElement>('[data-choice]')) {
        button.addEventListener('click', () => {
          this.choice = button.dataset.choice as PtChoice
          this.renderDrill()
        })
      }
      return
    }

    // Answered — reveal the arithmetic. Memoised: this render runs again on
    // every tab switch, and re-counting half a million boards to redraw text
    // that cannot have changed is the same bug the Solve tab had.
    const result = cachedEquityVsRange(d.hero, d.combos, d.board)
    const required = requiredEquity(d.pot + d.bet, d.bet)
    const ev = callEv(d.pot + d.bet, d.bet, result.equity)
    const correct: PtChoice = result.equity >= 0.68 ? 'raise'
      : result.equity > required ? 'call'
      : 'fold'
    const right = this.choice === correct
      || (correct === 'raise' && this.choice === 'call')

    if (right) {
      this.streak++
      if (this.streak > this.best) {
        this.best = this.streak
        localStorage.setItem('pt:best', String(this.best))
      }
    } else {
      this.streak = 0
    }

    const made = rankHand(d.hero, d.board.length === 5 ? d.board : d.board, 'holdem')
    const madeName = d.board.length >= 3
      ? rankHand(d.hero, [...d.board], 'holdem').name
      : made.name

    const equityPct = (result.equity * 100).toFixed(1)
    const requiredPct = (required * 100).toFixed(1)

    const finalPot = d.pot + 2 * d.bet
    const coach = ptCoachVerdict(this.choice, correct, equityPct, requiredPct, ev, d.bet, finalPot, d.rangeLabel)
    const past = { fold: 'folded', call: 'called', raise: 'raised' }[this.choice]
    const verdictDetail = this.choice === correct
      ? `You ${past} (${equityPct}% equity vs ${requiredPct}% needed).`
      : correct === 'raise' && this.choice === 'call'
      ? `You called (+EV line); raising had higher value (${equityPct}% equity vs ${requiredPct}% needed).`
      : `You ${past}; math says <strong>${correct}</strong> (${equityPct}% equity vs ${requiredPct}% needed).`

    host.innerHTML = `
      <div data-type="pt-spotcard" data-answered>
        <div data-type="pt-felt" data-felt-verdict="${right ? 'right' : 'wrong'}">
          <div data-type="pt-felt-header">
            <div data-type="pt-street-group">
              <span data-type="pt-beacon"></span>
              <span data-type="pt-street">Street: ${d.street.toUpperCase()} (${d.board.length} Cards)</span>
            </div>
            <div data-type="pt-header-right">
              <div data-type="pt-chip-badge">
                <span data-type="pt-chip-icon">${chipSvg(betChipVal)}</span>
                <span>Final Pot: <strong>${finalPot} chips</strong></span>
              </div>
              <div data-type="pt-streak-pill">
                <span>Streak: <strong>${this.streak}</strong> 🔥</span>
              </div>
            </div>
          </div>

          ${this.renderDrillTable(d, true, madeName, betChipVal)}

          <!-- Immediate verdict and next action in place of action buttons -->
          <div data-type="pt-action-strip" data-answered="true">
            <div data-type="pt-verdict-summary" data-right="${right}">
              <span data-type="pt-verdict-tag">${right ? '✓ Correct' : '✗ Mistake'}</span>
              <span data-type="pt-verdict-detail">${verdictDetail}</span>
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

          <!-- Table Coach Breakdown -->
          <div data-type="pt-coach-card" data-verdict="${right ? 'right' : 'wrong'}">
            <span data-type="pt-coach-headline">${coach.headline}</span>
            <p data-type="pt-coach-detail">${coach.detail}</p>
          </div>

          <!-- Visual Equity vs Pot Odds Threshold Gauge -->
          <div data-type="pt-gauge">
            <div data-type="pt-gauge-labels">
              <span>Your Equity vs Range: <strong>${equityPct}%</strong></span>
              <span>Break-even Price: <strong>${requiredPct}%</strong></span>
            </div>
            <div data-type="pt-gauge-meter" role="meter" aria-valuenow="${equityPct}" aria-valuemin="0" aria-valuemax="100">
              <div data-type="pt-gauge-fill" style="width: ${equityPct}%" data-positive="${result.equity >= required}"></div>
              <div data-type="pt-gauge-target" style="left: ${requiredPct}%" title="Break-even target (${requiredPct}%)"></div>
            </div>
            <div data-type="pt-gauge-ticks">
              <span>0%</span>
              <span data-type="pt-target-tag" style="left: ${requiredPct}%">▲ Break-even threshold (${requiredPct}%)</span>
              <span>100%</span>
            </div>
          </div>

          <!-- Educational Calculation Ledger Cards (Collapsible for progressive disclosure) -->
          <!-- Educational Calculation Ledger (Clean Formula Receipts) -->
          <details data-type="pt-math-details">
            <summary data-type="pt-math-summary">
              <span>📐 Exact Math Breakdown (${equityPct}% equity · ${ev >= 0 ? '+' : ''}${ev.toFixed(1)} chips EV)</span>
              <span data-type="pt-math-toggle-hint">Click to inspect</span>
            </summary>
            <div data-type="pt-math-cards">
              <!-- Card 1: Your Equity -->
              <div data-type="pt-math-card" data-card-kind="equity">
                <div data-type="pt-math-head">
                  <span data-type="pt-math-title">Your Equity</span>
                  <span data-type="pt-math-val">${equityPct}%</span>
                </div>
                <p data-type="pt-math-desc">Wins <strong>${equityPct}%</strong> of ${result.runouts.toLocaleString()} exact runouts vs ${d.rangeLabel}.</p>
                <div data-type="pt-math-ledger">
                  <div data-type="pt-ledger-row">
                    <span data-type="pt-ledger-label">Equation</span>
                    <div data-type="pt-ledger-content">
                      <code>(Wins + 0.5 × Ties) ÷ ${result.runouts.toLocaleString()} runouts = ${equityPct}%</code>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Card 2: Pot Odds -->
              <div data-type="pt-math-card" data-card-kind="potodds">
                <div data-type="pt-math-head">
                  <span data-type="pt-math-title">Equity you needed to call</span>
                  <span data-type="pt-math-val">${requiredPct}%</span>
                </div>
                <p data-type="pt-math-desc">Calling ${d.bet} to contest ${finalPot} (${((finalPot - d.bet) / d.bet).toFixed(1)}:1 pot odds).</p>
                <div data-type="pt-math-ledger">
                  <div data-type="pt-ledger-row">
                    <span data-type="pt-ledger-label">Equation</span>
                    <div data-type="pt-ledger-content">
                      <code>${d.bet} call ÷ ${finalPot} final pot = ${requiredPct}% break-even</code>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Card 3: Expected Value -->
              <div data-type="pt-math-card" data-card-kind="ev">
                <div data-type="pt-math-head">
                  <span data-type="pt-math-title">Expected Value (EV)</span>
                  <span data-type="pt-math-val" data-ev="${ev >= 0 ? 'pos' : 'neg'}">${ev >= 0 ? '+' : ''}${ev.toFixed(1)} chips</span>
                </div>
                <p data-type="pt-math-desc">${ev >= 0 ? `Net gain of +${(ev * 100).toFixed(0)} chips every 100 hands.` : `Net loss of ${(Math.abs(ev) * 100).toFixed(0)} chips every 100 hands.`}</p>
                <div data-type="pt-math-ledger">
                  <div data-type="pt-ledger-row">
                    <span data-type="pt-ledger-label">Equation</span>
                    <div data-type="pt-ledger-content">
                      <code>(${equityPct}% × ${finalPot}) − ${d.bet} = ${ev >= 0 ? '+' : ''}${ev.toFixed(1)} chips</code>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </details>

          <!-- Detailed Combos Breakdown -->
          <div data-type="pt-splits">
            <div data-type="pt-split-col">
              <h3>Hands You Are Behind</h3>
              <div data-type="pt-combos-list">
                ${result.worst.map(w => `
                  <div data-type="pt-comborow">
                    <div data-type="pt-comborow-cards">${ptCards(w.hand)}</div>
                    <span data-type="pt-comborow-eq" data-crushed="true">${pct(w.equity)} equity</span>
                  </div>
                `).join('')}
              </div>
            </div>

            <div data-type="pt-split-col">
              <h3>Hands You Are Ahead Of</h3>
              <div data-type="pt-combos-list">
                ${result.best.map(w => `
                  <div data-type="pt-comborow">
                    <div data-type="pt-comborow-cards">${ptCards(w.hand)}</div>
                    <span data-type="pt-comborow-eq" data-crushed="false">${pct(w.equity)} equity</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

          <details data-type="pt-caveat">
            <summary>Why this grades pot odds and not full GTO</summary>
            <p>This drill grades immediate expected value (+EV): whether calling makes chips against their range right now. Full Game Theory Optimal (GTO) play balances your entire range across all future streets, which requires desktop solver computations.</p>
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
      </div>
    `

    const shareResultBtn = host.querySelector<HTMLElement>('[data-action="share-result"]')
    if (shareResultBtn) {
      shareResultBtn.addEventListener('click', () => {
        const url = ptSpotUrl(d)
        const streetLabel = d.street.toUpperCase()
        const summary = [
          `Poker Trainer — ${streetLabel} Drill`,
          `Hero: ${ptFormatCardsDisplay(d.hero)} | Board: ${ptFormatCardsDisplay(d.board)}`,
          `Facing: ${d.bet} chips into ${d.pot} (${requiredPct}% pot odds needed)`,
          `Exact Equity vs ${d.rangeLabel}: ${equityPct}% (${right ? '✓ +EV Line' : '✗ -EV Line'})`,
          `Practice exact odds: ${url}`,
        ].join('\n')
        copyText(summary, shareResultBtn, { copied: '✓ Copied spot!' })
      })
    }

    const nextHandler = () => {
      this.deal()
      this.renderDrill()
    }
    host.querySelector('[data-action="next"]')!.addEventListener('click', nextHandler)

    const nextBottomBtn = host.querySelector<HTMLElement>('[data-action="next-bottom"]')
    if (nextBottomBtn) {
      nextBottomBtn.addEventListener('click', () => {
        this.deal()
        this.renderDrill()
        const spot = this.querySelector('[data-type="pt-spotcard"]')
        if (spot) spot.scrollIntoView({ behavior: 'smooth' })
      })
    }
  }

  private renderDrillTable(d: PtDrill, isAnswered: boolean, madeName: string, betChipVal: ChipValue): string {
    const ghostCards = !isAnswered && d.board.length === 3
      ? '<span data-type="pt-ghost-card">Turn</span><span data-type="pt-ghost-card">River</span>'
      : !isAnswered && d.board.length === 4
      ? '<span data-type="pt-ghost-card">River</span>'
      : ''

    const villainBetHtml = !isAnswered
      ? `<div data-type="pt-villain-bet">
          <span data-type="pt-chip-stack-mini">${chipStackSvg(betChipVal, 3)}</span>
          <span>Bet: <strong>${d.bet} chips</strong></span>
        </div>`
      : ''

    const potClusterHtml = isAnswered
      ? ptPotCluster(d.pot + 2 * d.bet, 0, true, betChipVal)
      : ptPotCluster(d.pot, d.bet, false, betChipVal)

    return `
      <div data-type="pt-table"${isAnswered ? ' data-table-answered' : ''}>
        <div data-type="pt-table-watermark">POKER TRAINER</div>

        <!-- Top: Opponent Range -->
        <div data-type="pt-seat-villain">
          <div data-type="pt-player-pill">
            <span data-type="pt-player-name">Opponent</span>
            <span data-type="pt-rangetag">${d.rangeLabel}</span>
            <span data-type="pt-combocount">${d.combos.length} combinations</span>
          </div>
          <div data-type="pt-cards" data-cards-villain>
            <span data-type="pt-card-back">${cardBackSvg('slate')}</span>
            <span data-type="pt-card-back">${cardBackSvg('slate')}</span>
          </div>
          ${villainBetHtml}
        </div>

        <!-- Center: Community Board & Pot -->
        <div data-type="pt-table-center">
          ${potClusterHtml}
          <div data-type="pt-cards" data-cards-board>
            ${ptCards(d.board)}
            ${ghostCards}
          </div>
        </div>

        <!-- Bottom: Hero Seat -->
        <div data-type="pt-seat-hero">
          <div data-type="pt-cards" data-cards-hero>
            ${ptCards(d.hero)}
          </div>
          <div data-type="pt-hero-badge-group">
            <div data-type="pt-player-pill">
              <span data-type="pt-player-name">Hero</span>
              <span data-type="pt-variant-tag">Hold'em</span>
            </div>
            <span data-type="pt-made-pill">${madeName}</span>
          </div>
        </div>
      </div>
    `
  }

  /* ─────────────────────────────  learn  ───────────────────────────── */

  private renderLearn() {
    const host = this.querySelector('[data-panel="learn"]') as HTMLElement
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
