# UI/UX refresh: implementation plan

I read the pristine `develop` copies of every file below. I edited nothing.

## 1. Audit: what the plan fixes

**Tokens and theme**
- `/home/user/apanjwani0.com/src/styles/theme.css:69-70`: `--space-xs` (0.45rem) is larger than `--space-sm` (0.4rem).
- `/home/user/apanjwani0.com/src/components/Head.astro:57-58`: the `color-scheme: dark` meta and `theme-color #05070c` are hardcoded. Oat declares `:root{color-scheme:light dark}` inside `@layer theme`, which overrides the meta. As a result, every Oat `light-dark()` token (dialog, tablist, toast, default inputs and buttons) and every native control follows the OS setting, not `data-theme`.
- Contrast headroom is almost gone. Dark muted text on surface is 4.76:1. Any raised surface lighter than about `#10151f` pushes muted text below 4.5:1 (I computed 4.32 on `#141a26`).

**Shells and widths**
- `/home/user/apanjwani0.com/src/components/RelatedLinks.astro:45-50` and `/home/user/apanjwani0.com/src/styles/seo-support.css:1-7` centre a 768px column under the `--tool-width` workbench. Every tool page ends up with two left edges.
- `/home/user/apanjwani0.com/src/pages/games/[slug].astro:117` uses `Breadcrumbs inset` inside Base's padded 768px `main`. The breadcrumb therefore sits one gutter to the right of the title.
- `/home/user/apanjwani0.com/src/pages/tools/driftfield/[mode].astro:91-101` and `/home/user/apanjwani0.com/src/pages/tools/driftfield/index.astro:73-94` put the h1, intro, mode nav and the six-mode grid straight into ToolBase's `main`. That `main` has no side gutter (ToolBase doesn't load `global.css`), so they sit flush against the viewport edge. The engine itself is centred at `--max-width` (`flow-field.css:1-4`). This comes from reading the CSS; confirm it visually at 1440px.
- `/home/user/apanjwani0.com/src/components/games/type-trial/type-trial.css:1-4` hard-codes `max-width: 760px` on its own `tool-page` root. The smoke width check (`scripts/security-smoke.mjs` ~1102-1119) never sees it, because it only walks `src/components/tools/`.
- `/home/user/apanjwani0.com/src/layouts/ToolBase.astro:76-85` has its own `a`/`a:hover` rule. It has drifted from `global.css:49-57` (no accent underline colour). This is the same two-shell trap the body and h1 rules fell into.
- Tool components overwrite their SSR children with their own hardcoded h1 and lede (e.g. `JsonTidy.ts:824-829`). Before mount, the SSR h1 sits in the gutterless `main` and then jumps into place when the component mounts. That causes layout shift and gives the view-transition morph an unstable target.
- `shared.css:202-217`: the mobile nav wraps to two rows.

**Hubs and cards**
- /learnings: the date is mono at `--text-sm` (`global.css:218-223`), but the title just inherits the body size (`shared.css:368-373`), so the date reads larger than the title. There is no read time (`learnings.astro:45-51`).
- `ProjectCard.astro:46` renders the whole multi-paragraph description. The only visible link is the title.
- Badges come in three dialects: `game-badge` in Base-only `global.css:235-264`, `tool-server`/`tool-wip` in `tools.css:22-48`, and the Driftfield chips in `[mode].astro:152-163`.

**Controls**
- Buttons: `tools-common.css:76-99` is mono at .32/.85rem padding; `games-common.css:52-62` is serif at .32/.7rem; `wallpaper-forge.css:72-100` is serif with a 2.75rem min-height and a text-filled export button; `canvas-export.css:43-53,112-116` inherits the font at `--text-sm` with an accent fill; `games/[slug].astro:269-283` is different again.
- Pressed state: about 14 sheets use an accent border; `json-tidy.css:345,644`, `type-trial.css:32`, `hue-hunt.css:101` and `quintle.css:114` fill with the text colour; `regex-lab.css:86` fills with accent.
- Tabs: folder style in `hash-smith.css:14-38` and `codec-forge.css:35`; underline style in `poker-trainer.css:201-220` and `regex-lab.css:227`.
- `shared.css:40-44` and `tools-common.css:22-26` set `border-radius` on the focused element itself, so corners change on focus.

