# Phase 4b — Sync engine

**Date:** 2026-08-22
**Status:** Approved design, pending implementation plan
**Narrows:** the Phase 4 section of `2026-08-10-garage-roadmap-design.md`
**Depends on:** `2026-08-20-phase-4a-accounts-design.md` (merged, `main`)

## Summary

Phase 4a ended at "sign in on a second device and see your garage" — a whole-vehicle push
on save, a full pull-and-replace on sign-in, no outbox, no incremental pulls, no
background worker, no photo upload. This phase closes those four gaps: photos leave the
device, a background worker keeps two open sessions in sync without a re-sign-in, and the
outbox becomes a real queue instead of a flat list of dirty ids.

**Phase 4b ends when two devices signed in on the same account, both left open, converge
on their own without either one re-authenticating.** A vehicle edited on one appears on
the other after both have been briefly online; a photo taken on one is viewable on the
other; a vehicle deleted on one disappears from the other.

## State of the code this builds on

Measured at `8a34734` (Phase 4a merged, including the `signIn()`-also-calls-`watchAuth()`
fix from re-review).

- `dirty()` / `markDirty()` / `clearDirty()` (`src/data/account.js:93-106`) — a flat array
  of vehicle ids in a `localStorage` key, drained only from `start()`.
- `onSaved()` — pushes immediately on a successful local write; on failure, marks dirty.
  No queueing of the write itself, so a push that fails mid-flight is retried whole, not
  resumed.
- `pull()` — always fetches every vehicle with `deleted_at is null`. No cursor. Called
  only from `start()` and `signIn()`, both of which feed a full `adopt()` (replace local
  wholesale) or `reconcile()` (ask the user).
- `pushTombstone()` — called directly and un-awaited from `app.js`'s delete path, not
  queued.
- Photos never cross the wire. `stripPhotos()` strips them from every push; pulled rows
  arrive with a `photoId` and no way to resolve it if the blob isn't already local
  (`session.js`'s `resolvePhotos()` quietly leaves `.photo` unset).
- `supabase/schema.sql` already has `updated_at` and `deleted_at` on `vehicles` — both
  are what an incremental cursor and tombstone consumption need. No table migration.

## Decisions

### The outbox is a new IndexedDB store, not a bigger localStorage list

`dirty()`'s job was "which vehicles need re-pushing", answerable with ids. Once photos
also need to be queued, an entry needs a kind and enough payload to act on later without
re-deriving it: `{ id, kind, vehicleId, photoId, createdAt }` in a new `outbox` object
store (`storage.js` gains it alongside `meta`/`vehicles`/`photos`, same as Phase 2 added
`photos`).

Rejected: extending the `localStorage` dirty list with a JSON blob per entry. It already
carries the risk of exceeding a sync `setItem` call's practical size once photo entries
are added, and `storage.js` already owns the machinery (`fake-indexeddb` in tests, the
`localStorage`-fallback duality) that a second ad hoc queue would have to reinvent.

### Save enqueues; it does not push

`session.js`'s `afterSave` hook (added in 4a, called through `env.afterSave` inside the
`_generation`-guarded success branch) now enqueues one `vehicle` entry and one `photo`
entry per photo slot that changed, rather than calling `account.onSaved()` synchronously.
`account.js` no longer intercepts the save path in real time — it only owns `drain()`.

This also folds `pushTombstone`'s un-awaited direct call into the same path:
`deleteVehicle()` enqueues a `tombstone` entry instead. One write path into the outbox,
one drain reads it back out, rather than two.

### Drain order: photos, then the vehicle, then tombstones

