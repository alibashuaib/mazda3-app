<!-- refreshed: 2026-11-04 -->
# Architecture

**Analysis Date:** 2026-11-04

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│  index.html (classic <script> tags, fixed order) + sw.js     │
├──────────────────┬──────────────────┬───────────────────────┤
│  Pages           │  UI toolkit      │  main.js              │
│ `src/pages/*.js` │ `src/ui/*.js`    │  router, vehicle      │
│  render*()       │ html``, modal,   │  lifecycle, boot      │
│                  │ chrome, photo    │                       │
└────────┬─────────┴────────┬─────────┴──────────┬────────────┘
         ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Data layer `src/data/*.js` (dual-mode modules)              │
│  session (in-memory garage) <- storage (IDB/localStorage)    │
│  account (sync, auth) -> Supabase; status/insights/shops/... │
└─────────────────────────────────────────────────────────────┘
         ▼
┌─────────────────────────────────────────────────────────────┐
│ IndexedDB / localStorage (local)   Supabase `supabase/`      │
│ `src/data/storage.js`              schema.sql, edge functions│
└─────────────────────────────────────────────────────────────┘
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

**Overall:** Vanilla-JS offline-first PWA SPA; no build step, no ES modules, runs from `file://`.

**Key Characteristics:**
- Classic scripts share one global scope; load order in `index.html` is the dependency graph (`main.js` last).
- Data modules are "dual-mode" IIFEs: `module.exports` under Node (tests), else `Object.assign(root, api)` or `root.<namespace> = api`.
- Page modules are plain scripts, each exports a global `render<Page>()` returning a DOM node; not `require()`d by tests (exercised through `test/helpers/boot.js`).
- Local-first: all data works offline; server sync is optional and post-first-paint.

## Layers

**Core:** `src/core/` (helpers, schedule, async-click). No deps; used by all.
**Data:** `src/data/`. Depends on core. No DOM (except injected). Used by pages/main.
**UI toolkit:** `src/ui/`. DOM/HTML helpers.
**i18n:** `src/i18n/`. `t()` wraps user-facing strings.
**Pages:** `src/pages/`. Depend on everything below; use globals.
**Shell:** `main.js`. Wires `account.configure({...})`, `remoteCatalog.configure(...)`.

## Data Flow

### Boot

1. `index.html` inline scripts set theme/accent before paint.
2. Scripts load in order; `main.js` runs `session.load()` (`main.js` ~line 600).
3. `applyAccent(); renderTopbar(); go('dashboard')` (or `admin` for `#admin`).
4. After first paint: `loadBackend()` injects `vendor/supabase.js`, then `account.start()`, then `remoteCatalog.refresh()` and `syncDealerPlan()`. Failures are logged, never fatal.

### Navigation / render

`go(route, intent)` in `main.js` -> `routes[route]()` -> returns node -> replaces `#view` children. Unknown route falls back to dashboard. Empty garage renders onboarding.

### Save and sync

Page mutates `session.current()` -> `save()` (`session.save()`) -> `storage.saveVehicle` -> afterSave hook -> `account` enqueues to outbox -> `kickSync` pushes to Supabase. Direct `saveVehicle()` calls (e.g. `addVehicle` in `main.js`) must enqueue manually (`account.enqueueVehicle`, `enqueuePhoto`, `enqueueGarage`).

**State Management:** Single garage in `session` (`_garage`, `_state`, `_photos`); route in `current` and `navIntent` in `main.js`.

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
**What happens:** `Object.assign(root, api)` publishes names globally.
**Why it's wrong:** collisions (`save` would collide).
**Do this instead:** export a namespace like `root.session = api` (`src/data/session.js`).

### Bypassing session.save() without enqueueing
**What happens:** direct `saveVehicle()` skips afterSave hook.
**Why it's wrong:** vehicle never syncs; next pull deletes it.
**Do this instead:** follow `addVehicle` in `main.js`.

### Raw HTML interpolation
**Do this instead:** use `html```; use `raw()` only for trusted markup (e.g. `BRAND_MARK`).

## Error Handling

**Strategy:** Local data first; failures degrade silently with console logging.
- Boot failure paints "Could not open your garage" card (`main.js`).
- Quota errors surface via `isQuotaError` + `toast(..., 'warn')`.
- Post-paint network work is `.catch(console.error)`.

## Cross-Cutting Concerns

**Logging:** `console.error` only.
**Validation:** `normalizeData` on load/pull (`src/data/normalize.js`); Postgres RLS in `supabase/schema.sql`.
**Authentication:** Supabase auth via `src/data/account.js`; admin role checked by `catalogAdmin.isAdmin()`.
**i18n:** `t('English string')` keyed by English; Arabic in `src/i18n/strings.ar.js`.

---

*Architecture analysis: 2026-11-04*
