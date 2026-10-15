# Community Insights — Foundation (Plan 1 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in users' fuel fills and part/service history feed anonymous per-model statistics, and the Fuel and Parts pages show "what other owners of your model get/pay/replace", with a consent notice and off switch.

**Architecture:** Anonymised rows go through the existing sync outbox (new `contribution` kind) to a Postgres RPC that stores them with no user id; a private link table counts distinct contributors. Definer-owned views return only aggregates with at least 5 contributors. A new dual-mode `src/data/insights.js` (pattern of `pricing.js`) holds the pure anonymise/predict functions and the client calls.

**Tech Stack:** Vanilla JS dual-mode modules, `node --test`, Playwright, Supabase (Postgres RPC + views).

**Spec:** `docs/superpowers/specs/2026-10-16-community-insights-design.md`

## Scope of this plan (and what follows)

Plan 1 (this): consent, contributions pipeline for **fuel** and **parts**, aggregates, Fuel + Parts UI.
Separate later plans, each shippable alone: **Plan 2** shops database + trust feedback; **Plan 3** bill reading (Edge Function + prefill); **Plan 4** repair-vs-replace (`action` field, `repair_stats`, curated `repairable.js`). The spec covers all four; the split follows the "one subsystem per plan" rule.

Deviations from the spec, deliberate:
- Aggregate views are **owner-run (not `security_invoker`)**: they must count distinct users in `contribution_links`, which no signed-in user may read. The tables grant nothing to `authenticated`; only the views and two RPCs are exposed. Update the spec line when this ships.
- Parts are keyed by `item_key` (lower-cased trimmed part name — catalogue names are already canonical strings) instead of `price_items.id`, to avoid a network round-trip per saved part. Mapping to `price_items` can come later.
- `parts_stats` (brand share) is folded into `brand_life` (`n` per brand gives the share).

## Global Constraints

- Minimum 5 distinct contributors before any aggregate row is returned.
- Odometer is banded to 5,000 km; date is `YYYY-MM` only; no user id, vehicle id, nickname, notes or photos in `contributions`.
- Sharing is on by default, one-time notice, Settings toggle; turning off stops uploads and deletes the user's contributions.
- Insight failures never block or delay a local save; offline or signed-out → nothing shown / nothing sent.
- Every new user-visible string needs an Arabic entry in `src/i18n/strings.ar.js`.
- Dual-mode module pattern (`isNode ? require : root.x`); tests via `node --test "test/**/*.test.js"`.

## Review Focus

- Fill with zero or negative km between fills, or L/100 outside 1–40 → must not be contributed (test in Task 2).
- Editing a past fill must update, not duplicate, its contribution (stable `source_key`; test in Task 2, SQL upsert in Task 1).
- Part with no earlier replacement → `km_since_prev` null, still contributed for price (Task 2).
- User signed out, offline, or `file://` → no network call, no error, UI shows nothing (Tasks 3, 6).
- Opt-out must delete past rows, not just stop future ones (Tasks 3, 4).
- Fewer than 5 contributors → "Not enough data yet", never a number (Task 5).

**Prerequisite:** the working tree has uncommitted work (import/export removal etc.). Commit it first so this plan starts clean.

---

### Task 1: SQL — contributions, RPCs, aggregate views

**Files:**
- Modify: `supabase/schema.sql` (append)

**Interfaces:**
- Produces: RPC `submit_contributions(rows jsonb) returns int`, RPC `delete_my_contributions() returns int`, views `fuel_stats(model_id, engine, odometer_band, median_l100, p25_l100, p75_l100, n)` and `brand_life(model_id, item_key, brand, median_km, p25_km, p75_km, median_price, n)`.

This is SQL and cannot run in the unit suite; verification is the live-project check listed in Task 8.

- [ ] **Step 1: Append to `supabase/schema.sql`**

