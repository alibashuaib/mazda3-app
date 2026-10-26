-- Upload vs opt-out race (needs TWO psql sessions on a scratch copy of the schema).
-- Proves the per-user advisory lock: an upload that started before an opt-out cannot
-- leave rows behind after the opt-out commits.
--
-- Session A:
--   begin;
--   select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true),
--          set_config('request.jwt.claim.role', 'authenticated', true);
--   set local role authenticated;
--   select public.sync_contributions('v', '[{"kind":"fuel","source_key":"fuel:v:1","month":"2026-01","model_id":"m","odometer_band":0,"l100":7}]');
--   -- do NOT commit yet: A now holds the lock
--
-- Session B (same user):
--   begin;
--   select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true),
--          set_config('request.jwt.claim.role', 'authenticated', true);
--   set local role authenticated;
--   select public.delete_my_contributions();   -- blocks until A finishes
--
-- Session A:  commit;
-- Session B:  (unblocks, returns 1) commit;
--
-- Then, as the table owner, both must hold:
select count(*) = 0 as no_rows_survived from public.contribution_links
  where user_id = '00000000-0000-0000-0000-000000000001';
select share = false as server_opted_out from public.insights_prefs
  where user_id = '00000000-0000-0000-0000-000000000001';
-- And a further sync_contributions(...) by that user returns -1 (refused: opted out).
