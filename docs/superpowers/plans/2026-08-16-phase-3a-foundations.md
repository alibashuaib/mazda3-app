# Phase 3a — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the shared helpers, catalog, translations, normalisation and service-status logic out of `app.js`, and introduce `src/data/session.js` as the single owner of the garage lifecycle — the seam Phase 4 needs for sign-in and sign-out.

**Architecture:** Every new file uses the same dual-mode UMD wrapper that `storage.js`, `schedule.js` and `ui.js` already use: a plain `<script>` assigning its API to the global object in the browser, and `module.exports` when `require()`d by the Node tests. Unlike the existing three modules, the new ones have cross-module dependencies, so the wrapper is extended to resolve them — globals in the browser, `require()` in Node. `app.js` shrinks as each module lands and keeps working at every commit.

**Tech Stack:** Vanilla JavaScript, no build step. `node --test` with `node:assert`. `fake-indexeddb` is the only devDependency and is not used by this plan.

## Global Constraints

- **No ES modules.** No `import`/`export` syntax, no `<script type="module">`. Module scripts are CORS-checked and `file://` is an opaque origin, so they fail when `index.html` is double-clicked. Running from disk is an acceptance criterion.
- **No build step.** No bundler, no transpiler, no new runtime dependencies.
- **No new devDependencies.** Tests use `node --test` and `node:assert` only.
- **No visible UI change.** Six tabs remain six tabs. Every page renders exactly as it does today.
- **`save()` keeps returning `Promise<boolean>`.** Phase 1's guarantee — no success message is shown for a write that failed — must survive untouched.
- **The app must still run from `file://`** on the `localStorage` backend after every task.
- **All new files live under `src/`.** `storage.js`, `schedule.js` and `ui.js` stay at the repo root for this plan and move in Phase 3c.
- **Every task ends green:** `npm test` passes before the commit.
- **Branch:** `spec-phase-3-module-split`. Commit after every task.

## The dual-mode wrapper with dependencies

Existing modules are self-contained. The new ones are not — `normalize.js` needs `normalizeRecords` from `storage.js`, `today`/`isoDate` from `schedule.js`, and `uid` from `helpers.js`. Every new module in this plan uses this exact wrapper shape, varying only the `require()` list:

```js
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const dep = isNode
    ? Object.assign({}, require('../../schedule.js'), require('../core/helpers.js'))
    : root;
  const api = factory(dep);
  if (isNode) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {

  // ... module body, reaching dependencies as dep.uid(), dep.today(), ...

  return { /* public API */ };
});
```

In the browser `dep` is the global object, so `dep.uid()` finds the `uid` that `helpers.js` assigned there. In Node it is an object assembled from `require()`. **Modules must never call a dependency bare** (`uid()`) — always `dep.uid()`. A bare call works in the browser and throws in the tests.

## File Structure

| File | Responsibility | Approx lines |
| --- | --- | --- |
| `src/core/helpers.js` | DOM and formatting primitives: `$`, `el`, `uid`, `fmt`, `sar`, `clamp`, `parseDate`, `monthsBetween`, `addMonths` | 30 |
| `src/data/catalog.js` | Static vehicle/parts data and the part-builder functions | 490 |
| `src/i18n/strings.ar.js` | The Arabic dictionary, data only | 365 |
| `src/data/normalize.js` | `normalizeData`, `buildProfile`, `seed` | 130 |
| `src/data/session.js` | Garage lifecycle: `load`, `current`, `garage`, `save`, `switchVehicle`, `clear` | 200 |
| `src/data/status.js` | `svKm`, `svMo`, `serviceStatus`, `servicesRanked`, `healthScore` — pure, no globals | 90 |
| `test/helpers.test.js` | Covers `src/core/helpers.js` | 60 |
| `test/catalog.test.js` | Covers `src/data/catalog.js` | 60 |
| `test/normalize.test.js` | Covers `src/data/normalize.js` | 110 |
| `test/session.test.js` | Covers `src/data/session.js`, especially `clear()` | 150 |
| `test/status.test.js` | Covers `src/data/status.js` | 110 |

`index.html` and `sw.js` gain one `<script>` / asset entry per module, in dependency order.

**Not in this plan:** `src/ui/html.js` and the 232-site HTML conversion (Phase 3b), the six page modules, `main.js`, and deleting `app.js` (Phase 3c).

**Note on `src/core/helpers.js`:** the spec's module table omits it. `uid`, `clamp`, `parseDate`, `monthsBetween` and `addMonths` are used by `normalize.js`, `session.js` and `status.js` alike, and leaving them in `app.js` would make every extracted module depend on the file being dismantled. It is added here as the lowest layer.

---

### Task 1: Shared helpers

**Files:**
- Create: `src/core/helpers.js`
- Create: `test/helpers.test.js`
- Modify: `app.js:10-18` (delete the moved declarations), `app.js:376-377` (delete `monthsBetween`, `addMonths`)
- Modify: `index.html:93` (add script tag before `schedule.js`)
- Modify: `sw.js:3` (add to `ASSETS`)

**Interfaces:**
- Consumes: nothing.
- Produces: `$(sel, root?)`, `el(tag, cls?, html?)`, `uid() -> string`, `fmt(n) -> string`, `sar(n) -> string`, `clamp(n, a, b) -> number`, `parseDate(isoString) -> Date`, `monthsBetween(a: Date, b: Date) -> number`, `addMonths(d: Date, m: number) -> Date`. Every later task reaches these as `dep.uid()` etc.

- [ ] **Step 1: Write the failing test**

Create `test/helpers.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { uid, fmt, sar, clamp, parseDate, monthsBetween, addMonths } = require('../src/core/helpers.js');

test('uid returns a short unique-ish string', () => {
  const a = uid(), b = uid();
  assert.strictEqual(typeof a, 'string');
  assert.ok(a.length >= 5 && a.length <= 7);
  assert.notStrictEqual(a, b);
});

test('fmt groups thousands, sar drops the decimals', () => {
  assert.strictEqual(fmt(316000), '316,000');
  assert.strictEqual(sar(1234.67), '1,235');
});

test('clamp holds a value inside its bounds', () => {
  assert.strictEqual(clamp(5, 0, 1.2), 1.2);
  assert.strictEqual(clamp(-3, 0, 1.2), 0);
  assert.strictEqual(clamp(0.4, 0, 1.2), 0.4);
});

/* parseDate must build a LOCAL midnight, not a UTC one — the whole schedule
   compares against today() at local midnight, and a UTC parse shifts every
   due date by a day for anyone east of Greenwich. Jeddah is UTC+3. */
test('parseDate builds local midnight', () => {
  const d = parseDate('2026-08-16');
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 7);
  assert.strictEqual(d.getDate(), 16);
  assert.strictEqual(d.getHours(), 0);
});

test('monthsBetween counts fractional months forward and back', () => {
  const a = parseDate('2026-01-01');
  assert.strictEqual(Math.round(monthsBetween(a, parseDate('2026-07-01'))), 6);
  assert.ok(monthsBetween(parseDate('2026-07-01'), a) < 0);
});

test('addMonths rolls the year over and does not mutate its input', () => {
  const a = parseDate('2026-11-15');
  const b = addMonths(a, 3);
  assert.strictEqual(b.getFullYear(), 2027);
  assert.strictEqual(b.getMonth(), 1);
  assert.strictEqual(a.getMonth(), 10, 'input must not be mutated');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/helpers.test.js`
