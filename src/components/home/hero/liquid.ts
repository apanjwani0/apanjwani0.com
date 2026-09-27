/**
 * Liquid light (?hero=liquid) — a stable-fluids GPU sim where day (amber) and
 * night (violet) ink collide. Ported from Hero Lab round 5 (owner-approved):
 * the shaders, TUNE values, emitters, tone map, bloom, shading, mask and
 * grain are unchanged. What changed for the real site:
 *  - the name/tagline/links are the server-rendered env.text elements, not a
 *    copy this module draws itself (see updateMask);
 *  - the shared clock (./clock, ./day) replaces the lab shell's scrubber;
 *  - the adaptive-resolution throttle judges rAF frame pacing instead of
 *    JS submit time (see the pacing block in loop());
 *  - every runProgram() call site sets its uniforms directly between bind
 *    and draw instead of passing a per-call closure, so nothing allocates
 *    once the sim is running;
 *  - the display shader's manual bilinear tap is compiled in only for
 *    devices without hardware-linear filtering of the dye texture;
 *  - lab-only hooks (?tune=, ?fixed=, window.__lq*, HeroLab.*) are gone;
 *    ?scale= survives as a DEV-only pin for screenshotting under swiftshader.
 */
import { createClock } from './clock'
import { dayness, hourColor, type Rgb } from './day'
import type { HeroCreate } from './types'

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v
}

// Baked from the lab's TUNE object (?tune= is gone; these were its defaults).
const TUNE = {
  curl: 18, vd: 0.4, dd: 0.4, rad: 0.004, ink: 0.45, vk: 2.4, ivl: 0.18,
  expo: 2.6, shade: 1, core: 0.45, pink: 0.3, toe: 0.08, bth: 0.5, bst: 0.8,
  sat: 1.4, dr: 0.0018, pr: 0.0009, pv: 2.2, po: 0.015,
} as const

// New ink takes the colour of the hour on Aman's clock (coral at dawn, amber
// by day, rose at dusk, violet at night); the second emitter pours the hour
// twelve hours away, as a thinner thread, so day and the night it is not
// always meet on screen. Both orbits stay in the upper two-thirds of the
// stage (UV y is bottom-up), clear of the text/clock block the display
// shader dims — the dimming is a safety net for drags and clicks, not where
// the idle light spends most of its life.
const EMIT_MAIN = { cx: 0.36, cy: 0.62, rx: 0.15, ry: 0.11, wx: 0.55, wy: 0.71, px: 0.0, py: 1.7 }
const EMIT_OPPOSITE = { cx: 0.70, cy: 0.66, rx: 0.14, ry: 0.12, wx: 0.47, wy: 0.63, px: 2.2, py: 0.4 }
const MAIN_AMT = 1.0
const OPPOSITE_AMT = 0.4

// Adaptive-resolution throttle. See the pacing block in loop() for why this
// reads rAF timestamp intervals rather than JS time around the frame.
const PACE_WARMUP_MS = 2000 // ignore this long after start()/resume: shader compile + first-alloc cost, not steady state
const PACE_WINDOW = 24 // frames per judgement: ~0.4s at 60Hz, still well under a second at 30Hz
const PACE_RATIO = 1.4 // median more than 40% slower than the fastest frame seen ⇒ really throttled, not display cadence
const MIN_SCALE = 0.35
const SCALE_STEP = 0.12

/** `rgb(r g b)` from a 0..1 triplet — the poster's tint custom properties are
 *  full colours now (see hero-liquid.css), not the lab's "r,g,b" triplets. */
function toCssColor(c: Rgb): string {
  return `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`
}

// Dev-only screenshot hook: pins the render/sim scale so a grab under a
// software renderer shows real-GPU quality instead of whatever the adaptive
// throttle settles on. Gated on a build-time constant, so it compiles out of
// production entirely.
function scaleOverride(): number | null {
  if (!import.meta.env.DEV) return null
  const m = /[?&]scale=([0-9.]+)/.exec(location.search)
  if (!m) return null
  const v = Number.parseFloat(m[1])
  return Number.isFinite(v) && v > 0 && v <= 2 ? v : null
}

// ---- Shaders. Plain GLSL ES 1.00: compiles under both a WebGL1 and a
// WebGL2 context (WebGL2 accepts #version-less shaders as ES 1.00). ----
const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`

const FRAG: Record<string, string> = {
  splat: `
precision highp float; varying vec2 vUv;
uniform sampler2D uTarget; uniform float aspect;
uniform vec2 point; uniform vec3 color; uniform float radius;
void main(){
  vec2 p = vUv - point; p.x *= aspect;
  float d = exp(-dot(p,p)/max(radius,1e-5));
  vec3 base = texture2D(uTarget, vUv).xyz;
  gl_FragColor = vec4(base + color*d, 1.0);
}`,
  advect: `
precision highp float; varying vec2 vUv;
uniform sampler2D uVelocity; uniform sampler2D uSource;
uniform vec2 texelSize; uniform float dt; uniform float dissipation; uniform float edgeK;
void main(){
  vec2 vel = texture2D(uVelocity, vUv).xy;
  vec2 coord = vUv - dt*vel*texelSize;
  vec2 e2 = smoothstep(0.0, 0.07, vUv)*smoothstep(0.0, 0.07, 1.0-vUv);
  gl_FragColor = dissipation*exp(-edgeK*(1.0-e2.x*e2.y))*texture2D(uSource, coord);
}`,
  divergence: `
precision highp float; varying vec2 vUv;
uniform sampler2D uVelocity; uniform vec2 texelSize;
void main(){
  float L = texture2D(uVelocity, vUv-vec2(texelSize.x,0.0)).x;
  float R = texture2D(uVelocity, vUv+vec2(texelSize.x,0.0)).x;
  float B = texture2D(uVelocity, vUv-vec2(0.0,texelSize.y)).y;
  float T = texture2D(uVelocity, vUv+vec2(0.0,texelSize.y)).y;
  gl_FragColor = vec4(0.5*(R-L+T-B),0.0,0.0,1.0);
}`,
  curl: `
precision highp float; varying vec2 vUv;
uniform sampler2D uVelocity; uniform vec2 texelSize;
void main(){
  float L = texture2D(uVelocity, vUv-vec2(texelSize.x,0.0)).y;
  float R = texture2D(uVelocity, vUv+vec2(texelSize.x,0.0)).y;
  float B = texture2D(uVelocity, vUv-vec2(0.0,texelSize.y)).x;
  float T = texture2D(uVelocity, vUv+vec2(0.0,texelSize.y)).x;
  gl_FragColor = vec4(0.5*((R-L)-(T-B)),0.0,0.0,1.0);
}`,
  vorticity: `
