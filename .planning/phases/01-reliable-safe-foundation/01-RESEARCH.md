# Phase 1: Reliable & Safe Foundation - Research

**Researched:** 2026-11-05
**Domain:** Vanilla-JS offline PWA hardening + Supabase (Postgres RLS, Deno Edge Functions, pg_cron) + GitHub Actions CI
**Confidence:** MEDIUM overall (repo facts HIGH; CI and Deno-runtime specifics MEDIUM/LOW, flagged inline)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Error log (FND-01, FND-02)**
- **D-01:** Log failed saves and `afterSave` hook failures, plus `window.onerror` and `unhandledrejection`. Rate-limit per session so one loop cannot flood the table. Do not log normal offline/sync failures (offline is expected in this app).
- **D-02:** Signed-out users can log too: insert-only RLS for the `anon` role, with column length caps and a per-device throttle. No anon select/update/delete.
- **D-03:** A row holds only: message, stack, route/page, app version, source (`client` or edge-function name), timestamp, user id if signed in. Never vehicle data, notes, photos or the failed record payload.
- **D-04:** Retention 90 days, cleaned up by a pg_cron job.
- **D-05:** Edge-function errors (`read-bill`, `plan-intake`, later autopilot functions) write to the same table with `source` set to the function name.
- **D-06:** `#admin` gets a separate **Errors** tab with a count badge, next to the existing review queue. Sets the tab pattern Phases 2/3 will extend.
- **D-07:** Errors tab groups rows by message: count, first/last seen, source; expand to see recent stacks; owner can mark a group resolved. Admin-only select via RLS.

**Failed-save toast (FND-01)**
- **D-08:** On save failure show: "Couldn't save. Your changes are still on screen." (wording may be tuned) with a **Retry** button that re-runs the same save.
- **D-09:** The toast stays until dismissed or until a retry succeeds (reuse the long-lived toast mechanism the delete-undo toast already uses in `src/ui/chrome.js`).
- **D-10:** Uncaught errors are silent to the user — logged only.
- **D-11:** Plain words only, no error codes; English + Arabic via `t()` / `src/i18n/strings.ar.js`.
- **D-12:** Keep the existing `localStorage` `catch (e) {}` swallows; only save paths (`main.js` ~296, ~483; `src/data/session.js:169`) change.

**CORS (FND-03)**
- **D-13:** Production allowlist: `https://alibashuaib.github.io` (GitHub Pages, repo `alibashuaib/mazda3-app`).
- **D-14:** Reject `Origin: null` (what `file://` and sandboxed iframes send). From `file://`, bill reading fails gracefully and the manual form keeps working (offline-first rule).
- **D-15:** Extra origins (e.g. `http://localhost:*`) only via an `ALLOWED_ORIGINS` function secret on a dev project; production list stays tight.
- **D-16:** Server-to-server calls with no `Origin` header (pg_cron → `plan-intake` with `x-cron-secret`) must keep working — CORS only governs browser requests; auth stays JWT/cron secret.

**Service worker (FND-07, FND-08)**
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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FND-01 | Save/afterSave failure shows toast and is logged; no swallowed catch on save paths | Save-path inventory (main.js 296/483, session.js 169), persistent toast design (chrome.js `toastNode` cap issue), logger module |
| FND-02 | Client and edge-function errors recorded in a Supabase table readable from `#admin` | `app_errors` table design, anon insert-only RLS, admin select/resolve policies, pg_cron retention, Errors tab |
| FND-03 | Edge functions accept browser requests only from the app origin | Shared `corsDecision` (allowlist, reject `null`, 403 on foreign Origin, no-Origin passthrough) |
| FND-04 | RLS SQL tests run in CI and fail the build on regression | Supabase CLI local stack + psql `ON_ERROR_STOP` runner; static "every table has RLS" Node test |
| FND-05 | All server fetches of external URLs go through one tested `safeFetch` | Module design (`_shared/safe-fetch.mjs`), SSRF gap list from current code, test matrix |
| FND-06 | `vendor/supabase.js` version + hash recorded; test fails on change | Pin file design; hash verified against CDN (matches) |
| FND-07 | SW install succeeds with one missing precache file; no hand cache bump | Tolerant precache, content-hash version tool + Node test, `.gitattributes` EOL note |
| FND-08 | Modules and photos stale-while-revalidate with bounded cache | Cache strategy design, LRU eviction, activate-cleanup allowlist pitfall |
| FND-09 | Photo cache busting from one version map | Map module design replacing `freshAsset` ternary; exact preservation of current revs |
| FND-10 | `plan-intake` has no per-item DB round trips | Batching design (hoisted select, `.in()` delete, bulk insert, `upsert ignoreDuplicates` for recalls) |
| FND-11 | `AGENTS.md` keeps only project-relevant guidance | Trim to the "Persistent car asset editing memory" section |
</phase_requirements>

## Summary

Phase 1 hardens the app before autopilot adds server code. Most of the work is well-scoped by CONTEXT.md; the research below mainly pins down *how* each item is built and where the traps are. Several findings change the plan materially:

1. **Save-path swallowing is narrower than CONCERNS.md says.** `save()` in `session.js` already never rejects and already calls `env.notify(..., 'warn')` on failure. The real silent-loss points are the `try { ok = await save(); } catch (e) {}` wrappers in `main.js` (~296, ~483) (they only catch synchronous throws) and `env.afterSave` in `session.js:169` (data is saved locally but never queued for sync). The Retry toast is an upgrade of the existing notify path, not a new one.
2. **The existing toast host caps stacked toasts at 3 and silently removes the oldest** (`TOAST_CAP` in `src/ui/chrome.js`). A persistent Retry toast (D-09) must be exempt from that cap or it will be evicted by the next toast.
3. **CORS alone does not "reject" a request.** `Access-Control-Allow-Origin` only stops browsers reading responses and blocks preflighted requests; a simple cross-origin POST still reaches the function. To satisfy success criterion 2, the functions must also return 403 when an `Origin` header is present and not allowlisted, while keeping no-Origin server calls working (D-16).
4. **The anon key is public and PostgREST is reachable from any origin.** Per-device throttling (D-02) is client-side only. The table needs a server-side global throttle (trigger) or a flood can fill it. Also, `insert().select()` from the client would need SELECT privilege, which anon must not have, so the client must insert without returning rows.
5. **`plan-intake` has never been executed** (its README says so; no Deno in dev). Its `Deno.resolveDns` and `redirect: 'manual'` behaviour is unverified on the Supabase runtime. A Wave-0 spike on a staging function is required before safeFetch is trusted.
6. **The vendor pin is ready to record**: the vendored file's SHA-256 `3ae8cfec4a4715f4e67aa45fe4e7c1a40d67787629c7f10e32afd7dd836edf4e` (136,992 bytes) is byte-identical to the jsDelivr copy of `@supabase/supabase-js@2.58.0` (verified in this session).
7. **Content-hash SW version needs its own hash input excluded.** If the hash covers `sw.js`, the `CACHE` line must be replaced by a placeholder before hashing, or the hash can never be stable. Hash inputs should normalise CRLF to LF because the owner works on Windows 11.
8. **Local tooling is missing** on the dev machine (no Docker, Supabase CLI, Deno, or psql). The SQL and Deno code can only be proven in CI, so the planner must schedule CI-driven verification, not local runs.

