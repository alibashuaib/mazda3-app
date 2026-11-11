---
quick: 261111-5dy
status: complete
---
# Quick 261111-5dy: Phase 1 UI review top 3

- Task 1 pass: admin tabs render `.tab-badge` span; load failure shows `!` (Proposals with title, Errors); 0 stays visible.
- Task 2 pass: retryToast no longer focuses Retry; quota save failure passes no `retry`.
- Task 3 pass: `.admin-item pre` is LTR, max-height 16rem, scrollable.

Files: src/pages/admin.js, src/ui/chrome.js, src/data/session.js, styles.css, sw.js (sw:version), test/admin-tab-badge.test.js (new), test/admin-errors-render.test.js, test/admin-proposals-render.test.js (assertions moved from `Errors (2)` text to `.tab-badge` + no-`(N)`).

Tests: `npm test` 1056 pass, 0 fail.