precision highp float; varying vec2 vUv;
uniform sampler2D uVelocity; uniform sampler2D uCurl;
uniform vec2 texelSize; uniform float curlStrength; uniform float dt;
void main(){
  float L = texture2D(uCurl, vUv-vec2(texelSize.x,0.0)).x;
  float R = texture2D(uCurl, vUv+vec2(texelSize.x,0.0)).x;
  float B = texture2D(uCurl, vUv-vec2(0.0,texelSize.y)).x;
  float T = texture2D(uCurl, vUv+vec2(0.0,texelSize.y)).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5*vec2(abs(T)-abs(B), abs(R)-abs(L));
  force /= (length(force)+1e-4);
  force *= curlStrength*C; force.y *= -1.0;
  vec2 vel = texture2D(uVelocity, vUv).xy + force*dt;
  gl_FragColor = vec4(vel,0.0,1.0);
}`,
  pressure: `
precision highp float; varying vec2 vUv;
uniform sampler2D uPressure; uniform sampler2D uDivergence;
uniform vec2 texelSize;
void main(){
  float L = texture2D(uPressure, vUv-vec2(texelSize.x,0.0)).x;
  float R = texture2D(uPressure, vUv+vec2(texelSize.x,0.0)).x;
  float B = texture2D(uPressure, vUv-vec2(0.0,texelSize.y)).x;
  float T = texture2D(uPressure, vUv+vec2(0.0,texelSize.y)).x;
  float div = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((L+R+B+T-div)*0.25,0.0,0.0,1.0);
}`,
  gradient: `
precision highp float; varying vec2 vUv;
uniform sampler2D uPressure; uniform sampler2D uVelocity;
uniform vec2 texelSize;
void main(){
  float L = texture2D(uPressure, vUv-vec2(texelSize.x,0.0)).x;
  float R = texture2D(uPressure, vUv+vec2(texelSize.x,0.0)).x;
  float B = texture2D(uPressure, vUv-vec2(0.0,texelSize.y)).x;
  float T = texture2D(uPressure, vUv+vec2(0.0,texelSize.y)).x;
  vec2 vel = texture2D(uVelocity, vUv).xy - vec2(R-L,T-B)*0.5;
  gl_FragColor = vec4(vel,0.0,1.0);
}`,
  clear: `
precision highp float; varying vec2 vUv;
uniform sampler2D uTexture; uniform float value;
void main(){ gl_FragColor = value*texture2D(uTexture, vUv); }`,
  copy: `
precision highp float; varying vec2 vUv;
uniform sampler2D uTexture;
void main(){ gl_FragColor = texture2D(uTexture, vUv); }`,
  threshold: `
precision highp float; varying vec2 vUv;
uniform sampler2D uTexture; uniform float thresh;
uniform float uTwo; uniform vec3 uColA; uniform vec3 uColB;
void main(){
  vec3 c = texture2D(uTexture, vUv).rgb;
  if (uTwo > 0.5) c = c.r*uColA + c.g*uColB;
  float l = max(c.r,max(c.g,c.b));
  gl_FragColor = vec4(c*smoothstep(thresh, thresh+0.45, l)*0.85, 1.0);
}`,
  blur: `
precision highp float; varying vec2 vUv;
uniform sampler2D uTexture; uniform vec2 texelSize; uniform vec2 dir;
void main(){
  vec2 o1 = dir*texelSize*1.3846153846; vec2 o2 = dir*texelSize*3.2307692308;
  vec4 s = texture2D(uTexture, vUv)*0.2270270270;
  s += texture2D(uTexture, vUv+o1)*0.3162162162; s += texture2D(uTexture, vUv-o1)*0.3162162162;
  s += texture2D(uTexture, vUv+o2)*0.0702702703; s += texture2D(uTexture, vUv-o2)*0.0702702703;
  gl_FragColor = s;
}`,
  // MANUAL_FILTER is defined by createGL() only on devices without hardware
  // linear filtering of the dye's half-float texture (see setupPrograms):
  // dyeBilinear reconstructs it by hand from four NEAREST taps. Where linear
  // filtering IS supported, a single texture2D call does the same job on the
  // GPU for free, so that branch is what ships everywhere else.
  display: `
