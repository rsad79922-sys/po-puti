/* Network-first shell. Bump CACHE_NAME whenever the shell release changes.
   API traffic is never intercepted; the new worker activates immediately. */
const CACHE_PREFIX = 'po-puti-shell-';
const CACHE_NAME = CACHE_PREFIX + 'network-first-v4';
const NETWORK_TIMEOUT_MS = 15000;
const SHELL = new Map([
  ['/index.html', ['text/html']],
  ['/offline.html', ['text/html']],
  ['/styles.css', ['text/css']],
  ['/app.js', ['text/javascript', 'application/javascript']],
  ['/config.js', ['text/javascript', 'application/javascript']],
  ['/manifest.webmanifest', ['application/manifest+json', 'application/json']],
  ['/icons/icon-192.png', ['image/png']],
  ['/icons/icon-512.png', ['image/png']],
  ['/icons/icon.svg', ['image/svg+xml']]
]);
const cacheKey = path => new URL(path, self.location.origin).href;

async function fetchComplete(request, path) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Shell network timeout'));
      controller.abort();
    }, NETWORK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(request, {
          cache: 'no-store',
          signal: controller.signal
        });
        if (!response.ok || response.redirected) throw new Error('Invalid shell response');
        const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (path && !SHELL.get(path).includes(type)) throw new Error('Invalid shell content type');
        // Bound the entire download, not only the wait for response headers.
        await response.clone().arrayBuffer();
        return response;
      })(),
      deadline
    ]);
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const required = ['/index.html', '/styles.css', '/app.js', '/offline.html'];
    for (const path of required) {
      const response = await fetchComplete(new Request(cacheKey(path)), path);
      await cache.put(cacheKey(path), response);
    }
    await Promise.all([...SHELL.keys()].filter(path => !required.includes(path)).map(async path => {
      try {
        const response = await fetchComplete(new Request(cacheKey(path)), path);
        await cache.put(cacheKey(path), response);
      } catch { /* Optional asset. */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name =>
      name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME
    ).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(event, path, navigation) {
  try {
    const response = await fetchComplete(event.request, path);
    if (path) {
      // Complete this cache write inside the promise passed to respondWith.
      // Calling waitUntil here, after awaiting fetch(), can be rejected by
      // WebKit because the fetch event's synchronous dispatch has ended. That
      // rejection would enter this catch and turn a good network response into
      // a stale-cache fallback (or an offline error).
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(cacheKey(path), response.clone());
      } catch {
        // Storage/quota failures must not turn a successful network load into an error.
      }
    }
    return response;
  } catch {
    let cached;
    try {
      const cache = await caches.open(CACHE_NAME);
      if (path) cached = await cache.match(cacheKey(path));
      if (!cached && navigation) cached = await cache.match(cacheKey('/offline.html'));
    } catch {
      // Storage can be unavailable, including after eviction.
    }
    if (cached) return cached;
    if (navigation) {
      return new Response('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Нет соединения</title><h1>Нет соединения</h1><p>Не удалось загрузить приложение. Повторите после восстановления сети.</p></html>', {
        status: 503,
        headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}
      });
    }
    // Never substitute HTML for JavaScript, CSS, icons or a manifest.
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  const navigation = request.mode === 'navigate';
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  const shellPath = SHELL.has(path) ? path : null;
  if (!shellPath && !navigation) return;

  // Only / and /index.html share a cache entry. Diagnostic and other pages
  // must never overwrite index.html. Query strings do not duplicate shell files.
  event.respondWith(networkFirst(event, shellPath, navigation));
});