Expected: FAIL — `Cannot find module '../src/core/helpers.js'`

- [ ] **Step 3: Create the module**

Create `src/core/helpers.js`. The bodies are moved verbatim from `app.js:11-18` and `app.js:376-377`; do not rewrite them.

```js
/* ============================================================
   Garage — primitives shared by every module.
   Dual-mode, like storage.js: a plain <script> in the browser and
   require()d by the Node tests. Lowest layer — depends on nothing.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const fmt = n => Number(n).toLocaleString('en-US');
  const sar = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const parseDate = s => new Date(s + 'T00:00:00');
  const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() - a.getDate()) / 30;
  const addMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + Math.round(m)); return x; };

  return { $, el, uid, fmt, sar, clamp, parseDate, monthsBetween, addMonths };
});
```

`$` and `el` touch `document` at call time, not load time, so requiring this file under Node is safe. They are not covered by the test for that reason.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/helpers.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Delete the moved declarations from `app.js`**

Remove these lines from `app.js` — leaving them shadows the globals the module now provides:
- `app.js:11-18`: the `$`, `el`, `uid`, `fmt`, `sar`, `clamp`, `parseDate` declarations. Keep the `/* ---------- helpers ---------- */` comment on line 10.
- `app.js:376-377`: the `monthsBetween` and `addMonths` declarations.

Leave `relDate` (`app.js:378-386`) in place — it reads `lang` and calls `t()`, and moves in Phase 3c.

- [ ] **Step 6: Load the module in the browser**

In `index.html`, add before the `schedule.js` tag on line 93:

```html
  <script src="src/core/helpers.js"></script>
```

In `sw.js` line 3, add `'./src/core/helpers.js'` to `ASSETS` immediately after `'./styles.css'`, and bump the cache name from `'garage-v5'` to `'garage-v6'` so returning users pick up the new asset list.

- [ ] **Step 7: Verify the app still runs**

Open `index.html` by double-clicking it. Expected: the dashboard renders, the odometer reads with thousands separators, and the console shows no `ReferenceError`.

- [ ] **Step 8: Run the whole suite and commit**

Run: `npm test`
Expected: PASS, 89 tests (83 existing + 6 new).

```bash
git add src/core/helpers.js test/helpers.test.js app.js index.html sw.js
git commit -m "refactor: extract shared helpers into src/core/helpers.js"
```

---

### Task 2: Catalog

**Files:**
- Create: `src/data/catalog.js`
- Create: `test/catalog.test.js`
- Modify: `app.js:392-876` (delete the moved block), `app.js:887-917` (delete `NORMAL_SCHED`, `ATF_NOTE`, and the three part builders)
- Modify: `index.html`, `sw.js`

**Interfaces:**
- Consumes: `dep.uid()` from Task 1.
- Produces: `DEFAULT_COLOR: string`, `CAR_MODELS: Array<{id, model, generation, engines: Array<[string, number]>}>`, `NORMAL_SCHED: Object<string, [number, number]>`, `ATF_NOTE: string`, `skyactivServices(oilL: number) -> Array<Service>`, `mazda3Parts() -> Array<Part>`, `sharedParts() -> Array<Part>`, `atfFilterPart() -> Part`, `atfSealantPart() -> Part`, `fuelSystemCleanerPart() -> Part`.

- [ ] **Step 1: Write the failing test**

Create `test/catalog.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cat = require('../src/data/catalog.js');

test('CAR_MODELS entries all carry an id, a model and at least one engine', () => {
  assert.ok(cat.CAR_MODELS.length > 0);
  cat.CAR_MODELS.forEach(m => {
    assert.ok(m.id, 'model needs an id');
    assert.ok(m.model, `${m.id} needs a model name`);
    assert.ok(Array.isArray(m.engines) && m.engines.length, `${m.id} needs engines`);
    m.engines.forEach(([code, oilL]) => {
      assert.strictEqual(typeof code, 'string');
      assert.strictEqual(typeof oilL, 'number');
    });
  });
});

test('the default Mazda 3 BM is present, since seed() depends on it', () => {
  assert.ok(cat.CAR_MODELS.find(m => m.id === 'mazda3bm'));
});

test('skyactivServices threads the oil capacity through and gives every service an interval', () => {
  const svc = cat.skyactivServices(4.2);
  assert.ok(svc.length > 0);
  svc.forEach(s => {
    assert.ok(s.name, 'service needs a name');
    assert.ok(s.intervalKm > 0, `${s.name} needs intervalKm`);
    assert.ok(s.intervalMonths > 0, `${s.name} needs intervalMonths`);
  });
});

/* uid() is called at build time, so two calls must not hand out the same ids —
   the app keys records by them. */
test('part builders produce fresh ids on every call', () => {
  const a = cat.mazda3Parts(), b = cat.mazda3Parts();
  assert.strictEqual(a.length, b.length);
  assert.notStrictEqual(a[0].id, b[0].id);
});

test('sharedParts is the generic fallback and is non-empty', () => {
  const p = cat.sharedParts();
  assert.ok(p.length > 0);
  p.forEach(x => assert.ok(x.name && Array.isArray(x.options)));
});

test('the three single-part builders return a named part with options', () => {
  [cat.atfFilterPart(), cat.atfSealantPart(), cat.fuelSystemCleanerPart()].forEach(p => {
    assert.ok(p.id && p.name);
    assert.ok(Array.isArray(p.options) && p.options.length);
  });
});

test('NORMAL_SCHED entries are [km, months] pairs', () => {
  Object.entries(cat.NORMAL_SCHED).forEach(([name, pair]) => {
    assert.ok(Array.isArray(pair) && pair.length === 2, `${name} must be a pair`);
    assert.strictEqual(typeof pair[0], 'number');
    assert.strictEqual(typeof pair[1], 'number');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/catalog.test.js`
Expected: FAIL — `Cannot find module '../src/data/catalog.js'`

- [ ] **Step 3: Create the module**

Create `src/data/catalog.js` with the wrapper below, then **move these blocks from `app.js` verbatim** into the factory body, in this order:

