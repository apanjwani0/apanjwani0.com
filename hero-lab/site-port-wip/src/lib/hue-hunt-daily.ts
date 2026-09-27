/**
 * Hue Hunt — shared daily-colours derivation and scoring.
 *
 * Imported by BOTH the browser component (src/components/games/hue-hunt/HueHunt.ts)
 * and the server route (/api/games/hue-hunt/daily), for the same reason
 * src/lib/type-trial-daily.ts exists: the two must not be able to disagree about
 * what today's five colours are, or about what a set of guesses is worth.
 *
 * That agreement is the whole security model of the leaderboard. A submission
 * carries the day and the five raw hex guesses and NOTHING ELSE — no score. The
 * server re-derives the day's colours with `dailyColors()` and re-computes the
 * score with `scoreDailyGuesses()`, then stores its own number. There is no
 * client-supplied total to trust, so there is nothing to forge arithmetically:
 * the number beside a name really is the score of the guesses that were sent.
 *
 * (What that does NOT buy: someone who reads these colours out of the JS bundle
 * can post a perfect run. That is unavoidable for a game whose answer must reach
 * the browser to be played, and capping the score would not help — a cheat just
 * submits one point lower. The board is an honour board whose *arithmetic* is
 * server-owned, which is the honest ceiling here and is worth stating plainly
 * rather than implying more.)
 *
 * Pure and dependency-free on purpose — no Node imports, no DOM — so it bundles
 * into the browser chunk and imports into an SSR route equally well.
 *
 * Deliberately NOT shared with src/lib/type-trial-daily.ts: that module's seed
 * exists so Type Trial's server and client agree about a passage, and folding a
 * second game into it would mean a change made for that leaderboard silently
 * reshuffles these colours.
 */

export type Rgb = { r: number; g: number; b: number }

/** Colours in a daily run. Five is short enough to finish in a minute and long
 *  enough that one lucky guess doesn't decide the score. */
export const HUE_DAILY_ROUNDS = 5

/** A run's ceiling: every colour is scored 0-100. */
export const HUE_DAILY_MAX = HUE_DAILY_ROUNDS * 100

/** Longest string that can be a hex colour: `#RRGGBB`. Bounds a submitted guess
 *  before it is parsed, so a megabyte of hex digits is rejected by length, not
 *  by a regex that has to walk it. */
export const HUE_GUESS_MAX_CHARS = 7

/** Day zero of the daily, fixed forever. It exists only so a run carries a small
 *  human number ("Hue Hunt #231") rather than a 20,000-something epoch day. */
const HH_EPOCH_DAY = Math.floor(Date.UTC(2025, 0, 1) / 86400000)

/**
 * Which daily is running, as a UTC day number.
 *
 * UTC rather than local midnight, for the reason Type Trial uses it too: the
 * entire value of a daily is that two people comparing results played the same
 * colours, and a local boundary quietly breaks that for anyone on the other side
 * of a date line. The cost is that "midnight" isn't yours, which the result card
 * states plainly instead of leaving the reset to be a surprise.
 */
export function hueDayNumber(now = Date.now()): number {
  return Math.floor(now / 86400000) - HH_EPOCH_DAY
}

/** Milliseconds until the next UTC midnight — the daily reset countdown. */
export function msUntilHueReset(now = Date.now()): number {
  return 86400000 - (now % 86400000)
}

/** A day number the server is willing to talk about at all. Bounds the store key
 *  space before any lookup: the route additionally pins it to *today*, but a
 *  shape check belongs with the type. */
export function isValidHueDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000
}

/* ── colour helpers ──────────────────────────────────────────── */

export function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

export function toHex(c: Rgb): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase()
}

/** Parse #rgb / #rrggbb (with or without the hash) → Rgb, or null if invalid. */
export function parseHex(s: unknown): Rgb | null {
  if (typeof s !== 'string' || s.length > HUE_GUESS_MAX_CHARS) return null
  let t = s.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(t)) t = t.split('').map(ch => ch + ch).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(t)) return null
  return {
    r: parseInt(t.slice(0, 2), 16),
    g: parseInt(t.slice(2, 4), 16),
    b: parseInt(t.slice(4, 6), 16),
  }
}

