/**
 * OceanZ Gaming Cafe - Service Worker
 * Network-first for app shell so deploys show up; cache for offline fallback.
 */

const CACHE_NAME = 'oceanz-v4-cafe';
const OFFLINE_URL = '/offline.html';

// Core assets to cache (only essential files)
const PRECACHE_ASSETS = [
  '/offline.html',
  '/assets/icons/icon.svg',
  '/assets/icons/admin-icon.svg'
];

// Optional assets to cache (won't fail if missing)
const OPTIONAL_ASSETS = [
  '/member/login.html',
  '/member/dashboard.html',
  '/admin/index.html',
  '/admin/dashboard.html',
  '/shared/config.js',
  '/shared/utils.js',
  '/shared/leaderboard.js',
  '/shared/notify.js',
  '/manifest.webmanifest',
  '/admin/manifest.webmanifest'
];

function isAppShellRequest(url) {
  const path = url.pathname || '';
  return (
    path.endsWith('.html') ||
    path.endsWith('.js') ||
    path.endsWith('.css') ||
    path.endsWith('.webmanifest') ||
    path.includes('/admin/') ||
    path.includes('/shared/') ||
    path.includes('/member/') ||
    path.includes('/assets/css/')
  );
}

// Helper: Cache assets gracefully (skip failures)
async function cacheAssets(cache, assets, required = false) {
  const results = await Promise.allSettled(
    assets.map(async url => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (response.ok) {
          await cache.put(url, response);
          return { url, success: true };
        }
        throw new Error(`HTTP ${response.status}`);
      } catch (err) {
        if (required) throw err;
        console.warn(`[SW] Failed to cache (skipping): ${url}`);
        return { url, success: false };
      }
    })
  );
  return results;
}

// Install event - precache assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        console.log('[SW] Precaching assets', CACHE_NAME);

        try {
          await cacheAssets(cache, PRECACHE_ASSETS, true);
        } catch (err) {
          console.warn('[SW] Some core assets missing, continuing...');
        }

        await cacheAssets(cache, OPTIONAL_ASSETS, false);
        console.log('[SW] Precaching complete');
      })
      .then(() => self.skipWaiting())
      .catch(err => {
        console.error('[SW] Install failed:', err);
        self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch - network-first for app shell (so Floor Monitor etc. deploys appear),
// cache-first only for static icons / offline page.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  if (event.request.url.includes('firebasedatabase.app') ||
      event.request.url.includes('googleapis.com/identitytoolkit')) {
    return;
  }

  const url = new URL(event.request.url);
  const networkFirst = isAppShellRequest(url);

  if (networkFirst) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok && (response.type === 'basic' || response.type === 'cors')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match(OFFLINE_URL);
          }
          return Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          event.waitUntil(
            fetch(event.request)
              .then(response => {
                if (response.ok) {
                  caches.open(CACHE_NAME)
                    .then(cache => cache.put(event.request, response));
                }
              })
              .catch(() => {})
          );
          return cachedResponse;
        }

        return fetch(event.request)
          .then(response => {
            if (response.ok && response.type === 'basic') {
              const responseToCache = response.clone();
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, responseToCache));
            }
            return response;
          })
          .catch(() => {
            if (event.request.headers.get('accept')?.includes('text/html')) {
              return caches.match(OFFLINE_URL);
            }
          });
      })
  );
});

// Background sync for bookings (when back online)
self.addEventListener('sync', event => {
  if (event.tag === 'sync-bookings') {
    event.waitUntil(syncBookings());
  }
});

async function syncBookings() {
  console.log('[SW] Syncing bookings...');
}

// Push notifications
self.addEventListener('push', event => {
  const options = {
    body: event.data?.text() || 'New notification from OceanZ',
    icon: '/assets/icons/icon-192.png',
    badge: '/assets/icons/icon-72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      { action: 'explore', title: 'View Details' },
      { action: 'close', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('OceanZ Gaming', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/member/dashboard.html')
    );
  }
});
