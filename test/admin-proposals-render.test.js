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
      if ((name === 'apply_proposal' || name === 'reject_proposal') && !state.rpcResult[name]) state.proposals = state.proposals.filter(p => p.id !== args.p_id);
      return Promise.resolve(state.rpcResult[name] || { data: { ok: true, change_id: 1 }, error: null });
    },
    functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
    from: table => {
      (state.fromCalls = state.fromCalls || []).push(table);
      const p = () => {
        if (table === 'change_log') return state.changeFail ? Promise.resolve({ data: null, error: {} }) : Promise.resolve({ data: state.changes || [], error: null });
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

test('filters narrow the list in memory, Clear restores, empty match message', async () => {
  const { app, s } = await open({ proposals: [prop(), prop({ id: 8, target_key: 'Cabin Filter', confidence_tier: 'low', run_id: 102 })] });
  const fetches = () => s.fromCalls.filter(x => x === 'proposals').length;
  try {
    assert.ok(await until(() => row(app)));
    const n = fetches();
    const sels = [...app.document.querySelectorAll('#view select[data-f]')];
    assert.strictEqual(sels.length, 4);
    assert.strictEqual(sels[0].options[0].textContent, 'All');
    assert.strictEqual(btn(app, 'Clear filters'), undefined);
    const tier = app.document.querySelector('select[data-f=tier]');
    tier.value = 'high'; tier.onchange();
    assert.ok(/Engine Oil/.test(text(app.document)) && !/Cabin Filter/.test(text(app.document)));
    assert.ok(btn(app, 'Clear filters'));
    const run = app.document.querySelector('select[data-f=run]');
    run.value = '102'; run.onchange();
    assert.match(text(app.document), /No proposals match these filters/);
    btn(app, 'Clear filters').onclick();
    assert.ok(/Engine Oil/.test(text(app.document)) && /Cabin Filter/.test(text(app.document)));
    assert.strictEqual(btn(app, 'Clear filters'), undefined);
    assert.strictEqual(fetches(), n, 'no refetch');
  } finally { app.cleanup(); }
});

const setK = (app, k, v) => { app.document.querySelector(`#view [data-k=${k}]`).value = v; };
test('Edit approves the edited value with a null seen hash', async () => {
  const { app, s } = await open({ proposals: [prop()] });
  try {
    assert.ok(await until(() => row(app)));
    row(app).onclick();
    const e = btn(app, 'Edit'); assert.strictEqual(e.getAttribute('aria-label'), 'Edit Engine Oil');
    e.onclick();
    assert.strictEqual(app.document.querySelector('#view [data-k=interval_km]').value, '15000');
    setK(app, 'interval_km', '9000'); setK(app, 'note', 'x'); setK(app, 'parts', 'Filter | F1 | 2');
    btn(app, 'Approve edited value').onclick();
    assert.ok(await until(() => s.rpc.length === 1));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s.rpc[0])), ['apply_proposal', { p_id: 7,
      p_edit: { interval_km: 9000, interval_months: 12, note: 'x', parts: [{ name: 'Filter', part_no: 'F1', qty: 2 }] }, p_seen_hash: null }]);
  } finally { app.cleanup(); }
});

test('stale approve shows the live value, keeps the row, edit uses the live hash; live text is inert', async () => {
  const live = { interval_km: 25000, interval_months: 12, note: EVIL, parts: [] };
  const { app, s } = await open({ proposals: [prop()], rpcResult: { apply_proposal: { data: { ok: false, error: 'stale', live, live_hash: 'h1' }, error: null } } });
  try {
    assert.ok(await until(() => row(app)));
    row(app).onclick();
    btn(app, 'Approve').onclick();
    assert.ok(await until(() => app.document.querySelector('#view .proposal-alert')));
    const al = app.document.querySelector('#view .proposal-alert');
    assert.strictEqual(al.getAttribute('role'), 'alert');
    assert.match(al.textContent, /Live value changed/);
    assert.match(al.textContent, /25000/);
    assert.strictEqual(al.querySelector('img'), null);
    assert.ok(row(app));
    btn(app, 'Edit').onclick();
    assert.strictEqual(app.document.querySelector('#view [data-k=interval_km]').value, '25000');
    btn(app, 'Approve edited value').onclick();
    assert.ok(await until(() => s.rpc.length === 2));
    assert.strictEqual(s.rpc[1][1].p_seen_hash, 'h1');
  } finally { app.cleanup(); }
});

