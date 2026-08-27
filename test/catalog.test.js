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
    'Engine Oil 5W-30', 'Oil Filter', 'Fuel System Cleaner (additive)',
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

/* skyactivServices() used to give every model an identical 'Spark Plugs
   (x4)', regardless of cylinder count or fuel — wrong for the CX-9 TB's V6
   and the CX-60/70/80/90's inline-six (both 6 plugs, not 4), and outright
   inapplicable for the CX-60/80's diesel option (compression ignition has
   no spark plugs, and needs a DPF-safe low-SAPS oil, not the gasoline
   5W-30 spec whose note also wrongly claimed a "mandatory" DI fuel-system
   cleaner the diesel doesn't use). */
test('engineInfo reports real cylinder counts and fuel type for every non-default engine', () => {
  const cases = [
    ['cx9tb', '3.5L MZI V6', 6, 'gasoline'],
    ['cx9tb', '3.7L MZI V6', 6, 'gasoline'],
    ['cx60', '2.5L e-SkyActiv-G PHEV', 4, 'gasoline'],
    ['cx60', '3.3L e-SkyActiv-G', 6, 'gasoline'],
    ['cx60', '3.3L e-SkyActiv-D', 6, 'diesel'],
    ['cx70', '3.3L Turbo e-SkyActiv-G', 6, 'gasoline'],
    ['cx80', '3.3L e-SkyActiv-D', 6, 'diesel'],
    ['cx90', '3.3L Turbo e-SkyActiv-G', 6, 'gasoline'],
    ['mazda3bm', '2.0L SkyActiv-G', 4, 'gasoline']
  ];
  cases.forEach(([modelId, code, cylinders, fuel]) => {
    const meta = cat.engineInfo(modelId, code);
    assert.strictEqual(meta.cylinders, cylinders, `${modelId} ${code} cylinders`);
    assert.strictEqual(meta.fuel, fuel, `${modelId} ${code} fuel`);
  });
});

test('skyactivServices gives a 6-cylinder engine 6 spark plugs at a scaled cost, and a 4-cylinder one 4', () => {
  const six = cat.skyactivServices(5.1, { cylinders: 6, fuel: 'gasoline' });
  const four = cat.skyactivServices(4.2, { cylinders: 4, fuel: 'gasoline' });
  const p6 = six.find(s => /^Spark Plugs/.test(s.name));
  const p4 = four.find(s => /^Spark Plugs/.test(s.name));
  assert.strictEqual(p6.name, 'Spark Plugs (x6)');
  assert.strictEqual(p4.name, 'Spark Plugs (x4)');
  assert.ok(p6.cost > p4.cost, '6 plugs must cost more than 4');
});

test('skyactivServices omits spark plugs entirely for a diesel engine, and uses the diesel oil spec', () => {
  const diesel = cat.skyactivServices(5.1, { cylinders: 6, fuel: 'diesel' });
  assert.ok(!diesel.some(s => /^Spark Plugs/.test(s.name)), 'a diesel has no spark plugs');
  const oil = diesel.find(s => s.name === 'Engine Oil & Filter');
  assert.ok(/low-SAPS/.test(oil.note), 'diesel oil must be DPF-safe low-SAPS, not the gasoline spec');
  assert.ok(!/mandatory/i.test(oil.note), 'must not claim the gasoline DI fuel-system-cleaner requirement');
});

/* The Engine Oil PART (what you'd actually buy) used to say a flat "(4L)"
   for every model, regardless of the engine actually fitted — real
   capacity ranges 3.6-5.4 L across the lineup, already verified in
   CAR_MODELS' own oilL. The name stays the stable literal every part
   builder used before (SERVICE_PARTS/CRIT_HIGH in parts.js match by exact
   name); the capacity and the price now vary in the note/price instead. */
test('engineOilPart carries the real capacity in its note and scales price with it', () => {
  const small = cat.engineOilPart('mazda2', 3.6);
  const large = cat.engineOilPart('cx9', 5.4);
  assert.strictEqual(small.name, 'Engine Oil 5W-30', 'name must stay the stable literal for cross-linking');
  assert.ok(/~3\.6 L/.test(small.options[0].note), 'the OEM option must show the real 3.6 L capacity');
  assert.ok(/~5\.4 L/.test(large.options[0].note));
  assert.ok(large.options[0].price > small.options[0].price, 'more oil must cost more');
  assert.ok(cat.partFitsCar(small, { modelId: 'mazda2' }));
  assert.ok(!cat.partFitsCar(small, { modelId: 'cx9' }), 'locked per model, like every other non-universal consumable');
});

/* Coolant genuinely varies almost as much as oil (6.0 L for the 1.5L up to
   an estimated 11.4 L for the CX-9 TB's V6) — it used to be marked
   universal/shareable with one flat "~6.6L" note for every model. Some
   engines (CX-60/70/80/90's inline-six) have no published Mazda capacities
   table; those must read as an estimate, not presented as verified fact. */
test('coolantLitersFor distinguishes a sourced capacity from an estimate', () => {
  assert.deepStrictEqual(cat.coolantLitersFor('mazda2', '1.5L SkyActiv-G'), { liters: 6.0, verified: true });
  assert.deepStrictEqual(cat.coolantLitersFor('cx9', '2.5L Turbo SkyActiv-G'), { liters: 9.8, verified: true });
  const six = cat.coolantLitersFor('cx90', '3.3L Turbo e-SkyActiv-G');
  assert.strictEqual(six.verified, false, 'no published table exists for this engine — must not claim otherwise');
});

