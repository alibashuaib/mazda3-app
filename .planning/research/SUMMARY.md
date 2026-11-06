# Project Research Summary

**Project:** Car Care — Autopilot Catalogue (Mazda, KSA)
**Domain:** Human-in-the-loop automated catalogue ingestion (web search + LLM extraction + admin approval) on Supabase, brownfield vanilla-JS PWA
**Researched:** 2026-11-05
**Confidence:** MEDIUM (design HIGH; external-source feasibility LOW for marketplaces and photos)

## Executive Summary

This is a monthly "propose, never publish" pipeline: discover sources → fetch → LLM-extract → diff against live data → write pending proposals → owner approves in `#admin`. The existing `plan-intake` function already does a single-kind version of this, so the right move is to extend it, not replace it: a generic `proposals` table, a Postgres job queue that fans out one job per (car × stage) so each Edge Function call stays small, a cost ledger with an atomic fail-closed cap, and one `apply_proposal()` SQL function as the only path to live tables. The approval gate is structural (RPC-only, grants), not a flag.

Recommended approach: Anthropic `web_search` server tool for discovery (one vendor, one bill); every persisted URL goes through the existing SSRF-hardened `fetchSource`, moved to a shared module; Haiku 5.5 extracts from fetched text; Sonnet 5.5 only for the search call, PDFs and conflict reconciliation; no new packages. Foundation fixes go first (owner decision, and real prerequisites: swallowed errors, `*` CORS, no RLS tests in CI and the `plan-intake` N+1 would each undermine autopilot).

Main risks, in order: hallucinated or mis-bound part numbers/intervals (mitigation: verbatim quote + substring grounding in code, rule-based confidence); wrong-market data (US/EU for KSA) and unit/currency errors (source tiers, `market` field, `{value, unit}` schemas converted in code); review fatigue from monthly noise (materiality thresholds, fingerprint dedupe, rejection memory); prompt injection and SSRF from search-discovered URLs; marketplace ToS/bot-blocking and photo licensing, which may force descoping to "link only" and "candidate only".

## Reconciled Decisions (where the four files disagreed)

| Conflict | Chosen | Why |
|---|---|---|
| pgmq (STACK) vs plain jobs table (ARCHITECTURE) | **Plain `autopilot_jobs` table**, `FOR UPDATE SKIP LOCKED`, lease, `depends_on` | Equivalent at ~80 jobs/month. Table gives stage dependencies, per-job cost and error text for the run log, plain-SQL tests, and avoids the unverified pgmq API. Revisit pgmq only at thousands of jobs. |
| Haiku vs Sonnet | **Sonnet 5.5** for the `web_search` call, PDF extraction and conflict reconciliation; **Haiku 5.5** for extraction over fetched text. Both env-configurable. | ~20× price gap. Safety does not depend on the model: quote-substring grounding and code validators apply to both. Escalate to Sonnet only if Haiku fails schema or grounding. |
| Search + structured output in one call | **Two calls**: (1) search, free text + citations; (2) Haiku `output_config.format` json_schema over fetched pages | Docs do not confirm server tools combine with structured output. |
| Fetch tool | **Own `fetchSource` in `_shared/fetch.ts` + robots.txt check**; Anthropic `web_fetch` only as a blocked-site fallback | Keeps SSRF audit trail and hash-change detection. |
| Photo publish | **Private `catalogue-candidates` bucket.** Approval records the candidate with its licence; shipping into app assets stays the manual `CAR-ASSET-GUIDE.md` step in v1. | Scraped photos cannot meet the guide (transparent edges, badges, framing). Storage-RLS auto-publish is a later spike. |
| Cost cap | **Both**: `AUTOPILOT_MAX_USD` (default 5) enforced by atomic `reserve_budget()` before each call, settled from `usage` after | STACK supplies the secret and price math, ARCHITECTURE the atomic SQL. |
| Marketplaces | **Descope**: prices only from search results/snippets and user observations, labelled "indicative". PartSouq stays a link. No scraping of noon/Amazon.sa. | ToS and bot-blocking unverified (LOW). |

## Key Findings

### Recommended Stack

