# autopilot Edge Function

Monthly catalogue autopilot worker. Claims queued jobs (discover, extract, recalls, publish) one stage per car, stages findings, and publishes at the end. It never writes proposals or live tables itself: findings go through `autopilot_stage_findings`, and only the SQL function `autopilot_publish_run` calls `submit_proposal`. The owner approves in the Review queue.

## Actions (POST JSON)

- `{"action":"work"}` with header `x-cron-secret`: drains jobs for about 100 s, then returns `{done, failed}`. pg_cron pokes it every 5 minutes while jobs are open.
- `{"action":"preview","car_model_id":"..."}` with an admin JWT: free (page fetches and hash compares only; no search, no LLM). Returns `{sar, searches, llm_calls, skipped, basis}`.
- `{"action":"run","car_model_id":"..."}` with an admin JWT: starts a manual run for that car, then works the queue.

## Preview accuracy

For a never-checked car there are no known sources (no `autopilot_sources` rows), so nothing can be skipped as unchanged. The preview then returns `basis: "worst-case"` and the full worst case (one discovery plus four extractions). Once a car has been run, `basis` is `known-sources` and unchanged pages are listed in `skipped` and cost nothing. Source hashes are read through `autopilot_get_source_hash` and staged with `autopilot_stage_hash`; `autopilot_publish_run` promotes them to `autopilot_sources` only after a successful publish (a capped, stopped or aborted run discards them); the function only lists known URLs with a read-only select.

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

`index.ts` has never been run (no Deno in dev); orchestration in `flow.mjs` is unit-tested with fakes (`test/edge-autopilot-flow.test.js`). CI runs `deno check --node-modules-dir=auto` on it (`deno` job).

## Phase 4 runbook (parts, prices, community, new models)

Owner-run only. Nothing here is applied by CI or by an executor.

### 0. Precondition

CI is green on the commit being applied, every job: `test`, `browser`, `deno`, and `rls` (the `rls` job runs `supabase/schema.sql`, the seeds, and `supabase/tests/*.sql` on Postgres). Red job: stop, apply nothing.

### 1. Apply the SQL, in order

Run each file in the Supabase SQL editor for the target project:

1. `supabase/schema.sql` (re-runnable: `if not exists` / `create or replace` / `on conflict`).
2. `supabase/seed-parts.sql` (catalogue parts; `on conflict do nothing`).
3. `supabase/seed-sources.sql` is optional. It holds only comments and a host template; the owner chose `empty`, so there is nothing to apply. Fill the template and run it only to approve hosts in bulk; otherwise approve hosts later in the admin domain list.

Check: `select count(*) from catalogue_parts;` returns more than 0.

### 2. Deploy the function

```
supabase functions deploy autopilot
```

Secrets as in Deploy above. JWT verification stays ON.

### 3. Tunables (`autopilot_config`, row `id = 1`)

Defaults come from `supabase/schema.sql`. Change only with a reason.

| Column | Default | Meaning |
|--------|---------|---------|
| `optional_cars_per_run` | 6 | Monthly parts and community work goes to this many least-recently-done cars (0–50). |
| `optional_floor_sar` | 8 | Soft floor. Optional stages stop when `autopilot_budget_left()` drops below it, so parts or community spend cannot trip the hard cap and wipe the run's staged findings. |
| `min_pct` | 0.10 | Materiality gate for a price change: must be at least this fraction of the live price... |
| `min_sar` | 5 | ...and at least this many SAR. Both must hold. No live price means always material. |
| `dealer_price_urls` | `{}` | Dealer price pages per car. Empty means no dealer price scraping. |

Example:

```sql
update autopilot_config set optional_cars_per_run = 4 where id = 1;
```

### 4. Smoke

Free, no LLM, no search:

```
node supabase/functions/autopilot/smoke.mjs --ppl
```

Expected: SAR matches above 0 on the dealer page. The earlier run was inconclusive (sandbox DNS `ENOTFOUND` for `www.mazda.com.sa`), so run it on a normal network. Until it shows matches, dealer prices stay manual.

Paid, about SAR 0.05, owner's key only:

```
ANTHROPIC_API_KEY=... node supabase/functions/autopilot/smoke.mjs --citations
```

Live check in the app:

1. Admin, Autopilot, pick one car (e.g. CX-5 KF 2.5L), Check now. Preview shows cost including parts and community.
2. Run report lists parts and community jobs as done or skipped with a reason (budget, no citations, held hosts).
3. Proposals, filter by kind Part / Known issue. A zero-proposal result is valid; say so.
4. Approve one part proposal, refresh the car's Parts page, check the new price. Revert it under Recent approvals and check the old price returns.
5. Optional: `select * from autopilot_runs order by id desc limit 1;` Spend should be well under SAR 40.

### 5. Known limits

- Reddit and forum sources are snippet-only: the API `cited_text` is the only proof.
- Dealer prices depend on the `--ppl` smoke above passing.
- User agreement needs engine-tagged reports for multi-engine models.
- The models stage is skipped without `gcc_domains` (see GCC domains above).
- Part-number confirmation needs 2 registrable hosts; shared-hosting subdomains count once.
- SQL assertions in `supabase/tests/*.sql` run only in CI (`rls` job); no local Postgres.
