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

  function partContributions({ modelId, vehicleId, historyEntry, priorHistory }) {
    const earlier = (priorHistory || []).filter(h => h.id !== historyEntry.id && h.odometer < historyEntry.odometer);
    if (!MONTH_RE.test(monthOf(historyEntry.date))) return [];
    return (historyEntry.parts || []).filter(p => p.part && p.price > 0).map(p => {
      const prev = earlier.filter(h => (h.parts || []).some(q => key(q.part) === key(p.part)))
        .sort((a, b) => b.odometer - a.odometer)[0];
      const row = {
        source_key: `part:${vehicleId}:${historyEntry.id}:${key(p.part)}`, kind: 'part',
        model_id: modelId,
        odometer_band: band(historyEntry.odometer), month: monthOf(historyEntry.date),
        item_key: key(p.part), brand: p.brand || null, part_no: p.partNo || null, price: round2(p.price)
      };
      if (prev) row.km_since_prev = historyEntry.odometer - prev.odometer;
      return row;
    });
  }

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
  function configure(next) { env = Object.assign({}, env, next || {}); }
  function reset() { env = DEFAULT_ENV; }
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
  const getBrandLife = (modelId, itemKey) => stats('brand_life', { modelId, itemKey });

  return { band, monthOf, fuelContribution, partContributions, predictNext, fuelInsight, partInsight, configure, reset, available, shareEnabled, noticeSeen, markNoticeSeen, setShare, syncPrefs, pushPrefs, flushPendingDelete, submit, deleteMine, getFuelStats, getBrandLife };
});
