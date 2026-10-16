# Community Shops and Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users record which shop they bought from (shared shop list, city + area), vote thumbs up/down after a purchase, and see the cheapest shop in their city with a "Trusted" badge once enough owners have voted.

**Architecture:** New shared tables `shops` and `shop_feedback`; aggregate views `shop_trust` and `store_prices` (owner-run, 5-distinct-user floor, same pattern as `fuel_stats`/`brand_life`). `contributions` gains `shop_id`. New dual-mode `src/data/shops.js` (find-or-create like `pricing.js`, vote, read views, pure helpers). Two small UI modules (`shop-field.js`, `shop-feedback.js`) wired into the maintenance purchase forms; `parts.js` shows the advice line. Shop resolution happens **after** the local save, fire-and-forget.

**Tech Stack:** Vanilla JS dual-mode modules, `node --test`, Playwright e2e, Supabase Postgres (RLS, views, RPC). Local Postgres 16 available via brew for SQL checks.

**Spec:** `docs/superpowers/specs/2026-10-16-community-insights-design.md` (sections 1, 2, 5 shop entry + feedback; bill reading is Plan 3).

## Global Constraints

- Shops are a shared database: name + city + area, created by users, insert-only (no update/delete policy), unique on `(name_norm, lower(city))`; races resolve on unique violation like `pricing.js`.
- Trust feedback is thumbs up/down (+1/-1) with optional reason tags from `price, quality, honest, fast`; one vote per user per shop (upsert on `(shop_id,user_id)`).
- Weighted score: bill-backed vote = 2, unbacked = 1. Shown only at **>= 5 distinct voters**; "Trusted" when score share **>= 80%**.
- Store prices view also requires **>= 5 distinct contributors** (counted via `contribution_links`). Client shows the user's own city first.
- Location is store city + area only; no device GPS.
- Nothing here may block or delay a local save: shop lookup/creation, contribution and the feedback prompt all run after the save and swallow errors.
- Never sent: user id, vehicle id, notes, photos. A `shop_id` is the only new field on a contribution.
- Opt-out (`delete_my_contributions`) also erases the user's own votes. Account deletion cascades via FK.
- Every new user-visible string gets an Arabic entry in `src/i18n/strings.ar.js`; `test/no-raw-templates.test.js` must pass.
- New script files are added to `index.html`, `sw.js` ASSETS, and `test/helpers/boot.js`; bump `sw.js` `CACHE`.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Offline or signed-out purchase with a shop typed: the entry still saves with the shop name/city/area; no shop request errors surface; the contribution goes without `shop_id`.
- Shop name differing only by case, punctuation, or spacing (`Al-Salam Auto` vs `al salam  auto`) resolves to the same shop in the same city; Arabic names normalise too.
- Same shop name in two cities creates two shops.
- A user voting twice (or changing their vote) leaves exactly one row; reasons outside the four tags are rejected.
- Fewer than 5 voters: no trust figure, no "Trusted" badge, ever. Exactly 5 voters at 80% -> Trusted; 79% -> not.
- Opting out of sharing removes the user's votes and stops the feedback prompt from appearing.

---

### Task 1: Shop tables, views, RPC changes (SQL)

**Files:**
- Modify: `supabase/schema.sql` (new section after the `insights_prefs` block and before the final `revoke` block of the insights section; rewrite `submit_contributions` and `delete_my_contributions` in place)
- Create: `supabase/tests/shops-rls.sql` (manual live check, mirrors `catalogue-rls.sql` style)
- Test: `test/schema-shops.test.js` (static checks, mirrors `test/schema-catalogue.test.js`)

**Interfaces:**
- Produces tables `shops(id, name, name_norm, city, area, created_at)`, `shop_feedback(shop_id, user_id, vote, reasons, bill_backed, created_at)`; column `contributions.shop_id`; views `shop_trust(shop_id, up, down, voters, score_share, top_reasons)` and `store_prices(model_id, item_key, shop_id, shop_name, city, area, median_price, n)`. `submit_contributions` accepts optional `shop_id` per row.

