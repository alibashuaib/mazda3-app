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
    const tab = () => [...app.document.querySelectorAll('#view [role=tab]')].find(b => b.textContent === 'Review queue');
    assert.ok(await until(tab), text(app.document));
    tab().onclick();   // Proposals is the default tab since Phase 2
    assert.ok(await until(() => /CX-5/.test(text(app.document))), text(app.document));
    assert.match(text(app.document), /Needs review/);
    // The full list is hidden until asked for, then grouped by model
    const doc = app.document;
    assert.equal(doc.querySelector('#view .admin-car-groups'), null);
    const toggle = () => doc.querySelector('#view .admin-cars-toggle');
    assert.equal(toggle().textContent, 'Show all cars');
    toggle().onclick();
    assert.ok(await until(() => doc.querySelector('#view .admin-car-groups')), text(doc));
    assert.equal(doc.querySelector('#view .admin-car-group').textContent, 'Mazda CX-5');
    assert.equal(toggle().textContent, 'Hide all cars');
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

test('signed out shows the app-wide sign-in gate, not a form in Advanced', async () => {
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub('admin') });
  try {
    assert.ok(await until(() => !app.document.querySelector('#signinGate').hidden), 'gate shown');
    assert.ok(app.document.querySelector('#signinEmail'));
    assert.strictEqual(app.document.querySelector('#app').hidden, true);
  } finally { app.cleanup(); }
});

test('no backend explains that admin needs a connection', async () => {
  const app = await bootApp();
  try {
    app.api.go('admin');
    assert.ok(await until(() => /internet connection/.test(text(app.document))));
  } finally { app.cleanup(); }
});

test('the account menu offers Account to a signed-in user; Admin lives in the Advanced tab', async () => {
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub('admin') });
  try {
    const items = () => [...app.document.querySelectorAll('#accountMenu .menu-item')].map(b => b.textContent);
    app.document.querySelector('#accountBtn').onclick();
    assert.ok(!items().some(s => /Account/.test(s)), 'shown when signed out');
    app.document.querySelector('#accountBtn').onclick();          // close
    app.api.account.setUserForTest({ id: 'u1' });
    await app.api.catalogAdmin.isAdmin();
    app.document.querySelector('#accountBtn').onclick();
    assert.ok(items().some(s => /Account/.test(s)), items().join(' | '));
    assert.ok(!items().some(s => /Admin/.test(s)), 'no Admin entry in the menu any more');
    assert.ok(items().some(s => /Sign out/.test(s)), 'Sign out is in the gear menu');
  } finally { app.cleanup(); }
});

test('the Advanced data loads once per page load, not on every render or tab switch', async () => {
  const calls = {};
  const base = stub('admin').createClient();
  const counting = { createClient: () => ({
    auth: base.auth,
    from: table => { calls[table] = (calls[table] || 0) + 1; return base.from(table); }
  }) };
  const app = await bootApp({ protocol: 'https:', supabaseStub: counting });
  try {
    app.api.account.setUserForTest({ id: 'u1' });
    app.api.go('admin');
    assert.ok(await until(() => app.document.querySelectorAll('#view [role=tab]').length >= 2), text(app.document));
    const after = calls.profiles || 0;
    app.api.go('admin');                                             // re-render
    app.api.go('admin');
    assert.ok(await until(() => app.document.querySelectorAll('#view [role=tab]').length >= 2), text(app.document));
    const tabs = [...app.document.querySelectorAll('#view [role=tab]')];
    const settle = () => new Promise(r => setTimeout(r, 20));   // let any stray fetch land
    tabs[1].onclick(); await settle(); tabs[0].onclick(); await settle();
    assert.ok(after >= 1);
    assert.strictEqual(calls.profiles || 0, after, 'profiles fetched again: ' + JSON.stringify(calls));
  } finally { app.cleanup(); }
});
