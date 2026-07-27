/**
 * net-pb.ts — the PocketBase online `Transport` for Poker Together.
 *
 * PocketBase is the SEQUENCER: the replicated log lives in `pk_actions` as
 * `{ room, seq, body }` rows. Two rules from the research (docs/poker-backend.md,
 * D8 in docs/poker-build-log.md) shape this client:
 *
 *  1. Order by our OWN `seq`, never by SSE arrival order (PB doesn't guarantee it).
 *     SSE is only a "something changed, go read" nudge; on every nudge — and right
 *     after our own append — we query `seq > lastSeen` sorted by seq and apply in
 *     order. On (re)connect the same query catches us up from wherever we are.
 *  2. Poker is strictly turn-based, so exactly one participant is "to act" at any
 *     instant and thus exactly one writer produces the next entry. That serializes
 *     writes for free: each client can safely stamp its own `seq = lastSeen + 1`
 *     with no coordination and no collision. The host still seals every `deal` and
 *     every bot action; a joiner only ever writes its own seat's moves.
 *
 * Presence is heartbeat rows in `pk_presence` (PB has no native presence). Plain
 * `fetch` + `EventSource`, no SDK, SSR-guarded. Base URL = `API_BASE` (net-api.ts).
 */
import { API_BASE } from './net-api'
import type { EntryBody, LogEntry, Transport } from './net-log'

const JSONH = { 'Content-Type': 'application/json' }
const AC = '/api/collections/pk_actions/records'
const PC = '/api/collections/pk_presence/records'

/** `seat` is a non-required number, and PB reports an unset number as 0 — which
 *  collides with the real seat 0. So the wire uses -1 for "no seat yet". */
const NO_SEAT = -1

export interface PbSessionOpts {
  /** Invite code — the shared channel key both host and joiners subscribe on. */
  room: string
  /** Stable per-client id (survives reconnects within a sitting). */
  peer: string
  /** Display name, for presence. */
  name: string
  /** Seat this client controls, or null until a joiner claims one. */
  seat: number | null
  /** Called once per log entry, in `seq` order — wire this to `applyEntry`. */
  onEntry: (e: LogEntry) => void
}

/** A `Transport` plus the online-only extras Poker.ts needs (announce a claimed seat). */
export interface PbSession extends Transport {
  /** Update the seat we advertise in presence (a joiner calls this once it claims). */
  setSeat(seat: number | null): void
}

export function createPbSession(opts: PbSessionOpts): PbSession {
  const { room, peer, name, onEntry } = opts
  const ssr = typeof window === 'undefined' || typeof fetch === 'undefined'

  let seat = opts.seat
  let lastSeen = -1        // highest seq handed to onEntry
  let nextSeq = 0          // seq to stamp on our next append
  let reading = false      // catchUp reentrancy guard
  let queued = false       // a nudge arrived mid-read → read again after
  let dead = false
  let es: EventSource | null = null
  let hb = 0
  let presenceId: string | null = null

  const roomFilter = (extra = '') => encodeURIComponent(`room="${room}"${extra}`)

  /** The heart of the seam: drain every entry we haven't applied yet, in seq order. */
  async function catchUp(): Promise<void> {
    if (dead || ssr) return
    if (reading) { queued = true; return }
    reading = true
    try {
      const url = `${API_BASE}${AC}?filter=${roomFilter(` && seq>${lastSeen}`)}&sort=seq&perPage=200`
      const res = await fetch(url)
      if (!res.ok) return
      const data = await res.json()
      const items: any[] = data.items ?? []
      for (const row of items) {
        if (dead) return
        if (row.seq <= lastSeen) continue
        lastSeen = row.seq
        if (row.seq >= nextSeq) nextSeq = row.seq + 1
        onEntry({ seq: row.seq, ...row.body } as LogEntry)
      }
      // A full page may hide more unseen rows behind it — keep draining.
      if (items.length >= 200) queued = true
    } catch {
      // transient (offline blip) — the next nudge or append retries from lastSeen
    } finally {
      reading = false
      if (queued && !dead) { queued = false; void catchUp() }
    }
  }

  function append(body: EntryBody): void {
    if (dead || ssr) return
    const seq = nextSeq++   // turn-order guarantees we're the only writer of this seq
    fetch(`${API_BASE}${AC}`, { method: 'POST', headers: JSONH, body: JSON.stringify({ room, seq, body }) })
      .then(() => catchUp())          // apply our own write immediately, don't wait for the SSE echo
      .catch(() => { nextSeq = seq }) // POST failed: release the seq so a retry can reuse it
  }

  /* ── presence: upsert a heartbeat row, unique on (room, peer) ── */

  async function heartbeat(): Promise<void> {
    if (dead || ssr) return
    const body = JSON.stringify({ room, peer, name, seat: seat ?? NO_SEAT })
    try {
      if (presenceId) {
        await fetch(`${API_BASE}${PC}/${presenceId}`, { method: 'PATCH', headers: JSONH, body })
        return
      }
      const res = await fetch(`${API_BASE}${PC}`, { method: 'POST', headers: JSONH, body })
      if (res.ok) { presenceId = (await res.json()).id; return }
      // unique (room,peer) clash (reconnect / raced first beat) → find our row and patch it
      const found = await fetch(`${API_BASE}${PC}?filter=${encodeURIComponent(`room="${room}" && peer="${peer}"`)}&perPage=1`)
      presenceId = (await found.json()).items?.[0]?.id ?? null
      if (presenceId) await fetch(`${API_BASE}${PC}/${presenceId}`, { method: 'PATCH', headers: JSONH, body })
    } catch {
      // best-effort — presence is observability, not correctness
    }
  }

  function setSeat(s: number | null): void { seat = s; void heartbeat() }

  /* ── SSE: one nudge per change; we re-read the authoritative log ── */

  function connectSSE(): void {
    if (ssr || typeof EventSource === 'undefined') return
    es = new EventSource(`${API_BASE}/api/realtime`)
    es.addEventListener('PB_CONNECT', (ev: MessageEvent) => {
      let clientId = ''
      try { clientId = JSON.parse(ev.data).clientId } catch { return }
      // (re)subscribe on every connect so a dropped SSE self-heals, then catch up
      fetch(`${API_BASE}/api/realtime`, {
        method: 'POST', headers: JSONH,
        body: JSON.stringify({ clientId, subscriptions: ['pk_actions'] }),
      }).then(() => catchUp()).catch(() => {})
    })
    es.addEventListener('pk_actions', () => catchUp())
    // EventSource auto-reconnects; PB_CONNECT above re-subscribes, so onerror is a no-op.
  }

  function destroy(): void {
    if (dead) return
    dead = true
    clearInterval(hb)
    es?.close(); es = null
    if (presenceId) fetch(`${API_BASE}${PC}/${presenceId}`, { method: 'DELETE' }).catch(() => {})
  }

  if (!ssr) {
    connectSSE()
    void heartbeat()
    hb = window.setInterval(heartbeat, 10000)
    void catchUp()
  }

  return { append, destroy, setSeat }
}
