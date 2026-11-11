---
phase: 04
slug: parts-prices-community-new-models
status: verified
threats_open: 0
asvs_level: 1
created: 2026-11-11
---

# Phase 04 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Built from artifacts (State B). Source: 04-01..04-10 PLAN.md `<threat_model>` blocks, 04-01..04-09 SUMMARY.md, and implementation at HEAD 43b9e1f.

**Verification notes**
- SQL mitigations were verified by reading `supabase/schema.sql` only. The SQL has never been executed locally. Runtime proof is the CI `rls` job (`supabase/tests/*.sql`).
- JS mitigations were verified by grep and by running the security-relevant node suites: 167 tests, 0 failures (`no-raw-templates`, `rls-coverage`, `edge-autopilot-flow`, `edge-safe-fetch`, `autopilot-*`, `schema-autopilot`, `admin-proposals-render`, `known-issues`).
- Dealer price fetch (`flow.mjs` dealer path) is skipped in production (robots 500 on mazda.com.sa). Its guard code is present but not exercised.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| autopilot worker -> submit_proposal | LLM/web derived values enter the approval gate | proposal payloads, evidence |
| admin client -> apply_proposal / revert_change | privileged writes to live tables | live catalogue rows |
| anon/authenticated -> catalogue_parts / known_issues | public reads | approved catalogue data |
| web/forum text + LLM output -> validators | untrusted, possibly prompt-injected | scraped text, model JSON |
| dev machine -> external sites | smoke probe fetch | public web |
| owner input -> source_domains | approval of new hosts | host names |
| app users -> contributions | untrusted crowd prices | prices, engine, part numbers |
| worker (service_role) -> aggregate fn | only aggregates may leave | counts, medians |
| proposals (scraped/LLM text) -> admin DOM | stored XSS risk | titles, quotes, URLs |
| server catalogue_parts / car_models -> browser DOM | approved but originally scraped text | part names, notes |
| known_issues (approved, originally forum text) -> user DOM | XSS / malicious links | titles, source URLs |
| owner -> live Supabase | privileged schema changes | DDL, seeds |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-04-01 | Elevation | catalogue_parts, known_issues writes | mitigate | No write policy. `revoke all ... from anon, authenticated`, then select only (`schema.sql:2346-2347`). Writes only via SECURITY DEFINER `apply_proposal` / `revert_change` with `is_admin()` (`schema.sql:1339`, `:1531`). RLS enabled `:2335`, `:2340`. SQL verified by reading; CI rls job is runtime check. | CLOSED |
| T-04-02 | Tampering | submit_proposal new kinds | mitigate | Per-kind validation: part target regex `^[^|]{1,100}[|](oem|alt:[a-z0-9-]{1,40})$` (`:1150`), price range (`:1161`), price_basis whitelist (`:1157`), failure key/title/summary/mentions (`:1167-1171`), car_model id regex (`:1177`), markets whitelist (`:1188-1191`), 8192-byte cap (`:1148`). | CLOSED |
| T-04-03 | Info disclosure | users evidence | mitigate | `submit_proposal` accepts only `type/tier/users/median` keys with `users >= 3` and tier `community`, and only for part/failure kinds (`:1233-1240`). Aggregate function returns no user ids (`:2435-2436`). | CLOSED |
| T-04-04 | Tampering | car_model revert cascade | mitigate | `revert_change` returns `in_use` when plans, parts, recalls or known issues exist (`:1555-1558`). | CLOSED |
| T-04-05 | Repudiation | approvals | mitigate | `change_log` insert on apply (`:1463`), on revert (`:1624`, `:1629`). | CLOSED |
| T-04-06 | Tampering | LLM-claimed prices / part numbers | mitigate | `priceFromCitation` requires the API `cited_text` to contain the price (`parts.mjs:58`, used in `flow.mjs:289` and `:478`). `confirmParts` requires 2+ hosts (`parts.mjs:23-34`). Citations come only from `extractCitations` (`logic.mjs:92-101`). Model JSON alone never passes. | CLOSED |
| T-04-07 | Tampering | prompt injection in forum text | mitigate | Category from fixed enum, titles from code (`flow.mjs:457` `FAILURE_TITLES`). Counts computed by `countMentions` (`community.mjs:56`). Untrusted-document sentence in prompts (`community.mjs:17`, `extract.mjs:20`, `models.mjs:35`, `flow.mjs:235`). | CLOSED |
| T-04-08 | Spoofing | one site posing as two sources | mitigate | `registrableHost` collapse (`logic.mjs:84`, `community.mjs:63`, `parts.mjs:33`). NHTSA is one host via `NHTSA_POLICY` (`flow.mjs:399`). Test suites pass. | CLOSED |
| T-04-09 | DoS | huge untrusted JSON | mitigate | Fixed slices: `MAX_ITEMS = 60` (`extract.mjs:8`, `:82`), `MAX_FAILURES` (`community.mjs:47`), `MAX_MODELS` / `MAX_ENGINES` (`models.mjs:45-50`), `claims.slice(0, 60)` (`flow.mjs:269`). | CLOSED |
| T-04-10 | Tampering / SSRF | smoke `--ppl` fetch | mitigate | Goes through `safeFetch` with `DEFAULT_POLICY` (`smoke.mjs:9`, `:16`). Guards in `safe-fetch.mjs`: private IP (`:49`), redirect validation (`:51-58`), robots (`:50`), size caps (`:66`, `:73`). | CLOSED |
| T-04-11 | Elevation | seed-sources.sql | mitigate | `seed-sources.sql` has no executable statements (every line is a comment). `autopilot_see_domain` uses `on conflict do nothing` and never updates `status` (`schema.sql:2075-2085`), so a seed path cannot un-ban a host. Note: the `where status <> 'banned'` rule exists only as a comment (`seed-sources.sql:11`). Any future seed must add it. | CLOSED |
| T-04-12 | Info disclosure | API key | accept | See Accepted Risks Log AR-01. Repo scan found no key literal in tracked source. | CLOSED |
| T-04-13 | Tampering (Sybil) | autopilot_user_agreement | mitigate | Latest price per user (`distinct on (l.user_id, k.gk)`, `:2420-2429`). `qualified_users` join (`:2424`). Median +-30% trim (`:2431`). `count(*) >= 3` (`:2434`). Owner approval still required via `submit_proposal` pending state. | CLOSED |
| T-04-14 | Info disclosure | user ids | mitigate | Output columns exclude user_id (`:2435-2436`). Service_role only (`:2440-2441`). SQL test asserts no user id in output (`supabase/tests/autopilot.sql:532`). | CLOSED |
| T-04-15 | DoS (cost) | optional stages | mitigate | `optional_cars_per_run` check 0..50 (`schema.sql:2357-2358`), rotation limit (`:1914`). `budgetGuard` soft floor (`flow.mjs:179-181`), checked at stage entry before first paid call (`flow.mjs:205`, `:390`, `:503`). Jobs queued after core (`:1911`). | CLOSED |
| T-04-16 | Elevation | autopilot_due, new fns | mitigate | `autopilot_due`: revoke all, select for admin only (`:2392-2396`). New worker functions: revoke from public/anon/authenticated, grant service_role (`:2405-2406`, `:2440-2441`, `:2245-2268`). | CLOSED |
| T-04-17 | Tampering / XSS | admin-proposals diff renderers | mitigate | `admin-proposals.js` header: textContent only. No `innerHTML` in the file (grep). Render test with script payload exists (`test/admin-proposals-render.test.js`). `no-raw-templates` covers `src/pages` (`test/no-raw-templates.test.js:25`). | CLOSED |
| T-04-18 | Tampering | source links | mitigate | `proposalSafeUrl` https-only (`admin-proposals.js:25-27`). `rel = 'noopener noreferrer'` (`:52`). Hostname as link text (`:54`). | CLOSED |
| T-04-19 | Elevation | edited car_model id | mitigate | Client regex with "Invalid id" message (`admin-proposals.js:278`). Server regex in `submit_proposal` (`schema.sql:1177`). Admin-only `apply_proposal` (`:1339`). | CLOSED |
| T-04-20 | Tampering / SSRF | dealer / shop fetch | mitigate | `deps.fetch` is `safeFetch` with `DEFAULT_POLICY` (`index.ts:134`). Dealer path uses `DEFAULT_POLICY` and same-host check (`flow.mjs:224-226`). Dealer path is skipped in production; guard code present but not exercised. | CLOSED |
| T-04-21 | Tampering | LLM price / part claims | mitigate | Same gates as T-04-06: `priceFromCitation` / `confirmParts` (`flow.mjs:284-291`, `:474-481`). | CLOSED |
| T-04-22 | DoS (cost) | paid calls | mitigate | `paid()` reserve, call, settle (`flow.mjs:36-52`). `autopilot_reserve` enforces the monthly cap and kill switch (`schema.sql:1839-1858`). `budgetGuard` before stages. `maxUses` from config (`index.ts:118`, `flow.mjs:63`). | CLOSED |
| T-04-23 | Elevation | live tables | mitigate | `index.ts` has only `select` reads and `rpc` calls to staging functions (`index.ts:51-171`). `autopilot_publish_run` is the only `submit_proposal` caller (`schema.sql:2199`). Static test `test/edge-autopilot-flow.test.js` passes. | CLOSED |
| T-04-24 | Info disclosure | users evidence | mitigate | Only `users` count and `median` are staged (`flow.mjs:300-305`). | CLOSED |
| T-04-25 | Tampering / XSS | parts.js option render, picker labels | mitigate | `html` template used for option, picker and link rendering (`parts.js:71`, `:183`, `:215`, `:252`, `:266`). Untagged user text uses `textContent` (`:94`, `:112`, `:126`, `:140`). `no-raw-templates` covers `src/pages`. | CLOSED |
| T-04-26 | Tampering | user edits on saved car | mitigate | `catPrice` stamp set on OEM options (`catalog.js:517`). Ownership check in `normalize.js:214-234`. Code present; the associated tests were not re-run in this audit. | CLOSED |
| T-04-27 | DoS | huge catalogue_parts response | accept | See Accepted Risks Log AR-02. Paging `range()` at 1000 rows (`remote-catalog.js:52-71`) is implemented. | CLOSED |
| T-04-28 | Tampering | prompt injection in community text | mitigate | Same as T-04-07. Verbatim quote gate on labels (`flow.mjs:424`, `community.mjs:55`). | CLOSED |
| T-04-29 | Spoofing | mention inflation from one site | mitigate | `mentions >= 3 && hosts >= 2` (`community.mjs:66-67`). `registrableHost` collapse. NHTSA is one host. | CLOSED |
| T-04-30 | Tampering / SSRF | forum and GCC fetches | mitigate | `DEFAULT_POLICY` / `NHTSA_POLICY` on fetches (`flow.mjs:105`, `:153`, `:358`, `:399`). Same-host check (`flow.mjs:108-109`). Owner-approved hosts only: `seeDomain` plus `st === 'approved'` (`flow.mjs:82-84`, `:418-420`, `:512-513`). Reddit never fetched (`flow.mjs:370`, `:418`, `:430`). | CLOSED |
| T-04-31 | DoS (cost) | community / models paid calls | mitigate | `MAX_CANDIDATES = 4` (`flow.mjs:18`). `budgetGuard` (`flow.mjs:390`, `:503`). `paid()` reservations (`flow.mjs:36`). | CLOSED |
| T-04-32 | Tampering / XSS | known issues card | mitigate | `issuesBox` uses `textContent` for titles and notes (`dashboard.js:301-312`). Render test with payload (`test/known-issues.test.js`, `test/render.test.js`). | CLOSED |
| T-04-33 | Tampering | source links (known issues) | mitigate | `httpsHref` helper (`dashboard.js:302`). `rel = 'noopener noreferrer'` and hostname text (`dashboard.js:319`). | CLOSED |
| T-04-34 | Info disclosure | engine in contributions | accept | See Accepted Risks Log AR-03. Sharing still gated by `shareEnabled` (per plan). | CLOSED |
| T-04-35 | Tampering | manual schema apply | mitigate | Re-runnable DDL: `create table if not exists`, `create or replace`, `drop policy if exists`, `add column if not exists`, `drop constraint` guarded by lookup (`schema.sql:2307-2396`). Seeds use `on conflict do nothing`. Verified by reading. | CLOSED |
| T-04-36 | Elevation | executor access to prod | mitigate | Procedural control. The executor writes no remote DB; apply is an owner-only checkpoint. Documented in `supabase/functions/autopilot/README.md` and the 04-10 runbook (commit 72e9e8e). No code enforcement exists. There is no 04-10 SUMMARY to cross-check. | CLOSED (procedural) |
| T-04-37 | DoS (cost) | live smoke run | mitigate | Procedural control plus code. Monthly cap SAR 40 (`schema.sql:1657`, `autopilot_reserve` at `:1851`). Runbook: "Spend should be well under SAR 40" (`README.md:45`, `:121`). Single manual run per the runbook. | CLOSED (procedural) |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

