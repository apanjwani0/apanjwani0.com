/**
 * Config accessors — runtime-aware, works across deployment targets:
 *
 *   Cloudflare Workers  → reads from KV binding `SITE_CONFIG`
 *   Node.js / Docker    → reads from `data/{key}.json` on the filesystem
 *   Fallback (either)   → bundled TypeScript config in `src/config/`
 *
 * Usage in any Astro page, layout, or component:
 *   const site = await getSite(Astro.locals)
 *
 * Keys: 'site' | 'projects' | 'experience' | 'blogs' | 'games' | 'tools' | 'learnings'
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { site as staticSite, type NavItem, type Site } from '../config/site'
import { projects as staticProjects } from '../config/projects'
import { experience as staticExperience } from '../config/experience'
import { posts as staticPosts } from '../config/blogs'
import { games as staticGames } from '../config/games'
import { tools as staticTools } from '../config/tools'
import { learnings as staticLearnings } from '../config/learnings'
import { validateConfigData } from './config-schema'

import type { Company } from '../config/experience'
import type { Project } from '../config/projects'
import type { Post } from '../config/blogs'
import type { Game } from '../config/games'
import type { Tool } from '../config/tools'
import type { Learning } from '../config/learnings'

type KVStore = { get(key: string, type: 'json'): Promise<unknown> }

function getKV(locals: unknown): KVStore | null {
  return (locals as any)?.runtime?.env?.SITE_CONFIG ?? null
}

function merge<T>(fallback: T, override: unknown): T {
  if (
    typeof fallback === 'object' && fallback !== null && !Array.isArray(fallback) &&
    typeof override === 'object' && override !== null && !Array.isArray(override)
  ) {
    return { ...fallback, ...(override as T) }
  }
  return (override as T) ?? fallback
}

async function fromKV<T>(store: KVStore, key: string, fallback: T): Promise<T> {
  try {
    const data = await store.get(key, 'json')
    return merge(fallback, data)
  } catch {
    return fallback
  }
}

async function fromFile<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(join(process.cwd(), 'data', `${key}.json`), 'utf-8')
    return merge(fallback, JSON.parse(raw))
  } catch {
    return fallback
  }
}

async function getConfig<T>(locals: unknown, key: string, fallback: T): Promise<T> {
  const kv = getKV(locals)
  const config = kv
    ? await fromKV(kv, key, fallback)       // Cloudflare Workers
    : await fromFile(key, fallback)         // Node.js / Docker
  return validateConfigData(key, config) ? config : fallback
}

export type { NavItem } from '../config/site'

export type { Site } from '../config/site'

/**
 * The site's section links as a flat list — dropdown children hoisted to top
 * level.
 *
 * Lives here, next to the type, because both the header and the footer render
 * "the site's sections" and they must agree: two copies of this expression meant
 * a future discriminator on NavItem (a `footerOnly` flag, a third level of
 * nesting) could be honoured in one component and forgotten in the other, and
 * both would still render successfully — so the mismatch would surface as a
 * header and footer listing different sections on the same page.
 */
/**
 * The one predicate that decides whether the blogs section is public.
 *
 * `sections.blogs` already existed and nothing read it. Now everything does:
 * the nav and footer (through `navLinks` below), the sitemap, the hub's
 * ItemList, and the `noindex` on both blog routes. Same rule as games, tools
 * and reads — a section that is delisted in one signal and advertised in
 * another is worse than either alone, because a crawler resolves the
 * contradiction by trusting neither.
 *
 * Hidden, not deleted: the routes still resolve, so links that already exist in
 * the wild keep working while the pages drop out of search. Flip the flag back
 * to `true` to restore the section; make the two routes 404 to retire it for
 * good.
 */
export function isBlogsPublic(site: Site): boolean {
  return site.sections.blogs === true
}

/** The same rule for `/projects`, hidden by the owner on 2026-09-30: the page
 *  still answers when typed, with a noindex, but nothing links to it. */
export function isProjectsPublic(site: Site): boolean {
  return site.sections.projects === true
}

// Every section a flag can hide, by its path, with the predicate that decides.
const GATED_SECTIONS: ReadonlyArray<readonly [RegExp, (site: Site) => boolean]> = [
  [/^\/blogs(\/|$)/, isBlogsPublic],
  [/^\/projects(\/|$)/, isProjectsPublic],
]

export function navLinks(site: Site): NavItem[] {
  return site.nav
    .flatMap(item => item.children ?? [item])
    .filter(item => GATED_SECTIONS.every(([path, isPublic]) => isPublic(site) || !path.test(item.href)))
}

export async function getSite(locals: unknown): Promise<Site> {
  return getConfig(locals, 'site', staticSite)
}

export async function getProjects(locals: unknown): Promise<Project[]> {
  return getConfig(locals, 'projects', staticProjects as Project[])
}

export async function getExperience(locals: unknown): Promise<Company[]> {
  return getConfig(locals, 'experience', staticExperience as Company[])
}

export async function getPosts(locals: unknown): Promise<Post[]> {
  return getConfig(locals, 'blogs', staticPosts as Post[])
}

export async function getGames(locals: unknown): Promise<Game[]> {
  return (await getConfig(locals, 'games', staticGames as Game[]))
    .filter(game => game.slug !== 'wallpaper-forge')
}

export async function getTools(locals: unknown): Promise<Tool[]> {
  return getConfig(locals, 'tools', staticTools as Tool[])
}

export async function getLearnings(locals: unknown): Promise<Learning[]> {
  return getConfig(locals, 'learnings', staticLearnings as Learning[])
}