- [ ] **Step 1: Write the failing static test** `test/schema-shops.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

test('shops table: insert-only shared list with case-insensitive uniqueness', () => {
  assert.match(sql, /create table if not exists public\.shops/);
  assert.match(sql, /create unique index if not exists shops_norm_city_key\s+on public\.shops \(name_norm, lower\(city\)\)/);
  assert.match(sql, /grant select, insert on public\.shops to authenticated/);
  assert.doesNotMatch(sql, /create policy [a-z_]+ on public\.shops for (update|delete)/);
});

test('shop_feedback: one vote per user per shop, own rows only, tag whitelist', () => {
  assert.match(sql, /primary key \(shop_id, user_id\)/);
  assert.match(sql, /vote\s+smallint not null check \(vote in \(-1, 1\)\)/);
  assert.match(sql, /reasons <@ array\['price','quality','honest','fast'\]/);
  assert.match(sql, /create policy own_shop_feedback on public\.shop_feedback for all/);
});

test('trust and store-price views apply the 5-distinct-user floor', () => {
  const trust = sql.match(/create or replace view public\.shop_trust[\s\S]*?;\n/)[0];
  assert.match(trust, /having count\(\*\) >= 5/);
  assert.match(trust, /when bill_backed then 2 else 1/);
  const prices = sql.match(/create or replace view public\.store_prices[\s\S]*?;\n/)[0];
  assert.match(prices, /having count\(distinct l\.user_id\) >= 5/);
});

test('views are not readable by anon; contributions carry shop_id; opt-out erases votes', () => {
  assert.match(sql, /revoke all on public\.shop_trust, public\.store_prices from anon/);
  assert.match(sql, /add column if not exists shop_id uuid references public\.shops/);
  assert.match(sql, /delete from shop_feedback where user_id = auth\.uid\(\)/);
});
```

- [ ] **Step 2: Run** `node --test test/schema-shops.test.js` → FAIL (no `shops` table in schema)

- [ ] **Step 3: Implement** in `supabase/schema.sql`. Insert this block after the `insights_prefs` policy/grant lines and before the line `-- Supabase default privileges may auto-grant on new public objects; strip them.`:

```sql
-- Shops: a shared, insert-only list (like price_items). No update/delete policy,
-- so existing shops cannot be vandalised. name_norm is normalised by the client
-- (lowercase, punctuation to space, collapsed whitespace); a different
-- normalisation only risks a duplicate shop, never a wrong merge.
create table if not exists public.shops (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null check (length(name) between 2 and 80),
  name_norm  text        not null check (length(name_norm) between 2 and 80),
  city       text        not null check (length(city) between 2 and 40),
  area       text        check (length(area) <= 40),
  created_at timestamptz not null default now()
);
create unique index if not exists shops_norm_city_key
  on public.shops (name_norm, lower(city));

alter table public.shops enable row level security;
drop policy if exists read_shops on public.shops;
create policy read_shops on public.shops for select to authenticated using (true);
drop policy if exists insert_shops on public.shops;
create policy insert_shops on public.shops for insert to authenticated with check (true);
grant select, insert on public.shops to authenticated;

create table if not exists public.shop_feedback (
  shop_id     uuid        not null references public.shops on delete cascade,
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  vote        smallint    not null check (vote in (-1, 1)),
  reasons     text[]      not null default '{}' check (reasons <@ array['price','quality','honest','fast']),
  bill_backed boolean     not null default false,
  created_at  timestamptz not null default now(),
  primary key (shop_id, user_id)
);
alter table public.shop_feedback enable row level security;
drop policy if exists own_shop_feedback on public.shop_feedback;
create policy own_shop_feedback on public.shop_feedback for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.shop_feedback to authenticated;

alter table public.contributions
  add column if not exists shop_id uuid references public.shops on delete set null;

-- Owner-run (not security_invoker): shop_feedback is own-rows-only under RLS, so
-- the aggregate must bypass it. Safe because the view only emits shops with >= 5
-- voters and exposes counts, never user ids. One row per user per shop, so
-- count(*) is the number of distinct voters. bill_backed votes weigh 2.
create or replace view public.shop_trust as
  select f.shop_id,
         count(*) filter (where f.vote = 1)  as up,
         count(*) filter (where f.vote = -1) as down,
         count(*)                            as voters,
         (sum(case when f.vote = 1 then (case when f.bill_backed then 2 else 1 end) else 0 end)::numeric
           / sum(case when f.bill_backed then 2 else 1 end))::numeric(4,3) as score_share,
         (select coalesce(array_agg(x.r order by x.cnt desc), '{}')
            from (select r, count(*) as cnt
                    from shop_feedback f2, unnest(f2.reasons) as r
                   where f2.shop_id = f.shop_id and f2.vote = 1
                   group by r order by cnt desc limit 2) x) as top_reasons
  from shop_feedback f
  group by f.shop_id
  having count(*) >= 5;

create or replace view public.store_prices as
  select c.model_id, c.item_key, c.shop_id, s.name as shop_name, s.city, s.area,
         (percentile_cont(0.5) within group (order by c.price))::numeric(10,2) as median_price,
         count(*) as n
  from contributions c
  join contribution_links l on l.contribution_id = c.id
  join shops s on s.id = c.shop_id
  where c.kind = 'part' and c.price is not null
  group by c.model_id, c.item_key, c.shop_id, s.name, s.city, s.area
  having count(distinct l.user_id) >= 5;

grant select on public.shop_trust, public.store_prices to authenticated;
revoke all on public.shop_trust, public.store_prices from anon;
```

