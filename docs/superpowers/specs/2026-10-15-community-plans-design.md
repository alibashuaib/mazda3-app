# Shared car catalogue, dealer plans and community plans

Date: 2026-10-15 · Status: design approved in chat, awaiting spec review

## Summary

The app hosts a shared catalogue of cars, each with an admin-approved
**dealer plan** (manufacturer schedule + parts, warranty-safe). Users keep
their own private garage and log their own service. The system learns from
all garages and from online owner communities to build a **community plan**
per car and climate zone, which users can follow — by default once their
warranty ends. After approving a car once, the admin only steps in when
something needs correcting.

## Goals

- Every new car gets a manufacturer schedule and parts list the admin
  approved, so following it keeps the warranty valid.
- After the warranty, users get a community plan built from what real
  owners of the same car, in the same climate, actually do.
- The community plan improves on its own as more garages log service.
- Admin work is limited to: approving drafts, reviewing held items,
  correcting mistakes.

## Non-goals (v1)

- Email or push notifications to the admin (badge only; email later).
- Admin UI for assigning roles (set once by hand in Supabase).
- Shop recommendations or part prices per country (country is stored so
  this can come later; price averages already exist separately).
- Non-Mazda brands are not excluded by design, but the seed data and
  auto-draft prompt target Mazda first.

## Decisions

### A plan belongs to model + generation + engine
The two CX-5 KF engines take different oil volumes and parts. Mixing their
data would give wrong advice, so every dealer plan, community plan, tip and
request keys on one `car_models` row, which is model + generation + engine.

### Dealer plan: one per car, no region
Manufacturer schedules are the same everywhere for a given car.

### Community plan: per car + climate zone, with worldwide fallback
The user picks a **country**; the app maps it to a **climate zone**
(hot-dry, hot-humid, temperate, cold). Community plans are computed per
car + zone. An item is published for a zone only when ≥5 garages in that
zone support it; otherwise the worldwide result for that car is shown,
labelled "based on owners worldwide". Country is stored on the garage for
future local tips.

### Which plan a user follows
- Under warranty: the dealer plan, marked "Warranty-safe". Community items
  for the user's zone appear underneath as optional extras ("Add to my plan").
- Warranty ends (years or km, whichever first): the app asks **once**
  "Your warranty has ended. Switch to the community plan?" The user can
  switch either way at any time in Settings.
- Choosing the community plan while under warranty shows a warning that
  skipping dealer items may void the warranty.

### Users can override intervals per item
A user's interval for an item overrides the plan for their car only and
survives plan updates. On the dealer plan, shortening is allowed silently;
lengthening during the warranty shows a warning. Overridden intervals still
feed the community data — real behaviour is what the community plan learns.

### Community data: shared by default, opt-out
At sign-up the app explains that service logs are shared anonymously to
improve community plans; a setting turns it off. Opted-out garages are
excluded from every aggregate. Users only ever see per-car-per-zone totals,
never another user's rows, and nothing shows below 5 garages.

### New cars come from user requests, auto-drafted, admin-approved
A user who can't find their car taps "Request this car". A server function
uses Claude with web search to draft the manufacturer schedule, warranty
terms and parts (with part numbers), every item carrying its source link.
Duplicate requests join the existing draft. Nothing reaches users until the
admin approves. Meanwhile the user's car sits in their garage as
"Pending plan" and they can log service by hand; on approval the plan
attaches and the user sees "Your plan is ready".

### Online tips publish automatically, with a safety rule
A weekly server function per car searches owner forums and communities,
drafting tips with source links, tagged with a climate zone when the source
is clearly local. Tips publish automatically, marked "community"; the admin
can hide any tip. **Safety rule:** any tip or community pattern that
contradicts the dealer plan for a car still under warranty (e.g. a longer
oil interval) is held for admin review instead of published.

### Everything in Supabase; admin screens inside the existing app
No second codebase or host. Admin screens are a hidden tab shown only to
`role = 'admin'`. Server functions (Supabase Edge Functions) hold the
Claude API key and the service credentials; neither ships to the browser.
Aggregation is a nightly `pg_cron` SQL job.

### `catalog.js` stays as the offline fallback
Today's 16 hard-coded models are seeded as the first approved rows. The
file remains the fallback for a fresh install before its first sync and for
`file://` use.

## Data model

New tables (all in `supabase/schema.sql`, idempotent like the rest):

