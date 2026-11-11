# Phase 04 — UI Review (retroactive)

**Audited:** 2026-11-11
**Branch / HEAD:** check-now-full-width / dc75cb0
**Scope:** frontend changes from 04-05 (admin review queue per kind), 04-07 (app parts/prices overlay, indicative label, new models in picker), 04-09 (Known issues card, catalogue-in-progress note, engine on part contributions)
**Baseline:** Phase 02 `02-UI-SPEC.md` (admin Proposals tab contract, which 04-05 extends) plus project conventions in `CLAUDE.md` (html escaping, `t()` + `strings.ar.js`, RTL, offline-first). No Phase 04 UI-SPEC exists.
**Screenshots:** not captured. No dev server on ports 3000, 5173, 8080, 4173 and no Playwright MCP available. Code-only audit. Visual checks listed under "Needs human eyes".

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Phase 04 Arabic coverage is complete. Dashboard "catalogue in progress" copy says schedule AND parts are being checked even when only one is missing. |
| 2. Visuals | 2/4 | Known issues card has no CSS at all. The parts header "from" price is headlined from indicative options with no marker. |
| 3. Color | 3/4 | No hex in the Phase 04 admin, parts or known-issues code. Accent discipline holds. Indicative pill uses the `warn` token. Quote and stale-box styling drift from the 02 contract. |
| 4. Typography | 3/4 | Pill weight is 600 (contract 650). Diff "after" values are `<strong>` at default 700, breaking the two-weight rule. |
| 5. Spacing | 2/4 | Known issue items have no separation (no CSS). `.proposal-edit` and `.proposal-reject` forms have no layout rules. |
| 6. Experience Design | 3/4 | Stale, two-step reject, bulk confirm, error and empty states are all present. An owner-edited price keeps the "indicative" pill forever. Known issues are online-only. |

**Overall: 16/24**

**Blockers: 0.** No pillar scored 1, and no finding breaks a user task. Launch is not blocked by UI. Visual and i18n verification remains open, as 04-VERIFICATION.md already notes.

---

## Top 3 Priority Fixes

1. **Indicative price shown as a plain "from" price, and owner edits keep the indicative pill.** `src/pages/parts.js:186` headlines `partCheapest` (`parts.js:27`), which includes indicative options, with no marker. `parts.js:205` shows the pill from `o.indicative`, which `openEditPart` clones and never clears (`parts.js:258`). A price the owner typed is then labelled "indicative", and the server cannot clear it (`remote-catalog.js:161` returns early for owner values). Impact: the user reads a community median as a verified price. Fix: in `partCard`, ignore indicative options for the headline or mark the header. In `openEditPart`'s save, set `o.indicative = false` whenever the owner changes `price`.

2. **Known issues card is unstyled.** `known-issues.js` and `dashboard.js:303-325` use classes `card known-issues` and `known-issue`, and `styles.css` has zero rules for either (grep count 0). Items run together with no gap, and the source links rely on an inline `style.marginInlineEnd` (`dashboard.js:322`). Fix: add to `styles.css` near the proposals block, e.g. `.known-issue + .known-issue { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--stroke); }` and `.known-issue a { margin-inline-end: 8px; }`, then drop the inline style. Bump `sw.js` with `npm run sw:version`.

3. **Dashboard note copy is wrong when only one of the two is missing.** `dashboard.js:329-330` shows "Catalogue in progress: dealer schedule and parts for this car are still being checked." The condition is `!dealerPlan.length || !parts.length`, so a car with an approved schedule and no parts shows copy claiming the schedule is also pending. Fix: two strings (`Dealer schedule is still being checked` / `Parts are still being checked`), or a neutral "Catalogue in progress for this car" with no list. Add the Arabic entries to `strings.ar.js`.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

- Arabic coverage: every literal `t()` key and every label passed through `t(var)` in `admin-proposals.js` (KIND_LABELS, DIFF_LABELS, RECALL_LABELS, field labels, confidence text, bulk reasons), `parts.js`, `dashboard.js` and `known-issues.js` was checked against `src/i18n/strings.ar.js`. All Phase 04 strings are present, including `indicative` (`strings.ar.js:149`-area), `Known issues` (line 489), `Catalogue in progress…` (line 492) and the `{n} app users agree` line.
- Pre-existing gap, not introduced by Phase 04 but on the Parts page the overlay touches: `Search parts` (`parts.js:71`, used as placeholder and aria-label) and `No matching parts.` (`parts.js:93`) have no Arabic entry. In Arabic these fall back to English. Severity: WARNING.
- Copy inaccuracy: `dashboard.js:330` (see Top Fix 3).
- Good: the stale alert, bulk result and reject copy match the 02 UI-SPEC copy table word for word (`admin-proposals.js` lines 200-225 region).
- Minor: `Reported by owners online; check with your Mazda dealer` (`dashboard.js:309`) is accurate and appropriately hedged.

### Pillar 2: Visuals (2/4)

- Known issues card has no styling (see Top Fix 2). The card header, body and per-issue blocks are unstyled `div`s. Severity: WARNING.
- Parts header "from" price includes indicative options with no marker (`parts.js:186`). This is the same trust failure the indicative label was meant to prevent. Severity: WARNING.
- Good: the indicative pill in the parts option row (`parts.js:205`) and in the admin diff (`admin-proposals.js:105`) uses the `warn` semantic token and carries text, not color alone.
- Good: the admin row keeps the Approve button as the only filled button per row, per 02 UI-SPEC.
- The admin row `sum` is a `role="button"` wrapper around an `h3` (`admin-proposals.js` around 165-175). Heading semantics are lost inside the button. Severity: INFO.

### Pillar 3: Color (3/4)

