# Architecture

How the site is built and how its content is wired. The binding rules are in
[AGENTS.md](../AGENTS.md); this is the longer map.

## Project Overview

Personal portfolio: an SSR Astro app with a home hero plus projects /
experience / blogs / learnings / games / tools sections.

**Stack**
- **Astro 7**, fully SSR (`export const prerender = false` on every page).
- **Adapter**: `@astrojs/node` in Docker on an OCI VM behind Cloudflare;
  `@astrojs/cloudflare` is the swap-in. `astro.config.mjs` is the only
  deployment-specific file.
- **Oat, the base layer**: a forked WebComponents library, vendored as
  `public/oat.min.{css,js}`. It supplies element defaults (buttons, inputs,
  tables, details), `title` tooltips and a few behaviours (tabs, dropdown,
  toast, dialog). The look on top is the site's own design system (see
  *Design System*). To update Oat, run `make` in the fork
  (github.com/apanjwani0/oat) and copy `dist/oat.min.*` into `public/`. Keep
  it out of Vite: its CSS minifier merges Oat's `@layer` blocks and restyles
  buttons. No React/Vue/Svelte.
- **Lightweight**: no JS framework, no CSS framework or runtime component
  library. A component Oat lacks is built here, small and dependency-free, on
  the tokens. Every dependency earns its place, and the heavy ones (cytoscape,
  html2canvas, gifenc, marked) load per route, so a page pays only for what it
  uses.
- **TypeScript** throughout; `@astrojs/check` for type checking.
- **marked** + **dompurify** for markdown; **html2canvas** for tools;
  **gifenc** for GIF export; **cytoscape** for the Flowmap and Draftboard graphs.

**Content**: `src/config/*.ts` holds the interfaces and default data. The
accessors in `src/lib/config.ts` read a KV override (Workers) or
`data/{key}.json` (Node) when present, else those defaults. `/admin` is
dev-only and writes `src/config/*.ts`, which ships through git; the site's
personal data is the exception: `src/config/site.json`, reviewable as plain
JSON, with the `Site` type declared in `src/config/site.ts`.

**Where key modules live**
- `src/lib/config.ts` — the only sanctioned way to read config.
- `src/pages/` — routes; `admin.astro` (config editor) and `api/admin/save.ts`
  (save allowlist).
- `src/layouts/` — `Base.astro` and `ToolBase.astro`; `src/components/`
  (`home/`, `tools/`, `games/`). `src/components/home/hero/` holds the home
  hero.
- `src/middleware.ts` — security headers, the CSP nonce, `Cache-Control`, the
  visit counter and the origin lock.
- `src/lib/caa.ts` — the CAA vocabulary shared by DNS Sightline and Chainsaw.
- `src/lib/sky.ts` — the drifting stars the home hero and the hubs share;
  `src/lib/sky-ui.ts` mounts them behind the hubs.
- `src/lib/cron-presets.ts` — Cron Whisperer's preset pages
  (`/tools/cron-whisperer/<slug>`): the slug/expression list, their one
  predicate and the engine-derived copy.
- `src/lib/site-index.ts` — the site's real pages, derived once for the
  sitemap, `/llms.txt`, the command palette and the 404.
- `src/lib/theme.ts`, `src/lib/site-ui.ts`, `src/lib/kit.ts`,
  `src/lib/fuzzy.ts` — see *UI refresh*.
- Client helpers shared by every tool and game (see *Key Conventions*):
  `escape.ts`, `storage.ts`, `flash.ts` (`copyText`), `download.ts`,
  `format.ts`, `math.ts`, `motion.ts`, `date.ts`.
- `src/lib/breadcrumbs.ts`, `src/components/JsonLd.astro`,
  `src/components/Card.astro` — the page-level building blocks (see
  *Key Conventions*).
- `src/styles/theme.css` — design tokens, the single source of truth.
- `astro.config.mjs` — the adapter and the Vite middleware that persists
  `/admin` saves.

## Admin Config Management

Every content section is manageable through `/admin` in dev. To add one:

1. `src/config/{section}.ts`: the interface and default data.
2. A `get{Section}()` accessor in `src/lib/config.ts`.
3. A `generate{Section}()` function and `case '{section}'` in the
   `astro.config.mjs` Vite middleware. It must mirror the interface, or saves
   silently drop fields. `site` is the exception: its generator writes
   `src/config/site.json` (plain JSON), and a new `Site` field also goes in the
   `Site` interface (`src/config/site.ts`) and `validSite`.
4. `'{section}'` in `CONFIG_TYPES` (`src/lib/config-schema.ts`), the gate
   `src/pages/api/admin/save.ts` validates against.
5. A tab, form and save handler in `src/pages/admin.astro`.
6. For a new tool or game, run `npm run og` and commit the card.
7. For a new **game**: its tag in `EMBED_TAGS` (`src/lib/embeds.ts`), its slug
   in `GAME_SLUGS` (`src/lib/games.ts`; `GAME_TAGS` is derived), its import in
   `mountGame()` (`src/lib/game-mount.ts`) and its stylesheet in
   `src/styles/games-embed.css`.

Current config keys: `site`, `projects`, `experience`, `blogs`, `learnings`,
`games`, `tools`

The site tab's submit handler in `src/pages/admin.astro` rebuilds the payload field by field from the form, so a new `site.*` field also needs an input in the site tab and a line in that object, or it vanishes on the next site save.

### Hiding a section: `sections.blogs`, `sections.projects`

