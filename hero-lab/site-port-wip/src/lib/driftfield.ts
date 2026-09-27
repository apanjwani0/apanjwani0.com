/**
 * Driftfield — the generative-art tool, and the six engines it runs.
 *
 * Each mode is its own route (`/tools/driftfield/<slug>`) rather than a query
 * parameter on one page.
 *
 * **The SEO rationale this split was built on has since been checked and does
 * not hold.** It assumed the per-engine long tail was near-uncontested. Actual
 * page-1 results say otherwise: "flow field generator" is a fluid-dynamics query
 * (patents, arXiv, an ML airfoil repo — no browser tools at all), and "boids
 * simulation online" is held by Craig Reynolds' own 1986 page. Worse for the
 * split specifically, the one site ranking well on this material does it with a
 * SINGLE combined page covering several noise algorithms, which is evidence for
 * consolidation rather than against it. Only reaction-diffusion came back
 * genuinely open.
 *
 * What is still true, and why this is left standing rather than unwound: six
 * routes cost little, `?mode=` genuinely does not rank as a separate page, and
 * the 301s from the old `/games/*` URLs are right either way — nobody searches
 * for a "flow field game", so those pages had the wrong intent. Do NOT extend
 * this pattern to new engines without demand data; see docs/plans/learnings.md.
 */

import type { Tool } from '../config/tools'

export interface DriftfieldMode {
  /** URL segment AND the EMBED_TAGS key for the component this mode mounts. */
  slug: string
  title: string
  /** Used verbatim as the page title — carries the keywords, so no name suffix. */
  seoTitle: string
  description: string
  keywords: string
}

export const DRIFTFIELD_MODES: DriftfieldMode[] = [
  {
    slug: 'flow-field',
    title: 'Flow Field',
    seoTitle: 'Flow Field Generator — Perlin Noise Wallpaper Maker',
    description:
      'Particles released into a field of Perlin noise, tracing long curved paths. Tune the noise scale, particle count and fade, then export at your screen resolution.',
    keywords: 'flow field generator, perlin noise wallpaper, generative art wallpaper, particle flow field, noise field art',
  },
  {
    slug: 'murmuration',
    title: 'Murmuration',
    seoTitle: 'Boids Flocking Simulation — Murmuration Generator',
    description:
      'Craig Reynolds’ three flocking rules, running live. Adjust separation, alignment and cohesion and watch the flock hold together or fall apart.',
    keywords: 'boids simulation, flocking simulation online, murmuration generator, starling flock simulation, separation alignment cohesion',
  },
  {
    slug: 'turing-bloom',
    title: 'Turing Bloom',
    seoTitle: 'Reaction-Diffusion Generator — Turing Pattern Maker',
    description:
      'Two chemicals, different diffusion rates, and the patterns Alan Turing predicted in 1952. Change the feed and kill rates to move between spots, stripes and mazes.',
    keywords: 'reaction diffusion simulator, turing pattern generator, gray scott model online, morphogenesis simulation',
  },
  {
    slug: 'lsystem-tree',
    title: 'Fractal Garden',
    seoTitle: 'L-System Tree Generator — Fractal Plant Maker',
    description:
      'Grow plants from a rewriting rule, the way Lindenmayer described algae in 1968. Change the rule, angle and depth to get a different species.',
    keywords: 'l-system generator, fractal tree generator, procedural plant generator, lindenmayer system online, turtle graphics tree',
  },
  {
    slug: 'sand-loom',
    title: 'Sand Loom',
    seoTitle: 'Falling Sand Simulation — Generative Sand Art',
    description:
      'Grains falling one at a time until the pile finds its own critical slope, and every avalanche size becomes possible.',
    keywords: 'falling sand simulation, sandpile model online, cellular automata sand, self organized criticality demo',
  },
  {
    slug: 'starfield-toy',
    title: 'Starfield',
    seoTitle: 'Starfield Generator — Space Screensaver Maker',
    description:
      'The screensaver that outlived the problem it was invented for: an endless fall through stars, at whatever speed and density you like.',
    keywords: 'starfield generator, space screensaver, star field animation, retro screensaver maker',
  },
]

export const DRIFTFIELD_SLUG = 'driftfield'

/** The only fields the predicate below reads — exported so callers state this
 *  shape instead of hand-rolling a second, looser one, exactly as `GameFlags`
 *  (src/lib/games.ts) and `LearningFlags` (src/lib/learnings.ts) do. */
export type DriftfieldToolFlags = Pick<Tool, 'slug' | 'status'>

/**
 * The ONE predicate that decides whether Driftfield's routes are real pages.
 *
 * Driftfield is a tool with sub-routes, so "is this page real" is the tools
 * rule — `status === 'live'` — asked of the single `driftfield` entry in the
 * tools config. Every consumer reads THIS function: the hub route, each mode
 * route, the sitemap, and the share-card generator.
 *
 * It exists because Driftfield was the one kind of page on this site with no
 * such predicate, and the three consumers that existed gave two different
 * answers. The hub 404'd unless the tool was live and the sitemap listed the
 * modes only when it was live, but `/tools/driftfield/<mode>` never read the
 * tools config at all: it answered 200 with `index, follow`, a
 * `summary_large_image` card and WebApplication JSON-LD no matter what the
 * config said, above a breadcrumb pointing at a hub that was serving 404. Six
 * indexable pages advertising a product the rest of the site had withdrawn is
 * exactly the "signals that contradict each other" failure the Indexing rule in
 * AGENTS.md exists to prevent — a crawler resolves the conflict by trusting
 * none of them.
 *
 * Note this is deliberately stricter than `/tools/[slug]`, where `wip` renders
 * publicly behind a noindex: the hub has always 404'd on anything but `live`,
 * and softening that is a product decision, not an indexing one. What matters
 * here is that the hub, the modes, the sitemap and the cards agree.
 */
export function isDriftfieldPublic(tools: DriftfieldToolFlags[]): boolean {
  return tools.some(t => t.slug === DRIFTFIELD_SLUG && t.status === 'live')
}

export function driftfieldMode(slug: string | undefined): DriftfieldMode | undefined {
  return DRIFTFIELD_MODES.find(m => m.slug === slug)
}

/** Old `/games/<slug>` → new home, for the 301s the games route serves. */
export const MOVED_GAMES: Record<string, string> = {
  // The poker game became the trainer. Without this its URL 404s, and it is the
  // one removed page whose successor is a direct replacement rather than a move.
  poker: '/games/poker-trainer',
  // Conway's Game of Life had an article to land on; that article is gone. The
  // generative-art hub is the closest surviving relative — a cellular automaton
  // belongs with the other engines, and the URL is live in production so it
  // cannot simply stop resolving.
  'game-of-life': '/tools/driftfield',
  ...Object.fromEntries(
    DRIFTFIELD_MODES.map(m => [m.slug, `/tools/${DRIFTFIELD_SLUG}/${m.slug}`]),
  ),
}
