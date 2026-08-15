# Garage — Roadmap Design

**Date:** 2026-08-10
**Status:** Approved design, pending implementation plan

## Summary

Garage is a vanilla-JS PWA for tracking maintenance on personal vehicles. It works, and
the visual design is solid, but the schedule math is wrong in ways that quietly corrupt
every number the app shows, and the storage layer has a hard ceiling it fails at
silently.

This document covers four sequential phases that take the app from "a local page with
accurate-looking numbers" to "a service with accounts, private garages, and numbers that
are actually correct", plus a set of structural UI changes.

The phases are ordered so each is a prerequisite for the next. Phases 1 and 2 are
worth doing on their own merits even if Phase 4 is never built.

**Each phase gets its own implementation plan and is built, verified and merged
independently.** This document is the shared design they are drawn from, not a single
unit of work.

## Current architecture

| File | Lines | Role |
| --- | --- | --- |
| `app.js` | 2790 | Everything: state, storage, router, all pages, all dialogs |
| `styles.css` | 792 | Token-based theming, responsive phone/tablet/desktop |
| `index.html` | 80 | Shell — topbar, view host, 6-tab bottom nav, modal host |
| `sw.js` | 24 | Network-first service worker |

Data lives in one `localStorage` key, `garage.mazda3.v2`, holding
`{ vehicles: [{ id, data }], activeId }`. The active vehicle's `data` is assigned to a
module-level `state`, which every page reads directly. There is no user concept.

Multi-vehicle already works (garage switcher, add-vehicle picker, per-model SkyActiv
service catalogs). What is missing is per-*user* separation.

## Defects this design fixes

These were found by reading the code and are the motivation for Phases 1 and 2.

1. **The clock is frozen.** `app.js:8` — `const TODAY = new Date('2026-08-02')`. Every
   due date, overdue flag, health score, plan projection and pre-filled date input is
   computed against a hardcoded date that drifts further from reality every day.
2. **Saves fail silently.** `app.js:911` — `persistGarage()` wraps
   `localStorage.setItem` in `try { … } catch (e) {}`, swallowing `QuotaExceededError`.
   The user gets no indication their data was not written.
3. **Photos will trigger that quota.** `app.js:2253` — images are downscaled to 900px
   and stored as base64 JPEG data URLs (~150–350 KB each after base64 inflation) inside
   a ~5 MB budget. Roughly 20 receipts exhausts it.
4. **The plan drops recurring services.** `app.js:1177` — milestones are snapped to a
   10,000 km grid via `Math.round(k / step) * step`, but the oil change interval is
   7,500 km. When two occurrences round into the same bucket, the `add()` helper's
   `includes` check silently discards the second. Over the 300,000 km horizon roughly
   40 oil changes are displayed as roughly 30.
5. **The Plan view empties out late in the year.** `app.js:1222` filters milestones to
   the current calendar year, so every December it shows almost nothing.
6. **Every save rewrites everything.** `app.js:927` — `save()` re-serializes all
   vehicles including all photos on every change.
7. **No HTML escaping.** User-supplied text (notes, descriptions, nicknames, plates)
   is interpolated into `innerHTML` template literals throughout. Self-inflicted only
   while data is device-local; a genuine vulnerability once data crosses a server.
8. **One 2790-line file, no tests.** This is what makes the defects above risky to fix.

## Architectural decisions

### Local-first, server as replica

The server is never in the write path. Fuel is logged at petrol stations and services
at workshops — both places with unreliable connectivity. IndexedDB is the source of
truth; every write lands locally and returns immediately. A background sync reconciles
with the server when a connection exists.

This is why Phase 2 precedes Phase 4: IndexedDB is not merely a fix for the storage
ceiling, it is the local database that Phase 4 syncs from.

### Supabase as the backend

Per-user isolation is a security property, so it is enforced in the database via
Row-Level Security rather than in application code at every call site. Supabase provides
Postgres with RLS, authentication, and object storage in one service, and its client
loads from `esm.sh` as a module — preserving the project's no-build-step property.

