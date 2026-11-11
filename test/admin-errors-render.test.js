'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

const EVIL = '<img src=x onerror="alert(1)">';
function stub(state) {
  return { createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
    rpc: () => Promise.resolve({ error: null }),
    functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
    from: table => {
      let isUpdate = null;
      const p = () => {
        if (table === 'app_errors') return state.errFail ? Promise.resolve({ data: null, error: { message: 'x' } }) : Promise.resolve({ data: state.errors, error: null });
        return Promise.resolve({ data: ({ profiles: { role: 'admin' }, car_models: [], dealer_plan_items: [], plan_drafts: [], schedule_sources: [], recalls: [] })[table], error: null });
      };
      const c = { then: (a, b) => p().then(a, b), catch: b => p().catch(b) };
      ['select', 'order', 'limit', 'maybeSingle', 'insert', 'range'].forEach(k => { c[k] = () => c; });
      c.update = v => { isUpdate = v; return c; };
      c.eq = (k, v) => { if (isUpdate && table === 'app_errors') state.resolved.push([k, v]); return c; };
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
const err = o => Object.assign({ id: 1, created_at: '2026-01-02T00:00:00Z', source: 'client', message: 'boom', stack: 'at x (y.js:1)', group_key: 'g1', resolved_at: null }, o);
const open = async (state) => {
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub(Object.assign({ errors: [], resolved: [] }, state)) });
  app.api.account.setUserForTest({ id: 'u1' });
  app.api.go('admin');
  return app;
};
const tab = (app, label) => [...app.document.querySelectorAll('#view [role=tab]')].find(b => b.textContent.startsWith(label));

test('errors tab: injected markup renders as inert text, badge counts open groups', async () => {
  const app = await open({ errors: [err({ message: EVIL, stack: EVIL }), err({ id: 2, message: 'other', group_key: 'g2' })] });
  try {
    assert.ok(await until(() => tab(app, 'Errors')), text(app.document));
    assert.strictEqual(tab(app, 'Errors').querySelector('.tab-badge').textContent, '2');
    assert.ok(!/\(\d+\)/.test(tab(app, 'Errors').textContent), 'no (N) text');
    tab(app, 'Errors').onclick();
    assert.ok(await until(() => text(app.document).includes(EVIL)), text(app.document));
    assert.strictEqual(app.document.querySelector('#view img'), null);
    assert.strictEqual([...app.document.querySelectorAll('#view h4')].some(h => h.textContent === EVIL), true);
  } finally { app.cleanup(); }
});

test('errors tab: Resolve updates the group_key', async () => {
  const state = { errors: [err()], resolved: [] };
  const app = await open(state);
  try {
    assert.ok(await until(() => tab(app, 'Errors')));
    tab(app, 'Errors').onclick();
    assert.ok(await until(() => [...app.document.querySelectorAll('#view button')].some(b => b.textContent === 'Resolve')));
    [...app.document.querySelectorAll('#view button')].find(b => b.textContent === 'Resolve').onclick();
    assert.ok(await until(() => state.resolved.length === 1));
    assert.deepStrictEqual(state.resolved[0], ['group_key', 'g1']);
  } finally { app.cleanup(); }
});

test('errors tab: empty state', async () => {
  const app = await open({});
  try {
    assert.ok(await until(() => tab(app, 'Errors')));
    tab(app, 'Errors').onclick();
    assert.ok(await until(() => /No errors logged/.test(text(app.document))), text(app.document));
  } finally { app.cleanup(); }
});

test('errors tab: load failure shows a message and the review queue stays selectable', async () => {
  const app = await open({ errFail: true });
  try {
    assert.ok(await until(() => tab(app, 'Errors')));
    tab(app, 'Errors').onclick();
    assert.ok(await until(() => /Could not load errors\./.test(text(app.document))), text(app.document));
    tab(app, 'Review queue').onclick();
    assert.ok(await until(() => /Nothing waiting for review/.test(text(app.document))), text(app.document));
  } finally { app.cleanup(); }
});
