'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

const ROUTES = ['dashboard', 'maintenance', 'parts', 'fuel', 'budget', 'reports'];

/* Every test needs bootApp()'s cleanup() to run even when an assertion
   throws partway through the body — otherwise the next test's setupDom()
   overwrites most globals, but URL.createObjectURL is installed under an
   `if (!globalThis.URL.createObjectURL)` guard in test/helpers/dom.js, so a
   stale one survives a failure and produces cascading noise in every test
   after the first real one. withBoot() centralizes the try/finally so no
   individual test can forget it. */
async function withBoot(opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = undefined; }
  const ctx = await bootApp(opts);
  try {
    await fn(ctx);
  } finally {
    ctx.cleanup();
  }
}

/* A length check alone cannot see an escaping regression, which is exactly what
   Tasks 4-8 risk introducing. Forgetting raw() around iconSvg() makes the output
   LONGER (3507 -> 5403 chars on the dashboard) while every icon on the page turns
   into visible escaped source text. `[object Object]` is equally invisible to a
   length check. So assert on content, not size:

     - No `&lt;` anywhere. Measured across all six routes in both languages with
       the seeded fixture: zero occurrences. No seeded user text contains `<`, so
       any occurrence means markup was escaped that should not have been.
     - No `[object Object]` — a Raw or a node interpolated where a string was meant.
     - At least one live <svg>. Measured per route (en/ar identical):
       dashboard 4, maintenance 1, parts 69, fuel 1, budget 2, reports 1.
       All six qualify, as do maintenance History mode and all three report types.

   Not used by the hostile-nickname test below, which escapes `<` on purpose.

   `opts.svg: false` for the dialogs measured to contain no icon — see DIALOGS. */
function assertHealthyRender(view, label, opts = {}) {
  const h = view.innerHTML;
  assert.ok(h.length > 50, `${label} rendered ${h.length} chars`);
  assert.ok(!h.includes('&lt;'), `${label} contains escaped markup — a raw()/html\`\` conversion lost an interpolation`);
  assert.ok(!h.includes('[object Object]'), `${label} stringified an object into the markup`);
  if (opts.svg !== false) {
    assert.ok(view.querySelectorAll('svg').length > 0, `${label} rendered no <svg> — its icons were escaped or dropped`);
  }
}

/* app.js's boot chain catches every rejection and writes a 172-char error card
   into #view, which clears any `length > 100` bar. So this test has to name the
   error text it must NOT see, and something only a real dashboard produces. */
test('the app boots without throwing and lands on the dashboard', () => withBoot(async ({ document }) => {
  const view = document.querySelector('#view');
  assert.ok(!view.textContent.includes('Could not open your garage'), 'boot failed and left the error card in #view');
  assert.ok(view.querySelector('.car-card'), 'no car card — this is not the rendered dashboard');
  assert.ok(view.querySelector('.hero'), 'no hero card — this is not the rendered dashboard');
  assertHealthyRender(view, 'dashboard');
}));

/* main.js used to auto-seed a demo 2016 Mazda 3 the moment a device had no
   garage — every load/refresh with cleared storage silently got a fake car
   instead of an empty one. Removed: an empty garage now renders an
   onboarding screen instead, and the topbar/tabbar (which all assume a
   vehicle exists) stay hidden until one is added. */
test('an empty garage renders onboarding instead of a default vehicle, and adding one restores the app', () => withBoot({ vehicles: [] }, async ({ document, api }) => {
  const view = document.querySelector('#view');
  assert.ok(!view.textContent.includes('Mazda 3'), 'a default vehicle must not be invented for an empty garage');
  assert.ok(view.textContent.includes('Add your first vehicle') || view.textContent.includes('Add a vehicle'),
    'the onboarding screen must offer to add a vehicle');
  assert.strictEqual(document.querySelector('#tabbar').hidden, true, 'the tab bar assumes a vehicle exists — must stay hidden');
  assert.strictEqual(document.querySelector('.topbar-actions').hidden, true, 'the topbar actions assume a vehicle exists — must stay hidden');

  api.addVehicle();
  const modal = document.querySelector('#modalCard');
  modal.querySelector('.btn.primary').click();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  assert.strictEqual(api.session.garage().vehicles.length, 1, 'the vehicle added from onboarding must actually be saved');
  assert.strictEqual(document.querySelector('#tabbar').hidden, false, 'the tab bar must come back once a vehicle exists');
  assert.ok(document.querySelector('#view').querySelector('.car-card'), 'the dashboard must render once a vehicle exists');
}));

/* One test per tab. Phase 3a shipped five ReferenceErrors that blanked four of
   these six pages, with a fully green suite, because nothing rendered them. */
for (const route of ROUTES) {
  test(`the ${route} page renders without throwing`, () => withBoot(async ({ document, api }) => {
    api.go(route);
    assertHealthyRender(document.querySelector('#view'), route);
  }));
}

test('every page renders in Arabic too', () => withBoot({ lang: 'ar' }, async ({ document, api }) => {
  for (const route of ROUTES) {
    api.go(route);
    assertHealthyRender(document.querySelector('#view'), `${route} (ar)`);
  }
}));

/* maintMode is a top-level `let`, so it is a global lexical binding and NOT a
   property of globalThis. It must be set through evalInApp; assigning
   api.maintMode would create an unrelated property and change nothing. */
test('the maintenance History mode renders', () => withBoot(async ({ document, api, evalInApp }) => {
  evalInApp('maintMode = "History"');
  api.go('maintenance');
  assertHealthyRender(document.querySelector('#view'), 'maintenance (History)');
}));

/* The Plan mode is the third maintMode and was the real hole behind the
   "app.js:479 stayed green" finding: buildPlan() renders only in this mode, so
   neither the default Schedule nor History test ever reached it. Measured:
   Plan renders 5 .plan-log buttons and 5 <svg>, against 1 <svg> for the other
   two modes. */
test('all three maintenance modes render', () => withBoot(async ({ document, api, evalInApp }) => {
  for (const mode of ['Schedule', 'Plan', 'History']) {
    evalInApp(`maintMode = ${JSON.stringify(mode)}`);
    api.go('maintenance');
    assertHealthyRender(document.querySelector('#view'), `maintenance (${mode})`);
  }
  evalInApp('maintMode = "Plan"');
  api.go('maintenance');
  assert.ok(document.querySelector('#view').querySelectorAll('.plan-log').length > 0,
    'the Plan mode rendered no plan-visit buttons — buildPlan did not run');
}));

test('all three report types render', () => withBoot(async ({ document, api, evalInApp }) => {
  for (const type of ['service', 'purchases', 'summary']) {
    evalInApp(`reportType = ${JSON.stringify(type)}`);
    api.go('reports');
    assertHealthyRender(document.querySelector('#view'), `${type} report`);
  }
}));

