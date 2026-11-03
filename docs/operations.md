# Operations

Build and test notes, caching, analytics, share cards, AI crawlers, deploy and the browser check.

## Build / test notes

- `check` is stricter than `build`: Astro's build parser tolerates things
  `astro check` can't parse. Two known traps build green: a `{/* … */}`
  comment between a component's attributes (hides every type error in that file),
  and `const f = (a) => ({…})` followed by a bare `{` block (phantom parse
  errors).
- `boot:check` starts the built server with the Dockerfile's own command on a
  loopback port and requires a full 200 page from `/`. It then sends a same-origin write the way Cloudflare delivers it (needs `security.allowedDomains`) and a cross-site one (must be 403). Neither `build` nor
  `check` starts the server, so a dependency mismatch can ship an origin that
  crashes on boot. It deletes `ASTRO_NODE_LOGGING` from the child's env on
  purpose: that variable skips the boot path that crashes on a mismatch. The Dockerfile's final
  stage runs it too (after `npm ci --omit=dev` and the `USER` switch), so a
  server that can't start fails the image build and the old container keeps
  serving. A local `node_modules` older than the lockfile fails it; run
  `npm ci`.
- `security:smoke` runs `scripts/security-smoke.mjs` and then
  `scripts/tools-hub-smoke.mjs` (the /tools hub, shells, site copy, /terms,
  the 404's suggestions, tool-page SEO budgets). New hub or tool-page
  assertions go in the second file.
- CI (`.github/workflows/ci.yml`) runs the whole gate on every PR and every
  push to `develop`. `.github/pull_request_template.md` mirrors that gate as a
  checklist, plus the docs, `/terms`, share-card and assertion rules.
  Dependabot (`.github/dependabot.yml`) opens weekly PRs into `develop`: one
  for all minor and patch npm bumps, one per major, and one for GitHub Actions.
- `scripts/page-sweep.mjs` loads every sitemap URL (or given paths) at laptop
  and phone size and reports status, layout shift, overflow, console errors,
  h1 count and title/description budgets. It needs a browser, so it is not in
  the gate; install Playwright with `npm i --no-save playwright`.
- For UI/route changes, also run the *Browser check* below against the dev server.
- Deploys: a push to `main` builds the Docker image, restarts the container
  from the self-hosted runner, then fetches `/` inside it. That probe runs
  after the old container stops, which is why `boot:check` runs first.
- `astro check` reports `adminNotFound` in `src/pages/admin.astro` as unused (ts6133). It is used: line 20 is `if (!isAdminRequestAllowed()) return adminNotFound()`, the guard that 404s `/admin` in production, and `astro check` cannot see frontmatter usage. Deleting it on the hint's word removes a security control.

## Caching & Performance

HTML is SSR, so Cloudflare doesn't cache it by default. Two layers fix that
without touching the build:

1. **A Cloudflare Cache Rule** (dashboard) makes HTML cache-eligible except
   `/api/*`, `/admin` and requests carrying the `__admin_session` cookie.
2. **`Cache-Control` from `src/middleware.ts`**: public `GET` 200s get
   `public, max-age=0, s-maxage=600, stale-while-revalidate=86400`; admin and
   logged-in responses get `no-store`; non-API 404s get
   `public, max-age=0, s-maxage=300`, because scanners make most origin
   traffic; any 5xx gets `no-store`, so the edge never keeps a fault. The
   sitemap, `/llms.txt`, `/llms-full.txt` and `/feed.xml` get `s-maxage=3600`.

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
   on every page: real-user LCP, CLS, INP, TTFB and FCP from the bundled
   `web-vitals` package (never a CDN: the CSP allows `'self'`). One record per
   page view, sent once through `sendBeacon` when the page is hidden or the
   visitor navigates on, never on a timer. A hard load is `nav: 'hard'`; a
   ClientRouter navigation is `nav: 'soft'` and carries `routeMs` and any INP
   that happened while it was on screen. `vp` is `narrow` (at most 640 CSS px)
   or `wide`, from `innerWidth`, never the user agent. Do Not Track or Global
   Privacy Control sends nothing. The server (`src/lib/analytics.ts`) counts each
   value into fixed histogram buckets (edges in `VITAL_EDGES`; LCP and FCP
   1200/2500/4000 ms, CLS 0.1/0.25, INP 200/500 ms, TTFB 800/1800 ms, route
   300/1000 ms) per day x path bucket x nav x vp, so a p75 is read from the
   buckets (the dev-only admin tab shows it as a range). Path buckets: a tool or
   game slug from the config, a fixed section list, `/blogs/*`, `/learnings/*`,
   else `other`. A stored row has exactly the fields in
   `ANALYTICS_STORED_FIELDS`; the local file is capped per day and in bytes.
   Rate-limited to 60/min per client. Stored in `SITE_ANALYTICS`, else
   `analytics:*` keys in `SITE_CONFIG`, else `data/analytics.json`. Rows from
   before the histograms (averages, no `nav`) are ignored and age out.
2. **Server counter** (`src/lib/visits.ts`, called from the middleware): every
   HTML render that reaches the origin. These are cache misses, not page views.
   It records date, path, country (`cf-ipcountry`), referrer **host** and a bot
   count, buffered in memory and flushed to `data/visits.json` every 30 s.
   Never write per request.

Both keep 90 days. The rules (counts only, no consent banner, Cloudflare Web
Analytics auto-injection off) are in AGENTS.md → *Analytics*.

```sh
ssh <host> 'cat /opt/portfolio/data/visits.json' | python3 -m json.tool | head -50
```

## Offline

`public/sw.js` (registered once after load by `src/lib/sw-register.ts`, never in
dev) exists so the installed app (`display: standalone`) opens to a sentence
instead of a browser error when offline. Two rules: it handles page navigations
only, and it never caches HTML. At install it keeps `/offline.html` (inline
CSS, so it needs nothing else) and serves it only when the network request for
a page fails. Bump `CACHE` in `sw.js` when `offline.html` changes; activate
deletes every other cache by name. The scope is `/` from the root, so no
`Service-Worker-Allowed` header is needed. `scripts/smoke/vitals.mjs` asserts
both rules.

## Share cards (Open Graph)

Every `live` tool, playable game and published article has a 1200×630 card at
`public/og/<tools|games|learnings>-<slug>.png`, and each hub (/tools, /games,
/learnings) has `public/og/hub-<kind>.png` (`ogHubCardFile`). `src/lib/og.ts` derives the path from kind
and slug; there is no `image` config field, because a second source could only
disagree. A card goes only on an indexable page (see *Indexing*). Pages without
one fall back to the avatar and a `summary` Twitter card.

- **Run `npm run og` after adding a tool or game or changing a title or
  description, and commit the PNGs.**
- `scripts/generate-og.mjs` rasterises with local headless Chrome, never in CI
  or production. An on-demand render route would add native-binary
  dependencies and per-request CPU on a 1 GB box.
  - Off macOS, point `CHROME_PATH` at any Chromium that takes `--screenshot`
    (a Playwright install's `chrome-headless-shell` works). As root it adds
    `--no-sandbox`.
  - `npm run og -- hub- tools-chainsaw` renders only the cards whose file
    starts with an argument, so one new card does not re-commit all of them.
  - Cards use the vendored fonts in `src/assets/fonts`; the script needs no
    network.
- Product pages and the `/tools` and `/games` hubs use a keyword-first
  `seoTitle` with no owner name; section pages (`/projects`, `/blogs`) keep the
  name suffix. Authorship lives in the JSON-LD `author` and the footer.

## AI crawlers

The owner's choice (2026-09-28): search and AI answers yes, training no.
`public/robots.txt` states it in a `Content-Signal` line, which is a request,
and disallows the crawlers that only collect training data: GPTBot, ClaudeBot,
CCBot, Applebot-Extended, Meta-ExternalAgent, Bytespider, anthropic-ai,
cohere-ai and Diffbot.

- **Never disallow a search or user-fetch agent** (OAI-SearchBot, ChatGPT-User,
  Claude-SearchBot, Claude-User): that takes the site out of AI answers.
- Google-Extended stays allowed, because Google ties Gemini's training and its
  answers to that one token.
- `/llms.txt` (`src/pages/llms.txt.ts`) is the site index as Markdown, asserted
  to list exactly the sitemap's pages. Crawlers barely read it, so it is a
  courtesy to agents, not an SEO lever. The 16 tools stand alone; the
  Driftfield modes and Cron Whisperer presets sit under `## Optional`, and an
  `## API` section names the four server endpoints.
- `/llms-full.txt` is the same headings with the text itself: each live tool's
  `intro` and each published article's Markdown (figure markers become one
  plain sentence). It is derived from config, so its size is fixed;
  `security:smoke` holds it under 400 KB.
- `/feed.xml` is an Atom feed of the published learnings only, from the same
  `isPublishedLearning` predicate as the sitemap; `updated` falls back to `date`.
- `/learnings/<slug>.md` is an article's Markdown source. The HTML address
  answers with it when `Accept` ranks `text/markdown` above `text/html`
  (`Vary: Accept`, and `no-store`, because the edge keys on the URL and not on
  `Accept`). Article HTML carries `Link: </learnings/<slug>.md>; rel="alternate"`.
  Behind Cloudflare the negotiation rarely fires: the edge serves its cached
  HTML for the URL whatever `Accept` says, so the `.md` address is the one to
  rely on. A Cache Rule that bypasses the cache when `Accept` contains
  `text/markdown` would make it work (optional, the owner's call).
- `Last-Modified` on the sitemap, `/llms.txt`, `/llms-full.txt` and `/feed.xml`
  is the newest published article's `updated ?? date`, and is left off when no
  article has a real date. A trailing-slash GET or HEAD 301s to the slashless
  URL (not `/api/`, whose POSTs a redirect would turn into GETs).
- These routes store nothing, so `/terms` is unchanged.

### IndexNow

Bing, Yandex, Seznam and Naver take pushed URLs through IndexNow (Google does
not take part), and ChatGPT's web search leans on Bing's index. The key is the
32-hex name of `public/<key>.txt`, whose content is the same string. It is
public by design: it only proves the submitter controls the site, so it lives
in git and no secret is involved. After each deploy, the `indexnow` job in
`deploy.yml` fetches the live `/sitemap.xml`, compares it with the copy the
last successful run kept as the `sitemap-last` artifact, and submits only URLs
that are new or whose `<lastmod>` moved (the first run, or one after the 90-day
artifact expiry, submits all of them). The new copy is uploaded only after the
submission succeeds. `npm run indexnow -- <url>…` (or URLs on stdin; add
`--dry-run` to print the request) submits by hand, at most 1000 per request.
There is no cache purge step: a Cloudflare API token would be a new secret, and
the owner declined one, so pages reach visitors when the edge TTL lapses.
Owner action: verify the site in Bing Webmaster Tools.

## Deploy

A push to `main` runs `.github/workflows/deploy.yml`: the `build` job (GitHub-hosted) builds a `linux/amd64` image and pushes it to `ghcr.io/<owner>/portfolio`; the `deploy` job runs on a self-hosted runner on the production box, pulls the image, replaces the `portfolio` container and fetches `/` inside it. amd64 only: an arm64 build under QEMU took over 20 minutes. Both jobs declare `environment: Prod`; the secrets they read are `GHCR_TOKEN` and, optionally, `ORIGIN_SHARED_SECRET` (see AGENTS.md → Origin exposure). `ADMIN_SECRET` is deliberately not passed.

The host is an OCI Always Free Ubuntu VM with 1 GB of RAM behind Cloudflare. The container is published as `-p 80:4321`, capped at `--memory=768m`, with `/opt/portfolio/data` mounted at `/app/data` (analytics counts and the daily leaderboards, which survive deploys) and `/opt/portfolio/avatar.webp` mounted over the client build, because `public/avatar.*` is gitignored and not in the image.

- **Why a self-hosted runner:** OCI blocks inbound SSH from GitHub Actions' IPs. The runner connects outbound on 443, so no firewall change is needed. In Settings → Actions → General, require approval for outside collaborators so a fork PR cannot run on it.
- **HTTPS** (as set up in Aug 2026): Cloudflare proxies both the apex and `www`, with SSL/TLS mode Flexible (visitor to Cloudflare over HTTPS, Cloudflare to origin over plain HTTP: the origin has no certificate and port 443 is closed). Full mode would fail for that reason. Cloudflare sends `x-forwarded-proto: https`, so `Secure` cookies work.
- **Cloudflare dashboard state** (Cache Rule, Browser Cache TTL, Transform Rule, SSL mode) is not in git. `npm run origin:check` asserts what a stranger sees. The Cache Rule's edge TTL was first set to "Override origin" for 1 hour on 21 Jun 2026; switch it to "Respect origin TTL" to honour the headers in *Caching & Performance*. Check the dashboard for the current value.
- **Other targets** (a plain Docker host, a VPS through a registry, a Raspberry Pi, Cloudflare Workers): README.md → Deploy.

Bootstrapping a fresh VM, in order:

1. Add a swap file (`fallocate -l 2G /swapfile`, `mkswap`, `swapon`, an `/etc/fstab` line): the free tier has 1 GB and thrashes without it.
2. Install Docker with `curl -fsSL https://get.docker.com | sudo sh` (the manual apt repo setup is fragile on OCI Ubuntu) and add the user to the `docker` group.
3. Open 22, 80 and 443 in UFW **and** in the OCI Security List (subnet → Security → Default Security List → ingress rules, TCP from `0.0.0.0/0`).
4. Delete OCI's default iptables REJECT rule, which blocks everything except 22: `sudo iptables -L INPUT -n --line-numbers`, `sudo iptables -D INPUT <line>`, then `sudo apt-get install -y iptables-persistent` and `sudo netfilter-persistent save`.
5. `mkdir -p /opt/portfolio/data`, own it, and copy `avatar.webp` to `/opt/portfolio/`.
6. Install the Actions runner as a service (repo → Settings → Actions → Runners → New self-hosted runner; `./svc.sh install && ./svc.sh start`).

Commands on the box: `docker ps`, `docker logs -f portfolio`, `docker restart portfolio`, `df -h && free -h`, and `sudo ./svc.sh status` in the runner's directory.

| Symptom | Cause | Fix |
|---|---|---|
| Port 80 unreachable, curl hangs | OCI's default iptables REJECT rule | delete it (step 4) |
| Port 80 still unreachable after that | the OCI Security List lacks TCP 80/443 | add the ingress rules (step 3) |
| Actions SSH timeout | OCI blocks inbound SSH from runner IPs | use the self-hosted runner |
| Build takes 20+ minutes | cross-arch build under QEMU | build `linux/amd64` only |
| Avatar not loading | `public/avatar.*` is gitignored, so it is not in the image | copy it to `/opt/portfolio/avatar.webp` |
| Container exits at once | the app crashed on start | `docker logs portfolio` |
| GHCR pull fails | not authenticated | re-check the `GHCR_TOKEN` secret |
| Every request 404s after setting `ORIGIN_SHARED_SECRET` | no matching Transform Rule | fix the rule value, not the secret |

## Scheduled checks

`.github/workflows/origin-check.yml` runs `npm run origin:check` against production every day at 03:17 UTC, and on demand from the Actions tab (Run workflow). It needs no secrets: the script makes only requests a stranger could make. Look at the "Origin check" workflow under the repo's Actions tab; a failed run turns the job red and GitHub emails the owner, with no other notification. Each failing line names its cause: a non-200 home page means the site is down (after an origin lock, fix the Transform Rule value, not the secret); a `cache-control` without `max-age=0` or `s-maxage` means Cloudflare's Browser Cache TTL or Cache Rule drifted; a 200 from the origin IP means Cloudflare is bypassable; a Cloudflare beacon in the page means Web Analytics auto-injection is back on; a missing 301 from `www` means the Redirect Rule is gone. A run that fails only on a timeout or a challenge page is a runner-side hiccup: re-run it once before acting.

## Browser check

Run it against the dev server (`npm run dev`, http://localhost:4321) after any layout, component, page or `src/config/` change. It is manual: drive Chromium with Playwright (`require('playwright')`; off macOS, `executablePath` can point at any installed Chromium) and follow the list.

1. Every nav route answers 200 (`navLinks()` in `src/lib/config.ts` is the list). A hidden section (`/projects`, `/blogs`) still answers 200 and carries `noindex`.
2. The HTML is semantic: one `h1`, `nav`, `main`; a tool page renders `div[data-type="tool-page"]`.
3. Oat's base files (`/oat.min.css`, `/oat.min.js`) and the page's own stylesheets are linked; a tool's `tools/<slug>/<slug>.css` appears on that tool's page only.
4. No console errors and no broken references (avatar, fonts, share card).
5. Reach each changed route by clicking an in-site link, never a reload. Bundled scripts run once per session, so a mounting bug shows only on in-site navigation.
