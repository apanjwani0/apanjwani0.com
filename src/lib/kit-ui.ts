/**
 * Kit UI — item D fills this in: the `button[data-type="kit-star"]` stars,
 * the `section[data-type="kit-shelf"]` on /tools, and cross-tab sync.
 *
 * All state goes through src/lib/kit.ts (`readKit`, `toggleKit`,
 * `onKitChange`), which also keeps `html[data-kit]` current. Makes no network
 * request: the kit lives in the visitor's browser, and the cached /tools HTML
 * is identical for everyone. Called once per document from `initSiteUI()`
 * (src/lib/site-ui.ts).
 */
export function initKitUI(): void {}
