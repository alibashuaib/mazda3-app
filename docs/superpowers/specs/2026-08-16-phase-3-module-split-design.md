# Phase 3 — Module Split, Shaped by Multi-User

**Date:** 2026-08-16
**Status:** Approved design, pending implementation plan
**Supersedes:** the Phase 3 section of `2026-08-10-garage-roadmap-design.md`

## Summary

`app.js` is 3,235 lines and holds the router, every page, every dialog, the catalog,
the translation dictionary and the garage lifecycle. Phases 1 and 2 extracted
`storage.js`, `schedule.js` and `ui.js` with 83 tests behind them, but the bulk of the
app never moved.

This phase splits the remainder into seventeen modules, none over roughly 400 lines.

It is not a neutral reorganisation. Phase 4 adds per-user accounts, and two properties
that phase depends on do not exist anywhere in the current code:

- **Nothing owns the garage lifecycle.** `state` and `garage` are bare module-level
  `let`s that boot assigns (`app.js:3211-3219`). There is no place to put "sign out,
  then load a different user's garage".
- **HTML is assembled by string interpolation in 232 places** — 63 `innerHTML`
  assignments and 169 `el()` calls, whose third argument is an HTML string. This is
  roadmap defect 7. It is self-inflicted only while data is device-local, and a real
  vulnerability once data crosses a server.

So the split introduces two boundaries deliberately, `data/session.js` and
`ui/html.js`, chosen so that Phase 4 becomes a small diff rather than a second
refactor of the same code.

## Context: the multi-user decisions this serves

Recorded here because they constrain the design, and are specified in full in the
Phase 4 spec:

1. **Separate private garages.** Each user sees only their own vehicles. No sharing,
   no invites, no ownership transfer — unchanged from the roadmap's non-goals.
2. **Sign-in is optional.** The app keeps working with no account exactly as it does
   today, including from `file://`. Signing in uploads the existing local garage into
   the account. Local-first is preserved; the server is never in the write path.
3. **The split lands first**, as its own plan, verified and merged before any account
   work begins.

## Current structure

Measured at `0236b30`.

| Section | Lines | Count |
| --- | --- | --- |
| Header, helpers | 1–22 | 22 |
| Arabic translation dictionary | 23–387 | 365 |
| Vehicle and parts catalog | 388–876 | 489 |
| State, garage, save, photos, export/import | 877–1195 | 319 |
| Service status, health score | 1196–1236 | 41 |
| Router, cross-page link maps | 1237–1285 | 49 |
| Dashboard | 1286–1408 | 123 |
| Maintenance — plan, schedule, history, wizard | 1409–1916 | 508 |
| Parts, Budget, Reports, Fuel, Docs | 1917–2468 | 552 |
| Modals and dialogs | 2469–3071 | 603 |
| UI helpers, theme, language, accent, boot | 3072–3235 | 164 |

The 603-line modal block is the largest section and the roadmap's Phase 3 table does
not mention it. It mixes generic machinery (`openModal`, `field`, `photoPicker`) with
roughly a dozen page-specific dialogs (`openAddFuel`, `openEditPart`, `openLogConfirm`,
`openSettings`, `openAddHistory`, `openAddSpending`).

## Target structure

```
src/
  main.js              boot + router                 ~120
  data/
    session.js         garage lifecycle              ~200
    catalog.js         CAR_MODELS, parts catalogues  ~490
    normalize.js       normalizeData, buildProfile, seed  ~120
    status.js          serviceStatus, svKm, svMo, healthScore  ~90
  i18n/
    strings.ar.js      the AR dictionary             ~365
    lang.js            t(), RTL handling, nav labels ~60
  ui/
    html.js            safe HTML builder             ~60   NEW
    modal.js           openModal, closeModal, field  ~90
    photo.js           picker, resize, object URLs   ~120
    chrome.js          toast, theme, accent, topbar  ~180
  pages/
    dashboard.js       ~150
    maintenance.js     ~380
    parts.js           ~200
    money.js           ~330
    fuel.js            ~200
    docs.js            ~90
```

