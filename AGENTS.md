# AGENTS.md

Guidance for agents working in this repo. The rules are binding. Most are
asserted by `npm run security:smoke`, whose comments carry the longer reasoning;
the stories behind them are in git history.

Long explanations live in `docs/` (index: [docs/README.md](docs/README.md)); each
section below ends with a pointer. Session pickup (live branch, pending moves,
next work): [STATUS.md](STATUS.md).

## Project Overview

Personal portfolio: an SSR Astro app with a home hero plus projects /
experience / blogs / learnings / games / tools sections.

**Stack**
- **Astro 7**, fully SSR (`export const prerender = false` on every page).
- **Adapter**: `@astrojs/node` in Docker on an OCI VM behind Cloudflare;
  `@astrojs/cloudflare` is the swap-in. `astro.config.mjs` is the only
  deployment-specific file.
- **Oat** is the base layer, vendored as `public/oat.min.{css,js}`. Keep it out of Vite: its CSS minifier merges Oat's `@layer` blocks and restyles buttons. No React/Vue/Svelte.
- **Lightweight**: no JS framework, no CSS framework or runtime component
  library. A component Oat lacks is built here, small and dependency-free, on
  the tokens. Every dependency earns its place, and the heavy ones (cytoscape,
  html2canvas, gifenc, marked) load per route, so a page pays only for what it
  uses.
- **TypeScript** throughout; `@astrojs/check` for type checking.

**Content**: `src/config/*.ts` holds the interfaces and default data. The
accessors in `src/lib/config.ts` read a KV override (Workers) or
`data/{key}.json` (Node) when present, else those defaults. `/admin` is
dev-only and writes `src/config/*.ts`, which ships through git; the site's
personal data is the exception: `src/config/site.json`, reviewable as plain
JSON, with the `Site` type declared in `src/config/site.ts`.

Key modules, the stack in full and the admin checklist: [docs/architecture.md](docs/architecture.md).

## Branches

- Branch flow: feature → `develop` → `main`, by PR. A direct
  fast-forward push to `main` is allowed (its ruleset blocks force pushes and
  deletion, not direct pushes) only after `develop` has merged `origin/main`
  back in: every PR merge leaves a merge commit `develop` lacks, and a push that
  is not a fast-forward is refused. Local `main` is stale; compare against
  `origin/main`.

## Build / Test / Run

```sh
npm run dev            # astro dev server (local /admin is open)
npm run build          # astro build
npm run check          # astro check: type/template errors the build does NOT catch
npm run preview        # serve the production build locally
npm run generate-types # wrangler types (Cloudflare/KV bindings)
npm run graph          # graphify update . (local code graph)
npm run og             # regenerate the share cards
npm run security:smoke # assert the security invariants
npm run poker:check    # poker engine checks
npm run boot:check     # boot dist/server/entry.mjs, require a 200 page (after build)
npm run analytics:smoke
npm run origin:check   # assert the DEPLOYED edge posture against production
npm run trainer:catalogue   # poker trainer asset sheet -> docs/poker-assets.html (gitignored)
node scripts/wallpaper-forge-gif.selfcheck.mjs   # smoke test for the gifenc encoder
```

**The gate before any commit: `build`, `check` (0 errors), `security:smoke`,
`poker:check`, `boot:check`.** There is no unit-test suite.

Notes on `check`, `boot:check` and deploys: [docs/operations.md](docs/operations.md).

## Configuration

**Never read config from `src/config/` in pages or layouts.** Use the accessors:

```ts
import { getSite, getProjects, getExperience, getPosts, getGames } from '../lib/config'
const site = await getSite(Astro.locals)
```

## Operations rules

### Caching

- `max-age=0` is deliberate: browser-cached HTML can't be purged. Keep
  Cloudflare's Browser Cache TTL on "Respect Existing Headers" or it overrides
  this.
- The middleware's branch order is asserted: admin first, then responses that
  set their own `Cache-Control`, then `/api/*` → `no-store`, then 5xx →
  `no-store`, and only then the 404 rule. An API 404 is often a resource that exists a moment later; don't
  reorder.

### Analytics

Two independent, aggregate-only layers: a client beacon and a server counter.
Both keep 90 days. **Counts only: never IPs, user ids, user agents, session
traces or full referrer URLs.** Aggregates need no consent banner; a feature
that needs per-visitor identity needs a different design. Don't rebuild what
Cloudflare's dashboard already shows. Keep Cloudflare Web Analytics
auto-injection off, and never weaken the CSP for its beacon.

### Share cards

- **Run `npm run og` after adding a tool or game or changing a title or
  description, and commit the PNGs.**

### AI crawlers

- **Never disallow a search or user-fetch agent** (OAI-SearchBot, ChatGPT-User,
  Claude-SearchBot, Claude-User): that takes the site out of AI answers.
- Google-Extended stays allowed, because Google ties Gemini's training and its
  answers to that one token.

Caching, analytics, share cards, crawlers: [docs/operations.md](docs/operations.md).

## Security

**These are load-bearing invariants. A change that can't hold them needs a
different design.** `security:smoke` asserts the code half and `origin:check`
the deployed half.

