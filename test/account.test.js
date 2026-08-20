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
    /* key()/length are part of the Storage interface and storage.js's wipe()
       enumerates with them to find supabase's sb-<ref>-auth-token key. */
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size; },
    _store: store
  };
  /* storage.js's openStorage() defaults to location.protocol when called with
     no argument, which is exactly how session.js's real load() calls it.
     Every other test in this file either uses a spy in place of session, or
     calls storage.openStorage({protocol,...}) explicitly first — the
     save-in-flight test below is the first to drive account.signOut() through
     the REAL session module end to end, so location has to exist globally. */
  global.location = { protocol: 'https:' };
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
  assert.ok(client.calls.vehicles.some(r => r.id === 'local1' && !r.deleted_at), 'and uploaded');
});

/* "Keep this device's garage. The other is replaced." — uploadAll() only
   upserts what is local, so a server-only vehicle used to survive and come
   straight back on the next boot's pull. The modal promised a replace; this
   makes it one. */
test('choosing "local" tombstones the vehicles only the server has', async () => {
  account.reset();
  const client = fullClient({});
  account.configure({ client, protocol: 'https:', choose: () => Promise.resolve('local') });
  account.setUserForTest({ id: 'u1' });
  session.clear();
  const g = seedGarage({ fuel: [{ id: 'f1', litres: 40 }] });
  session.setVehicles(g.vehicles, g.activeId);

  await account.reconcile({
    vehicles: [{ id: 'srv1', data: { car: { nickname: 'From server' }, history: [], fuel: [], spending: [], docs: [] } }],
    activeId: 'srv1'
  });

  const tomb = client.calls.vehicles.find(r => r.id === 'srv1');
  assert.ok(tomb, 'the server-only vehicle was never touched — it returns on the next pull');
  assert.ok(tomb.deleted_at, 'and it must be a tombstone, not an upsert of its data');
  assert.ok(client.calls.vehicles.some(r => r.id === 'local1'), 'the local garage still uploads');
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

/* Records the order of lifecycle calls, which is the whole point of these
   tests: clear() before wipe() before load() before rerender(). */
function lifecycleSpy() {
  const order = [];
  return {
    order,
    session: {
      clear: () => order.push('clear'),
      load: () => { order.push('load'); return Promise.resolve(false); },
      save: () => { order.push('save'); return Promise.resolve(true); },
      garage: () => seedGarage(),
      setVehicles: () => order.push('setVehicles')
    },
    wipe: () => { order.push('wipe'); return Promise.resolve(true); },
    rerender: () => order.push('rerender')
  };
}

test('signOut clears, wipes, reloads and re-renders, in that order', async () => {
  account.reset();
  const spy = lifecycleSpy();
  const client = fullClient({});
  client.auth.signOut = () => Promise.resolve({ error: null });
  account.configure({ client, protocol: 'https:', rerender: spy.rerender, session: spy.session, wipe: spy.wipe });
  account.setUserForTest({ id: 'u1' });

  await account.signOut();

  assert.deepStrictEqual(spy.order, ['clear', 'wipe', 'load', 'rerender']);
  assert.strictEqual(account.user(), null);
});

/* The data-loss guard. A phone offline for a fortnight must not lose a garage. */
test('expire() drops to anonymous and never wipes', () => {
  account.reset();
  const spy = lifecycleSpy();
  account.configure({ client: fullClient({}), protocol: 'https:', rerender: spy.rerender, session: spy.session, wipe: spy.wipe });
  account.setUserForTest({ id: 'u1' });

  account.expire();

  assert.strictEqual(account.user(), null);
  assert.ok(spy.order.indexOf('wipe') < 0, 'an expired token must never wipe local data');
  assert.ok(spy.order.indexOf('clear') < 0, 'nor clear the in-memory garage');
  assert.deepStrictEqual(spy.order, ['rerender']);
});

test('signIn refuses and stays anonymous when the pull fails', async () => {
  account.reset();
  const client = fullClient({ failSelect: true });
  client.auth.signInWithPassword = () => Promise.resolve({ data: { session: { user: { id: 'u1' } }, user: { id: 'u1' } }, error: null });
  account.configure({ client, protocol: 'https:' });

  await assert.rejects(() => account.signIn('a@b.c', 'pw'), /PULL_FAILED/);
  assert.strictEqual(account.user(), null, 'a half-signed-in state is worse than none');
});

test('signIn surfaces the provider error and stays anonymous', async () => {
  account.reset();
  const client = fullClient({});
  client.auth.signInWithPassword = () => Promise.resolve({ data: null, error: new Error('Invalid login credentials') });
  account.configure({ client, protocol: 'https:' });

  await assert.rejects(() => account.signIn('a@b.c', 'wrong'), /Invalid login credentials/);
  assert.strictEqual(account.user(), null);
});

test('signIn with signUp:true calls signUp, not signInWithPassword', async () => {
  account.reset();
  const client = fullClient({ rows: [] });
  let used = null;
  client.auth.signUp = () => { used = 'signUp'; return Promise.resolve({ data: { session: { user: { id: 'u1' } }, user: { id: 'u1', identities: [{ id: 'i1' }] } }, error: null }); };
  client.auth.signInWithPassword = () => { used = 'signIn'; return Promise.resolve({ data: { session: { user: { id: 'u1' } }, user: { id: 'u1' } }, error: null }); };
  account.configure({ client, protocol: 'https:' });
  session.clear();
  const g = seedGarage();
  session.setVehicles(g.vehicles, g.activeId);

  await account.signIn('a@b.c', 'pw', { signUp: true });

  assert.strictEqual(used, 'signUp');
});

test('start() pushes dirty vehicles before pulling', async () => {
  account.reset();
  await storage.openStorage({ protocol: 'https:', hasIndexedDb: true });
  localStorage.setItem('garage.sync.dirty', JSON.stringify(['local1']));
  const client = fullClient({ rows: [{ id: 'local1', data: { car: { nickname: 'Server' }, history: [], fuel: [], spending: [], docs: [] } }], activeId: 'local1' });
  client.auth.getSession = () => Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null });
  account.configure({ client, protocol: 'https:' });
  session.clear();
  const g = seedGarage();
  session.setVehicles(g.vehicles, g.activeId);

  const ok = await account.start();

  assert.strictEqual(ok, true);
  assert.strictEqual(client.calls.vehicles.length, 1, 'the dirty vehicle was pushed');
  assert.deepStrictEqual(account.dirty(), [], 'and cleared from the list');
});

