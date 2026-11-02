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

A blocked blob worker shows in the console on `/tools/json-tidy`. Nothing in
`src/` or the vendored Oat creates a Worker and a clean headless Chromium shows
no error on any tool page (checked 25 Oct 2026), so it is almost certainly a
browser extension. Do not add `worker-src` for it.

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

Each checked against the code on 2 Nov 2026.

- `cwSplitPercent` (`cron-whisperer/crontab.ts`) handles `\%` but not `\\`. Settle which escapes Vixie cron collapses against real cronie source, record the versions, then fix and assert. The same standing applies to the `restricted` reading and the bare `TZ=` line.
- `site.sections.experience` is `false` and nothing reads it: only `blogs` and `projects` have predicates, and there is no `/experience` route. Wire it like `isBlogsPublic`, or delete it.
- Hidden sections are listed twice: `GATED_SECTIONS` (`config.ts`) and `SECTIONS[].gated` (`site-index.ts`). Merge them into one `isSectionPublic(site, path)`.
- `src/pages/tools/[slug].astro` calls `learningsAboutEmbed(tool.slug, …)`, but no tool slug is an `EMBED_TAGS` key, so it returns nothing. If tools get articles that mount them as the figure (the SEO backlog proposes some), the tool joins `EMBED_TAGS`; if not, delete the call.
- `Head.astro` emits `noindex, nofollow` for every noindexed page. `noindex, follow` would keep the coming-soon pages' "More games" links crawled; nothing shows the current form costing anything.
- `shared.css` (`:focus-visible` comment) says "navy accent token", but `--color-accent` is violet.
- `sanitizeName` lives in `type-trial-leaderboard.ts` and `hue-hunt-leaderboard.ts` re-exports it. The right home is a shared `src/lib/leaderboard-name.ts`.
- There is no `--color-warning` or `--color-danger` token, yet `poker-trainer.css` reads `var(--color-warning, var(--color-accent))`, which always renders the fallback. Sweep for `var(--x, fallback)` on tokens that do not exist; if a warning colour is wanted, it is a `theme.css` change.
- DNS Sightline: loop detection matches the substring "loop" in problem text, so an unanswered `include:_spf.loopia.se` reads as a loop error. Keep loops in their own field.
- DNS Sightline: CAA in RFC 3597 `\#` hex form reads as no CAA, because `parseCaa` refuses it.
- DNS Sightline: the Records table says "No records of any queried type" when the lookups got no answer.
- DNS Sightline dead code: `sgCanonicalRecord`'s `default` branch is unreachable, the `SG_TYPES.includes(t)` test in `inspect.ts` is always true, and `sgIsDangling` and `sgCnameTargetUnchecked` can be one function.
- Chainsaw: `aia-available` quotes the raw CA Issuers URL; name it only when `csLinkableUrl` accepts it.
- The paused UI-refresh foundation (design-system.md, *UI refresh*) has no UI caller: `kit.ts` (and `fuzzy.ts` beyond the 404), four empty `init*UI` stubs, unused theme helpers and unused tokens (a little CSS on every page), `Base`'s `canonicalPath`, and `ROOT_BOOT_JS` living in a shared module. Decide: build it, or park it on `wip/ui-refresh-notes` and delete it here.
- `/oat.min.*` is not hashed, so it revalidates on every page view; a Cloudflare Cache Rule with a long edge and browser TTL fixes it (serving it through Vite does not, see AGENTS.md *Stack*).
- The home share image is the WebP portrait (the avatar fallback), which some apps (LinkedIn) handle poorly. A 1200x630 PNG card would fix it.
- Learnings copy: both article `seoTitle`s run over 65 characters, both meta descriptions over 160, and the hub's title is the bare `learnings`.

## Host on an Android phone

Parked, a backup rather than production. Run `node dist/server/entry.mjs` in Termux (no Docker; Android's namespace and cgroup support is unreliable) and reach it through a Cloudflare Tunnel, because carriers use CGNAT and the phone has no public IP. Keep it alive with `termux-wake-lock` and Termux:Boot. Less reliable than the OCI VM (battery, doze).

## A curated reading list ("reads")

Undecided. "reads" means a curated list of topics and articles the owner wants to read, not original essays (an essay written under that name on 20 Aug 2026 was rejected). `/learnings` stays the article section (30 Sep 2026), so ask whether a separate list is still wanted, and its shape (links only, links plus notes, or essays). A link list needs a source, a URL and a one-line take, so the `Learning` schema does not carry over.

## A visual layout editor

Wanted: Framer or Webflow-style direct manipulation of the real layout. A reorder-based CMS (Keystatic plus a drag-and-drop "Arrange" mode) was built in July 2026 and rejected ("all is just text editors and page order arrangements. That's not at all what I wanted"); do not rebuild it. It is parked on the local branch `feature/visual-cms-editor` (`941b2dc`), never pushed. Page content stays config-driven.

## Online multiplayer poker (retired)

Poker Together, a local-first play-money game, was replaced by the Poker Trainer on 28 Sep 2026, and its PocketBase backend was deleted (`08f29e6`). To revive online play, start from git history: `docs/poker-multiplayer.md` and `docs/poker-build-log.md` at `9537830`, and the product model and asset system in `docs/poker-design.md` at `be727f9`.

- The engine is a pure deterministic reducer, so replicate the ordered action log, not state. With a server sequencer (PocketBase Realtime, one writer per turn, each client stamping `seq = lastSeen + 1`) host migration disappears. PocketBase treats a required number `0` as empty, so `seq` must not be `required`.
- Wanted by the owner: money-persistent books that always tally (a leaver becomes a permanent cash-out), a provably fair shuffle, public rooms kept alive by visibly tagged bots, private rooms by invite code, and a private odds "pet" that sees only the board and its owner's hole cards.

## Tools and games as standalone products

A 9 Jul 2026 direction, never implemented: a tool or game would feel like a separate product, with no site nav or portfolio chrome and one quiet "built by" credit. Pages today render the site nav and a breadcrumb in the shared frame ([conventions.md](conventions.md)). The owner to confirm whether it still stands.

## The autonomous pass (retired)

A 2-hourly scheduled task, `portfolio-2h-pass`, rotated 3-4 roles per run and committed to `develop` behind the full gate. It is disabled (last run 2026-08-20) and its prompt lives outside the repo, at `~/.claude/scheduled-tasks/portfolio-2h-pass/SKILL.md`. Its roster, selection rule and ledger design were in `docs/plans/autonomous-pass.md` (git history); the prompt still points at old `.claude/scheduled/` paths, so update it before re-enabling.
