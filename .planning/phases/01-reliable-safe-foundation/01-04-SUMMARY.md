---
phase: 01-reliable-safe-foundation
plan: 04
subsystem: dashboard-photos
tags: [cache-buster, dual-mode, FND-09]
requires: []
provides: [carPhotos.photoUrl, carPhotos.PHOTO_REV]
affects: [src/pages/dashboard.js, index.html, sw.js, test/helpers/boot.js]
key-files:
  created: [src/data/car-photos.js, test/car-photos.test.js]
  modified: [src/pages/dashboard.js, index.html, sw.js, test/helpers/boot.js]
decisions:
  - "PHOTO_REV is one object keyed by modelId; CX family listed explicitly via a shared CX constant"
  - "Global namespace is carPhotos (same pattern as bills)"
metrics:
  tasks: 2
  completed: 2026-11-05
---

# Phase 1 Plan 04: Car photo revision map Summary

One dual-mode `PHOTO_REV` map plus `photoUrl(url, modelId)` replaces the nested `freshAsset` ternary; output is byte-identical for all 16 models.

## Commits
- b133709: car-photos.js and pinned-URL test
- 5d87f87: dashboard wired, script tag, sw.js ASSETS, boot.js SCRIPTS

## Deviations from Plan
- RED run skipped: test and module were written together, then test run green (2/2).
- `photoUrl` uses hasOwnProperty so ids like `constructor` do not hit Object.prototype (extra test row).
- CX_NORMALIZED_PHOTOS deleted (no remaining users). `sw.js` CACHE stays `garage-v213`. No assets touched.

## Verification
- `npm test`: 717 tests, 712 pass, 5 fail. The 5 failures are SQL/seed tests (`the committed seed file is up to date with catalog.js` etc.), caused by CRLF line endings in this Windows checkout, not by this plan. Not fixed (out of scope). Precache and script-order tests pass.
- Manual dashboard check not performed (no browser run); URL equivalence is covered by the table test.

## Known Stubs
None.

## Self-Check: PASSED
