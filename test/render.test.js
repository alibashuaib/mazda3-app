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

   Not used by the hostile-nickname test below, which escapes `<` on purpose. */
function assertHealthyRender(view, label) {
  const h = view.innerHTML;
  assert.ok(h.length > 50, `${label} rendered ${h.length} chars`);
  assert.ok(!h.includes('&lt;'), `${label} contains escaped markup — a raw()/html\`\` conversion lost an interpolation`);
  assert.ok(!h.includes('[object Object]'), `${label} stringified an object into the markup`);
  assert.ok(view.querySelectorAll('svg').length > 0, `${label} rendered no <svg> — its icons were escaped or dropped`);
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
