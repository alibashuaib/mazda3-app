'use strict';
const test = require('node:test');
const assert = require('node:assert');
const admin = require('../src/data/admin.js');

test('draftDiff reports only changed fields, parts as readable text', () => {
  const live = { interval_km: 10000, interval_months: 12, note: 'a', parts: [{ name: 'Filter', part_no: 'F1', qty: 1 }] };
  const d = admin.draftDiff(live, { interval_km: 15000, interval_months: 12, note: 'a', parts: [{ name: 'Filter', part_no: 'F1', qty: 2 }] });
  assert.deepStrictEqual(d.map(x => x.field), ['interval_km', 'parts']);
  assert.deepStrictEqual([d[0].before, d[0].after], ['10000', '15000']);
  assert.strictEqual(d[1].after, 'Filter | F1 | 2');
});
test('draftDiff for a new service lists every set field with an empty before', () => {
  const d = admin.draftDiff(undefined, { interval_km: 5000, interval_months: null, note: '', parts: [] });
  assert.deepStrictEqual(d.map(x => x.field), ['interval_km']);
  assert.strictEqual(d[0].before, '');
});
test('addSource refuses non-https before any request', async () => {
  let called = false;
  admin.configure({ client: { from() { called = true; return {}; } } });
  await assert.rejects(() => admin.addSource('m1', 'http://x.com/a'));
  assert.strictEqual(called, false);
  admin.reset();
});
test('decideDraft sends approve flag and optional edit to the RPC', async () => {
  const calls = [];
  admin.configure({ client: { rpc(fn, args) { calls.push([fn, args]); return Promise.resolve({ error: null }); } } });
  await admin.decideDraft(7, true, { interval_km: 9000 });
  assert.deepStrictEqual(calls[0], ['decide_plan_draft', { p_id: 7, p_approve: true, p_edit: { interval_km: 9000 } }]);
  await admin.decideDraft(8, false);
  assert.deepStrictEqual(calls[1], ['decide_plan_draft', { p_id: 8, p_approve: false, p_edit: null }]);
  admin.reset();
});
