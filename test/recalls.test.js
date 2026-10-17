'use strict';
const test = require('node:test');
const assert = require('node:assert');
const recalls = require('../src/data/recalls.js');

const client = (rows, err, counter) => ({ from: t => {
  assert.strictEqual(t, 'recalls'); counter.n++;
  const p = Promise.resolve({ data: err ? null : rows, error: err || null });
  const c = { then: p.then.bind(p), catch: p.catch.bind(p) };
  ['select', 'eq'].forEach(k => { c[k] = () => c; });
  return c;
} });

test('forModel returns approved rows and caches within the window', async () => {
  const n = { n: 0 };
  recalls.configure({ client: client([{ campaign: 'A', component: 'c', summary: 's', years: [2016] }], null, n) });
  const a = await recalls.forModel('m1'), b = await recalls.forModel('m1');
  assert.strictEqual(a.length, 1); assert.strictEqual(b.length, 1);
  assert.strictEqual(n.n, 1, 'second read served from cache');
  recalls.reset();
});
test('forModel resolves [] on a client error and does not cache the failure', async () => {
  const n = { n: 0 };
  recalls.configure({ client: client(null, { message: 'x' }, n) });
  assert.deepStrictEqual(await recalls.forModel('m1'), []);
  await recalls.forModel('m1');
  assert.strictEqual(n.n, 2);
  recalls.reset();
});
test('forModel resolves [] with no client', async () => {
  recalls.reset();
  assert.deepStrictEqual(await recalls.forModel('m1'), []);
});
