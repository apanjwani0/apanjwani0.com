/**
 * Hand ranges — the thing a real trainer reasons about, and the thing the
 * calculator version of this tool could not express.
 *
 * A poker decision is almost never "my hand against their hand", because you do
 * not know their hand. It is your hand against every hand they could hold given
 * how they have played. That set is a **range**, and ==every serious poker
 * concept — GTO, bluff frequency, board coverage — is defined over ranges rather
 * than over hands==. A tool that only compares two known hands is teaching a
 * situation that never occurs at a table.
 *
 * Notation is the standard shorthand, parsed rather than hardcoded so a user can
 * type their own:
 *
 *   AA        a specific pair              (6 combos)
 *   AKs       suited                       (4 combos)
 *   AKo       offsuit                      (12 combos)
 *   77+       that pair and every one above
 *   ATs+      A-T suited through A-K suited (kicker climbs, ace fixed)
 *   A5s-A2s   an explicit kicker span
 *
 * The combo counts are the part people get wrong when eyeballing a range: a pair
 * is 6, a suited hand 4, an offsuit hand 12. So "AK" is 16 combos against "AA"'s
 * 6 — you are dealt AK nearly three times as often as aces, which is why "he
 * could have aces" is usually the wrong worry.
 */

import { classCombos } from './equity'
import type { Card } from './types'

const RANK_CHARS = '23456789TJQKA'

/** 'A' → 14, '2' → 2. -1 when the character is not a rank. */
function rankValue(char: string): number {
  const index = RANK_CHARS.indexOf(char.toUpperCase())
  return index < 0 ? -1 : index + 2
}

function classOf(high: number, low: number, suffix: '' | 's' | 'o'): string {
  return `${RANK_CHARS[high - 2]}${RANK_CHARS[low - 2]}${suffix}`
}

/**
 * Expand one shorthand token into canonical hand classes.
 *
 * Returns an empty array for anything unrecognised rather than throwing: this
 * parses user input, and one typo in a long range should cost that token, not
 * the whole range. The caller reports which tokens were dropped.
 */
export function expandToken(token: string): string[] {
  const raw = token.trim()
  if (!raw) return []

  // An explicit span: A5s-A2s. Both ends must share their high card and suffix,
  // otherwise the span has no single dimension to walk along.
  const span = /^([2-9TJQKA])([2-9TJQKA])([so]?)-([2-9TJQKA])([2-9TJQKA])([so]?)$/i.exec(raw)
  if (span) {
    const [, h1, l1, s1, h2, l2, s2] = span
    if (h1.toUpperCase() !== h2.toUpperCase() || s1.toLowerCase() !== s2.toLowerCase()) return []
    const high = rankValue(h1)
    const suffix = s1.toLowerCase() as '' | 's' | 'o'
    const from = Math.min(rankValue(l1), rankValue(l2))
    const to = Math.max(rankValue(l1), rankValue(l2))
    if (high < 2 || from < 2) return []
    const out: string[] = []
    for (let low = from; low <= to; low++) {
      if (low === high) continue
      out.push(classOf(high, low, suffix))
    }
    return out
  }

  const plus = /^([2-9TJQKA])([2-9TJQKA])([so]?)\+$/i.exec(raw)
  if (plus) {
    const [, h, l, s] = plus
    const high = rankValue(h)
    const low = rankValue(l)
    const suffix = s.toLowerCase() as '' | 's' | 'o'
    if (high < 2 || low < 2) return []
    // A pair token climbs the pairs (77+ = 77,88,…,AA). A non-pair token climbs
    // the KICKER with the high card fixed (ATs+ = ATs,AJs,AQs,AKs) — it does NOT
    // climb the high card, which is the reading people expect and the one the
    // shorthand actually means.
    const out: string[] = []
    if (high === low) {
      for (let r = high; r <= 14; r++) out.push(classOf(r, r, ''))
    } else {
      for (let k = low; k < high; k++) out.push(classOf(high, k, suffix))
    }
    return out
  }

  const single = /^([2-9TJQKA])([2-9TJQKA])([so]?)$/i.exec(raw)
  if (single) {
    const [, h, l, s] = single
    const high = rankValue(h)
    const low = rankValue(l)
    if (high < 2 || low < 2) return []
    if (high === low) return [classOf(high, low, '')]
    const [hi, lo] = high > low ? [high, low] : [low, high]
    // A non-pair with no suffix means BOTH: "AK" is AKs and AKo, 16 combos.
    const suffix = s.toLowerCase() as '' | 's' | 'o'
    return suffix ? [classOf(hi, lo, suffix)] : [classOf(hi, lo, 's'), classOf(hi, lo, 'o')]
  }

  return []
}

