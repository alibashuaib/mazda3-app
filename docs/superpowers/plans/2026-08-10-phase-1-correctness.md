# Phase 1: Correctness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the app reporting wrong numbers — real clock, honest save failures, correct plan milestones, a plan view that never empties out — plus the three accuracy-related UI adjustments assigned to Phase 1.

**Architecture:** A new `schedule.js` holds the pure schedule math as a dual-mode script: loaded by a plain `<script>` tag in the browser (assigning to `window`), and `require()`d by Node tests. `app.js` keeps its existing structure and calls into it. This creates the seam Phase 3 formalises without doing Phase 3's module split now.

**Tech Stack:** Vanilla JS (ES2020), no framework, no bundler. Node 24 LTS with the built-in `node --test` runner — **development only**, the shipped app has zero dependencies.

## Global Constraints

- **No build step.** The app must keep running by opening `index.html` directly from disk.
- **No runtime dependencies.** Node is a dev tool for tests only; never `import`/`require` anything in browser code.
- `schedule.js` must work **both** as a browser `<script>` (assigns to global) and under Node `require()`. It must not reference `window`, `document`, `localStorage`, or the `state` global.
- **Every user-facing string goes through `t()`**, and gets an Arabic entry in the `AR` dictionary (`app.js:25-339`). Arabic is a first-class language in this app, not an afterthought.
- **Match existing code style:** 2-space indent, single quotes, semicolons, `const`/`let`, no trailing commas in multiline literals.
- **Commit after every task.** No task leaves the tree broken.
- **Line numbers in this plan refer to the original files** and drift as earlier tasks insert code. Always locate the edit by matching the quoted "before" snippet, not by jumping to the line number.
- Node is installed at v24.19.0 but **is not on the PATH of already-running shells**. If `node` is not found, use `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")` first.

## Corrections to the spec found while planning

Read these before starting — two spec items are smaller than written, and one defect was missed.

1. **System theme already works.** `app.js:2853-2860` already defaults to the OS preference and keeps following it until the user picks manually. The spec's "add it and make it the default" is already done. Task 7 is therefore reduced to: add a way to get *back* to system, and fix the theme flash caused by `data-theme="dark"` being hardcoded in `index.html:2`.
2. **Fuel logs already advance the odometer.** `app.js:2138` — `if (odo > state.car.odometer) state.car.odometer = odo;`. The spec's "derive the odometer from the most recent fuel log" is already done. Task 5 is reduced to the staleness nudge.
3. **New defect, not in the spec:** `yearSpend(2026)` is hardcoded at `app.js:1053`, `app.js:1751` and `app.js:1954`. This is the same frozen-time bug as `TODAY` and is fixed in Task 1.

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `schedule.js` | Create | Pure schedule math and date helpers. No DOM, no globals, no `state`. |
| `test/schedule.test.js` | Create | Node tests for every function in `schedule.js`. |
| `app.js` | Modify | Calls into `schedule.js`; keeps all DOM/state work. |
| `index.html` | Modify | Loads `schedule.js` before `app.js`; anti-flash theme script. |
| `sw.js` | Modify | Caches `schedule.js`; cache version bumped. |
| `styles.css` | Modify | One rule: the health ring reads as interactive (Task 6). |

---

### Task 1: Test harness, `schedule.js` seam, and the real clock

Fixes defect 1 (frozen clock) and the hardcoded `yearSpend(2026)` calls.

**Files:**
- Create: `schedule.js`
- Create: `test/schedule.test.js`
- Modify: `app.js:8` (delete `TODAY`), all `TODAY` call sites, `app.js:1053`, `app.js:1751`, `app.js:1954`
- Modify: `index.html:84`
- Modify: `sw.js:2-3`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `today()` → `Date` at local midnight. Global in browser, `require('./schedule.js').today` in Node. Every later task uses it.

- [ ] **Step 1: Write the failing test**

Create `test/schedule.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { today } = require('../schedule.js');

test('today() returns local midnight', () => {
  const d = today();
  assert.strictEqual(d.getHours(), 0);
  assert.strictEqual(d.getMinutes(), 0);
  assert.strictEqual(d.getSeconds(), 0);
  assert.strictEqual(d.getMilliseconds(), 0);
});

test('today() tracks the system clock rather than a fixed date', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-10T09:00:00') });
  const first = today();
  t.mock.timers.tick(48 * 60 * 60 * 1000);
  const second = today();
  assert.strictEqual(second.getTime() - first.getTime(), 48 * 60 * 60 * 1000);
});
```

January is used deliberately — no daylight-saving transition in any timezone, so the 48-hour assertion holds wherever the test runs.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test`
Expected: FAIL — `Cannot find module '../schedule.js'`

- [ ] **Step 3: Create `schedule.js` with the minimal implementation**

```js
/* ============================================================
   Garage — pure schedule math.
   Dual-mode: a plain <script> in the browser (assigns to the global
   object) and require()d by the Node tests. Must stay free of DOM,
   localStorage and the app's `state` global so it is testable.
   ============================================================ */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

  /* The current date at local midnight. Called per render — never cached,
     so the app stays correct when left open across midnight. */
  function today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  return { today };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test`
Expected: PASS, 2 tests

- [ ] **Step 5: Load `schedule.js` in the browser**

In `index.html`, replace line 84:

```html
  <script src="app.js"></script>
