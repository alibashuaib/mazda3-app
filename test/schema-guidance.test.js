'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

test('schedule_sources only allows https urls', () => {
  assert.match(sql, /create table if not exists public\.schedule_sources[\s\S]*?url text not null check \(url ~ '\^https:\/\/'\)/);
});
test('recalls are keyed by campaign + car and default to pending', () => {
  const t = sql.match(/create table if not exists public\.recalls[\s\S]*?\);/)[0];
  assert.match(t, /primary key \(campaign, car_model_id\)/);
  assert.match(t, /status text not null default 'pending'/);
});
test('plan_drafts allows one pending draft per car+service', () => {
  assert.match(sql, /create unique index if not exists plan_drafts_one_pending[\s\S]*?\(car_model_id, service\) where status = 'pending'/);
});
test('review tables are admin-only; approved recalls are public', () => {
  assert.match(sql, /alter table public\.plan_drafts enable row level security/);
  assert.match(sql, /create policy admin_plan_drafts on public\.plan_drafts[\s\S]*?is_admin\(\)/);
  assert.match(sql, /create policy read_recalls on public\.recalls[\s\S]*?status = 'approved' or public\.is_admin\(\)/);
});
test('decide_plan_draft is admin-only, security definer, revoked from anon', () => {
  const f = sql.match(/create or replace function public\.decide_plan_draft[\s\S]*?\nend \$\$;/)[0];
  assert.match(f, /security definer/);
  assert.match(f, /if not public\.is_admin\(\) then/);
  assert.match(sql, /revoke execute on function public\.decide_plan_draft[^;]*from anon/);
});
