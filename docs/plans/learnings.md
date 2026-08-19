# Learnings section + content/tool restructure

Written 2026-08-18. **Phases 1–3 and P-1 and T-1 are shipped on `develop`.**

| Phase | State |
|---|---|
| 1 — Learnings, end to end (L-1…L-9) | **Done.** Section, routes, admin tab, predicate, sitemap, cards, smoke assertions |
| 2 — Remaining articles (L-10…L-15) | **Done.** All seven articles live, each with its simulation embedded |
| 3 — Driftfield (D-1…D-5) | **Done.** Six mode routes, 301s from `/games/*` and `/tools/wallpaper-forge`, games config pruned 14 → 7 |
| 4 — T-1 Token Bench | **Done.** JWT signature verification, extracted to `src/lib/jwt.ts` and asserted |
| 4 — T-2 tool renames | **Not started — needs a decision from you.** See Open below |
| 4 — T-3 MD Enhanced mind map | **Done.** Map view: headings or outline, click a node to jump to that line |
| 4 — I-1 Ideation canvas | **Done.** Shipped as **Trellis** — paste text to draw, then rearrange |
| 5 — P-1 Projects rewrite | **Done.** Production work leads; excalidraw fork dropped |

Deviations from the plan as written, both deliberate:

- **Codec Forge and Hash Smith were NOT folded into Token Bench.** They are
  ~800-line tools with real features (file hashing, checksum verification, UUID
  generation, HMAC), and merging them would have deleted working functionality to
  serve a page-count argument. Token Bench was built around the capability that
  was actually missing — signature verification — and the other two stand.
- **Chroma Lab was NOT folded into Driftfield.** The palette control it would
  have contributed was not built, so removing the standalone tool would have lost
  a feature and gained nothing.

## Thesis

The site's reach problem is not markup — technical SEO is finished and correct.
It is that no page here is worth linking to. Every tool is a text box with
entrenched competitors, and every "game" that isn't a game is a screensaver with
no reason to be found.

The learnings section fixes that with one specific advantage: **a working
simulation inside the article.** "The story behind Game of Life" with a live,
tunable Game of Life embedded in the page is a scarce artifact. A newsletter
cannot do it. The seven non-games already built are seven such embeds sitting
unused under the wrong label.

**AI belongs here as explainer + live demo, never as news.** Recency is a losing
fight against outlets with staff; a durable explainer with something to poke at
is winnable.

So the games cull is not cleanup. It is the content pipeline.

## Decisions locked

| Decision | Outcome |
|---|---|
| Learnings | New config key `learnings`, own routes. `blogs` stays, personal, low-activity |
| The 7 non-games | Become learnings articles with the existing component embedded, then leave `/games/` |
| Cron Whisperer / Epoch Wizard | **Stay separate.** No merge |
| JSON Tidy, List Forge, Regex Lab | **Keep.** Rename + deepen, stay simple |
| Codec Forge + Hash Smith | **Merge** into Token Bench, with real JWT signature verification |
| MD Enhanced | Deepen into writing tool + mind map |
| Ideation canvas | **New tool**, Cytoscape.js, same framework as Snap Call Screen Map |
| Wallpaper Forge + 6 generative engines | Merge into **Driftfield** |
| excalidraw-cli | Removed from projects |
| Ads | Deferred — see below |

## Naming: Driftfield

> **Checked 2026-08-18 against real page-1 results — the long-tail reasoning
> below was written from assumption and is largely wrong. See "Keyword reality
> check" at the end. Kept as written so the correction stays legible.**

Chosen on reach grounds, and the name is the least important half of that.

Head terms — "wallpaper generator", "generative art", "screensaver maker" — are
owned by Canva, Adobe, and Wallpaper Engine. Unwinnable at this site's authority,
whatever we call the tool. What is winnable is the long tail, and it is
per-engine: `flow field wallpaper generator`, `reaction diffusion simulator
online`, `boids flocking simulation`, `l-system tree generator`. Low volume, near
zero competition, and exactly what the six engines already are.

**Therefore the merge must keep six indexable URLs, not collapse to one.**

```
/tools/driftfield                  → hub, picks a mode
/tools/driftfield/flow-field       → own seoTitle, own OG card
/tools/driftfield/murmuration
/tools/driftfield/turing-bloom
/tools/driftfield/sand-loom
/tools/driftfield/lsystem
/tools/driftfield/starfield
```

Query params (`?mode=`) will not do — they do not rank as separate pages. Each
mode is a real route with its own keyword-bearing `seoTitle`.

