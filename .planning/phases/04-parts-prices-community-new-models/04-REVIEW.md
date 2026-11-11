---
phase: 04-parts-prices-community-new-models
reviewed: 2026-11-11T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - supabase/functions/autopilot/community.mjs
  - supabase/functions/autopilot/extract.mjs
  - supabase/functions/autopilot/flow.mjs
  - supabase/functions/autopilot/index.ts
  - supabase/functions/autopilot/logic.mjs
  - supabase/functions/autopilot/models.mjs
  - supabase/functions/autopilot/parts.mjs
  - supabase/schema.sql
  - supabase/tests/autopilot.sql
  - test/autopilot-community.test.js
  - test/autopilot-logic.test.js
  - test/autopilot-models.test.js
  - test/autopilot-parts.test.js
  - test/edge-autopilot-flow.test.js
  - test/rls-coverage.test.js
  - test/schema-autopilot.test.js
findings:
  critical: 2
  warning: 9
  info: 5
  total: 16
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-11-11
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Reviewed the autopilot Edge Function (index.ts, flow.mjs and its pure gates), the autopilot section of schema.sql (tables, RLS, grants, SECURITY DEFINER functions and search_path), and the tests. Known fixes (CR-01..WR-16, F1-F12, F4/F11, community-only confidence cap) were not re-raised.

The approval gate and RLS posture hold up: every autopilot function that writes is `security definer set search_path = public` with execute limited to `service_role`, and admin reads are gated by `is_admin()`. The two critical defects are a run-killing failure path driven by web-search citation hosts, and a cost-ledger fail-open that undercounts the hard monthly cap. Warnings cover a publish result that is silently ignored, incorrect "missed item" bookkeeping, a banned host whose hash survives, and several grounding and estimate weaknesses.

## Critical Issues

### CR-01: One unusual citation or search host fails the whole discover/parts/community/models stage

**File:** `supabase/functions/autopilot/flow.mjs:81-82` (also `:264`, `:419`, `:512`); `supabase/schema.sql:2103`
**Issue:** Every candidate host goes to `db.seeDomain(host)`, which calls `autopilot_see_domain`. That function raises `'bad host'` unless the host matches `^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$` and is at most 253 chars. `hostOf()` returns `URL.hostname`, which is valid for many real web results but fails that grammar: underscores (`d1_abc.cloudfront.net`), IPv6 literals (`[2001:db8::1]`), and uppercase-only edge cases after lowercasing are all possible. The exception is not caught inside the stage, so `runDiscover` throws. The job retries three times with the same deterministic input, then fails. Because `discover` is a core stage, `autopilot_publish_run` marks the whole run `failed` and nothing from that car is published for the month. A single search result controls this, so it is a monthly-run denial of service driven by untrusted web content.
**Fix:** Do not raise for a host the grammar rejects. Treat it as held or skipped, the same as an unseen domain:
```js
// flow.mjs, in each host loop
const host = hostOf(url);
if (!hosts.has(host)) hosts.set(host, host && GRAMMAR.test(host) ? await db.seeDomain(host) : 'invalid');
```
Or make `autopilot_see_domain` return `'invalid'` instead of raising, and push `${host}: invalid host` into `skipped`. Add a fixture with `https://a_b.example/` and `https://[::1]/` to `test/edge-autopilot-flow.test.js`.

### CR-02: Cost ledger fails open when the model response has no usage block

