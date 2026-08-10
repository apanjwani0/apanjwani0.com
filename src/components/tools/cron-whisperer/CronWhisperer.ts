/**
 * Cron Whisperer — a cron expression explainer, built to crontab.guru parity.
 *
 * Paste a standard 5-field cron expression (or a 6-field one with a leading
 * seconds field, or an @nickname) and get, entirely client-side:
 *   1. A plain-English description in crontab.guru's phrasing style
 *      ("At 22:00 on every day-of-week from Monday through Friday.").
 *   2. The next N run times, in your local zone or UTC, each with a relative
 *      "in x", computed by a field-jumping iterator (no minute-by-minute grind).
 *   3. A per-field breakdown showing each field's raw token and expanded values.
 *   4. A frequency read-out ("Runs 96 times in the next 24 hours.").
 * Plus clickable common examples, an ASCII field legend, month/weekday names
 * (JAN-DEC, SUN-SAT), the day-of-month/day-of-week OR quirk (and a note about
 * it), and preferences (zone, clock, runs to show) persisted in localStorage.
 * Press C to clear; Ctrl/Cmd+Enter copies the description.
 *
 * Mounts as a WebComponent so it survives Astro's client-side View Transitions
 * (see the astro:page-load wiring in tools/[slug].astro). All module-level names
 * are cw-/CW_-prefixed because tool component files share one global script scope.
 */

// ── Types ────────────────────────────────────────────────────────────────────

type CwKind = 'second' | 'minute' | 'hour' | 'dom' | 'month' | 'dow'

interface CwSingle {
  kind: 'all' | 'stepAll' | 'range' | 'rangeStep' | 'single'
  step?: number
  a?: number
  b?: number
  v?: number
}

interface CwField {
  token: string
  values: number[] // sorted, unique, expanded (dow normalised 7 → 0)
  restricted: boolean // true when the token is not a bare "*"
  single: CwSingle | null // structured shape when there is exactly one part (no comma)
}

interface CwParsed {
  reboot?: boolean
  hasSeconds: boolean
  second: CwField
  minute: CwField
  hour: CwField
  dom: CwField
  month: CwField
  dow: CwField
  normalized: string
  nickname?: string
}

interface CwSettings {
  zone: 'local' | 'utc'
  hour12: boolean
  runs: number // 5 | 10 | 20
}

// ── Constants ────────────────────────────────────────────────────────────────

const CW_LS_EXPR = 'cron-whisperer:expr:v1'
const CW_LS_SETTINGS = 'cron-whisperer:settings:v1'

const CW_DEFAULTS: CwSettings = { zone: 'local', hour12: false, runs: 5 }

const CW_MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const CW_DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const CW_MONTH_MAP: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9,
  sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
}
const CW_DOW_MAP: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
}

const CW_NICKNAMES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

const CW_FIELD_LABEL: Record<CwKind, string> = {
  second: 'second', minute: 'minute', hour: 'hour',
  dom: 'day-of-month', month: 'month', dow: 'day-of-week',
}

const CW_FIELD_RANGE: Record<CwKind, [number, number]> = {
  second: [0, 59], minute: [0, 59], hour: [0, 23],
  dom: [1, 31], month: [1, 12], dow: [0, 7],
}

// ── Pure helpers (no DOM) ─────────────────────────────────────────────────────

function cwPad2(n: number): string {
  return String(n).padStart(2, '0')
}

function cwOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** Natural-language list join with an Oxford comma: [a] → "a"; [a,b] → "a and b". */
function cwJoin(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

function cwMonthName(v: number): string {
  return CW_MONTH_NAMES[v] ?? String(v)
}

function cwDowName(v: number): string {
  return CW_DOW_NAMES[v === 7 ? 0 : v] ?? String(v)
}

/** Resolve a single field endpoint (number or JAN/MON-style name) to an integer. */
function cwResolve(str: string, kind: CwKind): number {
  const s = str.trim().toLowerCase()
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  if (kind === 'month' && s in CW_MONTH_MAP) return CW_MONTH_MAP[s]
  if (kind === 'dow' && s in CW_DOW_MAP) return CW_DOW_MAP[s]
  throw new Error(`"${str}" is not a valid ${CW_FIELD_LABEL[kind]} value.`)
}

/** Analyse a one-part token into a structured shape used for the description. */
function cwAnalyzeSingle(part: string, min: number, max: number, kind: CwKind): CwSingle {
  const slash = part.indexOf('/')
  let base = part
  let step = 1
  let hasStep = false
  if (slash >= 0) {
    base = part.slice(0, slash)
    step = parseInt(part.slice(slash + 1), 10)
    hasStep = true
  }
  if (base === '*') return hasStep ? { kind: 'stepAll', step } : { kind: 'all' }
  const dash = base.indexOf('-')
  if (dash > 0) {
    const a = cwResolve(base.slice(0, dash), kind)
    const b = cwResolve(base.slice(dash + 1), kind)
    return hasStep ? { kind: 'rangeStep', a, b, step } : { kind: 'range', a, b }
  }
  const v = cwResolve(base, kind)
  if (hasStep) return { kind: 'rangeStep', a: v, b: max, step }
  return { kind: 'single', v }
}

/** Parse and expand one cron field. Throws Error with a human message on bad input. */
function cwParseField(raw: string, kind: CwKind): CwField {
  const [min, max] = CW_FIELD_RANGE[kind]
  const label = CW_FIELD_LABEL[kind]
  const token = raw.trim()
  if (!token) throw new Error(`The ${label} field is empty.`)

  const parts = token.split(',')
  const values = new Set<number>()
  const norm = (v: number) => (kind === 'dow' && v === 7 ? 0 : v)

  for (const p of parts) {
    if (p === '') throw new Error(`The ${label} field has an empty list item.`)
    let base = p
    let step = 1
    let hasStep = false
    const slash = p.indexOf('/')
    if (slash >= 0) {
      base = p.slice(0, slash)
      const stepStr = p.slice(slash + 1)
      if (!/^\d+$/.test(stepStr)) throw new Error(`Step "/${stepStr}" in the ${label} field must be a whole number.`)
      step = parseInt(stepStr, 10)
      if (step < 1) throw new Error(`Step in the ${label} field must be at least 1.`)
      hasStep = true
    }

    let lo: number
    let hi: number
    if (base === '*') {
      lo = min
      hi = max
    } else {
      const dash = base.indexOf('-')
      if (dash > 0) {
        lo = cwResolve(base.slice(0, dash), kind)
        hi = cwResolve(base.slice(dash + 1), kind)
      } else {
        lo = cwResolve(base, kind)
        hi = hasStep ? max : lo
      }
    }

    if (lo < min || lo > max || hi < min || hi > max) {
      throw new Error(`Values in the ${label} field must be between ${min} and ${max}.`)
    }
    if (lo > hi) throw new Error(`Range "${base}" in the ${label} field is backwards.`)
    for (let v = lo; v <= hi; v += step) values.add(norm(v))
  }

  const single = parts.length === 1 ? cwAnalyzeSingle(parts[0], min, max, kind) : null
  return { token, values: [...values].sort((a, b) => a - b), restricted: token !== '*', single }
}

/** Parse a whole expression into fields (or a reboot marker). Throws on error. */
function cwParse(input: string): CwParsed {
  const raw = input.trim()
  if (!raw) throw new Error('Enter a cron expression, e.g. * * * * *')

  const zero: CwField = { token: '0', values: [0], restricted: false, single: { kind: 'single', v: 0 } }

  if (raw[0] === '@') {
    const key = raw.toLowerCase()
    if (key === '@reboot') {
      return {
        reboot: true, hasSeconds: false, second: zero,
        minute: zero, hour: zero, dom: zero, month: zero, dow: zero,
        normalized: '@reboot', nickname: '@reboot',
      }
    }
    const expanded = CW_NICKNAMES[key]
    if (!expanded) throw new Error(`Unknown nickname "${raw}". Try @yearly, @monthly, @weekly, @daily, @hourly, or @reboot.`)
    const p = cwParse(expanded)
    p.nickname = key
    return p
  }

  const fields = raw.split(/\s+/)
  if (fields.length !== 5 && fields.length !== 6) {
    throw new Error(`Expected 5 fields (minute hour day-of-month month day-of-week) — got ${fields.length}. A 6-field expression is read with a leading seconds field.`)
  }

  const hasSeconds = fields.length === 6
  const [sec, ...rest] = hasSeconds ? fields : ['0', ...fields]
  const [min, hr, dom, mon, dow] = rest

  return {
    hasSeconds,
    second: hasSeconds ? cwParseField(sec, 'second') : zero,
    minute: cwParseField(min, 'minute'),
    hour: cwParseField(hr, 'hour'),
    dom: cwParseField(dom, 'dom'),
    month: cwParseField(mon, 'month'),
    dow: cwParseField(dow, 'dow'),
    normalized: hasSeconds ? `${sec} ${min} ${hr} ${dom} ${mon} ${dow}` : `${min} ${hr} ${dom} ${mon} ${dow}`,
  }
}

// ── Description (crontab.guru-style) ──────────────────────────────────────────

/** Phrase for a "unit past" field (hour or, standalone, minute) — no leading "on". */
function cwUnitPhrase(f: CwField, noun: string, valueFn: (v: number) => string): string {
  const s = f.single
  if (!s) return `${noun} ${cwJoin(f.values.map(valueFn))}`
  switch (s.kind) {
    case 'all': return `every ${noun}`
    case 'stepAll': return `every ${cwOrdinal(s.step!)} ${noun}`
    case 'range': return `every ${noun} from ${valueFn(s.a!)} through ${valueFn(s.b!)}`
    case 'rangeStep': return `every ${cwOrdinal(s.step!)} ${noun} from ${valueFn(s.a!)} through ${valueFn(s.b!)}`
    case 'single': return `${noun} ${valueFn(s.v!)}`
  }
}

/** Phrase for a "on ..." field (day-of-month, month, day-of-week). Empty when "*". */
function cwOnPhrase(f: CwField, kind: CwKind): string {
  const s = f.single
  const num = (v: number) => String(v)
  const name = kind === 'month' ? cwMonthName : kind === 'dow' ? cwDowName : num
  const noun = CW_FIELD_LABEL[kind]

  if (s && s.kind === 'all') return ''
  if (!s) {
    // comma list — enumerate expanded values by name/number
    return `${kind === 'month' ? 'in' : 'on'} ${kind === 'month' ? '' : kind === 'dow' ? '' : `${noun} `}${cwJoin(f.values.map(name))}`.replace(/\s+/g, ' ').trim()
  }
  const lead = kind === 'month' ? 'in' : 'on'
  switch (s.kind) {
    case 'stepAll':
      return `${lead} every ${cwOrdinal(s.step!)} ${noun}`
    case 'range':
      return kind === 'month'
        ? `in every month from ${name(s.a!)} through ${name(s.b!)}`
        : `on every ${noun} from ${name(s.a!)} through ${name(s.b!)}`
    case 'rangeStep':
      return kind === 'month'
        ? `in every ${cwOrdinal(s.step!)} month from ${name(s.a!)} through ${name(s.b!)}`
        : `on every ${cwOrdinal(s.step!)} ${noun} from ${name(s.a!)} through ${name(s.b!)}`
    case 'single':
      return kind === 'month' ? `in ${name(s.v!)}`
        : kind === 'dow' ? `on ${name(s.v!)}`
        : `on ${noun} ${name(s.v!)}`
    default:
      return ''
  }
}

/** Seconds parenthetical for 6-field expressions where seconds isn't a bare 0. */
function cwSecPhrase(f: CwField): string {
  return cwUnitPhrase(f, 'second', v => String(v))
}

function cwDescribe(P: CwParsed): string {
  if (P.reboot) {
    return 'Runs once, at system startup (@reboot). It has no recurring schedule, so there are no upcoming times to compute.'
  }

  // Time clause from minute + hour (merge to HH:MM / HH:MM:SS when all single).
  const mS = P.minute.single
  const hS = P.hour.single
  const secS = P.second.single
  let mh: string

  const allTimeSingle = mS?.kind === 'single' && hS?.kind === 'single'
    && (!P.hasSeconds || secS?.kind === 'single')

  if (allTimeSingle) {
    mh = P.hasSeconds
      ? `${cwPad2(hS!.v!)}:${cwPad2(mS!.v!)}:${cwPad2(secS!.v!)}`
      : `${cwPad2(hS!.v!)}:${cwPad2(mS!.v!)}`
  } else {
    const minutePart = cwUnitPhrase(P.minute, 'minute', v => String(v))
    const hourAll = hS?.kind === 'all'
    const hourPart = hourAll ? '' : `past ${cwUnitPhrase(P.hour, 'hour', v => String(v))}`
    mh = hourPart ? `${minutePart} ${hourPart}` : minutePart
  }

  // Non-trivial seconds (6-field, not a bare 0) → parenthetical on the time clause.
  if (P.hasSeconds && !allTimeSingle && !(secS?.kind === 'single' && secS.v === 0)) {
    mh += ` (at ${cwSecPhrase(P.second)})`
  }

  const domPart = cwOnPhrase(P.dom, 'dom')
  const monthPart = cwOnPhrase(P.month, 'month')
  const dowPart = cwOnPhrase(P.dow, 'dow')

  const chunks: string[] = [`At ${mh}`]
  if (domPart) chunks.push(domPart)
  if (monthPart) chunks.push(monthPart)
  if (dowPart) chunks.push(domPart ? `and ${dowPart}` : dowPart)

  return chunks.join(' ').replace(/\s+/g, ' ').trim() + '.'
}

// ── Next-run iterator ─────────────────────────────────────────────────────────

interface CwCollectOpts {
  count: number
  untilMs?: number
}

/** Collect upcoming run instants after `from`, using a field-jumping search. */
function cwCollectRuns(P: CwParsed, from: Date, opts: CwCollectOpts, utc: boolean): Date[] {
  if (P.reboot) return []
  const untilMs = opts.untilMs ?? Infinity
  const wantSeconds = P.hasSeconds

  const secSet = new Set(P.second.values)
  const minSet = new Set(P.minute.values)
  const hrSet = new Set(P.hour.values)
  const domSet = new Set(P.dom.values)
  const monSet = new Set(P.month.values)
  const dowSet = new Set(P.dow.values)
  const domR = P.dom.restricted
  const dowR = P.dow.restricted

  const gY = utc ? (d: Date) => d.getUTCFullYear() : (d: Date) => d.getFullYear()
  const gMo = utc ? (d: Date) => d.getUTCMonth() : (d: Date) => d.getMonth() // 0-based
  const gD = utc ? (d: Date) => d.getUTCDate() : (d: Date) => d.getDate()
  const gH = utc ? (d: Date) => d.getUTCHours() : (d: Date) => d.getHours()
  const gMi = utc ? (d: Date) => d.getUTCMinutes() : (d: Date) => d.getMinutes()
  const gS = utc ? (d: Date) => d.getUTCSeconds() : (d: Date) => d.getSeconds()
  const gW = utc ? (d: Date) => d.getUTCDay() : (d: Date) => d.getDay()
  const mk = utc
    ? (y: number, mo: number, da: number, h: number, mi: number, s: number) => new Date(Date.UTC(y, mo, da, h, mi, s))
    : (y: number, mo: number, da: number, h: number, mi: number, s: number) => new Date(y, mo, da, h, mi, s)

  // Start strictly after `from`, aligned to the next second/minute boundary.
  const stepMs = wantSeconds ? 1000 : 60000
  let t = new Date(Math.floor(from.getTime() / stepMs) * stepMs + stepMs)

  const guardYear = gY(from) + 25
  const results: Date[] = []
  let attempts = 0
  const maxAttempts = 500000

  while (results.length < opts.count && attempts < maxAttempts) {
    attempts++
    if (t.getTime() > untilMs) break
    if (gY(t) > guardYear) break

    if (!monSet.has(gMo(t) + 1)) { t = mk(gY(t), gMo(t) + 1, 1, 0, 0, 0); continue }

    const domOk = domSet.has(gD(t))
    const dowOk = dowSet.has(gW(t))
    const dayOk = (domR && dowR) ? (domOk || dowOk) : domR ? domOk : dowR ? dowOk : true
    if (!dayOk) { t = mk(gY(t), gMo(t), gD(t) + 1, 0, 0, 0); continue }

    if (!hrSet.has(gH(t))) { t = mk(gY(t), gMo(t), gD(t), gH(t) + 1, 0, 0); continue }
    if (!minSet.has(gMi(t))) { t = mk(gY(t), gMo(t), gD(t), gH(t), gMi(t) + 1, 0); continue }
    if (wantSeconds && !secSet.has(gS(t))) { t = new Date(t.getTime() + 1000); continue }

    results.push(new Date(t.getTime()))
    t = wantSeconds
      ? new Date(t.getTime() + 1000)
      : mk(gY(t), gMo(t), gD(t), gH(t), gMi(t) + 1, 0)
  }
  return results
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function cwFmtRun(d: Date, utc: boolean, hour12: boolean, withSeconds: boolean): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12, timeZoneName: 'short',
  }
  if (withSeconds) opts.second = '2-digit'
  if (utc) opts.timeZone = 'UTC'
  return new Intl.DateTimeFormat('en-US', opts).format(d)
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

const CW_EXAMPLES: [string, string][] = [
  ['* * * * *', 'Every minute'],
  ['*/5 * * * *', 'Every 5 minutes'],
  ['*/15 * * * *', 'Every 15 minutes'],
  ['0 * * * *', 'Every hour, on the hour'],
  ['30 * * * *', 'Every hour at :30'],
  ['0 */2 * * *', 'Every 2 hours'],
  ['0 9 * * *', 'Every day at 09:00'],
  ['0 0 * * *', 'Every day at midnight'],
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

// ── Component ─────────────────────────────────────────────────────────────────

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
  private lastRunsText = ''

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
          <p>Paste a cron expression and read it in plain English, see the next run times in your zone or UTC, and get a field-by-field breakdown. Understands standard 5-field crontab syntax, month and weekday names, @nicknames, and 6-field (with-seconds) expressions. Everything runs in your browser — press <kbd>C</kbd> to clear, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> to copy the description.</p>
        </div>

        <div data-group="toolbar">
          <button data-action="clear" type="button">Clear (C)</button>
          <details data-type="cw-prefs">
            <summary>Preferences</summary>
            <div data-group="cw-prefs">
              <label data-type="cw-field"><span>Time zone</span>
                <select data-control="zone" aria-label="Time zone for run times">
                  <option value="local">Local time</option>
                  <option value="utc">UTC / GMT</option>
                </select>
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

        <section data-type="cw-card" data-card="fields" aria-labelledby="cw-fields-h">
          <h2 id="cw-fields-h">Field breakdown</h2>
          <div data-type="cw-fields" data-for="fields"></div>
        </section>

        <details data-type="cw-examples">
          <summary>Common examples</summary>
          <div data-type="cw-example-grid">
            ${CW_EXAMPLES.map(([expr, label]) => `
              <button data-type="cw-example" data-example="${expr}" type="button">
                <code>${expr.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>
                <span>${label}</span>
              </button>
            `).join('')}
          </div>
        </details>

        <details data-type="cw-explainer">
          <summary>How cron works</summary>
          <p>A <strong>cron expression</strong> is five space-separated fields — <code>minute hour day-of-month month day-of-week</code> — that together say <em>when</em> a job runs. Each field takes <code>*</code> (any value), a single number, a list (<code>1,15,30</code>), a range (<code>9-17</code>), or a step (<code>*/5</code>, <code>0-30/10</code>). Months accept <code>JAN</code>–<code>DEC</code> and weekdays <code>SUN</code>–<code>SAT</code>; both <code>0</code> and <code>7</code> mean Sunday.</p>
          <p>Shorthand <strong>nicknames</strong> stand in for common schedules: <code>@yearly</code>, <code>@monthly</code>, <code>@weekly</code>, <code>@daily</code>, <code>@hourly</code>, and <code>@reboot</code> (runs once at startup). A <strong>6-field</strong> expression is read here with a leading <em>seconds</em> field, matching schedulers like Quartz and node-cron.</p>
          <p><strong>The day-of-month / day-of-week gotcha:</strong> when <em>both</em> of those fields are restricted (neither is <code>*</code>), the job runs whenever <em>either</em> one matches, not when both do. <code>0 0 1 * 1</code> runs on the 1st of the month <em>and</em> on every Monday.</p>
          <p>Everything here is computed locally in your browser; your last expression and preferences are remembered on this device and never uploaded.</p>
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

    this.reflectSettings()

    // Restore the last expression, defaulting to a self-demonstrating one.
    const saved = this.readLS(CW_LS_EXPR)
    this.input.value = saved ?? '*/5 * * * *'

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

  // ── evaluation ────────────────────────────────────────────────────────────
  private evaluate() {
    const expr = this.input.value
    this.writeLS(CW_LS_EXPR, expr)

    if (!expr.trim()) {
      this.root.removeAttribute('data-invalid')
      this.statusEl.removeAttribute('data-error')
      this.setStatus('Enter a cron expression to decode it.')
      this.describeEl.textContent = '—'
      this.orNoteEl.hidden = true
      this.runsEl.innerHTML = ''
      this.freqEl.textContent = ''
      this.fieldsEl.innerHTML = ''
      this.lastRunsText = ''
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

    this.renderRuns(P)
    this.renderFields(P)
  }

  private showError(msg: string) {
    this.root.setAttribute('data-invalid', '')
    this.statusEl.setAttribute('data-error', '')
    this.setStatus(msg)
    this.describeEl.textContent = '—'
    this.orNoteEl.hidden = true
    this.runsEl.innerHTML = ''
    this.freqEl.textContent = ''
    this.fieldsEl.innerHTML = ''
    this.lastRunsText = ''
  }

  private renderRuns(P: CwParsed) {
    const utc = this.settings.zone === 'utc'
    if (P.reboot) {
      this.runsEl.innerHTML = '<li><span data-type="cw-run-idx">—</span><span data-type="cw-run-time">At each system startup</span><span data-type="cw-run-rel">on boot</span></li>'
      this.freqEl.textContent = 'Runs once per boot; there is no recurring time to compute.'
      this.lastRunsText = '@reboot — at each system startup'
      return
    }

    const now = new Date()
    const runs = cwCollectRuns(P, now, { count: this.settings.runs }, utc)
    if (runs.length === 0) {
      this.runsEl.innerHTML = '<li><span data-type="cw-run-idx">—</span><span data-type="cw-run-time">No upcoming runs found in the next 25 years — this schedule may never match (for example February 30).</span><span data-type="cw-run-rel"></span></li>'
      this.freqEl.textContent = ''
      this.lastRunsText = ''
      return
    }

    const nowMs = now.getTime()
    const lines: string[] = []
    this.runsEl.innerHTML = runs.map((d, i) => {
      const time = cwFmtRun(d, utc, this.settings.hour12, P.hasSeconds)
      const rel = cwRelFuture(d.getTime(), nowMs)
      lines.push(`${time}  (${rel})`)
      return `<li><span data-type="cw-run-idx">${i + 1}</span><span data-type="cw-run-time">${this.esc(time)}</span><span data-type="cw-run-rel">${this.esc(rel)}</span></li>`
    }).join('')
    this.lastRunsText = lines.join('\n')

    // Frequency read-out.
    const cap = 2000
    const in24 = cwCollectRuns(P, now, { count: cap, untilMs: nowMs + 86400000 }, utc).length
    if (in24 > 0) {
      this.freqEl.textContent = `Runs ${this.count(in24, cap)} in the next 24 hours (${utc ? 'UTC' : 'local time'}).`
    } else {
      const in7 = cwCollectRuns(P, now, { count: cap, untilMs: nowMs + 7 * 86400000 }, utc).length
      this.freqEl.textContent = in7 > 0
        ? `Runs ${this.count(in7, cap)} in the next 7 days.`
        : 'Runs rarely — nothing in the next 7 days.'
    }
  }

  private count(n: number, cap: number): string {
    if (n >= cap) return `${cap}+ times`
    return n === 1 ? 'once' : `${n} times`
  }

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
        <span data-type="cw-ftoken">${this.esc(f.token)}</span>
        <span data-type="cw-fvals">${this.esc(this.fieldValues(f, kind))}</span>
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

  // ── actions ──────────────────────────────────────────────────────────────
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
    const original = btn.dataset.label ?? btn.textContent ?? ''
    if (!btn.dataset.label) btn.dataset.label = original
    btn.textContent = label
    window.setTimeout(() => { btn.textContent = btn.dataset.label ?? original }, 1200)
  }

  private setStatus(label: string) {
    this.statusEl.textContent = label
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  // ── preferences + persistence ────────────────────────────────────────────
  private onPrefChange(el: HTMLSelectElement) {
    const key = el.dataset.control as keyof CwSettings
    if (key === 'zone') this.settings.zone = el.value as CwSettings['zone']
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
      if (merged.zone !== 'local' && merged.zone !== 'utc') merged.zone = CW_DEFAULTS.zone
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
