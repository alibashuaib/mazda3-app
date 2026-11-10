---
phase: 04-parts-prices-community-new-models
verified: 2026-11-11
status: human_needed
score: 4/4 roadmap success criteria verified in code; 0/5 plan-04-10 live truths verified (owner-gated)
overrides_applied: 0
re_verification: none
gaps: []
warnings:
  - id: W-01
    truth: "PRT-02: no scraping of marketplaces whose terms forbid it"
    issue: "No default ban list seeded for noon / Amazon.sa. Protection is by approval gating only: unseen hosts are stored 'pending' and held, and only 'approved' hosts reach prices or pages. The code comment at flow.mjs:201 says 'never fetched', which holds only while the owner does not approve them."
    action: "Seed banned marketplace hosts (noon.com, amazon.sa and similar) into source_domains, or confirm the approval-only protection is accepted."
  - id: W-02
    truth: "PRT-01: confirmed by 2+ sources OR an official catalogue"
    issue: "The official-catalogue branch is not implemented. The Mazda KSA dealer list gives prices but no part numbers (04-RESEARCH Pitfall 2), so confirmParts() always requires 2 registrable hosts. This is stricter than the requirement, so SC1 still holds, but the 'or official catalogue' wording is not reachable."
    action: "Accept as a documented decision (D-05), or add an override."
  - id: W-03
    truth: "SC2: SAR price proposals labelled 'indicative'"
    issue: "Dealer-page prices carry price_basis 'dealer' and show no 'indicative' pill (flow.mjs:247, parts.js:205, admin-proposals.js:105). This follows D-08 in 04-CONTEXT.md, but the literal SC2 wording says all SAR price proposals are labelled 'indicative'."
    action: "Owner to confirm that D-08 (dealer prices unlabelled) overrides the SC2 wording."
  - id: W-04
    truth: "SQL gate enforces 2-source rule for part numbers"
    issue: "submit_proposal (schema.sql:1149-1165) checks price, tag and alt-slot rules but not the 2-source rule for OEM part numbers. That rule lives only in code (parts.mjs confirmParts). submit_proposal is service_role only, so the exposure is limited to a future caller bypassing flow.mjs."
    action: "Informational. Optionally add a count check in SQL as defence in depth."
  - id: W-05
    truth: "Documentation hygiene"
    issue: "REQUIREMENTS.md traceability still shows PRT-01..03, COM-01..03, NEW-01 as 'Pending', and ROADMAP.md shows 04-10 unchecked (9/10). Expected for an owner-gated plan, but the requirement rows should be updated once the owner closes 04-10."
    action: "Update after 04-10 closes."
deferred: []
human_verification:
  - test: "Run the SQL behaviour tests in the CI rls job (schema.sql, seed-parts.sql, supabase/tests/proposals.sql, supabase/tests/autopilot.sql)"
    expected: "All assertions pass on PostgreSQL 15 or later (nulls not distinct at schema.sql autopilot_findings_key requires PG15)"
    why_human: "No Postgres locally. The Phase 4 SQL has never been executed (04-01, 04-04 summaries say so)."
  - test: "Owner applies schema.sql, then seed-parts.sql, then seed-sources.sql (04-10 Task 1)"
    expected: "Apply succeeds with no errors; catalogue_parts and known_issues exist with RLS; autopilot_config has min_pct, min_sar, optional_cars_per_run, optional_floor_sar, dealer_price_urls"
    why_human: "Live database writes are owner-only."
  - test: "Run `node supabase/functions/autopilot/smoke.mjs --ppl` (free) and confirm SAR matches > 0 on mazda.com.sa/ppl"
    expected: "Dealer page readable. If not, dealer prices stay manual and runParts skips the dealer step (already handled as notes.skipped)"
    why_human: "Sandbox DNS could not resolve the dealer host (04-03 result: inconclusive)."
  - test: "Redeploy the autopilot edge function and run one Check-now on one car"
    expected: "Run report lists parts and community jobs as done or skipped with a reason; any proposals appear in #admin rendered per kind (Part, Known issue, New model)"
    why_human: "Live deploy and paid search. Owner-gated."
  - test: "Approve one part proposal in #admin, then refresh the app, then revert it"
    expected: "Price shown in the parts list changes after refresh and returns to the previous value after revert; change_log has the entries"
    why_human: "End-to-end live behaviour."
  - test: "Approve one car_model proposal and check the app picker"
    expected: "New model appears in the picker after refresh, with its engine option and oil capacity (or none if unknown)"
    why_human: "Picker render and live approval."
  - test: "Visual check of the 'indicative' pill (EN and AR) in the parts list and the admin diff, and the Known issues card on the dashboard"
    expected: "Pill appears only on non-dealer prices; Known issues card lists approved failures with mention counts; no raw HTML rendered"
    why_human: "Visual and i18n judgement."
