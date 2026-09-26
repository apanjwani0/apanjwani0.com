/**
 * Motion — item E fills this in: view-transition source tagging and the
 * detail-page actions dock.
 *
 * The contract it implements: `vt-title` is the page h1 (a static rule in
 * shared.css) and, during a navigation, the clicked card's
 * `[data-type="card-title"]` — while a card holds the name,
 * `html[data-vt-source]` clears the source page's own h1, because two
 * elements with one view-transition-name abort the transition. `vt-nav` is the
 * fixed nav; `vt-thumb` is optional. The source is tagged on
 * `astro:before-preparation` (ClientRouter) and `pageswap` (cross-document).
 * `div[data-type="detail-actions"][data-dock]` is moved to sit after the h1's
 * block. `prefers-reduced-motion: reduce` switches all of it off. Called once
 * per document from `initSiteUI()` (src/lib/site-ui.ts).
 */
export function initMotion(): void {}