1. `app.js:392-876` — the catalogue banner comment, `DEFAULT_COLOR`, `CAR_MODELS`, `skyactivServices`, `mazda3Parts`, `sharedParts`. **Stop before `buildProfile` at line 857** — that belongs to Task 4.
2. `app.js:887-917` — `NORMAL_SCHED`, `ATF_NOTE`, `atfFilterPart`, `atfSealantPart`, `fuelSystemCleanerPart`.

Then change every bare `uid()` call inside the moved code to `dep.uid()`. There are calls in `mazda3Parts`, `sharedParts`, `atfFilterPart`, `atfSealantPart` and `fuelSystemCleanerPart`.

```js
/* ============================================================
   Garage — Mazda SkyActiv catalogue. Static data plus the builders
   that stamp fresh ids onto it. No app state is read here.
   Dual-mode, like storage.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const dep = isNode ? require('../core/helpers.js') : root;
  const api = factory(dep);
  if (isNode) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {

  // ... moved blocks here, with uid() -> dep.uid()

  return {
    DEFAULT_COLOR, CAR_MODELS, NORMAL_SCHED, ATF_NOTE,
    skyactivServices, mazda3Parts, sharedParts,
    atfFilterPart, atfSealantPart, fuelSystemCleanerPart
  };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/catalog.test.js`
Expected: PASS, 7 tests. A failure naming `uid` means a bare call was missed in step 3.

- [ ] **Step 5: Delete the moved blocks from `app.js`**

Delete `app.js:392-876` up to but not including `buildProfile`, and `app.js:887-917`. `buildProfile` and `seed` stay for now and still resolve `CAR_MODELS`, `skyactivServices`, `mazda3Parts`, `sharedParts` and `DEFAULT_COLOR` as globals.

- [ ] **Step 6: Load the module**

`index.html`: add `<script src="src/data/catalog.js"></script>` after the `helpers.js` tag.
`sw.js`: add `'./src/data/catalog.js'` to `ASSETS`.

- [ ] **Step 7: Verify the app still runs**

Double-click `index.html`. Expected: the dashboard renders, Parts lists its catalogue, and adding a vehicle from Settings → Garage still offers every model.

- [ ] **Step 8: Run the whole suite and commit**

Run: `npm test`
Expected: PASS, 96 tests.

```bash
git add src/data/catalog.js test/catalog.test.js app.js index.html sw.js
git commit -m "refactor: extract the SkyActiv catalogue into src/data/catalog.js"
```

---

### Task 3: Arabic strings

**Files:**
- Create: `src/i18n/strings.ar.js`
- Modify: `app.js:24-374` (delete the `AR` object literal)
- Modify: `index.html`, `sw.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `AR: Object<string, string>` — the English-keyed Arabic dictionary. `t()` stays in `app.js` for this plan and reads `AR` as a global.

No test file. This is a data-only move with no logic; the existing render paths are its test, and asserting on translation strings would only restate the data.

- [ ] **Step 1: Create the module**

Create `src/i18n/strings.ar.js`. Move the `AR` object literal from `app.js:24-374` verbatim, including its banner comment from `app.js:19-22`.

```js
/* ============================================================
   Garage — i18n dictionary. t() keys on the English string, so any
   string not yet in here safely falls back to English.
   Dual-mode, like storage.js. Data only.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

  const AR = { /* ... moved verbatim from app.js:24-374 ... */ };

  return { AR };
});
```

- [ ] **Step 2: Delete the moved block from `app.js`**

Delete `app.js:24-374`. Keep `let lang = 'en';` on line 23 and `function t(s)` on line 375 — both move in Phase 3c.

- [ ] **Step 3: Load the module**

`index.html`: add `<script src="src/i18n/strings.ar.js"></script>` after the `catalog.js` tag.
`sw.js`: add `'./src/i18n/strings.ar.js'` to `ASSETS`.

- [ ] **Step 4: Verify both languages still render**

Double-click `index.html`. Switch to Arabic in Settings. Expected: the interface translates, the layout flips to RTL, and switching back to English restores it. A missing dictionary would leave every label in English with no error — so check the actual text, not just the absence of a console error.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`
Expected: PASS, 96 tests (unchanged — no new tests).

```bash
git add src/i18n/strings.ar.js app.js index.html sw.js
git commit -m "refactor: move the Arabic dictionary into src/i18n/strings.ar.js"
```

---

### Task 4: Normalisation and profile building

**Files:**
- Create: `src/data/normalize.js`
- Create: `test/normalize.test.js`
- Modify: `app.js:857-875` (delete `buildProfile`, `seed`), `app.js:918-963` (delete `normalizeData`)
- Modify: `index.html`, `sw.js`

**Interfaces:**
- Consumes: `dep.uid()`, from Task 1. `dep.today()`, `dep.isoDate()` from `schedule.js`. `dep.normalizeRecords(s, makeId)` from `storage.js`. `dep.CAR_MODELS`, `dep.DEFAULT_COLOR`, `dep.NORMAL_SCHED`, `dep.ATF_NOTE`, `dep.skyactivServices`, `dep.mazda3Parts`, `dep.sharedParts`, `dep.atfFilterPart`, `dep.atfSealantPart`, `dep.fuelSystemCleanerPart` from Task 2.
- Produces: `normalizeData(s) -> s` (mutates and returns), `buildProfile(modelId: string, engIdx: number, opts: {odometer?, year?, color?}) -> VehicleData`, `seed() -> VehicleData`.

- [ ] **Step 1: Write the failing test**

