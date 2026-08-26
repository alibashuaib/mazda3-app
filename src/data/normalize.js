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
    const m = dep.CAR_MODELS.find(x => x.id === modelId);
    if (!m) throw new RangeError(`Unknown Mazda model: ${modelId}`);
    const [engine, oilL] = m.engines[engIdx || 0] || m.engines[0];
    const odo = opts.odometer != null ? opts.odometer : 0;
    const colors = Array.isArray(m.colors) && m.colors.length ? m.colors : [dep.DEFAULT_COLOR];
    const requestedColor = colors.find(x => paintKey(x) === paintKey(opts.color));
    const s = {
      car: { nickname: '', make: 'Mazda', model: m.model, modelId: m.id, year: opts.year || '', engine, transmission: 'Automatic',
        color: requestedColor || colors[0], plate: '', vin: '', photo: '', odometer: odo, dailyKm: 40 },
      budget: { annual: 6000 },
      services: dep.skyactivServices(oilL),
      parts: dep.partsForModel(m.id),
      history: [], spending: [], fuel: [], docs: []
    };
    // baseline every service at the current odometer / today so the schedule tracks from now
    s.services.forEach(x => { x.lastKm = odo; x.lastDate = dep.isoDate(dep.today()); });
    return s;
  }
  function paintKey(value) {
    return String(value || '').toLowerCase().replace(/\s*\(code[^)]*\)/g, '').trim();
  }
  // default first vehicle: the owner's 2016 Mazda 3 (BM · 2.0) at 316,000 km
  function seed() { return buildProfile('mazda3bm', 0, { odometer: 316000, year: 2016, color: dep.DEFAULT_COLOR }); }

  function normalizeData(s) {
    s.car = Object.assign({ nickname: '', vin: '', photo: '' }, s.car);
    if (!dep.CAR_MODELS.some(m => m.id === s.car.modelId)) {
      const model = String(s.car.model || '').toUpperCase();
      const year = Number(s.car.year) || 0;
      if (model === '2') s.car.modelId = 'mazda2';
      else if (model === '3') s.car.modelId = year >= 2019 ? 'mazda3bp' : 'mazda3bm';
      else if (model === '6') s.car.modelId = 'mazda6';
      else if (model === 'CX-3') s.car.modelId = 'cx3';
      else if (model === 'CX-30') s.car.modelId = 'cx30';
      else if (model === 'CX-5') s.car.modelId = year >= 2026 ? 'cx5gen3' : year >= 2017 ? 'cx5kf' : 'cx5ke';
      else if (model === 'CX-9') s.car.modelId = year && year < 2016 ? 'cx9tb' : 'cx9';
      else if (model === 'CX-50') s.car.modelId = 'cx50';
      else if (model === 'CX-60') s.car.modelId = 'cx60';
      else if (model === 'CX-70') s.car.modelId = 'cx70';
      else if (model === 'CX-80') s.car.modelId = 'cx80';
      else if (model === 'CX-90') s.car.modelId = 'cx90';
      else s.car.modelId = '';
    }
    const activeModel = dep.CAR_MODELS.find(m => m.id === s.car.modelId);
    if (activeModel) {
      const allowedColors = Array.isArray(activeModel.colors) && activeModel.colors.length
        ? activeModel.colors : [dep.DEFAULT_COLOR];
      s.car.color = allowedColors.find(x => paintKey(x) === paintKey(s.car.color)) || allowedColors[0];
    } else if (!s.car.color) s.car.color = dep.DEFAULT_COLOR;
    ['services', 'parts', 'history', 'spending', 'fuel', 'docs'].forEach(k => { if (!Array.isArray(s[k])) s[k] = []; });
    /* Record-level shape lives in storage.js so the suite can reach it. It runs
       here, before anything reads into the records — the odoUpdatedAt derivation
       below maps over fuel and history, which a null entry would throw on. */
    dep.normalizeRecords(s, dep.uid);
    // Fitment is enforced at the data boundary, not only in the Parts page.
    // Legacy generic recommendations are removed for non-BM cars; user-created
    // parts are retained but locked to the vehicle they were created under.
    s.parts = s.parts
      .filter(p => !dep.isLegacyUnverifiedPart(p, s.car.modelId))
      .map(p => dep.ensurePartFitment(p, s.car.modelId));
    if (s.car.modelId) s.parts = s.parts.filter(p => dep.partFitsCar(p, s.car));
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
    const directInjectionGasoline = !!activeModel && !/(MZI|SkyActiv-D)/i.test(s.car.engine || '');
    if (!directInjectionGasoline) s.parts = s.parts.filter(p => p.name !== 'Fuel System Cleaner (additive)');
    else if (!s.parts.some(p => p.name === 'Fuel System Cleaner (additive)')) {
      s.parts.push(dep.fuelSystemCleanerPart(s.car.modelId));
    }
    s.services.forEach(sv => { // seed dealer intervals where they differ from severe
      if (sv.normalKm == null && dep.NORMAL_SCHED[sv.name]) { sv.normalKm = dep.NORMAL_SCHED[sv.name][0]; sv.normalMonths = dep.NORMAL_SCHED[sv.name][1]; }
    });
    // community gearbox (ATF) guidance — idempotent, reaches existing vehicles too
    const atf = s.services.find(sv => sv.name === 'Automatic Transmission Fluid');
    const usesAtfFz = dep.modelUsesAtfFz(s.car.modelId);
    if (atf && usesAtfFz) {
      if (atf.normalKm == null) { atf.normalKm = 80000; atf.normalMonths = 72; } // 60k severe → 80k community max
      if (!/4\.5/.test(atf.note || '')) atf.note = dep.ATF_NOTE;
    } else if (atf && ['cx60', 'cx70', 'cx80', 'cx90'].includes(s.car.modelId)) {
      atf.note = 'Large-platform 8-speed automatic: Mazda Original Oil ATF-A7. Verify the exact procedure and quantity for your VIN; do not substitute ATF-FZ.';
    } else if (atf && s.car.modelId === 'cx9tb') {
      atf.note = 'First-generation CX-9 transmission: verify the exact fluid specification and quantity for your VIN; do not use the later CX-9 ATF-FZ recommendation.';
    }
    if (!usesAtfFz) s.parts = s.parts.filter(p => !['ATF FZ (per liter)', 'Transmission Fluid Filter', 'Transmission Pan Sealant'].includes(p.name));
    // FZ01-21-500 and the pan-seal procedure are verified only for the owner's BM.
    if (s.car.modelId === 'mazda3bm' && !s.parts.some(p => p.name === 'Transmission Fluid Filter')) s.parts.push(dep.atfFilterPart(s.car.modelId));
    if (s.car.modelId === 'mazda3bm' && !s.parts.some(p => p.name === 'Transmission Pan Sealant')) s.parts.push(dep.atfSealantPart(s.car.modelId));
    // Tires are locked to the exact car (unlike every other shared
    // consumable), because the wrong size does not just under-perform.
    // Backfills existing vehicles that predate this part, and re-adds it if
    // switching models ever leaves a car without one of its own.
    if (s.car.modelId && !s.parts.some(p => p.cat === 'Tires' && p.fitment && !p.fitment.shareable && p.fitment.modelIds.includes(s.car.modelId))) {
      s.parts.push(dep.tiresPart(s.car.modelId));
    }
    return s;
  }

  return { normalizeData, buildProfile, seed };
});
