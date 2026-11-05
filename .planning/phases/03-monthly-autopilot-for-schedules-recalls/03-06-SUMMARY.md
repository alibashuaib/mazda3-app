---
phase: 03-monthly-autopilot-for-schedules-recalls
plan: 06
subsystem: admin-data-layer
tags: [autopilot, admin, remote-catalog, severe-interval]
requires: [03-04]
provides: [autopilot admin data API, bannerState, severe interval in live plans]
key-files:
  modified: [src/data/admin.js, src/data/remote-catalog.js, test/remote-catalog.test.js, sw.js]
  created: [test/admin-autopilot-data.test.js]
decisions:
  - "bannerState filters kind='monthly' first; overdue means newest finished monthly run older than 35 days (35 exactly = ok)"
  - "Host validated as bare lowercase dotted hostname before ban/approve RPC; invalid resolves {ok:false,error:'invalid'}"
  - "checkCar uses functions.invoke('autopilot') like runIntake; status 401/403/429 -> unauthorized/forbidden/limit, other status -> failed, no status -> offline"
metrics:
  tasks: 2
  completed: 2026-11-06
---

# Phase 3 Plan 06: Autopilot admin data layer Summary

Tested browser data layer in `src/data/admin.js` for the autopilot admin UI (autopilotStatus, listRuns, listDomains, listUnverified, setKillSwitch, banDomain, approveDomain, checkCar, bannerState), plus severe-interval (severe_km/severe_months) flow from dealer_plan_items into car services.

## Commits
- 06d68b8 feat: remote-catalog severe interval (select + put severeKm/severeMonths)
- c89e9a3 feat: admin autopilot API, banner rule, severe keys in LOGGED/draftDiff/listDrafts select
- (next) chore: `npm run sw:version` refresh; required by test/sw-version.test.js because shipped JS changed

## Notes
- autopilotStatus.spendSar sums autopilot_spend.cost_sar for the current UTC month; null when the table is not readable.
- sw.js CACHE hash will conflict with other parallel plans' worktrees; orchestrator should re-run `npm run sw:version` after merging the wave.
- Full suite: 913 pass, 0 fail.

## Deviations from Plan
None. draftDiff and the listDrafts select also got the severe keys (same intent as the "diff keys" item).

## Known Stubs
None.

## Self-Check: PASSED