```sql
-- Community insights. See docs/superpowers/specs/2026-10-16-community-insights-design.md.
-- Neither table below grants anything to `authenticated`: users reach them only
-- through the two RPCs (write) and the aggregate views (read).
create table if not exists public.contributions (
  id             uuid        primary key default gen_random_uuid(),
  kind           text        not null check (kind in ('fuel', 'part')),
  model_id       text        not null,
  engine         text,
  odometer_band  int         not null check (odometer_band >= 0),
  month          text        not null check (month ~ '^\d{4}-\d{2}$'),
  l100           numeric     check (l100 between 1 and 40),
  price_per_l    numeric     check (price_per_l > 0),
  item_key       text,
  brand          text,
  part_no        text,
  price          numeric     check (price > 0),
  km_since_prev  int         check (km_since_prev > 0),
  created_at     timestamptz not null default now()
);

create table if not exists public.contribution_links (
  user_id         uuid not null references auth.users on delete cascade,
  source_key      text not null,
  contribution_id uuid not null references public.contributions on delete cascade,
  primary key (user_id, source_key)
);
create index if not exists contribution_links_cid_idx on public.contribution_links (contribution_id);

alter table public.contributions enable row level security;
alter table public.contribution_links enable row level security;
-- No policies on purpose: RLS defaults to deny for every role except the owner.

create or replace function public.submit_contributions(rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; cid uuid; n int := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 50 then
    raise exception 'bad rows';
  end if;
  for r in select * from jsonb_array_elements(rows) loop
    select contribution_id into cid from contribution_links
      where user_id = auth.uid() and source_key = r->>'source_key';
    if cid is null then
      insert into contributions (kind, model_id, engine, odometer_band, month, l100,
                                 price_per_l, item_key, brand, part_no, price, km_since_prev)
      values (r->>'kind', r->>'model_id', r->>'engine', (r->>'odometer_band')::int,
              r->>'month', (r->>'l100')::numeric, (r->>'price_per_l')::numeric,
              r->>'item_key', r->>'brand', r->>'part_no', (r->>'price')::numeric,
              (r->>'km_since_prev')::int)
      returning id into cid;
      insert into contribution_links (user_id, source_key, contribution_id)
        values (auth.uid(), r->>'source_key', cid);
    else
      update contributions set
        engine = r->>'engine', odometer_band = (r->>'odometer_band')::int, month = r->>'month',
        l100 = (r->>'l100')::numeric, price_per_l = (r->>'price_per_l')::numeric,
        brand = r->>'brand', part_no = r->>'part_no', price = (r->>'price')::numeric,
        km_since_prev = (r->>'km_since_prev')::int
      where id = cid;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.delete_my_contributions() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  with gone as (
    delete from contributions where id in
      (select contribution_id from contribution_links where user_id = auth.uid())
    returning 1)
  select count(*) into n from gone;
  return n;
end $$;

revoke all on function public.submit_contributions(jsonb), public.delete_my_contributions() from public;
grant execute on function public.submit_contributions(jsonb), public.delete_my_contributions() to authenticated;

-- Owner-run views (NOT security_invoker): they must count distinct users in
-- contribution_links, which no signed-in user can read. The HAVING clause is
-- the 5-contributor privacy floor.
create or replace view public.fuel_stats as
  select c.model_id, c.engine, c.odometer_band,
         (percentile_cont(0.5)  within group (order by c.l100))::numeric(5,2) as median_l100,
         (percentile_cont(0.25) within group (order by c.l100))::numeric(5,2) as p25_l100,
         (percentile_cont(0.75) within group (order by c.l100))::numeric(5,2) as p75_l100,
         count(*) as n
  from contributions c join contribution_links l on l.contribution_id = c.id
  where c.kind = 'fuel'
  group by c.model_id, c.engine, c.odometer_band
  having count(distinct l.user_id) >= 5;

create or replace view public.brand_life as
  select c.model_id, c.item_key, c.brand,
         percentile_cont(0.5)  within group (order by c.km_since_prev) as median_km,
         percentile_cont(0.25) within group (order by c.km_since_prev) as p25_km,
         percentile_cont(0.75) within group (order by c.km_since_prev) as p75_km,
         (percentile_cont(0.5) within group (order by c.price))::numeric(10,2) as median_price,
         count(*) as n
  from contributions c join contribution_links l on l.contribution_id = c.id
  where c.kind = 'part' and c.km_since_prev is not null
  group by c.model_id, c.item_key, c.brand
  having count(distinct l.user_id) >= 5;

grant select on public.fuel_stats, public.brand_life to authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(insights): contributions schema, RPCs and aggregate views"
```

---

### Task 2: `insights.js` pure functions (anonymise, band, predict)

**Files:**
- Create: `src/data/insights.js`, `test/insights.test.js`
- Modify: `index.html` (script tag next to `pricing.js`), `sw.js` (`ASSETS`, bump `CACHE`), `test/precache.test.js` if it lists scripts

**Interfaces:**
- Produces (pure, exported):
  - `band(odo) -> int` (floor to 5000)
  - `monthOf(isoDate) -> 'YYYY-MM'`
  - `fuelContribution({ modelId, engine, vehicleId, entry, l100 }) -> row | null` — `entry` is `{id,date,odometer,litres,cost}`; null if `l100` not within 1–40 or litres ≤ 0.
  - `partContributions({ modelId, vehicleId, historyEntry, priorHistory }) -> row[]` — one row per `historyEntry.parts[]` item with price > 0; `km_since_prev` from the latest earlier entry in `priorHistory` containing the same part.
  - `predictNext(life, lastKm, nowKm) -> { fromKm, toKm, usedKm, status }`, status `'early' | 'inRange' | 'overdue'`; `life` is `{ p25_km, p75_km }`.
- Row shape: `{ source_key, kind, model_id, engine, odometer_band, month, l100?, price_per_l?, item_key?, brand?, part_no?, price?, km_since_prev? }`.

