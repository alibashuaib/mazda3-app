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
        if (table === 'app_errors' && isUpdate && state.resolveFail) return Promise.resolve({ data: null, error: { message: 'x' } });
        if (table === 'app_errors') return state.errFail ? Promise.resolve({ data: null, error: { message: 'x' } }) : Promise.resolve({ data: state.errors, error: null });
        return Promise.resolve({ data: ({ profiles: { role: 'admin' }, car_models: [], dealer_plan_items: [], plan_drafts: [], schedule_sources: [], recalls: [] })[table], error: null });
      };
      const c = { then: (a, b) => p().then(a, b), catch: b => p().catch(b) };
      ['select', 'order', 'limit', 'maybeSingle', 'insert', 'range'].forEach(k => { c[k] = () => c; });
      c.update = v => { isUpdate = v; (state.updates = state.updates || []).push(v); return c; };
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
const open = async (state, extra) => {
  const app = await bootApp({ protocol: 'https:', lang: extra && extra.lang, supabaseStub: stub(Object.assign({ errors: [], resolved: [] }, state)) });
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

test('errors tab: repeated Resolve failures reuse one note', async () => {
  const state = { errors: [err()], resolved: [], resolveFail: true };
  const app = await open(state);
  try {
    assert.ok(await until(() => tab(app, 'Errors')));
    tab(app, 'Errors').onclick();
    const btn = () => [...app.document.querySelectorAll('#view button')].find(b => b.textContent === 'Resolve');
    assert.ok(await until(btn));
    for (let n = 1; n <= 2; n++) {
      btn().onclick();
      assert.ok(await until(() => state.resolved.length === n && !btn().disabled));
    }
    const notes = [...app.document.querySelectorAll('#view .admin-item p')].filter(p => p.textContent === 'Could not save');
    assert.strictEqual(notes.length, 1);
  } finally { app.cleanup(); }
});

test('errors tab: empty state', async () => {
  const app = await open({});
  try {
    assert.ok(await until(() => tab(app, 'Errors')));
    tab(app, 'Errors').onclick();
    assert.ok(await until(() => /No errors logged\./.test(text(app.document))), text(app.document));
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

test('errors tab: first/last seen follow the app language', async () => {
  const d = '2026-01-02T00:00:00Z';
  for (const [lang, loc] of [['en', 'en'], ['ar', 'ar-u-ca-gregory-nu-latn']]) {
    const app = await open({ errors: [err({ created_at: d })] }, { lang });
    try {
      const errTab = () => app.document.querySelector('#admin-tab-errors');
      assert.ok(await until(errTab));
      errTab().onclick();
      const want = new Date(d).toLocaleString(loc);
      assert.ok(await until(() => text(app.document).includes('1: ' + want) || text(app.document).includes(want)), text(app.document));
      if (lang === 'ar') assert.notStrictEqual(want, new Date(d).toLocaleString('en'));
    } finally { app.cleanup(); }
  }
});

test('errors tab: resolved group shows Reopen, which sets resolved_at to null', async () => {
  const state = { errors: [err({ resolved_at: '2026-01-03T00:00:00Z' })], resolved: [], updates: [] };
  const app = await open(state);
  try {
    assert.ok(await until(() => tab(app, 'Errors')));
    tab(app, 'Errors').onclick();
    const btn = () => [...app.document.querySelectorAll('#view button')].find(b => b.textContent === 'Reopen');
    assert.ok(await until(btn));
    assert.ok(![...app.document.querySelectorAll('#view button')].some(b => b.textContent === 'Resolve'));
    btn().onclick();
    assert.ok(await until(() => state.resolved.length === 1));
    assert.deepStrictEqual(state.resolved[0], ['group_key', 'g1']);
    assert.strictEqual(JSON.stringify(state.updates[0]), '{"resolved_at":null}');
  } finally { app.cleanup(); }
});

test('admin tabs: ARIA wiring and roving tabindex', async () => {
  const app = await open({});
  try {
    assert.ok(await until(() => tab(app, 'Errors')));
    const tabs = [...app.document.querySelectorAll('#view [role=tab]')];
    assert.deepStrictEqual(tabs.map(b => b.getAttribute('tabindex')), ['0', '-1', '-1']);
    tabs.forEach(b => { assert.strictEqual(b.getAttribute('aria-controls'), 'admin-panel'); assert.ok(b.id.startsWith('admin-tab-')); });
    assert.ok(app.document.getElementById('admin-panel'));
  } finally { app.cleanup(); }
});

test('admin tabs: arrow, End and Home keys select and focus', async () => {
  const app = await open({});
  try {
    assert.ok(await until(() => tab(app, 'Errors')));
    const press = key => app.document.querySelector('#view [role=tablist]').onkeydown({ key, preventDefault() {} });
    const sel = () => app.document.querySelector('#view [role=tab][aria-selected=true]').id;
    // linkedom does not track activeElement: record focus() calls on the prototype instead.
    const seen = [];
    const proto = Object.getPrototypeOf(tab(app, 'Errors'));
    proto.focus = function () { seen.push(this.id); };
    const focused = () => seen[seen.length - 1];
    press('ArrowRight');
    assert.strictEqual(sel(), 'admin-tab-queue'); assert.strictEqual(focused(), 'admin-tab-queue');
    press('End');
    assert.strictEqual(sel(), 'admin-tab-errors'); assert.strictEqual(focused(), 'admin-tab-errors');
    press('ArrowRight');   // wraps
    assert.strictEqual(sel(), 'admin-tab-proposals');
    press('End'); press('Home');
    assert.strictEqual(sel(), 'admin-tab-proposals'); assert.strictEqual(focused(), 'admin-tab-proposals');
  } finally { app.cleanup(); }
});

test('admin fetch: a rejecting listErrors does not blank the Proposals tab', async () => {
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub({ errors: [], resolved: [] }) });
  try {
    app.api.catalogAdmin.listErrors = () => Promise.reject(new Error('boom'));
    app.api.account.setUserForTest({ id: 'u1' });
    app.api.go('admin');
    assert.ok(await until(() => tab(app, 'Errors')), text(app.document));
    assert.strictEqual(tab(app, 'Proposals').querySelector('.tab-badge').textContent, '0');
    tab(app, 'Errors').onclick();
    assert.ok(await until(() => /Could not load errors\./.test(text(app.document))), text(app.document));
    tab(app, 'Proposals').onclick();
    assert.ok(await until(() => !/Could not load errors\./.test(text(app.document))));
    assert.strictEqual(tab(app, 'Proposals').getAttribute('aria-selected'), 'true');
  } finally { app.cleanup(); }
});
