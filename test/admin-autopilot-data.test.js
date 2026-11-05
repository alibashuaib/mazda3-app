'use strict';
const test = require('node:test');
const assert = require('node:assert');
const admin = require('../src/data/admin.js');

const NOW = Date.parse('2026-11-06T00:00:00Z');
const ago = d => new Date(NOW - d * 86400000).toISOString();
const run = (kind, status, days) => ({ kind, status, started_at: ago(days), finished_at: ago(days) });

test('bannerState: 34 days ok, 35 ok, 36 overdue', () => {
  assert.deepStrictEqual(admin.bannerState([run('monthly', 'done', 34)], NOW), { show: false, reason: null });
  assert.strictEqual(admin.bannerState([run('monthly', 'done', 35)], NOW).show, false);
  assert.deepStrictEqual(admin.bannerState([run('monthly', 'done', 36)], NOW), { show: true, reason: 'overdue' });
});

test('bannerState: failed newest monthly, and never', () => {
  assert.deepStrictEqual(admin.bannerState([run('monthly', 'failed', 1), run('monthly', 'done', 40)], NOW), { show: true, reason: 'failed' });
  assert.deepStrictEqual(admin.bannerState([], NOW), { show: true, reason: 'never' });
  assert.deepStrictEqual(admin.bannerState(null, NOW), { show: true, reason: 'never' });
  assert.strictEqual(admin.bannerState([run('manual', 'done', 1)], NOW).reason, 'never');
});

test('bannerState: manual runs neither reset the clock nor trigger the banner', () => {
  assert.strictEqual(admin.bannerState([run('manual', 'done', 1), run('monthly', 'done', 40)], NOW).reason, 'overdue');
  assert.deepStrictEqual(admin.bannerState([run('manual', 'failed', 1), run('monthly', 'done', 10)], NOW), { show: false, reason: null });
});

test('severe keys appear in the draft diff and the change description', () => {
  const d = admin.draftDiff({ severe_km: 5000 }, { severe_km: 4000, severe_months: 6 });
  assert.deepStrictEqual(d.map(r => r.field), ['severe_km', 'severe_months']);
  assert.match(admin.describeChange({ item_id: 1, before: { service: 'Oil', severe_km: 1 }, after: { service: 'Oil', severe_km: 2 } }), /severe_km 1 → 2/);
});

test('RPC wrappers send args, validate hosts, and never reject', async () => {
  const calls = [];
  admin.configure({ client: { rpc: (n, a) => { calls.push([n, a]); return Promise.resolve({ data: null, error: null }); } } });
  assert.deepStrictEqual(await admin.setKillSwitch(false), { ok: true });
  assert.deepStrictEqual(await admin.banDomain('  Evil.Example.COM '), { ok: true });
  assert.deepStrictEqual(await admin.approveDomain('mazda.com'), { ok: true });
  assert.deepStrictEqual(calls, [['autopilot_set_enabled', { p_enabled: false }],
    ['ban_source_domain', { p_host: 'evil.example.com' }], ['approve_source_domain', { p_host: 'mazda.com' }]]);
  for (const bad of ['https://x.com', 'x.com/path', 'x.com:80', 'nodot', '', 'a b.com', null]) {
    assert.deepStrictEqual(await admin.banDomain(bad), { ok: false, error: 'invalid' }, String(bad));
  }
  assert.strictEqual(calls.length, 3, 'invalid hosts never reach the RPC');
  admin.configure({ client: { rpc: () => Promise.resolve({ data: null, error: { message: 'secret' } }) } });
  assert.deepStrictEqual(await admin.setKillSwitch(true), { ok: false, error: 'failed' });
  admin.configure({ client: { rpc: () => { throw new Error('boom'); } } });
  assert.deepStrictEqual(await admin.banDomain('a.com'), { ok: false, error: 'failed' });
});

function chain(result) {
  const c = { then: (a, b) => Promise.resolve(result).then(a, b), catch: b => Promise.resolve(result).catch(b) };
  ['select', 'eq', 'gte', 'order', 'limit', 'maybeSingle'].forEach(k => { c[k] = () => c; });
  return c;
}

test('autopilotStatus and listUnverified/listDomains/listRuns: ok and never-reject', async () => {
  admin.configure({ client: { from: t => chain(t === 'autopilot_config' ? { data: { enabled: true, monthly_cap_sar: '40' }, error: null }
    : t === 'autopilot_spend' ? { data: [{ cost_sar: '1.5' }, { cost_sar: 2 }], error: null } : { data: [{ id: 1 }], error: null }) } });
  const s = await admin.autopilotStatus();
  assert.deepStrictEqual([s.ok, s.enabled, s.capSar, s.spendSar, s.runs.length], [true, true, 40, 3.5, 1]);
  assert.deepStrictEqual(await admin.listUnverified(), { ok: true, rows: [{ id: 1 }] });
  assert.strictEqual((await admin.listDomains()).ok, true);
  admin.configure({ client: { from: t => chain(t === 'autopilot_spend' ? { data: null, error: { message: 'x' } } : { data: { enabled: false, monthly_cap_sar: 40 }, error: null }) } });
  assert.strictEqual((await admin.autopilotStatus()).spendSar, null);
  admin.configure({ client: { from: () => { throw new Error('boom'); } } });
  assert.deepStrictEqual(await admin.autopilotStatus(), { ok: false, error: 'failed' });
  assert.deepStrictEqual(await admin.listRuns(), { ok: false, error: 'failed' });
  assert.deepStrictEqual(await admin.listUnverified(), { ok: false, error: 'failed' });
  assert.deepStrictEqual(await admin.listDomains(), { ok: false, error: 'failed' });
});

test('checkCar maps status codes and offline', async () => {
  const withInvoke = r => admin.configure({ client: { functions: { invoke: () => r instanceof Error ? Promise.reject(r) : Promise.resolve(r) } } });
  withInvoke({ data: { ok: true, estimate: { sar: 2 } }, error: null });
  assert.deepStrictEqual(await admin.checkCar('m1', 'preview'), { ok: true, estimate: { sar: 2 } });
  withInvoke({ data: { ok: true, run_id: 7 }, error: null });
  assert.strictEqual((await admin.checkCar('m1', 'run')).run_id, 7);
  for (const [s, e] of [[401, 'unauthorized'], [403, 'forbidden'], [429, 'limit'], [500, 'failed']]) {
    withInvoke({ data: null, error: { context: { status: s }, message: 'raw' } });
    assert.deepStrictEqual(await admin.checkCar('m1'), { ok: false, error: e });
  }
  withInvoke({ data: null, error: { message: 'fetch failed' } });
  assert.strictEqual((await admin.checkCar('m1')).error, 'offline');
  withInvoke(new Error('net'));
  assert.strictEqual((await admin.checkCar('m1')).error, 'offline');
});