test('Reject shows a reason box, sends the text, and the row leaves', async () => {
  const { app, s } = await open({ proposals: [prop()] });
  try {
    assert.ok(await until(() => row(app)));
    row(app).onclick();
    const rb = btn(app, 'Reject');
    assert.strictEqual(rb.className, 'btn ghost reject');
    assert.strictEqual(rb.getAttribute('aria-label'), 'Reject Engine Oil');
    rb.onclick();
    const ta = app.document.querySelector('#view textarea[data-k=reason]');
    assert.strictEqual(ta.getAttribute('maxlength'), '300');
    assert.strictEqual(ta.getAttribute('placeholder'), 'Why is this wrong or not useful?');
    ta.value = 'dup';
    btn(app, 'Reject proposal').onclick();
    assert.ok(await until(() => s.rpc.length === 1));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s.rpc[0])), ['reject_proposal', { p_id: 7, p_reason: 'dup' }]);
    assert.ok(await until(() => !row(app)));
  } finally { app.cleanup(); }
});

test('Reject failure keeps the row; reason and submitter note stay inert text', async () => {
  const { app, s } = await open({ proposals: [prop({ reason: EVIL })], rpcResult: { reject_proposal: { data: null, error: { message: 'x' } } } });
  try {
    assert.ok(await until(() => row(app)));
    row(app).onclick();
    assert.strictEqual(app.document.querySelector('#view .proposal-panel img'), null);
    btn(app, 'Reject').onclick();
    app.document.querySelector('#view textarea[data-k=reason]').value = EVIL;
    btn(app, 'Reject proposal').onclick();
    assert.ok(await until(() => /Could not save/.test(text(app.document))));
    assert.strictEqual(s.rpc[0][1].p_reason, EVIL);
    assert.ok(row(app));
    assert.strictEqual(app.document.querySelector('#view img'), null);
  } finally { app.cleanup(); }
});

const bulk = app => [...app.document.querySelectorAll('#view button')].find(b => /^Approve \d+ high-confidence$/.test(b.textContent));
const three = () => [prop({ id: 1 }), prop({ id: 2, target_key: 'Cabin Filter' }), prop({ id: 3, target_key: 'Spark Plug', confidence_tier: 'low' })];

test('bulk bar counts filtered high rows, hides at zero, modal defaults to Cancel', async () => {
  const { app, s } = await open({ proposals: three() });
  try {
    assert.ok(await until(() => bulk(app)));
    assert.strictEqual(bulk(app).textContent, 'Approve 2 high-confidence');
    const sel = app.document.querySelector('#view select[data-f=tier]');
    sel.value = 'low'; sel.onchange();
    assert.strictEqual(bulk(app), undefined);
    sel.value = ''; sel.onchange();
    bulk(app).onclick();
    const card = app.document.querySelector('#modalCard');
    assert.strictEqual(card.querySelector('h2').textContent, 'Approve high-confidence proposals');
    assert.match(card.textContent, /Approve 2 high-confidence proposals\? Each one changes the live catalogue for all users\./);
    assert.strictEqual(card.querySelector('button').textContent, 'Cancel');
    card.querySelector('button').onclick();
    assert.strictEqual(s.rpc.length, 0);
  } finally { app.cleanup(); }
});

