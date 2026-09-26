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
- `src/lib/caa.ts` — the CAA vocabulary (`issue`/`issuewild`, the CA identifier registry, issuer→identifier mapping, and the renewal outlook) shared by DNS Sightline and Chainsaw. Hoisted like `src/lib/ip.ts`; Sightline re-exports its old `sg*` names.
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
npm run boot:check     # boot dist/server/entry.mjs, require a 200 page (after build)
npm run analytics:smoke
npm run origin:check   # assert the DEPLOYED edge posture against production
```

There is no unit-test suite; **`npm run build` is the green-bar gate**, but it
is not the whole gate: `astro build` compiles `.astro` files with Astro's own
tolerant parser and **`npm run check` does not**. A `{/* … */}` JSX comment
placed between two attributes of a component tag built green for four commits
while making `src/pages/learnings/[slug].astro` unparseable to `astro check`,
which silently excluded every type error in that file from being reported.
A second instance, so this is a class and not a one-off: `const f = (a) => ({…})`
followed immediately by a bare `{` block builds green under esbuild and throws
five phantom parse errors under `astro check`, because TypeScript reads the
object literal as the next arrow's parameter list.
Run both; `check` must stay at 0 errors. For
UI/route changes, also run `/browser-debug` against the dev server.

**Neither of them ever starts the server**, and that gap has already shipped a
dead origin: the lockfile resolved astro 7.3.3 against `@astrojs/node` 11.1.0,
whose `standalone()` calls `app.pipeline.getLogger()` on an `app` that astro 7.3
no longer gives a `pipeline` (11.1.6 calls `app.getLogger()`), so `node
dist/server/entry.mjs` — the Dockerfile `CMD` — threw a `TypeError` on boot
while `build` and `check` were both green. `npm run
boot:check` (`scripts/boot-check.mjs`) closes it: after a build it starts that
entry point the way the image does, on a free loopback port, and requires a
complete 200 HTML page from `/` plus a process still alive a second later. It
deletes `ASTRO_NODE_LOGGING` from the child's env on purpose — that variable
switches off exactly the branch that crashed, so inheriting it from a shell
would pass the check on the regression it exists for.
The production GitHub deploy builds a Docker image on `main`, restarts the OCI
container from the self-hosted runner, then fetches `/` inside the container
before reporting success. That probe runs *after* the old container is stopped,
so it reports a boot failure with the site already down; `boot:check` is the
same question asked before anything ships. The image asks it too: the
Dockerfile's runtime stage copies `scripts/boot-check.mjs` in and runs it after
`npm ci --omit=dev` and the `USER` switch, so a server that cannot start fails
the *image build* inside `docker/build-push-action` and the old container keeps
serving. The final stage and not the builder is deliberate — the builder holds
devDependencies and runs as root, so a server that breaks only without one, or
only as the container's user, would boot there and still ship dead.
`security:smoke` holds the step to that position.

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
The two product **hubs** (`/tools`, `/games`) side with the product pages as of
2026-08-25: they pass a keyword-front-loaded `seoTitle` ("Free Online Developer
Tools — …"), because a stranger finds them by searching for what they list, not
for the name. Authorship still lives in the JSON-LD `author` and the footer.

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

**A route that pairs a per-client bucket with a shared one asks the shared one
only after the client's has said yes** — `allowClient(key) &&
allowGlobal('global')`, never both evaluated up front. `createRateLimiter`
counts a hit even when it refuses, so DNS Sightline, which asked both
unconditionally, let one address that was already being refused keep spending
the shared bucket: sixteen requests in a minute from a single client locked every
other visitor out of the tool. `security:smoke` derives the rule over every
route in `src/pages/api` (a limiter called with a string literal is the shared
bucket, anything else is per-client) and floods the DNS Sightline route from one
address to prove a second one still gets in.

### Public endpoints must be bounded in every dimension

Body size, per-key count, global bytes, retention, *and* how long a request may
occupy a socket. The Webhook Inspector is the reference: `WEBHOOK_MAX_*` in
`src/lib/webhook-store.ts` plus the 2s `?delay=` ceiling. Budget for byte
accounting being optimistic — `.length` counts UTF-16 code units, not bytes, and
object overhead is real.

**Per-step bounds multiply, so a sequence of steps needs a bound of its own.**
DNS Sightline had a 4s timeout on every question and no deadline on the
inspection, and its SPF walk asks one question after another — forty of them
held one socket for close to three minutes against a resolver that had stopped
answering. `SG_INSPECT_DEADLINE_MS` (15s, `src/lib/dns-doh.ts`) is joined to the
request's own signal with `AbortSignal.any`, and `sgQuery` checks
`signal.aborted` before it asks anything: an abort listener never fires on a
signal that has *already* aborted, so without that check every question after
the deadline still went out and sat through its own timeout — measured at 16s
for a 300ms deadline. Reaching the deadline is not an error; see *A failed
lookup is not an absent record* for what the walks report instead.

Name lookups count too. `dns.lookup` runs on libuv's four-slot threadpool with
the OS resolver's timeout, outside every budget the callers keep, so Link Peek
and Chainsaw both go through `lookupAllBounded` (`src/lib/dns-lookup.ts`, 3s).
Chainsaw used to await the bare call while Link Peek raced it — one guard, two
habits — and `security:smoke` now proves the bound for both with a lookup that
never answers.

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

Chainsaw (`src/lib/tls-inspect.ts`, `src/pages/api/tools/chainsaw.ts`) is the
third, and it bounds a dimension the other two do not have: **which port may be
dialled at all**. Link Peek's rule — default ports only — is unusable for a cert
inspector, since 8443 and 993 are exactly the cases people debug, and an
*arbitrary* port would turn the origin into a port scanner. `CS_ALLOWED_PORTS`
is the middle: a fixed list of ports that speak TLS the instant the socket
opens. STARTTLS ports are deliberately absent, because half-implementing that
conversation would report "no TLS" for servers that have it. It reuses Link
Peek's address classifier rather than growing a second copy, resolves first and
then **pins the connection to the checked address** with the name carried only
as SNI — which closes, for this tool, the DNS-rebinding window Link Peek
documents as its own ceiling. Limits are half Link Peek's per client (6/min,
24/min global) because each request costs two outbound handshakes, and the
target is validated *before* a rate-limit token is spent, so a typo does not
cost a visitor one of six chances a minute.

**Validate before you spend the token** is the rule, not a Chainsaw detail, and
Link Peek follows it as of 2026-09-20. The budget exists to bound real outbound
fetching; a URL with no scheme was never going to fetch anything, and charging
it against both the visitor's allowance and the instance's global bucket spends
the defence on the one request that cannot cause the harm. The gate has to be
the cheap syntactic half only (scheme, credentials, port, host presence — no
DNS, no socket), and the fetch path stays authoritative, since it is the one
that re-checks every redirect hop. `security:smoke` derives the ordering from
both routes.

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

### An observation must not be taken through a lens that alters it

Chainsaw (`src/lib/tls-inspect.ts`) exists to answer "what certificates did this
server send", and the obvious way to ask — `socket.getPeerCertificate(true)` —
**does not answer it**. When verification succeeds that call reports the chain
OpenSSL *built*, including the root it supplied out of the local trust store.
Measured against a fixture server, not assumed: a server sending leaf +
intermediate reports **three** certificates when the root is trusted and **two**
when it is not. A tool whose headline finding is "your chain is incomplete"
cannot read the chain through a lens that completes it, and "the server also
sends its root" — a real finding — would otherwise be reported for every
correctly configured host on earth.

So the inspection makes **two** handshakes to the same pinned address: one with
the real store, which answers *is this trusted*, and one with `ca: []`, which
trusts nothing and therefore can only report what crossed the wire. The second
one is required to fail: if it comes back `authorized`, the empty store did not
take effect, the observation is discarded rather than believed, and the UI says
so. `CsDialOptions.trustAnchors` exists solely so `security:smoke` can reproduce
the store-completion effect offline and watch a mutation that drops `ca: []`
fail; `csInspect` never sets it, and that is asserted.

Two further honesty notes, stated rather than implied away. The walk follows
`issuerCertificate` links, so it sees the certificates that *link* from the
leaf, not the wire order, and a certificate the server sent that links to
nothing is dropped entirely — the tool therefore claims **nothing** about chain
order or unrelated extra certificates, both of which are real SSL-Labs findings
and neither of which is observable here. And `socket.authorizationError` is an
Error on some Node versions and a bare code **string** on others (Node 22 hands
back the string), so reading `.code ?? .message` off it yielded the literal text
`"undefined"` and silently disabled the anchor-included finding. `csAuthCode`
handles both shapes.

Ask it of any new probe: **is the instrument part of what I am measuring?**

### A comparison must exclude what legitimately differs

DNS Sightline's product is "these three resolvers disagree", which makes the
*normalisation* — not the fetching — the load-bearing part. `sgCanonicalRecord`
(`dns-sightline/analyze.ts`) throws away two things on purpose:

- **TTL.** Every recursive resolver counts its own copy down from whenever it
  happened to fetch the record, so two resolvers holding the same record report
  different numbers. A fingerprint including the TTL disagrees always.
- **Record order.** Round-robin address sets are rotated deliberately, by the
  authoritative server and again by the recursor.

Include either and the tool reports that every load-balanced domain on the
internet is inconsistent. Nothing throws; the page renders; the one signal the
tool exists for becomes noise. IPv6 goes through the shared `canonicalIp`
(`src/lib/ip.ts`, hoisted out of Chainsaw for this) for the same reason — two
spellings of one address are one address. What is deliberately *kept*: TXT case
(this function cannot tell an SPF record from a DKIM key) and the MX preference
number.

The mirror-image rule is that a difference must still read as one, so
`security:smoke` asserts **both** directions, and asserts separately that one
silent resolver among answering ones is reported as **filtering** rather than as
propagation — a policy decision at one operator, with a different fix.

A resolver that could not answer is not a third opinion, and **a SERVFAIL is not
an answer**: it is excluded from the verdict exactly like one that could not be
reached, and the diff table says what it returned. It used to be compared as an
empty answer, which is the filtering shape — so one resolver's SERVFAIL for MX
was reported as that resolver *withholding* the record.

Ask it of any new comparison: **what differs here for reasons that are not the
thing I am looking for?**

### A traversal's loop guard is per-PATH, not global

SPF's ten-lookup budget (RFC 7208 §4.6.4) counts every `include`, `a`, `mx`,
`ptr`, `exists` and `redirect` term across the *whole recursive evaluation*, not
the terms written in the record you are looking at — which is why a tidy
three-mechanism record that includes three providers routinely costs fourteen,
and why every checker that counts the top level says it is fine.

`sgAnalyzeSpf` walks the tree to count it, and needs a cycle guard to terminate.
**A single visited set shared across the walk is the wrong guard**: a domain
reached twice by two different routes is a *diamond*, not a loop, and a receiver
evaluates it — and charges for it — both times. Suppressing the second visit
under-counts exactly the diamond-shaped zones that are near the limit. A cycle
is a name appearing in its own **ancestry**; that is what `sgSpfDescend` refuses.

This was found by the assertion, not by reading: the smoke test holds the walker
to an **independent oracle** written in `security-smoke.mjs` — a dumb recursive
string scan, unbounded, unmemoised, sharing no code — over a set of fixture
zones. Same structure as `evaluateBest`/`scoreBest` and `dsEscapeReference`, and
the same reason: the output is a number nobody can eyeball. The oracle is valid
only on acyclic zones and throws otherwise, which is part of writing it.

Two bounds, not one, and each needs its own assertion: **depth** and
**breadth**. A depth ceiling alone leaves a fan-shaped include tree unbounded,
and the fixtures for both make the *resolver* refuse to answer past the ceiling
— so an unbounded walk fails with a named error instead of hanging the suite. A
test that hangs is a test whose timeout gets raised.

### A finding cites the record it rests on

`SgFinding.evidence` carries the literal record text a finding was derived from,
and `basis: 'absence'` marks the findings that are *about* a record not
existing — the only ones allowed to cite nothing. Same family as Token Bench's
`proof` label, and it learned Token Bench's lesson at the same cost: the rule is
only as good as its coverage. A mutation dressing a finding as record-based
while citing nothing **survived the first version of the assertion**, because
the one producer branch that emitted it had no fixture. So the producer list is
derived from the function *signatures* (returns `SgFinding[]`, does not take
one), and the id list is derived from the source, so a finding added later
either gets a fixture or fails the gate.

Note also what DNS Sightline refuses to claim. "Dangling" means **NXDOMAIN** at
the CNAME target, never "no address record" — a name that exists carrying only
a TXT record is an odd zone, not an unclaimed hostname, and telling somebody
their subdomain can be stolen when it cannot is the most damaging sentence this
tool could print. DMARC for a subdomain says the organizational-domain fallback
is *not computed* rather than guessing without a Public Suffix List, and the CAA
walk stops at two labels for the same reason.

### A failed lookup is not an absent record

`sgAnalyzeCaa` walks up from the FQDN to the registered domain looking for a CAA
set, and stops at the first name that has one. A walk that reaches the top and
finds nothing means *no policy governs this name, so any CA may issue* — the most
reassuring sentence DNS Sightline can print. A walk whose queries **failed** ends
with the same zero entries. Reporting the second as the first turns a resolver
timeout into a claim about somebody's zone, produced by the least evidence
possible, and no screenshot of it looks wrong.

So `SgCaaReport.incomplete` records that any lookup in the walk errored or was
refused by the query budget or the deadline (NXDOMAIN is an *answer* — the name
has no CAA because it has nothing at all — while SERVFAIL, REFUSED and a timeout
are not), `CaaVerdict.incomplete` carries it forward, and `caa-inconclusive` is
the finding that says so rather than `caa-none`.

**A policy that *was* found is not complete by construction**, which this
section used to claim. The walk stops at the first name with a CAA set, so
nothing *above* the stop point can change the answer — but the names *below* it
were passed over only because they answered "no CAA here", and one that did not
answer at all might hold a set of its own, which a CA would obey instead. So
`sub.example.com` timing out beneath a policy at `example.com` is incomplete
too: `caaVerdict` passes the flag through instead of dropping it whenever
`foundAt` is set, `caa-inconclusive` cites the parent's records without claiming
they govern, `caaRenewalOutlook` answers `unavailable` rather than "may renew" or
"refused", and the page's CAA panel says the same. The confident permit-or-forbid
sentence was the found-policy twin of turning a timeout into "no policy".

This is the same shape as `sgIsDangling` refusing to call a name unclaimed when
it merely has no address record: the damaging output is the confident sentence,
not the crash.

The rule is not CAA's alone, and it took the inspection deadline to show it: a
deadline turns every question still queued into a failed one at once. SPF read
a failed include exactly like NXDOMAIN — "no SPF record, a receiver treats that
as a permerror", plus a void lookup — and DMARC and MX read a failed lookup as no
record and no address ("mail bounces"). `sgUnanswered` (`analyze.ts`) is the one
test of whether a question got an answer, and every finding that reads an empty
record set asks it first: an unanswered include makes the SPF count a floor
(`truncated`, titled "At least N"), and an unanswered root, `_dmarc`, MX or
MX-target lookup yields `spf-inconclusive`, `dmarc-inconclusive`,
`mx-inconclusive` or `mx-unchecked` in place of the absence finding.

**One test means one**, and for a while it did not. The diff, and the choice of
which resolver's answer the analysis reads, asked a second question — "has no
`error`" — which a SERVFAIL passes, because the transport reached the resolver
and the resolver said it could not answer. So Cloudflare's SERVFAIL for MX won
over Google and Quad9 both holding the record, the targets were never resolved,
and the Mail panel, deciding absence by a *third* test, printed "No MX records."
beside `mx-inconclusive`. Now `sgPickAnswer` is the one rule for which answer is
read (the primary's when it answered, else any that did, else the primary's own
failure), the Records table and the walks read it too — a question about the
inspected name is served from the diff's pick rather than asked again — and the
report carries `mxStatus`, which the panel switches on instead of deciding for
itself. The panels live in `dns-sightline/panels.ts`, pure functions of the
report, so they can be rendered from a real inspection. `security:smoke` holds
this three ways: a TypeScript-checker scan of every module in the folder (an
answer's `error` may be read outside `sgUnanswered` only to say *why* it failed,
and `'NOERROR'` appears nowhere else — the checker, not a regex, because
`counts.error` is not an answer's), every mix of seven answer kinds across three
resolvers through the pick, the diff and the MX status, and the real `sgInspect`
over a stubbed resolver, where a lone SERVFAIL for any type must change no
finding and no panel, and no unreadable world may print a sentence the panels
only print when a record is really absent.

**Whose failure it was decides the advice.** "Re-run the inspection" is honest
after a timeout, the deadline or the budget — this tool's miss. It is wrong when
every resolver returned SERVFAIL for the question (`sgOutageOf`): independent
validating resolvers failing the same way is the zone failing, a broken DNSSEC
chain or nameservers that do not answer, and re-running changes nothing. The
unreadable-record findings say which, and when every question fails that way the
headline is `zone-servfail` rather than `resolvers-unreachable` — the resolvers
answered. `resolvers-unreachable` in turn tells the deadline apart from a
resolver this server could not reach, from `SgAnswer.stopped`, which the
transport sets on every question it cut off itself.

**A finding may lean on an absence without being *about* one**, and that is
where the rule kept escaping. `dmarc-at-apex` is record-based — it cites the
stray `v=DMARC1` at the apex — but "read by nobody" is a claim that `_dmarc`
holds nothing, so an unanswered `_dmarc` beside that apex record produced an
error-level finding beside `dmarc-inconclusive`; it now needs `_dmarc` to have
answered. The presence twin is the same mistake: `cname-hosted` said "resolves,
so this is not dangling" off three failed target lookups, and "not dangling"
needs an answer saying the name is *there* — `sgCnameTargetUnchecked` reports
`cname-unchecked` instead. And NXDOMAIN settles more than one question: it is
about the name, so an MX target whose A lookup said NXDOMAIN has no address of
either family however its AAAA lookup went (`mx-unresolvable`, not
`mx-unchecked`).

So `security:smoke` asserts the general form without a list of findings. For
every question the real inspection asks — read off the stubbed resolver's own
log — and for every name, all its questions at once, it runs the zone with that
record present, absent (an empty NOERROR, and NXDOMAIN) and unanswered (SERVFAIL
everywhere, and unreachable). A finding in exactly one of present/absent depends
on that question, so it must not appear when the question went unanswered. The
dependence is read off the module's behaviour, so a finding added later is held
to it the day it ships. What that property cannot check is the opposite
direction — a conclusion wrongly *withheld* — because one present world does not
stand for every present world; the NXDOMAIN case and the one below have direct
assertions instead.

### A conclusion that does not depend on X must not be gated on X

`caaRenewalOutlook` (`src/lib/caa.ts`) is where the two server-backed
certificate tools meet: DNS Sightline knows which CA a zone's CAA policy
**permits**, Chainsaw knows which CA actually **issued** the certificate on the
wire, and neither fact is a finding alone. Two things about the join are
load-bearing.

**The first is the order.** The obvious implementation identifies the issuer,
gives up if it cannot, and only then reads the policy — and so goes silent on
exactly the zones that are most broken. A critical CAA tag no CA understands, and
`issue ";"`, both block *every* CA; they hold whoever the issuer is, so they are
reported whoever the issuer is, and `security:smoke` asserts each of them
survives an unidentifiable issuer. Only after those does the unknown-issuer case
decline to conclude — and it does decline: the issuer-name → CAA-identifier table
is the fallible part of the module (nothing on a certificate spells `pki.goog`),
so a miss returns `null` rather than fuzzy-matching onto the nearest registry
entry and manufacturing a confident "your policy forbids your CA" out of a gap in
a table.

**The second is what the tool refuses to say.** A certificate whose issuer the
*current* policy forbids is **not** mis-issued: a CA consults CAA only in the
eight hours before it signs (RFC 8659 §3, CA/BF BR 3.2.2.8) and never again, so a
policy published afterwards says nothing about that certificate. Every message is
therefore about a *renewal that will fail*, the refusal disclaims mis-issuance in
so many words, and the assertion holds it there. The alternative accuses a
correctly-run CA of breaking the rules because somebody edited a DNS record last
Tuesday.

`spf-no-all` is the small instance of the same rule. It was suppressed whenever
the SPF walk stopped early, including at an include that got no answer — but an
include can only ever *match* a sender, so without a `redirect=` an unlisted
sender's result is neutral whatever the includes hold. `SgSpfReport.fallthrough`
now follows only what decides that result: the record's first `all` (§5.1), or,
when it has none, its `redirect=` chain to the end (§6.1). The finding is
suppressed only when a record in that chain went unread, and a redirect to a
record with `-all` is no longer reported as having no `all` at all.

A narrow `scope=caa` on `/api/tools/dns-sightline` serves Chainsaw's panel, so one
question does not pay for a 24-query resolver diff. It gets its **own** rate-limit
buckets, which is only defensible because the resource being bounded — outbound
DoH queries per minute — still comes out lower: `security:smoke` asserts
`cap x budget` for the narrow scope stays under `cap x budget` for the full one,
in both the per-client and the global dimension, so raising any one of the four
numbers fails the gate rather than a comment going stale.

### Escaping

- Anything interpolated into HTML gets escaped including `'` — attribute quoting
  is a property of the call site and will eventually change.
- Anything interpolated into a `<script>` body (JSON-LD) goes through
  `serialize()` in `src/lib/jsonld.ts`, which escapes `<` so a value containing
  `</script>` cannot break out.
- Markdown goes through `src/lib/markdown.ts` only: raw HTML is escaped and URLs
  pass `safeMarkdownUrl()`. Never hand `marked` output to `set:html` directly.
- A value a remote server chose that lands in CSS or in an `href` is held to its
  grammar first, because escaping for HTML says nothing about either. Link Peek's
  proxied image type becomes part of a `data:` URI inside CSS `url("…")`, so it
  must match `image/` plus `[a-z0-9.+-]` (`lpImageMediaType`) rather than merely
  start with `image/`; Chainsaw's CA Issuers URL comes off a stranger's
  certificate, so it is a link only when it parses as plain http(s) with no
  credentials (`csLinkableUrl`), and escaped text otherwise.
- An exception's message never goes into a response: routes answer failures
  they expect with fixed sentences, and wrap the call that could throw one they
  do not (`csInspect`) so it answers fixed `no-store` JSON too.

### Unguessable ids are a security control

Where knowing an id is the only thing protecting data (webhook bins), the id must
be long enough to resist enumeration — 24 chars minimum, and validation enforces
it server-side, not just in the UI that mints them.

### Before merging anything that touches a trust boundary

```sh
npm run security:smoke   # asserts these invariants
npm run build            # must stay green
npm run check            # must stay at 0 errors
npm run boot:check       # the built server must boot and serve / (after build)
```

Add an assertion for each new invariant, in whichever of the two homes fits: a
**code** invariant (a guard, an escape, a bound) goes in
`scripts/security-smoke.mjs`; a **deployed-posture** invariant (a Cloudflare
rule, a header the edge rewrites, whether the origin answers) goes in
`scripts/origin-check.sh`, because nothing in this repo can see it. If a fix has
no assertion, it will be undone by a later refactor that looks harmless.

Then **break the thing the assertion guards and watch it fail.** A mutation that
survives means the *assertion* is wrong, not that the mutation was a poor choice
— the temptation is to pick an easier mutation and record a pass. The poker fast
path is the worked example: a mutation that turned a split pot into a loss
survived, because the integration fixture used a spot that never chops. The fix
was a second, mirrored fixture that does.

## Key Conventions

- **Every tool renders `div[data-type="tool-page"]`** with a matching
  `data-tool="<dir-name>"`. That one root is where the shared workbench width
  (`--tool-width`), side gutter, keyboard focus ring and `<kbd>` styling come
  from (`src/styles/shared.css` + `tools-common.css`). A tool that invents its
  own root silently opts out of all four and no longer lines up with its
  neighbours — which is what `token-bench` and `flowmap` did for weeks, while
  `wallpaper-forge` pinned itself to `--max-width` (768px, the PROSE column) and
  rendered at half the width of every other tool. **A tool styles its internals,
  never its own container width.** `security:smoke` asserts both halves.
- **A tool's claims live in a module, not in the component.** Where a tool
  asserts something checkable about the world, that logic goes in a sibling
  module the component imports — `webhook-inspector/signature.ts`,
  `cron-whisperer/schedule.ts`, `cron-whisperer/crontab.ts`,
  `token-bench/diagnose.ts`, `chainsaw/analyze.ts`, `deep-shore/escape.ts`,
  `dns-sightline/analyze.ts`,
  and `src/lib/jwt.ts`
  before them — so
  `security:smoke` can run it against the real thing rather than against a
  screenshot of it. A claim buried in a DOM handler cannot be tested and will
  quietly stop being true.

  **A diagnostic proves every cause it reports, and reports none it cannot
  prove.** `token-bench/diagnose.ts` is the worked example, and it points the
  rule at the *failure* path rather than the success path. `src/lib/jwt.ts`
  answers "does this signature hold" with a boolean, and "no" is where the real
  debugging starts — so the module takes each hypothesis (the token was
  re-encoded in transit, the ECDSA signature is ASN.1 DER, the secret only works
  base64-decoded, the algorithm is wrong, the JWKS lacks that `kid`), changes
  **exactly that one input**, re-runs real Web Crypto, and only reports a cause
  it watched start verifying. Findings carry `proof: 'verified' | 'structural'`;
  the latter is a fact about the bytes that needs no key. When nothing holds it
  says so — refusing to invent a reason is the feature, because a tool whose
  product is being trustworthy about the word "verified" cannot start guessing
  the moment it fails.

  Two things the assertions had to learn the hard way. The load-bearing one is
  **negative** — given a simply-wrong key, the diagnosis must return *zero*
  proved causes — because every positive assertion still passes on a module that
  guesses enthusiastically. And a `proof` label is only as good as the narrowest
  path that can set it: `inspectTokenText` (the paste lint) holds no key and
  makes no crypto call, so it can never legitimately emit `verified`, and that
  was unasserted while the diagnosis half was covered. A mutation dressing a lint
  finding as proved survived the first merge. Assert the label on **every**
  producer, not just the one the rule was written for.

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

  `crontab.ts` is the file **grammar**; `schedule.ts` is the **semantics**. They
  are separate modules so a file-format change cannot perturb the wall-clock walk
  above. Two grammar claims that get silently re-derived otherwise: a `CRON_TZ=`
  or `TZ=` assignment applies **downward only**, so the entry *above* one is not
  in that zone — the panel renders plausibly either way, which is what makes the
  mistake invisible — and a bare `TZ=` is **flagged, not resolved**, because
  implementations disagree about whether it moves the schedule or only sets the
  job's environment. Settle that against real cronie and Debian source (and
  record the versions) before turning the flag into an answer; same shape as the
  `restricted` reading above.