**Share cards**
- `/home/user/apanjwani0.com/src/lib/og.ts:146-153` falls back to `/avatar.webp`. That file is gitignored (`public/avatar.*`), so it only exists where the owner copied it.
- `index.astro:33` hardcodes the avatar path instead of using `site.avatar`.
- `scripts/generate-og.mjs:46` hardcodes a macOS Chrome path, so it can't run on Linux or CI.

**Astro 7.3.3 traps (verified in `node_modules`)**
- **Rerouted 404s get a mismatched nonce.** When a route returns `new Response(null,{status:404})`, Astro re-renders `404.astro` with the middleware run a second time (`core/routing/handler.js:126`, `core/errors/default-handler.js`). `mergeResponses` keeps the first pass's headers, so the CSP nonce set in `middleware.ts:40-52` no longer matches the body. It's harmless today because only JSON-LD carries a nonce, but it would block an inline bootstrap.
- **ClientRouter resets `<html data-theme>` on every navigation.** `swapRootAttributes` (`transitions/swap-functions.js:44-52`) replaces all root attributes.
- **ClientRouter re-inserts inline scripts with the new page's nonce.** `runScripts` (`router.js:72-100`) does this, and the live document's CSP rejects them. Only head scripts that are byte-identical across pages are safe, because they get deduplicated and never re-run.
- **Base→ToolBase clicks load twice.** ClientRouter fetches the page, sees it has no router, and loads it again via `location.href` (`router.js:283-286`).

**Stale code**
- `daily-streak-strip.ts:16-19` refers to the hub filter removed in 86fda2d.
- `type-trial.css:55-57` refers to a `global.css` rule that no longer exists.
- `learnings/[slug].astro:204,398` has token fallbacks that disagree with the real token values.

## 2. Shared interfaces (Item A ships these)

**`src/lib/theme.ts`** (no DOM access at module scope)
```ts
type ThemePref='light'|'dark'|'system'; type Theme='light'|'dark'
THEME_KEY='theme:v1'; THEME_EVENT='site:theme'   // CustomEvent<{theme,pref}> on document
resolveTheme(pref|null, ssrDefault, prefersDark): Theme  // pure; no stored pref → site.theme (dark)
readThemePref(); setThemePref(p); currentTheme()
onThemeChange(cb): () => void   // listens to the event, matchMedia (only when pref is system) and cross-tab storage
patchIncomingDocument(doc)      // on astro:before-swap: copies data-theme, data-theme-pref, data-js, data-kit and the theme-color meta onto the new document
ROOT_BOOT_JS: string            // constant inline head script; no interpolation; try/catch around storage
```
- The toggle cycles dark → light → system.
- There is no theme cookie, so server output never varies by theme.

**`src/lib/kit.ts`**
```ts
KIT_KEY='kit:v1' ({v:1,slugs}); KIT_EVENT='site:kit'; KIT_MAX=24; KIT_PARAM='t'; KIT_RAW_MAX=1024
sanitizeKit(raw): string[]                // unique, /^[a-z0-9-]{1,48}$/, capped, order kept
parseKitParam(raw, liveSlugs): string[]   // the ONLY parser, used by both the route and the client
kitHref(slugs); readKit(); writeKit(); toggleKit(slug); onKitChange(cb)
bookmarksFile(items:{title,url}[], {folder, now}): string  // Netscape format; every value passes through escapeHtml()
```
- **Only live tools can be starred, including the `/tools/driftfield` hub.** Games and Driftfield modes can't: that keeps one predicate (`status==='live'`), one namespace for `?t=`, and an export that really is a "tools" folder. If the owner wants games later, add a `g:` prefix.

