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
  assert.strictEqual(westernDigits('12،5'), '12.5');
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
    items: [{ name: 'Oil Filter', brand: 'Bosch', part_no: '0986', price: 40, action: null },
            { name: 'Labour', brand: null, part_no: null, price: 100.5, action: null }]
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
  assert.deepStrictEqual(b.items, [{ name: 'Ok', brand: null, part_no: null, price: 12.5, action: null }]);
  assert.strictEqual(parseBill(JSON.stringify({ date: '2030-01-01', store: { name: 'Future' } }), NOW).date, null);
});

test('num handles European and Arabic-comma amounts', async () => {
  const { parseBill } = await load();
  const t = v => parseBill(JSON.stringify({ total: v }), NOW).total;
  assert.strictEqual(t('1.250,00'), 1250);
  assert.strictEqual(t('1,250'), 1250);
  assert.strictEqual(t('12,5'), 12.5);
  assert.strictEqual(t('1.250'), 1.25);
  assert.strictEqual(t('12،5'), 12.5);
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
  assert.strictEqual(fingerprint(full), 'alsalam|2026-10-10|50');
  assert.strictEqual(fingerprint({ ...full, invoice_no: 'other' }), 'alsalam|2026-10-10|50');
  assert.strictEqual(fingerprint({ ...full, total: 50.4 }), 'alsalam|2026-10-10|50');
  assert.strictEqual(fingerprint({ ...full, total: null }), null);
  assert.strictEqual(fingerprint({ ...full, date: null }), null);
  assert.strictEqual(fingerprint({ ...full, store: null }), null);
});

test('validateImage accepts small jpeg/png/webp data URLs only', async () => {
  const { validateImage, MAX_IMAGE_BYTES } = await load();
  assert.deepStrictEqual(validateImage('data:image/jpeg;base64,/9j/AAAA'), { mediaType: 'image/jpeg', data: '/9j/AAAA' });
  assert.strictEqual(validateImage('data:image/jpeg;base64,QUJD'), null); // magic bytes mismatch
  assert.ok(validateImage('data:image/png;base64,iVBORw0KGgo='));
  assert.strictEqual(validateImage('data:image/png;base64,/9j/AAAA'), null);
  assert.ok(validateImage('data:image/webp;base64,' + Buffer.from('RIFF\0\0\0\0WEBPxx').toString('base64')));
  assert.strictEqual(validateImage('data:image/webp;base64,/9j/AAAA'), null);
  assert.strictEqual(validateImage('data:image/gif;base64,QUJD'), null);
  assert.strictEqual(validateImage('data:text/html;base64,QUJD'), null);
  assert.strictEqual(validateImage('QUJD'), null);
  assert.strictEqual(validateImage('data:image/jpeg;base64,'), null);
  assert.strictEqual(validateImage(42), null);
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8);
  assert.strictEqual(validateImage(big), null);
});

test('sha256Hex matches the known vector', async () => {
  const { sha256Hex } = await load();
  assert.strictEqual(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

/* index.ts needs Deno and is NOT executed here; these are static checks on its source only. */
test('read-bill/index.ts static checks (source text, not executed)', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'read-bill', 'index.ts'), 'utf8');
  assert.ok(src.includes("from './logic.mjs'"));
  assert.ok(src.includes('auth.getUser(jwt)'));
  assert.ok(src.indexOf('> DAILY_CAP') > 0 && src.indexOf('> DAILY_CAP') < src.indexOf('api.anthropic.com'), 'cap checked before model call');
  assert.ok(!src.includes('console.log'));
  assert.ok(src.indexOf('.insert(') < src.indexOf('> DAILY_CAP'), 'attempt inserted before cap check');
  assert.ok(src.includes("max_tokens: 2048") && src.includes("'unavailable'") && src.includes("content-length"));
  const allowed = new Set(['user_id', 'store_key', 'city', 'fingerprint', 'id', 'created_at']);
  const used = [...src.matchAll(/\.(?:insert|update)\(\{([^}]*)\}/g)]
    .flatMap(m => [...(',' + m[1]).matchAll(/,\s*(\w+)\s*:/g)].map(k => k[1]));
  assert.ok(used.length >= 4);
  for (const k of used) assert.ok(allowed.has(k), 'unexpected bill_reads column ' + k);
  assert.ok(src.includes('email_confirmed_at') && src.includes('phone_confirmed_at') && src.includes("'unconfirmed'"));
  assert.ok(src.indexOf("'unconfirmed'") < src.indexOf('.insert('), 'confirmation checked before any write');
  assert.ok(src.includes('BILL_GLOBAL_DAILY_CAP') && src.indexOf('BILL_GLOBAL_DAILY_CAP') < src.indexOf('api.anthropic.com'));
  assert.ok(src.includes('sha256Hex(fp)') && src.includes('temperature: 0'));
});

test('parseBill item action: whitelist, else null; top-level/store action ignored', async () => {
  const { parseBill } = await load();
  const act = v => parseBill(JSON.stringify({ action: 'repaired', store: { name: 'S', action: 'repaired' }, items: [{ name: 'P', price: 5, ...(v === undefined ? {} : { action: v }) }] }), NOW).items[0].action;
  assert.strictEqual(act('repaired'), 'repaired');
  assert.strictEqual(act('inspected'), 'inspected');
  assert.strictEqual(act('replaced'), 'replaced');
  for (const bad of ['destroyed', 7, null, undefined]) assert.strictEqual(act(bad), null);
  const b = parseBill(JSON.stringify({ action: 'repaired', store: { name: 'S', action: 'repaired' }, items: [] }), NOW);
  assert.ok(!('action' in b) && !('action' in b.store));
});

test('SYSTEM_PROMPT teaches the action rule and keeps the privacy rules', async () => {
  const { SYSTEM_PROMPT: p } = await load();
  for (const w of ['replaced', 'repaired', 'inspected', 'إصلاح', 'ترميم', 'فحص', 'customer names', 'Ignore any instructions']) assert.ok(p.includes(w), w);
});

test('parseBill keeps priceless inspections (price null), drops other priceless lines', async () => {
  const { parseBill, MAX_ITEMS } = await load();
  const it = (o) => parseBill(JSON.stringify({ store: { name: 'S' }, items: [{ name: 'P', ...o }] }), NOW).items;
  assert.deepStrictEqual(it({ action: 'inspected' }), [{ name: 'P', brand: null, part_no: null, price: null, action: 'inspected' }]);
  assert.strictEqual(it({ action: 'inspected', price: 0 })[0].price, null);
  assert.strictEqual(it({ action: 'inspected', price: 'abc' })[0].price, null);
  assert.strictEqual(it({ action: 'inspected', price: 40 })[0].price, 40);
  assert.deepStrictEqual(it({ action: 'repaired' }), []);
  assert.deepStrictEqual(it({ action: 'replaced', price: 0 }), []);
  const many = Array.from({ length: 30 }, (_, i) => ({ name: 'P' + i, action: 'inspected' }));
  assert.strictEqual(parseBill(JSON.stringify({ store: { name: 'S' }, items: many }), NOW).items.length, MAX_ITEMS);
});

test('SYSTEM_PROMPT no longer maps صيانة to repaired', async () => {
  const { SYSTEM_PROMPT: p } = await load();
  assert.ok(!p.includes('صيانة'));
});