| Table | Key columns | Writers |
|---|---|---|
| `profiles` | `user_id`, `role` (`user`/`admin`), `share_community` (bool, default true) | user edits `share_community`; `role` server-only |
| `car_models` | `id`, `make`, `model`, `generation`, `engine`, `oil_capacity_l`, `paints` (jsonb), `warranty_years`, `warranty_km`, `status` (`draft`/`approved`), `sources` (jsonb) | admin; drafts by server function |
| `dealer_plan_items` | `car_model_id`, `service`, `interval_km`, `interval_months`, `parts` (jsonb: name, part_no, qty), `source_url` | admin only; locked once approved except by admin edit |
| `dealer_plan_changes` | `car_model_id`, `item_id`, `before`, `after`, `changed_by`, `changed_at` | trigger on `dealer_plan_items` |
| `community_plan_items` | `car_model_id`, `zone` (null = worldwide), `service`, `typical_km`, `typical_months`, `common_parts` (jsonb), `garage_count`, `held` (bool) | nightly job only |
| `community_tips` | `car_model_id`, `zone` (nullable), `text`, `source_url`, `origin` (`owners`/`online`), `hidden`, `held` | weekly function; admin sets `hidden`/clears `held` |
| `car_requests` | `user_id`, `make`, `model`, `year`, `engine`, `car_model_id` (draft), `status` (`pending`/`drafted`/`approved`/`rejected`) | user inserts; server/admin update |
| `country_zones` | `country`, `zone` | admin (seeded) |

Changes to existing data:
- Each vehicle's `data` jsonb (in `vehicles`) gains `catalogId`, `plan`
  (`dealer`/`community`), `country`, `warrantyStart` (purchase date),
  `odometerAtStart`, `intervalOverrides` ({ service: { km, months } }),
  and `warrantyPromptShown`. `normalize.js` heals older rows to defaults.
- Access rules: catalogue and plan tables are readable by any
  authenticated user for `approved` rows; writes as listed above, enforced
  by RLS keyed on `profiles.role`. `vehicles`/`garage` RLS is unchanged.
- The nightly job runs as a `security definer` function, the only path
  that reads across users' `vehicles`.

## App-side flow

1. **Add car:** pick model/generation/engine from the cached approved
   catalogue; enter country, purchase date, current odometer. Dealer plan
   applies at once.
2. **Missing car:** "Request this car" → car added as "Pending plan" with
   manual logging → plan attaches on approval.
3. **Dashboard:** due items come from the active plan, with the user's
   overrides applied. Under warranty, community extras for the user's zone
   are listed as optional.
4. **Warranty end:** one-time prompt (see Decisions).
5. **Plan updates:** an admin correction or a nightly refresh recomputes
   upcoming due dates. Logged history never changes.
6. **Admin tab** (admin only, badge shows count waiting): draft queue with
   per-item sources, inline edit, approve/reject; dealer-plan editor with
   change history; held tips and held community items; hide/unhide tips.

## Offline

The device caches the approved catalogue plus dealer and community plans
for the user's own cars, refreshed on sync. Plan screens work with no
network. `catalog.js` covers a brand-new install until the first sync.

## Testing

- Unit (node --test): warranty end (years vs km, whichever first), active
  plan selection, override precedence and warnings, the 5-garage threshold,
  worldwide fallback, the safety rule, country→zone mapping, normalize
  healing of old vehicle rows.
- Database: RLS test that a non-admin cannot write catalogue/plan tables,
  cannot read another user's `vehicles`, and cannot change `role`.
- Existing 450 unit and 24 e2e tests stay green.

## Build order

Each phase is usable on its own and gets its own implementation plan.

1. **Catalogue + roles + admin screen:** tables, RLS, seed from
   `catalog.js`, admin approve/edit with change history, app reads
   catalogue with offline cache.
2. **Requests + auto-draft:** request flow, "Pending plan" cars, Edge
   Function drafting with Claude + web search, admin queue.
3. **Warranty + plan choice + overrides:** new vehicle fields, warranty
   prompt, switching, per-item overrides and warnings.
4. **Nightly community plan:** aggregation per car + zone, threshold,
   fallback, opt-out, held conflicts.
5. **Weekly online tips:** Edge Function, zone tagging, hide, safety rule.

## Open dependency

Phases 1–5 all need the live Supabase project (still `REPLACE_ME` in
`src/data/account.js`), which brings that step forward from "last before
launch". Phase 1's schema, seed and app code can be built and unit-tested
before the project exists; Phases 2 and 5 also need an Anthropic API key
stored as an Edge Function secret.
