/* Garage — service worker: network-first (fresh online, cache offline) */
const CACHE = 'garage-v48';
const ASSETS = ['./', './index.html', './styles.css', './assets/mazda3-studio.png', './assets/mazda3-soul-red.png', './assets/mazda3-snowflake-white.png', './assets/mazda3-jet-black.png', './assets/mazda3-deep-crystal-blue.png', './assets/mazda3-blue-reflex.png', './assets/mazda3-liquid-silver.png', './assets/mazda3-titanium-flash.png', './assets/mazda2-dj.png', './assets/mazda3-bp.png', './assets/mazda6-gj.png', './assets/mazda-cx3-dk.png', './assets/mazda-cx30-dm.png', './assets/mazda-cx5-ke.png', './assets/cx5ke-soul-red-metallic.png', './assets/cx5ke-crystal-white-pearl-mica.png', './assets/cx5ke-jet-black-mica.png', './assets/cx5ke-blue-reflex-mica.png', './assets/cx5ke-sky-blue-mica.png', './assets/cx5ke-stormy-blue-mica.png', './assets/cx5ke-liquid-silver-metallic.png', './assets/cx5ke-metropolitan-gray-mica.png', './assets/cx5ke-zeal-red-mica.png', './assets/mazda-cx5-kf.png', './assets/mazda-cx5-gen3.png', './assets/mazda-cx9-tb.png', './assets/cx9tb-brilliant-black-clearcoat.png', './assets/cx9tb-crystal-white-pearl-mica.png', './assets/cx9tb-copper-red-mica.png', './assets/cx9tb-liquid-silver-metallic.png', './assets/cx9tb-metropolitan-gray-mica.png', './assets/cx9tb-stormy-blue-mica.png', './assets/mazda-cx9-tc.png', './assets/mazda-cx50.png', './assets/mazda-cx60.png', './assets/mazda-cx70.png', './assets/mazda-cx80.png', './assets/mazda-cx90.png', './src/core/helpers.js', './src/ui/html.js', './src/ui/modal.js', './src/ui/photo.js', './src/ui/color.js', './src/ui/chrome.js', './src/data/catalog.js', './src/i18n/strings.ar.js', './src/i18n/lang.js', './src/core/schedule.js', './src/data/storage.js', './src/data/normalize.js', './src/data/session.js', './src/data/status.js', './vendor/supabase.js', './src/data/account.js', './src/core/async-click.js', './src/pages/dashboard.js', './src/pages/maintenance.js', './src/pages/parts.js', './src/pages/fuel.js', './src/pages/budget.js', './src/pages/reports.js', './src/pages/documents.js', './main.js', './manifest.webmanifest', './icon.svg'];
ASSETS.push(
  './assets/mazda6-soul-red-metallic.png',
  './assets/mazda6-soul-red-crystal-metallic.png',
  './assets/mazda6-snowflake-white-pearl-mica.png',
  './assets/mazda6-jet-black-mica.png',
  './assets/mazda6-deep-crystal-blue-mica.png',
  './assets/mazda6-blue-reflex-mica.png',
  './assets/mazda6-sonic-silver-metallic.png',
  './assets/mazda6-titanium-flash-mica.png'
);
ASSETS.push(
  './assets/mazda2-soul-red-crystal-metallic.png',
  './assets/mazda2-snowflake-white-pearl-mica.png',
  './assets/mazda2-jet-black-mica.png',
  './assets/mazda2-deep-crystal-blue-mica.png',
  './assets/mazda2-dynamic-blue-mica.png',
  './assets/mazda2-ceramic-metallic.png',
  './assets/mazda2-platinum-quartz-metallic.png'
);
ASSETS.push(
  './assets/cx3-soul-red-crystal-metallic.png',
  './assets/cx3-snowflake-white-pearl-mica.png',
  './assets/cx3-jet-black-mica.png',
  './assets/cx3-deep-crystal-blue-mica.png',
  './assets/cx3-dynamic-blue-mica.png',
  './assets/cx3-ceramic-metallic.png',
  './assets/cx3-titanium-flash-mica.png',
  './assets/cx3-polymetal-gray-metallic.png'
);

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
