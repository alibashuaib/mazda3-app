# Repair vs Replace vs Inspect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every part on a service record says what was done to it — **replaced**, **repaired** or **inspected** — so owners see the cheaper option before buying a replacement: curated guidance on day one, community numbers (share repaired, median cost of each, km after a repair, how often inspections found a problem) once 5 qualified owners have contributed.

**Architecture:** `contributions` gains `action`, `finding` and `km_since_repair`. Part life (`brand_life`) and store prices count **replacements only**; a new `repair_stats` view aggregates all three actions. `insights.partContributions` computes km-since-last-*replacement* and km-since-last-*repair*. A static curated list `src/data/repairable.js` supplies bilingual guidance by keyword. The "Log a past service" form gets an always-available **Parts on this entry** list (today only filled by bill reading) with an action selector per row; the bill reader suggests the action from the bill wording; the Parts page and the form show the repair hint, which switches to community numbers when `repair_stats` clears the floor.

**Tech Stack:** Vanilla JS dual-mode modules, `node --test` with the DOM harness, Supabase Postgres views, the existing `read-bill` Edge Function (small prompt + parser change, needs redeploy). Local Postgres 16 (brew) for SQL checks.

**Spec:** `docs/superpowers/specs/2026-10-16-community-insights-design.md` (sections 1, 2 `repair_stats`, 4 repair hint, 6 repairable parts). Builds on the bill-reading work (`billParts`, `bills.toPrefill`, `read-bill`).

## Global Constraints

- `action` values are exactly `replaced | repaired | inspected`. Missing/unknown = `replaced` (legacy entries and the plan-flow log are replacements).
- `finding` applies to `inspected` only: `ok | attention`; never sent for other actions.
- Part **life** = km since the last earlier entry of the same part with action `replaced` (or no action). Repairs and inspections never reset it. `km_since_repair` = km since the latest earlier **repaired** entry of that part that is **newer than** the last replacement; sent only on `replaced` rows (so "how long a repair lasts before replacement" can be measured).
- Price: `replaced`/`repaired` rows require price > 0 (unchanged rule); `inspected` rows may have no price (sent as null; a price > 0 is kept).
- `brand_life` and `store_prices` use `action = 'replaced'` rows only. Existing rows (no action) default to `replaced` in the DB.
- `repair_stats`: owner-run like the other views, joined to `qualified_users`, floor **>= 5 distinct qualified users** per model+item; never exposes user ids.
- Repairable-parts guidance is general guidance, never a diagnosis: wording must say "often" / "can", never "your X is repairable". The owner must approve the wording before release (spec Risks).
- Sharing off => nothing is contributed (unchanged). Local saves never wait on any of this.
- Every new user-visible string (English keys used in code) gets an Arabic entry in `src/i18n/strings.ar.js` with an exact key match; `test/no-raw-templates.test.js` must pass. All user/bill-derived text reaches the DOM via `textContent`/input `.value`.
- New `src/` files go into `index.html`, `sw.js` ASSETS and `test/helpers/boot.js`; bump `sw.js` `CACHE` on every task that changes a precached file.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never `git add` `.superpowers`.

## Review Focus

- A legacy history entry (parts without `action`) still contributes exactly as before and counts as a replacement for life calculations.
- Repair then replace: part replaced at 40k, repaired at 60k, replaced at 90k → the 90k row has `km_since_prev = 50000` and `km_since_repair = 30000`; the 60k repair row has `km_since_prev = 20000` and no `km_since_repair`; the inspection at 70k never changes either number.
- Inspection with no price and a finding contributes; an inspection must not make `brand_life` or `store_prices` change.
- `repair_stats` with exactly 5 users, one unqualified user, mixed actions: hidden below the floor, appears at 5 qualified; a part inspected 5 times and never repaired shows `n_repaired = 0` (the client must not print "0% repaired" as advice).
- A part name matching a repairable keyword in Arabic or English (`Headlight`, `مصباح أمامي`) shows the guidance; an unrelated name shows nothing; guidance switches to community numbers only when enough repair/replace samples exist.
- Bill reader returns an `action` the model made up (`"destroyed"`, number, missing): treated as unspecified → the row defaults to `replaced`; the user can always change it before saving.
- Editing/deleting a history entry never leaves a stale contribution (unchanged behaviour: edits do not re-contribute) — do not regress it.

---

### Task 1: SQL — action columns, `repair_stats`, replacement-only life/prices

**Files:**
- Modify: `supabase/schema.sql` (`contributions` columns + CHECKs, `submit_contributions`, `brand_life`, `store_prices`, new `repair_stats` view + grants)
- Create: `supabase/tests/repair-stats.sql`
- Test: `test/schema-repair.test.js`

**Interfaces:**
- Produces columns `contributions.action text not null default 'replaced'`, `contributions.finding text`, `contributions.km_since_repair int`; view `repair_stats(model_id, item_key, n_replaced, n_repaired, n_inspected, median_price_replaced, median_price_repaired, median_km_after_repair, attention_share)`; `submit_contributions` accepts `action`, `finding`, `km_since_repair` per row.