test('bulk confirm sends only high ids and reports per-item failures', async () => {
  const { app, s } = await open({ proposals: three(), rpcResult: { apply_proposals: { data: [{ id: 1, ok: true }, { id: 2, ok: false, error: 'stale' }], error: null } } });
  try {
    assert.ok(await until(() => bulk(app)));
    bulk(app).onclick();
    [...app.document.querySelectorAll('#modalCard button')].find(b => b.textContent === 'Approve 2').onclick();
    assert.ok(await until(() => /1 approved, 1 failed/.test(text(app.document))), text(app.document));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s.rpc[0])), ['apply_proposals', { p_ids: [1, 2], p_tier: 'high' }]);
    const al = app.document.querySelector('#view [role=alert]');
    assert.match(al.textContent, /CX-5 KF · Cabin Filter: Live value changed/);
  } finally { app.cleanup(); }
});

test('bulk rpc failure shows the connection message and no counts', async () => {
  const { app } = await open({ proposals: three(), rpcResult: { apply_proposals: { data: null, error: { message: 'x' } } } });
  try {
    assert.ok(await until(() => bulk(app)));
    bulk(app).onclick();
    [...app.document.querySelectorAll('#modalCard button')].find(b => b.textContent === 'Approve 2').onclick();
    assert.ok(await until(() => /Could not save\. Check your connection\./.test(app.document.body.textContent)));
    assert.doesNotMatch(text(app.document), /approved,/);
  } finally { app.cleanup(); }
});

const chg = o => Object.assign({
  id: 20, made_at: '2026-11-03T10:00:00Z', kind: 'schedule_item', car_model_id: 'm1', row_key: 'Engine Oil', op: 'update',
  before: { interval_km: 10000, interval_months: 12, note: '', parts: [] },
  after: { interval_km: 15000, interval_months: 12, note: '', parts: [] }, proposal_id: 7, reverts_id: null
}, o);
const revertBtn = app => [...app.document.querySelectorAll('#view button')].find(b => b.textContent === 'Revert');

test('recent approvals: empty list, load failure keeps the queue', async () => {
  let { app } = await open({ proposals: [prop()] });
  try {
    assert.ok(await until(() => /Recent approvals/.test(text(app.document))), text(app.document));
    assert.match(text(app.document), /No approvals yet/);
  } finally { app.cleanup(); }
  ({ app } = await open({ proposals: [prop()], changeFail: true }));
  try {
    assert.ok(await until(() => /Recent approvals/.test(text(app.document))));
    assert.match(text(app.document), /Engine Oil/);
    assert.match(text(app.document), /Could not load proposals/);
  } finally { app.cleanup(); }
});

test('revert is one click, no modal; refetch shows the revert row with its own Revert', async () => {
  const { app, s } = await open({ changes: [chg()] });
  try {
    assert.ok(await until(() => revertBtn(app)), text(app.document));
    assert.match(text(app.document), /2026-11-03 · CX-5 KF · Engine Oil/);
    assert.match(text(app.document), /10000 → 15000/);
    assert.strictEqual(revertBtn(app).getAttribute('aria-label'), 'Revert Engine Oil');
    s.changes = [chg({ id: 21, reverts_id: 20, before: chg().after, after: chg().before }), chg()];
    revertBtn(app).onclick();
    assert.ok(await until(() => /Reverted: 2026-11-03/.test(text(app.document))), text(app.document));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s.rpc[0])), ['revert_change', { p_change_id: 20 }]);
    const m = app.document.querySelector('.modal');
    assert.ok(!m || m.hidden || !m.textContent.trim());
    assert.strictEqual([...app.document.querySelectorAll('#view button')].filter(b => b.textContent === 'Revert').length, 2);
  } finally { app.cleanup(); }
});

test('drifted revert shows the message, no toast; row_key is escaped', async () => {
  const { app } = await open({ changes: [chg({ row_key: '<img src=x onerror=1>' })],
    rpcResult: { revert_change: { data: { ok: false, error: 'drifted', live: {} }, error: null } } });
  try {
    assert.ok(await until(() => revertBtn(app)));
    revertBtn(app).onclick();
    assert.ok(await until(() => /Newer change exists\. Revert that one first\./.test(text(app.document))), text(app.document));
    assert.strictEqual(app.document.querySelectorAll('#view img').length, 0);
    assert.doesNotMatch(app.document.body.textContent, /Reverted(?!:)/);
  } finally { app.cleanup(); }
});
