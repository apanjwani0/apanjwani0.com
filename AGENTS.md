# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal portfolio site — an SSR Astro app that renders a home hero, plus
projects / experience / blogs / games / tools sections. All personal content is
**runtime-editable** through a dev-only `/admin` page that writes to Cloudflare
KV; the bundled `src/config/*.ts` files are the git-tracked fallbacks.

**Stack**
- **Astro 7**, fully SSR (`export const prerender = false` on every page).
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
npm run og             # regenerate the social share cards (see Share cards)
npm run security:smoke # assert the security invariants (see Security)
npm run analytics:smoke
npm run origin:check   # assert the DEPLOYED edge posture against production
```

There is no unit-test suite; **`npm run build` is the green-bar gate**. For
UI/route changes, also run `/browser-debug` against the dev server.
The production GitHub deploy builds a Docker image on `main`, restarts the OCI
container from the self-hosted runner, then fetches `/` inside the container
before reporting success.

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
   get `public, max-age=0, s-maxage=600, stale-while-revalidate=86400`; `/admin`,
   the admin API, and any logged-in-admin response get `no-store`. This keeps the
   cache policy in git and guarantees personalized/admin responses are never
   edge-cached even if the dashboard rule changes.

   `max-age=0` is deliberate: it caches at the edge but not in the visitor's
   browser. Browser-cached HTML cannot be purged, so without it an edit stays
   invisible to anyone who already loaded the page until their own cache expires.
   Cloudflare's **Browser Cache TTL** setting can re-add a `max-age` on top of
   this — keep it on "Respect Existing Headers" or it silently overrides the line
   above.

3. **Non-API 404s are edge-cached** (`public, max-age=0, s-maxage=300`).
   Vulnerability scanners generate most of this site's origin traffic and every
   one of them requests a path that does not exist; an uncached 404 wakes the
   origin each time. Short TTL so a genuinely new route still appears quickly.

   The branch order in `src/middleware.ts` matters and is asserted by
   `security:smoke`: admin surfaces first, then any response that set its own
   `Cache-Control`, then **`/api/*` → `no-store` ahead of the 404 rule**. An API
   404 is usually a resource that can exist a moment later (a bin not created
   yet, a freshly minted id), so edge-caching it for five minutes serves the miss
   back to everyone in the colo — including the owner who just created it. Do not
   reorder those two to reclaim the scanner-absorption win on `/api/` probes;
   that would make the guarantee depend on every future route remembering to set
   its own header.

**Gotcha:** after editing content in `/admin`, public pages keep serving the
cached copy until the TTL expires. To see changes immediately, purge via
Cloudflare → Caching → Configuration → Purge Everything. Verify caching with
`curl -sSI https://apanjwani0.com/ | grep cf-cache-status` (want `HIT`).

## Analytics

Two independent layers, both aggregate-only:

1. **Client beacon** (`src/lib/analytics-client.ts` → `/api/analytics/event`) —
   tool and game detail pages only. Carries the real-user perf metrics (LCP, CLS,
   TTFB). Rate-limited to 60/min per client; blocked by content blockers.
2. **Server counter** (`src/lib/visits.ts`, called from `src/middleware.ts`) —
   every successful HTML render that reaches the origin, so it covers the whole
   site and cannot be blocked by the client. One caveat the numbers must be read
   with: the edge cache sits in front, and a Cloudflare HIT never wakes the
   origin, so these are **origin renders (cache misses), not raw page views** —
   per-path shape, not absolute traffic (Cloudflare's dashboard has the totals).
   Records date, path, country (`cf-ipcountry`), referrer **host**, and a
   separate bot count. Buffered in memory and flushed to `data/visits.json` every
   30s — never write per request, that turns any visitor into a disk-I/O amplifier.

Storage for layer 1: `SITE_ANALYTICS` when present, else `analytics:*` keys in
`SITE_CONFIG`, else `data/analytics.json` on Node. Both layers retain 90 days.

**Both layers store counts only — never IPs, user ids, user agents, session
traces, or full referrer URLs** (query strings leak search terms and tokens). An
IP is personal data under GDPR the moment it is retained; aggregates are not, so
the site needs no consent banner. Keep it that way: if a feature seems to need
per-visitor identity, it needs a different design. Cloudflare's dashboard already
covers unique visitors and per-country totals — do not rebuild those here.

Reading the data in production (there is no admin UI — see Security):

```sh
ssh <host> 'cat /opt/portfolio/data/visits.json' | python3 -m json.tool | head -50
```

Cloudflare Web Analytics auto-injection should stay disabled in the Cloudflare
dashboard; do not weaken the CSP just to allow the blocked Cloudflare beacon.

## Share cards (Open Graph)

Every `live` tool and every **playable** game (see Indexing below) has a generated
1200×630 card in `public/og/`, named `<tools|games>-<slug>.png`. `src/lib/og.ts`
derives the path from kind+slug — there is deliberately **no `image` config
field**, because the generator writes those exact names from the same config and
a second source of truth could only ever disagree. Card eligibility is exactly
"the page is publicly indexable": a card promises a real product behind the link,
so a `noindex` page must never carry one. Pages without a card (home, sections,
wip tools, coming-soon games) fall back to the portrait avatar and the small
`summary` Twitter card; a card gets `summary_large_image`, since a portrait shown
large is cropped to a letterboxed mess.

**Regenerate with `npm run og` after adding a tool/game or changing a title or
description, and commit the PNGs.** Forgetting means that page falls back to the
avatar — degraded, not broken.

The generator (`scripts/generate-og.mjs`) rasterises HTML with headless Chrome.
That is a deliberate choice over an on-demand render route: satori + resvg would
add two dependencies with native binaries (an Alpine/musl risk in the Docker
image) and burn CPU and memory per request on a 1 GB box. Committed PNGs are
ordinary static assets — zero runtime cost, edge-cached like any image. Chrome is
never needed in CI or production.

Product pages do **not** put the site owner's name in `<title>`: `seoTitle` is used
verbatim by both shells, because a trailing `· Name` only consumes the pixels
Google allows before truncating and pushes the real keywords out. Section pages
(`/projects`, `/blogs`) keep the suffix — there the name is what identifies them.
Authorship still lives in the JSON-LD `author` and the footer.

## Security

**These are load-bearing invariants, not preferences. Every change must hold
them, and a change that cannot is a design that needs rethinking.**

### The admin surface does not exist in production

`isAdminRequestAllowed()` returns `import.meta.env.DEV` and nothing else. In
production `/admin`, `/api/admin/login`, `/logout`, `/save` and `/analytics` all
return 404. Config is edited in dev — the Vite `admin-save` middleware writes
`src/config/*.ts` — and ships through git.

This replaced an `ADMIN_IP_WHITELIST` env allowlist, which **did not work**: it
compared against a client IP read from a request header, and every such header
(`x-forwarded-for`, `cf-connecting-ip`) is chosen by the caller for anyone who
reaches the origin directly. It was authenticating a value the attacker supplied.
Do not reintroduce it. `ADMIN_SECRET` is dev-only and is deliberately not passed
to the production container.

### Never authorize on a client-controlled value

`getClientIp()` is explicitly untrusted and is used only to bucket rate limits.
No header, cookie, query param or body field may gate access on its own. If you
need an authorization decision, it must rest on a secret the client cannot forge
or on the surface simply not existing.

### Origin exposure

The origin has a public IP with port 80 open, so **Cloudflare is bypassable** and
`cf-connecting-ip` is only authoritative for traffic that really came through it.
Two mitigations, in order of preference:

1. `scripts/lock-origin-to-cloudflare.sh` — restrict 80/443 to Cloudflare ranges
   (or move to a Cloudflare Tunnel and close the ports entirely). **This is the
   real fix.** UFW alone is not enough; the OCI Security List must match — it is
   enforced upstream of the VM, so it overrides anything UFW says. **Still open.**
2. **Enabled 2026-08-17.** `ORIGIN_SHARED_SECRET` + a Cloudflare Transform Rule
   injecting `x-origin-auth` — the middleware 404s anything without it. A direct
   hit on the origin IP now returns 404 `no-store`; the box still answers, so (1)
   is still worth doing.

**Enabling it is order-dependent and the order is not obvious.** An *empty*
secret disables the check, which is what makes the mechanism opt-in — but a
non-empty secret with no matching Transform Rule 404s **every** request, because
real traffic arrives without the header. So: create the Transform Rule first,
set the secret second. If it ever breaks, fix the **rule value** — that applies
on the next request, whereas changing the secret costs a redeploy.

A green deploy proves nothing here: the health probe reaches the app over
`docker exec` and supplies the header from the container's own env
(`deploy.yml`), so it passes whether or not Cloudflare's value matches. Only a
request from outside proves the lock — which is what `npm run origin:check` is.

### Verifying what is not in git

`security:smoke` asserts the code half of the security invariants. The other half
lives in the Cloudflare dashboard — the Transform Rule above, the Cache Rule, and
Browser Cache TTL — where nothing in this repo can see it, and where a stray
click reverts it silently.

`npm run origin:check` (`scripts/origin-check.sh`) closes that gap: it makes
plain unauthenticated HTTP requests to production and asserts what a stranger
sees — site 200 through Cloudflare, origin IP not serving the app, `max-age=0`
(Browser Cache TTL not overriding), `s-maxage` present, response actually
proxied. Exits non-zero on regression, and prints the current Cloudflare CIDR
list while mitigation (1) is outstanding. Run it after any Cloudflare change.

### Rate limits must be bounded

Use `createRateLimiter()` from `src/lib/security.ts` for any public endpoint. Do
not hand-roll a `Map` keyed by client IP: the keys come from a request header, so
an unbounded map is a memory-exhaustion vector rather than a defence. The host is
a 1 GB VM; the container is capped (`--memory=768m`) so a leak restarts the
container instead of taking down SSH and the CI runner with it.

### Public endpoints must be bounded in every dimension

Body size, per-key count, global bytes, retention, *and* how long a request may
occupy a socket. The Webhook Inspector is the reference: `WEBHOOK_MAX_*` in
`src/lib/webhook-store.ts` plus the 2s `?delay=` ceiling. Budget for byte
accounting being optimistic — `.length` counts UTF-16 code units, not bytes, and
object overhead is real.

### Escaping

- Anything interpolated into HTML gets escaped including `'` — attribute quoting
  is a property of the call site and will eventually change.
- Anything interpolated into a `<script>` body (JSON-LD) goes through
  `serialize()` in `src/lib/jsonld.ts`, which escapes `<` so a value containing
  `</script>` cannot break out.
- Markdown goes through `src/lib/markdown.ts` only: raw HTML is escaped and URLs
  pass `safeMarkdownUrl()`. Never hand `marked` output to `set:html` directly.

### Unguessable ids are a security control

Where knowing an id is the only thing protecting data (webhook bins), the id must
be long enough to resist enumeration — 24 chars minimum, and validation enforces
it server-side, not just in the UI that mints them.

### Before merging anything that touches a trust boundary

```sh
npm run security:smoke   # asserts these invariants
npm run build            # must stay green
```

Add an assertion for each new invariant, in whichever of the two homes fits: a
**code** invariant (a guard, an escape, a bound) goes in
`scripts/security-smoke.mjs`; a **deployed-posture** invariant (a Cloudflare
rule, a header the edge rewrites, whether the origin answers) goes in
`scripts/origin-check.sh`, because nothing in this repo can see it. If a fix has
no assertion, it will be undone by a later refactor that looks harmless.

## Key Conventions

- **Oat UI semantics**: Oat styles standard HTML tags and attributes automatically — avoid adding custom CSS classes where a semantic HTML element or attribute achieves the same result. Fixes to Oat behavior go in the fork, not in portfolio-level CSS overrides.
- **SSR everywhere**: Pages use `export const prerender = false` — required for KV reads to work at request time and for runtime middleware headers to apply. `src/pages/tools/index.astro` also uses the runtime `getTools()` accessor now; do not reintroduce a prerendered/static tools hub unless equivalent security/cache headers are configured at the hosting layer.
- **Config via `src/lib/config.ts`**: All personal data goes through the KV-aware accessors, never imported directly from `src/config/`.
- **SEO support copy**: Tool and game detail pages may render `seoContent` markdown from config under the interactive app for how-to, FAQ, privacy, and strategy copy. Keep the app first; this block is for search context and users who scroll.
- **Decorative StarField**: Keep the home/background star canvas off tool and game detail pages. Lighthouse showed it spending CPU before the game became useful; detail pages should prioritize the interactive app.
- **Fonts on tools/games**: Tool and game detail pages pass `loadFonts={false}` to `Head`. This avoids mobile CLS and a render-blocking third-party font request on utility pages; fallback system fonts are acceptable there.
- **ClientRouter on tools/games**: Direct tool and game detail pages pass `clientRouter={false}` to `Head` to avoid loading Astro's client navigation bundle on utility-first landing pages. Keep normal navigation working through full-page loads there.
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
4. Add `'{section}'` to `CONFIG_TYPES` in `src/lib/config-schema.ts` — the `isConfigType()` gate `src/pages/api/admin/save.ts` validates against
5. Add a tab + form + JS save handler in `src/pages/admin.astro`
6. For a new tool or game, run `npm run og` and commit the card (see Share cards)
7. For a new **game**, register its custom-element tag in `GAME_TAGS`
   (`src/lib/games.ts`) and add its import to `mountGame()` + its CSS import in
   `src/pages/games/[slug].astro`. Config alone is not enough — see Indexing.

Current config keys: `site`, `projects`, `experience`, `blogs`, `games`, `tools`

### Indexing: one predicate decides whether a page is real

A page that search engines are told to `noindex` must not appear in the sitemap,
must not be in a hub's `ItemList`, and must not carry a share card — three
signals that contradict each other are worse than any one of them being absent,
because a crawler resolves the conflict by trusting none.

So each kind has exactly **one** predicate, and every consumer reads it:

- **Games** — `isPlayableGame()` in `src/lib/games.ts`: `enabled && interactive
  && GAME_TAGS[slug]`. The third condition is the one config cannot know; without
  it a game flagged `interactive` but never wired to a component was listed in
  the sitemap while its own page served `noindex`.
- **Tools** — `status === 'live'`. `wip` renders publicly but is not indexable,
  so it is noindex, out of the sitemap, and cardless. `external` and `disabled`
  404 outright.

`GAME_TAGS` lives in `src/lib/games.ts` and **not** in `src/config/games.ts`
because the `/admin` Vite middleware regenerates that config file wholesale from
`generateGames()` — an export added there is deleted on the next admin save.

Detail pages also cross-link their siblings via `src/components/RelatedLinks.astro`.
Without it each product page is a crawl leaf reachable only through its hub, so
crawl attention and internal link equity never reach the pages that rank. Feed it
only indexable items, for the reason above.

Note the admin page is **dev-only** — see Security. Config edited in dev is
written to `src/config/*.ts` and must be committed to reach production; there is
no runtime editing on the server.

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
   section means updating the 7-step checklist *and* the "Current config keys"
   line. Stale docs are treated as bugs.
3. **Prune dead code.** Don't leave commented-out blocks, unused exports,
   orphaned config keys, or superseded CSS overrides behind. Delete what a
   change makes obsolete rather than letting it accumulate.
4. **`npm run build` stays green.** Never commit a change that breaks the build.
5. **Security invariants hold.** Read the Security section before touching a
   route, a header, config validation, or anything that renders untrusted input.
   Run `npm run security:smoke` alongside the build, and add an assertion there
   for any new invariant. Treat a trust-boundary change without a test as
   incomplete — the reason a control exists is rarely obvious to the next reader,
   and an unasserted one gets refactored away.
6. **No new secrets on the production host.** If a value is only needed in dev,
   it must not be in the container env. Deploy only what production actually reads.

## The bar for a new tool or game

Owner feedback, 2026-08-12: the existing set reads beginner-level. The code isn't
the problem — the *category* is. Every tool shipped so far (Chroma Lab, Regex Lab,
Hash Smith, JSON Tidy, Codec Forge, Epoch Wizard, List Forge, Wallpaper Forge) is a
box that transforms text in the browser, and every game (2048, Game of Life,
Starfield, Murmuration, L-system, Maze Weaver, Quintle) is a single-player
reimplementation of something famous, with no state that outlives the tab. Each is a
tutorial-weekend project, so ten of them still read as a tutorial shelf.

**The rule: a tool must do something a static HTML page cannot.** This site is
`output: 'server'` on a standalone Node adapter in Docker, with API routes under
`src/pages/api/` — it already pays for a server that not one tool uses. That gap is
the whole quality problem, and it is also the fix.

A candidate must clear at least two of these:

- **It owns a URL other software talks to** — the reference standard is
  webhook.cool: you get an endpoint, it captures real requests, you watch them
  arrive. Trivial UI, genuinely useful, impossible without a server.
- **State outlives the tab** — a permalink someone can send to a colleague, a
  saved run, a daily seed everyone gets the same.
- **It's correct about something people get wrong** — DST-aware cron previews,
  JWT *signature verification* against a pasted JWK (decoding one is the beginner
  version), spec-conformant `.ics`/vCard emission.
- **It fits a real debugging loop** — HTTP echo with injectable status/latency for
  testing client retries, an SSE/WebSocket echo target for streaming clients.

**Do not ship** another formatter, converter, encoder, color picker, regex tester,
or canvas screensaver. That shelf is full and it is what prompted this section.

**Games:** the beginner tell is single-player + no persistence + a famous clone.
Next level is a shared daily seed, a server-side leaderboard, or a replay permalink.
One game with a daily seed beats five clones — and prefer *deepening one* of the
existing games over adding a fourteenth.

Ship fewer, larger things. One tool that a stranger would bookmark is worth more
than the whole current list.
