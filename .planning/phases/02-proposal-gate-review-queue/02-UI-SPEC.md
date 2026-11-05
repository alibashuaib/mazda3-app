---
phase: 2
slug: proposal-gate-review-queue
status: draft
shadcn_initialized: false
preset: none
created: 2026-11-05
---

# Phase 2 — UI Design Contract

> Owner-only `#admin` Proposals review queue. Vanilla JS, no build step, no shadcn (React-only; project is classic scripts). Reuse existing `styles.css` tokens and admin patterns. Introduce no new tokens except the small CSS additions listed under "New CSS".

Sources: 02-CONTEXT.md (layout, stale, reject, bulk, revert locked), 02-RESEARCH.md (UI pattern, A4), `src/pages/admin.js`, `src/ui/modal.js`, `src/ui/chrome.js`, `styles.css`.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (shadcn gate: not applicable, not a React/Next/Vite project) |
| Preset | not applicable |
| Component library | none; existing helpers `el`, `field`, `html`, `onAsyncClick`, `openModal`/`closeModal`, `toast`, `adminTabs` |
| Icon library | none for this phase. Text and the existing `.pill` dot only. No emoji. |
| Font | `var(--font)` system stack (existing) |

## Decisions on the open items

| Item | Decision |
|------|----------|
| Tab placement (A4) | New `Proposals` tab, FIRST in `adminTabs`, with pending count badge. Legacy `Review queue` and `Errors` tabs stay untouched. Default `adminTab` becomes `'proposals'`. Tab ids: `proposals`, `queue`, `errors`. |
| Confirm dialog | `src/ui/modal.js` has NO confirm helper. Use `openModal(title, sub, bodyBuilder)` with two buttons (Cancel `btn ghost`, confirm `btn primary`). Escape and backdrop already dismiss and restore focus. Do not add a new helper unless used twice; bulk approve is the only user, so build inline in the page script. |
| Revert confirmation | None (locked). Revert fires on click, then `toast('Reverted')`. |
| Stale refusal placement | Inline inside the expanded row, directly above the action buttons, as a `.proposal-alert` block (not a toast, not a modal). Persists until the owner acts. For bulk, stale failures are listed in the result summary. |
| Confidence badge | Reuse `.pill` with `ok` (high), `warn` (medium), `danger` (low). Label text always shown (color is never the only signal). Pill text is `t('High')`, `t('Medium')`, `t('Low')`. Hover/expand shows `confidence_factors` as a plain list in the expanded row. |
| Revert surface | `Recent approvals` card at the bottom of the Proposals tab: last 30 `change_log` rows, each with a Revert button. Not a change-log browser. |

---

## Layout and Interaction Contract

Single column, max width follows `--maxw` (540px) mobile-first. A table on 540px is unusable, so each "table row" is an `.item`-style row (flex) with the five columns stacked in two lines. This satisfies the locked "one row per proposal" decision.

Focal anchor: the bulk `Approve N high-confidence` button leads the list, and within each row the filled `Approve` button is the only filled button, so it is the eye target.

### Proposals tab structure (top to bottom)
1. Tab bar (`adminTabs`): `Proposals (N)`, `Review queue`, `Errors (N)`.
2. Filter card (`.card`, padding 16): `.field-row` grid with four `<select>`s via `field()`: Car, Kind, Confidence, Run. First option of each is `All` (value empty). Option lists are derived from loaded data. A `Clear filters` ghost button appears only when any filter is active. Filtering is in memory (pure `filterProposals`), no refetch.
3. Bulk bar (inside the filter card, below selects): `btn primary block` labelled `Approve N high-confidence`, where N = filtered rows with tier `high`. Hidden when N = 0.
4. Result summary (only after a bulk run): `.proposal-alert` showing `X approved, Y failed`, with failures listed one per line as `car · target: reason`. Dismissible by the next refetch.
5. Queue list (`.list`, gap 10px): one `.proposal-row` per pending proposal.
6. `Recent approvals` card.