Then edit the two functions already in the file:
- `submit_contributions`: add `shop_id` to the insert column list and `(r->>'shop_id')::uuid` to the values; add `shop_id = (r->>'shop_id')::uuid,` to the `update contributions set` list. A bad uuid or a non-existent shop raises inside the per-row `begin ... exception when others then null` block, so only that row is skipped.
- `delete_my_contributions`: before the existing `with gone as (...)` statement add `delete from shop_feedback where user_id = auth.uid();`.

Because `contributions.shop_id` and `shops` are created in the new block, which sits **after** the original `submit_contributions` definition in the file, place this whole new block **before** the `create or replace function public.submit_contributions` line instead if `shop_id` would otherwise be referenced before it exists (plpgsql bodies are not checked at creation, so either order applies cleanly, but keeping tables before functions reads best — move the block up if simple).

- [ ] **Step 4: Run** `node --test test/schema-shops.test.js` → PASS

- [ ] **Step 5: Verify on a local Postgres** (not just static text). Start Postgres 16 (`/opt/homebrew/opt/postgresql@16/bin`; initdb with `--locale=en_US.UTF-8 -E UTF8`; socket dir must be short, e.g. `/tmp/pgs`). Create stub `auth.users`, `auth.uid()` (reads `request.jwt.claim.sub`), `auth.role()`, `storage.buckets` (+ `file_size_limit`, `allowed_mime_types`), `storage.objects`, `storage.foldername()`, roles `anon`/`authenticated`, default grants for both roles. Apply `schema.sql` **twice** (must be idempotent, no errors). Then write and run `supabase/tests/shops-rls.sql` asserting: (a) `authenticated` can insert/select `shops`, cannot update/delete; (b) duplicate `(name_norm, lower(city))` insert fails with 23505; (c) same name in another city succeeds; (d) a user's `shop_feedback` is visible only to them, a second vote upserts to one row, reason `'bogus'` fails; (e) `shop_trust` returns nothing with 4 voters and a row with 5, with a bill-backed down-vote lowering `score_share` by weight 2; (f) `store_prices` empty with 4 contributors, one row with 5, rows missing `shop_id` excluded; (g) `delete_my_contributions()` removes the caller's `shop_feedback`; (h) `anon` cannot select either view. Stop and remove the temporary cluster afterwards.

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql supabase/tests/shops-rls.sql test/schema-shops.test.js
git commit -m "feat(shops): shops, feedback, trust and store-price views"
```

---

### Task 2: `shops.js` client module

**Files:**
- Create: `src/data/shops.js`, `test/shops.test.js`
- Modify: `index.html` (script tag after `insights.js`), `sw.js` (ASSETS entry, bump `CACHE`), `test/helpers/boot.js` (file list), `main.js` (`shops.configure({ client })` in `connectBackend`)

**Interfaces:**
- Produces (global `shops` / `module.exports`): `CITIES`, `REASONS`, `configure({client})`, `reset()`, `available()`, `norm(s)`, `findExact(name, city)`, `create(name, city, area)`, `findOrCreate(name, city, area) -> Promise<{id,name,city,area}|null>`, `search(query, city) -> Promise<row[]>`, `vote(shopId, up:boolean, reasons) -> Promise<boolean>`, `getTrust(shopIds) -> Promise<row[]>`, `getStorePrices(modelId, itemKey) -> Promise<row[]>`, pure `lastCity(history) -> string`, pure `storeAdvice(prices, trustRows, city) -> null | {shopId,name,city,area,medianPrice,n,local,trusted,pct,voters}`.
- Every network function resolves (never rejects); failures give `null`/`[]`/`false`.

- [ ] **Step 1: Write failing tests** `test/shops.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const shops = require('../src/data/shops.js');

/* A thenable query builder: any chained call records itself and returns the
   same object; awaiting it yields the queued result. */
function chain(result, log) {
  const o = {};
  ['select', 'eq', 'ilike', 'in', 'limit', 'insert', 'upsert', 'order', 'maybeSingle', 'single'].forEach(m => {
    o[m] = (...a) => { log.push([m, ...a]); return o; };
  });
  o.then = (res, rej) => Promise.resolve(result).then(res, rej);
  return o;
}
function queueClient(results, log) {
  const q = results.slice();
  return { from: table => { log.push(['from', table]); return chain(q.length ? q.shift() : { data: null, error: null }, log); } };
}
const row = { id: 's1', name: 'Al-Salam Auto', city: 'Jeddah', area: 'Safa' };

test.beforeEach(() => shops.reset());

