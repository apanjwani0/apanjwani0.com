# Design System

All visual design comes from the tokens in `src/styles/theme.css`. Re-theme by
editing tokens only. The design system is the site's own (the tokens plus the
shared idioms in `shared.css`); Oat is the base layer under it.

- **Never hardcode** a colour, font, size or spacing in a stylesheet; use
  `var(--color-*)`, `var(--font-*)`, `var(--text-*)`, `var(--space-*)`.
- **Load order**: `theme.css` → `shared.css` (base elements and the header,
  both shells) → `global.css` (content pages) / `home.css` / component CSS.
- **Anything both shells render belongs in `shared.css`**, because
  `ToolBase.astro` doesn't load `global.css`. That covers a shared `data-type`
  idiom's base rule (a Base-only refinement may stay in `global.css`), bare
  element rules (the page `h1`, at `--text-title`) and `body` itself: font,
  colour, background, and the flex column that pins the footer, with
  `main { flex: 1 0 auto }`. The `tool-header` block lives once, in
  `tools-common.css`. Only a tool-private subtree may size an `h1` (Draftboard's
  `md-preview`). All derived from the components and asserted.
- **Card titles**: `[data-type="card-title"]` gets its size (`--text-card`) and
  weight from `shared.css`, and no other sheet may set its `font-size` or
  `font-weight`.
