/**
 * The one camera the monsoon passes share, and where things sit on the sill.
 * props.ts renders with it, match.ts turns the pointer into a position with it,
 * and index.ts places the match's DOM handle with it, so all three agree on
 * where the matchbox is to the pixel.
 *
 * World frame, in metres: +x right, +y up, +z toward the viewer. The sill's
 * top surface is y = 0 and the window glass is the plane z = GLASS_Z behind
 * it. The camera sits in the dark room looking out.
 *
 * Two framings: `wide` (landscape) puts the objects in the right half and
 * leaves the left for the page text; `tall` (portrait) sets them along the
 * bottom under the text.
 */
import type { Vec3 } from './types'

export type LayoutMode = 'wide' | 'tall'

export const GLASS_Z = -0.02

/** Match dimensions: stick length, stick half-thickness, head radii along
 *  (across, along the stick, across). */
export const MATCH = { length: 0.045, half: 0.0011, head: [0.0023, 0.0034, 0.0023] as Vec3 }

export interface Placements {
  /** The matchbox: `center` of the sleeve, `yaw` about +y (radians), `size`
   *  the sleeve's full extents (x length, y height, z depth) before yaw, and
   *  how far the tray is pushed out along the sleeve's +x. */
  box: { center: Vec3; yaw: number; size: Vec3; trayOut: number }
  /** The striker on the sleeve's side facing the camera: centre, outward
   *  normal, unit direction along its length, and half extents. */
  striker: { center: Vec3; normal: Vec3; along: Vec3; halfLen: number; halfH: number }
  /** A pillar candle standing on the sill; `wickTop` is the tip of the wick. */
  candle: { base: Vec3; radius: number; height: number; wickTop: Vec3 }
  /** Where the active match lies before anyone picks it up. */
  matchRest: { head: Vec3; dir: Vec3 }
  /** Where a fresh match starts its slide out of the tray. */
  trayMouth: Vec3
  /** Resting spots on the sill for spent matches, oldest first. */
  spentSlots: Array<{ head: Vec3; dir: Vec3 }>
  /** A held match's head moves in this plane: parallel to the striker face,
   *  just in front of it, so a swipe across the strip touches it. */
  hold: { point: Vec3; normal: Vec3 }
}

export interface Camera {
  mode: LayoutMode
  aspect: number
  eye: Vec3
  target: Vec3
  /** Vertical field of view, radians. */
  fovY: number
  /** Column-major 4x4 matrices. */
  view: Float32Array
  proj: Float32Array
  viewProj: Float32Array
  placements: Placements
  /** World → [u, v, depth]: screen uv ((0,0) bottom-left) and the distance in
   *  front of the camera in metres (negative when behind it). */
  project(p: Vec3, out?: Vec3): Vec3
  /** Screen uv → a world ray from the eye (unit direction). */
  ray(u: number, v: number): { o: Vec3; d: Vec3 }
  /** Screen uv → the point on a plane, or null when the ray misses it. */
  onPlane(u: number, v: number, point: Vec3, normal: Vec3, out?: Vec3): Vec3 | null
}

interface Framing {
  eye: Vec3
  target: Vec3
  fovDeg: number
  box: { center: Vec3; yaw: number }
  candle: Vec3
  matchRest: { head: Vec3; dir: Vec3 }
  /** Spent-match resting spots: head position and the stick's yaw on the sill. */
  spent: Array<[number, number, number]>
}

// Tuned by projecting the key points (see the monsoon brief): in `wide` the
// candle stands at about 72% of the width and the box sits in front of it,
// and the glass meets the sill a quarter of the way up the screen.
const FRAMINGS: Record<LayoutMode, Framing> = {
  wide: {
    eye: [0, 0.115, 0.46],
    target: [0.02, 0.075, 0],
    fovDeg: 36,
    box: { center: [0.07, 0.007, 0.1], yaw: -0.28 },
    candle: [0.116, 0, 0.018],
    matchRest: { head: [0.038, 0.0023, 0.152], dir: [0.992, 0, 0.126] },
    // [x, z, yaw] — shifted +0.014 in x from the original tuning: the resting
    // match and the spent pile sat only 30-40px clear of the left-half text
    // boundary at common wide widths (see cam-probe.ts), tight enough to read
    // as "not clear" rather than "clear". Box and candle already had margin.
    spent: [[0.018, 0.168, 0.5], [0.050, 0.176, -0.3], [-0.002, 0.16, 0.9], [0.032, 0.188, -0.6], [-0.016, 0.178, 0.2]],
  },
  // tall: tilted up and brought in (was eye [0, 0.13, 0.5], target
  // [0, 0.07, 0], fov 52), which left the bottom quarter of a phone as empty
  // sill; the objects then shifted 6 mm right to keep the match off the edge.
  tall: {
    eye: [0, 0.12, 0.46],
    target: [0, 0.088, 0],
    fovDeg: 50,
    box: { center: [-0.022, 0.007, 0.12], yaw: -0.18 },
    candle: [0.045, 0, 0.03],
    matchRest: { head: [-0.039, 0.0023, 0.175], dir: [0.995, 0, 0.1] },
    spent: [[-0.024, 0.19, 0.5], [0.006, 0.2, -0.3], [-0.049, 0.195, 0.9], [0.018, 0.185, -0.6], [-0.014, 0.205, 0.2]],
  },
}

