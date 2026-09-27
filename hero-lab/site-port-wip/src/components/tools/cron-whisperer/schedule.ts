/**
 * Cron Whisperer's engine: parse a crontab expression, describe it in English,
 * and work out when it actually fires — in any IANA time zone, across daylight
 * saving.
 *
 * It lives beside the component rather than inside it (the same split as
 * webhook-inspector/signature.ts) because the interesting claims this tool
 * makes are claims about time, and `security:smoke` has to be able to run them
 * against the real tz database instead of trusting the screenshot.
 *
 * ── Why a wall clock is not a moment ─────────────────────────────────────────
 * A crontab line names a *wall-clock reading*, not an instant. Twice a year, in
 * most of the world, that mapping breaks:
 *
 *   • Spring forward — the reading never happens. `30 2 * * *` has no 02:30 on
 *     the changeover day at all.
 *   • Fall back — the reading happens twice. 01:30 comes round in both the old
 *     offset and the new one.
 *
 * Vixie cron (cronie, Debian's cron) resolves both, and the rule is in
 * `man 8 cron`: a job counts as running "at a particular time" only when
 * *neither* the hour nor the minute field contains a `*`. Those jobs are made
 * up once after a forward jump and are **not** repeated after a backward one.
 * Every other schedule simply follows the new wall clock — so a half-hourly
 * step schedule loses two runs in spring and gains two in autumn.
 *
 * The iterator below therefore walks wall-clock tuples with plain calendar
 * arithmetic and only then asks the zone what instant (0, 1 or 2 of them) each
 * tuple corresponds to. Iterating over `Date` objects instead — which is what
 * this tool used to do — silently drops the repeated hour, because stepping a
 * local `Date` forward by a minute never revisits it.
 *
 * All module-level names are cw-/CW_-prefixed to match the component file.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type CwKind = 'second' | 'minute' | 'hour' | 'dom' | 'month' | 'dow'

export interface CwSingle {
  kind: 'all' | 'stepAll' | 'range' | 'rangeStep' | 'single'
  step?: number
  a?: number
  b?: number
  v?: number
}

export interface CwField {
  token: string
  values: number[] // sorted, unique, expanded (dow normalised 7 → 0)
  restricted: boolean // true when the token is not a bare "*"
  single: CwSingle | null // structured shape when there is exactly one part (no comma)
}

export interface CwParsed {
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

/** A wall-clock reading with no zone attached. Months are 1-12. */
export interface CwWall {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  s: number
}

/** A moment when a zone's UTC offset changes, with the offset either side. */
export interface CwTransition {
  ms: number
  before: number
  after: number
}

/**
 * What daylight saving did to one scheduled run.
 *   ''       nothing special.
 *   'gap'    the wall reading does not exist that day.
 *   'first'  the wall reading happens twice; this is the first pass.
 *   'second' …and this is the repeat.
 */
export type CwDst = '' | 'gap' | 'first' | 'second'

export interface CwRun {
  /** The instant the job fires. For a skipped gap run, the transition instant. */
  ms: number
  /** The wall reading the schedule asked for. */
  wall: CwWall
  dst: CwDst
  /** False only for a gap reading that the scheduler does not make up. */
  fires: boolean
}

// ── Constants ────────────────────────────────────────────────────────────────

export const CW_MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
export const CW_DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

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

export const CW_FIELD_LABEL: Record<CwKind, string> = {
  second: 'second', minute: 'minute', hour: 'hour',
  dom: 'day-of-month', month: 'month', dow: 'day-of-week',
}

const CW_FIELD_RANGE: Record<CwKind, [number, number]> = {
  second: [0, 59], minute: [0, 59], hour: [0, 23],
  dom: [1, 31], month: [1, 12], dow: [0, 7],
}

// ── Small pure helpers ───────────────────────────────────────────────────────