**File:** `supabase/functions/autopilot/flow.mjs:52` (`paid()` success path); `supabase/functions/autopilot/index.ts:149` (`settle` wrapper)
**Issue:** On a successful call, `paid()` settles with `response && response.usage`. If that is missing or undefined, the wrapper substitutes `usage ?? {}`, so `autopilot_cost_usd` returns 0 and the reservation is replaced with a cost of 0 SAR. The provider has still run and billed the call. The error path (lines 46-49) deliberately settles at worst case for exactly this reason, so the two paths are inconsistent. The monthly hard cap (D-01) therefore undercounts any call that returns a 200 without `usage` (proxy or gateway rewrites, a malformed body, or a future API change). Once spend is undercounted, `autopilot_reserve` admits further paid calls past the cap.
**Fix:** Settle at worst case when usage is absent, on the success path too:
```js
// flow.mjs paid(), success path
const usage = response && response.usage
  ? response.usage
  : worstCaseUsage({ inputChars: JSON.stringify(request).length, maxTokens: request.max_tokens, maxSearches: (request.tools?.[0]?.max_uses) || 0 });
const s = await deps.db.settle(r.reservation_id, model, usage);
```
Add a test in `test/edge-autopilot-flow.test.js` where `llm` returns `{content:[]}` with no usage and asserts the settled usage is the worst case, not `{}`.

## Warnings

### WR-01: Publish result is ignored, so a refused publish marks the job done and leaves the run `running`

**File:** `supabase/functions/autopilot/index.ts:92`
**Issue:** `await rpc(admin, 'autopilot_publish_run', ...)` discards the return value. `autopilot_publish_run` returns `{ok:false, reason:'jobs_pending'}` or `'not_running'` without raising. Control then reaches `autopilot_finish_job(p_ok: true)`, so the publish job is recorded as done. If it was refused with `jobs_pending` (a job was re-queued by the stale-reclaim or backoff path after the claim), nothing publishes, the run stays `status='running'`, and no retry happens.
**Fix:**
```ts
if (job.stage === 'publish') {
  const pub = await rpc(admin, 'autopilot_publish_run', { p_run: job.run_id });
  if (!pub?.ok && pub?.reason !== 'not_running') throw new Error('publish refused: ' + pub?.reason);
}
```
A refused publish then retries under the normal attempts and backoff.

### WR-02: "Missed item" bookkeeping flags items as unverified when any candidate page was unchanged

**File:** `supabase/functions/autopilot/flow.mjs:141` (`notes.unchanged`); `supabase/schema.sql` in `autopilot_publish_run`, the `missed_runs` block (around line 2232)
**Issue:** `unchanged` is true only when every candidate was unchanged. With two candidate pages, A unchanged and B changed, `unchanged` is false. Items that came from A are never re-staged this run, so `missed_runs` increments for them. After two such runs they are flagged `unverified` (D-16), although their source is unchanged and was verified last time. The publish comment says a car whose extract "reported notes.unchanged" is neither verified nor missed, which the flag does not reflect in the mixed case.
**Fix:** Report the set of unchanged items, not one boolean. Have `runExtract` record the target keys of the unchanged URLs' existing items (or the URLs themselves), and have publish skip only those keys when incrementing `missed_runs`. Alternatively, when a page is unchanged, re-stage its last-known items from `autopilot_findings` or `dealer_plan_items` with `verified=true`.

### WR-03: The page hash is keyed by URL only, so a dealer price page and a schedule page share one "unchanged" state

**File:** `supabase/functions/autopilot/flow.mjs:112` (extract hash check), `:230` (parts dealer hash check), `:140` (stage hash); `supabase/schema.sql` `autopilot_sources` primary key `(car_model_id, url)`
**Issue:** Schedule extraction and dealer-price extraction both call `getSourceHash(car, url)` and `stageSourceHash(...)` against the same table. If a URL is both a schedule candidate and the configured dealer price page, whichever stage runs first records the hash. The other stage then sees "unchanged" and skips its LLM call with its own, different prompt. That prompt was never run for the new content, so one of the two extractions is silently lost each month.
**Fix:** Namespace the hash key by stage, for example `url` = `'parts:' + dUrl` in the parts path, or add a `stage` column to `autopilot_sources` and include it in the key and in `autopilot_get_source_hash`.

### WR-04: A host banned mid-run keeps its pending hash, which is promoted and later fetched by preview

