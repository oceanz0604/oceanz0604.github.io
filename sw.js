/**
 * OceanZ Gaming Cafe - Service Worker
 * Enables offline functionality and caching
 */

const CACHE_NAME = 'oceanz-v2';
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
        console.log('[SW] Precaching assets');
        
        // Cache required assets (will fail install if missing)
        try {
          await cacheAssets(cache, PRECACHE_ASSETS, true);
        } catch (err) {
          console.warn('[SW] Some core assets missing, continuing...');
        }
        
        // Cache optional assets (won't fail if missing)
        await cacheAssets(cache, OPTIONAL_ASSETS, false);
        
        console.log('[SW] Precaching complete');
      })
      .then(() => self.skipWaiting())
      .catch(err => {
        console.error('[SW] Install failed:', err);
        // Still skip waiting to allow updates
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

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip Firebase requests (need fresh data)
  if (event.request.url.includes('firebasedatabase.app') || 
      event.request.url.includes('googleapis.com/identitytoolkit')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Return cached version and update cache in background
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

        // Not in cache - fetch from network
        return fetch(event.request)
          .then(response => {
            // Cache successful responses
            if (response.ok && response.type === 'basic') {
              const responseToCache = response.clone();
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, responseToCache));
            }
            return response;
          })
          .catch(() => {
            // Offline fallback for HTML pages
            if (event.request.headers.get('accept').includes('text/html')) {
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
  // Sync any pending bookings stored in IndexedDB
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

