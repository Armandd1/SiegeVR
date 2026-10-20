// AR Asztali Ostrom - PWA Service Worker (V4)
const CACHE_NAME = 'ar-ostrom-v4';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png'
];

// Telepítés: Core app shell gyorsítótárazása
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('PWA Precache részleges figyelmeztetés:', err);
      });
    })
  );
});

// Aktiválás: Régi gyorsítótárak törlése
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Lekérések kiszolgálása: Network-First stratégia (mindig a legfrissebb kód fut le, offline fallback-kel)
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Csak GET kéréseket gyorsítótárazunk, és kihagyjuk a nem-http(s) sémákat
  if (req.method !== 'GET' || !req.url.startsWith('http')) {
    return;
  }

  // Network-First: Elsődlegesen a friss hálózati választ kérjük el
  event.respondWith(
    fetch(req)
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return networkRes;
      })
      .catch(() => {
        // Hálózati hiba vagy offline állapot esetén a gyorsítótárból szolgáljuk ki
        return caches.match(req).then((cachedRes) => {
          if (cachedRes) return cachedRes;
          if (req.mode === 'navigate') {
            return caches.match('/') || caches.match('/index.html');
          }
        });
      })
  );
});
