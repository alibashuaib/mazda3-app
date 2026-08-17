'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { uid, fmt, sar, clamp, parseDate, monthsBetween, addMonths } = require('../src/core/helpers.js');

test('uid returns a short unique-ish string', () => {
  const a = uid(), b = uid();
  assert.strictEqual(typeof a, 'string');
  assert.ok(a.length >= 5 && a.length <= 7);
  assert.notStrictEqual(a, b);
});

test('fmt groups thousands, sar drops the decimals', () => {
  assert.strictEqual(fmt(316000), '316,000');
  assert.strictEqual(sar(1234.67), '1,235');
});

test('clamp holds a value inside its bounds', () => {
  assert.strictEqual(clamp(5, 0, 1.2), 1.2);
  assert.strictEqual(clamp(-3, 0, 1.2), 0);
  assert.strictEqual(clamp(0.4, 0, 1.2), 0.4);
});

/* parseDate must build a LOCAL midnight, not a UTC one — the whole schedule
   compares against today() at local midnight, and a UTC parse shifts every
   due date by a day for anyone east of Greenwich. Jeddah is UTC+3. */
test('parseDate builds local midnight', () => {
  const d = parseDate('2026-08-16');
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 7);
  assert.strictEqual(d.getDate(), 16);
  assert.strictEqual(d.getHours(), 0);
});

test('monthsBetween counts fractional months forward and back', () => {
  const a = parseDate('2026-01-01');
  assert.strictEqual(Math.round(monthsBetween(a, parseDate('2026-07-01'))), 6);
  assert.ok(monthsBetween(parseDate('2026-07-01'), a) < 0);
});

test('addMonths rolls the year over and does not mutate its input', () => {
  const a = parseDate('2026-11-15');
  const b = addMonths(a, 3);
  assert.strictEqual(b.getFullYear(), 2027);
  assert.strictEqual(b.getMonth(), 1);
  assert.strictEqual(a.getMonth(), 10, 'input must not be mutated');
});
