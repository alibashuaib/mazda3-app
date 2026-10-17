'use strict';
const test = require('node:test');
const assert = require('node:assert');
const bills = require('../src/data/bills.js');
const bill = { store: { name: 'Al Salam Auto', city: 'Jeddah', area: null }, date: '2026-10-10', odometer: 52300, total: 250,
  items: [{ name: 'Oil Filter', brand: 'Bosch', part_no: '0986', price: 40 }, { name: 'Labour', brand: null, part_no: null, price: 60 }] };
const client = res => ({ functions: { invoke: (name, opts) => { client.last = [name, opts]; return Promise.resolve(res); } } });
test.beforeEach(() => bills.reset());
test('readBill without a client or offline never calls the network', async () => {
  assert.deepStrictEqual(await bills.readBill('data:image/jpeg;base64,QUJD'), { ok: false, error: 'unavailable' });
});
test('readBill returns the cleaned bill and read id', async () => {
  const c = client({ data: { bill, billReadId: 'r1' }, error: null });
  bills.configure({ client: c });
  const out = await bills.readBill('data:image/jpeg;base64,QUJD');
  assert.deepStrictEqual(out, { ok: true, bill, billReadId: 'r1' });
  assert.strictEqual(client.last[0], 'read-bill');
  assert.deepStrictEqual(client.last[1], { body: { image: 'data:image/jpeg;base64,QUJD' } });
});
test('readBill maps server statuses and never rejects', async () => {
  const err = status => ({ data: null, error: { context: { status } } });
  bills.configure({ client: client(err(429)) });
  assert.strictEqual((await bills.readBill('x')).error, 'limit');
  bills.configure({ client: client(err(422)) });
  assert.strictEqual((await bills.readBill('x')).error, 'unreadable');
  bills.configure({ client: client(err(502)) });
  assert.strictEqual((await bills.readBill('x')).error, 'failed');
  bills.configure({ client: client(err(503)) });
  assert.strictEqual((await bills.readBill('x')).error, 'failed');
  bills.configure({ client: client(err(403)) });
  assert.strictEqual((await bills.readBill('x')).error, 'failed');
  bills.configure({ client: client(err(413)) });
  assert.strictEqual((await bills.readBill('x')).error, 'failed');
  bills.configure({ client: client({ data: {}, error: null }) });
  assert.strictEqual((await bills.readBill('x')).error, 'unreadable');
  bills.configure({ client: { functions: { invoke: () => { throw new Error('boom'); } } } });
  assert.strictEqual((await bills.readBill('x')).error, 'failed');
});
test('toPrefill maps a bill to form values without inventing anything', () => {
  assert.deepStrictEqual(bills.toPrefill(bill), {
    name: 'Oil Filter', date: '2026-10-10', odometer: 52300, cost: 250,
    shop: { name: 'Al Salam Auto', city: 'Jeddah', area: '' },
    parts: [{ part: 'Oil Filter', brand: 'Bosch', partNo: '0986', price: 40, action: 'replaced' }, { part: 'Labour', brand: '', partNo: '', price: 60, action: 'replaced' }]
  });
  const sparse = bills.toPrefill({ store: null, date: null, odometer: null, total: null, items: [{ name: 'X', brand: null, part_no: null, price: 12.5 }] });
  assert.deepStrictEqual(sparse, { name: 'X', date: '', odometer: null, cost: 12.5, shop: null, parts: [{ part: 'X', brand: '', partNo: '', price: 12.5, action: 'replaced' }] });
  assert.deepStrictEqual(bills.toPrefill({ total: 99, items: [] }).parts, []);
});

test('toPrefill carries action through, defaulting to replaced', () => {
  const p = bills.toPrefill({ items: [{ name: 'A', price: 1, action: 'repaired' }, { name: 'B', price: 2, action: null }, { name: 'C', price: 3 }] });
  assert.deepStrictEqual(p.parts.map(x => x.action), ['repaired', 'replaced', 'replaced']);
});

test('toPrefill tolerates null prices', () => {
  const p = bills.toPrefill({ total: null, items: [{ name: 'Check', price: null, action: 'inspected' }, { name: 'B', price: 5 }] });
  assert.strictEqual(p.parts[0].price, null);
  assert.strictEqual(p.cost, 5);
  assert.strictEqual(bills.toPrefill({ items: [{ name: 'Check', price: null, action: 'inspected' }] }).cost, 0);
});
