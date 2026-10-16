'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

test('shops table: insert-only shared list with case-insensitive uniqueness', () => {
  assert.match(sql, /create table if not exists public\.shops/);
  assert.match(sql, /create unique index if not exists shops_norm_city_key\s+on public\.shops \(name_norm, lower\(city\)\)/);
  assert.match(sql, /grant select, insert on public\.shops to authenticated/);
  assert.doesNotMatch(sql, /create policy [a-z_]+ on public\.shops for (update|delete)/);
});

test('shop_feedback: one vote per user per shop, own rows only, tag whitelist', () => {
  assert.match(sql, /primary key \(shop_id, user_id\)/);
  assert.match(sql, /vote\s+smallint\s+not null check \(vote in \(-1, 1\)\)/);
  assert.match(sql, /reasons <@ array\['price','quality','honest','fast'\]/);
  assert.match(sql, /create policy own_shop_feedback on public\.shop_feedback for all/);
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
