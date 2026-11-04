---
phase: 01-reliable-safe-foundation
plan: 02
subsystem: edge-functions
tags: [cors, security, supabase, deno]
requires: []
provides:
  - "Origin allowlist gate (403) on plan-intake and read-bill"
affects: [plan-intake, read-bill]
key-files:
  created: [supabase/functions/_shared/cors.mjs, test/edge-cors.test.js]
  modified: [supabase/functions/plan-intake/index.ts, supabase/functions/read-bill/index.ts]
decisions:
  - "Per-request json helper inside handler so CORS headers come from the decision, not a module constant"
requirements-completed: [FND-03]
completed: 2026-11-05
---

# Phase 1 Plan 02: Edge function origin lock Summary

Pure `corsDecision`/`allowedOrigins` policy; both edge handlers return 403 for foreign or `null` Origin before OPTIONS, auth or any model call; wildcard ACAO removed.

## Tasks
1. `0b051fd` - cors.mjs + table test (6 cases).
2. See git log (`feat(01-02): gate plan-intake and read-bill...`) - handlers wired, 7th test greps sources for wildcard and gate order.

## Deviations from Plan
None. `src/data/bills.js` already maps non-OK to a short error code (`.catch` -> `failed`, status mapping), so no client change was needed.

## Deferred Issues
`npm test`: 717/722 pass. 5 failures are pre-existing and unrelated (schema regex tests `schema-repair`, `schema-shops`, `schema-aggregates`-style and the seed-up-to-date test; they fail on `null` regex matches, likely CRLF checkout on Windows). None touch files in this plan.

## Staging check (not run)
Deployed curl check (foreign Origin -> 403, production Origin -> not 403, no Origin + cron secret -> works) needs the deployed project; not run from the worktree.

## Self-Check: PASSED
Files exist; both commits present.
