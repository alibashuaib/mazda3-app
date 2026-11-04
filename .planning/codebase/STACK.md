# Technology Stack

**Analysis Date:** 2026-11-04

## Languages

**Primary:**
- JavaScript (ES202x, classic non-module scripts) - entire browser app: `main.js`, `src/**`, `sw.js`
- CSS - `styles.css` (single stylesheet)
- HTML - `index.html` (single page, ordered `<script>` tags)

**Secondary:**
- SQL (Postgres) - `supabase/schema.sql`, `supabase/seed-catalogue.sql`, `supabase/tests/*.sql`
- TypeScript (Deno) - Edge Functions `supabase/functions/read-bill/index.ts`, `supabase/functions/plan-intake/index.ts`
- JavaScript ESM (`.mjs`) - pure logic shared/tested for functions: `supabase/functions/*/logic.mjs`
- Python - `tools/graphify-repair.py` (tooling only)

## Runtime

**Environment:**
- Browser PWA (Chromium-tested); also runs from `file://` (documented feature)
- Node >= 22 for tests/tools (`package.json` engines; CI uses 22)
- Deno (Supabase Edge Functions)

**Package Manager:**
- npm
- Lockfile: present (`package-lock.json`)

## Frameworks

**Core:**
- None. Vanilla JS, no build step, no bundler, no ES modules in the browser. Dual-mode modules (browser global + `require`) under `src/`.

**Testing:**
- `node --test` (built-in runner) - unit tests in `test/**/*.test.js`
- `linkedom` ^0.18.13 - DOM emulation for unit tests
- `fake-indexeddb` ^6.2.5 - IndexedDB in Node
- `@playwright/test` ^1.62.1 - e2e (`e2e/*.spec.js`, `playwright.config.js`)

**Build/Dev:**
- None. `e2e/static-server.js` serves files at 127.0.0.1:4173 for e2e.

## Key Dependencies

**Critical:**
- `@supabase/supabase-js` 2.58.0 - vendored UMD at `vendor/supabase.js` (exposes `window.supabase`), lazy-loaded from `main.js`; see `vendor/README.md`. Not an npm dependency.

**Infrastructure:**
- No runtime npm packages; all npm deps are dev-only.
- Edge functions import `npm:@supabase/supabase-js@2`.

## Configuration

**Environment:**
- Client: Supabase URL and anon (public) key hardcoded in `src/data/account.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). No `.env` in repo.
- Edge function secrets (via `supabase secrets set`): `ANTHROPIC_API_KEY`, `INTAKE_CRON_SECRET`, optional `BILL_MODEL`, `INTAKE_MODEL`, `BILL_GLOBAL_DAILY_CAP`.

**Build:**
- `package.json`, `playwright.config.js`, `.github/workflows/test.yml`
- PWA: `manifest.webmanifest`, `sw.js` (network-first, cache `garage-vNNN`; bump `CACHE` and keep `ASSETS` in sync when adding files, checked by `test/precache.test.js`)

## Platform Requirements

**Development:**
- Node 22+, `npm ci`; `npm test`; `npm run test:e2e` (needs `npx playwright install chromium`)

**Production:**
- Static hosting of repo root (no build) + Supabase project (Postgres, Auth, Storage, Edge Functions, pg_cron)

---

*Stack analysis: 2026-11-04*
