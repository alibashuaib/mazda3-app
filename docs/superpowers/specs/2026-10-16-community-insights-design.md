# Community insights — parts, services and fuel economy

## Goal

Signed-in owners' anonymous history feeds shared per-model statistics, so every
owner can see what others of the same model buy, from which store, at what
price, how long it lasts, and what fuel economy to expect — and use that to
predict the next service or part and to buy better value.

Extends the existing crowdsourced price averages
(`2026-09-10-crowdsourced-price-averages-design.md`); does not replace it.

## Decisions (agreed)

- Scope: prices, brands/part numbers, stores, replacement intervals (km), fuel economy.
- Contribution is **automatic and on by default**, with a clear notice and an off switch.
- Shops are a **shared database** (name + city + area) created by users, scored by user feedback. Still no shop accounts.
- Trust feedback is **thumbs up/down** after a purchase, with optional reason tags. Bill-backed feedback counts more.
- Prediction is computed **on the client** from server-side aggregates.
- Aggregates are hidden below **5 distinct contributors**, counting only *qualified* users (account at least 7 days old with a confirmed email or phone; defined once in `public.qualified_users`). Unqualified data is kept but stays out of aggregates until the account qualifies.
- Data can come from an uploaded bill, read on the server, always confirmed by the user before saving (section 5).
- Store location is city + area only, taken from the bill or a picker. No device GPS.
- Repair vs replace: records carry an `action` (replaced | repaired). A short curated list of commonly repairable parts gives day-one guidance; community numbers take over once the 5-user floor is met.
- Quality = km a brand lasts before replacement. Value = price per 1,000 km.

## Out of scope

Shop accounts, replies, listings, star ratings and written reviews, nightly precompute
job (revisit if view queries get slow), per-user rankings.

## 1. Data

`contributions` (shared table, insert via sync, no user id on the row):

| column | notes |
|---|---|
| kind | `fuel` \| `part` \| `service` |
| model_id | catalogue id, e.g. `mazda3bm`; engine code alongside |
| odometer_band | floor to 5,000 km |
| month | `YYYY-MM`, no day |
| fuel: `l100`, `price_per_l` | only from a closed full-to-full interval (see `fuelRows()`) |
| part/service: `action` (`replaced`\|`repaired`), `item_id`, `brand`, `part_no`, `price`, `store_norm`, `city`, `area`, `km_since_prev` | `km_since_prev` null when no earlier replacement known |

Never sent: user id, vehicle id, nickname, notes, photos, exact dates or odometer.

`contribution_links` (private): `(user_id, source_key) -> contribution_id`, own-row
RLS only, never read by any view except to count distinct users. Used for
idempotent upserts and for deleting a user's rows on opt-out/account deletion.

`store_norm` is replaced by `shop_id` (below). Normalisation (lower-case, trim,
collapse whitespace, strip punctuation) is used only for shop matching.

### Shops

`shops` (shared, read by all signed-in users, insert-only like `price_items`):
`id`, `name`, `name_norm`, `city`, `area`, `created_at`, plus a hidden `created_by`.
`name_norm` is set by a server trigger from `name` (the client value is ignored);
each user may add at most 10 shops per 24 hours. Unique on
`(name_norm, city)`; find-or-create in the client resolves races on the unique
violation, as `pricing.js` does. No update/delete policy, so no vandalism of
existing shops.

`shop_feedback`: `shop_id`, `user_id`, `vote` (+1/-1), `reasons` (price, quality,
honest, fast), `bill_backed` bool, `created_at`. One vote per user per shop (upsert
on `(shop_id,user_id)`); a user can change or delete their own vote.

## 2. Aggregates

`security_invoker` views, same pattern as `price_item_averages`:

- `fuel_stats` — median/p25/p75 `l100` per model, engine, odometer band.
- `parts_stats` — per model + item: median price, top brands and part numbers by share.
- `brand_life` — per model + item + brand: median/p25/p75 `km_since_prev`, median price, value = price / median life x 1000.
- `shop_trust` — per shop: `up`, `down`, distinct voters, weighted score (bill-backed vote = 2, unbacked = 1), top reasons. Shown only at >= 5 distinct voters; a shop is labelled "Trusted" when score share >= 80%.
- `repair_stats` — per model + item: share repaired vs replaced, median cost of each, median `km_since_prev` after a repair. Same 5-user floor.
- `store_prices` — per model + item + shop + city: median price, sample count. Client shows the user's own city first ("cheapest in Jeddah").

Every row requires `count(distinct user)` >= 5, counted via `contribution_links`;
rows below it are not returned.

## 3. Sync and consent

- After a local save, the existing sync queue enqueues anonymised contributions
  (new function in `account.js`/new `insights.js` beside `pricing.js`). Skipped when sharing is off.
- First load after update shows a one-time notice: "Your anonymous car data now
  helps other owners. Turn off in Settings." Stored as a flag in storage meta.
