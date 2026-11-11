---
phase: 04-parts-prices-community-new-models
verified: 2026-11-11
status: human_needed
score: 3/4 roadmap success criteria VERIFIED in code (SC1 UNCERTAIN, W-06); 0/5 plan-04-10 live truths verified (owner-gated)
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 4/4 roadmap SC verified in code (prior report, HEAD 1090a2f)
  gaps_closed:
    - "CI SQL behaviour tests not yet run: now run and green in CI rls job on 2b1fd61 (schema.sql, seed-parts.sql, tests/proposals.sql, tests/autopilot.sql)"
    - "Code review CR-01 (invalid citation host failed the run): fixed, index.ts:155-161"
    - "Code review CR-02 (no-usage success settled at 0): fixed, flow.mjs:52-58"
    - "WR-01..WR-10 review fixes present (see Anti-Patterns and Requirements tables for file:line)"
    - "Security: price_observations own-rows read (schema.sql:352-354); price_items created_by not readable (schema.sql:338-339); community-only confidence capped at medium (schema.sql:1133); anon revoked on price_item_averages (schema.sql:372)"
    - "Integration F4/F11: admin car_model approval via gated RPC approve_car_model (schema.sql ~1488-1504)"
    - "CI: test.yml rls job applies Phase 4 SQL; all four jobs green on push 42931270126 (2b1fd61)"
  gaps_remaining:
    - "W-06 (new): number-less OEM part proposals from a single source can be queued (see Gaps)"
  regressions: []
gaps:
  - truth: "SC1: OEM part proposals (name, part number, fitment) are shown only when 2+ sources or an official catalogue confirm them"
    status: partial
    reason: "The 2-host rule is enforced for part numbers (parts.mjs:23-35, flow.mjs:292-294). A price-only OEM row with no part number is not gated: when a generic part has no confirmed number, flow.mjs:326 only requires pn or pr, and the single-source citation price (flow.mjs:296-299) stages an OEM row with part_no '' (flow.mjs:340). submit_proposal (schema.sql:1160-1176) accepts an empty part_no. The row is confidence 'medium' (single domain, schema.sql:1131), so it is not bulk-approved, but it does reach the owner queue."
    artifacts:
      - path: "supabase/functions/autopilot/flow.mjs"
        issue: "runParts stages OEM rows with part_no '' when only a single-source price exists (lines 326, 330, 340)."
      - path: "supabase/schema.sql"
        issue: "submit_proposal part branch (1160-1176) has no part-number or host-count requirement for OEM rows."
    missing:
      - "Owner decision: either accept single-source price-only OEM proposals (indicative, medium tier) as in-spec, or require a confirmed part number (2 hosts) before staging an OEM row. Enforcing it means returning from runParts before line 357 when no pn is confirmed for an OEM target."
deferred: []
human_verification:
  - test: "Owner applies schema.sql, then seed-parts.sql, then seed-sources.sql (04-10 Task 1), and sets app.autopilot_url and app.autopilot_secret (pg_cron settings)"
    expected: "Apply succeeds; catalogue_parts and known_issues exist with RLS; autopilot_config has min_pct, min_sar, optional_cars_per_run, optional_floor_sar, dealer_price_urls; cron jobs autopilot-monthly and autopilot-work are scheduled"
    why_human: "Live database writes and secret settings are owner-only."
  - test: "Run `node supabase/functions/autopilot/smoke.mjs --ppl` (free)"
    expected: "Dealer page readable with SAR matches > 0; otherwise dealer prices stay manual and runParts records 'skipped'"
    why_human: "Needs live network to the dealer host; earlier sandbox run was inconclusive."
  - test: "Redeploy the autopilot edge function and run one Check-now on one car"
    expected: "Run report lists parts and community jobs as done or skipped with a reason; proposals appear in #admin per kind (Part, Known issue, New model)"
    why_human: "Live deploy and paid search. Owner-gated."
  - test: "Approve one part proposal in #admin, refresh the app, then revert it"
    expected: "Price in the parts list changes after refresh and returns after revert; change_log has both entries"
    why_human: "End-to-end live behaviour."
  - test: "Approve one car_model proposal and check the app picker"
    expected: "New model appears in the picker after refresh, with its engine and oil capacity (or none if unknown)"
    why_human: "Picker render and live approval."
  - test: "Visual and i18n check (EN and AR): indicative pill in parts list and admin diff; Known issues card on dashboard"
    expected: "Pill only on non-dealer prices; Known issues card lists approved failures with mention counts; no raw HTML"
    why_human: "Visual and i18n judgement."
  - test: "Owner decisions W-01, W-02, W-03, W-06 (see Gaps and Warnings)"
    expected: "Each accepted, or code/seed changed"
    why_human: "Policy and wording decisions."
