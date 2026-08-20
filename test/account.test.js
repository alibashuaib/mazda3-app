'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { IDBFactory } = require('fake-indexeddb');
const account = require('../src/data/account.js');

/* account.js reads localStorage for its dirty list, and Task 5's tests reach
   storage.js's IndexedDB backend. Neither exists in bare Node. This mirrors
   the shim in test/idb.test.js:23-34 rather than importing it, because that
   helper also swaps the storage.js module instance, which these tests must
   NOT do — account.js captured its dep at require time. */
function installBrowserGlobals() {
  global.indexedDB = new IDBFactory();
  const store = new Map();
  global.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
    _store: store
  };
}
installBrowserGlobals();

function fakeClient() {
  return { auth: {}, from: () => ({}) };
}

test('available() is false on file://', () => {
  account.reset();
  account.configure({ client: fakeClient(), protocol: 'file:' });
  assert.strictEqual(account.available(), false);
});

test('available() is true over https with a client', () => {
  account.reset();
  account.configure({ client: fakeClient(), protocol: 'https:' });
  assert.strictEqual(account.available(), true);
});

test('available() is false without a client, even over https', () => {
  account.reset();
  account.configure({ protocol: 'https:' });
  assert.strictEqual(account.available(), false);
});

test('user() is null before sign-in', () => {
  account.reset();
  assert.strictEqual(account.user(), null);
});

test('the dirty list round-trips and de-duplicates', () => {
  account.reset();
  localStorage.removeItem('garage.sync.dirty');
  assert.deepStrictEqual(account.dirty(), []);
  account.markDirty('a');
  account.markDirty('a');
  account.markDirty('b');
  assert.deepStrictEqual(account.dirty(), ['a', 'b']);
  account.clearDirty('a');
  assert.deepStrictEqual(account.dirty(), ['b']);
});

test('the dirty list survives unparseable storage', () => {
  account.reset();
  localStorage.setItem('garage.sync.dirty', 'not json');
  assert.deepStrictEqual(account.dirty(), []);
});

/* A fake PostgREST-shaped client. Records every upsert so tests can assert on
   what actually crossed the wire. */
function tableClient(opts) {
  opts = opts || {};
  const calls = { vehicles: [], garage: [] };
  return {
    calls,
    auth: {},
    from(table) {
      return {
        upsert(row) {
          calls[table].push(row);
          return Promise.resolve(opts.failUpsert ? { error: new Error('offline') } : { error: null });
        }
      };
    }
  };
}

test('stripPhotos removes photo payloads but keeps photo ids', () => {
  account.reset();
  const data = {
    car: { nickname: 'Red', photo: 'blob:abc', photoId: 'p1' },
    history: [{ id: 'h1', photo: 'data:image/jpeg;base64,zzz', photoId: 'p2' }],
    spending: [{ id: 's1' }],
    fuel: [{ id: 'f1' }]
  };
  const out = account.stripPhotos(data);
  assert.strictEqual(out.car.photo, undefined);
  assert.strictEqual(out.car.photoId, 'p1');
  assert.strictEqual(out.history[0].photo, undefined);
  assert.strictEqual(out.history[0].photoId, 'p2');
  assert.strictEqual(data.car.photo, 'blob:abc', 'the original must not be mutated');
});

test('onSaved pushes the vehicle and leaves the dirty list empty', async () => {
  account.reset();
  localStorage.removeItem('garage.sync.dirty');
  const client = tableClient();
  account.configure({ client, protocol: 'https:' });
  account.setUserForTest({ id: 'u1' });

  account.markDirty('v1');
  assert.deepStrictEqual(account.dirty(), ['v1'], 'precondition: v1 starts dirty');

  const ok = await account.onSaved('v1', { car: { nickname: 'Red', photo: 'blob:x' } });

  assert.strictEqual(ok, true);
  assert.strictEqual(client.calls.vehicles.length, 1);
  assert.strictEqual(client.calls.vehicles[0].id, 'v1');
  assert.strictEqual(client.calls.vehicles[0].data.car.photo, undefined, 'photos stay local in 4a');
  assert.ok(client.calls.vehicles[0].updated_at, 'every row carries updated_at');
  assert.deepStrictEqual(account.dirty(), []);
});

