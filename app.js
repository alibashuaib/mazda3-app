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

/* reportType, renderReports, reportHTML, reportHeader, reportFooter,
   reportService, reportPurchases, reportSummary, monthlyBars, spendEntry
   now live in src/pages/reports.js. */

/* recommendations, recCard now live in src/pages/dashboard.js. */

/* ============================================================
   MODALS
   ============================================================ */
/* fuelRows, renderFuel, fuelBars, openAddFuel now live in
   src/pages/fuel.js. */

/* DOC_ICONS, docStatus, docItem, openAddDoc, openEditOdo now live in
   src/pages/documents.js. */

/* openModal, closeModal, field now live in src/ui/modal.js. */

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
