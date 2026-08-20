/**
 * assets-svg.ts — table-furniture assets: chips, dealer/blind buttons, default
 * avatars, the open seat, the turn-timer pie, and UI glyphs.
 *
 * Same contract as cards-svg.ts: ONE source per asset, pure vector, sized by the
 * container (never regenerate to resize), re-themeable from a few colours. Cards
 * and suit pips live in cards-svg.ts (`cardSvg`, `cardBackSvg`, `suitSvg`).
 */

import { ASSET_FONT as FONT } from './cards-svg'

/* ──────────────────────────── chips ──────────────────────────── */

export const CHIP_VALUES = [1, 5, 25, 100, 500, 1000, 5000] as const
export type ChipValue = (typeof CHIP_VALUES)[number]

const CHIP: Record<ChipValue, { base: string; ink: string; edge: string }> = {
  1: { base: '#e9e9ee', ink: '#33343a', edge: '#b9bcc6' },
  5: { base: '#d6473c', ink: '#ffffff', edge: '#ffffff' },
  25: { base: '#2f9e73', ink: '#ffffff', edge: '#ffffff' },
  100: { base: '#23262c', ink: '#ffffff', edge: '#6b6f78' },
  500: { base: '#7b6cf0', ink: '#ffffff', edge: '#ffffff' },
  1000: { base: '#e0a92e', ink: '#3a2c07', edge: '#ffffff' },
  5000: { base: '#d8722f', ink: '#ffffff', edge: '#ffffff' },
}

const chipLabel = (v: number) => (v >= 1000 ? `${v / 1000}K` : `${v}`)

/** A casino chip disc for a denomination. viewBox 0 0 100 100. */
export function chipSvg(value: ChipValue): string {
  const c = CHIP[value]
  let spots = ''
  for (let i = 0; i < 8; i++) spots += `<rect x="45" y="2" width="10" height="15" rx="3" fill="${c.edge}" transform="rotate(${i * 45} 50 50)"/>`
  return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="chip ' + value + '">'
    + `<circle cx="50" cy="50" r="48" fill="${c.base}"/>`
    + spots
    + `<circle cx="50" cy="50" r="33" fill="${c.base}"/>`
    + `<circle cx="50" cy="50" r="33" fill="none" stroke="${c.edge}" stroke-width="2.5"/>`
    + `<text x="50" y="59" text-anchor="middle" font-family="${FONT}" font-size="26" font-weight="800" fill="${c.ink}">${chipLabel(value)}</text>`
    + '</svg>'
}

/* ─────────────────── dealer / blind buttons ─────────────────── */

export type ButtonKind = 'D' | 'SB' | 'BB'

const BTN: Record<ButtonKind, { base: string; ink: string }> = {
  D: { base: '#f4f4f6', ink: '#1b1b1f' },
  SB: { base: '#3a7bd5', ink: '#ffffff' },
  BB: { base: '#e0a92e', ink: '#3a2c07' },
}

/** Dealer / small-blind / big-blind marker. viewBox 0 0 100 100. */
export function buttonSvg(kind: ButtonKind): string {
  const b = BTN[kind]
  const two = kind.length > 1
  return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + kind + ' button">'
    + `<circle cx="50" cy="50" r="46" fill="${b.base}"/>`
    + '<circle cx="50" cy="50" r="46" fill="none" stroke="rgba(0,0,0,0.14)" stroke-width="2"/>'
    + `<text x="50" y="${two ? 60 : 63}" text-anchor="middle" font-family="${FONT}" font-size="${two ? 34 : 46}" font-weight="800" fill="${b.ink}">${kind}</text>`
    + '</svg>'
}

/* ──────────────────────────── avatars ──────────────────────────── */

const AVATAR_COLORS = ['#f0473b', '#e0a92e', '#2f9e73', '#3a7bd5', '#7b6cf0', '#e05fa0', '#37b0c4', '#d8722f', '#8a6d3b', '#5a6b7a']
export const AVATAR_COUNT = AVATAR_COLORS.length