### The admin surface does not exist in production

`isAdminRequestAllowed()` returns `import.meta.env.DEV` and nothing else, so
`/admin` and every `/api/admin/*` route answer 404 in production. `ADMIN_SECRET`
is dev-only and never passed to the container. Never add an IP allowlist: it
authenticates a header the caller chooses.

### Never authorize on a client-controlled value

No header, cookie, query param or body field may gate access on its own.
`getClientIp()` is untrusted and only buckets rate limits. Authorization rests
on a secret the client can't forge, or on the surface not existing.

### Origin exposure

The origin has a public IP with port 80 open, so Cloudflare is bypassable and
`cf-connecting-ip` is authoritative only for traffic that came through it.

1. **The real fix, still open**: `scripts/lock-origin-to-cloudflare.sh`
   (restrict 80/443 to Cloudflare's ranges) or a Cloudflare Tunnel. UFW alone
   isn't enough; the OCI Security List is enforced upstream and must match.
2. **On**: `ORIGIN_SHARED_SECRET` plus a Cloudflare Transform Rule that injects
   `x-origin-auth`; the middleware 404s anything without it. An empty secret
   disables the check, and a set secret with no matching rule 404s every
   request. So create the rule first and set the secret second. If it breaks,
   fix the rule value (applies at once), not the secret (costs a redeploy).

### Rate limits must be bounded

Use `createRateLimiter()` (`src/lib/security.ts`) for every public endpoint.
Never hand-roll a `Map` keyed by client IP: the keys come from a header, so it
is a memory-exhaustion vector. The host is a 1 GB VM and the container is
capped at `--memory=768m`.

**A route with a per-client and a shared bucket asks the shared one only after
the client's says yes**: `allowClient(key) && allowGlobal('global')`. A refused
hit still counts, so asking both up front lets one refused client drain the
shared budget for everyone.

### Public endpoints must be bounded in every dimension

Body size, per-key count, global bytes, retention, and how long a request may
hold a socket. Byte accounting is optimistic (`.length` counts UTF-16 units),
so budget for it.

### Validate a client-submitted value against one the server derives

Re-derive what is being scored and check the payload against that, never against numbers the payload also supplied.

### A verifier's algorithm must not come from the thing it is verifying

`src/lib/jwt.ts` takes the algorithm as a parameter and never reads it from the token's header (algorithm confusion). The thing being checked must not supply the terms of its own check.

### Escaping

- Anything interpolated into HTML is escaped, including `'`.
- Anything in a `<script>` body (JSON-LD) goes through `serialize()` in
  `src/lib/jsonld.ts`, which escapes `<`.
- Markdown goes through `src/lib/markdown.ts` only (raw HTML escaped, URLs
  through `safeMarkdownUrl()`). Never hand `marked` output to `set:html`.
- An exception's message never reaches a response. Routes answer expected
  failures with fixed sentences and wrap calls that could throw (`csInspect`)
  in fixed `no-store` JSON.

### A rerouted error page carries the nonce its CSP names

The CSP is `script-src 'self' 'nonce-…'` with a fresh nonce per response, and
exactly one inline script ships: the head bootstrap (`ROOT_BOOT_JS`,
`src/lib/theme.ts`).

- ClientRouter re-inserts a changed inline script under a nonce the live page
  refuses, so the bootstrap is a constant with nothing interpolated. **Don't add
  a second inline script**: data goes in a JSON-LD block or a fetched file (the
  palette's index is planned as `/search.json`), behaviour in a bundled module.

### Unguessable ids are a security control

Where knowing an id is the only protection (webhook bins), ids are at least 24
characters, enforced server-side.

### Before merging anything that touches a trust boundary

```sh
npm run security:smoke && npm run build && npm run check && npm run boot:check
```

Add an assertion for each new invariant: a code invariant in
`scripts/security-smoke.mjs`, a deployed-posture one in `scripts/origin-check.sh`.
Then **break what the assertion guards and watch it fail.** A mutation that
survives means the assertion is wrong, not the mutation. The poker split-pot
fixture is the worked example.

The tool-engine rules (an observation must not be taken through a lens that alters it; a comparison must exclude what legitimately differs; a traversal's loop guard is per-path; a finding cites the record it rests on; a failed lookup is not an absent record; a conclusion that does not depend on X must not be gated on X) and every rule's reasoning: [docs/security.md](docs/security.md).

## Key Conventions

- **A tool's claims live in a module, not in the component**
  (`webhook-inspector/signature.ts`, `cron-whisperer/schedule.ts` and
  `crontab.ts`, `token-bench/diagnose.ts`, `chainsaw/analyze.ts`,
  `deep-shore/escape.ts`, `dns-sightline/analyze.ts`, `src/lib/jwt.ts`), so
  `security:smoke` can run them against the real thing.
- **Semantic elements and `data-type` idioms**: style standard elements and
  `data-*` attributes rather than custom classes, with tokens only. Oat is a
  base layer the site builds on, not the design system. A component Oat lacks
  is built here, small and dependency-free. Fixes to Oat's own rules go in the
  fork; anything site-specific stays in this repo.
- **SEO support copy is off.** `seoContent` still renders when set, but every
  entry ships empty: generated how-to and FAQ filler is boring, and dropping it
  is a deliberate SEO trade-off. Anything added there must earn its place like
  an article.
- **Client mounting with ClientRouter.** Bundled scripts run once per session, so anything that mounts does it inside `document.addEventListener('astro:page-load', …)`. Test by clicking an in-site link, not by reloading.
- **One copy of each client helper** (`escape.ts`, `storage.ts`, `flash.ts`, `download.ts`, `format.ts`, `math.ts`, `motion.ts`, `date.ts`): import them rather than writing a private copy.

Everything else (the shared tool/game frame, the skeleton, fonts, canvas export, the "server" badge): [docs/conventions.md](docs/conventions.md).

## Design System

All visual design comes from the tokens in `src/styles/theme.css`. Re-theme by
editing tokens only. The design system is the site's own (the tokens plus the
shared idioms in `shared.css`); Oat is the base layer under it.

- **Never hardcode** a colour, font, size or spacing in a stylesheet; use
  `var(--color-*)`, `var(--font-*)`, `var(--text-*)`, `var(--space-*)`.

Tokens, control kit, theming, contrast: [docs/design-system.md](docs/design-system.md).

## Home hero

- **Never the host**: no provider, runtime or anything else about the origin,
  which is what helps someone reach it around Cloudflare. The visitor's own
  address appears only as its first two groups, and is never kept.
- **No tools or games in the hero** (the owner's rule): not in the copy, not as
  a link or a hover affordance, not even by name. The site nav keeps "tools"
  and "games" for search reach, and the meta description still lists them.
  The nav drops its wordmark on `/` (owner, 2026-10-02): it links home.
- **Looping motion is allowed here and in the hubs' sky, nowhere else.** It
  still stops when the hero is hidden or off screen, and renders the finished
  replay as one still frame under `prefers-reduced-motion`.

The full hero spec: [docs/home-hero.md](docs/home-hero.md).

## Standing Rules

1. **Graph before commit.** A best-effort pre-commit hook runs
   `graphify update .` and re-stages `GRAPH_REPORT.md`. If you bypass hooks, run
   `npm run graph` yourself for structural changes.
2. **Keep docs in sync.** A change to architecture, config keys, commands or
   conventions updates this file in the same change (a new admin section updates
   the checklist and the config-keys line). Write the rule and a one-line reason;
   the story belongs in the commit.
3. **Prune dead code.** No commented-out blocks, unused exports, orphaned config
   keys or superseded CSS overrides.
4. **`npm run build` stays green.**
5. **Security invariants hold.** Read *Security* before touching a route, a
   header, config validation or anything that renders untrusted input. Run
   `npm run security:smoke`, and add an assertion there for any new invariant.
6. **No new secrets on the production host.** A value needed only in dev stays
   out of the container env.

Long explanations go in the `docs/` file named in the Map below; add every new `docs/` file to [docs/README.md](docs/README.md).

## The bar for a new tool or game

**A tool must do something a static HTML page cannot**, and clear at least two
of these:

- **It owns a URL other software talks to.** The reference is webhook.cool: you
  get an endpoint, it captures real requests, you watch them arrive.
- **State outlives the tab**: a permalink, a saved run, a daily seed everyone
  shares.
- **It is correct about something people get wrong**: DST-aware cron previews,
  JWT signature verification against a pasted JWK, spec-conformant `.ics` or
  vCard output.
- **It fits a real debugging loop**: an HTTP echo with injectable status and
  latency, an SSE or WebSocket echo target.

**Don't ship** another formatter, converter, encoder, colour picker, regex
tester or canvas screensaver.

**Games**: single-player, no persistence and a famous clone is the beginner
tell. Prefer deepening an existing game (a shared daily seed, a server-side
leaderboard, a replay permalink) over adding another. Type Trial is the worked
example: one shared passage per UTC day and a server-validated board joined by
name, with no accounts, cookies or per-visitor identity.

- **Mobile ergonomics and material authenticity** (tap targets, 375px clearances, physical materials): [docs/plans/game-design-principles.md](docs/plans/game-design-principles.md).

Ship fewer, larger things. One tool a stranger would bookmark is worth more than
the whole current list.

## Map

- [docs/README.md](docs/README.md): index of every doc.
- [docs/architecture.md](docs/architecture.md): stack, key modules, admin checklist, indexing predicates.
- [docs/security.md](docs/security.md): the security rules in full.
- [docs/conventions.md](docs/conventions.md), [docs/design-system.md](docs/design-system.md), [docs/home-hero.md](docs/home-hero.md): UI rules.
- [docs/learnings.md](docs/learnings.md): articles and embeds; voice in [docs/plans/learnings-voice.md](docs/plans/learnings-voice.md).
- [docs/operations.md](docs/operations.md): build notes, caching, analytics, share cards, crawlers.
- [docs/plans/](docs/plans/) and [docs/ideas.md](docs/ideas.md): plans and backlog.