- Settings toggle. Turning off stops uploads and deletes the user's contributions
  via `contribution_links`. Account deletion cascades.

## 4. Client

- `insights.js` (dual-mode like `pricing.js`): `getFuelStats`, `getPartStats`,
  `getBrandLife`, `getStorePrices`, pure `predictNext(lastKm, nowKm, life)`.
- Parts / Maintenance: per part, "Others replace every 45–60k km; you're at 52k",
  most-used brand, cheapest and best-value store.
- Fuel: "Yours 7.8 L/100 km vs 8.4 typical for your model", expected figure at the
  current odometer band.
- Repair hint: on a part in the curated list, show its one-sentence guidance ("Often repairable: headlight restoration costs a fraction of replacement") labelled as general guidance, not a diagnosis. Once `repair_stats` clears the floor, show the community numbers instead ("38% of owners repaired this; median SAR 120 vs 540 to replace").
- Below the 5-user minimum or offline: "Not enough data yet", nothing else.
  No insight ever blocks or delays a local save.

## 5. Bill reading and shop entry

- With a bill: after confirm, the shop on the bill is matched to `shops` by
  `(name_norm, city)`, or created if absent.
- Without a bill: the user types the shop name (autocomplete from `shops`) and
  picks city/area. Matched or created the same way.
- After saving a purchase, one tap asks "Would you buy from this shop again?"
  (thumbs up/down + optional reason). Skippable. `bill_backed` is true when the
  purchase came from a confirmed bill.

### Bill reading

- The existing bill/receipt photo upload gets a "Read bill" action. The photo is
  sent to a Supabase Edge Function that calls a Claude vision model and returns
  structured fields: items (name, brand, part no, price), total, store name, store
  address -> `city` and `area`, odometer, date.
- The result **prefills** the existing part/service form. Nothing is saved or
  contributed until the user reviews and taps save (no fully automatic path).
- If the bill has no address, the form asks for city and area from a picker
  (`city` list, `area` free text, normalised like `store_norm`).
- Only the confirmed form fields enter `contributions`. The photo, customer
  name, phone, plate and payment details are never stored in the shared pool.
- Limits: signed-in users only, a per-user daily cap, unreadable bills fall back to
  the manual form. Arabic and English bills must both be tested.
- Cost: one model call per bill; the cap bounds it.

## 6. Repairable parts

- `src/data/repairable.js`: a static list `{ item, tipEn, tipAr }`, a handful of
  commonly repairable items (headlight restoration, windscreen chip, dents/paintless
  dent repair, alloy-wheel refinishing, A/C recharge vs compressor, etc.). Written
  once, reviewed by the owner for accuracy before release. Unit test checks every
  entry has both languages.
- The part/service form gets a Replaced / Repaired selector. The bill reader sets it
  when the bill wording says repair; the user can change it before saving.
- Non-expert framing: the hint is shown whenever a part in the list is viewed or
  added, so an owner sees the cheaper option before buying a replacement.

## 7. Privacy

Opt-out default is a deliberate choice, mitigated by the notice and a working
off switch that also erases past data. Odometer is banded and dates are month-only
to limit re-identification; the 5-user floor is applied per row, so rare
model/part/store combinations stay hidden. Arabic strings added for all new text. Location is store city/area only; the user's own location is never collected.

## 8. Testing

- Unit: anonymise/band/normalise functions, `predictNext`, consent flag and toggle,
  opt-out deletion request, no-data rendering.
- E2E: notice appears once; toggle off stops uploads.
- Unit: `action` field default and bill-reader mapping, repairable list completeness, repair-hint vs community-numbers switch at the floor.
- Unit: shop name normalisation and find-or-create race, trust score weighting and thresholds, one-vote-per-user.
- Unit: bill-reading response parsing and form prefill, city/area normalisation, daily cap.
- SQL (needs a live Supabase project, same as pending Phase 5a checks): RLS,
  5-user floor, security_invoker behaviour, opt-out delete.

## Risks

- Cold start: most screens show "Not enough data yet" until enough users join.
- Free-text part names and stores fragment the data; mitigated by `item_id`
  (existing canonical list) and `store_norm`, not eliminated.
- Bill-reading accuracy on handwritten or low-quality bills; the confirm step is the guard.
- Fake accounts: the qualified-user rule (7 days + confirmed contact) makes mass sign-ups slower and costlier but does not stop patient or real-contact sybils; mitigated, not eliminated.
- Gaming: a shop (or rivals) voting itself up or others down. Mitigated only by the 5-voter floor, bill-backed weighting and one vote per user; only qualified users (7 days old, confirmed email or phone) count toward aggregates; real moderation (report/flag) is not in this version.
- The curated repairable list is general guidance and can be wrong for a specific car; wording must not read as a diagnosis, and the owner must approve it.
- Duplicate shops with spelling variants slip past exact matching; a merge tool is not in this version.
