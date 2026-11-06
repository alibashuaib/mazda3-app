# Phase 1: Reliable & Safe Foundation - Pattern Map

**Mapped:** 2026-11-05
**Files analyzed:** 33 (new and modified)
**Analogs found:** 27 / 33 (6 files have no close analog; see "No Analog Found")

Source documents: `01-CONTEXT.md` (D-01..D-20, FND-01..FND-11 scope), `01-RESEARCH.md` (pitfalls 1-25, file layout). Line numbers below are from the current working tree.

## Known conflicts to resolve in planning

1. **`test/precache.test.js` lines 69-77 pin the `garage-v<N>` cache name** (`assert.match(... /const CACHE\s*=\s*'garage-v(\d+)'/)` and `>= 45`). D-18 (hash cache name) breaks this test. Replace it with the hash check in the same change (Research Pitfall 18).
2. **`sw.js` line 20 (`cache.addAll(ASSETS).then(() => self.skipWaiting())`) and line 26 (`self.clients.claim()`)** must both go (D-17). `test/precache.test.js` lines 79-83 expect `controllerchange` plus `location.reload()` in `main.js`; keep those, since they still work when the new SW activates on next launch.
3. **`sw.js` line 25 deletes every cache whose key is not `CACHE`.** Once photo and module caches exist, this wipes them on every release. Replace with an explicit `KEEP` set (Research Pitfall 1).
4. **`src/ui/chrome.js` line 128** trims the toast host to `TOAST_CAP = 3`, oldest first. A persistent Retry toast (D-09) gets evicted by the next toast unless it is exempted (Research Pitfall 2).
5. **`main.js` lines 296 and 483** wrap `save()` in `try { ok = await save(); } catch (e) {}`. `session.save()` never rejects (it resolves `false` and calls `env.notify`), so these catches are inert. The real silent point is `src/data/session.js` line 169, and the `if (ok) toast(...)` at main.js 299 and 493 only toasts on success.
6. **Errors tab:** `src/pages/admin.js` has no tab component. The closest analog is the review-queue card (`adminQueue`). The tab pattern is new, so Phases 2/3 will copy what Phase 1 builds here.
7. **`plan-intake/index.ts` line 114 `catch { skipped++; }` and line 136 `catch { return json(500, ...) }`** both swallow errors silently. FND-02 (D-05) requires both to write to `app_errors` with `source = 'plan-intake'`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/data/error-log.js` (new) | service (client logger) | event-driven + request-response (insert) | `src/data/bills.js` | role-match (dual-mode, never-rejects) |
| `src/ui/chrome.js` (modify) | component (toast) | event-driven | itself: `undoToast` (lines 145-161) | exact |
| `src/data/session.js` (modify) | service (save path) | CRUD | itself: `save()` (lines 151-183) | exact |
| `main.js` (modify) | controller (page save handlers) | request-response | itself: lines 292-299, 470-483 | exact |
| `src/i18n/strings.ar.js` (modify) | config (strings) | transform | itself: lines 350-351 | exact |
| `src/pages/admin.js` (modify) | component (admin page) | CRUD | itself: `adminQueue` (lines 63-80) | role-match |
| `src/data/admin.js` (modify) | service (admin data) | request-response | itself: dual-mode header (lines 10-15) | exact |
| `src/data/car-photos.js` (new) | utility (URL map) | transform | `src/pages/dashboard.js` `studioCarImage` (lines 209-223) | role-match |
| `src/pages/dashboard.js` (modify) | component (dashboard) | transform | itself: lines 200-223 | exact |
| `sw.js` (modify) | middleware (service worker) | request-response | itself: lines 19-52 | exact |
| `test/precache.test.js` (modify) | test | batch (static) | itself: lines 17-36, 69-77 | exact |
| `tools/sw-version.js` (new) | utility (Node CLI) | batch | `tools/seed-catalogue.js` (not excerpted) | partial |
| `test/sw-version.test.js` (new) | test | batch | `test/precache.test.js` | role-match |
| `test/sw-install.test.js`, `test/sw-cache.test.js` (new) | test | event-driven (vm) | `test/precache.test.js` (reads sw.js as text) | partial |
| `vendor/pins.json` (new) | config | — | `vendor/README.md` (pin facts) | partial |
| `test/vendor-pin.test.js` (new) | test | batch | `test/precache.test.js` | role-match |
| `test/car-photos.test.js` (new) | test | transform | `test/plan-intake-logic.test.js` (dynamic import loader) | role-match |
| `supabase/schema.sql` (modify) | migration (DDL + RLS) | CRUD | itself: `bill_reads` (545-550), `is_admin` (615-619), `shops` (323-332) | exact |
| `supabase/tests/app-errors-rls.sql` (new) | test (SQL) | CRUD | `supabase/tests/bills.sql` | exact |
| `test/rls-coverage.test.js` (new) | test | batch (static) | `test/precache.test.js` | role-match |
| `supabase/functions/_shared/cors.mjs` (new) | utility (pure policy) | request-response | `supabase/functions/plan-intake/index.ts` lines 7-8, 52 | role-match |
| `supabase/functions/_shared/safe-fetch.mjs` (new) | service (pure policy) | request-response | `plan-intake/index.ts` lines 13-48 and `plan-intake/logic.mjs` lines 11-31 | exact |
| `supabase/functions/_shared/net-guard.mjs` (new, moved) | utility (pure) | transform | `plan-intake/logic.mjs` lines 11-31 | exact |
| `supabase/functions/_shared/app-errors.mjs` (new) | utility (pure) | transform | `plan-intake/logic.mjs` lines 1-4 (exported consts) | role-match |
| `supabase/functions/_shared/dns.ts` (new) | utility (Deno resolver) | request-response | `plan-intake/index.ts` lines 13-19 | exact |
| `supabase/functions/plan-intake/index.ts` (modify) | controller (edge handler) | batch | itself: lines 1-137 | exact |
| `supabase/functions/read-bill/index.ts` (modify) | controller (edge handler) | request-response | itself: lines 7-18 | exact |
| `supabase/functions/plan-intake/logic.mjs` (modify) | utility (pure) | transform | itself: lines 11-31 | exact |
| `test/edge-cors.test.js`, `test/edge-safe-fetch.test.js`, `test/edge-plan-intake-batching.test.js` (new) | test | batch | `test/plan-intake-logic.test.js` lines 1-6 | exact |
| `test/error-log.test.js` (new) | test | event-driven | `test/plan-intake-logic.test.js` (+ dual-mode `require`) | role-match |
| `.github/workflows/test.yml` (modify) | config (CI) | batch | itself: lines 9-30 | exact |
| `package.json` (modify) | config | batch | itself: `scripts` block | exact |
| `index.html` (modify) | config (script order) | — | none excerpted; rule in CLAUDE.md | partial |
| `AGENTS.md` (modify) | config (docs) | — | itself: lines 31-33 (the section to keep) | exact |

Every new browser script must be added to `index.html` script order AND `sw.js` `ASSETS`. `assertScriptOrderMatchesIndexHtml` and `test/precache.test.js` enforce this.

---

## Pattern Assignments

### `src/data/error-log.js` (service, event-driven + insert)

**Analog:** `src/data/bills.js` (dual-mode, `configure`/`reset`, never rejects, `env` object).

**Dual-mode header and env** (`src/data/bills.js` lines 1-19):
```javascript
/* ============================================================
   Bills — read a bill photo through the read-bill Edge Function.
   Dual-mode like shops.js. Never rejects; the manual form always works.
   ============================================================ */
