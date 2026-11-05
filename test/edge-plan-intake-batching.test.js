'use strict';
/* plan-intake batching (FND-10): DB calls per car do not grow with item count. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const load = () => import('../supabase/functions/plan-intake/logic.mjs');
const items = n => Array.from({ length: n }, (_, i) => ({ service: 'Svc ' + i, interval_km: 1000 + i, interval_months: 6, note: '', parts: [] }));

// Fake admin client: records every from(table).method(...) call.
function fake() {
  const calls = [];
  const chain = table => {
    const q = {};
    for (const m of ['delete', 'insert', 'eq', 'in']) q[m] = (...a) => { calls.push([table, m, a]); return q; };
    q.then = res => res({ error: null });
    return q;
  };
  return { calls, from: chain };
}

for (const n of [1, 40]) {
  test(`planCarWrites + applyCarWrites: ${n} items -> exactly one delete and one insert`, async () => {
    const { planCarWrites, applyCarWrites } = await load();
    const plan = planCarWrites('car1', 'src1', items(n), []);
    assert.strictEqual(plan.drafts.length, n);
    const admin = fake();
    const written = await applyCarWrites(admin, 'car1', plan, async () => {});
    assert.strictEqual(written, n);
    assert.strictEqual(admin.calls.filter(c => c[1] === 'delete').length, 1);
    const inserts = admin.calls.filter(c => c[1] === 'insert');
    assert.strictEqual(inserts.length, 1);
    assert.strictEqual(inserts[0][2][0].length, n);
    assert.deepStrictEqual(admin.calls.find(c => c[1] === 'in')[2], ['service', plan.deleteServices]);
    assert.ok(admin.calls.some(c => c[1] === 'eq' && c[2][0] === 'status' && c[2][1] === 'pending'));
  });
}

test('drafts keep car, source, service, proposed and reason; unchanged item makes no draft', async () => {
  const { planCarWrites } = await load();
  const live = [{ service: 'Oil', interval_km: 10000, interval_months: 12, note: '', parts: [] }];
  const same = { service: 'oil', interval_km: 10000, interval_months: 12, note: '', parts: [] };
  const diff = { service: 'Brakes', interval_km: 30000, interval_months: null, note: 'n', parts: [] };
  const p = planCarWrites('c', 's', [same, diff], live);
  assert.strictEqual(p.drafts.length, 1);
  assert.deepStrictEqual(Object.keys(p.drafts[0]).sort(), ['car_model_id', 'proposed', 'reason', 'service', 'source_id']);
  assert.strictEqual(p.drafts[0].service, 'Brakes');
});

test('duplicate service keeps the first draft only (W-02)', async () => {
  const { planCarWrites } = await load();
  const a = { service: 'Oil', interval_km: 5000, interval_months: 6, note: '', parts: [] };
  const b = { service: 'oil', interval_km: 9999, interval_months: 6, note: '', parts: [] };
  const p = planCarWrites('c', 's', [a, b], []);
  assert.strictEqual(p.drafts.length, 1);
  assert.strictEqual(p.drafts[0].proposed.interval_km, 5000);
});

test('write errors are reported with a fixed message and not counted', async () => {
  const { planCarWrites, applyCarWrites } = await load();
  const plan = planCarWrites('c', 's', items(3), []);
  const errs = [];
  const admin = { from: () => { const q = { delete: () => q, eq: () => q, in: () => q, insert: () => q, then: r => r({ error: { message: 'secret payload' } }) }; return q; } };
  assert.strictEqual(await applyCarWrites(admin, 'c', plan, async e => errs.push(e.message)), 0);
  assert.deepStrictEqual(errs, ['plan-intake: plan_drafts delete failed']);
});

test('recalls: one upsert with ignoreDuplicates and campaign,car_model_id', async () => {
  const { recallRows } = await load();
  const rows = recallRows('c', new Map([['A', { campaign: 'A', years: [2020] }]]).values());
  assert.strictEqual(rows[0].car_model_id, 'c');
  const src = fs.readFileSync(path.join(__dirname, '../supabase/functions/plan-intake/index.ts'), 'utf8');
  assert.match(src, /onConflict: 'campaign,car_model_id', ignoreDuplicates: true/);
  assert.doesNotMatch(src, /plan_drafts[^\n]*onConflict/);
});
