# Phase 4a — Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign in with an email and password on a second device and see the garage from the first, with per-user isolation enforced by Postgres.

**Architecture:** A new `src/data/account.js` owns auth, push and pull, and drives the existing `src/data/session.js` through its `configure` / `clear` / `load` / `setVehicles` surface. `session.js` stays local-only and gains one injected hook. The server is never in the write path: every write lands in IndexedDB first and returns immediately.

**Tech Stack:** Vanilla ES2020, dual-mode UMD modules, Supabase (Postgres + Auth) via a vendored UMD build, `node --test` with `linkedom` and `fake-indexeddb`, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-20-phase-4a-accounts-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **No `import` / `export` syntax and no `<script type="module">`, anywhere.** A `file://` origin is opaque and module scripts are CORS-checked. Running the app by double-clicking `index.html` is an acceptance criterion.
- **Every new module uses the dual-mode UMD wrapper** used by `storage.js`, `session.js` and `normalize.js`: a factory attaching to `root` in the browser and to `module.exports` under Node. Namespaced modules use `root.account = api`; helper modules use `Object.assign(root, api)`.
- **No new npm dependencies, runtime or dev.** `vendor/supabase.js` is a committed file, not an npm install. The devDependencies stay exactly `@playwright/test`, `fake-indexeddb`, `linkedom`.
- **Node `>=22`.** `package.json` `engines` is unchanged.
- **All HTML construction goes through `` html`` `` from `src/ui/html.js`.** `raw()` is bounded at 12 uses repo-wide by `test/no-raw-templates.test.js`; the real count is 9. Do not raise the bound. New UI must not need `raw()`.
- **No module exceeds roughly 400 lines.**
- **No visible change for a user who never signs in.** Six tabs remain six tabs.
- **`session.save()` keeps returning `Promise<boolean>` reflecting the local write only.** A push failure must never turn a successful local save into a failure message.
- **Two `localStorage` keys are reserved by this phase:** `garage.sync.dirty` (dirty vehicle ids). The existing `garage.mazda3.v2`, `garage.mazda3.v1`, `garage.theme` and `garage.lang` are untouched except by `wipe()`.
- **Commit after every task.** Run `npm test` before each commit.

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/data/account.js` | create | Auth state, push, pull, sign-in merge, sign-out. ~200 lines. |
| `vendor/supabase.js` | create | Pinned UMD build of `@supabase/supabase-js`. Publishes `window.supabase`. |
| `supabase/schema.sql` | create | Two tables, two RLS policies. Applied by hand. |
| `docs/superpowers/verification/2026-08-20-rls-manual.md` | create | Recorded manual RLS verification. |
| `test/account.test.js` | create | The new module, against a fake client. |
| `storage.js` | modify | Add `wipe()`. |
| `src/data/session.js` | modify | Add the `afterSave` hook. |
| `app.js` | modify | Account UI in Settings, boot wiring. |
| `src/i18n/strings.ar.js` | modify | Auth strings. |
| `index.html`, `sw.js` | modify | Script list and `ASSETS`. |
| `test/helpers/boot.js` | modify | `protocol` option; exclude `vendor/` from the order assertion. |
| `test/storage.test.js`, `test/session.test.js`, `test/render.test.js` | modify | Coverage for the above. |
| `e2e/smoke.spec.js` | modify | Account UI present over `http`, absent from `file://`. |

---

### Task 1: `storage.wipe()`

Sign-out must leave nothing behind. IndexedDB is per-origin, not per-user.

This also closes the first open Phase 4 precondition. `hydrate()` falls back to `readLegacyV1()` when the garage is empty (`session.js:60`), which would seed the next user with the previous user's pre-garage car. Deleting the legacy key here makes that fallback unreachable after a sign-out, so `session.js` needs no new parameter.

**Files:**
- Modify: `storage.js` (add `wipe()` near `removeVehicle`, around line 503; add to the exports object at line 507)
- Test: `test/idb.test.js` — **not** `test/storage.test.js`, which holds pure-function tests and installs neither `localStorage` nor `indexedDB`. `test/idb.test.js` already has the `freshStorage(seedLocal)` helper (`test/idb.test.js:23-34`) that gives each test its own module instance, database and `localStorage` map. Use it.

**Interfaces:**
- Consumes: `backend`, `idbTx`, `LS_KEY`, `LEGACY_V1_KEY` — all already in `storage.js`.
- Produces: `wipe(): Promise<boolean>` — resolves `true` on success, `false` on any failure. Never rejects.

- [ ] **Step 1: Write the failing tests**

Append to `test/idb.test.js`:

```js
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
  await storage.saveVehicle('v1', { car: { nickname: 'Red' } }, 'v1', makeIdFactory());

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

test('wipe() succeeds on the localStorage backend too', async () => {
  const storage = freshStorage({ vehicles: [{ id: 'a', data: {} }], activeId: 'a' });
  await storage.openStorage({ protocol: 'file:', hasIndexedDb: false });

  assert.strictEqual(await storage.wipe(), true);

  const after = await storage.loadAll();
  assert.strictEqual(after.garage, null);
});
```

