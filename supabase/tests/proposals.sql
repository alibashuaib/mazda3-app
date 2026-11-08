-- RLS + gate check for proposals / change_log / apply_proposal (Phase 2, CORE-01..CORE-07).
-- Runs in the `rls` CI job after schema.sql and seed-catalogue.sql:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/proposals.sql
-- Fixtures: ...0f1 = plain user, ...0f2 = admin. Raises 'FAIL: ...' on a broken
-- rule; finishing silently means pass. Ends in ROLLBACK, nothing persists.
begin;

insert into auth.users (id, created_at, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000f1', now(), now()),
  ('00000000-0000-0000-0000-0000000000f2', now(), now()) on conflict (id) do nothing;
insert into public.profiles (user_id, role) values ('00000000-0000-0000-0000-0000000000f2', 'admin')
  on conflict (user_id) do update set role = 'admin';

insert into public.car_models (id, model, generation, engine, status, plan_updated_at)
values ('test:gate', 'TEST', 'TEST', 'TEST', 'approved', '2000-01-01');
insert into public.dealer_plan_items (car_model_id, service, interval_km, interval_months, note) values
  ('test:gate', 'Engine Oil', 10000, 12, 'old'),
  ('test:gate', 'Cabin Filter', 20000, 24, ''),
  ('test:gate', 'Spark Plug', 60000, 72, '');
-- The trigger from the earlier inserts may have bumped it; pin it for case f.
update public.car_models set plan_updated_at = '2000-01-01' where id = 'test:gate';

-- a) maker_id is filled by the trigger
do $$ begin
  if (select maker_id from public.car_models where id = 'test:gate') is distinct from
     (select lower(make) from public.car_models where id = 'test:gate') then
    raise exception 'FAIL: maker_id not set by trigger';
  end if;
end $$;

-- e) confidence: two official hosts on a 50% change is high; one community source on a big jump is low
do $$ declare t1 text; t2 text; begin
  perform public.submit_proposal('schedule_item', 'test:gate', 'Engine Oil',
    '{"interval_km":15000,"interval_months":12,"note":"new","parts":[]}'::jsonb,
    '[{"url":"https://a.example/x","tier":"official","quote":"q"},{"url":"https://b.example/y","tier":"official","quote":"q"}]'::jsonb);
  perform public.submit_proposal('schedule_item', 'test:gate', 'Spark Plug',
    '{"interval_km":150000,"interval_months":72,"note":"","parts":[]}'::jsonb,
    '[{"url":"https://forum.example/t","tier":"community","quote":"q"}]'::jsonb);
  select confidence_tier into t1 from public.proposals where car_model_id = 'test:gate' and target_key = 'Engine Oil';
  select confidence_tier into t2 from public.proposals where car_model_id = 'test:gate' and target_key = 'Spark Plug';
  if t1 <> 'high' then raise exception 'FAIL: expected high, got %', t1; end if;
  if t2 <> 'low' then raise exception 'FAIL: expected low, got %', t2; end if;
end $$;

-- b) anon: no table access, no RPC
set local role anon;
do $$ begin
  begin perform 1 from public.proposals; raise exception 'FAIL: anon selects proposals';
  exception when insufficient_privilege then null; end;
  begin insert into public.proposals (kind, maker_id, target_key, op, base_hash, after, after_hash, evidence, sources_hash, confidence_tier)
    values ('schedule_item', 'mazda', 'x', 'insert', 'h', '{}', 'h', '[]', 'h', 'low');
    raise exception 'FAIL: anon inserts proposals';
  exception when insufficient_privilege then null; end;
  begin update public.proposals set status = 'approved'; raise exception 'FAIL: anon updates proposals';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.change_log; raise exception 'FAIL: anon selects change_log';
  exception when insufficient_privilege then null; end;
  begin perform public.submit_proposal('schedule_item', 'test:gate', 'x', '{}'::jsonb, '[]'::jsonb);
    raise exception 'FAIL: anon calls submit_proposal';
  exception when insufficient_privilege then null; end;
  begin perform public.apply_proposal(1); raise exception 'FAIL: anon calls apply_proposal';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- c) signed-in non-admin: sees nothing, cannot apply or submit
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.proposals;
  if n <> 0 then raise exception 'FAIL: non-admin sees % proposals', n; end if;
  select count(*) into n from public.change_log;
  if n <> 0 then raise exception 'FAIL: non-admin sees % change_log rows', n; end if;
  begin perform public.apply_proposal((select min(id) from public.proposals));
    raise exception 'FAIL: non-admin applied a proposal';
  exception when raise_exception then
    if sqlerrm <> 'admin only' then raise exception 'FAIL: expected admin only, got %', sqlerrm; end if;
  end;
  begin perform public.apply_proposal(1);
    raise exception 'FAIL: non-admin applied proposal 1';
  exception when raise_exception then
    if sqlerrm <> 'admin only' then raise exception 'FAIL: expected admin only, got %', sqlerrm; end if;
  end;
  begin perform public.submit_proposal('schedule_item', 'test:gate', 'x', '{}'::jsonb, '[]'::jsonb);
    raise exception 'FAIL: non-admin calls submit_proposal';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- d) submit validation (as owner)
do $$
declare
  ok_ev constant jsonb := '[{"url":"https://a.example/x","tier":"official","quote":"q"}]';
  ok_after constant jsonb := '{"interval_km":1,"interval_months":1,"note":"","parts":[]}';
