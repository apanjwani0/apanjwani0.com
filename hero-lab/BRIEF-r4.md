# Hero Lab round 4: "How you landed here"

BRIEF.md's rules still hold: the contract, performance, accessibility, reduced motion, the no-WebGL fallback and the copy style. So does round 3's rule: **no tools, games or writing references of any kind.** This file adds one new concept.

## What the owner asked for

> "A live animated background of systems, links, connections, network calls. Like PC + networking. Idea: what if we show how you landed here. Kind of an animated flow."

The owner is a backend engineer who builds payments at scale. The hero becomes a living network diagram that **replays this visitor's own page load**, using real numbers measured by their browser, and then keeps running as a live system.

## Build `network.js`

The module registers as `id: 'network'`, `label: 'How you landed here'`, under the same `HeroLab.register` contract. The shell is `hero-lab-r4.html`. Read its `<script>` for `env.data`, which provides:
- `name`, `line`, `host` ('apanjwani0.com'), `origin` ('Node.js in Docker on Oracle Cloud');
- `edgeSample` `{ colo, city, http, tls, kex, cache, sample: true }`;
- `hourColor(min)` → `[r, g, b]` in 0..1, and `localMinutes()`.

Don't use the clock scrubber in this concept.

### The scene: 2D canvas, crisp lines, glowing packets

**Five nodes,** each a small line-drawn glyph (1.5px strokes) with a mono label:
1. **you**: a laptop, or a phone when `(pointer: coarse)`. Its sub-label is "from ‹referrer host›", taken from `new URL(document.referrer).host`, or "typed or bookmarked" when there's no referrer. Never show an IP.
2. **your network**: a router.
3. **DNS**: a resolver, off to one side of the you→edge path.
4. **edge · ‹colo›**: Cloudflare's edge, drawn as a hexagon. Its sub-label is "‹city› · cache ‹HIT|MISS›".
5. **origin**: a server rack. Its sub-label is `env.data.origin`.

**Links:** you–network, network–DNS, network–edge, edge–origin.

**Layout:**
- **Desktop:** a gentle left-to-right arc across the upper part of the stage.
- **Phone (≤ 520px):** a compact layout that fits 390px with every label readable.
- **Clearance:** nodes and labels must stay clear of the name and tagline block.

**An ambient field behind them:** faint distant nodes and hairline links standing for the rest of the internet, with the occasional tiny packet crossing between them, so the page feels like a live system even when nothing is being replayed. Tint the ambient packets with `hourColor(localMinutes())`; the colour of the field drifts through the day.

**Packet colours:**
- Outbound (requests) are amber `#ffb35c`.
- Inbound (responses) are violet `#9b8cff`.
- Handshake packets are near-white.
- A link or node lights up in its packet's colour while traffic crosses it, then fades back to `#394255`.

### The replay: real numbers

1. About 600 ms after start, read `performance.getEntriesByType('navigation')[0]`, falling back to `performance.timing`. Compute:
   - `dns` = `domainLookupEnd` − `domainLookupStart`
   - `tcp` = `connectEnd` − `connectStart` − `tls`
   - `tls` = `connectEnd` − `secureConnectionStart`, but only when `secureConnectionStart` > 0
   - `ttfb` = `responseStart` − `requestStart`
   - `download` = `responseEnd` − `responseStart`
   - `painted` = the `first-contentful-paint` entry if there is one, else `domContentLoadedEventEnd`
   - `protocol` = `nextHopProtocol`
   - `size` = `transferSize`. A value of 0 with `decodedBodySize` > 0 means the page came from the browser cache.
2. **A zero is a real answer, and says what it means.** DNS 0 ms reads "cached", connect 0 reads "reused connection".
3. **Animate the phases along the right links:**
   - DNS query and answer: you → network → DNS and back;
   - TCP: you ↔ edge;
   - TLS: a quick burst of handshake packets;
   - HTTP request: you → edge. On a cache MISS it continues edge → origin → edge first.
   - The response: a stream of small violet packets, edge → you.
