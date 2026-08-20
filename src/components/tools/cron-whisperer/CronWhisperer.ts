/**
 * Cron Whisperer — a cron explainer that is honest about time zones, and reads
 * a whole crontab rather than one line at a time.
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
 * Paste more than one line and it switches to reading the text as a **crontab**
 * — comments, `CRON_TZ=`/`TZ=` assignments that apply to the entries below
 * them, a user column if it is a system crontab — and previews every entry
 * together: one row each, one merged timeline of what fires next across the
 * whole file with simultaneous starts marked, and a daylight-saving panel that
 * names which lines break at the next transition. That is the loop this tool
 * was missing: nobody debugs one cron line, they debug a crontab. The file
 * grammar lives in ./crontab.ts for the same reason the engine lives in
 * ./schedule.ts — the claims are checkable, so `security:smoke` checks them.
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
import {
  CW_CRONTAB_MAX_ENTRIES,
  cwCollisions,
  cwLooksLikeSystemCrontab,
  cwParseEnvLine,
  cwMergeRuns,
  cwParseCrontab,
  type CwCrontabDoc,
  type CwCrontabEntry,
} from './crontab'

// ── Types ────────────────────────────────────────────────────────────────────

interface CwSettings {
  /** 'local' or an IANA id ('UTC', 'America/New_York', …). */
  zone: string
  hour12: boolean
  runs: number // 5 | 10 | 20
  /** Read a user column between the schedule and the command (/etc/cron.d). */
  systemUser: boolean
}

// ── Constants ────────────────────────────────────────────────────────────────

const CW_LS_EXPR = 'cron-whisperer:expr:v1'
const CW_LS_SETTINGS = 'cron-whisperer:settings:v1'

const CW_DEFAULTS: CwSettings = { zone: 'local', hour12: false, runs: 5, systemUser: false }

/** How far ahead the daylight-saving card looks. */
const CW_DST_HORIZON_MS = 400 * 86400_000
/** Window either side of a transition that is searched for affected runs. */
const CW_DST_WINDOW_MS = 6 * 3600_000

/** How far ahead simultaneous starts are looked for across a whole crontab. */
const CW_COLLIDE_WINDOW_MS = 24 * 3600_000
/**
 * Per-entry ceiling on that scan. A per-minute entry contributes 1 440 runs a
 * day by itself, and a crontab may hold a hundred entries; this keeps the whole
 * comparison to tens of thousands of resolved instants in the worst case. An
 * entry over the ceiling is named rather than half-compared — see cwCollisions.
 */
const CW_COLLIDE_MAX_RUNS = 500

/**
 * Longest `#e=` value accepted from a shared link. A single expression is tiny;
 * a shared crontab is not, so the bound is the crontab reader's own line budget
 * rather than one expression's — still bounded, because the value is attacker-
 * supplied text that ends up in the DOM.
 */
const CW_MAX_LINK_EXPR = 4000

/**
 * The sample the "Sample crontab" button loads. Every line earns its place: two
 * jobs collide at midnight, the `CRON_TZ=` applies only downward, 02:30 in New
 * York is the run that vanishes each spring, and the `%` in `date +%Y%m%d` is
 * the one cron silently turns into stdin.
 */
const CW_SAMPLE_CRONTAB = [
  '# deploy box crontab — paste your own over this',
  'MAILTO=ops@example.com',
  'PATH=/usr/local/bin:/usr/bin:/bin',
  '',
  '*/5 * * * * /usr/local/bin/health-check.sh',
  '0 0 * * * /usr/local/bin/rotate-logs.sh',
  '0 0 * * * /usr/local/bin/nightly-backup.sh',
  '',
  "# everything below runs on the reporting server's clock",
  'CRON_TZ=America/New_York',
  '30 2 * * * /opt/reports/nightly.sh',
  '0 9 * * 1-5 /opt/reports/standup.sh',
  '15 3 1 * * tar czf /backup/$(date +%Y%m%d).tgz /srv',
].join('\n')

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

/** Trim a command for display without letting one long line own the panel. */
function cwClip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

// ── Component ────────────────────────────────────────────────────────────────

