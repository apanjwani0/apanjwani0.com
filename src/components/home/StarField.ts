/**
 * StarField — the interactive space hero background.
 *
 * - A warm dot grid (~32px) that shimmers gently at idle.
 * - Pointer proximity warps nearby stars radially outward and brightens them,
 *   easing back via per-frame decay.
 * - Click/touch drag lays down a navy brush-stroke "trail" that fades over ~1.4s.
 *
 * Pure canvas 2D, no dependencies. All colours come from the theme CSS tokens
 * (--color-bg / --color-text / --color-accent) so re-theming needs no JS change.
 */

const STAR_SPACING = 32 // css px between stars
const WARP_RADIUS = 160 // px of pointer influence
const WARP_PUSH = 1.1 // impulse strength per frame near the pointer
const DECAY = 0.95 // displacement easing per frame (eases stars home)
const TRAIL_LIFETIME = 1400 // ms before a trail point disappears
const TRAIL_MAX_W = 9 // px stroke width at the fresh end
const TRAIL_MIN_W = 2 // px stroke width as it fades
const TRAIL_ALPHA = 0.85 // peak opacity of the navy stroke
const TRAIL_MAX_POINTS = 800 // safety cap

type RGB = [number, number, number]

interface Star {
  hx: number // home x
  hy: number // home y
  dx: number // current displacement x
  dy: number // current displacement y
  phase: number
  bright: number
}

interface TrailPoint {
  x: number
  y: number
  t: number
  connect: boolean // false = pen-down (start a new sub-stroke)
}

function parseColor(value: string, fallback: RGB): RGB {
  const m = value.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return fallback
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

class StarField extends HTMLElement {
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private stars: Star[] = []
  private trail: TrailPoint[] = []
  private px: number | null = null
  private py: number | null = null
  private dragging = false
  private raf = 0
  private dpr = 1
  private w = 0
  private h = 0
  private reduced = false

  private bg: RGB = [17, 17, 17]
  private star: RGB = [232, 232, 232]
  private accent: RGB = [46, 77, 143]

  connectedCallback() {
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    this.canvas = document.createElement('canvas')
    this.canvas.setAttribute('data-type', 'starfield-canvas')
    this.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!

    this.readTokens()
    this.resize()
    this.bind()
    this.raf = requestAnimationFrame(this.frame)
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.raf)
    this.unbind()
  }

  private readTokens() {
    const cs = getComputedStyle(document.documentElement)
    this.bg = parseColor(cs.getPropertyValue('--color-bg'), [17, 17, 17])
    this.star = parseColor(cs.getPropertyValue('--color-text'), [232, 232, 232])
    this.accent = parseColor(cs.getPropertyValue('--color-accent'), [46, 77, 143])
  }

  private resize = () => {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.canvas.width = Math.round(this.w * this.dpr)
    this.canvas.height = Math.round(this.h * this.dpr)
    this.canvas.style.width = this.w + 'px'
    this.canvas.style.height = this.h + 'px'
    this.buildStars()
  }

  private buildStars() {
    const stars: Star[] = []
    const cols = Math.ceil(this.w / STAR_SPACING) + 1
    const rows = Math.ceil(this.h / STAR_SPACING) + 1
    const j = STAR_SPACING * 0.35
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        stars.push({
          hx: c * STAR_SPACING + (Math.random() - 0.5) * j,
          hy: r * STAR_SPACING + (Math.random() - 0.5) * j,
          dx: 0,
          dy: 0,
          phase: Math.random() * Math.PI * 2,
          bright: 0.18 + Math.random() * 0.3,
        })
      }
    }
    this.stars = stars
  }

  private frame = (now: number) => {
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0) // draw in css px

    ctx.fillStyle = `rgb(${this.bg[0]},${this.bg[1]},${this.bg[2]})`
    ctx.fillRect(0, 0, this.w, this.h)

    const t = now / 1000
    const [sr, sg, sb] = this.star
    for (const s of this.stars) {
      const shimmer = this.reduced ? 0 : Math.sin(t * 1.6 + s.phase) * 0.12
      let boost = 0

      if (this.px !== null && this.py !== null) {
        const ddx = s.hx - this.px
        const ddy = s.hy - this.py
        const d = Math.hypot(ddx, ddy)
        if (d < WARP_RADIUS && d > 0.001) {
          const push = 1 - d / WARP_RADIUS
          s.dx += (ddx / d) * push * WARP_PUSH
          s.dy += (ddy / d) * push * WARP_PUSH
          boost = push * 0.5
        }
      }

      s.dx *= DECAY
      s.dy *= DECAY

      const a = Math.max(0, Math.min(1, s.bright + shimmer + boost))
      ctx.beginPath()
      ctx.fillStyle = `rgba(${sr},${sg},${sb},${a})`
      ctx.arc(s.hx + s.dx, s.hy + s.dy, 1.1 + boost * 1.6, 0, Math.PI * 2)
      ctx.fill()
    }

    this.drawTrail(now)
    this.raf = requestAnimationFrame(this.frame)
  }

  private drawTrail(now: number) {
    while (this.trail.length && now - this.trail[0].t > TRAIL_LIFETIME) this.trail.shift()
    if (this.trail.length < 2) return

    const ctx = this.ctx
    const [ar, ag, ab] = this.accent
    // brush-like: round caps/joins, source-over so the navy stays inky (no glow)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.globalCompositeOperation = 'source-over'

    for (let i = 1; i < this.trail.length; i++) {
      const p = this.trail[i]
      if (!p.connect) continue
      const age = (now - p.t) / TRAIL_LIFETIME // 0 fresh .. 1 old
      const alpha = (1 - age) * TRAIL_ALPHA
      if (alpha <= 0) continue
      const prev = this.trail[i - 1]
      ctx.strokeStyle = `rgba(${ar},${ag},${ab},${alpha})`
      ctx.lineWidth = TRAIL_MIN_W + (TRAIL_MAX_W - TRAIL_MIN_W) * (1 - age)
      ctx.beginPath()
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }
  }

  private bind() {
    window.addEventListener('resize', this.resize)
    window.addEventListener('pointermove', this.onMove, { passive: true })
    this.canvas.addEventListener('pointerdown', this.onDown)
    window.addEventListener('pointerup', this.onUp)
    window.addEventListener('pointercancel', this.onUp)
    document.addEventListener('pointerleave', this.onLeave)
  }

  private unbind() {
    window.removeEventListener('resize', this.resize)
    window.removeEventListener('pointermove', this.onMove)
    this.canvas.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointerup', this.onUp)
    window.removeEventListener('pointercancel', this.onUp)
    document.removeEventListener('pointerleave', this.onLeave)
  }

  private onMove = (e: PointerEvent) => {
    this.px = e.clientX
    this.py = e.clientY
    if (this.dragging) {
      this.trail.push({ x: e.clientX, y: e.clientY, t: performance.now(), connect: true })
      if (this.trail.length > TRAIL_MAX_POINTS) this.trail.shift()
    }
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = true
    this.px = e.clientX
    this.py = e.clientY
    try {
      this.canvas.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    this.trail.push({ x: e.clientX, y: e.clientY, t: performance.now(), connect: false })
  }

  private onUp = (e: PointerEvent) => {
    this.dragging = false
    // touch has no hover — stop warping once the finger lifts
    if (e.pointerType === 'touch') {
      this.px = null
      this.py = null
    }
  }

  private onLeave = () => {
    this.px = null
    this.py = null
    this.dragging = false
  }
}

if (!customElements.get('star-field')) {
  customElements.define('star-field', StarField)
}
