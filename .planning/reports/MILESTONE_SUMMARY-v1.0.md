# Milestone v1.0 — Project Summary

**Generated:** 2026-11-11
**Purpose:** Team onboarding and project review
**Status:** Milestone not yet complete. Phases 1–3 code-complete; Phase 4 code-complete, owner live checkpoint (plan 04-10) pending. Audit verdict: `tech_debt` (see `.planning/v1.0-MILESTONE-AUDIT.md`).

---

## 1. Project Overview

**Car Care — Autopilot Catalogue** is an offline-first Mazda care PWA (vanilla HTML/CSS/JS, no build step, optional Supabase sync) used in Saudi Arabia. Users pick a model, generation and engine and get a matching maintenance schedule, parts with OEM and cheaper alternatives in SAR, a service history and a budget.

This milestone puts the catalogue on autopilot. Once a month the server finds changes to the 16 existing Mazda catalogue cars (schedules, recalls, parts, prices, community failures and alternatives) and new Mazda models, and queues every finding for owner review in `#admin`. **Core value:** nothing reaches users without the owner's explicit approval. Autopilot writes only to `proposals` and pending rows; only the admin `apply_proposal` path writes live tables.

Scope: Mazda only, Saudi/GCC-first sources. Photos (PHO-01/02) and other brands are v2.

**Progress:** 3 of 4 phases complete (Phase 4 at 9/10 plans; 04-10 is owner-gated).

---

## 2. Architecture & Technical Decisions

**Stack**
- Browser: vanilla JS classic scripts sharing one global scope; load order in `index.html`; dual-mode data modules (browser global + Node `require`). Runs from `file://`.
- Backend: Supabase (Postgres + RLS, Edge Functions on Deno, pg_cron). Autopilot function in `supabase/functions/autopilot/` (`index.ts` + pure `.mjs` logic: `flow.mjs`, `models.mjs`, `community.mjs`, `parts.mjs`, `extract.mjs`, `logic.mjs`). `read-bill` and `plan-intake` functions also live here.
- Tests: `node --test` (1053 passing), Playwright e2e, CI jobs `test`, `browser`, `deno`, `rls` (psql against `schema.sql`, seeds and `supabase/tests/*.sql`).

**Decisions**

- **Decision:** Autopilot writes only drafts/pending rows; `apply_proposal` is the only path to live tables.
  - **Why:** Core value; owner approves everything.
  - **Phase:** 2 (CORE-01, CORE-02).
- **Decision:** Hard monthly cost cap of SAR 40, checked before every paid call; over-cap run stops and publishes nothing partial.
  - **Why:** Owner wants low running cost; fail closed.
  - **Phase:** 3 (ENG-03, Phase 3 D-01/D-02).
- **Decision:** Cost metered per call from stored token and search counts times a configured price table; no provider billing API.
  - **Why:** Deterministic, testable spend.
  - **Phase:** 3 (Phase 3 D-04).
- **Decision:** Official sources found with the Anthropic web search tool from the edge function; Mazda Saudi/GCC domains are a hard preference.
  - **Why:** No second search vendor; owner wants KSA sources first.
  - **Phase:** 3 (Phase 3 D-05, D-06).
- **Decision:** New, unseen source domains are held for owner approval; banning a domain is permanent and rejects its pending proposals.
  - **Why:** Source trust is owner-controlled.
  - **Phase:** 3 (Phase 3 D-07, D-08).
- **Decision:** Every extracted number must appear verbatim in the fetched source text, else dropped.
  - **Why:** Blocks LLM invention.
  - **Phase:** 3 (ENG-07).
- **Decision:** Service-worker cache version is a content hash written into `sw.js`; background install, takeover on next launch; missing precache file does not abort install.
  - **Why:** No mixed old/new script set mid-session; no hand bumps.
  - **Phase:** 1 (Phase 1 D-17, D-18, D-20).
- **Decision:** CORS allowlist is the production origin only; `Origin: null` rejected; server-to-server cron calls keep working without `Origin`.
  - **Why:** Lock edge functions to the app; keep pg_cron calls working.
  - **Phase:** 1 (Phase 1 D-13, D-14, D-16).
- **Decision:** Error log is insert-only for anon, admin-readable, 90-day retention via pg_cron, no vehicle data or payloads stored.
  - **Why:** Visibility for the owner without leaking user data.
  - **Phase:** 1 (Phase 1 D-02, D-03, D-04).
- **Decision:** Approved parts and prices live in a server table (`catalogue_parts`); server value wins over `catalog.js`, which stays the offline fallback. Owner edits on a saved car are kept.
  - **Why:** Approved data reaches users without shipping code.
  - **Phase:** 4 (Phase 4 D-01, D-02).
