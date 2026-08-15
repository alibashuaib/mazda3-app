'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { shouldTryIndexedDb, splitPhotos, inlinePhotos, buildExport, parseImport } = require('../storage.js');
const { parseLegacyV1, migrationPlan, applyPhotoIds } = require('../storage.js');
const { dataUrlToBlob, blobToDataUrl } = require('../storage.js');
const { collectInlinePhotos } = require('../storage.js');

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
