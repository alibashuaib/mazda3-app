# Phase 5a — Shared catalogue, roles and admin screen: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the dealer service plans into Supabase as an admin-approved shared catalogue, add user/admin roles, and give the admin an in-app screen to approve and correct plans, with every change logged.

**Architecture:** Three new tables (`profiles`, `car_models`, `dealer_plan_items`) plus a change log, guarded by RLS keyed on a `public.is_admin()` function. Today's `catalog.js` is the seed (generated SQL) and stays the offline fallback. Two new dual-mode modules: `remote-catalog.js` (read, cache in storage meta, apply a plan to a car) and `admin.js` (admin writes). A new `admin` route renders the editor.

**Tech Stack:** Vanilla JS (no build step), Supabase (Postgres + RLS), `node --test`, linkedom boot harness, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-community-plans-design.md` (Phase 1 of its Build order).

## Global Constraints

- No build step, no new runtime dependencies. Every module is dual-mode (plain `<script>` in the browser, `require()` in Node), like `src/data/pricing.js`.
- Every new browser script goes in `index.html`, `test/helpers/boot.js` `SCRIPTS` (same order) and `sw.js` `ASSETS`, and `sw.js` `CACHE` is bumped by one — `test/precache.test.js` and the boot harness fail otherwise.
- All markup goes through the `html` tagged template (`test/no-raw-templates.test.js` polices `src/pages`).
- `supabase/schema.sql` stays idempotent (`if not exists`, `drop policy if exists`, `create or replace`).
- Never ship the service-role key to the browser. RLS is the security boundary; hiding the admin page is convenience only.
- Write is admin-only on `car_models`, `dealer_plan_items`; `role` is never user-editable.
- `catalog.js` remains the fallback; the app must work fully with no Supabase project (`REPLACE_ME`), offline, and on `file://`.

## Deviations from the spec (flag to the user at review)

1. **Anonymous read of the approved catalogue.** The spec says "readable by any authenticated user". The sign-in UI is currently hidden, so most users are anonymous; approved plans are public information. Policies grant `select` on approved rows to `anon` too.
2. **Seeded cars have no parts and no warranty terms.** `catalog.js` keeps parts per model, not per service, and holds no warranty data. Seeded `dealer_plan_items.parts` is `[]` and `warranty_years/km` are null; the admin fills them in the editor. Parts in the app's Parts page keep coming from `catalog.js` in this phase.
3. **User-edited dealer intervals.** Full per-item overrides are Phase 3. Until then a car only takes a plan change that is *newer* than the version it last saw, and a car seeing the catalogue for the first time is only stamped, not changed — so the seed never overwrites a hand-edited "Dealer interval".
4. **Admin needs one car in their garage** to reach the admin route (the router sends an empty garage to onboarding).

## Review Focus

- **Offline or no project:** refresh fails → the last cached catalogue keeps working and nothing throws. Pinned in Task 4 (`refresh error keeps previous cache`) and Task 6 (existing suite stays green with no client).
- **Hand-edited dealer interval:** the first catalogue sight must not overwrite it. Pinned in Task 4 (`first sight only stamps the version`).
- **Non-admin writes:** must be refused by the database, not just hidden. Pinned in Task 3 (static policy test + manual RLS script).
- **Blank / malformed admin input:** empty interval → `null`, negative or text → `null`, blank parts lines skipped, missing qty → 1. Pinned in Task 5.
- **Seed drift:** `catalog.js` changes but `seed-catalogue.sql` isn't regenerated. Pinned in Task 2 (`committed seed is up to date`).

---

## File structure

| File | Responsibility |
|---|---|
| `src/data/catalog.js` (modify) | add `catalogId(modelId, engineName)` |
| `src/data/normalize.js` (modify) | stamp/heal `car.catalogId` |
| `tools/seed-catalogue.js` (create) | generate seed rows + SQL from `catalog.js` |
| `supabase/seed-catalogue.sql` (generated) | seed for the 16 models |
| `supabase/schema.sql` (modify) | Phase 5a tables, triggers, RLS |
| `supabase/tests/catalogue-rls.sql` (create) | manual RLS check against a live project |
| `src/data/remote-catalog.js` (create) | read, cache, apply dealer plan |
| `src/data/admin.js` (create) | admin role check + writes + pure input helpers |
| `src/pages/admin.js` (create) | admin route UI |
| `main.js`, `src/ui/chrome.js`, `index.html`, `sw.js`, `test/helpers/boot.js`, `styles.css`, `src/i18n/strings.ar.js` (modify) | wiring |
| `docs/superpowers/verification/2026-08-22-sync-manual.md` (modify) | live-project steps |

---

### Task 1: `catalogId` and stamping it on cars

**Files:**
- Modify: `src/data/catalog.js` (new function before the final `return {`, add to the export list)
- Modify: `src/data/normalize.js` (`buildProfile` car object; `normalizeData` right after the `if (!dep.CAR_MODELS.some(...)) { ... }` block)
- Test: `test/catalog.test.js`, `test/normalize.test.js`

**Interfaces:**
- Produces: `catalogId(modelId: string, engineName: string) → string`, e.g. `'cx5kf:2.5l-skyactiv-g'`. Every vehicle `data.car.catalogId` is set for known models.

- [ ] **Step 1: Write failing tests** — append to `test/catalog.test.js`:

```js
test('catalogId joins the model id and a slug of the engine name', () => {
  assert.strictEqual(cat.catalogId('cx5kf', '2.5L SkyActiv-G'), 'cx5kf:2.5l-skyactiv-g');
});

test('catalogId is unique across every model and engine', () => {
  const ids = cat.CAR_MODELS.flatMap(m => m.engines.map(e => cat.catalogId(m.id, e[0])));
  assert.strictEqual(new Set(ids).size, ids.length);
});
```

Append to `test/normalize.test.js`:

```js
test('buildProfile stamps the catalogue id of the chosen model and engine', () => {
  const s = buildProfile('cx5kf', 0, { odometer: 0 });
  assert.strictEqual(s.car.catalogId, 'cx5kf:' + s.car.engine.toLowerCase().replace(/[^a-z0-9.]+/g, '-'));
});

test('normalizeData heals a missing catalogId on a known model', () => {
  const s = buildProfile('mazda3bm', 0, { odometer: 0 });
  delete s.car.catalogId;
  assert.ok(normalizeData(s).car.catalogId.startsWith('mazda3bm:'));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/catalog.test.js test/normalize.test.js`
Expected: FAIL — `cat.catalogId is not a function` / `catalogId` undefined.

- [ ] **Step 3: Implement** — in `src/data/catalog.js`, before `return {`:

```js
/* Stable key for one catalogue entry: model + engine. The server's
   car_models.id is the same string, so a garage car and its shared plan
   meet without a lookup table. */
function catalogId(modelId, engineName) {
  return modelId + ':' + String(engineName || '').toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
}
```

Add `catalogId` to the returned object (after `DEFAULT_COLOR, MAZDA_PAINTS, CAR_MODELS, NORMAL_SCHED, ATF_NOTE,`).

In `src/data/normalize.js` `buildProfile`, add to the `car:` object after `engine,`:

```js
catalogId: dep.catalogId(m.id, engine),
```

In `normalizeData`, immediately after the `if (!dep.CAR_MODELS.some(m => m.id === s.car.modelId)) { ... }` block closes:

```js
    if (!s.car.catalogId && s.car.engine && dep.CAR_MODELS.some(m => m.id === s.car.modelId))
      s.car.catalogId = dep.catalogId(s.car.modelId, s.car.engine);
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: all tests pass (450 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/data/catalog.js src/data/normalize.js test/catalog.test.js test/normalize.test.js
git commit -m "Stamp a catalogue id on every car"
```

