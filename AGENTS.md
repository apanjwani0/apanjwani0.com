# AGENTS.md

Guidance for agents working in this repo. The rules are binding. Most are
asserted by `npm run security:smoke`, whose comments carry the longer reasoning;
the stories behind them are in git history.

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
- `src/styles/theme.css` — design tokens, the single source of truth.
- `astro.config.mjs` — the adapter and the Vite middleware that persists
  `/admin` saves.

## Current state (2026-10-05)

- **Live** = `origin/main` = `origin/develop` (PR #33 and #35 merged `develop`
  into `main`). Branch flow: feature → `develop` → `main`, by PR. A direct
  fast-forward push to `main` is allowed (its ruleset blocks force pushes and
  deletion, not direct pushes) only after `develop` has merged `origin/main`
  back in: every PR merge leaves a merge commit `develop` lacks, and a push that
  is not a fast-forward is refused. Local `main` is stale; compare against
  `origin/main`.
- **Owner's pending moves:**
  1. Purge the Cloudflare cache and run the post-deploy checks in
     `docs/plans/release-followups.md` after each deploy since #27.
  2. Close the origin lock (see *Origin exposure*). Until then port 80 on the
     origin is reachable around Cloudflare.
- **Awaiting the owner's review:** the control kit exists and Flowmap is rebuilt
  on it; no other tool moves to the kit until then.
- The 2-hourly autonomous pass is disabled (last run 2026-08-20).

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

- `check` is stricter than `build`: Astro's build parser tolerates things
  `astro check` can't parse. Two known traps build green: a `{/* … */}`
  comment between a component's attributes (hides every type error in that file),
  and `const f = (a) => ({…})` followed by a bare `{` block (phantom parse
  errors).
- `boot:check` starts the built server with the Dockerfile's own command on a
  loopback port and requires a full 200 page from `/`. Neither `build` nor
  `check` starts the server, so a dependency mismatch can ship an origin that
  crashes on boot. It deletes `ASTRO_NODE_LOGGING` from the child's env on
  purpose: that variable skips the boot path that crashes on a mismatch. The Dockerfile's final
  stage runs it too (after `npm ci --omit=dev` and the `USER` switch), so a
  server that can't start fails the image build and the old container keeps
  serving. A local `node_modules` older than the lockfile fails it; run
  `npm ci`.
- For UI/route changes, also run `/browser-debug` against the dev server.
- Deploys: a push to `main` builds the Docker image, restarts the container
  from the self-hosted runner, then fetches `/` inside it. That probe runs
  after the old container stops, which is why `boot:check` runs first.

## Configuration

**Never read config from `src/config/` in pages or layouts.** Use the accessors:

```ts
import { getSite, getProjects, getExperience, getPosts, getGames } from '../lib/config'
const site = await getSite(Astro.locals)
```

## Caching & Performance

HTML is SSR, so Cloudflare doesn't cache it by default. Two layers fix that
without touching the build:

1. **A Cloudflare Cache Rule** (dashboard) makes HTML cache-eligible except
   `/api/*`, `/admin` and requests carrying the `__admin_session` cookie.
2. **`Cache-Control` from `src/middleware.ts`**: public `GET` 200s get
   `public, max-age=0, s-maxage=600, stale-while-revalidate=86400`; admin and
   logged-in responses get `no-store`; non-API 404s get
   `public, max-age=0, s-maxage=300`, because scanners make most origin
   traffic; any 5xx gets `no-store`, so the edge never keeps a fault.

- `max-age=0` is deliberate: browser-cached HTML can't be purged. Keep
  Cloudflare's Browser Cache TTL on "Respect Existing Headers" or it overrides
  this.
- The middleware's branch order is asserted: admin first, then responses that
  set their own `Cache-Control`, then `/api/*` → `no-store`, then 5xx →
  `no-store`, and only then the 404 rule. An API 404 is often a resource that exists a moment later; don't
  reorder.
- After a deploy, pages serve the cached copy until the TTL. Purge via
  Cloudflare → Caching → Configuration → Purge Everything. Check with
  `curl -sSI https://apanjwani0.com/ | grep cf-cache-status` (want `HIT`).

## Analytics

Two independent, aggregate-only layers:

1. **Client beacon** (`src/lib/analytics-client.ts` → `/api/analytics/event`),
   on tool and game detail pages only: real-user LCP, CLS and TTFB,
   rate-limited to 60/min per client. Stored in `SITE_ANALYTICS`, else
   `analytics:*` keys in `SITE_CONFIG`, else `data/analytics.json`.
2. **Server counter** (`src/lib/visits.ts`, called from the middleware): every
   HTML render that reaches the origin. These are cache misses, not page views.
   It records date, path, country (`cf-ipcountry`), referrer **host** and a bot
   count, buffered in memory and flushed to `data/visits.json` every 30 s.
   Never write per request.

Both keep 90 days. **Counts only: never IPs, user ids, user agents, session
traces or full referrer URLs.** Aggregates need no consent banner; a feature
that needs per-visitor identity needs a different design. Don't rebuild what
Cloudflare's dashboard already shows. Keep Cloudflare Web Analytics
auto-injection off, and never weaken the CSP for its beacon.

```sh
ssh <host> 'cat /opt/portfolio/data/visits.json' | python3 -m json.tool | head -50
```

## Share cards (Open Graph)

Every `live` tool and every playable game has a 1200×630 card at
`public/og/<tools|games>-<slug>.png`. `src/lib/og.ts` derives the path from kind
and slug; there is no `image` config field, because a second source could only
disagree. A card goes only on an indexable page (see *Indexing*). Pages without
one fall back to the avatar and a `summary` Twitter card.

- **Run `npm run og` after adding a tool or game or changing a title or
  description, and commit the PNGs.**
- `scripts/generate-og.mjs` rasterises with local headless Chrome, never in CI
  or production. An on-demand render route would add native-binary
  dependencies and per-request CPU on a 1 GB box.
- Product pages and the `/tools` and `/games` hubs use a keyword-first
  `seoTitle` with no owner name; section pages (`/projects`, `/blogs`) keep the
  name suffix. Authorship lives in the JSON-LD `author` and the footer.

