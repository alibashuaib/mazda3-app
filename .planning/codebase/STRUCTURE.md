# Codebase Structure

**Analysis Date:** 2026-11-04

## Directory Layout

```
mazda3-app/
├── index.html            # Shell; ordered <script> tags
├── main.js               # Router, vehicle lifecycle, boot
├── sw.js                 # Service worker (precache list, CACHE version)
├── styles.css            # All styles
├── manifest.webmanifest  # PWA manifest
├── icon.svg
├── src/
│   ├── core/             # helpers, schedule, async-click
│   ├── data/             # session, storage, account, status, catalog, community modules
│   ├── i18n/             # lang.js, strings.ar.js
│   ├── pages/            # dashboard, maintenance, parts, fuel, budget, reports, documents, admin
│   └── ui/               # html, modal, chrome, photo, color, shop-field, shop-feedback
├── vendor/               # supabase.js (committed, lazy-loaded) + README.md
├── assets/               # Car photos .webp: <model>-<color-slug>.webp
├── supabase/             # schema.sql, seed-catalogue.sql, functions/, tests/ (SQL)
├── test/                 # node:test unit tests; helpers/ (boot.js, dom.js); fixtures/
├── e2e/                  # Playwright specs + static-server.js
├── tools/                # seed-catalogue.js, graphify-repair.py
├── docs/                 # CAR-ASSET-GUIDE.md, superpowers/{plans,specs,verification}
├── output/               # Car-asset review artifacts, CAR-ASSET-LESSONS.md
├── .github/workflows/    # test.yml (node tests + node --check + e2e)
├── .planning/codebase/   # These maps
├── AGENTS.md             # Agent instructions (read docs/CAR-ASSET-GUIDE.md before car image edits)
└── package.json          # Dev deps only (playwright, fake-indexeddb, linkedom)
```

## Directory Purposes

**`src/data/`:** State and logic, dual-mode IIFEs. Key: `session.js`, `storage.js`, `account.js`, `normalize.js`, `status.js`, `catalog.js` (largest model list).
**`src/pages/`:** One file per route; defines `render<Name>()`. Largest: `maintenance.js`.
**`src/ui/`:** Reusable DOM/HTML helpers and app chrome.
**`supabase/functions/<name>/`:** `index.ts` (Deno handler), `logic.mjs` (testable pure logic), `README.md`.

## Key File Locations

**Entry Points:** `index.html`, `main.js`, `sw.js`
**Configuration:** `package.json`, `playwright.config.js`, `manifest.webmanifest`, `.github/workflows/test.yml`
**Core Logic:** `src/data/session.js`, `src/data/storage.js`, `src/data/status.js`, `src/core/schedule.js`
**Routes:** `routes` object in `main.js`
**Schema:** `supabase/schema.sql`
**Testing:** `test/*.test.js`, `test/helpers/boot.js` (boots shipped scripts in a fresh vm context), `e2e/*.spec.js`

## Naming Conventions

**Files:** lowercase kebab-case `.js` (`remote-catalog.js`, `shop-field.js`); tests `<module>.test.js`; schema tests `schema-<topic>.test.js`; e2e `<topic>.spec.js`.
**Assets:** `<modelid>-<color-slug>.webp`.
**Plans/specs:** `YYYY-MM-DD-<topic>.md` in `docs/superpowers/`.
**Functions:** page renderers `render<Page>`; modules expose namespaces in camelCase (`remoteCatalog`, `catalogAdmin`).

## Where to Add New Code

**New page:** `src/pages/<name>.js` defining `render<Name>()`; add `<script>` before `main.js` in `index.html`; add to `routes` in `main.js`; add a tab (`data-route`) in `index.html`; add path to `sw.js` `ASSETS` and bump `CACHE`.
**New data module:** `src/data/<name>.js` using the dual-mode IIFE wrapper (copy `src/data/session.js`); register in `index.html` after its dependencies and in `sw.js`; test in `test/<name>.test.js`.
**UI helper:** `src/ui/`. **Pure helper:** `src/core/`.
**Strings:** wrap in `t()`; add Arabic in `src/i18n/strings.ar.js`.
**DB change:** edit `supabase/schema.sql` (idempotent `create ... if not exists`), add SQL test in `supabase/tests/`, and a `test/schema-*.test.js` if pattern matches.
**Tests:** `test/<module>.test.js` (run `npm test`); browser flows in `e2e/` (`npm run test:e2e`).

## Special Directories

**`node_modules/`:** generated, not committed.
**`vendor/`:** committed third-party; no build step.
**`output/`:** car-asset review artifacts; consult before editing car images.
**`.planning/`:** planning docs.

---

*Structure analysis: 2026-11-04*