begin
  begin perform public.submit_proposal('schedule_item', 'test:gate', 'V1', ok_after,
      '[{"url":"javascript:alert(1)","tier":"official","quote":"q"}]');
    raise exception 'FAIL: javascript url accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;

  begin perform public.submit_proposal('schedule_item', 'test:gate', 'V2', ok_after,
      (select jsonb_agg(jsonb_build_object('url', 'https://a.example/' || g, 'tier', 'official', 'quote', 'q')) from generate_series(1, 11) g));
    raise exception 'FAIL: 11 evidence items accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;

  begin perform public.submit_proposal('schedule_item', 'test:gate', 'V3', ok_after,
      jsonb_build_array(jsonb_build_object('url', 'https://a.example/x', 'tier', 'official', 'quote', repeat('x', 501))));
    raise exception 'FAIL: 501-char quote accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;

  begin perform public.submit_proposal('schedule_item', 'test:gate', 'V4', '{"currency":"USD"}'::jsonb, ok_ev);
    raise exception 'FAIL: USD accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;

  begin perform public.submit_proposal('schedule_item', 'test:gate', 'V5', '{"distance_unit":"mi"}'::jsonb, ok_ev);
    raise exception 'FAIL: miles accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;

  begin perform public.submit_proposal('nope', 'test:gate', 'V6', ok_after, ok_ev);
    raise exception 'FAIL: unknown kind accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;

-- f) admin approves Engine Oil: live row, change_log, plan_updated_at, anon visibility
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
do $$ declare pid bigint; r jsonb; cl public.change_log; begin
  select id into pid from public.proposals where car_model_id = 'test:gate' and target_key = 'Engine Oil' and status = 'pending';
  if pid is null then raise exception 'FAIL: admin cannot see the pending proposal'; end if;
  r := public.apply_proposal(pid);
  if (r->>'ok') is distinct from 'true' then raise exception 'FAIL: approve returned %', r; end if;
  if (select interval_km from public.dealer_plan_items where car_model_id = 'test:gate' and service = 'Engine Oil') <> 15000 then
    raise exception 'FAIL: live row not updated'; end if;
  select * into cl from public.change_log where proposal_id = pid;
  if cl.id is null then raise exception 'FAIL: no change_log row'; end if;
  if cl.made_by is distinct from '00000000-0000-0000-0000-0000000000f2'::uuid then raise exception 'FAIL: made_by %', cl.made_by; end if;
  if cl.before->>'interval_km' <> '10000' or cl.after->>'interval_km' <> '15000' then raise exception 'FAIL: change_log before/after'; end if;
  if (select status from public.proposals where id = pid) <> 'approved' then raise exception 'FAIL: status not approved'; end if;
  if (select decided_by from public.proposals where id = pid) is distinct from '00000000-0000-0000-0000-0000000000f2'::uuid then
    raise exception 'FAIL: decided_by'; end if;
  if (select plan_updated_at from public.car_models where id = 'test:gate') <= '2000-01-01' then
    raise exception 'FAIL: plan_updated_at not advanced'; end if;
end $$;
reset role;

-- SC2: users (anon) read the new value
set local role anon;
do $$ begin
  if (select interval_km from public.dealer_plan_items where car_model_id = 'test:gate' and service = 'Engine Oil') is distinct from 15000 then
    raise exception 'FAIL: anon does not see the approved value'; end if;
end $$;
reset role;

-- g) stale: the live row changed after the proposal was made
do $$ begin
  perform public.submit_proposal('schedule_item', 'test:gate', 'Cabin Filter',
    '{"interval_km":30000,"interval_months":24,"note":"","parts":[]}'::jsonb,
    '[{"url":"https://a.example/x","tier":"official","quote":"q"}]'::jsonb);
end $$;
update public.dealer_plan_items set interval_km = 25000 where car_model_id = 'test:gate' and service = 'Cabin Filter';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
do $$ declare pid bigint; r jsonb; h text; begin
  select id into pid from public.proposals where car_model_id = 'test:gate' and target_key = 'Cabin Filter' and status = 'pending';
  r := public.apply_proposal(pid);
  if r->>'error' is distinct from 'stale' or (r->>'ok') <> 'false' then raise exception 'FAIL: expected stale, got %', r; end if;
  if r->'live'->>'interval_km' <> '25000' then raise exception 'FAIL: stale reply lacks the live value'; end if;
  h := r->>'live_hash';
  if h is null then raise exception 'FAIL: stale reply lacks live_hash'; end if;
  if (select status from public.proposals where id = pid) <> 'pending' then raise exception 'FAIL: stale changed status'; end if;
  if (select interval_km from public.dealer_plan_items where car_model_id = 'test:gate' and service = 'Cabin Filter') <> 25000 then
    raise exception 'FAIL: stale refusal wrote the live row'; end if;

  -- rebase without an edit is refused
  r := public.apply_proposal(pid, null, h);
  if r->>'error' is distinct from 'stale' then raise exception 'FAIL: seen hash without edit approved: %', r; end if;
  -- rebase with the wrong hash is refused
  r := public.apply_proposal(pid, '{"interval_km":1}'::jsonb, 'not-the-hash');
  if r->>'error' is distinct from 'stale' then raise exception 'FAIL: wrong seen hash approved: %', r; end if;
  -- rebase with the right hash and an edit applies, clamped
  r := public.apply_proposal(pid, '{"interval_km":5000000,"interval_months":24,"note":"edited","parts":[]}'::jsonb, h);
  if (r->>'ok') is distinct from 'true' then raise exception 'FAIL: rebased edit refused: %', r; end if;
  if (select interval_km from public.dealer_plan_items where car_model_id = 'test:gate' and service = 'Cabin Filter') <> 1000000 then
    raise exception 'FAIL: interval_km not clamped'; end if;
end $$;
reset role;

-- h) parts cap on an edit (Spark Plug proposal is still pending)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
do $$ declare pid bigint; begin
  select id into pid from public.proposals where car_model_id = 'test:gate' and target_key = 'Spark Plug' and status = 'pending';
  begin
    perform public.apply_proposal(pid, jsonb_build_object('interval_km', 1, 'parts',
      (select jsonb_agg(jsonb_build_object('name', 'p' || g)) from generate_series(1, 51) g)));
    raise exception 'FAIL: 51 parts accepted';
  exception when raise_exception then
    if sqlerrm <> 'too many parts' then raise exception 'FAIL: expected too many parts, got %', sqlerrm; end if;
  end;
