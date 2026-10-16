-- Manual check for shops and trust. Run in the Supabase SQL editor (or psql)
-- after schema.sql. Needs no real accounts: it creates 6 throwaway users in
-- auth.users. Every block raises 'FAIL: ...' on a broken rule; finishing
-- silently means pass. Ends in ROLLBACK, so nothing it does persists.
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'), ('00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0000-000000000005'), ('00000000-0000-0000-0000-000000000006');

create or replace function public.tmp_as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', format('00000000-0000-0000-0000-%s', lpad(n::text, 12, '0')), true),
         set_config('request.jwt.claim.role', 'authenticated', true) $$;

-- (a) authenticated can insert/select shops, cannot update/delete
select public.tmp_as_user(1);
set local role authenticated;
do $$ declare n int; begin
  insert into public.shops (id, name, name_norm, city) values
    ('aaaaaaaa-0000-0000-0000-000000000001', 'Al Amal Parts', 'al amal parts', 'Riyadh');
  if (select count(*) from public.shops) <> 1 then raise exception 'FAIL: cannot select shops'; end if;
  begin
    update public.shops set name = 'x1' where true;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL: authenticated updated a shop'; end if;
  exception when insufficient_privilege then null; end;
  begin
    delete from public.shops;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL: authenticated deleted a shop'; end if;
  exception when insufficient_privilege then null; end;
end $$;

-- (b) duplicate (name_norm, lower(city)) fails 23505
do $$ begin
  begin
    insert into public.shops (name, name_norm, city) values ('AL AMAL', 'al amal parts', 'RIYADH');
    raise exception 'FAIL: duplicate shop accepted';
  exception when unique_violation then null; end;
end $$;

-- (c) same name in another city succeeds
do $$ begin
  insert into public.shops (id, name, name_norm, city) values
    ('aaaaaaaa-0000-0000-0000-000000000002', 'Al Amal Parts', 'al amal parts', 'Jeddah');
end $$;

-- (d) feedback is own-rows-only, second vote upserts, bogus reason fails
do $$ begin
  insert into public.shop_feedback (shop_id, vote, reasons)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 1, '{price}');
  insert into public.shop_feedback (shop_id, vote, reasons)
    values ('aaaaaaaa-0000-0000-0000-000000000001', -1, '{}')
    on conflict (shop_id, user_id) do update set vote = excluded.vote, reasons = excluded.reasons;
  if (select count(*) from public.shop_feedback) <> 1 then raise exception 'FAIL: second vote did not upsert to one row'; end if;
  if (select vote from public.shop_feedback) <> -1 then raise exception 'FAIL: upsert did not change vote'; end if;
  begin
    insert into public.shop_feedback (shop_id, vote, reasons)
      values ('aaaaaaaa-0000-0000-0000-000000000002', 1, '{bogus}');
    raise exception 'FAIL: bogus reason accepted';
  exception when check_violation then null; end;
end $$;
reset role;
select public.tmp_as_user(2);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.shop_feedback) then raise exception 'FAIL: user 2 can see user 1 feedback'; end if;
end $$;
reset role;

-- (d2) bill_backed is not client-writable; normal vote and vote change still work
select public.tmp_as_user(3);
set local role authenticated;
do $$ begin
  begin
    insert into public.shop_feedback (shop_id, vote, bill_backed)
      values ('aaaaaaaa-0000-0000-0000-000000000001', 1, true);
    raise exception 'FAIL: client inserted bill_backed';
  exception when insufficient_privilege then null; end;
  insert into public.shop_feedback (shop_id, vote, reasons)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 1, '{honest}')
    on conflict (shop_id, user_id) do update set vote = excluded.vote, reasons = excluded.reasons;
  insert into public.shop_feedback (shop_id, vote, reasons)
    values ('aaaaaaaa-0000-0000-0000-000000000001', -1, '{}')
    on conflict (shop_id, user_id) do update set vote = excluded.vote, reasons = excluded.reasons;
  if (select vote from public.shop_feedback) <> -1 then raise exception 'FAIL: vote change did not apply'; end if;
  begin
    update public.shop_feedback set bill_backed = true;
    raise exception 'FAIL: client updated bill_backed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from public.shop_feedback where user_id = '00000000-0000-0000-0000-000000000003';

