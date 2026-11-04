---
phase: 01-reliable-safe-foundation
plan: 05
subsystem: client-error-log
tags: [error-log, app_errors, main.js, precache-relay]
requires: [01-01, 01-04]
provides:
  - window.errorLog (report/configure/reset/scrub/buildRow), dual-mode
  - silent window error + unhandledrejection reporting
  - precache-report relay (garage-meta /__precache-report)
affects: [01-06, 01-07, 01-11]
key-files:
  created: [src/data/error-log.js, test/error-log.test.js]
  modified: [index.html, sw.js, main.js, test/helpers/boot.js]
requirements-completed: [FND-02]
completed: 2026-11-05
---

# Phase 1 Plan 05: Client error log Summary

Dual-mode `errorLog` inserts allowlisted rows (source, message, stack, route, app_version) into `app_errors` with no chained select, session cap 30, per-message dedupe, device cap 20/hour, offline drop, sk-/JWT scrub, truncation, 20-entry pre-configure buffer flushed on configure, never rejects.

## Commits
- 25f0931 error-log.js + test
- 526ca95 index.html/sw.js/boot.js order, main.js hooks + relay

## Wiring
- Listeners for `error` and `unhandledrejection` attached early in main.js (before session.configure), silent.
- `connectBackend()` configures errorLog with the same `client` as account, route getter (first hash segment), then reads app_version from `caches.keys()` (`garage-<12 hex>` else `unknown`) and runs the relay (guarded by `typeof caches` / `navigator.serviceWorker`, swallows all errors, deletes the entry after logging).
- sw.js CACHE (garage-v213) untouched; save paths untouched.

## Deviations from Plan
- Buffered pre-configure rows flush with app_version `unknown` (version resolves async after client configure). Minor; acceptable.
- Session-cap test advances the injected clock, since hour cap (20) is lower than session cap (30).
- [Security review, MEDIUM] Route could leak auth tokens from `location.hash`: main.js getter and `buildRow` now keep only `^#/?[A-Za-z0-9_-]{0,40}` and blank any route containing "token".
- [Security review, MEDIUM] `scrub()` hardened for untrusted text: strips URL query/fragment, redacts access/refresh/provider_token and code params, emails, `sk-`, `sb_`, JWTs and 32+ char opaque runs. Non-Error rejection reasons log only a type tag (`unhandled rejection (string)`). Table tests added.
- Test code reads `bootApp()` result as `{ api, cleanup }`.

## Verification
- `npm test`: 737 pass, 1 fail (seed-catalogue up-to-date check; known Windows CRLF worktree quirk, passes on LF).
- Manual signed-out devtools check against live Supabase not done here (no browser/backend); do before release.

## Known Stubs
None.

## Self-Check: PASSED
