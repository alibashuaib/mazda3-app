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
  const api = factory(isNode ? require('./catalog.js') : root);
  if (isNode) module.exports = api;
  else root.remoteCatalog = api;
})(typeof self !== 'undefined' ? self : globalThis, function (cat) {
  const NORMAL_SCHED = cat.NORMAL_SCHED;

  const DEFAULTS = { client: null, pageSize: 1000, metaGet: () => Promise.resolve({}), metaSet: () => Promise.resolve(true) };
  let env = Object.assign({}, DEFAULTS);
  let cache = null;   // { models, items, parts, fetchedAt }

  function configure(next) { env = Object.assign({}, env, next || {}); }
  function reset() { env = Object.assign({}, DEFAULTS); cache = null; }

  function load() {
    return Promise.resolve(env.metaGet()).then(meta => {
      const c = meta && meta.catalogue;
      if (c && Array.isArray(c.models) && Array.isArray(c.items)) cache = Object.assign({ parts: [] }, c);   // old caches predate parts
      if (cache) register();
      return !!cache;
    }).catch(() => false);
  }

  /* Never rejects: offline or an unconfigured project leaves the last good
     cache in place, which is the whole point of keeping one. */
  function register() { if (typeof cat.registerModels === 'function') cat.registerModels(cache.models); }
  function loaded() { return !!cache; }

  function refresh() {
    if (!env.client) return Promise.resolve(false);
    return Promise.all([
      env.client.from('car_models').select('id,model,generation,engine,warranty_years,warranty_km,plan_updated_at,oil_capacity_l,paints,markets,parts_updated_at').eq('status', 'approved'),
      allItems(), allParts()
    ]).then(([m, items, parts]) => {
      if (!m || m.error || !items || !parts) return false;
      cache = { models: m.data || [], items, parts, fetchedAt: new Date().toISOString() };
      register();
      return Promise.resolve(env.metaSet({ catalogue: cache })).then(() => true);
    }).catch(() => false);
  }

  /* PostgREST silently caps a response at max-rows (1000 by default), so
     page until a short page. Resolves null on any error. */
  function allItems(from, acc) {
    from = from || 0; acc = acc || [];
    const size = env.pageSize;
    return Promise.resolve(env.client.from('dealer_plan_items')
      .select('car_model_id,service,icon,category,interval_km,interval_months,severe_km,severe_months,note,parts,sort')
      .order('id').range(from, from + size - 1)).then(r => {
      if (!r || r.error) return null;
      const rows = acc.concat(r.data || []);
      return (r.data || []).length < size ? rows : allItems(from + size, rows);
    });
  }

  function allParts(from, acc) {
    from = from || 0; acc = acc || [];
    const size = env.pageSize;
    return Promise.resolve(env.client.from('catalogue_parts')
      .select('car_model_id,part_name,slot,brand,part_no,price,price_basis,note')
      .order('car_model_id').order('part_name').order('slot').range(from, from + size - 1)).then(r => {
      if (!r || r.error) return null;
      const rows = acc.concat(r.data || []);
      return (r.data || []).length < size ? rows : allParts(from + size, rows);
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
      // Severe-use interval (D-09, SCH-02): no built-in default, so null skips and
      // a hand-edited value is protected on first sight.
      put(s, 'severeKm', item.severe_km);
      put(s, 'severeMonths', item.severe_months);
    });
    car.planVersion = m.plan_updated_at;
    return changed ? 'changed' : 'stamped';
  }

  function parts(id) { return ((cache && cache.parts) || []).filter(x => x.car_model_id === id); }

  /* Approved part rows onto a vehicle's parts (PRT-01/02, COM-02). Rows are
     keyed by the full catalogId, so an engine's value never lands on another
     engine's car. An option is overwritten only while its price still equals
     the catalogue price it was stamped with (catPrice); an owner-typed price,
     or an option with no catPrice, is never touched. The one deletion: an
     ALT option the catalogue itself created (no store, price still equal to
     its catPrice) whose approved row is gone, so a withdrawn alternative does
     not linger on every device.
     Returns 'changed' | 'stamped' | false like applyDealerPlan. */
  function applyParts(data, opts) {
    const force = !!(opts && opts.force);
    const car = data && data.car;
    const m = car && model(car.catalogId);
    if (!m || !m.parts_updated_at || car.partsVersion === m.parts_updated_at) return false;
    if (!force && car.partsVersion && Date.parse(car.partsVersion) >= Date.parse(m.parts_updated_at)) return false;
    let changed = false;
    parts(m.id).forEach(r => {
      const p = (data.parts || []).find(x => x.name === r.part_name);
      if (!p) return;
      if (r.price == null) {
        // Admin blanked the price: drop the catalogue-owned option rather than keep the stale price on screen.
        // Never stamp Number(null) (= 0 SAR) as a price.
        const lbn = String(r.brand || '').toLowerCase(), isO = r.slot === 'oem', n0 = p.options.length;
        p.options = p.options.filter(x => !(x.catPrice != null && (isO ? x.tag === 'OEM' : x.tag === 'ALT' && String(x.brand || '').toLowerCase() === lbn)));
        if (p.options.length !== n0) changed = true;
        return;
      }
      p.options = p.options || [];
      const price = Number(r.price), indicative = r.price_basis === 'indicative';
      const vals = { brand: r.brand, partNo: r.part_no || '', price, note: r.note || '', catPrice: price, indicative };
      const isOem = r.slot === 'oem';
      const lb = String(r.brand || '').toLowerCase();
      const o = p.options.find(x => isOem ? x.tag === 'OEM' : x.tag === 'ALT' && String(x.brand || '').toLowerCase() === lb);
      if (o) {
        if (o.catPrice == null || o.price !== o.catPrice) return;   // owner's value
        if (Object.keys(vals).every(k => o[k] === vals[k])) return;
        Object.assign(o, vals); changed = true;
      } else if (!isOem) {
        p.options.push(Object.assign({ tag: 'ALT', store: '' }, vals)); changed = true;
      }
    });
    const rows = parts(m.id);
    (data.parts || []).forEach(p => {
      const before = (p.options || []).length;
      if (!before) return;
      p.options = p.options.filter(o => !(o.tag === 'ALT' && !o.store && o.catPrice != null && o.price === o.catPrice
        && !rows.some(r => r.part_name === p.name && r.slot !== 'oem' && String(r.brand || '').toLowerCase() === String(o.brand || '').toLowerCase())));
      if (p.options.length !== before) changed = true;
    });
    car.partsVersion = m.parts_updated_at;
    return changed ? 'changed' : 'stamped';
  }

  return { configure, reset, load, refresh, loaded, model, dealerPlan, applyDealerPlan, parts, applyParts };
});
