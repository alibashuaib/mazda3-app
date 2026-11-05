---
phase: 02-proposal-gate-review-queue
plan: 02
subsystem: admin-ui
tags: [proposals, filters, edit-before-approve, stale-alert, seed]
requires: [02-01]
provides:
  - "filterProposals / proposalFilterOptions pure helpers"
  - "Filter card, edit-before-approve form, stale live-value alert in Proposals tab"
  - "supabase/seed-proposals-demo.sql (manual, draft car demo:seed)"
affects: [02-03]
key-files:
  created: [supabase/seed-proposals-demo.sql]
  modified: [src/data/admin.js, src/pages/admin-proposals.js, src/i18n/strings.ar.js, sw.js, test/admin-proposals-data.test.js, test/admin-proposals-render.test.js]
key-decisions:
  - "Filter state is module-level (proposalFilter) so it survives refresh after approve; filtering is in memory, no refetch"
  - "Stale refusal keeps row pending; the alert stores live_hash and live, Edit prefills from live and sends that hash as p_seen_hash"
requirements-completed: [REV-01, REV-04, CORE-02]
duration: 25min
completed: 2026-11-05
---

# Phase 2 Plan 02: Filters, edit-before-approve, stale alert Summary

Owner narrows the queue by car, kind, confidence and run in memory, edits a value before approving, and resolves a stale refusal by editing against the live value; demo seed provided.

## Tasks

| Task | Commit |
|------|--------|
| 1 Filters | f7054f4 |
| 2 Edit + stale alert (+ sw version bump) | b07bca4 |
| 3 Demo seed | 3558095 |

`npm test`: 853 pass, 0 fail.

## Deviations from Plan

**1. [Rule 1 - Bug] Renamed local `draw()` to `paint()`** - `draw(` matched the static `raw\(` ban in proposal-gate-static.test.js. Commit b07bca4.

Otherwise none. Edit form is built per click so it always prefills from the latest live value.

## Known Stubs

None. Reject button is scheduled for 02-03.

## Self-Check: PASSED