test('onSaved marks the vehicle dirty when the push fails', async () => {
  account.reset();
  localStorage.removeItem('garage.sync.dirty');
  account.configure({ client: tableClient({ failUpsert: true }), protocol: 'https:' });
  account.setUserForTest({ id: 'u1' });

  const ok = await account.onSaved('v1', { car: {} });

  assert.strictEqual(ok, false, 'a failed push resolves false, it does not reject');
  assert.deepStrictEqual(account.dirty(), ['v1']);
});

test('onSaved does nothing at all when signed out', async () => {
  account.reset();
  localStorage.removeItem('garage.sync.dirty');
  const client = tableClient();
  account.configure({ client, protocol: 'https:' });

  const ok = await account.onSaved('v1', { car: {} });

  assert.strictEqual(ok, false);
  assert.strictEqual(client.calls.vehicles.length, 0);
  assert.deepStrictEqual(account.dirty(), [], 'an anonymous save is not a pending sync');
});

const session = require('../src/data/session.js');
const storage = require('../storage.js');

/* Extends tableClient with reads. `rows` is what the server holds. */
function fullClient(opts) {
  opts = opts || {};
  const calls = { vehicles: [], garage: [] };
  const rows = opts.rows || [];
  const activeId = opts.activeId || null;
  return {
    calls,
    auth: {},
    from(table) {
      return {
        upsert(row) {
          calls[table].push(row);
          return Promise.resolve({ error: null });
        },
        select() {
          const q = {
            is: () => Promise.resolve(opts.failSelect ? { error: new Error('offline') } : { data: rows, error: null }),
            maybeSingle: () => Promise.resolve(opts.failSelect
              ? { error: new Error('offline') }
              : { data: activeId ? { active_id: activeId } : null, error: null })
          };
          return q;
        }
      };
    }
  };
}

function seedGarage(extra) {
  return {
    vehicles: [{ id: 'local1', data: Object.assign({
      car: { nickname: '', odometer: 316000 },
      services: [], parts: [], history: [], spending: [], fuel: [], docs: []
    }, extra || {}) }],
    activeId: 'local1'
  };
}

test('isUntouchedSeed is true for one vehicle with no records', () => {
  account.reset();
  assert.strictEqual(account.isUntouchedSeed(seedGarage()), true);
});

test('isUntouchedSeed is false once any record exists', () => {
  account.reset();
  assert.strictEqual(account.isUntouchedSeed(seedGarage({ fuel: [{ id: 'f1' }] })), false);
  assert.strictEqual(account.isUntouchedSeed(seedGarage({ history: [{ id: 'h1' }] })), false);
  assert.strictEqual(account.isUntouchedSeed(seedGarage({ spending: [{ id: 's1' }] })), false);
  assert.strictEqual(account.isUntouchedSeed(seedGarage({ docs: [{ id: 'd1' }] })), false);
});

test('isUntouchedSeed is false for more than one vehicle', () => {
  account.reset();
  const g = seedGarage();
  g.vehicles.push({ id: 'local2', data: { history: [], fuel: [], spending: [], docs: [] } });
  assert.strictEqual(account.isUntouchedSeed(g), false);
});

test('reconcile uploads the local garage when the server is empty', async () => {
  account.reset();
  const client = fullClient({ rows: [] });
  account.configure({ client, protocol: 'https:' });
  account.setUserForTest({ id: 'u1' });
  session.clear();
  const g = seedGarage({ fuel: [{ id: 'f1', litres: 40 }] });
  session.setVehicles(g.vehicles, g.activeId);

  await account.reconcile({ vehicles: [], activeId: null });

  assert.strictEqual(client.calls.vehicles.length, 1);
  assert.strictEqual(client.calls.vehicles[0].id, 'local1');
  assert.strictEqual(client.calls.garage.length, 1);
  assert.strictEqual(client.calls.garage[0].active_id, 'local1');
});