- **A hot path replaced for speed keeps the slow one as an untouched reference,
  and asserts the fast one equal to it.** Poker Trainer's `evaluateBest` is
  byte-for-byte unchanged and still defines what a hand is worth; `scoreBest`
  (bitmasks in, one packed integer out) is the 600x fast path the enumerator
  actually calls, and `security:smoke` proves the two agree over **all** 2,598,960
  five-card hands rather than against remembered values. That structure is the
  whole reason a rewrite of code an on-site article quotes numbers from can land
  unattended: the equivalence assertion is what stops the two copies drifting.
  Deleting the slow one to "clean up" removes the only definition the fast one is
  checked against. Note `types.ts` still warns that a `HandRank` supports no
  numeric shortcut — that warning is about `tb` alone, and the escape is that
  `tb`'s length is fixed by `cat`, so leading the packing with `cat` keeps every
  comparison inside one category.

  **One layer up, the same rule for a memo — and a memo fails differently from a
  rewrite.** `poker-trainer/engine/equity-cache.ts` is a bounded memo whose only
  permitted behaviour is to agree with `engine/equity.ts`, and a wrong memo does
  not crash: it returns a confident percentage belonging to a *different spot*.
  Two properties are rules, not facts about that file:

  - **A memo key is derived from the arguments, never supplied alongside them.**
    Same family as "a verifier's algorithm must not come from the thing it
    verifies". `cachedEquityVsRange` keys on the combos it was handed, not on the
    range text they were parsed from, because a caller can pass a text and a
    filtered list that disagree.
  - **A canonicalisation is a claim about the function underneath, and needs the
    invariance asserted in BOTH directions** — that the uncached function really
    is order-blind, *and* that the memo exploits it. Asserting only the second
    lets a canonicalisation bug pass by being wrong consistently. Note what is
    deliberately *not* canonicalised: cards are sorted within a hand and within
    the board, but the two hands are never sorted against each other, since the
    result is index-aligned and swapping them hands hero villain's equity while
    looking entirely plausible.

  **Deep Shore is the third instance, and it shows the rule is about
  *unverifiable output*, not about speed.** A fractal renderer fails silently by
  construction: a wrong interior test paints outside points solid, a swapped
  `c`/`z₀` pair renders a Mandelbrot set inside Julia mode, and a drifting zoom
  anchor merely stops landing where you pointed — every one of those produces a
  perfectly attractive picture that is not the thing the page claims. So
  `deep-shore/escape.ts` keeps `dsEscapeReference` (the bare iteration, no
  shortcuts) beside `dsEscape` (the fast path, with the closed-form cardioid and
  period-2 bulb early-out) and `security:smoke` proves them equal over a
  34,000-point grid. Two choices follow from the same reasoning and should
  survive a refactor: orbit **periodicity detection is deliberately absent**,
  because no epsilon can be shown never to mark an outside point inside and the
  picture is the whole product; and zoom-at-the-cursor is asserted as a **fixed
  point** (the complex number under the pixel is the same number afterwards, to
  within ulps of the largest intermediate) rather than eyeballed one frame at a
  time.

  **A share link's precision is part of its correctness.** `#view=` carries the
  centre with a digit count *derived from the zoom* (`dsCoordDigits`), not a
  fixed six places — past a zoom of about 10⁵ six decimals is coarser than the
  entire viewport, so the naive version of "send someone this spot" lands them
  somewhere else while both parties believe otherwise. The assertion is
  geometric, not a chosen constant: the round-trip error must stay inside half a
  pixel of a 3840px canvas. Past 10¹² the token is lossless and the **double** is
  the floor, which is what `DS_MAX_ZOOM` states and what the readout warns about
  — the honest version of "how deep does this go". Ask it of any new permalink
  that carries a continuous coordinate: *is the encoding finer than the thing it
  is addressing?*

  **An animation between two zoom levels moves at a constant APPARENT speed**,
  and that is the fourth Deep Shore property in the same family — invisible when
  wrong, pretty either way. `deep-shore/tour.ts` interpolates `log(zoom)`
  linearly (each frame magnifies by the same factor) but must not interpolate the
  centre linearly with it: the centre's speed *across the screen* then grows with
  the zoom, so the entire pan lands in the last few frames and the destination
  whips past the viewport at the exact moment it was supposed to arrive.
  `dsPanWeight` asks for `dc/du ∝ 1/zoom(u)` instead, which integrates to
  `(1 − r^−u)/(1 − r^−1)` and front-loads the pan into the cheap, zoomed-out part
  of the dive. `security:smoke` asserts equal screen-space steps **and requires
  the naive linear version to FAIL the same check** — a property every
  implementation passes is not a test. Two more things that survived a mutation
  round and are worth not re-learning: a dive's first and last frames must be its
  first and last stops *exactly*, so the interpolator needs literal end-point
  branches (`a + (b − a)·1` is routinely a hair off `b`) — but only the `t ≥ 1`
  one, since `a + (b − a)·0` **is** exactly `a`, which makes disabling the start
  branch a mutation that correctly survives; and `dsTourViewAt`'s own `u = 1`
  shortcut hides the segment helper's end-point branch from any test that only
  asks for the last frame, which is why `dsSegmentViewAt` is exported and asked
  directly. A stop-count ceiling likewise has to be tested with a
  field-count-consistent token, or the field-count check refuses the fixture and
  the ceiling's own mutation survives.

