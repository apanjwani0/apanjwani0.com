/**
 * Type Trial — a minimalist typing speed test.
 *
 * Pure DOM + a single transparent input, no dependencies. The timer starts on
 * the first keystroke; net WPM is (correct chars / 5) ÷ minutes and accuracy is
 * correct ÷ typed. Each category (daily / quotes / code / numbers) keeps its own
 * personal best, remembered locally, and a finished run produces a shareable
 * one-line result. Mounts as a WebComponent so it survives Astro's client-side
 * View Transitions. Surfaced as a game at /games/type-trial.
 *
 * DAILY RACE: the Daily tab races one shared passage per UTC day — everyone on
 * the site gets the same text (src/lib/type-trial-daily.ts, shared with the
 * server) — and a finished run can be submitted by name to a server-side daily
 * leaderboard (/api/games/type-trial/daily). Practice categories stay entirely
 * local; only a daily submission you explicitly send leaves the browser, and it
 * carries just a display name and the score.
 *
 * GHOST RACES: a finished run can mint a #ghost= permalink (see ./ghost.ts for
 * the format and its bounds). Opening one replays the sender's per-character
 * timings as a second caret racing over the same passage — the token rides in
 * the URL fragment, so it never reaches server logs, and nothing about a ghost
 * involves the server at all.
 */
import { dailyPassage, msUntilUtcMidnight, todayUtcDay } from '../../../lib/type-trial-daily'
import { recordDailyPlay, utcDayFromDateString } from '../../../lib/daily-streak'
import { flashLabel } from '../../../lib/flash'
import {
  decodeGhostToken,
  encodeGhostToken,
  ghostDurationMs,
  ghostProgressAt,
  ghostWpm,
  verifyGhostPassage,
  type DecodedGhost,
} from './ghost'

type Category = 'daily' | 'quotes' | 'code' | 'numbers'

const CATEGORIES: { id: Category; name: string }[] = [
  { id: 'daily', name: 'Daily' },
  { id: 'quotes', name: 'Quotes' },
  { id: 'code', name: 'Code' },
  { id: 'numbers', name: 'Numbers' },
]

/* Curated prompts. Quotes are original aphorisms (no real-person attribution),
   code is short single-line snippets, numbers mix digits and symbols. The daily
   passage is NOT here — it comes from the shared lib so server validation and
   every visitor's browser agree on the day's text. */
const TEXTS: Record<Exclude<Category, 'daily'>, string[]> = {
  quotes: [
    'The best way to predict the future is to build a small piece of it today.',
    'Simplicity is the soul of efficiency, and clarity is the soul of simplicity.',
    'A project is never truly finished, only abandoned at a reasonable place to stop.',
    'Make it work, make it right, then make it fast, usually in exactly that order.',
    'Good code reads like a well told story with no wasted words and no surprises.',
    'The cost of a feature is paid not once, but every single day it is maintained.',
    'Slow is smooth, smooth is fast, and fast is rarely as fast as it first feels.',
    'Curiosity is the engine that turns a quiet afternoon into a finished project.',
    'Measure twice, ship once, and always keep a clean way to roll back if wrong.',
    'Every expert was once a beginner who simply refused to stop showing up daily.',
  ],
  code: [
    'const sum = (a, b) => a + b;',
    'for (let i = 0; i < arr.length; i++) total += arr[i];',
    'if (!user) throw new Error("not found");',
    'const data = await fetch(url).then((r) => r.json());',
    'export default function App() { return null; }',
    'arr.filter(Boolean).map((x) => x * 2).reduce((a, b) => a + b, 0);',
    'const { id, name = "anon" } = req.params;',
    'try { run(); } catch (err) { console.error(err); }',
  ],
  numbers: [
    '8675309 42 1024 256 64 128 3.14159 2.71828 16',
    '2026-06-16 09:41 $1,299.00 +3.5% -0.7% x12',
    '192.168.0.1 255.255.255.0 :8080 :443 :22 #404',
    '4 8 15 16 23 42 108 seed 90210 row 7 col 3',
  ],
}

/* Per-category personal bests. Bumped from the old single-best `…:pb:v1` key —
   each category now tracks its own best, so a slow Numbers run no longer hides a
   fast Quotes run (and vice versa). Old v1 data is simply left behind. */
const BESTS_KEY = 'type-trial:bests:v1'
/** Remembered leaderboard display name — so submitting is one click next time. */
const NAME_KEY = 'type-trial:name:v1'