This also means the six old `/games/*` URLs are **retargeted, not deleted**: 301
to the matching Driftfield mode. Same content, correct search intent — "generator"
instead of "game", which is what people actually search for these engines.

The product name is then free to be brandable, since `seoTitle` carries the
keywords separately (AGENTS.md already keeps those decoupled). `Driftfield`:
one word, distinctive, no collision, and "field" names the vector-field maths
under most of the engines. Override if you dislike it — nothing else depends on it.

## The article series

All seven come out of the games being removed. There is a real thread joining
them, which gives the section an identity from day one:

> **Accidental Machines** — the visuals you see every day, and the people who
> did not set out to invent them.

Two of these people won Academy Awards for maths. One was a biologist. One was
Turing, two years before he died.

| # | Article | From | The hook |
|---|---|---|---|
| 1 | Conway's Game of Life | `game-of-life` | Conway resented it. It buried his serious work — surreal numbers, the Monster group — under a toy. Gosper's glider gun won his $50 prize by proving unbounded growth; the thing is Turing-complete |
| 2 | Turing's last paper | `turing-bloom` | 1952, *The Chemical Basis of Morphogenesis*, two years before his death. The computing man founded mathematical biology by explaining how a uniform ball of cells becomes a leopard. Confirmed experimentally decades later |
| 3 | Three rules, no leader | `murmuration` | Reynolds' boids, 1986. Separation, alignment, cohesion — that is all of it. Batman Returns' bats, 1992. He won a Sci-Tech Oscar for it |
| 4 | The noise that built every world | `flow-field` | Ken Perlin wrote it for *Tron* in 1982 and won an Academy Award in 1997. Almost every procedural texture and terrain since descends from it |
| 5 | An algae paper became every tree | `lsystem-tree` | Lindenmayer, 1968, a biologist modelling algae growth. Now the vegetation in essentially every game and film |
| 6 | Screensavers solve a problem that no longer exists | `starfield-toy` | CRT phosphor burn-in, gone for decades. After Dark's flying toasters, 1989. We kept them anyway — **launch piece for Driftfield** |
| 7 | Falling sand | `sand-loom` | Weakest history; runs as an emergence/cellular-automata piece. Optional, ship last |

Ship **#1 first** — highest search volume, and the Conway-resented-it angle proves
the "surprising fact" format. **#2 is the strongest story on the list** and should
follow immediately.

## Architecture: the lazy embed

Do not build a new interactive content type. Both halves already exist.

`src/pages/blogs/[slug].astro` has the markdown pipeline. `src/pages/games/[slug].astro`
has `mountGame()`, which dynamically imports a component by slug. A learnings post
is those two joined by one optional field:

```ts
export interface Learning {
  slug: string
  title: string
  summary: string
  content: string        // markdown, via src/lib/markdown.ts — never raw set:html
  embed?: string         // a GAME_TAGS key: mounts the live component inline
  published: boolean
  date: string
  keywords?: string
}
```

Seven articles, seven live simulations, **zero new interactive code**. The engines
get used twice over: once as a Driftfield mode, once as an article embed.

Extract `mountGame()`'s dispatch into `src/lib/game-mount.ts` so both routes share
it rather than growing a second copy that drifts.

### One predicate, as AGENTS.md requires

`isPublishedLearning(l) = l.published && l.content.trim().length > 0`

Every consumer reads it — sitemap, hub `ItemList`, OG card eligibility,
`RelatedLinks`. A `noindex` learning must not appear in any of the three, for the
reason already documented for games and tools.

### Cache

`/learnings/*` needs no new header work. Public GET 200s already get
`s-maxage=600` from `src/middleware.ts`. Embeds mount client-side inside
`astro:page-load` (ClientRouter is on) so nothing is baked into the cached HTML.

---

## Tickets

Each is one worklog entry.

### Phase 1 — Learnings, end to end

- **L-1** `src/config/learnings.ts` — the `Learning` interface above, plus one
  seeded draft entry so the routes have something to render.
- **L-2** `getLearnings()` in `src/lib/config.ts`. KV-aware like every other
  accessor. Never import the config directly from a page.
- **L-3** `src/lib/learnings.ts` — `isPublishedLearning()`. Single predicate, per
  the Indexing rule.
- **L-4** Extract `mountGame()` dispatch → `src/lib/game-mount.ts`; point
  `src/pages/games/[slug].astro` at it. Pure refactor, no behaviour change.