Suggested grouping (planner decides): (A) CI and test scaffolding (SQL RLS job, vendor pin test, `.mjs` syntax check, AGENTS.md trim, static RLS-coverage test); (B) error log end-to-end (table, logger, Retry toast, Errors tab, edge logging); (C) edge security (CORS decision, safeFetch, plan-intake batching); (D) service worker and photo map (tolerant precache, no skipWaiting, SWR caches, version tool last because it hashes every other precached file).

**Primary recommendation:** Run RLS SQL tests on the Supabase CLI local stack (`supabase start`, then `psql -v ON_ERROR_STOP=1` per file), keep the existing DO-block test files as they are, and put one pure, dependency-injected `safeFetch` plus one pure `corsDecision` in `supabase/functions/_shared/` so both edge functions and Node tests share them.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Save-failure detection + Retry toast | Browser / Client | — | Only the page knows the in-memory garage and can re-run `save()` |
| Client error capture (`onerror`, `unhandledrejection`, save failures) | Browser / Client | Database (persist) | Capture must happen in page; persistence via PostgREST insert |
| Error persistence, grouping, retention | Database / Storage | — | Table + RLS + pg_cron; source of truth for owner reads |
| Edge-function error logging | API / Backend (Edge Function) | Database | Uses service role; never exposes key to client |
| Errors tab in `#admin` | Browser / Client | Database (admin-only select) | Rendering untrusted messages through `html`; RLS enforces read rights |
| CORS / origin gate | API / Backend (Edge Function) | — | Only the function can refuse a request; browser enforces responses |
| External URL fetch policy (SSRF, redirects, caps, robots) | API / Backend (Edge Function, shared module) | — | Server-only; browser must never fetch scraped sources |
| RLS policy regression tests | Database / Storage | CI (GitHub Actions) | Tests run against Postgres; CI gates merges |
| Service worker precache, install tolerance, SWR, photo LRU | Browser (Service Worker) | — | Offline shell lives in the SW; no server involvement |
| Cache version content hash | Repo tooling (Node) | Browser (SW constant) | Generated and checked at test time, read by SW at runtime |
| Vendor integrity pin | Repo tooling (Node test) | — | Supply-chain check, no runtime role |
| Car photo cache-busting map | Browser (data module) | — | Pure URL mapping; must be dual-mode for Node test |
| plan-intake batching | API / Backend + Database | — | Round-trip count is a server/DB concern |

## Standard Stack

### Core (already in repo; no additions)
| Library / Tool | Version | Purpose | Why Standard |
|---------------|---------|---------|--------------|
| Node test runner (`node:test`) | Node 22 in CI (`.github/workflows/test.yml`) | All new unit/static tests (SW, vendor pin, safeFetch, CORS, batching) | Already the project's test harness (`npm test` = `node --test "test/**/*.test.js"`) |
| `linkedom`, `fake-indexeddb` | ^0.18.13 / ^6.2.5 | Existing DOM/IDB emulation for toast and page tests | Already dev deps |
| `@playwright/test` | ^1.62.1 | Existing browser smoke tests; add one SW offline test if desired | Already installed |
| `@supabase/supabase-js` (Edge, `npm:` specifier) | `npm:@supabase/supabase-js@2` | Edge function client (already used) | Existing import in both functions |
| `@supabase/supabase-js` (browser, vendored) | 2.58.0 | Browser client, UMD at `vendor/supabase.js` | Pinned in Phase 1 (FND-06) |
| WebCrypto `crypto.subtle` | platform | SHA-256 for content hash (browser: n/a; Node test: `crypto.createHash`; Deno: `crypto.subtle`) | Already used by `sha256Hex` in `logic.mjs`; do not hand-roll hashing |

