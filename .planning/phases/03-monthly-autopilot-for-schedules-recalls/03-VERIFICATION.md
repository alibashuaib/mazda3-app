---
phase: 03-monthly-autopilot-for-schedules-recalls
verified: 2026-11-06T00:00:00Z
status: human_needed
score: 4/4 roadmap truths verified in code; 16/16 requirement IDs have code evidence; runtime items unexecuted
re_verification: false
gaps: []
human_verification:
  - test: "Run supabase/functions/autopilot/smoke.mjs with owner ANTHROPIC key"
    expected: "web_search_20250305 call succeeds with the anthropic-version header in use (assumption A4)"
    why_human: "Needs paid owner key; 03-01 live smoke not yet run"
  - test: "Apply supabase/schema.sql to Postgres, then run supabase/tests/*.sql (CI test.yml runs autopilot.sql via psql)"
    expected: "All SQL tests pass: severe round-trip, recall kind, reserve cap 40 SAR, kill switch, ban rejects pending, missed_runs, RLS"
    why_human: "No local Postgres; SQL never executed"
  - test: "Deploy autopilot function under Deno, set cron secret, trigger action=preview then run for one car"
    expected: "Preview makes zero paid calls; run stages findings; publish queues proposals; cron autopilot-monthly (0 3 1 * *) and autopilot-work (*/5) exist"
    why_human: "index.ts not executed (no Deno); 03-08 deploy reported approved by owner, not independently verifiable"
  - test: "Open #admin Proposals tab after a run"
    expected: "Banner when monthly run failed/overdue (>35 d), kill switch toggle, ban/approve domain, run report, unverified list, Check now with preview then confirm; severe interval shown as separate field in diff and service detail; Arabic strings read correctly"
    why_human: "Visual/UX and live RPC behaviour"
  - test: "Owner supplies Mazda Saudi/GCC hostnames into autopilot_config.gcc_domains (or confirms empty)"
    expected: "Pass 1 search uses allowed_domains; empty means global-only search"
    why_human: "Owner data decision (03-08)"
---

# Phase 3: Monthly Autopilot for Schedules & Recalls - Verification

**Phase Goal:** Once a month, without owner action, every one of the 16 Mazda cars is checked and schedule and recall corrections arrive in the review queue within a hard cost cap.
**Status:** human_needed (no code gaps found; runtime and deploy items unexecuted)
**Evidence:** `npm test` run by verifier: 938 tests, 938 pass, 0 fail. Code read directly; SUMMARY claims not relied on.

## Roadmap Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Check now for one car: cost preview, schedule proposals (normal + severe), matching generation/engine, GCC sources preferred | VERIFIED (code) | flow.mjs `runPreview` (free, no reserve); `runDiscover` pass 1 allowed_domains=gcc then pass 2 global; extract.mjs:117-121 generation/engine mismatch rejected; `buildAfter` carries severe; admin.js `checkCar`, admin-autopilot.js preview-then-confirm |
| 2 | Monthly cron covers all 16 cars in small retried jobs; cap/kill stops run, nothing partial published | VERIFIED (code), SQL unexecuted | schema.sql:1925 cron monthly; `autopilot_start_run` 1596 queues discover/extract/recalls per approved car + publish; `autopilot_reserve` 1543 checks kill switch + cap (default 40 SAR, line 1373) under advisory lock before each paid call (flow.mjs `paid`); stopRun ends run, publish returns not_running (1837+) |
| 3 | Numbers verbatim in source or dropped; unchanged sources no LLM; owner can ban domain | VERIFIED (code) | extract.mjs `quoteHasNumber` (:45, :98) normalises Arabic digits; flow.mjs hash compare skips LLM (ENG-08); `ban_source_domain` 1768, `host_banned` 1752, publish re-checks bans |
| 4 | Per-run report, overdue/failed banner, recalls queued, 2+ run unverified flag | VERIFIED (code) | `autopilot_build_report` 1809; `bannerState` in admin.js, rendered admin-autopilot.js:18; `runRecalls` stages NHTSA via safeFetch, published as kind recall; `missed_runs`/`unverified` generated col (1477-1478) |

**Score:** 4/4

## Requirement Coverage

| ID | Status | Evidence |
|----|--------|----------|
| ENG-01 | SATISFIED (code) | cron + `autopilot_start_run` over all approved cars |
| ENG-02 | SATISFIED (code) | per-car per-stage jobs, claim/finish with retry (1630, 1660); worker budget in index.ts |
| ENG-03 | SATISFIED (code) | `autopilot_reserve`/`settle`; fail-closed on unknown model; logic.mjs costUsd |
| ENG-04 | SATISFIED (code) | `autopilot_set_enabled` 1583; reserve checks `enabled`; UI toggle |
| ENG-05 | SATISFIED (code); live search unverified | `buildSearchRequest` 2 passes; smoke pending |
| ENG-06 | SATISFIED (code) | `ban_source_domain`, host grammar, UI |
| ENG-07 | SATISFIED | extract.mjs verbatim check + tests |
| ENG-08 | SATISFIED | flow.mjs source hash skip |
| ENG-09 | SATISFIED | `runPreview` + checkCar |
| SCH-01 | SATISFIED | extract + `submit_proposal` schedule_item |
| SCH-02 | SATISFIED | severe_km/months column (schema:664), proposal_live/apply/revert carry them |
| SCH-03 | SATISFIED | validateItem generation/engine rejection |
| SCH-04 | SATISFIED | `runRecalls`; kind recall through gate; plan-intake/index.ts has no recalls code (grep clean) |
| SCH-05 | SATISFIED | autopilot_item_status, missed_runs, unverified list in UI |
| REV-07 | SATISFIED | build_report + UI report |
| REV-08 | SATISFIED | bannerState (monthly only) + banner |

No orphaned IDs: all 16 ROADMAP IDs appear in plan frontmatter and REQUIREMENTS.md. Note: REQUIREMENTS.md checkboxes and traceability table still show "Pending" for these IDs; update them (doc only).

## Wiring

- index.html:183 and sw.js:15 both include `src/pages/admin-autopilot.js`; admin.js:53 renders `adminAutopilot`.
- test/rls-coverage.test.js covers the 8 autopilot tables; .github/workflows/test.yml runs supabase/tests/autopilot.sql.
- No TBD/FIXME/XXX markers in autopilot function, admin-autopilot.js, admin.js.

## Open Items (honest status)

| Item | Status |
|------|--------|
| (a) 03-01 live web-search smoke | Not run; human_needed |
| (b) 03-08 deploy | Owner-reported approved; unverifiable here |
| (c) SQL not executed | human_needed; static tests pass |
| (d) index.ts not executed | human_needed; flow.mjs logic is unit-tested with injected deps |

## Known Limitations

- Service-name proximity check in extract.mjs intentionally not implemented (Arabic pages). Quote must contain the number, but not necessarily sit next to the service name; a number from the wrong service in the same page could pass the verbatim check. Mitigated only by owner review in the queue.
- Null item generation is accepted unless the page names another generation (extract.mjs:110).
- PDF sources are skipped by default (flow.mjs).

## Gaps

None found.

## Owner waiver (live smoke)

Owner chose to bypass the live smoke call (03-01 Task 3) to avoid paid usage. Research assumption A4 (web_search_20250305 on this org) remains UNVERIFIED. Re-run `ANTHROPIC_API_KEY=... node supabase/functions/autopilot/smoke.mjs` before relying on live discovery.
