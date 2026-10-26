'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

test('bill_reads stores no image or text and is closed to clients', () => {
  const t = sql.match(/create table if not exists public\.bill_reads \([\s\S]*?\n\);/)[0];
  assert.doesNotMatch(t, /\b(image|photo|raw|customer|phone|plate)\b/i);
  assert.doesNotMatch(t, /^\s*(text|body|ocr)\s/im); // no column named text (the type `text` is fine)
  assert.match(t, /fingerprint\s+text/);
  assert.match(sql, /create unique index if not exists bill_reads_fingerprint_key\s+on public\.bill_reads \(fingerprint\)\s+where fingerprint is not null/);
  assert.match(sql, /alter table public\.bill_reads enable row level security/);
  assert.match(sql, /revoke all on public\.bill_reads from anon, authenticated/);
});

test('vote_shop decides bill_backed on the server', () => {
  const f = sql.match(/create or replace function public\.vote_shop[\s\S]*?\$\$;/)[0];
  assert.match(f, /security definer/);
  assert.match(f, /set search_path = public, extensions/);
  assert.match(f, /auth\.uid\(\) is null/);
  assert.match(f, /user_id = auth\.uid\(\) and used_at is null/);
  assert.match(f, /interval '7 days'/);
  assert.match(f, /similarity\(b\.store_key, s\.name_key\) >= 0\.5/);
  assert.match(f, /bill_backed = shop_feedback\.bill_backed or excluded\.bill_backed/);
  assert.match(sql, /revoke all on function public\.vote_shop\(uuid, smallint, text\[\], uuid\) from public, anon/);
  assert.match(sql, /grant execute on function public\.vote_shop\(uuid, smallint, text\[\], uuid\) to authenticated/);
});

test('opt-out erases where the caller shopped but keeps the cap and dedupe records', () => {
  const f = sql.match(/create or replace function public\.delete_my_contributions[\s\S]*?\$\$;/)[0];
  assert.doesNotMatch(f, /delete from bill_reads/, 'deleting bill reads resets the daily caps');
  assert.match(f, /update bill_reads set store_key = null, city = null where user_id = auth\.uid\(\)/);
  assert.match(f, /insert into insights_prefs \(user_id, share\) values \(auth\.uid\(\), false\)/);
  assert.match(f, /contrib_lock_and_consent\(\)/);
});

test('a bill read finishing after an opt-out cannot restore where the user shopped', () => {
  const g = sql.match(/create or replace function public\.bill_reads_respect_optout[\s\S]*?\$\$;/)[0];
  assert.match(g, /share = false/);
  assert.match(g, /new\.store_key := null; new\.city := null/);
  assert.doesNotMatch(g, /fingerprint := null/);
  assert.match(sql, /create trigger bill_reads_respect_optout before insert or update on public\.bill_reads/);
});

test('every contribution write takes the per-user lock and honours a server-side opt-out', () => {
  const lock = sql.match(/create or replace function public\.contrib_lock_and_consent[\s\S]*?\$\$;/)[0];
  assert.match(lock, /pg_advisory_xact_lock\(hashtextextended\('contrib:' \|\| auth\.uid\(\)::text, 0\)\)/);
  assert.ok(lock.indexOf('pg_advisory_xact_lock') < lock.indexOf('insights_prefs'), 'lock before reading consent');
  for (const fn of ['submit_contributions', 'sync_contributions']) {
    const f = sql.match(new RegExp(`create or replace function public\\.${fn}[\\s\\S]*?\\nend \\$\\$;`))[0];
    assert.match(f, /if not contrib_lock_and_consent\(\) then return -1; end if;/, fn);
  }
  const vote = sql.match(/create or replace function public\.vote_shop[\s\S]*?\$\$;/)[0];
  assert.match(vote, /if not contrib_lock_and_consent\(\) then raise exception 'sharing is off'/, 'votes ignore opt-out');
  for (const fn of ['upsert_contribution(jsonb)', 'contrib_lock_and_consent()', 'bill_reads_respect_optout()']) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated`), fn);
  }
});

test('sync_contributions replaces one vehicle\'s set and is callable by signed-in users only', () => {
  const f = sql.match(/create or replace function public\.sync_contributions[\s\S]*?\nend \$\$;/)[0];
  assert.match(f, /jsonb_array_length\(rows\) > 1000/);
  assert.match(f, /delete from contributions where id in/);
  assert.match(f, /another vehicle's key/);
  assert.match(sql, /grant execute on function [^;]*public\.sync_contributions\(text, jsonb\)[^;]* to authenticated/);
  assert.match(sql, /revoke execute on function [^;]*public\.sync_contributions\(text, jsonb\)[^;]* from anon/);
  const u = sql.match(/create or replace function public\.upsert_contribution[\s\S]*?\nend \$\$;/)[0];
  assert.match(u, /shop_id = case when r \? 'shop_id' then \(r->>'shop_id'\)::uuid else shop_id end/);
});
