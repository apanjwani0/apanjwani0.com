/**
 * Find UI — item C fills this in: the ⌘K command palette, the `/` search
 * shortcut and the `?` shortcut sheet.
 *
 * Planned: it owns its keys (`/` and `?` never fire from a typing target;
 * ⌘K/Ctrl+K works everywhere except inside `[data-keys="own"]`; a first draft
 * of that module, src/lib/shortcuts.ts, is in git history), fetches the index
 * from /search.json (not built yet) on first open, scores with `fuzzyScore`
 * (src/lib/fuzzy.ts), and binds
 * `button[data-action="palette"]` and `button[data-action="shortcuts"]`
 * (rendered by Nav.astro, item E). Called once per document from
 * `initSiteUI()` (src/lib/site-ui.ts). Must never import
 * `astro:transitions/client`: this module loads on ToolBase pages too, and
 * that import would pull the router onto them.
 */
export function initFindUI(): void {}