- [ ] **Step 1: Write the failing static test** `test/schema-repair.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

test('contributions carry action, finding and km_since_repair with CHECKs', () => {
  assert.match(sql, /add column if not exists action text not null default 'replaced'/);
  assert.match(sql, /contributions_action_chk[\s\S]{0,200}action in \('replaced', ?'repaired', ?'inspected'\)/);
  assert.match(sql, /add column if not exists finding text/);
  assert.match(sql, /contributions_finding_chk[\s\S]{0,300}finding in \('ok', ?'attention'\)/);
  assert.match(sql, /add column if not exists km_since_repair int/);
});

test('submit_contributions reads the new fields and keeps skipping bad rows', () => {
  const f = sql.match(/create or replace function public\.submit_contributions[\s\S]*?\nend \$\$;/)[0];
  assert.match(f, /r->>'action'/);
  assert.match(f, /r->>'finding'/);
  assert.match(f, /r->>'km_since_repair'/);
  assert.match(f, /exception when others then null/);
});

test('life and store prices count replacements only', () => {
  const life = sql.match(/create or replace view public\.brand_life[\s\S]*?;\n/)[0];
  assert.match(life, /c\.action = 'replaced'/);
  const prices = sql.match(/create or replace view public\.store_prices[\s\S]*?;\n/)[0];
  assert.match(prices, /c\.action = 'replaced'/);
});

test('repair_stats is qualified-only, floored at 5 users, and leaks no user column', () => {
  const v = sql.match(/create or replace view public\.repair_stats[\s\S]*?;\n/)[0];
  assert.match(v, /join qualified_users/);
  assert.match(v, /having count\(distinct l\.user_id\) >= 5/);
  assert.doesNotMatch(v, /user_id as|l\.user_id,|select[^;]*\bl\.user_id\b(?![\s\S]*count)/);
  assert.match(sql, /grant select on public\.repair_stats to authenticated/);
  assert.match(sql, /revoke all on public\.repair_stats from anon/);
});
```

- [ ] **Step 2: Run** `node --test test/schema-repair.test.js` → FAIL

- [ ] **Step 3: Implement** in `supabase/schema.sql` (idempotent; add after the `contributions` table and its hardening block, adjusting the functions/views in place):

```sql
alter table public.contributions add column if not exists action text not null default 'replaced';
alter table public.contributions add column if not exists finding text;
alter table public.contributions add column if not exists km_since_repair int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contributions_action_chk') then
    alter table public.contributions add constraint contributions_action_chk
      check (action in ('replaced', 'repaired', 'inspected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contributions_finding_chk') then
    alter table public.contributions add constraint contributions_finding_chk
      check (finding is null or (action = 'inspected' and finding in ('ok', 'attention')));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contributions_kmrepair_chk') then
    alter table public.contributions add constraint contributions_kmrepair_chk
      check (km_since_repair is null or km_since_repair > 0);
  end if;
end $$;
```

`submit_contributions`: add `action, finding, km_since_repair` to the insert column list and values (`coalesce(r->>'action', 'replaced')`, `r->>'finding'`, `(r->>'km_since_repair')::int`) and to the `update ... set` list (`action = coalesce(r->>'action','replaced')`, `finding = r->>'finding'`, `km_since_repair = (r->>'km_since_repair')::int`). A bad value trips a CHECK inside the existing per-row exception block, so only that row is skipped. `brand_life` and `store_prices`: add `and c.action = 'replaced'` to their `where`.

```sql
create or replace view public.repair_stats as
  select c.model_id, c.item_key,
         count(*) filter (where c.action = 'replaced')  as n_replaced,
         count(*) filter (where c.action = 'repaired')  as n_repaired,
         count(*) filter (where c.action = 'inspected') as n_inspected,
         (percentile_cont(0.5) within group (order by c.price)
            filter (where c.action = 'replaced' and c.price > 0))::numeric(10,2) as median_price_replaced,
         (percentile_cont(0.5) within group (order by c.price)
            filter (where c.action = 'repaired' and c.price > 0))::numeric(10,2) as median_price_repaired,
         percentile_cont(0.5) within group (order by c.km_since_repair)
            filter (where c.km_since_repair is not null) as median_km_after_repair,
         (count(*) filter (where c.action = 'inspected' and c.finding = 'attention'))::numeric
           / nullif(count(*) filter (where c.action = 'inspected' and c.finding is not null), 0) as attention_share
  from contributions c
  join contribution_links l on l.contribution_id = c.id
  join qualified_users q on q.id = l.user_id
  where c.kind = 'part' and c.item_key is not null
  group by c.model_id, c.item_key
  having count(distinct l.user_id) >= 5;

grant select on public.repair_stats to authenticated;
revoke all on public.repair_stats from anon;
```

- [ ] **Step 4: Run** `node --test test/schema-repair.test.js` → PASS; `npm test`.

