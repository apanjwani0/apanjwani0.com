# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Configuration

**Never read config directly from `src/config/` in pages or layouts.** Always use the accessors in `src/lib/config.ts`:

```ts
import { getSite, getProjects, getExperience, getPosts, getGames } from '../lib/config'
const site = await getSite(Astro.locals)
```

The `src/config/*.ts` files serve two purposes:
1. **Fallback** — used when KV has no value for a key (first deploy, local dev without KV)
2. **Source of truth for git** — edit these to update the bundled defaults

## Key Conventions

- **Oat UI semantics**: Oat styles standard HTML tags and attributes automatically — avoid adding custom CSS classes where a semantic HTML element or attribute achieves the same result. Fixes to Oat behavior go in the fork, not in portfolio-level CSS overrides.
- **SSR everywhere**: All pages use `export const prerender = false` — required for KV reads to work at request time.
- **Config via `src/lib/config.ts`**: All personal data goes through the KV-aware accessors, never imported directly from `src/config/`.
- **No JS framework**: Oat uses WebComponents for dynamic behavior. Avoid adding React/Vue/Svelte unless absolutely necessary.
- **Adapter is the only deployment-specific code**: `astro.config.mjs` is the single swap point for infrastructure changes. No adapter-specific APIs anywhere else — abstract behind `src/lib/` if needed.

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