**`src/lib/site-index.ts`**
- `IndexEntry {k:'section'|'tool'|'mode'|'game'|'learning'|'project'|'post'; t; u; d?; w?; s?}` (kind, title, URL, description, extra search words, slug).
- `buildSiteIndex(configs)` and `indexablePaths(configs)` read each kind's existing indexing predicate.
- `sitemap.xml.ts` is refactored to use it. Project entries link to `/projects#<id>`.

**Palette index: serve `/search.json`** (`src/pages/search.json.ts`, deliberately not under `/api/`), not SSR-embedded. Reasons:
- It keeps ~10KB out of every HTML response on both shells.
- It's fetched only on first open, with a prefetch on trigger hover/focus or on a Meta/Ctrl keydown.
- The middleware's existing 200 rule edge-caches it.
- security:smoke can drive it with a stubbed `SITE_CONFIG`, exactly like it drives the sitemap.
- Fetching JSON avoids both the nonce trap and the ClientRouter inline-script trap.

It should send `X-Robots-Tag: noindex` and escape `<` the way `serialize()` does.

**`src/lib/fuzzy.ts`**
- `fuzzyScore(q,text) → {score,hits}|null`.
- `suggestPaths(path, entries, limit=3)`: uses segment edit distance plus token overlap, and returns `[]` for scanner-shaped paths (file extensions, dotfiles, anything over 200 characters).

**`src/lib/shortcuts.ts`**
- `GLOBAL_SHORTCUTS`, `registerPageShortcuts(owner,list) → unregister`, `isTypingTarget`, `shouldHandleGlobalKey(e)`.
- `/` and `?` never fire from a typing target. ⌘K/Ctrl+K works everywhere except inside `[data-keys="own"]`. Events that are composing, repeating or already `defaultPrevented` are ignored.

**`src/lib/site-ui.ts`**
- `initSiteUI()` is called once by both layouts. It wires `astro:before-swap → patchIncomingDocument`, then calls `initThemeUI`, `initFindUI`, `initKitUI` and `initMotion`.
- Item A ships each of those as an empty stub in its own module; each feature item fills in only its own stub.

**DOM contract**
- `html[data-js]` and `html[data-kit]`.
- Nav buttons `button[data-action="palette"|"theme"|"shortcuts"]`, kept at `visibility:hidden` until `data-js` is set.
- `button[data-type="kit-star"][data-slug][aria-pressed]`, `section[data-type="kit-shelf"]`, `div[data-type="detail-actions"][data-dock]`.

**View-transition names**
- `vt-title` is the page h1 (a static rule in `shared.css`) and also the clicked card's `[data-type="card-title"]` (set dynamically). While a card holds it, `html[data-vt-source]` clears the source page's own h1, because duplicate names abort the transition.
- `vt-nav` is the fixed nav, so it holds still. `vt-thumb` is optional.
- No other stylesheet may declare `view-transition-name`.

**Badges:** `[data-type="badge"][data-tone="success|accent|muted"]` (plus `data-streak`), defined only in `src/styles/controls.css`.

**Controls**
- The lane floors keep their selectors and take their values from `--control-*`.
- Variants: `data-variant="primary|ghost|icon"`.
- One pressed look for `[aria-pressed="true"]`, `[aria-selected="true"]`, `[data-active]` and `[aria-current="page"]`.
- Tabs use the underline style.
- Toasts go through Oat's `ot.toast()`, wrapped in `src/lib/toast.ts`.

**New tokens in `theme.css`** (values checked for contrast)
- `--color-surface-2`: dark `#141a26`, which requires nudging `--color-muted` to about `#7a8796` (gives 4.76:1). Light `#f0f0f3`, with `--color-success` moved to about `#1e7a4c`.
- `--color-accent-soft`: dark `#1a1733`, light `#efedfb`. Only `--color-text` may sit on it.
- Elevation and glow: `--shadow-1/2/3` (per theme), `--glow-accent`, `--lift:-2px`.
- Motion: `--motion-fast:120ms`, `--motion-base:180ms`, `--motion-page:240ms`, `--ease-out:cubic-bezier(.2,.8,.2,1)`, `--ease-in-out:cubic-bezier(.4,0,.2,1)`.
- Controls: `--control-font/-fs/-pad-x/-pad-y/-radius/-ink/-ink-hover/-border/-border-hover`, `--tab-*`, `--badge-*`.
- `--text-card` (card-title rung, about 1.125rem) and `--thumb-ratio:1200/630`.
- `color-scheme: light` on `:root` and `dark` under `[data-theme="dark"]`.
- An Oat bridge mapping `--background`, `--foreground`, `--card`, `--border`, `--input`, `--ring`, `--primary(-foreground)`, `--muted(-foreground)` and `--font-sans` to the site tokens.

