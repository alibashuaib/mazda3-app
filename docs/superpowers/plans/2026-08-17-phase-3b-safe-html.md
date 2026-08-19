# Phase 3b — Safe HTML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close roadmap defect 7 structurally — every HTML string in `app.js` is built by a tagged template that escapes its interpolations, so an unescaped one requires typing `raw()` and cannot happen by accident.

**Architecture:** A new `src/ui/html.js` exports `html` (a tagged template returning a `Raw` marker) and `raw` (the explicit opt-out). All 230 HTML-construction sites in `app.js` — 61 `innerHTML` assignments and 169 `el()` calls — are converted region by region, one commit per region. Before any conversion, a `linkedom`-backed DOM harness gives `app.js` its first real test coverage, so the conversion is verified by execution rather than by inspection.

**Tech Stack:** Vanilla JavaScript, no build step. `node --test` with `node:assert`. `linkedom` as a dev-only dependency.

## Global Constraints

- **No ES modules.** No `import`/`export` syntax, no `<script type="module">`. Module scripts are CORS-checked and `file://` is an opaque origin, so they fail when `index.html` is double-clicked. Running from disk is an acceptance criterion.
- **No build step.** No bundler, no transpiler.
- **No new *runtime* dependencies.** The shipped app continues to load zero packages. `linkedom` is a devDependency only, joining `fake-indexeddb`, and must never be referenced by any file under `src/` or by `app.js`.
- **No visible UI change.** Every page must render byte-identically apart from correct escaping of characters that were previously injected raw.
- **All new files under `src/`.** Test helpers go under `test/`.
- **`save()` keeps returning `Promise<boolean>`**, and no success message is shown for a failed write.
- **Every task ends green:** `npm test` passes, and `node --check app.js` is clean, before the commit.
- **`node --check app.js` is mandatory in every task.** Phase 3a shipped a syntactically broken `app.js` that 96 passing tests did not catch, because no test parsed it.
- **Never verify `state.`-style absence with a dot-guarded grep.** Phase 3a's `grep -nE '(^|[^.\w])state\.'` silently skipped five real bugs inside spread syntax, because the character before the identifier was the spread's third dot. Use unguarded patterns.
- **Branch:** `spec-phase-3-module-split`. Commit after every task.
- **Tasks 4-8 additionally follow the five-step shared conversion procedure** defined in the section *"Tasks 4-8: Convert the construction sites"*. Whoever dispatches those tasks must carry that procedure into the dispatch — a per-task brief extracted in isolation will not contain it.
- **`linkedom` is an amendment to the design spec**, which said "no new dependencies" without qualification. The owner approved a dev-only DOM harness on 2026-08-17 so that a second large mechanical pass over `app.js` is verified by execution rather than inspection. The shipped app still loads zero packages.

## Design decisions already settled by experiment

These were tested against `linkedom@0.18.13` before this plan was written. Do not re-litigate them.

**`html` must return `class Raw extends String`, not a plain object.** Browsers coerce whatever is assigned to `innerHTML` via ToString, so a plain object with a `toString()` works in the app. `linkedom` does not — its `innerHTML` setter hands the value straight to `htmlparser2`, which throws `TypeError: this.buffers[0].slice is not a function`. A `String` subclass satisfies both, and also keeps `instanceof` working for the escape check and coerces correctly in template literals.

**`linkedom` provides `document`, `createElement`, `innerHTML`, `querySelector`, `appendChild`, `textContent` and assignable `onclick`.** It does **not** provide `matchMedia` or `localStorage`; both must be stubbed by the harness.

## File Structure

| File | Responsibility | Approx lines |
| --- | --- | --- |
| `src/ui/html.js` | `html` tagged template, `raw`, `Raw`, the escaper | 60 |
| `test/helpers/dom.js` | Installs a `linkedom` document plus `matchMedia`/`localStorage`/`URL`/`navigator` stubs as globals | 90 |
| `test/helpers/boot.js` | Loads the app's scripts in `index.html` order into the harness, so `app.js` can be exercised | 70 |
| `test/html.test.js` | Covers `src/ui/html.js` | 130 |
| `test/render.test.js` | Boots `app.js` and renders every page — the safety net for the conversion | 160 |
| `package.json` | Adds `linkedom` to `devDependencies` | — |
| `app.js` | 230 construction sites converted, region by region | — |
| `index.html`, `sw.js` | One script tag / asset entry for `src/ui/html.js` | — |

