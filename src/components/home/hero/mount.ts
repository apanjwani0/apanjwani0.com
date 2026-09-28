/**
 * Mounts the home hero that `section[data-hero]` names. The page script calls
 * initHero(). It mounts once when the script is evaluated and again on every
 * `astro:page-load`, which also fires for the first page, so a mount is a
 * no-op when the same section already has its hero. The hero is destroyed on
 * `astro:before-swap`.
 *
 * The hero is its own chunk, imported only by the page that shows it, so a
 * visitor to the classic hero downloads none of it.
 *
 * The document-level listeners are registered once behind `wired`, the
 * singleton shape nav-ui.ts uses. Everything per mount (visibility, the
 * observers, and whatever the hero itself adds) is bound to one
 * AbortController and released in teardown().
 */
import type { HeroCreate, HeroEnv, HeroId, HeroInstance } from './types'

const LOADERS: Record<HeroId, () => Promise<{ create: HeroCreate }>> = {
  network: () => import('./network'),
}

interface Mounted {
  section: HTMLElement
  instance: HeroInstance | null
  controller: AbortController
  observers: Array<ResizeObserver | IntersectionObserver>
}

let current: Mounted | null = null
let wired = false

function isHeroId(value: string | undefined): value is HeroId {
  return value !== undefined && Object.hasOwn(LOADERS, value)
}

function teardown() {
  if (!current) return
  const { instance, controller, observers } = current
  current = null
  controller.abort()
  for (const observer of observers) observer.disconnect()
  if (!instance) return
  try {
    instance.stop()
    instance.destroy()
  } catch (err) {
    console.error(err)
  }
}

async function mount() {
  const section = document.querySelector<HTMLElement>('section[data-type="hero"][data-hero]')
  if (current?.section === section) return
  teardown()
  const id = section?.dataset.hero
  const host = section?.querySelector<HTMLElement>('[data-type="hero-stage"]')
  const content = section?.querySelector<HTMLElement>('[data-type="hero-content"]')
  const name = content?.querySelector<HTMLElement>('h1')
  const tagline = content?.querySelector<HTMLElement>('[data-type="tagline"]')
  if (!section || !isHeroId(id) || !host || !content || !name || !tagline) return

  const controller = new AbortController()
  const mounted: Mounted = { section, instance: null, controller, observers: [] }
  current = mounted

  let create: HeroCreate
  try {
    ;({ create } = await LOADERS[id]())
  } catch (err) {
    console.error(err)
    section.dataset.heroFailed = ''
    return
  }
  // A navigation during the import already tore this mount down.
  if (current !== mounted || !section.isConnected) return

  const isTouch = matchMedia('(pointer: coarse)').matches
  const env: HeroEnv = {
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    isTouch,
    lowPower: isTouch || (navigator.hardwareConcurrency || 8) <= 4,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    text: {
      section,
      content,
      name,
      tagline,
      links: content.querySelector<HTMLElement>('[data-type="hero-links"]'),
    },
    signal: controller.signal,
  }

  let instance: HeroInstance
  try {
    instance = create(host, env)
  } catch (err) {
    console.error(err)
    host.replaceChildren()
    section.dataset.heroFailed = ''
    return
  }
  mounted.instance = instance

  const size = () => {
    const r = host.getBoundingClientRect()
    return [Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height))] as const
  }
  const guarded = (fn: () => void) => {
    try { fn() } catch (err) { console.error(err) }
  }
  guarded(() => instance.resize(...size()))

  // Running only while the tab is visible and the hero's stage is on screen.
  let onScreen = true
  let running = false
  const sync = () => {
    const want = onScreen && !document.hidden
    if (want === running) return
    running = want
    guarded(() => (want ? instance.start() : instance.stop()))
  }
  const resizer = new ResizeObserver(() => guarded(() => instance.resize(...size())))
  resizer.observe(host)
  const visibility = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting
    sync()
  })
  visibility.observe(host)
  mounted.observers.push(resizer, visibility)
  document.addEventListener('visibilitychange', sync, { signal: controller.signal })
  sync()
}

export function initHero() {
  if (wired) return
  wired = true
  void mount()
  document.addEventListener('astro:page-load', () => void mount())
  document.addEventListener('astro:before-swap', teardown)
}