---

# Phase 4: Parts, Prices, Community & New Models Verification Report

**Phase Goal:** The monthly run also proposes OEM parts, indicative SAR prices, community failures and cheaper alternatives, and new Mazda models for owner approval.
**Verified:** 2026-11-11
**Status:** human_needed
**Re-verification:** Yes. Replaces the prior report (HEAD 1090a2f, 1051 tests). Current HEAD 2b1fd61, working tree clean.

## Verification Method

- Read ROADMAP Phase 4 success criteria, REQUIREMENTS PRT-01..03, COM-01..03, NEW-01, and the current code. SUMMARY claims were not used as evidence.
- `npm test` at 2b1fd61: **1053 pass, 0 fail** (prior report: 1051).
- SQL was not executed locally (no Postgres). CI on push 42931270126 (commit 2b1fd61): jobs `browser`, `deno`, `test`, `rls` all success. The `rls` job ran `supabase/schema.sql`, `seed-catalogue.sql`, `seed-parts.sql`, `tests/proposals.sql`, `tests/autopilot.sql` with ON_ERROR_STOP (`.github/workflows/test.yml:60-80`). The prior report's "SQL never executed" is now stale.
- No source edits, no deploys, no DB writes, no paid calls.

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth (ROADMAP SC) | Status | Evidence |
| - | ------------------ | ------ | -------- |
| 1 | OEM part proposals (name, part number, fitment) only when 2+ sources or an official catalogue confirm them | ? UNCERTAIN (WARNING W-06) | Part numbers: `confirmParts` keeps only groups with `hosts.length >= 2` (`parts.mjs:23-35`); used at `flow.mjs:292`, single-source dropped at `flow.mjs:294`. Number candidates must pass fitment (`flow.mjs:288-289`, `parts.mjs:42-54`). Official-catalogue branch not built (`parts.mjs:20-21`, W-02). Gap: an OEM row can be staged with `part_no ''` from one citation price (`flow.mjs:296-299`, `:326`, `:340`), see Gaps. |
| 2 | SAR price proposals labelled "indicative"; changes under the materiality threshold not queued | ✓ VERIFIED, open wording point W-03 | Citation prices only from the claim URL's own quote: `flow.mjs:297-299`, `priceFromCitation` (`parts.mjs:58-61`), basis `indicative`. App-user median basis `indicative` (`flow.mjs:316`). Materiality (both `min_pct` and `min_sar`): `parts.mjs:14-18`, code gate `flow.mjs:332-335`, SQL gate `schema.sql:1309-1316` (returns `immaterial`). Defaults `min_pct 0.10`, `min_sar 5` (`index.ts` cfg, `schema.sql` config). Basis change or new part number always queues (`flow.mjs:334`, `schema.sql:1305-1307`), by design. Pill: `src/pages/parts.js:188,207`, `src/pages/admin-proposals.js:105`. Dealer prices use basis `dealer` and no pill (`flow.mjs:255`), see W-03. |
| 3 | Proposed common failures with mention counts; cheaper alternatives from forums and app users; user-submission proposals only when 3+ distinct users agree | ✓ VERIFIED | Failures: 3+ mentions on 2+ hosts (`community.mjs:56-68`, filter at `:67`); category enum and quote-word rules (`community.mjs:6-9`, `:39`, `:42-52`); mentions and quote verbatim (`flow.mjs:445`, `:455`). Forum alternatives: brand plus part number on 2 hosts, verified price (`flow.mjs:480-488`). App-user agreement: aggregates, median trimmed +-30% (`parts.mjs:64-70`), privacy floor 5 (`flow.mjs:312`; SQL `schema.sql:2468` `having count(*) >= 5`), SQL floor 3 for users evidence (`schema.sql:1249`). SQL failure floor (`schema.sql:1182`) and table check (`schema.sql:2362`). Known-issues read: `src/data/known-issues.js:25`, dashboard card `src/pages/dashboard.js:303-305`. Admin mentions/users evidence rendered per kind (`src/pages/admin-proposals.js:88-112`). |
| 4 | Newly detected Mazda models/generations/engines as draft car_models proposals; approving one makes it available in the picker | ✓ VERIFIED (code), live check human | Detection GCC-only and approved hosts only: `flow.mjs:506-523` (no-GCC skip at `:510`, approved-host filter `:521`). Id rule and parse: `models.mjs:17-26`, `validModelId` `models.mjs:62`, `flow.mjs:544`. Grounding: `models.mjs:69-85`, quotes `flow.mjs:533`. GCC-only diff: `models.mjs:89-100` (skip at `:92`). Staged as `car_model` with null car: `flow.mjs:549`, `schema.sql:2061-2079`. Draft proposal kind check: `schema.sql:1150-1153`, car_model id and field checks `schema.sql:1187-1200`. Approval inserts `car_models` status `approved`: `schema.sql:1434` (`apply_proposal` car_model branch, `1422-1440`). Bulk refused: `schema.sql:1538` (`not_bulk`). Admin single-approval gate: `approve_car_model` (`schema.sql` ~1488-1504). Picker: `src/data/remote-catalog.js:42` (approved only), `src/data/catalog.js:666-681` (`registerModels`, append-only). RLS read: `schema.sql` read_car_models `status = 'approved' or is_admin()`. |

