---
phase: 02-proposal-gate-review-queue
plan: 04
subsystem: proposal-gate
tags: [bulk-approve, rpc, savepoint]
requires: [02-01, 02-02, 02-03]
provides:
  - "public.apply_proposals(bigint[], text): admin only, high tier only, max 200 ids, per-item savepoint"
  - "catalogAdmin.applyProposals and pure bulkSummary"
  - "Approve N high-confidence bar, confirmation modal (Cancel first), result alert"
key-files:
  modified: [supabase/schema.sql, supabase/tests/proposals.sql, test/proposal-gate-static.test.js, src/data/admin.js, src/pages/admin-proposals.js, src/i18n/strings.ar.js, sw.js, test/admin-proposals-render.test.js, test/admin-proposals-data.test.js]
key-decisions:
  - "Server re-checks pending + tier per id; stale/not_high/failed reported per item, others still applied"
  - "Failure labels (car and target) captured at modal open, since failed rows may leave the list after refetch"
requirements-completed: [REV-02, REV-09]
duration: 20min
completed: 2026-11-05
---

# Phase 2 Plan 04: Bulk approve Summary

Owner approves all filtered high-confidence proposals with one confirmation; apply_proposals isolates each item in an exception block and returns a per-id result list.

## Tasks

| Task | Commit |
|------|--------|
| 1 apply_proposals + SQL cases o, p, q + static guards | 111b7ab |
| 2 Bulk bar, modal, summary, Arabic strings, sw version | 6a9e104 |

## Deviations from Plan

None. SQL cases o-q could not be run locally (no psql); they run in the CI rls job. `npm test` passes (865).

Note: schema.sql, proposals.sql and the static test showed as modified before start with an empty diff (line endings only); they are now committed with task 1.

## Self-Check: PASSED
