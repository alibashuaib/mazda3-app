/* ============================================================
   Garage — record normalisation and profile assembly.
   normalizeData runs on every load and must stay idempotent: it is
   also the migration path for legacy and imported records.
   Dual-mode, like storage.js.
   ============================================================ */
'use strict';
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const dep = isNode
    ? Object.assign({},
        require('../core/schedule.js'),
        require('./storage.js'),
        require('../core/helpers.js'),
        require('./catalog.js'))
    : root;
  const api = factory(dep);
  if (isNode) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function (dep) {

  /* Assemble a fresh vehicle profile from the catalogue. */
  function buildProfile(modelId, engIdx, opts) {
    opts = opts || {};
    const m = dep.CAR_MODELS.find(x => x.id === modelId) || dep.CAR_MODELS[1];
    const [engine, oilL] = m.engines[engIdx || 0] || m.engines[0];
    const odo = opts.odometer != null ? opts.odometer : 0;
    const s = {
      car: { nickname: '', make: 'Mazda', model: m.model, year: opts.year || '', engine, transmission: 'Automatic',
        color: opts.color || dep.DEFAULT_COLOR, plate: '', vin: '', photo: '', odometer: odo, dailyKm: 40 },
      budget: { annual: 6000 },
      services: dep.skyactivServices(oilL),
      parts: modelId === 'mazda3bm' ? dep.mazda3Parts() : dep.sharedParts(),
      history: [], spending: [], fuel: [], docs: []
    };
    // baseline every service at the current odometer / today so the schedule tracks from now
    s.services.forEach(x => { x.lastKm = odo; x.lastDate = dep.isoDate(dep.today()); });
    return s;
  }
  // default first vehicle: the owner's 2016 Mazda 3 (BM · 2.0) at 316,000 km
  function seed() { return buildProfile('mazda3bm', 0, { odometer: 316000, year: 2016, color: dep.DEFAULT_COLOR }); }

  function normalizeData(s) {
    s.car = Object.assign({ nickname: '', vin: '', photo: '' }, s.car);
    ['services', 'parts', 'history', 'spending', 'fuel', 'docs'].forEach(k => { if (!Array.isArray(s[k])) s[k] = []; });
    /* Record-level shape lives in storage.js so the suite can reach it. It runs
       here, before anything reads into the records — the odoUpdatedAt derivation
       below maps over fuel and history, which a null entry would throw on. */
    dep.normalizeRecords(s, dep.uid);
    // When the odometer was last known good. Derived from data on disk — not
    // from today() — because normalizeData runs on every load and is only
    // persisted when something calls save().
    if (!s.car.odoUpdatedAt) {
      const seen = [].concat(s.fuel.map(f => f.date), s.history.map(h => h.date)).filter(Boolean).sort();
      s.car.odoUpdatedAt = seen.length ? seen[seen.length - 1] : dep.isoDate(dep.today());
    }
    // renderDashboard and renderBudget both read state.budget.annual unguarded,
    // and only seed() ever set it — so any record that did not come from seed()
    // took the whole app down at boot with "Could not open your garage". Reachable
    // from a legacy v1 payload predating the budget feature, and from an imported
    // backup whose vehicle data lacks the key.
    if (!s.budget || typeof s.budget !== 'object') s.budget = { annual: 6000 };
    if (typeof s.budget.annual !== 'number' || !isFinite(s.budget.annual)) s.budget.annual = 6000;
    if (typeof s.planSetupDone !== 'boolean') s.planSetupDone = false;
    if (s.severity !== 'normal' && s.severity !== 'severe') s.severity = 'severe'; // Jeddah default
    // Fuel System Cleaner is now a PART of every oil change (mandatory for the direct-injection
    // SkyActiv-G), not a standalone service. Retire the old standalone line and fold its cost
    // into the oil change. Idempotent — only fires while the standalone still exists.
    const fscIdx = s.services.findIndex(sv => sv.name === 'Fuel System Cleaner');
    if (fscIdx >= 0) {
      s.services.splice(fscIdx, 1);
      const oil = s.services.find(sv => sv.name === 'Engine Oil & Filter');
      if (oil) oil.cost = Number(oil.cost || 0) + 45;
    }
    if (!s.parts.some(p => p.name === 'Fuel System Cleaner (additive)')) s.parts.push(dep.fuelSystemCleanerPart());
    s.services.forEach(sv => { // seed dealer intervals where they differ from severe
      if (sv.normalKm == null && dep.NORMAL_SCHED[sv.name]) { sv.normalKm = dep.NORMAL_SCHED[sv.name][0]; sv.normalMonths = dep.NORMAL_SCHED[sv.name][1]; }
    });
    // community gearbox (ATF) guidance — idempotent, reaches existing vehicles too
    const atf = s.services.find(sv => sv.name === 'Automatic Transmission Fluid');
    if (atf) {
      if (atf.normalKm == null) { atf.normalKm = 80000; atf.normalMonths = 72; } // 60k severe → 80k community max
      if (!/4\.5/.test(atf.note || '')) atf.note = dep.ATF_NOTE;
    }
    if (!s.parts.some(p => p.name === 'Transmission Fluid Filter')) s.parts.push(dep.atfFilterPart());
    if (!s.parts.some(p => p.name === 'Transmission Pan Sealant')) s.parts.push(dep.atfSealantPart());
    return s;
  }

  return { normalizeData, buildProfile, seed };
});
