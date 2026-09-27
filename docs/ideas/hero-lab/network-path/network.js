/* How you landed here — a live network diagram that replays this visitor's
 * own page load with real browser timing, then keeps running as a live
 * system. See HeroLab.register() contract at the top of hero-lab-r4.html.
 * Plain JS, no imports, no external libraries, no clock scrubber. */
(function () {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  // Critically damped spring ("SmoothDamp", a standard closed-form approach
  // to camera easing): reaches target with no overshoot and no oscillation,
  // framerate-independent. vObj holds velocity under vKey so the camera
  // needs no per-frame allocation.
  function smoothDamp(current, target, smoothTime, dt, vObj, vKey) {
    var omega = 2 / Math.max(0.0001, smoothTime);
    var x = omega * dt, exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    var change = current - target, v = vObj[vKey];
    var temp = (v + omega * change) * dt;
    vObj[vKey] = (v - omega * temp) * exp;
    return target + (change + temp) * exp;
  }
  function mix3(c0, c1, t) { return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)]; }
  function rgbCss(c, a) { return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (a == null ? 1 : a) + ')'; }
  function hexRgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; }); }

  var AMBER = hexRgb('#ffb35c');
  var VIOLET = hexRgb('#9b8cff');
  var WHITE = [0.96, 0.97, 1.0];
  var REST = hexRgb('#394255');
  var PALETTE = [AMBER, VIOLET, WHITE];

  // A packet's actual colour can be any hourColor() sample (dawn coral, dusk
  // rose, ...), but there are only ever 3 pre-rendered comet sprites, so it
  // is drawn with whichever is closest. Cheap (3 comparisons, no allocation).
  function nearestPaletteIndex(c) {
    var best = 0, bestD = Infinity;
    for (var i = 0; i < PALETTE.length; i++) {
      var p = PALETTE[i], dr = c[0] - p[0], dg = c[1] - p[1], db = c[2] - p[2], d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // ---- Comet sprites: pre-rendered ONCE per instance (create()), never per
  // frame. A head (radial glow) and a tail (linear-fading strip) per palette
  // colour; drawImage can stretch either to any size, so 6 small offscreen
  // canvases cover every packet for the whole session.
  function makeHeadSprite(color) {
    var s = 48, c = document.createElement('canvas'); c.width = c.height = s;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, rgbCss(color, 1)); grad.addColorStop(0.4, rgbCss(color, 0.55)); grad.addColorStop(1, rgbCss(color, 0));
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
    return c;
  }
  function makeTailSprite(color) {
    var w = 64, h = 16, c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d');
    var grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, rgbCss(color, 0.65)); grad.addColorStop(1, rgbCss(color, 0));
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    return c;
  }
  function makeSprites() {
    return { head: PALETTE.map(makeHeadSprite), tail: PALETTE.map(makeTailSprite) };
  }

  var STYLE = '' +
    '.nw-root{position:absolute;inset:0;overflow:hidden;background:#05070c;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}' +
    '.nw-canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;display:block}' +
    '.nw-poster{position:absolute;inset:0;display:none;' +
      'background:' +
        'radial-gradient(55% 50% at 20% 24%, rgba(255,179,92,0.26), transparent 62%),' +
        'radial-gradient(60% 55% at 78% 30%, rgba(155,140,255,0.28), transparent 62%),' +
        'radial-gradient(70% 60% at 50% 70%, rgba(120,110,160,0.08), transparent 70%),' +
        '#05070c}' +
    '.nw-root.nw-fallback .nw-canvas{display:none}' +
    '.nw-root.nw-fallback .nw-poster{display:block}' +
    '.nw-click{position:absolute;inset:0;background:transparent;border:0;padding:0;margin:0;display:block;width:100%}' +
    '.nw-nodes{position:absolute;inset:0;pointer-events:none;transform-origin:0 0}' +
    '.nw-node-btn{position:absolute;top:0;left:0;width:46px;height:46px;margin:-23px 0 0 -23px;' +
      'border-radius:50%;border:0;background:transparent;padding:0;pointer-events:auto;cursor:pointer}' +
    '.nw-node-btn:focus-visible{outline:2px solid #9b8cff;outline-offset:3px;border-radius:50%}' +
    '.nw-card{position:absolute;z-index:5;max-width:230px;padding:.55em .75em;border:1px solid #394255;' +
      'border-radius:8px;background:rgba(7,9,16,0.92);color:#dde6f2;font-size:.74rem;line-height:1.4;' +
      'pointer-events:none;opacity:0;transform:translateY(2px);transition:opacity .12s ease}' +
    '.nw-card.nw-show{opacity:1;transform:translateY(0)}' +
    '@media (prefers-reduced-motion: reduce){.nw-card{transition:none}}' +
    '.nw-hero{position:absolute;left:0;right:0;bottom:0;z-index:2;' +
      'padding:0 clamp(20px,4.5vw,64px) max(28px,clamp(20px,5vh,48px));pointer-events:none}' +
    '.nw-hero::before{content:"";position:absolute;left:-12%;right:-12%;bottom:-18%;top:-85%;' +
      'background:radial-gradient(75% 105% at 24% 100%, rgba(4,5,9,0.94), rgba(4,5,9,0.7) 55%, transparent 78%);z-index:0}' +
    // Phone's hero spans the full device width (the trace log runs edge to
    // edge), so a corner-anchored radial leaves the far side of every long
    // log line barely dimmed. A full-width linear replacement fixes that;
    // desktop's narrower, left-anchored content keeps the radial above.
    '.nw-root.nw-phone .nw-hero::before{left:-6%;right:-6%;' +
      'background:linear-gradient(180deg, transparent, rgba(4,5,9,0.6) 32%, rgba(4,5,9,0.97) 62%)}' +
    '.nw-name{position:relative;z-index:1;margin:0;font-family:"Source Serif 4",Georgia,serif;font-weight:600;' +
      'font-size:clamp(3rem,9vw,7.5rem);line-height:1.02;color:#dde6f2;letter-spacing:-0.01em;' +
      'text-shadow:0 2px 28px rgba(5,7,12,0.9),0 1px 2px rgba(5,7,12,0.7)}' +
    '.nw-tagline{position:relative;z-index:1;margin:.5em 0 0;max-width:46ch;font-family:inherit;' +
      'font-size:clamp(.85rem,1.6vw,1.05rem);line-height:1.5;color:#c3cddb;text-shadow:0 1px 14px rgba(5,7,12,.85)}' +
    // position:relative (not static) is load-bearing: z-index has no effect
    // on a statically positioned element, so a static readout painted BELOW
    // the scrim in stacking order — invisible, not merely dim — while
    // staying in normal flow exactly like static did visually otherwise.
    '.nw-readout{position:relative;z-index:1;margin-top:.9em}' +
    '.nw-root:not(.nw-phone) .nw-readout{position:absolute;right:clamp(20px,4.5vw,64px);bottom:max(28px,clamp(20px,5vh,48px));' +
      'text-align:right;max-width:380px}' +
    '.nw-trace{font-size:.8rem;line-height:1.65;color:#b7c0cf;text-shadow:0 1px 12px rgba(4,5,9,.95);white-space:pre-wrap}' +
    '.nw-trace b{color:#dde6f2;font-weight:500}' +
    '.nw-replay{display:inline-block;margin-top:.6em;pointer-events:auto;' +
      'appearance:none;border:1px solid #394255;background:rgba(5,7,12,.5);color:#dde6f2;' +
      'font:500 .74rem/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.03em;' +
      'padding:.55em .9em;border-radius:999px;cursor:pointer}' +
    '.nw-replay:hover{border-color:#ffb35c}' +
    '.nw-replay:focus-visible{outline:2px solid #9b8cff;outline-offset:2px}' +
    '';

  function buildDom(host, D) {
    var root = document.createElement('div');
    root.className = 'nw-root';
    var style = document.createElement('style');
    style.textContent = STYLE;
    root.appendChild(style);

    var canvas = document.createElement('canvas');
    canvas.className = 'nw-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'A live network diagram replaying this page load: your device, your router, a DNS resolver, the Cloudflare edge and the origin server, linked by animated request and response packets.');
    root.appendChild(canvas);

    var poster = document.createElement('div');
    poster.className = 'nw-poster';
    root.appendChild(poster);

    var click = document.createElement('button');
    click.type = 'button';
    click.className = 'nw-click';
    click.setAttribute('aria-hidden', 'true');
    click.tabIndex = -1;
    root.appendChild(click);

    var nodesLayer = document.createElement('div');
    nodesLayer.className = 'nw-nodes';
    root.appendChild(nodesLayer);

    var card = document.createElement('div');
    card.className = 'nw-card';
    card.setAttribute('aria-hidden', 'true');
    root.appendChild(card);

    var hero = document.createElement('div');
    hero.className = 'nw-hero';
    var h1 = document.createElement('h1');
    h1.className = 'nw-name';
    h1.textContent = D.name;
    var tagline = document.createElement('p');
    tagline.className = 'nw-tagline';
    tagline.textContent = D.line;
    var trace = document.createElement('div');
    trace.className = 'nw-trace';
    var replay = document.createElement('button');
    replay.type = 'button';
    replay.className = 'nw-replay';
    replay.textContent = 'replay landing';
    var readout = document.createElement('div');
    readout.className = 'nw-readout';
    readout.appendChild(trace);
    readout.appendChild(replay);
    hero.appendChild(h1);
    hero.appendChild(tagline);
    hero.appendChild(readout);
    root.appendChild(hero);

    host.appendChild(root);
    return { root: root, canvas: canvas, poster: poster, click: click, nodesLayer: nodesLayer, card: card, trace: trace, replay: replay };
  }

  var NODE_IDS = ['you', 'network', 'dns', 'edge', 'origin'];
  var LINKS = [['you', 'network'], ['network', 'dns'], ['network', 'edge'], ['edge', 'origin']];

  function referrerSub() {
    try {
      if (document.referrer) return 'from ' + new URL(document.referrer).host;
    } catch (e) {}
    return 'typed or bookmarked';
  }

  // Node metadata is fixed for the session (labels, kind); only x/y move on
  // resize, computed separately by layoutPositions() so a resize never has to
  // recompute the referrer or re-read env.
  function nodeMeta(env, D) {
    return [
      { id: 'you', kind: env.isTouch ? 'phone' : 'laptop', label: 'you', sub: referrerSub() },
      { id: 'network', kind: 'router', label: 'your network', sub: '' },
      { id: 'dns', kind: 'dns', label: 'DNS', sub: '' },
      { id: 'edge', kind: 'edge', label: 'edge · ' + D.edgeSample.colo, sub: D.edgeSample.city + ' · cache ' + D.edgeSample.cache },
      { id: 'origin', kind: 'origin', label: 'origin', sub: D.origin }
    ];
  }

  // Bold pass: full-bleed. The path now runs corner to corner across the
  // WHOLE stage, behind the name — legibility is the scrim's job
  // (.nw-hero::before), not layout avoidance, so nodes are free to sit near
  // or behind the text block the way a background does.
  // The wide shot keeps the whole route above the name block (bottom-left) and
  // the trace log (bottom-right): a sweep that rises from 'you' to DNS and
  // falls back to the origin, so the story's first node is never under the text.
  var DESKTOP_XY = { you: [0.10, 0.46], network: [0.28, 0.30], dns: [0.42, 0.12], edge: [0.62, 0.30], origin: [0.84, 0.46] };
  // Phone: the text block starts at ~44% of the stage (measured), so the five
  // nodes zig-zag in two rows inside the top band, the route reading left to right.
  var PHONE_XY = { you: [0.17, 0.10], network: [0.34, 0.30], dns: [0.51, 0.10], edge: [0.67, 0.30], origin: [0.84, 0.10] };
  // 2.5x the previous desktop glyph size; phone scales down from that rather
  // than repeating its own tighter figure, since full-bleed no longer boxes
  // it into a fraction of the stage.
  function layoutPositions(w, h, phone) {
    var map = phone ? PHONE_XY : DESKTOP_XY, out = {}, size = phone ? 36 : 80;
    for (var id in map) out[id] = { x: map[id][0] * w, y: map[id][1] * h, size: size };
    return out;
  }

  // ---- Glyphs: stroked line drawings, centred at (x,y), half-extent s.
  function setStroke(ctx, color) { ctx.strokeStyle = rgbCss(color); ctx.fillStyle = rgbCss(color); ctx.lineWidth = 2.75; }
  // extra = { simTime, fill } — fill (0..1, laptop/phone only) is the
  // response's own download progress, so the screen fills in as bytes
  // actually arrive; simTime (router/rack only) drives an LED blink.
  function drawLaptop(ctx, x, y, s, extra) {
    ctx.strokeRect(x - s, y - s * 0.15, s * 2, s * 0.75);
    ctx.beginPath(); ctx.moveTo(x - s * 0.75, y - s * 0.15); ctx.lineTo(x - s * 0.55, y - s * 0.95);
    ctx.lineTo(x + s * 0.55, y - s * 0.95); ctx.lineTo(x + s * 0.75, y - s * 0.15); ctx.stroke();
    var f = extra ? extra.fill : 0;
    if (f > 0.01) {
      var fw = s * 1.1 * f;
      ctx.fillRect(x - s * 0.55, y - s * 0.9, fw, s * 0.72);
    }
  }
  function drawPhone(ctx, x, y, s, extra) {
    ctx.strokeRect(x - s * 0.5, y - s, s, s * 2);
    ctx.beginPath(); ctx.moveTo(x - s * 0.18, y + s * 0.78); ctx.lineTo(x + s * 0.18, y + s * 0.78); ctx.stroke();
    var f = extra ? extra.fill : 0;
    if (f > 0.01) ctx.fillRect(x - s * 0.42, y - s * 0.88, s * 0.84 * f, s * 1.55);
  }
  function drawRouter(ctx, x, y, s, extra) {
    ctx.strokeRect(x - s, y - s * 0.35, s * 2, s * 0.7);
    ctx.beginPath();
    ctx.moveTo(x - s * 0.4, y - s * 0.35); ctx.lineTo(x - s * 0.55, y - s * 0.95);
    ctx.moveTo(x + s * 0.4, y - s * 0.35); ctx.lineTo(x + s * 0.55, y - s * 0.95);
    ctx.stroke();
    var t = extra ? extra.simTime : 0;
    ledRow(ctx, x, y, s, t, 2, s * 0.14);
  }
  function drawDns(ctx, x, y, s) {
    ctx.beginPath(); ctx.arc(x, y, s * 0.85, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, y, s * 0.85, s * 0.34, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - s * 0.85); ctx.lineTo(x, y + s * 0.85); ctx.stroke();
  }
  function drawHex(ctx, x, y, s) {
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 6 + i * Math.PI / 3, px = x + Math.cos(a) * s, py = y + Math.sin(a) * s;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
  }
  function drawRack(ctx, x, y, s, extra) {
    ctx.strokeRect(x - s * 0.6, y - s, s * 1.2, s * 2);
    var t = extra ? extra.simTime : 0;
    for (var i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(x - s * 0.6, y + i * s * 0.62); ctx.lineTo(x + s * 0.6, y + i * s * 0.62); ctx.stroke();
    }
    ledRow(ctx, x, y, s, t, 3, s * 0.7);
  }
  // A small blinking-LED strip shared by router (2) and rack (3): each light
  // toggles on its own phase so they never blink in lockstep.
  function ledRow(ctx, x, y, s, t, n, ledY) {
    var prevFill = ctx.fillStyle;
    for (var i = 0; i < n; i++) {
      var on = Math.sin(t * 5.2 + i * 2.1) > 0.15;
      ctx.fillStyle = on ? 'rgba(130,255,170,0.95)' : 'rgba(80,110,95,0.35)';
      ctx.beginPath(); ctx.arc(x - (n - 1) * s * 0.18 + i * s * 0.36, y + ledY, s * 0.07, 0, 6.3); ctx.fill();
    }
    ctx.fillStyle = prevFill;
  }
  var GLYPH = { laptop: drawLaptop, phone: drawPhone, router: drawRouter, dns: drawDns, edge: drawHex, origin: drawRack };

  // ---- Packet pool. Fixed-size, reused every frame: no per-frame allocation.
  // A packet's endpoints are looked up live by id/index each draw, so an
  // in-flight packet survives a resize instead of flying to a stale pixel.
  var POOL_SIZE = 96;
  function makePool() {
    var arr = [];
    for (var i = 0; i < POOL_SIZE; i++) arr.push({ active: false, kind: 'main', a: null, b: null, t: 0, dur: 300, color: WHITE, size: 3, delay: 0 });
    return arr;
  }
  // delay (ms) holds a packet inactive-looking but reserved, so a burst can
  // schedule several packets at once with staggered starts using only the
  // existing pool — no separate timer/queue needed.
  function spawnPacket(pool, kind, a, b, color, dur, size, delay) {
    for (var i = 0; i < pool.length; i++) {
      if (!pool[i].active) {
        var p = pool[i];
        p.active = true; p.kind = kind; p.a = a; p.b = b; p.t = 0; p.dur = Math.max(1, dur); p.color = color; p.size = size || 3; p.delay = delay || 0;
        return p;
      }
    }
    return null;
  }
  function linkKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

  // ---- Pulse pool: a small ring drawn once from a node when a hop touches
  // it. Same fixed-pool shape as packets, on its own tiny array (different
  // draw/lifecycle, so not worth sharing one pool with two meanings).
  var PULSE_SIZE = 24;
  function makePulsePool() {
    var arr = [];
    for (var i = 0; i < PULSE_SIZE; i++) arr.push({ active: false, id: null, t: 0, dur: 500, color: WHITE, maxR: 30 });
    return arr;
  }
  function spawnPulse(pool, id, color, dur, maxR) {
    for (var i = 0; i < pool.length; i++) {
      if (!pool[i].active) { var p = pool[i]; p.active = true; p.id = id; p.t = 0; p.dur = dur; p.color = color; p.maxR = maxR; return; }
    }
  }
  function updatePulses(pool, dt) {
    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      if (!p.active) continue;
      p.t += dt * 1000 / p.dur;
      if (p.t >= 1) p.active = false;
    }
  }
  function drawPulses(ctx, pool, nodePos) {
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      if (!p.active) continue;
      var pos = nodePos[p.id];
      if (!pos) continue;
      var t = clamp(p.t, 0, 1), r = lerp(pos.size * 0.9, p.maxR, t);
      ctx.strokeStyle = rgbCss(p.color, (1 - t) * 0.85);
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, 6.3); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Point lookup: 'main' packets reference node ids in nodePos; 'ambient'
  // packets reference an index into ambient.pts (px cache, resize-safe).
  function pointOf(state, kind, ref) {
    return kind === 'ambient' ? state.ambient.pts[ref] : state.nodePos[ref];
  }

  function makeHeat() { return { r: REST[0], g: REST[1], b: REST[2], heat: 0 }; }
  function bumpHeat(h, color) { h.heat = 1; h.r = color[0]; h.g = color[1]; h.b = color[2]; }
  function decayHeat(h, dt) { h.heat *= Math.exp(-2.2 * dt); }
  function heatColor(h) { return mix3(REST, [h.r, h.g, h.b], h.heat); }

  function makeHeatMaps() {
    var nodeHeat = {}, linkHeat = {}, i;
    for (i = 0; i < NODE_IDS.length; i++) nodeHeat[NODE_IDS[i]] = makeHeat();
    for (i = 0; i < LINKS.length; i++) linkHeat[linkKey(LINKS[i][0], LINKS[i][1])] = makeHeat();
    return { node: nodeHeat, link: linkHeat };
  }
  // Called once per frame before packets re-bump whatever they're still
  // touching, so a link/node with nothing on it actually fades to REST
  // instead of sitting at full heat forever.
  function decayAllHeat(heat, dt) {
    var k;
    for (k in heat.node) decayHeat(heat.node[k], dt);
    for (k in heat.link) decayHeat(heat.link[k], dt);
  }

  // Advance every active packet, light the link/nodes it touches, ring a
  // pulse at each node it touches, deactivate on arrival. A delayed packet
  // (see spawnPacket) counts down and does nothing else until it starts.
  function updatePackets(state, dt) {
    var pool = state.pool, heat = state.heat, pulses = state.pulses, nodePos = state.nodePos;
    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      if (!p.active) continue;
      if (p.delay > 0) { p.delay -= dt * 1000; continue; }
      var prevT = p.t;
      p.t += dt * 1000 / p.dur;
      if (p.kind === 'main') {
        var key = linkKey(p.a, p.b);
        if (heat.link[key]) bumpHeat(heat.link[key], p.color);
        // Pulse radius follows the NODE's own size (a ring has to reach
        // past the glyph it rings), not the packet's — a fixed multiple of
        // the packet dot would sit hidden inside an 80px node.
        if (prevT < 0.12) { bumpHeat(heat.node[p.a], p.color); spawnPulse(pulses, p.a, p.color, 520, nodePos[p.a].size * 1.7 + 16); }
      }
      if (p.t >= 1) {
        if (p.kind === 'main') { bumpHeat(heat.node[p.b], p.color); spawnPulse(pulses, p.b, p.color, 520, nodePos[p.b].size * 1.7 + 16); }
        p.active = false;
      }
    }
  }

  // ---- Ambient field: faint distant nodes + hairline links standing for the
  // rest of the internet. Positions are seeded once (fractional) and rescaled
  // on resize; the occasional tiny packet crossing one is tinted by the hour.
  function computeAmbientLinks(pts) {
    var links = [], seen = {}, i, j, k;
    for (i = 0; i < pts.length; i++) {
      var best = [];
      for (j = 0; j < pts.length; j++) {
        if (i === j) continue;
        var dx = pts[i].fx - pts[j].fx, dy = pts[i].fy - pts[j].fy;
        best.push([j, dx * dx + dy * dy]);
      }
      best.sort(function (a, b) { return a[1] - b[1]; });
      for (k = 0; k < 2 && k < best.length; k++) {
        var j2 = best[k][0], key = Math.min(i, j2) + '|' + Math.max(i, j2);
        if (!seen[key]) { seen[key] = 1; links.push([i, j2]); }
      }
    }
    return links;
  }
  // 3 parallax layers in one 120-point mesh: far (tiny, dim, still), mid,
  // near (bigger, brighter, a slow drift). One shared link mesh across all
  // of them — "the whole field", not three separate unrelated ones.
  var AMBIENT_LAYERS = [
    { n: 60, r: 0.85, a: 0.16, drift: 0 },
    { n: 40, r: 1.5, a: 0.32, drift: 0 },
    { n: 20, r: 2.6, a: 0.6, drift: 1 }
  ];
  function makeAmbient() {
    var pts = [];
    AMBIENT_LAYERS.forEach(function (layer, li) {
      for (var i = 0; i < layer.n; i++) {
        pts.push({
          fx: Math.random(), fy: Math.random(), x: 0, y: 0, layer: li,
          driftPhase: Math.random() * 6.28, driftR: layer.drift ? 5 + Math.random() * 9 : 0
        });
      }
    });
    var links = computeAmbientLinks(pts);
    // Adjacency for the burst walk below: which points a given point is
    // directly wired to, built once alongside the links themselves.
    var adj = pts.map(function () { return []; });
    links.forEach(function (l) { adj[l[0]].push(l[1]); adj[l[1]].push(l[0]); });
    return { pts: pts, links: links, adj: adj };
  }
  function resizeAmbient(ambient, w, h) {
    for (var i = 0; i < ambient.pts.length; i++) { var p = ambient.pts[i]; p.baseX = p.fx * w; p.baseY = p.fy * h; p.x = p.baseX; p.y = p.baseY; }
  }
  // Near-layer points drift slowly on a fixed per-point orbit driven by
  // simTime — arithmetic only, no stored velocity to integrate or allocate.
  function driftAmbient(ambient, simTime) {
    var pts = ambient.pts;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!p.driftR) continue;
      p.x = p.baseX + Math.cos(simTime * 0.00012 + p.driftPhase) * p.driftR;
      p.y = p.baseY + Math.sin(simTime * 0.00009 + p.driftPhase) * p.driftR;
    }
  }
  function drawAmbient(ctx, ambient) {
    var pts = ambient.pts, links = ambient.links, i;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(150,160,182,0.1)';
    ctx.beginPath();
    for (i = 0; i < links.length; i++) {
      var a = pts[links[i][0]], b = pts[links[i][1]];
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    for (i = 0; i < pts.length; i++) {
      var p = pts[i], layer = AMBIENT_LAYERS[p.layer];
      ctx.fillStyle = 'rgba(160,170,190,' + layer.a + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, layer.r, 0, 6.3); ctx.fill();
    }
  }

  // Quadratic bezier with a small perpendicular bulge, so a hop reads as a
  // gentle arc rather than a ruler-straight line.
  function hopPoint(p0, p1, t) {
    var mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
    var dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len, bulge = Math.min(18, len * 0.12);
    var cx = mx + nx * bulge, cy = my + ny * bulge, u = 1 - t;
    return { x: u * u * p0.x + 2 * u * t * cx + t * t * p1.x, y: u * u * p0.y + 2 * u * t * cy + t * t * p1.y };
  }
  // Packets as comets: a bright pre-rendered head plus a tail sprite
  // stretched (via drawImage's destination size, not re-rendered) to a
  // length that follows how fast this hop is actually moving.
  // The cinematic follow: tight on whatever the lead packet is doing until
  // the response starts (state.camWide), then a damped pull to the wide
  // shot. No allocation: tx/ty/tz are locals, velocity lives on state.camera.
  function updateCamera(state, dt) {
    var cam = state.camera, tx, ty, tz;
    if (state.camWide) {
      tx = state.w / 2; ty = state.h / 2; tz = 1;
    } else {
      var lp = state.leadPacket, you = state.nodePos.you;
      tx = you.x; ty = you.y;
      if (lp && lp.active && lp.delay <= 0) {
        var p0 = pointOf(state, lp.kind, lp.a), p1 = pointOf(state, lp.kind, lp.b);
        if (p0 && p1) { var at = hopPoint(p0, p1, clamp(lp.t, 0, 1)); tx = at.x; ty = at.y; }
      }
      tz = 2.2;
    }
    cam.x = smoothDamp(cam.x, tx, 0.42, dt, cam, 'vx');
    cam.y = smoothDamp(cam.y, ty, 0.42, dt, cam, 'vy');
    cam.zoom = smoothDamp(cam.zoom, tz, 0.55, dt, cam, 'vz');
  }
  // Additive ('lighter') so overlapping light actually brightens instead of
  // just overpainting — the whole point of a comet stream over a dark scene.
  function drawPackets(ctx, state) {
    var pool = state.pool, sprites = state.sprites;
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      if (!p.active || p.delay > 0) continue;
      var p0 = pointOf(state, p.kind, p.a), p1 = pointOf(state, p.kind, p.b);
      if (!p0 || !p1) continue;
      var t = clamp(p.t, 0, 1), at = hopPoint(p0, p1, t);
      var dx = p1.x - p0.x, dy = p1.y - p0.y, dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var speed = dist / p.dur, angle = Math.atan2(dy, dx);
      var pal = nearestPaletteIndex(p.color);
      var tailLen = clamp(speed * 150, p.size * 2.4, 130);
      var fade = t < 0.08 ? t / 0.08 : (t > 0.85 ? (1 - t) / 0.15 : 1);
      ctx.save();
      ctx.translate(at.x, at.y); ctx.rotate(angle + Math.PI);
      ctx.globalAlpha = fade;
      ctx.drawImage(sprites.tail[pal], 0, -p.size * 2, tailLen, p.size * 4);
      ctx.restore();
      var hs = p.size * 5.6;
      ctx.globalAlpha = fade;
      ctx.drawImage(sprites.head[pal], at.x - hs / 2, at.y - hs / 2, hs, hs);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // Main-path links: bold with a soft glow, plus an additive flowing-dash
  // overlay while a phase is actually crossing, so traffic reads as light
  // moving through the wire, not just a colour change.
  function drawLinks(ctx, state, simTime) {
    for (var i = 0; i < LINKS.length; i++) {
      var a = state.nodePos[LINKS[i][0]], b = state.nodePos[LINKS[i][1]];
      var h = state.heat.link[linkKey(LINKS[i][0], LINKS[i][1])], col = heatColor(h);
      ctx.lineWidth = 3;
      ctx.shadowColor = rgbCss(col, 0.7 * h.heat);
      ctx.shadowBlur = 4 + h.heat * 18;
      ctx.strokeStyle = rgbCss(col);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (h.heat > 0.1) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.setLineDash([9, 11]);
        ctx.lineDashOffset = -simTime * 0.09;
        ctx.strokeStyle = rgbCss([h.r, h.g, h.b], h.heat);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.shadowBlur = 0;
  }
  function labelX(ctx, text, x, w) { var half = ctx.measureText(text).width / 2 + 8; return clamp(x, half, Math.max(half, w - half)); }
  function drawGlyphs(ctx, state, meta, phone) {
    ctx.font = (phone ? '11px ' : '13px ') + 'ui-monospace,Menlo,Consolas,monospace';
    ctx.textAlign = 'center';
    var extra = { simTime: state.simTime, fill: state.downloadProgress };
    for (var i = 0; i < meta.length; i++) {
      var m = meta[i], pos = state.nodePos[m.id];
      setStroke(ctx, heatColor(state.heat.node[m.id]));
      GLYPH[m.kind](ctx, pos.x, pos.y, pos.size, extra);
      // Labels stay inside the stage in the wide shot: a node near an edge
      // (the origin, far right) would otherwise have its sub-label cut off.
      ctx.fillStyle = 'rgba(221,230,242,0.92)';
      ctx.fillText(m.label, labelX(ctx, m.label, pos.x, state.w), pos.y + pos.size + 15);
      if (m.sub) { ctx.fillStyle = 'rgba(132,144,160,0.92)'; ctx.fillText(m.sub, labelX(ctx, m.sub, pos.x, state.w), pos.y + pos.size + 29); }
    }
  }

  // ---- Real numbers: Navigation Timing, normalised so every value below is
  // a plain millisecond duration whether the browser gives us the modern
  // entry (already relative) or the legacy `performance.timing` (epoch ms).
  function readTiming() {
    var nav = null;
    try { nav = performance.getEntriesByType('navigation')[0]; } catch (e) {}
    var src = nav || performance.timing;
    function d(a, b) { return Math.max(0, (src[a] || 0) - (src[b] || 0)); }
    var tls = src.secureConnectionStart > 0 ? Math.max(0, src.connectEnd - src.secureConnectionStart) : 0;
    var tcp = Math.max(0, d('connectEnd', 'connectStart') - tls);
    var painted = 0;
    try {
      var fcp = performance.getEntriesByType('paint').filter(function (p) { return p.name === 'first-contentful-paint'; })[0];
      painted = fcp ? fcp.startTime : d('domContentLoadedEventEnd', (nav ? 'startTime' : 'navigationStart'));
    } catch (e2) {}
    var size = (nav && nav.transferSize) || 0, decoded = (nav && nav.decodedBodySize) || 0;
    return {
      dns: d('domainLookupEnd', 'domainLookupStart'), tcp: tcp, tls: tls,
      ttfb: d('responseStart', 'requestStart'), download: d('responseEnd', 'responseStart'),
      painted: painted, protocol: (nav && nav.nextHopProtocol) || '', size: size, decoded: decoded
    };
  }

  function dur(ms) { return clamp(300 + 60 * Math.sqrt(Math.max(0, ms)), 300, 1600); }
  function pathHops(route, color, totalMs, size) {
    var n = route.length - 1, each = totalMs / Math.max(1, n), out = [];
    for (var i = 0; i < n; i++) out.push({ a: route[i], b: route[i + 1], color: color, dur: each, size: size || 3 });
    return out;
  }

  function fmtDns(ms, D) { return ms <= 0 ? D.host + ' · cached' : D.host + ' in ' + Math.round(ms) + ' ms'; }
  function fmtTcp(ms) { return ms <= 0 ? 'reused connection to the edge' : 'connected to the edge in ' + Math.round(ms) + ' ms'; }
  function fmtTls(ms, D) { return D.edgeSample.tls + ' · ' + D.edgeSample.kex + ' · ' + Math.round(ms) + ' ms (sample)'; }
  function fmtHttp(protocol, D) {
    var proto = protocol || D.edgeSample.http;
    return proto + ' · edge ' + D.edgeSample.colo + ', ' + D.edgeSample.city + ' · cache ' + D.edgeSample.cache + ' (sample)';
  }
  function fmtBytes(ttfb, size, decoded, download) {
    var bytes = (size === 0 && decoded > 0) ? 'from the browser cache' : Math.max(1, Math.round(size / 1024)) + ' KB in ' + Math.round(download) + ' ms';
    return 'first byte at ' + Math.round(ttfb) + ' ms · ' + bytes;
  }
  function fmtPaint(ms) { return 'on screen at ' + Math.round(ms) + ' ms'; }

  // A flat, precomputed timeline: {start, hop} entries to spawn packets from,
  // and {at, label, text} entries to write a trace line from. Both are walked
  // by a single cursor each frame in the main loop (piece 5) — no per-phase
  // timers. The 600ms head start matches "about 600ms after start" in the
  // brief; GAP paces phases so the whole replay reads at human speed.
  var GAP = 480;
  function buildTimeline(timing, D) {
    var cursor = 600, timeline = [], logs = [];
    function hops(list) { for (var i = 0; i < list.length; i++) { timeline.push({ start: cursor, hop: list[i] }); cursor += list[i].dur; } }
    function log(label, text) { logs.push({ at: cursor, label: label, text: text }); cursor += GAP; }

    var dDns = dur(timing.dns) / 2;
    hops(pathHops(['you', 'network', 'dns'], AMBER, dDns));
    hops(pathHops(['dns', 'network', 'you'], VIOLET, dDns));
    log('dns', fmtDns(timing.dns, D));

    var dTcp = dur(timing.tcp) / 2;
    hops(pathHops(['you', 'network', 'edge'], AMBER, dTcp));
    hops(pathHops(['edge', 'network', 'you'], VIOLET, dTcp));
    log('tcp', fmtTcp(timing.tcp));

    var dTls = dur(timing.tls) / 4;
    hops(pathHops(['you', 'network', 'edge'], WHITE, dTls));
    hops(pathHops(['edge', 'network', 'you'], WHITE, dTls));
    hops(pathHops(['you', 'network', 'edge'], WHITE, dTls));
    hops(pathHops(['edge', 'network', 'you'], WHITE, dTls));
    log('tls', fmtTls(timing.tls, D));

    var dReq = dur(timing.ttfb), miss = D.edgeSample.cache !== 'HIT';
    if (miss) {
      hops(pathHops(['you', 'network', 'edge'], AMBER, dReq * 0.5));
      hops(pathHops(['edge', 'origin'], AMBER, dReq * 0.25));
      hops(pathHops(['origin', 'edge'], VIOLET, dReq * 0.25));
    } else {
      hops(pathHops(['you', 'network', 'edge'], AMBER, dReq));
    }
    log('http', fmtHttp(timing.protocol, D));

    // The download as a thick bright stream: packet count scales with the
    // actual KB, not a fixed 4, so a bigger response visibly reads as more
    // traffic rather than the same 4 dots moving at a different speed.
    var respStart = cursor;
    var kb = Math.max(1, timing.size / 1024);
    var streamN = clamp(Math.round(5 + kb / 2.2), 5, 40);
    var dResp = dur(timing.download), k;
    for (k = 0; k < streamN; k++) hops(pathHops(['edge', 'network', 'you'], VIOLET, dResp / streamN, 2.4));
    var respEnd = cursor;
    log('bytes', fmtBytes(timing.ttfb, timing.size, timing.decoded, timing.download));

    log('paint', fmtPaint(timing.painted));
    return { timeline: timeline, logs: logs, total: cursor, respStart: respStart, respEnd: respEnd };
  }

  HeroLab.register({
    id: 'network',
    label: 'How you landed here',
    notes: {
      what: 'A live network diagram that replays how your own browser reached this page: your device, your router, DNS, the edge and the origin server, timed from real numbers your browser measured.',
      play: 'Watch the first run play on its own. Hover or tab through a node to see what it is and its measured value. Click empty space to send a real ping and watch it travel. The small button plays the landing again.',
      cost: 'It reads the browser’s own Navigation Timing for this page. On the real site the edge, city and cache facts would come from Cloudflare’s same-origin trace endpoint instead of a sample. Nothing is stored or sent anywhere else. Reduced motion shows the finished diagram and trace log with no moving packets; without canvas it falls back to a static poster with the same log as text.'
    },
    create: function (host, env) {
      var D = env.data;
      var dom = buildDom(host, D);
      var reduced = !!env.reduced;
      var meta = nodeMeta(env, D);
      var ctx = null;
      try { ctx = dom.canvas.getContext('2d'); } catch (e0) {}
      if (!ctx) dom.root.classList.add('nw-fallback');

      var state = {
        dpr: clamp(env.dpr || 1, 1, 2), w: 0, h: 0, phone: false,
        nodePos: {}, pool: makePool(), pulses: makePulsePool(), heat: makeHeatMaps(), ambient: makeAmbient(),
        sprites: ctx ? makeSprites() : null, simTime: 0,
        running: false, raf: 0, lastT: 0, destroyed: false,
        cursor: 0, timeline: null, logs: null, tIdx: 0, lIdx: 0, replaying: false,
        ambientAccum: 0, ambientBurstAccum: 4 + Math.random() * 4, keepAccum: Math.random() * 3,
        pingBusy: false, cardId: null, typing: null,
        // Cinematic camera: a critically-damped follow (see smoothDamp), plus
        // the two things it needs to decide where to look.
        camera: { x: 0, y: 0, zoom: 1, vx: 0, vy: 0, vz: 0 },
        camWide: true, leadPacket: null, downloadProgress: 0, respStart: 0, respEnd: 0
      };

      // ---- Node buttons: invisible, focusable overlays so keyboard users
      // reach the same info a hover gives a mouse. The glyphs themselves are
      // canvas-drawn, so this is the only real DOM per node.
      var buttons = {};
      meta.forEach(function (m) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'nw-node-btn';
        b.setAttribute('aria-label', m.label + (m.sub ? ', ' + m.sub : ''));
        b.addEventListener('mouseenter', function () { showCard(m.id); });
        b.addEventListener('mouseleave', function () { hideCard(m.id); });
        b.addEventListener('focus', function () { showCard(m.id); });
        b.addEventListener('blur', function () { hideCard(m.id); });
        dom.nodesLayer.appendChild(b);
        buttons[m.id] = b;
      });

      function nodeInfo(id) {
        var t = state.timing;
        if (id === 'you') return 'Your device · ' + (meta[0].sub || 'direct visit');
        if (id === 'network') return 'Your router · relays every request from your device.';
        if (id === 'dns') return 'DNS resolver · ' + (t ? (t.dns <= 0 ? 'answered from cache' : 'answered in ' + Math.round(t.dns) + ' ms') : 'not yet measured');
        if (id === 'edge') return 'Cloudflare edge · ' + D.edgeSample.city + ' · cache ' + D.edgeSample.cache + ' (sample)';
        return 'Origin server · ' + D.origin;
      }
      function showCard(id) {
        state.cardId = id;
        var info = nodeInfo(id);
        dom.card.textContent = info;
        // The card itself is aria-hidden (it is a visual echo), so a screen
        // reader gets the same live, measured text through the button's own
        // accessible name instead of a static label.
        buttons[id].setAttribute('aria-label', info);
        var p = state.nodePos[id];
        if (!p) return;
        var left = p.x + p.size + 14, top = p.y - 10;
        if (left + 230 > state.w) left = p.x - p.size - 14 - 230;
        top = clamp(top, 8, Math.max(8, state.h - 60));
        dom.card.style.left = clamp(left, 8, Math.max(8, state.w - 238)) + 'px';
        dom.card.style.top = top + 'px';
        dom.card.classList.add('nw-show');
      }
      function hideCard(id) { if (state.cardId === id) { state.cardId = null; dom.card.classList.remove('nw-show'); } }

      function resize(w, h) {
        state.w = w; state.h = h; state.phone = w <= 520;
        dom.root.classList.toggle('nw-phone', state.phone);
        state.nodePos = layoutPositions(w, h, state.phone);
        resizeAmbient(state.ambient, w, h);
        // Keep the wide shot actually wide across a resize (or before the
        // very first start(), if the tab loads hidden and start() is
        // deferred) — only while camWide, so a resize mid-replay does not
        // fight the follow camera's own target.
        if (state.camWide) { state.camera.x = w / 2; state.camera.y = h / 2; state.camera.zoom = 1; }
        if (ctx) { dom.canvas.width = Math.max(1, Math.round(w * state.dpr)); dom.canvas.height = Math.max(1, Math.round(h * state.dpr)); }
        meta.forEach(function (m) {
          var p = state.nodePos[m.id], hit = p.size * 1.15;
          var btn = buttons[m.id];
          btn.style.left = p.x + 'px'; btn.style.top = p.y + 'px';
          btn.style.width = hit + 'px'; btn.style.height = hit + 'px'; btn.style.margin = (-hit / 2) + 'px 0 0 ' + (-hit / 2) + 'px';
        });
        if (state.cardId) showCard(state.cardId);
        renderNow();
      }

      // ---- Drawing: canvas is HiDPI-scaled once per frame, cleared in that
      // plain space, THEN the camera is applied so world content (ambient,
      // links, glyphs, packets) draws in world px regardless of zoom. The
      // invisible node-button layer gets the identical CSS transform (see
      // buildDom's transformOrigin:0 0) so hit areas track the camera too.
      function draw() {
        if (!ctx) return;
        ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
        ctx.clearRect(0, 0, state.w, state.h);
        var cam = state.camera;
        ctx.translate(state.w / 2, state.h / 2);
        ctx.scale(cam.zoom, cam.zoom);
        ctx.translate(-cam.x, -cam.y);
        drawAmbient(ctx, state.ambient);
        drawLinks(ctx, state, state.simTime);
        drawGlyphs(ctx, state, meta, state.phone);
        drawPackets(ctx, state);
        drawPulses(ctx, state.pulses, state.nodePos);
        dom.nodesLayer.style.transform = 'translate(' + (state.w / 2) + 'px,' + (state.h / 2) + 'px) scale(' + cam.zoom + ') translate(' + (-cam.x) + 'px,' + (-cam.y) + 'px)';
      }
      function renderNow() { if (!state.running) draw(); }

      // Builds the row + label immediately; returns the text node the caller
      // fills in, either all at once (appendLogEntry) or typed out over time
      // (startTyping). One shape, so reduced motion and the live loop render
      // an identical line, just at different speeds.
      function makeLogRow(entry) {
        var row = document.createElement('div'), b = document.createElement('b'), span = document.createElement('span');
        b.textContent = (entry.label + '      ').slice(0, 6);
        row.appendChild(b); row.appendChild(span);
        dom.trace.appendChild(row);
        return span;
      }
      function appendLogEntry(entry) { makeLogRow(entry).textContent = entry.text; }
      var TYPE_CPS = 46;
      function startTyping(entry) {
        // If two log thresholds are crossed in the same frame (a slow frame,
        // a tab resume), finish the line already in flight instantly rather
        // than orphaning it half-typed when state.typing is replaced.
        if (state.typing) state.typing.span.textContent = state.typing.full;
        state.typing = { span: makeLogRow(entry), full: entry.text, shown: 0 };
      }
      function advanceTyping(dt) {
        var ty = state.typing;
        if (!ty) return;
        ty.shown += dt * TYPE_CPS;
        var n = Math.min(ty.full.length, Math.floor(ty.shown));
        ty.span.textContent = ty.full.slice(0, n);
        if (n >= ty.full.length) state.typing = null;
      }

      // Builds (or rebuilds, for the replay button) the flat hop/log
      // timeline from this page's own real timing. The loop below is the
      // only thing that ever advances it. "This is you": a ripple opens the
      // run from the node the whole diagram is about.
      function startReplay() {
        if (!state.timing) state.timing = readTiming();
        var built = buildTimeline(state.timing, D);
        state.timeline = built.timeline; state.logs = built.logs;
        state.tIdx = 0; state.lIdx = 0; state.cursor = 0; state.replaying = true; state.typing = null;
        state.respStart = built.respStart; state.respEnd = built.respEnd; state.downloadProgress = 0;
        state.leadPacket = null; state.camWide = false;
        dom.trace.textContent = '';
        if (ctx) {
          spawnPulse(state.pulses, 'you', WHITE, 950, state.nodePos.you.size * 2.6 + 30);
          // Starts close on "you", snapped rather than damped from wherever
          // the last run left off — the brief for a first frame either way.
          var cam = state.camera, you = state.nodePos.you;
          cam.x = you.x; cam.y = you.y; cam.zoom = 2.2; cam.vx = cam.vy = cam.vz = 0;
        }
      }
      // Reduced motion never runs the loop, so the whole replay is resolved
      // at once: every hop's heat is applied in order (last write wins per
      // node/link, which is exactly the state an animated run would settle
      // into) and the full log is written in one pass.
      function renderFinalState() {
        if (!state.timing) state.timing = readTiming();
        var built = buildTimeline(state.timing, D);
        state.logs = built.logs;
        state.downloadProgress = 1;
        // "Under reduced motion: no camera, just the static wide shot" — set
        // directly, no smoothDamp, since reduced motion never runs the loop
        // that would otherwise ease it there.
        state.camWide = true;
        var cam = state.camera;
        cam.x = state.w / 2; cam.y = state.h / 2; cam.zoom = 1; cam.vx = cam.vy = cam.vz = 0;
        built.timeline.forEach(function (e) {
          var h = e.hop, key = linkKey(h.a, h.b);
          if (state.heat.link[key]) { state.heat.link[key].heat = 0.55; state.heat.link[key].r = h.color[0]; state.heat.link[key].g = h.color[1]; state.heat.link[key].b = h.color[2]; }
          [h.a, h.b].forEach(function (id) { if (state.heat.node[id]) { state.heat.node[id].heat = 0.5; state.heat.node[id].r = h.color[0]; state.heat.node[id].g = h.color[1]; state.heat.node[id].b = h.color[2]; } });
        });
        dom.trace.textContent = '';
        built.logs.forEach(appendLogEntry);
        draw();
      }

      function advanceTimeline(dt) {
        if (!state.timeline) return;
        state.cursor += dt * 1000;
        while (state.tIdx < state.timeline.length && state.cursor >= state.timeline[state.tIdx].start) {
          var h = state.timeline[state.tIdx].hop;
          // The lead packet is whichever hop is newest, i.e. furthest along
          // the route — the camera (updateCamera) follows this directly.
          var np = spawnPacket(state.pool, 'main', h.a, h.b, h.color, h.dur, h.size);
          if (np) state.leadPacket = np;
          state.tIdx++;
        }
        while (state.lIdx < state.logs.length && state.cursor >= state.logs[state.lIdx].at) {
          var entry = state.logs[state.lIdx];
          // "http" is the request landing at the edge — cache/route decided,
          // nothing left to chase, so the camera pulls out for the response.
          if (entry.label === 'http') state.camWide = true;
          startTyping(entry); state.lIdx++;
        }
        if (state.respEnd > state.respStart) {
          state.downloadProgress = clamp((state.cursor - state.respStart) / (state.respEnd - state.respStart), 0, 1);
        }
        if (state.replaying && state.lIdx >= state.logs.length) state.replaying = false;
      }
      // Roughly 3x the quiet pass's rate, and itself denser by day (payments
      // at scale) than by night, so the field's own pace tells the same
      // day/night story the packet colour does.
      function ambientTick(dt) {
        state.ambientAccum -= dt;
        if (state.ambientAccum > 0) return;
        var day = D.dayness(D.localMinutes());
        state.ambientAccum = lerp(0.42, 0.18, day) + Math.random() * lerp(0.32, 0.14, day);
        var links = state.ambient.links, pick = links[(Math.random() * links.length) | 0];
        spawnPacket(state.pool, 'ambient', pick[0], pick[1], D.hourColor(D.localMinutes()), lerp(1100, 650, day), 1.5);
      }
      // "Occasional bursts": a short chain of ambient links carries several
      // small packets in quick succession, like a surge of traffic. Denser,
      // faster and amber by day; sparser, slower and violet by night — both
      // read straight off dayness, tinted by the real hourColor.
      function ambientBurstTick(dt) {
        state.ambientBurstAccum -= dt;
        if (state.ambientBurstAccum > 0) return;
        var day = D.dayness(D.localMinutes());
        state.ambientBurstAccum = lerp(11, 5, day) + Math.random() * 3;
        var adj = state.ambient.adj, n = state.ambient.pts.length;
        var start = (Math.random() * n) | 0, chain = [start], cur = start, prev = -1, step;
        for (step = 0; step < 3; step++) {
          var nbrs = adj[cur];
          if (!nbrs || !nbrs.length) break;
          var next = nbrs[(Math.random() * nbrs.length) | 0];
          if (next === prev && nbrs.length > 1) next = nbrs[(nbrs.indexOf(next) + 1) % nbrs.length];
          chain.push(next); prev = cur; cur = next;
        }
        if (chain.length < 2) return;
        var hc = D.hourColor(D.localMinutes()), base = day >= 0.5 ? AMBER : VIOLET;
        var color = mix3(base, hc, 0.4);
        var count = Math.round(lerp(4, 9, day)), legDur = lerp(760, 420, day), stagger = legDur / 2.6, t = 0;
        for (var k = 0; k < count; k++) {
          var leg = k % (chain.length - 1);
          spawnPacket(state.pool, 'ambient', chain[leg], chain[leg + 1], color, legDur, day >= 0.5 ? 1.7 : 1.3, t);
          t += stagger;
        }
      }
      function keepaliveTick(dt) {
        if (state.replaying) return;
        state.keepAccum -= dt;
        if (state.keepAccum > 0) return;
        state.keepAccum = 3 + Math.random() * 3.5;
        var l = LINKS[(Math.random() * LINKS.length) | 0];
        spawnPacket(state.pool, 'main', l[0], l[1], Math.random() < 0.5 ? AMBER : VIOLET, 550, 2);
      }

      function loop(tsNow) {
        if (!state.running) return;
        state.raf = requestAnimationFrame(loop);
        var dt = state.lastT ? Math.min((tsNow - state.lastT) / 1000, 0.25) : 1 / 60;
        state.lastT = tsNow;
        state.simTime += dt * 1000;
        decayAllHeat(state.heat, dt);
        updatePackets(state, dt);
        updatePulses(state.pulses, dt);
        updateCamera(state, dt);
        driftAmbient(state.ambient, state.simTime);
        advanceTimeline(dt);
        advanceTyping(dt);
        ambientTick(dt);
        ambientBurstTick(dt);
        keepaliveTick(dt);
        draw();
      }

      function finishPing(ms) {
        state.pingBusy = false;
        if (ms < 0) return;
        var entry = { label: 'ping', text: 'answered in ' + Math.round(ms) + ' ms' };
        if (reduced || !ctx || !state.running) {
          appendLogEntry(entry);
          if (ctx) {
            bumpHeat(state.heat.node.edge, VIOLET);
            bumpHeat(state.heat.link[linkKey('you', 'network')], VIOLET);
            bumpHeat(state.heat.link[linkKey('network', 'edge')], VIOLET);
            draw();
          }
          return;
        }
        var half = clamp(ms / 2, 150, 700), base = state.cursor + 30, t = base;
        pathHops(['you', 'network', 'edge'], AMBER, half).concat(pathHops(['edge', 'network', 'you'], VIOLET, half))
          .forEach(function (h) { state.timeline.push({ start: t, hop: h }); t += h.dur; });
        state.logs.push({ at: t, label: entry.label, text: entry.text });
      }
      function ping() {
        if (state.pingBusy) return;
        state.pingBusy = true;
        var t0 = performance.now();
        fetch('network.js', { cache: 'no-store' }).then(function () { finishPing(performance.now() - t0); }).catch(function () { finishPing(-1); });
      }
      dom.click.addEventListener('click', ping);
      dom.replay.addEventListener('click', function () {
        if (reduced || !ctx) { renderFinalState(); return; }
        startReplay();
        if (!state.running) start();
      });

      function start() {
        if (state.destroyed) return;
        if (reduced || !ctx) { renderFinalState(); return; }
        if (!state.timeline) startReplay();
        if (!state.running) { state.running = true; state.lastT = 0; state.raf = requestAnimationFrame(loop); }
      }
      function stop() {
        state.running = false;
        if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
      }
      function destroy() {
        state.destroyed = true;
        stop();
        dom.click.removeEventListener('click', ping);
        if (dom.root.parentNode) dom.root.parentNode.removeChild(dom.root);
      }

      return { start: start, stop: stop, resize: resize, destroy: destroy };
    }
  });
})();
