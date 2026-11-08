# Phase 4: Parts, Prices, Community & New Models - Research

**Researched:** 2026-11-08
**Domain:** Extending the Phase 2 proposal gate and Phase 3 autopilot with four new proposal kinds (parts/prices, community failures, cheaper alternatives, new car models), plus the client overlay that shows approved values.
**Confidence:** MEDIUM-HIGH (all gate/engine/client facts verified by reading the repo; external-site rules for Reddit/forums/PartSouq are NOT verified and are flagged)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Approved parts and prices are stored in a new server table (working name `catalogue_parts`). RLS: users can read it, only `apply_proposal` writes. App fetches and caches it like `src/data/remote-catalog.js`, then overlays it on static `sharedParts` / `DEALER_PRICE` in `src/data/catalog.js`.
- **D-02:** Approved server value vs catalog.js disagree: server wins. catalog.js stays offline/built-in fallback. Owner edits on a saved car are kept (existing `catPrice` refresh rule in `src/data/normalize.js`).
- **D-03:** `apply_proposal`, `apply_proposals`, `revert_change`, `proposal_live` gain the new kinds (today only `schedule_item` and `recall`). Approve and revert behave exactly like schedules: stale refusal, change_log entry, one-click revert.
- **D-04:** Fitment pinned per `car_model` id (`<modelId>:<engine-slug>`, from `catalogId()`). One proposal per car + engine + part slot. A part checked on one engine must never apply to another.
- **D-05:** Only the Mazda KSA dealer price list (mazda.com.sa/ppl) counts as an "official catalogue" for PRT-01. Any other source needs 2+ independent sources agreeing on part number and fitment.
- **D-06:** Allowed price sources: (1) Mazda KSA dealer list; (2) web search snippets (no fetch of marketplaces whose terms forbid it; noon and Amazon.sa snippet-only); (3) app users' price reports (`price_observations`, part `contributions`) subject to D-13; (4) shop pages whose terms and robots allow fetching, through `safeFetch`.
- **D-07:** Materiality: a price change is proposed only when **both** >=10% **and** >=5 SAR versus the live value. Smaller changes dropped before the queue.
- **D-08:** "indicative" label (EN + AR) only on non-dealer prices, in the user parts list and in the admin diff. Dealer-list prices show without it.
- **D-09:** Price shape stays: one OEM option and cheaper alternative options, each with its own SAR price. No ranges.
- **D-10:** Community sources: Reddit (r/mazda, model subreddits), Mazda owner forums (mazdas247, cx5mods, mazda3revolution), Arabic/GCC car forums, NHTSA complaints (separate from recalls). New domains still need owner approval (Phase 3 D-07).
- **D-11:** A common failure is proposed only with 3+ distinct mentions across 2+ different domains. Mention count and source links show in the diff.
- **D-12:** Users see approved failures in a "Known issues" card on the car page, near recalls: failure, typical km if known, mention count, source links.
- **D-13:** COM-03 agreement = 3+ distinct `user_id`s on the same `car_model` (model:engine) and part key. Prices outside median +-30% dropped before counting; proposed value = median of the rest.
- **D-14:** Cheaper alternatives (COM-02) from forums and user submissions. User-sourced follow D-13. Forum-sourced follow the D-05 2-source rule.
- **D-15:** New models detected from Mazda KSA/GCC sites first (Phase 3 D-06). A model not sold in Saudi/GCC is not proposed.
- **D-16:** A new-model proposal = identity plus basics: model, generation, years, engines, oil capacity, warranty, sources. Paints/photos manual.
- **D-17:** Id generated in code with the same rule as `catalogId()`. Owner can edit it before approving.
- **D-18:** Once approved the model appears in the app picker: app merges approved server `car_models` into static `CAR_MODELS`. Until schedule and parts are approved, the car shows a "catalogue in progress" note (EN + AR); later monthly runs fill it in.
- **D-19:** Keep SAR 40 hard monthly cap. Schedules and recalls run for every car monthly. Parts, prices, community stages rotate across cars that are due (each car every 2-3 months). Model detection runs once per month, not per car.

### Claude's Discretion
- Table name and schema for approved parts, failures and alternatives (one table or several), plus the new proposal `kind` values.
- Exact rotation rule for D-19 and where "due" is tracked.
- How snippet prices are extracted and quoted while still meeting the verbatim-quote rule (Phase 3 D-12 / ENG-07).
- Where the Known issues card sits.
- Outlier trimming implementation.

### Deferred Ideas (OUT OF SCOPE)
- Licensed car photos (PHO-01/02): v2.
- Price ranges instead of single prices: rejected (D-09).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PRT-01 | OEM parts per car (name, part number, fitment), confirmed by 2+ sources or official catalogue | `part` kind; `confirmParts()` 2-host rule in code; note the dealer list has NO part numbers (Pitfall 2) |
| PRT-02 | Indicative SAR prices from search results and user reports, labelled indicative | `price_basis` column; snippet citations (Pattern 3); user report SQL fn (Pattern 5) |
| PRT-03 | Immaterial price changes not proposed | `isMaterial()` in code + SQL defence in `submit_proposal` (Pattern 4) |
| COM-01 | Common failures with mention counts and sources | `failure` kind, `known_issues` table, Known issues card (Patterns 6, 8) |
| COM-02 | Cheaper alternatives from forums and users | `part` kind with `tag:'ALT'` slot `alt:<brand-slug>` |
| COM-03 | User submissions need 3+ distinct users, outliers trimmed | `autopilot_user_agreement()` SQL fn over `contributions` + `contribution_links` (Pattern 5); engine-null gotcha (Pitfall 1) |
| NEW-01 | New models/generations/engines as draft proposals | `car_model` kind, `models` run-level job, picker merge `registerModels()` (Patterns 7, 9) |
</phase_requirements>

## Summary

Phase 4 is an extension of two existing, working systems, not new infrastructure. The Phase 2 gate (`submit_proposal` / `apply_proposal` / `revert_change` / `proposal_live` / `proposal_confidence`, `supabase/schema.sql` L1039-1360) hard-codes the two kinds `schedule_item` and `recall` in **seven** places (see Wave-1 checklist). The Phase 3 engine (`flow.mjs`, `extract.mjs`, `logic.mjs`, `index.ts`) already has the per-car job queue, cap/kill reservation, staging, publish and domain approval; new stages plug into `index.ts`'s `work()` dispatch and the `autopilot_jobs.stage` check. No new npm packages are needed.