**File:** `supabase/schema.sql` `ban_source_domain` (around lines 2137-2158) and `autopilot_publish_run` pending-hash promotion (around lines 2226-2247); `supabase/functions/autopilot/flow.mjs:550-561` (`runPreview` reads `knownSources`)
**Issue:** `ban_source_domain` deletes findings for running runs but not `autopilot_pending_hashes`. The publish step then promotes those hashes into `autopilot_sources`. `knownSources` reads that table, so `runPreview` fetches a banned host's page. This contradicts the stated rule that banned hosts are never kept (D-07, D-08). The fetch goes through `safeFetch`, so it is not an SSRF bypass, but it does keep and read a banned source.
**Fix:** In `ban_source_domain`, also delete `autopilot_pending_hashes` rows for the banned host (same `evidence_host`-style match on `url`). In `autopilot_publish_run`, skip promotion where `host_banned(h.url)`. In `runPreview`, filter `known` through a banned-host check.

### WR-05: Duplicate engine entries on one page produce duplicate new-car proposals

**File:** `supabase/functions/autopilot/flow.mjs:526-538`; `supabase/functions/autopilot/models.mjs:45-56` (`parseModels` does not dedupe)
**Issue:** `diffModels(found, existing)` is computed once per page before the loop, and `existing.push(...)` happens inside the loop. If the LLM lists the same model and engine twice in one page (for example, under two list sections), both entries pass the diff. `modelId` then gives `…:eng` and `…-2:eng`, so two `car_model` rows are staged for the same engine.
**Fix:** Dedupe within the page as well as across pages, keyed on `nk(model)|generation|engineSlug(name)`, before calling `diffModels`, or have `diffModels` push into its own `out` set and skip any `same` match it has already emitted.

### WR-06: Preview cost estimate omits the community and models stages

**File:** `supabase/functions/autopilot/flow.mjs:549-573`
**Issue:** `runPreview` estimates discover, extract, and parts only, and adds one parts search plus an optional dealer extraction. The monthly run also spends on the community search, up to `MAX_CANDIDATES` community page extractions plus snippet labelling, and the models search plus up to `MAX_CANDIDATES` extractions. The owner's "Check now" estimate therefore understates the spend. The hard cap still holds (every call reserves), but the owner is shown a number that is too low, and the 'worst-case' basis label implies a ceiling.
**Fix:** Add the community and models entries to `pe` the same way parts is added (one search each, plus `MAX_CANDIDATES` extraction calls for models and community pages), or relabel the output as partial and list the stages it leaves out.

### WR-07: Model identity grounding is a substring test, so short names validate against unrelated text

**File:** `supabase/functions/autopilot/models.mjs:70`, `:74`, `:75`, `:78`
**Issue:** `has(s)` is `normaliseForQuote(text).includes(normalised s)`. A model named `"3"` or `"CX-5"` passes if the page contains that substring anywhere, for example "3" inside "2013" or "1.3". The same applies to the year check (`has(String(y))` matches "2019" inside "120190"). The engine check is also substring-based. This weakens WR-03's stated guarantee that identity strings appear in the page.
**Fix:** Match with token boundaries, the way `checkFitment` does: `new RegExp('(?<![\\p{L}\\p{N}])' + escape(n) + '(?![\\p{L}\\p{N}])', 'u')` for both model and year checks, and require the year to be bounded by non-digits.

### WR-08: App-user price agreement uses a 3-user floor while every other aggregate uses 5

**File:** `supabase/functions/autopilot/flow.mjs:304-310` (`users >= 3`); `supabase/schema.sql` `autopilot_user_agreement` (`having count(*) >= 3`, around line 2437-2465)
**Issue:** `store_prices`, `fuel_stats`, `brand_life`, and `repair_stats` all require at least 5 distinct qualified users (privacy floor). The autopilot agreement, which becomes a public `indicative` price and a `part_no`/brand pair, requires only 3. `min(brand)` and `min(part_no)` pick an arbitrary contributor's value, so with three users the published brand or part number can be traced to one person's contribution. The `users` count is also a documented anti-fake rule (COM-03), so the floor should match the rest of the app.
**Fix:** Raise the floor to 5 in `autopilot_user_agreement` (`having count(*) >= 5`) and in the JS check (`Number(u.users) >= 5`), and update the matching tests in `test/autopilot-parts.test.js` and `test/schema-autopilot.test.js`.

