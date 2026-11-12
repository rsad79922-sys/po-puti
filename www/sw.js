/* По пути: recovery Service Worker.
   The previous worker cached every navigation as index.html and could hold a
   navigation response open indefinitely. Until an offline strategy is tested
   in WebKit, do not intercept ANY fetches or navigations. */
const LEGACY_CACHE_PREFIX = 'po-puti-shell-';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(key => key.startsWith(LEGACY_CACHE_PREFIX))
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

// No fetch event handler: all pages, scripts and API calls use the network.
// Offline PWA navigation is temporarily disabled to prevent blank screens.
