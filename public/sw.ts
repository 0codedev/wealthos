/// <reference lib="webworker" />

/**
 * Service Worker for Wealth Aggregator PWA
 * Enables offline support and caching strategies
 */

const CACHE_NAME = 'wealth-aggregator-v1';
const OFFLINE_URL = '/offline.html';

// Assets to cache immediately on install
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/index.css',
    '/manifest.json',
];

// Install event - cache critical assets
self.addEventListener('install', (event: ExtendableEvent) => {
    console.log('[SW] Installing service worker...');

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching app shell...');
                return cache.addAll(PRECACHE_ASSETS);
            })
            .then(() => (self as any).skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event: ExtendableEvent) => {
    console.log('[SW] Activating service worker...');

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
        }).then(() => (self as any).clients.claim())
    );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event: FetchEvent) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip chrome-extension and other non-http requests
    if (!url.protocol.startsWith('http')) return;

    // Skip API calls (don't cache)
    if (url.pathname.includes('/api/') || url.hostname.includes('googleapis')) {
        return;
    }

    // For navigation requests, use network-first strategy
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    // Clone and cache successful responses
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(async () => {
                    // Try to return cached version
                    const cachedResponse = await caches.match(request);
                    if (cachedResponse) return cachedResponse;

                    // Return offline page as last resort
                    const offlinePage = await caches.match(OFFLINE_URL);
                    return offlinePage || new Response('Offline', { status: 503 });
                })
        );
        return;
    }

    // For other requests, use cache-first strategy
    event.respondWith(
        caches.match(request).then(cachedResponse => {
            if (cachedResponse) {
                // Return cache, but update in background
                event.waitUntil(
                    fetch(request)
                        .then(response => {
                            if (response.ok) {
                                caches.open(CACHE_NAME).then(cache => {
                                    cache.put(request, response);
                                });
                            }
                        })
                        .catch(() => { })
                );
                return cachedResponse;
            }

            // Not in cache, fetch from network
            return fetch(request).then(response => {
                // Cache successful responses
                if (response.ok) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(request, responseClone);
                    });
                }
                return response;
            });
        })
    );
});

// Background sync for offline data submission
self.addEventListener('sync', (event: any) => {
    if (event.tag === 'sync-trades') {
        console.log('[SW] Syncing trades...');
        // In production, this would sync queued trades with a server
    }
});

// Push notification handling
self.addEventListener('push', (event: PushEvent) => {
    if (!event.data) return;

    const data = event.data.json();
    const options: NotificationOptions = {
        body: data.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-72.png',
        // @ts-ignore
        vibrate: [100, 50, 100],
        data: data.data,
        actions: data.actions || [],
    };

    event.waitUntil(
        (self as any).registration.showNotification(data.title, options)
    );
});

// Notification click handling
self.addEventListener('notificationclick', (event: NotificationEvent) => {
    event.notification.close();

    let urlToOpen = event.notification.data?.url || '/';
    if (event.action === 'open-pool') {
        urlToOpen = '/?tab=pool';
    }

    event.waitUntil(
        (self as any).clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList: any[]) => {
            // If app is already open, focus it and redirect to the pool tab
            for (const client of clientList) {
                if ('focus' in client) {
                    client.focus();
                    if ('navigate' in client) {
                        return client.navigate(urlToOpen);
                    }
                }
            }
            // Otherwise open new window
            return (self as any).clients.openWindow(urlToOpen);
        })
    );
});

export { };
