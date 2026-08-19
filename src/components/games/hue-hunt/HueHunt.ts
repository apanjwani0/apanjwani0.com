/**
 * Hue Hunt — a hex colour guessing game.
 *
 * Three ways to play, all dependency-free and played entirely in the browser:
 *   • Daily  — five colours derived from the UTC day, so everyone on Earth gets
 *              the same five, one guess at each, scored out of 500, shareable as
 *              a spoiler-free grid and postable to a server-scored board. The
 *              reason to come back tomorrow.
 *   • Pick   — a mystery swatch is shown with 3–6 hex options; click the one
 *              you think matches. Difficulty controls how many options there are
 *              and how close the decoys sit to the real colour.
 *   • Type   — a mystery swatch is shown and you type a hex guess; you're scored
 *              on how perceptually close you got (a redmean colour distance), with
 *              your guess rendered next to the target so you can see the miss.
 *
 * Play state persists in localStorage and is never uploaded. The one thing that
 * does leave the browser is a daily run you explicitly submit to the board, and
 * it carries a display name and the five raw hex guesses — no score. The server
 * re-derives the day's colours and re-computes the total itself
 * (src/lib/hue-hunt-daily.ts is imported by both sides so they cannot disagree),
 * which is what makes the number beside a name mean anything. Still no account,
 * no cookie and no per-visitor identity: a name plus a number is the whole record.
 *
 * Keyboard-friendly: 1–6 pick an option, Enter submits a typed guess, N gets the
 * next colour. All chrome colours come from theme.css tokens; only the swatches
 * themselves are coloured from the game's own data.
 */

import {
  HUE_DAILY_MAX as DAILY_MAX,
  HUE_DAILY_ROUNDS as DAILY_ROUNDS,
  type Rgb,
  accuracyPct,
  clampByte,
  colorDistance,
  dailyColors,
  hueDayNumber,
  msUntilHueReset,
  parseHex,
  toHex,
} from '../../../lib/hue-hunt-daily'

type Mode = 'daily' | 'pick' | 'type'
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

/** How many rows of the day's board to draw. The API returns more; the panel is
 *  a scoreboard, not a directory, and an unbounded list on a phone is a wall. */
const BOARD_ROWS = 10

/* ── pure colour helpers ─────────────────────────────────────── */

function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

function randomColor(): Rgb {
  return { r: randInt(0, 255), g: randInt(0, 255), b: randInt(0, 255) }
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

/* ── the daily five ──────────────────────────────────────────── */

/* DAILY_ROUNDS, DAILY_MAX, the day number and the colours themselves all live in
 * src/lib/hue-hunt-daily.ts, imported above. They are NOT defined here because
 * the leaderboard route re-derives the same colours and re-computes the same
 * score from a submitted set of guesses — a second copy of that arithmetic in
 * the browser would eventually disagree with the server about what a run was
 * worth, and the board would look broken while both halves looked correct. */

/** Time left on today's colours, as "6h 12m". Computed when the card renders
 *  rather than ticked by an interval — a live countdown on a page that may sit
 *  in a background tab for hours buys a second of precision for a listener to
 *  leak, and the card is already re-rendered on every visit. */
function hh_untilReset(now = Date.now()): string {
  const ms = msUntilHueReset(now)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Score → the square used in the shared grid. Bands rather than exact numbers,
 *  so a posted result gives away nothing about the colours themselves. */
function dailySquare(pct: number): string {
  if (pct >= 90) return '🟩'
  if (pct >= 75) return '🟨'
  if (pct >= 55) return '🟧'
  return '🟥'
}

/* ── persisted state ─────────────────────────────────────────── */

interface DailyRun {
  /** the UTC day number these scores belong to */
  day: number
  /** one 0–100 match per answered colour, in order */
  scores: number[]
  /** what the player typed each round, so the finished card still shows their
   *  guess beside the answer after a refresh */
  guesses: string[]
}

interface Saved {
  mode: Mode
  difficulty: DiffId
  bestStreak: number
  bestAccuracy: number
  daily: DailyRun | null
  bestDaily: number
  dayStreak: number
  /** day number of the last *finished* daily — the day-streak's anchor */
  lastDailyDay: number | null
  /** display name last used on the leaderboard, so joining is one click the
   *  second day. Not an identity — the server keys rows by name and nothing
   *  else, and nothing here or there ties a name to a person. */
  boardName: string
  /** day number already submitted, so a refresh shows the board rather than
   *  offering to submit a run that is already up there */
  submittedDay: number | null
}

/**
 * A stored run is re-validated rather than trusted. localStorage is editable by
 * hand and written by every past version of this file, and a half-written record
 * — four scores against five guesses — would render a run that cannot exist.
 * Anything that fails a check degrades to "no run today", costing at most one
 * day's progress instead of throwing on mount.
 */
function sanitizeDaily(raw: unknown): DailyRun | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Number.isFinite(r.day)) return null
  const scores: unknown[] = Array.isArray(r.scores) ? r.scores : []
  const guesses: unknown[] = Array.isArray(r.guesses) ? r.guesses : []
  if (scores.length !== guesses.length || scores.length > DAILY_ROUNDS) return null
  if (!scores.every(v => Number.isFinite(v) && (v as number) >= 0 && (v as number) <= 100)) return null
  if (!guesses.every(v => typeof v === 'string' && parseHex(v) !== null)) return null
  return {
    day: Math.floor(r.day as number),
    scores: scores.map(v => Math.round(v as number)),
    guesses: guesses.map(v => toHex(parseHex(v as string) as Rgb)),
  }
}

