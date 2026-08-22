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
