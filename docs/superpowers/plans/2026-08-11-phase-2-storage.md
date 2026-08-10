# Phase 2: Storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the ~5 MB storage ceiling by moving the garage into IndexedDB with photos as Blobs, while keeping the app runnable by double-clicking `index.html`.

**Architecture:** A new `storage.js` adapter presents one async API over two backends — IndexedDB where available, today's `localStorage` where it is not (`file://` in Chrome/Safari). Reads stay synchronous: the adapter hydrates the whole garage into the existing in-memory `state` at boot, so no page-rendering code changes. Only startup and `save()` become async.

**Tech Stack:** Vanilla JS (ES2020), no framework, no bundler. Node 24 LTS `node --test` for the pure transforms — **development only**, the shipped app has zero dependencies.

## Global Constraints

- **No build step.** The app must keep running by opening `index.html` directly from disk — on the `localStorage` backend.
- **No runtime dependencies.** Node is a dev tool for tests only; never `import`/`require` anything in browser code.
- `storage.js` and `schedule.js` must work **both** as a browser `<script>` (assigning to the global) and under Node `require()`.
- **The in-memory `state` shape must not change.** Page code reads `state.car.odometer`, `state.services`, `state.history[].photo` etc. directly. If rendering code needs edits, the design has gone wrong — stop and report.
- **Never show a success message for a write that failed.** Phase 1 established this and 16 call sites depend on it; it must survive the move to async.
- **Never persist a `blob:` URL.** They are per-session and dead on reload.
- **Every user-facing string goes through `t()`** and gets an Arabic entry in the `AR` dictionary in `app.js`.
- **Match existing code style:** 2-space indent, single quotes, semicolons, `const`/`let`.
- **Commit after every task.** No task leaves the tree broken.
- Run tests with bare `node --test` from the repo root. `node --test test/` is broken on this Windows/Node 24 setup.
- **Line numbers refer to the state of the file at the start of Phase 2** and drift as tasks land. Locate edits by matching the quoted "before" snippet, never by line number.

## What is testable, and what is not

Node has no IndexedDB and we allow no dependencies, so the IDB plumbing cannot be unit-tested here. The plan therefore puts all decision-making and data-shaping in **pure functions that are tested**, and keeps the IDB wrapper thin enough to verify by inspection. Do not add a test that fakes IndexedDB badly — it would give false confidence. Browser verification is the gap; the final task lists a manual checklist for the human.

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `storage.js` | Create | Backend selection, IDB + localStorage backends, migration, photo split/inline, export/import serialization |
| `test/storage.test.js` | Create | Tests for every pure function in `storage.js` |
| `app.js` | Modify | Async boot, hydrate into `state`, `save()` returns a Promise, object-URL registry |
| `index.html` | Modify | Load `storage.js` before `app.js` |
| `sw.js` | Modify | Cache `storage.js`; bump cache name |

## Data model

```
meta      { key: 'meta', schemaVersion, migratedAt, activeId }
vehicles  { id, data }          // data = today's per-vehicle object, photos stripped
photos    { id, blob }          // Blob values
```

A vehicle's `data` holds photo **ids**, never image bytes:

- `car.photo` → `''`, plus `car.photoId`
- `history[].photo` → `''`, plus `history[].photoId`
- `spending[].photo` → `''`, plus `spending[].photoId`

At hydrate time each `photoId` is resolved to an object URL and assigned back onto `.photo`, so rendering code that reads `.photo` keeps working untouched.

---

### Task 1: `storage.js` pure core

Pure, testable functions only. No IndexedDB, no wiring — the app is untouched and still runs.

**Files:**
- Create: `storage.js`
- Create: `test/storage.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `shouldTryIndexedDb(protocol, hasIndexedDb)` → `boolean`
  - `splitPhotos(data, makeId)` → `{ data, photos }` where `photos` is `{ [id]: dataUrl }`
  - `inlinePhotos(data, photosById)` → `data` with `.photo` restored to data URLs
  - `buildExport(garage, photosById, nowIso)` → export object
  - `parseImport(text)` → `{ ok: true, garage, photos }` or `{ ok: false, error }`

- [ ] **Step 1: Write the failing tests**

Create `test/storage.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { shouldTryIndexedDb, splitPhotos, inlinePhotos, buildExport, parseImport } = require('../storage.js');

const DATA_URL = 'data:image/jpeg;base64,AAAA';