export function cwPad2(n: number): string {
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

export function cwMonthName(v: number): string {
  return CW_MONTH_NAMES[v] ?? String(v)
}

export function cwDowName(v: number): string {
  return CW_DOW_NAMES[v === 7 ? 0 : v] ?? String(v)
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Resolve a single field endpoint (number or JAN/MON-style name) to an integer. */
function cwResolve(str: string, kind: CwKind): number {
  const s = str.trim().toLowerCase()
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  if (kind === 'month' && s in CW_MONTH_MAP) return CW_MONTH_MAP[s]
  if (kind === 'dow' && s in CW_DOW_MAP) return CW_DOW_MAP[s]
  throw new Error(`"${str}" is not a valid ${CW_FIELD_LABEL[kind]} value.`)
}

/** Analyse a one-part token into a structured shape used for the description. */
function cwAnalyzeSingle(part: string, max: number, kind: CwKind): CwSingle {
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
export function cwParseField(raw: string, kind: CwKind): CwField {
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

  const single = parts.length === 1 ? cwAnalyzeSingle(parts[0], max, kind) : null
  return { token, values: [...values].sort((a, b) => a - b), restricted: token !== '*', single }
}

/** Parse a whole expression into fields (or a reboot marker). Throws on error. */
export function cwParse(input: string): CwParsed {
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

// ── Description (crontab.guru-style) ─────────────────────────────────────────

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

export function cwDescribe(P: CwParsed): string {
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

// ── Time zones ───────────────────────────────────────────────────────────────

/** Widest real UTC offset is +14:00 / −12:00; 18h is a safe envelope. */
const CW_MAX_OFF = 18 * 3600_000
/** The transition table is built, and later extended, in chunks this long. */
const CW_SCAN_CHUNK = 400 * 86400_000
/** Sampling step inside a chunk. No real zone changes offset twice this close. */
const CW_SCAN_STEP = 5 * 86400_000
/** Ceiling on how far the table will chase a very sparse schedule (~44 years). */
const CW_SCAN_MAX = 40

const cwFmtCache = new Map<string, Intl.DateTimeFormat>()

function cwPartsFmt(zone: string): Intl.DateTimeFormat {
  const hit = cwFmtCache.get(zone)
  if (hit) return hit
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  cwFmtCache.set(zone, f)
  return f
}

/** True for 'local' or any IANA id this runtime can actually resolve. */
export function cwZoneValid(zone: string): boolean {
  if (zone === 'local') return true
  if (!/^[A-Za-z0-9+_\-/]{1,64}$/.test(zone)) return false
  try {
    cwPartsFmt(zone)
    return true
  } catch {
    return false
  }
}

/** Every IANA zone this runtime knows, or a usable subset on older engines. */
export function cwZoneList(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  if (typeof supported === 'function') {
    try {
      return supported.call(Intl, 'timeZone')
    } catch {
      /* fall through to the static list */
    }
  }
  return CW_ZONE_FALLBACK
}

/** Enough of the tz database to stay useful where `supportedValuesOf` is missing. */
const CW_ZONE_FALLBACK = [
  'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi',
  'America/Anchorage', 'America/Argentina/Buenos_Aires', 'America/Bogota',
  'America/Chicago', 'America/Denver', 'America/Halifax', 'America/Los_Angeles',
  'America/Mexico_City', 'America/New_York', 'America/Phoenix', 'America/Santiago',
  'America/Sao_Paulo', 'America/St_Johns', 'America/Toronto', 'America/Vancouver',
  'Asia/Bangkok', 'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Jakarta', 'Asia/Jerusalem',
  'Asia/Kathmandu', 'Asia/Kolkata', 'Asia/Manila', 'Asia/Seoul', 'Asia/Shanghai',
  'Asia/Singapore', 'Asia/Tehran', 'Asia/Tokyo', 'Australia/Adelaide',
  'Australia/Brisbane', 'Australia/Lord_Howe', 'Australia/Perth', 'Australia/Sydney',
  'Europe/Amsterdam', 'Europe/Athens', 'Europe/Berlin', 'Europe/Dublin',
  'Europe/Istanbul', 'Europe/Lisbon', 'Europe/London', 'Europe/Madrid',
  'Europe/Moscow', 'Europe/Paris', 'Europe/Rome', 'Europe/Warsaw', 'Europe/Zurich',
  'Pacific/Auckland', 'Pacific/Chatham', 'Pacific/Fiji', 'Pacific/Honolulu',
]

/** "UTC+05:30" / "UTC-04:00" for a signed offset in milliseconds. */
export function cwOffsetLabel(ms: number): string {
  const abs = Math.abs(ms)
  const h = Math.floor(abs / 3600_000)
  const m = Math.floor((abs % 3600_000) / 60_000)
  return `UTC${ms < 0 ? '-' : '+'}${cwPad2(h)}:${cwPad2(m)}`
}

/**
 * One zone's clock: instant → wall reading, wall reading → instant(s), and the
 * offset changes that stop those two being inverses of each other.
 *
 * Offsets come from a lazily-built transition table, not from a formatter call
 * per lookup. The frequency read-out alone resolves every match in a 24-hour
 * window — 1 440 of them for `* * * * *` — and `formatToParts` is far too slow
 * to sit in that loop. The table samples the zone every five days and then
 * binary-searches each offset change down to the second, so it is exact rather
 * than an approximation of the tz database.
 */
export class CwZoneClock {
  readonly zone: string
  private readonly fixedUtc: boolean
  /** Offset in force from each point onward. points[0] anchors the window. */
  private points: { ms: number; offset: number }[] = []
  private scannedFrom = 0
  private scannedTo = 0
  private chunks = 0

  constructor(zone: string, fromMs: number) {
    this.zone = zone
    this.fixedUtc = zone === 'UTC' || zone === 'Etc/UTC' || zone === 'Etc/GMT'
    if (this.fixedUtc) return
    const start = Math.floor((fromMs - 2 * 86400_000) / 1000) * 1000
    this.scannedFrom = start
    this.scannedTo = start
    this.points = [{ ms: start, offset: this.probe(start) }]
    this.extend()
  }

  /** The one place a zone is actually consulted. Everything else reads the table. */
  private probe(ms: number): number {
    if (this.zone === 'local') return -new Date(ms).getTimezoneOffset() * 60_000
    const parts = cwPartsFmt(this.zone).formatToParts(new Date(ms))
    const at = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)
    const wall = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour'), at('minute'), at('second'))
    return wall - Math.floor(ms / 1000) * 1000
  }

  /** Push the table forward one chunk, pinning every offset change it crosses. */
  private extend(): void {
    if (this.chunks >= CW_SCAN_MAX) return
    this.chunks++
    const from = this.scannedTo
    const to = from + CW_SCAN_CHUNK
    let prevMs = from
    let prev = this.points[this.points.length - 1].offset
    for (let t = from + CW_SCAN_STEP; t <= to; t += CW_SCAN_STEP) {
      const o = this.probe(t)
      if (o !== prev) {
        this.points.push({ ms: this.refine(prevMs, t, prev), offset: o })
        prev = o
      }
      prevMs = t
    }
    this.scannedTo = to
  }

  /** Binary-search the exact second at which the offset stops being `before`. */
  private refine(loIn: number, hiIn: number, before: number): number {
    let lo = Math.floor(loIn / 1000) * 1000
    let hi = Math.ceil(hiIn / 1000) * 1000
    while (hi - lo > 1000) {
      const mid = lo + Math.floor((hi - lo) / 2000) * 1000
      if (mid <= lo || mid >= hi) break
      if (this.probe(mid) === before) lo = mid
      else hi = mid
    }
    return hi
  }

  /** UTC offset (wall − UTC, in ms) in force at an instant. */
  offsetAt(ms: number): number {
    if (this.fixedUtc) return 0
    while (ms >= this.scannedTo && this.chunks < CW_SCAN_MAX) this.extend()
    if (ms < this.scannedFrom) return this.probe(ms)
    let lo = 0
    let hi = this.points.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.points[mid].ms <= ms) lo = mid
      else hi = mid - 1
    }
    return this.points[lo].offset
  }

  /** Wall-clock reading in this zone for an instant. */
  wallOf(ms: number): CwWall {
    const d = new Date(ms + this.offsetAt(ms))
    return {
      y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
      h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
    }
  }

  /**
   * Every instant whose wall clock in this zone reads exactly `w`:
   *   []       the reading never happens — clocks jumped forward over it;
   *   [t]      the ordinary case;
   *   [t1, t2] the reading happens twice — clocks fell back.
   *
   * At most one transition falls inside ±18 h, so probing both edges of that
   * window yields both candidate offsets; each is kept only if it is the offset
   * actually in force at the instant it produces.
   */
  instantsOf(w: CwWall): number[] {
    const target = cwWallToNaive(w)
    if (this.fixedUtc) return [target]
    const out: number[] = []
    const candidates = new Set([this.offsetAt(target - CW_MAX_OFF), this.offsetAt(target + CW_MAX_OFF)])
    for (const off of candidates) {
      const t = target - off
      if (this.offsetAt(t) === off && !out.includes(t)) out.push(t)
    }
    return out.sort((a, b) => a - b)
  }

  /** The offset change a non-existent wall reading fell into, if it can be found. */
  transitionAround(target: number): CwTransition | null {
    if (this.fixedUtc) return null
    const a = target - CW_MAX_OFF
    const b = target + CW_MAX_OFF
    const before = this.offsetAt(a)
    const after = this.offsetAt(b)
    if (before === after) return null
    const point = this.points.find(p => p.ms > a && p.ms <= b && p.offset === after)
    return point ? { ms: point.ms, before, after } : null
  }

  /** Offset changes from `fromMs` up to `horizonMs`, soonest first. */
  transitionsFrom(fromMs: number, limit: number, horizonMs: number): CwTransition[] {
    if (this.fixedUtc) return []
    this.offsetAt(horizonMs) // make sure the table covers the horizon
    const out: CwTransition[] = []
    for (let i = 1; i < this.points.length && out.length < limit; i++) {
      const p = this.points[i]
      if (p.ms <= fromMs || p.ms > horizonMs) continue
      out.push({ ms: p.ms, before: this.points[i - 1].offset, after: p.offset })
    }
    return out
  }
}

// ── Calendar arithmetic on wall readings (no zone, no Date maths) ────────────

const CW_DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export function cwDaysInMonth(y: number, mo: number): number {
  if (mo !== 2) return CW_DAYS_IN_MONTH[mo - 1]
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28
}

/** The reading as a UTC-naive timestamp — the shared currency of the zone maths. */
export function cwWallToNaive(w: CwWall): number {
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s)
}

/** Day of week (0 = Sunday) for a calendar date. No zone is involved. */
export function cwDowOf(w: CwWall): number {
  return new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay()
}

function cwNextMonth(w: CwWall): CwWall {
  return w.mo === 12
    ? { y: w.y + 1, mo: 1, d: 1, h: 0, mi: 0, s: 0 }
    : { y: w.y, mo: w.mo + 1, d: 1, h: 0, mi: 0, s: 0 }
}

function cwNextDay(w: CwWall): CwWall {
  return w.d >= cwDaysInMonth(w.y, w.mo)
    ? cwNextMonth(w)
    : { y: w.y, mo: w.mo, d: w.d + 1, h: 0, mi: 0, s: 0 }
}

function cwNextHour(w: CwWall): CwWall {
  return w.h >= 23 ? cwNextDay(w) : { ...w, h: w.h + 1, mi: 0, s: 0 }
}

function cwNextMinute(w: CwWall): CwWall {
  return w.mi >= 59 ? cwNextHour(w) : { ...w, mi: w.mi + 1, s: 0 }
}

function cwNextSecond(w: CwWall): CwWall {
  return w.s >= 59 ? cwNextMinute(w) : { ...w, s: w.s + 1 }
}

// ── Next-run iterator ────────────────────────────────────────────────────────

/**
 * Vixie cron treats a job as running "at a particular time" only when neither
 * the hour nor the minute field contains a `*` (`man 8 cron`). Those are the
 * jobs it makes up after a forward jump and refuses to repeat after a backward
 * one. Everything else just follows the new wall clock.
 */
export function cwIsFixedTime(P: CwParsed): boolean {
  return !P.hour.token.includes('*') && !P.minute.token.includes('*')
}

export interface CwCollectOpts {
  /** How many runs that actually fire to return. Omit for "every run up to `untilMs`". */
  count?: number
  untilMs?: number
}

/**
 * Upcoming runs after `fromMs`, resolved in `clock`'s zone.
 *
 * Matching happens on wall readings; only a matched reading is handed to the
 * zone. That ordering is what makes the daylight-saving cases fall out instead
 * of being special-cased: a gap reading resolves to no instant, a repeated one
 * resolves to two, and the Vixie rule decides what the scheduler does with each.
 */
export function cwCollectRuns(P: CwParsed, fromMs: number, opts: CwCollectOpts, clock: CwZoneClock): CwRun[] {
  if (P.reboot) return []
  const untilMs = opts.untilMs ?? Infinity
  const wantCount = opts.count ?? Infinity
  const wantSeconds = P.hasSeconds
  const fixedTime = cwIsFixedTime(P)

  const secSet = new Set(P.second.values)
  const minSet = new Set(P.minute.values)
  const hrSet = new Set(P.hour.values)
  const domSet = new Set(P.dom.values)
  const monSet = new Set(P.month.values)
  const dowSet = new Set(P.dow.values)
  const domR = P.dom.restricted
  const dowR = P.dow.restricted

  // Start strictly after `fromMs`, aligned to the next second/minute boundary —
  // EXCEPT during a fall-back, where the wall clock has just run backwards.
  //
  // The walk moves forward through wall readings, but a repeated reading resolves
  // to two instants an hour apart, so a reading EARLIER than now can still have a
  // second instant in the future. Anchoring the walk to now's own wall reading
  // drops every one of them: at 01:20 EDT on a US fall-back day, `0 * * * *`
  // reported the next run as 02:00 EST and 23 runs in 24 hours, when cron really
  // fires at 01:00 EST and 24 times. So when a backward jump is still in scope,
  // rewind the walk to the transition and let the `ms <= fromMs` filters below
  // discard what has genuinely passed.
  // The rewind must cover a jump on EITHER side. One just behind us means earlier
  // readings still have a second, future instant; one just ahead means the
  // readings around `fromMs` are themselves about to repeat — at 01:00 EDT, wall
  // 01:00's second instant an hour later is still to come. Skipped entirely when
  // no jump is near, which is every instant of the year bar two windows a zone.
  const stepMs = wantSeconds ? 1000 : 60_000
  let walkFrom = fromMs
  for (const t of clock.transitionsFrom(fromMs - CW_MAX_OFF, 4, fromMs + CW_MAX_OFF)) {
    if (t.after >= t.before) continue // forward jumps create no repeated readings
    // Readings in [T + after, T + before) happen twice; their first-pass instants
    // start at T - shift. Rewind exactly that far, not a flat CW_MAX_OFF — the
    // flat version cost 50 ms on a per-second expression for the two windows a
    // year it triggers.
    // minus one step: the walk starts at the reading AFTER walkFrom, and the first
    // repeated reading must be included, not stepped over.
    walkFrom = Math.min(walkFrom, t.ms - (t.before - t.after) - stepMs)
  }
  let w = clock.wallOf(Math.floor(walkFrom / stepMs) * stepMs + stepMs)
  if (!wantSeconds) w = { ...w, s: 0 }

  const guardYear = w.y + 25
  const out: CwRun[] = []
  let fired = 0
  let attempts = 0
  const maxAttempts = 500_000

  // Wall order is not instant order across a fall-back, so the scan cannot stop
  // the moment it has `count` runs — the readings it has not visited yet may sort
  // BEFORE ones it already holds, and the final sort hides the hole rather than
  // revealing it. `cutoff` is the count-th smallest run found so far; the scan
  // runs on until no unvisited reading could beat it.
  let cutoff = Infinity
  let reorderAhead = false

  while (attempts < maxAttempts) {
    attempts++
    if (w.y > guardYear) break

    if (!monSet.has(w.mo)) { w = cwNextMonth(w); continue }

    const domOk = domSet.has(w.d)
    const dowOk = dowSet.has(cwDowOf(w))
    const dayOk = (domR && dowR) ? (domOk || dowOk) : domR ? domOk : dowR ? dowOk : true
    if (!dayOk) { w = cwNextDay(w); continue }

    if (!hrSet.has(w.h)) { w = cwNextHour(w); continue }
    if (!minSet.has(w.mi)) { w = cwNextMinute(w); continue }
    if (wantSeconds && !secSet.has(w.s)) { w = cwNextSecond(w); continue }

    const instants = clock.instantsOf(w)

    if (instants.length === 0) {
      // Spring forward: this reading never happens. Cron makes up a fixed-time
      // job right at the jump; a wildcard schedule loses the run outright.
      const naive = cwWallToNaive(w)
      const at = clock.transitionAround(naive)?.ms ?? naive
      if (at > untilMs) { w = wantSeconds ? cwNextSecond(w) : cwNextMinute(w); continue }
      if (at > fromMs) {
        out.push({ ms: at, wall: { ...w }, dst: 'gap', fires: fixedTime })
        if (fixedTime) fired++
      }
    } else {
      // Fall back: two instants. A fixed-time job runs on the first pass only.
      const keep = instants.length === 2 && fixedTime ? [instants[0]] : instants
      for (const ms of keep) {
        if (ms <= fromMs) continue
        // Skip THIS instant only. Aborting the walk here was the same wall-order
        // mistake: inside a repeated hour the second instant of 01:15 crosses the
        // horizon while 01:16..01:59's first-pass instants are still inside it, so
        // `* * * * *` reported 1381 runs in 24 hours instead of 1440.
        if (ms > untilMs) continue
        out.push({
          ms,
          wall: { ...w },
          dst: instants.length === 2 ? (ms === instants[0] ? 'first' : 'second') : '',
          fires: true,
        })
        fired++
      }
    }

    w = wantSeconds ? cwNextSecond(w) : cwNextMinute(w)
    const naiveNow = cwWallToNaive(w)

    // An unvisited reading's earliest possible instant is `naive - CW_MAX_OFF`,
    // since instant = naive - offset and offset never exceeds CW_MAX_OFF.
    if (untilMs !== Infinity && naiveNow - CW_MAX_OFF > untilMs) break

    if (fired >= wantCount) {
      if (cutoff === Infinity) {
        // Fixed once. It can only fall as more runs arrive, and a stale (larger)
        // cutoff stops the scan later, never earlier — so it stays correct while
        // costing one sort instead of one per iteration.
        cutoff = out.filter(r => r.fires).map(r => r.ms).sort((a, b) => a - b)[wantCount - 1]
        // If the offset is constant either side of the cutoff, wall order IS
        // instant order there and nothing unvisited can beat it — stop at once.
        // The window has to be two-sided: an unvisited reading can land on the
        // EARLIER side of a jump the cutoff sits after, which is exactly the
        // 01:15-EDT-after-01:00-EST case a forward-only check waves through.
        reorderAhead =
          clock.offsetAt(cutoff - CW_MAX_OFF) !== clock.offsetAt(cutoff) ||
          clock.offsetAt(cutoff) !== clock.offsetAt(cutoff + CW_MAX_OFF)
      }
      if (!reorderAhead || naiveNow - CW_MAX_OFF > cutoff) break
    }
  }

  out.sort((a, b) => a.ms - b.ms)
  if (fired <= wantCount) return out

  // Trim the overshoot on FIRING count: a skipped `gap` row is part of the story
  // the panel tells and must survive, but it never counted toward `count`.
  const trimmed: CwRun[] = []
  let kept = 0
  for (const r of out) {
    if (r.fires) {
      if (kept >= wantCount) break
      kept++
    }
    trimmed.push(r)
  }
  return trimmed
}

/** How many of a run list actually fire (a skipped gap reading does not). */
export function cwFiringCount(runs: CwRun[]): number {
  let n = 0
  for (const r of runs) if (r.fires) n++
  return n
}
