# Phase 2: Proposal Gate & Review Queue - Research

**Researched:** 2026-11-05
**Domain:** Postgres approval gate (tables, RLS, security-definer RPCs) + vanilla-JS admin review UI
**Confidence:** HIGH on codebase fit (read the real schema, admin.js, tests); MEDIUM on confidence-rule thresholds (design choice, not verifiable)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Queue layout
- Table rows, one per proposal: car, kind, before to after, confidence badge, run.
- Tapping a row expands the before/after diff and the source links with verbatim quotes inline.
- Filters above the table: car, kind, confidence, run (REV-01).

## Approve and stale values
- Approve is refused when the live row changed since the proposal was made (CORE-02). The message shows the current live value.
- The owner then rejects or edits the proposal against that value. Nothing is overwritten silently.
- The owner can edit a proposed value before approving (REV-04).

## Reject and suppression
- Reject takes an optional reason (REV-05).
- A rejected value is not re-queued unless its sources change (CORE-03).

## Supersede
- A newer proposal for the same target supersedes the older pending one (CORE-04). Behaviour not discussed further; planner decides the mechanics and keeps it inside the same transaction as the insert.

## Bulk approve and revert
- High-confidence means the top confidence tier only (REV-02).
- Bulk approve asks for one confirmation showing the count. One failing item does not abort the rest.
- Revert needs no confirmation. Each revert is recorded as a new audited change in the change log (REV-06, CORE-05) and can itself be reverted.

## Security (from roadmap success criterion 5)
- Scraped and LLM text renders only through the escaping `html` template (REV-09).

### Claude's Discretion
Supersede mechanics; confidence rule weights; table/column design; seed approach; where new files live; revert drift policy.

### Deferred Ideas (OUT OF SCOPE)
- Autopilot generation of proposals (Phases 3-4).
- Per-source domain bans (ENG-06, Phase 3).
- Owner-facing change-log browser beyond the revert action (not in phase 2 roadmap).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORE-01 | Generic `proposals` table, autopilot cannot write live | Schema section; RPC-only writes, no direct grants |
| CORE-02 | `apply_proposal` only live writer, transactional, stale refusal | `base_hash` optimistic lock, returns `{ok:false,error:'stale',live}` |
| CORE-03 | No duplicate queueing; rejected value not re-proposed | `submit_proposal` with `after_hash` + `sources_hash` suppression |
| CORE-04 | Newer proposal supersedes older pending | Supersede inside `submit_proposal` transaction + partial unique index |
| CORE-05 | Change log (who, when, before, after) | New `change_log` written by apply/revert functions |
| CORE-06 | `makers` table, no Mazda literals in pipeline logic | `makers` + `maker_id` columns; grep test |
| CORE-07 | Units/currency explicit, converted in code | Canonical payload contract + `units.mjs` + submit-time validation |
| REV-01 | Filter by car, kind, confidence, run | Client-side filter over one bounded fetch |
| REV-02 | Bulk approve high-confidence, failures isolated | `apply_proposals` with per-item subtransaction, server re-checks tier |
| REV-03 | Diff, sources + verbatim quote, rule-based badge | Stored `confidence_tier` + `confidence_factors`; evidence rendering rules |
| REV-04 | Edit before approve | `p_edit` validated/clamped in SQL; `edited_after` stored |
| REV-05 | Reject with reason | `reject_proposal` stores reason + hashes |
| REV-06 | One-click revert, audited | `revert_change` writes a new `change_log` row |
| REV-09 | Scraped text inert | `html`/textContent only, https-only hrefs, injection fixtures test |
</phase_requirements>

## Summary

Phase 2 is a direct generalisation of what already exists: `plan_drafts` + `decide_plan_draft` (schema.sql:767-826) is the template for `proposals` + `apply_proposal`; the `dealer_plan_item_change` trigger (schema.sql:674-697) already logs updates and bumps `car_models.plan_updated_at`, which is what makes devices refetch via `remote-catalog.refresh()`. So the user-visible path (SC2) needs no client change: write `dealer_plan_items` inside the RPC and devices pick it up. [VERIFIED: codebase grep/read]

