/**
 * Hue Hunt — a hex colour guessing game.
 *
 * Two ways to play, both fully client-side and dependency-free:
 *   • Pick   — a mystery swatch is shown with 3–6 hex options; click the one
 *              you think matches. Difficulty controls how many options there are
 *              and how close the decoys sit to the real colour.
 *   • Type   — a mystery swatch is shown and you type a hex guess; you're scored
 *              on how perceptually close you got (a redmean colour distance), with
 *              your guess rendered next to the target so you can see the miss.
 *
 * Score, current streak, best streak and best match all persist in localStorage.
 * Keyboard-friendly: 1–6 pick an option, Enter submits a typed guess, N gets the
 * next colour. All chrome colours come from theme.css tokens; only the swatches
 * themselves are coloured from the game's own random data.
 */

type Rgb = { r: number; g: number; b: number }
type Mode = 'pick' | 'type'
type DiffId = 'easy' | 'medium' | 'hard'

interface DiffConfig {
  id: DiffId
  label: string
  /** number of choices shown in pick mode */
  options: number
  /** min / max per-channel perturbation used to build a decoy */
  jitterMin: number
  jitterMax: number
  /** minimum perceptual distance any two swatches must keep apart */
  minSep: number
}

const DIFFS: DiffConfig[] = [
  { id: 'easy', label: 'Easy', options: 3, jitterMin: 46, jitterMax: 110, minSep: 120 },
  { id: 'medium', label: 'Medium', options: 4, jitterMin: 26, jitterMax: 68, minSep: 66 },
  { id: 'hard', label: 'Hard', options: 6, jitterMin: 12, jitterMax: 38, minSep: 30 },
]

const LS_KEY = 'hue-hunt:v1'

/* ── pure colour helpers ─────────────────────────────────────── */

function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function randomColor(): Rgb {
  return { r: randInt(0, 255), g: randInt(0, 255), b: randInt(0, 255) }
}

function toHex(c: Rgb): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase()
}

/** Parse #rgb / #rrggbb (with or without the hash) → Rgb, or null if invalid. */
function parseHex(s: string): Rgb | null {
  let t = s.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(t)) t = t.split('').map(ch => ch + ch).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(t)) return null
  return {
    r: parseInt(t.slice(0, 2), 16),
    g: parseInt(t.slice(2, 4), 16),
    b: parseInt(t.slice(4, 6), 16),
  }
}

/** "Redmean" perceptual colour distance — cheap and noticeably better than raw RGB channels. */
function colorDistance(a: Rgb, b: Rgb): number {
  const rbar = (a.r + b.r) / 2
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.sqrt((2 + rbar / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rbar) / 256) * db * db)
}

const MAX_DIST = colorDistance({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })

/**
 * 0–100 "match" percentage for a typed guess. Squaring the linear closeness makes
 * the score reward precision — a rough guess lands mid-range, a near-miss climbs fast.
 */
function accuracyPct(guess: Rgb, target: Rgb): number {
  const linear = 1 - colorDistance(guess, target) / MAX_DIST
  return Math.max(0, Math.round(100 * linear * linear))
}

/** Emotional label for a guess, keyed off the raw distance so it reads intuitively. */
function ratingFor(dist: number): string {
  if (dist === 0) return 'Perfect!'
  if (dist < 26) return 'Bullseye'
  if (dist < 60) return 'Excellent'
  if (dist < 110) return 'Great'
  if (dist < 180) return 'Close'
  if (dist < 280) return 'Not bad'
  return 'Way off'
}

/** Build one decoy near `target`, nudging every channel by a random signed amount. */
function makeDecoy(target: Rgb, d: DiffConfig): Rgb {
  const nudge = () => {
    const mag = randInt(d.jitterMin, d.jitterMax)
    return Math.random() < 0.5 ? -mag : mag
  }
  return {
    r: clampByte(target.r + nudge()),
    g: clampByte(target.g + nudge()),
    b: clampByte(target.b + nudge()),
  }
}

function farEnough(c: Rgb, others: Rgb[], minSep: number): boolean {
  return others.every(o => colorDistance(c, o) >= minSep)
}

/** Fisher–Yates shuffle (returns a new array). */
function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Build the target + a set of decoys for pick mode. Decoys are retried until they
 * clear `minSep` from every existing swatch; after a bounded number of attempts the
 * best-so-far is accepted so generation always terminates.
 */