Per the roadmap's per-vehicle LWW: uploading a photo before the vehicle record that
references it means a partially-drained outbox never leaves a vehicle row pointing at a
photo the server doesn't have yet. Tombstones drain last within a batch — a vehicle
deleted immediately after being edited should still end up deleted, not resurrected by an
edit entry that happened to drain after it (entries drain in enqueue order otherwise;
tombstones are stable-sorted to the end of whatever's ready).

A failed entry is left in the outbox untouched — no backoff timer, no retry counter. The
next `drain()`, triggered by the next reconnect, tries it again. This matches 4a's existing
failure philosophy for `onSaved()` (silent, recoverable by the next opportunity) and adds
no new failure-mode surface.

### The worker triggers on `online`, plus the existing boot-time drain

`window.addEventListener('online', ...)` calls `drain()` then an incremental `pull()`.
This is additive to what 4a already does at `start()`/`signIn()` — boot-time drain-then-pull
is unchanged, reconnect is new. No polling timer, no visibility-change listener: the
roadmap's own architecture section says the server is never in the write path and this
app's connectivity gaps are petrol stations and workshops, not a backgrounded tab losing
sync silently for hours. Rejected for the reasons in the roadmap's non-goals: real-time
collaborative editing is explicitly out of scope, and a polling timer's only job would be
detecting a second device's edits sooner than the next natural reconnect — not needed for
a single-owner garage.

### Incremental pull is additive to, not a replacement for, sign-in's full adopt

Sign-in's `reconcile()`/`adopt()` answers "whose garage wins on a new device" and stays
exactly as 4a built it — full replace-or-merge, decided once, at sign-in. Incremental pull
answers a different question — "what changed on the server since I last checked, on a
device that already has this user's garage" — and only ever runs after that first
resolution, from `start()`'s existing pull or the new reconnect handler.

`meta` gains `lastPulledAt` (ISO string, alongside the existing `migratedAt`). Incremental
`pull()` filters `updated_at > lastPulledAt` and, unlike the sign-in pull, does **not**
filter out `deleted_at`s — a tombstone is exactly the thing an incremental pull exists to
carry. `lastPulledAt` advances to the pull's own timestamp, read once before applying the
batch, only after every row in the batch has been applied — an interruption mid-apply is
retried whole on the next pull rather than silently advancing past unapplied rows.

Applying a batch: a row with `deleted_at` set calls `deps.removeVehicle`; every other row
calls `deps.saveVehicle` through the same normalize/photo-resolve path `adopt()` already
uses. This is a second, smaller call site for that logic, not a new implementation of it —
a `applyPulledVehicle(row)` helper factors out what `adopt()`'s reduce body already does,
and both call it.

### Photos: uploaded through the outbox, pulled lazily on demand

**Upload.** A `photo` outbox entry uploads the IndexedDB `Blob` to Supabase Storage at
`{user_id}/{photoId}`, via the same vendored client. `stripPhotos()` stays — a vehicle
push still carries only `photoId` references, never blob data — but a photo now actually
exists on the server once its own outbox entry has drained.

**Download.** 4a's non-goal — "this degrades quietly with no code change" — is closed
here, but not by prefetching every photo referenced in a pull. A pulled vehicle's
`photoId`s are checked against the local `photos` store; any missing are fetched from
Storage and written in before `saveVehicle` runs, so `resolvePhotos()` finds them on the
very next render instead of leaving `.photo` unset. This applies to both the incremental
pull and, going forward, `adopt()`'s pull at sign-in — the same "photo may be referenced
but not local" gap exists there today, quietly, and this phase closes it in the one helper
both paths call.

Rejected: eagerly pulling every photo for every vehicle on every sync. A garage can carry
years of receipt photos; the point of lazy, on-demand fetch by reference is that a device
never downloads more than what a pulled vehicle row actually points at, and never fetches a
photo already sitting in its own `photos` store.

### Storage policy mirrors table RLS

```sql
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
  on conflict (id) do nothing;

create policy own_photos on storage.objects for all
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
```

Same shape as `own_vehicles`/`own_garage`: the boundary is Postgres/Storage policy, not
application code checking whose photo it is.

## Architecture

### Changed files

- `storage.js` — new `outbox` object store; `meta.lastPulledAt`.
- `src/data/session.js` — `afterSave` enqueues instead of calling `account.onSaved`
  directly; deletion enqueues a tombstone instead of `app.js` calling `pushTombstone`.
- `src/data/account.js` — `drain()` replaces `onSaved()`'s push-then-mark-dirty shape;
  incremental `pull()` alongside the existing sign-in pull; `applyPulledVehicle()` shared
  helper; photo upload/download; the `online` listener.
- `supabase/schema.sql` — the `photos` bucket and its policy. No table changes.
- `index.html`, `sw.js` — unchanged; no new vendored scripts.

### `account.js` surface (additions over 4a)

```js
drain()             // walk the outbox: photos, then vehicles, then tombstones
sync()              // drain() then incremental pull() — what 'online' calls
outboxSize()        // for a Settings status line, replacing dirty().length
```

`onSaved`, `dirty`, `markDirty`, `clearDirty` are removed — `session.js` enqueues directly
to the new outbox store via `deps.enqueue`, the same injection pattern `saveVehicle` and
`afterSave` already use.

### Data flow: a save while online, on two open devices

1. Device A saves a vehicle. `session.save()` writes locally, then enqueues a `vehicle`
   outbox entry (and a `photo` entry, if a photo slot changed).
2. Device A is online, so the save's own completion (not a separate timer) calls `sync()`:
   `drain()` uploads the photo, then the vehicle row; `lastPulledAt` was already current,
   so the pull that follows finds nothing new from itself.
3. Device B is a separate open tab/session. Its next `online` event (it never went
   offline, so this fires the first time this design's listener is wired up, and every
   reconnect after) calls `sync()`: `drain()` finds an empty outbox, `pull()` fetches rows
   with `updated_at > lastPulledAt`, finds device A's vehicle, applies it through
   `applyPulledVehicle` — fetching the new photo by id first if the row references one B
   doesn't have — and re-renders.

Two devices both left open and both online converge the next time either one's browser
fires `online` — which, per MDN, fires on the transition into an online state, including
right after a page load with an already-live connection in most browsers, and is not
relied upon as the *only* opportunity: `start()`'s existing boot-time pull is still there
for the case where it doesn't.

## Error handling

**A failed outbox entry is silent**, same philosophy as 4a's dirty list: not surfaced as
an error, left for the next `sync()`. Settings' status line changes from "N vehicles
waiting to sync" to "N changes waiting to sync" (`outboxSize()` counts entries, not
vehicles — more than one entry can share a vehicle id: a photo and its vehicle row).

