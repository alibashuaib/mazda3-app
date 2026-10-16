'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ins = require('../src/data/insights.js');

test('band floors to 5,000 km', () => {
  assert.strictEqual(ins.band(0), 0);
  assert.strictEqual(ins.band(4999), 0);
  assert.strictEqual(ins.band(52300), 50000);
});

test('monthOf keeps YYYY-MM only', () => {
  assert.strictEqual(ins.monthOf('2026-08-17'), '2026-08');
});

test('fuelContribution emits an anonymous row, no raw date/odometer/cost', () => {
  const e = { id: 'f1', date: '2026-08-17', odometer: 52300, litres: 40, cost: 92 };
  const row = ins.fuelContribution({ modelId: 'mazda3bm', engine: 'SkyActiv-G', vehicleId: 'v1', entry: e, l100: 8.1234 });
  assert.deepStrictEqual(row, {
    source_key: 'fuel:v1:f1', kind: 'fuel', model_id: 'mazda3bm', engine: 'SkyActiv-G',
    odometer_band: 50000, month: '2026-08', l100: 8.12, price_per_l: 2.3
  });
  for (const k of ['date', 'odometer', 'cost', 'litres', 'vehicle_id', 'nickname', 'notes']) assert.ok(!(k in row));
});

test('fuelContribution rejects implausible or missing economy', () => {
  const e = { id: 'f1', date: '2026-08-17', odometer: 1000, litres: 40, cost: 90 };
  assert.strictEqual(ins.fuelContribution({ modelId: 'm', vehicleId: 'v', entry: e, l100: 0.5 }), null);
  assert.strictEqual(ins.fuelContribution({ modelId: 'm', vehicleId: 'v', entry: e, l100: 41 }), null);
  assert.strictEqual(ins.fuelContribution({ modelId: 'm', vehicleId: 'v', entry: Object.assign({}, e, { litres: 0 }), l100: 8 }), null);
  assert.strictEqual(ins.fuelContribution({ modelId: 'm', vehicleId: 'v', entry: e, l100: null }), null);
});

test('fuelContribution source_key stable so edit updates, not duplicates', () => {
  const mk = lit => ins.fuelContribution({ modelId: 'm', vehicleId: 'v', l100: 8,
    entry: { id: 'f1', date: '2026-08-17', odometer: 1000, litres: lit, cost: 90 } });
  assert.strictEqual(mk(40).source_key, mk(41).source_key);
});

const hist = (id, odo, parts) => ({ id, date: '2026-01-01', odometer: odo, parts });

test('partContributions computes km since previous replacement of same part', () => {
  const rows = ins.partContributions({ modelId: 'mazda3bm', vehicleId: 'v1',
    historyEntry: hist('h2', 60000, [{ part: 'Brake pads', brand: 'Bosch', price: 180 }]),
    priorHistory: [hist('h1', 15000, [{ part: 'Brake pads', brand: 'OEM', price: 300 }])] });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].km_since_prev, 45000);
  assert.strictEqual(rows[0].item_key, 'brake pads');
  assert.strictEqual(rows[0].source_key, 'part:v1:h2:brake pads');
  assert.strictEqual(rows[0].odometer_band, 60000);
});

test('partContributions: no earlier replacement -> km_since_prev null, still contributed', () => {
  const rows = ins.partContributions({ modelId: 'm', vehicleId: 'v',
    historyEntry: hist('h1', 30000, [{ part: 'Oil filter', price: 25 }]), priorHistory: [] });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].km_since_prev, undefined);
  assert.ok(!('engine' in rows[0]));
});

test('partContributions skips parts with no price and ignores prior entries at or after this odometer', () => {
  const rows = ins.partContributions({ modelId: 'm', vehicleId: 'v',
    historyEntry: hist('h2', 20000, [{ part: 'A', brand: 'x', price: 0 }, { part: 'B', brand: 'y', price: 10 }]),
    priorHistory: [hist('h3', 20000, [{ part: 'B', brand: 'y', price: 9 }])] });
  assert.deepStrictEqual(rows.map(r => r.item_key), ['b']);
  assert.strictEqual(rows[0].km_since_prev, undefined);
});

