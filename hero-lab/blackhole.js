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

    // ---- DOM: canvas stack, sr-only heading, halo, status + links, work chip, hidden work list
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

    var foot = doc.createElement('div');
    foot.className = 'bh-foot';
    var status = doc.createElement('p');
    status.className = 'bh-status';
    foot.appendChild(status);
    var linkRow = doc.createElement('div');
    linkRow.className = 'bh-links';
    var sectionEls = (D.sections || []).map(function (s) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'bh-link';
      b.textContent = s.label;
      b.addEventListener('click', function () { env.openLink(s.path, 'section'); });
      linkRow.appendChild(b);
      return { el: b, path: s.path };
    });
    foot.appendChild(linkRow);
    root.appendChild(foot);

    var chip = doc.createElement('a');
    chip.className = 'bh-chip';
    chip.href = '#';
    chip.hidden = true;
    var chipTitle = doc.createElement('b');
    var chipLine = doc.createElement('span');
    chip.appendChild(chipTitle);
    chip.appendChild(chipLine);
    root.appendChild(chip);

    var work = [];
    (D.tools || []).forEach(function (t) { work.push({ kind: 'tool', slug: t.slug, name: t.name, line: t.line }); });
    (D.games || []).forEach(function (g) { work.push({ kind: 'game', slug: g.slug, name: g.name, line: g.line }); });

    var workNav = doc.createElement('nav');
    workNav.className = 'bh-sr';
    workNav.setAttribute('aria-label', 'Everything this black hole magnifies');
    var workBtns = work.map(function (w) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.textContent = w.name + ' — ' + w.line;
      workNav.appendChild(b);
      return b;
    });
    root.appendChild(workNav);

    // ---- shared mutable state
    var S = {
      doc: doc, win: win, reduced: reduced, env: env, D: D,
      root: root, canvas: canvas, overlay: overlay, halo: halo, foot: foot,
      status: status, sectionEls: sectionEls, chip: chip, chipTitle: chipTitle, chipLine: chipLine, chipFor: -1,
      work: work, workBtns: workBtns,
      gl: null, glOk: false, poster: false,
      w: 0, h: 0, dpr: clamp(env.dpr || 1, 1, 2),
      scale: env.lowPower ? 0.5 : 0.75,
      rw: 0, rh: 0,
      texCanvas: null, texCtx: null, texW: 0, texH: 0, labels: [],
      rng: mulberry32(20260925),
      holeX: 0, holeY: 0, holeVX: 0, holeVY: 0, dragging: false, pointerId: null, dragDX: 0, dragDY: 0,
      moved: 0, downX: 0, downY: 0,
      rsBase: 60, massMul: 1, t0: 0, lastT: 0, running: false, rafId: 0,
      frameTimes: [], frameIdx: 0,
      comets: [],
      keyTarget: null, spagBtn: null, spagTimer: 0,
      intervalId: 0, fontsWatched: false
    };

    if (!reduced) attachPointer(S);
    attachWheel(S);
    attachKeyboard(S);

    var gl = getGL(canvas);
    if (gl) {
      S.gl = gl; S.glOk = initGL(S);
    }
    if (!S.glOk) buildPoster(S);

    tickStatus(S);
    S.intervalId = win.setInterval(function () { tickStatus(S); }, 1000);

    return {
      start: function () { startLoop(S); },
      stop: function () { stopLoop(S); },
      resize: function (w, h) { doResize(S, w, h); },
      destroy: function () { doDestroy(S); }
    };
  }

  // ==== CSS ====
  function cssText() {
    return '' +
      '.bh-root{--day:#ffb35c;--day-hot:#ffe2b8;--night:#9b8cff;--night-deep:#1b1452;--ink:#dde6f2;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}' +
      '.bh-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;}' +
      '.bh-fx{pointer-events:none;}' +
      '.bh-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;margin:-1px;padding:0;border:0;}' +
      '.bh-halo{position:absolute;left:0;right:0;bottom:0;height:38%;pointer-events:none;background:radial-gradient(120% 100% at 50% 100%, rgba(2,3,7,.72), rgba(2,3,7,.3) 55%, transparent 80%);}' +
      '.bh-foot{position:absolute;left:0;right:0;bottom:clamp(14px,3.4vh,30px);display:flex;flex-direction:column;align-items:center;gap:.7em;padding-inline:16px;z-index:3;}' +
      '.bh-status{margin:0;color:var(--ink);opacity:.86;font-size:.74rem;letter-spacing:.04em;text-shadow:0 1px 10px rgba(0,0,0,.8);}' +
      '.bh-links{display:flex;gap:.6em;flex-wrap:wrap;justify-content:center;}' +
      '.bh-link{appearance:none;cursor:pointer;border:1px solid rgba(221,230,242,.32);background:rgba(5,7,12,.4);color:var(--ink);font:500 .78rem/1 inherit;letter-spacing:.03em;padding:.65em 1.1em;border-radius:999px;transition:border-color .15s,transform .5s cubic-bezier(.2,.8,.2,1),opacity .5s;}' +
      '.bh-link:hover{border-color:var(--night);}' +
      '.bh-link:focus-visible{outline:2px solid var(--night);outline-offset:2px;}' +
      '@media (prefers-reduced-motion: reduce){.bh-link{transition:border-color .15s;}}' +
      '.bh-chip{position:absolute;transform:translate(-50%,-120%);display:flex;flex-direction:column;gap:.15em;background:rgba(6,8,14,.88);border:1px solid rgba(221,230,242,.3);border-radius:8px;padding:.5em .7em;font-size:.72rem;line-height:1.35;color:var(--ink);text-decoration:none;max-width:220px;z-index:4;box-shadow:0 6px 24px rgba(0,0,0,.5);}' +
      '.bh-chip b{font-size:.78rem;}' +
      '.bh-chip span{opacity:.78;}' +
      '.bh-chip span::after{content:" \\2192 open";opacity:.7;}' +
      '.bh-chip:focus-visible{outline:2px solid var(--night);outline-offset:2px;}' +
      '.bh-poster{position:absolute;inset:0;background:' +
        'radial-gradient(38% 46% at 62% 38%, rgba(255,179,92,.24), transparent 60%),' +
        'radial-gradient(46% 56% at 34% 66%, rgba(155,140,255,.28), transparent 62%),' +
        'radial-gradient(9% 9% at 50% 50%, #000 60%, rgba(0,0,0,0) 100%),' +
        '#05070c;}';
  }

  // ==== GL: shaders + setup ====
  var VERT_SRC = 'attribute vec2 aPos;\nvoid main(){gl_Position=vec4(aPos,0.0,1.0);}';
  var FRAG_SRC = [
    'precision highp float;',
    'uniform vec2 uResolution; uniform sampler2D uTex; uniform vec2 uHole; uniform float uRs; uniform float uTime;',
    'uniform vec3 uDay; uniform vec3 uDayHot; uniform vec3 uNight; uniform vec3 uNightDeep;',
    'float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
    'float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);float a=hash21(i),b=hash21(i+vec2(1.0,0.0)),c=hash21(i+vec2(0.0,1.0)),d=hash21(i+vec2(1.0,1.0));vec2 u=f*f*(3.0-2.0*f);return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y;}',
    'float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*vnoise(p);p*=2.02;a*=0.55;}return v;}',
    'void main(){',
    '  vec2 frag = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);',
    '  vec2 rel = frag - uHole;',
    '  float dist = length(rel);',
    '  vec2 dir = dist > 0.0001 ? rel/dist : vec2(0.0,1.0);',
    '  float shadowR = uRs*2.6;',
    '  float defl = (1.05*uRs*uRs) / max(dist, uRs*0.35);',
    '  float fade = smoothstep(shadowR*0.6, shadowR*1.9, dist);',
    '  defl *= fade;',
    '  vec2 sampPos = frag - dir*defl;',
    '  vec2 uv = clamp(sampPos/uResolution, 0.0, 1.0);',
    '  vec3 col = texture2D(uTex, uv).rgb;',
    '  float inclCos = 0.208;',
    '  float diskOpacity = 0.0; vec3 diskCol = vec3(0.0); float kepT = uTime*0.6;',
    '  for(int pass=0; pass<2; pass++){',
    '    vec2 r2 = rel; float squash = inclCos; float sgn = 1.0;',
    '    if(pass==1){ r2 = vec2(rel.x, -abs(rel.y)*0.62 - uRs*0.15); squash = inclCos*0.85; sgn = -1.0; }',
    '    vec2 dRel = vec2(r2.x, r2.y/squash);',
    '    float dR = length(dRel);',
    '    float dAng = atan(dRel.y, dRel.x);',
    '    float inner = uRs*1.18; float outer = uRs*5.4;',
    '    float band = smoothstep(inner, inner+uRs*0.35, dR) * (1.0 - smoothstep(outer-uRs*1.2, outer, dR));',
    '    if(band > 0.001){',
    '      float kepler = kepT*(1.0/pow(max(dR/uRs,0.4),1.5));',
    '      float turb = fbm(vec2(dAng*2.6 + sgn*kepler, dR*0.045 - kepT*0.15));',
    '      float t = clamp((dR-inner)/max(outer-inner,1.0),0.0,1.0);',
    '      vec3 hot = mix(uDayHot, uDay, smoothstep(0.0,0.4,t));',
    '      vec3 cool = mix(uDay, mix(uNight, uNightDeep, smoothstep(0.5,1.0,t)), smoothstep(0.25,1.0,t));',
    '      vec3 base = mix(hot, cool, t);',
    '      float approach = smoothstep(-1.0, 1.0, cos(dAng)*sgn);',
    '      float beam = mix(0.55, 1.65, approach);',
    '      vec3 beamed = mix(base*0.7, mix(base, uDayHot, 0.5), approach);',
    '      float density = band*(0.55+0.65*turb)*beam;',
    '      density *= pass==0 ? 1.0 : 0.4;',
    '      density *= smoothstep(shadowR*0.98, shadowR*1.35, dist);',
    '      diskCol += beamed*density; diskOpacity += density;',
    '    }',
    '  }',
    '  col = col*(1.0-clamp(diskOpacity,0.0,1.0)) + diskCol;',
    '  float ringW = max(1.6, uRs*0.02);',
    '  float ring = exp(-pow((dist-shadowR)/ringW, 2.0));',
    '  col += ring*vec3(1.0,0.97,0.92)*1.4;',
    '  float inside = smoothstep(shadowR, shadowR-2.0, dist);',
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
        nightDeep: gl.getUniformLocation(prog, 'uNightDeep')
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
  function buildPoster(S) { S.poster = true; }

  // ==== background texture: stars, galactic band, name + tagline, dim work labels ====
  function titleRect(texW, texH) {
    var w = texW * 0.86, h = texH * 0.34;
    return { x: (texW - w) / 2, y: texH * 0.5 - h / 2, w: w, h: h };
  }

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

    // name + tagline, drawn into the lensable texture
    var tr = titleRect(texW, texH);
    var nameSize = clamp(texW * 0.088, texH * 0.16, texW * 0.15);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 ' + Math.round(nameSize) + 'px "Source Serif 4", Georgia, serif';
    ctx.shadowColor = 'rgba(120,105,220,0.55)';
    ctx.shadowBlur = nameSize * 0.18;
    ctx.fillStyle = '#eef2fb';
    var nameY = texH / 2;
    ctx.fillText(S.D.name, texW / 2, nameY);
    ctx.shadowBlur = 0;
    var tagSize = Math.round(nameSize * 0.185);
    ctx.font = '400 ' + tagSize + 'px "Source Serif 4", Georgia, serif';
    ctx.fillStyle = 'rgba(221,230,242,0.82)';
    ctx.fillText(wrapOne(S.D.line, texW * 0.7, ctx), texW / 2, nameY + tagSize * 2.1);

    // dim labelled stars for the hidden work: tiny mono labels, ~40% alpha, avoiding the title block
    ctx.font = Math.round(texH * 0.014) + 'px ui-monospace, monospace';
    ctx.textAlign = 'left';
    var labels = [];
    var rngL = mulberry32(4242);
    for (var wi = 0; wi < S.work.length; wi++) {
      var w = S.work[wi], tries = 0, lx = 0, ly = 0;
      do {
        lx = 0.06 + rngL() * 0.88; ly = 0.06 + rngL() * 0.88;
        var px = lx * texW, py = ly * texH;
        tries++;
      } while (tries < 14 && px > tr.x - 20 && px < tr.x + tr.w + 20 && py > tr.y - 20 && py < tr.y + tr.h + 20);
      var lpx = lx * texW, lpy = ly * texH;
      ctx.fillStyle = 'rgba(200,208,224,0.4)';
      ctx.beginPath(); ctx.arc(lpx, lpy, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(200,208,224,0.4)';
      ctx.fillText(w.name, lpx + 5, lpy + 3);
      labels.push({ kind: w.kind, slug: w.slug, name: w.name, line: w.line, tx: lx, ty: ly });
    }
    S.labels = labels;
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
  function attachPointer(S) {}
  function attachWheel(S) {}
  function attachKeyboard(S) {}
  function tickStatus(S) {
    var D = S.D;
    var ms = D.msToNextDaily();
    var s = Math.max(0, Math.floor(ms / 1000));
    var hh = String(Math.floor(s / 3600)).padStart(2, '0');
    var mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    var ss = String(s % 60).padStart(2, '0');
    S.status.textContent = D.counts.tools + ' tools · ' + D.counts.games + ' games · ' +
      D.counts.writing + ' article · next daily in ' + hh + ':' + mm + ':' + ss;
  }
  function startLoop(S) {}
  function stopLoop(S) {}
  function doResize(S, w, h) { S.w = w; S.h = h; }
  function doDestroy(S) {
    S.win.clearInterval(S.intervalId);
    S.root.parentNode && S.root.parentNode.removeChild(S.root);
  }

  window.HeroLab.register({
    id: 'blackhole',
    label: 'Black hole',
    notes: {
      what: 'A real-time black hole that bends the page around itself: starfield, my name and a tilted, turbulent accretion disk, all lensed by one shader.',
      play: 'Drag the hole through my name to warp it. Scroll or pinch to add mass. Click empty space to throw a comet. Pass the hole near the faint dim stars to magnify the tool or game hiding there and open it; tab through them with a keyboard. Drop the hole onto a section button to fall in and open it.',
      cost: 'One full-screen shader over a static star texture, resolution adapts to frame time. Reduced motion shows one lensed still frame with dragging only; without WebGL it falls back to a layered gradient poster with the same name, tagline and links.'
    },
    create: create
  });
})();