- [ ] **Step 5: Verify on local Postgres 16** exactly as in the earlier SQL tasks (`/opt/homebrew/opt/postgresql@16/bin`, `initdb --locale=en_US.UTF-8 -E UTF8`, socket dir `/tmp/pgs`, stubs: `auth.users(id, created_at, email_confirmed_at, phone_confirmed_at)`, `auth.uid()`, `auth.role()`, `storage` stubs, roles `anon`/`authenticated`, `create schema extensions;`). Apply `schema.sql` **twice**; run **all** existing `supabase/tests/*.sql` (shops-rls, shop-norm, qualified-users, bills) plus the new `supabase/tests/repair-stats.sql` with `-v ON_ERROR_STOP=1`. The new file asserts: (a) 5 qualified users contributing mixed actions on one item → one `repair_stats` row with correct `n_*`, medians and `attention_share`; 4 qualified + 1 unqualified → no row; (b) a `repaired` and an `inspected` row do **not** change `brand_life` or `store_prices` for the same item/brand/shop; (c) `inspected` with `finding='attention'` accepted, `finding` on a `replaced` row is skipped (CHECK) without sinking the batch; an unknown `action` row is skipped, the good row in the same batch is kept; a row with no `action` key is stored as `replaced`; (d) `authenticated` can select `repair_stats`, `anon` cannot; no column of the view contains a user id (`select column_name from information_schema.columns where table_name='repair_stats'`); (e) re-submitting the same `source_key` with a changed action updates the row (idempotent); (f) `attention_share` is null when no inspection has a finding; (g) negative control: removing `c.action = 'replaced'` from `brand_life` makes (b) fail. Remove the temporary cluster afterwards.

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql supabase/tests/repair-stats.sql test/schema-repair.test.js
git commit -m "feat(repair): action columns, repair_stats, replacement-only life and prices"
```

---

### Task 2: `insights.js` — action-aware contributions and repair stats

**Files:**
- Modify: `src/data/insights.js` (`partContributions`, new `getRepairStats`, pure `repairInsight`), `test/insights.test.js`

**Interfaces:**
- Consumes: Task 1 columns; history `parts` entries `{part, brand, partNo, price, action?, finding?}`.
- Produces: `partContributions` rows with `action` (always sent), `finding` (inspected only), `km_since_prev` (since last replacement), `km_since_repair` (replaced rows only); `insights.getRepairStats(modelId, itemKey) -> Promise<row[]>` (cached like `getBrandLife`, `clearCache()` clears it); pure `insights.repairInsight(rows) -> null | { share, nRepaired, nReplaced, priceRepaired, priceReplaced, kmAfterRepair, attention, nInspected }`.

- [ ] **Step 1: Write failing tests** (append to `test/insights.test.js`)

```js
const H = (id, odometer, parts) => ({ id, date: '2026-0' + (1 + Number(id.slice(1)) % 8) + '-10', odometer, parts });

test('legacy parts without action contribute as replaced, exactly as before', () => {
  const h = H('h1', 52300, [{ part: 'Oil Filter', brand: 'Bosch', price: 40 }]);
  const [r] = ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: h, priorHistory: [] });
  assert.strictEqual(r.action, 'replaced');
  assert.strictEqual('finding' in r, false);
  assert.strictEqual('km_since_repair' in r, false);
});

test('life counts from the last replacement; repairs and inspections never reset it', () => {
  const prior = [
    H('h1', 40000, [{ part: 'Headlight', price: 500, action: 'replaced' }]),
    H('h2', 60000, [{ part: 'Headlight', price: 120, action: 'repaired' }]),
    H('h3', 70000, [{ part: 'Headlight', action: 'inspected', finding: 'ok' }])];
  const rep = ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: prior[1], priorHistory: prior });
  assert.strictEqual(rep[0].km_since_prev, 20000);
  assert.strictEqual('km_since_repair' in rep[0], false);
  const last = H('h4', 90000, [{ part: 'Headlight', price: 520, action: 'replaced' }]);
  const [r] = ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: last, priorHistory: prior });
  assert.strictEqual(r.km_since_prev, 50000);
  assert.strictEqual(r.km_since_repair, 30000);
});

test('a repair older than the last replacement does not count as km_since_repair', () => {
  const prior = [
    H('h1', 20000, [{ part: 'Headlight', price: 100, action: 'repaired' }]),
    H('h2', 40000, [{ part: 'Headlight', price: 500, action: 'replaced' }])];
  const [r] = ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: H('h3', 90000, [{ part: 'Headlight', price: 520, action: 'replaced' }]), priorHistory: prior });
  assert.strictEqual(r.km_since_prev, 50000);
  assert.strictEqual('km_since_repair' in r, false);
});

