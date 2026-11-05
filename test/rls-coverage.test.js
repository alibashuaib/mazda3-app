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
  assert.match(fn, /user_id is not distinct from auth\.uid\(\)/);   // per-identity cap budget (WR-03)
});

test('RLS: every create table has enable row level security', () => {
  for (const name of tables) {
    const re = new RegExp('alter\\s+table\\s+(public\\.)?' + name + '\\s+enable\\s+row\\s+level\\s+security');
    assert.ok(re.test(schema), 'table ' + name + ' lacks enable row level security');
  }
});
