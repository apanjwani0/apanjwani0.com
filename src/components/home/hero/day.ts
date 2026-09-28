/**
 * The owner's clock, which the home hero runs on: minutes past midnight in
 * India, how much of that is day, and the colour of the hour. Ported from the
 * Hero Lab shell (round 5).
 */
const HERO_TIME_ZONE = 'Asia/Kolkata'
const DAY_MIN = 24 * 60

export type Rgb = [number, number, number]

function wrapMin(m: number): number {
  return ((Math.round(m) % DAY_MIN) + DAY_MIN) % DAY_MIN
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function hexRgb(hex: string): Rgb {
  return [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb
}

// Dev only: `?at=14:30` pins "now", so a screenshot or a review can show any
// hour on demand. `import.meta.env.DEV` is a build-time constant, so a
// production bundle never reads the query.
function pinnedMinutes(): number | null {
  if (!import.meta.env.DEV) return null
  const m = /[?&]at=(\d{1,2}):(\d{2})/.exec(location.search)
  return m ? (Number(m[1]) % 24) * 60 + (Number(m[2]) % 60) : null
}

let partsFmt: Intl.DateTimeFormat | null = null

/** Minutes past midnight in India at an instant (default: now). */
export function localMinutes(at?: Date): number {
  if (!at) {
    const pinned = pinnedMinutes()
    if (pinned !== null) return pinned
  }
  partsFmt ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: HERO_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  let h = 0
  let m = 0
  for (const part of partsFmt.formatToParts(at ?? new Date())) {
    if (part.type === 'hour') h = Number(part.value) % 24
    else if (part.type === 'minute') m = Number(part.value)
  }
  return h * 60 + m
}

/** 0 is deep night and 1 full day, eased through dawn (05:30–07:30) and dusk (17:30–19:30). */
export function dayness(min: number): number {
  const m = wrapMin(min)
  return smooth(330, 450, m) * (1 - smooth(1050, 1170, m))
}


// The colour of each hour, eased between keyframes: deep indigo after
// midnight, coral at dawn, amber through the working day, warm white at noon,
// rose at dusk, violet into the night.
const HOUR_KEYS: ReadonlyArray<readonly [number, Rgb]> = ([
  [0, '#3b2f8f'], [270, '#5b4fc4'], [345, '#ff8a7a'], [450, '#ffb35c'], [750, '#ffd9a0'],
  [990, '#ffb35c'], [1095, '#ff6f91'], [1170, '#9b8cff'], [1320, '#6f62d8'], [1440, '#3b2f8f'],
] as const).map(([at, hex]) => [at, hexRgb(hex)] as const)

/** The hour's colour as [r, g, b] in 0..1. Writes into `out` when one is
 *  passed, so a caller running every frame allocates nothing. */
export function hourColor(min: number, out: Rgb = [0, 0, 0]): Rgb {
  const m = wrapMin(min)
  for (let i = 1; i < HOUR_KEYS.length; i += 1) {
    const [bAt, cb] = HOUR_KEYS[i]
    if (m <= bAt) {
      const [aAt, ca] = HOUR_KEYS[i - 1]
      const t = smooth(aAt, bAt, m)
      out[0] = ca[0] + (cb[0] - ca[0]) * t
      out[1] = ca[1] + (cb[1] - ca[1]) * t
      out[2] = ca[2] + (cb[2] - ca[2]) * t
      return out
    }
  }
  const first = HOUR_KEYS[0][1]
  out[0] = first[0]
  out[1] = first[1]
  out[2] = first[2]
  return out
}
