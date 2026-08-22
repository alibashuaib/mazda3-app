/* ============================================================
   storage.js against a real IndexedDB implementation.

   The pure helpers are covered in storage.test.js; this exercises the
   plumbing around them — transactions, migration, and the delete paths —
   which is where the bugs found in the Phase 2 review actually lived.

   fake-indexeddb is the only dependency in the project, and it is dev-only:
   nothing the browser loads requires it.
   ============================================================ */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { IDBFactory } = require('fake-indexeddb');

const STORAGE = require.resolve('../storage.js');
const DATA_URL = 'data:image/jpeg;base64,AAECAw==';      // 4 bytes
const OTHER_URL = 'data:image/png;base64,BBBB';

/* storage.js keeps its backend in module state and picks it once, so every
   test gets a fresh module instance, a fresh database and a fresh
   localStorage rather than trying to unpick the previous one. */
function freshStorage(seedLocal) {
  global.indexedDB = new IDBFactory();
  const store = new Map();
  if (seedLocal) store.set('garage.mazda3.v2', JSON.stringify(seedLocal));
  global.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
    /* key()/length are part of the Storage interface and storage.js's wipe()
       enumerates with them to find supabase's sb-<ref>-auth-token key. */
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size; },
    _store: store
  };
  delete require.cache[STORAGE];
  return require('../storage.js');
}