## 3. Work items

In each item, "(mutation)" after an assertion is the change to make, confirm the assertion fails, then revert.

### A. Foundation: tokens, contracts, the nonce fix (strong model; runs alone, first)

**Owns**
- `/home/user/apanjwani0.com/src/styles/theme.css`.
- The xs↔sm token-name swap in every file that uses them: `shared.css`, `global.css`, `tools.css`, `diagram-atlas.css`, `poker-trainer.css`, `flowmap.css`, `token-bench.css`, `chainsaw.css`, `driftfield/[mode].astro`, `learnings/[slug].astro`. The rendered pixels stay exactly the same.
- New modules `/home/user/apanjwani0.com/src/lib/{theme,kit,site-index,fuzzy,shortcuts,site-ui}.ts` plus the four stubs.
- `sitemap.xml.ts` (refactored onto site-index).
- `Head.astro`: `<script is:inline nonce set:html={ROOT_BOOT_JS}>`.
- `Base.astro`: a `canonicalPath` prop and the `initSiteUI()` call. `ToolBase.astro`: the `initSiteUI()` call.
- `middleware.ts`: skip setting the CSP header on a null-body 404/500. Astro re-renders those, and the second pass sets the matching header.
- `security-smoke.mjs`: labelled anchor regions for items B–G, separated by at least 3 unchanged lines; the new colour pairings; a palette parser that strips comments first.
- `origin-check.sh`: the nonce probe.
- `AGENTS.md`: empty section stubs for B–G, plus updates to Theming, the spacing bullet, and the `/frontent-design` override (motion allowed, with prefers-reduced-motion as the off switch).

**Must not touch:** component `.ts` files, hub pages, `Nav.astro`.

**Acceptance**
- build, check (0 errors) and smoke all green.
- No visual diff in the dark theme at 1440 and 390.
- A stored `light` preference renders light with no flash, including after ClientRouter navigation.
- The sitemap output is byte-identical.

**Smoke assertions (mutation in brackets)**
- The spacing rungs strictly increase in the documented order (swap them back).
- `ROOT_BOOT_JS`, run with stubbed storage and `matchMedia`, agrees with `resolveTheme` across the full truth table, including storage that throws (make the boot script default to system).
- `color-scheme` is declared for each theme (delete the dark one).
- The sitemap's URLs equal `indexablePaths` with blogs on and off, Driftfield live and wip, a wip tool and a draft article (let site-index include wip tools).
- The kit parse bounds hold (remove the `KIT_MAX` cap).
- `bookmarksFile` escapes `& < > " '` and emits only `https://<site>/tools/<live slug>` URLs (drop the quote escaping).
- `suggestPaths` suggests the right page for `/tools/jsontidy` and `/tool/regex-lab`, and returns `[]` for `/wp-login.php` (drop the scanner guard).
- A source-level check that the middleware guard exists (remove it).
- `origin-check`: the header nonce equals the body nonce on `/zz`, `/tools/zz` and `/a/b/c`.

### B. Theme: live switching everywhere (small model with this recipe)

**Owns**
- `/home/user/apanjwani0.com/src/lib/theme-ui.ts`: binds the toggle; its aria-label names the current and next theme.
- A theme subscription in 14 components: `StarField.ts` (home), `Twenty48`, `MazeWeaver`, `DeepShore`, `FlowField`, `GameOfLife`, `TuringBloom`, `LSystem`, `Murmuration`, `SandLoom`, `Starfield` (toy), `WallpaperForge`, `Flowmap` and `Draftboard`. Flowmap and Draftboard use cytoscape, so they need `cy.style()` rebuilt.