No new npm packages, no new external services. All work is SQL in `supabase/schema.sql`, one new SQL test file wired into `.github/workflows/test.yml` (enforced by `test/rls-coverage.test.js`), extensions to `src/data/admin.js`, a new page script, and node tests. Only one proposal kind is applicable to a live table today (`schedule_item` -> `dealer_plan_items`); `apply_proposal` must dispatch by kind and raise `unsupported kind` for others so Phases 3-4 add handlers without changing the gate.

**Primary recommendation:** Build the gate in SQL first (tables, `submit_proposal`, `apply_proposal`, `apply_proposals`, `reject_proposal`, `revert_change`, `change_log`, `makers`), prove it with a `supabase/tests/proposals.sql` test, then build the UI on thin RPC wrappers. The browser never inserts or updates `proposals`; it only selects and calls RPCs.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Approval gate / stale check / supersede / suppression | Database (security-definer RPC) | — | Must be transactional and un-bypassable; client code is untrusted |
| Confidence tier | Database (computed in `submit_proposal`) | Browser (display only) | Filter + bulk-approve server re-check need one source of truth |
| Change log + revert | Database | Browser (button) | Revert must be atomic with the log row |
| Queue table, filters, expand, edit form | Browser | — | Pure presentation over one bounded fetch |
| Escaping of scraped text | Browser (`html` template) | DB length/shape caps | Defence in depth: DB limits size, UI escapes |
| Unit/currency conversion | Code (`units.mjs`, JS) | DB validates canonical fields | LLM never converts (CORE-07) |
| User sees new data | Existing `remote-catalog.js` | DB trigger bumps `plan_updated_at` | No change needed |

## Standard Stack

No new libraries. Use what is there. [VERIFIED: package.json, CLAUDE.md]

| Tool | Version | Purpose |
|------|---------|---------|
| Postgres plpgsql (Supabase) | existing | tables, RLS, RPCs |
| `node --test` + linkedom | Node >=22 | unit/render tests (pattern: `test/admin-errors-render.test.js`) |
| `supabase/tests/*.sql` via psql in CI `rls` job | existing | RLS + RPC behavioural tests |
| `html`/`raw` in `src/ui/html.js` | existing | escaping |

### Package Legitimacy Audit
No external packages are installed in this phase. slopcheck not applicable. Packages removed: none. Packages flagged: none.

## Architecture Patterns

### Data flow
```
Phase 3/4 worker (service_role) --submit_proposal(...)--> proposals (pending)
Seed script (owner psql) ---------submit_proposal(...)-->     |
                                                              v
Admin browser --select (RLS is_admin)--> queue table (filters client-side)
      | row tap: expand diff + evidence (escaped)
      +--rpc apply_proposal(id, edit?) --> [lock proposal FOR UPDATE]
      |        stale? -> return {ok:false,error:'stale',live}   (no writes)
      |        else -> write dealer_plan_items (existing trigger -> dealer_plan_changes + plan_updated_at)
      |                 + insert change_log + mark proposal approved
      +--rpc apply_proposals(ids, 'high') --> loop, subtransaction per item, jsonb result array
      +--rpc reject_proposal(id, reason) --> status rejected, reason, after_hash, sources_hash
      +--rpc revert_change(change_id) --> restore before / delete, new change_log row (reverts_id)
User app: remote-catalog.refresh() sees new plan_updated_at + rows
```

### Recommended structure
```
supabase/schema.sql                 # append: makers, proposals, change_log, functions, RLS (re-runnable)
supabase/tests/proposals.sql        # new; add to test.yml allowlist (rls-coverage test fails otherwise)
supabase/seed-proposals-demo.sql    # manual owner seed, NOT in CI
supabase/functions/_shared/units.mjs# pure km/miles + SAR/VAT/pack helpers (Phase 3 imports it)
src/data/admin.js                   # extend: listProposals, applyProposal, applyProposals, rejectProposal, revertChange, confidenceLabel
src/pages/admin-proposals.js        # new page script (admin.js is already 273 lines)
test/admin-proposals-*.test.js      # data + render + injection
```
Adding a script: add to `index.html` (before `main.js`, after `admin.js`), to `sw.js` ASSETS, then run `npm run sw:version` (CACHE is now a content hash; `test/precache.test.js` and `sw-version.test.js` fail otherwise). `test/no-raw-templates.test.js` auto-scans every file in `src/pages`, so the new page is covered for free. [VERIFIED: tools/sw-version.js, 01-VERIFICATION.md]

### Schema (prescriptive)