### Collapsed row (tap anywhere on the summary to toggle)
- Line 1 (`h3`, 14px/650): `{car label} · {target_key}`.
- Line 2 (`p`, 12px muted, wraps allowed here: override `white-space: normal`): `{kind label} · {before} → {after}` (use `→` as existing `draftDiff` render does; in RTL the arrow is mirrored via `dir`, see RTL).
- Right/end side (`.item-side`): confidence `.pill`, below it run as `.sub` text `Run {run_id}`.
- Row is a `div role="button" tabindex="0" aria-expanded="true|false"`; Enter and Space toggle. Min height 56px (touch target 44px+).
- Only one chevron-free affordance: `aria-expanded` plus a rotating `›` text char is NOT used; the expanded panel opening below is the affordance.

### Expanded panel (below the summary, inside the same row container)
In order:
1. Diff block: one line per changed field, `{field label}: {before} → {after}` using existing `DIFF_LABELS` / `catalogAdmin.draftDiff`. Before value in `--text-2`, after value in `--text` weight 650.
2. Why-this-confidence: `confidence_factors` as a short list (text only).
3. Sources: one block per evidence item: `<blockquote>` verbatim quote (max 500 chars, rendered via `html`), then a link line showing hostname + source tier + fetched date. Links only when `https:` and `new URL()` parses; otherwise muted `Invalid source link`. `rel="noopener noreferrer" target="_blank"`.
4. Stale alert (only after a refused approve): `.proposal-alert` with title `Live value changed`, body `The live value is now {live}. Reject this proposal or edit it against the live value.`, live value shown as a diff line.
5. Edit form (hidden until Edit pressed): reuse the `adminEditor` field set (`interval_km`, `interval_months`, `note`, `parts` textarea via `parseParts`/`formatParts`), prefilled from proposal `after` (or from `res.live` after a stale refusal). Buttons: `Approve edited value` (primary), `Cancel` (ghost).
6. Reject form (hidden until Reject pressed): one `<textarea>` (rows 2, maxlength 300) labelled `Reason (optional)`, buttons `Reject proposal` (destructive style) and `Cancel`.
7. Action row (`.field-row`-style grid, 3 buttons): `Approve` (primary), `Edit` (ghost), `Reject` (ghost).

All buttons use `onAsyncClick` (re-entry guard). After any success, refetch and re-render the tab, keep filters, collapse the row. Failure shows inline `Could not save. Check your connection.` in the panel (not only a toast) and keeps the row open.

### States
| State | Behaviour |
|-------|-----------|
| Loading | `<p class="muted">Loading…</p>` (existing string) |
| Empty (no pending at all) | Heading + body per copy table; no filter card |
| Empty (filters match nothing) | `No proposals match these filters` + `Clear filters` button |
| Load failure | `.card` with `Could not load proposals.` and a `Try again` ghost button (rerun `renderAdminBody`) |
| Row busy | `onAsyncClick` disables buttons; no spinner |
| Approve success | row removed, `toast('Approved')` |
| Approve stale | alert in panel, row stays pending, Edit prefilled with live |
| Reject success | row removed, `toast('Rejected')` |
| Bulk running | button disabled, label `Approving…` |
| Bulk done | summary alert; list refetched |
| Revert success | `toast('Reverted')`; list refetched; the revert itself appears in Recent approvals with its own Revert button |
| Revert drifted (A2) | inline muted message under that row: `Newer change exists. Revert that one first.` |
| 500-row cap hit | muted line at list end: `Showing the newest 500. Approve or reject some to see more.` |

### Bulk confirmation (modal)
`openModal('Approve high-confidence proposals', null, builder)`. Body: `<p>` = `Approve {N} high-confidence proposals? Each one changes the live catalogue for all users.`; N is the count at open time. Buttons: `Cancel` (ghost, first, receives initial focus is the first focusable, which is correct: safe default) and `Approve {N}` (primary). Server re-checks tier and status; the result summary reports the actual outcome.

### Recent approvals card
Heading `Recent approvals`. Row: `{date YYYY-MM-DD} · {car} · {target}` line 1, `{before} → {after}` muted line 2, `Revert` ghost button at the end. Rows that are reverts are labelled with a `Revert` pill-free muted prefix `Reverted:`. Empty: muted `No approvals yet`.

