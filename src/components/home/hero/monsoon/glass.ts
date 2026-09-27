/**
 * glass.ts — the one full-screen pass: rain on the glass, fog, refraction,
 * the city behind it, and how props/smoke/post-processing land on top. This
 * and city.ts are the first thing a visitor sees, so every choice here is
 * judged against "does this look filmed, not drawn".
 *
 * Two GL passes: a tiny ping-ponged fog mask (stepFog) and the one big
 * composite (render). Both are plain fragment shaders through gl.ts; there is
 * no vertex work beyond the shared fullscreen triangle.
 *
 * Coordinate spaces:
 * - `vUv`: screen space, (0,0) bottom-left, (1,1) top-right — what the fog
 *   mask, props and smoke are already in.
 * - `p = vUv * vec2(aspect, 1.0)`: aspect-corrected "v units" (fractions of
 *   the screen HEIGHT) — where every drop's geometry and every flame's glow
 *   falloff is authored, so a circle stays a circle regardless of aspect.
 * - the city uv: `vUv` cover-fit onto the city plate (`uCityMap`), with a 4%
 *   margin so parallax never exposes an edge.
 *
 * Blur is authored as a fraction of the screen height, not in plate texels:
 * the shader adds log2(visible plate rows / 1231) to every LOD, 1231 being
 * the rows a 2048×1280 plate shows on a 16:10 screen, so a phone's taller
 * plate is not rendered crisper than the laptop's.
 *
 * Per pixel (normal): 1 fog + 5 night + 5 emit + 1 bokeh + 1 flicker + 1 fog
 * glow + props + smoke = 16 fetches at night; the day plate adds 5 while
 * dayness is between 0 and 1, and smoke adds 1 while it is live. lowPower
 * drops to 3-tap blurs and one static drop layer.
 */
import type { GLKit, Target, DoubleTarget } from './gl'
import { GLASS_Z, type Camera } from './camera'
import type { CityTextures, SceneState, Vec3 } from './types'
import { FLAME_RGB, windowLight } from './light'

export interface GlassInputs {
  city: CityTextures | null
  props: Target | null
  smoke: WebGLTexture | null
}

export interface Glass {
  resize(w: number, h: number): void
  stepFog(state: SceneState): void
  render(state: SceneState, cam: Camera, inputs: GlassInputs): void
  destroy(): void
}

const MAX_WIPES = 16
const MAX_LANES = 4
const MAX_FLAMES = 2
const FOG_SHORT_SIDE = 256
/** Cover-fit zoom, so a parallax shift never shows the plate's edge. */
const MARGIN = 0.04
const PARALLAX = 0.012

// ---------------------------------------------------------------------------
// Fog pass: a small r8/r16f mask, ping-ponged. 1 means fully fogged. Seeded
// to the condensation curve on creation so frame 1 already looks right,
// rather than growing up from a clear pane over the first 25 seconds.
// ---------------------------------------------------------------------------

const FOG_FRAG = `
uniform sampler2D uPrev;
uniform float uAspect;
uniform float uDt;
uniform float uReduced;
uniform float uSeed;
uniform vec2 uWipeUV[${MAX_WIPES}];
uniform float uWipeR[${MAX_WIPES}];
uniform float uWipeStrength[${MAX_WIPES}];
uniform int uWipeCount;

in vec2 vUv;
out vec4 fragColor;

float hash1(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash1(i);
  float b = hash1(i + vec2(1.0, 0.0));
  float c = hash1(i + vec2(0.0, 1.0));
  float d = hash1(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  float target = clamp(smoothstep(0.66, 0.2, vUv.y) * 0.95 + (vnoise(vUv * 5.0) - 0.5) * 0.08, 0.0, 1.0);
  float f = texture(uPrev, vUv).r;
  if (uSeed > 0.5) {
    f = target;
  } else {
    if (uReduced < 0.5) f = min(target, f + 0.045 * uDt);
    vec2 p = vUv * vec2(uAspect, 1.0);
    for (int i = 0; i < ${MAX_WIPES}; i += 1) {
      if (i >= uWipeCount) break;
      vec2 wp = uWipeUV[i] * vec2(uAspect, 1.0);
      float dist = length(p - wp);
      f *= 1.0 - uWipeStrength[i] * (1.0 - smoothstep(0.0, uWipeR[i], dist));
    }
  }
  fragColor = vec4(f, 0.0, 0.0, 1.0);
}
`