- **L-5** Routes: `src/pages/learnings.astro` (hub, `ItemList` of published only)
  and `src/pages/learnings/[slug].astro` (article + optional embed via L-4).
- **L-6** Admin: `generateLearnings()` + `case 'learnings'` in `astro.config.mjs`;
  `'learnings'` in `CONFIG_TYPES` (`src/lib/config-schema.ts`); tab + form + save
  handler in `src/pages/admin.astro`. This is steps 3–5 of the AGENTS.md checklist —
  the Vite generator **must** mirror the interface exactly or HMR silently drops saves.
- **L-7** Wire indexing: sitemap entries, `RelatedLinks` support, OG card naming
  (`learnings-<slug>.png`) in `src/lib/og.ts`, nav link. All gated on L-3.
- **L-8** Extend `scripts/security-smoke.mjs`: assert learnings markdown goes
  through `src/lib/markdown.ts`, and that an unpublished learning is absent from
  sitemap, hub list, and OG cards. A trust-boundary change without an assertion is
  incomplete.
- **L-9** **Article #1, Game of Life**, full: copy, `embed: 'game-of-life'`,
  `npm run og`, commit the card. This is the format proof — do not start #2 until
  #1 reads well end to end.

### Phase 2 — Remaining articles

- **L-10 … L-15** Articles #2–#7 in the table order. One ticket each: copy, embed,
  OG card. #6 ships alongside Driftfield and links to it.

### Phase 3 — Driftfield

- **D-1** `src/components/tools/driftfield/` — absorb the six engines. Shared
  shell: mode picker, param panel, Chroma Lab's palette control, PNG export at
  screen resolution.
- **D-2** Routes `/tools/driftfield` + six mode sub-routes, each with its own
  `seoTitle` and OG card. Per the naming section, sub-routes not query params.
- **D-3** 301 the six `/games/*` slugs → matching Driftfield modes. Retarget, do
  not delete — those URLs carry what little equity exists.
- **D-4** Remove the seven entries from `src/config/games.ts` and their
  `GAME_TAGS` rows; drop the CSS/import lines from `src/pages/games/[slug].astro`.
  Games drops 14 → 7 (five real games, poker, flash-cricket). Delete Chroma Lab's
  standalone entry once its palette lives in Driftfield.
- **D-5** `npm run og` for every changed page; commit the PNGs.

### Phase 4 — Tools

- **T-1** Token Bench: merge Codec Forge + Hash Smith, add **JWT signature
  verification against a pasted JWK**. The verification is the point — decoding a
  JWT is the beginner version, and it is the one thing in this group that clears
  the AGENTS.md bar. 301 both old slugs.
- **T-2** Deepen + rename JSON Tidy, List Forge, Regex Lab. Constraint from you:
  richer, still simple. Each needs one capability a static page cannot do —
  otherwise it stays a thin page under a new name. Name proposals before code.
- **T-3** MD Enhanced → writing tool + mind map. Outline pane ⇄ node graph, same
  document. Reuses I-1's canvas.
- **I-1** Ideation canvas, new tool. Cytoscape.js, the Snap Call Screen Map
  framework: multi-layout (flow / band / force), filter rail, detail panel,
  Mermaid export. **Lazy-load Cytoscape on this route only** — it is ~400KB and
  must not touch any other page's bundle.

### Phase 5 — Projects

- **P-1** Rewrite `src/config/projects.ts` from "my GitHub repos" to "what I run
  in production": this site (Astro SSR, Docker/OCI, Cloudflare edge caching,
  origin locked behind a shared-secret transform rule), Webhook Inspector, Type
  Trial (daily seed, server-validated leaderboard, anti-cheat), Poker Together,
  Driftfield. Drop excalidraw-cli. No interface change needed — point `url` at the
  live thing and put the repo link in the markdown `description`.

### Throughout

`npm run build` green, `npm run security:smoke` passing, `npm run graph` before
commits with structural changes, and AGENTS.md updated in the same change —
"Current config keys" gains `learnings`, and the admin checklist stays accurate.

---

## Deferred: ads

Recommend not yet, on two project-specific grounds rather than general ones.

AdSense requires opening the CSP wide, which this project currently refuses even
for Cloudflare's own analytics beacon. And it costs LCP/CLS — the exact metric the
reach goal depends on, on the exact pages (tools, games) that already strip fonts
and ClientRouter to protect it.

At current traffic it earns cents while taxing the thing being grown. Revisit when
a single page is doing real numbers.

## Keyword reality check (2026-08-18)

