/**
 * Cron Whisperer's crontab reader: read a WHOLE pasted crontab, not one
 * expression at a time.
 *
 * Nobody debugs a single cron line in isolation — they debug a crontab. A dozen
 * entries; a `CRON_TZ=` near the top that half of them forget applies only to
 * the lines *below* it; a `%` inside `date +%Y` that silently truncates the
 * command; and a midnight where nine jobs start at the same instant. Every one
 * of those is a file-level fact, and a one-expression box cannot see any of
 * them.
 *
 * This module owns the file grammar and nothing else. It turns text into
 * entries, each carrying the time zone in force at that point in the file, and
 * the engine in ./schedule.ts resolves each entry on its own clock. The split
 * is the rule AGENTS.md states for every tool: a claim about the world lives in
 * a sibling module the component imports, so `security:smoke` can run it
 * against the real thing instead of trusting a screenshot.
 *
 * ── What is claimed about the grammar, and therefore asserted ────────────────
 *   • An assignment line is recognised with Vixie cron's own state machine
 *     (`env.c`): NAME, optional space, `=`, optional space, VALUE, where VALUE
 *     may be wrapped in matching quotes. That single rule is why `MAILTO=""` is
 *     an assignment and `0 0 * * * cmd` is not — no regex over "looks like
 *     KEY=VALUE" gets both right.
 *   • Assignments apply **downward**: to the entries that follow them, staying
 *     in force until reassigned. The entry above a `CRON_TZ=` is not affected
 *     by it. That is the single most common misreading of a crontab, and it is
 *     invisible in a tool that only ever sees one line.
 *   • `CRON_TZ=` moves the schedule. `TZ=` is flagged rather than trusted:
 *     implementations disagree about whether it moves the schedule or only sets
 *     the job's environment, so a crontab leaning on it is a bug report waiting
 *     to be filed. Entries under one are previewed in the named zone *and*
 *     marked, because the honest answer is "this depends on your cron".
 *   • `%` is not an ordinary character. Unescaped, it ends the command and
 *     everything after it becomes the job's standard input (`man 5 crontab`);
 *     `\%` is a literal percent. `date +%Y` is the classic casualty — it runs
 *     as `date +` with `Y` on stdin.
 *   • `#` opens a comment only at the start of a line. A trailing `# note` on an
 *     entry is part of the command, which is why "I only added a comment" is a
 *     real way to break a cron job.
 *
 * All module-level names are cw-/CW_-prefixed to match the rest of the tool.
 */

import { cwParse, cwZoneValid, type CwParsed, type CwRun } from './schedule'

// ── Bounds ───────────────────────────────────────────────────────────────────
// Everything here runs in the reader's own tab, but a paste is still input and
// an unbounded walk over one is still a hang. A real crontab is tens of lines;
// these are an order of magnitude past anything genuine.

export const CW_CRONTAB_MAX_CHARS = 20_000
export const CW_CRONTAB_MAX_LINES = 400
export const CW_CRONTAB_MAX_ENTRIES = 100

// ── Types ────────────────────────────────────────────────────────────────────

export type CwLineKind = 'blank' | 'comment' | 'env' | 'entry' | 'error'

/** Where an entry's zone came from. `null` = nothing said, use the daemon's. */
export type CwZoneSource = 'CRON_TZ' | 'TZ' | null

export interface CwEnvAssign {
  name: string
  value: string
}

export interface CwCrontabEntry {
  /** 1-based line number in the pasted text, so the UI can point at it. */
  n: number
  /** The schedule exactly as written, whitespace collapsed. */
  schedule: string
  parsed: CwParsed
  /** The user column of a system crontab (`/etc/crontab`, `/etc/cron.d/*`). */
  user: string | null
  /** The command cron actually runs — everything before an unescaped `%`. */
  command: string
  /** What cron feeds the command on stdin, or null when there is no `%`. */
  stdin: string | null
  /** The zone named by the assignment in force here, or null for the default. */
  zone: string | null
  zoneSource: CwZoneSource
  /** False when the assignment named a zone this runtime cannot resolve. */
  zoneOk: boolean
}

export interface CwCrontabLine {
  n: number
  kind: CwLineKind
  text: string
  env?: CwEnvAssign
  entry?: CwCrontabEntry
  message?: string
}

export interface CwCrontabDoc {
  lines: CwCrontabLine[]
  entries: CwCrontabEntry[]
  errors: CwCrontabLine[]
  assignments: CwCrontabLine[]
  /** True when any entry's zone came from a bare `TZ=` rather than `CRON_TZ=`. */
  usesTz: boolean
  /** True when the paste was clipped by one of the bounds above. */
  truncated: boolean
}