test('norm folds case, punctuation and spacing, keeps Arabic letters', () => {
  assert.strictEqual(shops.norm('Al-Salam  Auto!'), 'al salam auto');
  assert.strictEqual(shops.norm('  al salam auto '), 'al salam auto');
  assert.strictEqual(shops.norm('مركز السلام'), 'مركز السلام');
  assert.strictEqual(shops.norm(null), '');
});

test('findOrCreate returns the existing shop without inserting', async () => {
  const log = [];
  shops.configure({ client: queueClient([{ data: row, error: null }], log) });
  assert.deepStrictEqual(await shops.findOrCreate('Al-Salam Auto', 'Jeddah', 'Safa'), row);
  assert.ok(!log.some(l => l[0] === 'insert'));
});

test('findOrCreate inserts when none exists, with the normalised key', async () => {
  const log = [];
  shops.configure({ client: queueClient([{ data: null, error: null }, { data: row, error: null }], log) });
  assert.deepStrictEqual(await shops.findOrCreate('Al-Salam Auto', 'Jeddah', 'Safa'), row);
  const ins = log.find(l => l[0] === 'insert')[1];
  assert.deepStrictEqual(ins, { name: 'Al-Salam Auto', name_norm: 'al salam auto', city: 'Jeddah', area: 'Safa' });
});

test('findOrCreate resolves a unique-violation race to the winner row', async () => {
  const log = [];
  shops.configure({ client: queueClient([
    { data: null, error: null },
    { data: null, error: { code: '23505' } },
    { data: row, error: null }], log) });
  assert.deepStrictEqual(await shops.findOrCreate('Al-Salam Auto', 'Jeddah', ''), row);
});

test('findOrCreate refuses too-short names or a missing city, and works without a client', async () => {
  shops.configure({ client: queueClient([], []) });
  assert.strictEqual(await shops.findOrCreate('x', 'Jeddah'), null);
  assert.strictEqual(await shops.findOrCreate('Al-Salam Auto', ''), null);
  shops.reset();
  assert.strictEqual(await shops.findOrCreate('Al-Salam Auto', 'Jeddah'), null);
});

test('network functions never reject', async () => {
  shops.configure({ client: { from: () => { throw new Error('boom'); } } });
  assert.strictEqual(await shops.findOrCreate('Al-Salam Auto', 'Jeddah'), null);
  assert.deepStrictEqual(await shops.search('salam', 'Jeddah'), []);
  assert.strictEqual(await shops.vote('s1', true, []), false);
  assert.deepStrictEqual(await shops.getTrust(['s1']), []);
  assert.deepStrictEqual(await shops.getStorePrices('m', 'k'), []);
});

test('search needs two characters and a client', async () => {
  assert.deepStrictEqual(await shops.search('salam', 'Jeddah'), []);
  const log = [];
  shops.configure({ client: queueClient([{ data: [row], error: null }], log) });
  assert.deepStrictEqual(await shops.search('s', ''), []);
  assert.deepStrictEqual(await shops.search('Salam', 'Jeddah'), [row]);
});

test('vote upserts one row, drops unknown reasons, is never bill-backed yet', async () => {
  const log = [];
  shops.configure({ client: queueClient([{ error: null }], log) });
  assert.strictEqual(await shops.vote('s1', false, ['price', 'bogus']), true);
  const up = log.find(l => l[0] === 'upsert');
  assert.deepStrictEqual(up[1], { shop_id: 's1', vote: -1, reasons: ['price'], bill_backed: false });
  assert.deepStrictEqual(up[2], { onConflict: 'shop_id,user_id' });
  assert.strictEqual(await shops.vote('', true, []), false);
});

test('getTrust with no ids makes no request', async () => {
  const log = [];
  shops.configure({ client: queueClient([], log) });
  assert.deepStrictEqual(await shops.getTrust([]), []);
  assert.strictEqual(log.length, 0);
});

test('lastCity returns the city of the most recent entry with a shop', () => {
  const h = [{ date: '2026-01-01', shop: { city: 'Riyadh' } }, { date: '2026-03-01', shop: { city: 'Jeddah' } }, { date: '2026-05-01' }];
  assert.strictEqual(shops.lastCity(h), 'Jeddah');
  assert.strictEqual(shops.lastCity([]), '');
  assert.strictEqual(shops.lastCity(undefined), '');
});

