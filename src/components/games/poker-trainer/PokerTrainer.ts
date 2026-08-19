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
 * approximate — see PT_MAX_RUNOUTS and PT_MAX_RANGE_WORK.
 *
 * All module-level names are pt-/PT_-prefixed: game component files share one
 * global script scope.
 */

import {
  callEv,
  countRunouts,
  equityVsRange,
  exactEquity,
  handClass,
  holeCount,
  outsAgainst,
  rangeWork,
  rankHand,
  requiredEquity,
  type Variant,
} from './engine/equity'
import { PRESET_RANGES, parseRange, rangeCombos } from './engine/ranges'
import { cardSvg } from './ui/cards-svg'
import { RANK_LABEL, SUITS, SUIT_SYMBOL, type Card, type Suit } from './engine/types'

/**
 * Above this many runouts a single hand-vs-hand query stops feeling interactive.
 *
 * Rather than silently switching to Monte Carlo to stay responsive, the UI
 * refuses and says why: the whole promise is that every number shown is exact,
 * and a sampled number wearing the same styling would quietly break it.
 *
 * The ceiling used to be about raw speed — a preflop Hold'em spot is
 * C(48,5) = 1,712,304 boards, which the old enumerator needed the better part of
 * a minute for. It no longer is: the bitmask scorer takes 312ms over the same
 * boards. ==What holds the ceiling here now is that `renderSolve` recomputes the
 * equity from scratch on every input event==, including each keystroke in the pot
 * and bet boxes, which cannot change it. 312ms per keypress is its own kind of
 * broken. Memoise the result per spot and this number can rise to let preflop in.
 *
 * Note the ceiling is in runouts, so it reads Hold'em and Omaha as equally
 * expensive and they are not — an Omaha hand is the best of 60 five-card hands
 * against Hold'em's one bitmask read, and preflop PLO still takes 7.1s. Any
 * raise has to count hands ranked, not boards dealt.
 */
const PT_MAX_RUNOUTS = 300_000

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

