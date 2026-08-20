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
        /* An empty photo alongside a photoId is the UI's only signal that the
           user removed the image, so it is read as one — which means a record
           MUST go through hydrate()/resolvePhotos before it is saved. Since
           orphan collection landed, saving an unresolved record no longer just
           drops the id and leaks the blob; it deletes the blob. Pinned by the
           INVARIANT test in test/idb.test.js. */
        obj.photo = '';
        delete obj.photoId;
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

  /* After a successful write the stored copy knows each photo's id; copy those
     ids back into the live records so the next save does not re-upload the
     image.

     Matched by id, never by array position. save() is fired without await by
     markServiceDone() and logVisit(), so the user can delete a history or
     spending record while the write is still in flight. Zipping the live and
     stored arrays by index then shifts every record past the deletion: one
     entry silently adopts another's receipt photo, and one loses its only
     pointer to a stored blob.

     A live record with no stored counterpart is left alone — it was added
     after splitPhotos took its snapshot, and its own save will claim its id. */
  function applyPhotoIds(live, stored) {
    if (!live || !stored) return live;
    const copy = (o, s) => {
      if (!o || !s) return;
      if (s.photoId) o.photoId = s.photoId;
      else delete o.photoId;
    };
    copy(live.car, stored.car);
    ['history', 'spending'].forEach(key => {
      const byId = {};
      (stored[key] || []).forEach(s => { if (s && s.id) byId[s.id] = s; });
      (live[key] || []).forEach(o => { if (o && o.id) copy(o, byId[o.id]); });
    });
    return live;
  }

  /* Record-level shape, for data that did not come from seed(): a legacy v1
     payload or an imported backup.

     The render paths call string and array methods on fields nothing
     guarantees — e.date.slice, e.date.startsWith, p.options.map — so a single
     malformed entry throws inside go('dashboard'), and the boot chain's catch
     shows "Could not open your garage" over data that had loaded perfectly.
     Same failure as an absent state.budget, one level down.

     Dates default to '' rather than today: a damaged record stays visible
     without being given a date it never had. Takes makeId so it stays pure. */
  function normalizeRecords(s, makeId) {
    if (!s) return s;
    const num = v => (typeof v === 'number' && isFinite(v)) ? v : (isFinite(Number(v)) ? Number(v) : 0);
    const str = v => typeof v === 'string' ? v : '';
    /* Non-objects are dropped rather than defaulted: there is nothing to
       recover from a null or a bare string sitting in a record array, and
       leaving one in place throws on the next property read. */
    const list = k => {
      s[k] = (Array.isArray(s[k]) ? s[k] : []).filter(x => x && typeof x === 'object' && !Array.isArray(x));
      return s[k];
    };
    list('history').forEach(e => { e.id = e.id || makeId(); e.date = str(e.date); e.cost = num(e.cost); e.odometer = num(e.odometer); });
    list('spending').forEach(e => { e.id = e.id || makeId(); e.date = str(e.date); e.amount = num(e.amount); });
    list('fuel').forEach(e => { e.id = e.id || makeId(); e.date = str(e.date); e.litres = num(e.litres); e.cost = num(e.cost); e.odometer = num(e.odometer); });
    list('docs').forEach(d => { d.id = d.id || makeId(); d.date = str(d.date); });
    list('parts').forEach(p => { if (!Array.isArray(p.options)) p.options = []; p.name = str(p.name); p.cat = str(p.cat) || 'General'; });
    list('services').forEach(sv => { sv.id = sv.id || makeId(); sv.name = str(sv.name); sv.cost = num(sv.cost); });
    return s;
  }

  /* Every photo id a stored record still points at. */
  function photoIdsIn(data) {
    const out = [];
    if (!data) return out;
    photoSlots(data).forEach(o => { if (o && o.photoId && out.indexOf(o.photoId) < 0) out.push(o.photoId); });
    return out;
  }

  /* Ids the previous version of a record referenced and the new one does not —
     the user replaced the image, or deleted the record that held it. Photo ids
     are minted per photo and never shared between records, so anything dropped
     here is genuinely unreachable. */
  function orphanedPhotoIds(prevData, nextData) {
    const keep = photoIdsIn(nextData);
    return photoIdsIn(prevData).filter(id => keep.indexOf(id) < 0);
  }

  /* Ids in the photo store that no vehicle references at all. Used for a sweep
     at load, to clear orphans written before saveVehicle started collecting
     them. */
  function unreferencedPhotoIds(storedIds, vehicles) {
    const keep = [];
    (vehicles || []).forEach(v => photoIdsIn(v && v.data).forEach(id => { if (keep.indexOf(id) < 0) keep.push(id); }));
    return (storedIds || []).filter(id => keep.indexOf(id) < 0);
  }

  const EXPORT_FORMAT = 'garage-export';

  function buildExport(garage, photosById, nowIso) {
    return { format: EXPORT_FORMAT, version: 1, exportedAt: nowIso, garage, photos: photosById };
  }

  /* Validates hard enough that the caller can replace the live garage without
     checking anything itself. An import that parses but has no usable vehicle
     would otherwise throw halfway through the restore, after the in-memory
     garage has already been overwritten. */
  function parseImport(text) {
    let obj;
    try { obj = JSON.parse(text); }
    catch (e) { return { ok: false, error: 'That file is not valid JSON.' }; }
    if (!obj || obj.format !== EXPORT_FORMAT) return { ok: false, error: 'That is not a Garage backup file.' };
    if (!obj.garage || !Array.isArray(obj.garage.vehicles)) return { ok: false, error: 'That backup file is incomplete.' };
    if (!obj.garage.vehicles.length) return { ok: false, error: 'That backup file has no vehicles in it.' };
    const faults = importFaults(obj.garage.vehicles);
    if (faults.length) return { ok: false, error: 'That backup file is damaged.', faults };
    if (obj.photos && (typeof obj.photos !== 'object' || Array.isArray(obj.photos))) {
      return { ok: false, error: 'That backup file is damaged.', faults: ['photos is not an object'] };
    }
    return { ok: true, garage: obj.garage, photos: obj.photos || {} };
  }

  /* Structural faults that make a backup unrestorable, as a list of readable
     reasons (surfaced to the console; the user sees the one-line error).

     The line is deliberate: STRUCTURE must be sound, CONTENT is repaired.
     A vehicle with no id, or a `history` that is a string rather than a list,
     is damage — there is no sane restore. A record missing its date or cost is
     not: normalizeRecords fills those, and rejecting them would refuse a
     backup exported after an earlier repair, which legitimately carries empty
     dates. Rejecting those would make the repair path a one-way trip. */
  const RECORD_LISTS = ['history', 'spending', 'fuel', 'docs', 'parts', 'services'];
  function importFaults(vehicles) {
    const faults = [];
    vehicles.forEach((v, i) => {
      const where = `vehicle ${i + 1}`;
      if (!v || typeof v !== 'object' || Array.isArray(v)) { faults.push(`${where} is not an object`); return; }
      if (!v.id || typeof v.id !== 'string') faults.push(`${where} has no id`);
      if (!v.data || typeof v.data !== 'object' || Array.isArray(v.data)) { faults.push(`${where} has no data`); return; }
      if ('car' in v.data && (typeof v.data.car !== 'object' || Array.isArray(v.data.car))) faults.push(`${where}: car is not an object`);
      RECORD_LISTS.forEach(k => {
        if (!(k in v.data)) return;                       // absent is fine — normalizeRecords creates it
        if (!Array.isArray(v.data[k])) { faults.push(`${where}: ${k} is not a list`); return; }
        const bad = v.data[k].filter(e => !e || typeof e !== 'object' || Array.isArray(e)).length;
        if (bad) faults.push(`${where}: ${k} has ${bad === 1 ? '1 entry that is not a record' : bad + ' entries that are not records'}`);
      });
    });
    return faults;
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
  const LEGACY_V1_KEY = 'garage.mazda3.v1';
  const DIRTY_KEY = 'garage.sync.dirty';   // account.js's outbox-lite; wiped with everything else
  const META_KEY = 'meta';

  /* Before the garage existed the app stored ONE car's data object directly
     under the v1 key. A user who has not opened the app since then still has
     their history there and nowhere else, so a first run with no v2 garage
     must seed from it rather than from a blank car. Returns the car data, or
     null if the key is absent, unparseable, or already a v2 garage. */
  function parseLegacyV1(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    let obj;
    try { obj = JSON.parse(raw); }
    catch (e) { return null; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    if (Array.isArray(obj.vehicles)) return null;   // a v2 garage, not a v1 car
    return obj;
  }

  function readLegacyV1() {
    try { return parseLegacyV1(localStorage.getItem(LEGACY_V1_KEY)); }
    catch (e) { return null; }
  }

  /* Pure: what loadAll should do on the IndexedDB backend, given the stored
     meta record and whatever garage sits in localStorage.

     'stamp' matters as much as 'migrate'. If migratedAt is only written when
     something was actually migrated, a user whose first run is on IndexedDB
     stays unstamped forever — and a later session forced onto localStorage
     (file://, or an IndexedDB failure) writes a *seeded* garage to LS_KEY that
     the next IndexedDB visit would import as "legacy", adding a phantom
     vehicle and stealing activeId. */
  function migrationPlan(meta, legacy) {
    if (meta && meta.migratedAt) return 'none';
    if (legacy && Array.isArray(legacy.vehicles) && legacy.vehicles.length) return 'migrate';
    return 'stamp';
  }

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
  /* Closes a previously opened IndexedDB connection. Guarded: an
     already-closed or errored handle must not stop backend selection from
     completing (this runs ahead of a *new* connection replacing `backend`). */
  function closePrevious() {
    if (backend && backend.kind === 'idb' && backend.db) {
      try { backend.db.close(); } catch (e) {}
    }
  }

  function openStorage(env) {
    env = env || { protocol: location.protocol, hasIndexedDb: typeof indexedDB !== 'undefined' };
    if (!shouldTryIndexedDb(env.protocol, env.hasIndexedDb)) {
      closePrevious();
      backend = { kind: 'local' };
      return Promise.resolve(backend);
    }
    return idbOpen()
      .then(db => { closePrevious(); backend = { kind: 'idb', db }; return backend; })
      .catch(() => { closePrevious(); backend = { kind: 'local' }; return backend; });
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
        /* Blobs written before saveVehicle/removeVehicle started collecting
           orphans are unreachable but still on disk, and still loaded into
           memory and serialised into every backup. Sweep them once at load;
           after that the write paths keep the store clean. Failure is
           ignored — this is housekeeping, not something to fail a boot over. */
        const sweep = () => {
          const dead = unreferencedPhotoIds(Object.keys(photosById), vehicles);
          if (!dead.length) return Promise.resolve();
          dead.forEach(id => { delete photosById[id]; });
          return idbTx(db, ['photos'], 'readwrite', tx => {
            dead.forEach(id => tx.objectStore('photos').delete(id));
          }).catch(() => {});
        };
        const shape = () => {
          if (!vehicles.length) return { garage: null, photos: {} };
          return {
            garage: { vehicles: vehicles.map(v => ({ id: v.id, data: v.data })), activeId: m.activeId || vehicles[0].id },
            photos: photosById
          };
        };
        const legacy = lsRead();
        const plan = migrationPlan(m, legacy);
        if (plan === 'migrate') {
          return migrateFromLocal(legacy).then(() => loadAll())
            .catch(() => { backend = { kind: 'local' }; return { garage: lsRead(), photos: {} }; });
        }
        // Nothing to migrate, but close the door behind us — see migrationPlan.
        // A failed stamp is not worth failing the boot over; it retries next load.
        if (plan === 'stamp') return stampMigrated(db).catch(() => {}).then(sweep).then(shape);
        return sweep().then(shape);
      });
  }

  function stampMigrated(db) {
    return idbTx(db, ['meta'], 'readwrite', tx => {
      putMetaPreserving(tx, { migratedAt: new Date().toISOString() });
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
      const vehicles = tx.objectStore('vehicles');
      /* Queued before the put, so it reads the record as it was and can drop
         the blobs this save orphans — a replaced photo, or one whose record
         the user deleted. Without this the photo store only ever grows, and
         exportGarage carries every dead image into the backup. */
      const prev = vehicles.get(vehicleId);
      prev.onsuccess = () => {
        const prevData = prev.result ? prev.result.data : null;
        orphanedPhotoIds(prevData, split.data).forEach(id => tx.objectStore('photos').delete(id));
      };
      vehicles.put({ id: vehicleId, data: split.data });
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
    return idbTx(backend.db, ['meta', 'vehicles', 'photos'], 'readwrite', tx => {
      const vehicles = tx.objectStore('vehicles');
      // Read before the delete, or the vehicle's photo ids are gone with it.
      const prev = vehicles.get(vehicleId);
      prev.onsuccess = () => {
        photoIdsIn(prev.result && prev.result.data).forEach(id => tx.objectStore('photos').delete(id));
      };
      vehicles.delete(vehicleId);
      putMetaPreserving(tx, { activeId });
    }).then(() => true).catch(() => false);
  }

  /* Every localStorage key the garage owns is cleared unconditionally — a user
     may have run on IndexedDB over http and on localStorage from disk, and
     leaving either populated hands the next user the previous one's garage.
     The IndexedDB stores are only reachable when that backend is the one
     openStorage() selected, so the second half returns early otherwise.

     LEGACY_V1_KEY goes too, and that is load-bearing. hydrate() falls back to
     readLegacyV1() whenever the garage is empty, so without this delete the
     next sign-in would seed a fresh user from the previous one's pre-garage
     car. Phase 2's migration copied that key into the garage long ago, so
     nothing reachable is lost.

     So does supabase-js's own stored session (`sb-<project-ref>-auth-token`).
     auth.signOut() RESOLVES with {error} on a network failure and can return
     before removing it, so without this the next launch restores the previous
     user's still-valid session and adopt() writes their whole garage onto a
     device that was just wiped — no sign-in prompt anywhere. */
  const AUTH_TOKEN_KEY = /^sb-.*-auth-token$/;

  /* Neither enumeration route is guaranteed: the Node suite's shims and some
     privacy modes implement only getItem/setItem/removeItem. Try the standard
     key(i)/length pair first, fall back to own-property enumeration, and
     tolerate both being absent rather than throwing out of sign-out. */
  function localStorageKeys() {
    const out = [];
    try {
      if (typeof localStorage.key === 'function' && typeof localStorage.length === 'number') {
        for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i));
      } else {
        Object.keys(localStorage).forEach(k => out.push(k));
      }
    } catch (e) {}
    return out.filter(k => typeof k === 'string');
  }

  function wipe() {
    const authKeys = localStorageKeys().filter(k => AUTH_TOKEN_KEY.test(k));
    [LS_KEY, LEGACY_V1_KEY, DIRTY_KEY].concat(authKeys).forEach(k => {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    if (!backend || backend.kind !== 'idb') return Promise.resolve(true);
    return idbTx(backend.db, ['meta', 'vehicles', 'photos'], 'readwrite', tx => {
      tx.objectStore('meta').clear();
      tx.objectStore('vehicles').clear();
      tx.objectStore('photos').clear();
    }).then(() => true).catch(() => false);
  }

  function backendKind() { return backend ? backend.kind : null; }

  return {
    shouldTryIndexedDb, splitPhotos, inlinePhotos, collectInlinePhotos, applyPhotoIds, buildExport, parseImport,
    photoIdsIn, orphanedPhotoIds, unreferencedPhotoIds, normalizeRecords, importFaults,
    parseLegacyV1, readLegacyV1, migrationPlan,
    dataUrlToBlob, blobToDataUrl, openStorage, loadAll, saveVehicle, removeVehicle, wipe, backendKind
  };
});
