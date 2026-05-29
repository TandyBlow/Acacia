const APP_SHELL_CACHE = 'app-shell-v2'
const PRECACHE_URLS = [...new Set(
  self.__WB_MANIFEST.map((entry) => {
    let url = typeof entry === 'string' ? entry : entry.url
    if (url.startsWith('/')) url = url.slice(1)
    return url
  }),
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
          .filter((key) => key.startsWith('app-shell-') && key !== APP_SHELL_CACHE)
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

  const isDev = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1'
  if (isDev) {
    event.respondWith(fetch(event.request))
    return
  }

  event.respondWith((async () => {
    // Network-first for everything: always try the network first,
    // fall back to cache only when offline. This ensures users always
    // get the latest assets after a deploy.
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