end $$;
reset role;

-- i-l) queue hygiene on a fresh target (Brake Fluid has no live row)
do $$ declare r1 jsonb; r2 jsonb; a bigint; b bigint; r jsonb; n int; ev jsonb; ev2 jsonb; begin
  ev := '[{"url":"https://a.example/x","tier":"official","quote":"q","content_hash":"h1"}]';
  ev2 := '[{"url":"https://a.example/x","tier":"official","quote":"q","content_hash":"h2"}]';
  -- i) duplicate
  r1 := public.submit_proposal('schedule_item', 'test:gate', 'Brake Fluid', '{"interval_km":40000,"interval_months":24,"note":"","parts":[]}'::jsonb, ev);
  r2 := public.submit_proposal('schedule_item', 'test:gate', 'Brake Fluid', '{"interval_km":40000,"interval_months":24,"note":"","parts":[]}'::jsonb, ev);
  if r2->>'action' <> 'duplicate' or r2->>'id' <> r1->>'id' then raise exception 'FAIL: expected duplicate, got %', r2; end if;
  select count(*) into n from public.proposals where car_model_id = 'test:gate' and target_key = 'Brake Fluid' and status = 'pending';
  if n <> 1 then raise exception 'FAIL: duplicate made % pending rows', n; end if;
  -- j) supersede
  a := (r1->>'id')::bigint;
  r := public.submit_proposal('schedule_item', 'test:gate', 'Brake Fluid', '{"interval_km":30000,"interval_months":24,"note":"","parts":[]}'::jsonb, ev);
  b := (r->>'id')::bigint;
  if r->>'action' <> 'inserted' then raise exception 'FAIL: expected inserted, got %', r; end if;
  if (select status from public.proposals where id = a) <> 'superseded' then raise exception 'FAIL: older not superseded'; end if;
  select count(*) into n from public.proposals where car_model_id = 'test:gate' and target_key = 'Brake Fluid' and status = 'pending';
  if n <> 1 then raise exception 'FAIL: % pending after supersede', n; end if;
  -- l) noop: equal to the live Engine Oil row (approved to 15000/12/"new" in case f)
  r := public.submit_proposal('schedule_item', 'test:gate', 'Engine Oil', '{"interval_km":15000,"interval_months":12,"note":"new","parts":[]}'::jsonb, ev);
  if r->>'action' <> 'noop' then raise exception 'FAIL: expected noop, got %', r; end if;
  perform set_config('t.b', b::text, true);
end $$;

-- k, m, n) reject
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
do $$ begin
  begin perform public.reject_proposal(current_setting('t.b')::bigint);
    raise exception 'FAIL: non-admin rejected';
  exception when raise_exception then
    if sqlerrm <> 'admin only' then raise exception 'FAIL: expected admin only, got %', sqlerrm; end if;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
do $$ declare b bigint := current_setting('t.b')::bigint; begin
  perform public.reject_proposal(b, repeat('x', 400));
  if (select char_length(reject_reason) from public.proposals where id = b) <> 300 then
    raise exception 'FAIL: reason not truncated to 300'; end if;
  if (select status from public.proposals where id = b) <> 'rejected' then raise exception 'FAIL: not rejected'; end if;
end $$;
reset role;
do $$ declare b bigint := current_setting('t.b')::bigint; r jsonb; n0 int; ev jsonb; begin
  select count(*) into n0 from public.proposals;
  r := public.submit_proposal('schedule_item', 'test:gate', 'Brake Fluid', '{"interval_km":30000,"interval_months":24,"note":"","parts":[]}'::jsonb,
    '[{"url":"https://a.example/x","tier":"official","quote":"q","content_hash":"h1"}]');
  if r->>'action' <> 'suppressed' or (select count(*) from public.proposals) <> n0 then
    raise exception 'FAIL: expected suppressed, got %', r; end if;
  r := public.submit_proposal('schedule_item', 'test:gate', 'Brake Fluid', '{"interval_km":30000,"interval_months":24,"note":"","parts":[]}'::jsonb,
    '[{"url":"https://a.example/x","tier":"official","quote":"q","content_hash":"h2"}]');
  if r->>'action' <> 'inserted' then raise exception 'FAIL: changed sources not re-queued: %', r; end if;
end $$;
-- m) anon
set local role anon;
do $$ begin
  begin perform public.reject_proposal(1); raise exception 'FAIL: anon calls reject_proposal';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- o, p, q) bulk approve
insert into public.proposals (kind, maker_id, car_model_id, target_key, op, base_hash, after, after_hash, evidence, sources_hash, confidence_tier)
select 'schedule_item', 'mazda', 'test:gate', k, 'insert', md5('null'),
       case when k = 'Bulk E' then '{"interval_km":1,"interval_months":1,"note":"","parts":{}}'::jsonb
            else '{"interval_km":1000,"interval_months":6,"note":"","parts":[]}'::jsonb end,
       'h-' || k, '[]', 's-' || k, case when k = 'Bulk D' then 'medium' else 'high' end
