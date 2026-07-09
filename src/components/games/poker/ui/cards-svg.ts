/**
 * cards-svg.ts — the card catalogue. ONE parametric SVG source for every card.
 *
 * The whole 52-card deck (plus the back) is generated from `cardSvg(card)`; the
 * game never ships raster card images — it renders these vectors and sizes them
 * via the container, so a card is crisp at any scale (see the catalogue artifact /
 * the reference sheet for the full deck + a scaling proof).
 *
 * Suit pips are hand-authored vector paths in a 0..100 box (NO font dependency, so
 * they render identically everywhere). Rank glyphs use the UI sans — the one font
 * dependency; convert them to paths too if pixel-identical ranks ever matter.
 * ponytail: font-for-ranks is the known ceiling; upgrade to outlined paths only if
 * a platform renders the digits noticeably differently.
 *
 * viewBox is `0 0 60 84` (standard 2.5×3.5 card ratio). Size with CSS on the
 * wrapper — e.g. `.pk-card{ width: 64px }` and `.pk-card svg{ width:100%;height:100% }`.
 */
import type { Card, Suit } from '../engine/types'
import { RANK_LABEL, SUIT_SYMBOL } from '../engine/types'

/** Which suits paint red; the rest paint near-black. */
const RED: Record<Suit, boolean> = { c: false, s: false, d: true, h: true }

export const RED_INK = '#f0473b'
export const DARK_INK = '#16161a'
const CARD_FACE = '#f7f7f5'
const BACK_BLUE = '#63a6ef'
/** The one text face used inside SVG assets — import it, never re-declare. */
export const ASSET_FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif"

/** Suit pips, normalized to a 0..100 box; the parent `<g>` sets the fill. */
const SUIT_FRAG: Record<Suit, string> = {
  s: '<path d="M50 13 C50 13 87 41 87 65 C87 78 77 86 67 86 C59 86 53 80 50 74 C47 80 41 86 33 86 C23 86 13 78 13 65 C13 41 50 13 50 13 Z"/><path d="M44 73 C44 82 40 90 33 95 L67 95 C60 90 56 82 56 73 Z"/>',
  h: '<path d="M50 88 C50 88 13 61 13 35 C13 22 23 14 33 14 C42 14 48 20 50 26 C52 20 58 14 67 14 C77 14 87 22 87 35 C87 61 50 88 50 88 Z"/>',
  d: '<path d="M50 7 L87 50 L50 93 L13 50 Z"/>',
  c: '<circle cx="50" cy="30" r="19"/><circle cx="27" cy="58" r="19"/><circle cx="73" cy="58" r="19"/><path d="M44 56 C44 73 40 88 33 96 L67 96 C60 88 56 73 56 56 Z"/>',
}

/**
 * Inline SVG markup for one card face (viewBox 0 0 60 84). Resolution-independent —
 * size it with the container, never by regenerating.
 */
export function cardSvg(card: Card): string {
  const label = RANK_LABEL[card.r]
  const color = RED[card.s] ? RED_INK : DARK_INK
  const rankSize = label.length > 1 ? 25 : 31 // "10" is two glyphs — nudge it down to fit
  return `<svg viewBox="0 0 60 84" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}${SUIT_SYMBOL[card.s]}">`
    + `<rect x="0" y="0" width="60" height="84" rx="10" fill="${CARD_FACE}"/>`
    + `<text x="8" y="30" font-family="${ASSET_FONT}" font-size="${rankSize}" font-weight="800" fill="${color}">${label}</text>`
    + `<svg x="8" y="38" width="19" height="19" viewBox="0 0 100 100"><g fill="${color}">${SUIT_FRAG[card.s]}</g></svg>`
    + '</svg>'
}

/**
 * A single suit pip as a standalone asset (equity box, hand-rank labels, hand
 * log, chip faces). viewBox 0 0 100 100. Defaults to the suit's own colour.
 */
export function suitSvg(suit: Suit, color?: string): string {
  const fill = color ?? (RED[suit] ? RED_INK : DARK_INK)
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${SUIT_SYMBOL[suit]}"><g fill="${fill}">${SUIT_FRAG[suit]}</g></svg>`
}

