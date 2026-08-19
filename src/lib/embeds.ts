/**
 * Every custom element that can be mounted into a page, by slug.
 *
 * This is the master list, and it is deliberately larger than the set of games.
 * A component can appear in three places now:
 *
 *   /games/<slug>                   — it is the page (GAME_TAGS, a subset of this)
 *   /tools/driftfield/<mode>        — it is one mode of the generative tool
 *   /learnings/<slug>               — it is a figure inside an article
 *
 * The six Driftfield engines are in none of the games config any more, but they
 * are still mounted by two of those three routes, so "is wired to a component"
 * and "is a game" had to stop being the same question. They were the same
 * question until the generative engines moved out of /games, and conflating them
 * would have silently emptied every article embed.
 *
 * Lives in src/lib/ and NOT in src/config/ because the /admin Vite middleware
 * regenerates the config files wholesale — an export added there is deleted on
 * the next admin save.
 */
export const EMBED_TAGS: Record<string, string> = {
  // Games — playable, with their own /games page.
  '2048': 'twenty48-game',
  'quintle': 'quintle-game',
  'maze-weaver': 'maze-weaver-game',
  'type-trial': 'type-trial-game',
  'hue-hunt': 'hue-hunt-game',
  // Simulations — no /games page; they live in articles and/or Driftfield.
  'game-of-life': 'game-of-life-game',
  'flow-field': 'flow-field-game',
  'starfield-toy': 'starfield-voyager-game',
  'murmuration': 'murmuration-game',
  'turing-bloom': 'turing-bloom-game',
  'sand-loom': 'sand-loom-game',
  'lsystem-tree': 'lsystem-tree-game',
}

/**
 * The tag to mount for a slug, or undefined when nothing is wired.
 *
 * `Object.hasOwn` and not `EMBED_TAGS[slug]`: a slug of `constructor` or
 * `toString` would otherwise resolve to an inherited function, which is truthy.
 */
export function embedTag(slug: string | undefined): string | undefined {
  if (!slug || !Object.hasOwn(EMBED_TAGS, slug)) return undefined
  return EMBED_TAGS[slug]
}
