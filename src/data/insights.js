/* ============================================================
   Insights — anonymous community statistics (see spec).
   Dual-mode like pricing.js. Pure functions first, network below.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else root.insights = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {

  const BAND_KM = 5000;
  const band = odo => Math.floor((Number(odo) || 0) / BAND_KM) * BAND_KM;
  const monthOf = iso => String(iso || '').slice(0, 7);
  const round2 = n => Math.round(n * 100) / 100;
  const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  const key = s => String(s || '').trim().toLowerCase();

  /* One closed full-to-full interval -> one anonymous row. Null when the
     economy figure is missing or implausible: bad data must not reach the pool. */
  function fuelContribution({ modelId, engine, vehicleId, entry, l100 }) {
    if (!(entry && entry.litres > 0 && Number.isFinite(entry.odometer) && entry.odometer >= 0) || !(l100 >= 1 && l100 <= 40) || !MONTH_RE.test(monthOf(entry.date))) return null;
    return {
      source_key: `fuel:${vehicleId}:${entry.id}`, kind: 'fuel', model_id: modelId, engine: engine || null,
      odometer_band: band(entry.odometer), month: monthOf(entry.date),
      l100: round2(l100), price_per_l: entry.cost > 0 ? round2(entry.cost / entry.litres) : null
    };
  }

  const ACTIONS = ['replaced', 'repaired', 'inspected'];
  const actionOf = p => ACTIONS.includes(p.action) ? p.action : 'replaced';

  function partContributions({ modelId, vehicleId, historyEntry, priorHistory, shopId }) {
    const earlier = (priorHistory || []).filter(h => h.id !== historyEntry.id && h.odometer < historyEntry.odometer);
    if (!MONTH_RE.test(monthOf(historyEntry.date))) return [];
    const sameAs = (h, k, act) => (h.parts || []).some(q => key(q.part) === k && actionOf(q) === act);
    const latest = (k, act, minKm) => earlier.filter(h => h.odometer > minKm && sameAs(h, k, act)).sort((x, y) => y.odometer - x.odometer)[0];
    return (historyEntry.parts || []).filter(p => p.part && (p.price > 0 || actionOf(p) === 'inspected')).map(p => {
      const action = actionOf(p), k = key(p.part);
      const prev = latest(k, 'replaced', -Infinity);
      const row = {
        source_key: `part:${vehicleId}:${historyEntry.id}:${k}`, kind: 'part',
        model_id: modelId,
        odometer_band: band(historyEntry.odometer), month: monthOf(historyEntry.date),
        item_key: k, brand: p.brand || null, part_no: p.partNo || null, price: p.price > 0 ? round2(p.price) : null,
        action,
        ...(action === 'inspected' && (p.finding === 'ok' || p.finding === 'attention') ? { finding: p.finding } : {}),
        ...(shopId ? { shop_id: shopId } : {})
      };
      if (prev) row.km_since_prev = historyEntry.odometer - prev.odometer;
      if (action === 'replaced') {
        const rep = latest(k, 'repaired', prev ? prev.odometer : -Infinity);
        if (rep) row.km_since_repair = historyEntry.odometer - rep.odometer;
      }
      return row;
    });
  }

  function repairInsight(rows) {
    const r = rows && rows[0]; if (!r) return null;
    const a = Number(r.n_repaired), b = Number(r.n_replaced), i = Number(r.n_inspected);
    const num = v => v == null ? null : Math.round(Number(v));
    return {
      share: a + b >= 5 ? Math.round(100 * a / (a + b)) : null, nRepaired: a, nReplaced: b,
      priceRepaired: num(r.median_price_repaired), priceReplaced: num(r.median_price_replaced),
      kmAfterRepair: r.median_km_after_repair == null ? null : Math.round(Number(r.median_km_after_repair)),
      attention: i > 0 && r.attention_share != null ? Math.round(100 * Number(r.attention_share)) : null, nInspected: i
    };
  }

  // inspections never count toward the floor: share is null below 5 repaired+replaced samples
  const repairMode = info => info && info.share != null ? 'community' : 'none';

  function predictNext(life, lastKm, nowKm) {
    const fromKm = lastKm + life.p25_km, toKm = lastKm + life.p75_km;
    return { fromKm, toKm, usedKm: nowKm - lastKm, status: nowKm < fromKm ? 'early' : nowKm <= toKm ? 'inRange' : 'overdue' };
  }

  function fuelInsight(stats, odometer, mine) {
    if (!stats || !stats.length) return null;
    const b = band(odometer);
    const row = stats.slice().sort((x, y) => Math.abs(x.odometer_band - b) - Math.abs(y.odometer_band - b))[0];
    const typical = Number(row.median_l100);
    return { typical, low: Number(row.p25_l100), high: Number(row.p75_l100), mine: mine == null ? null : mine,
             diff: mine == null ? null : round2(mine - typical) };
  }

  function partInsight(rows, lastKm, nowKm) {
    if (!rows || !rows.length) return null;
    const best = rows.slice().sort((a, b) => (b.median_km - a.median_km) || (a.median_price - b.median_price))[0];
    return {
      best: { brand: best.brand, medianKm: Number(best.median_km), medianPrice: best.median_price, n: best.n },
      prediction: lastKm == null ? null : predictNext({ p25_km: Number(best.p25_km), p75_km: Number(best.p75_km) }, lastKm, nowKm)
    };
  }

  /* ---- Network + consent. Every call resolves; failures never block local saves. ---- */
  let env = { client: null, metaGet: () => Promise.resolve({}), metaSet: () => Promise.resolve(true) };
  const DEFAULT_ENV = env;
  /* brand_life read cache: 5 min TTL, shared in-flight request, successes only.
     `epoch` stops a request in flight during reset()/configure() from repopulating. */
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
  function configure(next) { clearCache(); env = Object.assign({}, env, next || {}); }
  function reset() { clearCache(); env = DEFAULT_ENV; }
  function available() { return !!env.client; }

  const shareEnabled = () => env.metaGet().then(m => m.insightsShare !== false);
  const noticeSeen = () => env.metaGet().then(m => m.insightsNoticeSeen === true);
  const markNoticeSeen = () => env.metaSet({ insightsNoticeSeen: true }).then(pushPrefs).then(() => {});
  /* Preference lives on the server too, so it survives sign-out (storage.wipe clears meta) and new devices.
     Local meta stays the fast read path; the server row wins on sign-in. */
  function pushPrefs() {
    if (!env.client) return Promise.resolve(false);
    return env.metaGet().then(m => env.client.from('insights_prefs')
      .upsert({ share: m.insightsShare !== false, notice_seen: m.insightsNoticeSeen === true, updated_at: new Date().toISOString() }))
      .then(res => !(res && res.error)).catch(() => false);
  }
  function syncPrefs() {
    if (!env.client) return Promise.resolve(false);
    return Promise.resolve().then(() => env.client.from('insights_prefs').select('share,notice_seen').maybeSingle()).then(res => {
      if (!res || res.error) return false;
      if (!res.data) return pushPrefs();
      const patch = { insightsShare: res.data.share, insightsNoticeSeen: res.data.notice_seen };
      if (!res.data.share) patch.insightsDeletePending = true;   // idempotent; clears any rows a lost delete left behind
      return env.metaSet(patch).then(() => true);
    }).catch(() => false);
  }
  /* Opt-out records a pending delete first so a failed RPC is retried by flushPendingDelete. */
  function setShare(on) {
    if (on) return env.metaSet({ insightsShare: true }).then(pushPrefs).then(() => true);
    return env.metaSet({ insightsShare: false, insightsDeletePending: true }).then(pushPrefs).then(flushPendingDelete);
  }
  function flushPendingDelete() {
    return env.metaGet().then(m => {
      if (m.insightsDeletePending !== true) return true;
      return deleteMine().then(ok => ok ? env.metaSet({ insightsDeletePending: false }).then(() => true) : false);
    }).catch(() => false);
  }

  function rpc(fn, args) {
    if (!env.client) return Promise.resolve(false);
    return Promise.resolve().then(() => env.client.rpc(fn, args))
      .then(res => !(res && res.error)).catch(() => false);
  }
  const submit = rows => rpc('submit_contributions', { rows });
  const deleteMine = () => rpc('delete_my_contributions');

  function stats(table, filters) {
    if (!env.client) return Promise.resolve([]);
    return Promise.resolve().then(() => {
      let q = env.client.from(table).select('*').eq('model_id', filters.modelId);
      if (filters.itemKey) q = q.eq('item_key', filters.itemKey);
      return q;
    }).then(res => (res && !res.error && res.data) || []).catch(() => []);
  }
  const getFuelStats = modelId => stats('fuel_stats', { modelId });
  const itemStats = table => (modelId, itemKey) => {
    if (!env.client) return Promise.resolve([]);
    return memo(JSON.stringify([table, modelId, itemKey]), () => Promise.resolve().then(() => env.client.from(table).select('*').eq('model_id', modelId).eq('item_key', itemKey))
      .then(res => { const ok = !!(res && !res.error && res.data); return { ok, v: ok ? res.data : [] }; }).catch(() => ({ ok: false, v: [] })));
  };
  const getBrandLife = itemStats('brand_life');
  const getRepairStats = itemStats('repair_stats');

  return { band, monthOf, fuelContribution, partContributions, predictNext, fuelInsight, partInsight, configure, reset, clearCache, available, shareEnabled, noticeSeen, markNoticeSeen, setShare, syncPrefs, pushPrefs, flushPendingDelete, submit, deleteMine, getFuelStats, getBrandLife, getRepairStats, repairInsight, repairMode };
});
