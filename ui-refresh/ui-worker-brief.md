# UI refresh workers B–G: shared brief

Read all of this before you start. Your launch prompt names your item letter, worktree, branch, port and the base commit (`<BASE>`: item A's head, which already sits on the latest `develop`).

## Where you work

- **Your worktree:** `/home/user/ui-<x>` (branch `feat/ui-<x>`, cut from `<BASE>`). `npm ci` is already done.
- **Work ONLY in your worktree.** Never touch `/home/user/apanjwani0.com`, `/home/user/ui-refresh`, any other `ui-*` worktree, `/home/user/sightline-fix` or `/home/user/verify-develop`.
- **Commit to your branch only.** Don't push, open PRs, switch branches, rebase, or touch GitHub.
- **Scratch files:** `/tmp/claude-0/-home-user-apanjwani0-com/da34734d-9a00-5acf-86dc-099682bd9b1b/scratchpad/item-<x>/`
- **Paths in the plan:** it names files as `/home/user/apanjwani0.com/<path>`. For you, that is `/home/user/ui-<x>/<path>`.
- **Server port:** B 4521, C 4522, D 4523, E 4524, F 4525, G 4526. Kill only processes you started. Other node servers on this box belong to other workers.

## Read first

1. **`AGENTS.md` in your worktree, in full.** It is binding: token-only styling, the two shells, one inline script, the CSP nonce, the `astro check` vs build parser traps, and derived `security:smoke` assertions with mutation checks.
2. **The plan:** `/tmp/claude-0/-home-user-apanjwani0-com/da34734d-9a00-5acf-86dc-099682bd9b1b/scratchpad/ui-plan.md`. Read these parts:
   - §2, shared interfaces. Item A shipped them, and they are the contract.
   - Your item in §3.
   - "Visual checks, every item".
   - §4, risks.
3. **What item A actually shipped.** Run `git log --stat origin/develop..<BASE>`, then read:
   - `src/lib/{theme,kit,site-index,fuzzy,shortcuts,site-ui}.ts`;
   - the feature stubs (`theme-ui`, `find-ui`, `kit-ui`, `motion`);
   - `Head.astro`'s boot script;
   - the tokens in `theme.css`;
   - the anchor regions in `scripts/security-smoke.mjs` and the section stubs in `AGENTS.md` labelled for your item.

   Build on those exact names and don't rename or fork them. If the contract lacks something you need, add the smallest extension in a module you own, and say so in your report.
4. **Item A's review notes:** `.../scratchpad/item-a/REVIEW.md`, if present. It lists where A deviated from the plan.

## Owner decisions (don't re-open)

- **Look:** refine the current dark look. This is not a rebrand.
- **Motion:** tasteful motion is allowed, with `prefers-reduced-motion` as the off switch.
- **Features:**
  - a ⌘K palette;
  - a light/dark/system theme switch;
  - card thumbnails;
  - a smart 404 and a `?` shortcut sheet;
  - a toolkit: star a tool into a "My kit" shelf, one `/tools/kit?t=…` link, and a bookmarks-file export. Only `live` tools can be starred.
- **Home:** the owner's photo goes. A new interactive hero is being chosen separately. Item E removes the Avatar and builds the seam for the hero; nobody builds the hero itself now.

## You are one of six parallel workers

Items B–G are built at the same time from the same base, and merged in the order G → F → E → D → C → B. So:

- **Stay inside your item's "Owns" list.** Its "Must not touch" list is binding. If you need a change somewhere else, don't make it; describe it in your report.
- **Shared files** (`shared.css`, `AGENTS.md`, `security-smoke.mjs`): edit only inside the region or section stub labelled for your item. That keeps the merges trivial.
- **Hooks another item renders** (for example E's palette trigger in the nav, or F's card stars): bind to the §2 DOM contract. To test, inject that markup from your Playwright script instead of editing the other item's file.

## Gate (before every commit)

Run these before every commit:

```
npm run build
npm run check          # 0 errors; mind the parser traps in AGENTS.md
npm run security:smoke
npm run poker:check
npm run boot:check
```

Every new assertion gets its mutation (the one the plan names in brackets):
1. Break the guarded code.
2. Watch the assertion fail.
3. Restore the code.
4. Put the failing message in your report.

A mutation that survives means the assertion is wrong. Fix the assertion; don't pick an easier mutation.

## Visual check

Follow the plan's "Visual checks, every item":

- **Tooling:** the global Playwright (`import { chromium } from '<npm root -g>/playwright/index.mjs'`). Chromium is preinstalled; never run `playwright install`.
- **Server:** the built server on your port (`HOST=127.0.0.1 PORT=<port> node dist/server/entry.mjs`).
- **Viewports:** 1440×900 and 390×844.
- **Themes:** dark and light. Set light via localStorage `theme:v1`, then also toggle it live where your item makes that possible.
- **Reduced motion:** run once with it emulated.
- **Navigation:** click in-site links (hub → detail → breadcrumb → back); don't reload.
- **Keyboard:** one keyboard-only pass.
- **Screenshots:** save them in your scratch dir.

Zero console errors, CSP violations and pageerrors are part of the gate for UI work.

## Commits

- **Size:** a few logical commits.
- **Message style:** follow the repo: a lowercase `feat:` / `fix:` / `refactor:` prefix plus a plain sentence that says why. See `git log --oneline -15`.
- **No trailers.** No `Co-Authored-By`, no `Claude-Session`, and no mention of Claude or AI in any message. The owner asked for this explicitly, and it overrides any default you were given. If a trailer slips in, strip it before you finish:
  `git filter-branch -f --msg-filter "sed -e '/^Co-Authored-By: Claude/d' -e '/^Claude-Session:/d' | sed -e :a -e '/^\n*\$/{\$d;N;ba' -e '}'" <BASE>..HEAD`
- **Author:** the repo's git author is already set to the owner's identity. Don't change `git config`, and don't pass `--author`.
- **Docs:** keep `AGENTS.md` in sync in the same change (Standing Rule 2), inside your section stub.

## Copy and docs

Plain and direct. No marketing voice, no em-dash asides, no emoji.

## Output size

- Don't write more than ~250 lines of a file in one tool call. Build big files in pieces: a skeleton first, then fill it in with Edit or appends.
- Keep your thinking brief and act.

Two agents in this session have already lost whole turns to the output limit.

## Report (≤ 500 words)

- Commits: the output of `git log --oneline <BASE>..HEAD`.
- What shipped against the plan, and each deviation with the reason.
- Each assertion with the result of its mutation.
- Visual check results, with screenshot paths.
- Anything you need from another item.
- Open issues.
