# Phase 1 — UI Review

**Audited:** 2026-11-11
**Baseline:** Abstract 6-pillar standards (no UI-SPEC.md for this phase). Phase decisions D-06..D-11, D-17..D-20 from 01-CONTEXT.md used as the functional contract.
**Screenshots:** Not captured. No dev server on localhost 3000, 5173, 8080 or 4173. Code-only audit. Browser runs were also never executed per 01-VERIFICATION.md, so every finding below is from source, not rendered output.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Plain-words save copy and AR keys present for every key checked; Resolve-failure reuses generic copy, punctuation inconsistent, quota toast offers a Retry that cannot succeed |
| 2. Visuals | 2/4 | D-06 asked for a count badge; Errors tab shows a text "(N)" suffix, not a badge. Retry toast steals focus on show |
| 3. Color | 3/4 | Toasts reuse existing `.dot-warn` and `--accent-soft` tokens. No new hardcoded colors found in the audited surfaces. Full color scan not run |
| 4. Typography | 3/4 | Toast 13px/600, admin meta muted, stacks in `<pre class="pre-wrap">` with no RTL direction override |
| 5. Spacing | 3/4 | Toast and error cards reuse `.pad-16`, `.admin-item` spacing. Stack `<pre>` has no max-height or overflow guard |
| 6. Experience Design | 3/4 | Retry persists until success or dismiss, uncaught errors stay silent, stacks collapsed. Gaps: Resolve failure stacks messages, no loading state for Errors tab, no undo or confirm on Resolve |

**Overall: 17/24**

---

## Top 3 Priority Fixes

1. **Errors tab badge is not a badge, and proposals badge lies on load failure** — D-06 asks for a count badge; `adminTabs` renders `t(label) + ' (' + badge + ')'` as plain text (`src/pages/admin.js:115`). The Proposals badge is `props.ok ? props.rows.length : 0` (`admin.js:86`), so a failed fetch reads as "Proposals (0)", a false all-clear for the owner. Fix: render the count in a `<span class="pill warn">` (or similar) on the tab, and show "?" or an error state when `props.ok` is false.

2. **Retry toast steals focus and Retry is offered for errors it cannot fix** — `retryToast` calls `btn.focus()` on every failed save (`src/ui/chrome.js:177`), moving keyboard focus out of the open form the user is still editing. `failed()` in `src/data/session.js:197-200` always passes `{ retry: () => save() }`, so the quota case ("Storage is full ... Remove some receipt photos") shows a Retry button that will fail again. Fix: drop the `btn.focus()` call (or only focus when the user is not in a field), and pass no `retry` option on the quota branch so the copy and the control agree.

3. **Stack traces render inside RTL pages without a direction override** — `admin.js:139-141` puts raw stacks into `<pre class="pre-wrap">`. In `[dir="rtl"]`, stack lines (paths, `at` lines, punctuation) get bidi-reordered and right-aligned, and long lines wrap without a bound. The codebase already has the precedent `[dir="rtl"] .rpt-paper { direction: ltr; }` (`styles.css:1080`). Fix: add `.admin-item pre { direction: ltr; text-align: left; max-height: 240px; overflow: auto; }` next to `.pre-wrap`.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

Positives:
- Save failure copy matches D-08 exactly: "Couldn't save. Your changes are still on screen." with AR at `src/i18n/strings.ar.js:375`.
- Warn-after-sync copy "Saved on this device, but sync failed. Your changes are still on screen." has AR at `strings.ar.js:377`.
- Errors tab keys all have AR entries: Errors, Count, First seen, Last seen, Source, Resolve, Resolved, Show stacks, Hide stacks, No errors logged, Could not load errors (`strings.ar.js:540-542`).
- Retry label has AR (`strings.ar.js:376`). Storage-full copy has AR (`strings.ar.js:373`).
- `toast()` runs `t()` on every message (`chrome.js:109-115`), so English admin toasts translate when a key exists.

Findings:
- `src/pages/admin.js:148` — Resolve failure appends the generic "Could not save" line. It is not wrong, but it does not say what to do next, and the paragraph is appended again on every failed click (no clearing). Fix: replace the paragraph text in place, and use the D-08 copy.
- `src/pages/admin.js:127` vs `:128` — "Could not load errors." has a period and "No errors logged" does not. Fix: make both end with a period, or neither.
- `src/pages/admin.js:314` toast "Could not save. Check your connection." has AR at `strings.ar.js` (`تعذّر الحفظ. تحقّق من الاتصال.`). Covered. Noted only because the grep for "Check your connection" alone reported 0; the full key is present.
- `src/data/session.js:197-200` quota branch: English copy says "Remove some receipt photos" but the Retry button sits beside it. See Top Fix 2.
- Not checked: every `t()` key in the admin file outside the Errors surfaces. Coverage claim is limited to the keys named above.

### Pillar 2: Visuals (2/4)

