/* Garage — service worker: network-first (fresh online, cache offline) */
const CACHE = 'garage-e7f16e8ab54c';
/* Only the default car photo is precached. The others are ~600 KB each and a
   user drives one or two of them; the fetch handler below caches whichever
   one the dashboard actually shows, so it is still there offline. */
const ASSETS = [
  './', './index.html', './styles.css',
  './assets/mazda3-studio.webp',
  './src/core/helpers.js', './src/ui/html.js', './src/ui/modal.js', './src/ui/photo.js', './src/ui/shop-field.js', './src/ui/shop-feedback.js',
  './src/ui/color.js', './src/ui/chrome.js', './src/data/catalog.js', './src/i18n/strings.ar.js',
  './src/i18n/lang.js', './src/core/schedule.js', './src/data/storage.js', './src/data/normalize.js',
  './src/data/error-log.js', './src/data/session.js','./src/data/status.js', './vendor/supabase.js', './src/data/account.js',
  './src/data/pricing.js', './src/data/insights.js', './src/data/shops.js', './src/data/bills.js', './src/data/repairable.js', './src/data/guidance.js', './src/data/recalls.js', './src/data/remote-catalog.js', './src/data/admin.js', './src/core/async-click.js', './src/data/car-photos.js', './src/pages/dashboard.js',
  './src/pages/maintenance.js', './src/pages/parts.js', './src/pages/fuel.js',
  './src/pages/budget.js', './src/pages/reports.js', './src/pages/documents.js', './src/pages/admin.js', './src/pages/admin-autopilot.js', './src/pages/admin-proposals.js', './src/pages/signin.js',
  './main.js', './manifest.webmanifest', './icon.svg'
];
/* The photo cache holds a handful of recently shown car photos (D-19); meta
   parks small notes for the page, e.g. the precache failure list (D-20).
   KEEP is explicit so activate never deletes either of them. */
const PHOTO_CACHE = 'garage-photos';
const META_CACHE = 'garage-meta';
const PHOTO_MAX = 6;
const KEEP = new Set([CACHE, PHOTO_CACHE, META_CACHE]);
const ASSET_URLS = new Set(ASSETS.map(a => { const u = new URL(a, self.location); return u.origin + u.pathname; }));

/* Tolerant precache: cache.addAll is atomic, so one 404 would block the whole
   offline shell (Research Pattern 2). Fetch each file on its own and park the
   failures under garage-meta for the page to relay — the SW has no Supabase
   client of its own (D-20). No skipWaiting: see activate. */
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => {
    const failed = [];
    return Promise.all(ASSETS.map(url =>
      fetch(url, { cache: 'reload' }).then(r => {
        if (!r.ok) { failed.push(url); return; }
        return c.put(url, r);
      }).catch(() => { failed.push(url); })
    )).then(() => caches.open(META_CACHE))
      .then(m => m.put('/__precache-report', new Response(JSON.stringify(failed))));
  }));
});

/* No clients.claim: a new release takes over on the next launch, so the new
   script never runs next to old classic scripts mid-session (D-17). */
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !KEEP.has(k)).map(k => caches.delete(k)))));
});

/* Keep only the PHOTO_MAX newest keys; keys() is in insertion order and hits
   delete + re-put, so the front of the list is the least recently used. */
function trim(c) {
  return c.keys().then(ks => Promise.all(ks.slice(0, Math.max(0, ks.length - PHOTO_MAX)).map(k => c.delete(k))));
}

/* Stale-while-revalidate. A hit answers at once and refreshes in the
   background via waitUntil. lru=true (photos): exact-URL keys including ?v=
   (a new cache-buster is a new photo), and every hit/refresh re-puts the entry
   so it becomes newest. lru=false (modules): ignoreSearch match, put replaces
   in place; the key set is bounded by ASSETS inside the versioned CACHE. */
function swr(name, req, e, lru) {
  const opts = lru ? undefined : { ignoreSearch: true };
  return caches.open(name).then(c => c.match(req, opts).then(hit => {
    if (hit) {
      const keep = hit.clone();
      e.waitUntil(fetch(req).then(res => {
        const del = lru ? c.delete(req) : Promise.resolve();
        if (res.ok && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          return del.then(() => c.put(req, copy)).then(() => lru && trim(c));
        }
        return lru ? del.then(() => c.put(req, keep)) : undefined;
      }).catch(() => {}));
      return hit;
    }
    return fetch(req).then(res => {
      if (res.ok && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        c.put(req, copy).then(() => lru && trim(c)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }));
  }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Only http(s) is cacheable — chrome-extension: and friends reject on put().
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;
  const same = url.origin === self.location.origin;
  const isCode = /\.(js|css)$/.test(url.pathname);
  if (same && url.pathname.includes('/vendor/')) {
    // Pinned library (plan 01-03): cached copy wins, never revalidated (Pitfall 23).
    e.respondWith(caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true }).then(hit => hit ||
      fetch(req).then(res => {
        if (res.ok && res.status === 200 && res.type === 'basic') c.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true })))));
    return;
  }
  if (same && isCode && ASSET_URLS.has(url.origin + url.pathname)) { e.respondWith(swr(CACHE, req, e, false)); return; }
  if (same && /\/assets\/[^?]*\.(webp|png|jpe?g)$/i.test(url.pathname)) { e.respondWith(swr(PHOTO_CACHE, req, e, true)); return; }
  // Network-first: always try the latest, fall back to cache when offline.
  e.respondWith(
    fetch(req).then(res => {
      /* Cache successful same-origin responses only. A 404/500 stored here
         becomes the offline fallback, serving the error forever; a 206 or an
         opaque cross-origin response makes put() reject outright. put()
         returns a promise, so its failure needs .catch() — a try/catch around
         the call cannot see an async rejection. Scripts/styles outside ASSETS
         are not written, so the CACHE key set stays bounded. */
      if (res.ok && res.status === 200 && res.type === 'basic' && !isCode) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    /* ignoreSearch: the dashboard asks for photos with a ?v= cache-buster,
       but the precached default photo is stored under its bare URL. */
    }).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
