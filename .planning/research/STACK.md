# Technology Stack: Autopilot Catalogue Pipeline

**Project:** Car Care autopilot catalogue (Mazda, KSA)
**Researched:** 2026-11-05
**Scope:** only what is NEW for the monthly pipeline. Existing app stack: see `.planning/codebase/STACK.md`.

## Headline Decisions

1. **Discovery = Anthropic `web_search` server tool**, not Brave/Exa/Tavily/SerpAPI. One vendor, one key, one bill, one cost ledger (`usage.server_tool_use.web_search_requests`). $10/1k searches is ~$1-3 per monthly run. Add no new secret.
2. **Fetching = keep the existing `fetchSource` (SSRF guards, hash check)** for every URL we persist. Do NOT adopt Anthropic `web_fetch` as the primary fetcher (see below).
3. **Extraction = Messages API with `output_config.format` json_schema** (GA, no beta header). Replaces regex-ish `parseSchedule` for new extractors; keep validation in `logic.mjs` anyway.
4. **Models: Haiku 5.5 for extraction, Sonnet 5.5 only for search/synthesis.** Both are already used in the repo.
5. **Long jobs = pg_cron (every minute) -> pg_net -> `autopilot-worker` function that pops ONE message from a pgmq queue**, one (car, stage) per invocation. Supabase Queues = pgmq.
6. **Photos = Wikimedia Commons API (CC-licensed, with author/license recorded) into a private staging path; never hotlink, never auto-publish.** Manufacturer/marketplace photos are LOW-confidence legally; propose as "link only".
7. **Cost cap = DB ledger checked before every Anthropic call**, fail closed.
8. No SDKs, no new npm/JSR packages required. Keep raw `fetch` (matches `plan-intake`, `read-bill`).

## Recommended Stack

### Core (already in repo, reuse)
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Supabase Edge Functions (Deno) | platform | Worker + orchestrator functions | Existing; limits below drive the design |
| `npm:@supabase/supabase-js@2` | 2.x (as in plan-intake) | DB access with service role | Existing import |
| Anthropic Messages API, raw `fetch` | header `anthropic-version` (see Gap 1) | Search, extraction | Existing pattern; no SDK to vet in Deno |
| `logic.mjs` pattern | n/a | Pure functions (prompts, validators, diff, cost math) testable in `node --test` | Existing convention; keep all new logic here, not in `index.ts` |

### LLM / Search
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Anthropic web search tool | `web_search_20250305` (basic) | Find dealer schedule pages, forum threads, PartSouq/noon/Amazon.sa listings per model | $10/1k searches + normal tokens; supports `max_uses`, `allowed_domains` OR `blocked_domains` (not both), `user_location` (country `SA`); citations always returned (urls + titles feed the admin "sources" display). Available on Haiku 5.5, Sonnet 5.5. | HIGH (official docs) |
| (alternative version) | `web_search_20260209` / `20260318` | Dynamic filtering: Claude runs code to trim results before context | Cuts tokens on search-heavy calls but needs code-execution backing, not ZDR-eligible, extra moving part. Start with `20250305` + `allowed_callers` irrelevant; try `20260318` with `response_inclusion:"excluded"` only if token cost measured too high. | MEDIUM |
| Claude Haiku 5.5 (`claude-haiku-5-5`) | $0.10 in / $0.50 out per MTok (<=100k prompt); cache hit $0.01 | Per-page extraction into schema (parts, prices, failures) | ~20x cheaper than Sonnet; extraction from supplied text does not need Sonnet. | HIGH (pricing page) |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | $2 in / $10 out per MTok; cache hit $0.10 | Search-driven discovery call, PDF schedule extraction, conflict reconciliation | Already `INTAKE_MODEL` default. | HIGH |
| Structured outputs | `output_config.format = {type:"json_schema", schema}` | Guaranteed-shape JSON | GA, no beta header. Old `output_format` param deprecated (needs beta header) - do not use. Limits: `additionalProperties:false` required, no `minimum/maxLength`, `minItems` only 0/1, no recursion. Handle `stop_reason` `refusal`/`max_tokens` (output may not match). First call per new schema is slower. | HIGH |
| Prompt caching | `cache_control` on the static system prompt + schema | Same system prompt across 16 cars x N pages | Cache reads 0.1x (0.05x Sonnet 5.5). Cheap win. | HIGH |
| Messages Batch API | 50% discount | NOT recommended now | 16 cars is small; batch adds async polling state; web search is throttled in batches. Revisit when more brands arrive (100+ cars). | HIGH |

