/* ============================================================
   Garage — 2016 Mazda 3 2.0 SkyActiv-G  ·  vanilla JS SPA
   Data persists in localStorage. Everything is editable in-app.
   ============================================================ */
'use strict';

/* The pre-garage v1 key is read by storage.js (LEGACY_V1_KEY / readLegacyV1)
   and seeded from in hydrate(). Nothing here writes it. */

/* ---------- helpers ---------- */
/* $, el, uid, fmt, sar, clamp, parseDate, monthsBetween, addMonths now live
   in src/core/helpers.js (loaded as a script before this file). */

/* The session owns the garage; app.js reads it through these. Phase 3c
   deletes them along with this file, and each page module calls
   session.current() directly. */
const save = () => session.save();
const switchVehicle = id => session.switchVehicle(id);
const revokeObjectUrls = () => session.revokeObjectUrls();
const refreshPhotoUrls = () => session.refreshPhotoUrls();
/* Status functions are pure now; these thread the session through so the
   render code reads unchanged until Phase 3c moves it. */
const svKm = s => Status.svKm(s, session.current().severity);
const svMo = s => Status.svMo(s, session.current().severity);
const serviceStatus = s => Status.serviceStatus(s, { odometer: session.current().car.odometer, severity: session.current().severity });
const servicesRanked = () => Status.servicesRanked(session.current());
const healthScore = () => Status.healthScore(session.current());
/* lang, t, relDate, applyNavLabels, applyLang now live in src/i18n/lang.js
   (loaded as a script before this file). */

/* ============================================================
   SEED DATA — Mazda 3 2.0 SkyActiv-G, Saudi (severe) intervals
   Odometer baseline ~155,000 km. All values editable in-app.
   ============================================================ */
/* buildProfile and seed now live in src/data/normalize.js (loaded as a
   script before this file). */

/* ---------- state / storage ---------- */
/* The garage — { vehicles: [{ id, data }], activeId } — and the active
   vehicle's data now live in src/data/session.js. Read them through
   session.garage() and session.current(); nothing here holds a reference,
   which is what will make sign-out a one-liner.
   session.booted() guards navigation and chrome (tabs, settings, garage)
   until boot has hydrated the session. A failed boot leaves it false so a
   stray tap can't clear the error card and crash into a blank screen. */
/* normalizeData now lives in src/data/normalize.js (loaded as a script
   before this file). */
/* Phase 3: the session (src/data/session.js) owns `state`, the photo Blob
   cache and the object-URL registry, along with hydrate(), resolvePhotos(),
   save(), prunePhotoBlobs() and cacheNewPhotos(). Reads stay synchronous —
   the whole garage is hydrated at boot — so page code is unchanged. */

/* The session switch plus the UI that has to follow it. session.switchVehicle
   only moves the active vehicle; the modal, persist and re-render are this
   app's business. */
function chooseVehicle(id) {
  closeModal();
  if (!session.garage().vehicles.some(v => v.id === id)) return;  // unknown id must not blank the app
  switchVehicle(id); save();
  applyAccent(); renderTopbar(); go('dashboard');
}
function addVehicle() { openAddVehicle(); }
function openAddVehicle() {
  openModal('Add a Mazda', 'Pick the model and engine — its SkyActiv service plan is set up for you.', card => {
    card.appendChild(field('Model', html`<select id="av_model">${CAR_MODELS.map((m, i) => html`<option value="${i}">Mazda ${m.model} · ${m.gen}</option>`)}</select>`));
    const engField = field('Engine', html`<select id="av_eng"></select>`);
    card.appendChild(engField);
    const r = el('div', 'field-row');
    r.append(field('Current odometer (km)', html`<input id="av_odo" type="number" inputmode="numeric" value="0">`),
      field('Year', html`<input id="av_year" type="number" inputmode="numeric" placeholder="${t('e.g. 2019')}">`));
    card.appendChild(r);
    const modelSel = card.querySelector('#av_model'), engSel = card.querySelector('#av_eng');
    const fillEngines = () => { engSel.innerHTML = html`${CAR_MODELS[+modelSel.value].engines.map((e, i) => html`<option value="${i}">${e[0]}</option>`)}`; };
    modelSel.value = '1'; fillEngines();          // default to Mazda 3 BM
    modelSel.onchange = fillEngines;
    const b = el('button', 'btn primary block', html`${t('Add a vehicle')}`);
    onAsyncClick(b, async () => {
      const m = CAR_MODELS[+modelSel.value];
      const data = normalizeData(buildProfile(m.id, +engSel.value, { odometer: +$('#av_odo').value || 0, year: +$('#av_year').value || '' }));
      const v = { id: uid(), data };
      session.setVehicles(session.garage().vehicles.concat([v]), v.id);
      const res = await saveVehicle(v.id, v.data, session.garage().activeId, uid);
      const ok = res.ok;
      /* A direct saveVehicle() bypasses session.save(), and session.save() is
         the only thing that fires the afterSave hook account.js pushes from.
         Without an explicit enqueue the new vehicle never reaches the server, so
         the next boot's pull() hands back a garage that does not contain it and
         adopt() classifies it as stale — deleting it, and its photos, with no
         prompt. enqueueVehicle() no-ops when signed out and never rejects. */
      if (ok) { applyPhotoIds(v.data, res.data); account.enqueueVehicle(v.id, res.data); kickSync(); }
      applyAccent(); renderTopbar(); closeModal(); go('dashboard');
      if (ok) toast(t('Vehicle added'));
      else toast(isQuotaError(res.error)
        ? t('Storage is full — your change was NOT saved. Remove some receipt photos.')
        : t('Could not save your change.'), 'warn');
    });
    card.appendChild(b);
  });
}
async function deleteVehicle(id) {
  if (session.garage().vehicles.length <= 1) { toast('Keep at least one vehicle', 'warn'); return; }
  // Captured BEFORE setVehicles/removeVehicle below — both drop this vehicle
  // from every local structure that could still answer "which photos did it
  // have", and enqueueTombstone needs that list to queue their remote
  // deletion. Reading it after either call would always see an empty list.
  const doomed = session.garage().vehicles.find(v => v.id === id);
  const photoIds = doomed ? photoIdsIn(doomed.data) : [];
  const kept = session.garage().vehicles.filter(v => v.id !== id);
  // setVehicles falls back to kept[0] when the removed vehicle was the active one.
  session.setVehicles(kept, session.garage().activeId === id ? kept[0].id : session.garage().activeId);
  const ok = await removeVehicle(id, session.garage().activeId); session.prunePhotoBlobs(); applyAccent(); renderTopbar(); go('dashboard');
  // Best-effort, not awaited: the local delete already succeeded and the UI has
  // moved on. enqueueTombstone() is itself async (it reads the outbox before
  // writing the tombstone), so kickSync() is sequenced with .then() rather
  // than fired immediately after — otherwise its drain() could snapshot the
  // outbox before the tombstone was actually written to it. enqueueTombstone()
  // never rejects on its own no-op paths, so no .catch() is needed here.
  // reconnect/next-boot remains the fallback if this device is offline now.
  account.enqueueTombstone(id, photoIds).then(kickSync);
  if (ok) toast('Vehicle removed');
  else toast(t('Could not save your change.'), 'warn');
}
function vehicleName(c) { return c.nickname || [c.year, c.make, c.model].filter(Boolean).join(' ') || 'Vehicle'; }

/* Best-effort, un-awaited drain kick after every enqueue point. The `online`
   event only fires on a transition into the online state, so a tab that
   stays connected the whole session would otherwise never push a save until
   the next reload — this is what restores Phase 4a's push-on-save behavior
   for the outbox. Guarded on navigator.onLine so an offline device does not
   burn a doomed network round-trip on every save; `!== false` degrades
   gracefully where navigator.onLine is undefined (e.g. in tests). Never
   awaited: the local save/delete/import UI flow must not block on network,
   and drain() already swallows its own failures (no retry counter to
   corrupt), so there is nothing here to catch. */
function kickSync() {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) account.drain();
}

/* A backup the user controls, before any server exists. Photos are inlined
   as base64 so a single file is the whole garage. */
