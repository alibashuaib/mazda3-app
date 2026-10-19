-- Anti-fake-account rule: only qualified users (auth.users.created_at <= now() - 7 days AND
-- email or phone confirmed) count in fuel_stats, brand_life, store_prices and shop_trust,
-- including the >= 5 distinct-user floor. Run after schema.sql:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/qualified-users.sql
-- Raises 'FAIL: ...' on a broken rule; finishing silently means pass. Ends in ROLLBACK.
begin;

-- 1..5 qualified (user 5 phone-only), 6 is 3 days old, 7 never confirmed.
insert into auth.users (id, created_at, email_confirmed_at, phone_confirmed_at)
select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
       case when g = 6 then now() - interval '3 days' else now() - interval '30 days' end,
       case when g in (5, 7) then null else now() end,
       case when g = 5 then now() else null end
  from generate_series(1, 7) g;

create function public.tmp_uid(n int) returns uuid language sql as
  $$ select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

-- One contribution of each kind plus one shop vote per listed user, all under `m`.
create function public.tmp_fill(m text, users int[]) returns void language plpgsql as $$
declare u int; sid uuid;
begin
  perform set_config('request.jwt.claim.sub', public.tmp_uid(users[1])::text, true);
  insert into public.shops (name, city) values ('Shop ' || m, 'Jeddah') returning id into sid;
  foreach u in array users loop
    perform set_config('request.jwt.claim.sub', public.tmp_uid(u)::text, true);
    perform public.submit_contributions(jsonb_build_array(
      jsonb_build_object('kind','fuel','source_key','f-'||m,'month','2026-01','model_id',m,'odometer_band',0,'engine','e','l100',8),
      jsonb_build_object('kind','part','source_key','p-'||m,'month','2026-01','model_id',m,'odometer_band',0,
        'item_key','oil','brand','b','price',100,'km_since_prev',5000,'prev_brand','b','prev_price',90,'shop_id',sid)));
    insert into public.shop_feedback (shop_id, vote, reasons) values (sid, 1, '{price}');
  end loop;
end $$;

-- number of aggregate views (of 4) that show a row for model m
create function public.tmp_rows(m text) returns int language sql as $$
  select (select count(*) from public.fuel_stats where model_id = m)::int
       + (select count(*) from public.brand_life where model_id = m)::int
       + (select count(*) from public.store_prices where model_id = m)::int
       + (select count(*) from public.shop_trust t join public.shops s on s.id = t.shop_id where s.name = 'Shop ' || m)::int $$;

do $$ begin
  perform public.tmp_fill('all5',  '{1,2,3,4,5}');       -- phone-only user 5 qualifies
  if public.tmp_rows('all5') <> 4 then raise exception 'FAIL: 5 qualified users should show in all 4 views, got %', public.tmp_rows('all5'); end if;

  perform public.tmp_fill('unconf', '{1,2,3,4,7}');      -- 7 never confirmed
  if public.tmp_rows('unconf') <> 0 then raise exception 'FAIL: unconfirmed user counted toward the floor'; end if;

  perform public.tmp_fill('young', '{1,2,3,4,6}');       -- 6 is 3 days old
  if public.tmp_rows('young') <> 0 then raise exception 'FAIL: 3-day-old user counted toward the floor'; end if;

  perform public.tmp_fill('six', '{1,2,3,4,5,7}');       -- unqualified extra is ignored, not counted
  if (select n from public.fuel_stats where model_id = 'six') <> 5 then raise exception 'FAIL: unqualified row aggregated'; end if;
  if (select voters from public.shop_trust t join public.shops s on s.id = t.shop_id where s.name = 'Shop six') <> 5 then raise exception 'FAIL: unqualified vote counted'; end if;

  -- user 6 ages past 7 days: the previously hidden group appears with no resubmission
  update auth.users set created_at = now() - interval '8 days', email_confirmed_at = now() where id = public.tmp_uid(6);
  if public.tmp_rows('young') <> 4 then raise exception 'FAIL: aged user did not start counting, got %', public.tmp_rows('young'); end if;
  -- user 7 confirms
  update auth.users set email_confirmed_at = now() where id = public.tmp_uid(7);
  if public.tmp_rows('unconf') <> 4 then raise exception 'FAIL: confirmed user did not start counting'; end if;
end $$;

-- No user id / email / age leaks through any view column; clients cannot read helper or auth.users.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name in ('fuel_stats','brand_life','store_prices','shop_trust')
              and (column_name ~* '(user|email|phone|created|confirmed)' )) then
    raise exception 'FAIL: an aggregate view exposes a user-identifying column';
  end if;
end $$;
set local role authenticated;
do $$ begin
  begin perform 1 from public.qualified_users; raise exception 'FAIL: authenticated can read qualified_users';
  exception when insufficient_privilege then null; end;
  begin perform 1 from auth.users; raise exception 'FAIL: authenticated can read auth.users';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
