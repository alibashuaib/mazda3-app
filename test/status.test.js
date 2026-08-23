'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { svKm, svMo, serviceStatus, servicesRanked, healthScore } = require('../src/data/status.js');
const { isoDate, today } = require('../src/core/schedule.js');

/* A service due exactly `kmAgo` km and `monthsAgo` months back. */
function svc(name, opts) {
  const o = Object.assign({ intervalKm: 10000, intervalMonths: 12, lastKm: 0 }, opts);
  const d = new Date(today());
  d.setMonth(d.getMonth() - (o.monthsAgo || 0));
  return { name, intervalKm: o.intervalKm, intervalMonths: o.intervalMonths,
           normalKm: o.normalKm, normalMonths: o.normalMonths,
           lastKm: o.lastKm, lastDate: isoDate(d) };
}

test('svKm and svMo take the severe interval by default', () => {
  const s = svc('Oil', { intervalKm: 7500, intervalMonths: 6, normalKm: 10000, normalMonths: 12 });
  assert.strictEqual(svKm(s, 'severe'), 7500);
  assert.strictEqual(svMo(s, 'severe'), 6);
});

test('svKm and svMo take the dealer interval when severity is normal', () => {
  const s = svc('Oil', { intervalKm: 7500, intervalMonths: 6, normalKm: 10000, normalMonths: 12 });
  assert.strictEqual(svKm(s, 'normal'), 10000);
  assert.strictEqual(svMo(s, 'normal'), 12);
});

test('svKm falls back to the severe interval when no dealer value exists', () => {
  const s = svc('Wipers', { intervalKm: 20000, intervalMonths: 12 });
  assert.strictEqual(svKm(s, 'normal'), 20000);
  assert.strictEqual(svMo(s, 'normal'), 12);
});

test('a service well inside its interval is ok', () => {
  const st = serviceStatus(svc('Oil', { intervalKm: 10000, monthsAgo: 0 }), { odometer: 1000, severity: 'severe' });
  assert.strictEqual(st.level, 'ok');
  assert.strictEqual(st.kmLeft, 9000);
  assert.strictEqual(st.dueKm, 10000);
});

test('a service within 1200 km of due is a warning', () => {
  const st = serviceStatus(svc('Oil', { intervalKm: 10000, monthsAgo: 0 }), { odometer: 9000, severity: 'severe' });
  assert.strictEqual(st.level, 'warn');
});

test('a service past its distance is danger', () => {
  const st = serviceStatus(svc('Oil', { intervalKm: 10000, monthsAgo: 0 }), { odometer: 11000, severity: 'severe' });
  assert.strictEqual(st.level, 'danger');
  assert.ok(st.kmLeft < 0);
});

/* Time and distance are independent triggers — a car that barely moves still
   needs its oil changed. */
test('a service past its months is danger even at zero km', () => {
  const st = serviceStatus(svc('Oil', { intervalKm: 10000, intervalMonths: 6, monthsAgo: 8 }), { odometer: 0, severity: 'severe' });
  assert.strictEqual(st.level, 'danger');
  assert.strictEqual(st.drivenByTime, true);
});

test('prog is clamped to 1.2 however far overdue the service is', () => {
  const st = serviceStatus(svc('Oil', { intervalKm: 10000, monthsAgo: 0 }), { odometer: 500000, severity: 'severe' });
  assert.strictEqual(st.prog, 1.2);
});

test('severity changes the verdict for the same odometer', () => {
  const s = svc('Oil', { intervalKm: 7500, intervalMonths: 6, normalKm: 10000, normalMonths: 12, monthsAgo: 0 });
  assert.strictEqual(serviceStatus(s, { odometer: 8000, severity: 'severe' }).level, 'danger');
  assert.strictEqual(serviceStatus(s, { odometer: 8000, severity: 'normal' }).level, 'ok');
});

test('servicesRanked puts the most urgent service first', () => {
  const data = {
    car: { odometer: 9500 },
    severity: 'severe',
    services: [svc('Fresh', { intervalKm: 40000 }), svc('Overdue', { intervalKm: 5000 })]
  };
  assert.strictEqual(servicesRanked(data)[0].s.name, 'Overdue');
});

test('healthScore is 100 when everything is ok and drops when something is overdue', () => {
  const healthy = { car: { odometer: 100 }, severity: 'severe', services: [svc('Oil', { intervalKm: 10000 })] };
  const sick = { car: { odometer: 99000 }, severity: 'severe', services: [svc('Oil', { intervalKm: 10000 })] };
  assert.strictEqual(healthScore(healthy), 100);
  assert.ok(healthScore(sick) < 100);
});
