'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cat = require('../src/data/catalog.js');

const ROW = { id: 'cx70x:3.3l-turbo', model: 'CX-70', generation: '2025', engine: '3.3L Turbo', oil_capacity_l: 6.2, paints: [], markets: ['KSA'] };

test('registerModels appends a new model, idempotently, without moving indices', () => {
  const before = cat.CAR_MODELS.map(m => m.id);
  cat.registerModels([ROW]);
  cat.registerModels([ROW]);
  const n = cat.CAR_MODELS.length;
  assert.strictEqual(n, before.length + 1);
  assert.deepStrictEqual(cat.CAR_MODELS.slice(0, before.length).map(m => m.id), before);
  assert.deepStrictEqual(cat.CAR_MODELS[n - 1], { id: 'cx70x', markets: ['KSA'], model: 'CX-70', gen: '2025', engines: [['3.3L Turbo', 6.2]], colors: [cat.DEFAULT_COLOR] });
  assert.ok(cat.modelsForMarket('KSA').some(m => m.id === 'cx70x'));
});

test('registerModels adds a new engine to a registered model, ignores static ids', () => {
  cat.registerModels([ROW, Object.assign({}, ROW, { id: 'cx70x:2.5l', engine: '2.5L', oil_capacity_l: 4.5 })]);
  assert.strictEqual(cat.CAR_MODELS.find(m => m.id === 'cx70x').engines.length, 2);
  const engines = cat.CAR_MODELS.find(m => m.id === 'cx5kf').engines.length;
  cat.registerModels([ROW, { id: 'cx5kf:2.5l', model: 'CX-5', generation: 'KF', engine: 'Extra', markets: [] }]);
  assert.strictEqual(cat.CAR_MODELS.filter(m => m.id === 'cx70x').length, 1);
  assert.strictEqual(cat.CAR_MODELS.find(m => m.id === 'cx5kf').engines.length, engines);
});

test('isRegisteredModel is true only for server-added models', () => {
  cat.registerModels([ROW]);
  assert.strictEqual(cat.isRegisteredModel('cx70x'), true);
  assert.strictEqual(cat.isRegisteredModel('cx5kf'), false);
});

test('registerModels rebuilds: a model the server dropped disappears; unknown oil is null, not 0 (WR-08)', () => {
  const static_ = cat.CAR_MODELS.filter(m => !cat.isRegisteredModel(m.id)).map(m => m.id);
  cat.registerModels([ROW, { id: 'zz9:2.0l', model: 'ZZ', generation: 'g', engine: '2.0L', markets: ['KSA'] }]);
  assert.strictEqual(cat.engineInfo('zz9', '2.0L').oilL, null);
  assert.ok(!/null|~0/.test(cat.engineOilNote(cat.engineInfo('zz9', '2.0L').oilL, 'gasoline')));
  assert.deepStrictEqual(cat.CAR_MODELS[cat.CAR_MODELS.length - 1].engines, [['2.0L', null]]);
  cat.registerModels([ROW]);
  assert.strictEqual(cat.isRegisteredModel('zz9'), false);
  assert.ok(!cat.CAR_MODELS.some(m => m.id === 'zz9'));
  assert.deepStrictEqual(cat.CAR_MODELS.slice(0, static_.length).map(m => m.id), static_);
  cat.registerModels([]);
  assert.strictEqual(cat.isRegisteredModel('cx70x'), false);
});