**Score:** 3 VERIFIED, 1 UNCERTAIN (SC1, W-06). Status is not `gaps_found` because no truth is FAILED. Human items below keep status `human_needed`.

### Plan 04-10 Truths (owner-gated, reported as human_needed, not failed)

| Truth (04-10 must_haves) | Status | Evidence |
| ------------------------ | ------ | -------- |
| CI green on pushed commit incl. `supabase/tests/*.sql` before live apply | ✓ VERIFIED (CI) | Push run 42931270126 on 2b1fd61: all four jobs success. |
| Owner applied schema.sql, seed-parts.sql, seed-sources.sql in order | ? HUMAN_NEEDED | Files exist. Live apply is owner-only. |
| Autopilot function redeployed with Phase 4 stages | ? HUMAN_NEEDED | Stage map `supabase/functions/autopilot/index.ts:14`. Not deployed by this review. |
| Live Check-now run produced run report with parts and community jobs | ? HUMAN_NEEDED | Paid run, owner-gated. |
| Approving one part proposal changes app price after refresh; revert restores | ? HUMAN_NEEDED | Overlay `src/data/remote-catalog.js:143-178`; revert branch in `revert_change`. Live run not done. |

## Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `supabase/schema.sql` (Phase 4 block) | Tables, RLS, gates, RPCs, grants | ✓ VERIFIED | `catalogue_parts` `:2341`, `known_issues` `:2356`, read policies `:2371`, `:2376`, grants `:2380-2381`, `autopilot_user_agreement` `:2447`, `autopilot_due` section, `nulls not distinct` index (requires PG15; CI uses supabase local, passed). |
| `supabase/seed-parts.sql` | Baseline prices | ✓ VERIFIED | Applied in CI rls job. |
| `supabase/seed-sources.sql` | Owner host seed | ✓ VERIFIED (intentionally empty) | Comment-only template; no banned hosts seeded (W-01). |
| `supabase/functions/autopilot/parts.mjs` | Pure gates | ✓ VERIFIED | 81 lines. |
| `supabase/functions/autopilot/community.mjs` | Pure gates | ✓ VERIFIED | 115 lines. |
| `supabase/functions/autopilot/models.mjs` | Pure gates | ✓ VERIFIED | 100 lines. |
| `supabase/functions/autopilot/flow.mjs` | runParts, runCommunity, runModels, runPreview | ✓ VERIFIED | 585 lines. `paid` settle fix CR-02 `:52-58`. |
| `supabase/functions/autopilot/index.ts` | Stage dispatch, adapters | ✓ VERIFIED | STAGES `:14`; publish refusal WR-01 `:92-94`; seeDomain CR-01 `:155-161`. |
| `src/pages/admin-proposals.js` | Renders and edits new kinds | ✓ VERIFIED | KIND_LABELS `:31`, pill `:105`. |
| `src/data/remote-catalog.js` | Fetch parts, applyParts, models | ✓ VERIFIED | `:42`, `:69`, `:143-178`. |
| `src/data/catalog.js` | registerModels | ✓ VERIFIED | `:666-681`. |
| `src/pages/parts.js` | Indicative pill | ✓ VERIFIED | `:188`, `:207`. |
| `src/data/known-issues.js` | Approved failures fetch | ✓ VERIFIED | `:25`. |
| `supabase/functions/autopilot/README.md` | Phase 4 runbook | ? Owner plan 04-10 | Runbook commit `72e9e8e` and `7062112` exist; the 04-10 status in ROADMAP is still unchecked. |

## Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| flow.mjs runParts | parts.mjs gates | import and calls | ✓ WIRED | `confirmParts` `:292`, `checkFitment` `:288`, `priceFromCitation` `:297`. |
| flow.mjs runCommunity | community.mjs gates | import and calls | ✓ WIRED | `countMentions` `:460`, `parseFailures` `:436`. |
| flow.mjs runModels | models.mjs gates | import and calls | ✓ WIRED | `groundModels` `:533`, `diffModels` `:535`, `modelId` `:543`. |
| flow.mjs | db.stageFindings | `autopilot_stage_findings` RPC | ✓ WIRED | `index.ts` adapter; `schema.sql:2061-2079` (kind and car-null check). |
| autopilot_publish_run | submit_proposal | per finding loop | ✓ WIRED | `schema.sql:2216-2270`; banned-host check per evidence url `:2229`. |
| submit_proposal part | catalogue_parts overlay | same hash keys | ✓ WIRED | Hash keys `schema.sql:1270-1276` match proposal_live. |
| apply_proposal car_model | car_models insert | status `approved` | ✓ WIRED | `schema.sql:1434`. |
| remote-catalog refresh | catalog.registerModels | `register()` | ✓ WIRED | `remote-catalog.js:36`, `:47`. |
| remote-catalog applyParts | catalogue_parts overlay | `allParts()` select | ✓ WIRED | `remote-catalog.js:69`, `:143`. Anon/authenticated SELECT grant `schema.sql:2381`. |
| worker STAGES | runParts / runCommunity / runModels | dispatch | ✓ WIRED | `index.ts:14`. |

## Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| ----------- | -------------- | ----------- | ------ | -------- |
| PRT-01 | 04-01, 02, 05, 06, 07 | OEM parts confirmed by 2+ sources or official catalogue | ? UNCERTAIN (W-06, W-02) | Part numbers: `parts.mjs:23-35`, `flow.mjs:292-294`. Number-less OEM rows not gated (see Gaps). Official-catalogue branch not built. |
| PRT-02 | 04-03, 04, 06 | Indicative SAR prices; no forbidden marketplaces | ✓ SATISFIED (code), W-01 and W-03 open | Citation prices `flow.mjs:297-299`; only approved hosts reach prices (`flow.mjs:272-275`, `:428`); banned hosts removed (`flow.mjs:268` extractCitations with `cfg.banned`; `index.ts` loads `source_domains` banned; publish re-check `schema.sql:2229`). No marketplace seed (W-01). Reddit citations used but never fetched (`flow.mjs:378`, `:426`). |
| PRT-03 | 04-01, 02, 06 | Materiality threshold | ✓ SATISFIED | `parts.mjs:14-18`; `flow.mjs:334`; `schema.sql:1309-1316`. |
| COM-01 | 04-02, 04, 08, 09 | Common failures with mention counts and sources | ✓ SATISFIED | `community.mjs:56-68`; `flow.mjs:460-469`; `schema.sql:1182`, `:2362`. |
| COM-02 | 04-02, 04, 06, 08 | Cheaper alternatives from forums and app users | ✓ SATISFIED | Forum `flow.mjs:474-494`; users `flow.mjs:347-356`. |
| COM-03 | 04-01, 04, 06, 08 | User submissions only when 3+ distinct users agree; outliers trimmed | ✓ SATISFIED | `parts.mjs:64-70`; `flow.mjs:312`; `schema.sql:1249`; `schema.sql:2468`. |
| NEW-01 | 04-01, 02, 07, 08 | New models as draft car_models proposals | ✓ SATISFIED | `flow.mjs:506-551`; `models.mjs:89-100`; `schema.sql:1150-1153`, `:1434`, `:1538`. |

