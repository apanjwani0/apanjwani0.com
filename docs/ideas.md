# Ideas / backlog

Not committed to, not scheduled. Delete an entry when it ships or stops being a
good idea.

## 2048 high scores

Build it the way the Type Trial and Hue Hunt daily boards already work (bounds,
separate read and write limiters, a debounced flush to `data/`, rows
re-validated on load). Game pages are edge-cached for ten minutes, so the board
must be fetched client-side from `/api/…` inside `astro:page-load`. 2048 is
deterministic given its spawn seed, so a shared daily seed plus replay
verification (submit `{seed, inputs[]}` and re-run it on the server) would make
a score checkable instead of trusted.

## Flowmap permalinks

Flowmap shipped browser-only. The original brief also wanted a server store: a
permalink to keep editing and a live image URL to embed a diagram in a README,
Slack or Notion. That half would clear the tool bar in AGENTS.md; the brief is
`docs/plans/flowmap.md` in git history.

## Tool renames

- Regex Lab → Thicket, JSON Tidy → Plumb, List Forge → Winnow. Names picked,
  awaiting a decision. Avoid "Backtrack": BackTrack was the distro that became
  Kali. Slugs change, so do all three in one commit with 301s, new cards and a
  sitemap shift. A rename alone doesn't fix a thin page; ReDoS detection is the
  capability that would make Thicket more than a regex tester.
- Cosmetic, batch with the above if at all: Codec Forge → Sift, Hash Smith →
  Fingerprint, Epoch Wizard → Meridian, Chroma Lab → Pigment.

## Editable maps

Flowmap and Draftboard's map only navigate; dragging a node never rewrites the
markdown. Doing it correctly is a larger build than the maps themselves.

## Unexplained CSP error on tool pages

A blob worker is blocked by the CSP (`script-src` has no `worker-src` fallback),
visible in the console on `/tools/json-tidy`. Find what spawns it before adding
`worker-src`.

## Search demand, before building more

Export Google Search Console → Performance → Queries (90 days) and pair it with
production `data/visits.json`. Near-zero impressions means no demand;
impressions at position 30 means the gap is content and links.

## New tools and games not yet built

- **Header Lens**, an HTTP response-header auditor (server-backed): the third leg after TLS (Chainsaw) and DNS (DNS Sightline). Fetch a URL from the origin with Link Peek's address classifier and per-hop redirect checks, then audit HSTS (preload eligibility, the `includeSubDomains` trap), a parsed CSP (a nonce neutralising `'unsafe-inline'`, `script-src` falling back to a missing `default-src`, report-only), `Cache-Control` (`max-age` against `s-maxage`), cookie flags, CORS, and cargo-culted headers (`X-XSS-Protection`, `Expect-CT`). Explain the failure each finding predicts instead of grading with a letter. The bar to beat is securityheaders.com.
- **Certificate Transparency lens** (server-backed). Chainsaw sees the one certificate a host serves; CT logs list every certificate issued for the name, the only way to notice a mis-issuance that is not on the wire. Query crt.sh (or a CT API) from the origin, then run each issuer through `caIdentify` and the zone's CAA policy through `caaRenewalOutlook`. Bound it like DNS Sightline (one host, a compile-time constant, a shared budget, tight per-client limits), and never call an unexpected issuer malicious: a wildcard bought years ago by an agency is the common case.
- **Chainsaw expiry watch.** A result mints a link that re-runs the check and says what changed (serial, issuer, effective expiry, chain completeness). No accounts: the baseline rides in the fragment, bounded at mint and at decode, the way Type Trial's ghost token does.
- **Hue Hunt duel link.** A finished daily mints a fragment permalink carrying the day and the five guesses; a friend plays the same five colours and gets a side-by-side result. Bounds at mint and decode, the day pinned to `hueDayNumber`, any invalid token degrading to a normal daily.
- **Constellation**, a seeded star-pattern puzzle. Connect nine to sixteen stars into the hidden figure in one unbroken stroke (an Eulerian-path puzzle). Build the path first, then hide it; a hint reveals one edge; the daily seed comes from a shared day module like Quintle's.
- **Reaction-diffusion lab (Gray-Scott).** Two sliders change the species of pattern (coral, fingerprint, mitosis, worms), not its colour. Named presets, each verified to reach its pattern rather than die out or saturate; a per-frame step budget like Deep Shore's; the shared export bar with an `AnimationSource`. Keep a reference implementation beside the fast path: a wrong Laplacian still renders something pretty.

## Follow-ups on shipped tools

Deferred when each shipped. Check the code before starting one.

- DNS Sightline: DNSSEC chain validation; a "what changed" diff through a fragment permalink; PTR lookups; the authoritative nameservers asked directly; DKIM selector discovery; the organizational-domain DMARC fallback (needs the Public Suffix List).
- Chainsaw: a no-SNI probe for the default vhost's certificate; fetching the missing intermediate (AIA) to build the repaired chain; STARTTLS ports (25, 587, 143); carrying Sightline's SPF and DMARC findings into its panel.
- Link Peek: oEmbed, more platforms, a user-agent diff, a redirect-chain display.
- Deep Shore: perturbation arithmetic past the double floor; a Worker or OffscreenCanvas render; orbit-trap and distance-estimate colouring; drag-to-reorder tour stops with a dwell time each; MP4/WebM export.
- Type Trial: a share-text ghost line, a race-the-#1 ghost (needs a server timeline), a replay scrubber.
- Regex Lab: a token-by-token pattern explanation, hover-a-group highlighting, snippets in more languages.
- Chroma Lab: colour-blindness simulation, a "nudge to AA" suggester.

