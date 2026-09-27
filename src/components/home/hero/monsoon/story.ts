/**
 * Scroll turns into the story's time of day. Piecewise-linear between anchors
 * (the landing, each `[data-chapter]`, then the loop clone), unwrapped forward
 * through midnight so the minute value only ever increases across the whole
 * page — which is what makes the loop-back jump exactly invisible: right
 * before the jump the unwrapped minute already equals "landing + 1440", and
 * right after it the scrollY that produces it is back at the landing's own
 * anchor, so the reported minute doesn't move.
 *
 * `minutes()` is pull-based (reads `window.scrollY` fresh every call, cheap:
 * a short scan of a handful of cached anchors) so the render loop always has
 * a live value even between scroll events. `onTime`/the HUD text are
 * push-based, updated once per scroll frame, coalesced into a single rAF.
 */
import { shiftLine, wrapMin } from '../day'

export interface Story {
  minutes(): number
  refresh(): void
  destroy(): void
}

export interface CreateStoryOpts {
  section: HTMLElement
  story: HTMLElement
  hud: HTMLElement | null
  reduced: boolean
  signal: AbortSignal
  onTime(minutes: number): void
}

interface Anchor {
  scrollY: number
  unwrapped: number
}

export function createStory(opts: CreateStoryOpts): Story {
  // `reduced` doesn't change this module's own behaviour (the loop's jump is
  // an instant, invisible teleport, not an animation to turn off), but it's
  // part of the shared create-opts shape every monsoon module takes.
  void opts.reduced

  let anchors: Anchor[] = [{ scrollY: 0, unwrapped: 0 }]
  let cloneOffsetTop = 0
  let chapters: HTMLElement[] = []
  let destroyed = false
  let rafId = 0

  function numAt(el: Element): number {
    const n = Number(el.getAttribute('data-at'))
    return Number.isFinite(n) ? n : 0
  }

  /** Document y of an element's top. Not offsetTop: the story is positioned
   *  (it stacks above the fixed scene), which makes offsetTop story-relative. */
  function docTop(el: Element): number {
    return el.getBoundingClientRect().top + window.scrollY
  }

  function measure(): void {
    const landingAt = numAt(opts.section)
    const vh = window.innerHeight || 1
    const landingTop = docTop(opts.section)
    const next: Anchor[] = [{ scrollY: 0, unwrapped: landingAt }]
    let prevAt = landingAt
    let prevUnwrapped = landingAt
    for (const ch of chapters) {
      const at = numAt(ch)
      const scrollY = Math.max(0, docTop(ch) - 0.25 * vh)
      const unwrapped = prevUnwrapped + ((at - prevAt + 1440) % 1440)
      next.push({ scrollY, unwrapped })
      prevAt = at
      prevUnwrapped = unwrapped
    }
    const loopEl = opts.story.querySelector<HTMLElement>('[data-type="story-loop"]')
    if (loopEl) {
      // The jump distance: the clone sits exactly this far below the landing.
      cloneOffsetTop = docTop(loopEl) - landingTop
      next.push({ scrollY: cloneOffsetTop, unwrapped: landingAt + 1440 })
    } else {
      cloneOffsetTop = 0
    }
    anchors = next
  }

  function computeMinutes(): number {
    const y = window.scrollY
    if (anchors.length === 0) return 0
    if (y <= anchors[0].scrollY) return wrapMin(anchors[0].unwrapped)
    for (let i = 0; i < anchors.length - 1; i += 1) {
      const a = anchors[i]
      const b = anchors[i + 1]
      if (y <= b.scrollY) {
        const span = b.scrollY - a.scrollY
        const t = span > 0 ? (y - a.scrollY) / span : 1
        return wrapMin(a.unwrapped + (b.unwrapped - a.unwrapped) * t)
      }
    }
    return wrapMin(anchors[anchors.length - 1].unwrapped)
  }

  function pushTime(): void {
    const m = computeMinutes()
    opts.onTime(m)
    if (opts.hud) opts.hud.textContent = shiftLine(m, false)
  }

  function tick(): void {
    rafId = 0
    if (destroyed) return
    // A pixel short counts: the clone's top is fractional and scrollY is not.
    if (cloneOffsetTop > 0 && window.scrollY >= cloneOffsetTop - 1) {
      window.scrollTo({ top: Math.max(0, window.scrollY - cloneOffsetTop), behavior: 'instant' })
    }
    pushTime()
  }

  function onScroll(): void {
    if (rafId) return
    rafId = requestAnimationFrame(tick)
  }

  function onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const el = entry.target as HTMLElement
      el.dataset.seen = ''
      seenObserver.unobserve(el)
    }
  }

  chapters = Array.from(opts.story.querySelectorAll<HTMLElement>('[data-chapter]'))
  // The sheet hides a chapter until it is seen only while this is set, so a
  // page whose script never ran still shows every word.
  opts.story.dataset.live = ''
  const seenObserver = new IntersectionObserver(onIntersect)
  for (const ch of chapters) seenObserver.observe(ch)

  const resizeObserver = new ResizeObserver(() => refresh())
  resizeObserver.observe(opts.story)

  window.addEventListener('scroll', onScroll, { passive: true, signal: opts.signal })
  document.fonts?.ready.then(() => { if (!destroyed) refresh() }).catch(() => {})

  function refresh(): void {
    if (destroyed) return
    measure()
    pushTime()
  }

  measure()
  pushTime()

  function destroy(): void {
    destroyed = true
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
    resizeObserver.disconnect()
    seenObserver.disconnect()
    delete opts.story.dataset.live
  }

  return { minutes: computeMinutes, refresh, destroy }
}
