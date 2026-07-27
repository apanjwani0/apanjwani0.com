/**
 * net-log.ts — the replicated-log wire format, independent of any transport.
 *
 * The engine is a pure deterministic reducer, so online play never syncs game
 * STATE — it syncs an ordered, append-only LOG of hand seeds + actions and every
 * peer replays it to the identical table (proven in engine.selfcheck.ts). These
 * types are that log's shape; a transport (loopback locally, PocketBase online)
 * just moves `LogEntry`s around in order. See docs/poker-backend.md.
 */
import type { Action, SeatKind, BotPersonality, VariantId } from './types'

/** A seat as captured in a `deal` entry — enough to reconstruct the hand anywhere. */
export interface SeatSnapshot {
  index: number
  kind: SeatKind
  name: string
  chips: number
  personality?: BotPersonality
}

/** Table config carried on every `deal` so a joiner (who holds no local Room) can
 *  render the table and replay the shuffle without a separate handshake. */
export interface DealConfig {
  name: string
  variantId: VariantId
  smallBlind: number
  bigBlind: number
  ante: number
}

/** One entry in the replicated log: `deal` opens a hand, `action` is one move. */
export type LogEntry =
  | { seq: number; kind: 'deal'; seed: string; button: number; handNumber: number; seats: SeatSnapshot[]; config: DealConfig }
  | { seq: number; kind: 'action'; seat: number; action: Action }

/** An entry minus the transport-assigned `seq` — what callers submit to `append`. */
export type EntryBody = Omit<LogEntry, 'seq'>

/** A connected participant. `seat` is the seat they control; null = spectator. */
export interface Peer {
  id: string
  name: string
  seat: number | null
}

/** The transport contract shared by the loopback (local) and PocketBase (online)
 *  paths: submit ordered entries, receive them in order, presence, teardown. */
export interface Transport {
  append(body: EntryBody): void
  destroy(): void
}
