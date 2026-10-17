-- Guidance engine: sources, recalls, drafts, decide_plan_draft. Run after schema.sql:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/guidance.sql
-- Raises 'FAIL: ...' on a broken rule; finishing silently means pass. Ends in ROLLBACK.
begin;

insert into auth.users (id, created_at, email_confirmed_at)
select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, now() - interval '30 days', now()
  from generate_series(1, 2) g;
update public.profiles set role = 'admin' where user_id = '00000000-0000-0000-0000-000000000001';

create function public.tmp_as(n int) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0')), true) $$;

insert into public.car_models (id, model, generation, engine, status) values ('t1', '3', 'BM · 2014–18', '2.0', 'approved');
insert into public.dealer_plan_items (car_model_id, service, interval_km, interval_months, note)
  values ('t1', 'Engine Oil', 10000, 12, 'old');
insert into public.schedule_sources (id, car_model_id, url) overriding system value values (1, 't1', 'https://example.com/m.pdf');
insert into public.plan_drafts (car_model_id, source_id, service, proposed) values
  ('t1', 1, 'Engine Oil', '{"interval_km":15000,"interval_months":12,"note":"new","parts":[]}'),
  ('t1', 1, 'Cabin Filter', '{"interval_km":99999999,"interval_months":9999,"note":"x","parts":[{"name":"F","part_no":"1","qty":1}]}');
insert into public.recalls (campaign, car_model_id, component, summary, status) values
  ('A', 't1', 'c', 's', 'approved'), ('B', 't1', 'c', 's', 'pending');

-- (d) second pending draft for the same car+service is refused
do $$ begin
  begin
    insert into public.plan_drafts (car_model_id, service, proposed) values ('t1', 'Engine Oil', '{}');
    raise exception 'FAIL: duplicate pending draft allowed';
  exception when unique_violation then null; end;
end $$;

-- (a) non-admin cannot decide; (e) cannot read drafts
do $$ declare n int; begin
  perform public.tmp_as(2);
  set local role authenticated;
  begin
    perform public.decide_plan_draft((select min(id) from public.plan_drafts), true);
    raise exception 'FAIL: non-admin decided a draft';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  select count(*) into n from public.plan_drafts;
  if n <> 0 then raise exception 'FAIL: non-admin sees % drafts', n; end if;
  -- (f) non-admin sees approved recalls only
  select count(*) into n from public.recalls;
  if n <> 1 then raise exception 'FAIL: non-admin sees % recalls, want 1', n; end if;
  reset role;
end $$;

-- (b) admin approve: existing service updated + logged, new service inserted; (c) clamped
do $$ declare c0 int; c1 int; r record; begin
  perform public.tmp_as(1);
  set local role authenticated;
  select count(*) into c0 from public.dealer_plan_changes;
  perform public.decide_plan_draft((select id from public.plan_drafts where service = 'Engine Oil'), true);
  perform public.decide_plan_draft((select id from public.plan_drafts where service = 'Cabin Filter'), true);
  reset role;
  select * into r from public.dealer_plan_items where car_model_id = 't1' and service = 'Engine Oil';
  if r.interval_km <> 15000 or r.note <> 'new' then raise exception 'FAIL: update not applied'; end if;
  select count(*) into c1 from public.dealer_plan_changes;
  if c1 - c0 <> 1 then raise exception 'FAIL: expected 1 logged change, got %', c1 - c0; end if;
  select * into r from public.dealer_plan_items where car_model_id = 't1' and service = 'Cabin Filter';
  if not found then raise exception 'FAIL: new service not inserted'; end if;
  if r.interval_km <> 1000000 or r.interval_months <> 240 then raise exception 'FAIL: not clamped (% / %)', r.interval_km, r.interval_months; end if;
  if (select status from public.plan_drafts where service = 'Cabin Filter') <> 'approved' then raise exception 'FAIL: draft not marked approved'; end if;
end $$;

-- (g) reject leaves items unchanged
do $$ declare id1 bigint; before_km int; begin
  insert into public.plan_drafts (car_model_id, service, proposed) values ('t1', 'Engine Oil', '{"interval_km":1,"interval_months":1,"note":"z","parts":[]}') returning id into id1;
  select interval_km into before_km from public.dealer_plan_items where car_model_id = 't1' and service = 'Engine Oil';
  perform public.tmp_as(1);
  set local role authenticated;
  perform public.decide_plan_draft(id1, false);
  reset role;
  if (select interval_km from public.dealer_plan_items where car_model_id = 't1' and service = 'Engine Oil') <> before_km then raise exception 'FAIL: reject changed the item'; end if;
  if (select status from public.plan_drafts where id = id1) <> 'rejected' then raise exception 'FAIL: not rejected'; end if;
end $$;

-- deciding an already-decided draft fails
do $$ begin
  perform public.tmp_as(1);
  set local role authenticated;
  begin
    perform public.decide_plan_draft((select min(id) from public.plan_drafts where status = 'approved'), true);
    raise exception 'FAIL: re-decided a decided draft';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  reset role;
end $$;

rollback;