Create `test/normalize.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeData, buildProfile, seed } = require('../src/data/normalize.js');

test('buildProfile assembles a complete vehicle from the catalogue', () => {
  const v = buildProfile('mazda3bm', 0, { odometer: 316000, year: 2016 });
  assert.strictEqual(v.car.make, 'Mazda');
  assert.strictEqual(v.car.odometer, 316000);
  assert.strictEqual(v.car.year, 2016);
  assert.ok(v.services.length > 0);
  assert.ok(v.parts.length > 0);
  assert.deepStrictEqual(v.history, []);
  assert.deepStrictEqual(v.fuel, []);
});

test('buildProfile baselines every service at the current odometer', () => {
  const v = buildProfile('mazda3bm', 0, { odometer: 200000 });
  v.services.forEach(s => {
    assert.strictEqual(s.lastKm, 200000, `${s.name} must start from the odometer`);
    assert.ok(s.lastDate, `${s.name} needs a lastDate`);
  });
});

test('buildProfile falls back to a known model for an unknown id', () => {
  const v = buildProfile('no-such-model', 0, {});
  assert.ok(v.car.model, 'must still produce a usable car');
  assert.ok(v.services.length > 0);
});

test('seed is the owner 2016 Mazda 3 at 316,000 km', () => {
  const v = seed();
  assert.strictEqual(v.car.odometer, 316000);
  assert.strictEqual(v.car.year, 2016);
});

/* Regression for the boot crash fixed in 0ca1bb9: renderDashboard and
   renderBudget read state.budget.annual unguarded, and only seed() ever set
   it, so a legacy or imported record took the whole app down. */
test('normalizeData defaults a missing or malformed budget', () => {
  assert.strictEqual(normalizeData({ car: {} }).budget.annual, 6000);
  assert.strictEqual(normalizeData({ car: {}, budget: 'nope' }).budget.annual, 6000);
  assert.strictEqual(normalizeData({ car: {}, budget: { annual: NaN } }).budget.annual, 6000);
  assert.strictEqual(normalizeData({ car: {}, budget: { annual: 9000 } }).budget.annual, 9000);
});

test('normalizeData fills every missing array', () => {
  const s = normalizeData({ car: {} });
  ['services', 'parts', 'history', 'spending', 'fuel', 'docs'].forEach(k => {
    assert.ok(Array.isArray(s[k]), `${k} must be an array`);
  });
});

test('normalizeData defaults severity to severe and planSetupDone to false', () => {
  const s = normalizeData({ car: {} });
  assert.strictEqual(s.severity, 'severe');
  assert.strictEqual(s.planSetupDone, false);
  assert.strictEqual(normalizeData({ car: {}, severity: 'normal' }).severity, 'normal');
  assert.strictEqual(normalizeData({ car: {}, severity: 'junk' }).severity, 'severe');
});

test('normalizeData retires the standalone Fuel System Cleaner into the oil change', () => {
  const s = normalizeData({
    car: {},
    services: [
      { name: 'Engine Oil & Filter', intervalKm: 7500, intervalMonths: 6, cost: 200, lastKm: 0, lastDate: '2026-01-01' },
      { name: 'Fuel System Cleaner', intervalKm: 7500, intervalMonths: 6, cost: 45, lastKm: 0, lastDate: '2026-01-01' }
    ]
  });
  assert.ok(!s.services.find(x => x.name === 'Fuel System Cleaner'), 'standalone must be removed');
  assert.strictEqual(s.services.find(x => x.name === 'Engine Oil & Filter').cost, 245);
});

test('normalizeData is idempotent — the migrations must not fire twice', () => {
  const once = normalizeData({
    car: {},
    services: [{ name: 'Engine Oil & Filter', intervalKm: 7500, intervalMonths: 6, cost: 200, lastKm: 0, lastDate: '2026-01-01' }]
  });
  const oilAfterOnce = once.services.find(x => x.name === 'Engine Oil & Filter').cost;
  const partsAfterOnce = once.parts.length;
  const twice = normalizeData(once);
  assert.strictEqual(twice.services.find(x => x.name === 'Engine Oil & Filter').cost, oilAfterOnce);
  assert.strictEqual(twice.parts.length, partsAfterOnce);
});

test('normalizeData seeds dealer normal intervals where they differ', () => {
  const s = normalizeData({
    car: {},
    services: [{ name: 'Engine Oil & Filter', intervalKm: 7500, intervalMonths: 6, lastKm: 0, lastDate: '2026-01-01' }]
  });
  const oil = s.services.find(x => x.name === 'Engine Oil & Filter');
  assert.strictEqual(oil.normalKm, 10000);
  assert.strictEqual(oil.normalMonths, 12);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/normalize.test.js`
Expected: FAIL — `Cannot find module '../src/data/normalize.js'`

- [ ] **Step 3: Create the module**

Create `src/data/normalize.js`. Move `buildProfile` and `seed` from `app.js:856-875` and `normalizeData` from `app.js:918-963`, verbatim, then prefix every dependency call with `dep.`:

- `uid()` → `dep.uid()`
- `isoDate(today())` → `dep.isoDate(dep.today())`
- `normalizeRecords(s, uid)` → `dep.normalizeRecords(s, dep.uid)` — note the second argument is the function itself, not a call
- `CAR_MODELS`, `DEFAULT_COLOR`, `NORMAL_SCHED`, `ATF_NOTE` → `dep.CAR_MODELS`, etc.
- `skyactivServices(...)`, `mazda3Parts()`, `sharedParts()`, `fuelSystemCleanerPart()`, `atfFilterPart()`, `atfSealantPart()` → `dep.`-prefixed

```js
/* ============================================================
   Garage — record normalisation and profile assembly.
   normalizeData runs on every load and must stay idempotent: it is
   also the migration path for legacy and imported records.
   Dual-mode, like storage.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const dep = isNode
    ? Object.assign({},
        require('../../schedule.js'),
        require('../../storage.js'),
        require('../core/helpers.js'),
        require('./catalog.js'))
    : root;
  const api = factory(dep);
  if (isNode) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {

  // ... moved buildProfile, seed, normalizeData with dep.-prefixed calls

  return { normalizeData, buildProfile, seed };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/normalize.test.js`
Expected: PASS, 10 tests. A `ReferenceError` names whichever bare dependency call was missed.

- [ ] **Step 5: Delete the moved code from `app.js`**

Delete `buildProfile` and `seed` (`app.js:856-875`) and `normalizeData` (`app.js:918-963`).

- [ ] **Step 6: Load the module**

`index.html`: add `<script src="src/data/normalize.js"></script>` **after** `storage.js` and `schedule.js`, since it depends on both.
`sw.js`: add `'./src/data/normalize.js'` to `ASSETS`.

- [ ] **Step 7: Verify the app still runs**

Double-click `index.html`. Expected: the existing garage loads with its data intact. Then open a private window and load it fresh — expected: the seeded 2016 Mazda 3 at 316,000 km appears, with services baselined and no console error.

- [ ] **Step 8: Run the whole suite and commit**

Run: `npm test`
Expected: PASS, 106 tests.

```bash
git add src/data/normalize.js test/normalize.test.js app.js index.html sw.js
git commit -m "refactor: extract normalizeData, buildProfile and seed"
```

---

### Task 5: The session module

This is the task the whole plan exists for. It creates the only place that will ever know a user signed in or out.

**Files:**
- Create: `src/data/session.js`
- Create: `test/session.test.js`
- Modify: `index.html`, `sw.js`

`app.js` is **not** modified in this task — the call-site conversion is Task 6, kept separate so a reviewer can reject one without the other.

