# Monsoon hero: handoff

## Status (2026-09-28)
**Finished and on `feat/home-hero`, awaiting the owner's review on the dev server
(`/?hero=monsoon`).** Production still renders the classic hero. The full gate is
green: `build`, `check` (0 errors), `security:smoke`, `poker:check`, `boot:check`,
and the new `harness/match-check.ts`.

`wip/monsoon` (the cloud session's part-built state) and `wip/ui-refresh-notes`
(whose `hero-lab/monsoon-wip/` snapshots this supersedes) can both be deleted.

The durable rules, and the bugs behind them, are in AGENTS.md under
*Home hero candidates → Monsoon*. Read that first; this file is the design record.

## The concept, in one paragraph
A cyberpunk megacity at night, seen from a dark room through a rain-covered window:
- Drops run down the glass and refract the neon, and the fogged glass wipes clear under the
  pointer.
- A matchbox and a pillar candle sit on the sill. You pick up the match and strike it across
  the box. It sparks, sometimes fizzles, then flares, and its smoke catches the neon. You can
  light the candle, and flicking the match puts it out; spent matches pile up.
- Scrolling runs the owner's day in IST (night, then night shift, dawn, day shift, dusk, and
  back) in an endless loop. The chapters are plain HTML.

The owner's own words, and the realism rules, are in `BRIEF-common.md`.

## Decisions (the owner may overrule any)
- **A candle, not a cigarette.** Recruiters land here.
- **The landing is always night.** Cyberpunk needs it. The clock line shows story time, never
  "It's …".
- **Chapter copy uses only text already public on the site:** the first sentence of
  `site.bio`; `site.tagline`; the GitHub projects from `getProjects`, filtered so no tool or
  game can appear.
- Owner decisions from 2026-09-27 (liquid light to the screensaver pile, network must not
  leak infrastructure, the nav keeps tools and games, Hero Lab references kept) are recorded
  in AGENTS.md.

## What the finishing session changed
Beyond writing `glass.ts` and the missing half of `hero-monsoon.css`:
- **glass.ts** departs from BRIEF-window where the brief's numbers read as drawn, not filmed:
  three static drop layers (fine mist, common sizes, a few big ones) instead of two; static
  drops fade and soften behind the fog (rain outside, condensation inside); running drops
  stay crisp and their trails wipe the fog; smoke alpha is Beer-Lambert (`1 - e^-4s`, the
  brief's `s * 0.9` hid every thin wisp) and smoke above a flame is lit orange by it.
- **city.ts:** the emit and flicker plates fill opaque black before painting.
- **props.ts:** flame light falls off with a 2 cm soft core (it was raw 1/d² in metres and
  whited out the sill); the flame is drawn with its base on the wick or head (it floated
  half its height above); the wax wrap is lighter and objects get a window rim light at
  night and a room-bounce fill by day.
- **smoke.ts / match.ts:** buoyancy 0.09 → 0.8 per unit density, plumes denser and leaving
  the flame's tip at 0.2 v/s, so the plume rises instead of fading at its source.
- **match.ts:** the striker contact now measures depth from the striker's face (no drag
  could light the match before); a scripted strike never fizzles and never swipes past the
  strip; the spring substeps at 120 Hz; the flame's depth easing reaches the wick within
  25 px; a flick is judged in screen heights per second (2.0 for 50 ms, never during the
  ignition flare).
- **index.ts:** under reduced motion the slow tick keeps running while the match is doing
  anything but resting, so a keyboard strike completes.
- **story.ts:** document-relative offsets, a one-pixel early jump, and `data-live` so the
  chapter reveal only hides text while the script runs.
- **camera.ts `tall` FRAMINGS:** tilted up and brought in, so a phone's bottom quarter is no
  longer empty sill.

## Tuning that is still the owner's call
- The look on the owner's own screen at dpr 2 (frame cost measured on an M2: 3.5 ms idle,
  4.9 ms with both flames and smoke at 1425×900; the render scale adapts when frames run
  late).
- Some mid-tower facades in `city.ts` are large flat panels; the blur hides most of it.
- The fizzle odds (22%), the burn time (about 20 s), and the flick threshold.

## Files
All under `src/components/home/hero/monsoon/` unless noted.

| File | Brief | Role |
|---|---|---|
| gl.ts, camera.ts, types.ts, light.ts | shared contract | GL kit, the one camera and the sill placements, scene state, the room's two lights |
| index.ts | — | wires the frame, pointer, keyboard handle, pacing, reduced motion |
| city.ts | BRIEF-window | the view, painted once as night/day/emit/flicker plates |
| glass.ts | BRIEF-window | rain, fog, refraction, compositing, post |
| smoke.ts | BRIEF-smoke | the plume fluid |
| props.ts, label.ts | BRIEF-props | the raymarched sill, box, candle, matches and flames |
| match.ts, story.ts | BRIEF-page | the match sim; scroll → story time, chapters, the loop |
| src/pages/index.astro, src/styles/hero-monsoon.css, src/styles/theme.css | BRIEF-page | markup, styles, the neon tokens |

## Testing
- **The match sim:** `npx tsx docs/plans/monsoon/harness/match-check.ts` (add
  `NODE_OPTIONS=--expose-gc` to measure allocation).
- **The camera:** `npx tsx docs/plans/monsoon/cam-probe.ts` prints where the key points land at
  four screen sizes.
- **Props and smoke in isolation:** `harness/props-harness.mjs` and `harness/smoke-harness.mjs`
  load the modules straight from the dev server (open `/robots.txt`, `setContent`, then
  `import('/src/…ts')`); they were written for the cloud container's Playwright, so point them
  at a local one.
- **In a browser:** `/?hero=monsoon` on the dev server. A background tab pauses
  `requestAnimationFrame`, so screenshots of a hidden tab show a stale frame; drive frames by
  hand from the console if you must capture one.