- **A cost ceiling is written in the unit that actually costs.** The trainer's
  ceiling is `PT_MAX_RANK_WORK` (five-card reads, via `handsRanked()` in the
  engine) and no longer `PT_MAX_RUNOUTS`, which counted **boards**. Boards are
  not the cost: preflop Omaha is *fewer* boards than preflop Hold'em (1,086,008
  against 1,712,304) and twenty times dearer, because every Omaha board is the
  best of sixty five-card hands. So one ceiling was simultaneously refusing
  "what is AA against KK" — answerable in about a quarter of a second, and
  refused with the words "too many to count exactly in a browser" — and
  admitting a query that takes seven. Same shape as the one-sided-bounds trap
  documented for Type Trial: the number looked like a real bound and was
  measuring the wrong quantity. `PT_MAX_RANGE_WORK` is **not** this — it is a
  *lesson* setting that decides which street a drill is dealt on, so widening it
  changes what the drill teaches and is the owner's call, not a perf one.

- **Canvas export is shared**: `src/lib/canvas-export.ts` +
  `src/styles/canvas-export.css`. Any component with a canvas calls
  `attachCanvasExport(host, () => canvas, { name })` and gets PNG at a chosen
  scale, an animated GIF recorded from the live canvas, and — the part that was
  missing everywhere — **a preview of the file before it is written**. Do not
  hand-roll `toDataURL` + `<a download>` again: seven near-identical copies of
  exactly that is what this replaced, and none of them offered a GIF for engines
  whose whole point is that they move. Sizes and the custom-resolution validator
  (`parseCustomSize`, bounded on both edges *and* total pixels) live there too.
  An attach registers nothing on `document`: every bar joins one registry that a
  single guarded pair of swap listeners serves (`trackBar`), because a listener
  per attach outlived its page on every in-site navigation.

  There are now **three** ways in, and the third exists because live capture is
  the wrong instrument for some engines rather than a worse one. `AnimationSource`
  takes frames an engine rendered ON PURPOSE. Filming a canvas assumes it is
  already moving on its own clock; Deep Shore only redraws when you touch it and
  each of its frames can cost a second of arithmetic, so filming it wrote "a still
  frame at a video's file size" — a defect the page had to print a caveat about,
  next to the button. An engine that knows what its own animation *is* renders it
  through `options.animation` and gets the same encode/preview/save flow, and
  `liveGif: false` retires the button whose own help text would have to warn you
  off it. Two properties of that path: the frame count comes from a **measured**
  frame (`dsTourFrameCount`), because a count fixed in advance is eight seconds on
  a laptop and four minutes on a phone; and held end frames **re-use** the last
  ImageData rather than re-rendering it, since re-rendering the most expensive
  frame in a dive is the last thing a "pause at the destination" should cost. A
  render whose frames cost that much must also be **stoppable** — a second click
  on the button is a stop, not a second render.