- [ ] **Step 1: Write failing tests** — `test/insights.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ins = require('../src/data/insights.js');

test('band floors to 5,000 km', () => {
  assert.strictEqual(ins.band(0), 0);
  assert.strictEqual(ins.band(4999), 0);
  assert.strictEqual(ins.band(52300), 50000);
});

test('monthOf keeps only year and month', () => {
  assert.strictEqual(ins.monthOf('2026-08-17'), '2026-08');
});

test('fuelContribution anonymises: banded odometer, month only, no raw fields', () => {
  const row = ins.fuelContribution({ modelId: 'mazda3bm', engine: '2.0L SkyActiv-G', vehicleId: 'v1',
    entry: { id: 'f1', date: '2026-08-17', odometer: 52300, litres: 40, cost: 92 }, l100: 8.1234 });
  assert.deepStrictEqual(row, { source_key: 'fuel:v1:f1', kind: 'fuel', model_id: 'mazda3bm',
    engine: '2.0L SkyActiv-G', odometer_band: 50000, month: '2026-08', l100: 8.12, price_per_l: 2.3 });
  assert.ok(!('date' in row) && !('odometer' in row) && !('cost' in row));
});

test('fuelContribution rejects impossible economy and zero litres', () => {
  const e = { id: 'f', date: '2026-08-17', odometer: 1000, litres: 40, cost: 90 };
  assert.strictEqual(ins.fuelContribution({ modelId: 'm', vehicleId: 'v', entry: e, l100: 0.5 }), null);
  assert.strictEqual(ins.fuelContribution({ modelId: 'm', vehicleId: 'v', entry: e, l100: 41 }), null);
  assert.strictEqual(ins.fuelContribution({ modelId: 'm', vehicleId: 'v', entry: Object.assign({}, e, { litres: 0 }), l100: 8 }), null);
  assert.strictEqual(ins.fuelContribution({ modelId: 'm', vehicleId: 'v', entry: e, l100: null }), null);
});

test('fuelContribution source_key is stable so an edit updates, not duplicates', () => {
  const mk = lit => ins.fuelContribution({ modelId: 'm', vehicleId: 'v', l100: 8,
    entry: { id: 'f1', date: '2026-08-17', odometer: 1000, litres: lit, cost: 90 } });
  assert.strictEqual(mk(40).source_key, mk(41).source_key);
});

const hist = (id, odo, parts) => ({ id, date: '2026-01-01', odometer: odo, parts });

test('partContributions computes km since the previous replacement of the same part', () => {
  const rows = ins.partContributions({ modelId: 'mazda3bm', vehicleId: 'v1',
    historyEntry: hist('h2', 60000, [{ part: 'Brake pads', brand: 'Bosch', price: 180 }]),
    priorHistory: [hist('h1', 15000, [{ part: 'Brake pads', brand: 'OEM', price: 300 }])] });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].km_since_prev, 45000);
  assert.strictEqual(rows[0].item_key, 'brake pads');
  assert.strictEqual(rows[0].source_key, 'part:v1:h2:brake pads');
  assert.strictEqual(rows[0].odometer_band, 60000);
});

test('partContributions: no earlier replacement -> km_since_prev null, still contributed', () => {
  const rows = ins.partContributions({ modelId: 'm', vehicleId: 'v',
    historyEntry: hist('h1', 30000, [{ part: 'Oil filter', brand: 'Mazda', price: 25 }]), priorHistory: [] });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].km_since_prev, undefined);
});

test('partContributions skips parts with no price and ignores prior entries at or after this odometer', () => {
  const rows = ins.partContributions({ modelId: 'm', vehicleId: 'v',
    historyEntry: hist('h2', 20000, [{ part: 'A', brand: 'x', price: 0 }, { part: 'B', brand: 'y', price: 10 }]),
    priorHistory: [hist('h3', 20000, [{ part: 'B', brand: 'y', price: 9 }])] });
  assert.deepStrictEqual(rows.map(r => r.item_key), ['b']);
  assert.strictEqual(rows[0].km_since_prev, undefined);
});

test('predictNext gives a range and a status', () => {
  const life = { p25_km: 45000, p75_km: 60000 };
  assert.deepStrictEqual(ins.predictNext(life, 15000, 40000), { fromKm: 60000, toKm: 75000, usedKm: 25000, status: 'early' });
  assert.strictEqual(ins.predictNext(life, 15000, 70000).status, 'inRange');
  assert.strictEqual(ins.predictNext(life, 15000, 80000).status, 'overdue');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/insights.test.js`
Expected: FAIL — `Cannot find module '../src/data/insights.js'`

- [ ] **Step 3: Implement** — `src/data/insights.js`