async function exportGarage() {
  const photos = {};
  await Promise.all(Object.keys(session.photos()).map(async id => { photos[id] = await blobToDataUrl(session.photos()[id]); }));
  const payload = buildExport(session.garage(), photos, new Date().toISOString());
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `garage-backup-${isoDate(today())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(t('Backup downloaded'));
}

/* Import **replaces** the garage. It must ask first — this is destructive. */
function importGarage(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    const parsed = parseImport(reader.result);
    if (!parsed.ok) {
      // The toast has room for one line; the specifics go where they can be read.
      if (parsed.faults) console.warn('Backup rejected:', parsed.faults.join('; '));
      return toast(t(parsed.error), 'warn');
    }
    if (!confirm(t('Importing replaces everything currently in your garage. Continue?'))) return;
    // The garage and the photo cache must change together: normalize every
    // vehicle first (still touching only `parsed`, not session state), THEN
    // swap the photo cache, THEN call session.setVehicles(). A throw during
    // normalizing now lands before anything session-owned has been touched,
    // so the OLD garage is never left paired with the IMPORTED photo cache.
    // parseImport validates the shape; this catches everything else.
    try {
      // Kept as full records, not just ids: the loop below that tombstones
      // dropped vehicles needs each one's photoIds, and by then setVehicles()
      // has already replaced session.garage() with the imported data.
      const priorVehicles = session.garage().vehicles;
      const priorIds = priorVehicles.map(v => v.id);
      // The backup's .photo fields are stale blob: URLs from the exporting session.
      // Restore real data: URLs from the backup's own photos dict, or splitPhotos
      // will treat them as already-stored and persist nothing.
      parsed.garage.vehicles.forEach(v => {
        // A backup from the localStorage backend carries its images inline; one from
        // IndexedDB carries them in `photos` with stale blob: URLs in the records.
        // Merge both so neither origin loses data. collectInlinePhotos ignores blob: URLs.
        const merged = Object.assign(collectInlinePhotos(v.data), parsed.photos);
        v.data = inlinePhotos(v.data, merged);
        normalizeData(v.data);
      });
      // Normalizing succeeded for every vehicle — now swap the photo cache and
      // the garage together. session.photos() hands back the live cache; empty
      // it, then refill from the backup so the imported Blobs are what the
      // session holds.
      const cache = session.photos();
      Object.keys(cache).forEach(id => { delete cache[id]; });
      Object.keys(parsed.photos).forEach(id => {
        const blob = dataUrlToBlob(parsed.photos[id]);
        if (blob) cache[id] = blob;
      });
      // setVehicles picks the backup's activeId, or vehicles[0] if it is missing.
      session.setVehicles(parsed.garage.vehicles, parsed.garage.activeId);
      let ok = true;
      for (const v of session.garage().vehicles) {
        const res = await saveVehicle(v.id, v.data, session.garage().activeId, uid);
        if (!res.ok) ok = false;
        // Same reason as openAddVehicle: a direct saveVehicle() never reaches
        // session.save()'s afterSave hook, so an imported vehicle would be
        // deleted as stale by the next boot's adopt().
        else { account.enqueueVehicle(v.id, res.data); kickSync(); }
      }
      // The user confirmed a replace, not a merge — drop vehicles the backup does not contain.
      const keptIds = session.garage().vehicles.map(v => v.id);
      for (const id of priorIds) {
        if (keptIds.indexOf(id) < 0) {
          const doomed = priorVehicles.find(v => v.id === id);
          const photoIds = doomed ? photoIdsIn(doomed.data) : [];
          await removeVehicle(id, session.garage().activeId);
          account.enqueueTombstone(id, photoIds).then(kickSync);
        }
      }
      // The save loop minted fresh photo ids, so re-read from storage to bring
      // memory back in sync with what was actually persisted. session.load()
      // is exactly that read plus the hydrate the boot path uses.
      await session.load();
      closeModal();
      applyAccent(); renderTopbar(); go('dashboard');
      toast(ok ? t('Garage restored') : t('Restored, but some data could not be saved'), ok ? undefined : 'warn');
    } catch (err) {
      console.error(err);
      toast(t('That backup could not be restored. Please reload the page.'), 'warn');
    }
  };
  reader.onerror = () => toast(t('Could not read that file.'), 'warn');
  reader.readAsText(file);
}

/* ---------- service status computation ---------- */
/* svKm, svMo, serviceStatus, servicesRanked, healthScore now live in
   src/data/status.js (pure — no session, no DOM). The adapters near the
   top of this file thread the session through so call sites here are
   unchanged. */
/* What is dragging the score down — a bare number is not actionable. */
function openHealthBreakdown() {
  const bad = servicesRanked().filter(r => r.st.level !== 'ok');
  openModal('Health score', html`${healthScore()} / 100 — ${t('what is affecting it')}`, card => {
    if (!bad.length) { card.appendChild(emptyState('✅', 'Everything is on track.')); return; }
    const list = el('div', 'list');
    bad.forEach(({ s, st }) => list.appendChild(serviceItem(s, st)));
    card.appendChild(list);
  });
}
function yearSpend(year) {
  return session.current().spending.filter(e => e.date.startsWith(String(year))).reduce((a, e) => a + Number(e.amount), 0);
}

/* ============================================================
   ROUTER
   ============================================================ */
const routes = { dashboard: renderDashboard, maintenance: renderMaintenance, parts: renderParts, fuel: renderFuel, budget: renderBudget, reports: renderReports };
let current = 'dashboard';
let navIntent = null; // cross-page link target, consumed by the destination page's render
function go(route, intent) {
  if (!session.booted()) return;      // boot failed — leave the error card in place
  revokeObjectUrls();
  refreshPhotoUrls();
  renderTopbar();     // the badge lives outside #view; its URL was just revoked
  current = route;
  navIntent = intent || null;
  const view = $('#view');
  view.className = 'view ' + route;
  view.innerHTML = '';
  view.appendChild(routes[route]());
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.route === route));
  $('#view').scrollTop = 0;
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.route)));

/* ---------- cross-page links: which parts each service consumes ---------- */
const SERVICE_PARTS = {
  'Engine Oil & Filter': ['Engine Oil 5W-30 (4L)', 'Oil Filter', 'Fuel System Cleaner (additive)'],
  'Engine Air Filter': ['Engine Air Filter'],
  'Cabin (A/C) Filter': ['Cabin A/C Filter'],
  'Spark Plugs (x4)': ['Spark Plugs (each)'],
  'Brake Fluid': ['Brake Fluid (DOT 4)'],
  'Engine Coolant (FL22)': ['Coolant FL22 (long-life)'],
  'Automatic Transmission Fluid': ['ATF FZ (per liter)', 'Transmission Fluid Filter', 'Transmission Pan Sealant'],
  'Drive (Serpentine) Belt': ['Serpentine Belt'],
  'Battery Check': ['12V Battery'],
  'Brake Inspection & Caliper Lube': ['Front Brake Pads', 'Rear Brake Pads']
};
// Math.min() of nothing is Infinity, which renders as a price — 0 reads as "unpriced".
const partCheapest = p => (p.options && p.options.length) ? Math.min(...p.options.map(o => o.price)) : 0;
function partsForService(s) { return (SERVICE_PARTS[s.name] || []).map(n => session.current().parts.find(p => p.name === n)).filter(Boolean); }
function servicesForPart(p) { return session.current().services.filter(s => (SERVICE_PARTS[s.name] || []).includes(p.name)); }

/* How mandatory a part is for the car's health — drives the "do it next time"
   warning when a part is skipped (marked None). high = safety/engine-critical. */
const CRIT_HIGH = new Set(['Engine Oil 5W-30 (4L)', 'Oil Filter', 'Fuel System Cleaner (additive)', 'Front Brake Pads', 'Rear Brake Pads', 'Brake Fluid (DOT 4)', 'Front Brake Disc (each)', 'Rear Brake Disc (each)', 'Coolant FL22 (long-life)', 'ATF FZ (per liter)', 'Transmission Fluid Filter', 'Spark Plugs (each)', 'Timing Chain Kit', 'Water Pump', 'Serpentine Belt']);
const CRIT_LOW = new Set(['Cabin A/C Filter', 'Wiper Blades (pair)', 'Windshield Washer Fluid (~2L)', 'Headlight Bulbs (H11 low · 9005 high)', 'Tail / Brake Light Bulbs', 'Transmission Pan Sealant']);
function partCrit(name) { return CRIT_HIGH.has(name) ? 'high' : CRIT_LOW.has(name) ? 'low' : 'med'; }
const critLevel = name => partCrit(name) === 'high' ? 'danger' : partCrit(name) === 'med' ? 'warn' : 'ok';
const critLabel = name => partCrit(name) === 'high' ? t('mandatory') : partCrit(name) === 'low' ? t('optional') : t('recommended');

/* renderDashboard, recommendations, recCard now live in
   src/pages/dashboard.js. */

/* ============================================================
   PAGE 2 — MAINTENANCE
   ============================================================ */
/* ---------- forward service plan (upcoming milestones, adapted to the car) ----------
   Built from THIS vehicle's own services and their ACTUAL last-done point, so it
   fits any car, projects forward from the current odometer, and self-adjusts when
   a service was done off its recommended interval. Each service's future due points
   (lastKm + n·interval) are computed at their true due distance, then merged into
   workshop visits whenever two due points fall within MILESTONE_TOLERANCE_KM of each
   other (see mergeMilestones in schedule.js) — never onto a fixed distance grid, and
   never merging a service into a milestone it is already part of. Every milestone
   carries a projected calendar date from the car's average driving. */
const MILESTONE_TOLERANCE_KM = 1000; // services this close share one workshop visit
function planForward() {
  const odo = session.current().car.odometer || 0;
  const dpk = session.current().car.dailyKm || 40;
  const horizon = odo + 300000; // far enough that recurring services (ATF 60–80k, etc.) repeat for years
  const occurrences = [];
  session.current().services.filter(s => svKm(s) > 0).forEach(s => {
    const ikm = svKm(s);
    let k = serviceStatus(s).dueKm;   // first upcoming due (lastKm + interval)
    if (k < odo) {                    // overdue → due now, then continue strictly after odo
      occurrences.push({ km: odo, service: s });
      k = nextOverdueOccurrence(k, odo, ikm);
    }
    for (; k <= horizon; k += ikm) occurrences.push({ km: k, service: s });
  });
  return mergeMilestones(occurrences, MILESTONE_TOLERANCE_KM).map(ms => ({
    km: ms.km,
    items: ms.items,
    major: ms.items.some(s => svKm(s) >= 60000),
    date: new Date(today().getTime() + Math.max(0, (ms.km - odo) / dpk) * 86400000)
  }));
}

let maintMode = 'Schedule'; // remembered across renders in the session
function renderMaintenance() {
  if (navIntent && navIntent.filter) maintMode = 'Schedule'; // a cross-page link targets the schedule
  const v = el('div');
  v.appendChild(pageIntro('Maintenance', 'Your service schedule and full work history — tracked by distance and time.'));

  const modeSeg = el('div', 'seg');
  ['Schedule', 'Plan', 'History'].forEach(m => {
    const b = el('button', m === maintMode ? 'on' : '', html`${t(m)}`);
    b.onclick = () => { if (maintMode === m) return; maintMode = m; [...modeSeg.children].forEach(c => c.classList.toggle('on', c === b)); paintMode(); };
    modeSeg.appendChild(b);
  });
  v.appendChild(modeSeg);

  // schedule basis (Jeddah severe vs. dealer normal) is chosen once in the
  // plan setup wizard, not toggled here — see openPlanSetup().
  const body = el('div');
  function paintMode() {
    body.innerHTML = '';
    (maintMode === 'History' ? buildHistory : maintMode === 'Plan' ? buildPlan : buildSchedule)(body);
  }
  v.appendChild(body);
  paintMode();
  return v;
}

function buildPlan(v) {
  const intro = el('p');
  intro.style.cssText = 'font-size:12.5px;line-height:1.55;color:var(--text-2);margin:2px 4px 14px';
  intro.textContent = t('What’s coming up, built from your own services and when each was last done. Tap a task to log it, or log a whole visit.');
  v.appendChild(intro);

  const all = planForward();
  // A rolling 24-month window — a calendar-year filter made this view empty
  // out every December. Always at least three milestones.
  const cutoff = new Date(today());
  cutoff.setMonth(cutoff.getMonth() + 24);
  const shown = withinHorizon(all, cutoff, 3);

  const wrap = el('div', 'plan-list');
  let lastYear = null;
  shown.forEach((ms, idx) => {
    const yr = ms.date.getFullYear();
    if (yr !== lastYear) { wrap.appendChild(el('div', 'plan-year', html`${String(yr)}`)); lastYear = yr; }
    const isNext = idx === 0;
    const card = el('div', 'card plan-ms' + (ms.major ? ' major' : '') + (isNext ? ' next' : ''));
    card.innerHTML = html`
      <div class="plan-ms-head">
        <div class="plan-km">${fmt(ms.km)}<span>km</span></div>
        <div class="plan-meta">
          ${isNext ? html`<span class="plan-badge next">${t('Next up')}</span>` : ''}
          ${ms.major ? html`<span class="plan-badge">${t('Major service')}</span>` : ''}
          <span class="plan-when">≈ ${ms.date.toLocaleDateString('en', { month: 'short', year: 'numeric' })}</span>
        </div>
      </div>
      <div class="plan-items">
        ${ms.items.map((s, i) => html`<button class="plan-chip" data-i="${i}"><i>${s.icon || '🔧'}</i>${t(s.name)}</button>`)}
      </div>
      <button class="plan-log">${iconSvg('check')}${t('Log this visit')}</button>`;
    card.querySelectorAll('.plan-chip').forEach(btn => btn.onclick = () => {
      const s = ms.items[+btn.dataset.i];
      openLogConfirm([s], { checklist: true, onDone: () => { go('maintenance'); } });
    });
    card.querySelector('.plan-log').onclick = () => openLogConfirm(ms.items, { checklist: true, onDone: () => { go('maintenance'); } });
    wrap.appendChild(card);
  });
  if (!shown.length) wrap.appendChild(emptyState('🗓️', 'Nothing scheduled — you’re all caught up!'));
  v.appendChild(wrap);

  const note = el('div', 'card');
  note.style.cssText = 'padding:13px 15px;margin-top:12px;font-size:12px;line-height:1.55;color:var(--text-2)';
  note.innerHTML = html`💡 ${t('This adapts to when you actually service the car — log a task off its usual interval and the plan re-times itself. Edit intervals under Schedule.')}`;
  v.appendChild(note);
}

// Log a whole visit as done NOW (at the current odometer) — resets those services' clocks.
function logVisit(ms) {
  const date = isoDate(today());
  const odo = session.current().car.odometer || 0;
  let total = 0;
  ms.items.forEach(s => {
    s.lastKm = odo;
    s.lastDate = date;
    session.current().history.push({ id: uid(), name: s.name, icon: s.icon || '🔧', date, odometer: odo, cost: s.cost || 0, cat: 'Maintenance', note: '' });
    total += Number(s.cost || 0);
  });
  if (total > 0) session.current().spending.push({ id: uid(), date, cat: 'Maintenance', desc: `${t('Service visit')} · ${fmt(odo)} km`, amount: total, odometer: odo });
  save(); // fire-and-forget: nothing downstream reads the result
}

/* Confirm-and-log a service or a whole plan visit, letting the user choose which
   catalogue part (OEM or Alternative) they actually used for each linked part.
   The picked option's price drives the cost; any labour baked into the service's
   estimate (est. cost − default parts) is preserved. */
function openLogConfirm(services, opts) {
  opts = opts || {};
  const checklist = opts.checklist || services.length > 1; // per-service Done / Not yet toggles
  const defIdx = p => { const i = p.options.findIndex(o => o.tag === 'OEM'); return i >= 0 ? i : 0; };
  const laborShare = svc => { const lp = partsForService(svc); if (!lp.length) return 0; const dflt = lp.reduce((a, p) => a + Number(p.options[defIdx(p)].price || 0), 0); return Math.max(0, Number(svc.cost || 0) - dflt); };
  const doneState = new Map(); services.forEach(s => doneState.set(s.id, true));
  openModal(opts.title || (services.length > 1 ? 'Log a plan visit' : services[0].name),
    opts.sub || 'Pick the parts you used (OEM or alternative), then log it.', card => {
      const r = el('div', 'field-row');
      r.append(field('Odometer (km)', html`<input id="lc_odo" type="number" value="${opts.odometer != null ? opts.odometer : session.current().car.odometer}">`),
        field('Date', html`<input id="lc_date" type="date" value="${isoDate(today())}">`));
      card.appendChild(r);

      const picks = new Map(); // `${part.id}:${svc.id}` -> <select>
      services.forEach(svc => {
        const lp = partsForService(svc);
        const container = el('div', 'card log-svc');           // each service in its own container
        const head = el('div', 'log-svc-head');
        head.innerHTML = html`<div class="log-svc-title">${svc.icon || '🔧'} ${t(svc.name)}</div>`;
        const body = el('div', 'log-svc-body');
        const note = el('div', 'log-svc-note');
        note.textContent = '↪ ' + t('Carried to your next visit');
        note.style.display = 'none';

        if (svc.pendingParts && svc.pendingParts.length) {  // parts marked None last time
          const worst = svc.pendingParts.some(n => partCrit(n) === 'high') ? 'danger' : svc.pendingParts.some(n => partCrit(n) === 'med') ? 'warn' : 'ok';
          const pw = el('div', 'log-pending ' + worst);
          pw.innerHTML = html`⚠️ ${t('Skipped last time — do it now')}: ${raw(svc.pendingParts.map(n => html`${t(n)} <span class="crit">(${critLabel(n)})</span>`).join('، '))}`;
          body.appendChild(pw);
        }
        if (!lp.length) {
          const d = el('div', 'muted'); d.style.cssText = 'font-size:12px;margin:8px 2px 0';
          d.textContent = `${t('No linked parts')} · ${sar(svc.cost || 0)} SAR`;
          body.appendChild(d);
        }
        lp.forEach(p => {
          const optsHtml = [html`<option value="none">— ${t('None — not done')} —</option>`,
            ...p.options.map((o, i) => html`<option value="${i}">${o.tag} · ${o.brand} · ${sar(o.price)} SAR</option>`)];
          const f = field(t(p.name), html`<select>${optsHtml}</select>`);
          const sel = f.querySelector('select');
          sel.value = String(defIdx(p));
          sel.onchange = recalc;
          picks.set(p.id + ':' + svc.id, { svc, part: p, sel });
          body.appendChild(f);
        });

        if (checklist) {
          const toggle = el('div', 'seg log-toggle');
          [['done', 'Done'], ['skip', 'Not yet']].forEach(([code, label]) => {
            const btn = el('button', code === 'done' ? 'on' : '', html`${t(label)}`);
            btn.onclick = () => {
              const isDone = code === 'done';
              doneState.set(svc.id, isDone);
              [...toggle.children].forEach(c => c.classList.toggle('on', c === btn));
              body.style.display = isDone ? '' : 'none';
              note.style.display = isDone ? 'none' : '';
              recalc();
            };
            toggle.appendChild(btn);
          });
          head.appendChild(toggle);
        }
        container.append(head, body, note);
        card.appendChild(container);
      });

      const totalEl = el('div');
      totalEl.style.cssText = 'font-weight:750;font-size:14px;margin:12px 2px 2px';
      function svcCost(svc) {
        const lp = partsForService(svc);
        if (!lp.length) return Number(svc.cost || 0);
        let sum = 0; lp.forEach(p => { const v = picks.get(p.id + ':' + svc.id).sel.value; sum += v === 'none' ? 0 : Number(p.options[+v].price || 0); });
        return sum + laborShare(svc);
      }
      function recalc() { totalEl.textContent = `${t('Total')}: ${sar(services.filter(s => doneState.get(s.id) !== false).reduce((a, svc) => a + svcCost(svc), 0))} SAR`; }
      recalc();
      card.appendChild(totalEl);

      const b = el('button', 'btn primary block', html`${iconSvg('check')}${t('Log it')}`);
      onAsyncClick(b, async () => {
        const odo = +$('#lc_odo').value || session.current().car.odometer;
        const date = $('#lc_date').value || isoDate(today());
        let grand = 0, nDone = 0, nSkip = 0, nPartSkip = 0, lastName = 'Service';
        services.forEach(svc => {
          if (doneState.get(svc.id) === false) { svc.deferred = true; svc.deferredAt = date; nSkip++; return; }
          svc.lastKm = odo; svc.lastDate = date; svc.deferred = false;
          const chosen = [], skippedParts = [];
          partsForService(svc).forEach(p => {
            const v = picks.get(p.id + ':' + svc.id).sel.value;
            if (v === 'none') { skippedParts.push(p.name); return; }
            const o = p.options[+v]; chosen.push({ part: p.name, tag: o.tag, brand: o.brand, price: o.price });
          });
          const pend = new Set(svc.pendingParts || []);
          skippedParts.forEach(n => pend.add(n)); chosen.forEach(c => pend.delete(c.part));
          svc.pendingParts = [...pend]; nPartSkip += skippedParts.length;
          const cost = svcCost(svc); grand += cost; nDone++; lastName = svc.name;
          session.current().history.push({ id: uid(), name: svc.name, icon: svc.icon || '🔧', date, odometer: odo, cost, cat: 'Maintenance', note: '', parts: chosen });
        });
        if (grand > 0) session.current().spending.push({ id: uid(), date, cat: 'Maintenance', desc: nDone > 1 ? `${t('Service visit')} · ${fmt(odo)} km` : lastName, amount: grand, odometer: odo });
        if (odo > (session.current().car.odometer || 0)) session.current().car.odometer = odo;
        const ok = await save(); closeModal();
        (opts.onDone || (() => go('maintenance')))();
        if (ok) {
          if (nSkip) toast(`${nDone} ${t('logged')} · ${nSkip} ${t('carried forward')}`);
          else if (!opts.onDone) toast(t(nDone > 1 ? 'Visit logged ✓' : 'Service logged ✓'));
          if (nPartSkip) toast(`⚠️ ${nPartSkip} ${t('part(s) to redo next service')}`, 'warn');
        }
      });
      card.appendChild(b);
    });
}

/* Step-by-step wizard: one question at a time — schedule basis, odometer,
   then every service (majors first) — instead of one long form. Each
   service asks "have you done this, and at what km" so the plan can be
   built from real answers rather than the seed defaults. The dealer vs.
   Jeddah-severe schedule basis is decided here only; it's not shown as a
   toggle on the Maintenance page anymore. Major/regular grouping uses the
   base (severe) interval so it doesn't shift depending on the basis answer. */
function openPlanSetup() {
  const eligible = session.current().services.filter(s => s.intervalKm > 0);
  const majors = eligible.filter(s => s.intervalKm >= 40000).sort((a, b) => a.intervalKm - b.intervalKm);
  const regulars = eligible.filter(s => s.intervalKm < 40000).sort((a, b) => a.intervalKm - b.intervalKm);
  const services = [...majors, ...regulars];
  const answers = services.map(s => ({ s, choice: s.lastKm > 0 ? 'yes' : null, km: s.lastKm || '' }));
  let basis = session.current().severity === 'normal' ? 'normal' : 'severe';
  let odo = session.current().car.odometer || '';
  let driveUnit = 'day';
  let dailyKm = session.current().car.dailyKm || 40;
  let step = 0;
  const totalSteps = 3 + services.length; // basis + odometer + driving style + one per service

  openModal('Set up your plan', null, card => {
    const progress = el('div', 'wiz-progress');
    const bar = el('div', 'wiz-bar', '<span></span>');
    const body = el('div', 'wiz-card');
    const nav = el('div', 'wiz-nav');
    const backBtn = el('button', 'btn ghost', html`${t('Back')}`);
    const nextBtn = el('button', 'btn primary', html`${t('Next')}`);
    nav.appendChild(backBtn); nav.appendChild(nextBtn);
    const skipAll = el('button', 'btn block ghost wiz-skip', html`${t('Skip for now')}`);
    card.appendChild(progress); card.appendChild(bar); card.appendChild(body); card.appendChild(nav); card.appendChild(skipAll);

    function renderStep() {
      progress.textContent = `${t('Step')} ${step + 1} ${t('of')} ${totalSteps}`;
      bar.firstElementChild.style.width = `${(step / (totalSteps - 1)) * 100}%`;
      backBtn.style.visibility = step === 0 ? 'hidden' : '';
      nextBtn.textContent = step === totalSteps - 1 ? t('Finish') : t('Next');
      body.innerHTML = '';

      if (step === 0) {
        body.innerHTML = html`
          <div class="item-ic">📍</div>
          <h3>${t('Which schedule fits your car?')}</h3>
          <p>${t('Jeddah heat & dust call for shorter intervals; the dealer sheet is the standard Mazda schedule.')}</p>
          <div class="wiz-choice">
            <button class="wiz-opt ${basis === 'severe' ? 'on' : ''}" data-v="severe">${t('Jeddah (severe)')}</button>
            <button class="wiz-opt ${basis === 'normal' ? 'on' : ''}" data-v="normal">${t('Dealer (normal)')}</button>
          </div>`;
        body.querySelectorAll('.wiz-opt').forEach(btn => btn.onclick = () => {
          basis = btn.dataset.v;
          body.querySelectorAll('.wiz-opt').forEach(b => b.classList.toggle('on', b === btn));
        });
      } else if (step === 1) {
        body.innerHTML = html`
          <div class="item-ic">🧭</div>
          <h3>${t('Current odometer')}</h3>
          <p>${t('Keeps every due date and estimate accurate.')}</p>
          <div class="wiz-km"><input id="wiz_odo" type="number" inputmode="numeric" placeholder="${t('e.g. 316,000')}" value="${odo}"></div>`;
        const odoInput = $('#wiz_odo', body);
        odoInput.oninput = () => { odo = odoInput.value; odoInput.classList.remove('err'); };
        setTimeout(() => odoInput.focus(), 30);
      } else if (step === 2) {
        const displayVal = driveUnit === 'day' ? Math.round(dailyKm) : Math.round(dailyKm * 30);
        body.innerHTML = html`
          <div class="item-ic">🛣️</div>
          <h3>${t('How much do you drive?')}</h3>
          <p>${t('Used to turn km into calendar dates, and to adjust the plan to your driving style — a rough average is fine.')}</p>
          <div class="wiz-choice">
            <button class="wiz-opt ${driveUnit === 'day' ? 'on' : ''}" data-v="day">${t('Per day')}</button>
            <button class="wiz-opt ${driveUnit === 'month' ? 'on' : ''}" data-v="month">${t('Per month')}</button>
          </div>
          <div class="wiz-km">
            <label>${t('Average km')}</label>
            <input id="wiz_drive" type="number" inputmode="numeric" placeholder="${t('e.g. 40')}" value="${displayVal}">
          </div>`;
        const driveInput = $('#wiz_drive', body);
        driveInput.oninput = () => {
          driveInput.classList.remove('err');
          const val = parseFloat(driveInput.value);
          if (!isNaN(val) && val > 0) dailyKm = driveUnit === 'day' ? val : val / 30;
        };
        body.querySelectorAll('.wiz-opt').forEach(btn => btn.onclick = () => { driveUnit = btn.dataset.v; renderStep(); });
        setTimeout(() => driveInput.focus(), 30);
      } else {
        const a = answers[step - 3];
        const s = a.s;
        body.innerHTML = html`
          <div class="item-ic">${s.icon || '🔧'}</div>
          <h3>${t(s.name)}</h3>
          <p>${t('Have you had this done?')}</p>
          <div class="wiz-choice">
            <button class="wiz-opt ${a.choice === 'yes' ? 'on' : ''}" data-v="yes">${t('Yes, done')}</button>
            <button class="wiz-opt ${a.choice === 'skip' ? 'on' : ''}" data-v="skip">${t('Not sure / skip')}</button>
          </div>
          <div class="wiz-km"${a.choice === 'yes' ? '' : ' hidden'}>
            <label>${t('At what km (roughly)?')}</label>
            <input type="number" inputmode="numeric" placeholder="${t('km')}" value="${a.km}">
          </div>`;
        const kmWrap = body.querySelector('.wiz-km');
        const kmInput = kmWrap.querySelector('input');
        kmInput.oninput = () => { a.km = kmInput.value; kmInput.classList.remove('err'); };
        body.querySelectorAll('.wiz-opt').forEach(btn => btn.onclick = () => {
          a.choice = btn.dataset.v;
          body.querySelectorAll('.wiz-opt').forEach(b => b.classList.toggle('on', b === btn));
          kmWrap.hidden = a.choice !== 'yes';
          if (a.choice === 'yes') kmInput.focus();
        });
      }
    }

    function applyGeneralSettings() {
      session.current().severity = basis;
      const finalOdo = parseInt(odo, 10);
      if (!isNaN(finalOdo) && finalOdo > 0) session.current().car.odometer = finalOdo;
      if (dailyKm > 0) session.current().car.dailyKm = dailyKm;
    }

    async function finish() {
      applyGeneralSettings();
      const dpk = session.current().car.dailyKm || 40;
      answers.forEach(a => {
        if (a.choice !== 'yes') return;
        const val = parseInt(a.km, 10);
        if (isNaN(val) || val <= 0) return;
        a.s.lastKm = val;
        const days = Math.max(0, ((session.current().car.odometer || val) - val) / dpk);
        a.s.lastDate = isoDate(new Date(today().getTime() - days * 86400000));
      });
      session.current().planSetupDone = true;
      const ok = await save(); closeModal(); go('maintenance'); if (ok) toast(t('Plan updated'));
    }

    backBtn.onclick = () => { if (step > 0) { step--; renderStep(); } };
    onAsyncClick(nextBtn, async () => {
      if (step === 1) {
        const od = parseInt(odo, 10);
        if (isNaN(od) || od <= 0) { $('#wiz_odo', body).classList.add('err'); toast(t('Enter your current odometer'), 'warn'); return; }
      } else if (step === 2) {
        const val = parseFloat($('#wiz_drive', body).value);
        if (isNaN(val) || val <= 0) { $('#wiz_drive', body).classList.add('err'); toast(t('Enter your average driving distance'), 'warn'); return; }
      } else if (step >= 3) {
        const a = answers[step - 3];
        if (a.choice === 'yes') {
          const val = parseInt(a.km, 10);
          if (isNaN(val) || val <= 0) { body.querySelector('.wiz-km input').classList.add('err'); toast(t('Enter a km for this service'), 'warn'); return; }
        }
      }
      if (step === totalSteps - 1) { await finish(); return; }
      step++; renderStep();
    });
    skipAll.onclick = () => {
      applyGeneralSettings(); session.current().planSetupDone = true;
      save(); // fire-and-forget: nothing downstream reads the result
      closeModal(); go('maintenance');
    };

    renderStep();
  });
}

function buildSchedule(v) {
  const seg = el('div', 'seg');
  const filters = ['Due soon', 'Overdue', 'OK', 'All'];
  let active = (navIntent && filters.includes(navIntent.filter)) ? navIntent.filter : 'All';
  navIntent = null; // consumed
  filters.forEach(f => {
    const b = el('button', f === active ? 'on' : '', html`${t(f)}`);
    b.onclick = () => { active = f; [...seg.children].forEach(c => c.classList.toggle('on', c === b)); paint(); };
    seg.appendChild(b);
  });
  v.appendChild(seg);

  const tl = el('div', 'timeline');
  v.appendChild(tl);

  function paint() {
    tl.innerHTML = '';
    let items = servicesRanked();
    if (active === 'Overdue') items = items.filter(r => r.st.level === 'danger');
    else if (active === 'Due soon') items = items.filter(r => r.st.level === 'warn');
    else if (active === 'OK') items = items.filter(r => r.st.level === 'ok');
    if (!items.length) { tl.appendChild(emptyState('🎉', 'Nothing here — all good!')); return; }

    // chronological — soonest due first, which naturally leads with overdue items (their due date already passed)
    items = items.slice().sort((a, b) => a.st.dueDate - b.st.dueDate);
    let lastYear = null;
    items.forEach(({ s, st }, i) => {
      const yr = st.dueDate.getFullYear();
      if (yr !== lastYear) { tl.appendChild(el('div', 'tl-year', html`${String(yr)}`)); lastYear = yr; }
      tl.appendChild(scheduleTimelineItem(s, st, i === items.length - 1));
    });
  }
  paint();

  const add = el('button', 'btn block ghost', html`${iconSvg('plus')}${t('Add a custom service')}`);
  add.style.marginTop = '16px';
  add.onclick = () => openEditService(null);
  v.appendChild(add);
}

function scheduleTimelineItem(s, st, isLast) {
  const item = el('div', 'tl-item' + (isLast ? ' last' : ''));
  const pillTxt = t(st.level === 'danger' ? 'Overdue' : st.level === 'warn' ? 'Due soon' : 'On track');
  const kmTxt = st.kmLeft <= 0 ? `${fmt(-st.kmLeft)} ${t('km over')}` : `${fmt(st.kmLeft)} ${t('km left')}`;
  item.innerHTML = html`
    <div class="tl-dot ${st.level}">${s.icon || '🔧'}</div>
    <div class="card tl-card">
      <div class="tl-top"><h3>${t(s.name)}</h3><span class="pill ${st.level}">${pillTxt}</span></div>
      <div class="tl-sub">${st.dueDate.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })} · ${kmTxt}</div>
    </div>`;
  item.querySelector('.tl-card').onclick = () => openServiceDetail(s);
  return item;
}

function buildHistory(v) {
  const hist = [...session.current().history].sort((a, b) => b.date.localeCompare(a.date) || b.odometer - a.odometer);
  const totalCost = hist.reduce((a, e) => a + Number(e.cost || 0), 0);
  const last = hist[0];

  const tiles = el('div', 'tiles');
  tiles.innerHTML = html`
    <div class="tile"><div class="t-num">${hist.length}</div><div class="t-cap">${t('Services logged')}</div></div>
    <div class="tile"><div class="t-num">${sar(totalCost)}</div><div class="t-cap">${t('SAR total')}</div></div>
    <div class="tile"><div class="t-num" style="font-size:15px;line-height:1.9">${last ? new Date(last.date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short' }) : '—'}</div><div class="t-cap">${t('Last service')}</div></div>`;
  v.appendChild(tiles);

  const add = el('button', 'btn block primary', html`${iconSvg('plus')}${t('Log a past service')}`);
  add.style.margin = '14px 0 6px';
  add.onclick = () => openAddHistory(null);
  v.appendChild(add);

  if (!hist.length) { v.appendChild(emptyState('🧰', 'No service history yet.\nLog your first one above.')); return; }

  const tl = el('div', 'timeline');
  let lastYear = null;
  hist.forEach((e, i) => {
    const yr = e.date.slice(0, 4);
    if (yr !== lastYear) { tl.appendChild(el('div', 'tl-year', html`${yr}`)); lastYear = yr; }
    const item = el('div', 'tl-item' + (i === hist.length - 1 ? ' last' : ''));
    const d = new Date(e.date + 'T00:00:00');
    item.innerHTML = html`
      <div class="tl-dot">${e.icon || '🔧'}</div>
      <div class="card tl-card">
        <div class="tl-top"><h3>${t(e.name)}${e.photo ? ' 🧾' : ''}</h3><div class="tl-cost">${e.cost > 0 ? sar(e.cost) + ' SAR' : '—'}</div></div>
        <div class="tl-sub">${d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })} · ${fmt(e.odometer)} km</div>
        ${e.note ? html`<div class="tl-note">${e.note}</div>` : ''}
      </div>`;
    item.querySelector('.tl-card').onclick = () => openAddHistory(e);
    tl.appendChild(item);
  });
  v.appendChild(tl);
}

function serviceItem(s, st, withBar) {
  const item = el('div', 'item');
  const pillTxt = t(st.level === 'danger' ? 'Overdue' : st.level === 'warn' ? 'Due soon' : 'On track');
  const kmTxt = st.kmLeft <= 0 ? `${fmt(-st.kmLeft)} ${t('km over')}` : `${fmt(st.kmLeft)} ${t('km left')}`;
  item.innerHTML = html`
    <div class="item-ic">${s.icon || '🔧'}</div>
    <div class="item-main">
      <h3>${s.deferred ? '⏰ ' : ''}${t(s.name)}</h3>
      <p>${s.deferred ? t('Skipped — do it') + ' · ' : ''}${st.drivenByTime ? relDate(st.dueDate) + ' · ' : ''}${kmTxt}</p>
      ${withBar ? html`<div class="bar ${st.level}"><span style="width:${clamp(st.prog, 0, 1) * 100}%"></span></div>` : ''}
    </div>
    <div class="item-side"><span class="pill ${st.level}">${pillTxt}</span></div>`;
  item.onclick = () => openServiceDetail(s);
  return item;
}

/* ============================================================
   PAGE 3 — PARTS
   ============================================================ */
function renderParts() {
  const v = el('div');
  v.appendChild(pageIntro('Car Parts', 'OEM parts with cheaper alternatives, prices and where to buy. Tap a part to compare.'));

  const cats = ['All', ...new Set(session.current().parts.map(p => p.cat))];
  let active = 'All';
  const seg = el('div', 'seg');
  seg.style.flexWrap = 'wrap';
  cats.forEach(c => {
    const b = el('button', c === active ? 'on' : '', html`${t(c)}`);
    b.onclick = () => { active = c; [...seg.children].forEach(x => x.classList.toggle('on', x === b)); paint(); };
    seg.appendChild(b);
  });
  v.appendChild(seg);

  const list = el('div', 'list');
  v.appendChild(list);
  function paint() {
    list.innerHTML = '';
    const items = session.current().parts.filter(p => active === 'All' || p.cat === active);
    items.forEach(p => list.appendChild(partCard(p)));
  }
  paint();

  // arriving via a "View part" link from Maintenance — open & scroll to it
  if (navIntent && navIntent.openPart) {
    const targetId = navIntent.openPart; navIntent = null;
    setTimeout(() => {
      const cardEl = list.querySelector(`[data-id="${targetId}"]`);
      if (cardEl) { cardEl.classList.add('open'); cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }, 60);
  }

  const add = el('button', 'btn block ghost', html`${iconSvg('plus')}${t('Add a part')}`);
  add.style.marginTop = '16px';
  add.onclick = () => openEditPart(null);
  v.appendChild(add);
  return v;
}

function partCard(p) {
  const cheapest = partCheapest(p);
  const usedIn = servicesForPart(p);
  const card = el('div', 'card part');
  card.dataset.id = p.id;
  card.innerHTML = html`
    <div class="part-head">
      <div class="item-ic">${p.icon || '🔩'}</div>
      <h3>${t(p.name)}</h3>
      <div style="text-align:right">
        <div style="font-weight:750;font-size:14px">${t('from')} ${sar(cheapest)} <span class="muted" style="font-size:11px">SAR</span></div>
        <div class="muted" style="font-size:11px">${p.options.length} ${t('options')}</div>
      </div>
      <button class="part-toggle"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
    </div>
    <div class="part-body">
      ${p.options.map(o => html`
        <div class="opt">
          <span class="opt-tag ${o.tag === 'OEM' ? 'oem' : 'alt'}">${o.tag}</span>
          <div class="opt-main">
            <div class="b">${t(o.brand)}</div>
            <div class="s">${[o.partNo, t(o.note)].filter(Boolean).join(' · ') || raw('&nbsp;')}</div>
          </div>
          <div class="opt-price">
            <div class="p">${sar(o.price)} <span class="muted" style="font-size:10px">SAR</span></div>
            <div class="store">${t(o.store)}</div>
          </div>
        </div>`)}
      ${usedIn.length ? html`<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        <span class="muted" style="font-size:11px;font-weight:600">${t('🔧 Used in:')}</span>
        ${usedIn.map(s => html`<button class="chip-link" data-svc="${s.id}">${t(s.name)}</button>`)}
      </div>` : ''}
      ${p.partsouq ? html`<a class="btn" href="https://partsouq.com/en/search/all?q=${encodeURIComponent(p.partsouq)}" target="_blank" rel="noopener noreferrer" style="width:100%;margin-top:12px;font-size:12.5px;padding:11px;text-decoration:none;color:var(--accent-soft)">${raw(t('🔎 Live price &amp; alternatives on PartSouq ↗'))}</a>` : ''}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn ghost" style="flex:1;font-size:12.5px;padding:9px" data-edit>${t('Edit')}</button>
      </div>
    </div>`;
  const toggle = () => card.classList.toggle('open');
  card.querySelector('.part-head').onclick = e => { if (!e.target.closest('.part-toggle') && !e.target.closest('button')) toggle(); };
  card.querySelector('.part-toggle').onclick = toggle;
  card.querySelector('[data-edit]').onclick = e => { e.stopPropagation(); openEditPart(p); };
  card.querySelectorAll('[data-svc]').forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    const s = session.current().services.find(x => x.id === btn.dataset.svc);
    if (s) { go('maintenance'); setTimeout(() => openServiceDetail(s), 0); }
  });
  return card;
}

