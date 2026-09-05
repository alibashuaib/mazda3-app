/* ============================================================
   Garage — Maintenance page: Schedule / Plan / History toggle, the
   plan-setup wizard, and the service dialogs.
   Plain script, like app.js — not require()d directly by any test, only
   exercised through the boot harness.
   ============================================================ */
'use strict';

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
    b.onclick = () => { if (maintMode === m) return; maintMode = m; segSelect(b); paintMode(); };
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
  shown.forEach((ms, idx) => {
    const isNext = idx === 0;
    const card = el('div', 'card plan-ms' + (ms.major ? ' major' : '') + (isNext ? ' next' : ''));
    card.innerHTML = html`
      <div class="plan-ms-head">
        <div class="plan-km">${fmt(ms.km)}<span>km</span></div>
        <div class="plan-meta">
          ${isNext ? html`<span class="plan-badge next">${t('Next up')}</span>` : ''}
          ${ms.major ? html`<span class="plan-badge">${t('Major service')}</span>` : ''}
          <span class="plan-when">≈ ${fmtDate(ms.date, { month: 'short', year: 'numeric' })}</span>
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
              segSelect(btn);
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
          else if (!opts.onDone) toast(nDone > 1 ? 'Visit logged ✓' : 'Service logged ✓');
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
          <h3>${t('Do you follow the dealer schedule or the community schedule?')}</h3>
          <p>${t('Dealer service follows Mazda’s official sheet — e.g. oil every 10,000 km. Community service is tighter, often recommended for GCC heat & dust.')}</p>
          <div class="wiz-choice">
            <button class="wiz-opt ${basis === 'severe' ? 'on' : ''}" data-v="severe">${t('Community (tighter)')}</button>
            <button class="wiz-opt ${basis === 'normal' ? 'on' : ''}" data-v="normal">${t('Dealer (10,000 km)')}</button>
          </div>`;
        body.querySelectorAll('.wiz-opt').forEach(btn => btn.onclick = () => {
          basis = btn.dataset.v;
          segSelect(btn, body.querySelectorAll('.wiz-opt'));
        });
      } else if (step === 1) {
        body.innerHTML = html`
          <div class="item-ic">🧭</div>
          <h3>${t('Current odometer')}</h3>
          <p>${t('Keeps every due date and estimate accurate.')}</p>
          <div class="wiz-km"><input id="wiz_odo" type="number" inputmode="numeric" placeholder="${t('e.g. 316,000')}" value="${odo}"></div>`;
        const odoInput = $('#wiz_odo', body);
        odoInput.oninput = () => { odo = odoInput.value; };
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
        kmInput.oninput = () => { a.km = kmInput.value; };
        body.querySelectorAll('.wiz-opt').forEach(btn => btn.onclick = () => {
          a.choice = btn.dataset.v;
          segSelect(btn, body.querySelectorAll('.wiz-opt'));
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
      await commit('maintenance', t('Plan updated'));
    }

    backBtn.onclick = () => { if (step > 0) { step--; renderStep(); } };
    onAsyncClick(nextBtn, async () => {
      if (step === 1) {
        const od = parseInt(odo, 10);
        if (isNaN(od) || od <= 0) return void fail('#wiz_odo', 'Enter your current odometer', body);
      } else if (step === 2) {
        const val = parseFloat($('#wiz_drive', body).value);
        if (isNaN(val) || val <= 0) return void fail('#wiz_drive', 'Enter your average driving distance', body);
      } else if (step >= 3) {
        const a = answers[step - 3];
        if (a.choice === 'yes') {
          const val = parseInt(a.km, 10);
          if (isNaN(val) || val <= 0) return void fail('.wiz-km input', 'Enter a km for this service', body);
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
    b.onclick = () => { active = f; segSelect(b); paint(); };
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
      <div class="tl-sub">${fmtDate(st.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })} · ${kmTxt}</div>
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
    <div class="tile"><div class="t-num" style="font-size:15px;line-height:1.9">${last ? fmtDate(last.date, { day: 'numeric', month: 'short' }) : '—'}</div><div class="t-cap">${t('Last service')}</div></div>`;
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
        <div class="tl-sub">${fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' })} · ${fmt(e.odometer)} km</div>
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

function openServiceDetail(s) {
  const st = serviceStatus(s);
  openModal(s.name, s.cat, card => {
    const pillTxt = t(st.level === 'danger' ? 'Overdue' : st.level === 'warn' ? 'Due soon' : 'On track');
    const box = el('div');
    box.innerHTML = html`
      <div style="margin:2px 0 14px"><span class="pill ${st.level}">${pillTxt}</span></div>
      <div class="detail-row"><span class="k">${t('Interval')}</span><span class="v">${fmt(svKm(s))} km / ${svMo(s)} mo${s.normalKm && s.normalKm !== s.intervalKm ? html` <span class="muted" style="font-size:11px">· ${t(session.current().severity === 'severe' ? 'Dealer' : 'Community')} ${fmt(session.current().severity === 'severe' ? s.normalKm : s.intervalKm)}</span>` : ''}</span></div>
      <div class="detail-row"><span class="k">${t('Last done')}</span><span class="v">${fmt(s.lastKm)} km · ${fmtDate(s.lastDate, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
      <div class="detail-row"><span class="k">${t('Next due')}</span><span class="v">${fmt(st.dueKm)} km · ${fmtDate(st.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
      <div class="detail-row"><span class="k">${t('Distance left')}</span><span class="v">${st.kmLeft <= 0 ? fmt(-st.kmLeft) + ' ' + t('km over') : fmt(st.kmLeft) + ' km'}</span></div>
      <div class="detail-row"><span class="k">${t('Est. cost')}</span><span class="v">${sar(s.cost)} SAR</span></div>
      ${s.pendingParts && s.pendingParts.length ? html`<div class="log-pending ${s.pendingParts.some(n => partCrit(n) === 'high') ? 'danger' : s.pendingParts.some(n => partCrit(n) === 'med') ? 'warn' : 'ok'}" style="margin-top:14px">⚠️ ${t('Do next service')}: ${raw(s.pendingParts.map(n => html`${t(n)} <span class="crit">(${critLabel(n)})</span>`).join('، '))}</div>` : ''}
      ${s.note ? html`<p class="muted" style="font-size:12.5px;margin-top:14px;line-height:1.5">${s.note.startsWith('Community rec.') ? html`<span class="opt-tag alt" style="margin-inline-end:6px">${t('Community rec.')}</span>` : ''}${t(s.note)}</p>` : ''}`;
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
      if (!name) return fail('#h_name', 'Service name required');
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
      await commit('maintenance', editing ? 'Record updated' : 'Service logged ✓');
    });
    card.appendChild(b);
    if (editing) {
      const del = deleteRow('Delete record', 'history', e, 'maintenance', 'Record deleted');
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
      if (!name) return fail('#s_name', 'Name is required');
      const obj = {
        id: s ? s.id : uid(), name, icon: $('#s_icon').value.trim() || '🔧',
        cat: $('#s_cat').value.trim() || 'General',
        intervalKm: +$('#s_ikm').value || 10000, intervalMonths: +$('#s_imo').value || 12,
        normalKm: +$('#s_nkm').value || null, normalMonths: +$('#s_nmo').value || null,
        lastKm: +$('#s_lkm').value || 0, lastDate: $('#s_ldate').value || isoDate(today()),
        cost: +$('#s_cost').value || 0, note: $('#s_note').value.trim()
      };
      if (s) Object.assign(s, obj); else session.current().services.push(obj);
      await commit('maintenance', editing ? 'Service updated' : 'Service added');
    });
    card.appendChild(b);
    if (editing) {
      const del = deleteRow('Delete service', 'services', s, 'maintenance', 'Service deleted');
      card.appendChild(del);
    }
  });
}

function openLogService() {
  openModal('Log a service', 'A single service, or a whole plan visit at once.', card => {
    const bSingle = el('button', 'btn', html`${t('Choose')}`);
    bSingle.onclick = () => { closeModal(); openLogSingleService(); };
    card.appendChild(bannerRow('🔧', 'Single service', 'Pick one thing you just had done.', bSingle));

    const bPlan = el('button', 'btn', html`${t('Choose')}`);
    bPlan.onclick = () => { closeModal(); openLogPlanVisit(); };
    card.appendChild(bannerRow('🗓️', 'Plan visit', 'A group of services from your plan, done together.', bPlan));
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