### CI tooling (GitHub Actions, not npm packages)
| Action | Version | Purpose | Notes |
|--------|---------|---------|-------|
| `actions/checkout` | v4 | Already used | — |
| `actions/setup-node` | v4, Node 22 | Already used | — |
| `supabase/setup-cli` | `@v1` (major pin only) | Installs the Supabase CLI for `supabase start` | [CITED: https://supabase.com/docs/guides/local-development/testing/overview]. Pin an exact CLI version via the action's `version` input at implementation time (the docs example only pins major; exact latest version not verified here). |
| `denoland/setup-deno` | optional | `deno check` on `index.ts` files (both functions have never been type-checked) | Recommended, not required by FND-04; see Open Questions |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Supabase CLI local stack for RLS CI | Plain `postgres` service container + shims | Shims must recreate `auth.users`, `auth.uid()`, `auth.role()`, roles `anon`/`authenticated`, `storage.objects`, `storage.foldername()`, `extensions` schema; pg_cron is not in the stock image. Faster to start, but drifts from production. Use only if CLI start is too slow in practice. |
| `supabase test db` (pgTAP) | psql + `ON_ERROR_STOP` per file | `supabase test db` runs pgTAP-format tests; existing files are DO-block `RAISE EXCEPTION` scripts. Converting 7 files to pgTAP is extra work with no coverage gain. psql with `ON_ERROR_STOP=1` fails the build on the first `RAISE`. |
| Custom CORS allowlist | `cors` npm package | Not applicable to Deno/edge; 10 lines of code is enough. |
| `Deno.resolveDns` | `node:dns/promises` (`resolve4`, `resolve6`) | Unverified which works on the Supabase edge runtime; see Open Questions. Both must be injected behind one `resolve` function so the choice is one line. |

**Installation:** none. This phase adds no npm or Deno packages.

## Package Legitimacy Audit

No external packages are recommended for installation in this phase. Everything listed under Standard Stack is already in `package.json`, `package-lock.json`, or an existing `npm:` import. The only new external references are GitHub Actions (`supabase/setup-cli`, optionally `denoland/setup-deno`); these are CI tooling, not packages the app installs. Slopcheck was not run because no new package names are proposed.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none new) | — | — | — | — | — | — |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                       BROWSER (file:// or https://alibashuaib.github.io)
 save() fails / afterSave throws / window.onerror / unhandledrejection
          |                                   |
          v                                   v
 [save paths: main.js, session.js]     [error-log.js: session cap,
   -> Retry toast (persistent)          dedupe, drop when offline]
                                              |  supabase.from('app_errors').insert(row)  (anon or authed key)
                                              v
                                    +-----------------------------+
                                    | PostgREST (anon insert-only)|
                                    | RLS + column grants + CHECK |
                                    | length caps + BEFORE INSERT |
                                    | trigger (user_id, group_key,|
                                    | global throttle)            |
                                    +-----------------------------+
                                              ^
 SW (sw.js, version = content hash)           |  service role insert (D-05)
   install: per-URL tolerant precache         |
   fetch: SWR modules, SWR photo LRU(6)       |
          |                          +--------+--------+
          | postMessage/meta cache   | Edge functions  |  (Deno)
          v                          | read-bill       |
  client logs D-20 failure           | plan-intake     |
                                     |  1. corsDecision(Origin) -> 403 | ok
                                     |  2. auth (JWT or x-cron-secret)  |
                                     |  3. safeFetch(url, policy) ----> external sources / NHTSA / Anthropic
                                     |     isSafeUrl -> DNS public-only -> robots (scrape only)
                                     |     -> fetch(redirect:'manual') x<=3 hops -> type allowlist -> streamed byte cap
                                     |  4. batched DB writes (1 select, 1 delete .in(), 1 bulk insert)
                                     |  5. outer catch -> app_errors (source = fn name)
                                     +-----------------------------------------------+
                                              |
 pg_cron (daily) -> delete app_errors older than 90 days
 Admin (#admin Errors tab) -> select grouped rows (is_admin RLS); resolve = update resolved_at
```

### Recommended Project Structure (new/changed files only)
```
supabase/
├── functions/
│   ├── _shared/
│   │   ├── safe-fetch.mjs      # pure: safeFetch(url, policy, deps) — Node-testable
│   │   ├── net-guard.mjs       # moved from plan-intake/logic.mjs: isSafeUrl, isPrivateIp (re-export from logic.mjs)
│   │   ├── cors.mjs            # pure: corsDecision(origin, allowed)
│   │   ├── app-errors.mjs      # pure: normaliseError(source, err), scrub(), truncate()
│   │   └── dns.ts              # Deno-only default resolver (the one line that differs by runtime)
│   ├── plan-intake/ (index.ts, logic.mjs)
│   └── read-bill/   (index.ts, logic.mjs)
├── schema.sql                  # + app_errors table, trigger, grants, policies, pg_cron job
└── tests/
    └── app-errors-rls.sql      # new RLS file (anon insert-only, no select, admin read)
src/
├── data/error-log.js           # dual-mode logger: report(), configure(), session cap
├── data/car-photos.js          # dual-mode PHOTO_REV map + photoUrl(url, modelId)
└── data/admin.js               # + listErrors(), resolveGroup()  (existing file)
sw.js                           # tolerant install, SWR, LRU photo cache, no skipWaiting, hash CACHE
tools/sw-version.js             # regenerates CACHE hash; `--check` mode used by test
vendor/pins.json                # {version, sha256, bytes, source} for vendor/supabase.js
test/
├── sw-version.test.js          # stale CACHE hash fails
├── sw-install.test.js          # vm-run sw.js with fake caches: missing file still installs
├── sw-cache.test.js            # SWR + LRU eviction with fake Cache
├── vendor-pin.test.js          # sha256 of vendor/supabase.js matches pins.json
├── rls-coverage.test.js        # every create table in schema.sql has enable row level security
├── edge-cors.test.js           # corsDecision + no '*' in function sources
├── edge-safe-fetch.test.js     # full SSRF/redirect/cap/robots matrix with fake fetch+resolve
├── edge-plan-intake-batching.test.js  # fake admin client counts calls, independent of item count
├── error-log.test.js           # session cap, dedupe, offline drop, never rejects
└── car-photos.test.js          # every mapped rev'd asset file exists; URLs unchanged
```

### Pattern 1: Dual-mode pure module for edge logic (existing convention)
**What:** Pure `.mjs` with no Deno/Node APIs; injected dependencies; Node test loads it via dynamic `import()` (pattern in `test/read-bill-logic.test.js`, `test/plan-intake-logic.test.js`).
**When to use:** `safeFetch`, `corsDecision`, error normalisation, batching planners.
**Example:**
```js
// supabase/functions/_shared/safe-fetch.mjs  (sketch)
export async function safeFetch(url, policy, deps) {
  // deps = { fetch, resolve, robotsFor, now }  — Deno passes real ones, tests pass fakes
  // Never throws: resolves { ok:false, error:'blocked'|'redirect'|'type'|'size'|'timeout'|'status'|'robots' }
}
```

### Pattern 2: Tolerant per-URL precache (replaces `cache.addAll`)
**What:** Install each URL independently; record failures; still complete install.
**Why:** `cache.addAll` is atomic: one 404 rejects the whole install (already flagged in CONCERNS.md and enforced in reverse by `test/precache.test.js`).
**Example:**
```js
self.addEventListener('install', e => e.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  const failed = [];
  await Promise.all(ASSETS.map(url =>
    fetch(url, { cache: 'reload' })          // bypass HTTP cache so the precache is the server's copy
      .then(r => r.ok ? cache.put(url, r) : Promise.reject(r.status))
      .catch(() => failed.push(url))));
  // D-20: no Supabase client in the SW. Park the list where the page can read it on next load.
  await cache.put(PRECACHE_REPORT, new Response(JSON.stringify(failed), { headers: { 'content-type': 'application/json' } }));
})()));
```
Note: `cache.put` with a `Response` whose status is not 2xx is also rejected, so the `r.ok` guard is still needed.

### Pattern 3: Persistent toast with Retry (extends `undoToast` pattern)
**What:** A `toastNode` variant with a button that re-runs the save; not subject to `TOAST_CAP` eviction and not on the `TOAST_MS` timer.
**Key detail:** `toastNode` currently does `while (host.children.length > TOAST_CAP) host.firstElementChild.remove();`. Persistent toasts must be excluded from that loop (for example, mark them with a class and skip them when choosing what to remove, or raise the cap only for them). Wire the retry through `env.notify(msg, 'warn', { retry })` in `session.js`; on retry failure keep the same toast, on success fade it.

### Anti-Patterns to Avoid
- **`Access-Control-Allow-Origin: *` plus a token check.** It is not a substitute for an explicit Origin decision; the function must refuse foreign Origins itself.
- **Adding `skipWaiting` back to "fix" a stuck update.** D-17 forbids mixed old/new classic-script sets.
- **Hand-editing `CACHE`.** Once D-18 lands, the value is only written by `tools/sw-version.js`.
- **Logging full request payloads on error.** D-03 bans vehicle data, notes, photos, and the failed record in every error row.
- **`insert(...).select()` from the anon client.** PostgREST returns the row, which needs SELECT privilege that anon must not have. Insert without `.select()`.
- **`upsert(..., onConflict)` on `plan_drafts`.** Its unique index is partial (`where status = 'pending'`); use delete-with-`.in()` then bulk insert.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cache versioning | A hand counter in `sw.js` | Content hash written by `tools/sw-version.js`, verified by a Node test | D-18; CONCERNS.md "manual bookkeeping" |
| Bulk "insert if absent" for recalls | A select-then-insert loop | `upsert(rows, { onConflict: 'campaign,car_model_id', ignoreDuplicates: true })` | Recalls PK is `(campaign, car_model_id)` (schema.sql) — one round trip, never overwrites status |
| SHA-256 | Any custom digest | `crypto.subtle.digest` (Deno/browser) / `crypto.createHash` (Node test) | Already used in `logic.mjs` |
| Constant-time compare | Custom | `safeEqual` in `logic.mjs` | Already present |
| IPv6 address parsing | Regex-only classification | A small expander: normalise to 8 hextets, then check embedded IPv4 for `::ffff:`, `64:ff9b::/96`, `2002::/16` | Regex misses mapped/NAT64/6to4 forms (see Pitfalls) |
| Robots.txt parsing | Full RFC parser | ~40-line longest-match parser for `User-agent` groups, `Allow`/`Disallow` prefixes (no wildcards) | Only needs yes/no per path; cache per origin |
| Retention | An app-side sweep on page load | pg_cron daily `delete ... where created_at < now() - interval '90 days'` | D-04 |
| Error grouping | Server-side fuzzy clustering | `group_key = md5(source || '|' || normalised message)` computed in a trigger | Enough for "count, first/last seen" (D-07) |
| Toast system | A second toast component | Extend `toastNode` / `undoToast` in `src/ui/chrome.js` | CONTEXT reusable assets |

**Key insight:** The hard parts here are *policy* decisions (which addresses are public, which origins are allowed, what counts as a failed save), and those must live in one tested pure module each; hand-written copies in index.ts files are what the audit found.

## Runtime State Inventory

Not a rename/refactor/migration phase. Omitted.

One runtime consequence to note (not a state inventory item): after D-18, the cache name changes from `garage-v213` to `garage-<hash>`. The existing `activate` handler deletes every cache whose key is not `CACHE`, so the old `garage-v213` precache is removed on the first activation of the new SW. The runtime photo cache and module cache must be on the allowlist (see Pitfall 5) or they will be deleted on every release.

## Common Pitfalls

### Pitfall 1: Cache deletion on activate wipes runtime caches
**What goes wrong:** New runtime caches (`garage-photos`) are removed by the existing `keys().filter(k => k !== CACHE)` cleanup.
**Why it happens:** The cleanup assumes one cache.
**How to avoid:** Keep an explicit `KEEP = new Set([CACHE, PHOTO_CACHE])` allowlist in `activate`.
**Warning signs:** Photos fetched on every load after each release.

### Pitfall 2: Persistent toast evicted by the cap
**What goes wrong:** The Retry toast disappears when three other toasts appear.
**Why it happens:** `toastNode` trims to `TOAST_CAP = 3` oldest-first, and `toast()` schedules fade on `TOAST_MS`.
**How to avoid:** Exempt the Retry toast from trimming and from the timer (D-09).

### Pitfall 3: `afterSave` failure is the silent data-loss case, not the toast case
**What goes wrong:** `session.save()` reports success, the local write is done, but the server never gets the vehicle; the try/catch at `session.js:169` hides it.
**Why it happens:** `env.afterSave` enqueues the sync; if it throws, nothing is queued and nothing retries.
**How to avoid:** Log it (D-01). Whether it also shows a toast is an Open Question (the local save succeeded).

### Pitfall 4: Anon insert breaks if the client asks for the row back
**What goes wrong:** `insert(row).select()` or `.single()` returns 401/403 for anon.
**Why it happens:** `RETURNING` needs SELECT privilege; anon has none.
**How to avoid:** Insert without `.select()`. Test it in `supabase/tests/app-errors-rls.sql` as `set local role anon`.

### Pitfall 5: Supabase default grants on new tables
**What goes wrong:** New table is readable/writable by anon because Supabase auto-grants on new public objects.
**Why it happens:** Default privileges. `schema.sql` already notes this (around line 582) and strips them.
**How to avoid:** Start the new section with `revoke all on public.app_errors from anon, authenticated;` then add column-level grants only.

### Pitfall 6: Anon key is public, so a per-device throttle is not a throttle
**What goes wrong:** Anyone with the anon key (it is in `src/data/account.js`) can insert rows directly through PostgREST, bypassing the client throttle; the table grows without bound.
**Why it happens:** PostgREST is reachable from any origin; CORS only governs browsers and Supabase's REST gateway is not covered by the edge-function CORS lock.
**How to avoid:** A `BEFORE INSERT` trigger for `anon`/`authenticated` roles that refuses inserts when the last hour already has N rows (for example N = 500, tune later), with length `CHECK`s on every text column and a `source` regex. Service-role inserts from edge functions are exempt.

### Pitfall 7: CORS "allow origin" alone does not reject requests
**What goes wrong:** A simple cross-origin `POST` with `Content-Type: text/plain` runs the function; only the response is hidden.
**Why it happens:** CORS is a read gate in browsers; the request is sent.
**How to avoid:** Return 403 when `Origin` is present and not allowed (includes `null`). Keep JWT/cron-secret auth as the real control. Preflight `OPTIONS` from a foreign origin gets 403 with no `Access-Control-Allow-Origin`.

### Pitfall 8: `Origin` check must not break the cron call
**What goes wrong:** pg_net calls to `plan-intake` (no `Origin`) are refused by an over-strict check.
**How to avoid:** `corsDecision(null-header)` returns `ok: true` with no CORS headers; the auth step still requires `x-cron-secret` or a JWT (D-16). Test this case explicitly.

### Pitfall 9: DNS check is not enough against rebinding
**What goes wrong:** The address checked is not the address connected to; a DNS server can answer public then private.
**Why it happens:** `fetch()` resolves again; neither Deno nor the Web fetch API lets us pin the resolved IP.
**How to avoid:** Accept as residual risk, document it (the source list is admin-registered; the current plan-intake README says the same). Mitigate by re-running DNS on every redirect hop and by rejecting any response whose final URL host differs from the validated host set.

### Pitfall 10: IPv6 and IPv4-mapped gaps in the current `isPrivateIp`
**What goes wrong:** Several private/reserved addresses pass as public.
**Verified by reading `supabase/functions/plan-intake/logic.mjs`:**
- `::ffff:` with hex form (`::ffff:a00:1` = 10.0.0.1) is not recognised; only the dotted form is.
- `64:ff9b::/96` (NAT64) and `2002::/16` (6to4) with embedded private IPv4 are not checked.
- `ff00::/8` (multicast) and `fec0::/10` (deprecated site-local) are not in the list (`fe[89ab]` only).
- IPv4 ranges missing: `192.0.0.0/24`, `192.0.2.0/24`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24` (documentation/benchmark; not routable, so rejecting is safe).
**How to avoid:** Replace with one expander + a table-driven test (Node) that includes each case above.

