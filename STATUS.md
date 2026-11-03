# Status

Session pickup. Rewritten each session, not appended. Last updated 3 Nov 2026.

## Branches

- `origin/main` is live at PR #44's merge (`fcb17d2`). `develop` and `main`
  are level.
- `claude/jolly-maxwell-kqmw95` is PR #45 (→ `develop`): the whole of
  [docs/plans/polish-2026-11.md](docs/plans/polish-2026-11.md) built on one
  branch after the owner took its eleven decisions (plan §8). Plan §7 is the
  per-row status. Each row's assertions live in `scripts/smoke/<area>.mjs`.
- Agent pushes use the `GITHUB_PAT` credential over git; the GitHub MCP
  integration is read-only, and Copilot code review is not enabled on the repo.

## Owner's pending moves

1. Review PR #45. It is large by design (one branch, the owner's call); read
   it row by row against plan §7. Merge to `develop`, then `main` as usual.
2. After the deploy: purge the Cloudflare cache, run `npm run origin:check`.
   Two of its new checks fail until you act: add a Cloudflare Redirect Rule
   from `www` to the apex (the check's message names the settings), and the
   IndexNow key file answers only once deployed.
3. Verify the site in Bing Webmaster Tools (the IndexNow key doubles as
   proof) and import from Search Console.
4. Set `resumeUrl` in `src/config/site.json` if you want the résumé link; the
   email is already there (D-1).
5. Close the origin lock (AGENTS.md → *Origin exposure*).
6. Export the Search Console "Not found (404)" URL list (3 pages); 301s
   follow if successors exist. Do not click "Validate fix" on the redirect,
   noindex and canonical rows: they fail by design.
7. Optional: a Cloudflare Cache Rule that bypasses the cache when `Accept`
   contains `text/markdown`, so article Markdown negotiation works at the edge
   (docs/operations.md). The `.md` links work without it.

## Open at the end of the session

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
- **Search Console (3 Nov screenshot)**: 0 "Discovered, not indexed" (was 14),
  2 "Crawled, not indexed". PageSpeed on the trainer: all four vitals green,
  Speed Index amber (3.8 s) from the game chunk arriving late; a modulepreload
  per embed shipped, worth about 150 ms on a latency-bound link and little on a
  bandwidth-bound one. The remaining lever there is bytes.

## Next

1. Finish the Webhook Inspector items left open above, then add the new
   routes to `src/lib/openapi.ts` and the MCP tools.
2. Playwright smoke in CI (CLS on five pages, nonce parity on the 404, 375 px
   sweep).
3. The three articles (§2J), drafted figure-first under `learnings-voice.md`.
