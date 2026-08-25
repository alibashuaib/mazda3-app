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