Blogs and Projects ship hidden (Projects since 2026-09-30, the owner's call).
`isBlogsPublic()` and `isProjectsPublic()` (`src/lib/config.ts`) read
`site.sections.<name>`, and `GATED_SECTIONS` there maps each path to its
predicate. The nav and footer (`navLinks`), the sitemap, the site index (the
palette and `/llms.txt`, project cards included), the hub's `ItemList` and the
`noindex` on the routes all read it. Hidden, not deleted: the routes still
answer 200 when typed. Flip the flag to restore the section; make the routes 404
to retire it.

- **Gate a signal, never delete it**, and assert a reversible switch in both
  states. `security:smoke` derives from `navLinks()` that every hub the nav
  advertises has a sitemap entry for that flag state.
- Keep `Site['sections']` as `Record<string, boolean>`: an `as const` literal
  type makes the flag unchangeable in the checker's eyes.
- Check what a fixture depends on before removing its data. The sitemap
  escaping assertion turns blogs on explicitly for that reason.

### Indexing: one predicate decides whether a page is real

A `noindex` page must not be in the sitemap or a hub's `ItemList`, and must not
carry a share card: a crawler that sees contradicting signals trusts none. Each
kind has one predicate, and every consumer reads it:

- **Games**: `isPlayableGame()` (`src/lib/games.ts`), which is
  `enabled && interactive && GAME_TAGS[slug]`.
- **Tools**: `status === 'live'`. `wip` renders publicly but is noindex, out of
  the sitemap and cardless; `external` and `disabled` 404.
- **Learnings**: `isPublishedLearning()` (`src/lib/learnings.ts`), which is
  `published && content.trim()` under a slug not in `RETIRED_LEARNINGS`. An
  article withdrawn after it reached `main` keeps its URL as a 301 (to the hub
  unless a replacement answers the same question): add its slug there. The
  smoke test refuses a slug that is both retired and in config.
- **Driftfield**: `isDriftfieldPublic()` (`src/lib/driftfield.ts`), true when the
  `driftfield` tools entry is `live`. The hub, every mode route, the sitemap and
  `scripts/generate-og.mjs` read it; it is stricter than `/tools/[slug]`.
- **Cron Whisperer presets**: `isCronWhispererPublic()` (`src/lib/cron-presets.ts`),
  true when the `cron-whisperer` tools entry is `live`. The route, the sitemap
  and the site index read it; a preset has no share card. Its sentences are
  derived from `cwDescribe` and `cwIsFixedTime`, never written per preset
  (hand-written copy is the filler this site declines). The tool reads
  `data-preset-expr` after a share link and before the saved expression, and
  never saves it over one.

The sitemap (`indexablePaths`) and `/llms.txt` (`buildSiteIndex`) derive from
`src/lib/site-index.ts`, asserted to agree; the planned palette and smart 404
will read it too. A project entry is the one hand-written on-site URL: any `apanjwani0.com` link in
`src/config/projects.ts` must match a shape in `projectPathShapes` and pass that
kind's predicate.

`EMBED_TAGS` (every mountable component) and `GAME_TAGS` (the subset with a
`/games/<slug>` page, derived from `GAME_SLUGS`) live in `src/lib/`, not in
`src/config/games.ts`, which `/admin` regenerates wholesale. They are not the
same list: Driftfield engines and article-only figures are embeds, not games.
Asserted: the subset relation, no Driftfield mode is a game, and every
`EMBED_TAGS` entry reaches a `mountGame()` branch and a stylesheet in
`games-embed.css`.

A cross-link is derived, never stored twice: `learningsAboutEmbed()` finds the
article about an embed from the article's own `embed`. `RelatedLinks.astro`
links the article about a tool or game, Driftfield's sibling modes and Cron
Whisperer's presets (no product-to-product rows); feed it
indexable items only. It derives
its heading `id` from the heading text, since a page can render it twice.

## Code graph (graphify)

`graphify-out/` is a generated code graph, used only as an AI navigation aid:
the `.claude/` hooks nudge `graphify query` before grepping. It is not part of
the build. Regenerate with `npm run graph` (incremental, local) when you want it
current; it needs the `graphify` CLI. Only `graphify-out/GRAPH_REPORT.md` is
committed; the rest is gitignored. Keep `.gitignore` comments on their own lines.
`.graphifyignore` scopes the graph to `src/`.

## Coming-soon pages have a working ask

An enabled-but-unplayable game shows a "want this sooner" counter
(`src/lib/interest.ts`, `src/pages/api/games/interest.ts`), not a form. The
route validates the slug against the coming-soon games in config, so a request
body can't create a store key. Counts only; the one-vote-per-browser
localStorage flag is UX, not a control.

## Adding a tool

A tool page is server-rendered with an empty custom element; the browser then imports the tool's module and the element comes alive. A new tool touches:

1. `src/config/tools.ts`: an entry with `status: 'live'`, then the rest of *Admin Config Management* (run `npm run og`).
2. `src/components/tools/<slug>/<Name>.ts`: a custom element named `<slug>-tool`, registered inside `if (!customElements.get(…))` and rendered in `connectedCallback`. Its stylesheet is `tools/<slug>/<slug>.css`, linked on that tool's page only (see *Key Conventions*).
3. `src/pages/tools/[slug].astro`: the slug joins `TOOL_SLUGS` and a branch of `mountTool()` that `import()`s the module. `mountTool()` runs on `astro:page-load`, so the tool also mounts on in-site navigation.
4. A tool that needs the origin server also gets `src/pages/api/tools/<slug>.ts`, an entry in `SERVER_TOOLS` (`src/lib/tools.ts`) and assertions in `scripts/security-smoke.mjs`.

A static import (`marked` inside Draftboard) loads with the tool's module; a dynamic one (`html2canvas` inside Draftboard's export function) downloads only when that line runs. Heavy dependencies take the dynamic form. State lives in the DOM and in `localStorage` through `storage.ts`; closing the tab drops the rest. Exports are client-side: a Blob and an object URL (`download.ts`). The file never leaves the browser.