function loadSaved(): Saved {
  const fallback: Saved = {
    mode: 'daily',
    difficulty: 'easy',
    bestStreak: 0,
    bestAccuracy: 0,
    daily: null,
    bestDaily: 0,
    dayStreak: 0,
    lastDailyDay: null,
    boardName: '',
    submittedDay: null,
  }
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    return {
      // Unknown or absent lands on the daily: it is the mode worth arriving in,
      // and a save written before the daily existed only ever says pick or type,
      // so returning visitors still keep the mode they chose.
      mode: raw.mode === 'pick' ? 'pick' : raw.mode === 'type' ? 'type' : 'daily',
      difficulty: (['easy', 'medium', 'hard'] as DiffId[]).includes(raw.difficulty) ? raw.difficulty : 'easy',
      bestStreak: Number.isFinite(raw.bestStreak) ? Math.max(0, Math.floor(raw.bestStreak)) : 0,
      bestAccuracy: Number.isFinite(raw.bestAccuracy) ? Math.max(0, Math.min(100, Math.floor(raw.bestAccuracy))) : 0,
      daily: sanitizeDaily(raw.daily),
      bestDaily: Number.isFinite(raw.bestDaily) ? Math.max(0, Math.min(DAILY_MAX, Math.floor(raw.bestDaily))) : 0,
      dayStreak: Number.isFinite(raw.dayStreak) ? Math.max(0, Math.floor(raw.dayStreak)) : 0,
      lastDailyDay: Number.isFinite(raw.lastDailyDay) ? Math.floor(raw.lastDailyDay) : null,
      boardName: typeof raw.boardName === 'string' ? raw.boardName.slice(0, 24) : '',
      submittedDay: Number.isFinite(raw.submittedDay) ? Math.floor(raw.submittedDay) : null,
    }
  } catch {
    return fallback
  }
}

/* ── the game element ────────────────────────────────────────── */

class HueHuntGame extends HTMLElement {
  private mode: Mode = 'daily'
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

  // daily (persists; its own ledger, kept apart from the endless-mode records)
  private daily: DailyRun = { day: hueDayNumber(), scores: [], guesses: [] }
  private dailyTargets: Rgb[] = []
  private bestDaily = 0
  private dayStreak = 0
  private lastDailyDay: number | null = null

  // leaderboard (server-scored; the only thing this game ever uploads)
  private boardName = ''
  private submittedDay: number | null = null
  private boardEl!: HTMLElement
  private boardMetaEl!: HTMLElement
  private boardFormEl!: HTMLFormElement
  private boardNameEl!: HTMLInputElement
  private boardNoteEl!: HTMLElement
  private boardListEl!: HTMLElement

  /** False until the first paint is done. The typed modes focus their input so a
   *  player can just start typing, but doing that *on mount* would open the
   *  mobile keyboard and scroll the page the moment someone arrives — and the
   *  daily made a typed mode the landing mode, so that stopped being a corner
   *  case. Focus is earned by an interaction: Next, or picking a mode. */
  private mounted = false

  private onKey = (e: KeyboardEvent) => this.handleKey(e)

