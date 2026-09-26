# PR #19 review + UI/UX scope

PR: https://github.com/apanjwani0/apanjwani0.com/pull/19 (develop → main, 77 files, +17.5k / −770)
Gate on `develop` @ 9fd7934: `build` ✅ · `check` ✅ (0 errors) · `security:smoke` ✅ · `poker:check` ✅

---

## Part 1: PR review

### 🔴 Blocking

**B1. The production server crashes on boot.** The lockfile moves `astro` 7.2.0 → **7.3.3** but keeps `@astrojs/node` at **11.1.0**.
That adapter's `standalone()` calls `app.pipeline.getLogger()`, which no longer exists in 7.3.3. `node dist/server/entry.mjs` (the Dockerfile CMD) throws
`TypeError: Cannot read properties of undefined (reading 'getLogger')` and exits. Reproduced locally. With `ASTRO_NODE_LOGGING=disabled` the same build serves 200, which confirms the cause.
Merging deploys this image. The deploy health probe would fail, so how bad the outage gets depends on whether the old container is already gone.
**Fix:** bump `@astrojs/node` to 11.1.6 (peer `astro ^7.2.1`), then boot the built server and curl `/` as part of the gate. `build` and `check` cannot catch this.

### 🟠 Should-fix

| # | Where | Defect | Failure scenario |
|---|---|---|---|
| S1 | `api/tools/dns-sightline.ts:88-90` | Client and global limiters are both called before either is checked. `createRateLimiter` counts the hit even when it refuses. | One IP sends 16 req/min: it gets 4 answers, and the global bucket (16) is empty for **everyone**. For the CAA scope, 48 req/min locks every visitor out of Chainsaw's CAA panel. Link Peek and Chainsaw short-circuit correctly. |
| S2 | `dns-sightline/analyze.ts` `sgAnalyzeCaa` + `caa.ts:131` | `incomplete && !foundAt` drops a failed lookup that sits *below* the level where a policy was found. | `sub.example.com` times out and `example.com` has CAA, so the tool prints a confident "policy at example.com permits/forbids your CA". The more specific name's CAA would have won. This breaks the documented "a failed lookup is not an absent record" invariant. |
| S3 | `dns-sightline/inspect.ts` `sgInspect` | No overall deadline. The SPF walk runs sequentially, up to 40 queries × 4s. | A hostile zone with a chain of includes pointing at a blackholed NS holds one request for about 170s. That breaks the "bounded in every dimension / socket time" rule. |
| S4 | `tls-inspect.ts:140` `csResolvePinned` | `dns.lookup` has no timeout. Link Peek wraps the same call for exactly this reason. | Blackholed nameservers occupy libuv threadpool slots and stall unrelated fs/crypto work. The HTTP request hangs past its own deadline. |
| S5 | `lib/canvas-export.ts` | The `astro:before-swap` listener added on `document` is never removed, and there is no disposer. | Every reconnect of any of the 7 canvas engines (article embeds, in-site navigation) leaks one more document listener that holds its DOM. |
| S6 | `lib/game-mount.ts` `stripEmbedChrome` | The MutationObserver disconnects only when it finds an `h1`/header. Diagram Atlas never writes one. | 8 observers run forever on `/learnings/which-diagram-to-draw` and re-scan on every render. |
| S7 | `DnsSightline.ts:342,359`, `LinkPeek.ts:355` | Horizontally scrolling table wrappers have no `tabindex="0"` (the AGENTS.md rule). | Keyboard users can't reach clipped columns on mobile. |
| S8 | `pages/games.astro` intro | Broken sentence: "Three have a daily everyone gets the same copy of". | Ships on the live hub. |
| S9 | `theme.css` | `--space-sm` (0.4rem) < `--space-xs` (0.45rem). | The scale reads out of order, so the next author picks the wrong rung. |
| S10 | learnings | `/learnings/the-test-that-shared-the-bug` is live on `main` and becomes a bare 404 after merge. | Inbound links and search results die. Add a 301 to `/learnings` (or to the new article). |

### 🟡 Nits

- `link-peek.ts:84-96`: image `Content-Type` only has to start with `image/` before it goes into a `data:` URI and CSS `url("…")`. Allowlist `^image/[a-z0-9.+-]+$`.
- `link-peek-fetch.ts:137-151`: IPv6 classifier misses 6to4 `2002::/16` (embeds v4, e.g. 127.0.0.1), Teredo `2001::/32`, `100::/64`, and v4 `192.88.99.0/24`.
- `caa.ts:108`: `issue "; accounturi=…"` should read as *forbid all* (an empty issuer means no issuance, RFC 8659).
- Raw `err.message` in API responses (`dns-sightline.ts:335`, `dns-doh.ts:259`). Chainsaw's route has no try/catch around `csInspect`.
- Stale slug `how-to-think-on-paper` in AGENTS.md, the Diagram Atlas docblocks and CSS header, and the PR body. The article is `which-diagram-to-draw`. `docs/plans/learnings.md` still names deleted articles.
- `learnings/[slug].astro` table styles hardcode `0.92em` / `1.6em`.
- Chainsaw shows the CA Issuers URL as dead text. It should be a link.

