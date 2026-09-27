/**
 * Monsoon's smoke: a GPU fluid carrying the match's and the candle's plumes.
 * Ported from the stable-fluids solver in `../liquid.ts` (Hero Lab's
 * owner-approved liquid light) onto this folder's `gl.ts` kit, WebGL2 only.
 * The numerical approach is unchanged: advection with dissipation, curl +
 * vorticity confinement (where the curls come from), a divergence/pressure
 * Jacobi/gradient-subtract projection, and gaussian splats.
 *
 * What is different from liquid:
 * - One density channel (`r16f`), not RGB ink — glass.ts lights it.
 * - A buoyancy pass after vorticity confinement lifts the plume by itself:
 *   `vel.y += min(buoyAccel * density, buoyCap) * dt`, so even a source that
 *   never moves still drifts upward.
 * - Sources are `SmokeSource`s (types.ts), not pointer drags: a steady plume
 *   adds `density * dt` every frame it is fed, a puff adds `density` once
 *   plus a small vortex-pair "swirl" (two offset splats with opposite
 *   tangential velocity) so a blown-out flame rolls into a curl instead of
 *   just drifting off.
 * - Idle tracking: `active` goes false 12s after the last source, so
 *   index.ts can stop calling `step()` while nothing is smoking.
 *
 * Every velocity value below is stored in SIM-GRID TEXELS PER SECOND, exactly
 * as liquid's does: `velScale` = (simW+simH)/2 converts a uv/s quantity (a
 * source's du/dv, or a uv-space acceleration) up into that unit before it
 * touches the velocity texture. Converting back down happens nowhere — only
 * `advect` ever turns a velocity back into a uv displacement, and it does
 * that with the SIM grid's own texelSize regardless of which texture
 * (velocity or, at higher resolution, density) is being carried by it, since
 * uv space is shared by every texture whatever its resolution.
 */
import type { GLKit, DoubleTarget, Target, Program } from './gl'
import type { SmokeSource } from './types'

export interface Smoke {
  /** False once no source has arrived for 12 s: index.ts then skips step() and stops sampling. */
  readonly active: boolean
  /** Density in .r (linear-filterable, screen space, (0,0) bottom-left), at dye resolution. */
  readonly texture: WebGLTexture
  /** Advances the fluid by dt seconds after adding this frame's sources. Called only while
   *  active or when sources.length > 0. Allocates nothing. */
  step(dt: number, sources: SmokeSource[]): void
  /** Canvas drawing-buffer px (only the aspect and scale matter). Resamples the current smoke
   *  into the new grids, as liquid's carryOver does; never wipes it. */
  resize(w: number, h: number): void
  destroy(): void
}

// Baked-in tuning, in the spirit of liquid's TUNE object. `curl` is higher
// than liquid's 18: this sim's grid is smaller (128 short side vs ~200), so
// the central-difference curl is coarser to start with and needs a bit more
// confinement to keep fine detail. `densityDecay`/`velocityDecay` are
// exponential-decay rates (dissipation = exp(-rate*dt)): density loses 90%
// by ln(10)/0.32 ≈ 7.2s (inside the "6-9s" fade the brief asks for) while
// velocity, at roughly twice the rate, settles noticeably sooner — so a puff
// stops CARRYING itself well before its haze has faded, which is what makes
// the tail of a puff look like it drifts on ambient air rather than still
// being pushed by whatever threw it.
const TUNE = {
  simShort: 128,
  simShortLow: 96,
  dyeShort: 512,
  dyeShortLow: 384,
  pressureIters: 20,
  pressureItersLow: 14,
  pressureWarm: 0.78,
  curl: 24,
  densityDecay: 0.32,
  velocityDecay: 0.65,
  edgeFade: 3.0,
  // Buoyancy accel/cap in uv/s^2 (scaled up by velScale before use, same as
  // any other uv-space quantity here), per unit density. A rising plume's
  // column only holds ~0.05-0.1 density, so the accel has to be large for
  // thin smoke to lift at all: at 0.09 (the first tuning) the plume sat at
  // its source and faded there. The cap stops a dense snuff puff (up to 1.4)
  // turning into a jet.
  buoyAccel: 0.8,
  buoyCap: 0.6,
  // Reuses liquid's own pointer-drag scale (see splat() there): converts a
  // uv/s source velocity into sim-texel/s the same way a drag's uv/s speed
  // was converted before splatting.
  srcVelK: 0.6,
  // Puff-only vortex dipole: two extra splats, offset a fraction of the
  // puff's own radius, carrying opposite tangential velocity so the puff
  // rolls into a curl under its own steam rather than needing vorticity
  // confinement alone to invent one from nothing.
  swirlK: 1.0,
  swirlOffsetFrac: 0.55,
  swirlSigmaFrac: 0.35,
  idleTimeout: 12,
  maxSourcesPerFrame: 12,
} as const

