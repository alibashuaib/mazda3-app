---
status: complete
date: 2026-11-11
---

# Quick task: integration warnings F1-F12 (skip F8)

F1 years capped at 15 in models.mjs; schema accepts 0-15. F2 warranty values rounded to whole. F3 agreement counts action=replaced only. F5 read-bill requires account >= 7 days (too_new). F6 NHTSA evidence URL is the human ODI page. F7 community evidence scores 1 (explicit). F9 index.ts returns 429 when budget_left <= 0 before starting a run. F10 blanked admin price drops the catalogue-owned option. F12 maintenance.js uses an injected sink (setContributeSink, wired in main.js). Tests updated: null-price behaviour, contribute sink stub, new models parse test. npm test 1052/1052.

F8 skipped (owner config). Not run: SQL tests (no local Postgres; CI rls).
