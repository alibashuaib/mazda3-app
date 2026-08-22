# Phase 4a — Manual RLS Verification

> **Status: NOT YET PERFORMED.** This is a blank checklist for a human to fill
> in after `supabase/schema.sql` has been applied to a real Supabase project
> and `src/data/account.js` has been given real `SUPABASE_URL` /
> `SUPABASE_ANON_KEY` values. Nothing below has been executed. Every
> "Observed" line must be filled in by whoever actually runs the steps against
> the live project — do not check a box or write an observation for a step
> that was not performed.
>
> The Node test suite cannot exercise this: CI has no Postgres, and RLS is
> enforced entirely by the database, not by application code. This document
> is the only record that the isolation between users was actually checked.

## Run record

- **Date run:** _(fill in — YYYY-MM-DD)_
- **Supabase project ref:** _(fill in — from the project's dashboard URL, `https://<ref>.supabase.co`)_
- **Run by:** _(fill in — name)_
- **`schema.sql` applied (commit / date):** _(fill in)_

## Procedure

- [ ] **Step 1 — User A creates a vehicle**

  Sign up as `a@example.com`, add a vehicle with a distinctive nickname,
  confirm it appears in the dashboard's `vehicles` table.

  Observed:

- [ ] **Step 2 — Sign-out clears the local view**

  Sign out. Confirm the app returns to a blank seed garage and shows no
  trace of A.

  Observed:

- [ ] **Step 3 — User B sees an empty garage**

  Sign up as `b@example.com` in the same browser. Confirm B sees an empty
  garage, not A's vehicle.

  Observed:

- [ ] **Step 4 — Service role sees both users' rows**

  In the SQL editor, run `select user_id, id from vehicles;` as the service
  role and confirm two distinct `user_id`s.

  Observed:

- [ ] **Step 5 — B cannot read A's row via the anon client**

  While signed in as B, open the browser console and attempt to read A's
  row directly: `await supabase.from('vehicles').select('*')` — confirm only
  B's rows come back.

  Observed:

## Outcome

- **All steps passed:** _(fill in — yes / no)_
- **Follow-up needed:** _(fill in, or "none")_