  connectedCallback() {
    const saved = loadSaved()
    this.mode = saved.mode
    this.difficulty = saved.difficulty
    this.bestStreak = saved.bestStreak
    this.bestAccuracy = saved.bestAccuracy
    this.bestDaily = saved.bestDaily
    this.dayStreak = saved.dayStreak
    this.lastDailyDay = saved.lastDailyDay
    this.boardName = saved.boardName
    this.submittedDay = saved.submittedDay

    const today = hueDayNumber()
    this.dailyTargets = dailyColors(today)
    // A run stored under an earlier day is finished business — today starts empty
    // rather than resuming yesterday's third colour against today's swatch.
    this.daily = saved.daily && saved.daily.day === today ? saved.daily : { day: today, scores: [], guesses: [] }

    this.innerHTML = `
      <div data-type="hue-game">
        <div data-type="hue-header">
          <div data-type="hue-titlebar">
            <h1>Hue Hunt</h1>
            <span data-type="hue-badge">colour guessing game</span>
          </div>
          <p>How well do you know hex? Every UTC day brings five colours — the same five for everyone, one guess at each, scored out of 500 with a spoiler-free grid to share. Or play on endlessly: pick the matching code from a lineup, or type your own and see how close your eye really is. Everything saves right in your browser; nothing is uploaded.</p>
        </div>

        <div data-type="hue-controls">
          <div data-group="mode" role="group" aria-label="Game mode">
            <span data-type="hue-group-label">Mode</span>
            <div data-type="hue-seg">
              <button data-mode="daily" type="button">Daily</button>
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

        <section data-type="hue-daily" hidden aria-label="Daily leaderboard">
          <h2>Today's board</h2>
          <p data-type="hue-daily-meta"></p>
          <form data-type="hue-daily-form" hidden>
            <label>
              <span>Name for the board</span>
              <input
                data-type="hue-daily-name"
                type="text"
                maxlength="24"
                autocomplete="nickname"
                spellcheck="false"
                placeholder="e.g. swift fox"
              />
            </label>
            <button data-action="submit-daily" type="submit">Put me on the board</button>
          </form>
          <p data-type="hue-daily-note" role="status" aria-live="polite" hidden></p>
          <ol data-type="hue-daily-board"></ol>
        </section>

        <details data-type="hue-explainer" open>
          <summary>New to hex? How colour works + how to play</summary>

          <p><strong>Every colour on a screen is a mix of three lights — Red, Green and Blue.</strong> A hex code just writes down how much of each: <code>#RRGGBB</code> — the first pair is Red, the middle Green, the last Blue. Each runs from <code>00</code> (that light off) to <code>FF</code> (that light full). More light means brighter.</p>

          <div data-type="hue-legend">
            <div data-type="hue-legend-item"><span data-type="hue-ex-sw" style="background:#FF0000"></span><code>#FF0000</code> <span>Red full, no green or blue</span></div>
            <div data-type="hue-legend-item"><span data-type="hue-ex-sw" style="background:#00FF00"></span><code>#00FF00</code> <span>Green only</span></div>
            <div data-type="hue-legend-item"><span data-type="hue-ex-sw" style="background:#0000FF"></span><code>#0000FF</code> <span>Blue only</span></div>
            <div data-type="hue-legend-item"><span data-type="hue-ex-sw" style="background:#FFFF00"></span><code>#FFFF00</code> <span>Red + Green = yellow</span></div>
            <div data-type="hue-legend-item"><span data-type="hue-ex-sw" style="background:#00FFFF"></span><code>#00FFFF</code> <span>Green + Blue = cyan</span></div>
            <div data-type="hue-legend-item"><span data-type="hue-ex-sw" style="background:#FF00FF"></span><code>#FF00FF</code> <span>Red + Blue = magenta</span></div>
            <div data-type="hue-legend-item"><span data-type="hue-ex-sw" style="background:#FF8000"></span><code>#FF8000</code> <span>Red full, Green half = orange</span></div>
            <div data-type="hue-legend-item"><span data-type="hue-ex-sw" style="background:#808080"></span><code>#808080</code> <span>equal medium = grey</span></div>
            <div data-type="hue-legend-item"><span data-type="hue-ex-sw" style="background:#FFFFFF"></span><code>#FFFFFF</code> <span>all three full = white</span></div>
            <div data-type="hue-legend-item"><span data-type="hue-ex-sw" style="background:#000000"></span><code>#000000</code> <span>all three off = black</span></div>
          </div>

          <p><strong>Play — Daily:</strong> five colours, the same five for everyone on Earth that day, one guess each and no going back. Each guess scores 0–100 on how close you got, for 500 across the set, and the result card copies a spoiler-free grid you can post next to someone else's. New colours at midnight UTC — not your midnight, so that the comparison is fair wherever you are.</p>
          <p><strong>Play — Pick:</strong> a mystery swatch sits above a row of hex codes; exactly one made it. Ask which code has the most of the colours you see, then click it (or press its number). After each round it shows the answer's Red/Green/Blue mix, so the codes start to click.</p>
          <p><strong>Play — Type:</strong> read the swatch and type a guess (<code>#RRGGBB</code>, or the short <code>#RGB</code>). You're scored on how close you got, with your colour and its mix drawn right next to the answer.</p>
          <p><strong>Keyboard:</strong> <kbd>1</kbd>–<kbd>6</kbd> pick an option · <kbd>Enter</kbd> submits a typed guess · <kbd>N</kbd> jumps to the next colour (in Daily it only moves on once you have answered — there is no skipping a shared run).</p>

          <p data-type="hue-tip"><strong>Quick trick:</strong> name the colour to yourself first — "orange = mostly red, a bit of green, no blue" — then match that to the codes instead of reading the numbers cold.</p>
        </details>
      </div>
    `

    this.boardEl = this.querySelector('[data-type="hue-daily"]') as HTMLElement
    this.boardMetaEl = this.querySelector('[data-type="hue-daily-meta"]') as HTMLElement
    this.boardFormEl = this.querySelector('[data-type="hue-daily-form"]') as HTMLFormElement
    this.boardNameEl = this.querySelector('[data-type="hue-daily-name"]') as HTMLInputElement
    this.boardNoteEl = this.querySelector('[data-type="hue-daily-note"]') as HTMLElement
    this.boardListEl = this.querySelector('[data-type="hue-daily-board"]') as HTMLElement
    this.boardFormEl.addEventListener('submit', e => {
      e.preventDefault()
      void this.submitToBoard()
    })

    this.wireControls()
    this.newRound()
    if (this.mode === 'daily') void this.refreshBoard()
    this.mounted = true
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
        daily: this.daily,
        bestDaily: this.bestDaily,
        dayStreak: this.dayStreak,
        lastDailyDay: this.lastDailyDay,
        boardName: this.boardName,
        submittedDay: this.submittedDay,
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
    // Difficulty only affects pick mode (the typed modes have no decoys).
    const diffGroup = this.querySelector('[data-group="difficulty"]') as HTMLElement | null
    if (diffGroup) diffGroup.toggleAttribute('hidden', this.mode !== 'pick')
    // No skipping a daily colour: everyone answers the same five, so an escape
    // hatch that quietly drops one would make two scores incomparable.
    const skip = this.querySelector('[data-action="skip"]') as HTMLElement | null
    if (skip) skip.toggleAttribute('hidden', this.mode === 'daily')
  }