`makers(id text pk, name text unique not null)` seed `('mazda','Mazda')`; RLS: select to anon+authenticated, writes admin-only. `alter table car_models add column if not exists maker_id text references makers`, backfill `from make`. Keep `make` column (compatibility). New SQL/JS pipeline code must contain no `'Mazda'` literal (CORE-06); add a test that greps the new function bodies and `admin-proposals.js` / `units.mjs`.

`proposals`:
- `id bigint identity pk`, `run_id bigint` (no FK now; Phase 3 adds `autopilot_runs` and the FK), `kind text not null`, `maker_id text not null references makers`, `car_model_id text references car_models on delete cascade`, `target_key text not null` (service name for `schedule_item`), `op in ('insert','update','delete')`.
- `before jsonb`, `base_hash text` (md5 of the compared live fields, null for insert), `after jsonb not null`, `after_hash text not null`, `evidence jsonb not null` (array, 1..10 items: `{url, tier, fetched_at, content_hash, quote}`), `sources_hash text not null`.
- `confidence_tier text check in ('high','medium','low')`, `confidence_factors jsonb`, `reason text`.
- `status in ('pending','approved','rejected','superseded','stale')` (stale = refused at approve time and left pending? see Pitfall 2; recommend NOT changing status on a stale refusal, keep `pending` so owner can edit/reject).
- `created_at`, `decided_by`, `decided_at`, `edited_after jsonb`, `reject_reason text`.
- `create unique index proposals_one_pending on proposals (kind, coalesce(car_model_id,''), target_key) where status = 'pending'`.
- RLS: `enable row level security`; `revoke all from anon, authenticated`; `grant select to authenticated`; one policy `using (public.is_admin())` for select. No insert/update/delete grants. Regex in rls-coverage requires `create table if not exists public.<name>` literal form plus `alter table public.<name> enable row level security`. [VERIFIED: test/rls-coverage.test.js]

`change_log(id, made_at default now(), made_by uuid default auth.uid(), kind, car_model_id, table_name, row_key, op, before jsonb, after jsonb, proposal_id, reverts_id references change_log)`. RLS admin select only; no write grants; written only inside the security-definer functions. Keep existing `dealer_plan_changes` trigger as is (it still fires; harmless duplicate, and it bumps `plan_updated_at`).

### Functions (all `security definer set search_path = public`, first line `if not public.is_admin() then raise exception 'admin only'` except `submit_proposal`)

- `submit_proposal(...)` : callable by service_role/owner only (`revoke execute ... from public, anon, authenticated`). In ONE transaction: validate shape/size (evidence count <=10, quote <=500 chars, `after` <=8 KB, kind known, `after` units canonical); compute `after_hash`, `sources_hash` (md5 of sorted evidence `content_hash`/url list), confidence; then
  1. no-op if live row already equals `after`;
  2. no-op if a pending proposal exists with same `after_hash` (return its id);
  3. no-op if a rejected proposal exists with same (kind, car, target, `after_hash`) AND same `sources_hash` (CORE-03; different sources = allowed through);
  4. `update ... set status='superseded' where pending same target` then insert the new row. Order matters with the partial unique index: supersede first, then insert, same transaction (CORE-04). Return `{id, action:'inserted'|'duplicate'|'suppressed'|'noop'}`.
- `apply_proposal(p_id, p_edit jsonb default null)`: `select ... for update` the proposal where `status='pending'`; lock the live row `for update`; recompute live hash; if `<> base_hash` (or insert but row exists) -> **return** `{ok:false,error:'stale',live:<current fields>}` with no writes; else validate/clamp `coalesce(p_edit, after)` (copy clamps from `decide_plan_draft`: km 0..1,000,000, months 0..240, note `left(...,300)`, parts must be a jsonb array, <=50 entries, each name/part_no length-capped) and upsert; insert `change_log` (before/after of the compared fields); mark approved with `edited_after = p_edit`. Returns `{ok:true, change_id}`.
- `apply_proposals(p_ids bigint[], p_tier text)`: for each id re-select; skip with `{id, ok:false, error:'not_high'}` if `confidence_tier <> p_tier` or not pending; call `apply_proposal` inside `begin ... exception when others then` so one failure rolls back only that item (plpgsql exception block = subtransaction). Returns jsonb array. The count in the UI confirmation comes from the filtered list but the server is authority. [CITED: postgresql.org plpgsql-control-structures "Trapping Errors"]
- `reject_proposal(p_id, p_reason)`: status `rejected`, store reason (<=300 chars), keep `after_hash`/`sources_hash` for suppression.
- `revert_change(p_change_id)`: load change; refuse `{ok:false,error:'already_reverted'}` if a log row has `reverts_id = p_change_id`... NO: a revert can itself be reverted, so "already reverted" = the latest change on that row_key is not this one. Policy (recommended, flag A2): refuse with `{error:'drifted', live}` if the live row's compared fields no longer match `change.after` (a later change exists; revert that first). Else: op update -> restore `before` fields; op insert -> delete row; op delete -> re-insert from `before` (new identity id; match by natural key `car_model_id + service`, never by `dealer_plan_items.id`). Insert a new `change_log` row with `reverts_id`, `before`/`after` swapped. Reverting a revert works generically because it is just another change row.

