/**
 * The hubs' background: the home hero's sky (src/lib/sky.ts) on a fixed canvas
 * behind the page, inside `div[data-type="sky"]` (Base's `sky` prop).
 *
 * Kept light on purpose. Loaded on idle by nav-ui.ts, and only on pages that
 * render the host. The canvas is capped at 1.5× device pixels, the stars are
 * sparser than the hero's, the loop draws at most ~30 frames a second and
 * stops while the tab is hidden, and reduced motion gets one still frame.
 * Colours come from the host's `--sky-star` and `--sky-line` tokens, re-read
 * when the theme changes.
 */
import { drawStars, driftStars, makeStars, starCount, type SkyColors, type Star } from './sky'
import { onThemeChange } from './theme'
import { prefersReducedMotion } from './motion'

// One star per this many px²: about half the hero's density, so the page reads
// as a quiet backdrop and not a second hero.
const SKY_AREA = 16000
const FRAME_MS = 33

let wired = false
let teardown: (() => void) | null = null
let mountedOn: HTMLElement | null = null

function wireOnce(): void {
  if (wired) return
  wired = true
  document.addEventListener('astro:before-swap', unmount)
}

export function mountSky(): void {
  wireOnce()
  const host = document.querySelector<HTMLElement>('div[data-type="sky"]')
  if (host === mountedOn) return
  unmount()
  if (!host) return
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  host.replaceChildren(canvas)
  mountedOn = host

  const ac = new AbortController()
  const reduced = prefersReducedMotion()
  const lowPower = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4
  let w = 0, h = 0, dpr = 1, raf = 0, last = 0, time = 0
  let stars: Star[] | null = null
  let colors: SkyColors = { star: '', line: '' }

  const readColors = () => {
    const cs = getComputedStyle(host)
    colors = { star: cs.getPropertyValue('--sky-star').trim(), line: cs.getPropertyValue('--sky-line').trim() }
  }
  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (stars) drawStars(ctx, stars, time, w <= 520 ? 80 : 120, w, h, colors)
  }
  const resize = () => {
    const ow = w, oh = h
    w = window.innerWidth; h = window.innerHeight
    dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    canvas.width = Math.max(1, Math.round(w * dpr))
    canvas.height = Math.max(1, Math.round(h * dpr))
    // Rescaled, not re-made: a phone's address bar resizes the viewport on
    // every scroll, and a fresh sky each time would jump.
    if (!stars) stars = makeStars(starCount(w, h, lowPower, SKY_AREA), w, h)
    else if (ow && oh) for (const st of stars) { st.x *= w / ow; st.y *= h / oh }
    draw()
  }
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop)
    if (last && now - last < FRAME_MS) return
    const dt = last ? Math.min((now - last) / 1000, 0.25) : 1 / 30
    last = now
    time += dt * 1000
    if (stars) driftStars(stars, w, h, dt)
    draw()
  }
  const sync = () => {
    const run = !reduced && !document.hidden
    if (run && !raf) { last = 0; raf = requestAnimationFrame(loop) }
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0 }
  }

  readColors()
  resize()
  sync()
  window.addEventListener('resize', resize, { signal: ac.signal })
  document.addEventListener('visibilitychange', sync, { signal: ac.signal })
  const offTheme = onThemeChange(() => { readColors(); draw() })

  teardown = () => {
    ac.abort()
    offTheme()
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    host.replaceChildren()
  }
}

function unmount(): void {
  teardown?.()
  teardown = null
  mountedOn = null
}