precision highp float; varying vec2 vUv;
uniform sampler2D uDye; uniform sampler2D uBloom; uniform vec2 texelDye;
uniform float time; uniform float grainAmt; uniform float dayness;
uniform float expo; uniform float shade; uniform float core; uniform float toe; uniform float bst;
uniform vec4 uBox; uniform vec3 uBands; uniform vec2 uRes; uniform float uFeather;
uniform float uTwo; uniform vec3 uColA; uniform vec3 uColB;
float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
#ifdef MANUAL_FILTER
vec3 dyeBilinear(vec2 uv){
  vec2 g = uv/texelDye - 0.5;
  vec2 f = fract(g);
  vec2 base = (floor(g)+0.5)*texelDye;
  vec3 c00 = texture2D(uDye, base).rgb;
  vec3 c10 = texture2D(uDye, base+vec2(texelDye.x,0.0)).rgb;
  vec3 c01 = texture2D(uDye, base+vec2(0.0,texelDye.y)).rgb;
  vec3 c11 = texture2D(uDye, base+texelDye).rgb;
  return mix(mix(c00,c10,f.x), mix(c01,c11,f.x), f.y);
}
#endif
void main(){
#ifdef MANUAL_FILTER
  vec3 raw = max(dyeBilinear(vUv), 0.0);
#else
  vec3 raw = max(texture2D(uDye, vUv).rgb, 0.0);
#endif
  if (uTwo > 0.5) raw = raw.r*uColA + raw.g*uColB;
  if (shade > 0.0) {
    float dL = length(texture2D(uDye, vUv-vec2(texelDye.x,0.0)).rgb);
    float dR = length(texture2D(uDye, vUv+vec2(texelDye.x,0.0)).rgb);
    float dB = length(texture2D(uDye, vUv-vec2(0.0,texelDye.y)).rgb);
    float dT = length(texture2D(uDye, vUv+vec2(0.0,texelDye.y)).rgb);
    vec3 nrm = normalize(vec3(dR-dL, dT-dB, length(texelDye)));
    raw *= mix(1.0, clamp(nrm.z + 0.7, 0.7, 1.0), shade);
  }
  vec3 bloom = max(texture2D(uBloom, vUv).rgb, 0.0);
  vec3 hdr = raw + bloom*bst;
  float m = max(hdr.r, max(hdr.g, hdr.b));
  float mm = max(m, 1e-5);
  float m2 = 1.0 - exp(-mm*expo);
  vec3 mapped = hdr * (m2/mm);
  float luma = dot(mapped, vec3(0.299,0.587,0.114));
  mapped = clamp(luma + (mapped-luma)*1.22, 0.0, 1.0);
  mapped = mix(mapped, vec3(1.0), smoothstep(0.9, 2.8, m)*core*0.5);
  mapped *= smoothstep(toe, toe*3.0+0.001, m);
  vec2 px = vUv*uRes;
  vec2 bc = 0.5*(uBox.xy+uBox.zw), bh = 0.5*(uBox.zw-uBox.xy);
  float boxM = 1.0-smoothstep(0.0, uFeather, length(max(abs(px-bc)-bh, 0.0)));
  float botM = 1.0-smoothstep(uBands.x, uBands.x+0.6*uFeather, px.y);
  float topM = smoothstep(uBands.y-1.2*uFeather, uBands.y, px.y);
  mapped *= mix(1.0, uBands.z, max(boxM, max(botM, topM)));
  float n = hash(vUv*vec2(800.0,800.0)+time*13.0);
  mapped += (n-0.5)*grainAmt;
  vec3 bgNight = vec3(0.0118,0.0157,0.0314);
  vec3 bgDay = vec3(0.0275,0.0314,0.0392);
  vec3 bg = mix(bgNight, bgDay, clamp(dayness,0.0,1.0));
  gl_FragColor = vec4(clamp(bg+mapped,0.0,1.0), 1.0);
}`,
}

type GlCtx = WebGLRenderingContext | WebGL2RenderingContext

interface Program {
  program: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
}

interface Fbo {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  w: number
  h: number
}

interface DoubleFbo {
  w: number
  h: number
  readonly read: Fbo
  readonly write: Fbo
  swap(): void
}

interface GlInfo {
  ctx: GlCtx
  isWebGL2: boolean
  texType: number
  internalFormat: number
  format: number
  supportsLinear: boolean
  programs: Record<string, Program>
}

interface Sim {
  gl: GlCtx
  simW: number
  simH: number
  dyeW: number
  dyeH: number
  pressureIters: number
  bloomW: number
  bloomH: number
  texelSim: readonly [number, number]
  velScale: number
  velocity: DoubleFbo
  dye: DoubleFbo
  divergence: Fbo
  curl: Fbo
  pressure: DoubleFbo
  bloomA: Fbo
  bloomB: Fbo
  programs: Record<string, Program>
  scale: number
}

function compileShader(gl: GlCtx, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)
  if (!s) throw new Error('liquid: could not create shader')
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s)
    gl.deleteShader(s)
    throw new Error(`liquid: shader error ${info}`)
  }
  return s
}

function createProgram(gl: GlCtx, vertSrc: string, fragSrc: string): Program {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc)
  const p = gl.createProgram()
  if (!p) throw new Error('liquid: could not create program')
  gl.attachShader(p, vs)
  gl.attachShader(p, fs)
  gl.bindAttribLocation(p, 0, 'aPos')
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`liquid: link error ${gl.getProgramInfoLog(p)}`)
  }
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  const uniforms: Record<string, WebGLUniformLocation | null> = {}
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number
  for (let i = 0; i < n; i += 1) {
    const info = gl.getActiveUniform(p, i)
    if (info) uniforms[info.name] = gl.getUniformLocation(p, info.name)
  }
  return { program: p, uniforms }
}

function bindTarget(gl: GlCtx, t: Fbo | null): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null)
  gl.viewport(0, 0, t ? t.w : gl.drawingBufferWidth, t ? t.h : gl.drawingBufferHeight)
}

// Replaces the lab's runProgram(gl, prog, setUniforms, target): that took a
// closure allocated fresh at every call site, dozens of times a frame. Every
// caller below binds, sets its own uniforms with plain gl.uniform*() calls,
// then draws — no closure anywhere on the per-frame path.
function beginPass(gl: GlCtx, prog: Program, target: Fbo | null): void {
  bindTarget(gl, target)
  gl.useProgram(prog.program)
}

function draw(gl: GlCtx): void {
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

function bindTex(gl: GlCtx, unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null): void {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  if (loc) gl.uniform1i(loc, unit)
}

function fboWorks(gl: GlCtx, format: number, type: number, internal: number): boolean {
  const tex = gl.createTexture()
  if (!tex) return false
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, format, type, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const fbo = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.deleteTexture(tex)
  gl.deleteFramebuffer(fbo)
  return ok
}

function createGL(canvas: HTMLCanvasElement): GlInfo | null {
  const opts: WebGLContextAttributes = {
    alpha: false, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false,
  }
  let gl: GlCtx | null = null
  let isWebGL2 = false
  let halfFloatExt: OES_texture_half_float | null = null
  let supportsLinear = true
  try { gl = canvas.getContext('webgl2', opts) } catch { gl = null }
  if (gl) {
    isWebGL2 = true
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) gl = null
  }
  if (!gl) {
    isWebGL2 = false
    try { gl = canvas.getContext('webgl', opts) } catch { gl = null }
    if (!gl) return null
    halfFloatExt = gl.getExtension('OES_texture_half_float')
    if (!halfFloatExt) return null
    supportsLinear = !!gl.getExtension('OES_texture_half_float_linear')
    gl.getExtension('OES_texture_float')
  }
  if (!gl) return null
  const isWebGL2Ctx = isWebGL2
  const texType = isWebGL2Ctx ? (gl as WebGL2RenderingContext).HALF_FLOAT : halfFloatExt!.HALF_FLOAT_OES
  const internalFormat = isWebGL2Ctx ? (gl as WebGL2RenderingContext).RGBA16F : gl.RGBA
  const format = gl.RGBA
  if (!fboWorks(gl, format, texType, internalFormat)) return null

  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.STENCIL_TEST)
  gl.disable(gl.BLEND)
  gl.disable(gl.CULL_FACE)
  const quad = gl.createBuffer()
  if (!quad) return null
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  // The display shader needs the manual bilinear tap only where the hardware
  // cannot filter the dye texture itself (see the FRAG.display comment).
  const programs: Record<string, Program> = {}
  try {
    for (const key of Object.keys(FRAG)) {
      const src = key === 'display' && !supportsLinear ? `#define MANUAL_FILTER\n${FRAG[key]}` : FRAG[key]
      programs[key] = createProgram(gl, VERT, src)
    }
  } catch {
    return null
  }

  return { ctx: gl, isWebGL2, texType, internalFormat, format, supportsLinear, programs }
}

function createFBO(glInfo: GlInfo, w: number, h: number, filter: number): Fbo {
  const gl = glInfo.ctx
  const tex = gl.createTexture()
  if (!tex) throw new Error('liquid: could not create texture')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, glInfo.internalFormat, w, h, 0, glInfo.format, glInfo.texType, null)
  const fbo = gl.createFramebuffer()
  if (!fbo) throw new Error('liquid: could not create framebuffer')
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.viewport(0, 0, w, h)
  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { tex, fbo, w, h }
}