```js
/* ============================================================
   Insights — anonymous community statistics (see the spec).
   Dual-mode like pricing.js. Pure functions first, network below.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else root.insights = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {

  const BAND_KM = 5000;
  const band = odo => Math.floor((Number(odo) || 0) / BAND_KM) * BAND_KM;
  const monthOf = iso => String(iso || '').slice(0, 7);
  const round2 = n => Math.round(n * 100) / 100;
  const key = s => String(s || '').trim().toLowerCase();

  /* One closed full-to-full interval -> one anonymous row. Null when the
     economy figure is missing or implausible: bad data must not reach the pool. */
  function fuelContribution({ modelId, engine, vehicleId, entry, l100 }) {
    if (!(entry && entry.litres > 0) || !(l100 >= 1 && l100 <= 40)) return null;
    return {
      source_key: `fuel:${vehicleId}:${entry.id}`, kind: 'fuel', model_id: modelId, engine: engine || null,
      odometer_band: band(entry.odometer), month: monthOf(entry.date),
      l100: round2(l100), price_per_l: round2(entry.cost / entry.litres)
    };
  }

  function partContributions({ modelId, vehicleId, historyEntry, priorHistory }) {
    const earlier = (priorHistory || []).filter(h => h.id !== historyEntry.id && h.odometer < historyEntry.odometer);
    return (historyEntry.parts || []).filter(p => p.part && p.price > 0).map(p => {
      const prev = earlier.filter(h => (h.parts || []).some(q => key(q.part) === key(p.part)))
        .sort((a, b) => b.odometer - a.odometer)[0];
      const row = {
        source_key: `part:${vehicleId}:${historyEntry.id}:${key(p.part)}`, kind: 'part', model_id: modelId,
        odometer_band: band(historyEntry.odometer), month: monthOf(historyEntry.date),
        item_key: key(p.part), brand: p.brand || null, part_no: p.partNo || null, price: round2(p.price)
      };
      if (prev) row.km_since_prev = historyEntry.odometer - prev.odometer;
      return row;
    });
  }

  function predictNext(life, lastKm, nowKm) {
    const fromKm = lastKm + life.p25_km, toKm = lastKm + life.p75_km;
    return { fromKm, toKm, usedKm: nowKm - lastKm, status: nowKm < fromKm ? 'early' : nowKm <= toKm ? 'inRange' : 'overdue' };
  }

  return { band, monthOf, fuelContribution, partContributions, predictNext };
});
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/insights.test.js`
Expected: all PASS

- [ ] **Step 5: Ship the file to the browser and cache** — add `<script src="src/data/insights.js"></script>` right after the `pricing.js` tag in `index.html`; add `'./src/data/insights.js'` after pricing's entry in `sw.js` `ASSETS` and bump `CACHE` to `garage-v119`. Check `grep -n pricing test/precache.test.js`; if the test lists scripts, add insights there too.

Run: `npm test`
Expected: PASS (precache/render tests included)

- [ ] **Step 6: Commit**

```bash
git add src/data/insights.js test/insights.test.js index.html sw.js test/precache.test.js
git commit -m "feat(insights): anonymise and predict functions"
```

---

### Task 3: Network calls and consent in `insights.js`

**Files:**
- Modify: `src/data/insights.js`, `test/insights.test.js`

**Interfaces:**
- Consumes: Task 2 row shape.
- Produces:
  - `configure({ client, metaGet, metaSet })`, `reset()`, `available()`
  - `shareEnabled() -> Promise<boolean>` (meta `insightsShare`, default `true`)
  - `setShare(on) -> Promise<void>` — on `false` also calls `deleteMine()`
  - `noticeSeen() -> Promise<boolean>`, `markNoticeSeen() -> Promise<void>` (meta `insightsNoticeSeen`)
  - `submit(rows) -> Promise<boolean>` (RPC `submit_contributions`, `{ rows }`)
  - `deleteMine() -> Promise<boolean>` (RPC `delete_my_contributions`)
  - `getFuelStats(modelId) -> Promise<Row[]>`, `getBrandLife(modelId, itemKey) -> Promise<Row[]>`; `[]` on any error or when unavailable.

- [ ] **Step 1: Write failing tests** — append to `test/insights.test.js`

```js
function metaStore() {
  let m = {};
  return { metaGet: () => Promise.resolve(m), metaSet: p => { m = Object.assign({}, m, p); return Promise.resolve(true); } };
}

test.beforeEach(() => ins.reset());

test('sharing defaults to on and the notice to unseen', async () => {
  ins.configure(metaStore());
  assert.strictEqual(await ins.shareEnabled(), true);
  assert.strictEqual(await ins.noticeSeen(), false);
  await ins.markNoticeSeen();
  assert.strictEqual(await ins.noticeSeen(), true);
});

test('turning sharing off persists and deletes past contributions', async () => {
  const calls = [];
  ins.configure(Object.assign(metaStore(), { client: { rpc: (fn, args) => { calls.push([fn, args]); return Promise.resolve({ data: 3, error: null }); } } }));
  await ins.setShare(false);
  assert.strictEqual(await ins.shareEnabled(), false);
  assert.deepStrictEqual(calls, [['delete_my_contributions', undefined]]);
});

test('submit sends rows through the RPC and reports success', async () => {
  let sent;
  ins.configure({ client: { rpc: (fn, args) => { sent = [fn, args]; return Promise.resolve({ data: 1, error: null }); } } });
  assert.strictEqual(await ins.submit([{ source_key: 'k' }]), true);
  assert.deepStrictEqual(sent, ['submit_contributions', { rows: [{ source_key: 'k' }] }]);
});

test('submit returns false on RPC error or without a client, never throws', async () => {
  assert.strictEqual(await ins.submit([{}]), false);
  ins.configure({ client: { rpc: () => Promise.resolve({ data: null, error: new Error('x') }) } });
  assert.strictEqual(await ins.submit([{}]), false);
  ins.configure({ client: { rpc: () => Promise.reject(new Error('offline')) } });
  assert.strictEqual(await ins.submit([{}]), false);
});

test('getFuelStats and getBrandLife return rows, or [] on error/unavailable', async () => {
  assert.deepStrictEqual(await ins.getFuelStats('m'), []);
  const rows = [{ n: 6 }];
  const q = table => ({ select: () => ({ eq: () => { const r = Promise.resolve({ data: rows, error: null });
    r.eq = () => Promise.resolve({ data: rows, error: null }); return r; } }) });
  ins.configure({ client: { from: q } });
  assert.deepStrictEqual(await ins.getFuelStats('m'), rows);
  assert.deepStrictEqual(await ins.getBrandLife('m', 'brake pads'), rows);
  ins.configure({ client: { from: () => { throw new Error('boom'); } } });
  assert.deepStrictEqual(await ins.getFuelStats('m'), []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/insights.test.js`
