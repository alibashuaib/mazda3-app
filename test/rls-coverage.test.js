'use strict';
/* ==== RLS coverage — static guards on schema.sql and the CI workflow ====
 * No Postgres here (supabase/tests/*.sql hold the real policy checks, run by
 * the `rls` CI job). These tests only stop two silent regressions: a new
 * table shipped without row level security, and a SQL test file CI never runs.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');
const tables = [...schema.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)].map(m => m[1]);

test('RLS: table regex finds the known tables', () => {
  assert.ok(tables.length >= 16, 'found only ' + tables.length + ' tables; regex broken?');
  assert.strictEqual(tables.filter(t => t === 'app_errors').length, 1);
});

test('RLS: every supabase/tests/*.sql is named in the CI workflow', () => {
  const yml = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8');
  for (const f of fs.readdirSync(path.join(root, 'supabase/tests')).filter(f => f.endsWith('.sql'))) {
    assert.ok(yml.includes(f), f + ' is not run by .github/workflows/test.yml');
  }
});

test('app_errors guard keys off the DB role, not JWT claims', () => {
  const fn = schema.slice(schema.indexOf('function public.app_errors_before_insert'), schema.indexOf('drop trigger if exists app_errors_before_insert'));
  assert.match(fn, /current_setting\('role', true\)/);
  assert.doesNotMatch(fn, /auth\.role\(\)/);
  assert.match(fn, />= 2000/);   // global ceiling
  assert.match(fn, /user_id is not distinct from auth\.uid\(\)/);   // per-identity cap budget (WR-03)
});

test('app_errors resolved_at is stamped by a server-side trigger', () => {
  assert.match(schema, /create trigger app_errors_before_update before update on public\.app_errors/);
  assert.match(schema, /new\.resolved_at := now\(\)/);
});

// Phase 3 autopilot tables: admin-only select policy, and no write policy at all (RPC-only writes).
const AUTOPILOT_TABLES = ['autopilot_config', 'autopilot_runs', 'autopilot_jobs', 'autopilot_spend',
  'autopilot_findings', 'source_domains', 'autopilot_sources', 'autopilot_item_status'];
test('RLS: autopilot tables have RLS, an admin select policy and no write policy', () => {
  for (const name of AUTOPILOT_TABLES) {
    assert.ok(tables.includes(name), name + ' not created');
    assert.match(schema, new RegExp('alter\\s+table\\s+public\\.' + name + '\\s+enable\\s+row\\s+level\\s+security'), name);
    assert.match(schema, new RegExp('create policy admin_read_' + name + ' on public\\.' + name +
      ' for select to authenticated using \\(public\\.is_admin\\(\\)\\)'), name + ' lacks admin select policy');
    assert.doesNotMatch(schema, new RegExp('create policy \\w+ on public\\.' + name + ' for (insert|update|delete|all)'), name + ' has a write policy');
    assert.match(schema, new RegExp('revoke all on [^;]*public\\.' + name + '[^;]* from anon, authenticated'), name + ' not revoked');
  }
});

// Phase 4 live tables: public read policy, writes only through the security definer gate functions.
test('RLS: catalogue_parts and known_issues are read-only to browser roles', () => {
  for (const name of ['catalogue_parts', 'known_issues']) {
    assert.ok(tables.includes(name), name + ' not created');
    assert.match(schema, new RegExp('alter\\s+table\\s+public\\.' + name + '\\s+enable\\s+row\\s+level\\s+security'), name);
    assert.match(schema, new RegExp('create policy read_' + name + ' on public\\.' + name + ' for select to anon, authenticated'), name + ' lacks select policy');
    assert.doesNotMatch(schema, new RegExp('create policy \\w+ on public\\.' + name + ' for (insert|update|delete|all)'), name + ' has a write policy');
    assert.match(schema, new RegExp('revoke insert, update, delete on [^;]*public\\.' + name + '[^;]* from anon, authenticated'), name + ' not revoked');
  }
});

test('RLS: every create table has enable row level security', () => {
  for (const name of tables) {
    const re = new RegExp('alter\\s+table\\s+(public\\.)?' + name + '\\s+enable\\s+row\\s+level\\s+security');
    assert.ok(re.test(schema), 'table ' + name + ' lacks enable row level security');
  }
});
