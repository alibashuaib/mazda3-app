/* ============================================================
   Guidance: Replace / Repair / Inspect / OK for one schedule item.
   Pure, dual-mode. Thresholds are placeholders pending owner review.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const api = factory();
  if (isNode) module.exports = api; else root.guidance = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const REPAIR_SHARE = 50;      // % of owners who repaired instead of replacing
  const ATTENTION_RATE = 30;    // % of inspections that found a problem
  const MIN_INSPECTIONS = 3;
  const SAFETY = /\b(brake|brakes|tyre|tyres|tire|tires|steering)\b|فرامل|إطار|اطار|دركسون|توجيه/i;
  const isSafetyCritical = name => SAFETY.test(String(name || ''));

  function decide({ level, medianLifeKm, usedKm, repair, tip, safety }) {
    const due = level === 'warn' || level === 'danger';
    const flagged = !!(repair && repair.attention != null && repair.nInspected >= MIN_INSPECTIONS && repair.attention >= ATTENTION_RATE);
    const communityUsed = !!(repair && (repair.share != null || flagged)) || medianLifeKm != null;
    if (flagged) return { action: 'inspect', reason: 'of owners who inspected this found a problem', n: repair.attention, communityUsed: true };
    if (!due) return { action: 'ok', reason: 'Not due yet', n: null, communityUsed };
    if (safety) return { action: 'inspect', reason: 'Safety-critical and due: have it checked', n: null, communityUsed };
    const pastLife = medianLifeKm != null && usedKm >= medianLifeKm;
    if (pastLife && tip && repair && repair.share != null && repair.share >= REPAIR_SHARE)
      return { action: 'repair', reason: 'of owners repaired this instead of replacing it', n: repair.share, communityUsed: true };
    return { action: 'replace', reason: pastLife ? 'Due, and past the typical life other owners see' : 'Due by the Mazda schedule', n: null, communityUsed };
  }

  /* Community rows whose item_key is the service name or contains it (or the reverse) as a whole
     phrase: "engine oil" matches "engine oil 0w-20", never "oil filter". Names under 4 letters match nothing. */
  const norm = x => String(x || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  function matchRows(service, rows) {
    const a = norm(service);
    if (a.length < 4 || !Array.isArray(rows)) return [];
    return rows.filter(r => {
      const b = norm(r && r.item_key);
      return b.length >= 4 && (a === b || ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `));
    });
  }

  return { decide, isSafetyCritical, matchRows, REPAIR_SHARE, ATTENTION_RATE, MIN_INSPECTIONS };
});
