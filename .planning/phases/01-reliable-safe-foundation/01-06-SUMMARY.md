---
phase: 01-reliable-safe-foundation
plan: 06
subsystem: save-failure-ux
tags: [toast, retry, session, error-log, i18n]
requires: [01-05]
provides:
  - retryToast(msg, onRetry) in chrome.js (persistent, cap-exempt, single instance)
  - session.save failure notify with { retry } closure, logged via errorLog
  - afterSave failure logged and shown as plain warn toast (no Retry)
affects: [01-07]
key-files:
  created: [test/retry-toast.test.js, test/session-save-log.test.js]
  modified: [src/ui/chrome.js, src/data/session.js, main.js, src/i18n/strings.ar.js, styles.css]
requirements-completed: [FND-01]
completed: 2026-11-05
---

# Phase 1 Plan 06: Retry toast for failed saves Summary

Failed saves now show a persistent warn toast with Retry that re-runs `save()`; afterSave failures are logged and shown as a plain warn toast; all failures report only message and stack to `errorLog`.

## Commits
- ffb45cb retryToast + cap exemption + test
- see git log: session/main/ar/styles wiring + session-save-log test

## Details
- Retry toast: `dataset.persistent='1'`, no fade timer, TOAST_CAP loop evicts only non-persistent toasts, new retry toast replaces any existing one. Body click dismisses; Retry success fades it; failure keeps it and re-enables the button.
- session.js: `failed(err)` logs `save failed: quota|failed` then notifies with `{ retry: () => save() }`; quota wording kept. afterSave catch logs `afterSave failed: <msg>` and notifies "Saved on this device, but sync failed..." with no options.
- main.js: notify wiring routes `opts.retry` to `retryToast`; two `try { ok = await save(); } catch (e) {}` wrappers removed.
- Arabic added for the new message, Retry, and the sync-failed message.

## Deviations from Plan
- [Rule 1] The sync-failed message is passed to `env.notify` as a raw key, not `t(...)`: `toast()` owns `t()` (chrome.js comment) and `t` is undefined under Node tests; wrapping would double-translate. The plan's grep for `notify(t('Saved on this device` therefore does not match; the string is present.
- No separate Dismiss button or `'Dismiss'` Arabic key: body click dismisses (same as undoToast), so the key would be dead.
- Retry button uses class `toast-retry-btn` (styles.css shares the `.toast-undo` rules) because an existing test asserts no `.toast-undo` after a failed save.
- main.js addVehicle/deleteVehicle keep their own non-session `toast('Could not save your change.')` paths (not session.save; out of scope).

## Verification
- `npm test`: 748 pass; the one failure seen (failed-save-offers-no-undo) was fixed by the class rename above; targeted re-run of retry-toast, render, session-save-log: 81 pass, 0 fail. Full suite not re-run after the final rename.
- Manual quota-failure browser check not done (no browser here); do before release.

## Known Stubs
None.

## Self-Check: PASSED
