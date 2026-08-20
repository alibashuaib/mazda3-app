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
