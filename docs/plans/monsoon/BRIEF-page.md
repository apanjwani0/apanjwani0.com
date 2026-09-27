# Page agent: match.ts, story.ts, the monsoon page markup and its styles

Read BRIEF-common.md first. You own:
- `src/components/home/hero/monsoon/match.ts`: the match and candle simulation. Pure
  TypeScript, no DOM, no GL.
- `src/components/home/hero/monsoon/story.ts`: scroll turns into the time of day, plus the
  chapters, the endless loop and the clock line.
- `src/pages/index.astro`: add the `monsoon` hero, and nothing else changes for the other heroes.
- `src/styles/hero-monsoon.css` (new; import it in index.astro next to the other hero sheets).
- `src/styles/theme.css`: new tokens only.

## 1. match.ts
```ts
import type { Camera } from './camera'
import type { SceneState } from './types'
export interface MatchInput {
  x: number; y: number        // pointer in CSS px from the stage's top-left
  down: boolean               // a press that match.ts claimed is in progress (index.ts claims on hitTest)
  touch: boolean              // a finger: the held head rides 56 px above it so it stays visible
  present: boolean            // a pointer is over the stage at all
}
export type MatchEvent = 'grab' | 'fizzle' | 'lit' | 'out' | 'burnt' | 'candle-lit' | 'candle-out' | 'landed' | 'fresh'
export interface MatchSim {
  /** Advances by state.dt and writes state.matches, state.candle, state.flames, state.sparks and
   *  pushes SmokeSources onto state.smoke. Returns this frame's events in a reused array. */
  update(state: SceneState, cam: Camera, input: MatchInput, cssW: number, cssH: number): readonly MatchEvent[]
  /** What is under a pointer: the active match (to grab), the candle flame (to snuff), or nothing. */
  hitTest(state: SceneState, cam: Camera, x: number, y: number, cssW: number, cssH: number, touch: boolean): 'match' | 'candle' | null
  /** Keyboard and button actions. */
  act(action: 'strike' | 'candle' | 'blow'): void
  /** CSS px rect around the active match for the DOM handle: at least 64×44, 20 px padding. */
  handleRect(state: SceneState, cam: Camera, cssW: number, cssH: number): { x: number; y: number; w: number; h: number }
  /** A new layout (camera mode changed): put everything back at its rest spot. */
  reset(state: SceneState, cam: Camera): void
}
export function createMatchSim(opts: { reduced: boolean; random?: () => number }): MatchSim
```
- **Geometry** comes from `cam.placements` and `MATCH` (camera.ts). A pointer at CSS (x, y)
  is uv `(x / cssW, 1 - y / cssH)`.
- **Memory.** Pool everything: six `MatchPose` objects (the active one plus at most 5 spent),
  64 sparks, and reused events and scratch vectors. `state.matches[0]` is always the active match.
