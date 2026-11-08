-- Behaviour + RLS check for the monthly autopilot (Phase 3, ENG-01..ENG-08, REV-07, SCH-05).
-- Runs in the `rls` CI job after schema.sql and seed-catalogue.sql:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/autopilot.sql
-- Fixtures: ...0e1 = plain user, ...0e2 = admin. Raises 'FAIL: ...' on a broken
-- rule; finishing silently means pass. Ends in ROLLBACK, nothing persists.
begin;

insert into auth.users (id, created_at, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000e1', now(), now()),
  ('00000000-0000-0000-0000-0000000000e2', now(), now()) on conflict (id) do nothing;
insert into public.profiles (user_id, role) values ('00000000-0000-0000-0000-0000000000e2', 'admin')
  on conflict (user_id) do update set role = 'admin';

insert into public.car_models (id, model, generation, engine, status)
values ('test:ap', 'TEST', 'TEST', 'TEST', 'approved');
insert into public.dealer_plan_items (car_model_id, service, interval_km, interval_months, note) values
  ('test:ap', 'Engine Oil', 10000, 12, 'old'),
  ('test:ap', 'Cabin Filter', 20000, 24, ''),
  ('test:ap', 'Spark Plug', 60000, 72, '');

-- Clean slate for the queue tables (rolled back at the end).
delete from public.autopilot_runs;
delete from public.autopilot_spend;

-- a) defaults: cap 40, kill switch on, GCC list empty (owner fills it)
do $$ declare c public.autopilot_config; begin
  select * into c from public.autopilot_config;
  if c.monthly_cap_sar <> 40 then raise exception 'FAIL: cap default %', c.monthly_cap_sar; end if;
  if not c.enabled then raise exception 'FAIL: kill switch should default on'; end if;
  if c.gcc_domains <> '{}' then raise exception 'FAIL: gcc_domains must start empty'; end if;
end $$;

-- b) RLS: anon has nothing, non-admin sees nothing and cannot call anything
do $$ declare rid bigint; begin
  rid := (public.autopilot_start_run('manual', 'test:ap')->>'run_id')::bigint;
  perform public.autopilot_reserve(rid, 1);
  insert into public.source_domains (host) values ('seen.example');
  insert into public.autopilot_item_status (car_model_id, kind, target_key) values ('test:ap', 'schedule_item', 'Engine Oil');
  perform public.autopilot_set_source_hash('test:ap', 'https://seen.example/a', 'h');
  perform public.autopilot_stage_findings(rid, 'test:ap', 'schedule_item', '[{"target_key":"Engine Oil","after":{"interval_km":1},"evidence":[{"url":"https://seen.example/a"}]}]');
end $$;

set local role anon;
do $$ declare t text; begin
  foreach t in array array['autopilot_config', 'autopilot_runs', 'autopilot_jobs', 'autopilot_spend',
                           'autopilot_findings', 'source_domains', 'autopilot_sources', 'autopilot_item_status', 'autopilot_due'] loop
    begin execute format('select 1 from public.%I', t); raise exception 'FAIL: anon selects %', t;
    exception when insufficient_privilege then null; end;
  end loop;
  begin perform public.autopilot_set_enabled(false); raise exception 'FAIL: anon toggles kill switch';
  exception when insufficient_privilege then null; end;
  begin perform public.ban_source_domain('x.example'); raise exception 'FAIL: anon bans a domain';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
do $$ declare t text; n int; begin
  foreach t in array array['autopilot_config', 'autopilot_runs', 'autopilot_jobs', 'autopilot_spend',
                           'autopilot_findings', 'source_domains', 'autopilot_sources', 'autopilot_item_status', 'autopilot_due'] loop
    execute format('select count(*) from public.%I', t) into n;
    if n <> 0 then raise exception 'FAIL: non-admin sees % rows in %', n, t; end if;
    begin execute format('delete from public.%I', t); raise exception 'FAIL: non-admin deletes from %', t;
    exception when insufficient_privilege then null; end;
  end loop;
  begin perform public.autopilot_set_enabled(false); raise exception 'FAIL: non-admin toggled the kill switch';
  exception when raise_exception then
    if sqlerrm <> 'admin only' then raise exception 'FAIL: expected admin only, got %', sqlerrm; end if; end;
  begin perform public.ban_source_domain('x.example'); raise exception 'FAIL: non-admin banned a domain';
  exception when raise_exception then
    if sqlerrm <> 'admin only' then raise exception 'FAIL: expected admin only, got %', sqlerrm; end if; end;
  begin perform public.approve_source_domain('x.example'); raise exception 'FAIL: non-admin approved a domain';
  exception when raise_exception then
    if sqlerrm <> 'admin only' then raise exception 'FAIL: expected admin only, got %', sqlerrm; end if; end;
  -- worker functions are service_role only
  begin perform public.autopilot_reserve(1, 1); raise exception 'FAIL: non-admin reserves spend';
  exception when insufficient_privilege then null; end;
  begin perform public.autopilot_claim_job(); raise exception 'FAIL: non-admin claims a job';
  exception when insufficient_privilege then null; end;
  begin perform public.autopilot_publish_run(1); raise exception 'FAIL: non-admin publishes';
  exception when insufficient_privilege then null; end;
  begin perform public.autopilot_set_source_hash('test:ap', 'https://x.example/a', 'h'); raise exception 'FAIL: non-admin sets a source hash';
  exception when insufficient_privilege then null; end;
  begin perform public.autopilot_get_source_hash('test:ap', 'https://x.example/a'); raise exception 'FAIL: non-admin reads a source hash';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- admin: reads everything, toggles through the RPC only
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.autopilot_runs;
  if n = 0 then raise exception 'FAIL: admin cannot read autopilot_runs'; end if;
  begin update public.autopilot_config set enabled = false; raise exception 'FAIL: admin wrote autopilot_config directly';
  exception when insufficient_privilege then null; end;
  perform public.autopilot_set_enabled(false);
  if (select enabled from public.autopilot_config) then raise exception 'FAIL: admin toggle did not stick'; end if;
  perform public.autopilot_set_enabled(true);
