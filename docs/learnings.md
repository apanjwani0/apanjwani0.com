# Learnings: writing and embeds

How a learnings article is written and how it mounts a live component. The voice
is in [plans/learnings-voice.md](plans/learnings-voice.md).

## Writing, not just rendering

`docs/plans/learnings-voice.md` is binding on every article, its hard bans
included. The format: 350–550 words of prose, a visual beat every one to three
lines, and a read time on the page. A study may settle a question the reader is
already asking; it may not be the reason the article exists.

- **`{{embed}}` places the figure, and `{{embed:view}}` places the same
  component pinned to one view** with the picker dropped. `splitOnEmbeds()`
  (`src/lib/markdown.ts`) splits the article on them. With no marker the figure
  goes after the prose. An unknown view falls back to the full picker, so the
  smoke test checks every shipped marker against the component's view list.
  With many figures on a page, playback follows an `IntersectionObserver` and a
  deliberate pause is remembered (asserted).
- **Read time is derived** (`readingTime()`: the prose plus 8 s per figure),
  never stored.
- **Editorial marks**: `==highlight==`, `>> pull quote` and
  `:::note|key|aside|warn` callouts are markdown extensions in
  `src/lib/markdown.ts`, not raw HTML. Each parses its body back through marked,
  and the callout kind is matched against a fixed list. `>` stays a real
  blockquote.

## Articles that mount a live component

A learning's optional `embed` names an `EMBED_TAGS` key. The route mounts it
through `mountEmbed()` (`src/lib/game-mount.ts`), which strips the component's
own chrome and runs the same `mountGame()` dispatch `/games/[slug]` uses.

- `game-mount.ts` is the only copy of the dispatch, and `games-embed.css` the
  only list of component stylesheets.
- A component's own `<h1>` and blurb are stripped by a `MutationObserver`, not a
  sweep after mount: the markup lands before or after `astro:page-load`
  depending on the module cache. One observer per container, released at the
  next `astro:before-swap`. A figure that writes no chrome is in
  `EMBED_NO_CHROME` and gets no observer (derived both ways).
- An unknown `embed` degrades to a prose article; the smoke test asserts every
  shipped `embed` is in `EMBED_TAGS`.
- **An article that quotes numbers is quoting the component, and the numbers
  need an assertion.** Recompute them independently of both article and
  component (Maze Weaver's 3×3 counts), in every field that repeats them
  (`content`, `summary`, `metaDescription`; the field list is derived). And
  recompute from the definition, not a remembered formula: the pot-odds
  break-even is found by bisecting `EV(call) = 0`.
- `diagram-atlas` (`src/components/games/diagram-atlas/`) is an article-only
  figure drawn as inline SVG, so its labels are selectable. Its claims live in
  `atlas.ts`, and every view has a full legend. Structural views (class, ER)
  never animate and behavioural ones must; every beat lights an element that
  exists, tokens stay inside the viewBox, and only the activity view may show
  two tokens. Its deployment view draws a generic stack and never names the
  host. All asserted.
- `internet-atlas` (`src/components/games/internet-atlas/`) is the same kind of
  figure for `/learnings/how-the-internet-works`: eight stops, each with a legend
  saying what it is, what it does on this trip and what happens when it goes
  wrong. Every view animates. It draws with the `at-*` vocabulary styled in
  `diagram-atlas.css`, and its clock is a copy of the Diagram Atlas's (fold the
  two into one engine if a third figure arrives). Its example addresses come
  only from the documentation ranges, and it never names the host. All
  asserted, like the Diagram Atlas.
