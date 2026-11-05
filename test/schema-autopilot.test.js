'use strict';
/* ==== Autopilot schema — static guards on the schema.sql autopilot section ====
 * No Postgres here (supabase/tests/autopilot.sql holds the behaviour checks, run by the
 * `rls` CI job). These keep the rules that matter from silently disappearing: the cap
 * default, the atomic reserve, service-only worker grants, no partial publish, the
 * guarded cron with no committed secret.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase/schema.sql'), 'utf8');
const section = schema.slice(schema.indexOf('-- Monthly autopilot (Phase 3'));
// Body of one function: from its create line to its closing `$$;`.
const fn = name => {
  const i = section.indexOf('function public.' + name + '(');
  assert.ok(i >= 0, name + ' missing');
  return section.slice(i, section.indexOf('$$;', section.indexOf('$$', i) + 2) + 3);
};

test('autopilot: cap defaults to SAR 40 and the kill switch to on', () => {
  assert.match(section, /monthly_cap_sar numeric not null default 40/);
  assert.match(section, /enabled\s+boolean not null default true/);
  assert.match(section, /gcc_domains\s+text\[\] not null default '\{\}'/);   // owner supplies hostnames
});

test('autopilot: reserve is atomic (advisory lock) and reads kill switch and cap inside', () => {
  const r = fn('autopilot_reserve');
  assert.match(r, /pg_advisory_xact_lock/);
  assert.match(r, /'killed'/);
  assert.match(r, /'cap'/);
  assert.match(r, /used \+ p_est_sar > c\.monthly_cap_sar/);
  assert.match(fn('autopilot_settle'), /pg_advisory_xact_lock/);
});

test('autopilot: no write policy or table grant beyond select on any autopilot table', () => {
  assert.doesNotMatch(section, /create policy \w+ on public\.(autopilot_\w+|source_domains) for (insert|update|delete|all)/);
  assert.doesNotMatch(section, /grant (insert|update|delete|all)[^;]* on public\.(autopilot_\w+|source_domains)/);
});

test('autopilot: worker functions are service_role only', () => {
  const worker = ['autopilot_reserve(bigint, numeric)', 'autopilot_settle(bigint, text, jsonb)',
    'autopilot_start_run(text, text)', 'autopilot_claim_job()', 'autopilot_finish_job(bigint, boolean, text, jsonb)',
    'autopilot_end_run(bigint, text)', 'autopilot_stage_findings(bigint, text, text, jsonb)',
    'autopilot_get_source_hash(text, text)', 'autopilot_set_source_hash(text, text, text)',
    'autopilot_see_domain(text)', 'autopilot_publish_run(bigint)'];
  for (const sig of worker) {
    const q = sig.replace(/[()]/g, '\\$&');
    assert.match(section, new RegExp('revoke execute on function public\\.' + q + ' from public, anon, authenticated;'), sig + ' not revoked');
    assert.match(section, new RegExp('grant execute on function public\\.' + q + ' to service_role;'), sig + ' not granted to service_role');
    assert.doesNotMatch(section, new RegExp('grant execute on function public\\.' + q + ' to authenticated'), sig + ' granted to authenticated');
  }
  // internal helpers are not callable by any API role
  for (const sig of ['autopilot_abort_run(bigint)', 'autopilot_build_report(bigint, jsonb)', 'autopilot_cost_usd(text, jsonb, jsonb)'])
    assert.match(section, new RegExp('revoke execute on function public\\.' + sig.replace(/[()]/g, '\\$&') + ' from public, anon, authenticated;'), sig);
});

test('autopilot: admin RPCs check is_admin() inside and are granted to authenticated only', () => {
  for (const [name, sig] of [['autopilot_set_enabled', 'boolean'], ['ban_source_domain', 'text'], ['approve_source_domain', 'text']]) {
    assert.match(fn(name), /if not public\.is_admin\(\) then raise exception 'admin only'/, name);
    assert.match(section, new RegExp('grant execute on function public\\.' + name + '\\(' + sig + '\\) to authenticated;'), name);
    assert.match(section, new RegExp('revoke execute on function public\\.' + name + '\\(' + sig + '\\) from public, anon;'), name);
  }
});

test('autopilot: queue rules (skip locked, stale reclaim, 3 attempts, publish waits)', () => {
  const c = fn('autopilot_claim_job');
  assert.match(c, /for update of q skip locked/);
  assert.match(c, /interval '3 minutes'/);
  assert.match(c, /q\.stage <> 'publish' or not exists/);
  assert.match(fn('autopilot_finish_job'), /att >= 3/);
});

test('autopilot: publish only a clean running run, via submit_proposal, then delete findings', () => {
  const p = fn('autopilot_publish_run');
  assert.match(p, /r\.status <> 'running' then return/);
  assert.match(p, /public\.submit_proposal\(f\.kind, f\.car_model_id, f\.target_key, f\.after, f\.evidence, p_run/);
  assert.match(p, /r\.kind = 'monthly'/);   // manual runs never touch item status (D-15, D-16)
  assert.match(p, /delete from public\.autopilot_findings where run_id = p_run/);
  assert.match(fn('autopilot_end_run'), /delete from public\.autopilot_findings where run_id = p_run/);
  assert.match(section, /proposals_run_fk/);
});

test('autopilot: banning rejects pending proposals with the banned source reason', () => {
  assert.match(fn('ban_source_domain'), /reject_reason = 'banned source'/);
});

test('autopilot: cron is guarded by pg_available_extensions and commits no secret', () => {
  const i = section.indexOf("cron.schedule('autopilot-monthly'");
  assert.ok(i > 0);
  const head = section.slice(section.lastIndexOf('do $$ begin', i), i);
  assert.match(head, /pg_available_extensions where name = 'pg_cron'/);
  assert.match(section, /cron\.schedule\('autopilot-work', '\*\/5 \* \* \* \*'/);
  assert.match(section, /pg_available_extensions where name = 'pg_net'/);
  assert.match(section, /'x-cron-secret', current_setting\('app\.autopilot_secret', true\)/);
  assert.doesNotMatch(section, /x-cron-secret":"/);
});

test('autopilot: publish re-checks banned hosts; ban uses the same parser and drops staged findings', () => {
  assert.match(fn('autopilot_publish_run'), /public\.host_banned\(e->>'url'\)/);
  assert.match(fn('autopilot_publish_run'), /act not in \('error', 'banned'\)/);
  const b = fn('ban_source_domain');
  assert.match(b, /public\.evidence_host\(e->>'url'\) = h/);
  assert.match(b, /delete from public\.autopilot_findings f using public\.autopilot_runs r/);
  assert.match(fn('host_banned'), /strpos\(p_url, chr\(92\)\) > 0/);
  assert.match(fn('host_banned'), /h !~ '\^\[a-z0-9\]/);   // non-ASCII hosts fail closed
});