**Interfaces:**
- Consumes: `dep.uid()` from Task 1. `dep.normalizeData()` from Task 4. `dep.openStorage()`, `dep.loadAll()`, `dep.saveVehicle()`, `dep.readLegacyV1()`, `dep.applyPhotoIds()` from `storage.js`. `dep.isQuotaError()` from `schedule.js`.
- Produces:
  - `configure({ notify?, makeObjectUrl?, revokeObjectUrl?, saveVehicle? })` — injects the browser bits. `notify(msg, kind)` defaults to a no-op, `makeObjectUrl(blob)` defaults to `URL.createObjectURL`, `revokeObjectUrl(url)` defaults to `URL.revokeObjectURL`, `saveVehicle` defaults to `storage.js`'s. Called once at boot; the tests use it to inject fakes.
  - `load() -> Promise<boolean>` — opens storage, reads the garage, hydrates. **Resolves `true` when this was a first run** (nothing was stored), so the caller knows to persist the seed.
  - `current() -> VehicleData | null` — the active vehicle's data. Replaces the `state` global.
  - `garage() -> {vehicles, activeId} | null` — replaces the `garage` global.
  - `booted() -> boolean` — replaces the `booted` global.
  - `photos() -> Object<string, Blob>` — the session photo cache. Replaces the `photoBlobs` global.
  - `save() -> Promise<boolean>` — unchanged semantics from Phase 2.
  - `switchVehicle(id) -> void`
  - `setVehicles(vehicles, activeId) -> void` — used by import and add-vehicle.
  - `clear() -> void` — drops in-memory garage, revokes every live object URL, empties the photo cache.
  - `objectUrl(blob) -> string`, `revokeObjectUrls() -> void`, `refreshPhotoUrls() -> void` — the photo-URL registry, moved from `app.js:974-1021`.

- [ ] **Step 1: Write the failing test**

Create `test/session.test.js`. The fakes stand in for `storage.js` and the browser URL API, so nothing here needs IndexedDB or a DOM:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const session = require('../src/data/session.js');

/* A blob stand-in — session only ever hands these to makeObjectUrl. */
function fakeBlob(tag) { return { tag }; }

function trackedUrls() {
  const made = [], revoked = [];
  return {
    made, revoked,
    makeObjectUrl: b => { const u = `blob:${b.tag}:${made.length}`; made.push(u); return u; },
    revokeObjectUrl: u => revoked.push(u)
  };
}

function vehicle(id, nickname) {
  return { id, data: { car: { nickname, odometer: 1000 }, services: [], parts: [], history: [], spending: [], fuel: [], docs: [] } };
}

test('current() and garage() are null before load', () => {
  session.clear();
  assert.strictEqual(session.current(), null);
  assert.strictEqual(session.garage(), null);
  assert.strictEqual(session.booted(), false);
});

test('setVehicles makes the active vehicle current', () => {
  session.clear();
  session.setVehicles([vehicle('a', 'Red'), vehicle('b', 'Blue')], 'b');
  assert.strictEqual(session.current().car.nickname, 'Blue');
  assert.strictEqual(session.garage().vehicles.length, 2);
});

test('switchVehicle moves current() to the named vehicle', () => {
  session.clear();
  session.setVehicles([vehicle('a', 'Red'), vehicle('b', 'Blue')], 'a');
  session.switchVehicle('b');
  assert.strictEqual(session.current().car.nickname, 'Blue');
  assert.strictEqual(session.garage().activeId, 'b');
});

test('switchVehicle ignores an unknown id rather than blanking the app', () => {
  session.clear();
  session.setVehicles([vehicle('a', 'Red')], 'a');
  session.switchVehicle('nope');
  assert.strictEqual(session.current().car.nickname, 'Red');
});

test('objectUrl registers a URL and revokeObjectUrls releases every one', () => {
  session.clear();
  const t = trackedUrls();
  session.configure({ makeObjectUrl: t.makeObjectUrl, revokeObjectUrl: t.revokeObjectUrl });
  const u1 = session.objectUrl(fakeBlob('a'));
  const u2 = session.objectUrl(fakeBlob('b'));
  session.revokeObjectUrls();
  assert.deepStrictEqual(t.revoked.sort(), [u1, u2].sort());
  session.revokeObjectUrls();
  assert.strictEqual(t.revoked.length, 2, 'a second sweep must not double-revoke');
});

/* The Phase 4 requirement. On a shared browser, IndexedDB is per-origin, so
   without a deliberate wipe the next user to sign in boots into the previous
   user's garage. */
test('clear() leaves no garage, no live object URLs and no cached photos', () => {
  const t = trackedUrls();
  session.configure({ makeObjectUrl: t.makeObjectUrl, revokeObjectUrl: t.revokeObjectUrl });
  session.setVehicles([vehicle('a', 'Red')], 'a');
  session.objectUrl(fakeBlob('receipt'));

  session.clear();

  assert.strictEqual(session.current(), null);
  assert.strictEqual(session.garage(), null);
  assert.strictEqual(session.booted(), false);
  assert.strictEqual(t.revoked.length, 1, 'clear must revoke outstanding URLs');
  assert.deepStrictEqual(session.photos(), {}, 'photo cache must be empty');
});

test('save() returns false when there is no active vehicle', async () => {
  session.clear();
  assert.strictEqual(await session.save(), false);
});

test('save() reports failure and notifies when the backend rejects the write', async () => {
  session.clear();
  const notes = [];
  session.configure({
    notify: (msg, kind) => notes.push({ msg, kind }),
    saveVehicle: async () => ({ ok: false, error: new Error('boom') })
  });
  session.setVehicles([vehicle('a', 'Red')], 'a');

  assert.strictEqual(await session.save(), false, 'a failed write must not report success');
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].kind, 'warn');
});

