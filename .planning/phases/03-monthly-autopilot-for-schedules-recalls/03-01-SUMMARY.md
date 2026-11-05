---
phase: 03-monthly-autopilot-for-schedules-recalls
plan: 01
subsystem: autopilot
tags: [cost-metering, web-search, edge-function]
requires: []
provides: [costUsd, costSar, worstCaseEstimate, buildSearchRequest, extractSearchUrls, backoffMs, estimatePreview]
affects: [03-04, 03-05]
key-files:
  created:
    - supabase/functions/autopilot/logic.mjs
    - supabase/functions/autopilot/smoke.mjs
    - test/autopilot-logic.test.js
    - test/fixtures/autopilot/web-search-ok.json
    - test/fixtures/autopilot/web-search-error.json
    - test/fixtures/autopilot/web-search-pause-turn.json
metrics:
  completed: 2026-11-06
---

# Phase 3 Plan 01: Autopilot cost and search building blocks Summary

Pure, tested spend metering (fail-closed price table), allowed-XOR-blocked web search request builder, search URL extraction with in-code ban filtering, backoff and preview estimate, plus a Wave 0 live smoke script.

## Status

Tasks 1 and 2 done and committed (250b2e2, 7acc7b1). Task 3 (checkpoint:human-verify, live smoke call) is PENDING: owner must run `ANTHROPIC_API_KEY=... node supabase/functions/autopilot/smoke.mjs` and expect HTTP 200, a web_search_tool_result block, searches >= 1, cost under SAR 0.20. Research assumption A4 is unverified until then.

## Decisions

- Haiku high tier encoded per model in price table (`tier_over`, `in_hi`, `out_hi`), no code constants.
- Pass 2 omits `blocked_domains` when ban list is empty (empty list may be rejected by API).
- `backoffMs`: 30 s then 120 s, then null (3 attempts total, D-13).
- `estimatePreview` always counts one discovery call plus one extract call per changed source.

## Deviations from Plan

None. `npm test`: 880 pass.

## Self-Check: PASSED

## Owner waiver

Live smoke call (Task 3) waived by owner. A4 unverified; see 03-VERIFICATION.md.
