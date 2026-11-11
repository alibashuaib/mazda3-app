---
phase: 4
phase_name: "Parts, Prices, Community & New Models"
project: "Car Care — Autopilot Catalogue"
generated: "2026-11-11"
counts:
  decisions: 6
  lessons: 6
  patterns: 5
  surprises: 5
missing_artifacts:
  - "04-UAT.md"
  - "04-10-SUMMARY.md (plan 04-10 owner live checkpoint not run)"
---

# Phase 4 Learnings: Parts, Prices, Community & New Models

## Decisions

### Code-side gates enforce the source rules, not the LLM
Part numbers need 2 registrable hosts (or the Mazda KSA dealer list as the official catalogue). Prices come only from citations. Materiality is ≥10% and ≥5 SAR. Failures need 3+ mentions on 2+ hosts. Trimmed median is ±30%. New-model ids follow the `catalogId()` rule.

**Rationale:** LLM output is untrusted and its counts are not reliable. Gates in `community.mjs` and `parts.mjs` compute the counts, so the model cannot inflate them.
**Source:** 04-02-SUMMARY.md, 04-CONTEXT.md (D-04..D-07, D-11, D-13, D-15, D-17)

### Fitment pinned per engine id
One proposal per car + engine + part slot, keyed `<modelId>:<engine-slug>`.

**Rationale:** A part checked on one engine must never apply to another. This is the same bug class the engine prefix in `OEM_CHECKED` already guards.
**Source:** 04-CONTEXT.md (D-04)

### Approved data lives in a server table, server wins
`catalogue_parts` and `known_issues` are read-only for anon and authenticated. Writes go only through security-definer gate functions. `catalog.js` stays the offline fallback.

**Rationale:** Approved changes reach users without a code deploy, and owner edits on saved cars are kept.
**Source:** 04-01-SUMMARY.md, 04-CONTEXT.md (D-01, D-02)

### Rotating stages across cars to fit the cap
Parts, prices and community stages rotate across due cars. Model detection runs once a month. Schedules and recalls run for every car.

**Rationale:** Keeps the monthly run under the SAR 40 cap.
**Source:** 04-CONTEXT.md (D-19), 04-04-SUMMARY.md

### Rotation orders by `least(parts_done, community_done)`
A missing stage counts as `-infinity`, not `max(...) nulls first` as the plan said. A car whose parts succeeded but community failed stays due.

**Rationale:** With `max`, a half-finished car looked done and was skipped.
**Source:** 04-04-SUMMARY.md (Deviations, Rule 1)

### Mazda KSA dealer price list is the only "official catalogue"
Dealer prices are labelled "indicative" only when non-dealer. Other sources need 2+ independent agreeing sources.

**Rationale:** Part-number accuracy. The dealer-page smoke was blocked, so this decision is still partly unverified live.
**Source:** 04-CONTEXT.md (D-05, D-08), 04-03-SUMMARY.md, 04-VERIFICATION.md (W-02, W-03)

## Lessons

### plpgsql `IF` with a `CASE` expression needs parentheses
An `IF` condition containing an unparenthesised `CASE ... THEN` ends at the CASE's `THEN`. The fix is to wrap the CASE in parentheses at the IF.

**Context:** Found while building the part tag check in `schema.sql`. It would have failed at apply time, not at parse time.
**Source:** 04-REVIEW.md / commit `1090a2f` (git history)

### A forward reference in `schema.sql` breaks only a fresh database
`price_item_averages` referenced `qualified_users` before it was created. The existing staging database was not affected. Only CI's `rls` job, which runs `schema.sql` on a fresh database, caught it.

**Context:** Fixed by moving the view below `qualified_users`. Lesson: test schema apply on a fresh DB, not only on an existing one.
**Source:** git history `73eff51`; 04-VERIFICATION.md

### A later table-level grant silently undid a column revoke
`price_items` had a column revoke, then a table-level grant later in the file restored full SELECT. The security review caught it. The fix was an insert-only table grant, with column-level SELECT.

**Context:** Column privileges are only safe if no later statement widens them. The `has_column_privilege` assertions in `catalogue-rls.sql` now lock this down.
**Source:** git history `2b1fd61`; 04-SECURITY.md

### Privacy floor raised from 3 to 5 users, and tests lagged
The user-agreement aggregate floor went to 5 in both SQL and JS (WR-08). The agreement fixtures and the schema assertion still expected 3. CI `rls` failed on Oil Filter, then on the single-engine Wiper case, one step at a time.

