'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

const ROUTES = ['dashboard', 'maintenance', 'parts', 'fuel', 'budget', 'reports'];

test('the app boots without throwing and lands on the dashboard', async () => {
  const { document, cleanup } = await bootApp();
  assert.ok(document.querySelector('#view').innerHTML.length > 100, 'the dashboard rendered nothing');
  cleanup();
});

/* One test per tab. Phase 3a shipped five ReferenceErrors that blanked four of
   these six pages, with a fully green suite, because nothing rendered them. */
for (const route of ROUTES) {
  test(`the ${route} page renders without throwing`, async () => {
    const { document, api, cleanup } = await bootApp();
    api.go(route);
    const view = document.querySelector('#view');
    assert.ok(view.innerHTML.length > 50, `${route} rendered ${view.innerHTML.length} chars`);
    cleanup();
  });
}

test('every page renders in Arabic too', async () => {
  const { document, api, cleanup } = await bootApp({ lang: 'ar' });
  for (const route of ROUTES) {
    api.go(route);
    assert.ok(document.querySelector('#view').innerHTML.length > 50, `${route} failed in Arabic`);
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
  assert.ok(document.querySelector('#view').innerHTML.length > 50);
  cleanup();
});

test('all three report types render', async () => {
  const { document, api, evalInApp, cleanup } = await bootApp();
  for (const type of ['service', 'purchases', 'summary']) {
    evalInApp(`reportType = ${JSON.stringify(type)}`);
    api.go('reports');
    assert.ok(document.querySelector('#view').innerHTML.length > 50, `${type} report failed`);
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