Expected: FAIL — `ins.reset is not a function`

- [ ] **Step 3: Implement** — add inside the factory in `insights.js`, and extend the returned object

```js
  let env = { client: null, metaGet: () => Promise.resolve({}), metaSet: () => Promise.resolve(true) };
  const DEFAULT_ENV = env;
  function configure(next) { env = Object.assign({}, env, next || {}); }
  function reset() { env = DEFAULT_ENV; }
  function available() { return !!env.client; }

  const shareEnabled = () => env.metaGet().then(m => m.insightsShare !== false);
  const noticeSeen = () => env.metaGet().then(m => m.insightsNoticeSeen === true);
  const markNoticeSeen = () => env.metaSet({ insightsNoticeSeen: true }).then(() => {});
  function setShare(on) {
    return env.metaSet({ insightsShare: !!on }).then(() => { if (!on) return deleteMine(); }).then(() => {});
  }

  function rpc(fn, args) {
    if (!env.client) return Promise.resolve(false);
    return Promise.resolve().then(() => env.client.rpc(fn, args))
      .then(res => !(res && res.error)).catch(() => false);
  }
  const submit = rows => rpc('submit_contributions', { rows });
  const deleteMine = () => rpc('delete_my_contributions');

  function stats(table, filters) {
    if (!env.client) return Promise.resolve([]);
    return Promise.resolve().then(() => {
      let q = env.client.from(table).select('*').eq('model_id', filters.modelId);
      if (filters.itemKey) q = q.eq('item_key', filters.itemKey);
      return q;
    }).then(res => (res && !res.error && res.data) || []).catch(() => []);
  }
  const getFuelStats = modelId => stats('fuel_stats', { modelId });
  const getBrandLife = (modelId, itemKey) => stats('brand_life', { modelId, itemKey });
```

Return object becomes: `{ band, monthOf, fuelContribution, partContributions, predictNext, configure, reset, available, shareEnabled, noticeSeen, markNoticeSeen, setShare, submit, deleteMine, getFuelStats, getBrandLife }`.

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/insights.test.js`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/insights.js test/insights.test.js
git commit -m "feat(insights): consent, submit/delete and stats calls"
```

---

### Task 4: Sync outbox kind and wiring

**Files:**
- Modify: `src/data/account.js` (`KIND_ORDER`, `drainOne`, new `enqueueContribution`, export), `main.js` (configure insights beside `pricing.configure({ client })` at ~line 542), `test/account.test.js`

**Interfaces:**
- Consumes: `insights.submit(rows)`.
- Produces: `account.enqueueContribution(rows) -> Promise` (no-op `false` when signed out, like `enqueue`); outbox entry `{ kind: 'contribution', rows }`.

`account.js` must receive `submit` by injection (it is dual-mode and does not import insights): add `submitContributions` to `configure`'s accepted deps, defaulting to `() => Promise.resolve(true)`.

- [ ] **Step 1: Write failing test** — in `test/account.test.js`, mirror the existing enqueue/drain tests (find with `grep -n "enqueuePhoto\|drain" test/account.test.js | head`) and add:

```js
test('a contribution entry drains through submitContributions and is removed on success', async () => {
  /* Build the account the same way the neighbouring drain tests do (same
     helper/fixtures), plus: submitContributions: rows => { sent.push(rows); return Promise.resolve(true); } */
  // enqueueContribution([{ source_key: 'k' }]); await drain();
  // assert.deepStrictEqual(sent, [[{ source_key: 'k' }]]); assert outboxSize() === 0
});

test('a failed contribution submit stays queued', async () => {
  // same setup with submitContributions resolving false -> outboxSize() === 1 after drain
});

test('enqueueContribution is a no-op when signed out', async () => {
  // signed-out account -> resolves false, outbox empty
});
```

Fill the three bodies by copying the setup lines of the nearest existing `drain` test verbatim (the file is 57 KB of such tests); the only new element is the `submitContributions` dep and the `enqueueContribution` call.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/account.test.js`
Expected: FAIL — `enqueueContribution is not a function`

- [ ] **Step 3: Implement**
  - `KIND_ORDER`: add `contribution: 1`.
  - `drainOne`: before the `const run = ...` chain add:
    ```js
    if (entry.kind === 'contribution') {
      return Promise.resolve(env.submitContributions ? env.submitContributions(entry.rows) : true)
        .then(ok => ok && deps.outboxRemove(entry.id)).catch(() => {});
    }
    ```
    and add `submitContributions: null` to `DEFAULTS` so `configure({ submitContributions })` lands in `env`.
  - New function beside `enqueuePhoto`: `function enqueueContribution(rows) { return enqueue({ kind: 'contribution', rows }); }`; add to the returned object.
  - `main.js`, next to `pricing.configure({ client })`:
    ```js
    insights.configure({ client, metaGet: storage.metaGet, metaSet: storage.metaSet });
    ```
    and in the `account.configure({...})` call add `submitContributions: rows => insights.submit(rows)`. Confirm the storage global's name with `grep -n "metaGet" main.js src/data/account.js` first and use that.

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/account.js main.js test/account.test.js
git commit -m "feat(insights): contribution outbox kind and wiring"
```

