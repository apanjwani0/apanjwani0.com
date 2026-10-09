# The 2-hourly autonomous pass

`portfolio-2h-pass` (its prompt is at
`~/.claude/scheduled-tasks/portfolio-2h-pass/SKILL.md`; **disabled**, last run
2026-08-20) runs 3–4 roles in parallel every two hours, with every fourth run
an audit. The roster and the selection rule are below. The prompt still names
the old roster and ledger paths under `.claude/scheduled/`; point it here before
re-enabling it.

- Roles rotate by a PASS counter in the ledger, never by judgement or clock
  slot: both starve the roles whose neglect a screenshot doesn't show.
- The selection rule has one copy, in the roster. The prompt must not restate
  it.
- The ledger is read top-200 lines only: an entry is capped at 12 lines, and
  deferrals live in one in-place `## Open deferrals` section.

It commits to `develop` behind the full gate and never pushes or touches
`main`. It can't start the dev server, so a route that needs an in-site
click-through goes in the ledger's `## Verification queue`, drained with
`/browser-debug` in a session with the owner. Run only one autonomous
portfolio task at a time.

## Why roles and not a backlog queue

The old daily run took the top item off one backlog and did it. That works when
the site has one dimension. It now has six that move independently — an article
being written does not help a tool feel better to use, and neither shows up in
search. A single queue serialises work that has no reason to be serial, and
whichever dimension is not at the top of the queue silently rots.

So: every run picks several roles, runs them concurrently, and each role owns its
own small backlog.

## Selection rule (deterministic — no role may starve)

Let `PASS` be **this run's number: the PASS number in the newest ledger entry, plus
one.** If the newest entry carries no PASS number (the first run after this rule
changed), start at `PASS = 0`.

- **`PASS % 4 == 3` → AUDIT RUN.** Roles: `audit` + `consistency`, nothing else.
  Three build passes, then one pass that checks the last three did not break or
  contradict anything. Ratio matters: audit less often and regressions ship;
  audit more often and nothing gets built.
- **Otherwise → BUILD RUN.** Let `BUILD = PASS - floor(PASS / 4)`, the number of
  build runs before this one. Take 3 roles from the build roster below, starting
  at index `((BUILD + 1) % 2) * 3` and wrapping. That alternates the two halves of
  the roster, which "pick what seems most urgent" never does — urgency is judged
  by whoever is looking, and the boring roles (SEO, projects) lose every time.
  The `+ 1` puts the first build run on `seo-reach`/`projects`/`design-ux`,
  because those are the three every earlier rule short-changed.

Over twelve passes that lands 3 audits and a 5/4 build split in favour of
`seo-reach`/`projects`/`design-ux`. Enumerate a full cycle before changing it again.

**Count runs that actually happened, not clock slots.** Two superseded versions of
this rule, and why each failed:

1. `(SLOT * 3) % 6` where `SLOT = floor(hour / 2)`. That expression only ever
   yields 0 or 3, and the audit slots (3, 7, 11) are exactly the ones that would
   have yielded 3 — so across a day it picked roles 0,1,2 six times and roles
   3,4,5 three times, starving `seo-reach`, `projects` and `design-ux` to half the
   runs while claiming in this very paragraph that it could not.
2. The same alternation, but with `BUILD` still derived from `SLOT`. Correct only
   if every slot fires. This runs on a laptop under `23 */2 * * *`: it sleeps, it
   travels across time zones, it is closed overnight. A missed slot is never made
   up, and the slots that go missing are correlated with the hour rather than
   random — so an owner who shuts the lid at midnight permanently starves whichever
   roles map to the small hours. Deriving the rotation from a counter the ledger
   carries makes a missed run cost one run, not one role.

Record the PASS number and the roles chosen in the ledger — the next run reads its
own PASS from there, so an entry without one stalls the rotation.

**An aborted run consumes no PASS.** A run that exits without doing any role work —
the tree was dirty on entry, the gate could not be made green for anything — writes
a ledger entry headed `ABORTED — no PASS consumed` and carries **no** PASS number, so
the next run reads the newest *numbered* entry and repeats the slot that was missed.
Reading such an entry as "no PASS number, therefore start at 0" would reset the
rotation, and numbering it would silently skip a slot: the tree is dirty because
another task is mid-run, which is uncorrelated with which roles were due, so a slot
lost that way would land on the same starved half the counter exists to protect.

## Build roster (index order is load-bearing — do not reorder casually)

0. **`learnings-research`** — find and select topics, then write. Owns
   `src/config/learnings.ts`. A topic qualifies only if the site can do something
   a newsletter cannot: run the thing being described. Research the facts to
   primary sources; a date or a name that cannot be checked does not ship. Voice
   rules are in `docs/plans/learnings-voice.md` and are not optional — the first
   seven articles were rewritten precisely because they were same-shaped and
   sourceless.

1. **`tools`** — deepen existing tools. Owns `src/components/tools/**` and
   `src/config/tools.ts`. Default to making one tool richer rather than adding
   another; AGENTS.md → "The bar for a new tool or game" is binding and rules
   out another formatter/converter/encoder outright. Every tool must render the
   shared `div[data-type="tool-page"]` root (asserted in `security:smoke`).

