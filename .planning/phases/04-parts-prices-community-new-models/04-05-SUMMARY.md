---
phase: 04-parts-prices-community-new-models
plan: 05
subsystem: admin-ui
tags: [admin, proposals, i18n, xss]
requires: [04-01]
provides: [owner review/edit/approve UI for part, failure, car_model proposals]
affects: [src/pages/admin-proposals.js, src/i18n/strings.ar.js, sw.js]
key-files:
  modified: [src/pages/admin-proposals.js, src/i18n/strings.ar.js, test/admin-proposals-render.test.js, sw.js]
requirements-completed: [PRT-01, PRT-02, COM-01, COM-02, COM-03, NEW-01]
duration: ~25min
completed: 2026-11-08
---

# Phase 4 Plan 05: Admin proposals UI for new kinds Summary

Proposals tab now renders, edits and approves part, failure and car_model proposals with an indicative pill, users-evidence line and a validated editable new-model id, all via textContent/html template.

## Tasks
Both tasks landed in one commit (`feat(04-05)`), since renderers and edit forms share one file and one test file: see git log for hash.

- Task 1: KIND_LABELS, newKindRows (part/failure/car_model), kind-aware row summary and stale alert, `type === 'users'` evidence branch, Hosts line, indicative pill (only when price_basis is 'indicative').
- Task 2: editSpec per kind. Part: brand/part_no/price (decimal-safe). Failure: title/summary/typical_km. car_model: id (prefilled from target_key, validated with `^[a-z0-9-]+:[a-z0-9.-]+$`), generation, markets. schedule_item/recall form unchanged.

## Deviations
- [Rule 3] sw.js CACHE is a content hash of precached files; regenerated with `npm run sw:version` (precache test failed otherwise).
- [Rule 1] Error text for invalid id initially contained a maker literal and tripped the CORE-06 static test; reworded to "maker:model-year".
- Price edit uses parseFloat (not catalogAdmin.num, which truncates to int) so SAR decimals survive.
- Part slot derived from after.tag (OEM vs other = Alternative); part name from target_key before `|`.

## Verification
`npm test`: 997 pass, 0 fail. New tests cover pill/no-pill, users evidence, hosts, script payload inertness, stale part, per-kind edit and invalid id.

## Known Stubs
None.

## Self-Check: PASSED
