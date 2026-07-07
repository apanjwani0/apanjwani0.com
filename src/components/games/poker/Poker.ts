/**
 * Poker Together — orchestrator WebComponent (<poker-game>).
 *
 * A fully client-side, local-first poker room. Everything lives inside this one
 * component (the site never adds a route): a LOBBY (create/join rooms), a ROOM
 * (configure seats — humans for hotseat pass-and-play, bots, or empty), and a
 * TABLE (play). Rooms and chips persist in localStorage (max 10 rooms, 15 seats
 * each); cross-tab presence keeps the lobby in sync between browser tabs. Bots
 * act on their own with a short think delay. Play-money only — no real wagering.
 *
 * Screens are swapped by rewriting innerHTML, EXCEPT the table, whose canvas +
 * renderer are built once and then repainted, so the drawing context survives
 * across ticks. All timers/observers are torn down in disconnectedCallback so
 * nothing leaks across Astro View Transitions.
 */

import { rooms, hostName, setHostName } from './engine/rooms'
import { startHand, legalActions, applyAction, botInputFor, currentActorKind, fmtChips } from './engine/engine'
import { decide } from './engine/bots'
import { createRenderer } from './ui/renderer'
import { VARIANTS, BOT_PERSONALITIES, PERSONALITY_LABEL, LS, clamp } from './engine/types'
import type {
  Room, RoomConfig, GameState, VariantId, SeatKind, TableView, SeatView, Renderer, Card, PlayerHand,
} from './engine/types'

const VARIANT_IDS = Object.keys(VARIANTS) as VariantId[]

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

class PokerGame extends HTMLElement {
  private screen: 'lobby' | 'room' | 'table' = 'lobby'
  private roomId: string | null = null
  private room: Room | null = null
  private state: GameState | null = null
  private buttonSeat = 0
  private heroSeat = 0

  private renderer: Renderer | null = null
  private canvas: HTMLCanvasElement | null = null
  private ro?: ResizeObserver
  private botTimer = 0
  private turnTimeout = 0
  private turnTick = 0
  private unsub: (() => void) | null = null
  private reduced = false

  connectedCallback() {
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.restoreSession()
    this.unsub = rooms.subscribe(() => {
      if (this.screen === 'lobby') this.renderLobby()
      else if (this.screen === 'room') this.syncRoom()
    })
    this.route()
  }

  disconnectedCallback() {
    clearTimeout(this.botTimer)
    this.clearTurnTimer()
    this.unsub?.()
    this.ro?.disconnect()
    this.renderer?.destroy()
    this.renderer = null
  }

  /* ─────────────────────── session + routing ─────────────────────── */

  private restoreSession() {
    try {
      const j = JSON.parse(localStorage.getItem(LS.session) || '{}')
      if (j.roomId && rooms.get(j.roomId)) { this.roomId = j.roomId; this.screen = 'room' }
    } catch { /* ignore */ }
  }
  private saveSession() {
    try {
      localStorage.setItem(LS.session, JSON.stringify({ roomId: this.roomId, screen: this.screen === 'table' ? 'room' : this.screen }))
    } catch { /* ignore */ }
  }

  private route() {
    clearTimeout(this.botTimer)
    if (this.screen === 'room' && this.roomId) {
      this.room = rooms.get(this.roomId)
      if (!this.room) { this.screen = 'lobby'; this.roomId = null }
    }
    if (this.screen === 'room' && this.room) this.renderRoom()
    else if (this.screen === 'table' && this.room && this.state) this.enterTable()
    else { this.screen = 'lobby'; this.renderLobby() }
    this.saveSession()
  }

  /* ───────────────────────────  LOBBY  ────────────────────────────── */

