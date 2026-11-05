# Roadmap: Car Care — Autopilot Catalogue

## Overview

Harden the app first (autopilot adds server code and renders scraped content), then prove the owner approval gate end to end with seeded proposals, then switch on the monthly autopilot for schedules and recalls of all 16 Mazda cars, then add parts, prices, community data and new-model detection. Photos are out of this milestone (PHO-01/02 are v2; owner generates photos with Codex). Autopilot only ever writes to `proposals`; nothing publishes without owner approval.

## Phases

- [x] **Phase 1: Reliable & Safe Foundation** - Errors visible, CORS locked, shared safeFetch, resilient service worker, RLS tests in CI (completed 2026-11-05)
- [ ] **Phase 2: Proposal Gate & Review Queue** - Owner reviews, edits, approves, rejects and reverts seeded proposals in `#admin`
- [ ] **Phase 3: Monthly Autopilot for Schedules & Recalls** - Cost-capped monthly run reviews all 16 cars and queues schedule and recall proposals
- [ ] **Phase 4: Parts, Prices, Community & New Models** - Autopilot proposes OEM parts, indicative SAR prices, failures, alternatives and new models

## Phase Details

### Phase 1: Reliable & Safe Foundation
**Goal**: Users and the owner can trust the app: failures are visible, server endpoints are locked down, and the offline shell stays healthy.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08, FND-09, FND-10, FND-11
**Success Criteria** (what must be TRUE):
  1. When a save fails, the user sees a toast and the error appears in a log table the owner can read from `#admin`; edge-function errors appear there too.
  2. A browser request to an edge function from any origin other than the deployed app is rejected.
  3. A deliberately broken RLS policy or a changed `vendor/supabase.js` fails CI.
  4. The app installs offline even if one precache file is missing, a new release needs no hand cache bump, and photos/modules load stale-while-revalidate with a bounded cache.
  5. Server fetches of external URLs (including redirect, private-IP and IPv6 cases) all go through one tested `safeFetch`, and `plan-intake` runs without per-item DB round trips.
**Plans**: TBD
**UI hint**: yes

### Phase 2: Proposal Gate & Review Queue
**Goal**: Owner can review, edit, approve, reject and revert catalogue proposals in `#admin`, with nothing reaching users unapproved.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04, CORE-05, CORE-06, CORE-07, REV-01, REV-02, REV-03, REV-04, REV-05, REV-06, REV-09
**Success Criteria** (what must be TRUE):
  1. Owner sees seeded pending proposals in `#admin`, filterable by car, kind, confidence and run, each with before/after diff, source links with verbatim quote, and a rule-based confidence badge.
  2. Owner can edit a value, approve it, and the user app shows the new data after refresh; a proposal whose live row changed since creation is refused.
  3. Owner can reject with a reason, and the same value is not re-queued; a newer proposal for the same target supersedes the older pending one.
  4. Owner can bulk-approve filtered high-confidence proposals; one failing item does not abort the rest.
  5. Owner can revert any approved change in one click, recorded in the change log; scraped text with injection payloads renders as inert escaped text.
**Plans**: TBD
**UI hint**: yes

### Phase 3: Monthly Autopilot for Schedules & Recalls
**Goal**: Once a month, without owner action, every one of the 16 Mazda cars is checked and schedule and recall corrections arrive in the review queue within a hard cost cap.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: ENG-01, ENG-02, ENG-03, ENG-04, ENG-05, ENG-06, ENG-07, ENG-08, ENG-09, SCH-01, SCH-02, SCH-03, SCH-04, SCH-05, REV-07, REV-08
**Success Criteria** (what must be TRUE):
  1. Owner runs "check now" for one car, sees a cost preview, and gets schedule proposals (normal and severe/Jeddah intervals, matching generation and engine) with Mazda Saudi/GCC sources preferred.
  2. The monthly cron run covers all 16 cars in small retried jobs; when the cost cap is reached or the kill switch is flipped the run stops and nothing partial is published.
  3. Every proposed number appears verbatim in its fetched source or is dropped; unchanged sources cost no LLM calls; owner can ban a source domain permanently.
  4. Owner sees a per-run report (proposals per kind, cost, errors, skipped sources) and a banner when the run is overdue or failed; recalls per car are queued for approval; items unverified for 2+ runs are flagged.
**Plans**: TBD
**UI hint**: yes

### Phase 4: Parts, Prices, Community & New Models
**Goal**: The monthly run also proposes OEM parts, indicative SAR prices, community failures and cheaper alternatives, and new Mazda models for owner approval.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: PRT-01, PRT-02, PRT-03, COM-01, COM-02, COM-03, NEW-01
**Success Criteria** (what must be TRUE):
  1. Owner sees OEM part proposals (name, part number, fitment) only when 2+ sources or an official catalogue confirm them.
  2. Owner sees SAR price proposals labelled "indicative"; changes under the materiality threshold are not queued.
  3. Owner sees proposed common failures with mention counts and cheaper alternative parts from forums and app users, and user-submission proposals appear only when 3+ distinct users agree.
  4. Owner sees newly detected Mazda models/generations/engines as draft `car_models` proposals, and approving one makes it available in the app picker.
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Reliable & Safe Foundation | 11/11 | Complete   | 2026-11-05 |
| 2. Proposal Gate & Review Queue | 0/? | Not started | - |
| 3. Monthly Autopilot for Schedules & Recalls | 0/? | Not started | - |
| 4. Parts, Prices, Community & New Models | 0/? | Not started | - |
