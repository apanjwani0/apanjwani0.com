# Hero Lab round 2: shared brief (read all of it)

## Why round 2 exists
The site owner tried three restrained prototypes (a constellation map, a particle name and a terminal) and called all three **boring**, for four reasons:
1. **Too quiet.** Dark, small dots, low contrast; nothing grabbed them in the first second.
2. **Seen it before.** They read as portfolio templates.
3. **Nothing to play with.** They wanted to mess with it and lose a minute.
4. **Doesn't say "me".** It told a visitor nothing about who they are or what they build.

Your concept must fix all four. If a screenshot of your first frame could pass for a generic "cool dark portfolio", it has failed.

## Who this is for
Aman Panjwani (handle apanjwani0) is a backend engineer who builds payments at scale by day (SDE 2 at Chalo) and apps, developer tools and games by night. The site hosts 16 real tools and 7 real games, some of them server-backed and technically deep: a TLS chain inspector, a DNS resolver diff, a JWT verifier, exact poker equity by full enumeration, and a Mandelbrot explorer. The audience is developers.

## The identity thread: day and night
The tagline is "payments at scale by day; apps, tools and games by night". Use it as the colour system:
- **Day = warm amber** `#ffb35c`, with hotter tints toward `#ffe2b8` and white.
- **Night = electric violet** `#9b8cff`, with deeper tones toward `#3b2f8f` and `#1b1452`.
- The site's background is `#05070c` and its text colour is `#dde6f2`.

The concept should make those two colours meet, mix or collide in a way the visitor causes. That is the "says me" layer. Also include these, derived from `env.data`:
- The name, big: Source Serif 4, weight 600, around `clamp(3rem, 9vw, 7.5rem)`.
- The tagline.
- One small mono status line of real facts, for example `16 tools · 7 games · 1 article · next daily in 03:12:44` (a live countdown from `data.msToNextDaily()`).
- Three real section links, tools / games / writing (`data.sections`), as real `<button>`s that call `env.openLink(path)`.

## Hard rules
- **Contract:** implement exactly the `HeroLab.register({...})` contract documented at the top of the `<script>` in `hero-lab.html`. Your file is plain JS (no modules, no imports), wrapped in an IIFE, and calls `HeroLab.register` once. Build every node inside `host`, never touch anything outside it, and add no global CSS: inject a `<style>` element INSIDE `host`, with every selector scoped under a unique root class such as `.lq-root`.
- **Code:** no external libraries, fetches or images. WebGL2 is preferred, with a WebGL1 fallback if cheap. Write original code, not code pasted from a known project.
- **Honour `env.reduced` (prefers-reduced-motion):**
  - Render one beautiful still frame.
  - Keep interaction that doesn't need motion (links, hover states).
  - No autoplay animation and no continuous rAF.
- **Honour no-WebGL:** if context creation fails, render a static CSS poster in the concept's palette (layered radial gradients), with the name, tagline and links still working.
- **Performance:**
  - Render resolution adapts: start at 0.6–1.0 × dpr (0.5 when `env.lowPower`). Measure frame time and drop the scale if it averages over ~22 ms, but never below 0.35.
  - No per-frame allocations.
  - `stop()` must actually cancel rAF and timers, and `destroy()` must lose the GL context (`WEBGL_lose_context`), remove every listener and empty `host`.
  - It should hold ~60 fps at 1440×900 on a mid laptop.
- **Pointer input:** pointer events only (mouse, touch and pen). On touch, never block page scroll unless the user is clearly interacting with the scene (`touch-action: none` on the canvas is acceptable because the stage is a bounded box).
- **Accessibility:**
  - Give the canvas `role="img"` with an `aria-label` describing the scene.
  - Links are real buttons with visible focus (`outline` in violet).
  - The name is real text, either the visible DOM text or an sr-only `<h1>` if the text is drawn on the GPU.
  - Text over motion must stay legible (WCAG-ish contrast): use a local darkening or glow behind the type, not a frosted-glass panel.
- **Avoid the AI look:** no purple-to-blue gradient blobs, no glassmorphism cards, no emoji, no rounded-card grids. The motion and light are the design; keep everything else quiet and precise.
- **Complete at rest:** the first frame, before any input, must already be striking, so include an idle choreography that animates on its own (unless reduced).
- **Copy:** plain and direct. No marketing voice, no em-dash asides.

## Notes object (shown under the stage)
Write `notes: { what, play, cost }`, each 1–3 plain sentences:
- **what:** what it is.
- **play:** how you play, including the hidden discovery.
- **cost:** cost and fallback: GPU cost, what reduced-motion and no-WebGL users see, and what shipping it on the real site would take.

## Testing (look once, fix once)
1. Use the global Playwright: `import { chromium } from '<output of npm root -g>/playwright/index.mjs'`. Chromium is preinstalled and PLAYWRIGHT_BROWSERS_PATH is set; never run `playwright install`.
2. Launch with `args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']` so WebGL works headless. It is software GL and slow, so judge looks, not fps.
3. Open `file://<abs path>/hero-lab.html?c=<your-id>`. The Google Fonts request fails in this sandbox (TLS proxy), so the serif falls back to Georgia; that is expected and fine.
4. Take screenshots at 1440×900 and 390×844 after ~3 s, plus one after a scripted pointer drag across the stage, into `shots-v2/`. Check for no console errors from your file and no horizontal overflow.
5. Then make one pass of fixes. Don't loop.

## Report back (under 300 words)
File path and size, screenshot paths, what you built, how it answers each of the four complaints, and known limitations.
