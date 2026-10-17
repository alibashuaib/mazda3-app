'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

const EVIL = '<img src=x onerror=1>';
function stub(state) {
  return { createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
    rpc: (fn, args) => { state.rpc.push([fn, args]); state.drafts = state.drafts.filter(d => d.id !== args.p_id); return Promise.resolve({ error: null }); },
    functions: { invoke: (fn, o) => { state.invoked.push([fn, o]); return Promise.resolve({ data: { drafts: 1, recalls: 0, skipped: 0 }, error: null }); } },
    from: table => {
      const rowsOf = () => ({
        profiles: { role: 'admin' }, car_models: [{ id: 'm1', model: '3', generation: 'BM', engine: '2.0', status: 'approved' }],
        dealer_plan_items: [{ car_model_id: 'm1', service: 'Engine Oil', interval_km: 10000, interval_months: 12, note: 'old', parts: [] }],
        plan_drafts: state.drafts, schedule_sources: [{ id: 1, url: 'https://mazda.example/manual.pdf' }], recalls: state.recalls
      })[table];
      let isUpdate = null;
      const p = () => Promise.resolve({ data: rowsOf(), error: null });
      const c = { then: (a, b) => p().then(a, b), catch: b => p().catch(b) };
      ['select', 'order', 'limit', 'maybeSingle', 'insert', 'range'].forEach(k => { c[k] = () => c; });
      c.update = v => { isUpdate = v; return c; };
      c.eq = (k, v) => { if (isUpdate && table === 'recalls') { state.recallUpdates.push([k, v, isUpdate]); } return c; };
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
const draft = (over) => ({ id: 5, car_model_id: 'm1', service: 'Engine Oil', source_id: 1, reason: 'Source differs from the live schedule', proposed: { interval_km: 15000, interval_months: 12, note: 'old', parts: [] }, ...over });
const open = async (state) => {
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub(state) });
  app.api.account.setUserForTest({ id: 'u1' });
  app.api.go('admin');
  return app;
};
const mk = o => Object.assign({ drafts: [], recalls: [], rpc: [], invoked: [], recallUpdates: [] }, o);

test('review queue: a pending draft shows service, changed field and source host', async () => {
  const state = mk({ drafts: [draft()] }), app = await open(state);
  try {
    assert.ok(await until(() => /Engine Oil/.test(text(app.document)) && /15000/.test(text(app.document))), text(app.document));
    assert.match(text(app.document), /10000 → 15000/);
    assert.match(text(app.document), /mazda\.example/);
  } finally { app.cleanup(); }
});

test('review queue: markup in a draft stays text', async () => {
  const state = mk({ drafts: [draft({ service: EVIL, proposed: { interval_km: 1, interval_months: 1, note: EVIL, parts: [] } })] }), app = await open(state);
  try {
    assert.ok(await until(() => text(app.document).includes('<img')), text(app.document));
    assert.strictEqual(app.document.querySelector('#view img'), null);
  } finally { app.cleanup(); }
});

test('review queue: Approve and Reject call the RPC and the draft leaves the list', async () => {
  const state = mk({ drafts: [draft({ id: 5 }), draft({ id: 6, service: 'Cabin Filter' })] }), app = await open(state);
  try {
    assert.ok(await until(() => /Cabin Filter/.test(text(app.document))));
    const btn = label => [...app.document.querySelectorAll('#view button')].find(b => b.textContent === label);
    btn('Approve').onclick(); assert.ok(await until(() => state.rpc.length === 1));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(state.rpc[0])), ['decide_plan_draft', { p_id: 5, p_approve: true, p_edit: null }]);
    assert.ok(await until(() => !/Engine Oil/.test(text(app.document))), 'approved draft left the list');
    btn('Reject').onclick(); assert.ok(await until(() => state.rpc.length === 2));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(state.rpc[1])), ['decide_plan_draft', { p_id: 6, p_approve: false, p_edit: null }]);
  } finally { app.cleanup(); }
});

test('review queue: a pending recall shows as text with Approve/Reject', async () => {
  const state = mk({ recalls: [{ campaign: '16V684000', car_model_id: 'm1', component: EVIL, summary: 'Fuel leak', years: [2016] }] }), app = await open(state);
  try {
    assert.ok(await until(() => /16V684000/.test(text(app.document))), text(app.document));
    assert.strictEqual(app.document.querySelector('#view img'), null);
    [...app.document.querySelectorAll('#view button')].filter(b => b.textContent === 'Approve').pop().onclick();
    assert.ok(await until(() => state.recallUpdates.length > 0));
    assert.deepStrictEqual(state.recallUpdates[0].slice(0, 2).map(String), ['campaign', '16V684000']);
    assert.strictEqual(state.recallUpdates[0][2].status, 'approved');
  } finally { app.cleanup(); }
});

test('review queue: empty state and the refresh button', async () => {
  const state = mk(), app = await open(state);
  try {
    assert.ok(await until(() => /Nothing waiting for review/.test(text(app.document))), text(app.document));
    [...app.document.querySelectorAll('#view button')].find(b => b.textContent === 'Check Mazda sources now').onclick();
    assert.ok(await until(() => state.invoked.length === 1));
    assert.strictEqual(state.invoked[0][0], 'plan-intake');
  } finally { app.cleanup(); }
});
