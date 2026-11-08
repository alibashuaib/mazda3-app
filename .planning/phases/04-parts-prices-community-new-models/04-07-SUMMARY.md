---
phase: 04-parts-prices-community-new-models
plan: 07
subsystem: user-catalogue-read-side
tags: [remote-catalog, parts, prices, new-models]
requires: [04-01, 04-05]
provides: [applyParts overlay, registerModels, indicative label]
key-files:
  modified: [src/data/remote-catalog.js, src/data/catalog.js, main.js, src/pages/parts.js, sw.js]
  created: [test/remote-catalog-parts.test.js, test/catalog-register.test.js]
requirements-completed: [PRT-01, PRT-02, COM-02, NEW-01]
completed: 2026-11-08
---

# Phase 4 Plan 07: Parts overlay and new-model registration Summary

remote-catalog now fetches and caches approved catalogue_parts, overlays them on saved cars without overwriting owner prices, and registers approved server models into CAR_MODELS; parts list shows an "indicative" pill.

## Commits
- f569ce4 Task 1: remote-catalog parts/applyParts/loaded, catalog registerModels/isRegisteredModel, tests
- abc0b07 Task 2: main.js wiring (new car force + syncDealerPlan), parts.js pill, sw cache version, render test

## Notes
- applyParts ownership: option updated only when `catPrice != null && price === catPrice`; ALT rows with new brand are appended; nothing deleted; keyed by full catalogId (engine-safe); version `car.partsVersion` vs `parts_updated_at`.
- syncDealerPlan now also runs applyParts; 'changed' from either repaints.
- remote-catalog factory now receives the catalog module (Node) or root (browser) to call registerModels.
- Picker needed no change: it reads CAR_MODELS at render time and registered models are appended.
- Arabic 'indicative' already existed in strings.ar.js; no change.

## Deviations
- [Rule 3] `npm run sw:version` run after editing precached files.

## Known Stubs
None.

## Self-Check: PASSED
npm test: 1007 pass, 0 fail.