  private renderLobby() {
    clearTimeout(this.botTimer)
    this.screen = 'lobby'
    this.state = null
    const list = rooms.list()
    const roomCard = (r: Room) => {
      const filled = r.seats.filter(s => s.kind === 'human' || s.kind === 'bot').length
      return `<article data-type="pk-room-card">
        <div data-type="pk-room-main">
          <strong>${esc(r.name)}</strong>
          <span data-type="pk-room-meta">${esc(VARIANTS[r.config.variantId].name)} · ${filled} seated · buy-in ${fmtChips(r.config.startingStack)} · ${r.config.smallBlind}/${r.config.bigBlind}</span>
        </div>
        <div data-type="pk-room-actions">
          <button data-open="${r.id}" type="button">Open</button>
          <button data-del="${r.id}" type="button" data-variant="ghost">Delete</button>
        </div>
      </article>`
    }
    this.innerHTML = `
      <div data-type="pk-game" data-screen="lobby">
        <div data-type="pk-header">
          <div data-type="pk-titlebar"><h1>Poker Together</h1><span data-type="pk-badge">local · play-money</span></div>
          <p>Spin up a table, fill the seats with friends (pass-the-device hotseat) or bots, and deal. Rooms, chips and settings live in your browser — nothing is uploaded, no sign-up. Play Texas Hold'em, Omaha or a Bomb Pot.</p>
        </div>

        <section data-type="pk-panel">
          <label data-type="pk-field"><span>Your display name</span>
            <input id="pk-name" type="text" maxlength="20" value="${esc(hostName())}" placeholder="You" /></label>
        </section>

        <section data-type="pk-panel">
          <h2>New table</h2>
          <div data-type="pk-form">
            <label data-type="pk-field"><span>Table name</span><input id="pk-rn" type="text" maxlength="28" placeholder="Friday Night" /></label>
            <label data-type="pk-field"><span>Game</span>
              <select id="pk-variant">${VARIANT_IDS.map(v => `<option value="${v}">${esc(VARIANTS[v].name)}</option>`).join('')}</select></label>
            <label data-type="pk-field"><span>Seats</span><input id="pk-seats" type="number" min="2" max="10" value="6" /></label>
            <label data-type="pk-field"><span>Bots</span><input id="pk-bots" type="number" min="0" max="9" value="4" /></label>
            <label data-type="pk-field"><span>Initial buy-in</span><input id="pk-stack" type="number" min="100" step="100" value="1500" /></label>
            <label data-type="pk-field"><span>Rebuy buy-in</span><input id="pk-buyin" type="number" min="100" step="100" value="1500" placeholder="same as initial" /></label>
            <label data-type="pk-field"><span>Small blind</span><input id="pk-sb" type="number" min="1" value="10" /></label>
            <label data-type="pk-field"><span>Big blind</span><input id="pk-bb" type="number" min="2" value="20" /></label>
            <label data-type="pk-field"><span>Bot style</span>
              <select id="pk-pers"><option value="mixed">Mixed table</option>${BOT_PERSONALITIES.map(p => `<option value="${p}">${esc(PERSONALITY_LABEL[p])}</option>`).join('')}</select></label>
          </div>
          <div data-type="pk-actions">
            <button id="pk-create" type="button" data-variant="primary">Create table</button>
            <span data-type="pk-note">${list.length}/10 rooms</span>
          </div>
          <p data-type="pk-err" id="pk-create-err" hidden></p>
        </section>

        <section data-type="pk-panel">
          <h2>Tables (${list.length})</h2>
          ${list.length ? `<div data-type="pk-room-list">${list.map(roomCard).join('')}</div>` : `<p data-type="pk-empty">No tables yet — create one above.</p>`}
        </section>

        <details data-type="pk-explainer">
          <summary>How "playing together" works</summary>
          <p>This is a <strong>local-first</strong> poker room — no server, no accounts. Seats you mark as <strong>Human</strong> are played hotseat: only the player whose turn it is sees their cards, so you pass one device around the table. Fill the rest with <strong>bots</strong> (five personalities, from tight Rocks to loose Maniacs) that read the board with a real equity estimate. Open the same site in another browser tab and you'll see the room list stay in sync.</p>
          <p>The shuffle is drawn from your device's cryptographic RNG (rejection-sampled, unbiased). Everything — hand engine, Omaha's exactly-two rule, side pots — runs on your machine.</p>
        </details>
      </div>`
    this.wireLobby()
  }

