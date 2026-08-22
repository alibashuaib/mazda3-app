'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { shouldTryIndexedDb, splitPhotos, inlinePhotos, buildExport, parseImport } = require('../storage.js');
const { parseLegacyV1, migrationPlan, applyPhotoIds } = require('../storage.js');
const { photoIdsIn, orphanedPhotoIds, unreferencedPhotoIds, normalizeRecords, importFaults } = require('../storage.js');
const { dataUrlToBlob, blobToDataUrl } = require('../storage.js');
const { collectInlinePhotos } = require('../storage.js');
const { openStorage } = require('../storage.js');

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

/* Import is the one path where the app is handed a file it did not write.
   The rule is that STRUCTURE must be sound and CONTENT is repaired: a vehicle
   with no id or a history that is a string cannot be restored sanely, but a
   record missing its date can — and a backup exported after an earlier repair
   legitimately carries empty dates, so rejecting those would make the repair
   path a one-way trip. */
const wrapExport = garage => JSON.stringify(buildExport(garage, {}, '2026-08-16T00:00:00Z'));
const oneVehicle = data => ({ vehicles: [{ id: 'v1', data }], activeId: 'v1' });

test('parseImport rejects structurally damaged vehicles', () => {
  const cases = [
    ['record list is a string', { car: {}, history: 'nope' }],
    ['record list holds a null', { car: {}, spending: [null] }],
    ['record list holds a string', { car: {}, fuel: ['junk'] }],
    ['record list holds a number', { car: {}, docs: [42] }],
    ['record list holds an array', { car: {}, parts: [[]] }],
    ['car is not an object', { car: 'a car' }],
    ['car is an array', { car: [] }]
  ];
  for (const [label, data] of cases) {
    const out = parseImport(wrapExport(oneVehicle(data)));
    assert.strictEqual(out.ok, false, `${label} should be rejected`);
    assert.ok(out.faults && out.faults.length, `${label} should say why`);
  }
});

test('parseImport rejects a damaged vehicle wrapper', () => {
  assert.strictEqual(parseImport(wrapExport({ vehicles: [null], activeId: null })).ok, false);
  assert.strictEqual(parseImport(wrapExport({ vehicles: [{ data: { car: {} } }] })).ok, false);          // no id
  assert.strictEqual(parseImport(wrapExport({ vehicles: [{ id: 7, data: { car: {} } }] })).ok, false);   // id not a string
  assert.strictEqual(parseImport(wrapExport({ vehicles: [{ id: 'v', data: [] }] })).ok, false);          // data is an array
});

test('parseImport rejects a damaged photos dictionary', () => {
  const text = JSON.stringify(Object.assign(
    JSON.parse(wrapExport(oneVehicle({ car: {} }))), { photos: ['not', 'a', 'dict'] }));
  assert.strictEqual(parseImport(text).ok, false);
});

test('parseImport still accepts a sparse but sound backup', () => {
  // absent lists, and records missing the fields normalizeRecords repairs
  assert.strictEqual(parseImport(wrapExport(oneVehicle({ car: {} }))).ok, true);
  assert.strictEqual(parseImport(wrapExport(oneVehicle({}))).ok, true);
  const sparse = { car: { nickname: 'X' }, history: [{ id: 'h1' }], spending: [{ id: 's1', date: '' }], parts: [{ name: 'Filter' }] };
  const out = parseImport(wrapExport(oneVehicle(sparse)));
  assert.strictEqual(out.ok, true, 'repairable content must not be rejected');
});

test('parseImport reports every fault it found, not just the first', () => {
  const garage = { vehicles: [
    { id: 'v1', data: { car: {}, history: 'nope', spending: [null] } },
    { data: { car: {} } }
  ], activeId: 'v1' };
  const out = parseImport(wrapExport(garage));
  assert.strictEqual(out.ok, false);
  assert.ok(out.faults.length >= 3, `expected several faults, got ${JSON.stringify(out.faults)}`);
  assert.ok(out.faults.some(f => f.includes('vehicle 2')), 'faults should name which vehicle');
});

test('importFaults returns nothing for a healthy garage', () => {
  assert.deepStrictEqual(importFaults([{ id: 'v1', data: { car: {}, history: [{ id: 'h' }], parts: [] } }]), []);
});