end $$;
reset role;

delete from public.autopilot_runs;
delete from public.autopilot_spend;
delete from public.source_domains;
delete from public.autopilot_sources;
delete from public.autopilot_item_status;

-- c) cap: 39.9 used + 0.2 is refused, + 0.1 fits; manual and monthly runs share the cap
do $$ declare m bigint; u bigint; r jsonb; begin
  m := (public.autopilot_start_run('monthly')->>'run_id')::bigint;
  u := (public.autopilot_start_run('manual', 'test:ap')->>'run_id')::bigint;
  insert into public.autopilot_spend (run_id, status, model, reserved_sar, cost_sar) values (u, 'settled', 'x', 39.9, 39.9);
  r := public.autopilot_reserve(m, 0.2);
  if (r->>'ok')::boolean or r->>'reason' <> 'cap' then raise exception 'FAIL: 39.9 + 0.2 should hit the cap: %', r; end if;
  r := public.autopilot_reserve(m, 0.1);
  if not (r->>'ok')::boolean then raise exception 'FAIL: 39.9 + 0.1 should fit: %', r; end if;
  -- the open reservation counts: another 0.1 now exceeds
  r := public.autopilot_reserve(m, 0.1);
  if (r->>'ok')::boolean then raise exception 'FAIL: open reservations must count toward the cap'; end if;
  -- kill switch beats a free budget
  delete from public.autopilot_spend;
  update public.autopilot_config set enabled = false;
  r := public.autopilot_reserve(m, 0.1);
  if (r->>'ok')::boolean or r->>'reason' <> 'killed' then raise exception 'FAIL: disabled should refuse: %', r; end if;
  update public.autopilot_config set enabled = true;
  -- a manual run stops the monthly run? no: runs are independent, but an ended run cannot reserve
  perform public.autopilot_end_run(u, 'stopped');
  r := public.autopilot_reserve(u, 0.1);
  if (r->>'ok')::boolean or r->>'reason' <> 'run_ended' then raise exception 'FAIL: ended run reserved: %', r; end if;
end $$;

-- settle: actual cost replaces the estimate; unknown model raises; cache write is billed
do $$ declare m bigint; r jsonb; res bigint; s jsonb; begin
  delete from public.autopilot_spend;
  m := (select id from public.autopilot_runs where kind = 'monthly');
  r := public.autopilot_reserve(m, 1.0);
  res := (r->>'reservation_id')::bigint;
  s := public.autopilot_settle(res, 'claude-sonnet-5-5', '{"input_tokens":1000,"output_tokens":100}');
  -- (1000*2 + 100*10) / 1e6 USD * 3.75
  if abs((s->>'sar')::numeric - 0.01125) > 0.0000001 then raise exception 'FAIL: settled sar %', s; end if;
  if (s->>'over')::boolean then raise exception 'FAIL: cheap call flagged over'; end if;
  if (select cost_sar from public.autopilot_spend where id = res) <> (s->>'sar')::numeric then
    raise exception 'FAIL: ledger not updated'; end if;
  begin perform public.autopilot_settle(res, 'claude-sonnet-5-5', '{}'); raise exception 'FAIL: double settle';
  exception when raise_exception then if sqlerrm <> 'no open reservation' then raise; end if; end;
  r := public.autopilot_reserve(m, 0.1);
  begin perform public.autopilot_settle((r->>'reservation_id')::bigint, 'no-such-model', '{"input_tokens":1}');
    raise exception 'FAIL: unknown model settled';
  exception when raise_exception then if sqlerrm <> 'unpriced model' then raise; end if; end;
  s := public.autopilot_settle((r->>'reservation_id')::bigint, 'claude-haiku-5-5',
         '{"input_tokens":10,"cache_creation_input_tokens":1000000,"output_tokens":0}');
  if (s->>'sar')::numeric < 0.4 then raise exception 'FAIL: cache write not billed: %', s; end if;
  if not (s->>'over')::boolean then raise exception 'FAIL: overspend vs 0.1 reservation not flagged: %', s; end if;
end $$;

delete from public.autopilot_runs;
delete from public.autopilot_spend;

