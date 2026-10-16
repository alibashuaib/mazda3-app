'use strict';
const test = require('node:test');
const assert = require('node:assert');
const shops = require('../src/data/shops.js');

/* A thenable query builder: any chained call records itself and returns the
   same object; awaiting it yields the queued result. */
function chain(result, log) {
  const o = {};
  ['select', 'eq', 'ilike', 'in', 'limit', 'insert', 'upsert', 'order', 'maybeSingle', 'single'].forEach(m => {
    o[m] = (...a) => { log.push([m, ...a]); return o; };
  });
  o.then = (res, rej) => Promise.resolve(result).then(res, rej);
  return o;
}
function queueClient(results, log) {
  const q = results.slice();
  return { from: table => { log.push(['from', table]); return chain(q.length ? q.shift() : { data: null, error: null }, log); } };
}
const row = { id: 's1', name: 'Al-Salam Auto', city: 'Jeddah', area: 'Safa' };

test.beforeEach(() => shops.reset());

test('norm folds case, punctuation and spacing, keeps Arabic letters', () => {
  assert.strictEqual(shops.norm('Al-Salam  Auto!'), 'al salam auto');
  assert.strictEqual(shops.norm('  al salam auto '), 'al salam auto');
  assert.strictEqual(shops.norm('مركز السلام'), 'مركز السلام');
  assert.strictEqual(shops.norm(null), '');
});

test('findOrCreate returns the existing shop without inserting', async () => {
  const log = [];
  shops.configure({ client: queueClient([{ data: row, error: null }], log) });
  assert.deepStrictEqual(await shops.findOrCreate('Al-Salam Auto', 'Jeddah', 'Safa'), row);
  assert.ok(!log.some(l => l[0] === 'insert'));
});

test('findOrCreate inserts when none exists, with the normalised key', async () => {
  const log = [];
  shops.configure({ client: queueClient([{ data: null, error: null }, { data: row, error: null }], log) });
  assert.deepStrictEqual(await shops.findOrCreate('Al-Salam Auto', 'Jeddah', 'Safa'), row);
  const ins = log.find(l => l[0] === 'insert')[1];
  assert.deepStrictEqual(ins, { name: 'Al-Salam Auto', name_norm: 'al salam auto', city: 'Jeddah', area: 'Safa' });
});

test('findOrCreate resolves a unique-violation race to the winner row', async () => {
  const log = [];
  shops.configure({ client: queueClient([
    { data: null, error: null },
    { data: null, error: { code: '23505' } },
    { data: row, error: null }], log) });
  assert.deepStrictEqual(await shops.findOrCreate('Al-Salam Auto', 'Jeddah', ''), row);
});

test('findOrCreate refuses too-short names or a missing city, and works without a client', async () => {
  shops.configure({ client: queueClient([], []) });
  assert.strictEqual(await shops.findOrCreate('x', 'Jeddah'), null);
  assert.strictEqual(await shops.findOrCreate('Al-Salam Auto', ''), null);
  shops.reset();
  assert.strictEqual(await shops.findOrCreate('Al-Salam Auto', 'Jeddah'), null);
});

test('network functions never reject', async () => {
  shops.configure({ client: { from: () => { throw new Error('boom'); } } });
  assert.strictEqual(await shops.findOrCreate('Al-Salam Auto', 'Jeddah'), null);
  assert.deepStrictEqual(await shops.search('salam', 'Jeddah'), []);
  assert.strictEqual(await shops.vote('s1', true, []), false);
  assert.deepStrictEqual(await shops.getTrust(['s1']), []);
  assert.deepStrictEqual(await shops.getStorePrices('m', 'k'), []);
});

test('search needs two characters and a client', async () => {
  assert.deepStrictEqual(await shops.search('salam', 'Jeddah'), []);
  const log = [];
  shops.configure({ client: queueClient([{ data: [row], error: null }], log) });
  assert.deepStrictEqual(await shops.search('s', ''), []);
  assert.deepStrictEqual(await shops.search('Salam', 'Jeddah'), [row]);
});

