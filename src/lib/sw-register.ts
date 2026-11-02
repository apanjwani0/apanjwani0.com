/**
 * Registers the offline-page service worker (public/sw.js) once the page has
 * loaded. Importing this module is the whole API, so a layout needs one import line.
 * It does nothing in dev, where a worker would hold on to stale files, or in a
 * browser without service workers, and a failed registration is silent: the site
 * works the same without it.
 */
function register(): void {
  try {
    void navigator.serviceWorker.register('/sw.js').catch(() => {})
  } catch {
    // Blocked by the browser or the context (private mode, insecure origin).
  }
}

if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