/* The visible caption was retired from the car studio, but the nickname still
   reaches the image's accessible description. Keep exercising
   that attribute boundary end to end so the original dashboard XSS remains
   covered without requiring the name to be printed on the car card. */
test('a hostile vehicle nickname stays inert in the car description', () => withBoot(async ({ document, api }) => {
  api.session.current().car.nickname = '<img src=x onerror=alert(1)>';
  api.go('dashboard');
  const view = document.querySelector('#view');
  const car = view.querySelector('img.studio-car');
  assert.ok(car.getAttribute('alt').includes('onerror=alert(1)'), 'the payload never reached the accessible description — this test proves nothing');
  assert.strictEqual(view.querySelectorAll('img[onerror]').length, 0, 'the payload became a live element');
}));

test('every CX-9 TB factory colour uses an exact photo instead of a tint', () => withBoot(async ({ document, api }) => {
  const car = api.session.current().car;
  car.modelId = 'cx9tb';
  car.model = 'CX-9';
  const photos = {
    'Dolphin Gray Mica (Code 39T)': 'assets/mazda-cx9-tb.png',
    'Brilliant Black Clearcoat (Code A3F)': 'assets/cx9tb-brilliant-black-clearcoat.png',
    'Crystal White Pearl Mica (Code 34K)': 'assets/cx9tb-crystal-white-pearl-mica.png',
    'Copper Red Mica (Code 32V)': 'assets/cx9tb-copper-red-mica.png',
    'Liquid Silver Metallic (Code 38P)': 'assets/cx9tb-liquid-silver-metallic.png',
    'Metropolitan Gray Mica (Code 36C)': 'assets/cx9tb-metropolitan-gray-mica.png',
    'Stormy Blue Mica (Code 35J)': 'assets/cx9tb-stormy-blue-mica.png'
  };

  for (const [color, src] of Object.entries(photos)) {
    car.color = color;
    api.go('dashboard');
    const studio = document.querySelector('.car-studio');
    assert.strictEqual(studio.querySelector('.studio-car').getAttribute('src'), src, color);
    assert.ok(![...studio.classList].some(name => name.startsWith('paint-')), `${color} still uses a tint class`);
  }
}));

test('every Mazda3 BM/BN factory colour uses an exact photo instead of a tint', () => withBoot(async ({ document, api }) => {
  const car = api.session.current().car;
  car.modelId = 'mazda3bm';
  car.model = '3';
  const photos = {
    'Meteor Gray Mica (Code 42A)': 'assets/mazda3-studio.png',
    'Soul Red Metallic (Code 41V)': 'assets/mazda3-soul-red.png',
    'Snowflake White Pearl Mica (Code 25D)': 'assets/mazda3-snowflake-white.png',
    'Jet Black Mica (Code 41W)': 'assets/mazda3-jet-black.png',
    'Deep Crystal Blue Mica (Code 42M)': 'assets/mazda3-deep-crystal-blue.png',
    'Blue Reflex Mica (Code 42B)': 'assets/mazda3-blue-reflex.png',
    'Liquid Silver Metallic (Code 38P)': 'assets/mazda3-liquid-silver.png',
    'Titanium Flash Mica (Code 42S)': 'assets/mazda3-titanium-flash.png'
  };

  for (const [color, src] of Object.entries(photos)) {
    car.color = color;
    api.go('dashboard');
    const studio = document.querySelector('.car-studio');
    assert.strictEqual(studio.querySelector('.studio-car').getAttribute('src'), src, color);
    assert.ok(![...studio.classList].some(name => name.startsWith('paint-')), `${color} still uses a tint class`);
  }
}));

test('every Mazda2 DJ factory colour uses an exact photo instead of a tint', () => withBoot(async ({ document, api }) => {
  const car = api.session.current().car;
  car.modelId = 'mazda2';
  car.model = '2';
  const photos = {
    'Soul Red Crystal Metallic (Code 46V)': 'assets/mazda2-soul-red-crystal-metallic.png',
    'Snowflake White Pearl Mica (Code 25D)': 'assets/mazda2-snowflake-white-pearl-mica.png',
    'Jet Black Mica (Code 41W)': 'assets/mazda2-jet-black-mica.png',
    'Deep Crystal Blue Mica (Code 42M)': 'assets/mazda2-deep-crystal-blue-mica.png',
    'Dynamic Blue Mica (Code 44J)': 'assets/mazda2-dynamic-blue-mica.png',
    'Machine Gray Metallic (Code 46G)': 'assets/mazda2-dj.png',
    'Ceramic Metallic (Code 47A)': 'assets/mazda2-ceramic-metallic.png',
    'Platinum Quartz Metallic (Code 47S)': 'assets/mazda2-platinum-quartz-metallic.png'
  };

  for (const [color, src] of Object.entries(photos)) {
    car.color = color;
    api.go('dashboard');
    const studio = document.querySelector('.car-studio');
    assert.strictEqual(studio.querySelector('.studio-car').getAttribute('src'), src, color);
    assert.ok(![...studio.classList].some(name => name.startsWith('paint-')), `${color} still uses a tint class`);
  }
}));

test('every CX-3 DK factory colour uses an exact photo instead of a tint', () => withBoot(async ({ document, api }) => {
  const car = api.session.current().car;
  car.modelId = 'cx3';
  car.model = 'CX-3';
  const photos = {
    'Machine Gray Metallic (Code 46G)': 'assets/mazda-cx3-dk.png',
    'Soul Red Crystal Metallic (Code 46V)': 'assets/cx3-soul-red-crystal-metallic.png',
    'Snowflake White Pearl Mica (Code 25D)': 'assets/cx3-snowflake-white-pearl-mica.png',
    'Jet Black Mica (Code 41W)': 'assets/cx3-jet-black-mica.png',
    'Deep Crystal Blue Mica (Code 42M)': 'assets/cx3-deep-crystal-blue-mica.png',
    'Dynamic Blue Mica (Code 44J)': 'assets/cx3-dynamic-blue-mica.png',
    'Ceramic Metallic (Code 47A)': 'assets/cx3-ceramic-metallic.png',
    'Titanium Flash Mica (Code 42S)': 'assets/cx3-titanium-flash-mica.png',
    'Polymetal Gray Metallic (Code 47C)': 'assets/cx3-polymetal-gray-metallic.png'
  };

  for (const [color, src] of Object.entries(photos)) {
    car.color = color;
    api.go('dashboard');
    const studio = document.querySelector('.car-studio');
    assert.strictEqual(studio.querySelector('.studio-car').getAttribute('src'), src, color);
    assert.ok(![...studio.classList].some(name => name.startsWith('paint-')), `${color} still uses a tint class`);
  }
}));

