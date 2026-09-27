/* Black hole — Hero Lab concept. Plain JS, no imports, calls HeroLab.register once. */
(function () {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var DAY = { r: 255, g: 179, b: 92 };     // #ffb35c
  var DAY_HOT = { r: 255, g: 226, b: 184 }; // #ffe2b8
  var NIGHT = { r: 155, g: 140, b: 255 };  // #9b8cff
  var NIGHT_DEEP = { r: 27, g: 20, b: 82 }; // #1b1452
  var BG = '#05070c';

  function create(host, env) {
    var doc = host.ownerDocument;
    var win = doc.defaultView || window;
    var reduced = !!env.reduced;
    var D = env.data;

    var root = doc.createElement('div');
    root.className = 'bh-root';
    root.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
    host.appendChild(root);

    var style = doc.createElement('style');
    style.textContent = cssText();
    root.appendChild(style);

    // ---- DOM: canvas stack, sr-only heading, halo
    var canvas = doc.createElement('canvas');
    canvas.className = 'bh-gl';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'A black hole drifting across the page, bending starlight and the name Aman Panjwani around it, with a glowing tilted accretion disk.');
    root.appendChild(canvas);

    var overlay = doc.createElement('canvas');
    overlay.className = 'bh-fx';
    overlay.setAttribute('aria-hidden', 'true');
    root.appendChild(overlay);

    var h1 = doc.createElement('h1');
    h1.className = 'bh-sr';
    h1.textContent = D.name;
    root.appendChild(h1);
    var srTag = doc.createElement('p');
    srTag.className = 'bh-sr';
    srTag.textContent = D.line;
    root.appendChild(srTag);

    var halo = doc.createElement('div');
    halo.className = 'bh-halo';
    root.appendChild(halo);

    // ---- shared mutable state
    var startDayness = D.dayness(D.localMinutes());
    var S = {
      doc: doc, win: win, reduced: reduced, env: env, D: D,
      root: root, canvas: canvas, overlay: overlay, halo: halo,
      gl: null, glOk: false, poster: false,
      w: 0, h: 0, dpr: clamp(env.dpr || 1, 1, 2),
      scale: env.lowPower ? 0.5 : 0.75,
      rw: 0, rh: 0,
      texCanvas: null, texCtx: null, texW: 0, texH: 0,
      rng: mulberry32(20260925),
      holeX: 0, holeY: 0, holeVX: 0, holeVY: 0, dragging: false, pointerId: null, dragDX: 0, dragDY: 0,
      moved: 0, downX: 0, downY: 0,
      rsBase: 60, massMul: 1, t0: 0, lastT: 0, running: false, rafId: 0,
      frameTimes: [], frameIdx: 0,
      comets: [],
      // Round 3: dayness (0 night .. 1 day) drives disk heat, star/ring grade and
      // the name's glow. `dayness` is the eased value the renderer reads every
      // frame; `targetDayness` is what the shared clock scrubber last reported.
      dayness: startDayness, targetDayness: startDayness, clock: null
    };

    attachPointer(S);
    attachWheel(S);

    var gl = getGL(canvas);
    if (gl) {
      S.gl = gl; S.glOk = initGL(S);
    }
    if (!S.glOk) buildPoster(S);

    try {
      if (doc.fonts && doc.fonts.ready) {
        doc.fonts.ready.then(function () {
          if (S.destroyed) return;
          if (S.glOk) buildBackgroundTexture(S);
          if (S.reduced) renderOnce(S);
        });
      }
    } catch (e) {}

    // Round 3: the shared clock scrubber is the only status/UI chrome left.
    // Create it last so it sits on top; drive dayness from it, easing toward
    // its value in the render loop instead of snapping (unless reduced).
    S.clock = win.HeroLab.clockScrubber(root, env, function (minutes) {
      S.targetDayness = D.dayness(minutes);
      if (S.reduced) S.dayness = S.targetDayness;
      updatePoster(S);
      if (S.reduced) renderOnce(S);
    });

    return {
      start: function () { S.clock.start(); startLoop(S); },
      stop: function () { stopLoop(S); S.clock.stop(); },
      resize: function (w, h) { doResize(S, w, h); },
      destroy: function () { S.clock.destroy(); doDestroy(S); }
    };
  }

  // ==== CSS ====
  function cssText() {
    return '' +
      '.bh-root{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}' +
      '.bh-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;}' +
      '.bh-fx{pointer-events:none;}' +
      '.bh-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;margin:-1px;padding:0;border:0;}' +
      '.bh-halo{position:absolute;left:0;right:0;bottom:0;height:38%;pointer-events:none;background:radial-gradient(120% 100% at 50% 100%, rgba(2,3,7,.72), rgba(2,3,7,.3) 55%, transparent 80%);}' +
      '.bh-root.is-poster canvas,.bh-root.is-poster .bh-fx{display:none;}' +
      '.bh-poster-name{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);margin:0;text-align:center;font:600 clamp(2.4rem,8vw,6.4rem) "Source Serif 4",Georgia,serif;color:#eef2fb;text-shadow:0 0 40px var(--bh-glow,rgba(120,105,220,.55)),0 2px 20px rgba(0,0,0,.6);z-index:2;width:92%;}' +
      '.bh-poster-tag{position:absolute;left:50%;top:44%;transform:translate(-50%,60%);margin:0;text-align:center;font:400 clamp(.85rem,1.8vw,1.15rem) "Source Serif 4",Georgia,serif;color:rgba(221,230,242,.82);z-index:2;width:70%;}' +
      '.bh-poster{position:absolute;inset:0;background:' +
        'radial-gradient(38% 46% at 62% 38%, var(--bh-p1,rgba(255,179,92,.24)), transparent 60%),' +
        'radial-gradient(46% 56% at 34% 66%, var(--bh-p2,rgba(155,140,255,.28)), transparent 62%),' +
        'radial-gradient(9% 9% at 50% 50%, #000 60%, rgba(0,0,0,0) 100%),' +
        '#05070c;}';
  }

  // ==== GL: shaders + setup ====
  var VERT_SRC = 'attribute vec2 aPos;\nvoid main(){gl_Position=vec4(aPos,0.0,1.0);}';
  var FRAG_SRC = [
    'precision highp float;',
    'uniform vec2 uResolution; uniform sampler2D uTex; uniform vec2 uHole; uniform float uRs; uniform float uTime;',
    'uniform vec3 uDay; uniform vec3 uDayHot; uniform vec3 uNight; uniform vec3 uNightDeep; uniform float uDayness;',
    'float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
    'float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);float a=hash21(i),b=hash21(i+vec2(1.0,0.0)),c=hash21(i+vec2(0.0,1.0)),d=hash21(i+vec2(1.0,1.0));vec2 u=f*f*(3.0-2.0*f);return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y;}',
    'float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*vnoise(p);p*=2.02;a*=0.55;}return v;}',
    'void main(){',
    '  vec2 frag = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);',
    '  vec2 rel = frag - uHole;',
    '  float dist = length(rel);',
    '  vec2 dir = dist > 0.0001 ? rel/dist : vec2(0.0,1.0);',
    '  float shadowR = uRs*2.6;',
    '  float defl = (6.0*uRs*uRs) / max(dist, uRs*0.3);',
    '  vec2 sampPos = frag - dir*defl;',
    '  vec2 uv = clamp(sampPos/uResolution, 0.0, 1.0);',
    '  vec3 col = texture2D(uTex, uv).rgb;',
    '  float inclCos = 0.34;',
    '  float diskOpacity = 0.0; vec3 diskCol = vec3(0.0); float kepT = uTime*0.6;',
    '  for(int pass=0; pass<2; pass++){',
    '    vec2 r2 = rel; float squash = inclCos; float sgn = 1.0;',
    '    if(pass==1){ r2 = vec2(rel.x, -abs(rel.y)*0.62 - uRs*0.15); squash = inclCos*0.85; sgn = -1.0; }',
    '    vec2 dRel = vec2(r2.x, r2.y/squash);',
    '    float dR = length(dRel);',
    '    float dAng = atan(dRel.y, dRel.x);',
    '    float inner = uRs*1.15; float outer = uRs*7.5;',
    '    float band = smoothstep(inner, inner+uRs*0.7, dR) * (1.0 - smoothstep(outer-uRs*2.4, outer, dR));',
    '    if(band > 0.001){',
    '      float kepler = kepT*(1.0/pow(max(dR/uRs,0.4),1.5));',
    '      float turb = fbm(vec2(dAng*2.6 + sgn*kepler, dR*0.045 - kepT*0.15));',
    '      float t = clamp((dR-inner)/max(outer-inner,1.0),0.0,1.0);',
    '      vec3 innerCol = mix(mix(uNight, vec3(1.0,0.97,0.93), 0.45), uDayHot, uDayness);',
    '      vec3 outerCol = mix(uNightDeep, uDay, uDayness);',
    '      vec3 base = mix(innerCol, outerCol, smoothstep(0.0,1.0,t));',
    '      float approach = smoothstep(-1.0, 1.0, cos(dAng)*sgn);',
    '      float beam = mix(0.55, 1.65, approach);',
    '      vec3 hotEdge = mix(vec3(0.85,0.8,1.0), uDayHot, uDayness);',
    '      vec3 beamed = mix(base*0.7, mix(base, hotEdge, 0.5), approach);',
    '      float density = band*(0.7+0.75*turb)*beam;',
    '      density *= pass==0 ? 1.0 : 0.4;',
    '      density *= smoothstep(shadowR*0.98, shadowR*1.35, dist);',
    '      diskCol += beamed*density; diskOpacity += density;',
    '    }',
    '  }',
    '  col = col*(1.0-clamp(diskOpacity,0.0,1.0)) + diskCol;',
    '  float ringW = max(1.6, uRs*0.02);',
    '  float ring = exp(-pow((dist-shadowR)/ringW, 2.0));',
    '  vec3 ringCol = mix(uNight, vec3(1.0,0.98,0.94), uDayness);',
    '  col += ring*ringCol*mix(0.9,1.7,uDayness);',
    '  vec3 grade = mix(vec3(0.84,0.8,1.14), vec3(1.14,1.03,0.82), uDayness);',
    '  col *= grade;',
    '  float inside = 1.0 - smoothstep(shadowR-2.0, shadowR, dist);',
    '  col = mix(col, vec3(0.0), inside);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compileShader(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('blackhole shader error', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function getGL(canvas) {
    var opts = { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
    try {
      return canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    } catch (e) { return null; }
  }

  function initGL(S) {
    var gl = S.gl;
    try {
      var vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
      var fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
      if (!vs || !fs) return false;
      var prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('blackhole link error', gl.getProgramInfoLog(prog));
        return false;
      }
      gl.useProgram(prog);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

      S.prog = prog; S.tex = tex; S.quadBuf = buf;
      S.u = {
        res: gl.getUniformLocation(prog, 'uResolution'),
        tex: gl.getUniformLocation(prog, 'uTex'),
        hole: gl.getUniformLocation(prog, 'uHole'),
        rs: gl.getUniformLocation(prog, 'uRs'),
        time: gl.getUniformLocation(prog, 'uTime'),
        day: gl.getUniformLocation(prog, 'uDay'),
        dayHot: gl.getUniformLocation(prog, 'uDayHot'),
        night: gl.getUniformLocation(prog, 'uNight'),
        nightDeep: gl.getUniformLocation(prog, 'uNightDeep'),
        dayness: gl.getUniformLocation(prog, 'uDayness')
      };
      gl.clearColor(0.02, 0.027, 0.047, 1);
      return true;
    } catch (e) {
      console.error('blackhole GL init failed', e);
      return false;
    }
  }

  function uploadBackgroundTexture(S) {
    if (!S.glOk || !S.texCanvas) return;
    var gl = S.gl;
    gl.bindTexture(gl.TEXTURE_2D, S.tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, S.texCanvas);
    } catch (e) { console.error('blackhole texture upload failed', e); }
  }
  function buildPoster(S) {
    S.poster = true;
    S.root.classList.add('is-poster');
    var bg = S.doc.createElement('div');
    bg.className = 'bh-poster';
    S.root.insertBefore(bg, S.root.firstChild);
    S.h1El = S.root.querySelector('h1');
    if (S.h1El) S.h1El.className = 'bh-poster-name';
    var tag = S.root.querySelectorAll('.bh-sr')[0];
    if (tag) tag.className = 'bh-poster-tag';
  }
  function layoutPoster(S) {}

  // No-WebGL fallback still answers the clock: nudge the poster's glow and
  // gradient stops toward violet at night, amber-white by day.
  function updatePoster(S) {
    if (!S.poster) return;
    var d = clamp(S.dayness, 0, 1);
    var r = Math.round(120 + (255 - 120) * d), g = Math.round(105 + (200 - 105) * d), b = Math.round(220 + (150 - 220) * d);
    S.root.style.setProperty('--bh-glow', 'rgba(' + r + ',' + g + ',' + b + ',.55)');
    S.root.style.setProperty('--bh-p1', 'rgba(255,179,92,' + (0.12 + 0.18 * d) + ')');
    S.root.style.setProperty('--bh-p2', 'rgba(155,140,255,' + (0.12 + 0.18 * (1 - d)) + ')');
  }

  // ==== comets ====
  function spawnComet(S, x, y) {
    if (S.comets.length >= 12) S.comets.shift();
    var ang = S.rng() * Math.PI * 2;
    var speed = 70 + S.rng() * 110;
    S.comets.push({ x: x, y: y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, age: 0, trail: [], flash: 0 });
  }

  function stepComets(S, dt) {
    var GM = S.rs * S.rs * 2600;
    var GM2 = S.rs * S.rs * S.rs * 90000;
    for (var i = S.comets.length - 1; i >= 0; i--) {
      var c = S.comets[i];
      if (c.flash > 0) {
        c.flash -= dt * 2.2;
        if (c.flash <= 0) S.comets.splice(i, 1);
        continue;
      }
      var dx = S.holeX - c.x, dy = S.holeY - c.y;
      var r = Math.sqrt(dx * dx + dy * dy) + 0.0001;
      var nx = dx / r, ny = dy / r;
      var a = GM / (r * r);
      var a2 = GM2 / (r * r * r);
      var ax = nx * a + (-ny) * a2, ay = ny * a + nx * a2;
      c.vx += ax * dt; c.vy += ay * dt;
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.age += dt;
      c.trail.push({ x: c.x, y: c.y });
      if (c.trail.length > 16) c.trail.shift();
      if (r < S.rs * 1.05) { c.flash = 1; c.vx = 0; c.vy = 0; continue; }
      if (c.age > 26 || c.x < -240 || c.x > S.w + 240 || c.y < -240 || c.y > S.h + 240) S.comets.splice(i, 1);
    }
  }

  function drawComets(S) {
    var ctx = S.octx;
    if (!ctx) return;
    var dpr2 = S.overlay.width / Math.max(1, S.w);
    ctx.setTransform(dpr2, 0, 0, dpr2, 0, 0);
    ctx.clearRect(0, 0, S.w, S.h);
    for (var i = 0; i < S.comets.length; i++) {
      var c = S.comets[i];
      if (c.flash > 0) {
        var rad = (1 - c.flash) * S.rs * 1.6 + 3;
        ctx.globalAlpha = clamp(c.flash, 0, 1);
        var g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rad);
        g.addColorStop(0, 'rgba(255,240,220,0.95)');
        g.addColorStop(1, 'rgba(255,240,220,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(c.x, c.y, rad, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      var tr = c.trail;
      for (var j = 0; j < tr.length; j++) {
        var a = (j / tr.length);
        ctx.globalAlpha = a * 0.5;
        ctx.fillStyle = '#ffe9c8';
        ctx.beginPath(); ctx.arc(tr[j].x, tr[j].y, 1.6 * a + 0.3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff8ec';
      ctx.beginPath(); ctx.arc(c.x, c.y, 2.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ==== background texture: stars, galactic band, name + tagline ====
  function buildBackgroundTexture(S) {
    var texScale = clamp(S.dpr, 1, 2);
    var texW = Math.round(S.w * texScale), texH = Math.round(S.h * texScale);
    var long = Math.max(texW, texH);
    if (long > 2048) { var f = 2048 / long; texW = Math.round(texW * f); texH = Math.round(texH * f); }
    texW = Math.max(2, texW); texH = Math.max(2, texH);
    if (!S.texCanvas) { S.texCanvas = S.doc.createElement('canvas'); S.texCtx = S.texCanvas.getContext('2d'); }
    var c = S.texCanvas, ctx = S.texCtx;
    c.width = texW; c.height = texH;
    S.texW = texW; S.texH = texH;

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, texW, texH);

    // galactic band: soft diagonal wash + a few darker dust streaks
    ctx.save();
    ctx.translate(texW / 2, texH / 2);
    ctx.rotate(-0.42);
    var bandLen = Math.max(texW, texH) * 1.6, bandW = texH * 0.5;
    var bandGrad = ctx.createLinearGradient(0, -bandW / 2, 0, bandW / 2);
    bandGrad.addColorStop(0, 'rgba(120,110,180,0)');
    bandGrad.addColorStop(0.5, 'rgba(150,140,210,0.10)');
    bandGrad.addColorStop(1, 'rgba(120,110,180,0)');
    ctx.fillStyle = bandGrad;
    ctx.fillRect(-bandLen / 2, -bandW / 2, bandLen, bandW);
    var rngBand = mulberry32(7);
    for (var d = 0; d < 10; d++) {
      var dx = (rngBand() - 0.5) * bandLen * 0.9, dw = bandLen * (0.05 + rngBand() * 0.12), dh = bandW * (0.12 + rngBand() * 0.22);
      ctx.fillStyle = 'rgba(3,4,8,' + (0.18 + rngBand() * 0.22) + ')';
      ctx.beginPath();
      ctx.ellipse(dx, (rngBand() - 0.5) * bandW * 0.5, dw, dh, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // starfield: power-law size/brightness, warm amber <-> cool violet-white
    var rng = mulberry32(20260925);
    var count = clamp(Math.round((texW * texH) / 1500), 900, 7000);
    for (var i = 0; i < count; i++) {
      var x = rng() * texW, y = rng() * texH;
      var p = Math.pow(rng(), 3.2);
      var r = 0.35 + p * 2.6;
      var bright = 0.35 + p * 0.65 + rng() * 0.1;
      var warm = rng();
      var cr, cg, cb;
      if (warm < 0.5) { cr = 255; cg = Math.round(210 + warm * 70); cb = Math.round(150 + warm * 210); }
      else { cr = Math.round(190 + (1 - warm) * 130); cg = Math.round(190 + (1 - warm) * 110); cb = 255; }
      ctx.globalAlpha = clamp(bright, 0, 1);
      ctx.fillStyle = 'rgb(' + cr + ',' + cg + ',' + cb + ')';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (p > 0.55) {
        ctx.globalAlpha = clamp(bright * 0.25, 0, 0.4);
        ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // name + tagline, drawn into the lensable texture, fit to the stage width
    var targetW = texW * 0.86;
    var nameSize = clamp(texW * 0.088, texW * 0.06, texW * 0.15); // clamp is the max, fit shrinks it further
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 ' + Math.round(nameSize) + 'px "Source Serif 4", Georgia, serif';
    var measured = ctx.measureText(S.D.name).width;
    if (measured > targetW) {
      nameSize = Math.max(10, nameSize * (targetW / measured));
      ctx.font = '600 ' + Math.round(nameSize) + 'px "Source Serif 4", Georgia, serif';
    }
    ctx.shadowColor = 'rgba(120,105,220,0.55)';
    ctx.shadowBlur = nameSize * 0.18;
    ctx.fillStyle = '#eef2fb';
    var nameY = texH / 2;
    ctx.fillText(S.D.name, texW / 2, nameY);
    ctx.shadowBlur = 0;
    var tagSize = Math.round(nameSize * 0.185);
    ctx.font = '400 ' + tagSize + 'px "Source Serif 4", Georgia, serif';
    var tagText = S.D.line;
    if (ctx.measureText(tagText).width > targetW) {
      tagSize = Math.max(8, Math.round(tagSize * (targetW / ctx.measureText(tagText).width)));
      ctx.font = '400 ' + tagSize + 'px "Source Serif 4", Georgia, serif';
    }
    ctx.fillStyle = 'rgba(221,230,242,0.82)';
    ctx.fillText(wrapOne(tagText, targetW, ctx), texW / 2, nameY + tagSize * 2.1);

    uploadBackgroundTexture(S);
  }

  function wrapOne(text, maxW, ctx) {
    if (ctx.measureText(text).width <= maxW) return text;
    var words = text.split(' '), out = words[0];
    for (var i = 1; i < words.length; i++) {
      var t = out + ' ' + words[i];
      if (ctx.measureText(t + '…').width > maxW) return out + '…';
      out = t;
    }
    return out;
  }
  function ptrPos(S, e) {
    var r = S.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function attachPointer(S) {
    var canvas = S.canvas;
    var touches = {};
    function onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var pt = ptrPos(S, e);
      if (e.pointerType === 'touch') {
        touches[e.pointerId] = pt;
        if (Object.keys(touches).length === 2) {
          var pts = values(touches);
          S.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          S.dragging = false;
        }
      }
      var dh = pt.x - S.holeX, dv = pt.y - S.holeY;
      var grabR = Math.max(S.rs * 1.3, 34);
      S.downX = pt.x; S.downY = pt.y; S.moved = 0;
      if (Math.hypot(dh, dv) <= grabR && Object.keys(touches).length < 2) {
        S.dragging = true; S.pointerId = e.pointerId; S.dragDX = dh; S.dragDY = dv;
        S.holeVX = 0; S.holeVY = 0;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      } else if (Object.keys(touches).length < 2) {
        S.pointerId = e.pointerId;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      }
    }
    function onMove(e) {
      if (e.pointerType === 'touch' && touches[e.pointerId]) {
        touches[e.pointerId] = ptrPos(S, e);
        var ids = Object.keys(touches);
        if (ids.length === 2) {
          var pts = values(touches);
          var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (S.pinchDist) {
            S.massMul = clamp(S.massMul * (d / S.pinchDist), 0.5, 1.8);
          }
          S.pinchDist = d;
          if (S.reduced) renderOnce(S);
          return;
        }
      }
      if (e.pointerId !== S.pointerId || !S.dragging) return;
      var pt = ptrPos(S, e);
      S.moved += Math.abs(pt.x - S.downX) + Math.abs(pt.y - S.downY);
      var px = S.holeX, py = S.holeY;
      S.holeX = clamp(pt.x - S.dragDX, 0, S.w);
      S.holeY = clamp(pt.y - S.dragDY, 0, S.h);
      S.holeVX = (S.holeX - px) / 0.016; S.holeVY = (S.holeY - py) / 0.016;
      if (S.reduced) renderOnce(S);
    }
    function onUp(e) {
      if (e.pointerType === 'touch') { delete touches[e.pointerId]; if (Object.keys(touches).length < 2) S.pinchDist = 0; }
      if (e.pointerId !== S.pointerId) return;
      if (S.dragging) {
        S.dragging = false;
      } else if (S.moved < 6 && !S.reduced) {
        spawnComet(S, S.downX, S.downY);
      }
      S.pointerId = null;
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    S._ptr = { onDown: onDown, onMove: onMove, onUp: onUp };
  }
  function values(o) { return Object.keys(o).map(function (k) { return o[k]; }); }

  function attachWheel(S) {
    function onWheel(e) {
      e.preventDefault();
      var factor = Math.exp(-(e.deltaY || 0) * 0.0016);
      S.massMul = clamp(S.massMul * factor, 0.5, 1.8);
      if (S.reduced) renderOnce(S);
    }
    S.canvas.addEventListener('wheel', onWheel, { passive: false });
    S._wheel = onWheel;
  }

  // ==== resize / render sizing ====
  function updateRenderSize(S) {
    var mul = S.dpr * S.scale;
    var rw = Math.round(S.w * mul), rh = Math.round(S.h * mul);
    var long = Math.max(rw, rh);
    if (long > 2048) { var f = 2048 / long; rw = Math.round(rw * f); rh = Math.round(rh * f); mul *= f; }
    rw = Math.max(2, rw); rh = Math.max(2, rh);
    S.rw = rw; S.rh = rh; S.renderMul = mul;
    if (S.glOk) {
      S.canvas.width = rw; S.canvas.height = rh;
      S.gl.viewport(0, 0, rw, rh);
    }
  }

  function doResize(S, w, h) {
    S.w = Math.max(1, w); S.h = Math.max(1, h);
    if (!S.holeX && !S.holeY) { S.holeX = S.w * 0.5; S.holeY = S.h * 0.75; }
    S.holeX = clamp(S.holeX, 0, S.w); S.holeY = clamp(S.holeY, 0, S.h);
    S.rsBase = Math.min(S.w, S.h) * 0.06;
    S.rs = S.rsBase * S.massMul;
    var dpr2 = clamp(S.win.devicePixelRatio || 1, 1, 2);
    S.overlay.width = Math.round(S.w * dpr2); S.overlay.height = Math.round(S.h * dpr2);
    S.octx = S.overlay.getContext('2d');
    if (S.glOk) {
      updateRenderSize(S);
      buildBackgroundTexture(S);
    }
    if (S.poster) layoutPoster(S);
    if (S.reduced) renderOnce(S);
  }

  // ==== idle path + main render ====
  var INTRO_S = 1.5; // first frame stays clear of the name; the sweep starts after this
  function lissajousBase(S, t) {
    var cx = S.w * 0.5, cy = S.h * 0.46;
    var ax = S.w * 0.34, ay = S.h * 0.24;
    return { x: cx + ax * Math.sin(t * 0.132 + 0.6), y: cy + ay * Math.sin(t * 0.089) };
  }
  function lissajous(S, t) {
    if (t < INTRO_S) {
      var start = { x: S.w * 0.5, y: S.h * 0.75 };
      var enter = lissajousBase(S, INTRO_S);
      var e = t / INTRO_S; e = e * e * (3 - 2 * e);
      return { x: start.x + (enter.x - start.x) * e, y: start.y + (enter.y - start.y) * e };
    }
    return lissajousBase(S, t);
  }

  function stepHole(S, dt, t) {
    if (S.dragging) return;
    var target = lissajous(S, t);
    var springK = 1.4, damp = 2.3;
    S.holeVX += ((target.x - S.holeX) * springK - S.holeVX * damp) * dt;
    S.holeVY += ((target.y - S.holeY) * springK - S.holeVY * damp) * dt;
    S.holeX += S.holeVX * dt; S.holeY += S.holeVY * dt;
    S.holeX = clamp(S.holeX, -S.rs, S.w + S.rs);
    S.holeY = clamp(S.holeY, -S.rs, S.h + S.rs);
  }

  function drawGL(S, t) {
    var gl = S.gl, u = S.u;
    gl.uniform2f(u.res, S.rw, S.rh);
    gl.uniform2f(u.hole, S.holeX * S.renderMul, S.holeY * S.renderMul);
    gl.uniform1f(u.rs, S.rs * S.renderMul);
    gl.uniform1f(u.time, t);
    gl.uniform3f(u.day, DAY.r / 255, DAY.g / 255, DAY.b / 255);
    gl.uniform3f(u.dayHot, DAY_HOT.r / 255, DAY_HOT.g / 255, DAY_HOT.b / 255);
    gl.uniform3f(u.night, NIGHT.r / 255, NIGHT.g / 255, NIGHT.b / 255);
    gl.uniform3f(u.nightDeep, NIGHT_DEEP.r / 255, NIGHT_DEEP.g / 255, NIGHT_DEEP.b / 255);
    gl.uniform1f(u.dayness, S.dayness);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, S.tex);
    gl.uniform1i(u.tex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function renderOnce(S) {
    S.rs = S.rsBase * S.massMul;
    if (S.glOk) drawGL(S, 0);
    updatePoster(S);
  }

  function frame(S, now) {
    if (!S.running) return;
    var dt = S.lastT ? Math.min(0.05, (now - S.lastT) / 1000) : 0.016;
    S.lastT = now;
    var t = (now - S.t0) / 1000;
    S.frameTimes.push(now);
    while (S.frameTimes.length > 40) S.frameTimes.shift();
    if (S.frameTimes.length === 40) {
      var span = S.frameTimes[39] - S.frameTimes[0];
      var avg = span / 39;
      if (avg > 22 && S.scale > 0.35) { S.scale = Math.max(0.35, S.scale * 0.88); updateRenderSize(S); }
      S.frameTimes.length = 0;
    }
    S.dayness += (S.targetDayness - S.dayness) * Math.min(1, dt / 0.4);
    updatePoster(S);
    stepHole(S, dt, t);
    S.rs = S.rsBase * S.massMul;
    if (S.glOk) drawGL(S, t);
    stepComets(S, dt);
    drawComets(S);
    S.rafId = S.win.requestAnimationFrame(S.frameCb);
  }

  function startLoop(S) {
    if (S.reduced || S.running) return;
    S.running = true;
    if (!S._t0set) { S.t0 = S.win.performance.now(); S._t0set = true; }
    S.lastT = 0;
    if (!S.frameCb) S.frameCb = function (n) { frame(S, n); };
    S.rafId = S.win.requestAnimationFrame(S.frameCb);
  }
  function stopLoop(S) {
    S.running = false;
    if (S.rafId) S.win.cancelAnimationFrame(S.rafId);
    S.rafId = 0;
  }
  function doDestroy(S) {
    S.destroyed = true;
    stopLoop(S);
    if (S._ptr) {
      S.canvas.removeEventListener('pointerdown', S._ptr.onDown);
      S.canvas.removeEventListener('pointermove', S._ptr.onMove);
      S.canvas.removeEventListener('pointerup', S._ptr.onUp);
      S.canvas.removeEventListener('pointercancel', S._ptr.onUp);
    }
    if (S._wheel) S.canvas.removeEventListener('wheel', S._wheel);
    if (S.glOk && S.gl) {
      var ext = S.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
    if (S.root.parentNode) S.root.parentNode.removeChild(S.root);
  }

  window.HeroLab.register({
    id: 'blackhole',
    label: 'Black hole',
    notes: {
      what: 'A real-time black hole that bends the page around itself: starfield, my name and a tilted, turbulent accretion disk, all lensed by one shader. It runs on my own clock in India, so the disk and stars are warm by day and turn violet by night.',
      play: 'Drag the hole through my name to warp it. Scroll or pinch to add mass. Click empty space to throw a comet. Drag the strip at the bottom to scrub through my day and watch the light change; let go and it drifts back to now.',
      cost: 'One full-screen shader over a static star texture, with resolution that adapts to frame time. Reduced motion shows one lensed still frame that redraws on each scrub instead of animating; without WebGL it falls back to a layered gradient poster with the same name and tagline, tinted the same way by the clock.'
    },
    create: create
  });
})();