4. **Timing:** each phase's animation length is `clamp(300 + 60·√ms, 300, 1600)`. Tiny phases stay visible, long ones don't drag, and the order and relative size stay true. The whole replay runs about 4–7 s.
5. **A mono trace log writes one line per phase as it plays.** Right-align it on desktop; on a phone, put it under the tagline. For example:

   ```
   dns     apanjwani0.com in 14 ms          (or: cached)
   tcp     connected to the edge in 21 ms   (or: reused connection)
   tls     TLSv1.3 · X25519MLKEM768 · 18 ms
   http    h3 · edge BOM, Mumbai · cache HIT
   bytes   first byte at 61 ms · 38 KB in 12 ms
   paint   on screen at 212 ms
   ```

   - Values from `edgeSample` (colo, city, cache, tls version, kex) end with a dim "(sample)". On the real site those come from Cloudflare's trace endpoint.
   - Everything else is really measured. In the lab, that means the lab page's own load inside its frame.
   - `protocol` is measured; show `edgeSample.http` only when `nextHopProtocol` is empty.

### After the replay: live

- The five nodes stay. Every few seconds a small keep-alive packet crosses a link, and the ambient field keeps going.
- **Ping:** clicking or tapping empty space sends a real one. Time `fetch('network.js', { cache: 'no-store' })` with `performance.now()`. A packet travels you → edge and back over the measured duration, and the log adds `ping    answered in 38 ms`.
  - On the real site this would be `/cdn-cgi/trace`; mention that only in the `cost` note.
  - Rate-limit pings to one in flight.
- **Hover or tap a node:** a small DOM card built with `textContent` says what the node is and its measured value, for example "DNS resolver · answered in 14 ms". The node glyphs themselves are canvas-drawn, so give each node a focusable, invisible `<button>` overlay with an `aria-label`, so keyboard users can tab through the nodes and see the same card.
- **A small mono "replay" button** plays the landing again.

### Copy and layout

- **The name** is a large serif `<h1>` in the DOM; **the tagline** sits under it; both bottom-left over a soft local scrim.
- Nothing else: no section links, no counts, no tools or games.
- **Canvas label:** `role="img"` plus an `aria-label` describing the scene.

### Reduced motion, no canvas, cost

- **Reduced motion:** draw the final state (every node lit once, the full trace log already written) with no moving packets. Ping still works; it shows its result without animating.
- **If 2D canvas fails:** fall back to a CSS poster, with the trace log still rendered as text.
- **Performance:**
  - one rAF loop, stopped by `stop()`;
  - pool packets, with no per-frame allocations;
  - dpr ≤ 2;
  - hold 60 fps easily; this is a light scene.
- **No external resources,** and no fetch except the relative ping.

### Notes (`what`, `play`, `cost`)

Plain sentences with no em-dash asides:
- **what:** the page replays the visitor's own page load.
- **play:** watch, hover the nodes, click to ping, replay.
- **cost:** it reads the browser's Navigation Timing and, on the real site, Cloudflare's same-origin `/cdn-cgi/trace`. Nothing is stored or sent anywhere else.

## Test (look once, fix once)

Global Playwright, launched with `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. Open `file://…/hero-lab-r4.html?c=network`, then save to `shots-r4/`:
- `network-mid.png`: 1440×900, about 2.5 s in (mid-replay);
- `network-done.png`: 1440×900, about 9 s in;
- `network-m.png`: 390×844, about 9 s in;
- `network-reduced.png`: reduced motion;
- `network-ping.png`: after a click on empty space.

Pass criteria:
- No console errors from your file.
- `scrollWidth === clientWidth`.
- `grep -iE "tool|game|openLink"` finds nothing in `network.js`.

## Output size

- No more than ~150 lines per tool call.
- Run `node --check` after each piece.
- Keep your thinking brief.

Report in under 200 words.
