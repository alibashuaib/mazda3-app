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
  const key = s => String(s || '').trim().toLowerCase();

  /* One closed full-to-full interval -> one anonymous row. Null when the
     economy figure is missing or implausible: bad data must not reach the pool. */
  function fuelContribution({ modelId, engine, vehicleId, entry, l100 }) {
    if (!(entry && entry.litres > 0 && Number.isFinite(entry.odometer) && entry.odometer >= 0) || !(l100 >= 1 && l100 <= 40)) return null;
    return {
      source_key: `fuel:${vehicleId}:${entry.id}`, kind: 'fuel', model_id: modelId, engine: engine || null,
      odometer_band: band(entry.odometer), month: monthOf(entry.date),
      l100: round2(l100), price_per_l: entry.cost > 0 ? round2(entry.cost / entry.litres) : null
    };
  }

  function partContributions({ modelId, vehicleId, historyEntry, priorHistory }) {
    const earlier = (priorHistory || []).filter(h => h.id !== historyEntry.id && h.odometer < historyEntry.odometer);
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

  return { band, monthOf, fuelContribution, partContributions, predictNext };
});