**Not in this plan:** the six page modules, `src/i18n/lang.js`, `src/ui/modal.js`, `src/ui/photo.js`, `src/ui/chrome.js`, `main.js`, moving `storage.js`/`schedule.js`/`ui.js` into `src/`, and deleting `app.js`. That is Phase 3c.

---

### Task 1: DOM test harness

The prerequisite for everything else. `app.js` has never been executed by a test.

**Files:**
- Create: `test/helpers/dom.js`
- Create: `test/dom-harness.test.js`
- Modify: `package.json` (add `linkedom` to `devDependencies`)

**Interfaces:**
- Consumes: nothing.
- Produces: `setupDom(html?) -> { window, document, cleanup }`. Installs `globalThis.document`, `globalThis.window`, `globalThis.self`, `globalThis.navigator`, `globalThis.localStorage`, `globalThis.matchMedia`, `globalThis.URL.createObjectURL` / `revokeObjectURL`. `cleanup()` removes them. The optional `html` argument replaces the default shell.

- [ ] **Step 1: Add the dependency**

```bash
npm install --save-dev linkedom@0.18.13
```

Confirm `package.json` gained `linkedom` under `devDependencies` and that `dependencies` is still absent or empty — the shipped app must have no runtime packages.

- [ ] **Step 2: Write the failing test**

Create `test/dom-harness.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { setupDom } = require('./helpers/dom.js');

test('setupDom installs a usable document', () => {
  const { document, cleanup } = setupDom();
  const d = document.createElement('div');
  d.className = 'card';
  d.innerHTML = '<h3>hi</h3>';
  assert.strictEqual(d.outerHTML, '<div class="card"><h3>hi</h3></div>');
  cleanup();
});

test('setupDom provides the shell ids app.js reaches for at boot', () => {
  const { document, cleanup } = setupDom();
  ['#view', '#modalHost', '#modalCard', '#toastHost', '#tabbar', '#settingsBtn', '#garageBtn', '#openProfile', '#themeToggle', '#carBadge', '#carTitle', '#carSub']
    .forEach(sel => assert.ok(document.querySelector(sel), `${sel} must exist in the shell`));
  cleanup();
});

/* linkedom supplies neither of these, and app.js calls both at boot. */
test('setupDom stubs matchMedia and localStorage', () => {
  const { cleanup } = setupDom();
  assert.strictEqual(typeof globalThis.matchMedia, 'function');
  assert.strictEqual(typeof globalThis.matchMedia('(prefers-color-scheme: light)').matches, 'boolean');
  globalThis.localStorage.setItem('k', 'v');
  assert.strictEqual(globalThis.localStorage.getItem('k'), 'v');
  globalThis.localStorage.removeItem('k');
  assert.strictEqual(globalThis.localStorage.getItem('k'), null);
  cleanup();
});

test('setupDom stubs the object-URL API the photo registry uses', () => {
  const { cleanup } = setupDom();
  const url = URL.createObjectURL({ tag: 'blob' });
  assert.match(url, /^blob:/);
  URL.revokeObjectURL(url);
  cleanup();
});

test('cleanup removes the globals so tests do not leak into each other', () => {
  const { cleanup } = setupDom();
  cleanup();
  assert.strictEqual(globalThis.document, undefined);
  assert.strictEqual(globalThis.localStorage, undefined);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/dom-harness.test.js`
Expected: FAIL — `Cannot find module './helpers/dom.js'`

- [ ] **Step 4: Write the harness**

Create `test/helpers/dom.js`. The shell markup must mirror `index.html`'s structure — the ids `app.js` queries at boot — but not its `<script>` tags.

```js
'use strict';
const { parseHTML } = require('linkedom');

const SHELL = `<!doctype html><html lang="en"><body>
  <div id="app" class="app-shell">
    <header class="topbar">
      <button class="topbar-car" id="openProfile">
        <div class="car-badge" id="carBadge">M3</div>
        <div class="car-meta"><h1 id="carTitle">Mazda 3</h1><p id="carSub">sub</p></div>
      </button>
      <div class="topbar-actions">
        <button class="icon-btn" id="garageBtn"></button>
        <button class="icon-btn" id="settingsBtn"></button>
        <button class="icon-btn" id="themeToggle"></button>
      </div>
    </header>
    <main id="view" class="view"></main>
    <nav class="tabbar" id="tabbar">
      <button class="tab is-active" data-route="dashboard"><span>Dashboard</span></button>
      <button class="tab" data-route="maintenance"><span>Maintenance</span></button>
      <button class="tab" data-route="parts"><span>Parts</span></button>
      <button class="tab" data-route="fuel"><span>Fuel</span></button>
      <button class="tab" data-route="budget"><span>Budget</span></button>
      <button class="tab" data-route="reports"><span>Reports</span></button>
    </nav>
  </div>
  <div class="modal-host" id="modalHost" hidden>
    <div class="modal-backdrop" data-close></div>
    <div class="modal-card" id="modalCard"></div>
  </div>
  <div class="toast-host" id="toastHost"></div>
