/* ==== Autopilot Wave 0 smoke — live probes for research assumptions A3/A4/A6/A8 ====
   Dev-machine script, not shipped (not in sw ASSETS).
   (no flag)        one live web_search_20250305 call (A4). Costs about SAR 0.05. Needs ANTHROPIC_API_KEY.
   --ppl [url]      FREE. Fetches the dealer price page through safeFetch and counts SAR prices in the text (A3).
   --citations      one paid search call; counts text blocks carrying citations + shows cited_text (A6/A8). About SAR 0.05.
   Anthropic calls use global fetch directly: fixed host, no user-influenced URL. --ppl goes through safeFetch (SSRF guard). */
import { lookup } from 'node:dns/promises';
import { buildSearchRequest, costSar } from './logic.mjs';
import { DEFAULT_POLICY, safeFetch } from '../_shared/safe-fetch.mjs';
import { htmlToText } from '../plan-intake/logic.mjs';

const args = process.argv.slice(2);

if (args[0] === '--ppl') {
  const url = args[1] || 'https://www.mazda.com.sa/ppl';
  const r = await safeFetch(url, DEFAULT_POLICY, {
    fetch,
    resolve: async h => (await lookup(h, { all: true })).map(a => a.address),
  });
  if (!r.ok) { console.log('ok:false error:', r.error); process.exit(1); }
  const text = htmlToText(r.body, 1e6);
  const matches = text.match(/\d[\d,.]*\s*(?:SAR|SR|ر\.س|ريال)/gi) || [];
  console.log('ok:true kind:', r.kind, '| finalHost:', new URL(r.finalUrl).host, '| textLength:', text.length, '| SAR matches:', matches.length);
  console.log('sample:', matches.slice(0, 3).join(' ; '));
  process.exit(matches.length ? 0 : 1);
}

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }

// Seed price table (USD per MTok), same values as the research price table.
const prices = {
  usd_sar: 3.75, search_per_call: 0.01,
  models: { 'claude-haiku-5-5': { in: 0.10, out: 0.50, cache_read: 0.01, tier_over: 100000, in_hi: 0.50, out_hi: 2.50 } },
};
const body = buildSearchRequest(2, { name: 'Mazda3 2020' }, { model: 'claude-haiku-5-5', max_tokens: 256, max_uses: 1, banned: [] });
const citations = args[0] === '--citations';
if (citations) body.messages = [{ role: 'user', content: 'Mazda CX-5 oil filter part number and price in SAR, cite sources' }];

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const j = await res.json().catch(() => ({}));
if (res.status === 400) { console.error('HTTP 400 (search not enabled or version rejected):', JSON.stringify(j)); process.exit(1); }
const hasResult = Array.isArray(j.content) && j.content.some(b => b.type === 'web_search_tool_result');
const u = j.usage || {};
console.log('HTTP', res.status, '| web_search_tool_result:', hasResult, '| server_tool_use:', JSON.stringify(u.server_tool_use || {}),
  '| SAR', j.usage ? costSar('claude-haiku-5-5', u, prices).toFixed(4) : 'n/a');
if (citations) {
  const cited = (j.content || []).filter(b => b.type === 'text' && Array.isArray(b.citations) && b.citations.length);
  console.log('text blocks with citations:', cited.length);
  cited.flatMap(b => b.citations).slice(0, 2).forEach(c => console.log('cited_text:', String(c.cited_text || '').slice(0, 200)));
  if (!cited.length) process.exit(1);
}
if (res.status !== 200 || !hasResult) process.exit(1);
