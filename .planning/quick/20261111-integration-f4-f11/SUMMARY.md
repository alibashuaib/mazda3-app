---
status: complete
date: 2026-11-11
---

# Quick task: integration findings F4 and F11

F4: price_item_averages is now an aggregate-only owner-run view joining qualified_users, with having count(distinct user) >= 3 (store_prices pattern). security_invoker removed on purpose, since the view must read qualified_users.

F11: admin approve of draft car_model goes through new admin-only RPC approve_car_model (is_admin, change_log row, revoke anon/public). src/data/admin.js uses rpc; test/admin.test.js updated.

Not added: SQL assertion for F4 threshold (no local Postgres; CI rls job runs supabase/tests). Schema change is not applied to any live DB.