/* ============================================================
   PAGE 4 — BUDGET & SPENDING
   ============================================================ */
function renderBudget() {
  const v = el('div');
  v.appendChild(pageIntro('Budget & Spending', 'Track what your Mazda costs to run and keep it in top shape.'));

  const spent = yearSpend(today().getFullYear());
  const budget = session.current().budget.annual;
  const pct = clamp(budget ? spent / budget : 0, 0, 1.2);
  const dash = 2 * Math.PI * 40;
  const overBudget = spent > budget;

  const ring = el('div', 'card budget-ring-card');
  ring.innerHTML = html`
    <div class="ring" style="width:96px;height:96px">
      <svg viewBox="0 0 92 92" style="width:96px;height:96px">
        <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${overBudget ? '#ff4d5e' : '#d6203c'}"/>
          <stop offset="1" stop-color="${overBudget ? '#ff8a95' : '#ff5c6e'}"/>
        </linearGradient></defs>
        <circle class="track" cx="46" cy="46" r="40" fill="none" stroke-width="8"/>
        <circle class="prog" cx="46" cy="46" r="40" fill="none" stroke-width="8"
          stroke-dasharray="${dash}" stroke-dashoffset="${dash * (1 - clamp(pct, 0, 1))}"/>
      </svg>
      <div class="ring-label"><div class="ring-num" style="font-size:19px">${Math.round(pct * 100)}%</div><div class="ring-cap">${t('of budget')}</div></div>
    </div>
    <div style="flex:1">
      <div class="muted" style="font-size:12px">${t('Spent in 2026')}</div>
      <div style="font-size:26px;font-weight:800;letter-spacing:-.5px">${sar(spent)} <span class="muted" style="font-size:13px;font-weight:600">SAR</span></div>
      <div style="font-size:12.5px;margin-top:4px" class="${overBudget ? '' : 'muted'}">
        ${overBudget ? html`⚠️ ${sar(spent - budget)} ${t('over budget')}` : html`${sar(budget - spent)} ${t('SAR remaining of')} ${sar(budget)}`}
      </div>
      <button class="odo-edit" id="editBudget" style="margin-top:8px">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        ${t('Set annual budget')}
      </button>
    </div>`;
  v.appendChild(ring);

  // Upcoming maintenance cost — forecast pulled from the Maintenance schedule
  const upcoming = servicesRanked().filter(r => r.st.level !== 'ok');
  if (upcoming.length) {
    const dueCost = upcoming.reduce((a, r) => a + (r.s.cost || 0), 0);
    const odCount = upcoming.filter(r => r.st.level === 'danger').length;
    const fc = el('div', 'card');
    fc.style.cssText = 'padding:14px 16px;margin-top:12px;display:flex;align-items:center;gap:12px;cursor:pointer';
    fc.innerHTML = html`
      <div class="item-ic">🔧</div>
      <div style="flex:1">
        <h3 style="font-size:13.5px;font-weight:650">${t('Upcoming maintenance')}</h3>
        <p class="muted" style="font-size:12px;margin-top:2px">${upcoming.length} ${t('services due')}${odCount ? html` · ${odCount} ${t('overdue')}` : ''} — ${t('plan ~')}${sar(dueCost)} SAR</p>
      </div>
      <span style="color:var(--accent-soft);font-size:12.5px;font-weight:600">${t('View ›')}</span>`;
    fc.onclick = () => go('maintenance', { filter: odCount ? 'Overdue' : 'Due soon' });
    v.appendChild(fc);
  }

  // monthly bars (last 6 months)
  v.appendChild(sectionTitle('Monthly spending', '', null));
  const bars = el('div', 'card');
  bars.style.padding = '16px';
  bars.appendChild(monthlyBars());
  v.appendChild(bars);

  // breakdown by category
  const byCat = {};
  session.current().spending.filter(e => e.date.startsWith('2026')).forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + Number(e.amount); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (cats.length) {
    v.appendChild(sectionTitle('By category (2026)', '', null));
    // (category names translated below)
    const cc = el('div', 'card');
    cc.style.padding = '14px 16px';
    const total = cats.reduce((a, c) => a + c[1], 0) || 1;
    cc.innerHTML = html`${cats.map(([k, val]) => html`
      <div style="margin:10px 0 12px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
          <span>${t(k)}</span><span style="font-weight:700">${sar(val)} SAR</span>
        </div>
        <div class="bar"><span style="width:${(val / total) * 100}%"></span></div>
      </div>`)}`;
    v.appendChild(cc);
  }

  // spending log
  v.appendChild(sectionTitle('Recent spending', 'Add', () => openAddSpending()));
  const log = el('div', 'list');
  const sorted = [...session.current().spending].sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) log.appendChild(emptyState('🧾', 'No spending logged yet.'));
  sorted.slice(0, 12).forEach(e => log.appendChild(spendEntry(e)));
  v.appendChild(log);

  ring.querySelector('#editBudget').onclick = openEditBudget;
  return v;
}