-- d) start_run: jobs for every approved car x3 + publish; second monthly refused
do $$ declare r jsonb; cars int; n int; begin
  select count(*) into cars from public.car_models where status = 'approved';
  r := public.autopilot_start_run('monthly');
  select count(*) into n from public.autopilot_jobs where run_id = (r->>'run_id')::bigint;
  -- core x3 per car + parts/community for the rotated cars + models + publish
  if n <> cars * 3 + 2 * least(cars, 6) + 2 then raise exception 'FAIL: expected % jobs, got %', cars * 3 + 2 * least(cars, 6) + 2, n; end if;
  if (r->>'jobs')::int <> n then raise exception 'FAIL: start_run job count mismatch'; end if;
  if (select count(*) from public.autopilot_jobs where run_id = (r->>'run_id')::bigint and stage = 'publish') <> 1 then
    raise exception 'FAIL: one publish job expected'; end if;
  r := public.autopilot_start_run('monthly');
  if (r->>'ok')::boolean then raise exception 'FAIL: second monthly run accepted'; end if;
  begin perform public.autopilot_start_run('monthly', 'test:ap'); raise exception 'FAIL: monthly with a car';
  exception when raise_exception then if sqlerrm <> 'monthly runs cover every car' then raise; end if; end;
  begin perform public.autopilot_start_run('manual', 'no:such'); raise exception 'FAIL: manual for unknown car';
  exception when raise_exception then if sqlerrm <> 'unknown car' then raise; end if; end;
end $$;
delete from public.autopilot_runs;

-- e) claim order, retry/backoff to 3 attempts, stale reclaim
do $$ declare rid bigint; j jsonb; j2 jsonb; fin jsonb; jid bigint; begin
  rid := (public.autopilot_start_run('manual', 'test:ap')->>'run_id')::bigint;
  update public.autopilot_jobs set status = 'done' where run_id = rid and stage in ('parts', 'community');   -- optional stages are covered in n)
  j := public.autopilot_claim_job();
  if j->>'stage' <> 'discover' then raise exception 'FAIL: first claim should be discover: %', j; end if;
  j2 := public.autopilot_claim_job();
  if j2->>'stage' <> 'recalls' then raise exception 'FAIL: extract must wait for discover, got %', j2; end if;
  if public.autopilot_claim_job() is not null then raise exception 'FAIL: extract/publish claimed too early'; end if;
  perform public.autopilot_finish_job((j->>'id')::bigint, true);
  j := public.autopilot_claim_job();
  if j->>'stage' <> 'extract' then raise exception 'FAIL: extract should follow discover: %', j; end if;
  if public.autopilot_claim_job() is not null then raise exception 'FAIL: publish claimed while jobs are open'; end if;
  perform public.autopilot_finish_job((j2->>'id')::bigint, true);

  -- retries: fail 1 -> queued with backoff (not claimable), fail 3 -> failed
  jid := (j->>'id')::bigint;
  fin := public.autopilot_finish_job(jid, false, 'boom');
  if fin->>'status' <> 'queued' or (select run_after from public.autopilot_jobs where id = jid) <= now() then
    raise exception 'FAIL: first failure should requeue with backoff: %', fin; end if;
  if public.autopilot_claim_job() is not null then raise exception 'FAIL: backed-off job claimed early'; end if;
  update public.autopilot_jobs set run_after = now() where id = jid;
  j := public.autopilot_claim_job();
  if (j->>'id')::bigint <> jid then raise exception 'FAIL: requeued job not reclaimed: %', j; end if;
  fin := public.autopilot_finish_job(jid, false, 'boom');
  update public.autopilot_jobs set run_after = now() where id = jid;
  j := public.autopilot_claim_job();
  fin := public.autopilot_finish_job(jid, false, 'boom 3');
  if fin->>'status' <> 'failed' or (select attempts from public.autopilot_jobs where id = jid) <> 3 then
    raise exception 'FAIL: third failure should mark failed: %', fin; end if;
  if (select last_error from public.autopilot_jobs where id = jid) <> 'boom 3' then raise exception 'FAIL: last_error'; end if;

  -- stale: a running job older than 3 minutes is reclaimed (counts as an attempt) and claimable again
  update public.autopilot_jobs set status = 'queued', attempts = 0, run_after = now() where stage = 'publish' and run_id = rid;
  update public.autopilot_jobs set status = 'running', claimed_at = now() - interval '5 minutes', attempts = 0
    where id = jid;
  j := public.autopilot_claim_job();
  if (j->>'id')::bigint <> jid then raise exception 'FAIL: stale job not reclaimed: %', j; end if;
  if (select attempts from public.autopilot_jobs where id = jid) <> 1 then raise exception 'FAIL: reclaim should count an attempt'; end if;
end $$;
delete from public.autopilot_runs;

-- f) staging is idempotent; a capped run discards findings and publishes nothing (D-02)
do $$ declare rid bigint; r jsonb; begin
  rid := (public.autopilot_start_run('manual', 'test:ap')->>'run_id')::bigint;
  perform public.autopilot_stage_findings(rid, 'test:ap', 'schedule_item',
    '[{"target_key":"Engine Oil","after":{"interval_km":15000,"interval_months":12,"note":"","parts":[]},"evidence":[{"url":"https://a.example/x","tier":"official","quote":"q"}]}]');
  perform public.autopilot_stage_findings(rid, 'test:ap', 'schedule_item',
    '[{"target_key":"Engine Oil","after":{"interval_km":16000,"interval_months":12,"note":"","parts":[]},"evidence":[{"url":"https://a.example/x","tier":"official","quote":"q"}]}]');
  if (select count(*) from public.autopilot_findings where run_id = rid) <> 1 then
    raise exception 'FAIL: restaging must replace, not append'; end if;
  if (select (after->>'interval_km')::int from public.autopilot_findings where run_id = rid) <> 16000 then
    raise exception 'FAIL: restaging kept the old row'; end if;
  perform public.autopilot_end_run(rid, 'capped');
  if exists (select 1 from public.autopilot_findings where run_id = rid) then raise exception 'FAIL: capped run kept findings'; end if;
  if exists (select 1 from public.autopilot_jobs where run_id = rid and status in ('queued', 'running')) then
    raise exception 'FAIL: capped run left open jobs'; end if;
  if (select status from public.autopilot_runs where id = rid) <> 'capped' then raise exception 'FAIL: run status'; end if;
  r := public.autopilot_publish_run(rid);
  if (r->>'ok')::boolean then raise exception 'FAIL: capped run published'; end if;
  if exists (select 1 from public.proposals where run_id = rid) then raise exception 'FAIL: capped run produced proposals'; end if;
  begin perform public.autopilot_stage_findings(rid, 'test:ap', 'schedule_item', '[]');
    raise exception 'FAIL: staged into an ended run';
  exception when raise_exception then if sqlerrm <> 'run not running' then raise; end if; end;