`app.js` is deleted. The three modules Phase 2 already extracted — `storage.js`,
`schedule.js`, `ui.js` — move into `src/` alongside these, keeping their current
contents and their existing tests.

### Module format: UMD, not ESM

**The roadmap's "`index.html` loads `src/main.js` as a module" cannot be used.**
`<script type="module">` is CORS-checked, and a `file://` origin is opaque, so module
scripts fail to load when the page is opened by double-clicking it. Running from disk
is a documented feature of this app and an acceptance criterion of both Phase 2 and
this phase.

So every module follows the dual-mode wrapper `storage.js`, `schedule.js` and `ui.js`
already use: a plain `<script>` that attaches its API to the global object in the
browser, and `module.exports` when `require()`d by the Node tests. This is not a new
convention — it is the one the project adopted in Phase 2, applied consistently.

Consequences to carry into the plan:

- `index.html` lists all seventeen scripts in dependency order. Data and helpers
  first, pages next, `main.js` last.
- There is no import graph enforcing that order; a module referencing another before
  it loads fails at runtime, not at parse time. The smoke tests in step 4 exist partly
  to catch this.
- `sw.js`'s `ASSETS` list must name every script explicitly, for the same reason.

Should the app ever drop `file://` support, converting these wrappers to ESM is
mechanical. That is a Phase 4-or-later decision, not this phase's.

### Page dialogs move to their pages

Each `open*` dialog goes to the page module that owns its subject: `openAddFuel` and
`openEditOdo` to `fuel.js`; `openEditPart` to `parts.js`; `openLogConfirm`,
`openPlanSetup`, `openServiceDetail`, `openEditService`, `openAddHistory`,
`markServiceDone` to `maintenance.js`; `openAddSpending`, `openEditBudget` to
`money.js`; `openAddDoc` to `docs.js`; `openGarage`, `openSettings` to `chrome.js`.

Only genuinely generic machinery stays in `ui/modal.js`. This is why the page modules
are larger than their current `render*` functions.

### Budget and Reports merge into `money.js`

They are the same subject — records and money — and the roadmap already plans to merge
them into one **Money** tab. Splitting them into two modules now and merging them later
is wasted motion.

**This does not change the UI.** Six tabs remain six tabs, and both views render
exactly as they do today. Only the file boundary changes. The tab merge is a separate,
user-visible change and is out of scope here.

### `catalog.js` and `strings.ar.js` are pure data

854 lines, 26% of the file, with no logic and no dependencies. They move first, at
essentially zero risk, and shrink everything that follows.

## The session boundary

`data/session.js` owns the garage lifecycle. It exports functions, never mutable
bindings:

```js
current()          // active vehicle's data — replaces the `state` global
garage()           // vehicle list + activeId — replaces the `garage` global
load()             // openStorage → loadAll → hydrate; boot calls this
save()             // unchanged semantics: Promise<boolean>
switchVehicle(id)
clear()            // drop in-memory state, revoke object URLs, clear photo cache
```

Pages call `current().services` where they now read `state.services` — a mechanical
change across 125 call sites.

**Why functions rather than an exported `state` binding.** ES module bindings are
live, so `export let state` would technically propagate reassignment. But it would
leave twelve modules reading a variable that anything may reassign at any time, with
no single place that defines when that happens. An accessor makes the lifecycle
explicit and gives `clear()` somewhere to live.

**Why `clear()` matters for Phase 4.** IndexedDB is per-origin, not per-user. Without
a deliberate wipe on sign-out, the next user to sign in on the same browser boots into
the previous user's garage. Sign-out becomes `clear()` plus a storage wipe; sign-in
becomes `clear()` then `load()`. Both are changes inside this one module. No page
module ever learns that accounts exist.

`save()` keeps returning `Promise<boolean>` exactly as Phase 2 left it. Phase 1's
guarantee — no success message for a failed write — must survive this refactor
untouched.

## The HTML boundary

`ui/html.js` exports a tagged template that escapes every interpolation, plus an
explicit opt-out:

