# Window agent: city.ts + glass.ts

Read BRIEF-common.md first. You own `city.ts` (the view out of the window, drawn once with
Canvas2D) and `glass.ts` (the final full-screen pass: rain on the glass, fog, refraction, the
city, how the props and smoke are composited, and post). Together they make the first
impression, so they are the most important visuals on the page. Build city.ts first, then
glass.ts on top of it.

## city.ts
```ts
import type { CityPlates } from './types'
export function drawCity(opts: { width: number; height: number; seed?: number }): Promise<CityPlates>
```
- **Sizes.** `night` and `emit` are `width × height`; `day` and `flicker` are half that
  (rounded). index.ts asks for these:

  | Layout | Normal | `lowPower` |
  |---|---|---|
  | wide | 2048×1280 | 1536×960 |
  | tall | 1080×1920 | 810×1440 |

  So the composition must work for aspect 1.6 and 0.5625. In the tall plate, taller towers
  dominate a narrower slice.
- **Fonts.** First `await Promise.race([document.fonts.load('600 64px "JetBrains Mono"'),
  document.fonts.load('600 64px "Source Serif 4"'), timeout(1200)])`. Then draw, falling back to
  `monospace` / `serif`.
- **Deterministic.** Use a seeded PRNG (mulberry32), with the default seed fixed, so it is the
  owner's same city on every visit.
- **Layout once, paint twice.** Build the layout once as plain data: buildings, windows, signs,
  billboards. Then paint it for night and for day, so the two plates line up exactly. The glass
  pass cross-fades them.
- **Budget.** At most 300 ms total at 2048×1280, measured with `performance.now()` in the
  harness (Canvas2D is CPU, so the time is real). Yield with one `await` between plates, so
  the page stays responsive.

### The look
The plate is ALWAYS seen through the glass pass: blurred by 1.5–5 mip levels, and inverted
through small sharp drops. So the priorities are:
- light distribution, colour and depth over fine geometry;
- bright, saturated lights with soft halos, which bloom into bokeh;
- no big flat areas;
- a little noise everywhere, so the blur doesn't band.