// ---------------------------------------------------------------------------
// Composite: drops → city (refracted inside a drop, blurred by the fog outside
// one) → fog → flame light → smoke → props → tone map, vignette, grain.
// ---------------------------------------------------------------------------

const f3 = (v: Vec3) => v.map(x => x.toFixed(4)).join(', ')

const COMP_LIB = `
const vec3 FLAME = vec3(${f3(FLAME_RGB)});
const vec2 K1 = vec2(0.8944272, 0.4472136);
const vec2 K2 = vec2(-0.4472136, 0.8944272);
#ifdef LOW
const float RUN_COL = 0.1;
#else
const float RUN_COL = 0.07;
#endif
const float RUN_SPAN = 1.6;
const float RUN_ODDS = 0.5;

uniform sampler2D uNight;
uniform sampler2D uDay;
uniform sampler2D uEmit;
uniform sampler2D uFlicker;
uniform sampler2D uFog;
uniform sampler2D uProps;
uniform sampler2D uSmoke;

uniform vec2 uRes;
uniform float uTime;
uniform float uGrainT;
uniform vec4 uCityMap;
uniform float uCity;
uniform float uCityAspect;
uniform float uDayness;
uniform vec3 uHourTint;
uniform vec3 uWindow;
uniform float uEmitGain;
uniform vec3 uGroups[3];
uniform vec3 uFlick;
uniform vec4 uLanes[${MAX_LANES}];
uniform float uLaneSize[${MAX_LANES}];
uniform int uLaneCount;
uniform vec3 uFlames[${MAX_FLAMES}];
uniform int uFlameCount;
uniform float uSmokeOn;
uniform float uPropsOn;

in vec2 vUv;
out vec4 fragColor;

float gAspect;
float gAA;
// A running drop is water on the inner face (it wipes the condensation as it
// goes), so it stays crisp whatever the fog: its own edge width.
float gAAin;

// Dave Hoskins' sine-free hashes: stable across GPUs at large inputs.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec4 hash42(vec2 p) {
  vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

vec3 decode(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }

// A blur that hides the mip grid: taps in a cross rotated off the texel axes,
// one mip texel apart.
vec3 tap5(sampler2D s, vec2 uv, float lod, vec2 rad) {
#ifdef LOW
  vec3 c = textureLod(s, uv, lod).rgb * 0.4;
  c += textureLod(s, uv + K1 * rad, lod).rgb * 0.3;
  c += textureLod(s, uv - K1 * rad, lod).rgb * 0.3;
#else
  vec3 c = textureLod(s, uv, lod).rgb * 0.28;
  c += textureLod(s, uv + K1 * rad, lod).rgb * 0.18;
  c += textureLod(s, uv - K1 * rad, lod).rgb * 0.18;
  c += textureLod(s, uv + K2 * rad, lod).rgb * 0.18;
  c += textureLod(s, uv - K2 * rad, lod).rgb * 0.18;
#endif
  return c;
}

// A static drop layer: cells of \`cell\` v units, each holding a drop in
// \`shape.x\` of its life cycles, radius shape.y..shape.z of the cell. Keeps the
// most-covering drop: (coverage, normal, radius).
void staticLayer(vec2 p, float cell, vec3 shape, float salt, float swept, inout vec4 best) {
  vec2 g = p / cell;
  vec2 id0 = floor(g);
  vec2 side = sign(g - id0 - 0.5);
  for (int k = 0; k < 4; k++) {
    vec2 id = id0 + vec2(float(k & 1), float(k >> 1)) * side;
    vec4 h = hash42(id + salt);
    float period = mix(18.0, 40.0, h.x);
    float tt = uTime / period + h.y;
    float cyc = floor(tt);
    float ph = tt - cyc;
    vec4 g4 = hash42(id * 1.37 + vec2(salt, cyc * 7.13));
    if (g4.x >= shape.x) continue;
    float life = smoothstep(0.0, 0.1, ph) * (1.0 - smoothstep(0.85, 1.0, ph));
    float r = cell * mix(shape.y, shape.z, g4.y * g4.y) * life * (1.0 - swept);
    vec2 q = p - (id + 0.25 + 0.5 * g4.zw) * cell;
    // Vertical glass: the water sags into a heavier bottom.
    if (q.y < 0.0) q.y /= 1.12;
    float cov = 1.0 - smoothstep(r - gAA, r + gAA, length(q));
    if (cov > best.x) best = vec4(cov, q / max(r, 1e-5), r);
  }
}

// A running drop's path: it wanders, but never in one clean sine.
float runPath(float y, float wob) {
  return 0.008 * sin(y * 18.0 + wob) + 0.004 * sin(y * 47.0 + wob * 2.3);
}

// One running drop per column and cycle, sliding in stick-slip steps. Writes
// the trail it leaves: trail.x is fog wiped off, trail.y where it swept up
// the static drops.
void runningDrops(vec2 p, inout vec4 best, inout vec2 trail) {
  float gx = p.x / RUN_COL;
  float c0 = floor(gx);
  float nb = gx - c0 < 0.5 ? -1.0 : 1.0;
  for (int k = 0; k < 2; k++) {
    float col = c0 + (k == 0 ? 0.0 : nb);
    vec4 h = hash42(vec2(col, 5.17));
    float rate = mix(0.9, 2.2, h.x);
    float stepLen = mix(0.03, 0.09, h.y);
    float travel = uTime * rate + h.z * 97.0;
    float seg = floor(travel);
    // Holds for a third of each step, then darts: never a constant speed.
    float y = (seg + smoothstep(0.35, 1.0, travel - seg)) * stepLen;
    float cyc = floor(y / RUN_SPAN);
    float headY = 1.25 - (y - cyc * RUN_SPAN);
    vec4 g = hash42(vec2(col * 3.1, cyc + 11.0));
    if (g.x > RUN_ODDS) continue;
    float r = mix(0.012, 0.018, g.y);
    float x0 = (col + 0.3 + 0.4 * g.z) * RUN_COL;
    float wob = g.w * 6.2831;
    float trailLen = mix(0.08, 0.3, fract(g.w * 7.7));

    // The head: round at the bottom, drawn out and narrower above.
    vec2 q = p - vec2(x0 + runPath(headY, wob), headY);
    float up = max(q.y, 0.0);
    q.y -= up * 0.3;
    q.x *= 1.0 + 0.5 * up / r;
    float cov = 1.0 - smoothstep(r - gAAin, r + gAAin, length(q));
    if (cov > best.x) best = vec4(cov, q / r, r);

    float above = p.y - headY;
    if (above <= 0.0 || above > trailLen * 1.8) continue;
    float dx = abs(p.x - (x0 + runPath(p.y, wob)));
    float fade = 1.0 - smoothstep(trailLen * 0.6, trailLen, above);
    // The channel necks and swells, and a film of mist is left in it.
    float hw = 0.26 * r * (0.7 + 0.3 * sin(p.y * 140.0 + wob * 3.0) + 0.3 * sin(p.y * 57.0 + col));
    trail.x = max(trail.x, (1.0 - smoothstep(hw * 0.5, hw + gAAin * 2.0, dx)) * fade * 0.7);
    trail.y = max(trail.y, (1.0 - smoothstep(r * 0.9, r * 1.4, dx)) * (1.0 - smoothstep(trailLen, trailLen * 1.8, above)));

    // The string of droplets it leaves behind, one slot per 0.012 v.
    float slot = floor(p.y / 0.012);
    float sy = (slot + 0.5) * 0.012;
    vec4 s = hash42(vec2(col * 7.3 + cyc, slot));
    if (s.x > 0.45 || sy < headY + r) continue;
    float sr = r * mix(0.15, 0.3, s.y) * fade;
    vec2 sq = p - vec2(x0 + runPath(sy, wob) + (s.z - 0.5) * r * 0.6, sy);
    float scov = 1.0 - smoothstep(sr - gAAin, sr + gAAin, length(sq));
    if (scov > best.x) best = vec4(scov, sq / max(sr, 1e-5), sr);
  }
}

// Flying traffic: lights every ~0.15 uv along each lane, as soft dots whose
// size follows the local blur so they stay as defocused as the plate.
vec3 traffic(vec2 cuv, float blur) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_LANES}; i++) {
    if (i >= uLaneCount) break;
    vec4 L = uLanes[i];
    float size = uLaneSize[i];
    float sig = max(size, blur);
    float dy = cuv.y - L.x;
    if (abs(dy) > sig * 4.0 + size * 3.0) continue;
    float s = (cuv.x - L.y - L.w * uTime) / 0.15;
    float k = floor(s + 0.5);
    vec4 h = hash42(vec2(k, float(i) * 7.7 + 3.0));
    float dx = (s - k - (h.y - 0.5) * 0.3) * 0.15 * uCityAspect;
    float ddy = dy - (h.z - 0.5) * size * 4.0;
    float e = exp(-(dx * dx + ddy * ddy) / (2.0 * sig * sig)) * (size * size) / (sig * sig);
    float along = (cuv.x - L.y) / max(L.z - L.y, 1e-4);
    float fade = smoothstep(0.0, 0.06, along) * smoothstep(1.0, 0.94, along);
    vec3 c = L.w > 0.0 ? vec3(1.0, 0.9, 0.75) : vec3(1.0, 0.07, 0.04);
    acc += c * (e * step(0.4, h.x) * fade);
  }
  return acc * 6.0;
}

// Before the plates are drawn: a plain night with the city's glow low down.
vec3 plainNight(float y) {
  vec3 top = decode(vec3(0.02, 0.024, 0.05));
  vec3 low = decode(vec3(0.23, 0.07, 0.22));
  return mix(low, top, smoothstep(0.25, 0.9, y)) * (0.6 + 0.4 * smoothstep(0.0, 0.35, y));
}

// Narkowicz's ACES filmic fit.
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
`

