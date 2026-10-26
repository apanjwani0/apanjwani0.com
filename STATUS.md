# Status

Session pickup. Rewritten each session, not appended. Last updated 26 Oct 2026.

## Branches

- `origin/main` is PR #44's merge (`fcb17d2`), deploying 26 Oct 2026.
  `develop` has merged it back.
- Autonomous sessions follow [docs/plans/autonomous-runbook.md](docs/plans/autonomous-runbook.md):
  item branches → PR into `develop` → develop → main PR for the owner. Pushes
  use the `GITHUB_PAT` credential; the GitHub MCP integration is read-only.

## Owner's pending moves

1. Purge the Cloudflare cache after the PR #44 deploy and run
   `npm run origin:check`.
2. Close the origin lock (AGENTS.md → *Origin exposure*).
3. The decisions listed under *Owner* in the runbook.

## Next

The runbook's queue, from item 1: the post-deploy check, then the search
budgets the 26 Oct sweep found on games, Driftfield modes and cron presets.
