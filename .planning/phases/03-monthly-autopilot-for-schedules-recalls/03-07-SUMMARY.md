---
phase: 03-monthly-autopilot-for-schedules-recalls
plan: 07
subsystem: admin-ui
tags: [admin, autopilot, i18n, precache]
requires: [03-06]
provides: [adminAutopilot, adminBanner, severe-interval rows]
affects: [src/pages/admin.js, src/pages/admin-proposals.js, src/pages/maintenance.js, sw.js, index.html]
key-files:
  created: [src/pages/admin-autopilot.js, test/admin-autopilot-render.test.js, test/maintenance-severe.test.js]
  modified: [src/pages/admin.js, src/pages/admin-proposals.js, src/pages/maintenance.js, src/i18n/strings.ar.js, index.html, sw.js, test/helpers/boot.js]
decisions:
  - "adminBanner() is a separate function placed above the tab strip (all tabs); adminAutopilot() renders only on the Proposals tab and does not duplicate the banner."
  - "Banner is suppressed when autopilotStatus fails to load, so a load error is not shown as a failed run."
metrics:
  tasks: 3
  completed: 2026-11-06
---

# Phase 3 Plan 07: Admin autopilot UI Summary

Autopilot card on the #admin Proposals tab (kill switch, last-run report, domain ban/approve with permanence confirm, unverified list, Check now preview then Confirm run), a failed/overdue banner above every admin tab, and separate Severe rows in proposal diffs and the live service detail.

## Commits
- 249c62d: Severe row in service detail (Task 3)
- bb032ce: admin-autopilot.js, severe/recall diff lines (Task 1)
- c992887: wiring, index.html/sw.js, Arabic strings, tests (Task 2)

## Deviations from Plan
- [Rule 3] test/helpers/boot.js SCRIPTS list updated (boot asserts it matches index.html); not in plan file list.
- Banner lives in `adminBanner()` rather than inside `adminAutopilot()` so it shows on all tabs without duplicating (REV-08).
- Severe labels added to DIFF_LABELS in admin.js; `draftDiff` already emitted severe fields. Recall proposals render campaign/component/summary from `after` (assumed shape; no recall proposal shape was defined in the plan).
- Check now reads `r.estimate || r` since the edge response shape was not pinned.
- sw.js CACHE refreshed via `npm run sw:version` (garage-6673c1af9888).

## Verification
Full `node --test`: 938 pass, 0 fail. `node --check` clean on edited files.

## Known Stubs
None.

## Self-Check: PASSED
