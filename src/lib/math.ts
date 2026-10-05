/** Pin `n` to the range [lo, hi]. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** The device pixel ratio, capped so a dense screen doesn't multiply canvas cost. Client-only. */
export function cappedDpr(max = 2): number {
  return Math.min(window.devicePixelRatio || 1, max)
}
