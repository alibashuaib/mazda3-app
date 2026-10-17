# Guidance engine — auto-drafted Mazda schedule and recalls, admin-approved

## Goal

Give each owner one clear answer per schedule item — Replace, Repair, Inspect or OK — built from Mazda's published schedule, recall data, and the community stats already collected, with the admin's only job being to approve drafts.

## Decisions (agreed)

- Sources: Mazda's published maintenance schedule and recall data. Not live dealer prices or appointments.
- Automation drafts; the admin approves. Nothing reaches users unapproved.
- Recalls come from the NHTSA public API (US market). Matched on make, model and model year only. No VIN in this version.
- Recall wording is always "found for this model year in the US; confirm with your Mazda dealer", never "your car is affected".
- Safety-critical items (brakes, tyres, steering) never show "safe to skip"; conflicting sources resolve to Inspect.

## Out of scope

VIN matching, live dealer data, scraping dealer sites, auto-approval of anything, push notifications, new user input fields.

## 1. Intake (server, automatic)

- Scheduled job (weekly) and an admin "refresh now" button, per `approved` row in `car_models`.
- Recalls: fetch `recallsByVehicle` per model and year, store in `recalls` (campaign number, component, summary, remedy, fetched_at). A campaign number already approved is not re-queued.
- Schedule: the admin registers source URLs once per model (`schedule_sources`: car_model_id, url, kind). The job fetches each, hashes the content, and only when the hash changes extracts a draft.
- Extraction is an Edge Function using the `read-bill` pattern: pure logic in `logic.mjs` (whitelist clamps, fixed schema, bounded numbers, `temperature: 0`), `index.ts` for I/O, service-role writes only, per-day global cap, kill switch by unsetting the API key.
- Output goes to the existing `dealer_plan_items` / `dealer_plan_changes` flow as a `draft`, never over a live row.

## 2. Admin review (the only manual step)

- New "Review queue" tab on the admin page.
- Each draft is a diff against the live item (interval km, months, parts, note), with the source link and a plain-language reason.
- Actions: Approve, Edit then approve, Reject. Approving bumps `plan_updated_at` (existing trigger) so devices re-apply the plan.
- Recalls are queued the same way and show only after approval. The banner appears on the Dashboard for the matching model and year.
- Admin only (existing role check in RLS); every decision logged in `dealer_plan_changes`.

## 3. Recommendation card (client)

For each schedule item, a pure function `guidance(item, history, community)` returns `{ action, reason }`:

| Inputs | Result |
|---|---|
| Not yet due by km or months | OK |
| Due or overdue, no community data | Replace (dealer interval alone) |
| Past community median life, repair share >= 50% and curated tip exists | Repair first, then replace |
| Community "needs attention" rate >= 30% at this mileage band | Inspect |
| Sources disagree, or item is safety-critical and overdue | Inspect |

- Uses existing `brand_life` and `repair_stats` (5-qualified-user floor). Below the floor the card falls back to the dealer interval and says so.
- No new user input: history, odometer and plan already exist.
- English and Arabic strings; all dynamic text via `textContent`.

## 4. Data

New tables, all RLS on: `schedule_sources`, `recalls`. Extra column on `dealer_plan_items` for `severity` (normal | severe) so the card can pick the schedule from the user's own history later.

## 5. Risks

- An extracted interval can be wrong. The diff view and the admin gate are the guard; the extractor is not trusted.
- NHTSA covers US cars; a GCC-spec car may differ. Mitigated by the wording rule, not eliminated.
- Model cost: one call per changed source hash, plus a global daily cap.
- Source pages change format. Extraction fails closed to "no draft", never to a partial draft.
- The Edge Function cannot be run locally (no Deno); only `logic.mjs` is unit-tested. Live checks come last.

## 6. Testing

- Unit: extraction clamping and schema, recall mapping, the `guidance()` decision table (one test per row, plus the safety-critical rule), diff rendering as text not markup.
- SQL: RLS (admin-only writes, drafts invisible to users), approved-campaign de-duplication.
- Live (last): one real source URL end to end, one recall fetch, review-queue approve and reject.

## 7. As built (corrections to the sections above)

- Drafts live in a new `plan_drafts` table, not as a `draft` status on `dealer_plan_items` (that table has no status column; `status` exists only on `car_models`). `decide_plan_draft` (admin-only RPC) applies an approval and clamps intervals; the existing trigger logs it and bumps `plan_updated_at`.
- The weekly job is pg_cron + pg_net calling `plan-intake` with an `x-cron-secret`; the admin button calls it with the admin's JWT.
- Model years come from the seeded `car_models.generation` text ("BM/BN · 2014–18", "BP · 2019+"); NHTSA model name is `mazda` + number for numeric models (`mazda3`), else the model name as is.
- `guidance.decide` returns a fixed translatable `reason` plus a separate number `n`.
- The `severity` column and automatic severe-schedule selection are not built.
- `recalls.forModel` filters `status = 'approved'` on the client as well as in RLS, because admins can read pending rows.
- Owner wording and threshold approval (blocks release): NOT YET GIVEN. Record the date here once `REPAIR_SHARE = 50`, `ATTENTION_RATE = 30`, `MIN_INSPECTIONS = 3` and every new English/Arabic string are approved.
- Extraction model `claude-sonnet-5-5` (`INTAKE_MODEL`): unverified until one real call works.
- Community lookup is one cached query per model (`getModelBrandLife`, `getModelRepairStats`); a service name matches community item keys by whole phrase (`guidance.matchRows`: "engine oil" matches "engine oil 0w-20", not "oil filter"). Names that never match stay on the "Mazda schedule only" line.
- A source whose output cannot be parsed is not re-sent to the model until its content changes (clear `content_hash` to force). Source hosts must resolve to public addresses (`isPrivateIp`); a rebinding race between that check and the fetch remains.
