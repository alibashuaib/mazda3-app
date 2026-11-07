-- Garage — Phase 4a schema.
-- Apply by hand in the Supabase SQL editor. Idempotent: safe to re-run.
--
-- Vehicle ids are the app's own uid() values: seven base36 characters, not
-- UUIDs. The primary key is therefore composite and scoped by user, so two
-- users can hold the same id without colliding.

create table if not exists public.vehicles (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.garage (
  user_id    uuid        primary key default auth.uid() references auth.users on delete cascade,
  active_id  text,
  updated_at timestamptz not null default now()
);

-- Two query patterns now exist. pull() (sign-in, Phase 4a) filters on
-- deleted_at and orders by nothing else — this partial index covers it.
-- pullIncremental() (Phase 4b) filters on `updated_at > cursor` and
-- deliberately INCLUDES deleted rows (a tombstone must still be pulled), so
-- it cannot use a `where deleted_at is null` index — vehicles_user_updated_idx
-- below covers that pattern instead.
create index if not exists vehicles_user_live_idx
  on public.vehicles (user_id) where deleted_at is null;

create index if not exists vehicles_user_updated_idx
  on public.vehicles (user_id, updated_at);

-- updated_at must be server-authored, not whatever the client's own clock
-- reads. The client sends a value (the column is `not null`), but this
-- trigger overwrites it with the database's `now()` on every insert/update,
-- regardless of what was sent. Without it, pullIncremental()'s
-- `updated_at > cursor` comparison trusts each device's own clock: a fast
-- device's writes could be skipped by others once their cursor passes a
-- timestamp that never actually elapsed on the server, and a slow device's
-- writes could sit forever below every other device's cursor. Applies to
-- both tables `updated_at` is compared on.
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists vehicles_set_updated_at on public.vehicles;
create trigger vehicles_set_updated_at
  before insert or update on public.vehicles
  for each row execute function public.set_updated_at();

drop trigger if exists garage_set_updated_at on public.garage;
create trigger garage_set_updated_at
  before insert or update on public.garage
  for each row execute function public.set_updated_at();

alter table public.vehicles enable row level security;
alter table public.garage   enable row level security;

-- This is the mechanism that makes garages private. It is enforced by
-- Postgres, not by application code, and not by any check in account.js.
drop policy if exists own_vehicles on public.vehicles;
create policy own_vehicles on public.vehicles for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_garage on public.garage;
create policy own_garage on public.garage for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- PostgREST reaches these tables as the `authenticated` role. Supabase's
-- default privileges normally cover this, but stating it makes the file
-- self-contained: without a grant the tables apply cleanly and stay invisible
-- to the API, which presents as "RLS is blocking everything".
grant select, insert, update, delete on public.vehicles, public.garage to authenticated;

-- Phase 4b: photo storage. Same shape as own_vehicles/own_garage — the
-- boundary is the Storage policy, not application code checking whose
-- photo it is.
-- 10MB cap, receipt/car-photo mime types only. `do update set` rather than
-- `do nothing` on conflict: this file is documented as safe to re-run, and a
-- bucket already created (e.g. by an earlier version of this script, before
-- these limits existed) must still pick up the limits on a re-run — `do
-- nothing` would leave a pre-existing row's file_size_limit/allowed_mime_types
-- untouched forever.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('photos', 'photos', false, 10485760, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists own_photos on storage.objects;
create policy own_photos on storage.objects for all
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Crowdsourced price averages. Public/shared tables — unlike vehicles/garage
-- above, RLS here grants every authenticated user read access to everyone's
-- rows, because the whole point is seeing what other people paid. See
-- docs/superpowers/specs/2026-09-10-crowdsourced-price-averages-design.md.

create table if not exists public.price_items (
  id             uuid        primary key default gen_random_uuid(),
  label          text        not null,
  category       text        not null,
  source_part_no text,
  created_by     uuid        not null default auth.uid() references auth.users,
  created_at     timestamptz not null default now()
);

-- Case-insensitive uniqueness on the label. price_items is meant to be a
-- single canonical shared list (see spec's "shared canonical item list, not
-- fuzzy text matching" decision) and has no update/delete policy at all, so
-- a duplicate created here is permanent — this index is what makes the
-- app-side find-or-create in pricing.js's createItem() safe to rely on
-- under concurrent submitters, instead of merely convention.
create unique index if not exists price_items_label_key
  on public.price_items (lower(label));

create table if not exists public.price_observations (
  id           uuid        primary key default gen_random_uuid(),
  item_id      uuid        not null references public.price_items on delete cascade,
  user_id      uuid        not null default auth.uid() references auth.users on delete cascade,
  price        numeric     not null check (price > 0),
  submitted_at timestamptz not null default now()
);

create index if not exists price_observations_item_idx
  on public.price_observations (item_id);

-- Reuses set_updated_at()'s sibling idea (server-authored timestamp) but
-- observations are insert-only, so a plain default is enough — no update
-- path exists that a client-supplied timestamp could smuggle a bad value
-- through.
-- security_invoker: the view runs with the querying user's own RLS, not the
-- view owner's — without this a Postgres view is SECURITY DEFINER-like by
-- default and silently bypasses price_observations' RLS. Harmless today
-- (read_price_observations already grants select to every authenticated
-- user) but it makes the spec's "inherits that table's select policy"
-- claim actually enforced by the view, not just coincidentally true.
create or replace view public.price_item_averages
  with (security_invoker = true) as
  select item_id, avg(price)::numeric(10,2) as avg_price, count(*) as sample_count
  from public.price_observations
  group by item_id;

alter table public.price_items enable row level security;
alter table public.price_observations enable row level security;

drop policy if exists read_price_items on public.price_items;
create policy read_price_items on public.price_items for select
  using (auth.role() = 'authenticated');

drop policy if exists insert_price_items on public.price_items;
create policy insert_price_items on public.price_items for insert
  with check (created_by = auth.uid());

-- No update/delete policy on price_items at all — deliberate, see spec's
-- "Immutable items, no moderation" decision. RLS defaults to deny when no
-- policy matches, so this alone is what makes items permanent.

drop policy if exists read_price_observations on public.price_observations;
create policy read_price_observations on public.price_observations for select
  using (auth.role() = 'authenticated');

drop policy if exists own_price_observations on public.price_observations;
create policy own_price_observations on public.price_observations for insert
  with check (user_id = auth.uid());

drop policy if exists update_own_price_observations on public.price_observations;
create policy update_own_price_observations on public.price_observations for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists delete_own_price_observations on public.price_observations;
create policy delete_own_price_observations on public.price_observations for delete
  using (user_id = auth.uid());

grant select, insert on public.price_items to authenticated;
grant select, insert, update, delete on public.price_observations to authenticated;
grant select on public.price_item_averages to authenticated;

-- Community insights. See docs/superpowers/specs/2026-10-16-community-insights-design.md.
-- Neither table below grants anything to `authenticated`: users reach them only
-- through the two RPCs (write) and the aggregate views (read).
create table if not exists public.contributions (
  id             uuid        primary key default gen_random_uuid(),
  kind           text        not null check (kind in ('fuel', 'part')),
  model_id       text        not null,
  engine         text,
  odometer_band  int         not null check (odometer_band >= 0),
  month          text        not null check (month ~ '^\d{4}-\d{2}$'),
  l100           numeric     check (l100 between 1 and 40),
  price_per_l    numeric     check (price_per_l > 0),
  item_key       text,
  brand          text,
  part_no        text,
  price          numeric     check (price > 0),
  km_since_prev  int         check (km_since_prev > 0),
  created_at     timestamptz not null default now()
);

create table if not exists public.contribution_links (
  user_id         uuid not null references auth.users on delete cascade,
  source_key      text not null,
  contribution_id uuid not null references public.contributions on delete cascade,
  primary key (user_id, source_key)
);
create index if not exists contribution_links_cid_idx on public.contribution_links (contribution_id);

-- Hardening CHECKs. NOT VALID: enforced for new writes, never fails on pre-existing rows.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contributions_len_chk') then
    alter table public.contributions add constraint contributions_len_chk check (
      length(brand) <= 80 and length(part_no) <= 80 and length(engine) <= 80
      and length(model_id) <= 80 and length(item_key) <= 80) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contributions_band_chk') then
    alter table public.contributions add constraint contributions_band_chk check (odometer_band % 5000 = 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contributions_month_chk') then
    alter table public.contributions add constraint contributions_month_chk
      check (month ~ '^\d{4}-(0[1-9]|1[0-2])$') not valid;
  end if;
end $$;

-- Repair vs replace: what was done to the part. Legacy rows default to 'replaced'.
alter table public.contributions add column if not exists action text not null default 'replaced';
alter table public.contributions add column if not exists finding text;
alter table public.contributions add column if not exists km_since_repair int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contributions_action_chk') then
    alter table public.contributions add constraint contributions_action_chk
      check (action in ('replaced', 'repaired', 'inspected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contributions_finding_chk') then
    alter table public.contributions add constraint contributions_finding_chk
      check (finding is null or (action = 'inspected' and finding in ('ok', 'attention')));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contributions_kmrepair_chk') then
    alter table public.contributions add constraint contributions_kmrepair_chk
      check (km_since_repair is null or km_since_repair > 0);
  end if;
end $$;

-- Account deletion must erase contributions too: the links cascade from auth.users
-- but the rows they point at do not, so delete them first (links still exist here).
create or replace function public.erase_user_contributions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from contributions where id in
    (select contribution_id from contribution_links where user_id = old.id);
  return old;
end $$;
revoke all on function public.erase_user_contributions() from public;
drop trigger if exists erase_user_contributions on auth.users;
create trigger erase_user_contributions before delete on auth.users
  for each row execute function public.erase_user_contributions();

alter table public.contributions enable row level security;
alter table public.contribution_links enable row level security;
-- No policies on purpose: RLS defaults to deny for every role except the owner.

-- Shops: a shared, insert-only list (like price_items). No update/delete policy,
-- so existing shops cannot be vandalised. name_norm is recomputed from name by
-- the BEFORE INSERT trigger below (client value is overwritten), so nobody can
-- squat another shop's key under a different display name.
create table if not exists public.shops (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null check (length(name) between 2 and 80),
  name_norm  text        not null check (length(name_norm) between 2 and 80),
  city       text        not null check (length(city) between 2 and 40),
  area       text        check (length(area) <= 40),
  created_at timestamptz not null default now()
);
create unique index if not exists shops_norm_city_key
  on public.shops (name_norm, lower(city));
-- Space-insensitive search key ("Alsalam" finds "Al Salam"); mirrors squash() in shops.js.
alter table public.shops add column if not exists name_key text generated always as (replace(name_norm, ' ', '')) stored;
create index if not exists shops_name_key_idx on public.shops (name_key);
alter table public.shops add column if not exists created_by uuid references auth.users on delete set null;

-- No backfill of existing shops.name_norm rows: the shops table has never been deployed.
-- shop_norm assumes a UTF-8 database with a Unicode-aware locale (Supabase default
-- en_US.UTF-8); under the C locale lower()/[:alnum:] stop handling non-ASCII. Parity
-- with JS is verified by supabase/tests/shop-norm.sql, which fails loudly on such a database.
-- Mirrors shops.norm() in src/data/shops.js (parity fixture: test/fixtures/shop-norm.json,
-- checked by supabase/tests/shop-norm.sql): lowercase, anything that is not a
-- letter/mark/number/space becomes a space, whitespace collapsed, trimmed, first 80 chars.
-- Postgres has no \p{M}, so the common combining-mark ranges (Latin, Hebrew, Arabic
-- tashkeel) are listed explicitly; rarer marks in other scripts become spaces.
create or replace function public.shop_norm(s text) returns text
language sql immutable set search_path = public as $$
  select left(btrim(regexp_replace(regexp_replace(lower(coalesce(s, '')),
    '[^[:alnum:][:space:]\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed]', ' ', 'g'),
    '[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g')), 80) $$;

-- Owner-run so it can read created_by (not selectable by clients). Max 10 shop
-- inserts per user per rolling 24h.
create or replace function public.shops_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.name_norm := public.shop_norm(new.name);
  -- Trusted non-JWT inserts (service_role, SQL editor, seeds): key is still
  -- normalised, but there is no user to attribute or cap.
  if auth.uid() is null then return new; end if;
  new.created_by := auth.uid();
  new.created_at := now();
  perform pg_advisory_xact_lock(hashtext('shops:' || new.created_by::text));
  if (select count(*) from public.shops
        where created_by = new.created_by and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'shop limit reached (10 per 24 hours)' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.shops_before_insert() from public;
drop trigger if exists shops_before_insert on public.shops;
create trigger shops_before_insert before insert on public.shops
  for each row execute function public.shops_before_insert();

alter table public.shops enable row level security;
drop policy if exists read_shops on public.shops;
create policy read_shops on public.shops for select to authenticated using (true);
drop policy if exists insert_shops on public.shops;
create policy insert_shops on public.shops for insert to authenticated with check (true);
-- Column-level select: created_by stays private (clients name explicit columns).
revoke select on public.shops from authenticated;
grant select (id, name, name_norm, name_key, city, area, created_at) on public.shops to authenticated;
grant insert on public.shops to authenticated;
revoke all on public.shops from anon;

create table if not exists public.shop_feedback (
  shop_id     uuid        not null references public.shops on delete cascade,
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  vote        smallint    not null check (vote in (-1, 1)),
  reasons     text[]      not null default '{}' check (reasons <@ array['price','quality','honest','fast']),
  bill_backed boolean     not null default false,
  created_at  timestamptz not null default now(),
  primary key (shop_id, user_id)
);
alter table public.shop_feedback enable row level security;
drop policy if exists own_shop_feedback on public.shop_feedback;
create policy own_shop_feedback on public.shop_feedback for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Column-level grants: bill_backed (doubles vote weight) is never client-writable.
revoke all on public.shop_feedback from anon, authenticated;
grant select, delete on public.shop_feedback to authenticated;
grant insert (shop_id, vote, reasons) on public.shop_feedback to authenticated;
-- shop_id is needed too: PostgREST upsert emits DO UPDATE SET shop_id = EXCLUDED.shop_id, ...
grant update (shop_id, vote, reasons) on public.shop_feedback to authenticated;

alter table public.contributions
  add column if not exists shop_id uuid references public.shops on delete set null;

-- Anti-fake-account rule: only "qualified" users count in aggregates (account
-- >= 7 days old with a confirmed email or phone). The ONLY place the age and
-- confirmation rule lives. Owner-run views read it; clients have no access.
create or replace view public.qualified_users as
  select u.id from auth.users u
  where u.created_at <= now() - interval '7 days'
    and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null);
revoke all on public.qualified_users from public, anon, authenticated;

-- Owner-run (not security_invoker): shop_feedback is own-rows-only under RLS, so
-- the aggregate must bypass it. Safe because the view only emits shops with >= 5
-- qualified voters and exposes counts, never user ids. One row per user per shop, so
-- count(*) is the number of distinct voters. bill_backed votes weigh 2.
create or replace view public.shop_trust as
  select f.shop_id,
         count(*) filter (where f.vote = 1)  as up,
         count(*) filter (where f.vote = -1) as down,
         count(*)                            as voters,
         (sum(case when f.vote = 1 then (case when f.bill_backed then 2 else 1 end) else 0 end)::numeric
           / sum(case when f.bill_backed then 2 else 1 end))::numeric(4,3) as score_share,
         (select coalesce(array_agg(x.r order by x.cnt desc), '{}')
            from (select r, count(*) as cnt
                    from shop_feedback f2 join qualified_users q2 on q2.id = f2.user_id, unnest(f2.reasons) as r
                   where f2.shop_id = f.shop_id and f2.vote = 1
                   group by r order by cnt desc limit 2) x) as top_reasons
  from shop_feedback f join qualified_users q on q.id = f.user_id
  group by f.shop_id
  having count(*) >= 5;

create or replace view public.store_prices as
  select c.model_id, c.item_key, c.shop_id, s.name as shop_name, s.city, s.area,
         (percentile_cont(0.5) within group (order by c.price))::numeric(10,2) as median_price,
         count(*) as n
  from contributions c
  join contribution_links l on l.contribution_id = c.id
  join qualified_users q on q.id = l.user_id
  join shops s on s.id = c.shop_id
  where c.kind = 'part' and c.price is not null and c.action = 'replaced'
  group by c.model_id, c.item_key, c.shop_id, s.name, s.city, s.area
  having count(distinct l.user_id) >= 5;

grant select on public.shop_trust, public.store_prices to authenticated;
revoke all on public.shop_trust, public.store_prices from anon;

create or replace function public.submit_contributions(rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; cid uuid; n int := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 50 then
    raise exception 'bad rows';
  end if;
  for r in select * from jsonb_array_elements(rows) loop
    -- Invalid rows are skipped individually; one bad row must not sink the batch.
    continue when jsonb_typeof(r) <> 'object' or r->>'kind' is null or r->>'kind' not in ('fuel', 'part')
      or r->>'source_key' is null or coalesce(r->>'month', '') !~ '^\d{4}-(0[1-9]|1[0-2])$';
    begin
    select contribution_id into cid from contribution_links
      where user_id = auth.uid() and source_key = r->>'source_key';
    if cid is null then
      insert into contributions (kind, model_id, engine, odometer_band, month, l100,
                                 price_per_l, item_key, brand, part_no, price, km_since_prev, shop_id,
                                 action, finding, km_since_repair)
      values (r->>'kind', r->>'model_id', r->>'engine', (r->>'odometer_band')::int,
              r->>'month', (r->>'l100')::numeric, (r->>'price_per_l')::numeric,
              r->>'item_key', r->>'brand', r->>'part_no', (r->>'price')::numeric,
              (r->>'km_since_prev')::int, (r->>'shop_id')::uuid,
              coalesce(r->>'action', 'replaced'), r->>'finding', (r->>'km_since_repair')::int)
      returning id into cid;
      insert into contribution_links (user_id, source_key, contribution_id)
        values (auth.uid(), r->>'source_key', cid);
    else
      update contributions set
        engine = r->>'engine', odometer_band = (r->>'odometer_band')::int, month = r->>'month',
        l100 = (r->>'l100')::numeric, price_per_l = (r->>'price_per_l')::numeric,
        brand = r->>'brand', part_no = r->>'part_no', price = (r->>'price')::numeric,
        km_since_prev = (r->>'km_since_prev')::int,
        shop_id = (r->>'shop_id')::uuid,
        action = coalesce(r->>'action', 'replaced'), finding = r->>'finding',
        km_since_repair = (r->>'km_since_repair')::int
      where id = cid;
    end if;
    n := n + 1;
    exception when others then null;  -- bad cast / CHECK violation: skip this row
    end;
  end loop;
  return n;
end $$;

create or replace function public.delete_my_contributions() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from shop_feedback where user_id = auth.uid();
  /* read-bill's daily caps count the last 24h of bill_reads rows. Deleting
     those let a user reset their own cap by toggling sharing off and on, so
     rows inside the window keep user_id + created_at (the count) and lose
     only what describes the bill. Older rows no longer count and go. */
  update bill_reads set store_key = null, city = null, fingerprint = null
    where user_id = auth.uid() and created_at > now() - interval '1 day';
  delete from bill_reads where user_id = auth.uid() and created_at <= now() - interval '1 day';
  with gone as (
    delete from contributions where id in
      (select contribution_id from contribution_links where user_id = auth.uid())
    returning 1)
  select count(*) into n from gone;
  return n;
end $$;

revoke all on function public.submit_contributions(jsonb), public.delete_my_contributions() from public;
grant execute on function public.submit_contributions(jsonb), public.delete_my_contributions() to authenticated;

-- Owner-run views (NOT security_invoker): they must count distinct users in
-- contribution_links, which no signed-in user can read. The HAVING clause is
-- the 5-contributor privacy floor.
create or replace view public.fuel_stats as
  select c.model_id, c.engine, c.odometer_band,
         (percentile_cont(0.5)  within group (order by c.l100))::numeric(5,2) as median_l100,
         (percentile_cont(0.25) within group (order by c.l100))::numeric(5,2) as p25_l100,
         (percentile_cont(0.75) within group (order by c.l100))::numeric(5,2) as p75_l100,
         count(*) as n
  from contributions c join contribution_links l on l.contribution_id = c.id
  join qualified_users q on q.id = l.user_id
  where c.kind = 'fuel' and c.l100 is not null
  group by c.model_id, c.engine, c.odometer_band
  having count(distinct l.user_id) >= 5;

create or replace view public.brand_life as
  select c.model_id, c.item_key, c.brand,
         percentile_cont(0.5)  within group (order by c.km_since_prev) as median_km,
         percentile_cont(0.25) within group (order by c.km_since_prev) as p25_km,
         percentile_cont(0.75) within group (order by c.km_since_prev) as p75_km,
         (percentile_cont(0.5) within group (order by c.price))::numeric(10,2) as median_price,
         count(*) as n
  from contributions c join contribution_links l on l.contribution_id = c.id
  join qualified_users q on q.id = l.user_id
  where c.kind = 'part' and c.km_since_prev is not null and c.price is not null
    and c.action = 'replaced'
  group by c.model_id, c.item_key, c.brand
  having count(distinct l.user_id) >= 5;

-- Owner-run like the views above; >= 5 distinct qualified users per model+item; no user ids.
create or replace view public.repair_stats as
  select c.model_id, c.item_key,
         count(*) filter (where c.action = 'replaced')  as n_replaced,
         count(*) filter (where c.action = 'repaired')  as n_repaired,
         count(*) filter (where c.action = 'inspected') as n_inspected,
         (percentile_cont(0.5) within group (order by c.price)
            filter (where c.action = 'replaced' and c.price > 0))::numeric(10,2) as median_price_replaced,
         (percentile_cont(0.5) within group (order by c.price)
            filter (where c.action = 'repaired' and c.price > 0))::numeric(10,2) as median_price_repaired,
         percentile_cont(0.5) within group (order by c.km_since_repair)
            filter (where c.km_since_repair is not null) as median_km_after_repair,
         (count(*) filter (where c.action = 'inspected' and c.finding = 'attention'))::numeric
           / nullif(count(*) filter (where c.action = 'inspected' and c.finding is not null), 0) as attention_share
  from contributions c
  join contribution_links l on l.contribution_id = c.id
  join qualified_users q on q.id = l.user_id
  where c.kind = 'part' and c.item_key is not null
  group by c.model_id, c.item_key
  having count(distinct l.user_id) >= 5;

grant select on public.fuel_stats, public.brand_life to authenticated;
grant select on public.repair_stats to authenticated;

-- Per-user sharing preference, so opt-out survives sign-out and new devices.
create table if not exists public.insights_prefs (
  user_id     uuid primary key default auth.uid() references auth.users on delete cascade,
  share       boolean not null default true,
  notice_seen boolean not null default false,
  updated_at  timestamptz not null default now()
);
alter table public.insights_prefs enable row level security;
drop policy if exists own_insights_prefs on public.insights_prefs;
create policy own_insights_prefs on public.insights_prefs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.insights_prefs to authenticated;

-- Bill reads: proof that a user photographed a real bill. Written only by the
-- read-bill Edge Function (service role). Holds NO image and NO bill text.
-- fingerprint = SHA-256 of store|date|total (whole SAR); no bill text stored. Unique, so one bill registers once
-- across all accounts; duplicates get a row with null fingerprint/store_key
-- (counts toward the daily cap, can never back a vote).
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.bill_reads (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users on delete cascade,
  store_key   text,
  city        text,
  fingerprint text,
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);
create unique index if not exists bill_reads_fingerprint_key
  on public.bill_reads (fingerprint) where fingerprint is not null;
create index if not exists bill_reads_user_day_idx on public.bill_reads (user_id, created_at);
alter table public.bill_reads enable row level security;
revoke all on public.bill_reads from anon, authenticated;

-- Vote on a shop. bill_backed is true only when the caller's own, unused,
-- <= 7 day old bill read names a shop similar to the one voted on.
create or replace function public.vote_shop(p_shop_id uuid, p_vote smallint, p_reasons text[],
                                            p_bill_read_id uuid default null)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare s shops%rowtype; b bill_reads%rowtype; backed boolean := false;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into s from shops where id = p_shop_id;
  if not found then return false; end if;
  if p_bill_read_id is not null then
    select * into b from bill_reads
      where id = p_bill_read_id and user_id = auth.uid() and used_at is null
        and created_at > now() - interval '7 days' and store_key is not null and fingerprint is not null
      for update;
    if found and similarity(b.store_key, s.name_key) >= 0.5 then
      backed := true;
      update bill_reads set used_at = now() where id = b.id;
    end if;
  end if;
  insert into shop_feedback (shop_id, user_id, vote, reasons, bill_backed)
    values (p_shop_id, auth.uid(), p_vote, coalesce(p_reasons, '{}'), backed)
  on conflict (shop_id, user_id) do update
    set vote = excluded.vote, reasons = excluded.reasons,
        bill_backed = shop_feedback.bill_backed or excluded.bill_backed;
  return backed;
end $$;
revoke all on function public.vote_shop(uuid, smallint, text[], uuid) from public, anon;
grant execute on function public.vote_shop(uuid, smallint, text[], uuid) to authenticated;

-- Supabase default privileges may auto-grant on new public objects; strip them.
revoke all on public.contributions, public.contribution_links from anon, authenticated;
revoke all on public.fuel_stats, public.brand_life from anon;
revoke all on public.repair_stats from anon;
revoke execute on function public.submit_contributions(jsonb), public.delete_my_contributions() from anon;

-- ============================================================
-- Phase 5a: shared catalogue, roles, dealer plans.
-- Spec: docs/superpowers/specs/2026-10-15-community-plans-design.md
-- After this file, apply supabase/seed-catalogue.sql. Make yourself admin
-- once, by hand:  update public.profiles set role = 'admin' where user_id = '<your uuid>';
-- ============================================================

create table if not exists public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  role text not null default 'user' check (role in ('user', 'admin')),
  share_community boolean not null default true
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts that existed before this section.
insert into public.profiles (user_id) select id from auth.users on conflict do nothing;

-- security definer so policies can call it without granting profiles reads.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role = 'admin')
$$;

alter table public.profiles enable row level security;
drop policy if exists read_own_profile on public.profiles;
create policy read_own_profile on public.profiles for select using (user_id = auth.uid());
drop policy if exists update_own_sharing on public.profiles;
create policy update_own_sharing on public.profiles for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Column privileges: a user may flip share_community, never role.
revoke update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (share_community) on public.profiles to authenticated;

create table if not exists public.car_models (
  id text primary key,                      -- catalog.js catalogId(): '<modelId>:<engine-slug>'
  make text not null default 'Mazda',
  model text not null,
  generation text not null,
  engine text not null,
  oil_capacity_l numeric,
  paints jsonb not null default '[]',
  warranty_years int,
  warranty_km int,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  sources jsonb not null default '[]',
  plan_updated_at timestamptz not null default now()
);

create table if not exists public.dealer_plan_items (
  id bigint generated always as identity primary key,
  car_model_id text not null references public.car_models on delete cascade,
  service text not null,
  icon text not null default '🔧',
  category text not null default 'Engine',
  interval_km int,
  interval_months int,
  note text not null default '',
  parts jsonb not null default '[]',        -- [{ name, part_no, qty }]
  source_url text,
  sort int not null default 0,
  unique (car_model_id, service)
);
-- Severe-condition interval (Phase 3, D-09). Null = none known; no backfill possible.
-- The gate hash key set grew with these columns, so pending proposals made before
-- this change get a different after_hash on resubmit (they re-queue once; harmless).
alter table public.dealer_plan_items add column if not exists severe_km int;
alter table public.dealer_plan_items add column if not exists severe_months int;

create table if not exists public.dealer_plan_changes (
  id bigint generated always as identity primary key,
  car_model_id text not null references public.car_models on delete cascade,
  item_id bigint,                           -- null: a change to the car itself
  before jsonb,
  after jsonb,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);

-- Item edits: log updates/deletes (inserts are the seed or a draft, not
-- corrections) and bump the car's plan version so devices re-apply it.
create or replace function public.on_dealer_plan_item_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare cm text;
begin
  if tg_op = 'DELETE' then cm := old.car_model_id; else cm := new.car_model_id; end if;
  -- Cascade from a car delete: the parent is gone, so logging would break the FK.
  if tg_op = 'DELETE' and not exists (select 1 from public.car_models where id = cm) then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    insert into public.dealer_plan_changes (car_model_id, item_id, before, after)
    values (cm, new.id, to_jsonb(old), to_jsonb(new));
  elsif tg_op = 'DELETE' then
    insert into public.dealer_plan_changes (car_model_id, item_id, before, after)
    values (cm, old.id, to_jsonb(old), null);
  end if;
  update public.car_models set plan_updated_at = now() where id = cm;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists dealer_plan_item_change on public.dealer_plan_items;
create trigger dealer_plan_item_change after insert or update or delete on public.dealer_plan_items
  for each row execute function public.on_dealer_plan_item_change();

-- Car edits (warranty, status). plan_updated_at is excluded from the
-- comparison, or every item edit above would also log a car change.
create or replace function public.on_car_model_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (to_jsonb(old) - 'plan_updated_at') is distinct from (to_jsonb(new) - 'plan_updated_at') then
    insert into public.dealer_plan_changes (car_model_id, item_id, before, after)
    values (new.id, null, to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end $$;

drop trigger if exists car_model_change on public.car_models;
create trigger car_model_change after update on public.car_models
  for each row execute function public.on_car_model_change();

-- Approved plans are public information: anon may read them too, because
-- the sign-in UI is hidden and most users are anonymous.
alter table public.car_models enable row level security;
drop policy if exists read_car_models on public.car_models;
create policy read_car_models on public.car_models for select to anon, authenticated
  using (status = 'approved' or public.is_admin());
drop policy if exists admin_write_car_models on public.car_models;
create policy admin_write_car_models on public.car_models for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.dealer_plan_items enable row level security;
drop policy if exists read_dealer_plan_items on public.dealer_plan_items;
create policy read_dealer_plan_items on public.dealer_plan_items for select to anon, authenticated
  using (exists (select 1 from public.car_models m
                 where m.id = car_model_id and (m.status = 'approved' or public.is_admin())));
drop policy if exists admin_write_dealer_plan_items on public.dealer_plan_items;
create policy admin_write_dealer_plan_items on public.dealer_plan_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Explicit grants (see the vehicles/garage note above); RLS still enforces admin-only writes.
grant select on public.car_models, public.dealer_plan_items to anon, authenticated;
grant insert, update, delete on public.car_models, public.dealer_plan_items to authenticated;
grant select on public.dealer_plan_changes to authenticated;

alter table public.dealer_plan_changes enable row level security;
drop policy if exists admin_read_dealer_plan_changes on public.dealer_plan_changes;
create policy admin_read_dealer_plan_changes on public.dealer_plan_changes for select to authenticated
  using (public.is_admin());
revoke all on public.dealer_plan_changes from anon;

-- Guidance engine: sources the intake function reads, recalls, and drafts awaiting admin approval.
create table if not exists public.schedule_sources (
  id bigint generated always as identity primary key,
  car_model_id text not null references public.car_models on delete cascade,
  url text not null check (url ~ '^https://'),
  content_hash text,
  last_checked_at timestamptz,
  unique (car_model_id, url)
);

create table if not exists public.recalls (
  campaign text not null,
  car_model_id text not null references public.car_models on delete cascade,
  years int[] not null default '{}',
  component text not null,
  summary text not null,
  remedy text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  fetched_at timestamptz not null default now(),
  primary key (campaign, car_model_id)
);

create table if not exists public.plan_drafts (
  id bigint generated always as identity primary key,
  car_model_id text not null references public.car_models on delete cascade,
  source_id bigint references public.schedule_sources on delete set null,
  service text not null,
  proposed jsonb not null,                  -- { interval_km, interval_months, note, parts }
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz
);
create unique index if not exists plan_drafts_one_pending
  on public.plan_drafts (car_model_id, service) where status = 'pending';

alter table public.schedule_sources enable row level security;
alter table public.recalls enable row level security;
alter table public.plan_drafts enable row level security;

drop policy if exists admin_schedule_sources on public.schedule_sources;
create policy admin_schedule_sources on public.schedule_sources for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_plan_drafts on public.plan_drafts;
create policy admin_plan_drafts on public.plan_drafts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists read_recalls on public.recalls;
create policy read_recalls on public.recalls for select to anon, authenticated
  using (status = 'approved' or public.is_admin());
drop policy if exists admin_write_recalls on public.recalls;
create policy admin_write_recalls on public.recalls for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select on public.recalls to anon, authenticated;
grant update (status) on public.recalls to authenticated;
grant select, insert, update, delete on public.schedule_sources, public.plan_drafts to authenticated;

-- Applies (or rejects) one pending draft. Approval upserts the live plan item, so the
-- existing dealer_plan_item_change trigger logs it and bumps plan_updated_at.
create or replace function public.decide_plan_draft(p_id bigint, p_approve boolean, p_edit jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare d public.plan_drafts; v jsonb; src text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into d from public.plan_drafts where id = p_id and status = 'pending' for update;
  if not found then raise exception 'no pending draft'; end if;
  if p_approve then
    v := coalesce(p_edit, d.proposed);
    select url into src from public.schedule_sources where id = d.source_id;
    insert into public.dealer_plan_items (car_model_id, service, interval_km, interval_months, note, parts, source_url)
    values (d.car_model_id, d.service,
            nullif(least(greatest((v->>'interval_km')::int, 0), 1000000), 0),
            nullif(least(greatest((v->>'interval_months')::int, 0), 240), 0),
            left(coalesce(v->>'note', ''), 300), coalesce(v->'parts', '[]'::jsonb), src)
    on conflict (car_model_id, service) do update set
      interval_km = excluded.interval_km, interval_months = excluded.interval_months,
      note = excluded.note, parts = excluded.parts, source_url = excluded.source_url;
  end if;
  update public.plan_drafts set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now() where id = p_id;
end $$;
revoke execute on function public.decide_plan_draft(bigint, boolean, jsonb) from anon;

-- ============================================================================
-- Error log (FND-02, D-02..D-07)
-- Clients (anon or signed in) can only INSERT; only an admin reads or resolves.
-- No column for vehicle or record data (D-03). source is shared by the client
-- logger and edge functions (D-05). Re-runnable.
-- ============================================================================
create table if not exists public.app_errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  source      text not null check (source ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  message     text not null check (char_length(message) between 1 and 500),
  stack       text check (char_length(stack) <= 2000),
  route       text check (char_length(route) <= 120),
  app_version text check (char_length(app_version) <= 40),
  user_id     uuid references auth.users on delete set null,
  group_key   text not null,
  resolved_at timestamptz
);
create index if not exists app_errors_created_idx on public.app_errors (created_at);
create index if not exists app_errors_group_idx on public.app_errors (group_key);

-- The anon key is public, so cap client inserts globally per hour. Only
-- source='client' rows count: service-role edge-function errors must never use
-- up the budget and silence client logging. user_id/group_key are always
-- overwritten here, never trusted from the client.
create or replace function public.app_errors_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Keyed on the DB role (set by PostgREST and by SET ROLE), not JWT claims.
  if coalesce(current_setting('role', true), '') in ('anon', 'authenticated') then
    -- Clients cannot pick a source: forcing 'client' keeps the cap below
    -- un-bypassable and stops spoofed edge-function rows. Only service_role
    -- may write other sources.
    new.source := 'client';
    perform pg_advisory_xact_lock(hashtext('app_errors_client_cap'));
    -- Hard global ceiling (2000 client rows/h) first, whatever the identity.
    if (select count(*) from public.app_errors
         where source = 'client' and created_at > now() - interval '1 hour') >= 2000 then
      raise exception 'rate limited';
    end if;
    -- Separate budgets: anonymous callers share one pool (500/h); a signed-in
    -- user has their own (100/h), so anon spam cannot starve their reports.
    if (select count(*) from public.app_errors
         where source = 'client' and created_at > now() - interval '1 hour'
           and user_id is not distinct from auth.uid()) >= (case when auth.uid() is null then 500 else 100 end) then
      raise exception 'rate limited';
    end if;
  end if;
  new.user_id := auth.uid();
  new.group_key := md5(new.source || '|' || left(regexp_replace(lower(new.message),
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9]+', '#', 'g'), 200));
  return new;
end $$;
drop trigger if exists app_errors_before_insert on public.app_errors;
create trigger app_errors_before_insert before insert on public.app_errors
  for each row execute function public.app_errors_before_insert();

alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;
grant insert (source, message, stack, route, app_version) on public.app_errors to anon, authenticated;
drop policy if exists anon_insert_app_errors on public.app_errors;
create policy anon_insert_app_errors on public.app_errors for insert to anon, authenticated with check (true);
grant select (id, created_at, source, message, stack, route, app_version, user_id, group_key, resolved_at)
  on public.app_errors to authenticated;
drop policy if exists admin_read_app_errors on public.app_errors;
create policy admin_read_app_errors on public.app_errors for select to authenticated using (public.is_admin());
grant update (resolved_at) on public.app_errors to authenticated;
drop policy if exists admin_resolve_app_errors on public.app_errors;
create policy admin_resolve_app_errors on public.app_errors for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- resolved_at is compared with server-authored created_at, so it must be server time too:
-- whatever non-null value the admin client sends is replaced by now().
create or replace function public.app_errors_before_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.resolved_at is not null and new.resolved_at is distinct from old.resolved_at then
    new.resolved_at := now();
  end if;
  return new;
end $$;
drop trigger if exists app_errors_before_update on public.app_errors;
create trigger app_errors_before_update before update on public.app_errors
  for each row execute function public.app_errors_before_update();

-- 90-day retention (D-04). Skipped where pg_cron is unavailable (e.g. CI).
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'app-errors-retention') then
      perform cron.unschedule('app-errors-retention');
    end if;
    perform cron.schedule('app-errors-retention', '17 3 * * *',
      $job$delete from public.app_errors where created_at < now() - interval '90 days'$job$);
  end if;
end $$;

-- ============================================================================
-- Proposal gate (Phase 2, CORE-01..CORE-07)
-- The autopilot (service_role / owner) can only call submit_proposal, which
-- writes pending rows. The one live writer is apply_proposal, admin only.
-- Browsers can read proposals and change_log (admin) and nothing else:
-- RPC-only writes, so there are deliberately no write policies or table
-- privileges below. Re-runnable.
-- ============================================================================

-- Makers (CORE-06): pipeline code reads the maker from data, never a literal.
create table if not exists public.makers (
  id   text primary key,
  name text not null unique
);
-- Data row, the only place the brand name is allowed to appear in this section.
insert into public.makers (id, name) values ('mazda', 'Mazda') on conflict do nothing;

alter table public.makers enable row level security;
drop policy if exists read_makers on public.makers;
create policy read_makers on public.makers for select to anon, authenticated using (true);
drop policy if exists admin_write_makers on public.makers;
create policy admin_write_makers on public.makers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select on public.makers to anon, authenticated;
grant insert, update, delete on public.makers to authenticated;

alter table public.car_models add column if not exists maker_id text references public.makers;
insert into public.makers (id, name)
  select distinct on (lower(make)) lower(make), make from public.car_models on conflict do nothing;
update public.car_models set maker_id = lower(make) where maker_id is null;

-- Fills maker_id on insert so seed-catalogue.sql stays unchanged.
create or replace function public.car_models_set_maker() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.maker_id is null then
    insert into public.makers (id, name) values (lower(new.make), new.make) on conflict do nothing;
    new.maker_id := lower(new.make);
  end if;
  return new;
end $$;
drop trigger if exists car_models_set_maker on public.car_models;
create trigger car_models_set_maker before insert on public.car_models
  for each row execute function public.car_models_set_maker();

create table if not exists public.proposals (
  id                 bigint generated always as identity primary key,
  run_id             bigint,   -- FK proposals_run_fk -> autopilot_runs added in the autopilot section below
  kind               text not null,
  maker_id           text not null references public.makers,
  car_model_id       text references public.car_models on delete cascade,
  target_key         text not null check (char_length(target_key) between 1 and 120),
  op                 text not null check (op in ('insert', 'update', 'delete')),
  before             jsonb,
  base_hash          text not null,
  after              jsonb not null check (octet_length(after::text) <= 8192),
  after_hash         text not null,
  evidence           jsonb not null,
  sources_hash       text not null,
  confidence_tier    text not null check (confidence_tier in ('high', 'medium', 'low')),
  confidence_factors jsonb not null default '{}',
  reason             text not null default '' check (char_length(reason) <= 300),
  -- A stale refusal never changes status: the owner must still edit or reject it.
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'superseded')),
  created_at         timestamptz not null default now(),
  decided_by         uuid,
  decided_at         timestamptz,
  edited_after       jsonb,
  reject_reason      text check (char_length(reject_reason) <= 300)
);
create unique index if not exists proposals_one_pending
  on public.proposals (kind, coalesce(car_model_id, ''), target_key) where status = 'pending';

-- Supplements (does not replace) dealer_plan_changes, which still fires and
-- bumps car_models.plan_updated_at so devices refetch.
create table if not exists public.change_log (
  id           bigint generated always as identity primary key,
  made_at      timestamptz not null default now(),
  made_by      uuid default auth.uid(),
  kind         text not null,
  car_model_id text references public.car_models on delete cascade,
  table_name   text not null,
  row_key      text not null,
  op           text not null check (op in ('insert', 'update', 'delete')),
  before       jsonb,
  after        jsonb,
  proposal_id  bigint references public.proposals on delete set null,
  reverts_id   bigint references public.change_log on delete set null
);

alter table public.proposals enable row level security;
revoke all on public.proposals from anon, authenticated;
grant select on public.proposals to authenticated;
drop policy if exists admin_read_proposals on public.proposals;
create policy admin_read_proposals on public.proposals for select to authenticated using (public.is_admin());

alter table public.change_log enable row level security;
revoke all on public.change_log from anon, authenticated;
grant select on public.change_log to authenticated;
drop policy if exists admin_read_change_log on public.change_log;
create policy admin_read_change_log on public.change_log for select to authenticated using (public.is_admin());

-- Live value a proposal of this kind compares against; null when no row.
create or replace function public.proposal_live(p_kind text, p_car text, p_target text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if p_kind = 'recall' then
    select jsonb_build_object('component', x.component, 'summary', x.summary, 'remedy', x.remedy,
                              'years', to_jsonb(x.years), 'status', x.status)
      into r from public.recalls x where x.car_model_id = p_car and x.campaign = p_target;
    return r;
  end if;
  if p_kind <> 'schedule_item' then raise exception 'unsupported kind'; end if;
  select jsonb_build_object('interval_km', i.interval_km, 'interval_months', i.interval_months,
                            'severe_km', i.severe_km, 'severe_months', i.severe_months,
                            'note', i.note, 'parts', i.parts)
    into r from public.dealer_plan_items i where i.car_model_id = p_car and i.service = p_target;
  return r;
end $$;
revoke execute on function public.proposal_live(text, text, text) from public, anon, authenticated;

-- Rule-based confidence (tunable weights): best source tier official 2 /
-- secondary 1 / community 0; +1 for two or more distinct hosts; +1 when the
-- change is small (<= 25%), -1 when large (> 50%). high >= 3, medium 2, else low.
create or replace function public.proposal_confidence(p_before jsonb, p_after jsonb, p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e jsonb; k text; pts int; best int := 0; best_tier text := 'community'; doms int;
        b numeric; a numeric; pct numeric; score int; tier text;
begin
  for e in select value from jsonb_array_elements(p_evidence) loop
    pts := case e->>'tier' when 'official' then 2 when 'secondary' then 1 else 0 end;
    if pts > best then
      best := pts; best_tier := case pts when 2 then 'official' else 'secondary' end;
    end if;
  end loop;
  select count(distinct substring(x->>'url' from '^https://([^/:]+)')) into doms
    from jsonb_array_elements(p_evidence) x;
  if p_before is not null then
    foreach k in array array['interval_km', 'interval_months', 'severe_km', 'severe_months'] loop
      if jsonb_typeof(p_before->k) = 'number' and jsonb_typeof(p_after->k) = 'number'
         and (p_before->>k)::numeric > 0 then
        b := (p_before->>k)::numeric; a := (p_after->>k)::numeric;
        pct := greatest(coalesce(pct, 0), abs(a - b) / b * 100);
      end if;
    end loop;
  end if;
  score := best + case when doms >= 2 then 1 else 0 end
         + case when pct is null then 0 when pct <= 25 then 1 when pct > 50 then -1 else 0 end;
  tier := case when score >= 3 then 'high' when score = 2 then 'medium' else 'low' end;
  return jsonb_build_object('tier', tier, 'factors', jsonb_build_object(
    'best_tier', best_tier, 'domains', doms, 'change_pct', round(pct, 1), 'score', score));
end $$;
revoke execute on function public.proposal_confidence(jsonb, jsonb, jsonb) from public, anon, authenticated;

-- The only way a proposal is created. No is_admin guard: the caller is the
-- service role or the table owner (seed script), never a browser.
create or replace function public.submit_proposal(
  p_kind text, p_car_model_id text, p_target_key text, p_after jsonb, p_evidence jsonb,
  p_run_id bigint default null, p_reason text default '', p_maker_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare car public.car_models; ev jsonb; before_v jsonb; conf jsonb; new_id bigint; ah text; sh text; ex bigint;
begin
  if p_kind not in ('schedule_item', 'recall') then raise exception 'unsupported kind'; end if;
  select * into car from public.car_models where id = p_car_model_id;
  if not found then raise exception 'unknown car'; end if;
  if p_after is null or jsonb_typeof(p_after) <> 'object' then raise exception 'after must be an object'; end if;
  if octet_length(p_after::text) > 8192 then raise exception 'after too large'; end if;
  if p_kind = 'recall' then
    if char_length(btrim(coalesce(p_after->>'component', ''))) not between 1 and 200 then raise exception 'bad recall component'; end if;
    if char_length(btrim(coalesce(p_after->>'summary', ''))) not between 1 and 1000 then raise exception 'bad recall summary'; end if;
    if char_length(coalesce(p_after->>'remedy', '')) > 1000 then raise exception 'recall remedy too long'; end if;
    if p_after ? 'years' and (jsonb_typeof(p_after->'years') <> 'array' or jsonb_array_length(p_after->'years') > 40) then
      raise exception 'bad recall years'; end if;
  end if;
  -- CORE-07: canonical units only; conversion happens in code, never here.
  if p_after ? 'distance_unit' and p_after->>'distance_unit' is distinct from 'km' then
    raise exception 'non-canonical unit'; end if;
  if p_after ? 'currency' and p_after->>'currency' is distinct from 'SAR' then
    raise exception 'non-canonical unit'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array'
     or jsonb_array_length(p_evidence) not between 1 and 10 then
    raise exception 'evidence must have 1 to 10 items'; end if;
  for ev in select value from jsonb_array_elements(p_evidence) loop
    if jsonb_typeof(ev) <> 'object' or coalesce(ev->>'url', '') !~ '^https://' then
      raise exception 'evidence url must be https'; end if;
    if char_length(coalesce(ev->>'quote', '')) > 500 then raise exception 'quote too long'; end if;
    if coalesce(ev->>'tier', '') not in ('official', 'secondary', 'community') then
      raise exception 'bad evidence tier'; end if;
  end loop;

  perform pg_advisory_xact_lock(hashtext('proposal:' || p_kind || ':' || coalesce(p_car_model_id, '') || ':' || p_target_key));
  before_v := public.proposal_live(p_kind, p_car_model_id, p_target_key);
  conf := public.proposal_confidence(before_v, p_after, p_evidence);
  -- Same key set as proposal_live. A schedule proposal without severe keys keeps the
  -- live severe values (D-10), so hash them from live or a severe-less proposal never
  -- equals live and could not be a noop.
  if p_kind = 'recall' then
    ah := md5(jsonb_build_object('component', p_after->'component', 'summary', p_after->'summary',
                                 'remedy', p_after->'remedy', 'years', p_after->'years')::text);
  else
    ah := md5(jsonb_build_object('interval_km', p_after->'interval_km', 'interval_months', p_after->'interval_months',
                                 'severe_km', case when p_after ? 'severe_km' then p_after->'severe_km' else before_v->'severe_km' end,
                                 'severe_months', case when p_after ? 'severe_months' then p_after->'severe_months' else before_v->'severe_months' end,
                                 'note', p_after->'note', 'parts', p_after->'parts')::text);
  end if;
  sh := (select md5(string_agg((x->>'url') || '|' || coalesce(x->>'content_hash', ''), ',' order by x->>'url'))
           from jsonb_array_elements(p_evidence) x);
  -- Queue hygiene (CORE-03, CORE-04): equal to live -> noop; same pending value -> duplicate;
  -- rejected with the same value AND sources -> suppressed (changed sources re-queue).
  -- A recall is only a noop when already approved (status is not part of the hash).
  -- parentheses: plpgsql ends an IF condition at the first THEN token, which would be the CASE's own THEN
  if before_v is not null and (case when p_kind = 'recall'
       then before_v->>'status' = 'approved' and md5((before_v - 'status')::text) = ah
       else md5(before_v::text) = ah end) then
    return jsonb_build_object('id', null, 'action', 'noop'); end if;
  select id into ex from public.proposals where status = 'pending' and kind = p_kind
    and coalesce(car_model_id, '') = coalesce(p_car_model_id, '') and target_key = p_target_key and after_hash = ah;
  if found then return jsonb_build_object('id', ex, 'action', 'duplicate'); end if;
  select id into ex from public.proposals where status = 'rejected' and kind = p_kind
    and coalesce(car_model_id, '') = coalesce(p_car_model_id, '') and target_key = p_target_key
    and after_hash = ah and sources_hash = sh order by id desc limit 1;
  if found then return jsonb_build_object('id', ex, 'action', 'suppressed'); end if;
  -- Supersede before insert: the partial unique index allows one pending per target.
  update public.proposals set status = 'superseded', decided_at = now()
    where status = 'pending' and kind = p_kind
      and coalesce(car_model_id, '') = coalesce(p_car_model_id, '') and target_key = p_target_key;
  insert into public.proposals (run_id, kind, maker_id, car_model_id, target_key, op, before, base_hash,
                                after, after_hash, evidence, sources_hash, confidence_tier, confidence_factors, reason)
  values (p_run_id, p_kind, coalesce(p_maker_id, car.maker_id), p_car_model_id, p_target_key,
          case when before_v is null then 'insert' else 'update' end, before_v,
          md5(coalesce(before_v::text, 'null')), p_after, ah, p_evidence, sh,
          conf->>'tier', conf->'factors', left(coalesce(p_reason, ''), 300))
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'action', 'inserted');
end $$;
revoke execute on function public.submit_proposal(text, text, text, jsonb, jsonb, bigint, text, text) from public, anon, authenticated;
grant execute on function public.submit_proposal(text, text, text, jsonb, jsonb, bigint, text, text) to service_role;

-- The only live writer for proposals. Refuses (and writes nothing) when the live
-- row changed since the proposal was made; the proposal then stays pending.
-- p_seen_hash lets the owner rebase an edit onto the live value the stale
-- message showed: it must still equal the live hash now, checked under lock.
create or replace function public.apply_proposal(p_id bigint, p_edit jsonb default null, p_seen_hash text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.proposals; live jsonb; live_hash text; expected text; v jsonb; pj jsonb; el jsonb;
        nm text; parts jsonb := '[]'; change_id bigint; src text; sk int; sm int;
        comp text; summ text; tbl text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into p from public.proposals where id = p_id and status = 'pending' for update;
  if not found then raise exception 'no pending proposal'; end if;
  if p.kind not in ('schedule_item', 'recall') then raise exception 'unsupported kind'; end if;
  if p.kind = 'recall' then
    perform 1 from public.recalls where car_model_id = p.car_model_id and campaign = p.target_key for update;
  else
    perform 1 from public.dealer_plan_items where car_model_id = p.car_model_id and service = p.target_key for update;
  end if;
  live := public.proposal_live(p.kind, p.car_model_id, p.target_key);
  live_hash := md5(coalesce(live::text, 'null'));
  if p_seen_hash is not null and p_edit is not null then expected := p_seen_hash;
  elsif p_seen_hash is not null then expected := null;   -- a rebase without an edit makes no sense
  else expected := p.base_hash; end if;
  if live_hash is distinct from expected then
    return jsonb_build_object('ok', false, 'error', 'stale', 'live', live, 'live_hash', live_hash);
  end if;

  v := coalesce(p_edit, p.after);
  if p.kind = 'recall' then
    comp := left(btrim(coalesce(v->>'component', '')), 200);
    summ := left(btrim(coalesce(v->>'summary', '')), 1000);
    if comp = '' or summ = '' then raise exception 'recall needs component and summary'; end if;
    pj := coalesce(v->'years', live->'years', '[]'::jsonb);
    if jsonb_typeof(pj) <> 'array' or jsonb_array_length(pj) > 40 then raise exception 'bad recall years'; end if;
    insert into public.recalls (campaign, car_model_id, years, component, summary, remedy, status, fetched_at)
    values (p.target_key, p.car_model_id,
            coalesce((select array_agg(least(greatest(y::int, 1900), 2100)) from jsonb_array_elements_text(pj) y), '{}'),
            comp, summ, nullif(left(btrim(coalesce(v->>'remedy', '')), 1000), ''), 'approved', now())
    on conflict (campaign, car_model_id) do update set
      years = excluded.years, component = excluded.component, summary = excluded.summary,
      remedy = excluded.remedy, status = 'approved', fetched_at = now();
    tbl := 'recalls';
  else
  pj := coalesce(v->'parts', '[]'::jsonb);
  if jsonb_typeof(pj) <> 'array' then raise exception 'parts must be an array'; end if;
  if jsonb_array_length(pj) > 50 then raise exception 'too many parts'; end if;
  for el in select value from jsonb_array_elements(pj) loop
    nm := btrim(left(coalesce(el->>'name', ''), 120));
    if nm <> '' then
      parts := parts || jsonb_build_array(jsonb_build_object('name', nm,
        'part_no', left(coalesce(el->>'part_no', ''), 60),
        'qty', least(greatest(coalesce((el->>'qty')::int, 1), 1), 99)));
    end if;
  end loop;

  -- Severe (D-10): a missing key keeps the live value; only an explicit key writes.
  sk := case when v ? 'severe_km' then (v->>'severe_km')::int else (live->>'severe_km')::int end;
  sm := case when v ? 'severe_months' then (v->>'severe_months')::int else (live->>'severe_months')::int end;
  src := p.evidence->0->>'url';
  insert into public.dealer_plan_items (car_model_id, service, interval_km, interval_months, severe_km, severe_months, note, parts, source_url)
  values (p.car_model_id, p.target_key,
          nullif(least(greatest((v->>'interval_km')::int, 0), 1000000), 0),
          nullif(least(greatest((v->>'interval_months')::int, 0), 240), 0),
          nullif(least(greatest(sk, 0), 1000000), 0),
          nullif(least(greatest(sm, 0), 240), 0),
          left(coalesce(v->>'note', ''), 300), parts, src)
  on conflict (car_model_id, service) do update set
    interval_km = excluded.interval_km, interval_months = excluded.interval_months,
    severe_km = excluded.severe_km, severe_months = excluded.severe_months,
    note = excluded.note, parts = excluded.parts, source_url = excluded.source_url;
  tbl := 'dealer_plan_items';
  end if;

  insert into public.change_log (kind, car_model_id, table_name, row_key, op, before, after, proposal_id)
  values (p.kind, p.car_model_id, tbl, p.target_key,
          case when live is null then 'insert' else 'update' end, live,
          public.proposal_live(p.kind, p.car_model_id, p.target_key), p.id)
  returning id into change_id;
  update public.proposals set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         edited_after = p_edit where id = p.id;
  return jsonb_build_object('ok', true, 'change_id', change_id);
end $$;
revoke execute on function public.apply_proposal(bigint, jsonb, text) from public, anon;
grant execute on function public.apply_proposal(bigint, jsonb, text) to authenticated;

-- Owner rejects a pending proposal (REV-05). after_hash and sources_hash stay
-- as stored: submit_proposal uses them to keep the same value out of the queue.
create or replace function public.reject_proposal(p_id bigint, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  perform 1 from public.proposals where id = p_id and status = 'pending' for update;
  if not found then raise exception 'no pending proposal'; end if;
  update public.proposals set status = 'rejected',
         reject_reason = nullif(left(coalesce(p_reason, ''), 300), ''),
         decided_by = auth.uid(), decided_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.reject_proposal(bigint, text) from public, anon;
grant execute on function public.reject_proposal(bigint, text) to authenticated;

-- Owner approves many proposals at once (REV-02). Top tier only; the server
-- re-checks pending + tier per id (the id list may come from an old view). The
-- plpgsql exception block is a savepoint, so one failing item rolls back alone.
create or replace function public.apply_proposals(p_ids bigint[], p_tier text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pid bigint; st text; tr text; res jsonb; out jsonb := '[]';
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_tier is distinct from 'high' then raise exception 'high tier only'; end if;
  if coalesce(array_length(p_ids, 1), 0) > 200 then raise exception 'too many'; end if;
  foreach pid in array coalesce(p_ids, '{}') loop
    select status, confidence_tier into st, tr from public.proposals where id = pid;
    if st is distinct from 'pending' or tr is distinct from p_tier then
      res := jsonb_build_object('ok', false, 'error', 'not_high');
    else
      begin
        res := public.apply_proposal(pid, null, null);
      exception when others then
        res := jsonb_build_object('ok', false, 'error', 'failed', 'detail', left(sqlerrm, 200));
      end;
    end if;
    out := out || jsonb_build_array(res || jsonb_build_object('id', pid));
  end loop;
  return out;
end $$;
revoke execute on function public.apply_proposals(bigint[], text) from public, anon;
grant execute on function public.apply_proposals(bigint[], text) to authenticated;

-- Owner undoes one change_log row (REV-06, CORE-05). Refuses with 'drifted' when
-- the live row no longer equals the change's after value (a newer change exists:
-- revert that first), so newer data is never clobbered. Rows are matched by
-- car + service, never by dealer_plan_items.id, so a delete can be re-inserted.
-- The revert is itself a change_log row (reverts_id), so it can be reverted too.
create or replace function public.revert_change(p_change_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.change_log; live jsonb; b jsonb; new_id bigint;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into c from public.change_log where id = p_change_id for update;
  if not found then raise exception 'no change'; end if;
  if c.kind not in ('schedule_item', 'recall') then raise exception 'unsupported kind'; end if;
  if c.kind = 'recall' then
    perform 1 from public.recalls where car_model_id = c.car_model_id and campaign = c.row_key for update;
  else
    perform 1 from public.dealer_plan_items where car_model_id = c.car_model_id and service = c.row_key for update;
  end if;
  live := public.proposal_live(c.kind, c.car_model_id, c.row_key);
  if live is distinct from c.after then
    return jsonb_build_object('ok', false, 'error', 'drifted', 'live', live);
  end if;
  b := c.before;
  if c.kind = 'recall' then
    if b is null then
      delete from public.recalls where car_model_id = c.car_model_id and campaign = c.row_key;
    else
      insert into public.recalls (campaign, car_model_id, years, component, summary, remedy, status)
      values (c.row_key, c.car_model_id,
              coalesce((select array_agg(y::int) from jsonb_array_elements_text(b->'years') y), '{}'),
              b->>'component', b->>'summary', b->>'remedy', b->>'status')
      on conflict (campaign, car_model_id) do update set
        years = excluded.years, component = excluded.component, summary = excluded.summary,
        remedy = excluded.remedy, status = excluded.status;
    end if;
  elsif b is null then
    delete from public.dealer_plan_items where car_model_id = c.car_model_id and service = c.row_key;
  else
    insert into public.dealer_plan_items (car_model_id, service, interval_km, interval_months, severe_km, severe_months, note, parts)
    values (c.car_model_id, c.row_key, (b->>'interval_km')::int, (b->>'interval_months')::int,
            (b->>'severe_km')::int, (b->>'severe_months')::int,
            coalesce(b->>'note', ''), coalesce(b->'parts', '[]'::jsonb))
    on conflict (car_model_id, service) do update set
      interval_km = excluded.interval_km, interval_months = excluded.interval_months,
      severe_km = excluded.severe_km, severe_months = excluded.severe_months,
      note = excluded.note, parts = excluded.parts;
  end if;
  insert into public.change_log (kind, car_model_id, table_name, row_key, op, before, after, proposal_id, reverts_id)
  values (c.kind, c.car_model_id, case c.kind when 'recall' then 'recalls' else 'dealer_plan_items' end, c.row_key,
          case when b is null then 'delete' when live is null then 'insert' else 'update' end,
          live, public.proposal_live(c.kind, c.car_model_id, c.row_key), c.proposal_id, p_change_id)
  returning id into new_id;
  return jsonb_build_object('ok', true, 'change_id', new_id);
end $$;
revoke execute on function public.revert_change(bigint) from public, anon;
grant execute on function public.revert_change(bigint) to authenticated;

-- ============================================================================
-- Monthly autopilot (Phase 3, ENG-01..ENG-08, REV-07, SCH-05)
-- Server-side state and rules for the autopilot: job queue, atomic spend cap and
-- kill switch, staged findings, publish, source domains, item status, monthly
-- cron. Cap, kill switch and no-partial-publish live here as race-free SQL, not
-- in worker code. Every table: RLS on, admin select, no write policy and no
-- table privilege beyond select (writes go through the RPCs below). Worker
-- functions are service_role only; admin RPCs check is_admin() inside.
-- Re-runnable.
-- ============================================================================

-- One-row settings (id is pinned to 1). Prices follow the shape logic.mjs costUsd reads:
-- models.<id> {in,out,cache_read,cache_write, optional tier_over/in_hi/out_hi} in USD per MTok.
-- cache_write rates are 1.25x input (assumed, not in the research table; owner-editable).
-- gcc_domains starts empty on purpose: the owner supplies hostnames (CORE-06, plan 03-08).
create table if not exists public.autopilot_config (
  id             int primary key default 1 check (id = 1),
  enabled        boolean not null default true,                          -- kill switch (D-14)
  monthly_cap_sar numeric not null default 40 check (monthly_cap_sar > 0), -- hard cap (D-01)
  usd_sar        numeric not null default 3.75 check (usd_sar > 0),
  prices         jsonb not null default '{}',
  gcc_domains    text[] not null default '{}',
  search_max_uses int not null default 3 check (search_max_uses between 0 and 10)
);
insert into public.autopilot_config (id, prices) values (1, jsonb_build_object(
  'search_per_call', 0.01,
  'models', jsonb_build_object(
    'claude-sonnet-5-5', jsonb_build_object('in', 2, 'out', 10, 'cache_read', 0.10, 'cache_write', 2.5),
    'claude-haiku-5-5', jsonb_build_object('in', 0.10, 'out', 0.50, 'cache_read', 0.01, 'cache_write', 0.125,
                                           'tier_over', 100000, 'in_hi', 0.50, 'out_hi', 2.50))))
  on conflict do nothing;

create table if not exists public.autopilot_runs (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('monthly', 'manual')),
  car_model_id text references public.car_models on delete set null,
  status       text not null default 'running' check (status in ('running', 'done', 'failed', 'capped', 'stopped')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  month        date not null default (date_trunc('month', now())::date),
  report       jsonb not null default '{}'
);

-- Proposals made by a run point back at it; deleting a run keeps the proposals.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'proposals_run_fk') then
    alter table public.proposals add constraint proposals_run_fk
      foreign key (run_id) references public.autopilot_runs (id) on delete set null;
  end if;
end $$;

create table if not exists public.autopilot_jobs (
  id           bigint generated always as identity primary key,
  run_id       bigint not null references public.autopilot_runs on delete cascade,
  car_model_id text references public.car_models on delete cascade,   -- null for the publish job
  stage        text not null check (stage in ('discover', 'extract', 'recalls', 'publish')),
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts     int not null default 0,
  last_error   text,
  run_after    timestamptz not null default now(),
  claimed_at   timestamptz,
  notes        jsonb       -- worker report input: {dropped:{reason:n}, skipped:[...], unchanged:bool}
);
create index if not exists autopilot_jobs_open on public.autopilot_jobs (run_id, status);

-- Ledger. A row is a reservation (cost_sar = the worst-case estimate) until
-- autopilot_settle replaces it with the actual cost. Month-to-date counts both.
create table if not exists public.autopilot_spend (
  id            bigint generated always as identity primary key,
  run_id        bigint references public.autopilot_runs on delete set null,
  status        text not null default 'reserved' check (status in ('reserved', 'settled')),
  model         text,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  searches      int not null default 0,
  reserved_sar  numeric not null default 0,
  cost_usd      numeric not null default 0,
  cost_sar      numeric not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists autopilot_spend_created on public.autopilot_spend (created_at);

-- Staging only (D-02): published by autopilot_publish_run or discarded with the run.
create table if not exists public.autopilot_findings (
  id           bigint generated always as identity primary key,
  run_id       bigint not null references public.autopilot_runs on delete cascade,
  car_model_id text not null references public.car_models on delete cascade,
  kind         text not null check (kind in ('schedule_item', 'recall')),
  target_key   text not null check (char_length(target_key) between 1 and 120),
  after        jsonb not null,
  evidence     jsonb not null,
  reason       text not null default '',
  verified     boolean not null default true   -- quote-checked against the fetched source (SCH-05)
);
create unique index if not exists autopilot_findings_key
  on public.autopilot_findings (run_id, car_model_id, kind, target_key);

create table if not exists public.source_domains (
  host       text primary key check (host = lower(host) and char_length(host) between 1 and 253),
  status     text not null default 'pending' check (status in ('pending', 'approved', 'banned')),
  first_seen timestamptz not null default now(),
  decided_at timestamptz
);

-- Separate from legacy schedule_sources so plan-intake is untouched. Read and
-- written only through autopilot_get/set_source_hash.
create table if not exists public.autopilot_sources (
  car_model_id    text not null references public.car_models on delete cascade,
  url             text not null,
  host            text not null,
  content_hash    text not null,
  last_fetched_at timestamptz not null default now(),
  primary key (car_model_id, url)
);

create table if not exists public.autopilot_item_status (
  car_model_id     text not null references public.car_models on delete cascade,
  kind             text not null default 'schedule_item',
  target_key       text not null,
  last_verified_at timestamptz,
  last_verified_run bigint references public.autopilot_runs on delete set null,
  missed_runs      int not null default 0,
  unverified       boolean generated always as (missed_runs >= 2) stored,   -- D-16
  primary key (car_model_id, kind, target_key)
);

alter table public.autopilot_config enable row level security;
alter table public.autopilot_runs enable row level security;
alter table public.autopilot_jobs enable row level security;
alter table public.autopilot_spend enable row level security;
alter table public.autopilot_findings enable row level security;
alter table public.source_domains enable row level security;
alter table public.autopilot_sources enable row level security;
alter table public.autopilot_item_status enable row level security;
revoke all on public.autopilot_config, public.autopilot_runs, public.autopilot_jobs, public.autopilot_spend,
  public.autopilot_findings, public.source_domains, public.autopilot_sources, public.autopilot_item_status
  from anon, authenticated;
grant select on public.autopilot_config, public.autopilot_runs, public.autopilot_jobs, public.autopilot_spend,
  public.autopilot_findings, public.source_domains, public.autopilot_sources, public.autopilot_item_status
  to authenticated;
drop policy if exists admin_read_autopilot_config on public.autopilot_config;
create policy admin_read_autopilot_config on public.autopilot_config for select to authenticated using (public.is_admin());
drop policy if exists admin_read_autopilot_runs on public.autopilot_runs;
create policy admin_read_autopilot_runs on public.autopilot_runs for select to authenticated using (public.is_admin());
drop policy if exists admin_read_autopilot_jobs on public.autopilot_jobs;
create policy admin_read_autopilot_jobs on public.autopilot_jobs for select to authenticated using (public.is_admin());
drop policy if exists admin_read_autopilot_spend on public.autopilot_spend;
create policy admin_read_autopilot_spend on public.autopilot_spend for select to authenticated using (public.is_admin());
drop policy if exists admin_read_autopilot_findings on public.autopilot_findings;
create policy admin_read_autopilot_findings on public.autopilot_findings for select to authenticated using (public.is_admin());
drop policy if exists admin_read_source_domains on public.source_domains;
create policy admin_read_source_domains on public.source_domains for select to authenticated using (public.is_admin());
drop policy if exists admin_read_autopilot_sources on public.autopilot_sources;
create policy admin_read_autopilot_sources on public.autopilot_sources for select to authenticated using (public.is_admin());
drop policy if exists admin_read_autopilot_item_status on public.autopilot_item_status;
create policy admin_read_autopilot_item_status on public.autopilot_item_status for select to authenticated using (public.is_admin());

-- ---- cost math (mirrors costUsd in functions/autopilot/logic.mjs; unknown model or class => raise) ----
create or replace function public.autopilot_bill(n numeric, rate text, cls text) returns numeric
language plpgsql immutable as $$
begin
  if n > 0 and rate is null then raise exception 'unpriced token class: %', cls; end if;
  return case when n > 0 then n * rate::numeric else 0 end;
end $$;

create or replace function public.autopilot_cost_usd(p_model text, p_usage jsonb, p_prices jsonb) returns numeric
language plpgsql immutable as $$
declare p jsonb := p_prices->'models'->p_model; i numeric := coalesce((p_usage->>'input_tokens')::numeric, 0);
        o numeric := coalesce((p_usage->>'output_tokens')::numeric, 0);
        cr numeric := coalesce((p_usage->>'cache_read_input_tokens')::numeric, 0);
        cw numeric := coalesce((p_usage->>'cache_creation_input_tokens')::numeric, 0);
        s numeric := coalesce((p_usage->'server_tool_use'->>'web_search_requests')::numeric, 0); hi boolean;
begin
  if p is null then raise exception 'unpriced model'; end if;
  hi := p ? 'tier_over' and (i + cr + cw) > (p->>'tier_over')::numeric;
  return (public.autopilot_bill(i, case when hi then p->>'in_hi' else p->>'in' end, 'input')
        + public.autopilot_bill(o, case when hi then p->>'out_hi' else p->>'out' end, 'output')
        + public.autopilot_bill(cr, p->>'cache_read', 'cache_read')
        + public.autopilot_bill(cw, p->>'cache_write', 'cache_write')) / 1000000
        + public.autopilot_bill(s, p_prices->>'search_per_call', 'web_search');
end $$;
revoke execute on function public.autopilot_bill(numeric, text, text) from public, anon, authenticated;
revoke execute on function public.autopilot_cost_usd(text, jsonb, jsonb) from public, anon, authenticated;

-- ---- cap + kill switch (ENG-03, ENG-04, D-14) ----
-- Called before every paid call. The advisory lock makes check-and-reserve atomic
-- across workers; the kill switch is read inside the same call.
create or replace function public.autopilot_reserve(p_run bigint, p_est_sar numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.autopilot_config; used numeric; rid bigint;
begin
  if p_est_sar is null or p_est_sar < 0 then raise exception 'bad estimate'; end if;
  perform pg_advisory_xact_lock(hashtext('autopilot:spend'));
  select * into c from public.autopilot_config where id = 1;
  if not c.enabled then return jsonb_build_object('ok', false, 'reason', 'killed'); end if;
  if not exists (select 1 from public.autopilot_runs where id = p_run and status = 'running') then
    return jsonb_build_object('ok', false, 'reason', 'run_ended'); end if;
  select coalesce(sum(cost_sar), 0) into used from public.autopilot_spend
    where created_at >= date_trunc('month', now());
  if used + p_est_sar > c.monthly_cap_sar then
    return jsonb_build_object('ok', false, 'reason', 'cap', 'used_sar', used); end if;
  insert into public.autopilot_spend (run_id, status, reserved_sar, cost_sar)
    values (p_run, 'reserved', p_est_sar, p_est_sar) returning id into rid;
  return jsonb_build_object('ok', true, 'reservation_id', rid);
end $$;

-- Replaces the estimate with the actual cost. over=true means the call cost more than
-- reserved: the worker must stop the run. Unknown model raises (fail closed).
create or replace function public.autopilot_settle(p_reservation bigint, p_model text, p_usage jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.autopilot_config; r public.autopilot_spend; usd numeric; sar numeric;
begin
  perform pg_advisory_xact_lock(hashtext('autopilot:spend'));
  select * into c from public.autopilot_config where id = 1;
  select * into r from public.autopilot_spend where id = p_reservation for update;
  if not found or r.status <> 'reserved' then raise exception 'no open reservation'; end if;
  usd := public.autopilot_cost_usd(p_model, p_usage, c.prices);
  sar := usd * c.usd_sar;
  update public.autopilot_spend set status = 'settled', model = p_model,
    input_tokens = coalesce((p_usage->>'input_tokens')::bigint, 0),
    output_tokens = coalesce((p_usage->>'output_tokens')::bigint, 0),
    cache_read_tokens = coalesce((p_usage->>'cache_read_input_tokens')::bigint, 0),
    searches = coalesce((p_usage->'server_tool_use'->>'web_search_requests')::int, 0),
    cost_usd = usd, cost_sar = sar where id = p_reservation;
  return jsonb_build_object('ok', true, 'sar', sar, 'over', sar > r.reserved_sar);
end $$;

create or replace function public.autopilot_set_enabled(p_enabled boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.autopilot_config set enabled = coalesce(p_enabled, false) where id = 1;
  return coalesce(p_enabled, false);
end $$;
revoke execute on function public.autopilot_set_enabled(boolean) from public, anon;
grant execute on function public.autopilot_set_enabled(boolean) to authenticated;

-- ---- run / job queue (ENG-01, ENG-02, D-13) ----
-- One discover/extract/recalls job per approved car (or the one car) plus one publish job.
-- A monthly run refuses to start while one is still running this month.
create or replace function public.autopilot_start_run(p_kind text, p_car text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid bigint; n int;
begin
  if p_kind not in ('monthly', 'manual') then raise exception 'bad kind'; end if;
  if p_kind = 'monthly' and p_car is not null then raise exception 'monthly runs cover every car'; end if;
  if p_kind = 'manual' and not exists (select 1 from public.car_models where id = p_car and status = 'approved') then
    raise exception 'unknown car'; end if;
  perform pg_advisory_xact_lock(hashtext('autopilot:start'));
  if p_kind = 'monthly' and exists (select 1 from public.autopilot_runs
       where kind = 'monthly' and status = 'running' and month = date_trunc('month', now())::date) then
    return jsonb_build_object('ok', false, 'reason', 'running'); end if;
  insert into public.autopilot_runs (kind, car_model_id) values (p_kind, p_car) returning id into rid;
  insert into public.autopilot_jobs (run_id, car_model_id, stage)
    select rid, c.id, s.stage from public.car_models c
      cross join (values ('discover', 1), ('extract', 2), ('recalls', 3)) s(stage, ord)
     where c.status = 'approved' and (p_car is null or c.id = p_car)
     order by c.id, s.ord;
  get diagnostics n = row_count;
  insert into public.autopilot_jobs (run_id, stage) values (rid, 'publish');
  return jsonb_build_object('ok', true, 'run_id', rid, 'jobs', n + 1);
end $$;

-- Internal: a publish job that cannot finish ends the run failed with nothing published.
create or replace function public.autopilot_abort_run(p_run bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.autopilot_runs set status = 'failed', finished_at = now(),
    report = public.autopilot_build_report(p_run, '{}'::jsonb) where id = p_run and status = 'running';
  delete from public.autopilot_findings where run_id = p_run;
end $$;

-- Returns the claimed job row (json) or null. publish waits for every other job of its
-- run; extract waits for its car's discover (so a discover retry is not overtaken).
-- p_run (optional) limits the claim to one run: a manual Check-now request drains only its own car's
-- jobs, not the monthly queue, which the cron poke handles. The zero-arg version is dropped first,
-- since a second overload would make the no-argument cron call ambiguous.
drop function if exists public.autopilot_claim_job();
create or replace function public.autopilot_claim_job(p_run bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.autopilot_jobs; dead bigint[]; rid bigint;
begin
  -- Reclaim jobs whose worker died. A reclaim counts as a failed attempt so a job that
  -- keeps killing its worker still ends failed after 3.
  with u as (
    update public.autopilot_jobs set attempts = attempts + 1,
      status = case when attempts + 1 >= 3 then 'failed' else 'queued' end,
      last_error = 'stale: worker lost', claimed_at = null
     where status = 'running' and claimed_at < now() - interval '3 minutes'
    returning run_id, stage, status)
  select array_agg(run_id) into dead from u where stage = 'publish' and status = 'failed';
  foreach rid in array coalesce(dead, '{}') loop perform public.autopilot_abort_run(rid); end loop;

  select q.* into j from public.autopilot_jobs q
   where q.status = 'queued' and q.run_after <= now()
     and (p_run is null or q.run_id = p_run)
     and exists (select 1 from public.autopilot_runs r where r.id = q.run_id and r.status = 'running')
     and (q.stage <> 'publish' or not exists (select 1 from public.autopilot_jobs o
            where o.run_id = q.run_id and o.id <> q.id and o.status in ('queued', 'running')))
     and (q.stage <> 'extract' or not exists (select 1 from public.autopilot_jobs d
            where d.run_id = q.run_id and d.car_model_id = q.car_model_id and d.stage = 'discover'
              and d.status in ('queued', 'running')))
   order by q.id for update of q skip locked limit 1;
  if not found then return null; end if;
  update public.autopilot_jobs set status = 'running', claimed_at = now() where id = j.id returning * into j;
  return to_jsonb(j);
end $$;

-- ok -> done. Failure -> attempts + 1; under 3 requeue with backoff (2, 4 min), at 3 failed (D-13).
create or replace function public.autopilot_finish_job(p_id bigint, p_ok boolean, p_err text default null, p_notes jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.autopilot_jobs; att int;
begin
  select * into j from public.autopilot_jobs where id = p_id for update;
  if not found then raise exception 'unknown job'; end if;
  if j.status <> 'running' then return jsonb_build_object('ok', false, 'reason', 'not_running'); end if;
  if p_ok then
    update public.autopilot_jobs set status = 'done', last_error = null, claimed_at = null,
      notes = coalesce(p_notes, notes) where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'done');
  end if;
  att := j.attempts + 1;
  update public.autopilot_jobs set attempts = att, claimed_at = null, last_error = left(coalesce(p_err, ''), 500),
    notes = coalesce(p_notes, notes),
    status = case when att >= 3 then 'failed' else 'queued' end,
    run_after = case when att >= 3 then run_after else now() + interval '1 minute' * power(2, att) end
   where id = p_id;
  if att >= 3 and j.stage = 'publish' then perform public.autopilot_abort_run(j.run_id); end if;
  return jsonb_build_object('ok', true, 'status', case when att >= 3 then 'failed' else 'queued' end, 'attempts', att);
end $$;

-- Cap or kill switch hit (D-02): drop the run's staged findings, skip what is left, publish nothing.
create or replace function public.autopilot_end_run(p_run bigint, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('capped', 'stopped') then raise exception 'bad status'; end if;
  update public.autopilot_runs set status = p_status, finished_at = now() where id = p_run and status = 'running';
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_running'); end if;
  delete from public.autopilot_findings where run_id = p_run;
  update public.autopilot_jobs set status = 'failed', claimed_at = null, last_error = 'skipped: run ' || p_status
   where run_id = p_run and status in ('queued', 'running');
  update public.autopilot_runs set report = public.autopilot_build_report(p_run, '{}'::jsonb) where id = p_run;
  return jsonb_build_object('ok', true);
end $$;

-- Idempotent stage: replaces this (run, car, kind)'s findings with the batch.
-- rows: [{target_key, after, evidence, reason?, verified?}]
create or replace function public.autopilot_stage_findings(p_run bigint, p_car text, p_kind text, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_kind not in ('schedule_item', 'recall') then raise exception 'unsupported kind'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  if not exists (select 1 from public.autopilot_runs where id = p_run and status = 'running') then
    raise exception 'run not running'; end if;
  delete from public.autopilot_findings where run_id = p_run and car_model_id = p_car and kind = p_kind;
  insert into public.autopilot_findings (run_id, car_model_id, kind, target_key, after, evidence, reason, verified)
    select p_run, p_car, p_kind, x.target_key, x.after, x.evidence, left(coalesce(x.reason, ''), 300), coalesce(x.verified, true)
      from jsonb_to_recordset(p_rows) as x(target_key text, after jsonb, evidence jsonb, reason text, verified boolean);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---- change detection hashes (ENG-08) ----
create or replace function public.autopilot_get_source_hash(p_car text, p_url text) returns text
language sql security definer set search_path = public as $$
  select content_hash from public.autopilot_sources where car_model_id = p_car and url = p_url
$$;
create or replace function public.autopilot_set_source_hash(p_car text, p_url text, p_hash text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_url !~ '^https://[^/]+' or coalesce(p_hash, '') = '' then raise exception 'bad source'; end if;
  insert into public.autopilot_sources (car_model_id, url, host, content_hash)
    values (p_car, p_url, lower(substring(p_url from '^https://([^/:?#]+)')), p_hash)
  on conflict (car_model_id, url) do update set content_hash = excluded.content_hash, last_fetched_at = now();
end $$;

-- ---- source domains (ENG-06, D-07, D-08) ----
-- Unseen host -> stored pending (held for the owner). A subdomain of a banned host is banned.
create or replace function public.autopilot_see_domain(p_host text) returns text
language plpgsql security definer set search_path = public as $$
declare h text := lower(btrim(coalesce(p_host, ''))); st text;
begin
  if h !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' or char_length(h) > 253 then raise exception 'bad host'; end if;
  if exists (select 1 from public.source_domains where status = 'banned' and (h = host or h like '%.' || host)) then
    return 'banned'; end if;
  insert into public.source_domains (host) values (h) on conflict do nothing;
  select status into st from public.source_domains where host = h;
  return st;
end $$;

-- Host of an evidence url, parsed the way the fetch parses it: no userinfo, no port, no trailing dot.
create or replace function public.evidence_host(p_url text) returns text
language sql immutable as $$
  select nullif(rtrim(lower(regexp_replace(
           regexp_replace(substring(p_url from '^https://([^/?#]+)'), '^.*@', ''),
           ':[0-9]*$', '')), '.'), '')
$$;

-- Fail closed: unparseable, backslashed or userinfo urls count as banned.
-- Otherwise banned when the host or any parent domain is banned.
create or replace function public.host_banned(p_url text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare h text := public.evidence_host(p_url);
begin
  -- strict ASCII host grammar: fullwidth or otherwise non-canonical hosts are fetched as their
  -- IDNA form but would not string-match a ban, so they fail closed
  if h is null or h !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' or char_length(h) > 253
     or strpos(p_url, chr(92)) > 0 or substring(p_url from '^https://([^/?#]+)') like '%@%' then
    return true; end if;
  return exists (select 1 from public.source_domains d
                  where d.status = 'banned' and (h = d.host or h like '%.' || d.host));
end $$;
revoke execute on function public.host_banned(text) from public, anon, authenticated;

-- Permanent (D-08). Rejects pending proposals with any evidence url on the host or a subdomain,
-- and drops staged findings of running runs that cite it (publish would otherwise re-submit them).
create or replace function public.ban_source_domain(p_host text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h text := lower(btrim(coalesce(p_host, ''))); n int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if h !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' or char_length(h) > 253 then raise exception 'bad host'; end if;
  insert into public.source_domains (host, status, decided_at) values (h, 'banned', now())
    on conflict (host) do update set status = 'banned', decided_at = now();
  update public.proposals p set status = 'rejected', reject_reason = 'banned source',
         decided_by = auth.uid(), decided_at = now()
   where p.status = 'pending' and exists (
     select 1 from jsonb_array_elements(p.evidence) e
      where public.evidence_host(e->>'url') = h
         or public.evidence_host(e->>'url') like '%.' || h);
  get diagnostics n = row_count;
  delete from public.autopilot_findings f using public.autopilot_runs r
   where f.run_id = r.id and r.status = 'running' and exists (
     select 1 from jsonb_array_elements(f.evidence) e
      where public.evidence_host(e->>'url') = h
         or public.evidence_host(e->>'url') like '%.' || h);
  return jsonb_build_object('ok', true, 'rejected', n);
end $$;
revoke execute on function public.ban_source_domain(text) from public, anon;
grant execute on function public.ban_source_domain(text) to authenticated;

create or replace function public.approve_source_domain(p_host text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h text := lower(btrim(coalesce(p_host, '')));
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if h !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' or char_length(h) > 253 then raise exception 'bad host'; end if;
  if exists (select 1 from public.source_domains where host = h and status = 'banned') then
    raise exception 'banned is permanent'; end if;
  insert into public.source_domains (host, status, decided_at) values (h, 'approved', now())
    on conflict (host) do update set status = 'approved', decided_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.approve_source_domain(text) from public, anon;
grant execute on function public.approve_source_domain(text) to authenticated;

-- ---- report (REV-07) + publish (ENG-03, D-02) ----
create or replace function public.autopilot_build_report(p_run bigint, p_counts jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'proposals', p_counts,
    'cost_sar', coalesce((select round(sum(cost_sar), 4) from public.autopilot_spend where run_id = p_run), 0),
    'searches', coalesce((select sum(searches) from public.autopilot_spend where run_id = p_run), 0),
    'llm_calls', (select count(*) from public.autopilot_spend where run_id = p_run and status = 'settled'),
    'dropped', coalesce((select jsonb_object_agg(k, s) from (
        select e.key k, sum((e.value #>> '{}')::numeric) s
          from public.autopilot_jobs j,
               jsonb_each(case when jsonb_typeof(j.notes->'dropped') = 'object' then j.notes->'dropped' else '{}'::jsonb end) e
         where j.run_id = p_run group by e.key) d), '{}'::jsonb),
    'skipped_sources', coalesce((select jsonb_agg(v) from public.autopilot_jobs j,
        jsonb_array_elements(case when jsonb_typeof(j.notes->'skipped') = 'array' then j.notes->'skipped' else '[]'::jsonb end) v
        where j.run_id = p_run), '[]'::jsonb),
    'failed_jobs', coalesce((select jsonb_agg(jsonb_build_object('car', car_model_id, 'stage', stage,
        'error', left(coalesce(last_error, ''), 200))) from public.autopilot_jobs
        where run_id = p_run and status = 'failed'), '[]'::jsonb))
$$;
revoke execute on function public.autopilot_build_report(bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.autopilot_abort_run(bigint) from public, anon, authenticated;

-- Publishes only a run that is still running (a capped or killed run was ended and its
-- findings deleted) and has no open job besides this one. One submit_proposal per
-- finding; a finding that raises is counted as 'error' and skipped, the rest go on.
-- Item status (SCH-05) moves only for monthly runs (D-15, D-16); manual runs leave it alone.
-- A car whose extract job reported notes.unchanged (every source hash matched) is neither
-- verified nor missed this month.
create or replace function public.autopilot_publish_run(p_run bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.autopilot_runs; f public.autopilot_findings; act text; counts jsonb := '{}'; st text; rep jsonb;
begin
  select * into r from public.autopilot_runs where id = p_run for update;
  if not found then raise exception 'unknown run'; end if;
  if r.status <> 'running' then return jsonb_build_object('ok', false, 'reason', 'not_running'); end if;
  if exists (select 1 from public.autopilot_jobs where run_id = p_run and stage <> 'publish' and status in ('queued', 'running')) then
    return jsonb_build_object('ok', false, 'reason', 'jobs_pending'); end if;

  for f in select * from public.autopilot_findings where run_id = p_run order by id loop
    -- a source banned after staging must not reach the queue (TOCTOU with ban_source_domain)
    if exists (select 1 from jsonb_array_elements(f.evidence) e where public.host_banned(e->>'url')) then
      act := 'banned';
    else
      begin
        act := public.submit_proposal(f.kind, f.car_model_id, f.target_key, f.after, f.evidence, p_run, f.reason)->>'action';
      exception when others then
        act := 'error';   -- the block is a savepoint: only this finding rolls back
      end;
    end if;
    counts := counts || jsonb_build_object(f.kind, coalesce(counts->f.kind, '{}'::jsonb));
    counts := jsonb_set(counts, array[f.kind, act], to_jsonb(coalesce((counts #>> array[f.kind, act])::int, 0) + 1));
    -- noop / duplicate / suppressed all mean the source value was seen and checked: verified.
    if r.kind = 'monthly' and f.kind = 'schedule_item' and f.verified and act not in ('error', 'banned') then
      insert into public.autopilot_item_status (car_model_id, kind, target_key, last_verified_at, last_verified_run, missed_runs)
        values (f.car_model_id, f.kind, f.target_key, now(), p_run, 0)
      on conflict (car_model_id, kind, target_key) do update
        set last_verified_at = now(), last_verified_run = p_run, missed_runs = 0;
    end if;
  end loop;

  if r.kind = 'monthly' then
    insert into public.autopilot_item_status (car_model_id, kind, target_key, missed_runs)
      select i.car_model_id, 'schedule_item', i.service, 1 from public.dealer_plan_items i
       where exists (select 1 from public.autopilot_jobs j where j.run_id = p_run and j.car_model_id = i.car_model_id
                       and j.stage = 'extract' and j.status = 'done' and coalesce(j.notes->>'unchanged', 'false') <> 'true')
         and not exists (select 1 from public.autopilot_item_status s where s.car_model_id = i.car_model_id
                           and s.kind = 'schedule_item' and s.target_key = i.service and s.last_verified_run = p_run)
    on conflict (car_model_id, kind, target_key) do update
      set missed_runs = public.autopilot_item_status.missed_runs + 1;
  end if;

  st := case when exists (select 1 from public.autopilot_jobs where run_id = p_run and stage <> 'publish' and status = 'failed')
             then 'failed' else 'done' end;
  rep := public.autopilot_build_report(p_run, counts);
  update public.autopilot_runs set status = st, finished_at = now(), report = rep where id = p_run;
  delete from public.autopilot_findings where run_id = p_run;
  return jsonb_build_object('ok', true, 'status', st, 'report', rep);
end $$;

-- Worker functions: service_role only (V4).
revoke execute on function public.autopilot_reserve(bigint, numeric) from public, anon, authenticated;
grant execute on function public.autopilot_reserve(bigint, numeric) to service_role;
revoke execute on function public.autopilot_settle(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.autopilot_settle(bigint, text, jsonb) to service_role;
revoke execute on function public.autopilot_start_run(text, text) from public, anon, authenticated;
grant execute on function public.autopilot_start_run(text, text) to service_role;
revoke execute on function public.autopilot_claim_job(bigint) from public, anon, authenticated;
grant execute on function public.autopilot_claim_job(bigint) to service_role;
revoke execute on function public.autopilot_finish_job(bigint, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.autopilot_finish_job(bigint, boolean, text, jsonb) to service_role;
revoke execute on function public.autopilot_end_run(bigint, text) from public, anon, authenticated;
grant execute on function public.autopilot_end_run(bigint, text) to service_role;
revoke execute on function public.autopilot_stage_findings(bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.autopilot_stage_findings(bigint, text, text, jsonb) to service_role;
revoke execute on function public.autopilot_get_source_hash(text, text) from public, anon, authenticated;
grant execute on function public.autopilot_get_source_hash(text, text) to service_role;
revoke execute on function public.autopilot_set_source_hash(text, text, text) from public, anon, authenticated;
grant execute on function public.autopilot_set_source_hash(text, text, text) to service_role;
revoke execute on function public.autopilot_see_domain(text) from public, anon, authenticated;
grant execute on function public.autopilot_see_domain(text) to service_role;
revoke execute on function public.autopilot_publish_run(bigint) from public, anon, authenticated;
grant execute on function public.autopilot_publish_run(bigint) to service_role;

-- ---- schedules (ENG-01, ENG-02) ----
-- Monthly run at 03:00 on the 1st; the work poke every 5 minutes only fires while jobs
-- are open. Skipped where pg_cron / pg_net are unavailable (e.g. CI), like app-errors-retention.
-- No secret is committed: set the target once per project, outside git:
--   alter database postgres set app.autopilot_url = 'https://<ref>.functions.supabase.co/autopilot';
--   alter database postgres set app.autopilot_secret = '<same value as the INTAKE_CRON_SECRET function secret>';
-- (Supabase Vault is the upgrade path; same exposure class as the plan-intake cron.)
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'autopilot-monthly') then
      perform cron.unschedule('autopilot-monthly');
    end if;
    perform cron.schedule('autopilot-monthly', '0 3 1 * *', $job$select public.autopilot_start_run('monthly', null)$job$);
    if exists (select 1 from pg_available_extensions where name = 'pg_net') then
      create extension if not exists pg_net;
      if exists (select 1 from cron.job where jobname = 'autopilot-work') then
        perform cron.unschedule('autopilot-work');
      end if;
      perform cron.schedule('autopilot-work', '*/5 * * * *', $job$
        select net.http_post(url := current_setting('app.autopilot_url', true),
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', current_setting('app.autopilot_secret', true)),
          body := '{"action":"work"}'::jsonb)
         where coalesce(current_setting('app.autopilot_url', true), '') <> ''
           and exists (select 1 from public.autopilot_jobs where status in ('queued', 'running'))$job$);
    end if;
  end if;
end $$;