### ✅ Verified sound (not repeated by reviewers)
SSRF gate against ~40 tricky spellings (decimal, octal, `::ffff:`, NAT64, fullwidth digits, trailing dot). Chainsaw pins the address and sends the name only as SNI. Link Peek re-checks every redirect hop and caps the decompressed body. All innerHTML goes through the escape helpers. AbortControllers and stale-response guards are in place. Permalink decoders (ghost, dive tour) are bounded. localStorage is wrapped in try/catch. Streak day math is correct. OG card slugs match. Stretched-link cards keep `position: relative`.

---

## Part 2: UI/UX audit (screenshots at 1440 and 390, prod build)

What I saw:
1. **The home page is one screen with nothing to do**: name, tagline, two links. The site's best work (Chainsaw, Deep Shore, the dailies) is two clicks away and unannounced.
2. **Two control languages.** Driftfield uses filled light buttons in the serif font. Tools use mono outline buttons. Type Trial uses mono tabs. The badges come in three shapes: violet square `server`, green `play ›`, pill `image + GIF studio`.
3. **Detail pages disagree on width and rhythm.** Games sit in the 768px prose column and tools in `--tool-width`. The "More tools" block is narrower than the tool above it. The gap between title and intro differs page to page.
4. **Hubs are walls of text.** Every card is title plus a paragraph, and game card heights vary from 3 to 6 lines. There are no visuals, even though a 1200×630 card already exists for every live item in `public/og/`.
5. **/projects cards are essays.** Up to 4 paragraphs each, uneven heights, and no visible repo/stars affordance at a glance.
6. **Learnings card hierarchy is inverted.** The mono date renders larger and heavier than the title. There's no read time on the card.
7. **No light theme exposed**, although `theme.css` already has a complete, contrast-asserted light palette.
8. The 404 page is friendly but can't guess where you meant to go.

---

## Part 3: Proposed change set (new branch off `develop`)

### Track A: PR fixes (all of Part 1)
B1 → S1–S10 → nits. Each invariant fix gets a `security:smoke` assertion and a mutation check, per AGENTS.md.

### Track B: foundations (consistency, robustness)
- **One control kit** shared by both lanes: button, tab, input, badge (`status` / `server` / `daily` / `new`), toast. Tokenised, and it replaces the per-lane dialects. A smoke assertion stops a lane from growing its own again.
- **One detail-page shell**: the same header rhythm (breadcrumb → title → one-line lede → badges), the same width contract, and a related-links block aligned with the content.
- Spacing and type scale cleanup (S9, plus a missing `--text-md` rung if the audit needs one).
- Line-clamped card descriptions and equal-height rows.

### Track C: "cool" features (you choose)
1. **⌘K / `/` command palette**: a site-wide fuzzy jump to any tool, game, article or project, plus actions like "toggle theme" and "today's dailies". A zero-dependency web component. A keyboard-first site for developers is the most on-brand "cool" thing available.
2. **Home showcase below the hero**: "Today" (the three dailies with a live countdown to the next UTC day and your streak, all client-side), a "Featured" shelf of 3 flagship pieces, and the latest learning. The hero stays exactly as it is above the fold.
3. **Visual cards**: OG images reused as lazy thumbnails on the tools, games and learnings hubs. They're already generated and edge-cached, so they cost nothing at runtime.
4. **Theme switch**: system, dark or light, with no flash (an inline nonce'd script), persisted per browser.
5. **Motion, done carefully**: View Transitions cross-fades, a card→detail title morph (`view-transition-name`), and a hover lift or accent glow on cards. Everything sits behind `prefers-reduced-motion`. *AGENTS.md's frontend override currently says "no animations", so this needs your call.*
6. **Smart 404**: a "did you mean /tools/chainsaw?" suggestion from a fuzzy match against real slugs, and the palette opens right there.
7. **Tools hub grouping**: "Needs a server" and "Runs in your browser" as real sections, not only a badge.
8. **Projects redesign**: a one-line summary, language/stars chips, and the rest behind an expander.
9. **`?` shortcut sheet** listing the keyboard shortcuts per page.

### Verification per change
`build` + `check` + `security:smoke` + `poker:check` + **boot the built server and curl `/`** (new, because of B1) + Playwright screenshots at 1440/390 in both themes + an in-site click-through for `astro:page-load` mounting.
