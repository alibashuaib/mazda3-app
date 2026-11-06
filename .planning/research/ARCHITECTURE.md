# Architecture Patterns

**Domain:** Monthly catalogue autopilot (discover -> fetch -> extract -> diff -> propose -> approve -> publish) on Supabase
**Researched:** 2026-11-05
**Overall confidence:** MEDIUM-HIGH. Design is grounded in the real schema and `plan-intake` code (HIGH). Edge Function platform limits and Anthropic web-search billing are from memory and must be re-verified before the orchestration phase (MEDIUM/LOW).

## Recommendation in one paragraph

Extend, do not replace. Add ONE generic `proposals` table (every autopilot finding, any kind) plus a small job queue (`autopilot_runs`, `autopilot_jobs`, `autopilot_ledger`) in Postgres. A monthly `pg_cron` job creates a run and fans out one job per (car x stage). A short-interval cron tick calls a stateless `autopilot-worker` edge function that claims a few jobs with `FOR UPDATE SKIP LOCKED`, does one bounded unit of work each, and exits. All publishing goes through one `security definer` SQL function `apply_proposal()` that dispatches per kind, writes the live table inside one transaction, and logs a before/after row in a generic change log (which is also the rollback source). The autopilot's DB role/keys can never write live tables (enforced by grants, not only by code).

## Component Boundaries

```
 pg_cron (monthly)           pg_cron (every 1-2 min while a run is open)
      |                                   |
      v pg_net                            v pg_net
 autopilot-start  ---creates--->  autopilot_runs + autopilot_jobs (queue)
                                          ^   | claim (SKIP LOCKED, lease)
                                          |   v
                                   autopilot-worker  (stateless, one job type per call)
                                    |  stages: discover | fetch_extract | propose | prices | community | photos
                                    |  uses: logic.mjs (pure, Node-testable), safeFetch (SSRF), llm() (ledger-metered)
                                    v
        proposals (pending)   autopilot_ledger (cost)   private Storage bucket (photo candidates, snapshots)
                                    |
                                    v   admin reads (RLS is_admin)
                          src/pages/admin.js  (kind-renderer registry, escaped html``)
                                    |  rpc
                                    v
                       apply_proposal(id|ids, approve, edit)   [security definer, is_admin()]
                                    |  one transaction per proposal
                                    v
              live tables (car_models, dealer_plan_items, catalogue_parts, ...) + change_log
                                    |
                                    v   existing path, unchanged
                  remote-catalog.js (anon reads, plan_updated_at version) -> devices
```

| Component | Responsibility | Talks to |
|-----------|---------------|----------|
| `autopilot-start` (edge fn, tiny) | Create run row, snapshot config (cap, cars), enqueue jobs | Postgres only |
| `autopilot-worker` (edge fn) | Claim N jobs, run one stage each, write proposals + ledger, mark job done/failed | Postgres, Anthropic, web search, source sites, Storage |
| `logic.mjs` per stage | Pure functions: prompts, parsers, `diff*`, evidence check, budget math. All unit-tested in Node | none (pure) |
| `proposals` | Single review inbox for every kind; carries before/after/evidence/status | admin UI, `apply_proposal` |
| `autopilot_runs/jobs/ledger` | Orchestration state, cost, audit of what the run did | worker, admin Run-log view |
| `apply_proposal()` | Only path from draft to live; validates per kind; logs; marks proposal | live tables, `change_log` |
| `change_log` + `revert_change()` | Generic audit + rollback | admin UI |
| Admin page | Queue by kind, diff + evidence view, bulk approve, run log, cost, revert | `proposals`, RPCs |
| `plan-intake` (existing) | Keep as the legacy entry for admin "check now" until cut over; later becomes a thin caller of the same stage code | same |

Boundary rules:
- The worker uses the service-role key (as `plan-intake` does today) but SQL grants a dedicated path: `revoke insert, update, delete` on live tables from any autopilot-specific role is not possible with the service role (it bypasses RLS). So the guarantee is structural: worker code imports no live-table writer, and a CI test greps `autopilot-*` sources for `.from('<live table>')` writes. Better, optional hardening: run the worker with a custom Postgres role via a SECURITY DEFINER `autopilot_*` RPC set (`enqueue`, `claim_jobs`, `submit_proposal`, `record_cost`) and never touch tables directly. Recommended: RPC-only for proposals/ledger so one SQL file owns the invariants (HIGH value, low cost).
- `apply_proposal` is the ONLY function that writes live tables on behalf of proposals. Existing `decide_plan_draft` is superseded by it (keep until `plan_drafts` rows are drained).