Rejected alternatives: Firebase (NoSQL modelling fights the relational shape of
vehicles → services → history; heavier lock-in); a self-hosted Node backend
(hand-written auth and isolation is where security bugs live).

### Conflict resolution: last-write-wins

Each record carries an `updated_at` timestamp; on conflict the later write wins. Garages
are single-owner, so simultaneous edits to the same record from two devices are not a
realistic scenario. No CRDTs, no operational transforms.

## Phase 1 — Correctness

No visible redesign. The app stops reporting wrong numbers.

### 1.1 Real clock

Replace the `TODAY` constant with a `today()` function returning the current date
normalised to local midnight. All ~26 call sites become calls. The value must not be
cached at module scope — the app is a PWA and can stay open across midnight, so each
render recomputes.

### 1.2 Honest save failures

`persistGarage()` returns a boolean and, on `QuotaExceededError`, surfaces a toast
telling the user storage is full and their change was not saved. `save()` propagates
the result. No error is swallowed.

### 1.3 Correct plan milestones

Replace grid-snapping in `planForward()`. Milestones are computed at their true due
distance, then adjacent milestones within a 1,000 km tolerance are merged into a shared
visit. This preserves every occurrence — the current dedupe-by-rounding cannot recur —
while still grouping services that would sensibly be done in one workshop trip.

### 1.4 Rolling plan horizon

Replace the calendar-year filter in `buildPlan()` with a rolling 24-month window from
today, showing a minimum of three milestones regardless of dates. The view can no
longer empty out as a function of the month.

### Acceptance criteria

- No hardcoded date remains in the codebase; overdue status changes when the system
  clock advances past a due date.
- Filling storage past quota produces a visible warning, not a silent no-op.
- A 7,500 km interval over a 300,000 km horizon produces 40 milestones, not ~30.
- The Plan view shows at least three milestones on any date of the year.

## Phase 2 — Storage

Removes the storage ceiling and establishes the local database Phase 4 syncs from.

> **Amended 2026-08-11, during planning.** Three decisions changed from the original
> text below. Each is recorded inline in the subsection it affects.

### 2.0 Two backends, selected at runtime

**Amendment.** IndexedDB is unavailable from `file://` in Chrome (opaque origin →
`SecurityError` on `open()`) and Safari. Opening `index.html` by double-clicking it is
a documented feature of this app and was a global constraint throughout Phase 1, so
IndexedDB cannot simply replace `localStorage`.

A storage adapter selects the backend at runtime: IndexedDB where available, the
existing `localStorage` path where it is not. Hosted and installed-PWA use gets the
full fix; double-click-from-disk keeps working, with the old ~5 MB ceiling and the
honest quota warning Phase 1 added.

The adapter's API is async in both backends, so callers cannot depend on which one is
live.

### 2.1 Object stores

**Amendment — three stores, not nine.** The original text below listed one store per
entity. Nothing consumes that normalization until Phase 4's sync, whose schema should
be designed against sync requirements rather than guessed a phase early; and
reassembling nine stores into the in-memory shape on every boot is meaningful bug
surface for no present benefit. Three stores deliver every acceptance criterion:

| Store | Contents |
| --- | --- |
| `meta` | Schema version, `migratedAt`, active vehicle id |
| `vehicles` | One record per vehicle — its `data` object with photos replaced by ids |
| `photos` | `Blob` values keyed by id |

*Superseded:* ~~Object stores: `vehicles`, `services`, `history`, `spending`, `fuel`,
`docs`, `parts`, `photos`, `meta`. Records carry `vehicleId` where applicable.~~

### 2.2 Photos as Blobs

Photos move to their own store as `Blob` values keyed by id; records reference them by
id. This removes base64's 33% inflation and the data-URL-in-JSON pattern entirely.
Display uses `URL.createObjectURL`.

Revocation: the app has no view-teardown hook — `go()` replaces `innerHTML` wholesale.
So created object URLs go into a registry that is revoked at the start of each
navigation. Without this the app leaks a blob URL per photo per render.

