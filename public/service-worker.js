// AdMonitor Pro Service Worker
// Handles offline support, caching strategy, background sync, and push notifications

const CACHE_VERSION = 'v2';
const STATIC_CACHE = `admonitor-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `admonitor-runtime-${CACHE_VERSION}`;

// Files to cache on install
const STATIC_ASSETS = [
  '/manifest.json'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[Service Worker] Caching static assets');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[Service Worker] Error caching static assets:', err);
        // Non-critical: continue even if some assets fail to cache
      });
    }).then(() => {
      // Claim clients immediately
      return self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete old cache versions
          if (cacheName !== STATIC_CACHE && cacheName !== RUNTIME_CACHE && cacheName.startsWith('admonitor-')) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Claim all clients
      return self.clients.claim();
    })
  );
});

// Fetch event - network-first for navigations/API, cache-first for immutable assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests
  if (url.origin !== location.origin) {
    return;
  }

  // API calls: Network-first strategy
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only cache successful responses
          if (response.ok) {
            const cache = caches.open(RUNTIME_CACHE);
            cache.then((c) => c.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => {
          // Return cached response if network fails
          return caches.match(request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                console.log('[Service Worker] Returning cached API response:', request.url);
                return cachedResponse;
              }
              // Return offline response if no cache
              return new Response(
                JSON.stringify({ error: 'Offline - no cached data available' }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
              );
            });
        })
    );
    return;
  }

  // Always fetch navigations fresh first so a new deploy cannot be pinned to a stale HTML shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const cache = caches.open(RUNTIME_CACHE);
            cache.then((c) => c.put('/index.html', response.clone()));
          }
          return response;
        })
        .catch(() => {
          return caches.match('/index.html').then((response) => {
            return response || new Response('Offline - please check your connection', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' }
            });
          });
        })
    );
    return;
  }

  const isHashedAsset = url.pathname.startsWith('/assets/');

  // Static assets: Cache-first for hashed bundles, network-first for everything else
  event.respondWith(
    (isHashedAsset ? caches.match(request) : Promise.resolve(undefined))
      .then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;

        return fetch(request)
          .then((response) => {
            if (response.ok) {
              const targetCache = isHashedAsset ? STATIC_CACHE : RUNTIME_CACHE;
              // Clone BEFORE consuming the response
              const responseClone = response.clone();
              caches.open(targetCache).then((c) => c.put(request, responseClone));
            }
            return response;
          })
          .catch(() => caches.match(request).then((response) => response || new Response('Offline', { status: 503 })));
      })
  );
});

// Background sync event - sync queued data when connection restored
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync triggered:', event.tag);

  if (event.tag === 'sync-recordings') {
    event.waitUntil(
      // Open IndexedDB and sync any queued recordings
      new Promise((resolve, reject) => {
        const request = indexedDB.open('admonitor-db', 1);
        
        request.onerror = () => {
          console.error('[Service Worker] Error opening IndexedDB:', request.error);
          reject(request.error);
        };

        request.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction('sync-queue', 'readonly');
          const store = tx.objectStore('sync-queue');
          const getAllRequest = store.getAll();

          getAllRequest.onsuccess = () => {
            const queuedItems = getAllRequest.result;
            if (queuedItems.length === 0) {
              resolve();
              return;
            }

            // Send queued recordings to server
            Promise.all(
              queuedItems.map((item) =>
                fetch('/api/recordings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(item)
                })
                  .then((response) => {
                    if (response.ok) {
                      // Remove from queue after successful sync
                      const tx2 = db.transaction('sync-queue', 'readwrite');
                      tx2.objectStore('sync-queue').delete(item.id);
                    }
                    return response;
                  })
                  .catch((err) => {
                    console.warn('[Service Worker] Sync failed:', err);
                    throw err;
                  })
              )
            ).then(resolve).catch(reject);
          };

          getAllRequest.onerror = () => {
            console.error('[Service Worker] Error reading sync queue:', getAllRequest.error);
            reject(getAllRequest.error);
          };
        };
      })
    );
  }
});

// Push notification event
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push notification received');

  let notificationOptions = {
    badge: '/vite.svg',
    icon: '/vite.svg',
    tag: 'admonitor-notification',
    requireInteraction: false,
    vibrate: [200, 100, 200],
  };

  if (event.data) {
    try {
      const data = event.data.json();
      notificationOptions = {
        ...notificationOptions,
        title: data.title || 'AdMonitor Pro',
        body: data.body || 'Keyword detected',
        data: data.data || {}
      };
    } catch (e) {
      notificationOptions.title = 'AdMonitor Pro';
      notificationOptions.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(
      notificationOptions.title,
      notificationOptions
    )
  );
});

// Notification click event - open app to recordings
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification clicked');
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // Check if app is already open
      for (let client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      // Open app to recordings view
      if (clients.openWindow) {
        return clients.openWindow('/?view=recordings');
      }
    })
  );
});

// Message event - for background sync requests from client
self.addEventListener('message', (event) => {
  console.log('[Service Worker] Message received:', event.data);

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'SYNC_RECORDINGS') {
    if ('sync' in self.registration) {
      self.registration.sync.register('sync-recordings');
    }
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(RUNTIME_CACHE).then(() => {
      console.log('[Service Worker] Runtime cache cleared');
    });
  }
});

console.log('[Service Worker] Loaded and ready');