test('storeAdvice prefers the user\'s city, cheapest first, with trust thresholds', () => {
  const prices = [
    { shop_id: 'a', shop_name: 'A', city: 'Riyadh', area: null, median_price: '90.00', n: 6 },
    { shop_id: 'b', shop_name: 'B', city: 'Jeddah', area: 'Safa', median_price: '120.00', n: 7 },
    { shop_id: 'c', shop_name: 'C', city: 'jeddah', area: null, median_price: '150.00', n: 5 }];
  const trust = [{ shop_id: 'b', voters: 5, score_share: '0.800' }, { shop_id: 'c', voters: 9, score_share: '0.790' }];
  const a = shops.storeAdvice(prices, trust, 'Jeddah');
  assert.strictEqual(a.name, 'B');
  assert.strictEqual(a.local, true);
  assert.strictEqual(a.trusted, true);
  assert.strictEqual(a.pct, 80);
  const other = shops.storeAdvice(prices, trust, 'Dammam');
  assert.strictEqual(other.name, 'A');
  assert.strictEqual(other.local, false);
  assert.strictEqual(other.trusted, false);
  assert.strictEqual(other.pct, null);
  const c = shops.storeAdvice([prices[2]], trust, 'Jeddah');
  assert.strictEqual(c.trusted, false);
  assert.strictEqual(c.pct, 79);
  assert.strictEqual(shops.storeAdvice([], trust, 'Jeddah'), null);
});
```

- [ ] **Step 2: Run** `node --test test/shops.test.js` → FAIL (cannot find module)

- [ ] **Step 3: Implement** `src/data/shops.js`

```js
/* ============================================================
   Shops — shared shop list, trust votes, store prices.

   Dual-mode, like pricing.js and insights.js. Every network call
   resolves; failures never block a local save.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else root.shops = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const CITIES = ['Jeddah', 'Riyadh', 'Makkah', 'Madinah', 'Dammam', 'Khobar', 'Taif', 'Tabuk', 'Abha', 'Buraidah', 'Hail', 'Jazan', 'Yanbu'];
  const REASONS = ['price', 'quality', 'honest', 'fast'];
  const TRUSTED_SHARE = 0.8;   // the view already hides shops under 5 voters

  let env = { client: null };
  const configure = next => { env = Object.assign({}, env, next || {}); };
  const reset = () => { env = { client: null }; };
  const available = () => !!env.client;

  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const like = s => String(s).replace(/[%_\\]/g, ch => '\\' + ch);   // ilike wildcards mean nothing to a user
  const unwrap = res => (res && !res.error && res.data) || null;

  function findExact(name, city) {
    if (!env.client) return Promise.resolve(null);
    return Promise.resolve().then(() => env.client.from('shops').select('id,name,city,area')
      .eq('name_norm', norm(name)).ilike('city', like(String(city).trim())).maybeSingle())
      .then(unwrap).catch(() => null);
  }
  function create(name, city, area) {
    if (!env.client) return Promise.resolve(null);
    return Promise.resolve().then(() => env.client.from('shops')
      .insert({ name: String(name).trim().slice(0, 80), name_norm: norm(name).slice(0, 80), city: String(city).trim().slice(0, 40), area: String(area || '').trim().slice(0, 40) || null })
      .select('id,name,city,area').single())
      .then(res => {
        // A concurrent submitter won the race for this exact shop: use theirs.
        if (res && res.error) return res.error.code === '23505' ? findExact(name, city) : null;
        return (res && res.data) || null;
      }).catch(() => null);
  }
  function findOrCreate(name, city, area) {
    if (norm(name).length < 2 || String(city || '').trim().length < 2) return Promise.resolve(null);
    return findExact(name, city).then(s => s || create(name, city, area));
  }

  function search(query, city) {
    const q = norm(query);
    if (!env.client || q.length < 2) return Promise.resolve([]);
    return Promise.resolve().then(() => {
      let req = env.client.from('shops').select('id,name,city,area').ilike('name_norm', `%${like(q)}%`);
      if (String(city || '').trim()) req = req.ilike('city', like(String(city).trim()));
      return req.limit(8);
    }).then(res => unwrap(res) || []).catch(() => []);
  }

  /* bill_backed stays false until bill reading exists and the server can verify it. */
  function vote(shopId, up, reasons) {
    if (!env.client || !shopId) return Promise.resolve(false);
    const row = { shop_id: shopId, vote: up ? 1 : -1, reasons: (reasons || []).filter(r => REASONS.includes(r)), bill_backed: false };
    return Promise.resolve().then(() => env.client.from('shop_feedback').upsert(row, { onConflict: 'shop_id,user_id' }))
      .then(res => !(res && res.error)).catch(() => false);
  }

  function getTrust(shopIds) {
    if (!env.client || !shopIds || !shopIds.length) return Promise.resolve([]);
    return Promise.resolve().then(() => env.client.from('shop_trust').select('*').in('shop_id', shopIds))
      .then(res => unwrap(res) || []).catch(() => []);
  }
  function getStorePrices(modelId, itemKey) {
    if (!env.client) return Promise.resolve([]);
    return Promise.resolve().then(() => env.client.from('store_prices').select('*').eq('model_id', modelId).eq('item_key', itemKey))
      .then(res => unwrap(res) || []).catch(() => []);
  }

  function lastCity(history) {
    const h = (history || []).filter(e => e && e.shop && e.shop.city)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    return h ? h.shop.city : '';
  }

  /* Cheapest shop, the user's own city first. Trust figures only exist for shops with >= 5 voters. */
  function storeAdvice(prices, trustRows, city) {
    if (!prices || !prices.length) return null;
    const c = norm(city);
    const local = prices.filter(p => norm(p.city) === c);
    const pool = local.length ? local : prices;
    const best = pool.slice().sort((a, b) => Number(a.median_price) - Number(b.median_price))[0];
    const tr = (trustRows || []).find(r => r.shop_id === best.shop_id);
    const share = tr ? Number(tr.score_share) : null;
    return {
      shopId: best.shop_id, name: best.shop_name, city: best.city, area: best.area,
      medianPrice: Number(best.median_price), n: Number(best.n), local: local.length > 0,
      trusted: share != null && share >= TRUSTED_SHARE,
      pct: share == null ? null : Math.round(share * 100),
      voters: tr ? Number(tr.voters) : 0
    };
  }

  return { CITIES, REASONS, configure, reset, available, norm, findExact, create, findOrCreate, search, vote, getTrust, getStorePrices, lastCity, storeAdvice };
});
```

Wire-up (mirror how `insights.js` was added): `<script src="src/data/shops.js"></script>` after the insights tag in `index.html`; `'./src/data/shops.js'` in `sw.js` ASSETS and bump `CACHE`; `'src/data/shops.js'` in `test/helpers/boot.js`'s list in the same position; `shops.configure({ client });` in `connectBackend()` in `main.js`.

- [ ] **Step 4: Run** `node --test test/shops.test.js` → PASS; then `npm test` (boot and precache tests prove the wiring)

- [ ] **Step 5: Commit**

```bash
git add src/data/shops.js test/shops.test.js index.html sw.js test/helpers/boot.js main.js
git commit -m "feat(shops): shops client module with find-or-create, votes and store advice"
```

---

### Task 3: Contributions carry `shop_id`

**Files:**
- Modify: `src/data/insights.js` (`partContributions`), `test/insights.test.js`

**Interfaces:**
- Consumes: Task 1 `contributions.shop_id`.
- Produces: `insights.partContributions({ modelId, vehicleId, historyEntry, priorHistory, shopId })` — each row gains `shop_id` only when `shopId` is a non-empty string. Existing callers that omit it get identical rows to before.

- [ ] **Step 1: Write failing tests** (append to `test/insights.test.js`)

```js
test('partContributions adds shop_id only when a shop was resolved', () => {
  const h = { id: 'h1', date: '2026-08-17', odometer: 52300, parts: [{ part: 'Oil Filter', brand: 'Bosch', price: 40 }] };
  const without = ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: h, priorHistory: [] });
  assert.strictEqual('shop_id' in without[0], false);
  const withShop = ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: h, priorHistory: [], shopId: 'shop-1' });
  assert.strictEqual(withShop[0].shop_id, 'shop-1');
  assert.strictEqual(ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: h, priorHistory: [], shopId: '' })[0].shop_id, undefined);
});
```

- [ ] **Step 2: Run** `node --test test/insights.test.js` → FAIL
- [ ] **Step 3: Implement** — add `shopId` to the destructured parameters of `partContributions` and spread `...(shopId ? { shop_id: shopId } : {})` into the row object it returns. No other change.
- [ ] **Step 4: Run** `node --test test/insights.test.js` → PASS
- [ ] **Step 5: Commit** `git add src/data/insights.js test/insights.test.js && git commit -m "feat(shops): part contributions carry shop_id"`

---

### Task 4: Shop field, feedback prompt, and purchase wiring

**Files:**
- Create: `src/ui/shop-field.js`, `src/ui/shop-feedback.js`
- Modify: `src/pages/maintenance.js` (`openLogConfirm`, `openAddHistory`, new `afterPurchase`), `index.html`, `sw.js` (ASSETS + `CACHE`), `test/helpers/boot.js`, `src/i18n/strings.ar.js`, `test/no-raw-templates.test.js` only if its file list needs the new UI files (check how it enumerates files)

**Interfaces:**
- Consumes: Task 2 `shops.*`, Task 3 `partContributions({..., shopId})`, existing globals `el`, `field`, `html`, `t`, `openModal`, `closeModal`, `toast`, `onAsyncClick`, `uid`, `session`, `insights`, `contribute` (main.js).
- Produces: `shopField(initial?) -> { nodes: Element[], value(): null | {name, city, area} }`; `openShopFeedback(shop)`; history entries gain optional `shop: {name, city, area}` (no id stored).

Behaviour (the implementer writes the code; these are the exact requirements):

1. `shopField(initial)`: three inputs — Shop (optional) with a `<datalist>` of suggestions, City (`<datalist>` of `shops.CITIES`, default `initial.city` else `shops.lastCity(session.current().history)`), Area. Typing in Shop calls `shops.search(value, city)`; a response is ignored if a newer keystroke happened (sequence counter); suggestion options use `value = name`, `label = area || city`. Picking a suggested name fills empty City/Area from that row. `value()` returns `null` when the name is blank, else the trimmed triple. Build option elements with DOM calls (`el('option')`, `.value`), never string-concatenated HTML.
2. `openShopFeedback(shop)`: modal titled "Would you buy from this shop again?", subtitle `shop.name · shop.city`. 👍 / 👎 toggle buttons (send disabled until one chosen), four reason chips (labels: Good price, Quality work, Honest, Fast; keys `price, quality, honest, fast`), **Send** (`onAsyncClick` → `shops.vote(shop.id, up, reasons)` → close → toast "Thanks for the feedback" or warn toast "Could not send feedback") and **Not now** (closes). All text via `t()` + the `html` template.
3. `afterPurchase(logged, shopIn, cur, vid)` in `maintenance.js` — async, fully wrapped in try/catch, never awaited by the save path:
   ```js
   async function afterPurchase(logged, shopIn, cur, vid) {
     try {
       const shop = shopIn ? await shops.findOrCreate(shopIn.name, shopIn.city, shopIn.area) : null;
       contribute(logged.flatMap(h => insights.partContributions({ modelId: cur.car.modelId, vehicleId: vid, historyEntry: h, priorHistory: cur.history, shopId: shop && shop.id })));
       if (shop && await insights.shareEnabled()) openShopFeedback(shop);
     } catch (e) { /* shop features are optional; the save already succeeded */ }
   }
   ```
4. `openLogConfirm`: after the odometer/date row append `shopField().nodes`. In the Log button handler read `const shopIn = shopF.value();` **before** `closeModal()` (the DOM is gone afterwards); set `h.shop = shopIn` on every logged entry when non-null; replace the existing `if (ok) contribute(...)` line with `if (ok) afterPurchase(logged, shopIn, cur, vid);`.
5. `openAddHistory`: append `shopField(e && e.shop).nodes` before the receipt picker; read `value()` before saving; set `obj.shop` when non-null (and `delete` it when editing and the field is cleared). For a **new** entry (`!editing`) with a shop, after a successful save call `afterPurchase([], shopIn, cur, vid)` (no parts, so only the feedback prompt runs). Editing never prompts.
6. Strings in `strings.ar.js` (add each new key once): `Shop (optional)`, `City`, `Area` (skip any that already exist), `Would you buy from this shop again?`, `Good price`, `Quality work`, `Honest`, `Fast`, `Send`, `Not now`, `Thanks for the feedback`, `Could not send feedback`.

- [ ] **Step 1: Write failing tests.** Behaviour that is pure already lives in Task 2. For the UI, use the existing DOM test harness (`test/dom-harness.test.js` shows how pages are loaded; copy its approach) to add `test/shop-field.test.js`: (a) `value()` is `null` for a blank name and a trimmed triple otherwise; (b) the City input defaults to the city of the latest history entry with a shop; (c) a stale search response (older keystroke resolving last) does not overwrite newer suggestions; (d) suggestion options are real `option` elements whose `value` equals the shop name, even for a name containing `<b>"&`. If the harness cannot host these, say so in the report and cover (a)–(d) with the smallest working alternative; do not skip silently.
- [ ] **Step 2: Run** the new test → FAIL
- [ ] **Step 3: Implement** items 1-6 above. Check neighbouring modals for the real class names (`field-row`, button classes) and copy them. Add both new `src/ui/*.js` files to `index.html`, `sw.js` ASSETS and `test/helpers/boot.js`; bump `sw.js` `CACHE`.
- [ ] **Step 4: Run** `npm test` (includes `no-raw-templates` and precache tests) and `npm run test:e2e` — both must pass (1 skip is intentional).
- [ ] **Step 5: Confirm** `normalizeRecords` (`src/data/storage.js`) keeps an unknown `shop` object on history entries (it only normalises id/date/cost/odometer) by adding one assertion to `test/storage.test.js`: a history entry with `shop` survives `normalizeRecords`.
- [ ] **Step 6: Commit**

