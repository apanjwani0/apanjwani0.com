# Status

Session pickup. Rewritten each session, not appended. Last updated 2 Nov 2026.

## Branches

- `origin/main` is live at PR #44's merge (`fcb17d2`): the /tools hub and
  tool-page work in [docs/plans/tools-week.md](docs/plans/tools-week.md).
  `develop` and `main` are level.
- `claude/jolly-maxwell-kqmw95` carries only the new plan,
  [docs/plans/polish-2026-11.md](docs/plans/polish-2026-11.md), and this file.
- Agent pushes use the `GITHUB_PAT` credential over git; the GitHub MCP
  integration is read-only, and Copilot code review is not enabled on the repo.

## Owner's pending moves

1. Purge the Cloudflare cache for the PR #44 deploy and run
   `npm run origin:check` (`docs/plans/release-followups.md`).
2. Close the origin lock (AGENTS.md → *Origin exposure*).
3. Answer the ten decisions in polish-2026-11.md §8 (contact, purge token,
   FAQ copy, beacon, palette, service worker, boards, MCP, `.claude/`,
   Flash Cricket).
4. Still open from tools-week.md: the "recently used" row, the Link Peek
   image cap.

## Next

The order is polish-2026-11.md §7. First three PRs, none needing a decision:

1. Link Peek address pinning (§4B, a security gap Chainsaw already closed).
2. Entity graph and the `updated` field (§2A, §2B).
3. IndexNow key, script and deploy step (§2C), once the purge token exists.
