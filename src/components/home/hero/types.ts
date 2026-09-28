/**
 * The contract the home hero behind the dev-only `?hero=` switch follows
 * (src/pages/index.astro), and the one mount that runs it (mount.ts).
 *
 * It is the Hero Lab's module contract carried over, with one change: the
 * name, the tagline and the social links are server-rendered, so they are in
 * the HTML before any script runs and for a visitor with none. A hero reads
 * them from `env.text` and never draws its own copy.
 */
export type HeroId = 'network'

export interface HeroText {
  /** `section[data-type="hero"]`, the full-bleed hero. */
  section: HTMLElement
  /** `div[data-type="hero-content"]`, the server-rendered text block. A hero
   *  may append its own nodes here, such as network's readout, and removes
   *  them in destroy(). */
  content: HTMLElement
  name: HTMLElement
  tagline: HTMLElement
  /** `nav[data-type="hero-links"]`. Absent when no social URL is configured. */
  links: HTMLElement | null
}

export interface HeroEnv {
  /** `prefers-reduced-motion: reduce`, read once at mount. */
  reduced: boolean
  /** `pointer: coarse`. */
  isTouch: boolean
  /** A touch device or at most four cores: the hero starts at a lower resolution. */
  lowPower: boolean
  /** `devicePixelRatio`, capped at 2. */
  dpr: number
  text: HeroText
  /** Aborted when the hero is destroyed. Every document or window listener a
   *  hero adds passes it, so none outlives an in-site navigation. */
  signal: AbortSignal
}

export interface HeroInstance {
  /** Begin or resume animation: on mount, and when the tab or the hero is visible again. */
  start(): void
  /** Pause every rAF and timer: the tab is hidden, the hero is off screen, or it is about to go. */
  stop(): void
  /** CSS px of the stage. Called once right after create, then on every resize. */
  resize(width: number, height: number): void
  /** Remove listeners, free the GPU context, and empty the host. */
  destroy(): void
}

/** `host` is an empty element filling the stage. A hero builds its canvas and
 *  controls inside it and touches nothing else, apart from `env.text.content`. */
export type HeroCreate = (host: HTMLElement, env: HeroEnv) => HeroInstance
