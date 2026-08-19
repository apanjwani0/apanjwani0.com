/**
 * Cron Whisperer — a cron expression explainer that is honest about time zones.
 *
 * Paste a standard 5-field cron expression (or a 6-field one with a leading
 * seconds field, or an @nickname) and get, entirely client-side:
 *   1. A plain-English description in crontab.guru's phrasing style
 *      ("At 22:00 on every day-of-week from Monday through Friday.").
 *   2. The next N run times **in any IANA time zone** — the zone the server
 *      actually runs in, not just this browser's — each with a relative "in x".
 *   3. What daylight saving does to the schedule: which runs fall into an hour
 *      that never happens, which fall into one that happens twice, and what
 *      Vixie cron does about each.
 *   4. A per-field breakdown, a frequency read-out, and a shareable link.
 *
 * The parsing, the zone maths and the run iterator all live in ./schedule.ts so
 * `security:smoke` can assert them against the real tz database; this file is
 * the DOM shell. Preferences (zone, clock, runs to show) persist in
 * localStorage, and `#e=…&tz=…` carries an expression to a colleague without
 * either of you having a server involved. Press C to clear; Ctrl/Cmd+Enter
 * copies the description.
 *
 * Mounts as a WebComponent so it survives Astro's client-side View Transitions
 * (see the astro:page-load wiring in tools/[slug].astro). All module-level names
 * are cw-/CW_-prefixed because tool component files share one global script scope.
 */

import { escapeHtml } from '../../../lib/escape'
import { flashLabel } from '../../../lib/flash'
import {
  CW_FIELD_LABEL,
  CwZoneClock,
  cwCollectRuns,
  cwDescribe,
  cwDowName,
  cwFiringCount,
  cwIsFixedTime,
  cwMonthName,
  cwOffsetLabel,
  cwPad2,
  cwParse,
  cwZoneList,
  cwZoneValid,
  type CwField,
  type CwKind,
  type CwParsed,
  type CwRun,
  type CwTransition,
  type CwWall,
} from './schedule'

// ── Types ────────────────────────────────────────────────────────────────────

interface CwSettings {
  /** 'local' or an IANA id ('UTC', 'America/New_York', …). */
  zone: string
  hour12: boolean
  runs: number // 5 | 10 | 20
}

// ── Constants ────────────────────────────────────────────────────────────────

const CW_LS_EXPR = 'cron-whisperer:expr:v1'
const CW_LS_SETTINGS = 'cron-whisperer:settings:v1'

const CW_DEFAULTS: CwSettings = { zone: 'local', hour12: false, runs: 5 }

/** How far ahead the daylight-saving card looks. */
const CW_DST_HORIZON_MS = 400 * 86400_000
/** Window either side of a transition that is searched for affected runs. */
const CW_DST_WINDOW_MS = 6 * 3600_000

/** Longest `#e=` value accepted from a shared link. Real expressions are tiny. */
const CW_MAX_LINK_EXPR = 200

const CW_EXAMPLES: [string, string][] = [
  ['* * * * *', 'Every minute'],
  ['*/5 * * * *', 'Every 5 minutes'],
  ['*/15 * * * *', 'Every 15 minutes'],
  ['0 * * * *', 'Every hour, on the hour'],
  ['30 * * * *', 'Every hour at :30'],
  ['0 */2 * * *', 'Every 2 hours'],
  ['0 9 * * *', 'Every day at 09:00'],
  ['0 0 * * *', 'Every day at midnight'],
  ['30 2 * * *', '02:30 daily — the DST trap'],
  ['0 9 * * 1-5', '09:00 on weekdays'],
  ['0 22 * * 1-5', '22:00 on weekdays'],
  ['0 0 * * 0', 'Weekly — Sunday midnight'],
  ['0 0 1 * *', 'Monthly — 1st at midnight'],
  ['0 0 1 1 *', 'Yearly — Jan 1 at midnight'],
  ['*/15 9-17 * * 1-5', 'Every 15 min, 9–5, weekdays'],
  ['0 0 * * 6,0', 'Weekends at midnight'],
  ['@daily', 'Nickname — once a day'],
  ['@hourly', 'Nickname — once an hour'],
  ['@reboot', 'Nickname — at startup'],
]

// ── Display formatting ───────────────────────────────────────────────────────

/** The zone this device is in, for labelling the "local" option. */
function cwLocalZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'this device'
  } catch {
    return 'this device'
  }
}

