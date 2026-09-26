# Hero Lab round 3: what changes (read BRIEF.md first; all of its rules still hold)

## What the owner said about round 2

- He likes all three concepts graphically, and says they are much better.
- He does not want tools and games referenced on the home screen in any form. That means no names, no hidden labels, no hover or discovery cards, no scratch-to-reveal, and no counts. His words: "don't even display their name".
- In their place he chose **his clock**. The scene runs on Aman's own local time: amber by day (payments), violet by night (building). A visitor can drag through a whole day and watch the scene change.

## What the shell now gives you (`hero-lab-r3.html`)

**`env.data`** holds only these fields; the tools, games, sections, counts and paths are gone from the data:
- `name`, `handle`, `line` (the tagline) and `role`.
- `clock: { tz: 'Asia/Kolkata', city: '' }`.

It also has these helpers:
- `localMinutes()`: minutes past midnight in Aman's zone, right now.
- `dayness(min)`: 0 is deep night and 1 is full day. It eases through dawn (05:30–07:30) and dusk (17:30–19:30).
- `formatClock(min)` and `shiftLine(min, isNow)`. `shiftLine` is the one status sentence, for example "It's 11:52 pm IST · night shift: building".

**`HeroLab.clockScrubber(host, env, onChange)`** is a shared 24-hour scrubber that pins itself along the stage's bottom edge. It shows `shiftLine` plus a "back to now" button while the visitor is scrubbing. It follows the live clock and drifts back to now five seconds after the last drag or key press.
- It returns `{ el, minutes(), isNow(), dayness(), start(), stop(), destroy() }`.
- `onChange(minutes, isNow)` fires on every change.
- Call `clock.start()` from your `start()`, `clock.stop()` from `stop()`, and `clock.destroy()` from `destroy()`. Create it inside your root, as the last child, so it sits on top.

**`env.clockReserve`** is 72. Keep the bottom 72 CSS px of the stage free of your own text and controls, because the scrubber owns that strip.

**Test hook:** `?at=HH:MM` pins "now", for example `?at=14:30` for day or `?at=23:30` for night. Your existing `?scale=` hook stays as it is.

## Required changes to your module

1. **Delete every tool, game and writing reference.** Remove the code, don't hide it.
   - This covers name lists, labels drawn into textures, word masks and reveal logic, discovery chips, keyboard work-lists, the counts and countdown status line, section buttons, the Deep Shore link, and every `env.openLink` call.
   - Also remove `readPixels` reveal loops and anything else that existed only for discovery.
2. **Keep** the big name, the tagline, and your concept's own toy (drag, click, hold, wheel, comets and so on).
3. **Add the clock.**
   - Create the scrubber, and drive your visuals from `dayness`. Use `onChange` for the scrubbed value, and `clock.dayness()` whenever you need the current one.
   - The first frame must already show the real current time. Use `dayness(localMinutes())`, which the `?at=` hook overrides.
   - Scrubbing the day must visibly transform the scene. That transformation is the whole point.
   - Ease towards the target dayness over about 0.4 s in the loop rather than snapping. Under reduced motion, re-render your still frame on each change instead.
4. **Your concept's day and night.** These are starting points; make them beautiful.
   - **Liquid:** by day the emitters pour mostly amber, with a thin violet thread; by night, mostly violet. At dusk and dawn both pour and meet. New ink takes the current colour while old ink keeps its own, so scrubbing paints the day into the fluid. The background deepens at night.
   - **Black hole:** by day the accretion disk runs hot, amber to white, with warm starlight and a brighter photon ring. By night the disk turns violet, the stars cool, and the glow on the name follows.
   - **Fractal:** the palette phase comes from the clock, so day uses the amber bands and night the violet ones. Depth may shift the phase a little, but the clock leads.
5. **Lift your copy block** so nothing overlaps the scrubber: bottom offset ≥ `env.clockReserve + 12`.
6. **Rewrite `notes`** (`what`, `play`, `cost`):
   - Leave out tools and games.
   - Say that the scene runs on Aman's time in India, and that dragging the strip at the bottom scrubs through his day.
   - Plain sentences, with no em-dash asides.

## Testing (look once, fix once)

- Open `file://…/hero-lab-r3.html?c=<id>&scale=0.85` and take these shots:
  - `&at=14:30` (day) at 1440×900;
  - `&at=23:30` (night) at 1440×900 and 390×844;
  - one mid-drag at 1440×900: press on the scrubber track and move to about 06:30, then shoot during the drag.
- Save them to `shots-v3/<id>-day.png`, `<id>-night.png`, `<id>-night-m.png` and `<id>-dawn-drag.png`.
- Pass criteria: no console errors from your file, and `scrollWidth === clientWidth`.
- Grep your file for tool and game names, `openLink`, `tools`, `games` and `daily`. Nothing may remain except the tagline, which comes from `env.data.line`.
- Then make one pass of fixes.

## Output size

- No more than ~150 lines per tool call.
- Run `node --check` after each piece.
- Keep your thinking brief.

## Report (≤200 words)

What changed, how day and night look in your concept, the screenshot paths, and any limitations.
