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
    // Strictly newer, compared as times (Postgres trims fractional zeros, so
    // strings aren't comparable); unparseable counts as older. A stale cache
    // must never downgrade a car another device already updated.
    const have = Date.parse(car.planVersion);
    if (!(opts && opts.force) && have >= Date.parse(m.plan_updated_at)) return false;
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
