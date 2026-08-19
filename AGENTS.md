# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal portfolio site — an SSR Astro app that renders a home hero, plus
projects / experience / blogs / learnings / games / tools sections. All personal content is
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
npm run check          # astro check — type/template errors the build does NOT catch
npm run preview        # serve the production build locally
npm run generate-types # wrangler types (regen Cloudflare/KV bindings)
npm run graph          # graphify update . — refresh the local code-graph
npm run og             # regenerate the social share cards (see Share cards)
npm run security:smoke # assert the security invariants (see Security)
npm run analytics:smoke
npm run origin:check   # assert the DEPLOYED edge posture against production
```

There is no unit-test suite; **`npm run build` is the green-bar gate**, but it
is not the whole gate: `astro build` compiles `.astro` files with Astro's own
tolerant parser and **`npm run check` does not**. A `{/* … */}` JSX comment
placed between two attributes of a component tag built green for four commits
while making `src/pages/learnings/[slug].astro` unparseable to `astro check`,
which silently excluded every type error in that file from being reported.
Run both; `check` must stay at 0 errors. For
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

The Type Trial daily leaderboard is the second worked example: `DAILY_*` in
`src/lib/type-trial-leaderboard.ts` bounds name length, entries per day, retained
days and the claimable wpm; the route
(`src/pages/api/games/type-trial/daily.ts`) caps the body and rate-limits reads
and writes separately. It persists to `data/type-trial-daily.json` on the mounted
volume, debounced like `src/lib/visits.ts` — never a write per request. Stored
rows are re-validated on load, so a corrupt or hand-edited file degrades to an
empty board instead of crashing the route.

The Hue Hunt daily board (`HUE_*` in `src/lib/hue-hunt-leaderboard.ts`,
`src/pages/api/games/hue-hunt/daily.ts`) is the same shape again, and the
repetition is the point: bounds, separate read/write limiters, debounced flush to
`data/hue-hunt-daily.json`, rows re-validated on load. It shares Type Trial's
`sanitizeName` rather than growing a second name-hygiene rule — one board's idea
of an acceptable display name must not drift from the other's.

### Validate a client-submitted value against one the server derives

The server must re-derive the thing being scored and check the payload against
*that*, never against numbers the payload also supplied. Type Trial derives the
UTC day and its passage from `src/lib/type-trial-daily.ts` — deliberately shared
with the browser bundle so client and server cannot disagree about what today's
text is — and validates the submitted run against the passage it derived.

**One-sided bounds are the trap.** "wpm may not exceed a perfect run of the
passage in the claimed seconds" reads like a real check and is vacuous: the
ceiling it computes grows without limit as the claimed seconds shrink, so 249 wpm
in 2 seconds passed it and the wpm cap was the only thing actually holding. A run
finishes only when the typed text equals the passage, which makes wpm a
*function* of elapsed time — the gate has to pin the pair to each other, not
bound one of them. Ask it of every new validator: what does an attacker set the
*other* field to?

Hue Hunt answers that question by **removing the other field**. Its submission
carries the day, a name and the five raw guesses and *no score at all*; the route
pins the claimed day to its own `hueDayNumber()`, re-derives the five colours
from `src/lib/hue-hunt-daily.ts` (imported by the browser too, so the two cannot
disagree about today's colours) and computes the total itself. There is no
number in the payload to play off another, which is a stronger position than any
bound on one. Note the honest ceiling, stated in that module's docblock rather
than implied away: anyone who reads `dailyColors()` out of the JS bundle can post
a perfect run. Capping the score would not help — a cheat just posts a lower one
— and closing it properly needs a server-issued round protocol this game does not
warrant.

### A verifier's algorithm must not come from the thing it is verifying

`src/lib/jwt.ts` takes the algorithm as a **parameter** and never reads it from
the token's own header. That is the defence against algorithm confusion: a
verifier that trusts `header.alg` lets whoever crafted the token also choose how
it gets checked — re-sign an RS256 token as HS256 using the RSA *public* key as
the HMAC secret, and such a verifier confirms it. Token Bench defaults the
control to the header value because that is convenient while debugging, and warns
whenever the two disagree.

Webhook Inspector is the second worked example, and it is the same rule wearing
different clothes: the hash is chosen by the header **name** the sender used, not
by any label inside the header's own value — a payload that could name its own
algorithm would be picking how it gets verified. Signature validity and replay
freshness also stay separate answers there, for the reason `exp` is separate from
signature validity below.

Same shape as the Type Trial rule above: **the thing being checked must not
supply the terms of its own check.** Ask it of any new verifier.

Two more properties that are asserted rather than assumed, because both have
been real vulnerabilities in shipped JWT libraries:

- `alg: none` is reported UNSIGNED and never verified, whatever else the token
  carries. A header is attacker-controlled, so it can remove trust, never add it.
- Signature validity and `exp`/`nbf` are **separate answers**. A correctly signed
  token that expired last week is a normal state and is not a forgery; collapsing
  both into one "valid" boolean is how expired-token bugs ship.

The verification core lives in `src/lib/jwt.ts` and not in the component, so
`security:smoke` can run real Web Crypto against the RFC 7515 A.1 vector plus the
tampered-payload, wrong-key and `alg:none` cases.

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
npm run check            # must stay at 0 errors
```

