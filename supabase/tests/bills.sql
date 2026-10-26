-- Manual check for bill_reads + vote_shop. Run after schema.sql:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/bills.sql
-- Raises 'FAIL: ...' on a broken rule; finishing silently means pass. Ends in ROLLBACK.
begin;

insert into auth.users (id, created_at, email_confirmed_at)
select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, now() - interval '30 days', now() - interval '30 days'
  from generate_series(1, 3) g;

create or replace function public.tmp_as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', format('00000000-0000-0000-0000-%s', lpad(n::text, 12, '0')), true),
         set_config('request.jwt.claim.role', 'authenticated', true) $$;

insert into public.shops (id, name, name_norm, city) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Al Salam Auto', 'al salam auto', 'Riyadh'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Toyota Service', 'toyota service', 'Riyadh');
-- name_key is generated: replace(name_norm,' ','') -> 'alsalamauto' / 'toyotaservice'

-- reads: r1 ok (user1), r2 owned by user2, r3 8 days old, r4 null store_key, r5 ok for dissimilar test, r6 ok for downgrade test
insert into public.bill_reads (id, user_id, store_key, city, fingerprint, created_at) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'alsalamauto', 'Riyadh', 'f1', now()),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'alsalamauto', 'Riyadh', 'f2', now()),
  ('bbbbbbbb-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'alsalamauto', 'Riyadh', 'f3', now() - interval '8 days'),
  ('bbbbbbbb-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', null, null, null, now()),
  ('bbbbbbbb-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'alsalamauto', 'Riyadh', 'f5', now());

-- (i) fingerprint uniqueness (as table owner = service role stand-in)
do $$ begin
  begin
    insert into public.bill_reads (user_id, store_key, fingerprint) values ('00000000-0000-0000-0000-000000000003', 'x', 'f1');
    raise exception 'FAIL: duplicate fingerprint accepted';
  exception when unique_violation then null; end;
  insert into public.bill_reads (user_id) values ('00000000-0000-0000-0000-000000000003');
  insert into public.bill_reads (user_id) values ('00000000-0000-0000-0000-000000000003');
end $$;

-- (a) clients cannot touch bill_reads; (h) anon cannot execute vote_shop
select public.tmp_as_user(1);
set local role authenticated;
do $$ begin
  begin perform 1 from public.bill_reads; raise exception 'FAIL: authenticated can select bill_reads';
  exception when insufficient_privilege then null; end;
  begin insert into public.bill_reads (user_id) values (auth.uid()); raise exception 'FAIL: authenticated can insert bill_reads';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.bill_reads; raise exception 'FAIL: anon can select bill_reads';
  exception when insufficient_privilege then null; end;
  begin insert into public.bill_reads (user_id) values ('00000000-0000-0000-0000-000000000001'); raise exception 'FAIL: anon can insert bill_reads';
  exception when insufficient_privilege then null; end;
  begin perform public.vote_shop('aaaaaaaa-0000-0000-0000-000000000001', 1::smallint, '{}');
    raise exception 'FAIL: anon executed vote_shop';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- (b) valid read: backed, used_at set
select public.tmp_as_user(1);
set local role authenticated;
do $$ begin
  if public.vote_shop('aaaaaaaa-0000-0000-0000-000000000001', 1::smallint, '{price}', 'bbbbbbbb-0000-0000-0000-000000000001') is not true then
    raise exception 'FAIL: valid bill read did not back the vote'; end if;
end $$;
reset role;
do $$ begin
  if not (select bill_backed from public.shop_feedback where shop_id = 'aaaaaaaa-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: bill_backed not stored'; end if;
  if (select used_at from public.bill_reads where id = 'bbbbbbbb-0000-0000-0000-000000000001') is null then
    raise exception 'FAIL: read not marked used'; end if;
end $$;

-- (c) reuse: returns false, existing bill_backed not downgraded, vote updated
select public.tmp_as_user(1);
set local role authenticated;
do $$ begin
  if public.vote_shop('aaaaaaaa-0000-0000-0000-000000000001', -1::smallint, '{fast}', 'bbbbbbbb-0000-0000-0000-000000000001') is not false then
    raise exception 'FAIL: reused read backed a vote'; end if;
end $$;
reset role;
do $$ begin
  if not (select bill_backed from public.shop_feedback where shop_id = 'aaaaaaaa-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: bill_backed downgraded'; end if;
  if (select vote from public.shop_feedback where shop_id = 'aaaaaaaa-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-000000000001') <> -1 then
    raise exception 'FAIL: vote not updated on reuse'; end if;
end $$;

-- (d) other user's read, expired read, null store_key, dissimilar shop: stored unbacked, read stays unused
select public.tmp_as_user(1);
set local role authenticated;
do $$ declare s2 constant uuid := 'aaaaaaaa-0000-0000-0000-000000000002'; begin
  if public.vote_shop(s2, 1::smallint, '{}', 'bbbbbbbb-0000-0000-0000-000000000002') then raise exception 'FAIL: foreign read backed'; end if;
  if public.vote_shop(s2, 1::smallint, '{}', 'bbbbbbbb-0000-0000-0000-000000000003') then raise exception 'FAIL: expired read backed'; end if;
  if public.vote_shop(s2, 1::smallint, '{}', 'bbbbbbbb-0000-0000-0000-000000000004') then raise exception 'FAIL: null store_key read backed'; end if;
  if public.vote_shop(s2, 1::smallint, '{}', 'bbbbbbbb-0000-0000-0000-000000000005') then raise exception 'FAIL: dissimilar shop backed'; end if;
end $$;
reset role;
do $$ begin
  if (select bill_backed from public.shop_feedback where shop_id = 'aaaaaaaa-0000-0000-0000-000000000002' and user_id = '00000000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: unbacked vote stored as backed'; end if;
  if (select count(*) from public.bill_reads where id in
        ('bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-000000000005')
        and used_at is not null) <> 0 then raise exception 'FAIL: a rejected read was consumed'; end if;
end $$;

-- (e) direct upsert cannot set bill_backed; (f) bogus reason fails
select public.tmp_as_user(3);
set local role authenticated;
do $$ begin
  begin
    insert into public.shop_feedback (shop_id, vote, reasons, bill_backed)
      values ('aaaaaaaa-0000-0000-0000-000000000001', 1, '{}', true)
      on conflict (shop_id, user_id) do update set vote = excluded.vote, bill_backed = excluded.bill_backed;
    raise exception 'FAIL: client upsert set bill_backed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.vote_shop('aaaaaaaa-0000-0000-0000-000000000001', 1::smallint, '{bogus}');
    raise exception 'FAIL: bogus reason accepted';
  exception when check_violation then null; end;
end $$;
reset role;

-- (g) opt-out erases where the caller shopped, keeps the rows (caps + dedupe), touches no one else
select public.tmp_as_user(1);
set local role authenticated;
select public.delete_my_contributions();
reset role;
do $$ begin
  if not exists (select 1 from public.bill_reads where user_id = '00000000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: opt-out deleted bill_reads (resets the daily cap)'; end if;
  if exists (select 1 from public.bill_reads where user_id = '00000000-0000-0000-0000-000000000001'
             and (store_key is not null or city is not null)) then
    raise exception 'FAIL: opt-out left store_key/city'; end if;
  if not exists (select 1 from public.insights_prefs where user_id = '00000000-0000-0000-0000-000000000001' and share = false) then
    raise exception 'FAIL: opt-out did not record share = false'; end if;
  if not exists (select 1 from public.bill_reads where user_id = '00000000-0000-0000-0000-000000000002' and store_key is not null) then
    raise exception 'FAIL: opt-out touched another user''s bill_reads'; end if;
end $$;

-- (h) a read finishing after the opt-out (read-bill's service-role update) cannot restore the shop
update public.bill_reads set store_key = 'late shop', city = 'riyadh'
  where user_id = '00000000-0000-0000-0000-000000000001';
do $$ begin
  if exists (select 1 from public.bill_reads where user_id = '00000000-0000-0000-0000-000000000001' and store_key is not null) then
    raise exception 'FAIL: late bill read restored store_key after opt-out'; end if;
end $$;

-- (i) uploads after a server-side opt-out are refused (-1, which the client keeps queued)
-- and write nothing; a vote is refused too
select public.tmp_as_user(1);
set local role authenticated;
do $$ begin
  if public.submit_contributions('[{"kind":"fuel","source_key":"fuel:v:1","month":"2026-01","model_id":"m","odometer_band":0,"l100":7}]'::jsonb) <> -1
     or public.sync_contributions('v', '[{"kind":"fuel","source_key":"fuel:v:1","month":"2026-01","model_id":"m","odometer_band":0,"l100":7}]'::jsonb) <> -1 then
    raise exception 'FAIL: upload not refused after opt-out'; end if;
  begin
    perform public.vote_shop('aaaaaaaa-0000-0000-0000-000000000001', 1::smallint, '{}');
    raise exception 'FAIL: vote accepted after opt-out';
  exception when raise_exception then
    if sqlerrm <> 'sharing is off' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.contribution_links where user_id = '00000000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: upload after opt-out wrote rows'; end if;
end $$;

rollback;