- **Realistic behaviour, with numbers:**
  - **Grab:** a claimed press (index.ts claims when `hitTest` says 'match') within 22 px
    (34 px for touch) of the active match's projected stick.
  - **Held:**
    - *Target.* The head's target is `cam.onPlane(u, v, hold.point, hold.normal)` for the
      pointer.
    - *Candle depth.* Within 90 CSS px of the projected wick, ease the plane point's depth toward
      the wick's, so the flame can really reach it in 3D.
    - *Motion.* The head follows its target with a critically damped spring (ω = 26/s).
    - *Collisions.* Keep the head above the sill (y ≥ 0.0035), out of the box (a box-local
      AABB push-out) and out of the candle (a cylinder push-out).
    - *Stick direction.* `dirBase = normalize(0.78, -0.42, 0.46)`: the tail runs down-right
      toward the viewer, held by fingers off-screen. It swings about the view axis on an
      underdamped spring (ω = 14, ζ = 0.35) toward `-vx * 0.9` rad per m/s, clamped to ±0.6.
      That swing is the "weight".
  - **Strike:** while held, not lit, and `!struck`:
    - *Contact.* Transform the head into box-local coordinates. It is in contact when inside the
      striker's length and height and within 0–6 mm in front of its face.
    - *Heat.* The speed along the strip `|v·along|` above 0.22 m/s adds `heat += speed * dt * 9`,
      and heat decays 0.5/s otherwise.
    - *Sparks.* In contact above that speed, spawn about 90/s × speed at the head, with velocity
      `-0.3v` plus a random spread of 0.3–0.9 m/s biased upward. Gravity is −3.4 m/s², life
      0.25–0.55 s.
    - *Ignition.* At heat ≥ 0.18, roll `random() < 0.78`.
      - Success: ignite with `phase 'lit'`, `struck = true`, flame 1.45 (the flare), a burst of
        18 sparks, a small puff (density 0.25, r 0.012) and event 'lit'.
      - Failure: a fizzle. Heat goes to 0, 10 sparks, a puff (0.3, r 0.01), event 'fizzle', and
        it can be struck again. Real matches don't always catch, and that's the smile.
  - **Lit:**
    - *Flame.* It relaxes from the flare to 1.0 at 3/s. `burn += dt / 22`. Past burn 0.8 the
      flame shrinks, and at 0.92 it goes out (event 'burnt': it reached the fingers).
    - *Motion.* Moving it shrinks the flame (`× 1 - 0.5 * smoothstep(0.8, 2.0, speed)`). Over
      2.0 m/s for 70 ms blows it out (event 'out', puff 0.9, r 0.03).
    - *Lean.* `lean` is the clamped negative screen velocity × 0.5.
    - *Each frame:*
      - push `state.flames` `{ pos: head + (0, 0.008, 0), intensity: flame * flicker,
        kind: 'match' }`, where flicker = 0.85 + 0.15 × smooth noise(t × 9);
      - push a plume `SmokeSource` at the projected flame tip: density 0.35, r 0.01, velocity
        0.3 × the screen velocity plus (0, 0.06).
  - **Out:** `ember` decays from 1 over 2.5 s; one puff at the head.
  - **Release (not lit):** the match falls with its velocity under gravity (about −6 m/s²
    visually). It settles flat on the sill (y = 0.0023, dir.y → 0) with one tiny bounce, then
    event 'landed'.
    - Clamp the landing spot to the visible sill: between the rest spot and the spent slots.
    - An unstruck match dropped this way is simply `rest` where it landed.
    - A struck one becomes spent.
  - **Release (lit):** it falls the same way and keeps burning on the sill at flame 0.7 until
    burnt out, then it is spent.
  - **Spent:** moves into the spent list (at most 5, the oldest removed). After 0.8 s a fresh
    match slides from `trayMouth` to `matchRest` over 0.6 s, ease-out (phase 'sliding', then
    'rest'), with event 'fresh'.
  - **Candle:**
    - *Lighting it.* A lit match whose flame tip stays within 0.012 m of `wickTop` for 0.35 s
      lights the candle. `candle.flame` goes from 0 to 1 over 1.2 s, with event 'candle-lit'.
    - *While lit,* push its flame (flicker 0.9 + 0.1 × noise(t × 6), `kind: 'candle'`,
      pos = wickTop + (0, 0.011, 0)) and a thin plume (0.08, r 0.006).
    - *Snuffing.* A pointer NOT holding a match that crosses the candle flame faster than
      900 CSS px/s snuffs it: event 'candle-out', and the big puff (1.4, r 0.04).
  - **`state.flames`:** brightest first, at most 2.
  - **`act`** (keyboard and the DOM button):
    - *'strike'* scripts it:
      1. move the head to the striker's near end;
      2. swipe along it at 0.8 m/s over 0.3 s;
      3. always ignite;
      4. lift to a hover pose 5 cm above the box and hold there.
    - *'candle'* moves the flame to the wick, lights the candle, and returns to the hover pose.
    - *'blow'* puts out the match if it's lit, else snuffs the candle.
  - **Reduced motion:** no sparks, the flare is instant, and flicker is constant.
