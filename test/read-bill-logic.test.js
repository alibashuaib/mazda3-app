'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const url = require('url');

const load = () => import(url.pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'read-bill', 'logic.mjs')).href);
const NOW = new Date('2026-10-17T12:00:00Z');

test('westernDigits converts Arabic-Indic and Persian digits and separators', async () => {
  const { westernDigits } = await load();
  assert.strictEqual(westernDigits('٣٥٠٫٥٠'), '350.50');
  assert.strictEqual(westernDigits('۱۲۳٬۴۵۶'), '123456');
  assert.strictEqual(westernDigits('SAR 12'), 'SAR 12');
});

test('parseBill reads JSON wrapped in prose or fences and whitelists fields', async () => {
  const { parseBill } = await load();
  const text = 'Here you go:\n```json\n' + JSON.stringify({
    store: { name: '  Al-Salam   Auto ', city: 'Jeddah', area: 'Safa', phone: '0500000000' },
    date: '2026-10-10', odometer: '١٢٣٤٥٠', total: '1,250.00', invoice_no: 'INV-9',
    customer_name: 'Ahmed', plate: 'ABC 1234',
    items: [{ name: 'Oil Filter', brand: 'Bosch', part_no: '0986', price: 40, customer: 'x' },
            { name: 'Labour', price: '١٠٠٫٥' }]
  }) + '\n```';
  const b = parseBill(text, NOW);
  assert.deepStrictEqual(b, {
    store: { name: 'Al-Salam Auto', city: 'Jeddah', area: 'Safa' },
    date: '2026-10-10', odometer: 123450, total: 1250, invoice_no: 'INV-9',
    items: [{ name: 'Oil Filter', brand: 'Bosch', part_no: '0986', price: 40 },
            { name: 'Labour', brand: null, part_no: null, price: 100.5 }]
  });
  const flat = JSON.stringify(b);
  for (const leak of ['0500000000', 'Ahmed', 'ABC 1234', 'customer']) assert.ok(!flat.includes(leak), leak);
});

test('parseBill returns null for junk and clamps bad values', async () => {
  const { parseBill } = await load();
  assert.strictEqual(parseBill('no json here', NOW), null);
  assert.strictEqual(parseBill('{"items": "oops"}', NOW), null);
  assert.strictEqual(parseBill('{bad json', NOW), null);
  const b = parseBill(JSON.stringify({
    store: { name: 'S' }, date: '1999-01-01', odometer: -5, total: 0,
    items: [{ name: 'Free', price: 0 }, { name: 'Huge', price: 999999 }, { name: 'Ok', price: '12,5' }]
  }), NOW);
  assert.strictEqual(b.date, null);
  assert.strictEqual(b.odometer, null);
  assert.strictEqual(b.total, null);
  assert.deepStrictEqual(b.items, [{ name: 'Ok', brand: null, part_no: null, price: 12.5 }]);
  assert.strictEqual(parseBill(JSON.stringify({ date: '2030-01-01', store: { name: 'Future' } }), NOW).date, null);
});

test('parseBill caps items and string lengths; a bill with only a total is kept', async () => {
  const { parseBill, MAX_ITEMS } = await load();
  const items = Array.from({ length: 40 }, (_, i) => ({ name: 'P'.repeat(200) + i, price: 5 }));
  const b = parseBill(JSON.stringify({ items }), NOW);
  assert.strictEqual(b.items.length, MAX_ITEMS);
  assert.ok(b.items.every(i => i.name.length <= 80));
  assert.deepStrictEqual(parseBill('{"total": 99}', NOW).total, 99);
});

test('fingerprint needs store, date and total; storeKey matches shops.name_key style', async () => {
  const { parseBill, fingerprint, storeKey } = await load();
  assert.strictEqual(storeKey('Al-Salam  Auto!'), 'alsalamauto');
  assert.strictEqual(storeKey('مركز السلام'), 'مركزالسلام');
  const full = parseBill(JSON.stringify({ store: { name: 'Al Salam' }, date: '2026-10-10', total: 50, invoice_no: '9' }), NOW);
  assert.strictEqual(fingerprint(full), 'alsalam|2026-10-10|50|9');
  assert.strictEqual(fingerprint({ ...full, total: null }), null);
  assert.strictEqual(fingerprint({ ...full, date: null }), null);
  assert.strictEqual(fingerprint({ ...full, store: null }), null);
});

test('validateImage accepts small jpeg/png/webp data URLs only', async () => {
  const { validateImage, MAX_IMAGE_BYTES } = await load();
  assert.deepStrictEqual(validateImage('data:image/jpeg;base64,QUJD'), { mediaType: 'image/jpeg', data: 'QUJD' });
  assert.strictEqual(validateImage('data:image/gif;base64,QUJD'), null);
  assert.strictEqual(validateImage('data:text/html;base64,QUJD'), null);
  assert.strictEqual(validateImage('QUJD'), null);
  assert.strictEqual(validateImage('data:image/jpeg;base64,'), null);
  assert.strictEqual(validateImage(42), null);
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8);
  assert.strictEqual(validateImage(big), null);
});

/* index.ts needs Deno and is NOT executed here; these are static checks on its source only. */
test('read-bill/index.ts static checks (source text, not executed)', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'read-bill', 'index.ts'), 'utf8');
  assert.ok(src.includes("from './logic.mjs'"));
  assert.ok(src.includes('auth.getUser(jwt)'));
  assert.ok(src.indexOf('>= DAILY_CAP') > 0 && src.indexOf('>= DAILY_CAP') < src.indexOf('api.anthropic.com'), 'cap checked before model call');
  assert.ok(!src.includes('console.log'));
  const allowed = new Set(['user_id', 'store_key', 'city', 'fingerprint', 'id', 'created_at']);
  const used = [...src.matchAll(/\.(?:insert|update)\(\{([^}]*)\}/g)]
    .flatMap(m => [...(',' + m[1]).matchAll(/,\s*(\w+)\s*:/g)].map(k => k[1]));
  assert.ok(used.length >= 4);
  for (const k of used) assert.ok(allowed.has(k), 'unexpected bill_reads column ' + k);
});
