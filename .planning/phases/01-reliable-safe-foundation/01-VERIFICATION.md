---
phase: 01-reliable-safe-foundation
verified: 2026-11-05T00:00:00Z
status: human_needed
score: 5/5 roadmap truths verified in code; 4 need human/env confirmation
gaps: []
human_verification:
  - test: "Run supabase/tests/*.sql and CI 'rls' job (push branch, watch Actions)"
    expected: "All 8 SQL tests pass; deliberately broken policy turns the job red"
    why_human: "No Docker/psql here; FND-04 and RLS side of FND-02 (app_errors-rls.sql) unrun"
  - test: "Staging: fund Anthropic account, trigger plan-intake for a car with a changed source and one with NHTSA years"
    expected: "Drafts written via batched calls; recalls upserted; redirect Location case refused"
    why_human: "Model step and NHTSA untested (no credit); A2 (Location visible under redirect:'manual') inferred, not observed"
  - test: "Browser: break a save (offline sync / throw in afterSave)"
    expected: "Warn toast 'Saved on this device, but sync failed'; row appears in app_errors (01-05, 01-06)"
    why_human: "Real-browser toast and error-logger flow not run"
  - test: "Browser: install SW with one precache URL 404, go offline"
    expected: "App loads; precache failure relayed to app_errors (01-07)"
    why_human: "Real SW install not run"
  - test: "Open #admin as owner, Errors tab"
    expected: "Grouped client + edge-function errors visible (01-10)"
    why_human: "UI and RLS read path not exercised"
  - test: "curl an edge function with Origin: https://evil.example against deployed function"
    expected: "403"
    why_human: "Unit-tested only (edge-cors.test.js); deployed behavior not observed"
---

# Phase 1: Reliable & Safe Foundation Verification Report

**Goal:** Users and the owner can trust the app: failures are visible, server endpoints are locked down, offline shell stays healthy.
**Status:** human_needed. No code gaps found; several checks cannot run here.
**Note:** ROADMAP marks `mode: mvp` but the goal is not in "As a..., I want..., so that..." form. Verified against the standard goal and the 5 success criteria instead. Suggest `/gsd mvp-phase 1` or clearing the mode.

## Evidence run
- `node --test "test/**/*.test.js"`: 826 tests, 826 pass, 0 fail.
- `test/precache.test.js` and `sw-version.test.js` pass, so `sw.js` CACHE `garage-74bfc970fde9` is current. `npm run sw:version` is therefore a no-op now; nothing to commit.
- Caveat: `main.js` is the newest-modified file and is in ASSETS. The hash test passing in this run is the proof. Re-run `npm run sw:version` if anything precached changes after this report.

## Observable truths (roadmap contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Save failure shows toast, logged, owner reads in #admin; edge errors too | VERIFIED in code; UI human | `session.js:169-173` catches afterSave, calls `report` (errorLog) and `env.notify(..., 'warn')`. `main.js:542,546` global handlers. `admin.js:173` reads `app_errors`. Both edge functions import `logEdgeError`. `schema.sql:834` table. Browser run not done |
| 2 | Non-app origin rejected | VERIFIED (unit) | `cors.mjs` corsDecision refuses non-listed origin; both functions return 403 before work. No `Allow-Origin: *` anywhere. Deployed curl not run |
| 3 | Broken RLS policy or changed vendor/supabase.js fails CI | PARTIAL: vendor VERIFIED; RLS human | `vendor-pin.test.js` passes, `pins.json` sha256/bytes present. `test.yml` has `rls` job running all 8 SQL files, `rls-coverage.test.js` enforces allowlist. SQL never executed |
| 4 | Offline install tolerant, no hand cache bump, SWR + bounded caches | VERIFIED (unit); browser human | `sw.js`: per-file install with failure report, content-hash CACHE, `swr()` for modules and photos, PHOTO_MAX=6 LRU trim. `sw-install/sw-cache/sw-version` tests pass |
| 5 | All external fetches via one tested safeFetch; plan-intake no per-item DB trips | VERIFIED (unit); staging partial | plan-intake uses `safeFetch` for source pages and NHTSA; only plain fetch is constant `api.anthropic.com` (documented exception). `edge-safe-fetch.test.js`, `edge-plan-intake-batching.test.js` pass. Batched select/delete/insert/upsert per car in code |

## Requirements coverage

| ID | Status | Notes |
|----|--------|-------|
| FND-01 | SATISFIED (code) | session.js toast + log; retry-toast and session-save-log tests pass. Browser unrun |
| FND-02 | NEEDS HUMAN | Code + table + admin tab present; app_errors-rls.sql and Errors tab unrun |
| FND-03 | SATISFIED (unit) | cors.mjs, edge-cors tests |
| FND-04 | NEEDS HUMAN | CI job defined; cannot run |
| FND-05 | SATISFIED (unit) | safe-fetch.mjs, net-guard, dns-logic. A2 inferred only |
| FND-06 | SATISFIED | pins.json + test passing |
| FND-07 | SATISFIED (unit) | sw.js install; SW install in browser unrun |
| FND-08 | SATISFIED (unit) | swr + trim |
| FND-09 | SATISFIED | `src/data/car-photos.js` map; `freshAsset` gone from src; dashboard uses `carPhotos.photoUrl`; car-photos test passes |
| FND-10 | SATISFIED in code | batching test passes; live staging run of model/NHTSA paths blocked (no credit) |
| FND-11 | SATISFIED | AGENTS.md holds only the car-asset section |

All 11 IDs appear in PLAN frontmatter and REQUIREMENTS.md. No orphans. REQUIREMENTS.md checkboxes still show "Pending" and should be ticked after human items clear.

## Anti-patterns
- No TBD/FIXME/XXX scan hits beyond empty `catch (e) {}` in `error-log.js`, `session.js:53`, `storage.js` (best-effort localStorage/IDB cleanup, not save paths). Info only.
- `main.js` save call sites no longer use empty catch for afterSave.

## Gaps summary
None blocking in code. Phase cannot be called passed until the human items above are done, mainly CI/RLS, staging model+NHTSA, and the browser checks.

## Agent-run human checks (2026-11-11)
Run without the owner. Ad-hoc Playwright spec (http project, Chromium) was deleted afterwards; the commands are in this list.

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | CI `rls` job runs all SQL tests | DONE | CI fully green on 2b1fd61 (rls, test, deno, browser). Proof that a broken policy turns it red: rls failed on the single-engine Wiper assertion before 2b1fd61 fixed it |
| 3 | Browser: break a save | DONE (toast) | `enqueueVehicle` patched to throw via route; `session.save()` resolved true and the warn toast "Saved on this device, but sync failed" was visible |
| 4 | SW install with a precache 404, then offline | DONE | `assets/mazda3-studio.webp` served 404: install completed, `garage-meta` held `/__precache-report`. Offline reload booted from SW cache (controller present). After a reload with the backend client loaded (Supabase stubbed locally), `POST /rest/v1/app_errors` sent `precache missing: ./assets/mazda3-studio.webp, ./vendor/supabase.js`, and the report was deleted. The relay runs only inside `connectBackend()`, so the report stays queued until a client exists |
| 6 | Deployed CORS with a foreign Origin | DONE | garage-staging, anon key: `plan-intake`, `read-bill`, `autopilot` give OPTIONS 403 and POST 403 for `https://evil.example`. `https://alibashuaib.github.io` gets OPTIONS 200 with a matching `Access-Control-Allow-Origin` |

Still owner-only:
- #2: fund the Anthropic account and run plan-intake live.
- #5: open `#admin` Errors tab as owner. Real staging rows, owner RLS read path.
