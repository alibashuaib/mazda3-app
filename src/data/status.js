/* ============================================================
   Garage — service status. Pure: every input arrives as an argument,
   so the schedule maths can be tested without a session or a DOM.
   Dual-mode, like storage.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const dep = isNode
    ? Object.assign({}, require('../core/schedule.js'), require('../core/helpers.js'))
    : root;
  const api = factory(dep);
  if (isNode) module.exports = api;
  else root.Status = api;       // a namespace — the adapters in app.js reuse these names
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {

  /* Severe = the app's own Jeddah values; normal = the dealer values where a
     service defines them, else the same. */
  function svKm(s, severity) { return (severity === 'normal' && s.normalKm) ? s.normalKm : s.intervalKm; }
  function svMo(s, severity) { return (severity === 'normal' && s.normalMonths) ? s.normalMonths : s.intervalMonths; }

  function serviceStatus(s, ctx) {
    const odo = ctx.odometer;
    const ikm = svKm(s, ctx.severity), imo = svMo(s, ctx.severity);
    const dueKm = s.lastKm + ikm;
    const kmLeft = dueKm - odo;
    const dueDate = dep.addMonths(dep.parseDate(s.lastDate), imo);
    const daysLeft = Math.round((dueDate - dep.today()) / 86400000);
    const kmProg = (odo - s.lastKm) / ikm;
    const timeProg = dep.monthsBetween(dep.parseDate(s.lastDate), dep.today()) / imo;
    const prog = Math.max(kmProg, timeProg);
    const drivenByTime = timeProg >= kmProg;
    let level = 'ok';
    if (kmLeft <= 0 || daysLeft <= 0) level = 'danger';
    else if (kmLeft <= 1200 || daysLeft <= 30) level = 'warn';
    return { dueKm, kmLeft, dueDate, daysLeft, prog: dep.clamp(prog, 0, 1.2), level, drivenByTime };
  }

  function ctxOf(data) { return { odometer: data.car.odometer, severity: data.severity }; }

  function servicesRanked(data) {
    const ctx = ctxOf(data);
    return data.services
      .map(s => ({ s, st: serviceStatus(s, ctx) }))
      .sort((a, b) => a.st.prog === b.st.prog ? a.st.kmLeft - b.st.kmLeft : b.st.prog - a.st.prog);
  }

  function healthScore(data) {
    const ctx = ctxOf(data);
    return dep.healthFrom(data.services.map(s => serviceStatus(s, ctx).level));
  }

  return { svKm, svMo, serviceStatus, servicesRanked, healthScore };
});