function createDouble(glInfo: GlInfo, w: number, h: number, filter: number): DoubleFbo {
  let a = createFBO(glInfo, w, h, filter)
  let b = createFBO(glInfo, w, h, filter)
  return {
    w, h,
    get read() { return a },
    get write() { return b },
    swap() { const t = a; a = b; b = t },
  }
}

function createSim(glInfo: GlInfo, simW: number, simH: number, dyeW: number, dyeH: number, pressureIters: number, scale: number): Sim {
  const gl = glInfo.ctx
  const filter = glInfo.supportsLinear === false ? gl.NEAREST : gl.LINEAR
  const bloomW = Math.max(2, Math.round(dyeW / 4))
  const bloomH = Math.max(2, Math.round(dyeH / 4))
  return {
    gl,
    simW, simH, dyeW, dyeH,
    pressureIters,
    bloomW, bloomH,
    texelSim: [1 / simW, 1 / simH],
    // Velocity is stored in sim-grid TEXELS/second (advect multiplies by
    // texelSim to get a UV displacement), so any caller starting from a
    // UV-space speed or delta must scale up by roughly this many texels per
    // UV unit, or the injected "velocity" is too small to move anything.
    velScale: (simW + simH) * 0.5,
    velocity: createDouble(glInfo, simW, simH, filter),
    dye: createDouble(glInfo, dyeW, dyeH, filter),
    divergence: createFBO(glInfo, simW, simH, gl.NEAREST),
    curl: createFBO(glInfo, simW, simH, gl.NEAREST),
    pressure: createDouble(glInfo, simW, simH, gl.NEAREST),
    bloomA: createFBO(glInfo, bloomW, bloomH, filter),
    bloomB: createFBO(glInfo, bloomW, bloomH, filter),
    programs: glInfo.programs,
    scale,
  }
}

