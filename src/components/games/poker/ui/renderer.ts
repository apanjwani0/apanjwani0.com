/**
 * Poker Together — canvas renderer.
 *
 * Dependency-free HTML5 canvas renderer for the poker table. Pure config in
 * (see `computeLayout`), pure repaint out (see `createRenderer`) — no
 * internal animation loop, no engine imports, no DOM beyond the one canvas
 * element handed in.
 *
 * All colours/fonts are read from the site's theme tokens (theme.css) via
 * getComputedStyle at construct time and again on every `resize()`, so the
 * table re-themes for free with the rest of the site (light/dark). Nothing
 * here hardcodes a hex value.
 *
 * See ../engine/types.ts for the `TableView` / `SeatView` / `LayoutConfig` /
 * `Renderer` contract this module implements.
 */

import {
  RANK_LABEL,
  SUIT_COLOR,
  SUIT_SYMBOL,
  type Card,
  type LayoutConfig,
  type Renderer,
  type SeatView,
  type TableView,
} from '../engine/types'

/* ─────────────────────────────  layout  ────────────────────────────── */

/**
 * Seat anchors as fractions of the canvas (0..1). Index 0 is always the
 * hero, anchored bottom-center. The remaining seats are distributed in seat
 * order (i.e. clockwise around the table from the hero's left).
 *
 * Desktop: a wide ellipse ("rail") — hero at the bottom, others spread
 * evenly around the top and sides. Cards render small-ish since there's
 * plenty of horizontal room for up to 10 seats.
 *
 * Mobile: a tall, compact arrangement — hero at the bottom, opponents
 * stacked in a shallow arc near the top so everything stays inside a narrow
 * viewport. cardScale is larger so ranks/suits stay legible on small screens.
 */
export function computeLayout(mode: 'desktop' | 'mobile', seatCount: number): LayoutConfig {
  const n = Math.max(1, Math.floor(seatCount))
  const seatPositions: { x: number; y: number }[] = [{ x: 0.5, y: mode === 'desktop' ? 0.86 : 0.9 }]

  const others = n - 1
  if (mode === 'desktop') {
    // Ellipse centered on the table, hero sits at the bottom pole (angle = +90°).
    // Distribute the other (n-1) seats evenly over the remaining arc, walking
    // counter-clockwise from just past the hero's right shoulder, around the
    // top, back to just before the hero's left shoulder.
    const cx = 0.5
    const cy = 0.46
    const rx = 0.42
    const ry = 0.36
    const startAngle = Math.PI / 2 + (2 * Math.PI) / (others + 1 || 1)
    for (let i = 0; i < others; i++) {
      const t = others === 0 ? 0 : i / others
      const angle = startAngle + t * (2 * Math.PI - (2 * Math.PI) / (others + 1))
      seatPositions.push({
        x: cx + rx * Math.cos(angle),
        y: cy + ry * Math.sin(angle),
      })
    }
    return { mode, seatPositions, cardScale: 1 }
  }

  // Mobile: a tall/portrait table. Opponents are packed into a compact top
  // zone in balanced rows of at most three, so nameplates never run off the
  // sides on a narrow phone. The board (see drawBoard) drops to mid-table on
  // mobile, keeping clear air between the last opponent row and the felt.
  const maxPerRow = 3
  const rows = Math.max(1, Math.ceil(others / maxPerRow))
  const perRow = Math.ceil(others / rows)
  const topBand = 0.17
  const botBand = 0.4
  const spreadX = 0.32
  for (let i = 0; i < others; i++) {
    const row = Math.floor(i / perRow)
    const col = i % perRow
    const rowCount = Math.min(perRow, others - row * perRow)
    const t = rowCount === 1 ? 0.5 : col / (rowCount - 1)
    const x = Math.min(0.84, Math.max(0.16, 0.5 - spreadX + t * (spreadX * 2)))
    const y = rows === 1 ? topBand : topBand + (row / (rows - 1)) * (botBand - topBand)
    seatPositions.push({ x, y })
  }
  return { mode, seatPositions, cardScale: 1.15 }
}

/* ─────────────────────────────  theme  ─────────────────────────────── */

interface Theme {
  bg: string
  surface: string
  border: string
  text: string
  muted: string
  accent: string
  error: string
  fontSerif: string
  fontMono: string
}