- **The "server" badge on `/tools` is derived, and its number is asserted
  against the prose.** `SERVER_TOOLS` (`src/lib/tools.ts`) names the tools that
  need the origin to work at all — the quality bar this file sets for a new tool
  — and the hub badges them in accent. Without it, sixteen cards gave Chainsaw
  and a Base64 encoder identical visual weight while the intro claimed "four
  need a real server" and marked none of them. It lives in `src/lib/` and **not**
  in `src/config/tools.ts` for the same reason as `EMBED_TAGS` and `GAME_TAGS`:
  the `/admin` Vite middleware regenerates that config wholesale, so an export
  added there is deleted on the next save. It is not an admin-editable field
  either, because it is a fact about *code* — does a route exist that this tool
  calls. `security:smoke` asserts each slug is a `live` tool **and** that
  something in its component actually calls an `/api/` route, so a badge cannot
  outlive its server; and it reads the number word out of the intro copy and
  compares it to the set's size, so a fifth server tool cannot ship while the
  prose still says "four". Same family as the learnings rule that an article
  quoting numbers is quoting a component. The `/games` intro gets the same
  treatment for its dailies: "Three have a daily round that is the same for
  everyone" is read back, pinned to that phrase, and compared with
  `DAILY_SLUGS`.
- **Oat UI semantics**: Oat styles standard HTML tags and attributes automatically — avoid adding custom CSS classes where a semantic HTML element or attribute achieves the same result. Fixes to Oat behavior go in the fork, not in portfolio-level CSS overrides.
- **SSR everywhere**: Pages use `export const prerender = false` — required for KV reads to work at request time and for runtime middleware headers to apply. `src/pages/tools/index.astro` also uses the runtime `getTools()` accessor now; do not reintroduce a prerendered/static tools hub unless equivalent security/cache headers are configured at the hosting layer.
- **Config via `src/lib/config.ts`**: All personal data goes through the KV-aware accessors, never imported directly from `src/config/`.
- **SEO support copy is OFF by default.** Tool and game detail pages still render
  `seoContent` markdown from config when it is set, but every entry ships with it
  empty as of 2026-08-20. The owner read the generated version — "how to play X",
  "what is different in this version", "simple X strategy", "faq" on all 19 pages —
  and called it boring and not useful, which it was: it restated the collapsible
  "How to play" control sitting directly above it, and the FAQ answered questions
  nobody had. That cost ~7,500 words of indexable text, which is a real SEO
  trade-off made deliberately. The mechanism is kept, not deleted, so genuinely
  useful copy can go back without a rebuild — but generated how-to/FAQ filler is
  what this field is now known to attract, so anything added here needs to earn
  its place the way a learnings article does.
