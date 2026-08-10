/**
 * Type Trial — a minimalist typing speed test.
 *
 * Pure DOM + a single transparent input, no dependencies. The timer starts on
 * the first keystroke; net WPM is (correct chars / 5) ÷ minutes and accuracy is
 * correct ÷ typed. Each category (quotes / code / numbers) keeps its own personal
 * best, remembered locally (never uploaded), and a finished run produces a
 * shareable one-line result. Mounts as a WebComponent so it survives Astro's
 * client-side View Transitions. Surfaced as a game at /games/type-trial.
 */

type Category = 'quotes' | 'code' | 'numbers'

const CATEGORIES: { id: Category; name: string }[] = [
  { id: 'quotes', name: 'Quotes' },
  { id: 'code', name: 'Code' },
  { id: 'numbers', name: 'Numbers' },
]

/* Curated prompts. Quotes are original aphorisms (no real-person attribution),
   code is short single-line snippets, numbers mix digits and symbols. */
const TEXTS: Record<Category, string[]> = {
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
  private category: Category = 'quotes'
  private target = ''
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

  private input!: HTMLInputElement
  private textEl!: HTMLElement
  private resultEl!: HTMLElement
  private shareBtn!: HTMLButtonElement
  private bestEl!: HTMLElement
  private resetBtn!: HTMLButtonElement

  connectedCallback() {
    this.target = pick(TEXTS[this.category])

    this.innerHTML = `
      <div data-type="tool-page" data-tool="type-trial">
        <div data-type="tool-header">
          <h1>Type Trial</h1>
          <p>How fast can you type? Pick a category and start — the clock begins on your first keystroke. Everything runs in your browser; nothing is uploaded.</p>
        </div>

        <div data-group="categories" role="group" aria-label="Category">
          ${CATEGORIES.map(c => `<button data-cat="${c.id}" type="button">${c.name}</button>`).join('')}
        </div>

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
          <span data-type="tt-hint" aria-hidden="true">Esc to restart</span>
        </div>

        <p data-type="tt-best">
          <span data-type="tt-best-text"></span>
          <button data-action="reset-best" type="button" hidden>Reset</button>
        </p>
      </div>
    `

    this.input = this.querySelector('[data-type="tt-input"]') as HTMLInputElement
    this.textEl = this.querySelector('[data-type="tt-text"]') as HTMLElement
    this.resultEl = this.querySelector('[data-type="tt-result"]') as HTMLElement
    this.shareBtn = this.querySelector('[data-action="share"]') as HTMLButtonElement
    this.bestEl = this.querySelector('[data-type="tt-best-text"]') as HTMLElement
    this.resetBtn = this.querySelector('[data-action="reset-best"]') as HTMLButtonElement

    this.wire()
    this.renderText()
    this.renderStats({ wpm: 0, acc: 100, sec: 0, correct: 0, typedLen: 0 })
    this.renderBest()
    this.syncCategoryUI()
    requestAnimationFrame(() => this.input.focus({ preventScroll: true }))
  }

  disconnectedCallback() {
    this.stopTick()
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
        if (cat === this.category) { this.restart(true); return }
        this.category = cat
        this.syncCategoryUI()
        this.renderBest()
        this.restart(true)
      }),
    )

    this.querySelector('[data-action="restart"]')!.addEventListener('click', () => this.restart(false))
    this.querySelector('[data-action="new"]')!.addEventListener('click', () => this.restart(true))
    this.shareBtn.addEventListener('click', (e) => this.copyResult(e))
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
    for (let i = this.prevLen; i < len; i++) {
      this.typedCount++
      if (this.input.value[i] !== this.target[i]) this.errorCount++
    }
    this.prevLen = len
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
    let html = ''
    for (let i = 0; i < t.length; i++) {
      const display = t[i] === ' ' ? '&nbsp;' : escapeHtml(t[i])
      const classes: string[] = []
      if (i < typed.length) classes.push(typed[i] === t[i] ? 'ok' : 'bad')
      if (i === typed.length && !this.finished) classes.push('caret')
      const cls = classes.length ? ` data-s="${classes.join(' ')}"` : ''
      html += `<span${cls}>${display}</span>`
    }
    this.textEl.innerHTML = html
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
    const plausible = s.sec >= 1
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
    this.resultEl.hidden = false
    this.resultEl.innerHTML = `
      <p data-type="tt-rank">${rank}${bestNote}</p>
      <p data-type="tt-summary">
        <strong>${s.wpm}</strong> wpm &nbsp;·&nbsp; <strong>${s.acc}%</strong> accuracy &nbsp;·&nbsp; ${s.sec.toFixed(1)}s
      </p>
    `
    ;(this.querySelector('[data-type="tt-stage"]') as HTMLElement).dataset.done = ''
    this.shareBtn.hidden = false
    this.shareBtn.textContent = 'Copy result'
    this.renderBest()
    this.input.blur()
    this.lastResult = s
  }

  private lastResult: Stats | null = null

  private restart(newText: boolean) {
    if (newText) this.target = pick(TEXTS[this.category], this.target)
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
    this.stopTick()

    const stage = this.querySelector('[data-type="tt-stage"]') as HTMLElement
    delete stage.dataset.done
    ;(this.querySelector('[data-type="tt-overlay"]') as HTMLElement).hidden = true
    this.resultEl.hidden = true
    this.resultEl.innerHTML = ''
    this.shareBtn.hidden = true

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
      if (!this.finished) this.renderStats(this.computeStats())
    }, 100)
  }

  private stopTick() {
    if (this.tick) {
      clearInterval(this.tick)
      this.tick = 0
    }
  }

  private async copyResult(e: Event) {
    if (!this.lastResult) return
    const btn = e.currentTarget as HTMLButtonElement
    const s = this.lastResult
    const url = `${location.origin}${location.pathname}`
    const text = `I just typed ${s.wpm} wpm at ${s.acc}% accuracy on Type Trial — beat me at ${url}`
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