from unnest(array['Bulk A','Bulk B','Bulk C','Bulk D','Bulk E']) k;
-- make B stale: a live row appears after the proposal was made
insert into public.dealer_plan_items (car_model_id, service, interval_km, interval_months, note) values ('test:gate', 'Bulk B', 5, 5, '');
select set_config('t.bulk', (select jsonb_object_agg(target_key, id)::text from public.proposals where target_key like 'Bulk %'), true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
do $$ declare m jsonb := current_setting('t.bulk')::jsonb; r jsonb; x jsonb; begin
  r := public.apply_proposals(array[(m->>'Bulk A')::bigint, (m->>'Bulk B')::bigint, (m->>'Bulk C')::bigint, (m->>'Bulk D')::bigint, (m->>'Bulk E')::bigint], 'high');
  if jsonb_array_length(r) <> 5 then raise exception 'FAIL: expected 5 results, got %', r; end if;
  for x in select value from jsonb_array_elements(r) loop
    if (x->>'id')::bigint in ((m->>'Bulk A')::bigint, (m->>'Bulk C')::bigint) and (x->>'ok') <> 'true' then raise exception 'FAIL: o) % not ok', x; end if;
    if (x->>'id')::bigint = (m->>'Bulk B')::bigint and x->>'error' is distinct from 'stale' then raise exception 'FAIL: o) B not stale: %', x; end if;
    if (x->>'id')::bigint = (m->>'Bulk D')::bigint and x->>'error' is distinct from 'not_high' then raise exception 'FAIL: o) D not not_high: %', x; end if;
    if (x->>'id')::bigint = (m->>'Bulk E')::bigint and x->>'error' is distinct from 'failed' then raise exception 'FAIL: p) E not failed: %', x; end if;
  end loop;
  if (select count(*) from public.dealer_plan_items where car_model_id = 'test:gate' and service in ('Bulk A','Bulk C') and interval_km = 1000) <> 2 then
    raise exception 'FAIL: o) A and C not applied'; end if;
  if (select count(*) from public.proposals where id in ((m->>'Bulk B')::bigint, (m->>'Bulk D')::bigint, (m->>'Bulk E')::bigint) and status = 'pending') <> 3 then
    raise exception 'FAIL: o/p) B, D, E must stay pending'; end if;
  -- q) tier and size limits
  begin perform public.apply_proposals(array[1]::bigint[], 'medium'); raise exception 'FAIL: medium accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin perform public.apply_proposals((select array_agg(g::bigint) from generate_series(1, 201) g), 'high'); raise exception 'FAIL: 201 ids accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
do $$ begin
  begin perform public.apply_proposals(array[1]::bigint[], 'high'); raise exception 'FAIL: non-admin bulk';
  exception when raise_exception then if sqlerrm <> 'admin only' then raise exception 'FAIL: expected admin only, got %', sqlerrm; end if; end;
end $$;
set local role anon;
do $$ begin
  begin perform public.apply_proposals(array[1]::bigint[], 'high'); raise exception 'FAIL: anon bulk';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- r, s, t, u) revert_change
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
do $$ declare ev constant jsonb := '[{"url":"https://a.example/x","tier":"official","quote":"q"}]';
  pa bigint; pb bigint; ca bigint; cb bigint; r jsonb; r1 bigint; r2 bigint; n int; begin
  -- Engine Oil is 15000 after case f. A: 15000 -> 16000, B: 16000 -> 17000.
  reset role;
  pa := (public.submit_proposal('schedule_item', 'test:gate', 'Engine Oil', '{"interval_km":16000,"interval_months":12,"note":"old","parts":[]}'::jsonb, ev)->>'id')::bigint;
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
  perform public.apply_proposal(pa);
  select id into ca from public.change_log where proposal_id = pa;
  reset role;
  pb := (public.submit_proposal('schedule_item', 'test:gate', 'Engine Oil', '{"interval_km":17000,"interval_months":12,"note":"old","parts":[]}'::jsonb, ev)->>'id')::bigint;
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
  perform public.apply_proposal(pb);
  select id into cb from public.change_log where proposal_id = pb;

  -- r) reverting A while B is live is refused
  r := public.revert_change(ca);
  if r->>'error' is distinct from 'drifted' or r->'live'->>'interval_km' <> '17000' then raise exception 'FAIL: r) expected drifted, got %', r; end if;
  if (select interval_km from public.dealer_plan_items where car_model_id = 'test:gate' and service = 'Engine Oil') <> 17000 then
    raise exception 'FAIL: r) drift refusal wrote the row'; end if;
  r := public.revert_change(cb);
  if (r->>'ok') is distinct from 'true' then raise exception 'FAIL: r) revert B: %', r; end if;
  r1 := (r->>'change_id')::bigint;
  if (select interval_km from public.dealer_plan_items where car_model_id = 'test:gate' and service = 'Engine Oil') <> 16000 then
    raise exception 'FAIL: r) B not reverted'; end if;
  if (select reverts_id from public.change_log where id = r1) is distinct from cb
     or (select made_by from public.change_log where id = r1) is distinct from '00000000-0000-0000-0000-0000000000f2'::uuid then
    raise exception 'FAIL: r) revert row reverts_id/made_by'; end if;
  r := public.revert_change(ca);
  if (r->>'ok') is distinct from 'true' then raise exception 'FAIL: r) revert A: %', r; end if;
  r2 := (r->>'change_id')::bigint;
  if (select interval_km from public.dealer_plan_items where car_model_id = 'test:gate' and service = 'Engine Oil') <> 15000 then
    raise exception 'FAIL: r) A not reverted'; end if;

  -- s) revert of a revert: R1 is stale now, R2 reverts cleanly
  r := public.revert_change(r1);
  if r->>'error' is distinct from 'drifted' then raise exception 'FAIL: s) expected drifted, got %', r; end if;
  r := public.revert_change(r2);
  if (r->>'ok') is distinct from 'true' or
     (select interval_km from public.dealer_plan_items where car_model_id = 'test:gate' and service = 'Engine Oil') <> 16000 then
    raise exception 'FAIL: s) revert of revert: %', r; end if;

  -- t) insert proposal: revert deletes, revert of that re-inserts by car + service
  reset role;
  pa := (public.submit_proposal('schedule_item', 'test:gate', 'Revert New', '{"interval_km":9000,"interval_months":9,"note":"n","parts":[]}'::jsonb, ev)->>'id')::bigint;
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
  perform public.apply_proposal(pa);
  select id into ca from public.change_log where proposal_id = pa;
  r := public.revert_change(ca);
  if (r->>'ok') is distinct from 'true' then raise exception 'FAIL: t) revert insert: %', r; end if;
  select count(*) into n from public.dealer_plan_items where car_model_id = 'test:gate' and service = 'Revert New';
  if n <> 0 then raise exception 'FAIL: t) row not deleted'; end if;
  if (select op from public.change_log where id = (r->>'change_id')::bigint) <> 'delete' then raise exception 'FAIL: t) op not delete'; end if;
  r := public.revert_change((r->>'change_id')::bigint);
  if (r->>'ok') is distinct from 'true' then raise exception 'FAIL: t) re-insert: %', r; end if;
  if (select interval_km from public.dealer_plan_items where car_model_id = 'test:gate' and service = 'Revert New') is distinct from 9000 then
    raise exception 'FAIL: t) row not re-inserted'; end if;