test('partContributions uses the latest earlier entry', () => {
  const rows = ins.partContributions({ modelId: 'm', vehicleId: 'v',
    historyEntry: hist('h3', 60000, [{ part: 'Plugs', price: 9 }]),
    priorHistory: [hist('h1', 20000, [{ part: 'Plugs', price: 9 }]), hist('h2', 45000, [{ part: 'Plugs', price: 9 }])] });
  assert.strictEqual(rows[0].km_since_prev, 15000);
});

test('predictNext gives range and status', () => {
  const life = { p25_km: 45000, p75_km: 60000 };
  assert.deepStrictEqual(ins.predictNext(life, 15000, 40000),
    { fromKm: 60000, toKm: 75000, usedKm: 25000, status: 'early' });
  assert.strictEqual(ins.predictNext(life, 15000, 70000).status, 'inRange');
  assert.strictEqual(ins.predictNext(life, 15000, 80000).status, 'overdue');
});

test('fuelContribution: zero cost gives null price_per_l; positive cost is rounded', () => {
  const e = { id: 'f1', date: '2026-08-17', odometer: 1000, litres: 40, cost: 0 };
  assert.strictEqual(ins.fuelContribution({ modelId: 'm', vehicleId: 'v', entry: e, l100: 8 }).price_per_l, null);
  assert.strictEqual(ins.fuelContribution({ modelId: 'm', vehicleId: 'v', entry: Object.assign({}, e, { cost: 92 }), l100: 8 }).price_per_l, 2.3);
});

test('fuelContribution: negative or non-finite odometer -> null', () => {
  for (const odometer of [-1, NaN, Infinity, undefined]) {
    const e = { id: 'f1', date: '2026-08-17', odometer, litres: 40, cost: 90 };
    assert.strictEqual(ins.fuelContribution({ modelId: 'm', vehicleId: 'v', entry: e, l100: 8 }), null);
  }
});

function metaStore() {
  let m = {};
  return { metaGet: () => Promise.resolve(m), metaSet: p => { m = Object.assign({}, m, p); return Promise.resolve(true); } };
}

test.beforeEach(() => ins.reset());

test('sharing defaults to on and the notice to unseen', async () => {
  ins.configure(metaStore());
  assert.strictEqual(await ins.shareEnabled(), true);
  assert.strictEqual(await ins.noticeSeen(), false);
  await ins.markNoticeSeen();
  assert.strictEqual(await ins.noticeSeen(), true);
});

test('turning sharing off persists and deletes past contributions', async () => {
  const calls = [];
  ins.configure(Object.assign(metaStore(), { client: { rpc: (fn, args) => { calls.push([fn, args]); return Promise.resolve({ data: 3, error: null }); } } }));
  await ins.setShare(false);
  assert.strictEqual(await ins.shareEnabled(), false);
  assert.deepStrictEqual(calls, [['delete_my_contributions', undefined]]);
});

test('submit sends rows through the RPC and reports success', async () => {
  let sent;
  ins.configure({ client: { rpc: (fn, args) => { sent = [fn, args]; return Promise.resolve({ data: 1, error: null }); } } });
  assert.strictEqual(await ins.submit([{ source_key: 'k' }]), true);
  assert.deepStrictEqual(sent, ['submit_contributions', { rows: [{ source_key: 'k' }] }]);
});

test('submit returns false on RPC error or without a client, never throws', async () => {
  assert.strictEqual(await ins.submit([{}]), false);
  ins.configure({ client: { rpc: () => Promise.resolve({ data: null, error: new Error('x') }) } });
  assert.strictEqual(await ins.submit([{}]), false);
  ins.configure({ client: { rpc: () => Promise.reject(new Error('offline')) } });
  assert.strictEqual(await ins.submit([{}]), false);
});

