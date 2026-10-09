# Key Conventions

The full text of the conventions summarised in [AGENTS.md](../AGENTS.md). Most
are asserted by `npm run security:smoke`.

- **Every tool renders `div[data-type="tool-page"]`** with
  `data-tool="<dir-name>"`. That root supplies the workbench width
  (`--tool-width`), the gutter, the focus ring and `<kbd>` styling. A tool styles
  its internals, never its own container width. Asserted.
- **Tools, games and Driftfield modes share one frame**: `--tool-width` (70vw,
  floored at 1120px and capped at 1800px), one left edge for the breadcrumb, the
  title and the content, at every viewport width. A tool draws it on its root. A
  playable game page asks `Base` for `workbench`, which makes `main` the same box
  (it is border-box and carries the gutter, so that page's breadcrumb takes no
  `inset`), and a Driftfield mode wraps its page in the tool root. No game or
  engine caps its own root (the cap does nothing in an article's 728px column and
  is a second, narrower column on a game page), and no game renders the tool root
  (that doubles the gutter). A page outside `main`'s gutter, which is every
  tool page, gives `RelatedLinks` and the SEO block `inset`. Asserted.
- **A tool page links only its own stylesheet**, `tools/<slug>/<slug>.css`,
  through a `?url` glob in `tools/[slug].astro`, after `tools-common.css`. A
  static import of a per-tool sheet, in the route or in a tool module, puts it
  in every tool page's head: Astro hoists the CSS of every module a page's
  script can reach. Asserted.
- **No bundled script is inlined.** Vite inlines a small `<script>` chunk by
  default, with no nonce, and the CSP refuses it; `assetsInlineLimit` in
  `astro.config.mjs` keeps every script a file, and every `?url`-linked
  stylesheet too (a data: stylesheet is refused the same way). Asserted.
- **A tool's claims live in a module, not in the component**
  (`webhook-inspector/signature.ts`, `cron-whisperer/schedule.ts` and
  `crontab.ts`, `token-bench/diagnose.ts`, `chainsaw/analyze.ts`,
  `deep-shore/escape.ts`, `dns-sightline/analyze.ts`, `src/lib/jwt.ts`), so
  `security:smoke` can run them against the real thing.
  - **A diagnostic proves every cause it reports and reports none it can't.**
    `token-bench/diagnose.ts` changes one input per hypothesis, re-runs real Web
    Crypto, and reports only causes it watched start verifying; findings carry
    `proof: 'verified' | 'structural'`. The load-bearing assertion is negative
    (a simply-wrong key yields zero causes), and the label is asserted on every
    producer: `inspectTokenText` holds no key, so it can never emit `verified`.
  - **A crontab names a wall clock, not an instant.** Cron Whisperer resolves
    each wall-clock tuple to 0, 1 or 2 instants, and Vixie's rule decides what
    is made up across a DST jump: only a job with no `*` in its hour and minute
    fields runs "at a fixed time". The engine walks wall readings but returns
    instants, so every termination decision must be taken in instant order. The
    smoke test's brute-force oracle is valid only for non-fixed-time schedules.
    Two readings are flagged, not resolved; settle them against real cronie
    before changing either: `restricted` is `token !== '*'` (the man page, not
    Vixie's source), and a bare `TZ=` line. `crontab.ts` is the file grammar (a
    `CRON_TZ=` or `TZ=` applies downward only); `schedule.ts` is the semantics.
