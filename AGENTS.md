# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal portfolio site — an SSR Astro app that renders a home hero, plus
projects / experience / blogs / games / tools sections. All personal content is
**runtime-editable** through a dev-only `/admin` page that writes to Cloudflare
KV; the bundled `src/config/*.ts` files are the git-tracked fallbacks.

**Stack**
- **Astro 6**, fully SSR (`export const prerender = false` on every page).
- **Adapter**: `@astrojs/node` is active; `@astrojs/cloudflare` is the swap-in for
  Workers deploys. `astro.config.mjs` is the *only* deployment-specific file.
- **Oat UI** — a forked WebComponents-based design system (no React/Vue/Svelte).
- **TypeScript** throughout; `@astrojs/check` for type checking.
- **Cloudflare KV** for runtime config; **wrangler** for types/local state.
- **marked** + **dompurify** render/sanitize markdown; **html2canvas** for tools.

**Where key modules live**
- `src/config/*.ts` — config interfaces + default data (git source of truth & KV fallback).
- `src/lib/config.ts` — KV-aware accessors (`getSite`, `getProjects`, …). The only sanctioned way to read config.
- `src/pages/` — routes; `src/pages/admin.astro` (config editor) and `src/pages/api/admin/save.ts` (save allowlist).
- `src/layouts/` — page shells; `src/components/` (`home/`, `tools/`, `games/`) — UI pieces.
- `src/styles/theme.css` — design tokens (single source of truth for palette/fonts/scale/spacing).
- `astro.config.mjs` — adapter choice **and** the Vite middleware that persists `/admin` saves.

## Build / Test / Run

```sh
npm run dev            # astro dev server (local /admin is open, no IP gate)
npm run build          # astro build — must stay green before any commit
npm run preview        # serve the production build locally
npm run generate-types # wrangler types (regen Cloudflare/KV bindings)
npm run graph          # graphify update . — refresh the local code-graph
```

There is no unit-test suite; **`npm run build` is the green-bar gate**. For
UI/route changes, also run `/browser-debug` against the dev server.

## Configuration

**Never read config directly from `src/config/` in pages or layouts.** Always use the accessors in `src/lib/config.ts`:

```ts
import { getSite, getProjects, getExperience, getPosts, getGames } from '../lib/config'
const site = await getSite(Astro.locals)
```

The `src/config/*.ts` files serve two purposes:
1. **Fallback** — used when KV has no value for a key (first deploy, local dev without KV)
2. **Source of truth for git** — edit these to update the bundled defaults

## Caching & Performance

The site runs on the `@astrojs/node` origin behind Cloudflare. Pages are SSR, so
Cloudflare does **not** edge-cache HTML by default — every request used to hit the
(slow, distant) origin, with multi-second TTFB. Two layers fix this; **neither
touches the build or deploy pipeline**:

1. **Cloudflare Cache Rule** (dashboard, one-time): marks HTML *eligible for
   cache* for everything **except** `/api/*`, `/admin`, and requests carrying the
   `__admin_session` cookie. Edge TTL is "Override origin" (1 h); switch it to
   "Respect origin TTL" to let the headers below drive freshness end-to-end.
2. **`Cache-Control` headers** (`src/middleware.ts`): public `GET` 200 responses
   get `public, s-maxage=600, stale-while-revalidate=86400`; `/admin`, the admin
   API, and any logged-in-admin response get `no-store`. This keeps the cache
   policy in git and guarantees personalized/admin responses are never edge-cached
   even if the dashboard rule changes.

**Gotcha:** after editing content in `/admin`, public pages keep serving the
cached copy until the TTL expires. To see changes immediately, purge via
Cloudflare → Caching → Configuration → Purge Everything. Verify caching with
`curl -sSI https://apanjwani0.com/ | grep cf-cache-status` (want `HIT`).

## Key Conventions

- **Oat UI semantics**: Oat styles standard HTML tags and attributes automatically — avoid adding custom CSS classes where a semantic HTML element or attribute achieves the same result. Fixes to Oat behavior go in the fork, not in portfolio-level CSS overrides.
- **SSR everywhere**: Pages use `export const prerender = false` — required for KV reads to work at request time. The lone exception is `src/pages/tools/index.astro` (`prerender = true`), which reads only the static `tools` config, so it ships as a static file (and is served by the static handler, bypassing `src/middleware.ts` at runtime).
- **Config via `src/lib/config.ts`**: All personal data goes through the KV-aware accessors, never imported directly from `src/config/`.
- **No JS framework**: Oat uses WebComponents for dynamic behavior. Avoid adding React/Vue/Svelte unless absolutely necessary.
- **Client mounting + View Transitions**: `<ClientRouter />` is enabled, so bundled `<script>` tags run only once per session and do NOT re-run on in-site (client-side) navigation. Any script that mounts a WebComponent/canvas (tool controllers, the home star canvas) must do its work inside `document.addEventListener('astro:page-load', …)`, or the component renders blank when the page is reached via nav (only a hard reload fixes it). Always test such pages by clicking an in-site link, not by reloading.
- **Adapter is the only deployment-specific code**: `astro.config.mjs` is the single swap point for infrastructure changes. No adapter-specific APIs anywhere else — abstract behind `src/lib/` if needed.

