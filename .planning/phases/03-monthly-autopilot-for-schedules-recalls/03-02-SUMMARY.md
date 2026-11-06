---
phase: 03-monthly-autopilot-for-schedules-recalls
plan: 02
subsystem: database
tags: [postgres, proposal-gate, recalls, severe-intervals]
requires: []
provides:
  - dealer_plan_items.severe_km / severe_months
  - recall kind in submit_proposal / apply_proposal / proposal_live / revert_change
key-files:
  modified:
    - supabase/schema.sql
    - supabase/tests/proposals.sql
    - test/proposal-gate-static.test.js
requirements-completed: [SCH-01, SCH-02, SCH-04]
duration: short
completed: 2026-11-06
---

# Phase 3 Plan 02: Severe intervals and recall kind in the gate

Gate now carries structured severe intervals and accepts a `recall` kind (submit, dedupe, apply as upsert approved, revert) in re-runnable schema.sql edits.

## Commits
- 43509bd: both tasks in one commit (edits to the same four functions are intertwined).

## Decisions
- Schedule `after_hash` fills absent severe keys from live, so a severe-less proposal equal to live is a noop and a severe-only change is `inserted`.
- Recall noop only when live status is approved (status is not in the hash). Recall confidence needs no change: it has no numeric interval keys so change_pct stays null.
- Apply: severe key absent keeps live; explicit null clears. Recall years clamped 1900..2100, max 40; component 200, summary/remedy 1000.
- Existing change_log rows written before this change lack severe keys, so reverting them reports `drifted` once live has severe keys. Pending proposals get new hashes (schema comment).

## Deviations
None to plan scope.

## Verification
`node --test` proposal-gate-static, rls-coverage, schema-guidance: 20 pass. SQL tests in supabase/tests/proposals.sql (cases v, w) were NOT run locally: no Postgres available here; they run in the CI rls job.

## Self-Check: PASSED