// ---- Shaders: GLSL ES 3.00 bodies, no #version/precision (gl.ts's header
// supplies both) and no vertex shader (the default fullscreen triangle
// already gives every pass `in vec2 vUv`, (0,0) bottom-left). ----
const FRAG: Record<string, string> = {
  // Adds `amount` (a density delta in .x, or a velocity delta in .xy) as a
  // gaussian bump centred on `point`. `sigma2` is the SQUARE of the source's
  // radius — SmokeSource.radius is a literal length in v units, and the
  // gaussian's 1/e distance is sqrt(sigma2), so squaring here is what makes
  // radius mean what its doc comment says. `aspect` (simW/simH) widens the
  // footprint in x before the (now-circular, in screen terms) falloff, the
  // same correction liquid's splat applies.
  splat: `
uniform sampler2D uTarget;
uniform float aspect;
uniform vec2 point;
uniform vec3 amount;
uniform float sigma2;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 p = vUv - point;
  p.x *= aspect;
  float g = exp(-dot(p, p) / max(sigma2, 1e-8));
  vec3 base = texture(uTarget, vUv).xyz;
  outColor = vec4(base + amount * g, 1.0);
}`,
  // Shared for advecting velocity by itself and density by velocity, exactly
  // as liquid does (two calls, one program). `texelSize` is always the SIM
  // grid's, even when uSource is the (higher-res) density texture: velocity
  // is stored in sim-texel/s, so `dt*vel*texelSize` is a uv displacement
  // regardless of which texture gets sampled at the resulting uv.
  // `edgeFade` fades a source out near the screen edge (0 for velocity, a
  // small multiple of dt for density) — this is the open-boundary behaviour
  // the brief asks for: smoke thins out and leaves rather than piling up.
  advect: `
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
uniform float edgeFade;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 coord = vUv - dt * vel * texelSize;
  vec2 e = smoothstep(0.0, 0.07, vUv) * smoothstep(0.0, 0.07, 1.0 - vUv);
  float edge = exp(-edgeFade * (1.0 - e.x * e.y));
  outColor = dissipation * edge * texture(uSource, coord);
}`,
}

