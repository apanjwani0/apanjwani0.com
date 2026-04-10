# Games

Mini-games integrated into the portfolio. Each game is developed independently and compiled to WebAssembly for browser delivery.

## How it works

- Games are listed on `/games` — content comes from `src/config/games.ts` (managed via `/admin`)
- Each game entry has an `enabled` toggle — disabled games don't appear on the page
- Game source code lives in its own folder (e.g. `flash-cricket/`) and can be developed/built independently
- When a game is ready for integration, add an Astro component and page route for it

## Adding a new game

1. Add the game config in `/admin` → games tab (slug, title, description, enabled)
2. Build the game's WASM output into `public/games/{slug}/`
3. Create an Astro island component in `src/components/games/`
4. Create a page route at `src/pages/games/{slug}.astro`

## Current games

- **flash-cricket** — 2D cricket game (C++/Raylib → WASM). Source in `/flash-cricket/`. Status: prototype.