Reuse everything existing: Supabase Edge Functions (Deno), `supabase-js@2`, raw `fetch` to Anthropic, the `logic.mjs` pure-function pattern, pg_cron + pg_net + Vault with the `x-cron-secret`/`safeEqual` check. Only additions are secrets: `AUTOPILOT_MAX_USD`, `AUTOPILOT_WORKER_SECRET`, `AUTOPILOT_MODEL`, `AUTOPILOT_EXTRACT_MODEL`.

**Core technologies:**
- **Anthropic `web_search_20250305`** (`max_uses` 3-5, `user_location` SA, `allowed_domains`): discovery. $10/1k searches. Citations feed the admin sources display. Handle `pause_turn`; replace `content[0].text` with `collectText`/`collectCitations` helpers.
- **Haiku 5.5 / Sonnet 5.5**: routed as above, prompt caching on the static system prompt and schema.
- **Structured outputs** (`output_config.format` json_schema, GA): replaces regex `parseSchedule` for new extractors. Still validate in code; reject rather than clamp out-of-band values.
- **pg_cron**: monthly enqueue (`0 3 1 * *`) plus a 1-minute worker tick guarded by `exists(queued/running jobs)`.
- **Wikimedia Commons API**: only photo source with machine-readable licences. Accept CC0/PD/CC BY/CC BY-SA; store author, licence URL, file page. Reject candidates under ~1200 px.
- **Not used:** Batch API, headless browser, Brave/Exa/Tavily, pgflow.
- **Cost:** ~$2-4 typical, ~$7 worst case per monthly run (list-price estimate). Cap at $5-10. Measure in the first dry run.

### Expected Features

**Must have (table stakes):**
- Generic `proposals` + `autopilot_runs` + fingerprint dedupe + supersede stale + rejection memory
- Admin queue v2: group/filter by model, kind, confidence, run; multi-source citations; before/after diff; reject reason; bulk approve (high confidence only by default); inline edit-then-approve (RPC `p_edit` already exists)
- Rule-based confidence (source tier, agreeing sources, change size, schema validity), never LLM self-score
- Hard cost cap, resumable per (car, stage) runs, run report and an "overdue" banner (the heartbeat, since there are no notifications)
- Schedules, OEM parts, indicative prices, `last_verified_at` staleness
- Change log extended to all kinds with a batch id; one-click item revert (writes a new audited row)
- Source registry: tiers, one-click domain ban, robots respected
- Community aggregation (≥3 distinct users, median, outlier trim) with rule-based trust
- Photo candidates: side-by-side review with a rules gate (size, aspect, alpha, mandatory licence, rejected-hash list)

**Should have (differentiators):**
- Risk-tiered triage (still owner-approved)
- Source-disagreement panel
- Severe/Jeddah interval as a structured field
- Dry-run "check now" with cost preview
- Deep links from the run report to the filtered queue
- New-model discovery as draft `car_models`

**Defer (v2+):** whole-run rollback, per-source learned reliability, price trend charts, failure-clustering tuning, cheaper-alternative fitment proof, multi-brand crawl, any auto-publish.

### Architecture Approach

Extend, do not replace. `pg_cron` → `autopilot-start` (creates run and jobs) → stateless `autopilot-worker` (claims ≤3 jobs, one bounded stage each, writes `proposals` and ledger) → admin reads `proposals` under RLS → `apply_proposal` RPC (security definer, `is_admin()`) writes live tables and a generic `change_log` → existing `plan_updated_at` bump lets `remote-catalog.js` refetch on devices. The worker touches only RPCs (`submit_proposal`, `claim_jobs`, `reserve_budget`, `record_cost`), so one SQL file owns the invariants. `plan_drafts` is NOT migrated first; it keeps working until a late cutover. Recalls stay on their own table with a thin admin adapter. Brand-agnostic: a `makers` table (domain allowlist and query templates in rows), no maker names in `logic.mjs` literals (unit-tested). Never rewrite existing `car_models.id` values.

**Major components:**
1. `proposals` — generic; `evidence` array with mandatory verified quote, `base_hash` optimistic lock, partial unique index on pending. The single review inbox.
2. `autopilot_runs/jobs/ledger/config` — orchestration state, lease/retry, cost, kill switch, per-job error text.
3. `autopilot-worker` + per-stage `logic.mjs` — stages: discover, fetch_extract, propose, prices, community, photos.
4. `apply_proposal` / `apply_proposals` (bulk, per-item exception block) / `revert_change`.
5. `_shared/fetch.ts` — single `safeFetch`: manual redirects, per-hop DNS check, byte/time caps, content-type allowlist, robots.
6. Admin kind-renderer registry in `src/pages/admin.js` — generic JSON-diff fallback, escaped `html` only.

