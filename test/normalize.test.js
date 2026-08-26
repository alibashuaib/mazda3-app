'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeData, buildProfile, seed } = require('../src/data/normalize.js');

test('buildProfile assembles a complete vehicle from the catalogue', () => {
  const v = buildProfile('mazda3bm', 0, { odometer: 316000, year: 2016 });
  assert.strictEqual(v.car.make, 'Mazda');
  assert.strictEqual(v.car.odometer, 316000);
  assert.strictEqual(v.car.year, 2016);
  assert.ok(v.services.length > 0);
  assert.ok(v.parts.length > 0);
  assert.deepStrictEqual(v.history, []);
  assert.deepStrictEqual(v.fuel, []);
});

test('buildProfile baselines every service at the current odometer', () => {
  const v = buildProfile('mazda3bm', 0, { odometer: 200000 });
  v.services.forEach(s => {
    assert.strictEqual(s.lastKm, 200000, `${s.name} must start from the odometer`);
    assert.ok(s.lastDate, `${s.name} needs a lastDate`);
  });
});

test('buildProfile rejects an unknown model instead of silently using Mazda 3 BM', () => {
  assert.throws(() => buildProfile('no-such-model', 0, {}), /Unknown Mazda model/);
});

test('normalizeData keeps an unknown model unknown instead of silently using Mazda 3 BM', () => {
  const s = normalizeData({ car: { model: 'RX-8', color: 'Velocity Red Mica' } });
  assert.strictEqual(s.car.modelId, '');
  assert.strictEqual(s.car.model, 'RX-8');
  assert.strictEqual(s.car.color, 'Velocity Red Mica');
});

test('buildProfile accepts only colors available for the selected generation', () => {
  const valid = buildProfile('cx70', 0, { color: 'Melting Copper Metallic (Code 52H)' });
  const invalid = buildProfile('cx70', 0, { color: 'Ingot Blue Metallic (Code 48B)' });
  assert.strictEqual(valid.car.color, 'Melting Copper Metallic (Code 52H)');
  assert.strictEqual(invalid.car.color, 'Melting Copper Metallic (Code 52H)');
});

test('normalizeData replaces a legacy color unavailable on that generation', () => {
  const s = normalizeData({ car: { modelId: 'cx50', model: 'CX-50', color: 'Meteor Gray Mica (Code 42A)' } });
  assert.strictEqual(s.car.color, 'Machine Gray Metallic (Code 46G)');
});

test('normalizeData removes incompatible explicitly-fitted parts', () => {
  const s = normalizeData({
    car: { modelId: 'cx90', model: 'CX-90', engine: '3.3L Turbo e-SkyActiv-G' },
    parts: [{ name: 'BM Oil Filter', cat: 'Engine', options: [], fitment: { shareable: false, modelIds: ['mazda3bm'] } }]
  });
  assert.ok(!s.parts.some(p => p.name === 'BM Oil Filter'));
  assert.ok(!s.parts.some(p => p.name === 'ATF FZ (per liter)'));
  assert.ok(!s.parts.some(p => p.name === 'Transmission Fluid Filter'));
});

test('buildProfile locks a tires part to the exact model, in that model\'s OEM size', () => {
  const bm = buildProfile('mazda3bm', 0, {});
  const cx90 = buildProfile('cx90', 0, {});
  const bmTires = bm.parts.find(p => p.cat === 'Tires');
  const cx90Tires = cx90.parts.find(p => p.cat === 'Tires');
  assert.ok(bmTires, 'mazda3bm must have a tires part');
  assert.ok(cx90Tires, 'cx90 must have a tires part');
  assert.notStrictEqual(bmTires.name, cx90Tires.name, 'a sedan and a full-size SUV must not share a tire size');
  assert.deepStrictEqual(bmTires.fitment.modelIds, ['mazda3bm']);
  assert.deepStrictEqual(cx90Tires.fitment.modelIds, ['cx90']);
});