end $$;
delete from public.autopilot_runs;

-- g) publish: monthly item status (verified resets, missed counts, noop verifies, flag at 2)
do $$ declare rid bigint; r jsonb; s public.autopilot_item_status; begin
  -- run 1: Engine Oil changed (inserted proposal, verified); the other items are not seen
  rid := (public.autopilot_start_run('monthly')->>'run_id')::bigint;
  update public.autopilot_jobs set status = 'done' where run_id = rid and stage <> 'publish';
  perform public.autopilot_stage_findings(rid, 'test:ap', 'schedule_item',
    '[{"target_key":"Engine Oil","after":{"interval_km":15000,"interval_months":12,"note":"new","parts":[]},"evidence":[{"url":"https://a.example/x","tier":"official","quote":"q"}]}]');
  r := public.autopilot_publish_run(rid);
  if r->>'status' <> 'done' then raise exception 'FAIL: run 1 status %', r; end if;
  if (r->'report'->'proposals'->'schedule_item'->>'inserted')::int <> 1 then raise exception 'FAIL: report counts %', r->'report'; end if;
  if not (r->'report' ? 'cost_sar' and r->'report' ? 'searches' and r->'report' ? 'llm_calls'
          and r->'report' ? 'dropped' and r->'report' ? 'skipped_sources' and r->'report' ? 'failed_jobs') then
    raise exception 'FAIL: report shape %', r->'report'; end if;
  if (select run_id from public.proposals where car_model_id = 'test:ap' and target_key = 'Engine Oil' and status = 'pending') <> rid then
    raise exception 'FAIL: proposal does not carry run_id'; end if;
  if exists (select 1 from public.autopilot_findings where run_id = rid) then raise exception 'FAIL: findings kept after publish'; end if;
  select * into s from public.autopilot_item_status where car_model_id = 'test:ap' and target_key = 'Engine Oil';
  if s.missed_runs <> 0 or s.last_verified_at is null then raise exception 'FAIL: Engine Oil should be verified'; end if;
  select * into s from public.autopilot_item_status where car_model_id = 'test:ap' and target_key = 'Spark Plug';
  if s.missed_runs <> 1 or s.unverified then raise exception 'FAIL: Spark Plug should have 1 miss, not flagged'; end if;

  -- run 2: Cabin Filter equals live (noop counts as verified); Spark Plug missed again -> flagged
  rid := (public.autopilot_start_run('monthly')->>'run_id')::bigint;
  update public.autopilot_jobs set status = 'done' where run_id = rid and stage <> 'publish';
  perform public.autopilot_stage_findings(rid, 'test:ap', 'schedule_item',
    '[{"target_key":"Cabin Filter","after":{"interval_km":20000,"interval_months":24,"note":"","parts":[]},"evidence":[{"url":"https://a.example/x","tier":"official","quote":"q"}]}]');
  r := public.autopilot_publish_run(rid);
  if (r->'report'->'proposals'->'schedule_item'->>'noop')::int <> 1 then raise exception 'FAIL: expected a noop: %', r->'report'; end if;
  select * into s from public.autopilot_item_status where car_model_id = 'test:ap' and target_key = 'Cabin Filter';
  if s.missed_runs <> 0 or s.last_verified_run <> rid then raise exception 'FAIL: noop should verify Cabin Filter'; end if;
  select * into s from public.autopilot_item_status where car_model_id = 'test:ap' and target_key = 'Spark Plug';
  if s.missed_runs <> 2 or not s.unverified then raise exception 'FAIL: Spark Plug should be flagged after 2 misses'; end if;
  select * into s from public.autopilot_item_status where car_model_id = 'test:ap' and target_key = 'Engine Oil';
  if s.missed_runs <> 1 then raise exception 'FAIL: Engine Oil should have 1 miss'; end if;
end $$;

-- h) a failed car job still lets other findings publish; the run ends failed; jobs-pending blocks publish
do $$ declare rid bigint; r jsonb; begin
  rid := (public.autopilot_start_run('monthly')->>'run_id')::bigint;
  r := public.autopilot_publish_run(rid);
  if r->>'reason' <> 'jobs_pending' then raise exception 'FAIL: publish with open jobs: %', r; end if;
  update public.autopilot_jobs set status = 'done' where run_id = rid and stage <> 'publish';
  update public.autopilot_jobs set status = 'failed', last_error = 'boom'
    where run_id = rid and stage = 'discover' and car_model_id <> 'test:ap'
      and id = (select min(id) from public.autopilot_jobs where run_id = rid and stage = 'discover' and car_model_id <> 'test:ap');
  perform public.autopilot_stage_findings(rid, 'test:ap', 'schedule_item',
    '[{"target_key":"Engine Oil","after":{"interval_km":16000,"interval_months":12,"note":"newer","parts":[]},"evidence":[{"url":"https://a.example/x","tier":"official","quote":"q"}]}]');
  r := public.autopilot_publish_run(rid);
  if r->>'status' <> 'failed' then raise exception 'FAIL: run with a failed job should end failed: %', r; end if;
  if (r->'report'->'proposals'->'schedule_item'->>'inserted')::int <> 1 then raise exception 'FAIL: other findings must still publish'; end if;
  if jsonb_array_length(r->'report'->'failed_jobs') <> 1 then raise exception 'FAIL: failed job not in report'; end if;