test('every CX-5 KE factory colour uses an exact photo instead of a tint', () => withBoot(async ({ document, api }) => {
  const car = api.session.current().car;
  car.modelId = 'cx5ke';
  car.model = 'CX-5';
  const photos = {
    'Meteor Gray Mica (Code 42A)': 'assets/mazda-cx5-ke.png',
    'Soul Red Metallic (Code 41V)': 'assets/cx5ke-soul-red-metallic.png',
    'Crystal White Pearl Mica (Code 34K)': 'assets/cx5ke-crystal-white-pearl-mica.png',
    'Jet Black Mica (Code 41W)': 'assets/cx5ke-jet-black-mica.png',
    'Blue Reflex Mica (Code 42B)': 'assets/cx5ke-blue-reflex-mica.png',
    'Sky Blue Mica (Code 41B)': 'assets/cx5ke-sky-blue-mica.png',
    'Stormy Blue Mica (Code 35J)': 'assets/cx5ke-stormy-blue-mica.png',
    'Liquid Silver Metallic (Code 38P)': 'assets/cx5ke-liquid-silver-metallic.png',
    'Metropolitan Gray Mica (Code 36C)': 'assets/cx5ke-metropolitan-gray-mica.png',
    'Zeal Red Mica (Code 41G)': 'assets/cx5ke-zeal-red-mica.png'
  };

  for (const [color, src] of Object.entries(photos)) {
    car.color = color;
    api.go('dashboard');
    const studio = document.querySelector('.car-studio');
    assert.strictEqual(studio.querySelector('.studio-car').getAttribute('src'), src, color);
    assert.ok(![...studio.classList].some(name => name.startsWith('paint-')), `${color} still uses a tint class`);
  }
}));

test('every Mazda6 GJ/GL factory colour uses an exact photo instead of a tint', () => withBoot(async ({ document, api }) => {
  const car = api.session.current().car;
  car.modelId = 'mazda6';
  car.model = 'Mazda6';
  const photos = {
    'Machine Gray Metallic (Code 46G)': 'assets/mazda6-gj.png',
    'Soul Red Metallic (Code 41V)': 'assets/mazda6-soul-red-metallic.png',
    'Soul Red Crystal Metallic (Code 46V)': 'assets/mazda6-soul-red-crystal-metallic.png',
    'Snowflake White Pearl Mica (Code 25D)': 'assets/mazda6-snowflake-white-pearl-mica.png',
    'Jet Black Mica (Code 41W)': 'assets/mazda6-jet-black-mica.png',
    'Deep Crystal Blue Mica (Code 42M)': 'assets/mazda6-deep-crystal-blue-mica.png',
    'Blue Reflex Mica (Code 42B)': 'assets/mazda6-blue-reflex-mica.png',
    'Sonic Silver Metallic (Code 45P)': 'assets/mazda6-sonic-silver-metallic.png',
    'Titanium Flash Mica (Code 42S)': 'assets/mazda6-titanium-flash-mica.png'
  };

  for (const [color, src] of Object.entries(photos)) {
    car.color = color;
    api.go('dashboard');
    const studio = document.querySelector('.car-studio');
    assert.strictEqual(studio.querySelector('.studio-car').getAttribute('src'), src, color);
    assert.ok(![...studio.classList].some(name => name.startsWith('paint-')), `${color} still uses a tint class`);
  }
}));

const threeVehicles = api => {
  const mk = (id, modelId) => ({ id, data: api.normalizeData(api.buildProfile(modelId, 0, { odometer: 1000, year: 2020 })) });
  api.session.setVehicles([mk('AAA', 'mazda3bm'), mk('BBB', 'cx5kf'), mk('CCC', 'cx90')], 'AAA');
};

/* deleteVehicle drops the vehicle from the garage synchronously, before its
   first await. A double-tap on "Remove this vehicle" therefore had its second
   click read the NEXT vehicle's id off session.garage().activeId and delete
   that one too — two vehicles gone, silently and irreversibly, from one
   gesture. Reproduced in a browser before the fix: 3 in, 1 left.

   The button is the layer that has to refuse re-entry (onAsyncClick), so
   that is what this drives — the real settings dialog, clicked twice. */
test('double-tapping "Remove this vehicle" removes exactly one', () => withBoot(async ({ document, api }) => {
  threeVehicles(api);
  api.confirm = () => true;                  // the new confirmation, accepted
  api.openSettings();

  const del = Array.from(document.querySelectorAll('#modalCard button'))
    .find(b => /Remove this vehicle/.test(b.textContent));
  assert.ok(del, 'the settings dialog no longer offers a remove button — this test proves nothing');

  del.onclick(); del.onclick();              // the double-tap
  await new Promise(r => setTimeout(r, 50));

  const left = api.session.garage().vehicles.map(v => v.id);
  assert.deepStrictEqual(left, ['BBB', 'CCC'], 'the second click deleted a vehicle it was never asked to');
}));

test('removing a vehicle asks first, and does nothing when declined', () => withBoot(async ({ document, api }) => {
  threeVehicles(api);
  let asked = 0;
  api.confirm = () => { asked++; return false; };
  api.openSettings();

  const del = Array.from(document.querySelectorAll('#modalCard button'))
    .find(b => /Remove this vehicle/.test(b.textContent));
  del.onclick();
  await new Promise(r => setTimeout(r, 50));

  assert.strictEqual(asked, 1, 'an irreversible delete went ahead without confirming');
  assert.strictEqual(api.session.garage().vehicles.length, 3, 'declining the confirmation still deleted the vehicle');
}));

/* Defence in depth behind the button: an id that is already gone must not
   fall through and remove whatever became active in its place. */
test('deleteVehicle ignores an id that is already gone', () => withBoot(async ({ api }) => {
  threeVehicles(api);
  await api.deleteVehicle('AAA');
  await api.deleteVehicle('AAA');
  assert.deepStrictEqual(api.session.garage().vehicles.map(v => v.id), ['BBB', 'CCC']);
}));

/* Economy is only measurable between two FULL tanks — a partial fill leaves an
   unknown amount already in the tank. The `full` flag was collected and shown
   but never read, so a partial closed an interval with litres that did not
   cover it. Here: 400 km on a partial (20 L) then a full (20 L). Only the full
   tank closes, and it must account for all 40 L over the whole 800 km. */
test('a partial fill does not close an economy interval', () => withBoot(async ({ api }) => {
  api.session.current().fuel = [
    { id: 'a', date: '2026-01-01', odometer: 1000, litres: 30, cost: 150, full: true },
    { id: 'b', date: '2026-01-10', odometer: 1400, litres: 20, cost: 100, full: false },
    { id: 'c', date: '2026-01-20', odometer: 1800, litres: 20, cost: 100, full: true }
  ];
  const rows = api.fuelRows();

  assert.strictEqual(rows[1].l100, null, 'the partial fill closed an interval it cannot measure');
  assert.strictEqual(rows[2].km, 800, 'the full tank must span back to the previous FULL tank, not the partial');
  assert.strictEqual(rows[2].l100, 5, '40 L over 800 km = 5 L/100km — the partial litres must carry forward');
  assert.strictEqual(rows[2].costPerKm, 0.25, 'the partial fill cost must carry forward too');
}));