### RTL / Arabic
- Every user string through `t('…')`; Arabic entries added to `src/i18n/strings.ar.js` (no duplicate keys, `strings-ar-unique.test.js`).
- Do not hardcode `left/right`. Existing `.item-side { text-align: right }` is physical: override for `.proposal-row .item-side` with `text-align: end`. New CSS uses logical properties only (`margin-inline-*`, `padding-inline-*`, `border-inline-start`, `inset-inline-*`).
- Scraped quotes, URLs, part numbers, and car/target names are user-content of unknown direction: wrap in elements with `dir="auto"`; hostnames and numbers with `dir="ltr"` and `unicode-bidi: isolate`.
- Diff arrow: render as `→` inside a `<span aria-hidden="true">` and put `dir="ltr"` on the before/after values; in RTL the visual arrow should point toward the "after" (use `←` when `document.dir === 'rtl'`, i.e. `const ARROW = isRtl() ? '←' : '→'` with the existing RTL detection in `src/i18n/lang.js`).
- Numbers: keep the app's existing numeral convention; do not introduce locale formatting here.

### Accessibility
- Tab bar roles already exist; keep `role="tab"` and `aria-selected`.
- Row toggles: `aria-expanded`, `aria-controls` panel id.
- Per-row buttons carry `aria-label` with the target: `Approve {target}`, `Edit {target}`, `Reject {target}`, `Revert {target}` (via `t()`).
- Pill text carries meaning (not colour alone). Stale/bulk alerts use `role="alert"` so they are announced.
- Visible focus: reuse `:focus-visible` outline `2px solid var(--accent-soft)` offset 2px (matches `.toast-undo`).
- Tap targets >= 44px height (existing `.btn` 13px padding + 14px text is 40px; add `min-height: 44px` to buttons inside `.proposal-row`).

---

## Spacing Scale

