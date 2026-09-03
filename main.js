/* ============================================================
   Garage — Mazda maintenance tracker  ·  vanilla JS SPA
   Data persists in localStorage. Everything is editable in-app.

   This is the last file loaded (see index.html). Everything else the app
   needs — helpers, i18n, data/session, UI chrome, and the six page
   modules — is already on the global object by the time this file's
   top-level boot code runs. This file owns: the router, the vehicle
   lifecycle (add/switch/delete/export/import), the garage switcher, the
   account and settings dialogs, and the boot sequence itself.
   ============================================================ */
'use strict';

/* The session owns the garage; this file reads it through these. */
const save = () => session.save();
const switchVehicle = id => session.switchVehicle(id);
const revokeObjectUrls = () => session.revokeObjectUrls();
const refreshPhotoUrls = () => session.refreshPhotoUrls();
/* Status functions are pure; these thread the session through so call
   sites across every page module stay unchanged. */
const svKm = s => Status.svKm(s, session.current().severity);
const svMo = s => Status.svMo(s, session.current().severity);
const serviceStatus = s => Status.serviceStatus(s, { odometer: session.current().car.odometer, severity: session.current().severity });
const servicesRanked = () => Status.servicesRanked(session.current());
const healthScore = () => Status.healthScore(session.current());

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
  openModal(t('Add a Mazda'), t('Pick the model and engine — its SkyActiv service plan is set up for you.'), card => {
    card.appendChild(field(t('Model'), html`<select id="av_model">${CAR_MODELS.map((m, i) => html`<option value="${i}">Mazda ${m.model} · ${m.gen}</option>`)}</select>`));
    const engField = field(t('Engine'), html`<select id="av_eng"></select>`);
    card.appendChild(engField);
    const r = el('div', 'field-row');
    r.append(field(t('Current odometer (km)'), html`<input id="av_odo" type="number" inputmode="numeric" value="0">`),
      field(t('Year'), html`<input id="av_year" type="number" inputmode="numeric" placeholder="${t('e.g. 2019')}">`));
    card.appendChild(r);
    const colorField = field(t('Color'), html`<select id="av_color"></select>`);
    card.appendChild(colorField);
    const modelSel = card.querySelector('#av_model'), engSel = card.querySelector('#av_eng'), colorSel = card.querySelector('#av_color');
    const fillEngines = () => { engSel.innerHTML = html`${CAR_MODELS[+modelSel.value].engines.map((e, i) => html`<option value="${i}">${e[0]}</option>`)}`; };
    const fillColors = () => { colorSel.innerHTML = html`${CAR_MODELS[+modelSel.value].colors.map(x => html`<option value="${x}">${x}</option>`)}`; };
    // Look the default up by id — a positional index silently defaults to the
    // wrong car the next time CAR_MODELS is reordered or extended.
    const defaultIdx = CAR_MODELS.findIndex(m => m.id === 'mazda3bm');
    modelSel.value = String(defaultIdx < 0 ? 0 : defaultIdx);
    fillEngines(); fillColors();
    modelSel.onchange = () => { fillEngines(); fillColors(); };
    const b = el('button', 'btn primary block', html`${t('Add a vehicle')}`);
    onAsyncClick(b, async () => {
      const m = CAR_MODELS[+modelSel.value];
      const data = normalizeData(buildProfile(m.id, +engSel.value, { odometer: +$('#av_odo').value || 0, year: +$('#av_year').value || '', color: colorSel.value }));
      const v = { id: uid(), data };
      session.setVehicles(session.garage().vehicles.concat([v]), v.id);
      const res = await saveVehicle(v.id, v.data, session.garage().activeId, uid);
      const ok = res.ok;
      /* A direct saveVehicle() bypasses session.save(), and session.save() is
         the only thing that fires the afterSave hook account.js pushes from.
         Without an explicit enqueue the new vehicle never reaches the server, so
         the next boot's pull() hands back a garage that does not contain it and
         adopt() classifies it as stale — deleting it, and its photos, with no
         prompt. enqueueVehicle() no-ops when signed out and never rejects. Same
         reason its photos need their own enqueuePhoto() call: saveVehicle()'s
         res.photoIds is what actually got persisted, so mirroring
         session.save()'s afterSave hook here is what gets them uploaded too —
         without it, other devices pull a vehicle whose photoId references
         404 forever.

         enqueueVehicle()/enqueuePhoto() are each async — like enqueueTombstone()
         in deleteVehicle below, they read/write the outbox before resolving —
         so kickSync() is sequenced with .then(Promise.all(...)) rather than
         fired synchronously right after them. Firing it synchronously risks
         the exact outbox-snapshot race deleteVehicle's own comment documents:
         drain() could read the outbox before one of these writes has actually
         landed in it, silently deferring that entry to the next kick instead
         of pushing it now. */
      if (ok) {
        applyPhotoIds(v.data, res.data);
        Promise.all([account.enqueueVehicle(v.id, res.data)].concat(res.photoIds.map(pid => account.enqueuePhoto(pid)))).then(kickSync);
      }
      applyAccent(); renderTopbar(); closeModal(); go('dashboard');
      if (ok) toast('Vehicle added');
      else toast(isQuotaError(res.error)
        ? 'Storage is full — your change was NOT saved. Remove some receipt photos.'
        : 'Could not save your change.', 'warn');
    });
    card.appendChild(b);
  });
}
async function deleteVehicle(id) {
  // Already gone — a re-entrant call (double-tap) would otherwise fall
  // through and delete whichever vehicle became active in its place.
  if (!session.garage().vehicles.some(v => v.id === id)) return;
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
  else toast('Could not save your change.', 'warn');
}
// vehicleName() now lives in chrome.js, shared with carTitle() — one name
// function, so there is exactly one place that can produce
// "undefined undefined" instead of several.

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
  // session.photos() hands back the live cache; read it once so every id and
  // blob below comes from the same snapshot instead of whatever the session
  // happens to hold at the moment each individual lookup runs.
  try {
    const live = session.photos();
    const photos = {};
    await Promise.all(Object.keys(live).map(async id => { photos[id] = await blobToDataUrl(live[id]); }));
    const payload = buildExport(session.garage(), photos, new Date().toISOString());
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `garage-backup-${isoDate(today())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup downloaded');
  } catch (err) {
    // blobToDataUrl() reads each photo Blob with blob.arrayBuffer(), which can
    // reject; left unhandled this was a silent unhandled-rejection with no
    // feedback to the user at all.
    console.error(err);
    toast('Could not create a backup. Please try again.', 'warn');
  }
}

/* Import **replaces** the garage. It must ask first — this is destructive. */
function importGarage(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    const parsed = parseImport(reader.result);
    if (!parsed.ok) {
      // The toast has room for one line; the specifics go where they can be read.
      if (parsed.faults) console.warn('Backup rejected:', parsed.faults.join('; '));
      return toast(parsed.error, 'warn');
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
      // Build the replacement cache in a scratch object first, touching nothing
      // session-owned. Only once every dataUrlToBlob() call below has returned —
      // so a throw partway through decoding a malformed entry lands before
      // anything session-owned has been touched — do we clear the live cache and
      // fill it from the scratch one. The old ordering (empty the live cache,
      // then refill it in place) left the OLD garage paired with an EMPTIED
      // cache if the refill loop ever threw partway through; this can't.
      const newPhotos = {};
      Object.keys(parsed.photos).forEach(id => {
        const blob = dataUrlToBlob(parsed.photos[id]);
        if (blob) newPhotos[id] = blob;
      });
      // session.photos() hands back the live cache, not a settable property —
      // swap its contents for the scratch object's, all in one go now that
      // every entry in it is known good.
      const cache = session.photos();
      Object.keys(cache).forEach(id => { delete cache[id]; });
      Object.assign(cache, newPhotos);
      // setVehicles picks the backup's activeId, or vehicles[0] if it is missing.
      session.setVehicles(parsed.garage.vehicles, parsed.garage.activeId);
      let ok = true;
      for (const v of session.garage().vehicles) {
        const res = await saveVehicle(v.id, v.data, session.garage().activeId, uid);
        if (!res.ok) ok = false;
        // Same reason as openAddVehicle: a direct saveVehicle() never reaches
        // session.save()'s afterSave hook, so an imported vehicle would be
        // deleted as stale by the next boot's adopt() — and its photos, left
        // unenqueued, would upload nowhere, leaving other devices to pull a
        // vehicle whose photoId references 404. kickSync() is sequenced after
        // both enqueues settle, not fired synchronously — see the matching
        // comment in openAddVehicle for why.
        else {
          Promise.all([account.enqueueVehicle(v.id, res.data)].concat(res.photoIds.map(pid => account.enqueuePhoto(pid)))).then(kickSync);
        }
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
      toast(ok ? 'Garage restored' : 'Restored, but some data could not be saved', ok ? undefined : 'warn');
    } catch (err) {
      console.error(err);
      toast('That backup could not be restored. Please reload the page.', 'warn');
    }
  };
  reader.onerror = () => toast('Could not read that file.', 'warn');
  reader.readAsText(file);
}

/* What is dragging the score down — a bare number is not actionable. */
function openHealthBreakdown() {
  const bad = servicesRanked().filter(r => r.st.level !== 'ok');
  openModal(t('Health score'), html`${healthScore()} / 100 — ${t('what is affecting it')}`, card => {
    if (!bad.length) { card.appendChild(emptyState('✅', 'Everything is on track.')); return; }
    const list = el('div', 'list');
    bad.forEach(({ s, st }) => list.appendChild(serviceItem(s, st)));
    card.appendChild(list);
  });
}

/* ============================================================
   ROUTER
   ============================================================ */
const routes = { dashboard: renderDashboard, maintenance: renderMaintenance, parts: renderParts, fuel: renderFuel, budget: renderBudget, reports: renderReports };
let current = 'dashboard';
let navIntent = null; // cross-page link target, consumed by the destination page's render
/* Hides the car badge/title, the topbar icon buttons, and the bottom nav —
   every one of them assumes a vehicle exists (session.current().car), which
   is exactly what an empty garage does not have. Onboarding is the only
   thing rendered in that state; everything else waits for the first
   vehicle to be added, then this un-hides them again. */
function setChromeVisible(visible) {
  $('#openProfile').hidden = !visible;
  $('.topbar-actions').hidden = !visible;
  $('#tabbar').hidden = !visible;
}
function renderOnboarding() {
  // The onboarding screen has no vehicle, so it must always render with the
  // stylesheet's own default accent, never a stale car's — calling this
  // here directly (rather than trusting every go()/renderOnboarding() call
  // site to have called it first) is what actually guarantees that.
  applyAccent();
  setChromeVisible(false);
  // hidden only hides these from view — their text nodes are still in the
  // DOM and still readable via textContent (a sign-out leaving the previous
  // user's car name sitting there, unseen but present, is exactly the bug
  // this guards against). Clear the content, not just the visibility.
  $('#carTitle').textContent = '';
  $('#carSub').textContent = '';
  $('#carBadge').innerHTML = '';
  document.title = 'Garage';
  const view = $('#view');
  view.className = 'view';
  view.innerHTML = '';
  const card = el('div', 'card');
  card.style.cssText = 'text-align:center;padding:40px 24px;margin-top:10vh';
  card.innerHTML = html`
    <div style="font-size:40px;margin-bottom:12px">🚗</div>
    <h2 style="font-size:20px;font-weight:800;margin-bottom:6px">${t('Add your first vehicle')}</h2>
    <p class="muted" style="margin-bottom:20px">${t('Pick your Mazda and its engine — its SkyActiv service plan is set up for you.')}</p>`;
  const btn = el('button', 'btn primary block', html`${iconSvg('plus')}${t('Add a vehicle')}`);
  btn.onclick = () => addVehicle();
  card.appendChild(btn);
  view.appendChild(card);
}
function go(route, intent) {
  if (!session.booted()) return;      // boot failed — leave the error card in place
  if (!session.garage() || !session.garage().vehicles.length) { renderOnboarding(); return; }
  // An unknown route name — a stale link, a typo in markup that drifted from
  // `routes` — must not throw out of routes[route]() below and leave the nav
  // dead with no view rendered at all. Fall back to dashboard instead.
  if (!routes[route]) route = 'dashboard';
  setChromeVisible(true);
  revokeObjectUrls();
  refreshPhotoUrls();
  renderTopbar();     // the topbar lives outside #view, so go() has to repaint
                       // it itself — nothing else will
  current = route;
  navIntent = intent || null;
  const view = $('#view');
  view.className = 'view ' + route;
  view.innerHTML = '';
  view.appendChild(routes[route]());
  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.route === route;
    t.classList.toggle('is-active', on);
    // is-active is purely visual; aria-current is what a screen reader reads.
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  $('#view').scrollTop = 0;
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.route)));

function openGarage() {
  if (!session.booted()) return;
  openModal(t('Your garage'), t('Switch between your vehicles or add another.'), card => {
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
    // Previously the only way to reach the active car's settings from here
    // was clicking its row — easy to miss since every other row's click
    // switches vehicle instead. An explicit button removes that ambiguity.
    const settings = el('button', 'btn ghost block', html`${t('Settings')}`);
    settings.style.marginTop = '14px';
    settings.onclick = () => { closeModal(); openSettings(); };
    card.appendChild(settings);
    const add = el('button', 'btn primary block', html`${iconSvg('plus')}${t('Add a vehicle')}`);
    add.style.marginTop = '10px';
    add.onclick = () => addVehicle();
    card.appendChild(add);
  });
}

/* The merge prompt. Resolves 'local' or 'server'; the caller replaces the
   other side entirely, so the wording has to be unambiguous about that. */
function askWhichGarage() {
  return new Promise(resolve => {
    let answered = false;
    const finish = choice => { if (answered) return; answered = true; resolve(choice); };
    openModal(t('You have data here and in your account'), t('Choose which one to keep. The other is replaced.'), card => {
      const wrap = el('div', 'stack');
      const keepLocal = el('button', 'btn', html`${t('Keep this device’s garage')}`);
      const keepServer = el('button', 'btn ghost', html`${t('Use my account’s garage')}`);
      keepLocal.onclick = () => { finish('local'); closeModal(); };
      keepServer.onclick = () => { finish('server'); closeModal(); };
      wrap.appendChild(keepLocal);
      wrap.appendChild(keepServer);
      card.appendChild(wrap);
    }, {
      /* Dismissing the modal — Escape, the backdrop, or anything else that
         routes through closeModal() — must still resolve, or signIn() hangs
         forever holding a user that has already authenticated. opts.onDismissed
         is what covers Escape too: overriding [data-close].onclick, as this
         used to do, only ever catches a backdrop click, since onModalKeydown
         calls closeModal() directly on Escape without going through it.

         Neither default is free: keeping the local garage tombstones every
         vehicle the account has that this device does not; keeping the
         server's garage (adopt()) deletes every local-only vehicle the server
         doesn't have. We default to 'local' on an unanswered dismissal
         because it is the choice that doesn't silently delete something the
         user was just looking at — the account's exclusively-server vehicles
         are the ones that pay for that, not this device's. */
      onDismissed: () => finish('local')
    });
  });
}

function openAccount() {
  const signedIn = !!account.user();
  openModal(t('Account'), signedIn ? t('Signed in as') + ' ' + account.user().email : t('Your garage stays on this device.'), card => {
    if (signedIn) {
      // Garage and Settings aren't account-specific, but only surfaced here
      // once signed in — a list, not a pair of buttons, matching the row
      // style "Your garage"'s own vehicle list already uses.
      const list = el('div', 'list');
      list.style.marginBottom = '16px';
      [
        ['🚗', 'Garage', 'Switch vehicles or add another', openGarage],
        ['⚙️', 'Settings', 'Car profile, language, plan setup', openSettings]
      ].forEach(([icon, title, sub, open]) => {
        const it = el('div', 'item');
        it.innerHTML = html`
          <div class="item-ic">${icon}</div>
          <div class="item-main"><h3>${t(title)}</h3><p>${t(sub)}</p></div>
          <div class="item-side" style="color:var(--text-3);font-size:18px">›</div>`;
        it.onclick = () => { closeModal(); open(); };
        list.appendChild(it);
      });
      card.appendChild(list);

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

    const submit = mode => async () => {
      err.hidden = true;
      const email = form.querySelector('#ac_email').value.trim();
      const pw = form.querySelector('#ac_pw').value;
      if (pw.length < 6) return show('Password must be at least 6 characters.');
      // Both buttons, not just the one clicked — signIn() is already in
      // flight either way, and a click on the OTHER button before it settles
      // would fire a second, conflicting sign-in/sign-up call rather than
      // just double-submitting the same one.
      inBtn.disabled = true; upBtn.disabled = true;
      try {
        await account.signIn(email, pw, { signUp: mode === 'up' });
        closeModal();
      } catch (e) {
        const m = String(e && e.message || '');
        if (m === 'PULL_FAILED') return show('Couldn’t reach your garage. Check your connection and try again.');
        if (m === 'EMAIL_NOT_CONFIRMED') return show('Check your email to confirm your account.');
        if (m === 'EMAIL_ALREADY_REGISTERED') return show('That email is already registered. Sign in instead.');
        show('Wrong email or password.');
      } finally {
        inBtn.disabled = false; upBtn.disabled = false;
      }
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
  openModal(t('Car profile'), t('These details personalise the app and its badge.'), card => {
    const c = session.current().car;
    // language switch
    card.appendChild(field('Language / اللغة', ''));
    let selectedLang = lang;
    const langSeg = segGroup('Language / اللغة', [['en', 'English'], ['ar', 'العربية']], lang,
      code => { selectedLang = code; syncCalendarRow(); });
    langSeg.style.margin = '0 0 16px';
    card.appendChild(langSeg);

    /* Calendar — Arabic only, since English is always Gregorian. Hidden rather
       than disabled: a disabled control invites the reader to work out why,
       and for an English UI there is nothing to work out.

       Visibility follows the language SEGMENT, not the applied `lang`. The
       language switch is deferred to Save (below), so while this modal is open
       the segment is the only thing that says which language the user is
       choosing — gating on `lang` would leave the row missing right after they
       tap العربية, which reads as the control being broken.

       Unlike language, the calendar applies on tap: persisted immediately and
       the view behind repainted, so the change is visible without a Save. */
    const calRow = el('div');
    const calField = field('Calendar / التقويم', '');
    const calSeg = segGroup('Calendar / التقويم',
      [['gregory', t('Gregorian')], ['islamic', t('Hijri')], ['both', t('Both')]],
      calendar, applyCalendar);
    calSeg.style.margin = '0 0 16px';
    calRow.appendChild(calField);
    calRow.appendChild(calSeg);
    function syncCalendarRow() { calRow.hidden = selectedLang !== 'ar'; }
    syncCalendarRow();
    card.appendChild(calRow);

    // account row — absent entirely from file://, where sign-in cannot work
    if (account.available()) {
      const acctBtn = el('button', account.user() ? 'btn ghost' : 'btn', html`${account.user() ? t('Account') : t('Sign in')}`);
      acctBtn.onclick = () => { closeModal(); openAccount(); };
      // The sub-line is an email when signed in — t() passes it through
      // unchanged, so only the signed-out placeholder is actually translated.
      const acctRow = bannerRow('👤', 'Account', account.user() ? account.user().email : 'Not signed in', acctBtn);
      acctRow.style.margin = '0 0 16px';
      card.appendChild(acctRow);
    }

    // plan setup wizard — schedule basis, odometer & service history
    const setUp = session.current().planSetupDone;
    const planBtn = el('button', setUp ? 'btn ghost' : 'btn', html`${t(setUp ? 'Edit' : 'Set up')}`);
    planBtn.onclick = () => { closeModal(); openPlanSetup(); };
    const planRow = setUp
      ? bannerRow('🧭', 'Update your plan', 'Re-answer the setup questions if anything’s changed.', planBtn)
      : bannerRow('🧭', 'Set up your plan', 'Tell the plan which major services you’ve already done.', planBtn);
    planRow.style.margin = '0 0 16px';
    card.appendChild(planRow);

    let photo = c.photo || '';

    card.appendChild(field(t('Nickname (optional)'), html`<input id="c_nick" value="${c.nickname || ''}" placeholder="${t('e.g. The Gray Ghost')}">`));
    const r1 = el('div', 'field-row');
    r1.append(field(t('Make'), html`<input id="c_make" value="${c.make || ''}">`), field(t('Model'), html`<input id="c_model" value="${c.model || ''}">`));
    card.appendChild(r1);
    const modelMeta = CAR_MODELS.find(m => m.id === c.modelId);
    const colorOpts = modelMeta ? modelMeta.colors.slice() : [c.color || DEFAULT_COLOR];
    // normalizeColorName lives in color.js — one normalization shared with
    // realPaintHex's own legacy-name matching, not a second copy of it here.
    const colorSel = colorOpts.find(x => normalizeColorName(x) === normalizeColorName(c.color)) || colorOpts[0];
    const colorTheme = currentTheme();
    const r2 = el('div', 'field-row');
    r2.append(field(t('Year'), html`<input id="c_year" type="number" value="${c.year || ''}">`),
      field(t('Transmission'), html`<select id="c_trans">${['Automatic', 'Manual'].map(tr => html`<option value="${tr}" ${c.transmission === tr ? 'selected' : ''}>${t(tr)}</option>`)}</select>`));
    card.appendChild(r2);

    // Colour — custom dropdown with a colour sample beside each name (full width)
    const colorField = field(t('Color'), html`
      <div class="color-picker" id="c_colorPick">
        <input type="hidden" id="c_color" value="${colorSel || ''}">
        <button type="button" class="color-trigger">
          <span class="sw" style="${swatchStyle(colorSel, colorTheme)}"></span>
          <span class="ct-name">${colorSel || t('Select colour')}</span>
          <svg class="ct-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="color-menu" hidden>
          ${colorOpts.map(x => html`<button type="button" class="color-opt${x === colorSel ? ' sel' : ''}" data-val="${x}"><span class="sw" style="${swatchStyle(x, colorTheme)}"></span><span>${x}</span></button>`)}
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
        trigger.querySelector('.sw').setAttribute('style', swatchStyle(val, colorTheme));
        pick.querySelectorAll('.color-opt').forEach(o => o.classList.toggle('sel', o === opt));
        pick.classList.remove('open'); menu.hidden = true;
      });
    })();

    const ENGINES = ['1.6L SkyActiv-G', '2.0L SkyActiv-G'];
    let engOpts = ENGINES.slice();
    let engSel = ENGINES.find(e => c.engine && ((c.engine.includes('1.6') && e.includes('1.6')) || (c.engine.includes('2.0') && e.includes('2.0'))));
    if (c.engine && !engSel) { engOpts = [c.engine, ...ENGINES]; engSel = c.engine; }
    card.appendChild(field(t('Engine'), html`<select id="c_engine">${engOpts.map(e => html`<option ${e === engSel ? 'selected' : ''}>${e}</option>`)}</select>`));
    const r4 = el('div', 'field-row');
    r4.append(field(t('Plate number'), html`<input id="c_plate" value="${c.plate || ''}" placeholder="${t('e.g. ABC 1234')}">`),
      field(t('VIN'), html`<input id="c_vin" value="${c.vin || ''}" placeholder="${t('17-char VIN')}">`));
    card.appendChild(r4);

    const b = el('button', 'btn primary block', html`${t('Save profile')}`);
    onAsyncClick(b, async () => {
      // An empty field is the user clearing the year on purpose — +'' is 0,
      // which || c.year would silently revert to whatever was there before,
      // making the field impossible to clear. Only garbage (non-numeric,
      // non-empty input) falls back to the previous value.
      const yearRaw = $('#c_year').value.trim();
      const year = yearRaw === '' ? '' : (Number.isFinite(+yearRaw) ? +yearRaw : c.year);
      Object.assign(session.current().car, {
        nickname: $('#c_nick').value.trim(), make: $('#c_make').value.trim(), model: $('#c_model').value.trim(),
        year, color: $('#c_color').value.trim(),
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
      /* Irreversible, and it takes the whole vehicle with it — history,
         spending, fuel, receipt photos, and a server tombstone. Confirm by
         name, and go through onAsyncClick: deleteVehicle drops the vehicle
         from the garage synchronously before its await, so a second click
         lands on the NEXT vehicle's id and removes that one too. */
      onAsyncClick(del, async () => {
        const active = session.garage().vehicles.find(v => v.id === session.garage().activeId);
        if (!active) return;
        if (!confirm(t('Remove this vehicle and everything logged against it? This cannot be undone.') + '\n\n' + vehicleName(active.data.car))) return;
        await deleteVehicle(active.id);
      });
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

// --accent-soft (every page's "View ›"/"Switch ›" links) and the
// dashboard's studio-card paint-outline both derive from the *live* theme
// (see accentForColor/paintOutline in color.js, which take theme as an
// explicit argument) — a theme flip alone doesn't otherwise refresh
// either, so they'd read stale until the next save or navigation.
function refreshForTheme() { applyAccent(); if (current === 'dashboard') go('dashboard'); }

// follow the device unless the user has explicitly picked light or dark
setThemePref(themePref());
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
    if (themePref() === 'system') { applyTheme(e.matches ? 'light' : 'dark'); refreshForTheme(); }
  });
}

/* ---------- boot ---------- */
$('#openProfile').onclick = openSettings;
/* Switch vehicle, theme, settings and account are all inside this one menu
   now (buildAccountMenu in chrome.js); their handlers above are unchanged. */
$('#accountBtn').onclick = toggleAccountMenu;
// Safari private mode (and some locked-down webviews) throw on localStorage
// access rather than just returning null — an uncaught throw here would kill
// boot before the error card even exists to explain why. Default to 'en'.
try { lang = localStorage.getItem('garage.lang') || 'en'; } catch (e) { lang = 'en'; }
calendar = readCalendarPref();   // guards its own storage access, same reason
document.documentElement.setAttribute('lang', lang);
document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
applyNavLabels();

/* session.js emits its failure messages untranslated; t() here is what keeps
   the Arabic save-failure toasts working. */
session.configure({
  notify: (msg, kind) => toast(msg, kind),
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
     account.js never calls clear() without calling this after it.
     applyAccent() has to run too, not just renderTopbar()/go(): the
     accent is an inline style on <html>, which outlives the garage it
     was set for, so without this the previous car's accent colour would
     stay painted across a sign-out that leaves no vehicle behind. */
  rerender: () => { applyAccent(); renderTopbar(); go(current); },
  choose: askWhichGarage
});
/* The old topbar account button hid itself here when sign-in was impossible.
   The menu trigger cannot: hiding it would take the theme, settings and
   vehicle switcher with it. buildAccountMenu() applies the same guard to the
   Account item alone, and rebuilds on every open, so it also tracks a client
   that only becomes available later. */

session.load()
  .then(firstRun => { if (firstRun) return session.save(); })   // first run — persist whatever hydrate() built (a migrated legacy car, or nothing)
  .then(() => {
    applyAccent();
    renderTopbar();
    go('dashboard');
    /* After the first paint, never before: a slow or absent network must not
       delay the app a user can already use offline. Caught right here, not by
       the .catch() below: the app is already painted and usable at this
       point, so a failure from account.start() (offline, a bad Supabase
       client, whatever) must not fall through to the same handler that paints
       the "could not open your garage" error card — that would hide a
       working, already-rendered app behind an error message about a sync
       feature that failed, for a garage that opened just fine. */
    account.start().catch(err => console.error('account.start() failed:', err));
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