test('start() with no stored session stays anonymous', async () => {
  account.reset();
  const client = fullClient({});
  client.auth.getSession = () => Promise.resolve({ data: { session: null }, error: null });
  account.configure({ client, protocol: 'https:' });

  assert.strictEqual(await account.start(), false);
  assert.strictEqual(account.user(), null);
});

/* Offline boot: the token is fine, the network is not. Stay signed in, keep
   rendering from local, push nothing away. */
test('start() keeps the user signed in when the pull fails offline', async () => {
  account.reset();
  const client = fullClient({ failSelect: true });
  client.auth.getSession = () => Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null });
  account.configure({ client, protocol: 'https:' });

  assert.strictEqual(await account.start(), false);
  assert.ok(account.user(), 'an unreachable server is not an expired session');
});

/* What session.clear() uniquely provides in the sign-out sequence, and the
   render test in test/render.test.js structurally cannot: the _generation
   bump. wipe() + load() leave an identical end state whether or not clear()
   ran, so a screen-based assertion can never tell them apart — but a save
   already in flight when sign-out happens is a different story. Without the
   generation check, that save's .then() would land in the NEXT signed-in
   user's session after sign-out completes. This exercises the real
   session.js module directly (not a spy), because the generation counter
   lives there and is the thing under test. */
