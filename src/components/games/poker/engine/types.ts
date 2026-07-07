/**
 * Poker Together — shared engine contract.
 *
 * Every poker module (cards, evaluator, engine, bots, rooms, renderer) builds
 * against the types and constants declared here. Nothing in this file has
 * runtime behaviour beyond a few frozen constant tables, so it is safe for any
 * module to import. Chips are always integer play-money — there is no
 * real-money concept anywhere in this game.
 */

/* ────────────────────────────  cards  ──────────────────────────── */

export type Suit = 'c' | 'd' | 'h' | 's'
/** Rank as a number 2..14, where 11=J, 12=Q, 13=K, 14=A. */
export type Rank = number
export interface Card {
  r: Rank
  s: Suit
}

export const SUITS: readonly Suit[] = ['c', 'd', 'h', 's']
export const SUIT_SYMBOL: Record<Suit, string> = { c: '♣', d: '♦', h: '♥', s: '♠' }
export const SUIT_COLOR: Record<Suit, 'red' | 'black'> = { c: 'black', s: 'black', d: 'red', h: 'red' }
export const RANK_LABEL: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A',
}

/* ───────────────────────────  variants  ────────────────────────── */

export type VariantId = 'holdem' | 'omaha' | 'bomb'

export interface VariantConfig {
  id: VariantId
  name: string
  blurb: string
  /** hole cards dealt to each player */
  holeCards: number
  /** community cards dealt to the board (always 5 here) */
  boardCards: number
  /** if set, a made hand must use EXACTLY this many hole cards (Omaha = 2) */
  useHoleExactly: number | null
  /** Bomb pot: no preflop betting — everyone antes, both blinds skipped,
   *  flop is dealt immediately and betting opens on the flop. */
  bombPot: boolean
  minSeats: number
  maxSeats: number
}

export const VARIANTS: Record<VariantId, VariantConfig> = {
  holdem: {
    id: 'holdem', name: "Texas Hold'em",
    blurb: 'Two hole cards each, five community cards, make your best five.',
    holeCards: 2, boardCards: 5, useHoleExactly: null, bombPot: false, minSeats: 2, maxSeats: 10,
  },
  omaha: {
    id: 'omaha', name: 'Omaha (PLO)',
    blurb: 'Four hole cards — use EXACTLY two of them with three from the board.',
    holeCards: 4, boardCards: 5, useHoleExactly: 2, bombPot: false, minSeats: 2, maxSeats: 9,
  },
  bomb: {
    id: 'bomb', name: 'Bomb Pot',
    blurb: 'Everyone antes and is dealt in — no preflop, straight to a flop. Chaos.',
    holeCards: 2, boardCards: 5, useHoleExactly: null, bombPot: true, minSeats: 2, maxSeats: 10,
  },
}

/* ────────────────────────  hand evaluation  ────────────────────── */

/** Hand categories, higher = stronger. */
export const HAND_CATEGORY = {
  HIGH_CARD: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4,
  FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
} as const

export const CATEGORY_NAME: Record<number, string> = {
  0: 'High Card', 1: 'Pair', 2: 'Two Pair', 3: 'Three of a Kind', 4: 'Straight',
  5: 'Flush', 6: 'Full House', 7: 'Four of a Kind', 8: 'Straight Flush',
}

/**
 * A fully comparable hand rank. Compare by `cat` first, then element-wise by
 * `tb` (tiebreakers, most-significant first). `name` is a display string like
 * "Full House, Kings full of Twos".
 */
export interface HandRank {
  cat: number
  tb: number[]
  name: string
}

/** The evaluator module (evaluator.ts) must export these exact functions. */
export interface EvaluatorAPI {
  /** best five-card rank from 5..7 cards (Hold'em / Bomb / any-hole games) */
  evaluateBest(cards: Card[]): HandRank
  /** Omaha rule: best rank using EXACTLY 2 of 4 hole + EXACTLY 3 of 5 board */
  evaluateOmaha(hole: Card[], board: Card[]): HandRank
  /** >0 if a is stronger, <0 if b is stronger, 0 if a tie */
  compareRank(a: HandRank, b: HandRank): number
}

/* ─────────────────────────  seats & players  ───────────────────── */

export type SeatKind = 'human' | 'bot' | 'empty' | 'spectator'
export type BotPersonality = 'rock' | 'station' | 'balanced' | 'shark' | 'maniac'

export const BOT_PERSONALITIES: BotPersonality[] = ['rock', 'station', 'balanced', 'shark', 'maniac']
export const PERSONALITY_LABEL: Record<BotPersonality, string> = {
  rock: 'Rock (tight)', station: 'Calling Station', balanced: 'Balanced',
  shark: 'Shark (aggressive)', maniac: 'Maniac (wild)',
}

/* ───────────────────────────  engine  ──────────────────────────── */

export type Street = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'handover'
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'post-blind' | 'post-ante' | 'muck'

/** One player's state within a single hand. */
export interface PlayerHand {
  seatIndex: number
  hole: Card[]
  folded: boolean
  allIn: boolean
  /** chips committed on the CURRENT street */
  committed: number
  /** chips committed across the whole hand (drives side-pot math) */
  totalCommitted: number
  /** has acted since the last aggression on this street */
  actedThisRound: boolean
  lastAction?: ActionType
  lastAmount?: number
}

export interface Pot {
  amount: number
  /** seat indices still eligible to win this (side) pot */
  eligible: number[]
}

