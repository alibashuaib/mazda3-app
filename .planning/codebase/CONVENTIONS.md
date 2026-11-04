# Coding Conventions

**Analysis Date:** 2026-11-04

## Naming Patterns

**Files:**
- kebab-case, lowercase `.js`: `src/data/remote-catalog.js`, `src/ui/shop-field.js`, `src/core/async-click.js`.
- Tests mirror the module: `test/<module>.test.js`; schema tests prefixed `schema-` (`test/schema-bills.test.js`).
- Entry script is `main.js` (root). Service worker `sw.js`.

**Functions:**
- camelCase. Page renderers are `renderX()` (`renderFuel` in `src/pages/fuel.js`). Internal row builders are nouns (`fuelRows`).
- Dual-mode modules expose small verbs: `configure`, `reset`, `available`, `readBill`, `toPrefill` (`src/data/bills.js`).

**Variables:**
- camelCase; constants UPPER_SNAKE (`MAX_ESC_DEPTH`, `ENTITIES`, `QUICK_ACTIVE_KEY`).
- Wire/DB fields from the server use snake_case (`part_no`); mapped to camelCase in app code (`partNo`).

**Types:**
- No TypeScript, no JSDoc types. Plain JS objects. Classes are rare (`class Raw extends String` in `src/ui/html.js`).

## Code Style

**Formatting:**
- No Prettier/EditorConfig/ESLint config present. Follow existing style: 2-space indent, single quotes, semicolons, `'use strict';` at top of every file.
- Terse arrow functions and one-line `if` returns are common. Long lines are tolerated.
- Banner comment block (`/* ==== Title — purpose ==== */`) opens every file.

**Linting:**
- None. CI only runs `node --check` on every shipped `.js` (`.github/workflows/test.yml`).

## Import Organization

No ES modules and no bundler: browser files are classic `<script>` tags loaded in order from `index.html` (must work from `file://`). Cross-file references use bare globals (`session`, `html`, `t`, `Status`).

**Dual-mode module pattern (required for anything under `src/data`, `src/core`, `src/ui/html.js`) so Node tests can `require()` it:**
```js
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else root.bills = api;           // or Object.assign(root, api)
})(typeof self !== 'undefined' ? self : globalThis, function () { ...; return { ... }; });
```
- `src/pages/*.js` and `main.js` are plain scripts (not require()-able); tested only via `test/helpers/boot.js`.
- Adding a new script requires updating `index.html` order, `sw.js` precache, and keep `test/precache.test.js` / `assertScriptOrderMatchesIndexHtml` green.

**Path Aliases:** None.

## Error Handling

- Network/service functions never reject: they resolve `{ ok:false, error:'unavailable'|'offline'|'limit'|'unreadable'|'failed' }` (`src/data/bills.js`). Map HTTP status to a short code; unknown statuses fall to `'failed'`.
- Storage/localStorage access wrapped in `try { ... } catch (e) {}` and returns `null` on failure (`src/data/storage.js`).
- Offline-first: manual form must always work if remote features fail.

## Logging

- Essentially none; `console.*` appears only a handful of times (`main.js`, `src/data/storage.js`, `src/pages/admin.js`, `src/ui/chrome.js`). Do not add logging noise.

## Security / HTML

- Every HTML string MUST be built with the `html` tagged template from `src/ui/html.js`; interpolations auto-escape. Raw markup only through `raw()`. Never assign untagged template strings to `innerHTML`. Enforced by `test/no-raw-templates.test.js`.
- User-facing strings wrapped in `t('English text')`; Arabic translations in `src/i18n/strings.ar.js`. Support RTL.

## Comments

- Comment the WHY heavily: multi-line block comments explain past bugs, rejected alternatives and constraints (see `src/pages/fuel.js`, `test/helpers/boot.js`). Section banners `PAGE 6 — FUEL LOG & ECONOMY`.
- Inline `//` for short trailing notes.
- No JSDoc.

## Function Design

- Small pure functions separated from rendering (`fuelRows` pure, `renderFuel` renders). Put logic in `src/data/*` or `src/core/*` so it is unit-testable.
- Defensive numeric coercion: `Number(e.cost) || 0`; null-safe defaults (`bill.items || []`).
- Return fresh objects; use `Object.assign({}, env, next)` for config.

## Module Design

- Return one flat API object; no default exports, no barrel files.
- Module-level mutable state is kept minimal and resettable via `reset()` for tests.

## Project instructions

- `AGENTS.md`: before editing any car image read `docs/CAR-ASSET-GUIDE.md` and `output/CAR-ASSET-LESSONS.md`; do not reapply rejected Mazda2 softening 175 or Mazda3 chrome-notch 196.
- No `.claude/skills` or `.agents/skills` present.

---

*Convention analysis: 2026-11-04*
