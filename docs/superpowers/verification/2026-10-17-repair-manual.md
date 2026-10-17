# Repair vs replace vs inspect — manual live check

Run last, with the other live-Supabase checks. Needs a real project with the merged `schema.sql`, `read-bill` redeployed, and 5 confirmed test accounts at least 7 days old.

1. Log replaced, repaired and inspected rows for one part from 5 accounts: a `repair_stats` row appears only at 5.
2. Parts page form shows the community line.
3. With fewer than 5 accounts, a curated part shows its tip (e.g. `Headlight` / `مصباح أمامي`).
4. `brand_life` and `store_prices` are unchanged by repaired and inspected rows.
5. A bill line like "polish headlight" suggests `repaired`.
6. Arabic UI shows the new action labels.
7. Opting out removes that account's rows from `repair_stats`.

Release gate (not a PR gate): owner approves every `tipEn`/`tipAr` in `src/data/repairable.js`; record the date in the spec.