test('importFaults counts bad entries in readable English', () => {
  const one = importFaults([{ id: 'v1', data: { history: [null] } }]);
  assert.deepStrictEqual(one, ['vehicle 1: history has 1 entry that is not a record']);
  const many = importFaults([{ id: 'v1', data: { history: [null, 'x', 3] } }]);
  assert.deepStrictEqual(many, ['vehicle 1: history has 3 entries that are not records']);
});

/* Regression for the boot crashes found by sweeping every route against
   malformed payloads. Each of these fields is read with a string or array
   method somewhere in a render path, so an absent one takes the whole app
   down at boot — the user sees "Could not open your garage" over data that
   loaded fine. Reachable from a legacy v1 payload and from any imported
   backup. */
let seq = 0;
const ids = () => `id${++seq}`;

test('normalizeRecords fills the fields the render paths call methods on', () => {
  const s = normalizeRecords({
    history: [{}], spending: [{}], fuel: [{}], docs: [{}], parts: [{}], services: [{}]
  }, ids);
  assert.strictEqual(typeof s.history[0].date, 'string');    // e.date.slice(0,4)
  assert.strictEqual(typeof s.spending[0].date, 'string');   // e.date.startsWith(year)
  assert.strictEqual(typeof s.fuel[0].date, 'string');
  assert.strictEqual(typeof s.docs[0].date, 'string');
  assert.ok(Array.isArray(s.parts[0].options));              // p.options.map(o => o.price)
  assert.strictEqual(s.parts[0].cat, 'General');
  ['history', 'spending', 'fuel', 'docs', 'services'].forEach(k => assert.ok(s[k][0].id, `${k} entry should get an id`));
});

test('normalizeRecords coerces numeric fields instead of leaving NaN', () => {
  const s = normalizeRecords({
    history: [{ cost: 'abc', odometer: null }],
    spending: [{ amount: '250' }],
    fuel: [{ litres: undefined, cost: '95.5' }]
  }, ids);
  assert.strictEqual(s.history[0].cost, 0);
  assert.strictEqual(s.history[0].odometer, 0);
  assert.strictEqual(s.spending[0].amount, 250);      // a numeric string is real data, keep it
  assert.strictEqual(s.fuel[0].litres, 0);
  assert.strictEqual(s.fuel[0].cost, 95.5);
});

test('normalizeRecords drops entries that are not objects', () => {
  const s = normalizeRecords({ history: [null, { id: 'h1' }, 'junk', 42, ['nested']], spending: 'not an array' }, ids);
  assert.deepStrictEqual(s.history.map(e => e.id), ['h1']);
  assert.deepStrictEqual(s.spending, []);
});

test('normalizeRecords leaves good data alone', () => {
  const good = {
    history: [{ id: 'h1', date: '2026-01-02', service: 'Oil', cost: 200, odometer: 1000 }],
    spending: [{ id: 's1', date: '2026-03-04', amount: 50, cat: 'Fuel' }],
    fuel: [], docs: [], parts: [{ name: 'Filter', cat: 'Engine', options: [{ price: 30 }] }], services: []
  };
  const before = JSON.parse(JSON.stringify(good));
  const after = normalizeRecords(good, ids);
  assert.deepStrictEqual(after.history, before.history);
  assert.deepStrictEqual(after.spending, before.spending);
  assert.deepStrictEqual(after.parts, before.parts);
});

test('normalizeRecords is idempotent and tolerates an empty object', () => {
  const once = normalizeRecords({ history: [{}] }, ids);
  const id = once.history[0].id;
  const twice = normalizeRecords(once, ids);
  assert.strictEqual(twice.history[0].id, id, 'a second pass must not re-mint ids');
  assert.doesNotThrow(() => normalizeRecords({}, ids));
  assert.strictEqual(normalizeRecords(null, ids), null);
});

