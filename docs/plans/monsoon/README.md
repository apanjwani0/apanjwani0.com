# Monsoon hero

**Status (2026-09-28):** finished on `feat/home-hero`, waiting for the owner's
review at `/?hero=monsoon` on the dev server. Production still renders the
classic hero. The rules the code must keep are in AGENTS.md under *Home hero
candidates → Monsoon*.

## The concept

A cyberpunk city at night, seen from a dark room through a rain-covered window.
Drops run down the glass and refract the neon, and the fogged glass wipes clear
under the pointer. A matchbox and a pillar candle sit on the sill: strike the
match across the box (it sparks, sometimes fizzles, then flares), light the
candle, flick the match out. Scrolling runs the owner's day in IST (night, night
shift, dawn, day shift, dusk) on an endless loop, with the chapters as plain
HTML.

What the owner asked for: a first reaction of "wow"; "quirky small stuff, which
brings a smile"; an "extremely realistic matchbox" with weight, "not just a 2d
drawing"; the smoke's "realness" from the liquid-light hero; "cyberpunk kinda";
the about-me "not directly at landing … as user scrolls down"; "something which
is infinite"; and nothing that leaks sensitive info.

## Open tuning (the owner's call)

- The look on the owner's own screen at dpr 2. On an M2 a 1425×900 frame costs
  3.5 ms idle and 4.9 ms with both flames and smoke; the render scale adapts
  when frames run late.
- Some mid-tower facades in `city.ts` are large flat panels; the blur hides most
  of it.
- The fizzle odds (22%), the burn time (about 20 s) and the flick threshold.

## Testing

- **The match sim:** `npx tsx docs/plans/monsoon/match-check.ts` (add
  `NODE_OPTIONS=--expose-gc` to measure allocation).
- **The camera:** `npx tsx docs/plans/monsoon/cam-probe.ts` prints where the key
  points land at four screen sizes.
- **In a browser:** `/?hero=monsoon` on the dev server. A background tab pauses
  `requestAnimationFrame`, so a screenshot of a hidden tab shows a stale frame.
