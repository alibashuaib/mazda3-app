# Requirements: Car Care — Autopilot Catalogue

**Defined:** 2026-11-05
**Core Value:** New and changed catalogue data (schedules, parts, prices, photos) arrives in the admin review queue automatically every month, and nothing is published to users without the owner's explicit approval.

## v1 Requirements

### Foundation

- [ ] **FND-01**: When a save or afterSave hook fails, the user sees a toast and the error is logged (no swallowed `catch (e) {}` on save paths)
- [ ] **FND-02**: Client errors and edge-function errors are recorded in a Supabase table the owner can read from `#admin`
- [ ] **FND-03**: Edge functions only accept browser requests from the deployed app origin (no `Access-Control-Allow-Origin: *`)
- [ ] **FND-04**: RLS SQL tests in `supabase/tests/*.sql` run in CI and fail the build on a policy regression
- [ ] **FND-05**: All server-side fetches of external URLs go through one shared `safeFetch` (per-hop redirect re-validation, DNS/private-IP check, byte/time caps, content-type allowlist, robots.txt), with tests
- [ ] **FND-06**: `vendor/supabase.js` version and hash are recorded and a test fails if the file changes without updating them
- [ ] **FND-07**: Service worker install succeeds even if one precache file is missing, and the cache version no longer needs a hand bump per release
- [ ] **FND-08**: Service worker serves modules and photos stale-while-revalidate with a bounded runtime cache (eviction)
- [ ] **FND-09**: Car-photo cache busting comes from one version map, replacing the hand-edited ternary in `src/pages/dashboard.js`
- [ ] **FND-10**: `plan-intake` performs no per-item database round trips (batched reads/deletes/inserts)
- [ ] **FND-11**: `AGENTS.md` contains only project-relevant guidance (car-asset section kept)

### Proposal Core

- [x] **CORE-01**: All autopilot output is stored as pending rows in one generic `proposals` table (kind, maker, car, target, before, after, evidence, status); autopilot cannot write live catalogue tables
- [x] **CORE-02**: Only an admin-run `apply_proposal` path can write approved proposals to live tables, inside a transaction, and it refuses if the live row changed since the proposal was made
- [x] **CORE-03**: The same finding is never queued twice, and a value the owner rejected is not re-proposed in later runs unless its sources change
- [x] **CORE-04**: A newer proposal for the same target supersedes an older pending one
- [x] **CORE-05**: Every approved change is recorded in a change log (who, when, before, after)
- [x] **CORE-06**: Data model has a `makers` table and contains no Mazda-specific literals in pipeline logic, so other brands can be added later without schema changes
- [x] **CORE-07**: Distances and prices are stored with explicit units/currency (km vs miles, SAR, VAT, pack quantity) and converted in code, never by the LLM

### Review Queue

- [x] **REV-01**: Owner can filter the queue by car, data kind, confidence and run
- [x] **REV-02**: Owner can approve all filtered high-confidence proposals in one action; one failure does not abort the rest
- [x] **REV-03**: Each proposal shows before/after diff, source links with the verbatim quoted evidence, and a rule-based confidence badge (source tier, number of agreeing sources, size of change)
- [x] **REV-04**: Owner can edit a proposed value before approving it
- [x] **REV-05**: Owner can reject a proposal with a reason
- [x] **REV-06**: Owner can revert an approved change in one click (recorded as a new audited change)
- [ ] **REV-07**: Owner sees a report per monthly run: proposals found per kind, cost, errors, skipped sources
- [ ] **REV-08**: `#admin` shows a banner when the monthly run is overdue or failed
- [x] **REV-09**: All scraped/LLM text in the admin UI is rendered through the escaping `html` template (tested with injection fixtures)

### Autopilot Engine

- [ ] **ENG-01**: A monthly scheduled run reviews all 16 catalogue cars without owner action
- [ ] **ENG-02**: Work is split into small per-car, per-stage jobs with retry, so no single function call exceeds Edge Function limits
- [ ] **ENG-03**: A hard monthly cost cap is checked before every paid call; when reached, the run stops and nothing partial is published
- [ ] **ENG-04**: Run has a kill switch the owner can flip from `#admin`
- [ ] **ENG-05**: Autopilot finds official/dealer sources itself via web search, preferring Mazda Saudi/GCC sources over global and US ones
- [ ] **ENG-06**: Owner can ban a source domain from `#admin` so it is never used again
- [ ] **ENG-07**: Every extracted number and part number must appear verbatim in the fetched source text, otherwise the item is dropped
- [ ] **ENG-08**: Sources whose content has not changed since the last run are skipped (no LLM cost)
- [ ] **ENG-09**: Owner can run "check now" for one car with a cost preview (dry run)

### Schedules & Recalls

- [ ] **SCH-01**: For each of the 16 cars, autopilot proposes corrections to service intervals (km and months) when official sources differ from the live plan
- [ ] **SCH-02**: Each service carries a separate structured severe-condition (Jeddah) interval, proposed alongside the normal one
- [ ] **SCH-03**: Proposals match the car's generation and engine; mismatches are rejected in code
- [ ] **SCH-04**: Recalls for each car are fetched and queued for approval (existing NHTSA flow kept)
- [ ] **SCH-05**: Each catalogue item shows when it was last verified; items not verified for 2+ runs are flagged in `#admin`

### Parts