```js
html`<h3>${car.nickname}</h3>`            // escaped
html`<div>${raw(iconSvg('oil'))}</div>`   // opt-out, greppable
```

The 232 call sites convert during the move they are already undergoing. `el()`'s HTML
argument accepts the builder's output.

After this, an unescaped interpolation requires typing `raw()` — visible in review,
countable by a test. The alternative, auditing 232 sites once and relying on
discipline afterwards, does not survive contact with future edits.

Defect 7 is therefore closed here rather than in Phase 4, where the roadmap placed it.
Phase 4's remaining obligation is to confirm no `raw()` call carries user-supplied
text.

## Testing

Added alongside the existing 83 tests, using `node --test` with no new framework.

| Module | Covered |
| --- | --- |
| `session.js` | load, save, switchVehicle; `clear()` leaves no state, no live object URLs, no cached photo Blobs |
| `html.js` | interpolations escaped; `raw()` passes through unchanged; nested templates compose |
| `status.js` | `serviceStatus`, `svKm`, `svMo`, `healthScore` |
| `normalize.js` | `normalizeData`, `buildProfile` |
| `lang.js` | `t()` fallback when a key is missing, RTL attribute handling |

Page modules get import-and-render smoke tests only — enough to catch a broken import
graph or a crash on first render. Deeper UI testing needs a DOM harness and is not
worth the setup at this stage.

## Order of work

Each step is independently verifiable and mergeable, and the app is working at every
boundary.

1. **Pure data out** — `catalog.js`, `strings.ar.js`. 854 lines, no behavioural risk.
2. **`session.js`** — introduce it, convert the 125 `state.` reads.
3. **`html.js`** — introduce it, convert the 232 HTML construction sites.
4. **Pages out**, one at a time, each dialog following its page.
5. **`main.js`**, rewrite `index.html`'s script list in dependency order, update
   `sw.js`'s `ASSETS` list, move `storage.js` / `schedule.js` / `ui.js` into `src/`,
   delete `app.js`.

Step 3 is the one to be careful with: it touches every render path. It is sequenced
after `session.js` so that the state accessor churn is already settled and the two
mechanical passes do not overlap in the same lines.

## Acceptance criteria

- No module exceeds roughly 400 lines.
- `node --test` runs green, including the new per-module tests.
- No visible change to the UI anywhere in the app. Six tabs remain six tabs.
- The app works offline after a hard reload, confirming `sw.js` caches every script.
- The app still runs by double-clicking `index.html`, on the `localStorage` backend.
  No module uses `import`/`export` syntax or `<script type="module">`.
- A vehicle nickname of `<img src=x onerror=alert(1)>` renders as literal text.
- `session.clear()` leaves no in-memory garage, no live object URLs and no cached
  photo Blobs.
- No success message is shown for a write that failed — Phase 1's guarantee, verified
  intact after the refactor.
- `app.js` no longer exists.

## Non-goals

- **The tab merge.** Four tabs instead of six, and merging Schedule and Plan into
  "Upcoming", are user-visible changes. `money.js` prepares for the first of them but
  does not perform it.
- **Accounts, auth, sync.** Phase 4, its own spec. This phase only creates the seams.
- **Rewriting the visual design.** Unchanged, per the roadmap.
- **Converting reads to async.** `session.current()` stays synchronous, hydrated at
  boot exactly as Phase 2 established.

## Risks

**Step 3 touches every render path.** The 232-site conversion is where a typo becomes
a broken page. Mitigated by sequencing it after the state churn, by converting one
page module at a time, and by the smoke tests added in step 4.

**The page modules carry their dialogs**, so they are larger than a reading of the
current `render*` functions suggests. `maintenance.js` at roughly 380 lines is the
closest to the 400-line target and may need splitting into `maintenance.js` plus
`maintenance-dialogs.js`. That is a judgement call for the implementation plan, not a
decision to make here.

**Line-count estimates are estimates.** They come from the section measurements above
plus the dialog reassignment, and will move as the work proceeds. The ~400-line target
is the constraint that matters; the per-module numbers are guidance.
