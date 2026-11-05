---
phase: 03-monthly-autopilot-for-schedules-recalls
plan: 08
subsystem: edge-functions
tags: [plan-intake, recalls, autopilot]
requires: [03-05, 03-07]
provides: ["plan-intake without NHTSA recall path (single recall path via autopilot)"]
key-files:
  modified:
    - supabase/functions/plan-intake/index.ts
    - supabase/functions/plan-intake/README.md
    - test/edge-plan-intake-batching.test.js
metrics:
  tasks_done: 1/2 (task 2 is an owner-only checkpoint, pending)
---

# Phase 3 Plan 08: Remove duplicate recall path Summary

plan-intake now drafts schedules only; the NHTSA recall fetch/upsert, `yearsOf`, unused imports and the `recalls` counter are gone. Owner setup (task 2) is PENDING.

## Task 1 (done) - commit c6d5dc6
- Removed recall block from `supabase/functions/plan-intake/index.ts`; response is now `{ drafts, skipped }`. Header and README point to autopilot for recalls.
- `parseRecalls` / `recallRows` stay exported in `logic.mjs` (autopilot uses them).
- Replaced the old recall-upsert source assertion in `test/edge-plan-intake-batching.test.js` with a check that index.ts has no `recalls`/`nhtsa` outside comment lines.
- `node --test test/edge-plan-intake-batching.test.js test/plan-intake-logic.test.js test/recalls.test.js`: 19 pass, 0 fail.

## Task 2 (owner-only) - PENDING, see checkpoint
Hostnames, secrets, deploy and end-to-end check are not executed. No secret values are in files or commits.

## Deviations
None.

## Known Stubs
None.

## Self-Check: PASSED (commit c6d5dc6 exists; tests green)