### Pitfall 11: Redirect handling must re-check every hop and cap hops
**What goes wrong:** A redirect to `http://`, to a private host, or a loop bypasses the checks.
**Current code:** follows exactly one redirect manually, re-checks `isSafeUrl` and DNS, then fetches the second hop with `redirect: 'error'`. The check logic is right for one hop, but there is no general hop loop, and the time budget is two independent 20 s timeouts rather than one deadline.
**How to avoid:** Loop up to 3 hops, each through `isSafeUrl` + DNS + scheme check; one deadline (AbortController) across all hops and the body read.

### Pitfall 12: Content-type default is "text"
**What goes wrong:** Any non-PDF response (JSON, image, binary) is converted to text and sent to the model.
**Current code:** `if (/pdf/i.test(type)) ... else text`.
**How to avoid:** Allowlist: `text/html`, `application/xhtml+xml`, `text/plain`, `application/pdf`; anything else returns `{ok:false, error:'type'}`.

### Pitfall 13: Byte cap is checked only on `content-length`
**What goes wrong:** Chunked responses without `content-length` are read fully into memory.
**Current code:** `content-length` precheck, then `arrayBuffer()` (no streaming cap).
**How to avoid:** Read `r.body.getReader()` with a running counter; cancel and return `size` when over cap.