test('save() returns true on a successful write', async () => {
  session.clear();
  const notes = [];
  session.configure({
    notify: (msg, kind) => notes.push({ msg, kind }),
    saveVehicle: async () => ({ ok: true, data: {}, photoIds: {} })
  });
  session.setVehicles([vehicle('a', 'Red')], 'a');

  assert.strictEqual(await session.save(), true);
  assert.strictEqual(notes.length, 0, 'a successful write must not warn');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/session.test.js`
Expected: FAIL — `Cannot find module '../src/data/session.js'`

- [ ] **Step 3: Create the module**

Create `src/data/session.js`. The bodies of `objectUrl`, `revokeObjectUrls`, `resolvePhotos`, `refreshPhotoUrls`, `hydrate`, `save`, `cacheNewPhotos` and `prunePhotoBlobs` come from `app.js:974-1067`; `switchVehicle` from `app.js:1068-1073`. `configure` and `clear` are new.

Note that `configure` also accepts a `saveVehicle` override — the tests use it to avoid a real backend. It defaults to `dep.saveVehicle`.

```js
/* ============================================================
   Garage — the session: who owns the garage in memory.
   Everything that reads vehicle data goes through current(); nothing
   else holds a reference. That is what makes sign-out possible —
   clear() is the whole of it, and no page module has to know.
   Dual-mode, like storage.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const dep = isNode
    ? Object.assign({},
        require('../../schedule.js'),
        require('../../storage.js'),
        require('../core/helpers.js'),
        require('./normalize.js'))
    : root;
  const api = factory(dep);
  if (isNode) module.exports = api;
  else root.session = api;      // a namespace, not loose globals — `save` would collide
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {

  let _garage = null;
  let _state = null;
  let _booted = false;
  let _photos = {};          // photo id -> Blob, for the active session
  let _liveUrls = [];

  /* Browser bits are injected so the whole module is testable under Node,
     and so a future sign-in flow can swap the notifier. */
  let env = {
    notify: () => {},
    makeObjectUrl: b => URL.createObjectURL(b),
    revokeObjectUrl: u => URL.revokeObjectURL(u),
    saveVehicle: null        // null means "use dep.saveVehicle"
  };
  function configure(next) { env = Object.assign({}, env, next || {}); }

  function current() { return _state; }
  function garage() { return _garage; }
  function booted() { return _booted; }
  function photos() { return _photos; }

  function objectUrl(blob) {
    const url = env.makeObjectUrl(blob);
    _liveUrls.push(url);
    return url;
  }

  function revokeObjectUrls() {
    _liveUrls.forEach(u => { try { env.revokeObjectUrl(u); } catch (e) {} });
    _liveUrls = [];
  }

  /* Moved from app.js, reading _photos instead of photoBlobs and calling
     dependencies through dep.:
       hydrate          app.js:989-1004   — dep.readLegacyV1, dep.normalizeData, dep.uid
       resolvePhotos    app.js:1008-1013  — calls objectUrl above
       refreshPhotoUrls app.js:1018-1021  — guard becomes `if (!_garage) return;`
       cacheNewPhotos   app.js:1058-1066
       prunePhotoBlobs  app.js:1050-1055
     hydrate keeps its signature, hydrate(garage, photos) -> {garage, state}. */

  function setVehicles(vehicles, activeId) {
    _garage = { vehicles, activeId };
    const active = vehicles.find(v => v.id === activeId) || vehicles[0] || null;
    _garage.activeId = active ? active.id : null;
    _state = active ? active.data : null;
  }

  function switchVehicle(id) {
    if (!_garage) return;
    const v = _garage.vehicles.find(x => x.id === id);
    if (!v) return;                 // unknown id must not blank the app
    _garage.activeId = id;
    _state = v.data;
  }

  /* Boot. Mirrors app.js:3211-3219, with hydrate moved in from app.js:989. */
  function load() {
    return dep.openStorage()
      .then(dep.loadAll)
      .then(({ garage: g, photos: p }) => {
        _photos = p || {};
        const h = hydrate(g, _photos);
        _garage = h.garage;
        _state = h.state;
        _booted = true;
        return !g || !g.vehicles || !g.vehicles.length;   // true => first run, caller should save()
      });
  }

  function save() {
    if (!_garage) return Promise.resolve(false);
    const v = _garage.vehicles.find(x => x.id === _garage.activeId);
    if (!v) return Promise.resolve(false);
    v.data = _state;
    const data = _state;        // `_state` may move before this resolves
    const doSave = env.saveVehicle || dep.saveVehicle;
    return Promise.resolve(doSave(v.id, data, _garage.activeId, dep.uid)).then(res => {
      if (res.ok) {
        dep.applyPhotoIds(data, res.data);
        cacheNewPhotos(data, res.photoIds);
        prunePhotoBlobs();
        return true;
      }
      env.notify(dep.isQuotaError(res.error)
        ? 'Storage is full — your change was NOT saved. Remove some receipt photos.'
        : 'Could not save your change.', 'warn');
      return false;
    });
  }

  /* Sign-out, in full. Phase 4 adds a storage wipe beside this call; nothing
     else in the app needs to change. */
  function clear() {
    revokeObjectUrls();
    _garage = null;
    _state = null;
    _booted = false;
    _photos = {};
  }

  return {
    configure, load, save, clear,
    current, garage, booted, photos,
    setVehicles, switchVehicle,
    objectUrl, revokeObjectUrls, refreshPhotoUrls
  };
});
```

Two deliberate differences from the `app.js` original, both required by the tests:
- `save()` no longer calls `t()` or `toast()` directly. It calls `env.notify(...)` with the English string; Task 6 wires `notify` to `(msg, kind) => toast(t(msg), kind)` so the Arabic translation still happens.
- `switchVehicle` now ignores an unknown id. The original assumed the id was valid.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/session.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Load the module**

`index.html`: add `<script src="src/data/session.js"></script>` after `normalize.js`.
`sw.js`: add `'./src/data/session.js'` to `ASSETS`.

The app does not use it yet — `app.js` still holds its own copies. Loading it now keeps this task's diff reviewable and confirms the script parses in the browser.

- [ ] **Step 6: Run the whole suite and commit**

Run: `npm test`
Expected: PASS, 115 tests. The app is unchanged in behaviour.

```bash
git add src/data/session.js test/session.test.js index.html sw.js
git commit -m "feat: add src/data/session.js, the garage lifecycle owner"
```

---

### Task 6: Route `app.js` through the session

The mechanical pass. 125 `state.` reads, plus the `garage`, `booted` and `photoBlobs` globals.

**Files:**
- Modify: `app.js` throughout

**Interfaces:**
- Consumes: everything Task 5 produces.
- Produces: an `app.js` with no `state`, `garage`, `booted`, `photoBlobs` or `liveObjectUrls` globals of its own.

- [ ] **Step 1: Delete the duplicated machinery from `app.js`**

Remove, now that `session.js` owns them:
- `app.js:971-972` — `let state = null;`, `let photoBlobs = {};`
- `app.js:974-1021` — `liveObjectUrls`, `objectUrl`, `revokeObjectUrls`, `hydrate`, `resolvePhotos`, `refreshPhotoUrls`
- `app.js:1023-1041` — `save`
- `app.js:1050-1067` — `prunePhotoBlobs`, `cacheNewPhotos`
- `app.js:1068-1073` — `switchVehicle`
- `app.js:882` — `let garage;`
- `app.js:886` — `let booted = false;`

- [ ] **Step 2: Add local aliases at the top of `app.js`**

So the 125 call sites become a rename rather than a rewrite, put these immediately after the `/* ---------- helpers ---------- */` comment:

```js
/* The session owns the garage; app.js reads it through these. Phase 3c
   deletes them along with this file, and each page module calls
   session.current() directly. */