function makeIdFactory() {
  let n = 0;
  return () => `p${++n}`;
}

function sampleData() {
  return {
    car: { nickname: 'Mine', photo: DATA_URL },
    history: [{ id: 'h1', photo: DATA_URL }, { id: 'h2', photo: '' }],
    spending: [{ id: 's1', photo: DATA_URL }],
    services: [{ id: 'v1', name: 'Oil' }]
  };
}

test('shouldTryIndexedDb refuses file:// and missing support', () => {
  assert.strictEqual(shouldTryIndexedDb('https:', true), true);
  assert.strictEqual(shouldTryIndexedDb('http:', true), true);
  assert.strictEqual(shouldTryIndexedDb('file:', true), false);
  assert.strictEqual(shouldTryIndexedDb('https:', false), false);
});

test('splitPhotos extracts every data URL and replaces it with an id', () => {
  const { data, photos } = splitPhotos(sampleData(), makeIdFactory());
  assert.strictEqual(data.car.photo, '');
  assert.strictEqual(data.car.photoId, 'p1');
  assert.strictEqual(data.history[0].photoId, 'p2');
  assert.strictEqual(data.spending[0].photoId, 'p3');
  assert.deepStrictEqual(Object.keys(photos).sort(), ['p1', 'p2', 'p3']);
  assert.strictEqual(photos.p1, DATA_URL);
});

test('splitPhotos does not mutate its input', () => {
  const input = sampleData();
  splitPhotos(input, makeIdFactory());
  assert.strictEqual(input.car.photo, DATA_URL);
});

test('splitPhotos never persists a blob: URL and keeps its existing id', () => {
  const input = sampleData();
  input.car.photo = 'blob:http://x/abc';
  input.car.photoId = 'existing';
  const { data, photos } = splitPhotos(input, makeIdFactory());
  assert.strictEqual(data.car.photo, '');
  assert.strictEqual(data.car.photoId, 'existing');
  assert.strictEqual(Object.values(photos).includes('blob:http://x/abc'), false);
});

test('splitPhotos clears the id when the photo was removed', () => {
  const input = sampleData();
  input.car.photo = '';
  input.car.photoId = 'stale';
  const { data } = splitPhotos(input, makeIdFactory());
  assert.strictEqual(data.car.photoId, undefined);
});

test('inlinePhotos restores data URLs, and round-trips with splitPhotos', () => {
  const original = sampleData();
  const { data, photos } = splitPhotos(original, makeIdFactory());
  const back = inlinePhotos(data, photos);
  assert.strictEqual(back.car.photo, DATA_URL);
  assert.strictEqual(back.history[0].photo, DATA_URL);
  assert.strictEqual(back.spending[0].photo, DATA_URL);
  assert.strictEqual(back.history[1].photo, '');
});

test('inlinePhotos leaves a missing photo empty rather than throwing', () => {
  const { data } = splitPhotos(sampleData(), makeIdFactory());
  const back = inlinePhotos(data, {});
  assert.strictEqual(back.car.photo, '');
});

test('buildExport is self-describing and parseImport round-trips it', () => {
  const garage = { vehicles: [{ id: 'v', data: { car: {} } }], activeId: 'v' };
  const text = JSON.stringify(buildExport(garage, { p1: DATA_URL }, '2026-08-11T00:00:00Z'));
  const out = parseImport(text);
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(out.garage, garage);
  assert.strictEqual(out.photos.p1, DATA_URL);
});