```

with:

```html
  <script src="schedule.js"></script>
  <script src="app.js"></script>
```

Order matters — `app.js` calls `today()` at load time.

- [ ] **Step 6: Delete the frozen constant**

In `app.js`, delete line 8 entirely:

```js
const TODAY = new Date('2026-08-02');
```

- [ ] **Step 7: Replace every `TODAY` usage with `today()`**

Replace all remaining occurrences of the bare identifier `TODAY` with `today()`. There are 25 lines: 344, 836, 973, 976, 1117, 1183, 1219, 1262, 1289, 1359, 1513, 1887, 1894, 1981 (two occurrences on this line), 2123, 2155, 2508, 2510, 2512, 2527, 2547, 2587, 2603, 2679, 2700.

Examples of the transformation:

```js
// before
const days = Math.round((d - TODAY) / 86400000);
// after
const days = Math.round((d - today()) / 86400000);
```

```js
// before
for (let i = 5; i >= 0; i--) { const d = new Date(TODAY.getFullYear(), TODAY.getMonth() - i, 1); months.push(d); }
// after
for (let i = 5; i >= 0; i--) { const d = new Date(today().getFullYear(), today().getMonth() - i, 1); months.push(d); }
```

Note this also silently fixes a latent inconsistency: `new Date('2026-08-02')` parsed as **UTC** midnight while `parseDate()` (`app.js:17`) produces **local** midnight, so day-count arithmetic was off by the UTC offset. `today()` is local midnight, matching `parseDate`.

- [ ] **Step 8: Fix the hardcoded spending year**

At `app.js:1053`, `app.js:1751` and `app.js:1954`, replace:

```js
  const spent = yearSpend(2026);
```

with:

```js
  const spent = yearSpend(today().getFullYear());
```

- [ ] **Step 9: Verify no frozen date remains**

Run: `grep -n "TODAY\|yearSpend(2026)\|2026-08-02" app.js`
Expected: no output.

- [ ] **Step 10: Cache the new file in the service worker**

In `sw.js`, change lines 2-3 to:

```js
const CACHE = 'garage-v3';
const ASSETS = ['./', './index.html', './styles.css', './schedule.js', './app.js', './manifest.webmanifest', './icon.svg'];
```

The cache name must change, or existing installs keep serving the old asset list and never fetch `schedule.js`.

- [ ] **Step 11: Verify in the browser**

Open `index.html`. Confirm: the app loads with no console errors, the Dashboard renders, and the "Next up" section heading shows the **current** year rather than 2026.

- [ ] **Step 12: Commit**

```bash
git add schedule.js test/schedule.test.js app.js index.html sw.js
git commit -m "fix: use the real clock instead of a hardcoded date

TODAY was a module-level constant pinned to 2026-08-02, so every due
date, overdue flag, health score and plan projection was computed
against a frozen date. yearSpend(2026) was hardcoded in three places.

Adds schedule.js as a dual-mode module (browser script + Node require)
holding pure schedule math, with tests."
```

---

### Task 2: Surface save failures instead of swallowing them

Fixes defect 2.

**Files:**
- Modify: `schedule.js` (add `isQuotaError`)
- Modify: `test/schedule.test.js`
- Modify: `app.js:911` (`persistGarage`), `app.js:927` (`save`), `app.js:338` (AR dictionary)

**Interfaces:**
- Consumes: nothing from Task 1 beyond the file existing.
- Produces: `isQuotaError(err)` → `boolean`. `persistGarage()` and `save()` now return `boolean` (true = written).

- [ ] **Step 1: Write the failing test**

Append to `test/schedule.test.js`:

```js
const { isQuotaError } = require('../schedule.js');

test('isQuotaError detects the standard quota error', () => {
  assert.strictEqual(isQuotaError({ name: 'QuotaExceededError' }), true);
});

test('isQuotaError detects the Firefox and legacy variants', () => {
  assert.strictEqual(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), true);
  assert.strictEqual(isQuotaError({ code: 22 }), true);
});

test('isQuotaError rejects unrelated errors and rubbish input', () => {
  assert.strictEqual(isQuotaError(new TypeError('nope')), false);
  assert.strictEqual(isQuotaError(null), false);
  assert.strictEqual(isQuotaError(undefined), false);
});
```

Each task shows its own `require` line so the dependency is explicit. Merging them all into the single destructured `require` at the top of the file is equivalent and tidier — do whichever you prefer, but do not declare the same name twice.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test`
Expected: FAIL — `isQuotaError is not a function`

- [ ] **Step 3: Implement `isQuotaError`**

In `schedule.js`, add inside the factory, before the `return`:

```js
  /* localStorage quota errors, across browsers. Chrome/Safari throw
     QuotaExceededError, Firefox NS_ERROR_DOM_QUOTA_REACHED, older
     engines set legacy code 22. */
  function isQuotaError(err) {
    if (!err) return false;
    return err.name === 'QuotaExceededError'
      || err.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || err.code === 22;
  }
```

And extend the return to `return { today, isQuotaError };`

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test`
Expected: PASS, 5 tests

- [ ] **Step 5: Make `persistGarage` honest**

In `app.js`, replace line 911:

```js
function persistGarage() { try { localStorage.setItem(GKEY, JSON.stringify(garage)); } catch (e) {} }
```

with:

```js
/* Returns true when the write succeeded. A silent failure here used to
   lose the user's data with no indication at all. */
function persistGarage() {
  try {
    localStorage.setItem(GKEY, JSON.stringify(garage));
    return true;
  } catch (e) {
    toast(isQuotaError(e)
      ? 'Storage is full — your change was NOT saved. Remove some receipt photos.'
      : 'Could not save your change.', 'warn');
    return false;
  }
}
```

- [ ] **Step 6: Propagate the result from `save`**

In `app.js`, replace line 927:

```js
function save() { const v = garage.vehicles.find(v => v.id === garage.activeId); if (v) v.data = state; persistGarage(); }
```

with:

```js
function save() { const v = garage.vehicles.find(v => v.id === garage.activeId); if (v) v.data = state; return persistGarage(); }
```

- [ ] **Step 7: Add the Arabic strings**

In `app.js`, immediately before the closing `};` of the `AR` object at line 339, add:

```js

  // storage errors
  'Storage is full — your change was NOT saved. Remove some receipt photos.': 'مساحة التخزين ممتلئة — لم يتم حفظ التغيير. احذف بعض صور الإيصالات.',
  'Could not save your change.': 'تعذّر حفظ التغيير.',
```

- [ ] **Step 8: Verify in the browser**

Open `index.html`, then in the console run:

```js
localStorage.setItem('garage.filler', 'x'.repeat(5 * 1024 * 1024));
```

That throws immediately if it alone exceeds quota — if so, halve the length until it succeeds. Then edit the odometer in the app and save. Expected: an orange toast reading "Storage is full — your change was NOT saved." Clean up with `localStorage.removeItem('garage.filler')`.

- [ ] **Step 9: Commit**

```bash
git add schedule.js test/schedule.test.js app.js
git commit -m "fix: report save failures instead of swallowing them

persistGarage() caught every error and discarded it, so hitting the
localStorage quota lost the user's data with no indication. It now
returns a boolean and toasts a specific message on quota exhaustion."
```

---

### Task 3: Correct plan milestones

Fixes defect 4 — the bug that silently deletes recurring services from the plan.

**Files:**
- Modify: `schedule.js` (add `mergeMilestones`)
- Modify: `test/schedule.test.js`
- Modify: `app.js:1161-1185` (`planForward`)

**Interfaces:**
- Consumes: `today()` from Task 1.
- Produces: `mergeMilestones(occurrences, tolerance)` where `occurrences` is `Array<{ km: number, service: object }>` and the return is `Array<{ km: number, items: object[] }>`, sorted ascending by `km`. `planForward()` keeps its existing return shape: `Array<{ km, items, major, date }>`.

**Background — why the current code is wrong.** `app.js:1177` snaps each occurrence onto a 10,000 km grid with `Math.round(k / step) * step`, then `add()` refuses to push a service into a bucket that already contains it. With a 7,500 km oil change, occurrences at 346,000 and 353,500 both round to 350,000, so the second is discarded. The replacement never snaps; it merges *adjacent* occurrences within a tolerance and starts a new milestone whenever the service is already present.

- [ ] **Step 1: Write the failing test**

Append to `test/schedule.test.js`:

```js
const { mergeMilestones } = require('../schedule.js');

test('mergeMilestones groups nearby occurrences of different services', () => {
  const oil = { name: 'Oil' }, air = { name: 'Air' };
  const out = mergeMilestones([
    { km: 320000, service: oil },
    { km: 320500, service: air }
  ], 1000);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].km, 320000);
  assert.deepStrictEqual(out[0].items, [oil, air]);
});

test('mergeMilestones never merges a service with itself', () => {
  const oil = { name: 'Oil' };
  const out = mergeMilestones([
    { km: 320000, service: oil },
    { km: 320500, service: oil }
  ], 1000);
  assert.strictEqual(out.length, 2);
});

test('mergeMilestones keeps occurrences beyond the tolerance separate', () => {
  const oil = { name: 'Oil' }, air = { name: 'Air' };
  const out = mergeMilestones([
    { km: 320000, service: oil },
    { km: 325000, service: air }
  ], 1000);
  assert.strictEqual(out.length, 2);
});