test('photoIdsIn collects every referenced id, once each', () => {
  const data = {
    car: { photoId: 'pc' },
    history: [{ id: 'h1', photoId: 'p1' }, { id: 'h2' }, { id: 'h3', photoId: 'p1' }],
    spending: [{ id: 's1', photoId: 'p2' }]
  };
  assert.deepStrictEqual(photoIdsIn(data).sort(), ['p1', 'p2', 'pc']);
  assert.deepStrictEqual(photoIdsIn(null), []);
  assert.deepStrictEqual(photoIdsIn({ car: {} }), []);
});

/* Regression for #5: saveVehicle wrote replacement blobs but never deleted
   the ones they replaced, so the photo store only ever grew — and
   exportGarage base64s all of it into every backup. */
test('orphanedPhotoIds finds photos the new version of a record dropped', () => {
  const prev = { car: { photoId: 'pc' }, history: [{ id: 'h1', photoId: 'p1' }], spending: [] };
  const replaced = { car: { photoId: 'pc2' }, history: [{ id: 'h1', photoId: 'p1' }], spending: [] };
  assert.deepStrictEqual(orphanedPhotoIds(prev, replaced), ['pc']);

  const removed = { car: {}, history: [{ id: 'h1' }], spending: [] };   // both photos deleted
  assert.deepStrictEqual(orphanedPhotoIds(prev, removed).sort(), ['p1', 'pc']);

  const recordGone = { car: { photoId: 'pc' }, history: [], spending: [] };
  assert.deepStrictEqual(orphanedPhotoIds(prev, recordGone), ['p1']);

  assert.deepStrictEqual(orphanedPhotoIds(prev, prev), []);   // unchanged save deletes nothing
  assert.deepStrictEqual(orphanedPhotoIds(null, replaced), []);
});

test('unreferencedPhotoIds finds orphans across the whole garage', () => {
  const vehicles = [
    { id: 'v1', data: { car: { photoId: 'pc' }, history: [{ id: 'h1', photoId: 'p1' }], spending: [] } },
    { id: 'v2', data: { car: {}, history: [], spending: [{ id: 's1', photoId: 'p2' }] } }
  ];
  assert.deepStrictEqual(unreferencedPhotoIds(['pc', 'p1', 'p2', 'dead1', 'dead2'], vehicles), ['dead1', 'dead2']);
  assert.deepStrictEqual(unreferencedPhotoIds(['pc', 'p1', 'p2'], vehicles), []);
  // a photo must not be swept just because the OTHER vehicle does not use it
  assert.deepStrictEqual(unreferencedPhotoIds(['p2'], vehicles), []);
  assert.deepStrictEqual(unreferencedPhotoIds([], vehicles), []);
  assert.deepStrictEqual(unreferencedPhotoIds(['x'], []), ['x']);
  assert.deepStrictEqual(unreferencedPhotoIds(['x'], null), ['x']);
});

test('applyPhotoIds copies ids onto the matching records', () => {
  const live = { car: {}, history: [{ id: 'h1' }, { id: 'h2' }], spending: [{ id: 's1' }] };
  const stored = {
    car: { photoId: 'pc' },
    history: [{ id: 'h1', photoId: 'p1' }, { id: 'h2' }],
    spending: [{ id: 's1', photoId: 'p3' }]
  };
  applyPhotoIds(live, stored);
  assert.strictEqual(live.car.photoId, 'pc');
  assert.strictEqual(live.history[0].photoId, 'p1');
  assert.ok(!('photoId' in live.history[1]));   // stored has none — clear it
  assert.strictEqual(live.spending[0].photoId, 'p3');
});

/* Regression: this zipped the two arrays by index. save() is fired without
   await by markServiceDone() and logVisit(), so a delete can land before the
   write resolves — every record past it shifts, and h3 would inherit h2's
   photo while h2's own id is dropped. */
test('applyPhotoIds survives a record deleted while the save was in flight', () => {
  const stored = {
    car: {},
    history: [{ id: 'h1', photoId: 'p1' }, { id: 'h2', photoId: 'p2' }, { id: 'h3', photoId: 'p3' }],
    spending: []
  };
  const live = { car: {}, history: [{ id: 'h1' }, { id: 'h3' }], spending: [] };   // h2 deleted mid-write
  applyPhotoIds(live, stored);
  assert.strictEqual(live.history[0].photoId, 'p1');
  assert.strictEqual(live.history[1].photoId, 'p3');   // not p2, which index-matching would have given it
});

