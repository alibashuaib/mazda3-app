# Phase 2 Context: Proposal Gate & Review Queue

<domain>
Owner reviews, edits, approves, rejects and reverts seeded catalogue proposals in `#admin`. Nothing reaches users unapproved. This phase covers the review UI and the approve/reject/revert data paths only. Autopilot output (Phases 3-4) is out of scope.
</domain>

<decisions>
## Queue layout
- Table rows, one per proposal: car, kind, before to after, confidence badge, run.
- Tapping a row expands the before/after diff and the source links with verbatim quotes inline.
- Filters above the table: car, kind, confidence, run (REV-01).

## Approve and stale values
- Approve is refused when the live row changed since the proposal was made (CORE-02). The message shows the current live value.
- The owner then rejects or edits the proposal against that value. Nothing is overwritten silently.
- The owner can edit a proposed value before approving (REV-04).

## Reject and suppression
- Reject takes an optional reason (REV-05).
- A rejected value is not re-queued unless its sources change (CORE-03).

## Supersede
- A newer proposal for the same target supersedes the older pending one (CORE-04). Behaviour not discussed further; planner decides the mechanics and keeps it inside the same transaction as the insert.

## Bulk approve and revert
- High-confidence means the top confidence tier only (REV-02).
- Bulk approve asks for one confirmation showing the count. One failing item does not abort the rest.
- Revert needs no confirmation. Each revert is recorded as a new audited change in the change log (REV-06, CORE-05) and can itself be reverted.

## Security (from roadmap success criterion 5)
- Scraped and LLM text renders only through the escaping `html` template (REV-09).
</decisions>

<canonical_refs>
- `.planning/ROADMAP.md` — Phase 2 goal and success criteria
- `.planning/REQUIREMENTS.md` — CORE-01..07, REV-01..06, REV-09
- `.planning/phases/01-reliable-safe-foundation/01-VERIFICATION.md` — phase 1 status (human items pending)
- `src/ui/html.js` — escaping template that all admin text must use
- `CLAUDE.md` — approval gate and security constraints
</canonical_refs>

<code_context>
- `src/pages/admin.js` — existing `#admin` page with tabs (Review queue, Errors) added in phase 1 (01-10).
- `src/data/admin.js` — admin data functions; `listErrors`/`resolveGroup` pattern (never reject, return `{ok, ...}`) to follow.
- `supabase/schema.sql` — RLS and trigger patterns from phase 1 (`app_errors`) to follow for new proposal tables.
- `src/ui/html.js` — `html` tagged template and `raw()`; enforced by `test/no-raw-templates.test.js`.
</code_context>

<deferred>
- Autopilot generation of proposals (Phases 3-4).
- Per-source domain bans (ENG-06, Phase 3).
- Owner-facing change-log browser beyond the revert action (not in phase 2 roadmap).
</deferred>
