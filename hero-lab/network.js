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
  // The machines rest a step brighter than the wires between them, so the
  // five nodes read as objects and the links as the paths joining them.
  var REST_GLYPH = hexRgb('#58647f');
  // Every glyph is a solid panel: a wire ends at its outline instead of
  // running through it, and an arriving packet slides in underneath.
  var BODY = hexRgb('#0b0f19');
  var SCREEN_BG = '#070a12';
  var LED_ON = 'rgba(130,255,170,0.95)', LED_OFF = 'rgba(80,110,95,0.35)';
  var PALETTE = [AMBER, VIOLET, WHITE];
  // Scratch colour for mixInto(): glyph colours are mixed into this every
  // frame instead of into a fresh array.
  var MIX = [0, 0, 0];
  function mixInto(out, c0, c1, t) { out[0] = lerp(c0[0], c1[0], t); out[1] = lerp(c0[1], c1[1], t); out[2] = lerp(c0[2], c1[2], t); return out; }

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
    // It starts just above the name, not far up the stage: on a phone the
    // whole diagram sits above the text, and a scrim reaching into it only
    // dims the row of nodes nearest the name.
    '.nw-root.nw-phone .nw-hero::before{left:-6%;right:-6%;top:-14%;' +
      'background:linear-gradient(180deg, transparent, rgba(4,5,9,0.82) 16%, rgba(4,5,9,0.96) 48%)}' +
    '.nw-name{position:relative;z-index:1;margin:0;font-family:"Source Serif 4",Georgia,serif;font-weight:600;' +
      'font-size:clamp(3rem,calc(7vw + .5rem),7rem);line-height:1.02;color:#dde6f2;letter-spacing:-0.01em;' +
      'text-shadow:0 2px 28px rgba(5,7,12,0.9),0 1px 2px rgba(5,7,12,0.7)}' +
    '.nw-tagline{position:relative;z-index:1;margin:.5em 0 0;max-width:46ch;font-family:inherit;' +
      'font-size:clamp(.85rem,1.6vw,1.05rem);line-height:1.5;color:#c3cddb;text-shadow:0 1px 14px rgba(5,7,12,.85)}' +
    // position:relative (not static) is load-bearing: z-index has no effect
    // on a statically positioned element, so a static readout painted BELOW
    // the scrim in stacking order — invisible, not merely dim — while
    // staying in normal flow exactly like static did visually otherwise.
    '.nw-readout{position:relative;z-index:1;margin-top:.9em}' +
    // Beside the name, sized to its widest line. That width is final from
    // the first frame (every row holds its full text while hidden), so the
    // box never widens under its right anchor as lines type. When name and
    // log do not fit side by side, .nw-stack puts the log under the tagline.
    '.nw-root:not(.nw-phone):not(.nw-stack) .nw-readout{position:absolute;right:clamp(20px,4.5vw,64px);bottom:max(28px,clamp(20px,5vh,48px));' +
      'width:max-content;max-width:min(30rem,46vw)}' +
    '.nw-trace{font-size:.8rem;line-height:1.65;color:#b7c0cf;text-shadow:0 1px 12px rgba(4,5,9,.95)}' +
    '.nw-root.nw-phone .nw-trace{font-size:.72rem;line-height:1.6}' +
    // Every row exists from the start and is only hidden, and the untyped
    // rest of a line keeps its space while it types: the block never
    // changes height, so the name above it (in flow on a phone) never jumps.
    '.nw-row{display:grid;grid-template-columns:6ch 1fr;visibility:hidden}' +
    '.nw-row.nw-on{visibility:visible}' +
    '.nw-row b{color:#dde6f2;font-weight:500}' +
    '.nw-row .nw-rest,.nw-row .nw-note.nw-wait{visibility:hidden}' +
    '.nw-note{color:#6c778b}' +
    '.nw-row.nw-hint span{color:#7d889c}' +
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
    // The text sits in a span so its own width can be measured against the
    // log's (an h1 is as wide as the hero).
    var nameText = document.createElement('span');
    nameText.textContent = D.name;
    h1.appendChild(nameText);
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
    return { root: root, canvas: canvas, poster: poster, click: click, nodesLayer: nodesLayer, card: card, hero: hero, name: h1, nameText: nameText, tagline: tagline, readout: readout, trace: trace, replay: replay };
  }

  var NODE_IDS = ['you', 'network', 'dns', 'edge', 'origin'];
  var LINKS = [['you', 'network'], ['network', 'dns'], ['network', 'edge'], ['edge', 'origin']];
  // 'a>b' → which link a hop rides and whether it runs against the link's
  // own direction. Built once, so a packet resolves its wire at spawn time
  // and never builds a lookup string per frame.
  var LINK_OF = {};
  LINKS.forEach(function (l, i) {
    LINK_OF[l[0] + '>' + l[1]] = { i: i, rev: false, key: linkKey(l[0], l[1]) };
    LINK_OF[l[1] + '>' + l[0]] = { i: i, rev: true, key: linkKey(l[0], l[1]) };
  });

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
      // The colo code is drawn inside the hexagon itself, so the label
      // below it does not repeat it.
      { id: 'edge', kind: 'edge', label: 'edge', sub: D.edgeSample.city + ' · cache ' + D.edgeSample.cache },
      { id: 'origin', kind: 'origin', label: 'origin', sub: D.origin }
    ];
  }

  // Desktop: a sweep that rises from 'you' to DNS and falls back to the
  // origin. The whole route stays above the name (bottom-left) and the trace
  // log (bottom-right), so the story's first node is never under the text.
  var DESKTOP_XY = { you: [0.11, 0.43], network: [0.29, 0.29], dns: [0.44, 0.155], edge: [0.64, 0.30], origin: [0.86, 0.43] };
  // Phone: two rows zig-zagging left to right. You, DNS and the origin sit on
  // top, the router and the edge below, all in the band between the page's
  // nav and the top of the text block.
  var PHONE_X = { you: 0.15, dns: 0.5, origin: 0.85, network: 0.33, edge: 0.67 };
  var PHONE_TOP_ROW = { you: true, dns: true, origin: true };
  var NAV_CLEAR = 60;
  // How far below its centre each glyph ends, in units of its half-extent,
  // so a label sits under the drawing it names rather than under a fixed box.
  var GLYPH_BOTTOM = { laptop: 0.4, phone: 1, router: 0.3, dns: 0.85, edge: 1, origin: 1 };
  var GLYPH_TOP = { laptop: 0.92, phone: 1, router: 0.95, dns: 0.85, edge: 1, origin: 1 };
  // Room above the phone's top row for a label and two lines of sub-label.
  var PHONE_LABEL_ROOM = 43;
  function layoutPositions(w, h, phone, textTop) {
    var out = {}, id;
    if (!phone) {
      // Big enough to be the scene, capped so it stays a background and
      // never outweighs the name, and smaller when the text leaves less room.
      var size = clamp(Math.min(w * 0.05, h * 0.085, (textTop - NAV_CLEAR - 60) / 4.2), 34, 76);
      // The sweep's bottom row (you, the origin) keeps its labels clear of
      // the text block. When the text is tall (stacked), the sweep flattens
      // into the room above it rather than running under the name.
      var yTop = Math.max(0.155 * h, NAV_CLEAR + 0.85 * size + 4);
      var yBot = Math.max(yTop + 40, Math.min(0.43 * h, textTop - 12 - size - 44));
      for (id in DESKTOP_XY) {
        var k = (DESKTOP_XY[id][1] - 0.155) / (0.43 - 0.155);
        out[id] = { x: DESKTOP_XY[id][0] * w, y: yTop + k * (yBot - yTop), size: size };
      }
      return out;
    }
    // textTop is measured, not assumed: the text block's height depends on
    // the name's font and on how the trace lines wrap on this width.
    var bottom = Math.max(NAV_CLEAR + 180, textTop - 10);
    var s = clamp((bottom - NAV_CLEAR) * 0.13, 22, 32);
    // The top row's labels sit ABOVE its glyphs. The wires from the lower
    // row arrive from below, so labels under the top row would sit right in
    // their path.
    var topY = NAV_CLEAR + PHONE_LABEL_ROOM + s;
    // The lower row's labels end at the band's foot, with room for the
    // wires between the two rows.
    var lowY = Math.max(bottom - s - 30, topY + 2 * s + 34);
    for (id in PHONE_X) out[id] = { x: PHONE_X[id] * w, y: PHONE_TOP_ROW[id] ? topY : lowY, size: s, labAbove: !!PHONE_TOP_ROW[id] };
    return out;
  }
  // Word-wraps text to maxW at the context's current font. Called on resize
  // only; the frame loop draws the cached lines.
  function wrapText(ctx, text, maxW) {
    var words = text.split(' '), lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var next = line ? line + ' ' + words[i] : words[i];
      if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = words[i]; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  // ---- Glyphs: solid panels with a crisp outline, centred at (x,y) with
  // half-extent s. g is ONE scratch object that drawGlyphs() refills for
  // each node each frame: stroke, body and ink are CSS colours, lw is the
  // outline width, heat is 0..1, fill is the response's download progress
  // (the device's screen), simTime is in ms (LEDs) and colo is the edge's code.
  function roundRectPath(ctx, x0, y0, x1, y1, r) {
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0); ctx.lineTo(x1 - r, y0); ctx.quadraticCurveTo(x1, y0, x1, y0 + r);
    ctx.lineTo(x1, y1 - r); ctx.quadraticCurveTo(x1, y1, x1 - r, y1);
    ctx.lineTo(x0 + r, y1); ctx.quadraticCurveTo(x0, y1, x0, y1 - r);
    ctx.lineTo(x0, y0 + r); ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
    ctx.closePath();
  }
  // Fills the current path as a solid panel, then outlines it.
  function panel(ctx, g) {
    ctx.fillStyle = g.body; ctx.fill();
    ctx.lineWidth = g.lw; ctx.strokeStyle = g.stroke; ctx.stroke();
  }
  // Interior markings (meridians, rack units, ports) are thinner and dimmer
  // than the outline, so each glyph reads as one object with markings on it
  // rather than a tangle of equal lines.
  function detailStroke(ctx, g) {
    ctx.lineWidth = g.lw * 0.6; ctx.globalAlpha = 0.7; ctx.strokeStyle = g.stroke; ctx.stroke(); ctx.globalAlpha = 1;
  }
  // Status LEDs, each on its own slow phase so they never blink in lockstep.
  // While traffic crosses the node they flicker fast.
  function ledOn(g, i) {
    var t = g.simTime * 0.001;
    return g.heat > 0.3 ? Math.sin(t * 38 + i * 1.7) > -0.2 : Math.sin(t * (1.6 + i * 0.7) + i * 2.1) > 0.2;
  }
  function led(ctx, x, y, r, on) { ctx.fillStyle = on ? LED_ON : LED_OFF; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill(); }

  // The device's screen draws a miniature of this very page as the
  // response's bytes arrive: first the diagram, then the name, then the
  // tagline, top to bottom in the order they were delivered. Fades use
  // globalAlpha over constant fill strings, so no colour is built per frame.
  function drawScreen(ctx, x0, y0, w, h, g) {
    ctx.fillStyle = SCREEN_BG; ctx.fillRect(x0, y0, w, h);
    var f = g.fill;
    if (f <= 0.01) return;
    ctx.globalAlpha = 0.14 * f; ctx.fillStyle = '#9b8cff'; ctx.fillRect(x0, y0, w, h);
    var a = clamp((f - 0.05) / 0.15, 0, 1), id;
    if (a > 0) {
      ctx.globalAlpha = a * 0.8; ctx.strokeStyle = '#9b8cff'; ctx.lineWidth = Math.max(0.6, w * 0.012);
      ctx.beginPath();
      for (var i = 0; i < LINKS.length; i++) {
        var p = DESKTOP_XY[LINKS[i][0]], q = DESKTOP_XY[LINKS[i][1]];
        ctx.moveTo(x0 + w * (0.1 + 0.8 * p[0]), y0 + h * (0.04 + p[1]));
        ctx.lineTo(x0 + w * (0.1 + 0.8 * q[0]), y0 + h * (0.04 + q[1]));
      }
      ctx.stroke();
      ctx.fillStyle = '#dde6f2';
      var r = Math.max(0.9, w * 0.02);
      for (id in DESKTOP_XY) {
        var d = DESKTOP_XY[id];
        ctx.beginPath(); ctx.arc(x0 + w * (0.1 + 0.8 * d[0]), y0 + h * (0.04 + d[1]), r, 0, 6.3); ctx.fill();
      }
    }
    ctx.fillStyle = '#dde6f2';
    screenBar(ctx, f, 0.35, x0 + w * 0.08, y0 + h * 0.62, w * 0.56, h * 0.1);
    screenBar(ctx, f, 0.6, x0 + w * 0.08, y0 + h * 0.78, w * 0.4, h * 0.045);
    screenBar(ctx, f, 0.72, x0 + w * 0.08, y0 + h * 0.86, w * 0.28, h * 0.045);
    ctx.globalAlpha = 1;
  }
  function screenBar(ctx, f, th, x, y, w, h) {
    var a = clamp((f - th) / 0.12, 0, 1);
    if (a <= 0) return;
    ctx.globalAlpha = a * 0.85; ctx.fillRect(x, y, w, Math.max(1, h));
  }

  function drawLaptop(ctx, x, y, s, g) {
    roundRectPath(ctx, x - 0.8 * s, y - 0.92 * s, x + 0.8 * s, y + 0.27 * s, 0.07 * s); panel(ctx, g);
    drawScreen(ctx, x - 0.7 * s, y - 0.83 * s, 1.4 * s, s, g);
    ctx.beginPath();
    ctx.moveTo(x - s, y + 0.27 * s); ctx.lineTo(x + s, y + 0.27 * s);
    ctx.lineTo(x + 1.12 * s, y + 0.4 * s); ctx.lineTo(x - 1.12 * s, y + 0.4 * s); ctx.closePath();
    panel(ctx, g);
    ctx.beginPath();
    ctx.moveTo(x - 0.2 * s, y + 0.27 * s); ctx.lineTo(x - 0.16 * s, y + 0.32 * s);
    ctx.lineTo(x + 0.16 * s, y + 0.32 * s); ctx.lineTo(x + 0.2 * s, y + 0.27 * s);
    detailStroke(ctx, g);
  }
  function drawPhone(ctx, x, y, s, g) {
    roundRectPath(ctx, x - 0.52 * s, y - s, x + 0.52 * s, y + s, 0.14 * s); panel(ctx, g);
    drawScreen(ctx, x - 0.43 * s, y - 0.8 * s, 0.86 * s, 1.58 * s, g);
    ctx.beginPath(); ctx.moveTo(x - 0.12 * s, y - 0.9 * s); ctx.lineTo(x + 0.12 * s, y - 0.9 * s); detailStroke(ctx, g);
  }
  function drawRouter(ctx, x, y, s, g) {
    // Antennae first, so the body panel covers where they meet it.
    ctx.beginPath();
    ctx.moveTo(x - 0.6 * s, y - 0.3 * s); ctx.lineTo(x - 0.74 * s, y - 0.95 * s);
    ctx.moveTo(x + 0.6 * s, y - 0.3 * s); ctx.lineTo(x + 0.74 * s, y - 0.95 * s);
    ctx.lineWidth = g.lw; ctx.strokeStyle = g.stroke; ctx.stroke();
    var tip = Math.max(1.2, 0.06 * s);
    ctx.fillStyle = g.stroke; ctx.beginPath();
    ctx.arc(x - 0.74 * s, y - 0.95 * s, tip, 0, 6.3);
    ctx.moveTo(x + 0.74 * s + tip, y - 0.95 * s); ctx.arc(x + 0.74 * s, y - 0.95 * s, tip, 0, 6.3);
    ctx.fill();
    roundRectPath(ctx, x - s, y - 0.3 * s, x + s, y + 0.3 * s, 0.1 * s); panel(ctx, g);
    ctx.beginPath();
    for (var i = 0; i < 3; i++) ctx.rect(x + 0.3 * s + i * 0.2 * s, y - 0.09 * s, 0.13 * s, 0.18 * s);
    detailStroke(ctx, g);
    var lr = Math.max(1.1, 0.055 * s);
    for (i = 0; i < 4; i++) led(ctx, x - 0.72 * s + i * 0.16 * s, y, lr, ledOn(g, i));
  }
  function drawDns(ctx, x, y, s, g) {
    var r = 0.85 * s, cy = 0.5 * r, cx = Math.sqrt(r * r - cy * cy);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); panel(ctx, g);
    ctx.beginPath();
    ctx.moveTo(x + 0.42 * r, y); ctx.ellipse(x, y, 0.42 * r, r, 0, 0, 6.2832);
    ctx.moveTo(x + r, y); ctx.lineTo(x - r, y);
    ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
    ctx.moveTo(x - cx, y - cy); ctx.lineTo(x + cx, y - cy);
    ctx.moveTo(x - cx, y + cy); ctx.lineTo(x + cx, y + cy);
    detailStroke(ctx, g);
  }
  function hexPath(ctx, x, y, r) {
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 3, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  function drawHex(ctx, x, y, s, g) {
    hexPath(ctx, x, y, s); panel(ctx, g);
    hexPath(ctx, x, y, 0.78 * s); detailStroke(ctx, g);
    // The code of the edge that served this page, written in the edge itself.
    ctx.fillStyle = g.ink; ctx.font = g.coloFont; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(g.colo, x, y + 0.02 * s);
    ctx.textBaseline = 'alphabetic';
  }
  function drawRack(ctx, x, y, s, g) {
    roundRectPath(ctx, x - 0.58 * s, y - s, x + 0.58 * s, y + s, 0.06 * s); panel(ctx, g);
    ctx.beginPath();
    var u, cy;
    for (u = 1; u < 4; u++) { cy = y - s + u * 0.5 * s; ctx.moveTo(x - 0.58 * s, cy); ctx.lineTo(x + 0.58 * s, cy); }
    for (u = 0; u < 4; u++) {
      cy = y - s + (u + 0.5) * 0.5 * s;
      for (var k = -1; k <= 1; k++) { ctx.moveTo(x - 0.1 * s, cy + k * 0.1 * s); ctx.lineTo(x + 0.4 * s, cy + k * 0.1 * s); }
    }
    detailStroke(ctx, g);
    var lr = Math.max(1.1, 0.055 * s);
    for (u = 0; u < 4; u++) led(ctx, x - 0.36 * s, y - s + (u + 0.5) * 0.5 * s, lr, ledOn(g, u));
  }
  var GLYPH = { laptop: drawLaptop, phone: drawPhone, router: drawRouter, dns: drawDns, edge: drawHex, origin: drawRack };

  // ---- Packet pool. Fixed-size, reused every frame: no per-frame allocation.
  // A packet's endpoints are looked up live by id/index each draw, so an
  // in-flight packet survives a resize instead of flying to a stale pixel.
  var POOL_SIZE = 96;
  function makePool() {
    var arr = [];
    for (var i = 0; i < POOL_SIZE; i++) arr.push({ active: false, kind: 'main', a: null, b: null, li: -1, rev: false, key: '', t: 0, dur: 300, color: WHITE, size: 3, delay: 0 });
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
        // A main packet resolves its wire once, here: which link, which way
        // along it, and the heat key it lights.
        var l = kind === 'main' ? LINK_OF[a + '>' + b] : null;
        p.li = l ? l.i : -1; p.rev = l ? l.rev : false; p.key = l ? l.key : '';
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

  // dir (links only) is which way the last packet crossed: +1 along the
  // link's own direction, -1 against it, so the flowing dashes run the way
  // the traffic actually went.
  function makeHeat() { return { r: REST[0], g: REST[1], b: REST[2], heat: 0, dir: 1 }; }
  function bumpHeat(h, color, dir) { h.heat = 1; h.r = color[0]; h.g = color[1]; h.b = color[2]; if (dir) h.dir = dir; }
  function decayHeat(h, dt) { h.heat *= Math.exp(-2.2 * dt); }
  var HEAT_RGB = [0, 0, 0];
  // base → the heat's own colour, written into out; no array per call.
  function heatInto(out, base, h) { HEAT_RGB[0] = h.r; HEAT_RGB[1] = h.g; HEAT_RGB[2] = h.b; return mixInto(out, base, HEAT_RGB, h.heat); }

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
        if (p.key) bumpHeat(heat.link[p.key], p.color, p.rev ? -1 : 1);
        // Pulse radius follows the NODE's own size (a ring has to reach
        // past the glyph it rings), not the packet's — a fixed multiple of
        // the packet dot would sit hidden inside an 80px node.
        // Only a lead packet (a request, a reply, a ping) rings the nodes it
        // touches. A burst or a response stream is many small packets, and a
        // ring for each would bury the diagram in ripples; they warm the node.
        if (prevT < 0.12) { bumpHeat(heat.node[p.a], p.color); if (p.size >= 3) spawnPulse(pulses, p.a, p.color, 520, nodePos[p.a].size * 1.7 + 16); }
      }
      if (p.t >= 1) {
        if (p.kind === 'main') { bumpHeat(heat.node[p.b], p.color); if (p.size >= 3) spawnPulse(pulses, p.b, p.color, 520, nodePos[p.b].size * 1.7 + 16); }
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
    { n: 60, r: 0.85, fill: 'rgba(160,170,190,0.16)', drift: 0 },
    { n: 40, r: 1.5, fill: 'rgba(160,170,190,0.32)', drift: 0 },
    { n: 20, r: 2.6, fill: 'rgba(160,170,190,0.6)', drift: 1 }
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
      ctx.fillStyle = layer.fill;
      ctx.beginPath(); ctx.arc(p.x, p.y, layer.r, 0, 6.3); ctx.fill();
    }
  }

  // ---- Wires. Each main link is a gentle quadratic arc. Its control point
  // is computed on resize (layoutLinks) and read by BOTH the wire and every
  // packet on it, so a packet rides exactly the line drawn for it. Every arc
  // bows upward (leftward, for a vertical link), so all the diagram's wires
  // curve the same way.
  var LINK_KEYS = LINKS.map(function (l) { return linkKey(l[0], l[1]); });
  function makeLinkCtrl() { return LINKS.map(function () { return { x: 0, y: 0, len: 1 }; }); }
  function layoutLinks(state) {
    for (var i = 0; i < LINKS.length; i++) {
      var a = state.nodePos[LINKS[i][0]], b = state.nodePos[LINKS[i][1]], c = state.linkCtrl[i];
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len, ny = dx / len;
      if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }
      var bulge = Math.min(30, len * 0.09);
      c.x = (a.x + b.x) / 2 + nx * bulge; c.y = (a.y + b.y) / 2 + ny * bulge; c.len = len;
    }
  }
  // Where packet p is at progress t, written into out (no allocation): its
  // position, its heading (for the comet's tail) and the length of its hop.
  // A main packet rides its link's own arc, reversed for a reply; an ambient
  // packet runs straight along its hairline.
  function packetPoint(state, p, t, out) {
    if (p.li >= 0) {
      var L = LINKS[p.li], a = state.nodePos[L[0]], b = state.nodePos[L[1]], c = state.linkCtrl[p.li];
      var u = p.rev ? 1 - t : t, v = 1 - u;
      out.x = v * v * a.x + 2 * v * u * c.x + u * u * b.x;
      out.y = v * v * a.y + 2 * v * u * c.y + u * u * b.y;
      var tx = v * (c.x - a.x) + u * (b.x - c.x), ty = v * (c.y - a.y) + u * (b.y - c.y);
      out.ang = p.rev ? Math.atan2(-ty, -tx) : Math.atan2(ty, tx);
      out.len = c.len;
      return out;
    }
    var p0 = pointOf(state, p.kind, p.a), p1 = pointOf(state, p.kind, p.b);
    var dx = p1.x - p0.x, dy = p1.y - p0.y;
    out.x = p0.x + dx * t; out.y = p0.y + dy * t;
    out.ang = Math.atan2(dy, dx); out.len = Math.sqrt(dx * dx + dy * dy) || 1;
    return out;
  }

  // The cinematic follow: tight on whatever the lead packet is doing until
  // the request lands at the edge (state.camWide), then a damped pull out to
  // the wide shot. The followed point is held above the name block rather
  // than at dead centre, where the name would cover it. Between two hops the
  // target simply holds, so the camera never lurches back to 'you'.
  var CAM_PT = { x: 0, y: 0, ang: 0, len: 1 };
  function camZoom(state) { return state.phone ? 1.6 : 1.8; }
  // World y the camera must centre on for world point y to sit at the held
  // fraction of the screen's height, at zoom z.
  function camCentreY(state, y, z) { return y + (0.5 - (state.phone ? 0.22 : 0.34)) * state.h / z; }
  function updateCamera(state, dt) {
    var cam = state.camera, tx, ty, tz;
    if (state.camWide) {
      tx = state.w / 2; ty = state.h / 2; tz = 1;
    } else {
      var lp = state.leadPacket;
      if (lp && lp.active && lp.delay <= 0) { packetPoint(state, lp, clamp(lp.t, 0, 1), CAM_PT); cam.tx = CAM_PT.x; cam.ty = CAM_PT.y; }
      tz = camZoom(state); tx = cam.tx; ty = camCentreY(state, cam.ty, tz);
    }
    cam.x = smoothDamp(cam.x, tx, 0.42, dt, cam, 'vx');
    cam.y = smoothDamp(cam.y, ty, 0.42, dt, cam, 'vy');
    cam.zoom = smoothDamp(cam.zoom, tz, 0.55, dt, cam, 'vz');
  }
  // Packets as comets: a bright pre-rendered head plus a tail sprite
  // stretched (via drawImage's destination size, not re-rendered) to a
  // length that follows how fast this hop is actually moving. Additive
  // ('lighter') so overlapping light brightens instead of overpainting.
  // Drawn BEFORE the glyphs, so a packet arriving at a node slides in
  // under its panel instead of across it.
  var PT = { x: 0, y: 0, ang: 0, len: 1 };
  function drawPackets(ctx, state) {
    var pool = state.pool, sprites = state.sprites;
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      if (!p.active || p.delay > 0) continue;
      var t = clamp(p.t, 0, 1);
      packetPoint(state, p, t, PT);
      var pal = nearestPaletteIndex(p.color);
      var tailLen = clamp(PT.len / p.dur * 150, p.size * 2.4, 130);
      var fade = t < 0.08 ? t / 0.08 : (t > 0.85 ? (1 - t) / 0.15 : 1);
      ctx.save();
      ctx.translate(PT.x, PT.y); ctx.rotate(PT.ang + Math.PI);
      ctx.globalAlpha = fade;
      ctx.drawImage(sprites.tail[pal], 0, -p.size * 2, tailLen, p.size * 4);
      ctx.restore();
      var hs = p.size * 5.6;
      ctx.globalAlpha = fade;
      ctx.drawImage(sprites.head[pal], PT.x - hs / 2, PT.y - hs / 2, hs, hs);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // Main-path links: bold with a soft glow, plus an additive flowing-dash
  // overlay while traffic is crossing, running the way that traffic went,
  // so it reads as light moving through the wire, not just a colour change.
  var DASH = [9, 11], NO_DASH = [];
  function drawLinks(ctx, state, simTime) {
    ctx.lineWidth = state.phone ? 2 : 3;
    for (var i = 0; i < LINKS.length; i++) {
      var a = state.nodePos[LINKS[i][0]], b = state.nodePos[LINKS[i][1]], c = state.linkCtrl[i];
      var h = state.heat.link[LINK_KEYS[i]];
      heatInto(MIX, REST, h);
      ctx.shadowColor = rgbCss(MIX, 0.7 * h.heat);
      ctx.shadowBlur = 4 + h.heat * 18;
      ctx.strokeStyle = rgbCss(MIX);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); ctx.stroke();
      if (h.heat > 0.1) {
        ctx.shadowBlur = 0;
        ctx.globalCompositeOperation = 'lighter';
        ctx.setLineDash(DASH);
        ctx.lineDashOffset = -h.dir * simTime * 0.09;
        ctx.strokeStyle = rgbCss(HEAT_RGB, h.heat);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); ctx.stroke();
        ctx.setLineDash(NO_DASH);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.shadowBlur = 0;
  }

  // ---- Labels are laid out on resize (wrapped to the room a node has, and
  // pulled in from the stage's edges as one block) and only drawn per frame.
  var MONO = 'ui-monospace,Menlo,Consolas,monospace';
  function layoutLabels(ctx, state, meta) {
    var phone = state.phone;
    var font = (phone ? '11px ' : '13px ') + MONO, subFont = (phone ? '10px ' : '12px ') + MONO;
    for (var i = 0; i < meta.length; i++) {
      var m = meta[i], pos = state.nodePos[m.id];
      ctx.font = subFont;
      var lines = [m.label].concat(m.sub ? wrapText(ctx, m.sub, phone ? state.w * 0.31 : 300) : []);
      var half = 0;
      for (var k = 0; k < lines.length; k++) {
        ctx.font = k === 0 ? font : subFont;
        half = Math.max(half, ctx.measureText(lines[k]).width / 2 + 8);
      }
      var lead = phone ? 13 : 15, n = lines.length;
      var y = pos.labAbove ? pos.y - GLYPH_TOP[m.kind] * pos.size - 8 - lead * (n - 1) : pos.y + GLYPH_BOTTOM[m.kind] * pos.size + (phone ? 13 : 16);
      pos.lab = {
        lines: lines, x: clamp(pos.x, half, Math.max(half, state.w - half)), y: y, lead: lead,
        // On a stage too short for the whole diagram above the text, a node
        // can end up behind the name. Its glyph stays, dimmed by the scrim,
        // but its label is not printed over the name.
        hidden: !pos.labAbove && y + lead * (n - 1) > state.textTop - 4,
        font: font, subFont: subFont
      };
    }
    state.coloFont = '600 ' + Math.round(0.34 * state.nodePos.edge.size) + 'px ' + MONO;
  }
  function drawLabel(ctx, lab) {
    if (lab.hidden) return;
    ctx.textAlign = 'center';
    ctx.font = lab.font; ctx.fillStyle = 'rgba(221,230,242,0.92)';
    ctx.fillText(lab.lines[0], lab.x, lab.y);
    if (lab.lines.length < 2) return;
    ctx.font = lab.subFont; ctx.fillStyle = 'rgba(132,144,160,0.92)';
    for (var k = 1; k < lab.lines.length; k++) ctx.fillText(lab.lines[k], lab.x, lab.y + lab.lead * k);
  }
  // One scratch object for every glyph call (see the Glyphs section).
  var G = { stroke: '', body: '', ink: '', lw: 2, heat: 0, fill: 0, simTime: 0, colo: '', coloFont: '' };
  var TINT = [0, 0, 0];
  function drawGlyphs(ctx, state, meta) {
    G.fill = state.downloadProgress; G.simTime = state.simTime; G.colo = state.colo; G.coloFont = state.coloFont;
    for (var i = 0; i < meta.length; i++) {
      var m = meta[i], pos = state.nodePos[m.id], h = state.heat.node[m.id];
      heatInto(MIX, REST_GLYPH, h);
      G.heat = h.heat;
      G.stroke = rgbCss(MIX);
      G.body = rgbCss(mixInto(TINT, BODY, MIX, 0.07 + 0.12 * h.heat));
      G.ink = rgbCss(mixInto(TINT, MIX, WHITE, 0.45));
      G.lw = clamp(pos.size * 0.035, 1.4, 2.6);
      GLYPH[m.kind](ctx, pos.x, pos.y, pos.size, G);
      drawLabel(ctx, pos.lab);
    }
  }

  // ---- Real numbers: Navigation Timing, normalised so every value below is
  // a plain millisecond duration whether the browser gives us the modern
  // entry (already relative) or the legacy `performance.timing` (epoch ms).
  function readPaint() {
    try {
      var fcp = performance.getEntriesByType('paint').filter(function (p) { return p.name === 'first-contentful-paint'; })[0];
      if (fcp) return fcp.startTime;
      var nav = performance.getEntriesByType('navigation')[0];
      if (nav && nav.domContentLoadedEventEnd > 0) return nav.domContentLoadedEventEnd;
    } catch (e) {}
    var t = performance.timing;
    return t && t.domContentLoadedEventEnd > 0 ? t.domContentLoadedEventEnd - t.navigationStart : 0;
  }
  function readTiming() {
    var nav = null;
    try { nav = performance.getEntriesByType('navigation')[0]; } catch (e) {}
    var src = nav || performance.timing;
    function d(a, b) { return Math.max(0, (src[a] || 0) - (src[b] || 0)); }
    var connect = d('connectEnd', 'connectStart');
    var tls = src.secureConnectionStart > 0 ? Math.max(0, src.connectEnd - src.secureConnectionStart) : 0;
    var size = (nav && nav.transferSize) || 0, decoded = (nav && nav.decodedBodySize) || 0;
    var protocol = (nav && nav.nextHopProtocol) || '';
    return {
      dns: d('domainLookupEnd', 'domainLookupStart'), connect: connect, tls: tls, tcp: Math.max(0, connect - tls),
      // A connect of zero is a connection the browser already had open.
      // Over HTTP/3 the transport and TLS handshakes are one QUIC exchange,
      // so neither half is reported as zero-because-reused.
      reused: connect <= 0, quic: protocol === 'h3',
      ttfb: d('responseStart', 'requestStart'), download: d('responseEnd', 'responseStart'),
      painted: readPaint(), protocol: protocol, size: size, decoded: decoded,
      fromCache: size === 0 && decoded > 0
    };
  }

  // A phase's animation length from its real duration: tiny phases stay
  // visible, long ones don't drag, and order and relative size stay true.
  function dur(ms) { return clamp(300 + 60 * Math.sqrt(Math.max(0, ms)), 300, 1600); }
  // No leg of a hop is faster than this, so a 2 ms phase split over four
  // legs is still something you can watch.
  var HOP_MIN = 210;
  function legMs(ms, legs) { return Math.max(HOP_MIN, dur(ms) / legs); }

  // A zero is a real answer, and each line says what it means.
  function fmtDns(ms, D) { return ms <= 0 ? D.host + ' · cached' : D.host + ' in ' + Math.round(ms) + ' ms'; }
  function fmtConnect(t) {
    if (t.reused) return 'reused connection to the edge';
    if (t.quic) return 'QUIC to the edge in ' + Math.round(t.connect) + ' ms';
    return 'connected to the edge in ' + Math.round(t.tcp) + ' ms';
  }
  // The measured part leads and the sampled part trails, so the dim
  // "(sample)" after it covers only what came from the sample.
  function fmtTls(t, D) {
    var how = t.reused ? 'reused session' : t.quic ? 'inside the QUIC handshake' : t.tls > 0 ? 'handshake in ' + Math.round(t.tls) + ' ms' : '';
    if (!how) return { text: 'none, this hop is plain HTTP', note: '' };
    return { text: how + ' · ' + D.edgeSample.tls + ', ' + D.edgeSample.kex, note: 'sample' };
  }
  function fmtHttp(t, D) {
    if (t.fromCache) return 'served from your browser cache, nothing sent';
    return (t.protocol || D.edgeSample.http) + ' · edge ' + D.edgeSample.colo + ', ' + D.edgeSample.city + ' · cache ' + D.edgeSample.cache;
  }
  function fmtBytes(t) {
    var bytes = t.fromCache ? 'from the browser cache' : Math.max(1, Math.round(t.size / 1024)) + ' KB in ' + Math.round(t.download) + ' ms';
    return 'first byte at ' + Math.round(t.ttfb) + ' ms · ' + bytes;
  }
  function fmtPaint(ms) { return 'on screen at ' + Math.round(ms) + ' ms'; }

  // Trace rows, in their fixed order. The log entries below name rows by
  // index; the last row is the ping.
  var ROW_LABELS = ['dns', 'tcp', 'tls', 'http', 'bytes', 'paint', 'ping'];
  var ROW_HTTP = 3, ROW_PAINT = 5, ROW_PING = 6;

  // A flat timeline built per replay from this page's own timing: hop
  // entries (a packet leg to spawn) and fx entries (a pulse or a glow),
  // sorted by start, plus log entries (a trace row to type). The frame loop
  // walks both lists with one cursor each; there are no per-phase timers.
  // Nothing crosses the network that did not: a cached lookup lights the
  // device, a reused connection glows along the path it already holds.
  var GAP = 340, STAGGER = 70;
  function buildTimeline(t, D) {
    var cursor = 600, timeline = [], logs = [], k, end;
    function route(ids, color, ms, size, at) {
      for (var i = 0; i + 1 < ids.length; i++) { timeline.push({ start: at, a: ids[i], b: ids[i + 1], color: color, dur: ms, size: size || 3.4 }); at += ms; }
      return at;
    }
    // A TLS or QUIC flight is several records at once: three packets a
    // little apart, each way.
    function burst(ids, ms, at) { var last = at; for (var j = 0; j < 3; j++) last = route(ids, WHITE, ms, 2.6, at + j * STAGGER); return last; }
    function fx(at, name) { timeline.push({ start: at, fx: name }); }
    function log(row) { logs.push({ at: cursor, row: row }); cursor += GAP; }

    if (t.dns > 0) {
      var ld = legMs(t.dns, 4);
      cursor = route(['you', 'network', 'dns'], AMBER, ld, 0, cursor);
      cursor = route(['dns', 'network', 'you'], VIOLET, ld, 0, cursor);
    } else { fx(cursor, 'local'); cursor += 380; }
    log(0);

    if (t.reused) {
      fx(cursor, 'reuse'); cursor += 420; log(1); log(2);
    } else if (t.quic) {
      var lq = legMs(t.connect, 4);
      cursor = burst(['you', 'network', 'edge'], lq, cursor);
      cursor = burst(['edge', 'network', 'you'], lq, cursor);
      log(1); log(2);
    } else {
      var lt = legMs(t.tcp, 4);
      cursor = route(['you', 'network', 'edge'], AMBER, lt, 0, cursor);
      cursor = route(['edge', 'network', 'you'], VIOLET, lt, 0, cursor);
      log(1);
      if (t.tls > 0) {
        var ls = legMs(t.tls, 4);
        cursor = burst(['you', 'network', 'edge'], ls, cursor);
        cursor = burst(['edge', 'network', 'you'], ls, cursor);
      }
      log(2);
    }

    var miss = D.edgeSample.cache !== 'HIT';
    if (t.fromCache) { fx(cursor, 'local'); cursor += 380; } else {
      var lr = legMs(t.ttfb, miss ? 4 : 2);
      cursor = route(['you', 'network', 'edge'], AMBER, lr, 0, cursor);
      if (miss) { cursor = route(['edge', 'origin'], AMBER, lr, 0, cursor); cursor = route(['origin', 'edge'], VIOLET, lr, 0, cursor); }
      else fx(cursor, 'hit');
    }
    log(ROW_HTTP);

    // The response as a stream of small violet packets, pipelined rather
    // than one after another; the count follows the real size, so a bigger
    // page visibly reads as more traffic.
    var respStart, respEnd;
    if (t.fromCache) { respStart = cursor; respEnd = cursor + 500; cursor = respEnd; } else {
      var n = clamp(Math.round(4 + Math.max(1, t.size / 1024) / 3), 4, 24);
      var lb = legMs(t.download, 2), gap = clamp(dur(t.download) / n, 45, 110);
      end = cursor;
      for (k = 0; k < n; k++) end = route(['edge', 'network', 'you'], VIOLET, lb, 2.4, cursor + k * gap);
      respStart = cursor + 2 * lb; respEnd = end; cursor = end;
    }
    log(4); log(ROW_PAINT); log(ROW_PING);
    timeline.sort(function (x, y) { return x.start - y.start; });
    return { timeline: timeline, logs: logs, respStart: respStart, respEnd: respEnd };
  }

  HeroLab.register({
    id: 'network',
    label: 'How you landed here',
    notes: {
      what: 'A live network diagram that replays how your own browser reached this page: your device, your router, DNS, the edge and the origin server, timed from real numbers your browser measured. The screen on your device fills in as the page’s bytes arrive.',
      play: 'Watch the first run play on its own. Hover or tab through a node to see what it is and its measured value. Once the log has finished, click empty space to send a real ping and watch it travel. The small button plays the landing again.',
      cost: 'It reads the browser’s own Navigation Timing for this page. On the real site the edge, city, cache and TLS facts would come from Cloudflare’s same-origin trace endpoint instead of a sample. Nothing is stored or sent anywhere else. Reduced motion shows the finished diagram and trace log with no moving packets; without canvas it falls back to a static poster with the same log as text.'
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
        dpr: clamp(env.dpr || 1, 1, 2), w: 0, h: 0, phone: false, textTop: 0,
        nodePos: {}, linkCtrl: makeLinkCtrl(), pool: makePool(), pulses: makePulsePool(), heat: makeHeatMaps(), ambient: makeAmbient(),
        sprites: ctx ? makeSprites() : null, simTime: 0, colo: D.edgeSample.colo, coloFont: '',
        running: false, raf: 0, lastT: 0, destroyed: false,
        timing: readTiming(), cursor: 0, timeline: null, logs: null, tIdx: 0, lIdx: 0, replaying: false,
        ambientAccum: 0, ambientBurstAccum: 4 + Math.random() * 4, keepAccum: Math.random() * 3,
        pingBusy: false, cardId: null, typing: null,
        // Cinematic camera: a critically damped follow (see smoothDamp);
        // tx/ty is the world point it is holding on.
        camera: { x: 0, y: 0, zoom: 1, vx: 0, vy: 0, vz: 0, tx: 0, ty: 0 },
        camWide: true, leadPacket: null, downloadProgress: 0, respStart: 0, respEnd: 0
      };

      // ---- Trace rows: the whole log is built here, every row hidden, so
      // the text block has its final height before the first line types
      // (and before the first resize measures it).
      var rows = ROW_LABELS.map(function (label) {
        var row = document.createElement('div'), b = document.createElement('b'), txt = document.createElement('span');
        var typed = document.createElement('span'), rest = document.createElement('span'), note = document.createElement('span');
        row.className = 'nw-row'; b.textContent = label; rest.className = 'nw-rest'; note.className = 'nw-note';
        txt.appendChild(typed); txt.appendChild(rest); txt.appendChild(note);
        row.appendChild(b); row.appendChild(txt);
        dom.trace.appendChild(row);
        return { row: row, typed: typed, rest: rest, note: note, text: '' };
      });
      var pingHint = (env.isTouch ? 'tap' : 'click') + ' anywhere to send a ping';
      function setRow(r, text, noteText) {
        r.text = text; r.typed.textContent = ''; r.rest.textContent = text;
        r.note.textContent = noteText ? ' (' + noteText + ')' : '';
        r.note.classList.add('nw-wait'); r.row.classList.remove('nw-on');
      }
      function showRow(r) { r.row.classList.add('nw-on'); r.typed.textContent = r.text; r.rest.textContent = ''; r.note.classList.remove('nw-wait'); }
      function fillRows() {
        var t = state.timing, tls = fmtTls(t, D);
        setRow(rows[0], fmtDns(t.dns, D));
        setRow(rows[1], fmtConnect(t));
        setRow(rows[2], tls.text, tls.note);
        setRow(rows[ROW_HTTP], fmtHttp(t, D), t.fromCache ? '' : 'sample');
        setRow(rows[4], fmtBytes(t));
        setRow(rows[ROW_PAINT], fmtPaint(t.painted));
        setRow(rows[ROW_PING], pingHint);
        rows[ROW_PING].row.classList.add('nw-hint');
      }
      // First paint is often recorded after this module starts, so the paint
      // row re-reads it at the moment it is written.
      function refreshPaint() {
        var p = readPaint();
        if (p > 0 && p !== state.timing.painted) { state.timing.painted = p; rows[ROW_PAINT].text = fmtPaint(p); rows[ROW_PAINT].rest.textContent = rows[ROW_PAINT].text; }
      }
      fillRows();

      // A line types at a terminal's pace, and faster when the next row is
      // due sooner, so every line finishes typing before the next begins.
      var TYPE_CPS = 60;
      function startTyping(r) {
        // Two rows due in one frame (a slow frame, a tab resume): finish the
        // one in flight rather than orphan it half-typed.
        if (state.typing) showRow(state.typing.r);
        r.row.classList.add('nw-on');
        var next = state.logs && state.lIdx < state.logs.length ? state.logs[state.lIdx].at - state.cursor : Infinity;
        state.typing = { r: r, shown: 0, cps: Math.max(TYPE_CPS, r.text.length / Math.max(0.12, next * 0.85 / 1000)) };
      }
      function advanceTyping(dt) {
        var ty = state.typing;
        if (!ty) return;
        ty.shown += dt * ty.cps;
        var full = ty.r.text, n = Math.min(full.length, Math.floor(ty.shown));
        ty.r.typed.textContent = full.slice(0, n); ty.r.rest.textContent = full.slice(n);
        if (n >= full.length) { ty.r.note.classList.remove('nw-wait'); state.typing = null; }
      }

      // ---- Node buttons: invisible, focusable overlays so keyboard users
      // reach the same info a hover gives a mouse. The glyphs themselves are
      // canvas-drawn, so this is the only real DOM per node.
      function nodeInfo(id) {
        var t = state.timing;
        if (id === 'you') return 'Your device · ' + meta[0].sub;
        if (id === 'network') return 'Your router · every request leaves through it';
        if (id === 'dns') return 'DNS resolver · ' + (t.dns <= 0 ? 'answered from cache' : 'answered in ' + Math.round(t.dns) + ' ms');
        if (id === 'edge') return 'Cloudflare edge ' + D.edgeSample.colo + ' · ' + D.edgeSample.city + ' · cache ' + D.edgeSample.cache + ' (sample)';
        return 'Origin server · ' + D.origin;
      }
      var buttons = {};
      meta.forEach(function (m) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'nw-node-btn';
        b.setAttribute('aria-label', nodeInfo(m.id));
        b.addEventListener('mouseenter', function () { showCard(m.id); });
        b.addEventListener('mouseleave', function () { hideCard(m.id); });
        b.addEventListener('focus', function () { showCard(m.id); });
        b.addEventListener('blur', function () { hideCard(m.id); });
        dom.nodesLayer.appendChild(b);
        buttons[m.id] = b;
      });
      function showCard(id) {
        state.cardId = id;
        dom.card.textContent = nodeInfo(id);
        var p = state.nodePos[id], cam = state.camera;
        if (!p) return;
        // Node positions are world coordinates; the card lives in screen
        // space, so it goes through the same camera the canvas does.
        var z = cam.zoom, sx = (p.x - cam.x) * z + state.w / 2, sy = (p.y - cam.y) * z + state.h / 2, r = p.size * z;
        var left = sx + r + 14, top = clamp(sy - 10, 8, Math.max(8, state.h - 60));
        if (left + 230 > state.w) left = sx - r - 14 - 230;
        dom.card.style.left = clamp(left, 8, Math.max(8, state.w - 238)) + 'px';
        dom.card.style.top = top + 'px';
        dom.card.classList.add('nw-show');
      }
      function hideCard(id) { if (state.cardId === id) { state.cardId = null; dom.card.classList.remove('nw-show'); } }

      // Positions, wires, labels and hit areas, from the stage size and, on a
      // phone, the measured top of the text block.
      function layout() {
        // Side by side when the name and the log fit with room between
        // them; stacked otherwise. Measured with the stack off, since
        // stacking is what moves the log.
        // When the name would run into the log, it first shrinks to fit
        // (the log's width is fixed by its longest line); only when that
        // would take it below 3rem does the log move under the tagline.
        dom.root.classList.remove('nw-stack');
        dom.name.style.fontSize = '';
        dom.tagline.style.maxWidth = '';
        var stacked = false;
        if (!state.phone) {
          var nr = dom.nameText.getBoundingClientRect(), logLeft = dom.readout.getBoundingClientRect().left;
          var room = logLeft - 40 - nr.left;
          if (nr.width > room) {
            var fit = parseFloat(getComputedStyle(dom.name).fontSize) * room / nr.width * 0.99;
            if (fit >= 48) dom.name.style.fontSize = fit + 'px';
            else { stacked = true; dom.root.classList.add('nw-stack'); }
          }
          // The tagline wraps short of the log too, rather than running
          // up against its first column.
          if (!stacked) dom.tagline.style.maxWidth = 'min(46ch, ' + Math.max(160, logLeft - 40 - dom.tagline.getBoundingClientRect().left) + 'px)';
        }
        // The top of the text block: the name, or the log beside it if the
        // log is the taller of the two.
        state.textTop = dom.hero.offsetTop + (state.phone || stacked ? 0 : Math.min(0, dom.readout.offsetTop));
        state.nodePos = layoutPositions(state.w, state.h, state.phone, state.textTop);
        layoutLinks(state);
        if (ctx) layoutLabels(ctx, state, meta);
        meta.forEach(function (m) {
          var p = state.nodePos[m.id], hit = p.size * 1.7, btn = buttons[m.id];
          btn.style.left = p.x + 'px'; btn.style.top = p.y + 'px';
          btn.style.width = hit + 'px'; btn.style.height = hit + 'px'; btn.style.margin = (-hit / 2) + 'px 0 0 ' + (-hit / 2) + 'px';
        });
      }
      function resize(w, h) {
        state.w = w; state.h = h; state.phone = w <= 520;
        dom.root.classList.toggle('nw-phone', state.phone);
        if (ctx) { dom.canvas.width = Math.max(1, Math.round(w * state.dpr)); dom.canvas.height = Math.max(1, Math.round(h * state.dpr)); }
        layout();
        resizeAmbient(state.ambient, w, h);
        // Keep the wide shot actually wide across a resize, but only while
        // wide, so a resize mid-replay does not fight the follow camera.
        if (state.camWide) { state.camera.x = w / 2; state.camera.y = h / 2; state.camera.zoom = 1; }
        if (state.cardId) showCard(state.cardId);
        renderNow();
      }
      // The name's web font changes the text block's height once it loads.
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { if (!state.destroyed && state.w) { layout(); renderNow(); } });
      }

      // ---- Drawing: canvas is HiDPI-scaled once per frame, cleared in that
      // plain space, THEN the camera is applied so world content draws in
      // world px regardless of zoom. The invisible node-button layer gets
      // the identical CSS transform, so hit areas track the camera too.
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
        drawPackets(ctx, state);
        drawGlyphs(ctx, state, meta);
        drawPulses(ctx, state.pulses, state.nodePos);
        dom.nodesLayer.style.transform = 'translate(' + (state.w / 2) + 'px,' + (state.h / 2) + 'px) scale(' + cam.zoom + ') translate(' + (-cam.x) + 'px,' + (-cam.y) + 'px)';
      }
      function renderNow() { if (!state.running) draw(); }

      // Builds (or rebuilds, for the replay button) the timeline from this
      // page's own timing. "This is you": a ripple opens the run from the
      // node the whole diagram is about, with the camera close on it.
      function startReplay() {
        var built = buildTimeline(state.timing, D);
        state.timeline = built.timeline; state.logs = built.logs;
        state.tIdx = 0; state.lIdx = 0; state.cursor = 0; state.replaying = true; state.typing = null;
        state.respStart = built.respStart; state.respEnd = built.respEnd; state.downloadProgress = 0;
        state.leadPacket = null; state.camWide = false;
        fillRows();
        if (ctx) {
          var you = state.nodePos.you, cam = state.camera, z = camZoom(state);
          spawnPulse(state.pulses, 'you', WHITE, 950, you.size * 2.6 + 30);
          cam.tx = you.x; cam.ty = you.y;
          cam.x = you.x; cam.y = camCentreY(state, you.y, z); cam.zoom = z; cam.vx = cam.vy = cam.vz = 0;
        }
      }
      // Reduced motion never runs the loop, so the whole replay resolves at
      // once: every hop's heat is applied in order (last write wins, which is
      // the state an animated run settles into) and every row is shown.
      function renderFinalState() {
        var built = buildTimeline(state.timing, D);
        state.downloadProgress = 1;
        state.camWide = true;
        var cam = state.camera;
        cam.x = state.w / 2; cam.y = state.h / 2; cam.zoom = 1; cam.vx = cam.vy = cam.vz = 0;
        built.timeline.forEach(function (e) {
          if (e.fx) return;
          var l = LINK_OF[e.a + '>' + e.b], lh = l && state.heat.link[l.key];
          if (lh) { lh.heat = 0.55; lh.r = e.color[0]; lh.g = e.color[1]; lh.b = e.color[2]; }
          [e.a, e.b].forEach(function (id) { var nh = state.heat.node[id]; if (nh) { nh.heat = 0.5; nh.r = e.color[0]; nh.g = e.color[1]; nh.b = e.color[2]; } });
        });
        fillRows(); refreshPaint();
        rows.forEach(showRow);
        draw();
      }

      function runFx(e) {
        var you = state.nodePos.you, edge = state.nodePos.edge;
        if (e.fx === 'local') { bumpHeat(state.heat.node.you, WHITE); spawnPulse(state.pulses, 'you', WHITE, 700, you.size * 1.8 + 20); }
        else if (e.fx === 'reuse') {
          bumpHeat(state.heat.link[LINK_KEYS[0]], WHITE, 1); bumpHeat(state.heat.link[LINK_KEYS[2]], WHITE, 1);
          bumpHeat(state.heat.node.edge, WHITE); spawnPulse(state.pulses, 'edge', WHITE, 600, edge.size * 1.7 + 16);
        }
        else if (e.fx === 'hit') { bumpHeat(state.heat.node.edge, AMBER); spawnPulse(state.pulses, 'edge', WHITE, 650, edge.size * 1.9 + 18); }
        else if (e.fx === 'pong') { state.pingBusy = false; setPing(e.text, false); }
      }
      function advanceTimeline(dt) {
        if (!state.timeline) return;
        state.cursor += dt * 1000;
        var tl = state.timeline;
        while (state.tIdx < tl.length && state.cursor >= tl[state.tIdx].start) {
          var e = tl[state.tIdx++];
          if (e.fx) { runFx(e); continue; }
          // The lead packet is the newest hop, furthest along the route; the
          // camera (updateCamera) follows it.
          var np = spawnPacket(state.pool, 'main', e.a, e.b, e.color, e.dur, e.size);
          if (np) state.leadPacket = np;
        }
        while (state.lIdx < state.logs.length && state.cursor >= state.logs[state.lIdx].at) {
          var row = state.logs[state.lIdx++].row;
          // The request has landed at the edge: the route is decided and
          // nothing is left to chase, so the camera pulls out for the response.
          if (row === ROW_HTTP) state.camWide = true;
          if (row === ROW_PAINT) refreshPaint();
          startTyping(rows[row]);
        }
        if (state.respEnd > state.respStart) {
          state.downloadProgress = clamp((state.cursor - state.respStart) / (state.respEnd - state.respStart), 0, 1);
        }
        if (state.replaying && state.lIdx >= state.logs.length && !state.typing) state.replaying = false;
      }
      // The field's own pace tells the day/night story the packet colour
      // does: denser and quicker by day (payments at scale), sparser by night.
      function ambientTick(dt) {
        state.ambientAccum -= dt;
        if (state.ambientAccum > 0) return;
        var day = D.dayness(D.localMinutes());
        state.ambientAccum = lerp(0.42, 0.18, day) + Math.random() * lerp(0.32, 0.14, day);
        var links = state.ambient.links, pick = links[(Math.random() * links.length) | 0];
        spawnPacket(state.pool, 'ambient', pick[0], pick[1], D.hourColor(D.localMinutes()), lerp(1100, 650, day), 1.5);
      }
      // Occasional bursts: a short chain of ambient links carries several
      // small packets in quick succession, like a surge of traffic. Denser,
      // faster and amber by day; sparser, slower and violet by night, tinted
      // by the real hourColor.
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
        var count = Math.round(lerp(4, 9, day)), leg = lerp(760, 420, day), stagger = leg / 2.6, t = 0;
        for (var k = 0; k < count; k++) {
          var li = k % (chain.length - 1);
          spawnPacket(state.pool, 'ambient', chain[li], chain[li + 1], color, leg, day >= 0.5 ? 1.7 : 1.3, t);
          t += stagger;
        }
      }
      function keepaliveTick(dt) {
        if (state.replaying) return;
        state.keepAccum -= dt;
        if (state.keepAccum > 0) return;
        state.keepAccum = 3 + Math.random() * 3.5;
        var l = LINKS[(Math.random() * LINKS.length) | 0], out = Math.random() < 0.5;
        spawnPacket(state.pool, 'main', out ? l[0] : l[1], out ? l[1] : l[0], out ? AMBER : VIOLET, 550, 2);
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

      // ---- Ping: a real request, timed. One at a time, and not while the
      // landing is still replaying (its last row is the ping's own).
      function setPing(text, instant) {
        var r = rows[ROW_PING];
        r.row.classList.remove('nw-hint');
        r.text = text; r.note.textContent = '';
        if (instant) showRow(r); else startTyping(r);
      }
      function finishPing(ms) {
        if (state.destroyed) return;
        var text = ms < 0 ? 'no answer this time' : 'answered in ' + Math.round(ms) + ' ms';
        if (reduced || !ctx || !state.running || ms < 0) {
          state.pingBusy = false;
          setPing(text, reduced || !state.running);
          if (ctx && ms >= 0) {
            bumpHeat(state.heat.node.edge, VIOLET);
            bumpHeat(state.heat.link[LINK_KEYS[0]], VIOLET, -1);
            bumpHeat(state.heat.link[LINK_KEYS[2]], VIOLET, -1);
            renderNow();
          }
          return;
        }
        // The packet travels the measured round trip (clamped to watchable),
        // and the row updates when it lands, not when the fetch resolved.
        var leg = clamp(ms / 4, HOP_MIN, 500), t = state.cursor + 30, tl = state.timeline;
        [['you', 'network'], ['network', 'edge']].forEach(function (h) { tl.push({ start: t, a: h[0], b: h[1], color: AMBER, dur: leg, size: 3 }); t += leg; });
        [['edge', 'network'], ['network', 'you']].forEach(function (h) { tl.push({ start: t, a: h[0], b: h[1], color: VIOLET, dur: leg, size: 3 }); t += leg; });
        tl.push({ start: t, fx: 'pong', text: text });
      }
      function ping() {
        if (state.pingBusy || state.replaying || !state.timeline && ctx && !reduced) return;
        state.pingBusy = true;
        var t0 = performance.now();
        fetch('network.js', { cache: 'no-store' }).then(function () { finishPing(performance.now() - t0); }).catch(function () { finishPing(-1); });
      }
      function onReplay() {
        if (reduced || !ctx) { renderFinalState(); return; }
        startReplay();
        if (!state.running) start();
      }
      dom.click.addEventListener('click', ping);
      dom.replay.addEventListener('click', onReplay);

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
        dom.replay.removeEventListener('click', onReplay);
        if (dom.root.parentNode) dom.root.parentNode.removeChild(dom.root);
      }

      return { start: start, stop: stop, resize: resize, destroy: destroy };
    }
  });
})();