/* ============================================================
   DIALOGS

   Half the conversion surface Tasks 5-8 will touch lives in dialog bodies:
   117 of app.js's 230 innerHTML/el() sites (51%) sit inside functions no route
   render ever calls. Nothing above this point opens a modal, so a break in any
   of them would have gone unnoticed.

   Same assertions as the routes, pointed at #modalCard. `svg` records the icon
   count measured per dialog (identical in English and Arabic); dialogs measured
   at zero opt out of the SVG assertion rather than being handed a check that
   cannot hold.
   ============================================================ */
const DIALOGS = [
  // name, owning route (null = callable from anywhere), invoke, measured svg count
  ['openSettings', null, api => api.openSettings(), 1],
  ['openGarage', null, api => api.openGarage(), 1],
  ['openAddVehicle', null, api => api.openAddVehicle(), 0],
  ['openEditOdo', null, api => api.openEditOdo(), 0],
  ['openEditBudget', 'budget', api => api.openEditBudget(), 0],
  ['openPlanSetup', 'maintenance', api => api.openPlanSetup(), 0],
  ['openHealthBreakdown', 'dashboard', api => api.openHealthBreakdown(), 0],
  ['openServiceDetail', 'maintenance', api => api.openServiceDetail(api.session.current().services[0]), 1],
  ['openEditPart', 'parts', api => api.openEditPart(api.session.current().parts[0]), 1],
  ['openLogConfirm', 'maintenance', api => api.openLogConfirm([api.session.current().services[0]], {}), 1],
  ['openAddHistory', 'maintenance', api => api.openAddHistory(), 0],
  ['openAddFuel', 'fuel', api => api.openAddFuel(), 0],
  ['openAddDoc', 'dashboard', api => api.openAddDoc(), 0],
  // Not in the review's list, but they are large conversion sites in the same
  // untested region: openAddSpending alone is 6039 chars of dialog body.
  ['openLogService', 'maintenance', api => api.openLogService(), 0],
  ['openAddSpending', 'budget', api => api.openAddSpending(), 0],
  ['openEditService', 'maintenance', api => api.openEditService(api.session.current().services[0]), 0]
];

for (const [name, route, invoke, svgCount] of DIALOGS) {
  test(`${name} renders its dialog without throwing`, () => withBoot(async ({ document, api }) => {
    if (route) api.go(route);
    invoke(api);

    const card = document.querySelector('#modalCard');
    assert.strictEqual(document.querySelector('#modalHost').hidden, false, `${name} did not open the modal host`);
    /* openModal always writes a grip and an <h2>. A third child proves the
       dialog's own bodyBuilder ran, which a length check would not. */
    assert.ok(card.children.length > 2, `${name} opened an empty dialog — its bodyBuilder appended nothing`);
    assertHealthyRender(card, `${name} dialog`, { svg: svgCount > 0 });
  }));
}

test('every dialog renders in Arabic too', () => withBoot({ lang: 'ar' }, async ({ document, api }) => {
  for (const [name, route, invoke, svgCount] of DIALOGS) {
    if (route) api.go(route);
    invoke(api);
    const card = document.querySelector('#modalCard');
    assert.ok(card.children.length > 2, `${name} opened an empty dialog in Arabic`);
    assertHealthyRender(card, `${name} dialog (ar)`, { svg: svgCount > 0 });
    api.closeModal();
  }
}));

/* Regression for the attribute-injection XSS found on 2026-08-18.
   field() builds its inputs by interpolating values straight into
   value="${...}" in an untagged template, across ~51 call sites. A stored
   value containing a double quote closed the attribute and everything after
   it became live markup — `" autofocus onfocus="alert(1)` produced a real
   autofocus handler that fired with no user interaction.

   These assert on ATTRIBUTES rather than on innerHTML text, because the
   payload's damage is structural: it becomes part of the tag, not content. */
const ATTR_PAYLOAD = '" autofocus onfocus="alert(1)';

function assertNoAttributeInjection(root, label) {
  assert.strictEqual(root.querySelectorAll('[onfocus]').length, 0, `${label}: payload became a live onfocus handler`);
  assert.strictEqual(root.querySelectorAll('[autofocus]').length, 0, `${label}: payload injected an autofocus attribute`);
  assert.strictEqual(root.querySelectorAll('[onerror]').length, 0, `${label}: payload became a live onerror handler`);
}

test('a hostile stored value cannot break out of an input attribute', () => withBoot(async ({ document, api }) => {
  const c = api.session.current();
  c.car.nickname = ATTR_PAYLOAD;
  c.car.make = ATTR_PAYLOAD;
  c.car.plate = ATTR_PAYLOAD;
  c.car.vin = ATTR_PAYLOAD;

  api.openSettings();
  const card = document.querySelector('#modalCard');
  assertNoAttributeInjection(card, 'openSettings');

  // and the value must survive intact as literal text, not be silently dropped
  assert.strictEqual(card.querySelector('#c_nick').getAttribute('value'), ATTR_PAYLOAD,
    'the nickname was escaped away instead of round-tripping');
}));

test('a hostile part name cannot break out of the edit-part dialog', () => withBoot(async ({ document, api }) => {
  const p = api.session.current().parts[0];
  p.name = ATTR_PAYLOAD;
  if (p.options && p.options[0]) {
    p.options[0].brand = ATTR_PAYLOAD;
    p.options[0].store = ATTR_PAYLOAD;
  }
  api.go('parts');
  api.openEditPart(p);
  assertNoAttributeInjection(document.querySelector('#modalCard'), 'openEditPart');
}));

test('a hostile document label cannot break out of the add-document dialog', () => withBoot(async ({ document, api }) => {
  api.openAddDoc({ type: 'Insurance', name: ATTR_PAYLOAD, number: ATTR_PAYLOAD, expiry: '2027-01-01' });
  assertNoAttributeInjection(document.querySelector('#modalCard'), 'openAddDoc');
}));

/* Regression for a second attribute-injection hole found in openEditPart on
   2026-08-18, after the first pass at converting this dialog: the icon,
   category and PartSouq part-no fields were never esc()-wrapped in the first
   place, so nothing flagged them, and they stayed untagged plain template
   literals straight past the html`` conversion. All three are user-editable
   (icon and PartSouq no. are free-text fields; category is drawn from
   user-created parts' `cat` values) and all three are settable via an
   imported backup. */