</body></html>`;

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: k => { map.delete(String(k)); },
    clear: () => map.clear(),
    key: i => [...map.keys()][i] ?? null,
    get length() { return map.size; }
  };
}

const INSTALLED = ['document', 'window', 'self', 'navigator', 'localStorage', 'matchMedia'];

function setupDom(html) {
  const { window, document } = parseHTML(html || SHELL);

  // linkedom supplies neither of these, and app.js uses both at boot.
  const matchMedia = q => ({ matches: false, media: String(q), addEventListener() {}, removeEventListener() {} });
  const localStorage = makeLocalStorage();

  let urlSeq = 0;
  const createObjectURL = () => `blob:test/${++urlSeq}`;
  const revokeObjectURL = () => {};

  Object.assign(window, { matchMedia, localStorage });
  globalThis.document = document;
  globalThis.window = window;
  globalThis.self = window;
  globalThis.navigator = { userAgent: 'node' };   // no serviceWorker key: app.js's guard skips registration
  globalThis.localStorage = localStorage;
  globalThis.matchMedia = matchMedia;

  if (!globalThis.URL.createObjectURL) {
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;
  }

  function cleanup() {
    INSTALLED.forEach(k => { delete globalThis[k]; });
    delete globalThis.URL.createObjectURL;
    delete globalThis.URL.revokeObjectURL;
  }

  return { window, document, cleanup };
}

module.exports = { setupDom, SHELL };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/dom-harness.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 6: Confirm the dependency is dev-only**

Run: `node -e "const p=require('./package.json'); console.log('deps:', JSON.stringify(p.dependencies||{})); console.log('devDeps:', Object.keys(p.devDependencies).join(','))"`
Expected: `deps: {}` (or absent), and `devDeps` naming both `fake-indexeddb` and `linkedom`.

Run: `grep -rn "linkedom" src/ app.js index.html sw.js`
Expected: no output. The shipped app must not reference it.

- [ ] **Step 7: Run the whole suite and commit**

Run: `npm test` — expected PASS, 131 tests (126 + 5).
Run: `node --check app.js` — expected clean.

```bash
git add package.json package-lock.json test/helpers/dom.js test/dom-harness.test.js
git commit -m "test: add a linkedom DOM harness so app.js can be executed by tests"
```

---

### Task 2: The safe HTML builder

**Files:**
- Create: `src/ui/html.js`
- Create: `test/html.test.js`
- Modify: `index.html`, `sw.js`

`app.js` is **not** modified in this task — the conversion starts in Task 4, after the safety net exists.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `html(strings, ...values) -> Raw` — escapes every interpolation.
  - `raw(value) -> Raw` — the explicit, greppable opt-out.
  - `esc(value) -> string` — the escaper, exported for direct use and for tests.
  - `Raw` — `class Raw extends String`, exported so callers can type-check.

  Escaping rules: `null`/`undefined` render as the empty string; a `Raw` passes through unescaped; an array is escaped element-wise and joined with no separator (this is what makes existing `.map(...).join('')` call sites work); everything else is `String()`-ed and has `& < > " '` replaced.

- [ ] **Step 1: Write the failing test**