---

# Phase 4: Parts, Prices, Community & New Models Verification Report

**Phase Goal:** The monthly run also proposes OEM parts, indicative SAR prices, community failures and cheaper alternatives, and new Mazda models for owner approval.
**Verified:** 2026-11-11
**Status:** human_needed
**Re-verification:** No (first verification; no prior VERIFICATION.md)
**Branch / HEAD:** check-now-full-width / 1090a2f. Working tree clean at verification start.

## Verification Method

- Read ROADMAP.md Phase 4 goal and 4 success criteria, REQUIREMENTS.md rows PRT-01..03, COM-01..03, NEW-01, all 10 PLAN files and 9 SUMMARY files.
- Treated SUMMARY claims as leads only. Each criterion was checked against code at the cited lines.
- `npm test` run locally: 1051 pass, 0 fail, exit 0 (matches expected 1051).
- SQL not executed (no Postgres). SQL verified by reading `supabase/schema.sql`.
- No source edits, no deploys, no DB writes, no paid API calls.

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth (ROADMAP SC) | Status | Evidence |
| - | ------------------ | ------ | -------- |
| 1 | Owner sees OEM part proposals (name, part number, fitment) only when 2+ sources or an official catalogue confirm them | VERIFIED (code) | Part number needs 2 registrable hosts: `supabase/functions/autopilot/parts.mjs:23-35` (`confirmParts`, filter `hosts.length >= 2`). Used in `flow.mjs:284` and `flow.mjs:474`. Single-source counted as dropped (`flow.mjs:286`, `:475`). Fitment pinned to car:engine: `parts.mjs:42-55`, applied at `flow.mjs:280`. SQL requires part price and tag: `schema.sql:1149-1165`. Official-catalogue branch not implemented (W-02). |
| 2 | Owner sees SAR price proposals labelled "indicative"; changes under the materiality threshold are not queued | VERIFIED (code), see W-03 | Citation prices only from the claim URL's own cited_text: `flow.mjs:289-291` (`priceFromCitation`, `parts.mjs:58-61`), basis 'indicative'. Materiality both thresholds: `parts.mjs:14-18` (`isMaterial`), applied in code at `flow.mjs:326` and `:343`, and in SQL at `schema.sql:1294-1303` (returns `immaterial`). Defaults min_pct 0.10, min_sar 5: `schema.sql:2296-2297`, `index.ts:121-122`. Indicative pill: `src/pages/parts.js:205`, `src/pages/admin-proposals.js:105`. Dealer prices use basis 'dealer' (`flow.mjs:247`), see W-03. Marketplace exclusion: see W-01. |
| 3 | Owner sees proposed common failures with mention counts and cheaper alternative parts from forums and app users; user-submission proposals only when 3+ distinct users agree | VERIFIED (code) | Failures need 3+ mentions on 2+ hosts: `community.mjs:56-63` (`countMentions`); SQL floor `schema.sql:1171` and table check `schema.sql` known_issues `mentions >= 3`. Fixed category enum and verbatim quote checks: `community.mjs:42-50`, `flow.mjs:436-437`. Alternatives need 2 hosts plus verified price: `flow.mjs:474-485`. User agreement is 3+ distinct users, +-30% trim, aggregates only: `schema.sql:2413-2460` (`autopilot_user_agreement`), `community.mjs:trimmedMedian` (`parts.mjs:64-70`), code gate `flow.mjs:304`, SQL gate `schema.sql:1234-1238`. Admin shows mentions and users evidence: `src/pages/admin-proposals.js:88,108,112`. Known issues card: `src/data/known-issues.js:25`, `src/pages/dashboard.js`. |
| 4 | Owner sees newly detected Mazda models/generations/engines as draft `car_models` proposals; approving one makes it available in the app picker | VERIFIED (code) | Detection GCC-only, approved hosts only, id rule: `supabase/functions/autopilot/flow.mjs:498-547` (`runModels`), `models.mjs:17` (`modelId`), `models.mjs:83` (`diffModels`, no GCC market dropped). Draft proposal via `submit_proposal` car_model branch: `schema.sql:1176-1198`, id regex `schema.sql:1177`. Approval inserts car_models with status 'approved': `schema.sql:1409-1429`. Bulk refused: `schema.sql:1507`. Client picker: approved rows fetched `src/data/remote-catalog.js:42`, registered `src/data/catalog.js:666-680` (`registerModels`), picker reads CAR_MODELS at render. Live picker behaviour is a human item. |

