---
phase: 01-reliable-safe-foundation
plan: 03
subsystem: supply-chain, agent-docs
tags: [vendor-pin, sha256, agents-md]
requires: []
provides: [vendor/pins.json, test/vendor-pin.test.js]
affects: [vendor/README.md, AGENTS.md]
key-files:
  created: [vendor/pins.json, test/vendor-pin.test.js]
  modified: [vendor/README.md, AGENTS.md]
requirements-completed: [FND-06, FND-11]
duration: 10min
completed: 2026-11-05
---

# Phase 1 Plan 03: Vendor pin and AGENTS.md trim Summary

vendor/supabase.js pinned by SHA-256 and byte length in vendor/pins.json, enforced offline by node test; README kept in sync by a second test; AGENTS.md reduced to the car-asset memory section.

## Tasks
1. Pin JSON + sha256 test: c600b81. Local hash and size (136992) matched the plan before writing the pin.
2. README sync, README-drift test, AGENTS.md trim: see second commit on branch.

## Mutation check
Appending one byte to an in-memory copy of vendor/supabase.js changes the hash (detected). Real vendor file untouched.

## AGENTS.md
Grep for the removed headings (Elite Product Designer, Response Protocol, Domain 1/2) found no non-planning links; no pointer needed. Kept section verbatim; `grep -c "^## "` = 1.

## Deviations
None.

## Test status
npm test: 717 tests, 712 pass, 5 fail. The 5 failures (seed-catalogue up-to-date, and 4 schema aggregate tests) are pre-existing and unrelated: the seed diff shows `\r\n` in generated output, i.e. Windows CRLF handling of checked-out files in this worktree. Both new vendor tests pass. Not touched (out of scope).

## Self-Check: PASSED
