# Status

Session pickup. Rewritten each session, not appended. Last updated 17 Nov 2026.

## Branches

- **`develop` is ahead of `main` (17 Nov), waiting for Aman's release PR:** #65 (10 more Cron Whisperer presets,
  25 in all; the Learnings article `unable-to-get-local-issuer-certificate` with Chainsaw as its figure, the first
  tool used as a figure; Chainsaw and the article now say curl fails "on Linux", since stock macOS curl and iOS
  fetch a missing intermediate) plus the 15 Nov pickup commit. Approved community posts wait for this release:
  `~/Projects/docs/sites/outreach/` (Show HN links the Chainsaw page).
- `origin/main` is live at PR #64's merge (`1bed06f`).
- 15 Nov, late: the image runs as uid 1001, the owner of `/opt/portfolio/data` (#63). From 11 Aug it ran as
  uid 100 and no data file ever saved in production (visits, analytics, both leaderboards, the interest
  counter, webhook bins); verified saving after the deploy. Cloudflare now rate-limits 50 requests / 10 s per IP.
- 15 Nov shipped: search fixes (#58, #59: Epoch Wizard title and how-to, plain how-tos on six global-search
  pages, hand-picked Related rows asserted in security-smoke, `/experience` 301 to `/`, the phone header
  offset scoped to the home hero) and security fixes (#60, #61: `/_image` returns 404, IPv6 rate keys by /64
  plus shared caps on every writing route, synchronous origin-lock compare, c-ares lookups for visitor names,
  a webhook sweep timer, env-file and `sha-` tag deploys, Astro 7.4.12). Review page:
  `~/Projects/docs/security/review-2026-11-15-sites.html`.
- The www → apex Redirect Rule is back in Cloudflare (15 Nov), so `origin:check` should be green again.

## Owner's pending moves

Tracked in `~/Projects/STATUS.md` → Your moves → "Sites: search, security, agency (15 Nov)": Prod
environment limited to `main`, Dependabot alerts and secret scanning, the origin lock, request indexing for
the rewritten pages, Bing Webmaster Tools (now in `~/Projects/docs/sites/metrics/api-setup.md`), and describing the Cloudflare Worker in front of the site. Also
still open from 3 Nov: `resumeUrl` in `src/config/site.json`, and the optional Markdown cache bypass rule.

## Parked with the `/projects` work (Aman, 15 Nov)

- `/opt/portfolio/data/github-stats.json` is root-owned, so the GitHub stats cache cannot refresh (frozen
  since 10 Aug; `writeCache` ignores the error). Fix when `/projects` comes back:
  `ssh portfolio 'sudo chown 1001:1001 /opt/portfolio/data/github-stats.json'`.

## Open from 3 Nov (not rechecked 15 Nov)

- **Webhook Inspector (plan §4A)**: all six items shipped (SSE stream with a
  poll fallback, replay through Link Peek's guard, copy-as-curl of the captured
  request, configurable response, bins persisted to `data/webhook-bins.json`,
  ndjson export, six more signature schemes). **Not done:** the browser check
  (SSE arrival, copy text, configured response, ndjson download, screenshots
  at 375 and 1280), and the mutation tests on `scripts/smoke/webhook.mjs`. Do
  both first next session. Paddle, Mailgun, Discord and SendGrid fixtures were
  built from the documented algorithms, not from captured deliveries, and show
  no freshness verdict. 1xx answers are refused (the runtime only sends
  200–599). The new routes (`/stream`, `/requests/{id}/replay`,
  `PUT /response`) are **not yet in `/openapi.json`**
  (`src/lib/openapi.ts`, mirrored into `API_LIMITS`; the smoke compares the
  numbers with the routes' `createRateLimiter` calls, so change both
  together) nor in the MCP tool list.
- **Not built from the plan**: Playwright smoke in CI and the vitest split of
  `security-smoke.mjs` (§3B); name claim, yesterday's board, Quintle aggregate
  (§4E); the three error-search articles (§2J, owner rewrites Claude's
  drafts); the theme toggle (UI-refresh item B: `initThemeUI` is still an
  empty stub).
- **Poker Trainer follow-ups**: multiway spots land on the river almost always
  (three-way work on the turn exceeds the exact budget); the server placeholder
  in `games/[slug].astro` shifts 0.01–0.02 when the felt mounts; poker is the
  heaviest page (about 320 KB wire) and `games-common.css` is nearly unused
  there (one line in `EMBED_STYLES` to drop it, after checking the three tabs).
- **Behaviour changes to know**: `?host=`/`?name=` on the diagnostics only
  prefill now; `#h=` runs; a reload re-runs a check because the address bar
  holds the permalink. Link Peek fetches through `node:http(s)` with a pinned
  lookup, not `fetch`. Old poker `?s=` permalinks for biased spots deal a
  different hero hand than before the bias (D-11).
- **Search (15 Nov)**: 53 clicks and 1.4k impressions in 16 months, average position 46, one external link.
  Topics by impressions: epoch (pos 81), falling sand (70), link preview (59), poker (24, nearest page one),
  webhook (85). Results of the 15 Nov fixes show in early Dec. PageSpeed mobile 15 Nov: home 98, CLS 0.011.

## Next

1. Dependabot: close #53 (superseded by the 7.4.12 bump); review #55 (`marked` 18 touches `markdown.ts`).
2. Finish the Webhook Inspector items left open above, then add the new
   routes to `src/lib/openapi.ts` and the MCP tools.
3. Playwright smoke in CI (CLS on five pages, nonce parity on the 404, 375 px
   sweep).
4. The three articles (§2J), drafted figure-first under `learnings-voice.md`.
