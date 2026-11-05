'use strict';
/* app-errors (edge logger): scrub, column allowlist, never throws. */
const test = require('node:test');
const assert = require('node:assert');

const load = () => import('../supabase/functions/_shared/app-errors.mjs');

test('scrub redacts sk- tokens, JWTs and Bearer values', async () => {
  const { scrub } = await load();
  const jwt = 'eyJhbGciOi.eyJzdWIiOjF9.abc_def-123';
  const out = scrub(`key sk-ant-abcdef123456 tok ${jwt} h Bearer abc.def`);
  assert.ok(!/sk-ant|eyJ|abc\.def/.test(out), out);
});

test('normaliseEdgeError returns only allowlisted keys with caps', async () => {
  const { normaliseEdgeError } = await load();
  const e = new Error('x'.repeat(900)); e.stack = 's'.repeat(5000);
  const row = normaliseEdgeError('plan-intake', e, 'plan-intake');
  assert.deepStrictEqual(Object.keys(row).sort(), ['message', 'route', 'source', 'stack']);
  assert.strictEqual(row.message.length, 500);
  assert.strictEqual(row.stack.length, 2000);
});

test('non-Error thrown value still yields a message string', async () => {
  const { normaliseEdgeError } = await load();
  assert.strictEqual(typeof normaliseEdgeError('read-bill', 'boom').message, 'string');
  assert.strictEqual(normaliseEdgeError('read-bill', { a: 1 }).source, 'read-bill');
});

test('invalid source becomes unknown-source', async () => {
  const { normaliseEdgeError } = await load();
  assert.strictEqual(normaliseEdgeError('Bad Source!', new Error('x')).source, 'unknown-source');
});

test('logEdgeError inserts into app_errors without select and never throws', async () => {
  const { logEdgeError } = await load();
  const calls = [];
  const ok = { from: t => ({ insert: r => { calls.push([t, r]); return Promise.resolve({}); } }) };
  await logEdgeError(ok, 'plan-intake', new Error('x'), 'plan-intake');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], 'app_errors');
  const bad = { from: () => ({ insert: () => Promise.reject(new Error('down')) }) };
  await logEdgeError(bad, 'plan-intake', new Error('x'));
  const thrower = { from: () => { throw new Error('sync'); } };
  await logEdgeError(thrower, 'plan-intake', new Error('x'));
});

test('logEdgeError tolerates null and undefined client', async () => {
  const { logEdgeError } = await load();
  await logEdgeError(null, 'read-bill', new Error('x'));
  await logEdgeError(undefined, 'read-bill', new Error('x'));
});

test('empty/scrubbed-empty message and long route still satisfy the table CHECKs', async () => {
  const { normaliseEdgeError } = await load();
  assert.strictEqual(normaliseEdgeError('read-bill', new Error('')).message, 'unknown error');
  assert.strictEqual(normaliseEdgeError('read-bill', new Error('x'), 'r'.repeat(300)).route.length, 120);
});