## Generic proposals table vs per-type draft tables

**Decision: one generic `proposals` table. Keep `recalls` as is (it already has a pending/approved status and is publicly readable when approved).**

Why: 7+ kinds (schedule item, car model, part, price, failure/alternative, photo, community aggregate) would otherwise mean 7 tables, 7 admin renderers, 7 decide functions, 7 RLS sets. The queue UI (list, filter, bulk approve, diff, evidence) is identical across kinds; only the diff renderer and apply handler differ.

```sql
create table public.proposals (
  id bigint generated always as identity primary key,
  run_id bigint references autopilot_runs on delete set null,
  kind text not null,                 -- 'schedule_item' | 'car_model' | 'part' | 'price' | 'failure' | 'photo' | 'community'
  maker text not null default 'Mazda',
  car_model_id text references car_models on delete cascade,   -- nullable (new models have none yet)
  target_key text not null,           -- natural key within kind, e.g. service name / part_no / colour slug
  op text not null check (op in ('insert','update','delete')),
  before jsonb,                       -- live row snapshot at proposal time (null for insert)
  base_hash text,                     -- hash of `before`; apply refuses if live row changed (optimistic lock)
  after jsonb not null,               -- proposed row, validated shape per kind
  evidence jsonb not null,            -- [{url, fetched_at, content_hash, quote}] ; >=1 required
  confidence numeric, reason text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected','superseded','stale')),
  created_at timestamptz not null default now(), decided_by uuid, decided_at timestamptz,
  edited_after jsonb                  -- what admin actually published if they edited
);
create unique index proposals_one_pending on proposals (kind, coalesce(car_model_id,''), target_key) where status='pending';
```

- Dedupe: the partial unique index replaces the current delete-then-insert N+1 in `plan-intake` (use `insert ... on conflict (...) where status='pending' do update`, bulk, one round trip). Re-proposing the same finding next month supersedes instead of piling up. Rejected proposals: store a rejection fingerprint (hash of `after`) so the same rejected value is not re-proposed monthly (add `rejected_hash` check in the diff stage), otherwise the owner re-rejects the same thing every month.
- Shape validation: `jsonb` is untyped, so each kind has (a) a JS parser in `logic.mjs` at submit time and (b) a SQL CHECK-like validation inside `apply_proposal` (clamp ints like `decide_plan_draft` already does). Untrusted LLM output never reaches a live table unvalidated.
- Evidence is mandatory and verified: the `quote` must be a substring of the fetched text (deterministic check in `logic.mjs`) before the proposal is submitted. This is the cheap hallucination filter; proposals that fail it are dropped and counted in the run log.
- Migration of `plan_drafts`: do NOT migrate first. Phase 1 adds `proposals` and new kinds; `plan_drafts` keeps working. A later cleanup phase points `plan-intake`'s stage code at `proposals` (`kind='schedule_item'`) and drops `plan_drafts` after draining. Avoids a risky big-bang on the one working pipeline.
- Counter-case where per-type tables win: if a kind needs relational integrity on its payload (FKs, unique constraints). Handle that in the LIVE table, not the draft.

## Job orchestration inside Edge Function limits

Platform facts to re-verify at phase start (MEDIUM, from memory): edge function wall-clock ~150s on free and ~400s on paid plans, ~2s CPU time per request (awaiting network does not count), 256 MB memory. Design for ~60-90s per invocation regardless. Check https://supabase.com/docs/guides/functions/limits.