end $$;

-- i) a manual publish leaves missed_runs and last_verified_at alone
do $$ declare rid bigint; before_s jsonb; after_s jsonb; begin
  select jsonb_agg(to_jsonb(s) order by target_key) into before_s from public.autopilot_item_status s where car_model_id = 'test:ap';
  rid := (public.autopilot_start_run('manual', 'test:ap')->>'run_id')::bigint;
  update public.autopilot_jobs set status = 'done' where run_id = rid and stage <> 'publish';
  -- Spark Plug equals live: would verify and reset a monthly item
  perform public.autopilot_stage_findings(rid, 'test:ap', 'schedule_item',
    '[{"target_key":"Spark Plug","after":{"interval_km":60000,"interval_months":72,"note":"","parts":[]},"evidence":[{"url":"https://a.example/x","tier":"official","quote":"q"}]}]');
  perform public.autopilot_publish_run(rid);
  select jsonb_agg(to_jsonb(s) order by target_key) into after_s from public.autopilot_item_status s where car_model_id = 'test:ap';
  if before_s is distinct from after_s then raise exception 'FAIL: manual run changed item status'; end if;
end $$;

-- j) a monthly extract whose sources were all unchanged counts neither verified nor missed
do $$ declare rid bigint; before_s jsonb; after_s jsonb; begin
  select jsonb_agg(to_jsonb(s) order by target_key) into before_s from public.autopilot_item_status s where car_model_id = 'test:ap';
  rid := (public.autopilot_start_run('monthly')->>'run_id')::bigint;
  update public.autopilot_jobs set status = 'done' where run_id = rid and stage <> 'publish';
  update public.autopilot_jobs set notes = '{"unchanged":true}' where run_id = rid and stage = 'extract' and car_model_id = 'test:ap';
  perform public.autopilot_publish_run(rid);
  select jsonb_agg(to_jsonb(s) order by target_key) into after_s from public.autopilot_item_status s where car_model_id = 'test:ap';
  if before_s is distinct from after_s then raise exception 'FAIL: unchanged-source car moved item status'; end if;
end $$;

-- k) a cap/kill-ended monthly run publishes nothing and counts no misses
do $$ declare rid bigint; before_s jsonb; after_s jsonb; begin
  select jsonb_agg(to_jsonb(s) order by target_key) into before_s from public.autopilot_item_status s where car_model_id = 'test:ap';
  rid := (public.autopilot_start_run('monthly')->>'run_id')::bigint;
  update public.autopilot_jobs set status = 'done' where run_id = rid and stage <> 'publish';
  perform public.autopilot_stage_findings(rid, 'test:ap', 'schedule_item',
    '[{"target_key":"Engine Oil","after":{"interval_km":17000,"interval_months":12,"note":"x","parts":[]},"evidence":[{"url":"https://a.example/x","tier":"official","quote":"q"}]}]');
  perform public.autopilot_end_run(rid, 'stopped');
  perform public.autopilot_publish_run(rid);
  if exists (select 1 from public.proposals where run_id = rid) then raise exception 'FAIL: stopped run produced proposals'; end if;
  select jsonb_agg(to_jsonb(s) order by target_key) into after_s from public.autopilot_item_status s where car_model_id = 'test:ap';
  if before_s is distinct from after_s then raise exception 'FAIL: stopped run changed item status'; end if;
end $$;

-- l) source hash round trip (service_role only) and domain rules
set local role service_role;
do $$ begin
  if public.autopilot_get_source_hash('test:ap', 'https://h.example/p') is not null then raise exception 'FAIL: unseen hash not null'; end if;
  perform public.autopilot_set_source_hash('test:ap', 'https://h.example/p', 'aaa');
  if public.autopilot_get_source_hash('test:ap', 'https://h.example/p') <> 'aaa' then raise exception 'FAIL: hash round trip'; end if;
  perform public.autopilot_set_source_hash('test:ap', 'https://h.example/p', 'bbb');
  if public.autopilot_get_source_hash('test:ap', 'https://h.example/p') <> 'bbb' then raise exception 'FAIL: hash update'; end if;
  if public.autopilot_see_domain('New.Example') <> 'pending' then raise exception 'FAIL: unseen domain not held'; end if;
  if public.autopilot_see_domain('new.example') <> 'pending' then raise exception 'FAIL: second sight changed status'; end if;
end $$;
reset role;

-- m) ban: rejects pending proposals on the host (and subdomains) with 'banned source'; others stay
do $$ begin
  perform public.submit_proposal('schedule_item', 'test:ap', 'Cabin Filter',
    '{"interval_km":15000,"interval_months":24,"note":"","parts":[]}'::jsonb,
    '[{"url":"https://www.bad.example/x","tier":"official","quote":"q"}]'::jsonb);
  perform public.submit_proposal('schedule_item', 'test:ap', 'Spark Plug',
    '{"interval_km":50000,"interval_months":72,"note":"","parts":[]}'::jsonb,
    '[{"url":"https://good.example/x","tier":"official","quote":"q"}]'::jsonb);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