/** A reusable formatter for run instants, resolved in `zone`. */
function cwRunFormatter(zone: string, hour12: boolean, withSeconds: boolean): Intl.DateTimeFormat {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12, timeZoneName: 'short',
  }
  if (withSeconds) opts.second = '2-digit'
  if (zone !== 'local') opts.timeZone = zone
  return new Intl.DateTimeFormat('en-US', opts)
}

/**
 * A formatter for a wall reading that has no instant — the spring-forward gap.
 * The fields are fed through a UTC formatter so the reading is printed exactly
 * as written rather than being quietly relocated to a time that does exist.
 */
function cwWallFormatter(hour12: boolean, withSeconds: boolean): (w: CwWall) => string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'UTC', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12,
  }
  if (withSeconds) opts.second = '2-digit'
  const fmt = new Intl.DateTimeFormat('en-US', opts)
  return w => fmt.format(new Date(Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s)))
}

/** The calendar day a transition lands on, read in the zone it happens in. */
function cwFmtDay(ms: number, zone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
  }
  if (zone !== 'local') opts.timeZone = zone
  return new Intl.DateTimeFormat('en-US', opts).format(new Date(ms))
}

/** The HH:MM showing on a clock running at `offset` at instant `ms`. */
function cwClockAt(ms: number, offset: number): string {
  const d = new Date(ms + offset)
  return `${cwPad2(d.getUTCHours())}:${cwPad2(d.getUTCMinutes())}`
}

function cwRelFuture(ms: number, now: number): string {
  const diff = Math.max(0, ms - now)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'always' })
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31557600000], ['month', 2629800000], ['week', 604800000],
    ['day', 86400000], ['hour', 3600000], ['minute', 60000], ['second', 1000],
  ]
  for (const [unit, span] of units) {
    if (diff >= span || unit === 'second') return rtf.format(Math.round(diff / span), unit)
  }
  return 'now'
}

/** "02:00", "02:00 and 02:30", "02:00, 02:30 and 2 more". */
function cwTimeList(runs: CwRun[]): string {
  const seen: string[] = []
  for (const r of runs) {
    const at = `${cwPad2(r.wall.h)}:${cwPad2(r.wall.mi)}`
    if (!seen.includes(at)) seen.push(at)
  }
  if (seen.length <= 3) {
    return seen.length <= 1 ? seen[0] ?? '' : `${seen.slice(0, -1).join(', ')} and ${seen[seen.length - 1]}`
  }
  return `${seen.slice(0, 3).join(', ')} and ${seen.length - 3} more`
}

function cwPlural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

// ── Component ────────────────────────────────────────────────────────────────

class CronWhispererTool extends HTMLElement {
  private settings: CwSettings = { ...CW_DEFAULTS }
  private root!: HTMLElement
  private input!: HTMLInputElement
  private statusEl!: HTMLElement
  private describeEl!: HTMLElement
  private orNoteEl!: HTMLElement
  private runsEl!: HTMLElement
  private freqEl!: HTMLElement
  private fieldsEl!: HTMLElement
  private dstEl!: HTMLElement
  private lastRunsText = ''
  private clock: CwZoneClock | null = null

