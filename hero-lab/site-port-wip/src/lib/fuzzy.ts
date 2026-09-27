/**
 * Fuzzy matching for the command palette and the 404 page's suggestions.
 *
 * Pure and dependency-free, so the palette can ship it to the browser and the
 * 404 route can run it on the server against the same site index. Both inputs
 * are bounded before any quadratic work: a query and a path are attacker text
 * (anyone can request any URL), and the 404 is the page every scanner hits.
 */

import type { IndexEntry } from './site-index'

export interface FuzzyMatch {
  /** Higher is better. Only comparable between matches of the same query. */
  score: number
  /** Indices into `text` of the matched characters, for highlighting. */
  hits: number[]
}

/** Longest query and text scored at all; past these the match is refused or clipped. */
const QUERY_MAX = 64
const TEXT_MAX = 256

const SCORE_CONSECUTIVE = 1.0
const SCORE_AFTER_SLASH = 0.9
const SCORE_WORD_START = 0.8
const SCORE_CAPITAL = 0.7
const SCORE_AFTER_DOT = 0.6
const GAP_LEADING = -0.005
const GAP_INNER = -0.01
const GAP_TRAILING = -0.005

/** The bonus for matching at text[i], from what precedes it. */
function positionBonus(text: string, i: number): number {
  if (i === 0) return SCORE_AFTER_SLASH
  const prev = text[i - 1]
  if (prev === '/') return SCORE_AFTER_SLASH
  if (prev === '-' || prev === '_' || prev === ' ' || prev === ',' || prev === ':') return SCORE_WORD_START
  if (prev === '.') return SCORE_AFTER_DOT
  const cur = text[i]
  if (prev === prev.toLowerCase() && cur !== cur.toLowerCase()) return SCORE_CAPITAL
  return 0
}

/**
 * Score `query` as a case-insensitive subsequence of `text`, or null when it
 * is not one. The scoring is fzy's: every character's alignment is chosen by
 * dynamic programming, rewarding matches at word starts and runs of
 * consecutive characters, and charging a little for every character skipped —
 * so "jt" ranks "JSON Tidy" above "Adjust".
 */
export function fuzzyScore(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase()
  if (q === '') return { score: 0, hits: [] }
  if (q.length > QUERY_MAX) return null
  const t = text.slice(0, TEXT_MAX)
  const lower = t.toLowerCase()
  const n = q.length
  const m = lower.length
  if (n > m) return null

  // Cheap refusal first: most candidates are not a subsequence at all.
  for (let i = 0, j = 0; i < n; i += 1, j += 1) {
    j = lower.indexOf(q[i], j)
    if (j === -1) return null
  }

  const bonus = Array.from({ length: m }, (_, j) => positionBonus(t, j))
  // D[i][j]: best score with q[i] matched AT t[j]; M[i][j]: best with q[0..i] matched within t[0..j].
  const D: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(-Infinity))
  const M: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(-Infinity))
  for (let i = 0; i < n; i += 1) {
    let prevScore = -Infinity
    const gap = i === n - 1 ? GAP_TRAILING : GAP_INNER
    for (let j = 0; j < m; j += 1) {
      if (q[i] === lower[j]) {
        let score = -Infinity
        if (i === 0) score = j * GAP_LEADING + bonus[j]
        else if (j > 0) score = Math.max(M[i - 1][j - 1] + bonus[j], D[i - 1][j - 1] + SCORE_CONSECUTIVE)
        D[i][j] = score
        prevScore = Math.max(score, prevScore + gap)
        M[i][j] = prevScore
      } else {
        prevScore += gap
        M[i][j] = prevScore
      }
    }
  }

  // Walk back through the tables to recover which characters matched.
  const hits = new Array<number>(n)
  let matchRequired = false
  for (let i = n - 1, j = m - 1; i >= 0; i -= 1) {
    for (; j >= 0; j -= 1) {
      if (D[i][j] !== -Infinity && (matchRequired || D[i][j] === M[i][j])) {
        matchRequired = i > 0 && j > 0 && M[i][j] === D[i - 1][j - 1] + SCORE_CONSECUTIVE
        hits[i] = j
        j -= 1
        break
      }
    }
  }
  return { score: M[n - 1][m - 1], hits }
}

