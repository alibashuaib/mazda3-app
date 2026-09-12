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