- **Decorative StarField**: Keep the home/background star canvas off tool and
  game detail pages. Lighthouse showed it spending CPU before the game became
  useful; detail pages should prioritize the interactive app. As of 2026-09-24
  it is also off the four card hubs (`/tools`, `/games`, `/projects`,
  `/learnings`) — there the cost is legibility rather than CPU: the dots land
  mid-sentence in card copy. `Base.astro` still defaults `starfield={true}`, so
  **the home hero keeps it** and that is the one place it is load-bearing for
  the site's identity; a new listing page should pass `starfield={false}`.
- **Fonts on tools/games**: Tool and game detail pages pass `loadFonts={false}` to `Head`. This avoids mobile CLS and a render-blocking third-party font request on utility pages; fallback system fonts are acceptable there.
- **ClientRouter on tools/games**: Direct tool and game detail pages pass `clientRouter={false}` to `Head` to avoid loading Astro's client navigation bundle on utility-first landing pages. Keep normal navigation working through full-page loads there.
- **No JS framework**: Oat uses WebComponents for dynamic behavior. Avoid adding React/Vue/Svelte unless absolutely necessary.
- **Heavy deps are lazy-loaded per route**: `cytoscape` (~400KB) is imported
  *inside* `connectedCallback` in `src/components/tools/flowmap/Flowmap.ts` and
  nowhere else, so no other page pays for it. Any dependency of that size gets
  the same treatment — a static import at module scope would put it in a shared
  chunk and tax every tool page. It earns its place: hand-rolling pan/zoom, force
  layout and edge routing is far more code than the dependency costs.
  `nodeDimensionsIncludeLabels: true` is **required** on every Cytoscape layout —
  it defaults to off, and without it a graph of word-labelled nodes lays out
  using the box and ignores the text, piling up overlapping in one corner.
