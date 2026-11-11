# Phase 3 — UI Review

**Audited:** 2026-11-06
**Baseline:** Abstract 6-pillar standards (no UI-SPEC.md present). CLAUDE.md conventions used as the contract for escaping, i18n and RTL.
**Scope:** Advanced (admin) tab only: `src/pages/admin.js`, `src/pages/admin-autopilot.js`, `src/pages/admin-proposals.js`, `src/data/admin.js`, admin-scoped rules in `styles.css` (lines ~1099–1226).
**Screenshots:** not captured. Dev server not running on 3000/5173/8080; static server on 4173 serves the app, but the Advanced tab is admin-gated and no signed-in admin session is available, so a capture would show only the sign-in gate. Code-only audit.

Already fixed and not re-reported: two-column layout (`styles.css:1208-1212`), car groups by model (`admin.js:244-255`), proposal panel and RTL change line in proposals (`admin-proposals.js:55-75`, `:94`), banner beside Refresh.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Internal enums (`monthly`, `failed`, `schedule_item`) shown raw; one generic error string covers unrelated failures |
| 2. Visuals | 3/4 | Autopilot card title is 15px/700 while sibling card titles are 17px/600 |
| 3. Color | 3/4 | Error text in `.ap-error` uses the accent token, not danger; primary accent repeats on every proposal row |
| 4. Typography | 2/4 | Six font sizes (11/12/13/15/17/30px) and three weights (600/700/800) in admin scope; no type tokens in `styles.css` |
| 5. Spacing | 3/4 | Card padding 20px vs `.pad-16` 16px; duplicated admin-item margin rules; no spacing tokens |
| 6. Experience Design | 3/4 | `.save-error` has no CSS rule, so failure messages look like helper text; autopilot action buttons under 44px |

**Overall: 17/24**

No pillar scored 1, and no defect found breaks task completion. The WARNING items below are the ones to fix.

---

## Top 3 Priority Fixes

1. **Failure messages are not styled as failures.** `.save-error` appears in 7 JS call sites (e.g. `admin-proposals.js:153`, `:211`, `:260`) but has no rule in `styles.css`, so "Could not save. Check your connection." renders as plain muted grey. Impact: an owner who clicks Approve, Reject or Revert and gets a failure sees text that looks like a hint. Fix: add one rule, `.save-error { color: var(--danger); font-size: 13px; margin: 8px 0 0; }`.

2. **Raw internal enums and generic errors reach the owner.** `admin-autopilot.js:53` prints `${run.kind} · ${run.status}` untranslated (e.g. "monthly · failed"), and `:62` prints the proposal kind key (`schedule_item`) untranslated. In Arabic this is English jargon inside an Arabic card. Separately, `admin-autopilot.js:84`, `:105`, `:200` and `admin-proposals.js:154`, `:212` all show "Could not save. Check your connection." even when the cause is a stale value, a banned domain or a server refusal. Fix: map run kind and status through `t()` with labels (`monthly` → "Monthly", `failed` → "Failed"), and map `schedule_item` → `t('Schedule item')` (already used at `admin-proposals.js:95`). Give the kill switch and domain actions their own failure strings.

3. **Autopilot card controls are small and its headings do not match the page.** `.btn` has no `min-height` (`styles.css:443`); the 44px rule at `styles.css:1222` applies only inside `.proposal-row`. So Turn on/off, Preview, Confirm run, and the domain Approve/Ban buttons in `.ap-row` (`admin-autopilot.js:102`, `:108`) are about 40px tall. Also `.ap-head h3` (`styles.css:1145`, 15px/700) overrides `.admin-view h3` (`styles.css:1136`, 17px/600), so "Monthly autopilot" and "Review queue" sit at different sizes and weights on the same page. Fix: add `.admin-view .btn { min-height: 44px }`, and drop the `.ap-head h3` override so every card title uses one rule.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