**Score (code level):** 4/4 roadmap success criteria VERIFIED in code, with warnings W-01..W-03.

### Plan 04-10 Truths (owner-gated, reported as human_needed, not failed)

| Truth (04-10 must_haves) | Status | Evidence |
| ------------------------ | ------ | -------- |
| CI green on pushed commit incl. supabase/tests/*.sql before live apply | HUMAN_NEEDED | CI job defined: `.github/workflows/test.yml:69-80`. CI run status not checked here (no remote access in this read-only pass). |
| Owner applied schema.sql, seed-parts.sql, seed-sources.sql in order | HUMAN_NEEDED | Files exist: `supabase/schema.sql`, `supabase/seed-parts.sql`, `supabase/seed-sources.sql` (comment-only template, owner chose empty per 04-03). |
| Autopilot function redeployed with Phase 4 stages | HUMAN_NEEDED | Stage map present: `supabase/functions/autopilot/index.ts:14`. Deploy not done. |
| Live Check-now run produced run report with parts and community jobs | HUMAN_NEEDED | Enqueue logic: `schema.sql` autopilot_start_run (rotation, manual car, no models for manual). Live run not done. |
| Approving one part proposal changes app price after refresh; revert restores | HUMAN_NEEDED | Overlay code: `src/data/remote-catalog.js:143-178` (`applyParts`, catPrice ownership rule). Revert: `schema.sql` revert_change part branch (~1570-1585). Live run not done. |

`supabase/functions/autopilot/README.md` apply/deploy runbook (04-10 artifact) is not yet updated: the 04-10 plan lists it in files_modified and it has not been done, consistent with the plan being unchecked in ROADMAP.md.

## Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `supabase/schema.sql` (Phase 4 block) | Gate kinds, tables, RLS, budget, user agreement | VERIFIED | catalogue_parts `:2307`, known_issues `:2322`, RLS policies ~`:2332-2345`, autopilot_due `:2386`, autopilot_budget_left `:2399`, autopilot_user_agreement `:2413`, stage/kind constraints and nulls-not-distinct index `:2360-2385` region. Not executed. |
| `supabase/seed-parts.sql` | Baseline prices from catalog.js | VERIFIED | Generated, idempotent `on conflict do nothing`, CI applies it at `.github/workflows/test.yml:71`. |
| `supabase/seed-sources.sql` | Owner host seed template | VERIFIED | Comment-only, owner chose empty (04-03). Intentional. |
| `supabase/functions/autopilot/parts.mjs` | Pure gates | VERIFIED | 81 lines; functions at `:14,:23,:42,:58,:64`. |
| `supabase/functions/autopilot/community.mjs` | Pure gates | VERIFIED | 114 lines; functions at `:42,:56,:92,:109`. |
| `supabase/functions/autopilot/models.mjs` | Pure gates | VERIFIED | 94 lines; functions at `:17,:40,:66,:83`. |
| `supabase/functions/autopilot/flow.mjs` | runParts, runCommunity, runModels | VERIFIED | `runParts` `:202`, `runCommunity` `:387`, `runModels` `:498`, `budgetGuard` `:179`. |
| `supabase/functions/autopilot/index.ts` | Stage dispatch and db adapters | VERIFIED | STAGES map `:14`; cfg `:121-124`; `loadLiveParts`, `loadAllModels`, `stagedFindings` `:155-166`. |
| `src/pages/admin-proposals.js` | Renders and edits new kinds | VERIFIED | KIND_LABELS `:31`, indicative pill `:105`, edit specs `:238-263`. |
| `src/data/remote-catalog.js` | Fetch parts, applyParts, model select | VERIFIED | `:42`, `:69`, `:143-178`. |
| `src/data/catalog.js` | registerModels | VERIFIED | `:666-685`. |
| `src/pages/parts.js` | Indicative pill | VERIFIED | `:205`. |
| `src/data/known-issues.js` | Known issues fetch | VERIFIED | `:25`, card in dashboard. |
| `supabase/functions/autopilot/README.md` | Phase 4 runbook | NOT_DONE (owner plan 04-10) | Expected to be unfinished until 04-10 runs. |

## Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| flow.mjs runParts | parts.mjs gates | import + calls `:284`, `:289`, `:280` | WIRED | Gates imported at `flow.mjs:16`. |
| flow.mjs runCommunity | community.mjs gates | countMentions / parseFailures | WIRED | Imports present; `countMentions` used at `flow.mjs:452`. |
| flow.mjs runModels | models.mjs gates | diffModels / modelId / groundModels | WIRED | `flow.mjs:513-537`. |
| flow.mjs | db.stageFindings | `autopilot_stage_findings` RPC | WIRED | `index.ts:149`; SQL `schema.sql:2030-2045`, kind and car-null check. |
| autopilot_publish_run | submit_proposal | per finding loop | WIRED | `schema.sql:2182+` loop, `submit_proposal` call; banned host check per evidence url. |
| submit_proposal (part) | catalogue_parts (live) | proposal_live hash keys | WIRED | `schema.sql:1063-1070` keys match submit hash `:1190-1196` (tag, brand, part_no, price, price_basis, note). |
| apply_proposal (car_model) | car_models insert | status 'approved' | WIRED | `schema.sql:1409-1429`. |
| remote-catalog refresh | catalog.registerModels | `register()` | WIRED | `remote-catalog.js:36`, `:52`. |
| remote-catalog applyParts | catalogue_parts overlay | `allParts()` select | WIRED | `remote-catalog.js:69`, `:143`. |
| autopilot_start_run | optional stages | rotation and `autopilot_due` | WIRED | `schema.sql` start_run block (parts/community ordering, models for monthly only); claim order `schema.sql` claim_job `:55-86`. |
| worker STAGES | runParts / runCommunity / runModels | dispatch map | WIRED | `index.ts:14`, `:93`. |

## Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| ----------- | -------------- | ----------- | ------ | -------- |
| PRT-01 | 04-01, 04-02, 04-05, 04-06, 04-07 | OEM parts confirmed by 2+ sources or official catalogue | SATISFIED (code) | parts.mjs:23-35; flow.mjs:280-286; schema.sql:1149-1165. See W-02. |
| PRT-02 | 04-03, 04-04, 04-06 | Indicative SAR prices from search and app users; no forbidden marketplaces | SATISFIED (code), see W-01 and W-03 | flow.mjs:289-291, 343; parts.js:205. |
| PRT-03 | 04-01, 04-02, 04-06 | Materiality threshold | SATISFIED | parts.mjs:14-18; flow.mjs:326, 343; schema.sql:1294-1303. |
| COM-01 | 04-02, 04-04, 04-08, 04-09 | Common failures with mention counts and sources | SATISFIED | community.mjs:56-63; flow.mjs:387-496; schema.sql:1171, known_issues check. |
| COM-02 | 04-02, 04-04, 04-06, 04-08 | Cheaper alternatives from forums and app users | SATISFIED | flow.mjs:474-486 (forum); flow.mjs:304-318 (users); schema.sql:1163. |
| COM-03 | 04-01, 04-04, 04-06, 04-08 | User submissions only when 3+ distinct users agree; outliers trimmed | SATISFIED | flow.mjs:304; parts.mjs:64-70; schema.sql:1234-1238; schema.sql:2413-2460. |
| NEW-01 | 04-01, 04-02, 04-07, 04-08 | New models as draft car_models proposals | SATISFIED | flow.mjs:498-547; models.mjs:83; schema.sql:1176-1198, 1409-1429; catalog.js:666. |

No orphaned requirements: REQUIREMENTS.md maps exactly these 7 IDs to Phase 4, and every one appears in at least one plan's `requirements` field.

## Anti-Patterns and Debt Markers

- TBD / FIXME / XXX in phase-modified files: none found in the phase's key files checked. No blocker.
- `ponytail:` comments are deliberate simplification notes (flow.mjs readPage, models budget note). Not debt markers.
- No `return null` / empty-handler stubs in the new gate or UI code paths reviewed.
- Hardcoded `[]` in `schema.sql` `paints` default and `markets` default are intentional (`'[]'::jsonb`, `'{KSA}'`).

Severity: none at Blocker level. Informational only.

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full unit test suite incl. edge-autopilot-flow, parts, community, models, rls-coverage, seed-parts, remote-catalog-parts, known-issues | `npm test` | 1051 pass, 0 fail, exit 0 | PASS |
| SQL behaviour (proposals.sql, autopilot.sql) | none local (no Postgres) | not run | SKIP (human, CI rls job) |
| Live autopilot run | not allowed (paid, owner-gated) | not run | SKIP (human) |

## Probe Execution

No probe scripts (`scripts/*/tests/probe-*.sh`) are declared for this phase. Skipped with reason: phase is not a migration or CLI tooling phase.

## Human Verification Required

1. **CI SQL run.** Confirm the CI `rls` job passes on the pushed commit, especially `supabase/tests/proposals.sql` and `supabase/tests/autopilot.sql`. The Phase 4 SQL has never executed (04-01, 04-04, 04-08 summaries all say so). `nulls not distinct` needs PostgreSQL 15 or later.
2. **Owner schema apply (04-10 Task 1).** Apply `schema.sql`, then `seed-parts.sql`, then `seed-sources.sql`, in that order.
3. **Dealer page smoke (free).** `node supabase/functions/autopilot/smoke.mjs --ppl`. The earlier run was inconclusive (sandbox DNS). Until it shows SAR matches, dealer prices stay manual.
4. **Edge redeploy and one Check-now run.** Expect run report entries for parts and community (done or skipped with reason), and proposals in #admin per kind.
5. **Part approve, refresh, revert.** The app price changes after refresh and reverts after revert.
6. **Car model approve.** The new model appears in the picker after refresh.
7. **Visual and i18n.** The indicative pill (EN and AR) in the parts list and the admin diff only on non-dealer prices; Known issues card on the dashboard.
8. **Owner decisions.** W-01 (seed banned marketplaces), W-02 (accept dealer-list-as-non-number-source), W-03 (accept D-08 dealer prices unlabelled versus SC2 wording).

## Gaps Summary

No blocking gaps found. All four roadmap success criteria and all seven Phase 4 requirements are implemented in the codebase, wired end to end (gates, SQL gate, worker stages, admin UI, app overlay and picker registration), and covered by the passing unit suite (1051/1051).

Status is `human_needed`, not `passed`, for three reasons:
- Plan 04-10 (owner schema apply, edge deploy, live smoke test) is intentionally owner-gated and unchecked. Reported as human_needed per instruction.
- The Phase 4 SQL has never been executed against Postgres.
- Warnings W-01 to W-03 need an owner decision on wording or policy.

---

_Verified: 2026-11-11_
_Verifier: Claude (gsd-verifier)_