test('reconcile replaces an untouched local seed with the server garage', async () => {
  account.reset();
  await storage.openStorage({ protocol: 'https:', hasIndexedDb: true });
  const client = fullClient({});
  account.configure({ client, protocol: 'https:' });
  account.setUserForTest({ id: 'u1' });
  session.clear();
  const g = seedGarage();
  session.setVehicles(g.vehicles, g.activeId);

  await account.reconcile({
    vehicles: [{ id: 'srv1', data: { car: { nickname: 'From server' }, history: [], fuel: [], spending: [], docs: [] } }],
    activeId: 'srv1'
  });

  assert.strictEqual(session.garage().vehicles.length, 1);
  assert.strictEqual(session.current().car.nickname, 'From server');
  assert.strictEqual(client.calls.vehicles.length, 0, 'adopting must not push the seed back up');
});

test('reconcile asks when both sides have real data, and honours "local"', async () => {
  account.reset();
  const client = fullClient({});
  let asked = 0;
  account.configure({ client, protocol: 'https:', choose: () => { asked++; return Promise.resolve('local'); } });
  account.setUserForTest({ id: 'u1' });
  session.clear();
  const g = seedGarage({ fuel: [{ id: 'f1', litres: 40 }] });
  session.setVehicles(g.vehicles, g.activeId);

  await account.reconcile({
    vehicles: [{ id: 'srv1', data: { car: { nickname: 'From server' }, history: [], fuel: [], spending: [], docs: [] } }],
    activeId: 'srv1'
  });

  assert.strictEqual(asked, 1);
  assert.strictEqual(session.current().car.nickname, '', 'the local garage was kept');
  assert.strictEqual(client.calls.vehicles.length, 1, 'and uploaded');
});

test('reconcile honours "server"', async () => {
  account.reset();
  await storage.openStorage({ protocol: 'https:', hasIndexedDb: true });
  const client = fullClient({});
  account.configure({ client, protocol: 'https:', choose: () => Promise.resolve('server') });
  account.setUserForTest({ id: 'u1' });
  session.clear();
  const g = seedGarage({ fuel: [{ id: 'f1', litres: 40 }] });
  session.setVehicles(g.vehicles, g.activeId);

  await account.reconcile({
    vehicles: [{ id: 'srv1', data: { car: { nickname: 'From server' }, history: [], fuel: [], spending: [], docs: [] } }],
    activeId: 'srv1'
  });

  assert.strictEqual(session.current().car.nickname, 'From server');
});

test('pull rejects when the server is unreachable', async () => {
  account.reset();
  account.configure({ client: fullClient({ failSelect: true }), protocol: 'https:' });
  account.setUserForTest({ id: 'u1' });
  await assert.rejects(() => account.pull());
});

test('adopting the server garage deletes local vehicles the server does not have', async () => {
  account.reset();
  const storage2 = require('../storage.js');
  await storage2.openStorage({ protocol: 'https:', hasIndexedDb: true });
  await storage2.saveVehicle('local1', { car: { nickname: 'Stale' }, history: [], fuel: [], spending: [], docs: [] }, 'local1', () => 'p1');
  account.configure({ client: fullClient({}), protocol: 'https:' });
  session.clear();
  session.setVehicles([{ id: 'local1', data: { car: { nickname: 'Stale' }, history: [], fuel: [], spending: [], docs: [] } }], 'local1');

  await account.adopt({
    vehicles: [{ id: 'srv1', data: { car: { nickname: 'From server' }, history: [], fuel: [], spending: [], docs: [] } }],
    activeId: 'srv1'
  });

  const after = await storage2.loadAll();
  const ids = after.garage.vehicles.map(v => v.id);
  assert.deepStrictEqual(ids, ['srv1'], 'the stale local vehicle must not survive on disk');
});

test('adopt persists the activeId session settled on, not the raw pulled one', async () => {
  account.reset();
  const storage2 = require('../storage.js');
  await storage2.openStorage({ protocol: 'https:', hasIndexedDb: true });
  account.configure({ client: fullClient({}), protocol: 'https:' });
  session.clear();
  session.setVehicles([{ id: 'x', data: { car: {}, history: [], fuel: [], spending: [], docs: [] } }], 'x');

  await account.adopt({
    vehicles: [{ id: 'srv1', data: { car: { nickname: 'A' }, history: [], fuel: [], spending: [], docs: [] } }],
    activeId: 'ghost'
  });

  assert.strictEqual(session.garage().activeId, 'srv1');
  const after = await storage2.loadAll();
  assert.strictEqual(after.garage.activeId, 'srv1', 'disk must agree with memory');
});