---

### Task 2: Seed generator

**Files:**
- Create: `tools/seed-catalogue.js`
- Create (generated): `supabase/seed-catalogue.sql`
- Test: `test/seed-catalogue.test.js`

**Interfaces:**
- Consumes: `catalogId`, `CAR_MODELS`, `skyactivServices`, `engineInfo`, `NORMAL_SCHED` from `catalog.js`.
- Produces: `catalogueRows() → { models: Row[], items: Row[] }`, `seedSql(rows) → string`. Row shapes match the Task 3 columns.

- [ ] **Step 1: Write failing test** — `test/seed-catalogue.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cat = require('../src/data/catalog.js');
const { catalogueRows, seedSql } = require('../tools/seed-catalogue.js');

test('one approved car_models row per model and engine', () => {
  const { models } = catalogueRows();
  const expected = cat.CAR_MODELS.reduce((n, m) => n + m.engines.length, 0);
  assert.strictEqual(models.length, expected);
  assert.ok(models.every(m => m.status === 'approved'));
});

test('every car has a dealer plan with usable intervals', () => {
  const { models, items } = catalogueRows();
  for (const m of models) {
    const mine = items.filter(i => i.car_model_id === m.id);
    assert.ok(mine.length > 5, `${m.id} has no plan`);
    assert.ok(mine.every(i => i.interval_km > 0 && i.interval_months > 0), `${m.id} has an empty interval`);
  }
});

test('dealer intervals use the dealer sheet where it has one', () => {
  const { items } = catalogueRows();
  const oil = items.find(i => i.service === 'Engine Oil & Filter');
  assert.deepStrictEqual([oil.interval_km, oil.interval_months], cat.NORMAL_SCHED['Engine Oil & Filter']);
});

test('the committed seed file is up to date with catalog.js', () => {
  const committed = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'seed-catalogue.sql'), 'utf8');
  assert.strictEqual(committed, seedSql(catalogueRows()),
    'run: node tools/seed-catalogue.js');
});

test('seedSql refuses data containing its own quote tag', () => {
  assert.throws(() => seedSql({ models: [{ id: '$seed$' }], items: [] }), /quote tag/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/seed-catalogue.test.js`
Expected: FAIL — `Cannot find module '../tools/seed-catalogue.js'`.

- [ ] **Step 3: Implement** — `tools/seed-catalogue.js`:

```js
#!/usr/bin/env node
/* Regenerates supabase/seed-catalogue.sql from src/data/catalog.js, so the
   16 built-in models become the first approved rows of the shared
   catalogue. Run after any catalog.js change:
     node tools/seed-catalogue.js
   test/seed-catalogue.test.js fails while the committed file is stale. */
'use strict';
const fs = require('fs');
const path = require('path');
const cat = require('../src/data/catalog.js');

function catalogueRows() {
  const models = [], items = [];
  for (const m of cat.CAR_MODELS) {
    for (const [engine, oilL] of m.engines) {
      const id = cat.catalogId(m.id, engine);
      models.push({ id, make: 'Mazda', model: m.model, generation: m.gen, engine,
        oil_capacity_l: oilL, paints: m.colors || [], status: 'approved' });
      cat.skyactivServices(oilL, cat.engineInfo(m.id, engine)).forEach((s, i) => {
        // The dealer sheet's "normal" interval where it has one; otherwise the
        // built-in interval is the only figure the app has.
        const normal = cat.NORMAL_SCHED[s.name];
        items.push({ car_model_id: id, service: s.name, icon: s.icon, category: s.cat,
          interval_km: normal ? normal[0] : s.intervalKm,
          interval_months: normal ? normal[1] : s.intervalMonths,
          note: s.note || '', sort: i });
      });
    }
  }
  return { models, items };
}

/* Dollar-quoted JSON fed through jsonb_to_recordset: no per-value escaping
   to get wrong. `on conflict do nothing` keeps admin edits on a re-run. */
function seedSql({ models, items }) {
  const m = JSON.stringify(models), it = JSON.stringify(items);
  if (m.includes('$seed$') || it.includes('$seed$')) throw new Error('seed data contains the $seed$ quote tag');
  return `-- GENERATED by tools/seed-catalogue.js from src/data/catalog.js. Do not edit.
-- Apply after schema.sql. Idempotent: existing rows are left alone, so admin edits survive a re-run.
insert into public.car_models (id, make, model, generation, engine, oil_capacity_l, paints, status)
select id, make, model, generation, engine, oil_capacity_l, paints, status
from jsonb_to_recordset($seed$${m}$seed$::jsonb)
  as r(id text, make text, model text, generation text, engine text, oil_capacity_l numeric, paints jsonb, status text)
on conflict (id) do nothing;

insert into public.dealer_plan_items (car_model_id, service, icon, category, interval_km, interval_months, note, sort)
select car_model_id, service, icon, category, interval_km, interval_months, note, sort
from jsonb_to_recordset($seed$${it}$seed$::jsonb)
  as r(car_model_id text, service text, icon text, category text, interval_km int, interval_months int, note text, sort int)
on conflict (car_model_id, service) do nothing;
`;
}

if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, '..', 'supabase', 'seed-catalogue.sql'), seedSql(catalogueRows()));
  console.log('wrote supabase/seed-catalogue.sql');
}

module.exports = { catalogueRows, seedSql };
```

- [ ] **Step 4: Generate and run**

Run: `node tools/seed-catalogue.js && node --test test/seed-catalogue.test.js`
Expected: `wrote supabase/seed-catalogue.sql`, then 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add tools/seed-catalogue.js supabase/seed-catalogue.sql test/seed-catalogue.test.js
git commit -m "Generate the catalogue seed from catalog.js"
```

---

### Task 3: Schema, triggers and RLS

**Files:**
- Modify: `supabase/schema.sql` (append a Phase 5a section at the end)
- Create: `supabase/tests/catalogue-rls.sql`
- Test: `test/schema-catalogue.test.js`

**Interfaces:**
- Produces tables `profiles(user_id, role, share_community)`, `car_models(id, make, model, generation, engine, oil_capacity_l, paints, warranty_years, warranty_km, status, sources, plan_updated_at)`, `dealer_plan_items(id, car_model_id, service, icon, category, interval_km, interval_months, note, parts, source_url, sort)`, `dealer_plan_changes(id, car_model_id, item_id, before, after, changed_by, changed_at)`; function `public.is_admin()`. `car_models.plan_updated_at` changes whenever any of that car's items change.

- [ ] **Step 1: Write failing test** — `test/schema-catalogue.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/* Static guard only — the real proof is supabase/tests/catalogue-rls.sql
   against a live project. This catches the cheap regressions: a table
   shipped without RLS, or a write policy that forgot the admin check. */
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

for (const t of ['profiles', 'car_models', 'dealer_plan_items', 'dealer_plan_changes']) {
  test(`${t} has row level security enabled`, () => {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
  });
}

test('every non-select policy on catalogue tables requires is_admin()', () => {
  const policies = [...sql.matchAll(/create policy (\w+) on public\.(car_models|dealer_plan_items|dealer_plan_changes)([\s\S]*?);/g)];
  assert.ok(policies.length >= 5, 'expected at least 5 catalogue policies');
  for (const [, name, , body] of policies) {
    if (/\bfor select\b/.test(body)) continue;
    assert.match(body, /public\.is_admin\(\)/, `${name} lets a non-admin write`);
  }
});