export interface LogEntry {
  t: number
  text: string
  kind: 'action' | 'system' | 'showdown' | 'deal'
}

export interface GameConfig {
  variant: VariantConfig
  smallBlind: number
  bigBlind: number
  ante: number
}

/** Full authoritative state of one hand of poker. */
export interface GameState {
  config: GameConfig
  /** players dealt into THIS hand, in seat order */
  players: PlayerHand[]
  /** seat meta keyed by seat index (survives across hands) */
  seatMeta: Record<number, { name: string; kind: SeatKind; personality?: BotPersonality }>
  /** authoritative stacks keyed by seat index */
  stacks: Record<number, number>
  board: Card[]
  deck: Card[]
  burn: Card[]
  street: Street
  buttonSeat: number
  /** seat index to act, or -1 when the betting round / hand is settled */
  toActSeat: number
  /** highest total committed on the current street (the amount to match) */
  betToMatch: number
  /** minimum legal raise INCREMENT for the current street */
  minRaise: number
  lastAggressorSeat: number
  pots: Pot[]
  handNumber: number
  log: LogEntry[]
  winners: { seatIndex: number; amount: number; rank?: HandRank; potIndex: number }[]
  complete: boolean
}

/** What the seat-to-act is allowed to do right now. */
export interface ActionRequest {
  seatIndex: number
  toCall: number
  canCheck: boolean
  canBet: boolean
  canRaise: boolean
  /** total amount a bet/raise must REACH (not the increment) */
  minRaiseTo: number
  /** all-in cap for this player */
  maxRaiseTo: number
  pot: number
  bigBlind: number
}

/** A player action. For bet/raise, `amount` is the TOTAL to reach this street. */
export interface Action {
  type: 'fold' | 'check' | 'call' | 'bet' | 'raise'
  amount?: number
}

/* ────────────────────────────  bots  ───────────────────────────── */

export interface BotDecisionInput {
  variant: VariantConfig
  hole: Card[]
  board: Card[]
  toCall: number
  pot: number
  myChips: number
  bigBlind: number
  canCheck: boolean
  minRaiseTo: number
  maxRaiseTo: number
  activeOpponents: number
  personality: BotPersonality
  street: Street
  /** injectable RNG for deterministic tests; defaults to Math.random */
  rng?: () => number
}

export interface BotDecision {
  action: 'fold' | 'check' | 'call' | 'bet' | 'raise'
  /** total amount to reach for bet/raise */
  amountTo?: number
  /** suggested "thinking" delay in ms for UX pacing */
  think?: number
}

/** bots.ts must export: decide(input: BotDecisionInput): BotDecision */
export interface BotsAPI {
  decide(input: BotDecisionInput): BotDecision
}

/* ───────────────────────────  rooms  ───────────────────────────── */

export const MAX_ROOMS = 10
export const ROOM_SEAT_CAP = 15

export interface RoomConfig {
  variantId: VariantId
  /** number of seats actually at the table (<= table max for the variant) */
  seatCount: number
  /** chips each seat starts with (the initial buy-in) */
  startingStack: number
  /** rebuy top-up amount; falls back to startingStack for rooms saved before this field existed */
  buyIn?: number
  smallBlind: number
  bigBlind: number
  ante: number
  botCount: number
  botPersonality: BotPersonality | 'mixed'
}

export interface RoomSeat {
  index: number
  kind: SeatKind
  name: string
  chips: number
  personality?: BotPersonality
}

export interface Room {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  config: RoomConfig
  /** up to ROOM_SEAT_CAP entries (players + bots + spectators) */
  seats: RoomSeat[]
  handNumber: number
}

/** rooms.ts must export a `rooms` object implementing this. */
export interface RoomsAPI {
  list(): Room[]
  get(id: string): Room | null
  create(name: string, config: RoomConfig): Room | { error: string }
  save(room: Room): void
  remove(id: string): void
  /** cross-tab presence: subscribe to any room-store change (this or other tabs) */
  subscribe(fn: () => void): () => void
  /** announce a change so other tabs re-render */
  broadcast(): void
}

/* ─────────────────────────  renderer view  ─────────────────────── */

export interface SeatView {
  index: number
  name: string
  chips: number
  /** hole cards; null entries render face-down */
  hole: (Card | null)[]
  folded: boolean
  allIn: boolean
  isButton: boolean
  isTurn: boolean
  isHero: boolean
  /** chips wagered in front on the current street */
  committed: number
  /** short status label e.g. "ALL IN", "FOLD", "RAISE 400" */
  status?: string
  empty: boolean
}

export interface TableView {
  seats: SeatView[]
  board: Card[]
  pot: number
  sidePots: number[]
  street: Street
  message?: string
  variantName: string
  handNumber: number
}

export interface LayoutConfig {
  mode: 'desktop' | 'mobile'
  /** seat anchor positions as fractions of the canvas (0..1), index 0 = hero (bottom) */
  seatPositions: { x: number; y: number }[]
  cardScale: number
}

export interface Renderer {
  draw(view: TableView): void
  resize(): void
  destroy(): void
}

/* ────────────────────────────  misc  ───────────────────────────── */

/** localStorage key namespace for the whole game. */
export const LS = {
  rooms: 'poker:rooms:v1',
  prefs: 'poker:prefs:v1',
  session: 'poker:session:v1',
  presence: 'poker:presence:v1',
} as const

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