test('coolantPart is locked per model (not shareable) and its note matches verified vs. estimated', () => {
  const verified = cat.coolantPart('mazda2', '1.5L SkyActiv-G');
  const estimated = cat.coolantPart('cx90', '3.3L Turbo e-SkyActiv-G');
  assert.strictEqual(verified.name, 'Coolant FL22 (long-life)', 'name must stay the stable literal for cross-linking');
  assert.ok(!verified.fitment.shareable, 'coolant capacity is car-specific now, like tires — must not be shareable across a garage');
  assert.ok(/capacities table/.test(verified.options[0].note));
  assert.ok(/estimated/.test(estimated.options[0].note) && /no published capacity table/.test(estimated.options[0].note));
});

/* ATF-FZ had two different, contradicting drain quantities depending on
   which builder created the part: mazda3Parts' own said "~3.5 L per drain,
   7.8 L total", sharedParts' said "~4.5-4.7 L per drain". Every ATF-FZ
   model shares one 6-speed SkyActiv-Drive transmission (sourced from
   multiple independent parts suppliers), so this must read identically
   everywhere — the BM was the one that had it wrong. */
test('ATF FZ states the same drain quantity for the BM and every other ATF-FZ model', () => {
  const bm = cat.mazda3Parts('2.0L SkyActiv-G').find(p => p.name === 'ATF FZ (per liter)');
  const cx5kf = cat.sharedParts('cx5kf', '2.5L SkyActiv-G').find(p => p.name === 'ATF FZ (per liter)');
  assert.strictEqual(bm.options[0].note, cx5kf.options[0].note);
  assert.ok(/4\.5 L per drain/.test(bm.options[0].note));
});

/* The 12V Battery had the same flavour of bug as oil and coolant: BM's own
   copy said a flat "55Ah" (not quite matching Mazda's own 60-65Ah spec for
   this engine); every other model's said no Ah figure at all. Name stays
   the stable literal (used elsewhere? not cross-linked today, but kept
   consistent with the oil/coolant pattern regardless). */
test('battery12VPart carries a real Ah rating and JIS code, and flags an estimate honestly', () => {
  const bm = cat.battery12VPart('mazda3bm', '2.0L SkyActiv-G');
  const cx90 = cat.battery12VPart('cx90', '3.3L Turbo e-SkyActiv-G');
  const unsourced = cat.battery12VPart('mazda3bm', '1.6L SkyActiv-G');  // BM's smaller engine option — not individually sourced, falls to the same-family estimate
  assert.strictEqual(bm.name, '12V Battery');
  assert.ok(/60Ah/.test(bm.options[0].brand), 'Mazda\'s own Q-85 spec for 2.0/2.5 SkyActiv-G is 60Ah — BM\'s old flat "55Ah" was not quite right');
  assert.strictEqual(bm.options[0].partNo, '55D23L');
  assert.ok(!bm.options[0].note, 'a sourced rating must not carry an "estimated" disclaimer');
  assert.ok(/65Ah/.test(cx90.options[0].brand), 'Mazda\'s own published CX-9/CX-90 spec is 12V-65Ah/20HR');
  assert.strictEqual(cx90.options[0].partNo, '75D23L');
  assert.ok(!cx90.options[0].note, 'this one IS sourced from Mazda\'s own spec — must not carry a disclaimer');
  assert.ok(/estimated/.test(unsourced.options[0].note), 'BM\'s 1.6L option has no individually sourced 12V spec — must say so');
  assert.ok(cx90.options[0].price > bm.options[0].price, 'a bigger battery must cost more');
});

/* The CX-60/70/80/90's 3.3L mild-hybrid engine carries a second, separate
   48V battery pack the 2.5L PHEV option on the SAME models does not — a
   genuinely different component, not a bigger 12V battery. */
test('mildHybridEngine identifies only the 3.3L mild-hybrid, not the PHEV, on the same models', () => {
  assert.ok(cat.mildHybridEngine('3.3L Turbo e-SkyActiv-G'));
  assert.ok(cat.mildHybridEngine('3.3L e-SkyActiv-D'));
  assert.ok(!cat.mildHybridEngine('2.5L e-SkyActiv-G PHEV'));
  assert.ok(!cat.mildHybridEngine('2.0L SkyActiv-G'));
});

test('partsForModel includes the 48V pack only for the mild-hybrid engine, never the PHEV', () => {
  const mhev = cat.partsForModel('cx90', '3.3L Turbo e-SkyActiv-G');
  const phev = cat.partsForModel('cx90', '2.5L e-SkyActiv-G PHEV');
  assert.ok(mhev.some(p => p.name === '48V Mild-Hybrid Battery Pack'));
  assert.ok(!phev.some(p => p.name === '48V Mild-Hybrid Battery Pack'));
  const pack = mhev.find(p => p.name === '48V Mild-Hybrid Battery Pack');
  assert.ok(pack.options[0].price > 0, 'must not display as "from 0 SAR" — a sourced floor price stands in for a real quote');
  assert.ok(!pack.fitment.shareable, 'locked to this exact model, like every other non-universal consumable');
});

test('NORMAL_SCHED entries are [km, months] pairs', () => {
  Object.entries(cat.NORMAL_SCHED).forEach(([name, pair]) => {
    assert.ok(Array.isArray(pair) && pair.length === 2, `${name} must be a pair`);
    assert.strictEqual(typeof pair[0], 'number');
    assert.strictEqual(typeof pair[1], 'number');
  });
});
