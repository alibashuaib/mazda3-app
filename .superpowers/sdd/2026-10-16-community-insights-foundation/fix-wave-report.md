Fix wave done. Items 1-6 implemented. npm test 464/464; e2e 19 pass, 1 skip. sw.js CACHE garage-v120.
Notes: opt-out race fixed at drain time via env.shareEnabled (no outbox-purge API in insights, so setShare unchanged). signOut flushes pending delete (3s cap) via env.flushPendingDelete. Schema untested against live Postgres.