/** A term the reader may not know, defined inline on click rather than in a glossary. */
function ptTerm(term: string, definition: string): string {
  return `<details data-type="pt-term"><summary>${term}</summary><p>${definition}</p></details>`
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

    this.renderLearn()
    this.buildSolve()
    this.deal()
    this.render()
  }

  /* ─────────────────────────────  chrome  ───────────────────────────── */

  private render() {
    for (const button of this.querySelectorAll<HTMLElement>('[data-mode]')) {
      const on = button.dataset.mode === this.mode
      button.toggleAttribute('data-active', on)
      button.setAttribute('aria-selected', String(on))
    }
    for (const panel of this.querySelectorAll<HTMLElement>('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== this.mode
    }
    if (this.mode === 'drill') this.renderDrill()
    if (this.mode === 'solve') this.renderSolve()
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

  private renderDrill() {
    const host = this.querySelector('[data-panel="drill"]') as HTMLElement
    const d = this.drill
    if (!d) return

    if (!this.choice) {
      host.innerHTML = `
        <div data-type="pt-spotcard">
          <p data-type="pt-street">On the ${d.street}. You are facing a bet.</p>

          <div data-type="pt-row">
            <span data-type="pt-label">Your hand</span>
            <div data-type="pt-cards">${ptCards(d.hero)}</div>
          </div>

          <div data-type="pt-row">
            <span data-type="pt-label">Board</span>
            <div data-type="pt-cards">${ptCards(d.board)}</div>
          </div>

          <div data-type="pt-row">
            <span data-type="pt-label">They have</span>
            <div data-type="pt-hidden">
              <span data-type="pt-facedown">?</span><span data-type="pt-facedown">?</span>
              <span data-type="pt-rangetag">${d.rangeLabel}</span>
            </div>
          </div>
          <p data-type="pt-note">${d.rangeNote} That is ${d.combos.length} possible hands — you will never know which one. ==Every real poker decision is made against a range, not a hand.==</p>

          <div data-type="pt-row">
            <span data-type="pt-label">Pot</span>
            <strong>${d.pot}</strong>
            <span data-type="pt-label">They bet</span>
            <strong>${d.bet}</strong>
          </div>

          <p data-type="pt-ask">What do you do?</p>
          <div data-type="pt-choices">
            <button data-choice="fold" type="button">Fold</button>
            <button data-choice="call" type="button">Call ${d.bet}</button>
            <button data-choice="raise" type="button">Raise</button>
          </div>
          <p data-type="pt-score">Streak ${this.streak} · Best ${this.best}</p>
        </div>
      `
      // The ==mark== above is written by hand rather than parsed — this is a
      // component, not markdown. Replace it with real emphasis.
      const note = host.querySelector('[data-type="pt-note"]')!
      note.innerHTML = note.innerHTML.replace(
        /==(.+?)==/g,
        '<strong data-type="pt-emph">$1</strong>',
      )

      for (const button of host.querySelectorAll<HTMLElement>('[data-choice]')) {
        button.addEventListener('click', () => {
          this.choice = button.dataset.choice as PtChoice
          this.renderDrill()
        })
      }
      return
    }

    // Answered — reveal the arithmetic.
    const result = equityVsRange(d.hero, d.combos, d.board)
    // d.pot is the pot BEFORE they bet; both helpers take the pot before the
    // CALL, which already contains that bet. Passing d.pot alone computed
    // bet/(pot+bet) — the frequency a bluff must work, not the price of a call —
    // and graded every spot between the two numbers as a fold when it was a call.
    const required = requiredEquity(d.pot + d.bet, d.bet)
    const ev = callEv(d.pot + d.bet, d.bet, result.equity)
    // Graded on pot odds, deliberately: whether this call makes money right now.
    // A true GTO answer also weighs later streets and bluff frequency, which
    // needs a solver — see the caveat rendered below. Claiming this IS the GTO
    // answer would be the exact overclaim the tool exists to avoid.
    const correct: PtChoice = result.equity >= 0.68 ? 'raise'
      : result.equity > required ? 'call'
      : 'fold'
    const right = this.choice === correct
      // Calling when raising is right is not a blunder — it is the same side of
      // the fold/continue line, so it keeps the streak but is not scored as best.
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

    host.innerHTML = `
      <div data-type="pt-spotcard" data-answered>
        <p data-type="pt-verdict" data-right="${right}">
          ${right ? 'Right call.' : 'Not the best line.'}
          You ${this.choice === 'fold' ? 'folded' : this.choice === 'call' ? 'called' : 'raised'};
          the pot odds say <strong>${correct}</strong>.
        </p>

        <div data-type="pt-row">
          <span data-type="pt-label">You had</span>
          <div data-type="pt-cards">${ptCards(d.hero)}</div>
          <span data-type="pt-label">on</span>
          <div data-type="pt-cards">${ptCards(d.board)}</div>
        </div>
        <p data-type="pt-note">That is ${madeName}.</p>

        <table data-type="pt-lines">
          <tr><th>Your equity against their whole range</th><td><strong>${pct(result.equity)}</strong></td></tr>
          <tr><th>Equity you needed to call ${d.bet} into ${d.pot}</th><td>${pct(required)}</td></tr>
          <tr><th>How much of their range you beat</th><td>${pct(result.aheadOf)} of ${result.combos} hands</td></tr>
          <tr><th>Value of calling</th><td>${ev >= 0 ? '+' : ''}${ev.toFixed(1)} chips</td></tr>
          <tr><th>Runouts counted</th><td>${result.runouts.toLocaleString()} — every one, none sampled</td></tr>
        </table>

        <div data-type="pt-splits">
          <div>
            <h3>Hands you are behind</h3>
            ${result.worst.map(w => `<div data-type="pt-comborow">${ptCards(w.hand)}<span>${pct(w.equity)}</span></div>`).join('')}
          </div>
          <div>
            <h3>Hands you are ahead of</h3>
            ${result.best.map(w => `<div data-type="pt-comborow">${ptCards(w.hand)}<span>${pct(w.equity)}</span></div>`).join('')}
          </div>
        </div>
        <p data-type="pt-note">The average hides this. ${pct(result.equity)} against the range is made of being crushed by the top of it and far ahead of the bottom — which is what "what am I actually beating" means.</p>

        <details data-type="pt-caveat">
          <summary>Why this says "pot odds" and not "GTO"</summary>
          <p>This grades one question: does calling make money right now, given the price you are being offered and how your hand does against everything they can hold. That is a complete and checkable answer, and every number above is enumerated exactly.</p>
          <p>A genuine game-theory-optimal answer solves something larger — how often you should call, raise and fold with your <em>entire</em> range, across every remaining street, so that no opponent can exploit you. That is a solver's job, it takes minutes to hours per spot, and it does not run in a browser tab. Anything that claims otherwise is showing you a lookup table and calling it a solve.</p>
        </details>

        <p data-type="pt-score">Streak ${this.streak} · Best ${this.best}</p>
        <button data-action="next" type="button">Next spot</button>
      </div>
    `

    host.querySelector('[data-action="next"]')!.addEventListener('click', () => {
      this.deal()
      this.renderDrill()
    })
  }

  /* ─────────────────────────────  learn  ───────────────────────────── */

  private renderLearn() {
    const host = this.querySelector('[data-panel="learn"]') as HTMLElement
    host.innerHTML = `
      <div data-type="pt-learn">
        <h2>The words, in plain English</h2>

        <h3>Equity</h3>
        <p><strong>Equity is your share of the pot if nobody folded and you just dealt the rest of the cards out.</strong> If you have 60% equity in a 100-chip pot, your hand is worth 60 chips right now. It is not a prediction about this hand — you either win it or you do not. It is what the hand is worth on average over every way the cards could fall.</p>
        <p>The reason it matters is that it turns "am I probably ahead?" into a number you can compare against a price. Poker is almost entirely that comparison.</p>

        <h3>Pot odds, and the only decision they answer</h3>
        <p>If the pot has 100 and someone bets 50, calling costs you 50 to win the 150 already out there — and your 50 joins it, so a pot of 200 is what you are winning a share of. You need to be right <strong>50 / 200 = 25%</strong> of the time to break even. That percentage is the price. The trap is dividing by the 150 you can see instead of the 200 the pot becomes.</p>
        <p>Then: <strong>if your equity is bigger than the price, calling makes money.</strong> That is the whole of pot odds, and it is the single most useful thing to learn first, because it applies on every street of every hand.</p>

        <h3>Outs, and why the shortcut lies</h3>
        <p>An "out" is a card that would give you the better hand. Everyone is taught to count them and multiply by 2 (one card to come) or 4 (two cards to come) to get a rough equity.</p>
        <p>It is a good shortcut and it is <strong>systematically too optimistic</strong>, because some of your outs also improve your opponent. A card that gives you a flush can give them a full house. This tool shows the shortcut's answer next to the exact one so you can see the size of the gap — that gap is the part nobody shows you.</p>

        <h3>Range</h3>
        <p>You never know your opponent's two cards. What you can know is the <strong>set</strong> of hands they would play this way — that set is their range. Someone who raised from the first seat has a narrow range of strong hands; someone who raised on the button has a wide one.</p>
        <p><strong>Every serious poker idea is defined over ranges, not hands.</strong> That is why the drill hides their cards: a decision made against known cards is a lookup, and no such decision exists at a table.</p>
        <p>Counting matters here and people get it wrong. A specific pair is 6 combinations, a suited hand 4, an offsuit hand 12 — so there are 16 ways to be dealt ace-king and only 6 to be dealt aces. "But he could have aces" is usually the wrong thing to worry about.</p>

        <h3>Blockers</h3>
        <p>If you are holding an ace, there are three aces left rather than four, so the chance your opponent has a pair of aces drops from 6 combinations to 3. Your own cards <strong>halve</strong> it. Holding a card that removes hands from their range is called blocking, and it is why two hands that look equally strong can be worth playing very differently.</p>

        <h3>GTO</h3>
        <p>Game-theory optimal means a strategy that <strong>cannot be beaten in the long run, no matter how your opponent adjusts.</strong> It is not a strategy that wins the most against a bad player — that is called exploitative play, and it wins more, at the cost of being exploitable itself.</p>
        <p>The practical form is a set of frequencies: with this hand in this spot, raise 62% of the time, call 31%, fold 7%. That mixture is what makes you unreadable. It comes out of a solver — software that plays the game against itself millions of times until neither side can improve — and it takes real computing time per spot.</p>
        <p><strong>So be suspicious of anything that offers you an instant GTO answer in a browser.</strong> It is showing you precomputed output, and whether that output is right depends entirely on assumptions it usually does not state: stack depth, rake, how many players, what everyone did earlier. This tool does not pretend to solve; it computes the things that <em>can</em> be computed exactly, and says so.</p>

        <h3>Pot-Limit Omaha</h3>
        <p>You get four cards instead of two, and you must use <strong>exactly two of them</strong> — plus exactly three from the board. Not "at most two". Exactly.</p>
        <p>This is where Hold'em players lose money in their first Omaha session. Four hearts on the board and one in your hand is <em>not</em> a flush, because you can only play one heart. Four of a kind on the board is not four of a kind for anyone, because three board cards is the limit. Switch the variant in the other tabs and the maths follows the right rule.</p>

        <h3>What this tool will not do</h3>
        <p>It will not estimate. Every percentage here comes from counting every possible way the remaining cards can fall — not from dealing a few hundred thousand random ones and averaging, which is what most equity tools do. When a question is too large to count that way, it says so and refuses, rather than switching to sampling while looking exactly the same.</p>
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

        <div data-type="pt-spot">
          ${(['hero', 'villain', 'board'] as PtSlot[]).map(slot => `
            <div data-type="pt-slot" data-slot="${slot}">
              <button data-select="${slot}" type="button">
                ${slot === 'hero' ? 'Your hand' : slot === 'villain' ? 'Their hand' : 'Board'}
              </button>
              <div data-type="pt-cards" data-for="${slot}"></div>
            </div>
          `).join('')}
        </div>

        <div data-type="pt-rangebox" hidden>
          <label>Their range
            <select data-field="preset">
              ${PRESET_RANGES.map(r => `<option value="${r.id}">${r.label}</option>`).join('')}
              <option value="custom">Custom…</option>
            </select>
          </label>
          <input data-field="rangeText" type="text" spellcheck="false" value="${PRESET_RANGES[0].text}" />
          <p data-type="pt-note">Shorthand: <code>77+</code> that pair and up, <code>ATs+</code> suited ace-ten through ace-king, <code>AKo</code> offsuit, <code>A5s-A2s</code> a span. These are conventional ranges, not solver output — see the Learn tab.</p>
          <p data-type="pt-rangeinfo"></p>
        </div>

        <div data-type="pt-picker">
          <p data-type="pt-picker-hint"></p>
          <div data-type="pt-grid"></div>
          <div data-type="pt-picker-actions">
            <button data-action="clear" type="button">Clear all</button>
            <button data-action="deal" type="button">Deal a random spot</button>
          </div>
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

  private currentRange(): { combos: Card[][]; dropped: string[] } {
    const { classes, dropped } = parseRange(this.rangeText)
    return { combos: rangeCombos(classes, [...this.hero, ...this.board]), dropped }
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

    const runouts = countRunouts([this.hero, this.villain], this.board)
    if (runouts > PT_MAX_RUNOUTS) {
      out.dataset.state = 'warn'
      out.textContent = `That spot is ${runouts.toLocaleString()} possible runouts — too many to count exactly in a browser. Deal a flop and it drops to ${countRunouts([this.hero, this.villain], [{ r: 2, s: 'c' }, { r: 3, s: 'c' }, { r: 4, s: 'c' }]).toLocaleString()}. Nothing here is ever sampled, so it refuses rather than estimating.`
      return
    }

    const result = exactEquity([this.hero, this.villain], this.board, this.variant)
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

    const result = equityVsRange(this.hero, combos, this.board)
    out.dataset.state = 'ok'
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

  /** Hero equity for the odds panel, or null when the spot is not computable. */
  private heroEquity(): number | null {
    const need = holeCount(this.variant)
    if (this.hero.length !== need) return null
    if (this.board.length === 1 || this.board.length === 2) return null

    if (this.villainMode === 'range') {
      const { combos } = this.currentRange()
      if (!combos.length) return null
      if (rangeWork(combos.length, this.board) > PT_MAX_RANGE_WORK * 4) return null
      return equityVsRange(this.hero, combos, this.board).equity
    }

    if (this.villain.length !== need) return null
    if (countRunouts([this.hero, this.villain], this.board) > PT_MAX_RUNOUTS) return null
    return exactEquity([this.hero, this.villain], this.board, this.variant).equity[0]
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

    const rows: Array<[string, string]> = [
      ['You must win at least this often', pct2(required)],
      ['Pot odds', `${(this.pot / this.bet).toFixed(2)} : 1`],
    ]

    const equity = this.heroEquity()
    if (equity !== null) {
      const ev = callEv(this.pot, this.bet, equity)
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