1. **Sky.**
   - Night: deep indigo at the top (#05060d → #0d0b1f).
   - The horizon carries the city's light pollution lit into low monsoon clouds: magenta
     (#3a1238) in the middle, fading to teal (#0e2a3a) at the sides. Lay large soft cloud masses
     over it (layered radial gradients or value noise at low res, scaled up), brighter underneath.
   - Day (`day` plate): an overcast grey-blue sky (#8e9aa8 → #c3cad3) with soft darker cloud
     bands, and heavier haze. It is monsoon light: flat, wet, beautiful.
2. **Three depth layers**, back to front, with haze between them. Farther layers are lighter,
   bluer and lower contrast; draw a translucent haze gradient over each finished layer.
   - **Far skyline:** thin towers 35–85% of the plate height, spires, blue-grey (#0b1020), tiny
     1–2 px window specks.
   - **Mid towers:** the detailed layer. Setbacks, rooftop water tanks, antennas and dish arrays,
     floor bands, window grids, vertical neon strips on edges, and the big signs and billboards.
   - **Near buildings:** frame the left and right edges only, dark and large. Big vertical signs,
     balconies, window AC units (an Indian-city detail, and a good one), maybe a laundry line.
     Keep the middle open.
3. **Windows** (emit plate):
   - per building, a grid with 20–35% lit;
   - lit floors cluster; some whole floors are lit (offices);
   - colours: warm #ffc27a, cool white #dfe9ff, a few cyan or magenta screens, with varied
     brightness;
   - sizes: far 1–2 px, mid 3–5 px, near 6–10 px at 2048 wide.
4. **Neon signs** (emit), 8–14 of them.
   - Draw them as tubes: a wide soft glow (shadowBlur), a coloured stroke, and a near-white core
     line. Mix vertical and horizontal.
   - Colours: magenta #ff2fa0, cyan #22e6ff, amber #ffb347, violet #9b7bff, red #ff3b3b, and lime
     #9bff6a sparingly.
   - Latin text only. Choose from: HOTEL, OPEN 24×7, CHAI, NOODLES, RAIN BAR, NIGHT MARKET, PAAN,
     EXCHANGE, PHARMACY (with a cross), MONSOON, a "₹" sign, and one small "apanjwani0" sign on a
     mid building (an easter egg).
   - Never tool, game, arcade or play.
   - Each sign also casts neon spill on its wall: a soft coloured radial glow on the emit plate,
     at low intensity.
5. **Billboards** (emit): two or three large rectangles of abstract ad art, i.e. gradients, bold
   type and shapes. One is a green payment-confirmation screen, drawn on the flicker plate (G):
   a big tick in a circle and the words "PAYMENT SUCCESSFUL". It is a nod to the owner's day job,
   and it lights up every so often like a phone notification.
6. **Flicker plate**, half resolution, one monochrome group per channel (white-on-black),
   tinted by `groups`:
   - **R (magenta, groups[0])**, the broken neon: e.g. one letter of HOTEL and part of NOODLES.
     Leave those parts out of the emit plate so they can go dark.
   - **G (green, groups[1]):** the payment billboard.
   - **B (red, groups[2]):** aircraft warning lights on the spire tops, small dots.
   - Paint each group on its own offscreen canvas, then combine the channels with getImageData
     and putImageData.
   - `groups` = `[[1.0, 0.16, 0.6], [0.2, 1.0, 0.55], [1.0, 0.1, 0.08]]`.
7. **Street glow** (emit): warm and cyan haze along the plate's bottom 12%. The sill mostly
   hides it, but it lights the underside of the haze.
8. **Day plate:** the same layout, painted in daylight.
   - Concrete and grey-blue facades with visible detail; windows are dark glass reflecting the
     sky, and a few interiors are lit.
   - Neon tubes are drawn unlit, as dark grey tubes. A wet sheen at the bottom of facades.
   - The glass pass still adds the emit plate at about 20% by day, so lights read faintly.
9. **`lanes`:** three or four flying-traffic lanes between the mid towers, in plate uv (y from the
   bottom). Speeds ±0.008–0.03 uv/s, light size 0.002–0.004. The glass pass draws the traffic.

**Verify:**
- Save night, emit, day and flicker PNGs at 2048×1280 and 1080×1920.
- Save a preview composite: night, then emit with 'lighter', then the same blurred with
  `filter: blur(6px)`, which is how it mostly looks.
- Report the draw time.

## glass.ts
```ts
import type { GLKit, Target } from './gl'
import type { Camera } from './camera'
import type { CityTextures, SceneState } from './types'
export interface GlassInputs {
  city: CityTextures | null   // null until the plates are ready: draw a plain night gradient
  props: Target | null        // premultiplied linear-HDR RGBA from props.ts, sampled at vUv
  smoke: WebGLTexture | null  // smoke density in .r (0..~1.5), screen space; null when idle
}
export interface Glass {
  resize(w: number, h: number): void      // drawing-buffer px
  stepFog(state: SceneState): void        // applies state.wipes (≤ 16), regrows the fog
  render(state: SceneState, cam: Camera, inputs: GlassInputs): void   // kit.bind(null) + one pass
  destroy(): void
}
export function createGlass(kit: GLKit, opts: { lowPower: boolean; reduced: boolean }): Glass
```
Work in aspect-correct coordinates `p = vUv * vec2(aspect, 1.0)` (v units) for the drops.

1. **Mapping the plate to the screen.** Cover-fit the plate, with a 4% margin for parallax.
   Shift by `state.parallax * 0.012`. The glass is one big pane: no frame, and the vignette does
   the edges.
2. **Static drops**, two layers of cells, size 0.028 and 0.055 v (one layer when lowPower).
   - Per cell: hash → present when h < 0.42; centre jittered inside the middle half of the cell;
     radius = cell × mix(0.16, 0.38, h2).
   - Drops sag on vertical glass: scale y by 1.12 below the centre, for a heavier bottom.
   - Life cycle: phase = fract(t / period + h3), period 18–40 s; the radius eases in over the
     first 10% and out over the last 15%.
   - Coverage: `1 - smoothstep(r - aa, r + aa, d)` with `aa = fwidth(d)`.
   - Normal: `n = (p - c) / r`.
3. **Running drops**, in columns 0.07 v wide (fewer on lowPower).
   - Each drop slides down in stick-slip steps: it holds, then darts, never a constant speed.
     For example, `phase = t * speed + h`; `y = 1.25 - (floor(phase) + smoothstep(0.35, 1.0,
     fract(phase))) * step`, wrapped.
   - Lateral wobble: `0.012 * sin(y * 18 + h)`.
   - Radius 0.012–0.018, slightly elongated with the head at the bottom.
   - **Trail** above it, 0.08–0.3 v long:
     - a narrow clear channel (0.35 × radius wide) that removes fog;
     - a sparse string of tiny droplets (one per 0.012 v, radius 0.15–0.3 × the drop's, hashed on
       or off).
4. **Refraction.**
   - Inside a drop, sample the city at `uv - n.xy * r * 1.6 / vec2(aspect, 1)`: an inverted,
     magnified view.
   - Use a low blur (LOD 0.5), so drops are crisp little lenses. This is where the HD realism
     comes from.
   - Add a faint dark rim at the drop's edge (`smoothstep(0.75, 1.0, |n|)`, about 25%) and a tiny
     specular glint from the room's flame(s) when lit.
5. **Background, outside drops.**
   - LOD = 1.8 + fog × 3.0. Take five taps in a rotated cross at that LOD with a radius of
     `exp2(lod)` texels, so high mips don't look blocky.
   - Bokeh: add `emit` at LOD + 1.5 × 0.6, so lights bloom into soft discs.
6. **City colour** (linear).
   - Night: `night + emit * emitGain * 2.2 + Σ flicker.c * groups[c] * f_c(t) * emitGain * 2.2`.
   - The flicker curves:
     - `f_0` (broken neon) is mostly on, with irregular dropouts: `step(0.12, noise(t * 7.0))`,
       plus a rare long 1–2 s off.
     - `f_1` (payment billboard) is off for 9 s, then on for 3 s with a quick triple blink as it
       comes on.
     - `f_2` (aircraft lights) blinks at 1 Hz with a 15% duty cycle.
   - Day: mix in the `day` plate by `state.dayness`; `emitGain = mix(1.0, 0.22, dayness)`.
   - Dawn and dusk (dayness between 0.15 and 0.85): grade toward `state.hour`, strongest at the
     midpoint.
   - Traffic: for each lane (at most 4; uniforms), a light every ~0.15 uv moving at the lane
     speed. White headlights one way, red tail lights the other. Draw them as soft dots whose
     size follows the local blur, so they stay defocused like the plate.
7. **Fog.** A mask target `r8` (or `r16f` when `kit.floatTargets`), about 256 px on its short
   side, ping-ponged by `stepFog`. 1 means fully fogged.
   - Its initial state and regrowth target is condensation: heaviest at the bottom, clear at the
     top. `target = smoothstep(0.66, 0.2, uv.y) * 0.95` plus low-frequency noise.
   - Regrowth: `f = min(target, f + 0.045 * dt)`, about 25 s to fog back. Frozen when reduced,
     but wipes still apply.
   - Wipes: each dab does `f *= 1 - strength * (1 - smoothstep(0.0, r, dist))`, with dist in v
     units.
   - Running-drop trails clear fog in render; the mask doesn't store them.
   - Fogged glass: `mix(city, fogTint, 0.25 * f)`, where `fogTint` is windowLight × 0.55 plus a
     dark floor. Contrast drops with f.
   - The fog scatters light: add `emit` at LOD 6 × 0.35 × f, so the fog glows around lights.
8. **Flames on the glass.** For each `state.flames` entry, get uv from `cam.project(pos)`.
   - Warm light: `FLAME_RGB * intensity * (0.06 / (1 + (d / 0.05)^2) + 0.4 * f * exp(-d / 0.14))`,
     so fogged glass glows warm around a flame.
   - Upload the flame uvs and intensities from preallocated arrays.
9. **Smoke.** `s = texture(smoke, vUv).r`. This is the effect the owner loved, so make it
   luminous and detailed, never grey fog.
   - Colour: `s * (0.05 + 0.95 * cityBlurWide + flameLight * 1.4)`. It is backlit by the city:
     smoke in front of a magenta sign glows magenta.
   - Alpha: `a = clamp(s * 0.9, 0, 0.92)`; `col = col * (1 - a) + smokeCol * a`.
10. **Props.** `col = col * (1 - p.a) + p.rgb` (premultiplied, before tone mapping). Sample at
    vUv; the target may be smaller than the canvas.
11. **Post.**
    - Exposure 1.0 and the ACES filmic fit (Narkowicz).
    - Vignette 0.3.
    - Luminance-weighted animated grain at amplitude 0.03 (static when reduced).
    - Blue-noise-like dither of ±0.5/255.
    - Then encode `pow(c, 1/2.2)`.
    - Keep it to one full-screen pass plus the tiny fog pass, and at most ~16 texture fetches per
      pixel (fewer on lowPower).
12. **Reduced motion.** The page freezes `state.t`, so drops freeze where they are. Grain stays
    static and the fog doesn't regrow.

**Verify** in the harness, without the other modules:
- Use your real `drawCity` plates uploaded with `kit.texture(canvas, { mipmap: true })`, a fake
  `SceneState` (`createSceneState` from types.ts), `props: null`, and a synthetic smoke density
  texture (a canvas with a few soft white wisps, uploaded).
- Render at 960×600 and 390×844 (tall).
- Push a row of wipes and render again: a clear streak should show a sharper city.
- Show dayness 0, 0.5 and 1.
- Advance t across several frames and confirm the drops move in steps.
- Measure one frame's GPU time roughly (swiftshader numbers are only relative).
- Save the frames and look at them critically against "filmed, not drawn".
