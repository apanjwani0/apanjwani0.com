/**
 * The match and candle simulation: pure TypeScript, no DOM, no GL. Owns
 * state.matches, state.candle, state.flames, state.sparks and pushes plumes
 * onto state.smoke. See camera.ts for the world frame and Placements.
 *
 * Pooling: six MatchPose objects live for the sim's whole life in a ring
 * buffer (`pool`), so "a match is spent" is just advancing a pointer — the
 * object six matches ago is exactly the one that gets recycled as the next
 * fresh match, which is also "at most 5 spent, oldest removed" for free.
 * Sparks are a second fixed pool (64) with swap-remove. Nothing is allocated
 * inside update() once running: scratch Vec3/Vec2 are module-level and
 * reused, and the returned event list is one reused array.
 */
import type { Camera } from './camera'
import type { FlameLight, MatchPose, SceneState, SmokeSource, Spark, Vec2, Vec3 } from './types'

export interface MatchInput {
  x: number
  y: number
  down: boolean
  touch: boolean
  present: boolean
}

export type MatchEvent =
  | 'grab' | 'fizzle' | 'lit' | 'out' | 'burnt'
  | 'candle-lit' | 'candle-out' | 'landed' | 'fresh'

export interface MatchSim {
  update(state: SceneState, cam: Camera, input: MatchInput, cssW: number, cssH: number): readonly MatchEvent[]
  hitTest(state: SceneState, cam: Camera, x: number, y: number, cssW: number, cssH: number, touch: boolean): 'match' | 'candle' | null
  act(action: 'strike' | 'candle' | 'blow'): void
  handleRect(state: SceneState, cam: Camera, cssW: number, cssH: number): { x: number; y: number; w: number; h: number }
  reset(state: SceneState, cam: Camera): void
}

// ── Numbers, straight from the brief ────────────────────────────────────────
const GRAB_R = 22, GRAB_R_TOUCH = 34 // CSS px
const CANDLE_DEPTH_PX = 90
const HEAD_OMEGA = 26 // critically damped (zeta = 1)
const SWING_OMEGA = 14, SWING_ZETA = 0.35, SWING_GAIN = -0.9, SWING_MAX = 0.6
const SILL_Y = 0.0035
const STRIKE_FRONT_MAX = 0.006 // 6 mm in front of the striker face
const STRIKE_SPEED_MIN = 0.22 // m/s
const HEAT_GAIN = 9, HEAT_DECAY = 0.5
const SPARK_RATE = 90 // sparks/s per m/s of speed, while striking
const SPARK_BACK = -0.3
const SPARK_SPREAD_MIN = 0.3, SPARK_SPREAD_MAX = 0.6 // added to the upward-biased base
const SPARK_GRAVITY = -3.4
const SPARK_LIFE_MIN = 0.25, SPARK_LIFE_MAX = 0.55
const IGNITE_HEAT = 0.18, IGNITE_PROB = 0.78
const IGNITE_FLARE = 1.45, IGNITE_BURST = 18
const IGNITE_PUFF = { density: 0.25, r: 0.012 }
const FIZZLE_SPARKS = 10
const FIZZLE_PUFF = { density: 0.3, r: 0.01 }
const FLAME_RELAX = 3 // /s, flare -> 1.0
const BURN_RATE = 1 / 22 // /s
const BURN_SHRINK_AT = 0.8, BURN_OUT_AT = 0.92
// Screen heights per second of the flame on screen, not metres per second:
// the first rule (2.0 m/s) was out of reach, since a held head lags the
// pointer on its spring and a phone screen spans far fewer metres than a
// laptop's. A drag to the candle runs about 1; a hard flick 2.3 to 4.7.
const BLOWOUT_SPEED = 2.0, BLOWOUT_HOLD = 0.05
const BLOWOUT_PUFF = { density: 0.9, r: 0.03 }
const LEAN_SCALE = 0.5
const PLUME_MATCH = { density: 1.0, r: 0.01, rise: 0.22 }
const EMBER_DECAY = 1 / 2.5
const FALL_GRAVITY = -6
const LANDING_Y = 0.0023
const SPENT_MAX = 5
const POOL_SIZE = SPENT_MAX + 1
const SPENT_WAIT = 0.8, SLIDE_DUR = 0.6
const CANDLE_LIGHT_DIST = 0.012, CANDLE_LIGHT_HOLD = 0.35
const CANDLE_RISE = 1.2
const CANDLE_PLUME = { density: 0.5, r: 0.006, rise: 0.2 }
const SNUFF_SPEED = 900 // CSS px/s
const SNUFF_PUFF = { density: 1.4, r: 0.04 }
const SCRIPT_SWIPE_SPEED = 0.8, SCRIPT_SWIPE_DUR = 0.3
const HOVER_ABOVE_BOX = 0.05
const SPARK_POOL = 64
const SMOKE_POOL = 4