Create `test/html.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { html, raw, esc, Raw } = require('../src/ui/html.js');

test('esc replaces every dangerous character', () => {
  assert.strictEqual(esc('&'), '&amp;');
  assert.strictEqual(esc('<'), '&lt;');
  assert.strictEqual(esc('>'), '&gt;');
  assert.strictEqual(esc('"'), '&quot;');
  assert.strictEqual(esc("'"), '&#39;');
});

/* The acceptance criterion from the design spec. */
test('a hostile vehicle nickname renders as literal text', () => {
  const out = String(html`<h3>${'<img src=x onerror=alert(1)>'}</h3>`);
  assert.strictEqual(out, '<h3>&lt;img src=x onerror=alert(1)&gt;</h3>');
  assert.ok(!out.includes('<img'), 'the tag must not survive');
});

test('an attribute value cannot be broken out of', () => {
  const out = String(html`<div title="${'" onmouseover="alert(1)'}"></div>`);
  assert.ok(!out.includes('onmouseover="'), 'the quote must be escaped');
  assert.ok(out.includes('&quot;'));
});

test('null and undefined render as nothing, not as the word', () => {
  assert.strictEqual(String(html`<p>${null}</p>`), '<p></p>');
  assert.strictEqual(String(html`<p>${undefined}</p>`), '<p></p>');
});

test('zero and false render, because they are real values', () => {
  assert.strictEqual(String(html`<p>${0}</p>`), '<p>0</p>');
  assert.strictEqual(String(html`<p>${false}</p>`), '<p>false</p>');
});

test('numbers pass through unchanged', () => {
  assert.strictEqual(String(html`<b>${316000}</b>`), '<b>316000</b>');
});

test('raw() passes markup through untouched', () => {
  assert.strictEqual(String(html`<div>${raw('<svg/>')}</div>`), '<div><svg/></div>');
});

/* Nesting is the reason html() returns a Raw rather than a plain string:
   an inner result must not be escaped a second time. */
test('a nested html result is not double-escaped', () => {
  const inner = html`<b>${'a & b'}</b>`;
  assert.strictEqual(String(html`<p>${inner}</p>`), '<p><b>a &amp; b</b></p>');
});

test('an array of html results joins with no separator', () => {
  const items = ['x', 'y'].map(v => html`<li>${v}</li>`);
  assert.strictEqual(String(html`<ul>${items}</ul>`), '<ul><li>x</li><li>y</li></ul>');
});

test('an array of plain strings is escaped element-wise', () => {
  assert.strictEqual(String(html`<p>${['<a>', '<b>']}</p>`), '<p>&lt;a&gt;&lt;b&gt;</p>');
});

test('html returns a Raw, and Raw is a String subclass', () => {
  const out = html`<p>hi</p>`;
  assert.ok(out instanceof Raw);
  assert.ok(out instanceof String);
  assert.strictEqual(`${out}`, '<p>hi</p>');
  assert.strictEqual(out.length, '<p>hi</p>'.length);
});

/* linkedom's innerHTML setter passes its value straight to the parser instead of
   coercing it, so a plain marker object would throw here. A String subclass does
   not. This test pins the reason for that design choice. */
test('a Raw can be assigned to innerHTML under the DOM harness', () => {
  const { setupDom } = require('./helpers/dom.js');
  const { document, cleanup } = setupDom();
  const d = document.createElement('div');
  d.innerHTML = html`<b>${'a & b'}</b>`;
  assert.strictEqual(d.innerHTML, '<b>a &amp; b</b>');
  cleanup();
});

test('a Raw survives the el() helper, which assigns to innerHTML', () => {
  const { setupDom } = require('./helpers/dom.js');
  const { document, cleanup } = setupDom();
  const { el } = require('../src/core/helpers.js');
  assert.strictEqual(el('p', 'k', html`<i>${'<x>'}</i>`).outerHTML, '<p class="k"><i>&lt;x&gt;</i></p>');
  cleanup();
});

test('a template with no interpolations still returns a Raw', () => {
  const out = html`<hr/>`;
  assert.ok(out instanceof Raw);
  assert.strictEqual(String(out), '<hr/>');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/html.test.js`
Expected: FAIL — `Cannot find module '../src/ui/html.js'`

- [ ] **Step 3: Write the module**

Create `src/ui/html.js`:

```js
/* ============================================================
   Garage — HTML built safely by construction.

   Every interpolation in an html`` template is escaped. Injecting
   markup requires raw(), which is deliberately greppable: an audit
   is a list of raw() calls, not a reading of every template.

   Raw extends String rather than being a plain marker object because
   innerHTML must accept it directly. Browsers coerce assignments via
   ToString, but linkedom — which the tests run against — hands the
   value to its parser untouched and throws on a non-string.

   Dual-mode, like storage.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

  class Raw extends String {}

  const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(v) {
    if (v == null) return '';
    if (v instanceof Raw) return String(v);
    // Arrays keep the existing .map(...).join('') call sites working unchanged.
    if (Array.isArray(v)) return v.map(esc).join('');
    return String(v).replace(/[&<>"']/g, c => ENTITIES[c]);
  }

  function raw(v) { return new Raw(v == null ? '' : String(v)); }

  function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) out += esc(values[i]) + strings[i + 1];
    return new Raw(out);
  }

  return { html, raw, esc, Raw };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/html.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Load the module in the browser**

`index.html`: add `<script src="src/ui/html.js"></script>` immediately after `src/core/helpers.js`, so it is available to everything that follows.
`sw.js`: add `'./src/ui/html.js'` to `ASSETS` after `'./src/core/helpers.js'`, and bump the cache name from `garage-v6` to `garage-v7`.

- [ ] **Step 6: Run the whole suite and commit**

Run: `npm test` — expected PASS, 145 tests (131 + 14).
Run: `node --check app.js` and `node --check src/ui/html.js` — both clean.

```bash
git add src/ui/html.js test/html.test.js index.html sw.js
git commit -m "feat: add src/ui/html.js, escaping HTML by construction"
```

---

### Task 3: Boot and render `app.js` under test

The safety net. Without this, Task 4 onward repeats Phase 3a's mistake of changing untested render code and calling static inspection verification.

**Files:**
- Create: `test/helpers/boot.js`
- Create: `test/render.test.js`

**Interfaces:**
- Consumes: `setupDom` from Task 1.
- Produces: `bootApp({ vehicles?, activeId?, lang? }) -> Promise<{ document, window, api, evalInApp, cleanup }>`.
  - `api` is the global object. Function declarations (`go`, `renderDashboard`, `t`) and namespace assignments (`session`, `Status`) land on it, so `api.go('parts')` works.
  - `evalInApp(code)` evaluates a statement in the app's script scope. **This is required for `app.js`'s top-level `let` bindings** — `let maintMode` and `let reportType` create global *lexical* bindings, which are reachable by name from a later script but are **not** properties of `globalThis`. `api.maintMode = 'History'` would silently create an unrelated property and change nothing.

- [ ] **Step 1: Write the failing test**

Create `test/render.test.js`. These are smoke tests: they assert a page rendered something plausible and did not throw. That is exactly the class of bug Phase 3a leaked twice.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

const ROUTES = ['dashboard', 'maintenance', 'parts', 'fuel', 'budget', 'reports'];

test('the app boots without throwing and lands on the dashboard', async () => {
  const { document, cleanup } = await bootApp();
  assert.ok(document.querySelector('#view').innerHTML.length > 100, 'the dashboard rendered nothing');
  cleanup();
});

/* One test per tab. Phase 3a shipped five ReferenceErrors that blanked four of
   these six pages, with a fully green suite, because nothing rendered them. */
for (const route of ROUTES) {
  test(`the ${route} page renders without throwing`, async () => {
    const { document, api, cleanup } = await bootApp();
    api.go(route);
    const view = document.querySelector('#view');
    assert.ok(view.innerHTML.length > 50, `${route} rendered ${view.innerHTML.length} chars`);
    cleanup();
  });
}

test('every page renders in Arabic too', async () => {
  const { document, api, cleanup } = await bootApp({ lang: 'ar' });
  for (const route of ROUTES) {
    api.go(route);
    assert.ok(document.querySelector('#view').innerHTML.length > 50, `${route} failed in Arabic`);
  }
  cleanup();
});

/* maintMode is a top-level `let`, so it is a global lexical binding and NOT a
   property of globalThis. It must be set through evalInApp; assigning
   api.maintMode would create an unrelated property and change nothing. */
test('the maintenance History mode renders', async () => {
  const { document, api, evalInApp, cleanup } = await bootApp();
  evalInApp('maintMode = "History"');
  api.go('maintenance');
  assert.ok(document.querySelector('#view').innerHTML.length > 50);
  cleanup();
});

test('all three report types render', async () => {
  const { document, api, evalInApp, cleanup } = await bootApp();
  for (const type of ['service', 'purchases', 'summary']) {
    evalInApp(`reportType = ${JSON.stringify(type)}`);
    api.go('reports');
    assert.ok(document.querySelector('#view').innerHTML.length > 50, `${type} report failed`);
  }
  cleanup();
});

/* The escaping acceptance criterion, end to end through a real render. */
test('a hostile vehicle nickname renders as text, not markup', async () => {
  const { document, api, cleanup } = await bootApp();
  api.session.current().car.nickname = '<img src=x onerror=alert(1)>';
  api.go('dashboard');
  const view = document.querySelector('#view');
  assert.strictEqual(view.querySelectorAll('img[onerror]').length, 0, 'the payload became a live element');
  cleanup();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/render.test.js`
Expected: FAIL — `Cannot find module './helpers/boot.js'`

- [ ] **Step 3: Write the boot helper**