const idb = () => new Promise((resolve, reject) => {
  const req = global.indexedDB.open('garage', 2);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

function readAll(db, store) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

const photoIds = async () => (await readAll(await idb(), 'photos')).map(p => p.id).sort();
const metaRec = async () => (await readAll(await idb(), 'meta'))[0];

let counter = 0;
const makeId = () => `p${++counter}`;

const vehicleData = (photo, histPhoto) => ({
  car: { nickname: 'Mine', photo: photo || '' },
  history: [{ id: 'h1', photo: histPhoto || '' }],
  spending: [],
  services: []
});

test('openStorage selects IndexedDB, and falls back to localStorage on file://', async () => {
  const s = freshStorage();
  assert.strictEqual((await s.openStorage({ protocol: 'https:', hasIndexedDb: true })).kind, 'idb');
  assert.strictEqual(s.backendKind(), 'idb');

  const s2 = freshStorage();
  assert.strictEqual((await s2.openStorage({ protocol: 'file:', hasIndexedDb: true })).kind, 'local');
});

test('saveVehicle stores the photo as a Blob and strips it from the record', async () => {
  const s = freshStorage();
  await s.openStorage({ protocol: 'https:', hasIndexedDb: true });
  const res = await s.saveVehicle('v1', vehicleData(DATA_URL), 'v1', makeId);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.photoIds.length, 1);

  const { garage, photos } = await s.loadAll();
  const car = garage.vehicles[0].data.car;
  assert.strictEqual(car.photo, '');                       // never persisted inline
  assert.strictEqual(typeof car.photoId, 'string');
  const blob = photos[car.photoId];
  assert.strictEqual(blob.size, 4);
  assert.strictEqual(blob.type, 'image/jpeg');
  assert.strictEqual(garage.activeId, 'v1');
});

/* Regression for #5. The pure orphan diff is unit-tested; this proves the
   transaction actually issues the delete. */
test('saveVehicle deletes the blob of a photo the user replaced', async () => {
  const s = freshStorage();
  await s.openStorage({ protocol: 'https:', hasIndexedDb: true });
  const first = await s.saveVehicle('v1', vehicleData(DATA_URL), 'v1', makeId);
  const oldId = first.photoIds[0];
  assert.deepStrictEqual(await photoIds(), [oldId]);

  // the user picks a different image for the same slot
  const next = await s.saveVehicle('v1', vehicleData(OTHER_URL), 'v1', makeId);
  const newId = next.photoIds[0];
  assert.notStrictEqual(newId, oldId);
  assert.deepStrictEqual(await photoIds(), [newId], 'the replaced blob should be gone');
});

test('saveVehicle deletes the blob when the photo is removed outright', async () => {
  const s = freshStorage();
  await s.openStorage({ protocol: 'https:', hasIndexedDb: true });
  await s.saveVehicle('v1', vehicleData(DATA_URL), 'v1', makeId);
  assert.strictEqual((await photoIds()).length, 1);

  const { garage } = await s.loadAll();
  const data = garage.vehicles[0].data;
  data.car.photo = '';                       // removed in the UI
  await s.saveVehicle('v1', data, 'v1', makeId);
  assert.deepStrictEqual(await photoIds(), []);
});

/* What app.js's hydrate() does before anything can be saved: turn stored
   photo ids back into (blob:) URLs. Saving a record that has NOT been through
   this reads as "the user removed the photo" — see the invariant test below. */
function resolvePhotos(data, photos) {
  [data.car].concat(data.history || [], data.spending || []).filter(Boolean)
    .forEach(o => { if (o.photoId && photos[o.photoId]) o.photo = `blob:fake/${o.photoId}`; });
  return data;
}

test('saveVehicle keeps a photo the save did not touch', async () => {
  const s = freshStorage();
  await s.openStorage({ protocol: 'https:', hasIndexedDb: true });
  await s.saveVehicle('v1', vehicleData(DATA_URL, OTHER_URL), 'v1', makeId);
  const before = await photoIds();
  assert.strictEqual(before.length, 2);

  const { garage, photos } = await s.loadAll();
  const data = resolvePhotos(garage.vehicles[0].data, photos);
  data.car.nickname = 'Renamed';             // an edit that touches no image
  await s.saveVehicle('v1', data, 'v1', makeId);
  assert.deepStrictEqual(await photoIds(), before, 'an unrelated edit must not disturb the blobs');
});

/* An invariant worth stating out loud, because breaking it is now
   destructive. splitPhotos reads `photo: ''` alongside a photoId as "the user
   removed this image" — that is the only signal the UI gives it. So a record
   must go through hydrate()/resolvePhotos before it is saved. Since orphan
   collection landed, saving an unresolved record does not merely drop the id
   (leaking the blob, as it used to) — it deletes the blob for good. */
test('INVARIANT: saving a record whose photos were never resolved drops them', async () => {
  const s = freshStorage();
  await s.openStorage({ protocol: 'https:', hasIndexedDb: true });
  await s.saveVehicle('v1', vehicleData(DATA_URL), 'v1', makeId);
  assert.strictEqual((await photoIds()).length, 1);

  const { garage } = await s.loadAll();        // deliberately NOT resolved
  await s.saveVehicle('v1', garage.vehicles[0].data, 'v1', makeId);
  assert.deepStrictEqual(await photoIds(), [], 'photo: "" + photoId reads as a removal');
});

test('removeVehicle deletes the vehicle and every photo it owned', async () => {
  const s = freshStorage();
  await s.openStorage({ protocol: 'https:', hasIndexedDb: true });
  await s.saveVehicle('v1', vehicleData(DATA_URL, OTHER_URL), 'v1', makeId);
  await s.saveVehicle('v2', vehicleData(DATA_URL), 'v1', makeId);
  assert.strictEqual((await photoIds()).length, 3);

  assert.strictEqual(await s.removeVehicle('v1', 'v2'), true);
  const { garage, photos } = await s.loadAll();
  assert.deepStrictEqual(garage.vehicles.map(v => v.id), ['v2']);
  assert.strictEqual(Object.keys(photos).length, 1, "v2's photo must survive");
  assert.strictEqual((await photoIds()).length, 1);
});

test('an ordinary save does not clobber migratedAt', async () => {
  const s = freshStorage();
  await s.openStorage({ protocol: 'https:', hasIndexedDb: true });
  await s.loadAll();                                    // stamps
  const stamped = (await metaRec()).migratedAt;
  assert.ok(stamped, 'first load should stamp');

  await s.saveVehicle('v1', vehicleData(), 'v1', makeId);
  assert.strictEqual((await metaRec()).migratedAt, stamped);
  await s.removeVehicle('v1', 'v1');
  assert.strictEqual((await metaRec()).migratedAt, stamped);
});

/* Regression for the #2 fix: a first run with nothing to migrate must still
   stamp, or a garage later written by the localStorage backend (file://, or
   an IDB failure) gets imported as "legacy" on the next visit. */
test('a first run with nothing to migrate still stamps, and ignores a later local seed', async () => {
  const s = freshStorage();
  await s.openStorage({ protocol: 'https:', hasIndexedDb: true });
  const empty = await s.loadAll();
  assert.strictEqual(empty.garage, null);
  assert.ok((await metaRec()).migratedAt);

  await s.saveVehicle('real', vehicleData(), 'real', makeId);
  // a file:// session writes a freshly seeded garage under the localStorage key
  global.localStorage.setItem('garage.mazda3.v2', JSON.stringify({
    vehicles: [{ id: 'seeded', data: vehicleData() }], activeId: 'seeded'
  }));

  const after = await s.loadAll();
  assert.deepStrictEqual(after.garage.vehicles.map(v => v.id), ['real'], 'the seed must not be imported');
  assert.strictEqual(after.garage.activeId, 'real', 'activeId must not be stolen by the seed');
});

test('a first run WITH legacy data migrates it, photos and all, without deleting the original', async () => {
  const legacy = {
    vehicles: [{ id: 'old', data: vehicleData(DATA_URL, OTHER_URL) }],
    activeId: 'old'
  };
  const s = freshStorage(legacy);
  await s.openStorage({ protocol: 'https:', hasIndexedDb: true });

  const { garage, photos } = await s.loadAll();
  assert.deepStrictEqual(garage.vehicles.map(v => v.id), ['old']);
  assert.strictEqual(garage.activeId, 'old');
  assert.strictEqual(Object.keys(photos).length, 2, 'both images should have become Blobs');
  assert.strictEqual(garage.vehicles[0].data.car.photo, '');
  assert.ok(garage.vehicles[0].data.car.photoId);
  assert.ok((await metaRec()).migratedAt, 'migration must stamp');

  // non-destructive: opening index.html from disk afterwards still finds the data
  assert.ok(global.localStorage.getItem('garage.mazda3.v2'));

  // and a second load must not migrate again
  const again = await s.loadAll();
  assert.deepStrictEqual(again.garage.vehicles.map(v => v.id), ['old']);
  assert.strictEqual(Object.keys(again.photos).length, 2);
});

/* The one-off sweep: orphans written by versions before the #5 fix are
   unreachable, but still loaded into memory and base64d into every backup. */
test('loadAll sweeps orphaned blobs left by earlier versions', async () => {
  const s = freshStorage();
  await s.openStorage({ protocol: 'https:', hasIndexedDb: true });
  await s.saveVehicle('v1', vehicleData(DATA_URL), 'v1', makeId);

  // plant an orphan the way an older build would have left one behind
  const db = await idb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put({ id: 'dead', blob: new Blob(['x']) });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  assert.ok((await photoIds()).includes('dead'));

  const { photos } = await s.loadAll();
  assert.ok(!('dead' in photos), 'the orphan must not reach memory');
  assert.ok(!(await photoIds()).includes('dead'), 'and must be deleted from the store');
  assert.strictEqual((await photoIds()).length, 1, "the live vehicle's photo must survive");
});

test('the localStorage backend round-trips a vehicle with its photo inline', async () => {
  const s = freshStorage();
  await s.openStorage({ protocol: 'file:', hasIndexedDb: true });
  assert.strictEqual(s.backendKind(), 'local');

  const res = await s.saveVehicle('v1', vehicleData(DATA_URL), 'v1', makeId);
  assert.strictEqual(res.ok, true);
  const { garage } = await s.loadAll();
  assert.strictEqual(garage.vehicles[0].data.car.photo, DATA_URL, 'inlined, since there is no blob store');
});

test('wipe() clears every local key, including the legacy one', async () => {
  const storage = freshStorage();
  global.localStorage.setItem('garage.mazda3.v1', JSON.stringify({ car: { nickname: 'Legacy' } }));
  global.localStorage.setItem('garage.mazda3.v2', JSON.stringify({ vehicles: [{ id: 'a', data: {} }], activeId: 'a' }));
  global.localStorage.setItem('garage.sync.dirty', JSON.stringify(['a']));
  await storage.openStorage({ protocol: 'https:', hasIndexedDb: true });

  const ok = await storage.wipe();

  assert.strictEqual(ok, true);
  assert.strictEqual(global.localStorage.getItem('garage.mazda3.v1'), null);
  assert.strictEqual(global.localStorage.getItem('garage.mazda3.v2'), null);
  assert.strictEqual(global.localStorage.getItem('garage.sync.dirty'), null);
  assert.strictEqual(storage.readLegacyV1(), null, 'the legacy fallback must be unreachable after a wipe');
});

test('wipe() empties the IndexedDB stores', async () => {
  const storage = freshStorage();
  await storage.openStorage({ protocol: 'https:', hasIndexedDb: true });
  await storage.saveVehicle('v1', { car: { nickname: 'Red' } }, 'v1', () => 'p1');

  await storage.wipe();

  const after = await storage.loadAll();
  assert.ok(!after.garage || !after.garage.vehicles.length, 'no vehicles survive a wipe');
  assert.deepStrictEqual(after.photos, {}, 'no photos survive a wipe');
});

test('wipe() leaves unrelated keys alone', async () => {
  const storage = freshStorage();
  global.localStorage.setItem('garage.theme', 'light');
  global.localStorage.setItem('garage.lang', 'ar');
  await storage.openStorage({ protocol: 'https:', hasIndexedDb: true });

  await storage.wipe();

  assert.strictEqual(global.localStorage.getItem('garage.theme'), 'light');
  assert.strictEqual(global.localStorage.getItem('garage.lang'), 'ar');
});

/* auth.signOut() RESOLVES with {error} on a network failure and can return
   before clearing its stored session. If sb-<ref>-auth-token survives a wipe,
   the next launch's getSession() restores the PREVIOUS user's session and
   adopt() writes their whole garage onto the device — with no sign-in prompt.
   That defeats the phase's central cross-user property. */
test('wipe() removes the stored supabase auth token, and nothing else', async () => {
  const storage = freshStorage();
  global.localStorage.setItem('sb-abcdef-auth-token', JSON.stringify({ access_token: 'x' }));
  global.localStorage.setItem('garage.theme', 'light');
  global.localStorage.setItem('garage.lang', 'ar');
  await storage.openStorage({ protocol: 'https:', hasIndexedDb: true });

  await storage.wipe();

  assert.strictEqual(global.localStorage.getItem('sb-abcdef-auth-token'), null,
    'an offline sign-out that leaves the token behind hands the device back to the previous user');
  assert.strictEqual(global.localStorage.getItem('garage.theme'), 'light');
  assert.strictEqual(global.localStorage.getItem('garage.lang'), 'ar');
});

test('wipe() succeeds on the localStorage backend too', async () => {
  const storage = freshStorage({ vehicles: [{ id: 'a', data: {} }], activeId: 'a' });
  await storage.openStorage({ protocol: 'file:', hasIndexedDb: false });

  assert.strictEqual(await storage.wipe(), true);

  const after = await storage.loadAll();
  assert.strictEqual(after.garage, null);
});

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
