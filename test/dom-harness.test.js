'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { setupDom } = require('./helpers/dom.js');
const { bootApp, assertScriptOrderMatchesIndexHtml } = require('./helpers/boot.js');

test('setupDom installs a usable document', () => {
  const { document, cleanup } = setupDom();
  const d = document.createElement('div');
  d.className = 'card';
  d.innerHTML = '<h3>hi</h3>';
  assert.strictEqual(d.outerHTML, '<div class="card"><h3>hi</h3></div>');
  cleanup();
});

test('setupDom provides the shell ids app.js reaches for at boot', () => {
  const { document, cleanup } = setupDom();
  ['#view', '#modalHost', '#modalCard', '#toastHost', '#tabbar', '#settingsBtn', '#garageBtn', '#openProfile', '#themeToggle', '#carBadge', '#carTitle', '#carSub']
    .forEach(sel => assert.ok(document.querySelector(sel), `${sel} must exist in the shell`));
  cleanup();
});

/* linkedom supplies neither of these, and app.js calls both at boot. */
test('setupDom stubs matchMedia and localStorage', () => {
  const { cleanup } = setupDom();
  assert.strictEqual(typeof globalThis.matchMedia, 'function');
  assert.strictEqual(typeof globalThis.matchMedia('(prefers-color-scheme: light)').matches, 'boolean');
  globalThis.localStorage.setItem('k', 'v');
  assert.strictEqual(globalThis.localStorage.getItem('k'), 'v');
  globalThis.localStorage.removeItem('k');
  assert.strictEqual(globalThis.localStorage.getItem('k'), null);
  cleanup();
});

test('setupDom stubs the object-URL API the photo registry uses', () => {
  const { cleanup } = setupDom();
  const url = URL.createObjectURL({ tag: 'blob' });
  assert.match(url, /^blob:/);
  URL.revokeObjectURL(url);
  cleanup();
});

test('cleanup removes the globals so tests do not leak into each other', () => {
  const { cleanup } = setupDom();
  cleanup();
  assert.strictEqual(globalThis.document, undefined);
  assert.strictEqual(globalThis.localStorage, undefined);
});

test('the harness can boot on an https origin', async () => {
  const app = await bootApp({ protocol: 'https:' });
  try {
    assert.strictEqual(app.api.location.protocol, 'https:');
    assert.ok(app.api.account, 'account.js is loaded by the harness');
  } finally { app.cleanup(); }
});

test('the script order assertion ignores vendor/', () => {
  assert.doesNotThrow(assertScriptOrderMatchesIndexHtml);
});

test('booting on https with a client available makes sign-in reachable', async () => {
  const created = [];
  const stub = { createClient: (url, key) => { created.push([url, key]); return { auth: {}, from: () => ({}) }; } };
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub });
  try {
    assert.strictEqual(created.length, 1, 'boot must construct exactly one client on https');
    assert.strictEqual(app.api.account.available(), true, 'sign-in must be reachable once a client exists');
  } finally { app.cleanup(); }
});

test('booting from file:// constructs no client and hides sign-in', async () => {
  const created = [];
  const stub = { createClient: () => { created.push(1); return { auth: {}, from: () => ({}) }; } };
  const app = await bootApp({ protocol: 'file:', supabaseStub: stub });
  try {
    assert.strictEqual(created.length, 0, 'no auth client may be constructed from disk');
    assert.strictEqual(app.api.account.available(), false);
  } finally { app.cleanup(); }
});