### Pitfall 14: robots.txt failure semantics
**What goes wrong:** Robots fetch errors are treated as "allowed" by default, or the cache is never invalidated.
**How to avoid:** Follow RFC 9309 semantics (see Assumptions A6): 4xx for robots.txt means no restrictions; 5xx or network failure means disallow for the run. Cache per origin for the duration of one invocation (edge instances are short-lived); optionally persist to a table later.

### Pitfall 15: Edge function code has never run
**What goes wrong:** `index.ts` fails at runtime on details unit tests cannot see (permissions, `Deno.resolveDns`, `redirect: 'manual'` return shape, `npm:` import resolution).
**How to avoid:** Wave-0 spike: deploy each function to a non-production project, call once with a fake Origin and once with the allowed Origin, and call one safeFetch against a known public URL. Record results in the plan's verification.

### Pitfall 16: `.gitattributes` and CRLF
**What goes wrong:** The content hash changes on Windows checkouts, so CI fails spuriously.
**Current state:** `.gitattributes` sets `* text=auto eol=lf`, which keeps working-tree files LF on Windows. The hasher should still normalise `\r\n` to `\n` before hashing.

### Pitfall 17: CI lint misses `.mjs` and `.ts`
**What goes wrong:** `find . -name '*.js' ... node --check` does not check `supabase/functions/**/*.mjs`, and no CI step touches `.ts`.
**How to avoid:** Extend the `find` to `*.mjs`; add `deno check` (optional) for `index.ts`.

### Pitfall 18: The existing SW test pins the old cache name format
**What goes wrong:** `test/precache.test.js` asserts `const CACHE = 'garage-v(\d+)'`, which fails the moment `CACHE` becomes a hash.
**How to avoid:** Replace that assertion with the hash check (FND-07) in the same change; keep the "stale asset list" and "only default photo precached" tests.

### Pitfall 19: `plan-intake` per-source loops still hit the DB per car
**What goes wrong:** Moving the `dealer_plan_items` select out of the item loop but leaving it inside the source loop still scales with sources.
**How to avoid:** One `dealer_plan_items` select per car, reused for every source of that car, refreshed only after a source writes drafts (or accept the stale snapshot as today).

### Pitfall 20: Recalls ignoring duplicates vs resetting status
**What goes wrong:** Bulk upsert without `ignoreDuplicates` overwrites approved/rejected recall rows.
**How to avoid:** `ignoreDuplicates: true` (ON CONFLICT DO NOTHING semantics) — must be asserted in a test against the fake client.

### Pitfall 21: Photo SWR and `?v=` keys
**What goes wrong:** Cache keys include the query, so each revision is a separate entry; `ignoreSearch` fallback can serve the wrong revision.
**How to avoid:** Key photo entries by full URL (including `?v=`) so a revision bump fetches fresh immediately; keep the `ignoreSearch` fallback for offline only; LRU eviction naturally drops old revisions.

### Pitfall 22: Cache.keys() ordering is not in the spec
**What goes wrong:** Eviction picks the wrong entry if `keys()` order is not insertion order.
**How to avoid:** Re-put on hit (delete then put) so the newest-used entry is last; add a Node fake that returns insertion order, and state the Chromium assumption (A4).

### Pitfall 23: Mixed-version within a session (modules SWR)
**What goes wrong:** Background revalidation overwrites a module that a later lazy load (`vendor/supabase.js`, loaded from `main.js`) reads in the same session.
**Why it happens:** All classic scripts load at boot and are consistent; only later dynamic loads can see a newer copy.
**How to avoid:** See Open Question 4; recommended: exclude `vendor/*` from background revalidation or accept the documented residual.

### Pitfall 24: Missing-file reporting from SW
**What goes wrong:** The SW cannot write to Supabase; a missing file report is lost if no client is open at install.
**How to avoid:** Store the failure list in the cache (`PRECACHE_REPORT`); `main.js` reads it on next page load and calls `error-log.report({source:'client', message:'precache missing: ...'})`, then deletes the entry.

### Pitfall 25: Untrusted text in the Errors tab
**What goes wrong:** Admin renders scraped/untrusted `message` and `stack` as HTML.
**How to avoid:** Render only through `html`; add a `test/no-raw-templates.test.js`-covered file (already enforced for new files under `src/`) and an injection fixture test (`<img src=x onerror=...>` in message renders as text).

## Code Examples

### app_errors schema (sketch; planner finalises names)
```sql
-- Source of design: CONTEXT D-01..D-07; patterns from schema.sql (RLS + column grants).
create table if not exists public.app_errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  source      text not null check (source ~ '^[a-z0-9][a-z0-9-]{0,39}$'),   -- 'client' | 'read-bill' | 'plan-intake' | ...
  message     text not null check (char_length(message) between 1 and 500),
  stack       text check (char_length(stack) <= 2000),
  route       text check (char_length(route) <= 120),
  app_version text check (char_length(app_version) <= 40),
  user_id     uuid references auth.users on delete set null,
  group_key   text not null,       -- set by trigger
  resolved_at timestamptz
);
create index if not exists app_errors_created_idx on public.app_errors (created_at);
create index if not exists app_errors_group_idx   on public.app_errors (group_key);

create or replace function public.app_errors_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() in ('anon', 'authenticated') then
    if (select count(*) from public.app_errors where created_at > now() - interval '1 hour') >= 500 then
      raise exception 'rate limited';              -- client treats as ok:false and stops
    end if;
  end if;
  new.user_id   := auth.uid();                     -- never trust a client-sent user id
  new.group_key := md5(new.source || '|' || left(regexp_replace(lower(new.message),
                    '[0-9]+|[0-9a-f]{8}-[0-9a-f-]{27}', '#', 'g'), 200));
  return new;
end $$;
create trigger app_errors_before_insert before insert on public.app_errors
  for each row execute function public.app_errors_before_insert();

alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;
grant insert (source, message, stack, route, app_version) on public.app_errors to anon, authenticated;
create policy anon_insert_app_errors on public.app_errors for insert to anon, authenticated with check (true);
grant select (id, created_at, source, message, stack, route, app_version, user_id, group_key, resolved_at)
  on public.app_errors to authenticated;
create policy admin_read_app_errors on public.app_errors for select to authenticated using (public.is_admin());
grant update (resolved_at) on public.app_errors to authenticated;
create policy admin_resolve_app_errors on public.app_errors for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
```
Notes: `auth.role()` and `auth.uid()` read `request.jwt.claim.*`, which the existing RLS tests already set via `set_config`. A resolved group is "reopened" automatically when a new row with the same `group_key` arrives (resolved rows are older), which removes the need for a second table. Confirm `is_admin()` is `security definer` before relying on it inside the policy (it is referenced the same way by existing policies).