/** "Redmean" perceptual colour distance — cheap and noticeably better than raw RGB channels. */
export function colorDistance(a: Rgb, b: Rgb): number {
  const rbar = (a.r + b.r) / 2
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.sqrt((2 + rbar / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rbar) / 256) * db * db)
}

const MAX_DIST = colorDistance({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })

/**
 * 0–100 "match" percentage for a typed guess. Squaring the linear closeness makes
 * the score reward precision — a rough guess lands mid-range, a near-miss climbs fast.
 *
 * Lives here rather than in the component because the server re-computes it: if
 * the two ever drifted, the board would quietly disagree with the number the
 * player was just shown, which reads as the board being broken.
 */
export function accuracyPct(guess: Rgb, target: Rgb): number {
  const linear = 1 - colorDistance(guess, target) / MAX_DIST
  return Math.max(0, Math.round(100 * linear * linear))
}

/* ── the daily five ──────────────────────────────────────────── */

/**
 * FNV-1a over the day number seeding a mulberry32 stream, so every browser on
 * Earth — and the server — builds byte-identical colours for a given day with
 * nothing passed between them. A daily needs a *stream* from one seed, not a
 * single hash pick, which is why this is a generator and not a one-line index.
 */
function hueRng(day: number): () => number {
  let hash = 0x811c9dc5
  const key = String(day)
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  let a = hash >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** HSL (hue in degrees, saturation and lightness in 0–1) → Rgb. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r, g, b] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x]
  const m = l - c / 2
  return { r: clampByte((r + m) * 255), g: clampByte((g + m) * 255), b: clampByte((b + m) * 255) }
}

/**
 * The five colours everyone gets on `day`.
 *
 * Built from spaced hues rather than the uniform RGB draw the endless modes use:
 * three independent uniform channels land in the muddy middle far more often
 * than on a colour you could name, and a set that strangers compare should be
 * five *distinguishable* colours rather than five browns. Each hue is jittered
 * inside its own slot so no two of the day's colours are near-neighbours, then
 * the five are dealt in a seeded order — otherwise every day marches predictably
 * around the wheel and the third colour is guessable from the second.
 */
export function dailyColors(day: number): Rgb[] {
  const rand = hueRng(day)
  const slot = 360 / HUE_DAILY_ROUNDS
  const offset = rand() * 360
  const out: Rgb[] = []
  for (let i = 0; i < HUE_DAILY_ROUNDS; i += 1) {
    out.push(hslToRgb(offset + i * slot + rand() * slot * 0.7, 0.35 + rand() * 0.6, 0.3 + rand() * 0.45))
  }
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export interface DailyScore {
  /** One 0-100 match per colour, in round order. */
  scores: number[]
  /** Their sum — 0..HUE_DAILY_MAX by construction, never a submitted number. */
  total: number
}

/**
 * Score a complete set of guesses against the colours `day` derives.
 *
 * THE re-derivation. Everything a submission can influence is right here: the
 * day (which the route pins to the current UTC day before calling) and the raw
 * hex strings. The total is a pure function of those two, so it needs no bound
 * of its own — it cannot exceed HUE_DAILY_ROUNDS * 100 for the same reason a sum
 * of five numbers each at most 100 cannot.
 *
 * That is the difference from the trap Type Trial documents: there, wpm and sec
 * were two independently claimed numbers and bounding one of them was vacuous
 * because the other could move. Here the payload supplies no number at all, so
 * there is no "other field" for an attacker to set.
 *
 * Returns null for anything that is not exactly HUE_DAILY_ROUNDS parseable hex
 * guesses — a partial run is not a result.
 */
export function scoreDailyGuesses(day: number, guesses: unknown): DailyScore | null {
  if (!Array.isArray(guesses) || guesses.length !== HUE_DAILY_ROUNDS) return null
  const targets = dailyColors(day)
  const scores: number[] = []
  for (let i = 0; i < HUE_DAILY_ROUNDS; i += 1) {
    const guess = parseHex(guesses[i])
    if (!guess) return null
    scores.push(accuracyPct(guess, targets[i]))
  }
  return { scores, total: scores.reduce((a, b) => a + b, 0) }
}