test('vote upserts one row, drops unknown reasons, is never bill-backed yet', async () => {
  const log = [];
  shops.configure({ client: queueClient([{ error: null }], log) });
  assert.strictEqual(await shops.vote('s1', false, ['price', 'bogus']), true);
  const up = log.find(l => l[0] === 'upsert');
  assert.deepStrictEqual(up[1], { shop_id: 's1', vote: -1, reasons: ['price'], bill_backed: false });
  assert.deepStrictEqual(up[2], { onConflict: 'shop_id,user_id' });
  assert.strictEqual(await shops.vote('', true, []), false);
});

test('getTrust with no ids makes no request', async () => {
  const log = [];
  shops.configure({ client: queueClient([], log) });
  assert.deepStrictEqual(await shops.getTrust([]), []);
  assert.strictEqual(log.length, 0);
});

test('lastCity returns the city of the most recent entry with a shop', () => {
  const h = [{ date: '2026-01-01', shop: { city: 'Riyadh' } }, { date: '2026-03-01', shop: { city: 'Jeddah' } }, { date: '2026-05-01' }];
  assert.strictEqual(shops.lastCity(h), 'Jeddah');
  assert.strictEqual(shops.lastCity([]), '');
  assert.strictEqual(shops.lastCity(undefined), '');
});

test('storeAdvice prefers the user\'s city, cheapest first, with trust thresholds', () => {
  const prices = [
    { shop_id: 'a', shop_name: 'A', city: 'Riyadh', area: null, median_price: '90.00', n: 6 },
    { shop_id: 'b', shop_name: 'B', city: 'Jeddah', area: 'Safa', median_price: '120.00', n: 7 },
    { shop_id: 'c', shop_name: 'C', city: 'jeddah', area: null, median_price: '150.00', n: 5 }];
  const trust = [{ shop_id: 'b', voters: 5, score_share: '0.800' }, { shop_id: 'c', voters: 9, score_share: '0.790' }];
  const a = shops.storeAdvice(prices, trust, 'Jeddah');
  assert.strictEqual(a.name, 'B');
  assert.strictEqual(a.local, true);
  assert.strictEqual(a.trusted, true);
  assert.strictEqual(a.pct, 80);
  const other = shops.storeAdvice(prices, trust, 'Dammam');
  assert.strictEqual(other.name, 'A');
  assert.strictEqual(other.local, false);
  assert.strictEqual(other.trusted, false);
  assert.strictEqual(other.pct, null);
  const c = shops.storeAdvice([prices[2]], trust, 'Jeddah');
  assert.strictEqual(c.trusted, false);
  assert.strictEqual(c.pct, 79);
  assert.strictEqual(shops.storeAdvice([], trust, 'Jeddah'), null);
});

test('findExact queries the same sliced key and city that create stores', async () => {
  const log = [];
  shops.configure({ client: queueClient([{ data: row, error: null }], log) });
  const long = 'a'.repeat(100), city = 'c'.repeat(50);
  await shops.findExact(long, city);
  assert.deepStrictEqual(log.find(l => l[0] === 'eq'), ['eq', 'name_norm', 'a'.repeat(80)]);
  assert.deepStrictEqual(log.find(l => l[0] === 'ilike'), ['ilike', 'city', 'c'.repeat(40)]);
});

test('norm keeps Arabic diacritics inside the word', () => {
  assert.strictEqual(shops.norm('مَرْكَز'), 'مَرْكَز');
});

test('vote tolerates non-array reasons and de-duplicates', async () => {
  const log = [];
  shops.configure({ client: queueClient([{ error: null }, { error: null }], log) });
  assert.strictEqual(await shops.vote('s1', true, 'price'), true);
  assert.strictEqual(await shops.vote('s1', true, ['price', 'price', 'fast']), true);
  const ups = log.filter(l => l[0] === 'upsert');
  assert.deepStrictEqual(ups[0][1].reasons, []);
  assert.deepStrictEqual(ups[1][1].reasons, ['price', 'fast']);
});
