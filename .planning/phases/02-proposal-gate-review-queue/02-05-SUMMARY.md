---
phase: 02-proposal-gate-review-queue
plan: 05
subsystem: proposal-gate
tags: [revert, audit, rpc]
requires: [02-01, 02-04]
provides:
  - "public.revert_change(bigint): admin only, refuses 'drifted', matches by car + service, writes change_log with reverts_id"
  - "catalogAdmin.listRecentChanges / revertChange"
  - "Recent approvals card with one-click Revert under the Proposals tab"
key-files:
  modified: [supabase/schema.sql, supabase/tests/proposals.sql, test/proposal-gate-static.test.js, src/data/admin.js, src/pages/admin-proposals.js, src/pages/admin.js, src/i18n/strings.ar.js, sw.js, test/admin-proposals-render.test.js, test/admin-proposals-data.test.js]
key-decisions:
  - "Drift policy: live row must equal change.after under lock, else {ok:false,error:'drifted'} with no writes"
  - "Revert upsert restores interval_km, interval_months, note, parts only; source_url is left as is"
requirements-completed: [REV-06, CORE-05, REV-09]
duration: 20min
completed: 2026-11-05
---

# Phase 2 Plan 05: Revert Summary

Owner reverts any approved change (or any revert) in one click with no confirmation; each revert is a new audited change_log row and newer data is never clobbered.

## Tasks

| Task | Commit |
|------|--------|
| 1 revert_change + SQL cases r-u + static guards | 78b7b3e |
| 2 Recent approvals card, wrappers, Arabic, sw version | 768e408 |

## Deviations from Plan

None. SQL cases r-u could not be run locally (no psql); they run in the CI rls job. `npm test` passes (870).

## Self-Check: PASSED
