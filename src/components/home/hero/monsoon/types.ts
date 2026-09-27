/**
 * The state the monsoon passes share. index.ts owns one SceneState and hands
 * it to every module each frame: match.ts and story.ts write it, the render
 * passes (glass, props, smoke) only read it.
 *
 * Units: world positions are metres (camera.ts has the frame), screen
 * positions are uv with (0,0) at the bottom-left, and times are seconds.
 */
export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

export type MatchPhase =
  | 'rest' // lying on the sill, ready to pick up
  | 'held' // following the pointer, unlit
  | 'lit' // burning (held or dropped)
  | 'out' // just went out: the head glows as an ember and smokes
  | 'falling' // released, dropping to the sill
  | 'spent' // burnt, lying on the sill
  | 'sliding' // a fresh match sliding out of the tray

export interface MatchPose {
  phase: MatchPhase
  /** Centre of the head. */
  head: Vec3
  /** Unit vector from the head toward the tail, along the stick. */
  dir: Vec3
  /** 0 fresh .. 1 charred to the tail: how far the char front has travelled. */
  burn: number
  /** Flame size: 0 none, 1 steady, up to ~1.5 in the ignition flare. */
  flame: number
  /** 0..1 glow of the head after the flame is gone. */
  ember: number
  /** Screen-space lean of the flame from the match's motion, -1..1 on each axis. */
  lean: Vec2
  /** Whether the head has ever burned: a struck head is black, not red. */
  struck: boolean
}

export interface FlameLight {
  /** World position of the visible flame's centre. */
  pos: Vec3
  /** 0..~1.5, already multiplied by the flicker. */
  intensity: number
  /** Which flame: its size and colour differ. */
  kind: 'match' | 'candle'
}

export interface Spark {
  pos: Vec3
  vel: Vec3
  /** 1 at birth, 0 when gone. */
  life: number
}

/** A puff or plume the smoke pass should add this frame. */
export interface SmokeSource {
  /** Screen uv. */
  u: number
  v: number
  /** Velocity in uv per second. */
  du: number
  dv: number
  /** Radius in v units (fractions of the screen height). */
  radius: number
  /** 0..1 amount of smoke added per second (per call for a puff). */
  density: number
  /** One-off burst (a blown-out flame) rather than a steady plume. */
  puff: boolean
}

export interface FogWipe {
  /** Screen uv of the dab. */
  u: number
  v: number
  /** Radius in v units. */
  r: number
  /** 0..1: 1 clears the glass completely at the centre. */
  strength: number
}

export interface SceneState {
  /** Seconds since create. Frozen under reduced motion. */
  t: number
  /** Seconds since the previous frame, clamped to 0.1. */
  dt: number
  /** Story time: minutes past midnight in India (IST), 0..1440, from story.ts. */
  minutes: number
  /** 0 deep night .. 1 full day, day.ts dayness(minutes). */
  dayness: number
  /** The hour's colour (day.ts hourColor), linear-ish 0..1 RGB, for grading. */
  hour: Vec3
  /** Smoothed pointer offset from the centre, -1..1, for parallax. Stays 0 on touch. */
  parallax: Vec2
  /** [0] is the active match; the rest are spent ones lying on the sill (at most 5). */
  matches: MatchPose[]
  candle: { lit: boolean; flame: number }
  /** Lit flames this frame, brightest first (at most 2). */
  flames: FlameLight[]
  /** Live sparks (at most 64). */
  sparks: Spark[]
  /** Smoke to add this frame; cleared by index.ts after the smoke pass runs. */
  smoke: SmokeSource[]
  /** Fog dabs this frame; cleared by index.ts after the glass pass runs. */
  wipes: FogWipe[]
  reduced: boolean
}

export function createSceneState(reduced: boolean): SceneState {
  return {
    t: 0,
    dt: 0,
    minutes: 1420,
    dayness: 0,
    hour: [0.23, 0.18, 0.56],
    parallax: [0, 0],
    matches: [],
    candle: { lit: false, flame: 0 },
    flames: [],
    sparks: [],
    smoke: [],
    wipes: [],
    reduced,
  }
}

/** A lane of flying traffic in the city plate: lights crossing at plate
 *  height `y` (uv, from the bottom) between `x0` and `x1`, at `speed` uv/s
 *  (negative is right to left), each light `size` uv tall. */
export interface TrafficLane {
  y: number
  x0: number
  x1: number
  speed: number
  size: number
}

/** What city.ts draws: the view out of the window, as canvases. */
export interface CityPlates {
  /** The city at night without its lights: sky, building masses, haze. */
  night: HTMLCanvasElement
  /** The same city on an overcast monsoon day, at half resolution. */
  day: HTMLCanvasElement
  /** Every steady light on black: windows, neon, billboards, street glow. */
  emit: HTMLCanvasElement
  /** Three flickering groups on black, one per channel (R, G, B), each
   *  monochrome; `groups` gives the colour each renders in. Half resolution. */
  flicker: HTMLCanvasElement
  groups: [Vec3, Vec3, Vec3]
  lanes: TrafficLane[]
  /** Width / height of the plates. */
  aspect: number
}

/** The plates once uploaded (index.ts does it once and shares them). */
export interface CityTextures {
  night: WebGLTexture
  day: WebGLTexture
  emit: WebGLTexture
  flicker: WebGLTexture
  groups: [Vec3, Vec3, Vec3]
  lanes: TrafficLane[]
  aspect: number
}
