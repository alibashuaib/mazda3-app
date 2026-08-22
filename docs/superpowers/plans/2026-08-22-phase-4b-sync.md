# Phase 4b Sync Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two devices signed in on the same account, both left open, converge on their own — outbox-queued vehicle/photo/tombstone sync, drained on reconnect, plus incremental pulls and photo upload/download through Supabase Storage.

**Architecture:** `storage.js` gains a fourth object store (`outbox`) and dual-backend meta/photo-blob accessors, mirroring how `vehicles`/`photos` already work on both IndexedDB and the `localStorage` fallback. `account.js`'s `dirty()`/`onSaved()`/`pushTombstone()` are replaced by `enqueue*()` + `drain()` + `sync()`; a `window.online` listener in `app.js` is the only new trigger. Sign-in's existing `adopt()`/`reconcile()` (4a) is untouched — incremental pull is a second, later mechanism, not a replacement.

**Tech Stack:** Vanilla JS, `node --test`, `fake-indexeddb` (already a devDependency), the vendored Supabase UMD client, Playwright for `e2e/smoke.spec.js` presence checks.

**Spec:** `docs/superpowers/specs/2026-08-22-phase-4b-sync-design.md`

## Global Constraints

- No new devDependencies. `fake-indexeddb`, `linkedom`, `@playwright/test` are everything this repo uses.
- Every new `storage.js` function resolves the same way on both backends (`kind: 'idb'` and `kind: 'local'`) except where the spec explicitly scopes photo sync to IndexedDB (photos are `Blob`-only; the `localStorage` backend has never stored blobs and keeps degrading the way 4a already documented).
- A failed outbox entry is left in the outbox untouched — no backoff timer, no retry counter (spec: "Decisions → Drain order").
- `lastPulledAt` only advances after every row in a pull batch has been applied (spec: "Incremental pull is additive").
- Sign-in's `reconcile()`/`adopt()` behavior from 4a must not change — every existing test in `test/account.test.js` covering sign-in stays green, unmodified, throughout this plan.
- `wipe()` must clear every new key/store this plan adds, the same way it already clears `DIRTY_KEY` and the three existing IDB stores (`storage.js:544-555`).

---

## Task 1: Outbox store — dual-backend queue in `storage.js`

**Files:**
- Modify: `storage.js` (add `outbox` IDB store, `DB_VERSION` bump, `outboxAdd`/`outboxAll`/`outboxRemove`, extend `wipe()`)
- Test: `test/storage.test.js` (pure-logic pieces), `test/idb.test.js` (IDB plumbing)

**Interfaces:**
- Produces: `storage.outboxAdd(entry) => Promise<boolean>`, `storage.outboxAll() => Promise<entry[]>`, `storage.outboxRemove(id) => Promise<boolean>`, where `entry` is `{ id, kind, vehicleId, photoId?, data?, createdAt }`.

- [ ] **Step 1: Write the failing IDB test**

Add to `test/idb.test.js`, following the file's existing `freshStorage()` helper pattern:

```js
test('outboxAdd/outboxAll/outboxRemove round-trip on the IndexedDB backend', async () => {
  const storage = freshStorage();
  await storage.openStorage({ protocol: 'https:', hasIndexedDb: true });

  await storage.outboxAdd({ id: 'o1', kind: 'vehicle', vehicleId: 'v1', data: { car: {} }, createdAt: '2026-08-22T00:00:00.000Z' });
  await storage.outboxAdd({ id: 'o2', kind: 'tombstone', vehicleId: 'v2', createdAt: '2026-08-22T00:00:01.000Z' });

  const all = await storage.outboxAll();
  assert.strictEqual(all.length, 2);
  assert.ok(all.some(e => e.id === 'o1' && e.kind === 'vehicle'));

  await storage.outboxRemove('o1');
  const after = await storage.outboxAll();
  assert.deepStrictEqual(after.map(e => e.id), ['o2']);
});

test('wipe() empties the outbox store', async () => {
  const storage = freshStorage();
  await storage.openStorage({ protocol: 'https:', hasIndexedDb: true });
  await storage.outboxAdd({ id: 'o1', kind: 'vehicle', vehicleId: 'v1', createdAt: '2026-08-22T00:00:00.000Z' });

  await storage.wipe();

  assert.deepStrictEqual(await storage.outboxAll(), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- test/idb.test.js`
Expected: FAIL — `storage.outboxAdd is not a function`

- [ ] **Step 3: Write the failing localStorage-backend test**

Add to `test/storage.test.js` (this file exercises the pure/local-backend paths without a real IndexedDB):

```js
test('outbox round-trips on the localStorage backend', async () => {
  global.localStorage = (() => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } };
  })();
  delete require.cache[require.resolve('../storage.js')];
  const storage = require('../storage.js');
  await storage.openStorage({ protocol: 'http:', hasIndexedDb: false });

  await storage.outboxAdd({ id: 'o1', kind: 'photo', photoId: 'p1', createdAt: '2026-08-22T00:00:00.000Z' });
  assert.strictEqual((await storage.outboxAll()).length, 1);

  await storage.outboxRemove('o1');
  assert.deepStrictEqual(await storage.outboxAll(), []);
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test -- test/storage.test.js`
Expected: FAIL — `storage.outboxAdd is not a function`

- [ ] **Step 5: Implement in `storage.js`**

Bump the version and register the store, in `idbOpen()` (`storage.js:291-306`):

```js
  const DB_NAME = 'garage';
  const DB_VERSION = 2;   // was 1 — adds the `outbox` store
```

```js
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('vehicles')) db.createObjectStore('vehicles', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
      };
```

Add the outbox key and accessors near `DIRTY_KEY` (`storage.js:244-252`):

```js
  const OUTBOX_KEY = 'garage.sync.outbox';   // localStorage-backend fallback, JSON array
```

Add the functions after `removeVehicle` (`storage.js:507`, before `wipe`):

