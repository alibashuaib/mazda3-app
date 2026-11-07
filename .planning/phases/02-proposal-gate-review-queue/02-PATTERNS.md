# Phase 2: Proposal Gate & Review Queue - Pattern Map

**Mapped:** 2026-11-05
**Files analyzed:** 14 new/modified
**Analogs found:** 13 / 14

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/schema.sql` (append: `makers`, `proposals`, `change_log`, trigger for `maker_id`) | migration/model | CRUD, RLS | `schema.sql` `plan_drafts` (767-800), `app_errors` (834-897) | exact |
| `supabase/schema.sql` (`submit_proposal`) | service (RPC) | request-response, batch | `app_errors_before_insert` (853-883) for advisory lock; `decide_plan_draft` for shape | role-match |
| `supabase/schema.sql` (`apply_proposal`, `apply_proposals`, `reject_proposal`, `revert_change`) | service (RPC) | CRUD transactional | `decide_plan_draft` (804-826) | exact |
| `supabase/tests/proposals.sql` | test | RLS/RPC behaviour | `supabase/tests/app-errors-rls.sql` | exact |
| `.github/workflows/test.yml` (add line) | config | CI | lines 58-67 | exact |
| `supabase/seed-proposals-demo.sql` | config/seed | batch | `supabase/seed-catalogue.sql` (not read; manual, not in CI) | partial |
| `supabase/functions/_shared/units.mjs` | utility | transform | `supabase/functions/plan-intake/logic.mjs` (pure ESM, clamp helpers) | role-match |
| `src/data/admin.js` (extend) | service | request-response, never rejects | same file: `listErrors`/`resolveGroup`/`groupErrors` (144-184), `draftDiff` (109) | exact |
| `src/pages/admin-proposals.js` (new) | component/page | request-response, event-driven | `src/pages/admin.js` `adminErrors` (72-107), `adminQueue` (135-190) | exact |
| `src/pages/admin.js` (modify `renderAdminBody`, `adminTab` default) | component | request-response | same file 31-70 | exact |
| `index.html`, `sw.js` ASSETS | config | precache | admin.js entries (index.html:182, sw.js:15) | exact |
| `styles.css` (append New CSS near line 1039) | config | style | `.admin-item` (1039), `.pill` (397-405) | exact |
| `src/i18n/strings.ar.js` | config | i18n | existing entries (file not read) | partial |
| `test/admin-proposals-*.test.js` | test | render/data | `test/admin-errors-render.test.js`, `test/admin-errors-data.test.js` | exact |
| Test: CORE-06 no Mazda literal, units tests | test | static | `test/rls-coverage.test.js` (reads schema.sql as text) | role-match |

## Pattern Assignments

### `supabase/schema.sql` tables: `makers`, `proposals`, `change_log` (model, CRUD + RLS)

**Analog:** `supabase/schema.sql` `plan_drafts` (767-800) and `app_errors` (834-897)

**Table + partial unique index** (767-780):
```sql
create table if not exists public.plan_drafts (
  id bigint generated always as identity primary key,
  car_model_id text not null references public.car_models on delete cascade,
  ...
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz
);
create unique index if not exists plan_drafts_one_pending
  on public.plan_drafts (car_model_id, service) where status = 'pending';