### Page fetching / extraction
| Technology | Purpose | Why |
|------------|---------|-----|
| Existing `fetchSource` + `isSafeUrl` + `resolvesPublic` + `htmlToText` (`plan-intake/logic.mjs`) | Fetch every URL we cite, store `content_hash`, feed text to Haiku | Already SSRF-hardened, handles PDF (base64 `document` block), 8 MB cap, one re-checked redirect. **Extract into a shared module** (`supabase/functions/_shared/fetch.ts`) so `plan-intake` and the worker share it. Add robots.txt check (Deno `fetch` of `/robots.txt`, simple Disallow parser) because PROJECT.md requires respecting robots. |
| Cap extracted text (e.g. 30k chars) and strip nav/script/style | Token control | `htmlToText` exists; add the cap. |
| Anthropic `web_fetch` tool (`web_fetch_20250910`, no extra charge, tokens only) | Optional fallback only | Cannot render JS pages; URL must already appear in context; its own robots/private-address blocking is a plus but we lose hash-change detection and our SSRF audit trail. Use only if own fetch is blocked by a site's bot protection. |
| Headless browser / Firecrawl / Browserless | NOT used | JS-rendered marketplaces (noon, Amazon.sa) are the tempting reason; see Pitfalls below. 2s CPU limit makes any in-function DOM work painful. Add a paid scraper only after proving value, as a separate decision. |

### Queue / scheduling
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| pgmq (Supabase Queues) | extension `pgmq` | Durable job queue: message = `{run_id, car_model_id, stage}` | Visibility timeout gives free retry after a crash/timeout; archive gives audit. Built into Supabase (docs: "Queues built on pgmq"). 16 cars x ~5 stages = ~80 messages/month. | MEDIUM (docs thin on API details; verify `pgmq.read(queue, vt, qty)` signature in pgmq repo at build time) |
| pg_cron | existing | Monthly enqueue job (`0 3 1 * *`) + 1-minute drain tick | Already used for `plan-intake`. |
| pg_net + Vault | existing pattern from Supabase docs | cron calls `/functions/v1/autopilot-worker` | Store function URL and the worker secret in Vault; follow existing `x-cron-secret` header check (`safeEqual`). Caveat from docs: any login-capable role can read the key while the request is queued in `net.http_request_queue`; acceptable for a single-owner project. |
| Plain table alternative | `autopilot_jobs` with `FOR UPDATE SKIP LOCKED` | Fallback | Equivalent at this scale and easier to unit-test in SQL tests. If the team dislikes pgmq's API surface, pick this; do not build both. |
| `pgflow` edge-worker | NOT used | Labeled proof-of-concept (v0.0.4), adds dependency |

**Platform limits that shape this (official, HIGH):** wall clock 150 s Free / 400 s paid; CPU 2 s active per request (async I/O waiting is free); 256 MB memory; request idle timeout 150 s (504 if no response); bundle 20 MB. Consequence: one worker invocation = one message = one Claude call (+ at most a few fetches), target < 100 s. Respond 200 immediately and finish with `EdgeRuntime.waitUntil(...)` only if a stage can exceed the idle timeout; otherwise just await. Never loop over all 16 cars in one invocation (the current `plan-intake` does; this is the main thing to refactor).

Worker loop: `read(queue, vt=180s, qty=1)` -> check cost ledger -> do stage -> write drafts -> `delete`/`archive`. On failure do nothing (message reappears); after N `read_ct` move to a dead-letter archive and mark run `partial` (no drafts published anyway; approval gate holds).

