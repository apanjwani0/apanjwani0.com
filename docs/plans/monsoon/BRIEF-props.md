# Props agent: props.ts (+ label.ts)

Read BRIEF-common.md first. You own `props.ts`, the objects on the windowsill: sill, matchbox,
matches and candle, raymarched as signed distance fields in one fragment shader. You also own
the flames and sparks, and optionally `label.ts` for the matchbox label canvas. The owner's bar
for this one, verbatim: "an extremely realistic matchbox ... It'll be only great if it's HD and
real and has some weight and assence and not just a 2d drawing." The match lighting is the
moment he described, so treat it as the centrepiece.

## API
```ts
import type { GLKit, Target } from './gl'
import type { Camera } from './camera'
import type { CityTextures, SceneState } from './types'
export interface Props {
  /** Premultiplied linear-HDR RGBA of everything in the room, for glass.ts to composite at vUv.
   *  Alpha is coverage (1 on objects, 0 through to the window). Flames and sparks are ADDED to
   *  rgb without adding alpha, so they light the window behind them too. */
  readonly target: Target
  /** Drawing-buffer px of the canvas; the target is that times `scale` (0.75, or 0.6 when lowPower). */
  resize(w: number, h: number): void
  render(state: SceneState, cam: Camera, city: CityTextures | null): void
  destroy(): void
}
export function createProps(kit: GLKit, opts: { lowPower: boolean; reduced: boolean }): Props
```
- **The frame.** Use camera.ts as-is: world in metres, sill top at y = 0, glass at GLASS_Z.
  `cam.placements` says where everything is.
  - You may tune the numbers in camera.ts's `FRAMINGS` table so both layouts compose well. Keep
    the objects clear of the left half in `wide` (the page text lives there), and along the
    bottom in `tall`.
  - Rerun this after any change and report the new numbers:
    `npx tsx <scratch>/site/cam-probe.ts`
- **Camera uniforms.** Take eye, the basis and fovY from `cam` (view and proj matrices are
  there). Reconstruct each pixel's ray exactly as `cam.ray(u, v)` does, so a pointer maps onto
  what you draw to the pixel.
- **Scissor.** Scissor the pass to the screen bounds of the visible objects (sill band, box,
  candle with its flame height, every match), projected with `cam.project` plus a margin, and
  clear the rest of the target to 0. The sill band is the full width from the bottom of the
  screen up to the glass line.

## The scene
1. **Sill:** a slab across the whole view, y ∈ [-0.04, 0] and z ∈ [GLASS_Z, 0.35].
   - Material: dark stained wood (albedo #2a1a12 → #3b2418), grain along x (stretched fbm into
     albedo and roughness), and a satin varnish (roughness 0.35).
   - It REFLECTS THE WINDOW: sample the city (`night`/`day` mixed by dayness, plus
     `emit * emitGain * 2.2`) at the mirrored direction's screen position. Use a high LOD
     (3.5–5.5 by roughness), Fresnel, and fade with distance from the glass. Neon smeared across
     a wet, glossy sill is the cyberpunk detail that sells realism, so make it good.
   - The flames reflect in it too (a warm streak below each flame).
   - A thin dark gap where the sill meets the glass.
