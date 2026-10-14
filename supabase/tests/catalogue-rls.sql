-- Manual RLS check for Phase 5a. Run in the Supabase SQL editor after
-- schema.sql and seed-catalogue.sql. Replace NON_ADMIN_UUID and ADMIN_UUID
-- with two real accounts (the admin one already promoted). Every block
-- raises 'FAIL: ...' on a broken rule; finishing silently means pass.
-- Ends in ROLLBACK, so nothing it does persists.
begin;

insert into public.car_models (id, model, generation, engine, status)
values ('rls-test:draft', 'TEST', 'TEST', 'TEST', 'draft');

-- Non-admin
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"NON_ADMIN_UUID","role":"authenticated"}', true);

do $$ begin
  update public.dealer_plan_items set interval_km = 1 where id = (select min(id) from public.dealer_plan_items);
  if found then raise exception 'FAIL: non-admin updated a dealer plan item'; end if;
end $$;

do $$ begin
  begin
    insert into public.car_models (id, model, generation, engine) values ('rls-test:x', 'x', 'x', 'x');
    raise exception 'FAIL: non-admin inserted a car model';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$ begin
  begin
    update public.profiles set role = 'admin' where user_id = auth.uid();
    raise exception 'FAIL: non-admin changed their own role';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$ begin
  if exists (select 1 from public.car_models where id = 'rls-test:draft') then
    raise exception 'FAIL: non-admin can see a draft car'; end if;
  if exists (select 1 from public.dealer_plan_changes) then
    raise exception 'FAIL: non-admin can read the change log'; end if;
end $$;

-- Admin
select set_config('request.jwt.claims', '{"sub":"ADMIN_UUID","role":"authenticated"}', true);

do $$ declare n int; begin
  update public.dealer_plan_items set interval_km = interval_km where id = (select min(id) from public.dealer_plan_items);
  if not found then raise exception 'FAIL: admin could not update a dealer plan item'; end if;
  select count(*) into n from public.dealer_plan_changes;
  if n = 0 then raise exception 'FAIL: admin edit was not logged'; end if;
end $$;

rollback;
