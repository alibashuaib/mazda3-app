/* ============================================================
   Garage — the shared catalogue, read side.
   Pulls approved car models and their dealer plans from Supabase, keeps a
   copy in storage meta for offline use, and applies a dealer plan's
   intervals to a vehicle. catalog.js stays the built-in fallback.

   Dual-mode, like pricing.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory(isNode ? require('./catalog.js').NORMAL_SCHED : root.NORMAL_SCHED);
  if (isNode) module.exports = api;
  else root.remoteCatalog = api;
})(typeof self !== 'undefined' ? self : globalThis, function (NORMAL_SCHED) {

  const DEFAULTS = { client: null, pageSize: 1000, metaGet: () => Promise.resolve({}), metaSet: () => Promise.resolve(true) };
  let env = Object.assign({}, DEFAULTS);
  let cache = null;   // { models, items, fetchedAt }

  function configure(next) { env = Object.assign({}, env, next || {}); }
  function reset() { env = Object.assign({}, DEFAULTS); cache = null; }

  function load() {
    return Promise.resolve(env.metaGet()).then(meta => {
      const c = meta && meta.catalogue;
      if (c && Array.isArray(c.models) && Array.isArray(c.items)) cache = c;
      return !!cache;
    }).catch(() => false);
  }

  /* Never rejects: offline or an unconfigured project leaves the last good
     cache in place, which is the whole point of keeping one. */
  function refresh() {
    if (!env.client) return Promise.resolve(false);
    return Promise.all([
      env.client.from('car_models').select('id,model,generation,engine,warranty_years,warranty_km,plan_updated_at').eq('status', 'approved'),
      allItems()
    ]).then(([m, items]) => {
      if (!m || m.error || !items) return false;
      cache = { models: m.data || [], items, fetchedAt: new Date().toISOString() };
      return Promise.resolve(env.metaSet({ catalogue: cache })).then(() => true);
    }).catch(() => false);
  }

  /* PostgREST silently caps a response at max-rows (1000 by default), so
     page until a short page. Resolves null on any error. */
  function allItems(from, acc) {
    from = from || 0; acc = acc || [];
    const size = env.pageSize;
    return Promise.resolve(env.client.from('dealer_plan_items')
      .select('car_model_id,service,icon,category,interval_km,interval_months,note,parts,sort')
      .order('id').range(from, from + size - 1)).then(r => {
      if (!r || r.error) return null;
      const rows = acc.concat(r.data || []);
      return (r.data || []).length < size ? rows : allItems(from + size, rows);
    });
  }

  function model(id) { return (cache && cache.models.find(m => m.id === id)) || null; }

  function dealerPlan(id) {
    if (!model(id)) return null;
    return cache.items.filter(x => x.car_model_id === id).sort((a, b) => a.sort - b.sort);
  }

  /* Writes a dealer plan's intervals onto a vehicle's services as
     normalKm/normalMonths — the fields the maintenance page already labels
     "Dealer". Matched by service name; services the plan doesn't list are
     left alone. Only upcoming due dates move; logged history never changes.

     Without `force`, a car seeing the catalogue for the first time takes the
     plan only on fields still at their built-in value (unset, or equal to
     NORMAL_SCHED) — that picks up an admin correction made before this car
     ever synced, while a dealer interval the user edited by hand is kept.
     After that only a NEWER plan version applies, to every listed service.
     Per-item overrides that survive every update are Phase 3.

     Returns 'changed' when an interval moved, 'stamped' when only
     car.planVersion did (both need saving; only 'changed' needs a repaint),
     and false when nothing happened. */
  function applyDealerPlan(data, opts) {
    const force = !!(opts && opts.force);
    const car = data && data.car;
    const m = car && model(car.catalogId);
    if (!m || car.planVersion === m.plan_updated_at) return false;
    const firstSight = !car.planVersion && !force;
    // Strictly newer, compared as times (Postgres trims fractional zeros, so
    // strings aren't comparable); unparseable counts as older. A stale cache
    // must never downgrade a car another device already updated.
    if (!firstSight && !force && Date.parse(car.planVersion) >= Date.parse(m.plan_updated_at)) return false;
    const byName = new Map(dealerPlan(m.id).map(x => [x.service, x]));
    let changed = false;
    const put = (s, field, value, builtIn) => {
      if (value == null || s[field] === value) return;
      if (firstSight && s[field] != null && s[field] !== builtIn) return;   // hand-edited
      s[field] = value; changed = true;
    };
    (data.services || []).forEach(s => {
      const item = byName.get(s.name);
      if (!item) return;
      const def = NORMAL_SCHED[s.name] || [];
      put(s, 'normalKm', item.interval_km, def[0]);
      put(s, 'normalMonths', item.interval_months, def[1]);
    });
    car.planVersion = m.plan_updated_at;
    return changed ? 'changed' : 'stamped';
  }

  return { configure, reset, load, refresh, model, dealerPlan, applyDealerPlan };
});