**A failed incremental pull is silent.** The app already rendered from local storage, and
`lastPulledAt` is not advanced, so nothing is lost — the same rows are re-fetched on the
next successful pull.

**A photo download failure does not block applying the vehicle row.** The row still saves
with a `photoId` that fails to resolve locally; `resolvePhotos()` already tolerates a
missing blob (4a: "this degrades quietly with no code change"), and the next successful
sync retries the fetch because the reference is still there. The alternative — failing the
whole pulled batch over one missing image — would let a single bad photo block every other
change on the server from ever arriving.

**Sign-in's pull failure handling is unchanged** — still refuses sign-in outright, per 4a.

## Testing

`node --test`, `fake-indexeddb`, injected client fakes — no new devDependencies, same as
4a.

**`test/account.test.js`**

- a save's outbox entry drains on the next `sync()` when online
- a photo entry uploads before the vehicle entry that references it, even when both are
  enqueued in the same batch
- a tombstone drains after a same-batch vehicle edit for the same id — the vehicle ends up
  deleted, not resurrected
- a failed upload leaves its entry in the outbox; the next `drain()` retries it, nothing
  else
- incremental pull only fetches rows newer than `lastPulledAt`, and advances it only after
  every row in the batch is applied
- incremental pull includes `deleted_at` rows and calls `removeVehicle`, not `saveVehicle`,
  for them
- a pulled row referencing a `photoId` not present locally triggers exactly one Storage
  fetch, and does not re-fetch a photo already in the `photos` store
- a failed photo fetch does not block the vehicle row from saving, and the reference
  survives so the next pull can retry it
- `online` triggers `drain()` then `pull()`, in that order

**`test/storage.test.js`** — the new `outbox` store round-trips entries; `wipe()` empties
it along with everything else 4a's `wipe()` already clears.

**Manual, recorded in this repo** — two browser profiles signed into the same account,
left open side by side: edit a vehicle in one, toggle the other's network off and back on
(DevTools), confirm it appears; delete a vehicle in one, confirm it disappears in the
other; add a photo in one, confirm it renders in the other after reconnect. Real Storage
upload/download cannot be reached from the Node suite, same reasoning as 4a's manual RLS
pass.

## Acceptance criteria

- A vehicle edited on device A appears on device B after both have been online, with
  neither device re-authenticating.
- A vehicle deleted on device A disappears from device B under the same conditions.
- A photo added on device A is viewable on device B under the same conditions.
- An outbox entry that fails to push is retried on the next sync and never silently
  dropped.
- `lastPulledAt` never advances past a batch that failed partway through applying.
- Sign-in's full-replace behavior (4a) is unchanged — verified by re-running 4a's existing
  sign-in test suite unmodified.
- The app still runs by double-clicking `index.html` — no outbox, no sync, no account UI,
  same as 4a.
- `node --test` green.

## Non-goals

- **Real-time push.** No websocket/Realtime subscription; convergence happens on
  reconnect, per the roadmap's explicit rejection of real-time collaborative editing.
- **A retry backoff schedule.** Left-in-queue, retried on next sync, per the decision
  above — an entry that fails for a reason that won't resolve by itself (e.g. a photo too
  large for the bucket's policy) stays queued indefinitely rather than being dropped;
  surfacing that to the user is a Settings-UI concern, not this phase's.
- **Per-record sync.** Still vehicle-granularity, per 4a's non-goal — unchanged here.
- **Finishing Phase 3.** Still open; this phase continues adding to `account.js`/
  `session.js` rather than waiting for the module split's remaining steps.
- **Conflict resolution beyond LWW.** Unchanged from the roadmap.

## Risks

**The outbox replaces a data structure (`dirty()`) three tests currently assert against
directly.** Those tests move to asserting against outbox contents instead of a
`localStorage` key; a mechanical migration, but every one of them needs re-reading, not
just renaming.

**Photo upload is the first time this app sends binary data to the server.** Storage
policies are a different primitive from table RLS and are verified by hand, same
justification and same risk as 4a's RLS pass.

**`applyPulledVehicle` is shared between sign-in's `adopt()` and incremental pull.**
Factoring it out risks subtly changing `adopt()`'s existing, tested behavior. It is
introduced as an extraction with 4a's `adopt()` test suite re-run unmodified against it,
not as a rewrite.