  private onKeydown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      this.copyText(this.describeEl.textContent ?? '', this.q('[data-action="copy-describe"]'))
      return
    }
    if (!typing && (e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      this.clearAll()
    }
  }

  connectedCallback() {
    this.settings = this.loadSettings()

    this.innerHTML = `
      <div data-type="tool-page" data-tool="cron-whisperer">
        <div data-type="tool-header">
          <h1>Cron Whisperer</h1>
          <p>Paste a cron expression and read it in plain English, then see the next run times <strong>in the zone your server actually runs in</strong> — any IANA zone, not just this browser's. Cron Whisperer also works out what daylight saving does to the schedule: which runs fall into an hour that never happens, which fall into one that happens twice, and what cron does about each. Understands standard 5-field crontab syntax, month and weekday names, @nicknames, and 6-field (with-seconds) expressions. Everything runs in your browser — press <kbd>C</kbd> to clear, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> to copy the description.</p>
        </div>

        <div data-group="toolbar">
          <button data-action="clear" type="button">Clear (C)</button>
          <button data-action="copy-link" type="button">Copy link</button>
          <details data-type="cw-prefs">
            <summary>Preferences</summary>
            <div data-group="cw-prefs">
              <label data-type="cw-field"><span>Time zone</span>
                <select data-control="zone" aria-label="Time zone for run times"></select>
              </label>
              <label data-type="cw-field"><span>Clock</span>
                <select data-control="hour12" aria-label="Clock format">
                  <option value="false">24-hour</option>
                  <option value="true">12-hour</option>
                </select>
              </label>
              <label data-type="cw-field"><span>Runs to show</span>
                <select data-control="runs" aria-label="Number of upcoming runs to show">
                  <option value="5">5</option>
                  <option value="10">10</option>
                  <option value="20">20</option>
                </select>
              </label>
            </div>
          </details>
        </div>

        <section data-type="cw-card" data-card="input" aria-labelledby="cw-in-h">
          <h2 id="cw-in-h">Cron expression</h2>
          <div data-group="cw-inputrow">
            <input data-input="expr" type="text" spellcheck="false" autocomplete="off" autocapitalize="off"
              inputmode="text" placeholder="* * * * *" aria-label="Cron expression" value="" />
            <button data-action="copy-expr" type="button">Copy</button>
          </div>
          <pre data-type="cw-legend" aria-hidden="true">┌─ <b>minute</b> (0–59)
│ ┌─ <b>hour</b> (0–23)
│ │ ┌─ <b>day of month</b> (1–31)
│ │ │ ┌─ <b>month</b> (1–12 or JAN–DEC)
│ │ │ │ ┌─ <b>day of week</b> (0–7 or SUN–SAT, 0 &amp; 7 = Sun)
│ │ │ │ │
<b>*</b> <b>*</b> <b>*</b> <b>*</b> <b>*</b>   —   *=any   ,=list   -=range   /=step</pre>
          <div data-type="cw-statusbar">
            <span data-type="cw-status" role="status" aria-live="polite"></span>
          </div>
        </section>

        <section data-type="cw-card" data-card="describe" aria-labelledby="cw-desc-h">
          <h2 id="cw-desc-h">Meaning</h2>
          <p data-type="cw-describe" data-for="describe">—</p>
          <p data-type="cw-ornote" data-for="ornote" hidden>Because both the day-of-month and day-of-week fields are restricted, cron runs the job when <em>either</em> matches — not only when both do.</p>
          <div data-group="cw-actions">
            <button data-action="copy-describe" type="button">Copy description</button>
          </div>
        </section>

        <section data-type="cw-card" data-card="next" aria-labelledby="cw-next-h">
          <h2 id="cw-next-h">Next runs</h2>
          <ol data-type="cw-runs" data-for="runs"></ol>
          <p data-type="cw-freq" data-for="freq"></p>
          <div data-group="cw-actions">
            <button data-action="copy-runs" type="button">Copy next runs</button>
          </div>
        </section>

        <section data-type="cw-card" data-card="dst" aria-labelledby="cw-dst-h">
          <h2 id="cw-dst-h">Daylight saving</h2>
          <div data-type="cw-dst" data-for="dst"></div>
        </section>

        <section data-type="cw-card" data-card="fields" aria-labelledby="cw-fields-h">
          <h2 id="cw-fields-h">Field breakdown</h2>
          <div data-type="cw-fields" data-for="fields"></div>
        </section>

        <details data-type="cw-examples">
          <summary>Common examples</summary>
          <div data-type="cw-example-grid">
            ${CW_EXAMPLES.map(([expr, label]) => `
              <button data-type="cw-example" data-example="${escapeHtml(expr)}" type="button">
                <code>${escapeHtml(expr)}</code>
                <span>${escapeHtml(label)}</span>
              </button>
            `).join('')}
          </div>
        </details>

        <details data-type="cw-explainer">
          <summary>How cron works</summary>
          <p>A <strong>cron expression</strong> is five space-separated fields — <code>minute hour day-of-month month day-of-week</code> — that together say <em>when</em> a job runs. Each field takes <code>*</code> (any value), a single number, a list (<code>1,15,30</code>), a range (<code>9-17</code>), or a step (<code>*/5</code>, <code>0-30/10</code>). Months accept <code>JAN</code>–<code>DEC</code> and weekdays <code>SUN</code>–<code>SAT</code>; both <code>0</code> and <code>7</code> mean Sunday.</p>
          <p>Shorthand <strong>nicknames</strong> stand in for common schedules: <code>@yearly</code>, <code>@monthly</code>, <code>@weekly</code>, <code>@daily</code>, <code>@hourly</code>, and <code>@reboot</code> (runs once at startup). A <strong>6-field</strong> expression is read here with a leading <em>seconds</em> field, matching schedulers like Quartz and node-cron.</p>
          <p><strong>The day-of-month / day-of-week gotcha:</strong> when <em>both</em> of those fields are restricted (neither is <code>*</code>), the job runs whenever <em>either</em> one matches, not when both do. <code>0 0 1 * 1</code> runs on the 1st of the month <em>and</em> on every Monday.</p>
          <p><strong>A crontab names a wall clock, not a moment.</strong> Twice a year that stops being the same thing. When the clocks go forward, an hour of readings never happens — <code>30 2 * * *</code> has no 02:30 at all that day. When they go back, an hour of readings happens twice.</p>
          <p><strong>What cron does about it</strong> is in <code>man 8 cron</code>, and it turns on a distinction almost nobody knows: a job counts as running "at a particular time" only when <em>neither</em> the hour nor the minute field contains a <code>*</code>. Those jobs are made up once, right after a forward jump, and are <em>not</em> repeated after a backward one. Every other schedule simply follows the new wall clock — so a step schedule like <code>*/30 * * * *</code> loses two runs in spring and gains two in autumn. The card above applies exactly that rule to your expression.</p>
          <p>Everything here is computed locally in your browser; your last expression and preferences are remembered on this device and never uploaded. <strong>Copy link</strong> puts the expression and the zone in the URL fragment, which browsers never send to a server — so a link you share stays as private as the tool.</p>
        </details>
      </div>
    `

    this.root = this.querySelector('[data-type="tool-page"]') as HTMLElement
    this.input = this.q('[data-input="expr"]')
    this.statusEl = this.q('[data-type="cw-status"]')
    this.describeEl = this.q('[data-for="describe"]')
    this.orNoteEl = this.q('[data-for="ornote"]')
    this.runsEl = this.q('[data-for="runs"]')
    this.freqEl = this.q('[data-for="freq"]')
    this.fieldsEl = this.q('[data-for="fields"]')
    this.dstEl = this.q('[data-for="dst"]')

    // A shared link wins over this device's saved state, but is deliberately not
    // written back to localStorage: opening someone else's link should not
    // silently repoint your own default zone.
    const link = this.readLink()
    if (link.zone) this.settings.zone = link.zone

    this.fillZones()
    this.reflectSettings()

    const saved = this.readLS(CW_LS_EXPR)
    this.input.value = link.expr ?? saved ?? '*/5 * * * *'

    this.input.addEventListener('input', () => this.evaluate())
    this.root.querySelectorAll<HTMLSelectElement>('[data-control]').forEach(el =>
      el.addEventListener('change', () => this.onPrefChange(el)))
    this.root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn =>
      btn.addEventListener('click', () => this.onAction(btn.dataset.action as string, btn)))
    this.root.querySelectorAll<HTMLButtonElement>('[data-example]').forEach(btn =>
      btn.addEventListener('click', () => {
        this.input.value = btn.dataset.example as string
        this.evaluate()
        this.input.focus()
      }))

    this.addEventListener('keydown', this.onKeydown)

    this.evaluate()
  }

  disconnectedCallback() {
    this.removeEventListener('keydown', this.onKeydown)
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.querySelector(sel) as T
  }

  // ── zone picker ───────────────────────────────────────────────────────────
  /**
   * Built in JS rather than in the template because the option list comes from
   * the runtime's own copy of the tz database — hard-coding it would go stale
   * every time a country changes its mind about daylight saving.
   */
  private fillZones() {
    const sel = this.q<HTMLSelectElement>('[data-control="zone"]')
    const opt = (value: string, label: string) =>
      `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`

    const groups = new Map<string, string[]>()
    for (const zone of cwZoneList()) {
      if (zone === 'UTC') continue
      const slash = zone.indexOf('/')
      const group = slash > 0 ? zone.slice(0, slash) : 'Other'
      const list = groups.get(group)
      if (list) list.push(zone)
      else groups.set(group, [zone])
    }

    let html = opt('local', `This device — ${cwLocalZoneName()}`) + opt('UTC', 'UTC / GMT')
    for (const [group, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      html += `<optgroup label="${escapeHtml(group.replace(/_/g, ' '))}">`
        + list.sort().map(z => opt(z, z.replace(/_/g, ' '))).join('')
        + '</optgroup>'
    }
    sel.innerHTML = html

    // Aliases such as US/Eastern are valid but are not in supportedValuesOf, so
    // a shared link can name a zone the list does not contain. Add it rather
    // than silently snapping the picker back to the default.
    const zone = this.settings.zone
    if (!sel.querySelector(`option[value="${CSS.escape(zone)}"]`)) {
      sel.insertAdjacentHTML('afterbegin', opt(zone, zone.replace(/_/g, ' ')))
    }
  }

  private zoneClock(nowMs: number): CwZoneClock {
    if (!this.clock || this.clock.zone !== this.settings.zone) {
      this.clock = new CwZoneClock(this.settings.zone, nowMs)
    }
    return this.clock
  }

  private zoneLabel(): string {
    return this.settings.zone === 'local' ? cwLocalZoneName() : this.settings.zone
  }

  // ── evaluation ────────────────────────────────────────────────────────────
  private evaluate() {
    const expr = this.input.value
    this.writeLS(CW_LS_EXPR, expr)

    if (!expr.trim()) {
      this.root.removeAttribute('data-invalid')
      this.statusEl.removeAttribute('data-error')
      this.setStatus('Enter a cron expression to decode it.')
      this.clearOutputs()
      return
    }

    let P: CwParsed
    try {
      P = cwParse(expr)
    } catch (err) {
      this.showError((err as Error).message)
      return
    }

    this.root.removeAttribute('data-invalid')
    this.statusEl.removeAttribute('data-error')
    this.setStatus(P.nickname && P.nickname !== '@reboot'
      ? `${P.nickname} expands to  ${P.normalized}`
      : P.nickname === '@reboot' ? 'Special schedule — runs at startup.'
      : 'Valid cron expression.')

    this.describeEl.textContent = cwDescribe(P)
    this.orNoteEl.hidden = !(P.dom.restricted && P.dow.restricted && !P.reboot)

    const now = Date.now()
    const clock = this.zoneClock(now)
    this.renderRuns(P, clock, now)
    this.renderDst(P, clock, now)
    this.renderFields(P)
  }

  private clearOutputs() {
    this.describeEl.textContent = '—'
    this.orNoteEl.hidden = true
    this.runsEl.innerHTML = ''
    this.freqEl.textContent = ''
    this.fieldsEl.innerHTML = ''
    this.dstEl.innerHTML = ''
    this.lastRunsText = ''
  }

  private showError(msg: string) {
    this.root.setAttribute('data-invalid', '')
    this.statusEl.setAttribute('data-error', '')
    this.setStatus(msg)
    this.clearOutputs()
  }

  // ── next runs ─────────────────────────────────────────────────────────────
  private renderRuns(P: CwParsed, clock: CwZoneClock, nowMs: number) {
    const zone = this.settings.zone
    if (P.reboot) {
      this.runsEl.innerHTML = '<li><span data-type="cw-run-idx">—</span><span data-type="cw-run-time">At each system startup</span><span data-type="cw-run-rel">on boot</span></li>'
      this.freqEl.textContent = 'Runs once per boot; there is no recurring time to compute.'
      this.lastRunsText = '@reboot — at each system startup'
      return
    }

    const runs = cwCollectRuns(P, nowMs, { count: this.settings.runs }, clock)
    if (runs.length === 0) {
      this.runsEl.innerHTML = '<li><span data-type="cw-run-idx">—</span><span data-type="cw-run-time">No upcoming runs found in the next 25 years — this schedule may never match (for example February 30).</span><span data-type="cw-run-rel"></span></li>'
      this.freqEl.textContent = ''
      this.lastRunsText = ''
      return
    }

    const fixedTime = cwIsFixedTime(P)
    const fmtRun = cwRunFormatter(zone, this.settings.hour12, P.hasSeconds)
    const fmtWall = cwWallFormatter(this.settings.hour12, P.hasSeconds)
    const lines: string[] = []
    let idx = 0

    this.runsEl.innerHTML = runs.map(run => {
      const flag = this.dstFlag(run, fixedTime)
      const flagHtml = flag ? `<span data-type="cw-run-flag">${escapeHtml(flag)}</span>` : ''
      if (!run.fires) {
        const when = fmtWall(run.wall)
        lines.push(`${when}  (never happens — ${flag})`)
        return `<li data-dst="skip"><span data-type="cw-run-idx">—</span>`
          + `<span data-type="cw-run-time">${escapeHtml(when)}</span>`
          + `<span data-type="cw-run-rel">skipped</span>${flagHtml}</li>`
      }
      idx++
      const time = fmtRun.format(new Date(run.ms))
      const rel = cwRelFuture(run.ms, nowMs)
      lines.push(flag ? `${time}  (${rel})  — ${flag}` : `${time}  (${rel})`)
      return `<li${run.dst ? ` data-dst="${run.dst}"` : ''}>`
        + `<span data-type="cw-run-idx">${idx}</span>`
        + `<span data-type="cw-run-time">${escapeHtml(time)}</span>`
        + `<span data-type="cw-run-rel">${escapeHtml(rel)}</span>${flagHtml}</li>`
    }).join('')
    this.lastRunsText = lines.join('\n')

    // Frequency read-out. This is now DST-correct for free: a 23-hour day
    // really does have fewer runs, and a 25-hour one really does have more.
    const cap = 2000
    const zoneName = this.zoneLabel()
    const in24 = cwFiringCount(cwCollectRuns(P, nowMs, { count: cap, untilMs: nowMs + 86400000 }, clock))
    if (in24 > 0) {
      this.freqEl.textContent = `Runs ${this.count(in24, cap)} in the next 24 hours (${zoneName}).`
    } else {
      const in7 = cwFiringCount(cwCollectRuns(P, nowMs, { count: cap, untilMs: nowMs + 7 * 86400000 }, clock))
      this.freqEl.textContent = in7 > 0
        ? `Runs ${this.count(in7, cap)} in the next 7 days (${zoneName}).`
        : `Runs rarely — nothing in the next 7 days (${zoneName}).`
    }
  }

  /** The sentence that explains why a run row is marked. Empty when it is not. */
  private dstFlag(run: CwRun, fixedTime: boolean): string {
    const at = `${cwPad2(run.wall.h)}:${cwPad2(run.wall.mi)}`
    switch (run.dst) {
      case 'gap':
        return run.fires
          ? `${at} does not exist that day — the clocks jump over it. This schedule names a particular time, so cron makes the run up here, at the jump.`
          : `${at} does not exist that day — the clocks jump over it, and a schedule with a wildcard hour or minute simply loses this run.`
      case 'first':
        return fixedTime
          ? `${at} comes round twice that day — the clocks go back. Cron runs a particular-time job on the first pass only; it does not repeat.`
          : `${at} comes round twice that day — this is the first pass, before the clocks go back.`
      case 'second':
        return `${at} again — the repeat after the clocks went back. A wildcard schedule follows the wall clock through both passes.`
      default:
        return ''
    }
  }

  private count(n: number, cap: number): string {
    if (n >= cap) return `${cap}+ times`
    return n === 1 ? 'once' : `${n} times`
  }

  // ── daylight saving ───────────────────────────────────────────────────────
  private renderDst(P: CwParsed, clock: CwZoneClock, nowMs: number) {
    const label = escapeHtml(this.zoneLabel())

    if (P.reboot) {
      this.dstEl.innerHTML = '<p data-type="cw-dst-none">@reboot has no clock time, so no offset change can move it.</p>'
      return
    }

    const transitions = clock.transitionsFrom(nowMs, 2, nowMs + CW_DST_HORIZON_MS)
    if (transitions.length === 0) {
      this.dstEl.innerHTML = `<p data-type="cw-dst-none">${label} has no offset changes in the next 400 days, so no run of this schedule can be skipped or repeated. Pinning a crontab to UTC — <code>CRON_TZ=UTC</code> — is the usual way to get that guarantee everywhere.</p>`
      return
    }

    const fixedTime = cwIsFixedTime(P)
    this.dstEl.innerHTML = `<p data-type="cw-dst-lead">${label} changes its UTC offset ${transitions.length === 1 ? 'once' : 'twice'} in the next 400 days. Here is what each change does to this schedule.</p>`
      + transitions.map(t => this.dstRow(P, clock, t, fixedTime)).join('')
  }

  private dstRow(P: CwParsed, clock: CwZoneClock, t: CwTransition, fixedTime: boolean): string {
    const forward = t.after > t.before
    const zone = this.settings.zone
    const when = cwFmtDay(t.ms, zone)
    const shift = `${cwClockAt(t.ms, t.before)} becomes ${cwClockAt(t.ms, t.after)}`
    const offsets = `${cwOffsetLabel(t.before)} → ${cwOffsetLabel(t.after)}`

    const window = cwCollectRuns(
      P,
      t.ms - CW_DST_WINDOW_MS,
      // No `count`: the 12-hour window is the only bound that belongs here. A cap
      // of 400 silently truncated `* * * * *` (reporting 51 doubled runs against a
      // real 60) and hid the 6-field case entirely, claiming a per-second schedule
      // was unaffected by a transition that doubles 3600 of its runs.
      { untilMs: t.ms + CW_DST_WINDOW_MS },
      clock,
    )
    const gaps = window.filter(r => r.dst === 'gap')
    const doubled = window.filter(r => r.dst === 'first')

    // Not every jump is an hour: Lord Howe moves 30 minutes, and saying "the
    // hour that never happens" there would be a confident falsehood.
    const span = Math.abs(t.after - t.before)
    const missing = span === 3600_000 ? 'the hour that never happens' : `the ${span / 60_000} minutes that never happen`
    const repeated = span === 3600_000 ? 'the repeated hour' : `the repeated ${span / 60_000} minutes`

    let effect: string
    if (forward) {
      const n = gaps.length
      if (n === 0) {
        effect = `Nothing is scheduled inside ${missing}, so this schedule is unaffected.`
      } else if (fixedTime) {
        effect = `${n} ${cwPlural(n, 'run', 'runs')} (${cwTimeList(gaps)}) ${cwPlural(n, 'falls', 'fall')} into ${missing}. This schedule names a particular time, so cron makes ${cwPlural(n, 'it', 'them')} up once, right at the jump.`
      } else {
        effect = `${n} ${cwPlural(n, 'run', 'runs')} (${cwTimeList(gaps)}) ${cwPlural(n, 'falls', 'fall')} into ${missing}. The hour or minute field is a wildcard, so cron does not make ${cwPlural(n, 'it', 'them')} up — ${cwPlural(n, 'that run is', 'those runs are')} simply lost.`
      }
    } else {
      const n = doubled.length
      if (n === 0) {
        effect = `Nothing is scheduled inside ${repeated}, so this schedule is unaffected.`
      } else if (fixedTime) {
        effect = `${cwTimeList(doubled)} ${cwPlural(n, 'comes', 'come')} round twice. This schedule names a particular time, so cron runs ${cwPlural(n, 'it', 'them')} on the first pass only — no duplicate.`
      } else {
        effect = `${n} ${cwPlural(n, 'run', 'runs')} (${cwTimeList(doubled)}) ${cwPlural(n, 'falls', 'fall')} into ${repeated} and ${cwPlural(n, 'happens', 'happen')} twice. The hour or minute field is a wildcard, so cron follows the wall clock through both passes.`
      }
    }

    return `<div data-type="cw-dst-row" data-dir="${forward ? 'forward' : 'back'}">`
      + `<span data-type="cw-dst-when">${escapeHtml(when)}</span>`
      + `<span data-type="cw-dst-shift">Clocks go ${forward ? 'forward' : 'back'} — ${escapeHtml(shift)} <small>(${escapeHtml(offsets)})</small></span>`
      + `<span data-type="cw-dst-effect">${escapeHtml(effect)}</span>`
      + '</div>'
  }

  // ── field breakdown ───────────────────────────────────────────────────────
  private renderFields(P: CwParsed) {
    const rows: { kind: CwKind; f: CwField }[] = []
    if (P.hasSeconds) rows.push({ kind: 'second', f: P.second })
    rows.push({ kind: 'minute', f: P.minute })
    rows.push({ kind: 'hour', f: P.hour })
    rows.push({ kind: 'dom', f: P.dom })
    rows.push({ kind: 'month', f: P.month })
    rows.push({ kind: 'dow', f: P.dow })

    this.fieldsEl.innerHTML = rows.map(({ kind, f }) => `
      <div data-type="cw-frow">
        <span data-type="cw-fname">${CW_FIELD_LABEL[kind]}</span>
        <span data-type="cw-ftoken">${escapeHtml(f.token)}</span>
        <span data-type="cw-fvals">${escapeHtml(this.fieldValues(f, kind))}</span>
      </div>
    `).join('')
  }

  private fieldValues(f: CwField, kind: CwKind): string {
    if (f.token === '*') {
      const plural: Record<CwKind, string> = {
        second: 'second', minute: 'minute', hour: 'hour',
        dom: 'day', month: 'month', dow: 'weekday',
      }
      return `every ${plural[kind]}`
    }
    const name = kind === 'month' ? (v: number) => `${v} ${cwMonthName(v)}`
      : kind === 'dow' ? (v: number) => `${v} ${cwDowName(v)}`
      : (v: number) => String(v)
    const rendered = f.values.map(name)
    if (rendered.length <= 8) return rendered.join(', ')
    return `${rendered.slice(0, 4).join(', ')} … ${rendered[rendered.length - 1]} (${f.values.length} values)`
  }

  // ── shareable link ────────────────────────────────────────────────────────
  /**
   * The expression and zone live in the URL *fragment*, which browsers never
   * put on the wire. A link is shareable without the tool acquiring a server or
   * the reader's schedule ever leaving their machine.
   */
  private readLink(): { expr?: string; zone?: string } {
    const out: { expr?: string; zone?: string } = {}
    try {
      const hash = location.hash.startsWith('#') ? location.hash.slice(1) : ''
      if (!hash) return out
      const params = new URLSearchParams(hash)
      const expr = params.get('e')
      if (expr && expr.length <= CW_MAX_LINK_EXPR) out.expr = expr
      const zone = params.get('tz')
      if (zone && cwZoneValid(zone)) out.zone = zone
    } catch {
      /* a malformed fragment costs the link, never the tool */
    }
    return out
  }

  private shareUrl(): string {
    const params = new URLSearchParams()
    params.set('e', this.input.value.trim())
    params.set('tz', this.settings.zone)
    return `${location.origin}${location.pathname}#${params.toString()}`
  }

  // ── actions ───────────────────────────────────────────────────────────────
  private onAction(action: string, btn: HTMLButtonElement) {
    switch (action) {
      case 'clear':
        this.clearAll()
        break
      case 'copy-expr':
        this.copyText(this.input.value, btn)
        break
      case 'copy-describe':
        this.copyText(this.describeEl.textContent ?? '', btn)
        break
      case 'copy-runs':
        this.copyText(this.lastRunsText, btn)
        break
      case 'copy-link': {
        if (!this.input.value.trim()) { this.setStatus('Enter an expression before sharing it.'); break }
        const url = this.shareUrl()
        history.replaceState(null, '', url.slice(url.indexOf('#')))
        this.copyText(url, btn)
        break
      }
    }
  }

  private clearAll() {
    this.input.value = ''
    this.evaluate()
    this.input.focus()
  }

  private async copyText(text: string, btn: HTMLButtonElement) {
    if (!text || text === '—') { this.setStatus('Nothing to copy.'); return }
    try {
      await navigator.clipboard.writeText(text)
      this.flash(btn, 'Copied!')
    } catch {
      this.flash(btn, 'Failed')
    }
  }

  private flash(btn: HTMLButtonElement, label: string) {
    flashLabel(btn, label, 1200)
  }

  private setStatus(label: string) {
    this.statusEl.textContent = label
  }

  // ── preferences + persistence ─────────────────────────────────────────────
  private onPrefChange(el: HTMLSelectElement) {
    const key = el.dataset.control as keyof CwSettings
    if (key === 'zone') this.settings.zone = cwZoneValid(el.value) ? el.value : CW_DEFAULTS.zone
    else if (key === 'hour12') this.settings.hour12 = el.value === 'true'
    else if (key === 'runs') this.settings.runs = parseInt(el.value, 10)
    this.saveSettings()
    this.evaluate()
  }

  private reflectSettings() {
    this.root.querySelectorAll<HTMLSelectElement>('[data-control]').forEach(el => {
      const key = el.dataset.control as keyof CwSettings
      el.value = String(this.settings[key])
    })
  }

  private loadSettings(): CwSettings {
    const raw = this.readLS(CW_LS_SETTINGS)
    if (!raw) return { ...CW_DEFAULTS }
    try {
      const p = JSON.parse(raw) as Partial<CwSettings>
      const merged = { ...CW_DEFAULTS, ...p }
      // v1 of this tool only knew 'local' and 'utc'; keep those settings working.
      if (typeof merged.zone !== 'string') merged.zone = CW_DEFAULTS.zone
      else if (merged.zone === 'utc') merged.zone = 'UTC'
      if (!cwZoneValid(merged.zone)) merged.zone = CW_DEFAULTS.zone
      merged.hour12 = Boolean(merged.hour12)
      if (![5, 10, 20].includes(merged.runs)) merged.runs = CW_DEFAULTS.runs
      return merged
    } catch {
      return { ...CW_DEFAULTS }
    }
  }

  private saveSettings() {
    this.writeLS(CW_LS_SETTINGS, JSON.stringify(this.settings))
  }

  private readLS(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  }

  private writeLS(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* ignore quota / private-mode */ }
  }
}

if (!customElements.get('cron-whisperer-tool')) {
  customElements.define('cron-whisperer-tool', CronWhispererTool)
}

export {}