end $$;

-- u) non-admin and anon
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
do $$ begin
  begin perform public.revert_change(1); raise exception 'FAIL: non-admin revert';
  exception when raise_exception then if sqlerrm <> 'admin only' then raise exception 'FAIL: expected admin only, got %', sqlerrm; end if; end;
end $$;
set local role anon;
do $$ begin
  begin perform public.revert_change(1); raise exception 'FAIL: anon revert';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- v) severe intervals (Phase 3, D-09/D-10)
insert into public.dealer_plan_items (car_model_id, service, interval_km, interval_months, severe_km, severe_months, note)
values ('test:gate', 'Severe Item', 10000, 12, 5000, 6, '');
do $$ declare ev constant jsonb := '[{"url":"https://a.example/x","tier":"official","quote":"q"}]'; r jsonb; pid bigint; begin
  -- severe-only change is queued, not a noop
  r := public.submit_proposal('schedule_item', 'test:gate', 'Severe Item',
    '{"interval_km":10000,"interval_months":12,"severe_km":4000,"severe_months":6,"note":"","parts":[]}'::jsonb, ev);
  if r->>'action' <> 'inserted' then raise exception 'FAIL: v) severe-only change: %', r; end if;
  -- same values with severe absent: nothing changes, so noop
  r := public.submit_proposal('schedule_item', 'test:gate', 'Severe Item',
    '{"interval_km":10000,"interval_months":12,"note":"","parts":[]}'::jsonb, ev);
  if r->>'action' <> 'noop' then raise exception 'FAIL: v) severe-absent equal expected noop: %', r; end if;
  -- severe-absent change supersedes the pending one and must keep live severe
  r := public.submit_proposal('schedule_item', 'test:gate', 'Severe Item',
    '{"interval_km":12000,"interval_months":12,"note":"","parts":[]}'::jsonb, ev);
  pid := (r->>'id')::bigint;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
do $$ declare pid bigint; r jsonb; begin
  select id into pid from public.proposals where car_model_id = 'test:gate' and target_key = 'Severe Item' and status = 'pending';
  r := public.apply_proposal(pid);
  if (r->>'ok') is distinct from 'true' then raise exception 'FAIL: v) apply: %', r; end if;
  if not exists (select 1 from public.dealer_plan_items where car_model_id = 'test:gate' and service = 'Severe Item'
                 and interval_km = 12000 and severe_km = 5000 and severe_months = 6) then
    raise exception 'FAIL: v) severe changed or interval not applied'; end if;
  -- revert restores severe too
  r := public.revert_change((r->>'change_id')::bigint);
  if not exists (select 1 from public.dealer_plan_items where car_model_id = 'test:gate' and service = 'Severe Item'
                 and interval_km = 10000 and severe_km = 5000 and severe_months = 6) then
    raise exception 'FAIL: v) revert severe'; end if;
end $$;
reset role;

-- w) recall kind: submit, duplicate, apply (upsert approved), revert (delete)
do $$ declare ev constant jsonb := '[{"url":"https://a.example/x","tier":"official","quote":"q"}]';
  aft constant jsonb := '{"component":"AIR BAGS","summary":"Inflator may rupture","remedy":"Replace inflator","years":[2019,2020]}'; r1 jsonb; r2 jsonb; begin
  r1 := public.submit_proposal('recall', 'test:gate', 'TESTCAMP1', aft, ev);
  if r1->>'action' <> 'inserted' then raise exception 'FAIL: w) recall submit: %', r1; end if;
  r2 := public.submit_proposal('recall', 'test:gate', 'TESTCAMP1', aft, ev);
  if r2->>'action' <> 'duplicate' then raise exception 'FAIL: w) recall duplicate: %', r2; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
do $$ declare pid bigint; r jsonb; begin
  select id into pid from public.proposals where kind = 'recall' and target_key = 'TESTCAMP1' and status = 'pending';
  r := public.apply_proposal(pid);
  if (r->>'ok') is distinct from 'true' then raise exception 'FAIL: w) recall apply: %', r; end if;
  if not exists (select 1 from public.recalls where campaign = 'TESTCAMP1' and car_model_id = 'test:gate'
                 and status = 'approved' and years = '{2019,2020}'::int[]) then
    raise exception 'FAIL: w) recall row not upserted as approved'; end if;
  if (select table_name from public.change_log where id = (r->>'change_id')::bigint) <> 'recalls' then
    raise exception 'FAIL: w) change_log table_name'; end if;
  r := public.revert_change((r->>'change_id')::bigint);
  if (r->>'ok') is distinct from 'true'
     or exists (select 1 from public.recalls where campaign = 'TESTCAMP1' and car_model_id = 'test:gate') then
    raise exception 'FAIL: w) recall revert: %', r; end if;
end $$;
reset role;

