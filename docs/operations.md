# Operations

Build and test notes, caching, analytics, share cards, AI crawlers, deploy, the browser check and the agent tools.

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
- For UI/route changes, also run `/browser-debug` against the dev server (the checklist is under *Browser check* below).
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

## Browser check

Run it against the dev server (`npm run dev`, http://localhost:4321) after any layout, component, page or `src/config/` change. Claude Code has `/browser-debug [url] [what to check]` for it; any agent can follow the same list.

1. Every nav route answers 200 (`navLinks()` in `src/lib/config.ts` is the list). A hidden section (`/projects`, `/blogs`) still answers 200 and carries `noindex`.
2. The HTML is semantic: one `h1`, `nav`, `main`; a tool page renders `div[data-type="tool-page"]`.
3. Oat's base files (`/oat.min.css`, `/oat.min.js`) and the page's own stylesheets are linked; a tool's `tools/<slug>/<slug>.css` appears on that tool's page only.
4. No console errors and no broken references (avatar, fonts, share card).
5. Reach each changed route by clicking an in-site link, never a reload. Bundled scripts run once per session, so a mounting bug shows only on in-site navigation.

## Agent tools

- **`/browser-debug [url] [what to check]`** (Claude Code, `.claude/commands/`): a subagent that runs the *Browser check* above against the dev server. Use after any layout, component or page change.
- **`/antigravity <task>`** (Claude Code, `.claude/commands/`): hands small, well-scoped edits to a faster subagent. Keep architecture, multi-file changes, debugging and `astro.config.mjs` with the main agent.
- **`frontent-design`** (skill, `.agents/skills/frontent-design/`, linked from `.claude/skills/`): UI generation under the portfolio override, which is in [design-system.md](design-system.md).
