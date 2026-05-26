const APP_SHELL_CACHE = 'app-shell-v1'
const PRECACHE_URLS = [...new Set(
  self.__WB_MANIFEST.map((entry) =>
    typeof entry === 'string' ? entry : entry.url,
  ),
)]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS)
    }),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== APP_SHELL_CACHE)
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  // Network-first for navigation (HTML) so the user always gets the latest
  // index.html pointing at fresh content-hashed assets. Cache-first for
  // everything else (immutable JS/CSS/fonts/images — new build = new hash).
  const isNav = event.request.mode === 'navigate'

  event.respondWith((async () => {
    if (isNav) {
      try {
        const networkResponse = await fetch(event.request)
        if (networkResponse && networkResponse.status === 200) {
          const cache = await caches.open(APP_SHELL_CACHE)
          await cache.put(event.request, networkResponse.clone())
        }
        return networkResponse
      } catch {
        const cachedResponse = await caches.match(event.request)
        if (cachedResponse) return cachedResponse
        return caches.match('/index.html')
      }
    }

    // Cache-first for non-navigation requests
    const cachedResponse = await caches.match(event.request)
    if (cachedResponse) {
      return cachedResponse
    }

    try {
      const networkResponse = await fetch(event.request)
      if (
        networkResponse &&
        networkResponse.status === 200 &&
        event.request.url.startsWith(self.location.origin)
      ) {
        const cache = await caches.open(APP_SHELL_CACHE)
        await cache.put(event.request, networkResponse.clone())
      }
      return networkResponse
    } catch {
      return new Response('Offline', {
        status: 503,
        statusText: 'Service Unavailable',
      })
    }
  })())
})