-- x) Phase 4 kinds: part, failure, car_model (D-03, D-07, D-13, D-16, D-17)
insert into public.catalogue_parts (car_model_id, part_name, slot, brand, part_no, price, price_basis) values
  ('test:gate', 'Oil Filter', 'oem', 'Mazda', 'P1', 100, 'dealer'),
  ('test:gate', 'Revert Part', 'oem', 'Mazda', 'R1', 100, 'dealer');
update public.car_models set parts_updated_at = '2000-01-01' where id = 'test:gate';

-- x1) submit: materiality, slots, users evidence, validation
do $$ declare ev constant jsonb := '[{"url":"https://a.example/x","tier":"official","quote":"q"}]'; r jsonb;
  users_ev constant jsonb := '[{"type":"users","tier":"community","users":3,"median":40}]';
begin
  -- immaterial: under 5 SAR (103, 104) or under 10% (106) versus the live 100.00, same basis
  r := public.submit_proposal('part', 'test:gate', 'Oil Filter|oem', '{"brand":"Mazda","part_no":"P1","price":103,"price_basis":"dealer"}'::jsonb, ev);
  if r->>'action' <> 'immaterial' then raise exception 'FAIL: x) 3 SAR move not immaterial: %', r; end if;
  r := public.submit_proposal('part', 'test:gate', 'Oil Filter|oem', '{"brand":"Mazda","part_no":"P1","price":104,"price_basis":"dealer"}'::jsonb, ev);
  if r->>'action' <> 'immaterial' then raise exception 'FAIL: x) 4 SAR move not immaterial: %', r; end if;
  r := public.submit_proposal('part', 'test:gate', 'Oil Filter|oem', '{"brand":"Mazda","part_no":"P1","price":106,"price_basis":"dealer"}'::jsonb, ev);
  if r->>'action' <> 'immaterial' then raise exception 'FAIL: x) 6 percent move not immaterial: %', r; end if;
  if exists (select 1 from public.proposals where kind = 'part' and target_key = 'Oil Filter|oem') then
    raise exception 'FAIL: x) immaterial move was queued'; end if;
  -- exactly 10% and 10 SAR is material
  r := public.submit_proposal('part', 'test:gate', 'Oil Filter|oem', '{"brand":"Mazda","part_no":"P1","price":110,"price_basis":"dealer"}'::jsonb, ev);
  if r->>'action' <> 'inserted' then raise exception 'FAIL: x) 10 percent move not queued: %', r; end if;
  -- a basis change and a part number change are always queued
  r := public.submit_proposal('part', 'test:gate', 'Oil Filter|oem', '{"brand":"Mazda","part_no":"P1","price":101,"price_basis":"indicative"}'::jsonb, ev);
  if r->>'action' <> 'inserted' then raise exception 'FAIL: x) basis change not queued: %', r; end if;
  r := public.submit_proposal('part', 'test:gate', 'Oil Filter|oem', '{"brand":"Mazda","part_no":"P2","price":101,"price_basis":"dealer"}'::jsonb, ev);
  if r->>'action' <> 'inserted' then raise exception 'FAIL: x) part_no change not queued: %', r; end if;
  -- equal to live is a noop
  r := public.submit_proposal('part', 'test:gate', 'Oil Filter|oem', '{"brand":"Mazda","part_no":"P1","price":100,"price_basis":"dealer"}'::jsonb, ev);
  if r->>'action' <> 'noop' then raise exception 'FAIL: x) equal part not noop: %', r; end if;

  -- a part proposal without a price is refused (CR-03)
  begin perform public.submit_proposal('part', 'test:gate', 'Oil Filter|oem', '{"brand":"Mazda","part_no":"P1","price":null,"price_basis":"indicative"}'::jsonb, ev);
    raise exception 'FAIL: x) part without a price accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
  -- ALT needs an existing part name for the car
  begin perform public.submit_proposal('part', 'test:gate', 'Nonexistent Part|alt:foo', '{"brand":"B","price":10,"price_basis":"indicative"}'::jsonb, ev);
    raise exception 'FAIL: x) alt for a missing part accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
  r := public.submit_proposal('part', 'test:gate', 'Oil Filter|alt:denso', '{"brand":"Denso","price":50,"price_basis":"indicative"}'::jsonb, ev);
  if r->>'action' <> 'inserted' then raise exception 'FAIL: x) alt submit: %', r; end if;

  -- users evidence (D-13): 3 users accepted, 2 refused, extra keys refused, not on car_model
  r := public.submit_proposal('part', 'test:gate', 'Oil Filter|alt:denso', '{"brand":"Denso","price":60,"price_basis":"indicative"}'::jsonb, users_ev);
  if r->>'action' <> 'inserted' then raise exception 'FAIL: x) users evidence part submit: %', r; end if;
  begin perform public.submit_proposal('part', 'test:gate', 'Oil Filter|alt:denso', '{"brand":"Denso","price":70,"price_basis":"indicative"}'::jsonb,
      '[{"type":"users","tier":"community","users":2,"median":40}]');
    raise exception 'FAIL: x) users evidence with 2 users accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin perform public.submit_proposal('part', 'test:gate', 'Oil Filter|alt:denso', '{"brand":"Denso","price":70,"price_basis":"indicative"}'::jsonb,
      '[{"type":"users","tier":"community","users":5,"median":40,"user_ids":["a"]}]');
    raise exception 'FAIL: x) users evidence carrying user ids accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin perform public.submit_proposal('car_model', null, 'zzu-2024:1.5l', '{"make":"Mazda","model":"ZZU","generation":"","engine":"1.5L"}'::jsonb, users_ev);
    raise exception 'FAIL: x) users evidence on car_model accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;

  -- failure needs 3 or more mentions
  begin perform public.submit_proposal('failure', 'test:gate', 'few-mentions', '{"title":"T","summary":"S","mentions":2}'::jsonb, ev);
    raise exception 'FAIL: x) failure with 2 mentions accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;

  -- car_model: no car needed; markets and years validated
  begin perform public.submit_proposal('car_model', null, 'zzbad-2024:1.5l', '{"make":"Mazda","model":"ZZ","generation":"","engine":"1.5L","markets":["XX"]}'::jsonb, ev);
    raise exception 'FAIL: x) markets outside the whitelist accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin perform public.submit_proposal('car_model', null, 'zzbad-2024:1.5l', '{"make":"Mazda","model":"ZZ","generation":"","engine":"1.5L","years":"abc"}'::jsonb, ev);
    raise exception 'FAIL: x) years not an array accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin perform public.submit_proposal('car_model', 'test:gate', 'zzbad-2024:1.5l', '{"make":"Mazda","model":"ZZ","generation":"","engine":"1.5L"}'::jsonb, ev);
    raise exception 'FAIL: x) car_model proposal with a car accepted';
  exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;