Create `test/helpers/boot.js`. `app.js` is a classic script that runs its boot block on load, so it cannot be `require()`d. Evaluate the same scripts `index.html` lists, in the same order, in one shared context.

```js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { setupDom } = require('./dom.js');

const ROOT = path.join(__dirname, '..', '..');

/* Must stay in the same order as index.html's <script> tags. A mismatch here
   is itself a bug worth failing on — see the order assertion below. */
const SCRIPTS = [
  'src/core/helpers.js',
  'src/ui/html.js',
  'src/data/catalog.js',
  'src/i18n/strings.ar.js',
  'schedule.js',
  'storage.js',
  'src/data/normalize.js',
  'src/data/session.js',
  'src/data/status.js',
  'ui.js',
  'app.js'
];

/* Guards against index.html and this list drifting apart. */
function assertScriptOrderMatchesIndexHtml() {
  const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const inHtml = [...htmlSrc.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  if (inHtml.join(',') !== SCRIPTS.join(',')) {
    throw new Error(`test/helpers/boot.js SCRIPTS is out of sync with index.html.\n  index.html: ${inHtml.join(', ')}\n  boot.js:    ${SCRIPTS.join(', ')}`);
  }
}

async function bootApp(opts = {}) {
  assertScriptOrderMatchesIndexHtml();
  const dom = setupDom();

  if (opts.lang) globalThis.localStorage.setItem('garage.lang', opts.lang);

  const context = globalThis;   // the scripts assign onto the global object by design
  for (const rel of SCRIPTS) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInThisContext(code, { filename: rel });
  }

  // app.js's boot is async; wait for the session to hydrate before rendering.
  const deadline = Date.now() + 2000;
  while (!context.session.booted() && Date.now() < deadline) {
    await new Promise(r => setImmediate(r));
  }
  if (!context.session.booted()) throw new Error('app.js did not finish booting within 2s');

  if (opts.vehicles) context.session.setVehicles(opts.vehicles, opts.activeId || opts.vehicles[0].id);

  /* Reaches app.js's top-level `let` bindings (maintMode, reportType, lang),
     which live in the global lexical scope and are not globalThis properties. */
  const evalInApp = code => vm.runInThisContext(code, { filename: 'evalInApp' });

  return { document: dom.document, window: dom.window, api: context, evalInApp, cleanup: dom.cleanup };
}

module.exports = { bootApp };
```

If `vm.runInThisContext` cannot execute `app.js` — for example because a `const` at top level collides across repeated boots within one test file — the fallback is to wrap each script's source in an IIFE before evaluating, or to run each test file in its own process. Report which approach you used.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/render.test.js`
Expected: PASS, 11 tests — one boot, six per-route, one Arabic, one History mode, one reports, one hostile nickname.

**If a page throws, do not weaken the test.** A throw here means `app.js` has a live bug, which is the whole point of the task. Report it, fix it in this task, and note it in your report.

- [ ] **Step 5: Confirm the harness would have caught Phase 3a's bugs**

Temporarily reintroduce a `state.spending` reference in `renderBudget`, run `node --test test/render.test.js`, and confirm the budget test fails. Then revert. Paste both outputs into your report. This proves the net has holes closed, rather than assuming it.

- [ ] **Step 6: Run the whole suite and commit**

Run: `npm test` — expected PASS, 156 tests (145 + 11).
Run: `node --check app.js` — clean.

```bash
git add test/helpers/boot.js test/render.test.js
git commit -m "test: boot app.js under the DOM harness and render every page"
```

---

### Tasks 4-8: Convert the construction sites

The remaining five tasks share one procedure and differ only in which region of `app.js` they cover. **Read this procedure once; each task below names its region and its expected counts.**

**The procedure, per region:**

1. For every `x.innerHTML = \`…\`` in the region, change the template literal's tag: `x.innerHTML = html\`…\``.
2. For every `el(tag, cls, \`…\`)`, tag the third argument: `el(tag, cls, html\`…\`)`.
3. For every interpolation that must stay markup — `iconSvg(...)`, a nested builder's output that is already a `Raw`, a deliberate `<svg>` or `<option>` string — leave it if it is already a `Raw`, and wrap it in `raw(...)` if it is a plain string. **Each `raw()` you add must be justified in your report by naming what it interpolates.** A `raw()` around anything a user can type is a defect, not a conversion.
4. Interpolations of `t(...)`, numbers, `fmt(...)`, `sar(...)` and app-controlled constants need no special handling — they are escaped harmlessly.
5. Where a helper returns a string that is then interpolated, convert that helper to return `html\`…\`` too, so its output is a `Raw` and is not double-escaped. Do this in the same commit as its callers.