/* ============================================================
   PAGE 5 — REPORTS (printable A4)
   ============================================================ */
let reportType = 'service'; // remembered across renders in the session
function renderReports() {
  const v = el('div', 'rpt-view');
  v.appendChild(pageIntro('Reports', 'Generate a clean, printable A4 report — then Print or Save as PDF.'));

  const toolbar = el('div', 'rpt-toolbar');
  const seg = el('div', 'seg');
  seg.style.flexWrap = 'wrap';
  const types = [['service', 'Service history'], ['purchases', 'Purchases'], ['summary', 'Full summary']];
  types.forEach(([k, label]) => {
    const b = el('button', k === reportType ? 'on' : '', html`${t(label)}`);
    b.onclick = () => { reportType = k; [...seg.children].forEach(x => x.classList.toggle('on', x === b)); paint(); };
    seg.appendChild(b);
  });
  const printBtn = el('button', 'btn primary', html`<svg viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>${t('Print / Save PDF')}`);
  printBtn.onclick = () => window.print();
  toolbar.append(seg, printBtn);
  v.appendChild(toolbar);

  const wrap = el('div', 'rpt-paper-wrap');
  const paper = el('div', 'rpt-paper');
  wrap.appendChild(paper);
  v.appendChild(wrap);
  function paint() { paper.innerHTML = reportHTML(reportType); }
  paint();
  return v;
}

