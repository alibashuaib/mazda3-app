---
status: complete
date: 2026-11-11
---

# Quick task: CI fix — schema.sql and deno check

CI run 42900811694 (branch check-now-full-width, bb8da57) failed two jobs.

- rls: `supabase/schema.sql:1323` syntax error. Cause: plpgsql ends an IF condition at the first THEN token, so the CASE's own THEN in `submit_proposal` part-tag check (line 1152) cut the condition short. Fix: wrap the CASE in parentheses, same as the existing guard at line 1287.
- deno: `npm:@supabase/supabase-js@2` unresolved, no node_modules. Fix: `deno check --node-modules-dir=auto` in `.github/workflows/test.yml`.

Verified: `npm test` 1051/1051. Not verified locally: schema.sql on Postgres (no local DB), deno check (no deno installed). Confirmed by CI rls and deno jobs.