Add an assertion for each new invariant, in whichever of the two homes fits: a
**code** invariant (a guard, an escape, a bound) goes in
`scripts/security-smoke.mjs`; a **deployed-posture** invariant (a Cloudflare
rule, a header the edge rewrites, whether the origin answers) goes in
`scripts/origin-check.sh`, because nothing in this repo can see it. If a fix has
no assertion, it will be undone by a later refactor that looks harmless.

## Key Conventions

- **Every tool renders `div[data-type="tool-page"]`** with a matching
  `data-tool="<dir-name>"`. That one root is where the shared workbench width
  (`--tool-width`), side gutter, keyboard focus ring and `<kbd>` styling come
  from (`src/styles/shared.css` + `tools-common.css`). A tool that invents its
  own root silently opts out of all four and no longer lines up with its
  neighbours — which is what `token-bench` and `trellis` did for weeks, while
  `wallpaper-forge` pinned itself to `--max-width` (768px, the PROSE column) and
  rendered at half the width of every other tool. **A tool styles its internals,
  never its own container width.** `security:smoke` asserts both halves.
- **A tool's claims live in a module, not in the component.** Where a tool
  asserts something checkable about the world, that logic goes in a sibling
  module the component imports — `webhook-inspector/signature.ts`,
  `cron-whisperer/schedule.ts`, and `src/lib/jwt.ts` before both — so
  `security:smoke` can run it against the real thing rather than against a
  screenshot of it. A claim buried in a DOM handler cannot be tested and will
  quietly stop being true.

  Cron Whisperer is the current worked example. **A crontab names a wall clock,
  not an instant**, so twice a year a reading either does not exist or happens
  twice, and the engine resolves each wall-clock tuple to 0, 1 or 2 real instants
  instead of stepping a `Date` forward — the version that stepped a `Date` never
  revisited the repeated hour and silently under-counted every fall-back day.
  Which of those get made up is Vixie's rule from `man 8 cron`: a job counts as
  running "at a particular time" only when **neither** the hour nor the minute
  field contains a `*`, and only those are made up after a forward jump or held
  to one run after a backward one. Asserted against the real tz database, not
  assumed — getting it backwards leaves the tool rendering happily with wrong
  numbers.

  **The second lesson is subtler and cost four bugs at once: the engine walks
  wall readings and returns instants, and across a fall-back those two orders
  disagree.** Every termination decision taken in wall order is therefore wrong,
  and the final `sort` by instant hides the hole rather than showing it. All four
  had the same shape — the walk started at *now's* own reading (so wall 01:00's
  second, still-future instant was never visited), aborted the whole scan when one
  instant crossed the horizon, stopped once it had `count` runs in wall order, and
  the DST panel passed `count: 400` to a query whose only real bound is its
  12-hour window. Ask it of anything that iterates a schedule: *is this loop
  deciding in the same order it returns?*

  The assertions brute-force the answer by stepping real UTC minutes and reading
  the wall clock through `Intl`, which shares nothing with the engine — but that
  oracle is valid **only for non-fixed-time schedules**. A literal wall-clock scan
  cannot express Vixie's rule, so it "proves" a fixed-time job runs twice across a
  repeat. Restricting an oracle to its domain is part of writing it; run outside
  that domain it reports correct code as broken.

  Known and deliberately not changed: `restricted` is `token !== '*'`, so `*/2` in
  the day-of-month field counts as restricted and gets the OR rule. That matches
  `man 5 crontab` ("aren't `*`") but not Vixie's source, which sets its star flag
  on the field's first character and so would AND. Settle it against real cronie
  before changing it — the two readings disagree, and the man page is what the
  tool currently documents.

