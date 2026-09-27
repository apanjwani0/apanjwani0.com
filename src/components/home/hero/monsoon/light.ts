/**
 * The two lights the room has, shared by the passes that shade with them:
 * what comes in through the window (the city by night, an overcast monsoon sky
 * by day, graded by the colour of the hour) and a flame's colour.
 *
 * Values are linear RGB. A flame is far brighter than 1; the passes tone-map.
 */
import type { Vec3 } from './types'

/** A match or candle flame, about 2000 K. */
export const FLAME_RGB: Vec3 = [1.0, 0.56, 0.24]

const NIGHT: Vec3 = [0.3, 0.16, 0.42] // magenta and violet neon spill
const NIGHT_CYAN: Vec3 = [0.08, 0.2, 0.26] // the cyan half of the signs
const DAY: Vec3 = [0.52, 0.58, 0.66] // overcast monsoon sky

/** The window's light on the room for this moment: its colour and strength
 *  together. `hour` is day.ts hourColor for the story time. Writes `out`. */
export function windowLight(dayness: number, hour: Vec3, out: Vec3): Vec3 {
  const n = 1 - dayness
  for (let i = 0; i < 3; i += 1) {
    const night = (NIGHT[i] + NIGHT_CYAN[i]) * 0.55
    const day = DAY[i]
    // The hour tints dawn and dusk most, when the sky itself is coloured.
    const tint = 0.75 + 0.25 * hour[i]
    out[i] = (night * n + day * dayness) * tint
  }
  return out
}
