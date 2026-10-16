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

test('opt-out also erases the caller\'s bill reads', () => {
  const f = sql.match(/create or replace function public\.delete_my_contributions[\s\S]*?\$\$;/)[0];
  assert.match(f, /delete from bill_reads where user_id = auth\.uid\(\)/);
});
