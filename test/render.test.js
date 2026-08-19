'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

const ROUTES = ['dashboard', 'maintenance', 'parts', 'fuel', 'budget', 'reports'];

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
test('the app boots without throwing and lands on the dashboard', async () => {
  const { document, cleanup } = await bootApp();
  const view = document.querySelector('#view');
  assert.ok(!view.textContent.includes('Could not open your garage'), 'boot failed and left the error card in #view');
  assert.ok(view.querySelector('.car-card'), 'no car card — this is not the rendered dashboard');
  assert.ok(view.querySelector('.hero'), 'no hero card — this is not the rendered dashboard');
  assertHealthyRender(view, 'dashboard');
  cleanup();
});

/* One test per tab. Phase 3a shipped five ReferenceErrors that blanked four of
   these six pages, with a fully green suite, because nothing rendered them. */
for (const route of ROUTES) {
  test(`the ${route} page renders without throwing`, async () => {
    const { document, api, cleanup } = await bootApp();
    api.go(route);
    assertHealthyRender(document.querySelector('#view'), route);
    cleanup();
  });
}

test('every page renders in Arabic too', async () => {
  const { document, api, cleanup } = await bootApp({ lang: 'ar' });
  for (const route of ROUTES) {
    api.go(route);
    assertHealthyRender(document.querySelector('#view'), `${route} (ar)`);
  }
  cleanup();
});

/* maintMode is a top-level `let`, so it is a global lexical binding and NOT a
   property of globalThis. It must be set through evalInApp; assigning
   api.maintMode would create an unrelated property and change nothing. */
test('the maintenance History mode renders', async () => {
  const { document, api, evalInApp, cleanup } = await bootApp();
  evalInApp('maintMode = "History"');
  api.go('maintenance');
  assertHealthyRender(document.querySelector('#view'), 'maintenance (History)');
  cleanup();
});

/* The Plan mode is the third maintMode and was the real hole behind the
   "app.js:479 stayed green" finding: buildPlan() renders only in this mode, so
   neither the default Schedule nor History test ever reached it. Measured:
   Plan renders 5 .plan-log buttons and 5 <svg>, against 1 <svg> for the other
   two modes. */
test('all three maintenance modes render', async () => {
  const { document, api, evalInApp, cleanup } = await bootApp();
  for (const mode of ['Schedule', 'Plan', 'History']) {
    evalInApp(`maintMode = ${JSON.stringify(mode)}`);
    api.go('maintenance');
    assertHealthyRender(document.querySelector('#view'), `maintenance (${mode})`);
  }
  evalInApp('maintMode = "Plan"');
  api.go('maintenance');
  assert.ok(document.querySelector('#view').querySelectorAll('.plan-log').length > 0,
    'the Plan mode rendered no plan-visit buttons — buildPlan did not run');
  cleanup();
});

test('all three report types render', async () => {
  const { document, api, evalInApp, cleanup } = await bootApp();
  for (const type of ['service', 'purchases', 'summary']) {
    evalInApp(`reportType = ${JSON.stringify(type)}`);
    api.go('reports');
    assertHealthyRender(document.querySelector('#view'), `${type} report`);
  }
  cleanup();
});

/* The escaping acceptance criterion, end to end through a real render.

   The nickname only reaches #view through the car card's photo branch — the
   seeded car has no photo, so a nickname alone renders nothing and the
   assertion below would hold vacuously. Setting a photo is what makes this a
   test. It caught a live XSS on the dashboard the first time it ran. */
test('a hostile vehicle nickname renders as text, not markup', async () => {
  const { document, api, cleanup } = await bootApp();
  api.session.current().car.photo = 'blob:test/car';
  api.session.current().car.nickname = '<img src=x onerror=alert(1)>';
  api.go('dashboard');
  const view = document.querySelector('#view');
  assert.ok(view.textContent.includes('onerror=alert(1)'), 'the payload never reached #view — this test proves nothing');
  assert.strictEqual(view.querySelectorAll('img[onerror]').length, 0, 'the payload became a live element');
  cleanup();
});

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
  test(`${name} renders its dialog without throwing`, async () => {
    const { document, api, cleanup } = await bootApp();
    if (route) api.go(route);
    invoke(api);

    const card = document.querySelector('#modalCard');
    assert.strictEqual(document.querySelector('#modalHost').hidden, false, `${name} did not open the modal host`);
    /* openModal always writes a grip and an <h2>. A third child proves the
       dialog's own bodyBuilder ran, which a length check would not. */
    assert.ok(card.children.length > 2, `${name} opened an empty dialog — its bodyBuilder appended nothing`);
    assertHealthyRender(card, `${name} dialog`, { svg: svgCount > 0 });
    cleanup();
  });
}

test('every dialog renders in Arabic too', async () => {
  const { document, api, cleanup } = await bootApp({ lang: 'ar' });
  for (const [name, route, invoke, svgCount] of DIALOGS) {
    if (route) api.go(route);
    invoke(api);
    const card = document.querySelector('#modalCard');
    assert.ok(card.children.length > 2, `${name} opened an empty dialog in Arabic`);
    assertHealthyRender(card, `${name} dialog (ar)`, { svg: svgCount > 0 });
    api.closeModal();
  }
  cleanup();
});

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

