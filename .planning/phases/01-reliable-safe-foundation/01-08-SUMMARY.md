# Plan 01-08 Summary: safeFetch for plan-intake

**Status:** merged with blockers. Code and Node tests complete (756/756). Staging verification partly complete.

## Delivered

- `supabase/functions/_shared/net-guard.mjs`: private/internal IP and URL checks. Table-driven tests in `test/edge-safe-fetch.test.js`.
- `supabase/functions/_shared/safe-fetch.mjs`: fetch with per-hop address re-check, `redirect: 'manual'`, body cap, timeout, robots.txt check. Robots matching is a linear glob matcher (no RegExp), rules capped at 500, patterns at 512 chars.
- `supabase/functions/_shared/dns.ts` + `dns-logic.mjs`: `Deno.resolveDns` for A and AAAA. Only `Deno.errors.NotFound` counts as empty; any other error fails closed (null).
- `plan-intake/index.ts` uses `safeFetch` for schedule sources and NHTSA (via `NHTSA_POLICY`). Anthropic calls remain plain `fetch` to `api.anthropic.com` (a source-grep test enforces this).
- Owner-accepted (W-06): `NHTSA_POLICY` sets `respectRobots: false`. NHTSA is a fixed public government JSON API, not scraping.

## Security review fixes

- robots ReDoS: regex compile removed; linear matcher with caps.
- DNS fail-open: non-NotFound resolver errors now block.

## Staging verification (garage-staging, ref nqozmlstxxsrlbremaoj, created for this test)

Schema applied from `supabase/schema.sql`. `plan-intake` deployed. `INTAKE_CRON_SECRET` and `ANTHROPIC_API_KEY` set.

| Check | Result |
|---|---|
| Function responds through gateway | Pass (200) |
| A1: `Deno.resolveDns` returns addresses for public host | Partly confirmed: `https://www.mazda.com/` passed fetch, so resolution worked |
| Host resolving to 127.0.0.1 (`localtest.me`) | Pass: blocked |
| Redirect to `http://` (httpbin.org) | Pass: blocked before model call. The block reason was generic (`blocked`), so the redirect rule is inferred, not logged |
| A2: 3xx `Location` header visible under `redirect: 'manual'` | Inferred from the redirect block; not directly observed |
| Normal host without AAAA record resolves (NotFound branch) | Not tested |
| NHTSA recalls call not blocked | Not tested: count was 0 and no vehicle data existed |
| Model step (Anthropic call, draft parsing) | **Blocked**: Anthropic account has no credit (HTTP 400, "credit balance is too low") |

Staging test rows were removed. The staging function is redeployed from this committed code.

## Blockers

1. **Model step unverified** until the Anthropic account has credit.
2. **NHTSA call untested** on staging (no vehicle data to trigger it).
3. **A2 not directly observed**; redirect rule inferred.
4. **NotFound branch untested** (no AAAA-less host run).
5. **T-01-35 residual risk, accepted:** DNS rebinding between the address check and the connect is not closed. Deno `fetch` cannot pin the connection to the validated IP. Re-checking on every redirect hop only narrows the window.

## Deviations

- The temporary staging debug logging used during testing was reverted before merge.
- The executor's worktree base was reset to the plan's base commit.
- `supabase/.temp/` (CLI temp folder) is untracked and not committed.
