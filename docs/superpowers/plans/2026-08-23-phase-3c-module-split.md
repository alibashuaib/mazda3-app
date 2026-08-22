# Phase 3c — Module split completion

**Goal:** Finish the module split 3a/3b deliberately left undone: extract the
six page renderers, the remaining UI plumbing, and the router/lifecycle glue
out of `app.js` into `src/`, move `storage.js`/`schedule.js`/`ui.js` under
`src/`, and delete `app.js`. No visible UI change — this is the mechanical
half of Phase 3c only (the nav redesign — four tabs, merged Upcoming view —
is out of scope for this plan; see the roadmap's design-adjustments table).

**Architecture:** Same dual-mode UMD wrapper as every prior module. Each task
creates new file(s), deletes the corresponding block from `app.js` in the
same commit, and updates `index.html`/`sw.js`/`test/helpers/boot.js`'s
`SCRIPTS` list together. Every task ends green.

## Global constraints

- No ES modules, no build step, no new runtime dependencies (same reasons as
  3a/3b).
- **No visible UI change.** Every page renders byte-identically.
- Every task ends green: `npm test` passes, `node --check app.js` (while it
  still exists) is clean.
- This session has no local Node — every task is verified via CI after
  push, not locally. Push after each task; do not batch multiple tasks into
  one push.
- Branch: `phase-3c-module-split`.

## Target file structure

| File | Contents (moved from `app.js`) |
| --- | --- |
| `src/i18n/lang.js` | `lang`, `t`, `relDate`, `applyLang`, `applyNavLabels` |
| `src/ui/modal.js` | `openModal`, `closeModal`, `field` |
| `src/ui/photo.js` | `readImageResized`, `photoPicker`, `openImage` |
| `src/ui/chrome.js` | `toast`, `sectionTitle`, `pageIntro`, `emptyState`, `iconSvg`, theme (`systemTheme`, `applyTheme`, `themePref`, `setThemePref`), accent (`hexToRgb`, `rgbToHex`, `darkenHex`, `accentForColor`, `swatchFor`, `applyAccent`), `renderTopbar`, `carTitle`, `carInitials` |
| `src/pages/dashboard.js` | `renderDashboard`, `recommendations`, `recCard` |
| `src/pages/maintenance.js` | `renderMaintenance`, `planForward`, `buildPlan`, `logVisit`, `openLogConfirm`, `openPlanSetup`, `buildSchedule`, `scheduleTimelineItem`, `buildHistory`, `serviceItem`, `openServiceDetail`, `markServiceDone`, `openAddHistory`, `openEditService`, `openLogService`, `openLogSingleService`, `openLogPlanVisit` |
| `src/pages/parts.js` | `renderParts`, `partCard`, `openEditPart`, `partsForService`, `servicesForPart`, `partCrit`, `critLevel`, `critLabel`, `SERVICE_PARTS`, `CRIT_HIGH`, `CRIT_LOW`, `partCheapest` |
| `src/pages/fuel.js` | `fuelRows`, `renderFuel`, `fuelBars`, `openAddFuel` |
| `src/pages/budget.js` | `renderBudget`, `openEditBudget`, `openAddSpending`, `yearSpend` |
| `src/pages/reports.js` | `renderReports`, `reportHTML`, `reportHeader`, `reportFooter`, `reportService`, `reportPurchases`, `reportSummary`, `monthlyBars`, `spendEntry` |
| `src/pages/documents.js` | `docStatus`, `docItem`, `openAddDoc`, `openEditOdo` — currently rendered inside Settings, not their own tab; kept together since they share no page above |
| `main.js` | Router (`routes`, `current`, `navIntent`, `go`), vehicle lifecycle (`chooseVehicle`, `addVehicle`, `openAddVehicle`, `deleteVehicle`, `vehicleName`, `kickSync`, `exportGarage`, `importGarage`), garage switcher (`openGarage`, `askWhichGarage`), `openAccount`, `openSettings`, `openHealthBreakdown`, boot block, event listeners |
| `src/data/storage.js` | moved verbatim from root `storage.js` |
| `src/core/schedule.js` | moved verbatim from root `schedule.js` |
| `src/core/async-click.js` | moved verbatim from root `ui.js` |

`app.js` is deleted in the final task once every function above has a home
and `index.html`/`sw.js`/`test/helpers/boot.js` reference the new files
instead.

## Dependency injection note

Every extracted module reaches cross-module functions through the same
`dep`/global-object pattern as `src/data/*.js`. Page modules that call into
`main.js` (e.g. `go(route)` from a cross-link, `kickSync()` after a save) do
so via the global object, exactly as `app.js`'s existing aliases (`save`,
`switchVehicle`, `svKm`, …) already demonstrate — no new pattern is
introduced.