```
Copy literal form `create table if not exists public.<name>` and `alter table public.<name> enable row level security;` (required by regex in `test/rls-coverage.test.js:14,43`). Use `check (char_length(...) <= N)` style from `app_errors` 837-841 for size caps.

**Read-only-to-admin RLS (no write grants)** (885-893, 737-743):
```sql
alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;
...
drop policy if exists admin_read_app_errors on public.app_errors;
create policy admin_read_app_errors on public.app_errors for select to authenticated using (public.is_admin());
```
For `proposals` and `change_log`: `revoke all ... from anon, authenticated; grant select ... to authenticated;` plus one `for select` admin policy. Do NOT copy `grant select, insert, update, delete` (line 800): the whole point is RPC-only writes.

**makers public read** (copy `read_car_models` 718-720 shape): `for select to anon, authenticated using (true)`, writes `using (public.is_admin()) with check (public.is_admin())` (721-723).

**maker_id backfill trigger**: copy trigger idiom (695-697): `drop trigger if exists ... ; create trigger ... before insert on public.car_models for each row execute function ...`. Note `car_models.make` default `'Mazda'` (634) is the only place the literal is allowed (existing column, not new pipeline code).

---

### `supabase/schema.sql` RPCs `apply_proposal` / `reject_proposal` / `revert_change` / `apply_proposals` (service, transactional CRUD)

**Analog:** `decide_plan_draft` (804-826)

**Header, admin guard, row lock, clamps, upsert, revoke**:
```sql
create or replace function public.decide_plan_draft(p_id bigint, p_approve boolean, p_edit jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare d public.plan_drafts; v jsonb; src text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into d from public.plan_drafts where id = p_id and status = 'pending' for update;
  if not found then raise exception 'no pending draft'; end if;
  if p_approve then
    v := coalesce(p_edit, d.proposed);
    insert into public.dealer_plan_items (car_model_id, service, interval_km, interval_months, note, parts, source_url)
    values (d.car_model_id, d.service,
            nullif(least(greatest((v->>'interval_km')::int, 0), 1000000), 0),
            nullif(least(greatest((v->>'interval_months')::int, 0), 240), 0),
            left(coalesce(v->>'note', ''), 300), coalesce(v->'parts', '[]'::jsonb), src)
    on conflict (car_model_id, service) do update set
      interval_km = excluded.interval_km, interval_months = excluded.interval_months,
      note = excluded.note, parts = excluded.parts, source_url = excluded.source_url;
  end if;
  update public.plan_drafts set status = ..., decided_by = auth.uid(), decided_at = now() where id = p_id;
end $$;
revoke execute on function public.decide_plan_draft(bigint, boolean, jsonb) from anon;
```
Differences to apply: return `jsonb` (`{ok:false,error:'stale',live:...}` instead of raising on stale); also `revoke execute ... from public` (research Security Domain); add `change_log` insert; add parts array / <=50 entries validation (not present in the analog). Writing `dealer_plan_items` fires `dealer_plan_item_change` (674-697) which logs `dealer_plan_changes` and bumps `car_models.plan_updated_at`, so no client-sync change is needed. The trigger only logs UPDATE and DELETE (not INSERT); `change_log` is the gate's own log.

**Stale hash** (research sketch, 02-RESEARCH.md lines 222-231): `md5(jsonb_build_object('interval_km', i.interval_km, 'interval_months', i.interval_months, 'note', i.note, 'parts', i.parts)::text)`.

**Bulk isolation** (research lines 233-243): `foreach pid in array p_ids loop begin ... exception when others then ... end; end loop;`.

---

### `supabase/schema.sql` `submit_proposal` (service-role-only RPC, serialised insert)

**Analog:** `app_errors_before_insert` (853-883) for the advisory lock; `decide_plan_draft` for security-definer header.

**Advisory lock** (862):
```sql
perform pg_advisory_xact_lock(hashtext('app_errors_client_cap'));
```
Use `pg_advisory_xact_lock(hashtext('proposal:'||kind||coalesce(car,'')||target))`. Order: supersede (`update ... set status='superseded' where ... status='pending'`) BEFORE insert (partial unique index, Pitfall 3). Unlike other RPCs this one has NO `is_admin()` guard: `revoke execute ... from public, anon, authenticated` instead.

**Role detection if needed** (857): `coalesce(current_setting('role', true), '') in ('anon','authenticated')` (keyed on DB role, not JWT claims; guarded by `rls-coverage.test.js:28`).

---

### `supabase/tests/proposals.sql` (test, RLS + RPC behaviour)

**Analog:** `supabase/tests/app-errors-rls.sql`

**Header/footer and fixtures** (1-14, 101): `begin;` ... `rollback;`, `raise exception 'FAIL: ...'`, silent finish = pass.
```sql
insert into auth.users (id, created_at, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000e1', now(), now()),
  ('00000000-0000-0000-0000-0000000000e2', now(), now());
insert into public.profiles (user_id, role) values ('00000000-0000-0000-0000-0000000000e2', 'admin')
  on conflict (user_id) do update set role = 'admin';
```
**Run as admin (needed so `is_admin()` and `auth.uid()` are real, Pitfall 6)** (67-69):
```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
do $$ ... $$;
reset role;
```
**Expected-failure idiom** (21-23, 85-87):
```sql
begin <stmt>; raise exception 'FAIL: ...';
exception when insufficient_privilege then null; end;
-- for raise_exception: when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if;
```
Add file name to `.github/workflows/test.yml` after line 67 using the same line form (`- run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/proposals.sql`); `test/rls-coverage.test.js:21-26` fails otherwise. Required cases: non-admin refused; anon cannot select/insert/update proposals; stale refusal returns live; edit after stale (rebase); bulk with a failing item mid-batch; supersede; rejected suppression (same vs changed sources); approve A, approve B, revert A refused, revert B then A ok; `plan_updated_at` advances.

---

### `src/data/admin.js` additions (service, request-response, never rejects)

**Analog:** same file, `listErrors` / `resolveGroup` (171-184), `ERR_LIMIT` (145-146), `groupErrors` pure fn (152-169), `decideDraft` (120-122), `draftDiff` (109-114).

**Never-reject read with bounded fetch** (171-177):
```js
function listErrors() {
  return Promise.resolve().then(() => env.client.from('app_errors').select(ERR_COLS)
    .order('created_at', { ascending: false }).limit(ERR_LIMIT))
    .then(res => (res && !res.error ? { ok: true, groups: groupErrors(res.data || []) } : { ok: false, error: 'failed' }))
    .catch(() => ({ ok: false, error: 'failed' }));
}
```
Copy for `listProposals` (`.eq('status','pending').order('created_at',{ascending:false}).limit(500)`) and `listRecentChanges` (limit 30).

**RPC call** (120-122) uses `env.client.rpc(name, args)`. For new wrappers, wrap in the never-reject chain: `.then(res => res && !res.error ? Object.assign({ ok: true }, res.data) : { ok:false, error:'failed' }).catch(...)`. Pass through server `{ok:false,error:'stale',live}` as-is (do not coerce to 'failed').

**Pure filter/label helpers** (follow `groupErrors` style, 150-169): `filterProposals(rows, {car, kind, tier, run})`, `confidenceLabel`. Reuse `parseParts`, `formatParts`, `num` (67-83) and `draftDiff` (109) for the edit form and diff.

**Export list** (186-193): add names to the returned flat object. Module is dual-mode IIFE (9-15); keep that.

---

### `src/pages/admin-proposals.js` (page script, event-driven DOM build)

**Analog:** `src/pages/admin.js` `adminErrors` (72-107) and `adminQueue` (135-190)

**Safe dynamic text: textContent** (72-84):
```js
function adminErrors(res, refresh) {
  const card = el('div', 'card');
  card.style.padding = '16px';
  const note = txt => { const p = el('p', 'muted'); p.textContent = t(txt); card.appendChild(p); };
  if (!res.ok) { note('Could not load errors.'); return card; }
  ...
  const title = el('h4'); title.textContent = g.message;
```
**Async button with inline failure** (93-100):
```js
const b = el('button', 'btn ghost'); b.type = 'button'; b.textContent = t('Resolve');
onAsyncClick(b, async () => {
  const r = await catalogAdmin.resolveGroup(g.key);
  if (r.ok) return refresh();
  const p = el('p', 'muted'); p.textContent = t('Could not save'); box.appendChild(p);
});
```
**Safe link** (167-171): `if (/^https:\/\//.test(d.source_url)) { const a = el('a'); a.href = ...; a.rel = 'noopener'; a.target = '_blank'; try { a.textContent = new URL(...).hostname } catch ... }`. Tighten per UI-SPEC: `/^https:\/\//i`, parse with `new URL`, `rel="noopener noreferrer"`, never display raw URL on parse failure (analog falls back to raw URL; do NOT copy that fallback, show `t('Invalid source link')`).

**Diff line** (163-166): `line.textContent = \`${t(DIFF_LABELS[r.field])}: ${r.before || '—'} → ${r.after || '—'}\`` (use `DIFF_LABELS` from admin.js:131; UI-SPEC wants RTL arrow and `dir` attrs).

**Row via html template** (198-200, `adminList`):
```js
const it = el('div', 'item');
it.innerHTML = html`<div class="item-main"><h3>Mazda ${m.model} · ${m.generation}</h3><p>${m.engine}</p></div>
  <div class="item-side">${m.status === 'draft' ? html`<span class="pill warn">${t('Needs review')}</span>` : ''}</div>`;
```
Note `Mazda ${...}` literal at 198/217 is existing; new file must not contain `'Mazda'` (CORE-06 grep test). Use `maker` from data or omit.

**Edit form fields** (`adminEditor`, 233-238): `field('Dealer interval (km)', html\`<input data-k="interval_km" type="number" min="0" value="${...}">\`)`, textarea with `catalogAdmin.formatParts(...)`; read back via `box.querySelectorAll('[data-k]')` (250) and `catalogAdmin.num` / `parseParts`.

**Bulk confirmation modal** (no confirm helper exists): `openModal(title, sub, bodyBuilder)` from `src/ui/modal.js:34-63` (card passed to builder; Escape/backdrop close; first focusable gets focus so put Cancel first). Build buttons inline with `el('button','btn ghost')` and call `closeModal()` (64).

**Error reporting** (13-15): `adminReport(message, e)` wraps `errorLog.report`; use in catch blocks.

**Banner and style**: file opens with `/* ==== ... ==== */` block then `'use strict';` (admin.js 1-7). Globals `el`, `field`, `onAsyncClick`, `toast`, `t`, `html` are available (el: `src/core/helpers.js:15`; field: `modal.js:78`; toast: `chrome.js:142`).

---

### `src/pages/admin.js` modifications

**Analog:** self (31-70). Change `adminTab` default (line 10) to `'proposals'`; extend tab list at line 43:
```js
body.appendChild(adminTabs([{ id: 'queue', label: 'Review queue' }, { id: 'errors', label: 'Errors', badge: open }], adminTab,
  id => { adminTab = id; show(); }));
try { body.appendChild(adminTab === 'errors' ? adminErrors(errs, () => renderAdminBody(body)) : await adminList()); }
```
Prepend `{ id: 'proposals', label: 'Proposals', badge: pendingCount }` and route `adminTab === 'proposals'` to the new page fn. The comment at 55-56 states this extension point. Keep legacy `queue` path untouched (tests `admin-review*.test.js`). Existing test `admin-errors-render.test.js:39-82` uses `tab(app,'Review queue').onclick()` explicitly, so default tab change is safe, but its supabase stub returns `[]` for unknown tables; stubs must tolerate the new `proposals`/`change_log` tables (stub `p()` line 16 returns `undefined` data for unlisted tables, so `listProposals` must handle `res.data` undefined -> `[]`).

---

### `test/admin-proposals-*.test.js` (render, injection, data)

**Analog:** `test/admin-errors-render.test.js`

**Boot + stub + helpers** (1-39): `bootApp({ protocol: 'https:', supabaseStub: stub(state) })`, `app.api.account.setUserForTest({ id: 'u1' })`, `app.api.go('admin')`, `until(fn)` poll (26-30), `tab(app,label)` (39), `app.cleanup()` in `finally`.
```js
const EVIL = '<img src=x onerror="alert(1)">';
function stub(state) {
  return { createClient: () => ({
    auth: {...}, rpc: () => Promise.resolve({ error: null }), functions: {...},
    from: table => { ... const c = { then: (a, b) => p().then(a, b), catch: b => p().catch(b) };
      ['select', 'order', 'limit', 'maybeSingle', 'insert', 'range'].forEach(k => { c[k] = () => c; });
```
Extend chain method list with `in`, `neq`, `is`; make `rpc` record `(name,args)` into `state` and return configurable `{data,error}` for stale/bulk cases. Injection assertions copy 47-49: `assert.strictEqual(app.document.querySelector('#view img'), null)`; add `#view script` null and no `a[href^=javascript]`.

**Data tests analog:** `test/admin-errors-data.test.js` (not read; mirror for `filterProposals`, never-reject wrappers).

**Static grep test analog:** `test/rls-coverage.test.js:13` (`fs.readFileSync` of schema/source then regex) for CORE-06 `Mazda` literal check on new function bodies, `admin-proposals.js`, `units.mjs`.

---

### `supabase/functions/_shared/units.mjs` (utility, transform)

**Analog:** `supabase/functions/plan-intake/logic.mjs` (pure ESM, named exports, no Deno/Node APIs, tiny clamp helpers such as `clampInt` at lines 24-30). Test analog: `test/plan-intake-logic.test.js` (imports the `.mjs`). `_shared/` already hosts `net-guard.mjs` imported via `export { ... } from '../_shared/net-guard.mjs'` (logic.mjs:13).

---

### `index.html`, `sw.js`, `styles.css`, i18n

- `index.html`: add `<script src="src/pages/admin-proposals.js"></script>` before `main.js`, near line 182 (`src/pages/admin.js`). Page fns are globals so order relative to admin.js only matters at call time, but `assertScriptOrderMatchesIndexHtml` enforces sw.js ASSETS order equals index.html order.
- `sw.js` line 15: `'./src/pages/admin.js',` add new file right after. Then `npm run sw:version` (CACHE is a content hash; `precache.test.js`, `sw-version.test.js`). Also rerun after `styles.css` edit.
- `styles.css`: append UI-SPEC "New CSS" block after `.admin-item + .admin-item` (line 1039). `.pill.ok/warn/danger` already exist (403-405) for confidence badge.
- `src/i18n/strings.ar.js`: add keys; `test/strings-ar-unique.test.js` rejects duplicates. Reuse existing keys (`Approve`, `Reject`, `Loading…`, `Could not save`, `Nothing waiting for review`) instead of near-duplicates; grep before adding.

## Shared Patterns

### Admin gate on every writer RPC
**Source:** `supabase/schema.sql:808`
```sql
if not public.is_admin() then raise exception 'admin only'; end if;
```
Plus `revoke execute on function ... from anon;` (826), extend to `from public`. **Apply to:** `apply_proposal`, `apply_proposals`, `reject_proposal`, `revert_change`. `submit_proposal` is the exception (service-role only).

### Never-reject data functions
**Source:** `src/data/admin.js:171-184`. Resolve `{ok:false,error:'failed'}`; page code branches on `r.ok`. **Apply to:** all new admin.js wrappers.

### Escaping of untrusted text
**Source:** `src/pages/admin.js:72-107` (textContent) and `html` template (`src/ui/html.js`). No `raw()` on proposal/evidence/reason/car/target fields. `test/no-raw-templates.test.js` scans `src/pages` automatically.

### Re-entry-guarded actions
**Source:** `onAsyncClick(btn, async () => {...})` (`src/core/async-click.js:26`), used at admin.js 95, 117, 150, 184, 244.

### Re-runnable SQL
**Source:** `create table if not exists`, `create or replace function`, `drop policy if exists ...; create policy`, `drop trigger if exists ...; create trigger` (pattern throughout 695-697, 888-893).

### Triggers on live write path
`dealer_plan_item_change` (schema.sql:674-697) logs UPDATE/DELETE to `dealer_plan_changes` and bumps `plan_updated_at`. Proposal writers get device refresh for free; `change_log` is additional, not a replacement.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Confirm-dialog helper | component | event-driven | `modal.js` has no confirm helper; build inline with `openModal` (UI-SPEC decision) |
| `supabase/seed-proposals-demo.sql` | seed | batch | No `submit_proposal` precedent; `seed-catalogue.sql` not read, follow its idempotent insert style and call `submit_proposal` as owner |
| `revert_change` drift/natural-key logic, per-item subtransaction in `apply_proposals`, confidence scoring | service | transactional | Net-new logic; use RESEARCH.md sketches (lines 152-162, 222-243) |

## Metadata

**Analog search scope:** `supabase/schema.sql`, `supabase/tests`, `src/data/admin.js`, `src/pages/admin.js`, `src/ui/modal.js`, `test/` (listing + admin-errors-render, rls-coverage), `supabase/functions`, `index.html`, `sw.js`, `.github/workflows/test.yml`, `styles.css` (greps)
**Files read in full:** 9; targeted greps: 4
**Pattern extraction date:** 2026-11-05
