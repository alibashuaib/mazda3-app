# Phase 4a — Accounts

**Date:** 2026-08-20
**Status:** Approved design, pending implementation plan
**Narrows:** the Phase 4 section of `2026-08-10-garage-roadmap-design.md`
**Depends on:** `2026-08-16-phase-3-module-split-design.md`

## Summary

Phase 4 as the roadmap wrote it is auth, schema, RLS, photo storage and a sync engine in
one piece. That is several independent subsystems, and the sync engine is where the hard
parts live. This phase takes the first half only.

**Phase 4a ends when you can sign in on a second device and see your garage.** Auth,
per-user isolation in Postgres, a whole-vehicle push on save, a pull on sign-in. No
outbox, no incremental pulls, no background worker, no photo upload. Those are Phase 4b,
with their own spec.

It also closes the two items the Phase 3 spec left open under "Phase 4 preconditions",
both of which needed a concept of a user that did not exist yet:

- `hydrate()` seeding one user from another's legacy data.
- `clear()` needing to be paired with a re-render.

## State of the code this builds on

Measured at `e09dd95`.

Phase 3 landed steps 1–3 of its own order of work: `catalog.js`, `strings.ar.js`,
`session.js`, `html.js`, `normalize.js`, `status.js`, `helpers.js`. **Steps 4 and 5 did
not land.** Pages and dialogs are still in `app.js` (2,230 lines); there is no
`src/main.js`, no `src/pages/`, no `src/ui/modal.js` or `chrome.js`.

The Phase 3 spec's decision 3 said the split lands in full before any account work
begins. It has not. This phase proceeds anyway, because the two seams Phase 4 was
designed to need — `session.js` for the garage lifecycle and `html.js` for escaping —
both exist and are tested. The practical consequence is that sign-in UI and boot wiring
land in `app.js` rather than in `chrome.js` and `main.js`, and will move when the rest of
Phase 3 does.

Two facts from Phase 2 that this design leans on:

- `saveVehicle(vehicleId, data, activeId, makeId)` writes one vehicle and returns the
  **stored** form of `data` — photos already split out into ids, no base64 inline.
- IndexedDB holds one JSON blob per vehicle in a `vehicles` store, plus `photos` and
  `meta`. Records inside a vehicle have `id`s but no timestamps and no tombstones.

## Decisions

### Scope: accounts now, sync later

Recorded above. Each half is verifiable on its own, and the preconditions get closed by
real callers rather than speculatively.

### Sign-in is optional, and absent from `file://`

The roadmap says the Supabase client "loads from `esm.sh` as a module — preserving the
project's no-build-step property". The Phase 3 spec rejects `<script type="module">`
outright: a `file://` origin is opaque, module scripts are CORS-checked, and running from
disk is an acceptance criterion of Phases 2 and 3 that `e2e/smoke.spec.js` tests today.

Those two decisions conflict. This one wins: **the app opened from disk works exactly as
it does now — local garage, no account UI, no auth code loaded.** `available()` is a
`location.protocol` check. Sign-in exists only over `http(s)`.

### The client is vendored, not fetched

`vendor/supabase.js` is the pinned UMD build, committed to the repo and listed in
`index.html` and `sw.js`'s `ASSETS` like every other script.

A CDN `import()` would keep the repo clean, but a cross-origin module cannot be cached by
the service worker the way a same-origin script can, and a signed-in user who opens the
app offline is the exact situation this app is built for.

Phase 3b's "the shipped app loads zero runtime packages" therefore becomes **one,
vendored and pinned**. That is a deliberate amendment, not an oversight.

### Email and password, not magic links

The roadmap chose magic links. Password sign-in wins here for one reason: on a phone, a
magic link opens in whatever browser the mail app prefers, which is frequently not the
one holding the installed PWA. Password sign-in completes without leaving the app.

The cost is a password reset flow and a set of validation strings, all of which need
Arabic translations. `strings.ar.js` covers the entire UI today and this is the largest
single addition of new strings in the phase.

Signup is open — standard Supabase email signup with confirmation. RLS means a stranger
who registers sees only their own empty garage.

### Where account-awareness lives

A new `src/data/account.js`, beside `session.js` rather than inside it.

`session.js` already has the seam: `configure(env)` injects `notify`, `makeObjectUrl`,
`revokeObjectUrl` and `saveVehicle` (`session.js:32-38`), and the comment above it says
"so a future sign-in flow can swap the notifier". Push-on-save is one more injected hook.

Rejected: folding accounts into `session.js`, which roughly doubles it and forces a
Supabase stub into every one of its existing tests; and an account-aware third backend in
`storage.js`, which conflates identity with persistence and surfaces an RLS denial to the
user as a storage error.

### Conflict resolution

Last-write-wins at the vehicle level, per the roadmap's architectural decision. Garages
are single-owner; simultaneous edits to the same vehicle from two devices are not a
realistic scenario.

## Architecture

### New files