  private setMode(mode: Mode) {
    if (mode === this.mode) return
    this.mode = mode
    this.save()
    this.syncControlStates()
    this.newRound()
    if (mode === 'daily') void this.refreshBoard()
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
    this.bestDaily = 0
    this.dayStreak = 0
    this.lastDailyDay = null
    // Deliberately leaves today's run in place. Clearing it here would make this
    // a "play today again" button, and a daily is only worth comparing if it was
    // one attempt at the five colours — the honour system still needs the UI not
    // to hand out the bypass.
    this.save()
    this.renderScoreboard()
  }

  /* ── daily run ── */

  private dailyDone(): boolean {
    return this.daily.scores.length >= DAILY_ROUNDS
  }

  private dailyTotal(): number {
    return this.daily.scores.reduce((a, b) => a + b, 0)
  }

  /** Roll the run over if the tab has been open across UTC midnight — otherwise a
   *  session started at 23:59 keeps scoring guesses against yesterday's colours
   *  while the card claims today's number. */
  private syncDay() {
    const today = hueDayNumber()
    if (this.daily.day === today) return
    this.daily = { day: today, scores: [], guesses: [] }
    this.dailyTargets = dailyColors(today)
    this.save()
  }

  private recordDaily(guess: Rgb, pct: number) {
    this.daily.scores.push(pct)
    this.daily.guesses.push(toHex(guess))
    if (!this.dailyDone()) return
    // One refresh per finished run, here rather than in syncDailyUI: the board is
    // about to be offered to this player, and a list fetched when they arrived
    // ten minutes ago is the wrong thing to be looking at while deciding whether
    // to post. Every other round leaves the endpoint alone.
    void this.refreshBoard()
    const total = this.dailyTotal()
    if (total > this.bestDaily) this.bestDaily = total
    // Consecutive UTC days *finished*. The guard matters: without it a re-render
    // of an already-scored run would advance the streak a second time.
    if (this.lastDailyDay !== this.daily.day) {
      this.dayStreak = this.lastDailyDay === this.daily.day - 1 ? this.dayStreak + 1 : 1
      this.lastDailyDay = this.daily.day
    }
  }