### Critical Pitfalls

1. **Hallucinated or mis-bound part numbers/intervals** — every `part_no` and interval digit must appear (normalised) in the source text; require a verbatim `quote` that is a substring; single source = low confidence; parts need ≥2 sources or an official catalogue.
2. **Wrong market and units/currency** — source tiers (Mazda Saudi/GCC > global > US), `market` field, echo generation/engine and match in code, `{value, unit}` and `{amount, currency, includes_vat, qty_in_pack}` schemas converted in code, sanity bands reject instead of clamp.
3. **Prompt injection and SSRF via discovered URLs** — extractor has no tools and no writes; fetched text goes in the user turn as data; validate URLs in output; escaping `html` only; one shared `safeFetch` tested with redirect, IPv6 and decimal-IP cases.
4. **Review fatigue and flip-flop proposals** — materiality thresholds (price change <10% or <5 SAR suppressed), canonical `service_key`, fingerprint dedupe, rejection memory, hysteresis, per-run proposal cap. Target: first run reviewable in under 15 minutes.
5. **Cost blow-up and Edge timeouts** — ledger and atomic cap before every call, skip unchanged-hash sources, one Claude call per worker invocation, never loop all 16 cars in one invocation.
6. **Also:** marketplace ToS/blocking (detect block pages before any LLM call); photo licensing (licence mandatory, never auto-edit approved assets, never reapply Mazda2 175 / Mazda3 196).

## Implications for Roadmap

Suggested 8 phases. Foundation first per owner; the rest follow dependencies: schema → UI → worker → discovery → kinds → photos.

### Phase 1: Foundation hardening
**Rationale:** Owner decision and real prerequisite — autopilot adds server code and renders scraped content.
**Delivers:** save/afterSave and edge-function errors surfaced and recorded; CORS restricted to app origin; RLS SQL tests in CI; `plan-intake` N+1 batched; shared `safeFetch` extracted with SSRF/robots tests; SW install resilience, automatic cache version, stale-while-revalidate with bounded cache; photo version map; pinned vendored Supabase client; trimmed `AGENTS.md`.
**Avoids:** SSRF, swallowed errors, stale caches.

### Phase 2: Schema core and apply path (no LLM)
**Delivers:** `makers`, `proposals`, `change_log` + generic `log_change()` trigger; `autopilot_runs/jobs/ledger/config`; RPCs `submit_proposal`, `claim_jobs`, `reserve_budget`, `apply_proposal(s)`, `revert_change`; RLS + SQL tests; canonical `service_key`, `market`/unit fields, `catalogue_version` bump.
**Avoids:** flip-flop/duplicates, RLS gaps, unit errors — expensive to retrofit.

### Phase 3: Admin queue v2
**Rationale:** Prove the approval gate end to end with hand-seeded fake proposals before any scraping exists.
**Delivers:** kind-renderer registry, filters/grouping, confidence badge, multi-source evidence, bulk approve, reject reason, inline edit, run log, overdue banner, revert, injection-fixture tests, `no-raw-templates` coverage.
**Avoids:** review fatigue, XSS.

### Phase 4: Worker, orchestration and cost cap (schedule parity)
**Delivers:** `autopilot-start`, `autopilot-worker`, cron + pg_net + Vault, lease/retry/dead-letter, kill switch, atomic cap and ledger, existing schedule extraction ported to write `proposals` (parity with `plan-intake`), `collectText`/`collectCitations`, structured outputs, grounding check.
**Avoids:** timeouts, cost blow-up, hallucination.

### Phase 5: Automatic source discovery + schedule/recall review of all 16 cars
**Delivers:** web_search discovery into `schedule_sources` candidates with tiers, domain allowlist/ban, robots, market filter; generation/engine matching; severe/KSA interval field; dry run on a low cap; staleness via `last_verified_at`.
**Avoids:** wrong market, search spam, injection.