-- x2) queue the apply/revert/stale/bulk fixtures (as owner)
do $$ declare ev constant jsonb := '[{"url":"https://a.example/x","tier":"official","quote":"q"},{"type":"users","tier":"community","users":4,"median":210}]';
  cev constant jsonb := '[{"url":"https://a.example/x","tier":"official","quote":"q"}]';
begin
  perform set_config('t.pnew', (public.submit_proposal('part', 'test:gate', 'Brake Pad|oem',
    '{"brand":"Mazda","part_no":"BP1","price":200,"price_basis":"dealer"}'::jsonb, ev)->>'id'), true);
  perform set_config('t.prev', (public.submit_proposal('part', 'test:gate', 'Revert Part|oem',
    '{"brand":"Mazda","part_no":"R1","price":130,"price_basis":"dealer"}'::jsonb, ev)->>'id'), true);
  perform set_config('t.pwipe', (public.submit_proposal('part', 'test:gate', 'Wiper Set|oem',
    '{"brand":"Bosch","part_no":"W1","price":90,"price_basis":"dealer"}'::jsonb, ev)->>'id'), true);
  perform set_config('t.fail', (public.submit_proposal('failure', 'test:gate', 'sticky-lifters',
    '{"title":"Sticky lifters","summary":"Ticking at cold start","typical_km":90000,"mentions":5}'::jsonb, ev)->>'id'), true);
  perform set_config('t.car1', (public.submit_proposal('car_model', null, 'zzcar-2024:3.3l-turbo',
    '{"make":"Mazda","model":"ZZ Car","generation":"","engine":"3.3L Turbo","oil_capacity_l":6.1,"warranty_years":5,"warranty_km":100000,"markets":["KSA","UAE"],"years":[2024,2025]}'::jsonb, cev)->>'id'), true);
  perform set_config('t.car2', (public.submit_proposal('car_model', null, 'zzcar2-2025:2.5l',
    '{"make":"Mazda","model":"ZZ Car2","generation":"KL","engine":"2.5L","years":[2024,2025]}'::jsonb, cev)->>'id'), true);
  perform set_config('t.car3', (public.submit_proposal('car_model', null, 'zzcar3-2025:2.0l',
    '{"make":"Mazda","model":"ZZ Car3","generation":"","engine":"2.0L"}'::jsonb, cev)->>'id'), true);
  -- stale fixture: proposed against "no row"; the row appears afterwards
  perform set_config('t.pstale', (public.submit_proposal('part', 'test:gate', 'Stale Part|oem',
    '{"brand":"Mazda","part_no":"S1","price":300,"price_basis":"dealer"}'::jsonb, ev)->>'id'), true);
end $$;
insert into public.catalogue_parts (car_model_id, part_name, slot, brand, part_no, price, price_basis) values
  ('test:gate', 'Stale Part', 'oem', 'Mazda', 'S1', 200, 'dealer');

