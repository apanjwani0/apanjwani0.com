/**
 * The matchbox label: a vintage Indian safety-match design, drawn once to a
 * Canvas2D texture that props.ts uploads (with mipmaps — it's seen at a
 * grazing angle on the box's top face, so bold shapes and large text matter
 * more than fine detail). Deterministic: a fixed seed, so the label never
 * changes between loads, matching city.ts's "same city every visit" spirit.
 *
 * No `tool`/`game` words anywhere in the printed copy (monsoon rule).
 */

const W = 512
const H = 352

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Draws `draw` twice, offset a hair apart in ink-red then near-black, the
 *  cheap two-colour letterpress misregistration every real cheap label has. */
function misregistered(
  ctx: CanvasRenderingContext2D,
  draw: (colour: string) => void,
  dx: number,
  dy: number,
): void {
  ctx.save()
  ctx.translate(dx, dy)
  draw('#8a1f1f')
  ctx.restore()
  draw('#1a1410')
}

function paper(ctx: CanvasRenderingContext2D, rnd: () => number): void {
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, '#efe6cd')
  g.addColorStop(0.55, '#e8dcbf')
  g.addColorStop(1, '#e2d3ae')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // Paper fibre speckle.
  for (let i = 0; i < 900; i += 1) {
    const x = rnd() * W
    const y = rnd() * H
    const v = rnd()
    ctx.fillStyle = v > 0.5 ? `rgba(60,45,25,${0.03 + v * 0.05})` : `rgba(255,250,230,${0.04 + v * 0.06})`
    ctx.fillRect(x, y, 1, 1)
  }
  // Foxing spots, sparse.
  for (let i = 0; i < 5; i += 1) {
    const x = rnd() * W
    const y = rnd() * H
    const r = 8 + rnd() * 22
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r)
    rg.addColorStop(0, 'rgba(120,90,40,0.10)')
    rg.addColorStop(1, 'rgba(120,90,40,0)')
    ctx.fillStyle = rg
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
}

function border(ctx: CanvasRenderingContext2D): void {
  const inset = 14
  const draw = (colour: string) => {
    ctx.strokeStyle = colour
    ctx.lineWidth = 3
    ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2)
    ctx.lineWidth = 1
    ctx.strokeRect(inset + 6, inset + 6, W - (inset + 6) * 2, H - (inset + 6) * 2)
  }
  misregistered(ctx, draw, 1.4, -1.0)
  // Corner flourishes: a small diamond tick at each corner.
  const corners: Array<[number, number]> = [
    [inset + 3, inset + 3],
    [W - inset - 3, inset + 3],
    [inset + 3, H - inset - 3],
    [W - inset - 3, H - inset - 3],
  ]
  ctx.fillStyle = '#1a1410'
  for (const [cx, cy] of corners) {
    ctx.beginPath()
    ctx.moveTo(cx - 9, cy)
    ctx.lineTo(cx, cy - 9)
    ctx.lineTo(cx + 9, cy)
    ctx.lineTo(cx, cy + 9)
    ctx.closePath()
    ctx.fill()
  }
}

/** The emblem: an umbrella over slanted rain, in alternating black/red gores. */
function emblem(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const draw = (colour: string) => {
    ctx.fillStyle = colour
    ctx.strokeStyle = colour
    // Canopy: six gores as wedges of a shallow dome.
    const gores = 6
    for (let i = 0; i < gores; i += 1) {
      if (i % 2 === 1 && colour !== '#1a1410') continue // red only fills alternate gores
      if (i % 2 === 0 && colour === '#8a1f1f') continue
      const a0 = Math.PI + (i / gores) * Math.PI
      const a1 = Math.PI + ((i + 1) / gores) * Math.PI
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, r, a0, a1)
      ctx.closePath()
      ctx.fill()
    }
    // Canopy rim scallops.
    ctx.beginPath()
    for (let i = 0; i <= gores; i += 1) {
      const a = Math.PI + (i / gores) * Math.PI
      const x = cx + Math.cos(a) * r
      const y = cy + Math.sin(a) * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.lineWidth = 2
    ctx.stroke()
    // Pole and finial.
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx, cy + r * 0.62)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy - 2, 3, 0, Math.PI * 2)
    ctx.fill()
    // Rain: slanted strokes under the canopy.
    ctx.lineWidth = 2
    for (let i = 0; i < 7; i += 1) {
      const x = cx - r * 0.8 + (i / 6) * r * 1.6
      const y0 = cy + r * 0.18 + (i % 2) * 6
      ctx.beginPath()
      ctx.moveTo(x, y0)
      ctx.lineTo(x - 7, y0 + 22)
      ctx.stroke()
    }
  }
  misregistered(ctx, draw, 1.1, -0.8)
}