// ── Small allocation-free helpers ───────────────────────────────────────────
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v }
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a || 1), 0, 1)
  return t * t * (3 - 2 * t)
}
/** A cheap organic flicker in ~[0,1]: three incommensurate sine waves. */
function flickerNoise(t: number): number {
  const v = Math.sin(t) + 0.6 * Math.sin(t * 2.13 + 1.3) + 0.35 * Math.sin(t * 4.7 + 2.9)
  return clamp(v / 1.95 * 0.5 + 0.5, 0, 1)
}
/** One damped-spring step on a Vec3 position, mutating `pos` and `vel` in place.
 *  Substepped at 120 Hz: explicit Euler diverges once omega * h passes 2, and
 *  a 0.1 s frame (a stall, or reduced motion's on-demand frames) at omega 26
 *  flung the held match through the window. */
function springVec3(pos: Vec3, vel: Vec3, target: Vec3, omega: number, zeta: number, dt: number): void {
  const steps = Math.max(1, Math.ceil(dt * 120))
  const h = dt / steps
  for (let s = 0; s < steps; s += 1) {
    for (let i = 0; i < 3; i += 1) {
      const a = omega * omega * (target[i] - pos[i]) - 2 * zeta * omega * vel[i]
      vel[i] += a * h
      pos[i] += vel[i] * h
    }
  }
}
function freshPose(): MatchPose {
  return { phase: 'rest', head: [0, 0, 0], dir: [1, 0, 0], burn: 0, flame: 0, ember: 0, lean: [0, 0], struck: false }
}
function freshSpark(): Spark { return { pos: [0, 0, 0], vel: [0, 0, 0], life: 0 } }

const DIR_BASE: Vec3 = (() => {
  const l = Math.hypot(0.78, -0.42, 0.46)
  return [0.78 / l, -0.42 / l, 0.46 / l]
})()

