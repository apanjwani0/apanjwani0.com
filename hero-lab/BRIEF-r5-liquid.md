# Hero Lab round 5: polish "Liquid light" into the home hero

The owner chose liquid light as the home hero. This round makes it good enough to ship. It is a polish pass on an existing, working module, not a rewrite.

## Where things are

- **Working folder:** `/tmp/claude-0/-home-user-apanjwani0-com/da34734d-9a00-5acf-86dc-099682bd9b1b/scratchpad/hero-lab/`
- **Current module:** `liquid.js`, a stable-fluids WebGL sim. It registers through the `HeroLab.register` contract documented at the top of the shell `hero-lab-r4.html`, which also has the `env.data` helpers:
  - `D.hourColor(min)` → `[r, g, b]` in 0..1;
  - `D.localMinutes()`, `D.dayness(min)`;
  - `HeroLab.clockScrubber(host, env, onChange)`, the shared 24-hour clock bar along the bottom;
  - `?at=HH:MM` pins the time and `?c=liquid` selects the module.
- **Read first:** `BRIEF.md`. Its rules still hold: the contract, performance, accessibility, reduced motion, the no-WebGL fallback and the copy style.

## Do not touch the round 4 files

- Create `r5/`.
- Copy the shell to `r5/hero-lab-r5.html`:
  - title "Hero Lab Round 5";
  - label `round 5 · liquid light for apanjwani0.com`;
  - only `<script src="liquid.js">`, with no `network.js`, which is parked.
- Copy `liquid.js` to `r5/liquid.js` and edit only that copy.

## What is wrong today

Look at `shots-r4/liquid-1820.png`:
1. **The ink reads as dusty smoke, not light.** The colours are pastel and muddy (beige, dull pink), with no glow and no depth.
2. **Plume edges look blocky** at low sim resolution, and there is faint banding in the dark areas.
3. **A plume sits right behind the name,** and the name and tagline lose contrast there.
4. **Some moments are too empty and others too full.** Either one blob dominates the frame or the stage goes dark.

## Goals

1. **Luminous ink on near-black.**
   - Tone-map the dye with a saturation-preserving curve, for example `1 - exp(-k·dye)` per channel, then re-saturate.
   - Add a cheap glow: a downsampled blur of the bright dye, added back softly.
   - Colours must be vivid at every hour. Screenshots at 06:15, 12:30, 18:20 and 23:30 must look clearly different and each beautiful: dawn coral, noon warm gold, dusk rose, night violet. That is the owner's "play more with colours as per the time".
   - The second emitter uses the colour 12 hours away, so every frame has two related hues that mix where they meet.
2. **Smooth, not blocky.**
   - Sample the dye bilinearly: use float or half-float linear filtering when supported, otherwise do bilinear in the display shader.
   - Raise the dye resolution on desktop if the budget allows.
   - Add ordered or hash dithering in the display pass to kill banding.
3. **The text stays readable.**
   - The name, the tagline and the clock line keep at least 4.5:1 contrast against what is behind them.
   - Keep the emitters' paths mostly away from the bottom-left text block, or dim the dye under it (a soft vignette in the display shader, where the text sits), or both.
   - Ink may pass behind the text, but dimmed.
4. **Always alive, never flooded.**
   - Tune idle emission, dissipation and vorticity so the stage keeps two to three moving plumes. It should never go dark and never saturate into one flat colour.
   - Check frames 3 s, 8 s and 15 s apart.
5. **Interaction stays.** Pointer and touch stirring plus the click burst. No instruction text anywhere; the hint was removed on purpose.
6. **Mobile.**
   - When `env.lowPower` is set: lower the sim resolution and use fewer pressure iterations.
   - It must look good at 390×844 with no horizontal overflow.
7. **Reduced motion.** Pre-simulate a few hundred steps offscreen, then show one still, beautiful frame tinted by the current hour. Never animate. Scrubbing the clock re-renders the still frame in the new colour.
8. **No WebGL.** The CSS poster is tinted from `D.hourColor(D.localMinutes())`.

## Hard rules

- The name, tagline and clock text are DOM: an `<h1>` for the name, plus `<p>`.
- **No tools, games or writing references of any kind** in the module. `grep -iE "tool|game|openLink" r5/liquid.js` must print nothing.
- **Copy style:** plain sentences with no em-dash asides in any string the page shows, including the notes.
- **The loop:** one rAF loop, which `stop()` halts. No per-frame allocations. dpr ≤ 2. Free the GL context in `destroy()` with `WEBGL_lose_context`.
- **No external resources.**
- **Notes:** update `notes` (`what`, `play`, `cost`) to match what it does now.

## Test (look, fix, look again)

- **Setup:** global Playwright, launched with `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --disable-lcd-text`. See `liquid-r4-check.mjs` for the pattern. Load `file://…/r5/hero-lab-r5.html?c=liquid&at=HH:MM`.
- **Screenshots** go to `shots-r5/`:
  - desktop 1440×900 at the four hours above, about 8 s in;
  - one desktop frame at 18:20 taken 15 s in;
  - 390×844 with `hasTouch` (do NOT set `isMobile`; the shell has no viewport meta);
  - reduced motion.
- **Pass criteria:**
  - no page errors (ignore the Google Fonts certificate error from the proxy);
  - `scrollWidth === clientWidth`;
  - the grep above is empty.
- View your screenshots and judge them honestly. If a frame looks muddy, blocky or unreadable, fix it and shoot again.

## Output size

- No more than ~150 lines per tool call; edit in pieces.
- Run `node --check` after each piece.
- Keep your thinking brief.

Report in under 200 words:
- what you changed;
- the four screenshot paths;
- anything you could not get right.
