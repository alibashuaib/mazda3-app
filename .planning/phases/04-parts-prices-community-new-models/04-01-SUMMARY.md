---
phase: 04-parts-prices-community-new-models
plan: 01
subsystem: database
tags: [postgres, rls, proposal-gate, plpgsql, seed]
requires:
  - phase: 02
    provides: proposals / change_log gate (submit, apply, revert)
provides:
  - catalogue_parts and known_issues live tables
  - gate support for part, failure, car_model proposals
  - supabase/seed-parts.sql baseline of catalog.js prices
affects: [04-02, 04-04, 04-05, 04-06, 04-07, 04-08, 04-09]
tech-stack:
  added: []
  patterns: [users aggregate evidence, price materiality from autopilot_config]
key-files:
  created: [tools/seed-parts.js, supabase/seed-parts.sql, test/seed-parts.test.js]
  modified: [supabase/schema.sql, supabase/tests/proposals.sql, test/rls-coverage.test.js, test/proposal-gate-static.test.js, .github/workflows/test.yml]
key-decisions:
  - "Materiality: immaterial when diff < min_sar OR diff/live < min_pct (behavior bullets and action text; the must_haves wording 'BOTH' contradicts them)"
  - "car_model maker comes from lower(after.make) unless p_maker_id is given, because gate bodies may not contain a maker literal"
  - "Revert of a car_model insert logs its change_log row with null car and null reverts_id, since the delete cascades away the original rows"
  - "No composite-typed variable for autopilot_config in submit_proposal (table is created later in schema.sql; plpgsql compiles declarations at create time)"
requirements-completed: [PRT-01, PRT-03, COM-01, COM-03, NEW-01]
duration: ~1h
completed: 2026-11-08
---

# Phase 4 Plan 01: Gate for parts, failures and new models Summary

Phase 2 approval gate now accepts, applies, stale-checks, bulk-refuses (cars) and reverts `part`, `failure` and `car_model` proposals, with a server-side baseline of every catalog.js part price.

## Accomplishments
- `catalogue_parts` (PK car+part+slot) and `known_issues` tables, RLS read-only for anon/authenticated, writes only via security definer gate functions.
- `car_models.parts_updated_at` and `markets` (whitelist check); `on_car_model_change` ignores `parts_updated_at`; `autopilot_config.min_pct/min_sar`.
- `submit_proposal`: per-kind validation, `users` aggregate evidence (count >= 3, median, no extra keys), ALT-needs-existing-part rule, price materiality returning `immaterial`.
- `apply_proposal` / `apply_proposals` (`not_bulk`) / `revert_change` (`in_use`), car_model edited id, years folded into generation, url sources stored.
- `tools/seed-parts.js` + generated `supabase/seed-parts.sql` (dealer vs static basis); CI applies it after seed-catalogue.sql.
- Tests: seed-parts, rls-coverage, static gate assertions, extensive SQL assertions in `supabase/tests/proposals.sql`.

## Task Commits
All three tasks touch the same `supabase/schema.sql` gate functions and could not be split into clean per-task commits, so they landed together:
- `8abf37e` feat(04-01): gate understands part, failure and car_model proposals

## Deviations from Plan

**1. [Rule 3 - Blocking] Existing static tests pinned the old kind tuple.** `test/proposal-gate-static.test.js` asserted `not in ('schedule_item', 'recall')`; updated to the five-kind tuple.

**2. [Rule 2] CI workflow** `.github/workflows/test.yml` now applies `seed-parts.sql` so the SQL tests run against the baseline (not in plan files list).

**3. Single commit instead of three** (shared file, see above).

## Issues Encountered / Not Verified
- No Postgres in this environment: the new SQL (schema.sql and the assertions in `supabase/tests/proposals.sql`) was never executed. Only `npm test` (969 pass, static checks) ran. The CI `rls` job is the first real run; expect possible small SQL fixes there.
- Plan inconsistency: must_haves say price is immaterial below BOTH 10% and 5 SAR; the behavior bullets and action say either floor. Implemented the latter (matches the tested bullets).

## Known Stubs
None.

## Threat Flags
None beyond the plan's threat model (T-04-01..05 mitigations implemented).

## Self-Check: PASSED
Files exist (tools/seed-parts.js, supabase/seed-parts.sql, test/seed-parts.test.js, this summary); commit 8abf37e present; `npm test` 969/969.
