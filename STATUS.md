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

- If the 2-hourly pass is ever re-enabled, repoint its prompt at `docs/plans/autonomous-pass.md` (it still names `.claude/scheduled/`, now retired).

## Next

1. [plans/review-response.md](docs/plans/review-response.md), PR-1 first: the Core Web Vitals beacon never fires (`web-vitals` is not a dependency yet, checked 9 Oct 2026).
2. The owner's open items, in his order of 20 Aug 2026, with their state in the code on 9 Oct:
   - The Poker Trainer is "too complicated" and needs a UX redesign. A redesign shipped on 8 Oct (casino felt table, exact math cards); ask whether it answers the complaint.
   - Games buttons: type-trial, hue-hunt and poker-trainer carried one-off button styles against the lane floor in `games-common.css`. The 5 Oct style sweep may have changed this; check before touching.
   - `learnings` against `reads`: [ideas.md](docs/ideas.md).
   - The hero flicker (30 Sep) is fixed ([home-hero.md](docs/home-hero.md)); the owner has not confirmed it.
   - The internet article, `/learnings/how-the-internet-works`, is built and awaits his review. The title may change: his message was cut off at "how the internet works and or".
   - Learnings hub thumbnails are UI refresh item F, paused ([design-system.md](docs/design-system.md)).

