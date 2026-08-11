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

  /* Photo id -> data URL for every image already inlined in a stored record.
     The localStorage backend rewrites a vehicle wholesale, so a save that did
     not re-supply an existing photo must not drop it. */
  function collectInlinePhotos(data) {
    const out = {};
    if (!data) return out;
    photoSlots(data).forEach(o => { if (o.photoId && isDataUrl(o.photo)) out[o.photoId] = o.photo; });
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

  /* data: URL -> Blob. Returns null for anything else (notably blob: URLs,
     which must never be written to storage). */
  function dataUrlToBlob(dataUrl) {
    if (!isDataUrl(dataUrl)) return null;
    const comma = dataUrl.indexOf(',');
    const header = dataUrl.slice(5, comma);
    const type = header.split(';')[0] || 'application/octet-stream';
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  function blobToDataUrl(blob) {
    return blob.arrayBuffer().then(buf => {
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
    });
  }

  const DB_NAME = 'garage';
  const DB_VERSION = 1;
  const LS_KEY = 'garage.mazda3.v2';   // same key the app used before Phase 2
  const META_KEY = 'meta';

  let backend = null;   // { kind, ... } once openStorage() has run

  function idbOpen() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('vehicles')) db.createObjectStore('vehicles', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
  }

  function idbTx(db, stores, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('aborted'));
      result = fn(tx);
    });
  }

  function idbGetAll(db, store) {
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /* Writes the meta record within an in-flight transaction, merging over the
     existing record rather than replacing it wholesale — so an ordinary save
     or delete never clobbers fields like migratedAt and re-triggers migration. */
  function putMetaPreserving(tx, patch) {
    const store = tx.objectStore('meta');
    const getReq = store.get(META_KEY);
    getReq.onsuccess = () => {
      const prev = getReq.result || { key: META_KEY, schemaVersion: 1 };
      store.put(Object.assign({}, prev, patch));
    };
  }

  function lsRead() {
    try {
      const v = JSON.parse(localStorage.getItem(LS_KEY));
      return (v && Array.isArray(v.vehicles)) ? v : null;
    } catch (e) { return null; }
  }
  function lsWrite(garage) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(garage)); return true; }
    catch (e) { return { error: e }; }
  }

  /* Selects a backend once. Any failure opening IndexedDB — including the
     SecurityError browsers throw on opaque origins — falls back to
     localStorage rather than leaving the user with no app at all. */
  function openStorage(env) {
    env = env || { protocol: location.protocol, hasIndexedDb: typeof indexedDB !== 'undefined' };
    if (!shouldTryIndexedDb(env.protocol, env.hasIndexedDb)) {
      backend = { kind: 'local' };
      return Promise.resolve(backend);
    }
    return idbOpen()
      .then(db => { backend = { kind: 'idb', db }; return backend; })
      .catch(() => { backend = { kind: 'local' }; return backend; });
  }

  /* Reads everything into the shape app.js already expects. On the IndexedDB
     backend, a first run with no data migrates the localStorage garage in
     place — non-destructively; the old key is never deleted, so a user who
     opens index.html from disk afterwards still finds their data. */
  function loadAll() {
    if (backend.kind === 'local') {
      const garage = lsRead();
      return Promise.resolve({ garage, photos: {} });
    }
    const db = backend.db;
    return Promise.all([idbGetAll(db, 'meta'), idbGetAll(db, 'vehicles'), idbGetAll(db, 'photos')])
      .then(([meta, vehicles, photos]) => {
        const photosById = {};
        photos.forEach(p => { photosById[p.id] = p.blob; });
        const m = meta.find(x => x.key === META_KEY) || {};
        if (!m.migratedAt) {
          const legacy = lsRead();
          if (legacy && Array.isArray(legacy.vehicles) && legacy.vehicles.length) {
            return migrateFromLocal(legacy).then(() => loadAll())
              .catch(() => { backend = { kind: 'local' }; return { garage: lsRead(), photos: {} }; });
          }
        }
        if (!vehicles.length) return { garage: null, photos: {} };
        return {
          garage: { vehicles: vehicles.map(v => ({ id: v.id, data: v.data })), activeId: m.activeId || vehicles[0].id },
          photos: photosById
        };
      });
  }

  function migrateFromLocal(legacy) {
    const db = backend.db;
    const writes = [];
    const vehicles = legacy.vehicles.map(v => {
      const split = splitPhotos(v.data, () => `${v.id}-${Math.random().toString(36).slice(2, 9)}`);
      Object.keys(split.photos).forEach(id => {
        const blob = dataUrlToBlob(split.photos[id]);
        if (blob) writes.push({ store: 'photos', rec: { id, blob } });
      });
      return { id: v.id, data: split.data };
    });
    vehicles.forEach(v => writes.push({ store: 'vehicles', rec: v }));
    writes.push({ store: 'meta', rec: { key: META_KEY, schemaVersion: 1, migratedAt: new Date().toISOString(), activeId: legacy.activeId } });
    return idbTx(db, ['meta', 'vehicles', 'photos'], 'readwrite', tx => {
      writes.forEach(w => tx.objectStore(w.store).put(w.rec));
    });
  }

  /* Writes ONE vehicle plus any newly added photos. The pre-Phase-2 code
     re-serialised every vehicle and every photo on every change.

     ALWAYS resolves to the same shape — { ok, error?, photoIds, data } — so
     callers never have to know which backend is live. */
  function saveVehicle(vehicleId, data, activeId, makeId) {
    const split = splitPhotos(data, makeId);
    const photoIds = Object.keys(split.photos);
    if (backend.kind === 'local') {
      const garage = lsRead() || { vehicles: [], activeId };
      const idx = garage.vehicles.findIndex(v => v.id === vehicleId);
      const prev = idx >= 0 ? garage.vehicles[idx].data : null;
      const merged = Object.assign(collectInlinePhotos(prev), split.photos);
      const rec = { id: vehicleId, data: inlinePhotos(split.data, merged) };
      if (idx >= 0) garage.vehicles[idx] = rec; else garage.vehicles.push(rec);
      garage.activeId = activeId;
      const res = lsWrite(garage);
      return Promise.resolve(res === true
        ? { ok: true, photoIds, data: split.data }
        : { ok: false, error: res.error });
    }
    const db = backend.db;
    return idbTx(db, ['meta', 'vehicles', 'photos'], 'readwrite', tx => {
      tx.objectStore('vehicles').put({ id: vehicleId, data: split.data });
      putMetaPreserving(tx, { activeId });
      Object.keys(split.photos).forEach(id => {
        const blob = dataUrlToBlob(split.photos[id]);
        if (blob) tx.objectStore('photos').put({ id, blob });
      });
    }).then(() => ({ ok: true, photoIds, data: split.data }))
      .catch(e => ({ ok: false, error: e }));
  }

  function removeVehicle(vehicleId, activeId) {
    if (backend.kind === 'local') {
      const garage = lsRead() || { vehicles: [], activeId };
      garage.vehicles = garage.vehicles.filter(v => v.id !== vehicleId);
      garage.activeId = activeId;
      const res = lsWrite(garage);
      return Promise.resolve(res === true);
    }
    return idbTx(backend.db, ['meta', 'vehicles'], 'readwrite', tx => {
      tx.objectStore('vehicles').delete(vehicleId);
      putMetaPreserving(tx, { activeId });
    }).then(() => true).catch(() => false);
  }

  function backendKind() { return backend ? backend.kind : null; }

  return {
    shouldTryIndexedDb, splitPhotos, inlinePhotos, collectInlinePhotos, buildExport, parseImport,
    dataUrlToBlob, blobToDataUrl, openStorage, loadAll, saveVehicle, removeVehicle, backendKind
  };
});
