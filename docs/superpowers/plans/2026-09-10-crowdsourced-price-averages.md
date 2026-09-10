# Crowdsourced Price Averages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user pick a shared "priceable item" (or add a new one), submit
what they paid, and see the community average + sample count on the Parts page and in Add
Spending.

**Architecture:** One new dual-mode module (`src/data/pricing.js`, same shape as
`src/data/account.js`) owns all reads/writes against two new public Supabase tables
(`price_items`, `price_observations`) and a view (`price_item_averages`). It reuses
`account.js` for auth state (`account.available()`, `account.user()`) rather than
re-deriving it, and takes its own Supabase client via `configure({ client })`, wired at
boot from the same client `account.js` uses. `parts.js` and `budget.js` are extended, not
rewritten, to call into `pricing.js` and render its results.

**Tech Stack:** Vanilla JS, `node --test` + `linkedom` for tests (existing conventions),
Supabase Postgres + RLS.

**Spec:** `docs/superpowers/specs/2026-09-10-crowdsourced-price-averages-design.md`

## Global Constraints

- SAR only — no currency field anywhere in this feature (spec: "SAR only").
- No offline queue for submissions — requires being online + signed in; fails inline on
  error, same pattern as the existing auth form (spec: "No outbox").
- `price_items` rows are never updated or deleted by application code — no such functions
  exist in `pricing.js`, and no RLS policy grants it (spec: "Immutable items, no
  moderation").
- Plain `avg()` via the `price_item_averages` view — no outlier trimming/weighting (spec:
  "Plain SQL view for the average").
- This cannot be exercised end-to-end until a live Supabase project exists (spec: "Open
  dependency"). Every task below is independently testable with a fake client the way
  `test/account.test.js` already does it — see Task 2's `fakeClient()` helper, reused by
  every later task.

---

### Task 1: Schema — `price_items`, `price_observations`, the averages view, and RLS

**Files:**
- Modify: `supabase/schema.sql` (append; the file's own header says "safe to re-run")

**Interfaces:**
- Produces: the `public.price_items`, `public.price_observations` tables and
  `public.price_item_averages` view that every later task's fake-client tests assume
  exist, and that the real client will hit once a live project applies this file.

- [ ] **Step 1: Append the new tables, index, view, trigger reuse, RLS policies, and
  grants to `supabase/schema.sql`**

  Add this block at the end of the file, after the existing `own_photos` policy:

  ```sql
  -- Crowdsourced price averages. Public/shared tables — unlike vehicles/garage
  -- above, RLS here grants every authenticated user read access to everyone's
  -- rows, because the whole point is seeing what other people paid. See
  -- docs/superpowers/specs/2026-09-10-crowdsourced-price-averages-design.md.

  create table if not exists public.price_items (
    id             uuid        primary key default gen_random_uuid(),
    label          text        not null,
    category       text        not null,
    source_part_no text,
    created_by     uuid        not null default auth.uid() references auth.users,
    created_at     timestamptz not null default now()
  );

  create table if not exists public.price_observations (
    id           uuid        primary key default gen_random_uuid(),
    item_id      uuid        not null references public.price_items on delete cascade,
    user_id      uuid        not null default auth.uid() references auth.users on delete cascade,
    price        numeric     not null check (price > 0),
    submitted_at timestamptz not null default now()
  );

  create index if not exists price_observations_item_idx
    on public.price_observations (item_id);

  -- Reuses set_updated_at()'s sibling idea (server-authored timestamp) but
  -- observations are insert-only, so a plain default is enough — no update
  -- path exists that a client-supplied timestamp could smuggle a bad value
  -- through.
  create or replace view public.price_item_averages as
    select item_id, avg(price)::numeric(10,2) as avg_price, count(*) as sample_count
    from public.price_observations
    group by item_id;

  alter table public.price_items enable row level security;
  alter table public.price_observations enable row level security;

  drop policy if exists read_price_items on public.price_items;
  create policy read_price_items on public.price_items for select
    using (auth.role() = 'authenticated');

  drop policy if exists insert_price_items on public.price_items;
  create policy insert_price_items on public.price_items for insert
    with check (created_by = auth.uid());

  -- No update/delete policy on price_items at all — deliberate, see spec's
  -- "Immutable items, no moderation" decision. RLS defaults to deny when no
  -- policy matches, so this alone is what makes items permanent.

  drop policy if exists read_price_observations on public.price_observations;
  create policy read_price_observations on public.price_observations for select
    using (auth.role() = 'authenticated');

  drop policy if exists own_price_observations on public.price_observations;
  create policy own_price_observations on public.price_observations for insert
    with check (user_id = auth.uid());

  drop policy if exists update_own_price_observations on public.price_observations;
  create policy update_own_price_observations on public.price_observations for update
    using (user_id = auth.uid()) with check (user_id = auth.uid());

  drop policy if exists delete_own_price_observations on public.price_observations;
  create policy delete_own_price_observations on public.price_observations for delete
    using (user_id = auth.uid());

  grant select, insert on public.price_items to authenticated;
  grant select, insert, update, delete on public.price_observations to authenticated;
  grant select on public.price_item_averages to authenticated;
  ```

- [ ] **Step 2: Sanity-check the SQL with a syntax-only check (no live project needed
  yet)**

  Run: `node -e "require('fs').readFileSync('supabase/schema.sql','utf8').split(';').forEach(s => {})"`

  This only confirms the file parses as a sequence of statements (a crude smoke check —
  real validation happens when this is applied to the live project per the plan's Global
  Constraints). Expected: no error thrown.

- [ ] **Step 3: Commit**

  ```bash
  git add supabase/schema.sql
  git commit -m "schema: add price_items/price_observations for crowdsourced pricing"
  ```

---

### Task 2: `src/data/pricing.js` — module skeleton, `configure`, `available`

**Files:**
- Create: `src/data/pricing.js`
- Test: `test/pricing.test.js`
- Modify: `index.html:152` (add `<script src="src/data/pricing.js"></script>` immediately
  after the existing `<script src="src/data/account.js"></script>` line, since later tasks'
  UI code depends on it and it must load after `account.js`)

**Interfaces:**
- Consumes: `account.available()`, `account.user()` (both already exported by
  `src/data/account.js`, used exactly as `src/pages/*.js` files already use other
  `account.js` exports).
- Produces: `pricing.configure({ client })`, `pricing.available()` — used by every
  later task in this module and by the UI tasks (9, 10).

- [ ] **Step 1: Write failing tests for `configure`/`available`**

  Create `test/pricing.test.js`:

  ```js
  'use strict';
  const test = require('node:test');
  const assert = require('node:assert');
  const pricing = require('../src/data/pricing.js');

  function fakeClient() {
    return { from: () => ({}) };
  }

  test.beforeEach(() => { pricing.reset(); });

  test('available() is false with no client configured', () => {
    assert.strictEqual(pricing.available(), false);
  });

  test('available() is true once a client is configured', () => {
    pricing.configure({ client: fakeClient() });
    assert.strictEqual(pricing.available(), true);
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `node --test test/pricing.test.js`
  Expected: FAIL — `Cannot find module '../src/data/pricing.js'`

- [ ] **Step 3: Write the module skeleton**

  Create `src/data/pricing.js`:

  ```js
  /* ============================================================
     Garage — crowdsourced price averages. Dual-mode, like account.js
     and storage.js. Owns two public Supabase tables (price_items,
     price_observations) that are readable by every signed-in user,
     unlike the private per-user tables account.js owns.

     Auth state is not re-derived here — account.available() and
     account.user() are the source of truth; this module only adds
     its own Supabase client via configure().
     ============================================================ */
  'use strict';
  (function (root, factory) {
    const isNode = typeof module !== 'undefined' && module.exports;
    const dep = isNode ? require('./account.js') : root.account;
    const api = factory(dep);
    if (isNode) module.exports = api;
    else root.pricing = api;
  })(typeof self !== 'undefined' ? self : globalThis, function (account) {

    let env = { client: null };

    function configure(next) { env = Object.assign({}, env, next || {}); }
    function reset() { env = { client: null }; }
    function available() { return !!env.client; }

    return { configure, reset, available };
  });
  ```

- [ ] **Step 4: Run tests to verify they pass**

  Run: `node --test test/pricing.test.js`
  Expected: PASS (2 tests)

- [ ] **Step 5: Add the script tag and confirm the full suite still passes**

  In `index.html`, after line 152 (`<script src="src/data/account.js"></script>`), add:

  ```html
  <script src="src/data/pricing.js"></script>
  ```

  Run: `npm test`
  Expected: PASS, same count as before plus the 2 new tests.

- [ ] **Step 6: Commit**

  ```bash
  git add src/data/pricing.js test/pricing.test.js index.html
  git commit -m "pricing: add module skeleton with configure/available"
  ```

---

### Task 3: `pricing.searchItems(query)`

**Files:**
- Modify: `src/data/pricing.js`
- Test: `test/pricing.test.js`

**Interfaces:**
- Consumes: `env.client.from('price_items').select(...).ilike(...).limit(...)` — a
  Postgrest-style chain, matching how `account.js:295` already calls `.select(...)`.
- Produces: `pricing.searchItems(query)` → `Promise<Array<{id, label, category}>>`, used by
  Task 9 (parts.js) and Task 10 (budget.js) to populate the item picker.

- [ ] **Step 1: Write failing tests**

  Add to `test/pricing.test.js`:

  ```js
  test('searchItems() resolves the rows the client returns', async () => {
    const rows = [{ id: 'a1', label: 'Paint — full respray', category: 'Paint' }];
    pricing.configure({ client: {
      from: table => {
        assert.strictEqual(table, 'price_items');
        return { select: () => ({ ilike: () => ({ limit: () => Promise.resolve({ data: rows, error: null }) }) }) };
      }
    } });
    const result = await pricing.searchItems('paint');
    assert.deepStrictEqual(result, rows);
  });

  test('searchItems() resolves [] on a query error rather than throwing', async () => {
    pricing.configure({ client: {
      from: () => ({ select: () => ({ ilike: () => ({ limit: () => Promise.resolve({ data: null, error: new Error('offline') }) }) }) })
    } });
    const result = await pricing.searchItems('paint');
    assert.deepStrictEqual(result, []);
  });
  ```

- [ ] **Step 2: Run to verify it fails**

  Run: `node --test test/pricing.test.js`
  Expected: FAIL — `pricing.searchItems is not a function`

- [ ] **Step 3: Implement `searchItems`**

  In `src/data/pricing.js`, add:

  ```js
  function searchItems(query) {
    if (!env.client) return Promise.resolve([]);
    return Promise.resolve(
      env.client.from('price_items').select('id,label,category').ilike('label', `%${query}%`).limit(20)
    ).then(res => (res && res.error) ? [] : (res.data || []));
  }
  ```

  Add `searchItems` to the returned object at the bottom of the factory.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `node --test test/pricing.test.js`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add src/data/pricing.js test/pricing.test.js
  git commit -m "pricing: add searchItems"
  ```

---

### Task 4: `pricing.createItem(label, category, sourcePartNo)`

**Files:**
- Modify: `src/data/pricing.js`
- Test: `test/pricing.test.js`

**Interfaces:**
- Produces: `pricing.createItem(label, category, sourcePartNo)` →
  `Promise<{id, label, category} | null>` (`null` on failure — matches Task 9/10's need to
  show an inline error the same way `budget.js`'s save handlers already do). Used by
  Task 9/10 when the user's search finds nothing and they add a new item.

- [ ] **Step 1: Write failing tests**

  Add to `test/pricing.test.js`:

  ```js
  test('createItem() inserts and resolves the created row', async () => {
    let inserted;
    pricing.configure({ client: {
      from: table => {
        assert.strictEqual(table, 'price_items');
        return { insert: row => { inserted = row; return { select: () => ({ single: () => Promise.resolve({ data: Object.assign({ id: 'new1' }, row), error: null }) }) }; } };
      }
    } });
    const item = await pricing.createItem('Paint — bumper only', 'Paint', null);
    assert.strictEqual(item.id, 'new1');
    assert.strictEqual(inserted.label, 'Paint — bumper only');
    assert.strictEqual(inserted.category, 'Paint');
    assert.strictEqual(inserted.source_part_no, null);
  });

  test('createItem() resolves null on an insert error', async () => {
    pricing.configure({ client: {
      from: () => ({ insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: new Error('offline') }) }) }) })
    } });
    const item = await pricing.createItem('Paint — bumper only', 'Paint', null);
    assert.strictEqual(item, null);
  });

  test('createItem() resolves null with no client configured', async () => {
    const item = await pricing.createItem('x', 'Other', null);
    assert.strictEqual(item, null);
  });
  ```

- [ ] **Step 2: Run to verify it fails**

  Run: `node --test test/pricing.test.js`
  Expected: FAIL — `pricing.createItem is not a function`

- [ ] **Step 3: Implement `createItem`**

  In `src/data/pricing.js`, add:

  ```js
  function createItem(label, category, sourcePartNo) {
    if (!env.client) return Promise.resolve(null);
    return Promise.resolve(
      env.client.from('price_items')
        .insert({ label, category, source_part_no: sourcePartNo || null })
        .select().single()
    ).then(res => (res && res.error) ? null : (res.data || null));
  }
  ```

  Add `createItem` to the returned object.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `node --test test/pricing.test.js`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add src/data/pricing.js test/pricing.test.js
  git commit -m "pricing: add createItem"
  ```

---

### Task 5: `pricing.submitPrice(itemId, price)`

**Files:**
- Modify: `src/data/pricing.js`
- Test: `test/pricing.test.js`

**Interfaces:**
- Consumes: `account.available()`, `account.user()` — a submission requires both a
  configured client (`env.client`) and a signed-in user, mirroring how `account.js`'s own
  writes (e.g. `saveVehicleRemote`) gate on `_user`.
- Produces: `pricing.submitPrice(itemId, price)` → `Promise<boolean>` (`true` on success),
  used by Task 9/10's "submit your price" button.

- [ ] **Step 1: Write failing tests**

  Add to `test/pricing.test.js`. This task's tests need `account.setUserForTest` (already
  exported by `account.js:291` for exactly this purpose) to simulate being signed in:

  ```js
  const account = require('../src/data/account.js');

  test('submitPrice() inserts an observation when signed in', async () => {
    let inserted;
    account.setUserForTest({ id: 'u1' });
    pricing.configure({ client: {
      from: table => {
        assert.strictEqual(table, 'price_observations');
        return { insert: row => { inserted = row; return Promise.resolve({ error: null }); } };
      }
    } });
    const ok = await pricing.submitPrice('item1', 250);
    assert.strictEqual(ok, true);
    assert.strictEqual(inserted.item_id, 'item1');
    assert.strictEqual(inserted.price, 250);
    account.setUserForTest(null);
  });

  test('submitPrice() resolves false when signed out, without touching the client', async () => {
    account.setUserForTest(null);
    pricing.configure({ client: { from: () => { throw new Error('must not be called'); } } });
    const ok = await pricing.submitPrice('item1', 250);
    assert.strictEqual(ok, false);
  });

  test('submitPrice() resolves false on an insert error', async () => {
    account.setUserForTest({ id: 'u1' });
    pricing.configure({ client: { from: () => ({ insert: () => Promise.resolve({ error: new Error('offline') }) }) } });
    const ok = await pricing.submitPrice('item1', 250);
    assert.strictEqual(ok, false);
    account.setUserForTest(null);
  });
  ```

- [ ] **Step 2: Run to verify it fails**

  Run: `node --test test/pricing.test.js`
  Expected: FAIL — `pricing.submitPrice is not a function`

- [ ] **Step 3: Implement `submitPrice`**

  In `src/data/pricing.js`, add (and require `account.user()`/`account.available()`
  through the `account` parameter already injected into the factory):

  ```js
  function submitPrice(itemId, price) {
    if (!env.client || !account.user()) return Promise.resolve(false);
    return Promise.resolve(
      env.client.from('price_observations').insert({ item_id: itemId, price })
    ).then(res => !(res && res.error));
  }
  ```

  Add `submitPrice` to the returned object.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `node --test test/pricing.test.js`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add src/data/pricing.js test/pricing.test.js
  git commit -m "pricing: add submitPrice, gated on sign-in"
  ```

---

### Task 6: `pricing.getAverages(itemIds)`

**Files:**
- Modify: `src/data/pricing.js`
- Test: `test/pricing.test.js`

**Interfaces:**
- Produces: `pricing.getAverages(itemIds)` → `Promise<Map<itemId, {avgPrice, sampleCount}>>`
  — an empty `Map` for any id with no observations yet. Used by Task 9 (parts.js, one call
  for all visible parts' items) and Task 10 (budget.js, one call for the picked item).

- [ ] **Step 1: Write failing tests**

  Add to `test/pricing.test.js`:

  ```js
  test('getAverages() maps rows from the view by item_id', async () => {
    pricing.configure({ client: {
      from: table => {
        assert.strictEqual(table, 'price_item_averages');
        return { select: () => ({ in: (_col, ids) => {
          assert.deepStrictEqual(ids, ['item1', 'item2']);
          return Promise.resolve({ data: [{ item_id: 'item1', avg_price: 250.5, sample_count: 3 }], error: null });
        } }) };
      }
    } });
    const averages = await pricing.getAverages(['item1', 'item2']);
    assert.deepStrictEqual(averages.get('item1'), { avgPrice: 250.5, sampleCount: 3 });
    assert.strictEqual(averages.has('item2'), false);
  });

  test('getAverages() resolves an empty Map for an empty list without calling the client', async () => {
    pricing.configure({ client: { from: () => { throw new Error('must not be called'); } } });
    const averages = await pricing.getAverages([]);
    assert.strictEqual(averages.size, 0);
  });
  ```

- [ ] **Step 2: Run to verify it fails**

  Run: `node --test test/pricing.test.js`
  Expected: FAIL — `pricing.getAverages is not a function`

- [ ] **Step 3: Implement `getAverages`**

  In `src/data/pricing.js`, add:

  ```js
  function getAverages(itemIds) {
    if (!env.client || !itemIds || !itemIds.length) return Promise.resolve(new Map());
    return Promise.resolve(
      env.client.from('price_item_averages').select('item_id,avg_price,sample_count').in('item_id', itemIds)
    ).then(res => {
      const map = new Map();
      if (res && !res.error) {
        (res.data || []).forEach(row => map.set(row.item_id, { avgPrice: row.avg_price, sampleCount: row.sample_count }));
      }
      return map;
    });
  }
  ```

  Add `getAverages` to the returned object.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `node --test test/pricing.test.js`
  Expected: PASS (full file: 11 tests across Tasks 2–6)

- [ ] **Step 5: Commit**

  ```bash
  git add src/data/pricing.js test/pricing.test.js
  git commit -m "pricing: add getAverages"
  ```

---

### Task 7: i18n strings

**Files:**
- Modify: `src/i18n/strings.ar.js`

**Interfaces:**
- Produces: the Arabic strings Tasks 9 and 10 call `t()` with. Listed here so those tasks
  never introduce a `t('...')` call whose Arabic side doesn't exist yet.

- [ ] **Step 1: Add the new entries**

  In `src/i18n/strings.ar.js`, find the `// buttons` section and add a new comment block
  right after it:

  ```js
  // crowdsourced price averages
  'Community price': 'سعر المجتمع', 'reports': 'تقييم', 'No reports yet': 'لا توجد تقييمات بعد',
  'Report your price': 'شارك سعرك', 'Search or add an item…': 'ابحث أو أضف عنصراً…',
  'Add "%s" as a new item': 'أضف "%s" كعنصر جديد', 'Your price (SAR)': 'سعرك (ريال)',
  'Submit price': 'إرسال السعر', 'Price submitted ✓': 'تم إرسال السعر ✓',
  'Sign in to see or share community prices.': 'سجّل الدخول لعرض أو مشاركة أسعار المجتمع.',
  ```

  (`%s` is a literal placeholder token — Task 9/10's code does its own
  `.replace('%s', label)` after calling `t()`, the same way other `t()` calls in this
  codebase are plain lookups with no built-in interpolation.)

  **Note:** this worktree was created before this session's other pending i18n edits on
  `main` were committed (the user chose to proceed independently — see ledger). Add these
  entries as a fresh block; do not assume any other `strings.ar.js` edits from that
  session already exist here.

- [ ] **Step 2: Run the full test suite to confirm nothing regresses**

  Run: `npm test`
  Expected: PASS, same count as after Task 6 (this step adds no new tests — it's data, not
  code).

- [ ] **Step 3: Commit**

  ```bash
  git add src/i18n/strings.ar.js
  git commit -m "i18n: add Arabic strings for crowdsourced price averages"
  ```

---

### Task 8: Boot wiring — reuse one Supabase client for both `account` and `pricing`

**Files:**
- Modify: `main.js:739-752`

**Interfaces:**
- Consumes: `pricing.configure` (Task 2).
- Produces: `pricing` becomes usable app-wide, the same way `account` already is, before
  Task 9/10's UI code runs.

- [ ] **Step 1: Capture the client once and pass it to both modules**

  In `main.js`, replace:

  ```js
  account.configure({
    client: canSignIn ? supabase.createClient(account.SUPABASE_URL, account.SUPABASE_ANON_KEY) : null,
  ```

  with:

  ```js
  const supabaseClient = canSignIn ? supabase.createClient(account.SUPABASE_URL, account.SUPABASE_ANON_KEY) : null;

  account.configure({
    client: supabaseClient,
  ```

  and, right after the existing `account.configure({ ... })` call closes (after the line
  with `choose: askWhichGarage` and its closing `});`), add:

  ```js
  pricing.configure({ client: supabaseClient });
  ```

  This creates exactly one client (as before — `canSignIn` is still computed once), so no
  second auth listener or extra network setup is introduced.

- [ ] **Step 2: Manually verify no duplicate client is created**

  Run: `grep -n "supabase.createClient" main.js`
  Expected: exactly one match.

- [ ] **Step 3: Run the full test suite**

  Run: `npm test`
  Expected: PASS, unchanged count.

- [ ] **Step 4: Commit**

  ```bash
  git add main.js
  git commit -m "boot: wire pricing.configure with the same Supabase client as account"
  ```

---

### Task 9: Parts page — community average badge + "report your price"

**Files:**
- Modify: `src/pages/parts.js:97-125` (the part-card rendering, where `cheapest` and the
  per-option price rows are built)

**Interfaces:**
- Consumes: `pricing.available()`, `pricing.searchItems`, `pricing.createItem`,
  `pricing.submitPrice`, `pricing.getAverages` (Tasks 2–6); `openModal`, `field`, `el` (UI
  helpers already used elsewhere in `parts.js`).
- Produces: nothing consumed by a later task — this is a leaf.

- [ ] **Step 1: Render the average badge when `pricing.available()` and data exists**

  In `src/pages/parts.js`, near line 110 (`<div style="font-weight:750;...">${t('from')}
  ${sar(cheapest)} ...`), the card is built synchronously from `p` while
  `pricing.getAverages` is async. Fetch once per `renderParts()` call for every visible
  part's items, keyed by `p.name` — the shared item may not exist until someone reports a
  price against it, so the badge only renders for parts that already have at least one
  linked `price_items` row.

  Because there is no synchronous way to know a part's `price_items.id` ahead of a
  submission, this task renders the badge as a small placeholder element that
  `renderParts()` fills in after an async lookup, the same async-then-DOM-patch shape
  `dashboard.js` already uses for its own async tiles. Add, right after the `from ${sar}`
  line:

  ```js
  const avgSlot = el('div', 'muted', '', { style: 'font-size:11px;margin-top:2px' });
  avgSlot.id = `avg_${i}`;
  ```

  (append `avgSlot` into the same card container the `from` line is in), and after the
  loop that builds all part cards, add:

  ```js
  if (pricing.available()) {
    /* One search per part, by its own catalog name — this finds a price_items
       row only if some earlier submission already created one via that exact
       label (Task 4's createItem uses the catalog part's own name as the
       label when seeding from a catalog part in Task 10's flow). Parts with
       no submissions yet simply show nothing, matching the "No reports yet"
       string being reserved for the modal, not this compact badge. */
    list.forEach((p, i) => {
      pricing.searchItems(p.name).then(items => {
        const match = items.find(it => it.label === p.name);
        if (!match) return;
        return pricing.getAverages([match.id]).then(averages => {
          const avg = averages.get(match.id);
          const slot = document.getElementById(`avg_${i}`);
          if (avg && slot) slot.textContent = `🌍 ${t('Community price')}: ${sar(avg.avgPrice)} SAR (${avg.sampleCount} ${t('reports')})`;
        });
      });
    });
  }
  ```

- [ ] **Step 2: Add a "Report your price" action per part card**

  Near the same card, add a button that opens a small modal:

  ```js
  const reportBtn = el('button', 'btn', t('Report your price'));
  reportBtn.onclick = () => openReportPrice(p);
  ```

  (append `reportBtn` into the card, guarded the same way the rest of the card already
  guards optional actions — only shown when `pricing.available()` is true; when false,
  render nothing so a signed-out user isn't shown a button that will just fail.)

- [ ] **Step 3: Implement `openReportPrice(p)`**

  Add to `src/pages/parts.js`:

  ```js
  function openReportPrice(p) {
    openModal(t('Report your price'), null, card => {
      card.appendChild(field(t('Your price (SAR)'), html`<input id="rp_price" type="number" inputmode="decimal" min="0">`));
      const b = el('button', 'btn primary block', t('Submit price'));
      b.onclick = () => {
        const price = Number(document.getElementById('rp_price').value);
        if (!(price > 0)) return;
        pricing.searchItems(p.name).then(items => {
          const existing = items.find(it => it.label === p.name);
          return existing ? Promise.resolve(existing) : pricing.createItem(p.name, 'Parts', p.partNo || null);
        }).then(item => item && pricing.submitPrice(item.id, price)).then(ok => {
          if (ok) { toast(t('Price submitted ✓')); closeModal(); renderParts(); }
          else toast(t('Sign in to see or share community prices.'), 'error');
        });
      };
      card.appendChild(b);
    });
  }
  ```

- [ ] **Step 4: Manual smoke check (no automated test — this path needs a live
  Supabase project per the plan's Global Constraints)**

  Run: `npm test`
  Expected: PASS, unchanged count.

  Run: `grep -n "openReportPrice\|Community price" src/pages/parts.js`
  Expected: both present, confirming the wiring landed.

- [ ] **Step 5: Commit**

  ```bash
  git add src/pages/parts.js
  git commit -m "parts: show community price average and let users report a price"
  ```

---

### Task 10: Add Spending — pick a shared item, see its average, submit alongside your
expense

**Files:**
- Modify: `src/pages/budget.js:126-164` (`openAddSpending`)
- Modify: `src/pages/budget.js` — the spending-category list (currently `['Maintenance',
  'Tires', 'Parts', 'Fuel', 'Electrical', 'Insurance', 'Other']`)

**Interfaces:**
- Consumes: `pricing.available()`, `pricing.searchItems`, `pricing.createItem`,
  `pricing.submitPrice`, `pricing.getAverages` (Tasks 2–6).
- Produces: nothing consumed by a later task — this is a leaf. Also closes the spec's
  motivating case: this is where "car paint" gets typed once as a new `price_items` row.

- [ ] **Step 1: Add `'Paint'` to the spending category list**

  This worktree branched independently of another pending change on `main` that added a
  `'Paint'` spending category (see plan header note on Task 7). Without it, there is no
  category to file a paint job's price observation under in this branch, and this task's
  motivating case (spec: "car paint job... isn't in the static catalog at all") has no
  home. Find the category array in `src/pages/budget.js` (currently `const cats =
  ['Maintenance', 'Tires', 'Parts', 'Fuel', 'Electrical', 'Insurance', 'Other'];`) and add
  `'Paint'` to it, positioned after `'Parts'`:

  ```js
  const cats = ['Maintenance', 'Tires', 'Parts', 'Paint', 'Fuel', 'Electrical', 'Insurance', 'Other'];
  ```

  Also add its Arabic translation to `src/i18n/strings.ar.js`, in the same category-labels
  area as `'Tires': 'الإطارات'`:

  ```js
  'Paint': 'الدهان',
  ```

- [ ] **Step 2: Add a shared-item search field to the Add Spending card**

  In `src/pages/budget.js`, right after the existing `quickPick` field (built around line
  132-134 from the `Quick pick` `<select>`), add a second, independent field — this one is
  a free-typed search, not a `<select>` of catalog parts, because the shared item list is
  open-ended and server-backed:

  ```js
  if (pricing.available()) {
    card.appendChild(field(t('Search or add an item…'), html`<input id="x_item_search" list="x_item_list" placeholder="${t('Search or add an item…')}"><datalist id="x_item_list"></datalist>`));
    const avgLine = el('div', 'muted', '', { style: 'font-size:11px;margin:-8px 0 8px' });
    avgLine.id = 'x_item_avg';
    card.appendChild(avgLine);
    let chosenItem = null;
    const searchInput = document.getElementById('x_item_search');
    searchInput.oninput = () => {
      const q = searchInput.value.trim();
      chosenItem = null;
      document.getElementById('x_item_avg').textContent = '';
      if (!q) return;
      pricing.searchItems(q).then(items => {
        const list = document.getElementById('x_item_list');
        list.innerHTML = items.map(it => `<option value="${it.label}">`).join('');
        const exact = items.find(it => it.label === q);
        if (!exact) return;
        chosenItem = exact;
        return pricing.getAverages([exact.id]).then(averages => {
          const avg = averages.get(exact.id);
          document.getElementById('x_item_avg').textContent = avg
            ? `🌍 ${t('Community price')}: ${sar(avg.avgPrice)} SAR (${avg.sampleCount} ${t('reports')})`
            : t('No reports yet');
        });
      });
    };
  }
  ```

- [ ] **Step 3: Submit a price observation alongside the expense save**

  Find the existing save handler in `openAddSpending` (the button that persists the
  expense via `session.save`/`session.current()` — same one that already reads `x_desc`,
  `x_amount`, `x_cat`). Right before its existing success path, add:

  ```js
  if (pricing.available()) {
    const q = document.getElementById('x_item_search') && document.getElementById('x_item_search').value.trim();
    if (q) {
      const cat = document.getElementById('x_cat').value;
      const amount = Number(document.getElementById('x_amount').value);
      pricing.searchItems(q).then(items => {
        const existing = items.find(it => it.label === q);
        return existing ? Promise.resolve(existing) : pricing.createItem(q, cat, null);
      }).then(item => item && amount > 0 && pricing.submitPrice(item.id, amount));
      /* Deliberately not awaited before the expense save below — this is a
         best-effort side report, not part of the expense-saving transaction.
         A failure here must never block or roll back saving the user's own
         spending entry (see spec: submissions fail inline, independently). */
    }
  }
  ```

  Place this immediately before whatever statement currently calls `session.save()` (or
  equivalent) to persist the expense, so it fires in the same click but never gates it.

- [ ] **Step 4: Manual smoke check**

  Run: `npm test`
  Expected: PASS, unchanged count.

  Run: `grep -n "x_item_search\|pricing.searchItems" src/pages/budget.js`
  Expected: both present.

- [ ] **Step 5: Commit**

  ```bash
  git add src/pages/budget.js src/i18n/strings.ar.js
  git commit -m "budget: let Add Spending pick a shared item and report its price"
  ```

---

### Task 11: Full regression pass and plan close-out

**Files:**
- None (verification only)

- [ ] **Step 1: Run the full test suite**

  Run: `npm test`
  Expected: PASS, all prior counts plus the 11 `pricing.test.js` tests from Tasks 2–6, 0
  failures.

- [ ] **Step 2: Confirm the spec's "Open dependency" is still accurately tracked**

  Run: `grep -n "REPLACE_ME" src/data/account.js`
  Expected: both placeholders still present — this plan does not touch them. The feature
  built here is real, tested against a fake client, and ready to exercise for real the
  moment a live Supabase project exists and this plan's Task 1 schema is applied to it —
  same gating note as the existing Phase 4b manual verification checklist.

- [ ] **Step 3: Commit any final cleanup**

  ```bash
  git add -A
  git commit -m "pricing: final regression pass" --allow-empty
  ```