**Pattern: Postgres-table queue + cron tick + short stateless worker.** Rejected: one function that loops all 16 cars (today's `plan-intake` model; will exceed wall clock once discovery + extraction + prices run per car), and recursive self-invocation (hard to cap cost, hard to resume).

- `autopilot_runs(id, month, status running|capped|done|failed, cap_usd, spent_usd, started_at, finished_at, config jsonb)`.
- `autopilot_jobs(id, run_id, car_model_id, stage, payload jsonb, status queued|running|done|failed|skipped_budget, attempts, lease_until, error, depends_on bigint[], cost_usd)`.
- Monthly cron: `select cron.schedule('autopilot-monthly','0 3 1 * *', $$select net.http_post(...autopilot-start..., headers with secret from vault)$$)`. The existing function already authenticates via `x-cron-secret` (constant-time compare); reuse it. Keep the secret in Supabase Vault, not in the cron SQL text.
- Tick cron every minute: `select net.http_post(autopilot-worker)` ONLY if `exists(select 1 from autopilot_jobs where status in ('queued','running'))` (SQL guard in the cron command so idle months cost nothing).
- Claim: `update autopilot_jobs set status='running', lease_until=now()+interval '3 min', attempts=attempts+1 where id in (select id from autopilot_jobs where status='queued' and (depends_on is null or all deps done) order by id for update skip locked limit 3) returning *`. Expired leases are re-queued by the tick (crash safety). `attempts >= 3` -> `failed`.
- Concurrency 2-3 jobs per invocation, one invocation per tick: bounded Anthropic rate use and bounded spend per minute.
- Stage graph per car (16 cars x ~5 stages = ~80 jobs, ~1 hour wall time at 3 jobs/min; acceptable for monthly):
  `discover` (web search for official schedule/parts pages -> `schedule_sources` rows with `origin='discovered'`, `status='candidate'`) -> `fetch_extract` (one job per source: fetch, hash, skip if unchanged, LLM extract) -> `propose` (diff vs live, submit proposals) ; parallel branches `prices` (marketplaces), `photos`, and a car-independent `new_models` and `community` job.
- Idempotency: every stage is safe to retry (hash skip, proposal upsert via unique index, ledger row per LLM call keyed by `(job_id, call_no)`).
- Content-hash skipping (already in `plan-intake`) is the main cost lever: an unchanged source costs zero LLM tokens. Keep it, and hash the extracted text not the raw HTML (htmlToText already does).
- Alternative considered: `pgmq` extension. Reasonable, but a plain table gives dependencies, per-job cost, and admin visibility with one fewer concept. Revisit only if jobs exceed thousands.

## Run log and cost ledger

- `autopilot_ledger(id, run_id, job_id, call_no, provider, model, kind llm|search|fetch|image, input_tokens, output_tokens, search_calls, usd, at)`. One row per billable call. `usd` computed in `logic.mjs` from a `pricing` config row (per-model rates), not hardcoded in many places.
- Fail-closed cap: `reserve_budget(run_id, est_usd) returns boolean` does `update autopilot_runs set spent_usd = spent_usd + est where id=$1 and spent_usd + est <= cap_usd returning 1`; atomic, so concurrent workers cannot overshoot. Worker calls it BEFORE each LLM/search call with a worst-case estimate (max_tokens x output rate + input estimate), then `settle(ledger_id, actual)` corrects. If false: job -> `skipped_budget`, run -> `capped`, remaining jobs skipped. Proposals already written stay pending (they are drafts, nothing is published), which satisfies "no partial or unreviewed publishes".
- Also per-job caps (max sources per car, max tokens per doc, max pages) and a global kill switch (`autopilot_config.enabled`).
- Run log in admin: run table (month, status, spent/cap, proposals by kind, skipped/failed counts with errors), per-job drill-down. This doubles as the "edge-function errors visible to owner" foundation requirement: have the worker write `error` text into `autopilot_jobs` rather than the current bare `catch { skipped++ }` that discards the reason (a real gap in `plan-intake` today).
- Anthropic server-side web search tool is billed per search on top of tokens (LOW: verify current price and tool name in docs before budgeting). Alternative: a search API (Brave/Tavily-like) called from the worker and results fed to the model; either way log under `kind='search'`.

## Approval -> publish path

```sql
apply_proposal(p_id bigint, p_approve boolean, p_edit jsonb default null) returns jsonb
  -- is_admin() check; select ... for update where status='pending'
  -- reject: set status='rejected', store rejected_hash
  -- approve: v := coalesce(p_edit, after); 
  --   if kind needs it: compare live row hash to base_hash, else status='stale' and return {stale:true}
  --   case kind when 'schedule_item' then upsert dealer_plan_items (existing clamps) 
  --        when 'part' then upsert catalogue_parts ... when 'price' then insert price_observations(source='autopilot') ...
  --   insert into change_log(table_name,row_key,op,before,after,proposal_id,run_id,by)
  --   update proposals set status='approved', edited_after = p_edit ...
apply_proposals(p_ids bigint[], p_approve boolean) -- bulk: loops apply_proposal with per-item exception block, returns per-id result
revert_change(p_change_id bigint) -- admin only; restores `before` (or deletes if insert), writes its own change_log row
```

- One transaction per proposal; bulk = loop with `begin ... exception when others` per item so one bad item does not roll back the batch, and the result array shows which failed.
- Reuse existing triggers: `dealer_plan_items` already logs to `dealer_plan_changes` and bumps `car_models.plan_updated_at` (this is what makes devices re-apply). For NEW live tables, add a generic `change_log` plus an equivalent `plan_updated_at` bump (or a `catalogue_version` per car) so `remote-catalog.js` knows to refetch. Do not duplicate: keep `dealer_plan_changes` for schedule items; `change_log` for the rest, or (simpler, recommended) one generic AFTER trigger function `log_change()` attached to every live catalogue table, replacing per-table bespoke triggers over time.
- Rollback = `revert_change`. Because every live write funnels through triggers, edits made manually in admin are also revertible. Whole-run rollback: `revert` all `change_log` rows for `run_id` in reverse order (admin button, optional; build only the per-change revert first).
- Stale protection (`base_hash`): if the owner hand-edited a row between proposal and approval, approval refuses and marks `stale` rather than clobbering.
- New car models: approval of `kind='car_model'` inserts `car_models` with `status='draft'` (existing check allows it; RLS hides drafts from the public), and a second explicit step flips to `approved` once the owner has reviewed its plan items. This reuses the existing draft/approved gate rather than inventing one.
- Recalls: leave the table-level pending/approved flow; surface them in the same admin tab via a thin adapter. No need to push them through `proposals`.

## Photo proposals into Storage

- Two buckets: `catalogue-candidates` (PRIVATE; admin read via signed URL, worker write via service role) and `catalogue-photos` (PUBLIC read; written only by `apply_proposal`'s storage step). Never put candidates in a public bucket.
- Worker photo job: find candidate image URLs -> SSRF-guarded fetch (reuse `isSafeUrl`/`resolvesPublic`) -> enforce content-type + magic bytes + max bytes + max dimensions -> store `{run}/{car}/{colourSlug}.<ext>` -> proposal `kind='photo'`, `after={path, colour, width, height, source_url, licence_note}`, evidence = source page. Record licence/attribution; scraped manufacturer press photos may not be redistributable (flag for the owner; LOW confidence on legal status, owner decision).
- Publish: SQL cannot move Storage objects portably, so approval is two-step and idempotent: `apply_proposal` writes a `car_photos(car_model_id, colour_slug, path, rev, proposal_id)` row (rev increments) and the admin client (or a tiny `publish-photo` edge fn with admin JWT) copies candidate -> public bucket at `path`. If the copy fails the row stays `publishing` and is retried. Alternative with fewer moving parts: the DB row points at the candidate path and a Storage RLS policy permits public read only for paths referenced by `car_photos` (policy with `exists` subquery). Prefer this: one bucket, no copy, atomic with the transaction.
- Client: `remote-catalog.js` reads `car_photos` and the version map replaces the hand-written `?v=` ternary in `dashboard.js` (`rev` from the table is the single version source; this couples nicely with the foundation item "photo cache busting driven by one version map").
- FRAGILITY: `docs/CAR-ASSET-GUIDE.md` requires transparent edges, consistent framing, both wheel badges, factory hardware. An automated scrape cannot meet that. Treat autopilot photos as CANDIDATES for the owner's manual asset pipeline in v1 (admin can approve-as-candidate and download), and only auto-publish to users if the image passes explicit constraints (aspect, transparency, size) checked in `logic.mjs`. Build this stage LAST; highest risk, lowest data value.

## Brand-agnostic schema changes

Current Mazda leakage found:
- `car_models.make default 'Mazda'` (fine, already a column).
- `plan-intake`: `'mazda' + car.model` NHTSA model name hack; `SYSTEM_PROMPT` likely Mazda-worded (check `logic.mjs`).
- `car_models.id = '<modelId>:<engine-slug>'` is assumed unique across makes; a Toyota "Camry" is fine but "3"/"6" style collisions are possible. Make new ids `<make-slug>.<modelId>:<engine>` only for NEW makers; do NOT rewrite existing Mazda ids (they are keys on user devices and synced vehicles).
- `src/data/catalog.js` `CAR_MODELS` is client-hardcoded Mazda; `remote-catalog.js` must become the source of truth for non-Mazda makers (out of this milestone, but do not add new Mazda-only constants).

Changes:
1. `makers(slug pk, name, nhtsa_make text, nhtsa_model_template text, discovery jsonb)` where `discovery` holds domain allowlist, search query templates, and marketplace list. Seed Mazda from the current hardcodes. Adding a maker = insert rows + (later) client picker work, no worker code change.
2. `proposals.maker`, `schedule_sources.origin/status/kind/domain` (add columns, don't rename), `car_models.maker` FK to `makers` (keep `make` text column for compatibility; backfill, then constrain).
3. Prompts take `{maker, model, generation, region}` parameters from rows; no maker names inside `logic.mjs` string literals (add a unit test asserting prompts built for a fake maker contain no "Mazda").
4. Parts: add `catalogue_parts(car_model_id, part_no, name, category, fitment jsonb, oem bool, source_url, status)` and `part_alternatives(part_id, brand, part_no, price_sar, source)` rather than growing `dealer_plan_items.parts` jsonb; keep jsonb for compatibility and link by part_no. Failures: `known_failures(car_model_id, title, detail, ...)`. Check what `price_items` is already keyed on before adding anything (read `schema.sql` lines 100-185 in that phase) and reuse it for marketplace prices via `price_observations` with `source='autopilot'`.
5. Per-maker region/currency is out of scope; keep SAR/KSA constants in config row `autopilot_config`, not code.

## Admin UI integration (`src/pages/admin.js`)

- Add a kind-renderer registry: `{ schedule_item: renderDiff, part: ..., photo: renderImage, ... }`, each returning escaped `html```; a generic fallback renders a JSON before/after diff so a new kind is reviewable on day one.
- Tabs/filters: kind, car, run; bulk approve selected; "stale" and "capped run" banners; Run log view; Revert on change log.
- All scraped strings and evidence quotes through `html``; `test/no-raw-templates.test.js` must cover any new page file. New scripts need `index.html` + `sw.js` `ASSETS` entries.

## Data flow (direction explicit)

1. cron -> `autopilot-start` -> `autopilot_runs`, `autopilot_jobs` (no external I/O).
2. cron tick -> `autopilot-worker` -> claims jobs -> web search / source fetch / Anthropic -> `autopilot_ledger` (always) -> `proposals` (pending only) / candidate Storage objects / `schedule_sources` (candidate).
3. Admin (browser, JWT) <- reads `proposals`, runs, ledger. Admin -> `apply_proposal` RPC.
4. `apply_proposal` -> live tables + `change_log` -> existing `plan_updated_at` bump -> devices pull via `remote-catalog.js`.
5. App users: contributions/price observations/bills -> existing tables -> `community` job aggregates (mostly SQL, thresholds like N distinct users, outlier trimming) -> `proposals`. Users never write proposals directly.

## Anti-Patterns to Avoid

- **Monolithic per-run function** (today's `plan-intake` loop): wall-clock death and all-or-nothing failure. Use the queue.
- **Autopilot writing live tables "behind a flag"**: gate must be structural (RPC-only, `apply_proposal` only), not a boolean.
- **Per-kind draft tables + per-kind admin code**: multiplies RLS and review code.
- **Trusting LLM numbers without evidence quote verification**: hallucinated part numbers/prices are the top data-quality risk.
- **Discarding errors** (`catch { skipped++ }`): store the reason on the job.
- **Re-proposing rejected values monthly**: store rejected fingerprint.
- **Treating discovered URLs as trusted**: web-search results are attacker-influenced; keep SSRF guards, domain allowlist/denylist per maker, size caps, `https` only, robots.txt check, and never pass fetched text as system-prompt content (prompt-injection: put it in the user turn, instruct extraction-only, validate output shape).
- **Changing existing `car_models.id` values**: breaks synced vehicles.

## Scalability

| Concern | 16 Mazda cars | ~10 makers (~150 cars) | Beyond |
|---------|---------------|------------------------|--------|
| Wall time | ~1 h at 3 jobs/min | raise tick concurrency or tick 2 functions | pgmq / external worker |
| Cost | cap per run, hash-skip dominates | per-maker sub-caps | per-source tiering |
| Review load | tens of proposals | hundreds: need confidence sort + bulk approve | auto-approve is OUT of scope by design |
| Table growth | trivial | partition ledger/jobs by month or purge >12 mo | same |

## Suggested Build Order (dependencies)

1. **Foundation prerequisites that autopilot depends on**: CORS restriction + RLS tests in CI (every new table needs RLS tests, `supabase/tests/*.sql`), error visibility, `plan-intake` N+1 batching (becomes the template for bulk proposal upsert). Dependency: none.
2. **Schema core**: `makers`, `proposals`, `change_log` + generic log trigger, `autopilot_runs/jobs/ledger/config`, RPCs (`submit_proposal`, `claim_jobs`, `reserve_budget`, `apply_proposal`, `revert_change`) + RLS + SQL tests. No LLM yet. Dependency: 1.
3. **Admin queue v2**: generic proposals list, diff fallback renderer, bulk approve, run log, revert. Seed with hand-inserted fake proposals to test approve/stale/revert end to end. Dependency: 2. (Proves the approval gate before any scraping exists.)
4. **Worker skeleton + orchestration**: start/tick/claim/lease/retry, ledger + cap enforcement, kill switch; one stage ported: existing schedule extraction from admin-registered sources writing `proposals` (parity with `plan-intake`). Dependency: 2, 3. Risk gate: verify edge limits, cron + pg_net + Vault.
5. **Source discovery** (web search -> candidate sources, domain allowlist, robots, evidence-quote check). Dependency: 4. Needs deeper research (search provider, cost, ToS).
6. **New kinds one at a time**: parts (`catalogue_parts`), then marketplace prices/alternatives, then failures/community aggregation, then new-model detection (secondary per PROJECT.md). Each = parser + diff + kind renderer + apply branch + tests. Dependency: 4 (5 optional per kind).
7. **Photos** (bucket policy, validation, `car_photos`, client version map). Dependency: 3, 4; coupled to foundation photo-cache item. Highest risk; last.
8. **Cutover/cleanup**: point legacy `plan-intake` and `plan_drafts` at `proposals`, drop `decide_plan_draft`, dry-run month with low cap, then enable monthly cron.

## Research flags

- Phase 4: verify edge function limits, `pg_net` + `pg_cron` + Vault secret pattern, cron-tick guard SQL (NEEDS verification against current Supabase docs).
- Phase 5: web-search provider choice, per-search cost, robots/ToS handling, prompt-injection hardening (NEEDS research).
- Phase 6 (marketplaces): PartSouq / Amazon.sa / noon scraping feasibility and ToS; likely bot-blocked, may need an API or be reduced to links (NEEDS research, possible descope).
- Phase 7: image licensing and automated QA against CAR-ASSET-GUIDE (NEEDS research / owner decision).
- Phases 2-3, 8: standard patterns.

## Confidence

| Area | Confidence | Notes |
|------|------------|-------|
| Proposals + apply RPC + change log | HIGH | Direct extension of existing `plan_drafts`/`decide_plan_draft`/triggers |
| Queue + cron tick + lease | MEDIUM-HIGH | Standard Postgres pattern; platform limits unverified |
| Cost cap via atomic reserve | HIGH | Plain SQL |
| Web search billing/tooling | LOW | Verify in docs |
| Photo publish via Storage RLS | MEDIUM | Needs a spike |
| Marketplace scraping | LOW | ToS/bot blocking unknown |

## Sources

- `supabase/schema.sql` (lines 590-826), `supabase/functions/plan-intake/index.ts`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md`, `.planning/PROJECT.md` (HIGH, local)
- Supabase Edge Function limits: https://supabase.com/docs/guides/functions/limits (not fetched this session; verify)
- Supabase cron / pg_net / Vault docs: https://supabase.com/docs/guides/cron (not fetched; verify)
