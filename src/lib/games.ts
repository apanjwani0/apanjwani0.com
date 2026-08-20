import type { Game } from '../config/games'
import { EMBED_TAGS } from './embeds'

/**
 * The games that ship a playable component, as a subset of every mountable
 * component (`EMBED_TAGS`, src/lib/embeds.ts).
 *
 * These were one list until the generative engines — flow field, murmuration,
 * reaction-diffusion, falling sand, L-system, starfield — moved out of /games
 * into Driftfield and the learnings articles. They are still mounted, just not
 * as games, so "wired to a component" and "is a game" are now different
 * questions and need different lists. Collapsing them back would either empty
 * every article embed or resurrect six pages that no longer exist.
 *
 * Both lists live in src/lib/ and not in src/config/ because the /admin Vite
 * middleware regenerates the config files wholesale from `generateGames()` — an
 * export added there is silently deleted on the next admin save.
 */
const GAME_SLUGS = ['2048', 'quintle', 'maze-weaver', 'type-trial', 'hue-hunt', 'poker-trainer'] as const

export const GAME_TAGS: Record<string, string> = Object.fromEntries(
  GAME_SLUGS.map(slug => [slug, EMBED_TAGS[slug]]),
)

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