### pg_cron retention (guarded so CI without the extension still applies schema)
```sql
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule('app-errors-retention')
      where exists (select 1 from cron.job where jobname = 'app-errors-retention');
    perform cron.schedule('app-errors-retention', '17 3 * * *',
      $cron$delete from public.app_errors where created_at < now() - interval '90 days'$cron$);
  end if;
end $$;
```
[ASSUMED]: `cron.schedule(name, schedule, command)` and `cron.unschedule(name)` signatures (standard pg_cron API; Supabase cron docs describe `cron.job` table, confirmed only as "creates a cron schema"). Verify in the CI run.

### CORS decision (pure)
```js
// supabase/functions/_shared/cors.mjs (sketch)
export function corsDecision(origin, allowed) {
  if (origin == null || origin === '') return { ok: true, headers: {} };     // server-to-server (D-16)
  if (allowed.includes(origin)) return { ok: true, headers: {
    'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS' } };
  return { ok: false };                       // includes Origin: null (file://) — D-14
}
// allowed = ['https://alibashuaib.github.io', ...(Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean)]
```
Handler: `if (!d.ok) return new Response('forbidden', { status: 403 })` before OPTIONS and before auth.

### Vendor pin (JSON, read by test)
```json
{
  "supabase.js": {
    "package": "@supabase/supabase-js",
    "version": "2.58.0",
    "sha256": "3ae8cfec4a4715f4e67aa45fe4e7c1a40d67787629c7f10e32afd7dd836edf4e",
    "bytes": 136992,
    "source": "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/dist/umd/supabase.js"
  }
}
```
Verified in this session: local SHA-256 of `vendor/supabase.js` equals `sha256`, and the jsDelivr file hashes to the same value with the same byte count.

### Content-hash SW version (sketch of the hashed inputs)
Inputs, in ASSETS order: each precached file's bytes with `\r\n`→`\n`; plus `sw.js` text with the `const CACHE = '...'` line replaced by a fixed placeholder. Output: `const CACHE = 'garage-' + sha256hex.slice(0, 12)`. Test: recompute and compare; failure message names `npm run sw:version`.

### Photo revision map (behaviour-preserving)
```js
// src/data/car-photos.js (dual-mode; add to index.html and sw.js ASSETS)
const PHOTO_REV = {
  mazda3bp: 'mazda3bp-cleanup-200',
  mazda6: 'mazda6-wheel-logo-205',
  cx3: 'cx3-alignment-logos-207',
  mazda2: 'mazda2-paint-fixes-209',
  mazda3bm: 'mazda3bm-framing-213',
  // CX family (CX_NORMALIZED_PHOTOS in dashboard.js): 'cx-family-fixes-211' for each id
};
function photoUrl(url, modelId) { const rev = PHOTO_REV[modelId]; return rev ? `${url}?v=${rev}` : url; }
```
Preserve the exact existing strings (they are cache keys in the field). Models with no rev get no buster, as today. The CX set must be expanded into the map (or looked up by membership) so `cx30` etc. keep `cx-family-fixes-211`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-bumped `CACHE = 'garage-vNNN'` | Content-hash version written by tool, verified by test | This phase (D-18) | No manual bump per release |
| `cache.addAll` (atomic) | Per-URL `put` with failure list | This phase (D-20) | One missing file no longer blocks offline |
| `skipWaiting` + `clients.claim` | Install in background, activate next launch | This phase (D-17) | No mixed old/new script sets |
| Network-first everything | SWR for modules + photos, bounded | This phase (D-19) | Faster boot; bounded storage |
| Wildcard CORS | Origin allowlist + 403 on foreign Origin | This phase (FND-03) | Browser and server both refuse foreign origins |

**Deprecated/outdated:**
- `Access-Control-Allow-Origin: *` on functions: replaced.
- Hand-written `freshAsset` ternary: replaced by one map.

## Assumptions Log

> Claims tagged `[ASSUMED]` in this research. Each needs confirmation before becoming a locked plan decision.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Deno.resolveDns` and/or `node:dns/promises` (`resolve4`/`resolve6`) are available to Supabase Edge Functions | safeFetch design, Pitfall 15 | Without a resolver the SSRF DNS check cannot run; plan-intake must fail closed (no scraping) until fixed |
| A2 | Deno `fetch(..., { redirect: 'manual' })` returns the 3xx `Response` (with `Location`), not an opaque response | safeFetch redirect handling | Redirect re-validation would not see `Location`; must fall back to a different strategy |
| A3 | `supabase test db` / pgTAP format is not required for plain psql-run scripts; `supabase start` exposes `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (or `supabase status -o env` gives `DB_URL`) | CI RLS job | CI job wiring needs a different connection step |
| A4 | Chromium `Cache.keys()` returns entries in insertion order | Photo LRU | Eviction could drop the most recent photo; fix with an explicit order index |
| A5 | pg_cron functions `cron.schedule(name, schedule, command)` and `cron.unschedule(name)` are available in the Supabase local stack and on production | Retention job | Retention job not created in CI; guard keeps schema applying |
| A6 | robots.txt semantics: 4xx = no restrictions; 5xx/unreachable = disallow (RFC 9309) | robots handling | Over-permissive or over-restrictive scraping; recall from training, not fetched in this session |
| A7 | `ignoreDuplicates: true` on supabase-js `upsert` maps to `ON CONFLICT DO NOTHING` | plan-intake recalls | Recall status could be overwritten; test against fake client, verify live |
| A8 | Supabase REST (PostgREST) gateway answers browser requests from any origin with the anon key | Pitfall 6 | If not, client error logging from `file://` would fail (acceptable: it is also offline-first) |
| A9 | `cache.put` rejects non-2xx responses, so `r.ok` guard is required | tolerant precache | None if guard is kept |
| A10 | `supabase/setup-cli@v1` installs a current Supabase CLI; exact version must be pinned at implementation | CI | Non-reproducible CI if unpinned |