function text(ctx: CanvasRenderingContext2D): void {
  const drawBrand = (colour: string) => {
    ctx.fillStyle = colour
    ctx.textAlign = 'center'
    ctx.font = '800 64px Georgia, "Times New Roman", serif'
    ctx.fillText('MONSOON', W / 2, 258)
  }
  misregistered(ctx, drawBrand, 1.6, -1.1)

  ctx.fillStyle = '#1a1410'
  ctx.textAlign = 'center'
  ctx.font = '600 22px Georgia, "Times New Roman", serif'
  ctx.save()
  ctx.scale(1, 1)
  // Letter-spaced "SAFETY MATCHES".
  const label = 'S A F E T Y   M A T C H E S'
  ctx.fillText(label, W / 2, 288)
  ctx.restore()

  ctx.font = '400 13px Georgia, "Times New Roman", serif'
  ctx.fillStyle = '#3a2f22'
  ctx.fillText('apanjwani0  ·  strike on the box  ·  made in India', W / 2, 322)
}

function wear(ctx: CanvasRenderingContext2D, rnd: () => number): void {
  // Vignette toward worn/darkened edges.
  const rg = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.78)
  rg.addColorStop(0, 'rgba(20,14,8,0)')
  rg.addColorStop(1, 'rgba(20,14,8,0.35)')
  ctx.fillStyle = rg
  ctx.fillRect(0, 0, W, H)
  // One crease, a soft diagonal light/dark double line.
  ctx.save()
  ctx.translate(W * 0.18, H * 0.08)
  ctx.rotate(-0.11)
  const grad = ctx.createLinearGradient(0, -3, 0, 3)
  grad.addColorStop(0, 'rgba(255,250,235,0.22)')
  grad.addColorStop(0.5, 'rgba(40,30,18,0.28)')
  grad.addColorStop(1, 'rgba(255,250,235,0.10)')
  ctx.fillStyle = grad
  ctx.fillRect(-40, -3, W + 80, 6)
  ctx.restore()
  // A few scuffed corner losses.
  for (let i = 0; i < 3; i += 1) {
    const x = rnd() * W
    const y = rnd() < 0.5 ? rnd() * 20 : H - rnd() * 20
    const r = 10 + rnd() * 16
    const rg2 = ctx.createRadialGradient(x, y, 0, x, y, r)
    rg2.addColorStop(0, 'rgba(210,190,150,0.35)')
    rg2.addColorStop(1, 'rgba(210,190,150,0)')
    ctx.fillStyle = rg2
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
}

/** Draws the label once and returns the canvas. Synchronous: system-font
 *  fallback is fine here (unlike city.ts, nothing here needs a webfont). */
export function drawLabel(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const rnd = mulberry32(0x4d4f4e53)
  paper(ctx, rnd)
  border(ctx)
  emblem(ctx, W / 2, 108, 58)
  text(ctx)
  wear(ctx, rnd)
  return canvas
}

/** The label's average base colour (cream), for the box faces that don't show
 *  the print — sampled once from the paper tone rather than re-declared. */
export const LABEL_BASE: [number, number, number] = [0.82, 0.76, 0.62]
