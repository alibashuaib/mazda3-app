# Phase 4: Parts, Prices, Community & New Models - Context

**Gathered:** 2026-11-08
**Status:** Ready for planning

<domain>
## Phase Boundary

The monthly autopilot run (built in Phase 3) also proposes OEM parts, indicative SAR prices, common failures, cheaper alternative parts, and new Mazda models/generations/engines. Every finding goes through the Phase 2 proposal gate. Approved values become visible to users. Requirements: PRT-01, PRT-02, PRT-03, COM-01, COM-02, COM-03, NEW-01. Photos (PHO-01/02) stay v2.

</domain>

<decisions>
## Implementation Decisions

### Where approved parts live (PRT-01, PRT-02)
- **D-01:** Approved parts and prices are stored in a new server table (working name `catalogue_parts`). It has RLS: users can read it, and only `apply_proposal` writes to it. The app fetches and caches it the same way `src/data/remote-catalog.js` handles dealer plans, then overlays it on the static `sharedParts` / `DEALER_PRICE` in `src/data/catalog.js`.
- **D-02:** If an approved server value and catalog.js disagree, the server value wins. catalog.js stays the offline/built-in fallback. Owner edits on a saved car are kept (the existing `catPrice` refresh rule in `src/data/normalize.js`).
- **D-03:** `apply_proposal`, `apply_proposals`, `revert_change` and `proposal_live` gain the new kinds (today they accept only `schedule_item` and `recall`). Approve and revert must behave exactly like schedules: stale refusal, change_log entry, one-click revert.
- **D-04:** Fitment is pinned per `car_model` id (`<modelId>:<engine-slug>`, from `catalogId()`). One proposal per car + engine + part slot. A part checked on one engine must never apply to another (the same bug the engine prefix in `OEM_CHECKED` already guards against).
- **D-05:** Only the Mazda KSA dealer price list (mazda.com.sa/ppl) counts as an "official catalogue" for PRT-01. Any other source (PartSouq, US Mazda parts dealers, forums) needs 2+ independent sources agreeing on the part number and fitment.

### Price sources & threshold (PRT-02, PRT-03)
- **D-06:** Allowed price sources:
  1. The Mazda KSA dealer list.
  2. Web search snippets (prices seen in search results, with no fetch of marketplaces whose terms forbid it; noon and Amazon.sa stay snippet-only).
  3. App users' price reports (`price_observations`, part `contributions`), subject to D-13.
  4. Shop pages whose terms and robots allow fetching, through `safeFetch`.
- **D-07:** Materiality threshold: a price change is proposed only when it is **both** ≥10% **and** ≥5 SAR versus the live value. Smaller changes are dropped before the queue.
- **D-08:** The "indicative" label (EN + AR) shows only on non-dealer prices, both in the user parts list and in the admin diff. Dealer-list prices show without it.
- **D-09:** Price shape stays as it is in catalog.js today: one OEM option and cheaper alternative options, each with its own SAR price. No price ranges.

### Community failures & alternatives (COM-01, COM-02, COM-03)
- **D-10:** Community sources: Reddit (r/mazda, model subreddits), Mazda owner forums (e.g. mazdas247, cx5mods, mazda3revolution), Arabic/GCC car forums, and NHTSA complaints (separate from the existing recalls path). New domains still need owner approval (Phase 3 D-07).
- **D-11:** A common failure is proposed only with 3+ distinct mentions across 2+ different domains. The mention count and source links show in the diff.
- **D-12:** Users see approved failures in a "Known issues" card on the car page, near recalls. Each entry shows the failure, typical km if known, the mention count and source links.
- **D-13:** COM-03 agreement means 3+ distinct `user_id`s on the same `car_model` (model:engine) and part key. Prices outside the median ±30% are dropped before counting, and the proposed value is the median of the rest.
- **D-14:** Cheaper alternatives (COM-02) come from forums and from user submissions. User-sourced alternatives follow the D-13 rule. Forum-sourced alternatives follow the D-05 2-source rule.

### New models (NEW-01)
- **D-15:** New models/generations/engines are detected from Mazda KSA/GCC sites first, using the Phase 3 D-06 GCC-first rule. A model not sold in Saudi/GCC is not proposed.
- **D-16:** A proposal includes identity plus basics: model, generation, years, engines, oil capacity, warranty and sources. Paints and photos stay manual (photos are v2; the owner makes them with Codex).
- **D-17:** The id is generated in code with the same rule as `catalogId()` in catalog.js. The owner can edit it before approving.
- **D-18:** Once approved, the model appears in the app picker. The app merges approved server `car_models` into the static `CAR_MODELS` list. Until schedule and parts are approved, the car shows a "catalogue in progress" note (EN + AR), and later monthly runs fill it in.

### Cost (ENG-03 carried forward)
- **D-19:** Keep the SAR 40 hard monthly cap from Phase 3. Every month, schedules and recalls run for every car. Parts, prices and community stages rotate across cars that are due (for example, each car every 2–3 months), so the whole run fits the cap. Model detection runs once per month and is not per car.