**If this table is non-empty:** A1, A2, A5, A10 must be proven by a Wave-0 spike or CI run before the plan depends on them; A3 by the first CI run; A4/A7 by fake-based tests; A6 by fetching RFC 9309 before the robots test is written.

## Open Questions (RESOLVED)

1. **Which DNS resolver works in the Supabase edge runtime?**
   - What we know: current code uses `Deno.resolveDns` and has never run.
   - What's unclear: whether `Deno.resolveDns` requires permissions or is restricted; whether `node:dns` is available.
   - Recommendation: Wave-0 spike on a staging project; if neither works, plan-intake fails closed for scraping and records a LOW-confidence risk in the phase summary.
   - **RESOLVED:** Use `Deno.resolveDns`, fail closed (null or empty resolution blocks every fetch). Proven or refuted by the 01-08 Task 3 staging checkpoint; if resolveDns is unavailable on staging, plan-intake keeps blocking every source and the owner decides (node:dns or no scraping).

2. **Should an `afterSave` (sync enqueue) failure also show the Retry toast?**
   - What we know: D-01 says log it; D-08 talks about "save fails". The local save succeeded, so Retry would call the whole save again and the user sees "Couldn't save" for a state that is actually on disk.
   - Recommendation: log only, plus the plain warning copy without Retry. Needs owner confirmation if they want the stronger UX.
   - **RESOLVED (OWNER-CONFIRMED via FND-01 text):** warn toast without Retry (the local save already succeeded), plus `errorLog.report`. Implemented in 01-06 Task 2.

3. **Quota errors: keep the actionable "Storage is full" message?**
   - What we know: `session.js` has a distinct quota message ("Storage is full — your change was NOT saved. Remove some receipt photos.").
   - Recommendation: keep that wording and make it persistent with Retry too (retry is still meaningful after the user removes photos). Confirm copy with owner.
   - **RESOLVED:** keep the existing "Storage is full" copy, persistent with Retry (01-06).

4. **Modules SWR vs mixed-version sets (D-19 vs D-17).**
   - What we know: revalidation overwrites a module in the active version cache. Boot-time classic scripts are unaffected; `vendor/supabase.js` is loaded later from `main.js`.
   - Recommendation: apply SWR to modules, but exclude `vendor/*` from background revalidation (vendor is pinned anyway), and document the residual. Confirm.
   - **RESOLVED:** SWR applies to modules; `vendor/*` is excluded from background revalidation (01-07). Residual documented.

5. **Does "no hand cache bump" mean "no hand edit" or "no commit at all"?**
   - Recommendation: no hand edit; a test fails with the message "run `npm run sw:version` and commit". Confirm this matches the success criterion intent.
   - **RESOLVED:** no hand edit of the cache version. One npm script (`npm run sw:version`) regenerates the content hash; the test fails with instructions to run it and commit (01-11).

6. **Errors-tab badge meaning.** Count of unresolved groups (recommended) or unresolved rows in last 7 days.
   - **RESOLVED:** the Errors-tab badge is the count of unresolved groups (01-10).

7. **Should `deno check` run in CI?** Recommended (both functions have never been type-checked), but it adds `denoland/setup-deno` and network use for `npm:` imports. Planner decides.
   - **RESOLVED:** `deno check` is not added to CI this phase (01-01 Task 3). Optional follow-up only.

## Environment Availability

| Dependency | Required By | Available (dev machine) | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All Node tests, `tools/sw-version.js` | ✓ | v26.13.0 (CI uses 22) | — (run tests on 22 in CI; locally 26 is fine for pure tests) |
| npm | `npm test` | ✓ (assumed with Node) | — | — |
| Docker | Supabase local stack (RLS tests) | ✗ | — | CI only (ubuntu-latest has Docker) |
| Supabase CLI | `supabase start` / RLS job | ✗ | — | CI via `supabase/setup-cli@v1` |
| psql | Running `supabase/tests/*.sql` | ✗ | — | CI (ubuntu runner includes PostgreSQL client — A3) |
| Deno | Type/run edge functions locally | ✗ | — | CI `denoland/setup-deno` (optional); staging deploy spike |
| ctx7 (Context7 CLI) | Library docs lookup | ✗ | — | Official docs URLs cited instead |
| Python | `tools/graphify-repair.py` only | ✓ | 3.14 (pip present) | — (not needed) |

**Missing dependencies with no fallback:**
- Local ability to run RLS SQL and Deno code. Planner must make those verifications CI-driven (or staging-driven for Deno), not local.

**Missing dependencies with fallback:**
- Docker, Supabase CLI, psql, Deno locally — CI and a staging Supabase project cover them.

## Validation Architecture

> Skipped: `workflow.nyquist_validation` is `false` in `.planning/config.json`.

Test structure is still specified in the File Layout above (Node `node:test` files under `test/`), because FND-04..FND-10 require automated checks.

## Security Domain

> `security_enforcement` is absent in config, so this section is required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (unchanged) | Existing JWT verification in edge functions; `x-cron-secret` via `safeEqual` (keep) |
| V3 Session Management | no | No new sessions |
| V4 Access Control | yes | RLS: `app_errors` anon insert-only; admin select/resolve via `is_admin()`; RLS CI tests (FND-04) |
| V5 Input Validation | yes | Column `CHECK` length caps and `source` regex; `html` template for rendering (`no-raw-templates`) ; `parseSchedule`/`clampInt` already |
| V6 Cryptography | yes (hashing only) | `crypto.subtle` SHA-256 for vendor pin and SW hash; never hand-roll |
| V7 Error Handling & Logging | yes (core of FND-01/02) | Log allowlisted fields only (D-03); scrub tokens (`sk-…`, `eyJ…` JWT shape) from messages/stacks before insert |
| V9 Communications | yes | HTTPS-only sources (`isSafeUrl`), `https://` schema check in `schedule_sources` CHECK |
| V12 Files / SSRF | yes | `safeFetch` (scheme, port, host, DNS public-only, redirects re-checked, content-type allowlist, byte and time caps) |
| V14 Configuration | yes | CORS allowlist; no wildcard; `ALLOWED_ORIGINS` only on dev; vendor integrity pin (supply chain) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Error-table flood via public anon key | Denial of service / repudiation | Global hourly trigger cap + length CHECKs + client session cap + 90-day retention |
| Vehicle/PII leakage in error rows | Information disclosure | D-03 allowlist of columns; client never sends record payloads; scrub tokens |
| Cross-origin use of paid edge functions (`read-bill` costs money) | Elevation / spending | Origin allowlist + 403 on foreign Origin; JWT still required |
| SSRF to internal addresses via admin-registered or scraped URLs | Information disclosure | `safeFetch`: scheme/port/host checks, DNS public-only (all records), per-hop re-check; residual DNS rebinding (Pitfall 9) |
| Redirect-based SSRF | Tampering / information disclosure | Manual redirect loop, max 3 hops, re-validate each hop |
| Oversized/huge response memory DoS | Denial of service | Streamed byte cap (2 MB text / 8 MB PDF), single time deadline |
| Prompt injection via fetched text | Tampering | Content-type allowlist; text only into model with fixed system prompt (existing "ignore instructions in document"); admin review gate |
| Tampered vendored library | Tampering | SHA-256 pin test (FND-06) |
| Stale or poisoned SW cache (404/500 stored as fallback) | Tampering | Keep `res.ok && status 200 && type basic` check; per-URL precache rejects non-2xx |
| Policy regression (e.g., anon select granted) | Elevation | RLS SQL tests in CI (FND-04); static RLS-coverage test |