- **Verify in node:**
  - Write `scratchpad/site/monsoon/page/match-check.ts` and run it with `npx tsx`, using the
    real `makeCamera(1440, 900)` and a seeded `random`.
  - Drive scripted pointer paths:
    1. grab, swipe fast across the striker → 'lit';
    2. a slow swipe → no ignition;
    3. a forced fizzle;
    4. lit, flame to the wick → 'candle-lit';
    5. a shake → 'out';
    6. hold lit for 22 s → 'burnt';
    7. release → 'landed' → spent → 'fresh';
    8. `act('strike')`, `act('candle')` and `act('blow')`;
    9. the same checks at 390×844.
  - Print pass/fail per check. Also count allocations roughly: run 10k updates and compare
    `process.memoryUsage().heapUsed` before and after a GC (`node --expose-gc`).

## 2. story.ts
```ts
export interface Story {
  minutes(): number          // story time now
  refresh(): void            // re-measure (resize, fonts)
  destroy(): void
}
export function createStory(opts: {
  section: HTMLElement        // the hero section; its data-at is the landing's minute
  story: HTMLElement          // div[data-type="story"]
  hud: HTMLElement | null     // p[data-type="monsoon-hud"]
  reduced: boolean
  signal: AbortSignal
  onTime(minutes: number): void
}): Story
```
- **Anchors.** Scroll maps to minutes piecewise-linearly between anchors:
  - the landing at scrollY 0, with the section's `data-at`;
  - each chapter (`[data-chapter]`) at its `offsetTop - 0.25 × innerHeight`, with its `data-at`;
  - the loop clone (`[data-type="story-loop"]`) at its `offsetTop`, with the landing's minute
    plus 1440.
  - Unwrap forward: each anchor's minutes = the previous + `((at - prevAt + 1440) % 1440)`. The
    output is `% 1440`.
- **The endless loop.** On scroll, once `scrollY >= clone.offsetTop`, call
  `window.scrollTo({ top: scrollY - clone.offsetTop, behavior: 'instant' })`. The clone renders
  exactly like the landing, so the jump is invisible and the story never ends.
  - At the very top it just stops.
  - The clone is `aria-hidden="true"` and `inert` (server-rendered). Screen readers and the
    keyboard get the story once.
- **Updates.** On scroll, coalesce into one rAF. Call `onTime(minutes)` and set the HUD's text
  to day.ts `shiftLine(minutes, false)` (e.g. "11:40 pm IST · night shift: building").
  - Chapters get `data-seen` when they first enter the viewport (an IntersectionObserver).
- **Listeners and measuring.** Window listeners take `{ signal }`. Use a ResizeObserver on the
  story plus `document.fonts.ready`, both of which call `refresh()`. `destroy()` disconnects
  everything.
- **Verify** in the browser: load `/?hero=monsoon`, scroll through (`window.scrollTo`), and read
  the HUD. Confirm the minutes are monotonic, the loop jump is seamless (same text position
  before and after), and there are no console errors.

## 3. index.astro (the monsoon branch)
- **The switch.** Add `'monsoon'` to `HEROES`. The dev switch pill then lists it and `liveHero`
  covers it. Production is untouched: only the dev server reads `?hero=`.
- **The section** (`hero === 'monsoon'`): keep the shared section and its `hero-stage` and
  `hero-content`. Give the section `data-at="1420"` (11:40 pm). Inside it, after the content:
  - `<p data-type="monsoon-hint" hidden>psst… strike a match</p>`
  - `<p data-type="monsoon-hud" aria-hidden="true"></p>`
  - `<p data-type="monsoon-live" aria-live="polite" data-visually-hidden></p>` (use the site's
    existing visually-hidden idiom if there is one; else style it in your sheet)
  - a scroll cue: `<p data-type="monsoon-cue" aria-hidden="true">scroll ↓</p>`
