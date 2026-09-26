/**
 * Site chrome bootstrap, shared by both shells (Base.astro and ToolBase.astro
 * call `initSiteUI()` from their module script).
 *
 * Wires, once per document:
 *  - `astro:before-swap` → `patchIncomingDocument`, so a ClientRouter swap
 *    keeps the visitor's theme, `data-js` and `data-kit` instead of resetting
 *    `<html>` to the incoming page's SSR attributes (src/lib/theme.ts).
 *  - `watchThemePref`, so the page follows a preference changed in another
 *    tab, by the OS while it is `system`, or before a back/forward restore.
 *  - the four feature entry points, each owned by one item of the UI refresh:
 *    `initThemeUI` (B), `initFindUI` (C), `initKitUI` (D), `initMotion` (E).
 *
 * The module script runs once per ClientRouter session (bundled scripts are
 * not re-run on in-site navigation) and once per full load on ToolBase pages,
 * so everything here registers against `document`/`window` exactly once,
 * behind the guard. Per-page work belongs in an `astro:page-load` listener
 * inside the feature module, not here.
 */
import { patchIncomingDocument, watchThemePref } from './theme'
import { initThemeUI } from './theme-ui'
import { initFindUI } from './find-ui'
import { initKitUI } from './kit-ui'
import { initMotion } from './motion'

let wired = false

function onBeforeSwap(event: Event): void {
  const incoming = (event as Event & { newDocument?: Document }).newDocument
  if (incoming) patchIncomingDocument(incoming)
}

export function initSiteUI(): void {
  if (wired) return
  wired = true
  document.addEventListener('astro:before-swap', onBeforeSwap)
  watchThemePref()
  initThemeUI()
  initFindUI()
  initKitUI()
  initMotion()
}
