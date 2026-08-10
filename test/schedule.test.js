'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { today, isQuotaError, mergeMilestones } = require('../schedule.js');

test('today() returns local midnight', () => {
  const d = today();
  assert.strictEqual(d.getHours(), 0);
  assert.strictEqual(d.getMinutes(), 0);
  assert.strictEqual(d.getSeconds(), 0);
  assert.strictEqual(d.getMilliseconds(), 0);
});

test('today() tracks the system clock rather than a fixed date', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-10T09:00:00') });
  const first = today();
  t.mock.timers.tick(48 * 60 * 60 * 1000);
  const second = today();
  assert.strictEqual(second.getTime() - first.getTime(), 48 * 60 * 60 * 1000);
});

test('isQuotaError detects the standard quota error', () => {
  assert.strictEqual(isQuotaError({ name: 'QuotaExceededError' }), true);
});

test('isQuotaError detects the Firefox and legacy variants', () => {
  assert.strictEqual(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), true);
  assert.strictEqual(isQuotaError({ code: 22 }), true);
});

test('isQuotaError rejects unrelated errors and rubbish input', () => {
  assert.strictEqual(isQuotaError(new TypeError('nope')), false);
  assert.strictEqual(isQuotaError(null), false);
  assert.strictEqual(isQuotaError(undefined), false);
});

test('mergeMilestones groups nearby occurrences of different services', () => {
  const oil = { name: 'Oil' }, air = { name: 'Air' };
  const out = mergeMilestones([
    { km: 320000, service: oil },
    { km: 320500, service: air }
  ], 1000);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].km, 320000);
  assert.deepStrictEqual(out[0].items, [oil, air]);
});

test('mergeMilestones never merges a service with itself', () => {
  const oil = { name: 'Oil' };
  const out = mergeMilestones([
    { km: 320000, service: oil },
    { km: 320500, service: oil }
  ], 1000);
  assert.strictEqual(out.length, 2);
});

test('mergeMilestones keeps occurrences beyond the tolerance separate', () => {
  const oil = { name: 'Oil' }, air = { name: 'Air' };
  const out = mergeMilestones([
    { km: 320000, service: oil },
    { km: 325000, service: air }
  ], 1000);
  assert.strictEqual(out.length, 2);
});

test('mergeMilestones preserves every occurrence of a 7500km interval', () => {
  // The regression this task exists for: grid-snapping to 10000 used to
  // collapse ~40 oil changes into ~30.
  const oil = { name: 'Oil' };
  const occurrences = [];
  for (let km = 323500; km <= 616000; km += 7500) occurrences.push({ km, service: oil });
  const out = mergeMilestones(occurrences, 1000);
  assert.strictEqual(out.length, occurrences.length);
});

test('mergeMilestones sorts unsorted input and handles empty input', () => {
  const a = { name: 'A' }, b = { name: 'B' };
  const out = mergeMilestones([{ km: 9000, service: b }, { km: 1000, service: a }], 1000);
  assert.deepStrictEqual(out.map(m => m.km), [1000, 9000]);
  assert.deepStrictEqual(mergeMilestones([], 1000), []);
});
