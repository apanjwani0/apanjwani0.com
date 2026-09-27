# Monsoon: common brief (read all of it before your own brief)

## What we are building
The owner of this site (Aman Panjwani, handle apanjwani0, a backend/payments engineer in India)
is replacing his home page hero. His words, 2026-09-27:
- "First reaction should be wow : the home page should be aesthetic."
- "some sort of interaction ... quirky small stuff, which brings a smile on the user"
- "an extremely realistic matchbox ... imagine if you could mock realistically animate how a
  matchstick is lighted when rubbed against a matchbox. It'll be only great if it's HD and real
  and has some weight and assence and not just a 2d drawing."
- About the earlier "liquid light" fluid hero: "I really loved the smoke design and realness it's
  trippy and trance."
- "for starting you can try cyberpunk kinda theme"; tell about himself "not directly at landing
  ... as user scrolls down"; "something which is infinite, which never ends"; "resonates with my
  personality, vibe, career maybe, life maybe but not too much"; "i don't want to leak any of my
  sensitive info".

**The concept, `monsoon`.** A cyberpunk megacity at night, seen from a dark room through a
rain-covered window:
- Drops run down the glass and refract the neon. The lower glass is fogged and wipes clear
  under the pointer.
- On the windowsill sit a matchbox and a pillar candle. You pick up the match and strike it
  across the box. It sparks, and sometimes it fizzles, then flares and burns.
- Its smoke curls up and catches the neon behind it. You can light the candle with it and
  shake the match out, and spent matches pile up on the sill.
- Scrolling moves through one of his days in India: this night, the small hours, dawn, the
  day shift (payments), dusk, and back to night, with no end. The day's chapters are plain
  HTML over the scene.

**Realism is the product.** Judge every choice by one test: does this look filmed, not drawn?
The tricks that buy it:
- **Low-key lighting.** The room is dark, and objects are silhouettes rim-lit by the city until
  a flame lights them.
- **Sharp only where the eye goes.** The drops, the flame and the match are sharp, and
  everything else is soft. The city is never crisp, because a procedural city looks fake when
  sharp.
- **Plausible motion.** Use inertia, springs and gravity. Nothing snaps.
- **Grain.** Add film grain and dither over dark gradients, or 8-bit banding gives the game away.

## Files and owners
Everything lives in `src/components/home/hero/monsoon/` unless noted, and you edit only your own
files.
- **Shared, written by the lead:** `gl.ts`, `camera.ts`, `types.ts`, `light.ts`. READ ALL FOUR
  FIRST; they are your contract.
  - Do not edit them. If you need a change, work around it locally and list the change in your
    report.
  - `camera.ts` has one exception: its `FRAMINGS` table holds numbers only, and the props agent
    may tune them.
- **`index.ts`:** the entry point, which wires the frame. The lead writes it while you work.
- **Window agent:** `city.ts` and `glass.ts`.
- **Smoke agent:** `smoke.ts`.
- **Props agent:** `props.ts`, plus `label.ts` if wanted.
- **Page agent:** `match.ts`, `story.ts`, the monsoon branch of `src/pages/index.astro`,
  `src/styles/hero-monsoon.css`, and new tokens in `src/styles/theme.css`.

## The frame (index.ts, so you know how you are called)
```
cam = makeCamera(cssW, cssH)                 // remade on resize
state: SceneState                            // types.ts, one object for the page's life
each frame:
  state.t += dt (unless reduced); state.dt = dt
  state.minutes/dayness/hour <- story        // story.ts
  events = match.update(state, cam, input, cssW, cssH)
  glass.stepFog(state)                       // consumes state.wipes
  if (smoke && (smoke.active || state.smoke.length)) smoke.step(dt, state.smoke)
  props.render(state, cam, city)             // into props.target
  glass.render(state, cam, { city, props: props.target, smoke: smoke?.active ? smoke.texture : null })
  state.smoke.length = 0; state.wipes.length = 0
```
- The canvas drawing buffer is CSS size × dpr × renderScale. renderScale adapts between 1 and
  about 0.5 when frames run late, and passes get `resize(bufferW, bufferH)`.