  /** Endless-mode bookkeeping for a typed guess. The daily deliberately feeds
   *  none of these: "best match" and the streak are records of an unbounded
   *  grind, and mixing five shared colours into them makes both numbers mean
   *  less than either did alone. */
  private recordPractice(pct: number) {
    this.rounds++
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
  }

  /* ── round lifecycle ── */

  private newRound() {
    this.answered = false
    if (this.mode === 'daily') {
      this.syncDay()
      // A finished run has no current colour; renderBoard shows the card instead.
      this.target = this.dailyTargets[Math.min(this.daily.scores.length, DAILY_ROUNDS - 1)]
      this.options = []
    } else {
      this.target = randomColor()
      this.options = this.mode === 'pick' ? buildOptions(this.target, this.diff()) : []
    }
    this.renderBoard()
    this.renderScoreboard()
    this.syncDailyUI()
  }

  private renderBoard() {
    const board = this.querySelector('[data-type="hue-board"]') as HTMLElement
    board.textContent = ''

    if (this.mode === 'daily' && this.dailyDone()) {
      board.setAttribute('data-layout', 'result')
      board.appendChild(this.buildDailyResult())
      return
    }
    board.removeAttribute('data-layout')

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
    if (this.mode === 'daily') {
      const prog = document.createElement('p')
      prog.setAttribute('data-type', 'hue-progress')
      prog.textContent = `Hue Hunt #${this.daily.day} · colour ${this.daily.scores.length + 1} of ${DAILY_ROUNDS}`
      panel.appendChild(prog)
    }

    const prompt = document.createElement('p')
    prompt.setAttribute('data-type', 'hue-prompt')
    prompt.textContent =
      this.mode === 'daily'
        ? 'Type the hex you think this is — one guess, then it moves on.'
        : 'Type the hex you think this is:'
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

    if (this.mounted) requestAnimationFrame(() => input.focus())
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
    const mix = document.createElement('div')
    mix.setAttribute('data-type', 'hue-mix')
    const cap = document.createElement('span')
    cap.setAttribute('data-type', 'hue-mix-cap')
    cap.textContent = `${toHex(this.target)} is:`
    mix.append(cap, this.channelBars(this.target))
    fb.appendChild(mix)
    fb.appendChild(this.nextButton())

    // reveal the answer on the swatch tag
    const tag = this.querySelector('[data-type="hue-swatch-tag"]')
    if (tag) tag.textContent = toHex(this.target)

    this.renderScoreboard()
  }

  /* ── typed answer ── */

  private submitTyped(input: HTMLInputElement) {
    if (this.answered) return
    // syncDay() only runs from newRound(), so a tab left open across UTC midnight
    // is still showing yesterday's swatch. Scoring this guess would file it
    // against a colour nobody else is playing and then drop it silently on the
    // next round — roll the run over instead, and say so rather than just
    // blanking the board under the player's cursor.
    if (this.mode === 'daily' && this.daily.day !== hueDayNumber()) {
      this.newRound()
      void this.refreshBoard()
      this.setBoardNote("Midnight UTC rolled over mid-run — today's five are up. This one starts fresh.")
      return
    }
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
    input.disabled = true

    const dist = colorDistance(guess, this.target)
    const pct = accuracyPct(guess, this.target)
    if (this.mode === 'daily') this.recordDaily(guess, pct)
    else this.recordPractice(pct)
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
    compare.appendChild(this.miniSwatch('Answer', this.target))
    compare.appendChild(this.miniSwatch('Your guess', guess))
    fb.appendChild(compare)

    fb.appendChild(this.nextButton())
    this.renderScoreboard()
  }

  private miniSwatch(label: string, c: Rgb): HTMLElement {
    const hex = toHex(c)
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
    wrap.append(sw, lab, code, this.channelBars(c))
    return wrap
  }

