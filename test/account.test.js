'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { IDBFactory } = require('fake-indexeddb');

/* account.js reads localStorage for its dirty list, and Task 5's tests reach
   storage.js's IndexedDB backend. Neither exists in bare Node. This mirrors
   the shim in test/idb.test.js:23-34 rather than importing it, because that
   helper also swaps the storage.js module instance, which these tests must
   NOT do — account.js captured its dep at require time.

   This function, and the require()s of account.js/session.js/storage.js right
   after it, MUST come before any other src module is loaded. Each of those
   modules is the dual-mode UMD pattern: the factory function runs
   IMMEDIATELY at require() time, not lazily on first call, and Node caches
   the result — a module required once keeps whatever it captured for the
   rest of the process. Nothing in this codebase currently reads
   indexedDB/localStorage/location directly at that top level (account.js's
   own protocol() reads `location` lazily, inside a function, same as
   storage.js's openStorage()), but that is exactly the class of bug this
   ordering forecloses: a future factory-time capture of a browser global
   would otherwise silently bake in `undefined` forever if the module were
   required before this shim ran, with no error and no second chance. Keeping
   the shim first makes that failure mode structurally impossible rather than
   relying on every module staying lazy. */
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
const account = require('../src/data/account.js');
const session = require('../src/data/session.js');
const storage = require('../src/data/storage.js');

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

/* A fake PostgREST-shaped client. `rows` is what the server holds. Records
   every upsert so tests can assert on what actually crossed the wire. */
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
          return Promise.resolve(opts.failUpsert ? { error: new Error('offline') } : { error: null });
        },
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
      };
    }
  };
}

/* Every test whose account.configure() does not override ALL of the
   storage-touching deps (saveVehicle/removeVehicle/metaGet/metaSet/wipe)
   falls through to the real storage.js backend for whichever of those it
   does reach — and the outbox is never individually overridable at all, so
   enqueueVehicle/enqueueTombstone/enqueuePhoto/drain/start/sync always hit
   it. Those tests must start from an empty, known backend or they inherit
   whatever an earlier test in this file left behind: installBrowserGlobals()
   installs ONE fake IndexedDB for the whole file, not one per test. */
async function freshStorage() {
  await storage.openStorage({ protocol: 'https:', hasIndexedDb: true });
  await storage.wipe();
}

/* The sign-in boilerplate every drain/reconcile/adopt test repeats:
   reset the module, wire up a client, and become a signed-in user. Callers
   that also need to override a dep (getPhotoBlob, choose, ...) pass it as
   `extra`, merged over the base { client, protocol } config. */
function signInAs(client, extra) {
  account.reset();
  account.configure(Object.assign({ client, protocol: 'https:' }, extra || {}));
  account.setUserForTest({ id: 'u1' });
}

test('enqueueVehicle adds a vehicle entry to the outbox', async () => {
  await freshStorage();
  signInAs(fullClient({ rows: [] }));

  await account.enqueueVehicle('v1', { car: { nickname: 'A' } });

  assert.strictEqual(await account.outboxSize(), 1);
});

test('enqueueVehicle is a no-op when signed out', async () => {
  await freshStorage();
  account.reset();
  account.configure({ client: fullClient({ rows: [] }), protocol: 'https:' });

  await account.enqueueVehicle('v1', { car: {} });

  assert.strictEqual(await account.outboxSize(), 0);
});

test('drain() pushes a queued vehicle entry and removes it on success', async () => {
  await freshStorage();
  const client = fullClient({ rows: [] });
  signInAs(client);
  await account.enqueueVehicle('v1', { car: { nickname: 'A' } });

  const remaining = await account.drain();

  assert.strictEqual(remaining, 0);
  assert.strictEqual(client.calls.vehicles.length, 1);
  assert.strictEqual(client.calls.vehicles[0].id, 'v1');
});

test('drain() leaves a failed push queued for the next drain', async () => {
  await freshStorage();
  const client = fullClient({ failUpsert: true });
  signInAs(client);
  await account.enqueueVehicle('v1', { car: {} });

  const remaining = await account.drain();

  assert.strictEqual(remaining, 1, 'a failed push must stay in the outbox, not be dropped');
});

