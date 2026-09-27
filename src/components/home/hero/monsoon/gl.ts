/**
 * The WebGL2 plumbing every monsoon pass shares: programs with their uniforms
 * looked up once, render targets, the fullscreen triangle and one texture
 * upload path. The formats a device can render to are decided here, once, so
 * no pass probes extensions of its own.
 *
 * Conventions every pass relies on:
 * - Shader sources are GLSL ES 3.00 bodies WITHOUT `#version` or precision
 *   lines; program() prepends both, then one `#define` line per define.
 * - The default vertex shader draws one triangle covering the viewport and
 *   passes `vUv`: (0,0) is the bottom-left, (1,1) the top-right.
 * - Uploads flip Y, so a canvas's top-left lands at uv (0,1), and never
 *   premultiply: a pass receives exactly the canvas's RGBA.
 */

export type TargetFormat = 'rgba16f' | 'rg16f' | 'r16f' | 'rgba8' | 'r8'

export interface TargetOptions {
  format: TargetFormat
  filter?: 'linear' | 'nearest'
  wrap?: 'clamp' | 'repeat'
}

export interface Target {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  w: number
  h: number
  /** 1 / w, 1 / h. */
  texel: [number, number]
  opts: TargetOptions
}

/** A ping-pong pair: passes read `read`, render into `write`, then swap(). */
export interface DoubleTarget {
  read: Target
  write: Target
  swap(): void
}

export interface Program {
  prog: WebGLProgram
  /** Every active uniform by name. An array uniform is keyed by its bare name
   *  (`uLights`, not `uLights[0]`), and its location addresses element 0. */
  u: Record<string, WebGLUniformLocation>
  use(): void
}

export interface GLKit {
  gl: WebGL2RenderingContext
  /** Half-float render targets work on this device. When false, a 16f target
   *  silently becomes 8-bit: fine for colour, useless for a fluid solver, so
   *  the smoke pass checks this and stays off. */
  floatTargets: boolean
  program(fragment: string, opts?: { vertex?: string; defines?: string[] }): Program
  target(w: number, h: number, opts: TargetOptions): Target
  double(w: number, h: number, opts: TargetOptions): DoubleTarget
  /** Binds a target (or the canvas, for null) and sets the viewport to it. */
  bind(target: Target | null): void
  /** Draws the fullscreen triangle with whatever program is in use. */
  draw(): void
  /** Uploads a canvas or image as an RGBA8 texture. */
  texture(source: TexImageSource, opts?: { mipmap?: boolean; wrap?: 'clamp' | 'repeat' }): WebGLTexture
  /** Replaces a texture's pixels in place (same size or not), regenerating mips if it has them. */
  update(tex: WebGLTexture, source: TexImageSource, mipmap?: boolean): void
  deleteTarget(target: Target | null | undefined): void
  deleteDouble(pair: DoubleTarget | null | undefined): void
  deleteTexture(tex: WebGLTexture | null | undefined): void
  /** Frees every program, texture, target and the VAO this kit created. */
  destroy(): void
}

