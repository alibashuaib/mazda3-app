# Phase 1: Reliable & Safe Foundation - Context

**Gathered:** 2026-11-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the app trustworthy before autopilot adds server code and scraped content (FND-01..FND-11):
failed saves are visible to the user and logged; client and edge-function errors land in a Supabase table the owner reads in `#admin`; edge-function CORS is locked to the app origin; RLS SQL tests run in CI; all server fetches of external URLs go through one tested `safeFetch`; `vendor/supabase.js` is version/hash pinned; the service worker survives a missing precache file, needs no hand cache bump, and serves modules/photos stale-while-revalidate with a bounded cache; car-photo cache busting comes from one version map; `plan-intake` has no per-item DB round trips; `AGENTS.md` keeps only project-relevant guidance (car-asset section).

No proposal table, review-queue changes or autopilot logic — those are Phases 2–4.

</domain>

<decisions>
## Implementation Decisions

### Error log (FND-01, FND-02)
- **D-01:** Log failed saves and `afterSave` hook failures, plus `window.onerror` and `unhandledrejection`. Rate-limit per session so one loop cannot flood the table. Do not log normal offline/sync failures (offline is expected in this app).
- **D-02:** Signed-out users can log too: insert-only RLS for the `anon` role, with column length caps and a per-device throttle. No anon select/update/delete.
- **D-03:** A row holds only: message, stack, route/page, app version, source (`client` or edge-function name), timestamp, user id if signed in. Never vehicle data, notes, photos or the failed record payload.
- **D-04:** Retention 90 days, cleaned up by a pg_cron job.
- **D-05:** Edge-function errors (`read-bill`, `plan-intake`, later autopilot functions) write to the same table with `source` set to the function name.
- **D-06:** `#admin` gets a separate **Errors** tab with a count badge, next to the existing review queue. Sets the tab pattern Phases 2/3 will extend.
- **D-07:** Errors tab groups rows by message: count, first/last seen, source; expand to see recent stacks; owner can mark a group resolved. Admin-only select via RLS.

### Failed-save toast (FND-01)
- **D-08:** On save failure show: "Couldn't save. Your changes are still on screen." (wording may be tuned) with a **Retry** button that re-runs the same save.
- **D-09:** The toast stays until dismissed or until a retry succeeds (reuse the long-lived toast mechanism the delete-undo toast already uses in `src/ui/chrome.js`).
- **D-10:** Uncaught errors are silent to the user — logged only.
- **D-11:** Plain words only, no error codes; English + Arabic via `t()` / `src/i18n/strings.ar.js`.
- **D-12:** Keep the existing `localStorage` `catch (e) {}` swallows; only save paths (`main.js` ~296, ~483; `src/data/session.js:169`) change.

### CORS (FND-03)
- **D-13:** Production allowlist: `https://alibashuaib.github.io` (GitHub Pages, repo `alibashuaib/mazda3-app`).
- **D-14:** Reject `Origin: null` (what `file://` and sandboxed iframes send). From `file://`, bill reading fails gracefully and the manual form keeps working (offline-first rule).
- **D-15:** Extra origins (e.g. `http://localhost:*`) only via an `ALLOWED_ORIGINS` function secret on a dev project; production list stays tight.
- **D-16:** Server-to-server calls with no `Origin` header (pg_cron → `plan-intake` with `x-cron-secret`) must keep working — CORS only governs browser requests; auth stays JWT/cron secret.

### Service worker (FND-07, FND-08)
- **D-17:** New releases install in the background and take over on the next app launch — drop the immediate `skipWaiting` + `clients.claim` takeover so ~45 classic scripts never run as a mixed old/new set mid-session. No "update available" UI.
- **D-18:** Cache version is a content hash of the precached files, written into `sw.js`; a Node test fails CI if it is stale, and one npm script regenerates it. No build step, no deploy-time stamping.
- **D-19:** Runtime photo cache holds about 6 photos (~600 KB each), oldest evicted first. Modules also cached stale-while-revalidate, bounded.
- **D-20:** A missing precache file does not abort install: skip it, fetch normally later, and report it to the error log (the SW has no Supabase client — relay via `postMessage` to an open client or log on next page load).

