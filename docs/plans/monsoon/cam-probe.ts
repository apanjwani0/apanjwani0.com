import { makeCamera, MATCH } from '../../../src/components/home/hero/monsoon/camera.ts'
for (const [w, h] of [[1440, 900], [1280, 720], [390, 844], [820, 1180]]) {
  const c = makeCamera(w, h)
  const P = c.placements
  const px = (p: number[]) => { const q = c.project(p as any); return `(${Math.round(q[0] * w)},${Math.round((1 - q[1]) * h)})` }
  const b = P.box.center, s = P.box.size
  const boxL = [b[0] - P.striker.along[0] * s[0] / 2, b[1], b[2] - P.striker.along[2] * s[0] / 2]
  const boxR = [b[0] + P.striker.along[0] * s[0] / 2, b[1], b[2] + P.striker.along[2] * s[0] / 2]
  const sc = P.striker.center
  const top = [sc[0], sc[1] + P.striker.halfH, sc[2]], bot = [sc[0], sc[1] - P.striker.halfH, sc[2]]
  const cb = P.candle.base
  const tail = P.matchRest.head.map((v, i) => v + P.matchRest.dir[i] * MATCH.length)
  console.log(`${c.mode} ${w}x${h}: glassBase ${px([0, 0, -0.02])} glassBaseL ${px([-0.2, 0, -0.02])} sillFront ${px([0, 0, 0.25])}`)
  console.log(`  box L ${px(boxL)} R ${px(boxR)} striker top ${px(top)} bottom ${px(bot)}`)
  console.log(`  candle base ${px(cb)} top ${px([cb[0], P.candle.height, cb[2]])} left ${px([cb[0] - 0.025, 0.04, cb[2]])} right ${px([cb[0] + 0.025, 0.04, cb[2]])} wick ${px(P.candle.wickTop)}`)
  console.log(`  match head ${px(P.matchRest.head)} tail ${px(tail)} trayMouth ${px(P.trayMouth)} spent0 ${px(P.spentSlots[0].head)} spent4 ${px(P.spentSlots[4].head)}`)
}