## Design System

**All visual design is driven by CSS custom-property tokens in `src/styles/theme.css` — the single source of truth.** To re-theme the site (palette, fonts, type scale, spacing), edit those tokens only; page and component CSS should not need to change.

- **Never hardcode** a colour, font, or type size in `global.css`, `home.css`, `shared.css`, component CSS, or scoped `<style>` blocks — reference a token: `var(--color-*)`, `var(--font-*)`, `var(--text-*)`, `var(--space-*)`.
- **Load order**: `theme.css` (tokens) → `shared.css` (base elements + header, shared by both layouts) → `global.css` (content pages) / `home.css` (home hero) / component CSS.
- **Theming**: `theme.css` defines light at `:root` and overrides the palette under `[data-theme="dark"]` (the site runs dark). Add a theme by adding another `[data-theme="…"]` block — palette tokens only.

## Skills & Commands

### `/browser-debug [url] [what to check]`
Spins up a subagent that fetches the dev server, validates all nav routes, checks HTML structure and Oat asset linking, and reports pass/fail per check. Use after any layout, component, or page change.

### `/antigravity <task>`
Delegates small, well-scoped tasks to a faster subagent (boilerplate, config entries, isolated edits, repetitive content, routine CSS tweaks). Keep architecture decisions, multi-file changes, debugging, and anything touching `astro.config.mjs` in Claude.

### `/frontent-design`
Generates production-grade UI. For this project, the Portfolio Override applies: no custom classes, no custom fonts, no animations, no Tailwind — use semantic HTML + Oat `data-*` attributes. Fix Oat gaps in the fork, not with portfolio-level CSS.

### `/update-project-memory`
Saves new learnings about the project or its frameworks to persistent memory files in `.claude/projects/`. Use after discovering non-obvious constraints, bugs, or architectural decisions.

## Admin Config Management

Every content section displayed on the portfolio must be manageable via the `/admin` page in dev. When adding a new section:

1. Add a config file in `src/config/{section}.ts` with the interface and default data
2. Add a `get{Section}()` accessor in `src/lib/config.ts`
3. Add a `generate{Section}()` function and `case '{section}'` in `astro.config.mjs` (Vite middleware)
4. Add `'{section}'` to the `allowed` array in `src/pages/api/admin/save.ts`
5. Add a tab + form + JS save handler in `src/pages/admin.astro`

Current config keys: `site`, `projects`, `experience`, `blogs`, `games`

## Code graph (graphify)

`graphify-out/` holds a generated code-graph used **only as an AI navigation aid** — the
`.claude/` PreToolUse hooks nudge the agent to run `graphify query "<question>"` before grepping
or reading source. It is not part of the build, runtime, or CI; the site builds and deploys fine
without it.

- **Regenerate** after meaningful code changes with `npm run graph` (alias for `graphify update .`).
  It's incremental and local (zero API cost). You do **not** need to run it after every edit —
  only when you want the graph to reflect new structure so the agent stays oriented. If it goes
  stale, compare `git rev-parse HEAD` to the commit listed in `GRAPH_REPORT.md`.
- **Requires** the `graphify` CLI installed locally (e.g. via `uv`); it is not an npm dependency.
- **Git policy:** only `graphify-out/GRAPH_REPORT.md` (the human-readable summary) is committed.
  Everything else — `graph.json`, `graph.html`, `cache/`, `manifest.json`, the `.graphify_*` state
  files, and dated run snapshots — is local-only and `.gitignore`d. Keep `.gitignore` comments on
  their own lines: git does not support end-of-line comments.
- **Scope:** `.graphifyignore` keeps the graph focused on `src/` by excluding deps, build
  output, generated artifacts, and media.

## Standing Rules

These apply to every change, on top of the conventions above:

1. **Graph before commit.** The local code-graph should reflect the code being
   committed. A best-effort `.git/hooks/pre-commit` runs `graphify update .`
   (skips silently if graphify isn't installed, never blocks a commit) and
   re-stages `GRAPH_REPORT.md` if it changed. If you bypass hooks, run
   `npm run graph` yourself before committing structural changes.
2. **Keep docs in sync.** When you change architecture, config keys, commands,
   or conventions, update this AGENTS.md in the same change. Adding an admin
   section means updating the 5-step checklist *and* the "Current config keys"
   line. Stale docs are treated as bugs.
3. **Prune dead code.** Don't leave commented-out blocks, unused exports,
   orphaned config keys, or superseded CSS overrides behind. Delete what a
   change makes obsolete rather than letting it accumulate.
4. **`npm run build` stays green.** Never commit a change that breaks the build.
