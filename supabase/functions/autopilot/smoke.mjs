/* ==== Autopilot Wave 0 smoke — one live web_search_20250305 call (research assumption A4) ====
   Dev-machine script, not shipped (not in sw ASSETS). Usage: ANTHROPIC_API_KEY=... node supabase/functions/autopilot/smoke.mjs
   Costs about SAR 0.05. Uses global fetch directly: fixed Anthropic host, no user-influenced URL. */
import { buildSearchRequest, costSar } from './logic.mjs';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }

// Seed price table (USD per MTok), same values as the research price table.
const prices = {
  usd_sar: 3.75, search_per_call: 0.01,
  models: { 'claude-haiku-5-5': { in: 0.10, out: 0.50, cache_read: 0.01, tier_over: 100000, in_hi: 0.50, out_hi: 2.50 } },
};
const body = buildSearchRequest(2, { name: 'Mazda3 2020' }, { model: 'claude-haiku-5-5', max_tokens: 256, max_uses: 1, banned: [] });

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
if (res.status !== 200 || !hasResult) process.exit(1);
