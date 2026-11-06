---
status: complete
quick_id: 261106-qfy
branch: cleanup-dead-code
commits: [8f7c371, 6053674]
tests: "npm test 951/951; playwright 43 passed, 1 skipped"
---

# Quick 261106-qfy: Dead code removal

## Task 1 - CSS (commit 8f7c371, 26 lines removed, 0 added; plus sw.js CACHE)
- `.admin-view .admin-item + .admin-item` duplicate (1 line)
- Classes with 0 references in main.js/src/index.html/sw.js/e2e/test and no prefix concatenation: `.i-sun`/`.i-moon` (3 lines), `.car-card-grad`/`.car-card-cap` (6, plus RTL rule), `.cpb-ph`/`.cpb-emoji` (4, plus RTL rule 2 lines), `.hero-bg` (7), `.spacer` (1), `.plan-year` (2).
- Kept: `.dot-ok`/`.dot-warn` (built dynamically in src/ui/chrome.js toast).

## Task 2 - JS (no commit)
Scan of every top-level function/const/let in main.js, sw.js, src/** against the whole repo (main, src, test, e2e, index.html, supabase, tools): no symbol with <=1 occurrence; all count-2 symbols are used (verified manually). No commented-out code or unreachable code found. Nothing removed.

## Task 3 - Arabic i18n (commit 6053674, 11 lines removed, 6 re-lined)
13 keys removed, each with 0 occurrences (literal, escaped, or curly-apostrophe-normalised) outside strings.ar.js: OEM parts with cheaper alternatives..., Show later years, Tell the plan which major services..., Re-answer the setup questions..., No services in your list yet.\nAdd some under Schedule first., Change car photo, Add a photo of your car, These details personalise..., Change photo, Add photo, Odometer required, Could not restore backup..., Switch vehicles or add another.
Kept: part names/hints/data-like strings, short fragments (More, OF BUDGET, e.g. Jeddah, Hide stacks).

## Noted, not changed
`'Add fill-up '`, `'Add spending '`, `'Log a service '` (trailing space) in strings.ar.js never match `t('Add fill-up')` etc. Behavior-neutral to delete, but likely a pre-existing translation bug (missing Arabic for those buttons); left for owner.

## Results
- node --check on edited JS: pass. `npm run sw:version` before each test run.
- `npm test`: 951 pass, 0 fail (after each task). `npx playwright test`: 43 passed, 1 skipped.
- Nothing pushed.

## Follow-up (orchestrator)

- 49e59da: removed trailing-space duplicate keys `Add fill-up `, `Add spending `, `Log a service `. The unspaced keys (strings.ar.js line 74) are what t() looks up, so these were dead, not a translation bug. npm test 951/951.