const save = () => session.save();
const switchVehicle = id => session.switchVehicle(id);
const objectUrl = b => session.objectUrl(b);
const revokeObjectUrls = () => session.revokeObjectUrls();
const refreshPhotoUrls = () => session.refreshPhotoUrls();
```

`session` is the namespace Task 5's wrapper assigned to the global object (`root.session = api`), which is why `session.save` does not collide with the `save` alias above.

- [ ] **Step 3: Replace the state reads**

Throughout `app.js`, replace:
- `state.` → `session.current().`  (125 sites)
- bare `garage` → `session.garage()` (the variable, not the `openGarage` function or the `garageBtn` id)
- `booted` → `session.booted()`
- `photoBlobs` → `session.photos()`

Two sites need more than a rename:
- `app.js:1026` in the old `save()` is deleted, not converted.
- `app.js:1019` `if (!garage || !photoBlobs) return;` is inside the deleted `refreshPhotoUrls`.

Where a function assigned to `state` — for example the boot path and `importGarage` — call `session.setVehicles(vehicles, activeId)` instead.

- [ ] **Step 4: Rewrite the boot block**

Replace `app.js:3211-3230` with:

```js
session.configure({ notify: (msg, kind) => toast(t(msg), kind) });

session.load()
  .then(firstRun => { if (firstRun) return session.save(); })
  .then(() => {
    applyAccent();
    renderTopbar();
    go('dashboard');
  })
  .catch(err => {
    document.getElementById('view').innerHTML =
      `<div class="card" style="padding:20px"><h3>${t('Could not open your garage')}</h3><p style="color:var(--text-2);margin-top:8px">${t('Your data is safe. Please reload the page.')}</p></div>`;
    console.error(err);
  });
```

`session.load()` sets `booted` itself, so the old `booted = true;` line goes. A failed boot leaves `session.booted()` false, preserving the guard that stops a stray tap crashing into a null state.

- [ ] **Step 5: Verify no orphaned references remain**

Run: `grep -n '\bstate\.\|\bphotoBlobs\b\|\bliveObjectUrls\b' app.js`
Expected: no output. Any hit is a missed call site.

Run: `grep -n 'let garage\|let booted\|let state' app.js`
Expected: no output.

- [ ] **Step 6: Verify the app still works**

Double-click `index.html` and exercise the paths that touch the session:
- The dashboard renders with the right odometer and health score.
- Logging a fuel entry saves and the list updates.
- Settings → Garage switches between vehicles and the whole app follows.
- Adding a vehicle works, and so does deleting one.
- Export produces a file; importing it back reproduces the garage.
- A receipt photo still displays after navigating away and back — this exercises the object-URL registry.

- [ ] **Step 7: Run the whole suite and commit**

Run: `npm test`
Expected: PASS, 115 tests.

```bash
git add app.js src/data/session.js
git commit -m "refactor: route app.js through session.js instead of module globals"
```

---

### Task 7: Pure service status

`serviceStatus` and friends currently read the `state` global for severity and odometer. Making them take those explicitly is what lets them be tested without a session at all.

**Files:**
- Create: `src/data/status.js`
- Create: `test/status.test.js`
- Modify: `app.js:966-967` (delete `svKm`, `svMo`), `app.js:1197-1222` (delete `serviceStatus`, `servicesRanked`, `healthScore`)
- Modify: `index.html`, `sw.js`

**Interfaces:**
- Consumes: `dep.clamp()`, `dep.parseDate()`, `dep.monthsBetween()`, `dep.addMonths()` from Task 1. `dep.today()`, `dep.healthFrom()` from `schedule.js`.
- Produces:
  - `svKm(s: Service, severity: string) -> number`
  - `svMo(s: Service, severity: string) -> number`
  - `serviceStatus(s: Service, ctx: {odometer: number, severity: string}) -> {dueKm, kmLeft, dueDate, daysLeft, prog, level, drivenByTime}`
  - `servicesRanked(data: VehicleData) -> Array<{s, st}>`
  - `healthScore(data: VehicleData) -> number`

The signature change is the point of the task: `state` is no longer reachable from here.

- [ ] **Step 1: Write the failing test**

Create `test/status.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { svKm, svMo, serviceStatus, servicesRanked, healthScore } = require('../src/data/status.js');
const { isoDate, today } = require('../schedule.js');

/* A service due exactly `kmAgo` km and `monthsAgo` months back. */
function svc(name, opts) {
  const o = Object.assign({ intervalKm: 10000, intervalMonths: 12, lastKm: 0 }, opts);
  const d = new Date(today());
  d.setMonth(d.getMonth() - (o.monthsAgo || 0));
  return { name, intervalKm: o.intervalKm, intervalMonths: o.intervalMonths,
           normalKm: o.normalKm, normalMonths: o.normalMonths,
           lastKm: o.lastKm, lastDate: isoDate(d) };
}

test('svKm and svMo take the severe interval by default', () => {
  const s = svc('Oil', { intervalKm: 7500, intervalMonths: 6, normalKm: 10000, normalMonths: 12 });
  assert.strictEqual(svKm(s, 'severe'), 7500);
  assert.strictEqual(svMo(s, 'severe'), 6);
});

test('svKm and svMo take the dealer interval when severity is normal', () => {
  const s = svc('Oil', { intervalKm: 7500, intervalMonths: 6, normalKm: 10000, normalMonths: 12 });
  assert.strictEqual(svKm(s, 'normal'), 10000);
  assert.strictEqual(svMo(s, 'normal'), 12);
});

test('svKm falls back to the severe interval when no dealer value exists', () => {
  const s = svc('Wipers', { intervalKm: 20000, intervalMonths: 12 });
  assert.strictEqual(svKm(s, 'normal'), 20000);
  assert.strictEqual(svMo(s, 'normal'), 12);
});

test('a service well inside its interval is ok', () => {
  const st = serviceStatus(svc('Oil', { intervalKm: 10000, monthsAgo: 0 }), { odometer: 1000, severity: 'severe' });
  assert.strictEqual(st.level, 'ok');
  assert.strictEqual(st.kmLeft, 9000);
  assert.strictEqual(st.dueKm, 10000);
});

test('a service within 1200 km of due is a warning', () => {
  const st = serviceStatus(svc('Oil', { intervalKm: 10000, monthsAgo: 0 }), { odometer: 9000, severity: 'severe' });
  assert.strictEqual(st.level, 'warn');
});

test('a service past its distance is danger', () => {
  const st = serviceStatus(svc('Oil', { intervalKm: 10000, monthsAgo: 0 }), { odometer: 11000, severity: 'severe' });
  assert.strictEqual(st.level, 'danger');
  assert.ok(st.kmLeft < 0);
});

/* Time and distance are independent triggers — a car that barely moves still
   needs its oil changed. */
test('a service past its months is danger even at zero km', () => {
  const st = serviceStatus(svc('Oil', { intervalKm: 10000, intervalMonths: 6, monthsAgo: 8 }), { odometer: 0, severity: 'severe' });
  assert.strictEqual(st.level, 'danger');
  assert.strictEqual(st.drivenByTime, true);
});