### 2.3 Per-vehicle writes

**Amendment.** Writing one record per *vehicle*, not per entity. Once photos are out of
the JSON, a vehicle's remaining record is small (tens of KB), so rewriting one vehicle
per save is inexpensive and removes the defect — which was re-serializing *every*
vehicle *and every photo* on every keystroke-level change.

*Superseded:* ~~Writing one service record writes one record.~~

### 2.6 Reads stay synchronous

The app is written synchronously against a module-level `state` object, and every page
renders from it directly. Converting those reads to async would touch the entire
codebase — that is Phase 3's job, not this one.

Instead the adapter hydrates the whole garage into the existing in-memory `state` shape
at boot, so no rendering code changes. Only two things become async: application
startup, and `save()`.

`save()` returning a synchronous boolean — which Phase 1 introduced and 19 call sites
depend on — cannot survive an async backend. `save()` returns a Promise instead and
those call sites `await` it, preserving Phase 1's guarantee that a success message is
never shown for a write that failed. Reverting to fire-and-forget would silently undo
that fix.

### 2.4 Migration

A one-time, non-destructive migration reads `garage.mazda3.v2`, writes it into
IndexedDB, converts embedded data URLs to Blobs, and records `meta.migratedAt`. The
original `localStorage` key is left intact as a fallback and is not deleted.

### 2.5 Export / import

JSON export of the full garage with photos inlined as base64 for portability, and a
matching import. This is the user's backup story before any server exists, and their
escape hatch after one does.

### Acceptance criteria

- 50 receipt photos can be stored without error **on the IndexedDB backend**. On the
  `localStorage` fallback the ~5 MB ceiling remains, and hitting it produces Phase 1's
  visible warning rather than silent loss.
- Existing `localStorage` data appears intact in the app after migration, with the
  original key still present.
- Export followed by import into an empty browser profile reproduces the garage.
- The app still runs by double-clicking `index.html`, on the fallback backend.
- No success message is shown for a write that failed, on either backend.
- Navigating between pages does not leak object URLs.

## Phase 3 — Modules and tests

No user-visible change. Makes Phase 4 safe to attempt.

### 3.1 Module split

Split `app.js` along the seams already present in the file:

| Module | Contents |
| --- | --- |
| `src/data/store.js` | IndexedDB access |
| `src/data/catalog.js` | `CAR_MODELS`, `skyactivServices`, `mazda3Parts`, `sharedParts` |
| `src/data/migrate.js` | `normalizeData`, localStorage migration |
| `src/schedule/status.js` | `serviceStatus`, `svKm`, `svMo`, `healthScore` |
| `src/schedule/plan.js` | `planForward` and milestone merging |
| `src/pages/*.js` | One module per page |
| `src/ui/*.js` | `el`, modal, fields, toast, theme, i18n |
| `src/main.js` | Bootstrap and router |

`index.html` loads `src/main.js` as a module. `sw.js`'s `ASSETS` list must be updated to
cache the full module graph, or offline support breaks.

### 3.2 Tests

The schedule math is pure functions over plain data — and is exactly what was broken.
Test `serviceStatus`, `planForward`, milestone merging, and `healthScore` with
`node --test` against the ESM modules directly. No test framework dependency, no build
step, consistent with the project's existing constraints.

Regression tests for defects 1, 4 and 5 specifically.

### Acceptance criteria

- No module exceeds ~400 lines.
- `node --test` runs green with coverage of the four schedule functions.
- The app works offline after a hard reload, confirming the service worker caches the
  module graph.

## Phase 4 — Accounts and sync

Turns the app into a service with per-user private garages.

### 4.1 Authentication

Supabase Auth with email magic-link sign-in. No passwords to store or reset.

### 4.2 Schema

Postgres tables mirroring the IndexedDB stores. Every table carries `user_id`,
`updated_at`, and `deleted_at` (soft delete — required so deletions propagate through
sync rather than reappearing from the other device).

