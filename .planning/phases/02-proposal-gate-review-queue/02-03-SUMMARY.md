---
phase: 02-proposal-gate-review-queue
plan: 03
subsystem: proposal-gate
tags: [reject, dedupe, supersede, units, seed]
requires: [02-01, 02-02]
provides:
  - "public.reject_proposal(bigint, text), admin only"
  - "submit_proposal actions: noop, duplicate, suppressed, inserted (supersedes older pending first)"
  - "catalogAdmin.rejectProposal and inline two-step Reject form"
  - "supabase/functions/_shared/units.mjs (milesToKm, toKm, exVat, perUnitSar)"
affects: [phase-3-worker]
key-files:
  created: [supabase/functions/_shared/units.mjs, test/units.test.js]
  modified: [supabase/schema.sql, supabase/tests/proposals.sql, test/proposal-gate-static.test.js, src/data/admin.js, src/pages/admin-proposals.js, src/i18n/strings.ar.js, sw.js, test/admin-proposals-data.test.js, test/admin-proposals-render.test.js, supabase/seed-proposals-demo.sql]
key-decisions:
  - "Rejected values are suppressed only while after_hash AND sources_hash match; changed sources re-queue"
  - "Supersede runs before insert inside the per-target advisory lock (partial unique index is the backstop)"
requirements-completed: [REV-05, CORE-03, CORE-04, CORE-07, REV-09]
duration: 30min
completed: 2026-11-05
---

# Phase 2 Plan 03: Reject, queue hygiene, units Summary

Owner rejects with an optional 300-char reason; submit_proposal now dedupes, suppresses unchanged rejected values and supersedes older pending ones; pure units module ready for Phase 3.

## Tasks

| Task | Commit |
|------|--------|
| 1 reject_proposal + submit_proposal hygiene, SQL cases i-n, static tests | 06a21b0 |
| 2 Reject UI, rejectProposal, Arabic, sw version | d9d3235 |
| 3 units.mjs, units test, seed supersede pair | 645e521 |

`npm test`: 860 pass, 0 fail.

## Deviations from Plan

**1. [Rule 3 - Blocker] Line endings** - a Python edit wrote CRLF into LF files and broke 4 regex-based schema tests (`;\n`). Converted touched files back to LF before the Task 2 commit. Task 1 commit blobs verified clean afterward.

**2. Plan acceptance count** - `grep -c "function public.reject_proposal("` is 3 (create, revoke, grant), not 1; the function is defined once.

**3. Seed** - the 40000 Brake Fluid submit already existed from 02-02; only the 30000 submit was added.

## Known limitations

- `supabase/tests/proposals.sql` cases i-n were not executed locally (no psql available); they run in the CI rls job. Static tests pass.

## Known Stubs

None.

## Self-Check: PASSED
