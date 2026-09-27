/**
 * Monsoon: a cyberpunk night seen from a dark room through a rain-covered
 * window, with a matchbox and a candle on the sill. Scrolling runs the owner's
 * day in India on a loop (story.ts); the match is the toy (match.ts).
 *
 * This file only wires the frame. Each pass owns its own GL resources:
 * city.ts draws the view once, glass.ts is the final full-screen pass (rain,
 * fog, refraction, compositing, post), props.ts raymarches the sill and its
 * objects with their flames, and smoke.ts is the fluid their smoke rides on.
 *
 * Mounted by mount.ts through the hero contract (../types.ts). The stage is
 * fixed to the viewport while the page scrolls over it.
 */
import type { HeroCreate, HeroInstance } from '../types'
import { dayness, hourColor } from '../day'
import { createKit, type GLKit } from './gl'
import { layoutFor, makeCamera, type Camera, type LayoutMode } from './camera'
import { createSceneState, type CityTextures, type FogWipe, type SceneState } from './types'
import { drawCity } from './city'
import { createGlass, type Glass } from './glass'
import { createProps, type Props } from './props'
import { createSmoke, type Smoke } from './smoke'
import { createMatchSim, type MatchEvent, type MatchInput, type MatchSim } from './match'
import { createStory, type Story } from './story'

const LABEL =
  'A rainy night in a neon city, seen through a fogged window. A matchbox and a candle sit on the sill.'

// Frame pacing: judge the rAF cadence, not JS time, so a 30, 60 or 120 Hz
// screen that keeps up is never throttled. A window's median interval well
// above the fastest one seen means frames are really late.
const PACE_WARMUP_MS = 2000
const PACE_WINDOW = 24
const PACE_RATIO = 1.4
const SCALES = [1, 0.85, 0.72, 0.6, 0.5]
/** Drawing-buffer pixel cap, so a 4K screen at dpr 2 is not 33 million pixels. */
const MAX_PIXELS = 3_600_000

const WIPE_POOL = 16
const HINT_DELAY_MS = 2500
const REDUCED_TICK_MS = 250

const LIVE: Partial<Record<MatchEvent, string>> = {
  lit: 'The match is lit.',
  fizzle: 'It didn’t catch. Strike again.',
  out: 'The match went out.',
  burnt: 'The match burnt down.',
  'candle-lit': 'The candle is lit.',
  'candle-out': 'The candle is out.',
}

// Dev only: `?scale=0.6` pins the render scale, so a screenshot under a
// software renderer shows the real look instead of a throttled one.
function scalePin(): number | null {
  if (!import.meta.env.DEV) return null
  const m = /[?&]scale=([\d.]+)/.exec(location.search)
  const v = m ? Number(m[1]) : NaN
  return Number.isFinite(v) && v >= 0.25 && v <= 1 ? v : null
}

function plateSize(mode: LayoutMode, lowPower: boolean): [number, number] {
  if (mode === 'wide') return lowPower ? [1536, 960] : [2048, 1280]
  return lowPower ? [810, 1440] : [1080, 1920]
}

