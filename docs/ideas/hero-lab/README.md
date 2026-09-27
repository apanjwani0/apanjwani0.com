# Hero Lab: archived concepts

These are the "Hero Lab" prototypes explored across 2026-09 for the home page
hero, archived here as flat, self-contained HTML pages. Each folder holds the
latest version of one concept plus the lab shell it ran in, so opening its
`index.html` directly in a browser (`file://`) runs it — no build step, no
server.

They are static snapshots for reference, not live code: the site's home page
does not load anything from this folder. A data field naming the origin
server's host provider and runtime (used by the network concept, present in
every copy that inherited it) was replaced with a generic label; nothing else
was changed beyond trimming each shell so it loads only the one concept in its
folder.

## Liquid light — `liquid-light/`

A WebGL stable-fluids simulation: ink pours from two emitters into a dark
field, coloured by the time of day where the owner is — coral at dawn, gold at
noon, rose at dusk, violet at night. Drag to stir the fluid or throw a ribbon
of light through it, tap for a burst of colour, and drag the strip along the
bottom to scrub through the day and watch the light and the ink change with
it.

Round 5, the final, owner-approved polish pass (round 2 introduced the
concept; round 3 added the day/night clock). It led the home-hero shortlist
until the verdict below moved it to the screensaver pile; the site's
TypeScript port still runs on the dev server at `/?hero=liquid`.

Owner's verdict: "I actually like the liquid light background but it's more
like a screen saver for me. I really loved the smoke design and realness it's
trippy and trance."

## Network path — `network-path/`

A 2D canvas diagram that replays the visitor's own page load — device,
router, DNS, edge and origin — using real numbers read from the browser's
Navigation Timing API, then keeps running as a live system with an ambient
field of distant packets. Hover or tab to a node for its measured value,
click empty space to send a real ping, or press replay to watch the landing
again.

Round 4, the "bold" variant (`r4-bold/network.js`) the owner reviewed.

Owner's verdict: "The network path approach was nice, but design wise we may
improve some things, + i don't want to leak any of my sensitive info." It
must never show host provider, runtime or origin details anywhere. The copy
in this folder has that field genericized, and the site's own TypeScript port
(`src/components/home/hero/network.ts`) already prints a generic label
(`'the server that renders this page'`) instead of naming anything. It runs
on the dev server at `/?hero=network`.

## Black hole — `black-hole/`

A real-time shader black hole that lenses the page around itself: starfield,
the owner's name and a tilted, turbulent accretion disk, warm by day and
violet by night on the same clock as liquid light. Drag the hole through the
name to warp it, scroll or pinch to add mass, click empty space to throw a
comet.

Round 3. Explored earlier and not picked as the home hero.

## Fractal — `fractal/`

A live GPU deep-zoom into the Mandelbrot set, coloured by the same day/night
clock, with a status line reading out the exact coordinate and iteration
count of the frame in front of you. Click to steer the fall toward a new
point, hold to fall faster, double-click to surface into the next dive, or
take the wheel yourself with drag and scroll.

Round 3. Explored earlier and not picked as the home hero.

## Round 1 concepts — `round-1/`

The first three prototypes, kept as a single unmodified lab file
(`round-1/index.html`) with a switcher between them:

- **Constellation** — every live tool, playable game and published article
  drawn as a star, grouped into three constellations and joined star to star
  by a minimum spanning tree; each star links to its real page.
- **Starborn name** — the owner's name built from points sampled off real
  glyph pixels, gathering into shape on load and answering to the pointer
  afterward.
- **Terminal** — a small shell that boots with `whoami` and `ls`, then hands
  over a real prompt (`help`, `ls`, `cd`, `open`, `today`, `theme`, `clear`,
  `about`).

Round 1. Explored earlier and not picked as the home hero.

## Where these could go next

The owner asked to keep these "as ideas and references for screen saver" and
to maybe "add these graphics in our image or gif generator tools" — two
concrete paths, both already supported by something in the codebase.

**Screen saver.** The owner has shipped a macOS screensaver before
([github.com/apanjwani0/Clock-Screen-Saver](https://github.com/apanjwani0/Clock-Screen-Saver)),
so liquid light — the concept called "trippy and trance" above — is a natural
next one: it already runs standalone, reduced-motion-aware, and tinted by the
time of day.

**Image / GIF generator.** The site already has this shape. A Driftfield mode
(`src/lib/driftfield.ts`, mounted through `EMBED_TAGS` from a component under
`src/components/games/…`) is a `/tools/driftfield/<slug>` route wrapping one
canvas engine, and it gets PNG and animated-GIF export for free by calling
`attachCanvasExport(host, () => canvas, { name })` from
`src/lib/canvas-export.ts` — no per-engine export code, just a live canvas and
a name. That function also offers a resolution choice and a preview of the
file before it saves, and, for an engine that only redraws on interaction
rather than animating on its own clock, a deterministic `AnimationSource` in
place of filming the live canvas. Wallpaper Forge
(`src/components/tools/wallpaper-forge/`) is the site's still-image
analogue, for a concept that only needs one frame. Liquid light, black hole
and fractal are all continuous canvas/WebGL loops, so any of them could
become a seventh Driftfield engine.
