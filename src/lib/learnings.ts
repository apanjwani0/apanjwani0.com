/**
 * The one predicate that decides whether a learning is a real page.
 *
 * Same rule the games and tools sections already follow (see AGENTS.md,
 * "Indexing"): every consumer — the route's `noindex`, the sitemap, the hub's
 * ItemList, RelatedLinks, and share-card eligibility — reads THIS function and
 * not its own approximation. Three signals that disagree are worse than any one
 * of them missing, because a crawler resolves the contradiction by trusting none
 * of them.
 */

import { embedTag } from './embeds'
import type { Learning } from '../config/learnings'

/** The only fields the predicate reads, so callers can state this shape instead
 *  of hand-rolling a second, looser one. */
export type LearningFlags = Pick<Learning, 'published' | 'content'>

/**
 * Published means: flagged published AND actually has a body.
 *
 * The second condition is the one the flag cannot express. An entry saved from
 * /admin with `published` ticked but the content box still empty would otherwise
 * be listed in the sitemap and carry a share card while the page itself renders
 * nothing — the same contradiction that let a never-wired game into the sitemap
 * before `isPlayableGame()` existed.
 */
export function isPublishedLearning(learning: LearningFlags): boolean {
  return Boolean(learning.published && learning.content.trim())
}

/**
 * The custom-element tag to mount inline, or undefined for a prose-only article.
 *
 * Reads EMBED_TAGS and NOT GAME_TAGS: most of what these articles embed is no
 * longer a game — the generative engines moved to Driftfield, and Game of Life
 * has no page of its own at all any more. Pointing this at the games list would
 * empty every embed on the site the moment those entries left the games config.
 *
 * An unrecognised embed degrades to prose rather than throwing — a typo in
 * /admin should cost the simulation, not the article.
 */
export function learningEmbedTag(learning: { embed?: string }): string | undefined {
  return embedTag(learning.embed)
}

/**
 * The published articles whose simulation is THIS component — the reverse of
 * `embed`, read by the game, tool and Driftfield pages to link the article that
 * tells their story.
 *
 * Derived rather than stored. Driftfield modes used to carry a `learning` slug
 * of their own, which is a second copy of a fact the article already states, and
 * it dangled the moment an article was deleted: six modes shipped links to
 * `/learnings/*` pages that 404'd, on the hub and on every mode page. A reverse
 * lookup cannot dangle — an article that is gone has no entry to find, and one
 * that is unpublished fails the predicate here rather than in each caller.
 */
export function learningsAboutEmbed(embed: string, all: Learning[]): Learning[] {
  return all.filter(l => l.embed === embed && isPublishedLearning(l))
}
