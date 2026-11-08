'use strict';
const test = require('node:test');
const assert = require('node:assert');
const rc = require('../src/data/remote-catalog.js');

const ID = 'cx5kf:2.5l';
const MODELS = [{ id: ID, model: 'CX-5', generation: 'KF', engine: '2.5L', plan_updated_at: '2026-10-01T00:00:00+00:00', parts_updated_at: '2026-11-01T00:00:00+00:00' }];
const PARTS = [
  { car_model_id: ID, part_name: 'Oil Filter', slot: 'oem', brand: 'Mazda Genuine', part_no: 'NEW-1', price: 30, price_basis: 'indicative', note: 'n' },
  { car_model_id: ID, part_name: 'Oil Filter', slot: 'alt:bosch', brand: 'Bosch', part_no: 'B1', price: 20, price_basis: 'dealer', note: '' },
  { car_model_id: 'cx5kf:2.0l', part_name: 'Oil Filter', slot: 'oem', brand: 'Other', part_no: 'X', price: 99, price_basis: 'dealer', note: '' }
];

function client(parts) {
  return { from: table => ({ select: () => {
    const rows = table === 'car_models' ? MODELS : table === 'catalogue_parts' ? parts : [];
    const res = Promise.resolve({ data: rows, error: null });
    res.eq = () => res; res.order = () => res;
    res.range = (a, b) => Promise.resolve({ data: rows.slice(a, b + 1), error: null });
    return res;
  } }) };
}
const data = (oemPrice, catPrice) => ({ car: { catalogId: ID }, parts: [{ name: 'Oil Filter', options: [{ tag: 'OEM', brand: 'Mazda Genuine', partNo: 'OLD', price: oemPrice, catPrice, store: '' }] }] });

test.beforeEach(() => rc.reset());

test('refresh caches parts; parts() is per car; loaded() flips', async () => {
  assert.strictEqual(rc.loaded(), false);
  rc.configure({ client: client(PARTS) });
  assert.strictEqual(await rc.refresh(), true);
  assert.strictEqual(rc.loaded(), true);
  assert.strictEqual(rc.parts(ID).length, 2);
});

test('load accepts an old cache without parts', async () => {
  rc.configure({ metaGet: () => Promise.resolve({ catalogue: { models: MODELS, items: [] } }) });
  assert.strictEqual(await rc.load(), true);
  assert.deepStrictEqual(rc.parts(ID), []);
});

test('applyParts updates an unowned OEM, adds ALT, keeps owner price, never crosses engines', async () => {
  rc.configure({ client: client(PARTS) }); await rc.refresh();
  const d = data(10, 10);
  assert.strictEqual(rc.applyParts(d), 'changed');
  const [oem, alt] = d.parts[0].options;
  assert.deepStrictEqual([oem.partNo, oem.price, oem.catPrice, oem.indicative], ['NEW-1', 30, 30, true]);
  assert.deepStrictEqual([alt.tag, alt.brand, alt.price, alt.indicative], ['ALT', 'Bosch', 20, false]);
  assert.strictEqual(rc.applyParts(d), false);   // same version

  const owned = data(12, 10);
  rc.applyParts(owned);
  assert.deepStrictEqual([owned.parts[0].options[0].partNo, owned.parts[0].options[0].price], ['OLD', 12]);
  assert.strictEqual(owned.parts[0].options.length, 2);   // ALT still added, nothing deleted

  const nocat = data(10, undefined);
  rc.applyParts(nocat);
  assert.strictEqual(nocat.parts[0].options[0].partNo, 'OLD');

  const other = data(10, 10); other.car.catalogId = 'cx5kf:2.0l';
  assert.strictEqual(rc.applyParts(other), false);
});

test('applyParts: stale version is false, force applies, nothing to change stamps', async () => {
  rc.configure({ client: client(PARTS) }); await rc.refresh();
  const d = data(10, 10); d.car.partsVersion = '2026-12-01T00:00:00+00:00';
  assert.strictEqual(rc.applyParts(d), false);
  assert.strictEqual(rc.applyParts(d, { force: true }), 'changed');
  const e = { car: { catalogId: ID }, parts: [] };
  assert.strictEqual(rc.applyParts(e), 'stamped');
});