test('a save in flight when sign-out happens cannot land in the next session', async () => {
  account.reset();
  const session2 = require('../src/data/session.js');
  session2.clear();

  let release;
  const gate = new Promise(r => { release = r; });
  const pushed = [];
  session2.configure({
    saveVehicle: () => gate.then(() => ({ ok: true, data: { car: { nickname: 'StaleUser' } }, photoIds: [] })),
    afterSave: (id, data) => pushed.push([id, data])
  });
  session2.setVehicles([{ id: 'v1', data: { car: { nickname: 'StaleUser' }, services: [], parts: [], history: [], spending: [], fuel: [], docs: [] } }], 'v1');

  const inFlight = session2.save();

  const client = fullClient({});
  client.auth.signOut = () => Promise.resolve({ error: null });
  account.configure({ client, protocol: 'https:', rerender: () => {}, wipe: () => Promise.resolve(true) });
  account.setUserForTest({ id: 'u1' });
  await account.signOut();

  release();

  assert.strictEqual(await inFlight, false, 'a save spanning sign-out must resolve false');
  assert.deepStrictEqual(pushed, [], 'and must never reach the push hook — that is the previous user data landing in the next account');
});

test('pushTombstone upserts a non-null deleted_at and updated_at for the right id', async () => {
  account.reset();
  const client = tableClient();
  account.configure({ client, protocol: 'https:' });
  account.setUserForTest({ id: 'u1' });

  const ok = await account.pushTombstone('v1');

  assert.strictEqual(ok, true);
  assert.strictEqual(client.calls.vehicles.length, 1);
  assert.strictEqual(client.calls.vehicles[0].id, 'v1');
  assert.ok(client.calls.vehicles[0].deleted_at, 'deleted_at must be set, not null');
  assert.ok(client.calls.vehicles[0].updated_at, 'updated_at must be set');
});

test('pushTombstone clears the vehicle from the dirty list', async () => {
  account.reset();
  localStorage.removeItem('garage.sync.dirty');
  const client = tableClient();
  account.configure({ client, protocol: 'https:' });
  account.setUserForTest({ id: 'u1' });
  account.markDirty('v1');
  assert.deepStrictEqual(account.dirty(), ['v1'], 'precondition: v1 starts dirty');

  await account.pushTombstone('v1');

  assert.deepStrictEqual(account.dirty(), []);
});

test('pushTombstone is a no-op when signed out', async () => {
  account.reset();
  localStorage.removeItem('garage.sync.dirty');
  const client = tableClient();
  account.configure({ client, protocol: 'https:' });
  account.markDirty('v1');

  const ok = await account.pushTombstone('v1');

  assert.strictEqual(ok, false);
  assert.strictEqual(client.calls.vehicles.length, 0, 'no upsert must be attempted');
  assert.deepStrictEqual(account.dirty(), ['v1'], 'the dirty list must be untouched');
});

test('pushTombstone resolves false and does not reject when the upsert fails', async () => {
  account.reset();
  const client = tableClient({ failUpsert: true });
  account.configure({ client, protocol: 'https:' });
  account.setUserForTest({ id: 'u1' });

  const ok = await account.pushTombstone('v1');

  assert.strictEqual(ok, false);
});

/* Documents the consequence of a local write that never reached the server:
   adopt() has no way to tell "added on this device a moment ago" from
   "deleted on another device", and the spec's replace-local semantics make it
   delete. That is why every direct saveVehicle() call site in app.js must
   push explicitly — see the app-level test in test/render.test.js. */
test('a vehicle that was never pushed is deleted by the next adopt()', async () => {
  account.reset();
  const storage2 = require('../storage.js');
  await storage2.openStorage({ protocol: 'https:', hasIndexedDb: true });
  const blank = () => ({ car: {}, history: [], fuel: [], spending: [], docs: [] });
  await storage2.saveVehicle('srv1', blank(), 'srv1', () => 'p1');
  await storage2.saveVehicle('unpushed', blank(), 'srv1', () => 'p2');
  account.configure({ client: fullClient({}), protocol: 'https:' });
  account.setUserForTest({ id: 'u1' });
  session.clear();
  session.setVehicles([{ id: 'srv1', data: blank() }, { id: 'unpushed', data: blank() }], 'srv1');

  await account.adopt({ vehicles: [{ id: 'srv1', data: blank() }], activeId: 'srv1' });

  assert.deepStrictEqual(session.garage().vehicles.map(v => v.id), ['srv1']);
  const after = await storage2.loadAll();
  const ids = after.garage.vehicles.map(v => v.id);
  assert.ok(ids.indexOf('srv1') >= 0, 'the server vehicle was written to disk');
  assert.ok(ids.indexOf('unpushed') < 0,
    'an un-pushed local vehicle does not survive a pull — the push is not optional');
});

