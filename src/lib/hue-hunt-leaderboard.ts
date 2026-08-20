/**
 * Hue Hunt — daily-colours leaderboard store (server only).
 *
 * The daily shipped as a shared *puzzle* with no shared scoreboard: everyone got
 * the same five colours and compared a copy-pasted grid by hand. This is the
 * other half — a per-UTC-day board you join by name.
 *
 * What makes it worth having a server at all is that the score is not submitted.
 * A submission is the day plus the five raw hex guesses; the route re-derives
 * the day's colours and re-computes the total with `scoreDailyGuesses()` from
 * src/lib/hue-hunt-daily.ts (the same module the browser scores with), and this
 * store only ever records the number the SERVER computed. See that file for what
 * that does and does not buy.
 *
 * Storage is module state (the Node adapter runs as one container, so state is
 * shared across requests) with a debounced flush to data/hue-hunt-daily.json,
 * mirroring src/lib/type-trial-leaderboard.ts and src/lib/visits.ts — never write
 * per request, and never let a flush failure take the site down.
 *
 * PRIVACY: an entry is a self-chosen display name, a 0-500 score and a
 * timestamp. No IPs, no user agents, no identifiers — the same line visits.ts
 * holds, which is what keeps the site free of a consent banner. The name is
 * sanitized here; storage is JSON, so nothing here interprets it, and the
 * renderer puts it in a text node rather than markup.
 *
 * BOUNDS (a public endpoint must be bounded in every dimension — AGENTS.md):
 * body size and rate limits live in the route; here: name length, entries per
 * day (top-N by score, one entry per normalized name), retained days, and the
 * numeric range a stored row may hold. The file is therefore at most
 * HUE_RETAINED_DAYS x HUE_MAX_ENTRIES_PER_DAY x (a name and two numbers).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HUE_DAILY_MAX, hueDayNumber, isValidHueDay } from './hue-hunt-daily'
import { DAILY_NAME_MAX, DAILY_NAME_MIN, sanitizeName } from './type-trial-leaderboard'

/**
 * One display-name hygiene rule for every board on the site, deliberately.
 *
 * The stripping this does — control characters, zero-width joiners, bidi
 * overrides — is what stops a name spoofing its neighbours on a public list, and
 * two copies of that regex drift. If they drifted, an abuser would simply pick
 * whichever board had the weaker copy. Re-exported rather than re-implemented so
 * the coupling is one import line, and so the assertion that covers it in
 * security:smoke covers both boards at once.
 */
export { sanitizeName, DAILY_NAME_MAX as HUE_NAME_MAX, DAILY_NAME_MIN as HUE_NAME_MIN }

export interface HueEntry {
  name: string
  /** Total across the day's five colours, 0-HUE_DAILY_MAX. Server-computed,
   *  never a value that arrived in a request body. */
  score: number
  /** Submission time (epoch ms) — first-come wins ties, and it dates the row. */
  at: number
}

export const HUE_MAX_ENTRIES_PER_DAY = 100
export const HUE_RETAINED_DAYS = 7
const FLUSH_MS = 5_000

/** day number (as a string key) -> entries, sorted best-first. */
type HueBoard = Record<string, HueEntry[]>

let store: HueBoard | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

function boardPath(): string {
  return join(process.cwd(), 'data', 'hue-hunt-daily.json')
}

/** Best first: score desc, then the earlier submission. */
function compareEntries(a: HueEntry, b: HueEntry): number {
  return (b.score - a.score) || (a.at - b.at)
}

/** Exported so security:smoke can assert it: a row read back off disk gets the
 *  same treatment a submitted one does, which is what makes a hand-edited file
 *  degrade to an empty board instead of parking an impossible 9999 at the top. */
export function sanitizeStoredEntry(value: unknown): HueEntry | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const name = sanitizeName(v.name)
  if (!name) return null
  const score = typeof v.score === 'number' ? Math.round(v.score) : NaN
  const at = typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : Date.now()
  if (!Number.isInteger(score) || score < 0 || score > HUE_DAILY_MAX) return null
  return { name, score, at }
}

