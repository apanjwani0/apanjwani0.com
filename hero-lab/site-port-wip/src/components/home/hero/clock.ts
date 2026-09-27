/**
 * The 24-hour clock along the hero's bottom edge, ported from the Hero Lab
 * shell's scrubber. It follows the owner's live clock in India. Dragging it,
 * or the arrow keys, scrubs through the day, and it eases back to now after a
 * five-second pause. `onChange(minutes, isNow)` fires on every change, and
 * every 20s while live. The hero decides what an hour looks like.
 *
 * Styles live in src/styles/home.css (`[data-type="hero-clock"]`). Only the
 * values that come from the hour's colour are set inline.
 */
import { DAY_MIN, dayness, hourColor, localMinutes, shiftLine, wrapMin, type Rgb } from './day'

export interface HeroClock {
  el: HTMLElement
  minutes(): number
  isNow(): boolean
  dayness(): number
  /** Live ticking. Call from the hero's own start() and stop(). */
  start(): void
  stop(): void
  destroy(): void
}

const NIGHT_KNOB: Rgb = [0x8f / 255, 0x82 / 255, 0xf5 / 255]
const DAY_KNOB: Rgb = [0xff / 255, 0xc2 / 255, 0x7a / 255]
const NIGHT_GLOW: Rgb = [0x9b / 255, 0x8c / 255, 0xff / 255]
const DAY_GLOW: Rgb = [0xff / 255, 0xb3 / 255, 0x5c / 255]

function rgbCss(c: Rgb): string {
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`
}

function mixCss(a: Rgb, b: Rgb, t: number): string {
  return rgbCss([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
}

function skyGradient(): string {
  const stops: string[] = []
  const c: Rgb = [0, 0, 0]
  for (let h = 0; h <= 48; h += 1) {
    stops.push(`${rgbCss(hourColor(h * 30, c))} ${((h / 48) * 100).toFixed(2)}%`)
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

const KEY_STEP: Record<string, number> = {
  ArrowLeft: -15, ArrowDown: -15, ArrowRight: 15, ArrowUp: 15, PageDown: -60, PageUp: 60,
}

export function createClock(
  host: HTMLElement,
  env: { reduced: boolean },
  onChange: (minutes: number, isNow: boolean) => void,
): HeroClock {
  const doc = host.ownerDocument
  const part = <K extends keyof HTMLElementTagNameMap>(tag: K, name: string) => {
    const el = doc.createElement(tag)
    el.dataset.part = name
    return el
  }
  const wrap = doc.createElement('div')
  wrap.dataset.type = 'hero-clock'
  const row = part('div', 'row')
  const line = part('span', 'line')
  line.setAttribute('aria-live', 'off')
  const nowBtn = part('button', 'now')
  nowBtn.type = 'button'
  nowBtn.textContent = 'back to now'
  nowBtn.hidden = true
  row.append(line, nowBtn)
  const track = part('div', 'track')
  track.tabIndex = 0
  track.setAttribute('role', 'slider')
  track.setAttribute('aria-label', 'Time of day in India')
  track.setAttribute('aria-valuemin', '0')
  track.setAttribute('aria-valuemax', String(DAY_MIN - 1))
  const sky = part('div', 'sky')
  sky.style.background = skyGradient()
  const knob = part('div', 'knob')
  track.append(sky, knob)
  const ticks = part('div', 'ticks')
  ticks.setAttribute('aria-hidden', 'true')
  for (const label of ['12 am', '6 am', 'noon', '6 pm', '12 am']) {
    const tick = doc.createElement('span')
    tick.textContent = label
    ticks.append(tick)
  }
  wrap.append(row, track, ticks)
  host.append(wrap)

  let minutes = localMinutes()
  let live = true
  let liveTimer = 0
  let backTimer = 0
  let anim = 0
  let dragging = false

  const paint = () => {
    const d = dayness(minutes)
    const text = shiftLine(minutes, live)
    knob.style.left = `${(minutes / (DAY_MIN - 1)) * 100}%`
    knob.style.background = mixCss(NIGHT_KNOB, DAY_KNOB, d)
    knob.style.setProperty('--hero-clock-glow', mixCss(NIGHT_GLOW, DAY_GLOW, d))
    line.textContent = text
    track.setAttribute('aria-valuenow', String(Math.round(minutes)))
    track.setAttribute('aria-valuetext', text)
    nowBtn.hidden = live
  }
  const emit = () => {
    paint()
    try { onChange(minutes, live) } catch (err) { console.error(err) }
  }
  const cancelAnim = () => {
    if (anim) cancelAnimationFrame(anim)
    anim = 0
  }
  const backToNow = () => {
    window.clearTimeout(backTimer)
    cancelAnim()
    const target = localMinutes()
    // The short way round the dial.
    const delta = ((target - minutes + DAY_MIN * 1.5) % DAY_MIN) - DAY_MIN / 2
    if (env.reduced || Math.abs(delta) < 1) {
      minutes = target
      live = true
      emit()
      return
    }
    const from = minutes
    const t0 = performance.now()
    const step = (now: number) => {
      let k = Math.min(1, (now - t0) / 1200)
      k = k * k * (3 - 2 * k)
      if (k >= 1) {
        minutes = target
        live = true
        anim = 0
        emit()
        return
      }
      minutes = wrapMin(from + delta * k)
      emit()
      anim = requestAnimationFrame(step)
    }
    step(t0)
  }
  const scheduleBack = () => {
    window.clearTimeout(backTimer)
    backTimer = window.setTimeout(backToNow, 5000)
  }
  const setScrub = (m: number) => {
    cancelAnim()
    live = false
    minutes = wrapMin(m)
    emit()
  }
  const fromX = (clientX: number) => {
    const r = track.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width))) * (DAY_MIN - 1)
  }

  const ac = new AbortController()
  const on = { signal: ac.signal }
  track.addEventListener('pointerdown', (e) => {
    dragging = true
    window.clearTimeout(backTimer)
    try { track.setPointerCapture(e.pointerId) } catch { /* capture is best-effort */ }
    setScrub(fromX(e.clientX))
  }, on)
  track.addEventListener('pointermove', (e) => { if (dragging) setScrub(fromX(e.clientX)) }, on)
  const release = () => {
    if (!dragging) return
    dragging = false
    scheduleBack()
  }
  track.addEventListener('pointerup', release, on)
  track.addEventListener('pointercancel', release, on)
  track.addEventListener('keydown', (e) => {
    const stepBy = KEY_STEP[e.key]
    if (stepBy) setScrub(minutes + stepBy)
    else if (e.key === 'Home') setScrub(0)
    else if (e.key === 'End') setScrub(DAY_MIN - 1)
    else if (e.key === 'Escape') {
      backToNow()
      e.preventDefault()
      return
    } else return
    e.preventDefault()
    scheduleBack()
  }, on)
  nowBtn.addEventListener('click', backToNow, on)
  emit()

  const clock: HeroClock = {
    el: wrap,
    minutes: () => minutes,
    isNow: () => live,
    dayness: () => dayness(minutes),
    start() {
      if (liveTimer) return
      // stop() drops a pending return to now, so a scrub left in a hidden tab resumes it here.
      if (!live && !dragging) scheduleBack()
      liveTimer = window.setInterval(() => {
        if (!live) return
        minutes = localMinutes()
        emit()
      }, 20000)
    },
    stop() {
      window.clearInterval(liveTimer)
      liveTimer = 0
      window.clearTimeout(backTimer)
      cancelAnim()
    },
    destroy() {
      clock.stop()
      ac.abort()
      wrap.remove()
    },
  }
  return clock
}
