'use strict';
/* Static guards on the proposal gate (no Postgres here; supabase/tests/proposals.sql
 * holds the behavioural checks and runs in the CI rls job). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/admin-proposals.js'), 'utf8');

// Body of `function public.<name>(` up to the closing `$$;`.
function body(name) {
  const i = schema.indexOf('function public.' + name + '(');
  assert.ok(i >= 0, name + ' missing from schema.sql');
  return schema.slice(i, schema.indexOf('$$;', i));
}

test('gate tables exist with RLS on', () => {
  for (const t of ['makers', 'proposals', 'change_log']) {
    assert.ok(schema.includes('create table if not exists public.' + t), t + ' table');
    assert.ok(schema.includes('alter table public.' + t + ' enable row level security'), t + ' RLS');
  }
});

test('browser roles get no write grants on proposals or change_log', () => {
  assert.doesNotMatch(schema, /grant[^;]*(insert|update|delete)[^;]*public\.(proposals|change_log)/i);
});

test('gate function bodies carry no maker literal (CORE-06)', () => {
  for (const n of ['proposal_live', 'proposal_confidence', 'submit_proposal', 'apply_proposal', 'reject_proposal']) {
    assert.doesNotMatch(body(n), /mazda/i, n);
  }
  assert.doesNotMatch(page, /mazda/i);
});

test('apply_proposal is admin-guarded; submit_proposal is closed to browser roles', () => {
  assert.match(body('apply_proposal'), /if not public\.is_admin\(\) then raise exception 'admin only'/);
  assert.match(schema, /revoke execute on function public\.submit_proposal\([^;]*from public, anon, authenticated/);
});

test('reject_proposal is admin-guarded; submit_proposal suppresses and supersedes before insert', () => {
  assert.match(body('reject_proposal'), /if not public\.is_admin\(\) then raise exception 'admin only'/);
  const b = body('submit_proposal');
  assert.ok(b.includes("'suppressed'"));
  assert.ok(b.indexOf("set status = 'superseded'") > 0 && b.indexOf("set status = 'superseded'") < b.indexOf('insert into public.proposals'));
});

test('admin-proposals.js never uses raw()', () => {
  assert.doesNotMatch(page, /raw\(/);
});