- **Canvas export is shared**: `src/lib/canvas-export.ts` +
  `src/styles/canvas-export.css`. Any component with a canvas calls
  `attachCanvasExport(host, () => canvas, { name })` and gets PNG at a chosen
  scale, an animated GIF recorded from the live canvas, and — the part that was
  missing everywhere — **a preview of the file before it is written**. Do not
  hand-roll `toDataURL` + `<a download>` again: seven near-identical copies of
  exactly that is what this replaced, and none of them offered a GIF for engines
  whose whole point is that they move. Sizes and the custom-resolution validator
  (`parseCustomSize`, bounded on both edges *and* total pixels) live there too.
- **Oat UI semantics**: Oat styles standard HTML tags and attributes automatically — avoid adding custom CSS classes where a semantic HTML element or attribute achieves the same result. Fixes to Oat behavior go in the fork, not in portfolio-level CSS overrides.
- **SSR everywhere**: Pages use `export const prerender = false` — required for KV reads to work at request time and for runtime middleware headers to apply. `src/pages/tools/index.astro` also uses the runtime `getTools()` accessor now; do not reintroduce a prerendered/static tools hub unless equivalent security/cache headers are configured at the hosting layer.
- **Config via `src/lib/config.ts`**: All personal data goes through the KV-aware accessors, never imported directly from `src/config/`.
- **SEO support copy**: Tool and game detail pages may render `seoContent` markdown from config under the interactive app for how-to, FAQ, privacy, and strategy copy. Keep the app first; this block is for search context and users who scroll.
- **Decorative StarField**: Keep the home/background star canvas off tool and game detail pages. Lighthouse showed it spending CPU before the game became useful; detail pages should prioritize the interactive app.
- **Fonts on tools/games**: Tool and game detail pages pass `loadFonts={false}` to `Head`. This avoids mobile CLS and a render-blocking third-party font request on utility pages; fallback system fonts are acceptable there.
- **ClientRouter on tools/games**: Direct tool and game detail pages pass `clientRouter={false}` to `Head` to avoid loading Astro's client navigation bundle on utility-first landing pages. Keep normal navigation working through full-page loads there.
- **No JS framework**: Oat uses WebComponents for dynamic behavior. Avoid adding React/Vue/Svelte unless absolutely necessary.
- **Heavy deps are lazy-loaded per route**: `cytoscape` (~400KB) is imported
  *inside* `connectedCallback` in `src/components/tools/trellis/Trellis.ts` and
  nowhere else, so no other page pays for it. Any dependency of that size gets
  the same treatment — a static import at module scope would put it in a shared
  chunk and tax every tool page. It earns its place: hand-rolling pan/zoom, force
  layout and edge routing is far more code than the dependency costs.
  `nodeDimensionsIncludeLabels: true` is **required** on every Cytoscape layout —
  it defaults to off, and without it a graph of word-labelled nodes lays out
  using the box and ignores the text, piling up overlapping in one corner.
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
7. For a new **game**, register its custom-element tag in `EMBED_TAGS`
   (`src/lib/embeds.ts`), add its slug to `GAME_SLUGS` (`src/lib/games.ts`;
   `GAME_TAGS` is derived from those two, so there is nothing to edit in it), add
   its import to `mountGame()` (`src/lib/game-mount.ts`) and its stylesheet to
   `src/styles/games-embed.css`. Config alone is not enough — see Indexing.

Current config keys: `site`, `projects`, `experience`, `blogs`, `learnings`, `games`, `tools`

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
- **Learnings** — `isPublishedLearning()` in `src/lib/learnings.ts`: `published
  && content.trim()`. The second condition is the one the flag cannot express —
  an entry saved from /admin with the box ticked and the body still empty would
  otherwise be sitemapped and carry a card while its page rendered nothing.

`EMBED_TAGS` (`src/lib/embeds.ts`) and `GAME_TAGS` (`src/lib/games.ts`) both
live in `src/lib/` and **not** in `src/config/games.ts`, because the `/admin`
Vite middleware regenerates that config file wholesale from `generateGames()` —
an export added there is deleted on the next admin save.