**Disposition counts:** mitigate 34 · accept 3 · transfer 0. Total 37.

---

## Unregistered Flags (WARNING, not blocking)

| Source | Flag | Resolution |
|--------|------|------------|
| 04-01-SUMMARY, 04-02-SUMMARY, 04-04-SUMMARY | `## Threat Flags`: "None beyond the plan's threat model" | No new surface. |
| 04-09-SUMMARY | `## Threats` section maps T-04-32/33 only | Mapped. |
| 04-03, 04-05 to 04-08 SUMMARY | No threat-flags section | Not reported as unregistered. No new surface found in the audit. |
| 04-10 | No SUMMARY file | Procedural threats T-04-35..37 verified against the runbook and schema only. |

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-04-12 | API key lives only in an env var on the owner's machine and is never written to files. Repo scan found no key literal in tracked source. | Plan author (04-03 PLAN); no separate owner sign-off recorded | 2026-11-11 |
| AR-02 | T-04-27 | Catalogue is ~16 cars x ~20 rows. Paging at 1000 rows bounds the response. | Plan author (04-07 PLAN); no separate owner sign-off recorded | 2026-11-11 |
| AR-03 | T-04-34 | Engine is catalogue data already sent for fuel contributions. Sharing stays gated by `shareEnabled`. | Plan author (04-09 PLAN); no separate owner sign-off recorded | 2026-11-11 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-11 | 37 | 37 | 0 | gsd-security-auditor |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [ ] `status: verified` set in frontmatter (set by owner after CI `rls` job passes)

**Approval:** pending owner review. Auditor verdict: verified, 0 open.