2. **`games`** — deepen existing games. Owns `src/components/games/**` and
   `src/config/games.ts`. Same bar: a daily seed, a server-validated board or a
   replay permalink beats a new clone. Poker Trainer and Type Trial are the two
   worked examples of what "deep" means here.

3. **`seo-reach`** — the one role with an external scoreboard. Owns titles, meta
   descriptions, internal linking, sitemap and structured data (`seoContent` stays
   empty: see AGENTS.md, SEO support copy is off).
   **Never invent demand.** The 2026-08-18 keyword audit measured difficulty and
   not volume, and a six-route expansion was justified on reasoning that turned
   out to be wrong. If a
   decision needs search volume, say so and stop rather than guessing.

4. **`projects`** — owns `src/config/projects.ts`. Everything shipped to
   production should be sellable here, described by what it does for someone
   else. Forks of other people's software are not projects.

5. **`design-ux`** — owns `src/styles/**` and cross-page visual consistency.
   Tokens only, per AGENTS.md. This role exists because "every tool should be fun
   and rich to interact with" is nobody's job in a feature-shaped roster, so it
   never happens.

## Audit roster

- **`audit`** — reproduce before fixing. Run the full gate, click through routes
  that changed in the last ~6 hours via in-site navigation (the `astro:page-load`
  mounting bug only appears there, never on a reload), read the console, and fix
  what is actually broken. A finding written down and not fixed is worth nothing.

- **`consistency`** — the cross-cutting check no single feature role will do:
  do the tools still line up with each other, do the games, do the article pages;
  is a new invariant asserted somewhere; is AGENTS.md still true. This role is
  why `security:smoke` now asserts the shared tool root — that drifted for weeks
  because every individual tool worked fine on its own page.

## File ownership and the shared-path protocol

Roles run concurrently, so "who owns this file" is what keeps them from colliding.
Each build role's owned paths are listed with it above. These are the paths no role
owns, and the rule for each — added because real runs kept landing work in them:

- **`src/lib/**` — shared, no owner.** Most of the substantial work of the last few
  runs landed here (`canvas-export.ts`, `hue-hunt-daily.ts`, `hue-hunt-leaderboard.ts`,
  `interest.ts`, `flash.ts`) precisely because a component-scoped role could not do
  the correct thing without a module both client and server import. A role **may**
  add a new file here when its change genuinely needs one, and must name it in the
  ledger. A role may **not** edit an existing `src/lib/**` file another role's change
  depends on in the same run — defer it.
- **`src/pages/api/**` — shared, no owner.** Same rule, plus: a new route is a trust
  boundary, so it does not land without a matching assertion in
  `scripts/security-smoke.mjs` and a re-read of the AGENTS.md security section.
- **`scripts/security-smoke.mjs` — append-only, every role.** Every role adds its own
  assertions; nobody rewrites another's. Append a clearly-labelled block at the end
  rather than editing in place, and let the orchestrator merge. After merging, the
  orchestrator mutation-tests **one assertion per role** — break the guarded thing,
  confirm the assertion fires, restore — so a merge cannot silently neuter a block.
- **`AGENTS.md`, `docs/`, `package.json`, `astro.config.mjs` — orchestrator only.** A role
  that wants a change here describes it; the orchestrator makes it once, after the
  roles are done. Three roles editing AGENTS.md concurrently is a guaranteed conflict.
- **The ledger and this file — orchestrator only.**

If two roles genuinely need the same owned file, the **lower roster index wins** and
the other defers its change to `## Open deferrals` in the ledger.

## Ledger

Newest entry first; **read at most the top 200 lines per run**. The first
ledger grew to 484 KB (its successor to 47 KB) and was read whole on every run,
which spent most of a context window on history nobody needed. The 20 Aug 2026
ledger was retired; a re-enabled pass starts a fresh one. Its last numbered
entry was PASS 4, so the next run is PASS 5 (`5 % 4 == 1`: a BUILD run on
`seo-reach`, `projects`, `design-ux`).

Format per run, **hard cap 12 lines**, deferrals excluded (they live in their
own section and are edited in place, never restated inside a run entry):

```
## <ISO datetime> — PASS <n> — <BUILD|AUDIT>
Roles: <selected>
- <role>: <what changed, one line, file paths>
Gate: build <ok|fail> · check <n errors> · smoke <ok|fail> · poker <ok|fail>
Commit: <sha or "none — reason">
```

Two in-place sections sit above the entries. `## Verification queue`: routes an
unattended run changed and could not click (it cannot start the dev server), one
line each, drained with the browser check in `docs/operations.md`. `## Open
deferrals`: work deliberately left undone.

An unattended run gates the staged tree, not the working tree: a second
scheduled task shares this directory and its half-finished edits would otherwise
make the gate pass or fail for the wrong reasons (`git write-tree` +
`git commit-tree` + a detached `git worktree add`, with `cp -al node_modules`:
a symlink makes Astro resolve a nonsense nested path).
