'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/* Static guard only — the real proof is supabase/tests/catalogue-rls.sql
   against a live project. This catches the cheap regressions: a table
   shipped without RLS, or a write policy that forgot the admin check. */
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

for (const t of ['profiles', 'car_models', 'dealer_plan_items', 'dealer_plan_changes']) {
  test(`${t} has row level security enabled`, () => {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
  });
}

test('every non-select policy on catalogue tables requires is_admin()', () => {
  const policies = [...sql.matchAll(/create policy (\w+) on public\.(car_models|dealer_plan_items|dealer_plan_changes)([\s\S]*?);/g)];
  assert.ok(policies.length >= 5, 'expected at least 5 catalogue policies');
  for (const [, name, , body] of policies) {
    if (/\bfor select\b/.test(body)) continue;
    assert.match(body, /public\.is_admin\(\)/, `${name} lets a non-admin write`);
  }
});

test('role is not user-editable', () => {
  assert.match(sql, /revoke update on public\.profiles from authenticated/);
  assert.match(sql, /grant update \(share_community\) on public\.profiles to authenticated/);
});

test('catalogue tables have explicit grants', () => {
  assert.match(sql, /grant select on public\.car_models, public\.dealer_plan_items to anon, authenticated;/);
  assert.match(sql, /grant insert, update, delete on public\.car_models, public\.dealer_plan_items to authenticated;/);
  assert.match(sql, /grant select on public\.dealer_plan_changes to authenticated;/);
});

test('item trigger skips logging when the parent car is already deleted', () => {
  assert.match(sql, /tg_op = 'DELETE' and not exists \(select 1 from public\.car_models where id = cm\)/);
});
