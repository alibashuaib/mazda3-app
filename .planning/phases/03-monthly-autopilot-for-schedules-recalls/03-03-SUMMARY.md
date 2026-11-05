---
phase: 03-monthly-autopilot-for-schedules-recalls
plan: 03
subsystem: autopilot-extraction
tags: [validators, anti-hallucination, edge-function]
requires: []
provides: [extract.mjs: buildExtractPrompt, EXTRACT_PROMPT, parseExtraction, normaliseForQuote, quoteHasNumber, validateItem, buildAfter]
affects: [03-05 pipeline]
key-files:
  created:
    - supabase/functions/autopilot/extract.mjs
    - test/autopilot-extract.test.js
    - test/fixtures/autopilot/schedule-en.html
    - test/fixtures/autopilot/schedule-ar-digits.html
decisions:
  - "Null generation accepted unless the page names another generation (ctx.otherGenerations)"
  - "Item needs a verified normal interval; severe-only items rejected (no_verified_normal)"
metrics:
  completed: 2026-11-06
---

# Phase 3 Plan 03: Extraction validators Summary

Pure extraction contract: strict JSON parse, verbatim quote+number check (Arabic digits, whitespace, case normalised), generation/engine rejection, miles to km via `_shared/units.mjs`, and `buildAfter` that keeps live severe values unless the source quotes severe separately.

## Tasks
- Task 1 + 2 (combined in one commit, same file): 5b3663b. 7 tests pass (`node --test test/autopilot-extract.test.js`).

## API notes for 03-05
- `buildExtractPrompt(liveServiceNames)` builds the prompt; `EXTRACT_PROMPT` is the empty-list form.
- `validateItem(item, {fetchedText, liveServices, car, otherGenerations?})` returns `{ok, service, normal, severe, evidence, dropped[], after}`; on reject `{ok:false, dropped:[reason,...]}`. Reason codes: `unknown_service`, `generation_mismatch`, `engine_mismatch`, `no_verified_normal`, `<normal|severe>_<km|months>:<quote_missing|quote_not_in_text|number_not_in_quote>`.
- `liveServices` rows need `service, interval_km, interval_months, severe_km, severe_months, note, parts`.
- `fetchedText` must be the same truncated `htmlToText` output given to the LLM.
- Generation/engine matching is a loose normalised substring check against `car.generation` / `car.engine`.

## Deviations from Plan
- Tasks 1 and 2 committed together (single file, tests written for both). PDF skip is a caller concern (extract.mjs only takes text).
- Worktree base was corrected via `git reset --hard` to the required base at start.

## Known Stubs
None.

## Self-Check: PASSED