---

## Tasks

Each task: extract file(s) verbatim (prefixing bare dependency calls with
`dep.` per the established pattern), delete the block from `app.js`, add the
`<script>` tag(s) to `index.html` in dependency order, add the asset(s) to
`sw.js`'s `ASSETS` (bump the cache version), add the file(s) to
`test/helpers/boot.js`'s `SCRIPTS` array in the same position, run
`node --check app.js`, commit, push, confirm CI green before starting the
next task.

- [ ] **Task 1 — `src/i18n/lang.js`.** Lowest risk, no page dependencies.
- [ ] **Task 2 — `src/ui/modal.js` and `src/ui/photo.js`.** Used by every
      page's dialogs; must land before the page modules that call them.
- [ ] **Task 3 — `src/ui/chrome.js`.** Depends on Task 1 (`t`) and session;
      `renderTopbar` is called from `main.js`'s router, so `main.js` must
      reach it as a global, same as today.
- [ ] **Task 4 — `src/pages/dashboard.js`.**
- [ ] **Task 5 — `src/pages/maintenance.js`.** Largest single file; contains
      the plan-setup wizard.
- [ ] **Task 6 — `src/pages/parts.js`.**
- [ ] **Task 7 — `src/pages/fuel.js` and `src/pages/budget.js`.**
- [ ] **Task 8 — `src/pages/reports.js` and `src/pages/documents.js`.**
- [ ] **Task 9 — `main.js`.** Everything left in `app.js` after Tasks 1-8:
      router, vehicle lifecycle, garage switcher, account/settings dialogs,
      boot block. `app.js` should be empty but for its top banner comment
      after this task.
- [ ] **Task 10 — Move `storage.js` → `src/data/storage.js`,
      `schedule.js` → `src/core/schedule.js`, `ui.js` →
      `src/core/async-click.js`.** Update every `require()` path in
      `src/data/*.js`, `test/*.test.js`, `index.html`, `sw.js`, and
      `test/helpers/boot.js`. This is the widest blast radius in the plan —
      verify with a full `grep -rn "require('\.\./\.\./storage\|require('\.\./\.\./schedule\|require('\.\./\.\./ui" .` sweep after moving, and confirm nothing still points at the old root paths.
- [ ] **Task 11 — Delete `app.js`.** Confirm `index.html` no longer
      references it, confirm `test/helpers/boot.js`'s `SCRIPTS` list and its
      `assertScriptOrderMatchesIndexHtml` guard pass, confirm
      `test/no-raw-templates.test.js` and every render test still pass
      against the new file set (that guard currently reads `app.js` as text
      — repoint it at the concatenation of every module under `src/` that
      was converted, or retire it in favor of per-file guards; decide and
      note the reasoning in the commit).

## Done when

- `app.js` no longer exists.
- `npm test` passes, including every existing render/html/no-raw-template
  test, now exercising the new file set.
- `node --check` is clean on every new file.
- The app still runs by double-clicking `index.html`, in both languages,
  offline after a hard reload.
- No visible UI change.

## Risks

**No local Node in this session.** Every task's correctness is judged by
pushing and reading CI's `npm test`/`browser` job output, not by running
anything locally first. Each task is kept small enough that a CI failure
points at one clear cause.

**`test/helpers/boot.js`'s script order assertion is load-bearing.** It
already guards `index.html` and the `SCRIPTS` array staying in sync; every
task must update both together or CI fails immediately and unambiguously —
that is the guard doing its job, not a bug to work around.

**Global-object collisions.** Two classic scripts declaring the same
top-level function name silently let the later one win, with no error. This
is how 3a/3b's own incremental extraction worked (the old `app.js` copy
stays live until deleted in the same task), and is used here identically —
but it means a task that adds a new module WITHOUT deleting `app.js`'s copy
in the same commit leaves dead code that silently shadows nothing until the
delete lands. Every task in this plan deletes the moved block from `app.js`
in the same commit specifically to avoid that state ever existing.
