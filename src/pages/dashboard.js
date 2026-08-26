/* ============================================================
   Garage — Dashboard page.
   Plain script, like app.js — not require()d directly by any test, only
   exercised through the boot harness.
   ============================================================ */
'use strict';

function studioCarImage(color, car) {
  const modelId = car && car.modelId;
  const modelImages = {
    mazda2: 'assets/mazda2-dj.png',
    mazda3bp: 'assets/mazda3-bp.png',
    mazda6: 'assets/mazda6-gj.png',
    cx3: 'assets/mazda-cx3-dk.png',
    cx30: 'assets/mazda-cx30-dm.png',
    cx5ke: 'assets/mazda-cx5-ke.png',
    cx5kf: 'assets/mazda-cx5-kf.png',
    cx5gen3: 'assets/mazda-cx5-gen3.png',
    cx9tb: 'assets/mazda-cx9-tb.png',
    cx9: 'assets/mazda-cx9-tc.png',
    cx50: 'assets/mazda-cx50.png',
    cx60: 'assets/mazda-cx60.png',
    cx70: 'assets/mazda-cx70.png',
    cx80: 'assets/mazda-cx80.png',
    cx90: 'assets/mazda-cx90.png'
  };
  if (modelImages[modelId]) return modelImages[modelId];
  if (modelId !== 'mazda3bm') return '';
  const c = (color || '').toLowerCase();
  if (c.includes('soul red') || c === 'red') return 'assets/mazda3-soul-red.png';
  if (c.includes('snowflake') || c.includes('white')) return 'assets/mazda3-snowflake-white.png';
  if (c.includes('jet black') || c === 'black') return 'assets/mazda3-jet-black.png';
  if (c.includes('deep crystal')) return 'assets/mazda3-deep-crystal-blue.png';
  if (c.includes('blue reflex')) return 'assets/mazda3-blue-reflex.png';
  if (c.includes('liquid silver') || c === 'silver') return 'assets/mazda3-liquid-silver.png';
  if (c.includes('titanium flash') || c.includes('bronze') || c.includes('brown')) return 'assets/mazda3-titanium-flash.png';
  return 'assets/mazda3-studio.png';
}

/* ============================================================
   PAGE 1 — DASHBOARD
   ============================================================ */
