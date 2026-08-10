/* ============================================================
   Garage — persistence adapter.
   Dual-mode: a plain <script> in the browser (assigns to the global
   object) and require()d by the Node tests. The pure functions below
   hold every decision and data transformation so they are testable;
   the IndexedDB plumbing added later is deliberately thin.
   ============================================================ */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

  /* Fields that may carry an image, as [containerGetter, key] pairs. */
  function photoSlots(data) {
    const slots = [];
    if (data.car) slots.push(data.car);
    (data.history || []).forEach(e => slots.push(e));
    (data.spending || []).forEach(e => slots.push(e));
    return slots;
  }

  function isDataUrl(v) { return typeof v === 'string' && v.slice(0, 5) === 'data:'; }

  /* IndexedDB throws on opaque origins (file://) in Chrome and Safari, and
     the app is documented as runnable by double-clicking index.html — so we
     do not even attempt it there. */
  function shouldTryIndexedDb(protocol, hasIndexedDb) {
    return !!hasIndexedDb && protocol !== 'file:';
  }

  /* Replace embedded data: URLs with photo ids. Returns a stripped deep copy
     plus the extracted images. Never persists a blob: URL — those are
     per-session object URLs created at hydrate time, and their id is already
     recorded, so they are simply dropped from the copy. */
  function splitPhotos(data, makeId) {
    const out = JSON.parse(JSON.stringify(data));
    const photos = {};
    photoSlots(out).forEach(obj => {
      const v = obj.photo;
      if (isDataUrl(v)) {
        const id = makeId();
        photos[id] = v;
        obj.photo = '';
        obj.photoId = id;
      } else if (!v) {
        obj.photo = '';
        delete obj.photoId;      // photo was removed — drop the dangling id
      } else {
        obj.photo = '';          // blob: URL — keep photoId, never store the URL
      }
    });
    return { data: out, photos };
  }

  /* Inverse of splitPhotos, for export. A photo id with no matching image
     yields an empty string rather than an exception. */
  function inlinePhotos(data, photosById) {
    const out = JSON.parse(JSON.stringify(data));
    photoSlots(out).forEach(obj => {
      if (obj.photoId) obj.photo = photosById[obj.photoId] || '';
    });
    return out;
  }

  const EXPORT_FORMAT = 'garage-export';

  function buildExport(garage, photosById, nowIso) {
    return { format: EXPORT_FORMAT, version: 1, exportedAt: nowIso, garage, photos: photosById };
  }

  function parseImport(text) {
    let obj;
    try { obj = JSON.parse(text); }
    catch (e) { return { ok: false, error: 'That file is not valid JSON.' }; }
    if (!obj || obj.format !== EXPORT_FORMAT) return { ok: false, error: 'That is not a Garage backup file.' };
    if (!obj.garage || !Array.isArray(obj.garage.vehicles)) return { ok: false, error: 'That backup file is incomplete.' };
    return { ok: true, garage: obj.garage, photos: obj.photos || {} };
  }

  return { shouldTryIndexedDb, splitPhotos, inlinePhotos, buildExport, parseImport };
});