### Claude's Discretion
- How RLS tests run in CI (Supabase CLI local stack vs plain Postgres service container) — must fail the build on a policy regression (FND-04).
- `safeFetch` internals and where it lives (shared module imported by both edge functions); robots.txt caching; exact byte/time caps and content-type allowlist (FND-05 lists required behaviours).
- Vendor pin format (version + SHA-256 in `vendor/README.md` or a JSON file, checked by a Node test) (FND-06).
- Photo version map shape — one per-model map replacing the `freshAsset` ternary in `src/pages/dashboard.js` (FND-09).
- `plan-intake` batching approach (hoist select, `.in()` delete, bulk insert) (FND-10).
- Exact `AGENTS.md` trim (keep car-asset section) (FND-11).
- Error table name/columns, throttle numbers, grouping key normalisation.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and requirements
- `.planning/ROADMAP.md` — Phase 1 goal and 5 success criteria
- `.planning/REQUIREMENTS.md` — FND-01..FND-11 wording
- `.planning/PROJECT.md` — constraints (no build step, `file://`, RLS on every table, `html` escaping)

### Known problems being fixed
- `.planning/codebase/CONCERNS.md` — swallowed errors, wildcard CORS, SW bookkeeping, N+1, vendor pin, photo buster chain, RLS not in CI
- `.planning/codebase/CONVENTIONS.md` — error-handling and module conventions
- `.planning/codebase/TESTING.md` — test layout and CI
- `.planning/codebase/ARCHITECTURE.md` — script order, dual-mode modules

### Car assets (photo version map, AGENTS.md trim)
- `docs/CAR-ASSET-GUIDE.md` — approved photo pipeline
- `output/CAR-ASSET-LESSONS.md` — rejected edits (Mazda2 softening 175, Mazda3 chrome-notch 196 must not be reapplied)
- `vendor/README.md` — vendored supabase-js notes

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `toast()` / `toastNode()` in `src/ui/chrome.js`: existing ok/warn toasts plus a long-lived delete-undo toast — extend for the Retry toast.
- `html` / `raw()` in `src/ui/html.js`: required for the Errors tab (error messages/stacks are untrusted text).
- `src/data/admin.js` + `src/pages/admin.js`: admin role check and review queue — add the Errors tab here.
- `plan-intake` SSRF guards in `supabase/functions/plan-intake/logic.mjs`: starting point for the shared `safeFetch`.
- `test/precache.test.js`, `assertScriptOrderMatchesIndexHtml`: extend for hash-version check.

### Established Patterns
- Network/service functions resolve `{ ok:false, error:'...' }`, never reject — follow for the error-logger client.
- Dual-mode IIFE modules under `src/data/`; a new module must be added to `index.html` order and `sw.js` `ASSETS`.
- Edge-function pure logic in `logic.mjs` (Node-testable); handler in `index.ts`.
- No logging noise: the logger is the one sanctioned sink.

### Integration Points
- Save paths: `main.js` (~296, ~483), `src/data/session.js:169` (`env.afterSave`).
- CORS constants: `supabase/functions/plan-intake/index.ts:7`, `supabase/functions/read-bill/index.ts:8`.
- SW: `sw.js` (`CACHE = 'garage-v213'`, `ASSETS`, install/activate/fetch).
- Photo buster: `src/pages/dashboard.js` ~209-224 (`studioCarImage` / `freshAsset`).
- N+1: `supabase/functions/plan-intake/index.ts` ~100-110.
- CI: `.github/workflows/test.yml` (add RLS job).
- Schema: `supabase/schema.sql` (new error table + RLS + pg_cron cleanup); tests in `supabase/tests/*.sql`.

</code_context>

<specifics>
## Specific Ideas

- Toast copy direction: "Couldn't save. Your changes are still on screen." + Retry.
- Errors tab grouped like a crash dashboard (count, first/last seen, resolve).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-reliable-safe-foundation*
*Context gathered: 2026-11-05*
