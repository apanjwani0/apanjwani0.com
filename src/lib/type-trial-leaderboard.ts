/**
 * Type Trial — daily-race leaderboard store (server only).
 *
 * The first *game* feature to use the server the site already pays for (the
 * Webhook Inspector was the first tool): everyone races the same UTC-daily
 * passage, and finished runs can be submitted to a shared per-day board.
 *
 * Storage is module state (the Node adapter runs as one container, so state is
 * shared across requests) with a debounced flush to data/type-trial-daily.json,
 * mirroring src/lib/visits.ts — never write per request, and never let a flush
 * failure take the site down. On Workers this would need KV/Durable Objects,
 * but the Node origin is the deploy target (see AGENTS.md).
 *
 * PRIVACY: an entry is a self-chosen display name plus wpm/accuracy/seconds and
 * a timestamp. No IPs, no user agents, no identifiers — same line visits.ts
 * holds. The name is sanitized here and HTML-escaped by every renderer; storage
 * is JSON, so nothing here interprets it.
 *
 * BOUNDS (a public endpoint must be bounded in every dimension — AGENTS.md):
 * body size and rate limits live in the route; here: name length, entries per
 * day (top-N by wpm, one entry per normalized name), retained days, and the
 * numeric ranges a submission may claim. The whole file is therefore at most
 * DAYS x ENTRIES x (a few short fields) — a few hundred KB worst case.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dailyPassage } from './type-trial-daily'

export interface DailyEntry {
  name: string
  wpm: number
  /** Accuracy percent, 0-100 integer. */
  acc: number
  /** Elapsed seconds, one decimal — kept so ties on wpm can show the human story. */
  sec: number
  /** Submission time (epoch ms) — first-come wins ties, and it dates the row. */
  at: number
}

export const DAILY_NAME_MIN = 2
export const DAILY_NAME_MAX = 24
export const DAILY_MAX_ENTRIES_PER_DAY = 100
export const DAILY_RETAINED_DAYS = 7
/** No verified human sustains 300+ wpm; anything above is a forged payload. */
export const DAILY_WPM_CAP = 250
const FLUSH_MS = 5_000

/**
 * Display-name hygiene: trim, collapse runs of whitespace, strip control and
 * zero-width/bidi characters (which would let a name spoof its neighbours on
 * the board), and enforce length. Returns null when nothing valid remains.
 * HTML-escaping is deliberately NOT done here — that belongs to the renderer,
 * because attribute vs text context decides what escaping means.
 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DAILY_NAME_MAX)
    .trim()
  return cleaned.length >= DAILY_NAME_MIN ? cleaned : null
}

/**
 * Server-side plausibility gate. The client is unauditable, so this cannot stop
 * a determined cheat — but it rejects every score that is *arithmetically
 * impossible* for the day's passage, which is what turns casual forgery into
 * work.
 *
 * The load-bearing fact: a run finishes only when the typed text equals the
 * passage exactly, so correct chars == passageLength and the client's own
 * formula makes wpm a FUNCTION of sec — (passageLength/5) / (sec/60). wpm and
 * sec are therefore not two free numbers; any pair that disagrees is forged.
 * Checking only "wpm <= that ceiling" would be vacuous, because the ceiling
 * grows without bound as the claimed sec shrinks: 250 wpm in 2s passes a
 * one-sided test, and then the cap is the only real limit. Pinning wpm TO the
 * expected value instead means a forger must claim a small sec, and the wpm cap
 * bounds how small — the honest ceiling of this model is "pretending to be a
 * DAILY_WPM_CAP typist", which is where an unauthenticated board has to land.
 *
 * Tolerance covers sec being rounded to one decimal and wpm to an integer.
 */
export function isPlausibleScore(
  score: { wpm: number; acc: number; sec: number },
  passageLength: number,
): boolean {
  const { wpm, acc, sec } = score
  if (!Number.isInteger(wpm) || wpm < 1 || wpm > DAILY_WPM_CAP) return false
  if (!Number.isInteger(acc) || acc < 0 || acc > 100) return false
  if (!Number.isFinite(sec) || sec < 1 || sec > 3600) return false
  const expected = (passageLength / 5) / (sec / 60)
  return Math.abs(wpm - expected) <= 1 + expected * 0.02
}

/** day -> entries, sorted best-first. */
type BoardStore = Record<string, DailyEntry[]>

let store: BoardStore | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

