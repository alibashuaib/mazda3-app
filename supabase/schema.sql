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
alter table public.shops add column if not exists created_by uuid references auth.users on delete set null;

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
  if auth.uid() is null then raise exception 'sign in to add a shop'; end if;
  new.created_by := auth.uid();
  new.created_at := now();
  new.name_norm := public.shop_norm(new.name);
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
grant select (id, name, name_norm, city, area, created_at) on public.shops to authenticated;
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

-- Owner-run (not security_invoker): shop_feedback is own-rows-only under RLS, so
-- the aggregate must bypass it. Safe because the view only emits shops with >= 5
-- voters and exposes counts, never user ids. One row per user per shop, so
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
                    from shop_feedback f2, unnest(f2.reasons) as r
                   where f2.shop_id = f.shop_id and f2.vote = 1
                   group by r order by cnt desc limit 2) x) as top_reasons
  from shop_feedback f
  group by f.shop_id
  having count(*) >= 5;

create or replace view public.store_prices as
  select c.model_id, c.item_key, c.shop_id, s.name as shop_name, s.city, s.area,
         (percentile_cont(0.5) within group (order by c.price))::numeric(10,2) as median_price,
         count(*) as n
  from contributions c
  join contribution_links l on l.contribution_id = c.id
  join shops s on s.id = c.shop_id
  where c.kind = 'part' and c.price is not null
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
                                 price_per_l, item_key, brand, part_no, price, km_since_prev, shop_id)
      values (r->>'kind', r->>'model_id', r->>'engine', (r->>'odometer_band')::int,
              r->>'month', (r->>'l100')::numeric, (r->>'price_per_l')::numeric,
              r->>'item_key', r->>'brand', r->>'part_no', (r->>'price')::numeric,
              (r->>'km_since_prev')::int, (r->>'shop_id')::uuid)
      returning id into cid;
      insert into contribution_links (user_id, source_key, contribution_id)
        values (auth.uid(), r->>'source_key', cid);
    else
      update contributions set
        engine = r->>'engine', odometer_band = (r->>'odometer_band')::int, month = r->>'month',
        l100 = (r->>'l100')::numeric, price_per_l = (r->>'price_per_l')::numeric,
        brand = r->>'brand', part_no = r->>'part_no', price = (r->>'price')::numeric,
        km_since_prev = (r->>'km_since_prev')::int,
        shop_id = (r->>'shop_id')::uuid
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
  where c.kind = 'part' and c.km_since_prev is not null and c.price is not null
  group by c.model_id, c.item_key, c.brand
  having count(distinct l.user_id) >= 5;

grant select on public.fuel_stats, public.brand_life to authenticated;

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

-- Supabase default privileges may auto-grant on new public objects; strip them.
revoke all on public.contributions, public.contribution_links from anon, authenticated;
revoke all on public.fuel_stats, public.brand_life from anon;
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
