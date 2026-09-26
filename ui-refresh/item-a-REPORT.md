# Item A (Foundation): report

This is the item A worker's report, saved here for workers B–G. The worker could not write this file itself.

**Branch:** `feat/ui-refresh`, on top of `f439a41`, 6 commits. The full gate is green on every commit.

```
26c0ac7 docs: agents.md describes the refresh's foundation and gives each later item a stub
6a5e0e6 test: security:smoke holds the refresh's foundation, and leaves a region for each later item
295ea44 fix: a rerouted 404 carries the nonce its csp names, so the head bootstrap runs there too
845d1a5 feat: a head bootstrap applies the stored theme before first paint, and a swap keeps it
eafc723 refactor: the sitemap is the site index serialised, with byte-identical output
22639d6 feat: theme tokens for the refresh, a spacing scale that increases, and oat speaking the site palette
```

## Interfaces you can rely on (`src/lib/`)

### `theme.ts`

- **Types:** `ThemePref` (`'light' | 'dark' | 'system'`), `Theme`, and `ThemeEventDetail {theme, pref|null}`.
- **Constants:**
  - `THEME_KEY = 'theme:v1'`. The stored value is the plain string.
  - `THEME_EVENT = 'site:theme'`, a CustomEvent dispatched on `document`.
  - `THEME_COLOR` and `ROOT_STATE_ATTRS`.
- **Functions:**
  - `isThemePref`
  - `resolveTheme(pref|null, ssrDefault, prefersDark)`
  - `nextThemePref`, which cycles dark → light → system
  - `readThemePref`, `setThemePref`, `currentTheme`
  - `onThemeChange(cb)`, which returns an unsubscribe function
  - `watchThemePref`
  - `patchIncomingDocument(doc)`
- **`ROOT_BOOT_JS`:** 1090 bytes, and byte-identical on every page.

### `kit.ts`

- **Constants:**
  - `KIT_KEY = 'kit:v1'`, stored as `{v:1, slugs}`.
  - `KIT_EVENT = 'site:kit'`, `KIT_MAX = 24`, `KIT_PARAM = 't'`, `KIT_RAW_MAX = 1024`, `KIT_SLUG`, `KIT_PATH`.
- **Functions:**
  - `sanitizeKit`
  - `parseKitParam(raw, liveSlugs)`
  - `kitHref`, `readKit`
  - `writeKit`, which also keeps `html[data-kit]` current
  - `toggleKit`, which returns whether the tool is starred afterwards
  - `onKitChange(cb)`, which returns an unsubscribe function
  - `bookmarksFile(items, {folder, now})`

### `site-index.ts` (server-only)

- **Types:** `IndexEntry {k,t,u,d?,w?,s?}`, `IndexKind`, `IndexablePath {path, lastmod?}`, `SiteConfigs`.
- **Functions:** `loadSiteConfigs(locals)`, `indexablePaths`, `buildSiteIndex`, `projectAnchors`, `summarize`.

### `fuzzy.ts`

`fuzzyScore(q, text)` returns `{score, hits}` or null. Also `suggestPaths(path, entries, limit=3)` and `isScannerPath`.

### `shortcuts.ts`

- `GLOBAL_SHORTCUTS`, `matchGlobalShortcut`, `isTypingTarget`, `listPageShortcuts`
- `shouldHandleGlobalKey`, which returns a boolean
- `registerPageShortcuts(owner, list)`, which returns an unregister function

### `site-ui.ts`

Both shells call `initSiteUI()`, which:
1. wires `astro:before-swap` to `patchIncomingDocument`;
2. calls `watchThemePref`;
3. calls four empty stubs for later items to fill: `initThemeUI` (`theme-ui.ts`), `initFindUI` (`find-ui.ts`), `initKitUI` (`kit-ui.ts`) and `initMotion` (`motion.ts`).

### Pages and DOM

- `Head.astro` renders `<script is:inline nonce={cspNonce} set:html={ROOT_BOOT_JS} />` after the theme-color and color-scheme metas and before every stylesheet. It is the only inline executable script on the site. Never add another.
- `Base` takes a `canonicalPath` prop.
- Both shells render `data-theme` and `data-theme-default` on `<html>`.
- `shared.css` hides `button[data-action=palette|theme|shortcuts]` until `data-js` is set.

### Tokens (`theme.css`)

- **New:** `--color-surface-2`, `--color-accent-soft`, `--shadow-1/2/3`, `--glow-accent`, `--lift`, `--motion-*`, `--ease-*`, `--control-*`, `--tab-*`, `--badge-*`, `--text-card`, `--thumb-ratio`.
- `color-scheme` is set per theme.
- An Oat bridge maps Oat's tokens onto the site's.

### Anchor regions for items B–G

- **`scripts/security-smoke.mjs`:** at the end of the file.
- **`AGENTS.md`:** in the "UI refresh" section.

Regions are separated by three `·` lines. Don't edit those lines. Edit only your own region.

## Deviations from the plan that later items must know

- **`data-theme-default` on `<html>`.** The bootstrap overwrites `data-theme`, so the site default needs its own attribute.
- **Metas.** The bootstrap maintains the color-scheme meta, and `patchIncomingDocument` copies both the theme-color and color-scheme metas.
- **`indexablePaths` returns `{path, lastmod}`** objects, not plain strings.
- **The Oat bridge also maps `--card-foreground`.**
- **For F:** `/projects` cards don't render `projectAnchors()` ids yet, because `ProjectCard.astro` belongs to F. Until F adds them, `/projects#<id>` lands at the top of the page.
- **For B:** some engine `.ts` files still fall back to `'#73808f'` for `--color-muted`. The value is stale but harmless. Fix it when you add the theme subscription.
- **404 without CSP.** A 404 rendered without middleware (Astro's fallback when the 404 page itself throws) has no CSP header. This is documented in AGENTS.md.

## Visual check (worker's)

- **Dark:** identical to the base build except muted text, which is the deliberate readability nudge. The two Oat-default checkboxes on JSON Tidy are now dark on a light OS too.
- **Stored `light`:** all 5 routes render light.
- **No flash:** a CDP screencast showed no dark frame on a hard load, on Base→Base swaps, or on Base→ToolBase and back.
- **Not checked:** canvases and engines in light. That is item B's scope.