function destroySim(sim: Sim | null): void {
  if (!sim) return
  const gl = sim.gl
  const kill = (t: Fbo): void => { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
  const killD = (d: DoubleFbo): void => { kill(d.read); kill(d.write) }
  killD(sim.velocity)
  killD(sim.dye)
  killD(sim.pressure)
  kill(sim.divergence)
  kill(sim.curl)
  kill(sim.bloomA)
  kill(sim.bloomB)
  // Does NOT lose the GL context — this also runs on a plain resize.
  // destroy() does that once, after this.
}

// x,y are GL UV (origin bottom-left, y up) — callers flip DOM y first.
function splat(sim: Sim, x: number, y: number, dx: number, dy: number, r: number, g: number, b: number, radius: number): void {
  const gl = sim.gl
  const prog = sim.programs.splat
  const aspect = sim.simW / sim.simH

  beginPass(gl, prog, sim.velocity.write)
  bindTex(gl, 0, sim.velocity.read.tex, prog.uniforms.uTarget)
  gl.uniform1f(prog.uniforms.aspect, aspect)
  gl.uniform2f(prog.uniforms.point, x, y)
  gl.uniform3f(prog.uniforms.color, dx, dy, 0.0)
  gl.uniform1f(prog.uniforms.radius, radius)
  draw(gl)
  sim.velocity.swap()

  beginPass(gl, prog, sim.dye.write)
  bindTex(gl, 0, sim.dye.read.tex, prog.uniforms.uTarget)
  gl.uniform1f(prog.uniforms.aspect, aspect)
  gl.uniform2f(prog.uniforms.point, x, y)
  gl.uniform3f(prog.uniforms.color, r, g, b)
  gl.uniform1f(prog.uniforms.radius, radius)
  draw(gl)
  sim.dye.swap()
}

interface Look { two: number; a: Rgb; b: Rgb }

function setLook(gl: GlCtx, u: Record<string, WebGLUniformLocation | null>, look: Look): void {
  gl.uniform1f(u.uTwo, look.two)
  gl.uniform3f(u.uColA, look.a[0], look.a[1], look.a[2])
  gl.uniform3f(u.uColB, look.b[0], look.b[1], look.b[2])
}

// Stam's stable-fluids steps. Velocity/pressure/divergence/curl live on the
// small sim grid in texel units (grid spacing = 1); dye is advected by the
// same field at its own, larger resolution using the SIM grid's texel size
// to convert velocity into a UV displacement, since that is the grid the
// velocity values are defined on.
function stepSim(sim: Sim, dtIn: number): void {
  const dt = Math.min(Math.max(dtIn, 0.0001), 1 / 30)
  const gl = sim.gl
  const p = sim.programs
  const ts0 = sim.texelSim[0]
  const ts1 = sim.texelSim[1]
  const velMul = Math.exp(-TUNE.vd * dt) // momentum settles in ~1-2s
  const dyeMul = Math.exp(-TUNE.dd * dt) // ink lingers ~6-10s (10% left at 8s)

  beginPass(gl, p.curl, sim.curl)
  bindTex(gl, 0, sim.velocity.read.tex, p.curl.uniforms.uVelocity)
  gl.uniform2f(p.curl.uniforms.texelSize, ts0, ts1)
  draw(gl)

  beginPass(gl, p.vorticity, sim.velocity.write)
  bindTex(gl, 0, sim.velocity.read.tex, p.vorticity.uniforms.uVelocity)
  bindTex(gl, 1, sim.curl.tex, p.vorticity.uniforms.uCurl)
  gl.uniform2f(p.vorticity.uniforms.texelSize, ts0, ts1)
  gl.uniform1f(p.vorticity.uniforms.curlStrength, TUNE.curl)
  gl.uniform1f(p.vorticity.uniforms.dt, dt)
  draw(gl)
  sim.velocity.swap()

  beginPass(gl, p.divergence, sim.divergence)
  bindTex(gl, 0, sim.velocity.read.tex, p.divergence.uniforms.uVelocity)
  gl.uniform2f(p.divergence.uniforms.texelSize, ts0, ts1)
  draw(gl)

  beginPass(gl, p.clear, sim.pressure.write)
  bindTex(gl, 0, sim.pressure.read.tex, p.clear.uniforms.uTexture)
  gl.uniform1f(p.clear.uniforms.value, 0.78)
  draw(gl)
  sim.pressure.swap()

  for (let i = 0; i < sim.pressureIters; i += 1) {
    beginPass(gl, p.pressure, sim.pressure.write)
    bindTex(gl, 0, sim.pressure.read.tex, p.pressure.uniforms.uPressure)
    bindTex(gl, 1, sim.divergence.tex, p.pressure.uniforms.uDivergence)
    gl.uniform2f(p.pressure.uniforms.texelSize, ts0, ts1)
    draw(gl)
    sim.pressure.swap()
  }

  beginPass(gl, p.gradient, sim.velocity.write)
  bindTex(gl, 0, sim.pressure.read.tex, p.gradient.uniforms.uPressure)
  bindTex(gl, 1, sim.velocity.read.tex, p.gradient.uniforms.uVelocity)
  gl.uniform2f(p.gradient.uniforms.texelSize, ts0, ts1)
  draw(gl)
  sim.velocity.swap()

  beginPass(gl, p.advect, sim.velocity.write)
  bindTex(gl, 0, sim.velocity.read.tex, p.advect.uniforms.uVelocity)
  bindTex(gl, 1, sim.velocity.read.tex, p.advect.uniforms.uSource)
  gl.uniform2f(p.advect.uniforms.texelSize, ts0, ts1)
  gl.uniform1f(p.advect.uniforms.dt, dt)
  gl.uniform1f(p.advect.uniforms.dissipation, velMul)
  gl.uniform1f(p.advect.uniforms.edgeK, 0)
  draw(gl)
  sim.velocity.swap()

  beginPass(gl, p.advect, sim.dye.write)
  bindTex(gl, 0, sim.velocity.read.tex, p.advect.uniforms.uVelocity)
  bindTex(gl, 1, sim.dye.read.tex, p.advect.uniforms.uSource)
  gl.uniform2f(p.advect.uniforms.texelSize, ts0, ts1)
  gl.uniform1f(p.advect.uniforms.dt, dt)
  gl.uniform1f(p.advect.uniforms.dissipation, dyeMul)
  gl.uniform1f(p.advect.uniforms.edgeK, 3.0 * dt)
  draw(gl)
  sim.dye.swap()
}

interface Mask {
  x0: number; y0: number; x1: number; y1: number
  bot: number; top: number; w: number; h: number; f: number
}

// Threshold the dye (only genuinely bright cores pass), blur twice
// (separable, downsampled) for a soft halo rather than a tight ring, then
// tone-map + composite straight onto the visible canvas. dayness (0..1) only
// tints the background — the ink's own colour was already fixed when it was
// splatted. The dye texture is re-sampled inside the display shader itself
// (hardware LINEAR, or dyeBilinear under MANUAL_FILTER), so a plume reads
// smooth even when the underlying FBO had to fall back to NEAREST.
function renderSim(sim: Sim, canvasW: number, canvasH: number, grainTime: number, dayness: number, mask: Mask, look: Look): void {
  const gl = sim.gl
  const p = sim.programs

  beginPass(gl, p.threshold, sim.bloomA)
  bindTex(gl, 0, sim.dye.read.tex, p.threshold.uniforms.uTexture)
  gl.uniform1f(p.threshold.uniforms.thresh, TUNE.bth)
  setLook(gl, p.threshold.uniforms, look)
  draw(gl)

  const texelBloom0 = 1 / sim.bloomW
  const texelBloom1 = 1 / sim.bloomH
  let src = sim.bloomA
  let dst = sim.bloomB
  for (let i = 0; i < 2; i += 1) {
    beginPass(gl, p.blur, dst)
    bindTex(gl, 0, src.tex, p.blur.uniforms.uTexture)
    gl.uniform2f(p.blur.uniforms.texelSize, texelBloom0, texelBloom1)
    gl.uniform2f(p.blur.uniforms.dir, 1, 0)
    draw(gl)
    let tmp = src; src = dst; dst = tmp

    beginPass(gl, p.blur, dst)
    bindTex(gl, 0, src.tex, p.blur.uniforms.uTexture)
    gl.uniform2f(p.blur.uniforms.texelSize, texelBloom0, texelBloom1)
    gl.uniform2f(p.blur.uniforms.dir, 0, 1)
    draw(gl)
    tmp = src; src = dst; dst = tmp
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, canvasW, canvasH)
  gl.useProgram(p.display.program)
  bindTex(gl, 0, sim.dye.read.tex, p.display.uniforms.uDye)
  bindTex(gl, 1, src.tex, p.display.uniforms.uBloom)
  gl.uniform2f(p.display.uniforms.texelDye, 1 / sim.dyeW, 1 / sim.dyeH)
  gl.uniform1f(p.display.uniforms.time, grainTime || 0)
  gl.uniform1f(p.display.uniforms.grainAmt, 0.012)
  gl.uniform1f(p.display.uniforms.dayness, dayness)
  gl.uniform1f(p.display.uniforms.expo, TUNE.expo)
  gl.uniform1f(p.display.uniforms.shade, TUNE.shade)
  gl.uniform1f(p.display.uniforms.core, TUNE.core)
  gl.uniform1f(p.display.uniforms.toe, TUNE.toe)
  gl.uniform1f(p.display.uniforms.bst, TUNE.bst)
  gl.uniform4f(p.display.uniforms.uBox, mask.x0, mask.y0, mask.x1, mask.y1)
  gl.uniform3f(p.display.uniforms.uBands, mask.bot, mask.top, 0.3)
  gl.uniform2f(p.display.uniforms.uRes, mask.w, mask.h)
  gl.uniform1f(p.display.uniforms.uFeather, mask.f)
  setLook(gl, p.display.uniforms, look)
  draw(gl)
}

interface State {
  running: boolean
  gl: GlCtx | null
  sim: Sim | null
  inited: boolean
  w: number
  h: number
  dpr: number
  scale: number
  scaleLocked: boolean
  raf: number
  lastRafT: number
  lastInput: number
  destroyed: boolean
  simTime: number
  // Eased 0..1 day/night mix the frame is actually drawn at; chases the
  // clock's own dayness() over ~0.4s instead of snapping to it.
  dayness: number
  idleStrength: number
  idleAccum: number
  activePointer: number | null
  dragLast: [number, number]
  lastSplatPos: [number, number]
  lastSplatT: number
  dragMoved: number
  // Adaptive-resolution pacing (see loop()).
  paceWarmupUntil: number
  paceFastest: number
  paceCount: number
}

export const create: HeroCreate = (host, env) => {
  const doc = host.ownerDocument
  const canvas = doc.createElement('canvas')
  canvas.dataset.part = 'canvas'
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', 'Liquid light: a live fluid simulation of glowing ink in the colours of the current hour in India.')
  const poster = doc.createElement('div')
  poster.dataset.part = 'poster'
  poster.hidden = true
  host.append(canvas, poster)

  const reduced = env.reduced
  let glInfo: GlInfo | null = null

  const scaleOv = scaleOverride()
  const state: State = {
    running: false,
    gl: null,
    sim: null,
    inited: false,
    w: 0, h: 0,
    dpr: clamp(env.dpr || 1, 1, 2),
    scale: scaleOv ?? (env.lowPower ? 0.5 : 0.85),
    scaleLocked: scaleOv !== null,
    raf: 0,
    lastRafT: 0,
    lastInput: -1e9,
    destroyed: false,
    simTime: 0,
    dayness: 1,
    idleStrength: 0,
    idleAccum: 0,
    activePointer: null,
    dragLast: [0, 0],
    lastSplatPos: [0, 0],
    lastSplatT: 0,
    dragMoved: 0,
    paceWarmupUntil: 0,
    paceFastest: Infinity,
    paceCount: 0,
  }

  // The no-WebGL poster has no simulation to read a colour from, so it is
  // tinted straight from the same hour colour the ink itself uses: the main
  // hour's colour plus its opposite. Ink is the hour's colour pushed away
  // from its own grey, so a pale key such as the noon cream still glows as
  // gold once it is light on black. Both reuse a scratch array: nothing here
  // runs every frame, but there is no reason to allocate on every scrub either.
  const inkScratch: Rgb = [0, 0, 0]
  const tintScratch: Rgb = [0, 0, 0]

  // `out` defaults to the shared scratch for a call whose result is used
  // once and discarded (a splat, a burst); the reduced-motion still frame
  // needs two ink colours alive at once, so it passes its own targets.
  function inkColor(min: number, out: Rgb = inkScratch): Rgb {
    hourColor(min, out)
    const l = 0.299 * out[0] + 0.587 * out[1] + 0.114 * out[2]
    out[0] = clamp(l + (out[0] - l) * TUNE.sat, 0, 1)
    out[1] = clamp(l + (out[1] - l) * TUNE.sat, 0, 1)
    out[2] = clamp(l + (out[2] - l) * TUNE.sat, 0, 1)
    return out
  }

  function updatePosterTint(minutes: number): void {
    poster.style.setProperty('--lq-c1', toCssColor(hourColor(minutes, tintScratch)))
    poster.style.setProperty('--lq-c2', toCssColor(hourColor(minutes + 720, tintScratch)))
  }

  // Reduced motion never runs the loop that would otherwise chase the clock,
  // so a scrub has to redraw the still frame itself, right here. The poster
  // tint updates on every scrub regardless of reduced motion, since a device
  // can land in the no-WebGL fallback independently of it.
  function handleClockChange(minutes: number): void {
    updatePosterTint(minutes)
    if (reduced) {
      state.dayness = dayness(minutes)
      renderReducedFrame(false)
    }
  }
  const clock = createClock(host, env, handleClockChange)
  state.dayness = clock.dayness()
  updatePosterTint(clock.minutes())

  // Ink under the name/tagline/links, under the clock strip and under the
  // header band is dimmed, so the text keeps its contrast whatever the fluid
  // does. The rects are read from the live layout (text extents via Range,
  // not block boxes), so the mask follows the words across breakpoints and
  // font loads — env.text is server-rendered, this module never draws its
  // own copy of it.
  const mask: Mask = { x0: 0, y0: 0, x1: 0, y1: 0, bot: 0, top: 1e4, w: 1, h: 1, f: 100 }

  function textRect(el: HTMLElement): DOMRect {
    const r = document.createRange()
    r.selectNodeContents(el)
    return r.getBoundingClientRect()
  }

  function updateMask(): void {
    const cr = canvas.getBoundingClientRect()
    if (!cr.width || !cr.height) return
    const pad = 18
    const a = textRect(env.text.name)
    const b = textRect(env.text.tagline)
    let left = Math.min(a.left, b.left)
    let right = Math.max(a.right, b.right)
    let top = Math.min(a.top, b.top)
    let bottom = Math.max(a.bottom, b.bottom)
    if (env.text.links) {
      const c = textRect(env.text.links)
      left = Math.min(left, c.left)
      right = Math.max(right, c.right)
      top = Math.min(top, c.top)
      bottom = Math.max(bottom, c.bottom)
    }
    mask.w = cr.width
    mask.h = cr.height
    mask.x0 = left - pad - cr.left
    mask.x1 = right + pad - cr.left
    mask.y0 = cr.bottom - bottom - pad
    mask.y1 = cr.bottom - top + pad
    mask.bot = cr.bottom - clock.el.getBoundingClientRect().top + 8
    const navH = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 64
    mask.top = cr.height - navH
    mask.f = clamp(0.12 * Math.max(cr.width, cr.height), 60, 150)
  }

  document.fonts?.ready.then(() => {
    if (state.destroyed) return
    updateMask()
    if (reduced) renderReducedFrame(false)
  })
  // Remeasure whenever the text block's own size changes (a font finishing
  // load after document.fonts.ready already fired, a width breakpoint).
  const contentObserver = new ResizeObserver(() => {
    updateMask()
    if (reduced) renderReducedFrame(false)
  })
  contentObserver.observe(env.text.content)

  function fallbackToPoster(): void {
    canvas.hidden = true
    poster.hidden = false
  }

  // ---- Pointer input: drag stirs, a tap/click drops a big ink burst. ----
  function toUV(clientX: number, clientY: number): [number, number] {
    const r = canvas.getBoundingClientRect()
    const x = r.width ? (clientX - r.left) / r.width : 0.5
    const y = r.height ? 1 - (clientY - r.top) / r.height : 0.5
    return [clamp(x, 0, 1), clamp(y, 0, 1)]
  }
  function onPointerDown(e: PointerEvent): void {
    if (state.activePointer !== null || !state.sim) return
    state.activePointer = e.pointerId
    try { canvas.setPointerCapture(e.pointerId) } catch { /* capture is best-effort */ }
    const uv = toUV(e.clientX, e.clientY)
    state.dragLast[0] = uv[0]; state.dragLast[1] = uv[1]
    state.lastSplatPos[0] = uv[0]; state.lastSplatPos[1] = uv[1]
    state.dragMoved = 0
    state.lastInput = performance.now()
    state.lastSplatT = state.lastInput
  }
  // Splats are sampled by DISTANCE moved, not by move-event count: a fast
  // synthetic or high-poll-rate drag otherwise fires many overlapping splats
  // over a short path and smears into one flat, blown-out stripe instead of
  // a stretched filament. dragMoved (tap-vs-drag) still tracks every event
  // so that distinction stays accurate.
  function onPointerMove(e: PointerEvent): void {
    if (state.activePointer !== e.pointerId || !state.sim) return
    const uv = toUV(e.clientX, e.clientY)
    const dx = uv[0] - state.dragLast[0]
    const dy = uv[1] - state.dragLast[1]
    state.dragMoved += Math.abs(dx) + Math.abs(dy)
    state.dragLast[0] = uv[0]; state.dragLast[1] = uv[1]
    state.lastInput = performance.now()
    const sdx = uv[0] - state.lastSplatPos[0]
    const sdy = uv[1] - state.lastSplatPos[1]
    const moved = Math.sqrt(sdx * sdx + sdy * sdy)
    if (moved < 0.008) return
    const now = performance.now()
    const dtp = Math.max(0.008, (now - state.lastSplatT) / 1000)
    state.lastSplatT = now
    state.lastSplatPos[0] = uv[0]; state.lastSplatPos[1] = uv[1]
    // The push follows the pointer's real speed (UV/s, capped), converted to
    // sim texels/s, so a swipe throws a ribbon of light and a slow drag
    // leaves a thin trail instead of a fat stroke of paint.
    const vs = state.sim.velScale * 0.6
    const k = TUNE.pink
    const c = inkColor(clock.minutes())
    splat(state.sim, uv[0], uv[1], clamp(sdx / dtp, -3, 3) * vs, clamp(sdy / dtp, -3, 3) * vs, c[0] * k, c[1] * k, c[2] * k, TUNE.dr)
  }
  function onPointerUp(e: PointerEvent): void {
    if (state.activePointer !== e.pointerId) return
    state.activePointer = null
    state.lastInput = performance.now()
    // A tap bursts: six small jets of ink shoot outward from the point and
    // merge into a ring of colour that opens as it drifts. A cancelled
    // pointer (the page began to scroll) is not a tap.
    if (state.sim && e.type === 'pointerup' && state.dragMoved < 0.025) {
      const uv = state.dragLast
      const c = inkColor(clock.minutes())
      const k = TUNE.pink * 1.6
      const vs = state.sim.velScale * TUNE.pv
      const asp = state.sim.simW / state.sim.simH
      for (let i = 0; i < 6; i += 1) {
        const a = i * Math.PI / 3 + 0.3
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        splat(state.sim, uv[0] + ca * TUNE.po / asp, uv[1] + sa * TUNE.po, ca * vs, sa * vs, c[0] * k, c[1] * k, c[2] * k, TUNE.pr)
      }
    }
    try { canvas.releasePointerCapture(e.pointerId) } catch { /* best-effort */ }
  }
  canvas.addEventListener('pointerdown', onPointerDown, { signal: env.signal })
  canvas.addEventListener('pointermove', onPointerMove, { signal: env.signal })
  canvas.addEventListener('pointerup', onPointerUp, { signal: env.signal })
  canvas.addEventListener('pointercancel', onPointerUp, { signal: env.signal })

  // Fewer Jacobi iterations on env.lowPower: the pressure solve is the
  // costliest step (one full pass per iteration at sim resolution), and a
  // touch/low-core device already runs a smaller sim grid too.
  const pressureIters = env.lowPower ? 14 : 20

  function computeSimDims(w: number, h: number): { simW: number; simH: number; dyeW: number; dyeH: number } {
    const longRatio = Math.max(w, h) / Math.max(1, Math.min(w, h))
    // A slightly finer velocity grid softens the large-scale plume
    // silhouette: vorticity confinement reads curl off this grid, so its
    // resolution is what made blob edges look faceted rather than any
    // texture-sampling issue.
    const simShort = clamp(Math.round(200 * state.scale), 110, 216)
    const simW = w >= h ? Math.round(simShort * longRatio) : simShort
    const simH = w >= h ? simShort : Math.round(simShort * longRatio)
    // Dye targets the LONG side: about 1570 at the default desktop scale
    // (0.85), up to 1920 at the ?scale= dev hook's max, 512 flat when
    // lowPower. Not floored unconditionally — genuine adaptive throttling
    // (state.scale -> 0.35) is still allowed to shrink it.
    const dyeLong = env.lowPower ? 512 : clamp(Math.round(1850 * state.scale), 640, 1920)
    const dyeShort = Math.max(2, Math.round(dyeLong / longRatio))
    const dyeW = w >= h ? dyeLong : dyeShort
    const dyeH = w >= h ? dyeShort : dyeLong
    return { simW, simH, dyeW, dyeH }
  }

  function setup(w: number, h: number): void {
    state.w = w; state.h = h
    const gl = createGL(canvas)
    if (!gl) { fallbackToPoster(); state.inited = true; return }
    glInfo = gl
    state.gl = gl.ctx
    const d = computeSimDims(w, h)
    state.sim = createSim(gl, d.simW, d.simH, d.dyeW, d.dyeH, pressureIters, state.scale)
    state.inited = true
  }

  function doResize(w: number, h: number): void {
    w = Math.max(1, w); h = Math.max(1, h)
    const dpr = state.dpr * state.scale
    canvas.width = Math.max(1, Math.round(w * dpr))
    canvas.height = Math.max(1, Math.round(h * dpr))
    if (!state.inited) {
      setup(w, h)
    } else {
      state.w = w; state.h = h
      if (state.sim && glInfo) {
        const d = computeSimDims(w, h)
        const old = state.sim
        const aOld = old.simW / old.simH
        const aNew = d.simW / d.simH
        // A small change of shape (a phone's URL bar showing/hiding) keeps
        // the sim as it is: it lives in UV space, so the canvas just
        // stretches it a little. A real change of shape or of scale builds
        // a new sim and carries the ink and the flow across, never wipes it.
        if (Math.abs(aNew - aOld) > 0.12 * aOld || state.scale !== old.scale) {
          state.sim = createSim(glInfo, d.simW, d.simH, d.dyeW, d.dyeH, pressureIters, state.scale)
          carryOver(old, state.sim)
          destroySim(old)
        }
      }
    }
    updateMask()
    // Setting a canvas's size clears it, and a resize lands after that
    // frame's draw, so redraw now or every URL-bar change blinks black.
    if (reduced) renderReducedFrame(!stillReady)
    else if (state.sim) renderSim(state.sim, canvas.width, canvas.height, state.simTime, state.dayness, mask, LIVE)
  }

  function carryOver(from: Sim, to: Sim): void {
    const gl = to.gl
    const p = to.programs
    beginPass(gl, p.copy, to.dye.write)
    bindTex(gl, 0, from.dye.read.tex, p.copy.uniforms.uTexture)
    draw(gl)
    to.dye.swap()
    // Velocity is stored in sim texels/s, so it rescales with the grid.
    beginPass(gl, p.clear, to.velocity.write)
    bindTex(gl, 0, from.velocity.read.tex, p.clear.uniforms.uTexture)
    gl.uniform1f(p.clear.uniforms.value, to.velScale / from.velScale)
    draw(gl)
    to.velocity.swap()
  }

  // Reduced motion: the idle choreography runs offscreen once, with each
  // emitter's ink kept as an amount in its own channel (main in red,
  // opposite in green). Colour is applied only when drawn, so scrubbing the
  // clock recolours the same still frame at once instead of simulating it
  // again. The frame never animates.
  const LIVE: Look = { two: 0, a: [1, 0, 0], b: [0, 1, 0] }
  const still: Look = { two: 1, a: [1, 0, 0], b: [0, 1, 0] }
  let stillReady = false
  const RED: Rgb = [1, 0, 0]
  const GREEN: Rgb = [0, 1, 0]

  function emitIdle(sim: Sim, e: typeof EMIT_MAIN, amt: number, color: Rgb): void {
    const s = state.simTime
    const x = e.cx + Math.sin(s * e.wx + e.px) * e.rx
    const y = e.cy + Math.sin(s * e.wy + e.py) * e.ry
    // Path derivative is in UV/second; the sim wants texels/second (see
    // sim.velScale) — without this scale-up the injected kick was ~500x too
    // small to move the dye at all, so it just sat at the splat point
    // looking like a static glow instead of streaming into a ribbon.
    const vs = sim.velScale * TUNE.vk
    const dx = Math.cos(s * e.wx + e.px) * e.wx * e.rx * vs
    const dy = Math.cos(s * e.wy + e.py) * e.wy * e.ry * vs
    const k = state.idleStrength * amt
    const ki = k * TUNE.ink
    splat(sim, x, y, dx * k, dy * k, color[0] * ki, color[1] * ki, color[2] * ki, TUNE.rad)
  }

  function renderReducedFrame(resim: boolean): void {
    const sim = state.sim
    if (!sim) return
    if (resim || !stillReady) {
      let acc = 0
      state.simTime = 7
      state.idleStrength = 1
      for (let i = 0; i < 480; i += 1) {
        state.simTime += 1 / 60
        acc += 1 / 60
        if (acc > TUNE.ivl) {
          acc -= TUNE.ivl
          emitIdle(sim, EMIT_MAIN, MAIN_AMT, RED)
          emitIdle(sim, EMIT_OPPOSITE, OPPOSITE_AMT, GREEN)
        }
        stepSim(sim, 1 / 60)
      }
      stillReady = true
    }
    const m = clock.minutes()
    inkColor(m, still.a)
    inkColor(m + 720, still.b)
    renderSim(sim, canvas.width, canvas.height, 1, state.dayness, mask, still)
  }

  function start(): void {
    if (state.destroyed) return
    clock.start()
    if (reduced) return
    if (!state.running && state.sim) {
      state.running = true
      state.lastRafT = 0
      state.raf = requestAnimationFrame(loop)
    }
  }

  function stop(): void {
    state.running = false
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0 }
    clock.stop()
  }

  // Adaptive-resolution pacing. paceSamples is a ring of the last PACE_WINDOW
  // rAF intervals; paceSorted is reused scratch for the median (typed arrays
  // sort in place, so this allocates nothing once the loop is running).
  const paceSamples = new Float32Array(PACE_WINDOW)
  const paceSorted = new Float32Array(PACE_WINDOW)
  function paceMedian(): number {
    paceSorted.set(paceSamples)
    paceSorted.sort()
    const mid = paceSorted.length >> 1
    return paceSorted.length % 2 ? paceSorted[mid] : (paceSorted[mid - 1] + paceSorted[mid]) * 0.5
  }

  function loop(timestamp: number): void {
    if (!state.running) return
    state.raf = requestAnimationFrame(loop)
    const sim = state.sim
    if (!sim) return

    const prevT = state.lastRafT
    state.lastRafT = timestamp
    if (prevT === 0) {
      // First frame since start()/resume: reseed pacing so warmup (shader
      // compile, first texture allocation) never counts against it.
      state.paceWarmupUntil = timestamp + PACE_WARMUP_MS
      state.paceFastest = Infinity
      state.paceCount = 0
    }
    // rawDtRaw is real elapsed time between rAF callbacks, hard-capped only
    // against a genuine stall (e.g. tab resume). Semi-Lagrangian advection
    // has no CFL limit, so instead of shrinking dt we SUBSTEP: however long
    // the real frame took, stepSim() advances by that much, in chunks no
    // larger than ~1/60s each.
    const rawDtRaw = prevT ? Math.min((timestamp - prevT) / 1000, 0.5) : 1 / 60
    // Steps never exceed 1/60s: longer ones let vorticity confinement outrun
    // the damping and sweep the stage empty. A device too slow for four such
    // steps a frame runs the fluid slower rather than unstable, and the idle
    // choreography follows fluid time, not the wall clock.
    const steps = Math.min(4, Math.max(1, Math.round(rawDtRaw * 60)))
    const stepDt = Math.min(rawDtRaw / steps, 1 / 60)
    const rawDt = steps * stepDt
    state.simTime += rawDt

    // Chase the clock's own dayness (it may have jumped, mid-drag) over
    // about 0.4s instead of snapping the palette straight to it.
    state.dayness += (clock.dayness() - state.dayness) * Math.min(1, rawDt / 0.4)

    const targetIdle = (timestamp - state.lastInput) > 4000 ? 1 : 0
    state.idleStrength += (targetIdle - state.idleStrength) * Math.min(1, rawDt * 1.5)
    if (state.idleStrength > 0.02) {
      state.idleAccum += rawDt
      while (state.idleAccum > TUNE.ivl) {
        state.idleAccum -= TUNE.ivl
        const nowMin = clock.minutes()
        emitIdle(sim, EMIT_MAIN, MAIN_AMT, inkColor(nowMin))
        emitIdle(sim, EMIT_OPPOSITE, OPPOSITE_AMT, inkColor(nowMin + 720))
      }
    }

    for (let s = 0; s < steps; s += 1) stepSim(sim, stepDt)
    renderSim(sim, canvas.width, canvas.height, state.simTime, state.dayness, mask, LIVE)

    // Judge the DISPLAY's delivered pacing, not JS time spent submitting
    // this frame's GL calls: that is CPU time, which says nothing on a real
    // GPU and is huge under a software renderer. A recent MEDIAN interval
    // compared to the FASTEST one seen makes this refresh-rate agnostic — a
    // 60Hz, 120Hz or 30Hz screen that keeps up is never throttled, only one
    // whose frames are arriving slower than it is capable of. A scale drop
    // still goes through doResize's carryOver path, so the ink is resampled
    // into the new sim and never wiped.
    if (prevT) {
      const interval = timestamp - prevT
      if (interval > 0) state.paceFastest = Math.min(state.paceFastest, interval)
      if (timestamp >= state.paceWarmupUntil) {
        paceSamples[state.paceCount % PACE_WINDOW] = interval
        state.paceCount += 1
        if (state.paceCount % PACE_WINDOW === 0) {
          const median = paceMedian()
          if (!state.scaleLocked && median > state.paceFastest * PACE_RATIO && state.scale > MIN_SCALE) {
            state.scale = Math.max(MIN_SCALE, state.scale - SCALE_STEP)
            state.paceCount = 0
            doResize(state.w, state.h)
          }
        }
      }
    }
  }

  function destroy(): void {
    state.destroyed = true
    stop()
    clock.destroy()
    contentObserver.disconnect()
    if (state.sim) { destroySim(state.sim); state.sim = null }
    if (state.gl) {
      state.gl.getExtension('WEBGL_lose_context')?.loseContext()
      state.gl = null
    }
    canvas.remove()
    poster.remove()
  }

  return { start, stop, resize: doResize, destroy }
}