class CronWhispererTool extends HTMLElement {
  private settings: CwSettings = { ...CW_DEFAULTS }
  private root!: HTMLElement
  private input!: HTMLTextAreaElement
  private statusEl!: HTMLElement
  private describeEl!: HTMLElement
  private orNoteEl!: HTMLElement
  private runsEl!: HTMLElement
  private freqEl!: HTMLElement
  private fieldsEl!: HTMLElement
  private dstEl!: HTMLElement
  private leadEl!: HTMLElement
  private entriesEl!: HTMLElement
  private timelineEl!: HTMLElement
  private tlNoteEl!: HTMLElement
  private lastRunsText = ''
  /**
   * One clock per zone, not one clock. A crontab can name several zones through
   * its `CRON_TZ=` lines, and building a `CwZoneClock` scans the tz database —
   * doing that per entry per keystroke is the difference between instant and
   * sluggish. Keyed by zone id, so changing the picker cannot serve a stale one.
   */
  private clocks = new Map<string, CwZoneClock>()

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
          <p>Paste a cron expression and read it in plain English, then see the next run times <strong>in the zone your server actually runs in</strong> — any IANA zone, not just this browser's. Cron Whisperer also works out what daylight saving does to the schedule: which runs fall into an hour that never happens, which fall into one that happens twice, and what cron does about each. <strong>Paste more than one line and it reads the whole crontab</strong> — <code>CRON_TZ=</code> and <code>TZ=</code> lines applying to the entries below them, comments, a system crontab's user column — and previews every entry together, with one merged timeline that marks the jobs starting at the same instant. Everything runs in your browser — press <kbd>C</kbd> to clear, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> to copy the description.</p>
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
              <label data-type="cw-field"><span>Crontab kind</span>
                <select data-control="systemUser" aria-label="How to read a pasted crontab">
                  <option value="false">User crontab</option>
                  <option value="true">System (/etc/cron.d)</option>
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
          <h2 id="cw-in-h">Cron expression or crontab</h2>
          <div data-group="cw-inputrow">
            <textarea data-input="expr" rows="1" spellcheck="false" autocomplete="off" autocapitalize="off"
              wrap="off" placeholder="* * * * *" aria-label="Cron expression, or a whole crontab"></textarea>
            <div data-group="cw-inputbtns">
              <button data-action="copy-expr" type="button">Copy</button>
              <button data-action="sample" type="button">Sample crontab</button>
            </div>
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

        <section data-type="cw-card" data-card="crontab" aria-labelledby="cw-tab-h" hidden>
          <h2 id="cw-tab-h">Crontab</h2>
          <p data-type="cw-tab-lead" data-for="crontab-lead"></p>
          <div data-type="cw-entries" data-for="entries"></div>
        </section>

        <section data-type="cw-card" data-card="timeline" aria-labelledby="cw-tl-h" hidden>
          <h2 id="cw-tl-h">What fires next</h2>
          <ol data-type="cw-runs" data-for="timeline"></ol>
          <p data-type="cw-freq" data-for="timeline-note"></p>
          <div data-group="cw-actions">
            <button data-action="copy-timeline" type="button">Copy timeline</button>
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
          <p><strong>Paste more than one line and it is read as a crontab.</strong> A line is a comment only when <code>#</code> is its first non-blank character — a trailing <code># note</code> on an entry is part of the command, which is a real way to break a working job. An <em>assignment</em> line (<code>NAME=value</code>, value optionally quoted) is recognised with Vixie cron's own rule, so <code>MAILTO=""</code> is configuration and <code>0 0 * * * cmd</code> is not.</p>
          <p><strong><code>CRON_TZ=</code> applies downward.</strong> It sets the zone for the entries <em>after</em> it, not for the file — the line above one is unaffected, which is the most common way a crontab gets misread. <code>TZ=</code> is marked rather than trusted: implementations disagree about whether it moves the schedule or only sets the job's environment, so entries under one are previewed in that zone <em>and</em> flagged. If you meant the schedule, write <code>CRON_TZ=</code>.</p>
          <p><strong><code>%</code> is not an ordinary character.</strong> Unescaped, it ends the command: everything after it is handed to the job on standard input, and each further <code>%</code> becomes a newline. <code>date +%Y%m%d</code> in a crontab runs <code>date +</code> and posts the rest through stdin. Write <code>\%</code> for a literal percent. Every entry here shows what cron would really run.</p>
          <p>Files in <code>/etc/cron.d</code> and <code>/etc/crontab</code> carry a <em>user</em> column between the schedule and the command. Switch <strong>Crontab kind</strong> in Preferences to read a paste that way; the tool says so when a paste looks like one.</p>
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
    this.leadEl = this.q('[data-for="crontab-lead"]')
    this.entriesEl = this.q('[data-for="entries"]')
    this.timelineEl = this.q('[data-for="timeline"]')
    this.tlNoteEl = this.q('[data-for="timeline-note"]')

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