function reportHTML(type) {
  return type === 'purchases' ? reportPurchases() : type === 'summary' ? reportSummary() : reportService();
}
function reportHeader(title) {
  const c = session.current().car;
  const name = c.nickname || [c.year, c.make, c.model].filter(Boolean).join(' ') || 'Vehicle';
  const initials = ((c.make ? c.make[0] : 'M') + (c.model ? c.model[0] : '3')).toUpperCase();
  return html`
    <div class="rpt-head">
      <div class="rpt-brand">
        <div class="rpt-badge">${initials}</div>
        <div><h2>${name}</h2><p>${[c.engine, c.transmission, c.color].filter(Boolean).join(' · ')}</p></div>
      </div>
      <div class="rpt-meta">
        <div class="rpt-title">${title}</div>
        <div>${t('Generated')} ${today().toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <div>${t('Odometer ')}${fmt(c.odometer)} km${c.plate ? html` · ${c.plate}` : ''}</div>
        ${c.vin ? html`<div>VIN ${c.vin}</div>` : ''}
      </div>
    </div>`;
}
function reportFooter() {
  return html`<div class="rpt-foot"><span>${t('Garage · Mazda 3 care app')}</span><span>${t('Report generated')} ${today().toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' })}</span></div>`;
}
function reportService() {
  const hist = [...session.current().history].sort((a, b) => b.date.localeCompare(a.date) || b.odometer - a.odometer);
  const total = hist.reduce((a, e) => a + Number(e.cost || 0), 0);
  const body = !hist.length
    ? html`<div class="rpt-empty">${t('No service history recorded yet.')}</div>`
    : html`<div class="rpt-cards">
        <div class="rpt-stat"><div class="n">${hist.length}</div><div class="l">${t('Services logged')}</div></div>
        <div class="rpt-stat"><div class="n">${sar(total)}</div><div class="l">${t('Total spent (SAR)')}</div></div>
        <div class="rpt-stat"><div class="n">${fmt(session.current().car.odometer)}</div><div class="l">${t('Current odometer (km)')}</div></div>
      </div>
      <div class="rpt-section-title">${t('Work history')}</div>
      <table class="rpt-table">
        <thead><tr><th>${t('Date')}</th><th>${t('Service')}</th><th>${t('Category')}</th><th class="num">${t('Odometer')}</th><th class="num">${t('Cost')}</th><th>${t('Notes')}</th></tr></thead>
        <tbody>${hist.map(e => html`<tr>
          <td>${new Date(e.date + 'T00:00:00').toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
          <td>${t(e.name)}</td><td>${e.cat ? t(e.cat) : '—'}</td>
          <td class="num">${fmt(e.odometer)} km</td>
          <td class="num">${e.cost > 0 ? sar(e.cost) + ' SAR' : '—'}</td>
          <td>${e.note || ''}</td></tr>`)}</tbody>
        <tfoot><tr><td colspan="4">${t('Total')}</td><td class="num">${sar(total)} SAR</td><td></td></tr></tfoot>
      </table>`;
  return html`${reportHeader(t('Service History Report'))}${body}${reportFooter()}`;
}
function reportPurchases() {
  const sp = [...session.current().spending].sort((a, b) => b.date.localeCompare(a.date));
  const total = sp.reduce((a, e) => a + Number(e.amount || 0), 0);
  const byCat = {};
  sp.forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + Number(e.amount || 0); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const body = !sp.length
    ? html`<div class="rpt-empty">${t('No purchases or spending recorded yet.')}</div>`
    : html`<div class="rpt-cards">
        <div class="rpt-stat"><div class="n">${sp.length}</div><div class="l">${t('Entries')}</div></div>
        <div class="rpt-stat"><div class="n">${sar(total)}</div><div class="l">${t('Total spent (SAR)')}</div></div>
        <div class="rpt-stat"><div class="n">${cats.length}</div><div class="l">${t('Categories')}</div></div>
      </div>
      <div class="rpt-section-title">${t('By category')}</div>
      <table class="rpt-table"><thead><tr><th>${t('Category')}</th><th class="num">${t('Amount')}</th><th class="num">${t('Share')}</th></tr></thead>
        <tbody>${cats.map(([k, val]) => html`<tr><td>${t(k)}</td><td class="num">${sar(val)} SAR</td><td class="num">${Math.round(val / (total || 1) * 100)}%</td></tr>`)}</tbody></table>
      <div class="rpt-section-title">${t('All purchases')}</div>
      <table class="rpt-table">
        <thead><tr><th>${t('Date')}</th><th>${t('Item')}</th><th>${t('Category')}</th><th class="num">${t('Odometer')}</th><th class="num">${t('Amount')}</th></tr></thead>
        <tbody>${sp.map(e => html`<tr>
          <td>${new Date(e.date + 'T00:00:00').toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
          <td>${e.desc}</td><td>${t(e.cat)}</td>
          <td class="num">${e.odometer ? fmt(e.odometer) + ' km' : '—'}</td>
          <td class="num">${sar(e.amount)} SAR</td></tr>`)}</tbody>
        <tfoot><tr><td colspan="4">${t('Total')}</td><td class="num">${sar(total)} SAR</td></tr></tfoot>
      </table>`;
  return html`${reportHeader(t('Purchases & Spending Report'))}${body}${reportFooter()}`;
}
function reportSummary() {
  const ranked = servicesRanked();
  const overdue = ranked.filter(r => r.st.level === 'danger');
  const soon = ranked.filter(r => r.st.level === 'warn');
  const due = [...overdue, ...soon];
  const dueCost = due.reduce((a, r) => a + (r.s.cost || 0), 0);
  const hs = healthScore();
  const spent = yearSpend(today().getFullYear());
  const histTotal = session.current().history.reduce((a, e) => a + Number(e.cost || 0), 0);
  const dueRows = due.length
    ? due.map(({ s, st }) => html`<tr><td>${t(s.name)}</td><td>${st.level === 'danger' ? t('Overdue') : t('Due soon')}</td><td class="num">${st.kmLeft <= 0 ? fmt(-st.kmLeft) + ' ' + t('km over') : fmt(st.kmLeft) + ' ' + t('km left')}</td><td class="num">${sar(s.cost)} SAR</td></tr>`)
    : html`<tr><td colspan="4" style="text-align:center;color:#8b93a3;padding:16px">${t('Everything is up to date 🎉')}</td></tr>`;
  return html`${reportHeader(t('Vehicle Summary Report'))}
    <div class="rpt-cards">
      <div class="rpt-stat"><div class="n">${hs}</div><div class="l">${t('Health score')}</div></div>
      <div class="rpt-stat"><div class="n">${soon.length}</div><div class="l">${t('Due soon')}</div></div>
      <div class="rpt-stat"><div class="n">${overdue.length}</div><div class="l">${t('Overdue')}</div></div>
    </div>
    <div class="rpt-cards" style="margin-top:12px">
      <div class="rpt-stat"><div class="n">${sar(spent)}</div><div class="l">${t('Spent in 2026 (SAR)')}</div></div>
      <div class="rpt-stat"><div class="n">${sar(histTotal)}</div><div class="l">${t('Lifetime service cost')}</div></div>
      <div class="rpt-stat"><div class="n">${session.current().history.length}</div><div class="l">${t('Services logged')}</div></div>
    </div>
    <div class="rpt-section-title">${raw(t('Upcoming &amp; overdue services'))}</div>
    <table class="rpt-table">
      <thead><tr><th>${t('Service')}</th><th>${t('Status')}</th><th class="num">${t('Distance')}</th><th class="num">${t('Est. cost')}</th></tr></thead>
      <tbody>${dueRows}</tbody>
      ${due.length ? html`<tfoot><tr><td colspan="3">${t('Estimated total')}</td><td class="num">${sar(dueCost)} SAR</td></tr></tfoot>` : ''}
    </table>${reportFooter()}`;
}

function monthlyBars() {
  const wrap = el('div', 'spend-bars');
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(today().getFullYear(), today().getMonth() - i, 1); months.push(d); }
  const totals = months.map(m => {
    const key = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0'); // local month, no TZ shift
    return session.current().spending.filter(e => e.date.startsWith(key)).reduce((a, e) => a + Number(e.amount), 0);
  });
  const max = Math.max(1, ...totals);
  months.forEach((m, i) => {
    const isNow = i === months.length - 1;
    const sb = el('div', 'sb' + (isNow ? ' now' : ''));
    const h = Math.max(4, (totals[i] / max) * 100);
    sb.innerHTML = html`<div class="col" style="height:${h}%"></div><div class="m">${m.toLocaleString('en', { month: 'short' })}</div>`;
    sb.title = `${sar(totals[i])} SAR`;
    wrap.appendChild(sb);
  });
  return wrap;
}

function spendEntry(e) {
  const emoji = { Maintenance: '🔧', Tires: '🛞', Parts: '📦', Fuel: '⛽', Electrical: '🔋', Insurance: '📄', Other: '💠' }[e.cat] || '💠';
  const it = el('div', 'card entry');
  it.innerHTML = html`
    <div class="e-ic">${emoji}</div>
    <div class="e-main"><h3>${e.desc}${e.photo ? ' 🧾' : ''}</h3><p>${t(e.cat)} · ${new Date(e.date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
    <div class="e-amt">${sar(e.amount)} <span class="muted" style="font-size:10px">SAR</span></div>`;
  it.onclick = () => openAddSpending(e);
  return it;
}

/* recommendations, recCard now live in src/pages/dashboard.js. */

/* ============================================================
   MODALS
   ============================================================ */
/* ============================================================
   PAGE 6 — FUEL LOG & ECONOMY
   ============================================================ */
function fuelRows() {
  const entries = [...(session.current().fuel || [])].sort((a, b) => a.date.localeCompare(b.date) || a.odometer - b.odometer);
  return entries.map((e, i) => {
    const prev = entries[i - 1];
    let l100 = null, km = null, costPerKm = null;
    if (prev && e.odometer > prev.odometer && e.litres > 0) {
      km = e.odometer - prev.odometer;
      l100 = e.litres / km * 100;
      costPerKm = (Number(e.cost) || 0) / km;
    }
    return { e, l100, km, costPerKm };
  });
}
function renderFuel() {
  if (!session.current().fuel) session.current().fuel = [];
  const v = el('div');
  v.appendChild(pageIntro('Fuel', 'Log fill-ups to track economy (L/100 km) and running cost.'));

  const rows = fuelRows();
  const withEcon = rows.filter(r => r.l100 != null);
  const avg = withEcon.length ? withEcon.reduce((a, r) => a + r.l100, 0) / withEcon.length : null;
  const last = withEcon.length ? withEcon[withEcon.length - 1].l100 : null;
  const lastCPK = withEcon.length ? withEcon[withEcon.length - 1].costPerKm : null;
  const totalFuel = (session.current().fuel).reduce((a, e) => a + (Number(e.cost) || 0), 0);

  const tiles = el('div', 'tiles');
  tiles.innerHTML = html`
    <div class="tile"><div class="t-num">${last != null ? last.toFixed(1) : '—'}</div><div class="t-cap">${t('Last L/100km')}</div></div>
    <div class="tile"><div class="t-num">${avg != null ? avg.toFixed(1) : '—'}</div><div class="t-cap">${t('Avg L/100km')}</div></div>
    <div class="tile"><div class="t-num">${lastCPK != null ? lastCPK.toFixed(2) : '—'}</div><div class="t-cap">${t('SAR / km')}</div></div>`;
  v.appendChild(tiles);

  // economy-drop early warning → points to culprits already in the app
  if (last != null && avg != null && last > avg * 1.15) {
    const warn = el('div', 'card rec');
    warn.style.borderLeftColor = 'var(--warn)';
    warn.innerHTML = html`<div class="r-ic">⚠️</div><div><h3>${t('Fuel economy has dropped')}</h3><p>${t('Last fill-up was')} ${last.toFixed(1)} L/100km ${t('vs your')} ${avg.toFixed(1)} ${t('average.')} ${t('Common causes: low tire pressure (keep 36 PSI), dirty air filter, worn MAF/O2 sensor, tired spark plugs, or a dragging brake.')}</p></div>`;
    v.appendChild(warn);
  }

  const add = el('button', 'btn primary block', html`${iconSvg('plus')}${t('Add fill-up')}`);
  add.style.margin = '14px 0 4px';
  add.onclick = () => openAddFuel(null);
  v.appendChild(add);

  if (withEcon.length) {
    v.appendChild(sectionTitle('Economy trend — L/100km (lower is better)', '', null));
    const card = el('div', 'card');
    card.style.padding = '16px';
    card.appendChild(fuelBars(withEcon.slice(-8)));
    v.appendChild(card);
  }

  v.appendChild(sectionTitle('Fill-up log', '', null));
  const list = el('div', 'list');
  if (!rows.length) list.appendChild(emptyState('⛽', 'No fill-ups logged yet.\nTap "Add fill-up" after your next refuel.'));
  [...rows].reverse().forEach(({ e, l100, km }) => {
    const it = el('div', 'card entry');
    it.innerHTML = html`
      <div class="e-ic">⛽</div>
      <div class="e-main">
        <h3>${e.litres} L${e.full === false ? ' · ' + t('partial') : ''}${l100 != null ? ` · ${l100.toFixed(1)} L/100km` : ''}</h3>
        <p>${new Date(e.date + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })} · ${fmt(e.odometer)} km${km ? ` · +${fmt(km)} km` : ''}</p>
      </div>
      <div class="e-amt">${sar(e.cost)} <span class="muted" style="font-size:10px">SAR</span></div>`;
    it.onclick = () => openAddFuel(e);
    list.appendChild(it);
  });
  v.appendChild(list);
  return v;
}
function fuelBars(points) {
  const wrap = el('div', 'spend-bars');
  const max = Math.max(...points.map(p => p.l100), 1);
  points.forEach((p, i) => {
    const isNow = i === points.length - 1;
    const sb = el('div', 'sb' + (isNow ? ' now' : ''));
    const h = Math.max(6, p.l100 / max * 100);
    sb.innerHTML = html`<div class="col" style="height:${h}%"></div><div class="m">${p.l100.toFixed(1)}</div>`;
    sb.title = p.l100.toFixed(1) + ' L/100km';
    wrap.appendChild(sb);
  });
  return wrap;
}
function openAddFuel(e) {
  const editing = !!e;
  openModal(editing ? 'Edit fill-up' : 'Add fill-up', 'Record a refuel to track economy & cost.', card => {
    const r0 = el('div', 'field-row');
    r0.append(field('Date', html`<input id="f_date" type="date" value="${e ? e.date : isoDate(today())}">`),
      field('Odometer (km)', html`<input id="f_odo" type="number" inputmode="numeric" value="${e ? e.odometer : session.current().car.odometer}">`));
    card.appendChild(r0);
    const r1 = el('div', 'field-row');
    r1.append(field('Litres', html`<input id="f_l" type="number" inputmode="decimal" step="0.01" value="${e ? e.litres : ''}" placeholder="${t('e.g. 42')}">`),
      field('Cost (SAR)', html`<input id="f_cost" type="number" inputmode="decimal" value="${e ? e.cost : ''}" placeholder="${t('e.g. 95')}">`));
    card.appendChild(r1);
    card.appendChild(field('Tank', html`<select id="f_full"><option value="yes"${!e || e.full !== false ? ' selected' : ''}>${t('Full tank')}</option><option value="no"${e && e.full === false ? ' selected' : ''}>${t('Partial fill')}</option></select>`));
    const b = el('button', 'btn primary block', html`${t('Save')}`);
    onAsyncClick(b, async () => {
      const litres = +$('#f_l').value, odo = +$('#f_odo').value;
      if (!litres) return toast('Litres required', 'warn');
      if (!odo) return toast('Odometer required', 'warn');
      const obj = { id: e ? e.id : uid(), date: $('#f_date').value || isoDate(today()), odometer: odo, litres, cost: +$('#f_cost').value || 0, full: $('#f_full').value !== 'no' };
      if (e) Object.assign(e, obj); else { session.current().fuel = session.current().fuel || []; session.current().fuel.push(obj); }
      // a fill-up is a real odometer reading — stamp it with the fill-up's own date
      if (odo > session.current().car.odometer) { session.current().car.odometer = odo; session.current().car.odoUpdatedAt = obj.date; }
      const ok = await save(); closeModal(); go('fuel'); if (ok) toast(editing ? 'Fill-up updated' : 'Fill-up added');
    });
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', html`${t('Delete fill-up')}`);
      del.style.cssText = 'margin-top:8px;color:var(--danger)';
      onAsyncClick(del, async () => { session.current().fuel = session.current().fuel.filter(x => x.id !== e.id); const ok = await save(); closeModal(); go('fuel'); if (ok) toast('Fill-up deleted'); });
      card.appendChild(del);
    }
  });
}

