# Codebase Concerns

**Analysis Date:** 2026-11-04

Context: vanilla-JS PWA (no build step), Supabase backend, Node `--test` + Playwright. Branch `review-fixes` (1e46c32) already fixed: plan-intake `diffDraft` jsonb key order, cron-secret constant-time compare, read-bill `BILL_GLOBAL_DAILY_CAP=0` handling + 502 refund, `sw.js` `ignoreSearch` offline fallback, IDB `saveVehicle` photoIds, `.gitattributes`. Those are not repeated here.

## Tech Debt

**Dashboard photo cache-buster chain (known open):**
- Issue: `freshAsset` in `studioCarImage` is a nested ternary that appends a hand-written `?v=<model>-<fix>-<revision>` per model (`mazda3bp-cleanup-200`, `mazda6-wheel-logo-205`, `cx3-alignment-logos-207`, `mazda2-paint-fixes-209`, `cx-family-fixes-211`, `mazda3bm-framing-213`). Every approved image edit means editing this chain by hand. Revision numbers are coupled to `docs/CAR-ASSET-GUIDE.md` and `output/CAR-ASSET-LESSONS.md`. Models outside the chain get no buster, so stale cached photos can persist.
- Files: `src/pages/dashboard.js` (~lines 209-224), `sw.js`
- Impact: stale car photos after an edit; the chain grows without bound; the same asset URL is cached under many `?v=` keys.
- Fix approach: replace with one `ASSET_REV` constant (or a per-model map) and one `${url}?v=${rev}`. Better, derive the version from the SW `CACHE` name or content-hash the filenames.

**Manual service-worker bookkeeping:**
- Issue: `CACHE = 'garage-v213'` and the hand-listed `ASSETS` array in `sw.js` must be updated for every new file and every release. A new module missing from `ASSETS` is silently not precached, so offline boot fails. `install` uses `cache.addAll`, so one 404 in the list aborts the whole SW install.
- Files: `sw.js`
- Impact: offline breakage or a stuck old SW after adding or renaming modules.
- Fix approach: add a test that diffs `ASSETS` against the `<script>` imports and `src/**/*.js`. Optionally generate the list.

**Swallowed errors:**
- Issue: many empty `catch (e) {}` blocks, mostly around `localStorage` (acceptable), but also `try { ok = await save(); } catch (e) {}` in `main.js` (lines ~296, ~483) and `env.afterSave` in `src/data/session.js:169`. Failed saves and afterSave hooks leave no trace.
- Files: `main.js`, `src/data/session.js`, `src/data/storage.js`, `src/ui/chrome.js`
- Impact: silent data-loss paths are hard to diagnose; no error reporting exists.
- Fix approach: log or toast on the non-localStorage cases. Keep the `localStorage` swallows.

**Oversized modules:**
- Files: `src/pages/maintenance.js` (843 lines), `src/data/storage.js` (740), `src/data/account.js` (718), `main.js` (663)
- Impact: hard to review; account.js mixes auth, sync, and photo transfer.
- Fix approach: split on seams (sync vs auth in `account.js`; IDB backend vs facade in `storage.js`) when next touched.

**Stray non-code content:**
- Issue: `AGENTS.md` is an unrelated "Product Designer / TV UI" persona prompt, with only the last paragraph (car asset memory) relevant. It misleads agents about the project.
- Files: `AGENTS.md`
- Fix approach: trim to the car-asset section.

## Known Bugs

None confirmed beyond the open items in this file. The earlier SW offline-fallback bug is fixed on `review-fixes`.

## Security Considerations

**Wildcard CORS on edge functions:**
- Risk: `Access-Control-Allow-Origin: *` on `plan-intake` and `read-bill`. Auth is JWT or cron secret, so the risk is limited, but `read-bill` spends paid LLM quota on user-supplied images.
- Files: `supabase/functions/plan-intake/index.ts:7`, `supabase/functions/read-bill/index.ts:8`
- Current mitigation: JWT auth, per-user limit, and a global daily cap (`BILL_GLOBAL_DAILY_CAP`, `DAILY_CAP` in `logic.mjs`).
- Recommendation: restrict the origin to the deployed app origin.

**Anon key and project URL hardcoded:**
- Risk: `SUPABASE_URL` and `SUPABASE_ANON_KEY` are in `src/data/account.js:33-34`. The anon key is public by design, so all protection rests on RLS. A policy gap means a data leak.
- Current mitigation: SQL RLS tests in `supabase/tests/*.sql` (`shops-rls.sql`, `catalogue-rls.sql`, and others). These do not appear to run in CI (`.github/workflows/test.yml` only runs the Node and Playwright suites).
- Recommendation: run the SQL tests against a Supabase instance in CI. Review every new table for RLS in `supabase/schema.sql`.

