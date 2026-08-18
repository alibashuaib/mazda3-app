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
