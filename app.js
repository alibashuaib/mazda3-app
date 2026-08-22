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
/* yearSpend, renderBudget, openEditBudget, openAddSpending now live in
   src/pages/budget.js. */

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

/* SERVICE_PARTS, partCheapest, partsForService, servicesForPart, CRIT_HIGH,
   CRIT_LOW, partCrit, critLevel, critLabel now live in src/pages/parts.js. */

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
/* planForward, renderMaintenance, buildPlan, logVisit, openLogConfirm,
   openPlanSetup, buildSchedule, scheduleTimelineItem, buildHistory,
   serviceItem, openServiceDetail (below), markServiceDone, openAddHistory,
   openEditService, openLogService, openLogSingleService, openLogPlanVisit
   now live in src/pages/maintenance.js. */

/* renderParts, partCard now live in src/pages/parts.js. */

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
/* fuelRows, renderFuel, fuelBars, openAddFuel now live in
   src/pages/fuel.js. */

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

/* openServiceDetail, markServiceDone, openAddHistory, openEditService,
   openLogService, openLogSingleService, openLogPlanVisit now live in
   src/pages/maintenance.js. */

/* openEditBudget, openAddSpending now live in src/pages/budget.js. */

/* openEditPart now lives in src/pages/parts.js. */

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
