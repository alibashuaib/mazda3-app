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

test('successful opt-out delete clears the pending flag; opting in finishes a pending delete first', async () => {
  const store = metaStore(), calls = [];
  ins.configure(Object.assign(store, { client: okClient(calls) }));
  assert.strictEqual(await ins.setShare(false), true);
  assert.strictEqual((await store.metaGet()).insightsDeletePending, false);
  await store.metaSet({ insightsDeletePending: true });
  calls.length = 0;
  assert.strictEqual(await ins.setShare(true), true);
  assert.deepStrictEqual(calls, [['delete_my_contributions', undefined]]);
  assert.strictEqual((await store.metaGet()).insightsDeletePending, false);
  assert.strictEqual(await ins.shareEnabled(), true);
});

/* A client whose insights_prefs table records every upsert and can be held open. */
function heldPrefsClient(server) {
  const sent = [];
  return { sent, client: {
    rpc: () => Promise.resolve({ data: 1, error: null }),
    from: () => ({
      upsert: row => { sent.push(row); if (server.hold) return server.hold.then(() => ({ error: server.fail ? { message: 'x' } : null })); return Promise.resolve({ error: server.fail ? { message: 'x' } : null }); },
      select: () => ({ maybeSingle: () => Promise.resolve({ data: server.row || null, error: null }) })
    })
  } };
}

test('opt-in with a pending delete that cannot run stays off and never pushes share=true', async () => {
  const store = metaStore();
  const pc = heldPrefsClient({});
  pc.client.rpc = () => Promise.reject(new Error('offline'));
  ins.configure(Object.assign(store, { client: pc.client }));
  await store.metaSet({ insightsShare: false, insightsDeletePending: true });
  assert.strictEqual(await ins.setShare(true), false);
  assert.strictEqual(await ins.shareEnabled(), false);
  assert.ok(!pc.sent.some(r => r.share === true), 'pushed share=true before the delete completed');
});

test('an offline opt-out survives the next sync: local change wins over the server row', async () => {
  const store = metaStore();
  const server = { fail: true, row: { share: true, notice_seen: true } };
  const pc = heldPrefsClient(server);
  ins.configure(Object.assign(store, { client: pc.client }));
  await ins.setShare(false);                          // prefs push fails
  assert.strictEqual((await store.metaGet()).insightsPrefsPending, true);
  server.fail = false;
  assert.strictEqual(await ins.syncPrefs(), true);
  assert.strictEqual(await ins.shareEnabled(), false, 'server share=true overwrote the local opt-out');
  assert.strictEqual(pc.sent[pc.sent.length - 1].share, false, 'the opt-out was not pushed');
  assert.strictEqual((await store.metaGet()).insightsPrefsPending, false);
});