  private wireLobby() {
    const name = this.q<HTMLInputElement>('#pk-name')
    name?.addEventListener('change', () => setHostName(name.value.trim() || 'You'))
    this.q('#pk-create')?.addEventListener('click', () => this.createRoom())
    this.qa('[data-open]').forEach(b => b.addEventListener('click', () => { this.roomId = (b as HTMLElement).dataset.open!; this.screen = 'room'; this.route() }))
    this.qa('[data-del]').forEach(b => b.addEventListener('click', () => { rooms.remove((b as HTMLElement).dataset.del!); this.renderLobby() }))
  }

  private createRoom() {
    const num = (sel: string, d: number) => { const v = Number(this.q<HTMLInputElement>(sel)?.value); return Number.isFinite(v) ? v : d }
    const variantId = (this.q<HTMLSelectElement>('#pk-variant')?.value || 'holdem') as VariantId
    const v = VARIANTS[variantId]
    const seatCount = clamp(Math.round(num('#pk-seats', 6)), 2, v.maxSeats)
    const botCount = clamp(Math.round(num('#pk-bots', 4)), 0, seatCount - 1)
    const startingStack = Math.max(100, Math.round(num('#pk-stack', 1500)))
    const config: RoomConfig = {
      variantId, seatCount, startingStack,
      buyIn: Math.max(100, Math.round(num('#pk-buyin', startingStack))),
      smallBlind: Math.max(1, Math.round(num('#pk-sb', 10))),
      bigBlind: Math.max(2, Math.round(num('#pk-bb', 20))),
      ante: 0, botCount,
      botPersonality: (this.q<HTMLSelectElement>('#pk-pers')?.value || 'mixed') as RoomConfig['botPersonality'],
    }
    const nm = this.q<HTMLInputElement>('#pk-rn')?.value.trim() || `${v.name} table`
    const res = rooms.create(nm, config)
    if ('error' in res) { const e = this.q('#pk-create-err'); if (e) { e.textContent = res.error; (e as HTMLElement).hidden = false } return }
    this.roomId = res.id
    this.screen = 'room'
    this.route()
  }

  /* ───────────────────────────  ROOM  ─────────────────────────────── */

  private syncRoom() {
    const fresh = this.roomId ? rooms.get(this.roomId) : null
    if (fresh) { this.room = fresh; if (this.screen === 'room') this.renderRoom() }
  }