```bash
git add src/ui/shop-field.js src/ui/shop-feedback.js src/pages/maintenance.js index.html sw.js test/helpers/boot.js src/i18n/strings.ar.js test
git commit -m "feat(shops): pick a shop on purchases and ask for feedback"
```

---

### Task 5: Cheapest shop and trust on the Parts page

**Files:**
- Modify: `src/pages/parts.js`, `src/i18n/strings.ar.js`

**Interfaces:**
- Consumes: `shops.getStorePrices`, `shops.getTrust`, `shops.storeAdvice`, `shops.lastCity`; the existing insight block in `parts.js` (~line 81) and its `life_${p.id}` slot (~line 148).

- [ ] **Step 1:** In the card markup add `<div class="muted" id="shop_${p.id}" style="font-size:11px;margin-top:2px"></div>` directly under the `life_${p.id}` line (~148).
- [ ] **Step 2:** Inside the existing `if (insights.available()) items.forEach(p => { try { ... } })` block, after the brand-life call, add:

```js
shops.getStorePrices(cur.car.modelId, key).then(prices => {
  if (!prices.length) return;
  return shops.getTrust(prices.map(r => r.shop_id)).then(trust => {
    const a = shops.storeAdvice(prices, trust, shops.lastCity(cur.history));
    const slot = a && document.getElementById(`shop_${p.id}`);
    if (!slot) return;
    slot.textContent = `${a.local ? `${t('Cheapest in')} ${a.city}` : t('Cheapest shop')}: ${a.name}${a.area ? ` (${a.area})` : ''}, SAR ${a.medianPrice}` +
      (a.trusted ? ` · ✓ ${t('Trusted')} (${a.pct}%)` : '');
  });
}).catch(() => {});
```