test('role is not user-editable', () => {
  assert.match(sql, /revoke update on public\.profiles from authenticated/);
  assert.match(sql, /grant update \(share_community\) on public\.profiles to authenticated/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/schema-catalogue.test.js`
Expected: FAIL — no `profiles` RLS line.

- [ ] **Step 3: Implement** — append to `supabase/schema.sql`:

```sql
-- ============================================================
-- Phase 5a: shared catalogue, roles, dealer plans.
-- Spec: docs/superpowers/specs/2026-10-15-community-plans-design.md
-- After this file, apply supabase/seed-catalogue.sql. Make yourself admin
-- once, by hand:  update public.profiles set role = 'admin' where user_id = '<your uuid>';
-- ============================================================

create table if not exists public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  role text not null default 'user' check (role in ('user', 'admin')),
  share_community boolean not null default true
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts that existed before this section.
insert into public.profiles (user_id) select id from auth.users on conflict do nothing;

-- security definer so policies can call it without granting profiles reads.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role = 'admin')
$$;

alter table public.profiles enable row level security;
drop policy if exists read_own_profile on public.profiles;
create policy read_own_profile on public.profiles for select using (user_id = auth.uid());
drop policy if exists update_own_sharing on public.profiles;
create policy update_own_sharing on public.profiles for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Column privileges: a user may flip share_community, never role.
revoke update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (share_community) on public.profiles to authenticated;

create table if not exists public.car_models (
  id text primary key,                      -- catalog.js catalogId(): '<modelId>:<engine-slug>'
  make text not null default 'Mazda',
  model text not null,
  generation text not null,
  engine text not null,
  oil_capacity_l numeric,
  paints jsonb not null default '[]',
  warranty_years int,
  warranty_km int,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  sources jsonb not null default '[]',
  plan_updated_at timestamptz not null default now()
);

create table if not exists public.dealer_plan_items (
  id bigint generated always as identity primary key,
  car_model_id text not null references public.car_models on delete cascade,
  service text not null,
  icon text not null default '🔧',
  category text not null default 'Engine',
  interval_km int,
  interval_months int,
  note text not null default '',
  parts jsonb not null default '[]',        -- [{ name, part_no, qty }]
  source_url text,
  sort int not null default 0,
  unique (car_model_id, service)
);

create table if not exists public.dealer_plan_changes (
  id bigint generated always as identity primary key,
  car_model_id text not null references public.car_models on delete cascade,
  item_id bigint,                           -- null: a change to the car itself
  before jsonb,
  after jsonb,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);

-- Item edits: log updates/deletes (inserts are the seed or a draft, not
-- corrections) and bump the car's plan version so devices re-apply it.
create or replace function public.on_dealer_plan_item_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare cm text;
begin
  if tg_op = 'DELETE' then cm := old.car_model_id; else cm := new.car_model_id; end if;
  if tg_op = 'UPDATE' then
    insert into public.dealer_plan_changes (car_model_id, item_id, before, after)
    values (cm, new.id, to_jsonb(old), to_jsonb(new));
  elsif tg_op = 'DELETE' then
    insert into public.dealer_plan_changes (car_model_id, item_id, before, after)
    values (cm, old.id, to_jsonb(old), null);
  end if;
  update public.car_models set plan_updated_at = now() where id = cm;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists dealer_plan_item_change on public.dealer_plan_items;
create trigger dealer_plan_item_change after insert or update or delete on public.dealer_plan_items
  for each row execute function public.on_dealer_plan_item_change();

-- Car edits (warranty, status). plan_updated_at is excluded from the
-- comparison, or every item edit above would also log a car change.
create or replace function public.on_car_model_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (to_jsonb(old) - 'plan_updated_at') is distinct from (to_jsonb(new) - 'plan_updated_at') then
    insert into public.dealer_plan_changes (car_model_id, item_id, before, after)
    values (new.id, null, to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end $$;

drop trigger if exists car_model_change on public.car_models;
create trigger car_model_change after update on public.car_models
  for each row execute function public.on_car_model_change();

-- Approved plans are public information: anon may read them too, because
-- the sign-in UI is hidden and most users are anonymous.
alter table public.car_models enable row level security;
drop policy if exists read_car_models on public.car_models;
create policy read_car_models on public.car_models for select to anon, authenticated
  using (status = 'approved' or public.is_admin());
drop policy if exists admin_write_car_models on public.car_models;
create policy admin_write_car_models on public.car_models for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.dealer_plan_items enable row level security;
drop policy if exists read_dealer_plan_items on public.dealer_plan_items;
create policy read_dealer_plan_items on public.dealer_plan_items for select to anon, authenticated
  using (exists (select 1 from public.car_models m
                 where m.id = car_model_id and (m.status = 'approved' or public.is_admin())));
drop policy if exists admin_write_dealer_plan_items on public.dealer_plan_items;
create policy admin_write_dealer_plan_items on public.dealer_plan_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.dealer_plan_changes enable row level security;
drop policy if exists admin_read_dealer_plan_changes on public.dealer_plan_changes;
create policy admin_read_dealer_plan_changes on public.dealer_plan_changes for select to authenticated
  using (public.is_admin());
revoke all on public.dealer_plan_changes from anon;
```

- [ ] **Step 4: Write the manual RLS check** — `supabase/tests/catalogue-rls.sql`:

```sql
-- Manual RLS check for Phase 5a. Run in the Supabase SQL editor after
-- schema.sql and seed-catalogue.sql. Replace NON_ADMIN_UUID and ADMIN_UUID
-- with two real accounts (the admin one already promoted). Every block
-- raises 'FAIL: ...' on a broken rule; finishing silently means pass.
-- Ends in ROLLBACK, so nothing it does persists.
begin;

insert into public.car_models (id, model, generation, engine, status)
values ('rls-test:draft', 'TEST', 'TEST', 'TEST', 'draft');

-- Non-admin
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"NON_ADMIN_UUID","role":"authenticated"}', true);

do $$ begin
  update public.dealer_plan_items set interval_km = 1 where id = (select min(id) from public.dealer_plan_items);
  if found then raise exception 'FAIL: non-admin updated a dealer plan item'; end if;
end $$;

do $$ begin
  begin
    insert into public.car_models (id, model, generation, engine) values ('rls-test:x', 'x', 'x', 'x');
    raise exception 'FAIL: non-admin inserted a car model';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$ begin
  begin
    update public.profiles set role = 'admin' where user_id = auth.uid();
    raise exception 'FAIL: non-admin changed their own role';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$ begin
  if exists (select 1 from public.car_models where id = 'rls-test:draft') then
    raise exception 'FAIL: non-admin can see a draft car'; end if;
  if exists (select 1 from public.dealer_plan_changes) then
    raise exception 'FAIL: non-admin can read the change log'; end if;
end $$;

-- Admin
select set_config('request.jwt.claims', '{"sub":"ADMIN_UUID","role":"authenticated"}', true);

do $$ declare n int; begin
  update public.dealer_plan_items set interval_km = interval_km where id = (select min(id) from public.dealer_plan_items);
  if not found then raise exception 'FAIL: admin could not update a dealer plan item'; end if;
  select count(*) into n from public.dealer_plan_changes;
  if n = 0 then raise exception 'FAIL: admin edit was not logged'; end if;
end $$;

rollback;
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all pass. (The SQL script is run by hand in Task 8.)

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql supabase/tests/catalogue-rls.sql test/schema-catalogue.test.js
git commit -m "Add catalogue, roles and dealer plan tables with admin-only RLS"
```

---

### Task 4: `remote-catalog.js` — read, cache, apply

**Files:**
- Create: `src/data/remote-catalog.js`
- Test: `test/remote-catalog.test.js`

**Interfaces:**
- Consumes: a Supabase client (`from(t).select(cols)[.eq(col, v)]` → `{ data, error }`), `metaGet() → Promise<object>`, `metaSet(patch) → Promise<bool>`.
- Produces (browser global `remoteCatalog`): `configure({ client, metaGet, metaSet })`, `reset()`, `load() → Promise<bool>`, `refresh() → Promise<bool>` (never rejects), `model(id) → row|null`, `dealerPlan(id) → item[]|null`, `applyDealerPlan(vehicleData, { force }?) → bool` (true when data changed and must be saved). Sets `data.car.planVersion`.

- [ ] **Step 1: Write failing tests** — `test/remote-catalog.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const rc = require('../src/data/remote-catalog.js');

const MODELS = [{ id: 'cx5kf:2.5l-skyactiv-g', model: 'CX-5', generation: 'KF', engine: '2.5L SkyActiv-G', plan_updated_at: 'v2' }];
const ITEMS = [
  { car_model_id: 'cx5kf:2.5l-skyactiv-g', service: 'Engine Air Filter', interval_km: 40000, interval_months: 24, sort: 3 },
  { car_model_id: 'cx5kf:2.5l-skyactiv-g', service: 'Engine Oil & Filter', interval_km: 9000, interval_months: 12, sort: 0 }
];

function fakeClient(opts) {
  opts = opts || {};
  return { from: table => ({ select: () => {
    const res = Promise.resolve(opts.error
      ? { data: null, error: { message: 'offline' } }
      : { data: table === 'car_models' ? MODELS : ITEMS, error: null });
    res.eq = () => res;
    return res;
  } }) };
}
function memMeta() {
  let meta = {};
  return { metaGet: () => Promise.resolve(meta), metaSet: p => { meta = Object.assign({}, meta, p); return Promise.resolve(true); }, peek: () => meta };
}
function car(planVersion) {
  return { car: { catalogId: 'cx5kf:2.5l-skyactiv-g', planVersion },
    services: [{ name: 'Engine Oil & Filter', normalKm: 10000, normalMonths: 12 }, { name: 'Wheel Alignment', normalKm: 20000 }] };
}

test.beforeEach(() => rc.reset());

test('refresh without a client resolves false', async () => {
  assert.strictEqual(await rc.refresh(), false);
});

test('refresh caches the catalogue in meta and serves plans in sort order', async () => {
  const meta = memMeta();
  rc.configure(Object.assign({ client: fakeClient() }, meta));
  assert.strictEqual(await rc.refresh(), true);
  assert.deepStrictEqual(rc.dealerPlan(MODELS[0].id).map(i => i.service), ['Engine Oil & Filter', 'Engine Air Filter']);
  assert.strictEqual(meta.peek().catalogue.models.length, 1);
});

test('refresh error keeps the previous cache', async () => {
  const meta = memMeta();
  rc.configure(Object.assign({ client: fakeClient() }, meta));
  await rc.refresh();
  rc.configure({ client: fakeClient({ error: true }) });
  assert.strictEqual(await rc.refresh(), false);
  assert.ok(rc.model(MODELS[0].id), 'cache was dropped');
});

test('load restores the cache from meta for offline use', async () => {
  const meta = memMeta();
  rc.configure(Object.assign({ client: fakeClient() }, meta));
  await rc.refresh();
  rc.reset();
  rc.configure(meta);
  assert.strictEqual(await rc.load(), true);
  assert.ok(rc.model(MODELS[0].id));
});

test('applyDealerPlan ignores a car not in the catalogue', async () => {
  rc.configure(Object.assign({ client: fakeClient() }, memMeta()));
  await rc.refresh();
  const d = car(undefined); d.car.catalogId = 'nope';
  assert.strictEqual(rc.applyDealerPlan(d), false);
});

test('first sight only stamps the version, keeping hand-edited intervals', async () => {
  rc.configure(Object.assign({ client: fakeClient() }, memMeta()));
  await rc.refresh();
  const d = car(undefined);
  assert.strictEqual(rc.applyDealerPlan(d), true);
  assert.strictEqual(d.car.planVersion, 'v2');
  assert.strictEqual(d.services[0].normalKm, 10000);
});

test('force applies the plan to a new car', async () => {
  rc.configure(Object.assign({ client: fakeClient() }, memMeta()));
  await rc.refresh();
  const d = car(undefined);
  rc.applyDealerPlan(d, { force: true });
  assert.strictEqual(d.services[0].normalKm, 9000);
});

test('a newer plan version applies; services the plan lacks are untouched', async () => {
  rc.configure(Object.assign({ client: fakeClient() }, memMeta()));
  await rc.refresh();
  const d = car('v1');
  assert.strictEqual(rc.applyDealerPlan(d), true);
  assert.strictEqual(d.services[0].normalKm, 9000);
  assert.strictEqual(d.services[1].normalKm, 20000);
  assert.strictEqual(rc.applyDealerPlan(d), false, 'same version must be a no-op');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/remote-catalog.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/data/remote-catalog.js`:

```js
/* ============================================================
   Garage — the shared catalogue, read side.
   Pulls approved car models and their dealer plans from Supabase, keeps a
   copy in storage meta for offline use, and applies a dealer plan's
   intervals to a vehicle. catalog.js stays the built-in fallback.

   Dual-mode, like pricing.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.remoteCatalog = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {

  const DEFAULTS = { client: null, metaGet: () => Promise.resolve({}), metaSet: () => Promise.resolve(true) };
  let env = Object.assign({}, DEFAULTS);
  let cache = null;   // { models, items, fetchedAt }

  function configure(next) { env = Object.assign({}, env, next || {}); }
  function reset() { env = Object.assign({}, DEFAULTS); cache = null; }

  function load() {
    return Promise.resolve(env.metaGet()).then(meta => {
      if (meta && meta.catalogue) cache = meta.catalogue;
      return !!cache;
    }).catch(() => false);
  }

  /* Never rejects: offline or an unconfigured project leaves the last good
     cache in place, which is the whole point of keeping one. */
  function refresh() {
    if (!env.client) return Promise.resolve(false);
    return Promise.all([
      env.client.from('car_models').select('id,model,generation,engine,warranty_years,warranty_km,plan_updated_at').eq('status', 'approved'),
      env.client.from('dealer_plan_items').select('car_model_id,service,icon,category,interval_km,interval_months,note,parts,sort')
    ]).then(([m, i]) => {
      if (!m || m.error || !i || i.error) return false;
      cache = { models: m.data || [], items: i.data || [], fetchedAt: new Date().toISOString() };
      return Promise.resolve(env.metaSet({ catalogue: cache })).then(() => true);
    }).catch(() => false);
  }

  function model(id) { return (cache && cache.models.find(m => m.id === id)) || null; }

  function dealerPlan(id) {
    if (!model(id)) return null;
    return cache.items.filter(x => x.car_model_id === id).sort((a, b) => a.sort - b.sort);
  }

  /* Writes a dealer plan's intervals onto a vehicle's services as
     normalKm/normalMonths — the fields the maintenance page already labels
     "Dealer". Matched by service name; services the plan doesn't list are
     left alone.

     Without `force`, a car seeing the catalogue for the first time is only
     stamped: the seed equals the built-in catalogue, and a dealer interval
     the user edited by hand must not be overwritten by a no-op. After that
     only a NEWER plan version applies. Per-item overrides that survive
     every update are Phase 3. Returns true when `data` changed. */
  function applyDealerPlan(data, opts) {
    const car = data && data.car;
    const m = car && model(car.catalogId);
    if (!m || car.planVersion === m.plan_updated_at) return false;
    if (!car.planVersion && !(opts && opts.force)) { car.planVersion = m.plan_updated_at; return true; }
    const byName = new Map(dealerPlan(m.id).map(x => [x.service, x]));
    (data.services || []).forEach(s => {
      const item = byName.get(s.name);
      if (!item) return;
      if (item.interval_km != null) s.normalKm = item.interval_km;
      if (item.interval_months != null) s.normalMonths = item.interval_months;
    });
    car.planVersion = m.plan_updated_at;
    return true;
  }

  return { configure, reset, load, refresh, model, dealerPlan, applyDealerPlan };
});
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/remote-catalog.test.js`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add src/data/remote-catalog.js test/remote-catalog.test.js
git commit -m "Read and cache the shared catalogue, apply dealer plans to cars"
```

---

### Task 5: `admin.js` — role check, writes, input helpers

**Files:**
- Create: `src/data/admin.js`
- Test: `test/admin.test.js`

**Interfaces:**
- Consumes: `account.user()` (from `src/data/account.js`), a Supabase client.
- Produces (browser global `catalogAdmin`): `configure({ client })`, `reset()`, `available() → bool`, `isAdmin() → Promise<bool>` (never rejects; caches), `knownAdmin() → bool`, `draftCount() → number`, `listModels() → Promise<row[]>`, `loadModel(id) → Promise<{ model, items, changes }>`, `saveWarranty(id, years, km)`, `saveItem(id, patch)`, `approve(id)`, and pure helpers `num(v)`, `parseParts(text)`, `formatParts(parts)`, `itemPatch(before, fields) → patch|null`, `describeChange(change) → string`. Writes reject on a Supabase error.

- [ ] **Step 1: Write failing tests** — `test/admin.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const admin = require('../src/data/admin.js');
const account = require('../src/data/account.js');

/* Chainable fake: every builder method returns the same thenable, which
   resolves to `result`. `calls` records what the module sent. */
function fake(result) {
  const calls = [];
  const client = { from: table => {
    const p = Promise.resolve(result);
    const c = { then: p.then.bind(p), catch: p.catch.bind(p) };
    ['select', 'eq', 'order', 'limit', 'maybeSingle'].forEach(k => { c[k] = (...a) => { calls.push([table, k, ...a]); return c; }; });
    c.update = patch => { calls.push([table, 'update', patch]); return c; };
    return c;
  } };
  return { client, calls };
}

test.beforeEach(() => { admin.reset(); account.setUserForTest(null); });

test('isAdmin is false when signed out', async () => {
  admin.configure({ client: fake({ data: { role: 'admin' }, error: null }).client });
  assert.strictEqual(await admin.isAdmin(), false);
});

test('isAdmin reads the profile role and caches it', async () => {
  account.setUserForTest({ id: 'u1' });
  admin.configure({ client: fake({ data: { role: 'admin' }, error: null }).client });
  assert.strictEqual(await admin.isAdmin(), true);
  assert.strictEqual(admin.knownAdmin(), true);
});

test('isAdmin is false for a user role or an error', async () => {
  account.setUserForTest({ id: 'u1' });
  admin.configure({ client: fake({ data: { role: 'user' }, error: null }).client });
  assert.strictEqual(await admin.isAdmin(), false);
  admin.configure({ client: fake({ data: null, error: { message: 'x' } }).client });
  assert.strictEqual(await admin.isAdmin(), false);
});

test('approve sets status approved on that car only', async () => {
  const f = fake({ data: null, error: null });
  admin.configure({ client: f.client });
  await admin.approve('cx5kf:2.5l');
  assert.deepStrictEqual(f.calls, [['car_models', 'update', { status: 'approved' }], ['car_models', 'eq', 'id', 'cx5kf:2.5l']]);
});

test('writes reject on a Supabase error', async () => {
  admin.configure({ client: fake({ data: null, error: { message: 'denied' } }).client });
  await assert.rejects(admin.saveItem(1, { note: 'x' }));
});

test('num: blank, negative or text become null', () => {
  assert.deepStrictEqual(['', '-5', 'abc', '9000'].map(admin.num), [null, null, null, 9000]);
});

test('parseParts skips blank lines, defaults qty to 1, round-trips', () => {
  const parts = admin.parseParts('Oil Filter | PE01-14-302A\n\n  | no name\nATF FZ | K020 | 5');
  assert.deepStrictEqual(parts, [
    { name: 'Oil Filter', part_no: 'PE01-14-302A', qty: 1 },
    { name: 'ATF FZ', part_no: 'K020', qty: 5 }
  ]);
  assert.deepStrictEqual(admin.parseParts(admin.formatParts(parts)), parts);
});

test('itemPatch returns only changed fields, or null', () => {
  const before = { interval_km: 10000, interval_months: 12, note: 'n', parts: [] };
  assert.strictEqual(admin.itemPatch(before, { interval_km: '10000', interval_months: '12', note: 'n', parts: '' }), null);
  assert.deepStrictEqual(admin.itemPatch(before, { interval_km: '9000', interval_months: '12', note: 'n', parts: '' }), { interval_km: 9000 });
});

test('describeChange names the service and the changed fields', () => {
  const s = admin.describeChange({ item_id: 1,
    before: { service: 'Engine Oil & Filter', interval_km: 10000 },
    after: { service: 'Engine Oil & Filter', interval_km: 9000 } });
  assert.strictEqual(s, 'Engine Oil & Filter: interval_km 10000 → 9000');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/admin.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/data/admin.js`:

```js
/* ============================================================
   Garage — catalogue admin: the write side of the shared catalogue.
   RLS (supabase/schema.sql, Phase 5a) is what stops a non-admin; this
   module only shapes requests and admin input.

   Dual-mode, like pricing.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const account = isNode ? require('./account.js') : root.account;
  const api = factory(account);
  if (isNode) module.exports = api;
  else root.catalogAdmin = api;
})(typeof self !== 'undefined' ? self : globalThis, function (account) {

  let env = { client: null };
  let _admin = false;
  let _drafts = 0;

  function configure(next) { env = Object.assign({}, env, next || {}); }
  function reset() { env = { client: null }; _admin = false; _drafts = 0; }
  function available() { return !!env.client; }
  function knownAdmin() { return _admin; }
  function draftCount() { return _drafts; }

  function data(res) { if (res && res.error) throw res.error; return res ? res.data : null; }

  /* Never rejects. Also refreshes the draft count the menu badge shows. */
  function isAdmin() {
    const u = account.user();
    if (!env.client || !u) { _admin = false; return Promise.resolve(false); }
    return Promise.resolve(env.client.from('profiles').select('role').eq('user_id', u.id).maybeSingle())
      .then(res => {
        _admin = !!(res && !res.error && res.data && res.data.role === 'admin');
        if (!_admin) return false;
        return Promise.resolve(env.client.from('car_models').select('id').eq('status', 'draft'))
          .then(r => { _drafts = (r && !r.error && r.data) ? r.data.length : 0; return true; });
      })
      .catch(() => { _admin = false; return false; });
  }

  function listModels() {
    return Promise.resolve(env.client.from('car_models').select('id,model,generation,engine,status')
      .order('model').order('generation')).then(data);
  }

  function loadModel(id) {
    return Promise.all([
      env.client.from('car_models').select('*').eq('id', id).maybeSingle(),
      env.client.from('dealer_plan_items').select('*').eq('car_model_id', id).order('sort'),
      env.client.from('dealer_plan_changes').select('item_id,before,after,changed_at')
        .eq('car_model_id', id).order('changed_at', { ascending: false }).limit(20)
    ]).then(([m, items, changes]) => ({ model: data(m), items: data(items) || [], changes: data(changes) || [] }));
  }

  function saveWarranty(id, years, km) {
    return Promise.resolve(env.client.from('car_models').update({ warranty_years: years, warranty_km: km }).eq('id', id)).then(data);
  }
  function saveItem(id, patch) {
    return Promise.resolve(env.client.from('dealer_plan_items').update(patch).eq('id', id)).then(data);
  }
  function approve(id) {
    return Promise.resolve(env.client.from('car_models').update({ status: 'approved' }).eq('id', id)).then(data);
  }

  /* Blank, negative or non-numeric input means "no value", not 0. */
  function num(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  /* One part per line: "name | part number | qty". Part number and qty are
     optional; a missing or bad qty means 1. Lines without a name are skipped. */
  function parseParts(text) {
    return String(text || '').split('\n')
      .map(line => line.split('|').map(x => x.trim()))
      .filter(f => f[0])
      .map(([name, partNo, qty]) => ({ name, part_no: partNo || '', qty: Math.max(1, parseInt(qty, 10) || 1) }));
  }
  function formatParts(parts) {
    return (parts || []).map(p => [p.name, p.part_no || '', p.qty || 1].join(' | ')).join('\n');
  }

  /* `fields` are raw form strings. Returns only what changed, so an
     untouched item writes nothing and logs nothing. */
  function itemPatch(before, fields) {
    const prev = { interval_km: before.interval_km ?? null, interval_months: before.interval_months ?? null,
      note: before.note || '', parts: before.parts || [] };
    const next = { interval_km: num(fields.interval_km), interval_months: num(fields.interval_months),
      note: String(fields.note || '').trim(), parts: parseParts(fields.parts) };
    const patch = {};
    Object.keys(next).forEach(k => { if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) patch[k] = next[k]; });
    return Object.keys(patch).length ? patch : null;
  }

  const LOGGED = ['interval_km', 'interval_months', 'note', 'parts', 'warranty_years', 'warranty_km', 'status'];
  function describeChange(c) {
    const b = c.before || {}, a = c.after || {};
    const name = a.service || b.service || (c.item_id == null ? 'Car details' : 'Item');
    const keys = LOGGED.filter(k => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
    return name + ': ' + keys.map(k => `${k} ${JSON.stringify(b[k] ?? null)} → ${JSON.stringify(a[k] ?? null)}`).join(', ');
  }

  return {
    configure, reset, available, isAdmin, knownAdmin, draftCount,
    listModels, loadModel, saveWarranty, saveItem, approve,
    num, parseParts, formatParts, itemPatch, describeChange
  };
});
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/admin.test.js`
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add src/data/admin.js test/admin.test.js
git commit -m "Add catalogue admin module: role check, writes, input parsing"
```

---

### Task 6: Wire the catalogue into the app

**Files:**
- Modify: `index.html` (two script tags after `src/data/pricing.js`)
- Modify: `test/helpers/boot.js` (`SCRIPTS`, same position)
- Modify: `sw.js` (`ASSETS`, bump `CACHE` by one)
- Modify: `main.js` (configure after `pricing.configure(...)`; `go()`; boot block; `addVehicle`)
- Test: `test/remote-catalog-render.test.js`

**Interfaces:**
- Consumes: Task 4 `remoteCatalog`, Task 5 `catalogAdmin`; `metaGet`/`metaSet` globals from `storage.js`; `session.save()`.
- Produces: `syncDealerPlan() → bool` in `main.js` (applies to the current car and saves).

> If `perf/lighter-startup` (lazy Supabase loading) has merged first, put the two `configure` calls inside its `connectBackend()` instead of after `pricing.configure`, and start the boot refresh after `loadBackend()` resolves.

- [ ] **Step 1: Write failing test** — `test/remote-catalog-render.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');
const { buildProfile, normalizeData } = require('../src/data/normalize.js');

function stub(planVersion, oilKm) {
  return { createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
    from: table => ({ select: () => {
      const id = 'mazda3bm:2.0l-skyactiv-g';
      const res = Promise.resolve({ error: null, data: table === 'car_models'
        ? [{ id, model: '3', generation: 'BM', engine: '2.0L SkyActiv-G', plan_updated_at: planVersion }]
        : [{ car_model_id: id, service: 'Engine Oil & Filter', interval_km: oilKm, interval_months: 12, sort: 0 }] });
      res.eq = () => res;
      return res;
    } })
  }) };
}

