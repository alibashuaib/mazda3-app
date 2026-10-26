# plan-intake Edge Function

Drafts Mazda's published maintenance schedule from admin-registered source URLs and fetches NHTSA recalls. It never writes live plan data: only `plan_drafts` and `pending` rows in `recalls`. The admin approves in the app's Review queue.

## Deploy

```
supabase functions deploy plan-intake --no-verify-jwt
supabase secrets set ANTHROPIC_API_KEY=... INTAKE_CRON_SECRET=...
```

Gateway JWT verification must be OFF: the weekly pg_cron call sends only `x-cron-secret`, and the gateway would reject it before the function runs. The function does its own auth (index.ts, top of the handler): the request must carry either the `x-cron-secret` header or an admin's JWT (verified with `auth.getUser`, then `profiles.role = 'admin'`). The "Check Mazda sources now" button sends the admin JWT.

## Weekly schedule (pg_cron + pg_net)

```sql
select cron.schedule('plan-intake', '0 3 * * 1', $$
  select net.http_post(url := 'https://<ref>.functions.supabase.co/plan-intake',
    headers := '{"x-cron-secret":"<secret>"}'::jsonb) $$);
```

## Secrets

- `ANTHROPIC_API_KEY` (required), `INTAKE_CRON_SECRET` (required).
- `INTAKE_MODEL` (optional, default `claude-sonnet-5-5`, UNVERIFIED: confirm one live call works).

## Cost and kill switch

One model call per source whose content hash changed. Kill switch: `supabase secrets unset ANTHROPIC_API_KEY` and `select cron.unschedule('plan-intake');`.

## Safety

Source URLs must be https and pass `isSafeUrl` (no IP literals, localhost, `.local`/`.internal`, odd ports); one redirect is followed and re-checked. Model output is whitelisted and clamped; an unparseable result writes no draft. A source's hash is stored only after its drafts were written. A source whose output cannot be parsed is not retried until its content changes (set its `content_hash` to null to force a retry). Each source host must resolve to public addresses only. Recalls already in the table (any status) are never overwritten.

## Not executed

`index.ts` has never been run (no Deno in dev); only `logic.mjs` is unit-tested. Live checks happen after deploy (see docs/superpowers/verification/2026-10-18-guidance-manual.md).