  private renderRoom() {
    clearTimeout(this.botTimer)
    this.screen = 'room'
    this.state = null
    const r = this.room!
    const cfg = r.config
    const kindLabel: Record<SeatKind, string> = { human: 'Human', bot: 'Bot', empty: 'Empty', spectator: 'Spectator' }
    const seatRow = (i: number) => {
      const s = r.seats[i] || { index: i, kind: 'empty' as SeatKind, name: '', chips: 0 }
      const busted = (s.kind === 'human' || s.kind === 'bot') && s.chips <= 0
      return `<div data-type="pk-seat-row" data-kind="${s.kind}">
        <span data-type="pk-seat-no">${i + 1}</span>
        <button data-cycle="${i}" type="button" data-variant="ghost">${kindLabel[s.kind]}</button>
        <span data-type="pk-seat-name">${s.kind === 'empty' ? '<em>open seat</em>' : esc(s.name || '')}</span>
        <span data-type="pk-seat-chips">${s.kind === 'empty' ? '' : fmtChips(s.chips) + (busted ? ' · busted' : '')}</span>
        ${busted ? `<button data-rebuy="${i}" type="button" data-variant="ghost">Rebuy</button>` : ''}
      </div>`
    }
    const seatCount = clamp(cfg.seatCount, 2, VARIANTS[cfg.variantId].maxSeats)
    this.innerHTML = `
      <div data-type="pk-game" data-screen="room">
        <div data-type="pk-header">
          <div data-type="pk-titlebar"><h1>${esc(r.name)}</h1><span data-type="pk-badge">${esc(VARIANTS[cfg.variantId].name)}</span></div>
          <p>${esc(VARIANTS[cfg.variantId].blurb)} Blinds ${cfg.smallBlind}/${cfg.bigBlind} · buy-in ${fmtChips(cfg.startingStack)}. Tap a seat to cycle Human / Bot / Empty, then deal.</p>
        </div>
        <section data-type="pk-panel">
          <h2>Seats</h2>
          <div data-type="pk-seat-list">${Array.from({ length: seatCount }, (_, i) => seatRow(i)).join('')}</div>
        </section>
        <div data-type="pk-actions">
          <button id="pk-deal" type="button" data-variant="primary">Deal hand</button>
          <button id="pk-back" type="button" data-variant="ghost">Back to lobby</button>
          <button id="pk-delete" type="button" data-variant="ghost">Delete table</button>
          <span data-type="pk-note" id="pk-room-note"></span>
        </div>
      </div>`
    this.qa('[data-cycle]').forEach(b => b.addEventListener('click', () => this.cycleSeat(Number((b as HTMLElement).dataset.cycle))))
    this.qa('[data-rebuy]').forEach(b => b.addEventListener('click', () => this.rebuy(Number((b as HTMLElement).dataset.rebuy))))
    this.q('#pk-deal')?.addEventListener('click', () => this.deal())
    this.q('#pk-back')?.addEventListener('click', () => { this.roomId = this.roomId; this.screen = 'lobby'; this.route() })
    this.q('#pk-delete')?.addEventListener('click', () => { if (this.roomId) rooms.remove(this.roomId); this.roomId = null; this.screen = 'lobby'; this.route() })
  }

  private cycleSeat(i: number) {
    const r = this.room!
    const s = r.seats[i] || (r.seats[i] = { index: i, kind: 'empty', name: '', chips: 0 })
    const order: SeatKind[] = ['empty', 'human', 'bot']
    const next = order[(order.indexOf(s.kind === 'spectator' ? 'empty' : s.kind) + 1) % order.length]
    s.kind = next
    if (next === 'empty') { s.chips = 0; s.name = '' }
    else {
      s.chips = r.config.startingStack
      if (next === 'human') s.name = i === 0 ? hostName() : `Player ${i + 1}`
      else { s.name = s.name && s.kind === 'bot' ? s.name : this.botLabel(i); s.personality = r.config.botPersonality === 'mixed' ? BOT_PERSONALITIES[Math.floor(Math.random() * BOT_PERSONALITIES.length)] : r.config.botPersonality }
    }
    rooms.save(r)
    this.renderRoom()
  }
  private botLabel(i: number) { const names = ['Ivy', 'Doyle', 'Stu', 'Chip', 'Vera', 'Nash', 'Mona', 'Rex', 'Cleo', 'Sol', 'Gus', 'Pia', 'Ace', 'Lux', 'Bo']; return names[i % names.length] }

  /** Rebuy top-up amount for this room (falls back to the initial buy-in). */
  private rebuyAmount() { const c = this.room!.config; return c.buyIn ?? c.startingStack }

  private rebuy(i: number) {
    const r = this.room!
    if (r.seats[i]) { r.seats[i].chips = this.rebuyAmount(); rooms.save(r); this.renderRoom() }
  }

  /* ───────────────────────────  TABLE  ────────────────────────────── */

