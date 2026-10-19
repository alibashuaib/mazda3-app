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

  /* YYYY-MM-DD from a Date's LOCAL parts. Must not go through toISOString():
     today() returns local midnight, which is the previous day in UTC for any
     UTC+ timezone, so a UTC-based format would stamp every record a day early. */
  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

  /* 100 = everything on track. Overdue costs a full share of the score,
     due-soon costs 40% of one. healthPenalty is that share in points, so the
     breakdown and the score can never disagree. */
  function healthPenalty(level, count) {
    if (!count) return 0;
    return (level === 'danger' ? 1 : level === 'warn' ? 0.4 : 0) * 100 / count;
  }
  function healthFrom(levels) {
    if (!levels.length) return 100;
    const penalty = levels.reduce((a, l) => a + healthPenalty(l, levels.length), 0);
    return Math.round(Math.min(100, Math.max(0, 100 - penalty)));
  }

  /* A new reading at or above the current one is the freshest mileage we have:
     equal still confirms it. A lower reading is ignored here; correcting a wrong
     high value is the manual "Update mileage" path, which sets it exactly.
     ponytail: deleting a wrong high fuel entry does not lower the odometer by itself. */
  function noteOdometer(car, km, date) {
    const n = Number(km);
    if (!car || !Number.isFinite(n) || n <= 0 || n < (Number(car.odometer) || 0)) return false;
    car.odometer = n;
    if (date && (!car.odoUpdatedAt || date > car.odoUpdatedAt)) car.odoUpdatedAt = date;
    return true;
  }

  /* Cycle order for the theme button. An unrecognised value lands on
     'system', so corrupt storage self-heals. */
  const THEME_ORDER = ['system', 'light', 'dark'];
  function nextTheme(current) {
    return THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
  }

  return { today, isoDate, isQuotaError, mergeMilestones, nextOverdueOccurrence, withinHorizon, daysSince, healthFrom, healthPenalty, noteOdometer, nextTheme };
});