2. **Matchbox** (`placements.box`, yawed about y): a sleeve (rounded box, r ≈ 0.0012) of printed
   card, with a drawer (tray) pushed out `trayOut` along its +x. The tray is an open-topped box
   showing 7–9 match heads packed side by side, red-brown ellipsoids with slight variation.
   - Top face: the label texture, projected on the face's local xz.
   - Long side facing the camera: the striker, `placements.striker`. Dark brown-black grit, with
     a noise normal and albedo speckle, roughness 0.9, and a printed border strip above and
     below. Once struck, faint scratch marks where the head passed.
   - Other faces: the label's base colour.
   - Card has thickness (the sleeve's open end shows edges) and slightly worn, lighter corners.
3. **The label** (label.ts, a Canvas2D texture at about 512×352, drawn once): a vintage Indian
   safety-match label.
   - Cream paper with slight texture; a red-and-black two-colour print that is slightly
     misregistered; an ornamental border.
   - A bold central emblem: an umbrella with rain lines, or a crescent moon over rain.
   - Brand word "MONSOON" in bold, "SAFETY MATCHES" under it, and small print
     "apanjwani0 · strike on the box · made in India".
   - Wear: faded edges and a crease.
   - Seen at a grazing angle, so keep it bold and legible.
4. **Matches** (`state.matches`): [0] is the active one; the rest are spent matches on the sill.
   - Stick: a square-section box of half-thickness `MATCH.half`, length `MATCH.length`, from the
     head centre along `dir`. Pale wood (#d9b88a) with a faint grain.
   - Char: over the first `burn` fraction from the head the stick is charred (#16110d,
     roughness 0.95), slightly thinner and curled. While `phase === 'lit'`, a glowing ember band
     sits at the char front: emissive orange, about 1.5 mm wide, flickering.
   - Head: an ellipsoid at `head` with radii `MATCH.head`, the long axis along `dir`. Unstruck it
     is glossy red-brown #7a1f14; once `struck` it is black with a grey flaky ash shell.
     `ember > 0` makes it glow orange-red, with a noisy crackle pattern.
   - Spent matches: fully burnt (`burn` near 1), lying where match.ts put them.
   - Draw at most 6 matches; take them from a uniform array.
5. **Candle** (`placements.candle`): a pillar, radius 0.025 and height 0.075.
   - The top rim is slightly raised and irregular, around a melted concave pool.
   - Two or three soft drips down the side (smooth-unioned capsules).
   - Wick: a thin curved capsule (radius 0.0007) up to `wickTop`. Black, with an orange ember tip
     when lit.
   - Wax: ivory #efe6d8, roughness 0.5.
   - Fake subsurface scattering: wrap lighting, plus, when lit, strong translucency near the top.
     The upper centimetre glows warm orange around the flame, the most recognisable real-candle
     cue: `flame * exp(-(height - y) / 0.012)`.
6. **Flames**, one for the lit match and one for the candle (`state.flames` has world pos and
   intensity, and `state.matches[0].lean`). Draw each as a screen-space procedural teardrop at
   the projected position, sized by projecting real sizes (match 0.016 m tall, candle 0.026 m;
   × flame).
   - Shape: `length((q - base) / vec2(w, h))` with an upward taper and noise scrolled upward.
     Flicker from fbm(t × 3–6), and a sway that follows `lean` and the flicker.
   - Colour, bottom to top: a thin translucent blue at the base (#3a5bff, 15%), a hot
     white-yellow core (#fff1c8, about 6.0 HDR), orange body (#ff8a2e), red-orange tips fading
     out. Soft edges, no outline.
   - Add a soft glow halo (exp falloff, HDR) so it blooms.
   - Ignition flare (`flame` > 1): bigger, whiter and ragged, sputtering.
7. **Sparks** (`state.sparks`, at most 64): short velocity-aligned streaks in screen space,
   bright orange-white HDR with a glow, fading with `life`. Upload them from a preallocated
   Float32Array.

## Lighting (linear HDR)
- **Flames** are point lights: `FLAME_RGB * intensity * 2.5`, inverse-square with a 0.02 m soft
  core.
  - Only the brightest flame casts SDF soft shadows (at most 24 steps, k about 12) on the sill,
    box and candle. The candle shadowing the sill under the match light is exactly the "weight".
- **Window light** (`light.ts windowLight(dayness, hour, out)`) comes from behind, i.e. from the
  glass: a directional from (0, 0.35, -1), mostly rim light and silhouettes at night, and softer
  fill by day.
- **Room ambient:** very dim and cool (#0a0c14 × 0.4).
- Ambient occlusion from 4 SDF samples.
- GGX specular. Card is matt, wax and varnish are satin, and the match head is glossy until
  struck.
- **With no flame at night**, the objects are near-silhouettes with coloured rim light. That
  darkness is correct and intended: striking the match should transform the scene.

## Quality and cost
- **Raymarch:** at most 72 steps. First test the ray against each object's AABB and skip empty
  space; the sill is a plane test.
- **Antialiasing:** from the final SDF distance against the pixel footprint (coverage alpha).
  The target is 0.75× and edges must not shimmer.
- **No perfect primitives:** tiny bevels everywhere, surface noise, and small imperfections.
- **Reduced motion:** static flame shape and no ember flicker.

## Verify
- **Harness:** `createKit` on a 960×600 canvas; `makeCamera(960, 600)`; a `SceneState` from
  `createSceneState(false)` with a hand-built state. Draw with a tiny display program of your
  own that tone-maps the target over a flat dark window colour, or draw `props.target` over a
  plain gradient.
- **Frames to capture:**
  - night, no flame;
  - the match held above the box, lit (`phase: 'lit'`, flame 1);
  - the ignition flare;
  - candle lit with the match gone;
  - two spent matches on the sill;
  - dayness 1;
  - tall layout at 390×844.
- **Checks:**
  - pixel-check that `cam.project(placements.striker.center)` lands on the striker's pixels
    (dark grit colour);
  - view the frames critically against "filmed, not drawn";
  - report the per-pixel cost and what you would improve with more time.