Uses `textContent`, so shop names (user-created) cannot inject markup. `key` and `cur` are the variables already in scope in that block. A stale slot (page re-rendered) is skipped by the null check.
- [ ] **Step 3:** Strings: `Cheapest in`, `Cheapest shop`, `Trusted`.
- [ ] **Step 4: Test** — add to `test/shops.test.js` nothing new (pure logic is covered in Task 2); add a DOM/render test only if `test/render.test.js` already renders the Parts page with mocked globals — if so add one asserting that with `shops.getStorePrices` stubbed to one row the slot text contains the shop name and `<script>` in a shop name appears as text. Otherwise state in the report that the line is covered by Task 2's `storeAdvice` tests plus the manual check in Task 6.
- [ ] **Step 5: Run** `npm test` and `npm run test:e2e`.
- [ ] **Step 6: Commit** `git add src/pages/parts.js src/i18n/strings.ar.js test && git commit -m "feat(shops): show cheapest shop and trust on parts"`

---

### Task 6: Live verification (manual)

Cannot be automated without a live Supabase project (same gate as the pending Phase 4/5a checks). Re-apply `supabase/schema.sql` first (idempotent), then with 5 test users:

1. Each user logs a service with the same part and the same shop (typed with different spacing/case on some users); confirm one `shops` row exists (`select * from shops`).
2. `store_prices` is empty after 4 users, shows one row after the 5th; the Parts page then shows "Cheapest in <city>".
3. Each user answers the feedback prompt; `shop_trust` empty at 4 voters, a row at 5; "✓ Trusted" appears only at >= 80%.
4. A user changes their vote: still one `shop_feedback` row for them.
5. A user turns sharing off: their votes disappear, the prompt no longer appears, `shop_trust`/`store_prices` drop back under the floor.
6. Offline/signed-out purchase with a shop typed: entry saves and shows the shop; no error toast.
7. Arabic UI: field labels, prompt, reason chips, and the advice line.

Report pass/fail per item. Fix anything found before release. Record the result next to the pending Phase 5a verification note.

---

## Deviations from the spec (update the spec when shipped)

- `contributions` stores only `shop_id`; city/area come from the `shops` row via join (spec listed `store_norm, city, area` on the contribution). One source of truth, no drift.
- Name normalisation turns punctuation into spaces (`Al-Salam` -> `al salam`) rather than deleting it, so hyphenated and spaced spellings meet.
- `bill_backed` is always `false` from the client until Plan 3; the column and 2x weighting exist, but a client-supplied flag must **not** be trusted — Plan 3 must set it server-side from a verified bill before the weighting means anything.
- Trust reasons are collected and the view returns `top_reasons`, but the UI does not display them yet.
- Opt-out also deletes the user's votes (spec only said contributions).

## Known gaps (accepted)

- A shop id is resolved at save time, not stored on the history entry; editing an entry later does not re-contribute with a shop.
- No shop merge/report tool; duplicate spellings stay separate (spec Risks).
- Self-voting and vote-brigading are limited only by the 5-voter floor and one vote per account (spec Risks).
- Fake accounts are mitigated, not eliminated: only qualified users (7+ days old, confirmed email or phone) count toward aggregates and the 5-voter floor.