/** Whole-string HTML escape for untrusted text (leaderboard names). */
function escText(s: string): string {
  return s.replace(/[&<>"']/g, escapeHtml)
}

function escapeHtml(ch: string): string {
  switch (ch) {
    case '&': return '&amp;'
    case '<': return '&lt;'
    case '>': return '&gt;'
    case '"': return '&quot;'
    case "'": return '&#39;'
    default: return ch
  }
}

function pick(arr: string[], avoid?: string): string {
  if (arr.length <= 1) return arr[0]
  let v = arr[Math.floor(Math.random() * arr.length)]
  let guard = 0
  while (v === avoid && guard++ < 8) v = arr[Math.floor(Math.random() * arr.length)]
  return v
}

function rankFor(wpm: number): string {
  if (wpm >= 120) return 'Inhuman'
  if (wpm >= 95) return 'Blazing'
  if (wpm >= 75) return 'Keyboard warrior'
  if (wpm >= 55) return 'Smooth operator'
  if (wpm >= 40) return 'Getting quick'
  if (wpm >= 25) return 'Warming up'
  return 'Just starting out'
}

function categoryName(id: Category): string {
  return CATEGORIES.find(c => c.id === id)?.name ?? id
}

interface Best { wpm: number; acc: number }
type Bests = Partial<Record<Category, Best>>

function loadBests(): Bests {
  try {
    const raw = localStorage.getItem(BESTS_KEY)
    if (!raw) return {}
    const v = JSON.parse(raw)
    if (!v || typeof v !== 'object') return {}
    const out: Bests = {}
    for (const c of CATEGORIES) {
      const b = (v as Record<string, unknown>)[c.id] as Partial<Best> | undefined
      if (b && typeof b.wpm === 'number') {
        out[c.id] = { wpm: b.wpm, acc: typeof b.acc === 'number' ? b.acc : 0 }
      }
    }
    return out
  } catch { /* ignore storage errors */ }
  return {}
}

function saveBests(b: Bests): void {
  try { localStorage.setItem(BESTS_KEY, JSON.stringify(b)) } catch { /* ignore */ }
}

interface Stats { wpm: number; acc: number; sec: number; correct: number; typedLen: number }

class TypeTrialTool extends HTMLElement {
  private category: Category = 'daily'
  private target = ''
  /** UTC day the current daily passage belongs to — refreshed on restart so a
   *  tab left open across midnight picks up the new race. */
  private dailyDay = todayUtcDay()
  /** Set after a successful submission so the board can highlight your row. */
  private submittedName: string | null = null
  private startedAt: number | null = null
  private finishedAt: number | null = null
  private finished = false
  // Elapsed-time accounting that pauses while the field is unfocused mid-run:
  // elapsedBeforePauseMs banks completed running segments; runningSince marks
  // the start of the current running segment (null while paused or stopped).
  private elapsedBeforePauseMs = 0
  private runningSince: number | null = null
  private tick = 0
  // Cumulative keystroke tally for accuracy: every character the user enters is
  // counted, and any that was wrong when typed is an error — so accuracy
  // reflects mistakes made even after they're backspaced and corrected.
  private typedCount = 0
  private errorCount = 0
  private prevLen = 0
  /** Set when a single input event advanced the value by more than one character. */
  private jumped = false
  /** Ghost recording: elapsed ms at which the correct prefix first reached each
   *  length. Monotonic by construction (a mark is taken once, on first reach). */
  private marks: number[] = []
  /** The ghost being raced, when the page was opened via a #ghost= link. */
  private ghost: DecodedGhost | null = null

  private input!: HTMLInputElement
  private textEl!: HTMLElement
  private resultEl!: HTMLElement
  private shareBtn!: HTMLButtonElement
  private bestEl!: HTMLElement
  private resetBtn!: HTMLButtonElement
  private dailyEl!: HTMLElement
  private dailyMetaEl!: HTMLElement
  private dailyFormEl!: HTMLFormElement
  private dailyNameEl!: HTMLInputElement
  private dailyNoteEl!: HTMLElement
  private dailyBoardEl!: HTMLElement
  private ghostBannerEl!: HTMLElement
  private ghostTextEl!: HTMLElement
  private ghostLinkBtn!: HTMLButtonElement

  /** Bound once so add/removeEventListener pair up across the element's life. */
  private onHashChange = () => { this.loadGhostFromHash(true) }

  /** The passage for the current category (daily = the shared UTC-day text). */
  private passageFor(avoid?: string): string {
    if (this.category === 'daily') {
      this.dailyDay = todayUtcDay()
      return dailyPassage(this.dailyDay)
    }
    return pick(TEXTS[this.category], avoid)
  }

  connectedCallback() {
    this.target = this.passageFor()

    this.innerHTML = `
      <div data-type="tool-page" data-tool="type-trial">
        <div data-type="tool-header">
          <h1>Type Trial</h1>
          <p>How fast can you type? The Daily tab races one shared passage — same text for everyone, new at midnight UTC — with a leaderboard you can join by name. Practice categories stay entirely in your browser, and any finished run can mint a ghost link: whoever opens it races your keystrokes, replayed live.</p>
        </div>

        <div data-group="categories" role="group" aria-label="Category">
          ${CATEGORIES.map(c => `<button data-cat="${c.id}" type="button">${c.name}</button>`).join('')}
        </div>

        <p data-type="tt-ghost" role="status" aria-live="polite" hidden>
          <span data-type="tt-ghost-text"></span>
          <button data-action="exit-ghost" type="button">Exit ghost race</button>
        </p>

        <div data-type="tt-stage" role="textbox" aria-label="Typing area — click and type the text shown">
          <div data-type="tt-text"></div>
          <input
            data-type="tt-input"
            type="text"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            aria-label="Type the text shown above"
          />
          <div data-type="tt-overlay" hidden><span>Click to focus and keep typing</span></div>
        </div>

        <div data-type="tt-stats" aria-live="off">
          <div data-stat><span data-type="tt-val" data-k="wpm">0</span><span data-type="tt-lbl">wpm</span></div>
          <div data-stat><span data-type="tt-val" data-k="acc">100</span><span data-type="tt-lbl">% acc</span></div>
          <div data-stat><span data-type="tt-val" data-k="time">0.0</span><span data-type="tt-lbl">sec</span></div>
        </div>

        <div data-type="tt-result" role="status" aria-live="polite" hidden></div>

        <div data-group="actions">
          <button data-action="restart" type="button" aria-keyshortcuts="Escape">Restart</button>
          <button data-action="new" type="button">New text</button>
          <button data-action="share" type="button" hidden>Copy result</button>
          <button data-action="ghost-link" type="button" hidden>Copy ghost link</button>
          <span data-type="tt-hint" aria-hidden="true">Esc to restart</span>
        </div>

        <p data-type="tt-best">
          <span data-type="tt-best-text"></span>
          <button data-action="reset-best" type="button" hidden>Reset</button>
        </p>

        <section data-type="tt-daily" hidden aria-label="Daily leaderboard">
          <h2>Today's leaderboard</h2>
          <p data-type="tt-daily-meta"></p>
          <form data-type="tt-daily-form" hidden>
            <label>
              <span>Name for the board</span>
              <input
                data-type="tt-daily-name"
                type="text"
                minlength="2"
                maxlength="24"
                required
                autocomplete="nickname"
                spellcheck="false"
                placeholder="e.g. swift-fox"
              />
            </label>
            <button data-action="submit-daily" type="submit">Submit score</button>
          </form>
          <p data-type="tt-daily-note" role="status" aria-live="polite" hidden></p>
          <ol data-type="tt-daily-board"></ol>
        </section>
      </div>
    `

    this.input = this.querySelector('[data-type="tt-input"]') as HTMLInputElement
    this.textEl = this.querySelector('[data-type="tt-text"]') as HTMLElement
    this.resultEl = this.querySelector('[data-type="tt-result"]') as HTMLElement
    this.shareBtn = this.querySelector('[data-action="share"]') as HTMLButtonElement
    this.bestEl = this.querySelector('[data-type="tt-best-text"]') as HTMLElement
    this.resetBtn = this.querySelector('[data-action="reset-best"]') as HTMLButtonElement
    this.dailyEl = this.querySelector('[data-type="tt-daily"]') as HTMLElement
    this.dailyMetaEl = this.querySelector('[data-type="tt-daily-meta"]') as HTMLElement
    this.dailyFormEl = this.querySelector('[data-type="tt-daily-form"]') as HTMLFormElement
    this.dailyNameEl = this.querySelector('[data-type="tt-daily-name"]') as HTMLInputElement
    this.dailyNoteEl = this.querySelector('[data-type="tt-daily-note"]') as HTMLElement
    this.dailyBoardEl = this.querySelector('[data-type="tt-daily-board"]') as HTMLElement
    this.ghostBannerEl = this.querySelector('[data-type="tt-ghost"]') as HTMLElement
    this.ghostTextEl = this.querySelector('[data-type="tt-ghost-text"]') as HTMLElement
    this.ghostLinkBtn = this.querySelector('[data-action="ghost-link"]') as HTMLButtonElement

    this.wire()
    this.renderText()
    this.renderStats({ wpm: 0, acc: 100, sec: 0, correct: 0, typedLen: 0 })
    this.renderBest()
    this.syncCategoryUI()
    this.syncDailyUI()
    // A #ghost= link opened while the page is already mounted (in-site nav back
    // to the game, or a link clicked in the same tab) must load without a
    // reload — the same lesson the Webhook Inspector share card learned.
    window.addEventListener('hashchange', this.onHashChange)
    this.loadGhostFromHash(false)
    requestAnimationFrame(() => this.input.focus({ preventScroll: true }))
  }

  disconnectedCallback() {
    this.stopTick()
    window.removeEventListener('hashchange', this.onHashChange)
  }

  private wire() {
    this.input.addEventListener('input', this.onInput)
    this.input.addEventListener('keydown', this.onKeydown)
    this.input.addEventListener('focus', this.onFocus)
    this.input.addEventListener('blur', this.onBlur)
    // A typing test must measure *typing*: block paste and drag-drop so the
    // answer can't be dumped in instantly, which would record a meaningless
    // (effectively infinite) WPM as the personal best.
    this.input.addEventListener('paste', this.onPasteOrDrop)
    this.input.addEventListener('drop', this.onPasteOrDrop)

    const stage = this.querySelector('[data-type="tt-stage"]') as HTMLElement
    stage.addEventListener('mousedown', (e) => {
      // Keep the transparent input focused without losing the click target.
      if (e.target !== this.input) {
        e.preventDefault()
        this.input.focus({ preventScroll: true })
      }
    })

    this.querySelectorAll('[data-cat]').forEach(btn =>
      btn.addEventListener('click', () => {
        const cat = (btn as HTMLElement).dataset.cat as Category
        // Picking a category is a deliberate step out of a ghost race — the
        // ghost is pinned to one passage, so any category click clears it and
        // re-syncs the whole panel state (daily board, New button, banner).
        if (this.ghost) { this.category = cat; this.exitGhost(); return }
        if (cat === this.category) { this.restart(true); return }
        this.category = cat
        this.syncCategoryUI()
        this.renderBest()
        this.syncDailyUI()
        this.restart(true)
      }),
    )

    this.querySelector('[data-action="restart"]')!.addEventListener('click', () => this.restart(false))
    this.querySelector('[data-action="new"]')!.addEventListener('click', () => this.restart(true))
    this.shareBtn.addEventListener('click', (e) => this.copyResult(e))
    this.ghostLinkBtn.addEventListener('click', (e) => { void this.copyGhostLink(e) })
    this.querySelector('[data-action="exit-ghost"]')!.addEventListener('click', () => this.exitGhost())
    this.dailyFormEl.addEventListener('submit', (e) => {
      e.preventDefault()
      void this.submitDaily()
    })
    this.resetBtn.addEventListener('click', () => {
      // Clear only the active category's best, leaving the others intact.
      const m = loadBests()
      delete m[this.category]
      saveBests(m)
      this.renderBest()
    })
  }

  private onKeydown = (e: KeyboardEvent) => {
    // Esc restarts the current passage. Tab is intentionally NOT intercepted so
    // it keeps its normal focus-navigation behaviour (accessibility); the
    // visible "New text" button is the way to load a fresh passage.
    if (e.key === 'Escape') {
      e.preventDefault()
      this.restart(false)
    }
  }

  private onFocus = () => {
    const overlay = this.querySelector('[data-type="tt-overlay"]') as HTMLElement
    overlay.hidden = true
    ;(this.querySelector('[data-type="tt-stage"]') as HTMLElement).dataset.focused = ''
    // Resume the clock if a run is in progress but was paused when focus was lost.
    if (this.startedAt !== null && !this.finished && this.runningSince === null) {
      this.runningSince = performance.now()
      this.startTick()
    }
  }

  private onBlur = () => {
    const stage = this.querySelector('[data-type="tt-stage"]') as HTMLElement
    delete stage.dataset.focused
    // Only act mid-run, not before the run starts or once it's done.
    if (this.startedAt !== null && !this.finished) {
      // Pause the clock: bank the running segment so time spent unfocused (while
      // the "click to focus" overlay is up and the user can't type) isn't counted.
      if (this.runningSince !== null) {
        this.elapsedBeforePauseMs += performance.now() - this.runningSince
        this.runningSince = null
      }
      this.stopTick()
      ;(this.querySelector('[data-type="tt-overlay"]') as HTMLElement).hidden = false
    }
  }

  private onPasteOrDrop = (e: Event) => {
    e.preventDefault()
  }

  private onInput = () => {
    if (this.finished) {
      this.input.value = this.input.value.slice(0, this.target.length)
      return
    }
    if (this.input.value.length > this.target.length) {
      this.input.value = this.input.value.slice(0, this.target.length)
    }
    const starting = this.startedAt === null && this.input.value.length > 0
    // Reject an "instant fill" — a single input event that jumps from empty
    // straight to the full text (paste that slips the guard, browser autofill,
    // or a programmatic value set). A genuine run is typed key-by-key, so the
    // very first input event must never already complete the text; if it does,
    // elapsed time is ~0 and the WPM is nonsensical. Discard it and reset.
    if (starting && this.target.length > 1 && this.input.value.length === this.target.length) {
      this.input.value = ''
      this.prevLen = 0
      this.jumped = false
      this.renderText()
      this.renderStats({ wpm: 0, acc: 100, sec: 0, correct: 0, typedLen: 0 })
      return
    }
    if (starting) {
      this.startedAt = performance.now()
      this.elapsedBeforePauseMs = 0
      this.runningSince = this.startedAt
      this.startTick()
    }
    // Tally any newly-entered characters for accuracy (additions only; a
    // backspace lowers the length and isn't counted, but the earlier error was
    // — so corrected mistakes still cost accuracy, as in MonkeyType).
    const len = this.input.value.length
    // One input event may add at most one character to a typed run. More than
    // that is a value jump, not typing: the run still plays, but it no longer
    // mints a ghost, claims a personal best, or reaches the daily board.
    if (!starting && len - this.prevLen > 1) this.jumped = true
    for (let i = this.prevLen; i < len; i++) {
      this.typedCount++
      if (this.input.value[i] !== this.target[i]) this.errorCount++
    }
    this.prevLen = len
    // Ghost recording: note when the correct prefix first reaches each length.
    // Backspacing can shrink the prefix again, but a mark is taken only once,
    // on first reach, so the timeline stays monotonic (ghost.ts relies on it).
    let prefix = 0
    const val = this.input.value
    while (prefix < val.length && val[prefix] === this.target[prefix]) prefix++
    if (this.marks.length < prefix) {
      const at = this.elapsed()
      while (this.marks.length < prefix) this.marks.push(at)
    }
    this.renderText()
    // Finish only when the passage has been entered in full AND correctly. A
    // wrong or final keystroke no longer ends the run, so the user can backspace
    // and fix any character (including the last one) before completing.
    if (this.input.value === this.target) {
      this.finish()
    } else {
      this.renderStats(this.computeStats())
    }
  }

  /** Total run time, excluding any spans the field was unfocused mid-run. */
  private elapsed(now = performance.now()): number {
    return this.elapsedBeforePauseMs + (this.runningSince !== null ? now - this.runningSince : 0)
  }

  private computeStats(): Stats {
    const typed = this.input.value
    let correct = 0
    for (let i = 0; i < typed.length; i++) {
      if (typed[i] === this.target[i]) correct++
    }
    const elapsedMs = this.elapsed(this.finishedAt ?? performance.now())
    const minutes = elapsedMs / 60000
    // Hold WPM at 0 for the first second. With a tiny denominator the figure
    // spikes into the hundreds/thousands on the opening keystrokes — which both
    // looks broken live and would let a near-instant completion post a bogus
    // score. Real runs of these texts always take well over a second.
    const wpm = elapsedMs >= 1000 ? Math.round((correct / 5) / minutes) : 0
    // Accuracy = correct keystrokes / total keystrokes entered, so it reflects
    // every mistake made over the run, not just the final on-screen state.
    const acc = this.typedCount
      ? Math.round(((this.typedCount - this.errorCount) / this.typedCount) * 100)
      : 100
    return { wpm, acc, sec: elapsedMs / 1000, correct, typedLen: typed.length }
  }

  private renderText() {
    const typed = this.input.value
    const t = this.target
    const gpos = this.ghostPos()
    let html = ''
    for (let i = 0; i < t.length; i++) {
      // A plain space, not &nbsp; — pre-wrap already preserves it, and a
      // no-break space leaves the line breaker no legal break at word
      // boundaries, so every wrap lands mid-word.
      const display = escapeHtml(t[i])
      const classes: string[] = []
      if (i < typed.length) classes.push(typed[i] === t[i] ? 'ok' : 'bad')
      if (i === typed.length && !this.finished) classes.push('caret')
      const cls = classes.length ? ` data-s="${classes.join(' ')}"` : ''
      // The ghost caret is a separate attribute so it can share a character
      // with the user's caret without either marker displacing the other.
      const g = i === gpos ? ' data-g' : ''
      html += `<span${cls}${g}>${display}</span>`
    }
    this.textEl.innerHTML = html
  }

  /** Where the ghost caret sits right now, or -1 for no marker. The ghost
   *  starts with the visitor's first keystroke and pauses when the clock
   *  pauses — it races elapsed typing time, not wall time. */
  private ghostPos(): number {
    if (!this.ghost || this.finished) return -1
    if (this.startedAt === null) return 0
    const pos = ghostProgressAt(this.ghost.marks, this.elapsed())
    return pos < this.target.length ? pos : -1
  }

  private renderStats(s: Stats) {
    ;(this.querySelector('[data-k="wpm"]') as HTMLElement).textContent = String(s.wpm)
    ;(this.querySelector('[data-k="acc"]') as HTMLElement).textContent = String(s.acc)
    ;(this.querySelector('[data-k="time"]') as HTMLElement).textContent = s.sec.toFixed(1)
  }

  private renderBest() {
    const best = loadBests()[this.category] ?? null
    const name = categoryName(this.category)
    this.bestEl.textContent = best
      ? `${name} best: ${best.wpm} wpm · ${best.acc}% accuracy`
      : `No ${name} best yet — finish a run to set one.`
    // Offer a reset only when this category actually has a stored best to clear.
    this.resetBtn.hidden = !best
  }

  private finish() {
    this.finished = true
    this.finishedAt = performance.now()
    // Bank the final running segment so elapsed time is exact up to completion.
    if (this.runningSince !== null) {
      this.elapsedBeforePauseMs += this.finishedAt - this.runningSince
      this.runningSince = null
    }
    this.stopTick()
    this.renderText()

    const s = this.computeStats()
    this.renderStats(s)

    const bests = loadBests()
    const prev = bests[this.category] ?? null
    // Only record a personal best from a plausibly-timed run. A sub-second
    // completion means the text wasn't actually typed (autofill or a stray
    // programmatic fill that slipped past the paste/instant-fill guards), so
    // its WPM is meaningless and must never be stored or shown as a new best.
    // …and a run whose value ever jumped by more than one character in a single
    // input event was not typed either, however long it took. That guard used
    // to fire only on the FIRST event of a run, so a mid-run jump (an IME
    // committing several characters, a programmatic set) back-filled every
    // newly-reached ghost mark with one identical timestamp — minting a ghost
    // that teleports through a run of characters in zero time, which
    // `encodeGhostToken` accepts because the marks are still monotonic.
    const plausible = s.sec >= 1 && !this.jumped
    const isBest = plausible && s.wpm > 0 && (!prev || s.wpm > prev.wpm)
    // How much this run beat the previous category best by (only when there was one).
    const gain = isBest && prev ? s.wpm - prev.wpm : 0
    if (isBest) {
      bests[this.category] = { wpm: s.wpm, acc: s.acc }
      saveBests(bests)
    }

    const rank = rankFor(s.wpm)
    const bestNote = isBest
      ? ` · new ${categoryName(this.category)} best!${gain > 0 ? ` +${gain} wpm` : ''}`
      : ''
    // Same passage, both fully correct — so elapsed time decides the race.
    let ghostLine = ''
    if (this.ghost) {
      const gMs = ghostDurationMs(this.ghost.marks)
      const myMs = Math.round(s.sec * 1000)
      const gap = (Math.abs(myMs - gMs) / 1000).toFixed(1)
      ghostLine = myMs < gMs
        ? `<p data-type="tt-ghost-result">You beat the ghost by ${gap}s.</p>`
        : myMs > gMs
          ? `<p data-type="tt-ghost-result">The ghost wins by ${gap}s — race it again.</p>`
          : `<p data-type="tt-ghost-result">Dead heat with the ghost.</p>`
    }
    this.resultEl.hidden = false
    this.resultEl.innerHTML = `
      <p data-type="tt-rank">${rank}${bestNote}</p>
      ${ghostLine}
      <p data-type="tt-summary">
        <strong>${s.wpm}</strong> wpm &nbsp;·&nbsp; <strong>${s.acc}%</strong> accuracy &nbsp;·&nbsp; ${s.sec.toFixed(1)}s
      </p>
    `
    ;(this.querySelector('[data-type="tt-stage"]') as HTMLElement).dataset.done = ''
    this.shareBtn.hidden = false
    this.shareBtn.textContent = 'Copy result'
    // A run whose every character got a mark can be replayed as a ghost.
    this.ghostLinkBtn.hidden = !(plausible && s.wpm > 0 && this.marks.length === this.target.length)
    this.renderBest()
    this.input.blur()
    this.lastResult = s

    // A plausible daily finish unlocks the leaderboard form (name remembered) —
    // but never against a past day's ghost passage, which today's server-derived
    // text would rightly refuse anyway.
    if (this.category === 'daily' && plausible && s.wpm > 0 && !this.ghostDailyIsStale()) {
      // Same gate as the leaderboard unlock on purpose: a finished, plausibly
      // typed run of TODAY's passage is what "played the daily" means. Feeds
      // the /games hub streak strip (src/lib/daily-streak.ts); local only.
      recordDailyPlay('type-trial', utcDayFromDateString(todayUtcDay()))
      this.dailyNameEl.value = this.loadName()
      this.dailyFormEl.hidden = false
      this.setDailyNote('')
    }
  }

  private lastResult: Stats | null = null

  private restart(newText: boolean) {
    // Daily always re-derives the day's passage (a tab left open across UTC
    // midnight must pick up the new race); other categories draw a fresh text
    // only when asked. A ghost pins its own passage — even a past day's — so
    // restarting a ghost race never swaps the text out from under it.
    if (this.ghost) { /* keep this.target — it is the ghost's passage */ }
    else if (this.category === 'daily') this.target = this.passageFor()
    else if (newText) this.target = pick(TEXTS[this.category], this.target)
    this.input.value = ''
    this.startedAt = null
    this.finishedAt = null
    this.finished = false
    this.elapsedBeforePauseMs = 0
    this.runningSince = null
    this.lastResult = null
    this.typedCount = 0
    this.errorCount = 0
    this.prevLen = 0
    this.jumped = false
    this.marks = []
    this.stopTick()

    const stage = this.querySelector('[data-type="tt-stage"]') as HTMLElement
    delete stage.dataset.done
    ;(this.querySelector('[data-type="tt-overlay"]') as HTMLElement).hidden = true
    this.resultEl.hidden = true
    this.resultEl.innerHTML = ''
    this.shareBtn.hidden = true
    this.ghostLinkBtn.hidden = true
    this.dailyFormEl.hidden = true
    if (this.category === 'daily' && !this.ghostDailyIsStale()) this.renderDailyMeta()
    this.renderGhostBanner()

    this.renderText()
    this.renderStats({ wpm: 0, acc: 100, sec: 0, correct: 0, typedLen: 0 })
    this.input.focus({ preventScroll: true })
  }

  private syncCategoryUI() {
    this.querySelectorAll('[data-cat]').forEach(btn => {
      const el = btn as HTMLElement
      if (el.dataset.cat === this.category) el.setAttribute('data-active', '')
      else el.removeAttribute('data-active')
    })
  }

  private startTick() {
    this.stopTick()
    this.tick = window.setInterval(() => {
      if (!this.finished) {
        this.renderStats(this.computeStats())
        // The ghost caret advances with the clock, not with keystrokes.
        if (this.ghost) {
          this.renderText()
          this.renderGhostBanner()
        }
      }
    }, 100)
  }

  private stopTick() {
    if (this.tick) {
      clearInterval(this.tick)
      this.tick = 0
    }
  }

  /* ── Daily race: shared passage + server leaderboard ───── */

  private loadName(): string {
    try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' }
  }

  private saveName(name: string): void {
    try { localStorage.setItem(NAME_KEY, name) } catch { /* ignore */ }
  }

  private setDailyNote(text: string): void {
    this.dailyNoteEl.textContent = text
    this.dailyNoteEl.hidden = !text
  }

  /** Show/hide the daily panel; "New text" makes no sense on a fixed passage.
   *  A ghost from a PAST day hides the panel entirely — today's board and
   *  countdown would be about a different passage than the one on screen. */
  private syncDailyUI(): void {
    const daily = this.category === 'daily' && !this.ghostDailyIsStale()
    this.dailyEl.hidden = !daily
    ;(this.querySelector('[data-action="new"]') as HTMLElement).hidden =
      this.category === 'daily' || this.ghost !== null
    if (daily) {
      this.renderDailyMeta()
      void this.refreshBoard()
    }
  }

  private renderDailyMeta(): void {
    const ms = msUntilUtcMidnight()
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    const left = h > 0 ? `${h}h ${m}m` : `${m}m`
    this.dailyMetaEl.textContent = `Everyone races the same passage today (${this.dailyDay} UTC). New text in ${left}.`
  }

  private async refreshBoard(): Promise<void> {
    try {
      const res = await fetch('/api/games/type-trial/daily', { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json() as { entries?: unknown }
      this.renderBoard(Array.isArray(data.entries) ? data.entries : [])
    } catch {
      this.dailyBoardEl.innerHTML = ''
      this.setDailyNote('Leaderboard unavailable right now — your runs still count locally.')
    }
  }

  /** Render the top of the board. Names are user-supplied strings from the
   *  server — escaped here, at the render site, before touching innerHTML. */
  private renderBoard(entries: unknown[]): void {
    const you = (this.submittedName ?? '').toLowerCase()
    const rows = entries.slice(0, 10).map((e, i) => {
      const v = (e ?? {}) as Record<string, unknown>
      const name = typeof v.name === 'string' ? v.name : '?'
      const wpm = typeof v.wpm === 'number' ? Math.round(v.wpm) : 0
      const acc = typeof v.acc === 'number' ? Math.round(v.acc) : 0
      const yours = you && name.toLowerCase() === you ? ' data-you' : ''
      return `<li${yours}><span data-type="tt-lb-rank">${i + 1}</span><span data-type="tt-lb-name">${escText(name)}</span><span data-type="tt-lb-score">${wpm} wpm · ${acc}%</span></li>`
    })
    this.dailyBoardEl.innerHTML = rows.join('')
    if (!rows.length) this.setDailyNote('No entries yet today — finish a run and be first on the board.')
  }

  private async submitDaily(): Promise<void> {
    if (!this.lastResult || this.category !== 'daily') return
    const s = this.lastResult
    const name = this.dailyNameEl.value.trim()
    if (name.length < 2) { this.setDailyNote('Pick a name of at least 2 characters.'); return }
    const btn = this.dailyFormEl.querySelector('[data-action="submit-daily"]') as HTMLButtonElement
    btn.disabled = true
    btn.textContent = 'Submitting…'
    try {
      const res = await fetch('/api/games/type-trial/daily', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          day: this.dailyDay,
          name,
          wpm: s.wpm,
          acc: s.acc,
          sec: Math.round(s.sec * 10) / 10,
        }),
      })
      const data = await res.json().catch(() => ({})) as Record<string, unknown>
      if (res.status === 409) {
        // UTC midnight passed between rendering the passage and submitting.
        this.setDailyNote('Midnight UTC rolled over mid-run — a fresh passage is up. Race it!')
        this.restart(true)
        return
      }
      if (res.status === 429) { this.setDailyNote('Too many submissions — give it a minute.'); return }
      if (!res.ok) { this.setDailyNote('That score did not validate on the server.'); return }
      // Highlight your own row using the name the SERVER stored — sanitizing can
      // change what was typed (collapsed spaces, stripped zero-widths), and
      // matching on the raw input would silently never highlight anything.
      this.submittedName = typeof data.name === 'string' ? data.name : name
      this.saveName(this.submittedName)
      this.dailyFormEl.hidden = true
      this.renderBoard(Array.isArray(data.entries) ? data.entries as unknown[] : [])
      const rank = typeof data.rank === 'number' ? data.rank : null
      const kept = data.keptPrevious === true
      this.setDailyNote(
        kept
          ? `Your earlier run today still ranks higher — kept it.${rank ? ` You're #${rank}.` : ''}`
          : rank
            ? `On the board — you're #${rank} today.`
            : "Submitted — today's board is full of faster runs, keep chasing.",
      )
    } catch {
      this.setDailyNote('Could not reach the leaderboard — try again shortly.')
    } finally {
      btn.disabled = false
      btn.textContent = 'Submit score'
    }
  }

  /* ── Ghost races: #ghost= permalinks (see ./ghost.ts) ───── */

  /** Sticky banner message when a link failed to load (bad token, changed text). */
  private ghostNote: string | null = null

  /** True when racing a daily ghost from a day that is no longer today. */
  private ghostDailyIsStale(): boolean {
    return this.ghost !== null && this.ghost.kind === 'daily' && this.ghost.day !== todayUtcDay()
  }

  /** The passage a decoded ghost claims to be about, or null if unresolvable.
   *  The fingerprint check (verifyGhostPassage) is what makes the answer safe —
   *  an index into an edited pool resolves to the WRONG text, and fails there. */
  private resolveGhostPassage(g: DecodedGhost): string | null {
    if (g.kind === 'daily') return g.day ? dailyPassage(g.day) : null
    return TEXTS[g.kind][g.index] ?? null
  }

  private loadGhostFromHash(fromEvent: boolean): void {
    const m = /[#&]ghost=([^&]+)/.exec(location.hash)
    if (!m) {
      // Fragment removed while mounted (back button) — drop out of ghost mode.
      if (fromEvent && this.ghost) this.exitGhost(false)
      return
    }
    const g = decodeGhostToken(m[1])
    if (!g) {
      this.ghost = null
      this.ghostNote = 'That ghost link is malformed or truncated — ask for a fresh one.'
      this.renderGhostBanner()
      return
    }
    const passage = this.resolveGhostPassage(g)
    if (!passage || !verifyGhostPassage(g, passage)) {
      this.ghost = null
      this.ghostNote = "That ghost's text is no longer on the site — the passage changed since the link was minted."
      this.renderGhostBanner()
      return
    }
    this.ghostNote = null
    this.ghost = g
    this.category = g.kind
    if (g.kind === 'daily' && g.day) this.dailyDay = g.day
    this.target = passage
    this.syncCategoryUI()
    this.renderBest()
    this.syncDailyUI()
    this.restart(false)
  }

  private renderGhostBanner(): void {
    if (this.ghostNote) {
      this.ghostTextEl.textContent = this.ghostNote
      this.ghostBannerEl.hidden = false
      return
    }
    if (!this.ghost) {
      this.ghostBannerEl.hidden = true
      return
    }
    const dur = ghostDurationMs(this.ghost.marks)
    const wpm = ghostWpm(this.ghost.marks.length, dur)
    const label = this.ghost.kind === 'daily' ? `daily ${this.ghost.day}` : categoryName(this.ghost.kind)
    const done = this.startedAt !== null && !this.finished
      && ghostProgressAt(this.ghost.marks, this.elapsed()) >= this.target.length
    this.ghostTextEl.textContent = done
      ? `The ghost finished in ${(dur / 1000).toFixed(1)}s — keep going and log your own time.`
      : `Ghost race (${label}): ${wpm} wpm · ${this.ghost.acc}% acc · ${(dur / 1000).toFixed(1)}s. It starts with your first keystroke.`
    this.ghostBannerEl.hidden = false
  }

  /** Forget the ghost and drop the fragment — no restart, callers decide. */
  private clearGhost(dropHash = true): void {
    this.ghost = null
    this.ghostNote = null
    this.ghostBannerEl.hidden = true
    this.dailyDay = todayUtcDay()
    if (dropHash && /[#&]ghost=/.test(location.hash)) {
      history.replaceState(null, '', location.pathname + location.search)
    }
  }

  private exitGhost(dropHash = true): void {
    this.clearGhost(dropHash)
    this.syncCategoryUI()
    this.renderBest()
    this.syncDailyUI()
    this.restart(true)
  }

  /** Token for the run just finished, or null when it cannot be replayed
   *  (practice text no longer in its list, or the encoder's bounds refuse it). */
  private mintGhostToken(): string | null {
    if (!this.lastResult || this.marks.length !== this.target.length) return null
    if (this.category === 'daily') {
      return encodeGhostToken({
        kind: 'daily', day: this.dailyDay, index: 0,
        passage: this.target, acc: this.lastResult.acc, marks: this.marks,
      })
    }
    const index = TEXTS[this.category].indexOf(this.target)
    if (index < 0) return null
    return encodeGhostToken({
      kind: this.category, day: null, index,
      passage: this.target, acc: this.lastResult.acc, marks: this.marks,
    })
  }

  private async copyGhostLink(e: Event): Promise<void> {
    const btn = e.currentTarget as HTMLButtonElement
    const token = this.mintGhostToken()
    if (!token) { flashLabel(btn, 'Unavailable'); return }
    const url = `${location.origin}${location.pathname}#ghost=${token}`
    try {
      await navigator.clipboard.writeText(url)
      flashLabel(btn, 'Link copied!')
    } catch {
      flashLabel(btn, 'Copy failed')
    }
  }

  private async copyResult(e: Event) {
    if (!this.lastResult) return
    const btn = e.currentTarget as HTMLButtonElement
    const s = this.lastResult
    const url = `${location.origin}${location.pathname}`
    // A run raced against a ghost carries the verdict into the share text —
    // same arithmetic as the on-page ghost-result line (same passage, both
    // fully correct, so elapsed time decides it).
    let ghostClause = ''
    if (this.ghost) {
      const gMs = ghostDurationMs(this.ghost.marks)
      const myMs = Math.round(s.sec * 1000)
      const gap = (Math.abs(myMs - gMs) / 1000).toFixed(1)
      ghostClause = myMs < gMs
        ? ` — and beat a ghost by ${gap}s`
        : myMs > gMs
          ? ` — a ghost beat me by ${gap}s`
          : ' — dead heat with a ghost'
    }
    const text = this.category === 'daily'
      ? `Type Trial daily ${this.dailyDay}: ${s.wpm} wpm at ${s.acc}% accuracy${ghostClause} — race the same passage at ${url}`
      : `I just typed ${s.wpm} wpm at ${s.acc}% accuracy on Type Trial${ghostClause} — beat me at ${url}`
    try {
      await navigator.clipboard.writeText(text)
      btn.textContent = 'Copied!'
    } catch {
      btn.textContent = 'Copy failed'
    }
    setTimeout(() => { btn.textContent = 'Copy result' }, 1400)
  }
}

if (!customElements.get('type-trial-game')) {
  customElements.define('type-trial-game', TypeTrialTool)
}

export {}