### Confidence rule (CORE/REV-03, Claude's discretion; weights are ASSUMED)
Computed in SQL inside `submit_proposal`, stored as tier + factors so the badge can explain itself and filters/bulk are server-consistent. Suggested scoring: best source `tier` ('official'=2, 'secondary'=1, 'community'=0) + 1 if >=2 distinct evidence domains + 1 if change small (relative change <=25% on numeric fields) - 1 if change large (>50%) ; tier `high` when score >=3, `medium` 2, else `low`. Evidence `tier` is supplied by the submitter (Phase 3 classifies domains; Phase 2 seeds set it). LLM self-scores are out of scope (REQUIREMENTS).

### Units contract (CORE-07)
Canonical stored fields only: distances `interval_km` (int km), `interval_months`; money `price_sar` (numeric, excl. nothing hidden: carry `vat_included boolean` and `pack_qty int`, price stored per single unit). Original figures (`{value, unit}`) live in evidence for audit. `units.mjs` exports pure `milesToKm`, `perUnitSar` etc.; `submit_proposal` rejects `after` containing `distance_unit` other than `km` or `currency` other than `SAR`. Phase 2 only exercises km; keep helper tiny and unit-tested.

### UI pattern
- Extend `adminTabs` list; recommend a new `Proposals` tab (badge = pending count) placed first, leaving the legacy "Review queue" (plan_drafts, recalls) untouched so `admin-review*.test.js` keep passing; legacy cutover is Phase 3/8 of the architecture plan. Planner may instead embed above the legacy queue; do not delete the legacy code.
- One bounded fetch: `proposals` where `status='pending'`, `order created_at desc`, `limit 500` (same DoS-cap idea as `ERR_LIMIT`), plus `listModels()` for car labels. Filter in memory with pure functions in `admin.js` (`filterProposals(rows, {car, kind, tier, run})`), unit-tested. Filter option lists come from the data.
- Row: `el('div','item')` built with `html` template; tap toggles an expanded panel (diff via existing `draftDiff` style `before -> after`, evidence list, Edit/Approve/Reject buttons). Buttons use `onAsyncClick`, never-rejecting data functions return `{ok,...}` like `listErrors`/`resolveGroup`.
- Stale refusal: show `t('Live value changed')` + current live value from `res.live`; offer Reject or Edit (edit form prefilled from live, so the owner edits against the live value; note the edit still needs a fresh `base_hash`: see Pitfall 2).
- Bulk: button "Approve N high-confidence" (N = filtered rows with tier high) -> `confirm`-style single prompt showing the count (use `src/ui/modal.js` if it has a confirm; check before building), then `apply_proposals`; show "X approved, Y failed" with failures listed.
- Revert: where is revert reachable without a change-log browser (deferred)? Recommend an "Approved" sub-list (last 30 `change_log` rows where `reverts_id is null or reverts_id is not null`) under the Proposals tab with a Revert button per row. This is the minimum surface for REV-06; it is not a browser of the log.
- Edit form: reuse `parseParts`/`formatParts`/`num` from `admin.js`. Send only the edited object as `p_edit`; the server clamps.