### 4.3 Row-Level Security

Every table gets an RLS policy restricting all operations to `user_id = auth.uid()`.
This is the mechanism that makes garages private; it is enforced by Postgres, not by
application code.

### 4.4 Photo storage

Supabase Storage bucket, objects pathed `{user_id}/{photo_id}`, with a storage policy
matching the table RLS.

### 4.5 Sync engine

Outbox pattern. Local writes append an entry to an `outbox` store; a sync worker drains
it when online. Pulls fetch records where `updated_at > last_pull`. Conflicts resolve
last-write-wins per Architectural decisions.

### 4.6 HTML escaping — mandatory

Defect 7 must be fixed in this phase, before any data crosses a server. Add an `esc()`
helper and audit every `innerHTML` template literal carrying user-supplied text. This
is a blocking requirement of Phase 4, not an optional cleanup.

### Acceptance criteria

- Two accounts on the same browser cannot see each other's vehicles.
- A record created offline appears on a second device after both come online.
- A record deleted on one device does not reappear from the other.
- A vehicle nickname of `<img src=x onerror=alert(1)>` renders as literal text.

## Design adjustments

Structural UI changes, independent of the engineering phases but sequenced alongside
them:

| Adjustment | Lands in |
| --- | --- |
| Self-updating odometer | Phase 1 — it is an accuracy fix |
| Explainable health score | Phase 1 — the score changes meaning once the clock is real |
| System theme option | Phase 1 — small and self-contained |
| Four tabs, not six | Phase 3 — the page split is already moving these files |
| Merge Schedule and Plan | Phase 3 — same reason |

### Four tabs, not six

Phone tab bars become cramped and unmemorable past five items; the current bar has six.
Fuel, Budget and Reports are all records-and-money, and collapse into a single **Money**
tab with internal sub-tabs. Resulting nav: Dashboard · Maintenance · Parts · Money.
Reports becomes an action within Money, which is where a user would look for it.

### Merge Schedule and Plan into "Upcoming"

Schedule and Plan both show services that are coming up. The difference — one is a
status-filtered list, the other a milestone timeline — is an implementation detail
leaking into the interface. They merge into one **Upcoming** view using the timeline
layout with status colouring. The Maintenance toggle becomes two modes (Upcoming,
History) instead of three.

### Self-updating odometer

The odometer is the input every calculation depends on, it is typed manually, and it
goes stale — quietly corrupting everything downstream. Fuel entries already record an
odometer reading. Derive the current odometer from the most recent fuel log, and prompt
for a reading only when the newest reading is more than 14 days old. Accuracy improves
with no additional data entry.

### Explainable health score

The score is currently a bare number with no way to see what is dragging it down. Make
it tappable, opening a breakdown of which services are penalising it and by how much.

### System theme option

`data-theme` is hardcoded to `dark` in `index.html` and the toggle is binary. Add a
third "system" state that follows `prefers-color-scheme`, and make it the default.

## Non-goals

- Real-time collaborative editing. Garages are single-owner; LWW is sufficient.
- Sharing vehicles between users, or ownership transfer on sale. Considered and
  deliberately excluded — it would require permissions and invites, and is not needed
  for private per-user garages.
- Native mobile apps. The PWA covers the use case.
- Rewriting the visual design. The token system, theming and responsive layout are
  sound and are kept.

## Risks

**Phase 4 changes what this project is.** Accounts and private garages make this a
service that must be operated: a database to maintain, authentication to keep secure,
and other people's data to be responsible for. That is an ongoing commitment, unlike a
static page that needs no attention. It should be entered deliberately.

**Phase 3 is a large mechanical refactor** of a file with no test coverage. It is
sequenced after Phase 1 so the schedule math is correct before it moves, and its own
tests are written as part of the phase to catch what the move breaks.

**Migration is one-way in practice.** Phase 2's migration is non-destructive, but once
a user has been writing to IndexedDB, reverting to the `localStorage` build loses
everything written since. The export in 2.5 exists partly to mitigate this.