- **A hot path replaced for speed keeps the slow one as an untouched reference
  and asserts equality.** Poker's `evaluateBest` defines what a hand is worth;
  `scoreBest` is the fast path, checked against it over all 2,598,960 five-card
  hands. Deleting the slow one removes the only definition the fast one is
  checked against.
  - A memo (`poker-trainer/engine/equity-cache.ts`) keys on its arguments,
    never on something supplied alongside them (`cachedEquityVsRange` keys on
    the combos, not the range text). A canonicalisation is a claim about the
    function underneath, so assert the invariance both ways. Cards are sorted
    within a hand, but the two hands are never swapped.
  - Deep Shore keeps `dsEscapeReference` beside `dsEscape`, proved equal over a
    34,000-point grid. Orbit periodicity detection is absent on purpose, and
    zoom-at-cursor is asserted as a fixed point. A share link's precision comes
    from the zoom (`dsCoordDigits`: the round trip stays within half a pixel of
    a 3840 px canvas; `DS_MAX_ZOOM` states the double's floor). Tours move at a
    constant apparent speed: `log(zoom)` is linear and the centre follows
    `dsPanWeight`; the smoke test requires the naive linear pan to fail, and end
    frames are exact (`dsSegmentViewAt` is tested directly).
- **A cost ceiling is written in the unit that actually costs.** The poker
  trainer bounds five-card reads (`PT_MAX_RANK_WORK`, via `handsRanked()`), not
  boards. `PT_MAX_RANGE_WORK` is a lesson setting (which street a drill is dealt
  on), so changing it is the owner's call.
- **Canvas export is shared.** `attachCanvasExport(host, () => canvas, { name })`
  from `src/lib/canvas-export.ts` (with `src/styles/canvas-export.css`) gives PNG
  at a chosen scale, a live-recorded GIF and a preview before saving. Don't
  hand-roll `toDataURL` downloads. An engine that renders on demand passes an
  `AnimationSource` as `options.animation`, with `liveGif: false`: its frame
  count comes from a measured frame, held end frames reuse the last ImageData,
  and a second click stops the render. Every bar joins one registry served by
  one guarded pair of swap listeners (`trackBar`).
- **One copy of each client helper.** A tool or game imports these rather than
  writing its own, because private copies drift (seven escapers had lost `'`,
  two copy buttons said "Copied" on failure): `escapeHtml` (`escape.ts`);
  `lsGet`/`lsSet`/`lsRemove`/`lsGetNumber` (`storage.ts`, never throws, keys
  unprefixed); `copyText` (`flash.ts`: Clipboard API, textarea fallback, one
  "Copied" / "Copy failed" flash); `downloadBlob`/`downloadDataUrl`
  (`download.ts`, no encoder pulled in); `formatBytes` (`format.ts`);
  `clamp`/`cappedDpr` (`math.ts`); `prefersReducedMotion` (`motion.ts`);
  `MS_PER_DAY` (`date.ts`). None touches the DOM at module scope. A private
  wrapper survives only where `security:smoke` asserts its literal text.
- **Pages share their building blocks.** A detail page builds its visible
  trail and BreadcrumbList JSON-LD from one list (`buildBreadcrumbs`), every
  JSON-LD block goes through `<JsonLd json={…} />` (it reads the nonce; feed it
  only `src/lib/jsonld.ts` output), except `projects.astro`'s ItemList, whose
  inline `<script` the smoke test matches, and the hubs render `Card.astro`, the
  one card anatomy. `tools/[slug].astro` renders one `<slug>-tool` host.
- **The "server" badge on `/tools` is derived.** `SERVER_TOOLS` lives in
  `src/lib/tools.ts`, not `src/config/tools.ts`, which `/admin` regenerates
  wholesale. Asserted: each slug is `live` and calls an `/api/` route, and the
  number word in the intro copy matches the set's size. The `/games` intro's
  daily count is checked against `DAILY_SLUGS` the same way.
- **Semantic elements and `data-type` idioms**: style standard elements and
  `data-*` attributes rather than custom classes, with tokens only. Oat is a
  base layer the site builds on, not the design system. A component Oat lacks
  is built here, small and dependency-free. Fixes to Oat's own rules go in the
  fork; anything site-specific stays in this repo.
- **SSR everywhere**, `/tools` included: KV reads and the middleware headers
  need it.
- **SEO support copy is off.** `seoContent` still renders when set, but every
  entry ships empty: generated how-to and FAQ filler is boring, and dropping it
  is a deliberate SEO trade-off. Anything added there must earn its place like
  an article.
- **StarField** runs behind the plain pages that keep `Base.astro`'s default
  (the 404, blogs, a learning with no figure). Keep it off tool and game detail
  pages (CPU), the card hubs and the home page, whose hero draws its own stars.
  A new listing page passes `starfield={false}`.
- **The sky** (`src/lib/sky.ts`) is the home hero's drifting stars and
  constellations. The tools, games and learnings hubs draw it as their
  background (`Base`'s `sky` prop, mounted by `src/lib/sky-ui.ts`, owner
  2026-10-01): about half the hero's density, at most ~30 fps, stopped while
  the tab is hidden, one still frame under reduced motion, the canvas capped at
  1.5 device pixels. Listing cards are opaque so no star lands in their copy.
  Only those three hubs render it. Asserted.
- **Tool and game detail pages** pass `clientRouter={false}` (no router bundle)
  to `Head`.
- **Fonts are self-hosted and load on every page.** Source Serif 4 and JetBrains
  Mono (variable, Latin subset, OFL) live in `src/assets/fonts`;
  `src/styles/fonts.css` declares them, Vite hashes them into `/_astro/`, and
  `Head` preloads the two upright faces through the same `?url` import. Each
  family has a metric-matched local fallback face (`size-adjust` and the
  overrides, measured over the site's own text), so the swap moves no text.
  Serif is for reading (titles, prose, card titles), mono for operating
  (controls, labels, nav, code). No stylesheet names a family: everything reads
  `--font-serif` or `--font-mono`, so a typeface changes in one token. No Google
  Fonts host, and CSP `font-src` is `'self'`. Asserted.
- **A tool or game holds a skeleton until its element upgrades.** The server
  renders a bare `<h1>` and intro inside the custom element, which the component
  then replaces; raw, it flashed unstyled text and the page jumped. `shared.css`
  keeps the title, hides the rest of a host that is a direct child of `main`,
  and draws a static `--skeleton-height` panel on `html[data-js]
  :is([data-tool], [data-game]):not(:defined)`; without JS the text stays. The
  panel also holds the space of a Driftfield stage and a learning's figure,
  which render empty and would push the page down when they mount. No animation.
  A new tool, game or embed gets it free through its `data-tool` / `data-game`
  attribute.
  - **What follows a pending workbench is `visibility: hidden`, not removed**
    (the footer, the related links, a Driftfield story line). A hidden box is
    not scored, so the panel's height can stay generic (a short tool would
    otherwise pull the footer into view, a tall one push a link out of it).
  - **The tool host keeps the column before and after it upgrades**; only the
    pending host carries the gutter. A host that took the column only while
    pending changed its own box at mount, which the browser scores.
- **Measure layout in an observer, never at module evaluation.** `nav-ui.ts`
  reads the nav's height in a `ResizeObserver` callback, which runs after
  layout; a synchronous read made the script pay for the first layout. Until that
  lands, `main` pads by `--space-header-offset`, which must be the nav's real
  height (64px, 66px stacked on a phone, measured in a browser). Asserted.
- **Sideways overflow is held on `html` and `body` together.** Oat's tooltip is a
  `white-space: nowrap` pseudo-element, laid out even while hidden, so a long one
  on a button near the right edge widens the page. A clip on the root alone does
  nothing to a phone's page width; `body` needs it too. The fix proper is in the
  Oat fork, which owns that rule. Asserted.
- **Flowmap's colours and layout.** A node's colour is a name from
  `GRAPH_TONES` (`src/lib/graph-text.ts`), matched on decode like its shape and
  drawn from the `--tone-*` tokens (set in both palettes, a border plus a faint
  tint under `--color-text`). "Flow" is `tidyTree` (`src/lib/graph-layout.ts`):
  each parent centred over its own children, in either direction. The board
  identifies what is under the pointer (cursor, a lifted node, a "+" handle that
  adds a child on click and connects on drag; on touch it follows the selected
  node). Scroll pans and Ctrl/pinch zooms, taken from Cytoscape in the capture
  phase. The canvas is updated by a diff (`reconcile`), never by removing every
  element: that leaves Cytoscape's pointer-target cache stale. Every graph
  that reaches the canvas (drawn, linked or stored) passes `normalizeGraph`,
  because Cytoscape throws on a repeated id or a dangling edge and a bad stored
  board would keep the tool dead on every visit. `tidyTree` walks iteratively,
  since an outline is as deep as it is long. Asserted.
- **Heavy dependencies load per route.** `cytoscape` is only ever a dynamic
  `import()`: in `Flowmap.ts`'s `connectedCallback`, and in `Draftboard.ts`
  when the Map view first opens. Never import it statically. Every Cytoscape layout
  needs `nodeDimensionsIncludeLabels: true`, or labelled nodes pile up.
- **Client mounting with ClientRouter.** Bundled scripts run once per session,
  so anything that mounts does it inside
  `document.addEventListener('astro:page-load', …)`. Test by clicking an in-site
  link, not by reloading. A `document` or `window` listener added per mount must
  be removed, bound by a `signal`/`once`, or registered once behind a
  module-level guard (asserted over `src/components` and `src/lib`). The router
  replaces every attribute on `<html>`, so client state kept there survives only
  because `initSiteUI()` copies it forward (`patchIncomingDocument`); a new root
  attribute joins `ROOT_STATE_ATTRS`.
- **The adapter is the only deployment-specific code.** Three modules are
  Node-only (`src/lib/link-peek-fetch.ts`, `src/lib/tls-inspect.ts`,
  `src/lib/dns-lookup.ts`) and are reached only from the Link Peek and Chainsaw
  API routes; the build asserts no `node:` import reaches a client chunk. A
  Workers deploy would need another transport for them.
