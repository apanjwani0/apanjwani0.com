# /tools hub and tool pages: decisions and deferred items

The plan agreed with the owner on 25 Oct 2026 after a five-dimension review of
/tools; it shipped in PR #44. What it did is in git history. This file keeps the
owner's decisions that the code does not explain, and what was deferred and why.

## Decisions (owner, 25 Oct 2026)

- **Copy:** the footer, tagline ("Software Engineer") and bio are in
  `src/config/site.json`. "Just a developer…" read as underselling in search
  results, so the tagline is also the home `<title>` and the Person `jobTitle`.
- **Terms:** one `/terms` page for the whole site, not one per section.
- **Hub groups:** Live diagnostics / Verify & explain / Create / Everyday
  utilities (`TOOL_GROUPS`). Path-style labels (`/net`, `/bin`) were rejected as
  too developer-flavoured.
- **Hub h1:** "tools for developers and makers". Not every tool is a developer
  tool (Driftfield, Draftboard, Flowmap, Chroma Lab).
- **Paused UI-refresh items:** smart 404 yes (shipped); the command palette only
  if solid; a "recently used" row instead of the kit page; no thumbnails derived
  from the text-only share cards.

## Deferred, with reasons

- **Command palette** (UI-refresh item C, part 2): needs a `/search.json` route,
  the UI and its assertions; a PR of its own.
- **"Recently used" row on /tools:** drawn above the grid after load it is a
  layout shift for every returning visitor; doing it without one means touching
  the head bootstrap (`ROOT_BOOT_JS`), which `security:smoke` holds constant. The
  owner's call.
- **Link Peek image cap:** GitHub's 604 KB og:image exceeds the 400 KB preview
  cap, so popular pages preview without an image. Raising it is a memory-bound
  change on a 1 GB host: an owner decision.
- **Per-tool keywords lists** (Cron Whisperer has 42 terms): Google ignores them
  and a stuffed list can read as spam to Bing. Trim when each tool is next
  touched; the hub is already capped at 12 by assertion.
- **Try links for Chainsaw and DNS Sightline on a dramatic host** (for example
  `incomplete-chain.badssl.com`): not verifiable from the sandbox, whose egress
  proxy re-signs TLS. Verify from a normal network first.