async function until(fn) {
  const deadline = Date.now() + 2000;
  while (!fn() && Date.now() < deadline) await new Promise(r => setImmediate(r));
  return fn();
}

test('a newer dealer plan reaches an existing car after boot', async () => {
  const data = normalizeData(buildProfile('mazda3bm', 0, { odometer: 0 }));
  data.car.planVersion = 'v1';
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub('v2', 9000), vehicles: [{ id: 'car1', data }] });
  try {
    assert.ok(await until(() => app.api.session.current().car.planVersion === 'v2'), 'plan never applied');
    const oil = app.api.session.current().services.find(s => s.name === 'Engine Oil & Filter');
    assert.strictEqual(oil.normalKm, 9000);
  } finally { app.cleanup(); }
});

test('with no backend the app boots exactly as before', async () => {
  const app = await bootApp();
  try {
    assert.strictEqual(app.api.remoteCatalog.model('mazda3bm:2.0l-skyactiv-g'), null);
  } finally { app.cleanup(); }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/remote-catalog-render.test.js`
Expected: FAIL — `remoteCatalog` undefined.

- [ ] **Step 3: Load the scripts.** In `index.html`, after `<script src="src/data/pricing.js"></script>`:

```html
  <script src="src/data/remote-catalog.js"></script>
  <script src="src/data/admin.js"></script>
```

In `test/helpers/boot.js` `SCRIPTS`, after `'src/data/pricing.js',`:

```js
  'src/data/remote-catalog.js',
  'src/data/admin.js',
```

In `sw.js`, add `'./src/data/remote-catalog.js', './src/data/admin.js',` after `'./src/data/pricing.js',` and bump `CACHE` by one (e.g. `garage-v112` → `garage-v113`).

- [ ] **Step 4: Configure and apply.** In `main.js`, after `pricing.configure({ client: supabaseClient });`:

```js
remoteCatalog.configure({ client: supabaseClient, metaGet, metaSet });
catalogAdmin.configure({ client: supabaseClient });

/* Puts a newer shared dealer plan onto the car on screen. session.save()
   fires the afterSave hook, so a signed-in change is queued for sync too. */
function syncDealerPlan() {
  if (!remoteCatalog.applyDealerPlan(session.current())) return false;
  session.save();
  return true;
}
```

In `go()`, right after the `if (!routes[route]) route = 'dashboard';` line:

```js
  syncDealerPlan();
```

In the boot block, replace

```js
    account.start().catch(err => console.error('account.start() failed:', err));
```

with

```js
    account.start()
      .then(() => catalogAdmin.isAdmin())
      .catch(err => console.error('account.start() failed:', err));
    // Same rule as account.start(): after first paint, and never fatal.
    remoteCatalog.load()
      .then(() => remoteCatalog.refresh())
      .then(() => { if (syncDealerPlan()) go(current); })
      .catch(err => console.error('catalogue refresh failed:', err));
```

In `addVehicle`'s click handler, right after `const data = normalizeData(buildProfile(...));`:

```js
    remoteCatalog.applyDealerPlan(data, { force: true });   // a new car takes the current shared plan
```

- [ ] **Step 5: Run everything**

Run: `npm test && npx playwright test`
Expected: all unit tests pass (including the 2 new ones and `test/precache.test.js`); e2e 23 passed, 1 skipped.

- [ ] **Step 6: Commit**

```bash
git add index.html sw.js test/helpers/boot.js main.js test/remote-catalog-render.test.js
git commit -m "Apply shared dealer plans to cars at boot, on navigation and on add"
```

---

### Task 7: Admin route and menu entry

**Files:**
- Create: `src/pages/admin.js`
- Modify: `index.html` (script tag after `src/pages/documents.js`), `test/helpers/boot.js` (`SCRIPTS`), `sw.js` (`ASSETS` + bump `CACHE` again)
- Modify: `main.js` (`routes`; boot `go('dashboard')` → hash-aware)
- Modify: `src/ui/chrome.js` (`buildAccountMenu`, after the "Switch vehicle" item)
- Modify: `styles.css` (one rule), `src/i18n/strings.ar.js` (new strings)
- Test: `test/admin-page.test.js`

**Interfaces:**
- Consumes: `catalogAdmin` (Task 5), `account.user()`, `account.signIn(email, password)`, UI helpers `el`, `html`, `t`, `field`, `pageIntro`, `onAsyncClick`, `toast`, `$`, `go`.
- Produces: route `admin` → `renderAdmin()`; script-scope `let adminModelId`.

- [ ] **Step 1: Write failing tests** — `test/admin-page.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./helpers/boot.js');

function stub(role) {
  const rows = {
    profiles: { role },
    car_models: [{ id: 'cx5kf:2.5l', model: 'CX-5', generation: 'KF', engine: '2.5L', status: 'draft' }],
    dealer_plan_items: []
  };
  return { createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
    from: table => {
      const p = Promise.resolve({ data: rows[table], error: null });
      const c = { then: p.then.bind(p), catch: p.catch.bind(p) };
      ['select', 'eq', 'order', 'limit', 'maybeSingle', 'update'].forEach(k => { c[k] = () => c; });
      return c;
    }
  }) };
}