- **Client mounting + View Transitions**: `<ClientRouter />` is enabled, so bundled `<script>` tags run only once per session and do NOT re-run on in-site (client-side) navigation. Any script that mounts a WebComponent/canvas (tool controllers, the home star canvas) must do its work inside `document.addEventListener('astro:page-load', …)`, or the component renders blank when the page is reached via nav (only a hard reload fixes it). Always test such pages by clicking an in-site link, not by reloading. The same persistence cuts the other way: the document outlives every page, so **a `document` or `window` listener added per mount must be removed with the same handler, be bound by a `signal`/`once`, or be registered once behind a module-level guard** (`if (wired) return`, as `nav-ui.ts` does). `canvas-export.ts` added an `astro:before-swap` listener on every attach and never removed it — seven engines, again on every reconnect — and Draftboard added a document click listener per connect; `security:smoke` derives the rule over every `.ts` under `src/components` and `src/lib`.
- **Adapter is the only deployment-specific code**: `astro.config.mjs` is the single swap point for infrastructure changes. No adapter-specific APIs anywhere else — abstract behind `src/lib/` if needed. Three modules are Node-only and say so in their own docblocks: `src/lib/link-peek-fetch.ts` (`node:net`), `src/lib/tls-inspect.ts` (`node:tls`, `node:crypto`) and `src/lib/dns-lookup.ts` (`node:dns`, the bounded name lookup the other two share). All three are reached only from the Link Peek and Chainsaw API routes, never from the browser bundle — asserted by the build carrying no `node:` import into any client chunk. A Workers deploy has no raw-socket TLS, so Chainsaw is the one surface that would need a different transport behind the same JSON shape.

## Design System

**All visual design is driven by CSS custom-property tokens in `src/styles/theme.css` — the single source of truth.** To re-theme the site (palette, fonts, type scale, spacing), edit those tokens only; page and component CSS should not need to change.

- **Never hardcode** a colour, font, or type size in `global.css`, `home.css`, `shared.css`, component CSS, or scoped `<style>` blocks — reference a token: `var(--color-*)`, `var(--font-*)`, `var(--text-*)`, `var(--space-*)`.
- **Load order**: `theme.css` (tokens) → `shared.css` (base elements + header, shared by both layouts) → `global.css` (content pages) / `home.css` (home hero) / component CSS.
- **A `data-type` idiom BOTH layouts render belongs in `shared.css`, not
  `global.css`** — `ToolBase.astro` does not load `global.css`. This shipped:
  `/tools/driftfield` is a hub rendered through `ToolBase` writing the same
  `[data-type="card-grid"]` markup as `/tools`, `/games`, `/projects` and
  `/blogs`, so with the rules unreachable its six live simulations rendered as a
  plain bulleted `<ul>` next to four hubs showing bordered cards, and
  `p[data-type="page-intro"]` was unstyled on all six mode pages. A
  higher-specificity Base-only *refinement* (`div[data-type="project-header"] >
  [data-type="card-title"]`) may stay in `global.css`; the **base** rule may not.
  `security:smoke` derives this from the ToolBase pages themselves rather than
  from a list, so the next shared idiom cannot repeat it — and it requires the
  base selector specifically, because a sheet holding only
  `[data-type="card-grid"] > *` styles the cards and leaves the grid container
  unstyled. That partial split is the likelier future shape of the same bug and
  it escaped the first version of the assertion.
- **…and so does a bare ELEMENT rule.** `h1` is the page title, both shells render
  exactly one, and its size lived in `global.css` — which `ToolBase` does not load.
  The guard written for the `data-type` idiom above walks `data-type` names and
  could not see an element selector, so the tools lane grew **three** dialects:
  eleven tools took 1.75rem (a size that is not a rung of the type scale) from an
  **unscoped** `div[data-type="tool-header"] h1` that existed as two byte-identical
  copies in `audio-transcriber.css` and `draftboard.css` — per-tool sheets share one
  page bundle, so either copy styled all eleven, and deleting either one, a change
  that reads as tidying a single tool, would have restyled nine tools that never
  mentioned it — while Flowmap, Token Bench, the Driftfield hub and its six mode
  pages matched no rule at all and fell to the UA default 2em. The page title is now
  the bare `h1` in `shared.css` at `--text-title`; the `tool-header` block has one
  home in `tools-common.css`, which is a *tools-lane* idiom because the single game
  that renders it (Type Trial) renders the whole tools workbench root, having once
  been a tool. `security:smoke` derives both halves from the components — which
  `data-type`s more than one tool renders, and which belong to exactly one — so a
  per-tool sheet cannot declare a lane-wide idiom, every ToolBase route must reach a
  definition of one, and **only a tool-private subtree may size an h1 at all**
  (Draftboard's `md-preview`, a heading inside a rendered markdown document, is the
  one legitimate case and it stays legitimate without being named in a list).
- **…and one level OUT, for `<body>` itself — the same trap, and the one that
  actually shipped broken.** The whole `body` rule (font, colour, page
  background, and the flex column that pins the footer to the bottom) lived in
  `global.css`, so `ToolBase` carried its **own** copy in an `is:global` block.
  Two copies of a bare element rule is the two-dialect setup by construction,
  and they had already drifted: ToolBase's set the font, colour and background
  but **not** `display: flex` / `flex-direction: column` / `min-height`, so on
  every tool, game and Driftfield route a page shorter than the viewport left
  the footer floating in the middle with a slab of bare background beneath it —
  measured at 820px on `/tools/chainsaw` in an 1800px viewport. The background
  is what hid it: body's background propagates to the canvas, so the *page* is
  the right colour either way and only the footer's position gives it away,
  which is why a colour check finds nothing. `body` now lives in `shared.css`
  with `main { flex: 1 0 auto }` beside it, and `security:smoke` **derives** the
  guarantee rather than listing files: whatever `<body>` declarations one shell
  reaches, the other must reach the same ones, neither shell may declare its own,
  and the column properties must be present at all (or the comparison passes
  vacuously on a rule that lost them from both sides).