No orphaned requirements: REQUIREMENTS.md maps these 7 IDs to Phase 4 and each appears in a plan's `requirements` field.

## Anti-Patterns and Debt Markers

- No TBD / FIXME / XXX markers in the Phase 4 files reviewed. No blocker.
- Review fixes present: CR-01 (`index.ts:155-161`), CR-02 (`flow.mjs:52-58`), WR-01 (`index.ts:92-94`), WR-03 (`flow.mjs:236-237`), WR-04 (`flow.mjs:372-377`), WR-05 (`flow.mjs:534-535`), WR-06 (`flow.mjs:578-581`), WR-07 (`models.mjs:14-19`, `flow.mjs:544`), WR-08 (`flow.mjs:312`), WR-09 (`flow.mjs:176`), WR-10 (`flow.mjs:328-331`).
- Info: `flow.mjs:284` `continue` skips the price branch for a claim whose part_no fails the anchored regex, without a `dropped` count. Conservative, not a goal failure.
- Info: `flow.mjs:332-335` materiality compares only when basis and live row match. Basis change always queues, mirrored in `schema.sql:1305-1307`. Matches the documented design.
- Info: W-04 remains. `submit_proposal` part branch (`schema.sql:1160-1176`) does not count hosts for part numbers; the 2-host rule is code-only.

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full unit suite | `npm test` | 1053 pass, 0 fail | ✓ PASS |
| SQL behaviour (proposals.sql, autopilot.sql, schema) | CI `rls` job, push 42931270126 | success | ✓ PASS (CI) |
| Live autopilot run, dealer smoke | not run (paid or live network, owner-gated) | not run | ? SKIP (human) |

## Probe Execution

No probe scripts declared for this phase. Skipped: not a migration or CLI tooling phase.

## Human Verification Required

1. **Owner schema apply (04-10 Task 1).** Apply `schema.sql`, `seed-parts.sql`, `seed-sources.sql` in order. Set `app.autopilot_url` and `app.autopilot_secret` (pg_cron, `schema.sql` schedule block). Confirm cron jobs are scheduled.
2. **Dealer page smoke (free).** `node supabase/functions/autopilot/smoke.mjs --ppl`. Until SAR matches appear, dealer prices stay manual.
3. **Edge redeploy and one Check-now run.** Expect parts and community entries (done or skipped with reason) and proposals per kind in #admin.
4. **Part approve, refresh, revert.** Price changes after refresh and reverts after revert.
5. **Car model approve.** New model appears in the picker after refresh.
6. **Visual and i18n (EN and AR).** Indicative pill only on non-dealer prices; Known issues card.
7. **Owner decisions:**
   - W-01: seed banned marketplace hosts (noon.com, amazon.sa) into `source_domains`, or accept approval-gating as the protection.
   - W-02: accept D-05 (no official-catalogue branch) as documented.
   - W-03: confirm dealer prices stay unlabelled (D-08) against SC2 wording.
   - W-06: accept single-source price-only OEM proposals, or require a confirmed part number.

## Gaps Summary

**No FAILED truths. No BLOCKER.** One UNCERTAIN item (SC1 / W-06) needs an owner decision:

- **W-06 (SC1 / PRT-01):** A generic OEM part with no confirmed part number can be staged from one citation price (`flow.mjs:296-299`, `:326`, `:340`). The row has `part_no ''` and confidence `medium` (single domain, `schema.sql:1131`), so it is not bulk-approved, but it reaches the queue. The roadmap wording ("OEM part proposals ... only when 2+ sources ... confirm them") reads strictly against this. Fix if the owner wants it strict: return before staging an OEM row when no `pn` is confirmed (`flow.mjs` before line 357).

Warnings carried from the prior report (unchanged, owner decisions): W-01 (no banned marketplace seed), W-02 (no official-catalogue branch), W-03 (dealer prices unlabelled vs SC2 wording), W-04 (SQL has no 2-host check for part numbers; defence in depth). W-05 (REQUIREMENTS and ROADMAP still show Pending or unchecked for 04-10) is expected until the owner closes 04-10.

Status is `human_needed`: plan 04-10 is owner-gated, and W-06 plus the owner decisions need a human call.

---

_Verified: 2026-11-11_
_Verifier: Claude (gsd-verifier)_