do $$ declare r jsonb; begin
  r := public.ban_source_domain('BAD.example');
  if (r->>'rejected')::int <> 1 then raise exception 'FAIL: ban should reject 1 proposal: %', r; end if;
end $$;
reset role;
do $$ begin
  if (select reject_reason from public.proposals where car_model_id = 'test:ap' and target_key = 'Cabin Filter' and status = 'rejected'
        order by id desc limit 1) <> 'banned source' then raise exception 'FAIL: reject reason'; end if;
  if (select status from public.proposals where car_model_id = 'test:ap' and target_key = 'Spark Plug' and status = 'pending') is null then
    raise exception 'FAIL: unrelated proposal was rejected'; end if;
  if (select status from public.source_domains where host = 'bad.example') <> 'banned' then raise exception 'FAIL: domain not banned'; end if;
end $$;
set local role service_role;
do $$ begin
  if public.autopilot_see_domain('sub.bad.example') <> 'banned' then raise exception 'FAIL: subdomain of banned host not banned'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
do $$ begin
  begin perform public.approve_source_domain('bad.example'); raise exception 'FAIL: banned domain re-approved';
  exception when raise_exception then if sqlerrm <> 'banned is permanent' then raise; end if; end;
  perform public.approve_source_domain('new.example');
end $$;
reset role;
do $$ begin
  if (select status from public.source_domains where host = 'new.example') <> 'approved' then raise exception 'FAIL: approve'; end if;
end $$;

-- n) Phase 4 rotation (D-19): optional stages for the N least-recently-done cars, after all core jobs
delete from public.autopilot_runs;
insert into public.car_models (id, model, generation, engine, status) values
  ('rot:a', 'ROT', 'A', 'E', 'approved'), ('rot:b', 'ROT', 'B', 'E', 'approved'), ('rot:c', 'ROT', 'C', 'E', 'approved');
update public.autopilot_config set optional_cars_per_run = 2;
-- every other approved car is recent, so only the rot:* cars compete: rot:c never done (first), rot:a oldest, rot:b newest
insert into public.autopilot_due (car_model_id, stage, last_done_at)
  select id, v.s, now() from public.car_models, (values ('parts'), ('community')) v(s) where status = 'approved' and id not like 'rot:%';
insert into public.autopilot_due values ('rot:a', 'parts', now() - interval '60 days'), ('rot:a', 'community', now() - interval '60 days'),
  ('rot:b', 'parts', now() - interval '10 days'), ('rot:b', 'community', now() - interval '10 days');
do $$ declare rid bigint; cars int; maxcore bigint; minopt bigint; j jsonb; pj bigint; begin
  select count(*) into cars from public.car_models where status = 'approved';
  rid := (public.autopilot_start_run('monthly')->>'run_id')::bigint;
  if (select count(*) from public.autopilot_jobs where run_id = rid and stage in ('discover', 'extract', 'recalls')) <> cars * 3 then
    raise exception 'FAIL: core jobs must still cover every car'; end if;
  if (select count(*) from public.autopilot_jobs where run_id = rid and stage = 'parts') <> 2
     or (select count(*) from public.autopilot_jobs where run_id = rid and stage = 'community') <> 2 then
    raise exception 'FAIL: expected parts+community for exactly 2 cars'; end if;
  if (select array_agg(distinct car_model_id order by car_model_id) from public.autopilot_jobs where run_id = rid and stage = 'parts') <> array['rot:a', 'rot:c'] then
    raise exception 'FAIL: rotation should pick the never-done and the oldest car'; end if;
  if (select count(*) from public.autopilot_jobs where run_id = rid and stage = 'models' and car_model_id is null) <> 1 then
    raise exception 'FAIL: one models job (null car) expected'; end if;
  select max(id) into maxcore from public.autopilot_jobs where run_id = rid and stage in ('discover', 'extract', 'recalls');
  select min(id) into minopt from public.autopilot_jobs where run_id = rid and stage in ('parts', 'community', 'models');
  if minopt <= maxcore then raise exception 'FAIL: optional jobs must queue after every core job'; end if;
  if (select stage from public.autopilot_jobs where run_id = rid order by id desc limit 1) <> 'publish' then
    raise exception 'FAIL: publish must be last'; end if;

  -- community waits for the same car's parts job
  update public.autopilot_jobs set status = 'done' where run_id = rid and stage in ('discover', 'extract', 'recalls');
  j := public.autopilot_claim_job();
  if j->>'stage' <> 'parts' or j->>'car_model_id' <> 'rot:c' then raise exception 'FAIL: first optional claim should be parts of rot:c: %', j; end if;
  pj := (j->>'id')::bigint;
  j := public.autopilot_claim_job();   -- rot:c community is blocked, rot:a parts is next
  if j->>'stage' <> 'parts' or j->>'car_model_id' <> 'rot:a' then raise exception 'FAIL: community claimed before its parts job: %', j; end if;
  -- finish ok stamps autopilot_due; a failed job leaves it unchanged
  perform public.autopilot_finish_job(pj, true);
  if (select last_done_at from public.autopilot_due where car_model_id = 'rot:c' and stage = 'parts') < now() - interval '1 minute' then
    raise exception 'FAIL: finished parts job did not stamp autopilot_due'; end if;
  update public.autopilot_jobs set attempts = 2 where id = (j->>'id')::bigint;
  perform public.autopilot_finish_job((j->>'id')::bigint, false, 'boom');
  if (select last_done_at from public.autopilot_due where car_model_id = 'rot:a' and stage = 'parts') > now() - interval '30 days' then
    raise exception 'FAIL: failed parts job moved autopilot_due'; end if;
  j := public.autopilot_claim_job();
  if j->>'stage' <> 'community' then raise exception 'FAIL: community should follow a done or failed parts job: %', j; end if;