export interface CwCrontabOpts {
  /** System crontabs put a user between the schedule and the command. */
  systemUser?: boolean
}

// ── Environment assignments ──────────────────────────────────────────────────

/**
 * Vixie cron's `load_env()` as a predicate: NAME (no space, no `=`), optional
 * whitespace, `=`, optional whitespace, VALUE — where VALUE may be wrapped in
 * matching single or double quotes and is otherwise right-trimmed.
 *
 * Returns null for anything that is not an assignment, which is precisely how
 * cron itself decides a line is a schedule. Following it exactly matters in
 * both directions: a stricter rule (say, requiring an identifier-shaped name)
 * would show a parse error for a line cron accepts, and a looser one would
 * swallow an entry as configuration.
 */
export function cwParseEnvLine(text: string): CwEnvAssign | null {
  const ws = (c: string) => c === ' ' || c === '\t'
  let i = 0
  while (i < text.length && ws(text[i])) i++
  const nameFrom = i
  while (i < text.length && !ws(text[i]) && text[i] !== '=') i++
  const name = text.slice(nameFrom, i)
  if (!name) return null
  while (i < text.length && ws(text[i])) i++
  if (text[i] !== '=') return null
  i++
  while (i < text.length && ws(text[i])) i++
  let value = text.slice(i)
  const quote = value[0]
  if ((quote === '"' || quote === "'") && value.length >= 2 && value[value.length - 1] === quote) {
    value = value.slice(1, -1)
  } else {
    value = value.replace(/[ \t]+$/, '')
  }
  return { name, value }
}

// ── The percent rule ─────────────────────────────────────────────────────────

/**
 * Split a crontab command at the first unescaped `%`. Per `man 5 crontab`, the
 * command runs only up to that point and everything after it is handed to the
 * job on standard input, with each further `%` becoming a newline; `\%` is an
 * escaped literal percent.
 *
 * This is why `0 3 * * * tar czf /backup/$(date +%Y%m%d).tgz /srv` does not do
 * what it looks like: cron runs `tar czf /backup/$(date +` and feeds the rest
 * in as text.
 */
export function cwSplitPercent(raw: string): { command: string; stdin: string | null } {
  let command = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '\\' && raw[i + 1] === '%') {
      command += '%'
      i++
      continue
    }
    if (ch === '%') {
      return { command, stdin: raw.slice(i + 1).replace(/%/g, '\n') }
    }
    command += ch
  }
  return { command, stdin: null }
}

// ── One entry line ───────────────────────────────────────────────────────────

/** Looks like a cron field rather than a command — used to catch a 6-field paste. */
const CW_FIELD_SHAPED = /^[\d*,\-/]+$/

/**
 * Commands common enough that seeing one in the user column means the paste is
 * an ordinary user crontab, not `/etc/cron.d`. Only ever used to suppress a
 * *hint*; nothing about the parse depends on it.
 */
const CW_COMMON_COMMANDS = new Set([
  'awk', 'bash', 'cat', 'cd', 'composer', 'curl', 'date', 'docker', 'echo', 'env',
  'find', 'flock', 'git', 'go', 'gzip', 'java', 'logger', 'make', 'mv', 'node',
  'npm', 'perl', 'php', 'pnpm', 'psql', 'python', 'python3', 'rm', 'rsync',
  'ruby', 'sh', 'sleep', 'systemctl', 'tar', 'test', 'touch', 'wget', 'yarn',
  'zsh',
])

const CW_USERNAME = /^[a-z_][a-z0-9_-]{0,31}\$?$/

function cwEntryError(n: number, text: string, message: string): CwCrontabLine {
  return { n, kind: 'error', text, message }
}