### Anti-patterns
- Browser doing `from('proposals').update(...)` (breaks the gate; there is no grant for it by design).
- Trusting `esc()` for URLs: it escapes quotes, not schemes. A `javascript:` href survives. Always require `/^https:\/\//` and parse with `new URL`.
- Matching live rows by `dealer_plan_items.id` in revert (changes on delete/re-insert).
- Setting stale status on refusal and losing the proposal (owner then cannot edit it).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Escaping | custom sanitiser | `html` template / `textContent` | enforced by `no-raw-templates` test |
| Optimistic lock | version columns on live tables | md5 of `jsonb` of compared fields | Postgres jsonb text output is key-order-stable; works for seed and apply identically |
| Batch isolation | client loop of RPCs | plpgsql exception block per item | atomic, one round trip, server re-checks tier |
| Change log on live tables | extra triggers | explicit `change_log` insert in the two writer functions | only these functions may write live rows from proposals |
| Cache refresh for users | new sync mechanism | existing `plan_updated_at` trigger + `remote-catalog.refresh` | already works |
| Admin check | JWT claim parsing | `public.is_admin()` | existing, used by every policy |

## Common Pitfalls

### 1. `javascript:` / non-https links from scraped data
**What goes wrong:** quote/source URL rendered as `<a href>` executes script on click.
**How to avoid:** render link only if `/^https:\/\//i.test(url)` and `new URL()` parses; show hostname as link text; `rel="noopener noreferrer" target="_blank"`. Also DB: `check (url ~ '^https://')` enforced in `submit_proposal` per evidence item.
**Warning signs:** a fixture with `javascript:alert(1)` yields an `href` starting `javascript`.

### 2. Stale refusal vs edit loop
**What goes wrong:** the owner "edits against live value", but `base_hash` still equals the old hash, so approval is refused forever.
**How to avoid:** on stale refusal return the live fields; `apply_proposal` accepts `p_edit` plus `p_rebase boolean default false`: when true and the caller supplied an edit, recompute `base_hash` from the current live row after the owner has seen it (the UI only offers rebase from the stale message, which showed the live value). Alternative with less surface: edit/reject only, and a later submit re-proposes. Planner picks; recommend rebase flag since CONTEXT says "owner then rejects or edits the proposal against that value".
**Warning signs:** SQL test "edit after stale approves" fails.

### 3. Supersede vs unique index ordering
Insert before superseding violates `proposals_one_pending`. Supersede first in the same function. Concurrent submits: `pg_advisory_xact_lock(hashtext('proposal:'||kind||car||target))` to serialize.

### 4. Bulk approve acting on a stale client list
Client sends ids from a filtered view that is minutes old. Server re-checks `status='pending'` and `confidence_tier`; returns per-id result; UI refetches after.

### 5. Revert after later change clobbers newer data
See drift policy in `revert_change` (A2). Test: approve A, approve B on same target, revert A is refused; revert B then A works.

### 6. security definer + `auth.uid()`
`change_log.made_by default auth.uid()` still resolves the caller inside security-definer functions (as `decide_plan_draft` relies on). Test as authenticated admin, not as owner role, or the test passes vacuously (bypasses RLS and `is_admin`). Follow `app-errors-rls.sql` pattern: `set local role authenticated` + `set_config('request.jwt.claims', ...)`.

### 7. Seed shipping fake data to users
A seed proposal targeting a real approved car becomes real if approved. Seed against a draft demo car (see Seed) so approval is invisible to the public.

### 8. SQL re-runnability and CI order
schema.sql runs fresh in CI then `seed-catalogue.sql`. New objects need `create ... if not exists` / `create or replace` / `drop policy if exists`. `alter table car_models add column maker_id` backfill must run after seed in CI? The seed inserts car_models without `maker_id`; make the column nullable and backfill in schema.sql AND add a `maker_id` fill in the seed generator or a trigger defaulting from `make`. Simplest: `before insert` trigger on car_models sets `maker_id` from `lower(make)` when null. [ASSUMED approach; verify seed idempotency test `seed-catalogue.test.js` still passes]

## Code Examples

### Stale check core (plpgsql sketch)
```sql
-- fields compared = what a proposal can change
live_hash := md5(jsonb_build_object(
  'interval_km', i.interval_km, 'interval_months', i.interval_months,
  'note', i.note, 'parts', i.parts)::text);
if live_hash is distinct from p.base_hash then
  return jsonb_build_object('ok', false, 'error', 'stale', 'live', to_jsonb(i) - 'id');
end if;
```

