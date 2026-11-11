---
status: complete
task: 261111-7bx
---
# Quick 261111-7bx: Phase 1 UI review minor items

All four items done. `npm test`: 1062 pass, 0 fail (baseline 1057, +5 tests).

- (a) Error first/last seen use `errDate()`: `toLocaleString` with `AR_LOCALE` when `lang === 'ar'`, else `en`. (`fmtDate` is date-only, so not used.)
- (b) `catalogAdmin.reopenGroup` sets `resolved_at: null`. Schema check: column grant `update (resolved_at)` plus admin policy cover it; `app_errors_before_update` only rewrites non-null. No schema change. Resolved groups show a Reopen button; Arabic string added.
- (c) Tabs: `id`, `aria-controls="admin-panel"`, roving tabindex, Arrow/Home/End keyboard with refocus by id; panel container has `id="admin-panel"` and `role="tabpanel"`.
- (d) Admin fetch uses `Promise.allSettled`; a rejected source becomes `{ ok: false, error: 'failed' }`.

Tests added in `test/admin-errors-render.test.js`. `sw.js` cache bumped via `npm run sw:version`.
