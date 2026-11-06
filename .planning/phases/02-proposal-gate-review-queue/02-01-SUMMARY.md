---
phase: 02-proposal-gate-review-queue
plan: 01
subsystem: database, admin-ui
tags: [postgres, rls, security-definer, proposals, approval-gate, vanilla-js]
requires: []
provides:
  - "makers, proposals, change_log tables with RLS and RPC-only writes"
  - "submit_proposal (service role only) and apply_proposal (admin, stale refusal with seen-hash rebase)"
  - "Proposals tab (default admin tab) with list, expand, escaped evidence, approve"
affects: [02-02, 02-03, 02-04, 02-05]
tech-stack:
  added: []
  patterns: ["md5 of live fields as optimistic lock", "never-reject data fns returning {ok,error}", "textContent-only rendering of scraped text"]
key-files:
  created:
    - src/pages/admin-proposals.js
    - supabase/tests/proposals.sql
    - test/admin-proposals-render.test.js
    - test/admin-proposals-data.test.js
    - test/proposal-gate-static.test.js
  modified:
    - supabase/schema.sql
    - .github/workflows/test.yml
    - src/data/admin.js
    - src/pages/admin.js
    - index.html
    - sw.js
    - styles.css
    - src/i18n/strings.ar.js
    - test/admin-page.test.js
    - test/admin-review-page.test.js
    - test/helpers/boot.js
key-decisions:
  - "Stale refusal never changes proposal status; owner edits against live via p_seen_hash rebase (must still equal live hash under row lock)"
  - "Confidence weights are in SQL proposal_confidence and tunable: official 2 / secondary 1 / community 0, +1 two hosts, +1 change <=25%, -1 >50%"
  - "submit_proposal does not yet supersede/dedupe; a second pending proposal for the same target hits the proposals_one_pending unique index (02-03 adds that inside the same advisory lock)"
requirements-completed: [CORE-01, CORE-02, CORE-05, CORE-06, CORE-07, REV-03, REV-09]
duration: 40min
completed: 2026-11-05
---

# Phase 2 Plan 01: Proposal gate and Proposals tab Summary

Approval gate in SQL (proposals, change_log, makers; submit_proposal and apply_proposal with stale refusal) plus a default Proposals admin tab that lists pending rows, expands diff/confidence/escaped sources, and approves through the RPC.

## Tasks

| Task | Commit | Notes |
|------|--------|-------|
| 1 RED tests | 7636bbb | render, data, static tests |
| 2 SQL gate + CI test | 62f1b2c | schema.sql section, supabase/tests/proposals.sql, workflow line |
| 3 Proposals tab | ae2cdcf | data fns, page, wiring, CSS, Arabic, legacy test updates |

`npm test`: 848 pass, 0 fail. `supabase/tests/proposals.sql` cannot run locally (no psql/Docker); it is proven only by the CI `rls` job.

## Deviations from Plan

**1. [Rule 3 - Blocking] boot.js SCRIPTS list** - `test/helpers/boot.js` asserts its script list equals index.html; added `src/pages/admin-proposals.js` there. Commit ae2cdcf.

No other deviations.

## Known Stubs

None. Stale refusal in the UI shows the generic "Could not save" message; the live-value alert, Edit and Reject are scheduled for 02-02/02-03 per the plan.

## Threat Flags

None beyond the plan's threat model.

## Self-Check: PASSED