const BOX_SIZE: Vec3 = [0.052, 0.014, 0.036]
const CANDLE = { radius: 0.025, height: 0.075, wick: 0.009, pool: 0.004 }

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
/** Rotates a vector about +y. */
export function yawVec(v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]]
}

function mul4(a: Float32Array, b: Float32Array, out: Float32Array): Float32Array {
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let s = 0
      for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k]
      out[c * 4 + r] = s
    }
  }
  return out
}

export function placementsFor(mode: LayoutMode): Placements {
  const f = FRAMINGS[mode]
  const { center, yaw } = f.box
  const along = norm(yawVec([1, 0, 0], yaw))
  const normal = norm(yawVec([0, 0, 1], yaw))
  const strikerCenter: Vec3 = [
    center[0] + normal[0] * (BOX_SIZE[2] / 2),
    center[1],
    center[2] + normal[2] * (BOX_SIZE[2] / 2),
  ]
  const base = f.candle
  const wickTop: Vec3 = [base[0], CANDLE.height - CANDLE.pool + CANDLE.wick, base[2]]
  const trayOut = 0.016
  const trayEnd = BOX_SIZE[0] / 2 + trayOut
  const trayMouth: Vec3 = [center[0] + along[0] * trayEnd, 0.0023, center[2] + along[2] * trayEnd + 0.006]
  const rest = f.matchRest
  const spentSlots = f.spent.map(([x, z, angle]) => ({
    head: [x, 0.0023, z] as Vec3,
    dir: norm([Math.cos(angle), 0, Math.sin(angle)]),
  }))
  return {
    box: { center, yaw, size: BOX_SIZE, trayOut },
    striker: { center: strikerCenter, normal, along, halfLen: BOX_SIZE[0] / 2 - 0.002, halfH: BOX_SIZE[1] / 2 - 0.0015 },
    candle: { base, radius: CANDLE.radius, height: CANDLE.height, wickTop },
    matchRest: { head: rest.head, dir: norm(rest.dir) },
    trayMouth,
    spentSlots,
    hold: {
      point: [strikerCenter[0] + normal[0] * 0.003, strikerCenter[1], strikerCenter[2] + normal[2] * 0.003],
      normal,
    },
  }
}

export function layoutFor(width: number, height: number): LayoutMode {
  return width >= height * 0.9 ? 'wide' : 'tall'
}

export function makeCamera(width: number, height: number): Camera {
  const mode = layoutFor(width, height)
  const f = FRAMINGS[mode]
  const aspect = width / Math.max(1, height)
  const fovY = (f.fovDeg * Math.PI) / 180
  const eye = f.eye
  const target = f.target
  const fw = norm(sub(target, eye))
  const right = norm(cross(fw, [0, 1, 0]))
  const up = cross(right, fw)

  const view = new Float32Array([
    right[0], up[0], -fw[0], 0,
    right[1], up[1], -fw[1], 0,
    right[2], up[2], -fw[2], 0,
    -dot(right, eye), -dot(up, eye), dot(fw, eye), 1,
  ])
  const near = 0.01
  const far = 20
  const t = 1 / Math.tan(fovY / 2)
  const proj = new Float32Array([
    t / aspect, 0, 0, 0,
    0, t, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ])
  const viewProj = mul4(proj, view, new Float32Array(16))
  const tanY = Math.tan(fovY / 2)
  const tanX = tanY * aspect

  const camera: Camera = {
    mode,
    aspect,
    eye,
    target,
    fovY,
    view,
    proj,
    viewProj,
    placements: placementsFor(mode),
    project(p, out = [0, 0, 0]) {
      const m = viewProj
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]
      const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
      const iw = Math.abs(w) > 1e-6 ? 1 / w : 0
      out[0] = x * iw * 0.5 + 0.5
      out[1] = y * iw * 0.5 + 0.5
      out[2] = w
      return out
    },
    ray(u, v) {
      const x = (u * 2 - 1) * tanX
      const y = (v * 2 - 1) * tanY
      const d = norm([
        right[0] * x + up[0] * y + fw[0],
        right[1] * x + up[1] * y + fw[1],
        right[2] * x + up[2] * y + fw[2],
      ])
      return { o: eye, d }
    },
    onPlane(u, v, point, normal, out = [0, 0, 0]) {
      const { o, d } = camera.ray(u, v)
      const denom = dot(d, normal)
      if (Math.abs(denom) < 1e-6) return null
      const s = dot(sub(point, o), normal) / denom
      if (s <= 0) return null
      out[0] = o[0] + d[0] * s
      out[1] = o[1] + d[1] * s
      out[2] = o[2] + d[2] * s
      return out
    },
  }
  return camera
}
