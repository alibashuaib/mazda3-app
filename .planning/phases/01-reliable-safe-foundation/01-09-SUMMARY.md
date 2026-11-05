---
phase: 01-reliable-safe-foundation
plan: 09
subsystem: edge-functions
tags: [plan-intake, read-bill, app_errors, batching]
requires: [01-01, 01-08]
provides: [logEdgeError, planCarWrites, applyCarWrites, recallRows]
key-files:
  created: [supabase/functions/_shared/app-errors.mjs, test/app-errors.test.js, test/edge-plan-intake-batching.test.js]
  modified: [supabase/functions/plan-intake/logic.mjs, supabase/functions/plan-intake/index.ts, supabase/functions/read-bill/index.ts]
requirements: [FND-10, FND-02]
completed: 2026-11-05
---

# Phase 1 Plan 09: plan-intake batching and edge error logging Summary

plan-intake now does one live select, one delete, one insert and one recall upsert per car (not per item), and plan-intake and read-bill failures are written to app_errors with scrubbed message and stack only.

## Commits
- 2edc020: app-errors.mjs (scrub, normaliseEdgeError, logEdgeError) + 6 tests
- dfa90ce: planCarWrites/applyCarWrites/recallRows, index.ts batching, logged catches + 6 tests
- 1d57b28: read-bill logging at 3 x 503 sites, upstreamFailed, outer catch (the global-cap site and the count/insert sites)

## Decisions
- Write orchestration (`applyCarWrites`) lives in logic.mjs, not index.ts, so the call-count test runs the real code against a fake client. Test: 1 and 40 items both give exactly 1 delete + 1 insert.
- Planner dedupes by lowercased service (keep first) so the bulk insert cannot hit the partial unique index.
- Recalls: `upsert(...,{onConflict:'campaign,car_model_id', ignoreDuplicates:true}).select('campaign')`; count = rows actually inserted. The onConflict options stay inline in index.ts (a test greps for them).
- Delete/insert errors are logged with fixed messages, never the Supabase payload.

## Deviations
**[Rule 1 - Bug] Outer catch referenced `json`, which is scoped inside the try** (plan-intake and read-bill): it would have thrown ReferenceError instead of returning 500. Fixed with a plain `new Response(...)`. In plan-intake CORS headers are kept via a hoisted `corsHeaders`; read-bill's 500 now has no CORS headers (browser sees an opaque failure on that rare path; not changed further to stay in scope).
**[Rule 2]** Added a comment-bearing `catch (_)` for the NHTSA JSON parse so no bare `catch {` remains in plan-intake (acceptance check).

Also: the plan named read-bill line 58 as one 503 site; it is the combined global-count/cap check, logged as one message.

## Verification
- `npm test`: 825/825 pass (baseline 813 + 12 new).
- Manual review: no `admin.from` call inside a per-item loop in plan-intake; remaining awaits are per source or per car.
- Edge functions are not executed in CI. NOT verified on staging: the staging check (deliberately failing source writes one app_errors row with source plan-intake) was not run. Model-step behaviour cannot be exercised on staging anyway (Anthropic account has no credit) and the 01-08 staging blockers remain out of scope.

## Threat notes
- T-01-39 accepted: service-role writes to app_errors are not capped by the trigger; plan-intake runs are cron-bounded.
- Not logged by design: read-bill 503 not-configured, 429, 422, 4xx.

## Known Stubs
None.

## Self-Check: PASSED