test('a hostile part icon, category or PartSouq no. cannot break out of the edit-part dialog', () => withBoot(async ({ document, api }) => {
  const p = api.session.current().parts[0];
  p.icon = ATTR_PAYLOAD;
  p.cat = ATTR_PAYLOAD;
  p.partsouq = ATTR_PAYLOAD;
  api.go('parts');
  api.openEditPart(p);
  const card = document.querySelector('#modalCard');
  assertNoAttributeInjection(card, 'openEditPart (icon/cat/partsouq)');
  assert.strictEqual(card.querySelector('#p_psq').getAttribute('value'), ATTR_PAYLOAD,
    'the PartSouq part no. was escaped away instead of round-tripping');
}));

/* Regression for an XSS found in docItem (Task 7, 2026-08-19): the dashboard's
   document list built each row with `it.innerHTML = \`...${d.name}...\`` in an
   untagged template, interpolating the label directly into markup rather than
   into an attribute. A document named `<img src=x onerror=alert(1)>` became a
   live element the moment the dashboard rendered — no dialog open required. */
test('a hostile document label cannot inject markup into the dashboard document list', () => withBoot(async ({ document, api }) => {
  api.session.current().docs = api.session.current().docs || [];
  api.session.current().docs.push({ id: 'reg-doc', type: 'Insurance', name: '<img src=x onerror=alert(1)>', expiry: '2027-01-01', number: '' });
  api.go('dashboard');
  const view = document.querySelector('#view');
  assert.ok(view.textContent.includes('onerror=alert(1)'), 'the payload never reached #view — this test proves nothing');
  assert.strictEqual(view.querySelectorAll('img[onerror]').length, 0, 'the payload became a live element');
}));

/* Regression for Task 8 (2026-08-19): openGarage's vehicle-list row built each
   item with `it.innerHTML = \`...${vehicleName(c)}...\`` in an untagged
   template, interpolating the nickname/make/model directly into markup. A
   vehicle nicknamed `<img src=x onerror=alert(1)>` became a live element the
   moment the garage switcher opened — the same class of bug as docItem
   (Task 7), one dialog away from the dashboard's. */
test('a hostile vehicle name cannot inject markup into the garage vehicle list', () => withBoot(async ({ document, api }) => {
  api.session.current().car.nickname = '<img src=x onerror=alert(1)>';
  api.openGarage();
  const card = document.querySelector('#modalCard');
  assert.ok(card.textContent.includes('onerror=alert(1)'), 'the payload never reached #modalCard — this test proves nothing');
  assert.strictEqual(card.querySelectorAll('img[onerror]').length, 0, 'the payload became a live element');
}));

/* ============================================================
   INJECTION SWEEP (Task 9, Addition 3)

   Every static check in this phase — the html`` conversion, the render
   smoke tests above, even the guard tests in test/no-raw-templates.test.js
   — has a blind spot: none of them execute the app with hostile data
   across every surface at once. What has actually caught every live bug
   found in this phase (docItem, openGarage's vehicle list, the two
   attribute-injection holes) was exactly that: seed hostile data, render,
   check for a live handler. This sweep generalizes the pattern across
   every user-editable field the app has, every route (including both
   maintenance sub-modes that show history and all three report types),
   and every dialog in DIALOGS above — with two payload shapes: an
   attribute breakout and a markup injection.

   Fields intentionally NOT covered: fuel entries carry no free-text field
   in the current data model (litres/cost/odometer are numeric, date is a
   date string) — there is nothing named `note` or `station` on a fuel
   record for app.js to render, despite the task brief mentioning one. See
   task-9-report.md. */
const MARKUP_PAYLOAD = '<img src=x onerror=alert(1)>';

function seedHostileData(api, payload) {
  const c = api.session.current();
  c.car.nickname = payload;
  c.car.make = payload;
  c.car.model = payload;
  c.car.year = payload;
  c.car.plate = payload;
  c.car.vin = payload;
  c.car.color = payload;
  c.car.engine = payload;

  const svc = c.services[0];
  svc.name = payload;
  svc.note = payload;

  const part = c.parts[0];
  part.name = payload;
  part.cat = payload; // renders as a Parts-page filter chip — see app.js:907, the 8th live XSS this sweep found
  if (part.options && part.options[0]) {
    part.options[0].brand = payload;
    part.options[0].partNo = payload;
    part.options[0].store = payload;
    part.options[0].note = payload;
  }

  c.history = c.history || [];
  // date is sliced to a year label (app.js:863, `yr`) and reaches the same
  // class of sink as parts[].cat did — covered for completeness even though
  // it was never a live bug (already html``-wrapped by the time this test
  // seeds it).
  c.history.push({ id: 'inj-hist', name: payload, icon: '🔧', date: payload, odometer: 1000, cost: 10, cat: 'Maintenance', note: payload });

  c.spending = c.spending || [];
  c.spending.push({ id: 'inj-sp', date: '2026-01-01', cat: 'Maintenance', desc: payload, amount: 10, odometer: 1000 });

  c.docs = c.docs || [];
  c.docs.push({ id: 'inj-doc', type: 'Insurance', name: payload, expiry: '2027-01-01', number: payload });
}

for (const [label, payload] of [['attribute breakout', ATTR_PAYLOAD], ['markup injection', MARKUP_PAYLOAD]]) {
  test(`injection sweep (${label}): every route renders the payload as inert text`, () => withBoot(async ({ document, api, evalInApp }) => {
    seedHostileData(api, payload);

    for (const route of ROUTES) {
      api.go(route);
      assertNoAttributeInjection(document.querySelector('#view'), `${route} route (${label})`);
    }
    // maintenance History mode is where a hostile history name/note renders;
    // Plan mode is exercised for completeness alongside the default Schedule.
    for (const mode of ['Schedule', 'Plan', 'History']) {
      evalInApp(`maintMode = ${JSON.stringify(mode)}`);
      api.go('maintenance');
      assertNoAttributeInjection(document.querySelector('#view'), `maintenance (${mode}) (${label})`);
    }
    // reports: 'service' renders history notes, 'purchases' renders spending desc
    for (const type of ['service', 'purchases', 'summary']) {
      evalInApp(`reportType = ${JSON.stringify(type)}`);
      api.go('reports');
      assertNoAttributeInjection(document.querySelector('#view'), `${type} report (${label})`);
    }
  }));

  test(`injection sweep (${label}): every dialog renders the payload as inert text`, () => withBoot(async ({ document, api }) => {
    seedHostileData(api, payload);

    for (const [name, route, invoke] of DIALOGS) {
      if (route) api.go(route);
      invoke(api);
      assertNoAttributeInjection(document.querySelector('#modalCard'), `${name} dialog (${label})`);
      api.closeModal();
    }
  }));
}

