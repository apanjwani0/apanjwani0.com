/**
 * Theme toggle UI — item B fills this in.
 *
 * Binds `button[data-action="theme"]` (rendered by Nav.astro, item E) to the
 * dark → light → system cycle (`nextThemePref` + `setThemePref` in
 * src/lib/theme.ts), and keeps its aria-label naming the current and the next
 * theme. Called once per document from `initSiteUI()` (src/lib/site-ui.ts).
 * The nav button survives no ClientRouter swap, so bind by delegation on
 * `document` or re-bind on `astro:page-load`, never per mount without a
 * removal — security:smoke derives that rule over every client module.
 */
export function initThemeUI(): void {}
