# Game & Mobile Design Principles

Principles for interactive games and rich visual tools across the site.
Asserted across mobile viewports (down to 375px iPhone SE) and desktop browsers.

---

## 1. Screen Real Estate & Mobile Viewport Preservation

During active gameplay on mobile devices, screen real estate is precious:

- **Top Navigation Suppression**:
  On mobile viewports (`window.innerWidth <= 768`), once the player has scrolled down to the game board, the sticky header nav must stay hidden. It must not flash or pop back into view on accidental upward swipes during gameplay (swiping tiles in 2048, scrolling a poker board). The nav reveals only when the player scrolls all the way back to the top of the page (`current <= navH + 10px`).
- **Strict Mobile Clearance ($\le 375\text{px}$)**:
  Every game must be fully playable on 375px viewports without horizontal clipping, cramped text, or overlapping badges.
  - Poker Trainer: Multi-row felt header with clear street beacon, compact villain pills with ellipsis, community cards set to `nowrap`, and guaranteed felt clearances above and below the board.
  - Bytele: Keyboard sized to fit within 375px without horizontal scrolling; letter tiles scale cleanly.
  - 2048: Board stage scaled responsively to container width, controls arranged with clean wrap behavior.

---

## 2. Tactile Physical Metaphors (Material Authenticity)

Avoid generic flat AI aesthetics or sterile software rectangles. Every game evokes authentic physical materials:

- **Poker Trainer (Casino Felt & Ceramic Chips)**:
  - Table felt with soft radiant highlights and authentic border rails.
  - Physical poker chip stacks with edge markings, metallic denominations, and bevelled 3D rims.
  - Real card dimensions with casino-style corner pips and suited colors.
- **Bytele (Mechanical Keycaps & Terminal CRT)**:
  - Keycaps styled with mechanical switch depth: 3D bottom bevels, distinct active press depth (`translateY(2px)`), and crisp monospace legends.
  - Guess grid styled with subtle terminal glass backing (`rgba(10, 16, 20, 0.7)`).
  - High-contrast state fills: emerald for correct placements, amber for present letters, slate for misses.
- **2048 (Ceramic & Resin Weighted Tiles)**:
  - Tiles styled as weighted ceramic/resin game pieces: soft drop shadows for elevation, subtle top specular highlight, and crisp bevel rims.
  - Board stage styled as a recessed, machined tray with inset cell tracks.
  - Milestone aura: higher tiles ($\ge 128$) cast ambient luminous glows matching their hue.

---

## 3. Touch Ergonomics & Adaptive Prompts

- **$\ge 44\text{px}$ Touch Targets**:
  On mobile viewports, all primary interaction buttons, tabs, and keycaps must provide at least 44px tap targets to prevent mis-clicks.
- **Touch-Aware Guidance**:
  Avoid desktop keyboard prompts on touch screens. When `@media (hover: none) and (pointer: coarse)` applies, swipe and tap interactions are the primary inputs; hide physical keyboard shortcut hints like "Click board first to focus".
- **Gesture Reliability (`touch-action: none`)**:
  Canvas and swipeable elements declare `touch-action: none` to prevent page panning from intercepting game gestures.

---

## 4. Systems Grounding & Engineering Value

Portfolio games should inform, sharpen, and educate developers:

- **Bytele (The Developer's Wordle)**:
  - Curated dictionary of 5-letter computer science, distributed systems, and backend keywords (`MUTEX`, `SHARD`, `CACHE`, `STACK`, `QUEUE`, `PROXY`, `TOKEN`, `ARENA`, `EPOCH`, `INODE`, etc.).
  - Post-Game Takeaway: Every solved or failed puzzle unlocks an **Interview Gotcha & Architecture Takeaway** card detailing production tradeoffs, memory implications, and common concurrency traps.
- **Poker Trainer (GTO Math & Probability)**:
  - Real EV equity, pot odds math, range heatmaps, and solver logic rather than simple arcade button mashers.

---

## 5. Zero-Framework Lightweight Performance

- Built entirely with vanilla TypeScript Custom Elements (`HTMLElement`), pure CSS tokens from `theme.css`, and Oat-UI base semantics.
- No React, Vue, Svelte, or third-party game engine bloat.
- Animation loops (`requestAnimationFrame`) run only during active transitions and cleanly tear down on `disconnectedCallback` to prevent memory leaks across page transitions.
- Respect `prefers-reduced-motion` at all times.
