# Crowdsourced price averages

**Date:** 2026-09-10
**Status:** Approved design, pending implementation plan
**Depends on:** `2026-08-22-phase-4b-sync-design.md` (auth + Supabase client already
wired through `src/data/account.js`), and a live Supabase project — see
`2026-08-22-phase-4b-sync-design.md`'s open item: `SUPABASE_URL`/`SUPABASE_ANON_KEY` in
`account.js` are still the `'REPLACE_ME'` placeholder.

## Summary

Users want to see what other people actually paid for a part or a job (starting with the
motivating case: a car paint job, which isn't in the static catalog at all), not just the
fixed reference prices already hardcoded in `src/data/catalog.js`. This adds a second,
public Supabase table pair — separate from the private per-user `vehicles`/`garage`
tables Phase 4a/4b built — plus a shared, user-extensible list of "priceable items" so
free-text entries ("car paint", "brake pads") don't fragment into a dozen near-duplicate
buckets.

**This phase ends when:** a signed-in user can pick a shared item (or add a new one),
submit what they paid, and see the community average and sample count for that item on
the Parts page and in Add Spending.

## Decisions

### A shared canonical item list, not fuzzy text matching

The tempting shortcut is to let people type free text and bucket similar strings
together server-side (Postgres `pg_trgm` similarity, or client-side normalization).
Rejected: fuzzy matching drifts — typos split buckets, unrelated short labels collide —
and it needs ongoing tuning that doesn't fit this app's "no build step, small surface"
shape.

Instead, `price_items` is a single shared, append-only list. Submitting a price means
*picking* an item from that list (same UX shape as the existing catalog part picker), and
only typing a new label when nothing already fits — which then becomes the canonical
entry everyone after you reuses. This pushes the "headache" to a one-time human decision
at entry time instead of an ongoing server-side matching problem.

### Two tables, not one

`price_items` (the shared catalog of what can be priced) and `price_observations` (each
person's price for one of those items) are kept separate rather than one denormalized
table, because they have different write patterns and different RLS:

- `price_items` rows are rare (created once, reused indefinitely) and must never be
  edited out from under other users' observations — no update/delete policy at all.
- `price_observations` rows are frequent, one per submission, and each belongs to exactly
  one user who may correct or withdraw their own later.

### SAR only

No currency field. Every other price in this app (`catalog.js` prices, `budget.js`
spending) is already implicitly SAR; adding multi-currency here would be the only place
in the codebase that needs it, for no current user.

### No outbox — this does not reuse the Phase 4b sync engine

Phase 4b's outbox/tombstone/incremental-pull machinery exists to reconcile one user's
*own* data written from multiple devices while offline. Price observations are a
different shape entirely: append-only writes to a table shared by everyone, with no
per-device conflict to resolve. Submitting a price requires being online and signed in —
the same gate already used for the rest of the account surface — and simply fails
(inline error, same pattern as the auth form) if the write doesn't go through. No queue.

### Plain SQL view for the average, not a materialized/cached one

At the scale this app operates at (a personal/small-community tool, not a high-traffic
product), `avg(price)` computed live in a view is fast enough and always correct. No
outlier trimming or weighting in v1 — YAGNI until the data actually shows it's needed.

### Immutable items, no moderation

`price_items` has no update/delete policy, and there's no report/flag/rate-limit
mechanism on `price_observations` in v1. The trust model for now is the same as the rest
of the account system: RLS scoped to `auth.uid()` is the whole security boundary, and
abuse handling is deferred until it's a real problem, not a speculative one.

## Data model

```sql
create table if not exists public.price_items (
  id          uuid        primary key default gen_random_uuid(),
  label       text        not null,
  category    text        not null,   -- one of budget.js's spending categories
  source_part_no text,                -- optional back-link into catalog.js, if seeded from a catalog part
  created_by  uuid        not null default auth.uid() references auth.users,
  created_at  timestamptz not null default now()
);

create table if not exists public.price_observations (
  id           uuid        primary key default gen_random_uuid(),
  item_id      uuid        not null references public.price_items on delete cascade,
  user_id      uuid        not null default auth.uid() references auth.users on delete cascade,
  price        numeric     not null check (price > 0),
  submitted_at timestamptz not null default now()   -- server-authored, same trigger pattern as updated_at
);

create index if not exists price_observations_item_idx on public.price_observations (item_id);

create or replace view public.price_item_averages as
  select item_id, avg(price)::numeric(10,2) as avg_price, count(*) as sample_count
  from public.price_observations
  group by item_id;
```

RLS:

- `price_items`: `select` for any `authenticated` user; `insert` where `created_by =
  auth.uid()`; no `update`/`delete` policy (items are permanent once created).
- `price_observations`: `select` for any `authenticated` user (needed to compute the
  view); `insert`/`update`/`delete` where `user_id = auth.uid()` (you can only touch your
  own submitted price).
- `price_item_averages` is a view over `price_observations`, so it inherits that table's
  `select` policy — no separate grant needed beyond `select` on the view itself.

## App-side flow

1. **Picking/creating an item.** Wherever a price can be submitted (Parts page, Add
   Spending in `budget.js`), a search-select control lists `price_items`, seeded lazily —
   a catalog part gets its `price_items` row created on first submission against it
   (`source_part_no` set), not via a separate migration step. If nothing matches, the
   user types a label + picks a category and that becomes a new `price_items` row.
2. **Submitting a price.** Given a chosen `item_id`, insert one `price_observations` row.
   Requires sign-in and network; fails inline (no offline queue, see Decisions).
3. **Displaying the average.** Parts page shows `🌍 community avg: X SAR (n reports)`
   beneath a part's existing OEM/ALT reference prices once `sample_count > 0`. Add
   Spending shows the same line inline once an item is picked, as a reference while
   entering your own amount.

## Out of scope for v1

- Offline submission queue.
- Abuse/moderation tooling (rate limits, flagging, edit history).
- Outlier-resistant aggregation (trimmed mean, median) — plain `avg()` only.
- Multi-currency.
- Editing or deleting a `price_items` row (only observations are mutable, by their
  owner).

## Open dependency

This cannot be verified end-to-end until a live Supabase project exists and real
credentials are wired into `account.js` — the same blocker already tracked for the Phase
4b manual verification checklist. This schema can be written and applied to that project
in the same sitting as the Phase 4b schema, once it exists.