**Verification, per region — every task, no exceptions:**

- `node --check app.js` → clean.
- `npm test` → all tests pass, including `test/render.test.js`, which renders the region you just changed.
- `grep -c 'innerHTML = `' app.js` and `grep -c 'innerHTML = html`' app.js` → report both, so the untagged count is visibly falling.
- `grep -n 'raw(' app.js` → list every `raw()` in your region and justify each.
- Unguarded greps only. Never a `[^.\w]`-style guard.

**Report, per task:** the counts before and after, every `raw()` added with its justification, the test output, and anything you were unsure about.

---

### Task 4: Convert the dashboard region

**Files:** Modify `app.js` — `renderDashboard` (~line 266-385), `recommendations` and `recCard` (~1252-1270), `renderTopbar`, `carTitle`, `carInitials` (~1482-1498).

**Interfaces:** Consumes `html`, `raw` from Task 2. `recCard` changes to return a `Raw`; its only caller is `recommendations`, converted in the same commit.

- [ ] **Step 1: Convert the region** following the shared procedure above.
- [ ] **Step 2: Run `node --check app.js`** → clean.
- [ ] **Step 3: Run `npm test`** → all pass. The dashboard render test and the hostile-nickname test both exercise this region directly.
- [ ] **Step 4: Report the counts and justify every `raw()`.**
- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "refactor: build the dashboard's HTML through html\`\`"
```

---

### Task 5: Convert the maintenance region

**Files:** Modify `app.js` — `renderMaintenance`, `buildPlan`, `openLogConfirm`, `openPlanSetup`, `buildSchedule`, `scheduleTimelineItem`, `buildHistory`, `serviceItem` (~line 386-893), plus `openServiceDetail`, `markServiceDone`, `openAddHistory`, `openEditService` in the dialog region.

This is the largest region and contains the plan-setup wizard, which builds multi-step markup.

**Interfaces:** `scheduleTimelineItem`, `serviceItem` and `buildPlan` return values that are interpolated by their callers; convert them to return `Raw` in this same commit.

- [ ] **Step 1: Convert the region** following the shared procedure.
- [ ] **Step 2: Run `node --check app.js`** → clean.
- [ ] **Step 3: Run `npm test`** → all pass, including the maintenance and History-mode render tests.
- [ ] **Step 4: Report the counts and justify every `raw()`.**
- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "refactor: build the maintenance region's HTML through html\`\`"
```

---

### Task 6: Convert the parts and money regions

**Files:** Modify `app.js` — `renderParts`, `partCard` (~894-985), `renderBudget` (~989-1082), `renderReports`, `reportHTML`, `reportHeader`, `reportFooter`, `reportService`, `reportPurchases`, `reportSummary`, `monthlyBars`, `spendEntry` (~1087-1250), plus `openEditPart`, `openAddSpending`, `openEditBudget`.

Part and service names, brands, part numbers, stores and notes are all user-editable, so this region carries a large share of the ~60 user-data interpolations.

- [ ] **Step 1: Convert the region** following the shared procedure.
- [ ] **Step 2: Run `node --check app.js`** → clean.
- [ ] **Step 3: Run `npm test`** → all pass, including the parts, budget, reports and all-three-report-types tests.
- [ ] **Step 4: Report the counts and justify every `raw()`.**
- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "refactor: build the parts and money HTML through html\`\`"
```

---

### Task 7: Convert the fuel and documents regions

**Files:** Modify `app.js` — `fuelRows`, `renderFuel`, `fuelBars`, `openAddFuel` (~1271-1393), `docStatus`, `docItem`, `openAddDoc` (~1394-1445), `openEditOdo`.

- [ ] **Step 1: Convert the region** following the shared procedure.
- [ ] **Step 2: Run `node --check app.js`** → clean.
- [ ] **Step 3: Run `npm test`** → all pass, including the fuel render test.
- [ ] **Step 4: Report the counts and justify every `raw()`.**
- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "refactor: build the fuel and documents HTML through html\`\`"
```

---

### Task 8: Convert the chrome, modals and remaining regions