They are not the same list, and conflating them is the mistake to avoid.
`EMBED_TAGS` is every component that can be mounted anywhere; `GAME_TAGS` is the
subset that has a `/games/<slug>` page, derived from `GAME_SLUGS`. The two split
when the six generative engines moved out of `/games` into Driftfield
(`/tools/driftfield/<mode>`, `src/lib/driftfield.ts`) and the articles — those
are still mounted, just not as games. Collapsing them back would either empty
every article embed or resurrect six pages that no longer exist, and both
failures are silent. `security:smoke` asserts the subset relation and that no
Driftfield mode is still a game.

Detail pages also cross-link their siblings via `src/components/RelatedLinks.astro`.
Without it each product page is a crawl leaf reachable only through its hub, so
crawl attention and internal link equity never reach the pages that rank. Feed it
only indexable items, for the reason above.

Note the admin page is **dev-only** — see Security. Config edited in dev is
written to `src/config/*.ts` and must be committed to reach production; there is
no runtime editing on the server.

### Learnings: writing, not just rendering

The owner read the first seven articles and called them "full of ai slop… no
prioritisation, no highlighting, no emotions… all the learnings are very same
format copy paste. all starts with the interactive element directly." All four
were fair. `docs/plans/learnings-voice.md` is the response and is **binding on
every new article** — its "Hard bans" list is a set of LLM tics, not stylistic
preferences.

Three mechanisms exist because of that feedback:

- **`{{embed}}` places the figure.** The route used to pin the component between
  the summary and the prose, which is the worst available position — the reader
  meets a simulation before being told what it is, and the article then has to
  open by pointing at "the thing above". That single constraint is most of why
  all seven read identically. `splitOnEmbed()` (src/lib/markdown.ts) splits the
  source on a `{{embed}}` line; no marker means the figure goes after the prose,
  so a typo costs the position and never the simulation.
- **Editorial marks**: `==highlight==`, `>> pull quote`, and
  `:::note/:::key/:::aside/:::warn` callouts, all parsed in
  `src/lib/markdown.ts`. They are markdown extensions and **not** raw HTML on
  purpose: content comes from config and /admin, and the whole pipeline exists so
  an author can never introduce markup. Each extension parses its own body back
  through marked, which keeps `renderer.html`'s escaping in force inside it. The
  callout `kind` is matched against a fixed list rather than interpolated —
  otherwise `:::" onmouseover=` would put an attribute in the output.
- **`>` stays a real blockquote** (someone said this); `>>` is the pull quote.
  Two jobs, two marks — using blockquote for emphasis makes real quotations
  unreadable as quotations.

### Learnings: articles that mount a live component

`/learnings` is the long-form section, and the one thing it can do that a
newsletter cannot is run the simulation it is describing inside the page. A
learning's optional `embed` field names an **`EMBED_TAGS` key** — the wider list
in `src/lib/embeds.ts`, because most of what these articles embed is no longer a
game — and the article route mounts that component through `mountEmbed()` in
`src/lib/game-mount.ts`, which strips the component's own chrome and then runs
the same `mountGame()` dispatch `/games/[slug]` uses. Adding an article about an
existing component therefore costs no interactive code at all.

Three things follow from sharing components between the two routes, and each has
already broken once:

- **`src/lib/game-mount.ts` is the only copy of the dispatch.** Two copies drift
  the first time a component moves, and the failure is silent — a blank element
  on whichever route was forgotten.
- **`src/styles/games-embed.css` is the only list of component stylesheets**, for
  the same reason. Both routes import that one file.
- **Every component writes its own `<h1>` and blurb into itself**, because on
  `/games/<slug>` it *is* the page. Inside an article those duplicate the header
  above them and give the document two `<h1>`s, so the learnings route strips
  them. It does that with a `MutationObserver`, **not** a sweep after mount:
  the component's markup lands *before* `astro:page-load` when its module is
  already in the session's module cache (every in-site navigation) and *after*
  it on a cold load, so no single moment is safe to sweep at. A timing-based
  version passed a hard reload and failed on every in-site click.

Unknown or absent `embed` degrades to a prose article rather than throwing — a
typo in /admin should cost the simulation, not the page. `security:smoke` asserts
that every shipped article's `embed` is really in `EMBED_TAGS`, because nothing
else catches that typo.

