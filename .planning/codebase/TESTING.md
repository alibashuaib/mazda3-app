# Testing Patterns

**Analysis Date:** 2026-11-04

## Test Framework

**Runner:**
- Node built-in test runner (`node:test`), Node >=22 required (glob expansion). No Jest/Vitest.
- E2E: Playwright `@playwright/test` ^1.62.1, config `playwright.config.js`.
- DOM: `linkedom` ^0.18.13; IndexedDB: `fake-indexeddb` ^6.2.5 (all dev-only; app has no runtime deps).

**Assertion Library:**
- `node:assert` (`assert.strictEqual`, `assert.deepStrictEqual`, `assert.ok`); `expect` in Playwright.

**Run Commands:**
```bash
npm test               # node --test "test/**/*.test.js"
npm run test:e2e       # playwright test (chromium, projects: file + http)
npx playwright install --with-deps chromium   # one-time browser download
```
No watch or coverage script defined.

## Test File Organization

**Location:** separate dirs, not co-located: `test/` (unit), `e2e/` (browser).

**Naming:** `test/<module>.test.js`; `e2e/*.spec.js`. Helpers live in `test/helpers/` (`dom.js`, `boot.js`) and are not matched by the `*.test.js` glob (deliberate, to avoid vacuous passes). Fixtures: `test/fixtures/shop-norm.json`.

**Structure:**
```
test/*.test.js        flat, one file per src module (+ schema-*, ui, page, guard tests)
test/helpers/         dom.js (setupDom), boot.js (bootApp)
e2e/smoke.spec.js, car-photo-framing.spec.js, static-server.js
```

## Test Structure

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const bills = require('../src/data/bills.js');
test.beforeEach(() => bills.reset());
test('readBill maps server statuses and never rejects', async () => {
  bills.configure({ client: client(err(429)) });
  assert.strictEqual((await bills.readBill('x')).error, 'limit');
});
```
- Flat top-level `test(...)`, no `describe` nesting. Test names are full sentences describing behavior.
- Reset module state with `test.beforeEach`; DOM tests call `cleanup()` from `setupDom()`.

## Mocking

**Framework:** hand-rolled fakes; no sinon/jest mocks.

**Patterns:**
```js
const client = res => ({ functions: { invoke: (name, opts) => { client.last = [name, opts]; return Promise.resolve(res); } } });
bills.configure({ client: c });           // inject dependency via configure()
```
- Dual-mode modules take injected env via `configure({...})`.
- Storage tests: `global.indexedDB = new IDBFactory()` and fresh `localStorage` Map per test; reload module with `require.resolve` + cache delete (`freshStorage` in `test/idb.test.js`).
- Full app: `bootApp()` in `test/helpers/boot.js` evaluates `index.html`'s scripts in a fresh `vm` context per boot under linkedom (`setupDom` in `test/helpers/dom.js` stubs `matchMedia`, `localStorage`). `assertScriptOrderMatchesIndexHtml` keeps order honest.

**What to Mock:** Supabase client, network, localStorage/IndexedDB, DOM.
**What NOT to Mock:** the pure logic modules and the real shipped scripts (boot them rather than copy code).

## Fixtures and Factories

- Inline object literals at the top of the test file (`const bill = {...}` in `test/bills.test.js`); small factory lambdas for fakes. Shared JSON in `test/fixtures/`.

## Coverage

**Requirements:** None enforced; no coverage tooling.

## Test Types

**Unit Tests:** pure modules in `src/data`, `src/core`, `src/ui` via `require()`.
**Integration Tests:** page/UI tests through `bootApp` (`test/render.test.js`, `test/admin-page.test.js`, `test/guidance-ui.test.js`).
**Guard tests:** `test/no-raw-templates.test.js` (scans `main.js`, `src/pages`, `src/ui` for untagged innerHTML templates, with a sanity floor of >100 calls), `test/precache.test.js` (service worker precache list).
**E2E:** Playwright run twice per test: project `file` (file:// origin, localStorage backend) and `http` (127.0.0.1:4173 via `e2e/static-server.js`, IndexedDB backend). `retries: 0`, timeouts 30s test / 10s expect. Wait on app signal (`window.session.booted()`), not sleeps. Each test needs a car; helper `ensureVehicle` creates one (no default seed).

## CI

`.github/workflows/test.yml`: job `test` (Node 22, `npm ci`, `npm test`, then `node --check` on every non-test `.js`) and job `browser` (Playwright chromium + `npm run test:e2e`). Run on every push and PR.

## Common Patterns

**Async Testing:** `test('...', async () => { assert.deepStrictEqual(await fn(), {...}); })`.

**Error Testing:** assert the returned error code instead of `assert.rejects`, since services never reject; inject a throwing client: `{ functions: { invoke: () => { throw new Error('boom'); } } }` expecting `'failed'`.

**Playwright errors:** collect `page.on('pageerror')` and assert empty.

**New module checklist:** add `test/<name>.test.js`; if it is a new script update `index.html`, `sw.js` precache and run `npm test` (precache/boot-order tests will flag omissions).

---

*Testing analysis: 2026-11-04*
