# Status

Session pickup. Rewritten each session, not appended. Last updated 9 Oct 2026.

## Branches

- `origin/main` is live; its last merge is PR #39 (8 Oct 2026). `develop` is 3
  commits ahead of it: a merge of `origin/main` and two poker-trainer and games
  perf commits. Local `main` is stale; compare against `origin/main`. The branch
  rules are in AGENTS.md → Branches.

## Carried from 5 Oct 2026 (not re-verified)

- **Owner's pending moves:**
  1. Purge the Cloudflare cache and run the post-deploy checks in
     `docs/plans/release-followups.md` after each deploy since #27.
  2. Close the origin lock (see *Origin exposure*). Until then port 80 on the
     origin is reachable around Cloudflare.
- **Awaiting the owner's review:** the control kit exists and Flowmap is rebuilt
  on it; no other tool moves to the kit until then.
- The 2-hourly autonomous pass is disabled (last run 2026-08-20).

## Owner decisions pending

- Confirm or drop the rule "NEVER build a new top-level page or route" (AGENTS.md → SCOPE CONSTRAINT). It was carried over from the retired daily-run backlog (4 Jul 2026), not restated since.
- If the 2-hourly pass is ever re-enabled, repoint its prompt at `docs/plans/autonomous-pass.md` (it still names `.claude/scheduled/`, now retired).