test('inspections may have no price and carry a finding; bad actions fall back to replaced', () => {
  const h = H('h1', 50000, [
    { part: 'Brake Pads', action: 'inspected', finding: 'attention' },
    { part: 'Wipers', action: 'destroyed', price: 30 },
    { part: 'Mirror', action: 'repaired' },                      // repaired without a price: skipped
    { part: 'Bulb', action: 'replaced', finding: 'ok', price: 9 }]);   // finding only on inspections
  const rows = ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: h, priorHistory: [] });
  const by = k => rows.find(r => r.item_key === k);
  assert.deepStrictEqual([by('brake pads').action, by('brake pads').finding, by('brake pads').price], ['inspected', 'attention', null]);
  assert.strictEqual(by('wipers').action, 'replaced');
  assert.strictEqual(by('mirror'), undefined);
  assert.strictEqual('finding' in by('bulb'), false);
  const noFinding = ins.partContributions({ modelId: 'm', vehicleId: 'v', historyEntry: H('h2', 50000, [{ part: 'Belt', action: 'inspected' }]), priorHistory: [] });
  assert.strictEqual('finding' in noFinding[0], false);
});

test('repairInsight needs enough repair/replace samples and reports shares', () => {
  const row = { n_replaced: 6, n_repaired: 4, n_inspected: 3, median_price_replaced: '540.00', median_price_repaired: '120.00', median_km_after_repair: 30000, attention_share: '0.667' };
  assert.deepStrictEqual(ins.repairInsight([row]), { share: 40, nRepaired: 4, nReplaced: 6, priceRepaired: 120, priceReplaced: 540, kmAfterRepair: 30000, attention: 67, nInspected: 3 });
  assert.strictEqual(ins.repairInsight([{ ...row, n_replaced: 2, n_repaired: 1 }]).share, null);   // under 5 samples: no share
  assert.strictEqual(ins.repairInsight([]), null);
  assert.strictEqual(ins.repairInsight([{ ...row, n_inspected: 0, attention_share: null }]).attention, null);
});

test('getRepairStats returns rows, [] on error, and is cached until clearCache', async () => {
  let calls = 0;
  const client = { from: () => { calls++; return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [{ n_repaired: 1 }], error: null }) }) }) }; } };
  ins.configure({ client });
  assert.strictEqual((await ins.getRepairStats('m', 'k')).length, 1);
  await ins.getRepairStats('m', 'k');
  assert.strictEqual(calls, 1);
  ins.clearCache();
  await ins.getRepairStats('m', 'k');
  assert.strictEqual(calls, 2);
  ins.configure({ client: { from: () => { throw new Error('boom'); } } });
  ins.clearCache();
  assert.deepStrictEqual(await ins.getRepairStats('m', 'k'), []);
});
```

- [ ] **Step 2: Run** `node --test test/insights.test.js` → FAIL

- [ ] **Step 3: Implement** in `src/data/insights.js`:
  - `const ACTIONS = ['replaced', 'repaired', 'inspected']; const actionOf = p => ACTIONS.includes(p.action) ? p.action : 'replaced';`
  - In `partContributions`, per part: `const action = actionOf(p)`. Keep the rows when `p.part` is set and either `p.price > 0` or `action === 'inspected'`; a `repaired`/`replaced` row without price is skipped. Row gets `action`; `price: p.price > 0 ? round2(p.price) : null`; `finding` only when `action === 'inspected' && (p.finding === 'ok' || p.finding === 'attention')`.
  - `km_since_prev`: among earlier entries (`id !== entry.id && odometer < entry.odometer`) of the **same part with `actionOf === 'replaced'`**, take the latest and set `km_since_prev = entry.odometer - prev.odometer` (omit the key when none). For `action === 'replaced'` rows only: find the latest earlier entry of the same part with action `repaired` whose odometer is **greater than** `prev ? prev.odometer : -Infinity`; if found set `km_since_repair = entry.odometer - repaired.odometer` (omit otherwise).
  - `getRepairStats(modelId, itemKey)` mirrors `getBrandLife` (same cache helper, table `repair_stats`, filters `model_id` + `item_key`); `clearCache()` already clears all caches — make sure it clears this one too.
  - `repairInsight(rows)`: `const r = rows && rows[0]; if (!r) return null;` `const a = Number(r.n_repaired), b = Number(r.n_replaced), i = Number(r.n_inspected)`; `share = a + b >= 5 ? Math.round(100 * a / (a + b)) : null`; `priceRepaired/priceReplaced = r.median_price_* == null ? null : Number(...)`; `kmAfterRepair = r.median_km_after_repair == null ? null : Math.round(Number(...))`; `attention = i > 0 && r.attention_share != null ? Math.round(100 * Number(r.attention_share)) : null`; return `{ share, nRepaired: a, nReplaced: b, priceRepaired, priceReplaced, kmAfterRepair, attention, nInspected: i }`.
  - Export `getRepairStats`, `repairInsight`.

- [ ] **Step 4: Run** `node --test test/insights.test.js` then `npm test` → PASS
- [ ] **Step 5: Commit** `git add src/data/insights.js test/insights.test.js && git commit -m "feat(repair): action-aware part contributions and repair stats client"`

---

### Task 3: Curated repairable list `repairable.js`

**Files:**
- Create: `src/data/repairable.js`, `test/repairable.test.js`
- Modify: `index.html`, `sw.js` (ASSETS + `CACHE`), `test/helpers/boot.js`

**Interfaces:**
- Produces (dual-mode global `repairable`): `LIST` (array of `{ id, keywords:[…], tipEn, tipAr }`), `tipFor(partName) -> null | { id, tipEn, tipAr }` (case-insensitive; matches if any keyword — English or Arabic — is a substring of the lowercased, trimmed name; first match wins), `tip(partName, lang) -> string|null` where `lang === 'ar'` returns `tipAr`.

- [ ] **Step 1: Write failing tests** `test/repairable.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const repairable = require('../src/data/repairable.js');

