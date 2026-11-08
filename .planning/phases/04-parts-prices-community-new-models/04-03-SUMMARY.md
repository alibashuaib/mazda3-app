---
phase: 04-parts-prices-community-new-models
plan: 03
subsystem: autopilot
tags: [smoke, safe-fetch, source-domains]
requires: []
provides:
  - "smoke.mjs --ppl (free) and --citations (paid) modes"
  - "supabase/seed-sources.sql (comment-only template)"
affects: [04-04, 04-10]
key-files:
  created: [supabase/seed-sources.sql]
  modified: [supabase/functions/autopilot/smoke.mjs]
decisions:
  - "Owner chose 'empty': no GCC/forum/dealer hosts seeded now"
metrics:
  completed: 2026-11-08
---

# Phase 4 Plan 03: Smoke modes and owner host decisions Summary

Added `--ppl` (free safeFetch probe of the dealer price page) and `--citations` (one paid search call) to the autopilot smoke script; owner left host lists empty, so the seed file is a comment-only template.

## Results

- **--ppl (research A3): inconclusive.** Output: `ok:false error: blocked`, exit 1. In the sandbox `dns.lookup('www.mazda.com.sa')` returns ENOTFOUND, so this is a network/DNS limit of the sandbox, not proof the page is unreadable. Owner re-run (free): `node supabase/functions/autopilot/smoke.mjs --ppl`. Until it shows SAR matches > 0, dealer prices stay manual and runParts should skip the dealer step.
- **--citations (A6/A8): not run, deferred to the 04-10 live smoke.** Command: `ANTHROPIC_API_KEY=... node supabase/functions/autopilot/smoke.mjs --citations` (about SAR 0.05).
- **Task 2 owner choice: `empty`.** The models stage will report "skipped: no GCC domains" and community yield stays low until hosts are approved in the admin domain list. `supabase/seed-sources.sql` holds the on-conflict (`where status <> 'banned'`) and host-regex template in comments.

## Deviations from Plan

None. The plan expected a possible --ppl failure; the checkpoint was answered `empty`.

## Commits

- ded41b2: feat(04-03): add --ppl and --citations smoke modes
- seed file and this summary: see git log

## Self-Check: PASSED
