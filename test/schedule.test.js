'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { today, isQuotaError } = require('../schedule.js');

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
