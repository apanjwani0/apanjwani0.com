import type { Game } from '../config/games'

/**
 * One custom-element tag per playable game.
 *
 * This lives here, not in src/config/games.ts, because the /admin Vite
 * middleware regenerates that file wholesale from `generateGames()` on every
 * save — an export added there would be silently deleted the next time anyone
 * edits the games config.
 */
export const GAME_TAGS: Record<string, string> = {
  '2048': 'twenty48-game',
  'quintle': 'quintle-game',
  'game-of-life': 'game-of-life-game',
  'flow-field': 'flow-field-game',
  'maze-weaver': 'maze-weaver-game',
  'type-trial': 'type-trial-game',
  'hue-hunt': 'hue-hunt-game',
  'starfield-toy': 'starfield-voyager-game',
  'murmuration': 'murmuration-game',
  'turing-bloom': 'turing-bloom-game',
  'sand-loom': 'sand-loom-game',
  'lsystem-tree': 'lsystem-tree-game',
}

/** The only fields these predicates read — exported so src/lib/og.ts can state
 *  the same shape instead of hand-rolling a second, looser one. */
export type GameFlags = Pick<Game, 'slug' | 'enabled' | 'interactive'>

/**
 * Playable means all three: enabled, flagged `interactive`, AND actually wired
 * to a component above. The third condition is the one the config cannot know,
 * and leaving it out of the sitemap is what let a game be listed there while the
 * page itself served `noindex` — a contradiction a search engine resolves by
 * trusting neither signal.
 *
 * So every consumer of "is this game real" — the sitemap, the robots meta, the
 * share card, the hub's ItemList — goes through this one predicate. Adding a
 * game to the config without registering its tag now yields a page and a sitemap
 * that agree it is coming soon, rather than two answers.
 *
 * `Object.hasOwn` and not `GAME_TAGS[slug]`: a slug of `constructor` or
 * `toString` would otherwise return an inherited function, which is truthy.
 */
export function isPlayableGame(game: GameFlags): boolean {
  return Boolean(game.enabled && game.interactive && Object.hasOwn(GAME_TAGS, game.slug))
}

/** The custom-element tag to render, or undefined for a "coming soon" page. */
export function gameTag(game: GameFlags): string | undefined {
  return isPlayableGame(game) ? GAME_TAGS[game.slug] : undefined
}