**Recipe**
- In `connectedCallback`: `this.offTheme = onThemeChange(() => { this.readTheme(); this.redraw() })`.
- In `disconnectedCallback`: `this.offTheme?.()`.
- Deep Shore and Maze Weaver draw static frames, so they must redraw explicitly.

**Must not touch:** `canvas-export.ts` and `game-mount.ts` (both being edited concurrently), and any CSS.

**Acceptance:** every engine repaints when the theme changes, without a reload, and no listeners leak after five in-site navigations.

**Smoke:** any source file that reads `--color-*` via `getPropertyValue` must subscribe to `onThemeChange` and unsubscribe on disconnect (delete one engine's subscription).

**AGENTS.md:** fill the Theming stub.

### C. Find: palette, shortcut sheet, smart 404 (strong model)

**Owns**
- New: `/home/user/apanjwani0.com/src/components/palette/{CommandPalette.ts,palette.css}`, `/home/user/apanjwani0.com/src/components/shortcuts/{ShortcutSheet.ts,shortcuts.css}`, `src/pages/search.json.ts`, `src/lib/find-ui.ts`.
- Modified: `404.astro`; the shortcut registration lists in `WebhookInspector.ts`, `HueHunt.ts` and `Quintle.ts` (no behaviour change).

**Palette**
- A `<dialog>` opened with `showModal()`. The input is `role=combobox` driving a listbox of options via `aria-activedescendant`, with a polite live region announcing the result count.
- Groups, in order: My kit, Actions, Tools, Driftfield, Games, Learnings, Projects, Sections. Starred tools get a ranking boost.
- Actions: set theme (three choices), open my kit, today's dailies (the daily games, with their streaks), copy link, keyboard shortcuts.
- It navigates by clicking a real `<a>`. ClientRouter then handles Base→Base navigation, and ToolBase pages do a normal load. Never import `astro:transitions/client` here: it would pull the router onto ToolBase pages.
- All result DOM is built with `textContent`.

**404**
- Suggestions come from `suggestPaths(Astro.url.pathname, buildSiteIndex(...))`.
- Never echo the raw path back. Read nothing but the path (no query string, headers or cookies).
- Keep the existing `navLinks()` derivation. Add a "Search the site" button that opens the palette pre-filled.

**Must not touch:** `Nav.astro` and the layouts (C binds to the hooks E renders).

**Acceptance**
- ⌘K, Ctrl+K and `/` open the palette on both shells.
- Typing `/` in Regex Lab, Type Trial or Draftboard never opens it.
- `?` on the webhook inspector page shows its page shortcuts.

**Smoke assertions (mutation in brackets)**
- Driving the `search.json` handler with item A's fixtures: its paths equal the sitemap's, it never lists `/tools/kit`, and every entry passes `safeInternalPath` (let a draft article through).
- No `innerHTML` or `insertAdjacentHTML` in the palette or sheet sources (add one).
- A truth table for `shouldHandleGlobalKey` (drop the typing-target guard).
- `404.astro` reads only `Astro.url.pathname`, uses no `set:html`, and takes suggestions from `buildSiteIndex` (make it read `Astro.url.search`).

**AGENTS.md:** a new "Command palette & shortcuts" section, plus Security bullets for the 404 (depends on the path only, cached 300s) and for `search.json`.

### D. Toolkit (strong model for the route; the UI is medium)

**Owns**
- `/home/user/apanjwani0.com/src/lib/kit-ui.ts`: binds the stars, renders the /tools shelf from the SSR cards' own data, syncs across tabs.
- New `/home/user/apanjwani0.com/src/pages/tools/kit.astro` and `src/styles/kit.css`.
- `RESERVED_TOOL_SLUGS` in `src/lib/tools.ts`, with `config-schema.ts` rejecting reserved slugs.
- `src/lib/toast.ts`.

**Kit page**
- Base layout, `noindex`, `canonicalPath="/tools"`, not in the site index.
- It parses the list with `parseKitParam(searchParams.get('t'), liveSlugs)`.
- A non-canonical query (duplicates, junk, extra params) gets a 302 to the canonical `?t=`, with its own `Cache-Control: public, max-age=0, s-maxage=600`.
- The launcher is server-rendered and works without JS.
- Buttons: Save this kit (add or replace), Copy kit link, a drag-to-bookmarks link (a plain https link, never a `javascript:` bookmarklet), and Download bookmarks file (a Blob of type `text/html;charset=utf-8`, saved as `apanjwani0-tools.html`).

**Must not touch:** `tools/index.astro` and `tools/[slug].astro`. F and E render the hooks D binds to.

**Acceptance**
- A star on a card and on a detail page stay in sync, including across tabs.
- The shelf appears without layout shift; `html[data-kit]` reserves its height.
- The cached /tools HTML is identical for every visitor.
- The bookmarks file imports into Chrome, Firefox, Safari and Edge as a folder named "apanjwani0 tools".

**Smoke assertions (mutation in brackets)**
- Every file in `src/pages/tools/` other than `[slug]` and `index` is a reserved name or `driftfield`; no config tool uses a reserved slug; `validateConfigData` rejects `kit` (remove that check).
- `kit.astro` uses `parseKitParam`, `noindex` and `canonicalPath` (replace the parser with a bare `split`).
- `kit-ui.ts` makes no `fetch` calls.

**AGENTS.md:** a "Toolkit" section, plus Security bullets: output depends only on the query, the parse is bounded, and `kit` is a reserved route.

### E. Shells, nav, motion, home seam (strong model)

**Owns**
- `Nav.astro`. On desktop, the palette trigger (with a ⌘K hint) and the theme toggle go in the empty third column. At 640px and below it's a single row: wordmark, search, theme, and a menu using Oat's `ot-dropdown` with `role=menuitem` links.
- The nav, shell, motion and `a`-rule regions of `shared.css`. The `a` rule moves here and ToolBase's own `<style is:global>` block is deleted.
- `Breadcrumbs.astro`, `RelatedLinks.astro` (its `inset` means workbench width) and `seo-support.css`.
- `tools/[slug].astro` (detail-actions markup, including the kit star) and `games/[slug].astro` (drop `inset`, add the dock).
- `driftfield/[mode].astro`, `type-trial.css:1-4` (delete).
- `index.astro` and `home.css`: remove the Avatar from the hero, delete `Avatar.astro`, use `site.avatar` in the JSON-LD.
- `src/lib/motion.ts`.

**Width contract**
- Workbench (`--tool-width`): tool pages. Breadcrumb, tool, related links and SEO copy share one left edge.
- Stage (`--max-width` plus gutter): game pages and Driftfield modes.
- Prose (42rem): articles.
- Wide (`--content-width`): hubs and the kit page.
- A rule in `shared.css` lays out an unmounted `[data-tool]` element exactly like the mounted workbench, which removes the jump at mount.

**Detail rhythm**
- Order: breadcrumb → h1 → lede → actions.
- On tool and game pages the component renders its own header, so `motion.ts` moves `[data-dock]` into place right after the h1's block, using a bounded MutationObserver (the same reason `mountEmbed` uses one). If that fails, the actions stay after the component.

**Motion**
- `@view-transition{navigation:auto}` sits inside `@media (prefers-reduced-motion:no-preference)`; reduced motion switches off all `::view-transition-*` animation.
- The source card is tagged on `astro:before-preparation` (ClientRouter navigations) and on `pageswap` (full-page navigations).
- Tool and game card links get `data-astro-reload`, which removes the double load and lets the cross-document transition run.
- Hover lift and glow come from the new tokens.

**Home seam**
- `<star-field>` stays the default hero background.
- The future hero will be one custom element inside `section[data-type="hero"]`, mounted from `index.astro`'s own script on `astro:page-load`. It sets `starfield={false}`, subscribes to `onThemeChange` and respects reduced motion.

**Smoke assertions (mutation in brackets)**
- The root-width check covers every component that renders `tool-page`, including games (re-add the 760px).
- Bare `a` and `a:hover` rules are equal across shells and live only in `shared.css` (re-add the ToolBase block).
- `view-transition-name` appears only in `shared.css`, each static name once, and `@view-transition` only under no-preference (move it outside the media query).
- `RelatedLinks` uses the workbench width on ToolBase routes (revert it).

**AGENTS.md:** Key Conventions — the width contract, the actions dock, view transitions vs ClientRouter, and the home hero seam.

### F. Hubs, thumbnails, share cards (medium model; the thumbs script suits a small model)

**Owns**
- Hub pages: `tools/index.astro`, `games.astro`, `projects.astro`, `learnings.astro`, `driftfield/index.astro`, `ProjectCard.astro`.
- Styles: `tools.css`, the hub rules in `global.css`, the card region of `shared.css`.
- `daily-streak-strip.ts`.
- Share cards: `og.ts`, `generate-og.mjs` (a `CHROME_PATH` env variable plus the site card), `public/og/site-home.png`.
- Thumbnails: new `/home/user/apanjwani0.com/scripts/generate-thumbs.mjs` (sharp only, eligibility taken from `og.ts`) and `public/og/thumbs/*.webp` at 320w and 640w.
- `package.json`: a `thumbs` script, and `sharp` declared as a devDependency pinned to the existing override (0.35.3).

**Card anatomy (in `shared.css`)**
- `card-thumb` comes first in the DOM, so the stretched link covers it. It has width/height attributes, an `aspect-ratio`, and a srcset; it loads lazily except on the first row.
- Then `card-head` (title, badges, kit star), then `card-desc` (clamped to 3 lines), then `card-meta`.
- Card titles use `--text-card` with `text-wrap: balance`.
- Learnings cards get a small header line, "date · N min read", at `--text-xs`, with the minutes from `readingTime()`.
- Project cards show the first paragraph, put the rest in a `<details>`, and show a visible repo link.
- The rule that raises secondary links above the stretched link now also covers `button` and `summary`.
- Hubs switch to the shared `badge` markup. The kit shelf and the stars are rendered following item A's DOM contract.

**Site card:** the share-image fallback becomes `/og/site-home.png` (1200×630, `summary_large_image`) when the file exists; the avatar becomes the last resort.

**Smoke assertions (mutation in brackets)**
- Every item that gets a share card has the PNG and both thumbnails; there are no orphan thumbnails; the WebP header dimensions match; each file is under a byte ceiling of about 1.25× the measured maximum (delete one thumbnail / add one for a wip tool).
- The raise rule covers `summary` (drop it).
- The share-image fallback returns the site card (point it back at the avatar).
- Keep the existing `tool.status === 'live' && isServerTool(tool.slug)` guard and the "four need a real server" check; update the `writing-date` guard if that class is renamed.

**AGENTS.md:** Share cards (site card, thumbnails, `npm run thumbs`) and the card anatomy.

### G. One control kit (medium to strong model)

**Owns**
- New `/home/user/apanjwani0.com/src/styles/controls.css`, imported at the top of `shared.css`.
- Declarations only (never selectors) in `tools-common.css`, `games-common.css`, `canvas-export.css` and the per-tool and per-game sheets.

**Method: tokens first, selectors frozen**
- Every selector keeps its specificity and source order. That preserves the `tools-common.css` promise that its specificity is byte-identical, the games floor at (0,1,1), and the tab opt-outs at (0,2,1) and (0,3,1).
- Declared values become `var(--control-*)` and `var(--tab-*)`. Per-game copies that end up identical to the floor get deleted.
- The resulting kit: mono outline by default, one pressed look, an accent-filled primary, underline tabs, and `--opacity-disabled`.
- New site chrome (palette, kit, nav, shortcut sheet) uses the `controls.css` primitives at `:where()` (zero) specificity.
- The badge rules move here. Optionally, drop `border-radius` from the focus rules.

**Smoke assertions (mutation in brackets)**
- One dialect: any rule whose last compound selector targets `button` or `[role="tab"]` may set font-family, font-size, padding or border-radius only through a `var(--control-*|--tab-*)` (set the games floor back to serif).
- Only `controls.css` styles `badge`, and no `*-badge` data-types remain (re-add `game-badge`).
- The existing hover/disabled derivations for the lane floors stay green.
- The accent-fill regex follows the primary variant to its new location.

**AGENTS.md:** replace the "One disabled treatment" and lane-floor bullets with a single "One control kit" bullet.

### Visual checks, every item
- Playwright at 1440×900 and 390×844, in both themes (set via localStorage, then toggled live) and with reduced motion emulated.
- Test by clicking in-site links (hub → detail → breadcrumb → back), not by reloading, so `astro:page-load` mounting is exercised.
- One keyboard-only pass.

## 4. Risks and gotchas
- **Only one inline script.** The head bootstrap is the only inline executable script, and it's byte-identical on every page. Never add another: ClientRouter would re-insert it with a nonce the live CSP rejects. `script-src-attr 'none'` also rules out inline handlers.
- **Duplicate transition names.** Duplicate `view-transition-name`s abort the transition. Base→Base navigations are same-document (router); anything touching a ToolBase page or a page with `clientRouter={false}` is cross-document. Test both directions and bfcache back. Browsers without support just navigate normally.
- **Theme on ClientRouter swaps.** If the `before-swap` patch is missing, every Base navigation flashes dark.
- **Oat.**
  - Its `light-dark()` tokens need `color-scheme` pinned per theme.
  - The token bridge restyles Oat-default tablists and inputs, so sweep every tool.
  - Oat converts `[title]` into tooltips only on the first `<body>`, so it stops working after ClientRouter navigation; set `aria-label` explicitly.
  - Oat's `@layer base` button styles hit any new button the kit doesn't fully style.
- **Edge caching.** Stars, the shelf, streaks and the theme are client-only. The kit page, `search.json` and the 404 depend only on the URL plus config.
- **`@import` ordering.** `@import` must come before every other rule, so `controls.css` lands before `:focus-visible`. The card block must stay after `:focus-visible`; this is already asserted.
- **`astro check` vs build.** Never put JSX comments between attributes, never put tag-like text in comments inside a script that sits in a JSX conditional, and render the bootstrap with `is:inline` + `set:html`. Keep check at 0 errors.
- **Contrast.** A raised surface only works with the muted nudge. Muted text is never allowed on accent-soft. Every new colour pairing goes into the pairing list.
- **Concurrent branch.** Start A only after the concurrent branch merges; it touches `games.astro`, `learnings/[slug].astro`, `AGENTS.md`, `security-smoke.mjs` and possibly `middleware.ts`. The anchor regions in the smoke file and AGENTS.md keep later merges trivial.
- **Light theme thumbnails.** The OG thumbnails are dark artwork, so on light cards they need a border.
- **Kit URLs.** Canonical redirects collapse junk query variants. noindex plus a canonical is a mixed signal to Google; noindex wins, which is acceptable here.

## 5. Order and model fit
1. The concurrent branch merges first.
2. **A** runs alone (strong model).
3. **B–G** are built in parallel worktrees off A, then merged in the order G → F → E → D → C → B, each rebasing on the last. D needs F's and E's hooks, and C needs E's nav hooks.
4. A final pass updates `ARCHITECTURE.md`, runs `npm run graph`, and runs the full gate plus the Playwright sweep.

- **Strong model:** A, C, E, and D's route.
- **Medium:** F and G.
- **Small, with review:** B, the thumbs script, and the per-hub markup.

### Critical Files for Implementation
- /home/user/apanjwani0.com/src/styles/theme.css
- /home/user/apanjwani0.com/src/styles/shared.css
- /home/user/apanjwani0.com/src/components/Head.astro
- /home/user/apanjwani0.com/src/pages/sitemap.xml.ts (to be refactored onto the new site-index.ts)
- /home/user/apanjwani0.com/scripts/security-smoke.mjs