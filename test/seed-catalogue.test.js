'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cat = require('../src/data/catalog.js');
const { catalogueRows, seedSql } = require('../tools/seed-catalogue.js');

test('one approved car_models row per model and engine', () => {
  const { models } = catalogueRows();
  const expected = cat.CAR_MODELS.reduce((n, m) => n + m.engines.length, 0);
  assert.strictEqual(models.length, expected);
  assert.ok(models.every(m => m.status === 'approved'));
});

test('every car has a dealer plan with usable intervals', () => {
  const { models, items } = catalogueRows();
  for (const m of models) {
    const mine = items.filter(i => i.car_model_id === m.id);
    assert.ok(mine.length > 5, `${m.id} has no plan`);
    assert.ok(mine.every(i => i.interval_km > 0 && i.interval_months > 0), `${m.id} has an empty interval`);
  }
});

test('dealer intervals use the dealer sheet where it has one', () => {
  const { items } = catalogueRows();
  const oil = items.find(i => i.service === 'Engine Oil & Filter');
  assert.deepStrictEqual([oil.interval_km, oil.interval_months], cat.NORMAL_SCHED['Engine Oil & Filter']);
});

test('the committed seed file is up to date with catalog.js', () => {
  const committed = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'seed-catalogue.sql'), 'utf8');
  assert.strictEqual(committed, seedSql(catalogueRows()),
    'run: node tools/seed-catalogue.js');
});

test('seedSql refuses data containing its own quote tag', () => {
  assert.throws(() => seedSql({ models: [{ id: '$seed$' }], items: [] }), /quote tag/);
});