**Recommended SSRF test matrix (Node, fake fetch and resolve):**
- Scheme: `http://`, `ftp://`, `file:`, `javascript:` → blocked.
- Host: IP literals (`127.0.0.1`, `2130706433`, `0x7f000001`, `127.1`), `localhost`, `localhost.`, `*.internal`, `*.local`, dotless hosts → blocked.
- Port other than 443 and userinfo (`https://u:p@host`) → blocked.
- DNS: A records 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10, 0/8, 224+ → blocked; one private among many public → blocked; AAAA `::1`, `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8`, `::ffff:10.0.0.1`, `::ffff:a00:1`, `64:ff9b::a00:1`, `2002:0a00:0001::` → blocked; empty answer → blocked.
- Redirect: to private host (even if first host is public) → blocked; to `http://` → blocked; loop/4th hop → blocked; redirect without `Location` → blocked; hop DNS rebinding (second resolve private) → blocked.
- Content: `application/json`, `image/png`, missing type → blocked; `text/html; charset=…` allowed; PDF allowed; chunked body above cap with no `content-length` → `size`; slow body beyond deadline → `timeout`.
- robots: `Disallow` on path → blocked; robots 5xx → blocked; robots 404 → allowed; robots network error → blocked.
- Happy path: public host, 200 HTML, under caps, robots allows → `{ ok: true, kind: 'text' }`.

## Sources

### Primary (HIGH confidence)
- Repo files read this session: `.planning/phases/01-reliable-safe-foundation/01-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/codebase/CONCERNS.md`, `supabase/functions/plan-intake/{index.ts,logic.mjs,README.md}`, `supabase/functions/read-bill/{index.ts,README.md}`, `supabase/schema.sql` (tables, RLS, `is_admin`, recalls/plan_drafts constraints), `supabase/tests/shops-rls.sql`, `test/precache.test.js`, `test/schema-shops.test.js`, `test/read-bill-logic.test.js`, `sw.js`, `main.js` (save paths ~296/483, SW registration ~653), `src/data/session.js` (save ~150-180), `src/ui/chrome.js` (`toastNode`, `undoToast`, `TOAST_CAP`), `src/pages/dashboard.js` (`freshAsset`, ~209-224), `src/pages/admin.js`, `src/data/admin.js`, `.github/workflows/test.yml`, `AGENTS.md`, `vendor/README.md`, `.gitattributes`, `package.json`, `.planning/config.json`.
- [VERIFIED: local `node -e` sha256 of `vendor/supabase.js`] `3ae8cfec4a4715f4e67aa45fe4e7c1a40d67787629c7f10e32afd7dd836edf4e`, 136,992 bytes.
- [VERIFIED: curl https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/dist/umd/supabase.js, same session] identical SHA-256 and byte count.

### Secondary (MEDIUM confidence)
- [CITED: https://supabase.com/docs/guides/local-development/testing/overview] CI workflow: `supabase/setup-cli@v1` → `supabase start` → `supabase test db`. The page does not describe the file location or non-pgTAP behaviour (see A3).
- [CITED: https://supabase.com/docs/guides/cron] pg_cron creates a `cron` schema; `cron.job` table; jobs can run every second to yearly. Page did not show SQL for enabling it (see A5).

### Tertiary (LOW confidence — needs validation)
- Deno/Supabase runtime behaviour for `Deno.resolveDns`, `node:dns`, `redirect: 'manual'` (A1, A2): no authoritative source found in this session (WebSearch returned nothing relevant; the Supabase Edge Functions development-tips page does not mention DNS or outbound restrictions).
- Training-knowledge items marked `[ASSUMED]` in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; existing tooling verified in repo.
- Architecture (module placement, tiers, cache strategy): MEDIUM — design derived from repo conventions; SW strategy has an open question (modules SWR).
- Pitfalls: HIGH for repo-verified items (toast cap, `addAll`, `isPrivateIp` gaps, anon RETURNING, partial unique index, recalls PK); MEDIUM for Supabase CI specifics; LOW for Deno runtime specifics.
- Security: MEDIUM — threat list complete for scope; residual DNS rebinding accepted.

**Research date:** 2026-11-05
**Valid until:** 2026-12-05 for repo facts (30 days); Supabase CLI/Deno runtime facts 7 days (fast-moving; re-verify at implementation).

## Project Constraints (from CLAUDE.md)

- Vanilla JS, no build step, no ES modules in the browser; classic scripts; must run from `file://`.
- Every new browser script: add to `index.html` order AND `sw.js` `ASSETS`; `test/precache.test.js` and `assertScriptOrderMatchesIndexHtml` must stay green.
- Every HTML string built with the `html` tagged template (`src/ui/html.js`); `raw()` only where unavoidable; never assign untagged template strings to `innerHTML`. Enforced by `test/no-raw-templates.test.js`.
- User-facing strings through `t('English')`; Arabic in `src/i18n/strings.ar.js`; RTL support.
- Every new table needs RLS (PROJECT.md). Current schema: all 16 `create table` statements have `enable row level security`; the static check is cheap to add.
- Untrusted web/LLM output only rendered through the escaping `html` template (admin renders scraped content).
- Keep SSRF guards for all fetches; respect robots/terms of sources.
- Tests: Node ≥22 `node --test`, plus Playwright; CI must stay green.
- `AGENTS.md`: before editing car images read `docs/CAR-ASSET-GUIDE.md` and `output/CAR-ASSET-LESSONS.md`; do not reapply rejected Mazda2 softening 175 or Mazda3 chrome-notch 196. (Phase 1 does not edit images; photo map change must keep URLs identical.)
- Dual-mode modules under `src/data/` (`module.exports` under Node, else global); `src/pages/*.js` are plain scripts exercised through `test/helpers/boot.js`.
- Comment the WHY in code; no JSDoc; 2-space indent, single quotes, semicolons, `'use strict';` at top.
- Logging: the logger is the one sanctioned sink; do not add console noise (existing `console.error` in `src/pages/admin.js` should route through the logger).
- GSD workflow: edits go through GSD commands (`/gsd-execute-phase` etc.).