/* Sign-up with confirmation pending: supabase-js resolves a truthy user with a
   NULL session. Gating on the user rather than the session signs the app in as
   `anon`, where RLS answers every select with an empty array and every upsert
   with a refusal. */
test('sign-up with a pending confirmation rejects and stays anonymous', async () => {
  account.reset();
  const client = fullClient({ rows: [] });
  client.auth.signUp = () => Promise.resolve({
    data: { session: null, user: { id: 'u1', email: 'a@b.c', identities: [{ id: 'i1' }] } },
    error: null
  });
  account.configure({ client, protocol: 'https:' });

  await assert.rejects(() => account.signIn('a@b.c', 'pw', { signUp: true }), /EMAIL_NOT_CONFIRMED/);
  assert.strictEqual(account.user(), null, 'a session-less user is not signed in');
  assert.strictEqual(client.calls.vehicles.length, 0, 'and nothing may be uploaded as anon');
});

/* supabase-js hides duplicate signups behind an empty identities array. */
test('sign-up for an existing address reports EMAIL_ALREADY_REGISTERED', async () => {
  account.reset();
  const client = fullClient({ rows: [] });
  client.auth.signUp = () => Promise.resolve({
    data: { session: null, user: { id: 'u1', email: 'a@b.c', identities: [] } },
    error: null
  });
  account.configure({ client, protocol: 'https:' });

  await assert.rejects(() => account.signIn('a@b.c', 'pw', { signUp: true }), /EMAIL_ALREADY_REGISTERED/);
  assert.strictEqual(account.user(), null);
});

/* _user used to be reset only inside the PULL_FAILED catch, so a rejection
   anywhere later — an RLS-refused upload, a throwing choose() — escaped with
   the module still believing it was signed in. */
test('a failure after a successful pull still leaves the user anonymous', async () => {
  account.reset();
  const client = fullClient({ rows: [] });
  client.auth.signInWithPassword = () => Promise.resolve({
    data: { session: { user: { id: 'u1' } }, user: { id: 'u1' } }, error: null
  });
  /* Server empty -> uploadAll(), and the upsert is refused the way RLS refuses
     a token-less request. */
  const realFrom = client.from;
  client.from = table => Object.assign(realFrom(table), {
    upsert: () => Promise.resolve({ error: new Error('new row violates row-level security policy') })
  });
  account.configure({ client, protocol: 'https:' });
  session.clear();
  const g = seedGarage();
  session.setVehicles(g.vehicles, g.activeId);

  await assert.rejects(() => account.signIn('a@b.c', 'pw'));
  assert.strictEqual(account.user(), null, 'sign-in must refuse rather than half-succeed');
});

/* adopt() bypasses hydrate(), so nothing re-resolves photo ids into object
   URLs. For a signed-in online user that means every boot paints the car photo
   from local storage and then removes it when the pull lands — the blob is
   still on disk, the record just lost its `.photo`. */
test('adopt re-resolves photo object URLs for the vehicles it pulls', async () => {
  account.reset();
  const storage2 = require('../storage.js');
  await storage2.openStorage({ protocol: 'https:', hasIndexedDb: true });
  account.configure({ client: fullClient({}), protocol: 'https:' });
  session.configure({ makeObjectUrl: b => 'blob:' + b.tag, revokeObjectUrl: () => {} });
  session.clear();
  session.setVehicles([{ id: 'old', data: { car: {}, history: [], fuel: [], spending: [], docs: [] } }], 'old');
  session.photos()['p1'] = { tag: 'car-photo' };      // the blob is on this device already

  await account.adopt({
    vehicles: [{ id: 'srv1', data: { car: { nickname: 'A', photoId: 'p1' }, history: [], fuel: [], spending: [], docs: [] } }],
    activeId: 'srv1'
  });

  assert.strictEqual(session.current().car.photo, 'blob:car-photo',
    'the pulled record carries photoId but no .photo — adopt must resolve it or the photo vanishes');
});

