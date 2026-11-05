'use strict';
/* Proposals tab (Phase 2, plan 01): list, expand, escaped evidence, approve. */
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

const EVIL = '<img src=x onerror="alert(1)">';
function stub(state) {
  return { createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
    rpc: (name, args) => {
      state.rpc.push([name, args]);
      if (name === 'apply_proposal' && !state.rpcResult[name]) state.proposals = state.proposals.filter(p => p.id !== args.p_id);
      return Promise.resolve(state.rpcResult[name] || { data: { ok: true, change_id: 1 }, error: null });
    },
    functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
    from: table => {
      const p = () => {
        if (table === 'proposals') return state.propFail ? Promise.resolve({ data: null, error: {} }) : Promise.resolve({ data: state.proposals, error: null });
        const rows = ({ profiles: { role: 'admin' }, car_models: [{ id: 'm1', model: 'CX-5', generation: 'KF', engine: '2.5L', status: 'approved' }],
          dealer_plan_items: [], plan_drafts: [], schedule_sources: [], recalls: [], app_errors: [] })[table];
        return Promise.resolve({ data: rows, error: null });
      };
      const c = { then: (a, b) => p().then(a, b), catch: b => p().catch(b) };
      ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'maybeSingle', 'insert', 'update', 'range'].forEach(k => { c[k] = () => c; });
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
const prop = o => Object.assign({
  id: 7, run_id: 101, kind: 'schedule_item', maker_id: 'mazda', car_model_id: 'm1', target_key: 'Engine Oil', op: 'update',
  before: { interval_km: 10000, interval_months: 12, note: 'old', parts: [] },
  after: { interval_km: 15000, interval_months: 12, note: 'old', parts: [] },
  evidence: [{ url: 'https://mazda.example/manual.pdf', tier: 'official', fetched_at: '2026-11-01T00:00:00Z', content_hash: 'h', quote: 'Change oil every 15000 km' }],
  confidence_tier: 'high', confidence_factors: { best_tier: 'official', domains: 2, change_pct: 50, score: 3 },
  reason: 'Manual differs', created_at: '2026-11-02T00:00:00Z'
}, o);
const open = async (state) => {
  const s = Object.assign({ proposals: [], rpc: [], rpcResult: {} }, state);
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub(s) });
  app.api.account.setUserForTest({ id: 'u1' });
  app.api.go('admin');
  return { app, s };
};
const tab = (app, label) => [...app.document.querySelectorAll('#view [role=tab]')].find(b => b.textContent.startsWith(label));
const btn = (app, label) => [...app.document.querySelectorAll('#view button')].find(b => b.textContent === label);
const row = app => app.document.querySelector('#view [role=button][aria-expanded]');

test('proposals tab is the default, badge counts pending, row shows car, kind, diff, pill, run', async () => {
  const { app } = await open({ proposals: [prop(), prop({ id: 8, target_key: 'Cabin Filter' })] });
  try {
    assert.ok(await until(() => tab(app, 'Proposals')), text(app.document));
    assert.strictEqual(tab(app, 'Proposals').textContent, 'Proposals (2)');
    assert.strictEqual(tab(app, 'Proposals').getAttribute('aria-selected'), 'true');
    assert.ok(await until(() => /Engine Oil/.test(text(app.document))), text(app.document));
    const t = text(app.document);
    assert.match(t, /CX-5 KF/);
    assert.match(t, /10000 → 15000/);
    assert.match(t, /Run 101/);
    const pill = app.document.querySelector('#view .proposal-row .pill');
    assert.strictEqual(pill.textContent, 'High');
    assert.ok(pill.className.includes('ok'));
  } finally { app.cleanup(); }
});

test('tapping a row expands diff, quote and an https hostname link', async () => {
  const { app } = await open({ proposals: [prop()] });
  try {
    assert.ok(await until(() => row(app)));
    assert.strictEqual(row(app).getAttribute('aria-expanded'), 'false');
    row(app).onclick();
    assert.strictEqual(row(app).getAttribute('aria-expanded'), 'true');
    assert.match(text(app.document), /Change oil every 15000 km/);
    const a = app.document.querySelector('#view .proposal-row a');
    assert.strictEqual(a.textContent, 'mazda.example');
    assert.ok(a.getAttribute('href').startsWith('https://'));
    assert.strictEqual(a.getAttribute('rel'), 'noopener noreferrer');
    assert.strictEqual(a.getAttribute('target'), '_blank');
  } finally { app.cleanup(); }
});

test('injection payloads render as inert text, bad links are refused', async () => {
  const p = prop({
    target_key: EVIL, reason: EVIL,
    after: { interval_km: 15000, interval_months: 12, note: EVIL, parts: [] },
    evidence: [
      { url: 'javascript:alert(1)', tier: 'community', fetched_at: '2026-11-01T00:00:00Z', quote: EVIL },
      { url: 'https://a.test/"><script>', tier: 'community', fetched_at: '2026-11-01T00:00:00Z', quote: EVIL }]
  });
  const { app } = await open({ proposals: [p] });
  try {
    assert.ok(await until(() => row(app)));
    row(app).onclick();
    const v = app.document.querySelector('#view');
    assert.strictEqual(v.querySelector('img'), null);
    assert.strictEqual(v.querySelector('script'), null);
    assert.strictEqual(v.querySelector('a[href^="javascript"]'), null);
    assert.ok(v.textContent.includes('<img src=x'));
    assert.ok(v.textContent.includes('Invalid source link'));
  } finally { app.cleanup(); }
});

test('Approve calls apply_proposal and the row leaves the list', async () => {
  const { app, s } = await open({ proposals: [prop()] });
  try {
    assert.ok(await until(() => row(app)));
    row(app).onclick();
    const b = btn(app, 'Approve');
    assert.strictEqual(b.getAttribute('aria-label'), 'Approve Engine Oil');
    b.onclick();
    assert.ok(await until(() => s.rpc.length === 1));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s.rpc[0])), ['apply_proposal', { p_id: 7, p_edit: null, p_seen_hash: null }]);
    assert.ok(await until(() => !row(app)), 'row gone after refetch');
  } finally { app.cleanup(); }
});

test('a failed Approve shows an inline error and keeps the row', async () => {
  const { app } = await open({ proposals: [prop()], rpcResult: { apply_proposal: { data: null, error: { message: 'x' } } } });
  try {
    assert.ok(await until(() => row(app)));
    row(app).onclick();
    btn(app, 'Approve').onclick();
    assert.ok(await until(() => /Could not save\. Check your connection\./.test(text(app.document))), text(app.document));
    assert.ok(row(app));
  } finally { app.cleanup(); }
});

test('load failure shows a message and Try again', async () => {
  const { app } = await open({ propFail: true });
  try {
    assert.ok(await until(() => /Could not load proposals\. Check your connection and try again\./.test(text(app.document))), text(app.document));
    assert.ok(btn(app, 'Try again'));
  } finally { app.cleanup(); }
});

test('no pending rows shows the empty state', async () => {
  const { app } = await open({});
  try {
    assert.ok(await until(() => /No proposals waiting/.test(text(app.document))), text(app.document));
  } finally { app.cleanup(); }
});

test('Review queue tab still renders the legacy queue', async () => {
  const { app } = await open({});
  try {
    assert.ok(await until(() => tab(app, 'Review queue')));
    tab(app, 'Review queue').onclick();
    assert.ok(await until(() => /Nothing waiting for review/.test(text(app.document))), text(app.document));
  } finally { app.cleanup(); }
});
