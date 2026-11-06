---
phase: 01-reliable-safe-foundation
reviewed: 2026-11-05T00:00:00Z
depth: standard
files_reviewed: 48
files_reviewed_list:
  - .github/workflows/test.yml
  - AGENTS.md
  - index.html
  - main.js
  - package.json
  - src/data/admin.js
  - src/data/car-photos.js
  - src/data/error-log.js
  - src/data/session.js
  - src/i18n/strings.ar.js
  - src/pages/admin.js
  - src/pages/dashboard.js
  - src/ui/chrome.js
  - styles.css
  - supabase/functions/_shared/app-errors.mjs
  - supabase/functions/_shared/cors.mjs
  - supabase/functions/_shared/dns-logic.mjs
  - supabase/functions/_shared/dns.ts
  - supabase/functions/_shared/net-guard.mjs
  - supabase/functions/_shared/safe-fetch.mjs
  - supabase/functions/plan-intake/index.ts
  - supabase/functions/plan-intake/logic.mjs
  - supabase/functions/read-bill/index.ts
  - supabase/schema.sql
  - supabase/tests/app-errors-rls.sql
  - supabase/tests/catalogue-rls.sql
  - test/admin-errors-data.test.js
  - test/admin-errors-render.test.js
  - test/app-errors.test.js
  - test/car-photos.test.js
  - test/edge-cors.test.js
  - test/edge-plan-intake-batching.test.js
  - test/edge-safe-fetch.test.js
  - test/error-log.test.js
  - test/helpers/boot.js
  - test/helpers/sw-harness.js
  - test/precache.test.js
  - test/retry-toast.test.js
  - test/rls-coverage.test.js
  - test/session-save-log.test.js
  - test/strings-ar-unique.test.js
  - test/sw-cache.test.js
  - test/sw-install.test.js
  - test/sw-version.test.js
  - test/vendor-pin.test.js
  - tools/sw-version.js
  - vendor/README.md
  - vendor/pins.json
findings:
  critical: 0
  warning: 8
  info: 5
  total: 13
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-11-05
**Depth:** standard
**Files Reviewed:** 48 (source files read in full; test files, styles.css, strings.ar.js and dashboard.js only spot-checked / grepped, not line-by-line)
**Status:** issues_found

## Summary

SSRF stack (net-guard, safe-fetch, dns-logic, dns.ts) is solid: scheme/port/credentials/IP-literal checks, per-hop DNS re-validation, fail-closed on resolver error, manual redirects, size/time caps, ReDoS-free robots glob. DNS rebinding is a documented residual risk. RLS on app_errors and the new tables is correct on paper (column grants, forced user_id/group_key). No critical findings. Main concerns: a data-loss path in plan-intake (content hash saved after a failed write), a trigger that depends on JWT claims for its anti-spoof guard (and whose RLS test likely fails or passes by accident), missing CORS headers on read-bill 500s, edge logger inserts that violate DB CHECKs and silently vanish, and a client-clock resolve timestamp.

## Structural Findings (fallow)

None provided.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: plan-intake marks a source "done" even when the draft write failed

**File:** `supabase/functions/plan-intake/index.ts:77-80`
**Issue:** `applyCarWrites` returns 0 both for "nothing to write" and for "delete/insert failed" (it logs and returns 0). Line 80 then unconditionally stores `content_hash = hash`. After a transient DB error the changed schedule is never retried (hash equals, `continue` at line 60) until someone manually clears `content_hash`. Silent loss of an update on the Autopilot path.
**Fix:** Have `applyCarWrites` return `{ ok, written }` (or throw) and only update the hash when `ok`:
```ts
const { ok, written } = await applyCarWrites(...);
if (ok) await admin.from('schedule_sources').update({ content_hash: hash }).eq('id', s.id);
```

### WR-02: app_errors anti-spoof/cap guard keys off JWT claims; RLS test likely does not exercise it

**File:** `supabase/schema.sql:856` and `supabase/tests/app-errors-rls.sql:17-35,57-65`
**Issue:** `auth.role() in ('anon','authenticated')` reads `request.jwt.claims`. In the SQL test, `set local role anon` is executed with no claims set, so `auth.role()` is NULL, the branch is skipped, `source` is stored as `'server'`, and the "client-sent source was stored" assertion should FAIL (or the test only passes because of some stub in the CI image). In production PostgREST always sets claims, so it works there, but the guard is only as strong as that coupling. If the test does pass in CI, verify why; if it fails, CI `rls` job is red.
**Fix:** Key the guard on the DB role, which `set local role` and PostgREST both set: `if coalesce(current_setting('role', true), '') in ('anon','authenticated') then`. (`current_user` is wrong here: the function is SECURITY DEFINER.) Keep the test as is, it then tests the real mechanism.

### WR-03: Global 500/hour client cap lets anyone silence client error logging

**File:** `supabase/schema.sql:859-865`
**Issue:** The anon key is public, so a script can insert 500 rows in seconds and block every real client error report for the rest of the hour, every hour. It also takes a global advisory lock on each insert, serialising all client inserts, and writes up to ~2.5 KB x 500 rows/hr of attacker-chosen text into the admin Errors tab.
**Fix:** Accept as documented trade-off, or add a per-identity layer (per `auth.uid()` when present, plus the global cap as a backstop) so a signed-in user's reports are not starved by anonymous spam. At minimum note it in the threat model.

### WR-04: read-bill 500 response has no CORS headers