test('normalizeData backfills a tires part onto a vehicle saved before this feature existed', () => {
  const s = normalizeData({ car: { modelId: 'cx5kf', model: 'CX-5', year: 2020 }, parts: [] });
  const tires = s.parts.filter(p => p.cat === 'Tires');
  assert.strictEqual(tires.length, 1);
  assert.deepStrictEqual(tires[0].fitment.modelIds, ['cx5kf']);
});

test('normalizeData swaps the tires part when the car is changed to a different model', () => {
  const s = normalizeData({
    car: { modelId: 'cx90', model: 'CX-90', engine: '3.3L Turbo e-SkyActiv-G' },
    parts: [{ id: 'old', name: 'Tires (205/60R16)', cat: 'Tires', options: [], fitment: { shareable: false, modelIds: ['mazda3bm'] } }]
  });
  const tires = s.parts.filter(p => p.cat === 'Tires');
  assert.strictEqual(tires.length, 1, 'the stale BM-sized tire must be dropped, not kept alongside the new one');
  assert.deepStrictEqual(tires[0].fitment.modelIds, ['cx90']);
});

test('normalizeData backfills the sharedParts starter set onto a vehicle saved while it was broken', () => {
  // Simulates a non-BM vehicle saved back when sharedParts() dropped 10 of
  // its 14 parts — only what survived that bug is present on disk.
  const s = normalizeData({
    car: { modelId: 'cx90', model: 'CX-90', engine: '3.3L Turbo e-SkyActiv-G' },
    parts: [
      { name: 'Brake Fluid (DOT 4)', cat: 'Brakes', options: [{ tag: 'OEM', brand: 'x', price: 1 }], fitment: { shareable: true, modelIds: [] } },
      { name: 'Coolant FL22 (long-life)', cat: 'Engine', options: [{ tag: 'OEM', brand: 'x', price: 1 }], fitment: { shareable: true, modelIds: [] } }
    ]
  });
  ['Engine Oil 5W-30 (4L)', 'Oil Filter', 'Front Brake Pads', 'Rear Brake Pads', '12V Battery'].forEach(name => {
    assert.ok(s.parts.some(p => p.name === name), `${name} was not backfilled`);
  });
  assert.strictEqual(s.parts.filter(p => p.name === 'Brake Fluid (DOT 4)').length, 1, 'must not duplicate a part already present');
  assert.ok(!s.parts.some(p => p.name === 'ATF FZ (per liter)'), 'cx90 must still not get ATF-FZ from the backfill');
});

test('normalizeData never layers sharedParts on top of the BM\'s own catalogue', () => {
  // A real BM vehicle already carries mazda3Parts()'s Oil Filter (a real BM
  // part number). Re-normalizing must not also inject sharedParts()'s
  // generic placeholder version alongside it.
  const s = normalizeData(buildProfile('mazda3bm', 0, {}));
  assert.strictEqual(s.parts.filter(p => p.name === 'Oil Filter').length, 1);
});

test('normalizeData preserves shareable consumables across models', () => {
  const s = normalizeData({
    car: { modelId: 'cx90', model: 'CX-90', engine: '3.3L Turbo e-SkyActiv-G' },
    parts: [{ name: 'Brake Fluid (DOT 4)', cat: 'Brakes', options: [], fitment: { shareable: true, modelIds: [] } }]
  });
  assert.ok(s.parts.some(p => p.name === 'Brake Fluid (DOT 4)'));
});

test('buildProfile selects the part catalog for the requested model', () => {
  assert.ok(buildProfile('cx5kf', 0, {}).parts.some(p => p.name === 'ATF FZ (per liter)'));
  assert.ok(!buildProfile('cx90', 0, {}).parts.some(p => p.name === 'ATF FZ (per liter)'));
});

test('seed is the owner 2016 Mazda 3 at 316,000 km', () => {
  const v = seed();
  assert.strictEqual(v.car.odometer, 316000);
  assert.strictEqual(v.car.year, 2016);
});