function buildOptions(target: Rgb, d: DiffConfig): Rgb[] {
  const swatches: Rgb[] = [target]
  while (swatches.length < d.options) {
    let best: Rgb | null = null
    let bestSep = -1
    for (let attempt = 0; attempt < 40; attempt++) {
      const cand = makeDecoy(target, d)
      const sep = Math.min(...swatches.map(s => colorDistance(cand, s)))
      if (sep > bestSep) {
        bestSep = sep
        best = cand
      }
      if (farEnough(cand, swatches, d.minSep)) {
        best = cand
        break
      }
    }
    swatches.push(best as Rgb)
  }
  return shuffle(swatches)
}

/* ── persisted state ─────────────────────────────────────────── */

interface Saved {
  mode: Mode
  difficulty: DiffId
  bestStreak: number
  bestAccuracy: number
}

function loadSaved(): Saved {
  const fallback: Saved = { mode: 'pick', difficulty: 'easy', bestStreak: 0, bestAccuracy: 0 }
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    return {
      mode: raw.mode === 'type' ? 'type' : 'pick',
      difficulty: (['easy', 'medium', 'hard'] as DiffId[]).includes(raw.difficulty) ? raw.difficulty : 'easy',
      bestStreak: Number.isFinite(raw.bestStreak) ? Math.max(0, Math.floor(raw.bestStreak)) : 0,
      bestAccuracy: Number.isFinite(raw.bestAccuracy) ? Math.max(0, Math.min(100, Math.floor(raw.bestAccuracy))) : 0,
    }
  } catch {
    return fallback
  }
}

/* ── the game element ────────────────────────────────────────── */

class HueHuntGame extends HTMLElement {
  private mode: Mode = 'pick'
  private difficulty: DiffId = 'easy'
  private bestStreak = 0
  private bestAccuracy = 0

  // per-round
  private target: Rgb = randomColor()
  private options: Rgb[] = []
  private answered = false

  // session totals (reset on reload; bests persist)
  private streak = 0
  private rounds = 0
  private hits = 0
  private accSum = 0
  private lastAccuracy = 0

  private onKey = (e: KeyboardEvent) => this.handleKey(e)