test('prog is clamped to 1.2 however far overdue the service is', () => {
  const st = serviceStatus(svc('Oil', { intervalKm: 10000, monthsAgo: 0 }), { odometer: 500000, severity: 'severe' });
  assert.strictEqual(st.prog, 1.2);
});

test('severity changes the verdict for the same odometer', () => {
  const s = svc('Oil', { intervalKm: 7500, intervalMonths: 6, normalKm: 10000, normalMonths: 12, monthsAgo: 0 });
  assert.strictEqual(serviceStatus(s, { odometer: 8000, severity: 'severe' }).level, 'danger');
  assert.strictEqual(serviceStatus(s, { odometer: 8000, severity: 'normal' }).level, 'ok');
});

test('servicesRanked puts the most urgent service first', () => {
  const data = {
    car: { odometer: 9500 },
    severity: 'severe',
    services: [svc('Fresh', { intervalKm: 40000 }), svc('Overdue', { intervalKm: 5000 })]
  };
  assert.strictEqual(servicesRanked(data)[0].s.name, 'Overdue');
});

test('healthScore is 100 when everything is ok and drops when something is overdue', () => {
  const healthy = { car: { odometer: 100 }, severity: 'severe', services: [svc('Oil', { intervalKm: 10000 })] };
  const sick = { car: { odometer: 99000 }, severity: 'severe', services: [svc('Oil', { intervalKm: 10000 })] };
  assert.strictEqual(healthScore(healthy), 100);
  assert.ok(healthScore(sick) < 100);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/status.test.js`
Expected: FAIL — `Cannot find module '../src/data/status.js'`

- [ ] **Step 3: Create the module**

Create `src/data/status.js`. Move the bodies from `app.js:966-967` and `app.js:1197-1222`, changing the signatures so nothing reads a global:

```js
/* ============================================================
   Garage — service status. Pure: every input arrives as an argument,
   so the schedule maths can be tested without a session or a DOM.
   Dual-mode, like storage.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const dep = isNode
    ? Object.assign({}, require('../../schedule.js'), require('../core/helpers.js'))
    : root;
  const api = factory(dep);
  if (isNode) module.exports = api;
  else root.Status = api;       // a namespace — the adapters in app.js reuse these names
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {

  /* Severe = the app's own Jeddah values; normal = the dealer values where a
     service defines them, else the same. */
  function svKm(s, severity) { return (severity === 'normal' && s.normalKm) ? s.normalKm : s.intervalKm; }
  function svMo(s, severity) { return (severity === 'normal' && s.normalMonths) ? s.normalMonths : s.intervalMonths; }

  function serviceStatus(s, ctx) {
    const odo = ctx.odometer;
    const ikm = svKm(s, ctx.severity), imo = svMo(s, ctx.severity);
    const dueKm = s.lastKm + ikm;
    const kmLeft = dueKm - odo;
    const dueDate = dep.addMonths(dep.parseDate(s.lastDate), imo);
    const daysLeft = Math.round((dueDate - dep.today()) / 86400000);
    const kmProg = (odo - s.lastKm) / ikm;
    const timeProg = dep.monthsBetween(dep.parseDate(s.lastDate), dep.today()) / imo;
    const prog = Math.max(kmProg, timeProg);
    const drivenByTime = timeProg >= kmProg;
    let level = 'ok';
    if (kmLeft <= 0 || daysLeft <= 0) level = 'danger';
    else if (kmLeft <= 1200 || daysLeft <= 30) level = 'warn';
    return { dueKm, kmLeft, dueDate, daysLeft, prog: dep.clamp(prog, 0, 1.2), level, drivenByTime };
  }

  function ctxOf(data) { return { odometer: data.car.odometer, severity: data.severity }; }

  function servicesRanked(data) {
    const ctx = ctxOf(data);
    return data.services
      .map(s => ({ s, st: serviceStatus(s, ctx) }))
      .sort((a, b) => a.st.prog === b.st.prog ? a.st.kmLeft - b.st.kmLeft : b.st.prog - a.st.prog);
  }

  function healthScore(data) {
    const ctx = ctxOf(data);
    return dep.healthFrom(data.services.map(s => serviceStatus(s, ctx).level));
  }

  return { svKm, svMo, serviceStatus, servicesRanked, healthScore };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/status.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Delete the moved code and update the call sites in `app.js`**

Delete `svKm`/`svMo` (`app.js:966-967`) and `serviceStatus`/`servicesRanked`/`healthScore` (`app.js:1197-1222`). Keep `openHealthBreakdown` and `yearSpend` — they are UI and move in Phase 3c.

Add these adapters beside the other session aliases at the top of `app.js`, so the existing call sites keep their old arity:

```js
/* Status functions are pure now; these thread the session through so the
   render code reads unchanged until Phase 3c moves it. */
const svKm = s => Status.svKm(s, session.current().severity);
const svMo = s => Status.svMo(s, session.current().severity);
const serviceStatus = s => Status.serviceStatus(s, { odometer: session.current().car.odometer, severity: session.current().severity });
const servicesRanked = () => Status.servicesRanked(session.current());
const healthScore = () => Status.healthScore(session.current());
```

`Status` is the namespace Task 7's wrapper assigned (`root.Status = api`), which is why these adapters can reuse the original function names.

- [ ] **Step 6: Load the module**

`index.html`: add `<script src="src/data/status.js"></script>` after `session.js`.
`sw.js`: add `'./src/data/status.js'` to `ASSETS`.

- [ ] **Step 7: Verify the app still works**

Double-click `index.html` and check the numbers specifically, since this task moved the maths:
- The dashboard health score matches what it showed before the change.
- Maintenance lists services in urgency order, with the same colours.
- Settings → schedule basis, toggled between severe and normal, changes the due distances.
- Tapping the health score opens the breakdown with the same services listed.

- [ ] **Step 8: Run the whole suite and commit**

Run: `npm test`
Expected: PASS, 126 tests.

```bash
git add src/data/status.js test/status.test.js app.js index.html sw.js
git commit -m "refactor: make service status pure and move it to src/data/status.js"
```

---

## Done when

- `npm test` passes with 126 tests.
- `app.js` is roughly 1,300 lines, down from 3,235.
- `grep -n '\bstate\.' app.js` returns nothing.
- The app runs by double-clicking `index.html`, in both English and Arabic.
- The app works offline after a hard reload on a served copy.
- No visible change anywhere in the UI.
- `session.clear()` is the single function Phase 4 will call on sign-out.

## What this plan does not do

Phase 3b covers `src/ui/html.js` and the 232-site escaping conversion. Phase 3c covers the six page modules, `src/i18n/lang.js`, `src/ui/*`, `main.js`, moving `storage.js`/`schedule.js`/`ui.js` into `src/`, and deleting `app.js`.
