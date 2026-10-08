/**
 * Shared nav behaviour for both site shells (Base.astro + ToolBase.astro).
 *
 * Extracted here so the two layouts no longer carry byte-identical copies of
 * this script. Wires three things, with the per-page work re-applied after every
 * View Transition via `astro:page-load` (the ClientRouter re-runs bundled
 * scripts only once per session, so anything that must run on each in-site
 * navigation has to live in that listener):
 *
 *  - `--nav-h`: the live nav height → CSS variable that `main`'s top padding and
 *    the anchor `scroll-padding-top` read, so content never hides under the
 *    fixed hero nav (a ResizeObserver keeps it current if the nav wraps).
 *  - hide-on-scroll-down / show-on-scroll-up for the fixed hero nav.
 *  - lazy-mounts the StarField hero canvas, and the hubs' sky (sky-ui.ts).
 *
 * The window-level scroll/resize listeners are registered ONCE (guarded by
 * `wired`), not on every navigation. The previous inline version re-added them
 * inside its per-page `setup()`, leaking one scroll + one resize listener per
 * in-site navigation. `window` survives client-side nav, so registering once is
 * both correct and leak-free; only the height re-measure and canvas mount need
 * to repeat per page.
 */
let wired = false
let starFieldImportQueued = false

// The nav's height, kept by the observer below so the scroll handler never
// reads layout itself.
let navH = 0
let navObserver: ResizeObserver | null = null

/**
 * Flags whether anything has scrolled, which is the only situation where page
 * text can pass beneath the fixed nav. The CSS uses it to swap the nav from
 * transparent (hero runs through it unbroken) to frosted (links stay legible
 * over content). Kept separate from onScroll so page load can set the initial
 * state without disturbing the hide-on-scroll bookkeeping below.
 */
function syncNavScrolled(nav: HTMLElement) {
  nav.toggleAttribute('data-nav-scrolled', window.scrollY > 0)
}

// A ResizeObserver callback runs after layout, so reading the nav here forces no
// reflow. Measuring synchronously when the module evaluates did: it made the
// script pay for the page's first layout (Lighthouse "forced reflow"). The
// first callback also covers a page that loads already scrolled, and a later
// one covers the nav wrapping on resize.
function onNavResize(entries: ResizeObserverEntry[]) {
  const nav = entries[entries.length - 1].target as HTMLElement
  navH = nav.offsetHeight
  document.documentElement.style.setProperty('--nav-h', navH + 'px')
  syncNavScrolled(nav)
}

function watchNav() {
  const nav = document.querySelector('[data-type="hero-nav"]') as HTMLElement | null
  navObserver ??= new ResizeObserver(onNavResize)
  // A ClientRouter swap replaces the nav; observing the new one reports at once.
  navObserver.disconnect()
  if (nav) navObserver.observe(nav)
}

let lastScroll = 0
function onScroll() {
  const nav = document.querySelector('[data-type="hero-nav"]') as HTMLElement | null
  if (!nav) return
  syncNavScrolled(nav)
  const current = window.scrollY
  const isMobile = window.innerWidth <= 768

  if (isMobile) {
    // On mobile touch screens, accidental upward swipes or touch jitter during
    // gameplay should not drop the nav bar down to occlude 10-15% of the board.
    // Keep it hidden once scrolled down past the header; only reveal when
    // returning to the top of the page.
    if (current > navH + 20) {
      nav.setAttribute('data-nav-hidden', '')
    } else if (current <= navH + 10) {
      nav.removeAttribute('data-nav-hidden')
    }
  } else {
    if (current > lastScroll && current > navH + 20) {
      nav.setAttribute('data-nav-hidden', '')
    } else if (current < lastScroll) {
      nav.removeAttribute('data-nav-hidden')
    }
  }
  lastScroll = current
}

function mountStarField() {
  if (starFieldImportQueued) return
  if (!document.querySelector('star-field')) return
  starFieldImportQueued = true
  const run = () => import('../components/home/StarField.ts')
  const requestIdle = (window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  }).requestIdleCallback
  if (requestIdle) {
    requestIdle(run, { timeout: 1200 })
    return
  }
  setTimeout(run, 800)
}

// The hubs' sky: imported on idle the first time a page renders its host,
// then (re)mounted on every page, which also unmounts it from pages without one.
let skyUi: Promise<typeof import('./sky-ui')> | null = null
function mountSky() {
  if (!skyUi && !document.querySelector('div[data-type="sky"]')) return
  if (!skyUi) {
    skyUi = new Promise(resolve => {
      const run = () => resolve(import('./sky-ui'))
      const requestIdle = (window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      }).requestIdleCallback
      if (requestIdle) requestIdle(run, { timeout: 1200 })
      else setTimeout(run, 800)
    })
  }
  void skyUi.then(m => m.mountSky())
}

function pageSetup() {
  watchNav()
  mountStarField()
  mountSky()
}

export function initNav() {
  if (wired) return
  wired = true
  // Persistent window listeners — registered once (window outlives in-site nav).
  window.addEventListener('scroll', onScroll, { passive: true })
  // Per-page work: re-observe the nav and (re)mount the hero canvas after every
  // View Transition. Also run once immediately for shells that intentionally
  // skip ClientRouter on direct tool/game loads.
  pageSetup()
  document.addEventListener('astro:page-load', pageSetup)
}
