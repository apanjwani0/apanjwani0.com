/**
 * Poker Together — rooms store.
 *
 * Dependency-free, localStorage-backed persistence for poker rooms, with
 * cross-tab presence via BroadcastChannel (storage events as a fallback).
 * Every localStorage/window/BroadcastChannel touch is wrapped defensively so
 * importing this module can never throw — it is bundled into an SSR page
 * where none of those globals exist.
 *
 * See ./types.ts for the shared `Room`, `RoomConfig`, `RoomSeat`, `RoomsAPI`,
 * `SeatKind`, `BotPersonality`, `BOT_PERSONALITIES`, `PERSONALITY_LABEL`,
 * `VARIANTS`, `MAX_ROOMS`, `ROOM_SEAT_CAP` and `LS` contract this module
 * implements.
 */

import {
  BOT_PERSONALITIES,
  LS,
  MAX_ROOMS,
  ROOM_SEAT_CAP,
  type BotPersonality,
  type Room,
  type RoomConfig,
  type RoomSeat,
  type RoomsAPI,
} from './types'

/* ────────────────────────────  names  ──────────────────────────── */

/** A tasteful, fixed list of poker-ish bot names. */
const BOT_NAMES: readonly string[] = [
  'Ace Ventura', 'Riverboat Sal', 'Lucky Lefty', 'Dead Man’s Dora',
  'Big Slick', 'Grinder Gus', 'Nervous Ned', 'The Cooler', 'Fold Equity Fran',
  'Shark Bait', 'Calling Carl', 'Bluff City Betty', 'Chip Leader Chuck',
  'Tilted Tina', 'Quiet Storm',
]

/** Deterministic-ish bot name from a fixed fun list, indexed by seat order. */
export function botName(i: number): string {
  return BOT_NAMES[i % BOT_NAMES.length] ?? `Bot ${i + 1}`
}

/* ────────────────────────────  prefs  ───────────────────────────── */

interface Prefs {
  name?: string
}

function readPrefs(): Prefs {
  try {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return {}
    const raw = window.localStorage.getItem(LS.prefs)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as Prefs
    return {}
  } catch {
    return {}
  }
}

/** Display name for the local human player, read from localStorage prefs. */
export function hostName(): string {
  const prefs = readPrefs()
  return typeof prefs.name === 'string' && prefs.name.trim().length > 0 ? prefs.name : 'You'
}

/** Persist the local human player's display name to localStorage prefs. */
export function setHostName(name: string): void {
  try {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return
    const prefs = readPrefs()
    prefs.name = name
    window.localStorage.setItem(LS.prefs, JSON.stringify(prefs))
  } catch {
    // ignore — best-effort persistence only
  }
}

/* ────────────────────────────  seats  ───────────────────────────── */

function randomPersonality(): BotPersonality {
  const idx = Math.floor(Math.random() * BOT_PERSONALITIES.length)
  return BOT_PERSONALITIES[idx] ?? 'balanced'
}

/** Build the initial seat layout for a new room from its config. */
export function makeSeats(config: RoomConfig): RoomSeat[] {
  const seatCount = Math.max(1, Math.min(config.seatCount, ROOM_SEAT_CAP))
  const botCount = Math.max(0, Math.min(config.botCount, seatCount - 1))
  const seats: RoomSeat[] = []

  // Seat 0: the host (human).
  seats.push({
    index: 0,
    kind: 'human',
    name: hostName(),
    chips: config.startingStack,
  })

  // Seats 1..botCount: bots.
  for (let i = 0; i < botCount; i++) {
    const personality = config.botPersonality === 'mixed' ? randomPersonality() : config.botPersonality
    seats.push({
      index: seats.length,
      kind: 'bot',
      name: botName(i),
      chips: config.startingStack,
      personality,
    })
  }

  // Remaining seats up to seatCount: empty.
  while (seats.length < seatCount && seats.length < ROOM_SEAT_CAP) {
    seats.push({
      index: seats.length,
      kind: 'empty',
      name: '',
      chips: 0,
    })
  }

  return seats
}