### Phase 6: New proposal kinds, one at a time
**Order:** OEM parts (`catalogue_parts`, substring-verified, ≥2 sources) → indicative prices (search results + user observations) → failures and cheaper alternatives → community aggregation (≥3 users, median) → new-model draft detection (secondary).
**Each kind needs:** parser, diff, renderer, apply branch, tests.
**Avoids:** hallucination, currency/VAT/pack errors, ToS, community abuse.

### Phase 7: Photo candidates
**Delivers:** Commons search, private candidate bucket, licence capture, rules gate, side-by-side review, rejected-hash list. Shipping into app assets stays manual per the asset guide.
**Avoids:** licensing and asset-guide violations. Last: highest risk, lowest data value.

### Phase 8: Cutover and first live month
**Delivers:** `plan-intake`/`plan_drafts` pointed at `proposals`; `decide_plan_draft` retired; dry-run month at a low cap; measured real cost and review time; monthly cron enabled.

### Phase Ordering Rationale
- Generic proposals table and constraints before any proposer; retrofitting per-type queues, bulk approve or dedupe is the expensive path.
- UI before scraping: proves the gate and gives the owner a review surface early.
- Orchestration and cost ledger before any new LLM call; discovery only after `safeFetch` and grounding exist.
- Photos last; may ship candidate-only.

### Research Flags
Needs `/gsd:plan-phase --research-phase`:
- **Phase 4:** `anthropic-version` header with `web_search_20250305` + `output_config`; pause_turn handling; Edge limits; cron + pg_net + Vault guard.
- **Phase 5:** web_search quality for KSA/Arabic queries; per-search cost; robots/ToS; injection hardening.
- **Phase 6 (prices):** PartSouq/Amazon.sa/noon terms and feasibility; likely descope to links and snippets.
- **Phase 7:** Commons licence fields; owner decision on press photos; Storage-RLS publish spike.

Standard patterns (skip research): Phases 1, 2, 3, 8; Phase 6 parts and failures once schema and grounding exist.

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Stack | MEDIUM-HIGH | Pricing, tool versions, limits from official docs fetched 2026-11-05. pgmq dropped. Commons licence fields and `anthropic-version` need a spike. |
| Features | MEDIUM | Grounded in existing code and well-known curation patterns; not verified online. |
| Architecture | MEDIUM-HIGH | Direct extension of the real schema and `plan-intake`; Storage-RLS photo publish untested. |
| Pitfalls | MEDIUM | Codebase points HIGH; marketplace ToS, PA-API and bot protection unverified. |

**Overall confidence:** MEDIUM

### Gaps to Address
- **`anthropic-version` header:** repo uses `2023-06-01`, new docs use `2026-10-21`. Spike first in Phase 4; check `read-bill`/`plan-intake` response shapes survive a bump.
- **Search + structured output in one call:** undocumented; two-call design avoids it.
- **Marketplace sources:** per-site robots/ToS check before Phase 6 prices; accept descoping.
- **Mazda press-photo legal status:** owner decision; default Commons-only.
- **Edge Function limits** (150/400 s wall, 2 s CPU): re-verify at start of Phase 4.
- **Redirect/DNS handling in `plan-intake/index.ts`:** audit during `safeFetch` extraction in Phase 1.
- **Locally generated service plans after a catalogue publish:** recompute next-due only, never rewrite history. Decide and test in Phase 2/8.
- **Cost numbers:** list-price estimates; measure in the Phase 5 dry run.

## Sources

### Primary (HIGH)
- Anthropic docs: web search tool, web fetch tool, structured outputs, pricing (fetched 2026-11-05)
- Supabase docs: Edge Function limits, scheduling functions (pg_cron + pg_net + Vault)
- Local code: `supabase/schema.sql`, `supabase/functions/plan-intake/{index.ts,logic.mjs}`, `src/pages/admin.js`, `src/data/admin.js`, `.planning/PROJECT.md`, `.planning/codebase/*`

### Secondary (MEDIUM)
- Supabase Queues (pgmq) docs (thin; not adopted)
- Moderation/curation-queue patterns (training knowledge)

### Tertiary (LOW)
- Community pgmq + Edge worker posts, Commons attribution notes, Brave pricing
- Marketplace ToS/bot-blocking assumptions (unverified)

Detail: `.planning/research/STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md`.

---
*Research completed: 2026-11-05*
*Ready for roadmap: yes*
