/* Asset Finder PWA service worker */
const CACHE_NAME = 'asset-finder-pwa-v3.8.3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.png',
  './icon-192.png',
  './icon-512.png',
  './logo.png',
  './header-rail-bg.png',
  './ogrt-logo.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('message', event => {
  if(event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith('asset-finder-pwa-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache Supabase/API requests: inventory, approvals, removals and reports
  // must always use the live backend.
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) return;

  // Navigation: prefer the live page, but fall back to the cached app shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Local app assets: cache-first, with a live network fallback.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      }))
    );
  }
});