- **…and the same rule one level down, for the CARD title.** A design audit on
  2026-09-24 measured `[data-type="card-title"]` on all five hubs that render a
  card grid and found **four** treatments: `/tools` at 20.8px/600 from its own
  `tools.css` override, `/games` and `/projects` at 16px/700 from a `global.css`
  refinement, and `/learnings` and `/tools/driftfield` at 16px/**400** —
  matching no weight rule at all, so on two of five hubs the card title was
  identical in size *and* weight to the description beneath it and the card had
  no internal hierarchy whatsoever. Same cause as the `h1` case above: the
  shared base in `shared.css` declared **less** than every consumer needed
  (`font-weight: inherit`), so each consumer patched locally and the patches
  disagreed. The base now sets the weight and **nothing else may** —
  `security:smoke` derives that by parsing every stylesheet under `src/` for a
  rule whose selector mentions `card-title` and which sets `font-size` or
  `font-weight`, so a sheet added later cannot reintroduce a dialect. A hub that
  wants a different *shape* uses a documented variant instead: `/learnings`
  passes `data-variant="list"` for one column at a 42rem measure, because a
  reading list with dates and prose summaries is not a product shelf and a 3-up
  grid left two empty tracks beside a handful of articles.
- **The whole card is its link, and that rests on two rules.** The card frame
  lights up on `:hover` and `:focus-within`, which promised an affordance only
  the ~29px title link actually had — **11%** of a 326×156 card. A stretched
  `::after` on the title link fixes it and keeps one link and one accessible
  name per card (a wrapping `<a>` would bury the heading inside a link). Two
  things about it fail silently and are asserted: the card must stay
  `position: relative`, or the absolutely-positioned `::after` escapes to the
  nearest positioned ancestor and **covers the page**, making one card's link
  swallow every click on the document; and a card's *secondary* links — 5 of
  the 11 `/projects` cards carry repo/stars/forks — must be raised with
  `position: relative`, or they stop being clickable while still looking like
  links, which no screenshot reveals. Cards with no link grow no `::after`, so
  a coming-soon Driftfield mode needs nothing special.
- **The spacing scale must have a rung for what the code actually does.** It
  stopped at `2xs`/`xs`/`page-x`/`section`, which left nothing for ordinary
  in-component spacing — so `card-grid` hardcoded `1.25rem` and `0.4rem`,
  `tools.css` `0.6rem`, and `global.css` `1rem`/`0.75rem`/`0.5rem`/`0.25rem`,
  while this file told authors to "reference `var(--space-*)`" for a scale that
  did not exist. `--space-sm`/`md`/`lg`/`xl`/`card` were added at exactly the
  values already in use, so the change was visually a no-op; the point is that
  the next edit can find the spacing by name instead of inventing a sixth value.
- **One disabled treatment**: `--opacity-disabled` in `theme.css` is the single
  "this control is dead" value. It is an opacity and not a colour on purpose —
  theme-agnostic, and it dims the border and the label together. Both lane floors
  (`src/components/tools/tools-common.css`, `src/components/games/games-common.css`)
  neutralise their own `:hover` by **re-stating the hovered properties at equal
  specificity, declared afterwards** — source order, *not* `:hover:not(:disabled)`.
  The guarded form is tidier and is wrong here: it lifts the hover rule from
  (0,2,2) to (0,3,2), which out-specifies the per-tool tab opt-outs in
  `hash-smith` / `codec-forge` / `regex-lab` and repaints a border they
  deliberately lack. `tools-common.css` promises its specificity is
  byte-identical, and that promise is load-bearing. `security:smoke` asserts the
  token, the source order, and that the disabled rule resets every property the
  shared hover sets — the last one derived from the hover block, so a hover
  property added later is caught automatically. Note a tool joining the shared
  button chrome now adds its selector to **three** lists in `tools-common.css`
  (toolbar, button, `button:disabled`), not two.
- **Contrast is asserted, not remembered.** It used to be a number somebody
  measured once in a session nobody can rerun, and every palette edit since was
  a bet that the measurement still held. `security:smoke` now parses **both**
  palettes out of `theme.css` and holds every real text pairing to the WCAG AA
  floor (4.5:1), so a token nudge that drops body text under it fails the gate
  instead of shipping. The pairing list is written down (it is a claim about how
  the tokens are *used*, which CSS cannot tell you) but the values are derived,
  and the one pairing that is a fact about code — `--color-bg` as ink on an
  accent-filled button — is read back out of `canvas-export.css`.

  Two things to know before touching the palette. There is **less headroom than
  it looks**: the tightest pairings are `--color-muted` on `--color-surface` at
  4.76:1 (dark) and `--color-success` on `--color-surface` at 4.74:1 (light), so
  a "slightly softer grey" is roughly one step from failing.

  `--color-border` stays out of the **text** pairing list — it is a hairline,
  never ink — but "not a text colour" had been read as "unmeasured", and it sat
  at 1.25:1 (dark) / 1.23:1 (light). Every listing card on the site is bounded
  by it, so all five card hubs read as floating text rather than as cards; the
  owner's word for the result was "ugly", and this was most of it. It is now
  `#394255` / `#b7b7b7` — **2.0:1** — with its own floor asserted in both
  themes beside the text sweep.

  The floor is 2:1 and **not** the 3:1 WCAG 1.4.11 asks for non-text UI
  boundaries, which is a deliberate partial and the reason it is written down:
  3:1 needs `#515d71` / `#949494`, which stops being a hairline and boxes every
  card on the site. 1.4.11 governs a boundary *required* to identify a control,
  and here the card's own content identifies it — the border is reinforcement.
  What the assertion prevents is the regression that actually happened: a
  border quietly tuned back down to invisible. The **hover** border is
  `--color-muted`, which clears 3:1 and is already covered by the text sweep.
- **A programmatic focus target still needs a visible ring.** `main` carries
  `tabindex="-1"` because the skip link jumps to it, and a blanket
  `main:focus { outline: none }` sat below the `:focus-visible` rule that is the
  **only** thing drawing a ring anywhere on the site — so activating the skip
  link moved focus with no perceivable result and the link was decorative
  (WCAG 2.4.7). The narrow form, `main:focus:not(:focus-visible)`, silences the
  mouse case and lets the keyboard case through; if an engine declines to match
  `:focus-visible` on a programmatic focus the outcome is the old behaviour, so
  it cannot regress. `security:smoke` asserts the blanket form is gone and that
  both shells still wire the link to a focusable `#main-content`.
- **An `<svg>` at `width: 100%` scales its own TEXT, so it needs a legibility
  floor rather than a breakpoint.** A viewBox scales as one object: the Diagram
  Atlas is 680 user units wide, so at a 375px viewport it fitted perfectly and
  rendered every label at about **5px**. Nothing overflowed, `scrollWidth`
  equalled the viewport, and a screenshot taken at desktop width looked correct —
  the defect existed only on the device, which is why it was found by measuring
  the rendered size (computed font-size × the SVG's own scale factor) and not by
  looking. A diagram is also not a paragraph: there is no arrangement of four
  lifelines that is still a sequence diagram at 300px. So the label size is what
  gets held — `min-width` on the SVG plus `overflow-x: auto` on its container —
  and the reader swipes, which is the trade `learnings/[slug].astro` already
  makes for a wide table. A scrollable container also takes `tabindex="0"`, or
  the content past the edge is unreachable without a pointer — DNS Sightline's
  two tables and Link Peek's tag table shipped without it; their wrappers are now
  named regions (`role="region"` + `aria-label`), ringed by the site's own
  `:focus-visible`, and asserted. `security:smoke`
  parses the floor out of the stylesheet, because a lone `min-width` reads like a
  stray constraint to the next person tidying the file.
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

### Hiding a section: `sections.blogs`

Blogs ships hidden as of 2026-08-20 — the owner asked for it off the public site
without retiring the URLs. `isBlogsPublic()` (`src/lib/config.ts`) is the one
predicate, and it reads `site.sections.blogs`, a flag that already existed and
which nothing read. Now the nav and footer (through `navLinks`), the sitemap, the
hub's `ItemList` and the `noindex` on both blog routes all read it, for the same
reason the Indexing section below gives: a section delisted in one signal and
advertised in another is worse than either alone.

Hidden, not deleted — both routes still answer 200, so links already in the wild
keep working while the pages leave search. Flip the flag to restore it; make the
routes 404 to retire it for good.

Three things this cost, all worth knowing before hiding the next section:

- **Gate the signal, never delete it.** The sitemap's `/blogs` hub entry was
  *removed* by that commit rather than wrapped in the predicate, so the sentence
  above ("the sitemap … all read it") was true only of the per-post URLs. Flipping
  the flag back restored the nav link, the `ItemList` and both routes' `index,
  follow` — and left the hub as the one section landing page of five the sitemap
  could never list again, which is the same contradiction the Indexing rule below
  forbids, pointing the other way. A one-way door is not a flag. The tell was
  visible in the diff: `latestPostDate` was left computed and unused while its twin
  `latestLearningDate` still fed `/learnings`. Note the guard that existed asserted
  only the hidden direction (`!body.includes('/blogs')`), which a permanent deletion
  satisfies perfectly — a reversible switch has to be asserted in **both** states,
  and `security:smoke` now derives that from `navLinks()`: every internal hub the nav
  advertises must have a `<loc>` in the sitemap for that flag state.

- `Site['sections']` had to be **widened** to `Record<string, boolean>`. The
  config object is `as const`, so each flag was its own literal type and
  `sections.blogs === true` read as comparing `false` to `true` — `astro check`
  correctly called it unreachable. A flag whose type says it can never change is
  not a flag. Same false-precision fix `nav` and `theme` already carry there.
- The sitemap's **XML-escaping assertion used blog posts as its test data**, so
  gating blogs off left that guard asserting nothing while still passing. Its
  fixture now turns the section back on explicitly, and asserts separately that
  the shipped (hidden) flag emits no `/blogs` URL. Hiding a section must not
  quietly retire the test that keeps the sitemap parseable — check what a
  fixture depends on before you remove its data source.

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
  && content.trim()`, under a slug that is not retired. The second condition is
  the one the flag cannot express — an entry saved from /admin with the box
  ticked and the body still empty would otherwise be sitemapped and carry a card
  while its page rendered nothing. The third is `RETIRED_LEARNINGS`: an article
  that was live on `main` and is withdrawn keeps its URL as a **301** (to the hub
  unless a replacement answers the same question), because a 404 costs every link
  already out there its reader. The route answers the redirect before it reads
  config, and since a redirect is not a page the predicate refuses the slug —
  so no sitemap, hub or card can list it even if an entry under it is saved
  again. Add a slug here when you delete an article that ever reached `main`;
  `security:smoke` refuses a slug that is both retired and in the config.
- **Driftfield** — `isDriftfieldPublic()` in `src/lib/driftfield.ts`: the
  `driftfield` entry in the tools config is `status === 'live'`. The hub, every
  `/tools/driftfield/<mode>` route, the sitemap and `scripts/generate-og.mjs`
  all read it. Before it there was no one predicate and the three consumers gave
  two answers: the hub 404'd and the sitemap dropped the modes unless `live`,
  but the mode route **read no config at all**, so a withdrawn Driftfield still
  answered 200 with `index, follow`, a `summary_large_image` card and
  WebApplication JSON-LD — above a breadcrumb pointing at a hub serving 404.
  Deliberately stricter than `/tools/[slug]`, where `wip` renders publicly
  behind a noindex; the Driftfield hub has always 404'd on anything but `live`.

A project entry is the one place an on-site URL is **hand-written** rather than
derived from a slug, so `security:smoke` holds any `apanjwani0.com` link in
`src/config/projects.ts` to an enumerated set of path shapes (`/`,
`/tools/<slug>`, `/games/<slug>`) and checks the slug against that kind's
predicate. Adding a shape is a deliberate edit to `projectPathShapes`, made once
something asserts that page is indexable — not a fall-through.

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
Driftfield mode is still a game. It also requires every `EMBED_TAGS` entry to
reach a `mountGame()` dispatch branch **and** a stylesheet in
`games-embed.css`. That loop read `GAME_TAGS` until 2026-09-25, which is the
narrow list — so the six Driftfield engines and every article-only figure were
reaching the guard and being skipped by it, while its own comment claimed to
cover "any learnings article that embeds it". Both halves fail silently (no
dispatch renders a blank element, a missing stylesheet an unstyled one), and an
embed-only component is the worst case, because an article is the ONLY route
that mounts it.

A cross-link between two kinds is **derived, never stored twice**. Driftfield
modes used to carry a `learning` slug naming the article about that engine, which
is a second copy of a fact the article already states in its own `embed` — and
every one of them 404'd the day those articles were deleted, on the hub and on
six mode pages. `learningsAboutEmbed()` (`src/lib/learnings.ts`) reverses the
lookup instead: an article that is gone has no entry to find, and an unpublished
one fails the predicate in one place rather than in each caller. Game, tool and
Driftfield pages all read it. `security:smoke` asserts the reverse lookup only
ever yields published articles.

Note `RelatedLinks` derives its heading `id` from the heading text — a product
page renders it twice (siblings, plus the article), and two navs sharing one id
is invalid HTML that also makes `aria-labelledby` ambiguous.

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

A second round on 2026-09-25, on the diagrams article: *"it's just very bad,
it's not something I would write myself… you don't have to write some
philosophical shit."* The first round fixed the prose; it did not fix the
**shape**. What shipped was a 1,071-word essay whose actual subject — what
these diagrams *are*, what a class diagram is, which picture is the HLD one —
was compressed into a single table under three pages of cognitive-science
citation. The format section at the top of the voice doc is the response and it
supersedes the old length rule: **350–550 words of prose, a visual beat every
one to three lines, and a read time on the page.** The rewrite came out at 420
words and eight figures. A study may appear where it settles a question the
reader is already asking; it may not be the reason the article exists.

Three mechanisms exist because of that feedback:

- **`{{embed}}` places the figure, and `{{embed:view}}` places the others.** The
  route used to pin the component between the summary and the prose, which is
  the worst available position — the reader meets a simulation before being told
  what it is, and the article then has to open by pointing at "the thing above".
  That single constraint is most of why all seven read identically.
  `splitOnEmbeds()` (src/lib/markdown.ts) splits the source on every `{{embed}}`
  line and returns the article as segments; no marker means the figure goes
  after the prose, so a typo costs the position and never the simulation.

  A bare `{{embed}}` is the full component. `{{embed:some-view}}` is the same
  component **pinned** to one of its views with the picker dropped, which is
  what lets one article carry a figure every few lines — the format the owner
  asked for on 2026-09-25 (see `docs/plans/learnings-voice.md`), where the prose
  is connective tissue between figures rather than the other way round. An
  unknown view name falls back to the full picker instead of throwing, so
  `security:smoke` checks every shipped marker against the component's own view
  list: a mistyped pin renders something that looks deliberate and is not.

  **Many figures bring a cost one figure did not.** The diagrams article mounts
  eight copies of the atlas, five of which animate on a timer, and the component
  autoplayed on connect — so the first version started five `setInterval`s at
  once and ran them forever on a page whose job is to be read. That is the same
  objection that took the StarField off tool and game pages, reached from the
  other side. Playback now follows an `IntersectionObserver` and a deliberate
  pause is remembered, both asserted at the source, because a leaked timer is
  invisible in every screenshot.

- **Read time is derived, never stored.** `readingTime()` (src/lib/learnings.ts)
  counts the prose and adds a flat 8s per figure — an article in this format is
  mostly figures, and counting only the words between them reports "1 min" for a
  page that takes four. Same rule as `learningsAboutEmbed()`: a number typed
  into config is a second copy of a fact the content already states, and it goes
  stale on the next edit with nothing to catch it.
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

  "Disconnects on the first hit" is only a bound for a component that produces
  one, and three things make it hold for all of them. A figure that writes no
  chrome at all is declared in `EMBED_NO_CHROME` (`src/lib/embeds.ts`) and gets no
  observer — the Diagram Atlas never writes an `<h1>`, so the diagrams article ran
  eight observers that never disconnected, re-scanning on every beat of its
  animated figures; `security:smoke` derives that set from the components' own
  sources in both directions. Each container gets ONE observer, because both
  routes mount at script evaluation *and* on `astro:page-load`, which fires for
  the first page too — the second observer of a pair never sees a hit once its
  twin has stripped the chrome. And whatever is still waiting is released at the
  next `astro:before-swap`.

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

**…and the number is in more fields than the body.** The Diagram Atlas article
says the system is "drawn seven ways" in its `content`, in its `summary` (which
is the hub card AND the share card) and in its `metaDescription` (the search
snippet). The first version of that assertion read `content` alone, and a
mutation of the body alone is what revealed the other two were unguarded — an
eighth notation could have shipped with the page correct and the card and the
search result both saying seven. The field list is now derived from the entry
rather than written down, so a count repeated into a new field is covered
without anybody remembering this paragraph. Same shape as the blogs flag: a fact
corrected in one signal and stale in another is worse than either alone.

**A figure may also be the article's whole argument, in which case it needs a
component of its own.** `/learnings/which-diagram-to-draw` argues that an
arrow can mean seven different things and the question you are asking picks the
notation — and that is unprovable in prose, because the reader has to watch one
unchanged scenario become seven pictures and find each one blind to what the
last one showed. So `diagram-atlas` (`src/components/games/diagram-atlas/`) is the first
embed that is neither a game nor a Driftfield mode: an article figure, and the
reason `EMBED_TAGS` is the wider list. It is also the first that is **not** a
canvas toy — seven notations drawn as inline SVG, because the labels have to be
selectable and reachable by a screen reader.

Three of its properties are rules rather than details of that file:

- **The claims live in `atlas.ts`, not in the component.** Each view states what
  a node is, what its arrow means *as a verb*, and which question the picture
  cannot answer — the article's whole teaching payload. `security:smoke` holds
  every view to a full legend, with the field list derived by comparing view
  shapes, so a view added later cannot ship a blank panel row.
- **A structural diagram must not animate.** The class and ER views carry zero
  beats deliberately: a schema is true at every instant, so walking a token
  along one would be a lie about the notation dressed as a feature — and it is
  precisely the misreading of UML the article names. The component hides its
  transport instead. Asserted in **both** directions, because a behavioural view
  that silently stopped moving is the mirror failure.
- **Every beat must light an element that exists.** A mistyped id renders a
  flawless diagram in which one beat highlights nothing, and no screenshot of
  any single frame shows it. Token positions are held inside the viewBox for the
  same reason, and a second token is allowed only in the activity view, since
  two tokens are a claim of concurrency that the other six notations cannot
  make.

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
`security:smoke` + `poker:check` + `boot:check`) and never pushes or touches
`main`. `check` is in that list because `build` alone does not catch what it
catches, and `boot:check` because neither of them starts the server — see Build
/ Test / Run. It boots the *built* entry point on loopback and stops it again, so
it needs no dev server and runs unattended. The older daily
`daily-portfolio-improvement` cowork task targets the same working tree — run
one or the other, not both.

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
