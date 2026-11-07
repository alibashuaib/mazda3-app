'use strict';
/* Autopilot orchestration with fake deps: order of reserve vs paid calls, hash skip, domain handling,
   preview cost, cap/kill stops, and a static guard on index.ts (no direct live writes). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PRICES = { usd_sar: 3.75, search_per_call: 0.01, models: {
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cache_read: 0.01, cache_write: 0.125 },
  'claude-sonnet-5-5': { in: 2, out: 10, cache_read: 0.1, cache_write: 2.5 } } };
const SENTENCE = 'Engine oil and filter: replace every 10,000 km or 12 months under normal conditions.';
const PAGE = `<html><body><p>${SENTENCE}</p></body></html>`;
const CAR = { id: 'm3-bp', name: 'Mazda 3 BP', make: 'Mazda', model: '3', generation: 'BP · 2019-20', engine: null };
const LIVE = [{ service: 'Engine oil', interval_km: 5000, interval_months: 6, severe_km: null, severe_months: null, note: '', parts: [] }];
const searchResp = urls => ({ content: [{ type: 'web_search_tool_result', content: urls.map(url => ({ url })) }], usage: { input_tokens: 100, output_tokens: 50 } });
const extractResp = () => ({ content: [{ type: 'text', text: JSON.stringify({ items: [{ service: 'Engine oil', generation: null, engine: null,
  normal: { km: 10000, months: 12, miles: null, quote: SENTENCE }, severe: null }] }) }], usage: { input_tokens: 1000, output_tokens: 200 } });
const html = body => ({ ok: true, kind: 'text', body, finalUrl: '' });

// calls records the global order of events so tests can assert reserve precedes every llm call.
function fakes(over = {}) {
  const calls = [];
  const queue = over.llmQueue || [];
  const deps = {
    cfg: { prices: PRICES, gccDomains: [], banned: ['bad.com'], maxUses: 3, discoverModel: 'claude-haiku-5-5', extractModel: 'claude-sonnet-5-5', ...(over.cfg || {}) },
    fetch: async (url, policy) => { calls.push('fetch'); return over.fetch ? over.fetch(url, policy) : html(PAGE); },
    llm: async req => { calls.push('llm'); const r = queue.shift(); deps.requests.push(req); return typeof r === 'function' ? r() : r; },
    requests: [],
    db: {
      reserve: async () => { calls.push('reserve'); return over.reserve ? over.reserve(calls) : { ok: true, reservation_id: 7 }; },
      settle: async () => { calls.push('settle'); return over.settle ? over.settle() : { ok: true, sar: 0.01, over: false }; },
      endRun: async (run, st) => { calls.push('end:' + st); },
      seeDomain: async h => (over.domains || {})[h] || 'pending',
      loadCar: async () => CAR,
      loadLive: async () => LIVE,
      getCandidates: async () => over.candidates || [],
      getSourceHash: async () => (over.hash === undefined ? null : over.hash),
      setSourceHash: async (c, u, h) => { calls.push('sethash'); deps.hashed.push([u, h]); },
      stageFindings: async (run, car, kind, rows) => { calls.push('stage'); deps.staged.push({ kind, rows }); },
      knownSources: async () => over.known || [],
    },
    hashed: [], staged: [],
  };
  return { deps, calls };
}
const llmAfterReserve = calls => calls.every((c, i) => c !== 'llm' || calls[i - 1] === 'reserve');

let flow;
test.before(async () => { flow = await import('../supabase/functions/autopilot/flow.mjs'); });

test('discover: reserve precedes llm, banned dropped, pending held, approved kept', async () => {
  const { deps, calls } = fakes({
    cfg: { gccDomains: ['gcc.example'] },
    llmQueue: [searchResp(['https://ok.com/a', 'https://held.com/b', 'https://bad.com/c'])],
    domains: { 'ok.com': 'approved', 'held.com': 'pending' },
  });
  const r = await flow.runDiscover({ run_id: 1, car_model_id: CAR.id }, deps);
  assert.deepEqual(r.notes.candidates, ['https://ok.com/a']);
  assert.equal(r.notes.skipped.length, 1);
  assert.match(r.notes.skipped[0], /held\.com/);
  assert.ok(llmAfterReserve(calls));
  assert.ok(deps.requests[0].tools[0].allowed_domains, 'pass 1 uses GCC allowed_domains');
});

test('discover: pass 2 runs only when pass 1 finds nothing, with blocked_domains', async () => {
  const { deps, calls } = fakes({ cfg: { gccDomains: ['gcc.example'] }, llmQueue: [searchResp([]), searchResp(['https://ok.com/a'])], domains: { 'ok.com': 'approved' } });
  const r = await flow.runDiscover({ run_id: 1, car_model_id: CAR.id }, deps);
  assert.deepEqual(r.notes.candidates, ['https://ok.com/a']);
  assert.equal(calls.filter(c => c === 'llm').length, 2);
  assert.ok(deps.requests[1].tools[0].blocked_domains && !deps.requests[1].tools[0].allowed_domains);
  assert.ok(llmAfterReserve(calls));
});

test('extract: stages verified finding with evidence, hash saved after stage', async () => {
  const { deps, calls } = fakes({ candidates: ['https://ok.com/a'], llmQueue: [extractResp()] });
  const r = await flow.runExtract({ run_id: 1, car_model_id: CAR.id }, deps);
  assert.equal(r.notes.unchanged, false);
  const row = deps.staged[0].rows[0];
  assert.equal(row.target_key, 'Engine oil');
  assert.equal(row.verified, true);
  assert.equal(row.after.interval_km, 10000);
  assert.equal(row.evidence[0].tier, 'official');
  assert.equal(row.evidence[0].url, 'https://ok.com/a');
  assert.ok(row.evidence[0].content_hash);
  assert.ok(calls.indexOf('stage') < calls.indexOf('sethash'));
  assert.ok(llmAfterReserve(calls));
});

test('extract: unchanged hash skips the LLM entirely', async () => {
  const { htmlToText, sha256Hex } = await import('../supabase/functions/plan-intake/logic.mjs');
  const same = await sha256Hex(htmlToText(PAGE));
  const { deps, calls } = fakes({ candidates: ['https://ok.com/a'], hash: same });
  const r = await flow.runExtract({ run_id: 1, car_model_id: CAR.id }, deps);
  assert.equal(calls.includes('llm'), false);
  assert.equal(calls.includes('reserve'), false);
  assert.equal(r.notes.unchanged, true);
});

test('extract: pdf and fetch failures are listed as skipped', async () => {
  const { deps } = fakes({ candidates: ['https://ok.com/a.pdf', 'https://ok.com/b'],
    fetch: url => (url.endsWith('.pdf') ? { ok: true, kind: 'pdf', body: 'x' } : { ok: false, error: 'robots' }) });
  const r = await flow.runExtract({ run_id: 1, car_model_id: CAR.id }, deps);
  assert.deepEqual(r.notes.skipped, ['https://ok.com/a.pdf: pdf', 'https://ok.com/b: robots']);
  assert.equal(r.notes.unchanged, false);
});

test('kill switch flipped between two LLM calls stops at the second; nothing staged', async () => {
  let n = 0;
  const { deps, calls } = fakes({
    candidates: ['https://ok.com/a', 'https://ok.com/b'], llmQueue: [extractResp(), extractResp()],
    reserve: () => (++n === 1 ? { ok: true, reservation_id: 1 } : { ok: false, reason: 'killed' }),
  });
  const r = await flow.runExtract({ run_id: 1, car_model_id: CAR.id }, deps);
  assert.equal(r.stop, 'stopped');
  assert.equal(calls.filter(c => c === 'llm').length, 1);
  assert.ok(calls.includes('end:stopped'));
  assert.equal(deps.staged.length, 0);
  assert.equal(deps.hashed.length, 0);
});

test('cap reply ends the run capped and stages nothing', async () => {
  const { deps, calls } = fakes({ candidates: ['https://ok.com/a'], reserve: () => ({ ok: false, reason: 'cap' }) });
  const r = await flow.runExtract({ run_id: 1, car_model_id: CAR.id }, deps);
  assert.equal(r.stop, 'capped');
  assert.ok(calls.includes('end:capped'));
  assert.equal(calls.includes('llm'), false);
  assert.equal(deps.staged.length, 0);
});

test('settle over=true stops the run', async () => {
  const { deps, calls } = fakes({ candidates: ['https://ok.com/a'], llmQueue: [extractResp()], settle: () => ({ ok: true, sar: 9, over: true }) });
  const r = await flow.runExtract({ run_id: 1, car_model_id: CAR.id }, deps);
  assert.equal(r.stop, 'capped');
  assert.ok(calls.includes('end:capped'));
  assert.equal(deps.staged.length, 0);
});

test('run already ended: stop without calling end_run', async () => {
  const { deps, calls } = fakes({ candidates: ['https://ok.com/a'], reserve: () => ({ ok: false, reason: 'run_ended' }) });
  const r = await flow.runExtract({ run_id: 1, car_model_id: CAR.id }, deps);
  assert.equal(r.stop, 'ended');
  assert.equal(calls.some(c => c.startsWith('end:')), false);
});

test('preview: zero paid calls; never-checked car is worst-case', async () => {
  const { deps, calls } = fakes({ known: [] });
  const r = await flow.runPreview(CAR.id, deps);
  assert.equal(r.basis, 'worst-case');
  assert.ok(r.sar > 0);
  assert.equal(r.llm_calls, 1 + flow.MAX_CANDIDATES);
  assert.equal(calls.includes('llm'), false);
  assert.equal(calls.includes('reserve'), false);
});

test('preview: known unchanged source is skipped and costs less', async () => {
  const { htmlToText, sha256Hex } = await import('../supabase/functions/plan-intake/logic.mjs');
  const same = await sha256Hex(htmlToText(PAGE));
  const worst = await flow.runPreview(CAR.id, fakes({ known: [] }).deps);
  const { deps, calls } = fakes({ known: ['https://ok.com/a'], hash: same });
  const r = await flow.runPreview(CAR.id, deps);
  assert.equal(r.basis, 'known-sources');
  assert.deepEqual(r.skipped, ['https://ok.com/a']);
  assert.ok(r.sar < worst.sar);
  assert.equal(calls.includes('llm'), false);
});

test('failed llm call settles its reservation at zero, then the error propagates', async () => {
  const settled = [];
  const { deps, calls } = fakes({
    candidates: ['https://ok.com/a'],
    llmQueue: [() => { throw new Error('anthropic 503'); }],
    settle: () => { settled.push(true); return { ok: true, sar: 0, over: false }; },
  });
  await assert.rejects(flow.runExtract({ run_id: 1, car_model_id: CAR.id }, deps), /anthropic 503/);
  assert.equal(settled.length, 1);
  assert.ok(calls.indexOf('settle') > calls.indexOf('llm'));
});

test('recalls: NHTSA rows staged as kind recall, no reserve', async () => {
  const body = JSON.stringify({ results: [{ NHTSACampaignNumber: '20V123', Component: 'AIR BAGS', Summary: 'Inflator may rupture.', Remedy: 'Replace inflator.' }] });
  const urls = [];
  const { deps, calls } = fakes({ fetch: (url, policy) => { urls.push([url, policy]); return { ok: true, kind: 'json', body }; } });
  const r = await flow.runRecalls({ run_id: 1, car_model_id: CAR.id }, deps);
  assert.equal(r.ok, true);
  assert.equal(deps.staged[0].kind, 'recall');
  assert.equal(deps.staged[0].rows[0].target_key, '20V123');
  assert.deepEqual(deps.staged[0].rows[0].after.years, [2019, 2020]);
  assert.match(urls[0][0], /^https:\/\/api\.nhtsa\.gov\//);
  assert.equal(calls.includes('reserve'), false);
});

test('index.ts: no direct live/proposal writes, only Anthropic bare fetch, imports resolve', () => {
  const dir = path.join(__dirname, '..', 'supabase', 'functions', 'autopilot');
  const src = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  assert.equal(/from\(\s*['"](proposals|dealer_plan_items|recalls|change_log)['"]\s*\)\s*\.(insert|update|upsert|delete)/.test(src), false);
  assert.equal(/submit_proposal/.test(src), false);
  for (const m of src.matchAll(/fetch\(\s*([^,)]+)/g)) assert.match(m[1], /api\.anthropic\.com|^url$/);
  for (const m of src.matchAll(/from '(\.[^']+)'/g)) assert.ok(fs.existsSync(path.join(dir, m[1])), m[1]);
});

test('extract: redirect to another host is skipped, nothing staged or paid', async () => {
  const { deps, calls } = fakes({ candidates: ['https://ok.com/a'],
    fetch: () => ({ ok: true, kind: 'text', body: PAGE, finalUrl: 'https://evil.com/a' }) });
  const r = await flow.runExtract({ run_id: 1, car_model_id: CAR.id }, deps);
  assert.deepEqual(r.notes.skipped, ['https://ok.com/a: redirected to other host']);
  assert.ok(deps.staged.every(s => s.rows.length === 0));
  assert.equal(calls.includes('reserve'), false);
});

test('recalls: NHTSA redirected off api.nhtsa.gov is not staged', async () => {
  const body = JSON.stringify({ results: [{ NHTSACampaignNumber: '20V123', Component: 'AIR BAGS', Summary: 's', Remedy: 'r' }] });
  const { deps } = fakes({ fetch: () => ({ ok: true, kind: 'json', body, finalUrl: 'https://evil.com/x' }) });
  await assert.rejects(flow.runRecalls({ run_id: 1, car_model_id: CAR.id }, deps), /nhtsa unavailable/);
  assert.equal(deps.staged.length, 0);
});