- **Decision:** Fitment pinned per `car_model` id (`<modelId>:<engine-slug>`); a part checked on one engine never applies to another.
  - **Why:** Same bug class the engine prefix in `OEM_CHECKED` already guards.
  - **Phase:** 4 (Phase 4 D-04).
- **Decision:** OEM parts need the Mazda KSA dealer list as an official catalogue, or 2+ independent sources agreeing.
  - **Why:** Part-number accuracy.
  - **Phase:** 4 (Phase 4 D-05). Open: W-02.
- **Decision:** Price change proposed only if ≥10% and ≥5 SAR versus live; "indicative" label on non-dealer prices.
  - **Why:** Suppress noise; be honest about price sources.
  - **Phase:** 4 (Phase 4 D-07, D-08). Open: W-03.
- **Decision:** Common failure needs 3+ mentions across 2+ domains; user-price agreement needs 3+ distinct users with median ±30% trim.
  - **Why:** Anti-noise and privacy floor.
  - **Phase:** 4 (Phase 4 D-11, D-13). Privacy floor raised to 5 users for user-agreement aggregates (WR-08).
- **Decision:** Parts, prices and community stages rotate across cars; model detection runs once a month.
  - **Why:** Keep the whole run under the SAR 40 cap.
  - **Phase:** 4 (Phase 4 D-19).
- **Decision:** Source-independence host collapse uses `registrableHost` (shared-hosting subdomains collapse to platform), not the public suffix list.
  - **Why:** Matches the 2-host rule for shared hosts.
  - **Phase:** 4 (code review follow-up).

---

## 3. Phases Delivered

| Phase | Name | Status | Summary |
|-------|------|--------|---------|
| 1 | Reliable & Safe Foundation | human_needed | Error log and `#admin` Errors tab, CORS lock, shared `safeFetch`, resilient SW, RLS tests in CI, batched `plan-intake`. Live checks open. |
| 2 | Proposal Gate & Review Queue | passed | Proposals table and gate RPCs; review, edit, approve, reject, bulk approve, one-click audited revert. CI rls green. |
| 3 | Monthly Autopilot for Schedules & Recalls | human_needed | Cost-capped monthly run for all 16 cars; schedules (normal and severe), recalls, source-domain approval and ban, run report and banner. Live smoke waived. |
| 4 | Parts, Prices, Community & New Models | human_needed | OEM parts, indicative SAR prices, failures, alternatives, new-model detection; app overlay and "catalogue in progress" note. Code-complete; 04-10 live checkpoint pending. |

Phase 1 SUMMARY `requirements-completed` frontmatter is incomplete in some plans.

---

## 4. Requirements Coverage

Source: `.planning/REQUIREMENTS.md` traceability and the v1.0 audit (48 v1 requirements).

- ✅ **Satisfied (14):** CORE-01..07, REV-01..06, REV-09 (Phase 2, verified passed).
- ⚠️ **Partial (34):** code-complete and verified in code; live or human items open.
  - Phase 1 FND-01..11 — human checks: CI rls and SQL run, staging model and NHTSA, browser toast and error logger, SW missing-precache install, `#admin` Errors tab.
  - Phase 3 ENG-01..09, SCH-01..05, REV-07, REV-08 — live discovery smoke waived (assumption A4 unverified); cron and deploy not independently verified.
  - Phase 4 PRT-01..03, COM-01..03, NEW-01 — plan 04-10 owner live checks; W-06 open (number-less OEM rows).
- ❌ **Not met (0).**

Orphans: none. Unchecked in REQUIREMENTS.md: FND-01..11 (Phase 1 live items pending).

---

## 5. Key Decisions Log

Full per-phase decisions are in each `*-CONTEXT.md`. Highlights:

| ID | Decision | Phase | Rationale |
|----|----------|-------|-----------|
| P1-D-17/18 | SW background install, content-hash cache version | 1 | Avoid mixed script sets; no hand bumps |
| P1-D-13/14/16 | CORS allowlist, reject `Origin: null`, cron exempt via secret | 1 | Lock edge functions, keep pg_cron working |
| P1-D-02/03/04 | Error log insert-only, no payloads, 90-day retention | 1 | Owner visibility without user data |
| P2 | Stale refusal, change_log, one-click revert, suppression by hash | 2 | Core approval gate |
| P3-D-01/02 | SAR 40 cap, no partial publish | 3 | Low running cost, fail closed |
| P3-D-06/07/08 | GCC-first sources, held new domains, permanent ban | 3 | Source trust is owner's |
| P3-D-09/10 | Normal and severe intervals separate; never copy normal to severe | 3 | Jeddah severe conditions |
| P4-D-01/02 | `catalogue_parts` server table, server wins, catalog.js fallback | 4 | Ship approved data without code deploys |
| P4-D-04 | Fitment per engine id | 4 | No cross-engine part leakage |
| P4-D-05 | Mazda KSA dealer list as official catalogue; else 2 sources | 4 | Part-number accuracy |
| P4-D-07/08 | ≥10% and ≥5 SAR materiality; "indicative" label | 4 | Noise control, price honesty |
| P4-D-11/13 | 3+ mentions on 2+ domains; 3+ users with trim | 4 | Anti-noise, privacy |
| P4-D-19 | Rotating parts/prices/community stages | 4 | Fit the cap |