test('a hostile stored value cannot break out of an input attribute', async () => {
  const { document, api, cleanup } = await bootApp();
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
  cleanup();
});

test('a hostile part name cannot break out of the edit-part dialog', async () => {
  const { document, api, cleanup } = await bootApp();
  const p = api.session.current().parts[0];
  p.name = ATTR_PAYLOAD;
  if (p.options && p.options[0]) {
    p.options[0].brand = ATTR_PAYLOAD;
    p.options[0].store = ATTR_PAYLOAD;
  }
  api.go('parts');
  api.openEditPart(p);
  assertNoAttributeInjection(document.querySelector('#modalCard'), 'openEditPart');
  cleanup();
});

test('a hostile document label cannot break out of the add-document dialog', async () => {
  const { document, api, cleanup } = await bootApp();
  api.openAddDoc({ type: 'Insurance', name: ATTR_PAYLOAD, number: ATTR_PAYLOAD, expiry: '2027-01-01' });
  assertNoAttributeInjection(document.querySelector('#modalCard'), 'openAddDoc');
  cleanup();
});

/* Regression for a second attribute-injection hole found in openEditPart on
   2026-08-18, after the first pass at converting this dialog: the icon,
   category and PartSouq part-no fields were never esc()-wrapped in the first
   place, so nothing flagged them, and they stayed untagged plain template
   literals straight past the html`` conversion. All three are user-editable
   (icon and PartSouq no. are free-text fields; category is drawn from
   user-created parts' `cat` values) and all three are settable via an
   imported backup. */
test('a hostile part icon, category or PartSouq no. cannot break out of the edit-part dialog', async () => {
  const { document, api, cleanup } = await bootApp();
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
  cleanup();
});

/* Regression for an XSS found in docItem (Task 7, 2026-08-19): the dashboard's
   document list built each row with `it.innerHTML = \`...${d.name}...\`` in an
   untagged template, interpolating the label directly into markup rather than
   into an attribute. A document named `<img src=x onerror=alert(1)>` became a
   live element the moment the dashboard rendered — no dialog open required. */
test('a hostile document label cannot inject markup into the dashboard document list', async () => {
  const { document, api, cleanup } = await bootApp();
  api.session.current().docs = api.session.current().docs || [];
  api.session.current().docs.push({ id: 'reg-doc', type: 'Insurance', name: '<img src=x onerror=alert(1)>', expiry: '2027-01-01', number: '' });
  api.go('dashboard');
  const view = document.querySelector('#view');
  assert.ok(view.textContent.includes('onerror=alert(1)'), 'the payload never reached #view — this test proves nothing');
  assert.strictEqual(view.querySelectorAll('img[onerror]').length, 0, 'the payload became a live element');
  cleanup();
});

/* Regression for Task 8 (2026-08-19): openGarage's vehicle-list row built each
   item with `it.innerHTML = \`...${vehicleName(c)}...\`` in an untagged
   template, interpolating the nickname/make/model directly into markup. A
   vehicle nicknamed `<img src=x onerror=alert(1)>` became a live element the
   moment the garage switcher opened — the same class of bug as docItem
   (Task 7), one dialog away from the dashboard's. */
test('a hostile vehicle name cannot inject markup into the garage vehicle list', async () => {
  const { document, api, cleanup } = await bootApp();
  api.session.current().car.nickname = '<img src=x onerror=alert(1)>';
  api.openGarage();
  const card = document.querySelector('#modalCard');
  assert.ok(card.textContent.includes('onerror=alert(1)'), 'the payload never reached #modalCard — this test proves nothing');
  assert.strictEqual(card.querySelectorAll('img[onerror]').length, 0, 'the payload became a live element');
  cleanup();
});

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
  if (part.options && part.options[0]) {
    part.options[0].brand = payload;
    part.options[0].partNo = payload;
    part.options[0].store = payload;
    part.options[0].note = payload;
  }

  c.history = c.history || [];
  c.history.push({ id: 'inj-hist', name: payload, icon: '🔧', date: '2026-01-01', odometer: 1000, cost: 10, cat: 'Maintenance', note: payload });

  c.spending = c.spending || [];
  c.spending.push({ id: 'inj-sp', date: '2026-01-01', cat: 'Maintenance', desc: payload, amount: 10, odometer: 1000 });

  c.docs = c.docs || [];
  c.docs.push({ id: 'inj-doc', type: 'Insurance', name: payload, expiry: '2027-01-01', number: payload });
}

for (const [label, payload] of [['attribute breakout', ATTR_PAYLOAD], ['markup injection', MARKUP_PAYLOAD]]) {
  test(`injection sweep (${label}): every route renders the payload as inert text`, async () => {
    const { document, api, evalInApp, cleanup } = await bootApp();
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
    cleanup();
  });

  test(`injection sweep (${label}): every dialog renders the payload as inert text`, async () => {
    const { document, api, cleanup } = await bootApp();
    seedHostileData(api, payload);

    for (const [name, route, invoke] of DIALOGS) {
      if (route) api.go(route);
      invoke(api);
      assertNoAttributeInjection(document.querySelector('#modalCard'), `${name} dialog (${label})`);
      api.closeModal();
    }
    cleanup();
  });
}