- [x] **PRT-01**: Autopilot proposes dealer OEM parts per car (name, part number, fitment), each confirmed by at least 2 sources or an official catalogue *(code-complete; the "official catalogue" path is not built, see 04-VERIFICATION W-02; live check pending 04-10)*
- [x] **PRT-02**: Autopilot proposes indicative SAR prices from search results and app users' price reports, labelled "indicative"; no scraping of marketplaces whose terms forbid it *(code-complete; live check pending 04-10)*
- [x] **PRT-03**: Price changes below a materiality threshold (e.g. <10% or <5 SAR) are not proposed *(code-complete; live check pending 04-10)*

### Community

- [x] **COM-01**: Autopilot proposes common failures per car from public owner forums/groups, with mention counts and sources *(code-complete; live check pending 04-10)*
- [x] **COM-02**: Autopilot proposes cheaper alternative parts from forums and app users' submissions *(code-complete; live check pending 04-10)*
- [x] **COM-03**: App users' submissions (bills, prices, shops, alternatives) become a proposal only when at least 3 distinct users agree; outliers are trimmed *(code-complete; live check pending 04-10)*

### New Models

- [x] **NEW-01**: Autopilot flags new Mazda models/generations/engines as draft `car_models` proposals for approval *(code-complete; live check pending 04-10)*

## v2 Requirements

### Photos

- **PHO-01**: Autopilot proposes licensed car photos (Wikimedia Commons CC0/PD/CC BY/CC BY-SA) per model/colour with author and licence recorded
- **PHO-02**: Photo candidates pass a rules gate (size, aspect, licence, rejected-hash list) before review; final asset edit stays manual per `docs/CAR-ASSET-GUIDE.md`

### Multi-brand

- **BRD-01**: Add other makers (Toyota, Hyundai/Kia, Nissan) to catalogue and autopilot

### Review extras

- **RVX-01**: Whole-run rollback
- **RVX-02**: Source-disagreement panel and per-source reliability tracking
- **RVX-03**: Price history charts

## Out of Scope

| Feature | Reason |
|---------|--------|
| Auto-publish without approval | Violates core value; owner approves everything |
| Email/push notifications | Owner chose in-app queue only; overdue banner is the heartbeat |
| Daily/weekly refresh | Owner chose monthly cadence for low cost |
| Scraping marketplaces that forbid it (noon, Amazon.sa) | ToS/legal risk; prices come from search snippets and users |
| LLM self-scored confidence | Unreliable; confidence is rule-based |
| Headless browser scraping | Heavy, not supported in Edge Functions |
| Splitting oversized modules as standalone work | Only when a phase touches them |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1 | Pending |
| FND-02 | Phase 1 | Pending |
| FND-03 | Phase 1 | Pending |
| FND-04 | Phase 1 | Pending |
| FND-05 | Phase 1 | Pending |
| FND-06 | Phase 1 | Pending |
| FND-07 | Phase 1 | Pending |
| FND-08 | Phase 1 | Pending |
| FND-09 | Phase 1 | Pending |
| FND-10 | Phase 1 | Pending |
| FND-11 | Phase 1 | Pending |
| CORE-01 | Phase 2 | Complete |
| CORE-02 | Phase 2 | Complete |
| CORE-03 | Phase 2 | Complete |
| CORE-04 | Phase 2 | Complete |
| CORE-05 | Phase 2 | Complete |
| CORE-06 | Phase 2 | Complete |
| CORE-07 | Phase 2 | Complete |
| REV-01 | Phase 2 | Complete |
| REV-02 | Phase 2 | Complete |
| REV-03 | Phase 2 | Complete |
| REV-04 | Phase 2 | Complete |
| REV-05 | Phase 2 | Complete |
| REV-06 | Phase 2 | Complete |
| REV-09 | Phase 2 | Complete |
| ENG-01 | Phase 3 | Pending |
| ENG-02 | Phase 3 | Pending |
| ENG-03 | Phase 3 | Pending |
| ENG-04 | Phase 3 | Pending |
| ENG-05 | Phase 3 | Pending |
| ENG-06 | Phase 3 | Pending |
| ENG-07 | Phase 3 | Pending |
| ENG-08 | Phase 3 | Pending |
| ENG-09 | Phase 3 | Pending |
| SCH-01 | Phase 3 | Pending |
| SCH-02 | Phase 3 | Pending |
| SCH-03 | Phase 3 | Pending |
| SCH-04 | Phase 3 | Pending |
| SCH-05 | Phase 3 | Pending |
| REV-07 | Phase 3 | Pending |
| REV-08 | Phase 3 | Pending |
| PRT-01 | Phase 4 | Complete (code; live pending 04-10) |
| PRT-02 | Phase 4 | Complete (code; live pending 04-10) |
| PRT-03 | Phase 4 | Complete (code; live pending 04-10) |
| COM-01 | Phase 4 | Complete (code; live pending 04-10) |
| COM-02 | Phase 4 | Complete (code; live pending 04-10) |
| COM-03 | Phase 4 | Complete (code; live pending 04-10) |
| NEW-01 | Phase 4 | Complete (code; live pending 04-10) |

**Coverage:**
- v1 requirements: 48 total
- Mapped to phases: 48
- Unmapped: 0

---
*Requirements defined: 2026-11-05*
*Last updated: 2026-11-05 after initialization*
