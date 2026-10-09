# Operations

Build and test notes, caching, analytics, share cards, AI crawlers.

## Build / test notes

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

## Agent tools

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