function renderDashboard() {
  const v = el('div');
  const ranked = servicesRanked();
  const overdue = ranked.filter(r => r.st.level === 'danger');
  const soon = ranked.filter(r => r.st.level === 'warn');
  const hs = healthScore();
  const spent = yearSpend(today().getFullYear());
  const budget = session.current().budget.annual;

  // The vehicle is the dashboard's visual anchor. A lightweight, colour-aware
  // studio render gives the profile a configurator feel without shipping a 3D
  // engine (or making offline use depend on one).
  const carName = session.current().car.nickname || [session.current().car.year, session.current().car.make, session.current().car.model].filter(Boolean).join(' ');
  const paintName = session.current().car.color || 'Meteor Gray';
  const modelId = session.current().car.modelId || 'unknown';
  // mazda3bm ships a distinct photo per its 8 colours (studioCarImage below);
  // every other model has only one reference photo, so its colour choice
  // wouldn't show up at all without a tint. Deriving the tint from the
  // paint's real verified hex (not the colour's name text) is what makes
  // every model, not just the BM, actually reflect the chosen colour.
  const carImage = studioCarImage(paintName, session.current().car);
  const isExactPhoto = modelId === 'mazda3bm' && carImage !== 'assets/mazda3-studio.png';
  const paintClass = isExactPhoto ? '' : ' ' + paintFilterClass(swatchFor(paintName));
  const carCard = el('div', 'card car-card car-studio' + paintClass);
  carCard.dataset.vehicleShape = modelId === 'mazda2' ? 'hatch' : /^cx/.test(modelId) ? 'suv' : 'sedan';
  carCard.title = t('Edit car profile');
  carCard.innerHTML = html`
    <span class="studio-orbit" aria-hidden="true"></span>
    ${carImage ? html`<img class="studio-car" src="${carImage}" alt="${carName} — ${paintName}">` : ''}`;
  const topRow = el('div', 'top-row');
  topRow.appendChild(carCard);

  // hero + ring
  const hero = el('div', 'card hero');
  const dash = 2 * Math.PI * 40;
  hero.innerHTML = html`
    <div>
      <div class="odo-label">${t('Odometer')}</div>
      <div class="odo-value">${fmt(session.current().car.odometer)}<span>km</span></div>
      <button class="odo-edit" id="editOdo">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        ${t('Update mileage')}
      </button>
    </div>
    <div class="ring">
      <svg viewBox="0 0 92 92">
        <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${hs >= 70 ? '#23c186' : hs >= 45 ? '#f5a623' : '#ff4d5e'}"/>
          <stop offset="1" stop-color="${hs >= 70 ? '#4be0a6' : hs >= 45 ? '#ffce6b' : '#ff8a95'}"/>
        </linearGradient></defs>
        <circle class="track" cx="46" cy="46" r="40" fill="none" stroke-width="8"/>
        <circle class="prog" cx="46" cy="46" r="40" fill="none" stroke-width="8"
          stroke-dasharray="${dash}" stroke-dashoffset="${dash * (1 - hs / 100)}"/>
      </svg>
      <div class="ring-label"><div class="ring-num">${hs}</div><div class="ring-cap">${t('Health')}</div></div>
    </div>`;
  topRow.appendChild(hero);
  v.appendChild(topRow);

  // tiles — each links to the page it summarizes
  const tiles = el('div', 'tiles');
  tiles.innerHTML = html`
    <div class="tile ${soon.length ? 'warn' : 'ok'}"><div class="t-num">${soon.length}</div><div class="t-cap">${t('Due soon')}</div></div>
    <div class="tile ${overdue.length ? 'danger' : 'ok'}"><div class="t-num">${overdue.length}</div><div class="t-cap">${t('Overdue')}</div></div>
    <div class="tile"><div class="t-num">${sar(spent)}</div><div class="t-cap">${t('SAR this year')}</div></div>`;
  tiles.children[0].onclick = () => go('maintenance', { filter: 'Due soon' });
  tiles.children[1].onclick = () => go('maintenance', { filter: 'Overdue' });
  tiles.children[2].onclick = () => go('budget');
  [...tiles.children].forEach(t => { t.style.cursor = 'pointer'; });
  v.appendChild(tiles);

  // Keep the two most common actions above the fold on phones.
  const row = el('div', 'fab-row dashboard-actions');
  const bLog = el('button', 'btn primary block', html`${iconSvg('check')}${t('Log a service')}`);
  bLog.onclick = () => openLogService();
  const bSpend = el('button', 'btn block', html`${iconSvg('plus')}${t('Add spending')}`);
  bSpend.onclick = () => openAddSpending();
  row.append(bLog, bSpend);
  v.appendChild(row);

  // Stale mileage quietly corrupts every due date — nudge, don't nag.
  const odoAge = daysSince(session.current().car.odoUpdatedAt, today());
  if (odoAge >= 14) {
    const ob = el('button', 'card reminder-banner warn');
    ob.innerHTML = html`<span class="rb-ic">📏</span><span class="rb-text">${t('Mileage is {n} days old — due dates may be off').replace('{n}', odoAge === Infinity ? '?' : odoAge)}</span><span class="rb-go">${t('Update ›')}</span>`;
    ob.onclick = openEditOdo;
    v.appendChild(ob);
  }

  // Reminder — services you marked "not yet" during a plan visit, ranked by severity
  const deferred = ranked.filter(r => r.s.deferred);
  if (deferred.length) {
    const worst = deferred.some(r => r.st.level === 'danger') ? 'danger' : deferred.some(r => r.st.level === 'warn') ? 'warn' : 'ok';
    const rb = el('button', 'card reminder-banner ' + worst);
    rb.innerHTML = html`<span class="rb-ic">⏰</span><span class="rb-text"><b>${deferred.length}</b> ${t(deferred.length === 1 ? 'service to catch up' : 'services to catch up')}</span><span class="rb-go">${t('Log ›')}</span>`;
    rb.onclick = () => openLogConfirm(deferred.map(r => r.s), { checklist: true, title: 'Catch up', onDone: () => go('dashboard') });
    v.appendChild(rb);
  }

  // Next up — top services due this year (overdue/due-soon and deferred always count)
  const thisYear = today().getFullYear();
  v.appendChild(sectionTitle('Next up', 'See all', () => go('maintenance'), String(thisYear)));
  const dueThisYear = ranked.filter(r => r.s.deferred || r.st.level !== 'ok' || r.st.dueDate.getFullYear() <= thisYear);
  const list = el('div', 'list');
  dueThisYear.slice(0, 4).forEach(({ s, st }) => list.appendChild(serviceItem(s, st)));
  if (!dueThisYear.length) list.appendChild(emptyState('🎉', 'Nothing here — all good!'));
  v.appendChild(list);

  // Documents & renewals (insurance, Istimara, license…)
  v.appendChild(sectionTitle('Documents & renewals', 'Add', () => openAddDoc(null)));
  const docsList = el('div', 'list');
  const docs = [...(session.current().docs || [])].sort((a, b) => (a.expiry ? +parseDate(a.expiry) : Infinity) - (b.expiry ? +parseDate(b.expiry) : Infinity));
  if (!docs.length) docsList.appendChild(emptyState('📄', 'No documents yet.\nAdd insurance, Istimara or license expiry.'));
  docs.forEach(d => docsList.appendChild(docItem(d)));
  v.appendChild(docsList);

  // Recommendations (dashboard only)
  v.appendChild(sectionTitle('Recommendations', '', null));
  const recs = el('div', 'list');
  recommendations().forEach(r => recs.appendChild(r));
  v.appendChild(recs);

  hero.querySelector('#editOdo').onclick = openEditOdo;
  const ring = hero.querySelector('.ring');
  ring.setAttribute('role', 'button');
  ring.setAttribute('tabindex', '0');
  ring.setAttribute('aria-label', `${t('Health')} ${hs} — ${t('what is affecting it')}`);
  ring.onclick = openHealthBreakdown;
  ring.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHealthBreakdown(); } };
  return v;
}