test('enqueueTombstone drains as a delete-marker upsert', async () => {
  await freshStorage();
  const client = fullClient({ rows: [] });
  signInAs(client);
  await account.enqueueTombstone('v1');

  await account.drain();

  assert.strictEqual(client.calls.vehicles.length, 1);
  assert.ok(client.calls.vehicles[0].deleted_at, 'a tombstone entry must upsert a non-null deleted_at');
  assert.strictEqual(await account.outboxSize(), 0);
});

test('enqueuePhoto drains by uploading the blob and removing the entry', async () => {
  await freshStorage();
  const client = fullClient({ rows: [] });
  const uploads = [];
  client.storage = { from: () => ({ upload: (path, blob) => { uploads.push({ path, blob }); return Promise.resolve({ error: null }); } }) };
  const blob = { type: 'image/jpeg' };
  signInAs(client, { getPhotoBlob: () => Promise.resolve(blob) });
  await account.enqueuePhoto('p1');

  const remaining = await account.drain();

  assert.strictEqual(remaining, 0);
  assert.strictEqual(uploads.length, 1);
  assert.strictEqual(uploads[0].path, 'u1/p1');
});

test('a photo entry with no local blob left to upload drains as a no-op', async () => {
  account.reset();
  await freshStorage();
  const client = fullClient({ rows: [] });
  client.storage = { from: () => ({ upload: () => { throw new Error('must not be called'); } }) };
  signInAs(client, { getPhotoBlob: () => Promise.resolve(null) });
  await account.enqueuePhoto('p1');

  const remaining = await account.drain();

  assert.strictEqual(remaining, 0, 'nothing to upload is not a failure — the entry still clears');
});

test('a failed upload leaves the photo entry queued', async () => {
  await freshStorage();
  const client = fullClient({ rows: [] });
  client.storage = { from: () => ({ upload: () => Promise.resolve({ error: new Error('quota') }) }) };
  signInAs(client, { getPhotoBlob: () => Promise.resolve({ type: 'image/jpeg' }) });
  await account.enqueuePhoto('p1');

  const remaining = await account.drain();

  assert.strictEqual(remaining, 1);
});

test('a photo entry uploads before a vehicle entry queued after it', async () => {
  await freshStorage();
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
  signInAs(client, { getPhotoBlob: () => Promise.resolve({ type: 'image/jpeg' }) });
  await account.enqueueVehicle('v1', { car: { photoId: 'p1' } });
  await account.enqueuePhoto('p1');

  await account.drain();

  assert.deepStrictEqual(order, ['photo', 'vehicle']);
});

/* Regression for main.js's importGarage/openAddVehicle save loop: a direct
   saveVehicle() call never reaches session.save()'s afterSave hook, so those
   two call sites enqueue the vehicle AND its saved photoIds themselves,
   mirroring afterSave — enqueueVehicle(id, data), then
   photoIds.forEach(enqueuePhoto). Without the enqueuePhoto half (the bug this
   guards against), a signed-in import pushes vehicle records whose photoId
   fields reference photos that never actually uploaded, and another device
   pulling that vehicle gets a 404 trying to fetch them. */
test('importing vehicles with photos while signed in uploads every photo on drain', async () => {
  await freshStorage();
  const client = fullClient({ rows: [] });
  const uploaded = [];
  client.storage = { from: () => ({ upload: path => { uploaded.push(path); return Promise.resolve({ error: null }); } }) };
  signInAs(client, { getPhotoBlob: () => Promise.resolve({ type: 'image/jpeg' }) });

  // Mirrors the save loop: saveVehicle() resolves { photoIds: [...] } for
  // each imported vehicle, and the caller enqueues the vehicle plus every one
  // of those ids.
  const imported = [
    { id: 'v1', photoIds: ['p1'] },
    { id: 'v2', photoIds: ['p2', 'p3'] }
  ];
  for (const v of imported) {
    await account.enqueueVehicle(v.id, { car: { photoId: v.photoIds[0] } });
    for (const pid of v.photoIds) await account.enqueuePhoto(pid);
  }

  const remaining = await account.drain();

  assert.strictEqual(remaining, 0);
  assert.deepStrictEqual(uploaded.sort(), ['u1/p1', 'u1/p2', 'u1/p3']);
});