**File:** `supabase/functions/read-bill/index.ts:115`
**Issue:** The outer catch returns `{ 'Content-Type': ... }` only. The browser reports an opaque network error instead of `{error:'server'}`, so `bills.js` cannot map it to a status. plan-intake already fixed this by hoisting `corsHeaders`; read-bill did not.
**Fix:** Hoist `let corsHeaders: Record<string,string> = {}`, assign `corsHeaders = cors.headers` after the origin gate, and spread it into the catch response headers.

### WR-05: Edge error logger can build rows that violate app_errors CHECKs, and the failure is swallowed

**File:** `supabase/functions/_shared/app-errors.mjs:19-22,31`
**Issue:** (a) `message` is scrubbed then sliced but never defaulted: an `Error('')` or a message that scrubs to empty yields `''`, violating `char_length(message) between 1 and 500`. (b) `route` is sliced to 200 but the column CHECK is `<= 120`. In both cases the insert errors, `logEdgeError` swallows it, and the error is lost. Note the Supabase client returns `{error}` rather than throwing, and the code never inspects it, so every insert failure is invisible.
**Fix:**
```js
message: scrub(e ? e.message : err).slice(0, MESSAGE_MAX) || 'unknown error',
...
row.route = scrub(route).slice(0, 120);
```

### WR-06: Edge scrub is weaker than the client scrub (new-format Supabase keys, emails)

**File:** `supabase/functions/_shared/app-errors.mjs:7-12` vs `src/data/error-log.js:29-36`
**Issue:** Client scrub redacts `sb_...` keys, emails and long opaque tokens; the edge scrub only handles Bearer, JWT and `sk-`. New-format Supabase secret keys (`sb_secret_...`) and emails echoed in a thrown error message or stack go to `app_errors` unredacted, which is exactly the table the edge functions' service key writes.
**Fix:** Add `.replace(/\bsb_[A-Za-z0-9_-]{8,}/g, '[redacted]')` and the email pattern to the edge `scrub`, ideally by sharing one implementation.

### WR-07: "Resolve" stamps resolved_at with the admin's clock, then compares it to server time

**File:** `src/data/admin.js:178-182` (compare at `:166`)
**Issue:** `resolved_at` is `new Date().toISOString()` from the browser, while `created_at` is server `now()`. `open = lastSeen > resolvedAt`. If the admin's clock is behind, a just-resolved group stays open; if ahead, genuinely new occurrences within the skew window are hidden as resolved. The codebase elsewhere (set_updated_at trigger) already states the rule that timestamps compared across rows must be server-authored.
**Fix:** Let the DB set it: a `before update` trigger that sets `new.resolved_at := now()` when it changes from null, or an RPC `resolve_app_error_group(p_key)`. Client then sends `{ resolved_at: true }`-style marker or calls the RPC.

### WR-08: session.save() reports a landed save as failed if post-save bookkeeping throws

**File:** `src/data/session.js:161-165,178-181`
**Issue:** Only `env.afterSave` is wrapped. `applyPhotoIds`, `cacheNewPhotos` (`dataUrlToBlob`) and `prunePhotoBlobs` run inside the `.then`; if any throws, the `.catch` calls `failed(err)`: "Couldn't save" toast plus a Retry that redoes a save that already persisted, contradicting the comment on lines 165-168.
**Fix:** Wrap lines 162-164 in the same try/catch (or move them after a `try {...} catch` that only logs), so only the `doSave` outcome decides success.

## Info

### IN-01: Wrong error label in admin editor save failure

**File:** `src/pages/admin.js:258`
**Issue:** Save failure is reported as `'admin: render failed'`, which also groups with real render failures (line 46), making the Errors tab misleading.
**Fix:** Use `'admin: editor save failed'`.

### IN-02: robots.txt group matching treats an empty or very short User-agent token as a match for this bot

**File:** `supabase/functions/_shared/safe-fetch.mjs:128`
**Issue:** `me.includes(a)` with `a === ''` (a bare `User-agent:` line) is true, so that group outranks the `*` group and a `Disallow:` there overrides a `Disallow: /` under `*`. Substring matching also lets `User-agent: c` match. Errs toward over-allowing.
**Fix:** `a && a !== '*' && me.startsWith(a)` (RFC 9309 matches the product token).

### IN-03: Client scrub's 32+ char token rule also redacts long path segments in stacks

**File:** `src/data/error-log.js:36`
**Issue:** `[A-Za-z0-9+/_-]{32,}` includes `/` and `-`, so long URL paths and hyphenated module paths in stack traces get replaced with `[redacted]`, making stacks harder to use. Safe direction, just lossy.
**Fix:** Drop `/` from the class or require a mix of digits and letters.

### IN-04: Buffered reports are flushed before appVersion is known

**File:** `main.js:581-585`, `src/data/error-log.js:87-90`
**Issue:** `errorLog.configure({ client, route })` flushes the buffer immediately; `appVersion` is configured later in `.then`, so early-boot errors (the ones most worth correlating with a build) are stored with `app_version = 'unknown'`.
**Fix:** Resolve `appVersionFromCaches()` first and pass `appVersion` in the same `configure` call, or flush the buffer only after the version resolves.

### IN-05: Minor dead/fragile code

**File:** `src/pages/admin.js:147` and `tools/sw-version.js:24-34`
**Issue:** `decide(box, approve, run)` never uses `approve`. `assetList()` parses `sw.js` with a lazy `\[([\s\S]*?)\]` and a comma split, so a comment containing `]`, `,` or a quote inside `ASSETS` would produce a bogus path and an unhelpful ENOENT.
**Fix:** Remove the unused parameter; make `computeHash` throw a message naming the missing asset, and keep comments out of the `ASSETS` literal.

---

_Reviewed: 2026-11-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
