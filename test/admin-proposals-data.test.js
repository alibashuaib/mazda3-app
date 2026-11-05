'use strict';
const test = require('node:test');
const assert = require('node:assert');
const admin = require('../src/data/admin.js');

function chain(result) {
  const c = { then: (a, b) => Promise.resolve(result).then(a, b), catch: b => Promise.resolve(result).catch(b) };
  ['select', 'eq', 'order', 'limit'].forEach(k => { c[k] = () => c; });
  return c;
}
const withClient = client => admin.configure({ client });

test('listProposals: ok, empty, error, throw, cap', async () => {
  withClient({ from: () => chain({ data: undefined, error: null }) });
  assert.deepStrictEqual(await admin.listProposals(), { ok: true, rows: [], capped: false });
  withClient({ from: () => chain({ data: null, error: { message: 'x' } }) });
  assert.deepStrictEqual(await admin.listProposals(), { ok: false, error: 'failed' });
  withClient({ from: () => { throw new Error('boom'); } });
  assert.deepStrictEqual(await admin.listProposals(), { ok: false, error: 'failed' });
  withClient({ from: () => chain({ data: Array.from({ length: 500 }, (_, i) => ({ id: i })), error: null }) });
  const r = await admin.listProposals();
  assert.strictEqual(r.capped, true);
  assert.strictEqual(admin.PROPOSAL_LIMIT, 500);
});

test('applyProposal: stale passes through, error maps to failed, ok keeps change_id', async () => {
  const stale = { ok: false, error: 'stale', live: { interval_km: 12000 }, live_hash: 'h' };
  withClient({ rpc: () => Promise.resolve({ data: stale, error: null }) });
  assert.deepStrictEqual(await admin.applyProposal(1, null, null), stale);
  withClient({ rpc: () => Promise.resolve({ data: null, error: { message: 'x' } }) });
  assert.deepStrictEqual(await admin.applyProposal(1), { ok: false, error: 'failed' });
  withClient({ rpc: () => Promise.resolve({ data: { ok: true, change_id: 3 }, error: null }) });
  const r = await admin.applyProposal(1);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.change_id, 3);
});

test('confidenceLabel maps tiers, unknown is Low', () => {
  assert.deepStrictEqual(admin.confidenceLabel('high'), { text: 'High', cls: 'ok' });
  assert.deepStrictEqual(admin.confidenceLabel('medium'), { text: 'Medium', cls: 'warn' });
  assert.deepStrictEqual(admin.confidenceLabel('low'), { text: 'Low', cls: 'danger' });
  assert.deepStrictEqual(admin.confidenceLabel(undefined), { text: 'Low', cls: 'danger' });
});

const FR = [
  { id: 1, car_model_id: 'm2', kind: 'schedule_item', confidence_tier: 'low', run_id: 102 },
  { id: 2, car_model_id: 'm1', kind: 'schedule_item', confidence_tier: 'high', run_id: 101 },
  { id: 3, car_model_id: 'm1', kind: 'part', confidence_tier: 'high', run_id: 102 },
  { id: 4, car_model_id: 'm2', kind: 'schedule_item', confidence_tier: 'low', run_id: null }
];
test('filterProposals: intersects, empty = all, no mutation', () => {
  const copy = JSON.stringify(FR);
  assert.deepStrictEqual(admin.filterProposals(FR, { car: 'm1' }).map(r => r.id), [2, 3]);
  assert.deepStrictEqual(admin.filterProposals(FR, { tier: 'high', run: '101' }).map(r => r.id), [2]);
  assert.strictEqual(admin.filterProposals(FR, {}).length, 4);
  assert.strictEqual(admin.filterProposals(FR).length, 4);
  assert.strictEqual(JSON.stringify(FR), copy);
});
test('proposalFilterOptions: unique, sorted, tiers ordered, null run dropped', () => {
  assert.deepStrictEqual(admin.proposalFilterOptions(FR),
    { cars: ['m1', 'm2'], kinds: ['part', 'schedule_item'], tiers: ['high', 'low'], runs: ['101', '102'] });
});
