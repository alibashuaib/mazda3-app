'use strict';
const test = require('node:test');
const assert = require('node:assert');
const admin = require('../src/data/admin.js');
const account = require('../src/data/account.js');

/* Chainable fake: every builder method returns the same thenable, which
   resolves to `result`. `calls` records what the module sent. */
function fake(result) {
  const calls = [];
  const client = { from: table => {
    const p = Promise.resolve(result);
    const c = { then: p.then.bind(p), catch: p.catch.bind(p) };
    ['select', 'eq', 'order', 'limit', 'maybeSingle'].forEach(k => { c[k] = (...a) => { calls.push([table, k, ...a]); return c; }; });
    c.update = patch => { calls.push([table, 'update', patch]); return c; };
    return c;
  } };
  return { client, calls };
}

test.beforeEach(() => { admin.reset(); account.setUserForTest(null); });

test('isAdmin is false when signed out', async () => {
  admin.configure({ client: fake({ data: { role: 'admin' }, error: null }).client });
  assert.strictEqual(await admin.isAdmin(), false);
});

test('isAdmin reads the profile role and caches it', async () => {
  account.setUserForTest({ id: 'u1' });
  admin.configure({ client: fake({ data: { role: 'admin' }, error: null }).client });
  assert.strictEqual(await admin.isAdmin(), true);
  assert.strictEqual(admin.knownAdmin(), true);
});

test('isAdmin is false for a user role or an error', async () => {
  account.setUserForTest({ id: 'u1' });
  admin.configure({ client: fake({ data: { role: 'user' }, error: null }).client });
  assert.strictEqual(await admin.isAdmin(), false);
  admin.configure({ client: fake({ data: null, error: { message: 'x' } }).client });
  assert.strictEqual(await admin.isAdmin(), false);
});

test('approve sets status approved on that car only', async () => {
  const f = fake({ data: null, error: null });
  admin.configure({ client: f.client });
  await admin.approve('cx5kf:2.5l');
  assert.deepStrictEqual(f.calls, [['car_models', 'update', { status: 'approved' }], ['car_models', 'eq', 'id', 'cx5kf:2.5l']]);
});

test('writes reject on a Supabase error', async () => {
  admin.configure({ client: fake({ data: null, error: { message: 'denied' } }).client });
  await assert.rejects(admin.saveItem(1, { note: 'x' }));
});

test('num: blank, negative or text become null', () => {
  assert.deepStrictEqual(['', '-5', 'abc', '9000'].map(admin.num), [null, null, null, 9000]);
});

test('parseParts skips blank lines, defaults qty to 1, round-trips', () => {
  const parts = admin.parseParts('Oil Filter | PE01-14-302A\n\n  | no name\nATF FZ | K020 | 5');
  assert.deepStrictEqual(parts, [
    { name: 'Oil Filter', part_no: 'PE01-14-302A', qty: 1 },
    { name: 'ATF FZ', part_no: 'K020', qty: 5 }
  ]);
  assert.deepStrictEqual(admin.parseParts(admin.formatParts(parts)), parts);
});

test('itemPatch returns only changed fields, or null', () => {
  const before = { interval_km: 10000, interval_months: 12, note: 'n', parts: [] };
  assert.strictEqual(admin.itemPatch(before, { interval_km: '10000', interval_months: '12', note: 'n', parts: '' }), null);
  assert.deepStrictEqual(admin.itemPatch(before, { interval_km: '9000', interval_months: '12', note: 'n', parts: '' }), { interval_km: 9000 });
});

test('describeChange names the service and the changed fields', () => {
  const s = admin.describeChange({ item_id: 1,
    before: { service: 'Engine Oil & Filter', interval_km: 10000 },
    after: { service: 'Engine Oil & Filter', interval_km: 9000 } });
  assert.strictEqual(s, 'Engine Oil & Filter: interval_km 10000 → 9000');
});

test('itemPatch ignores jsonb key order and missing part fields', () => {
  const f = { interval_km: '10000', interval_months: '12', note: 'n' };
  const base = { interval_km: 10000, interval_months: 12, note: 'n' };
  assert.strictEqual(admin.itemPatch({ ...base, parts: [{ qty: 1, name: 'A', part_no: 'X' }] }, { ...f, parts: 'A | X' }), null);
  assert.strictEqual(admin.itemPatch({ ...base, parts: [{ name: 'B' }] }, { ...f, parts: 'B' }), null);
});

test('describeChange never renders an empty change line', () => {
  assert.strictEqual(admin.describeChange({ item_id: 1, before: { service: 'Oil', sort: 0 }, after: { service: 'Oil', sort: 1 } }), 'Oil: other fields');
  assert.strictEqual(admin.describeChange({ item_id: 1, before: { service: 'Oil', interval_km: 10000 }, after: null }), 'Oil: removed');
});
