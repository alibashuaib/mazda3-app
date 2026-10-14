'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');
const { buildProfile, normalizeData } = require('../src/data/normalize.js');

function stub(planVersion, oilKm) {
  return { createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
    from: table => ({ select: () => {
      const id = 'mazda3bm:2.0l-skyactiv-g';
      const res = Promise.resolve({ error: null, data: table === 'car_models'
        ? [{ id, model: '3', generation: 'BM', engine: '2.0L SkyActiv-G', plan_updated_at: planVersion }]
        : [{ car_model_id: id, service: 'Engine Oil & Filter', interval_km: oilKm, interval_months: 12, sort: 0 }] });
      res.eq = () => res;
      return res;
    } })
  }) };
}

async function until(fn) {
  const deadline = Date.now() + 2000;
  while (!fn() && Date.now() < deadline) await new Promise(r => setImmediate(r));
  return fn();
}

test('a newer dealer plan reaches an existing car after boot', async () => {
  const data = normalizeData(buildProfile('mazda3bm', 0, { odometer: 0 }));
  data.car.planVersion = '2026-10-01T00:00:00+00:00';
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub('2026-10-15T10:00:00+00:00', 9000), vehicles: [{ id: 'car1', data }] });
  try {
    assert.ok(await until(() => app.api.session.current().car.planVersion === '2026-10-15T10:00:00+00:00'), 'plan never applied');
    const oil = app.api.session.current().services.find(s => s.name === 'Engine Oil & Filter');
    assert.strictEqual(oil.normalKm, 9000);
  } finally { app.cleanup(); }
});

test('with no backend the app boots exactly as before', async () => {
  const app = await bootApp();
  try {
    assert.strictEqual(app.api.remoteCatalog.model('mazda3bm:2.0l-skyactiv-g'), null);
  } finally { app.cleanup(); }
});