/* Phase 3 left this open: clear() revokes object URLs, but revoking a blob URL
   does not blank an already-decoded <img>. The previous user's car photo stays
   on screen until something re-renders. This asserts signOut() does both. */
test('signing out leaves no trace of the previous garage on screen', async () => {
  const app = await bootApp({ protocol: 'https:' });
  try {
    const { api, document } = app;

    api.session.setVehicles([{
      id: 'v1',
      data: {
        car: { nickname: 'PreviousUserCar', odometer: 1000, photo: 'blob:previous-photo' },
        // renderDashboard reads budget.annual unguarded; setVehicles does not
        // normalize (unlike load()), so the fixture must supply it directly.
        budget: { annual: 6000 },
        services: [], parts: [], history: [], spending: [], fuel: [], docs: []
      }
    }], 'v1');
    api.go('dashboard');

    assert.ok(document.body.textContent.includes('PreviousUserCar'), 'precondition: the car is on screen');

    /* Pins that sign-out leaves no live object URLs behind, tracked through
       session.js's own objectUrl()/configure() seam rather than inferred from
       the DOM. NOT proof that session.clear() specifically did the revoking:
       go() (app.js) calls session.revokeObjectUrls() unconditionally on every
       navigation, and rerender() below calls go() as part of reproducing the
       real app.js wiring — so this assertion is satisfied either way and
       cannot attribute the revocation to clear() vs. the next navigation.
       Nothing in this file can make that attribution: wipe()+session.load()
       alone leave an identical end state whether or not clear() ran, so a
       screen/DOM-based test structurally cannot distinguish them. The
       property that IS distinguishable — clear()'s _generation bump stopping
       a save in flight from landing in the next session — is covered
       directly in test/account.test.js instead. */
    const revoked = [];
    api.session.configure({
      makeObjectUrl: b => `blob:tracked-${b && b.tag ? b.tag : 'x'}`,
      revokeObjectUrl: u => revoked.push(u)
    });
    const registered = api.session.objectUrl({ tag: 'previous-photo' });

    api.account.configure({
      client: { auth: { signOut: () => Promise.resolve({ error: null }) }, from: () => ({}) },
      protocol: 'https:',
      rerender: () => { api.renderTopbar(); api.go(app.evalInApp('current')); }
    });
    api.account.setUserForTest({ id: 'u1', email: 'a@b.c' });

    await api.account.signOut();

    assert.ok(!document.body.textContent.includes('PreviousUserCar'),
      'the previous garage must not survive a sign-out on screen');
    assert.ok(![...document.querySelectorAll('img')].some(i => (i.getAttribute('src') || '').includes('previous-photo')),
      'no revoked blob URL may remain in the DOM');
    assert.ok(revoked.includes(registered),
      'sign-out must revoke the previous session\'s object URLs, not merely re-render over them');
  } finally { app.cleanup(); }
});

test('signing out removes the inline accent override, not just the previous car\'s markup', async () => {
  const app = await bootApp({ protocol: 'https:' });
  try {
    const { api, document } = app;

    // Precondition: boot's own applyAccent() call left an inline override in
    // place for the fixture vehicle's colour.
    assert.notStrictEqual(document.documentElement.style.getPropertyValue('--accent'), '',
      'precondition: an accent override is set for the signed-in garage');

    api.account.configure({
      client: { auth: { signOut: () => Promise.resolve({ error: null }) }, from: () => ({}) },
      protocol: 'https:',
      rerender: () => { api.applyAccent(); api.renderTopbar(); api.go(app.evalInApp('current')); }
    });
    api.account.setUserForTest({ id: 'u1', email: 'a@b.c' });

    await api.account.signOut();

    /* linkedom (this harness's DOM) has no getComputedStyle/CSSOM support, and
       the harness never loads styles.css in the first place, so there is no
       cascade here to read a "stylesheet default" back from. What this
       asserts instead is the property applyAccent() actually controls: that
       sign-out removes the inline override rather than leaving it at the
       previous car's value. Leaving it in place, even unchanged, is exactly
       the bug this guards against — the previous car's accent staying
       painted on screen after there is no longer a vehicle to accent from. */
    ['--accent', '--accent-soft', '--accent-2', '--accent-glow'].forEach(prop => {
      assert.strictEqual(document.documentElement.style.getPropertyValue(prop), '',
        `${prop} must be removed, not merely left at its old value, once there is no vehicle to accent from`);
    });
    assert.strictEqual(app.evalInApp("localStorage.getItem('garage.accent')"), null,
      'signing out must drop the cached accent too, or index.html\'s pre-paint script would flash the old car\'s colour on the next load');
  } finally { app.cleanup(); }
});

test('applyAccent() caches the accent to localStorage, for index.html\'s pre-paint script to read before session.load() resolves', async () => {
  const app = await bootApp({ protocol: 'https:' });
  try {
    const { document, evalInApp } = app;
    const live = document.documentElement.style.getPropertyValue('--accent');
    const cached = JSON.parse(evalInApp("localStorage.getItem('garage.accent')"));
    assert.strictEqual(cached.accent, live,
      'the cached accent must match what applyAccent() actually painted, or the pre-paint script would flash a stale colour');
    ['soft', 'accent2', 'glow'].forEach(k => assert.ok(cached[k], `cached accent is missing ${k}`));
  } finally { app.cleanup(); }
});

/* ============================================================
   The app's own write paths must reach account.enqueueVehicle().

   Every account test drives account.js directly, so a push that the APP
   never triggers still passes them. openAddVehicle() persists with a direct
   saveVehicle() rather than session.save(), which means it does not fire
   session.js's afterSave hook — and afterSave is the only wiring between a
   save and an enqueue. Without an explicit enqueueVehicle() call the new
   vehicle is never queued, so the next boot's adopt() sees it as stale and
   deletes it. This boots the real app against a recording client, confirms
   the vehicle landed in the outbox, then drains it and asserts the upsert
   actually crossed the wire.
   ============================================================ */
test('adding a vehicle while signed in queues it, and draining pushes it to the server', async () => {
  const upserts = { vehicles: [], garage: [] };
  const stub = {
    createClient: () => ({
      /* No stored session: start() stays anonymous so the boot pull cannot
         adopt an empty server garage over the fixture. The signed-in state is
         installed afterwards, which is what the add path actually reads. */
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
      from: table => ({
        upsert(row) { upserts[table].push(row); return Promise.resolve({ error: null }); }
      })
    })
  };
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub });
  try {
    const { document, api } = app;
    api.account.setUserForTest({ id: 'u1', email: 'a@b.c' });
    const before = api.session.garage().vehicles.map(v => v.id);

    api.openAddVehicle();
    const btn = [...document.querySelectorAll('#modalCard button')].pop();
    await btn.onclick({ preventDefault() {} });

    const added = api.session.garage().vehicles.map(v => v.id).filter(id => before.indexOf(id) < 0);
    assert.strictEqual(added.length, 1, 'precondition: the dialog added exactly one vehicle');
    // Two entries: the vehicle itself, and the garage's new activeId — the
    // new vehicle becomes active on add, and that never reaches
    // session.save()'s afterSave hook either, so it needs its own enqueue.
    assert.strictEqual(await api.account.outboxSize(), 2,
      'the new vehicle and its activeId were never both queued — the next boot\'s adopt() would delete the vehicle as stale, or switch back to the old active one');

    await api.account.drain();

    assert.ok(upserts.vehicles.some(r => r.id === added[0]), 'draining the outbox must push the queued vehicle');
    assert.ok(upserts.garage.some(r => r.active_id === added[0]), 'draining the outbox must push the new activeId');
  } finally { app.cleanup(); }
});