Four findings change the plan materially and contradict assumptions in CONTEXT.md:
1. **Dealer list has no part numbers** (catalog.js L399: "The dealer list names parts but gives no numbers"). D-05 makes it the only "official" source, so it can confirm prices and fitment-by-page but never a part number. Part numbers always need 2 independent sources.
2. **Part contributions carry no engine.** `insights.partContributions()` never sets `engine` and `maintenance.js:127` does not pass it, so `contributions.engine` is NULL for every `kind='part'` row. D-13's "model:engine" cannot be evaluated from existing data. `price_observations` has no car or engine link at all, so it cannot satisfy D-13 either.
3. **User-sourced proposals have no URL.** `submit_proposal` requires 1-10 evidence items each with an `https://` url; `autopilot_publish_run` calls `host_banned(url)` (fail-closed: null url = banned); `sources_hash` concatenates urls. A "4 app users agree" proposal fails all three unless evidence gets a non-URL variant.
4. **Baseline for materiality does not exist server-side.** Static prices live only in catalog.js; `proposal_live` would return null for every part, making every price an "insert" and PRT-03 untestable. Seed `catalogue_parts` from catalog.js with the existing generator pattern (`tools/seed-catalogue.js`).

Cost: the cap is shared with Phase 3 and a cap hit discards **all** staged findings (D-02, `autopilot_end_run`). New stages must therefore run last and bail out softly on low remaining budget rather than risk the hard cap wiping the schedule findings.

**Primary recommendation:** Four kinds `part`, `failure`, `car_model` (plus `part` covering both OEM and ALT slots); two new live tables `catalogue_parts` and `known_issues`; new stages `parts`, `community` (per due car, queued after all core jobs) and `models` (one run-level job); soft-budget guard; non-URL evidence type `users`; seed baseline parts from catalog.js.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Source discovery, fetch, LLM extraction, quote/2-source/mention validation | Edge Function (pure `.mjs` + I/O in `index.ts`) | — | Needs secrets, `safeFetch`, Anthropic; validators are code, not prompt (Phase 3 pattern) |
| Materiality, outlier trim, mention counting, 3-user agreement | Edge pure code + Database SQL fn | — | User agreement needs `contribution_links` (anonymity table, service role only); text-source rules are pure code |
| Staging, dedupe, queue, stale check, apply, revert | Database (`submit_proposal`, `apply_proposal`, ...) | — | Existing gate; only `apply_proposal` writes live tables |
| Approved parts/failures/models storage | Database (`catalogue_parts`, `known_issues`, `car_models`) | — | RLS, public read of approved rows |
| Rotation ("due" tracking), soft budget | Database (`autopilot_start_run`, table) | Edge | Atomic and race-free like the cap |
| Overlay approved parts onto cars, picker merge, Known issues card, indicative label | Browser (`remote-catalog.js`, `catalog.js`, pages) | — | Offline-first cache in meta store |
| Admin diff rendering for new kinds | Browser (`admin-proposals.js`) | — | Must use `html`/DOM `textContent` only (REV-09) |

## Standard Stack

No new dependencies. [VERIFIED: codebase, package.json devDependencies only]

| Piece | Where | Use in Phase 4 |
|-------|-------|----------------|
| `safeFetch`, `DEFAULT_POLICY`, `NHTSA_POLICY` | `supabase/functions/_shared/safe-fetch.mjs` | every page/API read; NHTSA complaints reuse `NHTSA_POLICY` (same host as recalls) |
| `htmlToText`, `sha256Hex` | `plan-intake/logic.mjs` | text + hash for ENG-08 skip |
| `normaliseForQuote`, `quoteHasNumber`, `nk`, `clash` | `autopilot/extract.mjs` | verbatim and generation/engine checks; extend `UNIT_WORD` with `litres`, `years`, `sar` |
| `buildSearchRequest`, `extractSearchUrls`, `worstCaseEstimate` | `autopilot/logic.mjs` | search; add citation extractor beside them |
| `paid()` reserve/settle wrapper | `autopilot/flow.mjs` | every paid call |
| `autopilot_see_domain` + `source_domains` | schema.sql | owner approval of new forums |
| `tools/seed-catalogue.js` + `test/seed-catalogue.test.js` | repo | pattern for seeding `catalogue_parts` baseline |
| `node --test`, `supabase/tests/*.sql`, `test/rls-coverage.test.js` | repo | tests |

Models/prices: unchanged from Phase 3 (`claude-haiku-5-5` discovery, `claude-sonnet-5-5` extraction, price table in `autopilot_config`). [VERIFIED: index.ts L114-115, schema L1385-1391]

## Package Legitimacy Audit

