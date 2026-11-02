/*
 * Offline page service worker. Two rules, and nothing else:
 *   1. It handles page navigations only (request.mode === 'navigate'). Scripts,
 *      styles, images, API calls and everything else go straight to the network.
 *   2. It never caches HTML. The one file it keeps is /offline.html, stored at
 *      install and shown only when the network request for a page fails.
 * HTML stays uncacheable on purpose (AGENTS.md, Caching): a purge must reach everyone.
 * No push, no sync, no clients.claim; a new version waits until old tabs close.
 */
const CACHE = 'offline-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', event => {
  // `reload` skips the browser's HTTP cache so the stored copy is the current file.
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))))
})

self.addEventListener('activate', event => {
  // Drop every cache this worker did not name, so an old version's page cannot linger.
  event.waitUntil(
    caches.keys().then(names => Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name)))),
  )
})

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL, { cacheName: CACHE })))
})