/* ============================================================
   Fix 1: nothing drains the outbox after a save on an always-online tab.

   The ONLY triggers for drain()/sync() before this fix were account.start()
   at boot and the `online` event listener — which fires only on a
   transition into the online state. A tab that stays connected the whole
   session never fires it, so a save enqueued and never pushed until reload.
   This proves a save reaches the server WITHOUT any `online` event firing —
   i.e. kickSync()'s un-awaited drain() runs automatically right after the
   enqueue.
   ============================================================ */
test('adding a vehicle while signed in automatically drains without any online event', async () => {
  const upserts = { vehicles: [], garage: [] };
  const stub = {
    createClient: () => ({
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
      from: table => ({
        upsert(row) { upserts[table].push(row); return Promise.resolve({ error: null }); }
      })
    })
  };
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub });
  try {
    const { document, api } = app;
    api.account.setUserForTest({ id: 'u1', email: 'a@b.c' });
    const before = api.session.garage().vehicles.map(v => v.id);

    api.openAddVehicle();
    const btn = [...document.querySelectorAll('#modalCard button')].pop();
    await btn.onclick({ preventDefault() {} });

    const added = api.session.garage().vehicles.map(v => v.id).filter(id => before.indexOf(id) < 0);
    assert.strictEqual(added.length, 1, 'precondition: the dialog added exactly one vehicle');

    // kickSync()'s drain() is deliberately un-awaited by the save path, and no
    // `online` event is dispatched anywhere in this test — poll briefly for
    // the automatic drain to land instead of awaiting a promise directly.
    const deadline = Date.now() + 2000;
    let size = await api.account.outboxSize();
    while (size !== 0 && Date.now() < deadline) {
      await new Promise(r => setImmediate(r));
      size = await api.account.outboxSize();
    }

    assert.ok(upserts.vehicles.some(r => r.id === added[0]),
      'a save must trigger an automatic drain (kickSync) without waiting for an `online` event');
    assert.strictEqual(size, 0, 'the automatic drain must have emptied the outbox');
  } finally { app.cleanup(); }
});

/* ============================================================
   The delete path's analogue of the test above. enqueueTombstone() is
   asynchronous (it reads the outbox, prunes any stale queued 'vehicle' entry
   for the same id, THEN enqueues the tombstone) — so deleteVehicle() must
   sequence its kickSync() call to run only after that promise resolves.
   Firing it immediately, un-sequenced, races kickSync()'s drain() against
   the write and lets the drain snapshot the outbox before the tombstone
   lands in it, so the delete is not actually pushed until the next `online`
   event or app boot. This proves a delete reaches the server WITHOUT any
   `online` event firing, exactly like the save path above.
   ============================================================ */
test('deleting a vehicle while signed in automatically drains without any online event', async () => {
  const upserts = { vehicles: [], garage: [] };
  const stub = {
    createClient: () => ({
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
      from: table => ({
        upsert(row) { upserts[table].push(row); return Promise.resolve({ error: null }); }
      })
    })
  };
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub });
  try {
    const { document, api } = app;
    api.account.setUserForTest({ id: 'u1', email: 'a@b.c' });
    const before = api.session.garage().vehicles.map(v => v.id);

    // deleteVehicle() refuses to remove the last vehicle, so add a second one
    // first (same dialog flow as the test above).
    api.openAddVehicle();
    const btn = [...document.querySelectorAll('#modalCard button')].pop();
    await btn.onclick({ preventDefault() {} });

    const added = api.session.garage().vehicles.map(v => v.id).filter(id => before.indexOf(id) < 0);
    assert.strictEqual(added.length, 1, 'precondition: the dialog added exactly one vehicle');

    // Let the add's own kickSync() drain settle first, so its 'vehicle' upsert
    // does not get confused with the tombstone upsert this test asserts on.
    let addDrainSize = await api.account.outboxSize();
    const addDeadline = Date.now() + 2000;
    while (addDrainSize !== 0 && Date.now() < addDeadline) {
      await new Promise(r => setImmediate(r));
      addDrainSize = await api.account.outboxSize();
    }

    const idToDelete = added[0];
    await api.deleteVehicle(idToDelete);

    // No `online` event is dispatched anywhere in this test — poll briefly
    // for kickSync()'s un-awaited drain() to land the tombstone on its own.
    // Polling on outboxSize() alone is unsafe here: enqueueTombstone() does
    // its own async outboxAll() read before it ever writes the tombstone, so
    // a poll loop keyed only on "size !== 0" can sample size === 0 before the
    // tombstone is written at all and exit immediately, never having proven
    // anything. Poll on the actual server-side effect instead.
    const deadline = Date.now() + 2000;
    let pushed = upserts.vehicles.some(r => r.id === idToDelete && r.deleted_at);
    while (!pushed && Date.now() < deadline) {
      await new Promise(r => setImmediate(r));
      pushed = upserts.vehicles.some(r => r.id === idToDelete && r.deleted_at);
    }

    assert.ok(pushed,
      'a delete must trigger an automatic drain (kickSync) without waiting for an `online` event');
    assert.strictEqual(await api.account.outboxSize(), 0, 'the automatic drain must have emptied the outbox');
  } finally { app.cleanup(); }
});

/* askWhichGarage() is the merge prompt account.js awaits through its `choose`
   dep before it replaces one side of the garage with the other. Every account
   test stubs `choose` out, so main.js's real implementation — and in
   particular its dismissal path — has never been exercised.

   Both buttons resolve the promise explicitly, so only Escape/backdrop/any
   other route through closeModal() can reach opts.onDismissed. If that hook
   were dropped, signIn() would await a promise nothing ever settles: the
   modal closes, the app looks idle, and the sign-in silently never finishes.
   'local' specifically, not just "settles" — dismissal is not a choice, so it
   must fall back to the side that cannot silently delete what the user was
   just looking at. */