  private clockFor(zone: string, nowMs: number): CwZoneClock {
    const hit = this.clocks.get(zone)
    if (hit) return hit
    // Bounded, because the keys come from the pasted text: typing a CRON_TZ=
    // line names a new valid zone every few keystrokes, and each clock holds a
    // scanned transition table. A crontab naming more than this many zones is
    // not a thing; dropping the cache costs a rescan, never an answer.
    if (this.clocks.size >= 24) this.clocks.clear()
    const made = new CwZoneClock(zone, nowMs)
    this.clocks.set(zone, made)
    return made
  }

  private zoneClock(nowMs: number): CwZoneClock {
    return this.clockFor(this.settings.zone, nowMs)
  }

  /** The zone an entry is really scheduled in — its own, or the picker's. */
  private entryZone(e: CwCrontabEntry): string {
    return e.zone && e.zoneOk ? e.zone : this.settings.zone
  }

  private zoneLabel(): string {
    return this.settings.zone === 'local' ? cwLocalZoneName() : this.settings.zone
  }

  // ── evaluation ────────────────────────────────────────────────────────────
  /**
   * One line that parses as a bare expression is the tool this has always been.
   * Everything else is a crontab.
   *
   * The precedence matters and is deliberate: `0 0 12 * * *` stays the 6-field
   * seconds expression the tool advertises rather than becoming "5 fields and a
   * command called `*`", because the expression parser is asked first. Only when
   * it refuses does the line get read as a crontab — which is what lets a single
   * pasted line *with* a command work at all.
   */
  /**
   * Is this input a crontab FILE rather than a single expression?
   *
   * Only the unambiguous shapes answer true: more than one line, a comment, or an
   * environment assignment. Field count is deliberately NOT one of them — a 6-field
   * expression (seconds-first, the Quartz/node-cron form this tool advertises
   * supporting) has exactly six tokens, so counting them here routed `0 15 10 * * SUN`
   * to the file reader, which re-fielded it as the 5-field schedule `0 15 10 * *` plus
   * a command named `SUN` and previewed "At 15:00 on day-of-month 10" — a different
   * schedule, silently, with no error to show for it. A single line is an expression
   * until `cwParse` says otherwise; see evaluate().
   */
  private looksLikeCrontabFile(trimmed: string): boolean {
    if (/\n/.test(trimmed)) return true
    if (trimmed.startsWith('#')) return true
    if (cwParseEnvLine(trimmed)) return true
    return false
  }

  /**
   * One line that is a schedule PLUS a command — `0 5 * * * /usr/bin/backup.sh`, or a
   * nickname form like `@daily /usr/bin/backup.sh`. Checked only after `cwParse` has
   * already declined, so a real expression never reaches it.
   *
   * The nickname arm is not a token count: `@daily /usr/bin/backup.sh` is three tokens
   * and would fail a `>= 6` test, which is how it briefly rendered "Unknown nickname
   * \"@daily /usr/bin/backup.sh\"" instead of reading the command off it.
   */
  private looksLikeLoneEntry(trimmed: string): boolean {
    if (trimmed.startsWith('@')) return /^@\S+[ \t]+\S/.test(trimmed)
    return trimmed.split(/\s+/).length >= 6
  }

  private evaluate() {
    const expr = this.input.value
    this.writeLS(CW_LS_EXPR, expr)
    this.autoGrow()

    if (!expr.trim()) {
      this.showCards('expression')
      this.root.removeAttribute('data-invalid')
      this.statusEl.removeAttribute('data-error')
      this.setStatus('Enter a cron expression, or paste a whole crontab.')
      this.clearOutputs()
      return
    }

    const trimmed = expr.trim()
    const isFile = this.looksLikeCrontabFile(trimmed)

    let P: CwParsed | null = null
    let parseError = ''
    if (!isFile) {
      try {
        P = cwParse(trimmed)
      } catch (err) {
        parseError = (err as Error).message
      }
    }

    if (!P) {
      // The expression parser had its say first and declined. A single line it cannot
      // read but which still carries a schedule plus something after it is a lone
      // crontab entry, so hand it to the file reader; anything else is a malformed
      // expression and its own error is the more useful one to show.
      if (!isFile && !this.looksLikeLoneEntry(trimmed)) {
        this.showError(parseError)
        return
      }
      this.renderCrontab(expr, Date.now())
      return
    }

    this.showCards('expression')
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
    this.leadEl.textContent = ''
    this.entriesEl.innerHTML = ''
    this.timelineEl.innerHTML = ''
    this.tlNoteEl.textContent = ''
    this.lastRunsText = ''
  }

