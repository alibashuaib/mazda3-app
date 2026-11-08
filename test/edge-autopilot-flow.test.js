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
      settle: async (id, model, usage) => { calls.push('settle'); return over.settle ? over.settle(usage) : { ok: true, sar: 0.01, over: false }; },
      endRun: async (run, st) => { calls.push('end:' + st); },
      seeDomain: async h => (over.domains || {})[h] || 'pending',
      loadCar: async () => CAR,
      loadLive: async () => LIVE,
      getCandidates: async () => over.candidates || [],
      getSourceHash: async () => (over.hash === undefined ? null : over.hash),
      stageSourceHash: async (run, c, u, h) => { calls.push('sethash'); deps.hashed.push([u, h]); },
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
  const { deps, calls } = fakes({ cfg: { gccDomains: ['ok.com'] }, candidates: ['https://ok.com/a'], llmQueue: [extractResp()] });
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

test('extract: a page from outside the owner GCC host list is secondary, not official (WR-05)', async () => {
  const { deps } = fakes({ cfg: { gccDomains: ['gcc.example'] }, candidates: ['https://ok.com/a'], llmQueue: [extractResp()] });
  await flow.runExtract({ run_id: 1, car_model_id: CAR.id }, deps);
  assert.equal(deps.staged[0].rows[0].evidence[0].tier, 'secondary');
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
  assert.equal(r.llm_calls, 2 + flow.MAX_CANDIDATES);   // + the parts search
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

test('failed llm call (5xx / timeout) settles at the worst case, a 4xx at zero; the error propagates', async () => {
  for (const [msg, free] of [['anthropic 503', false], ['The operation timed out', false], ['anthropic 400', true]]) {
    const settled = [];
    const { deps, calls } = fakes({
      candidates: ['https://ok.com/a'],
      llmQueue: [() => { throw new Error(msg); }],
      settle: u => { settled.push(u); return { ok: true, sar: 0, over: false }; },
    });
    await assert.rejects(flow.runExtract({ run_id: 1, car_model_id: CAR.id }, deps), new RegExp(msg));
    assert.equal(settled.length, 1);
    assert.ok(calls.indexOf('settle') > calls.indexOf('llm'));
    if (free) assert.deepEqual(settled[0], {});
    else { assert.equal(settled[0].output_tokens, flow.EXTRACT_MAX_TOKENS); assert.ok(settled[0].input_tokens > 0); }
  }
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

/* ---- parts job (04-06) ---- */
const PCAR = { id: 'm3-bp', name: 'Mazda 3 BP', make: 'Mazda', model: '3', generation: 'BP · 2019-20', engine: '2.5L' };
const OILF = { car_model_id: 'm3-bp', part_name: 'Oil Filter', slot: 'oem', brand: 'Mazda', part_no: '', price: 30, price_basis: 'indicative', note: '' };
const partsResp = (claims, cites) => ({ content: [{ type: 'text', text: JSON.stringify(claims), citations: cites.map(([url, cited_text]) => ({ url, cited_text })) }], usage: { input_tokens: 100, output_tokens: 50 } });
const Q = (pn, price, eng = '2.5L') => `Mazda 3 2019 ${eng} oil filter ${pn} SAR ${price}`;
function partsFakes(over = {}) {
  const f = fakes({ ...over, cfg: { minPct: 0.1, minSar: 5, optionalFloorSar: 8, dealerPriceUrls: {}, ...(over.cfg || {}) } });
  Object.assign(f.deps.db, {
    loadCar: async () => PCAR,
    budgetLeft: async () => (over.budget === undefined ? 100 : over.budget),
    loadLiveParts: async () => (over.live === undefined ? [OILF] : over.live),
    userAgreement: async () => over.users || [],
  });
  return f;
}
const JOB = { run_id: 1, car_model_id: 'm3-bp' };
const OK = { 'a.com': 'approved', 'b.com': 'approved', 'www.a.com': 'approved', 'shop.a.com': 'approved' };

test('parts: below the soft floor skips with no reserve, llm or stage', async () => {
  const { deps, calls } = partsFakes({ budget: 3 });
  const r = await flow.runParts(JOB, deps);
  assert.deepEqual(r.notes.skipped, ['budget']);
  assert.equal(calls.some(c => ['reserve', 'llm', 'stage'].includes(c)), false);
});

test('parts: 2 independent hosts confirm the part number, evidence has both urls', async () => {
  const { deps, calls } = partsFakes({ domains: OK, llmQueue: [partsResp([{ part: 'Oil Filter', part_no: 'PE01-14-302B', price: null, url: 'https://a.com/x' }],
    [['https://a.com/x', Q('PE01-14-302B', 30)], ['https://b.com/y', Q('PE01-14-302B', 31)]])] });
  const r = await flow.runParts(JOB, deps);
  const row = deps.staged[0].rows[0];
  assert.equal(deps.staged[0].kind, 'part');
  assert.equal(row.target_key, 'Oil Filter|oem');
  assert.equal(row.after.part_no, 'PE01-14-302B');
  assert.equal(row.evidence.length, 2);
  assert.ok(llmAfterReserve(calls));
  assert.ok(r.ok);
});

test('parts: two subdomains of one site are a single source', async () => {
  const { deps } = partsFakes({ domains: OK, llmQueue: [partsResp([{ part: 'Oil Filter', part_no: 'PE01-14-302B', price: null, url: 'https://www.a.com/x' }],
    [['https://www.a.com/x', Q('PE01-14-302B', 30)], ['https://shop.a.com/y', Q('PE01-14-302B', 30)]])] });
  const r = await flow.runParts(JOB, deps);
  assert.equal(r.notes.dropped.single_source, 1);
  assert.equal(deps.staged[0].rows.length, 0);
});

test('parts: wrong engine in the quote is dropped', async () => {
  const { deps } = partsFakes({ domains: OK, llmQueue: [partsResp([{ part: 'Oil Filter', part_no: 'PE01-14-302B', price: 30, url: 'https://a.com/x' }],
    [['https://a.com/x', Q('PE01-14-302B', 30, '2.0L')], ['https://b.com/y', Q('PE01-14-302B', 30, '2.0L')]])] });
  const r = await flow.runParts(JOB, deps);
  assert.ok(r.notes.dropped.engine_mismatch >= 1);
  assert.equal(deps.staged[0].rows.length, 0);
});

test('parts: model-claimed price with no matching citation is not staged', async () => {
  const { deps } = partsFakes({ domains: OK, llmQueue: [partsResp([{ part: 'Oil Filter', part_no: null, price: 26, url: 'https://a.com/x' }],
    [['https://a.com/x', Q('PE01-14-302B', 45)]])] });
  const r = await flow.runParts(JOB, deps);
  assert.equal(r.notes.dropped.unverified_price, 1);
  assert.equal(deps.staged[0].rows.length, 0);
});

test('parts: immaterial price dropped, material staged as indicative', async () => {
  const run = async price => {
    const { deps } = partsFakes({ domains: OK, llmQueue: [partsResp([{ part: 'Oil Filter', part_no: null, price, url: 'https://a.com/x' }], [['https://a.com/x', Q('PE01-14-302B', price)]])] });
    const r = await flow.runParts(JOB, deps);
    return { r, rows: deps.staged[0].rows };
  };
  const a = await run(32);
  assert.equal(a.r.notes.dropped.immaterial, 1);
  assert.equal(a.rows.length, 0);
  const b = await run(45);
  assert.equal(b.rows[0].after.price, 45);
  assert.equal(b.rows[0].after.price_basis, 'indicative');
});

test('parts: dealer page price staged as dealer/official; fetch error is skipped, not thrown', async () => {
  const dealer = { 'm3-bp': 'https://dealer.example/parts' };
  const quote = 'Oil Filter genuine 33 SAR each';
  const page = `<html><body><p>${quote}</p></body></html>`;
  const resp = { content: [{ type: 'text', text: JSON.stringify({ items: [{ part: 'Oil Filter', price: 33, quote }] }) }], usage: { input_tokens: 10, output_tokens: 10 } };
  const a = partsFakes({ cfg: { dealerPriceUrls: dealer }, fetch: () => html(page), llmQueue: [resp, partsResp([], [])] });
  await flow.runParts(JOB, a.deps);
  const row = a.deps.staged[0].rows[0];
  assert.equal(row.after.price_basis, 'dealer');
  assert.equal(row.evidence[0].tier, 'official');
  assert.ok(llmAfterReserve(a.calls));
  const b = partsFakes({ cfg: { dealerPriceUrls: dealer }, fetch: () => ({ ok: false, error: 'robots' }), llmQueue: [partsResp([], [])] });
  const r = await flow.runParts(JOB, b.deps);
  assert.ok(r.notes.skipped.some(s => /robots/.test(s)));
});

test('parts: 3 agreeing users stage an ALT row with users evidence only; unknown part dropped', async () => {
  const { deps } = partsFakes({ llmQueue: [partsResp([], [])], users: [
    { item_key: 'oil filter', brand: 'Denso', part_no: '150-2010', users: 3, median_price: 27 },
    { item_key: 'flux capacitor', brand: 'X', part_no: '', users: 5, median_price: 10 }] });
  const r = await flow.runParts(JOB, deps);
  const row = deps.staged[0].rows.find(x => x.target_key === 'Oil Filter|alt:denso');
  assert.deepEqual(row.evidence, [{ type: 'users', tier: 'community', users: 3, median: 27 }]);
  assert.equal(row.after.price, 27);
  assert.equal(r.notes.dropped.unknown_part, 1);
  assert.ok(r.notes.skipped.includes('no citations'));
});

test('parts: new model uses generic names as OEM inserts and stages no ALT', async () => {
  const { deps } = partsFakes({ live: [], domains: OK, users: [{ item_key: 'oil filter', brand: 'Denso', part_no: 'x', users: 3, median_price: 27 }],
    llmQueue: [partsResp([{ part: 'Oil Filter', part_no: 'PE01-14-302B', price: 30, url: 'https://a.com/x' }],
      [['https://a.com/x', Q('PE01-14-302B', 30)], ['https://b.com/y', Q('PE01-14-302B', 31)]])] });
  await flow.runParts(JOB, deps);
  assert.deepEqual(deps.staged[0].rows.map(x => x.target_key), ['Oil Filter|oem']);
});

test('parts: no citations is a skipped note, job ok', async () => {
  const { deps } = partsFakes({ llmQueue: [partsResp([], [])] });
  const r = await flow.runParts(JOB, deps);
  assert.ok(r.ok && r.notes.skipped.includes('no citations'));
});

test('index.ts: parts stage mapped, config + rpc wired, still no live writes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'autopilot', 'index.ts'), 'utf8');
  for (const s of ['parts: runParts', 'autopilot_user_agreement', 'autopilot_budget_left', 'min_pct', 'optional_floor_sar', 'dealer_price_urls']) assert.ok(src.includes(s), s);
  assert.equal(/\.(insert|update|upsert|delete)\(/.test(src), false);
});

/* ---- community + models jobs (04-08) ---- */
const nhtsa = (n, components = 'POWER TRAIN') => JSON.stringify({ results: Array.from({ length: n }, (_, i) => ({ odiNumber: 1000 + i, components, summary: `Gearbox complaint number ${i} jerks badly` })) });
const comm = (over = {}) => {
  const fetched = [];
  const f = partsFakes({ ...over, fetch: url => {
    fetched.push(url);
    if (/nhtsa\.gov/.test(url)) return over.nhtsa === false ? { ok: false, error: 'down' } : { ok: true, kind: 'json', body: nhtsa(over.nhtsaN ?? 4), finalUrl: '' };
    return { ok: false, error: 'robots' };      // forum pages are unreadable: only snippets count
  } });
  f.fetched = fetched;
  if (over.staged) f.deps.db.stagedFindings = async () => over.staged;
  return f;
};
const searchOut = (claims, cites) => partsResp(claims, cites);
const labels = items => ({ content: [{ type: 'text', text: JSON.stringify({ items }) }], usage: { input_tokens: 10, output_tokens: 10 } });
const FD = { 'f1.com': 'approved', 'f2.com': 'approved', 'www.reddit.com': 'pending' };
const failureRows = d => d.staged.find(s => s.kind === 'failure').rows;

test('community: below the soft floor skips with no reserve', async () => {
  const { deps, calls } = comm({ budget: 3 });
  const r = await flow.runCommunity(JOB, deps);
  assert.deepEqual(r.notes.skipped, ['budget']);
  assert.equal(calls.some(c => ['reserve', 'llm', 'stage'].includes(c)), false);
});

test('community: 4 NHTSA + 2 forum snippets on 1 forum host stage a failure with 6 mentions', async () => {
  const a = 'My gearbox started slipping badly after the warm up', b = 'Gearbox jerks between second and third gear';
  const { deps, calls } = comm({ domains: FD, llmQueue: [searchOut([], [['https://f1.com/t/1', a], ['https://f1.com/t/2', b]]),
    labels([{ category: 'transmission', quote: a, km: null }, { category: 'transmission', quote: b, km: null }])] });
  await flow.runCommunity(JOB, deps);
  const row = failureRows(deps)[0];
  assert.equal(row.target_key, 'transmission');
  assert.equal(row.after.mentions, 6);
  assert.equal(row.after.title, 'Transmission problems');
  assert.equal(row.after.typical_km, null);
  assert.ok(row.evidence.length <= 10 && row.evidence.every(e => e.tier === 'community'));
  assert.ok(llmAfterReserve(calls));
});

test('community: NHTSA alone (one host) and 2 mentions on 2 hosts stage nothing', async () => {
  const a = comm({ nhtsaN: 10, llmQueue: [searchOut([], [])] });
  await flow.runCommunity(JOB, a.deps);
  assert.equal(failureRows(a.deps).length, 0);
  const x = 'Gearbox slips when warm', y = 'Gearbox jerks in third gear';
  const b = comm({ nhtsaN: 0, domains: FD, llmQueue: [searchOut([], [['https://f1.com/t/1', x], ['https://f2.com/t/2', y]]),
    labels([{ category: 'transmission', quote: x, km: null }, { category: 'transmission', quote: y, km: null }])] });
  await flow.runCommunity(JOB, b.deps);
  assert.equal(failureRows(b.deps).length, 0);
});

test('community: a label whose quote is not in the cited text is ignored', async () => {
  const x = 'Gearbox slips when warm', y = 'Gearbox jerks in third gear';
  const { deps } = comm({ nhtsaN: 0, domains: FD, llmQueue: [searchOut([], [['https://f1.com/t/1', x], ['https://f2.com/t/2', y], ['https://f2.com/t/3', 'Clutch feels heavy today']]),
    labels([{ category: 'transmission', quote: x, km: null }, { category: 'transmission', quote: y, km: null }, { category: 'transmission', quote: 'invented sentence about gearbox', km: null }])] });
  const r = await flow.runCommunity(JOB, deps);
  assert.equal(r.notes.dropped.unverified_quote, 1);
  assert.equal(failureRows(deps).length, 0);
});

test('community: reddit is only ever a citation; unapproved forum is held', async () => {
  const x = 'Gearbox slips when warm', y = 'Gearbox jerks in third gear', z = 'Gearbox whines on cold mornings';
  const { deps, fetched } = comm({ nhtsaN: 0, domains: FD, llmQueue: [searchOut([], [['https://www.reddit.com/r/mazda/1', x], ['https://www.reddit.com/r/mazda/2', y], ['https://f1.com/t/3', z], ['https://new.com/t', 'x']]),
    labels([{ category: 'transmission', quote: x, km: null }, { category: 'transmission', quote: y, km: null }, { category: 'transmission', quote: z, km: null }])] });
  const r = await flow.runCommunity(JOB, deps);
  assert.equal(fetched.some(u => /reddit/.test(u)), false);
  assert.ok(r.notes.skipped.some(s => /new\.com: held/.test(s)));
  assert.equal(failureRows(deps)[0].after.mentions, 3);       // reddit.com + f1.com = 2 hosts
});

test('community: typical_km only with 2+ verified km figures', async () => {
  const x = 'Gearbox failed at 90,000 km for me', y = 'Gearbox died at 110,000 km on mine', z = 'Gearbox jerks when cold';
  const run = async km => {
    const { deps } = comm({ nhtsaN: 0, domains: FD, llmQueue: [searchOut([], [['https://f1.com/t/1', x], ['https://f2.com/t/2', y], ['https://f2.com/t/3', z]]),
      labels([{ category: 'transmission', quote: x, km: km[0] }, { category: 'transmission', quote: y, km: km[1] }, { category: 'transmission', quote: z, km: 5 }])] });
    await flow.runCommunity(JOB, deps);
    return failureRows(deps)[0].after.typical_km;
  };
  assert.equal(await run([90000, 110000]), 100000);
  assert.equal(await run([90000, 50000]), null);               // 50,000 is not in the quote
});

test('community: NHTSA failure is a skipped note, job still ok', async () => {
  const { deps } = comm({ nhtsa: false, llmQueue: [searchOut([], [])] });
  const r = await flow.runCommunity(JOB, deps);
  assert.ok(r.ok && r.notes.skipped.includes('nhtsa'));
});

test('community: forum alternative needs 2 hosts on brand + part number; unions with the runParts rows', async () => {
  const claim = [{ part: 'Oil Filter', brand: 'Denso', part_no: '150-2010', price: 45, url: 'https://f1.com/t/1' }];
  const q1 = 'Mazda 3 2019 owners use Denso 150-2010 oil filter for 45 SAR', q2 = 'Denso 150-2010 fits my Mazda 3 2020 perfectly';
  const oem = { target_key: 'Oil Filter|oem', after: { tag: 'OEM' }, evidence: [], reason: '', verified: true };
  const two = comm({ nhtsaN: 0, domains: FD, staged: [oem], llmQueue: [searchOut(claim, [['https://f1.com/t/1', q1], ['https://f2.com/t/2', q2]]), labels([])] });
  await flow.runCommunity(JOB, two.deps);
  const part = two.deps.staged.find(s => s.kind === 'part').rows;
  assert.deepEqual(part.map(r => r.target_key), ['Oil Filter|oem', 'Oil Filter|alt:denso']);
  assert.equal(part[1].evidence[0].tier, 'community');
  assert.equal(part[1].after.price, 45);
  // no verified price: not staged (submit_proposal refuses a part without one)
  const np = comm({ nhtsaN: 0, domains: FD, llmQueue: [searchOut([{ ...claim[0], price: null }], [['https://f1.com/t/1', q1], ['https://f2.com/t/2', q2]]), labels([])] });
  const nr = await flow.runCommunity(JOB, np.deps);
  assert.equal(nr.notes.dropped.no_price, 1);
  assert.equal(np.deps.staged.some(s => s.kind === 'part'), false);
  const one = comm({ nhtsaN: 0, domains: FD, llmQueue: [searchOut(claim, [['https://f1.com/t/1', q1], ['https://f1.com/t/9', q2]]), labels([])] });
  const r = await flow.runCommunity(JOB, one.deps);
  assert.equal(r.notes.dropped.single_source, 1);
  assert.equal(one.deps.staged.some(s => s.kind === 'part'), false);
});

const GCC = { gccDomains: ['gcc.example'] };
const MSENT = 'The all-new Mazda CX-70 3.3L Turbo 2025 takes 6.5 litres of engine oil and has a 5 years warranty.';
const modelsResp = (over = {}) => ({ content: [{ type: 'text', text: JSON.stringify({ items: [{ model: 'CX-70', generation: null, years: [2025], markets: ['KSA'],
  engines: [{ name: '3.3L Turbo', oil_l: 6.5, warranty_years: 5, warranty_km: 100000, quote: MSENT }], ...over }] }) }], usage: { input_tokens: 10, output_tokens: 10 } });
function modelFakes(over = {}) {
  const f = partsFakes({ cfg: GCC, domains: { 'gcc.example': 'approved' }, fetch: () => html(`<html><body><h1>Mazda Saudi Arabia</h1><p>${MSENT}</p></body></html>`),
    llmQueue: [searchResp(['https://gcc.example/models']), modelsResp(over.item)], ...over });
  f.deps.db.loadCar = async () => { throw new Error('models job must not load a car'); };
  f.deps.db.loadAllModels = async () => over.all || [];
  return f;
}

test('models: no GCC domains skips with no reserve (no global fallback)', async () => {
  const { deps, calls } = partsFakes({});
  const r = await flow.runModels({ run_id: 1, car_model_id: null }, deps);
  assert.deepEqual(r.notes.skipped, ['no GCC domains']);
  assert.equal(calls.some(c => ['reserve', 'llm'].includes(c)), false);
});

test('models: below the soft floor skips', async () => {
  const { deps, calls } = modelFakes({ budget: 3 });
  const r = await flow.runModels({ run_id: 1, car_model_id: null }, deps);
  assert.deepEqual(r.notes.skipped, ['budget']);
  assert.equal(calls.includes('llm'), false);
});

test('models: stages a new GCC model, pass 1 only, unverified number nulled, null-car job', async () => {
  const { deps, calls } = modelFakes();
  const r = await flow.runModels({ run_id: 1, car_model_id: null }, deps);
  const s = deps.staged[0];
  assert.equal(s.kind, 'car_model');
  const row = s.rows[0];
  assert.equal(row.target_key, 'cx-70-2025:3.3l-turbo');
  assert.deepEqual([row.after.oil_capacity_l, row.after.warranty_years, row.after.warranty_km], [6.5, 5, null]);
  assert.deepEqual(row.after.markets, ['KSA']);
  assert.equal(row.evidence[0].tier, 'official');
  assert.equal(row.verified, false);
  assert.equal(r.notes.dropped.unverified_warranty_km, 1);
  assert.ok(deps.requests[0].tools[0].allowed_domains && !deps.requests[0].tools[0].blocked_domains);
  assert.equal(calls.filter(c => c === 'llm').length, 2);
  assert.ok(llmAfterReserve(calls));
});

test('models: an existing model (any status) or a non-GCC model is not staged', async () => {
  const a = modelFakes({ all: [{ id: 'cx-70-2025:3.3l-turbo', model: 'CX-70', generation: null, engine: '3.3L Turbo', status: 'pending' }] });
  await flow.runModels({ run_id: 1, car_model_id: null }, a.deps);
  assert.equal(a.deps.staged[0].rows.length, 0);
  const b = modelFakes({ item: { markets: [] } });
  await flow.runModels({ run_id: 1, car_model_id: null }, b.deps);
  assert.equal(b.deps.staged[0].rows.length, 0);
});

test('index.ts: community + models dispatched, read-only helpers wired', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'autopilot', 'index.ts'), 'utf8');
  for (const s of ['community: runCommunity', 'models: runModels', 'loadAllModels', 'stagedFindings']) assert.ok(src.includes(s), s);
});

test('extract: a page where no item verified is not hashed (retried next run); an empty extraction is (WR-02)', async () => {
  const bad = { content: [{ type: 'text', text: JSON.stringify({ items: [{ service: 'Engine oil', generation: null, engine: null,
    normal: { km: 10000, months: 12, miles: null, quote: 'this sentence is not on the page at all' }, severe: null }] }) }], usage: { input_tokens: 10, output_tokens: 10 } };
  const a = fakes({ candidates: ['https://ok.com/a'], llmQueue: [bad] });
  const r = await flow.runExtract({ run_id: 1, car_model_id: CAR.id }, a.deps);
  assert.equal(a.deps.hashed.length, 0);
  assert.match(r.notes.skipped[0], /no item verified/);
  const empty = { content: [{ type: 'text', text: '{"items":[]}' }], usage: { input_tokens: 10, output_tokens: 10 } };
  const b = fakes({ candidates: ['https://ok.com/a'], llmQueue: [empty] });
  await flow.runExtract({ run_id: 1, car_model_id: CAR.id }, b.deps);
  assert.equal(b.deps.hashed.length, 1);
});

test('models: identity fields not on the page are dropped; empty-slug names get a hash id (WR-03, WR-07)', async () => {
  const { groundModels, modelId, validModelId } = await import('../supabase/functions/autopilot/models.mjs');
  const dropped = {};
  const eng = n => ({ name: n, oil_l: null, warranty_years: null, warranty_km: null, quote: 'q' });
  const out = groundModels([
    { model: 'CX-70', generation: 'KZ', years: [2025, 2031], markets: ['KSA', 'QA'], engines: [eng('3.3L Turbo'), eng('9.9L Fake')] },
    { model: 'CX-99', generation: null, years: [], markets: ['KSA'], engines: [eng('3.3L Turbo')] },
  ], 'Mazda Saudi Arabia: the CX-70 3.3L Turbo, 2025 model', dropped);
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].generation, out[0].years, out[0].markets, out[0].engines.map(e => e.name)], [null, [2025], ['KSA'], ['3.3L Turbo']]);
  assert.deepEqual(dropped, { unverified_engine: 1, unverified_model: 1 });
  const id = modelId({ model: 'مازدا', years: [2025] }, '2.0L', []);
  assert.ok(validModelId(id), id);
  assert.notEqual(id, modelId({ model: 'سيارة', years: [2025] }, '2.0L', []));
  assert.equal(validModelId('x:'), false);
});

test('parts: a cited price whose quote names neither the part nor its number is not attached (WR-04)', async () => {
  const { deps } = partsFakes({ domains: OK, llmQueue: [partsResp([{ part: 'Oil Filter', part_no: null, price: 45, url: 'https://a.com/x' }],
    [['https://a.com/x', 'Mazda 3 2019 2.5L brake pads SAR 45']])] });
  const r = await flow.runParts(JOB, deps);
  assert.equal(r.notes.dropped.unverified_price, 1);
  assert.equal(deps.staged[0].rows.length, 0);
});
