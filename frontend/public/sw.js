const APP_SHELL_CACHE = 'app-shell-v1'
const PRECACHE_URLS = [
  '/index.html',
  ...self.__WB_MANIFEST.map((entry) =>
    typeof entry === 'string' ? entry : entry.url,
  ),
]

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

  event.respondWith((async () => {
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
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html')
      }
      return new Response('Offline', {
        status: 503,
        statusText: 'Service Unavailable',
      })
    }
  })())
})