/* ---------- documents & renewals ---------- */
const DOC_ICONS = { 'Insurance': '📄', 'Registration (Istimara)': '🪪', 'Vehicle Inspection (Fahes)': '✅', 'Driving License': '🚗', 'Warranty': '🛡️', 'Other': '📎' };
function docStatus(expiry) {
  if (!expiry) return { level: 'ok', txt: t('No date set') };
  const days = Math.round((parseDate(expiry) - today()) / 86400000);
  const ar = lang === 'ar';
  const level = days < 0 ? 'danger' : days <= 30 ? 'warn' : 'ok';
  const txt = days < 0 ? (ar ? `منتهية منذ ${Math.abs(days)} يوم` : `Expired ${Math.abs(days)}d ago`)
    : days === 0 ? t('Due today')
    : days <= 60 ? (ar ? `خلال ${days} يوم` : `in ${days}d`)
    : (ar ? `خلال ${Math.round(days / 30)} شهر` : `in ${Math.round(days / 30)} mo`);
  return { days, level, txt };
}
function docItem(d) {
  const st = docStatus(d.expiry);
  const it = el('div', 'item');
  it.innerHTML = html`
    <div class="item-ic">${DOC_ICONS[d.type] || '📄'}</div>
    <div class="item-main">
      <h3>${d.name ? d.name : t(d.type)}</h3>
      <p>${d.expiry ? t('Expires') + ' ' + new Date(d.expiry + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : t('No expiry date')}${d.number ? ` · ${d.number}` : ''}</p>
    </div>
    <div class="item-side"><span class="pill ${st.level}">${st.txt}</span></div>`;
  it.onclick = () => openAddDoc(d);
  return it;
}
function openAddDoc(d) {
  const editing = !!d;
  const types = Object.keys(DOC_ICONS);
  openModal(editing ? 'Edit document' : 'Add document', 'Track renewals so you never miss an expiry.', card => {
    card.appendChild(field('Type', html`<select id="d_type">${types.map(ty => html`<option value="${ty}" ${d && d.type === ty ? 'selected' : ''}>${t(ty)}</option>`)}</select>`));
    card.appendChild(field('Label (optional)', html`<input id="d_name" value="${d ? (d.name || '') : ''}" placeholder="${t('e.g. Tawuniya comprehensive')}">`));
    const r = el('div', 'field-row');
    r.append(field('Expiry date', html`<input id="d_exp" type="date" value="${d ? (d.expiry || '') : ''}">`),
      field('Reference no. (optional)', html`<input id="d_num" value="${d ? (d.number || '') : ''}">`));
    card.appendChild(r);
    const b = el('button', 'btn primary block', html`${t('Save')}`);
    onAsyncClick(b, async () => {
      const obj = { id: d ? d.id : uid(), type: $('#d_type').value, name: $('#d_name').value.trim(), expiry: $('#d_exp').value, number: $('#d_num').value.trim() };
      if (d) Object.assign(d, obj); else { session.current().docs = session.current().docs || []; session.current().docs.push(obj); }
      const ok = await save(); closeModal(); go('dashboard'); if (ok) toast(editing ? 'Document updated' : 'Document added');
    });
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', html`${t('Delete document')}`);
      del.style.cssText = 'margin-top:8px;color:var(--danger)';
      onAsyncClick(del, async () => { session.current().docs = session.current().docs.filter(x => x.id !== d.id); const ok = await save(); closeModal(); go('dashboard'); if (ok) toast('Document deleted'); });
      card.appendChild(del);
    }
  });
}

/* openModal, closeModal, field now live in src/ui/modal.js. */

function openEditOdo() {
  openModal('Update mileage', 'Keep this current so due dates stay accurate.', card => {
    card.appendChild(field('Odometer (km)', html`<input id="m_odo" type="number" inputmode="numeric" value="${session.current().car.odometer}">`));
    card.appendChild(field('Average driving (km / day)', html`<input id="m_daily" type="number" inputmode="numeric" value="${session.current().car.dailyKm}">`));
    const b = el('button', 'btn primary block', html`${t('Save')}`);
    onAsyncClick(b, async () => {
      const val = parseInt($('#m_odo').value, 10);
      if (!isNaN(val)) { session.current().car.odometer = val; session.current().car.odoUpdatedAt = isoDate(today()); }
      const d = parseInt($('#m_daily').value, 10);
      if (!isNaN(d) && d > 0) session.current().car.dailyKm = d;
      const ok = await save(); closeModal(); go(current); if (ok) toast('Mileage updated');
    });
    card.appendChild(b);
  });
}

/* carTitle, carInitials, renderTopbar now live in src/ui/chrome.js. */

/* readImageResized, photoPicker, openImage now live in src/ui/photo.js. */