- **WARNING, untranslated enums in last-run report.** `admin-autopilot.js:53` writes `run.kind` and `run.status` as raw strings. `admin-autopilot.js:62` writes the proposal kind key as the line label. Arabic strings exist for "new" and "unchanged" (`strings.ar.js:540`), so the labels are partly translated and partly not.
- **WARNING, generic error copy.** One string, "Could not save. Check your connection.", is used for: kill switch (`admin-autopilot.js:200`), domain ban (`:84`), domain approve (`:105`), proposal approve (`admin-proposals.js:154`), proposal reject (`:212`). Only revert distinguishes `drifted` (`admin-proposals.js:261`). A non-network failure is reported as a network problem.
- **WARNING, vague run-start failure.** `admin-autopilot.js:171` shows "Could not start the run." for every error except `limit`. A paused autopilot or an `unauthorized` session gets the same text. Verify what the edge function returns when the kill switch is off; the copy does not explain it either way.
- **Good:** empty states are specific ("No proposals waiting" with the approval-gate sentence, `admin-proposals.js:290-292`). The banner strings and the preview-costs-nothing hint have Arabic translations (`strings.ar.js:534-535`, `:538`).

### Pillar 2: Visuals (3/4)

- **WARNING, inconsistent card hierarchy.** `.ap-head h3` (`styles.css:1145`) is 15px/700. `.admin-view h3` (`styles.css:1136`) is 17px/600 and applies to "Review queue" (`admin.js:167`), "Recent approvals" (`admin-proposals.js:229`), and "No proposals waiting" (`admin-proposals.js:290`). The two columns therefore do not read as one system.
- **WARNING, RTL gap in the review queue.** The proposal panel builds its arrow per direction (`admin-proposals.js:78-79`, wrapped in `dir="ltr"` at `:69`, `:71`). The review queue draft line does not: `admin.js:190` uses a fixed `→` with no `dir`, so in Arabic the before/after values can reorder. The recent-approvals line (`admin-proposals.js:241`, `:249`) is correct. Fix by applying the same `dir="ltr"` span treatment at `admin.js:190`.
- **Good:** the Preview/Confirm block has a clear visual sequence: cost as the largest number (`styles.css:1196`), then the three supporting figures, then the confirm button.

### Pillar 3: Color (3/4)

- **WARNING, error text uses the accent token.** `.ap-error` (`styles.css:1203`) is `color: var(--accent-soft)`. The "Could not preview" and "Monthly cost cap reached" messages therefore use the accent palette, not `--danger`, which is what the card's own banner and `.pill.danger` use. Fix: `color: var(--danger)`.
- **WARNING, accent repeated per row.** Every proposal row renders its own `btn primary` Approve (`admin-proposals.js:159`). With 20 pending proposals, the list is about 20 accent gradient buttons. The Proposals tab reduces accent elsewhere (`styles.css:1129`), but not in the list. Consider keeping Approve primary only on the open row, or using a quieter style for the list view.
- **Good:** `.pill` status colours are semantic (ok / warn / danger, `styles.css:431-433`), and the spend meter changes colour at 60% and 90% (`admin-autopilot.js:213`).

### Pillar 4: Typography (2/4)

Distinct sizes in admin-scoped rules: **11px** (`.ap-stat span`, `.ap-est-label`), **12px** (`.ap-meter-label`, `fs-12`), **13px** (`.btn`, `.ap-row`, `.ap-section p`, `.admin-view .item-main h3`), **15px** (`.ap-head h3`, `.admin-car-group`, `.ap-est-value`), **17px** (`.admin-view h3`, `.ap-stat-value`), **30px** (`.ap-est-cost`). That is six sizes in one tab, against a four-size guideline.

Weights: **600** (most labels), **700** (`.ap-head h3`, `.ap-stat-value`, `.ap-est-value`), **800** (`.ap-est-cost`, `styles.css:1196`). Three weights on one tab.