test('a push acknowledged after a newer change leaves that change pending', async () => {
  const store = metaStore();
  let release; const server = { hold: new Promise(r => { release = r; }) };
  const pc = heldPrefsClient(server);
  ins.configure(Object.assign(store, { client: pc.client }));
  const first = ins.markNoticeSeen();                 // push in flight, held
  await new Promise(r => setImmediate(r));
  await store.metaSet({ insightsShare: false, insightsPrefsRev: 99, insightsPrefsPending: true });   // newer local change
  release();
  await first;
  assert.strictEqual((await store.metaGet()).insightsPrefsPending, true, 'older ack cleared a newer change');
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

/* ---- getBrandLife read cache ---- */
function lifeClient(results) {
  const q = results.slice(), log = [];
  return { log, from: t => { log.push(t); const r = q.length ? q.shift() : { data: [], error: null };
    const o = { select: () => o, eq: () => o, then: (a, b) => Promise.resolve(r).then(a, b) }; return o; } };
}

test('getBrandLife: cached per (model, item), in-flight shared, failures and empty-from-error not cached', async t => {
  const rows = [{ n: 6 }];
  const c = lifeClient([{ data: null, error: { message: 'x' } }, { data: rows, error: null }, { data: [{ n: 9 }], error: null }]);
  ins.configure({ client: c });
  assert.deepStrictEqual(await ins.getBrandLife('m', 'pads'), []);          // failure
  const [a, b] = await Promise.all([ins.getBrandLife('m', 'pads'), ins.getBrandLife('m', 'pads')]);
  assert.deepStrictEqual(a, rows); assert.deepStrictEqual(b, rows);
  assert.strictEqual(c.log.length, 2, 'failure retried once, then one shared request');
  assert.deepStrictEqual(await ins.getBrandLife('m', 'pads'), rows);
  assert.strictEqual(c.log.length, 2, 'cached');
  assert.deepStrictEqual(await ins.getBrandLife('m', 'oil'), [{ n: 9 }]);   // other key
  assert.strictEqual(c.log.length, 3);
});

test('getBrandLife: TTL expiry and reset() both force a refetch', async t => {
  let now = 1e12;
  t.mock.method(Date, 'now', () => now);
  const c = lifeClient([]);
  ins.configure({ client: c });
  await ins.getBrandLife('m', 'pads');
  now += 5 * 60 * 1000 - 1;
  await ins.getBrandLife('m', 'pads');
  assert.strictEqual(c.log.length, 1);
  now += 2;
  await ins.getBrandLife('m', 'pads');
  assert.strictEqual(c.log.length, 2);
  ins.reset();
  ins.configure({ client: c });
  await ins.getBrandLife('m', 'pads');
  assert.strictEqual(c.log.length, 3);
});

test('getBrandLife: clearCache() forces a refetch', async () => {
  const c = lifeClient([]);
  ins.configure({ client: c });
  await ins.getBrandLife('m', 'pads');
  ins.clearCache();
  await ins.getBrandLife('m', 'pads');
  assert.strictEqual(c.log.length, 2);
});

/* ---- repair vs replace ---- */
const H = (id, odometer, parts) => ({ id, date: '2026-01-10', odometer, parts });
const PC = (entry, priorHistory) => ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: entry, priorHistory });

test('legacy parts without action contribute replaced, exactly as before', () => {
  const [r] = PC(H('h1', 52300, [{ part: 'Oil Filter', brand: 'Bosch', price: 40 }]), []);
  assert.strictEqual(r.action, 'replaced');
  assert.strictEqual('finding' in r, false);
  assert.strictEqual('km_since_repair' in r, false);
});

test('life counts last replacement; repairs and inspections never reset it', () => {
  const prior = [
    H('a', 40000, [{ part: 'Bumper', price: 500 }]),
    H('b', 60000, [{ part: 'Bumper', price: 120, action: 'repaired' }]),
    H('c', 70000, [{ part: 'Bumper', action: 'inspected' }])];
  const rep = PC(prior[1], [prior[0]]);
  assert.strictEqual(rep[0].km_since_prev, 20000);
  assert.strictEqual('km_since_repair' in rep[0], false);
  const [r] = PC(H('d', 90000, [{ part: 'Bumper', price: 520 }]), prior);
  assert.strictEqual(r.km_since_prev, 50000);
  assert.strictEqual(r.km_since_repair, 30000);
});

test('a repair older than the last replacement gives no km_since_repair', () => {
  const prior = [
    H('a', 20000, [{ part: 'Bumper', price: 100, action: 'repaired' }]),
    H('b', 40000, [{ part: 'Bumper', price: 500 }])];
  const [r] = PC(H('d', 90000, [{ part: 'Bumper', price: 520 }]), prior);
  assert.strictEqual(r.km_since_prev, 50000);
  assert.strictEqual('km_since_repair' in r, false);
});