/* ─────────────────────────── card backs ──────────────────────────
   Room-selectable face-down designs. Same viewBox (0 0 60 84) as the faces so
   they drop into the same slot and scale identically. Add a back = add a
   `CardBackId` + a case in `cardBackSvg`. */

export type CardBackId = 'classic' | 'crimson' | 'slate' | 'forest' | 'grape' | 'ivory'
export const CARD_BACKS: readonly CardBackId[] = ['classic', 'crimson', 'slate', 'forest', 'grape', 'ivory']

/**
 * Repeating tile patterns. Each takes a UNIQUE id so different backs coexist on
 * one page without their <pattern> defs colliding. Rendering many cards of the
 * SAME back reuses one id harmlessly — `url()` resolves to the first match.
 */
const TILE = {
  dots: (id: string) => `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.5" fill="#fff" opacity="0.5"/></pattern>`,
  hatch: (id: string) => `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8 L8 0" stroke="#fff" stroke-width="1" opacity="0.3"/></pattern>`,
  grid: (id: string) => `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0 V8 M0 8 H8" stroke="#fff" stroke-width="0.7" opacity="0.18"/></pattern>`,
  lattice: (id: string) => `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M4 0 L8 4 L4 8 L0 4 Z" fill="none" stroke="#fff" stroke-width="0.8" opacity="0.32"/></pattern>`,
  plus: (id: string) => `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M4 2 V6 M2 4 H6" stroke="#fff" stroke-width="1" opacity="0.3"/></pattern>`,
}

const TARGET = '<g fill="none" stroke="#fff" stroke-width="2" opacity="0.85"><circle cx="30" cy="42" r="11"/><circle cx="30" cy="42" r="5"/></g>'
const DIAMOND = '<path d="M30 33 L38 42 L30 51 L22 42 Z" fill="none" stroke="#fff" stroke-width="1.5" opacity="0.7"/>'

/** base colour + patterned inset (5px base-colour border frame) + optional centre emblem */
function backShell(base: string, defs: string, innerFill: string, emblem = ''): string {
  return '<svg viewBox="0 0 60 84" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="card back">'
    + `<defs>${defs}</defs>`
    + `<rect x="0" y="0" width="60" height="84" rx="10" fill="${base}"/>`
    + `<rect x="5" y="5" width="50" height="74" rx="7" fill="${innerFill}"/>`
    + emblem + '</svg>'
}

/** light back: ink border + a centred four-suit cluster (matches the floating-white faces) */
function ivoryBack(): string {
  const mini = (x: number, y: number, s: Suit) =>
    `<svg x="${x}" y="${y}" width="12" height="12" viewBox="0 0 100 100"><g fill="${RED[s] ? RED_INK : DARK_INK}">${SUIT_FRAG[s]}</g></svg>`
  return '<svg viewBox="0 0 60 84" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="card back">'
    + '<rect x="0" y="0" width="60" height="84" rx="10" fill="#f2f0ea"/>'
    + `<rect x="5.5" y="5.5" width="49" height="73" rx="7" fill="none" stroke="${DARK_INK}" stroke-width="1" opacity="0.18"/>`
    + mini(17, 30, 's') + mini(31, 30, 'h') + mini(17, 44, 'd') + mini(31, 44, 'c')
    + '</svg>'
}

/** Face-down card back (viewBox 0 0 60 84). Pass a `CardBackId` to pick the design. */
export function cardBackSvg(id: CardBackId = 'classic'): string {
  const p = `pkb-${id}`
  switch (id) {
    case 'crimson': return backShell('#d6473c', TILE.hatch(p), `url(#${p})`, DIAMOND)
    case 'slate': return backShell('#2b2f38', TILE.grid(p), `url(#${p})`, DIAMOND)
    case 'forest': return backShell('#2f9e73', TILE.lattice(p), `url(#${p})`)
    case 'grape': return backShell('#7b6cf0', TILE.plus(p), `url(#${p})`)
    case 'ivory': return ivoryBack()
    case 'classic':
    default: return backShell(BACK_BLUE, TILE.dots(p), `url(#${p})`, TARGET)
  }
}