function seedGarage(extra) {
  return {
    vehicles: [{ id: 'local1', data: Object.assign({
      car: { nickname: '', odometer: 0 },
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

/* The plan wizard writes `services` and `parts`, which are never empty and so
   say nothing on their own — planSetupDone is the only durable trace that a
   user configured this garage. Misreading that as an untouched seed replaces
   their setup with the server's, silently. */
test('isUntouchedSeed is false once the plan wizard has been completed', () => {
  account.reset();
  assert.strictEqual(account.isUntouchedSeed(seedGarage({ planSetupDone: true })), false);
});

test('isUntouchedSeed is false once the car itself has been configured', () => {
  account.reset();
  assert.strictEqual(account.isUntouchedSeed(seedGarage({ car: { nickname: 'Red', odometer: 316000 } })), false);
  assert.strictEqual(account.isUntouchedSeed(seedGarage({ car: { nickname: '', odometer: 12000 } })), false);
});

test('isUntouchedSeed is false for more than one vehicle', () => {
  account.reset();
  const g = seedGarage();
  g.vehicles.push({ id: 'local2', data: { history: [], fuel: [], spending: [], docs: [] } });
  assert.strictEqual(account.isUntouchedSeed(g), false);
});

test('reconcile uploads the local garage when the server is empty', async () => {
  await freshStorage();
  const client = fullClient({ rows: [] });
  signInAs(client);
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
  await freshStorage();
  const client = fullClient({});
  signInAs(client);
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
  await freshStorage();
  const client = fullClient({});
  let asked = 0;
  signInAs(client, { choose: () => { asked++; return Promise.resolve('local'); } });
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
  await freshStorage();
  const client = fullClient({});
  signInAs(client, { choose: () => Promise.resolve('local') });
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
  await freshStorage();
  const client = fullClient({});
  signInAs(client, { choose: () => Promise.resolve('server') });
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
  await freshStorage();
  account.reset();
  const storage2 = require('../src/data/storage.js');
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
  await freshStorage();
  account.reset();
  const storage2 = require('../src/data/storage.js');
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

/* watchAuth() was only ever called from start(): a session established via
   signIn() during the current run had no onAuthStateChange subscription, so
   a token that expired later was invisible — the same "Settings keeps saying
   Signed in as" symptom expire()'s own comment describes, just reached from
   the sign-in path instead of boot. */
test('signIn subscribes to auth state changes', async () => {
  account.reset();
  const client = fullClient({ rows: [] });
  let subs = 0;
  client.auth.signInWithPassword = () => Promise.resolve({ data: { session: { user: { id: 'u1' } }, user: { id: 'u1' } }, error: null });
  client.auth.onAuthStateChange = () => { subs++; return {}; };
  account.configure({ client, protocol: 'https:' });

  await account.signIn('a@b.c', 'pw');

  assert.strictEqual(subs, 1, 'signIn() must register the same auth-state listener as start()');
});

test('signing in after start() does not register a second listener', async () => {
  account.reset();
  const client = fullClient({ rows: [] });
  let subs = 0;
  client.auth.getSession = () => Promise.resolve({ data: { session: null }, error: null });
  client.auth.signInWithPassword = () => Promise.resolve({ data: { session: { user: { id: 'u1' } }, user: { id: 'u1' } }, error: null });
  client.auth.onAuthStateChange = () => { subs++; return {}; };
  account.configure({ client, protocol: 'https:' });

  await account.start();
  await account.signIn('a@b.c', 'pw');

  assert.strictEqual(subs, 1, 'watchAuth() is idempotent — a prior start() must not be followed by a second subscription');
});

test('start() pushes queued outbox entries before pulling', async () => {
  await freshStorage();
  account.reset();
  await storage.outboxAdd({ id: 'o1', kind: 'vehicle', vehicleId: 'local1', data: { car: { nickname: 'Local' } }, createdAt: new Date().toISOString() });
  const client = fullClient({ rows: [{ id: 'local1', data: { car: { nickname: 'Server' }, history: [], fuel: [], spending: [], docs: [] } }], activeId: 'local1' });
  client.auth.getSession = () => Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null });
  account.configure({ client, protocol: 'https:' });
  session.clear();
  const g = seedGarage();
  session.setVehicles(g.vehicles, g.activeId);

  const ok = await account.start();

  assert.strictEqual(ok, true);
  assert.strictEqual(client.calls.vehicles.length, 1, 'the queued vehicle was pushed');
  assert.strictEqual(await account.outboxSize(), 0, 'and removed from the outbox');
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

test('enqueueTombstone is a no-op when signed out', async () => {
  await freshStorage();
  account.reset();
  const client = fullClient({});
  account.configure({ client, protocol: 'https:' });

  const ok = await account.enqueueTombstone('v1');

  assert.strictEqual(ok, false);
  assert.strictEqual(client.calls.vehicles.length, 0, 'no upsert must be attempted');
  assert.strictEqual(await account.outboxSize(), 0, 'nothing was queued while signed out');
});

test('drain() leaves a failed tombstone push queued for the next drain', async () => {
  await freshStorage();
  const client = fullClient({ failUpsert: true });
  signInAs(client);
  await account.enqueueTombstone('v1');

  const remaining = await account.drain();

  assert.strictEqual(remaining, 1, 'a failed tombstone push must stay in the outbox, not be dropped');
});

/* Documents the consequence of a local write that never reached the server:
   adopt() has no way to tell "added on this device a moment ago" from
   "deleted on another device", and the spec's replace-local semantics make it
   delete. That is why every direct saveVehicle() call site in app.js must
   push explicitly — see the app-level test in test/render.test.js. */
test('a vehicle that was never pushed is deleted by the next adopt()', async () => {
  await freshStorage();
  account.reset();
  const storage2 = require('../src/data/storage.js');
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
  /* deepStrictEqual on the whole list, not indexOf on each id: with a
     leftover vehicle from another test (fresh() failing to run, a helper
     changing behavior, ...) indexOf-based checks would keep passing as long
     as srv1 is present and unpushed is absent — a third, unrelated id could
     sit in the disk record and this assertion would never notice. */
  assert.deepStrictEqual(ids, ['srv1'],
    'the server vehicle must be the only one written to disk — an un-pushed local vehicle does not survive a pull');
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
  await freshStorage();
  account.reset();
  const storage2 = require('../src/data/storage.js');
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
  await freshStorage();
  account.reset();
  const storage2 = require('../src/data/storage.js');
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

/* deleteVehicle() calls enqueueTombstone un-awaited and outside any try/catch.
   Unlike the old direct pushTombstone(), enqueueTombstone only writes to the
   outbox — it never touches env.client — so a client that throws synchronously
   from .from() cannot reach this call site at all; that risk now lives only in
   drainOne(), which every caller already reaches through drain()'s promise chain. */
test('enqueueTombstone cannot throw synchronously even with an exploding client', async () => {
  await freshStorage();
  const client = { auth: {}, from: () => { throw new Error('client exploded'); } };
  signInAs(client);

  let result;
  assert.doesNotThrow(() => { result = account.enqueueTombstone('v1'); });
  assert.strictEqual(await result, true);
});

test('sync() drains the outbox, then pulls incrementally', async () => {
  account.reset();
  const storage2 = require('../src/data/storage.js');
  await storage2.openStorage({ protocol: 'https:', hasIndexedDb: true });
  await storage2.wipe();
  session.clear();
  session.setVehicles([{ id: 'local1', data: { car: {}, history: [], fuel: [], spending: [], docs: [] } }], 'local1');
  const client = fullClient({ since: { '1970-01-01T00:00:00.000Z': [{ id: 'v2', data: { car: { nickname: 'B' } }, updated_at: '2026-08-22T00:00:00.000Z', deleted_at: null }] } });
  account.configure({ client, protocol: 'https:', getPhotoBlob: () => Promise.resolve(null), metaGet: storage2.metaGet, metaSet: storage2.metaSet });
  account.setUserForTest({ id: 'u1' });
  await account.enqueueVehicle('local1', { car: {} });
  assert.strictEqual(await account.outboxSize(), 1, 'sanity: the outbox has something to drain before sync() runs');

  const changed = await account.sync();

  assert.strictEqual(changed, true);
  assert.strictEqual(await account.outboxSize(), 0, 'sync() must drain the outbox, not merely pull');
  const ids = session.garage().vehicles.map(v => v.id);
  assert.ok(ids.indexOf('v2') >= 0, 'the pulled vehicle must be reflected in the re-hydrated session');
  const pulled = session.garage().vehicles.find(v => v.id === 'v2');
  assert.strictEqual(pulled.data.car.nickname, 'B');
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

/* saveVehicle/removeVehicle never REJECT on a storage failure in real usage —
   they RESOLVE { ok: false } / false. A pull that only checked for a rejected
   promise would treat this as success, advance the cursor, and silently drop
   the row forever. This drives applyPulledRow through that exact resolved
   shape, not a rejection, to prove the resolved-but-failed case is caught too. */
test('a save that resolves { ok: false } does not advance the cursor and is retried next pull', async () => {
  account.reset();
  const client = fullClient({ since: { '1970-01-01T00:00:00.000Z': [{ id: 'v1', data: {}, updated_at: '2026-08-22T00:00:00.000Z', deleted_at: null }] } });
  let saveCalls = 0;
  let metaSetCalls = 0;
  account.configure({
    client, protocol: 'https:',
    saveVehicle: () => { saveCalls++; return Promise.resolve({ ok: false, error: new Error('quota exceeded') }); },
    metaGet: () => Promise.resolve({}),
    metaSet: () => { metaSetCalls++; return Promise.resolve(true); }
  });
  account.setUserForTest({ id: 'u1' });

  await account.sync();

  assert.strictEqual(saveCalls, 1, 'the write must actually have been attempted');
  assert.strictEqual(metaSetCalls, 0, 'a resolved-but-failed write must not advance the cursor');
});

test('a removeVehicle that resolves false does not advance the cursor', async () => {
  account.reset();
  const client = fullClient({ since: { '1970-01-01T00:00:00.000Z': [{ id: 'v1', data: {}, updated_at: '2026-08-22T00:00:00.000Z', deleted_at: '2026-08-22T00:00:00.000Z' }] } });
  let removeCalls = 0;
  let metaSetCalls = 0;
  account.configure({
    client, protocol: 'https:',
    removeVehicle: () => { removeCalls++; return Promise.resolve(false); },
    metaGet: () => Promise.resolve({}),
    metaSet: () => { metaSetCalls++; return Promise.resolve(true); }
  });
  account.setUserForTest({ id: 'u1' });

  await account.sync();

  assert.strictEqual(removeCalls, 1);
  assert.strictEqual(metaSetCalls, 0, 'a resolved-but-failed tombstone removal must not advance the cursor');
});

test('lastPulledAt advances to the max updated_at in the batch, not the local clock', async () => {
  account.reset();
  const rows = [
    { id: 'v1', data: {}, updated_at: '2020-01-01T00:00:00.000Z', deleted_at: null },
    { id: 'v2', data: {}, updated_at: '2020-06-01T00:00:00.000Z', deleted_at: null }
  ];
  const client = fullClient({ since: { '1970-01-01T00:00:00.000Z': rows } });
  let patched = null;
  account.configure({
    client, protocol: 'https:',
    saveVehicle: () => Promise.resolve({ ok: true, photoIds: [], data: {} }),
    metaGet: () => Promise.resolve({}),
    metaSet: patch => { patched = patch; return Promise.resolve(true); }
  });
  account.setUserForTest({ id: 'u1' });

  await account.sync();

  assert.strictEqual(patched.lastPulledAt, '2020-06-01T00:00:00.000Z', 'the cursor must be the max updated_at in the batch, not the wall clock');
});

test('sync() resolves false rather than rejecting when the pull fails', async () => {
  account.reset();
  const client = fullClient({ failSelect: true });
  account.configure({ client, protocol: 'https:', metaGet: () => Promise.resolve({}), metaSet: () => Promise.resolve(true) });
  account.setUserForTest({ id: 'u1' });

  let result;
  await assert.doesNotReject(async () => { result = await account.sync(); });
  assert.strictEqual(result, false);
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

/* ============================================================
   Fix 2: a deleted vehicle can resurrect across drains.

   enqueueTombstone(id) must remove any already-queued 'vehicle' entry for
   the same vehicleId — Phase 4a's old pushTombstone had the equivalent
   clearDirty(id) guard, lost when the outbox replaced the dirty list.
   ============================================================ */
test('enqueueTombstone removes an already-queued vehicle entry for the same id', async () => {
  await freshStorage();
  signInAs(fullClient({ rows: [] }));

  await account.enqueueVehicle('v1', { car: { nickname: 'A' } });
  await account.enqueueTombstone('v1');

  const entries = await storage.outboxAll();
  assert.strictEqual(entries.length, 1, 'the stale vehicle entry must be dropped — only the tombstone remains');
  assert.strictEqual(entries[0].kind, 'tombstone');
  assert.strictEqual(entries[0].vehicleId, 'v1');
});

test('enqueueTombstone is a no-op filter when no vehicle entry is queued for the id', async () => {
  await freshStorage();
  signInAs(fullClient({ rows: [] }));

  // An unrelated vehicle entry must survive untouched — the filter targets
  // only entries matching THIS vehicleId, not "any vehicle entry".
  await account.enqueueVehicle('other', { car: {} });
  await account.enqueueTombstone('v1');   // no 'v1' vehicle entry is queued — must not throw or assume one exists

  const entries = await storage.outboxAll();
  assert.strictEqual(entries.length, 2);
  assert.ok(entries.some(e => e.kind === 'vehicle' && e.vehicleId === 'other'), 'the unrelated vehicle entry must survive');
  assert.ok(entries.some(e => e.kind === 'tombstone' && e.vehicleId === 'v1'));
});

/* ============================================================
   Fix 3: a sign-out mid-sync can write pulled data into a wiped store.

   pullIncremental() captures the signed-in user when it starts; if the user
   changes (signOut() nulling _user) partway through a multi-row batch,
   applyPulledRow() must refuse to run for the remaining rows and the cursor
   must not advance — the pull-side analogue of session.js's `_generation`
   guard on the push side.
   ============================================================ */
test('a user change mid-sync (sign-out race) stops applying the rest of the batch and does not advance the cursor', async () => {
  account.reset();
  const rows = [
    { id: 'v1', data: {}, updated_at: '2020-01-01T00:00:00.000Z', deleted_at: null },
    { id: 'v2', data: {}, updated_at: '2020-06-01T00:00:00.000Z', deleted_at: null }
  ];
  const client = fullClient({ since: { '1970-01-01T00:00:00.000Z': rows } });
  const savedIds = [];
  let metaSetCalls = 0;
  account.configure({
    client, protocol: 'https:',
    saveVehicle: id => {
      savedIds.push(id);
      // Simulates signOut() running while this row's write is in flight.
      if (id === 'v1') account.setUserForTest(null);
      return Promise.resolve({ ok: true, photoIds: [], data: {} });
    },
    metaGet: () => Promise.resolve({}),
    metaSet: () => { metaSetCalls++; return Promise.resolve(true); }
  });
  account.setUserForTest({ id: 'u1' });

  const result = await account.sync();

  assert.deepStrictEqual(savedIds, ['v1'], 'the row after the user changed must never reach saveVehicle');
  assert.strictEqual(metaSetCalls, 0, 'the cursor must not advance when the batch is aborted mid-way');
  assert.strictEqual(result, false, 'sync() must resolve false, not throw, when the sign-out race aborts the batch');
});

/* ============================================================
   Fix 4: a deleted vehicle's photos were never removed from Storage.

   enqueueTombstone(id, photoIds) must queue one 'photo-delete' outbox entry
   per photoId, and drain() must delete each one from the 'photos' bucket.
   ============================================================ */
test('enqueueTombstone(id, photoIds) queues a photo-delete entry per id', async () => {
  await freshStorage();
  signInAs(fullClient({ rows: [] }));

  await account.enqueueTombstone('v1', ['p1', 'p2']);

  const entries = await storage.outboxAll();
  assert.strictEqual(entries.length, 3, 'the tombstone plus one photo-delete entry per photoId');
  assert.strictEqual(entries.filter(e => e.kind === 'tombstone').length, 1);
  const deletes = entries.filter(e => e.kind === 'photo-delete').map(e => e.photoId).sort();
  assert.deepStrictEqual(deletes, ['p1', 'p2']);
});

test('enqueueTombstone with no photoIds queues no photo-delete entries', async () => {
  await freshStorage();
  signInAs(fullClient({ rows: [] }));

  await account.enqueueTombstone('v1');

  const entries = await storage.outboxAll();
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].kind, 'tombstone');
});

test('a photo-delete entry drains by removing the object from Storage', async () => {
  await freshStorage();
  const client = fullClient({ rows: [] });
  const removed = [];
  client.storage = { from: () => ({ remove: paths => { removed.push(paths); return Promise.resolve({ error: null }); } }) };
  signInAs(client);
  await account.enqueueTombstone('v1', ['p1']);

  const remaining = await account.drain();

  assert.strictEqual(remaining, 0);
  assert.deepStrictEqual(removed, [['u1/p1']]);
});

test('a failed photo-delete leaves the entry queued for the next drain', async () => {
  await freshStorage();
  const client = fullClient({ rows: [] });
  client.storage = { from: () => ({ remove: () => Promise.resolve({ error: new Error('offline') }) }) };
  signInAs(client);
  await account.enqueueTombstone('v1', ['p1']);

  const remaining = await account.drain();

  assert.strictEqual(remaining, 1, 'the tombstone drained, but the photo-delete must stay queued');
  const entries = await storage.outboxAll();
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].kind, 'photo-delete');
});

/* ============================================================
   Fix 5: a transient photo-download failure could become permanent.

   Before this fix, a photo that failed to download on one pull was only
   ever retried if its vehicle's updated_at moved past the cursor again — a
   photo-only failure never causes that, so the gap never closed on its
   own. Failed ids now persist to meta.pendingPhotoDownloads and are retried
   on every sync regardless of what (if anything) the cursor pulls.
   ============================================================ */
test('a failed photo download is recorded in meta.pendingPhotoDownloads', async () => {
  await freshStorage();
  const client = fullClient({ since: { '1970-01-01T00:00:00.000Z': [{ id: 'v1', data: { car: { photoId: 'p1' } }, updated_at: '2026-08-22T00:00:00.000Z', deleted_at: null }] } });
  client.storage = { from: () => ({ download: () => Promise.resolve({ data: null, error: new Error('offline') }) }) };
  let meta = {};
  signInAs(client, {
    getPhotoBlob: () => Promise.resolve(null),
    saveVehicle: () => Promise.resolve({ ok: true, photoIds: [], data: {} }),
    metaGet: () => Promise.resolve(meta),
    metaSet: patch => { meta = Object.assign({}, meta, patch); return Promise.resolve(true); }
  });

  await account.sync();

  assert.deepStrictEqual(meta.pendingPhotoDownloads, ['p1']);
});

test('a pending photo download is retried on the next sync and cleared once it succeeds', async () => {
  await freshStorage();
  const client = fullClient({ since: {} });  // no new rows on either sync
  let downloads = 0;
  const putCalls = [];
  client.storage = {
    from: () => ({
      download: () => {
        downloads++;
        return Promise.resolve(downloads === 1 ? { data: null, error: new Error('offline') } : { data: { type: 'image/jpeg' }, error: null });
      }
    })
  };
  let meta = { pendingPhotoDownloads: ['p1'], lastPulledAt: '2026-08-22T00:00:00.000Z' };
  signInAs(client, {
    getPhotoBlob: () => Promise.resolve(null),
    putPhotoBlob: (id) => { putCalls.push(id); return Promise.resolve(true); },
    metaGet: () => Promise.resolve(meta),
    metaSet: patch => { meta = Object.assign({}, meta, patch); return Promise.resolve(true); }
  });

  // sync() resolves true for both "ran clean, nothing new" and "ran clean,
  // applied changes" (see its own doc comment) — it cannot tell the two
  // apart from the outside, so both syncs below resolve true regardless of
  // whether the retry succeeded. The retry's actual outcome is asserted
  // through `meta` and `downloads`/`putCalls`, not sync()'s return value.
  const first = await account.sync();
  assert.strictEqual(downloads, 1);
  assert.deepStrictEqual(meta.pendingPhotoDownloads, ['p1'], 'still missing after a failed retry');
  assert.strictEqual(first, true);

  const second = await account.sync();

  assert.strictEqual(downloads, 2);
  assert.deepStrictEqual(putCalls, ['p1']);
  assert.deepStrictEqual(meta.pendingPhotoDownloads, [], 'cleared once the retry succeeds');
  assert.strictEqual(second, true);
});

test('a photo already present locally is dropped from pendingPhotoDownloads without a network call', async () => {
  await freshStorage();
  const client = fullClient({ since: {} });
  let downloads = 0;
  client.storage = { from: () => ({ download: () => { downloads++; return Promise.resolve({ data: {}, error: null }); } }) };
  let meta = { pendingPhotoDownloads: ['p1'] };
  signInAs(client, {
    getPhotoBlob: () => Promise.resolve({ type: 'image/jpeg' }),  // already local
    metaGet: () => Promise.resolve(meta),
    metaSet: patch => { meta = Object.assign({}, meta, patch); return Promise.resolve(true); }
  });

  await account.sync();

  assert.strictEqual(downloads, 0);
  assert.deepStrictEqual(meta.pendingPhotoDownloads, []);
});