**Files:** Modify `app.js` — everything not yet converted: the vehicle/garage region (`openAddVehicle`, `openGarage`, `vehicleName`, `importGarage`'s messages, ~41-262), `openHealthBreakdown`, `go`'s error paths, `openModal`, `field`, `photoPicker`, `openImage`, `openSettings` (~1446 onward), `sectionTitle`, `pageIntro`, `emptyState`, `iconSvg`, `toast`, and the boot error card.

`iconSvg` returns SVG markup by design and is interpolated widely: it should return a `Raw` so its callers need no `raw()`. Note that in your report.

- [ ] **Step 1: Convert the region** following the shared procedure.
- [ ] **Step 2: Run `node --check app.js`** → clean.
- [ ] **Step 3: Run `npm test`** → all pass.
- [ ] **Step 4: Report the counts and justify every `raw()`.**
- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "refactor: build the chrome and modal HTML through html\`\`"
```

---

### Task 9: Close the loop with a guard test

Conversion is worthless if the next edit reintroduces an untagged template. This task makes regression a test failure.

**Files:**
- Create: `test/no-raw-templates.test.js`
- Modify: `app.js` only if the guard finds a straggler

**Interfaces:** Consumes nothing; reads `app.js` as text.

- [ ] **Step 1: Write the guard test**

Create `test/no-raw-templates.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

/* Every HTML string must be built by html``. An untagged template assigned to
   innerHTML is exactly the hole Phase 3b closed. */
test('no innerHTML assignment takes an untagged template literal', () => {
  const bad = APP.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /\.innerHTML\s*=\s*`/.test(line));
  assert.deepStrictEqual(bad.map(b => b.n), [], `untagged innerHTML templates at lines: ${bad.map(b => `${b.n}: ${b.line.trim()}`).join(' | ')}`);
});

test('no el() call takes an untagged template literal', () => {
  const bad = APP.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /\bel\([^)]*,\s*`/.test(line) && !/el\([^)]*,\s*html`/.test(line));
  assert.deepStrictEqual(bad.map(b => b.n), [], `untagged el() templates at lines: ${bad.map(b => `${b.n}: ${b.line.trim()}`).join(' | ')}`);
});

/* raw() is the sanctioned escape hatch, so it must stay small and reviewable.
   Raise this number deliberately, with a justification in the commit message —
   never to make a failing test pass. */
test('raw() use stays bounded', () => {
  const count = (APP.match(/\braw\(/g) || []).length;
  assert.ok(count <= 25, `raw() is used ${count} times; each one bypasses escaping and needs justifying`);
});
```

- [ ] **Step 2: Run the guard test**

Run: `node --test test/no-raw-templates.test.js`
Expected: PASS. **If it fails, it has found real stragglers** — convert them in this task, then re-run.

- [ ] **Step 3: Tighten the bound**

Replace the `25` in the third test with the actual `raw()` count plus a small margin, and say in your report what the real number is.

- [ ] **Step 4: Run the whole suite and commit**

Run: `npm test` — expected PASS, 159 tests (156 + 3).
Run: `node --check app.js` — clean.

```bash
git add test/no-raw-templates.test.js app.js
git commit -m "test: fail the build if an untagged HTML template reappears"
```

---

## Done when

- `npm test` passes with roughly 159 tests, including six per-page render tests.
- `grep -c 'innerHTML = `' app.js` returns 0 — every assignment is `html\`\``.
- Every `raw()` in `app.js` is justified in a task report, and none wraps user-supplied text.
- A vehicle nickname of `<img src=x onerror=alert(1)>` renders as literal text, asserted both as a unit test and through a real dashboard render.
- `node --check app.js` is clean.
- `linkedom` appears only in `devDependencies`; nothing under `src/` or in `app.js` references it.
- The app still runs by double-clicking `index.html`, in both languages.
- No visible UI change beyond correct escaping.

## Risks

**The conversion touches every render path.** Mitigated by doing the harness and render tests first (Tasks 1-3), so each of Tasks 4-8 is checked by execution rather than inspection — the safeguard Phase 3a lacked when two bugs slipped through a green suite.

**`raw()` is a loaded gun.** Every use bypasses escaping. The per-task justification requirement and Task 9's bound exist to keep the list short and reviewed. A `raw()` around user-supplied text defeats the entire phase.

**`vm.runInThisContext` may fight `app.js`'s top-level `const` declarations** across repeated boots in one test file. Task 3 names two fallbacks. If neither works, that task should report BLOCKED rather than shipping a harness that silently tests nothing.

**The render tests are smoke tests, not assertions about appearance.** They prove a page did not throw and produced output; they cannot prove it looks right. A manual browser pass is still warranted before merge, as it was for Phase 3a.
