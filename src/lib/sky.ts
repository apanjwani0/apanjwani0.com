/**
 * The sky: an endless, slow drift of stars in depth, the nearer ones joined
 * into constellations that form and dissolve as they pass each other. The home
 * hero draws it behind its replay; the hubs draw it as their background
 * (`sky-ui.ts`). Pure drawing, no DOM at module scope.
 *
 * Exported for security:smoke, which drifts the stars and counts lines that pop.
 */
export interface Star { x: number; y: number; z: number; ph: number }
export interface SkyColors { star: string; line: string }

// px/s for the nearest stars; the owner asked for twice the first 7 (2026-09-30).
const DRIFT = 14
// Only stars at least this near are joined into constellations.
export const SKY_NEAR = 0.62
// A line fades out over this many px as either star nears an edge.
const EDGE = 40
// How many stars, and how bright, against the first sky: the owner asked for
// 115% so more of them show (2026-10-01).
const SKY_INTENSITY = 1.15

function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v }

/** Stars for a w×h sky: one per `area` px², within a floor and a ceiling. */
export function starCount(w: number, h: number, lowPower: boolean, area = 9000): number {
  return Math.round(clamp((w * h) / area, 50, 170) * SKY_INTENSITY * (lowPower ? 0.6 : 1))
}

/** Sorted nearest first, so the constellation pass walks only a prefix. */
export function makeStars(n: number, w: number, h: number): Star[] {
  return Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, z: 0.2 + 0.8 * Math.random() ** 1.6, ph: Math.random() * 6.28 }))
    .sort((a, b) => b.z - a.z)
}

export function driftStars(stars: Star[], w: number, h: number, dt: number) {
  for (const st of stars) {
    st.x -= DRIFT * st.z * dt
    st.y -= DRIFT * 0.2 * st.z * dt
    if (st.x < -8) { st.x += w + 16; st.y = Math.random() * h } else if (st.y < -8) st.y += h + 16
  }
}

// How visible the constellation line between two stars is. It fades with
// distance and near the canvas edges: a star that drifts off one edge
// reappears at the other, and a line still drawn to it would vanish or appear
// in one frame. At 14 px/s that was one pop every second or so, and it read as
// the page flickering (owner, 2026-09-30).
export function lineAlpha(a: Star, b: Star, reach: number, w: number, h: number): number {
  const d = Math.hypot(a.x - b.x, a.y - b.y)
  if (d > reach) return 0
  const edge = (s: Star) => clamp(Math.min(s.x, w - s.x, s.y, h - s.y) / EDGE, 0, 1)
  const f = 1 - d / reach
  return 0.2 * f * f * edge(a) * edge(b)
}

// The stars' slow twinkle is the one clock-driven brightness the owner keeps.
export function drawStars(ctx: CanvasRenderingContext2D, stars: Star[], time: number, reach: number, w: number, h: number, colors: SkyColors, alpha = 1) {
  ctx.strokeStyle = colors.line; ctx.lineWidth = 1
  for (let i = 0; i < stars.length && stars[i].z >= SKY_NEAR; i++) {
    const a = stars[i]
    for (let j = i + 1; j < stars.length && stars[j].z >= SKY_NEAR; j++) {
      const b = stars[j], line = lineAlpha(a, b, reach, w, h)
      if (line <= 0) continue
      ctx.globalAlpha = line * alpha
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    }
  }
  ctx.fillStyle = colors.star
  for (const st of stars) {
    ctx.globalAlpha = Math.min(1, (0.15 + 0.65 * st.z) * SKY_INTENSITY) * (0.8 + 0.2 * Math.sin(time * 0.0011 * (0.6 + st.z) + st.ph)) * alpha
    ctx.beginPath(); ctx.arc(st.x, st.y, 0.45 + 1.35 * st.z * st.z, 0, 6.2832); ctx.fill()
  }
  ctx.globalAlpha = 1
}