const COMP_MAIN = `
void main() {
  gAspect = uRes.x / uRes.y;
  vec2 p = vUv * vec2(gAspect, 1.0);
  // The rain is on the outside of the pane and the condensation on the
  // inside, so a drop behind fog is seen through it: soft-edged and faint,
  // until a wipe clears the glass in front of it.
  float fogRaw = texture(uFog, vUv).r;
  gAAin = 1.0 / uRes.y;
  gAA = (1.0 + fogRaw * 7.0) * gAAin;

  // ── Drops: a fine mist, the common sizes, and a few big ones ──
  vec4 drop = vec4(0.0);
  vec2 trail = vec2(0.0);
  runningDrops(p, drop, trail);
  vec4 st = vec4(0.0);
  staticLayer(p, 0.018, vec3(0.28, 0.12, 0.3), 1.7, trail.y, st);
  staticLayer(p, 0.04, vec3(0.3, 0.14, 0.34), 9.3, trail.y, st);
#ifndef LOW
  staticLayer(p, 0.075, vec3(0.18, 0.18, 0.34), 4.1, trail.y, st);
#endif
  st.x *= 1.0 - fogRaw * 0.75;
  if (st.x > drop.x) drop = st;
  float cov = drop.x;
  vec2 n = drop.yz;
  float r = drop.w;
  // A running drop's trail is water that wiped the condensation off with it.
  float fog = fogRaw * (1.0 - trail.x);

  // ── The city: inverted and sharp inside a drop, fog-blurred outside ──
  vec2 cuv = vUv * uCityMap.xy + uCityMap.zw;
  vec2 suv = cuv - n * (r * 1.6 * cov) / vec2(gAspect, 1.0) * uCityMap.xy;
  vec3 col;
  vec3 glow = vec3(0.0);
  float bias = 0.0;
  if (uCity > 0.5) {
    vec2 size = vec2(textureSize(uNight, 0));
    bias = log2(size.y * uCityMap.y / 1231.0);
    // A big drop is a sharp little lens; the finest mist is a poorer one.
    float lod = mix(bias + 1.8 + fog * 3.0, mix(1.4, 0.4, smoothstep(0.003, 0.012, r)), cov);
    vec2 rad = exp2(lod) / size;
    vec3 base = vec3(0.0);
    if (uDayness < 0.999) base = decode(tap5(uNight, suv, lod, rad)) * (1.0 - uDayness);
    if (uDayness > 0.001) base += decode(tap5(uDay, suv, lod - 1.0, rad)) * uDayness;
    vec3 light = decode(tap5(uEmit, suv, lod, rad));
    // Bokeh: every light also blooms into a soft disc.
    light += decode(textureLod(uEmit, suv, lod + 1.5).rgb) * 0.6;
    vec3 fl = decode(textureLod(uFlicker, suv, lod - 1.0).rgb);
    light += fl.r * uFlick.x * uGroups[0] + fl.g * uFlick.y * uGroups[1] + fl.b * uFlick.z * uGroups[2];
    col = base + light * (uEmitGain * 2.2) + traffic(suv, rad.y) * uEmitGain;
    // The condensation scatters the lights into a glow.
    glow = decode(textureLod(uEmit, cuv, bias + 6.0).rgb) * (uEmitGain * 2.2);
    col += glow * (0.35 * fog);
  } else {
    col = plainNight(suv.y);
  }

  // Dawn and dusk take the colour of the hour, strongest at the midpoint.
  float grade = smoothstep(0.15, 0.5, uDayness) * (1.0 - smoothstep(0.5, 0.85, uDayness));
  col *= mix(vec3(1.0), uHourTint, grade * 0.6);

  // ── Fogged glass, and the drop's dark rim ──
  col = mix(col, uWindow * 0.55 + vec3(0.003, 0.003, 0.005), 0.25 * fog);
  col *= 1.0 - 0.25 * smoothstep(0.75, 1.0, length(n)) * cov;

  // ── Flames: warm light on the glass, a glint in each drop ──
  vec3 flameLight = vec3(0.0);
  vec3 smokeLit = vec3(0.0);
  for (int i = 0; i < ${MAX_FLAMES}; i++) {
    if (i >= uFlameCount) break;
    vec3 F = uFlames[i];
    vec2 dv = vec2(F.x * gAspect, F.y) - p;
    float d = length(dv);
    float x = d / 0.05;
    flameLight += FLAME * (F.z * (0.06 / (1.0 + x * x) + 0.4 * fog * exp(-d / 0.14)));
    // Smoke right above a flame is lit orange by it, far more than the glass.
    float xs = d / 0.08;
    smokeLit += FLAME * (F.z * 0.6 / (1.0 + xs * xs));
    vec2 gq = n - 0.5 * dv / max(d, 1e-4);
    col += FLAME * (F.z * cov * 1.5 * exp(-dot(gq, gq) * 60.0) / (1.0 + d * d * 200.0));
  }
  col += flameLight;

  // ── Smoke, lit from behind by the city and from below by the flame ──
  if (uSmokeOn > 0.5) {
    float s = texture(uSmoke, vUv).r;
    vec3 behind = glow;
    if (uCity > 0.5) {
      behind += decode(textureLod(uNight, cuv, bias + 5.0).rgb) * (1.0 - uDayness);
      if (uDayness > 0.001) behind += decode(textureLod(uDay, cuv, bias + 4.0).rgb) * uDayness;
    }
    // Beer-Lambert, so a thin wisp still shows; the light it scatters is what
    // is behind it, which is why smoke in front of a pink sign glows pink.
    float a = min(1.0 - exp(-4.0 * s), 0.92);
    col = col * (1.0 - a) + (0.05 + 0.95 * behind + flameLight * 1.4 + smokeLit) * a;
  }

  // ── The sill and its objects, premultiplied ──
  if (uPropsOn > 0.5) {
    vec4 pr = texture(uProps, vUv);
    col = col * (1.0 - pr.a) + pr.rgb;
  }

  // ── Post ──
  col = aces(col);
  vec2 vq = vUv - 0.5;
  col *= 1.0 - 0.3 * smoothstep(0.05, 0.5, dot(vq, vq));
  vec3 o = pow(col, vec3(1.0 / 2.2));
  float luma = dot(o, vec3(0.299, 0.587, 0.114));
  float grain = hash12(gl_FragCoord.xy + uGrainT * 17.31) - 0.5;
  o += grain * 0.03 * smoothstep(0.0, 0.12, luma) * (1.0 - 0.6 * luma);
  // Interleaved gradient noise: a blue-noise-like ±0.5/255 against banding.
  o += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
  fragColor = vec4(o, 1.0);
}
`