```js
  function outboxLsRead() {
    try { const v = JSON.parse(localStorage.getItem(OUTBOX_KEY)); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function outboxLsWrite(entries) {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries)); return true; }
    catch (e) { return false; }
  }

  function outboxAdd(entry) {
    if (backend.kind === 'local') {
      const q = outboxLsRead(); q.push(entry);
      return Promise.resolve(outboxLsWrite(q));
    }
    return idbTx(backend.db, ['outbox'], 'readwrite', tx => { tx.objectStore('outbox').put(entry); })
      .then(() => true).catch(() => false);
  }

  function outboxAll() {
    if (backend.kind === 'local') return Promise.resolve(outboxLsRead());
    return idbGetAll(backend.db, 'outbox');
  }

  function outboxRemove(id) {
    if (backend.kind === 'local') return Promise.resolve(outboxLsWrite(outboxLsRead().filter(e => e.id !== id)));
    return idbTx(backend.db, ['outbox'], 'readwrite', tx => { tx.objectStore('outbox').delete(id); })
      .then(() => true).catch(() => false);
  }
```

Extend `wipe()` (`storage.js:544-555`) to clear the new key and store:

```js
  function wipe() {
    const authKeys = localStorageKeys().filter(k => AUTH_TOKEN_KEY.test(k));
    [LS_KEY, LEGACY_V1_KEY, DIRTY_KEY, OUTBOX_KEY].concat(authKeys).forEach(k => {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    if (!backend || backend.kind !== 'idb') return Promise.resolve(true);
    return idbTx(backend.db, ['meta', 'vehicles', 'photos', 'outbox'], 'readwrite', tx => {
      tx.objectStore('meta').clear();
      tx.objectStore('vehicles').clear();
      tx.objectStore('photos').clear();
      tx.objectStore('outbox').clear();
    }).then(() => true).catch(() => false);
  }
```

Export the three new functions from the module's return statement (`storage.js:559-564`):

```js
  return {
    shouldTryIndexedDb, splitPhotos, inlinePhotos, collectInlinePhotos, applyPhotoIds, buildExport, parseImport,
    photoIdsIn, orphanedPhotoIds, unreferencedPhotoIds, normalizeRecords, importFaults,
    parseLegacyV1, readLegacyV1, migrationPlan, DIRTY_KEY,
    dataUrlToBlob, blobToDataUrl, openStorage, loadAll, saveVehicle, removeVehicle, wipe, backendKind,
    outboxAdd, outboxAll, outboxRemove
  };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- test/idb.test.js test/storage.test.js`
Expected: PASS, all tests including the two new ones

- [ ] **Step 7: Run the full suite to check for regressions**

Run: `npm test`
Expected: PASS, 257/257 plus the new tests (no existing test references `DB_VERSION` or asserts the exact store list, so the bump is additive)

- [ ] **Step 8: Commit**

```bash
git add storage.js test/idb.test.js test/storage.test.js
git commit -m "feat: add the outbox object store, on both backends"
```

---

## Task 2: Dual-backend meta accessors — `lastPulledAt`

**Files:**
- Modify: `storage.js` (add `metaGet`/`metaSet`)
- Test: `test/idb.test.js`, `test/storage.test.js`

**Interfaces:**
- Consumes: `putMetaPreserving(tx, patch)` (`storage.js:330-337`, IDB-only, existing).
- Produces: `storage.metaGet() => Promise<object>`, `storage.metaSet(patch) => Promise<boolean>`.

**Why a new pair, not `loadAll()`:** `loadAll()` returns the whole garage and photos — expensive to call just to read one timestamp, and the `local` backend's `loadAll()` never touches meta at all (`storage.js:379-382`). Phase 4b's incremental pull needs a fast, backend-agnostic single field, and the `local` backend needs *something* to persist it in, since it has no `meta` object store.

- [ ] **Step 1: Write the failing tests**

Add to `test/idb.test.js`:

```js
test('metaGet/metaSet round-trip on the IndexedDB backend', async () => {
  const storage = freshStorage();
  await storage.openStorage({ protocol: 'https:', hasIndexedDb: true });

  assert.deepStrictEqual(await storage.metaGet(), {});

  await storage.metaSet({ lastPulledAt: '2026-08-22T00:00:00.000Z' });
  assert.strictEqual((await storage.metaGet()).lastPulledAt, '2026-08-22T00:00:00.000Z');
});

test('metaSet merges rather than replacing', async () => {
  const storage = freshStorage();
  await storage.openStorage({ protocol: 'https:', hasIndexedDb: true });
  await storage.metaSet({ lastPulledAt: 'a' });

  await storage.metaSet({ somethingElse: 'b' });

  const m = await storage.metaGet();
  assert.strictEqual(m.lastPulledAt, 'a');
  assert.strictEqual(m.somethingElse, 'b');
});
```

Add to `test/storage.test.js`:

```js
test('metaGet/metaSet round-trip on the localStorage backend', async () => {
  global.localStorage = (() => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } };
  })();
  delete require.cache[require.resolve('../storage.js')];
  const storage = require('../storage.js');
  await storage.openStorage({ protocol: 'http:', hasIndexedDb: false });

  await storage.metaSet({ lastPulledAt: 'x' });
  assert.strictEqual((await storage.metaGet()).lastPulledAt, 'x');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/idb.test.js test/storage.test.js`
Expected: FAIL — `storage.metaGet is not a function`

- [ ] **Step 3: Implement**

Add near the other keys (`storage.js:244-252`):

```js
  const META_LS_KEY = 'garage.sync.meta';   // localStorage-backend meta, since that backend has no `meta` store
```

Add after the outbox functions from Task 1:

```js
  function metaGet() {
    if (backend.kind === 'local') {
      try { return Promise.resolve(JSON.parse(localStorage.getItem(META_LS_KEY)) || {}); }
      catch (e) { return Promise.resolve({}); }
    }
    return idbGetAll(backend.db, 'meta').then(rows => rows.find(x => x.key === META_KEY) || {});
  }

  function metaSet(patch) {
    if (backend.kind === 'local') {
      try {
        const prev = JSON.parse(localStorage.getItem(META_LS_KEY)) || {};
        localStorage.setItem(META_LS_KEY, JSON.stringify(Object.assign({}, prev, patch)));
        return Promise.resolve(true);
      } catch (e) { return Promise.resolve(false); }
    }
    return idbTx(backend.db, ['meta'], 'readwrite', tx => putMetaPreserving(tx, patch))
      .then(() => true).catch(() => false);
  }
```

Add `META_LS_KEY` to `wipe()`'s local-key list (`storage.js:546`, edited in Task 1):

```js
    [LS_KEY, LEGACY_V1_KEY, DIRTY_KEY, OUTBOX_KEY, META_LS_KEY].concat(authKeys).forEach(k => {
```

Export `metaGet`, `metaSet` from the return statement.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- test/idb.test.js test/storage.test.js`
Expected: PASS

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS, no regressions

- [ ] **Step 6: Commit**

```bash
git add storage.js test/idb.test.js test/storage.test.js
git commit -m "feat: add dual-backend metaGet/metaSet, for lastPulledAt"
```

---

## Task 3: Photo blob accessors — IndexedDB-only, for upload/download

**Files:**
- Modify: `storage.js` (add `getPhotoBlob`/`putPhotoBlob`)
- Test: `test/idb.test.js`, `test/storage.test.js`

**Interfaces:**
- Produces: `storage.getPhotoBlob(id) => Promise<Blob|null>`, `storage.putPhotoBlob(id, blob) => Promise<boolean>`.
- **Scoped to the IndexedDB backend only** — the `localStorage` backend has never stored a separate `Blob`; both resolve `null`/`false` there. This is the boundary the design doc's "Photos: uploaded through the outbox" section assumes: a `photo` outbox entry with no local blob to find is a no-op drain, not an error (Task 5 covers the drain side).

- [ ] **Step 1: Write the failing tests**

Add to `test/idb.test.js`:

```js
test('getPhotoBlob/putPhotoBlob round-trip on the IndexedDB backend', async () => {
  const storage = freshStorage();
  await storage.openStorage({ protocol: 'https:', hasIndexedDb: true });
  const blob = storage.dataUrlToBlob(DATA_URL);

  assert.strictEqual(await storage.getPhotoBlob('p1'), null);

  await storage.putPhotoBlob('p1', blob);
  const got = await storage.getPhotoBlob('p1');
  assert.strictEqual(got.type, blob.type);
});
```

Add to `test/storage.test.js`:

```js
test('getPhotoBlob/putPhotoBlob are no-ops on the localStorage backend', async () => {
  global.localStorage = (() => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } };
  })();
  delete require.cache[require.resolve('../storage.js')];
  const storage = require('../storage.js');
  await storage.openStorage({ protocol: 'http:', hasIndexedDb: false });

  assert.strictEqual(await storage.putPhotoBlob('p1', {}), false);
  assert.strictEqual(await storage.getPhotoBlob('p1'), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/idb.test.js test/storage.test.js`
Expected: FAIL — `storage.getPhotoBlob is not a function`

- [ ] **Step 3: Implement**

Add after the meta functions from Task 2:

```js
  function getPhotoBlob(id) {
    if (!backend || backend.kind !== 'idb') return Promise.resolve(null);
    return new Promise(resolve => {
      const req = backend.db.transaction('photos', 'readonly').objectStore('photos').get(id);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => resolve(null);
    });
  }

  function putPhotoBlob(id, blob) {
    if (!backend || backend.kind !== 'idb') return Promise.resolve(false);
    return idbTx(backend.db, ['photos'], 'readwrite', tx => { tx.objectStore('photos').put({ id, blob }); })
      .then(() => true).catch(() => false);
  }
```

Export both from the return statement.

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- test/idb.test.js test/storage.test.js`
Expected: PASS

- [ ] **Step 5: Full suite, commit**

```bash
npm test
git add storage.js test/idb.test.js test/storage.test.js
git commit -m "feat: add getPhotoBlob/putPhotoBlob for the IndexedDB backend"
```

---

## Task 4: Outbox-based enqueue and drain, replacing `dirty()`/`onSaved()`/`pushTombstone()`

**Files:**
- Modify: `src/data/account.js` (remove `dirty`/`setDirty`/`markDirty`/`clearDirty`/`onSaved`; rework `pushTombstone` into `pushTombstoneRow` + `enqueueTombstone`; add `enqueue`/`enqueueVehicle`/`drain`/`outboxSize`)
- Modify: `src/data/session.js` (`afterSave` hook passes `photoIds` too — needed by Task 5, added here so the signature changes once)
- Modify: `app.js` (three call sites: `afterSave` config at `app.js:2320`, `openAddVehicle` at `app.js:100`, `deleteVehicle` at `app.js:120`, `importGarage` at `app.js:190` and `app.js:195`; Settings status line at `app.js:1625`)
- Test: `test/account.test.js`, `test/session.test.js`

**Interfaces:**
- Consumes: `deps.outboxAdd/outboxAll/outboxRemove` (Task 1).
- Produces: `account.enqueueVehicle(id, data) => Promise<boolean>`, `account.enqueueTombstone(id) => Promise<boolean>`, `account.drain() => Promise<number>` (returns remaining outbox length), `account.outboxSize() => Promise<number>`.

**Note on ordering within this task:** photo entries are added in Task 5, once `enqueue`'s plumbing exists. This task's `drain()` only knows `vehicle` and `tombstone` kinds; Task 5 extends it with `photo`. Sorting by kind (`photo` before `vehicle` before `tombstone`) is written here so Task 5 doesn't have to touch the ordering logic again — only add the `photo` case to `drainOne`.

- [ ] **Step 1: Write the failing tests**

In `test/account.test.js`, replace the tests that assert against `dirty()` (search for `account.dirty()` — used in the "signIn refuses" style tests and the `onSaved` tests around the module) with outbox-based equivalents. Add:

```js
test('enqueueVehicle adds a vehicle entry to the outbox', async () => {
  account.reset();
  account.configure({ client: fullClient({ rows: [] }), protocol: 'https:' });
  account.setUserForTest({ id: 'u1' });

  await account.enqueueVehicle('v1', { car: { nickname: 'A' } });

  assert.strictEqual(await account.outboxSize(), 1);
});

test('enqueueVehicle is a no-op when signed out', async () => {
  account.reset();
  account.configure({ client: fullClient({ rows: [] }), protocol: 'https:' });

  await account.enqueueVehicle('v1', { car: {} });

  assert.strictEqual(await account.outboxSize(), 0);
});

test('drain() pushes a queued vehicle entry and removes it on success', async () => {
  account.reset();
  const client = fullClient({ rows: [] });
  account.configure({ client, protocol: 'https:' });
  account.setUserForTest({ id: 'u1' });
  await account.enqueueVehicle('v1', { car: { nickname: 'A' } });

  const remaining = await account.drain();

  assert.strictEqual(remaining, 0);
  assert.strictEqual(client.calls.vehicles.length, 1);
  assert.strictEqual(client.calls.vehicles[0].id, 'v1');
});

test('drain() leaves a failed push queued for the next drain', async () => {
  account.reset();
  const client = fullClient({ rows: [], failSelect: false });
  client.from = table => ({
    upsert: () => Promise.resolve({ error: new Error('offline') }),
    select: () => ({ is: () => Promise.resolve({ data: [], error: null }), maybeSingle: () => Promise.resolve({ data: null, error: null }) })
  });
  account.configure({ client, protocol: 'https:' });
  account.setUserForTest({ id: 'u1' });
  await account.enqueueVehicle('v1', { car: {} });

  const remaining = await account.drain();

  assert.strictEqual(remaining, 1, 'a failed push must stay in the outbox, not be dropped');
});

test('enqueueTombstone drains as a delete-marker upsert', async () => {
  account.reset();
  const client = fullClient({ rows: [] });
  account.configure({ client, protocol: 'https:' });
  account.setUserForTest({ id: 'u1' });
  await account.enqueueTombstone('v1');

  await account.drain();

  assert.strictEqual(client.calls.vehicles.length, 1);
  assert.ok(client.calls.vehicles[0].deleted_at, 'a tombstone entry must upsert a non-null deleted_at');
  assert.strictEqual(await account.outboxSize(), 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/account.test.js`
Expected: FAIL — `account.enqueueVehicle is not a function`

- [ ] **Step 3: Implement in `src/data/account.js`**

Remove `dirty()`, `setDirty()`, `markDirty()`, `clearDirty()` (`src/data/account.js:93-106`), `onSaved()` (the function whose doc comment starts "session.js calls this through env.afterSave"), and the standalone `pushTombstone()` (`src/data/account.js` — keep its upsert body, rename as shown below).

Replace `pushTombstone()` with:

```js
  /* The drain-time push for a tombstone entry. No dirty-list side effect —
     the outbox entry IS the record of "this still needs pushing"; drain()
     removes it on success, same as a vehicle entry. */
  function pushTombstoneRow(id) {
    if (!_user || !env.client) return Promise.resolve(false);
    const stamp = nowIso();
    return Promise.resolve().then(() => env.client.from('vehicles').upsert({
      id, data: {}, updated_at: stamp, deleted_at: stamp
    })).then(res => {
      if (res && res.error) throw res.error;
      return true;
    }).catch(() => false);
  }
```

Add the outbox surface, in the same spot `onSaved` used to live:

```js
  /* One outbox entry. `id` is the entry's own id, distinct from vehicleId —
     a vehicle and its photo can both be queued under the same vehicleId. */
  function enqueue(entry) {
    if (!_user || !env.client) return Promise.resolve(false);
    return deps.outboxAdd(Object.assign({ id: deps.uid(), createdAt: nowIso() }, entry));
  }

  /* session.js's afterSave hook calls this after a successful LOCAL write.
     Snapshots the stripped data now, not at drain time — the live record may
     have changed again, or the vehicle may have been deleted, before the
     outbox is next drained. */
  function enqueueVehicle(id, data) {
    return enqueue({ kind: 'vehicle', vehicleId: id, data: stripPhotos(data) });
  }

  function enqueueTombstone(id) {
    return enqueue({ kind: 'tombstone', vehicleId: id });
  }

  function outboxSize() {
    return deps.outboxAll().then(entries => entries.length);
  }

  /* photo < vehicle < tombstone — a photo a vehicle row references must exist
     on the server before the row does; a tombstone drains last so an edit
     enqueued just before a delete of the same vehicle cannot resurrect it. */
  const KIND_ORDER = { photo: 0, vehicle: 1, tombstone: 2 };

  function drainOne(entry) {
    const run = entry.kind === 'tombstone' ? pushTombstoneRow(entry.vehicleId)
      : pushVehicle(entry.vehicleId, entry.data);
    return run.then(ok => ok && deps.outboxRemove(entry.id)).catch(() => {});
  }

  function drain() {
    if (!_user || !env.client) return Promise.resolve(0);
    return deps.outboxAll().then(entries => {
      const sorted = entries.slice().sort((a, b) =>
        (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (a.createdAt < b.createdAt ? -1 : 1));
      return sorted.reduce((p, e) => p.then(() => drainOne(e)), Promise.resolve());
    }).then(() => deps.outboxAll()).then(remaining => remaining.length);
  }
```

Update the returned surface (find the `return { ... }` near the end of `account.js`) to remove `dirty, markDirty, clearDirty` and `onSaved`, `pushTombstone`, adding `enqueueVehicle, enqueueTombstone, drain, outboxSize`.

`start()` (`src/data/account.js`, the function calling `drain()` and `pull()` at boot — search for `function start()`) already calls `drain()` before `pull()`; no change needed there, since `drain()`'s new signature (`Promise<number>`) is compatible with how the old one's return value was used (only `.then(() => pull())`, ignoring the count).

In `src/data/session.js`, change the `save()` success branch (`session.js:161`):

```js
        try { env.afterSave(v.id, res.data, res.photoIds); } catch (e) {}
```

- [ ] **Step 4: Update `app.js` call sites**

`app.js:2320`, the `afterSave` config:

```js
  afterSave: (id, data, photoIds) => { account.enqueueVehicle(id, data); (photoIds || []).forEach(pid => account.enqueuePhoto(pid)); }
```

(`account.enqueuePhoto` does not exist yet — added in Task 5. For this task, write it as:)

```js
  afterSave: (id, data) => account.enqueueVehicle(id, data)
```

and revisit this line in Task 5's Step 3.

`app.js:100`, `openAddVehicle`'s direct-save path:

```js
      if (ok) { applyPhotoIds(v.data, res.data); account.enqueueVehicle(v.id, res.data); }
```

`app.js:120`, `deleteVehicle`:

```js
  account.enqueueTombstone(id);
```

(update the comment above it — it currently says "There is no outbox yet"; that sentence is now false. Replace the comment block at `app.js:117-119` with:)

```js
  // Best-effort, not awaited: the local delete already succeeded and the UI has
  // moved on. enqueueTombstone() writes to the outbox and returns; the next
  // drain() (on reconnect, or the next boot) actually pushes it.
```

`app.js:190` (inside `importGarage`'s save loop) and `app.js:195` (the stale-vehicle cleanup):

```js
        else account.enqueueVehicle(v.id, res.data);
```

```js
        if (keptIds.indexOf(id) < 0) { await removeVehicle(id, session.garage().activeId); account.enqueueTombstone(id); }
```

`app.js:1625`, the Settings status line — change from a synchronous `.length` read to the async `outboxSize()`. Find the surrounding modal-building code (search `account.dirty().length` at `app.js:1625`) and change it to populate asynchronously:

```js
      const pendingEl = el('p', 'muted');
      account.outboxSize().then(n => { pendingEl.textContent = n ? `${n} ${t('changes waiting to sync')}` : t('Synced'); });
```

(Replace whatever DOM node currently reads `account.dirty().length` synchronously with `pendingEl`, appended in its place — the exact surrounding markup is in `app.js` around line 1625; keep every other line in that block unchanged, only replacing the synchronous read.)

- [ ] **Step 5: Update `test/session.test.js`**

Find the test(s) asserting `afterSave` is called with `(id, data)` and extend the assertion to also check a third argument. Locate the call via `grep -n "afterSave" test/session.test.js`; update the spy to capture all arguments:

```js
  let afterSaveArgs = null;
  configureSession({ afterSave: (...args) => { afterSaveArgs = args; } });
  // ... perform the save ...
  assert.strictEqual(afterSaveArgs[0], vehicleId);
  assert.ok(Array.isArray(afterSaveArgs[2]), 'afterSave must receive photoIds as its third argument');
```

- [ ] **Step 6: Run to verify pass**

Run: `npm test -- test/account.test.js test/session.test.js`
Expected: PASS

- [ ] **Step 7: Full suite**

Run: `npm test`
Expected: PASS — this is the task most likely to break something in `app.js`'s DOM tests (`test/render.test.js` or similar), since a synchronous `.length` read became async. If a DOM test asserts the pending-count text synchronously right after opening the modal, it needs an `await` added before the assertion, or to assert on the eventual DOM state (`await new Promise(r => setTimeout(r, 0))` before reading `pendingEl.textContent`, matching how this codebase's other async-render tests already wait).

- [ ] **Step 8: Commit**

```bash
git add src/data/account.js src/data/session.js app.js test/account.test.js test/session.test.js test/render.test.js
git commit -m "feat: outbox-based enqueue/drain, replacing the dirty list"
```

---

## Task 5: Photo outbox entries and upload

**Files:**
- Modify: `src/data/account.js` (add `enqueuePhoto`, `uploadPhoto`, extend `drainOne` with the `photo` kind)
- Modify: `app.js` (`afterSave` config at `app.js:2320`, finishing what Task 4 deferred)
- Test: `test/account.test.js`

**Interfaces:**
- Consumes: `deps.getPhotoBlob(id)` (Task 3).
- Produces: `account.enqueuePhoto(photoId) => Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

```js
test('enqueuePhoto drains by uploading the blob and removing the entry', async () => {
  account.reset();
  const client = fullClient({ rows: [] });
  const uploads = [];
  client.storage = { from: () => ({ upload: (path, blob) => { uploads.push({ path, blob }); return Promise.resolve({ error: null }); } }) };
  const blob = { type: 'image/jpeg' };
  account.configure({ client, protocol: 'https:', getPhotoBlob: () => Promise.resolve(blob) });
  account.setUserForTest({ id: 'u1' });
  await account.enqueuePhoto('p1');

  const remaining = await account.drain();

  assert.strictEqual(remaining, 0);
  assert.strictEqual(uploads.length, 1);
  assert.strictEqual(uploads[0].path, 'u1/p1');
});

test('a photo entry with no local blob left to upload drains as a no-op', async () => {
  account.reset();
  const client = fullClient({ rows: [] });
  client.storage = { from: () => ({ upload: () => { throw new Error('must not be called'); } }) };
  account.configure({ client, protocol: 'https:', getPhotoBlob: () => Promise.resolve(null) });
  account.setUserForTest({ id: 'u1' });
  await account.enqueuePhoto('p1');

  const remaining = await account.drain();

  assert.strictEqual(remaining, 0, 'nothing to upload is not a failure — the entry still clears');
});

test('a failed upload leaves the photo entry queued', async () => {
  account.reset();
  const client = fullClient({ rows: [] });
  client.storage = { from: () => ({ upload: () => Promise.resolve({ error: new Error('quota') }) }) };
  account.configure({ client, protocol: 'https:', getPhotoBlob: () => Promise.resolve({ type: 'image/jpeg' }) });
  account.setUserForTest({ id: 'u1' });
  await account.enqueuePhoto('p1');

  const remaining = await account.drain();

  assert.strictEqual(remaining, 1);
});

test('a photo entry uploads before a vehicle entry queued after it', async () => {
  account.reset();
  const client = fullClient({ rows: [] });
  const order = [];
  client.storage = { from: () => ({ upload: () => { order.push('photo'); return Promise.resolve({ error: null }); } }) };
  const origFrom = client.from.bind(client);
  client.from = table => {
    const t = origFrom(table);
    const origUpsert = t.upsert.bind(t);
    t.upsert = row => { order.push('vehicle'); return origUpsert(row); };
    return t;
  };
  account.configure({ client, protocol: 'https:', getPhotoBlob: () => Promise.resolve({ type: 'image/jpeg' }) });
  account.setUserForTest({ id: 'u1' });
  await account.enqueueVehicle('v1', { car: { photoId: 'p1' } });
  await account.enqueuePhoto('p1');

  await account.drain();

  assert.deepStrictEqual(order, ['photo', 'vehicle']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/account.test.js`
Expected: FAIL — `account.enqueuePhoto is not a function`

- [ ] **Step 3: Implement**

Add `getPhotoBlob` to the Node `dep` object at the top of `account.js` (the `Object.assign({}, require('../../storage.js'), ...)` call already pulls in every `storage.js` export by object spread, so `getPhotoBlob`/`putPhotoBlob` from Task 3 are already reachable through `dep`/`deps` — no change needed there since `require('../../storage.js')` now exports them).

Add after `pushTombstoneRow`:

```js
  /* {user_id}/{photoId} — mirrors the RLS path convention for the vehicles
     table, enforced by the storage policy in supabase/schema.sql instead of
     application code. */
  function photoPath(id) { return `${_user.id}/${id}`; }

  function uploadPhoto(id, blob) {
    if (!_user || !env.client || !env.client.storage) return Promise.resolve(false);
    return Promise.resolve(env.client.storage.from('photos').upload(photoPath(id), blob, { upsert: true }))
      .then(res => { if (res && res.error) throw res.error; return true; })
      .catch(() => false);
  }

  function enqueuePhoto(id) {
    return enqueue({ kind: 'photo', photoId: id });
  }
```

Extend `KIND_ORDER`'s consumer, `drainOne`, with the photo case:

```js
  function drainOne(entry) {
    if (entry.kind === 'photo') {
      return deps.getPhotoBlob(entry.photoId).then(blob => {
        const run = blob ? uploadPhoto(entry.photoId, blob) : Promise.resolve(true);
        return run.then(ok => ok && deps.outboxRemove(entry.id));
      }).catch(() => {});
    }
    const run = entry.kind === 'tombstone' ? pushTombstoneRow(entry.vehicleId)
      : pushVehicle(entry.vehicleId, entry.data);
    return run.then(ok => ok && deps.outboxRemove(entry.id)).catch(() => {});
  }
```

Add `enqueuePhoto` to the returned surface.

- [ ] **Step 4: Finish `app.js`'s `afterSave` config from Task 4**

`app.js:2320`:

```js
  afterSave: (id, data, photoIds) => { account.enqueueVehicle(id, data); (photoIds || []).forEach(pid => account.enqueuePhoto(pid)); }
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- test/account.test.js`
Expected: PASS

- [ ] **Step 6: Full suite, commit**

```bash
npm test
git add src/data/account.js app.js test/account.test.js
git commit -m "feat: queue and upload photos through the outbox"
```

---

## Task 6: Incremental pull, tombstone consumption, and photo download

**Files:**
- Modify: `src/data/account.js` (add `pullIncremental`, `ensurePhotosLocal`, `downloadPhoto`, `sync`)
- Test: `test/account.test.js`

**Interfaces:**
- Consumes: `deps.metaGet/metaSet` (Task 2), `deps.getPhotoBlob/putPhotoBlob` (Task 3), `deps.photoIdsIn` (already in `deps` via `storage.js`'s existing export), `deps.saveVehicle`, `deps.removeVehicle`, `deps.session`.
- Produces: `account.sync() => Promise<boolean>` — `drain()` then an incremental pull, re-hydrating the session and re-rendering only if the pull found anything.

- [ ] **Step 1: Write the failing tests**

The existing `fullClient()` helper's `select()` only exposes `.is()`/`.maybeSingle()` (`test/account.test.js:164-190`). Extend it — add a `.gt()` branch, since that's what an incremental pull filters on:

```js
// In fullClient(), inside from(table)'s select() object:
        select() {
          const q = {
            is: () => Promise.resolve(opts.failSelect ? { error: new Error('offline') } : { data: rows, error: null }),
            gt: (col, val) => Promise.resolve(opts.failSelect ? { error: new Error('offline') } : { data: (opts.since || {})[val] || [], error: null }),
            maybeSingle: () => Promise.resolve(opts.failSelect
              ? { error: new Error('offline') }
              : { data: activeId ? { active_id: activeId } : null, error: null })
          };
          return q;
        }
```

(`opts.since` is a new, optional test fixture: a map from cursor value to the rows that should come back for it, letting a test assert the cursor that was actually passed.)

```js
test('sync() drains the outbox, then pulls incrementally', async () => {
  account.reset();
  const storage2 = require('../storage.js');
  await storage2.openStorage({ protocol: 'https:', hasIndexedDb: true });
  session.clear();
  session.setVehicles([{ id: 'local1', data: { car: {}, history: [], fuel: [], spending: [], docs: [] } }], 'local1');
  const client = fullClient({ since: { '1970-01-01T00:00:00.000Z': [{ id: 'v2', data: { car: { nickname: 'B' } }, updated_at: '2026-08-22T00:00:00.000Z', deleted_at: null }] } });
  account.configure({ client, protocol: 'https:', getPhotoBlob: () => Promise.resolve(null), metaGet: storage2.metaGet, metaSet: storage2.metaSet });
  account.setUserForTest({ id: 'u1' });

  const changed = await account.sync();

  assert.strictEqual(changed, true);
});

test('an incremental pull applies a tombstone by removing the vehicle', async () => {
  account.reset();
  const client = fullClient({ since: { '1970-01-01T00:00:00.000Z': [{ id: 'v1', data: {}, updated_at: '2026-08-22T00:00:00.000Z', deleted_at: '2026-08-22T00:00:00.000Z' }] } });
  const removed = [];
  account.configure({ client, protocol: 'https:', removeVehicle: id => { removed.push(id); return Promise.resolve(true); }, metaGet: () => Promise.resolve({}), metaSet: () => Promise.resolve(true) });
  account.setUserForTest({ id: 'u1' });

  await account.sync();

  assert.deepStrictEqual(removed, ['v1']);
});

test('lastPulledAt only advances after every row in the batch is applied', async () => {
  account.reset();
  const client = fullClient({ since: { '1970-01-01T00:00:00.000Z': [{ id: 'v1', data: {}, updated_at: '2026-08-22T00:00:00.000Z', deleted_at: null }] } });
  let saved = false;
  let metaSetCalls = 0;
  account.configure({
    client, protocol: 'https:',
    saveVehicle: () => { saved = true; return Promise.reject(new Error('write failed')); },
    metaGet: () => Promise.resolve({}),
    metaSet: patch => { metaSetCalls++; return Promise.resolve(true); }
  });
  account.setUserForTest({ id: 'u1' });

  await account.sync().catch(() => {});

  assert.ok(saved);
  assert.strictEqual(metaSetCalls, 0, 'a batch that fails partway through must not advance the cursor');
});

test('a pulled vehicle referencing a missing photo triggers exactly one download', async () => {
  account.reset();
  const client = fullClient({ since: { '1970-01-01T00:00:00.000Z': [{ id: 'v1', data: { car: { photoId: 'p1' } }, updated_at: '2026-08-22T00:00:00.000Z', deleted_at: null }] } });
  let downloads = 0;
  client.storage = { from: () => ({ download: () => { downloads++; return Promise.resolve({ data: { type: 'image/jpeg' }, error: null }); } }) };
  const putCalls = [];
  account.configure({
    client, protocol: 'https:',
    getPhotoBlob: () => Promise.resolve(null),
    putPhotoBlob: (id, blob) => { putCalls.push(id); return Promise.resolve(true); },
    saveVehicle: () => Promise.resolve({ ok: true, photoIds: [], data: {} }),
    metaGet: () => Promise.resolve({}), metaSet: () => Promise.resolve(true)
  });
  account.setUserForTest({ id: 'u1' });

  await account.sync();

  assert.strictEqual(downloads, 1);
  assert.deepStrictEqual(putCalls, ['p1']);
});

test('a pulled vehicle referencing a photo already local does not download it', async () => {
  account.reset();
  const client = fullClient({ since: { '1970-01-01T00:00:00.000Z': [{ id: 'v1', data: { car: { photoId: 'p1' } }, updated_at: '2026-08-22T00:00:00.000Z', deleted_at: null }] } });
  let downloads = 0;
  client.storage = { from: () => ({ download: () => { downloads++; return Promise.resolve({ data: {}, error: null }); } }) };
  account.configure({
    client, protocol: 'https:',
    getPhotoBlob: () => Promise.resolve({ type: 'image/jpeg' }),
    saveVehicle: () => Promise.resolve({ ok: true, photoIds: [], data: {} }),
    metaGet: () => Promise.resolve({}), metaSet: () => Promise.resolve(true)
  });
  account.setUserForTest({ id: 'u1' });

  await account.sync();

  assert.strictEqual(downloads, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/account.test.js`
Expected: FAIL — `account.sync is not a function`

- [ ] **Step 3: Implement**

Add near `pull()` (the existing sign-in pull, `src/data/account.js:184-194` — leave that function untouched):

```js
  function downloadPhoto(id) {
    if (!_user || !env.client || !env.client.storage) return Promise.resolve(null);
    return Promise.resolve(env.client.storage.from('photos').download(photoPath(id)))
      .then(res => (res && !res.error && res.data) ? res.data : null)
      .catch(() => null);
  }

  /* Every photoId a pulled row references that this device does not already
     have gets fetched once and written into the local photo store, before
     the row is saved — otherwise resolvePhotos() finds nothing and the
     image silently stays blank (4a's own documented gap, closed here). */
  function ensurePhotosLocal(data) {
    const ids = deps.photoIdsIn ? deps.photoIdsIn(data) : [];
    return ids.reduce((p, id) => p.then(() => deps.getPhotoBlob(id)).then(existing => {
      if (existing) return null;
      return downloadPhoto(id).then(blob => blob && deps.putPhotoBlob(id, blob));
    }), Promise.resolve());
  }

  function applyPulledRow(row, activeId) {
    if (row.deleted_at) return deps.removeVehicle(row.id, activeId);
    const data = row.data;
    if (deps.normalizeData) deps.normalizeData(data);
    return ensurePhotosLocal(data).then(() => deps.saveVehicle(row.id, data, activeId, deps.uid));
  }

  /* Additive to pull()/adopt() (4a, sign-in only, unchanged). This answers
     "what changed since I last checked" for a device that already has this
     user's garage — never runs before that first resolution. */
  function pullIncremental() {
    return deps.metaGet().then(m => {
      const cursor = m.lastPulledAt || '1970-01-01T00:00:00.000Z';
      return Promise.resolve(env.client.from('vehicles').select('id,data,updated_at,deleted_at').gt('updated_at', cursor))
        .then(res => {
          if (res && res.error) throw res.error;
          const rows = res.data || [];
          if (!rows.length) return false;
          const g = deps.session.garage();
          const activeId = g ? g.activeId : null;
          return rows.reduce((p, row) => p.then(() => applyPulledRow(row, activeId)), Promise.resolve())
            .then(() => deps.metaSet({ lastPulledAt: nowIso() }))
            .then(() => true);
        });
    });
  }

  function sync() {
    if (!_user || !env.client) return Promise.resolve(false);
    return drain().then(() => pullIncremental()).then(changed => {
      if (!changed) return true;
      return deps.session.load().then(() => { env.rerender(); return true; });
    });
  }
```

Add `sync` to the returned surface.

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- test/account.test.js`
Expected: PASS

- [ ] **Step 5: Full suite, commit**

```bash
npm test
git add src/data/account.js test/account.test.js
git commit -m "feat: incremental pull with tombstone consumption and photo download"
```

---

## Task 7: Wire the `online` event and boot-time `sync()`

**Files:**
- Modify: `app.js` (boot section around `app.js:2320-2345`)
- Test: `e2e/smoke.spec.js` (presence check, matching the existing pattern for account UI)

**Interfaces:**
- Consumes: `account.sync()` (Task 6).

- [ ] **Step 1: Read the existing boot wiring**

`app.js:2328-2345` configures `account` and calls `account.start()`. `start()` (4a, unchanged) already does drain-then-pull once at boot via the old `drain()`/`pull()` — Task 4 already made `drain()` outbox-based, so this is compatible with no further change to `start()` itself.

- [ ] **Step 2: Write the failing test**

This is DOM/browser-event wiring with no meaningful unit-test seam in `account.js` (the listener itself is what's under test, not sync's logic — already covered in Task 6). Add a presence check to `e2e/smoke.spec.js`, following its existing pattern for asserting a global handler exists post-boot:

```js
test('an online listener is registered after boot, over http', async ({ page }) => {
  await page.goto('/'); // matches this file's existing http-origin setup
  const hasListener = await page.evaluate(() => window.__hasOnlineSyncListener === true);
  expect(hasListener).toBe(true);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test:e2e -- -g "online listener"`
Expected: FAIL — `window.__hasOnlineSyncListener` is undefined

- [ ] **Step 4: Implement**

In `app.js`, immediately after the existing `account.start()` call (`app.js:2345` region):

```js
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { account.sync(); });
  window.__hasOnlineSyncListener = true;   // e2e presence check only
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test:e2e -- -g "online listener"`
Expected: PASS

- [ ] **Step 6: Full suites, commit**

```bash
npm test
npm run test:e2e
git add app.js e2e/smoke.spec.js
git commit -m "feat: sync on reconnect"
```

---

## Task 8: Storage bucket, policy, and manual verification

**Files:**
- Modify: `supabase/schema.sql` (append the bucket + policy)
- Create: `docs/superpowers/verification/2026-08-22-sync-manual.md`

- [ ] **Step 1: Add the bucket and policy**

Append to `supabase/schema.sql`:

```sql
-- Phase 4b: photo storage. Same shape as own_vehicles/own_garage — the
-- boundary is the Storage policy, not application code checking whose
-- photo it is.
insert into storage.buckets (id, name, public)
  values ('photos', 'photos', false)
  on conflict (id) do nothing;

drop policy if exists own_photos on storage.objects;
create policy own_photos on storage.objects for all
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
```

- [ ] **Step 2: Apply by hand**

Run this file's new statements in the Supabase SQL editor for the project referenced by `SUPABASE_URL`/`SUPABASE_ANON_KEY` in `src/data/account.js`. Confirm in the dashboard: Storage → a `photos` bucket exists, not public; Storage → Policies → `own_photos` is listed on `storage.objects`.

- [ ] **Step 3: Manual multi-device verification**

Create `docs/superpowers/verification/2026-08-22-sync-manual.md`:

```markdown
# Phase 4b — manual sync verification

Two browser profiles (or two browsers), same Supabase project, signed into
the same account in both. RLS and Storage policies cannot be reached from
the Node suite (same reasoning as 4a's RLS pass) — this is performed by hand
and recorded here.

## Vehicle edit propagates

1. Profile A and Profile B both signed in, both showing the same garage.
2. In A, edit a vehicle's nickname. Confirm A's own `online` sync (or the
   save completing while online) pushes it — check the Settings status line
   drops to "Synced".
3. In B, DevTools → Network → toggle offline, then online. Confirm the
   nickname change appears within a few seconds of the `online` event firing.
4. Result: _____ (pass/fail, date, browser versions)

## Deletion propagates

1. In A, delete a vehicle (with more than one in the garage).
2. In B, toggle offline/online.
3. Confirm the vehicle disappears from B and does not reappear on a hard
   reload of B.
4. Result: _____

## Photo propagates

1. In A, add a receipt photo to a service record.
2. In B, toggle offline/online.
3. Confirm the photo renders in B (not a blank slot).
4. Result: _____

## Outbox survives a failed push

1. In A, go offline (DevTools), edit a vehicle. Confirm the Settings status
   line shows a pending count.
2. Go back online. Confirm the count returns to "Synced" and B (if open)
   receives the change on its own next `online` event.
3. Result: _____
```

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql docs/superpowers/verification/2026-08-22-sync-manual.md
git commit -m "docs: photo storage policy and the Phase 4b manual verification pass"
```

---

## Final check

- [ ] Run `npm test` — full suite green.
- [ ] Run `npm run test:e2e` — green over both `file://` and `http://` origins, per the existing smoke suite.
- [ ] Re-run every test in `test/account.test.js` whose name mentions "sign-in", "reconcile", or "adopt" — confirm none were touched by this plan (per the Global Constraints).
- [ ] Perform the manual verification pass in Task 8 and fill in its results.
