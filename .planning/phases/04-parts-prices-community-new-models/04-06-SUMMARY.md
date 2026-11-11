---
phase: 04-parts-prices-community-new-models
plan: 06
subsystem: autopilot-worker
tags: [parts, prices, edge-function, gates]
requires: [04-02, 04-03, 04-04]
provides: [runParts, budgetGuard, stage dispatch map, parts deps/config]
key-files:
  modified:
    - supabase/functions/autopilot/flow.mjs
    - supabase/functions/autopilot/index.ts
    - test/edge-autopilot-flow.test.js
requirements: [PRT-01, PRT-02, PRT-03, COM-02, COM-03]
completed: 2026-11-08
---

# Phase 4 Plan 06: Parts job Summary

`runParts` stages gated OEM part numbers, SAR prices and user-agreed ALT rows per car, under a soft budget floor, and the worker dispatches `parts` jobs from a stage map.

## What was built
- `budgetGuard` / `runParts` in flow.mjs: skip with `notes.skipped=['budget']` before any reserve/LLM; dealer page step (official, hash skip, verbatim `quoteHasNumber` SAR check); one paid search step (2-registrable-host part number confirmation, `checkFitment`, prices only from the claim URL's own `cited_text`, unseen domains held via `seeDomain`); users step (3+ users, only count and median in evidence); materiality drop in code; new model (no live rows) uses `GENERIC_PARTS` as OEM inserts with no ALT.
- `runPreview` adds one parts search (+ one extraction when a dealer URL is set) to the estimate.
- index.ts: `STAGES` map (discover, extract, recalls, parts), explicit `unknown stage` error; cfg `minPct/minSar/optionalFloorSar/dealerPriceUrls`; db `budgetLeft`, `userAgreement`, `loadLiveParts` (read-only select).
- 12 new tests; the existing preview test now expects one extra llm call.

## Decisions
- Empty `dealer_price_urls` / held domains degrade to `notes.skipped` entries, never failures.
- Fitment is also required on price citations, not just part-number citations (a wrong-engine price is as wrong as a wrong number).
- A part-number-only finding with a `static` live price is labelled `indicative` (proposals reject `static`); the live price is carried unchanged.
- No pause_turn resend for the parts search (ponytail: one search pass; add if answers truncate).
- Users median is used as returned by `autopilot_user_agreement` (the RPC owns trimming).

## Deviations
None beyond the test expectation change above. `community`/`models` stages are still unmapped (04-08).

## Commits
- eeaa623 feat(04-06): runParts ... flow + tests
- worker stage map commit (index.ts) follows it on the branch

## Verification
`npm test`: 1010 pass, 0 fail.

## Self-Check: PASSED