/* ─────────────────────────  id generation  ──────────────────────── */

function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // fall through to fallback
  }
  return `room_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/* ─────────────────────────  localStorage I/O  ───────────────────── */

function readRooms(): Room[] {
  try {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return []
    const raw = window.localStorage.getItem(LS.rooms)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as Room[]
  } catch {
    return []
  }
}

function writeRooms(list: Room[]): void {
  try {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return
    window.localStorage.setItem(LS.rooms, JSON.stringify(list))
  } catch {
    // ignore — best-effort persistence only
  }
}

/* ─────────────────────────  cross-tab presence  ─────────────────── */

let channel: BroadcastChannel | null | undefined

/** Lazily create (or reuse) the shared BroadcastChannel, guarded for SSR. */
function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel
  try {
    if (typeof BroadcastChannel === 'undefined') {
      channel = null
      return channel
    }
    channel = new BroadcastChannel('poker')
  } catch {
    channel = null
  }
  return channel
}

/* ──────────────────────────────  API  ───────────────────────────── */

export const rooms: RoomsAPI = {
  list(): Room[] {
    try {
      const list = readRooms()
      return list.slice().sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  },

  get(id: string): Room | null {
    try {
      const list = readRooms()
      return list.find((r) => r.id === id) ?? null
    } catch {
      return null
    }
  },

  create(name: string, config: RoomConfig): Room | { error: string } {
    try {
      const list = readRooms()
      if (list.length >= MAX_ROOMS) {
        return { error: `Room limit reached (${MAX_ROOMS}).` }
      }

      const now = Date.now()
      const room: Room = {
        id: makeId(),
        name,
        createdAt: now,
        updatedAt: now,
        config,
        seats: makeSeats(config),
        handNumber: 0,
      }

      list.push(room)
      writeRooms(list)
      rooms.broadcast()
      return room
    } catch {
      return { error: 'Could not create room.' }
    }
  },

  save(room: Room): void {
    try {
      const list = readRooms()
      const next = { ...room, updatedAt: Date.now() }
      const idx = list.findIndex((r) => r.id === room.id)
      if (idx >= 0) {
        list[idx] = next
      } else {
        list.push(next)
      }
      writeRooms(list)
      rooms.broadcast()
    } catch {
      // ignore — best-effort persistence only
    }
  },

  remove(id: string): void {
    try {
      const list = readRooms()
      const next = list.filter((r) => r.id !== id)
      writeRooms(next)
      rooms.broadcast()
    } catch {
      // ignore — best-effort persistence only
    }
  },

  subscribe(fn: () => void): () => void {
    const noop = () => {}
    let storageHandler: ((e: StorageEvent) => void) | null = null
    let channelHandler: ((e: MessageEvent) => void) | null = null

    try {
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        storageHandler = (e: StorageEvent) => {
          if (e.key === LS.rooms || e.key === LS.presence) fn()
        }
        window.addEventListener('storage', storageHandler)
      }
    } catch {
      storageHandler = null
    }

    try {
      const ch = getChannel()
      if (ch) {
        channelHandler = () => fn()
        ch.addEventListener('message', channelHandler)
      }
    } catch {
      channelHandler = null
    }

    return () => {
      try {
        if (storageHandler && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('storage', storageHandler)
        }
      } catch {
        // ignore
      }
      try {
        const ch = getChannel()
        if (ch && channelHandler) {
          ch.removeEventListener('message', channelHandler)
        }
      } catch {
        // ignore
      }
      noop()
    }
  },

  broadcast(): void {
    try {
      const ch = getChannel()
      if (ch) ch.postMessage({ type: 'rooms-changed', t: Date.now() })
    } catch {
      // ignore — BroadcastChannel unsupported or unavailable
    }
    try {
      if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
        window.localStorage.setItem(LS.presence, String(Date.now()))
      }
    } catch {
      // ignore — storage-event fallback unavailable
    }
  },
}