test('getFuelStats and getBrandLife return rows, or [] on error/unavailable', async () => {
  assert.deepStrictEqual(await ins.getFuelStats('m'), []);
  const rows = [{ n: 6 }];
  const q = table => ({ select: () => ({ eq: () => { const r = Promise.resolve({ data: rows, error: null });
    r.eq = () => Promise.resolve({ data: rows, error: null }); return r; } }) });
  ins.configure({ client: { from: q } });
  assert.deepStrictEqual(await ins.getFuelStats('m'), rows);
  assert.deepStrictEqual(await ins.getBrandLife('m', 'brake pads'), rows);
  ins.configure({ client: { from: () => { throw new Error('boom'); } } });
  assert.deepStrictEqual(await ins.getFuelStats('m'), []);
});

const okClient = calls => ({ rpc: (fn, args) => { calls.push([fn, args]); return Promise.resolve({ data: 1, error: null }); } });

test('opt-out offline: resolves false, stays off, delete stays pending', async () => {
  const store = metaStore();
  ins.configure(store);
  assert.strictEqual(await ins.setShare(false), false);
  assert.strictEqual(await ins.shareEnabled(), false);
  assert.strictEqual((await store.metaGet()).insightsDeletePending, true);
});

test('opt-out with a rejecting RPC: resolves false and delete stays pending', async () => {
  const store = metaStore();
  ins.configure(Object.assign(store, { client: { rpc: () => Promise.reject(new Error('offline')) } }));
  assert.strictEqual(await ins.setShare(false), false);
  assert.strictEqual(await ins.shareEnabled(), false);
  assert.strictEqual((await store.metaGet()).insightsDeletePending, true);
});

test('successful opt-out delete clears the pending flag; opting in leaves it alone', async () => {
  const store = metaStore();
  ins.configure(Object.assign(store, { client: okClient([]) }));
  assert.strictEqual(await ins.setShare(false), true);
  assert.strictEqual((await store.metaGet()).insightsDeletePending, false);
  await store.metaSet({ insightsDeletePending: true });
  assert.strictEqual(await ins.setShare(true), true);
  assert.strictEqual((await store.metaGet()).insightsDeletePending, true);
});

test('flushPendingDelete retries a failed delete once a client works', async () => {
  const store = metaStore();
  ins.configure(store);
  await ins.setShare(false);
  assert.strictEqual(await ins.flushPendingDelete(), false);
  assert.strictEqual((await store.metaGet()).insightsDeletePending, true);
  const calls = [];
  ins.configure({ client: okClient(calls) });
  assert.strictEqual(await ins.flushPendingDelete(), true);
  assert.strictEqual((await store.metaGet()).insightsDeletePending, false);
  assert.deepStrictEqual(calls, [['delete_my_contributions', undefined]]);
});

test('flushPendingDelete with nothing pending makes no call', async () => {
  const calls = [];
  ins.configure(Object.assign(metaStore(), { client: okClient(calls) }));
  assert.strictEqual(await ins.flushPendingDelete(), true);
  assert.deepStrictEqual(calls, []);
});

test('fuelContribution composes from a real full-to-full pair', () => {
  const a = { id: 'a', date: '2026-07-01', odometer: 10000, litres: 40, cost: 90, full: true };
  const b = { id: 'b', date: '2026-07-20', odometer: 10500, litres: 41, cost: 94, full: true };
  const l100 = b.litres / (b.odometer - a.odometer) * 100;
  const row = ins.fuelContribution({ modelId: 'mazda3bm', vehicleId: 'v', entry: b, l100 });
  assert.strictEqual(row.l100, 8.2);
  assert.strictEqual(row.odometer_band, 10000);
  assert.strictEqual(ins.fuelContribution({ modelId: 'mazda3bm', vehicleId: 'v', entry: a, l100: null }), null);
});

