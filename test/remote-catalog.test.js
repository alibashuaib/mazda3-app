'use strict';
const test = require('node:test');
const assert = require('node:assert');
const rc = require('../src/data/remote-catalog.js');

const MODELS = [{ id: 'cx5kf:2.5l-skyactiv-g', model: 'CX-5', generation: 'KF', engine: '2.5L SkyActiv-G', plan_updated_at: '2026-10-15T10:00:00+00:00' }];
const ITEMS = [
  { car_model_id: 'cx5kf:2.5l-skyactiv-g', service: 'Engine Air Filter', interval_km: 40000, interval_months: 24, sort: 3 },
  { car_model_id: 'cx5kf:2.5l-skyactiv-g', service: 'Engine Oil & Filter', interval_km: 9000, interval_months: 12, sort: 0 }
];

function fakeClient(opts) {
  opts = opts || {};
  return { from: table => ({ select: () => {
    const res = Promise.resolve(opts.error
      ? { data: null, error: { message: 'offline' } }
      : { data: table === 'car_models' ? MODELS : ITEMS, error: null });
    res.eq = () => res;
    return res;
  } }) };
}
function memMeta() {
  let meta = {};
  return { metaGet: () => Promise.resolve(meta), metaSet: p => { meta = Object.assign({}, meta, p); return Promise.resolve(true); }, peek: () => meta };
}
function car(planVersion) {
  return { car: { catalogId: 'cx5kf:2.5l-skyactiv-g', planVersion },
    services: [{ name: 'Engine Oil & Filter', normalKm: 10000, normalMonths: 12 }, { name: 'Wheel Alignment', normalKm: 20000 }] };
}

test.beforeEach(() => rc.reset());

test('refresh without a client resolves false', async () => {
  assert.strictEqual(await rc.refresh(), false);
});

test('refresh caches the catalogue in meta and serves plans in sort order', async () => {
  const meta = memMeta();
  rc.configure(Object.assign({ client: fakeClient() }, meta));
  assert.strictEqual(await rc.refresh(), true);
  assert.deepStrictEqual(rc.dealerPlan(MODELS[0].id).map(i => i.service), ['Engine Oil & Filter', 'Engine Air Filter']);
  assert.strictEqual(meta.peek().catalogue.models.length, 1);
});

test('refresh error keeps the previous cache', async () => {
  const meta = memMeta();
  rc.configure(Object.assign({ client: fakeClient() }, meta));
  await rc.refresh();
  rc.configure({ client: fakeClient({ error: true }) });
  assert.strictEqual(await rc.refresh(), false);
  assert.ok(rc.model(MODELS[0].id), 'cache was dropped');
});

test('load restores the cache from meta for offline use', async () => {
  const meta = memMeta();
  rc.configure(Object.assign({ client: fakeClient() }, meta));
  await rc.refresh();
  rc.reset();
  rc.configure(meta);
  assert.strictEqual(await rc.load(), true);
  assert.ok(rc.model(MODELS[0].id));
});

test('applyDealerPlan ignores a car not in the catalogue', async () => {
  rc.configure(Object.assign({ client: fakeClient() }, memMeta()));
  await rc.refresh();
  const d = car(undefined); d.car.catalogId = 'nope';
  assert.strictEqual(rc.applyDealerPlan(d), false);
});

test('first sight only stamps the version, keeping hand-edited intervals', async () => {
  rc.configure(Object.assign({ client: fakeClient() }, memMeta()));
  await rc.refresh();
  const d = car(undefined);
  assert.strictEqual(rc.applyDealerPlan(d), true);
  assert.strictEqual(d.car.planVersion, MODELS[0].plan_updated_at);
  assert.strictEqual(d.services[0].normalKm, 10000);
});

test('force applies the plan to a new car', async () => {
  rc.configure(Object.assign({ client: fakeClient() }, memMeta()));
  await rc.refresh();
  const d = car(undefined);
  rc.applyDealerPlan(d, { force: true });
  assert.strictEqual(d.services[0].normalKm, 9000);
});

test('a newer plan version applies; services the plan lacks are untouched', async () => {
  rc.configure(Object.assign({ client: fakeClient() }, memMeta()));
  await rc.refresh();
  const d = car('2026-10-01T00:00:00+00:00');
  assert.strictEqual(rc.applyDealerPlan(d), true);
  assert.strictEqual(d.services[0].normalKm, 9000);
  assert.strictEqual(d.services[1].normalKm, 20000);
  assert.strictEqual(rc.applyDealerPlan(d), false, 'same version must be a no-op');
});

test('a car with a later planVersion than the cache is left untouched', async () => {
  rc.configure(Object.assign({ client: fakeClient() }, memMeta()));
  await rc.refresh();
  const d = car('2026-10-20T00:00:00+00:00');
  assert.strictEqual(rc.applyDealerPlan(d), false);
  assert.strictEqual(d.services[0].normalKm, 10000);
  assert.strictEqual(d.car.planVersion, '2026-10-20T00:00:00+00:00');
});

test('an unparseable planVersion counts as older and applies', async () => {
  rc.configure(Object.assign({ client: fakeClient() }, memMeta()));
  await rc.refresh();
  const d = car('garbage');
  assert.strictEqual(rc.applyDealerPlan(d), true);
  assert.strictEqual(d.services[0].normalKm, 9000);
});

test('load ignores a malformed stored catalogue', async () => {
  rc.configure({ metaGet: () => Promise.resolve({ catalogue: { models: 'bad' } }) });
  assert.strictEqual(await rc.load(), false);
  assert.strictEqual(rc.applyDealerPlan(car('x')), false);
});