  /** Which cards this input has anything to say through. */
  private showCards(mode: 'expression' | 'crontab') {
    const single = mode === 'expression'
    for (const [card, on] of [
      ['describe', single], ['next', single], ['fields', single],
      ['crontab', !single], ['timeline', !single], ['dst', true],
    ] as [string, boolean][]) {
      const el = this.root.querySelector<HTMLElement>(`section[data-card="${card}"]`)
      if (el) el.hidden = !on
    }
  }

  /** Grow the box to the paste rather than making a crontab scroll one line. */
  private autoGrow() {
    const lines = this.input.value.split('\n').length
    this.input.rows = Math.min(16, Math.max(1, lines))
  }

  private showError(msg: string) {
    this.showCards('expression')
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

  // ── the whole crontab ─────────────────────────────────────────────────────
  /**
   * The file view. Three panels, and each answers a question the one-expression
   * view structurally cannot: what does every line mean *given the assignments
   * above it*, what fires next across the file, and which lines break at the
   * next daylight-saving transition.
   */
  private renderCrontab(text: string, nowMs: number) {
    const doc = cwParseCrontab(text, { systemUser: this.settings.systemUser })
    this.showCards('crontab')
    this.root.removeAttribute('data-invalid')
    this.statusEl.removeAttribute('data-error')

    const notes = [`${doc.entries.length} ${cwPlural(doc.entries.length, 'entry', 'entries')}`]
    if (doc.errors.length) {
      notes.push(`${doc.errors.length} ${cwPlural(doc.errors.length, 'line', 'lines')} cron would reject`)
      this.statusEl.setAttribute('data-error', '')
    }
    if (doc.truncated) notes.push(`only the first ${CW_CRONTAB_MAX_ENTRIES} entries are read`)
    if (!this.settings.systemUser && cwLooksLikeSystemCrontab(text)) {
      notes.push('every entry carries a user column — switch Crontab kind to System in Preferences')
    }
    this.setStatus(notes.join(' · '))

    this.describeEl.textContent = '—'
    this.orNoteEl.hidden = true
    this.runsEl.innerHTML = ''
    this.freqEl.textContent = ''
    this.fieldsEl.innerHTML = ''

    // Collected once and shared: the row list wants each entry's next run and
    // the timeline wants its next few, and asking the engine twice for the same
    // schedules is the kind of waste that only shows up on a long crontab.
    //
    // `count + 1` per entry, not `count`: the global first N is a subset of each
    // entry's own first N (nothing can be ahead of N runs globally while being
    // behind fewer than N inside its own schedule), and the extra row makes the
    // tie group at the cap complete, so a collision is never shown half.
    const lists = doc.entries.map((e, entry) => ({
      entry,
      runs: e.parsed.reboot
        ? []
        : cwCollectRuns(e.parsed, nowMs, { count: this.settings.runs + 1 }, this.clockFor(this.entryZone(e), nowMs)),
    }))

    this.renderEntries(doc, lists, nowMs)
    this.renderTimeline(doc, lists, nowMs)
    this.renderCrontabDst(doc, nowMs)
  }

  /** One row per meaningful line, in file order, so the scope of an assignment is visible. */
  private renderEntries(doc: CwCrontabDoc, lists: { entry: number; runs: CwRun[] }[], nowMs: number) {
    const indexOf = new Map(doc.entries.map((e, i) => [e, i]))
    const fmts = new Map<string, Intl.DateTimeFormat>()
    const fmtFor = (zone: string) => {
      const hit = fmts.get(zone)
      if (hit) return hit
      const made = cwRunFormatter(zone, this.settings.hour12, false)
      fmts.set(zone, made)
      return made
    }

    this.leadEl.textContent = doc.entries.length === 0
      ? 'No cron entries here — only comments, blank lines or settings.'
      : `Read top to bottom, the way cron reads it: a CRON_TZ= or TZ= line applies to every entry below it, not to the file. Entries with no assignment above them use the zone in Preferences (${this.zoneLabel()}).`

    const rows = doc.lines.filter(l =>
      l.kind === 'entry' || l.kind === 'error'
      || (l.kind === 'env' && (l.env?.name === 'CRON_TZ' || l.env?.name === 'TZ')))

    this.entriesEl.innerHTML = rows.map(line => {
      const n = `line ${line.n}`
      if (line.kind === 'env') {
        const bad = line.message ? ` ${line.message}` : ''
        const warn = line.env?.name === 'TZ'
          ? ' TZ= moves the schedule in some crons and only sets the job’s environment in others — write CRON_TZ= if you mean the schedule.'
          : ''
        return `<div data-type="cw-assign"${line.message ? ' data-bad' : ''}>`
          + `<span data-type="cw-entry-n">${escapeHtml(n)}</span>`
          + `<code data-type="cw-entry-expr">${escapeHtml(line.text.trim())}</code>`
          + `<span data-type="cw-entry-note">applies to every entry below this line.${escapeHtml(warn)}${escapeHtml(bad)}</span>`
          + '</div>'
      }
      if (line.kind === 'error') {
        return '<div data-type="cw-entry" data-bad>'
          + `<div data-type="cw-entry-head"><span data-type="cw-entry-n">${escapeHtml(n)}</span>`
          + `<code data-type="cw-entry-expr">${escapeHtml(cwClip(line.text.trim(), 90))}</code></div>`
          + `<span data-type="cw-entry-err">${escapeHtml(line.message ?? 'Not a schedule cron would accept.')}</span>`
          + '</div>'
      }

      const e = line.entry as CwCrontabEntry
      const zone = this.entryZone(e)
      const zoneChip = e.zone
        ? `<span data-type="cw-entry-zone" data-src="${escapeHtml(e.zoneSource ?? '')}"${e.zoneOk ? '' : ' data-bad'}>${escapeHtml(e.zone)}${e.zoneOk ? '' : ' (unknown)'}</span>`
        : `<span data-type="cw-entry-zone" data-src="default">${escapeHtml(this.zoneLabel())}</span>`

      let next: string
      if (e.parsed.reboot) {
        next = 'Next: at the next system startup.'
      } else {
        const run = lists[indexOf.get(e) as number].runs.find(r => r.fires)
        next = run
          ? `Next: ${fmtFor(zone).format(new Date(run.ms))} · ${cwRelFuture(run.ms, nowMs)}`
          : 'Next: nothing in the next 25 years — this schedule may never match.'
      }

      const notes: string[] = []
      if (e.user) notes.push(`Runs as ${e.user}.`)
      if (e.stdin !== null) {
        notes.push(`The % is not a character here: cron runs the command up to it and feeds “${cwClip(e.stdin.replace(/\n/g, ' '), 40)}” in on standard input. Write \\% for a literal percent.`)
      }
      if (!e.zoneOk && e.zone) notes.push(`${e.zone} is not a zone this browser knows, so this row uses ${this.zoneLabel()} instead.`)

      return '<div data-type="cw-entry">'
        + `<div data-type="cw-entry-head"><span data-type="cw-entry-n">${escapeHtml(n)}</span>`
        + `<code data-type="cw-entry-expr">${escapeHtml(e.schedule)}</code>${zoneChip}</div>`
        + `<span data-type="cw-entry-desc">${escapeHtml(cwDescribe(e.parsed))}</span>`
        + `<code data-type="cw-entry-cmd">${escapeHtml(cwClip(e.command, 160))}</code>`
        + `<span data-type="cw-entry-next">${escapeHtml(next)}</span>`
        + (notes.length ? `<span data-type="cw-entry-note">${escapeHtml(notes.join(' '))}</span>` : '')
        + '</div>'
    }).join('')
  }

  /**
   * The merged timeline. Every entry is resolved on its own clock and then
   * printed in one zone — the picker's — because a list whose rows are each in a
   * different zone cannot be read in order, which is the only thing this list is
   * for.
   */
  private renderTimeline(doc: CwCrontabDoc, lists: { entry: number; runs: CwRun[] }[], nowMs: number) {
    const want = this.settings.runs
    const rows = cwMergeRuns(lists, want)
    const fmt = cwRunFormatter(this.settings.zone, this.settings.hour12, false)
    const lines: string[] = []

    this.timelineEl.innerHTML = rows.map((row, i) => {
      const e = doc.entries[row.entry]
      const time = fmt.format(new Date(row.ms))
      const rel = cwRelFuture(row.ms, nowMs)
      const zoneNote = this.entryZone(e) === this.settings.zone ? '' : ` (scheduled in ${this.entryZone(e)})`
      const label = `line ${e.n} · ${e.schedule}${zoneNote} · ${cwClip(e.command, 60)}`
      const collide = row.collides ? ' — starts at the same instant as another entry.' : ''
      lines.push(`${time}  (${rel})  ${label}${collide}`)
      return `<li${row.collides ? ' data-collide' : ''}${row.run.dst ? ` data-dst="${row.run.dst}"` : ''}>`
        + `<span data-type="cw-run-idx">${i + 1}</span>`
        + `<span data-type="cw-run-time">${escapeHtml(time)}</span>`
        + `<span data-type="cw-run-rel">${escapeHtml(rel)}</span>`
        + `<span data-type="cw-run-flag">${escapeHtml(label + collide)}</span></li>`
    }).join('')
    this.lastRunsText = lines.join('\n')

    const reboots = doc.entries.filter(e => e.parsed.reboot).length
    const note: string[] = []
    if (rows.length === 0) {
      note.push(doc.entries.length ? 'None of these entries has an upcoming run.' : 'Nothing to show until there is an entry.')
    } else {
      note.push(`Every entry resolved on its own clock, then printed in ${this.zoneLabel()}.`)
      // Which jobs start together must not depend on how many rows are shown —
      // on a crontab with one frequent job the whole visible list is that job,
      // and the midnight pile-up everyone is actually looking for is off-screen.
      // So the answer comes from the window every entry has complete data for,
      // which reaches well past the rows above.
      const horizon = nowMs + CW_COLLIDE_WINDOW_MS
      const scan = doc.entries.map((e, entry) => ({
        entry,
        runs: e.parsed.reboot
          ? []
          : cwCollectRuns(e.parsed, nowMs, { count: CW_COLLIDE_MAX_RUNS, untilMs: horizon }, this.clockFor(this.entryZone(e), nowMs)),
      }))
      const { hits, busy } = cwCollisions(scan, horizon, CW_COLLIDE_MAX_RUNS)
      if (hits.length) {
        const soonest = hits[0]
        const lines = soonest.entries.map(i => `line ${doc.entries[i].n}`).join(' and ')
        const n = hits.length
        note.push(
          `${n} ${cwPlural(n, 'instant', 'instants')} in the next 24 hours ${cwPlural(n, 'has', 'have')} `
          + `more than one job starting — the soonest is ${fmt.format(new Date(soonest.ms))}, shared by ${lines}. `
          + 'Simultaneous starts are the usual reason a box stalls on the hour.',
        )
      } else if (doc.entries.length > 1 && busy.length < doc.entries.length) {
        note.push('No two of these entries start at the same instant in the next 24 hours.')
      }
      if (busy.length) {
        const lines = busy.map(i => `line ${doc.entries[i].n}`).join(', ')
        note.push(
          `${lines} ${cwPlural(busy.length, 'fires', 'fire')} more than ${CW_COLLIDE_MAX_RUNS} times a day, `
          + `so ${cwPlural(busy.length, 'it is', 'they are')} left out of that comparison — a job that frequent coincides with almost everything.`,
        )
      }
    }
    if (reboots) note.push(`${reboots} @reboot ${cwPlural(reboots, 'entry has', 'entries have')} no clock time and cannot appear here.`)
    this.tlNoteEl.textContent = note.join(' ')
  }

  /**
   * Daylight saving for the file: for each zone the crontab actually uses, the
   * next transitions, and which *lines* they break. "Two of your twelve jobs
   * vanish on 8 March" is the answer a crontab owner needs; per-expression it
   * has to be asked twelve times.
   */
  private renderCrontabDst(doc: CwCrontabDoc, nowMs: number) {
    if (doc.entries.length === 0) {
      this.dstEl.innerHTML = '<p data-type="cw-dst-none">No entries to check against a clock change.</p>'
      return
    }

    const byZone = new Map<string, number[]>()
    doc.entries.forEach((e, i) => {
      if (e.parsed.reboot) return
      const zone = this.entryZone(e)
      const list = byZone.get(zone)
      if (list) list.push(i)
      else byZone.set(zone, [i])
    })

    let html = ''
    for (const [zone, indices] of byZone) {
      const clock = this.clockFor(zone, nowMs)
      const transitions = clock.transitionsFrom(nowMs, 2, nowMs + CW_DST_HORIZON_MS)
      const named = zone === this.settings.zone ? this.zoneLabel() : zone
      const who = `${indices.length} ${cwPlural(indices.length, 'entry', 'entries')} in ${escapeHtml(named)}`
      if (transitions.length === 0) {
        html += `<p data-type="cw-dst-none">${who}: no offset change in the next 400 days, so none of those runs can be skipped or repeated.</p>`
        continue
      }
      html += `<p data-type="cw-dst-lead">${who} — ${transitions.length === 1 ? 'one clock change' : 'two clock changes'} ahead.</p>`
      html += transitions.map(t => this.crontabDstRow(doc, indices, clock, t)).join('')
    }
    this.dstEl.innerHTML = html
  }

  private crontabDstRow(doc: CwCrontabDoc, indices: number[], clock: CwZoneClock, t: CwTransition): string {
    const forward = t.after > t.before
    const zone = clock.zone
    const when = cwFmtDay(t.ms, zone)
    const shift = `${cwClockAt(t.ms, t.before)} becomes ${cwClockAt(t.ms, t.after)}`
    const offsets = `${cwOffsetLabel(t.before)} → ${cwOffsetLabel(t.after)}`

    const hits: string[] = []
    let clean = 0
    for (const i of indices) {
      const e = doc.entries[i]
      const window = cwCollectRuns(e.parsed, t.ms - CW_DST_WINDOW_MS, { untilMs: t.ms + CW_DST_WINDOW_MS }, clock)
      const affected = window.filter(r => r.dst === (forward ? 'gap' : 'first'))
      if (affected.length === 0) { clean++; continue }
      const n = affected.length
      const fixed = cwIsFixedTime(e.parsed)
      const what = forward
        ? fixed
          ? `${n} ${cwPlural(n, 'run', 'runs')} (${cwTimeList(affected)}) ${cwPlural(n, 'lands', 'land')} in the hour that never happens — made up at the jump.`
          : `${n} ${cwPlural(n, 'run', 'runs')} (${cwTimeList(affected)}) ${cwPlural(n, 'lands', 'land')} in the hour that never happens — lost, because the hour or minute field is a wildcard.`
        : fixed
          ? `${cwTimeList(affected)} ${cwPlural(n, 'comes', 'come')} round twice — cron holds a particular-time job to the first pass.`
          : `${n} ${cwPlural(n, 'run', 'runs')} (${cwTimeList(affected)}) ${cwPlural(n, 'happens', 'happen')} twice — a wildcard schedule follows the wall clock through both passes.`
      hits.push(`line ${e.n} · ${e.schedule} — ${what}`)
    }

    const summary = hits.length === 0
      ? 'No entry in this zone is scheduled inside the affected window.'
      : `${hits.length} of ${indices.length} ${cwPlural(indices.length, 'entry is', 'entries are')} affected${clean ? `; the other ${clean} ${cwPlural(clean, 'is', 'are')} untouched` : ''}.`

    return `<div data-type="cw-dst-row" data-dir="${forward ? 'forward' : 'back'}">`
      + `<span data-type="cw-dst-when">${escapeHtml(when)}</span>`
      + `<span data-type="cw-dst-shift">Clocks go ${forward ? 'forward' : 'back'} — ${escapeHtml(shift)} <small>(${escapeHtml(offsets)})</small></span>`
      + `<span data-type="cw-dst-effect">${escapeHtml(summary)}</span>`
      + hits.map(h => `<span data-type="cw-dst-hit">${escapeHtml(h)}</span>`).join('')
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
      case 'copy-timeline':
        this.copyText(this.lastRunsText, btn)
        break
      case 'sample':
        this.input.value = CW_SAMPLE_CRONTAB
        this.evaluate()
        this.input.focus()
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
    else if (key === 'systemUser') this.settings.systemUser = el.value === 'true'
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
      merged.systemUser = Boolean(merged.systemUser)
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
