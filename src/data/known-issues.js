/* ============================================================
   Garage — approved known issues (owner-reported failures) for a car model:engine.
   The table holds approved rows only (D-01), so no status filter.
   Dual-mode, like insights.js. Every call resolves; failures give [].
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else root.knownIssues = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  let env = { client: null };
  const TTL_MS = 5 * 60 * 1000;
  const cache = new Map();
  let epoch = 0;
  function configure(next) { cache.clear(); epoch++; env = Object.assign({}, env, next || {}); }
  function reset() { cache.clear(); epoch++; env = { client: null }; }

  function forCar(carModelId) {
    if (!env.client || !carModelId) return Promise.resolve([]);
    const hit = cache.get(carModelId);
    if (hit && (hit.p || hit.exp > Date.now())) return hit.p || Promise.resolve(hit.v);
    const gen = epoch;
    const p = Promise.resolve().then(() => env.client.from('known_issues').select('issue_key,title,summary,typical_km,mentions,sources').eq('car_model_id', carModelId))
      .then(res => ({ ok: !!(res && !res.error && res.data), v: res && !res.error && res.data ? res.data : [] }))
      .catch(() => ({ ok: false, v: [] }))
      .then(r => {
        if (gen === epoch) { if (r.ok) cache.set(carModelId, { v: r.v, exp: Date.now() + TTL_MS }); else cache.delete(carModelId); }
        return r.v;
      });
    cache.set(carModelId, { p });
    return p;
  }

  return { configure, reset, forCar };
});
