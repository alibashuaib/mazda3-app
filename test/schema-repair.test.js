'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

test('contributions carry action, finding and km_since_repair with CHECKs', () => {
  assert.match(sql, /add column if not exists action text not null default 'replaced'/);
  assert.match(sql, /contributions_action_chk[\s\S]{0,200}action in \('replaced', ?'repaired', ?'inspected'\)/);
  assert.match(sql, /add column if not exists finding text/);
  assert.match(sql, /contributions_finding_chk[\s\S]{0,300}finding in \('ok', ?'attention'\)/);
  assert.match(sql, /add column if not exists km_since_repair int/);
});

test('submit_contributions reads the new fields and keeps skipping bad rows', () => {
  const f = sql.match(/create or replace function public\.submit_contributions[\s\S]*?\nend \$\$;/)[0];
  const u = sql.match(/create or replace function public\.upsert_contribution[\s\S]*?\nend \$\$;/)[0];
  assert.match(f, /perform upsert_contribution\(r\)/);
  for (const k of ['action', 'finding', 'km_since_repair', 'prev_brand', 'prev_price']) assert.match(u, new RegExp(`r->>'${k}'`));
  assert.match(f, /exception when others then null/);
});

test('brand life credits the previous part: grouped by prev_brand, priced by prev_price', () => {
  const life = sql.match(/create or replace view public\.brand_life[\s\S]*?;\n/)[0];
  assert.match(life, /c\.prev_brand as brand/);
  assert.match(life, /order by c\.prev_price/);
  assert.match(life, /group by c\.model_id, c\.item_key, c\.prev_brand/);
  assert.match(sql, /add column if not exists prev_brand text/);
  assert.match(sql, /add column if not exists prev_price numeric/);
});

test('life and store prices count replacements only', () => {
  const life = sql.match(/create or replace view public\.brand_life[\s\S]*?;\n/)[0];
  assert.match(life, /c\.action = 'replaced'/);
  const prices = sql.match(/create or replace view public\.store_prices[\s\S]*?;\n/)[0];
  assert.match(prices, /c\.action = 'replaced'/);
});

test('repair_stats is qualified-only, floored at 5 users, and exposes exactly the aggregate columns', () => {
  const v = sql.match(/create or replace view public\.repair_stats[\s\S]*?;\n/)[0];
  assert.match(v, /join qualified_users/);
  assert.match(v, /having count\(distinct l\.user_id\) >= 5/);
  // Output column names = the `as <name>` aliases plus the two bare group keys.
  const cols = [...v.matchAll(/\bas (\w+),?\s*$/gm)].map((m) => m[1]);
  assert.deepStrictEqual(['model_id', 'item_key', ...cols], [
    'model_id', 'item_key', 'n_replaced', 'n_repaired', 'n_inspected',
    'median_price_replaced', 'median_price_repaired', 'median_km_after_repair', 'attention_share',
  ]);
  assert.match(v, /select c\.model_id, c\.item_key,/);
  assert.match(sql, /grant select on public\.repair_stats to authenticated/);
  assert.match(sql, /revoke all on public\.repair_stats from anon/);
});
