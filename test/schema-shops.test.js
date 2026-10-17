'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

test('shops table: insert-only shared list with case-insensitive uniqueness', () => {
  assert.match(sql, /create table if not exists public\.shops/);
  assert.match(sql, /create unique index if not exists shops_norm_city_key\s+on public\.shops \(name_norm, lower\(city\)\)/);
  assert.match(sql, /grant insert on public\.shops to authenticated;/);
  assert.match(sql, /grant select \(id, name, name_norm, name_key, city, area, created_at\) on public\.shops to authenticated;/);
  assert.doesNotMatch(sql, /grant [^;]*created_by[^;]*to authenticated/);
  assert.match(sql, /create trigger shops_before_insert before insert on public\.shops/);
  assert.doesNotMatch(sql, /create policy [a-z_]+ on public\.shops for (update|delete)/);
});

test('shops.name_key: generated spaceless key, indexed', () => {
  assert.match(sql, /add column if not exists name_key text generated always as \(replace\(name_norm, ' ', ''\)\) stored;/);
  assert.match(sql, /create index if not exists shops_name_key_idx on public\.shops \(name_key\);/);
});

test('shop_feedback: one vote per user per shop, own rows only, tag whitelist', () => {
  assert.match(sql, /primary key \(shop_id, user_id\)/);
  assert.match(sql, /vote\s+smallint\s+not null check \(vote in \(-1, 1\)\)/);
  assert.match(sql, /reasons <@ array\['price','quality','honest','fast'\]/);
  assert.match(sql, /create policy own_shop_feedback on public\.shop_feedback for all/);
});

test('shop_feedback: bill_backed is not client-writable (column grants)', () => {
  assert.match(sql, /revoke all on public\.shop_feedback from anon, authenticated;/);
  assert.match(sql, /grant insert \(shop_id, vote, reasons\) on public\.shop_feedback to authenticated;/);
  assert.match(sql, /grant update \(shop_id, vote, reasons\) on public\.shop_feedback to authenticated;/);
  assert.doesNotMatch(sql, /grant [^;]*bill_backed[^;]*to authenticated/);
  assert.match(sql, /revoke all on public\.shops from anon;/);
});

test('trust and store-price views apply the 5-distinct-user floor', () => {
  const trust = sql.match(/create or replace view public\.shop_trust[\s\S]*?;\n/)[0];
  assert.match(trust, /having count\(\*\) >= 5/);
  assert.match(trust, /when f\.bill_backed then 2 else 1/);
  const prices = sql.match(/create or replace view public\.store_prices[\s\S]*?;\n/)[0];
  assert.match(prices, /having count\(distinct l\.user_id\) >= 5/);
});

test('views are not readable by anon; contributions carry shop_id; opt-out erases votes', () => {
  assert.match(sql, /revoke all on public\.shop_trust, public\.store_prices from anon/);
  assert.match(sql, /add column if not exists shop_id uuid references public\.shops/);
  assert.match(sql, /delete from shop_feedback where user_id = auth\.uid\(\)/);
});

test('all four aggregates count only qualified users (one shared definition)', () => {
  const def = sql.match(/create or replace view public\.qualified_users as[\s\S]*?;\n/)[0];
  assert.match(def, /interval '7 days'/);
  assert.match(def, /email_confirmed_at is not null or u\.phone_confirmed_at is not null/);
  // vote_shop's 7-day bill freshness window is a different rule from the account-age rule
  const noVote = sql.replace(/create or replace function public\.vote_shop[\s\S]*?\$\$;/, '');
  assert.strictEqual((noVote.match(/interval '7 days'/g) || []).length, 1, 'age rule defined once');
  assert.match(sql, /revoke all on public\.qualified_users from public, anon, authenticated;/);
  for (const v of ['shop_trust', 'store_prices', 'fuel_stats', 'brand_life']) {
    assert.match(sql.match(new RegExp('create or replace view public\\.' + v + '[\\s\\S]*?;\\n'))[0], /join qualified_users q/, v);
  }
});
