// EDEN service worker.
//  * push notifications (shows them, opens EDEN when one is clicked)
//  * offline use: the app itself is kept so EDEN opens without a network, and the last answers of the read-only data
//    requests and the map tiles you looked at are kept, so you can still read your property, plants, tasks and the map.
//    Nothing is sent anywhere and nothing is written offline here: changes are saved by the page when the server is back.
//  * data that is private or large is never kept: sign-in, admin, camera pictures and streams, documents and downloads.
const VERSION = 'eden-v1.3.0'
const SHELL = `${VERSION}-shell`   // the app: page, scripts, styles, icons
const DATA = `${VERSION}-data`     // answers of GET /api/... requests
const TILES = `${VERSION}-tiles`   // map tiles
const MAX_TILES = 800
const MAX_DATA = 300

// live data is never kept: an old door or heating state, or an old forecast, shown offline would look current
const NEVER = /^\/api\/(auth|admin|push|cameras\/.*\/(snapshot|stream)|onvif|smart|devices|weather)|\/(snapshot|stream|download|export|backup|file|files|photo)(\/|$|\?)|^\/api\/(documents|uploads)\/.*\/(content|file)/i
const TILE = /\/(tiles?|tile)\/|\/api\/library\/picture-file\/|\/\d{1,2}\/\d+\/\d+(\.(png|jpe?g|webp|pbf))?(\?|$)/i

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL)
    await c.addAll(['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png'])
    // every built file (written by the build), so the whole app opens offline, including pages that load on demand
    try {
      const files = await (await fetch('/asset-manifest.json', { cache: 'no-cache' })).json()
      if (Array.isArray(files)) await Promise.allSettled(files.filter((f) => typeof f === 'string' && f.startsWith('/assets/')).map((f) => c.add(f)))
    } catch { /* offline install attempt or an old build: files are then kept as they are first used */ }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k)
    await self.clients.claim()
  })())
})

async function trim(name, max) {
  const c = await caches.open(name)
  const keys = await c.keys()
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]) // oldest first
}

async function networkFirst(req, cacheName, max) {
  const cache = await caches.open(cacheName)
  try {
    const res = await fetch(req)
    if (res.ok && res.status === 200) { cache.put(req, res.clone()).then(() => trim(cacheName, max)).catch(() => undefined) }
    return res
  } catch (err) {
    const hit = await cache.match(req)
    if (hit) return hit
    throw err
  }
}

async function cacheFirst(req, cacheName, max) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok && (res.status === 200 || res.type === 'opaque')) { cache.put(req, res.clone()).then(() => max && trim(cacheName, max)).catch(() => undefined) }
  return res
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const same = url.origin === self.location.origin
  if (same && url.pathname === '/sw.js') return
  // the page itself: network first, the saved copy when offline
  if (req.mode === 'navigate' && same) {
    e.respondWith(fetch(req).then((res) => { if (res.ok) caches.open(SHELL).then((c) => c.put('/', res.clone())); return res })
      .catch(() => caches.open(SHELL).then((c) => c.match('/')).then((r) => r || Response.error())))
    return
  }
  if (same && url.pathname.startsWith('/assets/')) { e.respondWith(cacheFirst(req, SHELL)); return } // hashed file names never change
  if (same && /^\/(icons\/|favicon\.svg|manifest\.webmanifest)/.test(url.pathname)) { e.respondWith(cacheFirst(req, SHELL)); return }
  if (same && url.pathname.startsWith('/api/')) {
    if (NEVER.test(url.pathname) || req.headers.has('range')) return
    if (TILE.test(url.pathname)) { e.respondWith(cacheFirst(req, TILES, MAX_TILES)); return } // /api/tiles/... keyed providers
    e.respondWith(networkFirst(req, DATA, MAX_DATA))
    return
  }
  if (!same && TILE.test(url.pathname) && req.destination !== 'script') { e.respondWith(cacheFirst(req, TILES, MAX_TILES).catch(() => Response.error())) }
})

// the page asks for this when you sign out, so a shared device keeps nothing of your property
self.addEventListener('message', (e) => {
  if (e.data === 'clear-user-data') e.waitUntil(Promise.all([caches.delete(DATA), caches.delete(TILES)]))
})

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(d.title || 'EDEN Smart Estate', {
    body: d.body || '', tag: d.tag || 'eden', icon: '/icons/icon-192.png', badge: '/favicon.svg', data: { url: d.url || '/' },
  }))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.startsWith(self.location.origin) && 'focus' in c) { c.navigate(url).catch(() => undefined); return c.focus() } }
    return self.clients.openWindow(url)
  }))
})