**Raw innerHTML helper:**
- Risk: `el(tag, cls, html)` in `src/core/helpers.js:15` assigns raw `innerHTML`. About 120 `innerHTML`/`localStorage` uses exist across `src` and `main.js`. Safety depends on always using the escaping `html` tagged template from `src/ui/html.js`.
- Current mitigation: `test/no-raw-templates.test.js`.
- Recommendation: keep that test covering new files. Never pass user text (shop names, notes, AI bill output) to `el()` as a plain string.

**Untrusted LLM output:**
- Risk: `read-bill` and `plan-intake` ingest model output and web-sourced schedules. A plan draft is applied after admin review, but admin UI (`src/pages/admin.js`) renders those fields.
- Current mitigation: `parseBill` and `validateImage` in `logic.mjs`, and the `html` escaping template.
- Recommendation: keep the escaping contract on all admin renders.

## Performance Bottlenecks

**N+1 queries (known open):**
- Problem: per-item Supabase round trips in the loops of `plan-intake/index.ts` (per-car `dealer_plan_items` select, then per-item `plan_drafts` delete and insert, ~lines 100-110 of the function). The client sync in `src/data/account.js` can also do per-vehicle and per-photo requests.
- Files: `supabase/functions/plan-intake/index.ts`, `src/data/account.js`
- Cause: loops with `await` inside.
- Improvement path: fetch `dealer_plan_items` once per car (already per car, so hoist it out of the item loop), batch delete with `.in()`, bulk insert the drafts. On the client, batch vehicle upserts.

**Asset weight:**
- Problem: `assets/` is 77 MB across 135 files, with ~600 KB per car photo. The `webp` photos are fetched on demand. Offline coverage is only whatever the user viewed.
- Files: `assets/`, `sw.js`
- Improvement path: cap cache entries, or add a cache eviction policy so the runtime cache does not grow unbounded (the SW has no eviction). Old `?v=` variants also accumulate until the next `CACHE` bump.

**Network-first SW on every request:**
- Problem: `sw.js` always hits the network first, so a slow connection stalls module loading for ~45 scripts.
- Improvement path: stale-while-revalidate for the `src/` modules and photos.

## Fragile Areas

**Car asset pipeline:**
- Files: `docs/CAR-ASSET-GUIDE.md`, `output/CAR-ASSET-LESSONS.md`, `src/pages/dashboard.js`, `assets/`
- Why fragile: approved and rejected edits are tracked in prose, and the dashboard has per-model hacks (`CX_NORMALIZED_PHOTOS`, `colorSlug`). The slug match relies on the colour name format `Name (Code XXX)`; a catalogue rename silently falls back to the generic image.
- Safe modification: read both docs first. Do not reapply rejected edits (Mazda2 softening 175, Mazda3 chrome-notch 196).
- Test coverage: no automated check that every catalogue colour maps to an existing asset file.

**Sync and session (offline-first with Supabase):**
- Files: `src/data/account.js`, `src/data/session.js`, `src/data/storage.js`
- Why fragile: token-expiry fallback drops to anonymous while keeping local data (`account.js` ~652), pending-out id lists, an IDB version-change handler, and photo ids synced separately. Several of the bugs fixed on `review-fixes` were in this area.
- Safe modification: run `test/account.test.js`, `test/session.test.js`, `test/idb.test.js`, and `test/storage.test.js` after any change.

**Hand-wired globals / test seams:**
- Files: `main.js` (`window.__hasOnlineSyncListener`)
- Why fragile: test-only flags in production code.

## Scaling Limits

**Global daily LLM cap:**
- Current capacity: set by `BILL_GLOBAL_DAILY_CAP` (env) or `DAILY_CAP` default in `supabase/functions/read-bill/logic.mjs`.
- Limit: past the cap, all users get 429 until the next day.
- Scaling path: per-user quotas plus budget alerting.

## Dependencies at Risk

**Vendored Supabase client:**
- Risk: `vendor/supabase.js` is a hand-copied file with no version pin or update process (`vendor/README.md` exists).
- Impact: security fixes in supabase-js do not arrive.
- Migration plan: document the version and refresh cadence. Add a check that the file matches a recorded hash.

## Missing Critical Features

**Error and usage monitoring:** none detected. Client failures are swallowed or only visible in the console, and edge function failures only show up in the Supabase logs.

## Test Coverage Gaps

**Edge function entrypoints:**
- What's not tested: `supabase/functions/*/index.ts` (auth gate, cap handling, refund path). Only `logic.mjs` is plausibly Node-testable.
- Risk: the auth and cap regressions fixed in 1e46c32 live in `index.ts`.
- Priority: High

**SQL/RLS tests not in CI:**
- Files: `supabase/tests/*.sql`
- Risk: RLS regressions go unnoticed.
- Priority: High

**Service worker:**
- What's not tested: `sw.js` caching and fallback behaviour (the e2e smoke test in `e2e/smoke.spec.js` may only partially cover it); the `ASSETS` list is not verified against the files.
- Priority: Medium

**Dashboard image mapping:**
- Files: `src/pages/dashboard.js`
- Risk: no test for `studioCarImage` buster output or that mapped files exist.
- Priority: Medium

---

*Concerns audit: 2026-11-04*
