# Guidance engine — manual live check

Run last, with the other live-Supabase checks. Needs a real project, an admin account, one approved car model and one real Mazda schedule URL.

1. Apply the merged `supabase/schema.sql` (twice is fine; it is idempotent).
2. Deploy `plan-intake` and set `ANTHROPIC_API_KEY` and `INTAKE_CRON_SECRET` (see `supabase/functions/plan-intake/README.md`). Confirm the model id with one real call; set `INTAKE_MODEL` if it fails.
3. Register one real schedule URL for one approved car (insert into `schedule_sources`), then press "Check Mazda sources now". Drafts appear in the Review queue with a readable diff and a source link; nothing changes for users yet.
4. Approve one draft: the live item updates, one `dealer_plan_changes` row is written, `plan_updated_at` bumps, and a signed-in device picks up the new interval.
5. Press the button again: no duplicate pending draft, and no draft for unchanged content.
6. A non-https URL cannot be added; an `http://` or private-host URL in `schedule_sources` is skipped by the function (`skipped` count rises).
7. Recalls arrive as pending. Approve one: the banner shows on a user's Dashboard with the "US ... confirm with your Mazda dealer" wording, in English and Arabic. Reject one, re-run intake: it stays rejected.
8. A non-admin cannot open the Review queue, read `plan_drafts`, or call `decide_plan_draft`.
9. Schedule items show the guidance line; a Brake item that is overdue shows "Inspect"; with fewer than 5 contributors the line ends "Mazda schedule only".
10. Arabic UI for every new string.

Release gate (not a PR gate): the owner approves the thresholds and all new English/Arabic wording; record the date in the spec.