test('applyPhotoIds leaves a record added after the snapshot untouched', () => {
  const live = { car: {}, history: [{ id: 'h1' }, { id: 'h9', photo: 'data:image/jpeg;base64,AAAA' }], spending: [] };
  const stored = { car: {}, history: [{ id: 'h1', photoId: 'p1' }], spending: [] };
  applyPhotoIds(live, stored);
  assert.strictEqual(live.history[0].photoId, 'p1');
  assert.ok(!('photoId' in live.history[1]));          // its own save will claim one
  assert.strictEqual(live.history[1].photo, 'data:image/jpeg;base64,AAAA');
});

test('applyPhotoIds tolerates missing arrays and null records', () => {
  assert.doesNotThrow(() => applyPhotoIds({ car: {} }, { car: {} }));
  assert.doesNotThrow(() => applyPhotoIds({ car: {}, history: [null] }, { car: {}, history: [null] }));
  assert.doesNotThrow(() => applyPhotoIds(null, { car: {} }));
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

/* The restore path replaces the live garage before it touches storage, so a
   backup that parses but cannot be restored must be rejected here, not throw
   halfway through. */
test('parseImport rejects a backup with no usable vehicle', () => {
  const wrap = garage => JSON.stringify(buildExport(garage, {}, '2026-08-16T00:00:00Z'));
  assert.strictEqual(parseImport(wrap({ vehicles: [], activeId: null })).ok, false);
  assert.strictEqual(parseImport(wrap({ vehicles: [{ id: 'v' }], activeId: 'v' })).ok, false);        // no data
  assert.strictEqual(parseImport(wrap({ vehicles: [{ data: { car: {} } }] })).ok, false);             // no id
  assert.strictEqual(parseImport(wrap({ vehicles: [null] })).ok, false);
  assert.strictEqual(parseImport(wrap({ vehicles: [{ id: 'v', data: 'nope' }] })).ok, false);
  assert.strictEqual(parseImport(wrap({ vehicles: [{ id: 'v', data: { car: {} } }], activeId: 'v' })).ok, true);
  assert.strictEqual(typeof parseImport(wrap({ vehicles: [] })).error, 'string');
});

/* Regression: Phase 2 dropped the v1 read entirely, so a user who had not
   opened the app since the single-car days booted into a blank seeded car and
   the first save wrote that seed over their garage slot. */
test('parseLegacyV1 recovers pre-garage single-car data', () => {
  const car = { car: { nickname: 'Mine', odometer: 90000 }, history: [{ id: 'h1' }] };
  assert.deepStrictEqual(parseLegacyV1(JSON.stringify(car)), car);
});

test('parseLegacyV1 returns null for absent, unparseable, or already-migrated data', () => {
  assert.strictEqual(parseLegacyV1(null), null);
  assert.strictEqual(parseLegacyV1(''), null);
  assert.strictEqual(parseLegacyV1('not json'), null);
  assert.strictEqual(parseLegacyV1('[]'), null);
  assert.strictEqual(parseLegacyV1('null'), null);
  // a v2 garage stored under the v1 key is not a single car — do not seed from it
  assert.strictEqual(parseLegacyV1(JSON.stringify({ vehicles: [], activeId: null })), null);
});

test('migrationPlan migrates only real legacy data, and never twice', () => {
  const legacy = { vehicles: [{ id: 'v', data: {} }], activeId: 'v' };
  assert.strictEqual(migrationPlan({}, legacy), 'migrate');
  assert.strictEqual(migrationPlan({ migratedAt: '2026-08-16T00:00:00Z' }, legacy), 'none');
});

/* Regression: migratedAt was only written when something was actually
   migrated, so a first run on IndexedDB stayed unstamped. A later file://
   session writes a seeded garage to the localStorage key, and the next visit
   would have imported that seed as "legacy" — phantom vehicle, stolen
   activeId. Stamping on an empty first run closes that door. */
test('migrationPlan stamps a first run that has nothing to migrate', () => {
  assert.strictEqual(migrationPlan({}, null), 'stamp');
  assert.strictEqual(migrationPlan(undefined, null), 'stamp');
  assert.strictEqual(migrationPlan({}, { vehicles: [] }), 'stamp');
  assert.strictEqual(migrationPlan({}, { vehicles: null }), 'stamp');
});

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

test('collectInlinePhotos returns {} for null/undefined and for a record with no photos', () => {
  assert.deepStrictEqual(collectInlinePhotos(null), {});
  assert.deepStrictEqual(collectInlinePhotos(undefined), {});
  assert.deepStrictEqual(collectInlinePhotos({ car: {}, history: [], spending: [] }), {});
});

test('collectInlinePhotos picks up only slots with both a photoId and a data: URL', () => {
  const data = {
    car: { photo: DATA_URL, photoId: 'p1' },
    history: [{ photo: '', photoId: 'p2' }, { photo: DATA_URL }],
    spending: [{ photo: DATA_URL, photoId: 'p3' }]
  };
  assert.deepStrictEqual(collectInlinePhotos(data), { p1: DATA_URL, p3: DATA_URL });
});

test('collectInlinePhotos ignores a blob: URL', () => {
  const data = { car: { photo: 'blob:http://x/abc', photoId: 'p1' } };
  assert.deepStrictEqual(collectInlinePhotos(data), {});
});

/* Fix 4: repeated imports re-hydrate through session.load() -> openStorage(),
   so every call after the first must close the connection it is replacing —
   a minimal fake here rather than fake-indexeddb (used in test/idb.test.js),
   since all that is needed is a trackable close(). */
function fakeIndexedDb() {
  return {
    open: () => {
      const req = {};
      const db = { objectStoreNames: { contains: () => true }, closed: false, close() { this.closed = true; } };
      setTimeout(() => { req.result = db; if (req.onsuccess) req.onsuccess(); }, 0);
      return req;
    }
  };
}

test('openStorage closes the previous IndexedDB connection when called again', async () => {
  const originalIndexedDB = global.indexedDB;
  global.indexedDB = fakeIndexedDb();
  try {
    const first = await openStorage({ protocol: 'https:', hasIndexedDb: true });
    assert.strictEqual(first.kind, 'idb');
    assert.strictEqual(first.db.closed, false);

    const second = await openStorage({ protocol: 'https:', hasIndexedDb: true });
    assert.strictEqual(second.kind, 'idb');
    assert.strictEqual(first.db.closed, true, 'the previous connection must be closed before being replaced');
    assert.notStrictEqual(second.db, first.db);
  } finally {
    if (originalIndexedDB === undefined) delete global.indexedDB; else global.indexedDB = originalIndexedDB;
  }
});

test('openStorage tolerates a close() that throws on the previous connection', async () => {
  const originalIndexedDB = global.indexedDB;
  global.indexedDB = fakeIndexedDb();
  try {
    const first = await openStorage({ protocol: 'https:', hasIndexedDb: true });
    first.db.close = () => { throw new Error('already closed'); };

    const second = await openStorage({ protocol: 'https:', hasIndexedDb: true });
    assert.strictEqual(second.kind, 'idb', 'a throwing close() must not break backend selection');
  } finally {
    if (originalIndexedDB === undefined) delete global.indexedDB; else global.indexedDB = originalIndexedDB;
  }
});

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

test('outboxAdd upserts on duplicate id, matching IndexedDB put() semantics', async () => {
  global.localStorage = (() => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } };
  })();
  delete require.cache[require.resolve('../storage.js')];
  const storage = require('../storage.js');
  await storage.openStorage({ protocol: 'http:', hasIndexedDb: false });

  await storage.outboxAdd({ id: 'o1', kind: 'vehicle', vehicleId: 'v1', data: { car: {} }, createdAt: '2026-08-22T00:00:00.000Z' });
  await storage.outboxAdd({ id: 'o1', kind: 'photo', photoId: 'p1', createdAt: '2026-08-22T00:00:01.000Z' });

  const all = await storage.outboxAll();
  assert.strictEqual(all.length, 1, 'adding a duplicate id must not create a second entry');
  assert.strictEqual(all[0].kind, 'photo', 'the second entry must overwrite the first one');
  assert.strictEqual(all[0].photoId, 'p1');
});
