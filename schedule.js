/* ============================================================
   Garage — pure schedule math.
   Dual-mode: a plain <script> in the browser (assigns to the global
   object) and require()d by the Node tests. Must stay free of DOM,
   localStorage and the app's `state` global so it is testable.
   ============================================================ */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

  /* The current date at local midnight. Called per render — never cached,
     so the app stays correct when left open across midnight. */
  function today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /* localStorage quota errors, across browsers. Chrome/Safari throw
     QuotaExceededError, Firefox NS_ERROR_DOM_QUOTA_REACHED, older
     engines set legacy code 22. */
  function isQuotaError(err) {
    if (!err) return false;
    return err.name === 'QuotaExceededError'
      || err.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || err.code === 22;
  }

  /* Group service occurrences into workshop visits. Occurrences within
     `tolerance` km of the milestone that started the group join it — but a
     service is never added to a milestone it is already in, because that
     would silently drop a recurrence. */
  function mergeMilestones(occurrences, tolerance) {
    const sorted = occurrences.slice().sort((a, b) => a.km - b.km);
    const out = [];
    sorted.forEach(o => {
      const last = out[out.length - 1];
      if (last && o.km - last.km <= tolerance && !last.items.includes(o.service)) last.items.push(o.service);
      else out.push({ km: o.km, items: [o.service] });
    });
    return out;
  }

  /* First occurrence strictly after `odo` for a service overdue at `dueKm`,
     continuing on its `ikm` interval. Strictly-after (not >=) matters: when
     (odo - dueKm) is an exact multiple of ikm, a naive ceil() advance lands
     exactly on odo — duplicating the caller's separate "due now" occurrence
     at odo and producing two identical milestones. */
  function nextOverdueOccurrence(dueKm, odo, ikm) {
    return dueKm + (Math.floor((odo - dueKm) / ikm) + 1) * ikm;
  }

  /* Milestones due before `cutoff`, but never fewer than `minCount` — so the
     view cannot empty out simply because of the time of year. */
  function withinHorizon(milestones, cutoff, minCount) {
    const within = milestones.filter(m => m.date <= cutoff);
    return within.length >= minCount ? within : milestones.slice(0, minCount);
  }

  /* Whole days between an ISO YYYY-MM-DD date and `now`. A missing date is
     infinitely stale so callers treat it as needing attention. Never negative. */
  function daysSince(isoDateStr, now) {
    if (!isoDateStr) return Infinity;
    const then = new Date(isoDateStr + 'T00:00:00');
    if (isNaN(then.getTime())) return Infinity;
    return Math.max(0, Math.floor((now - then) / 86400000));
  }

  return { today, isQuotaError, mergeMilestones, nextOverdueOccurrence, withinHorizon, daysSince };
});
