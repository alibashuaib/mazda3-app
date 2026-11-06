---
phase: 03-monthly-autopilot-for-schedules-recalls
plan: 04
subsystem: database
tags: [postgres, rls, pg_cron, autopilot, supabase]
requires: [03-02]
provides:
  - "autopilot_* tables, source_domains, proposals_run_fk"
  - "autopilot_reserve/settle, start_run/claim_job/finish_job/end_run/stage_findings/publish_run, source hash + domain RPCs, cron"
affects: [03-05, 03-06, 03-07, 03-08]
key-files:
  created: [supabase/tests/autopilot.sql, test/schema-autopilot.test.js]
  modified: [supabase/schema.sql, test/rls-coverage.test.js, .github/workflows/test.yml]
decisions:
  - "Worker RPC shapes fixed here: settle(reservation, model, usage); finish_job(id, ok, err, notes jsonb); stage_findings(run, car, kind, rows)"
  - "notes jsonb on autopilot_jobs feeds the report: {dropped:{reason:n}, skipped:[...], unchanged:bool}"
  - "cron work poke reads app.autopilot_url / app.autopilot_secret DB settings, so no secret or fake URL is committed"
metrics:
  tasks: 3
  commits: 1
  completed: 2026-11-06
---

# Phase 3 Plan 04: Autopilot SQL core Summary

Race-free Postgres layer for the autopilot: queue, SAR 40 cap and kill switch under an advisory lock, staged findings with publish-only-if-clean, domain ban, item-status clock, report, monthly cron.

## Commits
- 32a6621: all three tasks (they edit the same files interleaved, so one atomic commit)

## What was built
- Tables (all RLS, admin select only, no write policy, writes via RPC): autopilot_config (cap 40, usd_sar 3.75, prices seeded, gcc_domains empty), autopilot_runs, autopilot_jobs, autopilot_spend, autopilot_findings, source_domains, autopilot_sources, autopilot_item_status (`unverified` generated from missed_runs >= 2). FK proposals_run_fk.
- Cap: `autopilot_reserve(run, est_sar)` returns killed / run_ended / cap / reservation_id; `autopilot_settle` mirrors costUsd (tiering, cache write, fail closed).
- Queue: claim uses SKIP LOCKED, reclaims stale (counts as attempt), publish waits for all others, extract waits for its car's discover. Failures back off 2/4 min then fail at 3; failed publish job aborts run.
- Publish: only running run with no open jobs; per-finding error is isolated; status failed if any job failed; monthly-only item status; noop counts verified; report jsonb (REV-07).
- Admin RPCs: autopilot_set_enabled, ban_source_domain (rejects pending, 'banned source', subdomains), approve_source_domain (banned is permanent).
- Cron: autopilot-monthly (0 3 1 * *) and autopilot-work (*/5), inside pg_available_extensions guard.

## Deviations from Plan
1. **[Rule 1 - Plan error] Job count**: plan says 16*3+1 but seed-catalogue has 30 approved cars. SQL test computes `approved cars * 3 + 1` dynamically.
2. **[Rule 2 - Missing] Extract waits for discover** in claim_job (not in plan): otherwise a discover retry could be overtaken.
3. **[Rule 2] Unchanged-source exemption**: extract job `notes.unchanged = true` means the car is neither verified nor missed. Without it, sources skipped by hash (ENG-08) would flag every item unverified after two quiet months. Plan 03-05 should set `unchanged` when every source hash matched.
4. **[Rule 2] settle takes the model** (`autopilot_settle(res, model, usage)`) since reserve does not record one.
5. Cron work poke uses DB settings instead of a placeholder URL/secret (plan: documented comment, not a real value).
6. cache_write prices are an assumption (1.25x input); owner-editable in autopilot_config.prices.

## Verification
- `node --test test/rls-coverage.test.js test/schema-autopilot.test.js` and full `npm test` (905) pass.
- **supabase/tests/autopilot.sql was NOT executed** (no Postgres in this environment). It runs in the CI `rls` job; first CI run may need small fixes.

## Known Stubs
None.

## Self-Check: PASSED
Files and commit 32a6621 exist.
