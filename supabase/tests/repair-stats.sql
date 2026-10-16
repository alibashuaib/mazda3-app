-- repair_stats + replacement-only brand_life/store_prices + action validation. Run after schema.sql:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/repair-stats.sql
-- Raises 'FAIL: ...' on a broken rule; finishing silently means pass. Ends in ROLLBACK.
begin;

-- 1..5 and 8 qualified; 6 is 3 days old (unqualified).
insert into auth.users (id, created_at, email_confirmed_at)
select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
       case when g = 6 then now() - interval '3 days' else now() - interval '30 days' end, now()
  from generate_series(1, 8) g;

create function public.tmp_as(n int) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0')), true) $$;

-- one part row per call, as user n
create function public.tmp_part(n int, m text, sk text, act text, price numeric, finding text,
                                kmprev int, kmrep int, sid uuid default null) returns int language sql as $$
  select public.tmp_as(n);
  select public.submit_contributions(jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'kind','part','source_key',sk,'month','2026-01','model_id',m,'odometer_band',0,'item_key','pad','brand','b',
    'action',act,'price',price,'finding',finding,'km_since_prev',kmprev,'km_since_repair',kmrep,'shop_id',sid)))) $$;

-- (a) mixed actions, 5 qualified users -> one row with correct numbers
do $$ declare r record; begin
  perform public.tmp_part(1, 'm1', 'k', 'replaced', 100, null, 50000, 30000);
  perform public.tmp_part(1, 'm1', 'i', 'inspected', null, 'attention', null, null);
  perform public.tmp_part(2, 'm1', 'k', 'repaired', 40, null, null, null);
  perform public.tmp_part(3, 'm1', 'k', 'replaced', 200, null, 60000, null);
  perform public.tmp_part(4, 'm1', 'k', 'inspected', null, 'ok', null, null);
  if (select count(*) from public.repair_stats where model_id = 'm1') <> 0 then
    raise exception 'FAIL: repair_stats shown with only 4 users'; end if;
  perform public.tmp_part(5, 'm1', 'k', 'inspected', null, 'attention', null, null);
  select * into r from public.repair_stats where model_id = 'm1';
  if r.item_key is distinct from 'pad' or r.n_replaced <> 2 or r.n_repaired <> 1 or r.n_inspected <> 3
     or r.median_price_replaced <> 150 or r.median_price_repaired <> 40
     or r.median_km_after_repair <> 30000 or round(r.attention_share, 3) <> 0.667 then
    raise exception 'FAIL: repair_stats numbers wrong: %', r; end if;
  -- (a) 4 qualified + 1 unqualified -> hidden
  perform public.tmp_part(g, 'm2', 'k', 'repaired', 40, null, null, null) from generate_series(1, 4) g;
  perform public.tmp_part(6, 'm2', 'k', 'repaired', 40, null, null, null);
  if (select count(*) from public.repair_stats where model_id = 'm2') <> 0 then
    raise exception 'FAIL: unqualified user counted toward repair_stats floor'; end if;
  -- a part inspected 5 times, never repaired -> n_repaired = 0
  perform public.tmp_part(g, 'm5', 'k', 'inspected', null, 'ok', null, null) from generate_series(1, 5) g;
  select * into r from public.repair_stats where model_id = 'm5';
  if r.n_repaired <> 0 or r.n_inspected <> 5 or r.median_price_repaired is not null or r.attention_share <> 0 then
    raise exception 'FAIL: inspect-only stats wrong: %', r; end if;
  -- (f) no finding on any inspection -> attention_share null
  perform public.tmp_part(g, 'm6', 'k', 'inspected', null, null, null, null) from generate_series(1, 5) g;
  if (select attention_share from public.repair_stats where model_id = 'm6') is not null then
    raise exception 'FAIL: attention_share should be null without findings'; end if;
end $$;

-- (b) repaired / inspected rows leave brand_life and store_prices untouched
do $$ declare sid uuid; before_life record; before_price record; after_life record; after_price record; begin
  perform public.tmp_as(1);
  insert into public.shops (name, city) values ('Shop m3', 'Jeddah') returning id into sid;
  perform public.tmp_part(g, 'm3', 'k', 'replaced', 100, null, 40000, null, sid) from generate_series(1, 5) g;
  select * into before_life from public.brand_life where model_id = 'm3';
  select * into before_price from public.store_prices where model_id = 'm3';
  if before_life.n <> 5 or before_price.n <> 5 then raise exception 'FAIL: baseline views wrong'; end if;
  perform public.tmp_part(g, 'm3', 'r', 'repaired', 10, null, 1000, null, sid) from generate_series(1, 5) g;
  perform public.tmp_part(g, 'm3', 'i', 'inspected', 5, 'ok', 2000, null, sid) from generate_series(1, 5) g;
  select * into after_life from public.brand_life where model_id = 'm3';
  select * into after_price from public.store_prices where model_id = 'm3';
  if after_life is distinct from before_life then raise exception 'FAIL: brand_life changed by repair/inspect: %', after_life; end if;
  if after_price is distinct from before_price then raise exception 'FAIL: store_prices changed by repair/inspect: %', after_price; end if;
end $$;

-- (c) validation and (e) idempotent update
do $$ declare n int; begin
  -- finding on a replaced row violates the CHECK: that row skipped, batch survives
  perform public.tmp_as(1);
  n := public.submit_contributions(jsonb_build_array(
    jsonb_build_object('kind','part','source_key','bad1','month','2026-01','model_id','m7','odometer_band',0,
      'item_key','pad','action','replaced','finding','ok','price',1),
    jsonb_build_object('kind','part','source_key','bad2','month','2026-01','model_id','m7','odometer_band',0,
      'item_key','pad','action','destroyed','price',1),
    jsonb_build_object('kind','part','source_key','good','month','2026-01','model_id','m7','odometer_band',0,
      'item_key','pad','price',1),
    jsonb_build_object('kind','part','source_key','att','month','2026-01','model_id','m7','odometer_band',0,
      'item_key','pad','action','inspected','finding','attention')));
  if n <> 2 then raise exception 'FAIL: expected 2 accepted rows, got %', n; end if;
  if (select count(*) from public.contributions where model_id = 'm7') <> 2 then raise exception 'FAIL: bad rows stored'; end if;
  if (select action from public.contributions where model_id = 'm7' and finding is null) <> 'replaced' then
    raise exception 'FAIL: missing action not stored as replaced'; end if;
  if (select count(*) from public.contributions where model_id = 'm7' and action = 'inspected' and finding = 'attention' and price is null) <> 1 then
    raise exception 'FAIL: priceless attention inspection not stored'; end if;
  -- (e) same source_key, changed action
  perform public.submit_contributions(jsonb_build_array(
    jsonb_build_object('kind','part','source_key','good','month','2026-01','model_id','m7','odometer_band',0,
      'item_key','pad','action','repaired','price',1)));
  if (select count(*) from public.contributions where model_id = 'm7') <> 2
     or (select count(*) from public.contributions where model_id = 'm7' and action = 'repaired') <> 1 then
    raise exception 'FAIL: resubmit with new action not an in-place update'; end if;
end $$;

-- (d) grants and no user-identifying column
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'repair_stats'
             and column_name ~* '(user|email|phone|created|confirmed)') then
    raise exception 'FAIL: repair_stats exposes a user-identifying column'; end if;
end $$;
set local role authenticated;
do $$ begin perform 1 from public.repair_stats; end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.repair_stats; raise exception 'FAIL: anon can read repair_stats';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
