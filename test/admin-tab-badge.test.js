'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');
const session = require('../src/data/session.js');

async function withBoot(fn) {
  const ctx = await bootApp();
  try { await fn(ctx); } finally { ctx.cleanup(); }
}

test('adminTabs: badge 0 is shown as a span, "!" shown, none omitted, no (N) text', () => withBoot(({ api }) => {
  const bar = api.adminTabs([{ id: 'a', label: 'A', badge: 0 }, { id: 'b', label: 'B', badge: '!' }, { id: 'c', label: 'C' }], 'a', () => {});
  const [a, b, c] = bar.querySelectorAll('[role=tab]');
  assert.strictEqual(a.querySelector('.tab-badge').textContent, '0');
  assert.strictEqual(b.querySelector('.tab-badge').textContent, '!');
  assert.strictEqual(c.querySelector('.tab-badge'), null);
  assert.ok(!/\(/.test(bar.textContent), 'no (N) text');
}));

test('retryToast does not steal focus', () => withBoot(({ document, api }) => {
  const before = document.activeElement;
  api.retryToast('x', () => Promise.resolve(true));
  assert.strictEqual(document.activeElement, before);
  assert.notStrictEqual(document.activeElement, document.querySelector('.toast-retry-btn'));
}));

function setup(err) {
  session.clear();
  session.setVehicles([{ id: 'v1', data: { car: { odometer: 1 }, services: [], parts: [], history: [], spending: [], fuel: [], docs: [] } }], 'v1');
  const notes = [];
  session.configure({ notify: (...a) => notes.push(a), afterSave: () => {}, saveVehicle: async () => ({ ok: false, error: err }) });
  return notes;
}

test('session failed: quota error passes no retry; other error passes a retry function', async () => {
  const quota = new Error('q'); quota.name = 'QuotaExceededError';
  let notes = setup(quota);
  try {
    await session.save();
    assert.match(notes[0][0], /Storage is full/);
    assert.ok(!(notes[0][2] && notes[0][2].retry), 'quota must not offer Retry');
  } finally { session.clear(); }
  notes = setup(new Error('nope'));
  try {
    await session.save();
    assert.strictEqual(typeof notes[0][2].retry, 'function');
  } finally { session.clear(); }
});
