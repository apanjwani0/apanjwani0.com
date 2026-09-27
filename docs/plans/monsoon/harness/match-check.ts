// The match sim's node check (BRIEF-page §1): the real camera, a seeded
// random, scripted pointer paths. Run: npx tsx docs/plans/monsoon/harness/match-check.ts
// Written after the striker contact test turned out to measure depth from the
// box's centre, so no drag could ever light the match and nothing noticed.
import { makeCamera } from '../../../../src/components/home/hero/monsoon/camera.ts'
import { createMatchSim, type MatchEvent } from '../../../../src/components/home/hero/monsoon/match.ts'
import { createSceneState, type Vec3 } from '../../../../src/components/home/hero/monsoon/types.ts'

let fails = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) fails += 1
}

function rig(w: number, h: number, reduced = false) {
  let roll = 0.5
  const sim = createMatchSim({ reduced, random: () => roll })
  const cam = makeCamera(w, h)
  const state = createSceneState(reduced)
  const input = { x: 0, y: 0, down: false, touch: false, present: false }
  const events: MatchEvent[] = []
  sim.reset(state, cam)
  const step = (dt = 1 / 60) => {
    state.dt = dt
    if (!reduced) state.t += dt
    for (const e of sim.update(state, cam, input, w, h)) events.push(e)
    state.smoke.length = 0
  }
  const run = (seconds: number, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) step(dt) }
  const px = (p: Vec3): [number, number] => { const q = cam.project(p, [0, 0, 0]); return [q[0] * w, (1 - q[1]) * h] }
  const moveTo = (x: number, y: number, seconds: number) => {
    const x0 = input.x, y0 = input.y
    const n = Math.max(1, Math.round(seconds * 60))
    for (let i = 1; i <= n; i += 1) { input.x = x0 + (x - x0) * i / n; input.y = y0 + (y - y0) * i / n; step() }
  }
  const grab = () => {
    const [x, y] = px(state.matches[0].head)
    const hit = sim.hitTest(state, cam, x, y, w, h, false)
    Object.assign(input, { x, y, present: true, down: hit === 'match' })
    step()
    return hit
  }
  /** Settle on the striker's near end, then drag to the far end in `seconds`. */
  const swipe = (seconds: number) => {
    const s = cam.placements.striker
    const end = (k: number): Vec3 => [s.center[0] + s.along[0] * s.halfLen * k, s.center[1], s.center[2] + s.along[2] * s.halfLen * k]
    const [ax, ay] = px(end(-0.9))
    const [bx, by] = px(end(0.9))
    moveTo(ax, ay, 0.3)
    run(0.4)
    moveTo(bx, by, seconds)
    run(0.3)
  }
  const light = () => { grab(); swipe(0.08) }
  return { sim, cam, state, input, events, step, run, px, moveTo, grab, swipe, light, setRoll: (v: number) => { roll = v } }
}

for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  const tag = `${w}x${h}`

  {
    const r = rig(w, h)
    check(`${tag} the resting match is under its own head`, r.grab() === 'match')
    r.swipe(0.08)
    check(`${tag} a fast drag across the striker lights it`, r.events.includes('lit') && r.state.matches[0].phase === 'lit', r.events.join(' '))
    check(`${tag} …and throws sparks`, r.events.includes('lit') && r.state.flames.length === 1)
  }
  {
    const r = rig(w, h)
    r.grab()
    r.swipe(1.2)
    check(`${tag} a slow drag does not`, !r.events.includes('lit') && !r.events.includes('fizzle'), r.events.join(' '))
  }
  {
    const r = rig(w, h)
    r.setRoll(0.95)
    r.light()
    check(`${tag} an unlucky strike fizzles and can be struck again`, r.events.includes('fizzle') && r.state.matches[0].phase === 'held', r.events.join(' '))
    r.setRoll(0.5)
    r.swipe(0.08)
    check(`${tag} …and then lights`, r.events.includes('lit'))
  }
  {
    const r = rig(w, h)
    r.light()
    const wick = r.cam.placements.candle.wickTop
    const [x, y] = r.px(wick)
    r.moveTo(x, y, 0.4)
    r.run(1.2)
    check(`${tag} a flame held to the wick lights the candle`, r.events.includes('candle-lit') && r.state.candle.lit, r.events.join(' '))
  }
  {
    const r = rig(w, h)
    r.light()
    r.run(1)
    const x0 = r.input.x
    const y0 = r.input.y
    // A flick: half a screen height up and away in a tenth of a second.
    r.moveTo(x0 - 0.3 * h, y0 - 0.4 * h, 0.1)
    check(`${tag} a flick puts it out`, r.events.includes('out') && r.state.matches[0].phase === 'out', r.events.join(' '))
  }
  {
    const r = rig(w, h)
    r.light()
    r.run(1)
    // An ordinary move: a third of the screen height in half a second.
    r.moveTo(r.input.x - 0.2 * h, r.input.y - 0.25 * h, 0.5)
    r.run(0.5)
    check(`${tag} an ordinary move does not`, !r.events.includes('out') && r.state.matches[0].phase === 'lit', r.events.join(' '))
  }
  {
    const r = rig(w, h)
    r.light()
    r.run(22)
    check(`${tag} a match burns down in about 20 s`, r.events.includes('burnt'), r.events.join(' '))
  }
  {
    const r = rig(w, h)
    r.light()
    r.input.down = false
    r.run(0.1)
    r.state.matches[0].flame = 0
    r.run(6)
    check(`${tag} released, it lands`, r.events.includes('landed'), r.events.join(' '))
  }
  {
    const r = rig(w, h)
    r.light()
    r.run(21)
    r.input.down = false
    r.run(4)
    check(`${tag} a burnt match is spent and a fresh one slides out`, r.events.includes('fresh') && r.state.matches.length >= 2 && r.state.matches[0].phase === 'rest', r.events.join(' '))
  }
  {
    const r = rig(w, h)
    r.sim.act('strike')
    r.run(1.5)
    check(`${tag} act('strike') lights it`, r.events.includes('lit'), r.events.join(' '))
    r.sim.act('candle')
    r.run(3)
    check(`${tag} act('candle') lights the candle`, r.events.includes('candle-lit'), r.events.join(' '))
    r.sim.act('blow')
    r.run(0.5)
    check(`${tag} act('blow') puts the match out first`, r.events.includes('out'), r.events.join(' '))
    r.sim.act('blow')
    r.run(0.5)
    check(`${tag} …then the candle`, r.events.includes('candle-out'), r.events.join(' '))
  }
  {
    const r = rig(w, h, true)
    r.sim.act('strike')
    r.run(3, 0.1)
    const s = r.cam.placements.striker.center
    const head = r.state.matches[0].head
    const off = Math.hypot(head[0] - s[0], head[2] - s[2])
    check(`${tag} reduced motion: a scripted strike on 0.1 s frames lights by the box`, r.events.includes('lit') && r.state.sparks.length === 0, `${r.events.join(' ')}; ${off.toFixed(3)} m from the strip`)
  }
}

// Memory: 10k updates of a lit match should not grow the heap.
{
  const r = rig(1440, 900)
  r.light()
  const gc = (globalThis as { gc?: () => void }).gc
  gc?.()
  const before = process.memoryUsage().heapUsed
  for (let i = 0; i < 10000; i += 1) { r.state.matches[0].burn = 0; r.step() }
  gc?.()
  const grew = process.memoryUsage().heapUsed - before
  check('10k lit updates allocate nothing that survives', !gc || grew < 256 * 1024, gc ? `${(grew / 1024).toFixed(0)} KB` : 'run with node --expose-gc to measure')
}

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