function cwReadEntry(
  n: number,
  text: string,
  systemUser: boolean,
  zone: string | null,
  zoneSource: CwZoneSource,
  zoneOk: boolean,
): CwCrontabLine {
  const trimmed = text.trim()
  let schedule: string
  let remainder: string

  if (trimmed.startsWith('@')) {
    const m = /^(@\S+)(?:[ \t]+(.*))?$/.exec(trimmed) as RegExpExecArray
    schedule = m[1]
    remainder = (m[2] ?? '').trim()
  } else {
    const m = /^(\S+(?:[ \t]+\S+){4})(?:[ \t]+(.*))?$/.exec(trimmed)
    if (!m) {
      const got = trimmed.split(/\s+/).length
      return cwEntryError(n, text, `Expected 5 schedule fields and a command — got ${got} field${got === 1 ? '' : 's'}.`)
    }
    schedule = m[1].replace(/[ \t]+/g, ' ')
    remainder = (m[2] ?? '').trim()
  }

  let parsed: CwParsed
  try {
    parsed = cwParse(schedule)
  } catch (err) {
    return cwEntryError(n, text, (err as Error).message)
  }

  if (!remainder) {
    return cwEntryError(n, text, 'This line has a schedule but no command — cron would ignore it.')
  }
  // A 6-field (seconds-leading) expression pasted into a crontab reads as a
  // 5-field schedule whose command is a lone cron field. Saying so beats
  // previewing a schedule the file could never have meant.
  if (!trimmed.startsWith('@') && CW_FIELD_SHAPED.test(remainder)) {
    return cwEntryError(
      n, text,
      `"${remainder}" is not a command. This looks like a 6-field (seconds-first) expression — real crontab lines are 5 fields and then a command.`,
    )
  }

  let user: string | null = null
  let rest = remainder
  if (systemUser) {
    const m = /^(\S+)[ \t]+(.*)$/.exec(remainder)
    if (!m || !m[2].trim()) {
      return cwEntryError(n, text, 'No command after the user column — a system crontab line is 5 fields, a user, then the command.')
    }
    user = m[1]
    rest = m[2].trim()
  }

  const { command, stdin } = cwSplitPercent(rest)
  const entry: CwCrontabEntry = { n, schedule, parsed, user, command, stdin, zone, zoneSource, zoneOk }
  return { n, kind: 'entry', text, entry }
}

// ── The file ─────────────────────────────────────────────────────────────────

/**
 * Read a whole crontab. Line numbers are 1-based and match the pasted text, so
 * every message the UI shows can point at the line the reader is looking at.
 *
 * The zone carried on each entry is the one in force *at that point in the
 * file*, which is the whole reason this is a document parse and not a loop over
 * `cwParse`.
 */
export function cwParseCrontab(text: string, opts: CwCrontabOpts = {}): CwCrontabDoc {
  const systemUser = opts.systemUser === true
  let truncated = text.length > CW_CRONTAB_MAX_CHARS
  const rows = (truncated ? text.slice(0, CW_CRONTAB_MAX_CHARS) : text).split(/\r\n|\r|\n/)
  if (rows.length > CW_CRONTAB_MAX_LINES) truncated = true

  const lines: CwCrontabLine[] = []
  const entries: CwCrontabEntry[] = []
  const errors: CwCrontabLine[] = []
  const assignments: CwCrontabLine[] = []

  let zone: string | null = null
  let zoneSource: CwZoneSource = null
  let zoneOk = true
  let usesTz = false

  for (let i = 0; i < rows.length && i < CW_CRONTAB_MAX_LINES; i++) {
    const raw = rows[i]
    const n = i + 1
    const trimmed = raw.trim()

    if (!trimmed) {
      lines.push({ n, kind: 'blank', text: raw })
      continue
    }
    // Only at the start of a line. A `#` after a command belongs to the command.
    if (trimmed.startsWith('#')) {
      lines.push({ n, kind: 'comment', text: raw })
      continue
    }

    const env = cwParseEnvLine(raw)
    if (env) {
      const line: CwCrontabLine = { n, kind: 'env', text: raw, env }
      if (env.name === 'CRON_TZ' || env.name === 'TZ') {
        if (!env.value) {
          // An empty assignment clears the override rather than naming ''.
          zone = null
          zoneSource = null
          zoneOk = true
        } else {
          zone = env.value
          zoneSource = env.name === 'TZ' ? 'TZ' : 'CRON_TZ'
          zoneOk = cwZoneValid(env.value)
          if (!zoneOk) line.message = `"${env.value}" is not a time zone this browser knows, so the entries below it fall back to the picked zone.`
        }
      }
      lines.push(line)
      assignments.push(line)
      continue
    }

    if (entries.length >= CW_CRONTAB_MAX_ENTRIES) {
      truncated = true
      break
    }

    const line = cwReadEntry(n, raw, systemUser, zone, zoneSource, zoneOk)
    lines.push(line)
    if (line.entry) {
      entries.push(line.entry)
      if (line.entry.zoneSource === 'TZ') usesTz = true
    } else {
      errors.push(line)
    }
  }

  return { lines, entries, errors, assignments, usesTz, truncated }
}

/**
 * Does this paste look like a system crontab — `/etc/crontab` or a file in
 * `/etc/cron.d`, where a user column sits between the schedule and the command?
 *
 * Deliberately only a *hint*: the answer changes which token is the command, and
 * `0 0 * * * php /srv/app/cron.php` is indistinguishable from a system line by
 * shape alone. So this asks for agreement across the whole file — every entry
 * must carry a username-shaped word followed by more text, and none of those
 * words may be a command anyone would recognise. A false negative costs a hint;
 * a false positive would quietly relabel the command, so the test is the strict
 * one.
 */