-- (e) shop_trust: nothing at 4 voters, a row at 5, bill-backed down-vote weighs 2
-- Users 1..4 vote on shop 2 (user 1 already voted on shop 1 only).
insert into public.shop_feedback (shop_id, user_id, vote, reasons, bill_backed)
select 'aaaaaaaa-0000-0000-0000-000000000002', ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
       1, '{price,fast}', false from generate_series(1, 4) g;
do $$ begin
  if exists (select 1 from public.shop_trust) then raise exception 'FAIL: shop_trust shows a shop with 4 voters'; end if;
end $$;
insert into public.shop_feedback (shop_id, user_id, vote, reasons, bill_backed)
  values ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000005', -1, '{}', false);
do $$ declare r record; begin
  select * into r from public.shop_trust;
  if r.voters <> 5 or r.up <> 4 or r.down <> 1 then raise exception 'FAIL: shop_trust counts % % %', r.voters, r.up, r.down; end if;
  if r.score_share <> 0.800 then raise exception 'FAIL: score_share % <> 0.800', r.score_share; end if;
  if not (r.top_reasons @> '{price,fast}') then raise exception 'FAIL: top_reasons %', r.top_reasons; end if;
end $$;
update public.shop_feedback set bill_backed = true
  where user_id = '00000000-0000-0000-0000-000000000005';
do $$ declare s numeric; begin
  select score_share into s from public.shop_trust;  -- 4 / (4 + 2)
  if s <> 0.667 then raise exception 'FAIL: bill-backed down-vote weight, score_share %', s; end if;
end $$;

-- (f) store_prices: empty at 4 contributors, one row at 5, null shop_id excluded
do $$ declare g int; begin
  for g in 1..4 loop
    perform set_config('request.jwt.claim.sub', format('00000000-0000-0000-0000-%s', lpad(g::text, 12, '0')), true);
    perform public.submit_contributions(jsonb_build_array(
      jsonb_build_object('kind','part','source_key','sp-'||g,'month','2026-01','model_id','m3','odometer_band',50000,
        'item_key','oil','price',100+g,'shop_id','aaaaaaaa-0000-0000-0000-000000000002')));
  end loop;
end $$;
do $$ begin
  if exists (select 1 from public.store_prices) then raise exception 'FAIL: store_prices shows 4 contributors'; end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
  perform public.submit_contributions(jsonb_build_array(
    jsonb_build_object('kind','part','source_key','sp-5','month','2026-01','model_id','m3','odometer_band',50000,
      'item_key','oil','price',105,'shop_id','aaaaaaaa-0000-0000-0000-000000000002')));
  if (select count(*) from public.store_prices) <> 1 then raise exception 'FAIL: store_prices should have 1 row at 5'; end if;
  if (select median_price from public.store_prices) <> 103 then raise exception 'FAIL: median_price'; end if;
  -- a 6th contributor with no shop_id must not add a row or count
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
  perform public.submit_contributions(jsonb_build_array(
    jsonb_build_object('kind','part','source_key','sp-6','month','2026-01','model_id','m3','odometer_band',50000,
      'item_key','oil','price',999)));
  if (select count(*) from public.store_prices) <> 1 or (select n from public.store_prices) <> 5 then
    raise exception 'FAIL: row without shop_id leaked into store_prices'; end if;
  -- a non-existent shop skips only that row
  if public.submit_contributions(jsonb_build_array(
    jsonb_build_object('kind','part','source_key','sp-7','month','2026-01','model_id','m3','odometer_band',50000,'item_key','oil','price',1,
      'shop_id','bbbbbbbb-0000-0000-0000-000000000000'))) <> 0 then
    raise exception 'FAIL: unknown shop_id row was not skipped'; end if;
end $$;

-- (g) delete_my_contributions() removes the caller's feedback
select public.tmp_as_user(5);
set local role authenticated;
do $$ begin
  perform public.delete_my_contributions();
  if exists (select 1 from public.shop_feedback) then raise exception 'FAIL: feedback survived delete_my_contributions'; end if;
end $$;

-- (h) anon cannot read either view
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.shop_trust; raise exception 'FAIL: anon read shop_trust';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.store_prices; raise exception 'FAIL: anon read store_prices';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