Everything above was written from assumption. 26 terms were then checked against
**real page-1 results**. Findings that change decisions:

| Claim | Verdict |
|---|---|
| Head terms unwinnable | **Supported**, wrong mechanism. Not Canva/Adobe — Google has redefined "wallpaper generator" as *AI text-to-image*, so a procedural tool would convert badly even if it ranked |
| Per-engine long tail is winnable — **the six-route justification** | **Contradicted.** "flow field generator" is a fluid-dynamics query (USPTO patents, arXiv, an ML airfoil repo; zero browser tools). "boids simulation online" is held by Reynolds' own 1986 page. Only reaction-diffusion is genuinely open — and the best-ranking site on this material uses **one combined page**, which argues for consolidation |
| Best-shaped term | **`perlin noise generator online`** — and it was not in the plan at all. Page 1 is a Streamlit free-tier subdomain, an itch.io page and small personal sites: authority is not the gate there |
| JWT verification is a differentiator | **Contradicted.** devglan, jwtdecode.dev, token.dev and jwt.rocks all verify already. The real gap is **JWKS-by-`kid`**, which nothing on page 1 surfaces. Token Bench copy corrected |
| Explainers can rank | **Only two of four.** `perlin noise explained` and `boids algorithm` are held by personal blogs, none interactive — a real opening. `conway game of life` is `no-chance` (Cornell, conwaylife.com, 55 years). `turing pattern explained` is Nature / Royal Society / bioRxiv — that topic's opening is *tool*-shaped, not article-shaped |
| ReDoS is scarce | **Supported.** That SERP is padded with a Wikipedia article on *Robust Random Early Detection* — an unrelated acronym |
| `json formatter` hopeless, `json diff` thinner | First half supported (`no-chance` — explains why JSON Tidy draws nothing). Second half **contradicted**: five of ten results are exact-match domains (json-diff.com, jsondiff.com, jsoncompare.com…). Thin on brand, not on difficulty |

**What this cannot say: there is no search volume in any of it.** Difficulty
without demand is half a decision, and it cuts hardest against the best-looking
results — a weak, padded SERP means either "nobody built this" or "nobody wants
this", and those are indistinguishable from search results alone. Also absent:
ranking positions, and whether AI Overviews absorb the click entirely.

**Do not extend the six-route pattern to new engines on this reasoning.** The
existing routes are left standing because they cost little and the `/games/*`
301s are right regardless — those pages had the wrong intent whatever the volume.

## Open

- **T-2 — names picked, not yet applied.** Proposed, awaiting a decision:
  Regex Lab → **Thicket**, JSON Tidy → **Plumb**, List Forge → **Winnow**.
  (Avoid *Backtrack* for the regex tool despite it being the obvious term —
  BackTrack was the Linux distro that became Kali, a live collision with exactly
  this tool's audience.) Renaming changes slugs, so all three want doing in one
  commit with 301s, regenerated cards and a sitemap shift.

  Renaming alone does not fix the thin-page problem. Per the keyword check
  above, the capability worth adding is **ReDoS detection in Thicket** — the one
  genuinely under-served SERP of the three, and it clears the AGENTS.md bar
  (bounded server-side analysis, shareable permalink) where a regex tester
  cannot. `regex tester` itself is `no-chance` and is already banned by the
  repo's own "do not ship another regex tester" rule.

- **The four remaining `-Forge/-Lab/-Smith/-Wizard` names**: Codec Forge,
  Hash Smith, Epoch Wizard, Chroma Lab. Suggested: Sift, Fingerprint (or Assay),
  Meridian, Pigment. Cosmetic; batch with T-2 if done at all.
- **Editable maps.** Both Trellis and MD Enhanced's map are navigators; the map
  never writes back into the markdown. Dragging a node to reorder a section means
  rewriting the document correctly, which is a larger build than everything else
  in T-3 combined. Deferred deliberately, not forgotten.
- **Pre-existing bug, unrelated to this work:** a blob-worker creation is blocked
  by CSP on every tool page (`script-src` has no `worker-src` fallback). Visible
  in the console on `/tools/json-tidy`, which none of this touched. Worth finding
  what spawns it before deciding whether to add `worker-src`.
- **The highest-value next step, and it needs no code: export Google Search
  Console → Performance → Queries, 90 days.** The site already ships these exact
  engines, so GSC settles at *this site's real authority* what SERP scraping
  structurally cannot — near-zero impressions means no demand; impressions at
  position 30 means demand exists and the gap is content and links. Pair with
  `data/visits.json` from prod for origin-render shape per path.
