'use strict';
const test = require('node:test');
const assert = require('node:assert');
const g = require('../src/data/guidance.js');

const base = { level: 'danger', name: 'Cabin Filter', medianLifeKm: null, usedKm: 0, repair: null, tip: '', safety: false };

test('not due -> ok', () => assert.strictEqual(g.decide({ ...base, level: 'ok' }).action, 'ok'));
test('due, no community data -> replace on the dealer interval, community not used', () => {
  const r = g.decide(base);
  assert.strictEqual(r.action, 'replace'); assert.strictEqual(r.communityUsed, false);
});
test('due, past median life, repair share >= threshold and a tip exists -> repair', () => {
  const r = g.decide({ ...base, name: 'Headlight', medianLifeKm: 40000, usedKm: 45000, tip: 'Polish it', repair: { share: 60, attention: null, nInspected: 0 } });
  assert.strictEqual(r.action, 'repair'); assert.strictEqual(r.communityUsed, true);
});
test('repair share high but no curated tip -> replace', () => {
  assert.strictEqual(g.decide({ ...base, repair: { share: 80, attention: null, nInspected: 0 } }).action, 'replace');
});
test('community attention rate >= threshold on a not-yet-due item -> inspect', () => {
  const r = g.decide({ ...base, level: 'ok', repair: { share: null, attention: 40, nInspected: 6 } });
  assert.strictEqual(r.action, 'inspect');
});
test('attention rate needs at least 3 inspections behind it', () => {
  assert.strictEqual(g.decide({ ...base, level: 'ok', repair: { share: null, attention: 90, nInspected: 2 } }).action, 'ok');
});
test('safety-critical overdue item is never repair or ok: inspect', () => {
  const r = g.decide({ ...base, name: 'Brake Pads', safety: true, level: 'danger', tip: 'x', repair: { share: 90, attention: null, nInspected: 0 }, medianLifeKm: 1, usedKm: 99 });
  assert.strictEqual(r.action, 'inspect');
});
test('safety-critical not due and no flags -> ok', () => assert.strictEqual(g.decide({ ...base, safety: true, level: 'ok' }).action, 'ok'));
test('warn (due soon) behaves like due for replace', () => assert.strictEqual(g.decide({ ...base, level: 'warn' }).action, 'replace'));
test('isSafetyCritical matches brakes, tyres, steering in English and Arabic', () => {
  for (const n of ['Brake Pads', 'Front brake fluid', 'Tyre Rotation', 'Tires', 'Steering rack', 'تيل الفرامل', 'الإطارات'])
    assert.ok(g.isSafetyCritical(n), n);
  assert.ok(!g.isSafetyCritical('Cabin Filter'));
});
test('reasons are plain strings and never carry markup from the part name', () => {
  const r = g.decide({ ...base, name: '<img src=x onerror=1>' });
  assert.ok(typeof r.reason === 'string' && !r.reason.includes('<'));
});
test('numbers travel separately so the reason stays a translatable key', () => {
  const r = g.decide({ ...base, level: 'ok', repair: { share: null, attention: 40, nInspected: 6 } });
  assert.strictEqual(r.n, 40); assert.ok(!/\d/.test(r.reason));
  assert.strictEqual(g.decide({ ...base, level: 'ok' }).n, null);
});

test('matchRows links a service name to community item keys by whole phrase', () => {
  const rows = [{ item_key: 'engine oil' }, { item_key: 'engine oil 0w-20' }, { item_key: 'oil filter' }, { item_key: 'cabin filter' }];
  assert.deepStrictEqual(g.matchRows('Engine Oil', rows).map(r => r.item_key), ['engine oil', 'engine oil 0w-20']);
  assert.deepStrictEqual(g.matchRows('Cabin (A/C) Filter', rows), []);
  assert.deepStrictEqual(g.matchRows('Oil', rows), [], 'too short to match loosely');
  assert.deepStrictEqual(g.matchRows('', rows), []);
  assert.deepStrictEqual(g.matchRows('Engine Oil', null), []);
});
