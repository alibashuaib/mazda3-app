# read-bill Edge Function

Reads a bill photo with a Claude vision model and returns whitelisted fields. Called by the app with the user's JWT.

## Deploy
```
supabase functions deploy read-bill
supabase secrets set ANTHROPIC_API_KEY=... 
```
Do NOT use `--no-verify-jwt`: JWT verification stays ON (the function also calls `auth.getUser(jwt)` itself).

## Secrets
- `ANTHROPIC_API_KEY` (required). Missing: the function returns 503 and the UI shows "Could not read the bill."
- `BILL_MODEL` (optional). Default `claude-haiku-5-5` is UNVERIFIED: the owner must confirm one live call works, or set `BILL_MODEL` to a known model id. A wrong id makes every read 502 and burns the user's daily slot.
- `BILL_GLOBAL_DAILY_CAP` (optional, default 500): total reads across all users per rolling 24h; at or over it the function returns 503 `unavailable`.

## Limits and cost
- One model call per read. Per user: 10 reads per 24h (`DAILY_CAP`, counts failed reads too). Global: `BILL_GLOBAL_DAILY_CAP`.
- Only users with a confirmed email or phone are served (403 `unconfirmed` otherwise).
- Kill switch: unset `ANTHROPIC_API_KEY` (`supabase secrets unset ANTHROPIC_API_KEY`) or lower `BILL_GLOBAL_DAILY_CAP`.

## Privacy
The image goes only to Anthropic and is not stored. `bill_reads` keeps store_key, city and a SHA-256 hash of store|date|total; no bill text.

## Not executed
index.ts has never been run (no Deno in the dev environment); only `logic.mjs` is unit-tested. The live checks must be done after deploy.