const FULLSCREEN_VS = `
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

function header(defines: string[] = []): string {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${defines.map(d => `#define ${d}`).join('\n')}
`
}

export function createKit(canvas: HTMLCanvasElement): GLKit | null {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  })
  if (!gl) return null

  const programs = new Set<WebGLProgram>()
  const textures = new Set<WebGLTexture>()
  const framebuffers = new Set<WebGLFramebuffer>()
  const vao = gl.createVertexArray()

  const formats: Record<TargetFormat, [number, number, number]> = {
    rgba16f: [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT],
    rg16f: [gl.RG16F, gl.RG, gl.HALF_FLOAT],
    r16f: [gl.R16F, gl.RED, gl.HALF_FLOAT],
    rgba8: [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE],
    r8: [gl.R8, gl.RED, gl.UNSIGNED_BYTE],
  }

  function compile(type: number, source: string): WebGLShader {
    const shader = gl!.createShader(type)!
    gl!.shaderSource(shader, source)
    gl!.compileShader(shader)
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS) && !gl!.isContextLost()) {
      const log = gl!.getShaderInfoLog(shader)
      gl!.deleteShader(shader)
      throw new Error(`monsoon shader: ${log}`)
    }
    return shader
  }

  function program(fragment: string, opts: { vertex?: string; defines?: string[] } = {}): Program {
    const head = header(opts.defines)
    const vs = compile(gl!.VERTEX_SHADER, head + (opts.vertex ?? FULLSCREEN_VS))
    const fs = compile(gl!.FRAGMENT_SHADER, head + fragment)
    const prog = gl!.createProgram()!
    gl!.attachShader(prog, vs)
    gl!.attachShader(prog, fs)
    gl!.linkProgram(prog)
    gl!.deleteShader(vs)
    gl!.deleteShader(fs)
    if (!gl!.getProgramParameter(prog, gl!.LINK_STATUS) && !gl!.isContextLost()) {
      const log = gl!.getProgramInfoLog(prog)
      gl!.deleteProgram(prog)
      throw new Error(`monsoon program: ${log}`)
    }
    programs.add(prog)
    const u: Record<string, WebGLUniformLocation> = {}
    const count = gl!.getProgramParameter(prog, gl!.ACTIVE_UNIFORMS) as number
    for (let i = 0; i < count; i += 1) {
      const info = gl!.getActiveUniform(prog, i)
      if (!info) continue
      const name = info.name.replace(/\[0\]$/, '')
      const loc = gl!.getUniformLocation(prog, info.name)
      if (loc) u[name] = loc
    }
    return { prog, u, use: () => gl!.useProgram(prog) }
  }

  function makeTexture(w: number, h: number, opts: TargetOptions): WebGLTexture {
    const [internal, format, type] = formats[resolveFormat(opts.format)]
    const tex = gl!.createTexture()!
    textures.add(tex)
    gl!.bindTexture(gl!.TEXTURE_2D, tex)
    const filter = opts.filter === 'nearest' ? gl!.NEAREST : gl!.LINEAR
    const wrap = opts.wrap === 'repeat' ? gl!.REPEAT : gl!.CLAMP_TO_EDGE
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, filter)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, filter)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, wrap)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, wrap)
    gl!.texImage2D(gl!.TEXTURE_2D, 0, internal, w, h, 0, format, type, null)
    return tex
  }

  function target(w: number, h: number, opts: TargetOptions): Target {
    w = Math.max(1, Math.round(w))
    h = Math.max(1, Math.round(h))
    const tex = makeTexture(w, h, opts)
    const fbo = gl!.createFramebuffer()!
    framebuffers.add(fbo)
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo)
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0)
    gl!.viewport(0, 0, w, h)
    gl!.clearColor(0, 0, 0, 0)
    gl!.clear(gl!.COLOR_BUFFER_BIT)
    return { tex, fbo, w, h, texel: [1 / w, 1 / h], opts }
  }

  // Probe once: a device can report the extension and still refuse the format.
  let floatTargets = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))
  gl.getExtension('OES_texture_float_linear')
  if (floatTargets) {
    const probe = target(4, 4, { format: 'rgba16f' })
    floatTargets = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    deleteTarget(probe)
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)

  function resolveFormat(format: TargetFormat): TargetFormat {
    if (floatTargets) return format
    return format === 'rgba16f' ? 'rgba8' : format === 'rg16f' ? 'rgba8' : format === 'r16f' ? 'r8' : format
  }

  function double(w: number, h: number, opts: TargetOptions): DoubleTarget {
    const pair = {
      read: target(w, h, opts),
      write: target(w, h, opts),
      swap() {
        const t = pair.read
        pair.read = pair.write
        pair.write = t
      },
    }
    return pair
  }

  function bind(t: Target | null) {
    if (t) {
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, t.fbo)
      gl!.viewport(0, 0, t.w, t.h)
    } else {
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
      gl!.viewport(0, 0, gl!.drawingBufferWidth, gl!.drawingBufferHeight)
    }
  }

  function draw() {
    gl!.bindVertexArray(vao)
    gl!.drawArrays(gl!.TRIANGLES, 0, 3)
  }

  function upload(tex: WebGLTexture, source: TexImageSource, mipmap: boolean) {
    gl!.bindTexture(gl!.TEXTURE_2D, tex)
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, true)
    gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl!.pixelStorei(gl!.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl!.NONE)
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, gl!.RGBA, gl!.UNSIGNED_BYTE, source)
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, false)
    if (mipmap) gl!.generateMipmap(gl!.TEXTURE_2D)
  }

  function texture(source: TexImageSource, opts: { mipmap?: boolean; wrap?: 'clamp' | 'repeat' } = {}): WebGLTexture {
    const tex = gl!.createTexture()!
    textures.add(tex)
    const mipmap = opts.mipmap ?? false
    upload(tex, source, mipmap)
    const wrap = opts.wrap === 'repeat' ? gl!.REPEAT : gl!.CLAMP_TO_EDGE
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, mipmap ? gl!.LINEAR_MIPMAP_LINEAR : gl!.LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, wrap)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, wrap)
    return tex
  }

  function deleteTarget(t: Target | null | undefined) {
    if (!t) return
    gl!.deleteFramebuffer(t.fbo)
    gl!.deleteTexture(t.tex)
    framebuffers.delete(t.fbo)
    textures.delete(t.tex)
  }

  function deleteTexture(tex: WebGLTexture | null | undefined) {
    if (!tex) return
    gl!.deleteTexture(tex)
    textures.delete(tex)
  }

  return {
    gl,
    floatTargets,
    program,
    target,
    double,
    bind,
    draw,
    texture,
    update: (tex, source, mipmap = false) => upload(tex, source, mipmap),
    deleteTarget,
    deleteDouble(pair) {
      if (!pair) return
      deleteTarget(pair.read)
      deleteTarget(pair.write)
    },
    deleteTexture,
    destroy() {
      for (const p of programs) gl.deleteProgram(p)
      for (const t of textures) gl.deleteTexture(t)
      for (const f of framebuffers) gl.deleteFramebuffer(f)
      programs.clear()
      textures.clear()
      framebuffers.clear()
      gl.deleteVertexArray(vao)
    },
  }
}
