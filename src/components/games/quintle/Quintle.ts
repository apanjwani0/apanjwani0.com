/**
 * Quintle — a five-letter word guessing game (a Wordle-style daily puzzle).
 *
 * Guess the hidden five-letter word in six tries. After each guess every tile
 * is coloured:
 *   • correct — right letter, right place        (site success token)
 *   • present — the letter is in the word, wrong place (site accent token)
 *   • absent  — the letter is not in the word
 * (The site's violet accent stands in for the familiar yellow so the board stays
 * on-brand; the how-to-play legend spells this out, and the shareable emoji grid
 * still uses the universal 🟩/🟨/⬛ so results read anywhere.)
 *
 * Two ways to play, both fully client-side and dependency-free:
 *   • Daily    — one deterministic puzzle a day, the same for everyone; it resumes
 *                across refreshes and drives a day-to-day win streak.
 *   • Practice — an endless supply of random words with a "New word" button.
 *
 * Extras: an optional hard mode (revealed hints must be reused), a full on-screen
 * keyboard plus physical typing, staggered tile-flip reveals (skipped under
 * prefers-reduced-motion), win/lose stats with a guess-distribution chart, and a
 * one-click emoji share. Everything (preferences, stats, the in-progress daily and
 * practice games) persists in localStorage, so a refresh drops you back exactly
 * where you were. All module-level names are q-/Q_-prefixed to avoid any collision.
 */

import { ANSWER_STR, VALID_STR } from './words'

/* ── word data ───────────────────────────────────────────────── */

const Q_ANSWERS: string[] = ANSWER_STR.split(' ')
// Full valid-guess dictionary = the answer pool plus the broader accepted set.
const Q_VALID: Set<string> = new Set<string>(Q_ANSWERS)
for (const w of VALID_STR.split(' ')) Q_VALID.add(w)

const Q_LEN = 5
const Q_ROWS = 6
const Q_LS_KEY = 'quintle:v1'
// Fixed UTC launch date: every timezone advances to the next puzzle together.
const Q_EPOCH_DAY = Math.floor(Date.UTC(2025, 0, 1) / 86400000)

type Q_State = 'correct' | 'present' | 'absent'
type Q_Mode = 'daily' | 'practice'
type Q_Status = 'playing' | 'won' | 'lost'

/* ── pure game logic (unit-tested off-mount) ─────────────────── */

/** Which UTC day number is `d`? */
function q_dayNumber(d: Date): number {
  return Math.floor(d.getTime() / 86400000) - Q_EPOCH_DAY
}

/** The deterministic answer for a given day number. */
function q_dailyAnswer(day: number): string {
  const i = ((day % Q_ANSWERS.length) + Q_ANSWERS.length) % Q_ANSWERS.length
  return Q_ANSWERS[i]
}

function q_randomAnswer(avoid?: string): string {
  let w = Q_ANSWERS[Math.floor(Math.random() * Q_ANSWERS.length)]
  if (avoid && Q_ANSWERS.length > 1) {
    let guard = 0
    while (w === avoid && guard++ < 12) w = Q_ANSWERS[Math.floor(Math.random() * Q_ANSWERS.length)]
  }
  return w
}

function q_isValidGuess(word: string): boolean {
  return word.length === Q_LEN && Q_VALID.has(word)
}

/**
 * Score one guess against the answer with the correct two-pass rule so repeated
 * letters are handled the way players expect: exact matches are claimed first,
 * then remaining answer letters feed the "present" marks until they run out.
 */
function q_evaluate(guess: string, answer: string): Q_State[] {
  const res: Q_State[] = new Array(Q_LEN).fill('absent')
  const counts: Record<string, number> = {}
  for (const ch of answer) counts[ch] = (counts[ch] || 0) + 1
  // Pass 1 — greens.
  for (let i = 0; i < Q_LEN; i++) {
    if (guess[i] === answer[i]) {
      res[i] = 'correct'
      counts[guess[i]]--
    }
  }
  // Pass 2 — yellows from whatever letters are left over.
  for (let i = 0; i < Q_LEN; i++) {
    if (res[i] === 'correct') continue
    const ch = guess[i]
    if (counts[ch] > 0) {
      res[i] = 'present'
      counts[ch]--
    }
  }
  return res
}