test('mergeMilestones preserves every occurrence of a 7500km interval', () => {
  // The regression this task exists for: grid-snapping to 10000 used to
  // collapse ~40 oil changes into ~30.
  const oil = { name: 'Oil' };
  const occurrences = [];
  for (let km = 323500; km <= 616000; km += 7500) occurrences.push({ km, service: oil });
  const out = mergeMilestones(occurrences, 1000);
  assert.strictEqual(out.length, occurrences.length);
});

test('mergeMilestones sorts unsorted input and handles empty input', () => {
  const a = { name: 'A' }, b = { name: 'B' };
  const out = mergeMilestones([{ km: 9000, service: b }, { km: 1000, service: a }], 1000);
  assert.deepStrictEqual(out.map(m => m.km), [1000, 9000]);
  assert.deepStrictEqual(mergeMilestones([], 1000), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test`
Expected: FAIL — `mergeMilestones is not a function`

- [ ] **Step 3: Implement `mergeMilestones`**

In `schedule.js`, add inside the factory:

```js
  /* Group service occurrences into workshop visits. Occurrences within
     `tolerance` km of the milestone that started the group join it — but a
     service is never added to a milestone it is already in, because that
     would silently drop a recurrence. */
  function mergeMilestones(occurrences, tolerance) {
    const sorted = occurrences.slice().sort((a, b) => a.km - b.km);
    const out = [];
    sorted.forEach(o => {
      const last = out[out.length - 1];
      if (last && o.km - last.km <= tolerance && !last.items.includes(o.service)) last.items.push(o.service);
      else out.push({ km: o.km, items: [o.service] });
    });
    return out;
  }
```

Extend the return to `return { today, isQuotaError, mergeMilestones };`

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test`
Expected: PASS, 10 tests

- [ ] **Step 5: Rewrite `planForward` to use it**

In `app.js`, replace the whole of `planForward` (lines 1161-1185) with:

```js
const MILESTONE_TOLERANCE_KM = 1000; // services this close share one workshop visit
function planForward() {
  const odo = state.car.odometer || 0;
  const dpk = state.car.dailyKm || 40;
  const horizon = odo + 300000; // far enough that recurring services (ATF 60–80k, etc.) repeat for years
  const occurrences = [];
  state.services.filter(s => svKm(s) > 0).forEach(s => {
    const ikm = svKm(s);
    let k = serviceStatus(s).dueKm;   // first upcoming due (lastKm + interval)
    if (k < odo) {                    // overdue → due now, then continue on its interval
      occurrences.push({ km: odo, service: s });
      k += Math.ceil((odo - k) / ikm) * ikm;
      if (k <= odo) k += ikm;         // must resume strictly past odo, or we duplicate the push above
    }
    for (; k <= horizon; k += ikm) occurrences.push({ km: k, service: s });
  });
  return mergeMilestones(occurrences, MILESTONE_TOLERANCE_KM).map(ms => ({
    km: ms.km,
    items: ms.items,
    major: ms.items.some(s => svKm(s) >= 60000),
    date: new Date(today().getTime() + Math.max(0, (ms.km - odo) / dpk) * 86400000)
  }));
}
```

- [ ] **Step 6: Verify in the browser**

Open `index.html` → Maintenance → Plan. Confirm: milestone distances are now real due points (e.g. 323,500 km) rather than round 10,000s, and consecutive oil-change milestones are 7,500 km apart with none missing.

- [ ] **Step 7: Commit**

```bash
git add schedule.js test/schedule.test.js app.js
git commit -m "fix: stop the plan silently dropping recurring services

planForward snapped milestones to a 10000km grid, and the bucket
helper refused to add a service already present in a bucket. With a
7500km oil change, occurrences that rounded into the same bucket were
discarded — about 40 oil changes displayed as 30.

Milestones are now computed at their true due distance and merged only
when within 1000km, never collapsing a service into itself."
```

---

### Task 4: Rolling plan horizon

Fixes defect 5 — the Plan view emptying out late in the year.

**Files:**
- Modify: `schedule.js` (add `withinHorizon`)
- Modify: `test/schedule.test.js`
- Modify: `app.js:1219-1222` (inside `buildPlan`)

**Interfaces:**
- Consumes: `today()`, and `planForward()`'s `{ km, items, major, date }` shape from Task 3.
- Produces: `withinHorizon(milestones, cutoff, minCount)` → filtered array.

- [ ] **Step 1: Write the failing test**

Append to `test/schedule.test.js`:

```js
const { withinHorizon } = require('../schedule.js');

const ms = iso => ({ date: new Date(iso + 'T00:00:00') });

test('withinHorizon keeps everything inside the cutoff', () => {
  const list = [ms('2026-09-01'), ms('2027-01-01'), ms('2027-06-01')];
  const out = withinHorizon(list, new Date('2028-01-01T00:00:00'), 3);
  assert.strictEqual(out.length, 3);
});

test('withinHorizon falls back to minCount when too few are inside', () => {
  const list = [ms('2026-09-01'), ms('2031-01-01'), ms('2032-01-01'), ms('2033-01-01')];
  const out = withinHorizon(list, new Date('2027-01-01T00:00:00'), 3);
  assert.strictEqual(out.length, 3);
});

test('withinHorizon never invents milestones that do not exist', () => {
  const out = withinHorizon([ms('2031-01-01')], new Date('2027-01-01T00:00:00'), 3);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(withinHorizon([], new Date('2027-01-01T00:00:00'), 3), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test`
Expected: FAIL — `withinHorizon is not a function`

- [ ] **Step 3: Implement `withinHorizon`**

In `schedule.js`, add inside the factory:

```js
  /* Milestones due before `cutoff`, but never fewer than `minCount` — so the
     view cannot empty out simply because of the time of year. */
  function withinHorizon(milestones, cutoff, minCount) {
    const within = milestones.filter(m => m.date <= cutoff);
    return within.length >= minCount ? within : milestones.slice(0, minCount);
  }
```

Extend the return to `return { today, isQuotaError, mergeMilestones, withinHorizon };`

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test`
Expected: PASS, 13 tests

- [ ] **Step 5: Use it in `buildPlan`**

In `app.js`, inside `buildPlan`, replace these three lines (1219-1222):

```js
  const thisYear = today().getFullYear();
  const all = planForward();
  // Show only what's due within the current year (plus always the next one up).
  const shown = all.filter((m, i) => i === 0 || m.date.getFullYear() <= thisYear);
```

with:

```js
  const all = planForward();
  // A rolling 24-month window — a calendar-year filter made this view empty
  // out every December. Always at least three milestones.
  const cutoff = new Date(today());
  cutoff.setMonth(cutoff.getMonth() + 24);
  const shown = withinHorizon(all, cutoff, 3);
```

Note `thisYear` is removed here because it becomes unused inside `buildPlan`. The identically-named `const thisYear` in `renderDashboard` (`app.js:1117`) is a **separate** variable that is still used — leave it alone.

- [ ] **Step 6: Verify in the browser**

Open `index.html` → Maintenance → Plan. Confirm milestones appear spanning roughly the next two years with year headings, and at least three cards are visible. Then in the console run `state.car.dailyKm = 2; save(); go('maintenance')` to simulate a barely-driven car — confirm three cards still appear rather than an empty view. Restore with `state.car.dailyKm = 40; save()`.

- [ ] **Step 7: Commit**

```bash
git add schedule.js test/schedule.test.js app.js
git commit -m "fix: roll the plan horizon instead of filtering by calendar year

buildPlan showed only milestones falling in the current calendar year,
so the view emptied out every December. It now shows a rolling 24-month
window with a floor of three milestones."
```

---

### Task 5: Odometer staleness nudge

The odometer is the input every calculation depends on. Fuel logs already push it forward (`app.js:2138`), but nothing prompts when it has gone stale.

**Files:**
- Modify: `schedule.js` (add `daysSince`)
- Modify: `test/schedule.test.js`
- Modify: `app.js:880` (`normalizeData`), `app.js:1104` (dashboard), `app.js:2219-2233` (`openEditOdo`), `app.js:2136-2138` (`openAddFuel`), AR dictionary

**Interfaces:**
- Consumes: `today()`.
- Produces: `daysSince(isoDateStr, now)` → whole days, or `Infinity` when the date is missing. New persisted field `state.car.odoUpdatedAt` (ISO `YYYY-MM-DD`).

- [ ] **Step 1: Write the failing test**

Append to `test/schedule.test.js`:

```js
const { daysSince } = require('../schedule.js');

test('daysSince counts whole days', () => {
  const now = new Date('2026-08-10T00:00:00');
  assert.strictEqual(daysSince('2026-08-10', now), 0);
  assert.strictEqual(daysSince('2026-07-27', now), 14);
});

test('daysSince treats a missing date as infinitely stale', () => {
  const now = new Date('2026-08-10T00:00:00');
  assert.strictEqual(daysSince('', now), Infinity);
  assert.strictEqual(daysSince(undefined, now), Infinity);
});

test('daysSince does not go negative for a future date', () => {
  assert.strictEqual(daysSince('2026-09-01', new Date('2026-08-10T00:00:00')), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test`
Expected: FAIL — `daysSince is not a function`

- [ ] **Step 3: Implement `daysSince`**

In `schedule.js`, add inside the factory:

```js
  /* Whole days between an ISO YYYY-MM-DD date and `now`. A missing date is
     infinitely stale so callers treat it as needing attention. Never negative. */
  function daysSince(isoDateStr, now) {
    if (!isoDateStr) return Infinity;
    const then = new Date(isoDateStr + 'T00:00:00');
    if (isNaN(then.getTime())) return Infinity;
    return Math.max(0, Math.floor((now - then) / 86400000));
  }
```

Extend the return to `return { today, isQuotaError, mergeMilestones, withinHorizon, daysSince };`

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test`
Expected: PASS, 16 tests

- [ ] **Step 5: Default the new field for existing vehicles**

`normalizeData` runs on **every** load, but its result is only written to storage when something calls `save()`. So the default must be **derived from data already on disk**, not from the current date — otherwise a user who merely opens the app gets the field re-defaulted to that day every time, and the nudge could never fire.

Fuel entries and history entries both carry a date and both imply an odometer reading, so the newest of them is the best evidence available for when the odometer was last known good.

In `app.js`, in `normalizeData`, immediately after line 881 (the `['services', 'parts', …].forEach(…)` line that guarantees the arrays exist), insert:

```js
  // When the odometer was last known good. Derived from data on disk — not
  // from today() — because normalizeData runs on every load and is only
  // persisted when something calls save().
  if (!s.car.odoUpdatedAt) {
    const seen = [].concat(s.fuel.map(f => f.date), s.history.map(h => h.date)).filter(Boolean).sort();
    s.car.odoUpdatedAt = seen.length ? seen[seen.length - 1] : isoDate(today());
  }
```

The `isoDate(today())` fallback only applies to a garage with no fuel and no history at all, where a staleness nudge would be meaningless anyway.

Leave line 880 (`s.car = Object.assign(…)`) unchanged.

- [ ] **Step 6: Stamp the field when the odometer changes**

In `app.js`, in `openEditOdo`, replace:

```js
      const val = parseInt($('#m_odo').value, 10);
      if (!isNaN(val)) state.car.odometer = val;
```

with:

```js
      const val = parseInt($('#m_odo').value, 10);
      if (!isNaN(val)) { state.car.odometer = val; state.car.odoUpdatedAt = isoDate(today()); }
```

And in `openAddFuel`, replace line 2138:

```js
      if (odo > state.car.odometer) state.car.odometer = odo; // keep mileage current
```

with:

```js
      // a fill-up is a real odometer reading — stamp it with the fill-up's own date
      if (odo > state.car.odometer) { state.car.odometer = odo; state.car.odoUpdatedAt = obj.date; }
```

- [ ] **Step 7: Show the nudge on the dashboard**

In `app.js`, in `renderDashboard`, immediately after `v.appendChild(tiles);` (line 1104) insert:

```js
  // Stale mileage quietly corrupts every due date — nudge, don't nag.
  const odoAge = daysSince(state.car.odoUpdatedAt, today());
  if (odoAge >= 14) {
    const ob = el('button', 'card reminder-banner warn');
    ob.innerHTML = `<span class="rb-ic">📏</span><span class="rb-text">${t('Mileage is {n} days old — due dates may be off').replace('{n}', odoAge === Infinity ? '?' : odoAge)}</span><span class="rb-go">${t('Update ›')}</span>`;
    ob.onclick = openEditOdo;
    v.appendChild(ob);
  }
```

This reuses the existing `.reminder-banner` styling, so no CSS change is needed.

- [ ] **Step 8: Add the Arabic strings**

Before the closing `};` of the `AR` object, add:

```js

  // odometer staleness
  'Mileage is {n} days old — due dates may be off': 'مضى {n} يوماً على تحديث العداد — قد تكون مواعيد الاستحقاق غير دقيقة',
  'Update ›': 'تحديث ›',
```

The `{n}` placeholder is inside the translated string so Arabic controls where the number sits in the sentence — important for RTL.

- [ ] **Step 9: Verify in the browser**

Open `index.html`. No nudge should appear (the field defaults to today). Then in the console run:

```js
state.car.odoUpdatedAt = '2026-01-01'; save(); go('dashboard');
```

Expected: an orange banner reading "Mileage is N days old — due dates may be off". Tap it — the Update mileage dialog opens. Save a value, and confirm the banner disappears. Switch to Arabic in Settings and confirm the banner reads correctly right-to-left with the number in place.

- [ ] **Step 10: Commit**

```bash
git add schedule.js test/schedule.test.js app.js
git commit -m "feat: nudge when the odometer has gone stale

Every due date is computed from the odometer, which is entered by hand.
Track when it was last set (fill-ups stamp it with their own date) and
show a dashboard banner once it is 14 days old."
```

---

### Task 6: Explainable health score

**Files:**
- Modify: `schedule.js` (add `healthFrom`)
- Modify: `test/schedule.test.js`
- Modify: `app.js:990-995` (`healthScore`), `app.js:1148` area (ring wiring), new `openHealthBreakdown`, AR dictionary
- Modify: `styles.css` (ring cursor)

**Interfaces:**
- Consumes: `serviceStatus(s).level` (`'ok' | 'warn' | 'danger'`), `servicesRanked()`, `serviceItem(s, st)`, `openModal`, `emptyState`.
- Produces: `healthFrom(levels)` → `number` 0-100. `openHealthBreakdown()` → opens a modal.

- [ ] **Step 1: Write the failing test**

Append to `test/schedule.test.js`:

```js
const { healthFrom } = require('../schedule.js');

test('healthFrom returns 100 for no services or all healthy', () => {
  assert.strictEqual(healthFrom([]), 100);
  assert.strictEqual(healthFrom(['ok', 'ok', 'ok']), 100);
});

test('healthFrom returns 0 when everything is overdue', () => {
  assert.strictEqual(healthFrom(['danger', 'danger']), 0);
});

test('healthFrom weights overdue above due-soon', () => {
  assert.strictEqual(healthFrom(['danger', 'ok', 'ok', 'ok']), 75);
  assert.strictEqual(healthFrom(['warn', 'ok', 'ok', 'ok']), 90);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test`
Expected: FAIL — `healthFrom is not a function`

- [ ] **Step 3: Implement `healthFrom`**

In `schedule.js`, add inside the factory:

```js
  /* 100 = everything on track. Overdue costs a full share of the score,
     due-soon costs 40% of one. */
  function healthFrom(levels) {
    if (!levels.length) return 100;
    const penalty = levels.reduce((a, l) => a + (l === 'danger' ? 1 : l === 'warn' ? 0.4 : 0), 0);
    return Math.round(Math.min(100, Math.max(0, 100 - (penalty / levels.length) * 100)));
  }
```

Extend the return to `return { today, isQuotaError, mergeMilestones, withinHorizon, daysSince, healthFrom };`

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test`
Expected: PASS, 19 tests

- [ ] **Step 5: Delegate `healthScore` to it**

In `app.js`, replace `healthScore` (lines 990-995) with:

```js
function healthScore() {
  return healthFrom(state.services.map(s => serviceStatus(s).level));
}
```

- [ ] **Step 6: Add the breakdown dialog**

In `app.js`, immediately after the `healthScore` function, add:

```js
/* What is dragging the score down — a bare number is not actionable. */
function openHealthBreakdown() {
  const bad = servicesRanked().filter(r => r.st.level !== 'ok');
  openModal('Health score', `${healthScore()} / 100 — ${t('what is affecting it')}`, card => {
    if (!bad.length) { card.appendChild(emptyState('✅', 'Everything is on track.')); return; }
    const list = el('div', 'list');
    bad.forEach(({ s, st }) => list.appendChild(serviceItem(s, st)));
    card.appendChild(list);
  });
}
```

- [ ] **Step 7: Make the ring open it**

In `app.js`, in `renderDashboard`, immediately after the existing line 1148 `hero.querySelector('#editOdo').onclick = openEditOdo;` add:

```js
  const ring = hero.querySelector('.ring');
  ring.setAttribute('role', 'button');
  ring.setAttribute('tabindex', '0');
  ring.setAttribute('aria-label', `${t('Health')} ${hs} — ${t('what is affecting it')}`);
  ring.onclick = openHealthBreakdown;
  ring.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHealthBreakdown(); } };
```

- [ ] **Step 8: Show it is interactive**

In `styles.css`, replace line 251:

```css
.ring { position: relative; width: 92px; height: 92px; }
```

with:

```css
.ring { position: relative; width: 92px; height: 92px; cursor: pointer; }
.ring:active { transform: scale(.97); }
```

- [ ] **Step 9: Add the Arabic strings**

Before the closing `};` of the `AR` object, add:

```js

  // health breakdown
  'Health score': 'مؤشر الحالة',
  'what is affecting it': 'ما الذي يؤثر عليه',
  'Everything is on track.': 'كل شيء على المسار الصحيح.',
```

- [ ] **Step 10: Verify in the browser**

Open `index.html`. Tap the health ring on the Dashboard. Expected: a modal titled "Health score" listing only overdue and due-soon services. Tab to the ring with the keyboard and press Enter — the same modal opens. With a fresh seed where everything is on track, expect the "Everything is on track." empty state.

- [ ] **Step 11: Commit**

```bash
git add schedule.js test/schedule.test.js app.js styles.css
git commit -m "feat: make the health score explainable

The score was a bare number with no way to see what caused it. Tapping
the ring now lists the overdue and due-soon services dragging it down.
Scoring logic moved to a tested pure function."
```

---

### Task 7: Three-state theme control

Per the spec correction above: the app already follows the OS by default. What is missing is a way back to that after choosing manually, plus the theme flash on load.

**Files:**
- Modify: `schedule.js` (add `nextTheme`)
- Modify: `test/schedule.test.js`
- Modify: `app.js:2829-2833` (toggle), `app.js:2853-2860` (startup), AR dictionary
- Modify: `index.html:2` and `<head>`

**Interfaces:**
- Consumes: `applyTheme(t)`, `systemTheme()`, `toast(msg)`.
- Produces: `nextTheme(current)` → `'system' | 'light' | 'dark'`. Preference stored in `localStorage['garage.theme']`; the key being **absent** means "follow the system".

- [ ] **Step 1: Write the failing test**

Append to `test/schedule.test.js`:

```js
const { nextTheme } = require('../schedule.js');

test('nextTheme cycles system to light to dark and back', () => {
  assert.strictEqual(nextTheme('system'), 'light');
  assert.strictEqual(nextTheme('light'), 'dark');
  assert.strictEqual(nextTheme('dark'), 'system');
});

test('nextTheme recovers from an unrecognised stored value', () => {
  assert.strictEqual(nextTheme('chartreuse'), 'system');
  assert.strictEqual(nextTheme(null), 'system');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test`
Expected: FAIL — `nextTheme is not a function`

- [ ] **Step 3: Implement `nextTheme`**

In `schedule.js`, add inside the factory:

```js
  /* Cycle order for the theme button. An unrecognised value lands on
     'system', so corrupt storage self-heals. */
  const THEME_ORDER = ['system', 'light', 'dark'];
  function nextTheme(current) {
    return THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
  }
```

Extend the return to `return { today, isQuotaError, mergeMilestones, withinHorizon, daysSince, healthFrom, nextTheme };`

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test`
Expected: PASS, 21 tests

- [ ] **Step 5: Replace the binary toggle**

In `app.js`, replace lines 2829-2833:

```js
$('#themeToggle').onclick = () => {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try { localStorage.setItem('garage.theme', next); } catch (e) {} // an explicit choice sticks
};
```

with:

```js
/* Stored preference: 'light' | 'dark', or absent meaning "follow the device". */
function themePref() {
  try { return localStorage.getItem('garage.theme') || 'system'; } catch (e) { return 'system'; }
}
function setThemePref(p) {
  try {
    if (p === 'system') localStorage.removeItem('garage.theme');
    else localStorage.setItem('garage.theme', p);
  } catch (e) {}
  applyTheme(p === 'system' ? systemTheme() : p);
}
$('#themeToggle').onclick = () => {
  const next = nextTheme(themePref());
  setThemePref(next);
  toast(next === 'system' ? 'Theme: follows device' : next === 'light' ? 'Theme: light' : 'Theme: dark');
};
```

- [ ] **Step 6: Use the preference at startup**

In `app.js`, replace lines 2853-2860:

```js
// default to the OS preference; a saved choice (if any) wins
applyTheme(localStorage.getItem('garage.theme') || systemTheme());
// keep following the OS until the user picks a theme manually
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
    if (!localStorage.getItem('garage.theme')) applyTheme(e.matches ? 'light' : 'dark');
  });
}
```

with:

```js
// follow the device unless the user has explicitly picked light or dark
setThemePref(themePref());
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
    if (themePref() === 'system') applyTheme(e.matches ? 'light' : 'dark');
  });
}
```

- [ ] **Step 7: Kill the theme flash**

`index.html:2` hardcodes `data-theme="dark"`, so light-mode users get a dark flash before `app.js` runs. In `index.html`, change line 2 from:

```html
<html lang="en" data-theme="dark">
```

to:

```html
<html lang="en">
```

and add this as the **first** element inside `<head>`, before the stylesheet link:

```html
  <script>
    /* Set the theme before first paint — otherwise light-mode users see a dark flash. */
    (function () {
      var p = null;
      try { p = localStorage.getItem('garage.theme'); } catch (e) {}
      var sys = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', p || sys);
    })();
  </script>
```

This is inline and duplicated from `applyTheme` on purpose — it must run before any external script loads, and it must not depend on `schedule.js` or `app.js`.

- [ ] **Step 8: Add the Arabic strings**

Before the closing `};` of the `AR` object, add:

```js

  // theme
  'Theme: follows device': 'المظهر: حسب الجهاز',
  'Theme: light': 'المظهر: فاتح',
  'Theme: dark': 'المظهر: داكن',
```

- [ ] **Step 9: Verify in the browser**

Open `index.html`. Tap the theme button three times — expect toasts reading light, then dark, then "follows device", with the UI changing each time and returning to the OS setting on the third. Confirm `localStorage.getItem('garage.theme')` is `null` after the third tap. Reload with the OS in light mode and confirm no dark flash.

- [ ] **Step 10: Run the full suite and commit**

Run: `node --test`
Expected: PASS, 21 tests

```bash
git add schedule.js test/schedule.test.js app.js index.html
git commit -m "feat: three-state theme control and no theme flash

The toggle was binary, so once you picked a theme there was no way back
to following the device. It now cycles system/light/dark. An inline head
script applies the theme before first paint, removing the dark flash
light-mode users saw on load."
```

---

## Definition of done

- [ ] `node --test` passes with 21 tests. (Note: `node --test test/` fails on this Windows/Node 24 setup — use bare `node --test`, which discovers `test/` automatically.)
- [ ] `grep -n "TODAY\|yearSpend(2026)\|2026-08-02" app.js` returns nothing.
- [ ] Overdue status changes when the system clock passes a due date.
- [ ] Filling `localStorage` produces a visible warning rather than silent data loss.
- [ ] The Plan view shows consecutive oil changes 7,500 km apart with none missing.
- [ ] The Plan view shows at least three milestones regardless of the date or `dailyKm`.
- [ ] A stale odometer produces a dashboard nudge that opens the update dialog.
- [ ] The health ring opens a breakdown by mouse and by keyboard.
- [ ] The theme button cycles three states; no flash on load in light mode.
- [ ] The app still opens by double-clicking `index.html`, with no build step and no runtime dependencies.