- **WARNING, no type tokens.** `styles.css` has no `--fs-*` or weight variables, so every rule sets its own value. The `fs-12` utility is the only shared size class.
- **WARNING, h3 sizes conflict** (see Visuals). The same element role uses 13px, 15px and 17px across the tab.
- Suggested scale for this tab: 11 (captions), 13 (body and labels), 15 (card titles), 17 (page section, `.ap-stat-value` and `.ap-est-value`), 30 (the single hero cost). Weights: 600 for labels and titles, 700 for numbers only. Drop 800.

### Pillar 5: Spacing (3/4)

- **WARNING, card padding does not match.** `.ap-card` is 20px (`styles.css:1143`); other cards use `.pad-16` (16px). The autopilot card therefore sits visually heavier than the proposals card beside it in the two-column layout.
- **WARNING, duplicate rules.** `.admin-item + .admin-item` is declared at `styles.css:1099` and again at `:1140` with the same margin and padding, plus a redundant second `.ap-est-row` padding (`:1198`, `padding: 12px 0 12px`).
- **Minor:** `.admin-car-group { padding: 16px 16px 8px }` (`:1218`) is the only asymmetric card padding; the autopilot section gap is 20px (`:1150`). No spacing tokens exist; values are ad hoc but all sit on a 4px grid.
- **Good:** no inline style except the dynamic meter width (`admin-autopilot.js:216`), and that is legitimate.

### Pillar 6: Experience Design (3/4)

**Strengths:** every destructive path has a guard. Ban opens a confirm modal (`admin-autopilot.js:74-88`). Bulk approve opens a modal naming the count (`admin-proposals.js:339-355`). Check now is preview first, then an explicit Confirm run (`admin-autopilot.js:168`). Stale proposal values are caught and surfaced (`admin-proposals.js:137-147`). Async buttons are guarded against double submit (`src/core/async-click.js`). Errors use `role="alert"`. The banner is shown on every tab.

- **WARNING, failure text is invisible as failure.** See Top Fix 1. `.save-error` has no rule. Affected: proposal approve, reject, edit and revert failures, and bulk alerts.
- **WARNING, small action targets.** `.btn` has no min-height (`styles.css:443`). The 44px rule is scoped to `.proposal-row` (`:1222`) and `.dashboard-actions` (`:733`), so the autopilot card's buttons and the `.ap-row` Approve/Ban buttons fall below 44px. The kill switch, which the card calls "the one control that matters" (`admin-autopilot.js:194`), is one of them.
- **WARNING, banner suppressed on status failure.** `admin.js:77` shows the banner only when `status.ok`. If the status call fails, a failed or overdue run is not shown anywhere, and the card says only "Could not load." with no retry button (`admin-autopilot.js:192`). The top-level Refresh button is the only recovery. Show a neutral "Could not check autopilot status. Refresh." banner in that case.
- **Minor:** the summary inside each proposal row is `role="button"` and contains an `<h3>` (`admin-proposals.js:84-91`). Screen readers will announce the heading inside the button. Acceptable, but worth a look.
- **Minor, Approve button labels:** Approve/Edit/Reject have `aria-label`s (`admin-proposals.js:161-168`). The domain Approve button does not (`admin-autopilot.js:102`), while Ban does (`:109`). Make them consistent.
- **Not verified:** the Confirm run response when autopilot is paused. Needs a live call; see Files Audited.

---

## Registry Safety

Skipped. `components.json` is not present, so shadcn is not in use.

---

## Files Audited

- `src/pages/admin.js` (324 lines)
- `src/pages/admin-autopilot.js` (224 lines)
- `src/pages/admin-proposals.js` (386 lines)
- `src/data/admin.js` (`checkCar` at ~362, export list at ~390)
- `src/core/async-click.js`, `src/ui/modal.js` (`field()` at ~78, translates labels)
- `src/i18n/strings.ar.js` (admin keys around lines 534-548)
- `styles.css` (admin, autopilot and proposal rules at lines 425-440, 443-453, 1099-1226; `.btn` base at 443)
- `.planning/phases/03-monthly-autopilot-for-schedules-recalls/03-0*-SUMMARY.md`, `03-VERIFICATION.md`

Gitignore gate: `.planning/ui-reviews/.gitignore` created (screenshot extensions excluded).
