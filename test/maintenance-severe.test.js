'use strict';
/* Service detail shows dealer normal and severe intervals as separate rows (D-09, SCH-02). */
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

const rows = app => [...app.document.querySelectorAll('#modalCard .detail-row')].map(r => r.textContent);
async function detail(patch) {
  const app = await bootApp();
  const s = app.api.session.current().services[0];
  delete s.severeKm; delete s.severeMonths;
  Object.assign(s, patch);
  app.api.openServiceDetail(s);
  return app;
}

test('severe interval gets its own row next to Interval', async () => {
  const app = await detail({ severeKm: 5000, severeMonths: 6 });
  try {
    const r = rows(app);
    assert.ok(r.some(x => /^Interval/.test(x)), r.join('|'));
    assert.ok(r.some(x => /^Severe5,?000 km \/ 6 mo$/.test(x)), r.join('|'));
  } finally { app.cleanup(); }
});

test('no severe data renders no Severe row', async () => {
  const app = await detail({});
  try { assert.ok(!rows(app).some(x => /^Severe/.test(x))); } finally { app.cleanup(); }
});

test('severe text is escaped', async () => {
  const app = await detail({ severeKm: 0, severeMonths: '<img src=x onerror=1>' });
  try {
    assert.strictEqual(app.document.querySelector('#modalCard img'), null);
    assert.ok(rows(app).some(x => x.includes('<img src=x')));
  } finally { app.cleanup(); }
});