test('every entry is bilingual, has keywords, and avoids diagnosis wording', () => {
  assert.ok(repairable.LIST.length >= 6);
  const ids = new Set();
  for (const e of repairable.LIST) {
    assert.ok(e.id && !ids.has(e.id), 'unique id ' + e.id); ids.add(e.id);
    assert.ok(Array.isArray(e.keywords) && e.keywords.length > 0, e.id + ' keywords');
    assert.ok(e.keywords.some(k => /[؀-ۿ]/.test(k)), e.id + ' needs an Arabic keyword');
    assert.ok(e.keywords.some(k => /[a-z]/.test(k)), e.id + ' needs an English keyword');
    assert.ok(e.tipEn.length > 20 && e.tipAr.length > 10, e.id + ' tips');
    assert.ok(/\b(often|can|may|sometimes)\b/i.test(e.tipEn), e.id + ' must hedge ("often/can/may")');
    assert.ok(!/\byour\b/i.test(e.tipEn), e.id + ' must not address the owner\'s specific part');
  }
});

test('tipFor matches English and Arabic names case-insensitively and ignores unrelated parts', () => {
  assert.strictEqual(repairable.tipFor('Front Headlight (left)').id, 'headlight');
  assert.strictEqual(repairable.tipFor('  HEADLIGHT restoration ').id, 'headlight');
  assert.strictEqual(repairable.tipFor('مصباح أمامي').id, 'headlight');
  assert.strictEqual(repairable.tipFor('Engine Oil 5W-30'), null);
  assert.strictEqual(repairable.tipFor(''), null);
  assert.strictEqual(repairable.tipFor(null), null);
});

