/**
 * Epoch Wizard — a Unix / epoch timestamp converter, built to epochconverter.com parity.
 *
 * Five self-contained converters, all client-side:
 *   1. A live ticking current-epoch clock in seconds / milliseconds / microseconds
 *      / nanoseconds, each copy-able.
 *   2. Timestamp → human date, with auto unit detection by digit count
 *      (10 = s, 13 = ms, 16 = µs, 19 = ns) and a manual override, rendering the
 *      value as local time, UTC, ISO-8601, a relative "x ago", and the weekday.
 *   3. Human date → timestamp, parsing ISO / Y-M-D / M/D/Y / D-M-Y / RFC-2822 with
 *      a UTC-or-Local interpretation toggle, emitting the epoch in seconds and ms.
 *   4. Start / end of the year, month, and day for a chosen date (UTC or local).
 *   5. A duration breakdown turning a raw number of seconds into years / weeks /
 *      days / hours / minutes / seconds.
 * Plus copy-able get-current + convert code snippets in eleven languages, and
 * preferences (12/24-hour clock, show UTC, default input unit, default time zone)
 * that persist in localStorage. Press C to clear every form.
 *
 * Mounts as a WebComponent so it survives Astro's client-side View Transitions
 * (see the astro:page-load wiring in tools/[slug].astro). All module-level names
 * are ef-/EF_-prefixed because tool component files share one global script scope.
 */

import { flashBadge, flashLabel } from '../../../lib/flash'

type EfUnit = 'auto' | 's' | 'ms' | 'us' | 'ns'
type EfTz = 'utc' | 'local'

interface EfSettings {
  hour12: boolean
  showUTC: boolean
  unit: EfUnit
  tz: EfTz
}

const EF_LS_SETTINGS = 'epoch-wizard:settings:v1'
const EF_LS_TS = 'epoch-wizard:ts:v1'
const EF_LS_DATE = 'epoch-wizard:date:v1'
const EF_LS_SE = 'epoch-wizard:se:v1'
const EF_LS_DUR = 'epoch-wizard:dur:v1'

const EF_DEFAULTS: EfSettings = {
  hour12: false,
  showUTC: true,
  unit: 'auto',
  tz: 'local',
}

const EF_UNIT_LABEL: Record<Exclude<EfUnit, 'auto'>, string> = {
  s: 'seconds',
  ms: 'milliseconds',
  us: 'microseconds',
  ns: 'nanoseconds',
}

// ── Pure helpers (no DOM) ────────────────────────────────────────────────────

function efDigits(s: string): number {
  const m = s.trim().replace(/^[-+]/, '').match(/^\d+/)
  return m ? m[0].length : 0
}

/** Guess the unit of a raw integer timestamp from its digit count. */
function efDetectUnit(raw: string): Exclude<EfUnit, 'auto'> {
  const n = efDigits(raw)
  if (n >= 18) return 'ns'
  if (n >= 15) return 'us'
  if (n >= 12) return 'ms'
  return 's'
}

/** Convert a raw timestamp string in the given unit to milliseconds (number). */
function efToMs(raw: string, unit: Exclude<EfUnit, 'auto'>): number | null {
  const t = raw.trim()
  if (!/^[-+]?\d+$/.test(t)) return null
  try {
    const big = BigInt(t)
    switch (unit) {
      case 's': return Number(big) * 1000
      case 'ms': return Number(big)
      case 'us': return Number(big / 1000n)
      case 'ns': return Number(big / 1000000n)
    }
  } catch {
    return null
  }
}

function efIsValid(d: Date): boolean {
  return !Number.isNaN(d.getTime())
}

/** Format a Date as a full human string, honouring 12/24h and UTC-or-local. */
function efFormatDate(d: Date, utc: boolean, hour12: boolean): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12,
    timeZoneName: 'short',
  }
  if (utc) opts.timeZone = 'UTC'
  return new Intl.DateTimeFormat('en-US', opts).format(d)
}

/** ISO-8601 in UTC (…Z). */
function efISO(d: Date): string {
  return d.toISOString()
}