### Per-item isolation in bulk
```sql
foreach pid in array p_ids loop
  begin
    res := public.apply_proposal(pid, null);   -- may return {ok:false,...} or raise
  exception when others then
    res := jsonb_build_object('ok', false, 'error', 'failed', 'detail', sqlerrm);
  end;
  out := out || jsonb_build_array(res || jsonb_build_object('id', pid));
end loop;
```

### Safe evidence rendering (browser)
```js
// quote and url are untrusted. html`` escapes text; the scheme check covers href.
function evidenceLine(ev) {
  let host = '';
  try { const u = new URL(ev.url); if (u.protocol === 'https:') host = u.hostname; } catch (e) {}
  const link = host ? html`<a href="${ev.url}" rel="noopener noreferrer" target="_blank">${host}</a>` : html`<span class="muted">${t('Invalid source link')}</span>`;
  return html`<blockquote>${String(ev.quote || '').slice(0, 500)}</blockquote>${link}`;
}
```

### Injection fixture test shape
Follow `test/admin-errors-render.test.js` (`bootApp` + supabase stub with `rpc`, `from().select().eq()...`). Fixture strings: `<img src=x onerror="alert(1)">` in service/target, before/after note, quote, reason; `javascript:alert(1)` and `https://a.test/"><script>` as url. Assert `#view img`, `#view script` null and no `a[href^=javascript]`, and text contains the literal payload. The stub's `from` chain must support whatever methods the new query uses (`in`, `neq`, `limit`).

## Seed (success criterion 1)
`supabase/seed-proposals-demo.sql` (manual, not in CI): inserts a draft `car_models` row `demo:seed` (status `draft`, invisible to public via `read_car_models`), 2-3 `dealer_plan_items`, then calls `submit_proposal` for 5-6 proposals spanning: high/medium/low tiers, two run ids, one insert, one injection payload, one superseding pair, one that will go stale (edit the live row after seeding). Because draft-car items are public-invisible, SC2's "user app shows new data" is proven in `proposals.sql` (live row changed, `plan_updated_at` advanced, anon select of an approved car sees it) and by one optional manual step: owner approves a proposal against an approved real car. Flagged as Open Question 1.

## State of the Art
| Old | Current | Impact |
|-----|---------|--------|
| `plan_drafts` + `decide_plan_draft` (schedule only) | generic `proposals` + `apply_proposal` | keep legacy until Phase 3 cutover; do not migrate now |
| per-table bespoke change triggers | explicit `change_log` rows from the writer functions | needed for `proposal_id` and revert linkage |

## Assumptions Log
| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Confidence weights/thresholds (official=2, 2+ domains +1, small change +1, large -1, high >=3) | Confidence rule | Owner sees too many/few "high"; cheap to retune since it is one SQL function |
| A2 | Revert refuses when live row drifted from `change.after` | revert_change | Owner may prefer force-revert; CONTEXT says no confirmation, silent on drift |
| A3 | Stale refusal keeps status `pending`; `p_rebase` flag for edit-against-live | Pitfall 2 | Alternative designs change SQL signature only |
| A4 | New "Proposals" tab rather than embedding in legacy Review queue | UI | Planner/owner may want one tab; trivial to merge |
| A5 | `run_id` plain bigint without FK until Phase 3 | Schema | Phase 3 must add FK (`not valid` then validate) |
| A6 | `maker_id` filled by trigger so seed stays unchanged | Pitfall 8 | Seed regenerator may need change instead |
| A7 | plpgsql `exception` block behaves as per-item savepoint in a Supabase RPC call (standard PG semantics) | apply_proposals | Verified by the SQL test, which must include a failing item mid-batch |

## Open Questions (RESOLVED)
1. **Seed target:** draft demo car (safe, but SC2 user-visible step is manual/SQL-tested) vs real approved car (end-to-end but pollutes live data on approval). Recommend draft demo car.
   RESOLVED: plans 02-02 Task 3 seed the draft car `demo:seed`; SC2 proven by proposals.sql case f; real-car check is optional in 02-06.
2. **Modal confirm:** check `src/ui/modal.js` for an existing confirm helper before building the bulk confirmation (not read in this research).
   RESOLVED: `modal.js` has no confirm helper; plan 02-04 builds the confirm inline with `openModal`.