// ---------------------------------------------------------------------------
// Flicker curves, on the CPU: three numbers a frame, not per pixel.
// ---------------------------------------------------------------------------

function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

function noise1(x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const a = hash1(i)
  return a + (hash1(i + 1) - a) * f * f * (3 - 2 * f)
}

function flickerCurves(t: number, out: Float32Array) {
  // Broken neon: mostly on, irregular dropouts, now and then a 1-2 s outage.
  const win = Math.floor(t / 11)
  const start = win * 11 + 2 + hash1(win + 7.3) * 7
  const outage = hash1(win + 0.5) < 0.55 && t > start && t < start + 1 + hash1(win + 3.1)
  out[0] = outage || noise1(t * 7) < 0.12 ? 0 : 0.85 + 0.15 * noise1(t * 23)
  // The payment billboard: dark for 9 s, then 3 s on, arriving with a quick
  // triple blink like a phone notification.
  const p = (t % 12) - 9
  out[1] = p < 0 ? 0 : p < 0.45 ? ((p / 0.15) % 1 < 0.55 ? 1 : 0) : p > 2.8 ? (3 - p) / 0.2 : 1
  // Aircraft warning lights: 1 Hz at a 15% duty cycle, with a lamp's soft edges.
  const a = t % 1
  out[2] = a < 0.15 ? Math.min(1, a / 0.03, (0.15 - a) / 0.05) : 0
}