'use strict';

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else root.bills = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  let env = { client: null };
  const configure = next => { env = Object.assign({}, env, next || {}); };
  const reset = () => { env = { client: null }; };
  const available = () => !!env.client;
```

**Never-reject + offline guard** (`src/data/bills.js` lines 20-27):
```javascript
  function readBill(dataUrl) {
    if (!env.client) return Promise.resolve({ ok: false, error: 'unavailable' });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve({ ok: false, error: 'offline' });
    return Promise.resolve().then(() => env.client.functions.invoke('read-bill', { body: { image: dataUrl } })).then(res => {
```

Apply to error-log: `report()` resolves `{ ok:false, error }` and never throws. It drops rows when `navigator.onLine === false` (D-01: offline is expected). Keep a per-session cap and dedupe in module state, and expose `reset()` for tests. Insert with `env.client.from('app_errors').insert(row)` and **no `.select()`** (anon has no SELECT; Research Pitfall 4). Column allowlist only (D-03): `source`, `message`, `stack`, `route`, `app_version`. Never pass the failed record.

Also route the existing `console.error` calls in `src/pages/admin.js` (lines 34, 68) through the logger. CLAUDE.md: the logger is the one sanctioned sink.

**Shape of a dual-mode test** (for `test/error-log.test.js`): `require('../src/data/error-log.js')` works because the module sets `module.exports` under Node (same as `bills.js`).

---

### `src/ui/chrome.js` (component, event-driven)

**Analog:** itself. Extend `toastNode` / `undoToast`.

**Toast host and cap** (lines 105-130):
```javascript
const TOAST_CAP = 3;
const TOAST_MS = 2200;
/* A deletion toast holds the only way back, so it has to outlive a plain
   confirmation — 2.2s is not enough to read a message and decide to undo. */
const UNDO_TOAST_MS = 7000;
function toastNode(msg, kind) {
  const host = $('#toastHost');
  const node = el('div', 'toast', html`<span class="dot" style="background:${kind === 'warn' ? 'var(--warn)' : 'var(--ok)'}"></span>${t(msg)}`);
  node.setAttribute('role', kind === 'warn' ? 'alert' : 'status');
  host.appendChild(node);
  // Cap stacked toasts so a burst of quick actions doesn't pile up
  // unboundedly — drop the oldest once the cap is exceeded.
  while (host.children.length > TOAST_CAP) host.firstElementChild.remove();
  return node;
}
```

**Long-lived action toast to copy for Retry** (lines 145-161):
```javascript
function undoToast(msg, onUndo) {
  const node = toastNode(msg, null);
  node.classList.add('toast-action');
  const btn = el('button', 'toast-undo', html`${t('Undo')}`);
  node.appendChild(btn);
  node.onclick = () => fadeToast(node);
  btn.onclick = ev => { ev.stopPropagation(); fadeToast(node); onUndo(); };
  if (typeof btn.focus === 'function') btn.focus();
  setTimeout(() => fadeToast(node), UNDO_TOAST_MS);
}
```

Apply: add `retryToast(msg, onRetry)` that mirrors `undoToast`, uses kind `'warn'` (role=alert), and adds a `toast-retry`/`toast-action` class. Mark it persistent (for example `node.dataset.persistent = '1'`). Skip it in the cap loop at line 128 and do not schedule the `fadeToast` timer. Fade it only on dismiss or retry success (D-09). The message goes through `t()` (toastNode does this). Do not pass pre-translated strings.

Keep the `btn.onclick = ev => { ev.stopPropagation(); ... }` pattern so the Retry click does not dismiss via the node handler.

---

### `src/data/session.js` (service, CRUD)

**Analog:** itself. `save()` already resolves `false` and calls `env.notify`.

**Save contract and afterSave hook** (lines 151-183, condensed):
```javascript
  function save() {
    if (!_garage) return Promise.resolve(false);
    ...
    return Promise.resolve().then(() => doSave(v.id, data, _garage.activeId, dep.uid)).then(res => {
      if (gen !== _generation) return false;   // a clear() happened mid-save — stale write, no side effects
      if (res.ok) {
        ...
        /* ...Throwing here must not turn a successful local save into a failure. */
        try { env.afterSave(v.id, res.data, res.photoIds); } catch (e) {}   // line 169: D-01 site
        return true;
      }
      env.notify(dep.isQuotaError(res.error)
        ? 'Storage is full — your change was NOT saved. Remove some receipt photos.'
        : 'Could not save your change.', 'warn');
      return false;
    }).catch(err => {
      if (gen !== _generation) return false;   // stale write — resolve false, no notify, no cache writes
      env.notify(dep.isQuotaError(err)
        ? 'Storage is full — your change was NOT saved. Remove some receipt photos.'
        : 'Could not save your change.', 'warn');
      return false;
    });
  }
```

Apply:
- Line 169 `try { env.afterSave(...) } catch (e) {}` becomes `catch (e) { errorLog.report({ source: 'client', message: 'afterSave failed: ' + ... }) }`. Log only; no Retry (Research Open Question 2 / D-01). Do not log the `data` or `res.data` payload (D-03).
- Lines 172-174 and 178-180: pass `{ retry: () => save() }` (or the same `retry` closure main.js uses) through `env.notify`. Keep the quota wording (Research Open Question 3).
- Stale-generation branches (lines 160, 177) stay silent. Do not log them.
- Keep the `localStorage` swallows elsewhere (D-12). Only this file's line 169 changes.

---

### `main.js` (controller, request-response)

**Analog:** itself. Two save call sites plus the afterSave hook wiring.

**Colour save (line 292-299)**:
```javascript
      onAsyncClick(opt, async () => {
        if (name === sel) { closeModal(); return; }
        session.current().car.color = name;
        let ok = false;
        try { ok = await save(); } catch (e) {}     // line 296: D-12 site; inert because save() never rejects
        applyAccent(); renderTopbar(); closeModal(); go(current);
        if (ok) toast('Colour updated');
      });
```

**Profile save (lines 470-483)**: same shape, `try { ok = await save(); } catch (e) {}` at line 483, then `if (ok) toast('Profile saved')`.

**afterSave wiring (line 540)**:
```javascript
  afterSave: (id, data, photoIds) => { account.enqueueVehicle(id, data); (photoIds || []).forEach(pid => account.enqueuePhoto(pid)); kickSync(); }
```

Apply: replace both `try/catch` wrappers with `await save()` (no catch needed) or keep the wrapper and log the throw. Either way, the user-visible failure is handled by `session.save()` → `env.notify`. Keep `onAsyncClick` (see `src/core/async-click.js`) for double-tap protection.

Also: the dual-mode `main.js` read of the SW precache report (Research Pitfall 24) happens at boot, next to the existing `register('sw.js', { updateViaCache: 'none' })` call (see `test/precache.test.js` line 81).

---

### `src/i18n/strings.ar.js` (config, transform)

**Analog:** itself. Each key is the English source string; the value is the Arabic translation.

```javascript
  'Storage is full — your change was NOT saved. Remove some receipt photos.': 'مساحة التخزين ممتلئة — لم يتم حفظ التغيير. احذف بعض صور الإيصالات.',
  'Could not save your change.': 'تعذّر حفظ التغيير.',
```
(lines 350-351)

Apply: add `"Couldn't save. Your changes are still on screen.": '...'`, `'Retry': '...'`, and any Errors-tab labels. Keys must match `t()` calls exactly (D-11: plain words, no codes). Existing `'Could not save'` at line 436 is a reusable value if the copy changes.

---

### `src/pages/admin.js` (component, CRUD) — Errors tab

**Analog:** `adminQueue` in the same file (review-queue card). No tab component exists yet.

**Renderer and admin gate** (lines 25-37):
```javascript
async function renderAdminBody(body) {
  if (!catalogAdmin.available()) return adminNotice(body, 'Admin needs an internet connection.');
  if (!account.user()) { body.innerHTML = ''; body.appendChild(adminSignIn()); return; }
  if (!(await catalogAdmin.isAdmin())) return adminNotice(body, 'This account is not an admin.');
  try {
    const node = adminModelId ? await adminEditor(adminModelId) : await adminList();
    body.innerHTML = '';
    body.appendChild(node);
  } catch (e) {
    console.error(e);
    adminNotice(body, 'Could not load the catalogue.');
  }
}
```

**Queue card, text via textContent** (lines 63-76):
```javascript
/* Drafts and recalls the intake function wrote, waiting for a decision. Every
   dynamic string is textContent; a load failure just hides the queue. */
async function adminQueue() {
  let drafts = [], recalls = [];
  try { [drafts, recalls] = await Promise.all([catalogAdmin.listDrafts(), catalogAdmin.listPendingRecalls()]); }
  catch (e) { console.error(e); }
  const card = el('div', 'card');
  card.style.padding = '16px';
  const h = el('h3'); h.textContent = t('Review queue');
  card.appendChild(h);
```

Apply:
- Add an Errors tab next to the review queue (D-06). Show a count badge (unresolved groups, Research Open Question 6).
- Render messages and stacks through `html` (Research Pitfall 25). The queue's `textContent` approach is also acceptable for plain fields, but `html` is required for the grouped table markup. Add an injection fixture test (`<img src=x onerror=...>`).
- Replace `console.error` at lines 34 and 68 with the logger.

Admin-only read and resolve come from RLS, not from this page (comment at line 4: "RLS refuses a non-admin's writes").

---

### `src/data/admin.js` (service, request-response)

**Analog:** itself. Dual-mode IIFE with an injected `account`.

```javascript
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const account = isNode ? require('./account.js') : root.account;
  const api = factory(account);
  if (isNode) module.exports = api;
  else root.catalogAdmin = api;
})(typeof self !== 'undefined' ? self : globalThis, function (account) {
```
(lines 10-15)

Apply: add `listErrors()` and `resolveGroup(groupKey)` here. Follow the `{ ok:false, error }` contract. Read `app_errors` with `.select()` (admin has SELECT via RLS). Resolve is an `.update({ resolved_at })` on the group key.

---

### `src/data/car-photos.js` (utility, transform) — photo version map

**Analog:** `src/pages/dashboard.js` `studioCarImage` (lines 200-223). Behaviour must be preserved exactly, since these strings are cache keys in the field.

**Current ternary to replace** (lines 200-223):
```javascript
const CX_NORMALIZED_PHOTOS = new Set([
  'cx30', 'cx5ke', 'cx5kf', 'cx5gen3', 'cx9tb', 'cx9',
  'cx50', 'cx60', 'cx70', 'cx80', 'cx90'
]);
...
function studioCarImage(color, car) {
  const modelId = car && car.modelId;
  const byModel = CAR_COLOR_PHOTOS[modelId];
  const exact = byModel && byModel[colorSlug(color)];
  const freshAsset = url => modelId === 'mazda3bp' ? `${url}?v=mazda3bp-cleanup-200`
    : modelId === 'mazda6' ? `${url}?v=mazda6-wheel-logo-205`
    : modelId === 'cx3' ? `${url}?v=cx3-alignment-logos-207`
    : modelId === 'mazda2' ? `${url}?v=mazda2-paint-fixes-209`
    : CX_NORMALIZED_PHOTOS.has(modelId) ? `${url}?v=cx-family-fixes-211`
    : modelId === 'mazda3bm' ? `${url}?v=mazda3bm-framing-213` : url;
  if (exact) return freshAsset(exact);
  if (GENERIC_MODEL_IMAGE[modelId]) return freshAsset(GENERIC_MODEL_IMAGE[modelId]);
  if (modelId === 'mazda3bm') return freshAsset('assets/mazda3-studio.webp');
  return '';
}
```

**Target map** (dual-mode, same shape as `bills.js`):
```javascript
const PHOTO_REV = {
  mazda3bp: 'mazda3bp-cleanup-200', mazda6: 'mazda6-wheel-logo-205', cx3: 'cx3-alignment-logos-207',
  mazda2: 'mazda2-paint-fixes-209', mazda3bm: 'mazda3bm-framing-213',
  cx30: 'cx-family-fixes-211', cx5ke: 'cx-family-fixes-211', cx5kf: 'cx-family-fixes-211', cx5gen3: 'cx-family-fixes-211',
  cx9tb: 'cx-family-fixes-211', cx9: 'cx-family-fixes-211', cx50: 'cx-family-fixes-211', cx60: 'cx-family-fixes-211',
  cx70: 'cx-family-fixes-211', cx80: 'cx-family-fixes-211', cx90: 'cx-family-fixes-211'
};
function photoUrl(url, modelId) { const rev = PHOTO_REV[modelId]; return rev ? `${url}?v=${rev}` : url; }
```

Apply: `dashboard.js` calls `photoUrl(exact, modelId)` in place of `freshAsset`, and the `: url` default still applies when a model has no rev. Add `test/car-photos.test.js` asserting that every rev'd asset exists on disk and that URLs are unchanged for all current models (table test over the current `studioCarImage` output). Do not touch the image files (AGENTS.md; `output/CAR-ASSET-LESSONS.md` rejects Mazda2 softening 175 and Mazda3 chrome-notch 196).

Add `car-photos.js` to `index.html` before `dashboard.js` and to `sw.js` `ASSETS`.

---

### `sw.js` (middleware, request-response) — service worker

**Analog:** itself (lines 1-52).

**Current install/activate (lines 19-28)** — the three items to change:
```javascript
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));   // D-17 remove skipWaiting; D-20 per-URL tolerant put
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))   // Pitfall 1: use KEEP set
      .then(() => self.clients.claim())   // D-17 remove
  );
});
```

**Network-first fetch with safe cache write (lines 36-51)**:
```javascript
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }))
  );
