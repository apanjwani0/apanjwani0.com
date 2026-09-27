/**
 * "Want this sooner?" — a per-slug interest counter for coming-soon pages.
 *
 * The smallest useful piece of server state a placeholder page can have: a
 * visitor presses one button and the number goes up for everyone. That is the
 * whole feature. It is here rather than in a form because a form needs
 * moderation, storage bounds on free text, and an escaping story; a counter
 * needs none of those and answers the only question the page is asking.
 *
 * PRIVACY: a count per slug and nothing else. No IPs, no identifiers, no
 * timestamps per vote — the same aggregate-only line src/lib/visits.ts and the
 * Type Trial board hold (AGENTS.md → Analytics). There is deliberately no way to
 * ask "who voted", because nothing that could answer it is stored. The one-vote-
 * per-browser behaviour lives in localStorage on the client and is UX, not a
 * control: the server's defence is the rate limiter, and a determined visitor
 * inflating a wishlist counter is not a threat worth identity for.
 *
 * BOUNDS (a public endpoint must be bounded in every dimension — AGENTS.md):
 * - Distinct keys: the caller passes a slug it derived from the games config,
 *   never one from the request body. That allowlist IS the key bound — the store
 *   can hold at most one entry per coming-soon game, whatever arrives.
 * - Per-key value: capped at INTEREST_MAX_COUNT so a stuck client cannot walk a
 *   counter to Number.MAX_SAFE_INTEGER and start printing garbage.
 * - Writes: debounced to disk like src/lib/visits.ts, never one write per
 *   request — otherwise any visitor is a disk-I/O amplifier.
 * Body size and rate limits live in the route.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Past this the number has stopped meaning anything anyway. */
export const INTEREST_MAX_COUNT = 1_000_000
const FLUSH_MS = 5_000

type InterestStore = Record<string, number>

let store: InterestStore | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

function storePath(): string {
  return join(process.cwd(), 'data', 'interest.json')
}

/**
 * Re-validate every row on the way in. The file outlives deploys and can be
 * hand-edited, so a corrupt value must degrade to "no votes yet" rather than
 * render `NaN` on a public page. Pure, so security:smoke can assert it.
 */
export function sanitizeStore(parsed: unknown): InterestStore {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const clean: InterestStore = {}
  for (const [slug, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[a-z0-9-]{1,64}$/.test(slug)) continue
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) continue
    clean[slug] = Math.min(value, INTEREST_MAX_COUNT)
  }
  return clean
}

async function loadStore(): Promise<InterestStore> {
  if (store) return store
  try {
    store = sanitizeStore(JSON.parse(await readFile(storePath(), 'utf-8')))
  } catch {
    store = {} // First run or unreadable file — start empty rather than fail.
  }
  return store
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
    await mkdir(join(process.cwd(), 'data'), { recursive: true })
    await writeFile(storePath(), JSON.stringify(store), 'utf-8')
  } catch (error) {
    // Memory still holds the counts; re-arm rather than lose them.
    scheduleFlush()
    console.error('[interest] flush failed', error)
  }
}

/** Current count for a slug. Zero when nothing has been recorded. */
export async function getInterest(slug: string): Promise<number> {
  return (await loadStore())[slug] ?? 0
}

/**
 * Record one vote and return the new count.
 *
 * The caller must have already checked `slug` against the set of coming-soon
 * games it read from config — this function trusts its argument, and the whole
 * key bound rests on that check happening at the route. Passing a body field
 * straight in would make the store unbounded.
 */
export async function addInterest(slug: string): Promise<number> {
  const current = await loadStore()
  const next = Math.min((current[slug] ?? 0) + 1, INTEREST_MAX_COUNT)
  current[slug] = next
  scheduleFlush()
  return next
}