/* ---------- recommendations (Dashboard only) ---------- */
function recommendations() {
  const out = [];

  // evergreen tips — from the 5-year Jeddah maintenance plan (Usage & Climate Notes)
  const tips = [
    ['🛢️', 'Oil every ~7,500 km', "In Jeddah's heat, shorten oil changes to ~7,500 km if you mostly do city driving. Fresh 5W-30 (API SP) keeps the SkyActiv engine clean."],
    ['🛞', 'Tire pressure 36 PSI', 'Keep tires at 36 PSI and check monthly (when cold). Correct pressure saves fuel and prevents blowouts on hot asphalt.'],
    ['🔋', 'Battery every 2–3 years', 'Heat-related wear shortens battery life in Jeddah — plan to replace it every 2–3 years, and load-test it yearly.'],
    ['💧', 'Wash the underbody', "Wash the underbody occasionally to protect against corrosion from Jeddah's coastal salt air."]
  ];
  tips.forEach(tip => out.push(recCard(tip[0], t(tip[1]), t(tip[2]))));
  return out;
}
function recCard(ic, title, body) {
  const c = el('div', 'card rec');
  c.innerHTML = html`<div class="r-ic">${ic}</div><div><h3>${title}</h3><p>${body}</p></div>`;
  return c;
}