  private deal() {
    const r = this.room!
    const playable = r.seats.filter(s => (s.kind === 'human' || s.kind === 'bot') && s.chips > 0)
    if (playable.length < 2) { const n = this.q('#pk-room-note'); if (n) n.textContent = 'Need at least 2 seated players with chips.'; return }
    r.handNumber = (r.handNumber || 0) + 1
    this.buttonSeat = this.nextButton(playable.map(s => s.index), this.buttonSeat)
    this.heroSeat = (r.seats.find(s => s.kind === 'human' && s.chips > 0)?.index) ?? playable[0].index
    this.state = startHand({
      seats: r.seats.map(s => ({ index: s.index, kind: s.kind, name: s.name, chips: s.chips, personality: s.personality })),
      variant: VARIANTS[r.config.variantId],
      smallBlind: r.config.smallBlind, bigBlind: r.config.bigBlind, ante: r.config.ante,
      buttonSeat: this.buttonSeat, handNumber: r.handNumber,
    })
    this.screen = 'table'
    this.enterTable()
    this.tick()
  }

  private nextButton(seats: number[], cur: number): number {
    if (!seats.length) return 0
    const sorted = [...seats].sort((a, b) => a - b)
    const after = sorted.find(s => s > cur)
    return after ?? sorted[0]
  }

  private enterTable() {
    this.screen = 'table'
    this.saveSession()
    this.innerHTML = `
      <div data-type="pk-game" data-screen="table">
        <div data-type="pk-table-bar">
          <button id="pk-leave" type="button" data-variant="ghost">‹ Leave</button>
          <span data-type="pk-table-title" id="pk-title"></span>
          <span data-type="pk-note" id="pk-street"></span>
        </div>
        <div data-type="pk-stage"><canvas data-type="pk-canvas" role="img" aria-label="Poker table"></canvas></div>
        <div data-type="pk-message" id="pk-msg" aria-live="polite"></div>
        <div data-type="pk-controls" id="pk-controls"></div>
        <div data-type="pk-handover" id="pk-handover" hidden></div>
        <details data-type="pk-log-wrap"><summary>Hand log</summary><ol data-type="pk-log" id="pk-log"></ol></details>
      </div>`
    this.canvas = this.q<HTMLCanvasElement>('[data-type="pk-canvas"]')
    if (this.canvas) {
      this.renderer?.destroy()
      this.renderer = createRenderer(this.canvas)
      this.ro?.disconnect()
      this.ro = new ResizeObserver(() => { this.renderer?.resize(); this.renderTable() })
      this.ro.observe(this.q('[data-type="pk-stage"]') as Element)
    }
    this.q('#pk-leave')?.addEventListener('click', () => this.leaveTable())
    requestAnimationFrame(() => { this.renderer?.resize(); this.renderTable() })
  }

  private leaveTable() {
    this.commitChips()
    clearTimeout(this.botTimer)
    this.clearTurnTimer()
    this.screen = 'room'
    this.route()
  }

  private tick() {
    const s = this.state
    if (!s) return
    this.renderTable()
    if (s.complete) { this.handOver(); return }
    const kind = currentActorKind(s)
    if (kind === 'bot') {
      this.hideControls()
      const inp = botInputFor(s)
      const d = inp ? decide(inp) : { action: 'check' as const }
      // Bots act fast but always visibly "think" for a beat so moves never blur
      // past each other — even with reduced motion we keep a perceptible pause.
      const wait = this.reduced ? 350 : clamp(d.think ?? 700, 550, 1400)
      this.botTimer = window.setTimeout(() => {
        if (!this.state || this.screen !== 'table') return
        applyAction(this.state, { type: d.action, amount: d.amountTo })
        this.tick()
      }, wait)
    } else if (kind === 'human') {
      this.heroSeat = s.toActSeat
      this.showControls(s)
    } else {
      this.handOver()
    }
  }