  /** Three labelled R/G/B bars showing how much of each light makes colour `c`. */
  private channelBars(c: Rgb): HTMLElement {
    const wrap = document.createElement('div')
    wrap.setAttribute('data-type', 'hue-channels')
    const chans: [string, number, string][] = [
      ['R', c.r, '#e5484d'],
      ['G', c.g, '#30a46c'],
      ['B', c.b, '#3e63dd'],
    ]
    for (const [label, val, color] of chans) {
      const row = document.createElement('div')
      row.setAttribute('data-type', 'hue-chan')
      const lab = document.createElement('span')
      lab.setAttribute('data-type', 'hue-chan-label')
      lab.textContent = label
      const track = document.createElement('span')
      track.setAttribute('data-type', 'hue-chan-track')
      const fill = document.createElement('span')
      fill.setAttribute('data-type', 'hue-chan-fill')
      fill.style.width = `${(val / 255) * 100}%`
      fill.style.background = color
      track.appendChild(fill)
      const num = document.createElement('span')
      num.setAttribute('data-type', 'hue-chan-val')
      num.textContent = String(val)
      row.append(lab, track, num)
      wrap.appendChild(row)
    }
    return wrap
  }

  private nextButton(): HTMLElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('data-type', 'hue-next')
    // recordDaily has already pushed the score by the time this renders, so the
    // fifth answer reads as the run being over rather than as one more colour.
    btn.textContent = this.mode === 'daily' && this.dailyDone() ? 'See your result ›' : 'Next colour ›'
    btn.addEventListener('click', () => this.newRound())
    return btn
  }

  /* ── daily result card ── */

  private buildDailyResult(): HTMLElement {
    const card = document.createElement('div')
    card.setAttribute('data-type', 'hue-result')

    const title = document.createElement('p')
    title.setAttribute('data-type', 'hue-result-title')
    title.textContent = `Hue Hunt #${this.daily.day} — today's five`
    card.appendChild(title)

    const total = document.createElement('p')
    total.setAttribute('data-type', 'hue-result-total')
    const big = document.createElement('strong')
    big.textContent = String(this.dailyTotal())
    const outOf = document.createElement('span')
    outOf.textContent = ` / ${DAILY_MAX}`
    total.append(big, outOf)
    card.appendChild(total)

    const grid = document.createElement('p')
    grid.setAttribute('data-type', 'hue-result-grid')
    grid.textContent = this.daily.scores.map(dailySquare).join('')
    card.appendChild(grid)

    const caption = document.createElement('p')
    caption.setAttribute('data-type', 'hue-result-caption')
    caption.textContent = 'The answer, your guess, and how close you got.'
    card.appendChild(caption)

    const rows = document.createElement('div')
    rows.setAttribute('data-type', 'hue-result-rows')
    this.daily.scores.forEach((pct, i) => rows.appendChild(this.dailyRow(i, pct)))
    card.appendChild(rows)

    const actions = document.createElement('div')
    actions.setAttribute('data-type', 'hue-result-actions')
    const share = document.createElement('button')
    share.type = 'button'
    share.setAttribute('data-type', 'hue-share')
    share.textContent = 'Copy result'
    share.addEventListener('click', () => this.shareDaily())
    const msg = document.createElement('p')
    msg.setAttribute('data-type', 'hue-share-msg')
    actions.append(share, msg)
    card.appendChild(actions)

    const reset = document.createElement('p')
    reset.setAttribute('data-type', 'hue-reset')
    reset.textContent = `New colours in ${hh_untilReset()} — midnight UTC, the same five for everyone.`
    card.appendChild(reset)

    return card
  }

  private dailyRow(i: number, pct: number): HTMLElement {
    const answer = toHex(this.dailyTargets[i])
    const guess = this.daily.guesses[i]
    const row = document.createElement('div')
    row.setAttribute('data-type', 'hue-result-row')

    const num = document.createElement('span')
    num.setAttribute('data-type', 'hue-result-num')
    num.textContent = String(i + 1)

    const pair = document.createElement('span')
    pair.setAttribute('data-type', 'hue-result-pair')
    for (const [hex, role] of [[answer, 'answer'], [guess, 'guess']] as const) {
      const sw = document.createElement('span')
      sw.setAttribute('data-type', 'hue-result-sw')
      sw.setAttribute('data-role', role)
      sw.style.background = hex
      pair.appendChild(sw)
    }

    const answerHex = document.createElement('span')
    answerHex.setAttribute('data-type', 'hue-result-hex')
    answerHex.textContent = answer

    const guessHex = document.createElement('span')
    guessHex.setAttribute('data-type', 'hue-result-hex')
    guessHex.setAttribute('data-role', 'guess')
    guessHex.textContent = guess

    const score = document.createElement('span')
    score.setAttribute('data-type', 'hue-result-pct')
    score.textContent = `${pct}%`

    row.append(num, pair, answerHex, guessHex, score)
    return row
  }

  /** Spoiler-free: bands, never the hexes. Someone who has not played today can
   *  read a posted grid without it giving the colours away — and the URL is on
   *  the last line, because a grid with no route back is a screenshot of a game
   *  the reader cannot find. */
  private dailyShareText(): string {
    const url = `${location.origin}${location.pathname}`
    return [
      `Hue Hunt #${this.daily.day} — ${this.dailyTotal()}/${DAILY_MAX}`,
      this.daily.scores.map(dailySquare).join(''),
      `Same five colours for everyone today: ${url}`,
    ].join('\n')
  }

  private async shareDaily() {
    const text = this.dailyShareText()
    try {
      await navigator.clipboard.writeText(text)
      this.flashShare('Copied — paste it anywhere.')
      return
    } catch {
      /* clipboard API refused (insecure context, or permission) — fall through */
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
      this.flashShare('Copied — paste it anywhere.')
    } catch {
      this.flashShare('Copy failed — long-press to select the grid above.', true)
    }
  }

  private flashShare(msg: string, error = false) {
    const el = this.querySelector('[data-type="hue-share-msg"]') as HTMLElement | null
    if (!el) return
    el.textContent = msg
    el.toggleAttribute('data-error', error)
  }

  /* ── daily leaderboard (the only thing this game uploads) ── */

  private setBoardNote(text: string, error = false) {
    this.boardNoteEl.textContent = text
    this.boardNoteEl.hidden = !text
    this.boardNoteEl.toggleAttribute('data-error', error)
  }

  /**
   * Show the panel in daily mode only, and offer the form only once the run is
   * finished and has not already been sent. Cheap enough to call every round —
   * the network fetch is deliberately NOT here, or a five-colour run would hit
   * the endpoint five times for a board that cannot have changed.
   */
  private syncDailyUI() {
    if (!this.boardEl) return
    const daily = this.mode === 'daily'
    this.boardEl.hidden = !daily
    if (!daily) return
    this.boardMetaEl.textContent =
      `Everyone plays the same five colours today (Hue Hunt #${this.daily.day}). New colours in ${hh_untilReset()}.`
    const alreadySent = this.submittedDay === this.daily.day
    this.boardFormEl.hidden = !this.dailyDone() || alreadySent
    if (!this.boardFormEl.hidden && !this.boardNameEl.value) this.boardNameEl.value = this.boardName
  }

  private async refreshBoard() {
    try {
      const res = await fetch('/api/games/hue-hunt/daily', { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json() as { entries?: unknown }
      this.renderLeaderboard(Array.isArray(data.entries) ? data.entries : [])
    } catch {
      this.boardListEl.textContent = ''
      this.setBoardNote('Board unavailable right now — your run still scores and saves locally.')
    }
  }

  /**
   * Draw the day's rows. Names are strings other people chose, so every one of
   * them lands in a text node — this builds DOM rather than assembling markup,
   * which means there is no string for a name to escape from in the first place.
   */
  private renderLeaderboard(entries: unknown[]) {
    const you = (this.submittedDay === this.daily.day ? this.boardName : '').toLowerCase()
    // Any note here is now stale — a "board unavailable" left above a board that
    // just loaded reads as the board being broken. Callers that have something to
    // say (a submit result) set their note after this returns.
    this.setBoardNote('')
    this.boardListEl.textContent = ''
    let shown = 0
    for (const raw of entries.slice(0, BOARD_ROWS)) {
      const v = (raw ?? {}) as Record<string, unknown>
      const name = typeof v.name === 'string' ? v.name : '?'
      const score = typeof v.score === 'number' ? Math.round(v.score) : 0
      const li = document.createElement('li')
      if (you && name.toLowerCase() === you) li.setAttribute('data-you', '')
      const rank = document.createElement('span')
      rank.setAttribute('data-type', 'hue-lb-rank')
      rank.textContent = String(shown + 1)
      const who = document.createElement('span')
      who.setAttribute('data-type', 'hue-lb-name')
      who.textContent = name
      const pts = document.createElement('span')
      pts.setAttribute('data-type', 'hue-lb-score')
      pts.textContent = `${score} / ${DAILY_MAX}`
      li.append(rank, who, pts)
      this.boardListEl.appendChild(li)
      shown += 1
    }
    if (!shown) {
      this.setBoardNote(
        this.dailyDone()
          ? 'Nobody has posted today yet — put your run up and be first.'
          : 'Nobody has posted today yet. Finish the five and be first.',
      )
    }
  }

  /**
   * Send the run. The body carries the day and the five raw hex guesses and
   * nothing else — deliberately no score: the server re-derives today's colours
   * and re-computes the total from these guesses, so the number that lands on
   * the board is one this browser could not have chosen. Everything shown after
   * a success is the server's answer, not the local one.
   */
  private async submitToBoard() {
    if (!this.dailyDone()) return
    const name = this.boardNameEl.value.trim()
    if (name.length < 2) { this.setBoardNote('Pick a name of at least 2 characters.', true); return }
    const btn = this.boardFormEl.querySelector('[data-action="submit-daily"]') as HTMLButtonElement
    btn.disabled = true
    btn.textContent = 'Sending…'
    try {
      const res = await fetch('/api/games/hue-hunt/daily', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day: this.daily.day, name, guesses: this.daily.guesses }),
      })
      const data = await res.json().catch(() => ({})) as Record<string, unknown>
      if (res.status === 409) {
        // UTC midnight passed between finishing the run and submitting it.
        this.newRound()
        void this.refreshBoard()
        this.setBoardNote("Midnight UTC rolled over — today's five are up. Play them and post that instead.")
        return
      }
      if (res.status === 429) { this.setBoardNote('Too many submissions — give it a minute.', true); return }
      if (!res.ok) { this.setBoardNote('The server would not accept that run.', true); return }

      // The stored name can differ from what was typed (spaces collapsed,
      // zero-widths stripped), and matching on the raw input would mean your own
      // row silently never highlights.
      this.boardName = typeof data.name === 'string' ? data.name : name
      this.submittedDay = this.daily.day
      this.save()
      this.syncDailyUI()
      this.renderLeaderboard(Array.isArray(data.entries) ? data.entries as unknown[] : [])
      const score = typeof data.score === 'number' ? data.score : this.dailyTotal()
      const rank = typeof data.rank === 'number' ? data.rank : null
      this.setBoardNote(
        data.keptPrevious === true
          ? `You already had a better run today — kept it.${rank ? ` You're #${rank}.` : ''}`
          : rank
            ? `${score}/${DAILY_MAX} — you're #${rank} today.`
            : `${score}/${DAILY_MAX} — today's board is full of sharper eyes. Tomorrow.`,
      )
    } catch {
      this.setBoardNote('Could not reach the board — try again shortly.', true)
    } finally {
      btn.disabled = false
      btn.textContent = 'Put me on the board'
    }
  }

  /* ── scoreboard ── */

  private renderScoreboard() {
    const bar = this.querySelector('[data-type="hue-scorebar"]') as HTMLElement
    bar.textContent = ''
    const done = this.dailyDone()
    // Which colour is on screen, not how many are banked: once a guess is in,
    // scores.length already counts the swatch still being looked at, so adding
    // one there would jump the counter a round ahead of the board.
    const shown = this.answered || done ? this.daily.scores.length : this.daily.scores.length + 1
    const stats: [string, string][] =
      this.mode === 'daily'
        ? [
            ['Colour', `${Math.min(shown, DAILY_ROUNDS)}/${DAILY_ROUNDS}`],
            [done ? 'Today' : 'Score so far', done ? `${this.dailyTotal()}/${DAILY_MAX}` : String(this.dailyTotal())],
            ['Best day', this.bestDaily ? `${this.bestDaily}` : '—'],
            ['Day streak', String(this.dayStreak)],
          ]
      : this.mode === 'pick'
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
    // The on-screen hint says N jumps to the next colour, with no "once you've
    // answered" caveat — so it does, answered or not (skipping forfeits the round).
    if ((e.key === 'n' || e.key === 'N') && !inInput) {
      // In the endless modes N is a skip. The daily has none — one attempt at
      // each of the five shared colours is the whole point — so there it only
      // advances a colour that has already been answered.
      if (this.mode === 'daily' && !this.answered) return
      e.preventDefault()
      this.newRound()
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

export {}
