# Status

Session pickup. Rewritten each session, not appended. Last updated 25 Oct 2026.

## Branches

- `origin/main` is live at PR #43's merge (`6345c23`). `develop` carries the
  /tools hub and tool-page work in [docs/plans/tools-week.md](docs/plans/tools-week.md),
  open as PR #44 (develop → main), CI green. Not merged: it waits for the
  owner's approval.
- Agent pushes use the `GITHUB_PAT` credential over git; the GitHub MCP
  integration is read-only, and Copilot code review is not enabled on the repo.

## Owner's pending moves

1. Review and approve PR #44, then merge it to `main`.
2. Purge the Cloudflare cache after the deploy and run `npm run origin:check`
   (`docs/plans/release-followups.md`).
3. Close the origin lock (AGENTS.md → *Origin exposure*).
4. Decide the deferred items in tools-week.md: the "recently used" row, the
   Link Peek image cap.

## Next

1. ⌘K palette (`/search.json` plus the UI), per tools-week.md.
2. [plans/review-response.md](docs/plans/review-response.md), PR-1: the Core
   Web Vitals beacon (re-check: 12f9a4c fixed the cold-load case on 10 Oct).
3. Trim each tool's `keywords` as it is next touched.
