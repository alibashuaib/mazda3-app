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
