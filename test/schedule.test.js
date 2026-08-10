'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { today, isQuotaError, mergeMilestones, nextOverdueOccurrence } = require('../schedule.js');

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

test('nextOverdueOccurrence skips past odo when the overdue gap is an exact multiple of the interval', () => {
  // Regression: dueKm=297500, odo=312500, ikm=7500 — overdue by exactly two
  // intervals. A naive ceil() advance lands exactly on odo, duplicating the
  // separate "due now" occurrence planForward already pushed at odo.
  const k = nextOverdueOccurrence(297500, 312500, 7500);
  assert.strictEqual(k, 320000);
  assert.ok(k > 312500);
});

test('nextOverdueOccurrence advances correctly on the ordinary (non-exact-multiple) overdue path', () => {
  const k = nextOverdueOccurrence(300000, 312500, 7500);
  assert.strictEqual(k, 315000);
  assert.ok(k > 312500);
});

const { withinHorizon } = require('../schedule.js');

const ms = iso => ({ date: new Date(iso + 'T00:00:00') });

test('withinHorizon keeps everything inside the cutoff', () => {
  const list = [ms('2026-09-01'), ms('2027-01-01'), ms('2027-06-01')];
  const out = withinHorizon(list, new Date('2028-01-01T00:00:00'), 3);
  assert.strictEqual(out.length, 3);
});

test('withinHorizon falls back to minCount when too few are inside', () => {
  const list = [ms('2026-09-01'), ms('2031-01-01'), ms('2032-01-01'), ms('2033-01-01')];
  const out = withinHorizon(list, new Date('2027-01-01T00:00:00'), 3);
  assert.strictEqual(out.length, 3);
});

test('withinHorizon never invents milestones that do not exist', () => {
  const out = withinHorizon([ms('2031-01-01')], new Date('2027-01-01T00:00:00'), 3);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(withinHorizon([], new Date('2027-01-01T00:00:00'), 3), []);
});

const { daysSince } = require('../schedule.js');

test('daysSince counts whole days', () => {
  const now = new Date('2026-08-10T00:00:00');
  assert.strictEqual(daysSince('2026-08-10', now), 0);
  assert.strictEqual(daysSince('2026-07-27', now), 14);
});

test('daysSince treats a missing date as infinitely stale', () => {
  const now = new Date('2026-08-10T00:00:00');
  assert.strictEqual(daysSince('', now), Infinity);
  assert.strictEqual(daysSince(undefined, now), Infinity);
});

test('daysSince does not go negative for a future date', () => {
  assert.strictEqual(daysSince('2026-09-01', new Date('2026-08-10T00:00:00')), 0);
});

const { healthFrom } = require('../schedule.js');

test('healthFrom returns 100 for no services or all healthy', () => {
  assert.strictEqual(healthFrom([]), 100);
  assert.strictEqual(healthFrom(['ok', 'ok', 'ok']), 100);
});

test('healthFrom returns 0 when everything is overdue', () => {
  assert.strictEqual(healthFrom(['danger', 'danger']), 0);
});

test('healthFrom weights overdue above due-soon', () => {
  assert.strictEqual(healthFrom(['danger', 'ok', 'ok', 'ok']), 75);
  assert.strictEqual(healthFrom(['warn', 'ok', 'ok', 'ok']), 90);
});

const { nextTheme } = require('../schedule.js');

test('nextTheme cycles system to light to dark and back', () => {
  assert.strictEqual(nextTheme('system'), 'light');
  assert.strictEqual(nextTheme('light'), 'dark');
  assert.strictEqual(nextTheme('dark'), 'system');
});

test('nextTheme recovers from an unrecognised stored value', () => {
  assert.strictEqual(nextTheme('chartreuse'), 'system');
  assert.strictEqual(nextTheme(null), 'system');
});
