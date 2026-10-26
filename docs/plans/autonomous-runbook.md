# Autonomous runbook

How an agent session runs on this repo without the owner in the loop, and the
ordered queue it works from. Written 26 Oct 2026, after PR #44. A session
reads this file, STATUS.md and AGENTS.md, takes the first open item it may do
alone, and stops at the first one that needs the owner.

This replaces the role rotation in [autonomous-pass.md](autonomous-pass.md)
for session-driven runs (that file still describes the disabled 2-hourly
scheduled pass). Item specs live in [review-response.md](review-response.md);
this file orders them and adds what the review sweeps found.

## Every run, in order

1. **Pre-flight.**
   - `git fetch origin`.
   - If `origin/main` has a merge `develop` lacks, merge it into `develop`
     first (AGENTS.md → Branches). The merge-back changes no files.
   - `npm ci` in a fresh container. Node must be at least 22.23.4 (`engines`).
2. **Pick.** Take the first unchecked item in *Queue* that is not marked
   **Owner**. An item that adds a dependency, a config field or a route
   (review-response §9.3) gets a design note and stops; see *Stop and ask*.
3. **Work.** Each item gets its own branch, `auto/<item>`, cut from
   `origin/develop`.
   - Assertions first, in `scripts/tools-hub-smoke.mjs` (hub, pages, copy) or
     `scripts/security-smoke.mjs` (trust boundaries). Break each guarded thing
     and watch the assertion fail.
   - The gate before every commit: `check`, `build`, `security:smoke`,
     `poker:check`, `boot:check`. Commit messages are one short line with no
     attribution.
4. **Verify in a browser.**
   - `scripts/page-sweep.mjs` against the built server covers status, layout
     shift, overflow, console errors, h1 and the title and description budgets.
   - Click through every changed route from a hub (in-site navigation,
     never a reload).
5. **Ship to develop.**
   - Push the branch and open a PR into `develop`. Wait for CI to pass.
   - Post a review pass on the PR as a comment: findings, what was fixed, what
     is left.
   - Then merge the item PR into `develop`. The owner allows the agent to write
     to `develop`; `main` is never the agent's.
6. **Ship to main.**
   - Open the develop → main PR, or refresh it if one is open. Its description
     gets one section per item.
   - Never merge it: that is the owner's approval. The target is two
     develop → main PRs a day, each merged before the next opens.
7. **Record.** Tick the item here, rewrite STATUS.md, and note anything new as
   an issue rather than scope creep.

### Pushing

The GitHub MCP integration is read-only. Writes go through the `GITHUB_PAT`
credential. The sandbox swaps its placeholder value for the real token on
outbound requests. Pass it to git as a one-off credential helper, never in a
URL or in git config:

```sh
H='!f() { echo username=x-access-token; echo "password=$GITHUB_PAT"; }; f'
git -c credential.helper= -c "credential.helper=$H" push origin <branch>
```

Use the same token for PRs, comments and reviews through the REST API
(`Authorization: Bearer $GITHUB_PAT`). Copilot code review is not enabled on
the repo: a request returns 201 and assigns nobody.

### Stop and ask (never decide alone)

- Anything marked **Owner** below.
- A new dependency, config field or route: write the design note (files, data
  shapes, assertions and their mutations) as the PR description, and stop.
- Copy in the owner's own voice: the bio, the home hero, article prose.
  Article edits go up as a PR for his read.
- Merging to `main`, changing CI or deploy secrets, and anything AGENTS.md
  calls a trust boundary without a matching assertion.

## Queue

Ordered. Sizes are rough (S/M/L). Items from review-response keep its numbers.

1. [ ] **Post-deploy check of PR #44** (S). After the owner purges the
   Cloudflare cache, check live:
   - `/tools` shows the sections, `/terms` loads, `/og/hub-tools.png` is 200;
   - a mistyped `/tools/jsontidy` suggests JSON Tidy;
   - llms.txt starts "Software Engineer.".

   Then run `npm run origin:check`.
2. [ ] **Search budgets across the site** (S, autonomous). The 26 Oct sweep
   found:
   - `/games/poker-trainer`: title 71, description 220;
   - `/games/2048`: title 67, description 172;
   - `/games/quintle`: title 65, description 211;
   - the two Driftfield modes: descriptions 161 and 162;
   - nine cron preset titles: 61–70.

   This is the games half of review-response PR-2's meta-description item.
   Extend the tools-hub-smoke budget assertion to games, Driftfield modes and
   presets. Article titles and descriptions go to the owner (voice).
3. [ ] **PR-8 head cleanup** (S, autonomous: owner decision D7). Drop
   `<meta name="keywords">` and the JSON-LD `keywords`. The config field stays
   for palette search words. Its smoke check replaces the hub's ≤12-term cap.
4. [ ] **PR-2 tool and game copy pass** (M, autonomous). Done already: the
   tools' meta descriptions (PR #44) and `CHROME_PATH`. The rest of its table
   stands. Card regeneration follows its rules; the generator now runs on
   Linux with the vendored fonts.
5. [ ] **Games review, five dimensions, one game per item** (M each,
   autonomous). Same method as the tools pass in
   [tools-week.md](tools-week.md): the sweep, real play on both viewports, and
   fixes in the same PR, with larger findings as issues.
   - Order: Poker Trainer, Bytele, Type Trial, Hue Hunt, 2048, Deep Shore,
     Maze Weaver.
   - Carry the open owner notes from STATUS.md: Poker Trainer "too
     complicated", and one-off game button styles.
6. [ ] **PR-1 Core Web Vitals beacon** (M). Adds the `web-vitals`
   dependency, so write the design note and stop. Phase 3's two weeks of data
   start at its deploy.
7. [ ] **PR-4b DNS Sightline and Chainsaw correctness** (M). Design note
   first (review-response marks it Opus).
8. [ ] **⌘K palette** (M). Adds the `/search.json` route, so design note
   first. The interfaces exist (`fuzzy.ts`, `buildSiteIndex`).
9. [ ] **PR-3 article hedges** (S). Prepared autonomously; **Owner** reads
   for voice before merge.
10. [ ] **Learnings hub and articles review** (M). Five dimensions, as for
    the tools.

### Owner (decisions waiting)

- A "recently used" row on /tools: layout shift versus a head-bootstrap change
  (tools-week.md).
- Link Peek's 400 KB image cap (memory on the 1 GB host).
- `learningsAboutEmbed` in `tools/[slug].astro`: give tools articles, or
  delete the call (ideas.md).
- Poker Trainer redesign of 8 Oct: does it answer "too complicated"?
- The internet article's title; the home hero flicker fix (STATUS.md, 9 Oct).
- Enabling Copilot code review, if wanted.
