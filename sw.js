/* Garage — service worker: network-first (fresh online, cache offline) */
const CACHE = 'garage-v16';
const ASSETS = ['./', './index.html', './styles.css', './src/core/helpers.js', './src/ui/html.js', './src/ui/modal.js', './src/ui/photo.js', './src/ui/chrome.js', './src/data/catalog.js', './src/i18n/strings.ar.js', './src/i18n/lang.js', './schedule.js', './storage.js', './src/data/normalize.js', './src/data/session.js', './src/data/status.js', './vendor/supabase.js', './src/data/account.js', './ui.js', './src/pages/dashboard.js', './src/pages/maintenance.js', './src/pages/parts.js', './src/pages/fuel.js', './src/pages/budget.js', './src/pages/reports.js', './src/pages/documents.js', './app.js', './manifest.webmanifest', './icon.svg'];

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
  // Network-first: always try the latest, fall back to cache when offline.
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => { try { c.put(req, copy); } catch (_) {} });
      return res;
    }).catch(() => caches.match(req))
  );
});
