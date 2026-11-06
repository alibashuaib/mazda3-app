'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const url = require('url');
const load = () => import(url.pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'units.mjs')).href);

test('distance converts to canonical km', async () => {
  const { milesToKm, toKm } = await load();
  assert.strictEqual(milesToKm(10000), 16093);
  assert.strictEqual(toKm(5000, 'km'), 5000);
  assert.strictEqual(toKm(6000, 'mi'), 9656);
  assert.throws(() => toKm(1, 'furlong'));
});

test('exVat strips VAT only when included', async () => {
  const { exVat } = await load();
  assert.strictEqual(exVat(115, true), 100);
  assert.strictEqual(exVat(100, false), 100);
  assert.strictEqual(exVat(110, true, 0.10), 100);
});

test('perUnitSar divides by pack size and refuses bad packs', async () => {
  const { perUnitSar } = await load();
  assert.strictEqual(perUnitSar(120, 4), 30);
  assert.strictEqual(perUnitSar(50, 1), 50);
  assert.throws(() => perUnitSar(10, 0));
  assert.throws(() => perUnitSar(10, 'x'));
});