  private commitChips() {
    const s = this.state, r = this.room
    if (!s || !r) return
    for (const seat of r.seats) if (s.stacks[seat.index] !== undefined) seat.chips = s.stacks[seat.index]
    rooms.save(r)
  }

  /* ── table view mapping ── */

  private tableSeats(): { index: number; kind: SeatKind; name: string; chips: number }[] {
    const r = this.room!
    return r.seats.filter(s => s.kind === 'human' || s.kind === 'bot')
  }

  private buildView(): TableView {
    const s = this.state!
    const r = this.room!
    const seats = this.tableSeats()
    const heroPos = Math.max(0, seats.findIndex(x => x.index === this.heroSeat))
    const showdown = s.complete && s.street === 'showdown'
    const ordered: SeatView[] = []
    const holeCount = VARIANTS[r.config.variantId].holeCards
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[(heroPos + i) % seats.length]
      const p = s.players.find(pp => pp.seatIndex === seat.index)
      const isHero = seat.index === this.heroSeat
      const reveal = p && !p.folded && (showdown || (isHero && currentActorKind(s) === 'human' && s.toActSeat === seat.index))
      const hole: (Card | null)[] = p
        ? p.hole.map(c => (reveal ? c : null))
        : new Array(holeCount).fill(null)
      const chips = s.stacks[seat.index] ?? seat.chips
      ordered.push({
        index: seat.index, name: seat.name, chips,
        hole, folded: !!p?.folded, allIn: !!p?.allIn,
        isButton: seat.index === s.buttonSeat, isTurn: seat.index === s.toActSeat, isHero,
        committed: p?.committed ?? 0,
        status: this.seatStatus(s, seat.index, p),
        empty: !p,
      })
    }
    let pot = 0
    for (const p of s.players) pot += p.totalCommitted
    return {
      seats: ordered, board: s.board, pot,
      sidePots: s.pots.length > 1 ? s.pots.map(pp => pp.amount) : [],
      street: s.street, variantName: VARIANTS[r.config.variantId].name, handNumber: s.handNumber,
      message: s.complete ? this.winnerLine(s) : undefined,
    }
  }

  private seatStatus(s: GameState, seat: number, p?: PlayerHand): string | undefined {
    const win = s.winners.find(w => w.seatIndex === seat)
    if (win && s.complete) return `WON +${fmtChips(win.amount)}`
    if (!p) return undefined
    if (p.folded) return 'FOLD'
    if (p.allIn) return 'ALL IN'
    if (seat === s.buttonSeat) return undefined
    return p.lastAction ? p.lastAction.toUpperCase() : undefined
  }

  private winnerLine(s: GameState): string {
    if (!s.winners.length) return 'Hand over.'
    const parts = s.winners.map(w => `${s.seatMeta[w.seatIndex]?.name ?? 'Seat'} +${fmtChips(w.amount)}${w.rank ? ` (${w.rank.name})` : ''}`)
    return parts.join(' · ')
  }

  private renderTable() {
    const s = this.state
    if (!s || !this.renderer) return
    this.renderer.draw(this.buildView())
    const title = this.q('#pk-title'); if (title) title.textContent = `${VARIANTS[this.room!.config.variantId].name} · Hand #${s.handNumber}`
    const street = this.q('#pk-street'); if (street) street.textContent = s.complete ? 'hand over' : s.street
    const msg = this.q('#pk-msg')
    if (msg) {
      if (s.complete) msg.textContent = this.winnerLine(s)
      else {
        const actor = s.seatMeta[s.toActSeat]?.name
        const kind = currentActorKind(s)
        msg.textContent = kind === 'human' ? `${actor}, your move` : actor ? `${actor} is thinking…` : ''
      }
    }
    const log = this.q('#pk-log')
    if (log) log.innerHTML = s.log.slice(-40).map(l => `<li data-kind="${l.kind}">${esc(l.text)}</li>`).join('')
  }

  /* ── human controls ── */

  private hideControls() { this.clearTurnTimer(); const c = this.q('#pk-controls'); if (c) c.innerHTML = '' }

  /* ── per-turn action clock ── */

  private clearTurnTimer() {
    clearTimeout(this.turnTimeout); this.turnTimeout = 0
    clearInterval(this.turnTick); this.turnTick = 0
  }

  /** Give the human 2 minutes to act; on timeout auto-check, else auto-fold. */
  private startTurnTimer(canCheck: boolean) {
    this.clearTurnTimer()
    const LIMIT = 120_000
    const deadline = Date.now() + LIMIT
    const paint = () => {
      const left = Math.max(0, deadline - Date.now())
      const el = this.q('#pk-timer')
      if (el) {
        const sec = Math.ceil(left / 1000)
        el.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
        ;(el as HTMLElement).dataset.low = left <= 20_000 ? 'true' : 'false'
      }
    }
    paint()
    this.turnTick = window.setInterval(paint, 500)
    this.turnTimeout = window.setTimeout(() => {
      this.clearTurnTimer()
      if (!this.state || this.screen !== 'table' || currentActorKind(this.state) !== 'human') return
      this.human(canCheck ? { type: 'check' } : { type: 'fold' })
    }, LIMIT)
  }

  private showControls(s: GameState) {
    const ho = this.q('#pk-handover'); if (ho) (ho as HTMLElement).hidden = true
    const req = legalActions(s)
    const c = this.q('#pk-controls')
    if (!req || !c) return
    const p = s.players.find(pp => pp.seatIndex === s.toActSeat)!
    let pot = 0; for (const pl of s.players) pot += pl.totalCommitted
    const canAggress = req.canBet || req.canRaise
    const lo = req.minRaiseTo, hi = req.maxRaiseTo
    const start = clamp(lo, lo, hi)
    const potRaiseTo = s.betToMatch + (pot + req.toCall)

    // Quick-raise targets (each a TOTAL to reach). When opening we offer big-blind
    // multiples; when facing a bet we offer multiples of the current bet. Values
    // are clamped into [min, all-in] and de-duped so no two chips do the same thing.
    const raw: [string, number][] = req.canBet
      ? [['2 BB', 2 * req.bigBlind], ['3 BB', 3 * req.bigBlind], ['½ Pot', s.betToMatch + 0.5 * (pot + req.toCall)], ['Pot', potRaiseTo]]
      : [['2×', 2 * s.betToMatch], ['3×', 3 * s.betToMatch], ['Pot', potRaiseTo]]
    const presets: [string, number][] = ([['Min', lo], ...raw, ['All-in', hi]] as [string, number][])
      .map(([label, to]) => [label, clamp(Math.round(to), lo, hi)] as [string, number])
      .filter(([, to], i, arr) => arr.findIndex(x => x[1] === to) === i)

    c.innerHTML = `
      <div data-type="pk-clock"><span data-type="pk-timer" id="pk-timer">2:00</span></div>
      <div data-type="pk-btns">
        <button data-act="fold" type="button" data-variant="danger">Fold</button>
        ${req.canCheck
          ? `<button data-act="check" type="button">Check</button>`
          : `<button data-act="call" type="button" data-variant="primary">Call ${fmtChips(req.toCall)}</button>`}
        ${canAggress ? `<button data-act="raise" type="button" data-variant="primary">${req.canBet ? 'Bet' : 'Raise to'} <span id="pk-amt">${fmtChips(start)}</span></button>` : ''}
      </div>
      ${canAggress ? `
      <div data-type="pk-raise">
        <input id="pk-slider" type="range" min="${lo}" max="${hi}" step="1" value="${start}" aria-label="Bet amount" ${lo >= hi ? 'disabled' : ''} />
        <div data-type="pk-presets">
          ${presets.map(([label, to]) => `<button data-to="${to}" type="button">${esc(label)}</button>`).join('')}
        </div>
      </div>` : ''}
      <p data-type="pk-hint">${this.reduced ? '' : 'F = fold · Space = check/call'}</p>`

    const slider = this.q<HTMLInputElement>('#pk-slider')
    const amt = this.q('#pk-amt')
    const setAmt = (v: number) => { const vv = clamp(Math.round(v), lo, hi); if (slider) slider.value = String(vv); if (amt) amt.textContent = fmtChips(vv) }
    slider?.addEventListener('input', () => setAmt(Number(slider.value)))
    this.qa('[data-to]').forEach(b => b.addEventListener('click', () => setAmt(Number((b as HTMLElement).dataset.to))))
    this.q('[data-act="fold"]')?.addEventListener('click', () => this.human({ type: 'fold' }))
    this.q('[data-act="check"]')?.addEventListener('click', () => this.human({ type: 'check' }))
    this.q('[data-act="call"]')?.addEventListener('click', () => this.human({ type: 'call' }))
    this.q('[data-act="raise"]')?.addEventListener('click', () => this.human({ type: req.canBet ? 'bet' : 'raise', amount: Number(slider?.value ?? start) }))
    this.startTurnTimer(req.canCheck)

    this.onKey = (e: KeyboardEvent) => {
      if (this.screen !== 'table' || !this.state || currentActorKind(this.state) !== 'human') return
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); this.human({ type: 'fold' }) }
      else if (e.key === ' ') { e.preventDefault(); this.human(req.canCheck ? { type: 'check' } : { type: 'call' }) }
    }
    window.addEventListener('keydown', this.onKey)
  }

  private onKey: ((e: KeyboardEvent) => void) | null = null

  private human(a: { type: 'fold' | 'check' | 'call' | 'bet' | 'raise'; amount?: number }) {
    if (!this.state) return
    if (this.onKey) { window.removeEventListener('keydown', this.onKey); this.onKey = null }
    this.hideControls()
    applyAction(this.state, a)
    this.tick()
  }

  private handOver() {
    if (this.onKey) { window.removeEventListener('keydown', this.onKey); this.onKey = null }
    this.hideControls()
    this.commitChips()
    const s = this.state!, r = this.room!
    const withChips = r.seats.filter(x => (x.kind === 'human' || x.kind === 'bot') && x.chips > 0).length
    const heroBusted = (r.seats.find(x => x.index === this.heroSeat)?.chips ?? 0) <= 0
    const ho = this.q('#pk-handover')
    if (!ho) return
    ;(ho as HTMLElement).hidden = false
    ho.innerHTML = `
      <div data-type="pk-result"><strong>${esc(this.winnerLine(s))}</strong></div>
      <div data-type="pk-actions">
        ${withChips >= 2 ? `<button id="pk-next" type="button" data-variant="primary">Next hand</button>` : `<span data-type="pk-note">Not enough players with chips.</span>`}
        ${heroBusted ? `<button id="pk-rebuy" type="button">Rebuy ${fmtChips(this.rebuyAmount())}</button>` : ''}
        <button id="pk-leave2" type="button" data-variant="ghost">Leave table</button>
      </div>`
    this.q('#pk-next')?.addEventListener('click', () => { (ho as HTMLElement).hidden = true; this.deal() })
    this.q('#pk-rebuy')?.addEventListener('click', () => { const seat = r.seats.find(x => x.index === this.heroSeat); if (seat) { seat.chips = this.rebuyAmount(); rooms.save(r) } this.handOver() })
    this.q('#pk-leave2')?.addEventListener('click', () => this.leaveTable())
  }

  /* ── tiny DOM helpers ── */
  private q<T extends Element = HTMLElement>(sel: string): T | null { return this.querySelector<T>(sel) }
  private qa(sel: string): Element[] { return Array.from(this.querySelectorAll(sel)) }
}

if (!customElements.get('poker-game')) {
  customElements.define('poker-game', PokerGame)
}
