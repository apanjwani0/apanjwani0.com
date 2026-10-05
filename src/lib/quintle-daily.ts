/**
 * Quintle's daily calendar — which puzzle number is "today".
 *
 * Extracted from the Quintle component for the same reason
 * `type-trial-daily.ts` and `hue-hunt-daily.ts` exist: more than one consumer
 * needs the derivation (the game itself, and the /games hub's daily-streak
 * strip), and two copies of a day formula disagree the first time one changes.
 * The component imports these; nothing here touches the DOM.
 */

import { MS_PER_DAY } from './date'

/** Fixed UTC launch date: every timezone advances to the next puzzle together. */
export const QUINTLE_EPOCH_DAY = Math.floor(Date.UTC(2025, 0, 1) / MS_PER_DAY)

/** Which Quintle day number is `d`? (UTC days since the launch date.) */
export function quintleDayNumber(d: Date = new Date()): number {
  return Math.floor(d.getTime() / MS_PER_DAY) - QUINTLE_EPOCH_DAY
}