/** A relative "x ago" / "in x" string picking the largest sensible unit. */
function efRelative(ms: number, now: number): string {
  const diff = ms - now // +future, -past
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31557600000],
    ['month', 2629800000],
    ['week', 604800000],
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
    ['second', 1000],
  ]
  for (const [unit, span] of units) {
    if (abs >= span || unit === 'second') {
      return rtf.format(Math.round(diff / span), unit)
    }
  }
  return 'now'
}

/**
 * Parse a human date string. Explicit-offset ISO strings are taken as-is; bare
 * Y-M-D / M/D/Y / D-M-Y (with an optional time and am/pm) are built in UTC or in
 * local time per `tz`; anything else falls back to the engine's own Date parser.
 * Returns epoch milliseconds, or null when unparseable.
 */
function efParseHuman(input: string, tz: EfTz): number | null {
  const s = input.trim()
  if (!s) return null

  // Explicit time zone (Z or ±hh[:]mm) → the offset already pins the instant.
  // Guard: only when a time is actually present, so a bare D-M-Y date like
  // "14-07-2026" isn't misread as a "-2026" offset and dropped.
  const hasTime = /\d{1,2}:\d{2}/.test(s)
  if (hasTime && /(?:z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s)
    return efIsValid(d) ? d.getTime() : null
  }

  // Split off an optional time part.
  const timeMatch = s.match(/(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(am|pm)?/i)
  let hh = 0, mi = 0, ss = 0, msPart = 0
  if (timeMatch) {
    const rawHour = parseInt(timeMatch[1], 10)
    mi = parseInt(timeMatch[2], 10)
    ss = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0
    msPart = timeMatch[4] ? parseInt(timeMatch[4].padEnd(3, '0'), 10) : 0
    const ap = timeMatch[5]?.toLowerCase()
    if (mi > 59 || ss > 59 || (ap ? rawHour < 1 || rawHour > 12 : rawHour > 23)) return null
    hh = rawHour
    if (ap === 'pm' && hh < 12) hh += 12
    if (ap === 'am' && hh === 12) hh = 0
  }

  const datePart = s.split(/[ tT]/)[0]
  let y: number | null = null, mo: number | null = null, da: number | null = null

  let m: RegExpMatchArray | null
  if ((m = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    y = +m[1]; mo = +m[2]; da = +m[3]
  } else if ((m = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    mo = +m[1]; da = +m[2]; y = +m[3] // M/D/Y (US)
  } else if ((m = datePart.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/))) {
    da = +m[1]; mo = +m[2]; y = +m[3] // D-M-Y
  }

  if (y !== null && mo !== null && da !== null) {
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null
    const date = tz === 'utc'
      ? new Date(Date.UTC(y, mo - 1, da, hh, mi, ss, msPart))
      : new Date(y, mo - 1, da, hh, mi, ss, msPart)
    const parts = tz === 'utc'
      ? [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
      : [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]
    return parts.every((part, i) => part === [y, mo, da, hh, mi, ss][i]) ? date.getTime() : null
  }

  // Fallback: let the platform try (RFC-2822, "July 14 2026", etc.).
  const d = new Date(s)
  return efIsValid(d) ? d.getTime() : null
}

interface EfBreakdown { label: string; value: number }

/** Decompose a raw number of seconds into years / weeks / days / h / m / s. */
function efBreakdown(totalSeconds: number): EfBreakdown[] {
  let rem = Math.abs(Math.trunc(totalSeconds))
  const spans: [string, number][] = [
    ['year', 31557600], // 365.25 days
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ]
  const out: EfBreakdown[] = []
  for (const [label, span] of spans) {
    const v = Math.floor(rem / span)
    rem -= v * span
    out.push({ label, value: v })
  }
  return out
}

/** get-current + convert-this-epoch code snippets keyed by language. */
function efSnippets(sec: number): { lang: string; code: string }[] {
  const S = sec
  return [
    { lang: 'JavaScript', code: `Math.floor(Date.now() / 1000)\nnew Date(${S} * 1000).toLocaleString()` },
    { lang: 'Python', code: `import time; int(time.time())\nimport datetime; datetime.datetime.fromtimestamp(${S})` },
    { lang: 'Go', code: `time.Now().Unix()\ntime.Unix(${S}, 0)` },
    { lang: 'Java', code: `System.currentTimeMillis() / 1000L;\nnew java.util.Date(${S}L * 1000);` },
    { lang: 'PHP', code: `time();\ndate('r', ${S});` },
    { lang: 'Ruby', code: `Time.now.to_i\nTime.at(${S})` },
    { lang: 'C#', code: `DateTimeOffset.Now.ToUnixTimeSeconds();\nDateTimeOffset.FromUnixTimeSeconds(${S}).LocalDateTime;` },
    { lang: 'Rust', code: `std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs()\nchrono::DateTime::from_timestamp(${S}, 0)` },
    { lang: 'PostgreSQL', code: `SELECT EXTRACT(EPOCH FROM now());\nSELECT to_timestamp(${S});` },
    { lang: 'MySQL', code: `SELECT UNIX_TIMESTAMP(NOW());\nSELECT FROM_UNIXTIME(${S});` },
    { lang: 'Shell', code: `date +%s\ndate -d @${S}   # macOS: date -r ${S}` },
  ]
}

function efEsc(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

// ── WebComponent ─────────────────────────────────────────────────────────────

class EpochWizardTool extends HTMLElement {
  private settings: EfSettings = { ...EF_DEFAULTS }
  private root!: HTMLElement
  private tickTimer = 0
  private statusEl!: HTMLElement

  private onKeydown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
    if (!typing && (e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      this.clearAll()
    }
  }

  connectedCallback() {
    this.settings = this.loadSettings()
    const nowSec = Math.floor(Date.now() / 1000)

    this.innerHTML = `
      <div data-type="tool-page" data-tool="epoch-wizard">
        <div data-type="tool-header">
          <h1>Epoch Wizard</h1>
          <p>Convert Unix / epoch timestamps to human dates and back. A live clock in seconds, milliseconds, microseconds and nanoseconds; auto unit detection; UTC and local time; start/end-of-period epochs; a duration breakdown; and copy-ready code in eleven languages. Everything runs in your browser — press <kbd>C</kbd> to clear every form.</p>
        </div>

        <div data-group="toolbar">
          <button data-action="now" type="button">Use current time</button>
          <button data-action="clear" type="button">Clear all (C)</button>
          <details data-type="ew-prefs">
            <summary>Preferences</summary>
            <div data-group="prefs">
              <label data-type="ew-field"><span>Clock</span>
                <select data-control="hour12" aria-label="Clock format">
                  <option value="false">24-hour</option>
                  <option value="true">12-hour</option>
                </select>
              </label>
              <label data-type="ew-field"><span>Dates</span>
                <select data-control="showUTC" aria-label="Show UTC">
                  <option value="true">Local + UTC</option>
                  <option value="false">Only local</option>
                </select>
              </label>
              <label data-type="ew-field"><span>Default unit</span>
                <select data-control="unit" aria-label="Default timestamp unit">
                  <option value="auto">Auto-detect</option>
                  <option value="s">Seconds</option>
                  <option value="ms">Milliseconds</option>
                  <option value="us">Microseconds</option>
                  <option value="ns">Nanoseconds</option>
                </select>
              </label>
              <label data-type="ew-field"><span>Date input zone</span>
                <select data-control="tz" aria-label="Default time zone for date input">
                  <option value="local">Local time</option>
                  <option value="utc">UTC / GMT</option>
                </select>
              </label>
            </div>
          </details>
        </div>

        <section data-type="ew-card" data-card="clock" aria-labelledby="ew-clock-h">
          <h2 id="ew-clock-h">The current Unix epoch time</h2>
          <div data-type="ew-clock">
            ${(['s', 'ms', 'us', 'ns'] as const).map(u => `
              <div data-type="ew-clock-row">
                <span data-type="ew-clock-label">${EF_UNIT_LABEL[u]}</span>
                <output data-clock="${u}" aria-live="off">—</output>
                <button data-action="copy-clock" data-unit="${u}" type="button" aria-label="Copy ${EF_UNIT_LABEL[u]}">Copy</button>
              </div>
            `).join('')}
          </div>
        </section>

        <section data-type="ew-card" data-card="ts2date" aria-labelledby="ew-ts-h">
          <h2 id="ew-ts-h">Timestamp → human date</h2>
          <div data-group="ew-inputrow">
            <input data-input="ts" type="text" inputmode="numeric" spellcheck="false" autocomplete="off"
              placeholder="e.g. ${nowSec}" aria-label="Unix timestamp" value="" />
            <label data-type="ew-field"><span>Unit</span>
              <select data-input="ts-unit" aria-label="Interpret timestamp as">
                <option value="auto">Auto</option>
                <option value="s">Seconds</option>
                <option value="ms">Milliseconds</option>
                <option value="us">Microseconds</option>
                <option value="ns">Nanoseconds</option>
              </select>
            </label>
            <button data-action="ts-now" type="button">Now</button>
          </div>
          <dl data-type="ew-results" data-for="ts2date"></dl>
        </section>

        <section data-type="ew-card" data-card="date2ts" aria-labelledby="ew-d2t-h">
          <h2 id="ew-d2t-h">Human date → timestamp</h2>
          <div data-group="ew-inputrow">
            <input data-input="date" type="text" spellcheck="false" autocomplete="off"
              placeholder="e.g. 2026-07-14 15:30:00" aria-label="Human date" value="" />
            <label data-type="ew-field"><span>Interpret as</span>
              <select data-input="date-tz" aria-label="Interpret date as">
                <option value="local">Local time</option>
                <option value="utc">UTC / GMT</option>
              </select>
            </label>
            <button data-action="date-now" type="button">Now</button>
          </div>
          <p data-type="ew-hint">Accepts ISO-8601, <code>Y-M-D</code>, <code>M/D/Y</code>, <code>D-M-Y</code>, and RFC-2822. Add <code>Z</code> or an offset to pin the zone explicitly.</p>
          <dl data-type="ew-results" data-for="date2ts"></dl>
        </section>

        <section data-type="ew-card" data-card="startend" aria-labelledby="ew-se-h">
          <h2 id="ew-se-h">Start &amp; end of year / month / day</h2>
          <div data-group="ew-inputrow">
            <input data-input="se" type="text" spellcheck="false" autocomplete="off"
              placeholder="e.g. 2026-07-14" aria-label="Date for start/end epochs" value="" />
            <label data-type="ew-field"><span>Zone</span>
              <select data-input="se-tz" aria-label="Zone for start/end epochs">
                <option value="local">Local time</option>
                <option value="utc">UTC / GMT</option>
              </select>
            </label>
            <button data-action="se-now" type="button">Today</button>
          </div>
          <dl data-type="ew-results" data-for="startend"></dl>
        </section>

        <section data-type="ew-card" data-card="duration" aria-labelledby="ew-dur-h">
          <h2 id="ew-dur-h">Seconds → duration</h2>
          <div data-group="ew-inputrow">
            <input data-input="dur" type="text" inputmode="numeric" spellcheck="false" autocomplete="off"
              placeholder="e.g. 90061" aria-label="A number of seconds" value="" />
          </div>
          <dl data-type="ew-results" data-for="duration"></dl>
        </section>

        <details data-type="ew-snippets">
          <summary>Code — get &amp; convert this epoch</summary>
          <p data-type="ew-hint">The first line gets the current epoch; the second converts the timestamp above (or the current time) to a date. Click any block to copy.</p>
          <div data-type="ew-snippet-grid"></div>
        </details>

        <div data-type="ew-statusbar">
          <span data-type="ew-status" role="status" aria-live="polite"></span>
        </div>

        <details data-type="ew-explainer">
          <summary>What is the Unix epoch?</summary>
          <p>The <strong>Unix epoch</strong> (Unix time, POSIX time) is the number of seconds since 1970-01-01 00:00:00 UTC, not counting leap seconds. Timestamps commonly appear in seconds (10 digits), milliseconds (13), microseconds (16) or nanoseconds (19) — this tool detects which by digit count, or you can force a unit. Dates render in both your local zone and UTC. Signed 32-bit systems overflow on 2038-01-19, the “Year 2038 problem”. Everything here runs locally; your inputs are remembered in your browser and never uploaded.</p>
        </details>
      </div>
    `

    this.root = this.querySelector('[data-type="tool-page"]') as HTMLElement
    this.statusEl = this.querySelector('[data-type="ew-status"]') as HTMLElement

    this.reflectSettings()
    this.restoreInputs()

    // Wire converter inputs → recompute.
    this.q('[data-input="ts"]').addEventListener('input', () => { this.renderTs2Date(); this.renderSnippets(); this.persistInputs() })
    this.q('[data-input="ts-unit"]').addEventListener('change', () => { this.renderTs2Date(); this.renderSnippets() })
    this.q('[data-input="date"]').addEventListener('input', () => { this.renderDate2Ts(); this.persistInputs() })
    this.q('[data-input="date-tz"]').addEventListener('change', () => this.renderDate2Ts())
    this.q('[data-input="se"]').addEventListener('input', () => { this.renderStartEnd(); this.persistInputs() })
    this.q('[data-input="se-tz"]').addEventListener('change', () => this.renderStartEnd())
    this.q('[data-input="dur"]').addEventListener('input', () => { this.renderDuration(); this.persistInputs() })

    // Preferences.
    this.root.querySelectorAll<HTMLSelectElement>('[data-control]').forEach(el =>
      el.addEventListener('change', () => this.onPrefChange(el)))

    // Buttons.
    this.root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn =>
      btn.addEventListener('click', () => this.onAction(btn.dataset.action as string, btn)))

    this.addEventListener('keydown', this.onKeydown)

    // Initial render + start the clock.
    this.tick()
    this.tickTimer = window.setInterval(() => this.tick(), 250)
    this.renderAll()
  }

  disconnectedCallback() {
    window.clearInterval(this.tickTimer)
    this.removeEventListener('keydown', this.onKeydown)
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.querySelector(sel) as T
  }

  // ── the live clock ─────────────────────────────────────────────────────────
  private tick() {
    const now = Date.now()
    const big = BigInt(now)
    const vals: Record<string, string> = {
      s: String(Math.floor(now / 1000)),
      ms: String(now),
      us: String(big * 1000n),
      ns: String(big * 1000000n),
    }
    for (const u of ['s', 'ms', 'us', 'ns']) {
      const el = this.root.querySelector(`[data-clock="${u}"]`)
      if (el) el.textContent = vals[u]
    }
  }

  // ── rendering ──────────────────────────────────────────────────────────────
  private renderAll() {
    this.renderTs2Date()
    this.renderDate2Ts()
    this.renderStartEnd()
    this.renderDuration()
    this.renderSnippets()
  }

  private rowsHtml(rows: { k: string; v: string; copy?: string }[]): string {
    return rows.map(r => `
      <div data-type="ew-row">
        <dt>${efEsc(r.k)}</dt>
        <dd>
          <span data-type="ew-val">${efEsc(r.v)}</span>
          ${r.copy !== undefined ? `<button data-action="copy-text" data-copy="${efEsc(r.copy)}" type="button" aria-label="Copy ${efEsc(r.k)}">Copy</button>` : ''}
        </dd>
      </div>`).join('')
  }

  private setResults(forKey: string, html: string) {
    const el = this.root.querySelector(`[data-for="${forKey}"]`)
    if (el) el.innerHTML = html
  }

  private renderTs2Date() {
    const raw = (this.q('[data-input="ts"]') as HTMLInputElement).value.trim()
    const sel = (this.q('[data-input="ts-unit"]') as HTMLSelectElement).value as EfUnit
    if (!raw) { this.setResults('ts2date', this.emptyHint('Enter a timestamp above.')); return }
    if (!/^[-+]?\d+$/.test(raw)) { this.setResults('ts2date', this.errHint('Not a whole number.')); return }

    const unit = sel === 'auto' ? efDetectUnit(raw) : sel
    const ms = efToMs(raw, unit)
    if (ms === null) { this.setResults('ts2date', this.errHint('Could not read that timestamp.')); return }
    const d = new Date(ms)
    if (!efIsValid(d)) { this.setResults('ts2date', this.errHint('Out of range.')); return }

    const now = Date.now()
    const rows: { k: string; v: string; copy?: string }[] = [
      { k: 'Detected unit', v: EF_UNIT_LABEL[unit] + (sel === 'auto' ? ' (auto)' : '') },
      { k: 'Local time', v: efFormatDate(d, false, this.settings.hour12), copy: efFormatDate(d, false, this.settings.hour12) },
    ]
    if (this.settings.showUTC) {
      rows.push({ k: 'UTC / GMT', v: efFormatDate(d, true, this.settings.hour12), copy: efFormatDate(d, true, this.settings.hour12) })
    }
    rows.push({ k: 'ISO 8601', v: efISO(d), copy: efISO(d) })
    rows.push({ k: 'Relative', v: efRelative(ms, now) })
    this.setResults('ts2date', this.rowsHtml(rows))
  }

  private renderDate2Ts() {
    const raw = (this.q('[data-input="date"]') as HTMLInputElement).value.trim()
    const tz = (this.q('[data-input="date-tz"]') as HTMLSelectElement).value as EfTz
    if (!raw) { this.setResults('date2ts', this.emptyHint('Enter a date above.')); return }
    const ms = efParseHuman(raw, tz)
    if (ms === null) { this.setResults('date2ts', this.errHint('Could not parse that date.')); return }
    const sec = Math.floor(ms / 1000)
    const rows = [
      { k: 'Epoch (seconds)', v: String(sec), copy: String(sec) },
      { k: 'Epoch (milliseconds)', v: String(ms), copy: String(ms) },
      { k: 'ISO 8601 (UTC)', v: efISO(new Date(ms)), copy: efISO(new Date(ms)) },
      { k: 'Interpreted', v: efFormatDate(new Date(ms), tz === 'utc', this.settings.hour12) },
    ]
    this.setResults('date2ts', this.rowsHtml(rows))
  }

  private renderStartEnd() {
    const raw = (this.q('[data-input="se"]') as HTMLInputElement).value.trim()
    const tz = (this.q('[data-input="se-tz"]') as HTMLSelectElement).value as EfTz
    if (!raw) { this.setResults('startend', this.emptyHint('Enter a date above.')); return }
    const ms = efParseHuman(raw, tz)
    if (ms === null) { this.setResults('startend', this.errHint('Could not parse that date.')); return }
    const d = new Date(ms)
    const y = tz === 'utc' ? d.getUTCFullYear() : d.getFullYear()
    const mo = tz === 'utc' ? d.getUTCMonth() : d.getMonth()
    const da = tz === 'utc' ? d.getUTCDate() : d.getDate()
    const mk = (yy: number, mm: number, dd: number, h = 0, mi = 0, s = 0, msc = 0) =>
      tz === 'utc' ? Date.UTC(yy, mm, dd, h, mi, s, msc) : new Date(yy, mm, dd, h, mi, s, msc).getTime()

    const dayStart = mk(y, mo, da)
    const dayEnd = mk(y, mo, da, 23, 59, 59)
    const monStart = mk(y, mo, 1)
    const monEnd = mk(y, mo + 1, 0, 23, 59, 59) // day 0 of next month = last day
    const yrStart = mk(y, 0, 1)
    const yrEnd = mk(y, 11, 31, 23, 59, 59)

    const sec = (n: number) => String(Math.floor(n / 1000))
    const rows = [
      { k: 'Start of day', v: sec(dayStart), copy: sec(dayStart) },
      { k: 'End of day', v: sec(dayEnd), copy: sec(dayEnd) },
      { k: 'Start of month', v: sec(monStart), copy: sec(monStart) },
      { k: 'End of month', v: sec(monEnd), copy: sec(monEnd) },
      { k: 'Start of year', v: sec(yrStart), copy: sec(yrStart) },
      { k: 'End of year', v: sec(yrEnd), copy: sec(yrEnd) },
    ]
    this.setResults('startend', this.rowsHtml(rows))
  }

  private renderDuration() {
    const raw = (this.q('[data-input="dur"]') as HTMLInputElement).value.trim()
    if (!raw) { this.setResults('duration', this.emptyHint('Enter a number of seconds above.')); return }
    if (!/^[-+]?\d+$/.test(raw)) { this.setResults('duration', this.errHint('Not a whole number.')); return }
    const total = Number(raw)
    const parts = efBreakdown(total).filter(p => p.value !== 0)
    const pretty = parts.length
      ? parts.map(p => `${p.value} ${p.label}${p.value === 1 ? '' : 's'}`).join(', ')
      : '0 seconds'
    const rows = [
      { k: 'Breakdown', v: (total < 0 ? '−' : '') + pretty, copy: pretty },
      { k: 'Total minutes', v: (total / 60).toLocaleString('en-US', { maximumFractionDigits: 4 }) },
      { k: 'Total hours', v: (total / 3600).toLocaleString('en-US', { maximumFractionDigits: 4 }) },
      { k: 'Total days', v: (total / 86400).toLocaleString('en-US', { maximumFractionDigits: 4 }) },
    ]
    this.setResults('duration', this.rowsHtml(rows))
  }

  private renderSnippets() {
    const raw = (this.q('[data-input="ts"]') as HTMLInputElement).value.trim()
    let sec = Math.floor(Date.now() / 1000)
    if (/^[-+]?\d+$/.test(raw)) {
      const sel = (this.q('[data-input="ts-unit"]') as HTMLSelectElement).value as EfUnit
      const unit = sel === 'auto' ? efDetectUnit(raw) : sel
      const ms = efToMs(raw, unit)
      if (ms !== null) sec = Math.floor(ms / 1000)
    }
    const grid = this.root.querySelector('[data-type="ew-snippet-grid"]')
    if (!grid) return
    grid.innerHTML = efSnippets(sec).map(s => `
      <button data-type="ew-snippet" data-action="copy-snippet" type="button" aria-label="Copy ${s.lang} snippet">
        <span data-type="ew-snippet-lang">${efEsc(s.lang)}</span>
        <code>${efEsc(s.code)}</code>
      </button>`).join('')
  }

  private emptyHint(msg: string): string {
    return `<div data-type="ew-row" data-empty><dd><span data-type="ew-val" data-muted>${efEsc(msg)}</span></dd></div>`
  }

  private errHint(msg: string): string {
    return `<div data-type="ew-row" data-error><dd><span data-type="ew-val">${efEsc(msg)}</span></dd></div>`
  }

  // ── actions ──────────────────────────────────────────────────────────────
  private onAction(action: string, btn: HTMLButtonElement) {
    switch (action) {
      case 'now':
        this.fillNow()
        break
      case 'clear':
        this.clearAll()
        break
      case 'ts-now':
        (this.q('[data-input="ts"]') as HTMLInputElement).value = String(Math.floor(Date.now() / 1000))
        this.renderTs2Date(); this.renderSnippets(); this.persistInputs()
        break
      case 'date-now':
        (this.q('[data-input="date"]') as HTMLInputElement).value = this.localInputString(new Date())
        this.renderDate2Ts(); this.persistInputs()
        break
      case 'se-now':
        (this.q('[data-input="se"]') as HTMLInputElement).value = this.localInputString(new Date()).split(' ')[0]
        this.renderStartEnd(); this.persistInputs()
        break
      case 'copy-clock': {
        const u = btn.dataset.unit as string
        const el = this.root.querySelector(`[data-clock="${u}"]`)
        this.copyText(el?.textContent ?? '', btn)
        break
      }
      case 'copy-text':
        this.copyText(btn.dataset.copy ?? '', btn)
        break
      case 'copy-snippet':
        this.copyText(btn.querySelector('code')?.textContent ?? '', btn)
        break
    }
  }

  private fillNow() {
    const now = new Date()
    ;(this.q('[data-input="ts"]') as HTMLInputElement).value = String(Math.floor(now.getTime() / 1000))
    ;(this.q('[data-input="date"]') as HTMLInputElement).value = this.localInputString(now)
    ;(this.q('[data-input="se"]') as HTMLInputElement).value = this.localInputString(now).split(' ')[0]
    this.renderAll()
    this.persistInputs()
    this.setStatus('Filled every form with the current time.')
  }

  private clearAll() {
    ;['ts', 'date', 'se', 'dur'].forEach(k => { (this.q(`[data-input="${k}"]`) as HTMLInputElement).value = '' })
    this.renderAll()
    this.persistInputs()
    this.setStatus('Cleared all forms.')
    ;(this.q('[data-input="ts"]') as HTMLInputElement).focus()
  }

  /** "YYYY-MM-DD HH:MM:SS" in local time — a value efParseHuman reads back exactly. */
  private localInputString(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }

  private async copyText(text: string, btn: HTMLButtonElement) {
    if (!text) { this.setStatus('Nothing to copy.'); return }
    try {
      await navigator.clipboard.writeText(text)
      this.flash(btn, 'Copied!')
      this.setStatus('Copied to clipboard.')
    } catch {
      this.flash(btn, 'Failed')
      this.setStatus('Copy failed — clipboard access was blocked.')
    }
  }

  private flash(btn: HTMLButtonElement, label: string) {
    // Snippet buttons hold markup — flash a data-attr badge instead of the text.
    if (btn.dataset.action === 'copy-snippet') { flashBadge(btn, label, 1200); return }
    flashLabel(btn, label, 1200)
  }

  private setStatus(label: string) {
    this.statusEl.textContent = label
  }

  // ── preferences + persistence ────────────────────────────────────────────
  private onPrefChange(el: HTMLSelectElement) {
    const key = el.dataset.control as keyof EfSettings
    const v = el.value
    if (key === 'hour12' || key === 'showUTC') (this.settings[key] as boolean) = v === 'true'
    else if (key === 'unit') this.settings.unit = v as EfUnit
    else if (key === 'tz') this.settings.tz = v as EfTz
    this.saveSettings()
    // A changed default unit / zone should flow into the converter selects too.
    if (key === 'unit') (this.q('[data-input="ts-unit"]') as HTMLSelectElement).value = this.settings.unit
    if (key === 'tz') {
      (this.q('[data-input="date-tz"]') as HTMLSelectElement).value = this.settings.tz
      ;(this.q('[data-input="se-tz"]') as HTMLSelectElement).value = this.settings.tz
    }
    this.renderAll()
  }

  private reflectSettings() {
    this.root.querySelectorAll<HTMLSelectElement>('[data-control]').forEach(el => {
      const key = el.dataset.control as keyof EfSettings
      el.value = String(this.settings[key])
    })
    ;(this.q('[data-input="ts-unit"]') as HTMLSelectElement).value = this.settings.unit
    ;(this.q('[data-input="date-tz"]') as HTMLSelectElement).value = this.settings.tz
    ;(this.q('[data-input="se-tz"]') as HTMLSelectElement).value = this.settings.tz
  }

  private restoreInputs() {
    const set = (k: string, ls: string) => {
      const v = this.readLS(ls)
      if (v !== null) (this.q(`[data-input="${k}"]`) as HTMLInputElement).value = v
    }
    set('ts', EF_LS_TS)
    set('date', EF_LS_DATE)
    set('se', EF_LS_SE)
    set('dur', EF_LS_DUR)
  }

  private persistInputs() {
    this.writeLS(EF_LS_TS, (this.q('[data-input="ts"]') as HTMLInputElement).value)
    this.writeLS(EF_LS_DATE, (this.q('[data-input="date"]') as HTMLInputElement).value)
    this.writeLS(EF_LS_SE, (this.q('[data-input="se"]') as HTMLInputElement).value)
    this.writeLS(EF_LS_DUR, (this.q('[data-input="dur"]') as HTMLInputElement).value)
  }

  private loadSettings(): EfSettings {
    const raw = this.readLS(EF_LS_SETTINGS)
    if (!raw) return { ...EF_DEFAULTS }
    try {
      const p = JSON.parse(raw) as Partial<EfSettings>
      const merged = { ...EF_DEFAULTS, ...p }
      if (!['auto', 's', 'ms', 'us', 'ns'].includes(merged.unit)) merged.unit = EF_DEFAULTS.unit
      if (!['utc', 'local'].includes(merged.tz)) merged.tz = EF_DEFAULTS.tz
      merged.hour12 = Boolean(merged.hour12)
      merged.showUTC = Boolean(merged.showUTC)
      return merged
    } catch {
      return { ...EF_DEFAULTS }
    }
  }

  private saveSettings() {
    this.writeLS(EF_LS_SETTINGS, JSON.stringify(this.settings))
  }

  private readLS(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  }

  private writeLS(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* ignore quota / private-mode */ }
  }
}

if (!customElements.get('epoch-wizard-tool')) {
  customElements.define('epoch-wizard-tool', EpochWizardTool)
}

export {}
