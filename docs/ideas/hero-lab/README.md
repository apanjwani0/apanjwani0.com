# Hero Lab: archived concepts

The home-hero prototypes from 2026-09, each a self-contained page: open a
folder's `index.html` straight from disk, no build or server. The site loads
nothing from here. The one change from the originals: the network concept's
field naming the origin's host provider and runtime is replaced by a generic
label, in every copy that inherited it.

- **`liquid-light/`**: a WebGL fluid, ink coloured by the hour where the owner
  is; drag to stir, tap for a burst, scrub the day along the bottom strip. It
  led the shortlist until the owner called it "more like a screen saver". The
  TypeScript port runs at `/?hero=liquid`.
- **`network-path/`**: a replay of the visitor's own page load (device,
  router, DNS, edge, origin) from Navigation Timing. The owner liked the idea
  but not the design, and it must never show host provider, runtime or origin
  details. The port (`src/components/home/hero/network.ts`) runs at
  `/?hero=network`.
- **`black-hole/`**: a shader black hole that lenses the page and the owner's
  name. Not picked.
- **`fractal/`**: a live GPU deep zoom into the Mandelbrot set. Not picked.
- **`round-1/`**: the first three concepts behind one switcher (a
  constellation of the site's pages, a name built from sampled glyph points, a
  terminal). Not picked.

## Where these could go

The owner wants them kept as ideas for a screensaver and for the image and GIF
tools. Liquid light already runs standalone and reduced-motion-aware, so it
could follow the owner's earlier macOS screensaver
([Clock-Screen-Saver](https://github.com/apanjwani0/Clock-Screen-Saver)). Any of
the continuous canvas loops could become a Driftfield engine
(`src/lib/driftfield.ts`), which gets PNG and GIF export from
`attachCanvasExport` in `src/lib/canvas-export.ts`.