### Image sourcing (car photos)
| Source | Use | Licensing | Confidence |
|--------|-----|-----------|------------|
| Wikimedia Commons (MediaWiki API `commons.wikimedia.org/w/api.php`, `action=query&generator=search&prop=imageinfo&iiprop=url|extmetadata`) | Primary candidate source per model/generation | Mixed: CC BY, CC BY-SA, CC0, public domain. Read `extmetadata` (`LicenseShortName`, `Artist`, `AttributionRequired`, `Credit`). Accept only CC0/PD/CC BY/CC BY-SA; store author + license URL + file page URL in the draft; show attribution in-app. CC BY-SA derivatives (recolour/cutout) must stay BY-SA. Commons license metadata is not guaranteed accurate - admin checks the file page. | MEDIUM (official API exists; license field names from MediaWiki docs/general knowledge, verify on first call) |
| Mazda press/media sites | Link-only reference | Terms usually limit use; do not copy into Storage automatically | LOW |
| Marketplace/forum photos | Never ingest | Third-party copyright | HIGH (avoid) |
| AI-generated images | Not recommended | Conflicts with the project's strict approval history | MEDIUM |

Pipeline for photos: search Commons -> download to a private `photo-candidates` path in Storage (service role, not public) -> draft row with `{url, license, author, source_page, width, height}` -> admin approves. Approved photos still pass the manual process in `docs/CAR-ASSET-GUIDE.md` / `output/CAR-ASSET-LESSONS.md` (transparent cutout, paint identity, both wheel badges, consistent framing). Autopilot cannot do that editing; scope it as "propose candidate + metadata", not "produce final asset". Never reapply rejected edits (Mazda2 175, Mazda3 196). Reject low-res (< ~1200 px wide) candidates automatically with a plain size check; no vision model needed.

### Cost control
| Mechanism | Detail |
|-----------|--------|
| `autopilot_runs` ledger table | Columns: run_id, stage, model, input_tokens, output_tokens, cache_read, searches, usd_estimate. Insert after each call from `usage` (incl. `server_tool_use.web_search_requests`). Price table lives in `logic.mjs` as constants. |
| Hard cap | `AUTOPILOT_MAX_USD` secret (default 5). Worker sums ledger before each call; over cap -> stop, mark run `capped`, leave queue messages unread. Fail closed. |
| Per-call limits | `max_uses` on web_search (3-5), `max_tokens` explicit, text cap on fetched pages, `max_content_tokens` if using web_fetch. |
| Skip unchanged work | Reuse `content_hash` logic: no LLM call when a source hash matches. |
| Model routing | Sonnet only for the search call; Haiku for everything on already-fetched text. |
| Rough monthly estimate | Per car: ~4 search calls (schedule, OEM parts, community, prices) at ~$0.04 search + ~$0.06 tokens on Sonnet = ~$0.40 worst case, plus ~5 Haiku extractions ~$0.01 each = ~$0.45/car -> **~$7 worst case for 16 cars**, likely $2-4 with hash skips and caching. Cap at $5-10. (My estimate from list prices; measure in first run.) |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Search | Anthropic web_search | Brave Search API | Cheaper per query (about $3-5/1k per conflicting sources; free tier status unclear - official page vs. third parties disagree) but adds a key, a separate result->LLM step, and a second cost ledger. Reconsider only if Anthropic search quality for Arabic/KSA queries is poor in a spike. |
| Search | Anthropic web_search | Exa / Tavily / SerpAPI | Extra vendor, extra bill, no benefit at ~100 searches/month. SerpAPI/scraping Google violates Google terms. |
| Extraction | json_schema structured outputs | Tool use with `strict: true` | Also valid and may be needed if combined with server tools in one turn; but structured outputs is the simpler single-purpose path. Both can coexist. |
| Extraction | raw JSON via prompt + `parseSchedule` (current) | keep | Works but brittle; migrate new extractors to schema, leave existing schedule path until touched. |
| Queue | pgmq | Edge Function self-invocation chaining | Fragile, loses work on crash, harder to audit. |
| Queue | pgmq | External (Inngest, Trigger.dev, QStash) | New vendor/secret for 80 jobs a month. |
| Fetch | own fetch | Firecrawl / Browserless | Cost and ToS surface; only if JS-only sources prove essential. |
| Batch | on-demand calls | Batch API 50% off | Complexity not worth saving cents at this volume. |
| Images | Commons | Google Images / Bing image scraping | Licensing unknown; ToS violations. |