**Context:** Changing a threshold means updating every fixture and assertion that depends on it. Run the whole rls job, not one test, to see the full set of failures.
**Source:** git history `651613e`, `2b1fd61`; 04-REVIEW.md (WR-08)

### Escaping a regex inside a shell or Node one-liner is error-prone
A multi-line `sed`/Node escape broke the token-bounded `tok()` regex in `models.mjs`. It was fixed with the Edit tool.

**Context:** For multi-line regex edits, use a file edit tool, not inline shell scripts.
**Source:** Session notes in `.planning/quick/20261111-review-wr01-wr09/SUMMARY.md` (fix pass)

### Schema and deploy are separate steps
The autopilot function was deployed to staging with `schema.sql` already applied. CI `deno` was added after a `deno check` failure, because the Node suite never type-checked `index.ts`.

**Context:** Each deploy must match the schema version. `deno check --node-modules-dir=auto` is required for `npm:` specifiers.
**Source:** 04-REVIEW.md; `.github/workflows/test.yml` (deno job)

## Patterns

### Parity tests against classic-script `catalog.js`
Pure ES modules in `supabase/functions/autopilot/` are tested against the browser `catalog.js` for the id rule and other shared logic.

**When to use:** When server-side logic must match a client-side classic script that cannot be imported.
**Source:** 04-02-SUMMARY.md (patterns)

### Gate over untrusted LLM output, verbatim check
Every extracted number, label and quote must appear verbatim in the fetched page or in a cited text. Otherwise it is dropped. Titles come from a fixed map. Categories come from a fixed enum.

**When to use:** Any pipeline that turns scraped or LLM text into proposals.
**Source:** 04-08-SUMMARY.md, 04-CONTEXT.md (ENG-07 carried forward)

### Degrade missing config to skipped notes, never failures
An empty `dealer_price_urls` or held domain becomes a `notes.skipped` entry. A failed optional stage (for example NHTSA complaints) becomes a skipped note, so the run still completes.

**When to use:** Optional data sources in a monthly batch job.
**Source:** 04-06-SUMMARY.md, 04-08-SUMMARY.md

### Plan-driven `sw:version` regeneration
After any `src` change, run `npm run sw:version`. The precache test fails otherwise, because `CACHE` is a content hash.

**When to use:** Every commit that touches precached files.
**Source:** 04-05-SUMMARY.md (Deviations, Rule 3); 04-09-SUMMARY.md

### Owner-gated checkpoint plan
Plan 04-10 was written as a runbook (committed) with the live steps left to the owner. The verifier reports `human_needed` until the owner runs them.

**When to use:** Any step that needs live credentials, paid calls or staging DB writes.
**Source:** 04-10-PLAN.md, 04-VERIFICATION.md, ROADMAP.md

## Surprises

### Dealer price page is unreachable from the sandbox
`www.mazda.com.sa` returned ENOTFOUND. The apex resolves, but `robots.txt` returns HTTP 500. The smoke fails closed by design, so dealer prices stay manual.

**Impact:** The PRT-02 dealer branch cannot be verified live. Owner must re-run `smoke.mjs --ppl` from a working network.
**Source:** 04-03-SUMMARY.md; 04-VERIFICATION.md (W-03)

### `supabase secrets list` prints secret values
Running it exposed `INTAKE_CRON_SECRET`, `ANTHROPIC_API_KEY` and the service-role key in the session output.

**Impact:** All three must be rotated by the owner. Avoid this command in shared sessions.
**Source:** Session record (secrets list incident); owner rotation pending in 04-VERIFICATION.md

### Schema apply and seed apply were denied by the auto-mode classifier
The owner had to explicitly allow both. The `alter database ... set app.autopilot_url` step was also denied for the API role.

**Impact:** Some staging setup can only be done by the owner in the SQL editor or dashboard. Plan for that in the runbook.
**Source:** Session record; `supabase/functions/autopilot/README.md` (runbook, 72e9e8e)

### Integration checker first run failed on network
The integration-checker agent failed with ENOTFOUND on the API and passed on retry.

**Impact:** Transient network errors in agent runs are normal. Retry once before treating it as a finding.
**Source:** Session record

### Community-only proposals could reach high confidence
After the F7 change, a proposal backed only by community tier could score high.

**Impact:** The security review caught it. `proposal_confidence` now caps community-only at medium.
**Source:** git history `abf2810`; 04-SECURITY.md
