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
  -- l) noop: equal to the live Engine Oil row
  r := public.submit_proposal('schedule_item', 'test:gate', 'Engine Oil', '{"interval_km":10000,"interval_months":12,"note":"old","parts":[]}'::jsonb, ev);
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

rollback;
