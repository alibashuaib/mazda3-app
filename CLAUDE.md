<!-- GSD:project-start source:PROJECT.md -->
## Project

**Car Care — Autopilot Catalogue**

Car Care is an offline-first Mazda care PWA (vanilla HTML/CSS/JS, no build step, optional Supabase sync) used in Saudi Arabia: pick a model/generation/engine, get a matching maintenance schedule, parts with OEM and cheaper alternatives in SAR, a service history and a budget. This milestone puts the app's **catalogue on autopilot**: once a month it finds new Mazda models, official dealer maintenance schedules, OEM parts, community knowledge (app users, owner forums, parts marketplaces) and car photos, and queues every finding for the owner to review and approve in the in-app admin page. The owner only reviews and approves; nothing reaches users without approval.

**Core Value:** New and changed catalogue data (schedules, parts, prices, photos) arrives in the admin review queue automatically every month, and nothing is published to users without the owner's explicit approval.

### Constraints

- **Tech stack**: Vanilla JS, no build step, no ES modules, must run from `file://` — existing app guarantee
- **Backend**: Supabase (Postgres + RLS, Edge Functions on Deno, pg_cron, Storage) — already in production
- **Security**: Every new table needs RLS; untrusted web/LLM output only rendered through the escaping `html` template — admin UI renders scraped content
- **Approval gate**: Autopilot writes only drafts/pending rows, never live tables — core value
- **Cadence/cost**: Monthly run with a hard cost cap — owner wants low running cost
- **Scraping**: Respect robots/terms of sources; keep existing SSRF guards for all fetches
- **Testing**: Node ≥22 `node --test` + Playwright; CI must stay green
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- JavaScript (ES202x, classic non-module scripts) - entire browser app: `main.js`, `src/**`, `sw.js`
- CSS - `styles.css` (single stylesheet)
- HTML - `index.html` (single page, ordered `<script>` tags)
- SQL (Postgres) - `supabase/schema.sql`, `supabase/seed-catalogue.sql`, `supabase/tests/*.sql`
- TypeScript (Deno) - Edge Functions `supabase/functions/read-bill/index.ts`, `supabase/functions/plan-intake/index.ts`
- JavaScript ESM (`.mjs`) - pure logic shared/tested for functions: `supabase/functions/*/logic.mjs`
- Python - `tools/graphify-repair.py` (tooling only)
## Runtime
- Browser PWA (Chromium-tested); also runs from `file://` (documented feature)
- Node >= 22 for tests/tools (`package.json` engines; CI uses 22)
- Deno (Supabase Edge Functions)
- npm
- Lockfile: present (`package-lock.json`)
## Frameworks
- None. Vanilla JS, no build step, no bundler, no ES modules in the browser. Dual-mode modules (browser global + `require`) under `src/`.
- `node --test` (built-in runner) - unit tests in `test/**/*.test.js`
- `linkedom` ^0.18.13 - DOM emulation for unit tests
- `fake-indexeddb` ^6.2.5 - IndexedDB in Node
- `@playwright/test` ^1.62.1 - e2e (`e2e/*.spec.js`, `playwright.config.js`)
- None. `e2e/static-server.js` serves files at 127.0.0.1:4173 for e2e.
## Key Dependencies
- `@supabase/supabase-js` 2.58.0 - vendored UMD at `vendor/supabase.js` (exposes `window.supabase`), lazy-loaded from `main.js`; see `vendor/README.md`. Not an npm dependency.
- No runtime npm packages; all npm deps are dev-only.
- Edge functions import `npm:@supabase/supabase-js@2`.
## Configuration
- Client: Supabase URL and anon (public) key hardcoded in `src/data/account.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). No `.env` in repo.
- Edge function secrets (via `supabase secrets set`): `ANTHROPIC_API_KEY`, `INTAKE_CRON_SECRET`, optional `BILL_MODEL`, `INTAKE_MODEL`, `BILL_GLOBAL_DAILY_CAP`.
- `package.json`, `playwright.config.js`, `.github/workflows/test.yml`
- PWA: `manifest.webmanifest`, `sw.js` (network-first, cache `garage-vNNN`; bump `CACHE` and keep `ASSETS` in sync when adding files, checked by `test/precache.test.js`)
## Platform Requirements
- Node 22+, `npm ci`; `npm test`; `npm run test:e2e` (needs `npx playwright install chromium`)
- Static hosting of repo root (no build) + Supabase project (Postgres, Auth, Storage, Edge Functions, pg_cron)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- kebab-case, lowercase `.js`: `src/data/remote-catalog.js`, `src/ui/shop-field.js`, `src/core/async-click.js`.
- Tests mirror the module: `test/<module>.test.js`; schema tests prefixed `schema-` (`test/schema-bills.test.js`).
- Entry script is `main.js` (root). Service worker `sw.js`.
- camelCase. Page renderers are `renderX()` (`renderFuel` in `src/pages/fuel.js`). Internal row builders are nouns (`fuelRows`).
- Dual-mode modules expose small verbs: `configure`, `reset`, `available`, `readBill`, `toPrefill` (`src/data/bills.js`).
- camelCase; constants UPPER_SNAKE (`MAX_ESC_DEPTH`, `ENTITIES`, `QUICK_ACTIVE_KEY`).
- Wire/DB fields from the server use snake_case (`part_no`); mapped to camelCase in app code (`partNo`).
- No TypeScript, no JSDoc types. Plain JS objects. Classes are rare (`class Raw extends String` in `src/ui/html.js`).
## Code Style
- No Prettier/EditorConfig/ESLint config present. Follow existing style: 2-space indent, single quotes, semicolons, `'use strict';` at top of every file.
- Terse arrow functions and one-line `if` returns are common. Long lines are tolerated.
- Banner comment block (`/* ==== Title — purpose ==== */`) opens every file.
- None. CI only runs `node --check` on every shipped `.js` (`.github/workflows/test.yml`).
## Import Organization
- `src/pages/*.js` and `main.js` are plain scripts (not require()-able); tested only via `test/helpers/boot.js`.
- Adding a new script requires updating `index.html` order, `sw.js` precache, and keep `test/precache.test.js` / `assertScriptOrderMatchesIndexHtml` green.
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
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
```
## Component Responsibilities
| Component | Responsibility | File |
|-----------|----------------|------|
| Boot/router | `routes` map, `go()`, vehicle add/switch/delete, boot chain | `main.js` |
| Session | In-memory garage; only access path to vehicle data via `session.current()` | `src/data/session.js` |
| Storage | IndexedDB (localStorage fallback), photos blobs, sync outbox, meta | `src/data/storage.js` |
| Normalize | Heals/migrates loaded data from older builds | `src/data/normalize.js` |
| Account | Supabase auth + push/pull sync; sole caller of `session.clear()` | `src/data/account.js` |
| Status | Pure service-due/health calculations | `src/data/status.js` |
| Catalog | `CAR_MODELS`, `buildProfile` | `src/data/catalog.js` |
| Remote catalog | Shared dealer plans from server, cached | `src/data/remote-catalog.js` |
| Community | insights, shops, bills, repairable, guidance, recalls, pricing | `src/data/*.js` |
| Admin | Catalogue admin role | `src/data/admin.js`, `src/pages/admin.js` |
| html | Auto-escaping `html` tagged template, `raw()` | `src/ui/html.js` |
| Chrome | Topbar, theme/accent, account menu, icons | `src/ui/chrome.js` |
| i18n | `t()` and Arabic strings | `src/i18n/lang.js`, `src/i18n/strings.ar.js` |
| Service worker | Network-first cache, precache list | `sw.js` |
| Edge functions | Bill reading, plan intake (Deno) | `supabase/functions/read-bill`, `supabase/functions/plan-intake` |
## Pattern Overview
- Classic scripts share one global scope; load order in `index.html` is the dependency graph (`main.js` last).
- Data modules are "dual-mode" IIFEs: `module.exports` under Node (tests), else `Object.assign(root, api)` or `root.<namespace> = api`.
- Page modules are plain scripts, each exports a global `render<Page>()` returning a DOM node; not `require()`d by tests (exercised through `test/helpers/boot.js`).
- Local-first: all data works offline; server sync is optional and post-first-paint.
## Layers
## Data Flow
### Boot
### Navigation / render
### Save and sync
## Key Abstractions
- **session** (`src/data/session.js`): sole holder of vehicle data; `clear()` is sign-out.
- **html`` / raw()** (`src/ui/html.js`): safe templating; `test/no-raw-templates.test.js` guards raw usage.
- **Vehicle record** `{ id, data }` built by `buildProfile` + `normalizeData`.
- **Outbox** in `src/data/storage.js` (`garage.sync.outbox`) for pending sync.
## Entry Points
- `index.html`: loads scripts; `main.js`: boot; `sw.js`: service worker (registered from `main.js`).
- `supabase/functions/*/index.ts`: edge function handlers (pure logic in `logic.mjs`).
## Architectural Constraints
- **Threading:** single browser main thread; service worker separate.
- **Global state:** top-level `const`/functions in `main.js` and pages share the global scope (name collisions are real; `session` is a namespace for that reason).
- **Script order:** new file must be added to `index.html` AND `sw.js` `ASSETS` (and bump `CACHE`); `test/precache.test.js` checks this.
- **No ES modules/bundler:** required to run from `file://` and cache offline.
- **Node >= 22** for tests.
## Anti-Patterns
### Loose globals from data modules
### Bypassing session.save() without enqueueing
### Raw HTML interpolation
## Error Handling
- Boot failure paints "Could not open your garage" card (`main.js`).
- Quota errors surface via `isQuotaError` + `toast(..., 'warn')`.
- Post-paint network work is `.catch(console.error)`.
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
