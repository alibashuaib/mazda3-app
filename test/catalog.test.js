'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cat = require('../src/data/catalog.js');

test('CAR_MODELS entries all carry an id, a model and at least one engine', () => {
  assert.ok(cat.CAR_MODELS.length > 0);
  cat.CAR_MODELS.forEach(m => {
    assert.ok(m.id, 'model needs an id');
    assert.ok(m.model, `${m.id} needs a model name`);
    assert.ok(Array.isArray(m.engines) && m.engines.length, `${m.id} needs engines`);
    m.engines.forEach(([code, oilL]) => {
      assert.strictEqual(typeof code, 'string');
      assert.strictEqual(typeof oilL, 'number');
    });
  });
});

test('the default Mazda 3 BM is present, since seed() depends on it', () => {
  assert.ok(cat.CAR_MODELS.find(m => m.id === 'mazda3bm'));
});

test('skyactivServices threads the oil capacity through and gives every service an interval', () => {
  const svc = cat.skyactivServices(4.2);
  assert.ok(svc.length > 0);
  svc.forEach(s => {
    assert.ok(s.name, 'service needs a name');
    assert.ok(s.intervalKm > 0, `${s.name} needs intervalKm`);
    assert.ok(s.intervalMonths > 0, `${s.name} needs intervalMonths`);
  });
});

/* uid() is called at build time, so two calls must not hand out the same ids —
   the app keys records by them. */
test('part builders produce fresh ids on every call', () => {
  const a = cat.mazda3Parts(), b = cat.mazda3Parts();
  assert.strictEqual(a.length, b.length);
  assert.notStrictEqual(a[0].id, b[0].id);
});

test('sharedParts is the generic fallback and is non-empty', () => {
  const p = cat.sharedParts();
  assert.ok(p.length > 0);
  p.forEach(x => assert.ok(x.name && Array.isArray(x.options)));
});

test('the three single-part builders return a named part with options', () => {
  [cat.atfFilterPart(), cat.atfSealantPart(), cat.fuelSystemCleanerPart()].forEach(p => {
    assert.ok(p.id && p.name);
    assert.ok(Array.isArray(p.options) && p.options.length);
  });
});

test('NORMAL_SCHED entries are [km, months] pairs', () => {
  Object.entries(cat.NORMAL_SCHED).forEach(([name, pair]) => {
    assert.ok(Array.isArray(pair) && pair.length === 2, `${name} must be a pair`);
    assert.strictEqual(typeof pair[0], 'number');
    assert.strictEqual(typeof pair[1], 'number');
  });
});