/** A default seat avatar (a simple face on a coloured disc). `index` picks the colour. viewBox 0 0 100 100. */
export function avatarSvg(index: number): string {
  const bg = AVATAR_COLORS[((index % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT]
  return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="avatar">'
    + `<circle cx="50" cy="50" r="50" fill="${bg}"/>`
    + '<circle cx="38" cy="43" r="6" fill="#ffffff"/><circle cx="62" cy="43" r="6" fill="#ffffff"/>'
    + '<path d="M36 62 Q50 74 64 62" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>'
    + '</svg>'
}

/** The empty/open seat marker — dashed ring + plus. viewBox 0 0 100 100. */
export function openSeatSvg(): string {
  return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="open seat">'
    + '<circle cx="50" cy="50" r="46" fill="none" stroke="#3c3c42" stroke-width="3" stroke-dasharray="6 7"/>'
    + '<path d="M50 34 V66 M34 50 H66" stroke="#6a6a72" stroke-width="5" stroke-linecap="round"/>'
    + '</svg>'
}

/* ──────────────────────── turn timer ──────────────────────── */

/**
 * Turn-timer pie. `pct` = fraction of time REMAINING (1 → full green, 0 → empty).
 * viewBox 0 0 100 100. In-game, re-render as the clock ticks (or drive a CSS
 * conic-gradient from the same fraction).
 */
export function timerPieSvg(pct: number): string {
  const p = Math.max(0, Math.min(1, pct))
  const track = '<circle cx="50" cy="50" r="46" fill="#1c1c1e"/>'
  const open = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="timer">'
  if (p >= 1) return `${open}${track}<circle cx="50" cy="50" r="46" fill="#37d39b"/></svg>`
  if (p <= 0) return `${open}${track}</svg>`
  const a = p * 2 * Math.PI
  const x = (50 + 46 * Math.sin(a)).toFixed(2)
  const y = (50 - 46 * Math.cos(a)).toFixed(2)
  const large = p > 0.5 ? 1 : 0
  return `${open}${track}<path d="M50 50 L50 4 A46 46 0 ${large} 1 ${x} ${y} Z" fill="#37d39b"/></svg>`
}

/* ──────────────────────── UI glyphs ──────────────────────── */

export type IconName = 'back' | 'raise' | 'check' | 'cancel' | 'react'

const ICON: Record<IconName, string> = {
  back: '<path d="M15 5 L8 12 L15 19"/>',
  raise: '<path d="M12 5 V19 M6 11 L12 5 L18 11"/>',
  check: '<path d="M5 12 L10 17 L19 7"/>',
  cancel: '<path d="M6 6 L18 18 M18 6 L6 18"/>',
  react: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><path d="M8.5 14 Q12 16.8 15.5 14"/>',
}

/** A UI glyph. Inherits colour via `currentColor`; stroke-based, viewBox 0 0 24 24. */
export function iconSvg(name: IconName): string {
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${name}">${ICON[name]}</svg>`
}

/* ─────────────────── chip stacks · winner · brand ─────────────────── */

/** A stack of `count` chips of one denomination — a bet or the pot. viewBox 0 0 100 120. */
export function chipStackSvg(value: ChipValue, count = 4): string {
  const c = CHIP[value]
  const n = Math.max(1, Math.min(count, 8))
  let s = ''
  for (let i = 0; i < n; i++) {
    const y = 96 - i * 11
    s += `<ellipse cx="50" cy="${y + 3}" rx="38" ry="13" fill="rgba(0,0,0,0.28)"/>`
      + `<ellipse cx="50" cy="${y}" rx="38" ry="13" fill="${c.base}" stroke="${c.edge}" stroke-width="1.4"/>`
  }
  const topY = 96 - (n - 1) * 11
  return `<svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="chip stack ${value}">${s}`
    + `<text x="50" y="${topY + 5}" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="800" fill="${c.ink}">${chipLabel(value)}</text></svg>`
}

/** Winner crown accent (for the winning seat / result). viewBox 0 0 100 100. */
export function crownSvg(): string {
  return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="winner">'
    + '<path d="M16 74 L12 34 L34 52 L50 24 L66 52 L88 34 L84 74 Z" fill="#f0c33c" stroke="#c9971f" stroke-width="3" stroke-linejoin="round"/>'
    + '<rect x="16" y="73" width="68" height="12" rx="3" fill="#e0a92e"/>'
    + '<circle cx="50" cy="44" r="4" fill="#e0503f"/><circle cx="26" cy="56" r="3" fill="#e0503f"/><circle cx="74" cy="56" r="3" fill="#e0503f"/>'
    + '</svg>'
}

/** "Poker Together" wordmark (light-on-dark). viewBox 0 0 260 44. */
export function wordmarkSvg(): string {
  return '<svg viewBox="0 0 260 44" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Poker Together">'
    + `<text x="0" y="30" font-family="${FONT}" font-size="30" font-weight="800" fill="#f4f4f5">Poker</text>`
    + '<path d="M105 30 C105 30 96 23 96 15 C96 10 99 7 102 7 C104 7 105 9 105 11 C105 9 106 7 108 7 C111 7 114 10 114 15 C114 23 105 30 105 30 Z" fill="#f0473b"/>'
    + `<text x="122" y="30" font-family="${FONT}" font-size="30" font-weight="800" fill="#f4f4f5">Together</text>`
    + '</svg>'
}

/** Reaction emoji — system glyphs (universal, no custom asset). Kept here so the set lives in one place. */
export const REACTIONS = ['👍', '😂', '😮', '🔥', '👏', '😡'] as const