const FRAG_STEP: Record<string, string> = {
  curl: `
uniform sampler2D uVelocity;
uniform vec2 texelSize;
in vec2 vUv;
out vec4 outColor;
void main() {
  float L = texture(uVelocity, vUv - vec2(texelSize.x, 0.0)).y;
  float R = texture(uVelocity, vUv + vec2(texelSize.x, 0.0)).y;
  float B = texture(uVelocity, vUv - vec2(0.0, texelSize.y)).x;
  float T = texture(uVelocity, vUv + vec2(0.0, texelSize.y)).x;
  outColor = vec4(0.5 * ((R - L) - (T - B)), 0.0, 0.0, 1.0);
}`,
  vorticity: `
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform vec2 texelSize;
uniform float curlStrength;
uniform float dt;
in vec2 vUv;
out vec4 outColor;
void main() {
  float L = texture(uCurl, vUv - vec2(texelSize.x, 0.0)).x;
  float R = texture(uCurl, vUv + vec2(texelSize.x, 0.0)).x;
  float B = texture(uCurl, vUv - vec2(0.0, texelSize.y)).x;
  float T = texture(uCurl, vUv + vec2(0.0, texelSize.y)).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= (length(force) + 1e-4);
  force *= curlStrength * C;
  force.y *= -1.0;
  vec2 vel = texture(uVelocity, vUv).xy + force * dt;
  outColor = vec4(vel, 0.0, 1.0);
}`,
  divergence: `
uniform sampler2D uVelocity;
uniform vec2 texelSize;
in vec2 vUv;
out vec4 outColor;
void main() {
  float L = texture(uVelocity, vUv - vec2(texelSize.x, 0.0)).x;
  float R = texture(uVelocity, vUv + vec2(texelSize.x, 0.0)).x;
  float B = texture(uVelocity, vUv - vec2(0.0, texelSize.y)).y;
  float T = texture(uVelocity, vUv + vec2(0.0, texelSize.y)).y;
  outColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`,
  // One Jacobi iteration toward div(grad(pressure)) = divergence.
  pressure: `
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 texelSize;
in vec2 vUv;
out vec4 outColor;
void main() {
  float L = texture(uPressure, vUv - vec2(texelSize.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(texelSize.x, 0.0)).x;
  float B = texture(uPressure, vUv - vec2(0.0, texelSize.y)).x;
  float T = texture(uPressure, vUv + vec2(0.0, texelSize.y)).x;
  float div = texture(uDivergence, vUv).x;
  outColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}`,
  gradient: `
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 texelSize;
in vec2 vUv;
out vec4 outColor;
void main() {
  float L = texture(uPressure, vUv - vec2(texelSize.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(texelSize.x, 0.0)).x;
  float B = texture(uPressure, vUv - vec2(0.0, texelSize.y)).x;
  float T = texture(uPressure, vUv + vec2(0.0, texelSize.y)).x;
  vec2 vel = texture(uVelocity, vUv).xy - vec2(R - L, T - B) * 0.5;
  outColor = vec4(vel, 0.0, 1.0);
}`,
  // vel.y += min(accel*density, cap) * dt — the plume's self-lift. Reads the
  // (higher-res) density texture from a pass running at sim resolution,
  // which is fine: texture() samples by uv, not by the reading pass's own
  // target size.
  buoyancy: `
uniform sampler2D uVelocity;
uniform sampler2D uDensity;
uniform float accel;
uniform float cap;
uniform float dt;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 vel = texture(uVelocity, vUv).xy;
  float d = texture(uDensity, vUv).r;
  float rise = min(accel * max(d, 0.0), cap);
  vel.y += rise * dt;
  outColor = vec4(vel, 0.0, 1.0);
}`,
  // value * texture: pressure's warm-start clear (value < 1, liquid's own
  // trick to cut the Jacobi iterations a warm guess needs) and resize's
  // carry-over copy (value = 1) / velocity rescale (value = velScale ratio)
  // share this one shader.
  scale: `
uniform sampler2D uTexture;
uniform float value;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = value * texture(uTexture, vUv); }`,
}
for (const k in FRAG_STEP) FRAG[k] = FRAG_STEP[k]

interface Progs {
  splat: Program
  advect: Program
  curl: Program
  vorticity: Program
  divergence: Program
  pressure: Program
  gradient: Program
  buoyancy: Program
  scale: Program
}

interface Sim {
  simW: number
  simH: number
  dyeW: number
  dyeH: number
  /** 1/simW, 1/simH — see the advect shader's comment for why density
   *  advection uses this and not the dye grid's own texel size. */
  texelSim: readonly [number, number]
  /** simW/simH (== dyeW/dyeH: both grids share the canvas's aspect). */
  aspect: number
  /** Sim texels per uv unit — velocity's storage unit (see the module doc). */
  velScale: number
  velocity: DoubleTarget
  density: DoubleTarget
  divergence: Target
  curl: Target
  pressure: DoubleTarget
}

function computeGridDims(w: number, h: number, lowPower: boolean): { simW: number; simH: number; dyeW: number; dyeH: number } {
  const simShort = lowPower ? TUNE.simShortLow : TUNE.simShort
  const dyeShort = lowPower ? TUNE.dyeShortLow : TUNE.dyeShort
  const longRatio = Math.max(w, h) / Math.max(1, Math.min(w, h))
  const simW = w >= h ? Math.round(simShort * longRatio) : simShort
  const simH = w >= h ? simShort : Math.round(simShort * longRatio)
  const dyeW = w >= h ? Math.round(dyeShort * longRatio) : dyeShort
  const dyeH = w >= h ? dyeShort : Math.round(dyeShort * longRatio)
  return { simW, simH, dyeW, dyeH }
}