// ---------------------------------------------------------------------------

export function createGlass(kit: GLKit, opts: { lowPower: boolean; reduced: boolean }): Glass {
  const gl = kit.gl
  const fogProg = kit.program(FOG_FRAG)
  const comp = kit.program(COMP_LIB + COMP_MAIN, { defines: opts.lowPower ? ['LOW 1'] : [] })
  // Bound to every sampler with nothing to show, so no unit is ever empty.
  const blank = kit.texture(new ImageData(1, 1))
  const fu = fogProg.u
  const cu = comp.u

  fogProg.use()
  gl.uniform1i(fu.uPrev, 0)
  comp.use()
  const samplers = ['uNight', 'uDay', 'uEmit', 'uFlicker', 'uFog', 'uProps', 'uSmoke']
  for (let i = 0; i < samplers.length; i += 1) gl.uniform1i(cu[samplers[i]] ?? null, i)

  // Uniform storage, allocated once: render() and stepFog() allocate nothing.
  const wipeUV = new Float32Array(MAX_WIPES * 2)
  const wipeR = new Float32Array(MAX_WIPES)
  const wipeS = new Float32Array(MAX_WIPES)
  const cityMap = new Float32Array(4)
  const groups = new Float32Array(9)
  const lanes = new Float32Array(MAX_LANES * 4)
  const laneSize = new Float32Array(MAX_LANES)
  const flames = new Float32Array(MAX_FLAMES * 3)
  const flick = new Float32Array(3)
  const hourTint = new Float32Array(3)
  const windowRgb: Vec3 = [0, 0, 0]
  const foot: Vec3 = [0, 0, 0]
  const projected: Vec3 = [0, 0, 0]
  let laneCount = 0
  let laneCity: CityTextures | null = null

  let bufW = 1
  let bufH = 1
  let fog: DoubleTarget | null = null
  let seeded = false

  function bindTex(unit: number, tex: WebGLTexture) {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
  }

  /** One fog step from `prev` into `into`. With dt 0 and no wipes it is a
   *  plain resample, which is how a resize keeps the wiped streaks. */
  function fogPass(prev: WebGLTexture, into: Target, dt: number, reduced: boolean, wipes: number) {
    fogProg.use()
    gl.uniform1f(fu.uAspect, bufW / bufH)
    gl.uniform1f(fu.uDt, dt)
    gl.uniform1f(fu.uReduced, reduced ? 1 : 0)
    gl.uniform1f(fu.uSeed, seeded ? 0 : 1)
    gl.uniform1i(fu.uWipeCount, wipes)
    if (wipes > 0) {
      gl.uniform2fv(fu.uWipeUV, wipeUV)
      gl.uniform1fv(fu.uWipeR, wipeR)
      gl.uniform1fv(fu.uWipeStrength, wipeS)
    }
    bindTex(0, prev)
    kit.bind(into)
    kit.draw()
  }

  return {
    resize(w, h) {
      bufW = Math.max(1, w)
      bufH = Math.max(1, h)
      const short = Math.min(bufW, bufH)
      const fw = Math.max(1, Math.round((FOG_SHORT_SIDE * bufW) / short))
      const fh = Math.max(1, Math.round((FOG_SHORT_SIDE * bufH) / short))
      // A render-scale change keeps the aspect, so the mask is kept as is.
      if (fog && fog.read.w === fw && fog.read.h === fh) return
      const next = kit.double(fw, fh, { format: kit.floatTargets ? 'r16f' : 'r8' })
      if (fog && seeded) {
        fogPass(fog.read.tex, next.write, 0, true, 0)
        next.swap()
      }
      kit.deleteDouble(fog)
      fog = next
    },

    stepFog(state) {
      if (!fog) return
      const n = Math.min(state.wipes.length, MAX_WIPES)
      for (let i = 0; i < n; i += 1) {
        const w = state.wipes[i]
        wipeUV[i * 2] = w.u
        wipeUV[i * 2 + 1] = w.v
        wipeR[i] = w.r
        wipeS[i] = w.strength
      }
      fogPass(fog.read.tex, fog.write, state.dt, state.reduced, n)
      fog.swap()
      seeded = true
    },

    render(state, cam, inputs) {
      if (!fog) return
      const city = inputs.city
      if (city !== laneCity) {
        laneCity = city
        laneCount = city ? Math.min(city.lanes.length, MAX_LANES) : 0
        for (let i = 0; i < laneCount; i += 1) {
          const l = city!.lanes[i]
          lanes[i * 4] = l.y
          lanes[i * 4 + 1] = l.x0
          lanes[i * 4 + 2] = l.x1
          lanes[i * 4 + 3] = l.speed
          laneSize[i] = l.size
        }
        if (city) for (let c = 0; c < 3; c += 1) for (let k = 0; k < 3; k += 1) groups[c * 3 + k] = city.groups[c][k]
      }

      // Cover-fit the plate, zoomed by the margin, shifted by the parallax.
      const aspect = bufW / bufH
      const plate = city ? city.aspect : aspect
      let sx = aspect > plate ? 1 : aspect / plate
      let sy = aspect > plate ? plate / aspect : 1
      sx /= 1 + MARGIN
      sy /= 1 + MARGIN
      cityMap[0] = sx
      cityMap[1] = sy
      cityMap[2] = 0.5 - 0.5 * sx + state.parallax[0] * PARALLAX
      cityMap[3] = 0.5 - 0.5 * sy + state.parallax[1] * PARALLAX

      flickerCurves(state.t, flick)
      windowLight(state.dayness, state.hour, windowRgb)
      const hour = state.hour
      const hl = Math.max(0.05, 0.2126 * hour[0] + 0.7152 * hour[1] + 0.0722 * hour[2])
      for (let i = 0; i < 3; i += 1) hourTint[i] = Math.min(2, hour[i] / hl)

      // A flame lights the glass where it is nearest: straight behind it.
      const nf = Math.min(state.flames.length, MAX_FLAMES)
      for (let i = 0; i < nf; i += 1) {
        const f = state.flames[i]
        foot[0] = f.pos[0]
        foot[1] = f.pos[1]
        foot[2] = GLASS_Z
        cam.project(foot, projected)
        flames[i * 3] = projected[0]
        flames[i * 3 + 1] = projected[1]
        flames[i * 3 + 2] = projected[2] > 0 ? f.intensity : 0
      }

      comp.use()
      gl.uniform2f(cu.uRes, bufW, bufH)
      gl.uniform1f(cu.uTime, state.t)
      gl.uniform1f(cu.uGrainT, state.reduced ? 0 : Math.floor(state.t * 24) % 997)
      gl.uniform4fv(cu.uCityMap, cityMap)
      gl.uniform1f(cu.uCity, city ? 1 : 0)
      gl.uniform1f(cu.uCityAspect, plate)
      gl.uniform1f(cu.uDayness, state.dayness)
      gl.uniform3fv(cu.uHourTint, hourTint)
      gl.uniform3f(cu.uWindow, windowRgb[0], windowRgb[1], windowRgb[2])
      gl.uniform1f(cu.uEmitGain, 1 + (0.22 - 1) * state.dayness)
      gl.uniform3fv(cu.uGroups, groups)
      gl.uniform3fv(cu.uFlick, flick)
      gl.uniform4fv(cu.uLanes, lanes)
      gl.uniform1fv(cu.uLaneSize, laneSize)
      gl.uniform1i(cu.uLaneCount, laneCount)
      gl.uniform3fv(cu.uFlames, flames)
      gl.uniform1i(cu.uFlameCount, nf)
      gl.uniform1f(cu.uSmokeOn, inputs.smoke ? 1 : 0)
      gl.uniform1f(cu.uPropsOn, inputs.props ? 1 : 0)

      bindTex(0, city ? city.night : blank)
      bindTex(1, city ? city.day : blank)
      bindTex(2, city ? city.emit : blank)
      bindTex(3, city ? city.flicker : blank)
      bindTex(4, fog.read.tex)
      bindTex(5, inputs.props ? inputs.props.tex : blank)
      bindTex(6, inputs.smoke ?? blank)
      kit.bind(null)
      kit.draw()
    },

    destroy() {
      kit.deleteDouble(fog)
      fog = null
      kit.deleteTexture(blank)
      gl.deleteProgram(fogProg.prog)
      gl.deleteProgram(comp.prog)
    },
  }
}