- Hex audit: `admin-proposals.js` 0, `parts.js` 0, `known-issues.js` 0. `dashboard.js:277-278` has gauge gradient hex, which predates Phase 04 and is outside this scope.
- Accent discipline: Approve is the filled primary in each row and in the bulk button. Reject is `btn ghost reject`, which matches the 02 contract (`styles.css:1243`). Pass.
- Drift from the 02 contract: the quote block is a full 1px box on `--surface-2` (`styles.css:1110`), not the `border-inline-start: 3px solid var(--stroke-strong)` the UI-SPEC specifies. Severity: INFO.
- Stale alert keeps `.proposal-alert` warn styling, as specified (the `.save-error` class is kept for clearing). Pass.

### Pillar 4: Typography (3/4)

- Pill weight: `styles.css:1242` sets `.proposal-row .pill { font-weight: 600 }`. The 02 UI-SPEC sets 650 and says "exactly two weights, 400 and 650". Severity: WARNING (contract drift, not user-breaking).
- Diff "after" values use `el('strong')` (`admin-proposals.js:~121`), which renders at the browser default 700. There is no `strong` rule in `styles.css` that sets 650. Severity: INFO.
- Known issues: the title is a plain `div` with no `dir="auto"` (`dashboard.js:311`). Admin rows set `dir="auto"` on untranslated titles. Scraped English titles inside an RTL page may reorder punctuation. Severity: INFO.
- Sizes: Phase 04 adds `fs-11` and `fs-12` utility use. Both exist in `styles.css`. Pass.

### Pillar 5: Spacing (2/4)

- Known issues items have no vertical separation between `.known-issue` blocks (no CSS, see Top Fix 2). Severity: WARNING.
- Edit and reject forms (`admin-proposals.js:233` `.proposal-edit`, `:289` `.proposal-reject`) have no CSS. Their children (inputs, textarea, Approve and Cancel buttons) are appended directly into a block container. The 02 UI-SPEC specifies a `.field-row`-style action row (contract item 7). Buttons flow inline and wrap unevenly on narrow widths. Not verified visually. Severity: WARNING.
- `.proposal-panel` uses `gap: 16px` and `padding-top: 16px`, both on the spacing scale. Pass.
- `dashboard.js:322` sets `a.style.marginInlineEnd = '8px'` in JS. Value is on-scale, but the project previously moved inline styles into CSS (see the "Inline-style replacements" block in `styles.css`). Use a class. Severity: INFO.

### Pillar 6: Experience Design (3/4)

Pass items:
- Stale refusal keeps the row pending and prefills Edit from live (`admin-proposals.js` `stale` and `settle`). Matches the 02 contract.
- Two-step inline reject with 300-char cap and optional reason (`admin-proposals.js:289-310`).
- Bulk approve goes through a count-bearing modal (`bulkAsk`). Failure lines are listed (`admin-proposals.js` around 410-450).
- Empty, error and filtered-empty states exist for the queue. Load error has a Try again button.
- Known issues: `forCar` resolves `[]` on error, the card stays hidden, and no failed state leaks (`known-issues.js:20-36`). Good.
- Parts overlay respects owner prices (`remote-catalog.js:161`), and `applyParts` is only saved when changed (`main.js:728-736`). Good.
- Edge input: `numF` drops negative and non-finite prices to `null` (`admin-proposals.js` near line 210). Approving a part with a null price is allowed. Severity: INFO.

Findings:
- Owner-edited price keeps the indicative pill. `parts.js:258` clones `indicative` and `catPrice` through the edit, and `parts.js:205` shows the pill regardless of whether the owner changed the price. Severity: WARNING (trust label wrong, not a flow break).
- Known issues are in-memory only (`known-issues.js` `cache` Map, 5-minute TTL). Offline or on reload before the fetch resolves, the card is silently absent. Consistent with other online community features, but unlike the parts overlay, which persists to meta. Severity: INFO.
- Registry audit: not applicable. No `components.json` in the repo.

---

## Needs human eyes (not verifiable from code)

1. Indicative pill, EN and AR, in the parts list and in the admin diff (already listed in 04-VERIFICATION.md item 7).
2. Known issues card on the dashboard, at 375px and 1440px, to confirm the spacing findings.
3. Edit and reject forms in the proposal panel at 375px, to confirm the wrap behaviour.
4. Picker shows registered models (`catalog.js:666-680`) with engine labels from the server. Engine labels are escaped (`main.js:118`), and a live check is still owed.

---

## Files Audited

- `src/pages/admin-proposals.js`
- `src/pages/parts.js`
- `src/pages/dashboard.js`
- `src/data/known-issues.js`
- `src/data/remote-catalog.js` (applyParts, parts, load/refresh)
- `src/data/catalog.js` (registerModels, isRegisteredModel)
- `src/data/insights.js` and `src/pages/maintenance.js` (engine on part contributions, grep only)
- `main.js` (boot wiring, syncDealerPlan, picker engine render)
- `src/i18n/strings.ar.js` (key coverage check)
- `styles.css` (proposal, pill, known-issue and fs-* rules)
- `supabase/functions/autopilot/flow.mjs` and `supabase/schema.sql` (price_basis flow into `after`, grep only)
- `.planning/phases/02-proposal-gate-review-queue/02-UI-SPEC.md` (baseline)
- `.planning/phases/04-parts-prices-community-new-models/04-05-SUMMARY.md`, `04-07-SUMMARY.md`, `04-09-SUMMARY.md`, `04-VERIFICATION.md`
- Git: commits bb537a5, abc0b07, f569ce4, fc6c345, e9e377b

Source files were not modified. Only `.planning/ui-reviews/.gitignore` was checked (already present, unchanged).
