# Phase 4b — manual sync verification

Two browser profiles (or two browsers), same Supabase project, signed into
the same account in both. RLS and Storage policies cannot be reached from
the Node suite (same reasoning as 4a's RLS pass) — this is performed by hand
and recorded here.

## Vehicle edit propagates

1. Profile A and Profile B both signed in, both showing the same garage.
2. In A, edit a vehicle's nickname. Confirm A's own `online` sync (or the
   save completing while online) pushes it — check the Settings status line
   drops to "Synced".
3. In B, DevTools → Network → toggle offline, then online. Confirm the
   nickname change appears within a few seconds of the `online` event firing.
4. Result: _____ (pass/fail, date, browser versions)

## Deletion propagates

1. In A, delete a vehicle (with more than one in the garage).
2. In B, toggle offline/online.
3. Confirm the vehicle disappears from B and does not reappear on a hard
   reload of B.
4. Result: _____

## Photo propagates

1. In A, add a receipt photo to a service record.
2. In B, toggle offline/online.
3. Confirm the photo renders in B (not a blank slot).
4. Result: _____

## Outbox survives a failed push

1. In A, go offline (DevTools), edit a vehicle. Confirm the Settings status
   line shows a pending count.
2. Go back online. Confirm the count returns to "Synced" and B (if open)
   receives the change on its own next `online` event.
3. Result: _____

## Deleting a vehicle removes its photos from Storage

Added for the follow-up fix: a deleted vehicle's photos previously stayed in
the `photos` bucket forever — the vehicles row was tombstoned and stopped
being pulled, but nothing asked Storage to forget the objects it pointed at.
`enqueueTombstone` now also queues a `photo-delete` outbox entry per photo the
vehicle had, captured before the local delete removes that information.

1. In A, add a receipt photo to a vehicle, let it sync (Settings shows
   "Synced").
2. In the Supabase dashboard → Storage → `photos` bucket, confirm the object
   exists at `{user_id}/{photoId}`.
3. In A, delete that vehicle (with more than one in the garage) and let the
   outbox drain (Settings returns to "Synced").
4. Confirm the object from step 2 is gone from the bucket.
5. Result: _____

## A stuck photo download is retried, not abandoned

Added for the follow-up fix: a photo download that failed once (a workshop's
weak signal cutting out mid-sync) used to be retried only if that vehicle's
`updated_at` moved again — which a photo-only failure never causes, so the
image stayed blank forever. Failed ids now persist to
`meta.pendingPhotoDownloads` and are retried on every sync.

1. In A, add a receipt photo to a vehicle, let it sync.
2. In B, DevTools → Network → block requests to the Supabase Storage host
   only (leave the `vehicles`/`garage` table requests reachable), then toggle
   offline/online so B pulls the vehicle row without being able to fetch the
   photo. Confirm the photo slot stays blank — not an error, not a retry loop.
3. Unblock the Storage host. Trigger another `online` sync in B (toggle
   offline/online again) with no further edit made in A.
4. Confirm the photo now renders in B, even though nothing about the vehicle
   changed since step 2.
5. Result: _____

## updated_at is server time, not a device clock

Added for the follow-up fix: every push used to send `updated_at: new
Date().toISOString()` from the pushing device's own clock, and the sync
cursor compared that value across devices — a device with a fast or slow
clock could desync everyone else's incremental pull. `supabase/schema.sql`
now has a `before insert or update` trigger on `vehicles` and `garage` that
overwrites `updated_at` with the database's own `now()`, regardless of what
the client sent. This requires re-running `supabase/schema.sql` against the
project (it is idempotent — safe to re-run in full).

1. Re-apply `supabase/schema.sql` in the Supabase SQL editor.
2. On a device, set the system clock several hours fast (or slow).
3. Edit a vehicle on that device and let it push.
4. In the Supabase dashboard → Table Editor → `vehicles`, confirm the row's
   `updated_at` reflects the actual server time, not the device's skewed
   clock.
5. Result: _____