function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => {
    const val = cs.getPropertyValue(name).trim()
    return val || fallback
  }
  return {
    bg: v('--color-bg', '#ffffff'),
    surface: v('--color-surface', '#f6f6f6'),
    border: v('--color-border', '#e8e8e8'),
    text: v('--color-text', '#111111'),
    muted: v('--color-muted', '#666666'),
    accent: v('--color-accent', '#6a5bd0'),
    error: v('--color-error', '#c0392b'),
    fontSerif: v('--font-serif', 'Georgia, serif'),
    fontMono: v('--font-mono', 'ui-monospace, monospace'),
  }
}

/* ─────────────────────────────  helpers  ────────────────────────────── */

function fmtChips(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** Trim `text` with an ellipsis so it fits in `maxWidth` at the current font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1)
  return s + '…'
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/* ─────────────────────────────  renderer  ───────────────────────────── */

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    // Defensive no-op renderer if 2D context is unavailable.
    return { draw() {}, resize() {}, destroy() {} }
  }

  let theme = readTheme()
  let cssW = 0
  let cssH = 0

  function dpr() {
    return Math.min(window.devicePixelRatio || 1, 2)
  }

  function resize() {
    theme = readTheme()
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w <= 0 || h <= 0) {
      cssW = 0
      cssH = 0
      return
    }
    const ratio = dpr()
    cssW = w
    cssH = h
    const bw = Math.round(w * ratio)
    const bh = Math.round(h * ratio)
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw
      canvas.height = bh
    }
  }

  /** Draw a single playing card, face up, at (x,y) = top-left corner. */
  function drawCard(x: number, y: number, w: number, h: number, card: Card) {
    const r = w * 0.12
    roundRectPath(ctx!, x, y, w, h, r)
    ctx!.fillStyle = theme.bg
    ctx!.fill()
    ctx!.lineWidth = Math.max(1, w * 0.035)
    ctx!.strokeStyle = theme.border
    ctx!.stroke()

    const color = SUIT_COLOR[card.s] === 'red' ? theme.error : theme.text
    ctx!.fillStyle = color
    ctx!.textBaseline = 'top'
    ctx!.textAlign = 'left'
    const rankSize = Math.max(9, h * 0.32)
    ctx!.font = `700 ${rankSize}px ${theme.fontMono}`
    ctx!.fillText(RANK_LABEL[card.r] ?? String(card.r), x + w * 0.1, y + h * 0.08)

    const suitSize = Math.max(11, h * 0.4)
    ctx!.font = `${suitSize}px ${theme.fontSerif}`
    ctx!.textAlign = 'center'
    ctx!.textBaseline = 'middle'
    ctx!.fillText(SUIT_SYMBOL[card.s] ?? '', x + w / 2, y + h * 0.62)
  }

  /** Draw a face-down card back, an accent-tinted pattern inside a rounded rect. */
  function drawCardBack(x: number, y: number, w: number, h: number) {
    const r = w * 0.12
    roundRectPath(ctx!, x, y, w, h, r)
    ctx!.fillStyle = theme.surface
    ctx!.fill()
    ctx!.lineWidth = Math.max(1, w * 0.035)
    ctx!.strokeStyle = theme.border
    ctx!.stroke()

    ctx!.save()
    roundRectPath(ctx!, x + w * 0.1, y + h * 0.08, w * 0.8, h * 0.84, r * 0.6)
    ctx!.clip()
    ctx!.strokeStyle = theme.accent
    ctx!.globalAlpha = 0.55
    ctx!.lineWidth = Math.max(1, w * 0.06)
    const step = Math.max(4, w * 0.22)
    for (let d = -h; d < w + h; d += step) {
      ctx!.beginPath()
      ctx!.moveTo(x + d, y + h)
      ctx!.lineTo(x + d + h, y)
      ctx!.stroke()
    }
    ctx!.restore()

    roundRectPath(ctx!, x + w * 0.1, y + h * 0.08, w * 0.8, h * 0.84, r * 0.6)
    ctx!.strokeStyle = theme.accent
    ctx!.globalAlpha = 0.9
    ctx!.lineWidth = Math.max(1, w * 0.025)
    ctx!.stroke()
    ctx!.globalAlpha = 1
  }

  function drawEmptyCardSlot(x: number, y: number, w: number, h: number) {
    const r = w * 0.12
    roundRectPath(ctx!, x, y, w, h, r)
    ctx!.strokeStyle = theme.border
    ctx!.lineWidth = Math.max(1, w * 0.03)
    ctx!.setLineDash([w * 0.08, w * 0.08])
    ctx!.stroke()
    ctx!.setLineDash([])
  }

  function drawFelt() {
    const w = cssW
    const h = cssH
    const cx = w / 2
    const cy = h * 0.46
    const rx = w * 0.47
    const ry = h * 0.4

    ctx!.save()
    ctx!.beginPath()
    ctx!.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx!.fillStyle = theme.surface
    ctx!.fill()
    ctx!.lineWidth = Math.max(2, w * 0.006)
    ctx!.strokeStyle = theme.border
    ctx!.stroke()
    ctx!.restore()
  }

  function drawBoard(view: TableView, mode: 'desktop' | 'mobile') {
    const w = cssW
    const h = cssH
    const scale = Math.min(w, h)
    const cardW = scale * 0.09
    const cardH = cardW * 1.4
    const gap = cardW * 0.18
    const n = Math.max(view.board.length, 5)
    const totalW = n * cardW + (n - 1) * gap
    const startX = w / 2 - totalW / 2
    // On mobile the board drops to mid-table, below the packed opponent rows.
    const y = h * (mode === 'mobile' ? 0.54 : 0.34) - cardH / 2

    for (let i = 0; i < 5; i++) {
      const x = startX + i * (cardW + gap)
      const card = view.board[i]
      if (card) drawCard(x, y, cardW, cardH, card)
      else drawEmptyCardSlot(x, y, cardW, cardH)
    }

    // Pot label, centered just below the board.
    const potY = y + cardH + Math.max(14, h * 0.035)
    ctx!.font = `700 ${Math.max(12, scale * 0.028)}px ${theme.fontMono}`
    ctx!.fillStyle = theme.text
    ctx!.textAlign = 'center'
    ctx!.textBaseline = 'alphabetic'
    ctx!.fillText(`Pot ${fmtChips(view.pot)}`, w / 2, potY)

    if (view.sidePots.length > 0) {
      ctx!.font = `${Math.max(10, scale * 0.02)}px ${theme.fontMono}`
      ctx!.fillStyle = theme.muted
      const sideText = view.sidePots.map(p => fmtChips(p)).join(' · ')
      ctx!.fillText(`Side pots: ${sideText}`, w / 2, potY + Math.max(14, scale * 0.026))
    }

    if (view.message) {
      ctx!.font = `${Math.max(11, scale * 0.022)}px ${theme.fontSerif}`
      ctx!.fillStyle = theme.muted
      ctx!.fillText(view.message, w / 2, y - Math.max(10, h * 0.025))
    }
  }

  function drawSeat(seat: SeatView, pos: { x: number; y: number }, layout: LayoutConfig) {
    const w = cssW
    const h = cssH
    const scale = Math.min(w, h)
    const anchorX = pos.x * w
    const anchorY = pos.y * h

    const cardW = scale * 0.08 * layout.cardScale
    const cardH = cardW * 1.4
    const plateW = Math.max(cardW * 2.6, scale * 0.22)
    const plateH = Math.max(20, scale * 0.05)

    ctx!.save()

    if (seat.empty) {
      ctx!.globalAlpha = 0.5
      roundRectPath(ctx!, anchorX - plateW / 2, anchorY - plateH / 2, plateW, plateH, plateH * 0.3)
      ctx!.strokeStyle = theme.border
      ctx!.lineWidth = 1
      ctx!.stroke()
      ctx!.fillStyle = theme.muted
      ctx!.font = `${Math.max(10, scale * 0.02)}px ${theme.fontSerif}`
      ctx!.textAlign = 'center'
      ctx!.textBaseline = 'middle'
      ctx!.fillText('Empty seat', anchorX, anchorY)
      ctx!.restore()
      return
    }

    if (seat.folded) ctx!.globalAlpha = 0.45

    // Turn highlight — a soft glow ring around the whole seat cluster.
    if (seat.isTurn) {
      ctx!.save()
      ctx!.shadowColor = theme.accent
      ctx!.shadowBlur = Math.max(10, scale * 0.02)
      ctx!.beginPath()
      ctx!.ellipse(anchorX, anchorY, plateW * 0.72, plateH * 1.6, 0, 0, Math.PI * 2)
      ctx!.strokeStyle = theme.accent
      ctx!.lineWidth = Math.max(2, scale * 0.004)
      ctx!.stroke()
      ctx!.restore()
    }

    // Hole cards, above the name plate.
    const cardsY = anchorY - plateH / 2 - cardH - Math.max(6, scale * 0.012)
    const nCards = Math.max(seat.hole.length, 1)
    const cardGap = cardW * 0.15
    const totalCardsW = nCards * cardW + (nCards - 1) * cardGap
    let cx = anchorX - totalCardsW / 2
    if (seat.hole.length > 0) {
      for (const card of seat.hole) {
        if (card) drawCard(cx, cardsY, cardW, cardH, card)
        else drawCardBack(cx, cardsY, cardW, cardH)
        cx += cardW + cardGap
      }
    }

    // Name plate: name + chip count.
    const plateX = anchorX - plateW / 2
    const plateY = anchorY - plateH / 2
    roundRectPath(ctx!, plateX, plateY, plateW, plateH, plateH * 0.25)
    ctx!.fillStyle = theme.bg
    ctx!.fill()
    ctx!.lineWidth = Math.max(1, scale * 0.0025)
    ctx!.strokeStyle = seat.isHero ? theme.accent : theme.border
    ctx!.stroke()

    const nameSize = Math.max(10, plateH * 0.34)
    ctx!.textAlign = 'center'
    ctx!.fillStyle = theme.text
    ctx!.font = `700 ${nameSize}px ${theme.fontSerif}`
    ctx!.textBaseline = 'alphabetic'
    ctx!.fillText(fitText(ctx!, seat.name, plateW * 0.88), anchorX, plateY + plateH * 0.42)

    ctx!.font = `${Math.max(9, plateH * 0.28)}px ${theme.fontMono}`
    ctx!.fillStyle = theme.muted
    ctx!.fillText(fmtChips(seat.chips), anchorX, plateY + plateH * 0.82)

    // Status label, just under the plate.
    if (seat.status) {
      ctx!.font = `700 ${Math.max(9, plateH * 0.26)}px ${theme.fontMono}`
      ctx!.fillStyle = seat.folded ? theme.muted : theme.accent
      ctx!.fillText(seat.status, anchorX, plateY + plateH + Math.max(11, plateH * 0.32))
    }

    // Dealer button chip.
    if (seat.isButton) {
      const bR = Math.max(7, plateH * 0.28)
      const bx = plateX + plateW + bR * 0.6
      const by = plateY + plateH / 2
      ctx!.beginPath()
      ctx!.arc(bx, by, bR, 0, Math.PI * 2)
      ctx!.fillStyle = theme.bg
      ctx!.fill()
      ctx!.lineWidth = Math.max(1, bR * 0.16)
      ctx!.strokeStyle = theme.text
      ctx!.stroke()
      ctx!.fillStyle = theme.text
      ctx!.font = `700 ${bR}px ${theme.fontMono}`
      ctx!.textAlign = 'center'
      ctx!.textBaseline = 'middle'
      ctx!.fillText('D', bx, by + bR * 0.05)
    }

    // Committed chips — a small bet chip drawn in front of the seat, partway
    // toward the board (which sits lower on mobile), so bets never pile onto
    // the pot label.
    if (seat.committed > 0) {
      const boardCy = cssH * (layout.mode === 'mobile' ? 0.54 : 0.46)
      const cxc = anchorX * 0.5 + (cssW / 2) * 0.5
      const cyc = anchorY * 0.5 + boardCy * 0.5
      const chipR = Math.max(8, scale * 0.016)
      ctx!.beginPath()
      ctx!.arc(cxc, cyc, chipR, 0, Math.PI * 2)
      ctx!.fillStyle = theme.accent
      ctx!.globalAlpha = seat.folded ? 0.3 : 0.85
      ctx!.fill()
      ctx!.globalAlpha = seat.folded ? 0.45 : 1
      ctx!.lineWidth = 1
      ctx!.strokeStyle = theme.border
      ctx!.stroke()
      ctx!.font = `700 ${Math.max(9, chipR * 0.9)}px ${theme.fontMono}`
      ctx!.fillStyle = theme.bg
      ctx!.textAlign = 'center'
      ctx!.textBaseline = 'middle'
      ctx!.fillText(fmtChips(seat.committed), cxc, cyc + 0.5)
    }

    ctx!.restore()
  }

  function draw(view: TableView) {
    if (cssW <= 0 || cssH <= 0) return
    const ratio = dpr()
    ctx!.save()
    ctx!.scale(ratio, ratio)
    ctx!.clearRect(0, 0, cssW, cssH)

    const mode = cssW < 560 ? 'mobile' : 'desktop'
    drawFelt()
    drawBoard(view, mode)

    const layout = computeLayout(mode, Math.max(view.seats.length, 1))
    view.seats.forEach((seat, i) => {
      const pos = layout.seatPositions[i] ?? layout.seatPositions[layout.seatPositions.length - 1]
      drawSeat(seat, pos, layout)
    })

    ctx!.restore()
  }

  resize()

  return {
    draw,
    resize,
    destroy() {
      // No listeners are attached by this module; nothing to tear down.
    },
  }
}