test('tip() returns the language asked for', () => {
  const t = repairable.tipFor('Windscreen');
  assert.strictEqual(repairable.tip('Windscreen', 'en'), t.tipEn);
  assert.strictEqual(repairable.tip('Windscreen', 'ar'), t.tipAr);
  assert.strictEqual(repairable.tip('Spark plugs', 'en'), null);
});
```

(The "General guidance" label is added by the UI, not stored in each tip.)

- [ ] **Step 2: Run** → FAIL (module missing)

- [ ] **Step 3: Implement** `src/data/repairable.js` — dual-mode (same wrapper as `shops.js`), `'use strict'`. The list below is the **draft wording for the owner to review before release**; keep every `tipEn` hedged and non-diagnostic:

```js
const LIST = [
  { id: 'headlight', keywords: ['headlight', 'head light', 'headlamp', 'مصباح أمامي', 'الفانوس الأمامي', 'كشاف'],
    tipEn: 'Cloudy or yellowed headlights can often be restored by polishing, at a fraction of the cost of a new unit.',
    tipAr: 'يمكن في كثير من الأحيان إعادة تلميع المصابيح الأمامية المعتمة أو المصفرّة بتكلفة أقل بكثير من شراء مصباح جديد.' },
  { id: 'windscreen', keywords: ['windscreen', 'windshield', 'زجاج أمامي', 'الزجاج الأمامي'],
    tipEn: 'Small chips can often be filled by a glass repair service before they spread; larger or edge cracks usually need replacement.',
    tipAr: 'يمكن في كثير من الأحيان إصلاح الشظايا الصغيرة قبل أن تتسع؛ أما الشروخ الكبيرة أو عند الحواف فغالبًا تحتاج إلى تبديل.' },
  { id: 'dent', keywords: ['dent', 'door panel', 'bumper', 'صدمة', 'طعجة', 'ظهر الباب', 'صدام'],
    tipEn: 'Shallow dents with intact paint can often be removed by paintless dent repair instead of replacing or repainting a panel.',
    tipAr: 'يمكن في كثير من الأحيان إزالة الطعجات السطحية التي لم يتضرر طلاؤها بدون إعادة صبغ أو تبديل القطعة.' },
  { id: 'alloy', keywords: ['alloy', 'rim', 'wheel refinish', 'جنط', 'جنوط', 'رنج'],
    tipEn: 'Scuffed or lightly bent alloy wheels can often be refinished or straightened for less than the price of a new wheel.',
    tipAr: 'يمكن في كثير من الأحيان إعادة تجديد أو تعديل الجنوط الخفيفة الخدش أو الانحناء بتكلفة أقل من جنط جديد.' },
  { id: 'ac', keywords: ['a/c', 'ac compressor', 'air conditioning', 'air condition', 'مكيف', 'تكييف', 'كمبروسر'],
    tipEn: 'Weak cooling can sometimes be fixed by a leak check and gas recharge before a compressor is replaced.',
    tipAr: 'قد يُحلّ ضعف التبريد أحيانًا بفحص التسريب وإعادة تعبئة الغاز قبل تبديل الكمبروسر.' },
  { id: 'battery-terminal', keywords: ['battery terminal', 'battery clamp', 'قطب البطارية', 'أقطاب البطارية'],
    tipEn: 'Corroded battery terminals can often be cleaned or re-fitted instead of replacing the battery.',
    tipAr: 'يمكن في كثير من الأحيان تنظيف أقطاب البطارية المتآكلة أو إعادة تركيبها بدل تبديل البطارية.' },
  { id: 'seat-upholstery', keywords: ['seat cover', 'upholstery', 'seat leather', 'تنجيد', 'جلد المقعد', 'فرش'],
    tipEn: 'Worn seat leather or fabric panels can often be repaired or re-covered without replacing the whole seat.',
    tipAr: 'يمكن في كثير من الأحيان إصلاح جلد أو قماش المقعد المتآكل أو إعادة تغطيته دون تبديل المقعد كاملًا.' }
];
```

Matching: `const n = String(name == null ? '' : name).toLowerCase().trim(); return n ? LIST.find(e => e.keywords.some(k => n.includes(k.toLowerCase()))) || null : null;` (return a `{id, tipEn, tipAr}` copy, not the keyword array). `tip(name, lang)` returns `lang === 'ar' ? e.tipAr : e.tipEn`.

Wire like `shops.js` (index.html tag after `bills.js`, `sw.js` ASSETS + `CACHE` bump, `test/helpers/boot.js`).

- [ ] **Step 4: Run** `node --test test/repairable.test.js`, then `npm test` (boot/precache tests prove wiring) → PASS
- [ ] **Step 5: Commit** `git add src/data/repairable.js test/repairable.test.js index.html sw.js test/helpers/boot.js && git commit -m "feat(repair): curated repairable parts guidance (draft wording, owner review pending)"`

---

### Task 4: Parts on the service form — action per row, always available

**Files:**
- Modify: `src/pages/maintenance.js` (`openAddHistory` parts section + save path), `src/i18n/strings.ar.js`, `test/shop-field.test.js` (or a new `test/part-rows.test.js` in the same harness style)

**Interfaces:**
- Consumes: Task 2 (`partContributions` actions), Task 3 (`repairable.tip`), the existing `billParts` closure array and `drawParts()` in `openAddHistory`.
- Produces: `billParts` rows are `{ part, brand, partNo, price, action, finding }` (`action` default `'replaced'`; `finding` only meaningful when `action === 'inspected'`); the "Parts on this entry" box is **always visible** for new entries with a **+ Add part** button; the save path stores `action`/`finding`; `afterPurchase` already contributes `obj.parts`.

Behaviour (exact):
1. Rename the section heading to `t('Parts on this entry')` and show the box for new entries even with no rows (`partsBox.hidden` only for editing). A **+ Add part** button (`t('Add part')`) appends an empty row `{ part:'', brand:'', partNo:'', price:0, action:'replaced', finding:'' }` (cap 15 rows).
2. Each row: name input (existing, with the catalogue datalist), brand, price, an **action** `<select>` with options `replaced/repaired/inspected` (labels `t('Replaced')`, `t('Repaired')`, `t('Inspected')`), and — only while action is `inspected` — a **finding** `<select>` (`''` = `t('Result: not stated')`, `ok` = `t('Looked fine')`, `attention` = `t('Needs attention')`). Changing the action redraws that row. Remove ✕ as today. All built with DOM calls; the `.value` of selects only from fixed option values.
3. Under each row, if `repairable.tipFor(row.part)` matches (re-evaluated on name `input` events without redrawing the whole list) show its tip in a muted line with the prefix `t('General guidance')`: via `textContent`, language from the app's current language helper (use the same lang accessor the app uses for `t()`; if there is none, use `document.documentElement.lang === 'ar'`).
4. Save path (`bp` mapping, new entries only): keep the existing trimming/finite-price rules but accept `price <= 0` rows **only** when `action === 'inspected'` (stored with `price` omitted/0); non-inspected rows still need name and price > 0; cap 15; store `action` only when it differs from `'replaced'` (smaller records, legacy-compatible) and `finding` only for `inspected` with a value. The entry `cost` field is untouched by rows (as today).
5. Bill-reader prefill rows keep working: `bills.toPrefill` rows get `action:'replaced'` and `finding:''` here (Task 5 sets real suggestions).
6. Arabic entries, exact keys: `Parts on this entry`, `Add part`, `Replaced`, `Repaired`, `Inspected`, `Result: not stated`, `Looked fine`, `Needs attention`, `General guidance`, plus Arabic wording; reuse existing keys if present (`Brand`, `Price`).

- [ ] **Step 1: Write failing tests** (DOM harness; copy the approach of the existing bill-form tests): (a) a new entry shows the box and **+ Add part** with no bill; clicking adds a row, the 16th click adds nothing; editing form shows no box; (b) action select has exactly the three options, default replaced; choosing `inspected` reveals the finding select, choosing `repaired` hides it and clears `finding`; (c) typing `Headlight` shows a guidance line containing `General guidance`; typing `Oil` shows none; a name `<img src=x onerror=alert(1)>` stays text; (d) save through the real save handler: a `repaired` row with price stores `{part,brand,partNo,price,action:'repaired'}`; an `inspected` row with no price and finding `attention` is stored with `finding`; a `replaced` row stores **no** `action` key; a `replaced` row without price is dropped; (e) the entry passed to `afterPurchase` carries these parts so `contribute` receives rows with `action`/`finding` (stub `contribute`); (f) with sharing off nothing is contributed but the entry still stores the parts.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** items 1–6; bump `sw.js` `CACHE`.
- [ ] **Step 4: Run** `npm test` and `npm run test:e2e` (1 intentional skip) → PASS
- [ ] **Step 5: Commit** `git add -A src test sw.js && git commit -m "feat(repair): parts on the service form with replaced/repaired/inspected"` (never `.superpowers`).

---

### Task 5: Bill reader suggests the action

**Files:**
- Modify: `supabase/functions/read-bill/logic.mjs` (prompt + `parseBill` item field), `src/data/bills.js` (`toPrefill`), `src/pages/maintenance.js` (prefill rows), `test/read-bill-logic.test.js`, `test/bills.test.js`, `supabase/functions/read-bill/README.md`

**Interfaces:**
- Produces: `parseBill` items gain `action: 'replaced'|'repaired'|'inspected'|null` (whitelist; anything else → `null`); `bills.toPrefill(bill).parts[i].action` = that value or `'replaced'`; the form's prefill rows carry it.

- [ ] **Step 1: Write failing tests.** `read-bill-logic.test.js`: an item with `"action":"repaired"` keeps it; `"action":"destroyed"`, a number, `null`, a missing key → `null`; the model output containing `"action"` at the top level or on `store` is ignored; `SYSTEM_PROMPT` contains the words `replaced`, `repaired`, `inspected` and the Arabic hint words `إصلاح` `ترميم` `فحص`. `bills.test.js`: `toPrefill` maps `action:'repaired'` through, defaults missing/`null` to `'replaced'`, and keeps `parts` otherwise unchanged. Form test (harness): a mocked `readBill` result with a `repaired` item renders that row with action select = repaired.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement.** In `SYSTEM_PROMPT` extend the item schema with `"action":"replaced"|"repaired"|"inspected"` and the rule: `action` = what the line says was done to the part: use "repaired" for repair/restore/polish/refinish/fix/weld/recharge lines (Arabic: إصلاح، ترميم، تلميع، صيانة), "inspected" for check/inspection/diagnosis lines (Arabic: فحص، كشف)، "replaced" for new/replaced/fitted parts (Arabic: تبديل، تغيير)، and null when the bill doesn't say. In `parseBill` add `action: ['replaced','repaired','inspected'].includes(i.action) ? i.action : null` to each item. `toPrefill` adds `action: i.action || 'replaced'`. The form prefill rows set `action` and leave `finding: ''`. README: note that the prompt changed and the function must be **redeployed**.
- [ ] **Step 4: Run** `npm test` → PASS (bump `sw.js` `CACHE` if a precached client file changed).
- [ ] **Step 5: Commit** `git add -A supabase/functions/read-bill src test sw.js && git commit -m "feat(repair): bill reader suggests replaced/repaired/inspected"` (never `.superpowers`).

---

### Task 6: Repair hint and community numbers; action in the timeline

**Files:**
- Modify: `src/pages/parts.js` (hint slot), `src/pages/maintenance.js` (form row hint switches to community numbers; timeline badge), `src/data/insights.js` (none beyond Task 2), `src/i18n/strings.ar.js`, tests (harness)

**Interfaces:**
- Consumes: `insights.getRepairStats/repairInsight` (Task 2), `repairable.tip/tipFor` (Task 3).

Behaviour:
1. **Mode rule** (pure helper in `src/data/insights.js`, exported, unit-tested): `insights.repairMode(info)` returns `'community'` when `info && info.share != null` (>= 5 repaired+replaced samples; inspections do not count), else `'none'`. The UI shows the community line when `'community'`, otherwise the curated tip when `repairable.tipFor(name)` matches, otherwise nothing.
2. **Community line text** (all via `t()`, numbers interpolated, `textContent`): `"{share}% of owners repaired this instead of replacing it"`, then if both medians exist `" · median SAR {priceRepaired} repaired vs {priceReplaced} replaced"`, then if `kmAfterRepair` `" · a repaired one lasts about {kmAfterRepair} km before replacement"`; separately, if `attention != null` and `nInspected >= 3`: `"Inspections found a problem {attention}% of the time"`. Label it as community data: prefix `🌍`. Never print a share when `share == null`.
3. **Parts page** (`parts.js`): add `<div class="muted" id="repair_${p.id}" …>` under the existing `shop_${p.id}` slot; for each visible part call `insights.getRepairStats(cur.car.modelId, key)` (same `key` as the other lookups; cached), compute the mode, fill the slot via `textContent`, guard against a stale slot, `.catch(() => {})`. When mode is `'none'` but the curated tip matches, show `General guidance: {tip}`.
4. **Form row hint** (Task 4's guidance line): when the typed part name has `repairStats` (call `getRepairStats` debounced on name blur/`change`, not every keystroke), prefer the community line over the curated tip. A stale response for an older name is ignored (sequence token).
5. **Timeline**: in the history entry card, for parts whose `action` is `repaired` or `inspected`, show the part name followed by a small label `t('Repaired')` / `t('Inspected')` (+ ` · ${t('Needs attention')}` when `finding === 'attention'`); `replaced` shows nothing extra. Text via the `html` template/`textContent`.
6. Arabic entries, exact keys, for every new string (including the interpolated templates: store the English template with `{n}`-style placeholders only if the app has such a convention; otherwise build each sentence from separate `t()` fragments like the existing "Typical replacement" line does).

- [ ] **Step 1: Write failing tests** (harness; stub `insights.getRepairStats`): (a) with stats `n_repaired:4, n_replaced:6, median prices 120/540` the Parts page slot text contains `40%`, `120` and `540`; (b) with only 3 samples and a part named `Headlight` the slot shows the curated tip prefixed `General guidance`; (c) with no stats and a non-matching part the slot is empty; (d) a part name with markup stays text; (e) `repairMode` unit tests: exactly 5 samples → community, 4 → none, `null` → none, 5 inspections only → none (inspections don't count toward the repair/replace floor); (f) timeline entry with a `repaired` part shows the `Repaired` label and an `inspected` + `attention` part shows both labels, a `replaced` part shows none; (g) stale-response guard in the form hint (older name resolving last does not overwrite).
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** items 1–6; bump `sw.js` `CACHE`.
- [ ] **Step 4: Run** `npm test` and `npm run test:e2e` → PASS
- [ ] **Step 5: Commit** `git add -A src test sw.js && git commit -m "feat(repair): repair hint, community repair numbers and action labels"` (never `.superpowers`).

---

### Task 7: Docs and live verification (manual, last)

- [ ] **Docs:** update the spec (`docs/superpowers/specs/2026-10-16-community-insights-design.md`): data table gains `action`, `finding`, `km_since_repair`; `repair_stats` columns as built; "life counts replacements only"; the **inspected** action; the form's Parts-on-this-entry list; the bill reader's action suggestion (and that `read-bill` must be redeployed). Add a short `docs/superpowers/verification/` note listing the checks below.
- [ ] **Owner review gate (blocking release, not the PR):** the owner reads every `tipEn`/`tipAr` in `src/data/repairable.js` and approves or edits the wording; record the approval date in the spec Risks line.
- [ ] **Manual live check (deferred to the very end with the other live-Supabase checks; needs a real project, 5 aged confirmed test accounts):** (1) log replaced/repaired/inspected rows for one part from five accounts → `repair_stats` row appears only at 5; (2) the Parts page and the form show the community line; (3) with fewer accounts the curated tip shows for `Headlight`/`مصباح أمامي`; (4) `brand_life` / `store_prices` unchanged by repairs and inspections; (5) bill with a repair line ("polish headlight") suggests `repaired`; (6) Arabic UI for every new label; (7) opting out removes the rows from `repair_stats`.

---

## Deviations from the spec (update the spec when shipped)

- **Third action `inspected`** (added at the owner's request) with an optional `finding` (`ok | attention`) — the spec only defined replaced/repaired.
- The "Replaced / Repaired selector" is **per part row** in a new always-visible **Parts on this entry** list, not one selector per record, because one visit often mixes actions (and `contributions` is per part).
- Part life and store prices use **replacements only**; `km_since_repair` (km from the latest repair to the next replacement) implements the spec's "km after a repair".
- Matching of the curated list is by keyword substring on the part name (the catalogue's consumables don't include repairable items; users type free-text names).

## Known gaps (accepted)

- Free-text part names fragment `item_key` ("Headlight" vs "Head lamp left"); community numbers appear only where owners type similar names.
- `n_*` counts rows, not distinct owners (same as the other views); the 5-user floor is on distinct qualified users per item.
- Curated tips are general guidance and may not suit a specific car; wording is owner-approved but not expert-verified.
- Old history entries cannot be re-labelled as repaired/inspected after saving (editing never re-contributes).
