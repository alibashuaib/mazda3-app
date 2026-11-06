'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

async function withBoot(fn) {
  const ctx = await bootApp();
  try { await fn(ctx); } finally { ctx.cleanup(); }
}
const retries = d => d.querySelectorAll('#toastHost .toast-retry');
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('retry toast survives a burst of normal toasts; cap still applies to those', () => withBoot(async ({ document, api }) => {
  api.retryToast('Couldn\'t save. Your changes are still on screen.', () => Promise.resolve(true));
  for (let i = 0; i < 5; i++) api.toast('n' + i);
  assert.strictEqual(retries(document).length, 1, 'cap evicted the retry toast');
  const normal = Array.from(document.querySelectorAll('#toastHost .toast')).filter(n => !n.classList.contains('toast-retry'));
  assert.ok(normal.length <= 3, 'cap no longer applies to normal toasts');
}));

test('retry toast is not removed by the plain toast timer', () => withBoot(async ({ document, api }) => {
  api.retryToast('x', () => Promise.resolve(true));
  await sleep(2700);
  assert.strictEqual(retries(document).length, 1);
}));

test('Retry success removes the toast; failure keeps it and re-enables the button', () => withBoot(async ({ document, api }) => {
  let result = false, calls = 0;
  api.retryToast('x', () => { calls++; return Promise.resolve(result); });
  const btn = document.querySelector('#toastHost .toast-retry-btn');
  await btn.onclick({ stopPropagation() {} });
  assert.strictEqual(calls, 1);
  assert.strictEqual(retries(document).length, 1, 'toast must stay after a failed retry');
  assert.strictEqual(btn.disabled, false);
  result = true;
  await btn.onclick({ stopPropagation() {} });
  await sleep(400);
  assert.strictEqual(retries(document).length, 0, 'toast must go after a successful retry');
}));

test('clicking the toast body dismisses it', () => withBoot(async ({ document, api }) => {
  const node = api.retryToast('x', () => Promise.resolve(false));
  node.onclick();
  await sleep(400);
  assert.strictEqual(retries(document).length, 0);
}));

test('two retryToast calls leave exactly one', () => withBoot(async ({ document, api }) => {
  api.retryToast('x', () => Promise.resolve(false));
  api.retryToast('x', () => Promise.resolve(false));
  assert.strictEqual(retries(document).length, 1);
}));