```

Apply:
- Keep the `res.ok && res.status === 200 && res.type === 'basic'` guard for every cache write (SWR and LRU too). Keep `.catch` on the `put()` promise.
- Keep the `ignoreSearch` fallback for offline only (Pitfall 21). Key photos by full URL including `?v=`.
- Modules: stale-while-revalidate in a `CACHE` store. Exclude `vendor/*` from background revalidation (Research Open Question 4 / Pitfall 23).
- Photos: separate `PHOTO_CACHE`, max 6 entries, oldest evicted first. Re-put on hit so `keys()` order tracks recency (Pitfall 22).
- Tolerant install (Pattern 2 in research): `Promise.all(ASSETS.map(url => fetch(url, {cache:'reload'}).then(r => r.ok ? cache.put(url, r) : Promise.reject(r.status)).catch(() => failed.push(url))))`. Store the failure list under a `PRECACHE_REPORT` key for `main.js` to read on next load (D-20).
- `CACHE` line 2 becomes a hash written only by `tools/sw-version.js` (D-18).
- Keep the `ASSETS` literal and add `ASSETS.push(...)` batches only in forms `test/precache.test.js` can parse (`const ASSETS\s*=\s*\[...\]` and `ASSETS.push(...)`).

---

### `test/precache.test.js` (test, static)

**Analog:** itself. Keep the helpers; replace the cache-name assertion.

**Helpers to keep (lines 17-36)**:
```javascript
const ROOT = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function swAssets() {
  const src = read('sw.js');
  const literal = src.match(/const ASSETS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(literal, 'sw.js: could not find the ASSETS array');
  const chunks = [literal[1]];
  for (const m of src.matchAll(/ASSETS\.push\(([\s\S]*?)\)\s*;/g)) chunks.push(m[1]);
```

**Assertion to replace (lines 69-77)**:
```javascript
test('the sw cache version is bumped whenever the asset list changes', () => {
  const m = read('sw.js').match(/const CACHE\s*=\s*'garage-v(\d+)'/);
  assert.ok(m, 'sw.js: CACHE must stay in the garage-v<N> form the activate() cleanup keys on');
  assert.ok(Number(m[1]) >= 45, 'sw.js: CACHE version went backwards');
});
```
Replace with the hash check: recompute the hash via `tools/sw-version.js` and fail with a message naming `npm run sw:version` (FND-07, D-18). Keep the `htmlLocalRefs` and "stale asset" checks unchanged.

Note: test lines 61-67 (only the default car image is precached) still apply. `car-photos.js` is a script, not an image, so it does not affect that test.

---

### `tools/sw-version.js` (utility, Node CLI) — new

**Analog:** `tools/seed-catalogue.js` (existing Node tool; not excerpted here, so check its shebang and `require` style before writing).

Apply: one CLI with `--check` (exit 1 on stale) and a default write mode. Hash inputs (Research Pitfall 16): the bytes of each `ASSETS` entry with `\r\n` → `\n`, plus `sw.js` text with the `const CACHE = '...'` line replaced by a fixed placeholder. Use `crypto.createHash('sha256')` (Node). Output: `const CACHE = 'garage-' + hex.slice(0, 12)`. Expose `npm run sw:version` in `package.json`.

---

### `test/sw-version.test.js`, `test/sw-install.test.js`, `test/sw-cache.test.js` (new)

**Analog:** `test/precache.test.js` (read `sw.js` as text). For `sw-install` and `sw-cache`, load `sw.js` in `node:vm` with a fake `self`, `caches`, and `fetch`. No existing vm-based SW test. Keep these fakes in the test file; no framework.

Cover: a missing file still installs (D-20); LRU keeps 6 photos and evicts oldest; the `activate` keep-set keeps `CACHE` and the photo and module caches (Pitfall 1).

---

### `vendor/pins.json` (config) and `test/vendor-pin.test.js` (test)

**Analog:** `vendor/README.md` (current pin facts) and `test/precache.test.js` (read-file test pattern).

From `vendor/README.md` (lines for `supabase.js`):
```
- **Package:** `@supabase/supabase-js`
- **Version:** 2.58.0
- **Source:** https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/dist/umd/supabase.js
- **Publishes:** `window.supabase`
```

Pin content (verified in research): `sha256 = 3ae8cfec4a4715f4e67aa45fe4e7c1a40d67787629c7f10e32afd7dd836edf4e`, `bytes = 136992`. Test: `crypto.createHash('sha256').update(fs.readFileSync('vendor/supabase.js')).digest('hex') === pins.sha256` and the byte count. Update `vendor/README.md` in the same change, since it says "update this file" on upgrade.

---

### `supabase/schema.sql` (migration, CRUD + RLS)

**Analog:** itself. Four patterns to copy.

**Insert-only, no client read, service-role writes** (`bill_reads`, lines 549-550):
```sql
alter table public.bill_reads enable row level security;
revoke all on public.bill_reads from anon, authenticated;
```

**Column-level grants for clients** (`shops`, lines 330-332):
```sql
grant select (id, name, name_norm, name_key, city, area, created_at) on public.shops to authenticated;
revoke all on public.shops from anon;
```

**Admin check, security definer** (`is_admin`, lines 615-621):
```sql
-- security definer so policies can call it without granting profiles reads.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role = 'admin')
$$;

alter table public.profiles enable row level security;
```

**Admin policy on a table** (`car_models`, lines 717-722 region):
```sql
alter table public.car_models enable row level security;
create policy admin_write_car_models on public.car_models for all to authenticated
```

Apply: append an `app_errors` section after the `plan_drafts`/`recalls` block (~line 782+). Start with `revoke all on public.app_errors from anon, authenticated;` (Pitfall 5), then add column grants: insert `(source, message, stack, route, app_version)` for anon and authenticated; select for authenticated (`is_admin()` policy); update `resolved_at` for authenticated (`is_admin()`). Add the `BEFORE INSERT` trigger (global hourly cap, Pitfall 6), `CHECK`s on every text column, and `group_key`. Retention: pg_cron guarded by `pg_available_extensions` (Research code example). Use `if not exists` throughout, matching the file.

The research sketch in `01-RESEARCH.md` (lines 410-455) uses `grant select (...)` for authenticated and `using (public.is_admin())` for the select policy; it is consistent with this file.

---

### `supabase/tests/app-errors-rls.sql` (test, SQL)

**Analog:** `supabase/tests/bills.sql` (lines 1-12, 37-40).

**Header convention** (lines 1-4):
```sql
-- Manual check for bill_reads + vote_shop. Run after schema.sql:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/bills.sql
-- Raises 'FAIL: ...' on a broken rule; finishing silently means pass. Ends in ROLLBACK.
begin;
```

**Impersonation helper** (lines 10-12) and role switch (lines 38-40):
```sql
create or replace function public.tmp_as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', format('00000000-0000-0000-0000-%s', lpad(n::text, 12, '0')), true),
         set_config('request.jwt.claim.role', 'authenticated', true) $$;
...
select public.tmp_as_user(1);
set local role authenticated;
do $$ begin
```

Apply: `set local role anon` must succeed for insert-without-select (Pitfall 4). Anon select must raise `permission denied`. Non-admin select returns zero rows. Admin select returns rows. Use `raise exception 'FAIL: ...'`. Keep the file as a DO-block script (not pgTAP; Research alternatives table).

---

### `test/rls-coverage.test.js` (test, static) — new

**Analog:** `test/precache.test.js` (read file, regex over text).

Apply: `fs.readFileSync('supabase/schema.sql')`, match every `create table (if not exists )?public.<name>`, and assert that each name is followed by `enable row level security` somewhere in the file (`supabase/schema.sql` has 16 `create table` statements today; all have RLS). Fail with the table name in the message.

---

### `supabase/functions/_shared/cors.mjs` (utility, request-response) — new

**Analog:** the CORS constants in both functions.

**plan-intake (`index.ts` lines 7-8)**:
```typescript
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
```

**read-bill (`index.ts` lines 7-12)**:
```typescript
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
```

**OPTIONS before auth (both files)**:
```typescript
if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
```
(plan-intake line 52, read-bill line 18)

Apply: one pure `corsDecision(origin, allowed)` in `cors.mjs` (Research code example, lines 471-484). Both handlers call it first, before OPTIONS and before auth. Foreign or `null` Origin returns 403 (FND-03, D-14). No Origin header passes through (D-16). Also: `json()` and the `CORS` constant must use the decision's headers, so the wildcard disappears. `read-bill` must still answer 403 without a body that leaks config.

Note: the wildcard `Access-Control-Allow-Origin: '*'` at `plan-intake/index.ts` line 7 and `read-bill/index.ts` line 8 is the bug. A test `test/edge-cors.test.js` should grep the two function sources for `'*'` and fail if found (Research layout).

---

### `supabase/functions/_shared/safe-fetch.mjs` (service, request-response) — new

**Analog:** `plan-intake/index.ts` lines 13-48 (current, one-hop, untested) and `plan-intake/logic.mjs` lines 11-31 (guards).

**Current DNS check (`index.ts` lines 13-19)**:
```typescript
async function resolvesPublic(url: string): Promise<boolean> {
  try {
    const host = new URL(url).hostname;
    const ips = [...await Deno.resolveDns(host, 'A').catch(() => []), ...await Deno.resolveDns(host, 'AAAA').catch(() => [])];
    return ips.length > 0 && !ips.some(isPrivateIp);
  } catch { return false; }
}
```

**Current one-redirect flow (`index.ts` lines 22-31)**:
```typescript
async function fetchSource(url: string): Promise<{ kind: 'text' | 'pdf'; body: string } | null> {
  if (!isSafeUrl(url) || !(await resolvesPublic(url))) return null;
  const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if (r.status >= 300 && r.status < 400) {                 // follow one redirect, re-checked
    const loc = r.headers.get('location');
    if (!loc) return null;
    const next = new URL(loc, url).toString();
    if (!isSafeUrl(next) || !(await resolvesPublic(next))) return null;
    return fetchSource1(next);
  }
  return readBody(r);
}
```

**Current read (`index.ts` lines 37-48)** — content-length pre-check then `arrayBuffer()`; no streamed cap (Pitfall 13). Type check is `/pdf/i.test(type)` else text (Pitfall 12).

Apply: one `safeFetch(url, policy, deps)` where `deps = { fetch, resolve, now }` is injected (Node tests pass fakes; `_shared/dns.ts` supplies `Deno.resolveDns`). Loop up to 3 hops, each through `isSafeUrl` + DNS + scheme check; one AbortController deadline across hops and body read; streamed byte cap via `r.body.getReader()`; content-type allowlist (`text/html`, `application/xhtml+xml`, `text/plain`, `application/pdf`). Never throws; resolves `{ ok:false, error:'blocked'|'redirect'|'type'|'size'|'timeout'|'status'|'robots' }` (Research Pattern 1). Robots fetch and cache per origin. Test matrix is in `01-RESEARCH.md` lines 635-643.

Keep the `resolvesPublic` "not airtight" comment: it is still the reason for the DNS-rebinding residual (Pitfall 9).

---

### `supabase/functions/_shared/net-guard.mjs` (utility, transform) — moved

**Analog:** `supabase/functions/plan-intake/logic.mjs` lines 11-31. Move `isSafeUrl` and `isPrivateIp` here, and re-export from `plan-intake/logic.mjs` so existing tests (`test/plan-intake-logic.test.js`) keep passing.

**`isSafeUrl` (lines 11-18)**:
```javascript
export function isSafeUrl(u) {
  let x; try { x = new URL(String(u)); } catch { return false; }
  if (x.protocol !== 'https:' || x.username || x.password) return false;
  if (x.port && x.port !== '443') return false;
  const h = x.hostname;
  if (!h || h.startsWith('[') || /^[\d.]+$/.test(h) || PRIVATE_HOST.test(h) || !h.includes('.')) return false;
  return true;
}
```

**`isPrivateIp` (lines 21-31)**: IPv4 dotted only, plus `::1`, `::`, `fc/fd`, `fe8-b`. Gaps to fix (Research Pitfall 10): hex IPv4-mapped (`::ffff:a00:1`), NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, `ff00::/8`, `fec0::/10`, and the IPv4 ranges `192.0.0.0/24`, `192.0.2.0/24`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`.

Apply: keep the function names and the `export` form (`plan-intake-logic.test.js` loads them via dynamic `import()`).

---

### `supabase/functions/_shared/app-errors.mjs` (utility, transform) — new

**Analog:** `plan-intake/logic.mjs` lines 1-4 (exported constants, pure module, no Deno APIs):
```javascript
export const MAX_TEXT = 60000;
export const MAX_ITEMS = 60;
```

Apply: `normaliseError(source, err)` returning only D-03 columns; `scrub()` for `sk-…` and `eyJ…` token shapes; `truncate()` to the column caps. Pure, so it is Node-testable.

---

### `supabase/functions/_shared/dns.ts` (utility, Deno-only)

**Analog:** `plan-intake/index.ts` lines 13-19 (`resolvesPublic`, Deno.resolveDns). Only this file calls Deno APIs; everything else stays in `.mjs`. Research open question 1: `Deno.resolveDns` vs `node:dns` is unverified; keep it behind one function so the choice is one line.

---

### `supabase/functions/plan-intake/index.ts` (controller, batch)

**Analog:** itself.

**Imports and CORS (lines 4-8)**: as shown in the `cors.mjs` section. Replace the constant with the `corsDecision` output.

**Auth flow (lines 59-68)** (keep, but move the 403 for origin before it):
```typescript
    const secret = req.headers.get('x-cron-secret');
    if (!(secret && await safeEqual(secret, cron))) {                    // otherwise must be an admin's JWT
      const userClient = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
      const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const { data: u } = await userClient.auth.getUser(jwt);
      if (!u?.user) return json(401, { error: 'auth' });
      const { data: p } = await admin.from('profiles').select('role').eq('user_id', u.user.id).maybeSingle();
      if (p?.role !== 'admin') return json(403, { error: 'admin only' });
    }
```

**Per-source loop, per-car select (lines 79-81)**:
```typescript
      const { data: srcs } = await admin.from('schedule_sources').select('*').eq('car_model_id', car.id);
      for (const s of srcs ?? []) {
        try {
          const doc = await fetchSource(s.url);
```

**Per-source select inside the source loop (line 101) and per-item delete + insert (lines 102-111)** — the N+1 for FND-10:
```typescript
          const { data: live } = await admin.from('dealer_plan_items').select('service,interval_km,interval_months,note,parts').eq('car_model_id', car.id);
          for (const it of items) {
            const cur = (live ?? []).find((x: any) => x.service.toLowerCase() === it.service.toLowerCase());
            const proposed = { interval_km: it.interval_km, interval_months: it.interval_months, note: it.note, parts: it.parts };
            if (!diffDraft(cur, proposed)) continue;
            await admin.from('plan_drafts').delete().eq('car_model_id', car.id).eq('service', cur?.service ?? it.service).eq('status', 'pending');
            const { error } = await admin.from('plan_drafts').insert({
              car_model_id: car.id, source_id: s.id, service: cur?.service ?? it.service, proposed,
              reason: cur ? 'Source differs from the live schedule' : 'New service found in the source',
            });
            if (!error) drafts++;
          }
```

**Recall N+1 (lines 127-131)**:
```typescript
        for (const f of merged.values()) {
          const { data: ex } = await admin.from('recalls').select('campaign').eq('campaign', f.campaign).eq('car_model_id', car.id).maybeSingle();
          if (ex) continue;                                // never reset an approved/rejected status
          const { error } = await admin.from('recalls').insert({ ...f, car_model_id: car.id });
          if (!error) recalls++;
        }
```

**Silent catches (lines 114 and 136)**:
```typescript
        } catch { skipped++; }
...
  } catch { return json(500, { error: 'server' }); }
```

Apply (FND-10):
- Hoist `live` to one select per car, before the source loop (Pitfall 19). Refresh only after a source writes drafts.
- Replace the per-item `delete` with one `.in('service', [...])` delete for pending drafts, then one bulk `insert([...])` (Research layout). Do not use `upsert(..., onConflict)` on `plan_drafts` (partial unique index, Research anti-patterns).
- Recalls: one `upsert(rows, { onConflict: 'campaign,car_model_id', ignoreDuplicates: true })` for the whole merged set (Research Pitfall 20). Assert `ignoreDuplicates` in the fake-client test.
- Lines 114 and 136: log to `app_errors` with `source: 'plan-intake'` (D-05), using the service-role client (`admin`). Do not log the source body or the Anthropic response.
- Replace line 7 CORS with `corsDecision`; delete `Access-Control-Allow-Origin: '*'`.
- Replace `fetchSource`/`resolvesPublic` (lines 13-48) with the `safeFetch` import.

---

### `supabase/functions/read-bill/index.ts` (controller, request-response)

**Analog:** itself. Lines 7-18 (CORS, json helper, OPTIONS). Apply the same `corsDecision` change. The rest of the file was not read in this pass; check it for an outer catch and add the `app_errors` write (D-05) there too.

---

### `supabase/functions/plan-intake/logic.mjs` (utility)

**Analog:** itself. Keep exports; move `isSafeUrl` and `isPrivateIp` (lines 11-31) to `_shared/net-guard.mjs` and re-export. Existing test `test/plan-intake-logic.test.js` loads this file with `import()` and checks `isSafeUrl` cases. Those cases must still pass after the move.

---

### Edge tests (`test/edge-cors.test.js`, `test/edge-safe-fetch.test.js`, `test/edge-plan-intake-batching.test.js`) — new

**Analog:** `test/plan-intake-logic.test.js` lines 1-6:
```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const url = require('url');
const load = () => import(url.pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'plan-intake', 'logic.mjs')).href);

test('isSafeUrl accepts plain https and refuses everything risky', async () => {
  const { isSafeUrl } = await load();
```

Apply: same `load()` helper, pointing at `_shared/*.mjs`. `edge-plan-intake-batching` uses a fake admin client that counts `from()` calls. Assert the call count does not grow with item count (FND-10). `edge-cors` must also grep both `index.ts` files for `'*'`.

---

### `test/error-log.test.js` (new)

**Analog:** `test/plan-intake-logic.test.js` for the loader, and the dual-mode `require` in `src/data/bills.js`. Cover: session cap, dedupe by message, offline drop (`navigator.onLine === false`), never rejects, no `.select()` on the insert call.

---

### `.github/workflows/test.yml` (CI config)

**Analog:** itself (lines 9-30).

```yaml
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm test
      - run: find . -name '*.js' -not -path './node_modules/*' -not -path './test/*' -print0 | xargs -0 -n1 node --check
```

Apply: the `find` only covers `*.js`; extend to `*.mjs` (Pitfall 17). Add a new `rls` job (Research: `supabase/setup-cli@v1`, `supabase start`, then `psql -v ON_ERROR_STOP=1 -f` per file in `supabase/tests/*.sql`). Pin the CLI version (A10). Model the new job on the existing `browser` job (lines 22-30) for structure: checkout, setup-node 22, `npm ci`, then the job step.

---

### `package.json` (config)

**Analog:** itself.

```json
  "scripts": {
    "test": "node --test \"test/**/*.test.js\"",
    "test:e2e": "playwright test"
  },
