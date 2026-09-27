/**
 * Find UI — item C fills this in: the ⌘K command palette, the `/` search
 * shortcut and the `?` shortcut sheet.
 *
 * Reads `shouldHandleGlobalKey` / `matchGlobalShortcut` (src/lib/shortcuts.ts)
 * for which keys are its, fetches the index from /search.json on first open,
 * scores with `fuzzyScore` (src/lib/fuzzy.ts), and binds
 * `button[data-action="palette"]` and `button[data-action="shortcuts"]`
 * (rendered by Nav.astro, item E). Called once per document from
 * `initSiteUI()` (src/lib/site-ui.ts). Must never import
 * `astro:transitions/client`: this module loads on ToolBase pages too, and
 * that import would pull the router onto them.
 */
export function initFindUI(): void {}
