const CACHE_PREFIX = 'isomo-shell-'
const CACHE_NAME = `${CACHE_PREFIX}v4`
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/chat-wallpaper.svg',
  '/icons/isomo-tea-icon-192.png',
  '/icons/isomo-tea-icon-512.png',
  '/icons/isomo-tea-icon-1536.png',
  '/icons/apple-touch-icon-180.png',
  '/stickers/tea.svg',
  '/stickers/leaf.svg',
  '/stickers/sparkle.svg',
  '/stickers/frog.svg',
  '/stickers/teapot.svg',
  '/stickers/heart.svg',
  '/stickers/herb.svg',
  '/stickers/coffee.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.registration.active ? undefined : self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            try {
              const cache = await caches.open(CACHE_NAME)
              await cache.put('/index.html', response.clone())
            } catch (error) {
              console.error('Could not cache the Isomo Tea app shell.', error)
            }
          }
          return response
        })
        .catch(async () => (await caches.match('/index.html')) ?? Response.error()),
    )
    return
  }

  const url = new URL(request.url)
  if (
    (request.destination === 'script' || request.destination === 'style')
    && /^\/assets\/[^/]+\.(js|css)$/.test(url.pathname)
  ) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          if (response.ok) {
            try {
              const cache = await caches.open(CACHE_NAME)
              await cache.put(request, response.clone())
            } catch (error) {
              console.error('Could not cache an Isomo Tea app asset.', error)
            }
          }
          return response
        } catch (error) {
          console.warn('Using the cached Isomo Tea app asset while offline.', error)
          return (await caches.match(request, { ignoreVary: true })) ?? Response.error()
        }
      })(),
    )
    return
  }

  if (APP_SHELL.includes(url.pathname) || url.pathname.startsWith('/stickers/')) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            try {
              const cache = await caches.open(CACHE_NAME)
              await cache.put(request, response.clone())
            } catch (error) {
              console.error('Could not cache a static Isomo Tea asset.', error)
            }
          }
          return response
        })
        .catch(async () => (await caches.match(request)) ?? Response.error()),
    )
  }
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting())
})