- D-06 requires "a separate Errors tab with a count badge." Delivered as `Errors (3)` text in the button label (`admin.js:115`). Visually it is indistinguishable from the label, so the owner gets no attention signal. Score cap applies.
- Tab buttons set `role="tab"` but the container has no `aria-controls`, no roving tabindex, and no arrow-key handling (`admin.js:105-118`). Keyboard users get a tablist that does not behave like one.
- Resolved groups differ from open groups only by a trailing muted "Resolved" line (`admin.js:152`). No strike-through, no grouping, no visual weight shift. Owner scanning a long list cannot tell open from closed at a glance.
- Retry toast auto-focus (`chrome.js:177`) moves the visual focus ring to the toast button on every failure. See Top Fix 2.
- Tab bar: `.admin-tabs .btn` uses `white-space: nowrap; text-overflow: ellipsis` (`styles.css:1129`) across three tabs with an AR label and a count. At 375px the Arabic label plus "(N)" is likely to truncate. Not verified in a render.

### Pillar 3: Color (3/4)

- Toast severity uses existing tokens: `.toast .dot.dot-warn { background: var(--warn) }` (`styles.css:1283`). No new hardcoded hex introduced in the audited surfaces.
- Retry button uses `color: var(--accent-soft)` and `border: var(--stroke)` (`styles.css:668-672`). Accent is used on a control, which is correct.
- Not verified: 60/30/10 split for the admin page as a whole, and a full grep for hardcoded colors across `src/pages/admin.js`. Score is capped at 3 because the color pass was partial.

### Pillar 4: Typography (3/4)

- Toast: 13px, weight 600 (`styles.css:657-663`). Retry button 12px, weight 700. Reasonable for a notification. Two weights total on this surface.
- Errors tab: group title is an `h4` (default size), meta is `p.muted`, stacks are `pre.pre-wrap`. Hierarchy exists but is thin.
- Stacks have no font-size or font-family override in the audited code. Monospace default is fine, but see Top Fix 3 for the RTL direction problem.
- Dates use `toLocaleString()` with no locale argument (`admin.js:133-134`). In an AR session this follows the device locale, not the app `lang`. Minor inconsistency with the rest of the UI.

### Pillar 5: Spacing (3/4)

- Error cards reuse `.card.pad-16` and `.admin-item` with `margin-top: 16px; padding-top: 16px` (`styles.css:1099`, `:1141`). Matches the review-queue list spacing.
- Toast padding `12px 16px`, gap `8px` (`styles.css:657-663`). On the scale.
- `pre.pre-wrap` stacks have no `max-height`. A long stack expands the card unboundedly. See Top Fix 3.
- Admin tab bar uses `gap: 4px; padding: 4px` (`styles.css:1128`). Tight but consistent with existing admin tabs.

### Pillar 6: Experience Design (3/4)

Strong points, verified in code:
- Failed save toast is persistent (`data-persistent`, exempt from `TOAST_CAP`, no timer) and re-runs the same save (`chrome.js:166-190`, `session.js:195-201`). Matches D-09.
- Retry button disables while in flight and re-enables on failure (`chrome.js:179-186`).
- Uncaught errors go to `errorLog` only, with no toast or console (`main.js:632-642`). Matches D-10.
- Offline/sync-fail paths are not logged as noise: only save failures and afterSave throws report (`session.js:163-176`, `:194-197`).
- Post-save bookkeeping throws are isolated from the failed-save path, so a landed save never offers Retry (`session.js:165-169`).
- Error text is set via `textContent` only (`admin.js:124, 131`), so stored messages cannot inject markup.

Gaps:
- Errors tab shows the shared "Loading…" text while the whole admin body loads. No separate loading state. Acceptable, but the Errors count is fetched in the same `Promise.all` as nine other lists (`admin.js:37`), so one slow query blanks the Errors tab too.
- Resolve has no confirm and no undo. A single click removes a group from the open list. Low risk for an owner tool, but D-07 says "mark resolved" and no reversal exists.
- Resolve failure accumulates duplicate messages (see Pillar 1).
- Retry on a quota failure (see Top Fix 2).
- No user feedback on successful Resolve beyond the group switching state. Acceptable.
- Not verified: whether the Retry toast survives route changes (`go()`) or a sign-out. Code path not traced.

---

## Scope Notes

- SW behaviour (D-17, D-18, D-20) produces no UI by design. No "update available" UI, consistent with D-17. Relay of the precache report goes to the error log, not a toast (`main.js:650-660`). No UI finding.
- Car-photo cache busting (FND-09) has no UI surface change in scope.
- Browser-only behaviours are unverified: the retry toast in a real Chromium, RTL rendering of the Errors tab, tab truncation at 375px, and focus behaviour. These should be checked in a browser before the phase is closed.

---

## Files Audited

- `src/ui/chrome.js` (toast, toastNode, retryToast, commit)
- `src/data/session.js` (save, failed, report, afterSave path)
- `src/pages/admin.js` (adminTabs, adminErrors, admin load and toast calls)
- `main.js` (global error and unhandledrejection handlers, relayPrecacheReport)
- `sw.js` (PHOTO_MAX, precache report, no skipWaiting or clients.claim)
- `styles.css` (toast, toast-action, toast-retry-btn, admin-tabs, admin-item, pre-wrap, RTL overrides)
- `src/i18n/strings.ar.js` (save, retry, Errors tab, admin toast keys)
- `.planning/phases/01-reliable-safe-foundation/01-CONTEXT.md`, `01-VERIFICATION.md`

Not read in full: the 11 SUMMARY and 11 PLAN files. Findings rely on the source and the VERIFICATION report, which already records the browser checks as unrun.