3. **Can SQL tests run?** Phase 1 verification says no Docker/psql locally; `proposals.sql` will only be proven by the CI `rls` job. Plan for CI-only verification, and keep logic testable in JS where possible (filter, confidence label, diff, units).
   RESOLVED: plans 02-01 and 02-06 rely on the CI `rls` job; pure logic lives in JS (filters, units.mjs).

## Environment Availability
| Dependency | Required By | Available | Fallback |
|------------|------------|-----------|----------|
| Node >=22 / `node --test` | JS tests | yes (project standard) | — |
| psql / Supabase local | `supabase/tests/proposals.sql` | not locally (per 01-VERIFICATION) | CI `rls` job is the runner |
| Supabase project (owner applies schema.sql by hand) | production rollout | owner action | — |

## Validation Architecture
Skipped: `workflow.nyquist_validation` is `false` in `.planning/config.json`. Practical notes for the planner: JS tests run with `npm test` (`node --test "test/**/*.test.js"`); new SQL test must be listed in `.github/workflows/test.yml` (rls-coverage enforces); run `npm run sw:version` after adding the page script.

## Security Domain

| ASVS Category | Applies | Control |
|---------------|---------|---------|
| V2/V3 Auth/Session | no (existing Supabase auth) | — |
| V4 Access Control | yes | RLS select admin-only, no write grants, `is_admin()` first line of every RPC, `revoke execute from anon` (and `public`) |
| V5 Input Validation | yes | size/shape caps in `submit_proposal` and clamps in `apply_proposal`; https-only URLs |
| V6 Cryptography | no | md5 is a change fingerprint, not a security control |

| Threat | STRIDE | Mitigation |
|--------|--------|------------|
| XSS via scraped text / `javascript:` URL | Tampering/EoP | `html` template, textContent, https-only href, injection fixtures |
| Non-admin calling RPC | EoP | `is_admin()` check + revoke from anon; SQL test as plain user |
| Autopilot writing live tables | Tampering | proposals-only RPC; no table grants; Phase 3 adds a grep CI test on worker sources (service_role bypasses RLS so structure is by code review + test) |
| Oversized payload DoS | DoS | caps on evidence count, quote length, `after` bytes, 500-row fetch limit |
| LLM-supplied unit/currency | Tampering | canonical-field validation; conversion only in `units.mjs` |
| Bidi/control characters in quotes hiding content | Spoofing | optional: strip U+202A-202E, U+2066-2069 at display (LOW priority) |

## Project Constraints (from CLAUDE.md)
- Vanilla JS, no build step, no ES modules in the browser, must work from `file://`; classic scripts, dual-mode data modules.
- Every new table: RLS. Untrusted web/LLM text only through escaping `html` template.
- Approval gate: autopilot writes only pending rows, never live tables.
- Style: `'use strict'`, 2-space, single quotes, semicolons, banner comment per file, comment the WHY; user strings via `t('...')` with Arabic entries in `src/i18n/strings.ar.js` (`strings-ar-unique.test.js` guards duplicates); RTL support.
- Data functions never reject: resolve `{ok:false,error}`.
- New script -> `index.html` order, `sw.js` ASSETS, `npm run sw:version`.
- `node --test` + Playwright; CI green incl. `node --check` on every shipped `.js/.mjs`.
- GSD workflow: make edits only via GSD commands.
- AGENTS.md car-image rules (not relevant here).

## Sources
### Primary (HIGH, read in this session)
- `supabase/schema.sql` (plan_drafts, decide_plan_draft, triggers, app_errors patterns), `src/data/admin.js`, `src/pages/admin.js`, `src/ui/html.js`, `src/data/remote-catalog.js`
- `test/rls-coverage.test.js`, `supabase/tests/app-errors-rls.sql`, `test/admin-errors-render.test.js`, `.github/workflows/test.yml`
- `.planning/research/ARCHITECTURE.md` (proposals/apply/revert design this phase implements), `.planning/research/PITFALLS.md`
### Secondary (MEDIUM)
- PostgreSQL docs on plpgsql exception blocks (standard subtransaction semantics; from knowledge, confirmed by SQL test requirement)
### Tertiary (LOW)
- Confidence weights (design judgement)

## Metadata
**Confidence breakdown:** stack HIGH (nothing new); architecture HIGH (extends existing proven pattern); pitfalls HIGH (grounded in code); confidence scoring MEDIUM (assumed weights).
**Research date:** 2026-11-05 | **Valid until:** 30 days