```

Apply: add `"sw:version": "node tools/sw-version.js"` and `"sw:check"` if a separate check mode is wanted. Do not add dependencies (Research: "no new packages").

---

### `index.html` (config, script order)

**Analog:** none excerpted in this pass. Rule from CLAUDE.md: new browser scripts go in `index.html` in dependency order, before `main.js`. `src/data/car-photos.js` must load before `src/pages/dashboard.js`; `src/data/error-log.js` must load before `src/data/session.js` uses it (dual-mode globals).

---

### `AGENTS.md` (config, docs) — FND-11

**Analog:** itself. The file is 33 lines. Keep lines 31-33 verbatim (the car-asset section). Remove the Domain and Response Protocol sections (lines 1-30), which are unrelated to the car-asset workflow. The section to keep:

```markdown
## Persistent car asset editing memory

Before auditing, editing, recoloring or replacing any car image, read [docs/CAR-ASSET-GUIDE.md](docs/CAR-ASSET-GUIDE.md) and [output/CAR-ASSET-LESSONS.md](output/CAR-ASSET-LESSONS.md). ... Do not reapply rejected Mazda2 softening 175 or Mazda3 chrome-notch 196.
```

Apply: keep the heading and paragraph exactly. Any header that the trimmed file still needs for the car-asset section stays as the first line.

---

## Shared Patterns

### Dual-mode module (every new `src/data/*.js`)
**Source:** `src/data/bills.js` lines 1-15; `src/data/admin.js` lines 10-14
**Apply to:** `src/data/error-log.js`, `src/data/car-photos.js`
```javascript
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else root.<name> = api;
})(typeof self !== 'undefined' ? self : globalThis, function () { ... });
```

### Never-reject service result
**Source:** `src/data/bills.js` lines 20-26; CONTEXT Established Patterns
**Apply to:** `error-log.js` `report()`, `admin.js` `listErrors()`, `resolveGroup()`, `safe-fetch.mjs` `safeFetch()`
Resolve `{ ok:false, error:'...' }` with a short code. Never reject. Map unknown failures to `'failed'`.

### HTML escaping
**Source:** `src/ui/chrome.js` line 116 (`html` tagged template with `t(msg)` interpolation); `src/pages/admin.js` lines 15, 22 (`html` for markup, `textContent` for text)
**Apply to:** Errors tab (messages and stacks are untrusted), Retry toast, any new page markup
Every HTML string uses `html`; untrusted text is interpolated, never passed to `raw()`. Enforced by `test/no-raw-templates.test.js`.

### Strings
**Source:** `src/ui/chrome.js` line 116 (`toast()` calls `t()`); `src/i18n/strings.ar.js` lines 350-351
**Apply to:** every new user-facing message (toast, Errors tab labels, Retry button)
Pass the English source string to `t()`. Add the Arabic value to `strings.ar.js`. Do not pre-translate.

### Edge function CORS and auth order
**Source:** `plan-intake/index.ts` lines 52, 59-68; `read-bill/index.ts` lines 18-24
**Apply to:** both functions and any future autopilot function
Order: OPTIONS, then origin decision (403 on foreign or `null` Origin, pass-through when no Origin), then cron secret or JWT. Auth stays the real control (D-16, Pitfall 7).

### Edge logic in `.mjs`, handler in `index.ts`
**Source:** `plan-intake/logic.mjs` + `index.ts`; `read-bill/logic.mjs` + `index.ts`
**Apply to:** `_shared/cors.mjs`, `_shared/safe-fetch.mjs`, `_shared/app-errors.mjs`
Pure logic in `.mjs` with no Deno APIs. Deno-only calls (`Deno.resolveDns`, `Deno.env`) stay in `index.ts` or `_shared/dns.ts`.

### RLS on every new table
**Source:** `supabase/schema.sql` `bill_reads` (549-550), `shops` (323-332), `is_admin()` (615-619)
**Apply to:** `app_errors`
`enable row level security`, then `revoke all ... from anon, authenticated`, then column-level grants, then `is_admin()` policies. Enforced by `test/rls-coverage.test.js` (new).

### Node tests load edge logic by dynamic import
**Source:** `test/plan-intake-logic.test.js` lines 1-6
**Apply to:** all new `test/edge-*.test.js`
```javascript
const load = () => import(url.pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'plan-intake', 'logic.mjs')).href);
```

### Comments explain the WHY
**Source:** `src/ui/chrome.js` lines 107-109, 117-123; `supabase/functions/plan-intake/index.ts` lines 11-12
**Apply to:** every new policy decision (CORS 403, LRU order, precache tolerance, safeFetch hop limit). Single-quote, two-space, semicolons, `'use strict';` at top of browser and Node files.

---

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/pages/admin.js` Errors tab (tab component) | component | CRUD | No tab UI exists. Use the `adminQueue` card as layout base; the tab switcher is new (D-06). |
| SW tolerant precache + `PRECACHE_REPORT` relay | middleware | event-driven | Current install uses atomic `cache.addAll`. Use Research Pattern 2. |
| SW photo LRU and module SWR caches | middleware | request-response | Current fetch handler is network-first only. Use Research Pitfalls 21-23. |
| `safeFetch` hop loop, robots.txt parser | service | request-response | Current code has one manual redirect and no robots handling. Use Research test matrix. |
| `tools/sw-version.js` content hash | utility | batch | No existing hash tool. Use `crypto.createHash` (Node). |
| `test/rls-coverage.test.js` static check | test | batch | No existing static schema test. Pattern is `precache.test.js` file reads. |
| pg_cron retention job | migration | batch | No existing cron job found in the files read. Use Research code example (guarded by `pg_available_extensions`). |
| `supabase/functions/_shared/dns.ts` | utility | request-response | Only `Deno.resolveDns` in `plan-intake/index.ts`. Runtime behaviour is unverified (Research A1). |

## Metadata

**Analog search scope:** `src/data/`, `src/ui/`, `src/pages/`, `src/i18n/`, `main.js`, `sw.js`, `test/`, `supabase/functions/`, `supabase/schema.sql`, `supabase/tests/`, `vendor/`, `.github/workflows/`, `package.json`, `AGENTS.md`
**Files scanned (read or grepped):** 26
**Pattern extraction date:** 2026-11-05