| File | Role |
| --- | --- |
| `vendor/supabase.js` | pinned UMD build of `@supabase/supabase-js` |
| `src/data/account.js` | auth state, push, pull, sign-in merge, sign-out — ~180 lines |
| `supabase/schema.sql` | two tables and their RLS policies, applied by hand |

The Supabase URL and anon key are two constants at the top of `account.js`. Both are
public by design; RLS is the boundary, not secrecy.

### Changed files

- `session.js` — an `afterSave` hook. No structural change.
- `storage.js` — add `wipe()`.
- `app.js` — sign-in, sign-up and sign-out in Settings; boot wiring.
- `strings.ar.js` — auth strings.
- `index.html`, `sw.js` — script list and `ASSETS`.

### `account.js` surface

```js
configure(env)     // client + rerender callback, injected like session.configure
available()        // false on file://
user()             // null when anonymous
signIn(email, pw)  // also covers sign-up, one flag
signOut()
onSaved(id, data)  // push, or mark dirty
start()            // boot: resume token, push dirty, pull
```

### The invariant

**`account.signOut()` is the only caller of `session.clear()` in the codebase, and it
always follows it with `env.rerender()`.**

This is what closes Phase 3's second open precondition. Revoking a blob URL does not
blank an already-decoded `<img>`, so the previous user's car photo stays on screen until
something re-renders. Making one function own both halves turns a docstring warning into
an invariant a test can assert, rather than a rule every future caller has to remember.

### Boot does not wait on the network

`session.load()` renders from local storage exactly as today. `account.start()` runs
after, and re-renders only if the pull changed something. Local-first is unchanged: the
server is never in the write path.

## Data model

Vehicle `id`s stay what they are locally — `uid()` returns seven base36 characters
(`helpers.js:16`), not a UUID — so the primary key is composite, scoped by user.

```sql
create table vehicles (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table garage (
  user_id    uuid        primary key default auth.uid() references auth.users on delete cascade,
  active_id  text,
  updated_at timestamptz not null default now()
);

alter table vehicles enable row level security;
alter table garage   enable row level security;

create policy own_vehicles on vehicles for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_garage on garage for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

`data` is the **stored** form returned by `saveVehicle()`, carrying `photoId` references
and no base64.

`deleted_at` earns its place even without a sync engine: delete a vehicle on the phone
and, without a tombstone, the next pull on the laptop hands it straight back.

### Photos are local in 4a

Blobs stay in IndexedDB. Pull a garage onto a second device and its records arrive
without images. `resolvePhotos()` only sets `.photo` when the Blob is present
(`session.js:78`), so this degrades quietly with no code change. Closed in 4b.

### `uid()` is left alone

Seven `Math.random()` characters: collisions within one garage are unlikely but not
impossible, and the values are predictable. Predictability is harmless — every row is
scoped by `user_id`, so guessing an id reaches nothing. Recorded, not fixed.

## Data flow

### Sign-in

1. `supabase.auth.signInWithPassword`, or `signUp` — same form, one flag.
2. Pull `vehicles` where `deleted_at is null`, plus the `garage` row.
3. Decide:
   - **Server empty** → push every local vehicle and the garage row.
   - **Server has data, local is an untouched seed** → replace local.
   - **Server has data, local has real records** → ask the user: *keep this device's
     garage* or *use my account's garage*.
4. `env.rerender()`.

An untouched seed is derived, not flagged: one vehicle whose `history`, `fuel`,
`spending` and `docs` are all empty. That is the default vehicle `hydrate()` invents on a
fresh device, and it is read from data already in memory — no new flag and no new write
path.

### Save

Unchanged locally. `session.save()` calls `env.afterSave(vehicleId, res.data)` inside its
existing `res.ok` branch, which is already guarded by the `_generation` check
(`session.js:151`). A save in flight across a sign-out therefore cannot push into the
next account.

`account.onSaved` upserts the row. On failure it adds the id to a dirty list in the
existing `meta` store.

### Sign-out

`auth.signOut()` → `session.clear()` → `storage.wipe()` → `session.load()` →
`env.rerender()`.

### The legacy fallback

`hydrate()` falls back to `readLegacyV1()` when the loaded garage is empty
(`session.js:60`) — a device-scoped `localStorage` key with no user scoping. After a
sign-out, that would seed the next user with the first user's pre-garage car.

Gating it on "only when anonymous" does not work, because after sign-out you *are*
anonymous. **The fix is to make it unreachable: `storage.wipe()` deletes the legacy v1
`localStorage` key along with the IndexedDB stores.** The `load()` that follows sign-out
finds nothing to resurrect, `hydrate()` falls through to a blank seed, and `session.js`
needs no new parameter threaded through it.

Nothing is lost. Phase 2's migration copied that key into the garage long before any of
this runs.

### Boot

`session.load()` renders from local. Then `account.start()`: resume token, push dirty,
pull, re-render only if something changed.

## Error handling

**A failed push is silent.** It marks the vehicle dirty and moves on. Logging fuel at a
petrol station with no signal is normal operation, not an error worth interrupting for.
Settings carries the status instead: *Synced* / *N changes waiting*.

**A failed pull at boot is silent.** The app already rendered from local storage.

**A failed pull at sign-in is not.** The merge decision cannot be made without knowing
what is on the server, so sign-in refuses rather than leaving a half-signed-in state:
*"Couldn't reach your garage. Check your connection and try again."* The user stays
anonymous and local data is untouched.

### Expired session is not sign-out

`signOut()` wipes local storage. **A token that fails to refresh must not.** Wiping there
would destroy a garage because a phone was offline for a fortnight, or because of a
transient 401.

- **User taps Sign out** → auth signOut, `clear()`, `wipe()`, reload, re-render.
- **Token expires or refresh fails** → drop to anonymous, keep every local record where
  it is, surface sign-in in Settings. Nothing is wiped.

The next successful sign-in then goes through the normal merge — local has real data and
the server has data, so the user is asked, which is the correct outcome.

These are two paths through one module and it would be easy to write them as one. They
stay separate, and the tests pin it.

### Auth form errors

Inline, not toasts: wrong password, email already registered, email not confirmed,
password too short. Each needs an Arabic string.

### Phase 1's guarantee is untouched

`save()` still returns `Promise<boolean>` reflecting the **local** write only. A push
failure never turns a successful local save into a failure message, and a push success
never reports a save that did not happen.

## Testing

`node --test`, `linkedom`, `fake-indexeddb`, Playwright. No new devDependencies.
`account.js` takes its client through `configure({ client })`, so the Node suite injects
a fake with `auth.signInWithPassword / signOut / getSession` and `from().select/upsert`.
`vendor/supabase.js` never loads under Node.

**`test/account.test.js`**

- sign-in, server empty → every local vehicle and the garage row pushed
- sign-in, server has data, local an untouched seed → local replaced
- sign-in, server has data, local has records → the choose callback fires; both branches
- sign-in, pull fails → still anonymous, local garage untouched
- `onSaved` push fails → id lands in the dirty list; `start()` drains it
- `signOut()` → `clear`, `wipe`, `load`, `rerender`, asserted **in that order**
- expired token → anonymous, and `wipe` is never called

**`test/session.test.js`** — `afterSave` fires only on a successful local write, and
never for a save whose generation is stale.

**`test/storage.test.js`** — `wipe()` empties `vehicles`, `photos` and `meta`, *and*
removes the legacy v1 `localStorage` key.

**DOM harness** — seed a garage with a car photo, render, sign out, then assert no `<img>`
from the previous garage survives in the document and no vehicle text remains. This is
what pairing `clear()` with a re-render means in practice, and it is assertable only
because `signOut()` owns both halves.

**`e2e/smoke.spec.js`** — sign-in controls absent from `file://`, present over `http`.
Presence only; CI has no Supabase project.