---

### Task 5: Contribute on save (fuel fill and service log)

**Files:**
- Modify: `src/pages/fuel.js` (~line 133–140, after `commit('fuel', ...)`), `src/pages/maintenance.js` (~line 219–224, after `save()`), `main.js` (one shared helper)

**Interfaces:**
- Consumes: `insights.fuelContribution`, `insights.partContributions`, `insights.shareEnabled`, `account.enqueueContribution`, `fuelRows()` (fuel.js:17), `session.current()`.
- Produces: `contribute(rows)` in `main.js` — `shareEnabled().then(on => on && rows.length && account.enqueueContribution(rows)).then(kickSync)`, never rejects.

- [ ] **Step 1: Write failing test** — `test/insights.test.js`

```js
test('contribute() queues rows only when sharing is on, and never rejects', async () => {
  // contribute lives in main.js (browser global); test the shared rule it uses instead:
  // shareEnabled() false -> no enqueue. Covered by setShare/shareEnabled tests above,
  // so here assert the pure row builders compose for a real fuel + service sequence.
  const fills = [
    { id: 'a', date: '2026-07-01', odometer: 10000, litres: 40, cost: 90, full: true },
    { id: 'b', date: '2026-07-20', odometer: 10500, litres: 41, cost: 94, full: true }
  ];
  const l100 = fills[1].litres / (fills[1].odometer - fills[0].odometer) * 100;
  const row = ins.fuelContribution({ modelId: 'mazda3bm', vehicleId: 'v', entry: fills[1], l100 });
  assert.strictEqual(row.l100, 8.2);
  assert.strictEqual(row.odometer_band, 10000);
});
```

- [ ] **Step 2: Run** — `node --test test/insights.test.js` → PASS (guards the composition; the DOM wiring is checked in Step 5).

- [ ] **Step 3: Implement**
  - `main.js`: add near `kickSync`
    ```js
    function contribute(rows) {
      return insights.shareEnabled()
        .then(on => on && rows.length && account.enqueueContribution(rows))
        .then(() => kickSync()).catch(() => {});
    }
    ```
  - `fuel.js`, after the successful `commit('fuel', ...)`:
    ```js
    const done = fuelRows().find(r => r.e.id === obj.id);
    const cur = session.current();
    const row = done && insights.fuelContribution({ modelId: cur.car.modelId, engine: cur.car.engine,
      vehicleId: cur.id, entry: obj, l100: done.l100 });
    if (row) contribute([row]);
    ```
    (Confirm the vehicle id accessor with `grep -n "vehicleId\|\.id" src/data/session.js | head`; use whatever `session` exposes for the active vehicle id.)
  - `maintenance.js`, after `const ok = await save();`: collect the `history` entries pushed in this log (track them in an array `logged` inside the `services.forEach`), then
    ```js
    if (ok) contribute(logged.flatMap(h => insights.partContributions({
      modelId: session.current().car.modelId, vehicleId: session.current().id,
      historyEntry: h, priorHistory: session.current().history })));
    ```

- [ ] **Step 4: Run** — `npm test` → PASS

- [ ] **Step 5: Manual check** — `npm run test:e2e` still passes; in a browser signed in on a dev Supabase project, add two full fills and confirm a `contribution` entry appears in the outbox then drains (DevTools → IndexedDB → `outbox`).

- [ ] **Step 6: Commit**

```bash
git add main.js src/pages/fuel.js src/pages/maintenance.js test/insights.test.js
git commit -m "feat(insights): contribute fuel and part data on save"
```

---

### Task 6: Consent notice and Settings toggle

**Files:**
- Modify: `src/ui/chrome.js` (menu), `main.js` (notice on boot), `src/i18n/strings.ar.js`, `test/account-menu.test.js`

**Interfaces:**
- Consumes: `insights.shareEnabled/setShare/noticeSeen/markNoticeSeen`.
- Produces: menu item `menuitemcheckbox` labelled `Share anonymous data` with `aria-checked`; a one-time toast/modal.

- [ ] **Step 1: Write failing test** — in `test/account-menu.test.js` (uses `withBoot`, `byLabel`):

```js
test('the account menu has a Share anonymous data checkbox', async () => {
  await withBoot(async ({ document: d }) => {
    trigger(d).click();
    const item = byLabel(d, /Share anonymous data/);
    assert.ok(item, 'sharing toggle was not added');
    assert.strictEqual(item.getAttribute('role'), 'menuitemcheckbox');
    assert.ok(['true', 'false'].includes(item.getAttribute('aria-checked')));
  });
});
```