function buildSim(kit: GLKit, w: number, h: number, lowPower: boolean): Sim {
  const { simW, simH, dyeW, dyeH } = computeGridDims(w, h, lowPower)
  return {
    simW, simH, dyeW, dyeH,
    texelSim: [1 / simW, 1 / simH],
    aspect: simW / simH,
    velScale: (simW + simH) * 0.5,
    velocity: kit.double(simW, simH, { format: 'rg16f' }),
    density: kit.double(dyeW, dyeH, { format: 'r16f' }),
    divergence: kit.target(simW, simH, { format: 'r16f', filter: 'nearest' }),
    curl: kit.target(simW, simH, { format: 'r16f', filter: 'nearest' }),
    pressure: kit.double(simW, simH, { format: 'r16f', filter: 'nearest' }),
  }
}

function destroySim(kit: GLKit, sim: Sim): void {
  kit.deleteDouble(sim.velocity)
  kit.deleteDouble(sim.density)
  kit.deleteTarget(sim.divergence)
  kit.deleteTarget(sim.curl)
  kit.deleteDouble(sim.pressure)
}

// Scalar params only (no point/amount tuples): step()'s hot path must not
// allocate, and this is called up to 12*3 times a frame (main splat + the
// puff swirl pair).
function splatAmount(
  kit: GLKit, prog: Program, target: DoubleTarget, aspect: number,
  u: number, v: number, ax: number, ay: number, az: number, sigma2: number,
): void {
  const gl = kit.gl
  kit.bind(target.write)
  prog.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, target.read.tex)
  gl.uniform1i(prog.u.uTarget, 0)
  gl.uniform1f(prog.u.aspect, aspect)
  gl.uniform2f(prog.u.point, u, v)
  gl.uniform3f(prog.u.amount, ax, ay, az)
  gl.uniform1f(prog.u.sigma2, sigma2)
  kit.draw()
  target.swap()
}

function addSource(kit: GLKit, sim: Sim, splat: Program, source: SmokeSource, dt: number): void {
  const { u, v, du, dv, radius, density, puff } = source
  const sigma2 = radius * radius
  const vx = du * sim.velScale * TUNE.srcVelK
  const vy = dv * sim.velScale * TUNE.srcVelK
  if (puff) {
    // One-off: the full density lands at once, not scaled by dt.
    splatAmount(kit, splat, sim.velocity, sim.aspect, u, v, vx, vy, 0, sigma2)
    splatAmount(kit, splat, sim.density, sim.aspect, u, v, density, 0, 0, sigma2)
    // Vortex dipole: two extra velocity-only splats, offset perpendicular to
    // the puff's own velocity (or +x if it has none), each spinning the
    // opposite way from the other. Self-advection then rolls this into a
    // curl rather than leaving vorticity confinement to invent one from a
    // single, directionless blob.
    let px = -dv
    let py = du
    const pl = Math.hypot(px, py)
    if (pl > 1e-4) { px /= pl; py /= pl } else { px = 1; py = 0 }
    const tx = -py
    const ty = px
    const off = radius * TUNE.swirlOffsetFrac
    const swirlSigma2 = sigma2 * TUNE.swirlSigmaFrac
    const swirl = Math.sqrt(Math.max(density, 0)) * sim.velScale * TUNE.swirlK
    splatAmount(kit, splat, sim.velocity, sim.aspect, u + px * off, v + py * off, tx * swirl, ty * swirl, 0, swirlSigma2)
    splatAmount(kit, splat, sim.velocity, sim.aspect, u - px * off, v - py * off, -tx * swirl, -ty * swirl, 0, swirlSigma2)
  } else {
    splatAmount(kit, splat, sim.velocity, sim.aspect, u, v, vx, vy, 0, sigma2)
    splatAmount(kit, splat, sim.density, sim.aspect, u, v, density * dt, 0, 0, sigma2)
  }
}

