# Games

Mini-games surfaced on `/games`. Content comes from `src/config/games.ts` (managed
via `/admin`). Each entry has an `enabled` toggle (hidden when false) and an
`interactive` flag (renders a live component vs. a "coming soon" placeholder).

Two kinds of game live here:

- **In-browser TypeScript / Canvas games** — the live ones. Self-contained
  WebComponents under `src/components/games/{slug}/`, no build step, no WASM.
  This is the default for new games.
- **Independently-built WASM games** (e.g. `flash-cricket`, C++/Raylib → WASM)
  whose output is dropped into `public/games/{slug}/`. Heavier — only when a game
  genuinely needs it.

## Current games

- **game-of-life** — Conway's Game of Life, interactive canvas. Live.
- **2048** — sliding-tile puzzle with 3×3, 4×4, and 5×5 boards. Live.
- **quintle** — daily and practice five-letter word game. Live.
- **flow-field** — seeded particle-flow art toy. Live.
- **maze-weaver** — seeded maze generator and pathfinding visualizer. Live.
- **starfield-toy** — interactive warp-speed starfield. Live.
- **murmuration** — interactive boids flocking simulation. Live.
- **lsystem-tree** — seeded L-system fractal garden. Live.
- **type-trial** — typing-speed / WPM game with per-category bests. Live. (Moved
  here from `/tools`; `/tools/type-trial` 301-redirects to `/games/type-trial`.)
- **hue-hunt** — hex-colour guessing game (pick or type a hex, scored on
  perceptual closeness, with an R/G/B breakdown on reveal). Live.
- **poker** — local-first Poker Together subsystem. Disabled while its online
  room flow remains experimental.
- **flash-cricket** — 2D arcade cricket (C++/Raylib → WASM). Enabled in config but
  not yet embedded — shows "coming soon".

## Adding a new game (TypeScript / Canvas — the common path)

1. Add the entry to `src/config/games.ts` (or `/admin` → games tab): `slug`,
   `title`, `description`, `enabled`, `interactive: true`, `keywords`.
2. Build the game as a WebComponent under `src/components/games/{slug}/` (a `.ts`
   controller + `.css`, theme tokens only). Mount it inside
   `document.addEventListener('astro:page-load', …)` (View Transitions gotcha — see
   AGENTS.md).
3. Wire it into `src/pages/games/[slug].astro`: import its CSS, add a
   `slug === '{slug}'` render branch for the custom element, and add the
   dynamic-`import()` branch in the `astro:page-load` mount block.

It then appears on the `/games` index and in the sitemap automatically (both
iterate `getGames`). For a WASM game instead, build its output into
`public/games/{slug}/` and embed that from the render branch.

Wallpaper Forge is a tool at `/tools/wallpaper-forge`; its former game URL
permanently redirects there.
