# The 2-hourly autonomous pass

`portfolio-2h-pass` (its prompt is at
`~/.claude/scheduled-tasks/portfolio-2h-pass/SKILL.md`; **disabled**, last run
2026-08-20) runs 3–4 roles in parallel every two hours, with every fourth run
an audit. The roster and the
selection rule are in `.claude/scheduled/portfolio-roles.md`, the ledger in
`.claude/scheduled/portfolio-pass-log.md`.

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