export function createMatchSim(opts: { reduced: boolean; random?: () => number }): MatchSim {
  const random = opts.random ?? Math.random
  const reduced = opts.reduced

  // Ring buffer: pool[headIdx] is the active pose; the POOL_SIZE-1 before it
  // (by ring distance) are the spent ones currently shown.
  const pool: MatchPose[] = []
  for (let i = 0; i < POOL_SIZE; i += 1) pool.push(freshPose())
  let headIdx = 0
  let lived = 1

  const sparkPool: Spark[] = []
  for (let i = 0; i < SPARK_POOL; i += 1) sparkPool.push(freshSpark())
  const sparkLife = new Float32Array(SPARK_POOL)
  let sparkCount = 0

  const smokePool: SmokeSource[] = []
  for (let i = 0; i < SMOKE_POOL; i += 1) smokePool.push({ u: 0, v: 0, du: 0, dv: 0, radius: 0, density: 0, puff: false })
  let smokeCursor = 0

  const matchFlame: FlameLight = { pos: [0, 0, 0], intensity: 0, kind: 'match' }
  const candleFlame: FlameLight = { pos: [0, 0, 0], intensity: 0, kind: 'candle' }
  let matchFlameOn = false
  let candleFlameOn = false

  const eventsBuf: MatchEvent[] = []

  // Scratch, reused every call — never replaced.
  const scratchA: Vec3 = [0, 0, 0]
  const scratchB: Vec3 = [0, 0, 0]
  const targetPt: Vec3 = [0, 0, 0]
  const projScratch: Vec3 = [0, 0, 0]
  const scratchUV: Vec2 = [0, 0]

  const vel: Vec3 = [0, 0, 0]
  let swingAngle = 0
  let swingVel = 0
  let heat = 0
  let rolled = false
  const prevUV: Vec2 = [0, 0]
  let haveUV = false
  const prevPointer: Vec2 = [0, 0]
  let havePrevPointer = false
  let wickNearT = 0
  let bounced = false
  let fallState: 'air' | 'settled' = 'air'
  let fallingLit = false
  let spentWaitT = -1
  let slideT = 1
  let overSpeedT = 0
  let wasDown = false
  let hovering = false
  let initialized = false

  // Cached per-camera geometry, refreshed by measureGeometry() on reset().
  let alongX = 1, alongZ = 0, normalX = 0, normalZ = 1
  let boxCenterX = 0, boxCenterY = 0, boxCenterZ = 0, boxHx = 0, boxHy = 0, boxHz = 0
  let candleBaseX = 0, candleBaseZ = 0, candleR = 0, candleH = 0
  let hoverX = 0, hoverY = 0, hoverZ = 0
  let fwX = 0, fwY = 0, fwZ = -1
  let minX = -1, maxX = 1, minZ = -1, maxZ = 1

  type ScriptAction = 'strike' | 'candle' | 'blow'
  let queued: ScriptAction | null = null
  type ScriptPhase = 'none' | 'toStrike' | 'swiping' | 'toWick' | 'toHover'
  let script: ScriptPhase = 'none'
  /** True while the scripted swipe tests contact: a scripted strike never fizzles. */
  let scripted = false
  let scriptT = 0

  function activePose(): MatchPose { return pool[headIdx] }

  function toCss(p: Vec3, cam: Camera, cssW: number, cssH: number, out: Vec2): void {
    cam.project(p, projScratch)
    out[0] = projScratch[0] * cssW
    out[1] = (1 - projScratch[1]) * cssH
  }

  function pushSmoke(state: SceneState, u: number, v: number, du: number, dv: number, radius: number, density: number, puff: boolean): void {
    const s = smokePool[smokeCursor]
    smokeCursor = (smokeCursor + 1) % SMOKE_POOL
    s.u = u; s.v = v; s.du = du; s.dv = dv; s.radius = radius; s.density = density; s.puff = puff
    state.smoke.push(s)
  }

  function emitPuffAtWorld(state: SceneState, cam: Camera, p: Vec3, density: number, r: number): void {
    cam.project(p, projScratch)
    pushSmoke(state, projScratch[0], projScratch[1], 0, 0.05, r, density, true)
  }

  function measureGeometry(cam: Camera): void {
    const p = cam.placements
    boxCenterX = p.box.center[0]; boxCenterY = p.box.center[1]; boxCenterZ = p.box.center[2]
    boxHx = p.box.size[0] / 2; boxHy = p.box.size[1] / 2; boxHz = p.box.size[2] / 2
    alongX = p.striker.along[0]; alongZ = p.striker.along[2]
    normalX = p.striker.normal[0]; normalZ = p.striker.normal[2]
    candleBaseX = p.candle.base[0]; candleBaseZ = p.candle.base[2]
    candleR = p.candle.radius; candleH = p.candle.height
    hoverX = p.box.center[0]; hoverY = p.box.center[1] + boxHy + HOVER_ABOVE_BOX; hoverZ = p.box.center[2]
    const fx = cam.target[0] - cam.eye[0], fy = cam.target[1] - cam.eye[1], fz = cam.target[2] - cam.eye[2]
    const fl = Math.hypot(fx, fy, fz) || 1
    fwX = fx / fl; fwY = fy / fl; fwZ = fz / fl

    minX = p.matchRest.head[0]; maxX = minX; minZ = p.matchRest.head[2]; maxZ = minZ
    for (const slot of p.spentSlots) {
      if (slot.head[0] < minX) minX = slot.head[0]
      if (slot.head[0] > maxX) maxX = slot.head[0]
      if (slot.head[2] < minZ) minZ = slot.head[2]
      if (slot.head[2] > maxZ) maxZ = slot.head[2]
    }
    minX -= 0.006; maxX += 0.006; minZ -= 0.006; maxZ += 0.006
  }

  function placeAtRest(pose: MatchPose, cam: Camera): void {
    const r = cam.placements.matchRest
    pose.phase = 'rest'
    pose.head[0] = r.head[0]; pose.head[1] = r.head[1]; pose.head[2] = r.head[2]
    pose.dir[0] = r.dir[0]; pose.dir[1] = r.dir[1]; pose.dir[2] = r.dir[2]
    pose.burn = 0; pose.flame = 0; pose.ember = 0
    pose.lean[0] = 0; pose.lean[1] = 0
    pose.struck = false
  }

  function placeAtTray(pose: MatchPose, cam: Camera): void {
    const t = cam.placements.trayMouth
    const r = cam.placements.matchRest
    pose.phase = 'rest'
    pose.head[0] = t[0]; pose.head[1] = t[1]; pose.head[2] = t[2]
    pose.dir[0] = r.dir[0]; pose.dir[1] = r.dir[1]; pose.dir[2] = r.dir[2]
    pose.burn = 0; pose.flame = 0; pose.ember = 0
    pose.lean[0] = 0; pose.lean[1] = 0
    pose.struck = false
  }

  function resetDynamics(): void {
    vel[0] = 0; vel[1] = 0; vel[2] = 0
    swingAngle = 0; swingVel = 0
    heat = 0; rolled = false
    haveUV = false; havePrevPointer = false
    bounced = false; fallState = 'air'; fallingLit = false
    wickNearT = 0; overSpeedT = 0
    wasDown = false; hovering = false
    script = 'none'; scriptT = 0; queued = null
  }

  function doReset(state: SceneState, cam: Camera): void {
    headIdx = 0; lived = 1
    measureGeometry(cam)
    for (const p of pool) placeAtRest(p, cam)
    placeAtRest(pool[0], cam)
    state.matches[0] = pool[0]
    state.matches.length = 1
    resetDynamics()
    state.candle.lit = false
    state.candle.flame = 0
    state.flames.length = 0
    state.sparks.length = 0
    sparkCount = 0
    spentWaitT = -1
    slideT = 1
  }

  function spawnSpark(px: number, py: number, pz: number, vx: number, vy: number, vz: number): void {
    if (sparkCount >= SPARK_POOL) return
    const s = sparkPool[sparkCount]
    s.pos[0] = px; s.pos[1] = py; s.pos[2] = pz
    s.vel[0] = vx; s.vel[1] = vy; s.vel[2] = vz
    s.life = 1
    sparkLife[sparkCount] = SPARK_LIFE_MIN + random() * (SPARK_LIFE_MAX - SPARK_LIFE_MIN)
    sparkCount += 1
  }

  function spawnStrikeSparks(pose: MatchPose, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const speed = SPARK_SPREAD_MIN + random() * SPARK_SPREAD_MAX
      const dx = (random() - 0.5) * 0.8
      const dz = (random() - 0.5) * 0.8
      const dy = 0.5 + random() * 0.5
      const invLen = speed / (Math.hypot(dx, dy, dz) || 1)
      spawnSpark(
        pose.head[0], pose.head[1], pose.head[2],
        vel[0] * SPARK_BACK + dx * invLen,
        vel[1] * SPARK_BACK + dy * invLen,
        vel[2] * SPARK_BACK + dz * invLen,
      )
    }
  }

  function stepSparks(state: SceneState, dt: number): void {
    for (let i = 0; i < sparkCount;) {
      const s = sparkPool[i]
      s.vel[1] += SPARK_GRAVITY * dt
      s.pos[0] += s.vel[0] * dt
      s.pos[1] += s.vel[1] * dt
      s.pos[2] += s.vel[2] * dt
      s.life -= dt / sparkLife[i]
      if (s.life <= 0) {
        const last = sparkCount - 1
        const tp = sparkPool[i]; sparkPool[i] = sparkPool[last]; sparkPool[last] = tp
        const tl = sparkLife[i]; sparkLife[i] = sparkLife[last]; sparkLife[last] = tl
        sparkCount -= 1
      } else {
        i += 1
      }
    }
    state.sparks.length = sparkCount
    for (let i = 0; i < sparkCount; i += 1) state.sparks[i] = sparkPool[i]
  }

  /** Keeps the head above the sill, out of the box (front-face push-out only —
   *  the interaction surface) and out of the candle's body. */
  function applyCollisions(head: Vec3): void {
    if (head[1] < SILL_Y) head[1] = SILL_Y
    const dx = head[0] - boxCenterX, dz = head[2] - boxCenterZ
    const lx = dx * alongX + dz * alongZ
    const lz = dx * normalX + dz * normalZ
    const ly = head[1] - boxCenterY
    if (Math.abs(lx) < boxHx && ly > -boxHy && ly < boxHy && lz > -boxHz && lz < boxHz) {
      const pushedLz = boxHz + 0.001
      head[0] = boxCenterX + lx * alongX + pushedLz * normalX
      head[2] = boxCenterZ + lx * alongZ + pushedLz * normalZ
    }
    const cx = head[0] - candleBaseX, cz = head[2] - candleBaseZ
    const r = Math.hypot(cx, cz)
    const safeR = candleR + 0.003
    if (head[1] < candleH && r < safeR) {
      const k = safeR / (r || 1e-4)
      head[0] = candleBaseX + cx * k
      head[2] = candleBaseZ + cz * k
    }
  }

  /** Rotates DIR_BASE by swingAngle about the camera's forward axis (Rodrigues),
   *  writing into `dir` in place — the stick's "weight". */
  function applySwingToDir(dir: Vec3): void {
    const c = Math.cos(swingAngle), s = Math.sin(swingAngle)
    const kdotv = fwX * DIR_BASE[0] + fwY * DIR_BASE[1] + fwZ * DIR_BASE[2]
    const kxvx = fwY * DIR_BASE[2] - fwZ * DIR_BASE[1]
    const kxvy = fwZ * DIR_BASE[0] - fwX * DIR_BASE[2]
    const kxvz = fwX * DIR_BASE[1] - fwY * DIR_BASE[0]
    dir[0] = DIR_BASE[0] * c + kxvx * s + fwX * kdotv * (1 - c)
    dir[1] = DIR_BASE[1] * c + kxvy * s + fwY * kdotv * (1 - c)
    dir[2] = DIR_BASE[2] * c + kxvz * s + fwZ * kdotv * (1 - c)
  }

  function doIgnite(state: SceneState, cam: Camera, pose: MatchPose): void {
    pose.phase = 'lit'
    pose.struck = true
    pose.flame = IGNITE_FLARE
    heat = 0; rolled = false
    spawnStrikeSparks(pose, IGNITE_BURST)
    emitPuffAtWorld(state, cam, pose.head, IGNITE_PUFF.density, IGNITE_PUFF.r)
    eventsBuf.push('lit')
  }

  function doFizzle(state: SceneState, cam: Camera, pose: MatchPose): void {
    heat = 0; rolled = false
    spawnStrikeSparks(pose, FIZZLE_SPARKS)
    emitPuffAtWorld(state, cam, pose.head, FIZZLE_PUFF.density, FIZZLE_PUFF.r)
    eventsBuf.push('fizzle')
  }

  /** Contact + heat + sparks + the ignition roll, shared by the pointer-driven
   *  strike and the scripted one. No-op once lit. */
  function stepStrikeContact(state: SceneState, cam: Camera, pose: MatchPose): void {
    if (pose.phase === 'lit') return
    const dt = state.dt
    const dx = pose.head[0] - boxCenterX, dz = pose.head[2] - boxCenterZ
    const lx = dx * alongX + dz * alongZ
    // Depth in front of the striker FACE, not the box centre: measured from
    // the centre, contact needed the head inside the box, which the collision
    // push-out forbids, so no drag across the strip could ever light it.
    const lz = dx * normalX + dz * normalZ - boxHz
    const ly = pose.head[1] - boxCenterY
    const st = cam.placements.striker
    const contact = Math.abs(lx) < st.halfLen && Math.abs(ly) < st.halfH && lz >= 0 && lz <= STRIKE_FRONT_MAX
    const along = vel[0] * alongX + vel[2] * alongZ
    const speed = Math.abs(along)
    if (contact && speed > STRIKE_SPEED_MIN) {
      heat += speed * dt * HEAT_GAIN
      const n = Math.floor(SPARK_RATE * speed * dt + random())
      if (n > 0) spawnStrikeSparks(pose, n)
    } else {
      heat = Math.max(0, heat - HEAT_DECAY * dt)
    }
    if (heat >= IGNITE_HEAT) {
      if (!rolled) {
        rolled = true
        if (scripted || random() < IGNITE_PROB) doIgnite(state, cam, pose)
        else doFizzle(state, cam, pose)
      }
    } else {
      rolled = false
    }
  }

  /** Blends the pointer's hold-plane target toward the wick's depth as the
   *  pointer nears it on screen, so a lit flame can really reach the wick. */
  function computeHeldTarget(cam: Camera, u: number, v: number, cssX: number, cssY: number, cssW: number, cssH: number, out: Vec3): void {
    const hold = cam.placements.hold
    const p1 = cam.onPlane(u, v, hold.point, hold.normal, scratchA)
    out[0] = p1 ? p1[0] : hold.point[0]
    out[1] = p1 ? p1[1] : hold.point[1]
    out[2] = p1 ? p1[2] : hold.point[2]
    const wick = cam.placements.candle.wickTop
    cam.project(wick, projScratch)
    const wickCssX = projScratch[0] * cssW, wickCssY = (1 - projScratch[1]) * cssH
    const distPx = Math.hypot(cssX - wickCssX, cssY - wickCssY)
    if (distPx >= CANDLE_DEPTH_PX) return
    // Full depth within 25 px of the wick: a linear ramp only reached it at
    // 0 px, so a flame held a hair off the wick stopped centimetres short.
    const k = 1 - smoothstep(25, CANDLE_DEPTH_PX, distPx)
    const p2 = cam.onPlane(u, v, wick, hold.normal, scratchB)
    if (!p2) return
    out[0] += (p2[0] - out[0]) * k
    out[1] += (p2[1] - out[1]) * k
    out[2] += (p2[2] - out[2]) * k
  }

  /** The active pose becomes spent (snapped into its recency slot, along with
   *  every other currently-spent pose reshuffling by one), and the pool
   *  object six matches ago becomes the new fresh active one, waiting in the
   *  tray for SPENT_WAIT before it slides out. */
  function spendActiveAndAdvance(state: SceneState, cam: Camera): void {
    headIdx = (headIdx + 1) % POOL_SIZE
    lived = Math.min(lived + 1, POOL_SIZE)
    const n = Math.min(lived, POOL_SIZE)
    const slots = cam.placements.spentSlots
    for (let i = 1; i < n; i += 1) {
      const p = pool[(headIdx - i + POOL_SIZE * 2) % POOL_SIZE]
      const slot = slots[(i - 1) % slots.length]
      p.phase = 'spent'
      p.head[0] = slot.head[0]; p.head[1] = slot.head[1]; p.head[2] = slot.head[2]
      p.dir[0] = slot.dir[0]; p.dir[1] = slot.dir[1]; p.dir[2] = slot.dir[2]
      p.burn = 1; p.flame = 0; p.ember = 0; p.lean[0] = 0; p.lean[1] = 0; p.struck = true
      state.matches[i] = p
    }
    placeAtTray(pool[headIdx], cam)
    state.matches[0] = pool[headIdx]
    state.matches.length = n
    resetDynamics()
    spentWaitT = SPENT_WAIT
  }

  function startFalling(pose: MatchPose, lit: boolean): void {
    pose.phase = 'falling'
    fallingLit = lit
    fallState = 'air'
    bounced = false
    pose.flame = lit ? 0.7 : 0
  }

  /** The candle: lighting-by-proximity, the flicker, its own plume, and the
   *  fast-crossing snuff. Runs every frame regardless of what the match is
   *  doing, so the candle keeps burning while the hand is empty. */
  function stepCandleAndSnuff(state: SceneState, cam: Camera, input: MatchInput, cssW: number, cssH: number): void {
    const pose = activePose()
    const candle = state.candle
    const dt = state.dt
    const wick = cam.placements.candle.wickTop

    if (pose.phase === 'lit' && !candle.lit) {
      const d = Math.hypot(pose.head[0] - wick[0], pose.head[1] - wick[1], pose.head[2] - wick[2])
      if (d <= CANDLE_LIGHT_DIST) {
        wickNearT += dt
        if (wickNearT >= CANDLE_LIGHT_HOLD) { candle.lit = true; eventsBuf.push('candle-lit') }
      } else {
        wickNearT = 0
      }
    } else if (!candle.lit) {
      wickNearT = 0
    }
    if (candle.lit) candle.flame = Math.min(1, candle.flame + dt / CANDLE_RISE)

    if (input.present) {
      if (candle.lit && !input.down && havePrevPointer) {
        toCss(wick, cam, cssW, cssH, scratchUV)
        const dtp = Math.max(1 / 240, dt)
        const speed = Math.hypot(input.x - prevPointer[0], input.y - prevPointer[1]) / dtp
        const nearNow = Math.hypot(input.x - scratchUV[0], input.y - scratchUV[1]) < 40
        const nearPrev = Math.hypot(prevPointer[0] - scratchUV[0], prevPointer[1] - scratchUV[1]) < 40
        if (speed > SNUFF_SPEED && (nearNow || nearPrev)) {
          candle.lit = false; candle.flame = 0
          emitPuffAtWorld(state, cam, wick, SNUFF_PUFF.density, SNUFF_PUFF.r)
          eventsBuf.push('candle-out')
        }
      }
      prevPointer[0] = input.x; prevPointer[1] = input.y; havePrevPointer = true
    } else {
      havePrevPointer = false
    }

    if (candle.lit) {
      const flick = reduced ? 1 : 0.9 + 0.1 * flickerNoise(state.t * 6)
      candleFlame.pos[0] = wick[0]; candleFlame.pos[1] = wick[1] + 0.011; candleFlame.pos[2] = wick[2]
      candleFlame.intensity = candle.flame * flick
      candleFlameOn = true
      cam.project(candleFlame.pos, projScratch)
      pushSmoke(state, projScratch[0], projScratch[1], 0, CANDLE_PLUME.rise, CANDLE_PLUME.r, CANDLE_PLUME.density, false)
    }
  }

  function runScript(state: SceneState, cam: Camera): void {
    const pose = activePose()
    const dt = state.dt
    const p = cam.placements
    if (script === 'toStrike') {
      targetPt[0] = p.striker.center[0] - alongX * p.striker.halfLen * 0.8
      targetPt[1] = p.striker.center[1]
      targetPt[2] = p.striker.center[2] - alongZ * p.striker.halfLen * 0.8 + normalZ * 0.001
      if (pose.phase === 'rest') pose.phase = 'held'
      springVec3(pose.head, vel, targetPt, HEAD_OMEGA, 1, dt)
      applyCollisions(pose.head)
      if (Math.hypot(pose.head[0] - targetPt[0], pose.head[1] - targetPt[1], pose.head[2] - targetPt[2]) < 0.004) {
        script = 'swiping'; scriptT = 0
      }
      return
    }
    if (script === 'swiping') {
      // At most a 60 Hz step per frame: a 0.1 s frame would otherwise carry
      // the head 8 cm, clean over the 5 cm strip, and light it in mid-air.
      const step = Math.min(dt, 1 / 60)
      scriptT += step
      vel[0] = alongX * SCRIPT_SWIPE_SPEED; vel[1] = 0; vel[2] = alongZ * SCRIPT_SWIPE_SPEED
      pose.head[0] += vel[0] * step; pose.head[1] += vel[1] * step; pose.head[2] += vel[2] * step
      applyCollisions(pose.head)
      // A scripted strike always catches, and by the strip's far end at the
      // latest: 0.3 s at 0.8 m/s is 24 cm, and the strip is 5.
      scripted = true
      stepStrikeContact(state, cam, pose)
      scripted = false
      const sc = p.striker.center
      const past = (pose.head[0] - sc[0]) * alongX + (pose.head[2] - sc[2]) * alongZ >= p.striker.halfLen * 0.8
      if (pose.phase !== 'lit' && (past || scriptT >= SCRIPT_SWIPE_DUR)) doIgnite(state, cam, pose)
      if (pose.phase === 'lit') script = 'toHover'
      return
    }
    if (script === 'toWick') {
      const wick = p.candle.wickTop
      targetPt[0] = wick[0]; targetPt[1] = wick[1]; targetPt[2] = wick[2]
      springVec3(pose.head, vel, targetPt, HEAD_OMEGA, 1, dt)
      if (state.candle.lit) script = 'toHover'
      return
    }
    if (script === 'toHover') {
      targetPt[0] = hoverX; targetPt[1] = hoverY; targetPt[2] = hoverZ
      springVec3(pose.head, vel, targetPt, HEAD_OMEGA, 1, dt)
      if (Math.hypot(pose.head[0] - hoverX, pose.head[1] - hoverY, pose.head[2] - hoverZ) < 0.004) {
        script = 'none'; hovering = true
      }
    }
  }

  function stepActive(state: SceneState, cam: Camera, input: MatchInput, cssW: number, cssH: number): void {
    const pose = activePose()
    const dt = state.dt

    if (script !== 'none') { runScript(state, cam); return }

    if (pose.phase === 'rest' && spentWaitT >= 0) {
      spentWaitT -= dt
      if (spentWaitT <= 0) { pose.phase = 'sliding'; slideT = 0; spentWaitT = -1 }
      return
    }
    if (pose.phase === 'sliding') {
      slideT = Math.min(1, slideT + dt / SLIDE_DUR)
      const e = 1 - (1 - slideT) * (1 - slideT)
      const t = cam.placements.trayMouth
      const r = cam.placements.matchRest
      pose.head[0] = t[0] + (r.head[0] - t[0]) * e
      pose.head[1] = t[1] + (r.head[1] - t[1]) * e
      pose.head[2] = t[2] + (r.head[2] - t[2]) * e
      pose.dir[0] = r.dir[0]; pose.dir[1] = r.dir[1]; pose.dir[2] = r.dir[2]
      if (slideT >= 1) { pose.phase = 'rest'; eventsBuf.push('fresh') }
      return
    }
    if (pose.phase === 'falling') {
      if (fallState === 'air') {
        vel[1] += FALL_GRAVITY * dt
        pose.head[0] += vel[0] * dt
        pose.head[1] += vel[1] * dt
        pose.head[2] += vel[2] * dt
        if (pose.head[1] <= LANDING_Y) {
          pose.head[1] = LANDING_Y
          if (!bounced) {
            vel[1] = Math.abs(vel[1]) * 0.3
            bounced = true
          } else {
            pose.head[0] = clamp(pose.head[0], minX, maxX)
            pose.head[2] = clamp(pose.head[2], minZ, maxZ)
            pose.dir[1] = 0
            vel[0] = 0; vel[1] = 0; vel[2] = 0
            fallState = 'settled'
            eventsBuf.push('landed')
            if (!fallingLit) {
              if (pose.struck) { spendActiveAndAdvance(state, cam); return }
              pose.phase = 'rest'
              return
            }
          }
        }
      }
      if (fallingLit) {
        pose.flame = 0.7
        matchFlame.pos[0] = pose.head[0]; matchFlame.pos[1] = pose.head[1] + 0.008; matchFlame.pos[2] = pose.head[2]
        matchFlame.intensity = 0.7 * (reduced ? 1 : 0.85 + 0.15 * flickerNoise(state.t * 9))
        matchFlameOn = true
        cam.project(matchFlame.pos, projScratch)
        pushSmoke(state, projScratch[0], projScratch[1], 0, PLUME_MATCH.rise, PLUME_MATCH.r, PLUME_MATCH.density, false)
        pose.burn = Math.min(1, pose.burn + dt * BURN_RATE)
        if (pose.burn >= BURN_OUT_AT) {
          fallingLit = false
          pose.flame = 0
          eventsBuf.push('burnt')
          if (fallState === 'settled') spendActiveAndAdvance(state, cam)
        }
      } else if (fallState === 'settled') {
        if (pose.struck) spendActiveAndAdvance(state, cam)
        else pose.phase = 'rest'
      }
      return
    }

    // Grab / release edges. pose.phase is 'rest', 'held', 'lit' or 'out' here.
    if (input.down) {
      if (pose.phase === 'rest' && spentWaitT < 0) {
        pose.phase = 'held'
        vel[0] = 0; vel[1] = 0; vel[2] = 0
        swingAngle = 0; swingVel = 0
        heat = 0; rolled = false
        haveUV = false
        eventsBuf.push('grab')
      }
      hovering = false
      wasDown = true
    } else {
      if (wasDown && !hovering && pose.phase !== 'rest') {
        startFalling(pose, pose.phase === 'lit')
        wasDown = false
        return
      }
      wasDown = false
    }
    if (pose.phase === 'rest') return

    if (input.down) {
      const sampleY = input.touch ? input.y - 56 : input.y
      const u = input.x / cssW, v = 1 - sampleY / cssH
      computeHeldTarget(cam, u, v, input.x, sampleY, cssW, cssH, targetPt)
    } else {
      targetPt[0] = hoverX; targetPt[1] = hoverY; targetPt[2] = hoverZ
    }
    springVec3(pose.head, vel, targetPt, HEAD_OMEGA, 1, dt)
    applyCollisions(pose.head)

    const targetSwing = clamp(SWING_GAIN * vel[0], -SWING_MAX, SWING_MAX)
    const swingAccel = SWING_OMEGA * SWING_OMEGA * (targetSwing - swingAngle) - 2 * SWING_ZETA * SWING_OMEGA * swingVel
    swingVel += swingAccel * dt
    swingAngle += swingVel * dt
    applySwingToDir(pose.dir)

    cam.project(pose.head, projScratch)
    let svu = 0, svv = 0
    if (haveUV && dt > 0) { svu = (projScratch[0] - prevUV[0]) / dt; svv = (projScratch[1] - prevUV[1]) / dt }
    prevUV[0] = projScratch[0]; prevUV[1] = projScratch[1]; haveUV = true
    pose.lean[0] = clamp(-svu * LEAN_SCALE, -1, 1)
    pose.lean[1] = clamp(-svv * LEAN_SCALE, -1, 1)

    if (pose.phase === 'held') { stepStrikeContact(state, cam, pose); return }
    if (pose.phase === 'out') { pose.ember = Math.max(0, pose.ember - EMBER_DECAY * dt); return }

    // 'lit'
    const screenSpeed = Math.hypot(svu * cssW / cssH, svv)
    pose.flame += (1 - pose.flame) * Math.min(1, FLAME_RELAX * dt)
    pose.flame *= 1 - 0.5 * smoothstep(1, BLOWOUT_SPEED, screenSpeed)
    pose.burn = Math.min(1, pose.burn + dt * BURN_RATE)
    if (pose.burn >= BURN_SHRINK_AT) pose.flame *= 1 - smoothstep(BURN_SHRINK_AT, BURN_OUT_AT, pose.burn)
    if (pose.burn >= BURN_OUT_AT) {
      eventsBuf.push('burnt')
      startFalling(pose, false)
      return
    }
    // Not during the ignition flare, or the strike's own follow-through
    // would snuff the match the moment it caught.
    if (screenSpeed > BLOWOUT_SPEED && pose.flame < 1.15) {
      overSpeedT += dt
      if (overSpeedT >= BLOWOUT_HOLD) {
        pose.phase = 'out'; pose.flame = 0; pose.ember = 1
        emitPuffAtWorld(state, cam, pose.head, BLOWOUT_PUFF.density, BLOWOUT_PUFF.r)
        eventsBuf.push('out')
        return
      }
    } else {
      overSpeedT = 0
    }
    matchFlame.pos[0] = pose.head[0]; matchFlame.pos[1] = pose.head[1] + 0.008; matchFlame.pos[2] = pose.head[2]
    matchFlame.intensity = pose.flame * (reduced ? 1 : 0.85 + 0.15 * flickerNoise(state.t * 9))
    matchFlameOn = true
    // The plume leaves from the flame's tip, not the head under it.
    scratchA[0] = pose.head[0]; scratchA[1] = pose.head[1] + 0.016; scratchA[2] = pose.head[2]
    cam.project(scratchA, projScratch)
    pushSmoke(state, projScratch[0], projScratch[1], svu * 0.3, svv * 0.3 + PLUME_MATCH.rise, PLUME_MATCH.r, PLUME_MATCH.density, false)
  }

  function update(state: SceneState, cam: Camera, input: MatchInput, cssW: number, cssH: number): readonly MatchEvent[] {
    eventsBuf.length = 0
    if (!initialized) { doReset(state, cam); initialized = true }
    matchFlameOn = false
    candleFlameOn = false

    if (queued) {
      const action = queued
      queued = null
      const pose = activePose()
      if (action === 'blow') {
        if (pose.phase === 'lit') {
          pose.flame = 0; pose.ember = 1; pose.phase = 'out'
          emitPuffAtWorld(state, cam, pose.head, BLOWOUT_PUFF.density, BLOWOUT_PUFF.r)
          eventsBuf.push('out')
        } else if (state.candle.lit) {
          state.candle.lit = false; state.candle.flame = 0
          emitPuffAtWorld(state, cam, cam.placements.candle.wickTop, SNUFF_PUFF.density, SNUFF_PUFF.r)
          eventsBuf.push('candle-out')
        }
      } else if (action === 'strike') {
        if (!pose.struck && (pose.phase === 'rest' || pose.phase === 'held')) { script = 'toStrike'; scriptT = 0 }
      } else if (action === 'candle') {
        if (pose.phase === 'rest' || pose.phase === 'held' || pose.phase === 'lit') {
          if (pose.phase !== 'lit' && !pose.struck) doIgnite(state, cam, pose)
          if (pose.phase === 'lit') script = 'toWick'
        }
      }
    }

    stepActive(state, cam, input, cssW, cssH)
    stepCandleAndSnuff(state, cam, input, cssW, cssH)
    stepSparks(state, state.dt)

    state.flames.length = 0
    if (matchFlameOn && candleFlameOn) {
      if (matchFlame.intensity >= candleFlame.intensity) state.flames.push(matchFlame, candleFlame)
      else state.flames.push(candleFlame, matchFlame)
    } else if (matchFlameOn) {
      state.flames.push(matchFlame)
    } else if (candleFlameOn) {
      state.flames.push(candleFlame)
    }
    return eventsBuf
  }

  function hitTest(state: SceneState, cam: Camera, x: number, y: number, cssW: number, cssH: number, touch: boolean): 'match' | 'candle' | null {
    const pose = activePose()
    if (spentWaitT < 0 && (pose.phase === 'rest' || pose.phase === 'sliding')) {
      toCss(pose.head, cam, cssW, cssH, scratchUV)
      const r = touch ? GRAB_R_TOUCH : GRAB_R
      if (Math.hypot(x - scratchUV[0], y - scratchUV[1]) <= r) return 'match'
    }
    if (state.candle.lit) {
      toCss(cam.placements.candle.wickTop, cam, cssW, cssH, scratchUV)
      if (Math.hypot(x - scratchUV[0], y - scratchUV[1]) <= 28) return 'candle'
    }
    return null
  }

  function act(action: 'strike' | 'candle' | 'blow'): void {
    queued = action
  }

  function handleRect(state: SceneState, cam: Camera, cssW: number, cssH: number): { x: number; y: number; w: number; h: number } {
    void state
    toCss(activePose().head, cam, cssW, cssH, scratchUV)
    return { x: scratchUV[0] - 32, y: scratchUV[1] - 32, w: 64, h: 64 }
  }

  function reset(state: SceneState, cam: Camera): void {
    doReset(state, cam)
    initialized = true
  }

  return { update, hitTest, act, handleRect, reset }
}
