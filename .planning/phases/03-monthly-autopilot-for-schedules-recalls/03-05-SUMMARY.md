---
phase: 03-monthly-autopilot-for-schedules-recalls
plan: 05
subsystem: edge-function
tags: [autopilot, edge-function, deno, orchestration]
requires: [03-01, 03-03, 03-04]
provides: [autopilot Edge Function (work, preview, run), flow.mjs stage runners]
affects: [03-08 deploy]
key-files:
  created:
    - supabase/functions/autopilot/flow.mjs
    - supabase/functions/autopilot/index.ts
    - supabase/functions/autopilot/README.md
    - test/edge-autopilot-flow.test.js
decisions:
  - Extraction uses buildExtractPrompt(liveServiceNames), not the bare EXTRACT_PROMPT (empty service list would make the model skip everything).
  - Discover stores candidate URLs in its job notes; extract reads them from the same run's discover job (read-only select).
  - Preview lists known URLs with a read-only select of autopilot_sources.url (hashes only via get/set RPCs).
metrics:
  tasks: 2
  completed: 2026-11-06
---

# Phase 3 Plan 05: Autopilot Edge Function Summary

Autopilot worker: flow.mjs runs discover/extract/recalls/preview against injected deps (reserve before every paid call, hash skip, held/banned domains, cap/kill/over stops); index.ts is only auth, config and RPC wiring.

## Commits
- 310f013 flow.mjs + tests
- ac4826a index.ts + README

## Behaviour
- Discover: pass 1 (GCC allowed_domains, skipped when none configured), pass 2 (blocked_domains) only if pass 1 found no URLs; pause_turn resend capped at 2, each re-reserved. Domains via autopilot_see_domain: banned dropped, pending listed in skipped, approved kept (max 4 candidates).
- Extract: safeFetch, non-text (pdf) skipped and listed, hash match skips LLM, else reserve -> llm -> settle -> validateItem; one stage call per car; hashes saved only after staging; notes.unchanged true when every candidate hash matched. Duplicate services in one batch are dropped (unique index).
- Recalls: NHTSA via safeFetch with NHTSA_POLICY, free, staged as kind recall (all fetches failing throws so the job retries).
- Preview: zero paid calls; never-checked car returns basis 'worst-case' (discover + 4 extractions).
- Stop handling: reserve {ok:false} (killed -> stopped, cap -> capped), settle over:true -> capped, run_ended -> no end_run call.
- index.ts: origin gate, POST only, 503 without secrets, work needs x-cron-secret (safeEqual), preview/run need admin JWT. Job throw -> logEdgeError + finish_job(false).

## Verification
node --test: new file 12 tests plus cors and safe-fetch pass; full suite 921 pass, 0 fail. index.ts not runnable here (no Deno).

## Deviations from Plan
- [Rule 1] EXTRACT_PROMPT replaced by buildExtractPrompt(live services), see decisions.
- Task 1 commit predates index.ts, so its static index.ts guard test only passed after Task 2.

## Known limitations
- A car with zero candidates reports unchanged=false, so its live items count as missed for that month (D-16); revisit if noisy.
- Live smoke call (03-01) and Deno execution remain unverified until deploy in 03-08.

## Self-Check: PASSED
