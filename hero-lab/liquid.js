/* Liquid light — a stable-fluids GPU sim where day (amber) and night (violet)
 * ink collide. See HeroLab.register() contract at the top of hero-lab.html.
 * Plain JS, no imports, no external libraries. */
(function () {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedFromString(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  var STYLE = '' +
    '.lq-root{position:absolute;inset:0;overflow:hidden;background:#05070c;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}' +
    '.lq-canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;display:block}' +
    '.lq-poster{position:absolute;inset:0;display:none;' +
      'background:' +
        'radial-gradient(60% 55% at 18% 78%, rgba(255,179,92,0.32), transparent 60%),' +
        'radial-gradient(65% 60% at 82% 22%, rgba(155,140,255,0.34), transparent 62%),' +
        'radial-gradient(90% 70% at 50% 50%, rgba(214,160,220,0.10), transparent 70%),' +
        '#05070c}' +
    '.lq-root.lq-fallback .lq-canvas{display:none}' +
    '.lq-root.lq-fallback .lq-poster{display:block}' +
    '.lq-overlay{position:absolute;inset:0;pointer-events:none}' +
    '.lq-hero{position:absolute;left:0;right:0;bottom:0;padding:0 clamp(20px,4.5vw,64px) max(92px,clamp(28px,6vh,64px));pointer-events:none}' +
    '.lq-hero::before{content:"";position:absolute;left:-10%;right:-10%;bottom:-14%;top:-30%;' +
      'background:radial-gradient(60% 100% at 24% 100%, rgba(5,7,12,0.82), transparent 72%);z-index:0}' +
    '.lq-name{position:relative;z-index:1;margin:0;font-family:"Source Serif 4",Georgia,serif;font-weight:600;' +
      'font-size:clamp(3rem,9vw,7.5rem);line-height:1.02;color:#dde6f2;letter-spacing:-0.01em;' +
      'text-shadow:0 2px 28px rgba(5,7,12,0.9),0 1px 2px rgba(5,7,12,0.7)}' +
    '.lq-tagline{position:relative;z-index:1;margin:0.5em 0 0;max-width:44ch;font-family:inherit;' +
      'font-size:clamp(0.85rem,1.6vw,1.05rem);line-height:1.5;color:#c3cddb;text-shadow:0 1px 14px rgba(5,7,12,0.85)}' +
    '';

  function buildDom(host, env, D) {
    var root = document.createElement('div');
    root.className = 'lq-root';
    var style = document.createElement('style');
    style.textContent = STYLE;
    root.appendChild(style);

    var canvas = document.createElement('canvas');
    canvas.className = 'lq-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Liquid light: a live fluid simulation where warm amber and cool violet ink swirl, collide and mix as the day turns to night.');
    root.appendChild(canvas);

    var poster = document.createElement('div');
    poster.className = 'lq-poster';
    root.appendChild(poster);

    var overlay = document.createElement('div');
    overlay.className = 'lq-overlay';
    root.appendChild(overlay);

    var hero = document.createElement('div');
    hero.className = 'lq-hero';
    var h1 = document.createElement('h1');
    h1.className = 'lq-name';
    h1.textContent = D.name;
    var tagline = document.createElement('p');
    tagline.className = 'lq-tagline';
    tagline.textContent = D.line;
    hero.appendChild(h1);
    hero.appendChild(tagline);
    overlay.appendChild(hero);

    host.appendChild(root);
    return { root: root, canvas: canvas, poster: poster, overlay: overlay };
  }

  // New ink takes the colour of the hour on Aman's clock (env.data.hourColor:
  // coral at dawn, amber by day, rose at dusk, violet at night), so scrubbing the
  // day paints that hour into the fluid while ink already there keeps its own.
  // The second emitter pours the hour twelve hours away, as a thinner thread, so
  // the day and the night it is not always meet on screen.
  var EMIT_MAIN = { cx: 0.24, cy: 0.30, rx: 0.15, ry: 0.13, wx: 0.55, wy: 0.71, px: 0.0, py: 1.7 };
  var EMIT_OPPOSITE = { cx: 0.76, cy: 0.72, rx: 0.16, ry: 0.14, wx: 0.47, wy: 0.63, px: 2.2, py: 0.4 };
  var MAIN_AMT = 1.0, OPPOSITE_AMT = 0.4;

  // ---- Shaders. Plain GLSL ES 1.00: compiles under both a WebGL1 and a
  // WebGL2 context (WebGL2 accepts #version-less shaders as ES 1.00). ----
  var VERT = '\n\
    attribute vec2 aPos;\n\
    varying vec2 vUv;\n\
    void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }';

  var FRAG = {
    splat: '\n\
      precision highp float; varying vec2 vUv;\n\
      uniform sampler2D uTarget; uniform float aspect;\n\
      uniform vec2 point; uniform vec3 color; uniform float radius;\n\
      void main(){\n\
        vec2 p = vUv - point; p.x *= aspect;\n\
        float d = exp(-dot(p,p)/max(radius,1e-5));\n\
        vec3 base = texture2D(uTarget, vUv).xyz;\n\
        gl_FragColor = vec4(base + color*d, 1.0);\n\
      }',
    advect: '\n\
      precision highp float; varying vec2 vUv;\n\
      uniform sampler2D uVelocity; uniform sampler2D uSource;\n\
      uniform vec2 texelSize; uniform float dt; uniform float dissipation;\n\
      void main(){\n\
        vec2 vel = texture2D(uVelocity, vUv).xy;\n\
        vec2 coord = vUv - dt*vel*texelSize;\n\
        gl_FragColor = dissipation*texture2D(uSource, coord);\n\
      }',
    divergence: '\n\
      precision highp float; varying vec2 vUv;\n\
      uniform sampler2D uVelocity; uniform vec2 texelSize;\n\
      void main(){\n\
        float L = texture2D(uVelocity, vUv-vec2(texelSize.x,0.0)).x;\n\
        float R = texture2D(uVelocity, vUv+vec2(texelSize.x,0.0)).x;\n\
        float B = texture2D(uVelocity, vUv-vec2(0.0,texelSize.y)).y;\n\
        float T = texture2D(uVelocity, vUv+vec2(0.0,texelSize.y)).y;\n\
        gl_FragColor = vec4(0.5*(R-L+T-B),0.0,0.0,1.0);\n\
      }',
    curl: '\n\
      precision highp float; varying vec2 vUv;\n\
      uniform sampler2D uVelocity; uniform vec2 texelSize;\n\
      void main(){\n\
        float L = texture2D(uVelocity, vUv-vec2(texelSize.x,0.0)).y;\n\
        float R = texture2D(uVelocity, vUv+vec2(texelSize.x,0.0)).y;\n\
        float B = texture2D(uVelocity, vUv-vec2(0.0,texelSize.y)).x;\n\
        float T = texture2D(uVelocity, vUv+vec2(0.0,texelSize.y)).x;\n\
        gl_FragColor = vec4(0.5*((R-L)-(T-B)),0.0,0.0,1.0);\n\
      }',
    vorticity: '\n\
      precision highp float; varying vec2 vUv;\n\
      uniform sampler2D uVelocity; uniform sampler2D uCurl;\n\
      uniform vec2 texelSize; uniform float curlStrength; uniform float dt;\n\
      void main(){\n\
        float L = texture2D(uCurl, vUv-vec2(texelSize.x,0.0)).x;\n\
        float R = texture2D(uCurl, vUv+vec2(texelSize.x,0.0)).x;\n\
        float B = texture2D(uCurl, vUv-vec2(0.0,texelSize.y)).x;\n\
        float T = texture2D(uCurl, vUv+vec2(0.0,texelSize.y)).x;\n\
        float C = texture2D(uCurl, vUv).x;\n\
        vec2 force = 0.5*vec2(abs(T)-abs(B), abs(R)-abs(L));\n\
        force /= (length(force)+1e-4);\n\
        force *= curlStrength*C; force.y *= -1.0;\n\
        vec2 vel = texture2D(uVelocity, vUv).xy + force*dt;\n\
        gl_FragColor = vec4(vel,0.0,1.0);\n\
      }',
    pressure: '\n\
      precision highp float; varying vec2 vUv;\n\
      uniform sampler2D uPressure; uniform sampler2D uDivergence;\n\
      uniform vec2 texelSize;\n\
      void main(){\n\
        float L = texture2D(uPressure, vUv-vec2(texelSize.x,0.0)).x;\n\
        float R = texture2D(uPressure, vUv+vec2(texelSize.x,0.0)).x;\n\
        float B = texture2D(uPressure, vUv-vec2(0.0,texelSize.y)).x;\n\
        float T = texture2D(uPressure, vUv+vec2(0.0,texelSize.y)).x;\n\
        float div = texture2D(uDivergence, vUv).x;\n\
        gl_FragColor = vec4((L+R+B+T-div)*0.25,0.0,0.0,1.0);\n\
      }',
    gradient: '\n\
      precision highp float; varying vec2 vUv;\n\
      uniform sampler2D uPressure; uniform sampler2D uVelocity;\n\
      uniform vec2 texelSize;\n\
      void main(){\n\
        float L = texture2D(uPressure, vUv-vec2(texelSize.x,0.0)).x;\n\
        float R = texture2D(uPressure, vUv+vec2(texelSize.x,0.0)).x;\n\
        float B = texture2D(uPressure, vUv-vec2(0.0,texelSize.y)).x;\n\
        float T = texture2D(uPressure, vUv+vec2(0.0,texelSize.y)).x;\n\
        vec2 vel = texture2D(uVelocity, vUv).xy - vec2(R-L,T-B)*0.5;\n\
        gl_FragColor = vec4(vel,0.0,1.0);\n\
      }',
    clear: '\n\
      precision highp float; varying vec2 vUv;\n\
      uniform sampler2D uTexture; uniform float value;\n\
      void main(){ gl_FragColor = value*texture2D(uTexture, vUv); }',
    copy: '\n\
      precision highp float; varying vec2 vUv;\n\
      uniform sampler2D uTexture;\n\
      void main(){ gl_FragColor = texture2D(uTexture, vUv); }',
    threshold: '\n\
      precision highp float; varying vec2 vUv;\n\
      uniform sampler2D uTexture; uniform float thresh;\n\
      void main(){\n\
        vec3 c = texture2D(uTexture, vUv).rgb;\n\
        float l = max(c.r,max(c.g,c.b));\n\
        gl_FragColor = vec4(c*smoothstep(thresh, thresh+0.5, l)*0.5, 1.0);\n\
      }',
    blur: '\n\
      precision highp float; varying vec2 vUv;\n\
      uniform sampler2D uTexture; uniform vec2 texelSize; uniform vec2 dir;\n\
      void main(){\n\
        vec2 o1 = dir*texelSize*1.3846153846; vec2 o2 = dir*texelSize*3.2307692308;\n\
        vec4 s = texture2D(uTexture, vUv)*0.2270270270;\n\
        s += texture2D(uTexture, vUv+o1)*0.3162162162; s += texture2D(uTexture, vUv-o1)*0.3162162162;\n\
        s += texture2D(uTexture, vUv+o2)*0.0702702703; s += texture2D(uTexture, vUv-o2)*0.0702702703;\n\
        gl_FragColor = s;\n\
      }',
    display: '\n\
      precision highp float; varying vec2 vUv;\n\
      uniform sampler2D uDye; uniform sampler2D uBloom;\n\
      uniform float time; uniform float grainAmt; uniform float dayness;\n\
      float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }\n\
      void main(){\n\
        vec3 c = max(texture2D(uDye, vUv).rgb, 0.0);\n\
        vec3 bloom = max(texture2D(uBloom, vUv).rgb, 0.0);\n\
        vec3 mixed = c + bloom*0.28;\n\
        vec3 mapped = mixed/(1.0+mixed);\n\
        float n = hash(vUv*vec2(1024.0,1024.0)+time);\n\
        mapped += (n-0.5)*grainAmt;\n\
        vec3 bgNight = vec3(0.0118,0.0157,0.0314);\n\
        vec3 bgDay = vec3(0.0275,0.0314,0.0392);\n\
        vec3 bg = mix(bgNight, bgDay, clamp(dayness,0.0,1.0));\n\
        gl_FragColor = vec4(clamp(bg+mapped,0.0,1.0), 1.0);\n\
      }'
  };

  function compileShader(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var info = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('liquid: shader error ' + info);
    }
    return s;
  }
  function createProgram(gl, vertSrc, fragSrc) {
    var vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
    var fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      var info = gl.getProgramInfoLog(p);
      throw new Error('liquid: link error ' + info);
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    var uniforms = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var u = gl.getActiveUniform(p, i);
      uniforms[u.name] = gl.getUniformLocation(p, u.name);
    }
    return { program: p, uniforms: uniforms };
  }
  function bindTarget(gl, t) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, t ? t.w : gl.drawingBufferWidth, t ? t.h : gl.drawingBufferHeight);
  }
  function runProgram(gl, prog, setUniforms, target) {
    bindTarget(gl, target);
    gl.useProgram(prog.program);
    if (setUniforms) setUniforms(prog.uniforms);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function bindTex(gl, unit, tex, loc) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (loc) gl.uniform1i(loc, unit);
  }

  function createGL(canvas) {
    var opts = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false };
    var gl = null, isWebGL2 = false, halfFloatExt = null, supportsLinear = true;
    try { gl = canvas.getContext('webgl2', opts); } catch (e) { gl = null; }
    if (gl) {
      isWebGL2 = true;
      if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) gl = null;
    }
    if (!gl) {
      isWebGL2 = false;
      try { gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts); } catch (e2) { gl = null; }
      if (!gl) return null;
      halfFloatExt = gl.getExtension('OES_texture_half_float');
      if (!halfFloatExt) return null;
      supportsLinear = !!gl.getExtension('OES_texture_half_float_linear');
      gl.getExtension('OES_texture_float');
    }
    var texType = isWebGL2 ? gl.HALF_FLOAT : halfFloatExt.HALF_FLOAT_OES;
    var internalFormat = isWebGL2 ? gl.RGBA16F : gl.RGBA;
    var format = gl.RGBA;

    function fboWorks(type, internal) {
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, format, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteTexture(tex); gl.deleteFramebuffer(fbo);
      return ok;
    }
    if (!fboWorks(texType, internalFormat)) return null;

    gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    var programs = {};
    try {
      for (var key in FRAG) programs[key] = createProgram(gl, VERT, FRAG[key]);
    } catch (e3) { return null; }

    return {
      ctx: gl, isWebGL2: isWebGL2, texType: texType, internalFormat: internalFormat,
      format: format, supportsLinear: supportsLinear, quad: quad, programs: programs
    };
  }

  function createFBO(glInfo, w, h, filter) {
    var gl = glInfo.ctx;
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, glInfo.internalFormat, w, h, 0, glInfo.format, glInfo.texType, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: tex, fbo: fbo, w: w, h: h };
  }
  function createDouble(glInfo, w, h, filter) {
    var a = createFBO(glInfo, w, h, filter), b = createFBO(glInfo, w, h, filter);
    return {
      w: w, h: h,
      get read() { return a; },
      get write() { return b; },
      swap: function () { var t = a; a = b; b = t; }
    };
  }

  function createSim(glInfo, simW, simH, dyeW, dyeH) {
    var gl = glInfo.ctx;
    var filter = glInfo.supportsLinear === false ? gl.NEAREST : gl.LINEAR;
    var bloomW = Math.max(2, Math.round(dyeW / 4)), bloomH = Math.max(2, Math.round(dyeH / 4));
    return {
      glInfo: glInfo, gl: gl,
      simW: simW, simH: simH, dyeW: dyeW, dyeH: dyeH,
      bloomW: bloomW, bloomH: bloomH,
      texelSim: [1 / simW, 1 / simH],
      // Velocity is stored in sim-grid TEXELS/second (advect multiplies by
      // texelSim to get a UV displacement), so any caller starting from a
      // UV-space speed or delta must scale up by roughly this many texels
      // per UV unit, or the injected "velocity" is too small to move
      // anything and dye just sits at the splat looking like a static blob.
      velScale: (simW + simH) * 0.5,
      velocity: createDouble(glInfo, simW, simH, filter),
      dye: createDouble(glInfo, dyeW, dyeH, filter),
      divergence: createFBO(glInfo, simW, simH, gl.NEAREST),
      curl: createFBO(glInfo, simW, simH, gl.NEAREST),
      pressure: createDouble(glInfo, simW, simH, gl.NEAREST),
      bloomA: createFBO(glInfo, bloomW, bloomH, filter),
      bloomB: createFBO(glInfo, bloomW, bloomH, filter),
      programs: glInfo.programs
    };
  }

  function destroySim(sim) {
    if (!sim) return;
    var gl = sim.gl;
    function kill(t) { if (!t) return; gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    function killD(d) { kill(d.read); kill(d.write); }
    killD(sim.velocity); killD(sim.dye); killD(sim.pressure);
    kill(sim.divergence); kill(sim.curl); kill(sim.bloomA); kill(sim.bloomB);
    // Note: does NOT lose the GL context — this also runs on a plain resize.
    // The module's destroy() does that once, after this.
  }
  // x,y are GL UV (origin bottom-left, y up) — callers flip DOM y first.
  function splat(sim, x, y, dx, dy, r, g, b, radius) {
    var gl = sim.gl, prog = sim.programs.splat, aspect = sim.simW / sim.simH;
    runProgram(gl, prog, function (u) {
      bindTex(gl, 0, sim.velocity.read.tex, u.uTarget);
      gl.uniform1f(u.aspect, aspect);
      gl.uniform2f(u.point, x, y);
      gl.uniform3f(u.color, dx, dy, 0.0);
      gl.uniform1f(u.radius, radius);
    }, sim.velocity.write);
    sim.velocity.swap();
    runProgram(gl, prog, function (u) {
      bindTex(gl, 0, sim.dye.read.tex, u.uTarget);
      gl.uniform1f(u.aspect, aspect);
      gl.uniform2f(u.point, x, y);
      gl.uniform3f(u.color, r, g, b);
      gl.uniform1f(u.radius, radius);
    }, sim.dye.write);
    sim.dye.swap();
  }

  // Stam's stable-fluids steps. Velocity/pressure/divergence/curl live on the
  // small sim grid in texel units (grid spacing = 1); dye is advected by the
  // same field at its own, larger resolution using the SIM grid's texel size
  // to convert velocity into a UV displacement, since that is the grid the
  // velocity values are defined on.
  function stepSim(sim, dt) {
    dt = Math.min(Math.max(dt, 0.0001), 1 / 30);
    var gl = sim.gl, p = sim.programs, ts = sim.texelSim;
    var velMul = Math.exp(-1.15 * dt);   // momentum settles in ~1-2s
    var dyeMul = Math.exp(-0.29 * dt);   // ink lingers ~6-10s (10% left at 8s)

    runProgram(gl, p.curl, function (u) {
      bindTex(gl, 0, sim.velocity.read.tex, u.uVelocity);
      gl.uniform2f(u.texelSize, ts[0], ts[1]);
    }, sim.curl);

    runProgram(gl, p.vorticity, function (u) {
      bindTex(gl, 0, sim.velocity.read.tex, u.uVelocity);
      bindTex(gl, 1, sim.curl.tex, u.uCurl);
      gl.uniform2f(u.texelSize, ts[0], ts[1]);
      gl.uniform1f(u.curlStrength, 30.0);
      gl.uniform1f(u.dt, dt);
    }, sim.velocity.write);
    sim.velocity.swap();

    runProgram(gl, p.divergence, function (u) {
      bindTex(gl, 0, sim.velocity.read.tex, u.uVelocity);
      gl.uniform2f(u.texelSize, ts[0], ts[1]);
    }, sim.divergence);

    runProgram(gl, p.clear, function (u) {
      bindTex(gl, 0, sim.pressure.read.tex, u.uTexture);
      gl.uniform1f(u.value, 0.78);
    }, sim.pressure.write);
    sim.pressure.swap();

    // Closure hoisted out of the loop: 20 iterations must not mean 20
    // per-frame allocations for an uniform-setter that reads live sim state.
    var setPressureUniforms = function (u) {
      bindTex(gl, 0, sim.pressure.read.tex, u.uPressure);
      bindTex(gl, 1, sim.divergence.tex, u.uDivergence);
      gl.uniform2f(u.texelSize, ts[0], ts[1]);
    };
    for (var i = 0; i < 20; i++) {
      runProgram(gl, p.pressure, setPressureUniforms, sim.pressure.write);
      sim.pressure.swap();
    }

    runProgram(gl, p.gradient, function (u) {
      bindTex(gl, 0, sim.pressure.read.tex, u.uPressure);
      bindTex(gl, 1, sim.velocity.read.tex, u.uVelocity);
      gl.uniform2f(u.texelSize, ts[0], ts[1]);
    }, sim.velocity.write);
    sim.velocity.swap();

    runProgram(gl, p.advect, function (u) {
      bindTex(gl, 0, sim.velocity.read.tex, u.uVelocity);
      bindTex(gl, 1, sim.velocity.read.tex, u.uSource);
      gl.uniform2f(u.texelSize, ts[0], ts[1]);
      gl.uniform1f(u.dt, dt);
      gl.uniform1f(u.dissipation, velMul);
    }, sim.velocity.write);
    sim.velocity.swap();

    runProgram(gl, p.advect, function (u) {
      bindTex(gl, 0, sim.velocity.read.tex, u.uVelocity);
      bindTex(gl, 1, sim.dye.read.tex, u.uSource);
      gl.uniform2f(u.texelSize, ts[0], ts[1]);
      gl.uniform1f(u.dt, dt);
      gl.uniform1f(u.dissipation, dyeMul);
    }, sim.dye.write);
    sim.dye.swap();
  }

  // Threshold the dye (only genuinely bright cores pass), blur once
  // (separable, downsampled) for a tight glow rather than a wide haze, then
  // tone-map + composite straight onto the visible canvas. dayness (0..1)
  // only tints the background — the ink's own colour was already fixed when
  // it was splatted.
  function renderSim(sim, gl, canvas, drawW, drawH, grainTime, dayness) {
    var p = sim.programs;
    runProgram(gl, p.threshold, function (u) {
      bindTex(gl, 0, sim.dye.read.tex, u.uTexture);
      gl.uniform1f(u.thresh, 0.78);
    }, sim.bloomA);

    var texelBloom0 = 1 / sim.bloomW, texelBloom1 = 1 / sim.bloomH;
    var src = sim.bloomA, dst = sim.bloomB, i, tmp;
    // Both closures read src/dst by reference, so hoisting them out of the
    // loop is safe and turns 4 per-frame allocations into 2.
    var setBlurH = function (u) {
      bindTex(gl, 0, src.tex, u.uTexture);
      gl.uniform2f(u.texelSize, texelBloom0, texelBloom1);
      gl.uniform2f(u.dir, 1, 0);
    };
    var setBlurV = function (u) {
      bindTex(gl, 0, src.tex, u.uTexture);
      gl.uniform2f(u.texelSize, texelBloom0, texelBloom1);
      gl.uniform2f(u.dir, 0, 1);
    };
    for (i = 0; i < 1; i++) {
      runProgram(gl, p.blur, setBlurH, dst);
      tmp = src; src = dst; dst = tmp;
      runProgram(gl, p.blur, setBlurV, dst);
      tmp = src; src = dst; dst = tmp;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, drawW, drawH);
    gl.useProgram(p.display.program);
    bindTex(gl, 0, sim.dye.read.tex, p.display.uniforms.uDye);
    bindTex(gl, 1, src.tex, p.display.uniforms.uBloom);
    gl.uniform1f(p.display.uniforms.time, grainTime || 0);
    gl.uniform1f(p.display.uniforms.grainAmt, 0.02);
    gl.uniform1f(p.display.uniforms.dayness, dayness == null ? 1 : dayness);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  // --------------------------------------------

  function create(host, env) {
    var D = env.data;
    var dom = buildDom(host, env, D);
    var reduced = !!env.reduced;

    // Screenshot-only test hook: ?scale=0.5..2 pins the render/sim scale so a
    // grab shows real-GPU quality instead of whatever this host's measured
    // frame time adaptively settled on. The shipped default stays adaptive.
    var scaleOverride = null;
    var scaleQ = /[?&]scale=([0-9.]+)/.exec(location.search);
    if (scaleQ) {
      var sv = parseFloat(scaleQ[1]);
      if (isFinite(sv) && sv > 0 && sv <= 2) scaleOverride = sv;
    }

    var state = {
      inited: false,
      running: false,
      gl: null,
      isWebGL2: false,
      sim: null,
      w: 0, h: 0,
      dpr: clamp(env.dpr || 1, 1, 2),
      scale: scaleOverride != null ? scaleOverride : (env.lowPower ? 0.5 : 0.85),
      scaleLocked: scaleOverride != null,
      raf: 0,
      lastT: 0,
      lastInput: -1e9,
      destroyed: false,
      frameAvg: 16,
      hidden: document.hidden,
      simTime: 0,
      // Eased 0..1 day/night mix the frame is actually drawn at; chases the
      // clock's own dayness() over ~0.4s instead of snapping to it.
      dayness: 1,
      idleStrength: 0,
      idleAccum: 0,
      resCheckAccum: 0,
      activePointer: null,
      dragLast: [0, 0],
      lastSplatPos: [0, 0],
      dragMoved: 0
    };

    // Reduced motion never runs the loop that would otherwise chase the
    // clock, so a scrub has to redraw the still frame itself, right here.
    function handleClockChange(minutes, isNow) {
      if (reduced) { state.dayness = D.dayness(minutes); renderReducedFrame(); }
    }
    var clock = HeroLab.clockScrubber(dom.root, env, handleClockChange);
    state.dayness = clock.dayness();

    function fallbackToPoster() {
      dom.root.classList.add('lq-fallback');
    }

    // ---- Pointer input: drag stirs, a tap/click drops a big ink burst. ----
    function toUV(clientX, clientY) {
      var r = dom.canvas.getBoundingClientRect();
      var x = r.width ? (clientX - r.left) / r.width : 0.5;
      var y = r.height ? 1 - (clientY - r.top) / r.height : 0.5;
      return [clamp(x, 0, 1), clamp(y, 0, 1)];
    }
    function onPointerDown(e) {
      if (state.activePointer !== null || !state.sim) return;
      state.activePointer = e.pointerId;
      try { dom.canvas.setPointerCapture(e.pointerId); } catch (e0) {}
      state.dragLast = toUV(e.clientX, e.clientY);
      state.lastSplatPos = state.dragLast;
      state.dragMoved = 0;
      state.lastInput = performance.now();
    }
    // Splats are sampled by DISTANCE moved, not by move-event count: a fast
    // synthetic or high-poll-rate drag otherwise fires many overlapping
    // splats over a short path and smears into one flat, blown-out stripe
    // instead of a stretched filament. dragMoved (tap-vs-drag) still tracks
    // every event so that distinction stays accurate.
    function onPointerMove(e) {
      if (state.activePointer !== e.pointerId || !state.sim) return;
      var uv = toUV(e.clientX, e.clientY);
      var dx = uv[0] - state.dragLast[0], dy = uv[1] - state.dragLast[1];
      state.dragMoved += Math.abs(dx) + Math.abs(dy);
      state.dragLast = uv;
      state.lastInput = performance.now();
      var sdx = uv[0] - state.lastSplatPos[0], sdy = uv[1] - state.lastSplatPos[1];
      var moved = Math.sqrt(sdx * sdx + sdy * sdy);
      if (moved < 0.012) return;
      state.lastSplatPos = uv;
      var c = D.hourColor(clock.minutes());
      var speed = clamp(moved * 26, 0, 3.5);
      var vs = state.sim.velScale * 1.8; // UV delta -> sim texels/second (see sim.velScale)
      splat(state.sim, uv[0], uv[1], sdx * vs, sdy * vs, c[0] * 1.35, c[1] * 1.35, c[2] * 1.35, 0.014 + speed * 0.002);
    }
    function onPointerUp(e) {
      if (state.activePointer !== e.pointerId) return;
      state.activePointer = null;
      state.lastInput = performance.now();
      if (state.sim && state.dragMoved < 0.025) {
        var uv = state.dragLast, c = D.hourColor(clock.minutes());
        splat(state.sim, uv[0], uv[1], 0, 0, c[0] * 1.1, c[1] * 1.1, c[2] * 1.1, 0.026);
      }
      try { dom.canvas.releasePointerCapture(e.pointerId); } catch (e0) {}
    }
    dom.canvas.addEventListener('pointerdown', onPointerDown);
    dom.canvas.addEventListener('pointermove', onPointerMove);
    dom.canvas.addEventListener('pointerup', onPointerUp);
    dom.canvas.addEventListener('pointercancel', onPointerUp);

    function computeSimDims(w, h) {
      var longRatio = Math.max(w, h) / Math.max(1, Math.min(w, h));
      var simShort = clamp(Math.round(176 * state.scale), 96, 192);
      var simW = w >= h ? Math.round(simShort * longRatio) : simShort;
      var simH = w >= h ? simShort : Math.round(simShort * longRatio);
      // Dye targets the LONG side: >=1024 at the default desktop scale
      // (0.85), up to 1536 at the ?scale= test hook's max, 512 flat when
      // lowPower. Not floored at 1024 unconditionally — genuine adaptive
      // throttling (state.scale -> 0.35) is still allowed to shrink it.
      var dyeLong = env.lowPower ? 512 : clamp(Math.round(1500 * state.scale), 640, 1536);
      var dyeShort = Math.max(2, Math.round(dyeLong / longRatio));
      var dyeW = w >= h ? dyeLong : dyeShort;
      var dyeH = w >= h ? dyeShort : dyeLong;
      return { simW: simW, simH: simH, dyeW: dyeW, dyeH: dyeH };
    }

    function setup(w, h) {
      state.w = w; state.h = h;
      var gl = createGL(dom.canvas);
      if (!gl) { fallbackToPoster(); state.inited = true; return; }
      state.glInfo = gl; state.gl = gl.ctx; state.isWebGL2 = gl.isWebGL2;
      var d = computeSimDims(w, h);
      state.sim = createSim(gl, d.simW, d.simH, d.dyeW, d.dyeH);
      state.inited = true;
    }

    function doResize(w, h) {
      w = Math.max(1, w); h = Math.max(1, h);
      var dpr = state.dpr * state.scale;
      dom.canvas.width = Math.max(1, Math.round(w * dpr));
      dom.canvas.height = Math.max(1, Math.round(h * dpr));
      if (!state.inited) { setup(w, h); }
      else {
        state.w = w; state.h = h;
        if (state.sim && state.glInfo) {
          destroySim(state.sim); state.sim = null;
          var d = computeSimDims(w, h);
          state.sim = createSim(state.glInfo, d.simW, d.simH, d.dyeW, d.dyeH);
        }
      }
      if (reduced) renderReducedFrame();
    }

    function renderReducedFrame() {
      if (!state.sim) return;
      var rand = mulberry32(seedFromString('liquid-reduced-v1'));
      var m = clock.minutes(), mainCol = D.hourColor(m), oppCol = D.hourColor(m + 720);
      for (var i = 0; i < 120; i++) {
        if (i % 12 === 0) {
          var side = (i / 12) % 2 < 1 ? 0 : 1;
          var x = side === 0 ? 0.16 + rand() * 0.2 : 0.62 + rand() * 0.22;
          var y = 0.22 + rand() * 0.56;
          var col = side === 0 ? mainCol : oppCol;
          var amt = side === 0 ? MAIN_AMT : OPPOSITE_AMT;
          var rvs = state.sim.velScale * 0.9 * amt;
          splat(state.sim, x, y, (rand() - 0.5) * rvs, (rand() - 0.5) * rvs, col[0] * amt, col[1] * amt, col[2] * amt, 0.02);
        }
        stepSim(state.sim, 1 / 60);
      }
      renderSim(state.sim, state.gl, dom.canvas, dom.canvas.width, dom.canvas.height, 1, state.dayness);
    }

    function emitIdle(e, amt, color) {
      var s = state.simTime;
      var x = e.cx + Math.sin(s * e.wx + e.px) * e.rx;
      var y = e.cy + Math.sin(s * e.wy + e.py) * e.ry;
      // Path derivative is in UV/second; the sim wants texels/second (see
      // sim.velScale) — without this scale-up the injected kick was ~500x
      // too small to move the dye at all, so it just sat at the splat point
      // looking like a static glow instead of streaming into a ribbon.
      var vs = state.sim.velScale * 1.6;
      var dx = Math.cos(s * e.wx + e.px) * e.wx * e.rx * vs;
      var dy = Math.cos(s * e.wy + e.py) * e.wy * e.ry * vs;
      var k = state.idleStrength * amt;
      splat(state.sim, x, y, dx * k, dy * k, color[0] * k, color[1] * k, color[2] * k, 0.006);
    }

    function start() {
      if (state.destroyed) return;
      state.hidden = false;
      clock.start();
      if (reduced) return;
      if (!state.running && state.sim) {
        state.running = true;
        state.lastT = 0;
        state.raf = requestAnimationFrame(loop);
      }
    }

    function stop() {
      state.running = false;
      if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
      clock.stop();
    }

    function loop() {
      if (!state.running) return;
      state.raf = requestAnimationFrame(loop);
      if (!state.sim) return;
      var t0 = performance.now();
      // rawDt is real elapsed time, hard-capped only against a genuine stall
      // (e.g. tab resume) — NOT the usual 1/20 floor. Under slow software
      // rendering that floor made simulated time crawl far behind the clock,
      // so idle choreography and dissipation both under-ran a 3s screenshot.
      // Semi-Lagrangian advection has no CFL limit, so instead of shrinking
      // dt we SUBSTEP: however long the real frame took, stepSim() advances
      // by that much, in chunks no larger than ~1/60s each.
      var rawDt = state.lastT ? Math.min((t0 - state.lastT) / 1000, 0.5) : 1 / 60;
      state.lastT = t0;
      state.simTime += rawDt;

      // Chase the clock's own dayness (it may have jumped, mid-drag) over
      // about 0.4s instead of snapping the palette straight to it.
      state.dayness += (clock.dayness() - state.dayness) * Math.min(1, rawDt / 0.4);

      var targetIdle = (t0 - state.lastInput) > 4000 ? 1 : 0;
      state.idleStrength += (targetIdle - state.idleStrength) * Math.min(1, rawDt * 1.5);
      if (state.idleStrength > 0.02) {
        state.idleAccum += rawDt;
        while (state.idleAccum > 0.18) {
          state.idleAccum -= 0.18;
          var nowMin = clock.minutes();
          emitIdle(EMIT_MAIN, MAIN_AMT, D.hourColor(nowMin));
          emitIdle(EMIT_OPPOSITE, OPPOSITE_AMT, D.hourColor(nowMin + 720));
        }
      }

      var steps = Math.min(6, Math.max(1, Math.round(rawDt / (1 / 60))));
      var stepDt = rawDt / steps;
      for (var s = 0; s < steps; s++) stepSim(state.sim, stepDt);
      renderSim(state.sim, state.gl, dom.canvas, dom.canvas.width, dom.canvas.height, state.simTime, state.dayness);

      var frameMs = performance.now() - t0;
      state.frameAvg += (frameMs - state.frameAvg) * 0.08;
      state.resCheckAccum += rawDt;
      if (state.resCheckAccum > 1.2) {
        state.resCheckAccum = 0;
        if (!state.scaleLocked && state.frameAvg > 22 && state.scale > 0.35) {
          state.scale = Math.max(0.35, state.scale - 0.12);
          doResize(state.w, state.h);
        }
      }
    }

    function destroy() {
      state.destroyed = true;
      stop();
      clock.destroy();
      dom.canvas.removeEventListener('pointerdown', onPointerDown);
      dom.canvas.removeEventListener('pointermove', onPointerMove);
      dom.canvas.removeEventListener('pointerup', onPointerUp);
      dom.canvas.removeEventListener('pointercancel', onPointerUp);
      if (state.sim) { destroySim(state.sim); state.sim = null; }
      if (state.gl) {
        var lose = state.gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        state.gl = null;
      }
      if (dom.root.parentNode) dom.root.parentNode.removeChild(dom.root);
    }

    return { start: start, stop: stop, resize: doResize, destroy: destroy };
  }

  HeroLab.register({
    id: 'liquid',
    label: 'Liquid light',
    notes: {
      what: 'A live fluid simulation that runs on Aman’s clock in India. New ink takes the colour of his hour, coral at dawn, amber through the day, rose at dusk and violet at night, with a thread of the opposite hour running through it.',
      play: 'Drag to stir the ink and click to drop a burst of colour. Drag the strip along the bottom to scrub through his day and watch the light and the ink change with it.',
      cost: 'Runs a full stable-fluids solver on the GPU at adaptive resolution. Reduced motion shows one settled frame that redraws each time you scrub instead of animating; without WebGL it falls back to a static gradient poster. Shipping it costs a small lazy-loaded module on the home page only.'
    },
    create: create
  });
})();
