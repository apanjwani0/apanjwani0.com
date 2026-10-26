# /tools hub and tool pages (25 Oct 2026)

The plan agreed with the owner on 25 Oct 2026 after a five-dimension review of
/tools (functionality, performance, UX, design, reach), and what came of it.
Owner decisions are recorded where they were made.

## Decisions (owner, 25 Oct 2026)

- **Footer:** option B, "Designed and built by Aman. Free tools and games,
  offered as-is: double-check anything important before you rely on it."
- **Tagline:** "Software Engineer". It is the home `<title>` and the Person
  `jobTitle`; "Just a developer…" read as underselling in search results.
- **Bio:** the confident version (payments at scale, end-to-end product work,
  AI as part of the toolkit, building in public).
- **Terms:** one `/terms` page for the whole site, not one per section.
- **Hub groups:** Live diagnostics / Verify & explain / Create / Everyday
  utilities. Path-style labels (`/net`, `/bin`) were rejected as too
  developer-flavoured.
- **Hub h1:** "tools for developers and makers". Not every tool is a developer
  tool (Driftfield, Draftboard, Flowmap, Chroma Lab).
- **Paused UI-refresh items:** smart 404 yes; ⌘K palette only if solid; a
  "recently used" row instead of the kit page; no thumbnails derived from the
  text-only share cards.

## Done (PR #44, awaiting merge)

- [x] **Double load fixed.** Every Base→ToolBase link (hub cards, Driftfield
      link on /games, related links, 404 suggestions, try links) carries
      `data-astro-reload` through `shellLinkAttrs()` (`src/lib/shells.ts`).
      Measured: a card click went from `fetch` + `document` to one `document`.
- [x] **llms.txt:** no "games.." double stop; tool lines carry the full
      `metaDescription`.
- [x] **Site copy:** tagline, bio and footer per the decisions above.
- [x] **CI:** `.github/workflows/ci.yml` runs the gate on PRs and `develop`.
- [x] **Hub share cards** for /tools, /games, /learnings (`hub-<kind>.png`);
      the generator takes `CHROME_PATH`, file-prefix arguments and the vendored
      fonts, so it runs on Linux without network.
- [x] **Grouped hub:** `TOOL_GROUPS`, `h2` sections with one-sentence ledes,
      `h3` card titles, a shorter intro, a closing "More tools" section so no
      tool can vanish.
- [x] **h1** "tools for developers and makers"; **keywords** cut from 60+
      terms to 10.
- [x] **JSON-LD:** `CollectionPage` over the summary-shaped `ItemList`, with
      each item's one-line description.
- [x] **Try links** on Chainsaw and DNS Sightline (github.com), Cron
      Whisperer (01:30 in London: skipped in spring, repeated in autumn,
      checked against the engine) and Flowmap (an outline of a page load,
      built with the tool's own encoder).
- [x] **Focus ring** on the whole card (behind `@supports selector(:has(*))`).
- [x] **Hub sky rests** after 20 s without input and resumes on the next one
      (0 rAF calls while idle, measured).
- [x] **Smart 404:** "Did you mean" from the site index; scanner paths get
      nothing and never build the index; the asked path is never echoed.
- [x] **/terms**, noindex, out of the sitemap, linked from every footer, with
      retention numbers read from or asserted against the code.

## Found and fixed in the tool-page review

- **Flowmap overwrote the visitor's saved board** whenever a `#g=` share link
  opened (the first sync persisted). A linked board is now held back until the
  first edit, with a status line saying so, when a saved board exists.
- **Flowmap layout shift 0.115** on every first visit: the source drawer
  opened after Cytoscape loaded. It now opens before the first paint (0 over
  six loads).
- **Driftfield layout shift 0.108** on about half of loads: the canvas was
  sized a frame late. Sized at mount now (0 over ten loads).
- **Five meta descriptions over 160 characters and two titles over 60**
  (Token Bench, Cron Whisperer, DNS Sightline, Link Peek, Chainsaw) rewritten;
  all live tools are held to the budget. Token Bench now says the key never
  leaves the browser (seo-backlog #4).

Every new invariant is in `scripts/tools-hub-smoke.mjs` and was mutation-tested.

## Deferred, with reasons

- **⌘K palette** (UI-refresh item C, part 2): needs a `/search.json` route,
  the UI and its assertions; a PR of its own, not a tail on this one.
- **"Recently used" row on /tools:** drawn above the grid after load it is a
  layout shift for every returning visitor; doing it without one means
  touching the head bootstrap (`ROOT_BOOT_JS`), which `security:smoke` holds
  constant. The owner's call.
- **Link Peek image cap:** GitHub's 604 KB og:image exceeds the 400 KB preview
  cap, so popular pages preview without an image. Raising it is a
  memory-bound change on a 1 GB host: an owner decision.
- **Per-tool keywords lists** (Cron Whisperer has 42 terms): Google ignores
  them and a stuffed list can read as spam to Bing. Trim when each tool is
  next touched; the hub is already capped at 12 by assertion.
- **Try links for Chainsaw and DNS Sightline on a dramatic host** (e.g.
  `incomplete-chain.badssl.com`): could not be verified from the sandbox,
  whose egress proxy re-signs TLS. Verify from a normal network first.
