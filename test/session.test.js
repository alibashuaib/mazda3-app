'use strict';
const test = require('node:test');
const assert = require('node:assert');
const session = require('../src/data/session.js');

/* A blob stand-in — session only ever hands these to makeObjectUrl. */
function fakeBlob(tag) { return { tag }; }

function trackedUrls() {
  const made = [], revoked = [];
  return {
    made, revoked,
    makeObjectUrl: b => { const u = `blob:${b.tag}:${made.length}`; made.push(u); return u; },
    revokeObjectUrl: u => revoked.push(u)
  };
}

function vehicle(id, nickname) {
  return { id, data: { car: { nickname, odometer: 1000 }, services: [], parts: [], history: [], spending: [], fuel: [], docs: [] } };
}

test('current() and garage() are null before load', () => {
  session.clear();
  assert.strictEqual(session.current(), null);
  assert.strictEqual(session.garage(), null);
  assert.strictEqual(session.booted(), false);
});

test('setVehicles makes the active vehicle current', () => {
  session.clear();
  session.setVehicles([vehicle('a', 'Red'), vehicle('b', 'Blue')], 'b');
  assert.strictEqual(session.current().car.nickname, 'Blue');
  assert.strictEqual(session.garage().vehicles.length, 2);
});

test('switchVehicle moves current() to the named vehicle', () => {
  session.clear();
  session.setVehicles([vehicle('a', 'Red'), vehicle('b', 'Blue')], 'a');
  session.switchVehicle('b');
  assert.strictEqual(session.current().car.nickname, 'Blue');
  assert.strictEqual(session.garage().activeId, 'b');
});

test('switchVehicle ignores an unknown id rather than blanking the app', () => {
  session.clear();
  session.setVehicles([vehicle('a', 'Red')], 'a');
  session.switchVehicle('nope');
  assert.strictEqual(session.current().car.nickname, 'Red');
});

test('objectUrl registers a URL and revokeObjectUrls releases every one', () => {
  session.clear();
  const t = trackedUrls();
  session.configure({ makeObjectUrl: t.makeObjectUrl, revokeObjectUrl: t.revokeObjectUrl });
  const u1 = session.objectUrl(fakeBlob('a'));
  const u2 = session.objectUrl(fakeBlob('b'));
  session.revokeObjectUrls();
  assert.deepStrictEqual(t.revoked.sort(), [u1, u2].sort());
  session.revokeObjectUrls();
  assert.strictEqual(t.revoked.length, 2, 'a second sweep must not double-revoke');
});

/* The Phase 4 requirement. On a shared browser, IndexedDB is per-origin, so
   without a deliberate wipe the next user to sign in boots into the previous
   user's garage. */
test('clear() leaves no garage, no live object URLs and no cached photos', () => {
  const t = trackedUrls();
  session.configure({ makeObjectUrl: t.makeObjectUrl, revokeObjectUrl: t.revokeObjectUrl });
  session.setVehicles([vehicle('a', 'Red')], 'a');
  session.objectUrl(fakeBlob('receipt'));

  session.clear();

  assert.strictEqual(session.current(), null);
  assert.strictEqual(session.garage(), null);
  assert.strictEqual(session.booted(), false);
  assert.strictEqual(t.revoked.length, 1, 'clear must revoke outstanding URLs');
  assert.deepStrictEqual(session.photos(), {}, 'photo cache must be empty');
});

test('save() returns false when there is no active vehicle', async () => {
  session.clear();
  assert.strictEqual(await session.save(), false);
});

test('save() reports failure and notifies when the backend rejects the write', async () => {
  session.clear();
  const notes = [];
  session.configure({
    notify: (msg, kind) => notes.push({ msg, kind }),
    saveVehicle: async () => ({ ok: false, error: new Error('boom') })
  });
  session.setVehicles([vehicle('a', 'Red')], 'a');

  assert.strictEqual(await session.save(), false, 'a failed write must not report success');
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].kind, 'warn');
});

test('save() returns true on a successful write', async () => {
  session.clear();
  const notes = [];
  session.configure({
    notify: (msg, kind) => notes.push({ msg, kind }),
    saveVehicle: async () => ({ ok: true, data: {}, photoIds: {} })
  });
  session.setVehicles([vehicle('a', 'Red')], 'a');

  assert.strictEqual(await session.save(), true);
  assert.strictEqual(notes.length, 0, 'a successful write must not warn');
});

/* Fix 1: save()'s documented contract is Promise<boolean>. A backend that
   throws instead of resolving { ok: false } must not turn that into a
   rejection at all nineteen `await save()` call sites. */
test('save() resolves false and notifies when the backend throws synchronously', async () => {
  session.clear();
  const notes = [];
  session.configure({
    notify: (msg, kind) => notes.push({ msg, kind }),
    saveVehicle: () => { throw new Error('boom'); }
  });
  session.setVehicles([vehicle('a', 'Red')], 'a');

  assert.strictEqual(await session.save(), false, 'a thrown error must resolve false, not reject');
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].kind, 'warn');
});

test('save() resolves false and notifies when the backend returns a rejected promise', async () => {
  session.clear();
  const notes = [];
  session.configure({
    notify: (msg, kind) => notes.push({ msg, kind }),
    saveVehicle: async () => { throw new Error('boom'); }
  });
  session.setVehicles([vehicle('a', 'Red')], 'a');

  assert.strictEqual(await session.save(), false, 'a rejected promise must resolve false, not reject');
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].kind, 'warn');
});

/* Fix 2: a clear() (future sign-out) that lands while a save() is still in
   flight must not let that stale write touch the FRESH session — no photo
   Blob crossing into the next user's cache, and no toast on their screen. */
test('clear() during an in-flight save leaves photos() empty and the save resolves false', async () => {
  session.clear();
  const notes = [];
  let resolveSave;
  session.configure({
    notify: (msg, kind) => notes.push({ msg, kind }),
    saveVehicle: () => new Promise(resolve => { resolveSave = resolve; })
  });
  session.setVehicles([vehicle('a', 'Red')], 'a');

  const pending = session.save();
  await Promise.resolve();   // let save() reach the backend call and capture resolveSave
  session.clear();   // sign-out lands while the write above is still in flight

  resolveSave({ ok: true, data: { car: { photoId: 'p1' } }, photoIds: ['p1'] });

  assert.strictEqual(await pending, false, 'a stale write must not report success');
  assert.deepStrictEqual(session.photos(), {}, "the previous session's photo must not land in the fresh cache");
  assert.strictEqual(notes.length, 0, 'a stale write must not notify on the new session either');
});

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
