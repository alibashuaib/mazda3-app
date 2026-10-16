'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

function stub(role) {
  const rows = {
    profiles: { role },
    car_models: [{ id: 'cx5kf:2.5l', model: 'CX-5', generation: 'KF', engine: '2.5L', status: 'draft' }],
    dealer_plan_items: []
  };
  return { createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
    from: table => {
      const p = Promise.resolve({ data: rows[table], error: null });
      const c = { then: p.then.bind(p), catch: p.catch.bind(p) };
      ['select', 'eq', 'order', 'limit', 'maybeSingle', 'update'].forEach(k => { c[k] = () => c; });
      return c;
    }
  }) };
}

async function until(fn) {
  const deadline = Date.now() + 2000;
  while (!fn() && Date.now() < deadline) await new Promise(r => setImmediate(r));
  return fn();
}
const text = d => d.querySelector('#view').textContent;

test('admin sees the catalogue with drafts marked for review', async () => {
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub('admin') });
  try {
    app.api.account.setUserForTest({ id: 'u1' });
    app.api.go('admin');
    assert.ok(await until(() => /CX-5/.test(text(app.document))), text(app.document));
    assert.match(text(app.document), /Needs review/);
  } finally { app.cleanup(); }
});

test('a non-admin is told so and sees no catalogue', async () => {
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub('user') });
  try {
    app.api.account.setUserForTest({ id: 'u1' });
    app.api.go('admin');
    assert.ok(await until(() => /not an admin/.test(text(app.document))), text(app.document));
    assert.doesNotMatch(text(app.document), /CX-5/);
  } finally { app.cleanup(); }
});

test('signed out shows a sign-in form', async () => {
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub('admin') });
  try {
    app.api.go('admin');
    assert.ok(await until(() => !!app.document.querySelector('#adm_email')));
  } finally { app.cleanup(); }
});

test('no backend explains that admin needs a connection', async () => {
  const app = await bootApp();
  try {
    app.api.go('admin');
    assert.ok(await until(() => /internet connection/.test(text(app.document))));
  } finally { app.cleanup(); }
});

test('the account menu shows Admin only to an admin', async () => {
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub('admin') });
  try {
    const items = () => [...app.document.querySelectorAll('#accountMenu .menu-item')].map(b => b.textContent);
    app.document.querySelector('#accountBtn').onclick();
    assert.ok(!items().some(s => /Admin/.test(s)), 'shown before the role is known');
    app.document.querySelector('#accountBtn').onclick();          // close
    app.api.account.setUserForTest({ id: 'u1' });
    await app.api.catalogAdmin.isAdmin();
    app.document.querySelector('#accountBtn').onclick();
    assert.ok(items().some(s => /Admin \(1\)/.test(s)), items().join(' | '));
  } finally { app.cleanup(); }
});
