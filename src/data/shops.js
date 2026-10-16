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

  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const like = s => String(s).replace(/[%_\\]/g, ch => '\\' + ch);   // ilike wildcards mean nothing to a user
  const unwrap = res => (res && !res.error && res.data) || null;

  // One place decides the stored key, so find and create can never disagree.
  const keyOf = name => norm(name).slice(0, 80);
  const cityOf = city => String(city).trim().slice(0, 40);

  function findExact(name, city) {
    if (!env.client) return Promise.resolve(null);
    return Promise.resolve().then(() => env.client.from('shops').select('id,name,city,area')
      .eq('name_norm', keyOf(name)).ilike('city', like(cityOf(city))).maybeSingle())
      .then(unwrap).catch(() => null);
  }
  function create(name, city, area) {
    if (!env.client) return Promise.resolve(null);
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
    const row = { shop_id: shopId, vote: up ? 1 : -1, reasons: [...new Set(Array.isArray(reasons) ? reasons : [])].filter(r => REASONS.includes(r)), bill_backed: false };
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
