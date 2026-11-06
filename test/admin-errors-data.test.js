'use strict';
const test = require('node:test');
const assert = require('node:assert');
const admin = require('../src/data/admin.js');

const row = (o) => Object.assign({ id: 1, created_at: '2026-01-01T00:00:00Z', source: 'client', message: 'boom', stack: null, resolved_at: null }, o);

test('groupErrors: same message and source collapse with count, first and last seen', () => {
  const g = admin.groupErrors([
    row({ created_at: '2026-01-02T00:00:00Z' }), row({ created_at: '2026-01-01T00:00:00Z' }), row({ created_at: '2026-01-03T00:00:00Z' }),
    row({ source: 'edge', message: 'boom' })]);
  assert.strictEqual(g.length, 2);
  const c = g.find(x => x.source === 'client');
  assert.deepStrictEqual([c.count, c.firstSeen, c.lastSeen], [3, '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z']);
});

test('groupErrors: case and digits do not split a group', () => {
  const g = admin.groupErrors([row({ message: 'Failed row 12' }), row({ message: 'failed ROW 7' })]);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].count, 2);
});

test('groupErrors: resolved group is closed, a newer row reopens it', () => {
  const closed = admin.groupErrors([row({ created_at: '2026-01-01T00:00:00Z', resolved_at: '2026-01-05T00:00:00Z' })]);
  assert.strictEqual(closed[0].open, false);
  const reopened = admin.groupErrors([
    row({ created_at: '2026-01-01T00:00:00Z', resolved_at: '2026-01-05T00:00:00Z' }), row({ created_at: '2026-01-06T00:00:00Z' })]);
  assert.strictEqual(reopened[0].open, true);
  assert.strictEqual(admin.groupErrors([row()])[0].open, true);
});

test('groupErrors: sorted by last seen descending', () => {
  const g = admin.groupErrors([row({ message: 'a', created_at: '2026-01-01T00:00:00Z' }), row({ message: 'b', created_at: '2026-02-01T00:00:00Z' })]);
  assert.deepStrictEqual(g.map(x => x.message), ['b', 'a']);
});

test('groupErrors: up to 5 stacks, newest first', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7].map(n => row({ created_at: `2026-01-0${n}T00:00:00Z`, stack: 's' + n }));
  assert.deepStrictEqual(admin.groupErrors(rows)[0].stacks, ['s7', 's6', 's5', 's4', 's3']);
});

function fake(res) {
  const calls = [];
  const c = { then: (a, b) => Promise.resolve(res).then(a, b) };
  ['select', 'order', 'limit', 'update', 'eq'].forEach(k => { c[k] = (...a) => { calls.push([k, a]); return c; }; });
  return { calls, client: { from: t => { calls.push(['from', [t]]); return c; } } };
}

test('listErrors: selects allowed columns, newest first, limit 500', async () => {
  const f = fake({ data: [row()], error: null });
  admin.configure({ client: f.client });
  const r = await admin.listErrors();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.groups.length, 1);
  const sel = f.calls.find(c => c[0] === 'select')[1][0];
  assert.match(sel, /^id,created_at,source,message,stack,route,app_version,user_id,group_key,resolved_at$/);
  assert.deepStrictEqual(f.calls.find(c => c[0] === 'order')[1], ['created_at', { ascending: false }]);
  assert.deepStrictEqual(f.calls.find(c => c[0] === 'limit')[1], [500]);
  admin.reset();
});

test('listErrors: error result or throw never rejects', async () => {
  admin.configure({ client: fake({ data: null, error: { message: 'x' } }).client });
  assert.deepStrictEqual(await admin.listErrors(), { ok: false, error: 'failed' });
  admin.configure({ client: { from() { throw new Error('boom'); } } });
  assert.deepStrictEqual(await admin.listErrors(), { ok: false, error: 'failed' });
  admin.reset();
});

test('resolveGroup: updates resolved_at for the group_key', async () => {
  const f = fake({ data: null, error: null });
  admin.configure({ client: f.client });
  assert.deepStrictEqual(await admin.resolveGroup('abc'), { ok: true });
  assert.deepStrictEqual(f.calls.find(c => c[0] === 'eq')[1], ['group_key', 'abc']);
  assert.ok(f.calls.find(c => c[0] === 'update')[1][0].resolved_at);
  admin.configure({ client: fake({ error: { message: 'x' } }).client });
  assert.deepStrictEqual(await admin.resolveGroup('abc'), { ok: false, error: 'failed' });
  admin.reset();
});
