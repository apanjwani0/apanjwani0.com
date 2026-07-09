/**
 * Poker Together — orchestrator WebComponent (<poker-game>).
 *
 * A fully client-side, local-first poker room. Everything lives inside this one
 * component (the site never adds a route): a HOME (bankroll + one-tap Practice +
 * Friends-table tiles), a CREATE (minimal friends-table setup), a ROOM (configure
 * seats — humans for hotseat pass-and-play, bots, or empty), and a TABLE (play).
 * Rooms and chips persist in localStorage (max 10 rooms, 15 seats each); cross-tab
 * presence keeps home in sync between browser tabs. Bots act on their own with a
 * short think delay. Play-money only — no real wagering.
 *
 * Screens are swapped by rewriting innerHTML; the table shell is built once
 * (enterTable) and its regions are repainted in place each tick (renderTable)
 * from a TableView, using the SVG asset catalogue (cards-svg / assets-svg) for
 * every card, avatar, button and timer — no <canvas>. All timers are torn down
 * in disconnectedCallback so nothing leaks across Astro View Transitions.
 */

import { rooms, hostName, setHostName, bankroll, makeSeats, oddsPet, setOddsPet } from './engine/rooms'
import { currentUser, login, signup, logout } from './engine/net-api'
import { startHand, legalActions, applyAction, botInputFor, currentActorKind, fmtChips } from './engine/engine'
import { decide, estimateEquity } from './engine/bots'
import { evaluateBest, evaluateOmaha } from './engine/evaluator'
import { seededRng, hashSeed } from './engine/cards'
import type { LogEntry, Transport } from './engine/net-log'
import { createPbSession, type PbSession } from './engine/net-pb'
import { cardSvg, cardBackSvg, suitSvg } from './ui/cards-svg'
import { avatarSvg, buttonSvg, timerPieSvg, iconSvg, crownSvg, wordmarkSvg, chipSvg } from './ui/assets-svg'
import { VARIANTS, BOT_PERSONALITIES, LS, MAX_ROOMS, clamp } from './engine/types'
import type {
  Room, RoomConfig, GameState, VariantId, SeatKind, TableView, SeatView, Card, PlayerHand,
} from './engine/types'

const VARIANT_IDS = Object.keys(VARIANTS) as VariantId[]

/** A fixed public quick-play table. Stable id ⇒ chips persist across sessions;
 *  always kept live with bots (real humans arrive with the P2P slice). */
interface PublicPreset { id: string; tier: string; code: string; config: RoomConfig }
const PUBLIC_ROOMS: PublicPreset[] = [
  { id: 'pub_holdem_micro', tier: 'Micro', code: 'NLHE', config: { variantId: 'holdem', seatCount: 6, startingStack: 1500, buyIn: 1500, smallBlind: 10, bigBlind: 20, ante: 0, botCount: 5, botPersonality: 'mixed' } },
  { id: 'pub_holdem_low', tier: 'Low', code: 'NLHE', config: { variantId: 'holdem', seatCount: 6, startingStack: 5000, buyIn: 5000, smallBlind: 25, bigBlind: 50, ante: 0, botCount: 5, botPersonality: 'mixed' } },
  { id: 'pub_omaha', tier: 'PLO', code: 'OMAHA', config: { variantId: 'omaha', seatCount: 6, startingStack: 5000, buyIn: 5000, smallBlind: 25, bigBlind: 50, ante: 0, botCount: 5, botPersonality: 'mixed' } },
  { id: 'pub_bomb', tier: 'Bomb', code: 'BOMB', config: { variantId: 'bomb', seatCount: 6, startingStack: 2500, buyIn: 2500, smallBlind: 25, bigBlind: 50, ante: 25, botCount: 5, botPersonality: 'mixed' } },
  { id: 'pub_holdem_high', tier: 'High', code: 'NLHE', config: { variantId: 'holdem', seatCount: 6, startingStack: 20000, buyIn: 20000, smallBlind: 100, bigBlind: 200, ante: 0, botCount: 5, botPersonality: 'mixed' } },
]

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

/** Short, unambiguous invite code (no 0/O/1/I/L); doubles as the P2P room id. */
function makeInviteCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const rand = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(6)) : null
  let out = ''
  for (let i = 0; i < 6; i++) out += alphabet[(rand ? rand[i] : Math.floor(Math.random() * 1e9)) % alphabet.length]
  return out
}

/** Random per-hand shuffle seed. The host generates it and every peer replays the
 *  identical deck via seededRng(hashSeed(seed)) — this is what makes P2P sync work. */
function makeSeed(): string {
  const r = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(2)) : null
  return r ? `${r[0]}-${r[1]}` : `${Math.floor(Math.random() * 2 ** 31)}-${Math.floor(Math.random() * 2 ** 31)}`
}

class PokerGame extends HTMLElement {
  private screen: 'home' | 'create' | 'room' | 'table' | 'joining' = 'home'
  private roomId: string | null = null
  private room: Room | null = null
  private state: GameState | null = null
  private buttonSeat = 0
  private heroSeat = 0
  private cardsRevealedSeat: number | null = null

  // Odds-pet equity, memoised per (hole+board+opponents) so repaints don't
  // re-run the Monte Carlo (which would also make the % jitter every tick).
  private equityKey = ''
  private equityPct: number | null = null

  // Home account panel open/closed (inline sign-in, survives store re-renders).
  private authOpen = false
  private authBusy = false

  // Table transport: log-driven loop. Local play uses a synchronous loopback;
  // online swaps in a Trystero session. isHost runs the bots + seals the log;
  // online joiners only submit their own seat's moves. mySeat is set online.
  private transport: Transport | null = null
  private pb: PbSession | null = null       // the online session (=== transport when online)
  private peer = ''                          // stable per-client id for presence
  private online = false
  private isHost = true
  private mySeat: number | null = null

  private botTimer = 0
  private turnTimeout = 0
  private turnTick = 0
  private unsub: (() => void) | null = null
  private reduced = false

  connectedCallback() {
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.unsub = rooms.subscribe(() => {
      if (this.screen === 'home') this.renderHome()
      else if (this.screen === 'room') this.syncRoom()
    })
    const join = new URLSearchParams(location.search).get('join')
    if (join) { this.joinOnline(join.trim().toUpperCase()); return }
    this.restoreSession()
    this.route()
  }

