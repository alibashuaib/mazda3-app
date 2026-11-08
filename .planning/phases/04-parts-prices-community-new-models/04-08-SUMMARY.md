---
phase: 04-parts-prices-community-new-models
plan: 08
subsystem: autopilot-worker
tags: [community, new-models, edge-function]
requires: [04-02, 04-04, 04-06]
provides: [runCommunity, runModels, community/models dispatch]
affects: [supabase/functions/autopilot/flow.mjs, supabase/functions/autopilot/index.ts]
key-files:
  modified:
    - supabase/functions/autopilot/flow.mjs
    - supabase/functions/autopilot/index.ts
    - test/edge-autopilot-flow.test.js
requirements-completed: [COM-01, COM-02, NEW-01]
metrics:
  tasks: 2
  completed: 2026-11-08
---

# Phase 4 Plan 08: Community failures and new-model jobs Summary

runCommunity and runModels added to the autopilot worker; both stages dispatched; all Phase 4 stages now stage only gated findings.

## What was built

- **runCommunity**: budget floor skip; NHTSA complaints (free, one host, optional: failure becomes skipped note 'nhtsa'); one global haiku search (citations only); reddit never fetched; unapproved hosts held; approved non-reddit pages fetched (max 4) and labelled; citation snippets labelled in one extra call. Labels must be verbatim in the page or in a cited_text. `countMentions` enforces 3+ mentions on 2+ registrable hosts; titles come from a fixed map; typical_km needs 2+ km figures that pass `quoteHasNumber`. Forum alternatives: brand + part number on 2+ hosts (`confirmParts`), only for parts already in the live catalogue, tier community, price only via `priceFromCitation`. Part rows are restaged as the union with existing staged rows (runParts wins) via new read-only `db.stagedFindings`.
- **runModels**: pass 1 only (GCC allowed_domains), skipped with no reserve when no GCC domains, budget floor skip, approved hosts only, per page `buildModelsPrompt` + `parseModels`; engines with a non-verbatim quote dropped; oil/warranty numbers verified with `quoteHasNumber` (litres/years/km) else nulled with `unverified_<field>` and `verified:false`; `diffModels` against `db.loadAllModels()`; ids via `modelId`; staged with car null, tier official.
- **index.ts**: `community: runCommunity, models: runModels`, read-only `loadAllModels` and `stagedFindings`.

## Merge

Merged orchestrator commit 6b24e06 (whole-token part_no fix in runParts) by fast-forward; no conflict. runCommunity uses its own `hasPartNo` whole-token matcher (alnum boundaries, optional separators) because aftermarket numbers such as `150-2010` do not fit `PART_NO_RE`.

## Deviations from Plan

1. **[Rule 1 - Bug] No hash-skip in community/models page reads.** Plan said reuse the runExtract hash-skip block. An unchanged forum page would then stop counting as a mention each month, and `autopilot_sources` is keyed by a real car id (null for models jobs). Documented with a `ponytail:` comment on `readPage`.
2. Alternatives claims come from the search call's final JSON array (same pattern as runParts), not from an extra extraction call.

## Verification

- `node --test test/edge-autopilot-flow.test.js`: 40 pass. `npm test`: 1032 pass, 0 fail.
- No local Postgres: nothing SQL-side changed here. The staged kinds `failure`, `part`, `car_model` and a null car id depend on the 04-04 SQL (stage function / table check) which was not re-verified by hand in this plan; the base `schema.sql` in this tree still shows `kind in ('schedule_item','recall')` and `car_model_id not null`, so confirm 04-04's migration is what ships.
- No remote writes, deploys or paid calls.

## Commits

- 16b0200: feat(04-08): community failures/alternatives and GCC new-model jobs

## Self-Check: PASSED
