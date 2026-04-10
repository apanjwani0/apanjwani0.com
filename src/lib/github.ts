/**
 * GitHub stats cache + fetcher.
 *
 * Uses a two-layer cache: in-memory (5 min TTL) → disk → GitHub API.
 * Disk cache at data/github-stats.json keeps stats across process restarts.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface GitHubStats {
  stars: number
  forks: number
}

type StatsCache = Record<string, GitHubStats>

const CACHE_PATH = join(process.cwd(), 'data', 'github-stats.json')
const TTL_MS = 5 * 60 * 1000 // 5 minutes

// In-memory cache to avoid disk + API hits on every request
let memCache: StatsCache = {}
let memCacheTime = 0

async function readCache(): Promise<StatsCache> {
  try {
    const raw = await readFile(CACHE_PATH, 'utf-8')
    return JSON.parse(raw) as StatsCache
  } catch {
    return {}
  }
}

async function writeCache(cache: StatsCache): Promise<void> {
  try {
    await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8')
  } catch {
    // Non-fatal — silently ignore write errors (e.g. read-only filesystem)
  }
}

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url)
    if (u.hostname !== 'github.com') return null
    const parts = u.pathname.replace(/^\//, '').replace(/\/$/, '').split('/')
    if (parts.length < 2 || !parts[0] || !parts[1]) return null
    return { owner: parts[0], repo: parts[1] }
  } catch {
    return null
  }
}

async function fetchStats(owner: string, repo: string): Promise<GitHubStats | null> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'portfolio-apanjwani0',
    }
    const token = process.env.GITHUB_TOKEN
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
    if (!res.ok) return null

    const data = (await res.json()) as { stargazers_count: number; forks_count: number }
    return { stars: data.stargazers_count, forks: data.forks_count }
  } catch {
    return null
  }
}

/**
 * Returns GitHub stats keyed by project URL.
 * Serves from in-memory cache if fresh; otherwise refreshes from API.
 */
export async function getProjectStats(
  projects: { url: string }[]
): Promise<Record<string, GitHubStats>> {
  const now = Date.now()

  // Serve from memory if still fresh
  if (now - memCacheTime < TTL_MS && Object.keys(memCache).length > 0) {
    return buildResult(projects, memCache)
  }

  // Seed from disk, then refresh from API
  const cache = await readCache()
  const updated: StatsCache = { ...cache }
  let dirty = false

  // Parse URLs once, reuse for fetch and result building
  const parsed = projects.map(p => ({ url: p.url, gh: parseGithubUrl(p.url) }))

  await Promise.all(
    parsed.map(async ({ gh }) => {
      if (!gh) return
      const key = `${gh.owner}/${gh.repo}`
      const fresh = await fetchStats(gh.owner, gh.repo)
      if (!fresh) return
      const cached = cache[key]
      if (!cached || cached.stars !== fresh.stars || cached.forks !== fresh.forks) {
        updated[key] = fresh
        dirty = true
      }
    })
  )

  if (dirty) await writeCache(updated)

  memCache = updated
  memCacheTime = now

  return buildResult(projects, updated, parsed)
}

function buildResult(
  projects: { url: string }[],
  cache: StatsCache,
  parsed?: { url: string; gh: ReturnType<typeof parseGithubUrl> }[]
): Record<string, GitHubStats> {
  const entries = parsed ?? projects.map(p => ({ url: p.url, gh: parseGithubUrl(p.url) }))
  const result: Record<string, GitHubStats> = {}
  for (const { url, gh } of entries) {
    if (!gh) continue
    const stats = cache[`${gh.owner}/${gh.repo}`]
    if (stats) result[url] = stats
  }
  return result
}
