# Phase 1: Reliable & Safe Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-05
**Phase:** 01-reliable-safe-foundation
**Areas discussed:** Error log scope, Error toast UX, Allowed origins, SW update & cache

---

## Error log scope

| Option | Description | Selected |
|--------|-------------|----------|
| Saves + uncaught | Save/afterSave failures plus window.onerror and unhandledrejection, rate-limited | ✓ |
| Save failures only | Matches FND-01 exactly; crashes elsewhere invisible | |
| Everything incl. network | Also offline/sync failures; noisy | |

| Option (signed-out users) | Description | Selected |
|--------|-------------|----------|
| Anonymous insert | Insert-only anon RLS, length caps, per-device throttle | ✓ |
| Signed-in only | No anon write surface | |
| Queue until sign-in | Local queue uploaded later | |

| Option (row contents) | Description | Selected |
|--------|-------------|----------|
| Message + context only | Message, stack, route, version, user id; no vehicle data | ✓ |
| Include vehicle id/model | Adds car model | |
| Full payload | Includes failed record | |

| Option (retention) | Description | Selected |
|--------|-------------|----------|
| 90 days | pg_cron cleanup | ✓ |
| 30 days | Smallest footprint | |
| Keep forever | Manual delete | |

| Option (admin view) | Description | Selected |
|--------|-------------|----------|
| Grouped by message | Count, first/last seen, source, expand stacks, resolve | ✓ |
| Raw latest-first list | Last 100 rows | |
| You decide | Planner picks | |

| Option (placement) | Description | Selected |
|--------|-------------|----------|
| Separate tab in #admin | Errors tab with count badge | ✓ |
| Section below the queue | One long page | |
| You decide | Planner picks | |

---

## Error toast UX

| Option | Description | Selected |
|--------|-------------|----------|
| Message + Retry | Retry re-runs the same save | ✓ |
| Message only | Plain warn toast | |
| Inline banner | Sticky page banner | |

| Option (duration) | Description | Selected |
|--------|-------------|----------|
| Until dismissed | Doesn't vanish while data at risk | ✓ |
| Long timeout (~10s) | Like delete-undo toast | |
| Normal timeout | Like other warn toasts | |

| Option (uncaught errors) | Description | Selected |
|--------|-------------|----------|
| Silent, log only | No user alarm | ✓ |
| Generic toast | Once per session | |

| Option (technical detail) | Description | Selected |
|--------|-------------|----------|
| No, plain words | Translated plain text | ✓ |
| Short error code | e.g. "(quota)" | |

---

## Allowed origins

| Option (production URL) | Description | Selected |
|--------|-------------|----------|
| GitHub Pages | https://alibashuaib.github.io | ✓ |
| Set via env secret | ALLOWED_ORIGINS only | |

| Option (file:// Origin: null) | Description | Selected |
|--------|-------------|----------|
| Reject null | Sandboxed iframes also send null; manual form still works | ✓ |
| Allow null | Keeps bill reading from file:// | |

| Option (dev origins) | Description | Selected |
|--------|-------------|----------|
| Only via env flag | ALLOWED_ORIGINS on dev project | ✓ |
| Always allow localhost | Convenient, looser | |
| Never | Use supabase functions serve | |

---

## SW update & cache

| Option (release switch) | Description | Selected |
|--------|-------------|----------|
| Silent, next launch | No mid-session script swap | ✓ |
| 'Update available' toast | User taps Reload | |
| Silent immediate (current) | skipWaiting + claim | |

| Option (versioning) | Description | Selected |
|--------|-------------|----------|
| Content hash in test | CI fails if stale; one command updates | ✓ |
| Git commit in CI | Needs deploy step | |
| You decide | Planner picks | |

| Option (photo cache) | Description | Selected |
|--------|-------------|----------|
| ~6 photos | ~4 MB, LRU | ✓ |
| ~15 photos | ~9 MB | |
| You decide | Planner picks | |

| Option (missing precache file) | Description | Selected |
|--------|-------------|----------|
| Skip + log | Continue install, report to error log | ✓ |
| Skip silently | Nothing recorded | |

---

## Claude's Discretion

- RLS-in-CI mechanism, safeFetch internals, vendor pin format, photo version map shape, plan-intake batching, AGENTS.md trim, error table schema/throttle numbers.

## Deferred Ideas

None.