async function until(fn) {
  const deadline = Date.now() + 2000;
  while (!fn() && Date.now() < deadline) await new Promise(r => setImmediate(r));
  return fn();
}
const text = d => d.querySelector('#view').textContent;

test('admin sees the catalogue with drafts marked for review', async () => {
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub('admin') });
  try {
    app.api.account.setUserForTest({ id: 'u1' });
    app.api.go('admin');
    assert.ok(await until(() => /CX-5/.test(text(app.document))), text(app.document));
    assert.match(text(app.document), /Needs review/);
  } finally { app.cleanup(); }
});

test('a non-admin is told so and sees no catalogue', async () => {
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub('user') });
  try {
    app.api.account.setUserForTest({ id: 'u1' });
    app.api.go('admin');
    assert.ok(await until(() => /not an admin/.test(text(app.document))), text(app.document));
    assert.doesNotMatch(text(app.document), /CX-5/);
  } finally { app.cleanup(); }
});

test('signed out shows a sign-in form', async () => {
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub('admin') });
  try {
    app.api.go('admin');
    assert.ok(await until(() => !!app.document.querySelector('#adm_email')));
  } finally { app.cleanup(); }
});

test('no backend explains that admin needs a connection', async () => {
  const app = await bootApp();
  try {
    app.api.go('admin');
    assert.ok(await until(() => /internet connection/.test(text(app.document))));
  } finally { app.cleanup(); }
});