- [ ] **Step 2: Run** — `node --test test/account-menu.test.js` → FAIL ("sharing toggle was not added")

- [ ] **Step 3: Implement**
  - `chrome.js`, after the dark-mode item (same pattern as `dark`):
    ```js
    const share = menuItem('Share anonymous data', 'menuitemcheckbox', null, '🤝');
    share.setAttribute('aria-checked', 'true');
    insights.shareEnabled().then(on => share.setAttribute('aria-checked', String(on)));
    share.onclick = async () => {
      const on = share.getAttribute('aria-checked') !== 'true';
      share.setAttribute('aria-checked', String(on));
      await insights.setShare(on);
      toast(on ? 'Sharing anonymous data' : 'Stopped sharing and removed your shared data');
    };
    menu.appendChild(share);
    ```
  - `main.js`, after the first successful boot render and only when `account.user()` is set: `insights.noticeSeen().then(seen => { if (!seen) { toast('Your anonymous car data now helps other owners. Turn it off in the menu.'); insights.markNoticeSeen(); } })`.
  - `strings.ar.js` — add (keep file's existing `'English': 'عربي',` style):
    - `'Share anonymous data'`: `'مشاركة بيانات مجهولة'`
    - `'Sharing anonymous data'`: `'تتم مشاركة بيانات مجهولة'`
    - `'Stopped sharing and removed your shared data'`: `'تم إيقاف المشاركة وحذف بياناتك المشتركة'`
    - `'Your anonymous car data now helps other owners. Turn it off in the menu.'`: `'بيانات سيارتك المجهولة تساعد الآن ملاك آخرين. يمكنك إيقافها من القائمة.'`

- [ ] **Step 4: Run** — `npm test` → PASS (the existing Arabic-coverage tests, if any, also pass)

- [ ] **Step 5: Commit**

```bash
git add src/ui/chrome.js main.js src/i18n/strings.ar.js test/account-menu.test.js
git commit -m "feat(insights): consent notice and sharing toggle"
```

---

### Task 7: Fuel and Parts insight UI

**Files:**
- Modify: `src/data/insights.js` (two pure view-model helpers), `test/insights.test.js`, `src/pages/fuel.js`, `src/pages/parts.js`, `src/i18n/strings.ar.js`

**Interfaces:**
- Produces (pure):
  - `fuelInsight(stats, odometer, mine) -> null | { typical, low, high, mine, diff }` — picks the stats row whose `odometer_band` equals `band(odometer)`, else the nearest band; `null` for empty `stats`. `mine` is the user's latest L/100 or `null`.
  - `partInsight(rows, lastKm, nowKm) -> null | { best: {brand, medianKm, medianPrice, n}, prediction }` — `best` is the brand with the greatest `median_km`; ties broken by lower `median_price`; `prediction = predictNext(best life, lastKm, nowKm)` or `null` when `lastKm` unknown.

- [ ] **Step 1: Write failing tests**

```js
test('fuelInsight picks the user\'s band, else the nearest, and null with no data', () => {
  const rows = [{ odometer_band: 50000, median_l100: 8.4, p25_l100: 7.9, p75_l100: 9.1 },
                { odometer_band: 100000, median_l100: 9.0, p25_l100: 8.2, p75_l100: 9.8 }];
  assert.strictEqual(ins.fuelInsight(rows, 52300, 7.8).typical, 8.4);
  assert.strictEqual(ins.fuelInsight(rows, 52300, 7.8).diff, -0.6);
  assert.strictEqual(ins.fuelInsight(rows, 90000, null).typical, 9.0);
  assert.strictEqual(ins.fuelInsight(rows, 90000, null).diff, null);
  assert.strictEqual(ins.fuelInsight([], 52300, 7.8), null);
});

test('partInsight chooses the longest-lasting brand and predicts the next change', () => {
  const rows = [
    { brand: 'Bosch', median_km: 55000, p25_km: 45000, p75_km: 60000, median_price: 180, n: 8 },
    { brand: 'Cheap', median_km: 30000, p25_km: 25000, p75_km: 35000, median_price: 90, n: 9 }];
  const out = ins.partInsight(rows, 15000, 52000);
  assert.strictEqual(out.best.brand, 'Bosch');
  assert.strictEqual(out.prediction.status, 'early');
  assert.strictEqual(ins.partInsight(rows, null, 52000).prediction, null);
  assert.strictEqual(ins.partInsight([], 15000, 52000), null);
});
```

- [ ] **Step 2: Run** — `node --test test/insights.test.js` → FAIL (`fuelInsight is not a function`)

- [ ] **Step 3: Implement** — in `insights.js`:

```js
  function fuelInsight(stats, odometer, mine) {
    if (!stats || !stats.length) return null;
    const b = band(odometer);
    const row = stats.slice().sort((x, y) => Math.abs(x.odometer_band - b) - Math.abs(y.odometer_band - b))[0];
    const typical = Number(row.median_l100);
    return { typical, low: Number(row.p25_l100), high: Number(row.p75_l100), mine: mine == null ? null : mine,
             diff: mine == null ? null : round2(mine - typical) };
  }

  function partInsight(rows, lastKm, nowKm) {
    if (!rows || !rows.length) return null;
    const best = rows.slice().sort((a, b) => (b.median_km - a.median_km) || (a.median_price - b.median_price))[0];
    return {
      best: { brand: best.brand, medianKm: best.median_km, medianPrice: best.median_price, n: best.n },
      prediction: lastKm == null ? null : predictNext(best, lastKm, nowKm)
    };
  }
```

Export both. Note: `round2(7.8 - 8.4)` is `-0.6`.

- [ ] **Step 4: Run** — `node --test test/insights.test.js` → PASS

- [ ] **Step 5: Wire the UI**
  - `fuel.js`, in `renderFuel` after the summary stats block (find with `grep -n "lastCPK" src/pages/fuel.js`): add an empty `<div class="card" id="fuelInsight" hidden>`; then
    ```js
    const cur = session.current();
    insights.getFuelStats(cur.car.modelId).then(rows => {
      const last = withEcon.length ? withEcon[withEcon.length - 1].l100 : null;
      const info = insights.fuelInsight(rows, cur.car.odometer, last);
      if (!info) return;                       // fewer than 5 contributors: show nothing
      const box = v.querySelector('#fuelInsight');
      box.innerHTML = html`<h3>${t('Other owners of your model')}</h3>
        <p>${t('Typical')}: ${info.typical.toFixed(1)} L/100km (${info.low.toFixed(1)}–${info.high.toFixed(1)})</p>
        ${info.mine != null ? html`<p>${t('Yours')}: ${info.mine.toFixed(1)} L/100km</p>` : ''}`;
      box.hidden = false;
    });
    ```
    Use the same `html` tagged template and card class names the neighbouring cards in this file use (check how `renderFuel` builds its existing cards first).
  - `parts.js`, near the existing `pricing.findExactItem(p.name)` block (line ~81): call `insights.getBrandLife(modelId, p.name.toLowerCase().trim())`, run `partInsight(rows, lastKm, car.odometer)` (`lastKm` = odometer of the latest `session.current().history` entry whose `parts` include `p.name`, else `null`), and when it returns non-null append lines: `Longest-lasting brand: {brand} (~{km} km, SAR {price})` and, if `prediction`, `Typical replacement: {from}–{to} km — you're at {used} km since the last one`. No data → render nothing.
  - `strings.ar.js`: `'Other owners of your model'`: `'ملاك آخرون لنفس طرازك'`, `'Typical'`: `'المعتاد'`, `'Yours'`: `'سيارتك'`, `'Longest-lasting brand'`: `'العلامة الأطول عمراً'`, `'Typical replacement'`: `'الاستبدال المعتاد'`, `'km since the last one'`: `'كم منذ آخر مرة'`.

- [ ] **Step 6: Run** — `npm test && npm run test:e2e` → PASS (no insight appears in tests: no client, so `getFuelStats` resolves `[]`)

- [ ] **Step 7: Commit**

```bash
git add src/data/insights.js test/insights.test.js src/pages/fuel.js src/pages/parts.js src/i18n/strings.ar.js
git commit -m "feat(insights): show other owners' fuel economy and part life"
```

---

### Task 8: Live verification (cannot be automated here)

**Files:** none

Needs a Supabase project with `supabase/schema.sql` applied, same as the pending Phase 5a checks in your notes.

- [ ] **Step 1: Apply** the new SQL block; confirm no errors.
- [ ] **Step 2: RLS** — as a signed-in user, `select * from contributions` and `select * from contribution_links` must fail with permission denied.
- [ ] **Step 3: Floor** — with 4 test users contributing the same model/band, `select * from fuel_stats` returns 0 rows; a 5th user makes the row appear.
- [ ] **Step 4: Idempotency** — submit the same `source_key` twice with a changed `l100`; `contributions` has one row with the new value.
- [ ] **Step 5: Opt-out** — `select delete_my_contributions()` removes only the caller's rows; the aggregate drops back below the floor.
- [ ] **Step 6: End to end** — in the app, toggle sharing off, add a fill, confirm no outbox `contribution` entry is created; toggle on, add a fill, confirm one drains.

---

## Self-review

- **Spec coverage (Plan 1 scope):** data + anonymisation → Tasks 1–2; consent/notice/toggle/opt-out delete → Tasks 3, 6; sync → Task 4; fuel and parts statistics, prediction, "not enough data" → Tasks 1, 7; privacy floor and RLS → Tasks 1, 8; Arabic strings → Tasks 6–7. Shops/trust, bill reading, repair-vs-replace, `store_prices`, `repair_stats`: deliberately Plans 2–4.
- **Placeholders:** Task 4's three test bodies are described by copying the neighbouring drain-test setup (the 57 KB test file has the fixtures; reproducing them here would be guesswork). The implementer must fill them from that setup, not leave comments.
- **Name consistency:** `fuelContribution`, `partContributions`, `predictNext`, `fuelInsight`, `partInsight`, `getFuelStats`, `getBrandLife`, `submit`, `deleteMine`, `enqueueContribution`, `submitContributions`, `contribute` are used identically across tasks. Row fields match the SQL columns.
- **Known gaps:** vehicle-id accessor on `session` and the storage global's name are to be confirmed by the grep each task names, since I did not open `session.js` fully.
