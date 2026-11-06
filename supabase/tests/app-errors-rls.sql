-- RLS check for public.app_errors (FND-02, D-02/D-03/D-07). Run after schema.sql:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/app-errors-rls.sql
-- Raises 'FAIL: ...' on a broken rule; finishing silently means pass. Ends in ROLLBACK.
begin;

insert into auth.users (id, created_at, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000e1', now(), now()),
  ('00000000-0000-0000-0000-0000000000e2', now(), now());
-- handle_new_user() already created plain profiles; promote e2.
insert into public.profiles (user_id, role) values ('00000000-0000-0000-0000-0000000000e2', 'admin')
  on conflict (user_id) do update set role = 'admin';

-- fixture row written as table owner
insert into public.app_errors (source, message) values ('client', 'fixture error 42');

-- 1, 4, 5, 6: anon insert-only, with allowlisted columns and checked lengths
set local role anon;
do $$ begin
  insert into public.app_errors (source, message) values ('client', 'anon insert ok');

  begin insert into public.app_errors (source, message) values ('client', repeat('x', 501));
    raise exception 'FAIL: 501-char message accepted';
  exception when check_violation then null; end;

  begin insert into public.app_errors (source, message, user_id) values ('client', 'm', gen_random_uuid());
    raise exception 'FAIL: anon set user_id';
  exception when insufficient_privilege then null; end;

  begin insert into public.app_errors (source, message, group_key) values ('client', 'm', 'forged');
    raise exception 'FAIL: anon set group_key';
  exception when insufficient_privilege then null; end;

  -- source is forced to 'client' for client roles (no spoofing, no cap bypass)
  insert into public.app_errors (source, message) values ('server', 'spoof attempt');

  -- 2, 3: no read, update or delete
  begin perform 1 from public.app_errors; raise exception 'FAIL: anon can select app_errors';
  exception when insufficient_privilege then null; end;
  begin update public.app_errors set resolved_at = now(); raise exception 'FAIL: anon can update app_errors';
  exception when insufficient_privilege then null; end;
  begin delete from public.app_errors; raise exception 'FAIL: anon can delete app_errors';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 7, 9: signed-in non-admin sees and resolves nothing
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.app_errors;
  if n <> 0 then raise exception 'FAIL: non-admin sees % app_errors rows', n; end if;
  update public.app_errors set resolved_at = now() where group_key is not null;
  if found then raise exception 'FAIL: non-admin resolved app_errors rows'; end if;
end $$;
reset role;

-- spoofed source was rewritten (checked as owner, no RLS)
do $$ begin
  if exists (select 1 from public.app_errors where message = 'spoof attempt' and source <> 'client') then
    raise exception 'FAIL: client-sent source was stored';
  end if;
  if not exists (select 1 from public.app_errors where message = 'spoof attempt') then
    raise exception 'FAIL: spoof row missing';
  end if;
end $$;

-- 8: admin reads and resolves
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
do $$ declare n int; g text; begin
  select count(*) into n from public.app_errors;
  if n < 1 then raise exception 'FAIL: admin cannot read app_errors'; end if;
  select group_key into g from public.app_errors limit 1;
  update public.app_errors set resolved_at = now() where group_key = g;
  if not found then raise exception 'FAIL: admin could not resolve app_errors'; end if;
end $$;
reset role;

-- 10: hard global ceiling (2000 client rows/h) rejects every client role
insert into public.app_errors (source, message) select 'client', 'flood ' || g from generate_series(1, 2000) g;
set local role anon;
do $$ begin
  begin insert into public.app_errors (source, message) values ('client', 'over the ceiling');
    raise exception 'FAIL: anon insert accepted past the global ceiling';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
do $$ begin
  begin insert into public.app_errors (source, message) values ('client', 'over the ceiling');
    raise exception 'FAIL: signed-in insert accepted past the global ceiling';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;
reset role;

rollback;
