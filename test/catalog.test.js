'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cat = require('../src/data/catalog.js');

test('CAR_MODELS entries all carry an id, a model, engines and factory colors', () => {
  assert.ok(cat.CAR_MODELS.length > 0);
  cat.CAR_MODELS.forEach(m => {
    assert.ok(m.id, 'model needs an id');
    assert.ok(m.model, `${m.id} needs a model name`);
    assert.ok(Array.isArray(m.engines) && m.engines.length, `${m.id} needs engines`);
    assert.ok(Array.isArray(m.colors) && m.colors.length, `${m.id} needs factory colors`);
    m.colors.forEach(color => {
      assert.ok(cat.MAZDA_PAINTS[color], `${m.id} color needs a swatch: ${color}`);
    });
    m.engines.forEach(([code, oilL]) => {
      assert.strictEqual(typeof code, 'string');
      assert.strictEqual(typeof oilL, 'number');
    });
  });
});

test('the default Mazda 3 BM is present, since seed() depends on it', () => {
  assert.ok(cat.CAR_MODELS.find(m => m.id === 'mazda3bm'));
});

test('the expanded lineup keeps distinct old and new SUV generations', () => {
  ['cx9tb', 'cx9', 'cx50', 'cx60', 'cx70', 'cx80', 'cx90', 'cx5gen3'].forEach(id => {
    assert.ok(cat.CAR_MODELS.find(m => m.id === id), `${id} must be selectable`);
  });
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

/* A trailing filter once threw away everything from this list except the 3
   universal fluids (+ATF FZ where it applies) — `p.length > 0` alone can't
   catch that (cx90's 4 leftover parts still satisfy it), so this pins the
   full starter set by name for every consumable a "verify for your model"
   part is meant to cover, on both an ATF-FZ model and a large-platform one
   that must NOT have it. */
test('sharedParts is the generic fallback and carries the full starter set, on every model', () => {
  const base = [
    'Engine Oil 5W-30 (4L)', 'Oil Filter', 'Fuel System Cleaner (additive)',
    'Engine Air Filter', 'Cabin A/C Filter', 'Spark Plugs (each)',
    'Front Brake Pads', 'Rear Brake Pads', 'Brake Fluid (DOT 4)',
    'Coolant FL22 (long-life)', 'Serpentine Belt', '12V Battery',
    'Wiper Blades (pair)', 'Windshield Washer Fluid (~2L)'
  ];
  // cx5kf uses ATF-FZ; cx90 (large-platform) must NOT get it — see the
  // adjacent ATF-FZ test.
  const expectedFor = { cx5kf: [...base, 'ATF FZ (per liter)'], cx90: base };
  Object.entries(expectedFor).forEach(([modelId, expected]) => {
    const p = cat.sharedParts(modelId);
    const names = p.map(x => x.name);
    assert.deepStrictEqual(names.sort(), [...expected].sort(), `${modelId} is missing part(s) of the starter set`);
    p.forEach(x => {
      assert.ok(Array.isArray(x.options) && x.options.length, `${x.name} needs at least one option`);
      assert.ok(cat.partFitsCar(x, { modelId }), `${x.name} must fit ${modelId}`);
    });
  });
});

test('parts are model-locked unless explicitly shareable', () => {
  const bm = cat.mazda3Parts();
  const filter = bm.find(p => p.name === 'Oil Filter');
  const brakeFluid = bm.find(p => p.name === 'Brake Fluid (DOT 4)');
  assert.ok(cat.partFitsCar(filter, { modelId: 'mazda3bm' }));
  assert.ok(!cat.partFitsCar(filter, { modelId: 'cx90' }));
  assert.ok(cat.partFitsCar(brakeFluid, { modelId: 'cx90' }));
});

test('ATF-FZ is excluded from Mazda large-platform parts', () => {
  assert.ok(cat.sharedParts('cx5kf').some(p => p.name === 'ATF FZ (per liter)'));
  assert.ok(!cat.sharedParts('cx90').some(p => p.name === 'ATF FZ (per liter)'));
});

test('the three single-part builders return a named part with options', () => {
  [cat.atfFilterPart(), cat.atfSealantPart(), cat.fuelSystemCleanerPart()].forEach(p => {
    assert.ok(p.id && p.name);
    assert.ok(Array.isArray(p.options) && p.options.length);
  });
});

/* Tires are the one part where the wrong size does not just under-perform —
   it may not safely fit — so every model must resolve to a real size, and
   the part must be locked to that exact model (never shareable). */
test('every model has an OEM tire size, and tiresPart locks to that model only', () => {
  cat.CAR_MODELS.forEach(m => {
    const size = cat.OEM_TIRE_SIZE[m.id];
    assert.ok(size && /^\d{3}\/\d{2}R\d{2}$/.test(size), `${m.id} needs a valid tire size, got ${JSON.stringify(size)}`);

    const part = cat.tiresPart(m.id);
    assert.ok(part.name.includes(size), 'the part name must carry the locked size');
    assert.strictEqual(part.cat, 'Tires');
    assert.ok(cat.partFitsCar(part, { modelId: m.id }), 'must fit its own model');
    assert.ok(!part.fitment.shareable, 'a tire size must never be shared across models');
    cat.CAR_MODELS.filter(o => o.id !== m.id).forEach(other => {
      assert.ok(!cat.partFitsCar(part, { modelId: other.id }), `${m.id}'s tires must not fit ${other.id}`);
    });

    assert.ok(part.options.length >= 2, `${m.id} needs OEM + at least one alternative`);
    part.options.forEach(o => assert.strictEqual(o.partNo, size, 'every option must carry the same locked size'));
  });
});

test('partsForModel always includes a tires part locked to that model', () => {
  ['mazda3bm', 'cx5kf', 'cx90'].forEach(id => {
    const tires = cat.partsForModel(id).filter(p => p.cat === 'Tires');
    assert.strictEqual(tires.length, 1, `${id} must have exactly one tires part`);
    assert.strictEqual(tires[0].fitment.modelIds[0], id);
  });
});

test('NORMAL_SCHED entries are [km, months] pairs', () => {
  Object.entries(cat.NORMAL_SCHED).forEach(([name, pair]) => {
    assert.ok(Array.isArray(pair) && pair.length === 2, `${name} must be a pair`);
    assert.strictEqual(typeof pair[0], 'number');
    assert.strictEqual(typeof pair[1], 'number');
  });
});
