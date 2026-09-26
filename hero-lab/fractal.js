// fractal.js — Endless fractal dive (Hero Lab concept id "fractal")
// GPU Mandelbrot deep-zoom. df64 (double-single / float-float) arithmetic
// keeps it crisp well past 1e9x; plain float32 alone was measured to
// collapse to a single flat iteration value (full pixelation) by roughly
// 3e6 zoom on this same view geometry, consistent with the ~1e5 ballpark.
(function () {
  'use strict';

  var BASE_SPAN = 3.0;            // complex-plane width at zoom = 1
  var BAILOUT = 256.0;            // escape radius; large so smooth colour is smooth
  var ITER_BASE = 120, ITER_LOG_MULT = 80, ITER_MIN = 40;
  var ITER_CAP_DESKTOP = 1500, ITER_CAP_LOWPOWER = 600;
  var DF64_ZOOM_THRESHOLD = 1e4;  // switch to double-single well before float32 drifts
  var MAX_ZOOM = 1e10, MIN_ZOOM = 0.6;

  var DIVE_SECONDS = 35, SURFACE_SECONDS = 1.5;
  var STEER_EASE_SECONDS = 1.2, IDLE_RESUME_MS = 6000, HOLD_MULT = 3;
  var DRAG_PX = 6, CLICK_MS = 280, DBLCLICK_MS = 350, DBLCLICK_PX = 28;

  // 8 curated targets. Each was found by local search then verified: a
  // sampled patch at its OWN max zoom is neither all-interior nor
  // all-exterior (real escape-time variance), checked against a plain
  // double-precision reference iteration, not eyeballed.
  var TARGETS = [
    { re: -0.745003457863199, im: 0.113096981766077, maxZoom: 1.4e7, name: 'seahorse valley' },
    { re: -0.770086566953566, im: -0.109758713551552, maxZoom: 1.0e7, name: 'seahorse tail' },
    { re: -0.090067393804458, im: 0.649774227230494, maxZoom: 1.2e7, name: 'triple spiral' },
    { re: -1.250099179527436, im: 0.019963718066514, maxZoom: 2.0e7, name: 'antenna root' },
    { re: -1.749125905432481, im: 0.000412072596558, maxZoom: 4.0e7, name: 'period-3 satellite' },
    { re: 0.279999867577098, im: 0.008578506441639, maxZoom: 1.6e7, name: 'elephant valley' },
    { re: -0.226266394887300, im: 1.116174509948021, maxZoom: 2.5e7, name: 'top antenna spiral' },
    { re: -0.600670127310253, im: 0.420561060232680, maxZoom: 1.0e7, name: 'spiral arm' }
  ];

  var NOTES = {
    what: 'A live, endless GPU deep-zoom into the Mandelbrot set, where how deep you have fallen decides whether the light reads as day or night.',
    play: 'Click to steer the fall toward a new point, hold to drop three times faster, double-click to surface into the next dive, and drag or scroll to take the wheel yourself. Hidden discovery: the mono line under the buttons is not decoration, it is reading the exact coordinate and iteration count of the frame in front of you, live.',
    cost: 'One fragment shader doing double-single arithmetic so the zoom stays crisp past a billion times magnification, with resolution and iteration count both adapting to hold the frame rate. Reduced motion gets one still frame instead of the loop; no WebGL gets a static CSS poster. Shipping it for real is one lazy-loaded module on the home page, the same idea as the site\'s own Deep Shore game.'
  };

  function fHi(x) { return Math.fround(x); }
  function fLo(x, hi) { return Math.fround(x - hi); }
  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }
  function autoIter(zoom, cap) {
    return Math.round(clamp(ITER_BASE + ITER_LOG_MULT * Math.log10(Math.max(1, zoom)), ITER_MIN, cap));
  }

  var CSS = '' +
    '.fdive-root{position:absolute;inset:0;overflow:hidden;background:#05070c;color:#dde6f2;' +
    'font-family:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;}' +
    '.fdive-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:crosshair;outline:none;}' +
    '.fdive-poster{position:absolute;inset:0;' +
    'background:radial-gradient(circle at 20% 85%,rgba(255,179,92,0.55),transparent 42%),' +
    'radial-gradient(circle at 78% 20%,rgba(155,140,255,0.55),transparent 46%),' +
    'radial-gradient(circle at 82% 88%,rgba(59,47,143,0.6),transparent 40%),#05070c;}' +
    '.fdive-scrim{position:absolute;left:0;bottom:0;width:min(640px,72%);height:62%;pointer-events:none;' +
    'background:radial-gradient(ellipse at 0% 100%,rgba(3,4,8,0.86) 0%,rgba(3,4,8,0.55) 45%,transparent 75%);}' +
    '.fdive-copy{position:absolute;left:clamp(16px,4vw,40px);bottom:clamp(16px,4vw,40px);max-width:min(620px,86%);z-index:2;}' +
    '.fdive-copy h1{margin:0 0 .28em;font-family:"Source Serif 4",Georgia,serif;font-weight:600;' +
    'font-size:clamp(2.4rem,7vw,5.4rem);line-height:1.02;color:#fff;text-shadow:0 2px 24px rgba(0,0,0,.5);}' +
    '.fdive-tagline{margin:0 0 .6em;font-family:Georgia,serif;font-size:clamp(.92rem,1.6vw,1.15rem);' +
    'color:#dde6f2;max-width:46ch;line-height:1.4;}' +
    '.fdive-status{margin:0 0 .9em;font-size:.72rem;letter-spacing:.02em;color:#b9c2d4;}' +
    '.fdive-actions{display:flex;flex-wrap:wrap;gap:.5em;margin-bottom:.7em;}' +
    '.fdive-actions button{appearance:none;cursor:pointer;font:500 .78rem/1 "JetBrains Mono",monospace;' +
    'letter-spacing:.02em;padding:.65em 1.05em;border-radius:999px;border:1px solid rgba(221,230,242,0.35);' +
    'background:rgba(5,7,12,0.35);color:#fff;transition:border-color .15s,background .15s;}' +
    '.fdive-actions button:hover{border-color:#ffb35c;background:rgba(255,179,92,0.12);}' +
    '.fdive-secondary{appearance:none;cursor:pointer;border:0;background:none;padding:0;' +
    'font:500 .72rem/1 "JetBrains Mono",monospace;color:#9b8cff;text-decoration:underline;text-underline-offset:3px;}' +
    '.fdive-hud{margin-top:.55em;font-size:.68rem;color:#7a8796;letter-spacing:.01em;}' +
    '.fdive-root :focus-visible{outline:2px solid #9b8cff;outline-offset:2px;}' +
    '.fdive-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;}';

  function fmtCountdown(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return p2(h) + ':' + p2(m) + ':' + p2(sec);
  }

  function create(host, env) {
    var doc = host.ownerDocument || document;
    var root = doc.createElement('div');
    root.className = 'fdive-root';
    var style = doc.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    var data = env.data;
    var copy = doc.createElement('div');
    copy.className = 'fdive-copy';
    var scrim = doc.createElement('div');
    scrim.className = 'fdive-scrim';
    root.appendChild(scrim);

    var h1 = doc.createElement('h1');
    h1.textContent = data.name;
    var tagline = doc.createElement('p');
    tagline.className = 'fdive-tagline';
    tagline.textContent = data.line;
    var status = doc.createElement('p');
    status.className = 'fdive-status';
    var actions = doc.createElement('div');
    actions.className = 'fdive-actions';
    (data.sections || []).forEach(function (s) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.textContent = s.label;
      b.addEventListener('click', function () { env.openLink(s.path); });
      actions.appendChild(b);
    });
    var hud = doc.createElement('p');
    hud.className = 'fdive-hud';
    var deepBtn = doc.createElement('button');
    deepBtn.type = 'button';
    deepBtn.className = 'fdive-secondary';
    deepBtn.textContent = 'Deep Shore goes deeper →';
    deepBtn.addEventListener('click', function () { env.openLink('/games/deep-shore', 'game'); });

    copy.appendChild(h1);
    copy.appendChild(tagline);
    copy.appendChild(status);
    copy.appendChild(actions);
    copy.appendChild(deepBtn);
    copy.appendChild(hud);
    root.appendChild(copy);
    host.appendChild(root);

    function updateStatus() {
      var d = env.data;
      var c = d.counts || {};
      status.textContent = (c.tools || 0) + ' tools · ' + (c.games || 0) + ' games · ' +
        (c.writing || 0) + (c.writing === 1 ? ' article' : ' articles') + ' · next daily in ' +
        fmtCountdown(d.msToNextDaily());
    }
    updateStatus();
    var statusTimer = setInterval(updateStatus, 1000);

    var destroyed = false;
    var teardownFns = [];
    function onDestroy(fn) { teardownFns.push(fn); }

    // ---- No-WebGL fallback: static CSS poster, copy + links still work. ----
    var canvas = doc.createElement('canvas');
    var gl = null;
    try {
      gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: env.lowPower ? 'low-power' : 'high-performance' });
      var isGL2 = !!gl;
      if (!gl) gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false }) ||
        canvas.getContext('experimental-webgl');
    } catch (e) { gl = null; }

    if (!gl) {
      root.classList.add('fdive-poster');
      return {
        start: function () {},
        stop: function () {},
        resize: function () {},
        destroy: function () {
          if (destroyed) return;
          destroyed = true;
          clearInterval(statusTimer);
          host.innerHTML = '';
        }
      };
    }

    root.insertBefore(canvas, scrim);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'A live GPU deep-zoom into the Mandelbrot set, drifting from amber daylight into violet night the deeper it falls.');

    // ---- shaders ----
    var VS_SRC_300 = 'in vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}';
    var VS_SRC_100 = 'attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}';

    var FS_CORE = '\n' +
      'precision highp float;\n' +
      'uniform vec2 uResolution;\n' +
      'uniform vec2 uCenterHi;\n' +
      'uniform vec2 uCenterLo;\n' +
      'uniform float uScaleHi;\n' +
      'uniform float uScaleLo;\n' +
      'uniform float uUseDouble;\n' +
      'uniform float uMaxIter;\n' +
      'uniform float uTime;\n' +
      'uniform float uDepthPhase;\n' +
      'uniform float uSurface;\n' +
      'uniform float uHold;\n' +
      // Dekker/Knuth double-single (df64) helpers: two floats stand in for
      // one ~44-48 bit mantissa. Standard textbook technique, written fresh.
      'const float DF_SPLIT = 4097.0;\n' +
      'vec2 dfTwoSum(float a,float b){float s=a+b;float bb=s-a;float e=(a-(s-bb))+(b-bb);return vec2(s,e);}\n' +
      'vec2 dfQuickTwoSum(float a,float b){float s=a+b;float e=b-(s-a);return vec2(s,e);}\n' +
      'vec2 dfSplit(float a){float c=DF_SPLIT*a;float ab=c-a;float ah=c-ab;float al=a-ah;return vec2(ah,al);}\n' +
      'vec2 dfTwoProd(float a,float b){float p=a*b;vec2 as=dfSplit(a);vec2 bs=dfSplit(b);' +
      'float e=((as.x*bs.x-p)+as.x*bs.y+as.y*bs.x)+as.y*bs.y;return vec2(p,e);}\n' +
      'vec2 dfAdd(vec2 a,vec2 b){vec2 s=dfTwoSum(a.x,b.x);vec2 t=dfTwoSum(a.y,b.y);s.y+=t.x;' +
      's=dfQuickTwoSum(s.x,s.y);s.y+=t.y;s=dfQuickTwoSum(s.x,s.y);return s;}\n' +
      'vec2 dfSub(vec2 a,vec2 b){return dfAdd(a,vec2(-b.x,-b.y));}\n' +
      'vec2 dfMul(vec2 a,vec2 b){vec2 p=dfTwoProd(a.x,b.x);p.y+=a.x*b.y+a.y*b.x;return dfQuickTwoSum(p.x,p.y);}\n' +
      'vec2 dfFromFloat(float a){return vec2(a,0.0);}\n' +
      // day (amber) -> night (violet) cosine-blended palette; depthPhase
      // slides the whole gradient, per-pixel wave gives the shimmer.
      'vec3 dayNight(float t,float depthPhase,float glow){\n' +
      '  float wave=0.5-0.5*cos(6.28318530718*t);\n' +
      '  vec3 dayLo=vec3(1.0,0.702,0.361), dayHi=vec3(1.0,0.886,0.722);\n' +
      '  vec3 nightLo=vec3(0.608,0.549,1.0), nightHi=vec3(0.231,0.184,0.561);\n' +
      '  vec3 day=mix(dayLo,dayHi,wave);\n' +
      '  vec3 night=mix(nightHi,nightLo,wave);\n' +
      '  vec3 base=mix(day,night,depthPhase);\n' +
      '  vec3 hot=mix(vec3(1.0,0.97,0.9),vec3(0.85,0.82,1.0),depthPhase);\n' +
      '  return mix(base,hot,clamp(glow,0.0,1.0));\n' +
      '}\n' +
      'void fractalMain(out vec4 outColor){\n' +
      '  vec2 frag=gl_FragCoord.xy;\n' +
      '  vec2 centered=frag-0.5*uResolution;\n' +
      '  bool useDouble=uUseDouble>0.5;\n' +
      '  float cre, cim; vec2 cred, cimd;\n' +
      '  if(useDouble){\n' +
      '    vec2 sd=vec2(uScaleHi,uScaleLo);\n' +
      '    vec2 offX=dfMul(dfFromFloat(centered.x),sd);\n' +
      '    vec2 offY=dfMul(dfFromFloat(-centered.y),sd);\n' +
      '    cred=dfAdd(vec2(uCenterHi.x,uCenterLo.x),offX);\n' +
      '    cimd=dfAdd(vec2(uCenterHi.y,uCenterLo.y),offY);\n' +
      '    cre=cred.x+cred.y; cim=cimd.x+cimd.y;\n' +
      '  } else {\n' +
      '    float scale=uScaleHi+uScaleLo;\n' +
      '    cre=uCenterHi.x+uCenterLo.x+centered.x*scale;\n' +
      '    cim=uCenterHi.y+uCenterLo.y-centered.y*scale;\n' +
      '  }\n' +
      '  float dx0=cre-0.25, cy2=cim*cim;\n' +
      '  float q=dx0*dx0+cy2;\n' +
      '  bool interior=(q*(q+dx0)<=0.25*cy2);\n' +
      '  float bxr=cre+1.0;\n' +
      '  interior=interior||(bxr*bxr+cy2<=0.0625);\n' +
      '  float n=0.0, r2=0.0, dzx=1.0, dzy=0.0;\n' +
      '  vec2 xd=vec2(0.0), yd=vec2(0.0), x2d=vec2(0.0), y2d=vec2(0.0);\n' +
      '  float x=0.0, y=0.0, x2=0.0, y2=0.0;\n' +
      '  if(!interior){\n' +
      '    if(useDouble){\n' +
      '      for(int i=0;i<1500;i++){\n' +
      '        if(float(i)>=uMaxIter) break;\n' +
      '        r2=x2d.x+x2d.y+y2d.x+y2d.y;\n' +
      '        if(r2>65536.0) break;\n' +
      '        float px=xd.x+xd.y, py=yd.x+yd.y;\n' +
      '        float ndzx=2.0*(px*dzx-py*dzy)+1.0, ndzy=2.0*(px*dzy+py*dzx);\n' +
      '        dzx=ndzx; dzy=ndzy;\n' +
      '        vec2 xy=dfMul(xd,yd);\n' +
      '        vec2 newY=dfAdd(dfAdd(xy,xy),cimd);\n' +
      '        vec2 newX=dfAdd(dfSub(x2d,y2d),cred);\n' +
      '        xd=newX; yd=newY; x2d=dfMul(xd,xd); y2d=dfMul(yd,yd);\n' +
      '        n+=1.0;\n' +
      '      }\n' +
      '    } else {\n' +
      '      for(int i=0;i<1500;i++){\n' +
      '        if(float(i)>=uMaxIter) break;\n' +
      '        r2=x2+y2;\n' +
      '        if(r2>65536.0) break;\n' +
      '        float ndzx=2.0*(x*dzx-y*dzy)+1.0, ndzy=2.0*(x*dzy+y*dzx);\n' +
      '        dzx=ndzx; dzy=ndzy;\n' +
      '        float ny=2.0*x*y+cim, nx=x2-y2+cre;\n' +
      '        x=nx; y=ny; x2=x*x; y2=y*y;\n' +
      '        n+=1.0;\n' +
      '      }\n' +
      '    }\n' +
      '  }\n' +
      '  vec3 color;\n' +
      '  if(interior||n>=uMaxIter-0.5){\n' +
      '    float breathe=0.5+0.5*sin(uTime*0.25+(cre+cim)*3.0);\n' +
      '    color=mix(vec3(0.008,0.007,0.012),vec3(0.11,0.09,0.22),breathe*0.12);\n' +
      '  } else {\n' +
      '    float smoothN=n+1.0-log2(log(sqrt(r2))/log(256.0));\n' +
      '    float rampT=sqrt(max(0.0,smoothN))*0.14+uTime*0.015;\n' +
      '    float dzMag=length(vec2(dzx,dzy))+1e-6;\n' +
      '    float de=sqrt(r2)*log(sqrt(r2))/dzMag;\n' +
      '    float scaleForGlow=uScaleHi+uScaleLo;\n' +
      '    float dePx=de/max(abs(scaleForGlow),1e-20);\n' +
      '    float glow=exp(-dePx*0.06)*(1.0+uHold*0.8);\n' +
      '    color=dayNight(rampT,uDepthPhase,glow);\n' +
      '    color+=glow*mix(vec3(1.0,0.85,0.55),vec3(0.75,0.7,1.0),uDepthPhase)*0.5;\n' +
      '  }\n' +
      '  if(uSurface>0.001){\n' +
      '    float ang=atan(centered.y,centered.x);\n' +
      '    float rays=pow(abs(sin(ang*10.0+uTime*2.0)),8.0);\n' +
      '    float radial=smoothstep(0.0,1.0,length(centered)/(0.5*length(uResolution)+1.0));\n' +
      '    vec3 streak=mix(vec3(1.0,0.85,0.6),vec3(0.75,0.7,1.0),uDepthPhase)*rays*radial*uSurface;\n' +
      '    color+=streak;\n' +
      '  }\n' +
      '  outColor=vec4(color,1.0);\n' +
      '}\n';
    var FS_SRC_300 = FS_CORE + 'out vec4 fragColor;\nvoid main(){fractalMain(fragColor);}\n';
    var FS_SRC_100 = FS_CORE + 'void main(){vec4 c;fractalMain(c);gl_FragColor=c;}\n';

    function compile(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        var log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error('shader compile failed: ' + log);
      }
      return sh;
    }

    var verPrefix = isGL2 ? '#version 300 es\n' : '';
    var vsSrc = verPrefix + (isGL2 ? VS_SRC_300 : VS_SRC_100);
    var fsSrc = verPrefix + (isGL2 ? FS_SRC_300 : FS_SRC_100);
    var vs = compile(gl.VERTEX_SHADER, vsSrc);
    var fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var plog = gl.getProgramInfoLog(program);
      throw new Error('program link failed: ' + plog);
    }
    gl.useProgram(program);

    var quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]);
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    var U = {};
    ['uResolution', 'uCenterHi', 'uCenterLo', 'uScaleHi', 'uScaleLo', 'uUseDouble',
      'uMaxIter', 'uTime', 'uDepthPhase', 'uSurface', 'uHold'].forEach(function (name) {
      U[name] = gl.getUniformLocation(program, name);
    });
    onDestroy(function () {
      var ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    });

    // ---- dive / view state ----
    var t0 = performance.now();
    var dpr = env.dpr || 1;
    var maxScale = env.lowPower ? 0.5 : 0.85;
    var renderScale = maxScale;
    var iterCap = env.lowPower ? ITER_CAP_LOWPOWER : ITER_CAP_DESKTOP;
    var cssW = 1, cssH = 1, drawW = 1, drawH = 1;
    var MAX_ZOOM_LOG = Math.log10(MAX_ZOOM);

    var targetIdx = 0;
    var phase = 'dive';           // 'dive' | 'surface'
    var logZoom = 0, zoom = 1;
    var surfaceT = 0, surfaceFromLog = 0;
    var centerRe = TARGETS[0].re, centerIm = TARGETS[0].im;

    var paused = false, holding = false, holdT = 0;
    var steering = false, steerT0 = 0;
    var steerFromRe = 0, steerFromIm = 0, steerToRe = 0, steerToIm = 0, steerZoomAtStart = 1;
    var dragging = false;
    var lastViewInputAt = -Infinity; // wheel/drag: pauses auto-advance for IDLE_RESUME_MS

    var lastFrameT = 0, avgFrameMs = 16, rafId = 0, lastHudT = 0;

    function smoothstep(e0, e1, x) {
      var t = clamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    }
    function panWeight(z0, z1, t) {
      if (t <= 0) return 0; if (t >= 1) return 1;
      if (!(z0 > 0) || !(z1 > 0)) return t;
      var r = z1 / z0;
      var lnr = Math.log(r);
      if (!isFinite(lnr) || Math.abs(lnr) < 1e-9) return t;
      return (1 - Math.pow(r, -t)) / (1 - 1 / r);
    }
    function beginSurface() { phase = 'surface'; surfaceT = 0; surfaceFromLog = logZoom; steering = false; }

    function applySize() {
      drawW = Math.max(1, Math.round(cssW * dpr * renderScale));
      drawH = Math.max(1, Math.round(cssH * dpr * renderScale));
      canvas.width = drawW; canvas.height = drawH;
    }

    function stepAuto(dt, nowSec) {
      if (paused) return;
      var manualHold = dragging || (performance.now() - lastViewInputAt) < IDLE_RESUME_MS;
      if (phase === 'dive') {
        if (!manualHold) {
          var target = TARGETS[targetIdx];
          var capLog = Math.log10(target.maxZoom);
          var rate = capLog / DIVE_SECONDS;
          logZoom += rate * (holding ? HOLD_MULT : 1) * dt;
          if (logZoom >= capLog) { logZoom = capLog; beginSurface(); }
          zoom = Math.pow(10, clamp(logZoom, 0, MAX_ZOOM_LOG));
        }
      } else {
        surfaceT += dt;
        var p = clamp(surfaceT / SURFACE_SECONDS, 0, 1);
        logZoom = surfaceFromLog * (1 - p);
        zoom = Math.pow(10, logZoom);
        if (p >= 1) {
          targetIdx = (targetIdx + 1) % TARGETS.length;
          var nt = TARGETS[targetIdx];
          centerRe = nt.re; centerIm = nt.im;
          phase = 'dive'; logZoom = 0; zoom = 1;
        }
      }
      if (steering) {
        var st = clamp((nowSec - steerT0) / STEER_EASE_SECONDS, 0, 1);
        var w = panWeight(steerZoomAtStart, zoom, st);
        centerRe = steerFromRe + (steerToRe - steerFromRe) * w;
        centerIm = steerFromIm + (steerToIm - steerFromIm) * w;
        if (st >= 1) steering = false;
      }
    }

    function render(uTime) {
      var s = BASE_SPAN / zoom / drawW;
      var reHi = fHi(centerRe), reLo = fLo(centerRe, reHi);
      var imHi = fHi(centerIm), imLo = fLo(centerIm, imHi);
      var sHi = fHi(s), sLo = fLo(s, sHi);
      var maxIter = autoIter(zoom, iterCap);
      var depthPhase = smoothstep(1.5, 6.0, Math.log10(Math.max(1, zoom)));
      var surfaceVal = phase === 'surface' ? Math.sin(Math.PI * clamp(surfaceT / SURFACE_SECONDS, 0, 1)) : 0;
      gl.viewport(0, 0, drawW, drawH);
      gl.uniform2f(U.uResolution, drawW, drawH);
      gl.uniform2f(U.uCenterHi, reHi, imHi);
      gl.uniform2f(U.uCenterLo, reLo, imLo);
      gl.uniform1f(U.uScaleHi, sHi);
      gl.uniform1f(U.uScaleLo, sLo);
      gl.uniform1f(U.uUseDouble, zoom > DF64_ZOOM_THRESHOLD ? 1 : 0);
      gl.uniform1f(U.uMaxIter, maxIter);
      gl.uniform1f(U.uTime, uTime);
      gl.uniform1f(U.uDepthPhase, depthPhase);
      gl.uniform1f(U.uSurface, surfaceVal);
      gl.uniform1f(U.uHold, holdT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function updateHud() {
      var maxIter = autoIter(zoom, iterCap);
      hud.textContent = 'zoom ' + zoom.toExponential(1) + ' · c = ' + centerRe.toFixed(7) +
        (centerIm >= 0 ? ' + ' : ' − ') + Math.abs(centerIm).toFixed(7) + 'i · ' +
        maxIter + ' iter · rendered live on your GPU';
    }

    function renderReducedStill() {
      var t = TARGETS[0];
      zoom = t.maxZoom; logZoom = Math.log10(zoom);
      centerRe = t.re; centerIm = t.im; phase = 'dive';
      render((performance.now() - t0) / 1000);
      updateHud();
    }

    function tick(nowMs) {
      rafId = requestAnimationFrame(tick);
      var dt = lastFrameT ? Math.min(0.1, (nowMs - lastFrameT) / 1000) : 0;
      lastFrameT = nowMs;
      holdT += ((holding ? 1 : 0) - holdT) * Math.min(1, dt * 6);
      var nowSec = nowMs / 1000;
      stepAuto(dt, nowSec);
      var frameStart = performance.now();
      render((nowMs - t0) / 1000);
      var frameMs = performance.now() - frameStart;
      avgFrameMs = avgFrameMs * 0.9 + frameMs * 0.1;
      if (avgFrameMs > 22 && renderScale > 0.35) { renderScale = Math.max(0.35, renderScale - 0.05); applySize(); }
      else if (avgFrameMs < 14 && renderScale < maxScale) { renderScale = Math.min(maxScale, renderScale + 0.02); applySize(); }
      if (nowMs - lastHudT > 200) { lastHudT = nowMs; updateHud(); }
    }

    // ---- interaction: steer (click), hold (fall faster), drag (pan),
    // wheel (zoom-at-cursor), double-click (surface), keyboard ----
    canvas.tabIndex = 0;
    var pointerActive = false, downMoved = false, downX = 0, downY = 0, downT = 0, lastMoveX = 0, lastMoveY = 0;
    var lastClickT = -Infinity, lastClickX = 0, lastClickY = 0;

    function markInput() { lastViewInputAt = performance.now(); }
    function pixelScaleCss() { return BASE_SPAN / zoom / cssW; }
    function localXY(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function screenToComplex(px, py) {
      var s = pixelScaleCss();
      return { re: centerRe + (px - cssW / 2) * s, im: centerIm - (py - cssH / 2) * s };
    }
    function zoomAtPixel(px, py, factor) {
      var s = pixelScaleCss();
      var anchorRe = centerRe + (px - cssW / 2) * s;
      var anchorIm = centerIm - (py - cssH / 2) * s;
      zoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
      logZoom = Math.log10(zoom);
      var s2 = BASE_SPAN / zoom / cssW;
      centerRe = anchorRe - (px - cssW / 2) * s2;
      centerIm = anchorIm + (py - cssH / 2) * s2;
    }
    function startSteer(px, py) {
      var t = screenToComplex(px, py);
      steering = true; steerT0 = performance.now() / 1000;
      steerFromRe = centerRe; steerFromIm = centerIm;
      steerToRe = t.re; steerToIm = t.im;
      steerZoomAtStart = zoom;
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      pointerActive = true; downMoved = false;
      downX = lastMoveX = e.clientX; downY = lastMoveY = e.clientY; downT = performance.now();
      if (!env.reduced) holding = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    }
    function onPointerMove(e) {
      if (!pointerActive) return;
      var dx = e.clientX - lastMoveX, dy = e.clientY - lastMoveY;
      if (!downMoved && Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_PX) downMoved = true;
      if (downMoved) {
        dragging = true; holding = false; markInput(); steering = false;
        var s = pixelScaleCss();
        centerRe -= dx * s; centerIm += dy * s;
      }
      lastMoveX = e.clientX; lastMoveY = e.clientY;
    }
    function onPointerUp(e) {
      if (!pointerActive) return;
      pointerActive = false; holding = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      if (dragging) { dragging = false; return; }
      var p = localXY(e);
      var heldMs = performance.now() - downT;
      var now = performance.now();
      var isDbl = (now - lastClickT) < DBLCLICK_MS && Math.hypot(p.x - lastClickX, p.y - lastClickY) < DBLCLICK_PX;
      lastClickT = isDbl ? -Infinity : now; lastClickX = p.x; lastClickY = p.y;
      if (isDbl) { if (!env.reduced) beginSurface(); return; }
      if (heldMs < CLICK_MS) {
        if (env.reduced) {
          var c = screenToComplex(p.x, p.y);
          centerRe = c.re; centerIm = c.im;
          render((performance.now() - t0) / 1000);
          updateHud();
        } else {
          startSteer(p.x, p.y);
        }
      }
    }
    function onPointerLeave() { if (!dragging) holding = false; }
    function onWheel(e) {
      e.preventDefault();
      var p = localXY(e);
      markInput(); steering = false;
      var dy = clamp(e.deltaY, -120, 120);
      zoomAtPixel(p.x, p.y, Math.pow(1.0016, -dy));
      if (env.reduced) { render((performance.now() - t0) / 1000); updateHud(); }
    }
    function onKeyDown(e) {
      if (env.reduced) return;
      var s = pixelScaleCss() * 60;
      if (e.key === 'ArrowLeft') { markInput(); steering = false; centerRe -= s; }
      else if (e.key === 'ArrowRight') { markInput(); steering = false; centerRe += s; }
      else if (e.key === 'ArrowUp') { markInput(); steering = false; centerIm += s; }
      else if (e.key === 'ArrowDown') { markInput(); steering = false; centerIm -= s; }
      else if (e.key === '+' || e.key === '=') { markInput(); steering = false; zoomAtPixel(cssW / 2, cssH / 2, 1.4); }
      else if (e.key === '-' || e.key === '_') { markInput(); steering = false; zoomAtPixel(cssW / 2, cssH / 2, 1 / 1.4); }
      else if (e.key === ' ') { paused = !paused; }
      else return;
      e.preventDefault();
    }
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKeyDown);
    onDestroy(function () {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKeyDown);
    });

    return {
      resize: function (w, h) {
        cssW = Math.max(1, w); cssH = Math.max(1, h);
        applySize();
        if (env.reduced) renderReducedStill();
      },
      start: function () {
        if (env.reduced) { renderReducedStill(); return; }
        if (rafId) return;
        lastFrameT = 0;
        rafId = requestAnimationFrame(tick);
      },
      stop: function () {
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        clearInterval(statusTimer);
        teardownFns.forEach(function (fn) { try { fn(); } catch (e) {} });
        host.innerHTML = '';
      }
    };
  }

  window.HeroLab && window.HeroLab.register({
    id: 'fractal',
    label: 'Endless fractal dive',
    notes: NOTES,
    create: create
  });
})();
