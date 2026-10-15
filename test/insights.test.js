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