test('inspections may carry no price and a finding; bad actions fall back to replaced', () => {
  const rows = PC(H('h1', 50000, [
    { part: 'Brake Pads', action: 'inspected', finding: 'attention' },
    { part: 'Wipers', action: 'destroyed', price: 30 },
    { part: 'Mirror', action: 'repaired' },
    { part: 'Bulb', action: 'replaced', finding: 'ok', price: 9 }]), []);
  const by = k => rows.find(r => r.item_key === k);
  assert.deepStrictEqual([by('brake pads').action, by('brake pads').finding, by('brake pads').price], ['inspected', 'attention', null]);
  assert.strictEqual(by('wipers').action, 'replaced');
  assert.strictEqual(by('mirror'), undefined);
  assert.strictEqual('finding' in by('bulb'), false);
  const [nf] = PC(H('h2', 50000, [{ part: 'Belt', action: 'inspected' }]), []);
  assert.strictEqual('finding' in nf, false);
});

test('repairInsight needs enough repair/replace samples and reports shares', () => {
  const row = { n_replaced: 6, n_repaired: 4, n_inspected: 3, median_price_replaced: '540.00', median_price_repaired: '120.00', median_km_after_repair: 30000, attention_share: '0.667' };
  assert.deepStrictEqual(ins.repairInsight([row]), { share: 40, nRepaired: 4, nReplaced: 6, priceRepaired: 120, priceReplaced: 540, kmAfterRepair: 30000, attention: 67, nInspected: 3 });
  assert.strictEqual(ins.repairInsight([{ ...row, n_replaced: 2, n_repaired: 1 }]).share, null);
  assert.strictEqual(ins.repairInsight([]), null);
  assert.strictEqual(ins.repairInsight([{ ...row, n_inspected: 0, attention_share: null }]).attention, null);
});

test('getRepairStats returns rows, [] on error, and is cached until clearCache', async () => {
  let calls = 0;
  const client = { from: () => { calls++; return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [{ n_repaired: 1 }], error: null }) }) }) }; } };
  ins.configure({ client });
  assert.strictEqual((await ins.getRepairStats('m', 'k')).length, 1);
  await ins.getRepairStats('m', 'k');
  assert.strictEqual(calls, 1);
  ins.clearCache();
  await ins.getRepairStats('m', 'k');
  assert.strictEqual(calls, 2);
  ins.configure({ client: { from: () => { throw new Error('boom'); } } });
  ins.clearCache();
  assert.deepStrictEqual(await ins.getRepairStats('m', 'k'), []);
});

test('getRepairStats and getBrandLife caches do not collide on same (model, item)', async () => {
  const mk = tag => ({ from: t => { const o = { select: () => o, eq: () => o, then: (a, b) => Promise.resolve({ data: [{ t }], error: null }).then(a, b) }; return o; } });
  ins.configure({ client: mk() });
  assert.deepStrictEqual(await ins.getBrandLife('m', 'k'), [{ t: 'brand_life' }]);
  assert.deepStrictEqual(await ins.getRepairStats('m', 'k'), [{ t: 'repair_stats' }]);
});

test('repairMode: community only when a share exists (inspections never count)', () => {
  const rows = (rep, repl, insp) => ins.repairInsight([{ n_repaired: rep, n_replaced: repl, n_inspected: insp, median_price_repaired: 1, median_price_replaced: 2, median_km_after_repair: null, attention_share: 0.5 }]);
  assert.strictEqual(ins.repairMode(rows(2, 3, 0)), 'community');
  assert.strictEqual(ins.repairMode(rows(2, 2, 0)), 'none');
  assert.strictEqual(ins.repairMode(null), 'none');
  assert.strictEqual(ins.repairMode(rows(0, 0, 5)), 'none');
});

test('repairInsight rounds median prices to whole SAR', () => {
  const info = ins.repairInsight([{ n_repaired: 4, n_replaced: 6, n_inspected: 0, median_price_repaired: '333.33', median_price_replaced: '540.5', median_km_after_repair: null, attention_share: null }]);
  assert.strictEqual(info.priceRepaired, 333); assert.strictEqual(info.priceReplaced, 541);
});

