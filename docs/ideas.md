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
