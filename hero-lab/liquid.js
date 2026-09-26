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
    '.lq-hero{position:absolute;left:0;right:0;bottom:0;padding:0 clamp(20px,4.5vw,64px) clamp(28px,6vh,64px);pointer-events:none}' +
    '.lq-hero::before{content:"";position:absolute;left:-10%;right:-10%;bottom:-14%;top:-30%;' +
      'background:radial-gradient(60% 100% at 24% 100%, rgba(5,7,12,0.82), transparent 72%);z-index:0}' +
    '.lq-name{position:relative;z-index:1;margin:0;font-family:"Source Serif 4",Georgia,serif;font-weight:600;' +
      'font-size:clamp(3rem,9vw,7.5rem);line-height:1.02;color:#dde6f2;letter-spacing:-0.01em;' +
      'text-shadow:0 2px 28px rgba(5,7,12,0.9),0 1px 2px rgba(5,7,12,0.7)}' +
    '.lq-tagline{position:relative;z-index:1;margin:0.5em 0 0;max-width:44ch;font-family:inherit;' +
      'font-size:clamp(0.85rem,1.6vw,1.05rem);line-height:1.5;color:#c3cddb;text-shadow:0 1px 14px rgba(5,7,12,0.85)}' +
    '.lq-status{position:relative;z-index:1;margin:0.9em 0 0;font-size:0.76rem;letter-spacing:0.03em;' +
      'color:#9fb0c3;text-shadow:0 1px 10px rgba(5,7,12,0.85)}' +
    '.lq-status b{color:#ffd9a8;font-weight:500}' +
    '.lq-links{position:relative;z-index:1;display:flex;gap:0.6em;margin-top:1.1em;flex-wrap:wrap;pointer-events:auto}' +
    '.lq-link{appearance:none;cursor:pointer;border:1px solid rgba(221,230,242,0.28);background:rgba(5,7,12,0.35);' +
      'color:#dde6f2;font:500 0.78rem/1 inherit;letter-spacing:0.02em;padding:0.68em 1.15em;border-radius:999px;' +
      'transition:border-color .18s ease,background .18s ease}' +
    '.lq-link:hover{border-color:rgba(255,179,92,0.7);background:rgba(5,7,12,0.55)}' +
    '.lq-link:focus-visible{outline:2px solid #9b8cff;outline-offset:2px}' +
    '.lq-hint{position:absolute;left:clamp(20px,4.5vw,64px);top:clamp(16px,4vh,40px);z-index:1;' +
      'font-size:0.72rem;letter-spacing:0.04em;color:rgba(221,230,242,0.55);' +
      'text-shadow:0 1px 10px rgba(5,7,12,0.85);transition:opacity 1.1s ease;pointer-events:none}' +
    '.lq-hint.lq-hidden{opacity:0}' +
    '.lq-words{position:absolute;inset:0}' +
    '.lq-word{position:absolute;transform:translate(-50%,-50%);appearance:none;border:0;background:transparent;' +
      'color:transparent;font:500 0.68rem/1 inherit;padding:0.6em 0.9em;margin:0;cursor:pointer;' +
      'pointer-events:none;white-space:nowrap;border-radius:6px}' +
    '.lq-word:focus-visible{pointer-events:auto;outline:2px solid #9b8cff;outline-offset:3px;background:rgba(5,7,12,0.5)}' +
    '.lq-word.lq-revealed{pointer-events:auto}' +
    '@media (max-width:640px){.lq-tagline{display:none}.lq-hint{display:none}}';

  var WORD_TITLE = 'the ink shows you what I’ve built';

  function buildDom(host, env, D) {
    var root = document.createElement('div');
    root.className = 'lq-root';
    var style = document.createElement('style');
    style.textContent = STYLE;
    root.appendChild(style);

    var canvas = document.createElement('canvas');
    canvas.className = 'lq-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Liquid light: a live fluid simulation where warm amber and cool violet ink swirl, collide and mix.');
    root.appendChild(canvas);

    var poster = document.createElement('div');
    poster.className = 'lq-poster';
    root.appendChild(poster);

    var overlay = document.createElement('div');
    overlay.className = 'lq-overlay';
    root.appendChild(overlay);

    var hint = document.createElement('p');
    hint.className = 'lq-hint';
    hint.textContent = 'stir the ink';
    overlay.appendChild(hint);

    var wordsWrap = document.createElement('div');
    wordsWrap.className = 'lq-words';
    wordsWrap.setAttribute('aria-label', WORD_TITLE);
    overlay.appendChild(wordsWrap);

    var hero = document.createElement('div');
    hero.className = 'lq-hero';
    var h1 = document.createElement('h1');
    h1.className = 'lq-name';
    h1.textContent = D.name;
    var tagline = document.createElement('p');
    tagline.className = 'lq-tagline';
    tagline.textContent = D.line;
    var status = document.createElement('p');
    status.className = 'lq-status';
    var links = document.createElement('div');
    links.className = 'lq-links';
    D.sections.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'lq-link';
      b.textContent = s.label;
      b.addEventListener('click', function () { env.openLink(s.path, 'page'); });
      links.appendChild(b);
    });
    hero.appendChild(h1);
    hero.appendChild(tagline);
    hero.appendChild(status);
    hero.appendChild(links);
    overlay.appendChild(hero);

    host.appendChild(root);
    return { root: root, canvas: canvas, poster: poster, overlay: overlay, hint: hint, wordsWrap: wordsWrap, status: status };
  }

  function fmtCountdown(ms) {
    ms = Math.max(0, ms);
    var s = Math.floor(ms / 1000);
    var hh = Math.floor(s / 3600);
    var mm = Math.floor((s % 3600) / 60);
    var ss = s % 60;
    function p2(n) { return n < 10 ? '0' + n : '' + n; }
    return p2(hh) + ':' + p2(mm) + ':' + p2(ss);
  }

  // Seeded, non-overlapping-ish word layout that avoids the bottom-left hero block.
  function layoutWords(words, w, h) {
    var rand = mulberry32(seedFromString('liquid-words-v1'));
    var cols = 7, rows = 5;
    var cells = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) cells.push({ c: c, r: r });
    for (var i = cells.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = cells[i]; cells[i] = cells[j]; cells[j] = t;
    }
    var heroSafeX = w * 0.62, heroSafeY = h * 0.42; // bottom-left hero block keep-out
    var out = [];
    var ci = 0;
    for (var k = 0; k < words.length && ci < cells.length; ci++) {
      var cell = cells[ci];
      var cx = (cell.c + 0.5) / cols * w;
      var cy = (cell.r + 0.5) / rows * h;
      if (cx < heroSafeX && cy > heroSafeY) continue; // inside hero keep-out
      var jitterX = (rand() - 0.5) * (w / cols) * 0.55;
      var jitterY = (rand() - 0.5) * (h / rows) * 0.55;
      out.push({ item: words[k], x: clamp(cx + jitterX, 24, w - 24), y: clamp(cy + jitterY, 20, h - 20) });
      k++;
    }
    return out;
  }

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
        gl_FragColor = vec4(c*smoothstep(thresh, thresh+0.35, l), 1.0);\n\
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
      uniform sampler2D uDye; uniform sampler2D uBloom; uniform sampler2D uMask;\n\
      uniform float time; uniform float grainAmt;\n\
      float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }\n\
      void main(){\n\
        vec3 c = max(texture2D(uDye, vUv).rgb, 0.0);\n\
        vec3 bloom = max(texture2D(uBloom, vUv).rgb, 0.0);\n\
        vec3 mixed = c + bloom*0.85;\n\
        vec3 mapped = mixed/(1.0+mixed*0.55);\n\
        mapped = pow(mapped, vec3(0.82));\n\
        float luma = dot(c, vec3(0.299,0.587,0.114));\n\
        float m = texture2D(uMask, vUv).r;\n\
        float reveal = m*smoothstep(0.16, 0.55, luma);\n\
        mapped += reveal*vec3(1.0,0.9,0.74)*0.85;\n\
        float n = hash(vUv*vec2(1024.0,1024.0)+time);\n\
        mapped += (n-0.5)*grainAmt;\n\
        vec3 bg = vec3(0.0196,0.0275,0.0471);\n\
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
    return {
      glInfo: glInfo, gl: gl,
      simW: simW, simH: simH, dyeW: dyeW, dyeH: dyeH,
      texelSim: [1 / simW, 1 / simH], texelDye: [1 / dyeW, 1 / dyeH],
      velocity: createDouble(glInfo, simW, simH, filter),
      dye: createDouble(glInfo, dyeW, dyeH, filter),
      divergence: createFBO(glInfo, simW, simH, gl.NEAREST),
      curl: createFBO(glInfo, simW, simH, gl.NEAREST),
      pressure: createDouble(glInfo, simW, simH, gl.NEAREST),
      bloomA: null, bloomB: null, maskTex: null, readTarget: null,
      programs: glInfo.programs
    };
  }
  function destroySim(sim) {
    if (!sim) return;
    var gl = sim.gl;
    function kill(t) { if (!t) return; gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    function killD(d) { kill(d.read); kill(d.write); }
    killD(sim.velocity); killD(sim.dye); killD(sim.pressure);
    kill(sim.divergence); kill(sim.curl); kill(sim.bloomA); kill(sim.bloomB); kill(sim.readTarget);
    if (sim.maskTex) gl.deleteTexture(sim.maskTex);
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
      gl.uniform1f(u.curlStrength, 24.0);
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

    for (var i = 0; i < 20; i++) {
      runProgram(gl, p.pressure, function (u) {
        bindTex(gl, 0, sim.pressure.read.tex, u.uPressure);
        bindTex(gl, 1, sim.divergence.tex, u.uDivergence);
        gl.uniform2f(u.texelSize, ts[0], ts[1]);
      }, sim.pressure.write);
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

  function renderSim(sim, gl, canvas, drawW, drawH, grainSeed) {}
  function readRevealMask(sim, gl) { return null; }
  // --------------------------------------------

  function create(host, env) {
    var D = env.data;
    var dom = buildDom(host, env, D);
    var reduced = !!env.reduced;

    var state = {
      inited: false,
      running: false,
      gl: null,
      isWebGL2: false,
      sim: null,
      w: 0, h: 0,
      dpr: clamp(env.dpr || 1, 1, 2),
      scale: env.lowPower ? 0.5 : 0.85,
      raf: 0,
      lastT: 0,
      clockTimer: 0,
      revealTimer: 0,
      wordSpots: [],
      wordEls: [],
      lastInput: -1e9,
      hintShown: true,
      destroyed: false,
      frameAvg: 16,
      hidden: document.hidden
    };

    function updateStatus() {
      var next = D.msToNextDaily ? D.msToNextDaily() : 0;
      dom.status.innerHTML = '<b>' + D.counts.tools + '</b> tools &middot; <b>' + D.counts.games +
        '</b> games &middot; <b>' + D.counts.writing + '</b> writing &middot; next daily in ' + fmtCountdown(next);
    }

    function buildWordButtons(w, h) {
      var items = [];
      D.tools.forEach(function (t) { items.push({ kind: 'tool', slug: t.slug, name: t.name }); });
      D.games.forEach(function (g) { items.push({ kind: 'game', slug: g.slug, name: g.name }); });
      dom.wordsWrap.innerHTML = '';
      state.wordEls = [];
      var spots = layoutWords(items, w, h);
      state.wordSpots = spots;
      spots.forEach(function (spot, idx) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'lq-word';
        b.style.left = spot.x + 'px';
        b.style.top = spot.y + 'px';
        b.textContent = spot.item.name;
        b.setAttribute('aria-label', spot.item.name + (spot.item.kind === 'tool' ? ', tool' : ', game'));
        b.addEventListener('focus', function () { onWordFocus(idx); });
        b.addEventListener('click', function () { env.openLink(D.paths(spot.item.kind, spot.item.slug), spot.item.kind); });
        dom.wordsWrap.appendChild(b);
        state.wordEls.push(b);
      });
    }

    function onWordFocus(idx) {
      var spot = state.wordSpots[idx];
      if (!spot || !state.sim) return;
      splat(state.sim, spot.x / state.w, 1 - spot.y / state.h, 0, 0, 1, 1, 1, 0.12);
    }

    function hideHint() {
      if (!state.hintShown) return;
      state.hintShown = false;
      dom.hint.classList.add('lq-hidden');
    }

    function fallbackToPoster() {
      dom.root.classList.add('lq-fallback');
    }

    function computeSimDims(w, h) {
      var longRatio = Math.max(w, h) / Math.max(1, Math.min(w, h));
      var simShort = clamp(Math.round(176 * state.scale), 96, 192);
      var simW = w >= h ? Math.round(simShort * longRatio) : simShort;
      var simH = w >= h ? simShort : Math.round(simShort * longRatio);
      var dyeShort = clamp(Math.round((env.lowPower ? 512 : 900) * state.scale), 384, 1024);
      var dyeW = w >= h ? Math.round(dyeShort * longRatio) : dyeShort;
      var dyeH = w >= h ? dyeShort : Math.round(dyeShort * longRatio);
      return { simW: simW, simH: simH, dyeW: dyeW, dyeH: dyeH };
    }

    function setup(w, h) {
      state.w = w; state.h = h;
      buildWordButtons(w, h);
      updateStatus();
      var gl = createGL(dom.canvas);
      if (!gl) { fallbackToPoster(); state.inited = true; return; }
      state.glInfo = gl; state.gl = gl.ctx; state.isWebGL2 = gl.isWebGL2;
      var d = computeSimDims(w, h);
      state.sim = createSim(gl, d.simW, d.simH, d.dyeW, d.dyeH);
      buildMask(state.sim, state.wordSpots, w, h);
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
        buildWordButtons(w, h);
        if (state.sim && state.glInfo) {
          destroySim(state.sim); state.sim = null;
          var d = computeSimDims(w, h);
          state.sim = createSim(state.glInfo, d.simW, d.simH, d.dyeW, d.dyeH);
          buildMask(state.sim, state.wordSpots, w, h);
        }
      }
      if (reduced) renderReducedFrame();
    }

    function renderReducedFrame() {
      if (!state.sim) return;
      var rand = mulberry32(seedFromString('liquid-reduced-v1'));
      for (var i = 0; i < 120; i++) {
        if (i % 14 === 0) {
          var side = (i / 14) % 2 < 1 ? 0 : 1;
          var x = side === 0 ? 0.18 + rand() * 0.18 : 0.64 + rand() * 0.18;
          var y = 0.25 + rand() * 0.5;
          var col = side === 0 ? [1, 0.4, 0] : [0, 0.35, 1];
          splat(state.sim, x, y, (rand() - 0.5) * 0.8, (rand() - 0.5) * 0.8, col[0], col[1], col[2], 0.22);
        }
        stepSim(state.sim, 1 / 60);
      }
      renderSim(state.sim, state.gl, dom.canvas, dom.canvas.width, dom.canvas.height, 1);
    }

    function start() {
      if (state.destroyed) return;
      state.hidden = false;
      if (!state.clockTimer) state.clockTimer = setInterval(updateStatus, 1000);
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
      if (state.clockTimer) { clearInterval(state.clockTimer); state.clockTimer = 0; }
      if (state.revealTimer) { clearInterval(state.revealTimer); state.revealTimer = 0; }
    }

    function loop(t) {
      if (!state.running) return;
      state.raf = requestAnimationFrame(loop);
      // filled in next pass: dt calc, idle emitters, stepSim, renderSim, adaptive scale
    }

    function destroy() {
      state.destroyed = true;
      stop();
      if (state.sim) { destroySim(state.sim); state.sim = null; }
      host.removeEventListener && 0;
      if (dom.root.parentNode) dom.root.parentNode.removeChild(dom.root);
    }

    return { start: start, stop: stop, resize: doResize, destroy: destroy };
  }

  HeroLab.register({
    id: 'liquid',
    label: 'Liquid light',
    notes: {
      what: 'A live fluid simulation: warm amber (day) and violet (night) ink pour in and collide in real GPU-simulated liquid.',
      play: 'Drag to stir the ink, click to drop a burst of it. Dense flow lights up the names of the tools and games hidden underneath — tab through them too, each stop reveals one.',
      cost: 'Runs a full stable-fluids solver on the GPU at adaptive resolution. Reduced motion shows one settled frame instead of the live sim; without WebGL it falls back to a static gradient poster. Shipping it costs a small lazy-loaded module on the home page only.'
    },
    create: create
  });
})();
