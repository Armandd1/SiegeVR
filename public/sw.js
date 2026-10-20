// AR Asztali Ostrom - PWA Service Worker (V1)
const CACHE_NAME = 'ar-ostrom-v1';

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

// Lekérések kiszolgálása: Stale-While-Revalidate stratégia
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Csak GET kéréseket gyorsítótárazunk, és kihagyjuk a chrome-extension és egyéb sémákat
  if (req.method !== 'GET' || !req.url.startsWith('http')) {
    return;
  }

  // Navigációs (HTML) kérések: Network-first -> Cache fallback az azonnali frissülésekért
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return networkRes;
        })
        .catch(() => {
          return caches.match('/') || caches.match('/index.html');
        })
    );
    return;
  }

  // Statikus fájlok, képek, betűtípusok: Cache-first -> Network frissítés a háttérben
  event.respondWith(
    caches.match(req).then((cachedRes) => {
      if (cachedRes) {
        // Háttérben lekérjük az esetleges friss verziót
        fetch(req).then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, networkRes));
          }
        }).catch(() => {});
        return cachedRes;
      }

      return fetch(req).then((networkRes) => {
        if (!networkRes || networkRes.status !== 200 || networkRes.type !== 'basic') {
          return networkRes;
        }
        const resClone = networkRes.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return networkRes;
      }).catch((err) => {
        // Hálózati hiba esetén üres válasz vagy offline fallback
        return cachedRes;
      });
    })
  );
});