### Claude's Discretion
- Table name and schema for approved parts, failures and alternatives (one table or several), plus the new proposal `kind` values.
- Exact rotation rule for D-19 and where "due" is tracked (e.g. `autopilot_item_status`).
- How snippet prices are extracted and quoted, which must still meet the verbatim-quote rule (Phase 3 D-12 / ENG-07).
- Where the Known issues card sits in `src/pages/dashboard.js` or the parts/maintenance pages.
- Outlier trimming implementation (D-13 defines the rule, not the code).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project and requirements
- `.planning/PROJECT.md` — core value: nothing published without approval
- `.planning/REQUIREMENTS.md` — PRT-01..03, COM-01..03, NEW-01; Out of Scope table (no scraping noon/Amazon.sa, no headless browser, no LLM self-scored confidence)
- `.planning/ROADMAP.md` §Phase 4 — 4 success criteria
- `CLAUDE.md` — vanilla JS, no build, `html` template escaping, RLS on every table, `safeFetch` for all fetches, sw.js precache rules

### Approval gate (Phase 2)
- `supabase/schema.sql` — `proposals`, `submit_proposal`, `apply_proposal`, `apply_proposals`, `reject_proposal`, `revert_change`, `proposal_live`, `change_log`, `car_models` (has `status draft|approved`)
- `.planning/phases/02-proposal-gate-review-queue/02-CONTEXT.md` — gate decisions (stale refusal, suppression, supersede, bulk approve high only)
- `src/pages/admin-proposals.js` — review queue UI that must render the new kinds

### Autopilot engine (Phase 3)
- `.planning/phases/03-monthly-autopilot-for-schedules-recalls/03-CONTEXT.md` — cost cap, GCC-first, domain approval, verbatim quotes, retries, kill switch
- `.planning/phases/03-monthly-autopilot-for-schedules-recalls/03-VERIFICATION.md` — open runtime items (A4 header unverified, SQL tests only in CI)
- `supabase/functions/autopilot/flow.mjs`, `logic.mjs`, `extract.mjs`, `index.ts` — stage runners, `stageFindings`, cost metering
- `supabase/functions/_shared/safe-fetch.mjs`, `supabase/functions/_shared/net-guard.mjs` — SSRF guard
- `supabase/schema.sql` — `autopilot_config`, `autopilot_runs`, `autopilot_jobs`, `autopilot_spend`, `autopilot_findings` (kind check today: `schedule_item`, `recall`), `source_domains`, `autopilot_item_status`

### Existing catalogue and community data
- `src/data/catalog.js` — `CAR_MODELS`, `sharedParts`, `DEALER_PRICE` (L406), `OEM_CHECKED`, `catalogId()` (L644)
- `src/data/normalize.js` — saved-car price refresh (`catPrice`), keeps owner edits
- `src/data/remote-catalog.js` — fetch + cache pattern to copy for approved parts and models
- `src/data/pricing.js`, `src/data/insights.js` — `price_items`, `price_observations`, `contributions` (user price/part data for D-13)
- `src/data/recalls.js` — recall display next to the Known issues card
- `src/i18n/strings.ar.js`, `test/parts-ar.test.js` — Arabic coverage for new labels

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `remote-catalog.js` fetch/cache/meta pattern: reuse it for approved parts and approved car_models.
- `proposals` + `submit_proposal` (dedupe, suppression, supersede) and rule-based confidence: new kinds plug in here.
- Phase 3 stage runner (`flow.mjs`, `stageFindings`) and the cost ledger: add parts/price/community/model stages.
- `catalogId()`: the id rule for new models (D-17).
- `contributions` / `price_observations` tables: the source for COM-03 agreement.

### Established Patterns
- Autopilot writes only `proposals`. Only admin `apply_proposal` writes live tables.
- Network functions never reject; they resolve `{ ok:false, error }`.
- Dual-mode `src/data/*` modules; pure logic in `.mjs` for edge functions, tested with `node --test`.
- Every new script goes in `index.html` + `sw.js` ASSETS (`npm run sw:version`).

### Integration Points
- `apply_proposal` / `proposal_live` / `revert_change`: add the new kinds.
- `autopilot_findings.kind` check constraint: extend it.
- App boot: merge approved server parts and models over the catalog.js statics.
- Car page / dashboard: the Known issues card.
- Admin Proposals tab: diff rendering for parts, prices (indicative), failures and models.

</code_context>

<specifics>
## Specific Ideas

- The Mazda KSA dealer list (mazda.com.sa/ppl) already feeds `DEALER_PRICE`. It is the one official parts source.
- Known catalogue gaps (from a 2026-11-07 audit) are good first targets: missing OEM numbers for mazda3bm/bp, cx30, cx5gen3, cx50, cx60, cx70, cx80, cx90; belt pricing for CX-30, CX-90, CX-5 KE/KF; CX-9 TB 3.5L plug/belt fitment.
- Reddit and forum terms of use need checking in research. Use search snippets where fetching is not allowed.

</specifics>

<deferred>
## Deferred Ideas

- Licensed car photos (PHO-01/02): already v2.
- Price ranges instead of single prices: rejected for now (D-09).

</deferred>

---

*Phase: 04-parts-prices-community-new-models*
*Context gathered: 2026-11-08*
