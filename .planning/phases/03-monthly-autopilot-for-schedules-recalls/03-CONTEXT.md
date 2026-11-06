# Phase 3: Monthly Autopilot for Schedules & Recalls - Context

**Gathered:** 2026-11-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Once a month, without owner action, the autopilot checks all 16 Mazda catalogue cars. It queues schedule corrections (normal and severe/Jeddah intervals) and recall proposals into the existing `proposals` review queue, within a hard monthly cost cap. Autopilot writes only to `proposals`; the owner approves everything (Phase 2 gate). Parts, prices, community data and new models are Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Cost cap (ENG-03, ENG-09)
- **D-01:** Hard monthly cap is SAR 40. Checked before every paid call.
- **D-02:** When the cap is hit mid-run, the run stops and publishes nothing partial (no proposals from the unfinished run reach the queue).
- **D-03:** "Check now" for one car shows a preview with estimated cost (SAR), number of web searches and LLM calls, and which sources would be skipped as unchanged.
- **D-04:** Spend is metered per call from stored token and search counts, multiplied by a configured price table (USD and SAR). No provider billing API.

### Source discovery & trust (ENG-05, ENG-06)
- **D-05:** Official sources are found with the Anthropic web search tool called from the edge function. No second search vendor.
- **D-06:** Mazda Saudi/GCC domains are a hard preference: search GCC domains first; global/US sources only when GCC returns nothing for that car.
- **D-07:** A new, unseen source domain is held for owner approval in `#admin` before it is used.
- **D-08:** Banning a domain is permanent. Its existing pending proposals are rejected automatically with reason `banned source`.

### Severe (Jeddah) intervals (SCH-02, SCH-03, ENG-07)
- **D-09:** Each service shows normal and severe intervals as two separate structured fields (km and months) in the proposal diff and in the live plan.
- **D-10:** If official sources give only one interval, propose only the normal value. Keep the existing severe value unchanged. Never copy normal into severe.
- **D-11:** Generation or engine mismatch is rejected in code before the queue, with a logged reason (SCH-03).
- **D-12:** Every severe number needs a quoted source line that appears verbatim in the fetched text, same rule as ENG-07.

### Run cadence & failure handling (ENG-01, ENG-02, ENG-04, REV-08, SCH-05)
- **D-13:** Each per-car, per-stage job retries 2 times (3 attempts total), then is marked failed.
- **D-14:** Kill switch is one `#admin` toggle stored in the DB, read before every paid LLM or search call. Flipping it stops the run at the next call.
- **D-15:** `#admin` banner shows when the last run failed, or when no run has happened in 35 days.
- **D-16:** A catalogue item not verified for 2 consecutive runs is flagged `unverified` in `#admin` (SCH-05).

### Claude's Discretion
- Edge function split (per-car stage jobs, pg_cron trigger shape) and where the cost ledger and price table live.
- Exact schema for the source allowlist/ban list and the per-run report record (REV-07).
- Recall flow: keep the existing NHTSA path (SCH-04) and route its output through `proposals`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project and requirements
- `.planning/PROJECT.md` — core value and approval-gate constraint
- `.planning/REQUIREMENTS.md` — ENG-01..09, SCH-01..05, REV-07, REV-08 (Phase 3 requirements)
- `.planning/ROADMAP.md` §Phase 3 — success criteria (4 items)

### Approval gate (already built in Phase 2)
- `supabase/schema.sql` — `proposals` table, `submit_proposal`, `apply_proposal`, `apply_proposals`, `reject_proposal`, `revert_change`
- `.planning/phases/02-proposal-gate-review-queue/02-CONTEXT.md` — gate decisions carried forward

### Existing edge function and fetch patterns
- `supabase/functions/plan-intake/index.ts` and `logic.mjs` — edge function pattern, pure logic split
- `supabase/functions/read-bill/index.ts` — second edge function reference
- `supabase/functions/_shared/safe-fetch.mjs` — SSRF guard; all fetches must use it (CLAUDE.md constraint)

### Recalls
- `src/data/recalls.js` — existing NHTSA recall flow (SCH-04 keeps it)

### Constraints
- `CLAUDE.md` — approval gate: autopilot writes only drafts/pending rows; Scraping: respect robots/terms, keep SSRF guards

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `proposals` table and RPCs from Phase 2: autopilot writes through `submit_proposal` only (dedupe, supersede and reject-suppression already implemented, CORE-03/04).
- `safe-fetch.mjs`: SSRF guard for every outbound fetch.
- `src/data/recalls.js`: existing NHTSA recall fetch.

### Established Patterns
- Edge functions split into `index.ts` (I/O) and `logic.mjs` (pure, testable). Follow this for the monthly run.
- Units and prices stored explicitly, converted in code (CORE-07). Never by the LLM.

### Integration Points
- `#admin` Proposals tab: new kill-switch toggle, run report card, banner, ban-list control, unverified flag.
- pg_cron: monthly trigger (already used by the app for other jobs per schema.sql).

</code_context>

<specifics>
## Specific Ideas

- Cap is SAR 40 per month.
- Mazda Saudi/GCC first, strictly.
- Severe interval always its own field, never implied from normal.

</specifics>

<deferred>
## Deferred Ideas

- Parts, prices, community data, new-model detection: Phase 4.
- Photo refresh: out of milestone (PHO-01/02 are v2).

### Reviewed Todos (not folded)
None reviewed.

None — discussion stayed within phase scope for the four areas above.

</deferred>

---

*Phase: 03-monthly-autopilot-for-schedules-recalls*
*Context gathered: 2026-11-05*
