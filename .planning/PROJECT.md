# Car Care — Autopilot Catalogue

## What This Is

Car Care is an offline-first Mazda care PWA (vanilla HTML/CSS/JS, no build step, optional Supabase sync) used in Saudi Arabia: pick a model/generation/engine, get a matching maintenance schedule, parts with OEM and cheaper alternatives in SAR, a service history and a budget. This milestone puts the app's **catalogue on autopilot**: once a month it finds new Mazda models, official dealer maintenance schedules, OEM parts, community knowledge (app users, owner forums, parts marketplaces) and car photos, and queues every finding for the owner to review and approve in the in-app admin page. The owner only reviews and approves; nothing reaches users without approval.

## Core Value

New and changed catalogue data (schedules, parts, prices, photos) arrives in the admin review queue automatically every month, and nothing is published to users without the owner's explicit approval.

## Requirements

### Validated

<!-- Inferred from the existing codebase (.planning/codebase/, 2026-11-04). -->

- ✓ Multi-vehicle garage with Mazda catalogue (Mazda 2 through CX-90), model/generation/engine picker and generated service plan — existing
- ✓ Maintenance schedule by distance and time (whichever first), mark-done, history timeline — existing
- ✓ Car Parts page with OEM + alternatives, SAR prices, PartSouq links, known failure points — existing
- ✓ Budget & spending (budget ring, charts, expense log) — existing
- ✓ Offline-first storage (IndexedDB/localStorage) with optional Supabase auth and sync — existing
- ✓ Shared dealer plans from server (`car_models`, `dealer_plan_items`) with change log — existing
- ✓ `plan-intake` edge function: monthly-capable cron that drafts schedule changes from admin-registered source URLs into `plan_drafts`, plus NHTSA recalls as pending — existing
- ✓ Admin page (`#admin`) with review queue for drafts and recalls — existing
- ✓ Community data: bill reading (`read-bill`, Claude vision), price observations, shops, contributions — existing
- ✓ Arabic/English i18n, responsive layout, PWA service worker — existing
- ✓ Test suite: 715 Node unit tests + Playwright e2e in CI — existing

### Active

**Foundation (reliability, security, performance):**
- [ ] Failed saves and afterSave hooks surface an error (toast + log) instead of being swallowed
- [ ] Client and edge-function errors are recorded somewhere the owner can see
- [ ] Service worker install survives a missing precache file; cache version no longer hand-bumped
- [ ] Edge functions restrict CORS to the app origin
- [ ] RLS SQL tests run in CI
- [ ] Vendored Supabase client is pinned and verifiable
- [ ] Service worker uses stale-while-revalidate for modules/photos with bounded runtime cache
- [ ] `plan-intake` N+1 queries batched
- [ ] Car-photo cache busting driven by one version map, not a hand-edited ternary
- [ ] `AGENTS.md` trimmed to project-relevant content

**Autopilot catalogue (Mazda):**
- [ ] Monthly run discovers new Mazda models/generations/engines and proposes them as draft `car_models`
- [ ] Autopilot finds official dealer schedule sources itself (web search), no manual URL entry required
- [ ] Autopilot proposes dealer OEM parts (name, part number, fitment) per model
- [ ] Autopilot proposes community data: common failures and cheaper alternatives from owner forums/groups
- [ ] Autopilot proposes marketplace prices and alternatives (PartSouq, Amazon.sa, noon) in SAR
- [ ] App users' submissions (bills, prices, shops, alternatives) are aggregated into proposals for review
- [ ] Autopilot proposes car photos per model/colour for review
- [ ] Every proposal shows its source(s) and a before/after diff in the admin queue
- [ ] Owner approves or rejects each proposal (and in bulk) from `#admin`; only approved data reaches users
- [ ] Monthly run has a hard cost cap and fails closed (no partial or unreviewed publishes)
- [ ] Data model is brand-agnostic so other makers can be added in a later milestone

### Out of Scope

- Other brands (Toyota, Hyundai/Kia, Nissan…) — deferred to a later milestone; this milestone only makes the data model ready
- Auto-publishing without approval — owner must approve every change (core value)
- Notifications (email/push) for pending reviews — owner chose the in-app queue only
- Daily/weekly price refresh — owner chose a once-a-month cadence
- Splitting oversized modules (`maintenance.js`, `storage.js`, `account.js`, `main.js`) as standalone work — do it only when a phase touches them

## Context

- Brownfield: codebase map in `.planning/codebase/` (2026-11-04). Baseline `npm test` green (715 pass).
- Architecture: classic scripts sharing one global scope, load order in `index.html`; dual-mode data modules (browser global + Node `require`); every new script must be added to `index.html` and `sw.js` `ASSETS` (`test/precache.test.js`).
- Existing pipeline to extend, not replace: `supabase/functions/plan-intake` (fetch with SSRF guards, Claude extraction, `diffDraft`, fail-closed drafts, NHTSA recalls), `plan_drafts`/`recalls` tables, admin queue in `src/pages/admin.js`.
- LLM calls use raw `fetch` to the Anthropic Messages API; models configurable via env (`INTAKE_MODEL`, `BILL_MODEL`).
- Car photos have a strict, documented approval history: `docs/CAR-ASSET-GUIDE.md` and `output/CAR-ASSET-LESSONS.md`. Proposed photos must follow them (rejected edits Mazda2 softening 175 and Mazda3 chrome-notch 196 must not be reapplied).
- Region: Saudi Arabia (Jeddah "severe" conditions, SAR prices, GCC owner's manual specs).
- Known concerns to address are listed in `.planning/codebase/CONCERNS.md`.

## Constraints

- **Tech stack**: Vanilla JS, no build step, no ES modules, must run from `file://` — existing app guarantee
- **Backend**: Supabase (Postgres + RLS, Edge Functions on Deno, pg_cron, Storage) — already in production
- **Security**: Every new table needs RLS; untrusted web/LLM output only rendered through the escaping `html` template — admin UI renders scraped content
- **Approval gate**: Autopilot writes only drafts/pending rows, never live tables — core value
- **Cadence/cost**: Monthly run with a hard cost cap — owner wants low running cost
- **Scraping**: Respect robots/terms of sources; keep existing SSRF guards for all fetches
- **Testing**: Node ≥22 `node --test` + Playwright; CI must stay green

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Mazda-only this milestone, brand-agnostic data model | Keep scope shippable; brands next milestone | — Pending |
| Fully automatic source discovery (web search) | Owner wants to only review and approve | — Pending |
| Review in existing `#admin` queue, no notifications | Reuse what exists; owner preference | — Pending |
| Monthly cadence with cost cap | Low running cost | — Pending |
| Photos auto-proposed for review | Owner wants photos on autopilot too | — Pending |
| Foundation fixes (reliability/security/perf) first | Autopilot adds server code and scraped content; harden first | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-11-05 after initialization*
