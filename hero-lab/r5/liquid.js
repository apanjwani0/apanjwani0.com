/* Liquid light — a stable-fluids GPU sim where day (amber) and night (violet)
 * ink collide. See HeroLab.register() contract at the top of hero-lab.html.
 * Plain JS, no imports, no external libraries. */
(function () {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  var STYLE = '' +
    '.lq-root{position:absolute;inset:0;overflow:hidden;background:#05070c;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}' +
    '.lq-canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:pan-y pinch-zoom;display:block}' +
    // The two custom properties (plain "r,g,b" triplets) are set from JS at
    // load and on every clock scrub, from the same D.hourColor the WebGL
    // path splats with, so the no-canvas fallback tracks the hour too.
    '.lq-poster{position:absolute;inset:0;display:none;' +
      '--lq-c1:255,179,92;--lq-c2:155,140,255;' +
      'background:' +
        'radial-gradient(60% 55% at 18% 78%, rgba(var(--lq-c1),0.34), transparent 60%),' +
        'radial-gradient(65% 60% at 82% 22%, rgba(var(--lq-c2),0.36), transparent 62%),' +
        'radial-gradient(90% 70% at 50% 50%, rgba(var(--lq-c1),0.08), transparent 70%),' +
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
    canvas.setAttribute('aria-label', 'Liquid light: a live fluid simulation of glowing ink in the colours of the current hour in India.');
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
    return { root: root, canvas: canvas, poster: poster, overlay: overlay, name: h1, tagline: tagline };
  }

  // New ink takes the colour of the hour on Aman's clock (env.data.hourColor:
  // coral at dawn, amber by day, rose at dusk, violet at night), so scrubbing the
  // day paints that hour into the fluid while ink already there keeps its own.
  // The second emitter pours the hour twelve hours away, as a thinner thread, so
  // the day and the night it is not always meet on screen.
  // Both orbits stay in the upper two-thirds of the stage (UV y is bottom-up),
  // clear of the name/tagline/clock block the display shader dims — so the
  // dimming is a safety net for drags and clicks, not where the idle light
  // spends most of its life.
  var EMIT_MAIN = { cx: 0.36, cy: 0.62, rx: 0.15, ry: 0.11, wx: 0.55, wy: 0.71, px: 0.0, py: 1.7 };
  var EMIT_OPPOSITE = { cx: 0.70, cy: 0.66, rx: 0.14, ry: 0.12, wx: 0.47, wy: 0.63, px: 2.2, py: 0.4 };
  var MAIN_AMT = 1.0, OPPOSITE_AMT = 0.4;

  // LAB ONLY: ?tune=curl:20,vd:0.4 overrides these so variants can be shot
  // side by side, and ?fixed=0.2 advances exactly that much sim time per
  // frame so a slow software renderer shows what a real GPU would.
  var TUNE = { curl: 18, vd: 0.4, dd: 0.4, rad: 0.004, ink: 0.45, vk: 2.4, ivl: 0.18, expo: 2.6, shade: 1, core: 0.45, pink: 0.3, toe: 0.08, bth: 0.5, bst: 0.8, sat: 1.4, dr: 0.0018, pr: 0.0009, pv: 2.2, po: 0.015 };
  var FIXED = 0;
  (function () {
    var m = /[?&]tune=([^&]+)/.exec(location.search);
    if (m) decodeURIComponent(m[1]).split(',').forEach(function (kv) {
      var q = kv.split(':'); if (q[0] in TUNE && isFinite(+q[1])) TUNE[q[0]] = +q[1];
    });
    var f = /[?&]fixed=([0-9.]+)/.exec(location.search);
    if (f && +f[1] > 0 && +f[1] <= 0.5) FIXED = +f[1];
  })();

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
      uniform vec2 texelSize; uniform float dt; uniform float dissipation; uniform float edgeK;\n\
      void main(){\n\
        vec2 vel = texture2D(uVelocity, vUv).xy;\n\
        vec2 coord = vUv - dt*vel*texelSize;\n\
        vec2 e2 = smoothstep(0.0, 0.07, vUv)*smoothstep(0.0, 0.07, 1.0-vUv);\n\
        gl_FragColor = dissipation*exp(-edgeK*(1.0-e2.x*e2.y))*texture2D(uSource, coord);\n\
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
      uniform float uTwo; uniform vec3 uColA; uniform vec3 uColB;\n\
      void main(){\n\
        vec3 c = texture2D(uTexture, vUv).rgb;\n\
        if (uTwo > 0.5) c = c.r*uColA + c.g*uColB;\n\
        float l = max(c.r,max(c.g,c.b));\n\
        gl_FragColor = vec4(c*smoothstep(thresh, thresh+0.45, l)*0.85, 1.0);\n\
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
      uniform sampler2D uDye; uniform sampler2D uBloom; uniform vec2 texelDye;\n\
      uniform float time; uniform float grainAmt; uniform float dayness;\n\
      uniform float expo; uniform float shade; uniform float core; uniform float toe; uniform float bst;\n\
      uniform vec4 uBox; uniform vec3 uBands; uniform vec2 uRes; uniform float uFeather;\n\
      uniform float uTwo; uniform vec3 uColA; uniform vec3 uColB;\n\
      float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }\n\
      vec3 dyeBilinear(vec2 uv){\n\
        vec2 g = uv/texelDye - 0.5;\n\
        vec2 f = fract(g);\n\
        vec2 base = (floor(g)+0.5)*texelDye;\n\
        vec3 c00 = texture2D(uDye, base).rgb;\n\
        vec3 c10 = texture2D(uDye, base+vec2(texelDye.x,0.0)).rgb;\n\
        vec3 c01 = texture2D(uDye, base+vec2(0.0,texelDye.y)).rgb;\n\
        vec3 c11 = texture2D(uDye, base+texelDye).rgb;\n\
        return mix(mix(c00,c10,f.x), mix(c01,c11,f.x), f.y);\n\
      }\n\
      void main(){\n\
        vec3 raw = max(dyeBilinear(vUv), 0.0);\n\
        if (uTwo > 0.5) raw = raw.r*uColA + raw.g*uColB;\n\
        if (shade > 0.0) {\n\
          float dL = length(texture2D(uDye, vUv-vec2(texelDye.x,0.0)).rgb);\n\
          float dR = length(texture2D(uDye, vUv+vec2(texelDye.x,0.0)).rgb);\n\
          float dB = length(texture2D(uDye, vUv-vec2(0.0,texelDye.y)).rgb);\n\
          float dT = length(texture2D(uDye, vUv+vec2(0.0,texelDye.y)).rgb);\n\
          vec3 nrm = normalize(vec3(dR-dL, dT-dB, length(texelDye)));\n\
          raw *= mix(1.0, clamp(nrm.z + 0.7, 0.7, 1.0), shade);\n\
        }\n\
        vec3 bloom = max(texture2D(uBloom, vUv).rgb, 0.0);\n\
        vec3 hdr = raw + bloom*bst;\n\
        float m = max(hdr.r, max(hdr.g, hdr.b));\n\
        float mm = max(m, 1e-5);\n\
        float m2 = 1.0 - exp(-mm*expo);\n\
        vec3 mapped = hdr * (m2/mm);\n\
        float luma = dot(mapped, vec3(0.299,0.587,0.114));\n\
        mapped = clamp(luma + (mapped-luma)*1.22, 0.0, 1.0);\n\
        mapped = mix(mapped, vec3(1.0), smoothstep(0.9, 2.8, m)*core*0.5);\n\
        mapped *= smoothstep(toe, toe*3.0+0.001, m);\n\
        vec2 px = vUv*uRes;\n\
        vec2 bc = 0.5*(uBox.xy+uBox.zw), bh = 0.5*(uBox.zw-uBox.xy);\n\
        float boxM = 1.0-smoothstep(0.0, uFeather, length(max(abs(px-bc)-bh, 0.0)));\n\
        float botM = 1.0-smoothstep(uBands.x, uBands.x+0.6*uFeather, px.y);\n\
        float topM = smoothstep(uBands.y-1.2*uFeather, uBands.y, px.y);\n\
        mapped *= mix(1.0, uBands.z, max(boxM, max(botM, topM)));\n\
        float n = hash(vUv*vec2(800.0,800.0)+time*13.0);\n\
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

  function createSim(glInfo, simW, simH, dyeW, dyeH, pressureIters) {
    var gl = glInfo.ctx;
    var filter = glInfo.supportsLinear === false ? gl.NEAREST : gl.LINEAR;
    var bloomW = Math.max(2, Math.round(dyeW / 4)), bloomH = Math.max(2, Math.round(dyeH / 4));
    return {
      glInfo: glInfo, gl: gl,
      simW: simW, simH: simH, dyeW: dyeW, dyeH: dyeH,
      pressureIters: pressureIters || 20,
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
    var velMul = Math.exp(-TUNE.vd * dt);   // momentum settles in ~1-2s
    var dyeMul = Math.exp(-TUNE.dd * dt);   // ink lingers ~6-10s (10% left at 8s)

    runProgram(gl, p.curl, function (u) {
      bindTex(gl, 0, sim.velocity.read.tex, u.uVelocity);
      gl.uniform2f(u.texelSize, ts[0], ts[1]);
    }, sim.curl);

    runProgram(gl, p.vorticity, function (u) {
      bindTex(gl, 0, sim.velocity.read.tex, u.uVelocity);
      bindTex(gl, 1, sim.curl.tex, u.uCurl);
      gl.uniform2f(u.texelSize, ts[0], ts[1]);
      gl.uniform1f(u.curlStrength, TUNE.curl);
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

    // Closure hoisted out of the loop: sim.pressureIters iterations must not
    // mean that many per-frame allocations for an uniform-setter that reads
    // live sim state. Fewer iterations on env.lowPower (see create()).
    var setPressureUniforms = function (u) {
      bindTex(gl, 0, sim.pressure.read.tex, u.uPressure);
      bindTex(gl, 1, sim.divergence.tex, u.uDivergence);
      gl.uniform2f(u.texelSize, ts[0], ts[1]);
    };
    for (var i = 0; i < sim.pressureIters; i++) {
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
      gl.uniform1f(u.edgeK, 0);
    }, sim.velocity.write);
    sim.velocity.swap();

    runProgram(gl, p.advect, function (u) {
      bindTex(gl, 0, sim.velocity.read.tex, u.uVelocity);
      bindTex(gl, 1, sim.dye.read.tex, u.uSource);
      gl.uniform2f(u.texelSize, ts[0], ts[1]);
      gl.uniform1f(u.dt, dt);
      gl.uniform1f(u.dissipation, dyeMul);
      gl.uniform1f(u.edgeK, 3.0 * dt);
    }, sim.dye.write);
    sim.dye.swap();
  }

  // Threshold the dye (only genuinely bright cores pass), blur twice
  // (separable, downsampled) for a soft halo rather than a tight ring, then
  // tone-map + composite straight onto the visible canvas. dayness (0..1)
  // only tints the background — the ink's own colour was already fixed when
  // it was splatted. The dye texture is re-sampled bilinearly inside the
  // display shader itself (dyeBilinear), so a plume reads smooth even when
  // the underlying FBO had to fall back to NEAREST.
  function setLook(gl, u, look) {
    gl.uniform1f(u.uTwo, look.two);
    gl.uniform3f(u.uColA, look.a[0], look.a[1], look.a[2]);
    gl.uniform3f(u.uColB, look.b[0], look.b[1], look.b[2]);
  }
  function renderSim(sim, gl, canvas, drawW, drawH, grainTime, dayness, mask, look) {
    var p = sim.programs;
    runProgram(gl, p.threshold, function (u) {
      bindTex(gl, 0, sim.dye.read.tex, u.uTexture);
      gl.uniform1f(u.thresh, TUNE.bth);
      setLook(gl, u, look);
    }, sim.bloomA);

    var texelBloom0 = 1 / sim.bloomW, texelBloom1 = 1 / sim.bloomH;
    var src = sim.bloomA, dst = sim.bloomB, i, tmp;
    // Both closures read src/dst by reference, so hoisting them out of the
    // loop is safe and turns per-pass allocations into 2 total.
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
    for (i = 0; i < 2; i++) {
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
    gl.uniform2f(p.display.uniforms.texelDye, 1 / sim.dyeW, 1 / sim.dyeH);
    gl.uniform1f(p.display.uniforms.time, grainTime || 0);
    gl.uniform1f(p.display.uniforms.grainAmt, 0.012);
    gl.uniform1f(p.display.uniforms.dayness, dayness == null ? 1 : dayness);
    gl.uniform1f(p.display.uniforms.expo, TUNE.expo);
    gl.uniform1f(p.display.uniforms.shade, TUNE.shade);
    gl.uniform1f(p.display.uniforms.core, TUNE.core);
    gl.uniform1f(p.display.uniforms.toe, TUNE.toe);
    gl.uniform1f(p.display.uniforms.bst, TUNE.bst);
    gl.uniform4f(p.display.uniforms.uBox, mask.x0, mask.y0, mask.x1, mask.y1);
    gl.uniform3f(p.display.uniforms.uBands, mask.bot, mask.top, 0.3);
    gl.uniform2f(p.display.uniforms.uRes, mask.w, mask.h);
    gl.uniform1f(p.display.uniforms.uFeather, mask.f);
    setLook(gl, p.display.uniforms, look);
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
      lastSplatT: 0,
      dragMoved: 0
    };

    // The no-WebGL poster has no simulation to read a colour from, so it is
    // tinted straight from the same D.hourColor the ink itself uses: the
    // main hour's colour plus its opposite, as two CSS custom properties.
    // Ink is the hour's colour pushed away from its own grey, so a pale key
    // such as the noon cream still glows as gold once it is light on black.
    function inkColor(min) {
      var c = D.hourColor(min), l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      for (var i = 0; i < 3; i++) c[i] = clamp(l + (c[i] - l) * TUNE.sat, 0, 1);
      return c;
    }
    function toCssTriplet(c) { return Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255); }
    function updatePosterTint(minutes) {
      dom.poster.style.setProperty('--lq-c1', toCssTriplet(D.hourColor(minutes)));
      dom.poster.style.setProperty('--lq-c2', toCssTriplet(D.hourColor(minutes + 720)));
    }

    // Reduced motion never runs the loop that would otherwise chase the
    // clock, so a scrub has to redraw the still frame itself, right here.
    // The poster tint updates on every scrub regardless of reduced motion,
    // since a device can land in the no-WebGL fallback independently of it.
    function handleClockChange(minutes, isNow) {
      updatePosterTint(minutes);
      if (reduced) { state.dayness = D.dayness(minutes); renderReducedFrame(false); }
    }
    var clock = HeroLab.clockScrubber(dom.root, env, handleClockChange);
    state.dayness = clock.dayness();
    updatePosterTint(clock.minutes());

    // Ink under the name and tagline, under the clock strip and under the
    // nav band at the top is dimmed, so the text keeps its contrast whatever
    // the fluid does. The rects are read from the live layout (text extents,
    // not block boxes), so the mask follows the words across breakpoints
    // and font loads. --lq-top-clear sets the nav band's height.
    var mask = { x0: 0, y0: 0, x1: 0, y1: 0, bot: 0, top: 1e4, w: 1, h: 1, f: 100 };
    function textRect(el) { var r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); }
    function updateMask() {
      var cr = dom.canvas.getBoundingClientRect();
      if (!cr.width || !cr.height) return;
      // All in CSS px from the canvas's bottom-left corner (GL's y runs up).
      var a = textRect(dom.name), b = textRect(dom.tagline), pad = 18;
      mask.w = cr.width; mask.h = cr.height;
      mask.x0 = Math.min(a.left, b.left) - pad - cr.left;
      mask.x1 = Math.max(a.right, b.right) + pad - cr.left;
      mask.y0 = cr.bottom - Math.max(a.bottom, b.bottom) - pad;
      mask.y1 = cr.bottom - Math.min(a.top, b.top) + pad;
      var strip = dom.root.querySelector('.hl-clock');
      mask.bot = strip ? cr.bottom - strip.getBoundingClientRect().top + 8 : 0;
      var topClear = parseFloat(getComputedStyle(dom.root).getPropertyValue('--lq-top-clear')) || 64;
      mask.top = cr.height - topClear;
      mask.f = clamp(0.12 * Math.max(cr.width, cr.height), 60, 150);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (!state.destroyed) { updateMask(); if (reduced) renderReducedFrame(false); } });

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
      state.lastInput = state.lastSplatT = performance.now();
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
      if (moved < 0.008) return;
      var now = performance.now(), dtp = Math.max(0.008, (now - state.lastSplatT) / 1000);
      state.lastSplatT = now;
      state.lastSplatPos = uv;
      // The push follows the pointer's real speed (UV/s, capped), converted
      // to sim texels/s, so a swipe throws a ribbon of light and a slow drag
      // leaves a thin trail instead of a fat stroke of paint.
      var vs = state.sim.velScale * 0.6, k = TUNE.pink, c = inkColor(clock.minutes());
      splat(state.sim, uv[0], uv[1], clamp(sdx / dtp, -3, 3) * vs, clamp(sdy / dtp, -3, 3) * vs, c[0] * k, c[1] * k, c[2] * k, TUNE.dr);
    }
    function onPointerUp(e) {
      if (state.activePointer !== e.pointerId) return;
      state.activePointer = null;
      state.lastInput = performance.now();
      // A tap bursts: six small jets of ink shoot outward from the point and
      // merge into a ring of colour that opens as it drifts. A cancelled
      // pointer (the page began to scroll) is not a tap.
      if (state.sim && e.type === 'pointerup' && state.dragMoved < 0.025) {
        var uv = state.dragLast, c = inkColor(clock.minutes()), k = TUNE.pink * 1.6;
        var vs = state.sim.velScale * TUNE.pv, asp = state.sim.simW / state.sim.simH;
        for (var i = 0; i < 6; i++) {
          var a = i * Math.PI / 3 + 0.3, ca = Math.cos(a), sa = Math.sin(a);
          splat(state.sim, uv[0] + ca * TUNE.po / asp, uv[1] + sa * TUNE.po, ca * vs, sa * vs, c[0] * k, c[1] * k, c[2] * k, TUNE.pr);
        }
      }
      try { dom.canvas.releasePointerCapture(e.pointerId); } catch (e0) {}
    }
    dom.canvas.addEventListener('pointerdown', onPointerDown);
    dom.canvas.addEventListener('pointermove', onPointerMove);
    dom.canvas.addEventListener('pointerup', onPointerUp);
    dom.canvas.addEventListener('pointercancel', onPointerUp);

    // Fewer Jacobi iterations on env.lowPower: the pressure solve is the
    // costliest step (one full pass per iteration at sim resolution), and a
    // touch/low-core device already runs a smaller sim grid too.
    var pressureIters = env.lowPower ? 14 : 20;

    function computeSimDims(w, h) {
      var longRatio = Math.max(w, h) / Math.max(1, Math.min(w, h));
      // A slightly finer velocity grid than round 4's (was 176/192) softens
      // the large-scale plume silhouette: vorticity confinement reads curl
      // off this grid, so its resolution is what made blob edges look
      // faceted rather than any texture-sampling issue.
      var simShort = clamp(Math.round(200 * state.scale), 110, 216);
      var simW = w >= h ? Math.round(simShort * longRatio) : simShort;
      var simH = w >= h ? simShort : Math.round(simShort * longRatio);
      // Dye targets the LONG side: about 1570 at the default desktop scale
      // (0.85), up to 1920 at the ?scale= test hook's max, 512 flat when
      // lowPower. Not floored unconditionally — genuine adaptive throttling
      // (state.scale -> 0.35) is still allowed to shrink it.
      var dyeLong = env.lowPower ? 512 : clamp(Math.round(1850 * state.scale), 640, 1920);
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
      state.sim = createSim(gl, d.simW, d.simH, d.dyeW, d.dyeH, pressureIters);
      state.sim.scale = state.scale;
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
          var d = computeSimDims(w, h), old = state.sim;
          var aOld = old.simW / old.simH, aNew = d.simW / d.simH;
          // A small change of shape (a phone's URL bar showing or hiding)
          // keeps the sim as it is: it lives in UV space, so the canvas just
          // stretches it a little. A real change of shape or of scale builds a
          // new sim and carries the ink and the flow across, never wipes them.
          if (Math.abs(aNew - aOld) > 0.12 * aOld || state.scale !== old.scale) {
            state.sim = createSim(state.glInfo, d.simW, d.simH, d.dyeW, d.dyeH, pressureIters);
            state.sim.scale = state.scale;
            carryOver(old, state.sim);
            destroySim(old);
          }
        }
      }
      updateMask();
      // Setting a canvas's size clears it, and a resize lands after that
      // frame's draw, so redraw now or every URL-bar change blinks black.
      if (reduced) renderReducedFrame(!stillReady);
      else if (state.sim) renderSim(state.sim, state.gl, dom.canvas, dom.canvas.width, dom.canvas.height, state.simTime, state.dayness, mask, LIVE);
    }

    function carryOver(from, to) {
      var gl = to.gl, p = to.programs;
      runProgram(gl, p.copy, function (u) { bindTex(gl, 0, from.dye.read.tex, u.uTexture); }, to.dye.write);
      to.dye.swap();
      // Velocity is stored in sim texels/s, so it rescales with the grid.
      runProgram(gl, p.clear, function (u) {
        bindTex(gl, 0, from.velocity.read.tex, u.uTexture);
        gl.uniform1f(u.value, to.velScale / from.velScale);
      }, to.velocity.write);
      to.velocity.swap();
    }

    // Reduced motion: the idle choreography runs offscreen once, with each
    // emitter's ink kept as an amount in its own channel (main in red,
    // opposite in green). Colour is applied only when drawn, so scrubbing the
    // clock recolours the same still frame at once instead of simulating it
    // again. The frame never animates.
    var LIVE = { two: 0, a: [1, 0, 0], b: [0, 1, 0] };
    var still = { two: 1, a: [1, 0, 0], b: [0, 1, 0] }, stillReady = false;
    var RED = [1, 0, 0], GREEN = [0, 1, 0];
    function renderReducedFrame(resim) {
      if (!state.sim) return;
      if (resim || !stillReady) {
        var acc = 0;
        state.simTime = 7; state.idleStrength = 1;
        for (var i = 0; i < 480; i++) {
          state.simTime += 1 / 60; acc += 1 / 60;
          if (acc > TUNE.ivl) { acc -= TUNE.ivl; emitIdle(EMIT_MAIN, MAIN_AMT, RED); emitIdle(EMIT_OPPOSITE, OPPOSITE_AMT, GREEN); }
          stepSim(state.sim, 1 / 60);
        }
        stillReady = true;
      }
      var m = clock.minutes();
      still.a = inkColor(m); still.b = inkColor(m + 720);
      renderSim(state.sim, state.gl, dom.canvas, dom.canvas.width, dom.canvas.height, 1, state.dayness, mask, still);
    }

    function emitIdle(e, amt, color) {
      var s = state.simTime;
      var x = e.cx + Math.sin(s * e.wx + e.px) * e.rx;
      var y = e.cy + Math.sin(s * e.wy + e.py) * e.ry;
      // Path derivative is in UV/second; the sim wants texels/second (see
      // sim.velScale) — without this scale-up the injected kick was ~500x
      // too small to move the dye at all, so it just sat at the splat point
      // looking like a static glow instead of streaming into a ribbon.
      var vs = state.sim.velScale * TUNE.vk;
      var dx = Math.cos(s * e.wx + e.px) * e.wx * e.rx * vs;
      var dy = Math.cos(s * e.wy + e.py) * e.wy * e.ry * vs;
      var k = state.idleStrength * amt;
      var ki = k * TUNE.ink;
      splat(state.sim, x, y, dx * k, dy * k, color[0] * ki, color[1] * ki, color[2] * ki, TUNE.rad);
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
      if (window.__lqStopAt && state.simTime >= window.__lqStopAt) return; // LAB ONLY
      var t0 = performance.now();
      // rawDt is real elapsed time, hard-capped only against a genuine stall
      // (e.g. tab resume) — NOT the usual 1/20 floor. Under slow software
      // rendering that floor made simulated time crawl far behind the clock,
      // so idle choreography and dissipation both under-ran a 3s screenshot.
      // Semi-Lagrangian advection has no CFL limit, so instead of shrinking
      // dt we SUBSTEP: however long the real frame took, stepSim() advances
      // by that much, in chunks no larger than ~1/60s each.
      var rawDt = FIXED || (state.lastT ? Math.min((t0 - state.lastT) / 1000, 0.5) : 1 / 60);
      state.lastT = t0;
      // Steps never exceed 1/60 s: longer ones let vorticity confinement
      // outrun the damping and sweep the stage empty. A device too slow for
      // four such steps a frame runs the fluid slower rather than unstable,
      // and the idle choreography follows fluid time, not the wall clock.
      var steps = FIXED ? Math.round(FIXED * 60) : Math.min(4, Math.max(1, Math.round(rawDt * 60)));
      var stepDt = FIXED ? 1 / 60 : Math.min(rawDt / steps, 1 / 60);
      rawDt = steps * stepDt;
      state.simTime += rawDt;
      window.__lqT = state.simTime;

      // Chase the clock's own dayness (it may have jumped, mid-drag) over
      // about 0.4s instead of snapping the palette straight to it.
      state.dayness += (clock.dayness() - state.dayness) * Math.min(1, rawDt / 0.4);

      var targetIdle = (t0 - state.lastInput) > 4000 ? 1 : 0;
      state.idleStrength += (targetIdle - state.idleStrength) * Math.min(1, rawDt * 1.5);
      if (state.idleStrength > 0.02) {
        state.idleAccum += rawDt;
        while (state.idleAccum > TUNE.ivl) {
          state.idleAccum -= TUNE.ivl;
          var nowMin = clock.minutes();
          emitIdle(EMIT_MAIN, MAIN_AMT, inkColor(nowMin));
          emitIdle(EMIT_OPPOSITE, OPPOSITE_AMT, inkColor(nowMin + 720));
        }
      }

      for (var s = 0; s < steps; s++) stepSim(state.sim, stepDt);
      renderSim(state.sim, state.gl, dom.canvas, dom.canvas.width, dom.canvas.height, state.simTime, state.dayness, mask, LIVE);

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
      what: 'A live fluid simulation that runs on Aman’s clock in India. New ink glows in the colour of the hour there: coral at dawn, gold through the day, rose at dusk and violet at night, with a thread of the opposite hour woven through it.',
      play: 'Drag to throw a ribbon of light through the ink and tap to burst a ring of colour. Drag the strip along the bottom to scrub through the day and watch the light and the ink change with it.',
      cost: 'Runs a full stable-fluids solver on the GPU with a soft glow pass and dithered tone mapping, at a resolution that adapts to the device and drops further on touch and low-core machines. Reduced motion shows one settled frame, simulated once and recoloured each time you scrub, and never animates; without WebGL it falls back to a static gradient poster. Shipping it costs a small lazy-loaded module on the home page only.'
    },
    create: create
  });
})();