/**
 * Hard-mode gate: every hint already revealed must be reused. Greens must stay in
 * place; every letter marked present/correct so far must appear again. Returns an
 * explanatory message when the guess breaks a hint, or null when it's allowed.
 */
function q_hardModeViolation(guess: string, prevGuesses: string[], answer: string): string | null {
  const greens: (string | null)[] = new Array(Q_LEN).fill(null)
  const required: Record<string, number> = {}
  for (const g of prevGuesses) {
    const ev = q_evaluate(g, answer)
    const seen: Record<string, number> = {}
    for (let i = 0; i < Q_LEN; i++) {
      if (ev[i] === 'correct') greens[i] = g[i]
      if (ev[i] === 'correct' || ev[i] === 'present') {
        seen[g[i]] = (seen[g[i]] || 0) + 1
        if (seen[g[i]] > (required[g[i]] || 0)) required[g[i]] = seen[g[i]]
      }
    }
  }
  const ord = ['1st', '2nd', '3rd', '4th', '5th']
  for (let i = 0; i < Q_LEN; i++) {
    if (greens[i] && guess[i] !== greens[i]) {
      return `${ord[i]} letter must be ${greens[i]!.toUpperCase()}`
    }
  }
  for (const ch of Object.keys(required)) {
    const have = guess.split('').filter(c => c === ch).length
    if (have < required[ch]) return `Guess must contain ${ch.toUpperCase()}`
  }
  return null
}

/** Best status for a key given all its per-guess results (correct > present > absent). */
function q_bestState(a: Q_State | undefined, b: Q_State): Q_State {
  const rank: Record<Q_State, number> = { absent: 0, present: 1, correct: 2 }
  if (a === undefined) return b
  return rank[b] > rank[a] ? b : a
}

/* ── persisted shapes ────────────────────────────────────────── */

interface Q_Game {
  answer: string
  guesses: string[]
  status: Q_Status
  day?: number // daily only
}

interface Q_Stats {
  played: number
  wins: number
  curStreak: number
  maxStreak: number
  dist: number[] // length 6: wins-in-N counts
  lastDay: number | null // last completed daily day number
}

interface Q_Prefs {
  mode: Q_Mode
  hard: boolean
}

interface Q_Saved {
  prefs: Q_Prefs
  stats: Q_Stats
  daily: Q_Game | null
  practice: Q_Game | null
}

function q_freshStats(): Q_Stats {
  return { played: 0, wins: 0, curStreak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0], lastDay: null }
}

function q_load(): Q_Saved {
  const fallback: Q_Saved = {
    prefs: { mode: 'daily', hard: false },
    stats: q_freshStats(),
    daily: null,
    practice: null,
  }
  try {
    const raw = JSON.parse(localStorage.getItem(Q_LS_KEY) || '{}')
    const s = raw.stats || {}
    const dist = Array.isArray(s.dist) && s.dist.length === 6 ? s.dist.map((n: unknown) => Math.max(0, Math.floor(Number(n) || 0))) : [0, 0, 0, 0, 0, 0]
    return {
      prefs: {
        mode: raw.prefs?.mode === 'practice' ? 'practice' : 'daily',
        hard: !!raw.prefs?.hard,
      },
      stats: {
        played: Math.max(0, Math.floor(Number(s.played) || 0)),
        wins: Math.max(0, Math.floor(Number(s.wins) || 0)),
        curStreak: Math.max(0, Math.floor(Number(s.curStreak) || 0)),
        maxStreak: Math.max(0, Math.floor(Number(s.maxStreak) || 0)),
        dist,
        lastDay: Number.isFinite(s.lastDay) ? Math.floor(s.lastDay) : null,
      },
      daily: q_sanitizeGame(raw.daily),
      practice: q_sanitizeGame(raw.practice),
    }
  } catch {
    return fallback
  }
}