test('parseImport rejects junk and foreign files without throwing', () => {
  assert.strictEqual(parseImport('not json').ok, false);
  assert.strictEqual(parseImport('{"hello":1}').ok, false);
  assert.strictEqual(parseImport(JSON.stringify({ format: 'something-else' })).ok, false);
  assert.strictEqual(typeof parseImport('not json').error, 'string');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test`
Expected: FAIL — `Cannot find module '../storage.js'`

- [ ] **Step 3: Create `storage.js` with the pure core**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test`
Expected: PASS — 26 existing + 9 new = 35 tests

- [ ] **Step 5: Commit**

```bash
git add storage.js test/storage.test.js
git commit -m "feat: storage.js pure core — photo split/inline, export, backend choice

No wiring yet; the app is unchanged. Puts every decision and data
transformation in tested pure functions, because the IndexedDB plumbing
that follows cannot be unit-tested without a dependency."
```

---

### Task 2: The two backends and migration

Still no `app.js` changes — the adapter is built and exercised only by the next task.

**Files:**
- Modify: `storage.js`
- Modify: `test/storage.test.js`

**Interfaces:**
- Consumes: `shouldTryIndexedDb`, `splitPhotos` from Task 1.
- Produces (all async unless noted):
  - `openStorage()` → `Promise<{ kind: 'idb' | 'local' }>` — selects and initialises a backend, remembered internally
  - `loadAll()` → `Promise<{ garage, photos }>` where `photos` is `{ [id]: Blob }`
  - `saveVehicle(vehicleId, data, activeId, makeId)` → `Promise<{ ok: true, photoIds, data } | { ok: false, error }>` — the **same shape on both backends**, so callers never branch on which is live
  - `removeVehicle(vehicleId, activeId)` → `Promise<boolean>`
  - `collectInlinePhotos(data)` → `{ [photoId]: dataUrl }` (pure)
  - `backendKind()` → `'idb' | 'local' | null`

Deliberately **not** provided: `savePhoto`, `deletePhotos`, `saveGarageMeta`. An earlier draft of this header listed them, but no step needs them — `saveVehicle` writes photos and the active id along with the vehicle, and `switchVehicle` persists the new active id by calling `save()`. Adding unused entry points would be speculative.
  - `dataUrlToBlob(dataUrl)` (sync, pure-ish — uses `atob`/`Blob`, both present in Node 24 and browsers)
  - `blobToDataUrl(blob)` → `Promise<string>`

- [ ] **Step 1: Write the failing tests for the convertible pair**

Append to `test/storage.test.js`:

```js
const { dataUrlToBlob, blobToDataUrl } = require('../storage.js');

test('dataUrlToBlob produces a Blob with the declared type and byte length', async () => {
  const blob = dataUrlToBlob('data:image/jpeg;base64,AAECAw==');   // 4 bytes: 00 01 02 03
  assert.strictEqual(blob.type, 'image/jpeg');
  assert.strictEqual(blob.size, 4);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepStrictEqual([...bytes], [0, 1, 2, 3]);
});

test('dataUrlToBlob returns null for anything that is not a data URL', () => {
  assert.strictEqual(dataUrlToBlob('blob:http://x/y'), null);
  assert.strictEqual(dataUrlToBlob(''), null);
  assert.strictEqual(dataUrlToBlob(undefined), null);
});

test('blobToDataUrl round-trips dataUrlToBlob', async () => {
  const original = 'data:image/jpeg;base64,AAECAw==';
  const back = await blobToDataUrl(dataUrlToBlob(original));
  assert.strictEqual(back, original);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test`
Expected: FAIL — `dataUrlToBlob is not a function`

- [ ] **Step 3: Implement the converters**

Add inside the factory in `storage.js`, before the `return`:

```js
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
```

Extend the return to include `dataUrlToBlob` and `blobToDataUrl`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test`
Expected: PASS — 38 tests

- [ ] **Step 5: Add the IndexedDB backend**

Add inside the factory:

```js
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
```

- [ ] **Step 6: Add the localStorage backend and the selector**

The `localStorage` backend keeps photos inline as data URLs — exactly the pre-Phase-2 format — so `file://` users are no worse off than before and the existing key stays readable.

```js
  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || null; } catch (e) { return null; }
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
```

- [ ] **Step 7: Add `loadAll`, the write methods, and migration**

```js
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
        // Gate migration on `migratedAt`, NOT on the store being empty. The legacy
        // localStorage key is deliberately never deleted, so an empty-store trigger
        // would re-fire and resurrect a vehicle the user had just removed.
        if (!m.migratedAt) {
          const legacy = lsRead();
          if (legacy && Array.isArray(legacy.vehicles) && legacy.vehicles.length) {
            return migrateFromLocal(legacy)
              .then(() => loadAll())
              .catch(() => ({ garage: lsRead(), photos: {} }));
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
      // This backend rewrites the vehicle wholesale, so photos it already holds
      // must be carried over — a save that did not re-supply one must not drop it.
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
      // Read-modify-write the meta record: blindly putting a fresh one would drop
      // `migratedAt` and make migration re-fire on the next load.
      const metaReq = tx.objectStore('meta').get(META_KEY);
      metaReq.onsuccess = () => {
        const prevMeta = metaReq.result || {};
        tx.objectStore('meta').put(Object.assign({}, prevMeta, { key: META_KEY, schemaVersion: 1, activeId }));
      };
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
      tx.objectStore('meta').put({ key: META_KEY, schemaVersion: 1, activeId });
    }).then(() => true).catch(() => false);
  }

  function backendKind() { return backend ? backend.kind : null; }
```

Extend the return to include `openStorage`, `loadAll`, `saveVehicle`, `removeVehicle`, `backendKind`.

- [ ] **Step 8: Run the tests**

Run: `node --test`
Expected: PASS — 38 tests, unchanged (this step adds untestable plumbing, by design)

Also run `node --check storage.js` and confirm it parses.

- [ ] **Step 9: Commit**

```bash
git add storage.js test/storage.test.js
git commit -m "feat: IndexedDB and localStorage backends with non-destructive migration

Selects IndexedDB when available and falls back to localStorage on
file:// and on any open failure. Migration copies the existing garage
into IndexedDB and converts embedded data URLs to Blobs; the old
localStorage key is never deleted."
```

---

### Task 3: Wire `app.js` — async boot and async `save()`

The riskiest task. After it the app runs on the adapter, photos still travel as data URLs in memory.

**Files:**
- Modify: `app.js` — `load`/`save`/`persistGarage`, boot sequence, all 22 `save()` call sites, the 4 direct `persistGarage()` calls
- Modify: `index.html` — load `storage.js`
- Modify: `sw.js` — cache it

**Interfaces:**
- Consumes: `openStorage`, `loadAll`, `saveVehicle`, `removeVehicle` from Task 2; `uid` from `app.js`.
- Produces: `save()` → `Promise<boolean>`; `boot()` → `Promise<void>`.

- [ ] **Step 1: Load `storage.js` in the browser**

In `index.html`, before the `app.js` script tag:

```html
  <script src="schedule.js"></script>
  <script src="storage.js"></script>
  <script src="app.js"></script>
```

In `sw.js`, add `'./storage.js'` to `ASSETS` and change `CACHE` to `'garage-v4'`. The cache name must change or existing installs never fetch the new file.

- [ ] **Step 2: Replace the synchronous storage layer**

In `app.js`, replace `persistGarage`, `let state = load();`, `load()` and `save()` (the block from `/* Returns true when the write succeeded.` through the `function save()` line) with:

```js
/* Phase 2: persistence is async and may be backed by IndexedDB or
   localStorage. Reads stay synchronous — the whole garage is hydrated into
   `state` at boot — so page code is unchanged. */
let state = null;
let photoBlobs = {};   // photo id -> Blob, for the active session

/* Object URLs created for stored photo Blobs. The app has no view-teardown
   hook — go() replaces innerHTML wholesale — so these are revoked at the
   start of each navigation (Task 4). Without that the app leaks one URL per
   photo per render. */
let liveObjectUrls = [];
function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  liveObjectUrls.push(url);
  return url;
}
function revokeObjectUrls() {
  liveObjectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
  liveObjectUrls = [];
}

function hydrate(garage, photos) {
  if (!garage || !Array.isArray(garage.vehicles) || !garage.vehicles.length) {
    garage = { vehicles: [{ id: uid(), data: normalizeData(seed()) }], activeId: null };
    garage.activeId = garage.vehicles[0].id;
  }
  garage.vehicles.forEach(v => {
    normalizeData(v.data);
    resolvePhotos(v.data, photos);
  });
  const active = garage.vehicles.find(v => v.id === garage.activeId) || garage.vehicles[0];
  garage.activeId = active.id;
  return { garage, state: active.data };
}

/* Turn stored photo ids into object URLs so `.photo` keeps working in every
   render path. Registered for revocation on the next navigation. */
function resolvePhotos(data, photos) {
  const slots = [data.car].concat(data.history || [], data.spending || []).filter(Boolean);
  slots.forEach(o => {
    if (o.photoId && photos[o.photoId]) o.photo = objectUrl(photos[o.photoId]);
  });
}

function save() {
  const v = garage.vehicles.find(x => x.id === garage.activeId);
  if (!v) return Promise.resolve(false);
  v.data = state;
  return saveVehicle(v.id, state, garage.activeId, uid).then(res => {
    if (res.ok) { applyPhotoIds(state, res.data); return true; }
    const err = res.error;
    toast(isQuotaError(err)
      ? t('Storage is full — your change was NOT saved. Remove some receipt photos.')
      : t('Could not save your change.'), 'warn');
    return false;
  });
}

/* After a successful write the stored copy knows each photo's id; copy those
   ids back into the live objects so the next save does not re-upload them. */
function applyPhotoIds(live, stored) {
  const a = [live.car].concat(live.history || [], live.spending || []).filter(Boolean);
  const b = [stored.car].concat(stored.history || [], stored.spending || []).filter(Boolean);
  a.forEach((o, i) => { if (b[i] && b[i].photoId) o.photoId = b[i].photoId; });
}
```

- [ ] **Step 3: Make the boot sequence async**

Replace the boot block at the end of `app.js` (from `$('#settingsBtn').onclick = openSettings;` through `go('dashboard');`) with:

```js
/* ---------- boot ---------- */
$('#settingsBtn').onclick = openSettings;
$('#openProfile').onclick = openSettings;
$('#garageBtn').onclick = openGarage;
lang = localStorage.getItem('garage.lang') || 'en';
document.documentElement.setAttribute('lang', lang);
document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
applyNavLabels();

openStorage()
  .then(loadAll)
  .then(({ garage: g, photos }) => {
    photoBlobs = photos || {};
    const h = hydrate(g, photoBlobs);
    garage = h.garage;
    state = h.state;
    if (!g) return save();          // first run — persist the seed
  })
  .then(() => {
    applyAccent();
    renderTopbar();
    go('dashboard');
  })
  .catch(err => {
    document.getElementById('view').innerHTML =
      `<div class="card" style="padding:20px"><h3>${t('Could not open your garage')}</h3><p style="color:var(--text-2);margin-top:8px">${t('Your data is safe. Please reload the page.')}</p></div>`;
    console.error(err);
  });
```

`switchVehicle` also assigns `state`, so it stays synchronous but its `persistGarage()` becomes `saveGarageMeta`-equivalent: replace its `persistGarage();` with `save();`.

- [ ] **Step 4: Make the 22 `save()` call sites await the result**

16 sites already read `const ok = save();`. Each becomes an `async` handler with `await`:

```js
// before
b.onclick = () => {
  ...
  const ok = save(); closeModal(); go(current); if (ok) toast('Mileage updated');
};
// after
b.onclick = async () => {
  ...
  const ok = await save(); closeModal(); go(current); if (ok) toast('Mileage updated');
};
```

Apply the same transformation to every site. The 6 sites with no success toast still need `await` if anything after them depends on the write having landed; where they merely navigate, `save();` without `await` is acceptable — but add `// fire-and-forget: nothing downstream reads the result` so the choice is visible.

For the direct `persistGarage()` calls in `openAddVehicle` and `deleteVehicle`, use `saveVehicle`/`removeVehicle` and `await` them the same way.

- [ ] **Step 5: Add the Arabic strings**

Before the closing `};` of the `AR` object:

```js

  // storage
  'Could not open your garage': 'تعذّر فتح المرآب',
  'Your data is safe. Please reload the page.': 'بياناتك آمنة. يرجى إعادة تحميل الصفحة.',
```

- [ ] **Step 6: Verify**

Run: `node --test` → 38 pass.
Run: `node --check app.js && node --check storage.js` → both parse.
Run: `grep -n "persistGarage" app.js` → expect no matches; the function is gone.
Run: `grep -c "const ok = save()" app.js` → expect 16.
Confirm every one of those 16 is inside an `async` function and uses `await`.

- [ ] **Step 7: Commit**

```bash
git add app.js index.html sw.js
git commit -m "feat: run the app on the async storage adapter

Boot hydrates the garage into the existing in-memory state, so no
rendering code changes. save() returns a Promise and its call sites
await it, preserving Phase 1's guarantee that a success message is
never shown for a failed write."
```

---

### Task 4: Photos as Blobs end-to-end

**Files:**
- Modify: `app.js` — object-URL registry, revoke on navigation

**Interfaces:**
- Consumes: `go()`, `resolvePhotos`, `objectUrl`, `revokeObjectUrls`, `photoBlobs` — all introduced in Task 3.
- Produces: `refreshPhotoUrls()` → `void`.

Note the registry itself (`objectUrl`/`revokeObjectUrls`) already landed in Task 3, because Task 3's `resolvePhotos` calls `objectUrl` at boot — defining it later would throw a `ReferenceError` before the first paint. This task wires up *revocation*, which Task 3 deliberately left unhooked.

- [ ] **Step 1: Re-resolve photos per navigation**

Photos are re-resolved after revocation, so the URLs a render uses are always live. In `go()`, replace:

```js
function go(route, intent) {
  current = route;
  navIntent = intent || null;
```

with:

```js
function go(route, intent) {
  revokeObjectUrls();
  refreshPhotoUrls();
  current = route;
  navIntent = intent || null;
```

And add:

```js
/* Re-create object URLs for the active vehicle after a revocation sweep. */
function refreshPhotoUrls() {
  if (!state || !photoBlobs) return;
  resolvePhotos(state, photoBlobs);
}
```

- [ ] **Step 2: Keep newly added photos displayable before reload**

`photoPicker` hands `app.js` a fresh data URL. That is assigned to `.photo` and rendered directly — a data URL renders fine, so nothing breaks. After `save()`, `applyPhotoIds` records the id.

But the new Blob is not yet in `photoBlobs`, so the next navigation's `refreshPhotoUrls` would find `photoId` with no Blob and leave `.photo` as the data URL — correct, just not yet deduplicated. Close the loop in `save()`: after `applyPhotoIds`, cache the new Blobs.

In `save()`, replace:

```js
    if (res.ok) { applyPhotoIds(state, res.data); return true; }
```

with:

```js
    if (res.ok) {
      applyPhotoIds(state, res.data);
      cacheNewPhotos(state, res.photoIds);
      return true;
    }
```

And add:

```js
/* Keep just-saved images in the session cache so later navigations render
   them from a Blob like every other photo, instead of a lingering data URL. */
function cacheNewPhotos(live, photoIds) {
  if (!photoIds || !photoIds.length) return;
  const slots = [live.car].concat(live.history || [], live.spending || []).filter(Boolean);
  slots.forEach(o => {
    if (o.photoId && photoIds.indexOf(o.photoId) >= 0 && !photoBlobs[o.photoId]) {
      const blob = dataUrlToBlob(o.photo);
      if (blob) photoBlobs[o.photoId] = blob;
    }
  });
}
```

- [ ] **Step 3: Verify**

Run: `node --test` → 38 pass. `node --check app.js` → parses.
Confirm by reading `go()` that revocation happens **before** any render call, not after.
Confirm `revokeObjectUrls()` is never called between a render and the user seeing it — a revoked URL renders as a broken image.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: render stored photos from Blobs via revocable object URLs"
```

---

### Task 5: Export and import

**Files:**
- Modify: `app.js` — two buttons in Settings, plus handlers
- Modify: `storage.js` if a read-all-photos helper is needed

**Interfaces:**
- Consumes: `buildExport`, `parseImport`, `blobToDataUrl`, `dataUrlToBlob` from Tasks 1-2.
- Produces: `openBackup()` — a Settings section with Export and Import.

- [ ] **Step 1: Add the export handler**

```js
/* A backup the user controls, before any server exists. Photos are inlined
   as base64 so a single file is the whole garage. */
async function exportGarage() {
  const photos = {};
  await Promise.all(Object.keys(photoBlobs).map(async id => { photos[id] = await blobToDataUrl(photoBlobs[id]); }));
  const payload = buildExport(garage, photos, new Date().toISOString());
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `garage-backup-${isoDate(today())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Backup downloaded');
}
```

- [ ] **Step 2: Add the import handler**

Import **replaces** the garage. It must ask first — this is destructive.

```js
function importGarage(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    const parsed = parseImport(reader.result);
    if (!parsed.ok) return toast(parsed.error, 'warn');
    if (!confirm(t('Importing replaces everything currently in your garage. Continue?'))) return;
    garage = parsed.garage;
    photoBlobs = {};
    Object.keys(parsed.photos).forEach(id => {
      const blob = dataUrlToBlob(parsed.photos[id]);
      if (blob) photoBlobs[id] = blob;
    });
    garage.vehicles.forEach(v => normalizeData(v.data));
    const active = garage.vehicles.find(v => v.id === garage.activeId) || garage.vehicles[0];
    garage.activeId = active.id;
    state = active.data;
    let ok = true;
    for (const v of garage.vehicles) {
      const res = await saveVehicle(v.id, v.data, garage.activeId, uid);
      if (res !== true && !(res && res.ok)) ok = false;
    }
    closeModal();
    applyAccent(); renderTopbar(); go('dashboard');
    toast(ok ? 'Garage restored' : 'Restored, but some data could not be saved', ok ? undefined : 'warn');
  };
  reader.readAsText(file);
}
```

- [ ] **Step 3: Add the Settings UI**

In `openSettings`, find the "Remove this vehicle" block near the end:

```js
    if (garage.vehicles.length > 1) {
      const del = el('button', 'btn block ghost', t('Remove this vehicle'));
      del.style.cssText = 'margin-top:8px;color:var(--danger)';
      del.onclick = () => deleteVehicle(garage.activeId);
      card.appendChild(del);
    }
```

and insert immediately **after** it, still inside the `openModal` callback:

```js
    const backup = el('div');
    backup.style.cssText = 'margin-top:22px;padding-top:16px;border-top:1px solid var(--stroke)';
    backup.innerHTML = `<div class="section-title"><div class="section-title-left"><h2>${t('Backup & restore')}</h2></div></div>
      <p style="font-size:12px;color:var(--text-2);line-height:1.55;margin-bottom:12px">${t('A backup file holds every vehicle, service, receipt and photo.')}</p>`;
    const exp = el('button', 'btn block', t('Export backup'));
    exp.onclick = exportGarage;
    const imp = el('button', 'btn block ghost', t('Import backup'));
    imp.style.marginTop = '8px';
    const impFile = el('input');
    impFile.type = 'file';
    impFile.accept = 'application/json';
    impFile.hidden = true;
    impFile.onchange = ev => { const f = ev.target.files[0]; if (f) importGarage(f); };
    imp.onclick = () => impFile.click();
    backup.append(exp, imp, impFile);
    card.appendChild(backup);
```

This reuses the existing `.btn`, `.btn.ghost` and `.section-title` classes, so no CSS change is needed.

- [ ] **Step 4: Add the Arabic strings**

```js

  // backup
  'Backup & restore': 'النسخ الاحتياطي والاستعادة',
  'A backup file holds every vehicle, service, receipt and photo.': 'ملف النسخة الاحتياطية يحتوي على كل مركبة وصيانة وإيصال وصورة.',
  'Export backup': 'تصدير نسخة احتياطية',
  'Import backup': 'استيراد نسخة احتياطية',
  'Backup downloaded': 'تم تنزيل النسخة الاحتياطية',
  'Garage restored': 'تمت استعادة المرآب',
  'Restored, but some data could not be saved': 'تمت الاستعادة، لكن تعذّر حفظ بعض البيانات',
  'Importing replaces everything currently in your garage. Continue?': 'الاستيراد سيستبدل كل ما في مرآبك حالياً. هل تريد المتابعة؟',
  'That file is not valid JSON.': 'هذا الملف ليس JSON صالحاً.',
  'That is not a Garage backup file.': 'هذا ليس ملف نسخة احتياطية للمرآب.',
  'That backup file is incomplete.': 'ملف النسخة الاحتياطية غير مكتمل.',
```

- [ ] **Step 5: Verify and commit**

Run: `node --test` → 38 pass. `node --check app.js` → parses.

```bash
git add app.js storage.js
git commit -m "feat: export and import the whole garage as a JSON backup"
```

---

## Manual browser checklist (for the human)

Nothing in this plan is verified in a browser — no browser is available in the build environment, and IndexedDB cannot be tested from Node. These must be checked by hand before merge:

- [ ] Serve the folder (`python3 -m http.server 8777`) and load it. Existing data appears intact.
- [ ] DevTools → Application → IndexedDB → `garage` contains `meta`, `vehicles`, `photos`.
- [ ] `localStorage['garage.mazda3.v2']` is **still present** — migration is non-destructive.
- [ ] Add a car photo and a receipt photo; reload; both still render.
- [ ] Add ~50 receipt photos without hitting a quota error.
- [ ] Open `index.html` by double-clicking. The app works, on the `localStorage` backend (`backendKind()` returns `'local'` in the console).
- [ ] Export a backup, clear site data, import it — the garage returns, photos included.
- [ ] Navigate between all pages repeatedly; DevTools memory does not grow with leaked `blob:` URLs.
- [ ] Switch to Arabic and confirm the new strings render right-to-left.

## Definition of done

- [ ] `node --test` passes with 38 tests.
- [ ] `node --check` passes on `app.js`, `storage.js`, `schedule.js`, `sw.js`.
- [ ] `grep -n "persistGarage" app.js` returns nothing.
- [ ] No `blob:` URL is ever written to storage.
- [ ] The manual browser checklist above is complete.
