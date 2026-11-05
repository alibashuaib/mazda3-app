# autopilot Edge Function

Monthly catalogue autopilot worker. Claims queued jobs (discover, extract, recalls, publish) one stage per car, stages findings, and publishes at the end. It never writes proposals or live tables itself: findings go through `autopilot_stage_findings`, and only the SQL function `autopilot_publish_run` calls `submit_proposal`. The owner approves in the Review queue.

## Actions (POST JSON)

- `{"action":"work"}` with header `x-cron-secret`: drains jobs for about 100 s, then returns `{done, failed}`. pg_cron pokes it every 5 minutes while jobs are open.
- `{"action":"preview","car_model_id":"..."}` with an admin JWT: free (page fetches and hash compares only; no search, no LLM). Returns `{sar, searches, llm_calls, skipped, basis}`.
- `{"action":"run","car_model_id":"..."}` with an admin JWT: starts a manual run for that car, then works the queue.

## Preview accuracy

For a never-checked car there are no known sources (no `autopilot_sources` rows), so nothing can be skipped as unchanged. The preview then returns `basis: "worst-case"` and the full worst case (one discovery plus four extractions). Once a car has been run, `basis` is `known-sources` and unchanged pages are listed in `skipped` and cost nothing. Source hashes are written and read only through `autopilot_set_source_hash` / `autopilot_get_source_hash`; the function only lists known URLs with a read-only select.

## Deploy

```
supabase functions deploy autopilot
supabase secrets set ANTHROPIC_API_KEY=... INTAKE_CRON_SECRET=...
```

JWT verification stays ON. `INTAKE_MODEL` (optional) overrides the extraction model (default `claude-sonnet-5-5`); discovery uses `claude-haiku-5-5`. Both must exist in `autopilot_config.prices` or the call fails closed.

## pg_cron

The monthly start and the 5-minute work poke are created by `supabase/schema.sql`. They read two database settings, set once per project outside git:

```sql
alter database postgres set app.autopilot_url = 'https://<ref>.functions.supabase.co/autopilot';
alter database postgres set app.autopilot_secret = '<same value as INTAKE_CRON_SECRET>';
```

## GCC domains

Pass 1 of discovery only searches `autopilot_config.gcc_domains`. It starts empty, so every car goes to pass 2 (all domains except banned). Set it with:

```sql
update autopilot_config set gcc_domains = array['mazdasaudi.com','mazda.ae'] where id = 1;
```

Unseen result domains are stored as `pending` and listed as skipped until the owner approves them; banned domains are never fetched. PDF sources are skipped and listed as `pdf`.

## Cost

Expect about SAR 10 per monthly run; the hard cap is SAR 40 per month (`autopilot_config.monthly_cap_sar`). `autopilot_reserve` is called before every search and every LLM call, so the cap and the kill switch (`autopilot_set_enabled(false)`) take effect between calls. When a call settles above its reservation, the run stops.

## Smoke result (plan 03-01)

The live smoke call (`node supabase/functions/autopilot/smoke.mjs`) is still pending the owner. Until it passes, the web-search tool shape (`web_search_20250305`) is unverified against the live API.

## Not executed

`index.ts` has never been run (no Deno in dev); orchestration in `flow.mjs` is unit-tested with fakes (`test/edge-autopilot-flow.test.js`).