- **One card anatomy on every hub** (`shared.css`): `card-head` (the title,
  then a `card-badges` group on the right), `card-desc` (clamped to three
  lines), then an optional `card-meta` pinned to the bottom (the learnings
  card's date and read time). The tools, games and learnings hubs all render
  `ul[data-type="card-grid"] > li` this way; the streak strip finds its game's
  `card-badges`.
- **The whole card is its link**, through a stretched `::after` on the title
  link. The card must stay `position: relative` (or the overlay covers the
  page), and a card's secondary links need `position: relative` to stay
  clickable. Both asserted.
- **Spacing rungs increase in name order**: `2xs < xs < sm < md < lg < xl < card
  < section`, declared smallest first. The only other `--space-*` tokens are
  layout measurements (`page-x`, `header-offset`). Asserted.
- **One control kit**: `src/styles/controls.css`, imported by `shared.css`,
  styles the controls inside any root carrying `data-controls` (buttons with
  `data-variant="primary|ghost|danger"`, `aria-pressed` for "on",
  `[data-type="segmented"]`, `toolbar`, fields, `section-label`, `field`, tabs
  with `data-tabs="pill"` inside a pane, `details[data-type="menu"]`, badges with
  `data-tone`, `status-line`). It reads only the `--control-*`, `--tab-*`,
  `--badge-*`, `--field-fs` and `--label-tracking` tokens, and those read
  `--font-*` and `--color-*`, so one token changes every control. Controls are
  36px, 44px on a coarse pointer; at most one primary per view. Its hover rules
  carry `:not(:disabled)`. Every kit token is read by the kit, no literal
  colour or family, every rule sits under `[data-controls]`, and a kit tool
  is in none of the `tools-common.css` lists. Asserted. Not `data-kit`: that is
  the starred-tools count on `<html>`, and a kit keyed on it would restyle
  every control on the site. The kit loads after a tool's own sheet, so a tool rule that must
  beat it is prefixed with the tool root (`[data-tool='flowmap'] …`). New
  tools join the kit; Flowmap is the reference.
- **One disabled treatment**: `--opacity-disabled`. The lane floors
  (`tools-common.css`, `games-common.css`) neutralise `:hover` by re-stating the
  hovered properties at equal specificity, declared after. Not
  `:hover:not(:disabled)`: that raises specificity and repaints per-tool tab
  opt-outs. Those lists are being retired tool by tool as each moves to the kit.
- **Contrast is asserted.** `security:smoke` parses both palettes and holds
  every text pairing to WCAG AA (4.5:1). Headroom is thin on
  `--color-surface-2` (accent 4.59 and success 4.68 in light, muted 4.76 in
  dark). `--color-accent-soft` takes `--color-text` only. `--color-border` is
  held to 2:1, deliberately short of the 3:1 for UI boundaries, which would box
  every card; the hover border is `--color-muted`.
- **Focus**: `main` carries `tabindex="-1"` for the skip link. Silence its ring
  only with `main:focus:not(:focus-visible)`, never a blanket
  `main:focus { outline: none }`. Asserted.
- **An `<svg>` at `width: 100%` scales its own text**, so a diagram gets a
  legibility floor (`min-width` on the SVG, `overflow-x: auto` on its container)
  rather than a breakpoint. A scrollable container takes `tabindex="0"`,
  `role="region"` and an `aria-label`.
- **Theming**: light at `:root`, dark under `[data-theme="dark"]` (the site runs
  dark). A new theme is another `[data-theme="…"]` block with palette, shadows
  and its own `color-scheme`. The `color-scheme` line is required, or Oat's
  layered `light dark` makes native controls follow the OS. The Oat bridge at
  the end of `:root` points Oat's tokens at the site's, and every ink-on-fill
  pair it creates is in the contrast sweep.
- **The visitor picks the theme**: `theme:v1` in localStorage (`light` | `dark`
  | `system`), else the site config's theme, never the OS. There is no theme
  cookie; the server never varies by theme.

## UI refresh (2026-09)

Item A (the foundation) is built, and G (the control kit) is built with Flowmap
as its first tool; B–F are paused. The direction: refine the dark
look, not a rebrand, with tasteful motion and `prefers-reduced-motion` as the
off switch.

Modules, none with DOM access at module scope:

- `src/lib/theme.ts` — the theme preference (`theme:v1`, the `site:theme`
  event), `resolveTheme` (pure), `ROOT_STATE_ATTRS`, `patchIncomingDocument`,
  `ROOT_BOOT_JS`.
- `src/lib/kit.ts` — starred tools (`kit:v1`, at most 24, live tools only),
  `parseKitParam` (the only `?t=` parser, for route and client alike),
  `bookmarksFile`.
- `src/lib/site-index.ts` (server-only) — `indexablePaths` (what the sitemap
  serialises) and `buildSiteIndex` (what `/llms.txt` lists, and the planned
  palette's entries), asserted to be the same pages.
- `src/lib/fuzzy.ts` — `fuzzyScore`, `suggestPaths`, `isScannerPath`.
- `src/lib/site-ui.ts` — `initSiteUI()`, called once by both shells. It wires
  the swap patch, watches the theme preference, and calls four empty entry
  points owned by the paused items (`initThemeUI`, `initFindUI`, `initKitUI`,
  `initMotion`). None may import `astro:transitions/client`, which would put
  the router on ToolBase pages (asserted).

The head bootstrap sets `data-theme`, `data-theme-pref`, `data-js` and
`data-kit`, updates the theme-color and color-scheme metas, and wraps every
storage access in `try`. It restates `resolveTheme` because it can't import it,
so the smoke test runs it over the full truth table. Both shells render
`html[data-theme-default]`. The nav buttons
`button[data-action="palette" | "theme" | "shortcuts"]` stay hidden until
`data-js`. `Base` takes a `canonicalPath` prop for pages that render a query
string.

### Paused items

B (theme toggle everywhere), C (command palette, `?` sheet, smart 404), D
(toolkit: stars, shelf, `/tools/kit`, bookmarks export), E (shells, nav, motion,
the home hero seam) and F (hub thumbnails and share cards) are designed, not
built. The plan (`ui-refresh/ui-plan.md`, the worker brief and
item A's report) is only on the remote branch `origin/wip/ui-refresh-notes`:
read it before building any of them, and keep that branch. Until they are built, `kit.ts`
and `fuzzy.ts` have no UI caller; `security:smoke` covers them so they don't rot, and each
item's assertions go in its labelled region at the end of that script. Planned
names nothing renders yet: `button[data-type="kit-star"]`,
`section[data-type="kit-shelf"]`, `div[data-type="detail-actions"]`. Item G's
control kit now exists (`src/styles/controls.css`, see *Design System*). The
view-transition plan: `vt-title` is the page h1 and, during a navigation, the
clicked card's title, with `html[data-vt-source]` clearing the source page's h1
(two elements with one name abort the transition); `vt-nav` is the fixed nav;
`vt-thumb` is optional. No stylesheet declares `view-transition-name` yet.
