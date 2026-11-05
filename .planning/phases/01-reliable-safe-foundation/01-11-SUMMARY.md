---
phase: 01-reliable-safe-foundation
plan: 11
subsystem: service-worker
tags: [sw, cache, hash, FND-07]
requires: [01-04, 01-05, 01-06, 01-07, 01-10]
provides: [content-hash CACHE, npm run sw:version]
key-files:
  created: [tools/sw-version.js, test/sw-version.test.js]
  modified: [sw.js, package.json, test/precache.test.js]
decisions:
  - "CACHE = garage- + first 12 hex of SHA-256 over ASSETS files (CRLF->LF, './' skipped) + sw.js with CACHE line placeholdered (D-18)"
completed: 2026-11-05
---

# Phase 1 Plan 11: sw.js content-hash cache version Summary

`tools/sw-version.js` (computeHash, writeCacheLine, checkCacheLine, CLI + `--check`) replaces the hand-bumped `garage-vNNN` with a content hash; `npm run sw:version` regenerates it and `test/precache.test.js` fails with that instruction when stale.

## Tasks
1. Tool + 9 tests + npm script + regenerated CACHE (`garage-74bfc970fde9`) - d220257
2. Replaced hand-bump assertion in precache.test.js with checkCacheLine check; other assertions untouched - see next commit

## Stale proof
checkCacheLine with main.js read one byte longer (in-memory, repo untouched):
`{"ok":false,"expected":"garage-4c4dd3cb43d8","actual":"garage-74bfc970fde9","message":"sw.js CACHE is stale (have ..., want ...). Run npm run sw:version and commit the result."}`

## Verification
`npm test`: 786/786 pass (LF checkout, autocrlf false). `node tools/sw-version.js --check` exit 0.

## Deviations
- Plan said "do not commit"; followed executor instruction and committed per task.
- Worktree base was not fe32c9a; reset --hard to it per instructions.

## Important for merge
Hash covers every precached file. Plans 01-08/01-09 (not merged here) or any later edit to an ASSETS file or sw.js changes the hash: after merging, run `npm run sw:version` and commit sw.js. Not run here: browser/e2e/CI.

## Self-Check: PASSED
