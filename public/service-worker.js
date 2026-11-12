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
              console.error('Could not cache the Isomo Support app shell.', error)
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
              console.error('Could not cache an Isomo Support app asset.', error)
            }
          }
          return response
        } catch (error) {
          console.warn('Using the cached Isomo Support app asset while offline.', error)
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
              console.error('Could not cache a static Isomo Support asset.', error)
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

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data?.json() ?? {}
  } catch (error) {
    console.error('A push notification payload could not be read.', error)
  }
  if (!payload || typeof payload !== 'object') payload = {}
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (windows.some((client) => client.visibilityState === 'visible')) return
    const title = typeof payload.title === 'string' ? payload.title : 'Isomo Support'
    const body = typeof payload.body === 'string' ? payload.body : 'You have a new message.'
    const url = typeof payload.url === 'string' && payload.url.startsWith('/')
      ? payload.url
      : '/?section=inbox'
    await self.registration.showNotification(title, {
      body,
      icon: '/icons/isomo-tea-icon-192.png',
      badge: '/icons/isomo-tea-icon-192.png',
      tag: typeof payload.tag === 'string' ? payload.tag : 'isomo-message',
      data: { url },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url
  if (typeof url !== 'string' || !url.startsWith('/')) return
  event.waitUntil((async () => {
    const target = new URL(url, self.location.origin).href
    if (new URL(target).origin !== self.location.origin) return
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.focus()
        if ('navigate' in client) await client.navigate(target)
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})
