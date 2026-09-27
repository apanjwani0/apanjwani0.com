# Smoke agent: smoke.ts

Read BRIEF-common.md first. You own `src/components/home/hero/monsoon/smoke.ts`: the GPU fluid
that carries the match's and the candle's smoke. The owner said of the earlier liquid light
hero, "I really loved the smoke design and realness it's trippy and trance." That hero's solver
is your source, and its look (fine curling detail, slow trance-like motion) is what must
survive the move to smoke.

## Source
`src/components/home/hero/liquid.ts` (1194 lines) is the TypeScript port of the owner-approved
liquid light. Read these parts:
- the solver: `TUNE` and its constants (lines ~28–52), the `FRAG` shaders (~79–305),
  `createSim`, `destroySim`, `splat`, `stepSim` (~474–640), and `computeSimDims`, `doResize`,
  `carryOver` (~945–1034);
- skip the display pass (`renderSim`), the mask, the clock and the pointer code. They are
  liquid's, not yours.

Port the solver onto `gl.ts` (programs through `kit.program`, targets through `kit.double`), in
WebGL2 only. Keep its numerical approach and its constants:
- advection with dissipation;
- curl and vorticity confinement (that is where the curls come from);
- divergence, the pressure Jacobi iterations and the gradient subtract;
- splat.

## API
```ts
import type { GLKit } from './gl'
import type { SmokeSource } from './types'
export interface Smoke {
  /** False once no source has arrived for 12 s: index.ts then skips step() and stops sampling. */
  readonly active: boolean
  /** Density in .r (linear-filterable, screen space, (0,0) bottom-left), at dye resolution. */
  readonly texture: WebGLTexture
  /** Advances the fluid by dt seconds after adding this frame's sources. Called only while
   *  active or when sources.length > 0. Allocates nothing. */
  step(dt: number, sources: SmokeSource[]): void
  /** Canvas drawing-buffer px (only the aspect and scale matter). Resamples the current smoke
   *  into the new grids, as liquid's carryOver does; never wipes it. */
  resize(w: number, h: number): void
  destroy(): void
}
/** Null when !kit.floatTargets: a fluid solver needs half-float targets. */
export function createSmoke(kit: GLKit, opts: { lowPower: boolean }): Smoke | null
```

## What changes from liquid
1. **Density, not coloured ink.** The dye is one density channel (`r16f`, or `rg16f` if you
   want age in `.g`). glass.ts lights it: backlit by the city, warm near the flames.
2. **Buoyancy.** After advection, add a force pass: `vel.y += buoyancy * density * dt`, with a
   gentle cap. The plume must rise by itself even from a still source.
3. **Sources** (types.ts `SmokeSource`), each one a gaussian splat into density and velocity:
   - steady plume (`puff: false`): add `density * dt` at the source. Its velocity (du, dv) is in
     uv/s, so convert to your sim's velocity units the way liquid's splat scales pointer deltas.
   - puff (`puff: true`): add `density` once, with its velocity and a little random swirl (two
     offset splats with opposite tangential velocity). It is a blown-out match or candle
     curling up.
   - `radius` is in v units (fractions of the screen height); correct for aspect as liquid does.
   - at most 12 sources a frame. Upload nothing per frame beyond uniforms.
4. **The look to aim for.** Take it from real smoke. index.ts sends these sources:
   - **Candle:** a thin ribbon that stays laminar for 3–6 cm, then breaks into slow curls.
     Density 0.08/s, radius 0.006.
   - **Burning match:** a fuller plume. Density 0.35/s, radius 0.01. It gains the match's motion
     when you wave it, and a wave leaves a trail.
   - **Blown-out match:** a puff of density 0.9 and radius 0.03 that rises and curls into a
     spiral over 3–4 s.
   - **Snuffed candle:** a puff of 1.4 and radius 0.04. This is the money shot, the "trippy
     trance" moment, so make it curl beautifully.
   - Density fades over about 6–9 s, and velocity dissipates a little faster.
   - The boundaries are open: smoke leaves the screen rather than piling up at the edges.
5. **Resolution.**
   - sim 128 and dye 512 on the short side;
   - lowPower: 96 and 384;
   - `resize` keeps the aspect with the canvas.
6. **Idle.** Track seconds since the last source. After 12 s, `active = false` and `step` isn't
   called; the texture stays valid. A new source makes it active again.
7. **Lifecycle.** `destroy()` deletes every program and target you created.

## Verify
- **Harness:** kit from `createKit(canvas)`, a smoke from `createSmoke`, and a tiny display
  program of your own (only in the harness) that draws `texture` as white smoke over black.
- **Script, fixed dt 1/60:**
  - 0–4 s: a steady candle source at (0.6, 0.25);
  - 1–3 s: a steady match source moving left to right across (0.3–0.5, 0.3);
  - at 3 s: a puff at (0.5, 0.3);
  - at 5 s: a big snuff puff at (0.6, 0.35).
- **Screenshots** at 2, 4, 6 and 9 s. Look for curls and detail, not blobs.
- **Checks:**
  - a resize from 960×600 to 600×900 mid-run keeps the smoke;
  - `active` goes false 12 s after the last source.
- **Numbers:** report the step cost in draw calls per frame, and the frame time relative to a
  pass-through, since swiftshader times are only relative.