-- x3) admin applies and reverts
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
do $$ declare r jsonb; begin
  -- part insert: live row, change_log, parts_updated_at; not stale right after submit
  r := public.apply_proposal(current_setting('t.pnew')::bigint);
  if (r->>'ok') is distinct from 'true' then raise exception 'FAIL: x) part apply: %', r; end if;
  if (select price from public.catalogue_parts where car_model_id = 'test:gate' and part_name = 'Brake Pad' and slot = 'oem') <> 200 then
    raise exception 'FAIL: x) part row not written'; end if;
  if (select table_name from public.change_log where id = (r->>'change_id')::bigint) <> 'catalogue_parts' then
    raise exception 'FAIL: x) part change_log table'; end if;
  if (select parts_updated_at from public.car_models where id = 'test:gate') <= '2000-01-01' then
    raise exception 'FAIL: x) parts_updated_at not advanced'; end if;
  if (select jsonb_array_length(sources) from public.catalogue_parts where part_name = 'Brake Pad' and car_model_id = 'test:gate') <> 1 then
    raise exception 'FAIL: x) part sources should hold the url evidence only'; end if;

  -- stale refusal (D-03): the live row changed after the proposal was made
  r := public.apply_proposal(current_setting('t.pstale')::bigint);
  if r->>'error' is distinct from 'stale' then raise exception 'FAIL: x) expected stale, got %', r; end if;

  -- update + revert restores the previous row
  r := public.apply_proposal(current_setting('t.prev')::bigint);
  if (select price from public.catalogue_parts where car_model_id = 'test:gate' and part_name = 'Revert Part') <> 130 then
    raise exception 'FAIL: x) part update not applied'; end if;
  r := public.revert_change((r->>'change_id')::bigint);
  if (r->>'ok') is distinct from 'true'
     or (select price from public.catalogue_parts where car_model_id = 'test:gate' and part_name = 'Revert Part') <> 100 then
    raise exception 'FAIL: x) part revert: %', r; end if;
  -- insert + revert deletes the row
  r := public.apply_proposal(current_setting('t.pwipe')::bigint);
  r := public.revert_change((r->>'change_id')::bigint);
  if (r->>'ok') is distinct from 'true'
     or exists (select 1 from public.catalogue_parts where car_model_id = 'test:gate' and part_name = 'Wiper Set') then
    raise exception 'FAIL: x) part insert revert: %', r; end if;

  -- failure: row with url-only sources, then revert deletes it
  r := public.apply_proposal(current_setting('t.fail')::bigint);
  if (r->>'ok') is distinct from 'true' then raise exception 'FAIL: x) failure apply: %', r; end if;
  if not exists (select 1 from public.known_issues where car_model_id = 'test:gate' and issue_key = 'sticky-lifters'
                 and mentions = 5 and typical_km = 90000 and jsonb_array_length(sources) = 1 and sources->0->>'host' = 'a.example') then
    raise exception 'FAIL: x) known_issues row or sources wrong'; end if;
  r := public.revert_change((r->>'change_id')::bigint);
  if (r->>'ok') is distinct from 'true' or exists (select 1 from public.known_issues where issue_key = 'sticky-lifters') then
    raise exception 'FAIL: x) failure revert: %', r; end if;

  -- car_model with an edited id (D-17): identity + basics, years folded into generation, url sources
  r := public.apply_proposal(current_setting('t.car1')::bigint,
    '{"id":"zzcar-edited-2024:3.3l-turbo","make":"Mazda","model":"ZZ Car","generation":"","engine":"3.3L Turbo","oil_capacity_l":6.1,"warranty_years":5,"warranty_km":100000,"markets":["KSA","UAE"],"years":[2024,2025]}'::jsonb);
  if (r->>'ok') is distinct from 'true' then raise exception 'FAIL: x) car_model apply: %', r; end if;
  if not exists (select 1 from public.car_models where id = 'zzcar-edited-2024:3.3l-turbo' and status = 'approved'
                 and generation = '2024-2025' and markets = '{KSA,UAE}' and oil_capacity_l = 6.1
                 and sources->0->>'host' = 'a.example') then
    raise exception 'FAIL: x) car_models row wrong (generation 2024-2025, markets, sources)'; end if;
  if (select row_key from public.change_log where id = (r->>'change_id')::bigint) <> 'zzcar-edited-2024:3.3l-turbo' then
    raise exception 'FAIL: x) change_log row_key is not the edited id'; end if;
  -- revert with nothing attached deletes the car
  r := public.revert_change((r->>'change_id')::bigint);
  if (r->>'ok') is distinct from 'true' or exists (select 1 from public.car_models where id = 'zzcar-edited-2024:3.3l-turbo') then
    raise exception 'FAIL: x) car_model revert: %', r; end if;

  -- a generation without a year gets the range appended
  r := public.apply_proposal(current_setting('t.car2')::bigint);
  if (r->>'ok') is distinct from 'true' then raise exception 'FAIL: x) car2 apply: %', r; end if;
  if (select generation from public.car_models where id = 'zzcar2-2025:2.5l') <> 'KL (2024-2025)' then
    raise exception 'FAIL: x) generation fold, got %', (select generation from public.car_models where id = 'zzcar2-2025:2.5l'); end if;
  perform set_config('t.car2change', r->>'change_id', true);
end $$;
reset role;

-- in_use: an attached plan item blocks the car_model revert
insert into public.dealer_plan_items (car_model_id, service, interval_km, interval_months, note)
values ('zzcar2-2025:2.5l', 'Engine Oil', 10000, 12, '');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
do $$ declare r jsonb; begin
  r := public.revert_change(current_setting('t.car2change')::bigint);
  if r->>'error' is distinct from 'in_use' then raise exception 'FAIL: x) expected in_use, got %', r; end if;
  if not exists (select 1 from public.car_models where id = 'zzcar2-2025:2.5l') then
    raise exception 'FAIL: x) in_use refusal deleted the car'; end if;
end $$;
reset role;

-- not_bulk: a high-tier car_model is refused, a high-tier part in the same call still applies
do $$ begin
  perform set_config('t.bulkpart', (public.submit_proposal('part', 'test:gate', 'Bulk Part|oem',
    '{"brand":"Mazda","part_no":"B1","price":80,"price_basis":"dealer"}'::jsonb,
    '[{"url":"https://a.example/x","tier":"official","quote":"q"}]')->>'id'), true);
end $$;
update public.proposals set confidence_tier = 'high' where id in (current_setting('t.car3')::bigint, current_setting('t.bulkpart')::bigint);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}', true);
do $$ declare r jsonb; x jsonb; begin
  r := public.apply_proposals(array[current_setting('t.car3')::bigint, current_setting('t.bulkpart')::bigint], 'high');
  for x in select value from jsonb_array_elements(r) loop
    if (x->>'id')::bigint = current_setting('t.car3')::bigint and x->>'error' is distinct from 'not_bulk' then
      raise exception 'FAIL: x) car_model in bulk not refused with not_bulk: %', x; end if;
    if (x->>'id')::bigint = current_setting('t.bulkpart')::bigint and (x->>'ok') is distinct from 'true' then
      raise exception 'FAIL: x) part in bulk not applied: %', x; end if;
  end loop;
  if exists (select 1 from public.car_models where id = 'zzcar3-2025:2.0l') then
    raise exception 'FAIL: x) not_bulk car was created'; end if;
end $$;
reset role;

-- x4) anon reads the approved parts and cannot write them
set local role anon;
do $$ begin
  if (select price from public.catalogue_parts where car_model_id = 'test:gate' and part_name = 'Brake Pad' and slot = 'oem') is distinct from 200 then
    raise exception 'FAIL: x) anon does not see the approved part'; end if;
  begin update public.catalogue_parts set price = 1; raise exception 'FAIL: x) anon updates catalogue_parts';
  exception when insufficient_privilege then null; end;
  begin delete from public.known_issues; raise exception 'FAIL: x) anon deletes known_issues';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