function boardPath(): string {
  return join(process.cwd(), 'data', 'type-trial-daily.json')
}

/** Best first: wpm desc, then accuracy desc, then earlier submission wins. */
function compareEntries(a: DailyEntry, b: DailyEntry): number {
  return (b.wpm - a.wpm) || (b.acc - a.acc) || (a.at - b.at)
}

function sanitizeStoredEntry(value: unknown): DailyEntry | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const name = sanitizeName(v.name)
  if (!name) return null
  const wpm = typeof v.wpm === 'number' ? Math.round(v.wpm) : NaN
  const acc = typeof v.acc === 'number' ? Math.round(v.acc) : NaN
  const sec = typeof v.sec === 'number' ? v.sec : NaN
  const at = typeof v.at === 'number' ? v.at : Date.now()
  if (!Number.isInteger(wpm) || wpm < 1 || wpm > DAILY_WPM_CAP) return null
  if (!Number.isInteger(acc) || acc < 0 || acc > 100) return null
  if (!Number.isFinite(sec) || sec < 0 || sec > 3600) return null
  return { name, wpm, acc, sec, at }
}

/** Lazy one-time load. The file is written only by this module, but it lives on
 *  disk across deploys, so every row is re-validated on the way in — a corrupt
 *  or hand-edited file degrades to an empty board, never a crash. */
async function loadStore(): Promise<BoardStore> {
  if (store) return store
  const loaded: BoardStore = {}
  try {
    const parsed = JSON.parse(await readFile(boardPath(), 'utf-8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [day, rows] of Object.entries(parsed)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(rows)) continue
        const clean = rows
          .map(sanitizeStoredEntry)
          .filter((e): e is DailyEntry => e !== null)
          .sort(compareEntries)
          .slice(0, DAILY_MAX_ENTRIES_PER_DAY)
        if (clean.length) loaded[day] = clean
      }
    }
  } catch {
    // First run or unreadable file — start empty rather than fail.
  }
  store = loaded
  return store
}

/** Drop days beyond retention. Pure so the smoke test can assert it. */
export function pruneBoard(board: BoardStore, now = new Date(), retainedDays = DAILY_RETAINED_DAYS): BoardStore {
  const cutoff = new Date(now.getTime() - retainedDays * 86_400_000).toISOString().slice(0, 10)
  return Object.fromEntries(Object.entries(board).filter(([day]) => day >= cutoff))
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
    store = pruneBoard(store)
    await mkdir(join(process.cwd(), 'data'), { recursive: true })
    await writeFile(boardPath(), JSON.stringify(store), 'utf-8')
  } catch (error) {
    // A leaderboard must never take the site down; memory still has the rows,
    // so re-arm and retry rather than dropping the day's board on the floor.
    scheduleFlush()
    console.error('[type-trial] leaderboard flush failed', error)
  }
}

/** Top entries for a day, best first. */
export async function listDaily(day: string, limit = 50): Promise<DailyEntry[]> {
  const board = await loadStore()
  return (board[day] ?? []).slice(0, limit)
}

export interface SubmitResult {
  /** 1-based rank on the day's board, or null when the entry did not place. */
  rank: number | null
  /** True when an existing entry under the same name already had a better run. */
  keptPrevious: boolean
}

/**
 * Record a validated entry. One row per normalized (case-folded) name per day —
 * resubmitting keeps whichever run ranks higher, so a better later run improves
 * your row instead of flooding the board with near-duplicates. The day's list
 * is capped at DAILY_MAX_ENTRIES_PER_DAY; an entry below the cut simply does
 * not place (rank null), which also caps what an abuser can grow.
 */
export async function submitDaily(day: string, entry: DailyEntry): Promise<SubmitResult> {
  const board = await loadStore()
  const rows = board[day] ?? (board[day] = [])
  const key = entry.name.toLowerCase()
  const existingIdx = rows.findIndex(r => r.name.toLowerCase() === key)
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
  if (rows.length > DAILY_MAX_ENTRIES_PER_DAY) rows.length = DAILY_MAX_ENTRIES_PER_DAY
  scheduleFlush()
  const rank = rows.findIndex(r => r.name.toLowerCase() === key)
  return { rank: rank >= 0 ? rank + 1 : null, keptPrevious }
}

/** Convenience for the route: the day's passage length, from the shared lib. */
export function passageLengthFor(day: string): number {
  return dailyPassage(day).length
}