// Stam's stable-fluids step, plus the buoyancy pass: curl -> vorticity
// confinement -> buoyancy -> divergence -> pressure Jacobi -> gradient
// subtract -> advect velocity -> advect density. Same structure as liquid's
// stepSim, with one extra pass and a plain-density (not RGB) dye advect.
function stepFluid(kit: GLKit, sim: Sim, p: Progs, dtIn: number, iters: number): void {
  // Same ceiling as liquid's stepSim: a huge dt (a tab resumed after being
  // backgrounded) would advect texels far past their neighbours and blow up.
  // step()'s own dt — used for idle tracking and source amounts — stays
  // unclamped; only the physics below sees this one.
  const dt = Math.min(Math.max(dtIn, 0.0001), 1 / 30)
  const gl = kit.gl
  const ts0 = sim.texelSim[0]
  const ts1 = sim.texelSim[1]
  const velDecay = Math.exp(-TUNE.velocityDecay * dt)
  const densityDecay = Math.exp(-TUNE.densityDecay * dt)

  kit.bind(sim.curl)
  p.curl.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, sim.velocity.read.tex)
  gl.uniform1i(p.curl.u.uVelocity, 0)
  gl.uniform2f(p.curl.u.texelSize, ts0, ts1)
  kit.draw()

  kit.bind(sim.velocity.write)
  p.vorticity.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, sim.velocity.read.tex)
  gl.uniform1i(p.vorticity.u.uVelocity, 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, sim.curl.tex)
  gl.uniform1i(p.vorticity.u.uCurl, 1)
  gl.uniform2f(p.vorticity.u.texelSize, ts0, ts1)
  gl.uniform1f(p.vorticity.u.curlStrength, TUNE.curl)
  gl.uniform1f(p.vorticity.u.dt, dt)
  kit.draw()
  sim.velocity.swap()

  kit.bind(sim.velocity.write)
  p.buoyancy.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, sim.velocity.read.tex)
  gl.uniform1i(p.buoyancy.u.uVelocity, 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, sim.density.read.tex)
  gl.uniform1i(p.buoyancy.u.uDensity, 1)
  gl.uniform1f(p.buoyancy.u.accel, TUNE.buoyAccel * sim.velScale)
  gl.uniform1f(p.buoyancy.u.cap, TUNE.buoyCap * sim.velScale)
  gl.uniform1f(p.buoyancy.u.dt, dt)
  kit.draw()
  sim.velocity.swap()

  kit.bind(sim.divergence)
  p.divergence.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, sim.velocity.read.tex)
  gl.uniform1i(p.divergence.u.uVelocity, 0)
  gl.uniform2f(p.divergence.u.texelSize, ts0, ts1)
  kit.draw()

  kit.bind(sim.pressure.write)
  p.scale.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, sim.pressure.read.tex)
  gl.uniform1i(p.scale.u.uTexture, 0)
  gl.uniform1f(p.scale.u.value, TUNE.pressureWarm)
  kit.draw()
  sim.pressure.swap()

  for (let i = 0; i < iters; i += 1) {
    kit.bind(sim.pressure.write)
    p.pressure.use()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, sim.pressure.read.tex)
    gl.uniform1i(p.pressure.u.uPressure, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, sim.divergence.tex)
    gl.uniform1i(p.pressure.u.uDivergence, 1)
    gl.uniform2f(p.pressure.u.texelSize, ts0, ts1)
    kit.draw()
    sim.pressure.swap()
  }

  kit.bind(sim.velocity.write)
  p.gradient.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, sim.pressure.read.tex)
  gl.uniform1i(p.gradient.u.uPressure, 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, sim.velocity.read.tex)
  gl.uniform1i(p.gradient.u.uVelocity, 1)
  gl.uniform2f(p.gradient.u.texelSize, ts0, ts1)
  kit.draw()
  sim.velocity.swap()

  kit.bind(sim.velocity.write)
  p.advect.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, sim.velocity.read.tex)
  gl.uniform1i(p.advect.u.uVelocity, 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, sim.velocity.read.tex)
  gl.uniform1i(p.advect.u.uSource, 1)
  gl.uniform2f(p.advect.u.texelSize, ts0, ts1)
  gl.uniform1f(p.advect.u.dt, dt)
  gl.uniform1f(p.advect.u.dissipation, velDecay)
  gl.uniform1f(p.advect.u.edgeFade, 0)
  kit.draw()
  sim.velocity.swap()

  kit.bind(sim.density.write)
  p.advect.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, sim.velocity.read.tex)
  gl.uniform1i(p.advect.u.uVelocity, 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, sim.density.read.tex)
  gl.uniform1i(p.advect.u.uSource, 1)
  gl.uniform2f(p.advect.u.texelSize, ts0, ts1)
  gl.uniform1f(p.advect.u.dt, dt)
  gl.uniform1f(p.advect.u.dissipation, densityDecay)
  gl.uniform1f(p.advect.u.edgeFade, TUNE.edgeFade * dt)
  kit.draw()
  sim.density.swap()
}