export const create: HeroCreate = (host, env) => {
  const section = env.text.section
  const storyEl = document.querySelector<HTMLElement>('div[data-type="story"]')
  const hud = section.querySelector<HTMLElement>('[data-type="monsoon-hud"]')
  const hint = section.querySelector<HTMLElement>('[data-type="monsoon-hint"]')
  const live = section.querySelector<HTMLElement>('[data-type="monsoon-live"]')

  const state = createSceneState(env.reduced)
  // run() replaces this once there is something to render.
  let requestRender = () => {}
  let story: Story | null = null
  if (storyEl) {
    story = createStory({
      section,
      story: storyEl,
      hud,
      reduced: env.reduced,
      signal: env.signal,
      onTime: setTime,
    })
    setTime(story.minutes())
  }

  const canvas = document.createElement('canvas')
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', LABEL)
  host.append(canvas)

  const kit = createKit(canvas)
  if (!kit) return poster()

  let glass: Glass
  let props: Props
  let smoke: Smoke | null
  try {
    glass = createGlass(kit, { lowPower: env.lowPower, reduced: env.reduced })
    props = createProps(kit, { lowPower: env.lowPower, reduced: env.reduced })
    smoke = env.reduced ? null : createSmoke(kit, { lowPower: env.lowPower })
  } catch (err) {
    console.error(err)
    kit.destroy()
    return poster()
  }
  return run(kit, glass, props, smoke)

  function setTime(minutes: number) {
    state.minutes = minutes
    state.dayness = dayness(minutes)
    hourColor(minutes, state.hour)
    requestRender()
  }

  /** No WebGL: the page keeps its text, its story and its loop over a CSS night. */
  function poster(): HeroInstance {
    canvas.remove()
    section.dataset.monsoonPoster = ''
    return {
      start() {},
      stop() {},
      resize() { story?.refresh() },
      destroy() {
        story?.destroy()
        delete section.dataset.monsoonPoster
      },
    }
  }

  function run(kit: GLKit, glass: Glass, props: Props, smoke: Smoke | null): HeroInstance {
    const match: MatchSim = createMatchSim({ reduced: env.reduced })
    const gl = kit.gl
    let cssW = Math.max(1, host.clientWidth)
    let cssH = Math.max(1, host.clientHeight)
    let cam: Camera = makeCamera(cssW, cssH)
    let city: CityTextures | null = null
    let cityMode: LayoutMode | null = null
    let cityJob = 0
    let failed = false
    let destroyed = false

    // ── Render scale and pacing ──────────────────────────────────────────
    const pinned = scalePin()
    let scaleIndex = env.lowPower ? 1 : 0
    const intervals = new Float32Array(PACE_WINDOW)
    const sorted = new Float32Array(PACE_WINDOW)
    let intervalCount = 0
    let fastest = Infinity
    let paceFrom = 0
    const scale = () => pinned ?? SCALES[scaleIndex]

    // ── Input ────────────────────────────────────────────────────────────
    const input: MatchInput = { x: 0, y: 0, down: false, touch: false, present: false }
    let claimedId = -1
    let wipeId = -1
    let lastWipeU = -1
    let lastWipeV = -1
    let parallaxX = 0
    let parallaxY = 0
    let mouseSeen = false
    let grabbed = false
    const wipePool: FogWipe[] = Array.from({ length: WIPE_POOL }, () => ({ u: 0, v: 0, r: 0, strength: 0 }))

    const handle = document.createElement('button')
    handle.type = 'button'
    handle.dataset.type = 'match-handle'
    handle.setAttribute('aria-label', 'Strike a match')
    host.append(handle)

    const hintTimer = window.setTimeout(showHint, HINT_DELAY_MS)
    let raf = 0
    let tick = 0
    let running = false
    let lastTs = 0
    let queued = 0
    let hostLeft = 0
    let hostTop = 0
    let wipeCount = 0
    const glassInputs = { city: null as CityTextures | null, props: props.target, smoke: null as WebGLTexture | null }
    let handleX = NaN
    let handleY = NaN
    let handleW = NaN
    let handleH = NaN

    // ── Pointer: grab the match, or wipe the glass ───────────────────────
    function onDown(e: PointerEvent) {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const x = e.clientX - hostLeft
      const y = e.clientY - hostTop
      const touch = e.pointerType === 'touch'
      const hit = e.currentTarget === handle ? 'match' : match.hitTest(state, cam, x, y, cssW, cssH, touch)
      if (hit === 'match' && claimedId < 0) {
        claimedId = e.pointerId
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        input.x = x
        input.y = y
        input.touch = touch
        input.present = true
        input.down = true
        handle.dataset.grabbing = ''
        e.preventDefault()
      } else {
        wipeId = e.pointerId
        lastWipeU = -1
        addWipe(x, y, true)
      }
      requestRender()
    }

    function onMove(e: PointerEvent) {
      const x = e.clientX - hostLeft
      const y = e.clientY - hostTop
      if (e.pointerType === 'mouse') {
        mouseSeen = true
        parallaxX = (x / cssW) * 2 - 1
        parallaxY = 1 - (y / cssH) * 2
      }
      if (claimedId < 0 || e.pointerId === claimedId) {
        input.x = x
        input.y = y
        input.touch = e.pointerType === 'touch'
        input.present = true
      }
      if (e.pointerId !== claimedId) {
        const pressing = e.pointerId === wipeId
        if (pressing || e.pointerType === 'mouse') addWipe(x, y, pressing)
      }
      requestRender()
    }

    function onUp(e: PointerEvent) {
      if (e.pointerId === claimedId) {
        claimedId = -1
        input.down = false
        delete handle.dataset.grabbing
      }
      if (e.pointerId === wipeId) wipeId = -1
      requestRender()
    }

    function onLeave(e: PointerEvent) {
      if (e.pointerType !== 'mouse' || e.pointerId === claimedId) return
      input.present = false
      lastWipeU = -1
      parallaxX = 0
      parallaxY = 0
    }

    /** Dabs along the pointer's path since the last one, so a fast stroke is
     *  a continuous wipe. A hovering mouse barely clears the glass; a press or
     *  a sideways swipe wipes it. */
    function addWipe(x: number, y: number, strong: boolean) {
      const u = x / cssW
      const v = 1 - y / cssH
      if (lastWipeU < 0) {
        lastWipeU = u
        lastWipeV = v
      }
      const aspect = cssW / cssH
      const dist = Math.hypot((u - lastWipeU) * aspect, v - lastWipeV)
      const steps = Math.min(8, Math.max(1, Math.ceil(dist / 0.012)))
      for (let i = 1; i <= steps && wipeCount < WIPE_POOL; i += 1) {
        const k = i / steps
        const w = wipePool[wipeCount]
        wipeCount += 1
        w.u = lastWipeU + (u - lastWipeU) * k
        w.v = lastWipeV + (v - lastWipeV) * k
        w.r = strong ? 0.055 : 0.03
        w.strength = strong ? 0.85 : 0.08
        state.wipes.push(w)
      }
      lastWipeU = u
      lastWipeV = v
    }

    // ── The DOM handle: keyboard access, and a touch target that doesn't scroll ──
    function act() {
      noteGrab()
      const m = state.matches[0]
      if (!m || m.phase !== 'lit') match.act('strike')
      else if (!state.candle.lit) match.act('candle')
      else match.act('blow')
      requestRender()
    }

    function noteGrab() {
      if (grabbed) return
      grabbed = true
      window.clearTimeout(hintTimer)
      if (hint) hint.hidden = true
    }

    function showHint() {
      if (!hint || grabbed || destroyed || failed) return
      hint.hidden = false
      placeHint()
    }

    function placeHint() {
      if (!hint || hint.hidden) return
      section.style.setProperty('--hint-x', `${Math.round(handleX + handleW / 2)}px`)
      section.style.setProperty('--hint-y', `${Math.round(handleY)}px`)
    }

    function placeHandle() {
      const r = match.handleRect(state, cam, cssW, cssH)
      if (Math.abs(r.x - handleX) < 0.5 && Math.abs(r.y - handleY) < 0.5 && Math.abs(r.w - handleW) < 0.5 && Math.abs(r.h - handleH) < 0.5) return
      handleX = r.x
      handleY = r.y
      handleW = r.w
      handleH = r.h
      const s = handle.style
      s.left = `${Math.round(r.x)}px`
      s.top = `${Math.round(r.y)}px`
      s.width = `${Math.round(r.w)}px`
      s.height = `${Math.round(r.h)}px`
      placeHint()
    }

    function labelHandle() {
      const m = state.matches[0]
      const lit = m?.phase === 'lit'
      const label = !lit ? 'Strike a match' : !state.candle.lit ? 'Light the candle with the match' : 'Blow out the match'
      if (handle.getAttribute('aria-label') !== label) handle.setAttribute('aria-label', label)
    }

    function onEvent(ev: MatchEvent) {
      if (ev === 'grab') noteGrab()
      const text = LIVE[ev]
      if (text && live) live.textContent = text
      labelHandle()
    }

    // ── The frame ────────────────────────────────────────────────────────
    function step(dt: number) {
      state.dt = dt
      if (!state.reduced) state.t += dt
      const k = mouseSeen ? 1 - Math.exp(-dt * 3) : 0
      state.parallax[0] += (parallaxX - state.parallax[0]) * k
      state.parallax[1] += (parallaxY - state.parallax[1]) * k
      const events = match.update(state, cam, input, cssW, cssH)
      for (let i = 0; i < events.length; i += 1) onEvent(events[i])
      placeHandle()
    }

    function render() {
      glass.stepFog(state)
      if (smoke && (smoke.active || state.smoke.length > 0)) smoke.step(state.dt, state.smoke)
      props.render(state, cam, city)
      glassInputs.city = city
      glassInputs.props = props.target
      glassInputs.smoke = smoke && smoke.active ? smoke.texture : null
      glass.render(state, cam, glassInputs)
      state.smoke.length = 0
      state.wipes.length = 0
      wipeCount = 0
    }

    function safely(dt: number) {
      try {
        step(dt)
        render()
      } catch (err) {
        fail(err)
      }
    }

    function frame(ts: number) {
      raf = 0
      if (!running || destroyed) return
      raf = requestAnimationFrame(frame)
      const interval = lastTs ? ts - lastTs : 0
      lastTs = ts
      pace(ts, interval)
      safely(interval > 0 ? Math.min(0.1, interval / 1000) : 1 / 60)
    }

    function pace(ts: number, interval: number) {
      if (pinned !== null || ts < paceFrom || !(interval > 0) || interval > 250) return
      intervals[intervalCount % PACE_WINDOW] = interval
      intervalCount += 1
      if (interval < fastest) fastest = interval
      if (intervalCount % PACE_WINDOW !== 0) return
      sorted.set(intervals)
      sorted.sort()
      const median = sorted[PACE_WINDOW >> 1]
      if (median > fastest * PACE_RATIO && scaleIndex < SCALES.length - 1) {
        scaleIndex += 1
        resizeBuffers()
        paceFrom = ts + PACE_WARMUP_MS
        intervalCount = 0
      }
    }

    // Reduced motion never runs a loop: a frame is drawn when something asks
    // for one (a scroll, a pointer, a resize), and a slow tick keeps a burning
    // flame honest while one is lit.
    requestRender = () => {
      if (destroyed || failed || queued || (running && !state.reduced)) return
      queued = requestAnimationFrame((ts) => {
        queued = 0
        const interval = lastTs ? ts - lastTs : 0
        lastTs = ts
        safely(interval > 0 ? Math.min(0.1, interval / 1000) : 1 / 60)
        if (!state.reduced) return
        // Anything but a match at rest is mid-motion (a scripted strike, a
        // fall, a fresh match sliding out): keep ticking until it settles.
        const active = state.matches[0]
        const busy = running && (state.flames.length > 0 || input.down || (!!active && active.phase !== 'rest'))
        if (busy && !tick) tick = window.setInterval(() => requestRender(), REDUCED_TICK_MS)
        else if (!busy && tick) {
          window.clearInterval(tick)
          tick = 0
        }
      })
    }

    function fail(err: unknown) {
      if (failed) return
      failed = true
      console.error(err)
      stopLoop()
      canvas.hidden = true
      handle.hidden = true
      section.dataset.monsoonPoster = ''
    }

    function stopLoop() {
      running = false
      if (raf) cancelAnimationFrame(raf)
      if (queued) cancelAnimationFrame(queued)
      if (tick) window.clearInterval(tick)
      raf = 0
      queued = 0
      tick = 0
    }

    // ── Size and the city ────────────────────────────────────────────────
    function resizeBuffers() {
      const s = scale()
      let bw = Math.max(1, Math.round(cssW * env.dpr * s))
      let bh = Math.max(1, Math.round(cssH * env.dpr * s))
      if (bw * bh > MAX_PIXELS) {
        const f = Math.sqrt(MAX_PIXELS / (bw * bh))
        bw = Math.round(bw * f)
        bh = Math.round(bh * f)
      }
      if (canvas.width !== bw) canvas.width = bw
      if (canvas.height !== bh) canvas.height = bh
      glass.resize(bw, bh)
      props.resize(bw, bh)
      smoke?.resize(bw, bh)
    }

    function loadCity(mode: LayoutMode) {
      if (cityMode === mode) return
      cityMode = mode
      cityJob += 1
      const job = cityJob
      const [w, h] = plateSize(mode, env.lowPower)
      drawCity({ width: w, height: h })
        .then((plates) => {
          if (destroyed || job !== cityJob) return
          const old = city
          city = {
            night: kit.texture(plates.night, { mipmap: true }),
            day: kit.texture(plates.day, { mipmap: true }),
            emit: kit.texture(plates.emit, { mipmap: true }),
            flicker: kit.texture(plates.flicker, { mipmap: true }),
            groups: plates.groups,
            lanes: plates.lanes,
            aspect: plates.aspect,
          }
          if (old) {
            kit.deleteTexture(old.night)
            kit.deleteTexture(old.day)
            kit.deleteTexture(old.emit)
            kit.deleteTexture(old.flicker)
          }
          requestRender()
        })
        .catch((err) => console.error(err))
    }

    function measureHost() {
      const r = host.getBoundingClientRect()
      hostLeft = r.left
      hostTop = r.top
    }

    // ── Wiring ───────────────────────────────────────────────────────────
    const signal: AbortSignal = env.signal
    for (const el of [canvas, handle] as HTMLElement[]) {
      el.addEventListener('pointerdown', onDown, { signal })
      el.addEventListener('pointermove', onMove, { signal })
      el.addEventListener('pointerup', onUp, { signal })
      el.addEventListener('pointercancel', onUp, { signal })
      el.addEventListener('pointerleave', onLeave, { signal })
    }
    handle.addEventListener('click', (e) => {
      // A pointer press is a drag, handled above; detail 0 is the keyboard.
      if (e.detail === 0) act()
    }, { signal })
    handle.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      noteGrab()
      match.act('blow')
      requestRender()
    }, { signal })
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      fail(new Error('monsoon: the WebGL context was lost'))
    }, { signal })

    measureHost()
    match.reset(state, cam)
    resizeBuffers()
    loadCity(cam.mode)
    labelHandle()

    return {
      start() {
        if (running || destroyed || failed) return
        running = true
        lastTs = 0
        paceFrom = performance.now() + PACE_WARMUP_MS
        intervalCount = 0
        if (state.reduced) requestRender()
        else raf = requestAnimationFrame(frame)
      },
      stop: stopLoop,
      resize(w, h) {
        cssW = Math.max(1, w)
        cssH = Math.max(1, h)
        measureHost()
        const mode = layoutFor(cssW, cssH)
        cam = makeCamera(cssW, cssH)
        if (mode !== cityMode) match.reset(state, cam)
        resizeBuffers()
        loadCity(mode)
        story?.refresh()
        requestRender()
      },
      destroy() {
        if (destroyed) return
        stopLoop()
        destroyed = true
        window.clearTimeout(hintTimer)
        story?.destroy()
        try {
          glass.destroy()
          props.destroy()
          smoke?.destroy()
        } catch (err) {
          console.error(err)
        }
        kit.destroy()
        gl.getExtension('WEBGL_lose_context')?.loseContext()
        canvas.remove()
        handle.remove()
        if (hint) hint.hidden = true
        if (live) live.textContent = ''
        delete section.dataset.monsoonPoster
        section.style.removeProperty('--hint-x')
        section.style.removeProperty('--hint-y')
      },
    }
  }
}