/** Lazy one-time load. The file is written only by this module, but it lives on
 *  disk across deploys, so every row is re-validated on the way in — a corrupt
 *  or hand-edited file degrades to an empty board, never a crash or an
 *  out-of-range score sitting at the top of the list forever. */
async function loadStore(): Promise<HueBoard> {
  if (store) return store
  const loaded: HueBoard = {}
  try {
    const parsed = JSON.parse(await readFile(boardPath(), 'utf-8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [day, rows] of Object.entries(parsed)) {
        if (!isValidHueDay(Number(day)) || !/^\d+$/.test(day) || !Array.isArray(rows)) continue
        const clean = rows
          .map(sanitizeStoredEntry)
          .filter((e): e is HueEntry => e !== null)
          .sort(compareEntries)
          .slice(0, HUE_MAX_ENTRIES_PER_DAY)
        if (clean.length) loaded[day] = clean
      }
    }
  } catch {
    // First run or unreadable file — start empty rather than fail.
  }
  store = loaded
  return store
}

/** Drop days beyond retention. Numeric, because the key is a day *number* — a
 *  lexicographic compare would keep "9" and drop "10". Pure so smoke can assert it. */
export function pruneHueBoard(board: HueBoard, today: number, retainedDays = HUE_RETAINED_DAYS): HueBoard {
  const cutoff = today - retainedDays
  return Object.fromEntries(
    Object.entries(board).filter(([day]) => {
      const n = Number(day)
      return Number.isInteger(n) && n > cutoff && n <= today
    }),
  )
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flush()
  }, FLUSH_MS)
  ;(flushTimer as unknown as { unref?: () => void }).unref?.()
}

async function flush(): Promise<void> {
  if (!store) return
  try {
    // Today is read here rather than passed in from the submit that armed the
    // timer: the two differ exactly when a flush straddles UTC midnight, and the
    // fresh value is the correct one.
    store = pruneHueBoard(store, hueDayNumber())
    await mkdir(join(process.cwd(), 'data'), { recursive: true })
    await writeFile(boardPath(), JSON.stringify(store), 'utf-8')
  } catch (error) {
    // A leaderboard must never take the site down; memory still has the rows,
    // so re-arm and retry rather than dropping the day's board on the floor.
    scheduleFlush()
    console.error('[hue-hunt] leaderboard flush failed', error)
  }
}

/** Top entries for a day, best first. */
export async function listHueDaily(day: number, limit = 50): Promise<HueEntry[]> {
  const board = await loadStore()
  return (board[String(day)] ?? []).slice(0, limit)
}

export interface HueSubmitResult {
  /** 1-based rank on the day's board, or null when the entry did not place. */
  rank: number | null
  /** True when an existing entry under the same name already scored at least as well. */
  keptPrevious: boolean
}

/**
 * Record a server-computed entry. One row per normalized (case-folded) name per
 * day — resubmitting keeps whichever run scored higher, so a replay after
 * clearing local storage improves your row instead of flooding the board with
 * near-duplicates. The day's list is capped at HUE_MAX_ENTRIES_PER_DAY; an entry
 * below the cut simply does not place (rank null), which is also what caps what
 * an abuser can grow.
 */
export async function submitHueDaily(day: number, entry: HueEntry): Promise<HueSubmitResult> {
  const board = await loadStore()
  const key = String(day)
  const rows = board[key] ?? (board[key] = [])
  const nameKey = entry.name.toLowerCase()
  const existingIdx = rows.findIndex(r => r.name.toLowerCase() === nameKey)
  let keptPrevious = false
  if (existingIdx >= 0) {
    if (compareEntries(rows[existingIdx], entry) <= 0) {
      keptPrevious = true // previous run ranks at least as well — keep it
    } else {
      rows.splice(existingIdx, 1)
      rows.push(entry)
    }
  } else {
    rows.push(entry)
  }
  rows.sort(compareEntries)
  if (rows.length > HUE_MAX_ENTRIES_PER_DAY) rows.length = HUE_MAX_ENTRIES_PER_DAY
  scheduleFlush()
  const rank = rows.findIndex(r => r.name.toLowerCase() === nameKey)
  return { rank: rank >= 0 ? rank + 1 : null, keptPrevious }
}