function openGarage() {
  if (!session.booted()) return;
  openModal('Your garage', 'Switch between your vehicles or add another.', card => {
    const list = el('div', 'list');
    session.garage().vehicles.forEach(v => {
      const c = v.data.car;
      const active = v.id === session.garage().activeId;
      const it = el('div', 'item');
      it.innerHTML = html`
        <div class="item-ic" style="overflow:hidden">${c.photo ? html`<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover">` : '🚗'}</div>
        <div class="item-main"><h3>${vehicleName(c)}</h3><p>${[c.engine, c.color].filter(Boolean).join(' · ')} · ${fmt(c.odometer)} km</p></div>
        <div class="item-side">${active ? html`<span class="pill ok">${t('Active')}</span>` : html`<span style="color:var(--accent-soft);font-size:12px;font-weight:600">${t('Switch ›')}</span>`}</div>`;
      it.onclick = () => { if (active) { closeModal(); openSettings(); } else chooseVehicle(v.id); };
      list.appendChild(it);
    });
    card.appendChild(list);
    const add = el('button', 'btn primary block', html`${iconSvg('plus')}${t('Add a vehicle')}`);
    add.style.marginTop = '14px';
    add.onclick = () => addVehicle();
    card.appendChild(add);
  });
}

/* The merge prompt. Resolves 'local' or 'server'; the caller replaces the
   other side entirely, so the wording has to be unambiguous about that. */
function askWhichGarage() {
  return new Promise(resolve => {
    let answered = false;
    openModal(t('You have data here and in your account'), t('Choose which one to keep. The other is replaced.'), card => {
      const wrap = el('div', 'stack');
      const keepLocal = el('button', 'btn', html`${t('Keep this device’s garage')}`);
      const keepServer = el('button', 'btn ghost', html`${t('Use my account’s garage')}`);
      keepLocal.onclick = () => { answered = true; closeModal(); resolve('local'); };
      keepServer.onclick = () => { answered = true; closeModal(); resolve('server'); };
      wrap.appendChild(keepLocal);
      wrap.appendChild(keepServer);
      card.appendChild(wrap);
    });
    /* Dismissing the modal must still resolve, or signIn() hangs forever
       holding a user that has already authenticated. The server copy is the
       safe default: the local garage is still on disk either way.

       openModal() assigns the backdrop handler as its last statement
       (app.js:1457), so overriding it here wins. closeModal() itself has no
       dismissal hook to subscribe to. */
    $('#modalHost').querySelector('[data-close]').onclick = () => {
      if (answered) return;
      answered = true;
      closeModal();
      resolve('server');
    };
  });
}

function openAccount() {
  const signedIn = !!account.user();
  openModal(t('Account'), signedIn ? t('Signed in as') + ' ' + account.user().email : t('Your garage stays on this device.'), card => {
    if (signedIn) {
      const status = el('p', 'muted');
      account.outboxSize().then(pending => { status.textContent = pending ? t('Waiting to sync') + ' · ' + pending : t('Synced'); });
      card.appendChild(status);
      const out = el('button', 'btn ghost', html`${t('Sign out')}`);
      out.style.color = 'var(--danger)';
      out.onclick = () => { closeModal(); account.signOut(); };
      card.appendChild(out);
      return;
    }

    const form = el('div', 'stack');
    form.innerHTML = html`
      <label class="field"><span>${t('Email')}</span><input type="email" id="ac_email" autocomplete="email"></label>
      <label class="field"><span>${t('Password')}</span><input type="password" id="ac_pw" autocomplete="current-password"></label>
      <p class="muted" id="ac_err" hidden></p>`;
    card.appendChild(form);

    const err = form.querySelector('#ac_err');
    const show = msg => { err.textContent = t(msg); err.hidden = false; };

    const submit = mode => () => {
      err.hidden = true;
      const email = form.querySelector('#ac_email').value.trim();
      const pw = form.querySelector('#ac_pw').value;
      if (pw.length < 6) return show('Password must be at least 6 characters.');
      account.signIn(email, pw, { signUp: mode === 'up' })
        .then(() => closeModal())
        .catch(e => {
          const m = String(e && e.message || '');
          if (m === 'PULL_FAILED') return show('Couldn’t reach your garage. Check your connection and try again.');
          if (m === 'EMAIL_NOT_CONFIRMED') return show('Check your email to confirm your account.');
          if (m === 'EMAIL_ALREADY_REGISTERED') return show('That email is already registered. Sign in instead.');
          show('Wrong email or password.');
        });
    };

    const inBtn = el('button', 'btn', html`${t('Sign in')}`);
    inBtn.onclick = submit('in');
    const upBtn = el('button', 'btn ghost', html`${t('Sign up')}`);
    upBtn.onclick = submit('up');
    card.appendChild(inBtn);
    card.appendChild(upBtn);
  });
}

function openSettings() {
  if (!session.booted()) return;
  openModal('Car profile', 'These details personalise the app and its badge.', card => {
    const c = session.current().car;
    // language switch
    card.appendChild(field('Language / اللغة', ''));
    let selectedLang = lang;
    const langSeg = el('div', 'seg');
    langSeg.style.margin = '0 0 16px';
    [['en', 'English'], ['ar', 'العربية']].forEach(([code, label]) => {
      const b = el('button', lang === code ? 'on' : '', html`${label}`);
      b.onclick = () => { selectedLang = code; [...langSeg.children].forEach(x => x.classList.toggle('on', x === b)); };
      langSeg.appendChild(b);
    });
    card.appendChild(langSeg);

    // account row — absent entirely from file://, where sign-in cannot work
    if (account.available()) {
      const acctRow = el('div', 'card plan-setup-banner');
      acctRow.style.margin = '0 0 16px';
      acctRow.innerHTML = html`<div class="r-ic">👤</div><div style="flex:1"><h3>${t('Account')}</h3><p class="muted" style="font-size:12px;margin-top:2px">${account.user() ? account.user().email : t('Not signed in')}</p></div>`;
      const acctBtn = el('button', account.user() ? 'btn ghost' : 'btn', html`${account.user() ? t('Account') : t('Sign in')}`);
      acctBtn.onclick = () => { closeModal(); openAccount(); };
      acctRow.appendChild(acctBtn);
      card.appendChild(acctRow);
    }

    // plan setup wizard — schedule basis, odometer & service history
    const planRow = el('div', 'card plan-setup-banner');
    planRow.style.margin = '0 0 16px';
    planRow.innerHTML = session.current().planSetupDone
      ? html`<div class="r-ic">🧭</div><div style="flex:1"><h3>${t('Update your plan')}</h3><p class="muted" style="font-size:12px;margin-top:2px">${t('Re-answer the setup questions if anything’s changed.')}</p></div>`
      : html`<div class="r-ic">🧭</div><div style="flex:1"><h3>${t('Set up your plan')}</h3><p class="muted" style="font-size:12px;margin-top:2px">${t('Tell the plan which major services you’ve already done.')}</p></div>`;
    const planBtn = el('button', session.current().planSetupDone ? 'btn ghost' : 'btn', html`${t(session.current().planSetupDone ? 'Edit' : 'Set up')}`);
    planBtn.onclick = () => { closeModal(); openPlanSetup(); };
    planRow.appendChild(planBtn);
    card.appendChild(planRow);

    let photo = c.photo || '';

    const picker = el('div', 'photo-picker');
    picker.innerHTML = html`
      <div class="photo-preview" id="s_prev">${photo ? html`<img src="${photo}">` : '🚗'}</div>
      <div class="photo-actions">
        <button class="btn" id="s_pick">${photo ? t('Change photo') : t('Add photo')}</button>
        <button class="btn ghost" id="s_rm" ${photo ? '' : 'hidden'} style="color:var(--danger)">${t('Remove')}</button>
        <input type="file" accept="image/*" id="s_file" hidden>
      </div>`;
    card.appendChild(picker);
    const prev = picker.querySelector('#s_prev');
    picker.querySelector('#s_pick').onclick = () => picker.querySelector('#s_file').click();
    picker.querySelector('#s_file').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      readImageResized(f, url => { photo = url; prev.innerHTML = html`<img src="${url}">`; picker.querySelector('#s_pick').textContent = t('Change photo'); picker.querySelector('#s_rm').hidden = false; });
    };
    picker.querySelector('#s_rm').onclick = () => { photo = ''; prev.innerHTML = '🚗'; picker.querySelector('#s_pick').textContent = t('Add photo'); picker.querySelector('#s_rm').hidden = true; };

    card.appendChild(field('Nickname (optional)', html`<input id="c_nick" value="${c.nickname || ''}" placeholder="${t('e.g. The Gray Ghost')}">`));
    const r1 = el('div', 'field-row');
    r1.append(field('Make', html`<input id="c_make" value="${c.make || ''}">`), field('Model', html`<input id="c_model" value="${c.model || ''}">`));
    card.appendChild(r1);
    const MAZDA3_COLORS = [
      'Soul Red Metallic (Code 41V)',
      'Snowflake White Pearl Mica (Code 25D)',
      'Jet Black Mica (Code 41W)',
      'Deep Crystal Blue Mica (Code 42M)',
      'Blue Reflex Mica (Code 42B)',
      'Meteor Gray Mica (Code 42A)',
      'Liquid Silver Metallic (Code 38P)',
      'Titanium Flash Mica (Code 42S)'
    ];
    const normColor = s => (s || '').toLowerCase().replace(/\s*\(code.*\)/, '').trim();
    let colorOpts = MAZDA3_COLORS.slice();
    let colorSel = MAZDA3_COLORS.find(x => normColor(x) === normColor(c.color));
    if (c.color && !colorSel) { colorOpts = [c.color, ...MAZDA3_COLORS]; colorSel = c.color; }
    const r2 = el('div', 'field-row');
    r2.append(field('Year', html`<input id="c_year" type="number" value="${c.year || ''}">`),
      field('Transmission', html`<select id="c_trans">${['Automatic', 'Manual'].map(tr => html`<option value="${tr}" ${c.transmission === tr ? 'selected' : ''}>${t(tr)}</option>`)}</select>`));
    card.appendChild(r2);

    // Colour — custom dropdown with a colour sample beside each name (full width)
    const colorField = field('Color', html`
      <div class="color-picker" id="c_colorPick">
        <input type="hidden" id="c_color" value="${colorSel || ''}">
        <button type="button" class="color-trigger">
          <span class="sw" style="background:${swatchFor(colorSel)}"></span>
          <span class="ct-name">${colorSel || t('Select colour')}</span>
          <svg class="ct-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="color-menu" hidden>
          ${colorOpts.map(x => html`<button type="button" class="color-opt${x === colorSel ? ' sel' : ''}" data-val="${x}"><span class="sw" style="background:${swatchFor(x)}"></span><span>${x}</span></button>`)}
        </div>
      </div>`);
    card.appendChild(colorField);
    (() => {
      const pick = colorField.querySelector('#c_colorPick');
      const trigger = pick.querySelector('.color-trigger');
      const menu = pick.querySelector('.color-menu');
      const hidden = pick.querySelector('#c_color');
      trigger.onclick = () => { const open = pick.classList.toggle('open'); menu.hidden = !open; };
      pick.querySelectorAll('.color-opt').forEach(opt => opt.onclick = () => {
        const val = opt.dataset.val;
        hidden.value = val;
        trigger.querySelector('.ct-name').textContent = val;
        trigger.querySelector('.sw').style.background = swatchFor(val);
        pick.querySelectorAll('.color-opt').forEach(o => o.classList.toggle('sel', o === opt));
        pick.classList.remove('open'); menu.hidden = true;
      });
    })();

    const ENGINES = ['1.6L SkyActiv-G', '2.0L SkyActiv-G'];
    let engOpts = ENGINES.slice();
    let engSel = ENGINES.find(e => c.engine && ((c.engine.includes('1.6') && e.includes('1.6')) || (c.engine.includes('2.0') && e.includes('2.0'))));
    if (c.engine && !engSel) { engOpts = [c.engine, ...ENGINES]; engSel = c.engine; }
    card.appendChild(field('Engine', html`<select id="c_engine">${engOpts.map(e => html`<option ${e === engSel ? 'selected' : ''}>${e}</option>`)}</select>`));
    const r4 = el('div', 'field-row');
    r4.append(field('Plate number', html`<input id="c_plate" value="${c.plate || ''}" placeholder="${t('e.g. ABC 1234')}">`),
      field('VIN', html`<input id="c_vin" value="${c.vin || ''}" placeholder="${t('17-char VIN')}">`));
    card.appendChild(r4);

    const b = el('button', 'btn primary block', html`${t('Save profile')}`);
    onAsyncClick(b, async () => {
      Object.assign(session.current().car, {
        nickname: $('#c_nick').value.trim(), make: $('#c_make').value.trim(), model: $('#c_model').value.trim(),
        year: +$('#c_year').value || c.year, color: $('#c_color').value.trim(),
        engine: $('#c_engine').value.trim(), transmission: $('#c_trans').value,
        plate: $('#c_plate').value.trim(), vin: $('#c_vin').value.trim().toUpperCase(), photo
      });
      let ok = false;
      try { ok = await save(); } catch (e) {}
      // photo may exceed quota — verify it stuck
      if (selectedLang !== lang) applyLang(selectedLang);
      applyAccent(); renderTopbar(); closeModal(); go(current); if (ok) toast('Profile saved');
    });
    card.appendChild(b);
    if (session.garage().vehicles.length > 1) {
      const del = el('button', 'btn block ghost', html`${t('Remove this vehicle')}`);
      del.style.cssText = 'margin-top:8px;color:var(--danger)';
      del.onclick = () => deleteVehicle(session.garage().activeId);
      card.appendChild(del);
    }
    const backup = el('div');
    backup.style.cssText = 'margin-top:22px;padding-top:16px;border-top:1px solid var(--stroke)';
    backup.innerHTML = html`<div class="section-title"><div class="section-title-left"><h2>${t('Backup & restore')}</h2></div></div>
      <p style="font-size:12px;color:var(--text-2);line-height:1.55;margin-bottom:12px">${t('A backup file holds every vehicle, service, receipt and photo.')}</p>`;
    const exp = el('button', 'btn block', html`${t('Export backup')}`);
    exp.onclick = exportGarage;
    const imp = el('button', 'btn block ghost', html`${t('Import backup')}`);
    imp.style.marginTop = '8px';
    const impFile = el('input');
    impFile.type = 'file';
    impFile.accept = 'application/json';
    impFile.hidden = true;
    impFile.onchange = ev => { const f = ev.target.files[0]; if (f) importGarage(f); };
    imp.onclick = () => impFile.click();
    backup.append(exp, imp, impFile);
    card.appendChild(backup);
  });
}

function openEditBudget() {
  openModal('Annual budget', 'Your target spend on the car for the year.', card => {
    card.appendChild(field('Budget (SAR / year)', html`<input id="m_budget" type="number" inputmode="numeric" value="${session.current().budget.annual}">`));
    const b = el('button', 'btn primary block', html`${t('Save')}`);
    onAsyncClick(b, async () => { const v = parseInt($('#m_budget').value, 10); if (!isNaN(v)) session.current().budget.annual = v; const ok = await save(); closeModal(); go('budget'); if (ok) toast('Budget updated'); });
    card.appendChild(b);
  });
}

function openServiceDetail(s) {
  const st = serviceStatus(s);
  openModal(s.name, s.cat, card => {
    const pillTxt = t(st.level === 'danger' ? 'Overdue' : st.level === 'warn' ? 'Due soon' : 'On track');
    const box = el('div');
    box.innerHTML = html`
      <div style="margin:2px 0 14px"><span class="pill ${st.level}">${pillTxt}</span></div>
      <div class="detail-row"><span class="k">${t('Interval')}</span><span class="v">${fmt(svKm(s))} km / ${svMo(s)} mo${s.normalKm && s.normalKm !== s.intervalKm ? html` <span class="muted" style="font-size:11px">· ${t(session.current().severity === 'severe' ? 'dealer' : 'severe')} ${fmt(session.current().severity === 'severe' ? s.normalKm : s.intervalKm)}</span>` : ''}</span></div>
      <div class="detail-row"><span class="k">${t('Last done')}</span><span class="v">${fmt(s.lastKm)} km · ${new Date(s.lastDate + 'T00:00:00').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
      <div class="detail-row"><span class="k">${t('Next due')}</span><span class="v">${fmt(st.dueKm)} km · ${st.dueDate.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
      <div class="detail-row"><span class="k">${t('Distance left')}</span><span class="v">${st.kmLeft <= 0 ? fmt(-st.kmLeft) + ' ' + t('km over') : fmt(st.kmLeft) + ' km'}</span></div>
      <div class="detail-row"><span class="k">${t('Est. cost')}</span><span class="v">${sar(s.cost)} SAR</span></div>
      ${s.pendingParts && s.pendingParts.length ? html`<div class="log-pending ${s.pendingParts.some(n => partCrit(n) === 'high') ? 'danger' : s.pendingParts.some(n => partCrit(n) === 'med') ? 'warn' : 'ok'}" style="margin-top:14px">⚠️ ${t('Do next service')}: ${raw(s.pendingParts.map(n => html`${t(n)} <span class="crit">(${critLabel(n)})</span>`).join('، '))}</div>` : ''}
      ${s.note ? html`<p class="muted" style="font-size:12.5px;margin-top:14px;line-height:1.5">${t(s.note)}</p>` : ''}`;
    card.appendChild(box);

    // Parts this service needs — pulled live from the Parts catalog
    const rel = partsForService(s);
    if (rel.length) {
      const total = rel.reduce((a, p) => a + partCheapest(p), 0);
      const pb = el('div');
      pb.style.marginTop = '18px';
      pb.innerHTML = html`<div style="font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:8px">${t('Parts for this service')} · ~${sar(total)} SAR</div>`;
      const pl = el('div', 'list');
      rel.forEach(p => {
        const it = el('div', 'item');
        it.innerHTML = html`<div class="item-ic">${p.icon || '🔩'}</div><div class="item-main"><h3>${t(p.name)}</h3><p>${t('from')} ${sar(partCheapest(p))} SAR · ${p.options.length} ${t('options')}</p></div><div class="item-side"><span style="color:var(--accent-soft);font-size:12px;font-weight:600">${t('View ›')}</span></div>`;
        it.onclick = () => { closeModal(); go('parts', { openPart: p.id }); };
        pl.appendChild(it);
      });
      pb.appendChild(pl);
      card.appendChild(pb);
    }

    const row = el('div', 'fab-row');
    row.style.marginTop = '18px';
    const done = el('button', 'btn primary', html`${iconSvg('check')}${t('Mark done now')}`);
    done.style.flex = '1';
    done.onclick = () => { closeModal(); openLogConfirm([s], { onDone: () => { go(current); toast(`${t(s.name)} ${t('logged ✓')}`); } }); };
    const edit = el('button', 'btn', html`${t('Edit')}`);
    edit.onclick = () => openEditService(s);
    row.append(done, edit);
    card.appendChild(row);
  });
}

function markServiceDone(s) {
  s.lastKm = session.current().car.odometer;
  s.lastDate = isoDate(today());
  // record it in the work history
  session.current().history.push({ id: uid(), name: s.name, icon: s.icon || '🔧', date: isoDate(today()), odometer: session.current().car.odometer, cost: s.cost || 0, cat: 'Maintenance', note: '' });
  // log the spend
  if (s.cost > 0) session.current().spending.push({ id: uid(), date: isoDate(today()), cat: 'Maintenance', desc: s.name, amount: s.cost, odometer: session.current().car.odometer });
  save(); // fire-and-forget: nothing downstream reads the result
}

function openAddHistory(e, prefill) {
  const editing = !!e;
  const p = e || prefill || {}; // prefill = { name, icon, cat, odometer, cost } from the plan
  const cats = ['Maintenance', 'Tires', 'Parts', 'Fuel', 'Electrical', 'Other'];
  openModal(editing ? 'Edit service record' : 'Log a past service', editing ? '' : 'Record work already done on your car.', card => {
    card.appendChild(field('Service', html`<input id="h_name" value="${p.name || ''}" placeholder="${t('e.g. Timing chain inspection')}">`));
    const r0 = el('div', 'field-row');
    r0.append(field('Icon (emoji)', html`<input id="h_icon" value="${p.icon || '🔧'}" maxlength="2">`),
      field('Category', html`<select id="h_cat">${cats.map(c => html`<option value="${c}" ${p.cat === c ? 'selected' : ''}>${t(c)}</option>`)}</select>`));
    card.appendChild(r0);
    const r1 = el('div', 'field-row');
    r1.append(field('Date', html`<input id="h_date" type="date" value="${e ? e.date : isoDate(today())}">`),
      field('Odometer (km)', html`<input id="h_odo" type="number" value="${p.odometer != null ? p.odometer : session.current().car.odometer}">`));
    card.appendChild(r1);
    card.appendChild(field('Cost (SAR)', html`<input id="h_cost" type="number" value="${p.cost != null ? p.cost : 0}">`));
    card.appendChild(field('Note', html`<textarea id="h_note" rows="2">${e ? (e.note || '') : ''}</textarea>`));
    let hphoto = e ? (e.photo || '') : '';
    card.appendChild(field('Receipt / invoice', ''));
    card.appendChild(photoPicker(hphoto, v => hphoto = v));
    if (!editing) {
      const chk = el('div', 'field');
      chk.innerHTML = html`<label style="display:flex;align-items:center;gap:9px;font-size:13px;color:var(--text);font-weight:500;cursor:pointer">
        <input type="checkbox" id="h_spend" checked style="width:auto;accent-color:var(--accent)"> ${t('Also add this cost to Budget')}</label>`;
      card.appendChild(chk);
    }
    const b = el('button', 'btn primary block', html`${editing ? t('Save changes') : t('Add to history')}`);
    onAsyncClick(b, async () => {
      const name = $('#h_name').value.trim();
      if (!name) return toast('Service name required', 'warn');
      const obj = {
        id: e ? e.id : uid(), name, icon: $('#h_icon').value.trim() || '🔧', cat: $('#h_cat').value,
        date: $('#h_date').value || isoDate(today()), odometer: +$('#h_odo').value || 0,
        cost: +$('#h_cost').value || 0, note: $('#h_note').value.trim(), photo: hphoto
      };
      if (e) Object.assign(e, obj);
      else {
        session.current().history.push(obj);
        if ($('#h_spend').checked && obj.cost > 0) session.current().spending.push({ id: uid(), date: obj.date, cat: obj.cat, desc: obj.name, amount: obj.cost, odometer: obj.odometer });
        // logged from the plan → re-baseline that service so the plan re-times itself
        if (prefill && prefill.serviceId) {
          const sv = session.current().services.find(x => x.id === prefill.serviceId);
          if (sv && obj.odometer > 0) { sv.lastKm = obj.odometer; sv.lastDate = obj.date; }
        }
      }
      const ok = await save(); closeModal(); go('maintenance'); if (ok) toast(editing ? 'Record updated' : 'Service logged ✓');
    });
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', html`${t('Delete record')}`);
      del.style.marginTop = '8px'; del.style.color = 'var(--danger)';
      onAsyncClick(del, async () => { session.current().history = session.current().history.filter(x => x.id !== e.id); const ok = await save(); closeModal(); go('maintenance'); if (ok) toast('Record deleted'); });
      card.appendChild(del);
    }
  });
}

function openEditService(s) {
  const editing = !!s;
  openModal(editing ? 'Edit service' : 'New service', 'Set the interval and last service point.', card => {
    card.appendChild(field('Name', html`<input id="s_name" value="${s ? s.name : ''}" placeholder="${t('e.g. Timing chain check')}">`));
    card.appendChild(field('Icon (emoji)', html`<input id="s_icon" value="${s ? s.icon : '🔧'}" maxlength="2">`));
    const row1 = el('div', 'field-row');
    row1.append(field('Interval (km)', html`<input id="s_ikm" type="number" value="${s ? s.intervalKm : 10000}">`),
      field('Interval (months)', html`<input id="s_imo" type="number" value="${s ? s.intervalMonths : 12}">`));
    card.appendChild(row1);
    const row1b = el('div', 'field-row');
    row1b.append(field('Dealer interval (km)', html`<input id="s_nkm" type="number" value="${s && s.normalKm ? s.normalKm : ''}" placeholder="${t('same as above')}">`),
      field('Dealer interval (mo)', html`<input id="s_nmo" type="number" value="${s && s.normalMonths ? s.normalMonths : ''}" placeholder="${t('same as above')}">`));
    card.appendChild(row1b);
    const row2 = el('div', 'field-row');
    row2.append(field('Last done (km)', html`<input id="s_lkm" type="number" value="${s ? s.lastKm : session.current().car.odometer}">`),
      field('Last done (date)', html`<input id="s_ldate" type="date" value="${s ? s.lastDate : isoDate(today())}">`));
    card.appendChild(row2);
    const row3 = el('div', 'field-row');
    row3.append(field('Category', html`<input id="s_cat" value="${s ? s.cat : 'General'}">`),
      field('Est. cost (SAR)', html`<input id="s_cost" type="number" value="${s ? s.cost : 0}">`));
    card.appendChild(row3);
    card.appendChild(field('Note', html`<textarea id="s_note" rows="2">${s ? (s.note || '') : ''}</textarea>`));
    const b = el('button', 'btn primary block', html`${t('Save service')}`);
    onAsyncClick(b, async () => {
      const name = $('#s_name').value.trim();
      if (!name) return toast('Name is required', 'warn');
      const obj = {
        id: s ? s.id : uid(), name, icon: $('#s_icon').value.trim() || '🔧',
        cat: $('#s_cat').value.trim() || 'General',
        intervalKm: +$('#s_ikm').value || 10000, intervalMonths: +$('#s_imo').value || 12,
        normalKm: +$('#s_nkm').value || null, normalMonths: +$('#s_nmo').value || null,
        lastKm: +$('#s_lkm').value || 0, lastDate: $('#s_ldate').value || isoDate(today()),
        cost: +$('#s_cost').value || 0, note: $('#s_note').value.trim()
      };
      if (s) Object.assign(s, obj); else session.current().services.push(obj);
      const ok = await save(); closeModal(); go('maintenance'); if (ok) toast(editing ? 'Service updated' : 'Service added');
    });
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', html`${t('Delete service')}`);
      del.style.marginTop = '8px'; del.style.color = 'var(--danger)';
      onAsyncClick(del, async () => { session.current().services = session.current().services.filter(x => x.id !== s.id); const ok = await save(); closeModal(); go('maintenance'); if (ok) toast('Service deleted'); });
      card.appendChild(del);
    }
  });
}

function openLogService() {
  openModal('Log a service', 'A single service, or a whole plan visit at once.', card => {
    const single = el('div', 'card plan-setup-banner');
    single.innerHTML = html`<div class="r-ic">🔧</div><div style="flex:1"><h3>${t('Single service')}</h3><p class="muted" style="font-size:12px;margin-top:2px">${t('Pick one thing you just had done.')}</p></div>`;
    const bSingle = el('button', 'btn', html`${t('Choose')}`);
    bSingle.onclick = () => { closeModal(); openLogSingleService(); };
    single.appendChild(bSingle);
    card.appendChild(single);

    const plan = el('div', 'card plan-setup-banner');
    plan.innerHTML = html`<div class="r-ic">🗓️</div><div style="flex:1"><h3>${t('Plan visit')}</h3><p class="muted" style="font-size:12px;margin-top:2px">${t('A group of services from your plan, done together.')}</p></div>`;
    const bPlan = el('button', 'btn', html`${t('Choose')}`);
    bPlan.onclick = () => { closeModal(); openLogPlanVisit(); };
    plan.appendChild(bPlan);
    card.appendChild(plan);
  });
}

function openLogSingleService() {
  openModal('Log a service', 'Pick what you just had done — it resets the clock and adds the cost.', card => {
    const list = el('div', 'list');
    servicesRanked().forEach(({ s, st }) => {
      const it = serviceItem(s, st);
      it.onclick = () => { closeModal(); openLogConfirm([s], { onDone: () => { go(current); toast(`${t(s.name)} ${t('logged ✓')}`); } }); };
      list.appendChild(it);
    });
    card.appendChild(list);
  });
}

function openLogPlanVisit() {
  const milestones = planForward().slice(0, 6);
  openModal('Log a plan visit', 'Pick an upcoming group of services — logs everything in it at once.', card => {
    if (!milestones.length) { card.appendChild(emptyState('🗓️', 'Nothing scheduled — you’re all caught up!')); return; }
    const list = el('div', 'list');
    milestones.forEach(ms => {
      const it = el('div', 'item');
      it.innerHTML = html`
        <div class="item-ic">${ms.major ? '🛠️' : '🗓️'}</div>
        <div class="item-main"><h3>${fmt(ms.km)} km${ms.major ? ' · ' + t('Major service') : ''}</h3><p>${ms.items.map(s => t(s.name)).join(', ')}</p></div>
        <div class="item-side"><span style="color:var(--accent-soft);font-size:12px;font-weight:600">${t('Log ›')}</span></div>`;
      it.onclick = () => { closeModal(); openLogConfirm(ms.items, { checklist: true, onDone: () => { go('maintenance'); } }); };
      list.appendChild(it);
    });
    card.appendChild(list);
  });
}

function openAddSpending(e) {
  const editing = !!e;
  const cats = ['Maintenance', 'Tires', 'Parts', 'Fuel', 'Electrical', 'Insurance', 'Other'];
  openModal(editing ? 'Edit expense' : 'Add spending', 'Log money spent on the car.', card => {
    if (!editing) {
      const partOpts = session.current().parts.map((p, i) => html`<option value="part:${i}">${t(p.name)} · ${sar(partCheapest(p))} SAR</option>`);
      const quickPick = field('Quick pick',
        html`<select id="x_pick"><option value="">${t('Start from scratch…')}</option>${partOpts}</select>`);
      // The "— autofill from a part" note is styled markup, not plain text —
      // build it as a real DOM node and append it to the label rather than
      // asking field() to accept raw markup (see field()'s comment).
      const note = document.createElement('span');
      note.className = 'muted';
      note.setAttribute('style', 'font-weight:500');
      note.textContent = t('— autofill from a part');
      quickPick.querySelector('label').append(' ', note);
      card.appendChild(quickPick);
    }
    card.appendChild(field('Description', html`<input id="x_desc" value="${e ? e.desc : ''}" placeholder="${t('e.g. New front brake pads')}">`));
    const row = el('div', 'field-row');
    row.append(field('Amount (SAR)', html`<input id="x_amt" type="number" inputmode="numeric" value="${e ? e.amount : ''}">`),
      field('Date', html`<input id="x_date" type="date" value="${e ? e.date : isoDate(today())}">`));
    card.appendChild(row);
    card.appendChild(field('Category', html`<select id="x_cat">${cats.map(c => html`<option value="${c}" ${e && e.cat === c ? 'selected' : ''}>${t(c)}</option>`)}</select>`));
    card.appendChild(field('Odometer at time (km)', html`<input id="x_odo" type="number" value="${e ? e.odometer : session.current().car.odometer}">`));
    let xphoto = e ? (e.photo || '') : '';
    card.appendChild(field('Receipt / invoice', ''));
    card.appendChild(photoPicker(xphoto, v => xphoto = v));
    if (!editing) {
      $('#x_pick').onchange = function () {
        if (!this.value) return;
        const p = session.current().parts[+this.value.split(':')[1]];
        $('#x_desc').value = p.name;
        $('#x_amt').value = partCheapest(p);
        $('#x_cat').value = p.cat === 'Tires' ? 'Tires' : p.cat === 'Electrical' ? 'Electrical' : 'Parts';
      };
    }
    const b = el('button', 'btn primary block', html`${t('Save')}`);
    onAsyncClick(b, async () => {
      const desc = $('#x_desc').value.trim(); const amt = +$('#x_amt').value;
      if (!desc) return toast('Description required', 'warn');
      if (isNaN(amt)) return toast('Amount required', 'warn');
      const obj = { id: e ? e.id : uid(), desc, amount: amt, date: $('#x_date').value || isoDate(today()), cat: $('#x_cat').value, odometer: +$('#x_odo').value || session.current().car.odometer, photo: xphoto };
      if (e) Object.assign(e, obj); else session.current().spending.push(obj);
      const ok = await save(); closeModal(); go('budget'); if (ok) toast(editing ? 'Expense updated' : 'Expense added');
    });
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', html`${t('Delete expense')}`);
      del.style.marginTop = '8px'; del.style.color = 'var(--danger)';
      onAsyncClick(del, async () => { session.current().spending = session.current().spending.filter(x => x.id !== e.id); const ok = await save(); closeModal(); go('budget'); if (ok) toast('Expense deleted'); });
      card.appendChild(del);
    }
  });
}

function openEditPart(p) {
  const editing = !!p;
  openModal(editing ? 'Edit part' : 'New part', 'Add the OEM option and any alternatives.', card => {
    card.appendChild(field('Part name', html`<input id="p_name" value="${p ? p.name : ''}" placeholder="${t('e.g. Front Brake Pads')}">`));
    const row = el('div', 'field-row');
    const curCat = p ? p.cat : 'Engine';
    const catList = [...new Set(['Engine', 'Interior', 'Brakes', 'Exterior', 'Electrical', 'Drivetrain', 'Suspension', 'A/C', 'Tires', 'General', ...session.current().parts.map(x => x.cat), curCat])];
    row.append(field('Icon (emoji)', html`<input id="p_icon" value="${p ? p.icon : '🔩'}" maxlength="2">`),
      field('Category', html`<select id="p_cat">${catList.map(c => html`<option value="${c}" ${c === curCat ? 'selected' : ''}>${t(c)}</option>`)}</select>`));
    card.appendChild(row);
    card.appendChild(field('PartSouq part no. (optional — enables live-price link)', html`<input id="p_psq" value="${p && p.partsouq ? p.partsouq : ''}" placeholder="e.g. PE0114302A">`));

    const optsWrap = el('div');
    const lbl = el('div'); lbl.style.cssText = 'font-size:12px;font-weight:600;color:var(--text-2);margin:6px 0';
    lbl.textContent = t('Options (OEM & alternatives)');
    card.appendChild(lbl);
    card.appendChild(optsWrap);

    const opts = p ? JSON.parse(JSON.stringify(p.options)) : [{ tag: 'OEM', brand: '', partNo: '', price: 0, store: '', note: '' }];
    function drawOpts() {
      optsWrap.innerHTML = '';
      opts.forEach((o, i) => {
        const box = el('div', 'card');
        box.style.cssText = 'padding:12px;margin-bottom:10px';
        box.innerHTML = html`
          <div class="field-row" style="margin-bottom:8px">
            <div class="field" style="margin:0"><label>${t('Type')}</label><select data-k="tag"><option ${o.tag === 'OEM' ? 'selected' : ''}>OEM</option><option ${o.tag !== 'OEM' ? 'selected' : ''}>ALT</option></select></div>
            <div class="field" style="margin:0"><label>${t('Price (SAR)')}</label><input type="number" data-k="price" value="${o.price}"></div>
          </div>
          <div class="field" style="margin:0 0 8px"><label>${t('Brand / product')}</label><input data-k="brand" value="${o.brand || ''}"></div>
          <div class="field-row" style="margin-bottom:8px">
            <div class="field" style="margin:0"><label>${t('Part no.')}</label><input data-k="partNo" value="${o.partNo || ''}"></div>
            <div class="field" style="margin:0"><label>${t('Store')}</label><input data-k="store" value="${o.store || ''}"></div>
          </div>
          <div class="field" style="margin:0"><label>${t('Note')}</label><input data-k="note" value="${o.note || ''}"></div>`;
        box.querySelectorAll('[data-k]').forEach(inp => inp.oninput = () => { o[inp.dataset.k] = inp.type === 'number' ? +inp.value : inp.value; });
        if (opts.length > 1) {
          const rm = el('button', 'btn ghost', html`${t('Remove option')}`); rm.style.cssText = 'margin-top:8px;font-size:12px;padding:7px;color:var(--danger)';
          rm.onclick = () => { opts.splice(i, 1); drawOpts(); };
          box.appendChild(rm);
        }
        optsWrap.appendChild(box);
      });
    }
    drawOpts();
    const addOpt = el('button', 'btn block ghost', html`${iconSvg('plus')}${t('Add option')}`);
    addOpt.style.marginBottom = '14px';
    addOpt.onclick = () => { opts.push({ tag: 'ALT', brand: '', partNo: '', price: 0, store: '', note: '' }); drawOpts(); };
    card.appendChild(addOpt);

    const b = el('button', 'btn primary block', html`${t('Save part')}`);
    onAsyncClick(b, async () => {
      const name = $('#p_name').value.trim();
      if (!name) return toast('Part name required', 'warn');
      const valid = opts.filter(o => o.brand.trim());
      if (!valid.length) return toast('Add at least one option', 'warn');
      const obj = { id: p ? p.id : uid(), name, icon: $('#p_icon').value.trim() || '🔩', cat: $('#p_cat').value.trim() || 'General', partsouq: $('#p_psq').value.trim().replace(/[^A-Za-z0-9]/g, ''), options: valid };
      if (p) Object.assign(p, obj); else session.current().parts.push(obj);
      const ok = await save(); closeModal(); go('parts'); if (ok) toast(editing ? 'Part updated' : 'Part added');
    });
    card.appendChild(b);
    if (editing) {
      const del = el('button', 'btn block ghost', html`${t('Delete part')}`);
      del.style.marginTop = '8px'; del.style.color = 'var(--danger)';
      onAsyncClick(del, async () => { session.current().parts = session.current().parts.filter(x => x.id !== p.id); const ok = await save(); closeModal(); go('parts'); if (ok) toast('Part deleted'); });
      card.appendChild(del);
    }
  });
}

/* sectionTitle, pageIntro, emptyState, iconSvg, toast, systemTheme,
   applyTheme, themePref, setThemePref now live in src/ui/chrome.js. This
   top-level wiring stays — it moves to main.js's boot block in Task 9, and
   until then needs setThemePref/themePref/toast as globals, which chrome.js
   now provides the same way app.js's own declarations did. */
$('#themeToggle').onclick = () => {
  const next = nextTheme(themePref());
  setThemePref(next);
  toast(next === 'system' ? 'Theme: follows device' : next === 'light' ? 'Theme: light' : 'Theme: dark');
};

/* NAV_KEYS, applyNavLabels, applyLang now live in src/i18n/lang.js. */
// follow the device unless the user has explicitly picked light or dark
setThemePref(themePref());
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
    if (themePref() === 'system') applyTheme(e.matches ? 'light' : 'dark');
  });
}

/* CAR_ACCENTS, hexToRgb, rgbToHex, darkenHex, accentForColor,
   COLOR_SWATCHES, swatchFor, applyAccent now live in src/ui/chrome.js. */

/* ---------- boot ---------- */
$('#settingsBtn').onclick = openSettings;
$('#openProfile').onclick = openSettings;
$('#garageBtn').onclick = openGarage;
lang = localStorage.getItem('garage.lang') || 'en';
document.documentElement.setAttribute('lang', lang);
document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
applyNavLabels();

/* session.js emits its failure messages untranslated; t() here is what keeps
   the Arabic save-failure toasts working. */
session.configure({
  notify: (msg, kind) => toast(t(msg), kind),
  afterSave: (id, data, photoIds) => { account.enqueueVehicle(id, data); (photoIds || []).forEach(pid => account.enqueuePhoto(pid)); kickSync(); }
});

/* Gate on the protocol directly. account.available() also requires a client,
   and this expression is what SUPPLIES the client — calling it here would
   always see env.client === null and never build one. */
const canSignIn = typeof supabase !== 'undefined' && location.protocol !== 'file:';

account.configure({
  client: canSignIn ? supabase.createClient(account.SUPABASE_URL, account.SUPABASE_ANON_KEY) : null,
  /* The re-render half of sign-out. session.clear() revokes object URLs, but a
     decoded <img> stays painted until something rebuilds the view — so
     account.js never calls clear() without calling this after it. */
  rerender: () => { renderTopbar(); go(current); },
  choose: askWhichGarage
});

session.load()
  .then(firstRun => { if (firstRun) return session.save(); })   // first run — persist the seed
  .then(() => {
    applyAccent();
    renderTopbar();
    go('dashboard');
    /* After the first paint, never before: a slow or absent network must not
       delay the app a user can already use offline. */
    return account.start();
  })
  .catch(err => {
    document.getElementById('view').innerHTML =
      html`<div class="card" style="padding:20px"><h3>${t('Could not open your garage')}</h3><p style="color:var(--text-2);margin-top:8px">${t('Your data is safe. Please reload the page.')}</p></div>`;
    console.error(err);
  });

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { account.sync(); });
  window.__hasOnlineSyncListener = true;   /* Test seam only. e2e presence check only. */
}

/* ---------- PWA: offline + installable ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