end $$;
delete from public.autopilot_runs;

-- manual: that car regardless of rotation, no models job
do $$ declare rid bigint; begin
  rid := (public.autopilot_start_run('manual', 'rot:b')->>'run_id')::bigint;
  if (select count(*) from public.autopilot_jobs where run_id = rid and stage in ('parts', 'community') and car_model_id = 'rot:b') <> 2 then
    raise exception 'FAIL: manual run should queue parts+community for its car'; end if;
  if exists (select 1 from public.autopilot_jobs where run_id = rid and stage = 'models') then raise exception 'FAIL: manual run queued a models job'; end if;
end $$;
delete from public.autopilot_runs;

-- o) soft budget: cap minus month-to-date reserved+settled, no reservation made
do $$ declare b numeric; begin
  delete from public.autopilot_spend;
  b := public.autopilot_budget_left();
  if b <> (select monthly_cap_sar from public.autopilot_config) then raise exception 'FAIL: budget_left with no spend: %', b; end if;
  insert into public.autopilot_spend (status, reserved_sar, cost_sar) values ('reserved', 1.5, 1.5), ('settled', 0, 2.25);
  if public.autopilot_budget_left() <> b - 3.75 then raise exception 'FAIL: budget_left should subtract spend: %', public.autopilot_budget_left(); end if;
  if (select count(*) from public.autopilot_spend) <> 2 then raise exception 'FAIL: budget_left must not reserve'; end if;
end $$;

-- p) null-car staging (car_model kind): replace on restage, dedupe, users evidence publishes, optional failure keeps the run done
do $$ declare rid bigint; r jsonb; begin
  rid := (public.autopilot_start_run('monthly')->>'run_id')::bigint;
  update public.autopilot_jobs set status = 'done' where run_id = rid and stage <> 'publish';
  update public.autopilot_jobs set status = 'failed', last_error = 'boom'
   where id = (select min(id) from public.autopilot_jobs where run_id = rid and stage = 'parts');
  perform public.autopilot_stage_findings(rid, null, 'car_model',
    '[{"target_key":"newmodel:1","after":{"make":"Mazda","model":"N","generation":"1","engine":"E"},"evidence":[{"url":"https://a.example/x","tier":"official","quote":"q"}]}]');
  perform public.autopilot_stage_findings(rid, null, 'car_model',
    '[{"target_key":"newmodel:2","after":{"make":"Mazda","model":"N","generation":"2","engine":"E"},"evidence":[{"url":"https://a.example/x","tier":"official","quote":"q"}]}]');
  if (select count(*) from public.autopilot_findings where run_id = rid and kind = 'car_model') <> 1
     or (select target_key from public.autopilot_findings where run_id = rid and kind = 'car_model') <> 'newmodel:2' then
    raise exception 'FAIL: restaging a null-car kind must replace, not append'; end if;
  begin
    perform public.autopilot_stage_findings(rid, null, 'car_model',
      '[{"target_key":"dup","after":{},"evidence":[]},{"target_key":"dup","after":{},"evidence":[]}]');
    raise exception 'FAIL: duplicate null-car target_key accepted';
  exception when unique_violation then null; end;
  begin perform public.autopilot_stage_findings(rid, 'rot:a', 'car_model', '[]'); raise exception 'FAIL: car_model with a car';
  exception when raise_exception then if sqlerrm <> 'bad car for kind' then raise; end if; end;
  begin perform public.autopilot_stage_findings(rid, null, 'part', '[]'); raise exception 'FAIL: part without a car';
  exception when raise_exception then if sqlerrm <> 'bad car for kind' then raise; end if; end;
  -- users-only evidence (no url) is not a banned host: the part finding publishes
  perform public.autopilot_stage_findings(rid, 'rot:b', 'part',
    '[{"target_key":"Oil Filter|oem","after":{"brand":"X","part_no":"1","price":40,"price_basis":"indicative"},"evidence":[{"type":"users","tier":"community","users":3,"median":40}]}]');
  r := public.autopilot_publish_run(rid);
  if (r->'report'->'proposals'->'part'->>'banned') is not null then raise exception 'FAIL: users evidence treated as banned: %', r->'report'; end if;
  if (r->'report'->'proposals'->'part'->>'inserted')::int is distinct from 1 then raise exception 'FAIL: users-evidence part not inserted: %', r->'report'; end if;
  if (r->'report'->'proposals'->'car_model'->>'inserted')::int is distinct from 1 then raise exception 'FAIL: car_model finding not published: %', r->'report'; end if;
  if r->>'status' <> 'done' then raise exception 'FAIL: failed optional job must not fail the run: %', r->>'status'; end if;
  if jsonb_array_length(r->'report'->'failed_jobs') <> 1 then raise exception 'FAIL: optional failure missing from report'; end if;
end $$;