test('model-wide stats make one query for all items and cache it', async () => {
  const calls = [];
  const client = { from: t => { const c = { eqs: [] }; calls.push([t, c.eqs]); const p = Promise.resolve({ data: [{ item_key: 'a' }], error: null });
    const q = { then: p.then.bind(p), catch: p.catch.bind(p), select: () => q, eq: (k, v) => { c.eqs.push(k); return q; } }; return q; } };
  ins.configure({ client });
  await ins.getModelBrandLife('m1'); await ins.getModelBrandLife('m1');
  const r = await ins.getModelRepairStats('m1');
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(calls.map(c => c[0]), ['brand_life', 'repair_stats']);
  assert.deepStrictEqual(calls[0][1], ['model_id'], 'no item_key filter');
  ins.reset();
});

test('signed out: no community request leaves the app, signed in: they do', async () => {
  let calls = 0, signedIn = false;
  const client = { from: () => { calls++; const p = Promise.resolve({ data: [], error: null }); const q = { then: p.then.bind(p), catch: p.catch.bind(p), select: () => q, eq: () => q }; return q; }, rpc: () => { calls++; return Promise.resolve({ error: null }); } };
  ins.configure({ client, signedIn: () => signedIn });
  assert.strictEqual(ins.available(), false);
  assert.deepStrictEqual(await ins.getBrandLife('m', 'k'), []);
  assert.deepStrictEqual(await ins.getModelRepairStats('m'), []);
  assert.deepStrictEqual(await ins.getFuelStats('m'), []);
  assert.strictEqual(await ins.submit([{}]), false);
  assert.strictEqual(calls, 0);
  signedIn = true;
  assert.strictEqual(ins.available(), true);
  await ins.getBrandLife('m', 'k');
  assert.strictEqual(calls, 1);
  ins.reset();
});

test('lastReplacement ignores repairs and inspections; a part with no action counts as replaced', () => {
  const h = [
    { id: 'a', odometer: 20000, parts: [{ part: 'Brake Pads' }] },
    { id: 'b', odometer: 80000, parts: [{ part: 'brake pads', action: 'inspected', finding: 'ok' }] },
    { id: 'c', odometer: 60000, parts: [{ part: 'Brake pads', action: 'repaired', price: 50 }] }
  ];
  assert.strictEqual(ins.lastReplacement(h, 'Brake Pads').id, 'a');
  h.push({ id: 'd', odometer: 70000, parts: [{ part: 'Brake Pads', action: 'replaced', price: 300 }] });
  assert.strictEqual(ins.lastReplacement(h, 'brake pads').id, 'd');
  assert.strictEqual(ins.lastReplacement(h, 'Wipers'), null);
});

test('brand life credits the part taken out, not the one put in', () => {
  const prior = [{ id: 'h1', date: '2026-01-05', odometer: 10000, parts: [{ part: 'Brake pads', brand: 'A', price: 200 }] }];
  const now = { id: 'h2', date: '2026-06-05', odometer: 40000, parts: [{ part: 'Brake pads', brand: 'B', price: 260 }] };
  const [row] = ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: now, priorHistory: prior });
  assert.strictEqual(row.km_since_prev, 30000);
  assert.strictEqual(row.prev_brand, 'A');
  assert.strictEqual(row.prev_price, 200);
  assert.strictEqual(row.brand, 'B', 'the new purchase stays its own price observation');
  assert.strictEqual(row.price, 260);
});

test('no brand is credited when the removed part has none', () => {
  const prior = [{ id: 'h1', date: '2026-01-05', odometer: 10000, parts: [{ part: 'Brake pads', price: 200 }] }];
  const now = { id: 'h2', date: '2026-06-05', odometer: 40000, parts: [{ part: 'Brake pads', brand: 'B', price: 260 }] };
  const [row] = ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: now, priorHistory: prior });
  assert.strictEqual(row.prev_brand, undefined, 'brand_life skips rows without prev_brand');
  assert.strictEqual(row.prev_price, 200);
});