test('dismissing the merge prompt resolves it as "local" rather than hanging sign-in', () => withBoot(async ({ document, api }) => {
  const decision = api.askWhichGarage();

  assert.strictEqual(document.querySelector('#modalHost').hidden, false,
    'precondition: askWhichGarage() opened the modal');

  // Escape, not either button — the only paths that reach onDismissed.
  api.closeModal();

  const settled = await Promise.race([
    decision,
    new Promise(r => setImmediate(() => r('__pending__')))
  ]);
  assert.strictEqual(settled, 'local',
    'a dismissed merge prompt must resolve as "local"; leaving it pending hangs signIn() forever');
}));

/* ============================================================
   Record deletes and their undo
   ============================================================
   These rows delete on a single tap with no confirmation in front of them,
   which is the right call on a phone but only because there is a way back
   behind it. Everything below pins that way back: without it the tap is
   simply destructive, and the absence of a confirm() becomes a bug rather
   than a design choice. */

test('deleting a record offers an undo that puts it back at its original index', () => withBoot(async ({ document, api }) => {
  const fuel = [
    { id: 'f1', date: '2024-01-01', odometer: 1000, litres: 30, cost: 100, full: true },
    { id: 'f2', date: '2024-02-01', odometer: 1500, litres: 32, cost: 110, full: true },
    { id: 'f3', date: '2024-03-01', odometer: 2000, litres: 31, cost: 105, full: true }
  ];
  api.session.current().fuel = fuel;

  const btn = api.deleteRow('Delete fill-up', 'fuel', fuel[1], 'fuel', 'Fill-up deleted');
  await btn.onclick();
  assert.deepStrictEqual(api.session.current().fuel.map(x => x.id), ['f1', 'f3'],
    'the delete itself did not land');

  const undo = document.querySelector('#toastHost .toast-undo');
  assert.ok(undo, 'a record delete must offer an undo — it is the only safety net this action has');

  undo.onclick({ stopPropagation() {} });
  await new Promise(r => setTimeout(r, 50));

  assert.deepStrictEqual(api.session.current().fuel.map(x => x.id), ['f1', 'f2', 'f3'],
    'undo must restore the record where it was, not append it to the end');
}));

/* The photo is the half that is easy to get wrong: saveVehicle() collects the
   now-orphaned blob and deletes the stored copy during the delete's own save,
   and session.save() drops the in-memory one straight after. Capture it any
   later than deleteRow() does and undo brings back a row pointing at an image
   that no longer exists anywhere. */
test('undoing a delete restores the receipt photo, not just the record', () => withBoot(async ({ document, api }) => {
  const blob = { type: 'image/jpeg', size: 3 };
  api.session.photos()['ph1'] = blob;
  const rec = { id: 'h9', name: 'Oil change', date: '2024-05-01', odometer: 9000, cost: 200, cat: 'Maintenance', photoId: 'ph1' };
  api.session.current().history.unshift(rec);

  const puts = [];
  const realPut = api.putPhotoBlob;
  api.putPhotoBlob = (id, b) => { puts.push([id, b]); return realPut(id, b); };

  const btn = api.deleteRow('Delete record', 'history', rec, 'maintenance', 'Record deleted');
  await btn.onclick();
  assert.ok(!api.session.current().history.some(x => x.id === 'h9'), 'the delete itself did not land');

  document.querySelector('#toastHost .toast-undo').onclick({ stopPropagation() {} });
  await new Promise(r => setTimeout(r, 50));

  assert.ok(api.session.current().history.some(x => x.id === 'h9'), 'undo did not restore the record');
  assert.deepStrictEqual(puts, [['ph1', blob]],
    'undo must re-put the blob; the record still carries a photoId and a blob: URL, so the save alone stores nothing');
  assert.strictEqual(api.session.photos()['ph1'], blob,
    'the in-memory photo cache must be repopulated too, or the restored row renders with no image');
}));

/* The undo window is seconds long, and a sign-out inside it clears the
   session outright. Re-inserting blind at that point would drop the previous
   user's record into whatever garage is loaded next. */
test('undo after the garage is gone restores nothing', () => withBoot(async ({ document, api }) => {
  const rec = { id: 'f7', date: '2024-04-01', odometer: 3000, litres: 20, cost: 80, full: true };
  api.session.current().fuel = [rec];

  const btn = api.deleteRow('Delete fill-up', 'fuel', rec, 'fuel', 'Fill-up deleted');
  await btn.onclick();
  const undo = document.querySelector('#toastHost .toast-undo');

  api.session.clear();                       // sign-out, mid-undo-window
  undo.onclick({ stopPropagation() {} });    // must not throw, and must not resurrect
  await new Promise(r => setTimeout(r, 50));

  assert.strictEqual(api.session.garage(), null,
    'undo re-created a garage for a session that had been signed out');
}));

test('a failed save offers no undo — there is nothing to reverse', () => withBoot(async ({ document, api }) => {
  const rec = { id: 'f8', date: '2024-04-02', odometer: 3100, litres: 21, cost: 82, full: true };
  api.session.current().fuel = [rec];
  api.session.configure({ saveVehicle: () => Promise.resolve({ ok: false, error: new Error('disk full') }) });

  const btn = api.deleteRow('Delete fill-up', 'fuel', rec, 'fuel', 'Fill-up deleted');
  await btn.onclick();

  assert.strictEqual(document.querySelector('#toastHost .toast-undo'), null,
    'offering undo after a failed save promises to reverse something that never happened');
}));

/* role, not aria-live: #toastHost is a permanent live region (index.html), so
   the announcement does not depend on the region being inserted alongside its
   content. What the role decides is whether a message waits its turn. */
test('a warning toast interrupts (role="alert"); a confirmation queues (role="status")', () => withBoot(async ({ document, api }) => {
  api.toast('Vehicle added');
  api.toast('Storage is full', 'warn');
  const nodes = Array.from(document.querySelectorAll('#toastHost .toast'));
  assert.deepStrictEqual(nodes.map(n => n.getAttribute('role')), ['status', 'alert'],
    'a save that did NOT happen must not queue behind a routine confirmation');
}));

/* A toast names what is wrong; inside a long modal it does not say where, and
   the field can be scrolled out of sight. */
test('fail() rings the offending field and clears the ring on the next keystroke', () => withBoot(async ({ document, api }) => {
  api.openAddFuel();
  const litres = document.querySelector('#f_l');
  assert.ok(litres, 'the fuel dialog no longer has a litres field — this test proves nothing');

  const ret = api.fail('#f_l', 'Litres required');
  assert.strictEqual(ret, false, 'fail() must return false so guards can stay one-liners');
  assert.ok(litres.classList.contains('field-error'), 'the field a validation toast is about was not marked');

  litres.dispatchEvent(new document.defaultView.Event('input'));
  assert.ok(!litres.classList.contains('field-error'), 'the ring must clear on input, not outlive the mistake');
}));
