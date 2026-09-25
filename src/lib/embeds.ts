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
  'poker-trainer': 'poker-trainer-game',
  'deep-shore': 'deep-shore-game',
  // Simulations — no /games page; they live in articles and/or Driftfield.
  'game-of-life': 'game-of-life-game',
  'flow-field': 'flow-field-game',
  'starfield-toy': 'starfield-voyager-game',
  'murmuration': 'murmuration-game',
  'turing-bloom': 'turing-bloom-game',
  'sand-loom': 'sand-loom-game',
  'lsystem-tree': 'lsystem-tree-game',
  // Figures — neither a game nor a Driftfield mode. These exist only to be
  // embedded in an article, which is why EMBED_TAGS is the wider list.
  'diagram-atlas': 'diagram-atlas-figure',
}

/**
 * Embeds that write NO title block of their own, so `stripEmbedChrome` has
 * nothing to wait for and starts no observer.
 *
 * Every game and simulation writes an `<h1>` and a blurb into itself, because on
 * its own page it WAS the page, and the embedding routes strip them with a
 * MutationObserver that disconnects on its first hit. A figure written only to
 * be embedded writes neither — so its observer never got a hit, never
 * disconnected, and re-scanned the container on every mutation for the life of
 * the page: eight of them on the diagrams article, five of whose figures redraw
 * on a timer. `security:smoke` derives this set from the components' own sources
 * in both directions, so it cannot drift from what they actually render.
 */
export const EMBED_NO_CHROME: ReadonlySet<string> = new Set(['diagram-atlas'])

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