test('opting out takes effect locally at once, even behind a stalled earlier request', async () => {
  const store = metaStore();
  let release; const server = { hold: new Promise(r => { release = r; }) };
  const pc = heldPrefsClient(server);
  ins.configure(Object.assign(store, { client: pc.client }));
  const stalled = ins.markNoticeSeen();
  await new Promise(r => setImmediate(r));
  const off = ins.setShare(false);
  await new Promise(r => setImmediate(r));
  assert.strictEqual(await ins.shareEnabled(), false, 'still sharing while the earlier push hangs');
  assert.strictEqual((await store.metaGet()).insightsDeletePending, true);
  release(); await stalled; await off;
});

test('a job queued by one account does nothing once another account is signed in', async () => {
  const store = metaStore(), calls = [];
  let user = 'A', release; const gate = new Promise(r => { release = r; });
  const pc = heldPrefsClient({ hold: gate });
  pc.client.rpc = (fn) => { calls.push([user, fn]); return Promise.resolve({ data: 1, error: null }); };
  ins.configure(Object.assign(store, { client: pc.client, userId: () => user }));
  const held = ins.markNoticeSeen();                  // A's push, held
  await new Promise(r => setImmediate(r));
  const off = ins.setShare(false);                    // A's opt-out queued behind it
  user = 'B';                                         // A signs out, B signs in
  release(); await held; await off;
  assert.deepStrictEqual(calls, [], 'A\'s queued delete ran with B signed in');
});

test('a write the server refuses for consent (-1) is not reported as success', async () => {
  ins.configure({ client: { rpc: () => Promise.resolve({ data: -1, error: null }) } });
  assert.strictEqual(await ins.syncVehicle('v', []), false);
  assert.strictEqual(await ins.submit([{}]), false);
  ins.configure({ client: { rpc: () => Promise.resolve({ data: 0, error: null }) } });
  assert.strictEqual(await ins.syncVehicle('v', []), true, 'an empty set is a real success');
});

test('pushPendingPrefs retries only an unacknowledged change', async () => {
  const store = metaStore();
  const pc = heldPrefsClient({});
  ins.configure(Object.assign(store, { client: pc.client }));
  assert.strictEqual(await ins.pushPendingPrefs(), true);
  assert.strictEqual(pc.sent.length, 0);
  await store.metaSet({ insightsShare: true, insightsPrefsPending: true, insightsPrefsRev: 3 });
  assert.strictEqual(await ins.pushPendingPrefs(), true);
  assert.strictEqual(pc.sent.length, 1);
  assert.strictEqual((await store.metaGet()).insightsPrefsPending, false);
});

test('marking the notice seen never writes share, so it cannot undo an opt-out made elsewhere', async () => {
  const store = metaStore();
  const pc = heldPrefsClient({});
  ins.configure(Object.assign(store, { client: pc.client }));
  await store.metaSet({ insightsShare: true });       // this device still believes sharing is on
  await ins.markNoticeSeen();
  assert.strictEqual(pc.sent.length, 1);
  assert.ok(!('share' in pc.sent[0]), 'the notice push carried share');
  assert.strictEqual(pc.sent[0].notice_seen, true);
});

test('a notice write that never landed is kept locally and re-sent on the next sync', async () => {
  const store = metaStore();
  const server = { fail: true, row: { share: false, notice_seen: false } };
  const pc = heldPrefsClient(server);
  ins.configure(Object.assign(store, { client: pc.client }));
  await ins.markNoticeSeen();                         // push fails
  server.fail = false;
  assert.strictEqual(await ins.syncPrefs(), true);
  assert.strictEqual(await ins.noticeSeen(), true, 'the server row un-saw the notice');
  assert.strictEqual(await ins.shareEnabled(), false);
  const last = pc.sent[pc.sent.length - 1];
  assert.deepStrictEqual([last.notice_seen, 'share' in last], [true, false]);
});