export function cwLooksLikeSystemCrontab(text: string): boolean {
  const doc = cwParseCrontab(text)
  if (doc.entries.length === 0) return false
  return doc.entries.every(e => {
    const m = /^(\S+)[ \t]+\S/.exec(e.command)
    if (!m) return false
    const word = m[1]
    return CW_USERNAME.test(word) && !CW_COMMON_COMMANDS.has(word)
  })
}

// ── Merging entries into one timeline ────────────────────────────────────────

export interface CwTimelineRow {
  ms: number
  /** Index into the entry list the rows were merged from. */
  entry: number
  run: CwRun
  /** True when another entry fires at this exact instant. */
  collides: boolean
}

/**
 * Merge each entry's own upcoming runs into the file's timeline: what fires
 * next, in order, and what fires *together*.
 *
 * Two properties this relies on, both asserted:
 *
 *  1. **The global first K is a subset of the per-entry first K.** A run in the
 *     global first K has at most K−1 runs before it anywhere, so it has at most
 *     K−1 before it within its own entry. Collecting K per entry is therefore
 *     enough, and the caller never has to guess a horizon.
 *  2. **A tie is never cut in half.** The cap stops at K rows *unless* the next
 *     row lands on the same instant as the last kept one — a collision that
 *     showed only one of its two jobs would be worse than not showing it at
 *     all. (Callers collect K+1 per entry so the tie group at the boundary is
 *     complete even when one entry contributes both of its rows.)
 *
 * Skipped runs — a spring-forward reading a wildcard schedule never makes up —
 * are left out: this list answers "what runs", and the per-entry panel is where
 * the ones that do not run are explained.
 */
export interface CwCollision {
  ms: number
  /** Indices of the entries that start together, ascending. */
  entries: number[]
}

/**
 * Every instant inside `horizonMs` where more than one entry starts.
 *
 * "Which of my jobs run at the same time" is one of the two questions a crontab
 * owner actually has, and the answer must not depend on how many rows the panel
 * happens to show: on a file with one five-minute job, every visible row is that
 * job and the midnight pile-up everyone is looking for is off-screen. So this
 * takes its own collection over a stated window rather than reusing the display
 * list.
 *
 * The window has to be bounded in the one dimension that can run away — a
 * per-minute entry contributes 1 440 runs a day on its own — so callers cap each
 * entry's collection at `maxRuns`. An entry that hits the cap is not silently
 * half-compared: it is returned in `busy` and left out of `hits` entirely,
 * because a partial enumeration of a job that runs constantly would report
 * *fewer* collisions than really happen, which is the wrong direction to be
 * wrong in. Naming it costs one sentence and stays true.
 */
export function cwCollisions(
  lists: { entry: number; runs: CwRun[] }[],
  horizonMs: number,
  maxRuns: number,
): { hits: CwCollision[]; busy: number[] } {
  const busy: number[] = []
  const byMs = new Map<number, Set<number>>()

  for (const { entry, runs } of lists) {
    let fired = 0
    for (const r of runs) if (r.fires) fired++
    if (fired >= maxRuns) {
      busy.push(entry)
      continue
    }
    for (const r of runs) {
      if (!r.fires || r.ms > horizonMs) continue
      const at = byMs.get(r.ms)
      if (at) at.add(entry)
      else byMs.set(r.ms, new Set([entry]))
    }
  }

  const hits: CwCollision[] = []
  for (const [ms, set] of byMs) {
    if (set.size > 1) hits.push({ ms, entries: [...set].sort((a, b) => a - b) })
  }
  hits.sort((a, b) => a.ms - b.ms)
  return { hits, busy }
}

export function cwMergeRuns(lists: { entry: number; runs: CwRun[] }[], count: number): CwTimelineRow[] {
  const all: CwTimelineRow[] = []
  for (const { entry, runs } of lists) {
    for (const run of runs) {
      if (run.fires) all.push({ ms: run.ms, entry, run, collides: false })
    }
  }
  all.sort((a, b) => a.ms - b.ms || a.entry - b.entry)

  const kept: CwTimelineRow[] = []
  for (const row of all) {
    if (kept.length >= count && row.ms !== kept[kept.length - 1].ms) break
    kept.push(row)
  }
  // Ties are contiguous after the sort, so walk them as a group. Neighbour-only
  // checks are not enough: one entry can contribute two rows at one instant
  // (both readings of a spring-forward gap are made up at the jump), which puts
  // a same-entry row between two different-entry ones.
  for (let i = 0; i < kept.length;) {
    let j = i
    while (j < kept.length && kept[j].ms === kept[i].ms) j++
    const distinct = new Set(kept.slice(i, j).map(r => r.entry)).size
    for (let k = i; k < j; k++) kept[k].collides = distinct > 1
    i = j
  }
  return kept
}