-- q) user agreement: aggregates only, 3+ distinct users, trimmed median, engine matching
insert into auth.users (id, created_at, email_confirmed_at)
  select ('00000000-0000-0000-0000-0000000000a' || i)::uuid, now(), now() from generate_series(1, 5) i on conflict (id) do nothing;
insert into public.car_models (id, model, generation, engine, status) values
  ('agone:g1', 'AG1', 'G', 'Solo', 'approved'),
  ('agmul:g1', 'AGM', 'G', 'Alpha', 'approved'), ('agmul:g2', 'AGM', 'G', 'Beta', 'approved');
-- one row per (user, price): the link join below keys on that, so every price is unique per item
create temp table _ag (u int, model text, eng text, item text, partno text, price numeric) on commit drop;
insert into _ag values
  -- multi-engine, Alpha: 3 users 40/42/41 (part_no spelled three ways); NULL-engine and Beta rows must be ignored
  (1, 'agmul', 'Alpha', 'Oil Filter', 'OF-1', 40), (2, 'agmul', 'ALPHA', 'Oil Filter', 'of 1', 42), (3, 'agmul', 'alpha', 'Oil Filter', 'OF1', 41),
  (4, 'agmul', null, 'Oil Filter', 'OF-1', 1000), (5, 'agmul', 'Beta', 'Oil Filter', 'OF-1', 1001),
  -- 4 users with an outlier: 40/41/42/100
  (1, 'agmul', 'Alpha', 'Air Filter', 'AF-1', 40), (2, 'agmul', 'Alpha', 'Air Filter', 'AF-1', 41),
  (3, 'agmul', 'Alpha', 'Air Filter', 'AF-1', 42), (4, 'agmul', 'Alpha', 'Air Filter', 'AF-1', 100),
  -- only 2 users: no group
  (1, 'agmul', 'Alpha', 'Brake Pad', 'BP-1', 100), (2, 'agmul', 'Alpha', 'Brake Pad', 'BP-1', 101),
  -- single-engine model: NULL-engine rows count
  (1, 'agone', null, 'Wiper', 'W-1', 10), (2, 'agone', 'Solo', 'Wiper', 'W-1', 20), (3, 'agone', null, 'Wiper', 'W-1', 30);
create temp table _agc (id uuid, u int) on commit drop;
with ins as (
  insert into public.contributions (kind, model_id, engine, odometer_band, month, item_key, brand, part_no, price)
    select 'part', model, eng, 0, '2026-01', item, 'B', partno, price from _ag returning id, model_id, engine, item_key, part_no, price)
insert into _agc select ins.id, a.u from ins join _ag a
  on a.model = ins.model_id and a.eng is not distinct from ins.engine and a.item = ins.item_key and a.partno = ins.part_no and a.price = ins.price;
insert into public.contribution_links (user_id, source_key, contribution_id)
  select ('00000000-0000-0000-0000-0000000000a' || u)::uuid, 'ag:' || id, id from _agc;
-- user 1 re-submits the Wiper later at 25: only the latest counts, still one user
do $$ declare cid uuid; begin
  insert into public.contributions (kind, model_id, engine, odometer_band, month, item_key, brand, part_no, price, created_at)
    values ('part', 'agone', null, 0, '2026-02', 'Wiper', 'B', 'W-1', 25, now() + interval '1 day') returning id into cid;
  insert into public.contribution_links values ('00000000-0000-0000-0000-0000000000a1', 'ag:resubmit', cid);
end $$;
do $$ declare r jsonb; g jsonb; begin
  r := public.autopilot_user_agreement('agmul:g1');
  select e into g from jsonb_array_elements(r) e where e->>'item_key' = 'Oil Filter';
  if g is null or (g->>'users')::int <> 3 or (g->>'median_price')::numeric <> 41 then raise exception 'FAIL: Oil Filter group %', r; end if;
  select e into g from jsonb_array_elements(r) e where e->>'item_key' = 'Air Filter';
  if g is null or (g->>'users')::int <> 3 or (g->>'median_price')::numeric <> 41 then raise exception 'FAIL: outlier not trimmed: %', r; end if;
  if exists (select 1 from jsonb_array_elements(r) e where e->>'item_key' = 'Brake Pad') then raise exception 'FAIL: 2 users made a group'; end if;
  if r::text ~ 'user_id' or r::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then raise exception 'FAIL: user identity in output: %', r; end if;
  -- the Beta car has a single Beta row: no group
  if jsonb_array_length(public.autopilot_user_agreement('agmul:g2')) <> 0 then raise exception 'FAIL: other engine leaked'; end if;
  -- single-engine model: NULL-engine rows count; user 1 counted once at the latest price 25: 25/20/30 -> median 25
  r := public.autopilot_user_agreement('agone:g1');
  select e into g from jsonb_array_elements(r) e where e->>'item_key' = 'Wiper';
  if g is null or (g->>'users')::int <> 3 or (g->>'median_price')::numeric <> 25 then raise exception 'FAIL: single-engine Wiper %', r; end if;
  if jsonb_array_length(public.autopilot_user_agreement('no:such')) <> 0 then raise exception 'FAIL: unknown car'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
do $$ begin
  begin perform public.autopilot_user_agreement('agmul:g1'); raise exception 'FAIL: authenticated reads user agreement';
  exception when insufficient_privilege then null; end;
  begin perform public.autopilot_budget_left(); raise exception 'FAIL: authenticated reads budget';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.autopilot_user_agreement('agmul:g1'); raise exception 'FAIL: anon reads user agreement';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
