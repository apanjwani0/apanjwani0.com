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
          <p>Play a spot without seeing their cards, the way a real table works — then see every number behind the decision, computed by counting every possible runout.</p>
        </div>

        <nav data-type="pt-tabs" role="tablist">
          <button role="tab" data-mode="drill" type="button">Play a spot</button>
          <button role="tab" data-mode="solve" type="button">Run the numbers</button>
          <button role="tab" data-mode="learn" type="button">What do these words mean?</button>
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

            <p data-type="pt-note">${d.rangeNote} That is ${d.combos.length} possible hands — you will never know which one. ==Every real poker decision is made against a range, not a hand.==</p>

            <div data-type="pt-action-strip">
              <div data-type="pt-action-price">
                <span>Price to call: </span><strong>${pct(requiredEquity(d.pot + d.bet, d.bet))}</strong> pot odds required
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
      // The ==mark== above is written by hand rather than parsed — this is a
      // component, not markdown. Replace it with real emphasis.
      const note = host.querySelector('[data-type="pt-note"]')!
      note.innerHTML = note.innerHTML.replace(
        /==(.+?)==/g,
        '<strong data-type="pt-emph">$1</strong>',
      )

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
    const cardsToCome = 5 - d.board.length
    const unseenCards = 52 - 4 - d.board.length
    const boardsPerCombo = Math.max(1, Math.round(result.runouts / result.combos))
    const streetName = d.board.length === 3 ? 'turn & river' : 'river'

    host.innerHTML = `
      <div data-type="pt-spotcard" data-answered>
        <div data-type="pt-felt" data-felt-verdict="${right ? 'right' : 'wrong'}">
          <div data-type="pt-verdict-header">
            <p data-type="pt-verdict" data-right="${right}">
              <span data-type="pt-verdict-tag">${right ? '✓ Right call' : '✗ Not the best line'}</span>
              <span>You ${this.choice === 'fold' ? 'folded' : this.choice === 'call' ? 'called' : 'raised'};
              the pot odds say <strong>${correct}</strong>.</span>
            </p>
            <div data-type="pt-verdict-actions">
              <button data-action="share-result" type="button" class="pt-share-btn"><span>🔗 Share spot</span></button>
              <button data-action="next" data-variant="primary" type="button">
                <span>Next spot</span>
                <kbd>Space</kbd>
              </button>
            </div>
          </div>

          ${this.renderDrillTable(d, true, madeName, betChipVal)}

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

          <!-- Educational Calculation Ledger Cards -->
          <div data-type="pt-math-cards">
            <!-- Card 1: Your Equity -->
            <div data-type="pt-math-card" data-card-kind="equity">
              <div data-type="pt-math-head">
                <span data-type="pt-math-title">Your Equity</span>
                <span data-type="pt-math-val">${pct(result.equity)}</span>
              </div>
              <p data-type="pt-math-desc">Your expected share of the pot at showdown. You beat <strong>${pct(result.aheadOf)}</strong> of their ${result.combos} starting hands.</p>

              <div data-type="pt-math-ledger">
                <div data-type="pt-ledger-row">
                  <span data-type="pt-ledger-label">1. Scenarios evaluated</span>
                  <div data-type="pt-ledger-content">
                    ${cardsToCome === 0
                      ? `Board is complete: <code>1 showdown × ${result.combos} opponent hands = ${result.runouts.toLocaleString()} total showdowns</code>.`
                      : `<strong>${boardsPerCombo}</strong> ${streetName} card${boardsPerCombo === 1 ? '' : 's'} (${unseenCards} unseen cards in deck) × <strong>${result.combos}</strong> opponent hands = <code>${result.runouts.toLocaleString()} exact showdowns</code>.`
                    }
                  </div>
                </div>

                <div data-type="pt-ledger-row">
                  <span data-type="pt-ledger-label">2. How equity is calculated</span>
                  <div data-type="pt-ledger-content">
                    In every one of those ${result.runouts.toLocaleString()} showdowns, both hands are scored (1 pt for a win, 0.5 for split pot):<br>
                    <code>Equity = Total Points ÷ ${result.runouts.toLocaleString()} = ${pct(result.equity)}</code>
                  </div>
                </div>
              </div>
            </div>

            <!-- Card 2: Pot Odds -->
            <div data-type="pt-math-card" data-card-kind="potodds">
              <div data-type="pt-math-head">
                <span data-type="pt-math-title">Equity you needed to call</span>
                <span data-type="pt-math-val">${pct(required)}</span>
              </div>
              <p data-type="pt-math-desc">The break-even price. Calling costs <strong>${d.bet} chips</strong> to contest a final pot of <strong>${finalPot} chips</strong>.</p>

              <div data-type="pt-math-ledger">
                <div data-type="pt-ledger-row">
                  <span data-type="pt-ledger-label">1. Break-even formula</span>
                  <div data-type="pt-ledger-content">
                    <code>Price = Call ÷ (Current Pot + Call)</code><br>
                    <code>${d.bet} ÷ (${d.pot + d.bet} + ${d.bet}) = ${d.bet} ÷ ${finalPot} = ${pct(required)}</code>
                  </div>
                </div>

                <div data-type="pt-ledger-row">
                  <span data-type="pt-ledger-label">2. Decision rule</span>
                  <div data-type="pt-ledger-content">
                    ${result.equity >= required
                      ? `Your equity (<strong>${pct(result.equity)}</strong>) &gt; price (<strong>${pct(required)}</strong>). Calling wins chips.`
                      : `Your equity (<strong>${pct(result.equity)}</strong>) &lt; price (<strong>${pct(required)}</strong>). Calling loses chips.`
                    }
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
              <p data-type="pt-math-desc">${ev >= 0 ? 'Positive expectation (+EV). Over time, taking this call earns chips.' : 'Negative expectation (-EV). Below break-even price, losing chips long term.'}</p>

              <div data-type="pt-math-ledger">
                <div data-type="pt-ledger-row">
                  <span data-type="pt-ledger-label">1. Net chip calculation</span>
                  <div data-type="pt-ledger-content">
                    <code>EV = (Equity × Final Pot) - Call</code><br>
                    <code>(${pct(result.equity)} × ${finalPot}) - ${d.bet} = ${(result.equity * finalPot).toFixed(1)} - ${d.bet} = ${ev >= 0 ? '+' : ''}${ev.toFixed(1)} chips</code>
                  </div>
                </div>

                <div data-type="pt-ledger-row">
                  <span data-type="pt-ledger-label">2. Long-term return</span>
                  <div data-type="pt-ledger-content">
                    ${ev >= 0
                      ? `Over 100 similar calls, you gain <strong>+${(ev * 100).toFixed(0)} chips</strong> compared to folding.`
                      : `Over 100 similar calls, you lose <strong>${(ev * 100).toFixed(0)} chips</strong> compared to folding.`
                    }
                  </div>
                </div>
              </div>
            </div>
          </div>

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

          <p data-type="pt-note">The average hides this spread: <strong>${pct(result.equity)}</strong> equity against the range is composed of being behind the top and dominating the bottom. In real poker, you are playing against the entire distribution, not an isolated hand.</p>

          <details data-type="pt-caveat">
            <summary>Why this says "pot odds" and not "GTO"</summary>
            <p>This grades one question: does calling make money right now, given the price you are being offered and how your hand does against everything they can hold. That is a complete and checkable answer, and every number above is enumerated exactly.</p>
            <p>A genuine game-theory-optimal answer solves something larger — how often you should call, raise and fold with your <em>entire</em> range, across every remaining street, so that no opponent can exploit you. That is a solver's job, it takes minutes to hours per spot, and it does not run in a browser tab. Anything that claims otherwise is showing you a lookup table and calling it a solve.</p>
          </details>

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

    host.querySelector('[data-action="next"]')!.addEventListener('click', () => {
      this.deal()
      this.renderDrill()
    })
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
          <h2>The Rules, Arithmetic &amp; Mental Models</h2>
          <p>Poker mathematics demystified in plain English — without dense jargon, misleading shortcuts, or black-box solver claims.</p>
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
              <span data-type="pt-concept-tag">01 · FOUNDATION</span>
              <h3>Equity: Your True Share of the Pot</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The One-Sentence Rule:</strong> Equity is your share of the pot if nobody folded and you dealt the remaining cards out right now.
            </div>
            <div data-type="pt-concept-body">
              <p>If you have 60% equity in a 100-chip pot, your hand is worth <strong>60 chips</strong> right now. It is not a prediction about this individual hand — you either win it or you do not. It is what the hand is worth on average over every possible way the remaining deck could fall.</p>
              <p>The reason equity matters is that it turns the vague question <em>"am I probably ahead?"</em> into an exact number you can compare directly against a price. Poker decisions are almost entirely that comparison.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">Visual Concept</span>
              <code>100 Chip Pot × 60% Equity = 60 Chips Value Today</code>
            </div>
            <div data-type="pt-concept-takeaway">
              💡 <strong>Table Takeaway:</strong> You never gamble on hope — you price your equity against the pot odds.
            </div>
          </article>

          <!-- 2. Pot Odds -->
          <article data-type="pt-concept-card" id="learn-odds">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">02 · DECISION ENGINE</span>
              <h3>Pot Odds: The Only Decision They Answer</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The One-Sentence Rule:</strong> If your equity is higher than the break-even price of your call, calling makes money.
            </div>
            <div data-type="pt-concept-body">
              <p>If the pot has 100 chips and someone bets 50, calling costs you 50 to contest the 150 already out there — and your 50 joins it, so a final pot of <strong>200 chips</strong> is what you are winning a share of.</p>
              <p>You need to win at least <strong>50 ÷ 200 = 25%</strong> of the time to break even. That percentage is the price. The classic trap is dividing by the 150 you can currently see instead of the 200 the pot becomes with your call.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">The Break-Even Formula</span>
              <code>Price = Call ÷ (Current Pot + Call) = 50 ÷ (150 + 50) = 25.0%</code>
            </div>
            <div data-type="pt-concept-takeaway">
              💡 <strong>Table Takeaway:</strong> Never divide by just what is in the pot — always include your own call in the denominator.
            </div>
          </article>

          <!-- 3. Outs & Rule of 2/4 -->
          <article data-type="pt-concept-card" id="learn-outs">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">03 · SHORTCUT TRAP</span>
              <h3>Outs: Why the Rule of 2 &amp; 4 Lies</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The One-Sentence Rule:</strong> The rule of 2 &amp; 4 is a useful mental shortcut, but it is systematically too optimistic.
            </div>
            <div data-type="pt-concept-body">
              <p>An "out" is an unseen card that would give you the winning hand. Players are taught to multiply their outs by 4 on the flop (two cards to come) or 2 on the turn (one card to come) to estimate equity.</p>
              <p>The shortcut lies because <strong>some of your outs also improve your opponent</strong> (called "dirty outs" or redraws). A card that gives you a flush might give your opponent a full house. This tool shows the shortcut next to the exact mathematical equity so you can see the true gap.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">Shortcut vs Reality</span>
              <code>9 Flush Outs × 4 = 36% (Shortcut) vs ~32% (Exact Reality due to redraws)</code>
            </div>
            <div data-type="pt-concept-takeaway">
              💡 <strong>Table Takeaway:</strong> Discount your outs when the board is paired or heavily coordinated.
            </div>
          </article>

          <!-- 4. Ranges -->
          <article data-type="pt-concept-card" id="learn-ranges">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">04 · STRATEGIC CORE</span>
              <h3>Ranges: Playing Against Distributions</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The One-Sentence Rule:</strong> Every real poker decision is made against an opponent's entire range, never an isolated hand.
            </div>
            <div data-type="pt-concept-body">
              <p>You never know your opponent's exact two cards. What you can know is the <strong>set of hands</strong> they would play this way — that set is their range. Someone opening from early position has a tight, strong range; someone raising from the button has a wide, opportunistic range.</p>
              <p>Combinatorics matter: a specific pocket pair has 6 combinations, a suited hand has 4, and an offsuit hand has 12. There are 16 ways to be dealt Ace-King, but only 6 ways to be dealt pocket Aces. Worrying about Aces when King-Queen is twice as likely is how players give away chips.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">Hand Combinations</span>
              <code>Pocket Pair: 6 combos · Suited: 4 combos · Offsuit: 12 combos</code>
            </div>
            <div data-type="pt-concept-takeaway">
              💡 <strong>Table Takeaway:</strong> Offsuit combos outnumber pocket pairs 2-to-1. Count combinations, not fear.
            </div>
          </article>

          <!-- 5. Blockers -->
          <article data-type="pt-concept-card" id="learn-blockers">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">05 · REMOVAL EFFECT</span>
              <h3>Blockers: How Your Cards Reshape Theirs</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The One-Sentence Rule:</strong> Holding a card removes it from the deck and can cut your opponent's combinations in half.
            </div>
            <div data-type="pt-concept-body">
              <p>If you hold an Ace (say A♠), there are only three Aces left in the deck. The number of ways your opponent can hold Pocket Aces drops from 6 combinations down to 3 — <strong>your single card halves their chance</strong>.</p>
              <p>Card removal ("blocking") is why two hands that seem similar on paper play completely differently in practice. Holding the Ace of trump removes bluffs or nuts from their distribution.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">Card Removal Math</span>
              <code>Opponent Pocket Aces: 6 combos → You hold A♠: 3 combos remaining (-50%)</code>
            </div>
            <div data-type="pt-concept-takeaway">
              💡 <strong>Table Takeaway:</strong> When bluffing, holding blockers to your opponent's calling hands is crucial.
            </div>
          </article>

          <!-- 6. GTO -->
          <article data-type="pt-concept-card" id="learn-gto">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">06 · THEORY CHECK</span>
              <h3>GTO: Game-Theory Optimal Reality</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The One-Sentence Rule:</strong> GTO is an unexploitable equilibrium, not an instant browser lookup trick.
            </div>
            <div data-type="pt-concept-body">
              <p>Game-theory optimal (GTO) describes a strategy that cannot be beaten in the long run, no matter how your opponent adjusts. It is not the strategy that wins the most against bad players (that is exploitative play).</p>
              <p>Be suspicious of anything offering "instant GTO solves" in a browser tab. Real solvers simulate whole trees of play across millions of iterations. What you see in web apps is pre-calculated lookup tables based on rigid assumptions. This tool computes what can be calculated exactly — pot odds and exact runout equity — and states the distinction honestly.</p>
            </div>
            <div data-type="pt-concept-takeaway">
              💡 <strong>Table Takeaway:</strong> Pot odds grade today's price. GTO balances your entire strategy across every hand you could have.
            </div>
          </article>

          <!-- 7. Pot-Limit Omaha -->
          <article data-type="pt-concept-card" id="learn-omaha">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">07 · VARIANT RULE</span>
              <h3>Pot-Limit Omaha: The Mandatory "2 and 3" Rule</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The One-Sentence Rule:</strong> You must use EXACTLY two cards from your hand and EXACTLY three from the board.
            </div>
            <div data-type="pt-concept-body">
              <p>Hold'em players lose money on Omaha because they assume "up to two cards" is allowed. In PLO, you <strong>must use exactly two</strong> cards from your hand and <strong>exactly three</strong> from the board.</p>
              <p>Four hearts on the board and one heart in your hand is NOT a flush. You only have one heart, but you must use two cards from your hand. Four of a kind on the board is not four of a kind for anyone. Switch variants in the tool to see the math follow Omaha rules.</p>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">The Invariant Rule</span>
              <code>Always (2 Hole Cards) + (3 Board Cards) = 5-Card Poker Hand</code>
            </div>
            <div data-type="pt-concept-takeaway">
              💡 <strong>Table Takeaway:</strong> Never count one-card flushes or board quads in Pot-Limit Omaha.
            </div>
          </article>

          <!-- 8. Exact Math -->
          <article data-type="pt-concept-card" id="learn-exact">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">08 · ENGINE GUARANTEE</span>
              <h3>Exact Enumeration: Zero Monte Carlo Sampling</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The One-Sentence Rule:</strong> Every percentage here counts every possible deck permutation — never a random sample.
            </div>
            <div data-type="pt-concept-body">
              <p>Most poker calculators run a Monte Carlo simulation: they generate 50,000 random boards and take the average. It is fast, but it is approximate.</p>
              <p>This engine counts <strong>every single runout</strong> that the deck can produce (up to hundreds of thousands of exact outcomes). When a query is too vast to enumerate in a browser without freezing (like pre-flop PLO), it refuses honestly rather than quietly switching to noisy approximations.</p>
            </div>
            <div data-type="pt-concept-takeaway">
              💡 <strong>Table Takeaway:</strong> Precision matters: exact odds let you study subtle edge cases with 100% confidence.
            </div>
          </article>

          <!-- 9. Quant Prep -->
          <article data-type="pt-concept-card" id="quant-prep">
            <div data-type="pt-concept-top">
              <span data-type="pt-concept-tag">09 · QUANT INTERVIEW PREP</span>
              <h3>Why Quantitative Trading Firms Test Poker Probability</h3>
            </div>
            <div data-type="pt-concept-tldr">
              <strong>The One-Sentence Rule:</strong> Poker scenarios test Bayesian updating, expected value (+EV), and disciplined decision-making under uncertainty.
            </div>
            <div data-type="pt-concept-body">
              <p>Top quantitative trading firms and market makers — including Jane Street, Susquehanna International Group (SIG), Citadel Securities, and Akuna Capital — frequently drill candidates on poker math during quantitative interviews.</p>
              <p>Firms do not care about card psychology or bluffing tells. They use poker because it provides a clean, rigorous mathematical laboratory for market making:</p>
              <ul>
                <li><strong>Bayesian Updating:</strong> Re-evaluating your probability distribution in real time as each new street (flop, turn, river) lands.</li>
                <li><strong>Pot Odds &amp; Break-Even Arithmetic:</strong> Comparing risk to reward: <code>Price = Call ÷ (Pot + Call)</code>. Calling is profitable only when your equity exceeds this threshold.</li>
                <li><strong>Expected Value (+EV) Discipline:</strong> Making statistically positive choices repeatedly, separating decision quality from short-term variance.</li>
                <li><strong>Range-vs-Range Thinking:</strong> Pricing assets against a full distribution of possibilities rather than guessing a single scenario.</li>
              </ul>
            </div>
            <div data-type="pt-concept-box">
              <span data-type="pt-box-title">Quant Interview EV Formula</span>
              <code>EV(Call) = (Win% × Final Pot) − Call Amount &gt; 0</code>
            </div>
            <div data-type="pt-concept-takeaway">
              💡 <strong>Interview Takeaway:</strong> In trading and poker, you cannot control the turn or river — you can only ensure you never pay more than the mathematical price.
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
          ${ptTerm('What are pot odds?', 'The price you are being offered. Call 50 into a pot that already holds 100 and you are risking 50 to win that 100, making a pot of 150 — so you break even at 50 / 150 = 33.3%. Note this box wants the pot BEFORE your call, with their bet already in it. Compare the answer against your equity: bigger equity than price means calling makes money.')}
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
        heading.textContent = `${outs.length} outs — the cards that would put you ahead`
        const cardRow = document.createElement('div')
        cardRow.dataset.type = 'pt-outs'
        cardRow.innerHTML = ptCards(outs)
        const note = document.createElement('p')
        note.dataset.type = 'pt-note'
        note.textContent = `The rule of ${streets === 2 ? '4' : '2'} estimates ${pct2(shortcut)}; you actually have ${pct2(result.equity[0])}. The shortcut is optimistic because some of these cards also improve their hand.`
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
      ['How many of them you beat', `${pct(result.aheadOf)}`],
      ['Runouts counted', `${result.runouts.toLocaleString()} — every one, none sampled`],
    ]))

    const splits = document.createElement('div')
    splits.dataset.type = 'pt-splits'
    splits.innerHTML = `
      <div><h3>Worst against</h3>${result.worst.map(w => `<div data-type="pt-comborow">${ptCards(w.hand)}<span>${pct(w.equity)}</span></div>`).join('')}</div>
      <div><h3>Best against</h3>${result.best.map(w => `<div data-type="pt-comborow">${ptCards(w.hand)}<span>${pct(w.equity)}</span></div>`).join('')}</div>
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