## AI crawlers

The owner's choice (2026-09-28): search and AI answers yes, training no.
`public/robots.txt` states it in a `Content-Signal` line, which is a request,
and disallows the crawlers that only collect training data: GPTBot, ClaudeBot,
CCBot and Applebot-Extended.

- **Never disallow a search or user-fetch agent** (OAI-SearchBot, ChatGPT-User,
  Claude-SearchBot, Claude-User): that takes the site out of AI answers.
- Google-Extended stays allowed, because Google ties Gemini's training and its
  answers to that one token.
- `/llms.txt` (`src/pages/llms.txt.ts`) is the site index as Markdown, asserted
  to list exactly the sitemap's pages. Crawlers barely read it, so it is a
  courtesy to agents, not an SEO lever.

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

A green deploy proves nothing here: its probe supplies the header from the
container's own env. Only `npm run origin:check` from outside proves the lock.

### Verifying what is not in git

The Transform Rule, the Cache Rule and Browser Cache TTL live in the Cloudflare
dashboard, where a stray click reverts them silently. `npm run origin:check`
(`scripts/origin-check.sh`) asserts what a stranger sees: a 200 through
Cloudflare, the origin IP not serving the app, `max-age=0`, `s-maxage` present,
the response proxied, matching header and body nonces on three 404 shapes, and
no Web Analytics beacon in a browser's copy of `/`. Cloudflare injects that
beacon only for a browser user agent and copies the page's nonce onto it, so a
plain `curl` never sees it. A page it could not read in full (a curl error, a
timeout, a non-200 such as a bot challenge) fails the check rather than passing
it. The beacon is matched in a captured page, never through `curl | grep -q`:
under `pipefail` an early match closes the pipe and reads as "no match".
Asserted. Run it after any Cloudflare change.

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

- **A sequence of steps needs a deadline of its own**, because per-step
  timeouts multiply. DNS Sightline joins `SG_INSPECT_DEADLINE_MS` (15 s,
  `src/lib/dns-doh.ts`) to the request's signal with `AbortSignal.any`, and
  `sgQuery` checks `signal.aborted` before asking anything: an abort listener
  never fires on a signal that has already aborted.
- **Name lookups count.** `dns.lookup` runs on libuv's threadpool outside every
  other budget, so Link Peek and Chainsaw both use `lookupAllBounded`
  (`src/lib/dns-lookup.ts`, 3 s).
- **Validate before you spend the token.** A request that can't cause the harm
  (a target with no scheme) must not cost the visitor's or the instance's
  budget. The pre-check is syntactic only (no DNS, no socket), and the fetch
  path stays authoritative, re-checking every redirect hop.
- **Reference implementations**: the Webhook Inspector (`WEBHOOK_MAX_*`, the
  2 s `?delay=` ceiling); the Type Trial and Hue Hunt daily boards (`DAILY_*`,
  `HUE_*`: bounds, separate read and write limiters, a debounced flush to
  `data/*.json`, rows re-validated on load, one shared `sanitizeName`); and
  Chainsaw (`CS_ALLOWED_PORTS`, a fixed list of ports that speak TLS at once,
  no STARTTLS). Chainsaw resolves first and then pins the socket to the checked
  address with the name only as SNI, and its limits are half Link Peek's
  because each request makes two handshakes.

### Validate a client-submitted value against one the server derives

Re-derive what is being scored and check the payload against that, never
against numbers the payload also supplied. Type Trial derives the UTC day and
its passage from `src/lib/type-trial-daily.ts`, which the browser shares.
**One-sided bounds are the trap**: a wpm ceiling computed from the claimed
seconds grows without limit as the seconds shrink, so the gate must pin the pair
to each other. Ask of every validator what an attacker sets the *other* field
to. Hue Hunt removes the other field: it takes the raw guesses and no score, and
computes the total itself. Its honest ceiling (today's colours are readable
from the bundle) is stated in `src/lib/hue-hunt-daily.ts`.

### A verifier's algorithm must not come from the thing it is verifying

`src/lib/jwt.ts` takes the algorithm as a parameter and never reads it from the
token's header (algorithm confusion). The Webhook Inspector picks the hash from
the header *name* the sender used, never from a label inside the value. Also
asserted: `alg: none` is reported unsigned and never verified, and signature
validity and `exp`/`nbf` are separate answers. The thing being checked must not
supply the terms of its own check.

### An observation must not be taken through a lens that alters it

Chainsaw reports which certificates the server *sent*. When verification
succeeds, `getPeerCertificate(true)` reports the chain OpenSSL built, including
a root from the local store. So the inspection makes two handshakes to the
pinned address: one with the real store (is it trusted?) and one with `ca: []`
(what crossed the wire). The second must fail; if it comes back authorized, the
observation is discarded and the UI says so. `CsDialOptions.trustAnchors` exists
only for the smoke test. The walk follows `issuerCertificate` links, so the tool
claims nothing about wire order or unlinked extra certificates.
`socket.authorizationError` is an Error on some Node versions and a string on
others; `csAuthCode` handles both. Ask of any probe: is the instrument part of
what I'm measuring?

### A comparison must exclude what legitimately differs

DNS Sightline's `sgCanonicalRecord` drops the TTL (each resolver counts down its
own copy) and record order (round-robin rotates), and IPv6 goes through
`canonicalIp` (`src/lib/ip.ts`). TXT case and the MX preference are kept.
Otherwise every load-balanced domain reads as inconsistent. The smoke test
asserts both directions (a real difference still reads as one), and that one
silent resolver among answering ones is **filtering**, not propagation. A
resolver that couldn't answer, a SERVFAIL included, is excluded from the
verdict rather than compared as an empty answer.

### A traversal's loop guard is per-PATH, not global

SPF's ten-lookup budget counts lookups across the whole recursive evaluation. A
domain reached by two routes is a diamond and is charged twice; only a name in
its own ancestry is a cycle (`sgSpfDescend`). The walker is checked against an
independent oracle in `security-smoke.mjs` (valid only on acyclic zones), and
depth and breadth each have their own bound and fixture. So does what it keeps:
past the overshoot a term is counted, never kept or followed, because one TXT
answer can hold thousands.

