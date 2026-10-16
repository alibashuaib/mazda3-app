/* Garage — service worker: network-first (fresh online, cache offline) */
const CACHE = 'garage-v127';
/* Only the default car photo is precached. The others are ~600 KB each and a
   user drives one or two of them; the fetch handler below caches whichever
   one the dashboard actually shows, so it is still there offline. */
const ASSETS = [
  './', './index.html', './styles.css',
  './assets/mazda3-studio.webp',
  './src/core/helpers.js', './src/ui/html.js', './src/ui/modal.js', './src/ui/photo.js', './src/ui/shop-field.js', './src/ui/shop-feedback.js',
  './src/ui/color.js', './src/ui/chrome.js', './src/data/catalog.js', './src/i18n/strings.ar.js',
  './src/i18n/lang.js', './src/core/schedule.js', './src/data/storage.js', './src/data/normalize.js',
  './src/data/session.js', './src/data/status.js', './vendor/supabase.js', './src/data/account.js',
  './src/data/pricing.js', './src/data/insights.js', './src/data/shops.js', './src/data/remote-catalog.js', './src/data/admin.js', './src/core/async-click.js', './src/pages/dashboard.js',
  './src/pages/maintenance.js', './src/pages/parts.js', './src/pages/fuel.js',
  './src/pages/budget.js', './src/pages/reports.js', './src/pages/documents.js', './src/pages/admin.js',
  './main.js', './manifest.webmanifest', './icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Only http(s) is cacheable — chrome-extension: and friends reject on put().
  if (!/^https?:$/.test(new URL(req.url).protocol)) return;
  // Network-first: always try the latest, fall back to cache when offline.
  e.respondWith(
    fetch(req).then(res => {
      /* Cache successful same-origin responses only. A 404/500 stored here
         becomes the offline fallback, serving the error forever; a 206 or an
         opaque cross-origin response makes put() reject outright. put()
         returns a promise, so its failure needs .catch() — a try/catch around
         the call cannot see an async rejection. */
      if (res.ok && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