**Manual, recorded in this repo** — two accounts in one browser, each seeing only its own
vehicles. RLS cannot be reached from the Node suite, so it is verified by hand and
written up the way the Phase 3 browser verification was.

## Acceptance criteria

- Two accounts on the same browser cannot see each other's vehicles *(manual)*.
- Signing in on a second device shows the garage from the first.
- Signing out, then signing in as a different user, does not seed the second user with
  the first user's legacy car.
- Signing out leaves no previous user's photo or vehicle text on screen.
- An expired token never wipes local data.
- The app still runs by double-clicking `index.html`, with no account UI and no auth code
  loaded.
- The app still works offline after a hard reload, including `vendor/supabase.js`.
- A vehicle nickname of `<img src=x onerror=alert(1)>` still renders as literal text,
  including when it arrives from the server.
- `node --test` green; `npm run test:e2e` green from both origins.

## Non-goals

- **The sync engine.** Outbox, incremental pulls, a draining worker. Phase 4b.
- **Photo upload.** Supabase Storage, the `{user_id}/{photo_id}` bucket and its policy.
  Phase 4b.
- **Record-level sync.** Per-record tables with their own `updated_at` and `deleted_at`
  would require restructuring local IndexedDB from vehicle blobs into per-record stores.
  The schema here does not preclude it.
- **Finishing Phase 3.** Steps 4 and 5 of the module split stay open. This phase adds to
  `app.js` rather than waiting for it to be dismantled.
- **Sharing, invites, ownership transfer.** Unchanged from the roadmap's non-goals.
- **The tab merge and the other Phase 3 non-goals.** Unchanged.

## Risks

**The expired-versus-deliberate sign-out split is the likeliest place for a data-loss
bug.** One wrong branch wipes a user's garage on a transient network failure. It is
pinned by two tests and should be reviewed as a pair.

**RLS is verified by hand.** Everything else in this phase has automated coverage; the
one property that is actually a security boundary does not. The manual pass must be
recorded, not merely performed.

**Sign-in UI lands in `app.js`**, the 2,230-line file Phase 3 was meant to dismantle. It
grows before it shrinks, and this work will need moving when Phase 3 resumes.

**A vendored dependency is a new kind of thing for this repo.** It needs a pinned
version, a recorded provenance, and a deliberate decision each time it is updated.