  disconnectedCallback() {
    clearTimeout(this.botTimer)
    this.clearTurnTimer()
    this.transport?.destroy()
    this.transport = null
    this.pb = null
    this.unsub?.()
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
      if (!this.room) { this.screen = 'home'; this.roomId = null }
    }
    if (this.screen === 'room' && this.room) this.renderRoom()
    else if (this.screen === 'table' && this.room && this.state) this.enterTable()
    else { this.screen = 'home'; this.renderHome() }
    this.saveSession()
  }

  /* ───────────────────────────  HOME  ─────────────────────────────── */

  /** Bankroll-first home: wordmark, wallet, two playing-card mode tiles, and a
   *  resume list. Onboarding is one optional name field — Practice is one tap. */
  private renderHome() {
    clearTimeout(this.botTimer)
    this.screen = 'home'
    this.state = null
    this.cardsRevealedSeat = null
    const list = rooms.list().filter(r => !r.public)
    const tableCard = (r: Room) => {
      const filled = r.seats.filter(s => s.kind === 'human' || s.kind === 'bot').length
      return `<article data-type="pk-room-card">
        <div data-type="pk-room-main">
          <strong>${esc(r.name)}</strong>
          <span data-type="pk-room-meta">${esc(VARIANTS[r.config.variantId].name)} · ${filled} seated · ${r.config.smallBlind}/${r.config.bigBlind}</span>
        </div>
        <div data-type="pk-room-actions">
          <button data-open="${r.id}" type="button" data-variant="primary">Resume</button>
          <button data-del="${r.id}" type="button" data-variant="ghost">Delete</button>
        </div>
      </article>`
    }
    // A public quick-play table — tap to sit down mid-session and get dealt in.
    const publicCard = (p: PublicPreset) => {
      const saved = rooms.get(p.id)
      const seated = saved ? saved.seats.filter(s => s.kind === 'human' || s.kind === 'bot').length : p.config.botCount + 1
      return `<button data-type="pk-pub" data-join="${p.id}" type="button">
        <span data-type="pk-pub-code">${esc(p.code)}</span>
        <span data-type="pk-pub-tier">${esc(p.tier)}</span>
        <span data-type="pk-pub-stakes">${p.config.smallBlind}/${p.config.bigBlind}</span>
        <span data-type="pk-pub-live"><span data-type="pk-pub-dot"></span>${seated} seated</span>
      </button>`
    }
    // Each mode is a tilted playing card — the game's "everything is a card" signature.
    const modeTile = (id: string, suit: 'spade' | 'heart', pip: 's' | 'h', name: string, sub: string) =>
      `<button data-type="pk-mode" data-suit="${suit}" id="${id}" type="button">
        <span data-type="pk-mode-pip">${suitSvg(pip)}</span>
        <span data-type="pk-mode-name">${name}</span>
        <span data-type="pk-mode-sub">${sub}</span>
      </button>`
    const user = currentUser()
    const acct = user
      ? `<button id="pk-acct" data-type="pk-acct" type="button" title="Sign out">@${esc(user.name)} · sign out</button>`
      : `<button id="pk-acct" data-type="pk-acct" type="button">Sign in</button>`
    this.innerHTML = `
      <div data-type="pk-game" data-screen="home">
        <header data-type="pk-home-top">
          <span data-type="pk-wordmark">${wordmarkSvg()}</span>
          <div data-type="pk-home-right">
            <span data-type="pk-badge">play-money</span>
            ${acct}
          </div>
        </header>
        ${this.authOpen && !user ? this.authPanel() : ''}
        <p data-type="pk-err" id="pk-home-err" hidden></p>

        <div data-type="pk-home-body">
          <div data-type="pk-home-main">
            <section data-type="pk-bankroll">
              <span data-type="pk-bankroll-label">Bankroll</span>
              <span data-type="pk-bankroll-val"><span data-type="pk-chip">${chipSvg(1000)}</span>${fmtChips(bankroll())}</span>
            </section>
            <div data-type="pk-modes">
              ${modeTile('pk-practice', 'spade', 's', 'Practice', 'Deal in vs bots — one tap')}
              ${modeTile('pk-friends', 'heart', 'h', 'Friends table', 'Create &amp; share a room')}
            </div>
            <label data-type="pk-name-inline"><span>You play as</span>
              <input id="pk-name" type="text" maxlength="20" value="${esc(hostName())}" placeholder="You" /></label>
          </div>

          <div data-type="pk-home-side">
            <section data-type="pk-tables" data-kind="public">
              <h2>Public tables</h2>
              <div data-type="pk-pub-strip">${PUBLIC_ROOMS.map(publicCard).join('')}</div>
            </section>
            ${list.length ? `<section data-type="pk-tables" data-kind="mine">
              <h2>Your tables</h2>
              <div data-type="pk-room-list">${list.map(tableCard).join('')}</div>
            </section>` : ''}
          </div>
        </div>

        <details data-type="pk-explainer">
          <summary>How this works</summary>
          <p><strong>Practice</strong> seats you against bots (five personalities, from tight Rocks to loose Maniacs) that read the board with a real equity estimate — one tap, no setup. <strong>Friends table</strong> lets you build a private room and pass one device around: only the player whose turn it is sees their cards.</p>
          <p>Everything is <strong>local-first</strong> — rooms and chips live in your browser, no server, no sign-up. The shuffle uses your device's cryptographic RNG (rejection-sampled, unbiased); the hand engine, Omaha's exactly-two rule and side pots all run on your machine.</p>
        </details>
      </div>`
    this.wireHome()
  }

  private wireHome() {
    const name = this.q<HTMLInputElement>('#pk-name')
    name?.addEventListener('change', () => setHostName(name.value.trim() || 'You'))
    const user = currentUser()
    this.q('#pk-acct')?.addEventListener('click', () => {
      if (user) { logout(); this.authOpen = false }
      else { this.authOpen = !this.authOpen }
      this.renderHome()
    })
    if (this.authOpen && !user) {
      this.q('#pk-auth-cancel')?.addEventListener('click', () => { this.authOpen = false; this.renderHome() })
      this.q('#pk-auth-login')?.addEventListener('click', () => this.doAuth('login'))
      this.q('#pk-auth-signup')?.addEventListener('click', () => this.doAuth('signup'))
    }
    this.q('#pk-practice')?.addEventListener('click', () => this.startPractice())
    this.q('#pk-friends')?.addEventListener('click', () => this.renderCreate())
    this.qa('[data-join]').forEach(b => b.addEventListener('click', () => {
      const p = PUBLIC_ROOMS.find(x => x.id === (b as HTMLElement).dataset.join)
      if (p) this.joinPublic(p)
    }))
    this.qa('[data-open]').forEach(b => b.addEventListener('click', () => { this.roomId = (b as HTMLElement).dataset.open!; this.screen = 'room'; this.route() }))
    this.qa('[data-del]').forEach(b => b.addEventListener('click', () => { rooms.remove((b as HTMLElement).dataset.del!); this.renderHome() }))
  }

  /** Sit down at a fixed public table: resume its saved chips if we've played it
   *  before, else spin it up with bots, then keep it live and deal straight in. */
  private joinPublic(p: PublicPreset) {
    const room: Room = rooms.get(p.id) ?? {
      id: p.id,
      name: `${VARIANTS[p.config.variantId].name} · ${p.tier}`,
      createdAt: Date.now(), updatedAt: Date.now(),
      config: p.config, seats: makeSeats(p.config), handNumber: 0, public: true,
    }
    // You take seat 0; refill any busted seat so the table never runs dry (bot-fill).
    room.seats[0] = { ...room.seats[0], index: 0, kind: 'human', name: hostName() }
    for (const s of room.seats) if ((s.kind === 'human' || s.kind === 'bot') && s.chips <= 0) s.chips = room.config.startingStack
    rooms.save(room)
    this.room = room
    this.roomId = room.id
    this.deal()
  }

  /** Inline sign-in panel (accounts are optional; see docs/poker-backend.md). */
  private authPanel(): string {
    const prefill = hostName() === 'You' ? '' : hostName()
    return `<section data-type="pk-auth">
      <h2>Sign in</h2>
      <div data-type="pk-form">
        <label data-type="pk-field"><span>Name</span><input id="pk-auth-name" type="text" maxlength="20" value="${esc(prefill)}" placeholder="your name" autocomplete="username" /></label>
        <label data-type="pk-field"><span>Password</span><input id="pk-auth-pw" type="password" maxlength="72" placeholder="at least 8 characters" autocomplete="current-password" /></label>
      </div>
      <div data-type="pk-actions">
        <button id="pk-auth-login" type="button" data-variant="primary">Sign in</button>
        <button id="pk-auth-signup" type="button">Create account</button>
        <button id="pk-auth-cancel" type="button" data-variant="ghost">Cancel</button>
      </div>
      <p data-type="pk-err" id="pk-auth-err" hidden></p>
      <p data-type="pk-note">Optional — keeps your name &amp; rooms across devices. The game works offline without it.</p>
    </section>`
  }

  private async doAuth(mode: 'login' | 'signup') {
    if (this.authBusy) return
    const name = this.q<HTMLInputElement>('#pk-auth-name')?.value.trim() || ''
    const pw = this.q<HTMLInputElement>('#pk-auth-pw')?.value || ''
    const errEl = this.q('#pk-auth-err')
    const fail = (m: string) => { if (errEl) { errEl.textContent = m; (errEl as HTMLElement).hidden = false } }
    if (name.length < 2) return fail('Enter a name (2+ characters).')
    if (pw.length < 8) return fail('Password must be at least 8 characters.')
    this.authBusy = true
    const btn = this.q<HTMLButtonElement>(mode === 'login' ? '#pk-auth-login' : '#pk-auth-signup')
    const label = btn?.textContent ?? ''
    if (btn) { btn.disabled = true; btn.textContent = '…' }
    try {
      const acct = mode === 'login' ? await login(name, pw) : await signup(name, pw)
      setHostName(acct.name)
      this.authBusy = false
      this.authOpen = false
      this.renderHome()
    } catch (e) {
      this.authBusy = false
      if (btn) { btn.disabled = false; btn.textContent = label }
      const msg = e instanceof Error ? e.message : 'Something went wrong.'
      const offline = (e instanceof DOMException && e.name === 'AbortError') || /failed to fetch|networkerror|load failed/i.test(msg)
      fail(
        offline ? 'Backend offline — sign-in unavailable, but you can still play locally.'
          : mode === 'login' ? 'Wrong name or password.'
          : /create record|already|unique|value/i.test(msg) ? 'That name is taken — try signing in instead.'
          : msg,
      )
    }
  }

  /** One-tap quick play: a sensible Hold'em bot table, dealt immediately. */
  private startPractice() {
    const config: RoomConfig = {
      variantId: 'holdem', seatCount: 6, startingStack: 1500, buyIn: 1500,
      smallBlind: 10, bigBlind: 20, ante: 0, botCount: 4, botPersonality: 'mixed',
    }
    const res = rooms.create('Practice', config)
    if ('error' in res) {
      this.renderHome()
      const e = this.q('#pk-home-err')
      if (e) { e.textContent = `${res.error} Delete a table below first.`; (e as HTMLElement).hidden = false }
      return
    }
    this.room = res
    this.roomId = res.id
    this.deal()
  }

  /* ──────────────────────────  CREATE  ────────────────────────────── */

  /** Minimal "friends table" setup — sensible defaults, then choose seats. */
  private renderCreate() {
    clearTimeout(this.botTimer)
    this.screen = 'create'
    this.state = null
    this.innerHTML = `
      <div data-type="pk-game" data-screen="create">
        <div data-type="pk-header">
          <div data-type="pk-titlebar"><h1>New table</h1><span data-type="pk-badge">private</span></div>
          <p>Set the stakes, then choose who sits — friends (pass-and-play) or bots.</p>
        </div>
        <section data-type="pk-panel">
          <div data-type="pk-form">
            <label data-type="pk-field"><span>Table name</span><input id="pk-rn" type="text" maxlength="28" placeholder="Friday Night" /></label>
            <label data-type="pk-field"><span>Game</span>
              <select id="pk-variant">${VARIANT_IDS.map(v => `<option value="${v}">${esc(VARIANTS[v].name)}</option>`).join('')}</select></label>
            <label data-type="pk-field"><span>Seats</span><input id="pk-seats" type="number" min="2" max="10" value="6" /></label>
            <label data-type="pk-field"><span>Bots</span><input id="pk-bots" type="number" min="0" max="9" value="4" /></label>
            <label data-type="pk-field"><span>Buy-in</span><input id="pk-stack" type="number" min="100" step="100" value="1500" /></label>
            <label data-type="pk-field"><span>Small blind</span><input id="pk-sb" type="number" min="1" value="10" /></label>
            <label data-type="pk-field"><span>Big blind</span><input id="pk-bb" type="number" min="2" value="20" /></label>
          </div>
          <label data-type="pk-check"><input id="pk-realmoney" type="checkbox" /><span>Real-money table — buy-ins need an acknowledgement (the app still moves no money)</span></label>
          <div data-type="pk-actions">
            <button id="pk-create" type="button" data-variant="primary">Create &amp; seat</button>
            <button id="pk-c-back" type="button" data-variant="ghost">Cancel</button>
            <span data-type="pk-note">${rooms.list().length}/${MAX_ROOMS} rooms</span>
          </div>
          <p data-type="pk-err" id="pk-create-err" hidden></p>
        </section>
      </div>`
    this.q('#pk-c-back')?.addEventListener('click', () => this.renderHome())
    this.q('#pk-create')?.addEventListener('click', () => this.createRoom())
  }

  private createRoom() {
    const num = (sel: string, d: number) => { const v = Number(this.q<HTMLInputElement>(sel)?.value); return Number.isFinite(v) ? v : d }
    const variantId = (this.q<HTMLSelectElement>('#pk-variant')?.value || 'holdem') as VariantId
    const v = VARIANTS[variantId]
    const seatCount = clamp(Math.round(num('#pk-seats', 6)), 2, v.maxSeats)
    const botCount = clamp(Math.round(num('#pk-bots', 4)), 0, seatCount - 1)
    const startingStack = Math.max(100, Math.round(num('#pk-stack', 1500)))
    const smallBlind = Math.max(1, Math.round(num('#pk-sb', 10)))
    const bigBlind = Math.max(smallBlind + 1, Math.round(num('#pk-bb', 20)))
    const config: RoomConfig = {
      variantId, seatCount, startingStack,
      buyIn: Math.max(100, Math.round(num('#pk-buyin', startingStack))),
      smallBlind,
      bigBlind,
      ante: 0, botCount,
      botPersonality: (this.q<HTMLSelectElement>('#pk-pers')?.value || 'mixed') as RoomConfig['botPersonality'],
      realMoney: !!this.q<HTMLInputElement>('#pk-realmoney')?.checked,
    }
    const nm = this.q<HTMLInputElement>('#pk-rn')?.value.trim() || `${v.name} table`
    const res = rooms.create(nm, config)
    if ('error' in res) { const e = this.q('#pk-create-err'); if (e) { e.textContent = res.error; (e as HTMLElement).hidden = false } return }
    res.code = makeInviteCode()
    rooms.save(res)
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
    this.cardsRevealedSeat = null
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
          <div data-type="pk-titlebar"><h1>${esc(r.name)}</h1><span data-type="pk-badge">${esc(VARIANTS[cfg.variantId].name)}</span>${cfg.realMoney ? '<span data-type="pk-badge" data-money="true">real money</span>' : ''}</div>
          <p>${esc(VARIANTS[cfg.variantId].blurb)} Blinds ${cfg.smallBlind}/${cfg.bigBlind} · buy-in ${fmtChips(cfg.startingStack)}. Tap a seat to cycle Human / Bot / Empty, then deal.</p>
        </div>
        ${r.code ? `<section data-type="pk-panel">
          <h2>Invite</h2>
          <div data-type="pk-invite"><code data-type="pk-code">${esc(r.code)}</code><button id="pk-copy" type="button" data-variant="ghost">Copy link</button></div>
          <p data-type="pk-note">Share the link so friends join from their own device, or pass this one around for hotseat play.</p>
        </section>` : ''}
        <section data-type="pk-panel">
          <h2>Seats</h2>
          <div data-type="pk-seat-list">${Array.from({ length: seatCount }, (_, i) => seatRow(i)).join('')}</div>
        </section>
        <div data-type="pk-actions">
          <button id="pk-deal" type="button" data-variant="primary">Deal hand</button>
          ${r.code ? '<button id="pk-online" type="button" data-variant="primary">Play online</button>' : ''}
          <button id="pk-back" type="button" data-variant="ghost">Home</button>
          <button id="pk-delete" type="button" data-variant="ghost">Delete table</button>
          <span data-type="pk-note" id="pk-room-note"></span>
        </div>
      </div>`
    this.qa('[data-cycle]').forEach(b => b.addEventListener('click', () => this.cycleSeat(Number((b as HTMLElement).dataset.cycle))))
    this.qa('[data-rebuy]').forEach(b => b.addEventListener('click', () => this.rebuy(Number((b as HTMLElement).dataset.rebuy))))
    this.q('#pk-deal')?.addEventListener('click', () => this.deal())
    this.q('#pk-online')?.addEventListener('click', () => this.goOnline())
    this.q('#pk-back')?.addEventListener('click', () => { this.screen = 'home'; this.route() })
    this.q('#pk-delete')?.addEventListener('click', () => { if (this.roomId) rooms.remove(this.roomId); this.roomId = null; this.screen = 'home'; this.route() })
    this.q('#pk-copy')?.addEventListener('click', () => {
      const link = `${location.origin}/games/poker?join=${r.code}`
      const btn = this.q('#pk-copy')
      navigator.clipboard?.writeText(link).then(() => { if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { if (this.q('#pk-copy') === btn) btn.textContent = 'Copy link' }, 1500) } }).catch(() => {})
    })
  }

  private cycleSeat(i: number) {
    const r = this.room!
    const s = r.seats[i] || (r.seats[i] = { index: i, kind: 'empty', name: '', chips: 0 })
    const order: SeatKind[] = ['empty', 'human', 'bot']
    const prev = s.kind === 'spectator' ? 'empty' : s.kind
    const next = order[(order.indexOf(prev) + 1) % order.length]
    s.kind = next
    if (next === 'empty') { s.chips = 0; s.name = ''; s.personality = undefined }
    else {
      s.chips = r.config.startingStack
      if (next === 'human') s.name = i === 0 ? hostName() : `Player ${i + 1}`
      else {
        s.name = prev === 'bot' && s.name ? s.name : this.botLabel(i)
        s.personality = r.config.botPersonality === 'mixed'
          ? BOT_PERSONALITIES[Math.floor(Math.random() * BOT_PERSONALITIES.length)]
          : r.config.botPersonality
      }
    }
    rooms.save(r)
    this.renderRoom()
  }
  private botLabel(i: number) { const names = ['Ivy', 'Doyle', 'Stu', 'Chip', 'Vera', 'Nash', 'Mona', 'Rex', 'Cleo', 'Sol', 'Gus', 'Pia', 'Ace', 'Lux', 'Bo']; return names[i % names.length] }

  /** Rebuy top-up amount for this room (falls back to the initial buy-in). */
  private rebuyAmount() { const c = this.room!.config; return c.buyIn ?? c.startingStack }

  private async rebuy(i: number) {
    const r = this.room!
    const amt = this.rebuyAmount()
    if (r.config.realMoney && !(await this.ackRealMoney(amt))) return
    if (r.seats[i]) { r.seats[i].chips = amt; rooms.save(r); this.renderRoom() }
  }

  /** Real-money buy-in/rebuy consent gate (host's "real money" flag). Resolves
   *  true if acknowledged. The platform moves no money — this is the bookkeeping
   *  consent the product model requires before chips are added. */
  private ackRealMoney(amount: number): Promise<boolean> {
    return new Promise(resolve => {
      const host = document.createElement('div')
      host.dataset.type = 'pk-ack'
      host.innerHTML = `<div data-type="pk-ack-card">
        <strong>Real-money table</strong>
        <p>Buying in for ${fmtChips(amount)} chips. By continuing you acknowledge settling ${fmtChips(amount)} with the host offline. This app moves no money.</p>
        <div data-type="pk-ack-btns">
          <button data-ack="no" type="button">Cancel</button>
          <button data-ack="yes" type="button" data-variant="primary">I acknowledge</button>
        </div>
      </div>`
      const done = (v: boolean) => { host.remove(); resolve(v) }
      host.addEventListener('click', e => {
        const t = e.target as HTMLElement
        if (t === host) return done(false)
        const a = t.closest('[data-ack]') as HTMLElement | null
        if (a) done(a.dataset.ack === 'yes')
      })
      this.appendChild(host)
    })
  }

  /* ───────────────────────────  TABLE  ────────────────────────────── */

  /** Start a hand. Only the host deals; it seals a `deal` entry (seed + seat
   *  snapshot + button) into the log and every peer replays the identical shuffle. */
  private deal() {
    const r = this.room!
    if (!this.isHost) return
    const playable = r.seats.filter(s => (s.kind === 'human' || s.kind === 'bot') && s.chips > 0)
    if (playable.length < 2) { const n = this.q('#pk-room-note'); if (n) n.textContent = 'Need at least 2 seated players with chips.'; return }
    r.handNumber = (r.handNumber || 0) + 1
    this.buttonSeat = this.nextButton(playable.map(s => s.index), r.buttonSeat)
    r.buttonSeat = this.buttonSeat
    if (!this.online) this.heroSeat = (r.seats.find(s => s.kind === 'human' && s.chips > 0)?.index) ?? playable[0].index
    rooms.save(r)
    this.screen = 'table'
    this.cardsRevealedSeat = null
    this.enterTable()
    this.ensureTransport()
    this.transport!.append({
      kind: 'deal',
      seed: makeSeed(),
      button: this.buttonSeat,
      handNumber: r.handNumber,
      seats: r.seats.map(s => ({ index: s.index, kind: s.kind, name: s.name, chips: s.chips, personality: s.personality })),
      config: { name: r.name, variantId: r.config.variantId, smallBlind: r.config.smallBlind, bigBlind: r.config.bigBlind, ante: r.config.ante },
    })
  }

  /** Bring up the transport once per table sitting. Local play uses a synchronous
   *  loopback; online play sets `this.transport` to a PocketBase session before
   *  dealing (see goOnline/joinOnline), so this only fills in the local case. */
  private ensureTransport() {
    if (this.transport) return
    let seq = 0
    this.transport = { append: b => this.applyEntry({ ...b, seq: seq++ } as LogEntry), destroy: () => {} }
  }

  /* ─────────────────────────  ONLINE  ─────────────────────────────── */

  /** Stable per-sitting client id (used for presence). */
  private peerId(): string {
    if (!this.peer) this.peer = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `p${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    return this.peer
  }

  /** Host this room online: open a PocketBase session, then deal. The host seals
   *  every `deal` + bot action into the log; joiners arrive via the invite link and
   *  drive only their own seat. `deal()`'s `ensureTransport()` is a no-op here since
   *  we set `this.transport` first. Fresh room per session (a reused invite code
   *  still holds its old log rows). */
  private goOnline() {
    const r = this.room
    if (!r?.code || this.online) return
    this.mySeat = r.seats.find(s => s.kind === 'human')?.index ?? 0
    this.online = true
    this.isHost = true
    this.pb = createPbSession({
      room: r.code, peer: this.peerId(), name: hostName(), seat: this.mySeat,
      onEntry: e => this.applyEntry(e),
    })
    this.transport = this.pb
    this.deal()
  }

  /** Join a table by invite code from a `?join=CODE` link — a non-host session that
   *  holds no local Room. The table (and our seat) is synthesized from the first
   *  `deal` on the wire (see joinFirstDeal); until then we show a waiting screen. */
  private joinOnline(code: string) {
    if (!code) { this.restoreSession(); this.route(); return }
    this.online = true
    this.isHost = false
    this.mySeat = null
    this.room = null
    this.roomId = null
    this.pb = createPbSession({
      room: code, peer: this.peerId(), name: hostName(), seat: null,
      onEntry: e => this.applyEntry(e),
    })
    this.transport = this.pb
    try { history.replaceState({}, '', location.pathname) } catch { /* ignore */ }
    this.renderJoining(code)
  }

  /** A joiner's first `deal`: build a throwaway Room from the wire, claim an open
   *  human seat, and enter the table shell. Heads-up is exact; simultaneous multi-
   *  joins can race for one seat — claim/ack is the upgrade (poker-build-log D7). */
  private joinFirstDeal(e: Extract<LogEntry, { kind: 'deal' }>) {
    const c = e.config
    const humans = e.seats.filter(s => s.kind === 'human').map(s => s.index).sort((a, b) => a - b)
    // ponytail: host = lowest human seat by convention; a lone joiner takes the next.
    const hostSeat = humans[0] ?? 0
    this.mySeat = humans.find(i => i !== hostSeat) ?? hostSeat
    this.room = {
      id: `online:${c.name}`, name: c.name,
      createdAt: Date.now(), updatedAt: Date.now(),
      config: {
        variantId: c.variantId, seatCount: e.seats.length, startingStack: 0,
        smallBlind: c.smallBlind, bigBlind: c.bigBlind, ante: c.ante,
        botCount: e.seats.filter(s => s.kind === 'bot').length, botPersonality: 'mixed',
      },
      seats: e.seats.map(s => ({ index: s.index, kind: s.kind, name: s.name, chips: s.chips, personality: s.personality })),
      handNumber: e.handNumber, buttonSeat: e.button, public: false,
    }
    this.screen = 'table'
    this.enterTable()
    this.pb?.setSeat(this.mySeat)   // advertise the claimed seat in presence
  }

  /** Waiting screen a joiner sees until the host deals the next hand. */
  private renderJoining(code: string) {
    this.screen = 'joining'
    this.innerHTML = `
      <div data-type="pk-game" data-screen="joining">
        <header data-type="pk-home-top"><span data-type="pk-wordmark">${wordmarkSvg()}</span></header>
        <section data-type="pk-panel">
          <h2>Joining a table</h2>
          <div data-type="pk-invite"><code data-type="pk-code">${esc(code)}</code></div>
          <p data-type="pk-note">Connected — waiting for the host to deal the next hand…</p>
          <div data-type="pk-actions"><button id="pk-join-cancel" type="button" data-variant="ghost">Cancel</button></div>
        </section>
      </div>`
    this.q('#pk-join-cancel')?.addEventListener('click', () => this.leaveTable())
  }

  /** Apply one sealed log entry to the engine — the single place hands advance,
   *  identical on every peer. `deal` (re)creates the seeded state; `action` steps it. */
  private applyEntry(e: LogEntry) {
    // An online joiner holds no local Room until the first `deal` seals the table —
    // synthesize it from the wire (config + seats), claim a seat, enter the shell,
    // then fall through and replay this very deal like any peer.
    if (e.kind === 'deal' && this.online && !this.isHost && !this.room) this.joinFirstDeal(e)
    if (this.screen !== 'table' || !this.room) return
    if (e.kind === 'deal') {
      // Config comes from the entry (not this.room) so an online joiner — who holds
      // no local Room — replays the identical hand from the wire alone.
      const c = e.config
      this.buttonSeat = e.button
      if (this.online && this.mySeat != null) this.heroSeat = this.mySeat
      this.state = startHand({
        seats: e.seats,
        variant: VARIANTS[c.variantId],
        smallBlind: c.smallBlind, bigBlind: c.bigBlind, ante: c.ante,
        buttonSeat: e.button, handNumber: e.handNumber,
        rng: seededRng(hashSeed(e.seed)),
      })
      this.cardsRevealedSeat = null
      this.advance()
    } else if (e.kind === 'action' && this.state) {
      applyAction(this.state, e.action)
      this.advance()
    }
  }

  /** After each applied entry: render, then decide who acts. The host drives bots;
   *  whoever controls the seat-to-act shows controls (everyone else just watches). */
  private advance() {
    const s = this.state
    if (!s) return
    this.renderTable()
    if (s.complete) { this.handOver(); return }
    const kind = currentActorKind(s)
    if (kind === 'bot') {
      this.hideControls()
      if (!this.isHost) return
      const inp = botInputFor(s)
      const d = inp ? decide(inp) : { action: 'check' as const }
      const wait = this.reduced ? 350 : clamp(d.think ?? 700, 550, 1400)
      const seat = s.toActSeat
      this.botTimer = window.setTimeout(() => {
        if (!this.state || this.screen !== 'table') return
        this.transport!.append({ kind: 'action', seat, action: { type: d.action, amount: d.amountTo } })
      }, wait)
    } else if (kind === 'human') {
      if (this.controlsSeat(s.toActSeat)) {
        this.heroSeat = s.toActSeat
        this.cardsRevealedSeat = this.needsHotseatReveal() ? null : s.toActSeat
        this.showControls(s)
      } else {
        this.hideControls()
      }
    } else {
      this.handOver()
    }
  }

  /** Do I act for this seat? Local hotseat controls every human; online, only mine. */
  private controlsSeat(seat: number): boolean {
    return this.online ? seat === this.mySeat : true
  }

  private nextButton(seats: number[], cur?: number): number {
    if (!seats.length) return 0
    const sorted = [...seats].sort((a, b) => a - b)
    if (cur === undefined || !sorted.includes(cur)) return sorted[0]
    const after = sorted.find(s => s > cur)
    return after ?? sorted[0]
  }

  private enterTable() {
    this.screen = 'table'
    this.saveSession()
    this.innerHTML = `
      <div data-type="pk-game" data-screen="table">
        <div data-type="pk-table-bar">
          <button id="pk-leave" type="button" data-variant="ghost"><span data-type="pk-ico">${iconSvg('back')}</span>Leave</button>
          <span data-type="pk-table-title" id="pk-title"></span>
          <span data-type="pk-note" id="pk-street"></span>
        </div>
        <div data-type="pk-players" id="pk-players"></div>
        <div data-type="pk-board-zone">
          <div data-type="pk-board" id="pk-board"></div>
          <span data-type="pk-pot" id="pk-pot"></span>
        </div>
        <div data-type="pk-message" id="pk-msg" aria-live="polite"></div>
        <div data-type="pk-controls" id="pk-controls"></div>
        <div data-type="pk-foot">
          <div data-type="pk-hole" id="pk-hole"></div>
          <div data-type="pk-eq" id="pk-eq" hidden></div>
        </div>
        <div data-type="pk-handover" id="pk-handover" hidden></div>
        <details data-type="pk-log-wrap"><summary>Audit bot — table books</summary><div data-type="pk-books" id="pk-books"></div><ol data-type="pk-log" id="pk-log"></ol></details>
      </div>`
    this.q('#pk-leave')?.addEventListener('click', () => this.leaveTable())
    this.renderTable()
  }

  private leaveTable() {
    this.commitChips()
    clearTimeout(this.botTimer)
    this.clearTurnTimer()
    this.removeKeyHandler()
    this.transport?.destroy()
    this.transport = null
    this.pb = null
    const wasJoiner = this.online && !this.isHost
    this.online = false
    this.isHost = true
    this.mySeat = null
    // A joiner never had a local room to return to → go home; a host returns to its room.
    if (wasJoiner || !this.roomId) { this.room = null; this.roomId = null; this.screen = 'home' }
    else this.screen = 'room'
    this.route()
  }

  private commitChips() {
    const s = this.state, r = this.room
    if (!s || !r) return
    // A joiner's room is a synthetic wire replica — never persist it into their local list.
    if (this.online && !this.isHost) return
    for (const seat of r.seats) if (s.stacks[seat.index] !== undefined) seat.chips = s.stacks[seat.index]
    rooms.save(r)
  }

  /* ── table view mapping ── */

  private tableSeats(): { index: number; kind: SeatKind; name: string; chips: number }[] {
    const r = this.room!
    return r.seats.filter(s => s.kind === 'human' || s.kind === 'bot')
  }

  private needsHotseatReveal(): boolean {
    // Online, each device is its own player — show only the hero's cards, never the
    // pass-the-device reveal (which would leak both hands onto one screen).
    if (this.online) return false
    return this.tableSeats().filter(s => s.kind === 'human' && s.chips > 0).length > 1
  }

  private buildView(): TableView {
    const s = this.state!
    const r = this.room!
    const seats = this.tableSeats()
    const heroPos = Math.max(0, seats.findIndex(x => x.index === this.heroSeat))
    const showdown = s.complete && s.street === 'showdown'
    const ordered: SeatView[] = []
    const holeCount = VARIANTS[r.config.variantId].holeCards
    const hotseat = this.needsHotseatReveal()
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[(heroPos + i) % seats.length]
      const p = s.players.find(pp => pp.seatIndex === seat.index)
      const isHero = seat.index === this.heroSeat
      const reveal = p && !p.folded && (
        showdown ||
        (isHero && (
          hotseat
            ? currentActorKind(s) === 'human' && s.toActSeat === seat.index && this.cardsRevealedSeat === seat.index
            : true
        ))
      )
      const hole: (Card | null)[] = p
        ? p.hole.map(c => (reveal ? c : null))
        : new Array(holeCount).fill(null)
      const chips = s.stacks[seat.index] ?? seat.chips
      ordered.push({
        index: seat.index, name: seat.name, chips,
        hole, folded: !!p?.folded, allIn: !!p?.allIn,
        isButton: seat.index === s.buttonSeat, isTurn: seat.index === s.toActSeat, isHero,
        isBot: seat.kind === 'bot',
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

  private heroView(view: TableView): SeatView | null {
    return view.seats.find(seat => seat.isHero) ?? null
  }

  private heroCardsShown(hero: SeatView | null): hero is SeatView {
    return !!hero && hero.hole.length > 0 && hero.hole.every((card): card is Card => card !== null)
  }

  private heroRank(hero: SeatView | null): string | null {
    if (!this.state || !this.room || !this.heroCardsShown(hero) || hero.folded) return null
    const player = this.state.players.find(p => p.seatIndex === hero.index)
    if (!player) return null
    if (this.room.config.variantId === 'omaha') {
      return this.state.board.length === 5 ? evaluateOmaha(player.hole, this.state.board).name : null
    }
    return player.hole.length + this.state.board.length >= 5
      ? evaluateBest(player.hole.concat(this.state.board)).name
      : null
  }

  /** The odds pet's live win% for the hero — a real Monte Carlo estimate over ONLY
   *  the board + the hero's own hole cards (never opponents'). Null when it can't/
   *  shouldn't show (folded, cards hidden, hand over, no live opponents). Memoised
   *  per hand state so repaints reuse one number instead of re-rolling it. */
  private heroEquityPct(hero: SeatView | null): number | null {
    const s = this.state, r = this.room
    if (!s || !r || s.complete || !hero || hero.folded || !this.heroCardsShown(hero)) return null
    const player = s.players.find(p => p.seatIndex === hero.index)
    if (!player) return null
    const opponents = s.players.filter(p => !p.folded && p.seatIndex !== hero.index).length
    if (opponents === 0) return null
    const key = `${s.handNumber}|${s.board.map(c => `${c.r}${c.s}`).join('')}|${player.hole.map(c => `${c.r}${c.s}`).join('')}|${opponents}`
    if (key !== this.equityKey) {
      this.equityKey = key
      this.equityPct = Math.round(estimateEquity(VARIANTS[r.config.variantId], player.hole, s.board, opponents) * 100)
    }
    return this.equityPct
  }

  /** TOP row — one column per seated player, drawn from the SVG asset catalogue. */
  private renderPlayers(view: TableView): string {
    return view.seats.map(seat => {
      const pie = seat.isTurn && !seat.folded ? `<span data-type="pk-pie">${timerPieSvg(0.6)}</span>` : ''
      const dealer = seat.isButton ? `<span data-type="pk-dbtn">${buttonSvg('D')}</span>` : ''
      const bet = seat.committed > 0 ? `<span data-type="pk-bet">${fmtChips(seat.committed)}</span>` : ''
      const bot = seat.isBot ? `<span data-type="pk-bot">BOT</span>` : ''
      return `<div data-type="pk-seat" data-turn="${seat.isTurn}" data-folded="${seat.folded}" data-hero="${seat.isHero}">
        ${pie}
        <span data-type="pk-ava">${avatarSvg(seat.index)}</span>
        <span data-type="pk-nm">${esc(seat.name)}</span>
        <span data-type="pk-st">${fmtChips(seat.chips)}</span>
        ${bot}${bet}${dealer}
      </div>`
    }).join('')
  }

  /** CENTER — five board slots; dealt cards face-up, the rest as card backs. */
  private renderBoard(view: TableView): string {
    let out = ''
    for (let i = 0; i < 5; i++) {
      const card = view.board[i]
      out += `<span data-type="pk-card">${card ? cardSvg(card) : cardBackSvg()}</span>`
    }
    return out
  }

  /** BOTTOM-LEFT — the hero's hole cards (a null entry renders a face-down back). */
  private renderHole(hero: SeatView | null): string {
    if (!hero) return ''
    return hero.hole.map(card => `<span data-type="pk-card">${card ? cardSvg(card) : cardBackSvg()}</span>`).join('')
  }

  /** BOTTOM-RIGHT — the odds pet: hero's live win% + made hand during play, the
   *  result at showdown. The win % is a real estimate (see heroEquityPct), never
   *  fabricated, and only ever computed from the hero's own cards + the board. */
  private renderEquity(view: TableView): string {
    const s = this.state
    const hero = this.heroView(view)
    if (!s || !hero) return ''
    if (s.complete) {
      const winner = s.winners.find(w => w.seatIndex === hero.index)
      if (winner) {
        const name = winner.rank?.name ?? this.heroRank(hero) ?? 'Winner'
        return `<span data-type="pk-eq-crown">${crownSvg()}</span>`
          + `<strong data-type="pk-eq-name">${esc(name)}</strong>`
          + `<span data-type="pk-eq-amt">+${fmtChips(winner.amount)}</span>`
      }
      if (hero.folded) return `<strong data-type="pk-eq-name" data-mut="true">Folded</strong>`
      return `<strong data-type="pk-eq-name" data-mut="true">${esc(this.heroRank(hero) ?? 'Hand over')}</strong>`
    }
    if (hero.folded) return `<strong data-type="pk-eq-name" data-mut="true">Folded</strong>`
    const showOdds = oddsPet()
    const pct = showOdds ? this.heroEquityPct(hero) : null
    const rank = this.heroRank(hero)
    const bits: string[] = []
    if (pct !== null) bits.push(`<span data-type="pk-eq-win">Win ${pct}%</span>`)
    if (rank) bits.push(`<span data-type="pk-eq-label">${pct !== null ? 'Best hand' : 'Your hand'}</span><strong data-type="pk-eq-name">${esc(rank)}</strong>`)
    // Odds on but nothing to show yet (cards still hidden) → stay hidden.
    if (!bits.length && showOdds) return ''
    // Odds off with no made hand → keep a muted placeholder so the toggle stays reachable.
    if (!bits.length) bits.push(`<strong data-type="pk-eq-name" data-mut="true">Odds off</strong>`)
    bits.push(`<button data-act="odds-toggle" data-type="pk-eq-toggle" type="button">${showOdds ? 'Hide odds' : 'Show odds'}</button>`)
    return bits.join('')
  }

  private renderTable() {
    const s = this.state
    if (!s) return
    const view = this.buildView()
    const title = this.q('#pk-title'); if (title) title.textContent = `${VARIANTS[this.room!.config.variantId].name} · Hand #${s.handNumber}`
    const street = this.q('#pk-street'); if (street) street.textContent = s.complete ? 'hand over' : s.street
    const players = this.q('#pk-players'); if (players) players.innerHTML = this.renderPlayers(view)
    const board = this.q('#pk-board'); if (board) board.innerHTML = this.renderBoard(view)
    const pot = this.q('#pk-pot'); if (pot) pot.textContent = fmtChips(view.pot)
    const hole = this.q('#pk-hole'); if (hole) hole.innerHTML = this.renderHole(this.heroView(view))
    const eq = this.q('#pk-eq')
    if (eq) {
      const content = this.renderEquity(view); eq.innerHTML = content; (eq as HTMLElement).hidden = !content
      this.q('[data-act="odds-toggle"]')?.addEventListener('click', () => { setOddsPet(!oddsPet()); this.renderTable() })
    }
    const msg = this.q('#pk-msg')
    if (msg) {
      if (s.complete) msg.textContent = this.winnerLine(s)
      else {
        const actor = s.seatMeta[s.toActSeat]?.name
        const kind = currentActorKind(s)
        msg.textContent = kind !== 'human'
          ? (actor ? `${actor} is thinking…` : '')
          // Online, a human turn that isn't my seat is a remote player — I'm waiting, not acting.
          : (this.online && s.toActSeat !== this.mySeat) ? (actor ? `Waiting for ${actor}…` : '')
          : (!this.needsHotseatReveal() || this.cardsRevealedSeat === s.toActSeat) ? `${actor}, your move`
          : `Pass to ${actor}, then reveal cards`
      }
    }
    const books = this.q('#pk-books')
    if (books) {
      books.innerHTML = [...view.seats].sort((a, b) => b.chips - a.chips)
        .map(seat => `<div data-type="pk-book-row"><span>${esc(seat.name)}${seat.isBot ? ' · bot' : ''}</span><span>${fmtChips(seat.chips)}</span></div>`).join('')
    }
    const log = this.q('#pk-log')
    if (log) log.innerHTML = s.log.slice(-40).map(l => `<li data-kind="${l.kind}">${esc(l.text)}</li>`).join('')
  }

  /* ── human controls ── */

  private hideControls() { this.clearTurnTimer(); this.removeKeyHandler(); const c = this.q('#pk-controls'); if (c) c.innerHTML = '' }

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
    if (this.needsHotseatReveal() && this.cardsRevealedSeat !== s.toActSeat) {
      c.innerHTML = `
        <div data-type="pk-pass">
          <strong>${esc(s.seatMeta[s.toActSeat]?.name ?? 'Player')}'s turn</strong>
          <button id="pk-reveal" type="button" data-variant="primary">Reveal cards</button>
        </div>`
      this.q('#pk-reveal')?.addEventListener('click', () => {
        this.cardsRevealedSeat = s.toActSeat
        this.showControls(s)
        this.renderTable()
      })
      return
    }
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

    c.dataset.raise = 'off'
    c.innerHTML = `
      <div data-type="pk-clock"><span data-type="pk-timer" id="pk-timer">2:00</span></div>
      <div data-type="pk-btns">
        <button data-act="fold" type="button" data-variant="danger">Fold</button>
        ${req.canCheck
          ? `<button data-act="check" type="button">Check</button>`
          : `<button data-act="call" type="button" data-variant="primary">Call ${fmtChips(req.toCall)}</button>`}
        ${canAggress ? `<button data-act="raise-open" type="button" data-variant="primary">${req.canBet ? 'Bet' : 'Raise'}<span data-type="pk-ico">${iconSvg('raise')}</span></button>` : ''}
      </div>
      ${canAggress ? `
      <div data-type="pk-raise">
        <div data-type="pk-raise-row">
          <span data-type="pk-amt"><span data-type="pk-ico">${iconSvg('raise')}</span><strong id="pk-amt">${fmtChips(start)}</strong></span>
          <input id="pk-slider" type="range" min="${lo}" max="${hi}" step="1" value="${start}" aria-label="Bet amount" ${lo >= hi ? 'disabled' : ''} />
          <button data-act="raise" type="button" data-type="pk-rcircle" aria-label="Confirm ${req.canBet ? 'bet' : 'raise'}">${iconSvg('raise')}</button>
        </div>
        <div data-type="pk-presets">
          ${presets.map(([label, to]) => `<button data-to="${to}" type="button">${esc(label)}</button>`).join('')}
          <button data-act="raise-cancel" type="button" data-type="pk-cancel" aria-label="Cancel raise">${iconSvg('cancel')}</button>
        </div>
      </div>` : ''}
      <p data-type="pk-hint">${this.reduced ? '' : 'F = fold · Space = check/call'}</p>`

    const slider = this.q<HTMLInputElement>('#pk-slider')
    const amt = this.q('#pk-amt')
    const setAmt = (v: number) => { const vv = clamp(Math.round(v), lo, hi); if (slider) slider.value = String(vv); if (amt) amt.textContent = fmtChips(vv) }
    const setRaiseMode = (on: boolean) => { c.dataset.raise = on ? 'on' : 'off' }
    slider?.addEventListener('input', () => setAmt(Number(slider.value)))
    this.qa('[data-to]').forEach(b => b.addEventListener('click', () => setAmt(Number((b as HTMLElement).dataset.to))))
    this.q('[data-act="raise-open"]')?.addEventListener('click', () => setRaiseMode(true))
    this.q('[data-act="raise-cancel"]')?.addEventListener('click', () => setRaiseMode(false))
    this.q('[data-act="fold"]')?.addEventListener('click', () => this.human({ type: 'fold' }))
    this.q('[data-act="check"]')?.addEventListener('click', () => this.human({ type: 'check' }))
    this.q('[data-act="call"]')?.addEventListener('click', () => this.human({ type: 'call' }))
    this.q('[data-act="raise"]')?.addEventListener('click', () => this.human({ type: req.canBet ? 'bet' : 'raise', amount: Number(slider?.value ?? start) }))
    this.startTurnTimer(req.canCheck)

    this.removeKeyHandler()
    this.onKey = (e: KeyboardEvent) => {
      if (this.screen !== 'table' || !this.state || currentActorKind(this.state) !== 'human') return
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); this.human({ type: 'fold' }) }
      else if (e.key === ' ') { e.preventDefault(); this.human(req.canCheck ? { type: 'check' } : { type: 'call' }) }
    }
    window.addEventListener('keydown', this.onKey)
  }

  private onKey: ((e: KeyboardEvent) => void) | null = null

  private removeKeyHandler() {
    if (!this.onKey) return
    window.removeEventListener('keydown', this.onKey)
    this.onKey = null
  }

  private human(a: { type: 'fold' | 'check' | 'call' | 'bet' | 'raise'; amount?: number }) {
    if (!this.state) return
    this.removeKeyHandler()
    this.hideControls()
    // Route the move through the transport (loopback locally, host-sealed online)
    // so every peer applies it in one agreed order via applyEntry.
    this.transport!.append({ kind: 'action', seat: this.state.toActSeat, action: a })
  }

  private handOver() {
    this.removeKeyHandler()
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
        ${withChips >= 2 ? (this.isHost ? `<button id="pk-next" type="button" data-variant="primary">Next hand</button>` : `<span data-type="pk-note">Waiting for the host to deal…</span>`) : `<span data-type="pk-note">Not enough players with chips.</span>`}
        ${heroBusted ? `<button id="pk-rebuy" type="button">Rebuy ${fmtChips(this.rebuyAmount())}</button>` : ''}
        <button id="pk-leave2" type="button" data-variant="ghost">Leave table</button>
      </div>`
    this.q('#pk-next')?.addEventListener('click', () => { (ho as HTMLElement).hidden = true; this.deal() })
    this.q('#pk-rebuy')?.addEventListener('click', async () => {
      const amt = this.rebuyAmount()
      if (r.config.realMoney && !(await this.ackRealMoney(amt))) return
      const seat = r.seats.find(x => x.index === this.heroSeat)
      if (seat) { seat.chips = amt; rooms.save(r) }
      this.handOver()
    })
    this.q('#pk-leave2')?.addEventListener('click', () => this.leaveTable())
  }

  /* ── tiny DOM helpers ── */
  private q<T extends Element = HTMLElement>(sel: string): T | null { return this.querySelector<T>(sel) }
  private qa(sel: string): Element[] { return Array.from(this.querySelectorAll(sel)) }
}

if (!customElements.get('poker-game')) {
  customElements.define('poker-game', PokerGame)
}