---

## 6. Tech Debt & Deferred Items

**Owner decisions (open)**
- W-01: banned marketplace seed (noon, Amazon.sa) — out of scope per REQUIREMENTS, confirm.
- W-02: official-catalogue branch / 2-host rule for part numbers.
- W-03: dealer prices labelled "indicative"? (SC2 wording).
- W-06: number-less OEM rows staged from one citation price.
- WR-10: second half of code review warnings.

**Live and ops (owner)**
- Plan 04-10 checkpoint: Check-now on one car, approve/revert one part, approve one car_model, EN/AR visual check. Then write `04-10-SUMMARY.md`.
- pg_cron settings on staging (`app.autopilot_url`, `app.autopilot_secret`) set in SQL editor.
- Rotate INTAKE_CRON_SECRET, ANTHROPIC_API_KEY and service-role key (exposed by `supabase secrets list`).
- `smoke.mjs --citations` optional; `--ppl` blocked by robots 500 on the dealer host.
- Staging `garage` project paused; reactivate in dashboard.
- Staging autopilot function not redeployed after simplify pass (`groupComplaints` signature).

**Verification gaps**
- SQL never run locally; only CI `rls` job validates it.
- Phase 3: A4 assumption (`web_search` header) unverified.

**Skipped refactors (simplify pass)**
- `setContributeSink` revert, `register()` call count, `seeDomain` grammar in SQL, `trimmedMedian` dead code, `requireUser` extraction, boot-time parts paging, sequential RPC batching.

**Code review info items**
- IN-01..IN-05 not addressed (skipped by instruction).

**Deferred to v2 / later**
- Photos (PHO-01/02), other brands (BRD-01), whole-run rollback, price history charts, source-disagreement panel.

---

## 7. Getting Started

- **Run the app:** open `index.html` directly (`file://` supported) or serve repo root statically.
- **Install and test:** `npm ci`; `npm test` (Node ≥22, `node --test`); `npm run test:e2e` after `npx playwright install chromium`.
- **Service worker version:** after changing precached files run `npm run sw:version`; a test fails on a stale hash.
- **Key directories:**
  - `src/data/` — dual-mode data modules (`remote-catalog.js`, `pricing.js`, `admin.js`, `session.js`, `storage.js`).
  - `src/pages/` — page renderers (`dashboard.js`, `parts.js`, `maintenance.js`, `admin*.js`).
  - `src/ui/html.js` — the only safe way to build HTML strings.
  - `supabase/schema.sql` — full DB schema, RLS, RPCs.
  - `supabase/functions/autopilot/` — monthly pipeline; `README.md` is the Phase 4 runbook.
  - `supabase/tests/*.sql` — RLS and pipeline SQL tests (CI `rls` job).
  - `.planning/` — GSD artifacts (ROADMAP, REQUIREMENTS, phase CONTEXT/PLAN/SUMMARY/VERIFICATION).
- **Where to look first:** `CLAUDE.md`, `.planning/PROJECT.md`, `.planning/v1.0-MILESTONE-AUDIT.md`, `supabase/functions/autopilot/flow.mjs` (pipeline stages), `supabase/schema.sql` (gates).
- **Rules to know:** every HTML string through the `html` template (enforced by `test/no-raw-templates.test.js`); new scripts must be added to `index.html` and `sw.js` `ASSETS`; car photo approval history in `docs/CAR-ASSET-GUIDE.md` must be followed.

---

## Stats

- **Timeline:** 2026-08-02 → 2026-11-11 (about 14 weeks)
- **Phases:** 3 complete, 1 code-complete with owner checkpoint pending / 4 total
- **Commits:** 666 on branch history (`git log --oneline | wc -l`)
- **Files changed (root commit → HEAD):** 498 (+65,307 / -1,320)
- **Contributors:** Ali Bashuaib (419 commits), alibashuaib (247 commits)
- **Milestone-tagged stats:** no `v1.0` tag; start boundary taken from git history.