Declared values (multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Gap inside pill/label, diff line gap |
| sm | 8px | Gap between buttons in action row, between evidence items |
| md | 16px | Card padding (matches existing `padding:16px`), panel padding |
| lg | 24px | Gap between filter card, list, recent approvals |
| xl | 32px | Not used in this phase |
| 2xl | 48px | Not used |
| 3xl | 64px | Not used |

Exceptions (reused from `styles.css`, NOT re-declared or introduced by this phase): list gap 10px and `.field-row` gap 12px and `.item` padding 14px come from `styles.css` and are reused as-is; touch targets min-height 44px.

---

## Typography

Reuse existing sizes. Declared for this phase:

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body (diff, quote, form inputs, alerts) | 14px | 400 | 1.5 |
| Label / meta (row line 2, run, source meta, pill) | 12px (pill 10.5px as existing) | 400 (pill 650) | 1.4 |
| Heading (row title, card heading `h3`/`h4`) | 14px (same size as body; differs by weight 650) | 650 | 1.2 |
| Display | not used | | |

Weights: exactly two, 400 and 650. The pill uses 650 (override the existing 700 via `.proposal-row .pill { font-weight: 650; }`). Sizes: 14, 12 (pill 10.5px reused from styles.css). Quotes: 13px italic is NOT used; use 14px/400 with `border-inline-start: 3px solid var(--stroke-strong)` and `padding-inline-start: 8px`.

---

## Color

Dark theme default, light theme via existing `[data-theme]` token swap. Use tokens only, no hex in new CSS.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `var(--bg)` / `var(--bg-2)` | Page background |
| Secondary (30%) | `var(--surface)` / `var(--surface-2)` / `var(--stroke)` | Cards, rows, expanded panel (`--surface-2`), borders |
| Accent (10%) | `var(--accent)` `#d6203c` via `.btn.primary` | See reserved list |
| Destructive | `var(--danger)` / `var(--danger-soft)` | Reject confirm button, low-confidence pill, failed bulk lines |
| Semantic | `var(--ok)` high pill; `var(--warn)` medium pill and stale alert | Status only |

Accent reserved for: the active tab, `Approve` and `Approve edited value` buttons, bulk `Approve N high-confidence` button and modal confirm, focus outline (`--accent-soft`). Nothing else. `Revert`, `Edit`, `Cancel`, `Clear filters`, `Try again` are `btn ghost`.

Note: accent red (#d6203c) and danger red are close. To avoid "Approve looks like Reject": Reject is `btn ghost` with `color: var(--danger)` text and `border-color: var(--danger-soft)`, never a filled red; Approve is the only filled button in a row.

`.proposal-alert`: `background: var(--warn-soft)`, `border: 1px solid var(--warn)`, `border-radius: var(--radius-sm)`, padding 16px. Failure variant uses `--danger-soft`/`--danger`.

### New CSS (the only additions, appended near `.admin-item` at styles.css:1039)
```
.proposal-row { flex-direction: column; align-items: stretch; }
.proposal-row .item-side { text-align: end; }
.proposal-row .item-main p { white-space: normal; }
.proposal-panel { margin-top: 8px; padding-top: 16px; border-top: 1px solid var(--stroke); display: grid; gap: 16px; }
.proposal-row blockquote { margin: 0; padding-inline-start: 8px; border-inline-start: 3px solid var(--stroke-strong); }
.proposal-alert { padding: 16px; border-radius: var(--radius-sm); background: var(--warn-soft); border: 1px solid var(--warn); }
.proposal-alert.fail { background: var(--danger-soft); border-color: var(--danger); }
.proposal-row .btn { min-height: 44px; }
.proposal-row .pill { font-weight: 650; }
.btn.ghost.reject { color: var(--danger); border-color: var(--danger-soft); }
```
`styles.css` is precached: bump via `npm run sw:version` after edits (CSS and the new page script both).

---

## Copywriting Contract

All via `t()`; Arabic in `src/i18n/strings.ar.js`. Reuse existing strings where they exist (`Approve`, `Reject`, `Loading…`, `Could not save`, `Nothing waiting for review`) rather than adding near-duplicates.

| Element | Copy |
|---------|------|
| Tab label | `Proposals` (badge = pending count) |
| Primary CTA (per row) | `Approve` |
| Bulk CTA | `Approve {N} high-confidence` |
| Bulk modal title / body / confirm | `Approve high-confidence proposals` / `Approve {N} high-confidence proposals? Each one changes the live catalogue for all users.` / `Approve {N}` |
| Edit / reject buttons | `Edit`, `Reject` ; form buttons `Approve edited value`, `Reject proposal`, `Cancel` |
| Reject reason label / placeholder | `Reason (optional)` / `Why is this wrong or not useful?` |
| Empty state heading | `No proposals waiting` |
| Empty state body | `New findings from the autopilot will appear here for your approval. Nothing reaches users until you approve it.` |
| Empty (filtered) | `No proposals match these filters` |
| Error state (load) | `Could not load proposals. Check your connection and try again.` + `Try again` |
| Error state (save) | `Could not save. Check your connection.` |
| Stale refusal title / body | `Live value changed` / `The live value is now {live}. Reject this proposal or edit it against the live value.` |
| Bulk result | `{X} approved, {Y} failed` ; per failure `{car} · {target}: {reason}` with reasons mapped: `stale` -> `Live value changed`, `not_high` -> `No longer high confidence`, other -> `Could not apply` |
| Confidence labels | `High`, `Medium`, `Low` ; section title `Why this confidence` |
| Source line | `{hostname} · {Official|Secondary|Community} · {date}` ; invalid -> `Invalid source link` |
| Toasts | `Approved`, `Rejected`, `Reverted` |
| Recent approvals | heading `Recent approvals` ; empty `No approvals yet` ; button `Revert` ; drifted `Newer change exists. Revert that one first.` |
| Destructive confirmation | Reject: no modal; the optional-reason form is the second step (`Reject proposal`). Bulk approve: modal above. Revert: none (locked, undoable by reverting the revert). |

Destructive actions in this phase: Reject (inline two-step), Bulk approve (modal with count), Revert (no confirm by decision).

---

## Security Rendering Rules (REV-09, binding on executor)

- All dynamic markup via `html` template or `textContent`. No `raw()` on any proposal, evidence, reason, car or target field.
- `href` only when `/^https:\/\//i` passes AND `new URL()` parses; text is hostname, never the raw URL.
- Quotes truncated to 500 chars before render. Optional: strip U+202A-202E and U+2066-2069 from quotes.
- Injection fixtures required (per research): `<img src=x onerror=alert(1)>`, `javascript:alert(1)`, `https://a.test/"><script>` in target, before/after note, quote, reason, URL. Tests assert no `img`/`script` nodes and no `a[href^=javascript]` in `#view`.
- `test/no-raw-templates.test.js` covers the new page file automatically.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable (no shadcn) |
| third-party | none | not applicable; no registries, no new npm packages (2026-11-05) |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
