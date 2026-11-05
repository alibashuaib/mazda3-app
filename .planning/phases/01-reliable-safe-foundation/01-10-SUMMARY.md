---
phase: 01-reliable-safe-foundation
plan: 10
subsystem: admin
tags: [admin, errors, rls, i18n]
requires: [01-01, 01-05, 01-06]
provides: [admin Errors tab, catalogAdmin.listErrors/resolveGroup/groupErrors, adminTabs helper]
key-files:
  modified: [src/data/admin.js, src/pages/admin.js, src/i18n/strings.ar.js]
  created: [test/admin-errors-data.test.js, test/admin-errors-render.test.js, test/strings-ar-unique.test.js]
requirements: [FND-02]
metrics:
  completed: 2026-11-05
---

# Phase 1 Plan 10: Admin Errors tab Summary

#admin now has Review queue and Errors tabs; Errors lists app_errors grouped by message with count, first/last seen, source, up to 5 stacks, and a Resolve button; all text via textContent.

## Commits
- be90a36: data functions + pure groupErrors (+ tests)
- Task 2 commit: page tabs, Errors renderer, logger routing, Arabic strings, dedupe (see git log)

## What was done
- `groupErrors(rows)`: groups by DB `group_key` when present, else source + lowercased, digit-collapsed message. Open = never resolved, or a row newer than the newest resolve. Sorted by last seen desc.
- `listErrors()` selects the allowed columns, newest first, limit 500; `resolveGroup(key)` updates `resolved_at` by `group_key`. Both never reject.
- `adminTabs(tabs, active, onPick)` helper in src/pages/admin.js (Phases 2/3 extend the list). Badge = open group count. Errors fetched once per render; a load failure shows "Could not load errors." and the queue tab still works.
- All 5 console calls in src/pages/admin.js replaced by `adminReport` -> `errorLog.report` (typeof-guarded); `grep -c "console\."` = 0. `raw(` count in admin.js unchanged (0).
- strings.ar.js: 8 duplicate keys removed (kept last value, so rendered Arabic unchanged); new test/strings-ar-unique.test.js. 11 new Arabic keys added.

## Deviations
- Line numbers in the plan for duplicates were stale (01-06 edited the file); located by key scan instead.
- Reworded two comments that tripped the `raw(` and `console.` grep guards.

## Verification
- `npm test`: 777/777 pass (includes injection fixture `<img src=x onerror=...>` rendering as text).
- Not run here: SQL/RLS behaviour (no Docker/psql) and the manual admin check (resolve, badge drop, reappearance). RLS comes from plan 01-01 and is untested in this worktree.

## Known Stubs
None.

## Self-Check: PASSED