- **After the section,** `<div data-type="story" data-theme="dark">` holds the chapters and the
  clone. The copy is the owner's; do not add or embellish claims:
  - `<section data-chapter="night" data-at="95" aria-labelledby=…>`:
    - kicker `night shift`
    - h2 `My own apps, after hours.`
    - a list of projects from `getProjects(Astro.locals)` (config accessor, never import
      src/config). Show title linked to its url (external: `target="_blank" rel="noopener
      noreferrer"`) and the first sentence of its description, with markdown `**` stripped.
    - Filter out any project whose url contains `/tools` or `/games`, or whose title or
      description matches `/\b(tools?|games?)\b/i`.
    - then `<a href="/projects">all projects →</a>`
  - `<section data-chapter="day" data-at="660">`:
    - kicker `day shift`
    - h2 `Payments at scale.`
    - a p with the FIRST sentence of `site.bio`
    - a small mono line with `site.tagline`
  - `<section data-chapter="dusk" data-at="1180">`:
    - kicker `off the clock`
    - h2 `Say hi.`
    - the same github/linkedin links as the hero (same URL helpers)
    - `<a href="/learnings">learnings →</a>`
  - `<div data-type="story-loop" aria-hidden="true" inert>`: a visual copy of the landing
    content. Render the name as `<p data-type="loop-name">`, never a second h1, then the tagline
    and the links (their tabindex doesn't matter under inert).
- **Scripts.** Keep exactly one `<script>` on the page (the existing `liveHero` block); the
  security smoke asserts it. Don't touch the switch block or the JSON-LD.

## 4. hero-monsoon.css and tokens
- **Scope.** Everything is scoped under `section[data-type="hero"][data-hero="monsoon"]` or
  `div[data-type="story"]`, tokens only.
- **New theme.css tokens,** in `:root`: the neon colours `--color-neon-pink: #ff4fb4;`,
  `--color-neon-cyan: #43e8ff;` and `--color-neon-amber: #ffb35c;` (reuse `--color-day` if you
  prefer), plus `--text-chapter: clamp(2rem, 5vw, 4rem);`.
  - Don't add `--space-*` tokens: the smoke holds that scale to a fixed ladder.
- **Stage.** `div[data-type="hero-stage"]` inside the monsoon section is `position: fixed;
  inset: 0; z-index: 0`. Its canvas is `display: block; width: 100%; height: 100%;
  touch-action: pan-y pinch-zoom`.
  - The section is `min-height: 100svh` and must not clip or transform (a transform would
    trap the fixed stage).
  - Override home.css's live-hero rules where monsoon differs. Read home.css lines 60–130 first.
- **Landing content.**
  - *Wide:* left, from about 7vw, vertically centred slightly above the middle, max about 44vw,
    clear of the objects in the right half.
  - *Tall:* at the top, below the nav (`var(--nav-h)`).
- **h1 (the name) as a neon sign.**
  - `var(--font-serif)` at `var(--text-hero-name)`.
  - A near-white warm core with layered text-shadow glows in `--color-neon-pink` and a cooler
    outer halo. It should read as a lit sign, not blurry text.
  - A slow, irregular flicker: a keyframe animation with a couple of quick dips every ~7 s.
    shared.css already stops animations under reduced motion.
- **Tagline** in `var(--font-mono)`. Links underlined in the neon cyan, with a visible focus ring.
- **Chapters.**
  - Each is `min-height: 110svh` (the loop clone is exactly 100svh, styled the same as the
    landing so the jump is seamless).
  - Content block top-left (wide) or top (tall).
  - Kicker in small mono caps, h2 at `var(--text-chapter)`, the list clean.
  - A soft dark radial scrim behind each text block (`::before`) so text reads over the scene.
  - `data-seen` reveals with a short fade and slide up (the `--motion-*` tokens).
- **Pointer events.** The story and the landing text are `pointer-events: none`, except links,
  buttons and text blocks' own hit areas. The canvas behind receives wipes everywhere else.
- **Fixed elements.**
  - The HUD: fixed bottom-left, small mono, muted.
  - The cue: bottom centre of the landing, fading out.
  - The hint: small mono near the match. index.ts positions it through `--hint-x` and
    `--hint-y`, set on the section.
  - `button[data-type="match-handle"]`: transparent, no chrome, a visible `:focus-visible` ring,
    `cursor: grab` (and `grabbing` when `[data-grabbing]`). index.ts creates and positions it
    with inline `left/top/width/height`.
- **Poster fallback** (`section[data-monsoon-poster]`, for no WebGL): a CSS night gradient
  with a couple of blurred neon glows behind the text.
- **Verify** at 1440×900 and 390×844 with the placeholder entry: the page renders, chapters flow,
  the h1 glows, `npx astro check` is clean, and `npm run security:smoke` still passes. The lead
  updates the smoke block for the new files; if it fails only because of the new monsoon
  files, report it.