- The city plates are drawn once, by `city.ts`. index.ts uploads them with mipmaps as
  `CityTextures` (types.ts) and hands the same textures to glass and props. Until they are
  ready, `city` is null.
- Colour: plates are sRGB canvases. Shaders decode to linear (`pow(c, vec3(2.2))` is fine) and
  light and composite in linear HDR. Only glass.ts tone-maps and encodes for the screen. props
  outputs linear HDR, premultiplied.

## Hard rules (the repo's security smoke enforces several)
- **Type checking:** TypeScript strict. `npx astro check 2>&1 | tail -5` must show 0 errors.
- **No new dependencies:** no new npm packages and no three.js. Use raw WebGL2 through gl.ts.
- **No per-frame allocation** in update or render paths:
  - no array or object literals and no closures created per frame;
  - uniforms come from preallocated `Float32Array`s;
  - pools, not `push`/`splice` churn.
- **Listeners:** any `document` or `window` listener passes `{ signal }` from the opts you
  receive. Element listeners go on elements you create and remove.
- **`location.search`** may only be read as `import.meta.env.DEV && …` within the same
  expression. The smoke requires `import.meta.env.DEV` within the preceding 240 characters.
- **No tools or games words.** No string literal may contain the words tool, tools, game or
  games, in any case. The owner's rule is no tools or games references on the home page, and the
  smoke scans every string literal in the hero's `.ts` files. Also avoid "arcade", "play" and
  anything that hints at them.
- **No infrastructure details** (hosts, providers, runtimes) and no personal details beyond the
  copy the page agent is given.
- **CSS:** tokens only, i.e. colours, fonts and sizes through `theme.css` custom properties.
- **Git:** do not commit, push, or switch branches, and do not edit files you don't own.
- **Chunked writes:** write any file over ~250 lines in chunks of at most ~250 lines per tool
  call. Write the first chunk, then append the rest with Edit or `cat >> file <<'EOF'`.
  One giant Write hits the output-token cap and loses your turn.
- **Performance targets:** 60 fps on a laptop GPU at dpr 2, and 30+ fps on a mid phone when
  `lowPower`. Budget your per-pixel cost and state it in your report.

## How to test
- **The dev server** is already running at http://127.0.0.1:4321. Never start or stop it.
- **Modules load straight from source:** a page on that origin can
  `await import('/src/components/home/hero/monsoon/<file>.ts')` and the server compiles it.
- **A harness page without CSP:**
```js
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-lcd-text'] })
const page = await browser.newPage({ viewport: { width: 960, height: 600 } })
page.on('console', m => m.type() === 'error' && console.log('console:', m.text()))
page.on('pageerror', e => console.log('pageerror:', e.message))
await page.goto('http://127.0.0.1:4321/robots.txt')   // same origin, no CSP
await page.setContent('<!doctype html><body style="margin:0;background:#000"><canvas id="c" width="960" height="600"></canvas></body>')
const out = await page.evaluate(async () => {
  const gl = await import('/src/components/home/hero/monsoon/gl.ts')
  // ... build your module against a kit from gl.createKit(document.getElementById('c'))
})
```
- **Swiftshader is a CPU rasteriser.** Shaders run 20–100x slower than on a GPU, so test at
  modest sizes and don't mistake slowness for a bug. Do not run `playwright install`.
- **Fonts:** requests to Google Fonts may fail through this container's proxy. Fall back to
  system fonts.
- **Where outputs go:** screenshots and scratch files go under
  `<scratch>/site/monsoon/<your-agent>/`,
  never into the repo.
- **Token discipline:** view screenshots about ten times at most, prefer numeric pixel checks,
  and don't re-read big files you already read.

## Your final report (at most 25 lines)
- **Built:** files and line counts, and the exported API exactly as written.
- **Verified:** what, how, and the screenshot paths.
- **Per-pixel cost:** your estimate.
- **Known gaps.**
- **Shared-file changes:** anything you need changed in the shared files.
