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
export type LearningFlags = Pick<Learning, 'published' | 'content'> & { slug?: string }

/**
 * Learning slugs that were live on the production site and have since been
 * withdrawn, each with where it now permanently redirects.
 *
 * An article deleted from config 404s, and a 404 costs every link already out
 * there — a share, a bookmark, a search result — its reader. So a slug that was
 * ever served from `main` gets an entry here when it goes, and the article route
 * answers it with a 301. Slugs that never left `develop` never had a reader and
 * need none.
 *
 * The destination is the hub unless a replacement answers the SAME question.
 * `the-test-that-shared-the-bug` was about a smoke test that shared its formula
 * with the code it checked, and what replaced it on this site is about
 * diagrams — pointing the old link there would hand its reader a different
 * article wearing the old one's address.
 *
 * A redirect is not a page, so `isPublishedLearning` is false for every slug
 * here: the sitemap, the hub, the share cards and the related links all read
 * that one predicate, and none of them can list a retired slug even if an entry
 * under it is saved again from /admin. `security:smoke` refuses that entry
 * outright, drives the real sitemap route to prove the rest, and pins the
 * article route to answering the redirect before anything else.
 */
export const RETIRED_LEARNINGS: Readonly<Record<string, string>> = Object.freeze({
  'the-test-that-shared-the-bug': '/learnings',
})

/** Where a retired slug now redirects, or null for a slug that is not retired. */
export function retiredLearningTarget(slug: string | undefined): string | null {
  if (!slug || !Object.hasOwn(RETIRED_LEARNINGS, slug)) return null
  return RETIRED_LEARNINGS[slug]
}

/**
 * Published means: flagged published AND actually has a body, under a slug
 * that has not been retired.
 *
 * The second condition is the one the flag cannot express. An entry saved from
 * /admin with `published` ticked but the content box still empty would otherwise
 * be listed in the sitemap and carry a share card while the page itself renders
 * nothing — the same contradiction that let a never-wired game into the sitemap
 * before `isPlayableGame()` existed. The third is the same contradiction again:
 * a retired slug's route answers 301, so nothing may list it as a page.
 */
export function isPublishedLearning(learning: LearningFlags): boolean {
  return Boolean(learning.published && learning.content.trim()) && !retiredLearningTarget(learning.slug)
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

/**
 * Minutes to read an article, derived from its own content.
 *
 * Derived and never stored, for the reason `learningsAboutEmbed` is derived: a
 * number typed into config is a second copy of a fact the content already
 * states, and it goes stale on the next edit with nothing to catch it.
 *
 * The markers are stripped before counting, so the figure syntax and callout
 * fences do not read as words. Figures are then added back at a flat 8s each —
 * an article in the current house format is mostly figures, and counting only
 * the prose between them reports "1 min" for a page that takes four. 200 wpm is
 * the usual estimate for screen reading of ordinary prose.
 *
 * Rounded up, floor of 1: "0 min read" is not a thing, and rounding 90 seconds
 * down to one minute is the friendlier error.
 */
export function readingTime(content: string): number {
  const figures = [...content.matchAll(/^[ \t]*\{\{embed(?::[a-z0-9-]+)?\}\}[ \t]*$/gm)].length
  const words = content
    .replace(/^[ \t]*\{\{embed(?::[a-z0-9-]+)?\}\}[ \t]*$/gm, ' ')
    .replace(/^:::.*$/gm, ' ')
    .replace(/[#>=*`|_-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length
  return Math.max(1, Math.ceil(words / 200 + (figures * 8) / 60))
}