### WR-09: Recall evidence links to the raw NHTSA JSON endpoint

**File:** `supabase/functions/autopilot/flow.mjs:170` (evidence `url: f.url`); `flow.mjs:152-160` (`f.url` is the `recallsByVehicle` API URL)
**Issue:** Recall evidence is the `api.nhtsa.gov/recalls/recallsByVehicle?...` JSON endpoint. `community.mjs:101-103` deliberately avoids that for complaints, because the JSON endpoint "shows JSON, not the complaint". The owner clicking through from the admin review queue therefore lands on raw JSON, and the evidence is not a human-readable source.
**Fix:** Use the human NHTSA recall page for evidence (`https://www.nhtsa.gov/recalls?nhtsaId=${encodeURIComponent(campaign)}`), keyed by the campaign number, and keep the API URL only for the fetch.

## Info

### IN-01: `trimmedMedian` is dead production code (only tests call it)

**File:** `supabase/functions/autopilot/parts.mjs:64-70`
**Issue:** Exported and tested, but no production path calls it. The COM-03 median is computed in SQL (`autopilot_user_agreement`), so the JS copy can drift from the SQL rule without any test catching it.
**Fix:** Delete it and its test, or move the trimming into one place (SQL) and drop the JS copy.

### IN-02: Unused parameter `apiUrl` in `groupComplaints`

**File:** `supabase/functions/autopilot/community.mjs:92`; caller at `supabase/functions/autopilot/flow.mjs:403`
**Issue:** `apiUrl` is accepted and never used. The test at `test/autopilot-community.test.js:47` passes a value that does nothing.
**Fix:** Remove the parameter and the argument at the call site and in the tests.

### IN-03: Repeated code in the stage runners

**File:** `supabase/functions/autopilot/flow.mjs` (host-tier loops at `:81-86`, `:263-267`, `:417-422`, `:510-515`; `fit` string at `:213` and `:465`; `str` helper duplicated in `extract.mjs:72`, `models.mjs:37`, `community.mjs:19`; `runCommunity` and `runParts` are each over 100 lines)
**Issue:** The seeDomain-and-classify loop appears four times with slightly different handling. The helper is copied three times, and two stage functions are large enough to hide bugs such as WR-02.
**Fix:** Extract one `classifyHosts(urls, db, skipped)` helper, one shared `str` helper, and one `carFit(car)` helper. Split `runCommunity` into NHTSA, search, label, and alternatives sub-steps.

### IN-04: Reservations from a worker that died are never released

**File:** `supabase/schema.sql` `autopilot_reserve` (around lines 1863-1882); `autopilot_spend` rows with `status='reserved'`
**Issue:** A reservation whose worker crashed before settle stays `reserved` at its full estimate forever. This over-counts month-to-date spend until the month rolls over. It is conservative, so it does not breach the cap, but it can block legitimate work near the cap with no visible cause.
**Fix:** In `autopilot_claim_job`'s stale reclaim, or in a periodic sweep, settle orphaned `reserved` rows older than the 15-minute window at their estimate and mark them, or show a "reserved, unsettled" count in the report.

### IN-05: Reddit citations become evidence and bypass the owner's approved-domain list

**File:** `supabase/functions/autopilot/flow.mjs:417-419` (`if (isReddit(c.host)) { ok.push(c); continue; }`) and `:478-482`
**Issue:** Reddit results skip the `seeDomain` check and are used as alternative-part evidence (tier `community`). The design says reddit is citation-only and never fetched, which is respected, but a reddit quote can still be one of the two hosts that confirm a part number, and it is shown to the owner as evidence. This is a deliberate choice that the review should make explicit, not an error. Note it in the spec or gate it behind a config flag.
**Fix:** Either document the exception next to `isReddit` and in the spec, or require `seeDomain` to be `approved` for any host that contributes a confirming part-number citation.

---

_Reviewed: 2026-11-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
