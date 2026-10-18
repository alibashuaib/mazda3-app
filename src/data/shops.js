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
  // Community and shared-list tables are readable by signed-in users only; signed out, make no request.
  const live = () => !!env.client && (typeof env.signedIn === 'function' ? !!env.signedIn() : true);
  /* Read cache: 5 min TTL, concurrent identical calls share one request, only
     successful responses are stored. `epoch` stops a request that was in flight
     during reset()/configure() from repopulating the cleared cache. */
  const TTL_MS = 5 * 60 * 1000;
  const cache = new Map();
  let epoch = 0;
  const clearCache = () => { cache.clear(); epoch++; };
  function memo(key, load) {                       // load() -> Promise<{ ok, v }>
    const hit = cache.get(key);
    if (hit && (hit.p || hit.exp > Date.now())) return hit.p || Promise.resolve(hit.v);
    const gen = epoch;
    const p = load().then(r => {
      if (gen === epoch) { if (r.ok) cache.set(key, { v: r.v, exp: Date.now() + TTL_MS }); else cache.delete(key); }
      return r.v;
    });
    cache.set(key, { p });
    return p;
  }
  const configure = next => { clearCache(); env = Object.assign({}, env, next || {}); };
  const reset = () => { clearCache(); env = { client: null }; };
  const available = () => !!live();

  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const like = s => String(s).replace(/[%_\\]/g, ch => '\\' + ch);   // ilike wildcards mean nothing to a user
  const unwrap = res => (res && !res.error && res.data) || null;

  // One place decides the stored key, so find and create can never disagree.
  const keyOf = name => norm(name).slice(0, 80);
  const cityOf = city => String(city).trim().slice(0, 40);

  function findExact(name, city) {
    if (!live()) return Promise.resolve(null);
    return Promise.resolve().then(() => env.client.from('shops').select('id,name,city,area')
      .eq('name_norm', keyOf(name)).ilike('city', like(cityOf(city))).maybeSingle())
      .then(unwrap).catch(() => null);
  }
  function create(name, city, area) {
    if (!live()) return Promise.resolve(null);
    return Promise.resolve().then(() => env.client.from('shops')
      .insert({ name: String(name).trim().slice(0, 80), name_norm: keyOf(name), city: cityOf(city), area: String(area || '').trim().slice(0, 40) || null })
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

  const squash = s => norm(s).replace(/ /g, '');   // mirrors the generated shops.name_key column

  // City-first; if that finds nothing (or no city typed) the same query runs across all cities.
  function search(query, city) {
    const q = squash(query), c = String(city || '').trim();
    if (!live() || q.length < 2) return Promise.resolve([]);
    const run = withCity => Promise.resolve().then(() => {
      let req = env.client.from('shops').select('id,name,city,area').ilike('name_key', `%${like(q)}%`);
      if (withCity) req = req.ilike('city', like(c));
      return req.limit(8);
    }).then(res => unwrap(res) || []);
    return (c ? run(true) : Promise.resolve([])).then(rows => rows.length ? rows : run(false)).catch(() => []);
  }

  // Normalised Levenshtein ratio of the spaceless keys: 1 = identical, 0 = nothing shared.
  function similarity(a, b) {
    a = squash(a); b = squash(b);
    const m = Math.max(a.length, b.length);
    if (!m) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return 1 - prev[b.length] / m;
  }

  // ponytail: client-side scan of <=200 shops per city; move to a pg_trgm query if a city outgrows that.
  function similar(name, city) {
    const c = String(city || '').trim();
    if (!live() || squash(name).length < 2 || !c) return Promise.resolve([]);
    // A hung request must not hang the save: give up (no prompt) after env.timeoutMs.
    const gaveUp = new Promise(r => setTimeout(() => r(null), env.timeoutMs || 3000));
    return Promise.race([Promise.resolve().then(() => env.client.from('shops').select('id,name,city,area').ilike('city', like(c)).limit(200)), gaveUp])
      .then(res => (unwrap(res) || [])
        .filter(r => norm(r.name) !== norm(name))
        .map(r => ({ r, s: similarity(name, r.name) }))
        .filter(x => x.s >= 0.75).sort((a, b) => b.s - a.s).slice(0, 3).map(x => x.r))
      .catch(() => []);
  }

  /* The vote_shop RPC decides bill_backed on the server; its boolean means "backed", not "stored", so it is ignored: no error = stored. */
  function vote(shopId, up, reasons, billReadId) {
    if (!live() || !shopId) return Promise.resolve(false);
    const args = { p_shop_id: shopId, p_vote: up ? 1 : -1, p_reasons: [...new Set(Array.isArray(reasons) ? reasons : [])].filter(r => REASONS.includes(r)), p_bill_read_id: billReadId || null };
    return Promise.resolve().then(() => env.client.rpc('vote_shop', args))
      .then(res => { const ok = !(res && res.error); if (ok) clearCache(); return ok; }).catch(() => false);   // a vote changes trust
  }

  // memo() wants { ok, v }: a failed query yields [] but is never cached.
  const readRows = query => Promise.resolve().then(query)
    .then(res => { const rows = unwrap(res); return { ok: !!rows, v: rows || [] }; }).catch(() => ({ ok: false, v: [] }));

  function getTrust(shopIds) {
    if (!live() || !shopIds || !shopIds.length) return Promise.resolve([]);
    const ids = [...shopIds];
    return memo('trust:' + [...ids].sort().join(','), () => readRows(() => env.client.from('shop_trust').select('*').in('shop_id', ids)));
  }
  function getStorePrices(modelId, itemKey) {
    if (!live()) return Promise.resolve([]);
    return memo('prices:' + JSON.stringify([modelId, itemKey]), () => readRows(() => env.client.from('store_prices').select('*').eq('model_id', modelId).eq('item_key', itemKey)));
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

  return { CITIES, REASONS, configure, reset, clearCache, available, norm, findExact, create, findOrCreate, search, similarity, similar, vote, getTrust, getStorePrices, lastCity, storeAdvice };
});