### A finding cites the record it rests on

`SgFinding.evidence` carries the literal record text. Only `basis: 'absence'`
(about a record confirmed not to exist) and `basis: 'unanswered'` (the lookup
got no answer: SERVFAIL, a timeout, the budget or the deadline) may cite
nothing, and the footer in `panels.ts` switches on `basis`. The smoke test
derives the producer list from function signatures and the finding ids from
source, so a new finding needs a fixture or fails the gate. "Dangling" means
NXDOMAIN at the CNAME target, never just "no address record".

### A failed lookup is not an absent record

A timeout must never become a confident sentence about someone's zone.

- **`sgUnanswered`** (`analyze.ts`) is the one test of whether a question got
  an answer. NXDOMAIN is an answer; SERVFAIL, REFUSED, a timeout, the budget and
  the deadline are not. Every finding that reads an empty record set asks it
  first and yields `spf-inconclusive`, `dmarc-inconclusive`, `mx-inconclusive`,
  `mx-unchecked` or `caa-inconclusive` in place of the absence finding. An
  unanswered include makes the SPF count a floor ("At least N").
- **`sgPickAnswer`** is the one rule for which resolver's answer is read: the
  primary's when it answered, else any that did, else the primary's own
  failure. The Records table and the walks read the diff's pick, and the panels
  (`dns-sightline/panels.ts`, pure functions of the report) switch on
  `mxStatus` instead of deciding absence themselves.
- **CAA**: `SgCaaReport.incomplete` is set when any lookup in the walk failed,
  including names *below* a found policy, since one of them might hold its own
  set. Then `caa-inconclusive` cites the parent's records without claiming they
  govern, and `caaRenewalOutlook` answers `unavailable`.
- **Whose failure it was decides the advice.** After a timeout, the deadline or
  the budget, the advice is to re-run. When every resolver returned SERVFAIL
  (`sgOutageOf`), the zone is broken (`zone-servfail`).
  `resolvers-unreachable` uses `SgAnswer.stopped` to tell the deadline from a
  resolver this server couldn't reach.
- **A finding may lean on an absence without being about one.** `dmarc-at-apex`
  needs `_dmarc` to have answered. "Not dangling" needs an answer saying the
  target exists, else `cname-unchecked`. NXDOMAIN on an MX target's A lookup
  settles both address families.
- The smoke test asserts this without a list of findings. For every question
  the inspection asks, it runs the zone with that record present, absent and
  unanswered. A finding that depends on the question must not appear when it
  went unanswered, and it must carry `basis: 'unanswered'` there and never in an
  answered run. A conclusion wrongly *withheld* can't be checked that way, so
  NXDOMAIN and the cases above have direct assertions.

### A conclusion that does not depend on X must not be gated on X

`caaRenewalOutlook` (`src/lib/caa.ts`) joins the CAs DNS Sightline's policy
permits with the issuer Chainsaw saw. Blocks that hold for every CA (a critical
tag no CA understands, `issue ";"`) are reported before the issuer is
identified. Only then does an unknown issuer return `null`, rather than
fuzzy-matching the identifier table. Every message is about a *renewal that will
fail*, never mis-issuance: a CA checks CAA only before it signs.

`spf-no-all` follows only what decides an unlisted sender's result: the first
`all`, else the `redirect=` chain (`SgSpfReport.fallthrough`). It is suppressed
only when that chain went unread.

The narrow `scope=caa` query on `/api/tools/dns-sightline` has its own
rate-limit buckets. That is allowed only because `cap × budget` stays under the
full scope's in both the per-client and the global dimension, which is asserted.

### Escaping

- Anything interpolated into HTML is escaped, including `'`.
- Anything in a `<script>` body (JSON-LD) goes through `serialize()` in
  `src/lib/jsonld.ts`, which escapes `<`.
- Markdown goes through `src/lib/markdown.ts` only (raw HTML escaped, URLs
  through `safeMarkdownUrl()`). Never hand `marked` output to `set:html`.
- A remote-chosen value that lands in CSS or an `href` is held to that grammar
  first. Link Peek's image type must match `image/[a-z0-9.+-]+`
  (`lpImageMediaType`). Chainsaw's CA Issuers URL is a link only when it parses
  as plain http(s) with no credentials **and** the certificate text already
  equals the parser's output (`csLinkableUrl`), so the link text is its own
  href.
- An exception's message never reaches a response. Routes answer expected
  failures with fixed sentences and wrap calls that could throw (`csInspect`)
  in fixed `no-store` JSON.

### A rerouted error page carries the nonce its CSP names

The CSP is `script-src 'self' 'nonce-…'` with a fresh nonce per response, and
exactly one inline script ships: the head bootstrap (`ROOT_BOOT_JS`,
`src/lib/theme.ts`).

