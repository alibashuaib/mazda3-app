'use strict';
/* Autopilot pure logic: cost metering, search request shape, URL extraction, backoff, preview. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const load = () => import('../supabase/functions/autopilot/logic.mjs');
const fx = n => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/autopilot', n), 'utf8'));
const prices = {
  usd_sar: 3.75, search_per_call: 0.01,
  models: {
    'claude-haiku-5-5': { in: 0.10, out: 0.50, cache_read: 0.01, cache_write: 0.125, tier_over: 100000, in_hi: 0.50, out_hi: 2.50 },
    'claude-sonnet-5-5': { in: 2, out: 10, cache_read: 0.10 },
  },
};

test('costUsd: tokens + searches; SAR multiplies', async () => {
  const { costUsd, costSar } = await load();
  const u = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, server_tool_use: { web_search_requests: 2 } };
  assert.ok(Math.abs(costUsd('claude-sonnet-5-5', u, prices) - (2 + 10 + 0.1 + 0.02)) < 1e-9);
  assert.ok(Math.abs(costSar('claude-sonnet-5-5', u, prices) - 12.12 * 3.75) < 1e-9);
});

test('costUsd: unknown model throws; haiku over 100k uses high tier', async () => {
  const { costUsd } = await load();
  assert.throws(() => costUsd('nope', {}, prices), /unpriced model/);
  assert.ok(Math.abs(costUsd('claude-haiku-5-5', { input_tokens: 100000, output_tokens: 0 }, prices) - 0.01) < 1e-9);
  assert.ok(Math.abs(costUsd('claude-haiku-5-5', { input_tokens: 100001, output_tokens: 0 }, prices) - 0.0500005) < 1e-9);
});

test('worstCaseEstimate is >= actual cost of any response within limits', async () => {
  const { worstCaseEstimate, costUsd } = await load();
  const w = worstCaseEstimate({ model: 'claude-sonnet-5-5', inputChars: 60000, maxTokens: 2000, maxSearches: 0 }, prices);
  const actual = costUsd('claude-sonnet-5-5', { input_tokens: 20000, output_tokens: 2000 }, prices);
  assert.ok(w.usd >= actual);
  assert.ok(Math.abs(w.sar - w.usd * 3.75) < 1e-9);
});

test('buildSearchRequest: pass 1 allowed only (minus banned), pass 2 blocked only, never both', async () => {
  const { buildSearchRequest } = await load();
  const cfg = { model: 'claude-haiku-5-5', max_tokens: 256, max_uses: 2, gcc_domains: ['a.sa', 'b.sa'], banned: ['b.sa', 'bad.com'] };
  const t1 = buildSearchRequest(1, { name: 'X' }, cfg).tools[0];
  assert.deepStrictEqual(t1.allowed_domains, ['a.sa']);
  assert.ok(!('blocked_domains' in t1));
  const t2 = buildSearchRequest(2, { name: 'X' }, cfg).tools[0];
  assert.deepStrictEqual(t2.blocked_domains, ['b.sa', 'bad.com']);
  assert.ok(!('allowed_domains' in t2));
  assert.strictEqual(t2.type, 'web_search_20250305');
});

test('buildSearchRequest: pass 1 with empty GCC list is null', async () => {
  const { buildSearchRequest } = await load();
  assert.strictEqual(buildSearchRequest(1, { name: 'X' }, { gcc_domains: [], banned: [] }), null);
  assert.strictEqual(buildSearchRequest(1, { name: 'X' }, { gcc_domains: ['b.sa'], banned: ['b.sa'] }), null);
});

test('extractSearchUrls: https only, banned dropped (incl subdomain), deduped', async () => {
  const { extractSearchUrls } = await load();
  const r = extractSearchUrls(fx('web-search-ok.json'), ['example.com']);
  assert.deepStrictEqual(r.urls, ['https://owners.example.sa/schedule']);
  assert.strictEqual(r.pause_turn, false);
});

test('extractSearchUrls: error block and empty give []; pause_turn flagged', async () => {
  const { extractSearchUrls } = await load();
  assert.deepStrictEqual(extractSearchUrls(fx('web-search-error.json'), []).urls, []);
  assert.deepStrictEqual(extractSearchUrls({ content: [] }, []).urls, []);
  const p = extractSearchUrls(fx('web-search-pause-turn.json'), []);
  assert.strictEqual(p.pause_turn, true);
  assert.deepStrictEqual(p.urls, ['https://owners.example.sa/p2']);
});

test('backoffMs: 2 retries then give up (D-13)', async () => {
  const { backoffMs } = await load();
  assert.ok(backoffMs(1) > 0 && backoffMs(2) > backoffMs(1));
  assert.strictEqual(backoffMs(3), null);
});

test('estimatePreview: unchanged sources skipped and not billed', async () => {
  const { estimatePreview, worstCaseEstimate } = await load();
  const cfg = {
    discover: { model: 'claude-haiku-5-5', inputChars: 3000, maxTokens: 1024, maxSearches: 3 },
    extract: { model: 'claude-sonnet-5-5', inputChars: 60000, maxTokens: 2000 },
  };
  const sources = [{ url: 'u1', hash: 'h1' }, { url: 'u2', hash: 'new' }];
  const r = estimatePreview({ sources, hashes: { u1: 'h1', u2: 'old' }, prices, cfg });
  assert.deepStrictEqual(r.skipped, ['u1']);
  assert.strictEqual(r.searches, 3);
  assert.strictEqual(r.llm_calls, 2);
  const want = worstCaseEstimate(cfg.discover, prices).sar + worstCaseEstimate(cfg.extract, prices).sar;
  assert.ok(Math.abs(r.sar - want) < 1e-9);
});

test('logic.mjs has no Mazda hostname literals', () => {
  const src = fs.readFileSync(path.join(__dirname, '../supabase/functions/autopilot/logic.mjs'), 'utf8');
  assert.ok(!/mazda[a-z.-]*\.(com|sa|ae|net)/i.test(src));
});

test('costUsd: cache writes billed and counted toward the tier', async () => {
  const { costUsd } = await load();
  // 50k input + 60k cache write = 110k prompt tokens -> high tier for input; cache write at its own rate
  const got = costUsd('claude-haiku-5-5', { input_tokens: 50000, cache_creation_input_tokens: 60000 }, prices);
  assert.ok(Math.abs(got - (50000 * 0.50 + 60000 * 0.125) / 1e6) < 1e-12);
});

test('costUsd: token class with no rate throws instead of billing NaN or 0', async () => {
  const { costUsd } = await load();
  assert.throws(() => costUsd('claude-sonnet-5-5', { cache_creation_input_tokens: 1 }, prices), /unpriced token class: cache_write/);
  assert.throws(() => costUsd('claude-sonnet-5-5', { input_tokens: 1, server_tool_use: { web_search_requests: 1 } }, { ...prices, search_per_call: undefined }), /unpriced token class: web_search/);
});

test('worstCaseEstimate reserves 1 token per input char; reconcile flags an over-run', async () => {
  const { worstCaseEstimate, reconcile } = await load();
  const res = worstCaseEstimate({ model: 'claude-sonnet-5-5', inputChars: 60000, maxTokens: 0, maxSearches: 0 }, prices);
  assert.ok(Math.abs(res.usd - 60000 * 2 / 1e6) < 1e-12);
  assert.strictEqual(reconcile(res, 'claude-sonnet-5-5', { input_tokens: 20000 }, prices).over, false);
  assert.strictEqual(reconcile(res, 'claude-sonnet-5-5', { input_tokens: 70000 }, prices).over, true);
});
