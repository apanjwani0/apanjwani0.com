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
  is in none of the `tools-common.css` lists. Asserted. Not an attribute on
  `<html>`: a kit keyed on root state would restyle every control on the
  site. The kit loads after a tool's own sheet, so a tool rule that must
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
  `main:focus { outline: none }`. Asserted. The ring is the `--focus-ring` and
  `--focus-offset` tokens, drawn once by `:focus-visible` in `shared.css`; a
  component restates at most the offset, never its own outline. Asserted in
  `scripts/smoke/design.mjs`.
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

### Tokens added in the 2026-11 polish pass

All in `theme.css`; the contrast sweep holds the colour pair to AA in both palettes.

| Token | Value | Use |
|---|---|---|
| `--color-warning` | `#8a5a00` light, `#f5b94a` dark | Amber ink for caution (poker trainer's fold verdict). 5.93 / 5.48 / 5.21:1 on bg / surface / surface-2 in light; 11.44 / 10.88 / 9.89:1 in dark. |
| `--color-warning-soft` | `#fdf1d6` light, `#2a2110` dark | Its tinted fill. `--color-text` only, like `--color-accent-soft` (16.84:1 light, 12.60:1 dark). |
| `--z-sky`, `--z-content`, `--z-nav`, `--z-skip` | `0`, `1`, `10`, `100` | The stacking ladder: backdrops (starfield, sky), page content, the fixed nav, the skip link. No bare `z-index` in the shared sheets or a component. |
| `--focus-ring`, `--focus-offset` | `2px solid var(--color-accent)`, `3px` | The one keyboard focus ring. |
| `--target-min` | `2.75rem` | 44px. Under `@media (pointer: coarse)` the nav, footer, breadcrumb and hero links are `inline-flex` with `min-height: var(--target-min)`; a mouse sees the old look. |
| `--text-title`, `--text-lg` | clamps | Fluid like the other rungs: `--text-title` runs 1.75rem to 2.1rem and `--text-lg` 1.15rem to 1.3rem, reaching the old size at about 750px and 800px. |
| `--measure-narrow`, `--measure-about`, `--measure-text` | `34rem`, `38rem`, `42rem` | Named column measures (error pages, the footer's about block, a lede). |
| `--pad-block-fluid`, `--pad-tool-y`, `--gap-fluid`, `--gap-nav`, `--nav-pad` | clamps, `2rem` | Fluid chrome spacing that no `--space-*` rung matches. Not `--space-*`: that prefix is the ordered scale. |
| `--tracking-label`, `--tracking-wide`, `--underline-offset` | `0.04em`, `0.25em`, `0.3em` | Letter-spacing and underline distance for mono labels and links. |

**Forced colours and print** (end of `shared.css`, plus the `main` width in
`global.css`): under `forced-colors: active` the focus outline and the card,
field and control borders are restated in `CanvasText`, because system colours
drop shadows and tints. Under `@media print` the nav, footer, starfield, sky, skip
link and loading panel are hidden, the palette is pinned to the system's
black-on-white, and an article flows the full page width.

**No literal `rem`, `em` or `ms` in a component or page `<style>`** (a media
query's condition is exempt): use `--space-*`, `--motion-*`, `--ease-*` or a
named token above. The 404 and 500 pages share `src/styles/error-page.css`.
Asserted in `scripts/smoke/design.mjs`; `src/pages/admin.astro`, the dev-only
editor, is the one file it skips.

## UI refresh (2026-09)

Item A (the foundation) is built, G (the control kit) is built with Flowmap
as its first tool, and C (the command palette) is built; B, D, E and F are
paused or cut (see *Paused items*). The direction: refine the dark
look, not a rebrand, with tasteful motion and `prefers-reduced-motion` as the
off switch.

Modules, none with DOM access at module scope:

- `src/lib/theme.ts` — the theme preference (`theme:v1`, the `site:theme`
  event), `resolveTheme` (pure), `ROOT_STATE_ATTRS`, `patchIncomingDocument`,
  `ROOT_BOOT_JS`.
- `src/lib/site-index.ts` (server-only) — `indexablePaths` (what the sitemap
  serialises) and `buildSiteIndex` (what `/llms.txt` and `/search.json` list),
  asserted to be the same pages.
- `src/lib/fuzzy.ts` — `fuzzyScore`, `rankEntries` (the palette's ranking),
  `suggestPaths` and `isScannerPath` (the 404).
- `src/lib/find-ui.ts` — the command palette, below.
- `src/lib/site-ui.ts` — `initSiteUI()`, called once by both shells. It wires
  the swap patch, watches the theme preference, and calls the feature entry
  points (`initThemeUI`, still an empty stub of the paused item B;
  `initFindUI`; `initMotion`). None may import `astro:transitions/client`,
  which would put the router on ToolBase pages (asserted).

The head bootstrap sets `data-theme`, `data-theme-pref` and `data-js`,
updates the theme-color and color-scheme metas, and wraps every storage access
in `try`. It is a constant with nothing interpolated. It restates
`resolveTheme` because it can't import it, so the smoke test runs it over the
full truth table. Both shells render `html[data-theme-default]`. The nav buttons
`button[data-action="palette" | "theme"]` stay hidden until `data-js`. `Base`
takes a `canonicalPath` prop for pages that render a query string.

### The command palette

⌘K or Ctrl+K, or the nav's `button[data-action="palette"]`, opens
`div[data-type="palette"]` (`role="dialog"`, `aria-modal`; a field with
`role="combobox"` driving a `role="listbox"` through `aria-activedescendant`).
It finds pages by name, shows at most eight grouped by kind with their one-line
descriptions, and every result is a real link, so the router, a middle click
and a new tab all work; a link into a ToolBase page carries `data-astro-reload`
through `shellLinkAttrs`.

- **The index** is `/search.json` (`src/pages/search.json.ts`):
  `buildSiteIndex` as `[{ t, u, k, d, w }]`, the same pages as the sitemap
  (asserted), cached like a page and the same for every visitor. The client
  fetches it once, on first open, memoises it for the document, and aborts the
  request if the dialog closes first. Nothing is fetched on page load.
- **Ranking** is `rankEntries`: a title match (`fuzzyScore`) outranks a keyword
  match, which outranks a description match; kind breaks near-ties, so "cron"
  lists the tool before its presets, and the Driftfield modes and Cron presets
  are capped at three.
- **It stores nothing**: no recent searches, no counts (nothing to add to
  `/terms`).
- **Focus**: the page behind is `inert` while it is open, Tab stays on the field
  and the close button, and Escape or a click on the scrim closes it and puts
  focus back where it was. The one animation is an opacity fade of
  `--motion-base`, off under `prefers-reduced-motion`.
- **Mounting**: `initFindUI()` registers its `document` listeners once and
  re-checks on `astro:page-load` (a swap replaces the body, which drops an open
  dialog). Styles are `src/styles/palette.css`, imported by both shells.
- The `?` shortcut sheet was cut. The starred-tools kit (`kit.ts`, `data-kit`,
  `/tools/kit`) was cut with it: nothing read it. Asserted by
  `scripts/smoke/palette.mjs`.

### Paused items

C (the command palette) is built, without the `?` sheet; the smart 404 is built
too, and `src/pages/404.astro` calls `fuzzy.ts`. D (the starred-tools kit:
stars, shelf, `/tools/kit`, bookmarks export) is cut, and its code is deleted.
B (theme toggle everywhere, `initThemeUI` is still an empty stub), E (shells,
nav, motion, the home hero seam) and F (hub thumbnails and share cards) are
designed, not built. The plan (`ui-refresh/ui-plan.md`, the worker brief and
item A's report) is only on the remote branch `origin/wip/ui-refresh-notes`:
read it before building any of them, and keep that branch. Planned names
nothing renders yet: `div[data-type="detail-actions"]`. Item G's
control kit now exists (`src/styles/controls.css`, see *Design System*). The
view-transition plan: `vt-title` is the page h1 and, during a navigation, the
clicked card's title, with `html[data-vt-source]` clearing the source page's h1
(two elements with one name abort the transition); `vt-nav` is the fixed nav;
`vt-thumb` is optional. No stylesheet declares `view-transition-name` yet.

## UI generation

Generated UI follows the site's own rules, whatever general design guidance says: no custom classes, fonts or Tailwind; semantic HTML plus the site's `data-type` idioms and tokens. Motion is short transitions from the `--motion-*` and `--ease-*` tokens, never looping decoration. `shared.css` neutralises every transition and animation under `prefers-reduced-motion: reduce`; motion driven from script checks the query itself.
