---
phase: 01-reliable-safe-foundation
plan: 07
subsystem: service-worker
tags: [sw, precache, swr, lru, FND-07, FND-08]
requires: [01-04, 01-05]
provides: [tolerant precache + /__precache-report, KEEP-set activate, SWR modules/photos, PHOTO_MAX LRU]
key-files:
  created: [test/sw-install.test.js, test/sw-cache.test.js, test/helpers/sw-harness.js]
  modified: [sw.js]
requirements-completed: [FND-07, FND-08]
completed: 2026-11-05
---

# Phase 1 Plan 07: Resilient offline shell Summary

sw.js install fetches each ASSET separately (cache: reload) and parks failures at garage-meta `/__precache-report`; no skipWaiting or clients.claim; activate keeps CACHE, garage-photos, garage-meta; ASSETS modules and assets/ photos are stale-while-revalidate (vendor never revalidated); photo cache is a 6-entry LRU keyed by full URL.

## Commits
- see git log: `feat(01-07): tolerant SW install, no takeover, SWR modules, 6-entry LRU photo cache`

## Deviations from Plan
- Added shared `test/helpers/sw-harness.js` (vm + fake caches) used by both test files; not listed in plan files.
- Tests and code written together, no separate RED run.
- Worktree HEAD was not on base 8f2bd3f; reset --hard to it per instructions (tree clean).
- Acceptance grep for skipWaiting/clients.claim excluding `//` lines returns 2: both hits are words inside `/* */` comments, not calls.
- Non-ASSETS .js/.css take the network-first path with no cache write (as planned); other same-origin responses still cached as before.
- Vendor: non-ASSETS files under /vendor/ are cache-then-network-and-cache, per plan.

## Verification
- `npm test`: 754/754 pass (precache.test.js unchanged and green).
- Manual Chromium 404-proxy install check not done (no browser).

## Known Stubs
None.

## Self-Check: PASSED