export interface ParsedRange {
  /** Canonical hand classes, deduplicated. */
  classes: string[]
  /** Tokens that could not be parsed, so the UI can say which. */
  dropped: string[]
}

/** Parse a comma/space separated range string. */
export function parseRange(text: string): ParsedRange {
  const classes = new Set<string>()
  const dropped: string[] = []
  for (const token of text.split(/[,\s]+/).filter(Boolean)) {
    const expanded = expandToken(token)
    if (!expanded.length) dropped.push(token)
    for (const cls of expanded) classes.add(cls)
  }
  return { classes: [...classes], dropped }
}

/**
 * Every specific two-card combination in a range, minus anything blocked.
 *
 * Card removal is not a detail. If you hold an ace, your opponent holds one of
 * the three remaining aces rather than one of four, so their AA combos drop from
 * 6 to 3 — ==holding one blocker halves the chance they have that pair==. A
 * range expanded without removing the known cards is wrong in exactly the spot
 * where the reasoning matters most.
 */
export function rangeCombos(classes: string[], blocked: Card[] = []): Card[][] {
  const dead = new Set(blocked.map(c => `${c.r}${c.s}`))
  const out: Card[][] = []
  for (const cls of classes) {
    for (const combo of classCombos(cls)) {
      if (combo.some(c => dead.has(`${c.r}${c.s}`))) continue
      out.push(combo)
    }
  }
  return out
}

/**
 * Common 6-max opening ranges.
 *
 * These are CONVENTIONAL ranges — the ones taught in most training material and
 * close to what solvers produce at 100bb with no rake. They are deliberately not
 * labelled "the GTO range", because there is no such object: a solved range
 * depends on stack depth, rake, ante and what the rest of the table does, and
 * quoting one number as if it were universal is the most common way poker
 * material misleads. The UI says so where it uses them.
 */
export interface NamedRange {
  id: string
  label: string
  /** Roughly what share of all 1326 starting combos this is. */
  note: string
  text: string
}

export const PRESET_RANGES: NamedRange[] = [
  {
    id: 'utg',
    label: 'Early position open',
    note: 'Tight — about 15% of hands. First to act with five players left behind you.',
    text: '55+, A9s+, KTs+, QTs+, JTs, T9s, 98s, AJo+, KQo',
  },
  {
    id: 'co',
    label: 'Cutoff open',
    note: 'About 27%. Two players left behind you, so you can afford more hands.',
    text: '22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+, ATo+, KJo+, QJo',
  },
  {
    id: 'btn',
    label: 'Button open',
    note: 'About 45%. Last to act on every later street — position is worth this much.',
    text: '22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 53s+, A2o+, K8o+, Q9o+, J9o+, T9o, 98o',
  },
  {
    id: 'bb-defend',
    label: 'Big blind defending',
    note: 'Wide — you are already partly invested, so you need less to continue.',
    text: '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 95s+, 84s+, 74s+, 63s+, 53s+, A2o+, K7o+, Q8o+, J8o+, T8o+, 97o+, 87o',
  },
  {
    id: 'three-bet',
    label: 'Three-bet value + bluffs',
    note: 'About 8%. The strong hands, plus suited aces as blockers.',
    text: 'TT+, AQs+, AKo, A5s-A2s, KQs',
  },
  {
    id: 'premium',
    label: 'Premium only',
    note: 'About 3%. What a very tight player shows up with.',
    text: 'JJ+, AKs, AKo',
  },
]
