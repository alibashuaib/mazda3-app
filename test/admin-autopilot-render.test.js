'use strict';
/* Autopilot card on the Proposals tab (Phase 3, plan 07): banner, kill switch, report, domains, Check now. */
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

const EVIL = '<img src=x onerror=1>';
const NOW = Date.now();
const run = o => Object.assign({ id: 1, kind: 'monthly', car_model_id: null, status: 'done',
  started_at: new Date(NOW - 86400000).toISOString(), finished_at: new Date(NOW - 86400000).toISOString(),
  report: { proposals: { schedule_item: { inserted: 3, noop: 1 } }, cost_sar: 4.5, searches: 2, llm_calls: 5,
    skipped_sources: [{ url: EVIL, reason: EVIL }], failed_jobs: [] } }, o);

function stub(s) {
  return { createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
    rpc: (name, args) => { s.rpc.push([name, args]); return Promise.resolve({ data: { ok: true }, error: null }); },
    functions: { invoke: (name, o) => { s.invoke.push(o.body); return Promise.resolve({ data: o.body.action === 'preview'
      ? { ok: true, estimate: { sar: 1.234, searches: 3, llm_calls: 4, skipped: ['a', 'b'] } } : { ok: true, run_id: 9 }, error: null }); } },
    from: table => {
      const rows = ({ profiles: { role: 'admin' }, car_models: [{ id: 'm1', model: 'CX-5', generation: 'KF', engine: '2.5L', status: 'approved' }],
        autopilot_config: { enabled: true, monthly_cap_sar: 50 }, autopilot_spend: [], autopilot_runs: s.runs,
        source_domains: [{ host: 'evil<b>.example', status: 'pending', first_seen: 'x' }, { host: 'ok.example', status: 'approved', first_seen: 'y' }],
        autopilot_item_status: [{ car_model_id: 'm1', kind: 'schedule_item', target_key: 'Engine Oil', last_verified_at: null, missed_runs: 3 }],
        proposals: [], change_log: [] })[table] ?? [];
      const p = () => Promise.resolve({ data: rows, error: null });
      const c = { then: (a, b) => p().then(a, b), catch: b => p().catch(b) };
      ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'maybeSingle', 'insert', 'update', 'range', 'gte'].forEach(k => { c[k] = () => c; });
      return c;
    }
  }) };
}
async function until(fn) {
  const deadline = Date.now() + 2000;
  while (!fn() && Date.now() < deadline) await new Promise(r => setImmediate(r));
  return fn();
}
const open = async runs => {
  const s = { runs, rpc: [], invoke: [] };
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub(s) });
  app.api.account.setUserForTest({ id: 'u1' });
  app.api.go('admin');
  return { app, s };
};
const text = app => app.document.querySelector('#view').textContent;
const btn = (app, label) => [...app.document.querySelectorAll('#view button')].find(b => b.textContent === label);

test('failed monthly run shows the banner above the tabs', async () => {
  const { app } = await open([run({ status: 'failed' })]);
  try {
    assert.ok(await until(() => app.document.querySelector('#view [role=tablist]')), text(app));
    const b = app.document.querySelector('#view .proposal-alert.fail');
    assert.match(b.textContent, /last monthly autopilot run failed/);
    assert.ok(b.compareDocumentPosition(app.document.querySelector('#view [role=tablist]')) & 4, 'banner precedes tabs');
  } finally { app.cleanup(); }
});

test('healthy run: no banner; report, domains, unverified render; hostile text is inert', async () => {
  const { app } = await open([run()]);
  try {
    assert.ok(await until(() => /Last run report/.test(text(app))), text(app));
    assert.strictEqual(app.document.querySelector('#view .proposal-alert.fail'), null);
    const t = text(app);
    assert.match(t, /schedule_item: 3 new, 1 unchanged/);
    assert.match(t, /4\.5 SAR/);
    assert.match(t, /Engine Oil\s*missed runs: 3/);
    assert.ok(t.includes('evil<b>.example'));
    assert.strictEqual(app.document.querySelector('#view img'), null);
    assert.strictEqual(app.document.querySelector('#view b'), null);
  } finally { app.cleanup(); }
});

test('kill switch calls autopilot_set_enabled with the flipped value', async () => {
  const { app, s } = await open([run()]);
  try {
    assert.ok(await until(() => btn(app, 'Turn off')));
    btn(app, 'Turn off').onclick();
    assert.ok(await until(() => s.rpc.length === 1));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s.rpc[0])), ['autopilot_set_enabled', { p_enabled: false }]);
  } finally { app.cleanup(); }
});

test('ban asks for confirmation naming permanence, then calls ban_source_domain', async () => {
  const { app, s } = await open([run()]);
  try {
    assert.ok(await until(() => [...app.document.querySelectorAll('#view button')].find(b => /^Ban evil/.test(b.getAttribute('aria-label') || ''))));
    // hostile host is refused by the data layer's host check, so ban the valid one via approve/ban flow instead
    [...app.document.querySelectorAll('#view button')].find(b => b.getAttribute('aria-label') === 'Ban ok.example').onclick();
    const card = app.document.querySelector('#modalCard');
    assert.match(card.textContent, /permanent and automatically rejects its pending proposals/);
    assert.strictEqual(s.rpc.length, 0);
    [...card.querySelectorAll('button')].find(b => b.textContent === 'Ban').onclick();
    assert.ok(await until(() => s.rpc.length === 1));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s.rpc[0])), ['ban_source_domain', { p_host: 'ok.example' }]);
  } finally { app.cleanup(); }
});

test('Check now previews first; Confirm run only appears after the estimate', async () => {
  const { app, s } = await open([run()]);
  try {
    assert.ok(await until(() => btn(app, 'Preview')));
    assert.strictEqual(btn(app, 'Confirm run'), undefined);
    btn(app, 'Preview').onclick();
    assert.ok(await until(() => btn(app, 'Confirm run')), text(app));
    assert.match(text(app), /Estimated cost\s*1\.23 SAR/);
    assert.match(text(app), /3\s*Searches/);
    assert.match(text(app), /4\s*LLM calls/);
    assert.match(text(app), /2\s*Skipped as unchanged/);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s.invoke)), [{ action: 'preview', car_model_id: 'm1' }]);
    btn(app, 'Confirm run').onclick();
    assert.ok(await until(() => s.invoke.length === 2));
    assert.strictEqual(s.invoke[1].action, 'run');
  } finally { app.cleanup(); }
});

test('recall and severe proposal diffs render as separate rows', async () => {
  const { app } = await open([run()]);
  try {
    const sev = app.api.proposalDiffLines({ kind: 'schedule_item', before: { severe_km: 5000, severe_months: 6 },
      after: { severe_km: 4000, severe_months: 6.5 } }, '→').map(l => l.textContent);
    assert.deepStrictEqual([...sev], ['Severe km: 5000 → 4000', 'Severe months: 6 → 6.5']);
    const rec = app.api.proposalDiffLines({ kind: 'recall', after: { campaign: EVIL, component: 'Airbag' } }, '→');
    assert.strictEqual(rec.length, 2);
    assert.strictEqual(rec[0].querySelector('img'), null);
    assert.ok(rec[0].textContent.includes('<img'));
  } finally { app.cleanup(); }
});
