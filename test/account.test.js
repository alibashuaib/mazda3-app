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