## Installation

```bash
# No npm/JSR packages. Secrets only:
supabase secrets set AUTOPILOT_MAX_USD=5 AUTOPILOT_WORKER_SECRET=<random> AUTOPILOT_MODEL=claude-sonnet-5-5 AUTOPILOT_EXTRACT_MODEL=claude-haiku-5-5
# (ANTHROPIC_API_KEY already set)
# SQL migration: create extension if not exists pgmq; select pgmq.create('autopilot');
# Vault: store function URL + worker secret; cron.schedule monthly enqueue + 1-min drain
```

## Gaps / Needs Validation Before Build

1. **`anthropic-version` header.** Current docs examples use `2026-10-21`; repo uses `2023-06-01`. The server-tool and `output_config` examples are shown with the new version. Spike: confirm `web_search_20250305` and `output_config.format` work with `2023-06-01`; if not, bump the header (check it does not break `read-bill`/`plan-intake` response shapes). MEDIUM.
2. **Response handling for web_search.** Responses contain `server_tool_use`, `web_search_tool_result`, and `text` blocks with `citations`; `stop_reason: "pause_turn"` must be handled by re-sending the paused assistant message. Current code reads `content[0].text` - that breaks. Write a `collectText(content)` and `collectCitations(content)` helper in `logic.mjs`, tested with a fixture. HIGH (docs).
3. **Search + structured output in one call.** Docs do not state whether `output_config.format` combines with server tools; citations and strict JSON may conflict. Safe design: call 1 = search (free text + citations), call 2 = Haiku structured extraction over fetched pages. Costs slightly more, avoids the unknown. LOW-MEDIUM.
4. **Marketplace sources (PartSouq, Amazon.sa, noon).** Terms of service generally prohibit automated scraping and the sites are JS-heavy/bot-protected; I did not verify each site's robots/terms. Recommendation: take prices only from what web_search returns (titles/snippets/cited text, up to 150 chars) or from user price observations, label them "indicative", and keep PartSouq as a link. Needs a per-site legal/robots check in the phase. LOW.
5. **pgmq call signatures** and Supabase Queues exposure via Data API (Queues are not exposed to clients by default - confirm the worker uses service role + `pgmq` schema functions). MEDIUM.
6. **Brave free tier** conflicting info (2,000 free/month vs $5 credit/month); irrelevant unless we switch.

## Sources

- Anthropic web search tool (versions, $10/1k, max_uses, domain filters, pause_turn, batch): https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool (HIGH, fetched 2026-11-05)
- Anthropic web fetch tool (no JS rendering, no extra charge, URL-in-context rule): https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool (HIGH)
- Structured outputs (GA, `output_config.format`, schema limits): https://platform.claude.com/docs/en/build-with-claude/structured-outputs (HIGH)
- Model pricing (Haiku 5.5, Sonnet 5.5, cache, batch): https://platform.claude.com/docs/en/about-claude/pricing (HIGH)
- Supabase Edge Function limits: https://supabase.com/docs/guides/functions/limits (HIGH)
- Supabase Queues (pgmq): https://supabase.com/docs/guides/queues (MEDIUM, thin)
- Supabase scheduling functions (pg_cron + pg_net + Vault): https://supabase.com/docs/guides/functions/schedule-functions (HIGH)
- pgmq + Edge Function worker patterns (community): https://dev.to/suciptoid/build-queue-worker-using-supabase-cron-queue-and-edge-function-19di , https://docs.dbos.dev/integrations/supabase-edge-functions (LOW-MEDIUM)
- Commons attribution/licensing notes (secondary): https://packagist.org/packages/gbv/image-attribution (LOW)
- Brave pricing (conflicting): https://api-docs.search.brave.software/pricing (LOW)
