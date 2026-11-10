/* ============================================================
   NotePDF — Service Worker
   Offline-first with stale-while-revalidate
   ============================================================ */

const CACHE_VERSION = 'notepdf-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './pdf.svg',
  './pdf.png',
  './pdf-192.png',
  './pdf-512.png',
  './pdf-512-maskable.png',
  './apple-touch-icon.png'
];

const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/arabic-persian-reshaper@1.0.1/+esm',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/amiri/Amiri-Regular.ttf',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/amiri/Amiri-Bold.ttf'
];

/* ---------- INSTALL ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);

    // App shell — cache each URL individually so one 404 doesn't kill install
    await Promise.all(APP_SHELL.map(async (url) => {
      try {
        const req = new Request(url, { cache: 'reload' });
        const res = await fetch(req);
        if (res && res.ok) await cache.put(url, res);
      } catch (e) {
        console.warn('[SW] Shell cache miss:', url, e.message);
      }
    }));

    // CDN assets — best effort, non-blocking
    await Promise.all(CDN_ASSETS.map(async (url) => {
      try {
        const req = new Request(url, { mode: 'cors', credentials: 'omit' });
        const res = await fetch(req);
        if (res && res.ok) await cache.put(req, res);
      } catch (e) {
        console.warn('[SW] CDN cache miss:', url, e.message);
      }
    }));

    self.skipWaiting();
  })());
});

/* ---------- ACTIVATE ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k !== CACHE_VERSION && k.startsWith('notepdf-'))
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* ---------- FETCH ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only GET requests
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip non-http(s) — chrome-extension, blob:, data:, etc.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Skip cross-origin requests that aren't in our CDN list (e.g. analytics)
  const isSameOrigin = url.origin === self.location.origin;
  const isKnownCDN = CDN_ASSETS.some(u => url.href.startsWith(u.split('?')[0])) ||
                     url.hostname === 'cdnjs.cloudflare.com' ||
                     url.hostname === 'cdn.jsdelivr.net';
  if (!isSameOrigin && !isKnownCDN) return;

  // Navigation requests — network-first, fall back to cached shell
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE_VERSION);
          cache.put('./index.html', res.clone()).catch(() => {});
        }
        return res;
      } catch (_) {
        const cached =
          (await caches.match(req)) ||
          (await caches.match('./index.html')) ||
          (await caches.match('./'));
        return cached || new Response(
          '<!doctype html><title>Offline</title><h1>You are offline</h1><p>NotePDF will reload when you reconnect.</p>',
          { status: 503, headers: { 'Content-Type': 'text/html' } }
        );
      }
    })());
    return;
  }

  // Everything else — cache-first, update in background
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: false });
    if (cached) {
      // Background refresh (stale-while-revalidate)
      fetch(req).then(async (res) => {
        if (res && res.ok) {
          const cache = await caches.open(CACHE_VERSION);
          cache.put(req, res).catch(() => {});
        }
      }).catch(() => {});
      return cached;
    }

    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (_) {
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});

/* ---------- MESSAGE ---------- */
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});