function q_sanitizeGame(g: unknown): Q_Game | null {
  if (!g || typeof g !== 'object') return null
  const o = g as Record<string, unknown>
  if (typeof o.answer !== 'string' || !Q_ANSWERS.includes(o.answer)) return null
  const guesses = Array.isArray(o.guesses)
    ? o.guesses.filter((x): x is string => typeof x === 'string' && q_isValidGuess(x)).slice(0, Q_ROWS)
    : []
  const status: Q_Status = guesses.includes(o.answer) ? 'won' : guesses.length === Q_ROWS ? 'lost' : 'playing'
  const game: Q_Game = { answer: o.answer, guesses, status }
  if (Number.isFinite(o.day)) game.day = Math.floor(o.day as number)
  return game
}

/* ── the game element ────────────────────────────────────────── */

class QuintleGame extends HTMLElement {
  private prefs: Q_Prefs = { mode: 'daily', hard: false }
  private stats: Q_Stats = q_freshStats()
  private daily: Q_Game | null = null
  private practice: Q_Game | null = null

  private cur = '' // the row being typed
  private animating = false
  private reduced = false
  private showStats = false
  private timers = new Set<number>()

  private onKey = (e: KeyboardEvent) => this.handleKey(e)

  connectedCallback() {
    const saved = q_load()
    this.prefs = saved.prefs
    this.stats = saved.stats
    this.daily = saved.daily
    this.practice = saved.practice
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Roll the daily puzzle over if the saved one is from an earlier day.
    const today = q_dayNumber(new Date())
    if (!this.daily || this.daily.day !== today) {
      this.daily = { answer: q_dailyAnswer(today), guesses: [], status: 'playing', day: today }
    }
    if (!this.practice) {
      this.practice = { answer: q_randomAnswer(), guesses: [], status: 'playing' }
    }

    this.renderShell()
    this.renderAll()
    document.addEventListener('keydown', this.onKey)
    this.save()
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this.onKey)
    this.timers.forEach(timer => window.clearTimeout(timer))
    this.timers.clear()
    this.animating = false
  }

  private later(fn: () => void, delay: number) {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer)
      fn()
    }, delay)
    this.timers.add(timer)
  }

  /* ── current game accessors ── */
  private get game(): Q_Game {
    return this.prefs.mode === 'daily' ? (this.daily as Q_Game) : (this.practice as Q_Game)
  }

  /* ── persistence ── */
  private save() {
    const data: Q_Saved = { prefs: this.prefs, stats: this.stats, daily: this.daily, practice: this.practice }
    try {
      localStorage.setItem(Q_LS_KEY, JSON.stringify(data))
    } catch {
      /* storage disabled — game still plays for the session */
    }
  }

  /* ── one-time DOM shell (wipes the SSR fallback children) ── */
  private renderShell() {
    this.innerHTML = ''
    const root = q_el('div', { 'data-type': 'q-game' })

    const header = q_el('div', { 'data-type': 'q-header' })
    const titlebar = q_el('div', { 'data-type': 'q-titlebar' })
    const h1 = q_el('h1')
    h1.textContent = 'Quintle'
    const badge = q_el('span', { 'data-type': 'q-badge' })
    titlebar.append(h1, badge)
    const sub = q_el('p')
    sub.textContent = 'Guess the hidden five-letter word in six tries — a fresh puzzle every day, or play unlimited practice rounds.'
    header.append(titlebar, sub)

    // controls
    const controls = q_el('div', { 'data-type': 'q-controls' })

    const modeGroup = q_el('div', { 'data-group': 'mode' })
    modeGroup.append(q_label('Mode'), this.buildSeg('mode', [['daily', 'Daily'], ['practice', 'Practice']]))

    const hardGroup = q_el('div', { 'data-group': 'hard' })
    hardGroup.append(q_label('Hard'), this.buildSeg('hard', [['off', 'Off'], ['on', 'On']]))

    const actions = q_el('div', { 'data-group': 'actions' })
    const statsBtn = q_el('button', { type: 'button', 'data-act': 'stats', 'aria-controls': 'q-stats', 'aria-expanded': 'false' })
    statsBtn.textContent = 'Stats'
    statsBtn.addEventListener('click', () => this.toggleStats())
    const newBtn = q_el('button', { type: 'button', 'data-act': 'new' })
    newBtn.textContent = 'New word'
    newBtn.addEventListener('click', () => this.newPractice())
    actions.append(statsBtn, newBtn)

    controls.append(modeGroup, hardGroup, actions)

    // board
    const board = q_el('div', { 'data-type': 'q-board', role: 'group', 'aria-label': 'Guess grid' })
    for (let r = 0; r < Q_ROWS; r++) {
      const row = q_el('div', { 'data-type': 'q-row' })
      for (let c = 0; c < Q_LEN; c++) row.appendChild(q_el('div', { 'data-type': 'q-tile' }))
      board.appendChild(row)
    }

    const message = q_el('p', { 'data-type': 'q-message', role: 'status', 'aria-live': 'polite' })
    const result = q_el('div', { 'data-type': 'q-result', hidden: '' })
    const keyboard = this.buildKeyboard()
    const stats = q_el('div', { id: 'q-stats', 'data-type': 'q-stats', hidden: '' })
    const explainer = this.buildExplainer()

    root.append(header, controls, board, message, result, keyboard, stats, explainer)
    this.appendChild(root)
  }

  private buildSeg(name: 'mode' | 'hard', opts: [string, string][]): HTMLElement {
    const seg = q_el('div', { 'data-type': 'q-seg', 'data-seg': name, role: 'group' })
    for (const [val, label] of opts) {
      const b = q_el('button', { type: 'button', 'data-val': val, 'aria-pressed': 'false' })
      b.textContent = label
      b.addEventListener('click', () => {
        if (name === 'mode') this.setMode(val as Q_Mode)
        else this.setHard(val === 'on')
      })
      seg.appendChild(b)
    }
    return seg
  }

  private buildKeyboard(): HTMLElement {
    const kb = q_el('div', { 'data-type': 'q-keyboard', role: 'group', 'aria-label': 'Keyboard' })
    const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
    rows.forEach((letters, idx) => {
      const row = q_el('div', { 'data-type': 'q-krow' })
      if (idx === 2) row.appendChild(this.buildKey('enter', 'Enter', true))
      for (const ch of letters) row.appendChild(this.buildKey(ch, ch, false))
      if (idx === 2) row.appendChild(this.buildKey('back', '⌫', true))
      kb.appendChild(row)
    })
    return kb
  }

  private buildKey(key: string, label: string, wide: boolean): HTMLElement {
    const attrs: Record<string, string> = { type: 'button', 'data-key': key, 'aria-label': key === 'back' ? 'Backspace' : key === 'enter' ? 'Enter' : key }
    if (wide) attrs['data-wide'] = ''
    const b = q_el('button', attrs)
    b.textContent = label
    b.addEventListener('click', () => {
      if (key === 'enter') this.submit()
      else if (key === 'back') this.backspace()
      else this.typeLetter(key)
    })
    return b
  }

  private buildExplainer(): HTMLElement {
    const d = q_el('details', { 'data-type': 'q-explainer' })
    const sum = q_el('summary')
    sum.textContent = 'How to play'
    d.appendChild(sum)

    const p1 = q_el('p')
    p1.innerHTML = 'Type a five-letter word and press <kbd>Enter</kbd>. Each of the six rows is a guess; after each one the tiles change colour to tell you how close you were:'
    d.appendChild(p1)

    const legend = q_el('div', { 'data-type': 'q-legend' })
    const items: [Q_State, string][] = [
      ['correct', 'right letter, right spot'],
      ['present', 'in the word, wrong spot'],
      ['absent', 'not in the word'],
    ]
    for (const [state, text] of items) {
      const item = q_el('div', { 'data-type': 'q-legend-item' })
      item.append(q_el('span', { 'data-type': 'q-swatch', 'data-state': state }), document.createTextNode(text))
      legend.appendChild(item)
    }
    d.appendChild(legend)

    const p2 = q_el('p')
    p2.innerHTML =
      '<strong>Daily</strong> is one puzzle a day — the same word for everyone, and it resumes if you close the tab. <strong>Practice</strong> serves endless random words; hit <strong>New word</strong> for another. Turn on <strong>Hard</strong> mode to force every hint you uncover to be reused in later guesses. Keyboard shortcuts: <kbd>Enter</kbd> submits, <kbd>Backspace</kbd> deletes. Your stats and both games are saved in your browser — nothing is uploaded.'
    d.appendChild(p2)
    return d
  }

  /* ── controls behaviour ── */
  private setMode(mode: Q_Mode) {
    if (this.animating || mode === this.prefs.mode) return
    this.prefs.mode = mode
    this.cur = ''
    this.showStats = false
    this.renderAll()
    this.save()
  }

  private setHard(on: boolean) {
    if (this.animating) return
    // Hard mode can't be switched on mid-game once you've committed a guess.
    if (on && this.game.status === 'playing' && this.game.guesses.length > 0) {
      this.flash('Hard mode must be set before your first guess', 'error')
      this.syncControls()
      return
    }
    this.prefs.hard = on
    this.syncControls()
    this.save()
  }

  private newPractice() {
    if (this.animating) return
    if (this.prefs.mode !== 'practice') {
      // Jump into practice mode and start fresh.
      this.prefs.mode = 'practice'
    }
    this.practice = { answer: q_randomAnswer(this.practice?.answer), guesses: [], status: 'playing' }
    this.cur = ''
    this.showStats = false
    this.renderAll()
    this.save()
  }

  private toggleStats() {
    this.showStats = !this.showStats
    this.renderStats()
  }

  /* ── input ── */
  private handleKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest('button, input, textarea, select, summary, a')) return
    if (e.key === 'Enter') {
      e.preventDefault()
      this.submit()
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      this.backspace()
    } else if (/^[a-zA-Z]$/.test(e.key)) {
      this.typeLetter(e.key.toLowerCase())
    }
  }

  private typeLetter(ch: string) {
    if (this.animating || this.game.status !== 'playing') return
    if (this.cur.length >= Q_LEN) return
    this.cur += ch
    this.paintCurrentRow(true)
  }

  private backspace() {
    if (this.animating || this.game.status !== 'playing') return
    if (this.cur.length === 0) return
    this.cur = this.cur.slice(0, -1)
    this.paintCurrentRow(false)
  }

  private submit() {
    if (this.animating || this.game.status !== 'playing') return
    if (this.cur.length < Q_LEN) {
      this.shakeCurrentRow()
      this.flash('Not enough letters', 'error')
      return
    }
    const guess = this.cur
    if (!q_isValidGuess(guess)) {
      this.shakeCurrentRow()
      this.flash('Not in word list', 'error')
      return
    }
    if (this.prefs.hard) {
      const violation = q_hardModeViolation(guess, this.game.guesses, this.game.answer)
      if (violation) {
        this.shakeCurrentRow()
        this.flash(violation, 'error')
        return
      }
    }

    const g = this.game
    g.guesses.push(guess)
    this.cur = ''
    const evals = q_evaluate(guess, g.answer)
    const rowIdx = g.guesses.length - 1
    const won = guess === g.answer
    const finished = won || g.guesses.length >= Q_ROWS

    this.revealRow(rowIdx, guess, evals, () => {
      this.applyKeyboard()
      if (won) {
        g.status = 'won'
        this.finishGame(true)
      } else if (finished) {
        g.status = 'lost'
        this.finishGame(false)
      }
      this.save()
    })
  }

  /* ── outcome + stats ── */
  private finishGame(won: boolean) {
    const isDaily = this.prefs.mode === 'daily'
    const tries = this.game.guesses.length

    // Update lifetime stats. Streak only advances on the daily puzzle.
    this.stats.played++
    if (won) {
      this.stats.wins++
      this.stats.dist[tries - 1]++
    }
    if (isDaily) {
      const day = this.daily!.day!
      if (won) {
        const continued = this.stats.lastDay === day - 1
        this.stats.curStreak = continued ? this.stats.curStreak + 1 : 1
        if (this.stats.curStreak > this.stats.maxStreak) this.stats.maxStreak = this.stats.curStreak
      } else {
        this.stats.curStreak = 0
      }
      this.stats.lastDay = day
    }

    this.renderResult()
    if (won) this.flash(q_winPhrase(tries), 'win')
    else this.flash(`The word was ${this.game.answer.toUpperCase()}`, 'lose')
    // Surface the stats panel automatically the first time a game ends.
    this.showStats = true
    this.renderStats()
  }

  /* ── rendering ── */
  private renderAll() {
    this.syncControls()
    this.renderBadge()
    this.renderBoard()
    this.applyKeyboard()
    this.renderResult()
    this.renderStats()
    this.clearMessage()
    if (this.game.status !== 'playing') {
      if (this.game.status === 'won') this.flash('Solved — see your stats below', 'win')
      else this.flash(`The word was ${this.game.answer.toUpperCase()}`, 'lose')
    }
  }

  private syncControls() {
    this.querySelectorAll<HTMLButtonElement>('[data-seg="mode"] button').forEach(b => {
      const active = b.getAttribute('data-val') === this.prefs.mode
      b.toggleAttribute('data-active', active)
      b.setAttribute('aria-pressed', String(active))
      b.disabled = this.animating
    })
    this.querySelectorAll<HTMLButtonElement>('[data-seg="hard"] button').forEach(b => {
      const active = b.getAttribute('data-val') === (this.prefs.hard ? 'on' : 'off')
      b.toggleAttribute('data-active', active)
      b.setAttribute('aria-pressed', String(active))
      b.disabled = this.animating
    })
    const newBtn = this.querySelector<HTMLButtonElement>('[data-act="new"]')
    if (newBtn) {
      newBtn.hidden = this.prefs.mode !== 'practice'
      newBtn.disabled = this.animating
    }
    const statsBtn = this.querySelector<HTMLButtonElement>('[data-act="stats"]')
    if (statsBtn) {
      statsBtn.toggleAttribute('data-active', this.showStats)
      statsBtn.setAttribute('aria-expanded', String(this.showStats))
    }
  }

  private renderBadge() {
    const badge = this.querySelector<HTMLElement>('[data-type="q-badge"]')
    if (!badge) return
    if (this.prefs.mode === 'daily') badge.textContent = `Daily #${this.daily!.day}`
    else badge.textContent = 'Practice'
  }

  private rows(): HTMLElement[] {
    return Array.from(this.querySelectorAll<HTMLElement>('[data-type="q-row"]'))
  }
  private tilesIn(row: HTMLElement): HTMLElement[] {
    return Array.from(row.querySelectorAll<HTMLElement>('[data-type="q-tile"]'))
  }

  private renderBoard() {
    const rows = this.rows()
    const g = this.game
    for (let r = 0; r < Q_ROWS; r++) {
      const tiles = this.tilesIn(rows[r])
      const guess = g.guesses[r]
      if (guess) {
        const evals = q_evaluate(guess, g.answer)
        tiles.forEach((t, c) => {
          t.textContent = guess[c].toUpperCase()
          t.setAttribute('data-state', evals[c])
          t.removeAttribute('data-anim')
        })
      } else {
        tiles.forEach(t => {
          t.textContent = ''
          t.removeAttribute('data-state')
          t.removeAttribute('data-anim')
        })
      }
    }
    // Paint whatever is being typed into the active row.
    if (g.status === 'playing') this.paintCurrentRow(false)
  }

  private activeRow(): HTMLElement | null {
    if (this.game.status !== 'playing') return null
    return this.rows()[this.game.guesses.length] || null
  }

  private paintCurrentRow(pop: boolean) {
    const row = this.activeRow()
    if (!row) return
    const tiles = this.tilesIn(row)
    tiles.forEach((t, c) => {
      const ch = this.cur[c]
      if (ch) {
        const wasEmpty = !t.textContent
        t.textContent = ch.toUpperCase()
        t.setAttribute('data-state', 'filled')
        if (pop && wasEmpty && !this.reduced && c === this.cur.length - 1) {
          t.setAttribute('data-anim', 'pop')
          this.later(() => t.removeAttribute('data-anim'), 130)
        }
      } else {
        t.textContent = ''
        t.removeAttribute('data-state')
        t.removeAttribute('data-anim')
      }
    })
  }

  private revealRow(rowIdx: number, guess: string, evals: Q_State[], done: () => void) {
    const row = this.rows()[rowIdx]
    const tiles = this.tilesIn(row)
    tiles.forEach((t, c) => (t.textContent = guess[c].toUpperCase()))

    if (this.reduced) {
      tiles.forEach((t, c) => t.setAttribute('data-state', evals[c]))
      done()
      return
    }

    this.animating = true
    this.syncControls()
    const step = 260
    tiles.forEach((t, c) => {
      this.later(() => {
        t.setAttribute('data-anim', 'flip')
      }, c * step)
      // Swap the colour at the midpoint of the flip so it "turns over".
      this.later(() => {
        t.setAttribute('data-state', evals[c])
      }, c * step + 130)
      this.later(() => {
        t.removeAttribute('data-anim')
      }, c * step + 500)
    })
    this.later(() => {
      this.animating = false
      this.syncControls()
      done()
    }, (Q_LEN - 1) * step + 500)
  }

  private applyKeyboard() {
    const g = this.game
    const best: Record<string, Q_State> = {}
    for (const guess of g.guesses) {
      const ev = q_evaluate(guess, g.answer)
      for (let i = 0; i < Q_LEN; i++) best[guess[i]] = q_bestState(best[guess[i]], ev[i])
    }
    this.querySelectorAll<HTMLButtonElement>('[data-type="q-key"]').forEach(b => {
      const k = b.getAttribute('data-key')!
      if (k === 'enter' || k === 'back') return
      if (best[k]) b.setAttribute('data-state', best[k])
      else b.removeAttribute('data-state')
    })
  }

  private renderResult() {
    const box = this.querySelector<HTMLElement>('[data-type="q-result"]')
    if (!box) return
    box.textContent = ''
    const g = this.game
    if (g.status === 'playing') {
      box.hidden = true
      return
    }
    box.hidden = false
    const p = q_el('p')
    if (g.status === 'won') {
      p.innerHTML = `Solved in <strong>${g.guesses.length}/${Q_ROWS}</strong>`
    } else {
      p.innerHTML = `Out of tries — the word was <strong>${g.answer.toUpperCase()}</strong>`
    }
    box.appendChild(p)

    const share = q_el('button', { type: 'button', 'data-type': 'q-share' })
    share.textContent = 'Share'
    share.addEventListener('click', () => this.share())
    box.appendChild(share)

    if (this.prefs.mode === 'practice') {
      const again = q_el('button', { type: 'button', 'data-type': 'q-replay' })
      again.textContent = 'New word'
      again.addEventListener('click', () => this.newPractice())
      box.appendChild(again)
    }
  }

  private renderStats() {
    const panel = this.querySelector<HTMLElement>('[data-type="q-stats"]')
    if (!panel) return
    this.syncControls()
    if (!this.showStats) {
      panel.hidden = true
      panel.textContent = ''
      return
    }
    panel.hidden = false
    panel.textContent = ''

    const h = q_el('h2')
    h.textContent = 'Statistics'
    panel.appendChild(h)

    const bar = q_el('div', { 'data-type': 'q-scorebar' })
    const winPct = this.stats.played ? Math.round((this.stats.wins / this.stats.played) * 100) : 0
    const cells: [string, string][] = [
      [String(this.stats.played), 'Played'],
      [`${winPct}%`, 'Win %'],
      [String(this.stats.curStreak), 'Streak'],
      [String(this.stats.maxStreak), 'Best'],
    ]
    for (const [value, label] of cells) {
      const cell = q_el('div', { 'data-type': 'q-stat' })
      const v = q_el('span', { 'data-type': 'q-stat-value' })
      v.textContent = value
      const l = q_el('span', { 'data-type': 'q-stat-label' })
      l.textContent = label
      cell.append(v, l)
      bar.appendChild(cell)
    }
    panel.appendChild(bar)

    const distTitle = q_el('span', { 'data-type': 'q-dist-title' })
    distTitle.textContent = 'Guess distribution'
    panel.appendChild(distTitle)

    const dist = q_el('div', { 'data-type': 'q-dist' })
    const max = Math.max(1, ...this.stats.dist)
    const g = this.game
    const justWonAt = g.status === 'won' ? g.guesses.length : -1
    for (let i = 0; i < Q_ROWS; i++) {
      const row = q_el('div', { 'data-type': 'q-dist-row' })
      const label = q_el('span', { 'data-type': 'q-dist-label' })
      label.textContent = String(i + 1)
      const val = this.stats.dist[i]
      const barCell = q_el('span', { 'data-type': 'q-dist-bar' })
      barCell.style.width = `${8 + (val / max) * 92}%`
      barCell.textContent = String(val)
      if (i + 1 === justWonAt) barCell.setAttribute('data-current', '')
      row.append(label, barCell)
      dist.appendChild(row)
    }
    panel.appendChild(dist)
  }

  /* ── share ── */
  private buildShareText(): string {
    const g = this.game
    const head =
      this.prefs.mode === 'daily'
        ? `Quintle #${this.daily!.day} ${g.status === 'won' ? g.guesses.length : 'X'}/${Q_ROWS}`
        : `Quintle (practice) ${g.status === 'won' ? g.guesses.length : 'X'}/${Q_ROWS}`
    const hard = this.prefs.hard ? '*' : ''
    const emoji: Record<Q_State, string> = { correct: '🟩', present: '🟨', absent: '⬛' }
    const grid = g.guesses
      .map(guess => q_evaluate(guess, g.answer).map(s => emoji[s]).join(''))
      .join('\n')
    return `${head}${hard}\n\n${grid}`
  }

  private async share() {
    const text = this.buildShareText()
    try {
      await navigator.clipboard.writeText(text)
      this.flash('Copied results to clipboard', 'win')
      return
    } catch {
      /* fall through to the legacy path */
    }
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'absolute'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      this.flash('Copied results to clipboard', 'win')
    } catch {
      this.flash('Copy failed — long-press to select', 'error')
    }
  }

  /* ── messages ── */
  private flash(msg: string, tone: 'error' | 'win' | 'lose' | 'info' = 'info') {
    const el = this.querySelector<HTMLElement>('[data-type="q-message"]')
    if (!el) return
    el.textContent = msg
    if (tone === 'info') el.removeAttribute('data-tone')
    else el.setAttribute('data-tone', tone)
  }
  private clearMessage() {
    const el = this.querySelector<HTMLElement>('[data-type="q-message"]')
    if (el) {
      el.textContent = ''
      el.removeAttribute('data-tone')
    }
  }

  private shakeCurrentRow() {
    const row = this.activeRow()
    if (!row || this.reduced) return
    row.setAttribute('data-anim', 'shake')
    this.later(() => row.removeAttribute('data-anim'), 430)
  }
}

/* ── tiny DOM helper ─────────────────────────────────────────── */
function q_el(tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}
function q_label(text: string): HTMLElement {
  const s = q_el('span', { 'data-type': 'q-group-label' })
  s.textContent = text
  return s
}
function q_winPhrase(tries: number): string {
  return ['Genius!', 'Magnificent!', 'Impressive!', 'Splendid!', 'Great!', 'Phew!'][Math.min(tries, Q_ROWS) - 1] || 'Solved!'
}

if (!customElements.get('quintle-game')) {
  customElements.define('quintle-game', QuintleGame)
}