- Astro re-renders a bodyless 404 or 500 through its error page (`404.astro`
  or `500.astro`, which also renders for a route that throws) with a second
  nonce and keeps the first pass's headers. Without `500.astro`, `/500` falls
  through to `[slug].astro` and a crash reads as a cached, blank 404. So the middleware leaves CSP to the
  re-render for the statuses Astro reroutes (`isReroutedByAstro`, held to
  Astro's `REROUTABLE_STATUS_CODES`), and `origin:check` compares header and
  body nonces in production.
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

## Key Conventions

- **Every tool renders `div[data-type="tool-page"]`** with
  `data-tool="<dir-name>"`. That root supplies the workbench width
  (`--tool-width`), the gutter, the focus ring and `<kbd>` styling. A tool styles
  its internals, never its own container width. Asserted.
- **Tools, games and Driftfield modes share one frame**: `--tool-width` (70vw,
  floored at 1120px and capped at 1800px), one left edge for the breadcrumb, the
  title and the content, at every viewport width. A tool draws it on its root. A
  playable game page asks `Base` for `workbench`, which makes `main` the same box
  (it is border-box and carries the gutter, so that page's breadcrumb takes no
  `inset`), and a Driftfield mode wraps its page in the tool root. No game or
  engine caps its own root (the cap does nothing in an article's 728px column and
  is a second, narrower column on a game page), and no game renders the tool root
  (that doubles the gutter). A page outside `main`'s gutter, which is every
  tool page, gives `RelatedLinks` and the SEO block `inset`. Asserted.
- **A tool page links only its own stylesheet**, `tools/<slug>/<slug>.css`,
  through a `?url` glob in `tools/[slug].astro`, after `tools-common.css`. A
  static import of a per-tool sheet, in the route or in a tool module, puts it
  in every tool page's head: Astro hoists the CSS of every module a page's
  script can reach. Asserted.
- **No bundled script is inlined.** Vite inlines a small `<script>` chunk by
  default, with no nonce, and the CSP refuses it; `assetsInlineLimit` in
  `astro.config.mjs` keeps every script a file, and every `?url`-linked
  stylesheet too (a data: stylesheet is refused the same way). Asserted.
- **A tool's claims live in a module, not in the component**
  (`webhook-inspector/signature.ts`, `cron-whisperer/schedule.ts` and
  `crontab.ts`, `token-bench/diagnose.ts`, `chainsaw/analyze.ts`,
  `deep-shore/escape.ts`, `dns-sightline/analyze.ts`, `src/lib/jwt.ts`), so
  `security:smoke` can run them against the real thing.
  - **A diagnostic proves every cause it reports and reports none it can't.**
    `token-bench/diagnose.ts` changes one input per hypothesis, re-runs real Web
    Crypto, and reports only causes it watched start verifying; findings carry
    `proof: 'verified' | 'structural'`. The load-bearing assertion is negative
    (a simply-wrong key yields zero causes), and the label is asserted on every
    producer: `inspectTokenText` holds no key, so it can never emit `verified`.
  - **A crontab names a wall clock, not an instant.** Cron Whisperer resolves
    each wall-clock tuple to 0, 1 or 2 instants, and Vixie's rule decides what
    is made up across a DST jump: only a job with no `*` in its hour and minute
    fields runs "at a fixed time". The engine walks wall readings but returns
    instants, so every termination decision must be taken in instant order. The
    smoke test's brute-force oracle is valid only for non-fixed-time schedules.
    Two readings are flagged, not resolved; settle them against real cronie
    before changing either: `restricted` is `token !== '*'` (the man page, not
    Vixie's source), and a bare `TZ=` line. `crontab.ts` is the file grammar (a
    `CRON_TZ=` or `TZ=` applies downward only); `schedule.ts` is the semantics.
- **A hot path replaced for speed keeps the slow one as an untouched reference
  and asserts equality.** Poker's `evaluateBest` defines what a hand is worth;
  `scoreBest` is the fast path, checked against it over all 2,598,960 five-card
  hands. Deleting the slow one removes the only definition the fast one is
  checked against.
  - A memo (`poker-trainer/engine/equity-cache.ts`) keys on its arguments,
    never on something supplied alongside them (`cachedEquityVsRange` keys on
    the combos, not the range text). A canonicalisation is a claim about the
    function underneath, so assert the invariance both ways. Cards are sorted
    within a hand, but the two hands are never swapped.
  - Deep Shore keeps `dsEscapeReference` beside `dsEscape`, proved equal over a
    34,000-point grid. Orbit periodicity detection is absent on purpose, and
    zoom-at-cursor is asserted as a fixed point. A share link's precision comes
    from the zoom (`dsCoordDigits`: the round trip stays within half a pixel of
    a 3840 px canvas; `DS_MAX_ZOOM` states the double's floor). Tours move at a
    constant apparent speed: `log(zoom)` is linear and the centre follows
    `dsPanWeight`; the smoke test requires the naive linear pan to fail, and end
    frames are exact (`dsSegmentViewAt` is tested directly).
- **A cost ceiling is written in the unit that actually costs.** The poker
  trainer bounds five-card reads (`PT_MAX_RANK_WORK`, via `handsRanked()`), not
  boards. `PT_MAX_RANGE_WORK` is a lesson setting (which street a drill is dealt
  on), so changing it is the owner's call.
- **Canvas export is shared.** `attachCanvasExport(host, () => canvas, { name })`
  from `src/lib/canvas-export.ts` (with `src/styles/canvas-export.css`) gives PNG
  at a chosen scale, a live-recorded GIF and a preview before saving. Don't
  hand-roll `toDataURL` downloads. An engine that renders on demand passes an
  `AnimationSource` as `options.animation`, with `liveGif: false`: its frame
  count comes from a measured frame, held end frames reuse the last ImageData,
  and a second click stops the render. Every bar joins one registry served by
  one guarded pair of swap listeners (`trackBar`).
- **The "server" badge on `/tools` is derived.** `SERVER_TOOLS` lives in
  `src/lib/tools.ts`, not `src/config/tools.ts`, which `/admin` regenerates
  wholesale. Asserted: each slug is `live` and calls an `/api/` route, and the
  number word in the intro copy matches the set's size. The `/games` intro's
  daily count is checked against `DAILY_SLUGS` the same way.
- **Semantic elements and `data-type` idioms**: style standard elements and
  `data-*` attributes rather than custom classes, with tokens only. Oat is a
  base layer the site builds on, not the design system. A component Oat lacks
  is built here, small and dependency-free. Fixes to Oat's own rules go in the
  fork; anything site-specific stays in this repo.
- **SSR everywhere**, `/tools` included: KV reads and the middleware headers
  need it.
- **SEO support copy is off.** `seoContent` still renders when set, but every
  entry ships empty: generated how-to and FAQ filler is boring, and dropping it
  is a deliberate SEO trade-off. Anything added there must earn its place like
  an article.
- **StarField** runs behind the plain pages that keep `Base.astro`'s default
  (the 404, blogs, a learning with no figure). Keep it off tool and game detail
  pages (CPU), the card hubs and the home page, whose hero draws its own stars.
  A new listing page passes `starfield={false}`.
- **The sky** (`src/lib/sky.ts`) is the home hero's drifting stars and
  constellations. The tools, games and learnings hubs draw it as their
  background (`Base`'s `sky` prop, mounted by `src/lib/sky-ui.ts`, owner
  2026-10-01): about half the hero's density, at most ~30 fps, stopped while
  the tab is hidden, one still frame under reduced motion, the canvas capped at
  1.5 device pixels. Listing cards are opaque so no star lands in their copy.
  Only those three hubs render it. Asserted.
- **Tool and game detail pages** pass `clientRouter={false}` (no router bundle)
  to `Head`.
- **Fonts are self-hosted and load on every page.** Source Serif 4 and JetBrains
  Mono (variable, Latin subset, OFL) live in `src/assets/fonts`;
  `src/styles/fonts.css` declares them, Vite hashes them into `/_astro/`, and
  `Head` preloads the two upright faces through the same `?url` import. Each
  family has a metric-matched local fallback face (`size-adjust` and the
  overrides, measured over the site's own text), so the swap moves no text.
  Serif is for reading (titles, prose, card titles), mono for operating
  (controls, labels, nav, code). No stylesheet names a family: everything reads
  `--font-serif` or `--font-mono`, so a typeface changes in one token. No Google
  Fonts host, and CSP `font-src` is `'self'`. Asserted.
- **A tool or game holds a skeleton until its element upgrades.** The server
  renders a bare `<h1>` and intro inside the custom element, which the component
  then replaces; raw, it flashed unstyled text and the page jumped. `shared.css`
  keeps the title, hides the rest of a host that is a direct child of `main`,
  and draws a static `--skeleton-height` panel on `html[data-js]
  :is([data-tool], [data-game]):not(:defined)`; without JS the text stays. The
  panel also holds the space of a Driftfield stage and a learning's figure,
  which render empty and would push the page down when they mount. No animation.
  A new tool, game or embed gets it free through its `data-tool` / `data-game`
  attribute.
  - **What follows a pending workbench is `visibility: hidden`, not removed**
    (the footer, the related links, a Driftfield story line). A hidden box is
    not scored, so the panel's height can stay generic (a short tool would
    otherwise pull the footer into view, a tall one push a link out of it).
  - **The tool host keeps the column before and after it upgrades**; only the
    pending host carries the gutter. A host that took the column only while
    pending changed its own box at mount, which the browser scores.
- **Measure layout in an observer, never at module evaluation.** `nav-ui.ts`
  reads the nav's height in a `ResizeObserver` callback, which runs after
  layout; a synchronous read made the script pay for the first layout. Until that
  lands, `main` pads by `--space-header-offset`, which must be the nav's real
  height (64px, 66px stacked on a phone, measured in a browser). Asserted.
- **Sideways overflow is held on `html` and `body` together.** Oat's tooltip is a
  `white-space: nowrap` pseudo-element, laid out even while hidden, so a long one
  on a button near the right edge widens the page. A clip on the root alone does
  nothing to a phone's page width; `body` needs it too. The fix proper is in the
  Oat fork, which owns that rule. Asserted.
- **Flowmap's colours and layout.** A node's colour is a name from
  `GRAPH_TONES` (`src/lib/graph-text.ts`), matched on decode like its shape and
  drawn from the `--tone-*` tokens (set in both palettes, a border plus a faint
  tint under `--color-text`). "Flow" is `tidyTree` (`src/lib/graph-layout.ts`):
  each parent centred over its own children, in either direction. The board
  identifies what is under the pointer (cursor, a lifted node, a "+" handle that
  adds a child on click and connects on drag; on touch it follows the selected
  node). Scroll pans and Ctrl/pinch zooms, taken from Cytoscape in the capture
  phase. The canvas is updated by a diff (`reconcile`), never by removing every
  element: that leaves Cytoscape's pointer-target cache stale. Every graph
  that reaches the canvas (drawn, linked or stored) passes `normalizeGraph`,
  because Cytoscape throws on a repeated id or a dangling edge and a bad stored
  board would keep the tool dead on every visit. `tidyTree` walks iteratively,
  since an outline is as deep as it is long. Asserted.
- **Heavy dependencies load per route.** `cytoscape` is only ever a dynamic
  `import()`: in `Flowmap.ts`'s `connectedCallback`, and in `Draftboard.ts`
  when the Map view first opens. Never import it statically. Every Cytoscape layout
  needs `nodeDimensionsIncludeLabels: true`, or labelled nodes pile up.
- **Client mounting with ClientRouter.** Bundled scripts run once per session,
  so anything that mounts does it inside
  `document.addEventListener('astro:page-load', …)`. Test by clicking an in-site
  link, not by reloading. A `document` or `window` listener added per mount must
  be removed, bound by a `signal`/`once`, or registered once behind a
  module-level guard (asserted over `src/components` and `src/lib`). The router
  replaces every attribute on `<html>`, so client state kept there survives only
  because `initSiteUI()` copies it forward (`patchIncomingDocument`); a new root
  attribute joins `ROOT_STATE_ATTRS`.
- **The adapter is the only deployment-specific code.** Three modules are
  Node-only (`src/lib/link-peek-fetch.ts`, `src/lib/tls-inspect.ts`,
  `src/lib/dns-lookup.ts`) and are reached only from the Link Peek and Chainsaw
  API routes; the build asserts no `node:` import reaches a client chunk. A
  Workers deploy would need another transport for them.

## Design System

All visual design comes from the tokens in `src/styles/theme.css`. Re-theme by
editing tokens only. The design system is the site's own (the tokens plus the
shared idioms in `shared.css`); Oat is the base layer under it.

- **Never hardcode** a colour, font, size or spacing in a stylesheet; use
  `var(--color-*)`, `var(--font-*)`, `var(--text-*)`, `var(--space-*)`.
- **Load order**: `theme.css` → `shared.css` (base elements and the header,
  both shells) → `global.css` (content pages) / `home.css` / component CSS.
- **Anything both shells render belongs in `shared.css`**, because
  `ToolBase.astro` doesn't load `global.css`. That covers a shared `data-type`
  idiom's base rule (a Base-only refinement may stay in `global.css`), bare
  element rules (the page `h1`, at `--text-title`) and `body` itself: font,
  colour, background, and the flex column that pins the footer, with
  `main { flex: 1 0 auto }`. The `tool-header` block lives once, in
  `tools-common.css`. Only a tool-private subtree may size an `h1` (Draftboard's
  `md-preview`). All derived from the components and asserted.
- **Card titles**: `[data-type="card-title"]` gets its size (`--text-card`) and
  weight from `shared.css`, and no other sheet may set its `font-size` or
  `font-weight`.
- **One card anatomy on every hub** (`shared.css`): `card-head` (the title,
  then a `card-badges` group on the right), `card-desc` (clamped to three
  lines), then an optional `card-meta` pinned to the bottom (the learnings
  card's date and read time). The tools, games and learnings hubs all render
  `ul[data-type="card-grid"] > li` this way; the streak strip finds its game's
  `card-badges`.
- **The whole card is its link**, through a stretched `::after` on the title
  link. The card must stay `position: relative` (or the overlay covers the
  page), and a card's secondary links need `position: relative` to stay
  clickable. Both asserted.
- **Spacing rungs increase in name order**: `2xs < xs < sm < md < lg < xl < card
  < section`, declared smallest first. The only other `--space-*` tokens are
  layout measurements (`page-x`, `header-offset`). Asserted.
- **One control kit**: `src/styles/controls.css`, imported by `shared.css`,
  styles the controls inside any root carrying `data-controls` (buttons with
  `data-variant="primary|ghost|danger"`, `aria-pressed` for "on",
  `[data-type="segmented"]`, `toolbar`, fields, `section-label`, `field`, tabs
  with `data-tabs="pill"` inside a pane, `details[data-type="menu"]`, badges with
  `data-tone`, `status-line`). It reads only the `--control-*`, `--tab-*`,
  `--badge-*`, `--field-fs` and `--label-tracking` tokens, and those read
  `--font-*` and `--color-*`, so one token changes every control. Controls are
  36px, 44px on a coarse pointer; at most one primary per view. Its hover rules
  carry `:not(:disabled)`. Every kit token is read by the kit, no literal
  colour or family, every rule sits under `[data-controls]`, and a kit tool
  is in none of the `tools-common.css` lists. Asserted. Not `data-kit`: that is
  the starred-tools count on `<html>`, and a kit keyed on it would restyle
  every control on the site. The kit loads after a tool's own sheet, so a tool rule that must
  beat it is prefixed with the tool root (`[data-tool='flowmap'] …`). New
  tools join the kit; Flowmap is the reference.
- **One disabled treatment**: `--opacity-disabled`. The lane floors
  (`tools-common.css`, `games-common.css`) neutralise `:hover` by re-stating the
  hovered properties at equal specificity, declared after. Not
  `:hover:not(:disabled)`: that raises specificity and repaints per-tool tab
  opt-outs. Those lists are being retired tool by tool as each moves to the kit.
- **Contrast is asserted.** `security:smoke` parses both palettes and holds
  every text pairing to WCAG AA (4.5:1). Headroom is thin on
  `--color-surface-2` (accent 4.59 and success 4.68 in light, muted 4.76 in
  dark). `--color-accent-soft` takes `--color-text` only. `--color-border` is
  held to 2:1, deliberately short of the 3:1 for UI boundaries, which would box
  every card; the hover border is `--color-muted`.
- **Focus**: `main` carries `tabindex="-1"` for the skip link. Silence its ring
  only with `main:focus:not(:focus-visible)`, never a blanket
  `main:focus { outline: none }`. Asserted.
- **An `<svg>` at `width: 100%` scales its own text**, so a diagram gets a
  legibility floor (`min-width` on the SVG, `overflow-x: auto` on its container)
  rather than a breakpoint. A scrollable container takes `tabindex="0"`,
  `role="region"` and an `aria-label`.
- **Theming**: light at `:root`, dark under `[data-theme="dark"]` (the site runs
  dark). A new theme is another `[data-theme="…"]` block with palette, shadows
  and its own `color-scheme`. The `color-scheme` line is required, or Oat's
  layered `light dark` makes native controls follow the OS. The Oat bridge at
  the end of `:root` points Oat's tokens at the site's, and every ink-on-fill
  pair it creates is in the contrast sweep.
- **The visitor picks the theme**: `theme:v1` in localStorage (`light` | `dark`
  | `system`), else the site config's theme, never the OS. There is no theme
  cookie; the server never varies by theme.

## UI refresh (2026-09)

Item A (the foundation) is built, and G (the control kit) is built with Flowmap
as its first tool; B–F are paused. The direction: refine the dark
look, not a rebrand, with tasteful motion and `prefers-reduced-motion` as the
off switch.

Modules, none with DOM access at module scope:

- `src/lib/theme.ts` — the theme preference (`theme:v1`, the `site:theme`
  event), `resolveTheme` (pure), `ROOT_STATE_ATTRS`, `patchIncomingDocument`,
  `ROOT_BOOT_JS`.
- `src/lib/kit.ts` — starred tools (`kit:v1`, at most 24, live tools only),
  `parseKitParam` (the only `?t=` parser, for route and client alike),
  `bookmarksFile`.
- `src/lib/site-index.ts` (server-only) — `indexablePaths` (what the sitemap
  serialises) and `buildSiteIndex` (what `/llms.txt` lists, and the planned
  palette's entries), asserted to be the same pages.
- `src/lib/fuzzy.ts` — `fuzzyScore`, `suggestPaths`, `isScannerPath`.
- `src/lib/site-ui.ts` — `initSiteUI()`, called once by both shells. It wires
  the swap patch, watches the theme preference, and calls four empty entry
  points owned by the paused items (`initThemeUI`, `initFindUI`, `initKitUI`,
  `initMotion`). None may import `astro:transitions/client`, which would put
  the router on ToolBase pages (asserted).

The head bootstrap sets `data-theme`, `data-theme-pref`, `data-js` and
`data-kit`, updates the theme-color and color-scheme metas, and wraps every
storage access in `try`. It restates `resolveTheme` because it can't import it,
so the smoke test runs it over the full truth table. Both shells render
`html[data-theme-default]`. The nav buttons
`button[data-action="palette" | "theme" | "shortcuts"]` stay hidden until
`data-js`. `Base` takes a `canonicalPath` prop for pages that render a query
string.

### Paused items

B (theme toggle everywhere), C (command palette, `?` sheet, smart 404), D
(toolkit: stars, shelf, `/tools/kit`, bookmarks export), E (shells, nav, motion,
the home hero seam) and F (hub thumbnails and share cards) are designed, not
built. The plan (`ui-refresh/ui-plan.md`, the worker brief and
item A's report) is only on the remote branch `origin/wip/ui-refresh-notes`:
read it before building any of them, and keep that branch. Until they are built, `kit.ts`
and `fuzzy.ts` have no UI caller; `security:smoke` covers them so they don't rot, and each
item's assertions go in its labelled region at the end of that script. Planned
names nothing renders yet: `button[data-type="kit-star"]`,
`section[data-type="kit-shelf"]`, `div[data-type="detail-actions"]`. Item G's
control kit now exists (`src/styles/controls.css`, see *Design System*). The
view-transition plan: `vt-title` is the page h1 and, during a navigation, the
clicked card's title, with `html[data-vt-source]` clearing the source page's h1
(two elements with one name abort the transition); `vt-nav` is the fixed nav;
`vt-thumb` is optional. No stylesheet declares `view-transition-name` yet.

## Home hero (2026-09)

The home page has one hero, `src/components/home/hero/network.ts`. It replays
**this** page load, slowed down, as a metro line of stations over a drifting
starfield: your device, your network, the ISP, DNS on a branch, Cloudflare's
data centre (by city) and the server. A frame at the top left says what it
shows, and a chat-like log at the bottom right tells each step with its real
timing. The owner picked it on 2026-09-30 and retired the dev switch, the
classic hero and the "how the internet works" story, whose topic is now a
learnings article. The frame, the name block and the log are the keepers; the
line itself may be swapped later through the same contract.

- **Real data only, never a sample** (owner, 2026-09-28). The replay reads
  Navigation Timing, `/cdn-cgi/trace` (country, data centre, TLS) and one HEAD
  of `/` (whether Cloudflare's copy predates the visit, from its `age`). The
  click-to-ping times a GET of `/cdn-cgi/trace`, which the data centre answers
  itself, so a ping is the edge round trip and never an origin render. A fact
  it cannot measure is left out: the ISP station carries no number, because
  nothing times that hop apart from the rest. On the dev server the page comes
  from localhost, so `/__hero-probe` (dev-server middleware in
  `astro.config.mjs`, loopback only) measures one real request to the live
  site instead.
- **Never the host**: no provider, runtime or anything else about the origin,
  which is what helps someone reach it around Cloudflare. The visitor's own
  address appears only as its first two groups, and is never kept.
- **Every stop explains itself** on hover, focus or tap, for someone who has
  never heard of DNS: a card says what the stop is and what it did on this
  visit (measured, or nothing), the stop is spotlit, and it acts out its own
  leg of the trip. A pointer must rest on a stop briefly, so one crossing the
  line opens nothing. Acting out waits for the replay and pings to finish and
  never runs under reduced motion.
- **Plain, explanatory copy** (owner, 2026-09-30): full, simple sentences a
  beginner can follow, in the frame, the log and the cards alike. No clipped
  one-liners or clever phrasing.
- **Nothing blinks or pulses.** The status lights stay lit, the spotlight's glow
  is steady and its veil eases in and out. The stars' slow twinkle is the only
  brightness driven by the clock (asserted in the script and the stylesheets);
  they drift at 14 px/s, and there are 115% as many, 15% brighter, as the first
  sky (`SKY_INTENSITY`, owner 2026-10-01).
- **A short screen scrolls**, at any width: a phone either way up, or a short
  laptop window. When the frame, the line and the text block cannot share one
  screen, the hero grows taller rather than squeezing the line into the name;
  a line still too short drops its sub-lines before any label.
- **It reads line, log, name** (owner, 2026-10-02). On a laptop the log sits at
  the bottom right. On a phone, or when the name needs the width, it joins the
  text block and shows above the name through CSS `order`, so the markup keeps
  the h1 first.
- **Text is server-rendered.** The page renders the h1, tagline and social
  links; the hero reads them through `env.text` and never draws its own copy.
  The section carries `data-theme="dark"` because the canvas is dark, and the
  page passes `starfield={false}` because the hero draws its own stars.
- **The contract** is `src/components/home/hero/types.ts`: `create(host, env)`
  returns `{ start, stop, resize, destroy }`. `mount.ts` is the only caller. It
  loads the hero as its own chunk, mounts on `astro:page-load`, destroys on
  `astro:before-swap`, and runs the hero only while the tab is visible and the
  stage is on screen. Every document or window listener the hero adds takes
  `env.signal`. Styles: `home.css` plus `hero-network.css`.
- **No tools or games in the hero** (the owner's rule): not in the copy, not as
  a link or a hover affordance, not even by name. The site nav keeps "tools"
  and "games" for search reach, and the meta description still lists them.
  The nav drops its wordmark on `/` (owner, 2026-10-02): it links home.
- **Looping motion is allowed here and in the hubs' sky, nowhere else.** It
  still stops when the hero is hidden or off screen, and renders the finished
  replay as one still frame under `prefers-reduced-motion`.

`security:smoke` holds the page to one hero with no switch and no query string,
every child of the hero's text block above the scrim (read from the markup),
no clock-driven oscillation outside the stars' twinkle and no endless CSS
animation, a resize that redraws at once, the hero to no tools or
games (the tagline, the section markup, and every string
literal and stylesheet the hero ships), `network.ts`'s strings to no host or
runtime name, the dev hooks (`location.search`, `/__hero-probe`) to the DEV
gate, the probe to loopback-only dev middleware, and the hero to its own chunk.

## Skills & Commands

- **`/browser-debug [url] [what to check]`** — a subagent that fetches the dev
  server, validates nav routes, HTML structure and asset linking (Oat's base
  files, per-tool stylesheets). Use after any layout, component or page change.
- **`/antigravity <task>`** — hands small, well-scoped edits to a faster
  subagent. Keep architecture, multi-file changes, debugging and
  `astro.config.mjs` here.
- **`/frontent-design`** — UI generation under the portfolio override: no custom
  classes, fonts or Tailwind; semantic HTML plus the site's `data-type` idioms
  and tokens. Motion only in the tasteful sense: short transitions from the
  `--motion-*` and `--ease-*` tokens, never looping decoration. `shared.css` neutralises every
  transition and animation under `prefers-reduced-motion: reduce`; motion driven
  from script checks the query itself.
- **`/update-project-memory`** — saves non-obvious learnings to memory.

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

### Learnings: writing, not just rendering

`docs/plans/learnings-voice.md` is binding on every article, its hard bans
included. The format: 350–550 words of prose, a visual beat every one to three
lines, and a read time on the page. A study may settle a question the reader is
already asking; it may not be the reason the article exists.

- **`{{embed}}` places the figure, and `{{embed:view}}` places the same
  component pinned to one view** with the picker dropped. `splitOnEmbeds()`
  (`src/lib/markdown.ts`) splits the article on them. With no marker the figure
  goes after the prose. An unknown view falls back to the full picker, so the
  smoke test checks every shipped marker against the component's view list.
  With many figures on a page, playback follows an `IntersectionObserver` and a
  deliberate pause is remembered (asserted).
- **Read time is derived** (`readingTime()`: the prose plus 8 s per figure),
  never stored.
- **Editorial marks**: `==highlight==`, `>> pull quote` and
  `:::note|key|aside|warn` callouts are markdown extensions in
  `src/lib/markdown.ts`, not raw HTML. Each parses its body back through marked,
  and the callout kind is matched against a fixed list. `>` stays a real
  blockquote.

### Learnings: articles that mount a live component

A learning's optional `embed` names an `EMBED_TAGS` key. The route mounts it
through `mountEmbed()` (`src/lib/game-mount.ts`), which strips the component's
own chrome and runs the same `mountGame()` dispatch `/games/[slug]` uses.

- `game-mount.ts` is the only copy of the dispatch, and `games-embed.css` the
  only list of component stylesheets.
- A component's own `<h1>` and blurb are stripped by a `MutationObserver`, not a
  sweep after mount: the markup lands before or after `astro:page-load`
  depending on the module cache. One observer per container, released at the
  next `astro:before-swap`. A figure that writes no chrome is in
  `EMBED_NO_CHROME` and gets no observer (derived both ways).
- An unknown `embed` degrades to a prose article; the smoke test asserts every
  shipped `embed` is in `EMBED_TAGS`.
- **An article that quotes numbers is quoting the component, and the numbers
  need an assertion.** Recompute them independently of both article and
  component (Maze Weaver's 3×3 counts), in every field that repeats them
  (`content`, `summary`, `metaDescription`; the field list is derived). And
  recompute from the definition, not a remembered formula: the pot-odds
  break-even is found by bisecting `EV(call) = 0`.
- `diagram-atlas` (`src/components/games/diagram-atlas/`) is an article-only
  figure drawn as inline SVG, so its labels are selectable. Its claims live in
  `atlas.ts`, and every view has a full legend. Structural views (class, ER)
  never animate and behavioural ones must; every beat lights an element that
  exists, tokens stay inside the viewBox, and only the activity view may show
  two tokens. Its deployment view draws a generic stack and never names the
  host. All asserted.
- `internet-atlas` (`src/components/games/internet-atlas/`) is the same kind of
  figure for `/learnings/how-the-internet-works`: eight stops, each with a legend
  saying what it is, what it does on this trip and what happens when it goes
  wrong. Every view animates. It draws with the `at-*` vocabulary styled in
  `diagram-atlas.css`, and its clock is a copy of the Diagram Atlas's (fold the
  two into one engine if a third figure arrives). Its example addresses come
  only from the documentation ranges, and it never names the host. All
  asserted, like the Diagram Atlas.

## Code graph (graphify)

`graphify-out/` is a generated code graph, used only as an AI navigation aid:
the `.claude/` hooks nudge `graphify query` before grepping. It is not part of
the build. Regenerate with `npm run graph` (incremental, local) when you want it
current; it needs the `graphify` CLI. Only `graphify-out/GRAPH_REPORT.md` is
committed; the rest is gitignored. Keep `.gitignore` comments on their own lines.
`.graphifyignore` scopes the graph to `src/`.

## The 2-hourly autonomous pass

`portfolio-2h-pass` (its prompt is at
`~/.claude/scheduled-tasks/portfolio-2h-pass/SKILL.md`; **disabled**, last run
2026-08-20) runs 3–4 roles in parallel every two hours, with every fourth run
an audit. The roster and the
selection rule are in `.claude/scheduled/portfolio-roles.md`, the ledger in
`.claude/scheduled/portfolio-pass-log.md`.

- Roles rotate by a PASS counter in the ledger, never by judgement or clock
  slot: both starve the roles whose neglect a screenshot doesn't show.
- The selection rule has one copy, in the roster. The prompt must not restate
  it.
- The ledger is read top-200 lines only: an entry is capped at 12 lines, and
  deferrals live in one in-place `## Open deferrals` section.

It commits to `develop` behind the full gate and never pushes or touches
`main`. It can't start the dev server, so a route that needs an in-site
click-through goes in the ledger's `## Verification queue`, drained with
`/browser-debug` in a session with the owner. Run only one autonomous
portfolio task at a time.

## Coming-soon pages have a working ask

An enabled-but-unplayable game shows a "want this sooner" counter
(`src/lib/interest.ts`, `src/pages/api/games/interest.ts`), not a form. The
route validates the slug against the coming-soon games in config, so a request
body can't create a store key. Counts only; the one-vote-per-browser
localStorage flag is UX, not a control.

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

Ship fewer, larger things. One tool a stranger would bookmark is worth more than
the whole current list.