/* A server row written by an older build must be healed, not rendered raw. */
test('adopt normalizes pulled records', async () => {
  account.reset();
  const storage2 = require('../storage.js');
  await storage2.openStorage({ protocol: 'https:', hasIndexedDb: true });
  account.configure({ client: fullClient({}), protocol: 'https:' });
  session.clear();
  session.setVehicles([{ id: 'old', data: { car: {}, history: [], fuel: [], spending: [], docs: [] } }], 'old');

  await account.adopt({ vehicles: [{ id: 'srv1', data: { car: { nickname: 'A' } } }], activeId: 'srv1' });

  const d = session.current();
  ['history', 'fuel', 'spending', 'docs', 'services', 'parts'].forEach(k => {
    assert.ok(Array.isArray(d[k]), `${k} must be an array after adopt — the renderer maps over it`);
  });
});

/* expire() had no caller: nothing subscribed to auth state, so a mid-session
   token expiry left the module believing it was signed in. The constraint that
   matters more than the fix: this path must NEVER wipe. */
test('a signed-out auth event drops to anonymous and never wipes', async () => {
  account.reset();
  const spy = lifecycleSpy();
  const client = fullClient({ rows: [] });
  let handler = null;
  client.auth.getSession = () => Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null });
  client.auth.onAuthStateChange = fn => { handler = fn; return { data: { subscription: { unsubscribe() {} } } }; };
  account.configure({ client, protocol: 'https:', rerender: spy.rerender, session: spy.session, wipe: spy.wipe });

  await account.start();
  assert.ok(account.user(), 'precondition: start() restored the session');
  assert.strictEqual(typeof handler, 'function', 'start() must subscribe to auth state changes');

  handler('SIGNED_OUT', null);

  assert.strictEqual(account.user(), null, 'an expired session must drop to anonymous');
  assert.ok(spy.order.indexOf('wipe') < 0, 'an expired token must never wipe local data');
  assert.ok(spy.order.indexOf('clear') < 0, 'nor clear the in-memory garage');
});

test('a failed token refresh also drops to anonymous', async () => {
  account.reset();
  const spy = lifecycleSpy();
  const client = fullClient({ rows: [] });
  let handler = null;
  client.auth.getSession = () => Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null });
  client.auth.onAuthStateChange = fn => { handler = fn; return {}; };
  account.configure({ client, protocol: 'https:', rerender: spy.rerender, session: spy.session, wipe: spy.wipe });

  await account.start();
  handler('TOKEN_REFRESHED', null);

  assert.strictEqual(account.user(), null);
  assert.ok(spy.order.indexOf('wipe') < 0);
});

test('start() subscribes to auth state only once', async () => {
  account.reset();
  const client = fullClient({ rows: [] });
  let subs = 0;
  client.auth.getSession = () => Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null });
  client.auth.onAuthStateChange = () => { subs++; return {}; };
  account.configure({ client, protocol: 'https:', session: lifecycleSpy().session, wipe: () => Promise.resolve(true) });

  await account.start();
  await account.start();

  assert.strictEqual(subs, 1, 'a second boot path must not register a second listener');
});

/* Every existing fake omits onAuthStateChange, and so will a hand-rolled one
   in any future test. A missing subscription is not a boot failure. */
test('start() tolerates a client with no onAuthStateChange', async () => {
  account.reset();
  const client = fullClient({ rows: [] });
  client.auth.getSession = () => Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null });
  account.configure({ client, protocol: 'https:', session: lifecycleSpy().session, wipe: () => Promise.resolve(true) });

  await account.start();

  assert.ok(account.user(), 'the boot must still complete signed in');
});
