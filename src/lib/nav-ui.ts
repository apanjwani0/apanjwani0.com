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
 *    fixed hero nav (re-measured on resize in case the nav wraps).
 *  - hide-on-scroll-down / show-on-scroll-up for the fixed hero nav.
 *  - lazy-mounts the StarField hero canvas.
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

function syncNavHeight() {
  const nav = document.querySelector('[data-type="hero-nav"]') as HTMLElement | null
  if (nav) {
    document.documentElement.style.setProperty('--nav-h', nav.offsetHeight + 'px')
  }
}

/**
 * Flags whether anything has scrolled, which is the only situation where page
 * text can pass beneath the fixed nav. The CSS uses it to swap the nav from
 * transparent (hero runs through it unbroken) to frosted (links stay legible
 * over content). Kept separate from onScroll so page load can set the initial
 * state without disturbing the hide-on-scroll bookkeeping below.
 */
function syncNavScrolled() {
  const nav = document.querySelector('[data-type="hero-nav"]') as HTMLElement | null
  nav?.toggleAttribute('data-nav-scrolled', window.scrollY > 0)
}

let lastScroll = 0
function onScroll() {
  const nav = document.querySelector('[data-type="hero-nav"]') as HTMLElement | null
  if (!nav) return
  syncNavScrolled()
  const current = window.scrollY
  if (current > lastScroll && current > nav.offsetHeight + 20) {
    nav.setAttribute('data-nav-hidden', '')
  } else if (current < lastScroll) {
    nav.removeAttribute('data-nav-hidden')
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

function pageSetup() {
  syncNavHeight()
  // A page can load already scrolled — an anchor link, a restored position, or a
  // View Transition into a page mid-scroll — so the frosted state has to be
  // resolved on load, not only on the next scroll event.
  syncNavScrolled()
  mountStarField()
}

export function initNav() {
  if (wired) return
  wired = true
  // Persistent window listeners — registered once (window outlives in-site nav).
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', syncNavHeight)
  // Per-page work: re-measure the nav and (re)mount the hero canvas after every
  // View Transition. Also run once immediately for shells that intentionally
  // skip ClientRouter on direct tool/game loads.
  pageSetup()
  document.addEventListener('astro:page-load', pageSetup)
}
