---
phase: 04-parts-prices-community-new-models
plan: 02
subsystem: autopilot-edge-logic
tags: [autopilot, gates, parts, community, models, pure-esm]
requires: []
provides:
  - parts.mjs gates (isMaterial, confirmParts, checkFitment, priceFromCitation, trimmedMedian, altSlot, GENERIC_PARTS)
  - community.mjs gates (FAILURE_CATEGORIES, parseFailures, countMentions, groupComplaints, typicalKm)
  - models.mjs (engineSlug, modelId, parseModels, diffModels, MARKETS)
  - logic.mjs registrableHost, extractCitations, exported hostOf/isBanned
  - extract.mjs exported nk/clash, sar/litres/years units
affects: [04-06 runParts, 04-08 runCommunity/runModels]
tech-stack:
  added: []
  patterns: [code-side gates over untrusted LLM output, parity tests against classic-script catalog.js]
key-files:
  created:
    - supabase/functions/autopilot/parts.mjs
    - supabase/functions/autopilot/community.mjs
    - supabase/functions/autopilot/models.mjs
    - test/autopilot-parts.test.js
    - test/autopilot-community.test.js
    - test/autopilot-models.test.js
  modified:
    - supabase/functions/autopilot/extract.mjs
    - supabase/functions/autopilot/logic.mjs
    - test/autopilot-logic.test.js
decisions:
  - "modelId collision suffix goes on the model part ('cx-70-2024-2:3.3l-turbo') so id.split(':')[0] and the catalogId engine slug stay valid"
  - "groupComplaints gives each complaint its own url (apiUrl#odi, or nhtsa.gov/?nhtsaId=) so countMentions counts complaints; host stays api.nhtsa.gov (one host)"
  - "diffModels returns one entry per new car (model + single engine), matching one car_model proposal per model:engine"
metrics:
  tasks: 2
  completed: 2026-11-08
---

# Phase 4 Plan 02: Code-side gates for parts, community and new models Summary

Pure ES modules enforcing D-04/D-05/D-06/D-07/D-11/D-13/D-15/D-17 in code: 2-host part numbers, citation-only SAR prices, 10%+5 SAR materiality, +-30% trimmed median, 3-mention/2-host failure counting, NHTSA complaint grouping, and a catalogId-parity new-model id rule.

## Commits
- 3b6abb8: parts gates, citation extractor, registrable host
- Task 2 commit: community and models gates (see git log)

## Deviations from Plan

**1. [Rule 1 - Bug] quoteHasNumber rejected "26.50" for price 26.5**
- Fix: number regex now accepts trailing zeros (`26.5` matches `26.50`, `10` matches `10.0`); unit slice uses match length. Existing extract tests still green.
- Files: extract.mjs

**2. [Rule 1 - Bug] priceFromCitation short quotes**
- quoteHasNumber's 3-word floor rejected `٢٦ ر.س`. The cited text is padded with a fixed `price is ` prefix on both sides; proof still comes only from the API cited_text.

**3. Model match in checkFitment uses a whole-token regex** instead of nk containment (nk collapses spaces so "CX-5 2.5L" read as "cx525l"; the plan's behaviour "CX-5 vs CX-50" needed a boundary).

**4. logic.mjs comment** avoids a Mazda hostname literal (existing test guards it).

## Known Stubs
None.

## Threat Flags
None. Mitigations T-04-06..T-04-09 implemented and tested.

## Verification
`npm test`: 982 pass, 0 fail.

## Self-Check: PASSED
