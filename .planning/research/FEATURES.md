# Feature Landscape

**Domain:** Automated catalogue ingestion with human-in-the-loop approval (Mazda care catalogue, KSA)
**Researched:** 2026-11-05
**Confidence:** MEDIUM. Based on the existing code (`src/pages/admin.js`, `src/data/admin.js`, PROJECT.md) plus established patterns from data-curation/moderation queues (PIM enrichment, Wikidata/OSM edit review, Dependabot-style proposal PRs). No live web verification done; patterns are well-known, specifics are judgment.

## Baseline (already exists, extend not rebuild)

- `plan_drafts` + `recalls` pending rows, `decide_plan_draft` RPC, `draftDiff` (field before/after), one source link per draft, per-item Approve/Reject, "Check sources now" button, `dealer_plan_changes` log (recent 20, per model), fail-closed draft writing, SSRF guards.
- Gaps vs this milestone: no confidence, no multi-source, no bulk, no grouping/filtering, no run report, no cost tracking, no rollback UI, only schedule+recall entity types, no edit-before-approve in queue (edit param exists in RPC but UI doesn't use it), queue is one flat list (will not scale to 16 models x 5 data types).

## Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Generic proposal table (`proposals`: entity_type, entity_key, car_model_id, action add/change/remove, live snapshot, proposed JSON, status, run_id, created_at) | One queue for schedules, parts, prices, failures, photos. Per-type tables will multiply admin code | Med | Brand-agnostic (`brand` column). Keep `plan_drafts`/`recalls` working, migrate or wrap. Writes drafts only, never live tables |
| Source citation on every proposal (URL, fetched-at, short quote/snippet) | Owner cannot approve what he cannot verify. Core value | Low | Multiple sources per proposal (array). Render hostname link, https only, textContent only |
| Before/after diff per field | Already exists for schedules; extend to parts (name/part no/price), prices, failure text | Med | Reuse `draftDiff`. Show "new" and "removed" explicitly, not blank vs value |
| Confidence indicator (high/med/low, simple enum) | Owner has no time to read 100+ items; needs triage signal | Med | Derive from rules not LLM self-report: number of agreeing sources, source tier (official dealer > marketplace > forum), size of change vs live, schema validity. LLM self-score is unreliable |
| Single-item approve/reject (+ optional reject reason) | Basic. Reject reason prevents re-proposing same junk | Low | Store reason; feed into suppression (see dedupe) |
| Bulk approve/reject with filters | 16 models x many items per month; one-by-one will kill the "owner only approves" promise | Med | Select-all within a filter (model, type, confidence). Default bulk = high confidence only. Show count and require one confirm. Atomic RPC, all-or-nothing per batch |
| Queue grouping and filters (by model, type, confidence, run) | Flat list unusable at volume | Med | Collapse per model; badge counts. Show "no change" models as one line |
| Dedupe of proposals | Monthly rerun must not re-queue the same pending, rejected, or already-live data | Med | Stable `fingerprint` = hash(entity_key + normalized proposed). Skip if equal to live, to an open pending, or to a rejected one (until source content changes). Unique index on pending fingerprint |
| Supersede stale pending proposals | If last month's pending item is still open and this month differs, replace it | Low | Mark old as `superseded`, not delete |
| Run record + run report | Owner must know the run happened, what it covered, what failed | Med | `ingest_runs`: started/finished, status, per-model per-type counts (proposed, unchanged, skipped, errored), sources fetched, failures with reason, tokens/cost. Show newest run at top of `#admin`. No notifications (out of scope), so the report is the heartbeat: "last run N days ago" warning banner if overdue |
| Hard cost cap, fail closed | Stated requirement | Med | Per-run budget in tokens/USD counted from API usage fields; check before each LLM/search call; stop and mark run `capped` with what finished. Partial proposals already written stay pending (they are drafts, safe) but run flagged partial. Per-source and per-model sub-limits so one model cannot eat the budget |
| Idempotent, resumable run | Edge function time limits; cron retries | Med | Process one model x type per invocation (queue/cursor), run state in DB. Avoids duplicate proposals on retry |
| Staleness detection (basic) | "Re-checks existing cars" means knowing what is old | Low | `last_verified_at` per catalogue item/price; run prioritizes oldest first; admin shows "unverified for N months". Prices older than 1 run = flagged |
| Change log + one-click revert of an approved change | Wrong approvals will happen | Med | `dealer_plan_changes` already logs before/after. Add "Revert" that writes the `before` snapshot back as an audited change (new log row), not a destructive undo. Extend log to parts/prices/photos |
| Untrusted content rendering | Scraped/LLM text in admin UI | Low | Already the rule: textContent / `html` template only. Test it with injection fixtures |
| Schema validation of LLM output before queuing | Garbage in the queue erodes trust | Low | Reject out-of-range km/months, SAR price sanity (vs live, e.g. >3x or <0.3x flagged low), malformed part numbers |
| Source discovery allowlist / registry | Fully automatic discovery still needs bounds | Med | Store discovered sources with tier and last-status; allowlist of domain types; respect robots; owner can ban a domain in one click |
| Photo proposal review: side by side current vs candidate | Photos approved visually | Med | Show at same framing as app; approve/reject only. Candidate stored in private bucket until approved, then copied to public path and version map bumped |
| Photo rules gate | `docs/CAR-ASSET-GUIDE.md` has strict approval history | Med | Automated pre-checks (transparent edges, size, aspect, filename/version scheme) mark candidates pass/fail; failures never reach owner unless "show failed". Never reapply rejected Mazda2 175 / Mazda3 196. Keep a rejected-hash list |
| Community submissions to proposals (bills, price observations, alternatives) | Stated requirement | Med | Aggregate per (part, model) -> median price, n, spread. Propose only when n >= threshold (e.g. 3 independent users) |
| Basic trust scoring of community input | Raw user data is spammable | Med | Rules not ML: distinct users, account age, outlier vs median (drop beyond MAD), one vote per user per item per window, bill-backed (read-bill) weighs more than typed. Output feeds confidence |

## Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Edit-then-approve inline | Fix a typo or price in one tap rather than reject + manual edit | Low | RPC `p_edit` already exists; wire UI. Log as "approved with edit" |
| Risk-tiered auto-triage (never auto-publish) | Sorts queue into "looks safe / needs eyes / suspicious"; default bulk-approve only safe tier | Med | Still owner-approved. Respects core value; just ordering |
| "Unchanged" verification receipts | Run reports that "CX-5 KF schedule re-verified, no change, source X" without queue noise; resets staleness clock only on approval of a receipt batch or auto (decide) | Med | Staleness clock reset by verification is data, not publish; keep it off the live tables or in a separate `verified_at` column |
| Source disagreement panel | When dealer says 10,000 km and forum says 5,000 km, show both side by side with tier | Med | High value for KSA severe-conditions intervals; do not auto-resolve |
| Severe-condition (Jeddah) intervals as separate proposal field | Product-specific value | Med | Depends on schedule model supporting normal vs severe |
| Price history and trend on a part (sparkline, last 3 runs) | Spot outliers and see whether a change is real | Med | Needs retained price observations per run |
| Per-source reliability score learned from owner decisions | Approve/reject history raises/lowers a domain's confidence | Med | Simple counters per domain; no ML |
| Failure-knowledge aggregation with mention count | "Reported by 12 posts / 4 app users" with representative quotes and links | Med-High | LLM clustering of forum posts into canonical failure per model+system; cap tokens; always show quotes so owner can verify |
| Cheaper-alternative proposal with fitment evidence | Core app value (OEM vs cheaper) | High | Needs compatibility proof (part number cross-ref); otherwise label "unverified fitment" low confidence |
| Rollback of a whole run | Undo a bad bulk approval | Med-High | Needs run_id stamped on every approved change; revert = apply inverse for all changes of that batch. Cheap if change log already carries batch id |
| Dry-run / single-model "check now" with cost preview | Safe testing before the first real monthly run | Low | Existing button; add model scope and estimated cost |
| Deep link from run report to filtered queue | Fast review flow | Low | Hash params on `#admin` |
| New-model discovery as draft `car_models` | Stated, secondary | Med | Already has `status='draft'` flow. Needs duplicate-model detection (name normalization, generation codes) |

## Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Auto-publish of "high confidence" proposals | Violates core value; LLM-scraped data confidently wrong (wrong generation/engine fitment) | Auto-triage + bulk approve by owner |
| LLM self-reported confidence as the score | Poorly calibrated | Rule-based score from sources, agreement, change size |
| Email/push/Slack notifications | Owner chose in-app only (out of scope) | Overdue/last-run banner in `#admin` |
| Multi-role approval workflow, assignments, comments threads | One owner | Single admin role, reject reason field only |
| Full CMS-style editor for every field | Scope bloat; admin already edits items | Inline edit on proposal only |
| Real-time or weekly price scraping | Owner chose monthly; cost | Monthly run; "check now" per model for exceptions |
| Scraping logged-in/paywalled/ToS-forbidden sites, headless browser farm | Legal and cost risk, SSRF surface | Public pages, robots respected, API/feeds where offered |
| Storing full scraped pages/forum posts | Copyright, storage | Store URL, short snippet, hash, fetched-at |
| ML-based trust/spam model for community data | Overkill for small user base | Thresholds + median + distinct users |
| Auto image generation/editing to "fix" photos | Asset guide history shows approval pain; rejected edits | Propose real candidates; gate with checks; owner decides |
| Diff of free-form AI prose summaries | Noisy, always "changed" | Diff structured fields only; normalize before compare |
| Undo by deleting rows | Loses audit | Revert = new audited change |
| Per-type bespoke queue UIs | Duplicated code in a vanilla-JS no-build app | One proposal renderer with per-type field formatter |
| Automatic multi-brand crawl now | Out of scope | Brand-agnostic columns only |

## Feature Dependencies

```
Generic proposals table + run_id ──> everything below
  ├─> Source citation (multi-source array)
  │     └─> Confidence score ──> Risk-tiered triage ──> Bulk approve (filtered)
  ├─> Fingerprint dedupe ──> Supersede stale ──> Reject-suppression
  ├─> ingest_runs ──> Run report ──> Overdue banner
  │       └─> Cost cap accounting ──> Resumable cursor run
  ├─> Change log (extend to parts/prices/photos, batch id) ──> Revert item ──> Revert whole run
  ├─> last_verified_at ──> Staleness ordering ──> Verification receipts
Community submissions ──> Aggregation (n threshold, median) ──> Trust rules ──> Confidence
Source registry (tiers, bans) ──> Source discovery ──> Confidence tier + per-source reliability
Photo candidates (private bucket + version map) ──> Photo rules gate ──> Side-by-side review ──> Approve copies to public + cache bump
Foundation fixes (error surfacing, CORS, N+1 batching) ──> before autopilot server code
```

## MVP Recommendation

Prioritize (in order):
1. Generic proposals table + `ingest_runs` + fingerprint dedupe (everything depends on it)
2. Queue UI: grouping/filters, multi-source citation, diff for parts/prices, confidence enum, single + bulk approve, reject reason
3. Cost cap + resumable per-model/type runs + run report + overdue banner
4. Schedules + OEM parts + marketplace prices proposals (staleness via `last_verified_at`)
5. Change-log extension + item revert
6. Community aggregation with threshold/median trust rules
7. Photo proposals with rule gate and side-by-side review (last: highest process cost, strict history)

Defer: whole-run rollback, per-source learned reliability, price trend charts, failure clustering quality tuning, cheaper-alternative fitment proof. Add after first two real monthly runs show actual noise levels.

Complexity note: bulk approve and confidence are cheap if proposals are generic early; retrofitting them per type is the expensive path.

## Sources

- Code: `src/pages/admin.js`, `src/data/admin.js`, `.planning/PROJECT.md` (HIGH, current state)
- Pattern knowledge from moderation/curation tools and bot-PR workflows (MEDIUM/LOW; training data, not re-verified online)
