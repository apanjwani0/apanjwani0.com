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
 * Keys: 'site' | 'projects' | 'experience' | 'blogs' | 'games'
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { site as staticSite } from '../config/site'
import { projects as staticProjects } from '../config/projects'
import { experience as staticExperience } from '../config/experience'
import { posts as staticPosts } from '../config/blogs'
import { games as staticGames } from '../config/games'

import type { Company } from '../config/experience'
import type { Project } from '../config/projects'
import type { Post } from '../config/blogs'
import type { Game } from '../config/games'

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
  if (kv) return fromKV(kv, key, fallback)       // Cloudflare Workers
  return fromFile(key, fallback)                   // Node.js / Docker
}

/** One nav entry. `children` renders as a dropdown and is flattened by Nav.astro. */
export interface NavItem {
  label: string
  href: string
  children?: NavItem[]
}

/**
 * The site config as callers actually receive it.
 *
 * `staticSite` is declared `as const`, so its `nav` infers as a readonly tuple of
 * readonly literal objects. That is false precision — at runtime the value can come
 * from KV or data/site.json and carry any valid nav, including entries with
 * `children`, which the literal type has no room for. It also broke narrowing in
 * Nav's flatMap badly enough that the call sites fell back to `any`. Widen `nav`
 * once here, at the boundary where the override actually happens.
 */
export type Site = Omit<typeof staticSite, 'nav'> & { nav: NavItem[] }

export async function getSite(locals: unknown): Promise<Site> {
  return getConfig(locals, 'site', staticSite as unknown as Site)
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
    .filter(game => game.slug !== 'poker' && game.slug !== 'wallpaper-forge')
}