**An article that quotes numbers is quoting the component, and the numbers need
an assertion.** "192 mazes on a 3×3 grid, the recursive backtracker can build 14"
is not a fact about mazes — it falls out of Maze Weaver's default column count,
its `ASPECT`, its three-builder list and the cell its backtracker starts from.
Change one of those and the prose is false while the page still renders, the
maze still works and the build stays green. `security:smoke` recomputes both
counts from the 3×3 grid graph (never from the article or the component, so
neither can pass by agreeing with itself) and pins the rest — grid size, the
shortest corner-to-corner route, the builder button labels, the status-line
wording the caption points at, and that switching builder keeps the seed — to the
constants they were read from. Do the same for the next article that measures
something.

**"Recompute it independently" is not enough on its own — recompute it from the
definition.** The pot-odds article said the equity a call needs is `B / (P + B)`;
with its own `P` (the pot before the bet) it is `B / (P + 2B)`, because your own
call joins the pot you are winning a share of. The drill computed the same wrong
number, and the smoke test "recomputed" it too — independently of the source, but
from the same misremembered fraction, so all three agreed, all three were wrong,
and the gate stayed green. The replacement derives the break-even by bisecting
`EV(call) = 0`, which cannot inherit a formula someone half-remembered. When a
claim is a piece of arithmetic, assert the thing it is arithmetic *about*.

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

## The 2-hourly autonomous pass

`portfolio-2h-pass` (a scheduled task; its prompt lives outside this repo at
`~/.claude/scheduled-tasks/portfolio-2h-pass/SKILL.md`) runs every two hours and
works **3–4 roles in parallel**, with every fourth run an audit instead of a
build. The roster and the deterministic selection rule are in
`.claude/scheduled/portfolio-roles.md`; the ledger is
`.claude/scheduled/portfolio-pass-log.md`.

Three things about it are load-bearing:

- **The rotation is deterministic, not "whatever seems urgent".** Roles are
  picked from a PASS counter the ledger carries, so the roster is walked.
  Judgement-based selection reliably starves `seo-reach` and `projects` — the
  roles whose neglect is invisible in a screenshot. The counter replaced a
  clock-slot derivation on 2026-08-19: this runs on a laptop that sleeps, and a
  slot-derived rotation never makes up a missed run, so the roles mapped to the
  small hours were starved by exactly the mechanism meant to prevent starving.
- **The selection rule has exactly one copy**, in `portfolio-roles.md`. The
  task's own prompt used to restate it, the roster was corrected, and the prompt
  kept the superseded expression — so the correction never took effect. The
  prompt now references the roster and is forbidden from restating the formula.
- **The ledger is read top-200-lines only**, so a run entry is capped at 12
  lines and deferrals live in one in-place `## Open deferrals` section instead of
  being restated in every entry. The previous `portfolio-run-log.md` reached
  334 KB and was read whole on every run, which spent most of a context window on
  history nobody needed. It is kept for reference and is no longer the working
  ledger.

The pass commits to `develop` behind the full gate (`build` + `check` +
`security:smoke` + `poker:check`) and never pushes or touches `main`. `check` is
in that list because `build` alone does not catch what it catches — see Build /
Test / Run. The older daily `daily-portfolio-improvement` cowork task targets the
same working tree — run one or the other, not both.

An unattended run **cannot** start the dev server, so it cannot do the in-site
click-through that the `astro:page-load` mounting bug requires. It appends the
route to a `## Verification queue` at the top of the ledger instead; drain that
queue with `/browser-debug` in an owner-present session.

## Coming-soon pages have a working ask

A game that is enabled but not playable renders a "want this sooner" counter
(`src/lib/interest.ts`, `src/pages/api/games/interest.ts`). A counter and not a
form: a form needs moderation, storage bounds on free text and an escaping story,
and answers no question the page is asking.

The bound that matters is the **key** bound. The route validates the submitted
slug against the set of enabled-but-not-playable games it reads from config, so
the body cannot introduce a store key — the number of counters is at most the
number of coming-soon games, whatever traffic arrives. Accepting the body's slug
directly would be the same mistake as trusting a client IP. Counts only, no
identity; the one-vote-per-browser flag is localStorage and is UX, not a control.

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

Type Trial is the worked example, and it was a deepening rather than a fourteenth
game: one shared passage per UTC day, a server-validated leaderboard you join by
name, and practice modes that still never leave the browser. Note what it did
*not* need — no accounts, no per-visitor identity, no cookie. A display name plus
the numbers is the whole record, which keeps it on the right side of the
aggregate-only line the Analytics section draws.

Ship fewer, larger things. One tool that a stranger would bookmark is worth more
than the whole current list.
