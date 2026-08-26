/* Royal Energy Alchemy dashboard service worker.
 * This worker intentionally does not cache requests. The dashboard handles live,
 * authenticated business data, so every navigation, API request, and asset is
 * retrieved through the browser's normal network and HTTP-cache behavior.
 */
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key.indexOf('rea-dashboard-') === 0;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function () {
  // No fetch interception: authenticated dashboard and API traffic stay live.
});