// Copies the old density 1:1 and rescales the old velocity by the new/old
// velScale ratio (velocity's unit is grid-relative), exactly as liquid's
// carryOver does — never wipes what was already smoking.
function carryOver(kit: GLKit, scale: Program, from: Sim, to: Sim): void {
  const gl = kit.gl
  kit.bind(to.density.write)
  scale.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, from.density.read.tex)
  gl.uniform1i(scale.u.uTexture, 0)
  gl.uniform1f(scale.u.value, 1)
  kit.draw()
  to.density.swap()

  kit.bind(to.velocity.write)
  scale.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, from.velocity.read.tex)
  gl.uniform1i(scale.u.uTexture, 0)
  gl.uniform1f(scale.u.value, to.velScale / from.velScale)
  kit.draw()
  to.velocity.swap()
}

/** Null when !kit.floatTargets: a fluid solver needs half-float targets. */
export function createSmoke(kit: GLKit, opts: { lowPower: boolean }): Smoke | null {
  if (!kit.floatTargets) return null
  const { lowPower } = opts
  const iters = lowPower ? TUNE.pressureItersLow : TUNE.pressureIters

  const progs: Progs = {
    splat: kit.program(FRAG.splat),
    advect: kit.program(FRAG.advect),
    curl: kit.program(FRAG.curl),
    vorticity: kit.program(FRAG.vorticity),
    divergence: kit.program(FRAG.divergence),
    pressure: kit.program(FRAG.pressure),
    gradient: kit.program(FRAG.gradient),
    buoyancy: kit.program(FRAG.buoyancy),
    scale: kit.program(FRAG.scale),
  }

  // A square placeholder grid (aspect unknown until the first resize()) —
  // never degenerate, so a step() that lands before the first resize() is
  // merely mis-shaped rather than broken.
  let sim = buildSim(kit, 1, 1, lowPower)
  let idleT = TUNE.idleTimeout + 1

  return {
    get active() { return idleT < TUNE.idleTimeout },
    get texture() { return sim.density.read.tex },
    step(dt, sources) {
      idleT = sources.length > 0 ? 0 : idleT + dt
      const n = Math.min(sources.length, TUNE.maxSourcesPerFrame)
      for (let i = 0; i < n; i += 1) addSource(kit, sim, progs.splat, sources[i], dt)
      stepFluid(kit, sim, progs, dt, iters)
    },
    resize(w, h) {
      const d = computeGridDims(w, h, lowPower)
      if (d.simW === sim.simW && d.simH === sim.simH && d.dyeW === sim.dyeW && d.dyeH === sim.dyeH) return
      const next = buildSim(kit, w, h, lowPower)
      carryOver(kit, progs.scale, sim, next)
      destroySim(kit, sim)
      sim = next
    },
    destroy() {
      destroySim(kit, sim)
      const gl = kit.gl
      gl.deleteProgram(progs.splat.prog)
      gl.deleteProgram(progs.advect.prog)
      gl.deleteProgram(progs.curl.prog)
      gl.deleteProgram(progs.vorticity.prog)
      gl.deleteProgram(progs.divergence.prog)
      gl.deleteProgram(progs.pressure.prog)
      gl.deleteProgram(progs.gradient.prog)
      gl.deleteProgram(progs.buoyancy.prog)
      gl.deleteProgram(progs.scale.prog)
    },
  }
}
