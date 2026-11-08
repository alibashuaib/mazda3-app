---
phase: 04-parts-prices-community-new-models
plan: 04
subsystem: database
tags: [postgres, supabase, autopilot, rls, rotation]
requires: [04-01]
provides:
  - "autopilot job stages parts/community/models and finding kinds part/failure/car_model"
  - "autopilot_due rotation table, autopilot_budget_left(), autopilot_user_agreement(p_car)"
key-files:
  modified:
    - supabase/schema.sql
    - supabase/tests/autopilot.sql
    - test/schema-autopilot.test.js
    - test/rls-coverage.test.js
requirements-completed: [PRT-02, COM-01, COM-02, COM-03, NEW-01]
duration: 25min
completed: 2026-11-08
---

# Phase 4 Plan 04: Autopilot pipeline SQL for parts, community and new models Summary

Autopilot SQL now queues parts/community for a rotated subset of cars plus one models job, stages car-less `car_model` findings, and exposes a soft budget and a privacy-safe user-agreement aggregate to runners.

## What was built
- Config columns `optional_cars_per_run` (6), `optional_floor_sar` (8), `dealer_price_urls`.
- Stage/kind CHECKs widened (constraint names looked up in pg_constraint); `autopilot_findings.car_model_id` nullable; unique key recreated `nulls not distinct`.
- `autopilot_due` table (RLS, admin select policy, revoked writes).
- `autopilot_start_run`: core jobs for all cars, then parts+community for the rotated cars (manual: that car only), then `models` (monthly only), then publish. Optional job ids always exceed core ids.
- `autopilot_claim_job`: community waits for same car's parts. `autopilot_finish_job`: ok parts/community upserts `autopilot_due`.
- `autopilot_stage_findings`: new kinds, `car_model` requires null car and others non-null, delete uses `is not distinct from`.
- `autopilot_publish_run`: banned-host check skipped for url-less evidence (users); only discover/extract/recalls failures flip run to failed.
- `autopilot_budget_left()` and `autopilot_user_agreement(p_car)` (distinct users, latest price per user, +-30% trim, >=3 users, aggregates only; price_observations excluded), service_role only.

## Deviations
- [Rule 1 - robustness] Rotation orders by `least(parts_done, community_done)` with missing stage = `-infinity`, not `max(...) nulls first` as the plan said. With max, a car whose parts succeeded but community failed would look done; with least it stays due (satisfies D-19 "failed job stays due").
- Existing SQL tests d) and e) updated for the new job counts/claim order (optional jobs marked done in e)).
- Functions edited in place in the Phase 3 section (not re-created in the Phase 4 section) so `fn()` static helpers see one definition; new tables/functions/constraints are appended in a Phase 4 block.

## Verification
- `npm test`: 992 pass, 0 fail.
- No Postgres locally: the SQL in `schema.sql` and `supabase/tests/autopilot.sql` was reviewed by hand and covered by static regex tests only; the SQL behaviour tests run in the CI `rls` job and have NOT been executed. `nulls not distinct` needs PG15+ (Supabase local stack).

## Known stubs
None.

## Threat flags
None beyond the plan's threat model (T-04-13..16 mitigated as specified).

## Self-Check: PASSED