test('the account menu shows Admin only to an admin', async () => {
  const app = await bootApp({ protocol: 'https:', supabaseStub: stub('admin') });
  try {
    const items = () => [...app.document.querySelectorAll('#accountMenu .menu-item')].map(b => b.textContent);
    app.document.querySelector('#accountBtn').onclick();
    assert.ok(!items().some(s => /Admin/.test(s)), 'shown before the role is known');
    app.document.querySelector('#accountBtn').onclick();          // close
    app.api.account.setUserForTest({ id: 'u1' });
    await app.api.catalogAdmin.isAdmin();
    app.document.querySelector('#accountBtn').onclick();
    assert.ok(items().some(s => /Admin \(1\)/.test(s)), items().join(' | '));
  } finally { app.cleanup(); }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/admin-page.test.js`
Expected: FAIL — `go('admin')` falls back to dashboard; no "Admin" menu item.

- [ ] **Step 3: Implement the page** — `src/pages/admin.js`:

```js
/* ============================================================
   Garage — admin: review and correct the shared car catalogue.
   Reached from the account menu (admins only) or #admin. Hiding it is
   convenience, not security: RLS refuses a non-admin's writes.
   Plain script, exercised through the boot harness.
   ============================================================ */
'use strict';

let adminModelId = null;   // the car being edited, or null for the list

function renderAdmin() {
  const v = el('div', 'admin-view');
  v.appendChild(pageIntro('Admin', 'Review and correct the shared car catalogue.'));
  const body = el('div');
  body.innerHTML = html`<p class="muted">${t('Loading…')}</p>`;
  v.appendChild(body);
  renderAdminBody(body);
  return v;
}

function adminNotice(body, msg) {
  body.innerHTML = html`<div class="card" style="padding:16px">${t(msg)}</div>`;
}

async function renderAdminBody(body) {
  if (!catalogAdmin.available()) return adminNotice(body, 'Admin needs an internet connection.');
  if (!account.user()) { body.innerHTML = ''; body.appendChild(adminSignIn()); return; }
  if (!(await catalogAdmin.isAdmin())) return adminNotice(body, 'This account is not an admin.');
  try {
    const node = adminModelId ? await adminEditor(adminModelId) : await adminList();
    body.innerHTML = '';
    body.appendChild(node);
  } catch (e) {
    console.error(e);
    adminNotice(body, 'Could not load the catalogue.');
  }
}

function adminSignIn() {
  const card = el('div', 'card');
  card.style.padding = '16px';
  card.appendChild(field('Email', html`<input id="adm_email" type="email" autocomplete="username">`));
  card.appendChild(field('Password', html`<input id="adm_pw" type="password" autocomplete="current-password">`));
  const err = el('p', 'muted');
  err.hidden = true;
  const b = el('button', 'btn primary block', html`${t('Sign in')}`);
  onAsyncClick(b, async () => {
    err.hidden = true;
    try {
      await account.signIn($('#adm_email').value.trim(), $('#adm_pw').value);
      go('admin');
    } catch (e) {
      err.textContent = t('Sign-in failed. Check your email and password.');
      err.hidden = false;
    }
  });
  card.append(b, err);
  return card;
}

async function adminList() {
  const models = await catalogAdmin.listModels();
  const ordered = models.filter(m => m.status === 'draft').concat(models.filter(m => m.status !== 'draft'));
  const wrap = el('div', 'card');
  ordered.forEach(m => {
    const it = el('div', 'item');
    it.innerHTML = html`<div class="item-main"><h3>Mazda ${m.model} · ${m.generation}</h3><p>${m.engine}</p></div>
      <div class="item-side">${m.status === 'draft' ? html`<span class="pill warn">${t('Needs review')}</span>` : ''}</div>`;
    it.onclick = () => { adminModelId = m.id; go('admin'); };
    wrap.appendChild(it);
  });
  return wrap;
}

async function adminEditor(id) {
  const { model, items, changes } = await catalogAdmin.loadModel(id);
  const wrap = el('div');
  const back = el('button', 'btn ghost', html`← ${t('All cars')}`);
  back.onclick = () => { adminModelId = null; go('admin'); };
  wrap.appendChild(back);

  const head = el('div', 'card');
  head.style.padding = '16px';
  head.innerHTML = html`<h3>Mazda ${model.model} · ${model.generation} · ${model.engine}</h3>`;
  const wr = el('div', 'field-row');
  wr.append(
    field('Warranty (years)', html`<input id="adm_wy" type="number" min="0" value="${model.warranty_years ?? ''}">`),
    field('Warranty (km)', html`<input id="adm_wkm" type="number" min="0" value="${model.warranty_km ?? ''}">`));
  head.appendChild(wr);
  wrap.appendChild(head);

  const list = el('div', 'card');
  list.style.padding = '16px';
  items.forEach(it => {
    const box = el('div', 'admin-item');
    box.dataset.itemId = String(it.id);
    box.innerHTML = html`<h4>${it.icon} ${t(it.service)}</h4>`;
    const r = el('div', 'field-row');
    r.append(
      field('Dealer interval (km)', html`<input data-k="interval_km" type="number" min="0" value="${it.interval_km ?? ''}">`),
      field('Dealer interval (mo)', html`<input data-k="interval_months" type="number" min="0" value="${it.interval_months ?? ''}">`));
    box.appendChild(r);
    box.appendChild(field('Note', html`<textarea data-k="note" rows="2">${it.note}</textarea>`));
    box.appendChild(field('Parts (name | part number | qty, one per line)',
      html`<textarea data-k="parts" rows="2">${catalogAdmin.formatParts(it.parts)}</textarea>`));
    list.appendChild(box);
  });
  wrap.appendChild(list);

  const save = el('button', 'btn primary block', html`${t(model.status === 'draft' ? 'Save and approve' : 'Save changes')}`);
  onAsyncClick(save, async () => {
    try {
      await catalogAdmin.saveWarranty(id, catalogAdmin.num($('#adm_wy').value), catalogAdmin.num($('#adm_wkm').value));
      for (const box of list.querySelectorAll('.admin-item')) {
        const before = items.find(x => String(x.id) === box.dataset.itemId);
        const fields = {};
        box.querySelectorAll('[data-k]').forEach(inp => { fields[inp.dataset.k] = inp.value; });
        const patch = catalogAdmin.itemPatch(before, fields);
        if (patch) await catalogAdmin.saveItem(before.id, patch);
      }
      if (model.status === 'draft') await catalogAdmin.approve(id);
      toast('Catalogue saved');
      go('admin');
    } catch (e) {
      console.error(e);
      toast('Could not save. Check your connection.', 'warn');
    }
  });
  wrap.appendChild(save);

  if (changes.length) {
    const h = el('div', 'card');
    h.style.padding = '16px';
    h.innerHTML = html`<h4>${t('Recent changes')}</h4>${changes.map(c =>
      html`<p class="muted" style="font-size:12.5px;margin-top:6px">${String(c.changed_at).slice(0, 10)} · ${catalogAdmin.describeChange(c)}</p>`)}`;
    wrap.appendChild(h);
  }
  return wrap;
}
```

- [ ] **Step 4: Route, menu, hash, assets.**

`main.js` — add to `routes`: `admin: renderAdmin` (after `reports: renderReports`). In the boot block change `go('dashboard');` to:

```js
    go(location.hash === '#admin' ? 'admin' : 'dashboard');
```

`src/ui/chrome.js` — in `buildAccountMenu`, right after the "Switch vehicle" `menu.appendChild(...)` line:

```js
  if (catalogAdmin.knownAdmin()) {
    const n = catalogAdmin.draftCount();
    menu.appendChild(menuItem(t('Admin') + (n ? ` (${n})` : ''), 'menuitem', () => {
      closeAccountMenu(false);
      go('admin');
    }, '🛠️', true));
  }
```

`index.html` — after `<script src="src/pages/documents.js"></script>`: `<script src="src/pages/admin.js"></script>`. `test/helpers/boot.js` `SCRIPTS` — `'src/pages/admin.js',` after `'src/pages/documents.js',`. `sw.js` — add `'./src/pages/admin.js',` after `'./src/pages/documents.js',` and bump `CACHE` by one.

`styles.css` — append:

```css
.admin-item + .admin-item { border-top: 1px solid var(--stroke); margin-top: 14px; padding-top: 14px; }
```

`src/i18n/strings.ar.js` — add inside `AR` before its closing `};`:

```js
  'Admin': 'الإدارة',
  'Review and correct the shared car catalogue.': 'راجع دليل السيارات المشترك وصحّحه.',
  'Loading…': 'جارٍ التحميل…',
  'Admin needs an internet connection.': 'تحتاج الإدارة إلى اتصال بالإنترنت.',
  'This account is not an admin.': 'هذا الحساب ليس حساب مدير.',
  'Could not load the catalogue.': 'تعذّر تحميل الدليل.',
  'Email': 'البريد الإلكتروني',
  'Password': 'كلمة المرور',
  'Sign in': 'تسجيل الدخول',
  'Sign-in failed. Check your email and password.': 'فشل تسجيل الدخول. تحقّق من البريد وكلمة المرور.',
  'Needs review': 'بحاجة لمراجعة',
  'All cars': 'كل السيارات',
  'Warranty (years)': 'الضمان (سنوات)',
  'Warranty (km)': 'الضمان (كم)',
  'Note': 'ملاحظة',
  'Parts (name | part number | qty, one per line)': 'القطع (الاسم | رقم القطعة | الكمية، سطر لكل قطعة)',
  'Save and approve': 'حفظ واعتماد',
  'Save changes': 'حفظ التغييرات',
  'Catalogue saved': 'تم حفظ الدليل',
  'Could not save. Check your connection.': 'تعذّر الحفظ. تحقّق من الاتصال.',
  'Recent changes': 'آخر التغييرات',
```

Before adding, grep `src/i18n/strings.ar.js` for each key and skip any that already exist (a duplicate key silently wins last).

- [ ] **Step 5: Run everything**

Run: `npm test && npx playwright test`
Expected: all unit tests pass (5 new); e2e 23 passed, 1 skipped.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin.js main.js src/ui/chrome.js index.html sw.js test/helpers/boot.js styles.css src/i18n/strings.ar.js test/admin-page.test.js
git commit -m "Add the admin route for reviewing and correcting the catalogue"
```

---

### Task 8: Live-project checklist

**Files:**
- Modify: `docs/superpowers/verification/2026-08-22-sync-manual.md` (append a section)

- [ ] **Step 1: Append** this section:

```markdown
## Phase 5a — shared catalogue and admin (2026-10-15)

Prerequisite: the live project from the steps above, with real `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `src/data/account.js`.

1. Apply `supabase/schema.sql`, then `supabase/seed-catalogue.sql`, in the SQL editor. Re-run both once: no errors, no duplicate rows (`select count(*) from car_models` unchanged).
2. Sign up two accounts. Promote one: `update public.profiles set role = 'admin' where user_id = '<uuid>';`
3. Put both uuids into `supabase/tests/catalogue-rls.sql` and run it. Pass = finishes with no `FAIL:` error.
4. Open `/#admin` signed out → sign-in form. Sign in as the non-admin → "This account is not an admin."
5. Sign in as the admin → list of 16+ cars. Open Mazda 3 BM 2.0L, change Engine Oil & Filter dealer interval to 9000, save → toast "Catalogue saved"; "Recent changes" shows `interval_km 10000 → 9000`.
6. In a second browser (anonymous, with a Mazda 3 BM 2.0L car that has been opened once before step 5), reload → the Maintenance page shows Dealer 9,000 km for Engine Oil & Filter.
7. Turn the network off and reload that second browser → the app opens and still shows 9,000.
8. Set the interval back to 10000.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/verification/2026-08-22-sync-manual.md
git commit -m "Add Phase 5a live-project verification steps"
```