  connectedCallback() {
    const saved = loadSaved()
    this.mode = saved.mode
    this.difficulty = saved.difficulty
    this.bestStreak = saved.bestStreak
    this.bestAccuracy = saved.bestAccuracy

    this.innerHTML = `
      <div data-type="hue-game">
        <div data-type="hue-header">
          <div data-type="hue-titlebar">
            <h1>Hue Hunt</h1>
            <span data-type="hue-badge">colour guessing game</span>
          </div>
          <p>How well do you know hex? A mystery colour appears — pick the matching code, or type your own guess and see how close your eye is. Streaks and best scores save right in your browser; nothing is uploaded.</p>
        </div>

        <div data-type="hue-controls">
          <div data-group="mode" role="group" aria-label="Game mode">
            <span data-type="hue-group-label">Mode</span>
            <div data-type="hue-seg">
              <button data-mode="pick" type="button">Pick</button>
              <button data-mode="type" type="button">Type</button>
            </div>
          </div>
          <div data-group="difficulty" role="group" aria-label="Difficulty">
            <span data-type="hue-group-label">Difficulty</span>
            <div data-type="hue-seg">
              ${DIFFS.map(d => `<button data-diff="${d.id}" type="button">${d.label}</button>`).join('')}
            </div>
          </div>
          <div data-group="actions">
            <button data-action="skip" type="button" title="Skip this colour (breaks your streak)">Skip</button>
            <button data-action="reset" type="button" title="Clear saved scores">Reset scores</button>
          </div>
        </div>

        <div data-type="hue-board" aria-live="polite"></div>

        <div data-type="hue-scorebar" aria-live="polite"></div>

        <details data-type="hue-explainer">
          <summary>How to play</summary>
          <p><strong>Pick mode:</strong> a swatch appears above a row of hex codes. Exactly one code produced that colour — click it (or press its number). Harder levels add more decoys and squeeze them closer together.</p>
          <p><strong>Type mode:</strong> read the swatch, then type your best hex guess (<code>#rrggbb</code> or the short <code>#rgb</code>). You're scored on perceptual closeness and your guess is drawn beside the answer, so you can literally see how far off you were.</p>
          <p><strong>Keyboard:</strong> <kbd>1</kbd>–<kbd>6</kbd> pick an option · <kbd>Enter</kbd> submits a typed guess · <kbd>N</kbd> jumps to the next colour.</p>
          <p data-type="hue-tip"><strong>Tip:</strong> think in three parts — how much red, green and blue. Bright yellow is lots of red + green and almost no blue (<code>#FFEE33</code>-ish); a dusty teal is low red, medium green, medium-high blue.</p>
        </details>
      </div>
    `

    this.wireControls()
    this.newRound()
    document.addEventListener('keydown', this.onKey)
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this.onKey)
  }

  /* ── persistence ── */

  private save() {
    try {
      const data: Saved = {
        mode: this.mode,
        difficulty: this.difficulty,
        bestStreak: this.bestStreak,
        bestAccuracy: this.bestAccuracy,
      }
      localStorage.setItem(LS_KEY, JSON.stringify(data))
    } catch {
      /* storage blocked — game still works, just won't remember */
    }
  }

  private diff(): DiffConfig {
    return DIFFS.find(d => d.id === this.difficulty) || DIFFS[0]
  }

  /* ── control wiring (once) ── */

  private wireControls() {
    this.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode as Mode))
    })
    this.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach(btn => {
      btn.addEventListener('click', () => this.setDifficulty(btn.dataset.diff as DiffId))
    })
    this.querySelector('[data-action="skip"]')?.addEventListener('click', () => this.skip())
    this.querySelector('[data-action="reset"]')?.addEventListener('click', () => this.resetScores())
    this.syncControlStates()
  }

  private syncControlStates() {
    this.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(btn => {
      btn.toggleAttribute('data-active', btn.dataset.mode === this.mode)
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === this.mode))
    })
    this.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach(btn => {
      btn.toggleAttribute('data-active', btn.dataset.diff === this.difficulty)
      btn.setAttribute('aria-pressed', String(btn.dataset.diff === this.difficulty))
    })
    // Difficulty only affects pick mode (type mode has no decoys).
    const diffGroup = this.querySelector('[data-group="difficulty"]') as HTMLElement | null
    if (diffGroup) diffGroup.toggleAttribute('hidden', this.mode !== 'pick')
  }

  private setMode(mode: Mode) {
    if (mode === this.mode) return
    this.mode = mode
    this.save()
    this.syncControlStates()
    this.newRound()
  }

  private setDifficulty(id: DiffId) {
    if (id === this.difficulty) return
    this.difficulty = id
    this.save()
    this.syncControlStates()
    this.newRound()
  }

  private skip() {
    // Skipping is a soft "give up": it breaks the streak but doesn't count as a round.
    this.streak = 0
    this.newRound()
  }

  private resetScores() {
    this.streak = 0
    this.rounds = 0
    this.hits = 0
    this.accSum = 0
    this.lastAccuracy = 0
    this.bestStreak = 0
    this.bestAccuracy = 0
    this.save()
    this.renderScoreboard()
  }

  /* ── round lifecycle ── */

  private newRound() {
    this.answered = false
    this.target = randomColor()
    this.options = this.mode === 'pick' ? buildOptions(this.target, this.diff()) : []
    this.renderBoard()
    this.renderScoreboard()
  }

  private renderBoard() {
    const board = this.querySelector('[data-type="hue-board"]') as HTMLElement
    board.textContent = ''

    const swatch = document.createElement('div')
    swatch.setAttribute('data-type', 'hue-swatch')
    swatch.style.background = toHex(this.target)
    swatch.setAttribute('role', 'img')
    swatch.setAttribute('aria-label', this.answered ? `The colour was ${toHex(this.target)}` : 'Mystery colour')
    const q = document.createElement('span')
    q.setAttribute('data-type', 'hue-swatch-tag')
    q.textContent = this.answered ? toHex(this.target) : '?'
    swatch.appendChild(q)
    board.appendChild(swatch)

    const panel = document.createElement('div')
    panel.setAttribute('data-type', 'hue-panel')
    board.appendChild(panel)

    if (this.mode === 'pick') this.renderPick(panel)
    else this.renderType(panel)
  }

  private renderPick(panel: HTMLElement) {
    const prompt = document.createElement('p')
    prompt.setAttribute('data-type', 'hue-prompt')
    prompt.textContent = this.answered ? '' : 'Which hex made this colour?'
    panel.appendChild(prompt)

    const opts = document.createElement('div')
    opts.setAttribute('data-type', 'hue-options')
    opts.setAttribute('data-count', String(this.options.length))
    this.options.forEach((c, i) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.setAttribute('data-type', 'hue-option')
      const num = document.createElement('span')
      num.setAttribute('data-type', 'hue-option-num')
      num.textContent = String(i + 1)
      const hex = document.createElement('span')
      hex.setAttribute('data-type', 'hue-option-hex')
      hex.textContent = toHex(c)
      btn.append(num, hex)
      btn.addEventListener('click', () => this.choose(c, btn))
      opts.appendChild(btn)
    })
    panel.appendChild(opts)

    const fb = document.createElement('div')
    fb.setAttribute('data-type', 'hue-feedback')
    panel.appendChild(fb)
  }

  private renderType(panel: HTMLElement) {
    const prompt = document.createElement('p')
    prompt.setAttribute('data-type', 'hue-prompt')
    prompt.textContent = 'Type the hex you think this is:'
    panel.appendChild(prompt)

    const row = document.createElement('div')
    row.setAttribute('data-type', 'hue-typerow')

    const input = document.createElement('input')
    input.type = 'text'
    input.setAttribute('data-type', 'hue-input')
    input.setAttribute('inputmode', 'text')
    input.setAttribute('autocomplete', 'off')
    input.setAttribute('spellcheck', 'false')
    input.setAttribute('maxlength', '7')
    input.setAttribute('placeholder', '#3A7BD5')
    input.setAttribute('aria-label', 'Your hex guess')
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.answered ? this.newRound() : this.submitTyped(input)
      }
    })

    const go = document.createElement('button')
    go.type = 'button'
    go.setAttribute('data-type', 'hue-submit')
    go.textContent = 'Guess'
    go.addEventListener('click', () => this.submitTyped(input))

    row.append(input, go)
    panel.appendChild(row)

    const err = document.createElement('p')
    err.setAttribute('data-type', 'hue-input-error')
    err.hidden = true
    err.textContent = 'Enter a hex like #3A7BD5 or #37D.'
    panel.appendChild(err)

    const fb = document.createElement('div')
    fb.setAttribute('data-type', 'hue-feedback')
    panel.appendChild(fb)

    requestAnimationFrame(() => input.focus())
  }

  /* ── pick answer ── */

  private choose(chosen: Rgb, btn: HTMLButtonElement) {
    if (this.answered) return
    this.answered = true
    this.rounds++
    const correct = colorDistance(chosen, this.target) === 0

    this.querySelectorAll<HTMLButtonElement>('[data-type="hue-option"]').forEach((b, i) => {
      b.disabled = true
      const c = this.options[i]
      if (colorDistance(c, this.target) === 0) b.setAttribute('data-state', 'correct')
      else if (b === btn) b.setAttribute('data-state', 'wrong')
    })

    if (correct) {
      this.hits++
      this.streak++
      if (this.streak > this.bestStreak) this.bestStreak = this.streak
    } else {
      this.streak = 0
    }
    this.save()

    const fb = this.querySelector('[data-type="hue-feedback"]') as HTMLElement
    fb.textContent = ''
    const verdict = document.createElement('p')
    verdict.setAttribute('data-type', 'hue-verdict')
    verdict.setAttribute('data-result', correct ? 'win' : 'lose')
    verdict.textContent = correct
      ? `Correct — ${toHex(this.target)}. Streak ${this.streak}.`
      : `Not quite. It was ${toHex(this.target)}.`
    fb.appendChild(verdict)
    fb.appendChild(this.nextButton())

    // reveal the answer on the swatch tag
    const tag = this.querySelector('[data-type="hue-swatch-tag"]')
    if (tag) tag.textContent = toHex(this.target)

    this.renderScoreboard()
  }

  /* ── typed answer ── */

  private submitTyped(input: HTMLInputElement) {
    if (this.answered) return
    const guess = parseHex(input.value)
    const err = this.querySelector('[data-type="hue-input-error"]') as HTMLElement
    if (!guess) {
      err.hidden = false
      input.focus()
      input.select()
      return
    }
    err.hidden = true
    this.answered = true
    this.rounds++
    input.disabled = true

    const dist = colorDistance(guess, this.target)
    const pct = accuracyPct(guess, this.target)
    this.lastAccuracy = pct
    this.accSum += pct
    if (pct > this.bestAccuracy) this.bestAccuracy = pct
    // A near-perfect eye keeps a streak going in type mode too (>= 90% match).
    if (pct >= 90) {
      this.streak++
      if (this.streak > this.bestStreak) this.bestStreak = this.streak
    } else {
      this.streak = 0
    }
    this.save()

    const tag = this.querySelector('[data-type="hue-swatch-tag"]')
    if (tag) tag.textContent = toHex(this.target)

    const fb = this.querySelector('[data-type="hue-feedback"]') as HTMLElement
    fb.textContent = ''

    const verdict = document.createElement('p')
    verdict.setAttribute('data-type', 'hue-verdict')
    verdict.setAttribute('data-result', pct >= 90 ? 'win' : pct >= 70 ? 'ok' : 'lose')
    verdict.textContent = `${ratingFor(dist)} — ${pct}% match.`
    fb.appendChild(verdict)

    const compare = document.createElement('div')
    compare.setAttribute('data-type', 'hue-compare')
    compare.appendChild(this.miniSwatch('Answer', toHex(this.target)))
    compare.appendChild(this.miniSwatch('Your guess', toHex(guess)))
    fb.appendChild(compare)

    fb.appendChild(this.nextButton())
    this.renderScoreboard()
  }

  private miniSwatch(label: string, hex: string): HTMLElement {
    const wrap = document.createElement('div')
    wrap.setAttribute('data-type', 'hue-mini')
    const sw = document.createElement('div')
    sw.setAttribute('data-type', 'hue-mini-swatch')
    sw.style.background = hex
    const lab = document.createElement('span')
    lab.setAttribute('data-type', 'hue-mini-label')
    lab.textContent = label
    const code = document.createElement('span')
    code.setAttribute('data-type', 'hue-mini-hex')
    code.textContent = hex
    wrap.append(sw, lab, code)
    return wrap
  }

  private nextButton(): HTMLElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('data-type', 'hue-next')
    btn.textContent = 'Next colour ›'
    btn.addEventListener('click', () => this.newRound())
    return btn
  }

  /* ── scoreboard ── */

  private renderScoreboard() {
    const bar = this.querySelector('[data-type="hue-scorebar"]') as HTMLElement
    bar.textContent = ''
    const stats: [string, string][] =
      this.mode === 'pick'
        ? [
            ['Streak', String(this.streak)],
            ['Best streak', String(this.bestStreak)],
            ['Correct', `${this.hits}/${this.rounds}`],
            ['Accuracy', this.rounds ? `${Math.round((this.hits / this.rounds) * 100)}%` : '—'],
          ]
        : [
            ['Last match', this.rounds ? `${this.lastAccuracy}%` : '—'],
            ['Best match', this.bestAccuracy ? `${this.bestAccuracy}%` : '—'],
            ['Avg match', this.rounds ? `${Math.round(this.accSum / this.rounds)}%` : '—'],
            ['Streak', `${this.streak}`],
          ]
    for (const [label, value] of stats) {
      const stat = document.createElement('div')
      stat.setAttribute('data-type', 'hue-stat')
      const v = document.createElement('span')
      v.setAttribute('data-type', 'hue-stat-value')
      v.textContent = value
      const l = document.createElement('span')
      l.setAttribute('data-type', 'hue-stat-label')
      l.textContent = label
      stat.append(v, l)
      bar.appendChild(stat)
    }
  }

  /* ── keyboard ── */

  private handleKey(e: KeyboardEvent) {
    const active = document.activeElement
    const inInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    if (e.metaKey || e.ctrlKey || e.altKey) return

    // Next colour
    if ((e.key === 'n' || e.key === 'N') && !inInput) {
      if (this.answered) {
        e.preventDefault()
        this.newRound()
      }
      return
    }

    // Pick an option by number (pick mode, before answering)
    if (this.mode === 'pick' && !this.answered && !inInput) {
      const n = parseInt(e.key, 10)
      if (n >= 1 && n <= this.options.length) {
        e.preventDefault()
        const btn = this.querySelectorAll<HTMLButtonElement>('[data-type="hue-option"]')[n - 1]
        if (btn) this.choose(this.options[n - 1], btn)
      }
    }
  }
}

if (!customElements.get('hue-hunt-game')) {
  customElements.define('hue-hunt-game', HueHuntGame)
}