/* ── 404 suggestions ───────────────────────────────────────────────────── */

/** Requests longer than this are not somebody's typo. */
const PATH_MAX = 200

/**
 * A request that looks like a scanner, not a mistyped link: a dotfile or
 * dot-directory anywhere (`/.env`, `/.git/config`), a file extension on the
 * last segment (`/wp-login.php`, `/config.json`), or an absurd length. Nobody
 * who deserves a "did you mean" types those, and answering them with the
 * site's real pages would hand a crawl list to the traffic that generates most
 * of this site's 404s.
 */
export function isScannerPath(path: string): boolean {
  if (path.length > PATH_MAX) return true
  const segments = path.split('/').filter(Boolean)
  if (segments.some(s => s.startsWith('.'))) return true
  const last = segments.at(-1) ?? ''
  return /\.[a-z0-9]{1,8}$/i.test(last)
}

const segmentsOf = (path: string) => path.toLowerCase().split('#')[0].split('/').filter(Boolean)
const squash = (segment: string) => segment.replace(/[^a-z0-9]+/g, '')
const tokensOf = (segments: string[]) => new Set(segments.flatMap(s => s.split(/[^a-z0-9]+/).filter(Boolean)))

/** Levenshtein distance, two rows. Inputs are single path segments, so short. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i]
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** 0 for the same segment up to separators ("jsontidy" = "json-tidy"), up to 1 for nothing in common. */
function segmentCost(a: string, b: string): number {
  const [x, y] = [squash(a), squash(b)]
  const longest = Math.max(x.length, y.length)
  return longest === 0 ? 0 : editDistance(x, y) / longest
}

/** Edit distance between two segment lists, where substituting one segment for another costs how different they are. */
function segmentDistance(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i]
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + segmentCost(a[i - 1], b[j - 1]))
    }
    prev = cur
  }
  return prev[b.length]
}

/** How much of the two token sets is shared (Jaccard). */
function tokenOverlap(a: Set<string>, b: Set<string>): number {
  let shared = 0
  for (const token of a) if (b.has(token)) shared += 1
  const union = a.size + b.size - shared
  return union === 0 ? 0 : shared / union
}

/** A suggestion must score at least this; below it the page is not "what they meant". */
const SUGGEST_FLOOR = 0.5

/**
 * The pages a mistyped path most likely meant, best first: `/tools/jsontidy`
 * and `/tool/regex-lab` find their tools, `/tools/zz` finds the tools hub, and
 * a request with nothing in common with any page gets nothing rather than a
 * random guess. Scanner-shaped paths get `[]` before any scoring runs.
 *
 * The score blends how many segments must change (and by how much) with how
 * many words the two paths share, so a missing prefix (`/json-tidy`) still
 * finds `/tools/json-tidy`. Entries sharing a URL are suggested once.
 */
export function suggestPaths(path: string, entries: readonly IndexEntry[], limit = 3): IndexEntry[] {
  if (typeof path !== 'string' || isScannerPath(path)) return []
  const asked = segmentsOf(path)
  if (asked.length === 0) return []
  const askedTokens = tokensOf(asked)
  const seen = new Set<string>()
  const scored: { entry: IndexEntry; score: number }[] = []
  for (const entry of entries) {
    const target = entry.u.split('#')[0]
    if (seen.has(target)) continue
    seen.add(target)
    const segments = segmentsOf(target)
    const longest = Math.max(asked.length, segments.length)
    const similarity = 1 - Math.min(1, segmentDistance(asked, segments) / longest)
    const score = 0.7 * similarity + 0.3 * tokenOverlap(askedTokens, tokensOf(segments))
    if (score >= SUGGEST_FLOOR) scored.push({ entry, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.entry.u.length - b.entry.u.length || a.entry.u.localeCompare(b.entry.u))
    .slice(0, Math.max(0, limit))
    .map(s => s.entry)
}