No external packages are installed in this phase. Not applicable. **Packages removed:** none. **Flagged [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
pg_cron monthly -> autopilot_start_run('monthly')
   core jobs (all cars): discover -> extract -> recalls                      (unchanged)
   NEW optional jobs, queued AFTER all core jobs (ids higher => claimed later):
      parts      x N due cars   (oldest last_done first, N = config cap)
      community  x N due cars
      models     x 1 (car_model_id null, like publish)
   publish (waits for everything)

parts job (per car):
  soft-budget guard (autopilot_budget_left() < floor?) -> skip, report 'skipped: budget'
  A. dealer price page (mazda.com.sa/ppl) -> safeFetch -> htmlToText -> price per part (official)
  B. web search (haiku) per part group -> text blocks WITH citations (cited_text<=150 chars, url)
     -> code builds snippet quotes from API citations, NOT from model JSON
  C. optional fetch of approved shop/catalogue hosts via safeFetch (robots decides)
  D. user agreement SQL fn (free) -> user price/alt candidates
  -> confirmParts(): part_no needs >=2 distinct hosts (normalised equal) + fitment check vs car:engine
  -> price: isMaterial(live,next) (>=10% AND >=5 SAR) else drop
  -> stageFindings(kind 'part', target_key '<Part>|oem' or '<Part>|alt:<brand-slug>')
community job (per car):
  NHTSA complaintsByVehicle (free, NHTSA_POLICY) + web search/forum fetch (reddit snippet-only)
  -> LLM labels each (url, quote) with a failure category from a fixed enum
  -> code counts distinct urls, distinct hosts; keep >=3 mentions AND >=2 hosts
  -> stageFindings(kind 'failure')   (+ alternatives from forums -> kind 'part', 2-source rule)
models job (once): GCC-only search (no pass 2) -> approved GCC hosts -> extract -> diff vs car_models
  -> stageFindings(kind 'car_model', car_model_id null)
publish -> submit_proposal per finding -> owner queue (admin-proposals.js renders new kinds)
owner approve -> apply_proposal -> catalogue_parts / known_issues / car_models (+ change_log)
app boot -> remoteCatalog.refresh(): models, items, parts -> registerModels() into CAR_MODELS,
            applyParts(vehicle) with catPrice ownership rule, known issues fetched per model
```

### Recommended Project Structure
```
supabase/schema.sql                       # append "Phase 4" section (re-runnable)
supabase/seed-parts.sql                   # GENERATED by tools/seed-parts.js (baseline from catalog.js)
tools/seed-parts.js                       # sibling of tools/seed-catalogue.js
supabase/functions/autopilot/parts.mjs    # pure: confirmParts, isMaterial, priceFromCitations, trimOutliers, fitment checks
supabase/functions/autopilot/community.mjs# pure: failure vocabulary, countMentions, NHTSA grouping
supabase/functions/autopilot/models.mjs   # pure: modelId rule (parity with catalogId), diffModels, validators
supabase/functions/autopilot/flow.mjs     # add runParts, runCommunity, runModels (same deps/paid() shape)
supabase/functions/autopilot/index.ts     # work() dispatch + new deps.db methods
src/data/remote-catalog.js                # fetch parts + model cols, applyParts, registerModels call
src/data/catalog.js                       # registerModels(rows), reset _sharedMap
src/data/known-issues.js                  # copy of recalls.js pattern (new file => index.html + sw.js)
src/pages/admin-proposals.js              # diff renderers for part/failure/car_model
src/pages/dashboard.js                    # Known issues card under recall box (L289-298), "catalogue in progress" note
src/pages/parts.js                        # "indicative" pill on option rows
src/i18n/strings.ar.js                    # AR strings
test/*.test.js, supabase/tests/proposals.sql + autopilot.sql
```

### Pattern 1: New live tables (D-01) — schema

```sql
-- one row per car:engine x part x slot. slot = 'oem' | 'alt:<brand-slug>'
create table if not exists public.catalogue_parts (
  car_model_id text not null references public.car_models on delete cascade,
  part_name    text not null,                       -- exactly sharedParts() name, e.g. 'Oil Filter'
  slot         text not null check (slot ~ '^(oem|alt:[a-z0-9-]{1,40})$'),
  brand        text not null default '',
  part_no      text not null default '',
  price        numeric check (price > 0 and price < 100000),
  price_basis  text not null check (price_basis in ('dealer','indicative','static')),
  note         text not null default '',
  sources      jsonb not null default '[]',
  updated_at   timestamptz not null default now(),
  primary key (car_model_id, part_name, slot)
);
create table if not exists public.known_issues (
  car_model_id text not null references public.car_models on delete cascade,
  issue_key    text not null check (issue_key ~ '^[a-z0-9-]{1,60}$'),
  title        text not null, summary text not null default '',
  typical_km   int, mentions int not null check (mentions >= 3),
  sources      jsonb not null default '[]',        -- [{url, host}]
  updated_at   timestamptz not null default now(),
  primary key (car_model_id, issue_key)
);
alter table public.car_models add column if not exists parts_updated_at timestamptz not null default now();
alter table public.car_models add column if not exists markets text[] not null default '{KSA}';
```
RLS: copy the `dealer_plan_items` select policy (approved car or admin; grant select to anon, authenticated), **no write policy**, `revoke insert, update, delete ... from anon, authenticated`. `test/rls-coverage.test.js` has a Phase 3 block asserting admin-only select for autopilot tables; add a sibling assertion block for these two (public read, no write policy). `parts_updated_at` is bumped by `apply_proposal` (security definer) for `part` kind; `on_car_model_change` compares row minus only `plan_updated_at`, so add `parts_updated_at` to its excluded keys or every parts approval logs a bogus car change. [VERIFIED: schema L712-724]

### Pattern 2: Proposal kinds and the 7 hard-coded spots (Wave 1, one migration)

`target_key` (<=120 chars) and `after` shapes:

| kind | car_model_id | target_key | after |
|------|--------------|-----------|-------|
| `part` | `<modelId>:<engine-slug>` | `Oil Filter|oem` or `Oil Filter|alt:denso` | `{tag, brand, part_no, price, price_basis, note}` (+ `fitment` text for admin diff only) |
| `failure` | same | `issue_key` slug | `{title, summary, typical_km, mentions}` (sources are the evidence) |
| `car_model` | **null** (model does not exist yet) | proposed id | `{make, model, generation, engine, oil_capacity_l, warranty_years, warranty_km, markets, years}` |

Edit list (all in `supabase/schema.sql`) — miss one and approve/revert/stage fails with `unsupported kind`:
1. `proposal_live` (L1043-1049): add branches reading `catalogue_parts` (`part_name = split_part(target,'|',1)`, `slot = split_part(target,'|',2)`), `known_issues`, `car_models`.
2. `submit_proposal` kind guard (L1099) + per-kind validation block (like the recall block L1104) + `ah` hash branch (L1133-1141). `car` lookup (L1100-1101) raises `unknown car` for `car_model` kind: branch on kind; maker comes from the `p_maker_id` parameter (already exists) defaulting to `'mazda'`.
3. `proposal_confidence`: its numeric-change loop only knows interval keys (L1075). Add `price` for `part`. For `failure`/`car_model` there is no `before`, score comes from sources only.
4. `apply_proposal` kind guard (L1188), `for update` lock branch (L1189-1193), write branch, `tbl`, `change_log` insert.
5. `revert_change` kind guard (L1317), lock branch, restore branch, `table_name` CASE (L1353).
6. `autopilot_stage_findings` kind guard (L1714) and the `autopilot_findings.kind` check constraint (L1450): drop and re-add (default name `autopilot_findings_kind_check`; do it in a `do $$` that looks the name up in `pg_constraint`).
7. `autopilot_jobs.stage` check constraint (L1417): add `parts`, `community`, `models`.

`apply_proposals` has no kind guard; it delegates to `apply_proposal`. Add an explicit refusal of `car_model` in bulk (owner must look at a new car): return `{ok:false,error:'not_bulk'}`.

`car_model` apply: honour `p_edit` id edits (D-17): `new_id := coalesce(v->>'id', p.target_key)`; insert into `car_models` with `status='approved'` (single approval step; the "draft" in the success criterion is the pending proposal itself) and `markets` validated against `{KSA,UAE,KW,QA,BH,OM}`; `change_log.row_key = new_id`, `car_model_id = new_id` (FK satisfied because insert happens first). The `car_models_set_maker` trigger fills `maker_id`. Revert of `car_model`: allowed only when no `dealer_plan_items`/`catalogue_parts` exist for it (else `{ok:false,error:'in_use'}`), because `on delete cascade` would silently delete approved plans.

### Pattern 3: Snippet prices must come from API citations, not model JSON (D-06.2, ENG-07)

Search results are opaque; only `citations[].cited_text` (<=150 chars) and `url` are readable. [CITED: Phase 3 03-RESEARCH.md citing platform.claude.com web-search-tool docs] The model-written JSON is untrusted. Therefore:
- Ask the haiku call for a prose answer with citations; in code collect each `text` block's `citations` array (`type:'web_search_result_location'`, `url`, `cited_text`).
- A price evidence quote = the `cited_text` itself. Accept only if it contains the number adjacent to `SAR|SR|ر.س|ريال` (extend `quoteHasNumber` with a `sar` unit; digits normalised by `westernDigits`).
- Evidence `{url, quote: cited_text, tier: 'community'}`; `price_basis:'indicative'`. noon/Amazon.sa are never fetched, only appear as citation URLs (D-06). Domain still passes `autopilot_see_domain` (unseen => held).
- Same mechanism supplies a part-number "second source": a citation whose `cited_text` contains the normalised part number counts as one source host.

Dealer list (`mazda.com.sa/ppl`, tier `official`, `price_basis:'dealer'`): fetch via `safeFetch` and verify the quote in fetched text like schedules. **Unverified:** whether the page is server-rendered HTML or JS-rendered (no headless browser is allowed, REQUIREMENTS Out of Scope). If JS-rendered the fetch yields no prices; fallback is the existing manual `DEALER_PRICE` entry (it was entered by a quick task, `.planning/quick/261107-w40`). Make this a Wave-0 smoke check (Open Question 1).

### Pattern 4: Materiality and the 2-source rule (pure, in `parts.mjs`)

```js
// D-07: BOTH conditions. live null (no baseline) => always material (insert).
export const isMaterial = (live, next) =>
  live == null || (Math.abs(next - live) >= 5 && Math.abs(next - live) / live >= 0.10);

// D-05: part number normalised, needs >=2 distinct registrable hosts, or an official-tier evidence.
const normPart = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
export function confirmParts(cands) {           // cands: [{part_no, host, tier, quote}]
  const by = new Map();
  for (const c of cands) { const k = normPart(c.part_no); if (k.length < 6) continue;
    (by.get(k) || by.set(k, []).get(k)).push(c); }
  return [...by.values()].filter(g => new Set(g.map(x => x.host)).size >= 2 || g.some(x => x.tier === 'official'));
}
```
Because the dealer list has no numbers (finding 1), the `official` clause only applies to price-only proposals. Registrable-host comparison must collapse subdomains (`www.`, `shop.`) so two pages of one site are not "2 sources": use last two labels, plus a small list for `.com.sa`/`.co.uk`-style suffixes. [ASSUMED: no public-suffix library in repo; hand-rolled helper with a test]. Fitment (D-04): require the quote/page to name the model (`nk` containment as in `validateItem`) and a year inside the generation's `yearsOf()` range, and reject engine clashes with `clash()`.

Defence in depth: `submit_proposal` for `part` returns `{'action':'immaterial'}` when `price_basis <> 'dealer'`, both prices numeric and the change is below threshold, and counts as skipped in the report. Thresholds are `autopilot_config` columns (`min_pct`, `min_sar`) not literals (CORE-06).

### Pattern 5: User agreement (COM-03, D-13) — SQL function over the anonymity table

`contribution_links(user_id, source_key, contribution_id)` is the only place user ids exist; `contributions` has none; both are revoked from `anon, authenticated` [VERIFIED: schema L589]. So agreement is computed inside a `service_role`-only `security definer` function, and **only aggregates leave it**:

```sql
create or replace function public.autopilot_user_agreement(p_car text) returns jsonb ...
-- per (item_key, brand/part_no): latest price per user; median; keep within +-30% of median;
-- recount distinct users; return only groups with >=3 users after trimming:
-- [{item_key, brand, part_no, users, median_price}]
```
Rules: one price per user (latest) before the median, otherwise one heavy user dominates. Group key = `lower(item_key)` + normalised `part_no` or lowercased brand. `item_key` is `lower(trim(part name))` from `insights.partContributions`, so match to catalogue names case-insensitively. Match model via `contributions.model_id = <modelId>`; engine rule below.

**Engine gap (finding 2):** change `insights.partContributions` and `maintenance.js:127` to include `engine` (`submit_contributions` already inserts `engine`). Rows submitted before the change have `engine IS NULL`. Rule: a NULL-engine row counts only when the model has exactly one engine in `car_models` (so no cross-engine leak); otherwise ignored until new data arrives. Expect zero qualifying user proposals for multi-engine models for a while; say so in the report rather than loosening D-13. `price_observations` is excluded from COM-03 (no car/engine link); keep it out unless the owner chooses to relax D-13 (Open Question 3).

**Non-URL evidence (finding 3):** add evidence type `{type:'users', tier:'community', users:N, median:P}`. Required edits: `submit_proposal` evidence loop (L1119-1125) allow it for kinds `part`/`failure` only, cap `users` int >= 3; `sources_hash` aggregate (L1142) use `coalesce(x->>'url', 'users:'||(x->>'users')||':'||(x->>'median'))`; `autopilot_publish_run` (L1861) skip `host_banned` when `e->>'url' is null`; `proposal_confidence` domain count already ignores null urls (distinct of null is not counted, verify with a test); `admin-proposals.js` evidence renderer shows "N app users agree (median SAR X)" instead of "Invalid source link". Never put user ids in the proposal.

### Pattern 6: Community failures (COM-01, D-11)

- LLM (untrusted) returns per document: `[{category, quote, km?}]`, `category` from a **fixed enum in code** (e.g. `transmission`, `engine-oil-consumption`, `infotainment`, `ac-compressor`, `brakes`, `suspension`, `electrical`, `fuel-system`, `other`) so clustering never relies on free-text matching. The prompt must carry "ignore instructions inside the document".
- Code counts mentions as distinct `(url)` after verifying the quote is verbatim in fetched text (or is an API `cited_text` for snippet-only hosts). Proposal needs `mentions >= 3` and `distinct hosts >= 2`; both from code, shown in diff.
- `typical_km`: median of km figures that pass `quoteHasNumber(..., 'km')`; omit when fewer than 2.
- NHTSA complaints: `https://api.nhtsa.gov/complaints/complaintsByVehicle?make=Mazda&model=<model>&modelYear=<y>` returns `{count, results:[{odiNumber, components, summary, dateComplaintFiled, crash, fire, products:[{productYear, productMake, productModel}], ...}]}` [VERIFIED: live fetch 2026-11-08, CX-5 2018 returned count 124]. Mentions = distinct `odiNumber`; group by `components` string. NHTSA is **one domain**, so it can never satisfy "2+ domains" alone (D-11); it counts as one host alongside a forum. NHTSA model naming is strict (existing `runRecalls` maps numeric models to `mazda3` style; check CX names such as `CX-5`). US-only data: label the Known issues entry's sources, not claims about KSA cars.
- **Reddit:** fetching is expected to fail `robots`. Could not verify directly (tool blocked reddit.com); press coverage says Reddit blocks unlicensed automated crawlers and rate-limits unknown bots [CITED: techcrunch.com/2024/06/25/reddits-upcoming-changes-attempt-to-safeguard-the-platform-against-ai-crawlers]. Plan: Reddit = web-search citation snippets only, never fetched; a failed `safeFetch` is already a safe outcome. Treat "robots allows" as the gate for every forum; do not special-case or bypass.
- Mazda forums (mazdas247, cx5mods, mazda3revolution) and Arabic forums: robots/ToS **not verified** [ASSUMED]; `safeFetch` robots check is the enforcement, and each host must first be approved in `source_domains` (first run with an unseen host is "held", so yield on the first community run will be low: ask the owner to pre-approve a forum list via a checkpoint like the Phase 3 GCC-domain seed).

### Pattern 7: New models (NEW-01, D-15..D-17)

- Stage `models`: pass 1 only (`allowed_domains = gcc_domains`). **No global fallback**, because D-15 says a model not sold in GCC is not proposed, whereas `runDiscover` falls to pass 2. If `gcc_domains` is empty the stage is skipped and reported (Phase 3 verification left the GCC list as an open owner item: 03-VERIFICATION.md L21; Open Question 2).
- Extraction: model, generation, years, engines `[{code, oil_l, warranty_years, warranty_km}]`, `markets` (enum). Each numeric field needs a verbatim quote with unit: extend `UNIT_WORD` with `litres` (`l|litres?|liters?|لتر`) and `years` (`years?|yrs?|سنوات|سنة`).
- Diff against **all** `car_models` rows (any status, so a rejected-then-resurfaced model is deduped by `submit_proposal` suppression): compare by `nk(model)` + generation clash; engine slug via the same rule as `catalogId`.
- Id rule (D-17): `<modelSlug>:<engine-slug>` where engine part is exactly `catalogId`'s regex (`toLowerCase().replace(/[^a-z0-9.]+/g,'-').replace(/^-|-$/g,'')`). The model part has no formula in the repo (existing ids like `cx5kf`, `mazda3bp` are hand-made), so generate `<model-slug>-<start-year>` (e.g. `cx-70-2024`), check collision against existing ids, owner edits at approval. `models.mjs` is an ES module for Deno and `catalog.js` is a classic dual-mode script, so duplicate the 3-line regex and add a `node --test` parity assertion against `catalogId()`.
- `year` handling uses the existing `yearsOf()` in `flow.mjs`.
- Evidence tier `official` for GCC Mazda hosts. Keep paints empty (`'[]'`), photos manual (D-16).

### Pattern 8: Rotation and budget (D-19) in `autopilot_start_run`

- New table `autopilot_due(car_model_id, stage, last_done_at, primary key (car_model_id, stage))`, RLS on, admin select, writes only inside `autopilot_finish_job` when a `parts`/`community` job finishes `done`. Failed or skipped jobs leave `last_done_at` alone so the car stays due.
- `autopilot_start_run`: after inserting the existing core jobs, insert `parts` and `community` jobs for the `autopilot_config.optional_cars_per_run` (new column, default 6) approved cars ordered by `last_done_at nulls first`. Insert them after the core jobs so `order by q.id` in `autopilot_claim_job` claims them last. 16 cars / 6 per run = every car about every 3 months; owner can raise it. Manual "Check now" runs queue both stages for that car regardless of due (owner asked explicitly); preview must include them in the estimate.
- Add `models` job (car null) once per monthly run; `autopilot_claim_job` already handles null-car jobs (publish precedent); update the `publish waits for all others` logic (already generic).
- **Soft budget:** new SQL `autopilot_budget_left() returns numeric` = cap minus settled and reserved month spend. Optional runners check it first and return `{ok:true, notes:{skipped:['budget']}}` below a floor (config `optional_floor_sar`, default ~8). Reason: any hard cap hit calls `autopilot_end_run`, which deletes every staged finding of the run including already-good schedule findings. Optional spend must never trigger that.
- Cost estimate [ASSUMED, validate with first dry run]: Phase 3 about SAR 10/month. Parts job ~3-4 searches + 1-2 extractions ≈ USD 0.08-0.12; community ≈ USD 0.10; 6 cars x 2 ≈ USD 1.2-1.4 (SAR ~5); models ≈ USD 0.1. Total stays well under SAR 40. The reservation ceilings are worst case so they will be larger than actuals; lower `search_max_uses` per stage if reservations block calls.

### Pattern 9: Client overlay and picker (D-01, D-02, D-18)

- `remote-catalog.refresh()`: also fetch `catalogue_parts` (page like `allItems`, `order by car_model_id, part_name, slot`) and widen the models select to `id,make,model,generation,engine,oil_capacity_l,paints,markets,warranty_years,warranty_km,plan_updated_at,parts_updated_at`. Cache shape grows to `{models, items, parts, fetchedAt}`; `load()` must tolerate a cached object without `parts` (old cache).
- `applyParts(data)` mirrors `applyDealerPlan`: key = `car.catalogId`, version = `m.parts_updated_at` stored as `car.partsVersion`; only newer versions apply. For each `catalogue_parts` row find the part by name and the option by tag (OEM) or by brand match (ALT, lowercase):
  - Overwrite price/partNo/brand/note **only if owned**: `o.catPrice != null ? o.price === o.catPrice : false` (same rule as normalize.js L234, but no LEGACY fallback). Then set `catPrice = row.price` and `o.indicative = row.price_basis === 'indicative'`.
  - ALT not present: push a new option stamped with `catPrice`. Never delete an owner's option.
- New cars: call `applyParts(data, {force:true})` next to the existing `applyDealerPlan(..., {force:true})` at main.js L136, and `syncDealerPlan()` (L728) gets a sibling.
- `sharedParts()` itself stays the offline fallback; do not make it read the cache (keeps it pure and `test/catalog.test.js` valid).
- `registerModels(rows)` in `catalog.js`: group approved server rows whose `modelId = id.split(':')[0]` is not in static `CAR_MODELS` (or whose engine is missing from the static model's engine list, for new engines) into `{id, markets: row.markets, model, gen: generation, engines: [[engine, oil_capacity_l]], colors: paints.length ? paints : [DEFAULT_COLOR]}`; append in id order so existing indices stay stable (main.js L118-127 uses indices; its comment warns about reordering); reset `_sharedMap = null` (catalog.js L529 memo). Call it from `remoteCatalog.load()` and `refresh()` before the picker is built. Static wins over server for the same `modelId` (D-02 covers values, not identity; avoid two entries for one car).
- Verify `buildProfile`, `engineInfo`, `sharedParts`, `tireShapeFor` (`/^cx/` id test) behave for an unseen id; they fall back to generic "verify" values. "Catalogue in progress" note: show when `remoteCatalog.dealerPlan(id)` is empty (no `dealer_plan_items`) or no `catalogue_parts` rows for the car; EN + AR.
- Known issues: `src/data/known-issues.js` is a copy of `recalls.js` (TTL cache, never rejects, select `issue_key,title,summary,typical_km,mentions,sources`), rendered in `dashboard.js` directly after the recall box (L289-298) as another `card` using `el()`/`textContent`; source links built like the admin evidence link (https-only, `rel="noopener noreferrer"`, `dir="ltr"`). Each new script: `index.html` order + `sw.js` `ASSETS` + `npm run sw:version` (`test/precache.test.js`).
- Admin: `admin-proposals.js` `proposalDiffLines` currently branches only for `recall`; the row summary at L51-95 calls `catalogAdmin.draftDiff` (schedule fields) and `t(p.kind === 'schedule_item' ? ...)` (L95, L313). Add renderers + kind labels for `part` (brand, part number, price with "indicative" pill, fitment), `failure` (title, mentions, km, host list), `car_model` (model, generation, years, engines, oil, warranty, editable id field wired to `p_edit`). Add AR strings; `test/parts-ar.test.js` and `test/strings-ar-unique.test.js` guard coverage/uniqueness.

### Anti-Patterns to Avoid
- Trusting model-supplied quotes or counts for prices and mentions. Only API citations, fetched text and SQL aggregates count.
- Letting the NHTSA complaint count stand in for two domains.
- A global-search fallback for new models (breaks D-15).
- Queuing optional jobs before core jobs, or running them without a soft budget (cap hit deletes schedule findings).
- Applying a part proposal by `part_name` alone: always key by `car_model_id` (already model:engine) so one engine's number never lands on another (D-04).
- Putting user ids, even hashed, in `proposals.evidence`.
- Rendering scraped text through `innerHTML`; use `html` template or `textContent`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSRF/robots/redirect/size | new fetcher | `safeFetch` | tested; CLAUDE.md mandates |
| Dedupe/suppress/supersede/stale/revert | new queue logic | extend `submit_proposal` / `apply_proposal` / `revert_change` | gate semantics already tested |
| Cap, kill switch, spend | counters in worker | `paid()` + `autopilot_reserve/settle` + new `autopilot_budget_left()` | race-free in SQL |
| Domain approval/ban | allowlist in code | `source_domains`, `autopilot_see_domain` | D-07/D-08 done |
| Quote check | substring in prompt | `quoteHasNumber` (+ new units) | handles Arabic digits, NFKC, unit adjacency |
| Generation/engine clash | new fuzzy match | `nk` / `clash` / `yearsOf` | existing and tested |
| Catalogue id | new slug rule | copy `catalogId` regex + parity test | D-17 |
| Baseline prices server-side | hand-typed SQL | `tools/seed-parts.js` generated from catalog.js + sync test | same pattern as seed-catalogue |
| Median/trim | stats lib | ~10 lines in SQL and `parts.mjs` | no dependency needed |

## Runtime State Inventory

Not a rename/refactor phase, but there are state items:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `contributions.engine` NULL for all existing part rows; saved vehicles hold part option prices with/without `catPrice` stamp | Client change to send engine (code edit, no backfill possible); overlay respects `catPrice` ownership; legacy un-stamped options are never overwritten by `applyParts` (unlike normalize LEGACY list) |
| Live service config | `autopilot_config` row id 1 (cap, prices, `gcc_domains` seeded empty) lives in DB only; `source_domains` approvals are DB-only | Add new config columns with `add column if not exists`; owner pre-approves forum + dealer hosts; owner supplies `gcc_domains` |
| OS-registered state | pg_cron jobs `autopilot-monthly`, `autopilot-work` unchanged | None |
| Secrets/env vars | none new (`ANTHROPIC_API_KEY`, `INTAKE_CRON_SECRET`) | None |
| Build artifacts | `sw.js` precache `CACHE` version, new `src/data/known-issues.js` | `npm run sw:version`; index.html order |

## Common Pitfalls

### Pitfall 1: "3 distinct users on model:engine" cannot be computed from existing data
**What goes wrong:** the SQL fn returns nothing, or silently pools engines.
**Why:** `partContributions` omits `engine`; `price_observations` has no car link.
**Avoid:** client change + NULL-engine rule above; report "0 qualifying groups" as a normal outcome; write the SQL test with fixtures for both a single-engine and a multi-engine model.

### Pitfall 2: Official source with no part numbers
**What goes wrong:** plan assumes the dealer list confirms numbers; PRT-01 never fires.
**Avoid:** dealer list confirms price (and fitment to a Mazda KSA page), numbers need 2 hosts. Seeded `OEM_CHECKED` numbers already came from PartSouq + one other (catalog.js comments); expect proposals mostly for the known gaps (mazda3bm/bp, cx30, cx5gen3, cx50, cx60, cx70, cx80, cx90). PartSouq robots/ToS is unverified [ASSUMED]; if blocked, its data only arrives through citation snippets.

### Pitfall 3: Evidence without URLs breaks the gate in four places
See Pattern 5. Add a SQL test that submits a `users` evidence proposal through `autopilot_publish_run` and expects `inserted`, not `banned` or `error`.

### Pitfall 4: Cap hit wipes the whole month's findings
See Pattern 8. Add a unit test: below the floor, runners skip with no reserve call.

### Pitfall 5: `proposals_one_pending` and the new `target_key` shape
Key is `(kind, coalesce(car_model_id,''), target_key)`. `part` slot keys mean one pending OEM proposal per car:engine:part and one per ALT brand. A newer price supersedes the pending one (existing behaviour). For `car_model` with null `car_model_id` the index still works.

### Pitfall 6: Stale/hash semantics for new kinds
`apply_proposal` compares `md5(live::text)` with `base_hash`. `proposal_live` for `part` must return a stable key set (price as numeric rendered consistently: cast to `numeric(10,2)` in the jsonb build) or every apply reads as stale. `catalogue_parts.price` display `27` vs `27.00` mismatch is the classic failure; test apply right after submit.

### Pitfall 7: Approve of an indicative price must not be mistaken for dealer
`price_basis` is part of `after` and the hash. A dealer-list price later replacing an indicative one is a normal update, `basis` flips to `dealer`, label disappears (D-08).

### Pitfall 8: Seed baseline vs owner-edited server rows
`tools/seed-parts.js` must be `on conflict do nothing` so re-running never reverts approved values (same promise as seed-catalogue.sql). Seed rows get `price_basis 'dealer'` where `DEALER_PRICE` supplied the price, else `'static'` (not indicative-labelled, but not asserted as verified). Decide the label for `'static'` prices (Open Question 4).

### Pitfall 9: Picker index drift
`main.js` stores `CAR_MODELS` indices in `<option value>`. Appending preserves indices; sorting or inserting does not. Also `modelsForMarket` filters on `markets`; server rows need a non-empty `markets` or the model stays hidden everywhere (matches the "Empty = hidden everywhere" comment in catalog.js).

### Pitfall 10: Prompt injection / XSS
Forums are hostile text. Category enum + code-side counting limit the blast radius; admin and user cards use `textContent`/`html`. `no-raw-templates.test.js` guards raw interpolation.

### Pitfall 11: Search tool citations absent
If the model answers without citations (or the search errors with HTTP 200 + `web_search_tool_result_error`), the price stage yields nothing: treat as `skipped: no citations`, not a failure. Open item from Phase 3 (A4 `anthropic-version` header with web search) is still unverified; the Phase 4 smoke call should confirm it.

## Code Examples

### Citation extraction (pure; sibling of `extractSearchUrls`)
```js
// Source: pattern from autopilot/logic.mjs extractSearchUrls + web-search docs (citations on text blocks)
export function extractCitations(response, bannedHosts) {
  const out = [];
  for (const b of (response && response.content) || []) {
    if (!b || b.type !== 'text' || !Array.isArray(b.citations)) continue;
    for (const c of b.citations) {
      if (!c || typeof c.url !== 'string' || typeof c.cited_text !== 'string') continue;
      let u; try { u = new URL(c.url); } catch { continue; }
      if (u.protocol !== 'https:' || isBanned(u.hostname.toLowerCase(), bannedHosts)) continue;
      out.push({ url: c.url, host: u.hostname.toLowerCase(), quote: c.cited_text });
    }
  }
  return out;
}
```

### Mention counting (code, not LLM)
```js
export function countMentions(rows /* [{url, host, category, quote}] verified verbatim */) {
  const by = new Map();
  for (const r of rows) { const g = by.get(r.category) || { urls: new Set(), hosts: new Set(), rows: [] };
    g.urls.add(r.url); g.hosts.add(r.host); g.rows.push(r); by.set(r.category, g); }
  return [...by].map(([category, g]) => ({ category, mentions: g.urls.size, hosts: g.hosts.size, rows: g.rows }))
                .filter(x => x.mentions >= 3 && x.hosts >= 2);     // D-11
}
```

### Trim outliers (D-13)
```js
export function trimmedMedian(prices) {            // one price per user already
  const med = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const m0 = med(prices), kept = prices.filter(p => Math.abs(p - m0) <= 0.3 * m0);
  return { users: kept.length, median: kept.length ? med(kept) : null };   // propose only if users >= 3
}
```

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| Hard-coded `DEALER_PRICE` / `OEM_CHECKED` in catalog.js | Server `catalogue_parts` overlay, static as fallback | Updates without app release |
| Static `CAR_MODELS` only | Static + approved server models | New models without code deploy |
| Gate for schedules and recalls | Gate for 5 kinds | One review path |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Reddit robots.txt blocks `safeFetch`; Reddit usable via search snippets only | Pattern 6 | If snippets also unavailable, Reddit adds no mentions; D-11 still reachable via forums |
| A2 | Mazda owner forums (mazdas247, cx5mods, mazda3revolution) and PartSouq robots/ToS permit fetching | Pattern 6, Pitfall 2 | If blocked, only snippets; yield drops |
| A3 | `mazda.com.sa/ppl` is server-rendered HTML with prices parseable without a browser | Pattern 3 | If JS-rendered, no automated dealer prices; manual `DEALER_PRICE` stays the source |
| A4 | Cost per due car (~USD 0.2) and total Phase 4 add-on (~SAR 5-6/month) | Pattern 8 | Cap/soft floor may bind sooner; tune `optional_cars_per_run` |
| A5 | Registrable-host collapse via last-two-labels + small suffix list is enough | Pattern 4 | Two pages of one site might count as 2 sources |
| A6 | `cited_text` is <=150 chars and always present on search-grounded text blocks | Pattern 3 | Weak snippets, fewer verifiable prices |
| A7 | Model id formula `<model-slug>-<start-year>` is acceptable (no repo rule exists; owner edits) | Pattern 7 | Owner edits more ids |
| A8 | `anthropic-version: 2023-06-01` works with `web_search_20250305` (carried from Phase 3 A4, still unverified) | Pitfall 11 | Discovery calls 400 |
| A9 | Approving `car_model` writes `status='approved'` directly (the proposal is the draft) | Pattern 2 | If owner wants a visible draft row too, add a second state |

## Open Questions

1. **Is the dealer price page fetchable HTML?** Known: its prices were entered manually (`DEALER_PRICE`, 2026-11-07). Unclear: robots and rendering. Recommendation: Wave-0 smoke fetch through `safeFetch`; if it fails, price proposals use only indicative sources and the dealer values stay manual.
2. **Are `autopilot_config.gcc_domains` and a forum allowlist populated?** Phase 3 left them as an owner item. Without them the `models` stage and GCC-first searches do nothing. Recommendation: an early owner checkpoint task, and the run report must say "skipped: no GCC domains".
3. **Relax D-13 for `price_observations`?** It has no car or engine, so by D-13 it cannot qualify. Recommendation: exclude; revisit only if the owner accepts model-less price averages.
4. **Label for seeded `static` prices?** They are neither dealer-confirmed nor indicative. Recommendation: treat as unlabelled built-ins (current UI behaviour), label only `indicative`.
5. **Should alternatives be limited to parts that already have an OEM row?** Recommendation: yes; a `part` ALT proposal requires the part name to exist for the car.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node >=22 / `node --test` | all JS tests | yes (project standard) | 22 | — |
| Postgres for `supabase/tests/*.sql` | gate tests | CI only (Phase 3 verification: SQL tests run in CI, not locally) | — | static tests (`test/proposal-gate-static.test.js`, `rls-coverage`) locally |
| Anthropic API + web search enabled | parts/community/models search | unknown (Phase 3 A4 unverified) | — | stages record `skipped`, run stays valid |
| NHTSA complaints API | community | yes, live-checked 2026-11-08 | v1 | skip |
| `mazda.com.sa/ppl`, forums, PartSouq | sources | unverified | — | search snippets / manual catalog.js |

## Validation Architecture

(`workflow.nyquist_validation` is false in `.planning/config.json`; compact map kept for the planner.)

| Req | Behavior | Test |
|-----|----------|------|
| PRT-01 | part number needs 2 hosts or official; engine pinned; fitment clash rejected | `test/autopilot-parts.test.js` (`confirmParts`, fitment) |
| PRT-02 | snippet price only from `cited_text` containing SAR + number; label `indicative` | same + `test/remote-catalog-parts.test.js` |
| PRT-03 | 10% and 5 SAR both required; boundaries 9.99%/10%, 4.99/5 SAR | `isMaterial` unit + `proposals.sql` `immaterial` action |
| COM-01 | 3 mentions and 2 hosts, NHTSA counts as one host | `test/autopilot-community.test.js` |
| COM-02 | ALT slot via 2-source and via users | parts + SQL |
| COM-03 | 3 distinct users after trim; NULL-engine rule; no user ids in proposal | `supabase/tests/autopilot.sql` fixtures |
| NEW-01 | id parity with `catalogId`, GCC-only, approve exposes model in `modelsForMarket`, revert refused when in use | `test/autopilot-models.test.js`, `test/catalog-register.test.js`, `proposals.sql` |
| Gate | approve/stale/revert for each new kind; bulk refuses `car_model`; `users` evidence publishes | extend `proposals.sql`, `test/proposal-gate-static.test.js` |
| Budget/rotation | optional stages skip below floor; due ordering; failed job stays due | `test/edge-autopilot-flow.test.js`, `autopilot.sql` |
| Security | new tables RLS; public read, no write policy; admin UI renders `<script>` fixture as text | `test/rls-coverage.test.js`, `test/admin-proposals-render.test.js` |
| UI | precache, AR strings, Known issues card, in-progress note | `test/precache.test.js`, `test/parts-ar.test.js`, render tests |

Quick: `node --test test/autopilot-parts.test.js`. Full: `npm test` (+ CI SQL tests). Wave 0: new test files above, fixtures (NHTSA complaints JSON from the live shape, citation-bearing search response, forum HTML), seed parity test.

## Security Domain

| ASVS | Applies | Control |
|------|---------|---------|
| V2/V3 | existing | cron secret / admin JWT in `index.ts` (unchanged) |
| V4 Access control | yes | RLS on `catalogue_parts`, `known_issues`, `autopilot_due`; writes only via security definer fns; `autopilot_user_agreement` service_role only; `revoke ... from public, anon, authenticated` on every new worker fn |
| V5 Input validation | yes | SQL validation per kind in `submit_proposal` (lengths, enum slot regex, numeric ranges, `markets` whitelist); code-side quote/unit/mention gates; 8192 B `after` cap |
| V8 Data protection / privacy | yes | user ids never leave `autopilot_user_agreement`; only counts and median stored |
| V12/13 SSRF | yes | `safeFetch` for every URL; evidence host must equal fetched host (existing redirect check pattern) |

| Threat | STRIDE | Mitigation |
|--------|--------|------------|
| Sybil/fake user prices to push an alternative | Tampering | 3 distinct users, median +-30% trim, owner approval; one price per user |
| Prompt injection in forum/Reddit text | Tampering | enum categories, verbatim quote gate, code-side counts |
| Stored XSS via scraped brand/part/title in admin or Known issues | XSS | `textContent`/`html` only; https-only link builder |
| User deanonymisation via proposal evidence | Info disclosure | aggregate-only evidence type |
| Cost exhaustion | DoS | `paid()` reserve, soft budget floor, per-stage `max_uses`/`max_tokens`, rotation cap |
| Non-admin applying/rejecting | EoP | `is_admin()` inside apply/revert (unchanged); SQL tests |

## Project Constraints (from CLAUDE.md)

- Vanilla JS, no build step, no ES modules in the browser; must run from `file://`. Edge-function pure logic is `.mjs`, browser files are dual-mode IIFEs.
- Every HTML string through the `html` template (or `textContent`); `raw()` only when needed; enforced by `test/no-raw-templates.test.js`.
- User-visible strings wrapped in `t()`, Arabic in `src/i18n/strings.ar.js`, RTL-safe.
- RLS on every new table; autopilot writes only pending rows (via `submit_proposal`), never live tables.
- `safeFetch` for all external fetches; keep SSRF guards.
- New browser script => `index.html` order + `sw.js` `ASSETS` + bump `CACHE` (`npm run sw:version`); `test/precache.test.js` must stay green.
- Network/service functions never reject, they resolve `{ok:false,error}`.
- Style: `'use strict'`, 2-space indent, single quotes, semicolons, banner comment, comment the WHY, small pure functions separated from rendering.
- Tests: `node --test`; CI runs `node --check` on every shipped `.js`.
- GSD workflow: edits go through a GSD command (`/gsd-execute-phase`); AGENTS.md image rules irrelevant here (no images).

## Sources

### Primary (HIGH confidence, read in this session)
- `supabase/schema.sql` L638-809 (car_models, dealer_plan_items, recalls), L981-1360 (proposals, gate functions), L1377-1951 (autopilot tables, claim/publish, cron); contributions/pricing L100-470
- `supabase/functions/autopilot/{flow,extract,logic}.mjs`, `index.ts`
- `src/data/{remote-catalog,catalog,normalize,pricing,insights,recalls}.js`, `src/pages/admin-proposals.js`, `dashboard.js` (recall box), `main.js` picker
- `.planning/phases/03-.../03-RESEARCH.md`, `03-VERIFICATION.md`
- NHTSA `https://api.nhtsa.gov/complaints/complaintsByVehicle?make=mazda&model=cx-5&modelYear=2018` live fetch: count 124, field names above

### Secondary (MEDIUM)
- Phase 3 research citing platform.claude.com web-search-tool docs (citations `cited_text` limit, tool shape)
- techcrunch.com/2024/06/25/reddits-upcoming-changes-attempt-to-safeguard-the-platform-against-ai-crawlers (Reddit blocking unknown bots; robots text itself not read)

### Tertiary (LOW)
- Reddit robots.txt exact text, forum and PartSouq terms, dealer page rendering: not verified (tool blocked reddit.com; others not fetched)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (nothing new; all reused and read)
- Architecture: MEDIUM-HIGH (gate edit list verified line by line; schemas for new tables are design proposals)
- Pitfalls: HIGH for 1, 3, 4, 6, 9 (derived from code); MEDIUM for source-site rules

**Research date:** 2026-11-08
**Valid until:** 2026-12-08 (external API/tool behavior moves; repo facts hold until schema.sql changes)