## Loose ends in the code

Checked against the code on 9 Oct 2026.

- `cwSplitPercent` (`cron-whisperer/crontab.ts`) handles `\%` but not `\\`. Settle which escapes Vixie cron collapses against real cronie source, record the versions, then fix and assert. The same standing applies to the `restricted` reading and the bare `TZ=` line.
- `site.sections.experience` is `false` and nothing reads it: only `blogs` and `projects` have predicates, and there is no `/experience` route. Wire it like `isBlogsPublic`, or delete it.
- `src/pages/tools/[slug].astro` calls `learningsAboutEmbed(tool.slug, …)`, but no tool slug is an `EMBED_TAGS` key, so it returns nothing today. Whether tools get articles that mount them as the figure (the SEO backlog proposes some) is a product call; if yes, the tool joins `EMBED_TAGS`, if no, delete the call.
- `Head.astro` emits `noindex, nofollow` for every noindexed page. `noindex, follow` would keep the coming-soon pages' "More games" links crawled. Nothing shows the current form costing anything.
- `shared.css` (`:focus-visible` comment) says "navy accent token", but `--color-accent` is violet.
- `sanitizeName` lives in `type-trial-leaderboard.ts` and `hue-hunt-leaderboard.ts` re-exports it. The right home is a shared `src/lib/leaderboard-name.ts`.
- There is no `--color-warning` or `--color-danger` token, yet `poker-trainer.css` reads `var(--color-warning, var(--color-accent))`, which always renders the fallback. A `var(--x, fallback)` on a token that does not exist fails silently and looks deliberate; sweep for them. If a warning colour is wanted, it is a `theme.css` change.

## Host on an Android phone

Parked. Run `node dist/server/entry.mjs` directly in Termux (Node 22.12 or newer, per `package.json`), with no Docker: Android kernels' namespace and cgroup support is unreliable. Carriers use CGNAT, so the phone has no public IP; a Cloudflare Tunnel (`pkg install cloudflared`, `cloudflared tunnel login`, `tunnel create`, `tunnel route dns`, `tunnel run --url http://localhost:4321`) dials out and handles TLS. Keep the process alive with `termux-wake-lock` and start it on boot with Termux:Boot (F-Droid, a script in `~/.termux/boot/`). Less reliable than the OCI VM (battery, doze), so a backup or experiment, not production.

## A curated reading list ("reads")

Undecided. "reads" means a curated list of topics and articles the owner is excited to read and learn from, possibly sourced from his knowledge base, not a section of original essays. On 20 Aug 2026 an original essay was written under that name and rejected ("you are not getting what exactly I want to put in reads"). `/learnings` has since shipped figure-led articles in his voice and stays an article section (30 Sep 2026), so ask whether a separate `reads` list is still wanted. Confirm the shape first (links only, links plus his notes, or essays): a link list needs a source, a URL and a one-line take, and may need no detail pages, so the `Learning` schema does not carry over.

## A visual layout editor

A real "organise my UI" editor: Framer or Webflow-style direct manipulation of the actual layout, not reorder lists or SEO forms. A reorder-based CMS (Keystatic plus a drag-and-drop "Arrange" mode over `content/*.json`) was built in July 2026 and rejected ("all is just text editors and page order arrangements. That's not at all what I wanted"). Do not rebuild it. It is parked on the local branch `feature/visual-cms-editor` (`941b2dc`), never pushed. The principle that survives: page content stays config-driven.

## Online multiplayer poker (retired)

Poker Together, a local-first play-money game, was replaced by the Poker Trainer on 28 Sep 2026, and its PocketBase backend was deleted (`08f29e6`). To revive online play, start from git history: `docs/poker-multiplayer.md` and `docs/poker-build-log.md` at `9537830`, and the product model and asset system in `docs/poker-design.md` at `be727f9`.

- The engine is a pure deterministic reducer, so replicate the ordered action log, not state. With a server sequencer (PocketBase Realtime, one writer per turn, each client stamping `seq = lastSeen + 1`) host migration disappears. PocketBase treats a required number `0` as empty, so `seq` must not be `required`.
- Wanted by the owner: money-persistent books that always tally (a leaver becomes a permanent cash-out), a provably fair shuffle, public rooms kept alive by visibly tagged bots, private rooms by invite code, and a private odds "pet" that sees only the board and its owner's hole cards.

## Tools and games as standalone products

A direction from 9 Jul 2026: opening a tool or game should feel like a separate product, with no site nav and no portfolio chrome during use and one quiet "built by" credit, so a person who bookmarks it may never open the portfolio again. It was never implemented: tool and game pages render the site nav and a breadcrumb in the shared frame ([conventions.md](conventions.md)). The owner to confirm whether it still stands.

