'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cat = require('../src/data/catalog.js');
const { partRows, seedSql } = require('../tools/seed-parts.js');

test('rows cover every car and use valid slots, unique per car + part + slot', () => {
  const rows = partRows();
  const ids = new Set(rows.map(r => r.car_model_id));
  assert.strictEqual(ids.size, cat.CAR_MODELS.reduce((n, m) => n + m.engines.length, 0));
  const keys = new Set();
  for (const r of rows) {
    assert.match(r.slot, /^(oem|alt:[a-z0-9-]{1,40})$/, r.slot);
    assert.ok(!r.part_name.includes('|'), r.part_name);
    const k = r.car_model_id + '|' + r.part_name + '|' + r.slot;
    assert.ok(!keys.has(k), 'duplicate ' + k);
    keys.add(k);
    assert.ok(r.price === null || (r.price > 0 && r.price < 100000), k);
  }
});

test('OEM option -> slot oem; dealer-list price -> basis dealer, all others static', () => {
  const rows = partRows();
  assert.ok(rows.some(r => r.slot === 'oem' && r.price_basis === 'dealer'));
  assert.ok(rows.every(r => r.price_basis === 'static' || (r.price_basis === 'dealer' && r.slot === 'oem')));
  const oil = rows.find(r => r.part_name === 'Oil Filter' && r.slot.startsWith('alt:'));
  assert.strictEqual(oil.slot, 'alt:denso-150-2010');
});

test('the committed seed file is up to date with catalog.js', () => {
  const committed = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'seed-parts.sql'), 'utf8');
  assert.strictEqual(committed, seedSql(partRows()), 'run: node tools/seed-parts.js');
});

test('seedSql refuses data containing its own quote tag', () => {
  assert.throws(() => seedSql([{ note: '$seed$' }]), /quote tag/);
});
