/* ============================================================
   Garage — approved recalls for a car model (NHTSA, US market).
   Read side only: the admin approves rows before they appear here.
   Dual-mode, like insights.js. Every call resolves; failures give [].
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else root.recalls = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  let env = { client: null };
  const TTL_MS = 5 * 60 * 1000;
  const cache = new Map();
  let epoch = 0;
  function configure(next) { cache.clear(); epoch++; env = Object.assign({}, env, next || {}); }
  function reset() { cache.clear(); epoch++; env = { client: null }; }

  function forModel(modelId) {
    if (!env.client || !modelId) return Promise.resolve([]);
    const hit = cache.get(modelId);
    if (hit && (hit.p || hit.exp > Date.now())) return hit.p || Promise.resolve(hit.v);
    const gen = epoch;
    const p = Promise.resolve().then(() => env.client.from('recalls').select('campaign,component,summary,years').eq('car_model_id', modelId).eq('status', 'approved'))
      .then(res => ({ ok: !!(res && !res.error && res.data), v: res && !res.error && res.data ? res.data : [] }))
      .catch(() => ({ ok: false, v: [] }))
      .then(r => {
        if (gen === epoch) { if (r.ok) cache.set(modelId, { v: r.v, exp: Date.now() + TTL_MS }); else cache.delete(modelId); }
        return r.v;
      });
    cache.set(modelId, { p });
    return p;
  }

  /* Campaigns cover specific model years; no year on the car (or none on the row) keeps the row. */
  function forYear(rows, year) {
    const y = Number(year);
    if (!y) return rows || [];
    return (rows || []).filter(r => !Array.isArray(r.years) || !r.years.length || r.years.map(Number).includes(y));
  }

  return { configure, reset, forModel, forYear };
});