test('fuelInsight picks the user\'s band, else the nearest, and null with no data', () => {
  const rows = [{ odometer_band: 50000, median_l100: 8.4, p25_l100: 7.9, p75_l100: 9.1 },
                { odometer_band: 100000, median_l100: 9.0, p25_l100: 8.2, p75_l100: 9.8 }];
  assert.strictEqual(ins.fuelInsight(rows, 52300, 7.8).typical, 8.4);
  assert.strictEqual(ins.fuelInsight(rows, 52300, 7.8).diff, -0.6);
  assert.strictEqual(ins.fuelInsight(rows, 90000, null).typical, 9.0);
  assert.strictEqual(ins.fuelInsight(rows, 90000, null).diff, null);
  assert.strictEqual(ins.fuelInsight([], 52300, 7.8), null);
});

test('partInsight chooses the longest-lasting brand and predicts the next change', () => {
  const rows = [
    { brand: 'Bosch', median_km: 55000, p25_km: 45000, p75_km: 60000, median_price: 180, n: 8 },
    { brand: 'Cheap', median_km: 30000, p25_km: 25000, p75_km: 35000, median_price: 90, n: 9 }];
  const out = ins.partInsight(rows, 15000, 52000);
  assert.strictEqual(out.best.brand, 'Bosch');
  assert.strictEqual(out.prediction.status, 'early');
  assert.strictEqual(ins.partInsight(rows, null, 52000).prediction, null);
  assert.strictEqual(ins.partInsight([], 15000, 52000), null);
});

test('contributions with a malformed month are skipped; partInsight coerces numeric strings', () => {
  const entry = { id: 'e', litres: 40, odometer: 1000, cost: 80, date: '2026-13-01' };
  assert.strictEqual(ins.fuelContribution({ modelId: 'm', vehicleId: 'v', entry, l100: 8 }), null);
  assert.deepStrictEqual(ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: { id: 'h', odometer: 1, date: 'bad', parts: [{ part: 'x', price: 5 }] }, priorHistory: [] }), []);
  const out = ins.partInsight([{ brand: 'B', median_km: '55000', p25_km: '45000', p75_km: '60000', median_price: 1, n: 5 }], 1000, 52000);
  assert.strictEqual(out.prediction.fromKm, 46000);
});

function prefsClient(row, saved) {
  return {
    rpc: () => Promise.resolve({ data: 0, error: null }),
    from: () => ({
      select: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }),
      upsert: v => { saved.push(v); return Promise.resolve({ error: null }); }
    })
  };
}

test('syncPrefs: server opt-out wins over fresh local defaults and re-queues the delete', async () => {
  const store = metaStore();
  ins.configure(Object.assign(store, { client: prefsClient({ share: false, notice_seen: true }, []) }));
  assert.strictEqual(await ins.syncPrefs(), true);
  assert.strictEqual(await ins.shareEnabled(), false);
  assert.strictEqual(await ins.noticeSeen(), true);
  assert.strictEqual((await store.metaGet()).insightsDeletePending, true);
});

test('syncPrefs: no server row pushes local prefs; setShare pushes the change', async () => {
  const saved = [];
  ins.configure(Object.assign(metaStore(), { client: prefsClient(null, saved) }));
  await ins.syncPrefs();
  assert.deepStrictEqual(saved.map(s => [s.share, s.notice_seen]), [[true, false]]);
  await ins.setShare(false);
  assert.strictEqual(saved[saved.length - 1].share, false);
});

test('syncPrefs without a client resolves false and changes nothing', async () => {
  ins.configure(metaStore());
  assert.strictEqual(await ins.syncPrefs(), false);
  assert.strictEqual(await ins.shareEnabled(), true);
});

test('partContributions adds shop_id only when a shop was resolved', () => {
  const h = { id: 'h1', date: '2026-08-17', odometer: 52300, parts: [{ part: 'Oil Filter', brand: 'Bosch', price: 40 }] };
  const without = ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: h, priorHistory: [] });
  assert.strictEqual('shop_id' in without[0], false);
  const withShop = ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: h, priorHistory: [], shopId: 'shop-1' });
  assert.strictEqual(withShop[0].shop_id, 'shop-1');
  assert.strictEqual(ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: h, priorHistory: [], shopId: '' })[0].shop_id, undefined);
});