test('normalizeData infers generation-specific CX models from model and year', () => {
  assert.strictEqual(normalizeData({ car: { model: 'CX-9', year: 2012 } }).car.modelId, 'cx9tb');
  assert.strictEqual(normalizeData({ car: { model: 'CX-9', year: 2019 } }).car.modelId, 'cx9');
  assert.strictEqual(normalizeData({ car: { model: 'CX-5', year: 2026 } }).car.modelId, 'cx5gen3');
  assert.strictEqual(normalizeData({ car: { model: 'CX-90', year: 2025 } }).car.modelId, 'cx90');
});

/* Regression for the boot crash fixed in 0ca1bb9: renderDashboard and
   renderBudget read state.budget.annual unguarded, and only seed() ever set
   it, so a legacy or imported record took the whole app down. */
test('normalizeData defaults a missing or malformed budget', () => {
  assert.strictEqual(normalizeData({ car: {} }).budget.annual, 6000);
  assert.strictEqual(normalizeData({ car: {}, budget: 'nope' }).budget.annual, 6000);
  assert.strictEqual(normalizeData({ car: {}, budget: { annual: NaN } }).budget.annual, 6000);
  assert.strictEqual(normalizeData({ car: {}, budget: { annual: 9000 } }).budget.annual, 9000);
});

test('normalizeData fills every missing array', () => {
  const s = normalizeData({ car: {} });
  ['services', 'parts', 'history', 'spending', 'fuel', 'docs'].forEach(k => {
    assert.ok(Array.isArray(s[k]), `${k} must be an array`);
  });
});

test('normalizeData defaults severity to severe and planSetupDone to false', () => {
  const s = normalizeData({ car: {} });
  assert.strictEqual(s.severity, 'severe');
  assert.strictEqual(s.planSetupDone, false);
  assert.strictEqual(normalizeData({ car: {}, severity: 'normal' }).severity, 'normal');
  assert.strictEqual(normalizeData({ car: {}, severity: 'junk' }).severity, 'severe');
});

test('normalizeData retires the standalone Fuel System Cleaner into the oil change', () => {
  const s = normalizeData({
    car: {},
    services: [
      { name: 'Engine Oil & Filter', intervalKm: 7500, intervalMonths: 6, cost: 200, lastKm: 0, lastDate: '2026-01-01' },
      { name: 'Fuel System Cleaner', intervalKm: 7500, intervalMonths: 6, cost: 45, lastKm: 0, lastDate: '2026-01-01' }
    ]
  });
  assert.ok(!s.services.find(x => x.name === 'Fuel System Cleaner'), 'standalone must be removed');
  assert.strictEqual(s.services.find(x => x.name === 'Engine Oil & Filter').cost, 245);
});

test('normalizeData is idempotent — the migrations must not fire twice', () => {
  const once = normalizeData({
    car: {},
    services: [{ name: 'Engine Oil & Filter', intervalKm: 7500, intervalMonths: 6, cost: 200, lastKm: 0, lastDate: '2026-01-01' }]
  });
  const oilAfterOnce = once.services.find(x => x.name === 'Engine Oil & Filter').cost;
  const partsAfterOnce = once.parts.length;
  const twice = normalizeData(once);
  assert.strictEqual(twice.services.find(x => x.name === 'Engine Oil & Filter').cost, oilAfterOnce);
  assert.strictEqual(twice.parts.length, partsAfterOnce);
});

test('normalizeData seeds dealer normal intervals where they differ', () => {
  const s = normalizeData({
    car: {},
    services: [{ name: 'Engine Oil & Filter', intervalKm: 7500, intervalMonths: 6, lastKm: 0, lastDate: '2026-01-01' }]
  });
  const oil = s.services.find(x => x.name === 'Engine Oil & Filter');
  assert.strictEqual(oil.normalKm, 10000);
  assert.strictEqual(oil.normalMonths, 12);
});
