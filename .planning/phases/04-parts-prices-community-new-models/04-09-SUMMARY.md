---
phase: 04-parts-prices-community-new-models
plan: 09
subsystem: community-ui
tags: [known-issues, new-models, contributions]
requires: [04-01, 04-07]
provides: ["knownIssues.forCar", "dashboard Known issues card", "catalogue-in-progress note", "engine on part contributions"]
key-files:
  created: [src/data/known-issues.js, test/known-issues.test.js]
  modified: [src/pages/dashboard.js, src/data/insights.js, src/pages/maintenance.js, index.html, sw.js, main.js, src/i18n/strings.ar.js, test/helpers/boot.js, test/insights.test.js]
metrics:
  completed: 2026-11-08
---

# Phase 4 Plan 09: Known issues card and engine on contributions

Dashboard shows approved known issues (per model:engine) after the recall box, plus a "catalogue in progress" note for server-added models; part contributions now carry the engine.

## Commits
- fc6c345: known-issues.js, dashboard card + note, wiring, AR strings, tests
- e9e377b: engine in partContributions + maintenance caller + test

## Deviations
- [Rule 3] `test/helpers/boot.js` SCRIPTS list hardcoded; added known-issues.js there (needed by assertScriptOrderMatchesIndexHtml).
- [Rule 1] `remoteCatalog.dealerPlan()` returns null for an unknown model; guarded with `|| []` in the note condition.
- Existing insights test asserted no `engine` key on rows; changed to expect `engine: null` (plan behavior).
- 'Typical km' already existed in strings.ar.js; reused, not duplicated.
- `isRegisteredModel` is a bare global (catalog.js does Object.assign(root,...)), not `catalog.isRegisteredModel`.
- Test note: boot normalizes unknown modelId away before server models register, so the render test sets car.modelId after load().

## Threats
T-04-32/33 mitigated: textContent only, https-only links with rel noopener noreferrer and hostname text; render test with `<img onerror>` and `javascript:` payloads.

## Verification
`npm test`: 1023 pass, 0 fail. sw:version run (CACHE garage-185ae1eb61ac). No local Postgres; no SQL touched.

## Known Stubs
None.

## Self-Check: PASSED
