---
phase: 01-reliable-safe-foundation
plan: 01
subsystem: database
tags: [supabase, rls, postgres, ci, pg_cron]
requires: []
provides:
  - public.app_errors table (insert-only for clients, admin read/resolve, 90-day retention)
  - rls CI job running every supabase/tests/*.sql
  - test/rls-coverage.test.js static guards
affects: [01-05, 01-10]
key-files:
  created: [supabase/tests/app-errors-rls.sql, test/rls-coverage.test.js]
  modified: [supabase/schema.sql, supabase/tests/catalogue-rls.sql, .github/workflows/test.yml]
requirements-completed: [FND-02, FND-04]
completed: 2026-11-05
---

# Phase 1 Plan 01: app_errors table + RLS CI Summary

app_errors with column-grant insert-only RLS, trigger-set user_id/group_key, 500/hour client cap, guarded pg_cron 90-day purge, and an `rls` CI job (explicit SQL allowlist, ON_ERROR_STOP).

## Commits
- 135409c feat: app_errors DDL
- e6d3dc3 test + fix: RLS SQL assertions, static coverage test, security-review fix
- (third) ci: rls job, catalogue-rls CI-ready, `.mjs` syntax check

## Deviations from Plan

**1. [Rule 2 - Security, coordinator review] Client source spoofing / rate-limit bypass**
- Trigger now forces `new.source := 'client'` for anon/authenticated (only service_role keeps other sources) and takes `pg_advisory_xact_lock` before counting, so the 500/hour cap cannot be bypassed or overshot concurrently.
- Test case added: authenticated/anon insert with source 'server' is stored as 'client'.
- Consequence: the "non-slug source -> 23514" client case (plan case 5) was removed, since clients can no longer choose a source; the slug CHECK still guards service_role.

**2. CRLF checkout** On this Windows worktree, files check out CRLF, which makes 5 pre-existing schema regex tests (and the seed-up-to-date test) fail locally. With LF line endings (as in git and CI) `npm test` is 718/718. No committed change needed.

## Verification
- `npm test`: 718/718 (LF endings). Removing `enable row level security` for app_errors makes rls-coverage.test.js fail ("table app_errors lacks enable row level security"); reverted.
- No Docker/psql here: SQL and the rls job are unproven until the GitHub Actions run. Supabase CLI pinned to 3.0.0 (npm `supabase` latest on 2026-11-05); verify that `supabase/setup-cli@v1` accepts it and that the `supabase status -o env` DB_URL extraction works on first CI run. Red-then-green regression proof is not yet recorded.
- Pre-existing SQL tests (bills, guidance, qualified-users, repair-stats, shops-rls, shop-norm) are untested in CI so far; fix in-file if red.

## Known Stubs
None.

## Self-Check: PASSED