If `makeIdFactory` is not already defined in `test/idb.test.js`, use an inline `() => 'p1'` instead — do not copy the helper across files.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- --test-name-pattern="wipe\(\)"`
Expected: FAIL with `storage.wipe is not a function`.

- [ ] **Step 3: Implement `wipe()`**

Insert in `storage.js` immediately after `removeVehicle` (before `backendKind`):

```js
  /* Sign-out's storage half. Clears both backends unconditionally, not just
     the active one: a user may have run on IndexedDB over http and on
     localStorage from disk, and leaving either populated hands the next user
     the previous user's garage.

     LEGACY_V1_KEY goes too, and that is load-bearing. hydrate() falls back to
     readLegacyV1() whenever the garage is empty, so without this delete the
     next sign-in would seed a fresh user from the previous one's pre-garage
     car. Phase 2's migration copied that key into the garage long ago, so
     nothing reachable is lost. */
  function wipe() {
    [LS_KEY, LEGACY_V1_KEY, DIRTY_KEY].forEach(k => {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    if (!backend || backend.kind !== 'idb') return Promise.resolve(true);
    return idbTx(backend.db, ['meta', 'vehicles', 'photos'], 'readwrite', tx => {
      tx.objectStore('meta').clear();
      tx.objectStore('vehicles').clear();
      tx.objectStore('photos').clear();
    }).then(() => true).catch(() => false);
  }
```

Add the constant beside the other keys at `storage.js:248`:

```js
  const DIRTY_KEY = 'garage.sync.dirty';   // account.js's outbox-lite; wiped with everything else
```

Add `wipe` to the exports object at line 507, after `removeVehicle`:

```js
    dataUrlToBlob, blobToDataUrl, openStorage, loadAll, saveVehicle, removeVehicle, wipe, backendKind
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, including the pre-existing storage tests.

- [ ] **Step 5: Commit**

```bash
git add storage.js test/idb.test.js
git commit -m "feat: add storage.wipe() for sign-out"
```

---

### Task 2: the `afterSave` hook in `session.js`

`account.js` needs to know when a local write succeeded, without `session.js` learning that accounts exist.

The hook goes **inside** the existing `res.ok` branch, which is already behind the `gen !== _generation` guard added when the in-flight-save precondition was fixed (`session.js:151`). That guard is what stops a save started before a sign-out from pushing into the next account.

**Files:**
- Modify: `src/data/session.js:32-38` (the `env` object), `src/data/session.js:150-161` (`save`)
- Test: `test/session.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `env.afterSave(vehicleId: string, storedData: object): void`, injected via `session.configure({ afterSave })`. Called with the **stored** form of the data — photos split out into ids, no base64 — which is exactly what `saveVehicle()` returns as `res.data`.

- [ ] **Step 1: Write the failing tests**

Append to `test/session.test.js`:

```js
test('afterSave fires with the stored data after a successful write', async () => {
  session.clear();
  const calls = [];
  session.configure({
    afterSave: (id, data) => calls.push([id, data]),
    saveVehicle: (id, data) => Promise.resolve({ ok: true, data: { car: { nickname: 'Red', photoId: 'p1' } }, photoIds: [] })
  });
  session.setVehicles([vehicle('a', 'Red')], 'a');

  const ok = await session.save();

  assert.strictEqual(ok, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], 'a');
  assert.strictEqual(calls[0][1].car.photoId, 'p1', 'the hook receives the stored form, not the live one');
});

test('afterSave does not fire for a failed write', async () => {
  session.clear();
  const calls = [];
  session.configure({
    afterSave: (id) => calls.push(id),
    saveVehicle: () => Promise.resolve({ ok: false, error: new Error('nope') })
  });
  session.setVehicles([vehicle('a', 'Red')], 'a');

  const ok = await session.save();

  assert.strictEqual(ok, false);
  assert.deepStrictEqual(calls, [], 'a failed local write must not be pushed');
});

/* The precondition that made accounts safe: a save started before sign-out
   must not push into the account that signed in after it. */
test('afterSave does not fire for a save whose generation is stale', async () => {
  session.clear();
  const calls = [];
  let release;
  const gate = new Promise(r => { release = r; });
  session.configure({
    afterSave: (id) => calls.push(id),
    saveVehicle: () => gate.then(() => ({ ok: true, data: {}, photoIds: [] }))
  });
  session.setVehicles([vehicle('a', 'Red')], 'a');

  const pending = session.save();
  session.clear();          // sign-out lands mid-write
  release();

  assert.strictEqual(await pending, false);
  assert.deepStrictEqual(calls, [], 'a stale write must have no side effects at all');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- --test-name-pattern="afterSave"`
Expected: the first test FAILS (`calls.length` is 0). The second and third pass already — they assert existing guarantees and are here to pin them against regression.

- [ ] **Step 3: Add the hook**

In `src/data/session.js`, add to the `env` object (currently lines 32-37):

```js
  let env = {
    notify: () => {},
    makeObjectUrl: b => URL.createObjectURL(b),
    revokeObjectUrl: u => URL.revokeObjectURL(u),
    saveVehicle: null,       // null means "use dep.saveVehicle"
    afterSave: () => {}      // account.js pushes from here; no-op when signed out
  };
```

In `save()`, extend the `res.ok` branch (currently lines 152-157):

```js
      if (res.ok) {
        dep.applyPhotoIds(data, res.data);
        cacheNewPhotos(data, res.photoIds);
        prunePhotoBlobs();
        /* Inside the ok branch and behind the generation check above, so a
           write started before a sign-out can never push into the account
           that signed in after it. Throwing here must not turn a successful
           local save into a failure. */
        try { env.afterSave(v.id, res.data); } catch (e) {}
        return true;
      }
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, all three new tests plus the existing suite.

- [ ] **Step 5: Commit**

```bash
git add src/data/session.js test/session.test.js
git commit -m "feat: add an afterSave hook to session.save()"
```

---

### Task 3: `account.js` — module skeleton, `available()`, dirty list

The module and its cheapest surface, so later tasks have somewhere to land.

**Files:**
- Create: `src/data/account.js`
- Test: `test/account.test.js`

**Interfaces:**
- Consumes: `storage.wipe` (Task 1); `session` and `storage` via the dual-mode `dep` object.
- Produces:
  - `configure(next: object): void` — merges into `env`. Recognised keys: `client`, `rerender`, `notify`, `choose`, `protocol`.
  - `available(): boolean` — `false` when the protocol is `file:` or no client is configured.
  - `user(): object|null`
  - `dirty(): string[]` — vehicle ids awaiting a push.
  - `reset(): void` — test-only; drops `_user` and `env` back to defaults.

- [ ] **Step 1: Write the failing tests**

Create `test/account.test.js`:

```js
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- --test-name-pattern="available|dirty|user\(\)"`
Expected: FAIL with `Cannot find module '../src/data/account.js'`.

- [ ] **Step 3: Create the module**

Create `src/data/account.js`:

```js
/* ============================================================
   Garage — accounts: who the garage belongs to.
   session.js owns the garage in memory and stays local-only; this
   module is the only thing that knows a server exists. It drives the
   session through configure/clear/load/setVehicles and never reaches
   past that surface.

   The invariant worth protecting: signOut() is the ONLY caller of
   session.clear() in the codebase, and it always follows it with a
   re-render. Revoking a blob URL does not blank an already-decoded
   <img>, so a clear() without a re-render leaves the previous user's
   car photo on screen.

   Dual-mode, like storage.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const dep = isNode
    ? Object.assign({}, require('../../storage.js'), require('../core/helpers.js'), { session: require('./session.js') })
    : root;
  const api = factory(dep);
  if (isNode) module.exports = api;
  else root.account = api;      // a namespace, not loose globals — `user` would collide
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {

  /* Public by design. RLS is the boundary; secrecy is not. Replace both
     before the first deploy — see supabase/schema.sql. */
  const SUPABASE_URL = 'https://REPLACE_ME.supabase.co';
  const SUPABASE_ANON_KEY = 'REPLACE_ME';

  const DIRTY_KEY = 'garage.sync.dirty';

  let _user = null;

  const DEFAULTS = {
    client: null,
    rerender: () => {},
    notify: () => {},
    choose: () => Promise.resolve('server'),
    protocol: null            // null means "read location.protocol"
  };
  let env = Object.assign({}, DEFAULTS);

  function configure(next) { env = Object.assign({}, env, next || {}); }
  function reset() { _user = null; env = Object.assign({}, DEFAULTS); }

  function protocol() {
    if (env.protocol) return env.protocol;
    return (typeof location !== 'undefined' && location.protocol) || '';
  }

  /* Sign-in needs a real origin: the vendored client is a same-origin script,
     but Supabase's own requests are cross-origin fetches that an opaque
     file:// origin cannot make. Opening index.html from disk is a documented
     feature, so it stays anonymous rather than showing a control that fails. */
  function available() { return protocol() !== 'file:' && !!env.client; }

  function user() { return _user; }

  function dirty() {
    try {
      const v = JSON.parse(localStorage.getItem(DIRTY_KEY));
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function setDirty(ids) {
    try { localStorage.setItem(DIRTY_KEY, JSON.stringify(ids)); } catch (e) {}
  }
  function markDirty(id) {
    const d = dirty();
    if (d.indexOf(id) < 0) { d.push(id); setDirty(d); }
  }
  function clearDirty(id) { setDirty(dirty().filter(x => x !== id)); }

  return {
    configure, reset, available, user,
    dirty, markDirty, clearDirty,
    SUPABASE_URL, SUPABASE_ANON_KEY
  };
});
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/account.js test/account.test.js
git commit -m "feat: add account.js with availability and the dirty list"
```

---

### Task 4: push, and `onSaved`

Pushing one vehicle, and the dirty-marking that makes an offline write recoverable.

**Files:**
- Modify: `src/data/account.js`
- Test: `test/account.test.js`

**Interfaces:**
- Consumes: `dirty` / `markDirty` / `clearDirty` (Task 3).
- Produces:
  - `stripPhotos(data: object): object` — a deep copy with every `photo` field removed, `photoId` kept.
  - `pushVehicle(id: string, data: object): Promise<true>` — rejects on error.
  - `pushGarage(activeId: string|null): Promise<true>`
  - `onSaved(id: string, data: object): Promise<boolean>` — never rejects. `false` means "marked dirty".

- [ ] **Step 1: Write the failing tests**

Append to `test/account.test.js`:

```js
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- --test-name-pattern="stripPhotos|onSaved"`
Expected: FAIL with `account.stripPhotos is not a function`.

- [ ] **Step 3: Implement**

Add to `src/data/account.js`, before the `return`:

```js
  /* Photos stay local in Phase 4a: the Blobs live in IndexedDB and only their
     ids cross the wire. Deep-copied so the live record keeps its object URL —
     the dashboard is still rendering from it. */
  function stripPhotos(data) {
    const copy = JSON.parse(JSON.stringify(data || {}));
    [copy.car].concat(copy.history || [], copy.spending || [])
      .filter(Boolean)
      .forEach(o => { delete o.photo; });
    return copy;
  }

  function nowIso() { return new Date().toISOString(); }

  /* user_id is filled by the column default (auth.uid()), so it is never sent
     and never trusted from the client. The upsert conflicts on the table's
     primary key, (user_id, id). */
  function pushVehicle(id, data) {
    return Promise.resolve(env.client.from('vehicles').upsert({
      id, data: stripPhotos(data), updated_at: nowIso(), deleted_at: null
    })).then(res => {
      if (res && res.error) throw res.error;
      return true;
    });
  }

  function pushGarage(activeId) {
    return Promise.resolve(env.client.from('garage').upsert({
      active_id: activeId, updated_at: nowIso()
    })).then(res => {
      if (res && res.error) throw res.error;
      return true;
    });
  }

  /* session.js calls this through env.afterSave, after a successful LOCAL
     write. Never rejects and never notifies: logging fuel at a petrol station
     with no signal is normal operation, not an error worth interrupting for.
     The dirty list is what makes it recoverable. */
  function onSaved(id, data) {
    if (!_user || !env.client) return Promise.resolve(false);
    return pushVehicle(id, data)
      .then(() => { clearDirty(id); return true; })
      .catch(() => { markDirty(id); return false; });
  }
```

Add a test-only setter next to `reset`:

```js
  /* Test seam only. Production code reaches _user through signIn/start. */
  function setUserForTest(u) { _user = u; }
```

Extend the exports:

```js
  return {
    configure, reset, available, user, setUserForTest,
    dirty, markDirty, clearDirty,
    stripPhotos, pushVehicle, pushGarage, onSaved,
    SUPABASE_URL, SUPABASE_ANON_KEY
  };
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/account.js test/account.test.js
git commit -m "feat: push a vehicle on save, or mark it dirty"
```

---

### Task 5: pull, and the sign-in merge

The three-way decision. This is the task where a wrong branch silently discards a user's garage, so every branch gets a test.

**Files:**
- Modify: `src/data/account.js`
- Test: `test/account.test.js`

**Interfaces:**
- Consumes: `pushVehicle`, `pushGarage`, `stripPhotos` (Task 4); `dep.session.garage()`, `dep.session.setVehicles()`, `dep.saveVehicle()`, `dep.uid()`.
- Produces:
  - `pull(): Promise<{vehicles: {id,data}[], activeId: string|null}>` — rejects on error.
  - `isUntouchedSeed(garage: object|null): boolean`
  - `adopt(pulled): Promise<void>` — replaces the local garage with the server's.
  - `uploadAll(garage): Promise<void>` — pushes every local vehicle, then the garage row.
  - `reconcile(pulled): Promise<void>` — the three-way decision. Sign-in only.

- [ ] **Step 1: Write the failing tests**

Append to `test/account.test.js`:

```js
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- --test-name-pattern="reconcile|isUntouchedSeed|pull rejects"`
Expected: FAIL with `account.isUntouchedSeed is not a function`.

- [ ] **Step 3: Implement**

Add to `src/data/account.js`, before the `return`:

```js
  function pull() {
    return Promise.all([
      Promise.resolve(env.client.from('vehicles').select('id,data,updated_at').is('deleted_at', null)),
      Promise.resolve(env.client.from('garage').select('active_id').maybeSingle())
    ]).then(([v, g]) => {
      if (v && v.error) throw v.error;
      if (g && g.error) throw g.error;
      return {
        vehicles: (v.data || []).map(r => ({ id: r.id, data: r.data })),
        activeId: (g && g.data && g.data.active_id) || null
      };
    });
  }

  /* The default vehicle hydrate() invents on a fresh device: one car, nothing
     logged against it. Derived from data already in memory rather than tracked
     with a flag — there is no state to keep in sync and nothing to migrate. */
  function isUntouchedSeed(garage) {
    if (!garage || !Array.isArray(garage.vehicles) || garage.vehicles.length !== 1) return false;
    const d = garage.vehicles[0].data || {};
    return ['history', 'fuel', 'spending', 'docs'].every(k => !(Array.isArray(d[k]) && d[k].length));
  }

  /* Replace the local garage with the server's, in memory and on disk, before
     anything renders. setVehicles() already falls back to the first vehicle
     when activeId names none. */
  function adopt(pulled) {
    dep.session.setVehicles(pulled.vehicles, pulled.activeId);
    const activeId = dep.session.garage() ? dep.session.garage().activeId : null;
    return pulled.vehicles.reduce(
      (p, v) => p.then(() => dep.saveVehicle(v.id, v.data, activeId, dep.uid)),
      Promise.resolve()
    ).then(() => {});
  }

  function uploadAll(garage) {
    if (!garage || !garage.vehicles) return Promise.resolve();
    return garage.vehicles.reduce(
      (p, v) => p.then(() => pushVehicle(v.id, v.data)),
      Promise.resolve()
    ).then(() => pushGarage(garage.activeId)).then(() => {});
  }

  /* Sign-in only. Boot takes the adopt() path directly: at boot both sides are
     the same user, dirty vehicles have already been pushed, so the server is
     current by construction and there is nothing to ask about. */
  function reconcile(pulled) {
    const local = dep.session.garage();
    if (!pulled.vehicles.length) return uploadAll(local);
    if (isUntouchedSeed(local)) return adopt(pulled);
    return Promise.resolve(env.choose()).then(keep => keep === 'local' ? uploadAll(local) : adopt(pulled));
  }
```

Extend the exports with `pull, isUntouchedSeed, adopt, uploadAll, reconcile`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/account.js test/account.test.js
git commit -m "feat: pull the server garage and reconcile it at sign-in"
```

---

### Task 6: `signIn`, `signOut`, `start` — and the expired-session split

The task the spec flags as the likeliest place for a data-loss bug. `signOut()` wipes; an expired token must not.

**Files:**
- Modify: `src/data/account.js`
- Test: `test/account.test.js`

**Interfaces:**
- Consumes: everything from Tasks 3-5; `dep.session.clear()`, `dep.session.load()`, `dep.session.save()`, `dep.wipe()`.
- Produces:
  - `signIn(email: string, password: string, opts?: {signUp?: boolean}): Promise<true>` — rejects with an `Error` whose `.message` is one of `PULL_FAILED`, `EMAIL_NOT_CONFIRMED`, or the provider's message.
  - `signOut(): Promise<true>`
  - `expire(): void` — drop to anonymous without wiping.
  - `start(): Promise<boolean>` — boot. Never rejects.
  - `drain(): Promise<number>` — remaining dirty count.

- [ ] **Step 1: Write the failing tests**

Append to `test/account.test.js`:

```js
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
  account.configure({ client, protocol: 'https:', rerender: spy.rerender });
  account.setDepsForTest({ session: spy.session, wipe: spy.wipe });
  account.setUserForTest({ id: 'u1' });

  await account.signOut();

  assert.deepStrictEqual(spy.order, ['clear', 'wipe', 'load', 'rerender']);
  assert.strictEqual(account.user(), null);
});

/* The data-loss guard. A phone offline for a fortnight must not lose a garage. */
test('expire() drops to anonymous and never wipes', () => {
  account.reset();
  const spy = lifecycleSpy();
  account.configure({ client: fullClient({}), protocol: 'https:', rerender: spy.rerender });
  account.setDepsForTest({ session: spy.session, wipe: spy.wipe });
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
  client.auth.signInWithPassword = () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null });
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
  client.auth.signUp = () => { used = 'signUp'; return Promise.resolve({ data: { user: { id: 'u1' } }, error: null }); };
  client.auth.signInWithPassword = () => { used = 'signIn'; return Promise.resolve({ data: { user: { id: 'u1' } }, error: null }); };
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- --test-name-pattern="signOut|expire|signIn|start\(\)"`
Expected: FAIL with `account.setDepsForTest is not a function`.

- [ ] **Step 3: Implement**

The dual-mode `dep` is frozen at load time, so add an override seam next to `setUserForTest`:

```js
  /* Test seam only. Lets a test swap session/wipe for spies so the lifecycle
     ORDER can be asserted — which is the property that matters here. */
  let deps = dep;
  function setDepsForTest(next) { deps = Object.assign({}, dep, next || {}); }
```

Then replace every `dep.` reference added in Tasks 4 and 5 with `deps.` (`deps.session`, `deps.saveVehicle`, `deps.uid`), and reset it in `reset()`:

```js
  function reset() { _user = null; env = Object.assign({}, DEFAULTS); deps = dep; }
```

Add the lifecycle:

```js
  function drain() {
    const ids = dirty();
    if (!ids.length) return Promise.resolve(0);
    const g = deps.session.garage();
    return ids.reduce((p, id) => p.then(() => {
      const v = g && g.vehicles.find(x => x.id === id);
      if (!v) { clearDirty(id); return null; }      // deleted since; nothing to push
      return pushVehicle(id, v.data).then(() => clearDirty(id)).catch(() => {});
    }), Promise.resolve()).then(() => dirty().length);
  }

  function signIn(email, password, opts) {
    opts = opts || {};
    const call = opts.signUp
      ? env.client.auth.signUp({ email, password })
      : env.client.auth.signInWithPassword({ email, password });
    return Promise.resolve(call).then(res => {
      if (res && res.error) throw res.error;
      const u = res && res.data && res.data.user;
      if (!u) throw new Error('EMAIL_NOT_CONFIRMED');
      _user = u;
      /* The merge decision cannot be made without knowing what the server
         holds, so an unreachable server fails the sign-in outright rather
         than leaving a half-signed-in state that would upload over it. */
      return pull().catch(() => { _user = null; throw new Error('PULL_FAILED'); });
    }).then(pulled => reconcile(pulled))
      .then(() => { env.rerender(); return true; });
  }

  /* Deliberate sign-out. Wipes. Contrast expire(), which must not.
     The ONLY caller of session.clear() in the codebase, and it always ends
     with a re-render: revoking a blob URL does not blank a decoded <img>. */
  function signOut() {
    return Promise.resolve(env.client && env.client.auth.signOut())
      .catch(() => {})                       // a failed remote sign-out must not strand local state
      .then(() => {
        _user = null;
        deps.session.clear();
        return deps.wipe();
      })
      .then(() => deps.session.load())
      .then(firstRun => (firstRun ? deps.session.save() : null))
      .then(() => { env.rerender(); return true; });
  }

  /* Token expired or refresh failed. Drop to anonymous and KEEP EVERYTHING:
     wiping here would destroy a garage because a phone was offline for a
     fortnight, or because of a transient 401. The next successful sign-in
     goes through the normal merge, which will ask. */
  function expire() {
    _user = null;
    env.rerender();
  }

  function start() {
    if (!available()) return Promise.resolve(false);
    return Promise.resolve(env.client.auth.getSession()).then(res => {
      if (res && res.error) throw res.error;
      const s = res && res.data && res.data.session;
      if (!s || !s.user) { _user = null; return false; }
      _user = s.user;
      /* Dirty first, then pull: the local writes that never made it up are
         newer than anything the server holds, and pulling first would adopt a
         garage that is missing them. */
      return drain()
        .then(() => pull())
        .then(pulled => adopt(pulled))
        .then(() => { env.rerender(); return true; })
        .catch(() => false);   // offline boot: stay signed in, keep rendering from local
    }).catch(() => { _user = null; return false; });
  }
```

Extend the exports with `setDepsForTest, drain, signIn, signOut, expire, start`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS. Confirm the `signOut` order assertion specifically — it is the invariant this phase exists to establish.

- [ ] **Step 5: Commit**

```bash
git add src/data/account.js test/account.test.js
git commit -m "feat: sign-in, sign-out, and the expired-session split"
```

---

### Task 7: vendor the client and wire the script lists

**Files:**
- Create: `vendor/supabase.js`, `vendor/README.md`
- Modify: `index.html:93-103`, `sw.js:3`, `test/helpers/boot.js`
- Test: `test/dom-harness.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `window.supabase.createClient(url, key)` in the browser. Never loaded under Node.

- [ ] **Step 1: Fetch and pin the build**

```bash
mkdir -p vendor
curl -fsSL https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/dist/umd/supabase.js -o vendor/supabase.js
node -e "console.log(require('fs').statSync('vendor/supabase.js').size)"
```

Confirm the file is non-empty and contains `createClient`. If 2.58.0 is unavailable, pin whatever current 2.x UMD build resolves and record that exact version in the next step.

- [ ] **Step 2: Record provenance**

Create `vendor/README.md`:

```markdown
# vendor/

Third-party code committed to the repo rather than installed.

The app has no build step and must run from `file://`, so it cannot use a
bundler or `<script type="module">`. A CDN `import()` would keep this
directory empty, but a cross-origin module cannot be cached by the service
worker the way a same-origin script can — and a signed-in user opening the
app offline is the case this app is built for.

## supabase.js

- **Package:** `@supabase/supabase-js`
- **Version:** 2.58.0
- **Source:** https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/dist/umd/supabase.js
- **Publishes:** `window.supabase`
- **Added:** 2026-08-20, Phase 4a

Updating is a deliberate decision, not a routine one: re-fetch the pinned URL
with a new version, re-run `npm test` and `npm run test:e2e`, and update this
file. Never loaded by the Node test suite — `account.js` takes its client
through `configure({ client })`.
```

- [ ] **Step 3: Add to `index.html`**

Insert before `src/data/session.js` (so `account.js` in Task 8 can follow it), replacing lines 93-103:

```html
  <script src="src/core/helpers.js"></script>
  <script src="src/ui/html.js"></script>
  <script src="src/data/catalog.js"></script>
  <script src="src/i18n/strings.ar.js"></script>
  <script src="schedule.js"></script>
  <script src="storage.js"></script>
  <script src="src/data/normalize.js"></script>
  <script src="src/data/session.js"></script>
  <script src="src/data/status.js"></script>
  <script src="vendor/supabase.js"></script>
  <script src="src/data/account.js"></script>
  <script src="ui.js"></script>
  <script src="app.js"></script>
```

- [ ] **Step 4: Add to `sw.js` ASSETS and bump the cache**

Replace `sw.js:2-3`:

```js
const CACHE = 'garage-v8';
const ASSETS = ['./', './index.html', './styles.css', './src/core/helpers.js', './src/ui/html.js', './src/data/catalog.js', './src/i18n/strings.ar.js', './schedule.js', './storage.js', './src/data/normalize.js', './src/data/session.js', './src/data/status.js', './vendor/supabase.js', './src/data/account.js', './ui.js', './app.js', './manifest.webmanifest', './icon.svg'];
```

- [ ] **Step 5: Teach the harness about `vendor/` and protocol**

In `test/helpers/boot.js`, add `'src/data/account.js'` to `SCRIPTS` after `'src/data/status.js'`. Do **not** add `vendor/supabase.js`.

Then change `assertScriptOrderMatchesIndexHtml` to filter it out, replacing the `.filter(src => src != null)` line:

```js
    /* vendor/ is excluded deliberately. The real Supabase client is a large
       browser bundle that reaches for fetch and window internals the harness
       does not provide, and account.js never uses the global under Node — it
       takes its client through configure({ client }). Excluding it here keeps
       the order assertion meaningful for everything the tests DO run. */
    .filter(src => src != null && src.indexOf('vendor/') !== 0);
```

And make the protocol overridable, replacing the `g.location` line in `makeContext`:

```js
function makeContext(dom, opts) {
  opts = opts || {};
```

```js
  /* 'file:' is the documented double-click case and selects the localStorage
     backend. Tests that need account UI pass protocol: 'https:' — account.js's
     available() is false on file:// by design. */
  const proto = opts.protocol || 'file:';
  g.location = { protocol: proto, href: proto === 'file:' ? 'file:///index.html' : proto + '//localhost/index.html' };
```

Thread it through `bootApp`, replacing the `makeContext(dom)` call:

```js
  const { context, g } = makeContext(dom, { protocol: opts.protocol });
```

- [ ] **Step 6: Add a harness test**

Append to `test/dom-harness.test.js`:

```js
test('the harness can boot on an https origin', async () => {
  const app = await bootApp({ protocol: 'https:' });
  try {
    assert.strictEqual(app.api.location.protocol, 'https:');
    assert.ok(app.api.account, 'account.js is loaded by the harness');
  } finally { app.cleanup(); }
});

test('the script order assertion ignores vendor/', () => {
  assert.doesNotThrow(assertScriptOrderMatchesIndexHtml);
});
```

Make sure `assertScriptOrderMatchesIndexHtml` is in the file's `require` of `./helpers/boot.js`.

- [ ] **Step 7: Run everything**

Run: `npm test`
Expected: PASS. Every existing DOM test still boots on `file:` because that is still the default.

- [ ] **Step 8: Commit**

```bash
git add vendor/ index.html sw.js test/helpers/boot.js test/dom-harness.test.js
git commit -m "feat: vendor the Supabase client and wire the script lists"
```

---

### Task 8: the account UI and boot wiring in `app.js`

**Files:**
- Modify: `app.js` (Settings dialog around line 1575; boot block at the tail, around line 2212)
- Modify: `src/i18n/strings.ar.js`

**Interfaces:**
- Consumes: the whole `account` namespace.
- Produces: `openAccount()` — a dialog; `accountEnv()` — the wiring, called once at boot.

- [ ] **Step 1: Add the Arabic strings**

In `src/i18n/strings.ar.js`, add to the dictionary object. Keep the file's existing key style — English source string as the key:

```js
  'Account': 'الحساب',
  'Sign in': 'تسجيل الدخول',
  'Sign up': 'إنشاء حساب',
  'Sign out': 'تسجيل الخروج',
  'Email': 'البريد الإلكتروني',
  'Password': 'كلمة المرور',
  'Signed in as': 'مسجّل الدخول باسم',
  'Not signed in': 'غير مسجّل الدخول',
  'Your garage stays on this device.': 'تبقى بياناتك على هذا الجهاز.',
  'Synced': 'تمت المزامنة',
  'Waiting to sync': 'في انتظار المزامنة',
  'Couldn’t reach your garage. Check your connection and try again.': 'تعذّر الوصول إلى بياناتك. تحقّق من اتصالك وحاول مرة أخرى.',
  'Check your email to confirm your account.': 'تحقّق من بريدك لتأكيد حسابك.',
  'Wrong email or password.': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'Password must be at least 6 characters.': 'يجب أن تكون كلمة المرور 6 أحرف على الأقل.',
  'Keep this device’s garage': 'الاحتفاظ ببيانات هذا الجهاز',
  'Use my account’s garage': 'استخدام بيانات حسابي',
  'You have data here and in your account': 'لديك بيانات هنا وفي حسابك',
  'Choose which one to keep. The other is replaced.': 'اختر أيهما تريد الاحتفاظ به. سيتم استبدال الآخر.'
};
```

- [ ] **Step 2: Add the account dialog**

Insert into `app.js` immediately before `function openSettings()` (line 1575):

```js
/* The merge prompt. Resolves 'local' or 'server'; the caller replaces the
   other side entirely, so the wording has to be unambiguous about that. */
function askWhichGarage() {
  return new Promise(resolve => {
    let answered = false;
    openModal(t('You have data here and in your account'), t('Choose which one to keep. The other is replaced.'), card => {
      const wrap = el('div', 'stack');
      const keepLocal = el('button', 'btn', html`${t('Keep this device’s garage')}`);
      const keepServer = el('button', 'btn ghost', html`${t('Use my account’s garage')}`);
      keepLocal.onclick = () => { answered = true; closeModal(); resolve('local'); };
      keepServer.onclick = () => { answered = true; closeModal(); resolve('server'); };
      wrap.appendChild(keepLocal);
      wrap.appendChild(keepServer);
      card.appendChild(wrap);
    });
    /* Dismissing the modal must still resolve, or signIn() hangs forever
       holding a user that has already authenticated. The server copy is the
       safe default: the local one is still on disk either way. */
    const host = $('#modalHost');
    const observer = () => { if (!answered && host.hidden) { answered = true; resolve('server'); } };
    setTimeout(function poll() { observer(); if (!answered) setTimeout(poll, 200); }, 200);
  });
}

function openAccount() {
  const signedIn = !!account.user();
  openModal(t('Account'), signedIn ? t('Signed in as') + ' ' + account.user().email : t('Your garage stays on this device.'), card => {
    if (signedIn) {
      const pending = account.dirty().length;
      const status = el('p', 'muted', html`${pending ? t('Waiting to sync') + ' · ' + pending : t('Synced')}`);
      card.appendChild(status);
      const out = el('button', 'btn ghost', html`${t('Sign out')}`);
      out.style.color = 'var(--danger)';
      out.onclick = () => { closeModal(); account.signOut(); };
      card.appendChild(out);
      return;
    }

    const form = el('div', 'stack');
    form.innerHTML = html`
      <label class="field"><span>${t('Email')}</span><input type="email" id="ac_email" autocomplete="email"></label>
      <label class="field"><span>${t('Password')}</span><input type="password" id="ac_pw" autocomplete="current-password"></label>
      <p class="muted" id="ac_err" hidden></p>`;
    card.appendChild(form);

    const err = form.querySelector('#ac_err');
    const show = msg => { err.textContent = t(msg); err.hidden = false; };

    const submit = mode => () => {
      err.hidden = true;
      const email = form.querySelector('#ac_email').value.trim();
      const pw = form.querySelector('#ac_pw').value;
      if (pw.length < 6) return show('Password must be at least 6 characters.');
      account.signIn(email, pw, { signUp: mode === 'up' })
        .then(() => closeModal())
        .catch(e => {
          const m = String(e && e.message || '');
          if (m === 'PULL_FAILED') return show('Couldn’t reach your garage. Check your connection and try again.');
          if (m === 'EMAIL_NOT_CONFIRMED') return show('Check your email to confirm your account.');
          show('Wrong email or password.');
        });
    };

    const inBtn = el('button', 'btn', html`${t('Sign in')}`);
    inBtn.onclick = submit('in');
    const upBtn = el('button', 'btn ghost', html`${t('Sign up')}`);
    upBtn.onclick = submit('up');
    card.appendChild(inBtn);
    card.appendChild(upBtn);
  });
}
```

- [ ] **Step 3: Add the Settings entry**

Inside `openSettings`, immediately after the language segment is appended (after `card.appendChild(langSeg);`, around line 1590), add:

```js
    // account row — absent entirely from file://, where sign-in cannot work
    if (account.available()) {
      const acctRow = el('div', 'card plan-setup-banner');
      acctRow.style.margin = '0 0 16px';
      acctRow.innerHTML = html`<div class="r-ic">👤</div><div style="flex:1"><h3>${t('Account')}</h3><p class="muted" style="font-size:12px;margin-top:2px">${account.user() ? account.user().email : t('Not signed in')}</p></div>`;
      const acctBtn = el('button', account.user() ? 'btn ghost' : 'btn', html`${account.user() ? t('Account') : t('Sign in')}`);
      acctBtn.onclick = () => { closeModal(); openAccount(); };
      acctRow.appendChild(acctBtn);
      card.appendChild(acctRow);
    }
```

- [ ] **Step 4: Wire it at boot**

In the boot block, replace the existing `session.configure(...)` line (line 2212) with:

```js
/* session.js emits its failure messages untranslated; t() here is what keeps
   the Arabic save-failure toasts working. */
session.configure({
  notify: (msg, kind) => toast(t(msg), kind),
  afterSave: (id, data) => account.onSaved(id, data)
});

/* The re-render half of sign-out. session.clear() revokes object URLs, but a
   decoded <img> stays painted until something rebuilds the view — so account.js
   never calls clear() without calling this after it. */
account.configure({
  client: (typeof supabase !== 'undefined' && account.available())
    ? supabase.createClient(account.SUPABASE_URL, account.SUPABASE_ANON_KEY)
    : null,
  rerender: () => { renderTopbar(); go(current); },
  notify: (msg, kind) => toast(t(msg), kind),
  choose: askWhichGarage
});
```

Then extend the boot chain, replacing the `.then(() => { applyAccent(); ... })` block:

```js
  .then(() => {
    applyAccent();
    renderTopbar();
    go('dashboard');
    /* After the first paint, never before: a slow or absent network must not
       delay the app a user can already use offline. */
    return account.start();
  })
```

Note `account.configure` must come **after** `available()` can see the protocol — it reads `location.protocol` directly, so no ordering concern beyond being in the boot block.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS. The existing render tests boot on `file:`, where `account.available()` is false and `client` is null, so nothing changes for them.

- [ ] **Step 6: Verify by hand in a browser**

```bash
node e2e/static-server.js
```

Open the printed URL. Confirm: Settings shows an Account row; the dialog opens; sign-in with an unreachable/placeholder Supabase URL shows the connection error rather than hanging. Then open `index.html` by double-clicking and confirm **no** Account row appears.

- [ ] **Step 7: Commit**

```bash
git add app.js src/i18n/strings.ar.js
git commit -m "feat: account UI in Settings, wired at boot"
```

---

### Task 9: the sign-out re-render test

The second open Phase 4 precondition, verified rather than documented.

**Files:**
- Modify: `test/render.test.js`

**Interfaces:**
- Consumes: `bootApp({ protocol })` (Task 7), `account.signOut()` (Task 6).

- [ ] **Step 1: Write the failing test**

Append to `test/render.test.js`:

```js
/* Phase 3 left this open: clear() revokes object URLs, but revoking a blob URL
   does not blank an already-decoded <img>. The previous user's car photo stays
   on screen until something re-renders. This asserts signOut() does both. */
test('signing out leaves no trace of the previous garage on screen', async () => {
  const app = await bootApp({ protocol: 'https:' });
  try {
    const { api, document } = app;

    api.session.setVehicles([{
      id: 'v1',
      data: {
        car: { nickname: 'PreviousUserCar', odometer: 1000, photo: 'blob:previous-photo' },
        services: [], parts: [], history: [], spending: [], fuel: [], docs: []
      }
    }], 'v1');
    api.go('dashboard');

    assert.ok(document.body.textContent.includes('PreviousUserCar'), 'precondition: the car is on screen');

    api.account.configure({
      client: { auth: { signOut: () => Promise.resolve({ error: null }) }, from: () => ({}) },
      protocol: 'https:',
      rerender: () => { api.renderTopbar(); api.go(api.current); }
    });
    api.account.setUserForTest({ id: 'u1', email: 'a@b.c' });

    await api.account.signOut();

    assert.ok(!document.body.textContent.includes('PreviousUserCar'),
      'the previous garage must not survive a sign-out on screen');
    assert.ok(![...document.querySelectorAll('img')].some(i => (i.getAttribute('src') || '').includes('previous-photo')),
      'no revoked blob URL may remain in the DOM');
  } finally { app.cleanup(); }
});
```

`api.current` is a top-level `let` in `app.js` and lives in the context's global lexical scope, not on the global object. If it is unreachable as a property, read it through `app.evalInApp('current')` instead:

```js
      rerender: () => { api.renderTopbar(); api.go(app.evalInApp('current')); }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --test-name-pattern="signing out leaves no trace"`
Expected: FAIL — either because `signOut` is not wired, or on the textContent assertion.

- [ ] **Step 3: Fix whatever it catches**

If the failure is in `app.js`'s wiring rather than the test, fix `app.js`. Do not weaken the assertions — they are the acceptance criterion.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/render.test.js app.js
git commit -m "test: sign-out leaves no trace of the previous garage on screen"
```

---

### Task 10: schema, RLS, and the manual verification record

**Files:**
- Create: `supabase/schema.sql`, `docs/superpowers/verification/2026-08-20-rls-manual.md`
- Modify: `src/data/account.js` (real URL and key)

- [ ] **Step 1: Write the schema**

Create `supabase/schema.sql`:

```sql
-- Garage — Phase 4a schema.
-- Apply by hand in the Supabase SQL editor. Idempotent: safe to re-run.
--
-- Vehicle ids are the app's own uid() values: seven base36 characters, not
-- UUIDs. The primary key is therefore composite and scoped by user, so two
-- users can hold the same id without colliding.

create table if not exists public.vehicles (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.garage (
  user_id    uuid        primary key default auth.uid() references auth.users on delete cascade,
  active_id  text,
  updated_at timestamptz not null default now()
);

-- Pulls filter on deleted_at and order by nothing else.
create index if not exists vehicles_user_live_idx
  on public.vehicles (user_id) where deleted_at is null;

alter table public.vehicles enable row level security;
alter table public.garage   enable row level security;

-- This is the mechanism that makes garages private. It is enforced by
-- Postgres, not by application code, and not by any check in account.js.
drop policy if exists own_vehicles on public.vehicles;
create policy own_vehicles on public.vehicles for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_garage on public.garage;
create policy own_garage on public.garage for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 2: Create the project and apply it**

In the Supabase dashboard: create a project, open the SQL editor, run `supabase/schema.sql`. Under Authentication → Providers, confirm Email is enabled with "Confirm email" on. Under Authentication → URL Configuration, add the deployed origin.

- [ ] **Step 3: Put the real values in `account.js`**

Replace the two placeholder constants with the project URL and the **anon** key — never the service-role key, which bypasses RLS entirely.

```js
  const SUPABASE_URL = 'https://<project>.supabase.co';
  const SUPABASE_ANON_KEY = '<anon key>';
```

- [ ] **Step 4: Verify RLS by hand and record it**

The Node suite cannot reach RLS — CI has no Postgres. Perform this and write down what actually happened:

1. Sign up as `a@example.com`, add a vehicle with a distinctive nickname, confirm it appears in the dashboard's `vehicles` table.
2. Sign out. Confirm the app returns to a blank seed garage and shows no trace of A.
3. Sign up as `b@example.com` in the same browser. Confirm B sees an empty garage, not A's vehicle.
4. In the SQL editor, run `select user_id, id from vehicles;` as the service role and confirm two distinct `user_id`s.
5. While signed in as B, open the browser console and attempt to read A's row directly:
   `await supabase.from('vehicles').select('*')` — confirm only B's rows come back.

Create `docs/superpowers/verification/2026-08-20-rls-manual.md` recording each step, what was observed, the date, and the Supabase project ref. Follow the format of the Phase 3 browser verification record already in the repo.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql docs/superpowers/verification/2026-08-20-rls-manual.md src/data/account.js
git commit -m "feat: add the Phase 4a schema and record the manual RLS verification"
```

---

### Task 11: browser smoke coverage

**Files:**
- Modify: `e2e/smoke.spec.js`

- [ ] **Step 1: Write the tests**

Append to `e2e/smoke.spec.js`, matching the file's existing pattern for the two origins:

```js
test('the account row is absent from file://', async ({ page }) => {
  await page.goto(fileUrl);
  await page.click('#settingsBtn');
  await expect(page.locator('.modal-card')).toBeVisible();
  await expect(page.locator('.modal-card').getByText('Account', { exact: true })).toHaveCount(0);
});

test('the account row is present over http', async ({ page }) => {
  await page.goto(httpUrl);
  await page.click('#settingsBtn');
  await expect(page.locator('.modal-card')).toBeVisible();
  await expect(page.locator('.modal-card').getByText('Account', { exact: true }).first()).toBeVisible();
});

test('the vendored client loads and does not break boot', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(httpUrl);
  await expect(page.locator('.view')).toBeVisible();
  expect(await page.evaluate(() => typeof window.supabase)).toBe('object');
  expect(errors).toEqual([]);
});
```

Use whatever `fileUrl` / `httpUrl` bindings the file already defines; do not introduce new ones.

- [ ] **Step 2: Run the browser suite**

Run: `npm run test:e2e`
Expected: PASS, all pre-existing tests plus the three new ones.

- [ ] **Step 3: Verify offline boot**

In Chrome DevTools against the http origin: load the app, sign in, then Application → Service Workers → Offline, and hard reload. Confirm the app boots, renders, and shows the Account row — `vendor/supabase.js` is in `ASSETS`, so it must come from cache.

- [ ] **Step 4: Commit**

```bash
git add e2e/smoke.spec.js
git commit -m "test: browser coverage for the account UI on both origins"
```

---

## Verification against the acceptance criteria

Run before opening the PR. Every line is from the spec.

- [ ] Two accounts on the same browser cannot see each other's vehicles — Task 10 step 4, recorded.
- [ ] Signing in on a second device shows the garage from the first — manual, two browsers.
- [ ] Signing out then signing in as a different user does not seed the second with the first's legacy car — Task 1 (`wipe()` deletes `LEGACY_V1_KEY`) plus Task 10 step 3.
- [ ] Signing out leaves no previous user's photo or vehicle text on screen — Task 9.
- [ ] An expired token never wipes local data — Task 6.
- [ ] The app still runs by double-clicking `index.html`, with no account UI — Task 11.
- [ ] The app still works offline after a hard reload, including `vendor/supabase.js` — Task 11 step 3.
- [ ] A nickname of `<img src=x onerror=alert(1)>` renders as literal text, including from the server — the existing injection sweep in `test/render.test.js` covers the render path; extend its seeded data to include a pulled vehicle if the sweep does not already reach one.
- [ ] `npm test` green.
- [ ] `npm run test:e2e` green from both origins.
- [ ] `node --check` passes on every shipped file, including `vendor/supabase.js` and `src/data/account.js` — the CI job added in `8ba8a78` does this.
- [ ] No module over ~400 lines — check `wc -l src/data/account.js`.
- [ ] `raw()` count unchanged at 9, bound unchanged at 12 — `test/no-raw-templates.test.js`.

## Follow-ups, deliberately not in this plan

- **A gated live-Supabase integration test for RLS.** Needs a dedicated project and CI secrets; it is its own piece of work, and manual verification covers 4a.
- **Phase 3 steps 4 and 5.** The account UI added here lands in `app.js` and will move to `ui/chrome.js` when the module split resumes.
- **Phase 4b:** the outbox, incremental pulls, and photo upload to Supabase Storage.
